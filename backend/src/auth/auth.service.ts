import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../common/database/database.service';
import { AuditService } from '../common/audit/audit.service';

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

    const access_token = this.jwt.sign({
      sub: user.id,
      tenantId: user.tenant_id,
      role: user.role,
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
      user: { id: user.id, tenantId: user.tenant_id, role: user.role },
    };
  }
}
