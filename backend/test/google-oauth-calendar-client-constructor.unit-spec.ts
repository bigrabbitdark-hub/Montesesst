/**
 * Cobre o fail-fast do constructor de GoogleOAuthCalendarClientService
 * introduzido no PR de hardening pré-prod (§F-27 do audit). Antes do
 * fix, ambas as vars eram opcionais (com fallback `'missing-google-
 * client-id'`) — em prod, sem GOOGLE_CLIENT_ID/SECRET no `.env`, o
 * OAuth2Client era instanciado com placeholder e a falha só aparecia
 * na primeira tentativa real de "Conectar Google", como "invalid_client"
 * opaco do Google.
 *
 * Estes testes rodam SEM infra externa (sem Postgres/Redis), em
 * jest-unit.json — só dependem do `process.env` para validar o
 * caminho do throw e o caminho feliz.
 */

import { GoogleOAuthCalendarClientService } from '../src/google-calendar/google-oauth-calendar-client.service';

describe('GoogleOAuthCalendarClientService — constructor fail-fast (F-27)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('lança erro explícito quando GOOGLE_CLIENT_ID está ausente', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    process.env.GOOGLE_CLIENT_SECRET = 'secret-qualquer-32-bytes-aaaaaaaaaaaa';

    expect(() => new GoogleOAuthCalendarClientService()).toThrow(
      /GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET/,
    );
  });

  it('lança erro explícito quando GOOGLE_CLIENT_SECRET está ausente', () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id-qualquer';
    delete process.env.GOOGLE_CLIENT_SECRET;

    expect(() => new GoogleOAuthCalendarClientService()).toThrow(
      /GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET/,
    );
  });

  it('lança erro explícito quando AMBAS estão ausentes', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    expect(() => new GoogleOAuthCalendarClientService()).toThrow(
      /GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET/,
    );
  });

  it('instancia normalmente quando ambas estão presentes', () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id-real-fornecido-pelo-cloud-console';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret-real-fornecido-pelo-cloud-console';

    expect(() => new GoogleOAuthCalendarClientService()).not.toThrow();
  });
});
