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
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/decorators/roles.decorator';
import { FireSafetyEquipmentService } from './fire-safety-equipment.service';
import { CreateFireSafetyEquipmentDto } from './dto/create-fire-safety-equipment.dto';
import { UpdateFireSafetyEquipmentDto } from './dto/update-fire-safety-equipment.dto';

@Controller('fire-safety-equipment')
export class FireSafetyEquipmentController {
  constructor(private readonly equipment: FireSafetyEquipmentService) {}

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateFireSafetyEquipmentDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'tecnico' || user.role === 'parceiro' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.equipment.create(client, {
        tenantId,
        tipo: dto.tipo as any,
        codigo: dto.codigo,
        companyUnitId: dto.company_unit_id,
        localizacao: dto.localizacao,
        dataInstalacao: dto.data_instalacao,
        dataUltimaManutencao: dto.data_ultima_manutencao,
        proximaManutencao: dto.proxima_manutencao,
        empresaResponsavel: dto.empresa_responsavel,
        observacoes: dto.observacoes,
        agenteExtintor: dto.agente_extintor,
        capacidade: dto.capacidade,
        classeFogo: dto.classe_fogo,
        createdByUserId: user.id,
      }),
    );
  }

  @Get()
  findAll(
    @Query('tenant_id') tenantId: string | undefined,
    @Query('tipo') tipo: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) =>
      this.equipment.findAll(client, tenantId, { tipo, status: status as any }),
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.equipment.findOne(client, id));
  }

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFireSafetyEquipmentDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.equipment.update(client, id, dto));
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.equipment.remove(client, id));
  }

  @Roles('empresa', 'tecnico', 'parceiro')
  @Post(':id/foto')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadFoto(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    return req.withTenantContext((client: any) => this.equipment.uploadFoto(client, id, file));
  }

  @Get(':id/foto')
  getFoto(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.equipment.getFotoUrl(client, id));
  }
}
