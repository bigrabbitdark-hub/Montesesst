import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditService } from '../../common/audit/audit.service';
import { DocumentosAdminService } from './documentos-admin.service';
import { CATEGORIAS_DOCUMENTO } from './dto/documentos.dto';
import { CreateRegistroDto, MatrizQuery, RegistrosQuery, SetMatrizDto } from './dto/documentos-admin.dto';

// Somente admin (sócio fora de @Roles de propósito). O admin NÃO ganha rotas do fluxo
// (elaborar/revisar/aprovar/assinar/publicar): aqui só matriz e registros profissionais.
@Controller('atuacao/admin/documentos')
@Roles('admin')
export class DocumentosAdminController {
  constructor(private readonly admin: DocumentosAdminService, private readonly audit: AuditService) {}

  private log(req: any, action: string, resourceType: string, id: string | null, statusCode: number, detail: string) {
    return this.audit.log({
      actorUserId: req.user.id, actorRole: req.user.role, action, resourceType, resourceId: id,
      method: req.method, path: req.path, statusCode, ipAddress: req.ip, detail,
    });
  }

  // Somente leitura: sócios disponíveis para a matriz e checagem informativa de viabilidade por categoria.
  @Get('socios')
  socios(@Req() req: any) {
    return req.withTenantContext((c: any) => this.admin.listarSocios(c));
  }

  @Get('viabilidade')
  viabilidade(@Req() req: any) {
    return req.withTenantContext((c: any) => this.admin.viabilidade(c));
  }

  // Lista só quem tem ao menos uma ação na categoria (ou em todas, sem filtro).
  @Get('matriz')
  matriz(@Query() q: MatrizQuery, @Req() req: any) {
    return req.withTenantContext((c: any) => this.admin.listarMatriz(c, q.category));
  }

  @Put('matriz/:category/usuarios/:userId')
  async definirMatriz(
    @Param('category') category: string, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: SetMatrizDto, @Req() req: any,
  ) {
    if (!(CATEGORIAS_DOCUMENTO as readonly string[]).includes(category)) throw new BadRequestException('Categoria inválida');
    const out = await req.withTenantContext((c: any) => this.admin.definirMatriz(c, req.user.id, category, userId, dto.acoes));
    await this.log(req, 'document_matrix.changed', 'document_type_permission', userId, 200,
      `categoria: ${category}; usuario: ${userId}; acoes(${out.acoes.length}): ${out.acoes.join(', ')}`);
    return out;
  }

  @Get('registros')
  registros(@Query() q: RegistrosQuery, @Req() req: any) {
    return req.withTenantContext((c: any) => this.admin.listarRegistros(c, q.userId));
  }

  // Auditoria: apenas ids; nunca conselho nem número do registro.
  @Post('registros')
  async criarRegistro(@Body() dto: CreateRegistroDto, @Req() req: any) {
    const out = await req.withTenantContext((c: any) => this.admin.criarRegistro(c, req.user.id, dto));
    await this.log(req, 'professional_registration.created', 'professional_registration', out.id, 201, `usuario: ${out.user_id}`);
    return out;
  }

  @Post('registros/:id/confirmar')
  async confirmar(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const out = await req.withTenantContext((c: any) => this.admin.confirmarRegistro(c, req.user.id, id));
    await this.log(req, 'professional_registration.confirmed', 'professional_registration', id, 201, `usuario: ${out.user_id}`);
    return out;
  }

  @Post('registros/:id/revogar')
  async revogar(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const out = await req.withTenantContext((c: any) => this.admin.revogarRegistro(c, req.user.id, id));
    await this.log(req, 'professional_registration.revoked', 'professional_registration', id, 201, `usuario: ${out.user_id}`);
    return out;
  }
}
