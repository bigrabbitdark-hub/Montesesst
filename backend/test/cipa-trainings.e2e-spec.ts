import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CIPA trainings (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let employeeId: string;
  let empresaToken: string;
  let outroTenantEmployeeId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA Treinamentos Teste');
    tenantId = tenant.tenantId;
    employeeId = tenant.employeeId;

    const outroTenant = await db.createTenantWithUser('Empresa CIPA Treinamentos Outro Tenant');
    outroTenantEmployeeId = outroTenant.employeeId;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await app.close();
  });

  it('cria treinamento sem certificado, calcula status válido, rejeita employee_id de outro tenant', async () => {
    const futuro = new Date();
    futuro.setFullYear(futuro.getFullYear() + 1);
    const dataValidade = futuro.toISOString().slice(0, 10);

    const res = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', employeeId)
      .field('tipo', 'nr-35')
      .field('data_realizacao', '2026-01-10')
      .field('data_validade', dataValidade)
      .field('carga_horaria', '8');

    expect(res.status).toBe(201);
    expect(res.body.certificado_document_id).toBeNull();

    const list = await request(app.getHttpServer())
      .get('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`);
    const created = list.body.find((t: any) => t.id === res.body.id);
    expect(created.status).toBe('valido');
    expect(created.employee_full_name).toBeTruthy();

    const cruzado = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', outroTenantEmployeeId)
      .field('tipo', 'nr-06')
      .field('data_realizacao', '2026-01-10')
      .field('data_validade', dataValidade);
    expect(cruzado.status).toBe(400);
  });

  it('rejeita tipo="outro" sem tipo_outro e tipo!="outro" com tipo_outro', async () => {
    const semTipoOutro = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', employeeId)
      .field('tipo', 'outro')
      .field('data_realizacao', '2026-01-10')
      .field('data_validade', '2027-01-10');
    expect(semTipoOutro.status).toBe(400);

    const tipoOutroIndevido = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', employeeId)
      .field('tipo', 'nr-06')
      .field('tipo_outro', 'Não devia vir')
      .field('data_realizacao', '2026-01-10')
      .field('data_validade', '2027-01-10');
    expect(tipoOutroIndevido.status).toBe(400);
  });

  it('cria com certificado anexado e o download funciona', async () => {
    const res = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', employeeId)
      .field('tipo', 'nr-10')
      .field('data_realizacao', '2026-01-10')
      .field('data_validade', '2028-01-10')
      .attach('certificado', Buffer.from('%PDF-1.4 fake'), { filename: 'cert.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.certificado_document_id).toBeTruthy();

    const download = await request(app.getHttpServer())
      .get(`/documents/${res.body.certificado_document_id}/download`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(download.status).toBe(200);
    expect(download.body.url).toBeTruthy();
  });

  it('filtra por status vencido/vencendo/valido e apaga um registro', async () => {
    const vencido = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', employeeId)
      .field('tipo', 'nr-33')
      .field('data_realizacao', '2020-01-10')
      .field('data_validade', '2021-01-10');
    expect(vencido.status).toBe(201);

    const listaVencidos = await request(app.getHttpServer())
      .get('/cipa/trainings?status=vencido')
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(listaVencidos.body.some((t: any) => t.id === vencido.body.id)).toBe(true);
    expect(listaVencidos.body.every((t: any) => t.status === 'vencido')).toBe(true);

    const del = await request(app.getHttpServer())
      .delete(`/cipa/trainings/${vencido.body.id}`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(del.status).toBe(200);

    const listaDepois = await request(app.getHttpServer())
      .get('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(listaDepois.body.some((t: any) => t.id === vencido.body.id)).toBe(false);
  });

  it('rejeita apagar funcionário com histórico de treinamento (409), permite depois de apagar o treinamento', async () => {
    // Funcionário dedicado, não o `employeeId` compartilhado com os testes
    // anteriores deste describe — aquele já acumulou outros treinamentos
    // não apagados (o de "cria treinamento sem certificado..." e o de "cria
    // com certificado anexado..."), e apagar só o treinamento criado aqui
    // não bastaria pra liberar a exclusão do funcionário compartilhado.
    const employeeResult = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status)
       VALUES ($1, 'Funcionário Treinamento Delete Teste', '11122233344', 'ativo') RETURNING id`,
      [tenantId],
    );
    const dedicatedEmployeeId = employeeResult.rows[0].id;

    const training = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', dedicatedEmployeeId)
      .field('tipo', 'nr-18')
      .field('data_realizacao', '2026-01-10')
      .field('data_validade', '2027-01-10');
    expect(training.status).toBe(201);

    const delEmployee = await request(app.getHttpServer())
      .delete(`/employees/${dedicatedEmployeeId}`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(delEmployee.status).toBe(409);
    expect(delEmployee.body.message).toContain('histórico de treinamento');

    await request(app.getHttpServer())
      .delete(`/cipa/trainings/${training.body.id}`)
      .set('Authorization', `Bearer ${empresaToken}`);

    const delEmployeeDepois = await request(app.getHttpServer())
      .delete(`/employees/${dedicatedEmployeeId}`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(delEmployeeDepois.status).toBe(200);
  });
});
