import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

// Cliente único de Redis. Hoje só usado pelo RateLimitGuard, mas fica como
// módulo global (não acoplado ao rate limiting) porque o container Redis já
// existe no docker-compose pra uso geral da aplicação.
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client = new Redis(process.env.REDIS_URL as string, {
    // Não deixa o backend inteiro derrubar por causa de uma falha
    // transitória do Redis — reconecta sozinho, e chamadas que dependerem
    // dele devem tratar o erro no lugar de chamada (ver RateLimitGuard).
    maxRetriesPerRequest: 3,
  });

  constructor() {
    this.client.on('error', (err) => {
      this.logger.error('Erro na conexão com Redis', err.stack);
    });
  }

  // Contador de janela fixa: primeira chamada da janela define o TTL: chamadas
  // concorrentes na mesma janela podem, em teoria, ambas caírem no INCR antes
  // do PEXPIRE ser aplicado — não é atômico. Aceitável aqui porque o pior
  // caso é a janela ficar alguns ms mais longa, não uma contagem incorreta
  // (rate limit não é dado financeiro/sensível a essa margem).
  async incrementWithWindow(key: string, windowSeconds: number): Promise<{ count: number; ttlMs: number }> {
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.pexpire(key, windowSeconds * 1000);
    }
    const ttlMs = await this.client.pttl(key);
    return { count, ttlMs: ttlMs > 0 ? ttlMs : windowSeconds * 1000 };
  }

  async onModuleDestroy() {
    this.client.disconnect();
  }
}
