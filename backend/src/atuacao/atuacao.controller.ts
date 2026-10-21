import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AuditService } from '../common/audit/audit.service';
import { AtuacaoService } from './atuacao.service';
import { UpdateClienteOperacionalDto } from './dto/update-cliente-operacional.dto';
import type { SubscriptionAccess } from '../payments/subscription-access.service';

class ListarClientesQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['true']) meus?: string;
  @IsOptional() @IsIn(['ativa', 'trial', 'pendente', 'inativa']) situacao?: SubscriptionAccess;
}

@Controller('atuacao')
@Roles('socio')
export class AtuacaoController {
  constructor(private readonly atuacao: AtuacaoService, private readonly audit: AuditService) {}

  @RequirePermission('clients.read')
  @Get('resumo')
  resumo(@Req() req: any) {
    return req.withTenantContext((c: any) => this.atuacao.resumo(c));
  }

  @RequirePermission('tasks.read')
  @Get('equipe')
  equipe(@Req() req: any) {
    return req.withTenantContext((c: any) => this.atuacao.equipe(c));
  }

  @RequirePermission('clients.read')
  @Get('clientes')
  listar(@Query() q: ListarClientesQuery, @Req() req: any) {
    return req.withTenantContext((c: any) => this.atuacao.listar(c, q, req.user.id));
  }

  @RequirePermission('clients.read')
  @Get('clientes/:tenantId')
  ficha(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.atuacao.ficha(c, tenantId));
  }

  @RequirePermission('clients.update_operational')
  @Patch('clientes/:tenantId')
  async atualizar(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: UpdateClienteOperacionalDto, @Req() req: any) {
    const ficha = await req.withTenantContext((c: any) => this.atuacao.atualizarOperacional(c, tenantId, dto));
    // Auditoria: só os NOMES dos campos alterados (nunca os valores).
    await this.audit.log({
      actorUserId: req.user.id, actorRole: req.user.role, action: 'client.update_operational',
      resourceType: 'tenant', resourceId: tenantId, method: req.method, path: req.url, statusCode: 200,
      ipAddress: req.ip, detail: `campos: ${Object.keys(dto).join(', ')}`,
    });
    return ficha;
  }
}
