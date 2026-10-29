import { Controller, Get, Query, Req } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditService } from '../../common/audit/audit.service';
import { PainelService } from './painel.service';
import { ListVencimentosQuery } from './dto/painel.dto';

// Dashboard do sócio (somente leitura). O PermissionsGuard exige TODAS as permissões listadas na rota;
// por isso /painel exige só clients.read e o serviço decide, bloco a bloco, o que o sócio pode ver.
@Controller('atuacao')
@Roles('socio')
export class PainelController {
  constructor(private readonly painel: PainelService, private readonly audit: AuditService) {}

  @RequirePermission('clients.read')
  @Get('painel')
  resumo(@Req() req: any) {
    return req.withTenantContext((c: any) => this.painel.painel(c, req.user.id));
  }

  // Lista de documentos com título de TODA a carteira: segue o padrão de /atuacao/empresas/:id/vencimentos
  // e audita a leitura (só o nome do módulo e, se houver, o tenant; nunca títulos nem datas).
  @RequirePermission('empresas.read', 'clients.read')
  @Get('vencimentos')
  async vencimentos(@Query() q: ListVencimentosQuery, @Req() req: any) {
    const out = await req.withTenantContext((c: any) => this.painel.vencimentos(c, q));
    await this.audit.log({
      actorUserId: req.user.id, actorRole: req.user.role, action: 'company.accessed', resourceType: 'tenant',
      resourceId: q.tenantId ?? null, method: req.method, path: req.path, statusCode: 200, ipAddress: req.ip,
      detail: 'modulo: vencimentos-carteira',
    });
    return out;
  }
}
