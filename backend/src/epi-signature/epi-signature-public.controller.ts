import { Body, Controller, HttpCode, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { PublicOpenDto } from './dto/public-open.dto';
import { PublicRefuseDto } from './dto/public-refuse.dto';
import { PublicSignDto } from './dto/public-sign.dto';
import { PublicTokenDto } from './dto/public-token.dto';
import { EpiSignaturePublicService } from './epi-signature-public.service';

// Rotas PÚBLICAS do funcionário (celular, sem login). Token e código vão SEMPRE no corpo (POST), nunca na URL.
// Cache-Control: no-store (inclusive nos erros) e o limite de corpo maior são aplicados em app-setup.ts, por caminho.
// Limites por IP e por rota (contador isolado por rota): só protegem recursos (CPU/banco/R2) e toleram mutirão no mesmo
// Wi-Fi/NAT. A defesa contra força bruta do código é o bloqueio persistente do link em 5 tentativas (no banco): 5/1e6 = 5e-6 por link.
@Controller('epi-signatures/public')
@Public()
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class EpiSignaturePublicController {
  constructor(private readonly service: EpiSignaturePublicService) {}

  @RateLimit({ limit: 200, windowSeconds: 600, keyBy: 'ip' })
  @HttpCode(200)
  @Post('peek')
  peek(@Body() dto: PublicTokenDto) {
    return this.service.peek(dto.token);
  }

  @RateLimit({ limit: 120, windowSeconds: 600, keyBy: 'ip' })
  @HttpCode(200)
  @Post('open')
  open(@Body() dto: PublicOpenDto) {
    return this.service.open(dto.token, dto.code);
  }

  @RateLimit({ limit: 120, windowSeconds: 600, keyBy: 'ip' })
  @Post('sign')
  sign(@Body() dto: PublicSignDto, @Req() req: any) {
    return this.service.sign(dto, { ip: String(req.ip ?? 'unknown').slice(0, 64), userAgent: userAgentOf(req) });
  }

  @RateLimit({ limit: 120, windowSeconds: 600, keyBy: 'ip' })
  @HttpCode(200)
  @Post('refuse')
  refuse(@Body() dto: PublicRefuseDto) {
    return this.service.refuse(dto);
  }
}

// User-Agent informado pelo cliente: só evidência. Trunca em 300 e remove caracteres de controle.
function userAgentOf(req: any): string {
  const ua = req.headers?.['user-agent'];
  // eslint-disable-next-line no-control-regex
  return (typeof ua === 'string' ? ua : '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 300);
}
