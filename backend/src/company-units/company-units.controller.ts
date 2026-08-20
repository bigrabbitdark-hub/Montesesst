import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CompanyUnitsService } from './company-units.service';
import { CreateCompanyUnitDto } from './dto/create-company-unit.dto';
import { UpdateCompanyUnitDto } from './dto/update-company-unit.dto';

@Controller('company-units')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class CompanyUnitsController {
  constructor(private readonly companyUnits: CompanyUnitsService) {}

  @Roles('empresa', 'admin')
  @Post()
  create(@Body() dto: CreateCompanyUnitDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'admin' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.companyUnits.create(client, tenantId, {
        name: dto.name,
        address_street: dto.address_street,
        address_number: dto.address_number,
        address_city: dto.address_city,
        address_state: dto.address_state,
        address_zip: dto.address_zip,
      }),
    );
  }

  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.companyUnits.findAll(client));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.companyUnits.findOne(client, id));
  }

  @Roles('empresa', 'admin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCompanyUnitDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.companyUnits.update(client, id, dto));
  }

  @Roles('empresa', 'admin')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.companyUnits.remove(client, id));
  }
}
