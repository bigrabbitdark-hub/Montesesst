import { Body, Controller, Delete, Get, Param, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { DdsService } from './dds.service';
import { CreateDdsRecordDto } from './dto/create-dds-record.dto';

@Controller('cipa/dds')
export class DdsController {
  constructor(private readonly dds: DdsService) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateDdsRecordDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.dds.create(client, req.user.tenantId, dto.company_unit_id, {
        data: dto.data,
        tema: dto.tema,
        numeroParticipantes: dto.numero_participantes,
        responsavel: dto.responsavel,
        observacoes: dto.observacoes,
      }),
    );
  }

  @Get()
  findAll(@Query('company_unit_id') companyUnitId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.dds.findAll(client, companyUnitId));
  }

  @Roles('empresa')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.dds.remove(client, id));
  }
}
