import { Body, Controller, Get, Param, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CommitteesService } from './committees.service';
import { CreateCommitteeDto } from './dto/create-committee.dto';
import { GenerateMeetingsDto } from './dto/generate-meetings.dto';

@Controller('cipa/committees')
export class CommitteesController {
  constructor(private readonly committees: CommitteesService) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateCommitteeDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.committees.create(
        client,
        req.user.tenantId,
        dto.company_unit_id,
        dto.ano,
        dto.data_inicio,
        dto.data_termino,
        dto.responsavel_user_id,
      ),
    );
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/generate-meetings')
  generateMeetings(@Param('id') id: string, @Body() dto: GenerateMeetingsDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.committees.generateMeetings(client, id, dto.dia_semana_preferido, dto.horario, dto.local),
    );
  }

  // Sem @Roles — leitura aberta a técnico/parceiro vinculados, RLS decide
  // visibilidade. Mesmo padrão de MeetingsController.findAll/findOne
  // (achado da revisão final, Fix 9: não havia nenhuma rota de leitura
  // pra cipa_committees).
  @Get()
  findAll(@Query('company_unit_id') companyUnitId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.committees.findAll(client, companyUnitId));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.committees.findOne(client, id));
  }
}
