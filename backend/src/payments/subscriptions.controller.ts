import { Body, Controller, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Roles('empresa', 'tecnico')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateSubscriptionDto, @Req() req: any) {
    const user = req.user;
    return req.withTenantContext(async (client: any) => {
      const emailResult = await client.query('SELECT email FROM users WHERE id = $1', [user.id]);
      const payerEmail = emailResult.rows[0]?.email;
      return this.subscriptions.create(client, dto.plan_id, {
        tenantId: user.role === 'empresa' ? user.tenantId : undefined,
        technicianUserId: user.role === 'tecnico' ? user.id : undefined,
        payerEmail,
        audience: user.role,
      });
    });
  }
}
