import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AuditService } from '../common/audit/audit.service';
import { AgendaService } from './agenda.service';
import { ChangeAgendaStatusDto, CreateAgendaDto, ListAgendaQuery, UpdateAgendaDto } from './dto/agenda.dto';

@Controller('atuacao/agenda')
@Roles('socio')
@RequirePermission('appointments.manage')
export class AgendaController {
  constructor(private readonly agenda: AgendaService, private readonly audit: AuditService) {}

  // Auditoria: só ids e nomes de campo, nunca título, pauta, notas ou motivo.
  private log(req: any, action: string, id: string, statusCode: number, detail?: string) {
    return this.audit.log({
      actorUserId: req.user.id, actorRole: req.user.role, action, resourceType: 'agenda_event', resourceId: id,
      method: req.method, path: req.path, statusCode, ipAddress: req.ip, detail,
    });
  }

  // Ordem importa: a listagem ('') antes de ':id'.
  @Get()
  listar(@Query() q: ListAgendaQuery, @Req() req: any) {
    return req.withTenantContext((c: any) => this.agenda.listar(c, req.user.id, q));
  }

  @Get(':id')
  obter(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.agenda.obter(c, id));
  }

  @Post()
  async criar(@Body() dto: CreateAgendaDto, @Req() req: any) {
    const e = await req.withTenantContext((c: any) => this.agenda.criar(c, req.user.id, dto));
    await this.log(req, 'agenda.created', e.id, 201, `tenant: ${e.tenant_id}; responsavel: ${e.owner_user_id}`);
    return e;
  }

  @Patch(':id')
  async atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAgendaDto, @Req() req: any) {
    const r = await req.withTenantContext((c: any) => this.agenda.atualizar(c, id, dto));
    if (r.reagendado) await this.log(req, 'agenda.rescheduled', id, 200, 'campos: event_date, start_time');
    return r.evento;
  }

  @Post(':id/status')
  async status(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeAgendaStatusDto, @Req() req: any) {
    const e = await req.withTenantContext((c: any) => this.agenda.mudarStatus(c, id, dto));
    await this.log(req, e.status === 'cancelado' ? 'agenda.cancelled' : 'agenda.completed', id, 201);
    return e;
  }
}
