import { Global, Module } from '@nestjs/common';
import { EMBEDDING_PROVIDER } from './embedding-provider.interface';
import { OpenRouterEmbeddingService } from './openrouter-embedding.service';

// Global (registrado em AppModule) — usado por normative e documents,
// mesmo padrão de R2Module (common/r2/r2.module.ts, Fase 20). Existe
// pra evitar dependência circular: NormativeModule importa
// DashboardModule, que importa DocumentsModule — se DocumentsModule
// importasse NormativeModule pra reaproveitar o embedding, fecharia um
// ciclo.
@Global()
@Module({
  providers: [OpenRouterEmbeddingService, { provide: EMBEDDING_PROVIDER, useClass: OpenRouterEmbeddingService }],
  exports: [EMBEDDING_PROVIDER],
})
export class EmbeddingModule {}
