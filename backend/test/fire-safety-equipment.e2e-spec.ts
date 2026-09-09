import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

function daysFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('Equipamentos contra incêndio (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Equipamentos Incendio');
    tenantId = tenant.tenantId;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = login.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('cria um extintor com todos os campos e devolve status "regular" pra manutenção distante', async () => {
    const res = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'extintor',
        codigo: 'EXT-001',
        localizacao: 'Recepção, térreo',
        proxima_manutencao: daysFromToday(200),
        agente_extintor: 'PQS',
        capacidade: '6kg',
        classe_fogo: 'ABC',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('regular');
    expect(res.body.agente_extintor).toBe('PQS');
  });

  it('devolve status "vencido" pra manutenção no passado e "vencendo" pra manutenção em 10 dias', async () => {
    const vencido = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'extintor', codigo: 'EXT-002', proxima_manutencao: daysFromToday(-5) });
    expect(vencido.body.status).toBe('vencido');

    const vencendo = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'hidrante', codigo: 'HID-001', proxima_manutencao: daysFromToday(10) });
    expect(vencendo.body.status).toBe('vencendo');
  });

  it('ignora silenciosamente campos de extintor quando o tipo não é extintor', async () => {
    const res = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'alarme', codigo: 'ALM-001', agente_extintor: 'PQS', capacidade: '6kg' });

    expect(res.status).toBe(201);
    expect(res.body.agente_extintor).toBeNull();
    expect(res.body.capacidade).toBeNull();
  });

  it('lista, edita e apaga um equipamento', async () => {
    const created = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'sprinkler', codigo: 'SPK-001' });
    const id = created.body.id;

    const listRes = await request(app.getHttpServer())
      .get('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.body.some((eq: any) => eq.id === id)).toBe(true);

    const updateRes = await request(app.getHttpServer())
      .patch(`/fire-safety-equipment/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ localizacao: 'Depósito' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.localizacao).toBe('Depósito');

    const deleteRes = await request(app.getHttpServer())
      .delete(`/fire-safety-equipment/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleteRes.status).toBe(200);

    const findRes = await request(app.getHttpServer())
      .get(`/fire-safety-equipment/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(findRes.status).toBe(404);
  });

  it('filtra por tipo e por status na query', async () => {
    await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'hidrante', codigo: 'HID-FILTRO', proxima_manutencao: daysFromToday(-1) });
    await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'extintor', codigo: 'EXT-FILTRO', proxima_manutencao: daysFromToday(200) });

    const porTipo = await request(app.getHttpServer())
      .get('/fire-safety-equipment?tipo=hidrante')
      .set('Authorization', `Bearer ${token}`);
    expect(porTipo.body.every((eq: any) => eq.tipo === 'hidrante')).toBe(true);
    expect(porTipo.body.some((eq: any) => eq.codigo === 'HID-FILTRO')).toBe(true);

    const porStatus = await request(app.getHttpServer())
      .get('/fire-safety-equipment?status=vencido')
      .set('Authorization', `Bearer ${token}`);
    expect(porStatus.body.every((eq: any) => eq.status === 'vencido')).toBe(true);
    expect(porStatus.body.some((eq: any) => eq.codigo === 'HID-FILTRO')).toBe(true);
    expect(porStatus.body.some((eq: any) => eq.codigo === 'EXT-FILTRO')).toBe(false);
  });

  it('rejeita company_unit_id de outro tenant', async () => {
    const otherTenant = await db.createTenantWithUser('Empresa Equipamentos Outro Tenant');
    const otherUnit = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Filial Outro Tenant', 'Rua X', 'Cidade X', 'SC', '88800000') RETURNING id`,
      [otherTenant.tenantId],
    );

    const res = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'extintor', codigo: 'EXT-003', company_unit_id: otherUnit.rows[0].id });

    expect(res.status).toBe(400);
  });

  it('tecnico cria equipamento informando tenant_id no body', async () => {
    const technicianUser = await db.createUserWithRole('tecnico', 'Tecnico Equipamentos Incendio');
    // RLS (assigned_tenant_ids_for_current_user()) só libera o INSERT pra um
    // tenant_id que o técnico está de fato vinculado via tenant_technicians —
    // mesmo padrão usado em epis-crud.e2e-spec.ts pro caminho técnico/parceiro.
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [technicianUser.userId],
    );
    const technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: technicianUser.email, password: technicianUser.password });
    const technicianToken = login.body.access_token;

    const res = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tipo: 'extintor', codigo: 'EXT-004', tenant_id: tenantId });

    expect(res.status).toBe(201);
    expect(res.body.tenant_id).toBe(tenantId);

    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
  });

  it('upload de foto grava o file_key e o equipamento passa a ter foto_r2_key', async () => {
    const created = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'extintor', codigo: 'EXT-005' });
    const id = created.body.id;

    const res = await request(app.getHttpServer())
      .post(`/fire-safety-equipment/${id}/foto`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('fake-image-bytes'), { filename: 'extintor.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.foto_r2_key).toContain(id);
  });

  it('GET /:id/foto devolve 404 quando o equipamento ainda não tem foto, e uma URL não-vazia depois do upload', async () => {
    const created = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'extintor', codigo: 'EXT-FOTO-DOWNLOAD' });
    const id = created.body.id;

    const beforeUpload = await request(app.getHttpServer())
      .get(`/fire-safety-equipment/${id}/foto`)
      .set('Authorization', `Bearer ${token}`);
    expect(beforeUpload.status).toBe(404);

    const uploadRes = await request(app.getHttpServer())
      .post(`/fire-safety-equipment/${id}/foto`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('fake-image-bytes'), { filename: 'extintor.jpg', contentType: 'image/jpeg' });
    expect(uploadRes.status).toBe(201);

    const afterUpload = await request(app.getHttpServer())
      .get(`/fire-safety-equipment/${id}/foto`)
      .set('Authorization', `Bearer ${token}`);
    expect(afterUpload.status).toBe(200);
    expect(typeof afterUpload.body.url).toBe('string');
    expect(afterUpload.body.url.length).toBeGreaterThan(0);
  });

  it('PATCH que muda tipo pra algo diferente de extintor não persiste agente_extintor mesmo enviado junto', async () => {
    const created = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'sprinkler', codigo: 'SPK-PATCH-001' });
    const id = created.body.id;

    const updateRes = await request(app.getHttpServer())
      .patch(`/fire-safety-equipment/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'alarme', agente_extintor: 'PQS' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.tipo).toBe('alarme');
    expect(updateRes.body.agente_extintor).toBeNull();
  });

  it('PATCH que muda o tipo de um extintor existente limpa os três campos de extintor pra null', async () => {
    const created = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'extintor',
        codigo: 'EXT-PATCH-TIPO',
        agente_extintor: 'PQS',
        capacidade: '6kg',
        classe_fogo: 'ABC',
      });
    const id = created.body.id;
    expect(created.body.agente_extintor).toBe('PQS');

    const updateRes = await request(app.getHttpServer())
      .patch(`/fire-safety-equipment/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'hidrante' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.tipo).toBe('hidrante');
    expect(updateRes.body.agente_extintor).toBeNull();
    expect(updateRes.body.capacidade).toBeNull();
    expect(updateRes.body.classe_fogo).toBeNull();
  });

  it('equipamento vencido aparece no dashboard existente como item de atenção', async () => {
    await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'extintor', codigo: 'EXT-DASHBOARD', proxima_manutencao: daysFromToday(-3) });

    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const equipmentItems = res.body.atencao.filter((i: any) => i.tipo === 'equipamento_incendio');
    expect(equipmentItems.length).toBeGreaterThan(0);
    expect(equipmentItems[0].prioridade).toBe('alta');
    expect(equipmentItems[0].link).toBe('/empresa/equipamentos-incendio');
  });
});
