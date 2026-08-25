import { BadRequestException, Controller, Get, Query, Req } from '@nestjs/common';
import { InspectionsService } from './inspections.service';

@Controller('action-plans')
export class ActionPlansController {
  constructor(private readonly inspections: InspectionsService) {}

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    if ((req.user.role === 'tecnico' || req.user.role === 'parceiro') && !tenantId) {
      throw new BadRequestException('tenant_id é obrigatório');
    }
    return req.withTenantContext((client: any) => this.inspections.findActionPlans(client, tenantId));
  }
}
