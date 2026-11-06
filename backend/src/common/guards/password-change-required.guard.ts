import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_PASSWORD_PENDING_KEY } from '../decorators/allow-password-pending.decorator';

// Senha temporária (claim `mcp`): tudo é bloqueado exceto as rotas marcadas @AllowWhilePasswordPending.
@Injectable()
export class PasswordChangeRequiredGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!user?.mustChangePassword) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_PENDING_KEY, [context.getHandler(), context.getClass()])) return true;
    throw new ForbiddenException({
      statusCode: 403,
      message: 'Você precisa trocar a senha temporária antes de continuar.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  }
}
