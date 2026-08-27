import { Body, Controller, Headers, Logger, Post, Query, UnauthorizedException } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { DatabaseService } from '../common/database/database.service';
import { MercadoPagoService } from './mercadopago.service';
import { verifyMercadoPagoSignature } from './mercadopago-signature.util';

@Controller('payments')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly mercadoPago: MercadoPagoService,
    private readonly db: DatabaseService,
  ) {}

  @Public()
  @Post('mercadopago/webhook')
  async handleWebhook(
    @Query('data.id') queryDataId: string | undefined,
    @Query('type') queryType: string | undefined,
    @Body() body: any,
    @Headers('x-signature') xSignature: string | undefined,
    @Headers('x-request-id') xRequestId: string | undefined,
  ) {
    const dataId = queryDataId ?? body?.data?.id;
    const type = queryType ?? body?.type;

    const valid = verifyMercadoPagoSignature({
      xSignature,
      xRequestId,
      dataId,
      secret: process.env.MERCADOPAGO_WEBHOOK_SECRET || '',
    });
    if (!valid) throw new UnauthorizedException('Assinatura inválida');

    // Cobrança recorrente de assinatura tem tópico próprio — distinto de
    // subscription_preapproval (mudança de status da assinatura em si) e
    // de um "payment" genérico (que o Mercado Pago também pode notificar
    // na mesma URL pra outros fluxos, sem relação com assinatura).
    if (type === 'subscription_authorized_payment') {
      let authorizedPayment;
      try {
        authorizedPayment = await this.mercadoPago.getAuthorizedPayment(dataId);
      } catch (err) {
        // Payload bruto do erro fica no log — confirmação final do schema
        // populado acontece organicamente na primeira cobrança real
        // (ver docs/specs/fase-7-financeiro.md secao 3), não trava o
        // webhook: melhor logar e seguir do que derrubar a notificação
        // com um 500 que o Mercado Pago reinterpretaria como falha de
        // entrega e tentaria de novo indefinidamente.
        this.logger.error(
          `Erro ao processar subscription_authorized_payment ${dataId}: ${(err as Error).message}`,
        );
        return { message: 'erro ao processar, ver log' };
      }

      if (!authorizedPayment.preapprovalId) {
        this.logger.warn(
          `authorized_payment ${dataId} sem preapproval_id no payload — gravando sem vínculo`,
        );
      }

      await this.db.withoutTenantContext((client) =>
        client.query('SELECT * FROM payments_record_payment_event($1, $2, $3, $4, $5)', [
          authorizedPayment.id,
          authorizedPayment.preapprovalId,
          authorizedPayment.amountCents,
          authorizedPayment.status,
          authorizedPayment.occurredAt,
        ]),
      );

      return { message: 'ok' };
    }

    // Só tratamos eventos de assinatura — outros tipos (pagamento avulso,
    // etc.) o Mercado Pago também pode notificar na mesma URL se
    // configurado; devolver 200 evita retry infinito pra evento que não
    // vamos processar.
    if (type !== 'subscription_preapproval') {
      return { message: 'ignorado' };
    }

    // Nunca confia no corpo da notificação pro status em si — busca o
    // estado real (prática recomendada pelo próprio Mercado Pago).
    const preapproval = await this.mercadoPago.getPreapproval(dataId);

    const result = await this.db.withoutTenantContext((client) =>
      client.query('SELECT * FROM payments_update_subscription_status($1, $2)', [
        preapproval.id,
        preapproval.status,
      ]),
    );

    // Zero linhas = preapproval_id não bate com nenhuma assinatura nossa
    // (ex.: id desatualizado/de teste). Continua respondendo 200 (evita
    // retry infinito do Mercado Pago sobre um evento que nunca vai casar),
    // mas sem log isso é indistinguível de um webhook que realmente
    // atualizou uma assinatura — só visível investigando na hora.
    if (result.rows.length === 0) {
      this.logger.warn(
        `Webhook recebido para preapproval_id sem assinatura correspondente: ${preapproval.id} (status ${preapproval.status})`,
      );
    }

    return { message: 'ok' };
  }
}
