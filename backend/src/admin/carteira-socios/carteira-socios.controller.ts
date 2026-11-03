import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Put, Query, Req } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CarteiraSociosService } from './carteira-socios.service';
import { ListarCarteiraQuery, MarcarCarteiraDto } from './dto/carteira-socios.dto';

// Somente admin (sócio fora de @Roles de propósito): o sócio nunca altera a própria carteira.
@Controller('admin/carteira-socios')
@Roles('admin')
export class CarteiraSociosController {
  constructor(private readonly svc: CarteiraSociosService) {}

  @Get()
  listar(@Query() q: ListarCarteiraQuery, @Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.listar(c, q));
  }

  @Put(':tenantId')
  marcar(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: MarcarCarteiraDto, @Req() req: any) {
    const ctx = { role: req.user.role, method: req.method, path: req.path, ip: req.ip };
    return req.withTenantContext((c: any) => this.svc.marcar(c, req.user.id, tenantId, dto.note, ctx));
  }

  @Delete(':tenantId')
  desmarcar(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Req() req: any) {
    const ctx = { role: req.user.role, method: req.method, path: req.path, ip: req.ip };
    return req.withTenantContext((c: any) => this.svc.desmarcar(c, req.user.id, tenantId, ctx));
  }
}
