import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../common/database/database.service';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser } from '../common/types';
import { BCRYPT_COST } from '../common/auth/bcrypt-cost';

interface AuthUserRow {
  id: string;
  tenant_id: string | null;
  role: string;
  password_hash: string;
  status: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string, ip?: string) {
    // auth_find_user_by_email é SECURITY DEFINER (bypassa RLS só aqui) porque
    // no momento do login ainda não temos user_id/tenant_id pra popular o
    // contexto de RLS — é exatamente o que estamos descobrindo.
    const result = await this.db.withoutTenantContext((client) =>
      client.query<AuthUserRow>('SELECT * FROM auth_find_user_by_email($1)', [email]),
    );
    const user = result.rows[0];

    const fail = (detail: string, message = 'Credenciais inválidas') => {
      void this.audit.log({
        actorUserId: user?.id ?? null,
        actorRole: user?.role ?? null,
        actorTenantId: user?.tenant_id ?? null,
        action: 'login_failure',
        resourceType: 'auth',
        method: 'POST',
        path: '/auth/login',
        statusCode: 401,
        ipAddress: ip,
        // Nunca inclui a senha tentada — só o e-mail, que já é a chave de
        // busca do próprio auth_find_user_by_email acima.
        detail: `${detail} (email: ${email})`,
      });
      return new UnauthorizedException(message);
    };

    if (!user) throw fail('email não encontrado');

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw fail('senha incorreta');

    if (user.status !== 'ativo') throw fail('usuário sem acesso liberado', 'Usuário sem acesso liberado');

    const flag = await this.db.withoutTenantContext((client) =>
      client.query<{ v: boolean }>('SELECT auth_user_must_change_password($1) AS v', [user.id]),
    );
    const mustChangePassword = flag.rows[0]?.v === true;

    const access_token = this.jwt.sign({
      sub: user.id,
      tenantId: user.tenant_id,
      role: user.role,
      ...(mustChangePassword ? { mcp: true } : {}),
    });

    void this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      actorTenantId: user.tenant_id,
      action: 'login_success',
      resourceType: 'auth',
      resourceId: user.id,
      method: 'POST',
      path: '/auth/login',
      statusCode: 201,
      ipAddress: ip,
    });

    return {
      access_token,
      user: { id: user.id, tenantId: user.tenant_id, role: user.role, mustChangePassword },
    };
  }

  async changePassword(user: AuthenticatedUser, current: string, next: string, ip?: string): Promise<{ access_token: string }> {
    // O token de atuação nunca troca a senha da empresa nem a da sócia dentro da empresa.
    if (user.actingAs) throw new ForbiddenException('Operação não disponível neste modo.');
    if (current === next) throw new BadRequestException('A nova senha deve ser diferente da atual.');

    const ctx = { userId: user.id, tenantId: user.tenantId ?? undefined, role: user.role };
    const hashAtual = await this.db.withTenantContext(ctx, async (client) =>
      (await client.query<{ h: string | null }>('SELECT auth_own_password_hash($1) AS h', [user.id])).rows[0]?.h ?? null,
    );
    const log = (action: string, statusCode: number) =>
      void this.audit.log({
        actorUserId: user.id, actorRole: user.role, actorTenantId: user.tenantId, action, resourceType: 'auth',
        resourceId: user.id, method: 'POST', path: '/auth/change-password', statusCode, ipAddress: ip,
      });
    if (!hashAtual || !(await bcrypt.compare(current, hashAtual))) {
      log('password_change_failure', 400);
      // 400 (não 401): o front trata 401 como sessão expirada e deslogaria o usuário.
      throw new BadRequestException('Senha atual incorreta.');
    }

    const novoHash = await bcrypt.hash(next, BCRYPT_COST);
    const trocou = await this.db.withTenantContext(ctx, (client) =>
      client.query('SELECT * FROM auth_change_password($1, $2, $3)', [user.id, hashAtual, novoHash]),
    );
    if (trocou.rows.length === 0) throw new BadRequestException('Não foi possível trocar a senha. Tente novamente.');

    log('password_changed', 200);
    return { access_token: this.jwt.sign({ sub: user.id, tenantId: user.tenantId, role: user.role }) };
  }
}
