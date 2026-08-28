import { Module } from '@nestjs/common';
import { OfficialSourcesController } from './official-sources.controller';
import { OfficialSourcesService } from './official-sources.service';
import { NormativeDocumentsService } from './normative-documents.service';
import { NormativeDocumentsController } from './normative-documents.controller';
import { NormativeMonitorService } from './normative-monitor.service';
import { R2Service } from '../documents/r2.service';
import { EMBEDDING_PROVIDER } from './embedding-provider.interface';
import { OpenRouterEmbeddingService } from './openrouter-embedding.service';

// Módulo único da Fase 9 (RAG Normativo) — as Tasks 5, 6 e 7 adicionam
// providers/controllers aqui (monitor, aprovação/indexação, assistente),
// não criam módulos novos.
@Module({
  controllers: [OfficialSourcesController, NormativeDocumentsController],
  providers: [
    OfficialSourcesService,
    NormativeDocumentsService,
    NormativeMonitorService,
    R2Service,
    OpenRouterEmbeddingService,
    { provide: EMBEDDING_PROVIDER, useClass: OpenRouterEmbeddingService },
  ],
})
export class NormativeModule {}
