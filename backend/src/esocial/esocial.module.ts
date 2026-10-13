import { Module } from '@nestjs/common';
import { CertificatesModule } from './certificates/certificates.module';
import { AccidentsController } from './accidents/accidents.controller';
import { AccidentsService } from './accidents/accidents.service';
import { EsocialDiagnosticsService } from './diagnostics/esocial-diagnostics.service';
import { EsocialEventsController } from './events/esocial-events.controller';
import { EsocialEventsService } from './events/esocial-events.service';
import { EsocialPrerequisitesController } from './prerequisites/esocial-prerequisites.controller';
import { XmlSignerService } from './signing/xml-signer.service';
import { EsocialSoapClient } from './transport/esocial-soap-client.service';
import { XsdValidatorService } from './xml/xsd-validator.service';

@Module({
  imports: [CertificatesModule],
  controllers: [AccidentsController, EsocialEventsController, EsocialPrerequisitesController],
  providers: [AccidentsService, EsocialDiagnosticsService, EsocialEventsService, XmlSignerService, XsdValidatorService, EsocialSoapClient],
  exports: [CertificatesModule],
})
export class EsocialModule {}
