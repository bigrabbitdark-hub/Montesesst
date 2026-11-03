import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditService } from '../../common/audit/audit.service';
import { CATEGORIAS_DOCUMENTO } from '../documentos/dto/documentos.dto';
import { AlertasService } from './alertas.service';
import { CreateMudancaDto, ListMudancasQuery, ListNotificacoesQuery, ResolverMudancaDto, UpdateRegraDto } from './alertas.dto';
import { BadRequestException } from '@nestjs/common';

// Alertas e notificações do sócio (E4). Auditoria só com ids e nomes de ação; nunca notas nem fontes.
@Controller('atuacao')
@Roles('socio')
export class AlertasController {
  constructor(private readonly alertas: AlertasService, private readonly audit: AuditService) {}

  private log(req: any, acao: string, tipo: string, id: string | null, detail: string) {
    return this.audit.log({
      actorUserId: req.user.id, actorRole: req.user.role, action: `alertas.${acao}`, resourceType: tipo, resourceId: id,
      method: req.method, path: req.path, statusCode: 200, ipAddress: req.ip, detail,
    });
  }

  @RequirePermission('alertas.read')
  @Get('alertas/regras')
  regras(@Req() req: any) {
    return req.withTenantContext((c: any) => this.alertas.listarRegras(c));
  }

  @RequirePermission('alertas.read', 'alertas.manage')
  @Put('alertas/regras/:categoria')
  async atualizarRegra(@Param('categoria') categoria: string, @Body() dto: UpdateRegraDto, @Req() req: any) {
    if (!(CATEGORIAS_DOCUMENTO as readonly string[]).includes(categoria)) throw new BadRequestException('Tipo de documento inválido.');
    const r = await req.withTenantContext((c: any) => this.alertas.atualizarRegra(c, req.user.id, categoria, dto));
    await this.log(req, 'rule_updated', 'document_validity_rule', null, `categoria: ${categoria}; antecedencias: ${dto.notice_days.length}`);
    return r;
  }

  @RequirePermission('alertas.read')
  @Get('alertas/mudancas')
  mudancas(@Query() q: ListMudancasQuery, @Req() req: any) {
    return req.withTenantContext((c: any) => this.alertas.listarMudancas(c, q));
  }

  @RequirePermission('alertas.read', 'alertas.manage')
  @Post('alertas/mudancas')
  async registrar(@Body() dto: CreateMudancaDto, @Req() req: any) {
    const r = await req.withTenantContext((c: any) => this.alertas.registrarMudanca(c, req.user.id, dto));
    await this.log(req, 'change_flag_created', 'document_change_flag', r?.id ?? null, `tenant: ${dto.tenant_id}; motivo: ${dto.reason}`);
    return r;
  }

  @RequirePermission('alertas.read', 'alertas.manage')
  @Post('alertas/mudancas/:id/resolver')
  async resolver(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolverMudancaDto, @Req() req: any) {
    const r = await req.withTenantContext((c: any) => this.alertas.resolverMudanca(c, req.user.id, id, dto.nota));
    await this.log(req, 'change_flag_resolved', 'document_change_flag', id, 'resolvido');
    return r;
  }

  @RequirePermission('alertas.read')
  @Get('notificacoes')
  notificacoes(@Query() q: ListNotificacoesQuery, @Req() req: any) {
    return req.withTenantContext((c: any) => this.alertas.listarNotificacoes(c, q));
  }

  @RequirePermission('alertas.read')
  @Get('notificacoes/resumo')
  resumo(@Req() req: any) {
    return req.withTenantContext((c: any) => this.alertas.resumoNotificacoes(c));
  }

  @RequirePermission('alertas.read')
  @Post('notificacoes/lidas')
  todasLidas(@Req() req: any) {
    return req.withTenantContext((c: any) => this.alertas.marcarTodasLidas(c));
  }

  @RequirePermission('alertas.read')
  @Post('notificacoes/:id/lida')
  lida(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.alertas.marcarLida(c, id));
  }
}
