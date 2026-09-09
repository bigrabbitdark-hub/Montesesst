import { Body, Controller, Get, Param, Patch, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { PreventionCorrectiveActionsService } from './prevention-corrective-actions.service';
import { UpdateCorrectiveActionStatusDto } from './dto/update-corrective-action-status.dto';

@Controller('prevention-corrective-actions')
export class PreventionCorrectiveActionsController {
  constructor(private readonly correctiveActions: PreventionCorrectiveActionsService) {}

  @Get()
  findAll(
    @Query('tenant_id') tenantId: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) => this.correctiveActions.findAll(client, { tenantId, status }));
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateCorrectiveActionStatusDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.correctiveActions.updateStatus(client, id, dto.status as 'pendente' | 'resolvido'),
    );
  }
}
