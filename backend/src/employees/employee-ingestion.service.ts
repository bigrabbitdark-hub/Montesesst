import { BadRequestException, ConflictException, HttpException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PoolClient } from 'pg';
import { SheetField, SheetRow, parseEmployeeSheet } from './employee-sheet.parser';
import { COMPARABLE_FIELDS, Candidate, ExistingEmployee, FieldConflict, classifyRows, normalizedCpfs } from './employee-ingestion.classifier';
import { EmployeesService } from './employees.service';
import { isValidCpf, normalizeEmployeeInput } from './employee-fields.util';
import { extractBoundedText, MAX_TEXT_CHARS } from './employee-document-text';
import { sanitizeDocumentText } from './employee-text-sanitize';
import { DOCX_MIME_TYPE } from '../common/docx/docx-text.util';
import { envInt } from '../common/env';
import { LocalPerson, extractLocalPeople, hasCadastralLabels, isHealthText } from './employee-text-extractor';
import { DEFAULT_AI_MAX_PEOPLE, MAX_AI_BATCHES, buildAiBatches, needsAi, personWindowText, verifyAiPeopleWithStats } from './employee-ai-extraction';
import { EMPLOYEE_EXTRACTION_PROVIDER, EmployeeExtractionProvider } from './employee-extraction-provider.interface';

export type ExtractionStatus = 'processando' | 'aplicado' | 'requer_revisao' | 'sem_dados' | 'ilegivel' | 'erro' | 'expirado';
export interface PublicItem {
  line: number;
  kind: 'novo' | 'conflito' | 'sugestao' | 'invalida';
  full_name?: string;
  cpf_masked?: string;
  conflicts?: FieldConflict[];
  suggestions?: { field: string; proposed: string }[];
  // Só em `novo`: os campos NÃO-CPF (além do nome, que já vai no topo) que serão gravados ao aprovar; o que o revisor vê é o que será criado.
  fields?: { field: string; value: string }[];
  // Trecho de origem (texto livre), já mascarado, ≤ 200 caracteres.
  evidence?: string;
  reason?: string;
}
export interface ExtractionSummary {
  applied: number; unchanged: number; novo: number; conflito: number; invalida: number; ignored_rows: number;
  resolved?: { aplicados: number; ignorados: number };
  // Texto estático (motivo do ilegível ou frase genérica de erro); nunca conteúdo da planilha.
  detail?: string;
  method?: 'planilha' | 'texto' | 'texto+ia';
  ai_used?: boolean;
  // true quando a IA foi chamada (deu certo ou não): conta no teto diário.
  ai_attempted?: boolean;
  // true quando havia pessoas com campos faltando que não couberam nos lotes da IA.
  ai_partial?: boolean;
  // Contadores para medir o piloto da IA (só números; nunca nomes, CPF ou trechos).
  ai_items_total?: number;
  ai_items_verified?: number;
  ai_fields_applied?: number;
  ai_discarded?: Record<string, number>;
  // ISO de quando a revisão pendente expirou (job de TTL).
  expired_at?: string;
}
export interface ResolveDecision { line: number; action: 'aplicar' | 'ignorar'; fields?: string[] }
export interface ExtractionPublic {
  id: string;
  tenant_id: string;
  document_id: string;
  status: ExtractionStatus;
  summary: ExtractionSummary;
  items: PublicItem[];
  created_at: string;
  resolved_at: string | null;
  reused?: boolean;
}

