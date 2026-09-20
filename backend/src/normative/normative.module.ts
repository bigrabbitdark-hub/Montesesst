import { Module } from '@nestjs/common';
import { OfficialSourcesController } from './official-sources.controller';
import { OfficialSourcesService } from './official-sources.service';
import { NormativeDocumentsService } from './normative-documents.service';
import { NormativeDocumentsController } from './normative-documents.controller';
import { NormativeMonitorService } from './normative-monitor.service';
import { NormativeAssistantService } from './normative-assistant.service';
import { NormativeAssistantController } from './normative-assistant.controller';
import { NORMATIVE_ANSWER_PROVIDER } from './normative-answer-provider.interface';
import { OpenRouterNormativeAnswerService } from './openrouter-normative-answer.service';
import { MiniMaxNormativeAnswerService } from './minimax-normative-answer.service';
import { DashboardModule } from '../dashboard/dashboard.module';

// Módulo único da Fase 9 (RAG Normativo) — as Tasks 5, 6 e 7 adicionam
// providers/controllers aqui (monitor, aprovação/indexação, assistente),
// não criam módulos novos.
//
// Provedor ativo hoje: MiniMax (decisão do fundador em 2026-09-05, no
// lugar do OpenRouter). MiniMaxNormativeAnswerService tem o mesmo formato
// OpenAI-compatible já testado (build limpo, suíte e2e mockada sem
// regressão). Em 2026-09-20, `minimax_usage_log` tinha 27 chamadas reais
// de `assistant_normative_query` registradas — o caminho de texto (com
// tool_choice forçado, formato fixo de buildRagChatCompletionBody) já
// rodou contra a API de verdade. O caminho com imagem (image_url em data:
// URI) tem validação NÃO CONFIRMADA: só o fundador pode afirmar o
// contrário. OpenRouterNormativeAnswerService continua registrado, pronto
// pra reverter (mudar só a linha `useClass` abaixo), mesmo padrão do
// AiCopilotModule (Fase 8).
//
// EmbeddingProvider/OpenRouterEmbeddingService não são mais registrados
// aqui — extraídos pra common/embedding (Fase 24) e disponíveis
// globalmente via EmbeddingModule, pra DocumentsModule poder consumir
// EMBEDDING_PROVIDER sem fechar um ciclo (NormativeModule → DashboardModule
// → DocumentsModule já existe).
@Module({
  imports: [DashboardModule],
  controllers: [OfficialSourcesController, NormativeDocumentsController, NormativeAssistantController],
  providers: [
    OfficialSourcesService,
    NormativeDocumentsService,
    NormativeMonitorService,
    NormativeAssistantService,
    OpenRouterNormativeAnswerService,
    MiniMaxNormativeAnswerService,
    { provide: NORMATIVE_ANSWER_PROVIDER, useClass: MiniMaxNormativeAnswerService },
  ],
})
export class NormativeModule {}
