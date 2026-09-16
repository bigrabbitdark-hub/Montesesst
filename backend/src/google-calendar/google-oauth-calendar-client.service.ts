import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import {
  CreateGoogleEventInput,
  CreateGoogleEventResult,
  GoogleCalendarClient,
  GoogleTokenSet,
} from './google-calendar-client.interface';

// Mesmo padrão de fallback-em-dev já usado em R2Service/EmailService —
// ausência de credencial não derruba o boot, só falha na primeira
// chamada real. redirect_uri é fixo (não hardcoded por ambiente): o
// Google exige que bata exatamente com o cadastrado no Cloud Console
// (ver "Pré-requisito externo" no topo do plano de implementação).
const REDIRECT_URI = `${process.env.APP_BASE_URL || 'https://montesesst.com.br'}/api/google-calendar/callback`;

@Injectable()
export class GoogleOAuthCalendarClientService implements GoogleCalendarClient {
  private readonly client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID || 'missing-google-client-id',
    process.env.GOOGLE_CLIENT_SECRET || 'missing-google-client-secret',
    REDIRECT_URI,
  );

  getAuthUrl(state: string): string {
    return this.client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      state,
    });
  }

  async exchangeCode(code: string): Promise<GoogleTokenSet> {
    const { tokens } = await this.client.getToken(code);
    if (!tokens.refresh_token || !tokens.access_token || !tokens.expiry_date) {
      throw new Error('Google não devolveu refresh_token/access_token/expiry_date');
    }
    return {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresAt: new Date(tokens.expiry_date),
    };
  }

  async getUserEmail(accessToken: string): Promise<string> {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Falha ao buscar e-mail da conta Google: HTTP ${res.status}`);
    const body = (await res.json()) as { email: string };
    return body.email;
  }

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    this.client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await this.client.refreshAccessToken();
    if (!credentials.access_token || !credentials.expiry_date) {
      throw new Error('Google não devolveu access_token/expiry_date ao renovar');
    }
    return { accessToken: credentials.access_token, expiresAt: new Date(credentials.expiry_date) };
  }

  async insertEvent(accessToken: string, event: CreateGoogleEventInput): Promise<CreateGoogleEventResult> {
    const body: Record<string, unknown> = {
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.startDateTimeIso },
      end: { dateTime: event.endDateTimeIso },
    };
    if (event.location) body.location = event.location;
    if (event.createMeetLink) {
      body.conferenceData = {
        createRequest: { requestId: `montese-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
      };
    }

    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    if (event.createMeetLink) url.searchParams.set('conferenceDataVersion', '1');

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Falha ao criar evento no Google Calendar: HTTP ${res.status}`);
    const created = (await res.json()) as {
      id: string;
      conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] };
    };
    const meetEntry = created.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
    return { eventId: created.id, meetLink: meetEntry?.uri ?? null };
  }
}
