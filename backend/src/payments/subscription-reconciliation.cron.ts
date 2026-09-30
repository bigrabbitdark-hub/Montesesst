import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../common/database/database.service';
import { MercadoPagoService } from './mercadopago.service';
import { SubscriptionsService } from './subscriptions.service';

interface PendingRow {
  id: string;
  mercadopago_preapproval_id: string;
  status: string;
}

// ITEM 030 (auditoria 2026-09-27): confia 100% em entrega de webhook — se um webhook se
// perde (o Mercado Pago não reenvia pra sempre; ou o backend estava fora do ar quando ele
// chegou), a assinatura fica com status desatualizado indefinidamente, sem nada percebendo.
// Este cron é a rede de segurança: pergunta ao Mercado Pago o status REAL de cada assinatura
// que ainda está pending/authorized no banco, e aplica a MESMA função SQL que o webhook usa
// (payments_update_subscription_status) — nunca inventa lógica paralela de sincronização.
//
// Escopo: só pending/authorized. cancelled/paused nunca voltam a mudar sozinhos no Mercado
// Pago (só por ação explícita, que já chega por webhook ou por PATCH /subscriptions/:id/status
// — ambos síncronos), então reconciliá-las aqui seria trabalho sem propósito.
@Injectable()
export class SubscriptionReconciliationCronService {
  private readonly logger = new Logger(SubscriptionReconciliationCronService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly mercadoPago: MercadoPagoService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  // A cada 6h (o webhook já cobre o caminho normal; isto é só a rede de segurança pra quando
  // ele falha — não precisa ser mais frequente que isso).
  @Cron('0 */6 * * *')
  async handleCron(): Promise<void> {
    await this.runOnce();
  }

  // Mesmo padrão de VisitReminderCronService.runOnce: job de sistema, sem usuário
  // autenticado, contra tabela com FORCE ROW LEVEL SECURITY — withTenantContext com
  // role: 'admin' (toda policy do projeto libera leitura total pra esse papel).
  async runOnce(): Promise<{ checked: number; changed: number; failed: number }> {
    const { rows } = await this.db.withTenantContext({ role: 'admin' }, (client) =>
      client.query<PendingRow>(
        `SELECT id, mercadopago_preapproval_id, status FROM subscriptions
         WHERE status IN ('pending', 'authorized') AND mercadopago_preapproval_id IS NOT NULL`,
      ),
    );

    let changed = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const real = await this.mercadoPago.getPreapproval(row.mercadopago_preapproval_id);
        if (real.status === row.status) continue;

        // Mesma sequência do webhook (WebhookController.handleWebhook): grava o status
        // CONFIRMADO pelo Mercado Pago e, se ele virou 'authorized', cancela as outras
        // 'authorized' do mesmo sujeito (ITEM 011) — sem isso, uma assinatura reconciliada
        // aqui poderia deixar duas cobranças ativas em paralelo.
        await this.db.withoutTenantContext((client) =>
          client.query('SELECT * FROM payments_update_subscription_status($1, $2)', [
            row.mercadopago_preapproval_id,
            real.status,
          ]),
        );
        if (real.status === 'authorized') {
          await this.subscriptions.supersedePreviousAuthorized(row.mercadopago_preapproval_id);
        }
        changed++;
        this.logger.log(
          `Reconciliação: assinatura ${row.id} estava '${row.status}' no banco, Mercado Pago confirma '${real.status}' — corrigido`,
        );
      } catch (err) {
        // Uma falha (rede, 4xx/5xx do Mercado Pago) nunca derruba as demais linhas do lote —
        // mesmo raciocínio de VisitReminderCronService (um e-mail que falha não impede os outros).
        failed++;
        this.logger.error(
          `Reconciliação: falha ao verificar a assinatura ${row.id} (preapproval ${row.mercadopago_preapproval_id})`,
          (err as Error).stack,
        );
      }
    }

    if (changed > 0 || failed > 0) {
      this.logger.log(`Reconciliação de assinaturas: ${rows.length} verificadas, ${changed} corrigidas, ${failed} falharam`);
    }
    return { checked: rows.length, changed, failed };
  }
}
