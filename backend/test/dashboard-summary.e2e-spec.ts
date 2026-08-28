import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /dashboard/summary (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  let epiCatalogItemId: string;
  let userId: string;

  function iso(daysFromToday: number): string {
    const d = new Date();
    d.setDate(d.getDate() + daysFromToday);
    return d.toISOString().slice(0, 10);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Dashboard Summary Teste');
    tenantId = tenant.tenantId;
    userId = tenant.userId;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;

    const catalogRes = await (db as any).client.query(
      'SELECT id FROM epi_catalog_items LIMIT 1',
    );
    epiCatalogItemId = catalogRes.rows[0].id;
  });

  afterAll(async () => {
    // Tenant é apagado em CASCADE por db.cleanup(), o que já leva junto
    // documents/tenant_epis/action_plans/inspections desta fixture — sem
    // necessidade de limpeza manual adicional.
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('bloqueia tecnico/parceiro/admin com 403 (rota exclusiva de empresa)', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Dashboard Summary Teste');
    const loginTecnico = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tecnico.email, password: tecnico.password });

    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${loginTecnico.body.access_token}`);
    expect(res.status).toBe(403);
  });

  it('empresa sem nenhuma pendência recebe status ok e listas vazias', async () => {
    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.resumo.pendencias).toBe(0);
    expect(res.body.resumo.avisos).toBe(0);
    expect(res.body.atencao).toEqual([]);
    expect(res.body.proximos_eventos).toEqual([]);
    expect(typeof res.body.updated_at).toBe('string');
  });

  it('agrega documento vencido, EPI vencendo e ação pendente em critico com itens de atenção corretos', async () => {
    const client = (db as any).client;

    const docRes = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR vencido teste', 'fixture/pgr-vencido.pdf', 'pgr-vencido.pdf', 'application/pdf', 100, $2, $3, 'empresa')
       RETURNING id`,
      [tenantId, iso(-5), userId],
    );

    await client.query(
      `INSERT INTO tenant_epis (tenant_id, epi_catalog_item_id, ca_number, ca_valid_until, created_by_user_id)
       VALUES ($1, $2, '99999', $3, $4)`,
      [tenantId, epiCatalogItemId, iso(5), userId],
    );

    const inspRes = await client.query(
      `INSERT INTO inspections (tenant_id, technician_user_id, status, visited_at)
       VALUES ($1, $2, 'rascunho', CURRENT_DATE) RETURNING id`,
      [tenantId, userId],
    );

    await client.query(
      `INSERT INTO action_plans (tenant_id, inspection_id, description, deadline, status)
       VALUES ($1, $2, 'Instalar corrimão na escada', $3, 'pendente')`,
      [tenantId, inspRes.rows[0].id, iso(3)],
    );

    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('critico');
    expect(res.body.resumo.pendencias).toBe(1);
    expect(res.body.resumo.avisos).toBe(1);
    expect(res.body.resumo.inspecoes_pendentes).toBe(1);

    const titulos: string[] = res.body.atencao.map((item: any) => item.titulo);
    expect(titulos.some((t) => t.includes('PGR vencido teste'))).toBe(true);
    expect(titulos.some((t) => t.includes('CA 99999'))).toBe(true);
    expect(titulos.some((t) => t.includes('corrimão'))).toBe(true);

    const docItem = res.body.atencao.find((item: any) => item.tipo === 'documento');
    expect(docItem.prioridade).toBe('alta');
    expect(docItem.responsavel).toBe('empresa');

    const acaoItem = res.body.atencao.find((item: any) => item.tipo === 'acao');
    expect(acaoItem.prioridade).toBe('media');

    // EPI vencendo em 5 dias e ação com prazo em 3 dias caem nos próximos 7 dias
    const eventoTipos = res.body.proximos_eventos.map((item: any) => item.tipo);
    expect(eventoTipos).toEqual(expect.arrayContaining(['epi', 'acao']));

    await client.query('DELETE FROM documents WHERE id = $1', [docRes.rows[0].id]);
  });
});
