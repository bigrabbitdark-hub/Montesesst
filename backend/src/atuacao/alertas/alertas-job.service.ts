import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database/database.service';
import { AuditService } from '../../common/audit/audit.service';
import { todayDateOnly, type DateOnly } from '../../common/dates/date-only';
import { NOTICE_PADRAO } from './alertas.dto';

type Prioridade = 'baixa' | 'media' | 'alta';
type Tipo = 'documento_vencendo' | 'documento_vencido' | 'tarefa_atrasada' | 'correcao_atrasada' | 'revisao_por_mudanca';
export interface Alvo {
  userId: string; type: Tipo; priority: Prioridade; title: string; tenantId: string | null; href: string | null; dedupeKey: string;
}

const CATEGORIA_ROTULO: Record<string, string> = {
  pgr: 'PGR', pcmso: 'PCMSO', laudo: 'Laudo', ficha_epi: 'Ficha de EPI', treinamento: 'Treinamento', cipa_ata: 'Ata da CIPA',
  cipa_comunicado: 'Comunicado da CIPA', cipa_documento_eleitoral: 'Documento eleitoral da CIPA', cipa_anexo: 'Anexo da CIPA',
  ltcat: 'LTCAT', lip: 'LIP', relatorio_visita: 'Relatório de visita',
};
const TAREFA_ABERTA = ['pending', 'in_progress', 'blocked', 'awaiting_review', 'awaiting_client', 'awaiting_execution', 'awaiting_efficacy'];

// Faixa de antecedência já atingida: a MENOR antecedência n com dias <= n (ex.: 20 dias com {60,30,15,7,0} => 30).
// Assim, se o job ficar parado alguns dias, a próxima execução gera só a faixa atual (sem rajada de faixas antigas).
export function faixaAtingida(dias: number, notice: readonly number[]): number | null {
  const aplicaveis = notice.filter((n) => dias <= n);
  return aplicaveis.length ? Math.min(...aplicaveis) : null;
}
export function prioridadeDoPrazo(dias: number): Prioridade {
  return dias <= 7 ? 'alta' : dias <= 30 ? 'media' : 'baixa';
}

// Gera notificações internas para os sócios (idempotente por usuário + chave). Texto genérico: tipo do documento e nome
// da empresa; nunca título de documento, nota nem dado de funcionário. Job de sistema: contexto admin, só carteira Montese.
@Injectable()
export class AlertasJobService {
  private readonly logger = new Logger(AlertasJobService.name);

  constructor(private readonly db: DatabaseService, private readonly audit: AuditService) {}

  @Cron('30 6 * * *', { timeZone: 'America/Sao_Paulo' })
  async handleCron(): Promise<void> {
    try {
      await this.runOnce();
    } catch (err) {
      this.logger.error(`Falha ao gerar notificações (${(err as { code?: string })?.code ?? (err as Error)?.constructor?.name})`);
    }
  }

  async runOnce(hoje: DateOnly = todayDateOnly(new Date())): Promise<{ criadas: number; porFonte: Record<string, number | null> }> {
    const out = await this.db.withTenantContext({ role: 'admin' }, async (c) => {
      const destinatarios = await this.destinatarios(c);
      const ids = new Set(destinatarios);
      const porFonte: Record<string, number | null> = {};
      const alvos: Alvo[] = [];
      const fontes: Array<[string, () => Promise<Alvo[]>]> = [
        ['documentos', () => this.documentos(c, hoje, destinatarios)],
        ['tarefas', () => this.tarefas(c, hoje, ids)],
        ['correcoes', () => this.correcoes(c, hoje, ids)],
        ['mudancas', () => this.mudancas(c, destinatarios)],
      ];
      for (const [nome, fn] of fontes) {
        await c.query('SAVEPOINT alertas_fonte');
        try {
          const a = await fn();
          await c.query('RELEASE SAVEPOINT alertas_fonte');
          porFonte[nome] = a.length;
          alvos.push(...a);
        } catch (err) {
          await c.query('ROLLBACK TO SAVEPOINT alertas_fonte');
          porFonte[nome] = null;
          this.logger.warn(`fonte "${nome}" indisponível (${(err as { code?: string })?.code ?? 'erro'})`);
        }
      }
      return { criadas: await this.gravar(c, alvos), porFonte };
    });
    await this.audit.log({
      actorUserId: null, actorRole: null, action: 'alertas.job_run', resourceType: 'notifications', method: 'CRON',
      path: 'alertas-job', statusCode: 200, detail: `criadas: ${out.criadas}; fontes: ${JSON.stringify(out.porFonte)}`,
    });
    return out;
  }

  // Sócios ATIVOS com alertas.read e empresas.read (o aviso expõe nome da empresa; quem não vê empresas não recebe).
  private async destinatarios(c: PoolClient): Promise<string[]> {
    const r = await c.query<{ id: string }>(
      `/* alertas-job:destinatarios */
       SELECT s.id FROM list_socios() s
         JOIN socio_permissions p ON p.user_id = s.id AND p.permission = 'alertas.read'
         JOIN socio_permissions e ON e.user_id = s.id AND e.permission = 'empresas.read'`,
    );
    return r.rows.map((x) => x.id);
  }

