import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { PermissoesAdminService } from './permissoes-admin.service';
import { SetPermissoesDto } from './dto/permissoes-admin.dto';

// Somente admin (sócio fora de @Roles de propósito): o sócio nunca altera as próprias permissões.
@Controller('atuacao/admin/permissoes')
@Roles('admin')
export class PermissoesAdminController {
  constructor(private readonly svc: PermissoesAdminService) {}

  @Get()
  listar(@Req() req: any) {
    return req.withTenantContext((c: any) => this.svc.listar(c));
  }

  @Put(':userId')
  definir(@Param('userId', ParseUUIDPipe) userId: string, @Body() dto: SetPermissoesDto, @Req() req: any) {
    // Auditoria dentro da transação do serviço (sem trilha, sem concessão).
    const ctx = { role: req.user.role, method: req.method, path: req.path, ip: req.ip };
    return req.withTenantContext((c: any) => this.svc.definir(c, req.user.id, userId, dto.permissoes, dto.confirmar_sensiveis === true, ctx));
  }
}
