import { Controller, Get, Req } from '@nestjs/common';
import { EpiService } from './epi.service';

@Controller('epi-catalog-items')
export class EpiCatalogController {
  constructor(private readonly epi: EpiService) {}

  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.epi.findCatalogItems(client));
  }
}
