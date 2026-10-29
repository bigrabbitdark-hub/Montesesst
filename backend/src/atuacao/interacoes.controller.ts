import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AuditService } from '../common/audit/audit.service';
import { InteracoesService } from './interacoes.service';
import { CreateInteracaoDto, ListInteracoesQuery, UpdateInteracaoDto } from './dto/interacao.dto';

// Caminhos completos ('clientes/:tenantId/interacoes' e 'interacoes/:id'): não colidem com
// AtuacaoController ('clientes/:tenantId' tem um segmento a menos).
@Controller('atuacao')
@Roles('socio')
export class InteracoesController {
  constructor(private readonly interacoes: InteracoesService, private readonly audit: AuditService) {}

  // Auditoria: só ids e nomes de campo, nunca resumo, decisões, participantes ou próximos passos.
  private log(req: any, action: string, id: string, statusCode: number, detail: string) {
    return this.audit.log({
      actorUserId: req.user.id, actorRole: req.user.role, action, resourceType: 'client_interaction', resourceId: id,
      method: req.method, path: req.path, statusCode, ipAddress: req.ip, detail,
    });
  }

  // Histórico global. Audita a leitura como as demais listas da carteira: só o nome do módulo (e o tenant, se filtrado).
  @RequirePermission('clients.read')
  @Get('interacoes')
  async listarGlobal(@Query() q: ListInteracoesQuery, @Req() req: any) {
    const out = await req.withTenantContext((c: any) => this.interacoes.listarGlobal(c, q));
    await this.audit.log({
      actorUserId: req.user.id, actorRole: req.user.role, action: 'company.accessed', resourceType: 'tenant',
      resourceId: q.tenantId ?? null, method: req.method, path: req.path, statusCode: 200, ipAddress: req.ip,
      detail: 'modulo: atendimentos-carteira',
    });
    return out;
  }

  @RequirePermission('clients.read')
  @Get('clientes/:tenantId/interacoes')
  listar(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.interacoes.listar(c, req.user.id, tenantId));
  }

  @RequirePermission('clients.update_operational')
  @Post('clientes/:tenantId/interacoes')
  async criar(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: CreateInteracaoDto, @Req() req: any) {
    const i = await req.withTenantContext((c: any) => this.interacoes.criar(c, req.user.id, tenantId, dto));
    await this.log(req, 'client.interaction_created', i.id, 201, `tenant: ${i.tenant_id}; tipo: ${i.type}`);
    return i;
  }

  @RequirePermission('clients.update_operational')
  @Patch('interacoes/:id')
  async atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInteracaoDto, @Req() req: any) {
    const r = await req.withTenantContext((c: any) => this.interacoes.atualizar(c, req.user.id, id, dto));
    if (r.campos.length) await this.log(req, 'client.interaction_updated', id, 200, `campos: ${r.campos.join(', ')}`);
    return r.interacao;
  }
}
