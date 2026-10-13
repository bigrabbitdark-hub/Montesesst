import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

const CPF_OK = '52998224725';
const CPF_OK_2 = '11144477735';

describe('Funcionários: campos oficiais (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let empresaToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Official Table Teste');
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = login.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  const post = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/employees').set('Authorization', `Bearer ${empresaToken}`).send(body);

  it('cria funcionário com os campos do modelo e devolve cbo/matrícula como texto', async () => {
    const res = await post({
      full_name: 'Ana Teste',
      cpf: '529.982.247-25',
      sex: 'f',
      esocial_registration: '00012345678',
      cbo_code: '051210',
      position: 'Soldador',
      activity_description: 'Solda em campo',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      cpf: CPF_OK,
      sex: 'F',
      esocial_registration: '00012345678',
      cbo_code: '051210',
      activity_description: 'Solda em campo',
    });
  });

  it('rejeita CPF com dígito verificador inválido (400, mensagem em português)', async () => {
    const res = await post({ full_name: 'Bia', cpf: '52998224726' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('CPF inválido');
  });

  it('matrícula repetida no mesmo tenant dá 409', async () => {
    const first = await post({ full_name: 'Caio', cpf: CPF_OK_2, esocial_registration: 'MAT-DUP-1' });
    expect(first.status).toBe(201);
    const second = await post({ full_name: 'Duda', cpf: '12345678909', esocial_registration: 'MAT-DUP-1' });
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).toContain('Matrícula eSocial já cadastrada nesta empresa');
  });

  it('CPF repetido no mesmo tenant dá 409 com mensagem em português', async () => {
    const first = await post({ full_name: 'Fabi', cpf: '40000007994' });
    expect(first.status).toBe(201);
    const second = await post({ full_name: 'Fabi 2', cpf: '40000007994' });
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).toContain('Registro duplicado');
  });

  it('update normaliza e valida os campos oficiais', async () => {
    const created = await post({ full_name: 'Edu', cpf: '40000004030' });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const ok = await request(app.getHttpServer())
      .patch(`/employees/${id}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ sex: 'm', cbo_code: 51210, activity_description: 'Operação' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ sex: 'M', cbo_code: '051210', activity_description: 'Operação' });

    const bad = await request(app.getHttpServer())
      .patch(`/employees/${id}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ cbo_code: '12ab34' });
    expect(bad.status).toBe(400);
  });
});
