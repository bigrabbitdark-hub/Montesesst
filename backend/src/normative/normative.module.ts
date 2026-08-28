import { Module } from '@nestjs/common';
import { OfficialSourcesController } from './official-sources.controller';
import { OfficialSourcesService } from './official-sources.service';

// Módulo único da Fase 9 (RAG Normativo) — as Tasks 5, 6 e 7 adicionam
// providers/controllers aqui (monitor, aprovação/indexação, assistente),
// não criam módulos novos.
@Module({
  controllers: [OfficialSourcesController],
  providers: [OfficialSourcesService],
})
export class NormativeModule {}
