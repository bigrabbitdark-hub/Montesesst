import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { PDFParse } from 'pdf-parse';
import { AppModule } from '../src/app.module';
import { R2Service } from '../src/common/r2/r2.service';
import { DocumentsService } from '../src/documents/documents.service';
import { TestDb } from './db-test-helper';

describe('POST /inspections/:id/concluir — gera PDF e indexa como Document (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let token: string;
  let companyUnitId: string;
  let technicianId: string;
  let s3: S3Client;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Inspection PDF Teste');
    tenantId = tenant.tenantId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_number, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz PDF Teste', 'Rua das Flores', '42', 'São Paulo', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    // POST /inspections e /concluir exigem @Roles('tecnico', 'parceiro')
    // (inspections.controller.ts) — o usuário 'empresa' de
    // createTenantWithUser recebe 403 nessas rotas. Mesmo padrão de
    // técnico vinculado usado em inspections-conclude.e2e-spec.ts.
    const tech = await db.createUserWithRole('tecnico', 'Tecnico Inspection PDF Teste');
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    token = loginRes.body.access_token;

    s3 = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
      },
    });
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM inspections WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('concluir gera um Document real (categoria relatorio_visita) com o conteúdo certo', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tenant_id: tenantId,
        visited_at: '2026-09-15',
        company_unit_id: companyUnitId,
        started_at: '08:00',
        ended_at: '10:30',
      });
    expect(createRes.status).toBe(201);
    const inspectionId = createRes.body.id;
    const firstItem = createRes.body.items[0];

    await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${firstItem.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'NC', notes: 'Extintor vencido' });

    const concludeRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${token}`);
    expect(concludeRes.status).toBe(201);
    expect(concludeRes.body.status).toBe('concluida');

    const docResult = await (db as any).client.query(
      `SELECT * FROM documents WHERE tenant_id = $1 AND category = 'relatorio_visita'`,
      [tenantId],
    );
    expect(docResult.rows).toHaveLength(1);
    expect(docResult.rows[0].mime_type).toBe('application/pdf');
    expect(docResult.rows[0].company_unit_id).toBe(companyUnitId);

    const getRes = await s3.send(
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: docResult.rows[0].file_key }),
    );
    const bytes = await getRes.Body!.transformToByteArray();
    const parser = new PDFParse({ data: Buffer.from(bytes) });
    let text: string;
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }

    expect(text).toContain('Empresa Inspection PDF Teste');
    expect(text).toContain('Rua das Flores, 42 — São Paulo/SP');
    expect(text).toContain('2026-09-15');
    expect(text).toContain('08:00');
    expect(text).toContain('10:30');
    expect(text).toContain('Extintor vencido');
  });

  it('filial apagada depois da inspeção criada: PDF é gerado com "endereço não informado", sem quebrar', async () => {
    // ON DELETE SET NULL (spec §6) — a inspeção sobrevive, company_unit_id
    // vira null. Isto testa esse caso de borda específico (endereço
    // ausente é tratado graciosamente), NÃO o try/catch de resiliência a
    // falha real — nesse caminho a geração do PDF continua tendo
    // sucesso (só sem endereço), não lança nada pra o catch pegar. O
    // teste de resiliência de verdade (R2 falhando) é o describe
    // separado logo abaixo, com provider sobreposto.
    const tempUnitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Filial Temporária', 'Rua Temp', 'Cidade Temp', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    const tempUnitId = tempUnitResult.rows[0].id;

    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${token}`)
      .send({ tenant_id: tenantId, visited_at: '2026-09-15', company_unit_id: tempUnitId });
    const inspectionId = createRes.body.id;

    await (db as any).client.query('DELETE FROM company_units WHERE id = $1', [tempUnitId]);

    const concludeRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${token}`);

    expect(concludeRes.status).toBe(201);
    expect(concludeRes.body.status).toBe('concluida');

    const docResult = await (db as any).client.query(
      `SELECT * FROM documents WHERE tenant_id = $1 AND category = 'relatorio_visita' AND title LIKE '%2026-09-15%' ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    expect(docResult.rows).toHaveLength(1);
    const getRes = await s3.send(
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: docResult.rows[0].file_key }),
    );
    const bytes = await getRes.Body!.transformToByteArray();
    const parser = new PDFParse({ data: Buffer.from(bytes) });
    let text: string;
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
    expect(text).toContain('Endereço: não informado');
  });
});

