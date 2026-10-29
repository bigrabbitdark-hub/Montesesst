import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { AvaliacoesService } from './avaliacoes.service';
import { CriarAvaliacaoDto, MapaCalorQueryDto } from './dto/matriz.dto';

// Avaliações de risco (inerente / residual previsto) e mapa de calor por empresa. Sócio: pgr.read (leitura) e
// pgr.read+pgr.write (classificar); a RLS limita o sócio a clientes Montese (empresa de parceiro ⇒ 404 para todos os papéis).
@Controller('atuacao/pgr/empresas/:tenantId')
@Roles('socio', 'admin')
export class AvaliacoesController {
  constructor(private readonly svc: AvaliacoesService) {}

  private ator(req: any) { return { id: req.user.id as string, role: req.user.role as string }; }
  private ctx(req: any) { return { role: req.user.role as string, method: req.method as string, path: req.path as string, ip: req.ip as string }; }

  @RequirePermission('pgr.read')
  @Get('riscos/:riscoId/avaliacoes')
  listar(@Param('tenantId', ParseUUIDPipe) t: string, @Param('riscoId', ParseUUIDPipe) r: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.listar(c, this.ator(req), t, r));
  }

  @RequirePermission('pgr.read', 'pgr.write')
  @Post('riscos/:riscoId/avaliacoes')
  criar(@Param('tenantId', ParseUUIDPipe) t: string, @Param('riscoId', ParseUUIDPipe) r: string, @Body() dto: CriarAvaliacaoDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.criar(c, this.ator(req), t, r, dto, this.ctx(req)));
  }

  @RequirePermission('pgr.read')
  @Get('mapa-calor')
  mapaCalor(@Param('tenantId', ParseUUIDPipe) t: string, @Query() q: MapaCalorQueryDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.mapaCalor(c, t, q));
  }
}
