import { AtuacaoService } from '../src/atuacao/atuacao.service';
import { TarefasService } from '../src/atuacao/tarefas.service';
import { AgendaService } from '../src/atuacao/agenda.service';
import { PainelService } from '../src/atuacao/painel/painel.service';
import { Logger } from '@nestjs/common';

const HOJE = '2026-10-29';
const USER = '11111111-1111-4111-8111-111111111111';
const T1 = '22222222-2222-4222-8222-222222222222';
const T2 = '33333333-3333-4333-8333-333333333333';

const TODAS = ['clients.read', 'tasks.read', 'appointments.manage', 'empresas.read', 'documents.read'];

type Resp = Record<string, any[] | Error>;

// Cliente falso: devolve linhas conforme um trecho do SQL (as consultas novas levam /* painel:... */).
function montar(permissoes: string[], resp: Resp = {}) {
  const consultas: { sql: string; params: any[] }[] = [];
  const base: Resp = {
    'FROM socio_permissions': permissoes.map((permission) => ({ permission })),
    'FROM tenants t': [{ id: T1, name: 'A', has_authorized: true, has_recent_pending: false, has_lapsed: false }],
    'FROM tasks WHERE assignee_user_id': [{ abertas: 4, vencidas: 2, hoje: 1, bloqueadas: 0, aguardando_cliente: 1, aguardando_avaliacao: 2, aguardando_execucao: 0, aguardando_eficacia: 3 }],
    'FROM tasks k': [],
    'FROM agenda_events e': [],
    'painel:tarefas-aguardando': [],
    'painel:doc-contagem': [{ vencidos: 3, vence_7: 1, vence_15: 2, vence_30: 5 }],
    'painel:doc-pendentes': [],
    'painel:rascunhos-contagem': [{ n: 6, em_revisao: 3, para_assinar: 2, para_entregar: 1 }],
    'painel:rascunhos-lista': [],
    ...resp,
  };
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      if (/^(SAVEPOINT|RELEASE|ROLLBACK TO)/.test(sql.trim())) return { rows: [], rowCount: 0 };
      const chave = Object.keys(base).find((k) => sql.includes(k));
      const v = chave ? base[chave] : [];
      if (v instanceof Error) throw v;
      return { rows: v, rowCount: v.length };
    }),
  };
  const empresas: any = { exigirEmpresa: jest.fn(async () => ({})) };
  const service = new PainelService(new AtuacaoService(), new TarefasService(), new AgendaService(), empresas);
  const dados = () => consultas.filter((c) => !/^(SAVEPOINT|RELEASE|ROLLBACK TO)/.test(c.sql.trim()));
  return { service, client, consultas, dados, empresas };
}

