import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';

// Roda depois do JwtAuthGuard (request.user já populado). Anexa um helper no
// request que abre a transação com SET LOCAL app.user_id/app.tenant_id/app.role
// já configurado a partir do usuário autenticado — os controllers/services
// chamam req.withTenantContext(fn) em vez de mexer com Postgres diretamente.
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly db: DatabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    request.withTenantContext = <T>(fn: (client: PoolClient) => Promise<T>) =>
      this.db.withTenantContext(
        { userId: user?.id, tenantId: user?.tenantId ?? undefined, role: user?.role },
        fn,
      );

    return next.handle();
  }
}
