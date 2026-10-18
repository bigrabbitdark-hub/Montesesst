import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

const CNPJ_A = '12345678000276';
const CNPJ_B = '12345678000357';
const endereco = { address_street: 'Rua X', address_city: 'Criciúma', address_state: 'SC', address_zip: '88801000' };

describe('CNPJ da filial (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tokenOutra: string;
  let tenantId: string;
  let tenantCnpj: string;

  const criar = (t: string, body: object) =>
    request(app.getHttpServer()).post('/company-units').set('Authorization', `Bearer ${t}`).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();

    const a = await db.createTenantWithUser('Empresa Filial Cnpj');
    tenantId = a.tenantId;
    tenantCnpj = (await (db as any).client.query('SELECT cnpj FROM tenants WHERE id=$1', [tenantId])).rows[0].cnpj;
    token = (await request(app.getHttpServer()).post('/auth/login').send({ email: a.email, password: a.password })).body.access_token;

    const b = await db.createTenantWithUser('Outra Empresa Cnpj');
    tokenOutra = (await request(app.getHttpServer()).post('/auth/login').send({ email: b.email, password: b.password })).body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('cria filial com CNPJ (aceita máscara) e grava só os 14 dígitos', async () => {
    const res = await criar(token, { name: 'Filial 1', cnpj: '12.345.678/0002-76', ...endereco });
    expect(res.status).toBe(201);
    expect(res.body.cnpj).toBe(CNPJ_A);
  });

  it('CNPJ é obrigatório na filial nova (400 sem o campo)', async () => {
    const res = await criar(token, { name: 'Sem CNPJ', ...endereco });
    expect(res.status).toBe(400);
  });

  it('CNPJ inválido → 400', async () => {
    expect((await criar(token, { name: 'Inválida', cnpj: '12345678000277', ...endereco })).status).toBe(400);
    expect((await criar(token, { name: 'Curta', cnpj: '123', ...endereco })).status).toBe(400);
  });

  it('CNPJ igual ao da matriz (cadastro da empresa) → 400', async () => {
    const res = await criar(token, { name: 'Igual matriz', cnpj: tenantCnpj, ...endereco });
    expect(res.status).toBe(400);
  });

  it('CNPJ repetido na mesma empresa → 409; em outra empresa é permitido', async () => {
    expect((await criar(token, { name: 'Duplicada', cnpj: CNPJ_A, ...endereco })).status).toBe(409);
    expect((await criar(tokenOutra, { name: 'Outra empresa', cnpj: CNPJ_A, ...endereco })).status).toBe(201);
  });

  it('filial antiga (sem CNPJ) continua listável e pode receber o CNPJ por PATCH', async () => {
    const legada = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1,'Filial antiga','Rua Velha','Criciúma','SC','88801000') RETURNING id`,
      [tenantId],
    );
    const id = legada.rows[0].id;
    const lista = await request(app.getHttpServer()).get('/company-units').set('Authorization', `Bearer ${token}`);
    expect(lista.body.find((u: any) => u.id === id).cnpj).toBeNull();

    const res = await request(app.getHttpServer())
      .patch(`/company-units/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cnpj: '12.345.678/0003-57' });
    expect(res.status).toBe(200);
    expect(res.body.cnpj).toBe(CNPJ_B);
  });

  it('PATCH não limpa nem aceita CNPJ inválido, repetido ou da matriz', async () => {
    const lista = await request(app.getHttpServer()).get('/company-units').set('Authorization', `Bearer ${token}`);
    const filial = lista.body.find((u: any) => u.cnpj === CNPJ_A);
    const patch = (body: object) =>
      request(app.getHttpServer()).patch(`/company-units/${filial.id}`).set('Authorization', `Bearer ${token}`).send(body);
    expect((await patch({ cnpj: '' })).status).toBe(400);
    expect((await patch({ cnpj: '11111111111111' })).status).toBe(400);
    expect((await patch({ cnpj: CNPJ_B })).status).toBe(409);
    expect((await patch({ cnpj: tenantCnpj })).status).toBe(400);
    expect((await patch({ name: 'Renomeada' })).body.cnpj).toBe(CNPJ_A);
  });

  it('empresa não enxerga nem altera filial de outra (isolamento continua valendo)', async () => {
    const lista = await request(app.getHttpServer()).get('/company-units').set('Authorization', `Bearer ${tokenOutra}`);
    expect(lista.body.every((u: any) => u.tenant_id !== tenantId)).toBe(true);
    const minha = (await request(app.getHttpServer()).get('/company-units').set('Authorization', `Bearer ${token}`)).body[0];
    const res = await request(app.getHttpServer())
      .patch(`/company-units/${minha.id}`)
      .set('Authorization', `Bearer ${tokenOutra}`)
      .send({ cnpj: '12345678000438' });
    expect([403, 404]).toContain(res.status);
  });

  describe('dados cadastrais, observação, vínculo com a matriz e permissões', () => {
    const completo = {
      cnpj: '12345678000438',
      legal_name: 'FILIAL QUATRO SA',
      notes: 'Galpão 2, turno noturno',
      address_neighborhood: 'Centro',
      address_complement: 'Sala 4',
      cnae_code: '4120400',
      cnae_description: 'Construção de edifícios',
    };
    let unitId: string;

    it('cria filial com razão social, CNAE, bairro, complemento e observação, vinculada à empresa do token', async () => {
      const res = await criar(token, { name: 'Filial 4', ...endereco, ...completo });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ ...completo, tenant_id: tenantId, is_matriz: false });
      unitId = res.body.id;
    });

    it('observação persiste ao reler e ao editar; editar não mexe nos outros campos', async () => {
      const lida = await request(app.getHttpServer()).get(`/company-units/${unitId}`).set('Authorization', `Bearer ${token}`);
      expect(lida.body.notes).toBe(completo.notes);
      const edit = await request(app.getHttpServer())
        .patch(`/company-units/${unitId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ notes: 'Observação editada' });
      expect(edit.status).toBe(200);
      expect(edit.body).toMatchObject({ ...completo, notes: 'Observação editada' });
      const limpa = await request(app.getHttpServer())
        .patch(`/company-units/${unitId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ notes: '', cnae_code: '' });
      expect(limpa.status).toBe(200);
      expect(limpa.body.notes).toBe('');
    });

    it('rejeita CNAE fora do formato e observação acima de 2000 caracteres', async () => {
      expect((await criar(token, { name: 'X', cnpj: '12345678000195', ...endereco, cnae_code: '123' })).status).toBe(400);
      expect((await criar(token, { name: 'X', cnpj: '12345678000195', ...endereco, notes: 'x'.repeat(2001) })).status).toBe(400);
    });

    it('a matriz da empresa não é alterada ao criar/editar filial', async () => {
      await (db as any).client.query(
        `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip, is_matriz)
         VALUES ($1,'Matriz','Rua Matriz','Criciúma','SC','88801000', true)`,
        [tenantId],
      );
      const antes = (await (db as any).client.query('SELECT * FROM company_units WHERE tenant_id=$1 AND is_matriz', [tenantId])).rows[0];
      await criar(token, { name: 'Filial 5', ...endereco, ...completo, cnpj: '12345678000195' });
      await request(app.getHttpServer()).patch(`/company-units/${unitId}`).set('Authorization', `Bearer ${token}`).send({ notes: 'outra' });
      const depois = (await (db as any).client.query('SELECT * FROM company_units WHERE tenant_id=$1 AND is_matriz', [tenantId])).rows[0];
      expect(depois).toEqual(antes);
      const total = (await (db as any).client.query('SELECT count(*)::int AS n FROM company_units WHERE tenant_id=$1 AND is_matriz', [tenantId])).rows[0].n;
      expect(total).toBe(1);
      // e a matriz não aceita receber CNPJ de filial por PATCH
      const res = await request(app.getHttpServer())
        .patch(`/company-units/${antes.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ cnpj: '12345678000357' });
      expect(res.status).toBe(400);
    });

    it('tecnico não cria nem edita filial (403); empresa de outro tenant não edita (403/404)', async () => {
      const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Filial Cnpj');
      const login = await request(app.getHttpServer()).post('/auth/login').send({ email: tecnico.email, password: tecnico.password });
      const t = login.body.access_token;
      expect((await criar(t, { name: 'Y', cnpj: '12345678000195', ...endereco })).status).toBe(403);
      expect((await request(app.getHttpServer()).patch(`/company-units/${unitId}`).set('Authorization', `Bearer ${t}`).send({ notes: 'z' })).status).toBe(403);
      const outra = await request(app.getHttpServer())
        .patch(`/company-units/${unitId}`)
        .set('Authorization', `Bearer ${tokenOutra}`)
        .send({ notes: 'invasão' });
      expect([403, 404]).toContain(outra.status);
      const conf = await request(app.getHttpServer()).get(`/company-units/${unitId}`).set('Authorization', `Bearer ${token}`);
      expect(conf.body.notes).not.toBe('invasão');
    });

    it('empresa não consegue criar filial em outro tenant enviando tenant_id (ignorado/rejeitado)', async () => {
      const res = await criar(token, { name: 'Z', cnpj: '12345678000195', ...endereco, tenant_id: '00000000-0000-0000-0000-000000000000' });
      if (res.status === 201) expect(res.body.tenant_id).toBe(tenantId);
      else expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});
