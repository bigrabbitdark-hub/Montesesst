import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_SEED_PATH,
  ExistingRule,
  executePlan,
  formatPlan,
  parseArgs,
  planImport,
  ResolvedProvision,
  runImport,
  Seed,
  SeedRule,
  validateSeed,
} from '../db/import-normative-rules';

// Seeds SINTÉTICOS (só estrutura): o conteúdo real está em db/seed-data/normative-rules/gro-pgr.json e é validado
// contra o texto da NR-01 em gro-pgr-seed.unit-spec.ts.
function rule(over: Partial<SeedRule> = {}): SeedRule {
  return {
    rule_key: 'GRO-TESTE-A',
    area: 'gro_pgr',
    categoria: 'revisao',
    agente_ou_atividade: 'Tema de teste',
    metodo_avaliacao: 'nao_aplicavel',
    criterio: 'Critério de teste (SINTÉTICO).',
    interpretacao: '[RASCUNHO — não revisado] Interpretação de teste (SINTÉTICO).',
    exige_revisao_profissional: true,
    status: 'rascunho',
    provisions: [{ norma: 'NR-01', anexo: '', item_path: '1.5.4.4.6', papel: 'criterio', contem: 'revista a cada dois anos' }],
    ...over,
  };
}

const seedOf = (...rules: SeedRule[]): Seed => ({ schema_version: 1, descricao: 'teste', rules });

const PROV: ResolvedProvision[] = [
  { id: '00000000-0000-0000-0000-000000000001', norma: 'NR-01', anexo: '', item_path: '1.5.4.4.6', literal_text: '1.5.4.4.6 A avaliação (SINTÉTICO) deve ser revista a cada\ndois   anos.' },
  { id: '00000000-0000-0000-0000-000000000002', norma: 'NR-01', anexo: '', item_path: '1.5.4.4.6.1', literal_text: '1.5.4.4.6.1 Prazo de até 3 anos (SINTÉTICO).' },
];

function existing(over: Partial<ExistingRule> = {}): ExistingRule {
  const r = rule();
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    rule_key: r.rule_key,
    area: r.area,
    categoria: r.categoria,
    agente_ou_atividade: r.agente_ou_atividade,
    metodo_avaliacao: r.metodo_avaliacao,
    unidade: null,
    criterio: r.criterio,
    excecoes: null,
    dependencias: [],
    interpretacao: r.interpretacao,
    exige_revisao_profissional: true,
    vigencia_inicio: null,
    vigencia_fim: null,
    status: 'rascunho',
    links: [{ provision_id: PROV[0].id, papel: 'criterio' }],
    ...over,
  };
}

