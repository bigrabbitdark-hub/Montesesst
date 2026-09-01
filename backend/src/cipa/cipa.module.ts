import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { CommitteesController } from './committees.controller';
import { CommitteesService } from './committees.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

@Module({
  imports: [DocumentsModule],
  controllers: [CommitteesController, MeetingsController],
  providers: [CommitteesService, MeetingsService],
})
export class CipaModule {}
