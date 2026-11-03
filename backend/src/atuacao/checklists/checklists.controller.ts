import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditService } from '../../common/audit/audit.service';
import { ChecklistsService } from './checklists.service';
import {
  AplicarChecklistDto, CreateModeloDto, DefinirItensDto, NovaVersaoModeloDto, ResponderItemDto,
} from './checklists.dto';

// Checklists por serviço (E3). Modelos globais versionados (criar/aprovar: checklists.approve) e checklists por
// documento (aplicar/responder: checklists.write). Auditoria só com ids e o nome da ação, nunca rótulos nem respostas.
@Controller('atuacao')
@Roles('socio')
export class ChecklistsController {
  constructor(private readonly checklists: ChecklistsService, private readonly audit: AuditService) {}

  private log(req: any, acao: string, tipo: string, id: string | null, detail: string) {
    return this.audit.log({
      actorUserId: req.user.id, actorRole: req.user.role, action: `checklist.${acao}`, resourceType: tipo, resourceId: id,
      method: req.method, path: req.path, statusCode: 200, ipAddress: req.ip, detail,
    });
  }

  @RequirePermission('checklists.read')
  @Get('checklists/modelos')
  modelos(@Req() req: any) {
    return req.withTenantContext((c: any) => this.checklists.listarModelos(c));
  }

  @RequirePermission('checklists.read')
  @Get('checklists/versoes/:versionId')
  versao(@Param('versionId', ParseUUIDPipe) versionId: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.checklists.obterVersao(c, versionId));
  }

  @RequirePermission('checklists.read', 'checklists.approve')
  @Post('checklists/modelos')
  async criarModelo(@Body() dto: CreateModeloDto, @Req() req: any) {
    const v = await req.withTenantContext((c: any) => this.checklists.criarModelo(c, req.user.id, dto));
    await this.log(req, 'template_created', 'checklist_version', v.id, `servico: ${dto.service}`);
    return v;
  }

  @RequirePermission('checklists.read', 'checklists.approve')
  @Post('checklists/modelos/:templateId/versoes')
  async novaVersao(@Param('templateId', ParseUUIDPipe) templateId: string, @Body() dto: NovaVersaoModeloDto, @Req() req: any) {
    const v = await req.withTenantContext((c: any) => this.checklists.novaVersao(c, req.user.id, templateId, dto.change_note));
    await this.log(req, 'version_created', 'checklist_version', v.id, `modelo: ${templateId}`);
    return v;
  }

  @RequirePermission('checklists.read', 'checklists.approve')
  @Put('checklists/versoes/:versionId/itens')
  async definirItens(@Param('versionId', ParseUUIDPipe) versionId: string, @Body() dto: DefinirItensDto, @Req() req: any) {
    const v = await req.withTenantContext((c: any) => this.checklists.definirItens(c, versionId, dto));
    await this.log(req, 'items_set', 'checklist_version', versionId, `itens: ${dto.items.length}`);
    return v;
  }

  @RequirePermission('checklists.read', 'checklists.approve')
  @Post('checklists/versoes/:versionId/aprovar')
  async aprovar(@Param('versionId', ParseUUIDPipe) versionId: string, @Req() req: any) {
    const v = await req.withTenantContext((c: any) => this.checklists.aprovar(c, req.user.id, versionId));
    await this.log(req, 'approved', 'checklist_version', versionId, `modelo: ${v.template_id}; versao: ${v.version_number}`);
    return v;
  }

  @RequirePermission('checklists.read', 'checklists.approve')
  @Delete('checklists/versoes/:versionId')
  @HttpCode(204)
  async excluirRascunho(@Param('versionId', ParseUUIDPipe) versionId: string, @Req() req: any) {
    await req.withTenantContext((c: any) => this.checklists.excluirRascunho(c, versionId));
    await this.log(req, 'draft_deleted', 'checklist_version', versionId, 'rascunho excluido');
  }

  @RequirePermission('checklists.read', 'documents.read')
  @Get('documentos/:id/checklists')
  doDocumento(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.checklists.listarDoDocumento(c, id));
  }

  @RequirePermission('checklists.read', 'checklists.write', 'documents.read')
  @Post('documentos/:id/checklists')
  async aplicar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AplicarChecklistDto, @Req() req: any) {
    const out = await req.withTenantContext((c: any) => this.checklists.aplicar(c, req.user.id, id, dto));
    await this.log(req, 'applied', 'document_draft', id, `versao_modelo: ${dto.template_version_id}`);
    return out;
  }

  @RequirePermission('checklists.read', 'checklists.write', 'documents.read')
  @Put('documentos/:id/checklists/:checklistId/itens/:itemId')
  async responder(
    @Param('id', ParseUUIDPipe) id: string, @Param('checklistId', ParseUUIDPipe) checklistId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: ResponderItemDto, @Req() req: any,
  ) {
    const out = await req.withTenantContext((c: any) => this.checklists.responder(c, req.user.id, id, checklistId, itemId, dto));
    await this.log(req, 'answered', 'document_draft', id, `checklist: ${checklistId}; item: ${itemId}`);
    return out;
  }
}
