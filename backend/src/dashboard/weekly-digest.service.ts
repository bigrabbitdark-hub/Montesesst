import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../common/database/database.service';
import { EmailService } from '../common/email/email.service';
import { AttentionItem, DashboardService } from './dashboard.service';

interface DigestTenant {
  tenantId: string;
  email: string;
  name: string;
  tradeName: string | null;
}

const PRIORITY_LABEL: Record<AttentionItem['prioridade'], string> = {
  alta: 'Urgente',
  media: 'Em breve',
  baixa: 'Acompanhar',
};

// Nível 1 da disciplina registrada em docs/assistente-montese-principios.md
// (determinístico, sem LLM) — os dados (atencao/proximos_eventos) já são
// 100% estruturados pelo DashboardService, então um template fixo é
// suficiente, mais barato e mais confiável que gerar o texto via IA.
@Injectable()
export class WeeklyDigestService {
  private readonly logger = new Logger(WeeklyDigestService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly dashboard: DashboardService,
    private readonly email: EmailService,
  ) {}

  // Toda segunda-feira às 8h (horário do servidor).
  @Cron('0 8 * * 1')
  async runWeeklyDigest(): Promise<void> {
    // `users` tem FORCE ROW LEVEL SECURITY (users_isolation) — mesmo a role
    // da aplicação só enxerga linhas de todos os tenants com
    // app.role = 'admin' setado (mesmo mecanismo que as rotas
    // @Roles('admin') já usam via req.withTenantContext). withoutTenantContext
    // não seta nenhuma GUC var, então o JOIN com users devolveria sempre
    // zero linhas sem isso. `tenants` em si não tem RLS própria (ver
    // comentário em tenants.controller.ts).
    const tenants = await this.db.withTenantContext({ role: 'admin' }, (client) =>
      client.query<DigestTenant>(
        `SELECT t.id AS "tenantId", u.email, t.name, t.trade_name AS "tradeName"
         FROM tenants t
         JOIN users u ON u.tenant_id = t.id AND u.role = 'empresa'
         WHERE t.status = 'ativo'`,
      ),
    );

    for (const tenant of tenants.rows) {
      try {
        await this.sendDigestForTenant(tenant);
      } catch (err) {
        // Best-effort por tenant — uma falha (query, envio) nunca pode
        // interromper o envio pros demais tenants da lista, mesmo
        // raciocínio já usado em uploadLogo/removeLogo (Fase 19).
        this.logger.error(`Falha ao enviar resumo semanal pro tenant ${tenant.tenantId}`, (err as Error).stack);
      }
    }
  }

  private async sendDigestForTenant(tenant: DigestTenant): Promise<void> {
    const summary = await this.db.withTenantContext({ tenantId: tenant.tenantId, role: 'empresa' }, (client) =>
      this.dashboard.getSummary(client, tenant.tenantId),
    );

    const items = [...summary.atencao, ...summary.proximos_eventos].filter((item) => item.responsavel === 'empresa');
    if (items.length === 0) return;

    await this.email.send({
      to: tenant.email,
      subject: `Resumo semanal — ${items.length} ${items.length === 1 ? 'pendência' : 'pendências'} pra acompanhar`,
      html: this.renderHtml(tenant, items),
    });
  }

  private renderHtml(tenant: DigestTenant, items: AttentionItem[]): string {
    const displayName = tenant.tradeName ?? tenant.name;
    const rows = items
      .map((item) => `<li>[${PRIORITY_LABEL[item.prioridade]}] ${item.titulo}${item.data ? ` — ${item.data}` : ''}</li>`)
      .join('');
    return `
      <p>Olá, ${displayName}!</p>
      <p>Aqui está o resumo semanal de pendências e vencimentos da sua empresa:</p>
      <ul>${rows}</ul>
      <p><a href="${process.env.PUBLIC_APP_URL}/empresa/dashboard">Ver no painel</a></p>
    `;
  }
}
