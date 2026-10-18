import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { markDocumentProvisionsObsolete } from './provision-lifecycle';
import { PARSER_VERSION, ParseAnomaly, ParserKind, parseProvisions, toCodePointOffsets } from './provision-parser';

export interface GenerateReport {
  document_id: string;
  norma: string;
  parser_version: string;
  found: number;
  inserted: number;
  coverage: number;
  // Até MAX_ANOMALIES_IN_REPORT itens; o número real fica em anomalies_total.
  anomalies: ParseAnomaly[];
  anomalies_total: number;
}

export interface ProvisionFilters {
  documentId?: string;
  norma?: string;
  anexo?: string;
  status?: 'ativo' | 'obsoleto';
  limit?: number;
}

export interface ProvisionRow {
  id: string;
  document_id: string;
  norma: string;
  anexo: string;
  item_path: string;
  literal_text: string;
  char_start: number;
  char_end: number;
  document_hash: string;
  parser_version: string;
  status: 'ativo' | 'obsoleto';
  created_at: string;
}

const MAX_ANOMALIES_IN_REPORT = 200;

// Código da fonte → (norma normalizada, parser). NR-xx → parser de NR; CLT, LEI-<n> e DEC-<n> → parser de leis
// (norma em maiúsculas: "lei 8213" → LEI-8213, "dec-3048" → DEC-3048). O código é editado pelo admin na tela de fontes.
export function resolveKind(code: string | null): { norma: string; kind: ParserKind } {
  const c = (code ?? '').trim();
  const nr = /^NR[\s-]?(\d{1,2})$/i.exec(c);
  if (nr) return { norma: `NR-${nr[1].padStart(2, '0')}`, kind: 'nr' };
  if (/^CLT$/i.test(c)) return { norma: 'CLT', kind: 'lei' };
  const lei = /^(LEI|DEC)[\s-]?(\d{1,5})$/i.exec(c);
  if (lei) return { norma: `${lei[1].toUpperCase()}-${lei[2]}`, kind: 'lei' };
  throw new BadRequestException('Esta fonte ainda não tem parser de dispositivos (só NR-xx, CLT, LEI-<número> e DEC-<número>)');
}

// Normas cuja geração de dispositivos foi validada contra o texto real (parser-pending-report.md; NR-01 antiga e
// vigente desde 26/05/2026: gro-task1-report.md; CLT, Lei 8.213 e Decreto 3.048 extraídos do Planalto sem o texto
// riscado: prev-task1-report.md; NR-07 sem a seção falsa "3/POEIRA…" e LGPD com o art. 5: saude-task1-report.md).
// Outras normas (ex.: NR-12; Lei 8.212 e Decreto 4.882, sem aceite com texto real) só geram se listadas na env
// PROVISIONS_GENERATE_EXTRA_NORMAS (separadas por vírgula; lida a cada chamada).
export const GENERATION_ALLOWED_NORMAS = ['NR-01', 'NR-07', 'NR-15', 'NR-16', 'CLT', 'LEI-8213', 'DEC-3048', 'LEI-13709'];

// "NR-01, NR-07, …, DEC-3048 e LEI-13709" — usado nas mensagens da API e do script de geração.
export function generationAllowedLabel(): string {
  const n = GENERATION_ALLOWED_NORMAS;
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}` : n.join('');
}

export function isGenerationAllowed(norma: string): boolean {
  const extras = (process.env.PROVISIONS_GENERATE_EXTRA_NORMAS ?? '')
    .split(',')
    .map((n) => n.trim().toUpperCase())
    .filter((n) => n !== '');
  return GENERATION_ALLOWED_NORMAS.includes(norma) || extras.includes(norma.toUpperCase());
}

@Injectable()
export class ProvisionsService {
  async generate(client: PoolClient, documentId: string): Promise<GenerateReport> {
    const found = await client.query<{ id: string; status: string; content_hash: string; raw_text: string; code: string | null }>(
      `SELECT d.id, d.status, d.content_hash, d.raw_text, s.code
       FROM normative_documents d JOIN official_sources s ON s.id = d.source_id
       WHERE d.id = $1`,
      [documentId],
    );
    const doc = found.rows[0];
    if (!doc) throw new NotFoundException('Documento normativo não encontrado');
    if (doc.status !== 'vigente') throw new BadRequestException('Só documentos vigentes geram dispositivos');
    const { norma, kind } = resolveKind(doc.code);
    if (!isGenerationAllowed(norma)) {
      throw new BadRequestException(`Geração de dispositivos ainda não validada para ${norma} (parser validado só para ${generationAllowedLabel()})`);
    }

    const result = parseProvisions(doc.raw_text, kind);

    const outraVersao = await client.query(
      `SELECT 1 FROM normative_provisions WHERE document_id = $1 AND status = 'ativo' AND parser_version <> $2 LIMIT 1`,
      [documentId, PARSER_VERSION],
    );
    if (outraVersao.rows.length > 0) await markDocumentProvisionsObsolete(client, documentId);

    let inserted = 0;
    if (result.provisions.length > 0) {
      const p = result.provisions;
      // Grava em pontos de código (compatível com substring do Postgres); o parser e seu invariante seguem em UTF-16.
      const cp = toCodePointOffsets(doc.raw_text, p.flatMap((x) => [x.char_start, x.char_end]));
      const ins = await client.query(
        `INSERT INTO normative_provisions (document_id, norma, anexo, item_path, literal_text, char_start, char_end, document_hash, parser_version)
         SELECT $1::uuid, $2::text, t.anexo, t.item_path, t.literal_text, t.char_start, t.char_end, $3::text, $4::text
         FROM unnest($5::text[], $6::text[], $7::text[], $8::int[], $9::int[]) AS t(anexo, item_path, literal_text, char_start, char_end)
         ON CONFLICT (document_id, anexo, item_path, parser_version) DO NOTHING`,
        [
          documentId,
          norma,
          doc.content_hash,
          PARSER_VERSION,
          p.map((x) => x.anexo),
          p.map((x) => x.item_path),
          p.map((x) => x.literal_text),
          p.map((_, i) => cp[2 * i]),
          p.map((_, i) => cp[2 * i + 1]),
        ],
      );
      inserted = ins.rowCount ?? 0;
    }

    return {
      document_id: documentId,
      norma,
      parser_version: PARSER_VERSION,
      found: result.provisions.length,
      inserted,
      coverage: result.coverage,
      anomalies: result.anomalies.slice(0, MAX_ANOMALIES_IN_REPORT),
      anomalies_total: result.anomalies.length,
    };
  }

  async list(client: PoolClient, filters: ProvisionFilters): Promise<ProvisionRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (cond: string, value: unknown) => {
      params.push(value);
      where.push(cond.replace('?', `$${params.length}`));
    };
    if (filters.documentId) add('document_id = ?', filters.documentId);
    if (filters.norma) add('norma = ?', filters.norma);
    if (filters.anexo !== undefined) add('anexo = ?', filters.anexo);
    add('status = ?', filters.status ?? 'ativo');
    params.push(Math.min(filters.limit ?? 200, 500));
    const result = await client.query<ProvisionRow>(
      `SELECT * FROM normative_provisions WHERE ${where.join(' AND ')} ORDER BY norma, anexo, char_start LIMIT $${params.length}`,
      params,
    );
    return result.rows;
  }
}
