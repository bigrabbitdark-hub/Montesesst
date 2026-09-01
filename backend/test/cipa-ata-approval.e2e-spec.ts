import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { PDFParse } from 'pdf-parse';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST /cipa/meetings/:id/aprovar-ata, /reabrir-ata (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let userId: string;
  let companyUnitId: string;
  let committeeId: string;
  let meetingId: string;
  let memberId: string;
  let empresaToken: string;
  let s3: S3Client;
  let uploadedFileKey: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA Ata Approval Teste');
    tenantId = tenant.tenantId;
    userId = tenant.userId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const committeeResult = await (db as any).client.query(
      `INSERT INTO cipa_committees (tenant_id, company_unit_id, ano, data_inicio, data_termino, responsavel_user_id)
       VALUES ($1, $2, 2026, '2026-01-01', '2026-12-31', $3) RETURNING id`,
      [tenantId, companyUnitId, userId],
    );
    committeeId = committeeResult.rows[0].id;

    const meetingResult = await (db as any).client.query(
      `INSERT INTO cipa_meetings (tenant_id, committee_id, company_unit_id, tipo, titulo, data, pauta, discussoes, deliberacoes)
       VALUES ($1, $2, $3, 'extraordinaria', 'Reunião Teste Ata', '2026-03-10', 'Pauta teste', 'Discussão teste', 'Deliberação teste')
       RETURNING id`,
      [tenantId, committeeId, companyUnitId],
    );
    meetingId = meetingResult.rows[0].id;

    // Membro real, cadastrado — regressão da Fix 3: antes desta correção,
    // o PDF só conseguia imprimir "(membro da CIPA)" pra qualquer
    // participante que fosse um cipa_member_id (join ausente na query).
    const memberResult = await (db as any).client.query(
      `INSERT INTO cipa_members (tenant_id, company_unit_id, nome, funcao_cipa, titular_suplente, representacao, inicio_mandato, fim_mandato)
       VALUES ($1, $2, 'Fulano de Tal Aprovação Ata', 'membro', 'titular', 'empregados', '2026-01-01', '2027-12-31')
       RETURNING id`,
      [tenantId, companyUnitId],
    );
    memberId = memberResult.rows[0].id;

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
  });

  afterAll(async () => {
    // Achado da revisão final (Minor bundled fix): sem isso, o PDF gerado
    // por cada rodada de teste ficava órfão no bucket real do R2 pra
    // sempre. Mesmo padrão de documents-upload.e2e-spec.ts.
    if (uploadedFileKey) {
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: uploadedFileKey }));
    }
    await (db as any).client.query('DELETE FROM documents WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM cipa_committees WHERE id = $1', [committeeId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa registra participante e aprova a ata → 200, grava aprovador/data/ata_document_id, gera PDF com data e nome do membro corretos', async () => {
    const participantsRes = await request(app.getHttpServer())
      .put(`/cipa/meetings/${meetingId}/participants`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ participants: [{ cipa_member_id: memberId, presente: true }] });
    expect(participantsRes.status).toBe(200);

    const res = await request(app.getHttpServer())
      .post(`/cipa/meetings/${meetingId}/aprovar-ata`)
      .set('Authorization', `Bearer ${empresaToken}`);

    // @Post retorna 201 por padrão no NestJS — mesmo padrão das rotas de
    // ação análogas em normative-documents.controller.ts (approve/reject),
    // cujos próprios testes e2e também esperam 201, não 200.
    expect(res.status).toBe(201);
    expect(res.body.status_ata).toBe('aprovada');
    expect(res.body.aprovado_por_user_id).toBe(userId);
    expect(res.body.aprovado_em).toBeTruthy();
    // Fix 8b: aprovar grava o link pra o documento gerado.
    expect(res.body.ata_document_id).toBeTruthy();

    const docResult = await (db as any).client.query(
      `SELECT * FROM documents WHERE tenant_id = $1 AND category = 'cipa_ata'`,
      [tenantId],
    );
    expect(docResult.rows).toHaveLength(1);
    expect(docResult.rows[0].mime_type).toBe('application/pdf');
    // Fix 8a: documento gerado precisa vir com o company_unit_id da
    // reunião de origem, não solto.
    expect(docResult.rows[0].company_unit_id).toBe(companyUnitId);
    expect(docResult.rows[0].id).toBe(res.body.ata_document_id);
    uploadedFileKey = docResult.rows[0].file_key;

    // Regressão real das Fixes 2 e 3 — baixa o PDF de verdade do R2 (não
    // um mock) e confirma que o texto extraído tem a data da reunião em
    // formato YYYY-MM-DD (não um fragmento de Date.toString(), tipo "Tue
    // Mar 10 2026...") e o nome do membro cadastrado de verdade (não o
    // placeholder "(membro da CIPA)").
    const getRes = await s3.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: uploadedFileKey }));
    const bytes = await getRes.Body!.transformToByteArray();
    const parser = new PDFParse({ data: Buffer.from(bytes) });
    let text: string;
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }

    expect(text).toContain('2026-03-10');
    expect(text).toContain('Fulano de Tal Aprovação Ata');
    expect(text).not.toContain('(membro da CIPA)');
  });

  it('aprovar de novo uma ata já aprovada → 409 (guard do próprio approveAta, não o do update())', async () => {
    const res = await request(app.getHttpServer())
      .post(`/cipa/meetings/${meetingId}/aprovar-ata`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(409);

    // Guard rejeita antes de gerar/subir um novo PDF — continua existindo
    // só o documento da primeira aprovação, nenhum duplicado.
    const docResult = await (db as any).client.query(
      `SELECT * FROM documents WHERE tenant_id = $1 AND category = 'cipa_ata'`,
      [tenantId],
    );
    expect(docResult.rows).toHaveLength(1);
  });

  it('editar depois de aprovada → 409', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/cipa/meetings/${meetingId}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ pauta: 'Tentando editar depois de aprovada' });

    expect(res.status).toBe(409);
  });

  it('editar participantes depois de aprovada → 409 (Fix 1 — Critical: rota de participantes não tinha guard nenhum)', async () => {
    const res = await request(app.getHttpServer())
      .put(`/cipa/meetings/${meetingId}/participants`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ participants: [{ nome_livre: 'Tentando editar participantes depois de aprovada', presente: true }] });

    expect(res.status).toBe(409);
  });

  it('reabrir volta pra rascunho, zera ata_document_id, e permite editar de novo', async () => {
    const reopenRes = await request(app.getHttpServer())
      .post(`/cipa/meetings/${meetingId}/reabrir-ata`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(reopenRes.status).toBe(201);
    expect(reopenRes.body.status_ata).toBe('rascunho');
    // Fix 8b: reabrir zera o link — reaprovar depois gera um documento
    // novo com um ata_document_id novo, sem o antigo (stale) ser tratado
    // como "o" atual.
    expect(reopenRes.body.ata_document_id).toBeNull();

    const editRes = await request(app.getHttpServer())
      .patch(`/cipa/meetings/${meetingId}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ pauta: 'Editado depois de reabrir' });
    expect(editRes.status).toBe(200);
    expect(editRes.body.pauta).toBe('Editado depois de reabrir');

    const editParticipantsRes = await request(app.getHttpServer())
      .put(`/cipa/meetings/${meetingId}/participants`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ participants: [{ cipa_member_id: memberId, presente: false }] });
    expect(editParticipantsRes.status).toBe(200);
  });
});