describe('validateSeed', () => {
  it('aceita um seed bem formado', () => {
    expect(validateSeed(seedOf(rule()))).toEqual([]);
  });

  it('rejeita seed sem lista de regras', () => {
    expect(validateSeed({ schema_version: 1 }).length).toBeGreaterThan(0);
    expect(validateSeed(null).length).toBeGreaterThan(0);
  });

  it('rejeita status diferente de rascunho (o seed nunca grava revisada)', () => {
    const errs = validateSeed(seedOf(rule({ status: 'revisada' as never })));
    expect(errs.join('\n')).toMatch(/rascunho/);
  });

  it('rejeita rule_key duplicada', () => {
    expect(validateSeed(seedOf(rule(), rule())).join('\n')).toMatch(/duplicad/);
  });

  it('rejeita rule_key de gro_pgr sem prefixo GRO-/PGR-', () => {
    expect(validateSeed(seedOf(rule({ rule_key: 'LIP-X' }))).join('\n')).toMatch(/GRO-|PGR-/);
  });

  it('prefixo de rule_key por área: aceita o prefixo da área e rejeita os demais, com mensagem listando os aceitos', () => {
    const casos: [string, string, string, string, RegExp][] = [
      // [área, categoria, key aceita, key rejeitada, mensagem esperada]
      ['gro_pgr', 'revisao', 'PGR-TESTE', 'SAU-TESTE', /rule_key da área gro_pgr deve começar com GRO- ou PGR-/],
      ['previdenciario', 'ppp', 'PREV-TESTE', 'GRO-TESTE', /rule_key da área previdenciario deve começar com PREV-/],
      ['saude_ocupacional', 'aso', 'SAU-TESTE', 'SAUDE-TESTE', /rule_key da área saude_ocupacional deve começar com SAU-/],
    ];
    for (const [area, categoria, boa, ruim, msg] of casos) {
      const ok = validateSeed(seedOf(rule({ rule_key: boa, area: area as never, categoria: categoria as never }))).join('\n');
      expect([area, ok]).toEqual([area, '']);
      const errs = validateSeed(seedOf(rule({ rule_key: ruim, area: area as never, categoria: categoria as never }))).join('\n');
      expect([area, errs]).toEqual([area, expect.stringMatching(msg)]);
    }
    // lip: sem seed versionado, sem prefixo obrigatório.
    expect(validateSeed(seedOf(rule({ rule_key: 'QUALQUER-TESTE', area: 'lip', categoria: 'insalubridade' }))).join('\n')).not.toMatch(/rule_key da área/);
  });

  it('saude_ocupacional: só com categorias da área', () => {
    const ok = rule({ rule_key: 'SAU-TESTE', area: 'saude_ocupacional' as never, categoria: 'aso' as never });
    expect(validateSeed(seedOf(ok)).join('\n')).not.toMatch(/rule_key da área|categoria/);
    const ruim = rule({ rule_key: 'SAU-TESTE', area: 'saude_ocupacional' as never, categoria: 'ltcat' as never });
    expect(validateSeed(seedOf(ruim)).join('\n')).toMatch(/categoria 'ltcat' não pertence à área 'saude_ocupacional'/);
    const vazou = rule({ rule_key: 'PREV-TESTE', area: 'previdenciario' as never, categoria: 'aso' as never });
    expect(validateSeed(seedOf(vazou)).join('\n')).toMatch(/categoria 'aso' não pertence à área 'previdenciario'/);
  });

  it('rejeita categoria fora da área', () => {
    expect(validateSeed(seedOf(rule({ categoria: 'insalubridade' as never }))).join('\n')).toMatch(/categoria/);
  });

  it('rejeita área desconhecida e método desconhecido', () => {
    expect(validateSeed(seedOf(rule({ area: 'x' as never }))).join('\n')).toMatch(/area/);
    expect(validateSeed(seedOf(rule({ metodo_avaliacao: 'x' as never }))).join('\n')).toMatch(/metodo_avaliacao/);
  });

  it('exige exige_revisao_profissional = true e interpretação rotulada como rascunho', () => {
    expect(validateSeed(seedOf(rule({ exige_revisao_profissional: false }))).join('\n')).toMatch(/exige_revisao_profissional/);
    expect(validateSeed(seedOf(rule({ interpretacao: 'sem rótulo' }))).join('\n')).toMatch(/RASCUNHO/);
  });

  it('rejeita ligação malformada (papel inválido, item vazio) e ligação repetida', () => {
    expect(validateSeed(seedOf(rule({ provisions: [{ norma: 'NR-01', anexo: '', item_path: '1.1', papel: 'x' as never, contem: 'x' }] }))).join('\n')).toMatch(/papel/);
    expect(validateSeed(seedOf(rule({ provisions: [{ norma: 'NR-01', anexo: '', item_path: '', papel: 'criterio', contem: 'x' }] }))).join('\n')).toMatch(/item_path/);
    const l = { norma: 'NR-01', anexo: '', item_path: '1.1', papel: 'criterio' as const, contem: 'x' };
    expect(validateSeed(seedOf(rule({ provisions: [l, { ...l }] }))).join('\n')).toMatch(/repetid/);
  });

  it('rejeita ligação sem `contem`, ou com `contem` vazio/em branco', () => {
    const base = { norma: 'NR-01', anexo: '', item_path: '1.5.4.4.6', papel: 'criterio' as const };
    expect(validateSeed(seedOf(rule({ provisions: [base as never] }))).join('\n')).toMatch(/contem/);
    expect(validateSeed(seedOf(rule({ provisions: [{ ...base, contem: '' }] }))).join('\n')).toMatch(/contem/);
    expect(validateSeed(seedOf(rule({ provisions: [{ ...base, contem: '  \n ' }] }))).join('\n')).toMatch(/contem/);
  });

  it('com o texto parseado: rejeita fragmento que o dispositivo não contém (espaços normalizados, caixa sensível)', () => {
    const texto = { norma: 'NR-01', provisions: [{ anexo: '', item_path: '1.5.4.4.6', literal_text: PROV[0].literal_text }] };
    expect(validateSeed(seedOf(rule()), texto)).toEqual([]);
    const errado = validateSeed(seedOf(rule({ provisions: [{ ...rule().provisions[0], contem: 'revista a cada três anos' }] })), texto).join('\n');
    expect(errado).toMatch(/endereço resolve, mas o texto não contém "revista a cada três anos"/);
    expect(validateSeed(seedOf(rule({ provisions: [{ ...rule().provisions[0], contem: 'Revista a cada dois anos' }] })), texto).length).toBe(1);
  });

  it('com o texto parseado: rejeita ligação a item que não existe no texto', () => {
    const texto = { norma: 'NR-01', provisions: [{ anexo: '', item_path: '1.1', literal_text: '1.1 x' }] };
    expect(validateSeed(seedOf(rule()), texto).join('\n')).toMatch(/ligação não encontrada/);
  });

  it('regra sem ligação só é aceita com a nota "sem fundamento literal verificado"', () => {
    expect(validateSeed(seedOf(rule({ provisions: [] }))).join('\n')).toMatch(/sem fundamento literal verificado/);
    expect(
      validateSeed(seedOf(rule({ provisions: [], interpretacao: '[RASCUNHO — não revisado] Afirmação do material; sem fundamento literal verificado.' }))),
    ).toEqual([]);
  });

  it('rejeita campos desconhecidos (ex.: reviewed_by_user_id)', () => {
    expect(validateSeed(seedOf({ ...rule(), reviewed_by_user_id: 'x' } as never)).join('\n')).toMatch(/reviewed_by_user_id/);
  });
});

