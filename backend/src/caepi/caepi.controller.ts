import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { CaepiService } from './caepi.service';

@Controller('caepi')
export class CaepiController {
  constructor(private readonly caepi: CaepiService) {}

  // Sem @Roles — mesmo padrão já usado em outras rotas GET só-leitura
  // deste projeto (ex. PendenciasController.findAll): qualquer papel
  // autenticado (empresa/tecnico/parceiro/admin) pode consultar, o
  // guard global de JWT já exige autenticação.
  @Get('search')
  search(@Query('q') q: string | undefined) {
    const trimmed = (q ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('Parâmetro de busca "q" é obrigatório');
    }
    return this.caepi.search(trimmed);
  }

  @Get('sync-status')
  syncStatus() {
    return this.caepi.getSyncStatus();
  }
}
