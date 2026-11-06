import { readFileSync } from 'fs';
import { join } from 'path';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActingTenantGuard } from '../src/common/guards/acting-tenant.guard';
import { PasswordChangeRequiredGuard } from '../src/common/guards/password-change-required.guard';
import { ACTING_ALLOWED_KEY } from '../src/common/decorators/acting-allowed.decorator';
import { ALLOW_PASSWORD_PENDING_KEY } from '../src/common/decorators/allow-password-pending.decorator';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';

const U = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';

function ctx(user: any, meta: Record<string, boolean> = {}) {
  const request: any = { user, method: 'GET', path: '/employees', ip: '1.1.1.1' };
  const handler = () => undefined;
  class Cls {}
  const reflector = { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector;
  return { request, reflector, context: { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => handler, getClass: () => Cls } as any };
}
const dbCom = (ok: boolean | Error | null | 'vazio') => ({
  withTenantContext: jest.fn(async (_c: any, fn: any) => {
    if (ok instanceof Error) throw ok;
    return fn({ query: async () => ({ rows: ok === 'vazio' ? [] : [{ ok }] }) });
  }),
});
const audit = { log: jest.fn(async (_e?: any) => undefined) } as any;

describe('ActingTenantGuard', () => {
  beforeEach(() => {
    audit.log.mockReset();
    audit.log.mockImplementation(async () => undefined);
  });
  it('sem actingTenantId não faz nada', async () => {
    const { context, request, reflector } = ctx({ id: U, tenantId: null, role: 'socio' });
    const db = dbCom(true);
    expect(await new ActingTenantGuard(reflector, db as any, audit).canActivate(context)).toBe(true);
    expect(db.withTenantContext).not.toHaveBeenCalled();
    expect(request.user.role).toBe('socio');
  });
  it('rota sem @ActingAllowed é negada (ACTING_ROUTE_DENIED) sem consultar o banco', async () => {
    const { context, reflector } = ctx({ id: U, tenantId: null, role: 'socio', actingTenantId: T });
    const db = dbCom(true);
    await expect(new ActingTenantGuard(reflector, db as any, audit).canActivate(context)).rejects.toMatchObject({ response: { code: 'ACTING_ROUTE_DENIED' } });
    expect(db.withTenantContext).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'atuacao.negada', statusCode: 403 }));
  });
  it('banco diz não => ACTING_NOT_ALLOWED', async () => {
    const { context, reflector } = ctx({ id: U, tenantId: null, role: 'socio', actingTenantId: T }, { [ACTING_ALLOWED_KEY]: true });
    await expect(new ActingTenantGuard(reflector, dbCom(false) as any, audit).canActivate(context)).rejects.toMatchObject({ response: { code: 'ACTING_NOT_ALLOWED' } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'atuacao.negada', statusCode: 403 }));
  });
  it('erro no banco falha fechado com ACTING_NOT_ALLOWED', async () => {
    const { context, reflector } = ctx({ id: U, tenantId: null, role: 'socio', actingTenantId: T }, { [ACTING_ALLOWED_KEY]: true });
    const p = new ActingTenantGuard(reflector, dbCom(new Error('boom')) as any, audit).canActivate(context);
    await expect(p).rejects.toBeInstanceOf(ForbiddenException);
    await expect(new ActingTenantGuard(reflector, dbCom(new Error('boom')) as any, audit).canActivate(context)).rejects.toMatchObject({ response: { code: 'ACTING_NOT_ALLOWED' } });
  });
  it.each([['rows vazio', 'vazio' as const], ['ok null', null]])('%s => ACTING_NOT_ALLOWED', async (_n, v) => {
    const { context, reflector } = ctx({ id: U, tenantId: null, role: 'socio', actingTenantId: T }, { [ACTING_ALLOWED_KEY]: true });
    await expect(new ActingTenantGuard(reflector, dbCom(v) as any, audit).canActivate(context)).rejects.toMatchObject({ response: { code: 'ACTING_NOT_ALLOWED' } });
  });
  it('audit.log rejeitando NÃO derruba o 403', async () => {
    audit.log.mockImplementation(async () => { throw new Error('audit fora'); });
    const { context, reflector } = ctx({ id: U, tenantId: null, role: 'socio', actingTenantId: T }, { [ACTING_ALLOWED_KEY]: true });
    await expect(new ActingTenantGuard(reflector, dbCom(false) as any, audit).canActivate(context)).rejects.toMatchObject({ response: { code: 'ACTING_NOT_ALLOWED' } });
    await new Promise((r) => setImmediate(r));
  });
  it('banco diz sim => reescreve request.user como empresa do tenant X, preservando o id da sócia', async () => {
    const { context, request, reflector } = ctx({ id: U, tenantId: null, role: 'socio', actingTenantId: T }, { [ACTING_ALLOWED_KEY]: true });
    expect(await new ActingTenantGuard(reflector, dbCom(true) as any, audit).canActivate(context)).toBe(true);
    expect(request.user).toEqual({ id: U, tenantId: T, role: 'empresa', actingAs: true, actingTenantId: T });
  });
  it('rota pública não é tocada', async () => {
    const { context, request, reflector } = ctx({ id: U, tenantId: null, role: 'socio', actingTenantId: T }, { [IS_PUBLIC_KEY]: true });
    const db = dbCom(true);
    expect(await new ActingTenantGuard(reflector, db as any, audit).canActivate(context)).toBe(true);
    expect(db.withTenantContext).not.toHaveBeenCalled();
    expect(request.user.role).toBe('socio');
  });
});

