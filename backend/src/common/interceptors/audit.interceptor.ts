import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { AuditService } from '../audit/audit.service';

const AUDITED_METHODS: Record<string, string> = {
  POST: 'create',
  PATCH: 'update',
  PUT: 'update',
  DELETE: 'delete',
};

// Registra criação/edição/exclusão em qualquer rota mutante, exceto
// /auth/* — login tem log próprio em AuthService (precisa do e-mail
// tentado e do motivo da falha, que este interceptor genérico não tem
// acesso, já que a rota é @Public() e roda sem req.user).
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const baseAction = AUDITED_METHODS[request.method];
    const resourceType = firstPathSegment(request);

    if (!baseAction || resourceType === 'auth') {
      return next.handle();
    }

    // Sub-rotas de ação (ex: POST/DELETE :id/assign) mudam o estado de uma
    // associação, não o registro em si — logar como 'create'/'delete'
    // confundiria isso com criar/apagar o técnico ou parceiro de verdade.
    const subAction = subActionSegment(request);
    const action = subAction ? (request.method === 'DELETE' ? `un${subAction}` : subAction) : baseAction;

    const finish = (statusCode: number, resourceId: string | null) => {
      const user = request.user;
      void this.audit.log({
        actorUserId: user?.id ?? null,
        actorRole: user?.role ?? null,
        actorTenantId: user?.tenantId ?? null,
        action,
        resourceType,
        resourceId,
        method: request.method,
        path: request.originalUrl ?? request.url,
        statusCode,
        ipAddress: request.ip ?? null,
      });
    };

    return next.handle().pipe(
      tap((data) => {
        const statusCode = context.switchToHttp().getResponse().statusCode;
        const resourceId = request.params?.id ?? extractId(data);
        finish(statusCode, resourceId);
      }),
      catchError((err) => {
        const statusCode = err?.status ?? 500;
        finish(statusCode, request.params?.id ?? null);
        return throwError(() => err);
      }),
    );
  }
}

function firstPathSegment(request: { route?: { path?: string }; path?: string }): string {
  const routePath = request.route?.path ?? request.path ?? '';
  return routePath.split('/').filter(Boolean)[0] ?? 'unknown';
}

// Detecta o padrão '/recurso/:id/acao' e devolve 'acao'. Rotas simples
// ('/recurso' ou '/recurso/:id') não têm sub-ação e caem no mapeamento
// genérico de AUDITED_METHODS.
function subActionSegment(request: { route?: { path?: string }; path?: string }): string | null {
  const routePath = request.route?.path ?? request.path ?? '';
  const segments = routePath.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  return segments.length > 2 && last && !last.startsWith(':') ? last : null;
}

function extractId(data: unknown): string | null {
  if (data && typeof data === 'object' && 'id' in data) {
    const id = (data as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}
