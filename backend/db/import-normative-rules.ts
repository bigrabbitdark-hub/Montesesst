import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { AREAS, categoriaValidaParaArea, isRuleArea, RuleArea } from '../src/normative/normative-rule-areas';
import { METODOS } from '../src/normative/dto/create-normative-rule.dto';
import { RulePapel, RuleStatus } from '../src/normative/normative-rules.service';
import { isRevokedLiteral } from '../src/normative/provision-parser';

// Importador de regras interpretativas versionadas no git (spec 2026-10-09-base-normativa-gro-pgr-design.md §3.4).
// Comando manual, mesmo padrão de db/generate-provisions.ts (standalone, sem Nest DI).
// Dry-run por padrão e SOMENTE LEITURA (BEGIN READ ONLY): imprime o plano. Só --apply grava, numa transação, e só
// com autorização do proprietário (AGENTS.md).
// Garantias: idempotente por rule_key; só cria/atualiza regra em 'rascunho' (NUNCA toca 'revisada'/'revisar'/
// 'retirada' e NUNCA grava 'revisada'); cada ligação é resolvida por (norma, anexo, item_path) entre dispositivos
// 'ativo' de documentos 'vigente' E o literal_text do dispositivo tem de conter o fragmento `contem` da ligação
// (espaços normalizados, caixa sensível) — protege contra item RENUMERADO entre versões da norma (ex.: NR-01 antiga,
// onde 1.5.4.4.3 trata de outro assunto). Se alguma ligação não resolver, for ambígua ou não contiver o fragmento,
// nada é gravado. Ligação a dispositivo REVOGADO (isRevokedLiteral: "(Revogado…)", "Revogado.", "I - revogado;",
// "(Declarado inconstitucional…)") também aborta, mesmo que o fragmento case: não há texto vigente a citar.
// ATENÇÃO: atualizar uma regra em 'rascunho' SUBSTITUI as ligações dela pelas do seed; ligações feitas à mão nessa
// regra (pela tela/rota) se perdem. Regras fora de 'rascunho' nunca são tocadas.

export const DEFAULT_SEED_PATH = join(__dirname, 'seed-data', 'normative-rules', 'gro-pgr.json');
export const SEM_FUNDAMENTO = 'sem fundamento literal verificado';
export const ROTULO_RASCUNHO = '[RASCUNHO';

