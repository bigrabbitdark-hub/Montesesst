import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';

// Achado durante o ITEM 022 (auditoria 2026-09-27): a estratégia aceitava como
// sessão qualquer JWT com assinatura válida, inclusive os tokens de e-mail
// (confirmação de cadastro, redefinição de senha), que carregam `purpose`.
describe('JwtStrategy.validate', () => {
  let strategy: JwtStrategy;
  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-com-tamanho-suficiente';
    strategy = new JwtStrategy();
  });

  it('token de sessão válido vira o usuário autenticado', async () => {
    await expect(strategy.validate({ sub: 'u1', tenantId: 't1', role: 'empresa' })).resolves.toEqual({
      id: 'u1',
      tenantId: 't1',
      role: 'empresa',
    });
  });

  it.each(['empresa', 'tecnico', 'parceiro', 'admin'] as const)('aceita o papel %s', async (role) => {
    await expect(strategy.validate({ sub: 'u1', tenantId: null, role })).resolves.toMatchObject({ role });
  });

  it.each(['email_confirmation', 'password_reset', 'qualquer-coisa'])(
    'recusa token com purpose "%s" (é um token de e-mail, não de sessão)',
    async (purpose) => {
      await expect(strategy.validate({ sub: 'u1', tenantId: 't1', role: 'empresa', purpose } as any)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    },
  );

  it('recusa token sem role', async () => {
    await expect(strategy.validate({ sub: 'u1' } as any)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa role inventada fora dos 4 papéis conhecidos', async () => {
    await expect(strategy.validate({ sub: 'u1', tenantId: null, role: 'superuser' } as any)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('recusa token sem sub', async () => {
    await expect(strategy.validate({ tenantId: 't1', role: 'empresa' } as any)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
