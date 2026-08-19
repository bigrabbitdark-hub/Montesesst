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
