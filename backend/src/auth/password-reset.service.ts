import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHmac, timingSafeEqual } from 'crypto';
import { DatabaseService } from '../common/database/database.service';
import { AuditService } from '../common/audit/audit.service';
import { EmailService } from '../common/email/email.service';
import { BCRYPT_COST } from '../common/auth/bcrypt-cost';

// Claim distinto de sessão e de confirmação de cadastro. A JwtStrategy recusa
// qualquer token com `purpose` como sessão, e reset() recusa qualquer token cujo
// purpose não seja este.
export const PASSWORD_RESET_TOKEN_PURPOSE = 'password_reset';
const RESET_TOKEN_TTL = '1h';

const INVALID_LINK_MESSAGE = 'Link inválido ou expirado. Solicite uma nova redefinição de senha.';

interface AuthUserRow {
  id: string;
  tenant_id: string | null;
  role: string;
  password_hash: string;
  status: string;
}

interface ResetTokenPayload {
  sub: string;
  email: string;
  purpose: string;
  pwf: string;
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  // Impressão digital do hash de senha vigente, dentro do token. Faz o token
  // morrer sozinho quando a senha muda por QUALQUER caminho (o próprio reset,
  // troca administrativa). É HMAC com o segredo do JWT (não um SHA-256 puro) para
  // que o que vai na URL nunca seja um derivado atacável do hash bcrypt.
  private fingerprint(passwordHash: string): string {
    return createHmac('sha256', process.env.JWT_SECRET as string).update(passwordHash).digest('hex').slice(0, 32);
  }

  private findUser(email: string): Promise<AuthUserRow | undefined> {
    return this.db
      .withoutTenantContext((client) =>
        client.query<AuthUserRow>('SELECT * FROM auth_find_user_by_email($1)', [email]),
      )
      .then((result) => result.rows[0]);
  }

  // Sempre resolve sem revelar se o e-mail existe: quem chama devolve a mesma
  // resposta nos dois casos. O envio não é aguardado, para o tempo de resposta
  // também não denunciar a existência da conta.
  async request(rawEmail: string, ip?: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.findUser(email);
    if (!user || user.status !== 'ativo') return;

    const token = this.jwt.sign(
      { sub: user.id, email, purpose: PASSWORD_RESET_TOKEN_PURPOSE, pwf: this.fingerprint(user.password_hash) },
      { expiresIn: RESET_TOKEN_TTL },
    );
    // Fragmento (#), não query string: não vai para o servidor, para logs do
    // proxy nem para o cabeçalho Referer.
    const link = `${process.env.PUBLIC_APP_URL}/redefinir-senha#token=${token}`;

    void this.email
      .send({
        to: email,
        subject: 'Redefinição de senha — Montese SST',
        html: `<p>Recebemos um pedido para redefinir a senha da sua conta no Montese SST.</p>
<p><a href="${link}">Criar uma nova senha</a> (o link vale por 1 hora e só pode ser usado uma vez).</p>
<p>Se não foi você, ignore este e-mail: sua senha atual continua a mesma.</p>`,
      })
      .catch(() => undefined); // EmailService já registra a falha; não altera a resposta.

    void this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      actorTenantId: user.tenant_id,
      action: 'password_reset_requested',
      resourceType: 'auth',
      resourceId: user.id,
      method: 'POST',
      path: '/auth/forgot-password',
      statusCode: 200,
      ipAddress: ip,
    });
  }

  async reset(token: string, newPassword: string, ip?: string): Promise<void> {
    let payload: ResetTokenPayload;
    try {
      payload = this.jwt.verify<ResetTokenPayload>(token);
    } catch {
      throw new BadRequestException(INVALID_LINK_MESSAGE);
    }
    if (payload.purpose !== PASSWORD_RESET_TOKEN_PURPOSE || !payload.sub || !payload.email || !payload.pwf) {
      throw new BadRequestException(INVALID_LINK_MESSAGE);
    }

    const user = await this.findUser(payload.email);
    if (!user || user.id !== payload.sub || user.status !== 'ativo') {
      throw new BadRequestException(INVALID_LINK_MESSAGE);
    }

    const expected = Buffer.from(this.fingerprint(user.password_hash));
    const received = Buffer.from(String(payload.pwf));
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new BadRequestException(INVALID_LINK_MESSAGE);
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    const swapped = await this.db.withoutTenantContext((client) =>
      client.query<{ user_id: string; tenant_id: string | null; role: string }>(
        'SELECT * FROM auth_reset_password($1, $2, $3)',
        [user.id, user.password_hash, newHash],
      ),
    );
    // Nenhuma linha = outra requisição com o mesmo token chegou primeiro.
    if (swapped.rows.length === 0) throw new BadRequestException(INVALID_LINK_MESSAGE);

    void this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      actorTenantId: user.tenant_id,
      action: 'password_reset_completed',
      resourceType: 'auth',
      resourceId: user.id,
      method: 'POST',
      path: '/auth/reset-password',
      statusCode: 200,
      ipAddress: ip,
    });

    // Aviso de segurança: se não foi o dono, ele fica sabendo.
    void this.email
      .send({
        to: payload.email,
        subject: 'Sua senha foi alterada — Montese SST',
        html: `<p>A senha da sua conta no Montese SST acabou de ser alterada.</p>
<p>Se não foi você, redefina a senha novamente e entre em contato com contato@montesesst.com.br.</p>`,
      })
      .catch((err) => this.logger.warn(`Aviso de senha alterada não enviado: ${(err as Error).message}`));
  }
}
