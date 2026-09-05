import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/common/email/email.service';
import { WeeklyDigestService } from '../src/dashboard/weekly-digest.service';
import { TestDb } from './db-test-helper';

describe('WeeklyDigestService.runWeeklyDigest (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let service: WeeklyDigestService;
  const fakeSend = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({ send: fakeSend })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    service = app.get(WeeklyDigestService);

    db = new TestDb();
    await db.connect();
  });

  afterEach(() => {
    fakeSend.mockReset().mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  function iso(daysFromToday: number): string {
    const d = new Date();
    d.setDate(d.getDate() + daysFromToday);
    return d.toISOString().slice(0, 10);
  }

  async function insertPgrVencido(tenantId: string, userId: string, title: string): Promise<void> {
    await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', $2, 'fixture/pgr-vencido.pdf', 'pgr-vencido.pdf', 'application/pdf', 100, $3, $4, 'empresa')`,
      [tenantId, title, iso(-5), userId],
    );
  }

  // `runWeeklyDigest` varre TODOS os tenants `status = 'ativo'` do banco —
  // é o mesmo Postgres real usado pela aplicação (sem banco de teste
  // isolado, mesmo padrão de toda suíte e2e deste projeto), então pode
  // haver outros tenants reais/de outras suítes já presentes. As
  // asserções abaixo checam a PRESENÇA do fixture desta suíte entre as
  // chamadas de `fakeSend`, nunca a contagem total — contagem exata
  // quebraria com qualquer tenant alheio que também tenha pendências.
  function callFor(email: string) {
    return fakeSend.mock.calls.find((call) => call[0].to === email)?.[0];
  }

  it('envia o resumo pra um tenant com pendências reais', async () => {
    const tenant = await db.createTenantWithUser('Empresa Com Pendencia');
    // Documento vencido gera um item real em `atencao` — mesmo dado que o
    // dashboard já usa (DocumentsService.getCompliance).
    await insertPgrVencido(tenant.tenantId, tenant.userId, 'PGR vencido');

    await service.runWeeklyDigest();

    const call = callFor(tenant.email);
    expect(call).toBeDefined();
    expect(call.subject).toMatch(/pendência/);
    expect(call.html).toContain('PGR vencido');
  });

  it('não envia nada pra tenant sem nenhuma pendência', async () => {
    const tenant = await db.createTenantWithUser('Empresa Sem Pendencia');

    await service.runWeeklyDigest();

    expect(callFor(tenant.email)).toBeUndefined();
  });

  it('uma falha de envio num tenant não impede o envio pros demais', async () => {
    const tenantFalha = await db.createTenantWithUser('Empresa Falha Envio');
    await insertPgrVencido(tenantFalha.tenantId, tenantFalha.userId, 'PGR vencido (falha)');
    const tenantOk = await db.createTenantWithUser('Empresa Ok Envio');
    await insertPgrVencido(tenantOk.tenantId, tenantOk.userId, 'PGR vencido (ok)');

    // Rejeita especificamente pelo destinatário (não pela posição da
    // chamada) — a ordem de iteração não é garantida (sem ORDER BY na
    // query), então mockImplementationOnce (que rejeitaria só a 1ª
    // chamada do mock inteiro) poderia acertar um tenant alheio em vez
    // de um destes dois fixtures.
    fakeSend.mockImplementation((input: { to: string }) =>
      input.to === tenantFalha.email ? Promise.reject(new Error('falha simulada do Resend')) : Promise.resolve(undefined),
    );

    await expect(service.runWeeklyDigest()).resolves.toBeUndefined();

    expect(callFor(tenantFalha.email)).toBeDefined();
    expect(callFor(tenantOk.email)).toBeDefined();
  });
});
