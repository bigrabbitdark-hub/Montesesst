import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Roles('empresa', 'admin')
  @Post()
  create(@Body() dto: CreateEmployeeDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'admin' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.employees.create(client, tenantId, {
        full_name: dto.full_name,
        cpf: dto.cpf,
        birth_date: dto.birth_date,
        position: dto.position,
        admission_date: dto.admission_date,
        company_unit_id: dto.company_unit_id,
      }),
    );
  }

  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.employees.findAll(client));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.employees.findOne(client, id));
  }

  @Roles('empresa', 'admin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.employees.update(client, id, dto));
  }

  @Roles('empresa', 'admin')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.employees.remove(client, id));
  }
}
