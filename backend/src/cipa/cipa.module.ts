import { Module } from '@nestjs/common';
import { CommitteesController } from './committees.controller';
import { CommitteesService } from './committees.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

@Module({
  controllers: [CommitteesController, MeetingsController],
  providers: [CommitteesService, MeetingsService],
})
export class CipaModule {}
