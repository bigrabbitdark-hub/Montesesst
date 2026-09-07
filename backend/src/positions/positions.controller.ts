import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { PositionsService } from './positions.service';
import { CreatePositionDto } from './dto/create-position.dto';
import { UpdatePositionDto } from './dto/update-position.dto';
import { ConfirmLinksDto } from './dto/confirm-links.dto';

@Controller('positions')
export class PositionsController {
  constructor(private readonly positions: PositionsService) {}

  @Roles('empresa', 'admin')
  @Post()
  create(@Body() dto: CreatePositionDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'admin' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) => this.positions.create(client, tenantId, dto.name));
  }

  @Get()
  findAll(@Query('tenant_id') tenantIdParam: string | undefined, @Req() req: any) {
    const tenantId = req.user.role === 'admin' ? tenantIdParam : req.user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) => this.positions.findAll(client, tenantId));
  }

  @Roles('empresa', 'admin')
  @Get('link-suggestions')
  getLinkSuggestions(@Query('tenant_id') tenantIdParam: string | undefined, @Req() req: any) {
    const tenantId = req.user.role === 'admin' ? tenantIdParam : req.user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) => this.positions.getLinkSuggestions(client, tenantId));
  }

  @Roles('empresa', 'admin')
  @Post('confirm-links')
  confirmLinks(@Body() dto: ConfirmLinksDto, @Query('tenant_id') tenantIdParam: string | undefined, @Req() req: any) {
    const tenantId = req.user.role === 'admin' ? tenantIdParam : req.user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) => this.positions.confirmLinks(client, tenantId, dto.groups));
  }

  @Roles('empresa', 'admin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePositionDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.positions.update(client, id, dto.name));
  }
}
