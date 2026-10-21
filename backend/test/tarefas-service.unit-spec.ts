import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { TarefasService } from '../src/atuacao/tarefas.service';
import { CreateTarefaDto, UpdateTarefaDto } from '../src/atuacao/dto/tarefa.dto';

type Regra = { match: string; rows?: any[]; rowCount?: number };
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const T1 = '33333333-3333-4333-8333-333333333333';
const K1 = '44444444-4444-4444-8444-444444444444';

// Cliente pg mockado: a primeira regra cujo "match" aparece no SQL responde.
function montar(regras: Regra[]) {
  const consultas: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      const r = regras.find((x) => sql.includes(x.match));
      const rows = r?.rows ?? [];
      return { rows, rowCount: r?.rowCount ?? rows.length };
    }),
  };
  return { service: new TarefasService(), client, consultas };
}
const detalhe = (extra: any = {}) => ({ id: K1, tenant_id: T1, status: 'pending', assignee_user_id: U1, ...extra });

describe('TarefasService', () => {
  it('criar: grava tarefa com created_by do usuário e evento created; assignee precisa ser socio', async () => {
    const { service, client, consultas } = montar([
      { match: 'FROM tenants WHERE id', rows: [{ id: T1 }] },
      { match: 'FROM list_socios() WHERE id', rows: [{ '?column?': 1 }] },
      { match: 'INSERT INTO tasks', rows: [{ id: K1 }] },
      { match: 'FROM tasks k', rows: [detalhe()] },
    ]);
    await service.criar(client, U1, { tenant_id: T1, title: 'T', assignee_user_id: U2 } as any);
    const ins = consultas.find((c) => c.sql.includes('INSERT INTO tasks'))!;
    expect(ins.params[3]).toBe(U1); // created_by = actor
    expect(ins.params[4]).toBe(U2);
    const ev = consultas.find((c) => c.sql.includes('INSERT INTO task_events'))!;
    expect(ev.sql).toContain("'created'");
    expect(ev.params).toEqual(expect.arrayContaining([K1, T1, U1]));
    expect(consultas.some((c) => c.sql.includes('list_socios() WHERE id') && c.params[0] === U2)).toBe(true);
  });

  it('criar: tenant invisível pelo RLS => NotFound "Cliente não encontrado"', async () => {
    const { service, client, consultas } = montar([{ match: 'FROM tenants WHERE id', rows: [] }]);
    await expect(service.criar(client, U1, { tenant_id: T1, title: 'T', assignee_user_id: U2 } as any)).rejects.toThrow(
      'Cliente não encontrado',
    );
    expect(consultas.some((c) => c.sql.includes('INSERT'))).toBe(false);
  });

  it('criar: assignee fora de list_socios => BadRequest "Responsável inválido"', async () => {
    const { service, client, consultas } = montar([
      { match: 'FROM tenants WHERE id', rows: [{ id: T1 }] },
      { match: 'list_socios() WHERE id', rows: [] },
    ]);
    await expect(service.criar(client, U1, { tenant_id: T1, title: 'T', assignee_user_id: U2 } as any)).rejects.toThrow(
      'Responsável inválido',
    );
    expect(consultas.some((c) => c.sql.includes('INSERT'))).toBe(false);
  });

  it('mudarStatus: transição inválida => BadRequest e nenhum UPDATE', async () => {
    const { service, client, consultas } = montar([{ match: 'FOR UPDATE', rows: [detalhe()] }]);
    await expect(service.mudarStatus(client, U1, K1, { status: 'completed' })).rejects.toThrow('Transição de status não permitida');
    expect(consultas.some((c) => c.sql.includes('UPDATE tasks'))).toBe(false);
    expect(consultas.some((c) => c.sql.includes('INSERT INTO task_events'))).toBe(false);
  });

  it('mudarStatus: tarefa inexistente => NotFound', async () => {
    const { service, client } = montar([{ match: 'FOR UPDATE', rows: [] }]);
    await expect(service.mudarStatus(client, U1, K1, { status: 'in_progress' })).rejects.toThrow('Tarefa não encontrada');
  });

  it('mudarStatus: bloquear/cancelar sem nota => BadRequest', async () => {
    for (const status of ['blocked', 'cancelled']) {
      const { service, client, consultas } = montar([{ match: 'FOR UPDATE', rows: [detalhe()] }]);
      await expect(service.mudarStatus(client, U1, K1, { status })).rejects.toThrow('Informe o motivo');
      await expect(service.mudarStatus(client, U1, K1, { status, note: '   ' })).rejects.toThrow('Informe o motivo');
      expect(consultas.some((c) => c.sql.includes('UPDATE tasks'))).toBe(false);
    }
  });

  it('mudarStatus: completed grava completed_at; reabrir limpa completed_at; ambos geram evento status_changed', async () => {
    const a = montar([{ match: 'FOR UPDATE', rows: [detalhe({ status: 'in_progress' })] }, { match: 'FROM tasks k', rows: [detalhe()] }]);
    await a.service.mudarStatus(a.client, U1, K1, { status: 'completed' });
    const upd = a.consultas.find((c) => c.sql.includes('UPDATE tasks'))!;
    expect(upd.sql).toContain("completed_at = CASE WHEN $2::text = 'completed' THEN now() ELSE NULL END");
    expect(upd.params).toEqual([K1, 'completed']);
    const ev = a.consultas.find((c) => c.sql.includes('INSERT INTO task_events'))!;
    expect(ev.sql).toContain("'status_changed'");
    expect(ev.params).toEqual(expect.arrayContaining(['in_progress', 'completed']));

    const b = montar([{ match: 'FOR UPDATE', rows: [detalhe({ status: 'completed' })] }, { match: 'FROM tasks k', rows: [detalhe()] }]);
    await b.service.mudarStatus(b.client, U1, K1, { status: 'in_progress' });
    expect(b.consultas.find((c) => c.sql.includes('UPDATE tasks'))!.params).toEqual([K1, 'in_progress']);
    expect(b.consultas.find((c) => c.sql.includes('INSERT INTO task_events'))!.params).toEqual(
      expect.arrayContaining(['completed', 'in_progress']),
    );
  });

  it('atualizar: troca de responsável gera evento assigned com from/to; campos fora do DTO são ignorados', async () => {
    const { service, client, consultas } = montar([
      { match: 'FOR UPDATE', rows: [detalhe()] },
      { match: 'list_socios() WHERE id', rows: [{ '?column?': 1 }] },
      { match: 'FROM tasks k', rows: [detalhe({ assignee_user_id: U2 })] },
    ]);
    const r = await service.atualizar(client, U1, K1, { assignee_user_id: U2, title: 'Novo', status: 'completed', tenant_id: 'x', created_by: 'y' } as any);
    expect(r.reassigned).toEqual({ from: U1, to: U2 });
    const upd = consultas.find((c) => c.sql.includes('UPDATE tasks'))!;
    expect(upd.sql).toMatch(/title = \$\d/);
    for (const proibido of ['status', 'tenant_id', 'created_by']) expect(upd.sql).not.toContain(`${proibido} =`);
    const eventos = consultas.filter((c) => c.sql.includes('INSERT INTO task_events'));
    const assigned = eventos.find((c) => c.sql.includes("'assigned'"))!;
    expect(assigned.params).toEqual(expect.arrayContaining([U1, U2]));
    const updated = eventos.find((c) => c.sql.includes("'updated'"))!;
    expect(updated.params).toContain('title'); // só o nome do campo
    expect(updated.params).not.toContain('Novo');
  });

  it('atualizar: campo setado para string vazia NÃO apaga (ignorado) e título vazio é rejeitado pelo DTO', async () => {
    const { service, client, consultas } = montar([
      { match: 'FOR UPDATE', rows: [detalhe()] },
      { match: 'FROM tasks k', rows: [detalhe()] },
    ]);
    await service.atualizar(client, U1, K1, { description: '', category: '', priority: 'alta' } as any);
    const upd = consultas.find((c) => c.sql.includes('UPDATE tasks'))!;
    expect(upd.sql).toContain('priority = $2');
    expect(upd.sql).not.toContain('description');
    expect(upd.sql).not.toContain('category');

    const vazio = await validate(plainToInstance(UpdateTarefaDto, { title: '' }));
    expect(vazio.length).toBeGreaterThan(0);
  });

  it('atualizar: sem nenhum campo efetivo não emite UPDATE nem evento', async () => {
    const { service, client, consultas } = montar([
      { match: 'FOR UPDATE', rows: [detalhe()] },
      { match: 'FROM tasks k', rows: [detalhe()] },
    ]);
    const r = await service.atualizar(client, U1, K1, { description: '' } as any);
    expect(r.reassigned).toBeNull();
    expect(consultas.some((c) => c.sql.includes('UPDATE tasks') || c.sql.includes('INSERT INTO task_events'))).toBe(false);
  });

  it('listar: assignee=me usa o userId do JWT; vencidas=true filtra due_date < hoje (fuso America/Sao_Paulo) e só estados abertos', async () => {
    const { service, client, consultas } = montar([{ match: 'FROM tasks k', rows: [] }]);
    await service.listar(client, U1, { assignee: 'me', vencidas: 'true', status: 'pending', tenantId: T1 });
    const q = consultas[0];
    expect(q.params).toContain(U1);
    expect(q.params).toContain('pending');
    expect(q.params).toContain(T1);
    expect(q.sql).toContain("(now() AT TIME ZONE 'America/Sao_Paulo')::date");
    expect(q.sql).toMatch(/WHERE[\s\S]*due_date < \(now\(\) AT TIME ZONE 'America\/Sao_Paulo'\)::date/);
    expect(q.sql).toMatch(/LIMIT 200\s*$/);
    expect(q.sql.indexOf('WHERE')).toBeLessThan(q.sql.indexOf('LIMIT 200'));
    expect(q.params.some((p: any) => Array.isArray(p) && p.includes('in_progress') && !p.includes('completed'))).toBe(true);
  });

  it('listar: assignee que não é "me" nem uuid => BadRequest', async () => {
    const { service, client } = montar([]);
    await expect(service.listar(client, U1, { assignee: "x' OR 1=1" })).rejects.toThrow('Responsável inválido');
  });

  it('resumo: conta abertas, vencidas, hoje e bloqueadas só do usuário', async () => {
    const { service, client, consultas } = montar([{ match: 'FROM tasks', rows: [{ abertas: 5, vencidas: 2, hoje: 1, bloqueadas: 1 }] }]);
    expect(await service.resumo(client, U1)).toEqual({ abertas: 5, vencidas: 2, hoje: 1, bloqueadas: 1 });
    expect(consultas).toHaveLength(1);
    expect(consultas[0].sql).toContain('COUNT(*) FILTER');
    expect(consultas[0].sql).toContain('assignee_user_id = $1');
    expect(consultas[0].params[0]).toBe(U1);
  });

  it('atualizar: valores null são ignorados (defesa do service)', async () => {
    const { service, client, consultas } = montar([
      { match: 'FOR UPDATE', rows: [detalhe()] },
      { match: 'FROM tasks k', rows: [detalhe()] },
    ]);
    const r = await service.atualizar(client, U1, K1, { title: null, priority: null, assignee_user_id: null, description: null, due_date: null } as any);
    expect(r.reassigned).toBeNull();
    expect(consultas.some((c) => c.sql.includes('UPDATE tasks') || c.sql.includes('INSERT INTO task_events'))).toBe(false);
  });

  it('DTO update: null em qualquer campo é rejeitado', async () => {
    for (const campo of ['title', 'description', 'priority', 'due_date', 'category', 'assignee_user_id']) {
      const erros = await validate(plainToInstance(UpdateTarefaDto, { [campo]: null }));
      expect({ campo, n: erros.length > 0 }).toEqual({ campo, n: true });
    }
    expect(await validate(plainToInstance(UpdateTarefaDto, {}))).toHaveLength(0);
  });

  it('DTO: due_date aceita só AAAA-MM-DD real; título só com espaços é rejeitado', async () => {
    for (const Cls of [CreateTarefaDto, UpdateTarefaDto]) {
      const base: any = Cls === CreateTarefaDto ? { tenant_id: T1, assignee_user_id: U2, title: 'ok' } : {};
      const v = (extra: any) => validate(plainToInstance(Cls as any, { ...base, ...extra }) as object);
      expect((await v({ due_date: '2026-02-28' })).length).toBe(0);
      expect((await v({ due_date: '2026-02-30' })).length).toBeGreaterThan(0);
      expect((await v({ due_date: '2026-02-28T10:00:00Z' })).length).toBeGreaterThan(0);
      expect((await v({ title: '   ' })).length).toBeGreaterThan(0);
      expect((await v({ title: '  ok  ' })).length).toBe(0);
    }
    expect(plainToInstance(UpdateTarefaDto, { title: '  ok  ' }).title).toBe('ok');
  });
});
