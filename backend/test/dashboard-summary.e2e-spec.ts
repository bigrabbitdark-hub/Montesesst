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
    expect(res.body.score).toBeNull();
    expect(res.body.empresa_destaque).toBe(false);
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
    expect(res.body.empresa_destaque).toBe(false);

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

  it('empresa com todos os documentos em dia recebe score 100 e empresa_destaque true', async () => {
    const client = (db as any).client;

    const docRes = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR em dia teste', 'fixture/pgr-em-dia.pdf', 'pgr-em-dia.pdf', 'application/pdf', 100, $2, $3, 'empresa')
       RETURNING id`,
      [tenantId, iso(90), userId],
    );

    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.score).toBe(100);
    expect(res.body.empresa_destaque).toBe(true);

    await client.query('DELETE FROM documents WHERE id = $1', [docRes.rows[0].id]);
  });

  it('empresa com documento vencendo (não vencido) tem score 100 mas NÃO recebe empresa_destaque', async () => {
    const client = (db as any).client;

    const docRes = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR vencendo teste', 'fixture/pgr-vencendo.pdf', 'pgr-vencendo.pdf', 'application/pdf', 100, $2, $3, 'empresa')
       RETURNING id`,
      [tenantId, iso(15), userId],
    );

    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // A fórmula de score existente conta "vencendo" (≤30 dias) como
    // em dia — score continua 100, mas o selo não deve aparecer.
    expect(res.body.score).toBe(100);
    expect(res.body.status).toBe('atencao');
    expect(res.body.empresa_destaque).toBe(false);

    await client.query('DELETE FROM documents WHERE id = $1', [docRes.rows[0].id]);
  });

  it('agrega pendência de CIPA atrasada e achados do Pente-Fino já cacheados', async () => {
    const client = (db as any).client;

    const unitRes = await client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip, is_matriz)
       VALUES ($1, 'Matriz Dashboard Teste', 'Rua Teste', 'Cidade Teste', 'SP', '00000000', true) RETURNING id`,
      [tenantId],
    );
    const companyUnitId = unitRes.rows[0].id;

    const pendenciaRes = await client.query(
      `INSERT INTO cipa_pendencias (tenant_id, company_unit_id, descricao, prazo, status)
       VALUES ($1, $2, 'Providenciar extintor na sala 3', $3, 'aberta') RETURNING id`,
      [tenantId, companyUnitId, iso(-2)],
    );

    const soldadorRes = await client.query(
      `INSERT INTO positions (tenant_id, name) VALUES ($1, 'Soldador Dashboard Teste') RETURNING id`,
      [tenantId],
    );
    const motoristaRes = await client.query(
      `INSERT INTO positions (tenant_id, name) VALUES ($1, 'Motorista Dashboard Teste') RETURNING id`,
      [tenantId],
    );

    const pgrDocRes = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR Pente-Fino Dashboard Teste', 'fixture/pgr-dash.pdf', 'pgr.pdf', 'application/pdf', 100, $2, 'empresa')
       RETURNING id`,
      [tenantId, userId],
    );
    const pcmsoDocRes = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pcmso', 'PCMSO Pente-Fino Dashboard Teste', 'fixture/pcmso-dash.pdf', 'pcmso.pdf', 'application/pdf', 100, $2, 'empresa')
       RETURNING id`,
      [tenantId, userId],
    );

    // Soldador só tem risco (PGR) → risco_sem_exame. Motorista só tem
    // exame (PCMSO) → exame_sem_risco. Os dois lados da extração têm
    // pelo menos uma linha, então getPenteFinoFindings não pula por
    // "nunca rodou".
    await client.query(
      `INSERT INTO pgr_function_risks (tenant_id, document_id, position_id, function_text_raw, risk_description, source_excerpt)
       VALUES ($1, $2, $3, 'Soldador Dashboard Teste', 'Exposição a fumos metálicos', 'trecho pgr teste')`,
      [tenantId, pgrDocRes.rows[0].id, soldadorRes.rows[0].id],
    );
    await client.query(
      `INSERT INTO pcmso_function_exams (tenant_id, document_id, position_id, function_text_raw, exam_description, source_excerpt)
       VALUES ($1, $2, $3, 'Motorista Dashboard Teste', 'Exame toxicológico', 'trecho pcmso teste')`,
      [tenantId, pcmsoDocRes.rows[0].id, motoristaRes.rows[0].id],
    );

    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    const cipaItem = res.body.atencao.find((item: any) => item.tipo === 'cipa_pendencia');
    expect(cipaItem).toBeDefined();
    expect(cipaItem.titulo).toContain('Providenciar extintor na sala 3');
    expect(cipaItem.prioridade).toBe('alta');
    expect(cipaItem.link).toBe('/empresa/cipa/pendencias');

    const riscoSemExame = res.body.atencao.find(
      (item: any) => item.tipo === 'pente_fino' && item.titulo.includes('Soldador Dashboard Teste'),
    );
    expect(riscoSemExame).toBeDefined();
    expect(riscoSemExame.titulo).toContain('risco sem exame');
    expect(riscoSemExame.prioridade).toBe('alta');
    expect(riscoSemExame.link).toBe('/empresa/pente-fino');

    const exameSemRisco = res.body.atencao.find(
      (item: any) => item.tipo === 'pente_fino' && item.titulo.includes('Motorista Dashboard Teste'),
    );
    expect(exameSemRisco).toBeDefined();
    expect(exameSemRisco.titulo).toContain('exame sem risco');
    expect(exameSemRisco.prioridade).toBe('media');

    await client.query('DELETE FROM documents WHERE id = ANY($1)', [
      [pgrDocRes.rows[0].id, pcmsoDocRes.rows[0].id],
    ]);
    await client.query('DELETE FROM positions WHERE id = ANY($1)', [
      [soldadorRes.rows[0].id, motoristaRes.rows[0].id],
    ]);
    await client.query('DELETE FROM cipa_pendencias WHERE id = $1', [pendenciaRes.rows[0].id]);
    await client.query('DELETE FROM company_units WHERE id = $1', [companyUnitId]);
  });

  it('pendência de CIPA marcada "atrasada" manualmente conta como pendência mesmo sem prazo cadastrado', async () => {
    const client = (db as any).client;

    const unitRes = await client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip, is_matriz)
       VALUES ($1, 'Matriz Dashboard Teste 2', 'Rua Teste', 'Cidade Teste', 'SP', '00000000', true) RETURNING id`,
      [tenantId],
    );
    const companyUnitId = unitRes.rows[0].id;

    const pendenciaRes = await client.query(
      `INSERT INTO cipa_pendencias (tenant_id, company_unit_id, descricao, prazo, status)
       VALUES ($1, $2, 'Assinar ata da reunião passada', NULL, 'atrasada') RETURNING id`,
      [tenantId, companyUnitId],
    );

    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const cipaItem = res.body.atencao.find(
      (item: any) => item.tipo === 'cipa_pendencia' && item.titulo.includes('Assinar ata da reunião passada'),
    );
    expect(cipaItem).toBeDefined();
    expect(cipaItem.prioridade).toBe('alta');
    expect(cipaItem.data).toBeNull();

    await client.query('DELETE FROM cipa_pendencias WHERE id = $1', [pendenciaRes.rows[0].id]);
    await client.query('DELETE FROM company_units WHERE id = $1', [companyUnitId]);
  });

  it('não gera achado de Pente-Fino quando só um dos dois documentos já foi extraído (evita falso-positivo)', async () => {
    const client = (db as any).client;

    const positionRes = await client.query(
      `INSERT INTO positions (tenant_id, name) VALUES ($1, 'Eletricista Dashboard Teste') RETURNING id`,
      [tenantId],
    );
    const pgrDocRes = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR Só Risco Dashboard Teste', 'fixture/pgr-so-risco.pdf', 'pgr.pdf', 'application/pdf', 100, $2, 'empresa')
       RETURNING id`,
      [tenantId, userId],
    );
    await client.query(
      `INSERT INTO pgr_function_risks (tenant_id, document_id, position_id, function_text_raw, risk_description, source_excerpt)
       VALUES ($1, $2, $3, 'Eletricista Dashboard Teste', 'Risco de choque elétrico', 'trecho teste')`,
      [tenantId, pgrDocRes.rows[0].id, positionRes.rows[0].id],
    );
    // Nenhuma linha em pcmso_function_exams pra este tenant — o PCMSO
    // genuinamente nunca foi extraído, não é "sem achado".

    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const penteFinoItems = res.body.atencao.filter((item: any) => item.tipo === 'pente_fino');
    expect(penteFinoItems).toEqual([]);

    await client.query('DELETE FROM documents WHERE id = $1', [pgrDocRes.rows[0].id]);
    await client.query('DELETE FROM positions WHERE id = $1', [positionRes.rows[0].id]);
  });
});
