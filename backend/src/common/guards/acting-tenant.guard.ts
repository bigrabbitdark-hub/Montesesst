import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ACTING_ALLOWED_KEY } from '../decorators/acting-allowed.decorator';

const deny = (code: string, message: string) => new ForbiddenException({ statusCode: 403, message, code });

// Roda logo depois do JwtAuthGuard e ANTES de Subscription/Roles/Permissions. Quando o token traz `act`:
//  1. a rota precisa estar marcada @ActingAllowed (lista fechada);
//  2. o banco revalida, a cada requisição, que a sócia pode atuar naquele tenant (permissão, sócia ativa,
//     empresa ativa e SEM vínculo com técnico/parceiro — socio_can_act_on_tenant, migration 0108);
//  3. só então request.user vira { role:'empresa', tenantId:X } (id continua o da sócia), e todo o restante
//     (RolesGuard, TenantContextInterceptor, RLS) enxerga uma empresa comum. Falha SEMPRE fechada.
@Injectable()
export class ActingTenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user?.actingTenantId) return true;

    if (!this.reflector.getAllAndOverride<boolean>(ACTING_ALLOWED_KEY, targets)) {
      this.auditDenied(user, request, 'rota fora do modo atuação');
      throw deny('ACTING_ROUTE_DENIED', 'Esta área não está disponível no modo "atuar como empresa".');
    }

    let ok = false;
    try {
      ok = await this.db.withTenantContext({ userId: user.id, role: 'socio' }, async (client) => {
        const res = await client.query<{ ok: boolean }>('SELECT socio_can_act_on_tenant($1, $2) AS ok', [user.id, user.actingTenantId]);
        return res.rows[0]?.ok === true;
      });
    } catch {
      ok = false;
    }
    if (!ok) {
      this.auditDenied(user, request, 'empresa não permitida');
      throw deny('ACTING_NOT_ALLOWED', 'Você não pode atuar nesta empresa.');
    }

    request.user = { id: user.id, tenantId: user.actingTenantId, role: 'empresa', actingAs: true, actingTenantId: user.actingTenantId };
    this.auditRead(user, request);
    return true;
  }

  // Ruling 20: LEITURAS no modo atuação também ficam registradas (quem viu o quê, em qual empresa).
  // Escritas já são auditadas pelo AuditInterceptor. O path vai SEM query string (pode conter nome/CPF
  // buscado). /tenants/me e /dashboard/* ficam de fora: toda tela os chama e só gerariam ruído.
  // statusCode 200 é nominal: o guard roda antes de Subscription/Roles/Permissions, então registra o
  // ACESSO tentado já autorizado para a empresa, não a resposta final. Fire-and-forget: nunca derruba.
  private auditRead(user: { id: string; actingTenantId?: string }, request: any): void {
    const method = String(request.method ?? '').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return;
    const path = String(request.path ?? '').split('?')[0];
    if (path === '/tenants/me' || path.startsWith('/tenants/me/') || path.startsWith('/dashboard/')) return;
    const resourceType = path.split('/').filter(Boolean)[0] ?? 'desconhecido';
    try {
      void this.audit
        .log({
          actorUserId: user.id, actorRole: 'socio', actorTenantId: user.actingTenantId ?? null, action: 'atuacao.acesso',
          resourceType, resourceId: null, method, path, statusCode: 200, ipAddress: request.ip, detail: 'atuando_como_empresa',
        })
        ?.catch(() => undefined);
    } catch {
      // auditoria nunca derruba a requisição
    }
  }

  private auditDenied(user: { id: string; actingTenantId?: string }, request: any, motivo: string): void {
    void this.audit
      .log({
        actorUserId: user.id, actorRole: 'socio', actorTenantId: null, action: 'atuacao.negada', resourceType: 'tenant',
        resourceId: user.actingTenantId ?? null, method: request.method, path: request.path, statusCode: 403,
        ipAddress: request.ip, detail: motivo,
      })
      ?.catch(() => undefined);
  }
}
