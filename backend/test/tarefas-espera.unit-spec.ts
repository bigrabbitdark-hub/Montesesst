import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ABERTAS, ESPERA, TAREFA_STATUS, transicaoPermitida } from '../src/atuacao/tarefa-status';
import { TarefasService } from '../src/atuacao/tarefas.service';
import { ChangeTarefaStatusDto, EncaminharTarefaDto, ListTarefasQuery } from '../src/atuacao/dto/tarefa.dto';
import { InteracoesService } from '../src/atuacao/interacoes.service';
import { ListInteracoesQuery } from '../src/atuacao/dto/interacao.dto';

const ATOR = '11111111-1111-4111-8111-111111111111';
const OUTRO = '22222222-2222-4222-8222-222222222222';
const T1 = '33333333-3333-4333-8333-333333333333';
const K1 = '44444444-4444-4444-8444-444444444444';

function montar(regras: { match: string; rows?: any[] }[]) {
  const consultas: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      const r = regras.find((x) => sql.includes(x.match));
      const rows = r?.rows ?? [];
      return { rows, rowCount: rows.length };
    }),
  };
  return { client, consultas };
}
const erros = async (o: object) => (await validate(o)).map((e) => e.property);

describe('status de espera (D2)', () => {
  it('os 9 estados; os 3 novos + awaiting_review são "espera" e todos abertos', () => {
    expect(TAREFA_STATUS).toHaveLength(9);
    expect([...ESPERA].sort()).toEqual(['awaiting_client', 'awaiting_efficacy', 'awaiting_execution', 'awaiting_review']);
    for (const s of ESPERA) expect(ABERTAS).toContain(s);
    expect(ABERTAS).not.toContain('completed');
    expect(ABERTAS).not.toContain('cancelled');
  });

  it('matriz: entre abertos é livre (exceto o mesmo estado)', () => {
    for (const de of ABERTAS) for (const para of ABERTAS) expect({ de, para, ok: transicaoPermitida(de, para) }).toEqual({ de, para, ok: de !== para });
  });

  it('concluir só de in_progress ou espera; cancelar de qualquer aberto', () => {
    for (const de of ABERTAS) {
      expect(transicaoPermitida(de, 'cancelled')).toBe(true);
      expect(transicaoPermitida(de, 'completed')).toBe(de === 'in_progress' || ESPERA.includes(de));
    }
  });

  it('completed/cancelled são finais: nenhuma saída além da reabertura documentada', () => {
    const de = (s: any) => TAREFA_STATUS.filter((p) => transicaoPermitida(s, p));
    expect(de('completed')).toEqual(['in_progress']);
    expect(de('cancelled')).toEqual(['pending']);
  });

  it('DTO de status e filtro de listagem aceitam os novos valores e recusam outros', async () => {
    for (const status of ['awaiting_client', 'awaiting_execution', 'awaiting_efficacy']) {
      expect(await erros(plainToInstance(ChangeTarefaStatusDto, { status }))).toEqual([]);
      expect(await erros(plainToInstance(ListTarefasQuery, { status }))).toEqual([]);
    }
    expect(await erros(plainToInstance(ChangeTarefaStatusDto, { status: 'awaiting_x' }))).toEqual(['status']);
  });

  it('mudarStatus para espera: UPDATE + evento status_changed com from/to', async () => {
    const { client, consultas } = montar([
      { match: 'FOR UPDATE', rows: [{ tenant_id: T1, status: 'in_progress' }] },
      { match: 'FROM tasks k', rows: [{ id: K1 }] },
    ]);
    await new TarefasService().mudarStatus(client, ATOR, K1, { status: 'awaiting_client' });
    const ev = consultas.find((c) => c.sql.includes('INSERT INTO task_events'))!;
    expect(ev.sql).toContain("'status_changed'");
    expect(ev.params.slice(3, 6)).toEqual(['in_progress', 'awaiting_client', null]);
  });

  it('mudarStatus de tarefa encerrada para espera => 400 sem escrita', async () => {
    const { client, consultas } = montar([{ match: 'FOR UPDATE', rows: [{ tenant_id: T1, status: 'completed' }] }]);
    await expect(new TarefasService().mudarStatus(client, ATOR, K1, { status: 'awaiting_client' })).rejects.toThrow('Transição de status não permitida');
    expect(consultas.some((c) => c.sql.includes('UPDATE tasks'))).toBe(false);
  });
});

