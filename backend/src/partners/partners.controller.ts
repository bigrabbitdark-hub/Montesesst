import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { PartnersService } from './partners.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';
import { AssignPartnerDto } from './dto/assign-partner.dto';

@Controller('partners')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Roles('admin')
  @Post()
  create(@Body() dto: CreatePartnerDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.partners.create(client, dto));
  }

  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.partners.findAll(client));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.partners.findOne(client, id));
  }

  // Sem checagem manual de dono: a RLS já restringe um 'parceiro' a só enxergar
  // (logo, só conseguir atualizar) a própria linha via user_id = app.user_id.
  @Roles('parceiro', 'admin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePartnerDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.partners.update(client, id, dto));
  }

  @Roles('empresa', 'admin')
  @Post(':id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignPartnerDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'admin' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');
    return req.withTenantContext((client: any) => this.partners.assign(client, id, tenantId));
  }

  @Roles('empresa', 'admin')
  @Delete(':id/assign')
  unassign(@Param('id') id: string, @Body() dto: AssignPartnerDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'admin' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');
    return req.withTenantContext((client: any) => this.partners.unassign(client, id, tenantId));
  }
}
