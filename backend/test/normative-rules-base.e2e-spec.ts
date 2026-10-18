import { BadRequestException } from '@nestjs/common';
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { markDocumentProvisionsObsolete } from '../src/normative/provision-lifecycle';
import { RuleArea } from '../src/normative/normative-rule-areas';
import { NormativeRulesService } from '../src/normative/normative-rules.service';
import { ProvisionsService } from '../src/normative/provisions.service';

const URL = process.env.TEST_SUPERUSER_DATABASE_URL;

// Opt-in explícito: este e2e grava (e apaga) linhas em tabelas GLOBAIS (sem tenant_id/RLS) com superusuário.
function exigirBancoDescartavel(): void {
  if (process.env.E2E_DISPOSABLE_DB !== '1') {
    throw new Error('este e2e grava em tabelas globais; rode só em banco descartável com E2E_DISPOSABLE_DB=1');
  }
}

// Rodar SÓ em banco descartável. A fonte de teste nasce com active = false (fora do assistente e do
// monitor) e um `code` já existente aborta o teste com mensagem clara em vez de estourar na UNIQUE.
async function criarFonteDeTeste(c: Client, id: string, code: string): Promise<void> {
  const existe = await c.query(`SELECT id FROM official_sources WHERE code = $1`, [code]);
  if (existe.rows.length > 0) {
    throw new Error(`já existe fonte com code = '${code}' (id ${existe.rows[0].id}); limpe o banco descartável antes de rodar`);
  }
  await c.query(
    `INSERT INTO official_sources (id, entity, code, title, official_url, active) VALUES ($1, 'TESTE', $2, 'Teste', 'https://exemplo.gov.br/t', false)`,
    [id, code],
  );
}

async function usuarioQualquer(c: Client): Promise<string> {
  const r = await c.query(`SELECT id FROM users LIMIT 1`);
  if (r.rows.length === 0) throw new Error('banco de teste sem usuário');
  return r.rows[0].id as string;
}

// Limpeza em ordem segura de FK: regras (vínculos caem em cascata) → documento (dispositivos caem em
// cascata) → fonte. Cada passo roda mesmo se o anterior falhar; o primeiro erro é relançado no fim.
async function limpar(c: Client | undefined, ruleIds: string[], docId: string | undefined, sourceId: string | undefined): Promise<void> {
  if (!c) return;
  const erros: unknown[] = [];
  const passo = async (sql: string, params: unknown[]) => {
    try {
      await c.query(sql, params);
    } catch (e) {
      erros.push(e);
    }
  };
  if (ruleIds.length > 0) await passo(`DELETE FROM normative_rules WHERE id = ANY($1::uuid[])`, [ruleIds]);
  if (docId) await passo(`DELETE FROM normative_documents WHERE id = $1`, [docId]);
  if (sourceId) await passo(`DELETE FROM official_sources WHERE id = $1`, [sourceId]);
  await c.end().catch((e) => erros.push(e));
  if (erros.length > 0) throw erros[0];
}