const PAPEIS: readonly RulePapel[] = ['fundamento', 'criterio', 'excecao', 'metodo'];
const RULE_KEY_RE = /^[A-Z0-9][A-Z0-9_.-]{2,79}$/;
// Prefixos aceitos de rule_key por área (null = sem prefixo obrigatório; a área lip não tem seed versionado).
const PREFIXOS_POR_AREA: Record<RuleArea, readonly string[] | null> = {
  lip: null,
  gro_pgr: ['GRO-', 'PGR-'],
  previdenciario: ['PREV-'],
  saude_ocupacional: ['SAU-'],
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface SeedLink {
  norma: string;
  anexo: string;
  item_path: string;
  papel: RulePapel;
  // Trecho literal curto, copiado do texto da norma, que o dispositivo resolvido tem de conter.
  contem: string;
}

export interface SeedRule {
  rule_key: string;
  area: RuleArea;
  categoria: string;
  agente_ou_atividade: string;
  metodo_avaliacao: (typeof METODOS)[number];
  unidade?: string | null;
  criterio: string;
  excecoes?: string | null;
  dependencias?: unknown[];
  interpretacao: string;
  exige_revisao_profissional: boolean;
  vigencia_inicio?: string | null;
  vigencia_fim?: string | null;
  status: 'rascunho';
  provisions: SeedLink[];
}

export interface Seed {
  schema_version: 1;
  descricao: string;
  fonte?: Record<string, unknown>;
  rules: SeedRule[];
}

export interface ExistingRule {
  id: string;
  rule_key: string;
  area: string;
  categoria: string;
  agente_ou_atividade: string;
  metodo_avaliacao: string;
  unidade: string | null;
  criterio: string;
  excecoes: string | null;
  dependencias: unknown[];
  interpretacao: string;
  exige_revisao_profissional: boolean;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  status: RuleStatus;
  links: { provision_id: string; papel: RulePapel }[];
}

export interface ResolvedProvision {
  id: string;
  norma: string;
  anexo: string;
  item_path: string;
  literal_text: string;
}

// Dispositivos de um texto parseado (ex.: parseProvisions do fixture), para validateSeed conferir as ligações em memória.
export interface ParsedText {
  norma: string;
  provisions: { anexo: string; item_path: string; literal_text: string }[];
}

export interface PlannedLink extends SeedLink {
  provision_id: string;
}

export interface PlanItem {
  action: 'criar' | 'atualizar' | 'inalterada' | 'ignorada';
  rule_key: string;
  rule: SeedRule;
  existing_id?: string;
  motivo?: string;
  links: PlannedLink[];
}

export interface ImportPlan {
  errors: string[];
  items: PlanItem[];
}

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

const RULE_FIELDS = [
  'rule_key',
  'area',
  'categoria',
  'agente_ou_atividade',
  'metodo_avaliacao',
  'unidade',
  'criterio',
  'excecoes',
  'dependencias',
  'interpretacao',
  'exige_revisao_profissional',
  'vigencia_inicio',
  'vigencia_fim',
  'status',
  'provisions',
] as const;
const LINK_FIELDS = ['norma', 'anexo', 'item_path', 'papel', 'contem'] as const;

// Mesmos limites do CreateNormativeRuleDto.
const MAX_LEN: Partial<Record<(typeof RULE_FIELDS)[number], number>> = {
  agente_ou_atividade: 300,
  unidade: 100,
  criterio: 5000,
  excecoes: 5000,
  interpretacao: 10000,
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const naoVazio = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

// Junta qualquer sequência de espaços/quebras de linha num espaço só (dos dois lados da comparação).
export const normalizeWs = (s: string): string => s.replace(/\s+/g, ' ').trim();
export const contemFragmento = (literal: string, fragmento: string): boolean => normalizeWs(literal).includes(normalizeWs(fragmento));

const NAO_ENCONTRADA = 'ligação não encontrada';
const msgDescasada = (fragmento: string) => `endereço resolve, mas o texto não contém "${fragmento}"`;

// Mesma conferência do planImport: 0 → não encontrada; >1 → ambígua; 1 revogado → revogado; 1 sem o fragmento → descasada.
function conferirLigacao(onde: string, hits: { literal_text: string }[], contem: string, contexto: string): string | null {
  if (hits.length === 0) return `${onde}: ${NAO_ENCONTRADA} (${contexto})`;
  if (hits.length > 1) return `${onde}: ambíguo (${hits.length} dispositivos)`;
  if (isRevokedLiteral(hits[0].literal_text)) return `${onde}: dispositivo revogado ("${normalizeWs(hits[0].literal_text).slice(0, 120)}")`;
  if (!contemFragmento(hits[0].literal_text, contem)) return `${onde}: ${msgDescasada(contem)}`;
  return null;
}

// Validação estrutural, sem banco. Devolve a lista de erros (vazia = válido). Com `texto` (dispositivos de um texto
// parseado em memória), confere também cada ligação daquela norma: existe, é única e contém o fragmento `contem`.
export function validateSeed(seed: unknown, texto?: ParsedText): string[] {
  const errs: string[] = [];
  if (!isObj(seed)) return ['seed: precisa ser um objeto JSON'];
  if (seed.schema_version !== 1) errs.push('seed: schema_version deve ser 1');
  if (!Array.isArray(seed.rules)) return [...errs, 'seed: "rules" deve ser uma lista'];
  const vistas = new Set<string>();
  seed.rules.forEach((r: unknown, i: number) => {
    const at = `rules[${i}]`;
    if (!isObj(r)) {
      errs.push(`${at}: precisa ser um objeto`);
      return;
    }
    const key = typeof r.rule_key === 'string' ? r.rule_key : '';
    const w = `${at} (${key || '?'})`;
    for (const k of Object.keys(r)) if (!(RULE_FIELDS as readonly string[]).includes(k)) errs.push(`${w}: campo desconhecido "${k}"`);
    if (!RULE_KEY_RE.test(key)) errs.push(`${w}: rule_key deve ter 3-80 caracteres: A-Z, 0-9, _ . -`);
    if (vistas.has(key)) errs.push(`${w}: rule_key duplicada`);
    vistas.add(key);
    if (!isRuleArea(r.area)) errs.push(`${w}: area inválida; use uma de: ${AREAS.join(', ')}`);
    else {
      const prefixos = PREFIXOS_POR_AREA[r.area];
      if (prefixos && !prefixos.some((p) => key.startsWith(p))) {
        errs.push(`${w}: rule_key da área ${r.area} deve começar com ${prefixos.join(' ou ')}`);
      }
      if (!categoriaValidaParaArea(r.area, r.categoria)) errs.push(`${w}: categoria '${String(r.categoria)}' não pertence à área '${r.area}'`);
    }
    if (!(METODOS as readonly unknown[]).includes(r.metodo_avaliacao)) errs.push(`${w}: metodo_avaliacao inválido`);
    if (r.status !== 'rascunho') errs.push(`${w}: status deve ser 'rascunho' (o seed nunca grava revisão)`);
    if (r.exige_revisao_profissional !== true) errs.push(`${w}: exige_revisao_profissional deve ser true`);
    for (const f of ['agente_ou_atividade', 'criterio', 'interpretacao'] as const) if (!naoVazio(r[f])) errs.push(`${w}: ${f} obrigatório`);
    for (const f of ['unidade', 'excecoes'] as const) {
      if (r[f] !== undefined && r[f] !== null && !naoVazio(r[f])) errs.push(`${w}: ${f} deve ser texto não vazio ou ausente`);
    }
    for (const [f, max] of Object.entries(MAX_LEN)) {
      const v = r[f];
      if (typeof v === 'string' && v.length > (max as number)) errs.push(`${w}: ${f} excede ${max} caracteres`);
    }
    if (r.dependencias !== undefined && (!Array.isArray(r.dependencias) || r.dependencias.length > 50)) {
      errs.push(`${w}: dependencias deve ser lista (máx. 50)`);
    }
    for (const f of ['vigencia_inicio', 'vigencia_fim'] as const) {
      if (r[f] !== undefined && r[f] !== null && !(typeof r[f] === 'string' && DATE_RE.test(r[f] as string))) {
        errs.push(`${w}: ${f} deve ser AAAA-MM-DD`);
      }
    }
    if (typeof r.interpretacao === 'string' && !r.interpretacao.startsWith(ROTULO_RASCUNHO)) {
      errs.push(`${w}: interpretacao deve começar com o rótulo "${ROTULO_RASCUNHO} …]"`);
    }
    if (!Array.isArray(r.provisions)) {
      errs.push(`${w}: provisions deve ser uma lista (vazia só com a nota "${SEM_FUNDAMENTO}")`);
      return;
    }
    if (r.provisions.length === 0 && !(typeof r.interpretacao === 'string' && r.interpretacao.includes(SEM_FUNDAMENTO))) {
      errs.push(`${w}: regra sem ligação literal precisa da nota "${SEM_FUNDAMENTO}" na interpretacao`);
    }
    if (r.provisions.length > 100) errs.push(`${w}: no máximo 100 ligações`);
    const ligacoes = new Set<string>();
    r.provisions.forEach((l: unknown, j: number) => {
      const lw = `${w}.provisions[${j}]`;
      if (!isObj(l)) {
        errs.push(`${lw}: precisa ser um objeto`);
        return;
      }
      for (const k of Object.keys(l)) if (!(LINK_FIELDS as readonly string[]).includes(k)) errs.push(`${lw}: campo desconhecido "${k}"`);
      if (!naoVazio(l.norma)) errs.push(`${lw}: norma obrigatória`);
      if (typeof l.anexo !== 'string') errs.push(`${lw}: anexo deve ser texto ('' = corpo da norma)`);
      if (!naoVazio(l.item_path)) errs.push(`${lw}: item_path obrigatório`);
      if (!(PAPEIS as readonly unknown[]).includes(l.papel)) errs.push(`${lw}: papel inválido; use um de: ${PAPEIS.join(', ')}`);
      if (!naoVazio(l.contem)) errs.push(`${lw}: contem obrigatório (trecho literal curto do dispositivo)`);
      else if (texto && l.norma === texto.norma && typeof l.anexo === 'string' && naoVazio(l.item_path)) {
        const hits = texto.provisions.filter((p) => p.anexo === l.anexo && p.item_path === l.item_path);
        const e = conferirLigacao(`${lw} ${l.norma} anexo '${l.anexo}' item ${l.item_path}`, hits, l.contem, 'no texto informado');
        if (e) errs.push(e);
      }
      const k = `${String(l.norma)}|${String(l.anexo)}|${String(l.item_path)}|${String(l.papel)}`;
      if (ligacoes.has(k)) errs.push(`${lw}: ligação repetida`);
      ligacoes.add(k);
    });
  });
  return errs;
}

const linkKey = (norma: string, anexo: string, item: string) => `${norma}|${anexo}|${item}`;
const nul = <T>(v: T | undefined | null): T | null => (v === undefined ? null : v);

function sameContent(rule: SeedRule, ex: ExistingRule, links: PlannedLink[]): boolean {
  const pares: [unknown, unknown][] = [
    [rule.categoria, ex.categoria],
    [rule.agente_ou_atividade, ex.agente_ou_atividade],
    [rule.metodo_avaliacao, ex.metodo_avaliacao],
    [nul(rule.unidade), nul(ex.unidade)],
    [rule.criterio, ex.criterio],
    [nul(rule.excecoes), nul(ex.excecoes)],
    [JSON.stringify(rule.dependencias ?? []), JSON.stringify(ex.dependencias ?? [])],
    [rule.interpretacao, ex.interpretacao],
    [rule.exige_revisao_profissional, ex.exige_revisao_profissional],
    [nul(rule.vigencia_inicio), nul(ex.vigencia_inicio)],
    [nul(rule.vigencia_fim), nul(ex.vigencia_fim)],
  ];
  if (pares.some(([a, b]) => a !== b)) return false;
  const a = [...new Set(links.map((l) => `${l.provision_id}|${l.papel}`))].sort();
  const b = [...new Set(ex.links.map((l) => `${l.provision_id}|${l.papel}`))].sort();
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// Função pura: decide o que fazer com cada regra. Com `errors` não vazio, nada pode ser gravado.
export function planImport(seed: Seed, existingRules: ExistingRule[], resolvedProvisions: ResolvedProvision[]): ImportPlan {
  const errors = validateSeed(seed);
  if (errors.length > 0) return { errors, items: [] };

  const porChave = new Map<string, ResolvedProvision[]>();
  for (const p of resolvedProvisions) {
    const k = linkKey(p.norma, p.anexo, p.item_path);
    porChave.set(k, [...(porChave.get(k) ?? []), p]);
  }
  const existentes = new Map(existingRules.map((r) => [r.rule_key, r]));

  const items: PlanItem[] = [];
  for (const rule of seed.rules) {
    const links: PlannedLink[] = [];
    for (const l of rule.provisions) {
      const hits = porChave.get(linkKey(l.norma, l.anexo, l.item_path)) ?? [];
      const onde = `${rule.rule_key} → ${l.norma} anexo '${l.anexo}' item ${l.item_path}`;
      const e = conferirLigacao(onde, hits, l.contem, 'nenhum dispositivo ativo de documento vigente');
      if (e) errors.push(e);
      else links.push({ ...l, provision_id: hits[0].id });
    }
    const ex = existentes.get(rule.rule_key);
    if (!ex) {
      items.push({ action: 'criar', rule_key: rule.rule_key, rule, links });
      continue;
    }
    if (ex.area !== rule.area) {
      errors.push(`${rule.rule_key}: já existe na área '${ex.area}' (a área é imutável; seed diz '${rule.area}')`);
      continue;
    }
    if (ex.status !== 'rascunho') {
      items.push({ action: 'ignorada', rule_key: rule.rule_key, rule, existing_id: ex.id, motivo: `status '${ex.status}' (o importador só altera rascunho)`, links });
      continue;
    }
    const action = sameContent(rule, ex, links) ? 'inalterada' : 'atualizar';
    items.push({ action, rule_key: rule.rule_key, rule, existing_id: ex.id, links });
  }
  return { errors, items };
}

function ruleParams(r: SeedRule): unknown[] {
  return [
    r.categoria,
    r.agente_ou_atividade,
    r.metodo_avaliacao,
    nul(r.unidade),
    r.criterio,
    nul(r.excecoes),
    JSON.stringify(r.dependencias ?? []),
    r.interpretacao,
    r.exige_revisao_profissional,
    nul(r.vigencia_inicio),
    nul(r.vigencia_fim),
  ];
}

async function insertLinks(client: Queryable, ruleId: string, links: PlannedLink[]): Promise<void> {
  for (const l of links) {
    await client.query(
      `INSERT INTO normative_rule_provisions (rule_id, provision_id, papel) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [ruleId, l.provision_id, l.papel],
    );
  }
}

// Executa um plano sem erros dentro da transação do chamador. Toda escrita é condicionada a status 'rascunho'.
export async function executePlan(client: Queryable, plan: ImportPlan): Promise<{ criadas: number; atualizadas: number }> {
  if (plan.errors.length > 0) throw new Error('plano com erros: nada foi gravado');
  let criadas = 0;
  let atualizadas = 0;
  for (const item of plan.items) {
    if (item.action === 'criar') {
      const res = await client.query(
        `INSERT INTO normative_rules (rule_key, area, categoria, agente_ou_atividade, metodo_avaliacao, unidade, criterio, excecoes,
                                      dependencias, interpretacao, exige_revisao_profissional, vigencia_inicio, vigencia_fim, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, 'rascunho')
         ON CONFLICT (rule_key) DO NOTHING RETURNING id`,
        [item.rule.rule_key, item.rule.area, ...ruleParams(item.rule)],
      );
      if (!res.rows[0]) throw new Error(`${item.rule_key}: criada por outro processo durante a importação; rode de novo`);
      await insertLinks(client, res.rows[0].id, item.links);
      criadas++;
    } else if (item.action === 'atualizar') {
      const res = await client.query(
        `UPDATE normative_rules
         SET categoria = $2, agente_ou_atividade = $3, metodo_avaliacao = $4, unidade = $5, criterio = $6, excecoes = $7,
             dependencias = $8::jsonb, interpretacao = $9, exige_revisao_profissional = $10, vigencia_inicio = $11, vigencia_fim = $12,
             updated_at = now()
         WHERE id = $1 AND status = 'rascunho' RETURNING id`,
        [item.existing_id, ...ruleParams(item.rule)],
      );
      if (!res.rows[0]) throw new Error(`${item.rule_key}: deixou de estar em rascunho durante a importação; nada foi gravado`);
      await client.query('DELETE FROM normative_rule_provisions WHERE rule_id = $1', [item.existing_id]);
      await insertLinks(client, item.existing_id as string, item.links);
      atualizadas++;
    }
  }
  return { criadas, atualizadas };
}

async function loadExisting(client: Queryable, keys: string[], forUpdate: boolean): Promise<ExistingRule[]> {
  const rules = await client.query(
    `SELECT id, rule_key, area, categoria, agente_ou_atividade, metodo_avaliacao, unidade, criterio, excecoes, dependencias,
            interpretacao, exige_revisao_profissional, vigencia_inicio::text AS vigencia_inicio, vigencia_fim::text AS vigencia_fim, status
     FROM normative_rules WHERE rule_key = ANY($1::text[]) ORDER BY rule_key${forUpdate ? ' FOR UPDATE' : ''}`,
    [keys],
  );
  if (rules.rows.length === 0) return [];
  const links = await client.query(
    `SELECT rule_id, provision_id, papel FROM normative_rule_provisions WHERE rule_id = ANY($1::uuid[])`,
    [rules.rows.map((r) => r.id)],
  );
  return rules.rows.map((r) => ({
    ...r,
    links: links.rows.filter((l) => l.rule_id === r.id).map((l) => ({ provision_id: l.provision_id, papel: l.papel })),
  }));
}

async function loadProvisions(client: Queryable, normas: string[]): Promise<ResolvedProvision[]> {
  const res = await client.query(
    `SELECT p.id, p.norma, p.anexo, p.item_path, p.literal_text
     FROM normative_provisions p JOIN normative_documents d ON d.id = p.document_id
     WHERE p.status = 'ativo' AND d.status = 'vigente' AND p.norma = ANY($1::text[])`,
    [normas],
  );
  return res.rows;
}

export interface ImportResult {
  plan: ImportPlan;
  aborted: boolean;
  applied: boolean;
  criadas: number;
  atualizadas: number;
}

// Dry-run: BEGIN READ ONLY … ROLLBACK. --apply: BEGIN … COMMIT; com erro no plano, ROLLBACK sem escrever nada.
export async function runImport(client: Queryable, seed: Seed, opts: { apply: boolean }): Promise<ImportResult> {
  await client.query(opts.apply ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    const keys = Array.isArray(seed?.rules) ? seed.rules.map((r) => r.rule_key) : [];
    const normas = Array.isArray(seed?.rules) ? [...new Set(seed.rules.flatMap((r) => (r.provisions ?? []).map((l) => l.norma)))] : [];
    const existing = await loadExisting(client, keys, opts.apply);
    const provisions = normas.length > 0 ? await loadProvisions(client, normas) : [];
    const plan = planImport(seed, existing, provisions);
    if (plan.errors.length > 0 || !opts.apply) {
      await client.query('ROLLBACK');
      return { plan, aborted: plan.errors.length > 0, applied: false, criadas: 0, atualizadas: 0 };
    }
    const { criadas, atualizadas } = await executePlan(client, plan);
    await client.query('COMMIT');
    return { plan, aborted: false, applied: true, criadas, atualizadas };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}

export function formatPlan(res: ImportResult): string {
  const { plan } = res;
  if (plan.errors.length > 0) {
    return [`ABORTADO: ${plan.errors.length} erro(s); nada foi gravado`, ...plan.errors.map((e) => `  ! ${e}`)].join('\n');
  }
  const conta = (a: PlanItem['action']) => plan.items.filter((i) => i.action === a).length;
  return [
    ...plan.items.map((i) => {
      const lig = i.links.map((l) => `${l.norma}${l.anexo ? ` anexo ${l.anexo}` : ''} ${l.item_path} (${l.papel})`).join('; ');
      return `  ${i.action.padEnd(10)} ${i.rule_key}${i.motivo ? ` — ${i.motivo}` : ''}${lig ? `\n             ligações: ${lig}` : ''}`;
    }),
    `criar: ${conta('criar')} | atualizar: ${conta('atualizar')} | inalteradas: ${conta('inalterada')} | ignoradas: ${conta('ignorada')} | ligações: ${plan.items.reduce((s, i) => s + i.links.length, 0)}`,
  ].join('\n');
}

export function parseArgs(argv: string[]): { seedPath: string; apply: boolean } {
  const desconhecidas = argv.filter((a) => a.startsWith('--') && a !== '--apply');
  if (desconhecidas.length > 0) throw new Error(`opção desconhecida: ${desconhecidas.join(' ')}`);
  return { apply: argv.includes('--apply'), seedPath: argv.find((a) => !a.startsWith('--')) ?? DEFAULT_SEED_PATH };
}

async function main() {
  const { seedPath, apply } = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não definida');
  const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as Seed;
  const invalid = validateSeed(seed);
  if (invalid.length > 0) throw new Error(`seed inválido (${seedPath}):\n${invalid.map((e) => `  ! ${e}`).join('\n')}`);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const res = await runImport(client, seed, { apply });
    console.log(formatPlan(res));
    if (res.aborted) {
      process.exitCode = 1;
      return;
    }
    console.log(
      res.applied
        ? `[apply] gravado: ${res.criadas} criada(s), ${res.atualizadas} atualizada(s), todas em rascunho`
        : '[dry-run] somente leitura; nada foi gravado (use --apply com autorização)',
    );
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    // Só a mensagem: nunca imprimir DATABASE_URL nem o objeto de conexão.
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