describe('TarefasService.encaminhar', () => {
  const tarefa = (extra: any = {}) => ({ tenant_id: T1, status: 'in_progress', assignee_user_id: ATOR, ...extra });
  const sem = (c: { sql: string }[], t: string) => c.some((x) => x.sql.includes(t));

  it('feliz: UPDATE do responsável + evento assigned com from/to e nota (trim)', async () => {
    const { client, consultas } = montar([
      { match: 'FOR UPDATE', rows: [tarefa({ assignee_user_id: '55555555-5555-4555-8555-555555555555' })] },
      { match: 'list_socios() WHERE id', rows: [{ '?column?': 1 }] },
      { match: 'FROM tasks k', rows: [{ id: K1 }] },
    ]);
    const r = await new TarefasService().encaminhar(client, ATOR, K1, { assignee_user_id: OUTRO, nota: '  confere?  ' });
    expect(r.para).toBe(OUTRO);
    const ev = consultas.find((c) => c.sql.includes('INSERT INTO task_events'))!;
    expect(ev.sql).toContain("'assigned'");
    expect(ev.params.slice(3, 6)).toEqual(['55555555-5555-4555-8555-555555555555', OUTRO, 'confere?']);
  });

  it('inexistente/invisível => 404', async () => {
    const { client } = montar([]);
    await expect(new TarefasService().encaminhar(client, ATOR, K1, { assignee_user_id: OUTRO })).rejects.toThrow('Tarefa não encontrada');
  });

  it.each(['completed', 'cancelled'])('tarefa %s => 409 sem escrita', async (status) => {
    const { client, consultas } = montar([{ match: 'FOR UPDATE', rows: [tarefa({ status })] }]);
    await expect(new TarefasService().encaminhar(client, ATOR, K1, { assignee_user_id: OUTRO })).rejects.toMatchObject({ status: 409 });
    expect(sem(consultas, 'UPDATE tasks')).toBe(false);
  });

  it('para si mesmo => 400; para o responsável atual => 400; não-sócio/inativo => 400; nenhum UPDATE', async () => {
    const a = montar([{ match: 'FOR UPDATE', rows: [tarefa({ assignee_user_id: OUTRO })] }]);
    await expect(new TarefasService().encaminhar(a.client, ATOR, K1, { assignee_user_id: ATOR })).rejects.toMatchObject({ status: 400 });
    const b = montar([{ match: 'FOR UPDATE', rows: [tarefa({ assignee_user_id: OUTRO })] }]);
    await expect(new TarefasService().encaminhar(b.client, ATOR, K1, { assignee_user_id: OUTRO })).rejects.toMatchObject({ status: 400 });
    const c = montar([{ match: 'FOR UPDATE', rows: [tarefa()] }]); // list_socios vazio
    await expect(new TarefasService().encaminhar(c.client, ATOR, K1, { assignee_user_id: OUTRO })).rejects.toThrow('Responsável inválido');
    for (const x of [a, b, c]) expect(sem(x.consultas, 'UPDATE tasks')).toBe(false);
  });

  it('DTO: nota até 500; uuid obrigatório; campo extra recusado pelo pipe global (whitelist)', async () => {
    expect(await erros(plainToInstance(EncaminharTarefaDto, { assignee_user_id: OUTRO, nota: 'x'.repeat(500) }))).toEqual([]);
    expect(await erros(plainToInstance(EncaminharTarefaDto, { assignee_user_id: OUTRO, nota: 'x'.repeat(501) }))).toEqual(['nota']);
    expect(await erros(plainToInstance(EncaminharTarefaDto, { assignee_user_id: 'abc' }))).toEqual(['assignee_user_id']);
    expect(await erros(plainToInstance(EncaminharTarefaDto, {}))).toEqual(['assignee_user_id']);
  });
});

describe('InteracoesService.listarGlobal / ListInteracoesQuery', () => {
  it('consulta parametrizada: filtros, página 100, ordem desc, sem campos sensíveis', async () => {
    const { client, consultas } = montar([{ match: 'interacoes:global-lista', rows: [{ id: 'i', tenant_id: T1, empresa: 'A', type: 'visita', occurred_on: '2026-10-01', summary: 's', summary_truncado: false, created_by_name: 'X' }] }, { match: 'interacoes:global-total', rows: [{ n: 250 }] }]);
    const r = await new InteracoesService().listarGlobal(client, { tipo: 'visita', from: '2026-10-01', to: '2026-10-31', page: 3 } as any);
    const lista = consultas.find((c) => c.sql.includes('interacoes:global-lista'))!;
    expect(lista.params).toEqual([null, 'visita', '2026-10-01', '2026-10-31', 200]);
    expect(lista.sql).toContain('ORDER BY i.occurred_on DESC, i.created_at DESC, i.id DESC');
    expect(lista.sql).toContain('LIMIT 100');
    expect(lista.sql).toContain('is_montese_tenant');
    expect(lista.sql).not.toMatch(/participants|decisions|next_steps/);
    expect(r).toMatchObject({ total: 250, page: 3, page_size: 100 });
    expect(r.itens[0].href).toBe(`/atuacao/empresas/${T1}`);
  });
  it('from > to => 400; tenantId inexistente/parceiro => 404', async () => {
    const { client } = montar([]);
    await expect(new InteracoesService().listarGlobal(client, { from: '2026-10-31', to: '2026-10-01' } as any)).rejects.toMatchObject({ status: 400 });
    await expect(new InteracoesService().listarGlobal(client, { tenantId: T1 } as any)).rejects.toMatchObject({ status: 404 });
  });
  it('DTO da query valida datas reais, enum, uuid e página', async () => {
    const v = (o: object) => erros(plainToInstance(ListInteracoesQuery, o));
    expect(await v({ tenantId: T1, tipo: 'ligacao', from: '2026-02-28', to: '2026-03-01', page: '2' })).toEqual([]);
    expect(await v({ tipo: 'x' })).toEqual(['tipo']);
    expect(await v({ from: '2026-02-30' })).toEqual(['from']);
    expect(await v({ to: '01/10/2026' })).toEqual(['to']);
    expect(await v({ tenantId: 'abc' })).toEqual(['tenantId']);
    expect(await v({ page: '0' })).toEqual(['page']);
  });
});
