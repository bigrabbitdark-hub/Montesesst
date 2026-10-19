import { randomBytes, randomUUID } from 'crypto';
import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { R2Service } from '../common/r2/r2.service';
import { canonicalJson, sha256Hex } from './canonical-json.util';
import { maskCpf } from './cpf-mask.util';
import { IssueFichaDto } from './dto/issue-ficha.dto';
import { EPI_TERM } from './epi-ficha-term';
import { Ficha, FichaDocumentRow, DocumentRef, FichaFilters, FichaLine, FichaSignature, FichaSignatureImageRef, VerifyStatus } from './epi-ficha.types';
import { buildFichaPdf, MAX_SIGNATURE_IMAGES } from './ficha-pdf.util';
import { selectImagesWithinBudget } from './signature-image-budget.util';

export const MAX_FICHA_LINES = 1000;
const TZ = `'America/Sao_Paulo'`;

// Prazos (sobrescrevíveis por env, lidos a cada chamada para os testes poderem encurtá-los).
const envMs = (name: string, def: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : def;
};

// Orçamento TOTAL da seção sob a trava do funcionário (leitura das imagens + PUT do PDF + delete best-effort). Cada operação de
// R2 usa min(EPI_FICHA_R2_TIMEOUT_MS, restante do orçamento); sem orçamento restante, falha com 502 e nada é registrado.
class LockedBudget {
  private readonly end: number;
  constructor(ms: number) { this.end = Date.now() + ms; }
  remaining(): number { return this.end - Date.now(); }
  // prazo de uma operação de R2: o menor entre o prazo individual e o que sobra do orçamento (<= 0: orçamento esgotado)
  opTimeout(): number { return Math.min(envMs('EPI_FICHA_R2_TIMEOUT_MS', 8000), this.remaining()); }
}

