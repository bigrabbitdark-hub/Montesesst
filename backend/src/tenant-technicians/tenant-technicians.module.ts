import { Module } from '@nestjs/common';
import { TenantTechniciansController } from './tenant-technicians.controller';
import { TenantTechniciansService } from './tenant-technicians.service';

@Module({
  controllers: [TenantTechniciansController],
  providers: [TenantTechniciansService],
})
export class TenantTechniciansModule {}
