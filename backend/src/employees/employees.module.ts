import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { EmployeeIngestionService } from './employee-ingestion.service';
import { EMPLOYEE_EXTRACTION_PROVIDER } from './employee-extraction-provider.interface';
import { MiniMaxEmployeeExtractionService } from './minimax-employee-extraction.service';
import { EmployeeExtractionExpiryCronService } from './employee-extraction-expiry.cron';
import { PaymentsModule } from '../payments/payments.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [PaymentsModule, DocumentsModule],
  controllers: [EmployeesController],
  providers: [
    EmployeesService,
    EmployeeIngestionService,
    EmployeeExtractionExpiryCronService,
    { provide: EMPLOYEE_EXTRACTION_PROVIDER, useClass: MiniMaxEmployeeExtractionService },
  ],
})
export class EmployeesModule {}
