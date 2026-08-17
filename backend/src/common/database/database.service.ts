import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

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
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
