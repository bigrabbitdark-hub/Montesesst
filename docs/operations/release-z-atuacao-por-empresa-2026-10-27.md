# Roteiro de liberação — Sub-projeto Z (Atuação por empresa) — 2026-10-27

> **Estado:** pronto para revisão; **nada commitado e nada em produção.** Etapas **[PRODUÇÃO]** só com confirmação explícita do proprietário.

Pré-requisito 0 — commit (decisão do proprietário; o agente não commita): arquivos listados em `docs/superpowers/audits/2026-10-27-pgr-z-atuacao-por-empresa.md`.
1. **Backup** (de `/opt/Montese`): `bash ops/backup-postgres.sh`; exigir `[ok] backup salvo` e `[ok] cópia externa enviada ao R2`.
2. **Tags de rollback:** `docker tag montese-backend:latest montese-backend:rollback-<data>` (idem frontend).
3. **Build das imagens** a partir de cópia limpa (sem `node_modules`, `dist`, `.next`), `--build-arg GIT_COMMIT=<SHA>` no backend.
4. **Migration 0097** (aditiva, compatível com o código antigo; antes de trocar o código): `docker cp backend/db/migrations/0097_socio_empresa_acesso.sql montese_backend:/app/db/migrations/` e `docker exec montese_backend npm run db:migrate`. Esperado: aplica 1 arquivo; `_migrations` = 93 (se nada mais mudou). Falha ⇒ rollback do arquivo e PARAR.
5. **Trocar o código:** `cd /opt/Montese && docker compose up -d --no-deps --no-build backend frontend`; `docker exec montese_nginx nginx -s reload`.
6. **Verificar:** `/api/health` com o commit novo; `/atuacao/empresas` 200; 0 erros nos logs; `_migrations` = 93.
7. **Permissões:** conceder `empresas.read` (+ `clients.read`) e, se desejado, `empresas.documentos` em `/admin/permissoes-socios`.
**Rollback de código:** voltar as tags de rollback e repetir o passo 5. **Rollback de banco:** SQL no cabeçalho da 0097 (apaga antes `socio_permissions 'empresas.%'`).
