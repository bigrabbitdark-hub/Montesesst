import { Controller, Get, Query, Req } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { EpiCatalogoService } from './epi-catalogo.service';

export class ListarEpiCatalogoQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

// Leitura do catálogo de EPI para o fluxo guiado do PGR (o /epi-catalog-items não é acessível ao sócio).
@Controller('atuacao/pgr/epi-catalogo')
@Roles('socio', 'admin')
export class EpiCatalogoController {
  constructor(private readonly svc: EpiCatalogoService) {}

  @RequirePermission('pgr.read')
  @Get()
  listar(@Query() q: ListarEpiCatalogoQuery, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.listar(c, q.q));
  }
}