// AAAAMMDD no fuso America/Sao_Paulo (a mesma data que o leitor vê no rodapé do PDF).
function saoPauloYmd(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day}`;
}

@Injectable()
export class EpiFichaService {
  private readonly logger = new Logger(EpiFichaService.name);

  constructor(private readonly r2: R2Service) {}

  // Pontos de extensão simples (relógio e gerador de código) para os testes controlarem data e colisão.
  protected now(): Date {
    return new Date();
  }

  protected newDocumentCode(at: Date): string {
    return `FEPI-${saoPauloYmd(at)}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  // Emite uma nova versão imutável da ficha: PDF no R2 + registro com instantâneo (sem CPF completo).
  // O tenant do documento vem da LINHA do funcionário lida sob RLS (nunca do corpo). A trava FOR NO KEY UPDATE no
  // funcionário serializa a numeração de versões. Mensagens de erro nunca carregam dado pessoal.
  async issue(client: PoolClient, employeeId: string, dto: IssueFichaDto, userId: string): Promise<{ doc: FichaDocumentRow; replayed: boolean }> {
    // FOR NO KEY UPDATE serializa as emissões entre si sem bloquear os FOR KEY SHARE de inserts em movimentos/entregas.
    // lock_timeout evita prender a conexão do pool atrás de outra emissão lenta (55P03 -> 503, nunca 500).
    await client.query(`SET LOCAL lock_timeout = ${envMs('EPI_FICHA_LOCK_TIMEOUT_MS', 5000)}`);
    let lock;
    try {
      lock = await client.query('SELECT id, tenant_id FROM employees WHERE id = $1 FOR NO KEY UPDATE', [employeeId]);
    } catch (err) {
      if ((err as { code?: string }).code === '55P03') {
        throw new ServiceUnavailableException('Já existe uma emissão em andamento para este funcionário; tente novamente');
      }
      throw err;
    }
    await client.query('SET LOCAL lock_timeout TO DEFAULT');
    const budget = new LockedBudget(envMs('EPI_FICHA_LOCKED_BUDGET_MS', 15000)); // a partir daqui a trava está em poder desta emissão
    const emp = lock.rows[0];
    if (!emp) throw new NotFoundException('Funcionário não encontrado');
    const filters = cleanFilters({ from: dto.from, to: dto.to, signature_status: dto.signature_status as FichaFilters['signature_status'] });

    // Repetição idempotente: mesma chave, mesmo funcionário e mesmos filtros -> o documento existente.
    const prev = await client.query(`SELECT id, employee_id, version, document_code, file_sha256, snapshot_sha256, term_version, issued_by_user_id, issued_at,
              snapshot->'filters' AS filters
       FROM epi_ficha_documents WHERE tenant_id = $1 AND idempotency_key = $2`, [emp.tenant_id, dto.idempotency_key]);
    if (prev.rows[0]) {
      const p = prev.rows[0];
      if (p.employee_id !== employeeId || canonicalJson(p.filters ?? {}) !== canonicalJson(filters)) {
        throw new ConflictException('Chave de idempotência já usada em outra operação');
      }
      return { doc: toDocumentRow(p), replayed: true };
    }

    const v = await client.query('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM epi_ficha_documents WHERE employee_id = $1', [employeeId]);
    const version = Number(v.rows[0].next);
    const at = this.now();
    const issuedAt = at.toISOString();
    const code = this.newDocumentCode(at);

    // Instantâneo congelado: getFicha já devolve cpf_masked (nunca o CPF completo); sem file_key.
    const { ficha, imageRefs } = await this.loadFicha(client, employeeId, filters);
    // O instantâneo guarda só código, data e hashes das assinaturas (nunca a chave do arquivo da imagem: ela fica em imageRefs).
    const snapshot = { ...ficha, filters, version, document_code: code, issued_at: issuedAt, issued_by_user_id: userId };
    const snapshotHash = sha256Hex(canonicalJson(snapshot));
    // Imagens lidas ANTES do PDF e do PUT: falha/timeout aqui -> 502 sem registro e sem nada para limpar no R2.
    const { images, omitted } = await this.readSignatureImages(imageRefs, budget);
    const pdf = await buildFichaPdf(snapshot, { preview: false, documentCode: code, version, issuedAt, snapshotHash, omittedImages: omitted }, images);
    const fileHash = sha256Hex(pdf);

    // R2 primeiro; se o registro falhar depois, o arquivo é removido (nunca documento pela metade).
    // A chave do R2 é única por emissão (UUID): nunca sobrescreve nem apaga o arquivo de outro documento.
    const key = `tenants/${emp.tenant_id}/epi-fichas/${employeeId}/v${version}-${randomUUID()}.pdf`;
    try {
      await this.putWithTimeout(key, pdf, budget);
    } catch (err) {
      this.logger.error(`Falha ao gravar a ficha no R2 (${code}): ${(err as Error).message === 'timeout' ? 'tempo esgotado' : 'erro'}`);
      await this.bestEffortDelete(key, budget); // best-effort: o PUT pode ter chegado ao R2 mesmo após o timeout
      throw new BadGatewayException('Não foi possível guardar o documento');
    }
    try {
      const ins = await client.query(
        `INSERT INTO epi_ficha_documents (tenant_id, employee_id, version, document_code, file_key, file_sha256,
           snapshot_sha256, snapshot, term_version, issued_by_user_id, issued_at, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12) RETURNING *`,
        [emp.tenant_id, employeeId, version, code, key, fileHash, snapshotHash, JSON.stringify(snapshot), ficha.term.version, userId, issuedAt, dto.idempotency_key],
      );
      return { doc: toDocumentRow(ins.rows[0]), replayed: false };
    } catch (err) {
      await this.bestEffortDelete(key, budget);
      return mapPgError(err);
    }
  }

  // Lê (em paralelo, no máximo MAX_SIGNATURE_IMAGES) as imagens canônicas das assinaturas, com UM prazo para o conjunto:
  // min(EPI_FICHA_R2_TIMEOUT_MS, restante do orçamento da trava). Depois aplica o orçamento do documento
  // (selectImagesWithinBudget): objeto > 2 MB (antes do SHA-256), hash divergente do registrado na evidência
  // (epi_signatures.signature_sha256) ou ausente (NoSuchKey) -> "imagem indisponível/divergente"; estourou 12 megapixels ou
  // 30 MB -> "imagem não incluída (limite do documento)". Qualquer outra falha, o estouro do prazo ou do orçamento -> 502
  // (nada foi gravado ainda).
  // DÍVIDA TÉCNICA: roda SOB a trava FOR NO KEY UPDATE do funcionário e com a conexão do pool presa (a lista de assinaturas
  // tem de ser coerente com o instantâneo lido na mesma transação). Mitigado pelo orçamento EPI_FICHA_LOCKED_BUDGET_MS
  // (padrão 15 s) para a seção inteira; evolução: pré-ler as imagens ANTES da trava, verificando depois que o conjunto de
  // assinaturas não mudou.
  private async readSignatureImages(refs: FichaSignatureImageRef[], budget: LockedBudget): Promise<{ images: Map<string, Buffer>; omitted: string[] }> {
    const wanted = refs.slice(0, MAX_SIGNATURE_IMAGES);
    if (wanted.length === 0) return { images: new Map(), omitted: [] };
    const ms = budget.opTimeout();
    if (ms <= 0) throw new BadGatewayException('Não foi possível ler as imagens das assinaturas');
    type Res = { ref: FichaSignatureImageRef; buf: Buffer | null; failed: boolean };
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), ms);
    });
    const reads = Promise.all(wanted.map((ref): Promise<Res> =>
      Promise.resolve().then(() => this.r2.getObject(ref.file_key)).then(
        (buf) => ({ ref, buf: Buffer.isBuffer(buf) ? buf : null, failed: false }),
        (err) => ({ ref, buf: null, failed: (err as { name?: string }).name !== 'NoSuchKey' }), // nunca rejeita: sem unhandled rejection
      ),
    ));
    let result: Res[] | 'timeout';
    try {
      result = await Promise.race([reads, timeout]);
    } finally {
      clearTimeout(timer);
    }
    if (result === 'timeout' || result.some((r) => r.failed)) {
      this.logger.error(`Falha ao ler imagens de assinatura no R2 (${wanted.length}): ${result === 'timeout' ? 'tempo esgotado' : 'erro'}`);
      throw new BadGatewayException('Não foi possível ler as imagens das assinaturas');
    }
    const sel = selectImagesWithinBudget(result.map((r) => ({ receipt_code: r.ref.receipt_code, signature_sha256: r.ref.signature_sha256, buf: r.buf })));
    if (sel.unavailable.length || sel.omitted.length) {
      this.logger.warn(`Imagens de assinatura: ${sel.unavailable.length} indisponível/divergente, ${sel.omitted.length} fora do limite do documento`);
    }
    return { images: sel.included, omitted: sel.omitted };
  }

  // Remove um arquivo do R2 sem nunca lançar e sem esperar além do prazo do R2 (a trava do funcionário e a
  // conexão do pool estão presas enquanto isso). Falha ou estouro só gera log (sem dado pessoal).
  // Usa o que sobra do orçamento da trava, com piso de 1 s (limpar um órfão vale mais que respeitar o orçamento à risca).
  private async bestEffortDelete(key: string, budget: LockedBudget): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), Math.max(1000, budget.opTimeout()));
    });
    try {
      const del = Promise.resolve().then(() => this.r2.deleteObject(key)).then(() => 'ok' as const, () => 'erro' as const);
      const r = await Promise.race([del, timeout]);
      if (r !== 'ok') this.logger.error(`Arquivo órfão possível no R2 (${r === 'timeout' ? 'tempo esgotado' : 'erro'}): ${key}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async putWithTimeout(key: string, pdf: Buffer, budget: LockedBudget): Promise<void> {
    const ms = budget.opTimeout();
    if (ms <= 0) throw new Error('timeout'); // orçamento da trava esgotado: nem tenta
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error('timeout')), ms);
    });
    const put = Promise.resolve().then(() => this.r2.putObject(key, pdf, 'application/pdf'));
    put.catch(() => undefined); // a promessa perdedora não pode gerar unhandled rejection
    try {
      await Promise.race([put, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Lista pública das versões do funcionário (mais nova primeiro), sem snapshot nem file_key.
  async listDocuments(client: PoolClient, employeeId: string): Promise<FichaDocumentRow[]> {
    const e = await client.query('SELECT id FROM employees WHERE id = $1', [employeeId]);
    if (!e.rows[0]) throw new NotFoundException('Funcionário não encontrado');
    const r = await client.query(
      `SELECT id, employee_id, version, document_code, file_sha256, snapshot_sha256, term_version, issued_by_user_id, issued_at
       FROM epi_ficha_documents WHERE employee_id = $1 ORDER BY version DESC`,
      [employeeId],
    );
    return r.rows.map(toDocumentRow);
  }

  // Referência do documento (lida sob RLS, 404 se não existe). Roda DENTRO da transação do tenant; a leitura do
  // R2 (readDocumentBytes) acontece depois, com a transação já fechada, para o R2 lento nunca prender o pool.
  async findDocumentRef(client: PoolClient, documentId: string): Promise<DocumentRef> {
    const r = await client.query('SELECT document_code, version, file_key, file_sha256 FROM epi_ficha_documents WHERE id = $1', [documentId]);
    const d = r.rows[0];
    if (!d) throw new NotFoundException('Documento não encontrado');
    return { document_code: d.document_code, version: d.version, file_key: d.file_key, file_sha256: d.file_sha256 };
  }

  // Lê o PDF no R2 com prazo (EPI_FICHA_R2_TIMEOUT_MS). NoSuchKey -> null; timeout/outro erro -> 502.
  async readDocumentBytes(ref: DocumentRef): Promise<Buffer | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error('timeout')), envMs('EPI_FICHA_R2_TIMEOUT_MS', 8000));
    });
    const get = Promise.resolve().then(() => this.r2.getObject(ref.file_key));
    get.catch(() => undefined); // a promessa perdedora não pode gerar unhandled rejection
    try {
      return await Promise.race([get, timeout]);
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null;
      this.logger.error(`Falha ao ler a ficha no R2 (${ref.document_code}): ${(err as Error).message === 'timeout' ? 'tempo esgotado' : 'erro'}`);
      throw new BadGatewayException('Não foi possível ler o documento');
    } finally {
      clearTimeout(timer);
    }
  }

  // Bytes do PDF emitido, lidos pelo backend (sem URL pública do R2). Chamar com a transação já fechada.
  async getDocumentFile(ref: DocumentRef): Promise<{ buffer: Buffer; code: string }> {
    const buffer = await this.readDocumentBytes(ref);
    if (!buffer) throw new NotFoundException('Arquivo indisponível');
    return { buffer, code: ref.document_code };
  }

  // Confere o arquivo guardado contra o hash registrado na emissão ('integro' só com hash igual).
  async verify(ref: DocumentRef): Promise<{
    status: VerifyStatus; document_code: string; version: number; expected_sha256: string; actual_sha256: string | null;
  }> {
    const buf = await this.readDocumentBytes(ref);
    if (!buf) {
      return { status: 'arquivo_ausente', document_code: ref.document_code, version: ref.version, expected_sha256: ref.file_sha256, actual_sha256: null };
    }
    const actual = sha256Hex(buf);
    return { status: actual === ref.file_sha256 ? 'integro' : 'divergente', document_code: ref.document_code, version: ref.version, expected_sha256: ref.file_sha256, actual_sha256: actual };
  }

  // Monta os dados da ficha a partir do livro-razão (epi_movements) e das entregas legadas.
  // Roda no client do contexto do tenant (RLS): funcionário de outro tenant não é encontrado.
  async getFicha(client: PoolClient, employeeId: string, filters: FichaFilters): Promise<Ficha> {
    return (await this.loadFicha(client, employeeId, filters)).ficha;
  }

  // A ficha pública (sem chave de arquivo) + as referências INTERNAS das imagens das assinaturas, só para o emissor.
  private async loadFicha(client: PoolClient, employeeId: string, filters: FichaFilters): Promise<{ ficha: Ficha; imageRefs: FichaSignatureImageRef[] }> {
    const emp = await client.query(
      `SELECT e.id, e.tenant_id, e.full_name, e.cpf, e.registration_number, e.department, e.position,
              to_char(e.admission_date, 'YYYY-MM-DD') AS admission_date, e.status, cu.name AS company_unit_name
       FROM employees e LEFT JOIN company_units cu ON cu.id = e.company_unit_id
       WHERE e.id = $1`,
      [employeeId],
    );
    const e = emp.rows[0];
    if (!e) throw new NotFoundException('Funcionário não encontrado');

    const t = await client.query(
      `SELECT name, trade_name, cnpj, address_street, address_number, address_complement, address_neighborhood,
              address_city, address_state, address_zip
       FROM tenants WHERE id = $1`,
      [e.tenant_id],
    );
    const tn = t.rows[0];

    // Situação da assinatura só existe para entrega/troca (entrega vinculada). Devolução e estorno
    // não têm status próprio: ficam fora quando o filtro signature_status é usado.
    const mStatus = `CASE WHEN m.type IN ('entrega','troca') THEN d.signature_status END`;

    const params: unknown[] = [employeeId];
    const mWhere: string[] = [];
    const lWhere: string[] = [];
    if (filters.from) {
      params.push(filters.from);
      mWhere.push(`(m.occurred_at AT TIME ZONE ${TZ})::date >= $${params.length}::date`);
      lWhere.push(`d.delivered_at >= $${params.length}::date`);
    }
    if (filters.to) {
      params.push(filters.to);
      mWhere.push(`(m.occurred_at AT TIME ZONE ${TZ})::date <= $${params.length}::date`);
      lWhere.push(`d.delivered_at <= $${params.length}::date`);
    }
    if (filters.signature_status) {
      params.push(filters.signature_status);
      mWhere.push(`${mStatus} = $${params.length}`);
      lWhere.push(`d.signature_status = $${params.length}`);
    }
    const mExtra = mWhere.length ? ` AND ${mWhere.join(' AND ')}` : '';
    const lExtra = lWhere.length ? ` AND ${lWhere.join(' AND ')}` : '';

    const rows = await client.query(
      `SELECT * FROM (
         SELECT 'livro'::text AS source, m.id AS movement_id, m.delivery_id,
                to_char(m.occurred_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS date, m.occurred_at AS sort_at,
                m.type, eci.description AS epi_description, te.manufacturer, te.model, te.ca_number,
                m.quantity, m.reason, ${mStatus} AS signature_status,
                EXISTS (SELECT 1 FROM epi_movements r WHERE r.reverses_movement_id = m.id) AS reversed,
                sg.receipt_code, to_char(sg.signed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS signed_at
         FROM epi_movements m
         JOIN tenant_epis te ON te.id = m.tenant_epi_id
         JOIN epi_catalog_items eci ON eci.id = te.epi_catalog_item_id
         LEFT JOIN employee_epi_deliveries d ON d.id = m.delivery_id
         -- evidência eletrônica: só requisições 'assinada' (a entrega só vira 'assinada' por epi_sig_sign)
         LEFT JOIN LATERAL (
           SELECT s.receipt_code, s.signed_at
             FROM epi_signature_request_items i
             JOIN epi_signature_requests q ON q.id = i.request_id AND q.status = 'assinada'
             JOIN epi_signatures s ON s.request_id = q.id
            WHERE i.delivery_id = m.delivery_id
            LIMIT 1
         ) sg ON d.signature_status = 'assinada' AND m.type IN ('entrega','troca')
         WHERE m.employee_id = $1 AND m.type IN ('entrega','troca','devolucao','estorno')${mExtra}
         UNION ALL
         SELECT 'legado'::text, NULL::uuid, d.id, to_char(d.delivered_at, 'YYYY-MM-DD'),
                (d.delivered_at::timestamp AT TIME ZONE ${TZ}),
                'entrega_legada', eci.description, te.manufacturer, te.model, te.ca_number,
                NULL::int, NULL::text, d.signature_status, false, NULL::text, NULL::text
         FROM employee_epi_deliveries d
         JOIN tenant_epis te ON te.id = d.tenant_epi_id
         JOIN epi_catalog_items eci ON eci.id = te.epi_catalog_item_id
         WHERE d.employee_id = $1 AND d.signature_status = 'legado'
           AND NOT EXISTS (SELECT 1 FROM epi_movements mm WHERE mm.delivery_id = d.id)${lExtra}
       ) x ORDER BY sort_at, source, COALESCE(movement_id::text, delivery_id::text)
       LIMIT ${MAX_FICHA_LINES + 1}`,
      params,
    );
    if (rows.rows.length > MAX_FICHA_LINES) {
      throw new BadRequestException('Ficha muito grande: restrinja o período');
    }

    const lines: FichaLine[] = rows.rows.map((r) => ({
      source: r.source, movement_id: r.movement_id, delivery_id: r.delivery_id, date: r.date, type: r.type,
      epi_description: r.epi_description, manufacturer: r.manufacturer, model: r.model, ca_number: r.ca_number,
      quantity: r.quantity, reason: r.reason, signature_status: r.signature_status, reversed: r.reversed,
      receipt_code: r.receipt_code ?? null, signed_at: r.signed_at ?? null,
    }));

    // Assinaturas distintas citadas pelas linhas (ordem: data, código). A chave do arquivo fica só em imageRefs.
    const codes = [...new Set(lines.map((l) => l.receipt_code).filter((c): c is string => !!c))];
    const signatures: FichaSignature[] = [];
    const imageRefs: FichaSignatureImageRef[] = [];
    if (codes.length) {
      const sr = await client.query(
        `SELECT receipt_code, to_char(signed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS signed_at,
                evidence_sha256, signature_sha256, signature_file_key
           FROM epi_signatures WHERE employee_id = $1 AND receipt_code = ANY($2::text[])
          ORDER BY epi_signatures.signed_at, receipt_code`,
        [employeeId, codes],
      );
      for (const x of sr.rows) {
        signatures.push({ receipt_code: x.receipt_code, signed_at: x.signed_at, evidence_sha256: x.evidence_sha256, signature_sha256: x.signature_sha256 });
        imageRefs.push({ receipt_code: x.receipt_code, file_key: x.signature_file_key, signature_sha256: x.signature_sha256 });
      }
    }

    const addr = [
      [tn.address_street, tn.address_number].filter(Boolean).join(', '),
      tn.address_complement, tn.address_neighborhood,
      [tn.address_city, tn.address_state].filter(Boolean).join('/'), tn.address_zip,
    ].filter(Boolean).join(' - ');

    const ficha: Ficha = {
      company: { name: tn.name, trade_name: tn.trade_name, cnpj: tn.cnpj, address: addr || 'não informado' },
      employee: {
        id: e.id, full_name: e.full_name, cpf_masked: maskCpf(e.cpf), registration_number: e.registration_number,
        department: e.department, position: e.position, admission_date: e.admission_date,
        company_unit_name: e.company_unit_name, status: e.status,
      },
      filters,
      lines,
      signatures,
      term: { version: EPI_TERM.version, draft: EPI_TERM.draft, title: EPI_TERM.title, paragraphs: [...EPI_TERM.paragraphs] },
    };
    return { ficha, imageRefs };
  }
}

// Remove chaves undefined: o instantâneo e a comparação de idempotência usam sempre a mesma forma.
function cleanFilters(f: FichaFilters): FichaFilters {
  const out: FichaFilters = {};
  if (f.from) out.from = f.from;
  if (f.to) out.to = f.to;
  if (f.signature_status) out.signature_status = f.signature_status;
  return out;
}

// Só os campos públicos: sem snapshot, file_key, tenant_id nem idempotency_key.
function toDocumentRow(r: Record<string, any>): FichaDocumentRow {
  return {
    id: r.id, employee_id: r.employee_id, version: r.version, document_code: r.document_code, file_sha256: r.file_sha256,
    snapshot_sha256: r.snapshot_sha256, term_version: r.term_version, issued_by_user_id: r.issued_by_user_id, issued_at: r.issued_at,
  };
}
