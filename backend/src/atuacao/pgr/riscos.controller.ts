import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RiscosService } from './riscos.service';
import {
  AtualizarControleDto, AtualizarMedicaoDto, AtualizarRiscoDto, CopiarRiscosDto, CriarControleDto, CriarMedicaoDto, CriarRiscosDto,
} from './dto/risco.dto';

// Riscos, controles e medições do inventário do PGR. Autorização fina: PermissionsGuard (sócio: pgr.read / pgr.write);
// a RLS limita o sócio a clientes Montese. Auditoria na transação (serviço).
@Controller('atuacao/pgr/empresas/:tenantId')
@Roles('socio', 'admin')
export class RiscosController {
  constructor(private readonly svc: RiscosService) {}

  private ator(req: any) { return { id: req.user.id as string, role: req.user.role as string }; }
  private ctx(req: any) { return { role: req.user.role as string, method: req.method as string, path: req.path as string, ip: req.ip as string }; }

  @RequirePermission('pgr.read')
  @Get('ghes/:gheId/riscos')
  listar(@Param('tenantId', ParseUUIDPipe) t: string, @Param('gheId', ParseUUIDPipe) g: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.listar(c, t, g));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Post('ghes/:gheId/riscos')
  criar(@Param('tenantId', ParseUUIDPipe) t: string, @Param('gheId', ParseUUIDPipe) g: string, @Body() dto: CriarRiscosDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.criarDePerigos(c, this.ator(req), t, g, dto, this.ctx(req)));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Post('ghes/:gheId/copiar-riscos')
  copiar(@Param('tenantId', ParseUUIDPipe) t: string, @Param('gheId', ParseUUIDPipe) g: string, @Body() dto: CopiarRiscosDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.copiar(c, this.ator(req), t, g, dto, this.ctx(req)));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Patch('riscos/:id')
  atualizar(@Param('tenantId', ParseUUIDPipe) t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarRiscoDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.atualizar(c, this.ator(req), t, id, dto, this.ctx(req)));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Delete('riscos/:id')
  excluir(@Param('tenantId', ParseUUIDPipe) t: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.excluir(c, this.ator(req), t, id, this.ctx(req)));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Post('riscos/:id/controles')
  criarControle(@Param('tenantId', ParseUUIDPipe) t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CriarControleDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.criarControle(c, this.ator(req), t, id, dto, this.ctx(req)));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Patch('controles/:id')
  atualizarControle(@Param('tenantId', ParseUUIDPipe) t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarControleDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.atualizarControle(c, this.ator(req), t, id, dto, this.ctx(req)));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Delete('controles/:id')
  excluirControle(@Param('tenantId', ParseUUIDPipe) t: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.excluirControle(c, this.ator(req), t, id, this.ctx(req)));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Post('riscos/:id/medicoes')
  criarMedicao(@Param('tenantId', ParseUUIDPipe) t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CriarMedicaoDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.criarMedicao(c, this.ator(req), t, id, dto, this.ctx(req)));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Patch('medicoes/:id')
  atualizarMedicao(@Param('tenantId', ParseUUIDPipe) t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarMedicaoDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.atualizarMedicao(c, this.ator(req), t, id, dto, this.ctx(req)));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Delete('medicoes/:id')
  excluirMedicao(@Param('tenantId', ParseUUIDPipe) t: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.excluirMedicao(c, this.ator(req), t, id, this.ctx(req)));
  }
}
