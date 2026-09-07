import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ColumnMapping } from './spreadsheet-import.util';
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

  @Roles('empresa', 'admin')
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importCsv(
    @UploadedFile() file: Express.Multer.File,
    @Query('tenant_id') tenantIdParam: string | undefined,
    @Req() req: any,
  ) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    const tenantId = req.user.role === 'admin' ? tenantIdParam : req.user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.employees.importCsv(client, tenantId, file.buffer.toString('utf-8')),
    );
  }

  @Roles('empresa', 'admin')
  @Post('import-preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async previewImport(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    return this.employees.previewSpreadsheet(file.buffer, file.mimetype);
  }

  @Roles('empresa', 'admin')
  @Post('import-mapped')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  importMapped(
    @UploadedFile() file: Express.Multer.File,
    @Body('mapping') mappingRaw: string,
    @Query('tenant_id') tenantIdParam: string | undefined,
    @Req() req: any,
  ) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    let mapping: ColumnMapping;
    try {
      mapping = JSON.parse(mappingRaw);
    } catch {
      throw new BadRequestException('Mapeamento de colunas inválido');
    }
    const tenantId = req.user.role === 'admin' ? tenantIdParam : req.user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.employees.importMapped(client, tenantId, file.buffer, file.mimetype, mapping),
    );
  }

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    if ((req.user.role === 'tecnico' || req.user.role === 'parceiro') && !tenantId) {
      throw new BadRequestException('tenant_id é obrigatório');
    }
    return req.withTenantContext((client: any) => this.employees.findAll(client, tenantId));
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
