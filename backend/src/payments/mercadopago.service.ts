import { Injectable, Logger } from '@nestjs/common';
import { MercadoPagoConfig, PreApproval, Invoice } from 'mercadopago';

export interface CreatePreapprovalInput {
  reason: string;
  payerEmail: string;
  transactionAmountCents: number;
  backUrl: string;
  externalReference: string;
}

export interface PreapprovalResult {
  id: string;
  initPoint: string;
  status: string;
}

export interface AuthorizedPaymentResult {
  id: string;
  preapprovalId: string | null;
  amountCents: number;
  status: string;
  occurredAt: string;
}

// Única porta de saída pra API do Mercado Pago. Preço sempre chega já
// calculado (transactionAmountCents) de fora — este serviço nunca decide
// preço sozinho, só traduz centavos (nosso formato) pra reais (formato
// que o Mercado Pago espera).
@Injectable()
export class MercadoPagoService {
  private readonly logger = new Logger(MercadoPagoService.name);
  // Fallback evita o mesmo erro já visto no EmailService (Fase 2): não dá
  // pra deixar a ausência da credencial derrubar o boot da aplicação
  // inteira — a falha real acontece na chamada, não na configuração.
  private readonly client = new MercadoPagoConfig({
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || 'missing-access-token',
  });

  async createPreapproval(input: CreatePreapprovalInput): Promise<PreapprovalResult> {
    try {
      const preapproval = new PreApproval(this.client);
      const result = await preapproval.create({
        body: {
          reason: input.reason,
          external_reference: input.externalReference,
          payer_email: input.payerEmail,
          back_url: input.backUrl,
          status: 'pending',
          auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: input.transactionAmountCents / 100,
            currency_id: 'BRL',
          },
        },
      });
      if (!result.id || !result.init_point) {
        throw new Error('Resposta inesperada do Mercado Pago ao criar assinatura (sem id ou init_point)');
      }
      return { id: result.id, initPoint: result.init_point, status: result.status ?? 'pending' };
    } catch (err) {
      this.logger.error('Falha ao criar assinatura no Mercado Pago', (err as Error).stack);
      throw err;
    }
  }

  async getPreapproval(id: string): Promise<{ id: string; status: string }> {
    try {
      const preapproval = new PreApproval(this.client);
      const result = await preapproval.get({ id });
      return { id: result.id as string, status: result.status as string };
    } catch (err) {
      this.logger.error(`Falha ao buscar assinatura ${id} no Mercado Pago`, (err as Error).stack);
      throw err;
    }
  }

  async getAuthorizedPayment(id: string): Promise<AuthorizedPaymentResult> {
    try {
      const invoice = new Invoice(this.client);
      const result = await invoice.get({ id });
      // transaction_amount vem em reais — converte pra centavos. status de
      // sucesso real é payment.status (aninhado), não o status/summarized
      // de nível superior, que reflete agendamento do débito, não se o
      // dinheiro foi capturado — ver docs/specs/fase-7-financeiro.md secao 3.
      const amountCents = Math.round((result.transaction_amount ?? 0) * 100);
      return {
        id: result.id ?? id,
        preapprovalId: result.preapproval_id ?? null,
        amountCents,
        status: result.payment?.status ?? result.status ?? 'desconhecido',
        occurredAt: result.debit_date ?? result.date_created ?? new Date().toISOString(),
      };
    } catch (err) {
      this.logger.error(`Falha ao buscar authorized_payment ${id} no Mercado Pago`, (err as Error).stack);
      throw err;
    }
  }
}
