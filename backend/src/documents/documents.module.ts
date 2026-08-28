import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { R2Service } from './r2.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, R2Service],
  exports: [DocumentsService],
})
export class DocumentsModule {}
