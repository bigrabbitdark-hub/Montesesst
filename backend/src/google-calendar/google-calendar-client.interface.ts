export interface GoogleTokenSet {
  refreshToken: string;
  accessToken: string;
  expiresAt: Date;
}

export interface CreateGoogleEventInput {
  summary: string;
  description: string;
  startDateTimeIso: string;
  endDateTimeIso: string;
  location: string | null;
  createMeetLink: boolean;
}

export interface CreateGoogleEventResult {
  eventId: string;
  meetLink: string | null;
}

export interface GoogleCalendarClient {
  getAuthUrl(state: string): string;
  exchangeCode(code: string): Promise<GoogleTokenSet>;
  getUserEmail(accessToken: string): Promise<string>;
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }>;
  insertEvent(accessToken: string, event: CreateGoogleEventInput): Promise<CreateGoogleEventResult>;
}

export const GOOGLE_CALENDAR_CLIENT = Symbol('GOOGLE_CALENDAR_CLIENT');
