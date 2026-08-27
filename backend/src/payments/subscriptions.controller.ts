import { Body, Controller, Get, Param, Patch, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionStatusDto } from './dto/update-subscription-status.dto';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Roles('empresa', 'tecnico')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateSubscriptionDto, @Req() req: any) {
    const user = req.user;
    return this.subscriptions.create(req.withTenantContext.bind(req), dto.plan_id, {
      tenantId: user.role === 'empresa' ? user.tenantId : undefined,
      technicianUserId: user.role === 'tecnico' ? user.id : undefined,
      userId: user.id,
      audience: user.role,
    });
  }

  @Roles('admin')
  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.subscriptions.findAllForAdmin(client));
  }

  @Roles('admin')
  @Get(':id/payment-events')
  findPaymentEvents(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.subscriptions.findPaymentEvents(client, id));
  }

  @Roles('admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateSubscriptionStatusDto, @Req() req: any) {
    return this.subscriptions.updateStatus(req.withTenantContext.bind(req), id, dto.status);
  }
}
