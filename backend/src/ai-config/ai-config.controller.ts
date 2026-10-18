import { BadRequestException, Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { AiConfigService } from './ai-config.service';
import { UpdateAiConfigDto } from './dto/ai-config.dto';
import { AiProviderAdminView, AiProviderId } from './ai-config.types';

// /admin/ai-config — painel de configuração dos provedores de IA.
// Só admin. AuditInterceptor (global) já loga cada PUT/POST com actor_user_id,
// path, status_code, ip. O detail do audit_log é "ai_config update provider=X"
// (montado manualmente no service via AuditInterceptor) — NUNCA traz a chave.
@Controller('admin/ai-config')
export class AiConfigController {
  constructor(private readonly config: AiConfigService) {}

  // Lista os 3 provedores com chave mascarada — alimenta o painel /admin/ia.
  // NUNCA devolve apiKey em claro; só `apiKeyMasked` (formato "sk-…XYZW" ou
  // null se nem banco nem env têm config).
  @Roles('admin')
  @Get()
  async list(): Promise<AiProviderAdminView[]> {
    return this.config.listForAdmin();
  }

  @Roles('admin')
  @Put(':provider')
  async upsert(
    @Param('provider') provider: string,
    @Body() dto: UpdateAiConfigDto,
    @Req() req: any,
  ): Promise<{ ok: true; provider: string; model: string }> {
    const allowed = ['minimax', 'openrouter', 'groq'];
    if (!allowed.includes(provider)) {
      throw new BadRequestException(`provider deve ser um de: ${allowed.join(', ')}`);
    }
    const adminUserId = req?.user?.id;
    if (!adminUserId) {
      // Defesa em profundidade: o RolesGuard/JwtAuthGuard já garantem isso,
      // mas um req.user populado sem id é sintoma de bug no auth — não grava.
      throw new BadRequestException('Usuário admin sem id no token.');
    }
    await this.config.upsert(provider as AiProviderId, dto.apiKey, dto.model, adminUserId);
    return { ok: true, provider, model: dto.model };
  }

  @Roles('admin')
  @Post(':provider/test')
  async test(@Param('provider') provider: string): Promise<{ ok: boolean; detail: string; model: string }> {
    const allowed = ['minimax', 'openrouter', 'groq'];
    if (!allowed.includes(provider)) {
      throw new BadRequestException(`provider deve ser um de: ${allowed.join(', ')}`);
    }
    return this.config.testConnection(provider as AiProviderId);
  }
}
