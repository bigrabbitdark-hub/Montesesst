import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AuditService } from '../common/audit/audit.service';
import { TarefasService } from './tarefas.service';
import { ChangeTarefaStatusDto, CreateTarefaDto, EncaminharTarefaDto, ListTarefasQuery, UpdateTarefaDto } from './dto/tarefa.dto';

@Controller('atuacao/tarefas')
@Roles('socio')
export class TarefasController {
  constructor(private readonly tarefas: TarefasService, private readonly audit: AuditService) {}

  // Auditoria: só ids/nomes de evento, nunca título, descrição ou nota.
  private log(req: any, action: string, id: string, detail?: string) {
    return this.audit.log({
      actorUserId: req.user.id, actorRole: req.user.role, action, resourceType: 'task', resourceId: id,
      method: req.method, path: req.url, statusCode: 200, ipAddress: req.ip, detail,
    });
  }

  // Ordem importa: 'resumo' antes de ':id'.
  @RequirePermission('tasks.read')
  @Get('resumo')
  resumo(@Req() req: any) {
    return req.withTenantContext((c: any) => this.tarefas.resumo(c, req.user.id));
  }

  @RequirePermission('tasks.read')
  @Get()
  listar(@Query() q: ListTarefasQuery, @Req() req: any) {
    return req.withTenantContext((c: any) => this.tarefas.listar(c, req.user.id, q));
  }

  @RequirePermission('tasks.read')
  @Get(':id')
  obter(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.tarefas.obter(c, id));
  }

  @RequirePermission('tasks.write')
  @Post()
  async criar(@Body() dto: CreateTarefaDto, @Req() req: any) {
    const t = await req.withTenantContext((c: any) => this.tarefas.criar(c, req.user.id, dto));
    await this.log(req, 'task.created', t.id, `tenant: ${t.tenant_id}; responsavel: ${t.assignee_user_id}`);
    return t;
  }

  @RequirePermission('tasks.write')
  @Patch(':id')
  async atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTarefaDto, @Req() req: any) {
    const r = await req.withTenantContext((c: any) => this.tarefas.atualizar(c, req.user.id, id, dto));
    if (r.reassigned) await this.log(req, 'task.reassigned', id, `de: ${r.reassigned.from}; para: ${r.reassigned.to}`);
    return r.tarefa;
  }

  @RequirePermission('tasks.write')
  @Post(':id/status')
  async status(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeTarefaStatusDto, @Req() req: any) {
    const t = await req.withTenantContext((c: any) => this.tarefas.mudarStatus(c, req.user.id, id, dto));
    if (t.status === 'completed') await this.log(req, 'task.completed', id);
    return t;
  }

  // Nota (opcional) vai só para task_events; a auditoria leva apenas os ids de origem e destino.
  @RequirePermission('tasks.write')
  @Post(':id/encaminhar')
  async encaminhar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EncaminharTarefaDto, @Req() req: any) {
    const r = await req.withTenantContext((c: any) => this.tarefas.encaminhar(c, req.user.id, id, dto));
    await this.log(req, 'task.reassigned', id, `de: ${r.de}; para: ${r.para}`);
    return r.tarefa;
  }
}
