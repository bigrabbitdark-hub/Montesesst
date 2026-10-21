import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AgendaService } from '../src/atuacao/agenda.service';
import { CreateAgendaDto, ListAgendaQuery, UpdateAgendaDto } from '../src/atuacao/dto/agenda.dto';
import { TarefasService } from '../src/atuacao/tarefas.service';
import { CreateTarefaDto } from '../src/atuacao/dto/tarefa.dto';

type Regra = { match: string; rows?: any[]; rowCount?: number };
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const T1 = '33333333-3333-4333-8333-333333333333';
const E1 = '44444444-4444-4444-8444-444444444444';
const UN = '55555555-5555-4555-8555-555555555555';

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
  return { service: new AgendaService(), client, consultas };
}
const evento = (extra: any = {}) => ({
  id: E1, tenant_id: T1, owner_user_id: U1, status: 'agendado', event_date: '2030-01-15', start_time: '10:00', end_time: '11:00', ...extra,
});
const base = { tenant_id: T1, type: 'reuniao', title: 'Reunião', event_date: '2030-01-15' };

describe('AgendaService', () => {
  const regrasCriar = (extra: Regra[] = []): Regra[] => [
    ...extra,
    { match: 'FROM tenants WHERE id', rows: [{ id: T1 }] },
    { match: 'FROM list_socios() WHERE id', rows: [{ x: 1 }] },
    { match: 'INSERT INTO agenda_events', rows: [{ id: E1 }] },
    { match: 'FROM agenda_events e', rows: [evento()] },
  ];

  it('criar: tenant invisível => NotFound "Cliente não encontrado", sem INSERT', async () => {
    const { service, client, consultas } = montar([{ match: 'FROM tenants WHERE id', rows: [] }]);
    await expect(service.criar(client, U1, base as any)).rejects.toThrow('Cliente não encontrado');
    expect(consultas.some((c) => c.sql.includes('INSERT'))).toBe(false);
  });

  it('criar: responsável padrão = usuário do JWT, validado em list_socios; created_by = JWT', async () => {
    const { service, client, consultas } = montar(regrasCriar());
    await service.criar(client, U1, base as any);
    const ins = consultas.find((c) => c.sql.includes('INSERT INTO agenda_events'))!;
    expect(ins.params[1]).toBe(U1); // owner
    expect(ins.params[2]).toBe(U1); // created_by
    expect(consultas.some((c) => c.sql.includes('list_socios() WHERE id') && c.params[0] === U1)).toBe(true);
  });

  it('criar: responsável informado fora de list_socios => "Responsável inválido"', async () => {
    const { service, client, consultas } = montar([
      { match: 'FROM tenants WHERE id', rows: [{ id: T1 }] },
      { match: 'list_socios() WHERE id', rows: [] },
    ]);
    await expect(service.criar(client, U1, { ...base, owner_user_id: U2 } as any)).rejects.toThrow('Responsável inválido');
    expect(consultas.some((c) => c.sql.includes('INSERT'))).toBe(false);
  });

  it('criar: end_time <= start_time => BadRequest, sem INSERT', async () => {
    for (const [s, e] of [['10:00', '10:00'], ['10:00', '09:00']]) {
      const { service, client, consultas } = montar(regrasCriar());
      await expect(service.criar(client, U1, { ...base, start_time: s, end_time: e } as any)).rejects.toThrow();
      expect(consultas.some((c) => c.sql.includes('INSERT'))).toBe(false);
    }
  });

  it('criar: unidade de outro tenant => BadRequest, sem INSERT; da mesma tenant passa', async () => {
    const { service, client, consultas } = montar(regrasCriar([{ match: 'FROM company_units', rows: [] }]));
    await expect(service.criar(client, U1, { ...base, company_unit_id: UN } as any)).rejects.toThrow('Unidade inválida');
    expect(consultas.some((c) => c.sql.includes('INSERT'))).toBe(false);
    const ok = montar(regrasCriar([{ match: 'FROM company_units', rows: [{ x: 1 }] }]));
    await ok.service.criar(ok.client, U1, { ...base, company_unit_id: UN } as any);
    const q = ok.consultas.find((c) => c.sql.includes('FROM company_units'))!;
    expect(q.params).toEqual([UN, T1]);
  });

  it('atualizar: só campos da allowlist, com FOR UPDATE; reagendar detectado', async () => {
    const { service, client, consultas } = montar([
      { match: 'FROM agenda_events WHERE id', rows: [evento()] },
      { match: 'FROM agenda_events e', rows: [evento({ start_time: '14:00' })] },
    ]);
    const r = await service.atualizar(client, E1, { start_time: '14:00', end_time: '15:00', status: 'concluido', tenant_id: T1 } as any);
    expect(consultas[0].sql).toContain('FOR UPDATE');
    const upd = consultas.find((c) => c.sql.includes('UPDATE agenda_events'))!;
    expect(upd.sql).not.toContain('status');
    expect(upd.sql).not.toContain('tenant_id');
    expect(upd.sql).toContain('start_time');
    expect(r.reagendado).toBe(true);
  });

  it('atualizar: mudar só o título não é reagendamento; mesma data/hora também não', async () => {
    const { service, client } = montar([
      { match: 'FROM agenda_events WHERE id', rows: [evento()] },
      { match: 'FROM agenda_events e', rows: [evento()] },
    ]);
    expect((await service.atualizar(client, E1, { title: 'Novo', event_date: '2030-01-15', start_time: '10:00' } as any)).reagendado).toBe(false);
  });

  it('atualizar: evento encerrado => BadRequest "Evento encerrado", sem UPDATE', async () => {
    for (const status of ['concluido', 'cancelado']) {
      const { service, client, consultas } = montar([{ match: 'FROM agenda_events WHERE id', rows: [evento({ status })] }]);
      await expect(service.atualizar(client, E1, { title: 'x' } as any)).rejects.toThrow('Evento encerrado');
      expect(consultas.some((c) => c.sql.includes('UPDATE agenda_events'))).toBe(false);
    }
  });

  it('atualizar: horário resultante inválido (usa o valor atual do banco) => BadRequest', async () => {
    const { service, client, consultas } = montar([{ match: 'FROM agenda_events WHERE id', rows: [evento()] }]);
    await expect(service.atualizar(client, E1, { end_time: '09:00' } as any)).rejects.toThrow();
    expect(consultas.some((c) => c.sql.includes('UPDATE agenda_events'))).toBe(false);
  });

  it('atualizar: inexistente => NotFound', async () => {
    const { service, client } = montar([{ match: 'FROM agenda_events WHERE id', rows: [] }]);
    await expect(service.atualizar(client, E1, { title: 'x' } as any)).rejects.toThrow('Evento não encontrado');
  });

  it('atualizar: novo responsável é validado em list_socios; unidade usa o tenant do evento', async () => {
    const a = montar([{ match: 'FROM agenda_events WHERE id', rows: [evento()] }, { match: 'list_socios() WHERE id', rows: [] }]);
    await expect(a.service.atualizar(a.client, E1, { owner_user_id: U2 } as any)).rejects.toThrow('Responsável inválido');
    const b = montar([{ match: 'FROM agenda_events WHERE id', rows: [evento()] }, { match: 'FROM company_units', rows: [] }]);
    await expect(b.service.atualizar(b.client, E1, { company_unit_id: UN } as any)).rejects.toThrow('Unidade inválida');
    expect(b.consultas.find((c) => c.sql.includes('FROM company_units'))!.params).toEqual([UN, T1]);
  });

  it('mudarStatus: concluir grava outcome_note; FOR UPDATE', async () => {
    const { service, client, consultas } = montar([
      { match: 'FROM agenda_events WHERE id', rows: [evento()] },
      { match: 'FROM agenda_events e', rows: [evento({ status: 'concluido' })] },
    ]);
    await service.mudarStatus(client, E1, { status: 'concluido', note: '  feito  ' } as any);
    expect(consultas[0].sql).toContain('FOR UPDATE');
    const upd = consultas.find((c) => c.sql.includes('UPDATE agenda_events'))!;
    expect(upd.params).toEqual([E1, 'concluido', 'feito']);
  });

  it('mudarStatus: cancelar sem nota => BadRequest; transição ilegal => BadRequest; sem UPDATE', async () => {
    const a = montar([{ match: 'FROM agenda_events WHERE id', rows: [evento()] }]);
    await expect(a.service.mudarStatus(a.client, E1, { status: 'cancelado', note: '   ' } as any)).rejects.toThrow('Informe o motivo');
    expect(a.consultas.some((c) => c.sql.includes('UPDATE agenda_events'))).toBe(false);
    const b = montar([{ match: 'FROM agenda_events WHERE id', rows: [evento({ status: 'cancelado' })] }]);
    await expect(b.service.mudarStatus(b.client, E1, { status: 'concluido' } as any)).rejects.toThrow('Transição de status não permitida');
    expect(b.consultas.some((c) => c.sql.includes('UPDATE agenda_events'))).toBe(false);
  });

  it('listar: filtra no SQL, owner=me usa o usuário, LIMIT 300 depois do WHERE', async () => {
    const { service, client, consultas } = montar([{ match: 'FROM agenda_events e', rows: [] }]);
    await service.listar(client, U1, { from: '2030-01-01', to: '2030-01-31', status: 'agendado', tenantId: T1, owner: 'me' });
    const q = consultas[0];
    expect(q.params).toEqual(expect.arrayContaining(['2030-01-01', '2030-01-31', 'agendado', T1, U1]));
    expect(q.sql.indexOf('WHERE')).toBeGreaterThan(-1);
    expect(q.sql.indexOf('WHERE')).toBeLessThan(q.sql.indexOf('ORDER BY'));
    expect(q.sql.indexOf('ORDER BY')).toBeLessThan(q.sql.indexOf('LIMIT 300'));
  });

  it('listar: to < from e owner inválido => BadRequest sem consultar', async () => {
    const a = montar([]);
    await expect(a.service.listar(a.client, U1, { from: '2030-02-01', to: '2030-01-01' })).rejects.toThrow();
    await expect(a.service.listar(a.client, U1, { owner: 'x' })).rejects.toThrow('Responsável inválido');
    expect(a.consultas).toHaveLength(0);
  });
});

