import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { EpiService } from './epi.service';
import { CreateEpiDto } from './dto/create-epi.dto';
import { CreateEpiDeliveryDto } from './dto/create-epi-delivery.dto';

@Controller('epis')
export class EpisController {
  constructor(private readonly epi: EpiService) {}

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateEpiDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'tecnico' || user.role === 'parceiro' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.epi.create(client, {
        tenantId,
        epiCatalogItemId: dto.epi_catalog_item_id,
        caNumber: dto.ca_number,
        caValidUntil: dto.ca_valid_until,
        createdByUserId: user.id,
      }),
    );
  }

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.epi.findAll(client, tenantId));
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.epi.remove(client, id));
  }

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/deliveries')
  createDelivery(@Param('id') id: string, @Body() dto: CreateEpiDeliveryDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.epi.createDelivery(client, id, {
        employeeId: dto.employee_id,
        deliveredAt: dto.delivered_at,
        signedByName: dto.signed_by_name,
        createdByUserId: req.user.id,
      }),
    );
  }

  @Get(':id/deliveries')
  findDeliveries(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.epi.findDeliveries(client, id));
  }
}