describe('ActingTenantGuard — auditoria de leituras (atuacao.acesso, Ruling 20)', () => {
  beforeEach(() => {
    audit.log.mockReset();
    audit.log.mockImplementation(async () => undefined);
  });
  const atuando = { id: U, tenantId: null, role: 'socio', actingTenantId: T };
  const acessos = () => audit.log.mock.calls.filter((c: any[]) => c[0]?.action === 'atuacao.acesso');

  it('GET permitido grava atuacao.acesso com tenant atuado e path SEM query string', async () => {
    const { context, request, reflector } = ctx({ ...atuando }, { [ACTING_ALLOWED_KEY]: true });
    request.path = '/employees';
    request.originalUrl = '/employees?q=Jo%C3%A3o&cpf=123';
    expect(await new ActingTenantGuard(reflector, dbCom(true) as any, audit).canActivate(context)).toBe(true);
    expect(acessos()).toHaveLength(1);
    expect(acessos()[0][0]).toEqual(
      expect.objectContaining({
        action: 'atuacao.acesso', actorUserId: U, actorRole: 'socio', actorTenantId: T, method: 'GET',
        path: '/employees', statusCode: 200, detail: 'atuando_como_empresa',
      }),
    );
    expect(JSON.stringify(acessos()[0][0])).not.toContain('cpf');
  });
  it('HEAD também é auditado', async () => {
    const { context, request, reflector } = ctx({ ...atuando }, { [ACTING_ALLOWED_KEY]: true });
    request.method = 'HEAD';
    await new ActingTenantGuard(reflector, dbCom(true) as any, audit).canActivate(context);
    expect(acessos()).toHaveLength(1);
  });
  it.each(['/tenants/me', '/tenants/me/logo', '/dashboard/summary'])('GET %s NÃO é auditado (ruído)', async (path) => {
    const { context, request, reflector } = ctx({ ...atuando }, { [ACTING_ALLOWED_KEY]: true });
    request.path = path;
    expect(await new ActingTenantGuard(reflector, dbCom(true) as any, audit).canActivate(context)).toBe(true);
    expect(acessos()).toHaveLength(0);
  });
  it('POST NÃO é auditado pelo guard (o AuditInterceptor já audita escritas)', async () => {
    const { context, request, reflector } = ctx({ ...atuando }, { [ACTING_ALLOWED_KEY]: true });
    request.method = 'POST';
    expect(await new ActingTenantGuard(reflector, dbCom(true) as any, audit).canActivate(context)).toBe(true);
    expect(audit.log).not.toHaveBeenCalled();
  });
  it('GET negado pelo banco NÃO grava atuacao.acesso (só atuacao.negada)', async () => {
    const { context, reflector } = ctx({ ...atuando }, { [ACTING_ALLOWED_KEY]: true });
    await expect(new ActingTenantGuard(reflector, dbCom(false) as any, audit).canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(acessos()).toHaveLength(0);
  });
  it('sem atuação (empresa comum) não grava nada', async () => {
    const { context, reflector } = ctx({ id: U, tenantId: T, role: 'empresa' }, { [ACTING_ALLOWED_KEY]: true });
    await new ActingTenantGuard(reflector, dbCom(true) as any, audit).canActivate(context);
    expect(audit.log).not.toHaveBeenCalled();
  });
  it('audit.log rejeitando (assíncrono ou síncrono) NÃO derruba a leitura', async () => {
    audit.log.mockImplementation(async () => { throw new Error('audit fora'); });
    const a = ctx({ ...atuando }, { [ACTING_ALLOWED_KEY]: true });
    expect(await new ActingTenantGuard(a.reflector, dbCom(true) as any, audit).canActivate(a.context)).toBe(true);
    expect(audit.log).toHaveBeenCalled();
    audit.log.mockImplementation(() => { throw new Error('audit síncrono'); });
    const b = ctx({ ...atuando }, { [ACTING_ALLOWED_KEY]: true });
    expect(await new ActingTenantGuard(b.reflector, dbCom(true) as any, audit).canActivate(b.context)).toBe(true);
    await new Promise((r) => setImmediate(r));
  });
});

describe('PasswordChangeRequiredGuard', () => {
  it('sem flag passa', () => {
    const { context, reflector } = ctx({ id: U, tenantId: T, role: 'empresa' });
    expect(new PasswordChangeRequiredGuard(reflector).canActivate(context)).toBe(true);
  });
  it('com flag e rota comum => PASSWORD_CHANGE_REQUIRED', () => {
    const { context, reflector } = ctx({ id: U, tenantId: T, role: 'empresa', mustChangePassword: true });
    expect(() => new PasswordChangeRequiredGuard(reflector).canActivate(context)).toThrow(ForbiddenException);
    try {
      new PasswordChangeRequiredGuard(reflector).canActivate(context);
    } catch (e: any) {
      expect(e.getResponse()).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
    }
  });
  it('com flag e rota @AllowWhilePasswordPending passa', () => {
    const { context, reflector } = ctx({ id: U, tenantId: T, role: 'empresa', mustChangePassword: true }, { [ALLOW_PASSWORD_PENDING_KEY]: true });
    expect(new PasswordChangeRequiredGuard(reflector).canActivate(context)).toBe(true);
  });
});

describe('token act + mcp', () => {
  it('PasswordChangeRequiredGuard bloqueia token com act e mustChangePassword (por isso roda antes do ActingTenantGuard)', () => {
    const { context, reflector } = ctx({ id: U, tenantId: null, role: 'socio', actingTenantId: T, mustChangePassword: true }, { [ACTING_ALLOWED_KEY]: true });
    expect(() => new PasswordChangeRequiredGuard(reflector).canActivate(context)).toThrow(ForbiddenException);
  });
});

describe('ordem dos APP_GUARD em app.module.ts', () => {
  it('RateLimit < JwtAuth < PasswordChangeRequired < ActingTenant < SubscriptionStatus < Roles < Permissions', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'app.module.ts'), 'utf8');
    const names = ['RateLimitGuard', 'JwtAuthGuard', 'PasswordChangeRequiredGuard', 'ActingTenantGuard', 'SubscriptionStatusGuard', 'RolesGuard', 'PermissionsGuard'];
    const pos = names.map((n) => src.search(new RegExp(`^\\s*\\{ provide: APP_GUARD, useClass: ${n} \\}`, 'm')));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });
});
