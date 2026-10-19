import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../common/database/database.service';
import { envInt } from '../common/env';

// Privacidade: candidatos pendentes (nome/CPF/trecho do documento) não ficam para sempre. Diariamente:
// (a) revisões `requer_revisao` mais antigas que o TTL viram `expirado` e os candidatos são zerados (sobram só os itens
//     `invalida`, que guardam linha e motivo); o documento NÃO é apagado (decisão separada);
// (b) extrações `processando` há mais de 1 hora (órfãs de um processo que caiu) viram `erro`.
// Idempotente, em lotes, sem logar nomes/CPF (só contagens), nunca derruba o processo.
// Contexto: job de sistema sem usuário. A tabela tem FORCE RLS (policy só admite `empresa` do tenant e `admin`), então
// usa withTenantContext com role 'admin' — o mesmo contexto do VisitReminderCronService; a RLS não é enfraquecida.
export const EXPIRED_DETAIL = 'A revisão expirou. Reenvie o documento.';
export const ORPHAN_DETAIL = 'O processamento não terminou. Reenvie o documento.';
const BATCH = 500;
const MAX_ROUNDS = 40;

@Injectable()
export class EmployeeExtractionExpiryCronService {
  private readonly logger = new Logger(EmployeeExtractionExpiryCronService.name);

  constructor(private readonly db: DatabaseService) {}

  static ttlDays(): number {
    return Math.min(365, Math.max(1, envInt('EMPLOYEE_EXTRACTION_TTL_DAYS', 30)));
  }

  @Cron('15 3 * * *')
  async handleCron(): Promise<void> {
    await this.run();
  }

  async run(): Promise<{ expired: number; orphaned: number }> {
    const out = { expired: 0, orphaned: 0 };
    try {
      const days = EmployeeExtractionExpiryCronService.ttlDays();
      for (let i = 0; i < MAX_ROUNDS; i++) {
        const n = await this.db.withTenantContext({ role: 'admin' }, async (client) => {
          const r = await client.query(
            `WITH due AS (
               SELECT id FROM employee_document_extractions
                WHERE status = 'requer_revisao' AND created_at < now() - make_interval(days => $1::int)
                ORDER BY created_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
             UPDATE employee_document_extractions e
                SET status = 'expirado',
                    candidates = COALESCE((SELECT jsonb_agg(c) FROM jsonb_array_elements(e.candidates) c WHERE c->>'kind' = 'invalida'), '[]'::jsonb),
                    summary = e.summary || jsonb_build_object('detail', $2::text, 'expired_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
               FROM due WHERE e.id = due.id`,
            [days, EXPIRED_DETAIL],
          );
          return r.rowCount ?? 0;
        });
        out.expired += n;
        if (n < BATCH) break;
      }
      for (let i = 0; i < MAX_ROUNDS; i++) {
        const n = await this.db.withTenantContext({ role: 'admin' }, async (client) => {
          const r = await client.query(
            `WITH due AS (
               SELECT id FROM employee_document_extractions
                WHERE status = 'processando' AND created_at < now() - interval '1 hour'
                ORDER BY created_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
             UPDATE employee_document_extractions e
                SET status = 'erro', summary = e.summary || jsonb_build_object('detail', $1::text)
               FROM due WHERE e.id = due.id`,
            [ORPHAN_DETAIL],
          );
          return r.rowCount ?? 0;
        });
        out.orphaned += n;
        if (n < BATCH) break;
      }
      if (out.expired > 0 || out.orphaned > 0) this.logger.log(`Extrações de cadastro: ${out.expired} expiradas, ${out.orphaned} órfãs encerradas`);
    } catch (err) {
      // Só o tipo: nunca a mensagem (pode carregar dados da linha).
      this.logger.error(`Falha no job de expiração de extrações: ${(err as Error)?.name} ${(err as { code?: string })?.code ?? ''}`);
    }
    return out;
  }
}