describe('DTOs da agenda', () => {
  const erros = async (cls: any, o: any) => (await validate(plainToInstance(cls, o), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);
  it('create: válido; created_by no corpo, hora/data/https inválidos => erro', async () => {
    expect(await erros(CreateAgendaDto, { ...base, meeting_link: 'https://meet.example.com/x', start_time: '09:30' })).toEqual([]);
    expect(await erros(CreateAgendaDto, { ...base, created_by: U1 })).toContain('created_by');
    expect(await erros(CreateAgendaDto, { ...base, start_time: '24:00' })).toContain('start_time');
    expect(await erros(CreateAgendaDto, { ...base, start_time: '9:30' })).toContain('start_time');
    expect(await erros(CreateAgendaDto, { ...base, event_date: '2030-02-30' })).toContain('event_date');
    expect(await erros(CreateAgendaDto, { ...base, meeting_link: 'http://x.com' })).toContain('meeting_link');
    expect(await erros(CreateAgendaDto, { ...base, title: '   ' })).toContain('title');
    expect(await erros(CreateAgendaDto, { ...base, type: 'x' })).toContain('type');
  });
  it('update: null => erro em todos os campos; ausente => ok', async () => {
    expect(await erros(UpdateAgendaDto, {})).toEqual([]);
    for (const campo of ['type', 'title', 'event_date', 'start_time', 'end_time', 'location', 'meeting_link', 'company_unit_id', 'notes', 'owner_user_id']) {
      expect(await erros(UpdateAgendaDto, { [campo]: null })).toContain(campo);
    }
  });
  it('query: datas reais', async () => {
    expect(await erros(ListAgendaQuery, { from: '2030-13-01' })).toContain('from');
    expect(await erros(ListAgendaQuery, { from: '2030-01-01', to: '2030-01-02' })).toEqual([]);
  });
  it('tarefa.dto continua rejeitando data inexistente (IsDataReal extraído)', async () => {
    const t = { tenant_id: T1, title: 'x', assignee_user_id: U1 };
    expect(await erros(CreateTarefaDto, { ...t, due_date: '2026-02-30' })).toContain('due_date');
    expect(await erros(CreateTarefaDto, { ...t, due_date: '2026-02-28' })).toEqual([]);
  });
  void TarefasService;
});
