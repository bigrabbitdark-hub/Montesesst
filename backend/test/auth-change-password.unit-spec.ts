import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../src/auth/auth.service';

const U = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';

function montar(hashAtual: string | null, trocou = true) {
  const queries: string[] = [];
  const client: any = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('auth_own_password_hash')) return { rows: [{ h: hashAtual }] };
      if (sql.includes('auth_change_password')) return { rows: trocou ? [{ user_id: U }] : [] };
      return { rows: [] };
    }),
  };
  const db: any = { withTenantContext: async (_c: any, fn: any) => fn(client), withoutTenantContext: async (fn: any) => fn(client) };
  const jwt: any = { sign: jest.fn(() => 'novo-token') };
  const audit: any = { log: jest.fn(async () => undefined) };
  return { svc: new AuthService(db, jwt, audit), jwt, audit, queries };
}

describe('AuthService.changePassword', () => {
  const user = { id: U, tenantId: T, role: 'empresa' as const, mustChangePassword: true };

  it('troca a senha e devolve token SEM mcp', async () => {
    const atual = await bcrypt.hash('Temporaria1', 4);
    const { svc, jwt } = montar(atual);
    const out = await svc.changePassword(user, 'Temporaria1', 'NovaSenha123', '1.1.1.1');
    expect(out).toEqual({ access_token: 'novo-token' });
    expect(jwt.sign).toHaveBeenCalledWith({ sub: U, tenantId: T, role: 'empresa' });
  });
  it('senha atual errada => 400 sem trocar', async () => {
    const atual = await bcrypt.hash('Temporaria1', 4);
    const { svc, queries } = montar(atual);
    await expect(svc.changePassword(user, 'errada', 'NovaSenha123')).rejects.toBeInstanceOf(BadRequestException);
    expect(queries.some((q) => q.includes('auth_change_password'))).toBe(false);
  });
  it('nova igual à atual => 400', async () => {
    const { svc } = montar(await bcrypt.hash('Temporaria1', 4));
    await expect(svc.changePassword(user, 'Temporaria1', 'Temporaria1')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('sócia atuando como empresa não troca senha', async () => {
    const { svc } = montar(await bcrypt.hash('x', 4));
    await expect(svc.changePassword({ ...user, actingAs: true }, 'x', 'NovaSenha123')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('corrida (CAS sem linha) => 400', async () => {
    const { svc } = montar(await bcrypt.hash('Temporaria1', 4), false);
    await expect(svc.changePassword(user, 'Temporaria1', 'NovaSenha123')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('nunca registra senhas na auditoria', async () => {
    const { svc, audit } = montar(await bcrypt.hash('Temporaria1', 4));
    await svc.changePassword(user, 'Temporaria1', 'NovaSenha123');
    expect(JSON.stringify(audit.log.mock.calls)).not.toMatch(/Temporaria1|NovaSenha123/);
  });
});