describe('planImport', () => {
  it('cria regra nova com as ligações resolvidas', () => {
    const plan = planImport(seedOf(rule()), [], PROV);
    expect(plan.errors).toEqual([]);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].action).toBe('criar');
    expect(plan.items[0].links).toEqual([expect.objectContaining({ provision_id: PROV[0].id, papel: 'criterio' })]);
  });

  it('idempotente: regra igual já gravada fica inalterada', () => {
    const plan = planImport(seedOf(rule()), [existing()], PROV);
    expect(plan.errors).toEqual([]);
    expect(plan.items[0].action).toBe('inalterada');
  });

  it('atualiza regra em rascunho quando o conteúdo muda', () => {
    const plan = planImport(seedOf(rule({ criterio: 'Outro critério (SINTÉTICO).' })), [existing()], PROV);
    expect(plan.items[0]).toEqual(expect.objectContaining({ action: 'atualizar', existing_id: existing().id }));
  });

  it('atualiza regra em rascunho quando as ligações mudam', () => {
    const r = rule({ provisions: [...rule().provisions, { norma: 'NR-01', anexo: '', item_path: '1.5.4.4.6.1', papel: 'excecao', contem: 'até 3 anos' }] });
    expect(planImport(seedOf(r), [existing()], PROV).items[0].action).toBe('atualizar');
  });

  it.each(['revisada', 'revisar', 'retirada'] as const)('nunca altera regra %s (ignorada)', (status) => {
    const plan = planImport(seedOf(rule({ criterio: 'Mudou (SINTÉTICO).' })), [existing({ status })], PROV);
    expect(plan.errors).toEqual([]);
    expect(plan.items[0].action).toBe('ignorada');
    expect(plan.items[0].motivo).toMatch(status);
  });

  it('ligação inexistente gera erro (o importador aborta)', () => {
    const r = rule({ provisions: [{ norma: 'NR-01', anexo: '', item_path: '9.9.9', papel: 'criterio', contem: 'x' }] });
    const plan = planImport(seedOf(r), [], PROV);
    expect(plan.errors.join('\n')).toMatch(/9\.9\.9/);
  });

  it('ligação inexistente é reportada como "ligação não encontrada"', () => {
    const r = rule({ provisions: [{ norma: 'NR-01', anexo: '', item_path: '9.9.9', papel: 'criterio', contem: 'x' }] });
    expect(planImport(seedOf(r), [], PROV).errors.join('\n')).toMatch(/ligação não encontrada/);
  });

  it('endereço resolve, mas o texto não contém o fragmento: erro distinto (item renumerado)', () => {
    const renumerado = [{ ...PROV[0], literal_text: '1.5.4.4.6 Outro assunto (SINTÉTICO).' }];
    const plan = planImport(seedOf(rule()), [], renumerado);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toMatch(/endereço resolve, mas o texto não contém "revista a cada dois anos"/);
    expect(plan.errors[0]).not.toMatch(/não encontrada/);
  });

  // Literais REAIS do parse 'lei' da CLT (del5452.htm, 2026-10-09): o parser cria dispositivo para a forma sem
  // parênteses; o importador recusa ligar regra a eles (isRevokedLiteral), mesmo quando o `contem` casa.
  it('ligação a dispositivo REVOGADO aborta (validateSeed com texto e planImport), com e sem parênteses', () => {
    const revogados: [string, string, string][] = [
      ['art. 432 §2', '§ 2 o Revogado. (Redação dada pela Lei nº 10.097, de 19.12.2000)', 'Revogado'],
      ['art. 235-D inc. I', 'I - revogado; (Redação dada pela Lei nº 13.103, de 2015) (Vigência)', 'revogado'],
      ['art. 790-B §4', '§ 4 o (Declarado inconstitucional pela ADI 5766)', 'inconstitucional'],
    ];
    for (const [item, literal, contem] of revogados) {
      const r = rule({ rule_key: 'PREV-TESTE', area: 'previdenciario', categoria: 'ppp', provisions: [{ norma: 'CLT', anexo: '', item_path: item, papel: 'criterio', contem }] });
      const prov = [{ id: '00000000-0000-0000-0000-0000000000aa', norma: 'CLT', anexo: '', item_path: item, literal_text: literal }];
      const plan = planImport(seedOf(r), [], prov);
      expect(plan.errors).toHaveLength(1);
      expect(plan.errors[0]).toMatch(/dispositivo revogado/);
      expect(validateSeed(seedOf(r), { norma: 'CLT', provisions: prov }).join('\n')).toMatch(/dispositivo revogado/);
    }
  });

  it('ligação ambígua (mais de um dispositivo ativo) gera erro', () => {
    const dup = [...PROV, { ...PROV[0], id: '00000000-0000-0000-0000-000000000009' }];
    expect(planImport(seedOf(rule()), [], dup).errors.join('\n')).toMatch(/amb[ií]gu/);
  });

  it('ligação não resolvida aborta mesmo quando a regra seria ignorada', () => {
    const r = rule({ provisions: [{ norma: 'NR-01', anexo: '', item_path: '9.9.9', papel: 'criterio', contem: 'x' }] });
    expect(planImport(seedOf(r), [existing({ status: 'revisada' })], PROV).errors.length).toBeGreaterThan(0);
  });

  it('regra existente com outra área é erro (área é imutável)', () => {
    expect(planImport(seedOf(rule()), [existing({ area: 'lip' })], PROV).errors.join('\n')).toMatch(/área|area/);
  });

  it('seed inválido vira erro do plano', () => {
    expect(planImport(seedOf(rule({ status: 'revisada' as never })), [], PROV).errors.length).toBeGreaterThan(0);
  });
});

