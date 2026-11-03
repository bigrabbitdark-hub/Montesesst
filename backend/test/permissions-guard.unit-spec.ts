import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { RequirePermission } from '../src/common/decorators/require-permission.decorator';

class Fake {
  @RequirePermission('finance.read') financeiro() {}
  @RequirePermission('clients.read', 'tasks.read') duas() {}
  livre() {}
}

@RequirePermission('finance.read')
class FakeClasse {
  qualquer() {}
}

function montar(concedidas: string[], falha = false) {
  const db: any = {
    withTenantContext: jest.fn(async (_ctx: any, cb: any) => {
      if (falha) throw new Error('db down');
      return cb({ query: jest.fn(async () => ({ rows: concedidas.map((permission) => ({ permission })) })) });
    }),
  };
  const audit: any = { log: jest.fn(async () => undefined) };
  const guard = new PermissionsGuard(new Reflector(), db, audit);
  const ctx = (handler: Function, role: string, klass: Function = Fake) =>
    ({
      getHandler: () => handler,
      getClass: () => klass,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'u1', tenantId: null, role }, method: 'GET', url: '/x?a=1&b=2', path: '/x', ip: '1.1.1.1' }),
      }),
    }) as any;
  return { guard, audit, ctx, db };
}

describe('PermissionsGuard', () => {
  const p = Fake.prototype;

  it('libera socio que tem a permissão', async () => {
    const { guard, ctx } = montar(['finance.read']);
    await expect(guard.canActivate(ctx(p.financeiro, 'socio'))).resolves.toBe(true);
  });

  it('nega socio sem a permissão e audita a negação', async () => {
    const { guard, ctx, audit } = montar([]);
    await expect(guard.canActivate(ctx(p.financeiro, 'socio'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'permission.denied', actorUserId: 'u1', actorRole: 'socio', statusCode: 403 }),
    );
  });

  it('auditoria da negação grava path sem query string', async () => {
    const { guard, ctx, audit } = montar([]);
    await expect(guard.canActivate(ctx(p.financeiro, 'socio'))).rejects.toBeInstanceOf(ForbiddenException);
    const entrada = (audit.log as jest.Mock).mock.calls[0][0];
    expect(entrada.path).toBe('/x');
    expect(entrada.path).not.toContain('?');
  });

  it('exige TODAS as permissões', async () => {
    const { guard, ctx } = montar(['clients.read']);
    await expect(guard.canActivate(ctx(p.duas, 'socio'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('não interfere em rota sem @RequirePermission', async () => {
    const { guard, ctx } = montar([]);
    await expect(guard.canActivate(ctx(p.livre, 'socio'))).resolves.toBe(true);
  });

  it('não interfere em outros papéis', async () => {
    const { guard, ctx } = montar([]);
    await expect(guard.canActivate(ctx(p.financeiro, 'admin'))).resolves.toBe(true);
  });

  it('nega socio quando @RequirePermission está na CLASSE e nada foi concedido', async () => {
    const { guard, ctx } = montar([]);
    await expect(
      guard.canActivate(ctx(FakeClasse.prototype.qualquer, 'socio', FakeClasse)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('falha fechada: erro ao consultar permissões nega (ForbiddenException)', async () => {
    const { guard, ctx } = montar([], true);
    await expect(guard.canActivate(ctx(p.financeiro, 'socio'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('app.module registra PermissionsGuard como APP_GUARD depois do RolesGuard', () => {
    const src = readFileSync(join(__dirname, '../src/app.module.ts'), 'utf8');
    const roles = src.indexOf('{ provide: APP_GUARD, useClass: RolesGuard }');
    const perms = src.indexOf('{ provide: APP_GUARD, useClass: PermissionsGuard }');
    expect(roles).toBeGreaterThan(-1);
    expect(perms).toBeGreaterThan(-1);
    expect(perms).toBeGreaterThan(roles);
  });
});
