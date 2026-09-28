import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/decorators/roles.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';
import { extractPdfText } from '../common/pdf/pdf-text.util';
import { verifyFileContent } from '../common/files/file-content.util';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { DOCUMENT_CLASSIFIER_PROVIDER, DocumentClassifierProvider } from './document-classifier-provider.interface';
import { CompanyDocumentIndexerService } from './company-document-indexer.service';

const MAX_BATCH_FILES = 10;
// 240s de folga segura sob o proxy_read_timeout de 300s do nginx
// (nginx/conf.d/default.conf) — sem isso, um lote de 10 arquivos sob
// degradação da MiniMax (até 45s por chamada, o timeout individual da
// Task 1) poderia levar até 450s, estourando o proxy e descartando
// classificações já pagas antes de a resposta chegar ao cliente.
const BATCH_TIME_BUDGET_MS = 240_000;

export interface ClassifyBatchItem {
  filename: string;
  suggested_category: string | null;
  suggested_title: string | null;
  suggested_expires_at: string | null;
  needs_review: boolean;
}

@Controller('documents')
export class DocumentsController {
  private readonly logger = new Logger(DocumentsController.name);

  constructor(
    private readonly documents: DocumentsService,
    private readonly indexer: CompanyDocumentIndexerService,
    @Inject(DOCUMENT_CLASSIFIER_PROVIDER) private readonly classifier: DocumentClassifierProvider,
  ) {}

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(@UploadedFile() file: Express.Multer.File, @Body() dto: CreateDocumentDto, @Req() req: any) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    const user = req.user;
    const tenantId = user.role === 'tecnico' || user.role === 'parceiro' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    const document = await req.withTenantContext((client: any) =>
      this.documents.upload(client, {
        tenantId,
        category: dto.category,
        title: dto.title,
        expiresAt: dto.expires_at,
        file: {
          buffer: file.buffer,
          mimetype: file.mimetype,
          originalname: file.originalname,
          size: file.size,
        },
        uploadedByUserId: user.id,
        uploadedByRole: user.role,
        companyUnitId: dto.company_unit_id,
      }),
    );

    // extractAndEmbed roda TOTALMENTE fora de qualquer transação — nunca
    // segura uma conexão do pool aberta durante a chamada de embedding,
    // que é HTTP externa e lenta (mesmo raciocínio do Finding C1a da Fase
    // 9 / Finding #1 da revisão final da Fase 24 — a versão anterior desta
    // rota passava um PoolClient pro método que fazia o laço de embedding,
    // recriando o mesmo problema). Só depois de já ter todos os embeddings
    // computados é que abrimos a 2ª transação (persistChunks), dedicada só
    // a INSERTs — curta e rápida.
    if (this.indexer.shouldIndex(document.category, document.mime_type)) {
      // ITEM 003 (auditoria 2026-09-27): busca os nomes já cadastrados do
      // tenant pra minimizar PII antes do texto do documento sair pro
      // provedor externo de embedding — consulta rápida, transação própria
      // (mesmo raciocínio de manter extractAndEmbed sem PoolClient).
      const knownFullNames: string[] = await req.withTenantContext((client: any) =>
        client
          .query('SELECT full_name FROM employees WHERE tenant_id = $1', [tenantId])
          .then((res: any) => res.rows.map((row: { full_name: string }) => row.full_name)),
      );
      const embeddedChunks = await this.indexer.extractAndEmbed(document, file.buffer, knownFullNames);
      // persistChunks nunca lança exceção (mesma garantia de sempre), mas
      // a própria chamada a withTenantContext pode lançar por motivos fora
      // do controle do serviço (ex.: pool esgotado, falha no BEGIN) —
      // Finding #4 da revisão final da Fase 24. Sem este try/catch, essa
      // falha se propagaria e derrubaria a resposta de um upload que já
      // foi commitado com sucesso.
      try {
        await req.withTenantContext((client: any) => this.indexer.persistChunks(client, document, embeddedChunks));
      } catch (err) {
        this.logger.warn(`Falha ao persistir chunks do documento ${document.id}: ${(err as Error).message}`);
      }
    }

    return document;
  }

  @Roles('empresa', 'tecnico', 'parceiro')
  @RateLimit({
    limit: envInt('DOCUMENTS_CLASSIFY_BATCH_RATE_LIMIT_MAX', 5),
    windowSeconds: envInt('DOCUMENTS_CLASSIFY_BATCH_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip',
  })
  @UseInterceptors(FilesInterceptor('files', MAX_BATCH_FILES, { limits: { fileSize: 10 * 1024 * 1024 } }))
  @Post('classify-batch')
  async classifyBatch(@UploadedFiles() files: Express.Multer.File[] | undefined): Promise<ClassifyBatchItem[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('Nenhum arquivo enviado');
    }

    const batchStartedAt = Date.now();
    const results: ClassifyBatchItem[] = [];
    for (const file of files) {
      if (Date.now() - batchStartedAt > BATCH_TIME_BUDGET_MS) {
        results.push({
          filename: file.originalname,
          suggested_category: null,
          suggested_title: null,
          suggested_expires_at: null,
          needs_review: true,
        });
        continue;
      }

      // ITEM 004: além do Content-Type declarado, o conteúdo precisa ser um
      // PDF de verdade antes de ir pro parser (pdf-parse).
      if (file.mimetype !== 'application/pdf' || (await verifyFileContent(file.buffer, file.mimetype))) {
        results.push({
          filename: file.originalname,
          suggested_category: null,
          suggested_title: null,
          suggested_expires_at: null,
          needs_review: true,
        });
        continue;
      }

      const text = await extractPdfText(file.buffer);
      if (!text) {
        results.push({
          filename: file.originalname,
          suggested_category: null,
          suggested_title: null,
          suggested_expires_at: null,
          needs_review: true,
        });
        continue;
      }

      try {
        const classification = await this.classifier.classify(text);
        results.push({
          filename: file.originalname,
          suggested_category: classification.category,
          suggested_title: classification.title,
          suggested_expires_at: classification.expires_at || null,
          needs_review: classification.category === null,
        });
      } catch {
        // Falha de rede/API na classificação de UM arquivo não pode
        // derrubar o lote inteiro — marca só esse arquivo pra revisão
        // manual, os demais continuam sendo processados normalmente.
        results.push({
          filename: file.originalname,
          suggested_category: null,
          suggested_title: null,
          suggested_expires_at: null,
          needs_review: true,
        });
      }
    }

    return results;
  }

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    // Técnico ou parceiro sem tenant_id: RLS já restringe a query às empresas
    // vinculadas (EXISTS contra tenant_technicians ou tenant_partners,
    // respectivamente) — usado pela agenda agregada da carteira.
    return req.withTenantContext((client: any) => this.documents.findAll(client, tenantId));
  }

  @Get('compliance')
  compliance(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    if ((req.user.role === 'tecnico' || req.user.role === 'parceiro') && !tenantId) {
      throw new BadRequestException('tenant_id é obrigatório');
    }
    return req.withTenantContext((client: any) => this.documents.getCompliance(client, tenantId));
  }

  @Roles('tecnico', 'parceiro')
  @Get('compliance/portfolio')
  portfolioCompliance(@Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.documents.getPortfolioCompliance(client, req.user.id, req.user.role),
    );
  }

  @Get(':id/download')
  download(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.getDownloadUrl(client, id));
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    const user = req.user;
    return req.withTenantContext((client: any) =>
      this.documents.remove(client, id, user.id, user.role === 'admin'),
    );
  }
}
