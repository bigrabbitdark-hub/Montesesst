import { Module } from '@nestjs/common';
import { CertificatesModule } from './certificates/certificates.module';

@Module({
  imports: [CertificatesModule],
  exports: [CertificatesModule],
})
export class EsocialModule {}
