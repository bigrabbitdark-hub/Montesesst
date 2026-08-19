import { Module } from '@nestjs/common';
import { MercadoPagoService } from './mercadopago.service';
import { PlansController } from './plans.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';

@Module({
  controllers: [PlansController, SubscriptionsController],
  providers: [MercadoPagoService, SubscriptionsService],
  exports: [MercadoPagoService],
})
export class PaymentsModule {}
