import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser, USER_ROLES, UserRole } from '../../common/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface JwtPayload {
  sub: string;
  tenantId: string | null;
  role: UserRole;
  // Só existe em tokens enviados por e-mail (confirmação de cadastro,
  // redefinição de senha) — nunca em token de sessão.
  purpose?: string;
  act?: string;
  mcp?: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // F-21: validateProductionEnv() garante JWT_SECRET definido em
      // produção. Sem fallback silencioso.
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // Todos os JWTs da aplicação são assinados com o mesmo segredo. Sem esta
    // checagem, um token de e-mail (que vai parar em caixa de entrada, log de
    // proxy, histórico) valia como Bearer de sessão, com `role` indefinida.
    // Sessão exige sub + um dos papéis conhecidos e NENHUM `purpose`.
    if (payload.purpose !== undefined || !payload.sub || !USER_ROLES.includes(payload.role)) {
      throw new UnauthorizedException();
    }
    const user: AuthenticatedUser = { id: payload.sub, tenantId: payload.tenantId, role: payload.role };
    if (payload.act !== undefined) {
      // Token de atuação: só o papel socio, com uuid válido. Qualquer outra combinação é forjada/errada.
      if (payload.role !== 'socio' || typeof payload.act !== 'string' || !UUID_RE.test(payload.act)) {
        throw new UnauthorizedException();
      }
      user.actingTenantId = payload.act;
    }
    if (payload.mcp === true) user.mustChangePassword = true;
    return user;
  }
}
