import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AuditService } from '../common/audit/audit.service';
import { AtuacaoService, ACTING_TOKEN_TTL_SECONDS } from './atuacao.service';
import { CriarEmpresaDto } from './dto/criar-empresa.dto';
import { BCRYPT_COST } from '../common/auth/bcrypt-cost';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';
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
  constructor(private readonly atuacao: AtuacaoService, private readonly audit: AuditService, private readonly jwt: JwtService) {}

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

  @RequirePermission('empresas.criar')
  @RateLimit({ limit: envInt('SOCIO_CREATE_COMPANY_RATE_LIMIT_MAX', 20), windowSeconds: envInt('SOCIO_CREATE_COMPANY_RATE_LIMIT_WINDOW_SECONDS', 3600), keyBy: 'ip' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('clientes')
  async criar(@Body() dto: CriarEmpresaDto, @Req() req: any) {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    const out = await req.withTenantContext((c: any) => this.atuacao.criarEmpresa(c, req.user.id, dto, passwordHash));
    await this.audit.log({
      actorUserId: req.user.id, actorRole: req.user.role, action: 'empresa.criada_por_socio', resourceType: 'tenant',
      resourceId: out.tenant_id, method: req.method, path: '/atuacao/clientes', statusCode: 201, ipAddress: req.ip,
      detail: `usuário RH: ${out.user_id}`, // nunca e-mail/senha
    });
    return { tenant_id: out.tenant_id, user_id: out.user_id, email: dto.email };
  }

  @RequirePermission('empresas.atuar')
  // Ruling 23: cada chamada emite um token de 30 min; limite por IP contra emissão em massa.
  @RateLimit({ limit: envInt('SOCIO_ATUAR_RATE_LIMIT_MAX', 60), windowSeconds: envInt('SOCIO_ATUAR_RATE_LIMIT_WINDOW_SECONDS', 3600), keyBy: 'ip' })
  @Post('clientes/:tenantId/atuar')
  async atuar(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Req() req: any) {
    // Token de atuação nunca gera outro token de atuação: o ActingTenantGuard nega /atuacao/* no modo atuação.
    const tenant = await req.withTenantContext((c: any) => this.atuacao.podeAtuar(c, req.user.id, tenantId));
    if (!tenant) {
      throw new ForbiddenException({ statusCode: 403, message: 'Você não pode atuar nesta empresa.', code: 'ACTING_NOT_ALLOWED' });
    }
    const access_token = this.jwt.sign(
      { sub: req.user.id, tenantId: null, role: 'socio', act: tenantId },
      { expiresIn: ACTING_TOKEN_TTL_SECONDS },
    );
    await this.audit.log({
      actorUserId: req.user.id, actorRole: 'socio', actorTenantId: null, action: 'atuacao.iniciada', resourceType: 'tenant',
      resourceId: tenantId, method: req.method, path: req.path, statusCode: 201, ipAddress: req.ip,
    });
    return { access_token, expires_in: ACTING_TOKEN_TTL_SECONDS, tenant: { id: tenantId, name: tenant.name } };
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
