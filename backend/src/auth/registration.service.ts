import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../common/database/database.service';
import { AuditService } from '../common/audit/audit.service';
import { EmailService } from '../common/email/email.service';
import { createHash } from 'crypto';
import { BCRYPT_COST } from '../common/auth/bcrypt-cost';
import { escapeHtml } from '../common/html-escape.util';
import { mapPgError } from '../common/pg-error.util';
import { RedisService } from '../common/redis/redis.service';

export interface RegisterInput {
  companyName: string;
  cnpj: string;
  fullName: string;
  email: string;
  password: string;
  ip?: string;
}

export interface RegisterTechnicianInput {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  registrationNumber?: string;
  specialization?: string;
  ip?: string;
}

// Claim distinto de token de sessão — garante que um token de confirmação
// nunca seja confundido com outro tipo de JWT assinado com o mesmo
// JWT_SECRET.
export const CONFIRMATION_TOKEN_PURPOSE = 'email_confirmation';

// Intervalo mínimo entre dois reenvios PARA O MESMO E-MAIL, valendo de qualquer IP
// (o limite da rota é por IP+e-mail e não impede alguém de encher a caixa de um
// terceiro girando de IP).
const RESEND_COOLDOWN_SECONDS = Number(process.env.RESEND_CONFIRMATION_COOLDOWN_SECONDS) || 300;

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly redis: RedisService,
  ) {}

  async register(input: RegisterInput): Promise<void> {
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

    const { tenantId, userId } = await this.db.withoutTenantContext(async (client) => {
      try {
        const result = await client.query<{ tenant_id: string; user_id: string }>(
          'SELECT * FROM auth_register_tenant_and_user($1, $2, $3, $4, $5)',
          [input.companyName, input.cnpj, input.email, passwordHash, input.fullName],
        );
        return { tenantId: result.rows[0].tenant_id, userId: result.rows[0].user_id };
      } catch (err) {
        mapPgError(err);
      }
    });

    void this.audit.log({
      actorUserId: userId,
      actorRole: 'empresa',
      actorTenantId: tenantId,
      action: 'register',
      resourceType: 'auth',
      resourceId: userId,
      method: 'POST',
      path: '/auth/register',
      statusCode: 201,
      ipAddress: input.ip,
    });

    await this.sendConfirmationEmail(userId, input.email, input.fullName);
  }

  async registerTechnician(input: RegisterTechnicianInput): Promise<void> {
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

    const userId = await this.db.withoutTenantContext(async (client) => {
      try {
        const result = await client.query<{ user_id: string; technician_id: string }>(
          'SELECT * FROM auth_register_technician($1, $2, $3, $4, $5, $6)',
          [
            input.email,
            passwordHash,
            input.fullName,
            input.phone ?? null,
            input.registrationNumber ?? null,
            input.specialization ?? null,
          ],
        );
        return result.rows[0].user_id;
      } catch (err) {
        mapPgError(err);
      }
    });

    void this.audit.log({
      actorUserId: userId,
      actorRole: 'tecnico',
      actorTenantId: null,
      action: 'register_technician',
      resourceType: 'auth',
      resourceId: userId,
      method: 'POST',
      path: '/auth/register-technician',
      statusCode: 201,
      ipAddress: input.ip,
    });

    await this.sendConfirmationEmail(userId, input.email, input.fullName);
  }

  // ITEM 023 (auditoria 2026-09-27): quem perdia o link de 48h ficava sem saída — recadastrar
  // esbarra em 409 (registro pendente já existe). Este reenvio gera um link NOVO para uma conta
  // ainda PENDENTE.
  //
  // Sempre resolve sem revelar nada: a resposta HTTP é a mesma exista a conta ou não, esteja
  // pendente ou não, e o envio não é aguardado (o tempo de resposta também não denuncia).
  // Só envia para status 'pendente' — NUNCA para conta 'inativa': auth_confirm_email reativa
  // qualquer usuário a partir do id (ITEM 042), então reenviar a uma conta desativada por um
  // admin reabriria o acesso.
  async resendConfirmation(rawEmail: string, ip?: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();

    // O intervalo é consumido ANTES de consultar a conta, para que e-mail existente e
    // inexistente passem exatamente pelo mesmo caminho.
    if (!(await this.acquireResendCooldown(email))) return;

    const user = await this.db
      .withoutTenantContext((client) =>
        client.query<{ id: string; tenant_id: string | null; role: string; status: string }>(
          'SELECT * FROM auth_find_user_by_email($1)',
          [email],
        ),
      )
      .then((result) => result.rows[0]);
    if (!user || user.status !== 'pendente') return;

    void this.sendConfirmationEmail(user.id, email).catch((err) =>
      this.logger.warn(`Reenvio da confirmação não enviado: ${(err as Error).message}`),
    );

    void this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      actorTenantId: user.tenant_id,
      action: 'resend_confirmation',
      resourceType: 'auth',
      resourceId: user.id,
      method: 'POST',
      path: '/auth/resend-confirmation',
      statusCode: 200,
      ipAddress: ip,
    });
  }

  // true = pode enviar. A chave usa o hash do e-mail (nenhum dado pessoal no Redis). Se o Redis
  // falhar, deixa passar: o limite por IP+e-mail da rota continua valendo.
  private async acquireResendCooldown(email: string): Promise<boolean> {
    const key = `resend-confirmation:${createHash('sha256').update(email).digest('hex').slice(0, 32)}`;
    try {
      const set = await this.redis.client.set(key, '1', 'EX', RESEND_COOLDOWN_SECONDS, 'NX');
      return set === 'OK';
    } catch (err) {
      this.logger.warn(`Redis indisponível no intervalo de reenvio: ${(err as Error).message}`);
      return true;
    }
  }

  // `fullName` ausente (reenvio: não há por que consultar o nome) → saudação genérica.
  private async sendConfirmationEmail(userId: string, email: string, fullName?: string): Promise<void> {
    const token = this.jwt.sign(
      { sub: userId, purpose: CONFIRMATION_TOKEN_PURPOSE },
      { expiresIn: '48h' },
    );
    const confirmUrl = `${process.env.PUBLIC_APP_URL}/api/auth/confirm?token=${token}`;

    await this.email.send({
      to: email,
      subject: 'Confirme seu cadastro — Montese SST',
      html: `<p>Olá${fullName ? `, ${escapeHtml(fullName)}` : ''}!</p>
<p>Confirme seu cadastro no Montese SST clicando no link abaixo (válido por 48 horas):</p>
<p><a href="${confirmUrl}">Confirmar cadastro</a></p>`,
    });
  }

  async confirm(token: string, ip?: string): Promise<'ok' | 'erro'> {
    let payload: { sub: string; purpose: string };
    try {
      payload = this.jwt.verify(token);
    } catch {
      return 'erro';
    }
    if (payload.purpose !== CONFIRMATION_TOKEN_PURPOSE) return 'erro';

    const result = await this.db.withoutTenantContext((client) =>
      client.query<{ user_id: string; tenant_id: string | null; role: string }>(
        'SELECT * FROM auth_confirm_email($1)',
        [payload.sub],
      ),
    );
    const activated = result.rows[0];
    if (!activated) return 'erro';

    void this.audit.log({
      actorUserId: activated.user_id,
      actorRole: activated.role,
      actorTenantId: activated.tenant_id,
      action: 'email_confirmed',
      resourceType: 'auth',
      resourceId: activated.user_id,
      method: 'GET',
      path: '/auth/confirm',
      statusCode: 200,
      ipAddress: ip,
    });

    return 'ok';
  }
}
