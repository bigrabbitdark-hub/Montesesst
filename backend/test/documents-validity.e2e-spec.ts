// IMPORTANTE: este e2e depende da migration 0079 (documents.valid_from,
// expires_source, validity_months_applied + tabela document_validity_rules).
// Roda em banco descartável/jest-e2e; em produção, NÃO aplicar e NÃO rodar
// esta suíte semrollback. Para rodar:
//
//   npx jest --config ./test/jest-e2e.json documents-validity
//
// Status: VERIFICADO em banco descartável em 2026-10-13. A suíte ALTERA
// regras globais de document_validity_rules (PATCH /documents/validity-rules/
// :category) durante a execução e restaura no afterAll a partir do snapshot
// capturado no beforeAll. Por isso só pode rodar em banco descartável,
// nunca contra banco com dados reais — o rollback cobre apenas as regras
// globais, não os documentos criados pelos próprios testes (esses são
// apagados por outras camadas de cleanup do TestDb). Foi corrigido conforme
// briefing da Fase 28:
//   - bug do INSERT de usuário com placeholder sobrando (item 7);
//   - save/restore de regras globais + mock do R2Service (item 8);
//   - "categoria inexistente → 404" alinhado (item 9);
//   - teste de "mudar a regra não recalcula" reforçado (item 10);
//   - novos casos exigidos pelo briefing (PATCH parcial, UUID inválido,
//     400 para coerência de datas em POST e PATCH, isolamento de tenant,
//     company_unit_id preservada, documento legado, upload+delete).
// Ajustes da 2ª revisão de segurança (2026-10-13):
//   - M1: alert_days: null → 400 + regra inalterada;
//   - B1: data com ano fora de 1900..2200 → 400 ("data fora do intervalo
//     aceito"), incluindo resultado de cálculo.

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { BCRYPT_COST } from '../src/common/auth/bcrypt-cost';
import { R2Service } from '../src/common/r2/r2.service';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Vigência de documentos (e2e) — banco descartável, VERIFICADO em 2026-10-13', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenA: string;
  let tenantAId: string;
  let userAId: string;
  let tokenB: string;
  let tenantBId: string;
  let tokenAdmin: string;
  let tokenEmpresaOtherA: string;
  let tokenTecnicoVinculado: string;
  let tokenTecnicoNaoVinculado: string;
  let docAId: string;
  // Snapshot das regras que o teste altera; restauradas em afterAll pra
  // não afetar outros specs (itens 8 e 10 do briefing).
  const regrasAlteradas: Array<{ category: string; validity_months: number | null; alert_days: number }> = [];
  const fileContent = '%PDF-1.4 conteudo de teste vigencia';

  function addDays(base: Date, days: number): string {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // O bucket real não existe neste ambiente; mock evita dependência de
      // R2_ENDPOINT / R2_ACCESS_KEY_ID / network (mesmo padrão dos e2e
      // documents-pii-minimization e documents-word-excel).
      .overrideProvider(R2Service)
      .useValue({
        putObject: jest.fn().mockResolvedValue(undefined),
        deleteObject: jest.fn().mockResolvedValue(undefined),
        getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://example.com/fake-url'),
        getObject: jest.fn().mockResolvedValue(Buffer.from('')),
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenantA = await db.createTenantWithUser('Empresa Validade A');
    tenantAId = tenantA.tenantId;
    userAId = tenantA.userId;
    const tenantB = await db.createTenantWithUser('Empresa Validade B');
    tenantBId = tenantB.tenantId;

    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.email, password: tenantA.password });
    tokenA = loginA.body.access_token;
    const loginB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantB.email, password: tenantB.password });
    tokenB = loginB.body.access_token;

    // Outro usuário 'empresa' do MESMO tenant A — não pode editar/ver o
    // documento do userA (regra "uploader or admin" do DELETE replicada no
    // PATCH /:id/validity).
    const otherPassword = 'senha-teste-123';
    const otherHash = await bcrypt.hash(otherPassword, BCRYPT_COST);
    const otherEmail = `outro-${randomUUID()}@teste.montese.local`;
    // INSERT com 4 placeholders / 4 parâmetros (mesmo padrão de
    // documents-download-delete.e2e-spec.ts). O bug antigo passava 4
    // parâmetros para 3 placeholders.
    await (db as any).client.query(
      `INSERT INTO users (tenant_id, role, email, password_hash, full_name, status)
       VALUES ($1, 'empresa', $2, $3, $4, 'ativo')`,
      [tenantAId, otherEmail, otherHash, 'Outro Empresa A'],
    );
    const loginOther = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: otherEmail, password: otherPassword });
    tokenEmpresaOtherA = loginOther.body.access_token;

    // Técnico vinculado ao tenant A — pode ler e editar documento do tenant.
    const vinculado = await db.createUserWithRole('tecnico', 'Tecnico Validade Vinculado');
    const vinculadoTecResult = await (db as any).client.query(
      `INSERT INTO technicians (user_id) VALUES ($1) RETURNING id`,
      [vinculado.userId],
    );
    await (db as any).client.query(
      `INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)`,
      [tenantAId, vinculadoTecResult.rows[0].id],
    );
    const loginVinculado = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: vinculado.email, password: vinculado.password });
    tokenTecnicoVinculado = loginVinculado.body.access_token;

    // Técnico SEM vínculo com tenant A — não pode ler/editar documentos do A.
    const naoVinculado = await db.createUserWithRole('tecnico', 'Tecnico Validade Nao Vinculado');
    const naoVinculadoTecResult = await (db as any).client.query(
      `INSERT INTO technicians (user_id) VALUES ($1) RETURNING id`,
      [naoVinculado.userId],
    );
    const loginNaoVinculado = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: naoVinculado.email, password: naoVinculado.password });
    tokenTecnicoNaoVinculado = loginNaoVinculado.body.access_token;

    const admin = await db.createUserWithRole('admin', 'Admin Validade');
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    // Snapshot de todas as regras antes dos testes pra restaurar em afterAll.
    const snapshot = await (db as any).client.query(
      `SELECT category, validity_months, alert_days FROM document_validity_rules ORDER BY category`,
    );
    for (const row of snapshot.rows) {
      regrasAlteradas.push({
        category: row.category,
        validity_months: row.validity_months,
        alert_days: row.alert_days,
      });
    }
  });

  afterAll(async () => {
    // Restaura todas as regras globais alteradas pelos testes.
    for (const regra of regrasAlteradas) {
      await (db as any).client.query(
        `UPDATE document_validity_rules
         SET validity_months = $1, alert_days = $2, updated_by_user_id = NULL
         WHERE category = $3`,
        [regra.validity_months, regra.alert_days, regra.category],
      );
    }
    // Limpeza defensiva dos técnicos criados neste spec.
    await (db as any).client.query(
      `DELETE FROM tenant_technicians WHERE technician_id IN
        (SELECT id FROM technicians WHERE user_id IN
          (SELECT id FROM users WHERE email LIKE 'tecnico-validade-%@teste.montese.local'))`,
    );
    await (db as any).client.query(
      `DELETE FROM technicians WHERE user_id IN
        (SELECT id FROM users WHERE email LIKE 'tecnico-validade-%@teste.montese.local')`,
    );
    if (docAId) {
      await (db as any).client.query('DELETE FROM documents WHERE id = $1', [docAId]);
    }
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  describe('POST /documents — regra de vigência no servidor', () => {
    it('valid_from + regra pcmso=12 → expires_at = +12 meses, source=rule, meses=12', async () => {
      const res = await request(app.getHttpServer())
        .post('/documents')
        .set('Authorization', `Bearer ${tokenA}`)
        .field('category', 'pcmso')
        .field('title', 'PCMSO de teste')
        .field('valid_from', '2026-01-15')
        .attach('file', Buffer.from(fileContent, 'utf-8'), {
          filename: 'pcmso.pdf',
          contentType: 'application/pdf',
        });
      expect(res.status).toBe(201);
      expect(res.body.valid_from).toBe('2026-01-15');
      expect(res.body.expires_at).toBe('2027-01-15');
      expect(res.body.expires_source).toBe('rule');
      expect(res.body.validity_months_applied).toBe(12);
      expect(['valido', 'vencendo', 'vencido', 'sem_vencimento']).toContain(res.body.situacao);
      docAId = res.body.id;
    });

    it('sem valid_from e sem expires_at → tudo null, situacao sem_vencimento', async () => {
      const res = await request(app.getHttpServer())
        .post('/documents')
        .set('Authorization', `Bearer ${tokenA}`)
        .field('category', 'laudo')
        .field('title', 'Laudo sem datas')
        .attach('file', Buffer.from(fileContent, 'utf-8'), {
          filename: 'laudo.pdf',
          contentType: 'application/pdf',
        });
      expect(res.status).toBe(201);
      expect(res.body.valid_from).toBeNull();
      expect(res.body.expires_at).toBeNull();
      expect(res.body.expires_source).toBeNull();
      expect(res.body.validity_months_applied).toBeNull();
      expect(res.body.situacao).toBe('sem_vencimento');
      await request(app.getHttpServer())
        .delete(`/documents/${res.body.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
    });

    it('cliente manda expires_at incoerente (antes de valid_from) → 400 (revalidação no servidor)', async () => {
      const res = await request(app.getHttpServer())
        .post('/documents')
        .set('Authorization', `Bearer ${tokenA}`)
        .field('category', 'pcmso')
        .field('title', 'PCMSO incoerente')
        .field('valid_from', '2026-06-01')
        .field('expires_at', '2026-05-01')
        .attach('file', Buffer.from(fileContent, 'utf-8'), {
          filename: 'pcmso-incoerente.pdf',
          contentType: 'application/pdf',
        });
      expect(res.status).toBe(400);
    });

    it('valid_from com formato inválido (ISO com hora) → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/documents')
        .set('Authorization', `Bearer ${tokenA}`)
        .field('category', 'pcmso')
        .field('title', 'PCMSO data inválida')
        .field('valid_from', '2026-01-15T00:00:00Z')
        .attach('file', Buffer.from(fileContent, 'utf-8'), {
          filename: 'pcmso-bad.pdf',
          contentType: 'application/pdf',
        });
      expect(res.status).toBe(400);
    });

    it('valid_from com ano fora de 1900..2200 → 400 ("data fora do intervalo aceito")', async () => {
      // 9950-01-01 casa no isDateOnly/regex mas o ano está fora do intervalo
      // aceito. Sem o check na função pura, viraria um INSERT de DATE que o
      // Postgres rejeita com 22008 (date out of range) e retornaria 500.
      const res = await request(app.getHttpServer())
        .post('/documents')
        .set('Authorization', `Bearer ${tokenA}`)
        .field('category', 'pcmso')
        .field('title', 'PCMSO data absurda')
        .field('valid_from', '9950-01-01')
        .attach('file', Buffer.from(fileContent, 'utf-8'), {
          filename: 'pcmso-absurdo.pdf',
          contentType: 'application/pdf',
        });
      expect(res.status).toBe(400);
      // Confirma também a mensagem em português pra não virar 400 genérico.
      const mensagem = JSON.stringify(res.body || {});
      expect(mensagem).toMatch(/data fora do intervalo aceito/);
    });

    it('técnico VINCULADO ao tenant consegue enviar documento com valid_from (passa tenant_id)', async () => {
      const res = await request(app.getHttpServer())
        .post('/documents')
        .set('Authorization', `Bearer ${tokenTecnicoVinculado}`)
        .field('category', 'pcmso')
        .field('title', 'PCMSO pelo técnico')
        .field('tenant_id', tenantAId)
        .field('valid_from', '2026-02-01')
        .attach('file', Buffer.from(fileContent, 'utf-8'), {
          filename: 'pcmso-tec.pdf',
          contentType: 'application/pdf',
        });
      expect(res.status).toBe(201);
      expect(res.body.valid_from).toBe('2026-02-01');
      expect(res.body.expires_at).toBe('2027-02-01');
      // Limpeza
      await request(app.getHttpServer())
        .delete(`/documents/${res.body.id}`)
        .set('Authorization', `Bearer ${tokenTecnicoVinculado}`);
    });
  });

  describe('GET /documents — formato enriquecido', () => {
    it('devolve valid_from, expires_at como AAAA-MM-DD, expires_source, meses, situacao', async () => {
      const res = await request(app.getHttpServer())
        .get('/documents')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      const doc = res.body.find((d: { id: string }) => d.id === docAId);
      expect(doc).toBeDefined();
      expect(doc.valid_from).toBe('2026-01-15');
      expect(doc.expires_at).toBe('2027-01-15');
      expect(typeof doc.expires_at).toBe('string');
      expect(doc.expires_source).toBe('rule');
      expect(doc.validity_months_applied).toBe(12);
      expect(['valido', 'vencendo', 'vencido', 'sem_vencimento']).toContain(doc.situacao);
    });
  });

  describe('PATCH /api/documents/:id/validity', () => {
    it('recalcula a partir de valid_from usando a regra da categoria', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/documents/${docAId}/validity`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ valid_from: '2026-03-10' });
      expect(res.status).toBe(200);
      expect(res.body.valid_from).toBe('2026-03-10');
      expect(res.body.expires_at).toBe('2027-03-10');
      expect(res.body.expires_source).toBe('rule');
      expect(res.body.validity_months_applied).toBe(12);
    });

    it('aceita expires_at manual e marca expires_source=manual, meses=null', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/documents/${docAId}/validity`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ valid_from: '2026-01-15', expires_at: '2027-08-20' });
      expect(res.status).toBe(200);
      expect(res.body.expires_at).toBe('2027-08-20');
      expect(res.body.expires_source).toBe('manual');
      expect(res.body.validity_months_applied).toBeNull();
    });

    it('só com expires_at (sem valid_from) preserva valid_from atual', async () => {
      // Primeiro fixa um valid_from conhecido pra comparar antes/depois.
      await request(app.getHttpServer())
        .patch(`/documents/${docAId}/validity`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ valid_from: '2026-04-01', expires_at: '2027-04-01' })
        .expect(200);
      const res = await request(app.getHttpServer())
        .patch(`/documents/${docAId}/validity`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ expires_at: '2028-04-01' });
      expect(res.status).toBe(200);
      // valid_from NÃO pode ter sido zerado
      expect(res.body.valid_from).toBe('2026-04-01');
      // expires_at bate com valid_from + 24m (regra pcmso=12) NÃO, então
      // vira manual e meses zera
      expect(res.body.expires_at).toBe('2028-04-01');
      expect(res.body.expires_source).toBe('manual');
      expect(res.body.validity_months_applied).toBeNull();
    });

    it('só com valid_from em categoria SEM regra preserva expires_at manual existente', async () => {
      // Sobe um laudo (categoria sem regra) com vencimento manual, depois
      // muda só valid_from — o vencimento manual NÃO pode ser zerado.
      const up = await request(app.getHttpServer())
        .post('/documents')
        .set('Authorization', `Bearer ${tokenA}`)
        .field('category', 'laudo')
        .field('title', 'Laudo manual')
        .field('valid_from', '2026-01-15')
        .field('expires_at', '2026-12-31')
        .attach('file', Buffer.from(fileContent, 'utf-8'), {
          filename: 'laudo-manual.pdf',
          contentType: 'application/pdf',
        });
      expect(up.status).toBe(201);
      expect(up.body.expires_source).toBe('manual');

      const patch = await request(app.getHttpServer())
        .patch(`/documents/${up.body.id}/validity`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ valid_from: '2026-06-01' });
      expect(patch.status).toBe(200);
      expect(patch.body.valid_from).toBe('2026-06-01');
      // Preserva expires_at manual — não zera mesmo com regra ausente.
      expect(patch.body.expires_at).toBe('2026-12-31');
      expect(patch.body.expires_source).toBe('manual');
      expect(patch.body.validity_months_applied).toBeNull();

      await request(app.getHttpServer())
        .delete(`/documents/${up.body.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
    });

    it('rejeita expires_at < valid_from', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/documents/${docAId}/validity`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ valid_from: '2026-06-01', expires_at: '2026-05-01' });
      expect(res.status).toBe(400);
    });

    it('rejeita outro usuário do mesmo tenant (não-uploader e não-admin)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/documents/${docAId}/validity`)
        .set('Authorization', `Bearer ${tokenEmpresaOtherA}`)
        .send({ valid_from: '2026-03-10' });
      expect(res.status).toBe(403);
    });

    it('admin pode editar documento de qualquer tenant', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/documents/${docAId}/validity`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ valid_from: '2026-04-01' });
      expect(res.status).toBe(200);
      expect(res.body.valid_from).toBe('2026-04-01');
    });

    it('tenant B NÃO lê nem edita documento do tenant A → 404', async () => {
      const getRes = await request(app.getHttpServer())
        .get('/documents')
        .query({ tenant_id: tenantAId })
        .set('Authorization', `Bearer ${tokenB}`);
      const ids = (getRes.body as Array<{ id: string }>).map((d) => d.id);
      expect(ids).not.toContain(docAId);

      const patchRes = await request(app.getHttpServer())
        .patch(`/documents/${docAId}/validity`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ valid_from: '2030-01-01' });
      expect(patchRes.status).toBe(404);
    });

    it('técnico NÃO vinculado recebe 404 no PATCH (RLS esconde)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/documents/${docAId}/validity`)
        .set('Authorization', `Bearer ${tokenTecnicoNaoVinculado}`)
        .send({ valid_from: '2026-03-10' });
      expect(res.status).toBe(404);
    });

    it('id não-UUID → 400 (ParseUUIDPipe)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/documents/abc-123/validity')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ valid_from: '2026-03-10' });
      expect(res.status).toBe(400);
    });

    it('body vazio → 400', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/documents/${docAId}/validity`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('preserva company_unit_id e datas após PATCH', async () => {
      // Sobe um documento com company_unit_id vinculada ao próprio tenant.
      const unit = await (db as any).client.query(
        `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
         VALUES ($1, 'Filial Teste', 'Rua X', 'Cidade', 'SP', '01000000') RETURNING id`,
        [tenantAId],
      );
      const unitId = unit.rows[0].id;
      const up = await request(app.getHttpServer())
        .post('/documents')
        .set('Authorization', `Bearer ${tokenA}`)
        .field('category', 'pcmso')
        .field('title', 'PCMSO filial')
        .field('company_unit_id', unitId)
        .field('valid_from', '2026-05-01')
        .attach('file', Buffer.from(fileContent, 'utf-8'), {
          filename: 'pcmso-filial.pdf',
          contentType: 'application/pdf',
        });
      expect(up.status).toBe(201);
      expect(up.body.company_unit_id).toBe(unitId);

      const patch = await request(app.getHttpServer())
        .patch(`/documents/${up.body.id}/validity`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ expires_at: '2028-05-01' });
      expect(patch.status).toBe(200);
      expect(patch.body.company_unit_id).toBe(unitId);
      expect(patch.body.valid_from).toBe('2026-05-01');
      expect(patch.body.expires_at).toBe('2028-05-01');

      // Limpeza
      await request(app.getHttpServer())
        .delete(`/documents/${up.body.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      await (db as any).client.query('DELETE FROM company_units WHERE id = $1', [unitId]);
    });

    it('upload e exclusão continuam funcionando com os campos novos', async () => {
      const up = await request(app.getHttpServer())
        .post('/documents')
        .set('Authorization', `Bearer ${tokenA}`)
        .field('category', 'pcmso')
        .field('title', 'Ciclo completo')
        .field('valid_from', '2026-01-15')
        .attach('file', Buffer.from(fileContent, 'utf-8'), {
          filename: 'ciclo.pdf',
          contentType: 'application/pdf',
        });
      expect(up.status).toBe(201);
      expect(up.body.valid_from).toBe('2026-01-15');
      expect(up.body.expires_at).toBe('2027-01-15');

      const del = await request(app.getHttpServer())
        .delete(`/documents/${up.body.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(del.status).toBe(200);
    });
  });

  describe('GET /api/documents/validity-rules', () => {
    it('devolve as 12 categorias (pcmso=12, pgr=24, demais null)', async () => {
      const res = await request(app.getHttpServer())
        .get('/documents/validity-rules')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(12);
      const byCat = Object.fromEntries((res.body as Array<{ category: string; validity_months: number | null }>).map((r) => [r.category, r.validity_months]));
      expect(byCat.pcmso).toBe(12);
      expect(byCat.pgr).toBe(24);
      expect(byCat.laudo).toBeNull();
    });
  });

  describe('PATCH /api/documents/validity-rules/:category', () => {
    it('admin pode alterar e a resposta reflete updated_at/updated_by_user_id', async () => {
      const res = await request(app.getHttpServer())
        .patch('/documents/validity-rules/laudo')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ validity_months: 18, alert_days: 45 });
      expect(res.status).toBe(200);
      expect(res.body.category).toBe('laudo');
      expect(res.body.validity_months).toBe(18);
      expect(res.body.alert_days).toBe(45);
    });

    it('PATCH só com alert_days preserva validity_months (item 1 do briefing)', async () => {
      // laudo agora está com meses=18 do teste anterior; PATCH só de
      // alert_days NÃO pode zerar validity_months.
      const res = await request(app.getHttpServer())
        .patch('/documents/validity-rules/laudo')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ alert_days: 60 });
      expect(res.status).toBe(200);
      expect(res.body.alert_days).toBe(60);
      expect(res.body.validity_months).toBe(18);
    });

    it('PATCH só com validity_months preserva alert_days', async () => {
      const res = await request(app.getHttpServer())
        .patch('/documents/validity-rules/laudo')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ validity_months: 24 });
      expect(res.status).toBe(200);
      expect(res.body.validity_months).toBe(24);
      expect(res.body.alert_days).toBe(60); // preservado do teste anterior
    });

    it('empresa NÃO pode alterar (403)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/documents/validity-rules/laudo')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ validity_months: 18 });
      expect(res.status).toBe(403);
    });

    it('categoria inexistente → 404', async () => {
      const res = await request(app.getHttpServer())
        .patch('/documents/validity-rules/categoria-fake')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ validity_months: 12 });
      // Alinhado com o comportamento correto (controller tem a
      // VALIDITY_RULE_CATEGORIES; categoria fora dela → NotFoundException,
      // mesmo path que o service.loadRule devolveria 0 linhas).
      expect(res.status).toBe(404);
    });

    it('body vazio (sem validity_months e sem alert_days) → 400', async () => {
      const res = await request(app.getHttpServer())
        .patch('/documents/validity-rules/laudo')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('PATCH alert_days: null → 400 e regra permanece inalterada (M1 da 2ª revisão)', async () => {
      // Antes: alert_days null vazava pelo @ValidateIf e o service gravava
      // NULL em coluna NOT NULL → 500. Agora o DTO rejeita com 400 em
      // português (validador @IsInt roda porque null !== undefined).
      const before = await request(app.getHttpServer())
        .get('/documents/validity-rules')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(before.status).toBe(200);
      const laudoBefore = (before.body as Array<{
        category: string; validity_months: number | null; alert_days: number;
      }>).find((r) => r.category === 'laudo');
      expect(laudoBefore).toBeDefined();

      const patch = await request(app.getHttpServer())
        .patch('/documents/validity-rules/laudo')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ alert_days: null });
      expect(patch.status).toBe(400);
      // Mensagem em português — resguarda contra regressão que faça virar
      // 400 genérico sem identificar o campo.
      const mensagem = JSON.stringify(patch.body || {});
      expect(mensagem).toMatch(/alertDays|alert_days/);

      // Regra inalterada: o service não chegou a tocar no banco.
      const after = await request(app.getHttpServer())
        .get('/documents/validity-rules')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(after.status).toBe(200);
      const laudoAfter = (after.body as Array<{
        category: string; validity_months: number | null; alert_days: number;
      }>).find((r) => r.category === 'laudo');
      expect(laudoAfter!.alert_days).toBe(laudoBefore!.alert_days);
      expect(laudoAfter!.validity_months).toBe(laudoBefore!.validity_months);
    });

    it('mudar a regra NÃO recalcula documentos já salvos (mesma categoria)', async () => {
      // docAId é pcmso com expires_at conhecido. Mudamos pcmso de 12 para
      // 36 meses e relemos — o expires_at e validity_months_applied do
      // docAId devem ficar idênticos.
      const listBefore = await request(app.getHttpServer())
        .get('/documents')
        .set('Authorization', `Bearer ${tokenA}`);
      const docBefore = (listBefore.body as Array<{
        id: string; expires_at: string | null; validity_months_applied: number | null;
      }>).find((d) => d.id === docAId);
      expect(docBefore).toBeDefined();
      const expiresAtBefore = docBefore!.expires_at;
      const monthsBefore = docBefore!.validity_months_applied;

      await request(app.getHttpServer())
        .patch('/documents/validity-rules/pcmso')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ validity_months: 36 })
        .expect(200);

      const listAfter = await request(app.getHttpServer())
        .get('/documents')
        .set('Authorization', `Bearer ${tokenA}`);
      const docAfter = (listAfter.body as Array<{
        id: string; expires_at: string | null; validity_months_applied: number | null;
      }>).find((d) => d.id === docAId);
      expect(docAfter).toBeDefined();
      // Documento NÃO foi recalculado — regra nova NÃO afeta o passado.
      expect(docAfter!.expires_at).toBe(expiresAtBefore);
      expect(docAfter!.validity_months_applied).toBe(monthsBefore);
    });
  });

  describe('Documentos legados sem datas (sem colunas novas)', () => {
    it('documento antigo criado direto no banco com NULL → listagem traz null + sem_vencimento', async () => {
      // INSERT direto via superuser pra simular um documento histórico
      // (anterior à 0079) — sem valid_from, expires_source, etc.
      const legacy = await (db as any).client.query(
        `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
         VALUES ($1, 'pgr', 'PGR legado', 'legacy-key', 'legado.pdf', 'application/pdf', 100, NULL, $2, 'empresa') RETURNING id`,
        [tenantAId, userAId],
      );
      const legacyId = legacy.rows[0].id;
      const res = await request(app.getHttpServer())
        .get('/documents')
        .set('Authorization', `Bearer ${tokenA}`);
      const doc = (res.body as Array<{ id: string; valid_from: string | null; expires_at: string | null; expires_source: string | null; situacao: string }>).find(
        (d) => d.id === legacyId,
      );
      expect(doc).toBeDefined();
      if (!doc) throw new Error('documento legado não encontrado na listagem');
      expect(doc.valid_from).toBeNull();
      expect(doc.expires_at).toBeNull();
      expect(doc.expires_source).toBeNull();
      expect(doc.situacao).toBe('sem_vencimento');
      await (db as any).client.query('DELETE FROM documents WHERE id = $1', [legacyId]);
    });
  });

  describe('Download continua funcionando', () => {
    it('GET /documents/:id/download devolve URL (mock do R2)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/documents/${docAId}/download`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(typeof res.body.url).toBe('string');
      expect(res.body.url.length).toBeGreaterThan(0);
    });
  });
});