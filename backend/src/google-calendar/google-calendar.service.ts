import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PoolClient } from 'pg';
import { decryptSecret, encryptSecret } from '../common/crypto/secret-crypto.util';
import {
  CreateGoogleEventInput,
  CreateGoogleEventResult,
  GOOGLE_CALENDAR_CLIENT,
  GoogleCalendarClient,
} from './google-calendar-client.interface';

export interface GoogleAccountStatus {
  connected: boolean;
  google_email?: string;
}

export interface CreateEventParams {
  type: 'reuniao' | 'visita';
  summary: string;
  description: string;
  startDateTimeIso: string;
  endDateTimeIso: string;
  location: string | null;
}

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos — só precisa sobreviver ao round-trip do consentimento

@Injectable()
export class GoogleCalendarService {
  constructor(@Inject(GOOGLE_CALENDAR_CLIENT) private readonly google: GoogleCalendarClient) {}

  // state assinado com HMAC-SHA256 reaproveitando JWT_SECRET (já é um
  // segredo real do projeto) — evita precisar de sessão/cookie no
  // redirect de volta do Google, que chega como navegação de browser
  // sem Authorization header.
  private signState(technicianUserId: string): string {
    const expiresAt = Date.now() + STATE_TTL_MS;
    const payload = `${technicianUserId}.${expiresAt}`;
    const signature = createHmac('sha256', process.env.JWT_SECRET || 'dev-secret-change-me')
      .update(payload)
      .digest('hex');
    return Buffer.from(`${payload}.${signature}`).toString('base64url');
  }

  private verifyState(state: string): string {
    const decoded = Buffer.from(state, 'base64url').toString('utf8');
    const [technicianUserId, expiresAtRaw, signature] = decoded.split('.');
    const expiresAt = Number(expiresAtRaw);
    const payload = `${technicianUserId}.${expiresAtRaw}`;
    const expectedSignature = createHmac('sha256', process.env.JWT_SECRET || 'dev-secret-change-me')
      .update(payload)
      .digest('hex');
    const signatureBuffer = Buffer.from(signature ?? '', 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const validSignature =
      signatureBuffer.length === expectedBuffer.length && timingSafeEqual(signatureBuffer, expectedBuffer);
    if (!validSignature || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      throw new BadRequestException('Link de conexão com o Google inválido ou expirado');
    }
    return technicianUserId;
  }

  getAuthUrl(technicianUserId: string): string {
    return this.google.getAuthUrl(this.signState(technicianUserId));
  }

  async handleCallback(client: PoolClient, code: string, state: string): Promise<void> {
    const technicianUserId = this.verifyState(state);
    const tokens = await this.google.exchangeCode(code);
    const googleEmail = await this.google.getUserEmail(tokens.accessToken);
    const encrypted = encryptSecret(tokens.refreshToken);

    await client.query(
      `INSERT INTO technician_google_accounts (technician_user_id, google_email, refresh_token_encrypted)
       VALUES ($1, $2, $3)
       ON CONFLICT (technician_user_id)
       DO UPDATE SET google_email = $2, refresh_token_encrypted = $3, updated_at = now()`,
      [technicianUserId, googleEmail, encrypted],
    );
  }

  async getStatus(client: PoolClient, technicianUserId: string): Promise<GoogleAccountStatus> {
    const result = await client.query<{ google_email: string }>(
      'SELECT google_email FROM technician_google_accounts WHERE technician_user_id = $1',
      [technicianUserId],
    );
    if (result.rowCount === 0) return { connected: false };
    return { connected: true, google_email: result.rows[0].google_email };
  }

  async disconnect(client: PoolClient, technicianUserId: string): Promise<void> {
    const result = await client.query(
      'DELETE FROM technician_google_accounts WHERE technician_user_id = $1',
      [technicianUserId],
    );
    if (result.rowCount === 0) throw new NotFoundException('Nenhuma conta Google conectada');
  }

  // Devolve null (não lança) quando o técnico não tem conta conectada —
  // quem chama (VisitsService.confirm, na Task 3) decide que isso não é
  // um erro, é só "sem evento no Google desta vez".
  async createEvent(
    client: PoolClient,
    technicianUserId: string,
    params: CreateEventParams,
  ): Promise<CreateGoogleEventResult | null> {
    const accountResult = await client.query<{ refresh_token_encrypted: string }>(
      'SELECT refresh_token_encrypted FROM technician_google_accounts WHERE technician_user_id = $1',
      [technicianUserId],
    );
    if (accountResult.rowCount === 0) return null;

    const refreshToken = decryptSecret(accountResult.rows[0].refresh_token_encrypted);
    const { accessToken } = await this.google.refreshAccessToken(refreshToken);

    const input: CreateGoogleEventInput = {
      summary: params.summary,
      description: params.description,
      startDateTimeIso: params.startDateTimeIso,
      endDateTimeIso: params.endDateTimeIso,
      location: params.location,
      createMeetLink: params.type === 'reuniao',
    };
    return this.google.insertEvent(accessToken, input);
  }
}
