import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';

const deny = () =>
  new ForbiddenException({
    statusCode: 403,
    message: 'Você não tem permissão para esta ação.',
    code: 'PERMISSION_DENIED',
  });

// Roda DEPOIS do RolesGuard (que deixa o socio com @RequirePermission passar e
// confia nesta guarda). Só atua sobre o papel `socio`; as permissões vêm do
// banco (socio_permissions), nunca do token. Exige todas as listadas.
// Falha fechada: qualquer erro ao consultar permissões nega o acesso.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!required || required.length === 0 || user?.role !== 'socio') return true;

    let granted: Set<string>;
    try {
      granted = await this.db.withTenantContext(
        { userId: user.id, tenantId: user.tenantId ?? undefined, role: user.role },
        async (client) => {
          const res = await client.query<{ permission: string }>(
            'SELECT permission FROM socio_permissions WHERE user_id = $1',
            [user.id],
          );
          return new Set(res.rows.map((r) => r.permission));
        },
      );
    } catch {
      throw deny();
    }

    const missing = required.filter((p) => !granted.has(p));
    if (missing.length === 0) return true;

    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      actorTenantId: user.tenantId ?? null,
      action: 'permission.denied',
      resourceType: 'route',
      method: request.method,
      path: request.path,
      statusCode: 403,
      ipAddress: request.ip,
      detail: `faltando: ${missing.join(', ')}`,
    });
    throw deny();
  }
}
