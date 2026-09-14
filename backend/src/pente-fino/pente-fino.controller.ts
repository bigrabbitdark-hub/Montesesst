import { BadRequestException, Body, Controller, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';
import { PenteFinoComparisonService } from './pente-fino-comparison.service';
import { RunPenteFinoDto } from './dto/run-pente-fino.dto';

@Controller('pente-fino')
export class PenteFinoController {
  constructor(private readonly comparison: PenteFinoComparisonService) {}

  @Roles('empresa', 'tecnico', 'parceiro')
  // Teto próprio, bem mais apertado que o limite global de 300/300s: cada
  // chamada pode disparar até 7 chamadas de LLM (PGR + PCMSO de função/risco/
  // exame, até 60s cada, mais até 4 do checklist preliminar de PGR/PCMSO/
  // LTCAT/LIP, Fase 27, mais 1 de agentes do LIP, Fase 28) mais os downloads
  // no R2. Mesmo padrão/convenção de env de POST /documents/classify-batch
  // (Fase 21).
  @RateLimit({
    limit: envInt('PENTE_FINO_RUN_RATE_LIMIT_MAX', 5),
    windowSeconds: envInt('PENTE_FINO_RUN_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('run')
  run(@Body() dto: RunPenteFinoDto, @Req() req: any) {
    const user = req.user;
    // `tenantId` aqui é só o ALVO (qual empresa o técnico/parceiro quer
    // analisar) — vem do corpo, então é controlado por quem chama e NUNCA
    // pode virar contexto de RLS. Por isso o usuário autenticado vai
    // separado: é dele (do JWT) que o service monta o TenantContext.
    const tenantId = user.role === 'tecnico' || user.role === 'parceiro' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');
    return this.comparison.run(tenantId, user);
  }
}
