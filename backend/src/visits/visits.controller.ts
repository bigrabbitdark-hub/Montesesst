import { Body, Controller, Get, Param, Patch, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { VisitsService } from './visits.service';
import { CreateVisitDto } from './dto/create-visit.dto';
import { ConfirmVisitDto } from './dto/confirm-visit.dto';
import { ConcludeVisitDto } from './dto/conclude-visit.dto';

@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateVisitDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.visits.create(client, req.user.tenantId, req.user.id, dto.technician_user_id, dto.preferred_date, dto.motivo),
    );
  }

  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.visits.findAll(client, req.user));
  }

  @Roles('tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id/confirmar')
  confirmar(@Param('id') id: string, @Body() dto: ConfirmVisitDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.visits.confirm(client, id, req.user.id, dto.confirmed_date),
    );
  }

  @Patch(':id/cancelar')
  cancelar(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.visits.cancel(client, id, req.user));
  }

  @Roles('tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id/concluir')
  concluir(@Param('id') id: string, @Body() dto: ConcludeVisitDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.visits.conclude(client, id, req.user.id, dto.inspection_id),
    );
  }
}