describe('PainelService.painel', () => {
  beforeEach(() => { jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); });
  afterEach(() => jest.restoreAllMocks());

  it('com todas as permissões devolve todos os blocos no contrato', async () => {
    const { service, client } = montar(TODAS);
    const p = await service.painel(client, USER, HOJE);
    expect(Object.keys(p).sort()).toEqual(['agenda', 'documentos', 'empresas', 'gerado_em', 'indisponiveis', 'pendencias', 'tarefas']);
    expect(p.empresas).toEqual({ acessiveis: 1 });
    expect(p.tarefas).toEqual({
      abertas: 4, vencidas: 2, hoje: 1, bloqueadas: 0,
      aguardando_cliente: 1, aguardando_avaliacao: 2, aguardando_execucao: 0, aguardando_eficacia: 3,
    });
    expect(p.documentos).toEqual({ vencidos: 3, vence_7: 1, vence_15: 2, vence_30: 5, aguardando_acao: 6, etapas: { em_revisao: 3, para_assinar: 2, para_entregar: 1 } });
    expect(p.agenda).toEqual({ hoje: [], hoje_total: 0, proximos_7_dias: 0 });
    expect(p.indisponiveis).toEqual([]);
    expect(new Date(p.gerado_em).toISOString()).toBe(p.gerado_em);
  });

  it('só clients.read: demais blocos null, sem consultar tarefas/agenda/documentos', async () => {
    const { service, client, dados } = montar(['clients.read']);
    const p = await service.painel(client, USER, HOJE);
    expect(p.empresas).toEqual({ acessiveis: 1 });
    expect(p.tarefas).toBeNull();
    expect(p.agenda).toBeNull();
    expect(p.documentos).toBeNull();
    expect(p.pendencias).toEqual([]);
    expect(p.indisponiveis).toEqual([]); // sem permissão ≠ indisponível
    const sqls = dados().map((c) => c.sql).join('\n');
    expect(sqls).not.toMatch(/FROM tasks|agenda_events|FROM documents|document_drafts/);
  });

  it('cada permissão libera só o seu bloco', async () => {
    const so = async (perm: string) => {
      const { service, client } = montar([perm]);
      return service.painel(client, USER, HOJE);
    };
    expect((await so('tasks.read')).tarefas).not.toBeNull();
    expect((await so('tasks.read')).agenda).toBeNull();
    expect((await so('appointments.manage')).agenda).not.toBeNull();
    expect((await so('appointments.manage')).tarefas).toBeNull();
    expect((await so('clients.read')).empresas).not.toBeNull();
    expect((await so('tasks.read')).empresas).toBeNull();
    // documentos: cada campo depende da sua permissão
    expect((await so('empresas.read')).documentos).toEqual({ vencidos: 3, vence_7: 1, vence_15: 2, vence_30: 5, aguardando_acao: null, etapas: null });
    expect((await so('documents.read')).documentos).toEqual({ vencidos: null, vence_7: null, vence_15: null, vence_30: null, aguardando_acao: 6, etapas: { em_revisao: 3, para_assinar: 2, para_entregar: 1 } });
  });

  it('agenda: hoje limitado a 10, mapeia o contrato e usa o dia injetado', async () => {
    const evs = Array.from({ length: 14 }, (_, i) => ({
      id: `e${i}`, tenant_id: T1, tenant_name: 'Empresa A', owner_user_id: USER, owner_name: 'X', type: 'visita',
      title: `Visita ${i}`, event_date: HOJE, start_time: i % 2 ? '09:00' : null, end_time: null, status: 'agendado',
    }));
    const { service, client, dados } = montar(['appointments.manage'], { 'FROM agenda_events e': evs });
    const p = await service.painel(client, USER, HOJE);
    expect(p.agenda!.hoje).toHaveLength(10);
    expect(p.agenda!.hoje_total).toBe(14);
    expect(p.agenda!.hoje[0]).toEqual({
      id: 'e0', titulo: 'Visita 0', tipo: 'visita', data: HOJE, hora: null, tenant_id: T1, empresa: 'Empresa A', status: 'agendado',
    });
    expect(p.agenda!.hoje[1].hora).toBe('09:00');
    expect(p.agenda!.proximos_7_dias).toBe(14);
    const ag = dados().filter((c) => c.sql.includes('FROM agenda_events e'));
    expect(ag).toHaveLength(2);
    expect(ag[0].params).toContain(HOJE);
    expect(ag[1].params).toEqual(expect.arrayContaining(['2026-10-30', '2026-11-05', 'agendado']));
  });

  it('documentos: contagens vêm de UMA consulta parametrizada com o dia injetado', async () => {
    const { service, client, dados } = montar(['empresas.read']);
    await service.painel(client, USER, HOJE);
    const q = dados().filter((c) => c.sql.includes('painel:doc-contagem'));
    expect(q).toHaveLength(1);
    expect(q[0].params).toEqual([HOJE]);
    expect(q[0].sql).toContain('expires_at IS NOT NULL');
    expect(q[0].sql).toContain("category <> 'cadastro_funcionarios'");
  });

  it('pendencias: união ordenada, <= 20, determinística e com href relativo', async () => {
    const tarefas = Array.from({ length: 12 }, (_, i) => ({
      id: `k${String(i).padStart(2, '0')}`, tenant_id: T1, tenant_name: 'Empresa A', title: `Tarefa ${i}`, priority: 'alta',
      status: 'pending', due_date: `2026-10-${String(10 + (i % 3)).padStart(2, '0')}`, vencida: true,
    }));
    const docs = Array.from({ length: 15 }, (_, i) => ({
      id: `d${String(i).padStart(2, '0')}`, tenant_id: T2, empresa: 'Empresa B', title: `Doc ${i}`, category: 'pgr',
      expires_at: `2026-11-${String(1 + i).padStart(2, '0')}`, dias: 3 + i - (i < 3 ? 20 : 0),
    }));
    const rasc = [{ id: 'r1', tenant_id: T1, empresa: 'Empresa A', title: 'Rascunho', status: 'em_revisao', updated_at: '2026-10-28T10:00:00.000Z' }];
    const resp = { 'FROM tasks k': tarefas, 'painel:doc-pendentes': docs, 'painel:rascunhos-lista': rasc };
    const m0 = montar(TODAS, resp);
    const a = await m0.service.painel(m0.client, USER, HOJE);
    const m = montar(TODAS, resp);
    const b = await m.service.painel(m.client, USER, HOJE);
    expect(a.pendencias.length).toBeLessThanOrEqual(20);
    expect(a.pendencias).toHaveLength(20);
    expect(a.pendencias).toEqual(b.pendencias); // determinístico
    for (const x of a.pendencias) {
      expect(x.href).toMatch(/^\/atuacao\/[a-z0-9\-/?=&]*$/i);
      expect(x.href).not.toMatch(/\/\/|https?:/);
    }
    // vencidos (tarefa atrasada / documento vencido) antes de vencendo e de aguardando
    const grupos = a.pendencias.map((x) => x.tipo);
    const ult = (t: string) => grupos.lastIndexOf(t as any);
    const pri = (t: string) => grupos.indexOf(t as any);
    expect(ult('tarefa_atrasada')).toBeLessThan(pri('documento_vencendo'));
    expect(ult('documento_vencido')).toBeLessThan(pri('documento_vencendo'));
    // dentro das tarefas: prazo crescente
    const prazos = a.pendencias.filter((x) => x.tipo === 'tarefa_atrasada').map((x) => x.prazo);
    expect([...prazos].sort()).toEqual(prazos);
    const t0 = a.pendencias.find((x) => x.tipo === 'tarefa_atrasada')!;
    expect(t0.href).toBe('/atuacao/tarefas?vencidas=true');
    expect(t0.prioridade).toBe('alta');
    const dv = a.pendencias.find((x) => x.tipo === 'documento_vencido')!;
    expect(dv.href).toBe('/atuacao/vencimentos?faixa=vencidos');
    expect(dv.prioridade).toBeNull();
  });

  it('pendencia de documento aguardando aponta para a tela do rascunho; vencendo usa a faixa certa', async () => {
    const docs = [
      { id: 'a', tenant_id: T2, empresa: 'B', title: 'x', category: 'pgr', expires_at: '2026-10-29', dias: 0 },
      { id: 'b', tenant_id: T2, empresa: 'B', title: 'x', category: 'pgr', expires_at: '2026-11-05', dias: 7 },
      { id: 'c', tenant_id: T2, empresa: 'B', title: 'x', category: 'pgr', expires_at: '2026-11-06', dias: 8 },
      { id: 'd', tenant_id: T2, empresa: 'B', title: 'x', category: 'pgr', expires_at: '2026-11-13', dias: 15 },
      { id: 'e', tenant_id: T2, empresa: 'B', title: 'x', category: 'pgr', expires_at: '2026-11-14', dias: 16 },
      { id: 'f', tenant_id: T2, empresa: 'B', title: 'x', category: 'pgr', expires_at: '2026-11-28', dias: 30 },
      { id: 'g', tenant_id: T2, empresa: 'B', title: 'x', category: 'pgr', expires_at: '2026-10-28', dias: -1 },
    ];
    const rasc = [{ id: 'r1', tenant_id: T1, empresa: 'A', title: 'R', status: 'assinado', updated_at: '2026-10-28T10:00:00.000Z' }];
    const { service, client } = montar(TODAS, { 'painel:doc-pendentes': docs, 'painel:rascunhos-lista': rasc });
    const p = await service.painel(client, USER, HOJE);
    const hrefs = p.pendencias.filter((x) => x.tipo.startsWith('documento_venc')).map((x) => [x.tipo, x.href]);
    expect(hrefs).toEqual([
      ['documento_vencido', '/atuacao/vencimentos?faixa=vencidos'],
      ['documento_vencendo', '/atuacao/vencimentos?faixa=7'],
      ['documento_vencendo', '/atuacao/vencimentos?faixa=7'],
      ['documento_vencendo', '/atuacao/vencimentos?faixa=15'],
      ['documento_vencendo', '/atuacao/vencimentos?faixa=15'],
      ['documento_vencendo', '/atuacao/vencimentos?faixa=30'],
      ['documento_vencendo', '/atuacao/vencimentos?faixa=30'],
    ]);
    // pelo menos 1 aguardando, com href do rascunho
    const ag = p.pendencias.find((x) => x.tipo === 'documento_aguardando')!;
    expect(ag.href).toBe('/atuacao/documentos/r1');
    expect(ag.tenant_id).toBe(T1);
  });

  it('isolamento: erro em um bloco => esse bloco null, os demais seguem, log sem detalhe sensível', async () => {
    const erro = Object.assign(new Error('relation "tasks" SECRET-DETAIL cpf 123'), { code: '42P01' });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, client, consultas } = montar(TODAS, { 'FROM tasks WHERE assignee_user_id': erro, 'FROM tasks k': erro });
    const p = await service.painel(client, USER, HOJE);
    expect(p.tarefas).toBeNull();
    expect(p.indisponiveis).toEqual(['tarefas']);
    expect(p.empresas).toEqual({ acessiveis: 1 });
    expect(p.agenda).not.toBeNull();
    expect(p.documentos).not.toBeNull();
    // cada bloco roda sob SAVEPOINT; o que falhou foi revertido ao savepoint
    expect(consultas.some((c) => /^ROLLBACK TO SAVEPOINT/.test(c.sql.trim()))).toBe(true);
    const logado = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logado).toContain('tarefas');
    expect(logado).not.toContain('SECRET-DETAIL');
    expect(logado).not.toContain('cpf');
  });

  it('documentos: falha total do bloco permitido ⇒ listado em indisponiveis', async () => {
    const { service, client } = montar(['empresas.read'], { 'painel:doc-contagem': new Error('x') });
    const p = await service.painel(client, USER, HOJE);
    expect(p.documentos).toBeNull();
    expect(p.indisponiveis).toEqual(['documentos']);
  });

  it('erro em sub-consulta de documentos zera só o campo afetado', async () => {
    const { service, client } = montar(TODAS, { 'painel:rascunhos-contagem': new Error('x') });
    const p = await service.painel(client, USER, HOJE);
    expect(p.documentos).toEqual({ vencidos: 3, vence_7: 1, vence_15: 2, vence_30: 5, aguardando_acao: null, etapas: null });
  });

  it('falha ao ler permissões propaga (falha fechada)', async () => {
    const { service, client } = montar(TODAS, { 'FROM socio_permissions': new Error('db down') });
    await expect(service.painel(client, USER, HOJE)).rejects.toThrow();
  });

  it('desempenho: número de consultas não depende do volume de linhas (sem N+1)', async () => {
    const mk = (n: number) => ({
      'FROM tasks k': Array.from({ length: n }, (_, i) => ({ id: `k${i}`, tenant_id: T1, tenant_name: 'A', title: 't', priority: 'media', status: 'pending', due_date: '2026-10-01', vencida: true })),
      'painel:doc-pendentes': Array.from({ length: n }, (_, i) => ({ id: `d${i}`, tenant_id: T2, empresa: 'B', title: 't', category: 'pgr', expires_at: '2026-10-01', dias: -28 })),
      'painel:rascunhos-lista': Array.from({ length: n }, (_, i) => ({ id: `r${i}`, tenant_id: T1, empresa: 'A', title: 't', status: 'em_revisao', updated_at: '2026-10-01T00:00:00Z' })),
      'FROM agenda_events e': Array.from({ length: n }, (_, i) => ({ id: `e${i}`, tenant_id: T1, tenant_name: 'A', type: 'visita', title: 't', event_date: HOJE, start_time: null, status: 'agendado' })),
    });
    const a = montar(TODAS, mk(1));
    await a.service.painel(a.client, USER, HOJE);
    const b = montar(TODAS, mk(50));
    await b.service.painel(b.client, USER, HOJE);
    expect(b.consultas.length).toBe(a.consultas.length);
    expect(a.dados().length).toBeLessThanOrEqual(14);
  });
});