// Describe separado: sobrepõe R2Service pra forçar uma falha REAL de
// upload (não um caso de borda de dado, um erro de infraestrutura de
// verdade) e confirma que conclude() nunca deixa isso derrubar a
// conclusão da inspeção (spec §6, "nunca lança" por causa do PDF).
describe('POST /inspections/:id/concluir — resiliência real a falha de upload do PDF (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let token: string;
  let companyUnitId: string;
  let technicianId: string;
  const fakePutObject = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2Service)
      .useValue({ putObject: fakePutObject, getObject: jest.fn(), getPresignedDownloadUrl: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Inspection PDF Falha Teste');
    tenantId = tenant.tenantId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Falha Teste', 'Rua Falha', 'Cidade Falha', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    // Mesmo motivo do describe anterior: rotas exigem tecnico/parceiro.
    const tech = await db.createUserWithRole('tecnico', 'Tecnico Inspection PDF Falha Teste');
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    token = loginRes.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM inspections WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('R2 fora do ar durante o upload do PDF: inspeção ainda assim é concluída com sucesso', async () => {
    fakePutObject.mockRejectedValue(new Error('R2 fora do ar (simulado)'));

    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${token}`)
      .send({ tenant_id: tenantId, visited_at: '2026-09-15', company_unit_id: companyUnitId });
    const inspectionId = createRes.body.id;

    const concludeRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${token}`);

    // A parte crítica (mudar status, gerar action_plans) precisa ter
    // sucesso mesmo com o R2 rejeitando toda chamada de putObject.
    expect(concludeRes.status).toBe(201);
    expect(concludeRes.body.status).toBe('concluida');

    const docResult = await (db as any).client.query(
      `SELECT * FROM documents WHERE tenant_id = $1 AND category = 'relatorio_visita'`,
      [tenantId],
    );
    expect(docResult.rows).toHaveLength(0);
  });
});

// Describe separado: sobrepõe DocumentsService inteiro com uma versão cujo
// upload() executa uma query SQL de verdade inválida (relação inexistente)
// ANTES de lançar — reproduz um erro real de Postgres (não rede/R2, esse já
// está coberto pelo describe acima) acontecendo dentro do MESMO client/
// transação compartilhada pelo resto de conclude(). Uma query assim aborta
// a transação inteira (25P02 "current transaction is aborted"): sem o
// SAVEPOINT em conclude(), o COMMIT final do withTenantContext viraria um
// ROLLBACK silencioso, desfazendo o UPDATE de status e os INSERTs de
// action_plans já aplicados — a API responderia 201 "concluida" mas o banco
// reverteria pra "rascunho" sem action_plans (achado 1 da revisão final).
describe('POST /inspections/:id/concluir — resiliência a erro de SQL dentro da transação compartilhada (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let token: string;
  let companyUnitId: string;
  let technicianId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DocumentsService)
      .useValue({
        upload: async (client: any) => {
          // Erro de SQL real (relação inexistente) na mesma transação —
          // um CHECK constraint ou FK violado teria o mesmo efeito de
          // abortar a transação; esta é a forma mais direta de
          // reproduzir isso sem depender de dado inválido específico.
          await client.query('SELECT * FROM tabela_inexistente_de_proposito_neste_teste');
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Inspection SQL Erro Teste');
    tenantId = tenant.tenantId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz SQL Erro Teste', 'Rua Erro', 'Cidade Erro', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    // Mesmo motivo dos describes anteriores: rotas exigem tecnico/parceiro.
    const tech = await db.createUserWithRole('tecnico', 'Tecnico Inspection SQL Erro Teste');
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    token = loginRes.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM inspections WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('erro de SQL dentro do bloco de PDF não reverte a conclusão nem os action_plans (sem ROLLBACK silencioso)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${token}`)
      .send({ tenant_id: tenantId, visited_at: '2026-09-15', company_unit_id: companyUnitId });
    expect(createRes.status).toBe(201);
    const inspectionId = createRes.body.id;
    const firstItem = createRes.body.items[0];

    await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${firstItem.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'NC', notes: 'Saída de emergência bloqueada' });

    const concludeRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${token}`);

    // A parte crítica (status + action_plans) precisa ter sucesso mesmo
    // com a transação tendo sido abortada no meio do caminho pela query
    // SQL inválida do fake upload.
    expect(concludeRes.status).toBe(201);
    expect(concludeRes.body.status).toBe('concluida');
    expect(concludeRes.body.action_plans).toHaveLength(1);

    // Confirma direto no banco (nova conexão/query, não a mesma
    // transação da requisição) que o COMMIT realmente aconteceu — não um
    // ROLLBACK silencioso disfarçado de 201 na resposta HTTP.
    const inspectionRow = await (db as any).client.query('SELECT status FROM inspections WHERE id = $1', [
      inspectionId,
    ]);
    expect(inspectionRow.rows[0].status).toBe('concluida');

    const actionPlansRow = await (db as any).client.query(
      'SELECT * FROM action_plans WHERE inspection_id = $1',
      [inspectionId],
    );
    expect(actionPlansRow.rows).toHaveLength(1);
    expect(actionPlansRow.rows[0].description).toBe(firstItem.item_label);

    // E o documento não foi indexado (upload falhou de propósito).
    const docResult = await (db as any).client.query(
      `SELECT * FROM documents WHERE tenant_id = $1 AND category = 'relatorio_visita'`,
      [tenantId],
    );
    expect(docResult.rows).toHaveLength(0);
  });
});
