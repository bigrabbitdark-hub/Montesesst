import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { USER_ROLES } from '../src/common/types';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { Roles } from '../src/common/decorators/roles.decorator';
import { RequirePermission } from '../src/common/decorators/require-permission.decorator';

describe('tipos de papel', () => {
  it('inclui o papel socio', () => {
    expect(USER_ROLES).toContain('socio');
  });
});

class Fake {
  semDecorator() {}
  @Roles('admin') soAdmin() {}
  @Roles('empresa', 'socio') comSocio() {}
  @RequirePermission('clients.read') comPermissao() {}
}

function ctx(handler: Function, role: string | null): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Fake,
    switchToHttp: () => ({
      getRequest: () => ({
        user: role ? { id: 'u', role } : undefined,
        method: 'PATCH',
        path: '/plans/abc',
        url: '/plans/abc?x=1&token=segredo',
        originalUrl: '/plans/abc?x=1&token=segredo',
        ip: '10.0.0.9',
      }),
    }),
  } as any;
}

describe('RolesGuard — socio nega por padrão', () => {
  const guard = new RolesGuard(new Reflector());
  const p = Fake.prototype;

  it('nega socio em rota sem @Roles', () => {
    expect(guard.canActivate(ctx(p.semDecorator, 'socio'))).toBe(false);
  });
  it('nega socio em rota @Roles(admin)', () => {
    expect(guard.canActivate(ctx(p.soAdmin, 'socio'))).toBe(false);
  });
  it('libera socio quando listado em @Roles', () => {
    expect(guard.canActivate(ctx(p.comSocio, 'socio'))).toBe(true);
  });
  it('libera socio quando a rota exige permissão (a PermissionsGuard decide depois)', () => {
    expect(guard.canActivate(ctx(p.comPermissao, 'socio'))).toBe(true);
  });
  it('mantém o comportamento antigo: empresa em rota sem @Roles continua liberada', () => {
    expect(guard.canActivate(ctx(p.semDecorator, 'empresa'))).toBe(true);
  });
  it('mantém o comportamento antigo: empresa em @Roles(admin) continua negada', () => {
    expect(guard.canActivate(ctx(p.soAdmin, 'empresa'))).toBe(false);
  });
});

describe('RolesGuard — auditoria das negações do socio', () => {
  const p = Fake.prototype;
  const mk = () => {
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    return { audit, guard: new RolesGuard(new Reflector(), audit as any) };
  };

  it('socio negado em @Roles(admin) audita uma vez, com path sem query string', () => {
    const { audit, guard } = mk();
    expect(guard.canActivate(ctx(p.soAdmin, 'socio'))).toBe(false);
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith({
      actorUserId: 'u',
      actorRole: 'socio',
      action: 'role.denied',
      resourceType: 'route',
      method: 'PATCH',
      path: '/plans/abc',
      statusCode: 403,
      ipAddress: '10.0.0.9',
    });
    expect(audit.log.mock.calls[0][0].path).not.toContain('?');
  });
  it('socio liberado não audita', () => {
    const { audit, guard } = mk();
    expect(guard.canActivate(ctx(p.comSocio, 'socio'))).toBe(true);
    expect(guard.canActivate(ctx(p.comPermissao, 'socio'))).toBe(true);
    expect(audit.log).not.toHaveBeenCalled();
  });
  it('empresa negada não audita', () => {
    const { audit, guard } = mk();
    expect(guard.canActivate(ctx(p.soAdmin, 'empresa'))).toBe(false);
    expect(audit.log).not.toHaveBeenCalled();
  });
  it('sem audit injetado não lança', () => {
    const guard = new RolesGuard(new Reflector());
    expect(guard.canActivate(ctx(p.soAdmin, 'socio'))).toBe(false);
  });
  it('se audit.log lançar de forma síncrona, ainda assim nega sem lançar', () => {
    const guard = new RolesGuard(new Reflector(), { log: () => { throw new Error('x'); } } as any);
    expect(guard.canActivate(ctx(p.soAdmin, 'socio'))).toBe(false);
  });
});
