import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { CommitteesController } from './committees.controller';
import { CommitteesService } from './committees.service';
import { ElectionsController } from './elections.controller';
import { ElectionsService } from './elections.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { PendenciasController } from './pendencias.controller';
import { PendenciasService } from './pendencias.service';
import { AtaAiService } from './ata-ai/ata-ai.service';
import { AUDIO_TRANSCRIPTION_SERVICE } from './ata-ai/audio-transcription.interface';
import { GroqTranscriptionService } from './ata-ai/groq-transcription.service';
import { ATA_EXTRACTOR } from './ata-ai/ata-extractor.interface';
import { OpenRouterAtaExtractorService } from './ata-ai/openrouter-ata-extractor.service';
import { TrainingsController } from './trainings.controller';
import { TrainingsService } from './trainings.service';

@Module({
  imports: [DocumentsModule],
  controllers: [CommitteesController, MeetingsController, MembersController, PendenciasController, ElectionsController, TrainingsController],
  providers: [
    CommitteesService,
    MeetingsService,
    MembersService,
    PendenciasService,
    ElectionsService,
    TrainingsService,
    AtaAiService,
    GroqTranscriptionService,
    { provide: AUDIO_TRANSCRIPTION_SERVICE, useClass: GroqTranscriptionService },
    OpenRouterAtaExtractorService,
    { provide: ATA_EXTRACTOR, useClass: OpenRouterAtaExtractorService },
  ],
  exports: [AUDIO_TRANSCRIPTION_SERVICE, ATA_EXTRACTOR],
})
export class CipaModule {}