interface ExtractionRow {
  id: string; tenant_id: string; document_id: string; status: ExtractionStatus; summary: ExtractionSummary;
  candidates: Candidate[]; created_at: Date | string; resolved_at: Date | string | null;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF_MIME = 'application/pdf';
const MAX_PEOPLE = 2000;
const AI_BUDGET_MS = 150_000; // orçamento TOTAL do documento
const AI_BATCH_MAX_MS = 60_000; // prazo de cada lote (limitado pelo saldo)
// Variável só para teste (ignorada em produção): encurta o prazo do lote.
const aiBatchMaxMs = () =>
  process.env.NODE_ENV !== 'production' && process.env.EMPLOYEE_INGESTION_AI_BATCH_MS
    ? Math.min(AI_BATCH_MAX_MS, Math.max(50, envInt('EMPLOYEE_INGESTION_AI_BATCH_MS', AI_BATCH_MAX_MS)))
    : AI_BATCH_MAX_MS;
const AI_PARALLEL = 2;
// Campos que a IA pode preencher (CBO e descrição da atividade não são alvo: vêm de tabela/rótulo, não de texto livre).
const AI_MERGE_FIELDS = ['full_name', 'birth_date', 'sex', 'position', 'admission_date'] as const;
// NUL nunca vai ao jsonb (o Postgres recusa \u0000): defesa em profundidade antes de gravar candidates/summary.
export function stripNul<T>(v: T): T {
  if (typeof v === 'string') return v.replace(/\u0000/g, '') as unknown as T;
  if (Array.isArray(v)) return v.map((x) => stripNul(x)) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k.replace(/\u0000/g, '')] = stripNul(x);
    return out as T;
  }
  return v;
}
// Resultado de `prepare`: o que a transação 2 precisa para gravar, sem conexão presa durante a IA.
export type PreparedExtraction =
  | { type: 'planilha'; buffer: Buffer }
  | { type: 'texto'; rows: SheetRow[]; summary: Pick<ExtractionSummary, 'method' | 'ai_used' | 'ai_attempted' | 'ai_partial' | 'detail' | 'ai_items_total' | 'ai_items_verified' | 'ai_fields_applied' | 'ai_discarded'> }
  | { type: 'terminal'; status: 'ilegivel' | 'sem_dados' | 'erro'; detail: string };
const terminal = (status: 'ilegivel' | 'sem_dados' | 'erro', detail: string): PreparedExtraction => ({ type: 'terminal', status, detail });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_SUMMARY: ExtractionSummary = { applied: 0, unchanged: 0, novo: 0, conflito: 0, invalida: 0, ignored_rows: 0 };
// Campos não-CPF de uma linha nova, em ordem fixa, já normalizados; ≤ 200 caracteres e sem corrida de 9+ dígitos.
const NOVO_FIELD_ORDER = ['birth_date', 'sex', 'position', 'admission_date', 'registration_number', 'cbo_code', 'activity_description'] as const;
// Só o que é CPF mascara: CPF VÁLIDO (com ou sem pontuação) vira ***.***.***-DD; CPF formatado, mesmo inválido, vira
// [CPF removido]. Matrícula/CBO e outros números que não são CPF aparecem INTEIROS (o revisor precisa ver o que será gravado).
const CPF_SHAPE = /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g;
const FORMATTED_CPF = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/;
const maskCpfLike = (v: string): string =>
  v.replace(CPF_SHAPE, (m) => {
    const d = m.replace(/\D/g, '');
    return isValidCpf(d) ? `***.***.***-${d.slice(-2)}` : FORMATTED_CPF.test(m) ? '[CPF removido]' : m;
  });
function novoFields(values: Record<string, string>): { field: string; value: string }[] {
  const out: { field: string; value: string }[] = [];
  for (const f of NOVO_FIELD_ORDER) {
    const v = values[f];
    if (typeof v === 'string' && v !== '') {
      const m = maskCpfLike(v);
      out.push({ field: f, value: m.length > 200 ? `${m.slice(0, 200)}…` : m }); // texto longo: prefixo + reticências
    }
  }
  return out;
}
const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : d);
const mask = (cpf: string) => `***.***.***-${cpf.slice(-2)}`;

@Injectable()
export class EmployeeIngestionService {
  private readonly logger = new Logger(EmployeeIngestionService.name);

  constructor(
    private readonly employees: EmployeesService,
    @Inject(EMPLOYEE_EXTRACTION_PROVIDER) private readonly provider: EmployeeExtractionProvider,
  ) {}

