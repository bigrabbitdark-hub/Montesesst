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
  payerEmail: string;
  audience: 'empresa' | 'tecnico';
}

@Injectable()
export class SubscriptionsService {
  constructor(private readonly mercadoPago: MercadoPagoService) {}

  async create(client: PoolClient, planId: string, ctx: SubscribeContext): Promise<{ initPoint: string }> {
    const planResult = await client.query<PlanRow>(
      'SELECT id, audience, name, price_cents FROM plans WHERE id = $1 AND active = true',
      [planId],
    );
    const plan = planResult.rows[0];
    if (!plan) throw new NotFoundException('Plano não encontrado');
    if (plan.audience !== ctx.audience) {
      throw new BadRequestException('Este plano não está disponível para o seu tipo de conta');
    }

    const preapproval = await this.mercadoPago.createPreapproval({
      reason: `Montese SST — ${plan.name}`,
      payerEmail: ctx.payerEmail,
      transactionAmountCents: plan.price_cents,
      backUrl: `${process.env.PUBLIC_APP_URL}/planos/assinatura-concluida`,
      externalReference: plan.id,
    });

    try {
      await client.query(
        `INSERT INTO subscriptions (plan_id, tenant_id, technician_user_id, status, mercadopago_preapproval_id)
         VALUES ($1, $2, $3, 'pending', $4)`,
        [plan.id, ctx.tenantId ?? null, ctx.technicianUserId ?? null, preapproval.id],
      );
    } catch (err) {
      mapPgError(err);
    }

    return { initPoint: preapproval.initPoint };
  }
}
