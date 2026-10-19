import { Module } from '@nestjs/common';
import { EpiSignatureController } from './epi-signature.controller';
import { EpiSignaturePublicController } from './epi-signature-public.controller';
import { EpiSignaturePublicService } from './epi-signature-public.service';
import { EpiSignatureService } from './epi-signature.service';

@Module({
  controllers: [EpiSignatureController, EpiSignaturePublicController],
  providers: [EpiSignatureService, EpiSignaturePublicService],
  exports: [EpiSignatureService],
})
export class EpiSignatureModule {}