type Call = { sql: string; params: unknown[] };

function mockClient(opts: { existing?: ExistingRule[]; provisions?: ResolvedProvision[]; updateRowCount?: number } = {}) {
  const calls: Call[] = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/FROM normative_rules\b/.test(sql) && /SELECT/.test(sql)) {
      return { rows: (opts.existing ?? []).map(({ links: _l, ...r }) => r), rowCount: (opts.existing ?? []).length };
    }
    if (/FROM normative_rule_provisions/.test(sql) && /^\s*SELECT/.test(sql)) {
      const rows = (opts.existing ?? []).flatMap((r) => r.links.map((l) => ({ rule_id: r.id, ...l })));
      return { rows, rowCount: rows.length };
    }
    if (/FROM normative_provisions/.test(sql)) return { rows: opts.provisions ?? [], rowCount: (opts.provisions ?? []).length };
    if (/^\s*INSERT INTO normative_rules\b/.test(sql)) return { rows: [{ id: 'new-id' }], rowCount: 1 };
    if (/^\s*UPDATE normative_rules\b/.test(sql)) {
      const n = opts.updateRowCount ?? 1;
      return { rows: n ? [{ id: params[0] }] : [], rowCount: n };
    }
    return { rows: [], rowCount: 0 };
  });
  return { client: { query }, calls };
}

