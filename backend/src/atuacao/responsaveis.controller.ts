import { Body, Controller, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditService } from '../common/audit/audit.service';
import { AtuacaoService } from './atuacao.service';
import { SetResponsaveisDto } from './dto/responsaveis.dto';

// Somente admin atribui responsáveis (sócio não aparece em @Roles de propósito).
@Controller('atuacao/admin/clientes')
@Roles('admin')
export class ResponsaveisController {
  constructor(private readonly atuacao: AtuacaoService, private readonly audit: AuditService) {}

  @Put(':tenantId/responsaveis')
  async definir(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: SetResponsaveisDto, @Req() req: any) {
    const out = await req.withTenantContext((c: any) => this.atuacao.definirResponsaveis(c, tenantId, dto.user_ids, req.user.id));
    // Auditoria: só ids e contagem, nunca nomes.
    await this.audit.log({
      actorUserId: req.user.id, actorRole: req.user.role, action: 'client.owners_changed',
      resourceType: 'tenant', resourceId: tenantId, method: req.method, path: req.url, statusCode: 200,
      ipAddress: req.ip, detail: `responsaveis(${dto.user_ids.length}): ${dto.user_ids.join(', ')}`,
    });
    return out;
  }
}
