import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import {
  CreateGoogleEventInput,
  CreateGoogleEventResult,
  GoogleCalendarClient,
  GoogleTokenSet,
} from './google-calendar-client.interface';

// redirect_uri é montado a partir de APP_BASE_URL (também configurável
// via docker-compose, default `https://montesesst.com.br`) — o Google
// exige que bata exatamente com o cadastrado no Cloud Console (ver
// "Pré-requisito externo" no topo do plano de implementação).
const REDIRECT_URI = `${process.env.APP_BASE_URL || 'https://montesesst.com.br'}/api/google-calendar/callback`;

@Injectable()
export class GoogleOAuthCalendarClientService implements GoogleCalendarClient {
  private readonly logger = new Logger(GoogleOAuthCalendarClientService.name);
  private readonly client: OAuth2Client | null;

  // Três estados (decisão do proprietário, 2026-09-30, que relaxa o fail-fast do F-27):
  //  - as DUAS ausentes  -> integração DESATIVADA: o backend sobe normalmente e toda chamada
  //    devolve 503 "integração não configurada" (sinal claro, nunca "invalid_client" opaco).
  //    A integração nunca esteve configurada em produção; derrubar o backend inteiro por ela
  //    causou um incidente no release de 2026-09-30.
  //  - as DUAS presentes -> integração ativa.
  //  - SÓ UMA presente   -> erro de configuração: continua falhando no boot (o caso que o F-27
  //    quis pegar: credencial pela metade, que só apareceria como "invalid_client" do Google).
  constructor() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId && !clientSecret) {
      this.client = null;
      this.logger.warn(
        'GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET ausentes: integração com o Google Calendar DESATIVADA neste ambiente.',
      );
      return;
    }
    if (!clientId || !clientSecret) {
      throw new Error(
        'GoogleOAuthCalendarClientService: configuração incompleta — GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET ' +
          'devem estar ambas definidas ou ambas ausentes (só uma delas causaria "invalid_client" sem contexto).',
      );
    }

    this.client = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  private requireClient(): OAuth2Client {
    if (!this.client) {
      throw new ServiceUnavailableException({
        code: 'GOOGLE_NOT_CONFIGURED',
        message: 'A integração com o Google Calendar não está configurada neste ambiente.',
      });
    }
    return this.client;
  }

  getAuthUrl(state: string): string {
    return this.requireClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      state,
    });
  }

  async exchangeCode(code: string): Promise<GoogleTokenSet> {
    const { tokens } = await this.requireClient().getToken(code);
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
    this.requireClient();
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Falha ao buscar e-mail da conta Google: HTTP ${res.status}`);
    const body = (await res.json()) as { email: string };
    return body.email;
  }

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    // OAuth2Client novo por chamada — nunca reutiliza/muta this.client, que é
    // uma instância única compartilhada entre chamadas concorrentes de
    // técnicos diferentes (setCredentials nele seria uma race condition real:
    // técnico A pode renovar o token de refresh do técnico B se as chamadas
    // se intercalarem).
    //
    // requireClient() garante que as credenciais existem (senão 503); daí o `!`.
    this.requireClient();
    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      REDIRECT_URI,
    );
    client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token || !credentials.expiry_date) {
      throw new Error('Google não devolveu access_token/expiry_date ao renovar');
    }
    return { accessToken: credentials.access_token, expiresAt: new Date(credentials.expiry_date) };
  }

  async insertEvent(accessToken: string, event: CreateGoogleEventInput): Promise<CreateGoogleEventResult> {
    this.requireClient();
    const body: Record<string, unknown> = {
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.startDateTimeIso, timeZone: event.timeZone },
      end: { dateTime: event.endDateTimeIso, timeZone: event.timeZone },
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