const writes = (calls: Call[]) => calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)\b/.test(c.sql));

describe('runImport', () => {
  it('dry-run: transação READ ONLY, nenhuma escrita, ROLLBACK', async () => {
    const { client, calls } = mockClient({ provisions: PROV });
    const res = await runImport(client, seedOf(rule()), { apply: false });
    expect(calls[0].sql).toBe('BEGIN READ ONLY');
    expect(writes(calls)).toEqual([]);
    expect(calls[calls.length - 1].sql).toBe('ROLLBACK');
    expect(res.aborted).toBe(false);
    expect(res.applied).toBe(false);
    expect(res.plan.items[0].action).toBe('criar');
  });

  it('--apply: BEGIN, grava regra em rascunho e ligações, COMMIT', async () => {
    const { client, calls } = mockClient({ provisions: PROV });
    const res = await runImport(client, seedOf(rule()), { apply: true });
    expect(calls[0].sql).toBe('BEGIN');
    expect(calls[calls.length - 1].sql).toBe('COMMIT');
    expect(res.applied).toBe(true);
    const ins = writes(calls);
    expect(ins[0].sql).toMatch(/INSERT INTO normative_rules\b[\s\S]*'rascunho'/);
    expect(ins.some((c) => /INSERT INTO normative_rule_provisions/.test(c.sql) && c.params.includes(PROV[0].id))).toBe(true);
  });

  it('--apply com ligação não resolvida: aborta sem gravar nada (ROLLBACK)', async () => {
    const { client, calls } = mockClient({ provisions: [] });
    const res = await runImport(client, seedOf(rule()), { apply: true });
    expect(res.aborted).toBe(true);
    expect(res.applied).toBe(false);
    expect(writes(calls)).toEqual([]);
    expect(calls[calls.length - 1].sql).toBe('ROLLBACK');
  });

  it('--apply com fragmento ausente no dispositivo: aborta sem gravar nada e o relatório lista o descasamento', async () => {
    const { client, calls } = mockClient({ provisions: [{ ...PROV[0], literal_text: '1.5.4.4.6 Outro assunto (SINTÉTICO).' }] });
    const res = await runImport(client, seedOf(rule()), { apply: true });
    expect(res.aborted).toBe(true);
    expect(writes(calls)).toEqual([]);
    expect(calls[calls.length - 1].sql).toBe('ROLLBACK');
    expect(formatPlan(res)).toMatch(/endereço resolve, mas o texto não contém "revista a cada dois anos"/);
  });

  it('lê o literal_text dos dispositivos para conferir o fragmento', async () => {
    const { client, calls } = mockClient({ provisions: PROV });
    await runImport(client, seedOf(rule()), { apply: false });
    expect(calls.find((c) => /FROM normative_provisions/.test(c.sql))!.sql).toMatch(/p\.literal_text/);
  });

  it('--apply trava as regras existentes (FOR UPDATE) e só lê dispositivos ativos de documentos vigentes', async () => {
    const { client, calls } = mockClient({ provisions: PROV });
    await runImport(client, seedOf(rule()), { apply: true });
    expect(calls.find((c) => /FROM normative_rules\b/.test(c.sql))!.sql).toMatch(/FOR UPDATE/);
    const prov = calls.find((c) => /FROM normative_provisions/.test(c.sql))!.sql;
    expect(prov).toMatch(/p\.status = 'ativo'/);
    expect(prov).toMatch(/d\.status = 'vigente'/);
  });

  it('--apply idempotente: regra igual não gera escrita', async () => {
    const { client, calls } = mockClient({ existing: [existing()], provisions: PROV });
    const res = await runImport(client, seedOf(rule()), { apply: true });
    expect(res.plan.items[0].action).toBe('inalterada');
    expect(writes(calls)).toEqual([]);
  });

  it('--apply não escreve em regra revisada', async () => {
    const { client, calls } = mockClient({ existing: [existing({ status: 'revisada' })], provisions: PROV });
    await runImport(client, seedOf(rule({ criterio: 'Mudou (SINTÉTICO).' })), { apply: true });
    expect(writes(calls)).toEqual([]);
  });

  it('erro durante a gravação: ROLLBACK e propaga', async () => {
    const { client, calls } = mockClient({ existing: [existing()], provisions: PROV, updateRowCount: 0 });
    await expect(runImport(client, seedOf(rule({ criterio: 'Mudou (SINTÉTICO).' })), { apply: true })).rejects.toThrow(/rascunho/);
    expect(calls[calls.length - 1].sql).toBe('ROLLBACK');
    expect(calls.some((c) => c.sql === 'COMMIT')).toBe(false);
  });
});

