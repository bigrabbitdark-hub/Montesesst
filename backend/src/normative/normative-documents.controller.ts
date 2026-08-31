import { Body, Controller, Get, Param, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { NormativeDocumentsService } from './normative-documents.service';
import { RejectDocumentDto } from './dto/reject-document.dto';

@Controller('normative-documents')
export class NormativeDocumentsController {
  constructor(private readonly documents: NormativeDocumentsService) {}

  @Roles('admin')
  @Get()
  findAll(@Query('status') status: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.findByStatus(client, status));
  }

  @Roles('admin')
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.findOneWithPrevious(client, id));
  }

  // Dividido em três chamadas separadas a req.withTenantContext/embedding —
  // prepareApproval (transação curta de leitura/validação), depois
  // computeEmbeddedChunks fora de qualquer transação (chamadas HTTP lentas
  // ao provedor de embedding, uma por chunk) e só então finalizeApproval
  // (transação curta, só SQL) — pra nunca segurar uma conexão do pool do
  // Postgres presa durante chamadas de IA. Ver Finding C1b da revisão
  // final da Fase 9.
  @Roles('admin')
  @Post(':id/approve')
  async approve(@Param('id') id: string, @Req() req: any) {
    const doc = await req.withTenantContext((client: any) => this.documents.prepareApproval(client, id));
    const embeddedChunks = await this.documents.computeEmbeddedChunks(doc.raw_text);
    return req.withTenantContext((client: any) =>
      this.documents.finalizeApproval(client, id, req.user.id, embeddedChunks),
    );
  }

  @Roles('admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectDocumentDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.reject(client, id, req.user.id, dto.reason));
  }

  @Roles('admin')
  @Post(':id/reindex')
  async reindex(@Param('id') id: string, @Req() req: any) {
    const doc = await req.withTenantContext((client: any) => this.documents.prepareReindex(client, id));
    const embeddedChunks = await this.documents.computeEmbeddedChunks(doc.raw_text);
    return req.withTenantContext((client: any) =>
      this.documents.finalizeReindex(client, id, embeddedChunks),
    );
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Get(':id/download')
  download(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.getDownloadUrl(client, id));
  }
}
