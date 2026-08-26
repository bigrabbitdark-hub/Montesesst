import { Body, Controller, Get, Patch, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantsService } from './tenants.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  // Lista completa (todos os tenants, com vínculos agregados) — só admin,
  // ver findAll() abaixo. findMe/updateMe seguem exclusivos de 'empresa',
  // sempre resolvendo o próprio tenantId do JWT, nunca um id vindo do
  // cliente.
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

  // 'tenants' não tem RLS própria — @Roles('admin') é a única barreira
  // pra esta lista completa, sem filtro nenhum. Ver Global Constraints do
  // plano da Fase 7 sub-projeto A.
  @Roles('admin')
  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.tenants.findAllWithLinks(client));
  }
}
