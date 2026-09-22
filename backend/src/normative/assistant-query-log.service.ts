import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../common/database/database.service';
import { QueryTrace } from './query-trace';

// Retenção do log de uso (spec docs/specs/assistente-confiabilidade-etapa-2-3.md §4.3).
export const QUERY_LOG_RETENTION_DAYS = 90;

// Grava o trace de cada pergunta real em assistant_query_log — só metadados e
// ids, nunca texto (ver a migration 0051 e query-trace.ts).
@Injectable()
export class AssistantQueryLogService {
  private readonly logger = new Logger(AssistantQueryLogService.name);

  constructor(private readonly db: DatabaseService) {}

  // Nunca lança: registrar uso é best-effort e jamais pode atrasar nem derrubar
  // a resposta ao usuário (quem chama não espera por isto). Sem RETURNING: o
  // RETURNING exigiria passar pela policy de SELECT, que é só do admin.
  async record(trace: QueryTrace): Promise<void> {
    // Interruptor por ambiente: os e2e rodam contra o Postgres de produção e
    // (todos, inclusive os de outros módulos) chamam o Assistente — sem isto
    // cada execução da suíte gravaria linhas de teste no log de uso real e
    // poluiria as estatísticas que este log existe para medir.
    // test/jest-e2e-setup.js liga o interruptor; só o e2e do próprio log o desliga.
    if (process.env.ASSISTANT_QUERY_LOG_DISABLED === 'true') return;
    try {
      const retrieved = {
        threshold: trace.threshold,
        chunk_limit: trace.chunk_limit,
        normative: trace.normative,
        checklist: trace.checklist,
        company: trace.company,
        operational_count: trace.operational_count,
      };
      await this.db.withoutTenantContext((client) =>
        client.query(
          `INSERT INTO assistant_query_log
             (role, tenant_id, question_hash, outcome, notices, retrieved,
              claims_total, claims_dropped_ids, claims_dropped_support,
              blocking_tokens, flagged_numbers, used_attachment, model,
              latency_ms, retrieval_ms)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            trace.role,
            trace.tenant_id,
            trace.question_hash,
            trace.outcome,
            trace.notices,
            JSON.stringify(retrieved),
            trace.claims_total,
            trace.claims_dropped_ids,
            trace.claims_dropped_support,
            trace.blocking_tokens,
            trace.flagged_numbers,
            trace.used_attachment,
            trace.model,
            trace.latency_ms,
            trace.retrieval_ms,
          ],
        ),
      );
    } catch (err) {
      this.logger.error('Falha ao registrar o log de uso do Assistente', (err as Error).stack);
    }
  }

  // Diário, 03:30 (depois do monitor normativo, 03:00). `runOnce`-style: a
  // lógica fica em purgeOlderThan, chamável direto pelos testes.
  @Cron('30 3 * * *')
  async handlePurgeCron(): Promise<void> {
    try {
      const deleted = await this.purgeOlderThan(QUERY_LOG_RETENTION_DAYS);
      if (deleted > 0) this.logger.log(`Log de uso do Assistente: ${deleted} linha(s) além de ${QUERY_LOG_RETENTION_DAYS} dias apagada(s)`);
    } catch (err) {
      this.logger.error('Falha ao apagar o log de uso antigo do Assistente', (err as Error).stack);
    }
  }

  // Só admin apaga (policy de DELETE); o job de sistema usa o mesmo contexto que
  // TenantContextInterceptor monta pra uma requisição de admin, como
  // VisitReminderCronService.
  async purgeOlderThan(days: number): Promise<number> {
    return this.db.withTenantContext({ role: 'admin' }, async (client) => {
      const result = await client.query(
        `DELETE FROM assistant_query_log WHERE created_at < now() - make_interval(days => $1)`,
        [days],
      );
      return result.rowCount ?? 0;
    });
  }
}
