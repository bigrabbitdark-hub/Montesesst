import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('PATCH /inspections/:id e /inspections/:id/items/:itemId (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let companyUnitId: string;
  let technicianId: string;
  let technicianToken: string;
  let empresaToken: string;
  let inspectionId: string;
  let itemId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Inspection Update Teste');
    tenantId = tenant.tenantId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Inspection Update Teste');
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
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

    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25', company_unit_id: companyUnitId });
    inspectionId = createRes.body.id;
    itemId = createRes.body.items[0].id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM inspections WHERE id = $1', [inspectionId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('rejeita empresa tentando editar o cabeçalho ou um item (403) — só técnico edita', async () => {
    const headerRes = await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ company_contact: 'Tentativa indevida' });
    expect(headerRes.status).toBe(403);

    const itemRes = await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${itemId}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ status: 'C' });
    expect(itemRes.status).toBe(403);
  });

  it('atualiza o cabeçalho e grava o carimbo de assinatura junto do nome', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ company_contact: 'João da Silva', technician_signature_name: 'Maria Técnica' });

    expect(res.status).toBe(200);
    expect(res.body.company_contact).toBe('João da Silva');
    expect(res.body.technician_signature_name).toBe('Maria Técnica');
    expect(res.body.technician_signature_at).not.toBeNull();
  });

  it('grava started_at/ended_at e o GET devolve HH:MM (não HH:MM:SS)', async () => {
    const patchRes = await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ started_at: '08:00', ended_at: '10:30' });
    expect(patchRes.status).toBe(200);

    const getRes = await request(app.getHttpServer())
      .get(`/inspections/${inspectionId}`)
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(getRes.status).toBe(200);
    // started_at/ended_at são coluna TIME — node-pg devolve "HH:MM:SS",
    // mas o DTO de update só aceita "HH:MM" (@Matches). Sem normalizar em
    // findOne(), reabrir a tela de detalhe e reenviar o PATCH sem tocar
    // no <input type="time"> (que só entende HH:MM) batia em 400 —
    // achado 2 da revisão final.
    expect(getRes.body.started_at).toBe('08:00');
    expect(getRes.body.ended_at).toBe('10:30');
  });

  it('esvaziar started_at/ended_at (string vazia) retorna 200 e limpa pra null, não 400', async () => {
    // Cenário real: campo de horário já preenchido, usuário apaga e tira
    // o foco (onBlur) — o frontend manda "". @IsOptional() sozinho só
    // trata undefined/null como "ausente", então "" cairia no @Matches e
    // voltaria 400, tornando impossível esvaziar o campo — achado 3.
    const res = await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ started_at: '', ended_at: '' });

    expect(res.status).toBe(200);
    expect(res.body.started_at).toBeNull();
    expect(res.body.ended_at).toBeNull();
  });

  it('atualiza um item de checklist', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${itemId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'NC', notes: 'Ficha vencida' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('NC');
    expect(res.body.notes).toBe('Ficha vencida');
  });

  it('rejeita edição depois de concluída (409), no cabeçalho e no item', async () => {
    const concludeRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(concludeRes.status).toBe(201);

    const headerRes = await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ company_contact: 'Outro nome' });
    expect(headerRes.status).toBe(409);

    const itemRes = await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${itemId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'C' });
    expect(itemRes.status).toBe(409);
  });
});
