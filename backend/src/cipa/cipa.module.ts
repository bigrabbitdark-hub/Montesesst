import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { CommitteesController } from './committees.controller';
import { CommitteesService } from './committees.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { PendenciasController } from './pendencias.controller';
import { PendenciasService } from './pendencias.service';

@Module({
  imports: [DocumentsModule],
  controllers: [CommitteesController, MeetingsController, MembersController, PendenciasController],
  providers: [CommitteesService, MeetingsService, MembersService, PendenciasService],
})
export class CipaModule {}
