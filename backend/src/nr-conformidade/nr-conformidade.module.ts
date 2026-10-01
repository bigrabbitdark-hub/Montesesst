import { Module } from '@nestjs/common';
import { NrConformidadeService } from './nr-conformidade.service';

@Module({
  providers: [NrConformidadeService],
  exports: [NrConformidadeService],
})
export class NrConformidadeModule {}
