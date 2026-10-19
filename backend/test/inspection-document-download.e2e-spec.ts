import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

// Etapa 1 do Relatório de Visita Técnica: download do PDF anexado a
// uma inspeção. O conteúdo do objeto no R2 precisa estar íntegro
// depois de todas as camadas (verifyFileContent -> R2 putObject ->
// INSERT com inspection_id). Reusa o mesmo padrão de
// documents-download-delete.e2e-spec.ts (URL presigned + fetch real).
describe('Download de documento anexado a uma inspeção (Etapa 1, e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let companyUnitId: string;
  let inspectionId: string;
  let documentId: string;
  let fileKey: string;
  let empresaToken: string;
  let s3: S3Client;
  const fileContent = '%PDF-1.4 relatorio de visita via download';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Inspection Doc Download Teste');
    tenantId = tenant.tenantId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Inspection Doc Download Teste');
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    const technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );
    const techToken = (await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password })).body.access_token;

    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-09-15', company_unit_id: companyUnitId });
    inspectionId = createRes.body.id;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;

    s3 = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });

    const uploadRes = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('category', 'relatorio_visita')
      .field('title', 'Relatório de Visita — 2026-09-15')
      .field('inspection_id', inspectionId)
      .attach('file', Buffer.from(fileContent, 'utf-8'), {
        filename: 'relatorio.pdf',
        contentType: 'application/pdf',
      });
    documentId = uploadRes.body.id;
    fileKey = uploadRes.body.file_key;
  });

  afterAll(async () => {
    // Garante limpeza do R2 mesmo se o teste falhar no meio.
    try {
      await s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: fileKey }));
    } catch {
      // já foi apagado
    }
    await (db as any).client.query('DELETE FROM documents WHERE id = $1', [documentId]);
    await (db as any).client.query('DELETE FROM inspections WHERE id = $1', [inspectionId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa baixa o PDF anexado: URL presigned devolve o conteúdo original', async () => {
    const res = await request(app.getHttpServer())
      .get(`/documents/${documentId}/download`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toContain(process.env.R2_ACCOUNT_ID!);
    expect(res.body.file_name).toBe('relatorio.pdf');

    const downloadRes = await fetch(res.body.url);
    const downloadedContent = await downloadRes.text();
    expect(downloadedContent).toBe(fileContent);
  });

  it('GET /inspections/:id expõe o documento na lista documentos_anexos com os campos da UI', async () => {
    const res = await request(app.getHttpServer())
      .get(`/inspections/${inspectionId}`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.documentos_anexos).toHaveLength(1);
    const anexo = res.body.documentos_anexos[0];
    expect(anexo.id).toBe(documentId);
    expect(anexo.title).toBe('Relatório de Visita — 2026-09-15');
    expect(anexo.file_name).toBe('relatorio.pdf');
    expect(anexo.mime_type).toBe('application/pdf');
    expect(anexo.size_bytes).toBeGreaterThan(0);
    // Projeção reduzida intencionalmente: sem file_key, sem expires_at, sem company_unit_id.
    expect(anexo.file_key).toBeUndefined();
    expect(anexo.tenant_id).toBeUndefined();
  });
});
