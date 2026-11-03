import {
  BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditService } from '../../common/audit/audit.service';
import { DocumentosService, MAX_ARQUIVO_BYTES } from './documentos.service';
import {
  CreateDocumentoDto, ListDocumentosQuery, NovaVersaoDto, PublicarDocumentoDto, TransicaoComNotaDto, TransicaoSemCorpoDto,
} from './dto/documentos.dto';

// Fluxo de documentos do sócio (rascunho, versões, revisão, aprovação, registro de assinatura
// interna, publicação). A autorização fina (matriz por tipo/usuário/ação, separação de funções e
// registro profissional confirmado) é do serviço; aqui ficam o papel e a permissão RBAC por rota.
@Controller('atuacao/documentos')
@Roles('socio')
export class DocumentosController {
  constructor(private readonly documentos: DocumentosService, private readonly audit: AuditService) {}

  // Auditoria: só ids e nome da ação; nunca título, nota ou conteúdo. `path` sem query string.
  private log(req: any, acao: string, id: string | null, statusCode: number, detail: string) {
    return this.audit.log({
      actorUserId: req.user.id, actorRole: req.user.role, action: `document_draft.${acao}`, resourceType: 'document_draft',
      resourceId: id, method: req.method, path: req.path, statusCode, ipAddress: req.ip, detail,
    });
  }

  // Negações por regra (matriz, estado, separação, registro) são auditadas SEM mudar a resposta:
  // só ids, nome da rota/ação e código; nunca título, nota ou número de registro.
  private async comAuditoria<T>(req: any, rota: string, id: string | null, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      if (err?.codigoNegacao) {
        await this.log(req, 'denied', id, err.getStatus?.() ?? 403, `rota: ${rota}; acao: ${err.acaoNegada}; codigo: ${err.codigoNegacao}`);
      }
      throw err;
    }
  }

  private detalheAuditoria(d: any, extra = ''): string {
    return `tenant: ${d.tenant_id}; status: ${d.status}${d.current_version_id ? `; versao: ${d.current_version_id}` : ''}${extra}`;
  }

  @RequirePermission('documents.read')
  @Get()
  listar(@Query() q: ListDocumentosQuery, @Req() req: any) {
    return req.withTenantContext((c: any) => this.documentos.listar(c, q));
  }

  @RequirePermission('documents.read')
  @Get(':id')
  obter(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.documentos.obter(c, req.user.id, id));
  }

  @RequirePermission('documents.create_draft')
  @Post()
  async criar(@Body() dto: CreateDocumentoDto, @Req() req: any) {
    const d = await this.comAuditoria<any>(req, 'criar', null, () => req.withTenantContext((c: any) => this.documentos.criar(c, req.user.id, dto)));
    await this.log(req, 'created', d.id, 201, this.detalheAuditoria(d, `; categoria: ${d.category}`));
    return d;
  }

  @RequirePermission('documents.create_draft')
  @Post(':id/versoes')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ARQUIVO_BYTES } }))
  async novaVersao(
    @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: NovaVersaoDto, @Req() req: any,
  ) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    const d = await this.comAuditoria(req, 'nova_versao', id, () =>
      this.documentos.novaVersao(
        (fn) => req.withTenantContext(fn), req.user.id, id,
        { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname, size: file.size },
        dto.note,
      ),
    );
    await this.log(req, 'version_added', id, 201, this.detalheAuditoria(d, `; numero: ${d.versao_atual}`));
    return d;
  }

  @RequirePermission('documents.create_draft')
  @Post(':id/enviar-revisao')
  async enviarRevisao(@Param('id', ParseUUIDPipe) id: string, @Body() _dto: TransicaoSemCorpoDto, @Req() req: any) {
    const d = await this.comAuditoria(req, 'enviar_revisao', id, () => req.withTenantContext((c: any) => this.documentos.enviarRevisao(c, req.user.id, id)));
    await this.log(req, 'submitted', id, 201, this.detalheAuditoria(d));
    return d;
  }

  @RequirePermission('documents.review')
  @Post(':id/devolver')
  async devolver(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TransicaoComNotaDto, @Req() req: any) {
    const d = await this.comAuditoria(req, 'devolver', id, () => req.withTenantContext((c: any) => this.documentos.devolver(c, req.user.id, id, dto.note)));
    await this.log(req, 'returned', id, 201, this.detalheAuditoria(d));
    return d;
  }

  @RequirePermission('documents.approve')
  @Post(':id/aprovar')
  async aprovar(@Param('id', ParseUUIDPipe) id: string, @Body() _dto: TransicaoSemCorpoDto, @Req() req: any) {
    const d = await this.comAuditoria(req, 'aprovar', id, () => req.withTenantContext((c: any) => this.documentos.aprovar(c, req.user.id, id)));
    await this.log(req, 'approved', id, 201, this.detalheAuditoria(d));
    return d;
  }

  @RequirePermission('documents.sign')
  @Post(':id/assinar')
  async assinar(@Param('id', ParseUUIDPipe) id: string, @Body() _dto: TransicaoSemCorpoDto, @Req() req: any) {
    const ua = req.headers?.['user-agent'];
    const d = await this.comAuditoria(req, 'assinar', id, () => req.withTenantContext((c: any) =>
      this.documentos.assinar(c, req.user.id, id, { ip: req.ip ?? null, userAgent: typeof ua === 'string' ? ua : null }),
    ));
    await this.log(req, 'signed', id, 201, this.detalheAuditoria(d));
    return d;
  }

  @RequirePermission('documents.publish')
  @Post(':id/publicar')
  async publicar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PublicarDocumentoDto, @Req() req: any) {
    const d = await this.comAuditoria(req, 'publicar', id, () => this.documentos.publicar((fn) => req.withTenantContext(fn), req.user.id, id, dto.expires_at));
    await this.log(req, 'published', id, 201, this.detalheAuditoria(d, `; documento: ${d.published_document_id}`));
    return d;
  }

  @RequirePermission('documents.cancel')
  @Post(':id/cancelar')
  async cancelar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TransicaoComNotaDto, @Req() req: any) {
    const d = await this.comAuditoria(req, 'cancelar', id, () => req.withTenantContext((c: any) => this.documentos.cancelar(c, req.user.id, id, dto.note)));
    await this.log(req, 'cancelled', id, 201, this.detalheAuditoria(d));
    return d;
  }

  @RequirePermission('documents.read')
  @Get(':id/versoes/:versionId/download')
  async download(
    @Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string, @Req() req: any,
  ) {
    const r = await req.withTenantContext((c: any) => this.documentos.downloadVersao(c, id, versionId));
    await this.log(req, 'downloaded', id, 200, `versao: ${versionId}`);
    return r;
  }
}
