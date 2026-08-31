import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PDFParse } from 'pdf-parse';
import { DatabaseService } from '../common/database/database.service';
import { NormativeDocumentsService } from './normative-documents.service';

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

@Injectable()
export class NormativeMonitorService {
  private readonly logger = new Logger(NormativeMonitorService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly documents: NormativeDocumentsService,
  ) {}

  @Cron('0 3 * * *')
  async handleCron(): Promise<void> {
    await this.runOnce();
  }

  // Job de sistema, sem usuário autenticado nem tenant — terceiro caso
  // legítimo de withoutTenantContext além dos dois já documentados em
  // DatabaseService (health check e bootstrap de login). As tabelas
  // tocadas aqui não têm RLS de qualquer forma.
  async runOnce(): Promise<void> {
    const sources = await this.db.withoutTenantContext((client) =>
      client.query<{ id: string; official_url: string }>(
        'SELECT id, official_url FROM official_sources WHERE active = true',
      ),
    );

    for (const source of sources.rows) {
      try {
        await this.processSource(source.id, source.official_url);
      } catch (err) {
        this.logger.error(`Falha ao monitorar fonte ${source.id}`, (err as Error).stack);
      }
    }
  }

  private async processSource(sourceId: string, url: string): Promise<void> {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`Fonte respondeu status ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const buffer = Buffer.from(await response.arrayBuffer());

    let text: string;
    let mimeType: string;
    if (contentType.includes('pdf') || url.toLowerCase().endsWith('.pdf')) {
      // pdf-parse v2 é baseado em classe, não em função (mudança de API
      // confirmada em 2026-08-28 — ver Global Constraints do plano).
      // `data` aceita Buffer do Node diretamente (convertido pra
      // Uint8Array internamente pela própria lib).
      const parser = new PDFParse({ data: buffer });
      try {
        text = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
      mimeType = 'application/pdf';
    } else {
      text = extractHtmlText(buffer.toString('utf-8'));
      mimeType = 'text/html';
    }

    await this.db.withoutTenantContext((client) =>
      this.documents.recordDetectedVersion(client, sourceId, text, buffer, mimeType, url),
    );
  }
}