  static hash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  // Transação 1: serializa uploads do mesmo arquivo no tenant e devolve a extração em andamento/pendente, se houver.
  async findReusable(client: PoolClient, tenantId: string, hash: string): Promise<ExtractionPublic | null> {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${tenantId}:${hash}`]);
    const r = await client.query<ExtractionRow>(
      `SELECT * FROM employee_document_extractions
        WHERE tenant_id = $1 AND content_hash = $2
          AND (status = 'requer_revisao' OR (status = 'processando' AND created_at > now() - interval '10 minutes'))
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId, hash],
    );
    return r.rows[0] ? { ...this.toPublic(r.rows[0]), reused: true } : null;
  }

  // Cria a extração 'processando' na mesma transação do upload do documento.
  async createProcessing(client: PoolClient, p: { tenantId: string; documentId: string; hash: string; actorUserId: string }): Promise<string> {
    // A FK de document_id não amarra tenant: confere aqui que o documento é do tenant da extração.
    const doc = await client.query('SELECT 1 FROM documents WHERE id = $1 AND tenant_id = $2', [p.documentId, p.tenantId]);
    if (doc.rowCount === 0) throw new NotFoundException('Documento não encontrado');
    const ins = await client.query<{ id: string }>(
      `INSERT INTO employee_document_extractions (tenant_id, document_id, content_hash, status, created_by)
       VALUES ($1, $2, $3, 'processando', $4)
       ON CONFLICT (tenant_id, document_id, content_hash) DO NOTHING RETURNING id`,
      [p.tenantId, p.documentId, p.hash, p.actorUserId],
    );
    if (ins.rows[0]) return ins.rows[0].id;
    const again = await client.query<{ id: string }>(
      'SELECT id FROM employee_document_extractions WHERE tenant_id = $1 AND document_id = $2 AND content_hash = $3',
      [p.tenantId, p.documentId, p.hash],
    );
    return again.rows[0].id;
  }

  // Transação 3 (best-effort): marca a extração como erro, com texto estático.
  async markError(client: PoolClient, tenantId: string, extractionId: string, detail = 'Falha ao processar a planilha'): Promise<void> {
    await client.query(
      `UPDATE employee_document_extractions SET status = 'erro', summary = COALESCE(summary, '{}'::jsonb) || $3::jsonb
        WHERE id = $1 AND tenant_id = $2 AND status = 'processando'`,
      [extractionId, tenantId, JSON.stringify({ detail })],
    );
  }

  // Fase sem transação aberta: lê o texto, roda o extrator local e (opcional) a IA. A única consulta ao banco é a do teto
  // diário, em transação própria e curta (`runTx`); nenhuma conexão fica presa durante a chamada HTTP da IA.
  async prepare(p: {
    tenantId: string; extractionId: string; mimeType: string; buffer: Buffer;
    runTx: <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>;
  }): Promise<PreparedExtraction> {
    if (p.mimeType === XLSX_MIME) return { type: 'planilha', buffer: p.buffer };
    if (p.mimeType !== PDF_MIME && p.mimeType !== DOCX_MIME_TYPE) {
      return terminal('ilegivel', 'Esse tipo de arquivo ainda não é lido para o cadastro.');
    }
    const bounded = await extractBoundedText(p.mimeType, p.buffer, p.tenantId);
    if (bounded.status !== 'ok') return terminal(bounded.status, bounded.detail);
    const text = sanitizeDocumentText(bounded.text.slice(0, MAX_TEXT_CHARS));
    if (isHealthText(text)) return terminal('sem_dados', 'Documento com dados de saúde ocupacional não é lido para o cadastro.');
    // Uma única passada do extrator (detectCadastral roda o extrator por dentro; aqui só o critério de rótulos).
    const people = extractLocalPeople(text).slice(0, MAX_PEOPLE);
    if (people.length === 0 || !hasCadastralLabels(text)) return terminal('sem_dados', 'Nenhum funcionário identificado no documento.');

    const merged = new Map<string, Partial<Record<SheetField, string>>>();
    for (const person of people) merged.set(person.cpf, { ...person.values });
    const ai = await this.runAi(p.tenantId, p.extractionId, text, people, merged, p.runTx);

    const rows: SheetRow[] = people.map((person, i) => {
      const values = { ...(merged.get(person.cpf) ?? person.values), cpf: person.cpf } as Partial<Record<SheetField, string>>;
      // Texto livre e IA nunca auto-aplicam: TODOS os campos da linha vão para revisão.
      const reviewOnly = Object.keys(values).filter((f) => (COMPARABLE_FIELDS as readonly string[]).includes(f)) as SheetField[];
      return { line: i + 1, values, reviewOnly, evidence: person.evidence };
    });
    return {
      type: 'texto', rows,
      summary: {
        method: ai.used ? 'texto+ia' : 'texto', ai_used: ai.used, ...(ai.attempted ? { ai_attempted: true } : {}),
        ...(ai.partial ? { ai_partial: true } : {}),
        ...(ai.stats ?? {}),
        ...([bounded.detail, ai.detail].filter(Boolean).length > 0 ? { detail: [bounded.detail, ai.detail].filter(Boolean).join(' ') } : {}),
      },
    };
  }

  // IA opcional: só preenche campo que o extrator local NÃO achou ("o regex vence"); tudo vai para revisão.
  private async runAi(
    tenantId: string, extractionId: string, text: string, people: LocalPerson[], merged: Map<string, Partial<Record<SheetField, string>>>,
    runTx: <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>,
  ): Promise<{ used: boolean; attempted: boolean; partial?: boolean; detail?: string; stats?: Pick<ExtractionSummary, 'ai_items_total' | 'ai_items_verified' | 'ai_fields_applied' | 'ai_discarded'> }> {
    const none = { used: false, attempted: false };
    if (process.env.EMPLOYEE_INGESTION_AI_ENABLED !== 'true') return none;
    // Só quem a IA pode ajudar de fato (falta nome, cargo ou admissão; nascimento/sexo só se a janela tem o rótulo).
    const needy = people.filter((person) => needsAi(person, personWindowText(text, person, people)));
    if (needy.length === 0) return none;
    const batches = buildAiBatches(text, needy, { maxPeople: DEFAULT_AI_MAX_PEOPLE }).slice(0, MAX_AI_BATCHES);
    if (batches.length === 0) return { ...none, detail: 'Nenhum trecho elegível para leitura por IA.' };
    const limit = envInt('EMPLOYEE_INGESTION_AI_DAILY_LIMIT', 30);
    // Reserva atômica (UMA por documento, não por lote): sob lock por tenant, conta as tentativas das últimas 24 h e, se
    // couber, grava `ai_attempted` na extração em andamento ANTES de chamar a IA (uploads concorrentes não ultrapassam o
    // teto; o erro depois da IA continua contando).
    const reserved = await runTx(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`ai-cap:${tenantId}`]);
      const r = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM employee_document_extractions
          WHERE tenant_id = $1 AND created_at > now() - interval '24 hours'
            AND (summary->>'ai_used' = 'true' OR summary->>'ai_attempted' = 'true')`,
        [tenantId],
      );
      if (Number(r.rows[0].n) >= limit) return 'teto';
      const upd = await client.query(
        `UPDATE employee_document_extractions SET summary = COALESCE(summary, '{}'::jsonb) || '{"ai_attempted": true}'::jsonb
          WHERE id = $1 AND tenant_id = $2 AND status = 'processando'`,
        [extractionId, tenantId],
      );
      // Sem linha atualizada não há reserva: não chama a IA.
      return upd.rowCount === 1 ? 'ok' : 'falhou';
    });
    if (reserved === 'falhou') return { ...none, detail: 'Leitura por IA indisponível; o documento foi lido sem IA.' };
    if (reserved === 'teto') return { ...none, detail: 'Limite diário de leituras com IA atingido; o documento foi lido sem IA.' };

    // Lotes em fatias de 2 em paralelo; cada lote tem prazo próprio e uma falha NUNCA descarta os lotes bons.
    const deadline = Date.now() + AI_BUDGET_MS;
    const found: { cpf: string; values: Partial<Record<SheetField, string>> }[] = [];
    const totals = { items_total: 0, items_verified: 0, discarded: { cpf_ref: 0, evidence: 0, campo: 0, duplicado: 0, limite: 0 } as Record<string, number> };
    let ok = 0;
    let failed = 0;
    let skipped = 0;
    for (let i = 0; i < batches.length; i += AI_PARALLEL) {
      const slice = batches.slice(i, i + AI_PARALLEL);
      const remaining = deadline - Date.now();
      if (remaining <= 0) { skipped += slice.length; continue; }
      const batchMs = Math.min(aiBatchMaxMs(), remaining);
      await Promise.all(slice.map(async (batch) => {
        // O prazo é imposto AQUI (um provedor que ignora o deadline não segura o documento): corrida com um timer.
        let timer: NodeJS.Timeout | undefined;
        try {
          const call = Promise.resolve(this.provider.extract(batch.text, { deadlineMs: batchMs }));
          call.catch(() => undefined); // se perder a corrida, a rejeição tardia não vira "unhandled"
          const out = await Promise.race([
            call,
            new Promise<never>((_r, reject) => { timer = setTimeout(() => reject(new Error('prazo do lote')), batchMs); }),
          ]);
          const v = verifyAiPeopleWithStats(batch, out);
          found.push(...v.people);
          totals.items_total += v.stats.items_total;
          totals.items_verified += v.stats.items_verified;
          for (const [k, n] of Object.entries(v.stats.discarded)) totals.discarded[k] = (totals.discarded[k] ?? 0) + n;
          ok++;
        } catch (err) {
          // Só o tipo do erro: a mensagem pode carregar trecho do documento.
          this.logger.warn(`Lote de IA falhou na leitura do cadastro: ${(err as Error)?.name}`);
          failed++;
        } finally {
          if (timer) clearTimeout(timer);
        }
      }));
    }
    if (ok === 0) return { used: false, attempted: true, detail: 'Leitura por IA indisponível; o documento foi lido sem IA.' };

    const stats0 = { ai_items_total: totals.items_total, ai_items_verified: totals.items_verified, ai_fields_applied: 0, ai_discarded: totals.discarded };
    // `ai_used` honesto: só quando a IA acrescentou algo verificado.
    if (totals.items_verified === 0) {
      return { used: false, attempted: true, detail: 'A IA não acrescentou informações verificadas; o documento foi lido sem IA.', stats: stats0 };
    }
    let fieldsApplied = 0;
    for (const f of found) {
      const base = merged.get(f.cpf);
      if (!base) continue;
      for (const field of AI_MERGE_FIELDS) {
        const v = f.values[field];
        // Valor que não passa na normalização (data inválida, sexo estranho) é descartado aqui: nunca invalida a linha do regex.
        if (typeof v === 'string' && v !== '' && !base[field] && Object.keys(normalizeEmployeeInput({ cpf: f.cpf, full_name: 'X', [field]: v }).errors).length === 0) {
          base[field] = v;
          fieldsApplied++;
        }
      }
    }
    const covered = new Set<string>();
    for (const b of batches) for (const cpf of b.refs.values()) covered.add(cpf);
    const partial = failed > 0 || skipped > 0 || needy.some((person) => !covered.has(person.cpf));
    return {
      used: true, attempted: true,
      ...(partial ? { partial: true, detail: 'A leitura por IA cobriu só parte do documento; revise os demais.' } : {}),
      stats: { ai_items_total: totals.items_total, ai_items_verified: totals.items_verified, ai_fields_applied: fieldsApplied, ai_discarded: totals.discarded },
    };
  }

  // Transação 2 ("apply"): trava a extração, classifica contra os funcionários existentes e grava. Mantém o nome e a
  // forma da Fatia 3 (`buffer` de planilha); o controller passa `prepared` (resultado de `prepare`).
  async extract(
    client: PoolClient,
    p: { tenantId: string; extractionId: string; prepared?: PreparedExtraction; buffer?: Buffer; companyUnitId: string | null; actorUserId: string; actorRole: string },
  ): Promise<ExtractionPublic> {
    const cur = await client.query<ExtractionRow>(
      'SELECT * FROM employee_document_extractions WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
      [p.extractionId, p.tenantId],
    );
    if (!cur.rows[0]) throw new NotFoundException('Extração não encontrada');
    // Linha já finalizada: não reprocessa.
    if (cur.rows[0].status !== 'processando') return this.toPublic(cur.rows[0]);
    const id = p.extractionId;
    const prep: PreparedExtraction = p.prepared ?? { type: 'planilha', buffer: p.buffer as Buffer };

    if (prep.type === 'terminal') return this.finish(client, id, prep.status, { ...EMPTY_SUMMARY, method: 'texto', ai_used: false, detail: prep.detail }, []);

    let rows: SheetRow[];
    let ignored = 0;
    const base: ExtractionSummary = prep.type === 'planilha' ? { ...EMPTY_SUMMARY, method: 'planilha', ai_used: false } : { ...EMPTY_SUMMARY, ...prep.summary };
    if (prep.type === 'planilha') {
      const parsed = await parseEmployeeSheet(prep.buffer);
      if (parsed.formatError) return this.finish(client, id, 'ilegivel', { ...base, detail: parsed.formatError }, []);
      if (parsed.rows.length === 0) return this.finish(client, id, 'sem_dados', { ...base, ignored_rows: parsed.ignored }, []);
      rows = parsed.rows;
      ignored = parsed.ignored;
    } else {
      rows = prep.rows;
    }

    const cpfs = normalizedCpfs(rows);
    const existing = await client.query<ExistingEmployee>(
      `SELECT e.id, e.cpf, e.company_unit_id, e.full_name, e.registration_number, e.sex, e.position, e.cbo_code, e.activity_description,
              to_char(e.birth_date, 'YYYY-MM-DD') AS birth_date, to_char(e.admission_date, 'YYYY-MM-DD') AS admission_date
         FROM employees e WHERE e.tenant_id = $1 AND e.cpf = ANY($2) ORDER BY e.id FOR UPDATE OF e`,
      [p.tenantId, cpfs],
    );
    const byCpf = new Map<string, ExistingEmployee>();
    for (const e of existing.rows) byCpf.set(e.cpf.replace(/\D/g, ''), e);

    await client.query(`SELECT set_config('app.change_source', 'documento', true)`);
    const result = classifyRows(rows, byCpf, p.companyUnitId);

    let applied = 0;
    const candidates: Candidate[] = [...result.candidates];
    for (const a of result.autoApply) {
      await client.query('SAVEPOINT ing_row');
      try {
        await this.employees.update(client, a.employee_id, a.values, p.actorRole);
        await client.query('RELEASE SAVEPOINT ing_row');
        applied++;
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT ing_row');
        await client.query('RELEASE SAVEPOINT ing_row');
        if (!(err instanceof HttpException)) throw err;
        // Mensagens de HttpException do serviço de funcionários não carregam valores (ex.: "Matrícula eSocial já cadastrada").
        candidates.push({ line: a.line, kind: 'invalida', reason: err.message });
      }
    }
    candidates.sort((x, y) => x.line - y.line);

    // Itens inválidos guardam só linha e motivo.
    const stored = candidates.map((c) => (c.kind === 'invalida' ? { line: c.line, kind: c.kind, reason: c.reason } : c));
    const count = (k: Candidate['kind']) => candidates.filter((c) => c.kind === k).length;
    const summary: ExtractionSummary = {
      ...base,
      applied, unchanged: result.unchanged, novo: count('novo'), conflito: count('conflito'), invalida: count('invalida'),
      ignored_rows: ignored,
    };
    const status: ExtractionStatus = summary.novo + summary.conflito + count('sugestao') > 0 ? 'requer_revisao' : 'aplicado';
    return this.finish(client, id, status, summary, stored as Candidate[]);
  }

  private async finish(client: PoolClient, id: string, status: ExtractionStatus, summary: ExtractionSummary, candidates: Candidate[]) {
    const r = await client.query<ExtractionRow>(
      'UPDATE employee_document_extractions SET status = $2, summary = $3::jsonb, candidates = $4::jsonb WHERE id = $1 RETURNING *',
      [id, status, JSON.stringify(stripNul(summary)), JSON.stringify(stripNul(candidates))],
    );
    return this.toPublic(r.rows[0]);
  }

  // Resolve a revisão: tudo ou nada, na transação do chamador. A linha é travada (FOR UPDATE), então duas resoluções
  // simultâneas se serializam e a segunda enxerga status 'aplicado' (409).
  async resolve(
    client: PoolClient,
    id: string,
    decisions: ResolveDecision[],
    actor: { userId: string; tenantId: string; role: string },
  ): Promise<ExtractionPublic> {
    if (!UUID_RE.test(id)) throw new BadRequestException('Identificador de extração inválido');
    const cur = await client.query<ExtractionRow>('SELECT * FROM employee_document_extractions WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [id, actor.tenantId]);
    const row = cur.rows[0];
    if (!row) throw new NotFoundException('Extração não encontrada');
    if (row.status === 'expirado') throw new ConflictException('Esta revisão expirou. Reenvie o documento.');
    if (row.status !== 'requer_revisao') throw new ConflictException('Esta revisão já foi resolvida ou não está pendente');

    const all = row.candidates ?? [];
    const pending = all.filter((c) => c.kind === 'novo' || c.kind === 'conflito' || c.kind === 'sugestao');
    const byLine = new Map(pending.map((c) => [c.line, c]));
    // Um item por linha: a extração gravada com linha repetida é ambígua e nunca é aplicada.
    if (byLine.size !== pending.length) throw new BadRequestException('Esta extração tem itens duplicados. Reenvie o documento.');
    if (!Array.isArray(decisions)) throw new BadRequestException('Informe uma decisão para cada item pendente');
    const decided = new Map<number, ResolveDecision>();
    for (const d of decisions) {
      if (!d || !Number.isInteger(d.line) || (d.action !== 'aplicar' && d.action !== 'ignorar')) {
        throw new BadRequestException('Decisão inválida');
      }
      if (!byLine.has(d.line)) throw new BadRequestException('Há decisão para uma linha que não está pendente');
      if (decided.has(d.line)) throw new BadRequestException('Há mais de uma decisão para a mesma linha');
      decided.set(d.line, d);
    }
    if (decided.size !== byLine.size) throw new BadRequestException('Informe uma decisão para cada item pendente');

    // Validação completa de formato ANTES de qualquer escrita.
    for (const [line, d] of decided) {
      const c = byLine.get(line) as Candidate;
      if (d.fields !== undefined && (!Array.isArray(d.fields) || d.fields.some((f) => typeof f !== 'string'))) {
        throw new BadRequestException('fields deve ser uma lista de campos');
      }
      if (d.action === 'ignorar' || c.kind === 'novo') {
        if (d.fields !== undefined) throw new BadRequestException('fields só vale para aplicar um conflito ou sugestão');
        continue;
      }
      if (c.kind === 'conflito' && c.reason === 'outra_filial') throw new BadRequestException('Funcionário de outra filial só pode ser ignorado');
      if (c.kind !== 'conflito' && c.kind !== 'sugestao') continue;
      if (!d.fields || d.fields.length === 0) throw new BadRequestException('Informe quais campos aplicar');
      // União de conflitos e sugestões (disjuntos por campo).
      const allowed = new Set([...(c.kind === 'conflito' ? c.conflicts.map((x) => x.field) : []), ...(c.suggestions ?? []).map((x) => x.field)]);
      if (new Set(d.fields).size !== d.fields.length || d.fields.some((f) => !allowed.has(f))) {
        throw new BadRequestException('Campo informado não faz parte do conflito ou da sugestão');
      }
    }

    const staleMsg = `Os dados do funcionário mudaram desde a análise. Reenvie ${row.summary?.method && row.summary.method !== 'planilha' ? 'o documento' : 'a planilha'}.`;
    await client.query(`SELECT set_config('app.change_source', 'revisao', true)`);
    let aplicados = 0;
    let ignorados = 0;
    for (const c of pending) {
      const d = decided.get(c.line) as ResolveDecision;
      if (d.action === 'ignorar') {
        ignorados++;
        continue;
      }
      if (c.kind === 'novo') {
        const v = c.values;
        await this.employees.create(client, row.tenant_id, {
          full_name: v.full_name, cpf: v.cpf, birth_date: v.birth_date, position: v.position, admission_date: v.admission_date,
          company_unit_id: v.company_unit_id, registration_number: v.registration_number, sex: v.sex, cbo_code: v.cbo_code,
          activity_description: v.activity_description,
        }, actor.role);
      } else {
        const chosenFields = d.fields as string[];
        const conflicts = c.kind === 'conflito' ? c.conflicts.filter((x) => chosenFields.includes(x.field)) : [];
        const suggestions = (c.suggestions ?? []).filter((x) => chosenFields.includes(x.field));
        // Campos vêm da allowlist COMPARABLE_FIELDS (validados contra o item), nunca do cliente.
        const cols = [...conflicts, ...suggestions].map((x) => x.field).filter((f) => (COMPARABLE_FIELDS as readonly string[]).includes(f))
          .map((f) => (f === 'birth_date' || f === 'admission_date' ? `to_char(${f}, 'YYYY-MM-DD') AS ${f}` : f));
        const cur = await client.query<Record<string, string | null>>(
          `SELECT ${cols.join(', ')} FROM employees WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
          [c.employee_id, row.tenant_id],
        );
        const now = cur.rows[0];
        if (!now) throw new ConflictException(staleMsg);
        // Conflito: o valor atual precisa ser o que a análise viu. Sugestão: a coluna precisa continuar vazia.
        if (conflicts.some((x) => now[x.field] !== x.current) || suggestions.some((x) => now[x.field] !== null && now[x.field] !== '')) {
          throw new ConflictException(staleMsg);
        }
        const values: Record<string, string> = {};
        for (const x of [...conflicts, ...suggestions]) values[x.field] = x.proposed;
        await this.employees.update(client, c.employee_id, values, actor.role);
      }
      aplicados++;
    }

    // Só as inválidas sobrevivem (linha + motivo): nome e CPF dos itens resolvidos saem do banco.
    const kept = all.filter((c) => c.kind === 'invalida');
    const r = await client.query<ExtractionRow>(
      `UPDATE employee_document_extractions
          SET status = 'aplicado', candidates = $2::jsonb,
              summary = summary || jsonb_build_object('resolved', jsonb_build_object('aplicados', $3::int, 'ignorados', $4::int)),
              resolved_by = $5, resolved_at = now()
        WHERE id = $1 RETURNING *`,
      [id, JSON.stringify(kept), aplicados, ignorados, actor.userId],
    );
    return this.toPublic(r.rows[0]);
  }

  async get(client: PoolClient, id: string): Promise<ExtractionPublic> {
    if (!UUID_RE.test(id)) throw new BadRequestException('Identificador de extração inválido');
    const r = await client.query<ExtractionRow>('SELECT * FROM employee_document_extractions WHERE id = $1', [id]);
    if (!r.rows[0]) throw new NotFoundException('Extração não encontrada');
    return this.toPublic(r.rows[0]);
  }

  async listPending(client: PoolClient, tenantId: string): Promise<ExtractionPublic[]> {
    const r = await client.query<ExtractionRow>(
      `SELECT * FROM employee_document_extractions WHERE tenant_id = $1 AND status = 'requer_revisao' ORDER BY created_at DESC LIMIT 20`,
      [tenantId],
    );
    return r.rows.map((row) => this.toPublic(row));
  }

  // Nunca devolve CPF inteiro nem o objeto `values`.
  toPublic(row: ExtractionRow): ExtractionPublic {
    const ev = (c: { evidence?: string }) => (typeof c.evidence === 'string' && c.evidence ? { evidence: c.evidence.slice(0, 200) } : {});
    const items: PublicItem[] = (row.candidates ?? []).map((c) => {
      if (c.kind === 'novo') return { line: c.line, kind: 'novo', full_name: c.values.full_name, cpf_masked: mask(c.values.cpf), fields: novoFields(c.values), ...ev(c) };
      if (c.kind === 'conflito') {
        return {
          line: c.line, kind: 'conflito', full_name: c.full_name, cpf_masked: mask(c.cpf), conflicts: c.conflicts,
          ...(c.suggestions && c.suggestions.length > 0 ? { suggestions: c.suggestions } : {}), ...(c.reason ? { reason: c.reason } : {}), ...ev(c),
        };
      }
      if (c.kind === 'sugestao') return { line: c.line, kind: 'sugestao', full_name: c.full_name, cpf_masked: mask(c.cpf), suggestions: c.suggestions, ...ev(c) };
      return { line: c.line, kind: 'invalida', reason: c.reason };
    });
    return {
      id: row.id, tenant_id: row.tenant_id, document_id: row.document_id, status: row.status, summary: row.summary, items,
      created_at: iso(row.created_at), resolved_at: row.resolved_at ? iso(row.resolved_at) : null,
    };
  }
}
