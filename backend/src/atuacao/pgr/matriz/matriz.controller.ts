import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { MatrizService } from './matriz.service';
import { AtualizarMatrizDto, CriarMatrizDto, PublicarMatrizDto, ValidarMatrizDto } from './dto/matriz.dto';

// Matriz de risco versionada (global da Montese). Leitura: admin e sócio com pgr.read (o sócio só vê publicada/arquivada).
// Escrita: SOMENTE admin (@Roles('admin') por rota; o sócio, sem @RequirePermission nessas rotas, é negado pelo RolesGuard).
@Controller('atuacao/pgr/matriz')
export class MatrizController {
  constructor(private readonly svc: MatrizService) {}

  private ator(req: any) { return { id: req.user.id as string, role: req.user.role as string }; }
  private ctx(req: any) { return { role: req.user.role as string, method: req.method as string, path: req.path as string, ip: req.ip as string }; }

  @Roles('socio', 'admin') @RequirePermission('pgr.read')
  @Get()
  listar(@Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.listar(c, this.ator(req)));
  }

  // Declarada antes de ':id' (e ParseUUIDPipe) para que "vigente" não seja lido como id.
  @Roles('socio', 'admin') @RequirePermission('pgr.read')
  @Get('vigente')
  vigente(@Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.vigente(c, this.ator(req)));
  }

  @Roles('socio', 'admin') @RequirePermission('pgr.read')
  @Get(':id')
  obter(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.obter(c, this.ator(req), id));
  }

  @Roles('admin')
  @Post()
  criar(@Body() dto: CriarMatrizDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.criar(c, this.ator(req), dto, this.ctx(req)));
  }

  @Roles('admin')
  @Post('validar')
  validar(@Body() dto: ValidarMatrizDto) {
    return this.svc.validar(dto);
  }

  @Roles('admin')
  @Patch(':id')
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarMatrizDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.atualizar(c, this.ator(req), id, dto, this.ctx(req)));
  }

  @Roles('admin')
  @Post(':id/publicar')
  publicar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PublicarMatrizDto, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.publicar(c, this.ator(req), id, this.ctx(req), dto));
  }

  @Roles('admin')
  @Post(':id/arquivar')
  arquivar(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.arquivar(c, this.ator(req), id, this.ctx(req)));
  }
}
