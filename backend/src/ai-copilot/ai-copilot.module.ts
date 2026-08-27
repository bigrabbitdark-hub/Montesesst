import { Module } from '@nestjs/common';
import { FIELD_REPORT_EXTRACTOR } from './field-report-extractor.interface';
import { MiniMaxExtractorService } from './minimax-extractor.service';

@Module({
  providers: [{ provide: FIELD_REPORT_EXTRACTOR, useClass: MiniMaxExtractorService }],
  exports: [FIELD_REPORT_EXTRACTOR],
})
export class AiCopilotModule {}