describe('base normativa (normative_rules: lip | gro_pgr | previdenciario | saude_ocupacional) — constraints (banco descartável)', () => {
  let c: Client;
  let sourceId: string | undefined;
  let docId: string | undefined;
  let userId: string;
  const ruleIds: string[] = [];

  // area/categoria explícitas; `area = null` omite a coluna no INSERT (a 0073 remove o DEFAULT: deve falhar).
  const novaRegra = async (status = 'rascunho', area: string | null = 'lip', categoria = 'insalubridade') => {
    const id = randomUUID();
    ruleIds.push(id);
    if (area === null) {
      await c.query(
        `INSERT INTO normative_rules (id, rule_key, categoria, agente_ou_atividade, metodo_avaliacao, criterio, interpretacao, status)
         VALUES ($1, $2, $3, 'Ruído', 'quantitativo', 'ver dispositivo', 'rascunho de teste', $4)`,
        [id, `TESTE-${id}`, categoria, status],
      );
    } else {
      await c.query(
        `INSERT INTO normative_rules (id, rule_key, area, categoria, agente_ou_atividade, metodo_avaliacao, criterio, interpretacao, status)
         VALUES ($1, $2, $3, $4, 'Tema de teste', 'qualitativo', 'ver dispositivo', 'rascunho de teste', $5)`,
        [id, `TESTE-${id}`, area, categoria, status],
      );
    }
    return id;
  };
  const revisar = (id: string) =>
    c.query(
      `UPDATE normative_rules SET status = 'revisada', reviewed_by_user_id = $2, reviewed_at = now(), reviewer_registro = 'CREA 0000' WHERE id = $1`,
      [id, userId],
    );
  const novoDispositivo = async (path: string, status = 'ativo') => {
    const r = await c.query(
      `INSERT INTO normative_provisions (document_id, norma, anexo, item_path, literal_text, char_start, char_end, document_hash, parser_version, status)
       VALUES ($1, 'NR-TESTE', '', $2, 'texto', 0, 5, 'hash', 'teste/1', $3) RETURNING id`,
      [docId, path, status],
    );
    return r.rows[0].id as string;
  };

  beforeAll(async () => {
    exigirBancoDescartavel();
    if (!URL) throw new Error('TEST_SUPERUSER_DATABASE_URL não definida');
    c = new Client({ connectionString: URL });
    await c.connect();
    userId = await usuarioQualquer(c);
    const novaFonte = randomUUID();
    await criarFonteDeTeste(c, novaFonte, 'NR-TESTE');
    sourceId = novaFonte;
    docId = randomUUID();
    await c.query(
      `INSERT INTO normative_documents (id, source_id, status, content_hash, file_key, file_name, mime_type, raw_text)
       VALUES ($1, $2, 'vigente', 'hash', 'k', 'f', 'text/html', 'texto')`,
      [docId, sourceId],
    );
  });

  afterAll(async () => {
    await limpar(c, ruleIds, docId, sourceId);
  });

  it('regra nasce rascunho e NÃO pode nascer revisada', async () => {
    await expect(novaRegra('rascunho')).resolves.toBeTruthy();
    await expect(novaRegra('revisada')).rejects.toThrow();
  });

  it('revisada sem revisor identificado é rejeitada pelo CHECK', async () => {
    const id = await novaRegra();
    const p = await novoDispositivo('t.1');
    await c.query(`INSERT INTO normative_rule_provisions (rule_id, provision_id, papel) VALUES ($1, $2, 'fundamento')`, [id, p]);
    await expect(c.query(`UPDATE normative_rules SET status = 'revisada' WHERE id = $1`, [id])).rejects.toThrow(/revisada_exige_revisor/);
  });

  it('revisada sem dispositivo ativo vinculado é rejeitada pelo trigger', async () => {
    const id = await novaRegra();
    await expect(
      c.query(`UPDATE normative_rules SET status = 'revisada', reviewed_by_user_id = $2, reviewed_at = now(), reviewer_registro = 'CREA 0000' WHERE id = $1`, [id, userId]),
    ).rejects.toThrow(/dispositivo literal ativo/);
  });

  it('revisada com dispositivo ativo e revisor identificado é aceita; vinculada só a obsoleto, não', async () => {
    const ok = await novaRegra();
    const ativo = await novoDispositivo('t.2');
    await c.query(`INSERT INTO normative_rule_provisions (rule_id, provision_id, papel) VALUES ($1, $2, 'fundamento')`, [ok, ativo]);
    await c.query(`UPDATE normative_rules SET status = 'revisada', reviewed_by_user_id = $2, reviewed_at = now(), reviewer_registro = 'CREA 0000' WHERE id = $1`, [ok, userId]);

    const ruim = await novaRegra();
    const obsoleto = await novoDispositivo('t.3', 'obsoleto');
    await c.query(`INSERT INTO normative_rule_provisions (rule_id, provision_id, papel) VALUES ($1, $2, 'fundamento')`, [ruim, obsoleto]);
    await expect(
      c.query(`UPDATE normative_rules SET status = 'revisada', reviewed_by_user_id = $2, reviewed_at = now(), reviewer_registro = 'CREA 0000' WHERE id = $1`, [ruim, userId]),
    ).rejects.toThrow(/dispositivo literal ativo/);
  });

  it('dispositivo duplicado (mesmo documento/anexo/item/versão) é rejeitado', async () => {
    await novoDispositivo('t.dup');
    await expect(novoDispositivo('t.dup')).rejects.toThrow(/normative_provisions_unique/);
  });

  it('as tabelas novas não têm coluna tenant_id', async () => {
    const r = await c.query(
      `SELECT table_name FROM information_schema.columns
       WHERE table_name IN ('normative_provisions','normative_rules','normative_rule_provisions') AND column_name = 'tenant_id'`,
    );
    expect(r.rows).toEqual([]);
  });

  it('área × categoria: coerência imposta pelo CHECK do banco', async () => {
    await expect(novaRegra('rascunho', 'gro_pgr', 'insalubridade')).rejects.toThrow(/normative_rules_area_categoria_coerente/);
    await expect(novaRegra('rascunho', 'gro_pgr', 'previdenciario')).rejects.toThrow(/normative_rules_area_categoria_coerente/);
    await expect(novaRegra('rascunho', 'lip', 'psicossocial')).rejects.toThrow(/normative_rules_area_categoria_coerente/);
    await expect(novaRegra('rascunho', 'lip', 'inventario')).rejects.toThrow(/normative_rules_area_categoria_coerente/);
    // Área desconhecida viola o CHECK de área e o de coerência; qualquer um dos dois serve.
    await expect(novaRegra('rascunho', 'outra', 'inventario')).rejects.toThrow(/normative_rules_area_(check|categoria_coerente)/);
    await expect(novaRegra('rascunho', 'gro_pgr', 'inventario')).resolves.toBeTruthy();
    await expect(novaRegra('rascunho', 'gro_pgr', 'psicossocial')).resolves.toBeTruthy();
    await expect(novaRegra('rascunho', 'lip', 'periculosidade')).resolves.toBeTruthy();
    // estrutura_pgr (composição do PGR) só existe na área gro_pgr.
    await expect(novaRegra('rascunho', 'gro_pgr', 'estrutura_pgr')).resolves.toBeTruthy();
    await expect(novaRegra('rascunho', 'lip', 'estrutura_pgr')).rejects.toThrow(/normative_rules_area_categoria_coerente/);
  });

  it('0074: área previdenciario só com as categorias previdenciárias; lip e gro_pgr inalteradas', async () => {
    for (const categoria of ['aposentadoria_especial', 'ltcat', 'ppp', 'agentes_nocivos', 'esocial', 'cruzamento_documental', 'exposicao']) {
      await expect(novaRegra('rascunho', 'previdenciario', categoria)).resolves.toBeTruthy();
    }
    await expect(novaRegra('rascunho', 'previdenciario', 'insalubridade')).rejects.toThrow(/normative_rules_area_categoria_coerente/);
    // 'previdenciario' é categoria da área lip, não da área previdenciario.
    await expect(novaRegra('rascunho', 'previdenciario', 'previdenciario')).rejects.toThrow(/normative_rules_area_categoria_coerente/);
    await expect(novaRegra('rascunho', 'previdenciario', 'inventario')).rejects.toThrow(/normative_rules_area_categoria_coerente/);
    await expect(novaRegra('rascunho', 'lip', 'ltcat')).rejects.toThrow(/normative_rules_area_categoria_coerente/);
    await expect(novaRegra('rascunho', 'gro_pgr', 'ppp')).rejects.toThrow(/normative_rules_area_categoria_coerente/);
    await expect(novaRegra('rascunho', 'lip', 'previdenciario')).resolves.toBeTruthy();
    await expect(novaRegra('rascunho', 'gro_pgr', 'estrutura_pgr')).resolves.toBeTruthy();
    // Sem área continua falhando (NOT NULL, sem DEFAULT), também com categoria previdenciária.
    await expect(novaRegra('rascunho', null, 'ltcat')).rejects.toThrow(/null value in column "area"/);
    const prev = await novaRegra('rascunho', 'previdenciario', 'ltcat');
    await expect(c.query(`UPDATE normative_rules SET categoria = 'insalubridade' WHERE id = $1`, [prev])).rejects.toThrow(
      /normative_rules_area_categoria_coerente/,
    );
    const def = await c.query(
      `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'normative_rules'::regclass AND conname = 'normative_rules_area_check'`,
    );
    expect(def.rows[0].d).toMatch(/previdenciario/);
  });

  it('0075: área saude_ocupacional só com as categorias de saúde ocupacional; demais áreas inalteradas', async () => {
    for (const categoria of ['pcmso', 'exames_ocupacionais', 'aso', 'relatorio_analitico', 'excecao', 'privacidade_dados', 'cruzamento_documental_saude']) {
      await expect(novaRegra('rascunho', 'saude_ocupacional', categoria)).resolves.toBeTruthy();
    }
    await expect(novaRegra('rascunho', 'saude_ocupacional', 'ltcat')).rejects.toThrow(/normative_rules_area_categoria_coerente/);
    await expect(novaRegra('rascunho', 'saude_ocupacional', 'insalubridade')).rejects.toThrow(/normative_rules_area_categoria_coerente/);
    await expect(novaRegra('rascunho', 'saude_ocupacional', 'saude_ocupacional')).rejects.toThrow(/normative_rules_area_categoria_coerente/);
    // Categorias de saúde não vazam para as outras áreas.
    await expect(novaRegra('rascunho', 'previdenciario', 'aso')).rejects.toThrow(/normative_rules_area_categoria_coerente/);
    await expect(novaRegra('rascunho', 'lip', 'aso')).rejects.toThrow(/normative_rules_area_categoria_coerente/);
    await expect(novaRegra('rascunho', 'gro_pgr', 'pcmso')).rejects.toThrow(/normative_rules_area_categoria_coerente/);
    // 'excecao' continua aceita em gro_pgr; os conjuntos anteriores seguem válidos.
    await expect(novaRegra('rascunho', 'gro_pgr', 'excecao')).resolves.toBeTruthy();
    await expect(novaRegra('rascunho', 'previdenciario', 'ltcat')).resolves.toBeTruthy();
    await expect(novaRegra('rascunho', 'lip', 'previdenciario')).resolves.toBeTruthy();
    // Sem área continua falhando (NOT NULL, sem DEFAULT), também com categoria de saúde.
    await expect(novaRegra('rascunho', null, 'aso')).rejects.toThrow(/null value in column "area"/);
    const saude = await novaRegra('rascunho', 'saude_ocupacional', 'aso');
    await expect(c.query(`UPDATE normative_rules SET categoria = 'ltcat' WHERE id = $1`, [saude])).rejects.toThrow(
      /normative_rules_area_categoria_coerente/,
    );
    const def = await c.query(
      `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'normative_rules'::regclass AND conname = 'normative_rules_area_check'`,
    );
    expect(def.rows[0].d).toMatch(/saude_ocupacional/);
  });

  it('área: coluna sem DEFAULT — INSERT sem `area` falha (NOT NULL); trocar categoria de uma regra gro_pgr para LIP é rejeitado pelo banco', async () => {
    const col = await c.query(
      `SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'normative_rules' AND column_name = 'area'`,
    );
    expect(col.rows).toEqual([{ is_nullable: 'NO', column_default: null }]);
    await expect(novaRegra('rascunho', null, 'prevencao')).rejects.toThrow(/null value in column "area"/);
    const gro = await novaRegra('rascunho', 'gro_pgr', 'plano_acao');
    await expect(c.query(`UPDATE normative_rules SET categoria = 'insalubridade' WHERE id = $1`, [gro])).rejects.toThrow(
      /normative_rules_area_categoria_coerente/,
    );
  });

  it('trigger renomeado continua barrando revisada sem dispositivo ativo — também em regra gro_pgr', async () => {
    const gro = await novaRegra('rascunho', 'gro_pgr', 'avaliacao_riscos');
    await expect(revisar(gro)).rejects.toThrow(/dispositivo literal ativo/);
    const p = await novoDispositivo('t.gro');
    await c.query(`INSERT INTO normative_rule_provisions (rule_id, provision_id, papel) VALUES ($1, $2, 'fundamento')`, [gro, p]);
    await expect(revisar(gro)).resolves.toBeTruthy();
  });

  it('0073: nenhum objeto com o nome antigo; trigger/função/constraints/índices com os nomes novos', async () => {
    const antigos = await c.query(
      `SELECT 'tabela/índice' AS tipo, relname AS nome FROM pg_class WHERE relname LIKE 'lip\\_rule%'
       UNION ALL SELECT 'constraint', conname FROM pg_constraint WHERE conname LIKE 'lip\\_rule%'
       UNION ALL SELECT 'função', proname FROM pg_proc WHERE proname LIKE 'lip\\_rule%'
       UNION ALL SELECT 'trigger', tgname FROM pg_trigger WHERE tgname LIKE 'lip\\_rule%'`,
    );
    expect(antigos.rows).toEqual([]);

    const trg = await c.query(
      `SELECT t.tgname, p.proname, p.prosrc FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE t.tgrelid = 'normative_rules'::regclass AND NOT t.tgisinternal`,
    );
    expect(trg.rows.map((r) => [r.tgname, r.proname])).toEqual([['normative_rules_require_active_provision', 'normative_rules_require_active_provision']]);
    expect(trg.rows[0].prosrc).toMatch(/normative_rule_provisions/);
    expect(trg.rows[0].prosrc).not.toMatch(/lip_rule/);

    const cons = await c.query(
      `SELECT conname FROM pg_constraint WHERE conrelid IN ('normative_rules'::regclass, 'normative_rule_provisions'::regclass) ORDER BY conname`,
    );
    expect(cons.rows.map((r) => r.conname)).toEqual([
      'normative_rule_provisions_papel_check',
      'normative_rule_provisions_pkey',
      'normative_rule_provisions_provision_id_fkey',
      'normative_rule_provisions_rule_id_fkey',
      'normative_rules_area_categoria_coerente',
      'normative_rules_area_check',
      'normative_rules_metodo_avaliacao_check',
      'normative_rules_pkey',
      'normative_rules_reviewed_by_user_id_fkey',
      'normative_rules_revisada_exige_revisor',
      'normative_rules_rule_key_key',
      'normative_rules_status_check',
      'normative_rules_vigencia',
    ]);
    const idx = await c.query(
      `SELECT indexname FROM pg_indexes WHERE tablename IN ('normative_rules', 'normative_rule_provisions') ORDER BY indexname`,
    );
    expect(idx.rows.map((r) => r.indexname)).toEqual([
      'normative_rule_provisions_pkey',
      'normative_rule_provisions_provision_idx',
      'normative_rules_categoria_status_idx',
      'normative_rules_pkey',
      'normative_rules_rule_key_key',
    ]);
  });
});

