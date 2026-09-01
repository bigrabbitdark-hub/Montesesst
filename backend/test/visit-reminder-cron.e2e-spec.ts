import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { VisitReminderCronService } from '../src/visits/visit-reminder.cron';
import { EmailService } from '../src/common/email/email.service';
import { TestDb } from './db-test-helper';

describe('VisitReminderCronService.runOnce (e2e)', () => {
  let db: TestDb;
  let tenantId: string;
  let tenantEmail: string;
  let technicianId: string;
  let technicianUserId: string;
  let technicianEmail: string;
  let sendSpy: jest.SpyInstance;
  let cron: VisitReminderCronService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    cron = moduleRef.get(VisitReminderCronService);
    const emailService = moduleRef.get(EmailService);
    sendSpy = jest.spyOn(emailService, 'send').mockResolvedValue(undefined);

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa Visits Reminder Teste');
    tenantId = tenant.tenantId;
    tenantEmail = tenant.email;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Visits Reminder Teste');
    technicianUserId = tech.userId;
    technicianEmail = tech.email;
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    // Visita confirmada pra amanhã — deve gerar lembrete.
    await (db as any).client.query(
      `INSERT INTO visit_requests (tenant_id, technician_user_id, requested_by_user_id, status, confirmed_date)
       VALUES ($1, $2, $3, 'confirmado', CURRENT_DATE + INTERVAL '1 day')`,
      [tenantId, technicianUserId, tenant.userId],
    );
    // Visita confirmada pra depois de amanhã — NÃO deve gerar lembrete.
    await (db as any).client.query(
      `INSERT INTO visit_requests (tenant_id, technician_user_id, requested_by_user_id, status, confirmed_date)
       VALUES ($1, $2, $3, 'confirmado', CURRENT_DATE + INTERVAL '2 days')`,
      [tenantId, technicianUserId, tenant.userId],
    );
    // Visita solicitada (não confirmada) pra amanhã — NÃO deve gerar lembrete.
    await (db as any).client.query(
      `INSERT INTO visit_requests (tenant_id, technician_user_id, requested_by_user_id, status, preferred_date)
       VALUES ($1, $2, $3, 'solicitado', CURRENT_DATE + INTERVAL '1 day')`,
      [tenantId, technicianUserId, tenant.userId],
    );
  });

  afterAll(async () => {
    sendSpy.mockRestore();
    await (db as any).client.query('DELETE FROM visit_requests WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
  });

  it('dispara e-mail pra empresa e técnico só da visita confirmada de amanhã, não das outras', async () => {
    await cron.runOnce();

    expect(sendSpy).toHaveBeenCalledTimes(2);
    const recipients = sendSpy.mock.calls.map((call) => call[0].to).sort();
    expect(recipients).toEqual([tenantEmail, technicianEmail].sort());
  });
});
