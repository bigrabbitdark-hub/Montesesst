import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST /documents com inspection_id (Etapa 1 — Relatório de Visita Técnica, e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let companyUnitId: string;
  let inspectionId: string;
  let inspectionOtherTenantId: string;
  let technicianToken: string;
  let empresaToken: string;
  let createdDocumentId: string | undefined;
  const fileContent = '%PDF-1.4 conteudo valido de relatorio de visita';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Inspection Doc Upload Teste');
    tenantId = tenant.tenantId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Inspection Doc Upload Teste');
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    const technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    const loginTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = loginTech.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;

    // Inspeção do próprio tenant (do técnico, mesmo fluxo de qualquer inspeção real).
    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-09-15', company_unit_id: companyUnitId });
    inspectionId = createRes.body.id;

    // Inspeção de OUTRO tenant — pra testar a rejeição de cross-tenant.
    const otherTenant = await db.createTenantWithUser('Empresa Inspection Doc Upload Outra');
    inspectionOtherTenantId = (await (db as any).client.query(
      `INSERT INTO inspections (tenant_id, technician_user_id, visited_at)
       VALUES ($1, $2, '2026-09-15') RETURNING id`,
      [otherTenant.tenantId, createRes.body.technician_user_id],
    )).rows[0].id;
  });

  afterAll(async () => {
    if (createdDocumentId) {
      await (db as any).client.query('DELETE FROM documents WHERE id = $1', [createdDocumentId]);
    }
    await (db as any).client.query('DELETE FROM inspections WHERE id = $1', [inspectionId]);
    await (db as any).client.query('DELETE FROM inspections WHERE id = $1', [inspectionOtherTenantId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa anexa PDF vinculado à inspeção existente — 201, inspection_id gravado', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('category', 'relatorio_visita')
      .field('title', 'Relatório de Visita — 2026-09-15')
      .field('inspection_id', inspectionId)
      .attach('file', Buffer.from(fileContent, 'utf-8'), {
        filename: 'relatorio.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(201);
    expect(res.body.inspection_id).toBe(inspectionId);
    expect(res.body.category).toBe('relatorio_visita');
    expect(res.body.tenant_id).toBe(tenantId);
    createdDocumentId = res.body.id;

    // Garante que o vínculo está no banco, não só na resposta.
    const dbCheck = await (db as any).client.query(
      'SELECT inspection_id FROM documents WHERE id = $1',
      [createdDocumentId],
    );
    expect(dbCheck.rows[0].inspection_id).toBe(inspectionId);
  });

  it('rejeita upload sem arquivo (400) — preserva o comportamento atual da rota', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('category', 'relatorio_visita')
      .field('title', 'Sem arquivo')
      .field('inspection_id', inspectionId);

    expect(res.status).toBe(400);
  });

  it('rejeita arquivo cujo conteúdo não é PDF (400) — verifyFileContent', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('category', 'relatorio_visita')
      .field('title', 'Conteúdo inválido')
      .field('inspection_id', inspectionId)
      .attach('file', Buffer.from('isto não é um PDF de verdade'), {
        filename: 'falso.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(400);
  });

  it('rejeita inspection_id inexistente (400) — Inspeção inválida para esta empresa', async () => {
    const ghostId = randomUUID();
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('category', 'relatorio_visita')
      .field('title', 'Inspeção fantasma')
      .field('inspection_id', ghostId)
      .attach('file', Buffer.from(fileContent, 'utf-8'), {
        filename: 'relatorio-fantasma.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(400);
  });

  it('rejeita inspection_id pertencente a outro tenant (400) — defense in depth', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('category', 'relatorio_visita')
      .field('title', 'Inspeção de outro tenant')
      .field('inspection_id', inspectionOtherTenantId)
      .attach('file', Buffer.from(fileContent, 'utf-8'), {
        filename: 'cross-tenant.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(400);
  });

  it('preserva o upload de documentos sem inspection_id (regressão)', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('category', 'laudo')
      .field('title', 'Laudo sem inspeção')
      .attach('file', Buffer.from(fileContent, 'utf-8'), {
        filename: 'laudo-sem-inspecao.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(201);
    expect(res.body.inspection_id).toBeNull();

    await (db as any).client.query('DELETE FROM documents WHERE id = $1', [res.body.id]);
  });
});
