import { Module } from '@nestjs/common';
import { R2Module } from '../../common/r2/r2.module';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';
import { CertificateCryptoService } from './certificate-crypto.service';

@Module({
  imports: [R2Module],
  controllers: [CertificatesController],
  providers: [CertificatesService, CertificateCryptoService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
