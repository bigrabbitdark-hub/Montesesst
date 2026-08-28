import { Module } from '@nestjs/common';
import { FIELD_REPORT_EXTRACTOR } from './field-report-extractor.interface';
import { MiniMaxExtractorService } from './minimax-extractor.service';
import { OpenRouterExtractorService } from './openrouter-extractor.service';
import { AiCopilotController } from './ai-copilot.controller';

// Provedor ativo hoje: OpenRouter (o fundador escolhe o modelo por trás
// via OPENROUTER_MODEL, sem precisar trocar código). MiniMaxExtractorService
// continua pronto e testado, só não é o binding ativo — trocar de volta é
// mudar só a linha `useClass` abaixo.
@Module({
  controllers: [AiCopilotController],
  providers: [
    MiniMaxExtractorService,
    OpenRouterExtractorService,
    { provide: FIELD_REPORT_EXTRACTOR, useClass: OpenRouterExtractorService },
  ],
  exports: [FIELD_REPORT_EXTRACTOR],
})
export class AiCopilotModule {}
