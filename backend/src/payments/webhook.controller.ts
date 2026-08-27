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
        const status = (err as { status?: number }).status;
        // Erro permanente (4xx — id malformado, recurso não encontrado)
        // nunca vai se resolver com retry: loga e responde 200 pra não
        // gerar retry infinito do Mercado Pago sobre algo que nunca vai
        // funcionar. Erro transiente (5xx, falha de rede/conexão — sem
        // status 4xx reconhecível) merece o retry que um 500 aciona, já
        // que é exatamente o cenário em que tentar de novo tem chance
        // real de funcionar — deixar propagar, não engolir.
        if (typeof status === 'number' && status >= 400 && status < 500) {
          this.logger.error(
            `Erro permanente ao processar subscription_authorized_payment ${dataId}: ${(err as Error).message}`,
          );
          return { message: 'erro ao processar, ver log' };
        }
        this.logger.error(
          `Erro transiente ao processar subscription_authorized_payment ${dataId}, propagando pra retry do Mercado Pago: ${(err as Error).message}`,
        );
        throw err;
      }

      if (!authorizedPayment.preapprovalId) {
        this.logger.warn(
          `authorized_payment ${dataId} sem preapproval_id no payload — gravando sem vínculo`,
        );
      }

      const result = await this.db.withoutTenantContext((client) =>
        client.query('SELECT * FROM payments_record_payment_event($1, $2, $3, $4, $5)', [
          authorizedPayment.id,
          authorizedPayment.preapprovalId,
          authorizedPayment.amountCents,
          authorizedPayment.status,
          authorizedPayment.occurredAt,
        ]),
      );

      if (authorizedPayment.preapprovalId && !result.rows[0]?.subscription_id) {
        this.logger.warn(
          `authorized_payment ${dataId}: preapproval_id ${authorizedPayment.preapprovalId} sem assinatura correspondente — gravado sem vínculo`,
        );
      }

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
