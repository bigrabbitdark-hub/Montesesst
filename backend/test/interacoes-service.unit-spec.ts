import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { InteracoesService } from '../src/atuacao/interacoes.service';
import { CreateInteracaoDto, UpdateInteracaoDto } from '../src/atuacao/dto/interacao.dto';

type Regra = { match: string; rows?: any[]; rowCount?: number };
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const T1 = '33333333-3333-4333-8333-333333333333';
const T2 = '66666666-6666-4666-8666-666666666666';
const E1 = '44444444-4444-4444-8444-444444444444';
const I1 = '77777777-7777-4777-8777-777777777777';

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
  return { service: new InteracoesService(), client, consultas };
}
const linha = (extra: any = {}) => ({
  id: I1, tenant_id: T1, type: 'reuniao', occurred_on: '2030-01-15', participants: null, summary: 'Resumo',
  decisions: null, next_steps: null, agenda_event_id: null, created_by: U1, created_by_name: 'Sócio', ...extra,
});
const base = { type: 'reuniao', occurred_on: '2030-01-15', summary: 'Resumo' };

describe('InteracoesService', () => {
  it('criar: tenant invisível => NotFound "Cliente não encontrado", sem INSERT', async () => {
    const { service, client, consultas } = montar([{ match: 'FROM tenants WHERE id', rows: [] }]);
    await expect(service.criar(client, U1, T1, base as any)).rejects.toThrow('Cliente não encontrado');
    expect(consultas.some((c) => c.sql.includes('INSERT'))).toBe(false);
  });

  it('criar: created_by = usuário informado pelo controller (JWT), tenant vem do caminho; editavel calculado', async () => {
    const { service, client, consultas } = montar([
      { match: 'FROM tenants WHERE id', rows: [{ id: T1 }] },
      { match: 'INSERT INTO client_interactions', rows: [{ id: I1 }] },
      { match: 'FROM client_interactions i', rows: [linha()] },
    ]);
    const r = await service.criar(client, U1, T1, base as any);
    const ins = consultas.find((c) => c.sql.includes('INSERT INTO client_interactions'))!;
    expect(ins.params).toContain(U1);
    expect(ins.params).toContain(T1);
    expect(r.editavel).toBe(true);
  });

  it('criar: agenda_event_id de outro tenant => BadRequest, sem INSERT', async () => {
    const { service, client, consultas } = montar([
      { match: 'FROM tenants WHERE id', rows: [{ id: T1 }] },
      { match: 'FROM agenda_events WHERE id', rows: [] },
    ]);
    await expect(service.criar(client, U1, T1, { ...base, agenda_event_id: E1 } as any)).rejects.toThrow('Evento de agenda inválido');
    const ev = consultas.find((c) => c.sql.includes('FROM agenda_events WHERE id'))!;
    expect(ev.params).toEqual([E1, T1]);
    expect(consultas.some((c) => c.sql.includes('INSERT'))).toBe(false);
  });

  it('listar: tenant invisível => NotFound; limite 200 e ordenação; editavel por usuário', async () => {
    const naoVe = montar([{ match: 'FROM tenants WHERE id', rows: [] }]);
    await expect(naoVe.service.listar(naoVe.client, U1, T1)).rejects.toThrow('Cliente não encontrado');

    const { service, client, consultas } = montar([
      { match: 'FROM tenants WHERE id', rows: [{ id: T1 }] },
      { match: 'FROM client_interactions i', rows: [linha(), linha({ id: 'x', created_by: U2 })] },
    ]);
    const r = await service.listar(client, U1, T1);
    expect(r.map((x) => x.editavel)).toEqual([true, false]);
    const q = consultas.find((c) => c.sql.includes('FROM client_interactions i'))!;
    expect(q.sql).toMatch(/ORDER BY i\.occurred_on DESC, i\.created_at DESC/);
    expect(q.sql).toMatch(/LIMIT 200/);
    expect(q.sql).toContain('list_socios()');
  });

  it('atualizar: 0 linhas afetadas (não é o autor) => NotFound', async () => {
    const { service, client } = montar([
      { match: 'FROM client_interactions WHERE id', rows: [{ tenant_id: T1, created_by: U2 }] },
      { match: 'UPDATE client_interactions', rows: [], rowCount: 0 },
    ]);
    await expect(service.atualizar(client, U1, I1, { summary: 'x' } as any)).rejects.toThrow('Interação não encontrada');
  });

  it('atualizar: interação invisível => NotFound; só campos enviados entram no UPDATE', async () => {
    const vazio = montar([{ match: 'FROM client_interactions WHERE id', rows: [] }]);
    await expect(vazio.service.atualizar(vazio.client, U1, I1, { summary: 'x' } as any)).rejects.toThrow('Interação não encontrada');

    const { service, client, consultas } = montar([
      { match: 'FROM client_interactions WHERE id', rows: [{ tenant_id: T1, created_by: U1 }] },
      { match: 'UPDATE client_interactions', rows: [{ id: I1 }] },
      { match: 'FROM client_interactions i', rows: [linha({ summary: 'Novo' })] },
    ]);
    const r = await service.atualizar(client, U1, I1, { summary: 'Novo', decisions: undefined } as any);
    expect(r.campos).toEqual(['summary']);
    const up = consultas.find((c) => c.sql.includes('UPDATE client_interactions'))!;
    expect(up.sql).toContain('summary');
    expect(up.sql).not.toContain('decisions');
    expect(up.sql).toContain('created_by');
  });

  it('atualizar: agenda_event_id validado contra o tenant da própria interação', async () => {
    const { service, client, consultas } = montar([
      { match: 'FROM client_interactions WHERE id', rows: [{ tenant_id: T2, created_by: U1 }] },
      { match: 'FROM agenda_events WHERE id', rows: [] },
    ]);
    await expect(service.atualizar(client, U1, I1, { agenda_event_id: E1 } as any)).rejects.toThrow('Evento de agenda inválido');
    expect(consultas.find((c) => c.sql.includes('FROM agenda_events WHERE id'))!.params).toEqual([E1, T2]);
    expect(consultas.some((c) => c.sql.includes('UPDATE'))).toBe(false);
  });
});

