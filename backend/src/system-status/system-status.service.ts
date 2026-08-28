import { Injectable, Logger } from '@nestjs/common';
import * as os from 'os';
import * as fs from 'fs';
import { DatabaseService } from '../common/database/database.service';
import { RedisService } from '../common/redis/redis.service';

export interface SystemStatus {
  memory: { total_gb: number; free_gb: number; used_percent: number };
  cpu: { cores: number; load_avg_1m: number; load_avg_5m: number; load_avg_15m: number };
  disk: { total_gb: number; free_gb: number; used_percent: number };
  services: {
    postgres: { reachable: boolean; active_connections: number | null };
    redis: { reachable: boolean };
    frontend: { reachable: boolean };
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Números da VPS (não do container) porque nenhum serviço deste
// docker-compose tem limite de memória/CPU configurado — sem cgroup
// limitando a visão do container, os.totalmem()/os.freemem()/fs.statfsSync
// já refletem o host real. Confirmado manualmente contra `free -h`/`df -h`
// do host antes de escrever este código (2026-08-28) — se algum dia um
// serviço ganhar `mem_limit`/`deploy.resources`, essa leitura passa a
// refletir só o container, não a VPS inteira.
@Injectable()
export class SystemStatusService {
  private readonly logger = new Logger(SystemStatusService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  async getStatus(): Promise<SystemStatus> {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const [loadAvg1, loadAvg5, loadAvg15] = os.loadavg();

    const diskStats = fs.statfsSync('/');
    const diskTotal = diskStats.blocks * diskStats.bsize;
    const diskFree = diskStats.bfree * diskStats.bsize;

    const [postgres, redisReachable, frontendReachable] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkFrontend(),
    ]);

    return {
      memory: {
        total_gb: round2(totalMem / 1024 ** 3),
        free_gb: round2(freeMem / 1024 ** 3),
        used_percent: round2(((totalMem - freeMem) / totalMem) * 100),
      },
      cpu: {
        cores: os.cpus().length,
        load_avg_1m: round2(loadAvg1),
        load_avg_5m: round2(loadAvg5),
        load_avg_15m: round2(loadAvg15),
      },
      disk: {
        total_gb: round2(diskTotal / 1024 ** 3),
        free_gb: round2(diskFree / 1024 ** 3),
        used_percent: round2(((diskTotal - diskFree) / diskTotal) * 100),
      },
      services: {
        postgres,
        redis: { reachable: redisReachable },
        frontend: { reachable: frontendReachable },
      },
    };
  }

  private async checkPostgres(): Promise<{ reachable: boolean; active_connections: number | null }> {
    try {
      const result = await this.db.withoutTenantContext((client) =>
        client.query<{ count: string }>('SELECT count(*)::text FROM pg_stat_activity'),
      );
      return { reachable: true, active_connections: Number(result.rows[0].count) };
    } catch (err) {
      this.logger.error('Falha ao checar Postgres', (err as Error).stack);
      return { reachable: false, active_connections: null };
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      await this.redis.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  // Sem acesso ao socket do Docker (decisão de segurança confirmada com o
  // fundador, 2026-08-28) — não dá pra checar "container up/down" de
  // verdade. Isso é o proxy possível: o backend consegue falar com o
  // frontend pela rede interna do Docker?
  private async checkFrontend(): Promise<boolean> {
    try {
      const res = await fetch('http://frontend:3000/', { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}
