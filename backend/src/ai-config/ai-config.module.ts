import { Module } from '@nestjs/common';
import { DatabaseModule } from '../common/database/database.module';
import { AiConfigController } from './ai-config.controller';
import { AiConfigService } from './ai-config.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AiConfigController],
  providers: [AiConfigService],
  // Exportado pra AiCopilotModule, CipaModule, NormativeModule consumirem
  // o service via injeção (sem precisar importar o módulo).
  exports: [AiConfigService],
})
export class AiConfigModule {}
