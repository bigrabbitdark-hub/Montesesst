# Release — Painel da Évelyn (Z, PGR A/B1, D0–D2, E1–E5a) — 2026-11-03

> **Status: PREPARADO, NÃO EXECUTADO em produção** (exceto o backup). Branch `release/painel-evelyn-20261103` (merge `c5f1465`) = `feat/painel-evelyn-e1-e5` + termo de EPI `1921492` (que já roda em produção). Sem push. Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO.

## 1. Estado de produção (VERIFICADO em 2026-11-03, leitura)
- `/api/health` → commit `1921492` (`release/epi-termo-20261101`). `_migrations`: 92 registros, última `0096`.
- Faltam em produção: `0097`, `0098`, `0099`, `0100` (Z, PGR A/B1, D2) e `0101`–`0105` (esta entrega). Roles `montese_app` e `montese_auth_bypass` (BYPASSRLS) existem (a 0104 exige a segunda).
- Évelyn existe (sócia, ativa). Há 2 sócios ativos (Évelyn e Danilo), 14 permissões cada.
- Backup pré-release: `/opt/montese-backups/postgres/montese-20261103-024807.dump` (25 MB, `pg_restore -l` lê 95 tabelas de dados) e no R2 `backups/postgres/montese-20261103-024807.dump` (MD5 do envio `cdf1379014e5ff6b5ebd63346d21b9b0`).

## 2. O que entra
Painel dos sócios: atuação por empresa, PGR inventário e matriz de risco, tarefas com espera, carteira explícita (0101), correções de documento (0102), checklists com aprovação técnica (0103), alertas de vencimento e notificações (0104, inclui RLS em `document_validity_rules`), vínculo LTCAT/LIP/laudo→PGR (0105; só banco, sem tela ainda). Documentação: `docs/superpowers/audits/2026-11-0{1,2}-*.md`.

## 3. Evidência (VERIFICADO em banco descartável)
- Migrations 0001–0105 aplicadas do zero: 0 falhas (a 0097 não entrou nessa conta de 99; o script antigo a pula).
- e2e: alertas-rls 7/7, alertas 9/9, documento-correcoes-rls 8/8, checklists-rls 8/8, checklists 5/5, documento-base-pgr-rls 3/3, atuacao-documentos 45/45, atuacao-permissoes 14/14, socio-access-matrix 13/13, documents-validity 31/31.
- Unitários backend 2032/2034 (falhas pré-existentes `r2-get-object` e `tenant-context-callsites`); frontend vitest 1363 (5 suítes de EPI sem `qrcode` no ambiente emprestado).
- Revisão de segurança independente: 0 crítico/alto; 1 médio + 5 baixos corrigidos.
- **NÃO VERIFICADO:** QA visual; aplicação das migrations 0097–0100 sobre o banco REAL de produção (dados reais); boot das imagens candidatas (ver §4).

## 4. Imagens (candidatas, ainda não no ar)
`montese-backend:candidate-painel-20261103` e `montese-frontend:candidate-painel-20261103` (build limpo de `git archive`, `GIT_COMMIT=c5f1465-painel-20261103`). Retorno já criado: `montese-backend:pre-painel-20261103` e `montese-frontend:pre-painel-20261103`.

## 5. Sequência (🔒 cada passo é do proprietário; a ordem importa)
1. Conferir: `curl -sk https://localhost/api/health -H 'Host: www.montesesst.com.br'` deve mostrar `1921492` (se mudou, outra sessão publicou: parar e refazer o merge). Nenhuma outra sessão mexendo em produção.
2. Migrations, uma por vez, superusuário, transação única, registro em `_migrations` na mesma transação (**nunca `npm run db:migrate`**):
```bash
M=/opt/montese-work/painel-release/backend/db/migrations
for n in 0097_socio_empresa_acesso 0098_pgr_inventario 0099_pgr_matriz 0100_tarefas_status_espera \
         0101_socio_portfolio 0102_documento_correcoes 0103_checklists 0104_alertas_vencimento 0105_documento_base_pgr; do
  docker cp "$M/$n.sql" montese_postgres:/tmp/$n.sql || break
  docker exec montese_postgres sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" --single-transaction -v ON_ERROR_STOP=1 \
    -c \"SET lock_timeout='5s'\" -f /tmp/$n.sql -c \"INSERT INTO _migrations (name) VALUES ('$n.sql')\"; rm -f /tmp/$n.sql" || { echo "FALHOU $n"; break; }
done
```
   Parar na primeira falha (a transação desfaz aquela migration). Conferir: `SELECT max(name), count(*) FROM _migrations;` → `0105_documento_base_pgr.sql`, 101; RLS e FORCE em `document_corrections`, `notifications`, `document_validity_rules`.
3. Backend e frontend (depois das migrations):
```bash
cd /opt/Montese
docker tag montese-backend:candidate-painel-20261103 montese-backend:latest
docker tag montese-frontend:candidate-painel-20261103 montese-frontend:latest
docker compose up -d --no-deps backend frontend
```
   Conferir `/api/health` → `c5f1465-painel-20261103`, `docker ps`, log do backend sem erro, `/login` 200, rotas `/api/atuacao/notificacoes/resumo` 401 sem login.
4. Évelyn faz login; o admin (tela `/admin/permissoes-socios`) concede as 23 permissões, define as 5 ações na matriz de documentos e confirma o registro profissional dela. Nada disso entra por SQL ou seed.
5. Só então desativar o Danilo: `docs/operations/desativar-socio-danilo-2026-11-01.md` (preferir a tela de admin; o SQL do roteiro foi corrigido com os nomes reais).
6. Observar o job de alertas das 06:30 (America/Sao_Paulo): a primeira execução pode gerar uma rajada de notificações para a Évelyn.

## 6. Rollback
- Código: `docker tag montese-backend:pre-painel-20261103 montese-backend:latest` (idem frontend) e `docker compose up -d --no-deps backend frontend`. As migrations são aditivas e o código anterior as ignora, **exceto** efeitos de RLS/trigger novos (0101 muda a carteira dos sócios; 0104 liga RLS em `document_validity_rules`: o admin continua escrevendo).
- Banco: rollback manual no cabeçalho de cada migration (destrutivo, só com autorização) ou restauração do dump acima (`pg_restore --clean`, só com autorização explícita).

## 7. Pendências conhecidas
Telas de E5 (vínculo e visão por empresa), e-mail diário de alertas, QA visual, itens dos checklists (a Évelyn cadastra), conferência dos prazos PGR/PCMSO contra fonte oficial, push da branch (decisão do proprietário).
