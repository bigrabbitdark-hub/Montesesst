import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Req } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { GhesService } from './ghes.service';
import { PgrPainelService } from './pgr-painel.service';
import { AtualizarGheDto, CriarGheDto, DefinirCargosDto } from './dto/ghe.dto';

// GHEs, cargos e resumo do PGR por empresa. Autorização fina: PermissionsGuard (sócio: pgr.read / pgr.write);
// a RLS limita o sócio a clientes Montese (empresa de parceiro ⇒ 404). Auditoria na transação (serviço).
@Controller('atuacao/pgr/empresas/:tenantId')
@Roles('socio', 'admin')
export class GhesController {
  constructor(private readonly svc: GhesService, private readonly painel: PgrPainelService) {}

  private ator(req: any) { return { id: req.user.id as string, role: req.user.role as string }; }
  private ctx(req: any) { return { role: req.user.role as string, method: req.method as string, path: req.path as string, ip: req.ip as string }; }

  @RequirePermission('pgr.read')
  @Get('resumo')
  resumo(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.painel.resumo(c, tenantId));
  }

  @RequirePermission('pgr.read')
  @Get('ghes')
  listar(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.listar(c, tenantId));
  }

  @RequirePermission('pgr.read')
  @Get('cargos')
  cargosDaEmpresa(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.cargos(c, tenantId));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Post('ghes')
  criar(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: CriarGheDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.criar(c, this.ator(req), tenantId, dto, this.ctx(req)));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Patch('ghes/:id')
  atualizar(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarGheDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.atualizar(c, this.ator(req), tenantId, id, dto, this.ctx(req)));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Delete('ghes/:id')
  excluir(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.excluir(c, this.ator(req), tenantId, id, this.ctx(req)));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Put('ghes/:id/cargos')
  cargos(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DefinirCargosDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.definirCargos(c, this.ator(req), tenantId, id, dto, this.ctx(req)));
  }
}
