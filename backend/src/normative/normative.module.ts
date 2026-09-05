import { Module } from '@nestjs/common';
import { OfficialSourcesController } from './official-sources.controller';
import { OfficialSourcesService } from './official-sources.service';
import { NormativeDocumentsService } from './normative-documents.service';
import { NormativeDocumentsController } from './normative-documents.controller';
import { NormativeMonitorService } from './normative-monitor.service';
import { NormativeAssistantService } from './normative-assistant.service';
import { NormativeAssistantController } from './normative-assistant.controller';
import { EMBEDDING_PROVIDER } from './embedding-provider.interface';
import { OpenRouterEmbeddingService } from './openrouter-embedding.service';
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
// regressão) — mas a chamada real de validação (tool_choice forçado +
// image_url em data: URI contra a API de verdade) NUNCA foi possível de
// rodar nesta sessão: o classificador de segurança do ambiente bloqueou
// toda tentativa de chamar a API paga da MiniMax, mesmo por caminhos
// diferentes (script isolado, teste jest dedicado). Ativado mesmo assim
// por decisão explícita do fundador — a validação real fica pendente pra
// quando ele mesmo rodar ou destravar a permissão. OpenRouterNormativeAnswerService
// continua registrado, pronto pra reverter (mudar só a linha `useClass`
// abaixo), mesmo padrão do AiCopilotModule (Fase 8).
@Module({
  imports: [DashboardModule],
  controllers: [OfficialSourcesController, NormativeDocumentsController, NormativeAssistantController],
  providers: [
    OfficialSourcesService,
    NormativeDocumentsService,
    NormativeMonitorService,
    NormativeAssistantService,
    OpenRouterEmbeddingService,
    { provide: EMBEDDING_PROVIDER, useClass: OpenRouterEmbeddingService },
    OpenRouterNormativeAnswerService,
    MiniMaxNormativeAnswerService,
    { provide: NORMATIVE_ANSWER_PROVIDER, useClass: MiniMaxNormativeAnswerService },
  ],
})
export class NormativeModule {}