describe('base normativa (normative_rules: lip | gro_pgr | previdenciario | saude_ocupacional) — serviços contra o banco (banco descartável)', () => {
  let c: Client;
  let sourceId: string | undefined;
  let docId: string | undefined;
  let userId: string;
  const ruleIds: string[] = [];
  const provisions = new ProvisionsService();
  const rules = new NormativeRulesService();

  // SINTÉTICO: texto inventado só com a estrutura de itens de NR; não é texto de norma. Contém '𝑀' (U+1D440, astral:
  // 2 unidades UTF-16, 1 ponto de código) antes e dentro dos itens, para provar os offsets em pontos de código.
  const RAW_SINTETICO = [
    'Preâmbulo sintético com 𝑀.',
    '99.1 Item sintético de teste.',
    '99.1.1 Subitem sintético 𝑀 de teste.',
    '99.2 Outro item sintético.',
  ].join('\n');

  const novaRegra = async (area: RuleArea = 'lip', categoria: string = 'insalubridade') => {
    const r = await rules.create(c as any, {
      rule_key: `TESTE-SVC-${randomUUID().slice(0, 8).toUpperCase()}`,
      area,
      categoria: categoria as any,
      agente_ou_atividade: 'Teste',
      metodo_avaliacao: 'qualitativo',
      criterio: 'ver dispositivo',
      interpretacao: 'rascunho de teste',
    });
    ruleIds.push(r.id);
    return r;
  };
  const dispositivos = async (status: 'ativo' | 'obsoleto') =>
    (await c.query(`SELECT id, item_path FROM normative_provisions WHERE document_id = $1 AND status = $2 ORDER BY char_start`, [docId, status])).rows as {
      id: string;
      item_path: string;
    }[];

  // A fonte de teste é 'NR-99', fora da lista validada: libera só durante este describe (trava de generate()).
  const envExtraOriginal = process.env.PROVISIONS_GENERATE_EXTRA_NORMAS;

  beforeAll(async () => {
    exigirBancoDescartavel();
    process.env.PROVISIONS_GENERATE_EXTRA_NORMAS = 'NR-99';
    if (!URL) throw new Error('TEST_SUPERUSER_DATABASE_URL não definida');
    c = new Client({ connectionString: URL });
    await c.connect();
    userId = await usuarioQualquer(c);
    const novaFonte = randomUUID();
    await criarFonteDeTeste(c, novaFonte, 'NR-99');
    sourceId = novaFonte;
    docId = randomUUID();
    await c.query(
      `INSERT INTO normative_documents (id, source_id, status, content_hash, file_key, file_name, mime_type, raw_text)
       VALUES ($1, $2, 'vigente', 'hash-sintetico', 'k', 'f', 'text/plain', $3)`,
      [docId, sourceId, RAW_SINTETICO],
    );
  });

  afterAll(async () => {
    if (envExtraOriginal === undefined) delete process.env.PROVISIONS_GENERATE_EXTRA_NORMAS;
    else process.env.PROVISIONS_GENERATE_EXTRA_NORMAS = envExtraOriginal;
    await limpar(c, ruleIds, docId, sourceId);
  });

  it('generate: 1ª execução insere todos os itens; 2ª não insere nada (idempotente)', async () => {
    const r1 = await provisions.generate(c as any, docId as string);
    expect(r1).toMatchObject({ norma: 'NR-99', found: 3, inserted: 3 });
    const r2 = await provisions.generate(c as any, docId as string);
    expect(r2).toMatchObject({ found: 3, inserted: 0 });
    expect((await dispositivos('ativo')).map((d) => d.item_path)).toEqual(['99.1', '99.1.1', '99.2']);
  });

  it('offsets em pontos de código: substring do Postgres reproduz o literal de todos os dispositivos (texto com astral)', async () => {
    const r = await c.query(
      `SELECT count(*) FILTER (WHERE substring(d.raw_text from p.char_start + 1 for p.char_end - p.char_start) <> p.literal_text)::int AS divergentes,
              count(*)::int AS total
       FROM normative_provisions p JOIN normative_documents d ON d.id = p.document_id
       WHERE p.document_id = $1`,
      [docId],
    );
    expect(r.rows[0]).toEqual({ divergentes: 0, total: 3 });
  });

  it('review sem vínculo ativo → 400', async () => {
    const regra = await novaRegra();
    await expect(rules.review(c as any, regra.id, userId, 'CREA 0000')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create: área × categoria incoerente → 400 do serviço, nada gravado', async () => {
    const key = `TESTE-SVC-${randomUUID().slice(0, 8).toUpperCase()}`;
    const base = { rule_key: key, agente_ou_atividade: 'Teste', metodo_avaliacao: 'qualitativo' as const, criterio: 'c', interpretacao: 'i' };
    await expect(rules.create(c as any, { ...base, area: 'gro_pgr', categoria: 'insalubridade' as any })).rejects.toBeInstanceOf(BadRequestException);
    await expect(rules.create(c as any, { ...base, area: 'lip', categoria: 'psicossocial' as any })).rejects.toBeInstanceOf(BadRequestException);
    await expect(rules.create(c as any, { ...base, area: 'previdenciario', categoria: 'insalubridade' as any })).rejects.toBeInstanceOf(BadRequestException);
    await expect(rules.create(c as any, { ...base, area: 'lip', categoria: 'ltcat' as any })).rejects.toBeInstanceOf(BadRequestException);
    await expect(rules.create(c as any, { ...base, area: 'gro_pgr', categoria: 'ppp' as any })).rejects.toBeInstanceOf(BadRequestException);
    await expect(rules.create(c as any, { ...base, area: 'saude_ocupacional', categoria: 'ltcat' as any })).rejects.toBeInstanceOf(BadRequestException);
    await expect(rules.create(c as any, { ...base, area: 'previdenciario', categoria: 'aso' as any })).rejects.toBeInstanceOf(BadRequestException);
    await expect(rules.create(c as any, { ...base, area: 'lip', categoria: 'aso' as any })).rejects.toBeInstanceOf(BadRequestException);
    expect((await c.query(`SELECT 1 FROM normative_rules WHERE rule_key = $1`, [key])).rows).toEqual([]);
  });

  it('create: previdenciario + ltcat é gravada com area previdenciario; list filtra a área nova', async () => {
    const prev = await novaRegra('previdenciario', 'ltcat');
    expect(prev).toMatchObject({ area: 'previdenciario', categoria: 'ltcat', status: 'rascunho' });
    const soPrev = (await rules.list(c as any, { area: 'previdenciario' })).map((r) => r.id);
    expect(soPrev).toContain(prev.id);
    const soLip = (await rules.list(c as any, { area: 'lip' })).map((r) => r.id);
    expect(soLip).not.toContain(prev.id);
  });

  it('create: saude_ocupacional + aso é gravada com area saude_ocupacional; list filtra a área nova', async () => {
    const saude = await novaRegra('saude_ocupacional', 'aso');
    expect(saude).toMatchObject({ area: 'saude_ocupacional', categoria: 'aso', status: 'rascunho' });
    const soSaude = (await rules.list(c as any, { area: 'saude_ocupacional' })).map((r) => r.id);
    expect(soSaude).toContain(saude.id);
    const soPrev = (await rules.list(c as any, { area: 'previdenciario' })).map((r) => r.id);
    expect(soPrev).not.toContain(saude.id);
  });

  it('list filtra por área', async () => {
    const lip = await novaRegra('lip', 'prevencao');
    const gro = await novaRegra('gro_pgr', 'inventario');
    const soGro = (await rules.list(c as any, { area: 'gro_pgr' })).map((r) => r.id);
    const soLip = (await rules.list(c as any, { area: 'lip' })).map((r) => r.id);
    expect(soGro).toContain(gro.id);
    expect(soGro).not.toContain(lip.id);
    expect(soLip).toContain(lip.id);
    expect(soLip).not.toContain(gro.id);
  });

  it('regras lip e gro_pgr vinculadas e revisadas; documento deixa de valer → ambas "revisar", dispositivos "obsoleto"; vincular obsoleto → 400', async () => {
    const [ativo, outroAtivo] = await dispositivos('ativo');
    const regra = await novaRegra();
    await rules.setProvisions(c as any, regra.id, [{ provision_id: ativo.id, papel: 'fundamento' }]);
    const revisada = await rules.review(c as any, regra.id, userId, 'CREA 0000');
    expect(revisada.status).toBe('revisada');
    expect(revisada.area).toBe('lip');

    const regraGro = await novaRegra('gro_pgr', 'controle_riscos');
    await rules.setProvisions(c as any, regraGro.id, [{ provision_id: outroAtivo.id, papel: 'criterio' }]);
    const revisadaGro = await rules.review(c as any, regraGro.id, userId, 'CREA 0000');
    expect(revisadaGro).toMatchObject({ status: 'revisada', area: 'gro_pgr', categoria: 'controle_riscos' });

    // Edição: categoria de outra área → 400 do serviço (a regra continua revisada).
    await expect(rules.update(c as any, regraGro.id, { categoria: 'insalubridade' as any })).rejects.toBeInstanceOf(BadRequestException);

    await markDocumentProvisionsObsolete(c as any, docId as string);
    const depois = await c.query(`SELECT status FROM normative_rules WHERE id = $1`, [regra.id]);
    expect(depois.rows[0].status).toBe('revisar');
    const depoisGro = await c.query(`SELECT status FROM normative_rules WHERE id = $1`, [regraGro.id]);
    expect(depoisGro.rows[0].status).toBe('revisar');

    // A regra gro_pgr em "revisar" pode voltar a ser revisada só com dispositivo ativo — não há mais nenhum.
    await expect(rules.review(c as any, regraGro.id, userId, 'CREA 0000')).rejects.toBeInstanceOf(BadRequestException);
    expect(await dispositivos('ativo')).toEqual([]);
    expect((await dispositivos('obsoleto')).length).toBe(3);

    const outra = await novaRegra();
    await expect(rules.setProvisions(c as any, outra.id, [{ provision_id: ativo.id, papel: 'fundamento' }])).rejects.toBeInstanceOf(BadRequestException);
  });
});
