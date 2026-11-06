import { Controller, Get, Req } from '@nestjs/common';
import { EpiService } from './epi.service';
import { ActingAllowed } from '../common/decorators/acting-allowed.decorator';

@Controller('epi-catalog-items')
@ActingAllowed()
export class EpiCatalogController {
  constructor(private readonly epi: EpiService) {}

  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.epi.findCatalogItems(client));
  }
}