  private async documentos(c: PoolClient, hoje: DateOnly, dest: string[]): Promise<Alvo[]> {
    if (!dest.length) return [];
    const r = await c.query(
      `/* alertas-job:documentos */
       SELECT d.id, d.tenant_id, t.name AS empresa, d.category, d.expires_at::text AS expires_at,
              (d.expires_at - $1::date)::int AS dias, rg.notice_days
         FROM documents d
         JOIN tenants t ON t.id = d.tenant_id
         LEFT JOIN document_validity_rules rg ON rg.category = d.category
        WHERE d.expires_at IS NOT NULL AND d.category <> 'cadastro_funcionarios' AND is_montese_tenant(d.tenant_id)
          AND d.expires_at <= $1::date + 365
        ORDER BY d.expires_at, d.id
        LIMIT 5000`,
      [hoje],
    );
    const alvos: Alvo[] = [];
    for (const d of r.rows) {
      const rotulo = CATEGORIA_ROTULO[d.category] ?? 'Documento';
      let faixa: string;
      let titulo: string;
      let tipo: Tipo;
      let prioridade: Prioridade;
      if (d.dias < 0) {
        faixa = 'vencido'; tipo = 'documento_vencido'; prioridade = 'alta';
        titulo = `${rotulo} vencido — ${d.empresa}`;
      } else {
        const n = faixaAtingida(d.dias, d.notice_days ?? NOTICE_PADRAO);
        if (n === null) continue;
        faixa = String(n); tipo = 'documento_vencendo'; prioridade = prioridadeDoPrazo(d.dias);
        titulo = d.dias === 0 ? `${rotulo} vence hoje — ${d.empresa}` : `${rotulo} vence em ${d.dias} dia${d.dias === 1 ? '' : 's'} — ${d.empresa}`;
      }
      for (const userId of dest) {
        alvos.push({
          userId, type: tipo, priority: prioridade, title: titulo.slice(0, 200), tenantId: d.tenant_id,
          href: `/atuacao/empresas/${d.tenant_id}`, dedupeKey: `doc:${d.id}:${d.expires_at}:${faixa}`,
        });
      }
    }
    return alvos;
  }

  private async tarefas(c: PoolClient, hoje: DateOnly, dest: Set<string>): Promise<Alvo[]> {
    const r = await c.query(
      `/* alertas-job:tarefas */
       SELECT k.id, k.assignee_user_id, k.tenant_id, t.name AS empresa, k.priority, to_char(k.due_date, 'YYYY-MM-DD') AS due
         FROM tasks k JOIN tenants t ON t.id = k.tenant_id
        WHERE k.status = ANY($2::text[]) AND k.due_date < $1::date AND is_montese_tenant(k.tenant_id)
        ORDER BY k.due_date, k.id LIMIT 5000`,
      [hoje, TAREFA_ABERTA],
    );
    return r.rows.filter((k) => dest.has(k.assignee_user_id)).map((k) => ({
      userId: k.assignee_user_id, type: 'tarefa_atrasada' as const,
      priority: (k.priority === 'urgente' || k.priority === 'alta' ? 'alta' : 'media') as Prioridade,
      title: `Tarefa atrasada — ${k.empresa}`.slice(0, 200), tenantId: k.tenant_id, href: '/atuacao/tarefas?vencidas=true',
      dedupeKey: `task:${k.id}:${k.due}`,
    }));
  }

  private async correcoes(c: PoolClient, hoje: DateOnly, dest: Set<string>): Promise<Alvo[]> {
    const r = await c.query(
      `/* alertas-job:correcoes */
       SELECT x.id, x.draft_id, x.tenant_id, x.responsible_user_id, t.name AS empresa, to_char(x.due_date, 'YYYY-MM-DD') AS due
         FROM document_corrections x JOIN tenants t ON t.id = x.tenant_id
        WHERE x.status IN ('aberta','corrigida') AND x.due_date < $1::date AND is_montese_tenant(x.tenant_id)
        ORDER BY x.due_date, x.id LIMIT 5000`,
      [hoje],
    );
    return r.rows.filter((x) => dest.has(x.responsible_user_id)).map((x) => ({
      userId: x.responsible_user_id, type: 'correcao_atrasada' as const, priority: 'alta' as const,
      title: `Correção de documento atrasada — ${x.empresa}`.slice(0, 200), tenantId: x.tenant_id,
      href: `/atuacao/documentos/${x.draft_id}`, dedupeKey: `corr:${x.id}:${x.due}`,
    }));
  }

  private async mudancas(c: PoolClient, dest: string[]): Promise<Alvo[]> {
    if (!dest.length) return [];
    const r = await c.query(
      `/* alertas-job:mudancas */
       SELECT f.id, f.tenant_id, t.name AS empresa
         FROM document_change_flags f JOIN tenants t ON t.id = f.tenant_id
        WHERE f.resolved_at IS NULL AND is_montese_tenant(f.tenant_id)
        ORDER BY f.created_at, f.id LIMIT 2000`,
    );
    return r.rows.flatMap((f) => dest.map((userId) => ({
      userId, type: 'revisao_por_mudanca' as const, priority: 'alta' as const,
      title: `Revisão por mudança nas condições de trabalho — ${f.empresa}`.slice(0, 200), tenantId: f.tenant_id,
      href: `/atuacao/empresas/${f.tenant_id}`, dedupeKey: `flag:${f.id}`,
    })));
  }

  // Insere em lote, ignorando as já existentes (UNIQUE usuário + chave).
  private async gravar(c: PoolClient, alvos: Alvo[]): Promise<number> {
    let criadas = 0;
    for (let i = 0; i < alvos.length; i += 500) {
      const lote = alvos.slice(i, i + 500);
      const r = await c.query(
        `/* alertas-job:gravar */
         SELECT notifications_insert_batch($1::uuid[], $2::text[], $3::text[], $4::text[], $5::uuid[], $6::text[], $7::text[]) AS n`,
        [
          lote.map((a) => a.userId), lote.map((a) => a.type), lote.map((a) => a.priority), lote.map((a) => a.title),
          lote.map((a) => a.tenantId), lote.map((a) => a.href), lote.map((a) => a.dedupeKey),
        ],
      );
      criadas += r.rows[0]?.n ?? 0;
    }
    return criadas;
  }
}
