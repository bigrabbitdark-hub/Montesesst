---
name: perf-infra
description: Performance de infraestrutura do Montese SST na VPS (Docker, Nginx, Postgres, Redis, builds). Use para diagnosticar consumo de recursos e propor ajustes. Analisa com comandos de leitura; só propõe mudanças.
---

# Performance de infraestrutura

## Princípio
Uma VPS única roda tudo (postgres, redis, backend, frontend, nginx) e também builds e agentes. Recurso é compartilhado: diagnostique antes de propor. **Toda mudança de infra exige autorização do proprietário.**

## Diagnóstico (somente leitura)
```bash
docker stats --no-stream            # CPU/memória por container
docker ps --format '{{.Names}} {{.Status}}'
docker logs --tail 100 montese_backend
df -h / ; free -h ; uptime
docker system df                    # espaço de imagens/volumes/cache
```
Postgres (como leitura, sem alterar): conexões ativas, queries longas (`pg_stat_activity`), tamanho de tabelas, índices não usados (`pg_stat_user_indexes`), cache hit ratio.

## Pontos a avaliar
- **Memória**: conferir limites do container vs consumo real; Node com `--max-old-space-size` coerente com o limite; Postgres `shared_buffers`/`work_mem` em relação à RAM. Build do Next.js e vários agentes em paralelo competem pela mesma RAM e CPU: evite builds simultâneos.
- **Build de imagem**: ordem das camadas do Dockerfile (dependências antes do código) para aproveitar cache; `.dockerignore` correto; imagem final enxuta (multi-stage).
- **Nginx**: compressão (gzip/brotli), cache de estáticos com cabeçalhos longos para assets com hash, keepalive para o upstream, limites de upload coerentes com a API. Rotas `/api/*` não cacheadas.
- **Redis**: política de expiração e tamanho máximo definidos; chaves com TTL e prefixo de tenant.
- **Disco**: logs com rotação, imagens e cache de build antigos, backups (`ops/backup-postgres.sh`, `r2-backup.js`) com retenção e verificação. Backups nunca são apagados sem autorização.
- **Worktrees do Orca/agentes**: cada worktree com `node_modules` consome disco. Limpe worktrees concluídas (peça autorização) e prefira compartilhar cache do npm.
- **Deploy**: troca de container sem derrubar o que funciona (build da imagem candidata, health check, rollback pela tag anterior), conforme `docs/operations`.

## Proibido sem autorização
Parar/recriar containers de produção, `docker system prune`, `docker compose down -v`, alterar volumes, Nginx, TLS, DNS, backups, secrets.

## Saída esperada
Medição atual, gargalo, mudança proposta com ganho esperado, risco, plano de rollback, e o pedido de autorização.
