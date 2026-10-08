import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PDFParse } from 'pdf-parse';
import { DatabaseService } from '../common/database/database.service';
import { NormativeDocumentsService } from './normative-documents.service';
import { EmailService } from '../common/email/email.service';
import { MonitorEvent, buildMonitorAlertEmail } from './normative-monitor-email';
import { fetchPublic, readBodyCapped } from '../common/url/public-url.util';
import { MONITOR_FETCH_HEADERS, decodeHtmlBuffer, meaningfulLength, suspiciousExtractionReason } from './normative-text.util';

// As páginas de norma do gov.br/trabalho (CMS Plone) têm cabeçalho, menu de
// navegação e rodapé institucional enormes em volta do texto real da norma
// — sem recortar, o texto extraído fica dominado por "Ir para o Conteúdo",
// itens de menu e links de rodapé, e o conteúdo de verdade só aparece bem
// mais adiante (confirmado empiricamente ao cadastrar as NRs reais em
// 2026-08-31). `id="content-core"` é o contêiner do corpo do artigo nesse
// CMS; `viewlet-below-content` marca onde o rodapé de navegação recomeça
// logo depois. Quando a página não usa esse CMS (outra entidade, formato
// diferente), cai de volta pro HTML inteiro — heurística, não garantia.
export function extractHtmlText(html: string): string {
  const startMatch = html.match(/<div[^>]*id=["']content-core["'][^>]*>/i);
  let scoped = html;
  if (startMatch) {
    const start = startMatch.index as number;
    const endIndex = html.indexOf('viewlet-below-content', start);
    scoped = endIndex !== -1 ? html.slice(start, endIndex) : html.slice(start);
  }
  return scoped
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MonitorRunOptions {
  // Restringe a rodada a estas fontes. O cron chama sem opções (todas as
  // fontes ativas, comportamento de produção); só os testes usam isto — os
  // e2e rodam contra o mesmo Postgres de produção e não podem tocar nas 36
  // NRs reais.
  onlySourceIds?: string[];
}

const LAST_ERROR_MAX_LENGTH = 500;
// Um e-mail por episódio de falha: só na falha de número exatamente 2.
const REPEATED_FAILURE_THRESHOLD = 2;

interface MonitoredSource {
  id: string;
  code: string | null;
  title: string;
  official_url: string;
}

function sourceLabel(source: MonitoredSource): string {
  return source.code ? `${source.code} — ${source.title}` : source.title;
}

const MAX_FONTE_BYTES = 25 * 1024 * 1024;

export interface ExtractedPage {
  text: string;
  mimeType: string;
  buffer: Buffer;
  statusCode: number;
}

export interface CheckOutcome {
  outcome: 'nova_versao' | 'sem_mudanca' | 'erro';
  message: string;
}

export type SourcePreview =
  | { ok: true; status_code: number; mime_type: string; chars: number; meaningful_chars: number; sample: string; suspicious: string | null }
  | { ok: false; message: string };

// Erros de rede do fetch chegam como 'fetch failed' (causa em err.cause.code) ou AbortError/TimeoutError:
// traduz para uma frase curta em português. Demais mensagens (status, guarda de URL, conteúdo suspeito) ficam intactas.
export function mensagemDeErro(err: unknown): string {
  const e = err as { message?: string; name?: string; cause?: { code?: string } } | null;
  const msg = e?.message ?? String(err);
  const ehAbort = e?.name === 'AbortError' || e?.name === 'TimeoutError' || /operation was aborted|timed? ?out/i.test(msg);
  if (msg !== 'fetch failed' && !ehAbort) return msg;
  const code = String(e?.cause?.code ?? '');
  if (code === 'ENOTFOUND') return 'Domínio não encontrado (DNS)';
  if (code === 'ECONNREFUSED') return 'Conexão recusada pelo servidor';
  if (code === 'ECONNRESET') return 'Conexão interrompida pelo servidor';
  if (code.startsWith('CERT_') || code.startsWith('UNABLE_TO_VERIFY') || code.startsWith('ERR_TLS')) {
    return 'Certificado HTTPS inválido na fonte';
  }
  if (ehAbort || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || /timeout/i.test(code)) {
    return 'Tempo esgotado ao acessar a fonte (30 s)';
  }
  return 'Falha de rede ao acessar a fonte';
}

@Injectable()
export class NormativeMonitorService {
  private readonly logger = new Logger(NormativeMonitorService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly documents: NormativeDocumentsService,
    private readonly email: EmailService,
  ) {}

  @Cron('0 3 * * *')
  async handleCron(): Promise<void> {
    await this.runOnce();
  }

  // Job de sistema, sem usuário autenticado nem tenant — terceiro caso
  // legítimo de withoutTenantContext além dos dois já documentados em
  // DatabaseService (health check e bootstrap de login). As tabelas
  // tocadas aqui não têm RLS de qualquer forma.
  async runOnce(options: MonitorRunOptions = {}): Promise<void> {
    const sources = await this.db.withoutTenantContext((client) =>
      client.query<MonitoredSource>(
        options.onlySourceIds
          ? 'SELECT id, code, title, official_url FROM official_sources WHERE active = true AND id = ANY($1::uuid[])'
          : 'SELECT id, code, title, official_url FROM official_sources WHERE active = true',
        options.onlySourceIds ? [options.onlySourceIds] : [],
      ),
    );

    const events: MonitorEvent[] = [];
    for (const source of sources.rows) {
      try {
        const createdNewVersion = await this.processSource(source.id, source.official_url);
        await this.recordSuccess(source.id);
        if (createdNewVersion) {
          events.push({ kind: 'nova_versao', source: sourceLabel(source) });
        }
      } catch (err) {
        this.logger.error(`Falha ao monitorar fonte ${source.id}`, (err as Error).stack);
        const message = mensagemDeErro(err);
        const failures = await this.recordFailure(source.id, message);
        if (failures === REPEATED_FAILURE_THRESHOLD) {
          events.push({
            kind: 'falha_repetida',
            source: sourceLabel(source),
            error: message.slice(0, LAST_ERROR_MAX_LENGTH),
          });
        }
      }
    }

    await this.notifyAdmins(events);
  }

  // Nunca lançam: registrar estado é best-effort e jamais pode contar como
  // falha da própria fonte nem derrubar a rodada.
  private async recordSuccess(sourceId: string): Promise<void> {
    try {
      await this.db.withoutTenantContext((client) =>
        client.query(
          `UPDATE official_sources
           SET last_checked_at = now(), last_check_status = 'ok', last_error = NULL, consecutive_failures = 0
           WHERE id = $1`,
          [sourceId],
        ),
      );
    } catch (err) {
      this.logger.error(`Falha ao gravar estado da fonte ${sourceId}`, (err as Error).stack);
    }
  }

  private async recordFailure(sourceId: string, message: string): Promise<number> {
    try {
      const { rows } = await this.db.withoutTenantContext((client) =>
        client.query<{ consecutive_failures: number }>(
          `UPDATE official_sources
           SET last_checked_at = now(), last_check_status = 'erro', last_error = $2,
               consecutive_failures = consecutive_failures + 1
           WHERE id = $1
           RETURNING consecutive_failures`,
          [sourceId, message.slice(0, LAST_ERROR_MAX_LENGTH)],
        ),
      );
      return rows[0]?.consecutive_failures ?? 0;
    } catch (err) {
      this.logger.error(`Falha ao gravar estado da fonte ${sourceId}`, (err as Error).stack);
      return 0;
    }
  }

  // Um único e-mail-resumo por rodada, só quando houve evento. `users` tem
  // FORCE ROW LEVEL SECURITY e a role da aplicação não tem BYPASSRLS, então
  // a busca dos admins usa withTenantContext({ role: 'admin' }) — mesmo
  // padrão de VisitReminderCronService. Falha de envio só vai pro log.
  private async notifyAdmins(events: MonitorEvent[]): Promise<void> {
    if (events.length === 0) return;

    let adminEmails: string[];
    try {
      const { rows } = await this.db.withTenantContext({ role: 'admin' }, (client) =>
        client.query<{ email: string }>(`SELECT email FROM users WHERE role = 'admin' AND status = 'ativo'`),
      );
      adminEmails = rows.map((row) => row.email);
    } catch (err) {
      this.logger.error('Falha ao buscar admins pro alerta do monitor normativo', (err as Error).stack);
      return;
    }
    if (adminEmails.length === 0) {
      this.logger.warn('Monitor normativo tem eventos pra avisar, mas não há nenhum admin ativo');
      return;
    }

    const { subject, html } = buildMonitorAlertEmail(events);
    for (const to of adminEmails) {
      try {
        await this.email.send({ to, subject, html });
      } catch (err) {
        this.logger.error(`Falha ao enviar o alerta do monitor normativo pra ${to}`, (err as Error).stack);
      }
    }
  }

  // Busca (pela guarda de URL, com limite de tamanho) e extrai o texto. Usado pelo cron, por
  // "Verificar agora" e pela pré-visualização.
  async fetchAndExtract(url: string): Promise<ExtractedPage> {
    const { response } = await fetchPublic(url, { headers: MONITOR_FETCH_HEADERS, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`Fonte respondeu status ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const buffer = await readBodyCapped(response, MAX_FONTE_BYTES);

    let text: string;
    let mimeType: string;
    if (contentType.includes('pdf') || url.toLowerCase().endsWith('.pdf')) {
      // pdf-parse v2 é baseado em classe, não em função (mudança de API confirmada em 2026-08-28).
      const parser = new PDFParse({ data: buffer });
      try {
        text = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
      mimeType = 'application/pdf';
    } else {
      text = extractHtmlText(decodeHtmlBuffer(buffer, contentType));
      mimeType = 'text/html';
    }
    return { text, mimeType, buffer, statusCode: response.status };
  }

  private async processSource(sourceId: string, url: string): Promise<boolean> {
    const { text, mimeType, buffer } = await this.fetchAndExtract(url);

    // Barreira contra extração vazia/quebrada: não vira pendente (aprovar substituiria uma norma boa por
    // lixo). Vira falha da fonte — badge vermelho na tela e e-mail na 2ª falha seguida.
    const vigenteChars = await this.db.withoutTenantContext(async (client) => {
      const { rows } = await client.query<{ len: number }>(
        `SELECT length(raw_text) AS len FROM normative_documents WHERE source_id = $1 AND status = 'vigente'`,
        [sourceId],
      );
      return rows[0]?.len ?? null;
    });
    const suspeita = suspiciousExtractionReason(meaningfulLength(text), vigenteChars);
    if (suspeita) {
      throw new Error(suspeita);
    }

    const created = await this.db.withoutTenantContext((client) =>
      this.documents.recordDetectedVersion(client, sourceId, text, buffer, mimeType, url),
    );
    return created !== null;
  }

  // "Verificar agora": mesma contabilidade de sucesso/falha do cron, mas sem e-mail (o admin está olhando).
  async checkSource(sourceId: string): Promise<CheckOutcome> {
    const { rows } = await this.db.withoutTenantContext((client) =>
      client.query<MonitoredSource>('SELECT id, code, title, official_url FROM official_sources WHERE id = $1', [sourceId]),
    );
    const source = rows[0];
    if (!source) throw new NotFoundException('Fonte não encontrada');

    try {
      const createdNewVersion = await this.processSource(source.id, source.official_url);
      await this.recordSuccess(source.id);
      return createdNewVersion
        ? { outcome: 'nova_versao', message: 'Nova versão detectada: veja em "Aguardando validação".' }
        : {
            outcome: 'sem_mudanca',
            message: 'Nenhuma versão nova criada (sem mudança relevante ou já há uma versão aguardando revisão).',
          };
    } catch (err) {
      const message = mensagemDeErro(err).slice(0, LAST_ERROR_MAX_LENGTH);
      await this.recordFailure(source.id, message);
      return { outcome: 'erro', message };
    }
  }

  // Pré-visualização: lê e extrai a URL sem gravar nada, para o admin testar antes de salvar a fonte.
  async previewUrl(url: string): Promise<SourcePreview> {
    try {
      const page = await this.fetchAndExtract(url);
      const significativos = meaningfulLength(page.text);
      return {
        ok: true,
        status_code: page.statusCode,
        mime_type: page.mimeType,
        chars: page.text.length,
        meaningful_chars: significativos,
        sample: page.text.replace(/\s+/g, ' ').trim().slice(0, 400),
        suspicious: suspiciousExtractionReason(significativos, null),
      };
    } catch (err) {
      return { ok: false, message: mensagemDeErro(err).slice(0, LAST_ERROR_MAX_LENGTH) };
    }
  }
}
