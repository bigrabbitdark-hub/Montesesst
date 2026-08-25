import { Controller, Get, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantTechniciansService } from './tenant-technicians.service';

@Controller('tenant-technicians')
export class TenantTechniciansController {
  constructor(private readonly tenantTechnicians: TenantTechniciansService) {}

  @Roles('tecnico', 'parceiro')
  @Get('me')
  findMyTenants(@Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.tenantTechnicians.findMyTenants(client, req.user.id, req.user.role),
    );
  }
}
