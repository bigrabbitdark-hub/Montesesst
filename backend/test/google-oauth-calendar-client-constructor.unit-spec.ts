/**
 * Comportamento do construtor de GoogleOAuthCalendarClientService quanto às credenciais OAuth.
 *
 * Histórico: o F-27 (hardening pré-prod) fazia o backend FALHAR NO BOOT sem GOOGLE_CLIENT_ID/SECRET,
 * para evitar o "invalid_client" opaco. Em 2026-09-30, no release do backend, isso derrubou o
 * backend inteiro porque a integração nunca foi configurada em produção (decisão do proprietário:
 * integração opcional). Agora:
 *  - as DUAS ausentes  -> integração desativada (não lança); chamadas dão 503 com código explícito;
 *  - as DUAS presentes -> ativa;
 *  - SÓ UMA presente   -> continua lançando no boot (credencial pela metade é erro de configuração).
 *
 * Roda SEM infra externa (jest-unit.json).
 */

import { ServiceUnavailableException } from '@nestjs/common';
import { GoogleOAuthCalendarClientService } from '../src/google-calendar/google-oauth-calendar-client.service';

describe('GoogleOAuthCalendarClientService — credenciais OAuth (F-27 relaxado)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('as duas ausentes: integração desativada, sem derrubar o backend', () => {
    beforeEach(() => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
    });

    it('não lança no construtor e se declara não configurada', () => {
      const service = new GoogleOAuthCalendarClientService();
      expect(service.isConfigured()).toBe(false);
    });

    it('tratam string vazia como ausente (variável presente mas em branco no compose)', () => {
      process.env.GOOGLE_CLIENT_ID = '';
      process.env.GOOGLE_CLIENT_SECRET = '';
      expect(new GoogleOAuthCalendarClientService().isConfigured()).toBe(false);
    });

    it('getAuthUrl lança 503 com código GOOGLE_NOT_CONFIGURED (nunca "invalid_client" opaco)', () => {
      const service = new GoogleOAuthCalendarClientService();
      let erro: unknown;
      try {
        service.getAuthUrl('state');
      } catch (e) {
        erro = e;
      }
      expect(erro).toBeInstanceOf(ServiceUnavailableException);
      expect((erro as ServiceUnavailableException).getResponse()).toMatchObject({ code: 'GOOGLE_NOT_CONFIGURED' });
    });

    it.each([
      ['exchangeCode', (s: GoogleOAuthCalendarClientService) => s.exchangeCode('code')],
      ['getUserEmail', (s: GoogleOAuthCalendarClientService) => s.getUserEmail('token')],
      ['refreshAccessToken', (s: GoogleOAuthCalendarClientService) => s.refreshAccessToken('refresh')],
      [
        'insertEvent',
        (s: GoogleOAuthCalendarClientService) =>
          s.insertEvent('token', {
            summary: 's',
            description: 'd',
            startDateTimeIso: '2026-10-01T10:00:00-03:00',
            endDateTimeIso: '2026-10-01T11:00:00-03:00',
            timeZone: 'America/Sao_Paulo',
            location: null,
            createMeetLink: false,
          }),
      ],
    ])('%s rejeita com 503 GOOGLE_NOT_CONFIGURED e não chama a rede', async (_nome, chamar) => {
      const fetchSpy = jest.spyOn(global, 'fetch');
      const service = new GoogleOAuthCalendarClientService();
      await expect(chamar(service)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe('só uma presente: erro de configuração, continua falhando no boot', () => {
    it('GOOGLE_CLIENT_ID presente e SECRET ausente', () => {
      process.env.GOOGLE_CLIENT_ID = 'client-id-qualquer';
      delete process.env.GOOGLE_CLIENT_SECRET;
      expect(() => new GoogleOAuthCalendarClientService()).toThrow(/configuração incompleta.*GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET/);
    });

    it('GOOGLE_CLIENT_SECRET presente e ID ausente', () => {
      delete process.env.GOOGLE_CLIENT_ID;
      process.env.GOOGLE_CLIENT_SECRET = 'secret-qualquer-32-bytes-aaaaaaaaaaaa';
      expect(() => new GoogleOAuthCalendarClientService()).toThrow(/configuração incompleta/);
    });

    it('uma delas vazia e a outra preenchida também é configuração incompleta', () => {
      process.env.GOOGLE_CLIENT_ID = 'client-id-qualquer';
      process.env.GOOGLE_CLIENT_SECRET = '';
      expect(() => new GoogleOAuthCalendarClientService()).toThrow(/configuração incompleta/);
    });
  });

  describe('as duas presentes: integração ativa', () => {
    it('instancia, declara-se configurada e gera a URL de consentimento com o escopo de eventos', () => {
      process.env.GOOGLE_CLIENT_ID = 'client-id-de-teste';
      process.env.GOOGLE_CLIENT_SECRET = 'client-secret-de-teste';
      const service = new GoogleOAuthCalendarClientService();
      expect(service.isConfigured()).toBe(true);
      const url = service.getAuthUrl('meu-state');
      expect(url).toContain('accounts.google.com');
      expect(url).toContain('client_id=client-id-de-teste');
      expect(url).toContain('calendar.events');
      expect(url).toContain('state=meu-state');
    });
  });
});
