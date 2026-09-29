import { Module } from '@nestjs/common';
import { ReferenceDocumentsController } from './reference-documents.controller';
import { ReferenceDocumentsService } from './reference-documents.service';

// R2Service e EMBEDDING_PROVIDER são globais (R2Module/EmbeddingModule em
// AppModule, ver comentário em normative.module.ts) — não precisam ser
// importados aqui.
@Module({
  controllers: [ReferenceDocumentsController],
  providers: [ReferenceDocumentsService],
})
export class ReferenceDocumentsModule {}
