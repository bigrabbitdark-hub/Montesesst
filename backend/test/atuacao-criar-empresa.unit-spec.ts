import { ForbiddenException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AtuacaoService } from '../src/atuacao/atuacao.service';
import { AtuacaoController } from '../src/atuacao/atuacao.controller';
import { CriarEmpresaDto } from '../src/atuacao/dto/criar-empresa.dto';

const dto = (o: Record<string, unknown>) => plainToInstance(CriarEmpresaDto, o);
// CNPJs com dígito verificador válido (calculados com o algoritmo de cnpj.util.ts).
const valido = { company_name: 'Empresa Exemplo', cnpj: '11.222.333/0001-81', full_name: 'RH Exemplo', email: 'rh@exemplo.com.br', password: 'Temporaria1' };
const opts = { whitelist: true, forbidNonWhitelisted: true };

describe('CriarEmpresaDto', () => {
  it('aceita payload válido e normaliza o CNPJ', async () => {
    const d = dto(valido);
    expect(await validate(d, opts)).toHaveLength(0);
    expect(d.cnpj).toBe('11222333000181');
  });
  it.each([
    ['cnpj inválido', { cnpj: '11111111111111' }],
    ['e-mail inválido', { email: 'sem-arroba' }],
    ['senha curta', { password: '123' }],
    ['senha acima de 72', { password: 'a'.repeat(73) }],
    ['campo extra', { role: 'admin' }],
  ])('recusa %s', async (_n, extra) => {
    const erros = await validate(dto({ ...valido, ...extra }), opts);
    expect(erros.length).toBeGreaterThan(0);
  });
});

describe('AtuacaoService.criarEmpresa', () => {
  const clientCom = (impl: (sql: string, p: any[]) => any) => ({ query: jest.fn(async (sql: string, p: any[]) => impl(sql, p)) }) as any;
  const d2 = () => dto({ ...valido, cnpj: '11222333000262' });

  it('chama socio_create_company com o hash (nunca a senha em claro)', async () => {
    const c = clientCom(() => ({ rows: [{ tenant_id: 't', user_id: 'u' }] }));
    const out = await new AtuacaoService().criarEmpresa(c, 's1', d2(), 'HASH');
    expect(out).toEqual({ tenant_id: 't', user_id: 'u' });
    const [sql, params] = c.query.mock.calls[0];
    expect(sql).toContain('socio_create_company');
    expect(params).toEqual(['s1', 'Empresa Exemplo', '11222333000262', 'rh@exemplo.com.br', 'HASH', 'RH Exemplo']);
    expect(JSON.stringify(c.query.mock.calls)).not.toContain('Temporaria1');
  });
  it('42501 do banco vira 403', async () => {
    const c = clientCom(() => { throw Object.assign(new Error('x'), { code: '42501' }); });
    await expect(new AtuacaoService().criarEmpresa(c, 's1', dto({ ...valido, cnpj: '11222333000343' }), 'H')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('23505 vira conflito 409 (via mapPgError)', async () => {
    const c = clientCom(() => { throw Object.assign(new Error('dup'), { code: '23505', constraint: 'users_email_unique' }); });
    await expect(new AtuacaoService().criarEmpresa(c, 's1', dto({ ...valido, cnpj: '11222333000424' }), 'H')).rejects.toMatchObject({ status: 409 });
  });
});

describe('AtuacaoController.criar', () => {
  it('audita sem e-mail/senha e responde sem senha nem hash', async () => {
    const atuacao = { criarEmpresa: jest.fn(async () => ({ tenant_id: 'T1', user_id: 'U1' })) } as any;
    const audit = { log: jest.fn(async () => undefined) } as any;
    const ctrl = new AtuacaoController(atuacao, audit, { sign: jest.fn() } as any);
    const req: any = {
      user: { id: 'socio1', role: 'socio' }, method: 'POST', ip: '1.2.3.4',
      withTenantContext: (fn: any) => fn({ q: 1 }),
    };
    const res = await ctrl.criar(dto({ ...valido, cnpj: '11222333000262' }), req);
    expect(res).toEqual({ tenant_id: 'T1', user_id: 'U1', email: 'rh@exemplo.com.br' });
    const hashPassado = atuacao.criarEmpresa.mock.calls[0][3] as string;
    expect(hashPassado).toMatch(/^\$2[aby]\$/);
    expect(hashPassado).not.toBe('Temporaria1');
    expect(JSON.stringify(res)).not.toContain('Temporaria1');
    expect(JSON.stringify(res)).not.toContain(hashPassado);
    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = audit.log.mock.calls[0][0];
    expect(entry.action).toBe('empresa.criada_por_socio');
    const j = JSON.stringify(entry);
    expect(j).not.toContain('Temporaria1');
    expect(j).not.toContain('rh@exemplo.com.br');
    expect(j).not.toContain(hashPassado);
  });
});
