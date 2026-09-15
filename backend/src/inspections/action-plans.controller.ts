import { BadRequestException, Body, Controller, Get, Param, Patch, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { InspectionsService } from './inspections.service';
import { UpdateActionPlanDto } from './dto/update-action-plan.dto';

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

  @Roles('tecnico', 'parceiro', 'empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateActionPlanDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.inspections.updateActionPlan(client, id, dto));
  }
}
