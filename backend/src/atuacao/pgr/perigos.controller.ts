import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PerigosService } from './perigos.service';
import {
  AtivoDto, AtualizarPerigoDto, CriarPerigoDto, DuplicarPerigoDto, ExportarPerigosQuery, ImportarPerigosDto, ListarPerigosQuery, ObterPerigoQuery,
} from './dto/perigo.dto';

// Biblioteca de perigos do PGR. A autorização fina é do PermissionsGuard (sócio: pgr.read / pgr.write);
// a RLS (pgr_hazards) limita o sócio ao global (leitura) e aos clientes Montese. Auditoria dentro da transação (serviço).
@Controller('atuacao/pgr/perigos')
@Roles('socio', 'admin')
export class PerigosController {
  constructor(private readonly svc: PerigosService) {}

  private ator(req: any) { return { id: req.user.id as string, role: req.user.role as string }; }
  private ctx(req: any) { return { role: req.user.role as string, method: req.method as string, path: req.path as string, ip: req.ip as string }; }

  @RequirePermission('pgr.read')
  @Get()
  listar(@Query() q: ListarPerigosQuery, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.listar(c, this.ator(req), q));
  }

  // Rotas fixas antes de ':id'.
  @RequirePermission('pgr.read')
  @Get('exportar')
  exportar(@Query() q: ExportarPerigosQuery, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.exportar(c, this.ator(req), q));
  }

  @Roles('admin')
  @Post('importar')
  importar(@Body() dto: ImportarPerigosDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.importar(c, this.ator(req), dto, this.ctx(req)));
  }

  @RequirePermission('pgr.read')
  @Get(':id')
  obter(@Param('id', ParseUUIDPipe) id: string, @Query() q: ObterPerigoQuery, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.obter(c, this.ator(req), id, q.tenantId));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Post()
  criar(@Body() dto: CriarPerigoDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.criar(c, this.ator(req), dto, this.ctx(req)));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Patch(':id')
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarPerigoDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.atualizar(c, this.ator(req), id, dto, this.ctx(req)));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Post(':id/duplicar')
  duplicar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DuplicarPerigoDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.duplicar(c, this.ator(req), id, dto, this.ctx(req)));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Patch(':id/ativo')
  ativo(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtivoDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.definirAtivo(c, this.ator(req), id, dto.active, this.ctx(req)));
  }
}