describe('executePlan', () => {
  it('UPDATE só atinge regra em rascunho e nunca grava revisada', async () => {
    const { client, calls } = mockClient({ existing: [existing()], provisions: PROV });
    const plan = planImport(seedOf(rule({ criterio: 'Mudou (SINTÉTICO).' })), [existing()], PROV);
    const out = await executePlan(client, plan);
    expect(out).toEqual({ criadas: 0, atualizadas: 1 });
    const upd = calls.find((c) => /^\s*UPDATE normative_rules\b/.test(c.sql))!;
    expect(upd.sql).toMatch(/WHERE id = \$1 AND status = 'rascunho'/);
    for (const c of calls) expect(c.sql).not.toMatch(/revisada/);
    // ligações substituídas: DELETE antes do INSERT
    const iDel = calls.findIndex((c) => /^\s*DELETE FROM normative_rule_provisions/.test(c.sql));
    const iIns = calls.findIndex((c) => /^\s*INSERT INTO normative_rule_provisions/.test(c.sql));
    expect(iDel).toBeGreaterThan(-1);
    expect(iIns).toBeGreaterThan(iDel);
  });

  it('recusa executar plano com erros', async () => {
    const { client } = mockClient();
    await expect(executePlan(client, { errors: ['x'], items: [] })).rejects.toThrow();
  });
});

describe('parseArgs', () => {
  it('padrão: dry-run com o seed GRO/PGR', () => {
    const a = parseArgs([]);
    expect(a.apply).toBe(false);
    expect(a.seedPath).toMatch(/seed-data[\\/]normative-rules[\\/]gro-pgr\.json$/);
  });
  it('--apply em qualquer posição e caminho posicional', () => {
    expect(parseArgs(['--apply', 'x.json'])).toEqual({ apply: true, seedPath: 'x.json' });
    expect(parseArgs(['x.json', '--apply'])).toEqual({ apply: true, seedPath: 'x.json' });
  });
});

describe('seeds versionados (db/seed-data/normative-rules) com os prefixos por área', () => {
  const DIR = join(__dirname, '..', 'db', 'seed-data', 'normative-rules');
  const ESPERADOS: Record<string, RegExp> = {
    'gro-pgr.json': /^(GRO|PGR)-/,
    'previdenciario.json': /^PREV-/,
    'saude-ocupacional.json': /^SAU-/,
    'saude-ocupacional-nr07.json': /^SAU-/,
  };
  it('todo seed do diretório é conhecido, passa em validateSeed e usa o prefixo da sua área', () => {
    const arquivos = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
    expect(arquivos).toEqual(Object.keys(ESPERADOS).sort());
    for (const f of arquivos) {
      const seed = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Seed;
      expect([f, validateSeed(seed)]).toEqual([f, []]);
      expect(seed.rules.length).toBeGreaterThan(0);
      for (const r of seed.rules) expect([f, r.rule_key]).toEqual([f, expect.stringMatching(ESPERADOS[f])]);
    }
  });
  it('o padrão do CLI continua sendo o seed GRO/PGR', () => {
    expect(DEFAULT_SEED_PATH).toBe(join(DIR, 'gro-pgr.json'));
  });
});
