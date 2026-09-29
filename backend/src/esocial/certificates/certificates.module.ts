import { Module } from '@nestjs/common';
import { R2Module } from '../../common/r2/r2.module';
import { CertificatesService } from './certificates.service';
import { CertificateCryptoService } from './certificate-crypto.service';

@Module({
  imports: [R2Module],
  providers: [CertificatesService, CertificateCryptoService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