describe('PainelService.vencimentos', () => {
  const linha = (i: number, dias: number) => ({
    documento_id: `d${i}`, tenant_id: T2, empresa: 'Empresa B', titulo: 'PGR', categoria: 'pgr', expires_at: '2026-11-01', dias,
  });

  it('devolve itens com href relativo da empresa e total', async () => {
    const { service, client } = montar(['empresas.read', 'clients.read'], {
      'painel:vencimentos-lista': [linha(1, 3), linha(2, -2)], 'painel:vencimentos-total': [{ n: 2 }],
    });
    const r = await service.vencimentos(client, {}, HOJE);
    expect(r.total).toBe(2);
    expect(r.itens[0]).toEqual({
      documento_id: 'd1', tenant_id: T2, empresa: 'Empresa B', titulo: 'PGR', categoria: 'pgr', expires_at: '2026-11-01', dias: 3,
      href: `/atuacao/empresas/${T2}`,
    });
  });

  it('faixas: condição SQL cumulativa por faixa, sempre com expires_at não nulo e sem cadastro_funcionarios', async () => {
    const cond: Record<string, RegExp> = {
      vencidos: /expires_at < \$1::date/,
      '7': /expires_at >= \$1::date AND d\.expires_at <= \$1::date \+ 7\b/,
      '15': /expires_at <= \$1::date \+ 15\b/,
      '30': /expires_at <= \$1::date \+ 30\b/,
    };
    for (const [faixa, re] of Object.entries(cond)) {
      const { service, client, dados } = montar([], { 'painel:vencimentos-total': [{ n: 0 }] });
      await service.vencimentos(client, { faixa: faixa as any }, HOJE);
      const q = dados().find((c) => c.sql.includes('painel:vencimentos-lista'))!;
      expect(q.sql).toMatch(re);
      expect(q.sql).toContain('expires_at IS NOT NULL');
      expect(q.sql).toContain("category <> 'cadastro_funcionarios'");
      expect(q.params[0]).toBe(HOJE);
    }
  });

  it('paginação: LIMIT 100 e OFFSET por página; ordenado por expires_at com desempate', async () => {
    const { service, client, dados } = montar([], { 'painel:vencimentos-total': [{ n: 0 }] });
    await service.vencimentos(client, { page: 3 }, HOJE);
    const q = dados().find((c) => c.sql.includes('painel:vencimentos-lista'))!;
    expect(q.sql).toMatch(/ORDER BY d\.expires_at, d\.title, d\.id/);
    expect(q.sql).toMatch(/LIMIT 100/);
    expect(q.params).toContain(200);
  });

  it('tenantId: valida a empresa na carteira (404 propaga) antes de consultar documentos', async () => {
    const { service, client, empresas, dados } = montar([]);
    empresas.exigirEmpresa.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 404 }));
    await expect(service.vencimentos(client, { tenantId: T2 }, HOJE)).rejects.toMatchObject({ status: 404 });
    expect(dados().some((c) => c.sql.includes('painel:vencimentos'))).toBe(false);
    expect(empresas.exigirEmpresa).toHaveBeenCalledWith(client, T2);
  });
});

