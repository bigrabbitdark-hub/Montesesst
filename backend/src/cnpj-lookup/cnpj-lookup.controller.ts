import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';
import { CnpjLookupService } from './cnpj-lookup.service';

// Pública porque o /cadastro é anterior ao login. Os dados são cadastrais e
// públicos (Receita Federal); o risco é uso como proxy aberto, por isso o
// limite por IP. Não acessa o banco, então não há dado de tenant em jogo.
@Controller('cnpj-lookup')
export class CnpjLookupController {
  constructor(private readonly service: CnpjLookupService) {}

  @Public()
  @RateLimit({
    limit: envInt('CNPJ_LOOKUP_RATE_LIMIT_MAX', 20),
    windowSeconds: envInt('CNPJ_LOOKUP_RATE_LIMIT_WINDOW_SECONDS', 600),
    keyBy: 'ip',
  })
  @Get(':cnpj')
  lookup(@Param('cnpj') cnpj: string) {
    return this.service.lookup(cnpj);
  }
}
