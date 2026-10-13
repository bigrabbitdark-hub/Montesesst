import { Module } from '@nestjs/common';
import { CnpjLookupController } from './cnpj-lookup.controller';
import { CnpjLookupService } from './cnpj-lookup.service';

@Module({
  controllers: [CnpjLookupController],
  providers: [CnpjLookupService],
})
export class CnpjLookupModule {}