describe('DTOs de interação', () => {
  const v = async (cls: any, o: any) => (await validate(plainToInstance(cls, o), { whitelist: true, forbidNonWhitelisted: true })).length;

  it('criação: válido, futuro aceito, inválidos rejeitados', async () => {
    expect(await v(CreateInteracaoDto, base)).toBe(0);
    expect(await v(CreateInteracaoDto, { ...base, occurred_on: '2099-12-31' })).toBe(0);
    for (const o of [
      { ...base, occurred_on: '2026-02-30' }, { ...base, summary: '   ' }, { ...base, summary: '' },
      { ...base, summary: 'a'.repeat(4001) }, { ...base, type: 'festa' }, { ...base, created_by: U1 },
      { ...base, tenant_id: T1 }, { ...base, agenda_event_id: 'x' },
    ]) expect(await v(CreateInteracaoDto, o)).toBeGreaterThan(0);
  });

  it('summary recebe trim', () => {
    expect(plainToInstance(CreateInteracaoDto, { ...base, summary: '  oi  ' }).summary).toBe('oi');
  });

  it('PATCH: ausente ok; null em qualquer campo => erro', async () => {
    expect(await v(UpdateInteracaoDto, {})).toBe(0);
    expect(await v(UpdateInteracaoDto, { summary: 'novo' })).toBe(0);
    for (const c of ['type', 'occurred_on', 'summary', 'participants', 'decisions', 'next_steps', 'agenda_event_id'])
      expect(await v(UpdateInteracaoDto, { [c]: null })).toBeGreaterThan(0);
    expect(await v(UpdateInteracaoDto, { summary: '   ' })).toBeGreaterThan(0);
    expect(await v(UpdateInteracaoDto, { created_by: U1 })).toBeGreaterThan(0);
  });
});
