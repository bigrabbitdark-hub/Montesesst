import { Module } from '@nestjs/common';
import { MercadoPagoService } from './mercadopago.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionAccessService } from './subscription-access.service';
import { SubscriptionsController } from './subscriptions.controller';
import { WebhookController } from './webhook.controller';
import { SubscriptionReconciliationCronService } from './subscription-reconciliation.cron';

@Module({
  controllers: [PlansController, SubscriptionsController, WebhookController],
  providers: [
    MercadoPagoService,
    PlansService,
    SubscriptionsService,
    SubscriptionAccessService,
    SubscriptionReconciliationCronService,
  ],
  exports: [MercadoPagoService, SubscriptionsService, SubscriptionAccessService],
})
export class PaymentsModule {}
