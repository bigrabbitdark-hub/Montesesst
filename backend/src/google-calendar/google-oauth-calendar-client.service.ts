import { Injectable } from '@nestjs/common';
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
  private readonly client: OAuth2Client;

  constructor() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    // Falha explícita no boot se as credenciais OAuth do Google estiverem
    // ausentes — antes deste fix o fallback `'missing-google-client-id'`
    // mascarava a configuração incorreta: o `OAuth2Client` era instanciado
    // com string-placeholder e a falha só aparecia na primeira chamada
    // real ("invalid_client" do Google, sem contexto do motivo).
    //
    // Diferente de R2Service/EmailService (que usam fallback-em-dev com a
    // mesma filosofia), este service NÃO pode tolerar placeholder: o erro
    // do Google é opaco ("invalid_client") e não distingue "chave errada"
    // de "chave ausente", então a única forma do operador receber um sinal
    // útil é falhar na inicialização, antes que qualquer usuário tente
    // "Conectar Google". Já existe `validateProductionEnv()` para os
    // segredos sensíveis (F-21); este check complementa como rede-de-seg
    // redundante, mas é a única proteção para as credenciais OAuth (que
    // NÃO estão em `env.validator.ts` por decisão de projeto — ver §F-27
    // do audit).
    //
    // Testes e2e do google-calendar setam process.env.GOOGLE_CLIENT_ID/
    // SECRET no beforeAll (mesmo padrão já usado para GOOGLE_TOKEN_
    // ENCRYPTION_KEY linhas 25 e 33 dos specs) — sem isso o provider
    // registrado em google-calendar.module.ts:11 é instanciado pelo
    // NestJS antes do .overrideProvider(GOOGLE_CALENDAR_CLIENT) ter
    // efeito.
    if (!clientId || !clientSecret) {
      throw new Error(
        'GoogleOAuthCalendarClientService: faltam GOOGLE_CLIENT_ID e/ou ' +
          'GOOGLE_CLIENT_SECRET no ambiente. Sem elas, o OAuth2Client seria ' +
          'instanciado com placeholder e a primeira tentativa real de ' +
          '"Conectar Google" retornaria "invalid_client" sem contexto.',
      );
    }

    this.client = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);
  }

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
    // OAuth2Client novo por chamada — nunca reutiliza/muta this.client, que é
    // uma instância única compartilhada entre chamadas concorrentes de
    // técnicos diferentes (setCredentials nele seria uma race condition real:
    // técnico A pode renovar o token de refresh do técnico B se as chamadas
    // se intercalarem).
    //
    // `!` aqui é seguro porque o constructor já validou GOOGLE_CLIENT_ID e
    // GOOGLE_CLIENT_SECRET — se estivessem ausentes o NestJS já teria
    // abortado a inicialização do módulo com a mensagem explícita de cima.
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
