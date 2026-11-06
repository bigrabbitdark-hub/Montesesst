import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { PERMISSIONS } from '../src/common/permissions';

const U = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';

describe('JwtStrategy — atuação e troca de senha', () => {
  beforeAll(() => { process.env.JWT_SECRET = 'x'.repeat(32); });
  const s = () => new JwtStrategy();

  it('token comum não ganha campos de atuação', async () => {
    expect(await s().validate({ sub: U, tenantId: null, role: 'socio' })).toEqual({ id: U, tenantId: null, role: 'socio' });
  });
  it('socio com act válido carrega actingTenantId', async () => {
    expect(await s().validate({ sub: U, tenantId: null, role: 'socio', act: T })).toMatchObject({ id: U, role: 'socio', actingTenantId: T });
  });
  it.each(['empresa', 'tecnico', 'parceiro', 'admin'] as const)('act com role %s é recusado', async (role) => {
    await expect(s().validate({ sub: U, tenantId: T, role, act: T })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('act que não é uuid é recusado', async () => {
    await expect(s().validate({ sub: U, tenantId: null, role: 'socio', act: 'abc' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('mcp true vira mustChangePassword', async () => {
    expect(await s().validate({ sub: U, tenantId: T, role: 'empresa', mcp: true })).toMatchObject({ mustChangePassword: true });
  });
  it('purpose continua proibido', async () => {
    await expect(s().validate({ sub: U, tenantId: null, role: 'socio', purpose: 'email_confirmation' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('PERMISSIONS inclui as duas novas e tem 25 itens', () => {
    expect(PERMISSIONS).toEqual(expect.arrayContaining(['empresas.criar', 'empresas.atuar']));
    expect(PERMISSIONS).toHaveLength(25);
  });
});
