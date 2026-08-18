import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { envInt } from '../env';

export interface TenantContext {
  userId?: string;
  tenantId?: string;
  role?: string;
}

// Pool único de conexões. Cada request que precisa de contexto de tenant abre
// uma transação e usa SET LOCAL (via set_config com is_local=true) para
// popular app.user_id / app.tenant_id / app.role, que as policies de RLS leem.
// SET LOCAL expira sozinho no COMMIT/ROLLBACK, então não vaza entre requests
// mesmo com conexões sendo reaproveitadas pelo pool.
//
// Limites configuráveis por env (spec de Escala/Confiabilidade, ver
// docs/operations/reliability.md) — valores padrão pensados pra "dezenas de
// empresas" numa única VPS pequena, não centenas de conexões simultâneas:
// - DB_POOL_MAX: nº máximo de conexões simultâneas ao Postgres.
// - DB_POOL_IDLE_TIMEOUT_MS: fecha conexão ociosa do pool após esse tempo.
// - DB_POOL_CONN_TIMEOUT_MS: tempo máximo esperando uma conexão livre do
//   pool antes de falhar (evita requests pendurados indefinidamente sob
//   sobrecarga).
// - DB_STATEMENT_TIMEOUT_MS: aborta no próprio Postgres qualquer query que
//   passe desse tempo (protege contra query presa/travando conexões do pool).
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: envInt('DB_POOL_MAX', 10),
    idleTimeoutMillis: envInt('DB_POOL_IDLE_TIMEOUT_MS', 30_000),
    connectionTimeoutMillis: envInt('DB_POOL_CONN_TIMEOUT_MS', 5_000),
    statement_timeout: envInt('DB_STATEMENT_TIMEOUT_MS', 10_000),
  });

  constructor() {
    // Sem este handler, um erro de conexão ociosa (ex: Postgres reiniciou,
    // rede caiu por um instante) é um evento não tratado do Node e derruba
    // o processo inteiro do backend — não só a query que falhou.
    this.pool.on('error', (err) => {
      this.logger.error('Erro em conexão ociosa do pool do Postgres', err.stack);
    });
  }

  async withTenantContext<T>(
    ctx: TenantContext,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', ctx.userId ?? '']);
      await client.query('SELECT set_config($1, $2, true)', [
        'app.tenant_id',
        ctx.tenantId ?? '',
      ]);
      await client.query('SELECT set_config($1, $2, true)', ['app.role', ctx.role ?? '']);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Só para consultas que legitimamente não têm contexto de tenant ainda
  // (health check, e a função de bootstrap de login que já é SECURITY DEFINER).
  async withoutTenantContext<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
