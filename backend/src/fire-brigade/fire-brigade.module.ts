import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { FireBrigadeController } from './fire-brigade.controller';
import { FireBrigadeService } from './fire-brigade.service';

@Module({
  imports: [DocumentsModule],
  controllers: [FireBrigadeController],
  providers: [FireBrigadeService],
  exports: [FireBrigadeService],
})
export class FireBrigadeModule {}
