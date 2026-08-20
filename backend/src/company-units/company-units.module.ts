import { Module } from '@nestjs/common';
import { CompanyUnitsController } from './company-units.controller';
import { CompanyUnitsService } from './company-units.service';

@Module({
  controllers: [CompanyUnitsController],
  providers: [CompanyUnitsService],
})
export class CompanyUnitsModule {}
