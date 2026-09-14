import { Module } from '@nestjs/common';
import { PenteFinoController } from './pente-fino.controller';
import { PenteFinoComparisonService } from './pente-fino-comparison.service';
import { PenteFinoExtractorService } from './pente-fino-extractor.service';
import { DocumentChecklistExtractorService } from './document-checklist-extractor.service';
import { FUNCTION_EXTRACTION_PROVIDER } from './function-extraction-provider.interface';
import { MiniMaxFunctionExtractionService } from './minimax-function-extraction.service';
import { DOCUMENT_CHECKLIST_EXTRACTION_PROVIDER } from './document-checklist-provider.interface';
import { MiniMaxDocumentChecklistService } from './minimax-document-checklist.service';

@Module({
  controllers: [PenteFinoController],
  providers: [
    PenteFinoComparisonService,
    PenteFinoExtractorService,
    DocumentChecklistExtractorService,
    MiniMaxFunctionExtractionService,
    { provide: FUNCTION_EXTRACTION_PROVIDER, useClass: MiniMaxFunctionExtractionService },
    MiniMaxDocumentChecklistService,
    { provide: DOCUMENT_CHECKLIST_EXTRACTION_PROVIDER, useClass: MiniMaxDocumentChecklistService },
  ],
})
export class PenteFinoModule {}
