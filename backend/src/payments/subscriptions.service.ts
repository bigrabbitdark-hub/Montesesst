import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { MercadoPagoService } from './mercadopago.service';
import { mapPgError } from '../common/pg-error.util';
import { DatabaseService } from '../common/database/database.service';

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

export interface SubscriptionAdminRow {
  id: string;
  status: string;
  created_at: string;
  plan_id: string;
  plan_name: string;
  price_cents: number;
  tenant_id: string | null;
  tenant_name: string | null;
  technician_user_id: string | null;
  technician_name: string | null;
}

export interface PaymentEventRow {
  id: string;
  mercadopago_payment_id: string;
  amount_cents: number;
  status: string;
  occurred_at: string;
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly mercadoPago: MercadoPagoService,
    private readonly db: DatabaseService,
  ) {}

  // ITEM 011: chamado pelo webhook quando uma assinatura vira 'authorized'.
  // Cancela, no Mercado Pago e no banco, as OUTRAS assinaturas 'authorized' do
  // mesmo sujeito — trocar de plano deixa de gerar duas cobranças recorrentes.
  // A antiga só sai depois da nova estar confirmada (nunca antes, para não deixar
  // o cliente sem plano se o pagamento novo falhar). Idempotente: numa segunda
  // entrega do mesmo webhook não sobra nada para cancelar.
  async supersedePreviousAuthorized(newPreapprovalId: string): Promise<string[]> {
    const others = await this.db.withoutTenantContext((client) =>
      client.query<{ preapproval_id: string }>('SELECT preapproval_id FROM payments_superseded_preapprovals($1)', [
        newPreapprovalId,
      ]),
    );

    const cancelled: string[] = [];
    for (const { preapproval_id: oldId } of others.rows) {
      try {
        const confirmed = await this.mercadoPago.updatePreapprovalStatus(oldId, 'cancelled');
        // Grava o status CONFIRMADO pelo Mercado Pago, não o pedido.
        await this.db.withoutTenantContext((client) =>
          client.query('SELECT * FROM payments_update_subscription_status($1, $2)', [oldId, confirmed.status]),
        );
        cancelled.push(oldId);
      } catch (err) {
        const status = (err as { status?: number }).status;
        // Erro permanente (4xx — ex.: já estava cancelada lá): retry nunca resolve;
        // registra e segue. Fica 'authorized' localmente até uma reconciliação
        // (ITEM 030). Transiente (5xx/rede): relança, o Mercado Pago reenvia o
        // webhook e esta operação é idempotente.
        if (typeof status === 'number' && status >= 400 && status < 500) {
          this.logger.error(`Não foi possível cancelar a assinatura anterior ${oldId} (${status}): ${(err as Error).message}`);
          continue;
        }
        throw err;
      }
    }
    return cancelled;
  }

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

  async findAllForAdmin(client: PoolClient): Promise<SubscriptionAdminRow[]> {
    const result = await client.query<SubscriptionAdminRow>(
      `SELECT s.id, s.status, s.created_at,
         p.id AS plan_id, p.name AS plan_name, p.price_cents,
         s.tenant_id, t.name AS tenant_name,
         s.technician_user_id, u.full_name AS technician_name
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       LEFT JOIN tenants t ON t.id = s.tenant_id
       LEFT JOIN users u ON u.id = s.technician_user_id
       ORDER BY s.created_at DESC`,
    );
    return result.rows;
  }

  async updateStatus(
    withTenantContext: WithTenantContext,
    subscriptionId: string,
    status: 'authorized' | 'paused' | 'cancelled',
  ): Promise<SubscriptionAdminRow> {
    // Fase 1 (transação curta nº 1): só leitura — preapproval_id da
    // assinatura. Não segura conexão do pool durante a chamada de rede ao
    // Mercado Pago abaixo (mesmo motivo de create() acima).
    const preapprovalId = await withTenantContext(async (client) => {
      const result = await client.query<{ mercadopago_preapproval_id: string }>(
        'SELECT mercadopago_preapproval_id FROM subscriptions WHERE id = $1',
        [subscriptionId],
      );
      const id = result.rows[0]?.mercadopago_preapproval_id;
      if (!id) throw new NotFoundException('Assinatura não encontrada');
      return id;
    });

    // Chamada de rede ao Mercado Pago FORA de qualquer transação/conexão
    // do pool — só acontece entre as duas fases.
    const confirmed = await this.mercadoPago.updatePreapprovalStatus(preapprovalId, status);

    // Fase 2 (transação curta nº 2): grava o status CONFIRMADO pelo
    // Mercado Pago (não o pedido) — mesmo princípio de "nunca confia,
    // busca o estado real" já usado no webhook. Reusa
    // payments_update_subscription_status (mesma função SQL que o
    // webhook já chama), incluindo sua sincronização de tenants.plan
    // quando o novo status é 'authorized'.
    return withTenantContext(async (client) => {
      await client.query('SELECT * FROM payments_update_subscription_status($1, $2)', [
        preapprovalId,
        confirmed.status,
      ]);
      const result = await client.query<SubscriptionAdminRow>(
        `SELECT s.id, s.status, s.created_at,
           p.id AS plan_id, p.name AS plan_name, p.price_cents,
           s.tenant_id, t.name AS tenant_name,
           s.technician_user_id, u.full_name AS technician_name
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
         LEFT JOIN tenants t ON t.id = s.tenant_id
         LEFT JOIN users u ON u.id = s.technician_user_id
         WHERE s.id = $1`,
        [subscriptionId],
      );
      return result.rows[0];
    });
  }

  async findPaymentEvents(client: PoolClient, subscriptionId: string): Promise<PaymentEventRow[]> {
    const result = await client.query<PaymentEventRow>(
      `SELECT id, mercadopago_payment_id, amount_cents, status, occurred_at
       FROM payment_events
       WHERE subscription_id = $1
       ORDER BY occurred_at DESC`,
      [subscriptionId],
    );
    return result.rows;
  }

  async getActiveEmployeeLimit(client: PoolClient, tenantId: string): Promise<number | null> {
    const result = await client.query<{ employee_limit: number | null }>(
      `SELECT p.employee_limit
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.tenant_id = $1 AND s.status = 'authorized'`,
      [tenantId],
    );
    if (result.rows.length === 0) return null;
    if (result.rows.some((row) => row.employee_limit === null)) return null;
    return Math.max(...result.rows.map((row) => row.employee_limit as number));
  }
}
