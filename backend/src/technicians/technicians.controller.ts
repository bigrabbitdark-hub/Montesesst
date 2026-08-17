import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { TechniciansService } from './technicians.service';
import { CreateTechnicianDto } from './dto/create-technician.dto';
import { UpdateTechnicianDto } from './dto/update-technician.dto';
import { AssignTechnicianDto } from './dto/assign-technician.dto';

@Controller('technicians')
export class TechniciansController {
  constructor(private readonly technicians: TechniciansService) {}

  @Roles('admin')
  @Post()
  create(@Body() dto: CreateTechnicianDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.technicians.create(client, dto));
  }

  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.technicians.findAll(client));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.technicians.findOne(client, id));
  }

  // Sem checagem manual de dono: a RLS já restringe um 'tecnico' a só enxergar
  // (logo, só conseguir atualizar) a própria linha via user_id = app.user_id.
  @Roles('tecnico', 'admin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTechnicianDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.technicians.update(client, id, dto));
  }

  @Roles('empresa', 'admin')
  @Post(':id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignTechnicianDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'admin' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');
    return req.withTenantContext((client: any) => this.technicians.assign(client, id, tenantId));
  }

  @Roles('empresa', 'admin')
  @Delete(':id/assign')
  unassign(@Param('id') id: string, @Body() dto: AssignTechnicianDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'admin' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');
    return req.withTenantContext((client: any) => this.technicians.unassign(client, id, tenantId));
  }
}
