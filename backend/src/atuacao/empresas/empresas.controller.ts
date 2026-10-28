import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditService } from '../../common/audit/audit.service';
import { EmpresasService } from './empresas.service';
import { VigenciaDto } from './dto/vigencia.dto';

@Controller('atuacao/empresas')
@Roles('socio')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class EmpresasController {
  constructor(private readonly svc: EmpresasService, private readonly audit: AuditService) {}

  // O `detail` registra só o módulo / ids / nomes de campos — nunca valores nem dados pessoais.
  private async auditar(req: any, tenantId: string, action: string, detail: string) {
    await this.audit.log({
      actorUserId: req.user.id, actorRole: req.user.role, action, resourceType: 'tenant', resourceId: tenantId,
      method: req.method, path: req.path, statusCode: 200, ipAddress: req.ip, detail,
    });
  }

  @RequirePermission('empresas.read')
  @Get(':tenantId/visao-geral')
  async visao(@Param('tenantId', ParseUUIDPipe) t: string, @Req() req: any) {
    const out = await req.withTenantContext((c: any) => this.svc.visaoGeral(c, t));
    await this.auditar(req, t, 'company.accessed', 'modulo: visao-geral');
    return out;
  }

  @RequirePermission('empresas.read')
  @Get(':tenantId/documentos')
  async documentos(@Param('tenantId', ParseUUIDPipe) t: string, @Req() req: any) {
    const out = await req.withTenantContext((c: any) => this.svc.documentos(c, t));
    await this.auditar(req, t, 'company.accessed', 'modulo: documentos');
    return out;
  }

  @RequirePermission('empresas.read')
  @Get(':tenantId/documentos/:id/download')
  async download(@Param('tenantId', ParseUUIDPipe) t: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const out = await req.withTenantContext((c: any) => this.svc.download(c, t, id));
    await this.auditar(req, t, 'company.accessed', `modulo: documentos-download; documento: ${id}`);
    return out;
  }

  @RequirePermission('empresas.read')
  @Get(':tenantId/vencimentos')
  async vencimentos(@Param('tenantId', ParseUUIDPipe) t: string, @Req() req: any) {
    const out = await req.withTenantContext((c: any) => this.svc.vencimentos(c, t));
    await this.auditar(req, t, 'company.accessed', 'modulo: vencimentos');
    return out;
  }

  @RequirePermission('empresas.read')
  @Get(':tenantId/funcionarios')
  async funcionarios(@Param('tenantId', ParseUUIDPipe) t: string, @Req() req: any) {
    const out = await req.withTenantContext((c: any) => this.svc.funcionarios(c, t));
    await this.auditar(req, t, 'company.accessed', 'modulo: funcionarios');
    return out;
  }

  @RequirePermission('empresas.read')
  @Get(':tenantId/epi')
  async epi(@Param('tenantId', ParseUUIDPipe) t: string, @Req() req: any) {
    const out = await req.withTenantContext((c: any) => this.svc.epi(c, t));
    await this.auditar(req, t, 'company.accessed', 'modulo: epi');
    return out;
  }

  @RequirePermission('empresas.documentos')
  @Patch(':tenantId/documentos/:id/vigencia')
  async vigencia(
    @Param('tenantId', ParseUUIDPipe) t: string, @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VigenciaDto, @Req() req: any,
  ) {
    // Auditoria gravada dentro da transação do UPDATE (fail-closed), em alterarVigencia.
    const ctx = { role: req.user.role, method: req.method, path: req.path, ip: req.ip };
    return req.withTenantContext((c: any) => this.svc.alterarVigencia(c, t, id, req.user.id, dto, ctx));
  }
}
