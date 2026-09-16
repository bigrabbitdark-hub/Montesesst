import { Module } from '@nestjs/common';
import { GoogleCalendarController } from './google-calendar.controller';
import { GoogleCalendarService } from './google-calendar.service';
import { GoogleOAuthCalendarClientService } from './google-oauth-calendar-client.service';
import { GOOGLE_CALENDAR_CLIENT } from './google-calendar-client.interface';

@Module({
  controllers: [GoogleCalendarController],
  providers: [
    GoogleCalendarService,
    GoogleOAuthCalendarClientService,
    { provide: GOOGLE_CALENDAR_CLIENT, useClass: GoogleOAuthCalendarClientService },
  ],
  exports: [GoogleCalendarService],
})
export class GoogleCalendarModule {}
