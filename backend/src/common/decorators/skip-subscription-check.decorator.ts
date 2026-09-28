import { SetMetadata } from '@nestjs/common';

// ITEM 002 (auditoria 2026-09-27): rotas que precisam continuar acessíveis
// mesmo quando a assinatura do tenant/técnico não está mais ativa — ex.:
// reativar o plano, ou saber quem está logado. Ver SubscriptionStatusGuard.
export const SKIP_SUBSCRIPTION_CHECK_KEY = 'skipSubscriptionCheck';
export const SkipSubscriptionCheck = () => SetMetadata(SKIP_SUBSCRIPTION_CHECK_KEY, true);
