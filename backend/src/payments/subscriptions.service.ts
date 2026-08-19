import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { MercadoPagoService } from './mercadopago.service';
import { mapPgError } from '../common/pg-error.util';

interface PlanRow {
  id: string;
  audience: string;
  name: string;
  price_cents: number;
}

export interface SubscribeContext {
  tenantId?: string;
  technicianUserId?: string;
  userId: string;
  audience: 'empresa' | 'tecnico';
}

// `withTenantContext` do request (ver DatabaseService) — recebido como
// função, não como um `client` já aberto, porque este service precisa
// controlar duas transações curtas separadas (ver comentário em `create`
// abaixo) em vez de uma única transação que envolveria a chamada de rede.
export type WithTenantContext = <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>;

@Injectable()
export class SubscriptionsService {
  constructor(private readonly mercadoPago: MercadoPagoService) {}

  async create(
    withTenantContext: WithTenantContext,
    planId: string,
    ctx: SubscribeContext,
  ): Promise<{ initPoint: string }> {
    // Fase 1 (transação curta nº 1): só leituras — plano + e-mail do
    // pagador. Não segura conexão do pool durante a chamada de rede ao
    // Mercado Pago abaixo (ver Finding 2 da revisão final: antes disso,
    // uma única transação envolvia TAMBÉM a chamada HTTP externa, segurando
    // uma conexão do pool — limitado por DB_POOL_MAX — pelo tempo todo que
    // o Mercado Pago demorasse, sem timeout configurado).
    const { plan, payerEmail } = await withTenantContext(async (client) => {
      const planResult = await client.query<PlanRow>(
        'SELECT id, audience, name, price_cents FROM plans WHERE id = $1 AND active = true',
        [planId],
      );
      const plan = planResult.rows[0];
      if (!plan) throw new NotFoundException('Plano não encontrado');
      if (plan.audience !== ctx.audience) {
        throw new BadRequestException('Este plano não está disponível para o seu tipo de conta');
      }

      const emailResult = await client.query<{ email: string }>(
        'SELECT email FROM users WHERE id = $1',
        [ctx.userId],
      );
      const payerEmail = emailResult.rows[0]?.email;

      return { plan, payerEmail };
    });

    // Chamada de rede ao Mercado Pago FORA de qualquer transação/conexão do
    // pool — só acontece entre as duas fases.
    const preapproval = await this.mercadoPago.createPreapproval({
      reason: `Montese SST — ${plan.name}`,
      payerEmail,
      transactionAmountCents: plan.price_cents,
      backUrl: `${process.env.PUBLIC_APP_URL}/planos/assinatura-concluida`,
      externalReference: plan.id,
    });

    // Fase 2 (transação curta nº 2): grava o resultado.
    await withTenantContext(async (client) => {
      try {
        await client.query(
          `INSERT INTO subscriptions (plan_id, tenant_id, technician_user_id, status, mercadopago_preapproval_id)
           VALUES ($1, $2, $3, 'pending', $4)`,
          [plan.id, ctx.tenantId ?? null, ctx.technicianUserId ?? null, preapproval.id],
        );
      } catch (err) {
        mapPgError(err);
      }
    });

    return { initPoint: preapproval.initPoint };
  }
}
