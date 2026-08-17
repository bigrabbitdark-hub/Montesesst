import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../common/database/database.service';

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
  ) {}

  async login(email: string, password: string) {
    // auth_find_user_by_email é SECURITY DEFINER (bypassa RLS só aqui) porque
    // no momento do login ainda não temos user_id/tenant_id pra popular o
    // contexto de RLS — é exatamente o que estamos descobrindo.
    const result = await this.db.withoutTenantContext((client) =>
      client.query<AuthUserRow>('SELECT * FROM auth_find_user_by_email($1)', [email]),
    );
    const user = result.rows[0];
    if (!user) throw new UnauthorizedException('Credenciais inválidas');

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw new UnauthorizedException('Credenciais inválidas');

    if (user.status !== 'ativo') {
      throw new UnauthorizedException('Usuário sem acesso liberado');
    }

    const access_token = this.jwt.sign({
      sub: user.id,
      tenantId: user.tenant_id,
      role: user.role,
    });

    return {
      access_token,
      user: { id: user.id, tenantId: user.tenant_id, role: user.role },
    };
  }
}
