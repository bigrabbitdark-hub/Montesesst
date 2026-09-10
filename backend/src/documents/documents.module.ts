import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DOCUMENT_CLASSIFIER_PROVIDER } from './document-classifier-provider.interface';
import { MiniMaxDocumentClassifierService } from './minimax-document-classifier.service';
import { CompanyDocumentIndexerService } from './company-document-indexer.service';

@Module({
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    CompanyDocumentIndexerService,
    MiniMaxDocumentClassifierService,
    { provide: DOCUMENT_CLASSIFIER_PROVIDER, useClass: MiniMaxDocumentClassifierService },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
