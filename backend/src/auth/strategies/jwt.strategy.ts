import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser, USER_ROLES, UserRole } from '../../common/types';

interface JwtPayload {
  sub: string;
  tenantId: string | null;
  role: UserRole;
  // Só existe em tokens enviados por e-mail (confirmação de cadastro,
  // redefinição de senha) — nunca em token de sessão.
  purpose?: string;
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
    return { id: payload.sub, tenantId: payload.tenantId, role: payload.role };
  }
}
