import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DocumentsService } from '../src/documents/documents.service';
import { TestDb } from './db-test-helper';

describe('Inspeções — NRs aplicáveis (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let companyUnitId: string;
  let technicianId: string;
  let technicianToken: string;
  let empresaToken: string;
  const client = () => (db as any).client;
  const http = () => request(app.getHttpServer());

  async function novaInspecao(): Promise<string> {
    const res = await http()
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-10-01', company_unit_id: companyUnitId });
    return res.body.id;
  }
  async function vigentes(): Promise<string[]> {
    const r = await client().query(
      `SELECT nr_code FROM company_applicable_nrs WHERE tenant_id = $1 AND unmarked_at IS NULL ORDER BY nr_code`,
      [tenantId],
    );
    return r.rows.map((x: any) => x.nr_code);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Inspecao NR Teste');
    tenantId = tenant.tenantId;
    const unit = await client().query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unit.rows[0].id;
    const tech = await db.createUserWithRole('tecnico', 'Tecnico Inspecao NR Teste');
    const t = await client().query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tech.userId]);
    technicianId = t.rows[0].id;
    await client().query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [tenantId, technicianId]);
    const lt = await http().post('/auth/login').send({ email: tech.email, password: tech.password });
    technicianToken = lt.body.access_token;
    const le = await http().post('/auth/login').send({ email: tenant.email, password: tenant.password });
    empresaToken = le.body.access_token;
  });

  afterAll(async () => {
    await client().query('DELETE FROM company_applicable_nrs WHERE tenant_id = $1', [tenantId]);
    await client().query('DELETE FROM inspections WHERE tenant_id = $1', [tenantId]);
    await client().query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await client().query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('PATCH grava o rascunho em nrs_aplicaveis e o GET devolve a lista', async () => {
    const id = await novaInspecao();
    const patch = await http().patch(`/inspections/${id}`).set('Authorization', `Bearer ${technicianToken}`).send({ nrs_aplicaveis: ['NR-1', 'NR-5'] });
    expect(patch.status).toBe(200);
    expect(patch.body.nrs_aplicaveis).toEqual(['NR-1', 'NR-5']);
    const get = await http().get(`/inspections/${id}`).set('Authorization', `Bearer ${technicianToken}`);
    expect(get.body.nrs_aplicaveis).toEqual(['NR-1', 'NR-5']);
    expect(await vigentes()).toEqual([]); // rascunho NÃO grava aplicabilidade ainda
  });

  it('PATCH combinando nrs_aplicaveis com outros campos (índices $n e carimbo da assinatura)', async () => {
    const id = await novaInspecao();
    const patch = await http()
      .patch(`/inspections/${id}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ nrs_aplicaveis: ['NR-1'], dds_topic: 'Tema teste', technician_signature_name: 'Tecnico Teste' });
    expect(patch.status).toBe(200);
    expect(patch.body.nrs_aplicaveis).toEqual(['NR-1']);
    expect(patch.body.dds_topic).toBe('Tema teste');
    expect(patch.body.technician_signature_at).toBeTruthy();
  });

  it('rejeita NR fora do catálogo (400) e lista com duplicata (400)', async () => {
    const id = await novaInspecao();
    const fora = await http().patch(`/inspections/${id}`).set('Authorization', `Bearer ${technicianToken}`).send({ nrs_aplicaveis: ['NR-99'] });
    expect(fora.status).toBe(400);
    const dup = await http().patch(`/inspections/${id}`).set('Authorization', `Bearer ${technicianToken}`).send({ nrs_aplicaveis: ['NR-1', 'NR-1'] });
    expect(dup.status).toBe(400);
  });

  it('empresa não marca NR (403): só técnico/parceiro edita a inspeção', async () => {
    const id = await novaInspecao();
    const res = await http().patch(`/inspections/${id}`).set('Authorization', `Bearer ${empresaToken}`).send({ nrs_aplicaveis: ['NR-1'] });
    expect(res.status).toBe(403);
  });

  it('concluir aplica o rascunho: insere as NRs com autoria e visita de origem', async () => {
    const id = await novaInspecao();
    await http().patch(`/inspections/${id}`).set('Authorization', `Bearer ${technicianToken}`).send({ nrs_aplicaveis: ['NR-1', 'NR-5'] });
    const done = await http().post(`/inspections/${id}/concluir`).set('Authorization', `Bearer ${technicianToken}`);
    expect(done.status).toBeLessThan(300);
    expect(await vigentes()).toEqual(['NR-1', 'NR-5']);
    const r = await client().query(
      `SELECT source_inspection_id, marked_by_user_id FROM company_applicable_nrs WHERE tenant_id = $1 AND nr_code = 'NR-1' AND unmarked_at IS NULL`,
      [tenantId],
    );
    expect(r.rows[0].source_inspection_id).toBe(id);
    expect(r.rows[0].marked_by_user_id).toBeTruthy();
  });

  it('nova visita que desmarca NR-5 e adiciona NR-7: NR-5 recebe unmarked_at, NR-1 não duplica', async () => {
    const id = await novaInspecao();
    await http().patch(`/inspections/${id}`).set('Authorization', `Bearer ${technicianToken}`).send({ nrs_aplicaveis: ['NR-1', 'NR-7'] });
    await http().post(`/inspections/${id}/concluir`).set('Authorization', `Bearer ${technicianToken}`);
    expect(await vigentes()).toEqual(['NR-1', 'NR-7']);
    const hist = await client().query(
      `SELECT count(*)::int AS n FROM company_applicable_nrs WHERE tenant_id = $1 AND nr_code = 'NR-5' AND unmarked_at IS NOT NULL`,
      [tenantId],
    );
    expect(hist.rows[0].n).toBe(1); // desmarcar não apaga: o histórico fica
    const nr1 = await client().query(`SELECT count(*)::int AS n FROM company_applicable_nrs WHERE tenant_id = $1 AND nr_code = 'NR-1'`, [tenantId]);
    expect(nr1.rows[0].n).toBe(1);
  });

  it('visita em que o técnico não mexeu no bloco (NULL) não altera a aplicabilidade', async () => {
    const antes = await vigentes();
    const id = await novaInspecao();
    const done = await http().post(`/inspections/${id}/concluir`).set('Authorization', `Bearer ${technicianToken}`);
    expect(done.status).toBeLessThan(300);
    expect(await vigentes()).toEqual(antes);
  });

  it('lista vazia explícita desmarca tudo', async () => {
    const id = await novaInspecao();
    await http().patch(`/inspections/${id}`).set('Authorization', `Bearer ${technicianToken}`).send({ nrs_aplicaveis: [] });
    await http().post(`/inspections/${id}/concluir`).set('Authorization', `Bearer ${technicianToken}`);
    expect(await vigentes()).toEqual([]);
  });

  it('a marcação persiste mesmo se o PDF não puder ser gerado/indexado (ordem antes do SAVEPOINT)', async () => {
    // Força deterministicamente a falha do PDF: o upload rejeita, cai no ROLLBACK TO SAVEPOINT.
    // A marcação já aplicada não pode ser desfeita por isso.
    const id = await novaInspecao();
    await http().patch(`/inspections/${id}`).set('Authorization', `Bearer ${technicianToken}`).send({ nrs_aplicaveis: ['NR-23'] });
    const spy = jest.spyOn(app.get(DocumentsService), 'upload').mockRejectedValueOnce(new Error('falha simulada do PDF'));
    try {
      const done = await http().post(`/inspections/${id}/concluir`).set('Authorization', `Bearer ${technicianToken}`);
      expect(done.status).toBeLessThan(300);
      expect(spy).toHaveBeenCalledTimes(1); // prova que o caminho de falha rodou
      const get = await http().get(`/inspections/${id}`).set('Authorization', `Bearer ${technicianToken}`);
      expect(get.body.status).toBe('concluida');
      expect(await vigentes()).toEqual(['NR-23']);
    } finally {
      spy.mockRestore();
    }
  });

  it('nrs_aplicaveis: null explícito no PATCH não altera a aplicabilidade ao concluir', async () => {
    const antes = await vigentes();
    expect(antes.length).toBeGreaterThan(0); // o teste só prova algo com marcas vigentes
    const id = await novaInspecao();
    const patch = await http().patch(`/inspections/${id}`).set('Authorization', `Bearer ${technicianToken}`).send({ nrs_aplicaveis: null });
    expect(patch.status).toBe(200);
    expect(patch.body.nrs_aplicaveis ?? null).toBeNull();
    const done = await http().post(`/inspections/${id}/concluir`).set('Authorization', `Bearer ${technicianToken}`);
    expect(done.status).toBeLessThan(300);
    expect(await vigentes()).toEqual(antes);
  });
});
