# Release — Painel da Évelyn, E5 (vínculo LTCAT/LIP/laudo → PGR) — 2026-11-03

> **Status: PREPARADO, NÃO EXECUTADO em produção.** Branch `release/painel-e5-20261103` (commit `ee55b14`, linear sobre `release/painel-evelyn-20261103` = `c5f1465`). Sem migration nova. Sem push. Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO.

## 1. O que entra
- API: `base_draft_id` na criação de documento, `PATCH /atuacao/documentos/:id/base`, `GET /atuacao/documentos/empresa/:tenantId/tecnicos`; detalhe do documento com `base`, `derivados` e `avisos_base` (informativos).
- Job de alertas (06:30 SP): nova fonte `pgr_base` (reusa o tipo `revisao_por_mudanca`), um aviso por documento e versão do PGR-base, texto genérico.
- Telas: seção "PGR-base" no detalhe do documento; aba "Documentos técnicos" (6ª) na página da empresa.
- A coluna `base_draft_id` e a trigger já estão em produção (migration 0105, aplicada em 2026-11-03).

## 2. Evidência (VERIFICADO em banco descartável)
- e2e: `documento-base-pgr` 5/5, `alertas.e2e` 10/10, `documento-base-pgr-rls` 3/3, `atuacao-documentos` 45/45, `atuacao-painel` 16/16, `atuacao-permissoes` 14/14, `socio-access-matrix` 13/13; unitários novos 7/7.
- Frontend: vitest 1370 (5 suítes de EPI sem `qrcode` no ambiente emprestado); `tsc` sem erro.
- **NÃO VERIFICADO:** QA visual; efeito do job sobre dados reais.

## 3. Imagens e retorno
Candidatas: `montese-backend:candidate-painel-e5-20261103` e `montese-frontend:candidate-painel-e5-20261103` (`GIT_COMMIT=ee55b14-painel-e5-20261103`). Retorno já criado: `montese-backend:pre-painel-e5-20261103` e `montese-frontend:pre-painel-e5-20261103` (= o que está no ar, `c5f1465-painel-20261103`).

## 4. Sequência (🔒 do proprietário)
1. Conferir: `curl -sk https://localhost/api/health -H 'Host: www.montesesst.com.br'` deve mostrar `c5f1465-painel-20261103`.
2. Backup do dia (`bash /opt/Montese/ops/backup-postgres.sh`; o cron das 03:00 UTC também serve se for do mesmo dia) — não há migration, mas é o procedimento padrão.
3. Trocar as imagens:
```bash
cd /opt/Montese
docker tag montese-backend:candidate-painel-e5-20261103 montese-backend:latest
docker tag montese-frontend:candidate-painel-e5-20261103 montese-frontend:latest
docker compose up -d --no-deps backend frontend
```
4. Conferir `/api/health` → `ee55b14-painel-e5-20261103`, `docker ps`, log do backend sem erro, `/login` 200, `/api/atuacao/documentos/empresa/<uuid>/tecnicos` 401 sem login.
5. Fazer isso **depois** de conferir o primeiro disparo do job das 06:30 SP (09:30 UTC), para não misturar causas se a primeira rajada de notificações surpreender.

## 5. Rollback
`docker tag montese-backend:pre-painel-e5-20261103 montese-backend:latest` (idem frontend) e `docker compose up -d --no-deps backend frontend`. Sem migration para desfazer; o vínculo gravado em `base_draft_id` fica inerte no código anterior.

## 6. Pendências
`ltcat` na matriz da Évelyn (5 ações, pela tela de admin); QA visual; e-mail diário de alertas (decisão do proprietário).