describe('PainelService — pendências tarefa_aguardando', () => {
  beforeEach(() => { jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined); });
  afterEach(() => jest.restoreAllMocks());

  it('inclui tarefas em espera com href por status, ordenadas por prazo (sem prazo por último) e id; só com tasks.read', async () => {
    const linha = (id: string, status: string, due: string | null) => ({ id, tenant_id: T1, empresa: 'A', title: `T ${id}`, priority: 'media', status, due_date: due });
    const { service, client, dados } = montar(['tasks.read'], {
      'painel:tarefas-aguardando': [
        linha('b', 'awaiting_client', '2026-11-02'), linha('a', 'awaiting_efficacy', '2026-11-02'), linha('c', 'awaiting_review', null),
      ],
    });
    const p = await service.painel(client, USER, HOJE);
    const aguard = p.pendencias.filter((x) => x.tipo === 'tarefa_aguardando');
    expect(aguard.map((x) => x.descricao)).toEqual(['T a', 'T b', 'T c']);
    expect(aguard.map((x) => x.href)).toEqual([
      '/atuacao/tarefas?status=awaiting_efficacy', '/atuacao/tarefas?status=awaiting_client', '/atuacao/tarefas?status=awaiting_review',
    ]);
    expect(aguard[2].prazo).toBeNull();
    const q = dados().find((c) => c.sql.includes('painel:tarefas-aguardando'))!;
    expect(q.params[0]).toBe(USER);
    expect(q.params[2]).toBe(HOJE);
    expect(q.sql).toContain('LIMIT 20');
  });

  it('sem tasks.read nem consulta nem pendência; teto de 20 respeitado', async () => {
    const sem = montar(['clients.read']);
    await sem.service.painel(sem.client, USER, HOJE);
    expect(sem.dados().some((c) => c.sql.includes('painel:tarefas-aguardando'))).toBe(false);
    const muitas = Array.from({ length: 20 }, (_, i) => ({ id: `i${String(i).padStart(2, '0')}`, tenant_id: T1, empresa: 'A', title: 't', priority: 'media', status: 'awaiting_client', due_date: null }));
    const m = montar(['tasks.read', 'empresas.read'], {
      'painel:tarefas-aguardando': muitas,
      'painel:doc-pendentes': [{ id: 'd', tenant_id: T1, empresa: 'A', title: 'doc', category: 'pgr', expires_at: '2026-10-01', dias: -28 }],
    });
    const p = await m.service.painel(m.client, USER, HOJE);
    expect(p.pendencias).toHaveLength(20);
    expect(p.pendencias[0].tipo).toBe('documento_vencido'); // urgência: vencido antes de espera
  });
});
