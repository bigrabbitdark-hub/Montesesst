import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { CommitteesController } from './committees.controller';
import { CommitteesService } from './committees.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  imports: [DocumentsModule],
  controllers: [CommitteesController, MeetingsController, MembersController],
  providers: [CommitteesService, MeetingsService, MembersService],
})
export class CipaModule {}
