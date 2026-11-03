import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AuditService } from '../common/audit/audit.service';
import { FinanceiroService } from './financeiro.service';
import type { SubscriptionAccess } from '../payments/subscription-access.service';

class ListarFinanceiroQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['ativa', 'trial', 'pendente', 'inativa']) situacao?: SubscriptionAccess;
  @IsOptional() @IsIn(['true']) pendencia?: string;
}

const DIAS_PERMITIDOS = [7, 30, 90];
function parseDias(value: string | undefined): number {
  const n = Number.parseInt(value ?? '', 10);
  return DIAS_PERMITIDOS.includes(n) ? n : 30;
}

// Consulta financeira SOMENTE LEITURA: só rotas GET (a varredura de controllers falha
// se uma rota com finance.read não for GET). `resumo` e `clientes` antes de `clientes/:tenantId`.
@Controller('atuacao/financeiro')
@Roles('socio')
export class FinanceiroController {
  constructor(private readonly financeiro: FinanceiroService, private readonly audit: AuditService) {}

  // Auditoria: só o nome da consulta e o tenantId; nunca valores. `path` sem query string.
  private registrar(req: any, consulta: string, statusCode: number, tenantId?: string) {
    return this.audit.log({
      actorUserId: req.user.id, actorRole: req.user.role, action: 'finance.viewed', resourceType: 'finance',
      resourceId: tenantId ?? null, method: req.method, path: req.path, statusCode, ipAddress: req.ip,
      detail: tenantId ? `consulta: ${consulta}; tenantId: ${tenantId}` : `consulta: ${consulta}`,
    });
  }

  @RequirePermission('finance.read')
  @Get('resumo')
  async resumo(@Query('dias') dias: string | undefined, @Req() req: any) {
    const r = await req.withTenantContext((c: any) => this.financeiro.resumo(c, parseDias(dias)));
    await this.registrar(req, 'resumo', 200);
    return r;
  }

  @RequirePermission('finance.read')
  @Get('clientes')
  async listar(@Query() q: ListarFinanceiroQuery, @Req() req: any) {
    const r = await req.withTenantContext((c: any) => this.financeiro.listar(c, q));
    await this.registrar(req, 'clientes', 200);
    return r;
  }

  @RequirePermission('finance.read')
  @Get('clientes/:tenantId')
  async ficha(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Req() req: any) {
    try {
      const r = await req.withTenantContext((c: any) => this.financeiro.ficha(c, tenantId));
      await this.registrar(req, 'cliente', 200, tenantId);
      return r;
    } catch (e) {
      if (e instanceof NotFoundException) await this.registrar(req, 'cliente', 404, tenantId);
      throw e;
    }
  }
}
