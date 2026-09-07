import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /positions/:id (divergência) e integração com o dashboard (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  let positionId: string;
  let employeeId: string;
  let epiCatalogItemId: string;
  let epiCatalogItemId2: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Divergencia Cargo');
    tenantId = tenant.tenantId;
    employeeId = tenant.employeeId;
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;

    const positionRes = await request(app.getHttpServer())
      .post('/positions')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Eletricista Divergencia' });
    positionId = positionRes.body.id;

    await (db as any).client.query('UPDATE employees SET position_id = $1 WHERE id = $2', [positionId, employeeId]);

    const catalogRows = await (db as any).client.query('SELECT id FROM epi_catalog_items ORDER BY code LIMIT 2');
    epiCatalogItemId = catalogRows.rows[0].id;
    epiCatalogItemId2 = catalogRows.rows[1].id;

    await request(app.getHttpServer())
      .put(`/positions/${positionId}/epi-requirements`)
      .set('Authorization', `Bearer ${token}`)
      .send({ epi_catalog_item_ids: [epiCatalogItemId, epiCatalogItemId2] });

    await request(app.getHttpServer())
      .put(`/positions/${positionId}/training-requirements`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipos: ['nr-35'] });

    // Cadastra o item 1 no catálogo da empresa e entrega pro funcionário —
    // esse item fica "atendido". O item 2 nunca é cadastrado pela empresa —
    // fica divergente com empresa_tem_no_catalogo=false. Treinamento nr-35
    // nunca é feito — fica divergente sem esse campo.
    const tenantEpiRes = await request(app.getHttpServer())
      .post('/epis')
      .set('Authorization', `Bearer ${token}`)
      .send({ epi_catalog_item_id: epiCatalogItemId, ca_number: '12345' });

    await request(app.getHttpServer())
      .post(`/epis/${tenantEpiRes.body.id}/deliveries`)
      .set('Authorization', `Bearer ${token}`)
      .send({ employee_id: employeeId, delivered_at: '2026-01-01', signed_by_name: 'Assinante Teste' });
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('GET /positions/:id mostra 1 requisito atendido e 2 divergentes (1 EPI sem cadastro, 1 treinamento nunca feito)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/positions/${positionId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.employees).toHaveLength(1);
    const employee = res.body.employees[0];
    expect(employee.divergences).toHaveLength(2);

    const epiDivergence = employee.divergences.find((d: any) => d.categoria === 'epi');
    expect(epiDivergence.empresa_tem_no_catalogo).toBe(false);

    const trainingDivergence = employee.divergences.find((d: any) => d.categoria === 'treinamento');
    expect(trainingDivergence.requisito).toBe('nr-35');
  });

  it('GET /positions devolve divergence_count > 0 pro cargo com pendência', async () => {
    const res = await request(app.getHttpServer())
      .get('/positions')
      .set('Authorization', `Bearer ${token}`);

    const position = res.body.find((p: any) => p.id === positionId);
    expect(position.divergence_count).toBe(2);
  });

  it('dashboard existente lista as mesmas divergências como itens de atenção prioridade alta', async () => {
    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const cargoItems = res.body.atencao.filter((i: any) => i.tipo === 'cargo');
    expect(cargoItems.length).toBe(2);
    expect(cargoItems.every((i: any) => i.prioridade === 'alta' && i.link === '/empresa/mapa-sst')).toBe(true);
    expect(res.body.status).toBe('critico');
  });
});
