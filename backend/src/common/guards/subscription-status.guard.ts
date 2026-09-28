import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SKIP_SUBSCRIPTION_CHECK_KEY } from '../decorators/skip-subscription-check.decorator';
import { SubscriptionAccessService } from '../../payments/subscription-access.service';

// ITEM 002 (auditoria 2026-09-27): antes desta guard, cancelamento/inadimplência
// de assinatura não tinha NENHUM efeito de bloqueio — o único gate existente
// (limite de funcionários) trata "sem assinatura authorized" exatamente como
// "trial nunca bloqueado" (docs/plans/planos-limite-funcionarios.md:15).
//
// Distinção deliberada (decisão do fundador, 2026-09-27): bloqueio imediato,
// mas SÓ para quem já teve uma assinatura e ela não está mais ativa — nunca
// para quem nunca assinou (trial), que continua liberado como sempre foi.
// - Nenhuma linha em `subscriptions` para este tenant/técnico  -> trial, LIBERA.
// - Existe linha 'authorized', ou 'pending' RECENTE (checkout em andamento) -> LIBERA.
// - Só existem 'cancelled'/'paused' e 'pending' abandonado (mais velho que a
//   janela de checkout), nenhuma authorized                                  -> BLOQUEIA.
// O 'pending' precisa expirar: nada o limpa, então um cliente que cancelou e
// abandonou um checkout ficaria com um 'pending' eterno e nunca seria bloqueado.
//
// Só se aplica a quem tem conceito de assinatura própria (`plans.audience`
// só tem 'empresa'/'tecnico') — 'parceiro' e 'admin' nunca são bloqueados aqui.
@Injectable()
export class SubscriptionStatusGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: SubscriptionAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_SUBSCRIPTION_CHECK_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    // Sem user autenticado ainda: não é problema desta guard (JwtAuthGuard
    // já barrou antes, na ordem de APP_GUARD em app.module.ts).
    if (!user) return true;
    if (user.role !== 'empresa' && user.role !== 'tecnico') return true;

    const blocked = (await this.access.stateFor(user)) === 'inativa';

    if (blocked) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Assinatura inativa. Reative seu plano para continuar usando o Montese SST.',
        code: 'SUBSCRIPTION_INACTIVE',
      });
    }

    return true;
  }
}
