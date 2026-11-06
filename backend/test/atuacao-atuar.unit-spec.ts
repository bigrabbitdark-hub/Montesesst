import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AtuacaoService, ACTING_TOKEN_TTL_SECONDS } from '../src/atuacao/atuacao.service';
import { AtuacaoController } from '../src/atuacao/atuacao.controller';

const clientCom = (rowsPorSql: Record<string, any[]>) => ({
  query: jest.fn(async (sql: string) => {
    const k = Object.keys(rowsPorSql).find((x) => sql.includes(x));
    return { rows: k ? rowsPorSql[k] : [] };
  }),
}) as any;

describe('AtuacaoService.podeAtuar', () => {
  it('TTL do token é 30 minutos', () => expect(ACTING_TOKEN_TTL_SECONDS).toBe(1800));
  it('devolve o nome quando o banco permite', async () => {
    const c = clientCom({ socio_can_act_on_tenant: [{ ok: true }], 'FROM tenants': [{ name: 'Empresa X' }] });
    expect(await new AtuacaoService().podeAtuar(c, 's', 't')).toEqual({ name: 'Empresa X' });
  });
  it('devolve null quando o banco nega (sem consultar o nome)', async () => {
    const c = clientCom({ socio_can_act_on_tenant: [{ ok: false }], 'FROM tenants': [{ name: 'Empresa X' }] });
    expect(await new AtuacaoService().podeAtuar(c, 's', 't')).toBeNull();
    expect(c.query).toHaveBeenCalledTimes(1);
  });
});

const TENANT = '11111111-1111-4111-8111-111111111111';
const mkReq = () => ({
  user: { id: 'socio1', role: 'socio' }, method: 'POST', path: `/atuacao/clientes/${TENANT}/atuar`, ip: '1.2.3.4',
  withTenantContext: (fn: any) => fn({ q: 1 }),
}) as any;

describe('AtuacaoController.atuar', () => {
  it('assina token só com sub/role/tenantId=null/act, TTL 1800, e audita sem token', async () => {
    const atuacao = { podeAtuar: jest.fn(async () => ({ name: 'Empresa X' })) } as any;
    const audit = { log: jest.fn(async () => undefined) } as any;
    const jwt = { sign: jest.fn(() => 'TOKEN.ABC') } as any;
    const res = await new AtuacaoController(atuacao, audit, jwt).atuar(TENANT, mkReq());
    expect(res).toEqual({ access_token: 'TOKEN.ABC', expires_in: 1800, tenant: { id: TENANT, name: 'Empresa X' } });
    expect(atuacao.podeAtuar).toHaveBeenCalledWith({ q: 1 }, 'socio1', TENANT);
    const [payload, opts] = jwt.sign.mock.calls[0];
    expect(payload).toEqual({ sub: 'socio1', tenantId: null, role: 'socio', act: TENANT });
    expect(payload).not.toHaveProperty('purpose');
    expect(payload).not.toHaveProperty('mcp');
    expect(opts).toEqual({ expiresIn: 1800 });
    const entry = audit.log.mock.calls[0][0];
    expect(entry).toMatchObject({ action: 'atuacao.iniciada', actorRole: 'socio', actorUserId: 'socio1', actorTenantId: null, resourceType: 'tenant', resourceId: TENANT });
    expect(JSON.stringify(entry)).not.toContain('TOKEN.ABC');
  });

  it('403 ACTING_NOT_ALLOWED quando podeAtuar devolve null; não assina nem audita', async () => {
    const atuacao = { podeAtuar: jest.fn(async () => null) } as any;
    const audit = { log: jest.fn() } as any;
    const jwt = { sign: jest.fn() } as any;
    const p = new AtuacaoController(atuacao, audit, jwt).atuar(TENANT, mkReq());
    await expect(p).rejects.toBeInstanceOf(ForbiddenException);
    await expect(p).rejects.toMatchObject({ response: { code: 'ACTING_NOT_ALLOWED' } });
    expect(jwt.sign).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('com JwtService real: claim act e exp = iat + 1800', async () => {
    const jwt = new JwtService({ secret: 'segredo-de-teste' });
    const atuacao = { podeAtuar: jest.fn(async () => ({ name: 'Empresa X' })) } as any;
    const audit = { log: jest.fn(async () => undefined) } as any;
    const res = await new AtuacaoController(atuacao, audit, jwt).atuar(TENANT, mkReq());
    const d: any = jwt.verify(res.access_token);
    expect(d.act).toBe(TENANT);
    expect(d.sub).toBe('socio1');
    expect(d.role).toBe('socio');
    expect(d.tenantId).toBeNull();
    expect(d.exp - d.iat).toBe(1800);
    expect(d.purpose).toBeUndefined();
    expect(d.mcp).toBeUndefined();
  });
});

describe('AtuacaoController.atuar — limite de taxa (Ruling 23)', () => {
  it('tem @RateLimit por IP (padrão 60 por hora, ajustável por env)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { RATE_LIMIT_KEY } = require('../src/common/rate-limit/rate-limit.decorator');
    const opts = Reflect.getMetadata(RATE_LIMIT_KEY, AtuacaoController.prototype.atuar);
    expect(opts).toEqual({ limit: 60, windowSeconds: 3600, keyBy: 'ip' });
  });
});
