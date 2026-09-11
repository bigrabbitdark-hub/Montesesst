import { Module } from '@nestjs/common';
import { PenteFinoController } from './pente-fino.controller';
import { PenteFinoComparisonService } from './pente-fino-comparison.service';
import { PenteFinoExtractorService } from './pente-fino-extractor.service';
import { FUNCTION_EXTRACTION_PROVIDER } from './function-extraction-provider.interface';
import { MiniMaxFunctionExtractionService } from './minimax-function-extraction.service';

@Module({
  controllers: [PenteFinoController],
  providers: [
    PenteFinoComparisonService,
    PenteFinoExtractorService,
    MiniMaxFunctionExtractionService,
    { provide: FUNCTION_EXTRACTION_PROVIDER, useClass: MiniMaxFunctionExtractionService },
  ],
})
export class PenteFinoModule {}
