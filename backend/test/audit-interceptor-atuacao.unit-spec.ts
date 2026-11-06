import { of } from 'rxjs';
import { AuditInterceptor } from '../src/common/interceptors/audit.interceptor';

function rodar(user: any) {
  const log = jest.fn(async () => undefined);
  const request: any = { method: 'POST', route: { path: '/employees' }, path: '/employees', originalUrl: '/employees', url: '/employees', params: {}, ip: '1.1.1.1', user };
  const context: any = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 201 }) }) };
  return new Promise<jest.Mock>((resolve) => {
    new AuditInterceptor({ log } as any).intercept(context, { handle: () => of({ id: 'x' }) } as any).subscribe({ complete: () => resolve(log) });
  });
}

describe('AuditInterceptor — atuação', () => {
  it('empresa comum: ator empresa, sem detail', async () => {
    const log = await rodar({ id: 'u', tenantId: 't', role: 'empresa' });
    expect(log.mock.calls[0][0]).toMatchObject({ actorUserId: 'u', actorRole: 'empresa', actorTenantId: 't', detail: null });
  });
  it('atuando: ator socio (id da sócia), tenant atuado e detail', async () => {
    const log = await rodar({ id: 'socia', tenantId: 'X', role: 'empresa', actingAs: true });
    expect(log.mock.calls[0][0]).toMatchObject({ actorUserId: 'socia', actorRole: 'socio', actorTenantId: 'X', detail: 'atuando_como_empresa' });
  });
});
