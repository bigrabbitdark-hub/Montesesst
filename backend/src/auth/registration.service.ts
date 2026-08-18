import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../common/database/database.service';
import { AuditService } from '../common/audit/audit.service';
import { EmailService } from '../common/email/email.service';
import { escapeHtml } from '../common/html-escape.util';
import { mapPgError } from '../common/pg-error.util';

export interface RegisterInput {
  companyName: string;
  cnpj: string;
  fullName: string;
  email: string;
  password: string;
  ip?: string;
}

// Claim distinto de token de sessão — garante que um token de confirmação
// nunca seja confundido com outro tipo de JWT assinado com o mesmo
// JWT_SECRET.
export const CONFIRMATION_TOKEN_PURPOSE = 'email_confirmation';

@Injectable()
export class RegistrationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  async register(input: RegisterInput): Promise<void> {
    const passwordHash = await bcrypt.hash(input.password, 10);

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

    const token = this.jwt.sign(
      { sub: userId, purpose: CONFIRMATION_TOKEN_PURPOSE },
      { expiresIn: '48h' },
    );
    const confirmUrl = `${process.env.PUBLIC_APP_URL}/api/auth/confirm?token=${token}`;

    await this.email.send({
      to: input.email,
      subject: 'Confirme seu cadastro — Montese SST',
      html: `<p>Olá, ${escapeHtml(input.fullName)}!</p>
<p>Confirme seu cadastro no Montese SST clicando no link abaixo (válido por 48 horas):</p>
<p><a href="${confirmUrl}">Confirmar cadastro</a></p>`,
    });
  }

  async confirm(token: string): Promise<'ok' | 'erro'> {
    let payload: { sub: string; purpose: string };
    try {
      payload = this.jwt.verify(token);
    } catch {
      return 'erro';
    }
    if (payload.purpose !== CONFIRMATION_TOKEN_PURPOSE) return 'erro';

    const result = await this.db.withoutTenantContext((client) =>
      client.query<{ user_id: string; tenant_id: string | null }>(
        'SELECT * FROM auth_confirm_email($1)',
        [payload.sub],
      ),
    );
    const activated = result.rows[0];
    if (!activated) return 'erro';

    void this.audit.log({
      actorUserId: activated.user_id,
      actorRole: 'empresa',
      actorTenantId: activated.tenant_id,
      action: 'email_confirmed',
      resourceType: 'auth',
      resourceId: activated.user_id,
      method: 'GET',
      path: '/auth/confirm',
      statusCode: 200,
    });

    return 'ok';
  }
}
