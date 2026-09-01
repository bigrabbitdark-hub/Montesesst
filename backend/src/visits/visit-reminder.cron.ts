import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../common/database/database.service';
import { EmailService } from '../common/email/email.service';
import { toDateString } from './visits.service';

interface ReminderRow {
  id: string;
  tenant_id: string;
  tenant_name: string;
  technician_user_id: string;
  technician_email: string;
  requested_by_email: string;
  // Coluna `date` do Postgres — node-pg devolve um objeto Date, não string
  // (mesma armadilha já documentada em visits.service.ts). Normalizado via
  // toDateString antes de entrar no e-mail, senão vira
  // "Fri Sep 12 2026 00:00:00 GMT+0000 (Coordinated Universal Time)".
  confirmed_date: string | Date;
}

@Injectable()
export class VisitReminderCronService {
  private readonly logger = new Logger(VisitReminderCronService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly email: EmailService,
  ) {}

  @Cron('0 8 * * *')
  async handleCron(): Promise<void> {
    await this.runOnce();
  }

  // Job de sistema, sem usuário autenticado. Diferente de
  // NormativeMonitorService.runOnce (cujas tabelas não têm RLS), aqui
  // visit_requests/users/technicians/tenant_technicians têm FORCE ROW LEVEL
  // SECURITY e a role montese_app não tem BYPASSRLS — um SELECT direto via
  // withoutTenantContext (sem app.role/app.tenant_id setados) seria filtrado
  // pelas policies e voltaria sempre vazio. Por isso usamos withTenantContext
  // com role: 'admin', o mesmo contexto que TenantContextInterceptor monta
  // pra uma requisição autenticada de admin (tenant-context.interceptor.ts) —
  // toda policy desta base libera leitura total quando app.role = 'admin',
  // e o SET LOCAL fica escopado à transação (sem risco de vazar pro próximo
  // uso da conexão do pool, ao contrário de setar via withoutTenantContext).
  async runOnce(): Promise<void> {
    const { rows } = await this.db.withTenantContext({ role: 'admin' }, (client) =>
      client.query<ReminderRow>(
        `SELECT vr.id, vr.tenant_id, t.name AS tenant_name, vr.technician_user_id,
                tech_user.email AS technician_email, req_user.email AS requested_by_email,
                vr.confirmed_date
         FROM visit_requests vr
         JOIN tenants t ON t.id = vr.tenant_id
         JOIN users tech_user ON tech_user.id = vr.technician_user_id
         JOIN users req_user ON req_user.id = vr.requested_by_user_id
         WHERE vr.status = 'confirmado' AND vr.confirmed_date = CURRENT_DATE + INTERVAL '1 day'`,
      ),
    );

    for (const row of rows) {
      const confirmedDate = toDateString(row.confirmed_date);

      try {
        await this.email.send({
          to: row.requested_by_email,
          subject: 'Visita técnica confirmada amanhã',
          html: `<p>Sua visita técnica com ${row.technician_email} está confirmada para amanhã (${confirmedDate}).</p>`,
        });
      } catch (err) {
        this.logger.error(`Falha ao enviar lembrete (empresa) pra visita ${row.id}`, (err as Error).stack);
      }

      try {
        await this.email.send({
          to: row.technician_email,
          subject: 'Você tem visita confirmada amanhã',
          html: `<p>Você tem uma visita confirmada amanhã (${confirmedDate}) na empresa ${row.tenant_name}.</p>`,
        });
      } catch (err) {
        this.logger.error(`Falha ao enviar lembrete (técnico) pra visita ${row.id}`, (err as Error).stack);
      }
    }
  }
}
