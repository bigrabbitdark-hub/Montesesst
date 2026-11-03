import { CanActivate, ExecutionContext, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { UserRole } from '../types';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly audit?: AuditService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets);
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // `socio` nega por padrão: só passa se a rota o lista em @Roles ou exige
    // @RequirePermission (a PermissionsGuard decide em seguida). Rota sem
    // @Roles continua aberta aos demais papéis, como antes.
    if (user?.role === 'socio') {
      const permissions = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSION_KEY, targets);
      const listed = !!required && required.includes('socio');
      const allowed = listed || (!!permissions && permissions.length > 0);
      if (!allowed) this.auditDenied(user, request);
      return allowed;
    }

    if (!required || required.length === 0) return true;
    return !!user && required.includes(user.role);
  }

  // Registro "fire and forget" da negação do sócio: não altera a decisão e nunca
  // lança. `path` sem query string (pode carregar dados) e sem corpo.
  private auditDenied(user: { id?: string }, request: any): void {
    try {
      void this.audit
        ?.log({
          actorUserId: user.id ?? null,
          actorRole: 'socio',
          action: 'role.denied',
          resourceType: 'route',
          method: request.method,
          path: request.path,
          statusCode: 403,
          ipAddress: request.ip,
        })
        ?.catch(() => undefined);
    } catch {
      // auditoria nunca derruba a requisição
    }
  }
}
