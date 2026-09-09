import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { EmergencyDrillService } from './emergency-drill.service';
import { CreateEmergencyDrillDto } from './dto/create-emergency-drill.dto';

@Controller('emergency-drills')
export class EmergencyDrillController {
  constructor(private readonly drills: EmergencyDrillService) {}

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateEmergencyDrillDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'tecnico' || user.role === 'parceiro' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.drills.create(client, {
        tenantId,
        companyUnitId: dto.company_unit_id,
        dataRealizacao: dto.data_realizacao,
        horario: dto.horario,
        tempoEvacuacaoSegundos: dto.tempo_evacuacao_segundos,
        pontoEncontroAdequado: dto.ponto_encontro_adequado,
        falhasSinalizacao: dto.falhas_sinalizacao,
        falhasIluminacao: dto.falhas_iluminacao,
        portasBloqueadas: dto.portas_bloqueadas,
        extintoresObstruidos: dto.extintores_obstruidos,
        observacoes: dto.observacoes,
        createdByUserId: user.id,
        participants: dto.participants.map((p) => ({ employeeId: p.employee_id, presente: p.presente })),
      }),
    );
  }

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.drills.findAll(client, tenantId));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.drills.findOne(client, id));
  }
}
