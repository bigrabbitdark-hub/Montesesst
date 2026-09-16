import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../common/database/database.service';
import { EmailService } from '../common/email/email.service';
import { escapeHtml } from '../common/html-escape.util';
import { toDateString } from './visits.service';

interface ReminderRow {
  id: string;
  tenant_name: string;
  technician_email: string;
  technician_name: string;
  requested_by_email: string;
  type: 'reuniao' | 'visita';
  // Coluna `date` do Postgres — node-pg devolve um objeto Date, não string
  // (mesma armadilha já documentada em visits.service.ts). Normalizado via
  // toDateString antes de entrar no e-mail, senão vira
  // "Fri Sep 12 2026 00:00:00 GMT+0000 (Coordinated Universal Time)".
  confirmed_date: string | Date;
  google_meet_link: string | null;
}

const TYPE_LABELS: Record<'reuniao' | 'visita', string> = { reuniao: 'Reunião', visita: 'Visita técnica' };

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
        `SELECT vr.id, t.name AS tenant_name,
                tech_user.email AS technician_email, tech_user.full_name AS technician_name,
                req_user.email AS requested_by_email,
                vr.type, vr.confirmed_date, vr.google_meet_link
         FROM visit_requests vr
         JOIN tenants t ON t.id = vr.tenant_id
         JOIN users tech_user ON tech_user.id = vr.technician_user_id
         JOIN users req_user ON req_user.id = vr.requested_by_user_id
         WHERE vr.status = 'confirmado' AND vr.confirmed_date = CURRENT_DATE + INTERVAL '1 day'`,
      ),
    );

    for (const row of rows) {
      const confirmedDate = toDateString(row.confirmed_date);
      // tenant_name vem de RegisterDto.company_name (texto livre digitado
      // pelo próprio usuário no cadastro, 2-200 caracteres, sem sanitização
      // na gravação) — escapado aqui como nos outros dois pontos de envio de
      // e-mail do projeto (contact.service.ts, registration.service.ts),
      // mesma razão: nunca interpolar texto de usuário em HTML sem escapar.
      const technicianName = escapeHtml(row.technician_name);
      const tenantName = escapeHtml(row.tenant_name);
      const typeLabel = TYPE_LABELS[row.type];
      const typeLabelLower = typeLabel.toLowerCase();
      // google_meet_link nunca é digitado por usuário (vem da resposta da API
      // do Google), mas escapamos mesmo assim como defesa em profundidade —
      // mesmo raciocínio já aplicado acima a tenant_name/technician_name.
      const escapedMeetLink = row.google_meet_link ? escapeHtml(row.google_meet_link) : null;
      const meetLine = escapedMeetLink
        ? `<p>Link da reunião: <a href="${escapedMeetLink}">${escapedMeetLink}</a></p>`
        : '';

      try {
        await this.email.send({
          to: row.requested_by_email,
          subject: `${typeLabel} confirmada amanhã`,
          html: `<p>Sua ${typeLabelLower} com ${technicianName} está confirmada para amanhã (${confirmedDate}).</p>${meetLine}`,
        });
      } catch (err) {
        this.logger.error(`Falha ao enviar lembrete (empresa) pra visita ${row.id}`, (err as Error).stack);
      }

      try {
        await this.email.send({
          to: row.technician_email,
          subject: `Você tem ${typeLabelLower} confirmada amanhã`,
          html: `<p>Você tem uma ${typeLabelLower} confirmada amanhã (${confirmedDate}) na empresa ${tenantName}.</p>${meetLine}`,
        });
      } catch (err) {
        this.logger.error(`Falha ao enviar lembrete (técnico) pra visita ${row.id}`, (err as Error).stack);
      }
    }
  }
}
