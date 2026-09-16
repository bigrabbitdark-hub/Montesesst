import { Module } from '@nestjs/common';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';
import { TechnicianAgendaService } from './technician-agenda.service';
import { VisitReminderCronService } from './visit-reminder.cron';
import { DashboardModule } from '../dashboard/dashboard.module';
import { TenantTechniciansModule } from '../tenant-technicians/tenant-technicians.module';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';

@Module({
  imports: [DashboardModule, TenantTechniciansModule, GoogleCalendarModule],
  controllers: [VisitsController],
  providers: [VisitsService, TechnicianAgendaService, VisitReminderCronService],
})
export class VisitsModule {}
