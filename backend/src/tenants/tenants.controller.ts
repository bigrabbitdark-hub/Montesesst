import { Body, Controller, Get, Patch, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantsService } from './tenants.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  // Só 'empresa' — 'admin' não tem um tenant "próprio" (req.user.tenantId
  // é null pra admin), gerenciar tenant arbitrário fica pra Fase 7
  // (Dashboard Admin), fora de escopo aqui.
  @Roles('empresa')
  @Get('me')
  findMe(@Req() req: any) {
    return req.withTenantContext((client: any) => this.tenants.findOne(client, req.user.tenantId));
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch('me')
  updateMe(@Body() dto: UpdateTenantDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.tenants.update(client, req.user.tenantId, dto),
    );
  }
}
