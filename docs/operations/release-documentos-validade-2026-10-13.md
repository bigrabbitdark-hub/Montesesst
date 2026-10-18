# Release — início e vencimento dos documentos (Correção 3) — 2026-10-13

> **Status: EXECUTADO em 2026-10-13, ~14:17 UTC.** As etapas em produção foram executadas pelo proprietário, com comandos preparados pelo orquestrador. Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO.

## 1. O que entrou em produção

Branch `release/documentos-esocial-20261013`, commit `8b9e5bf`, que une quatro frentes:

| Frente | Origem |
|---|---|
| Menu lateral por setores | `39de7d2` (já no frontend desde a manhã de 13/10) |
| eSocial, ASO e acidentes | `fd3cd19` (`feat/esocial-transmissao`; código que rodava solto desde 07/10, agora commitado) |
| Cadastro por CNPJ | `bd91369` e `23fb07a` (release das 13h31 de 13/10) |
| Início e vencimento de documentos | `06b36f3` + `d427610` (`feat/documentos-validade`) |

Conflito único na união: `frontend/src/lib/dashboard/menu.ts`. Decisão do proprietário: o item eSocial do menu continua "em construção"; as telas do painel entram no código sem link.

Imagens: `montese-backend:candidate-docs-20261013` e `montese-frontend:candidate-docs-20261013`, hoje também `latest`. Retorno: tags `pre-docs-20261013`.

## 2. Migration `0079_document_validity.sql`

Aditiva, idempotente, sem backfill. Renumerada de 0078 para 0079 porque o 0078 foi usado pelo release de CNPJ.

- `documents`: + `valid_from DATE`, `expires_source TEXT` (`manual` | `rule`), `validity_months_applied INT`, todas nulas; CHECK `expires_at >= valid_from`. `expires_at` e a policy `documents_isolation` não mudam.
- `document_validity_rules` (global, sem `tenant_id` e sem RLS, padrão de `epi_catalog_items`): 12 categorias; `pcmso` = 12 meses, `pgr` = 24, demais `NULL` (sem vencimento automático); `alert_days` = 30.
- **São parâmetros operacionais configuráveis, não prazos legais.** A base normativa do repositório (rascunho, não validada) não sustenta um padrão de 2 anos para os demais tipos; cada tipo fica sem vencimento automático até o proprietário definir.

## 3. Comportamento

- Envio: `valid_from` informado pelo usuário (nunca a data do upload). O servidor calcula `expires_at` pela regra e revalida; data manual diferente do cálculo fica `manual`.
- Lista: `valid_from`, `expires_at` (`AAAA-MM-DD`), `situacao` (`valido`, `vencendo`, `vencido`, `sem_vencimento`). Registros antigos: "Não informado" / "Não definido".
- `PATCH /documents/:id/validity`: só quem enviou o documento ou admin (mesma regra do DELETE).
- `GET /documents/validity-rules` (autenticado) e `PATCH /documents/validity-rules/:category` (só admin, garantido na aplicação). Mudar a regra não recalcula documentos salvos.
- Dashboard, conformidade por NR e e-mail semanal continuam lendo `expires_at`, sem alteração e sem notificação nova.

## 4. Evidência (VERIFICADO em 2026-10-13, branch de release)

- Backend: `tsc` sem erro; unitários 936 de 937 (falha pré-existente em `r2-get-object.unit-spec.ts`).
- Frontend: typecheck sem erro; vitest 418 de 418.
- Banco descartável (Postgres e Redis próprios, sem credencial nem dado de produção): 74 migrations aplicadas até a `0079`; e2e de documentos, isolamento entre tenants, cadastro e eSocial: 153 passando; as 19 falhas são idênticas às da versão `bd91369` (testes que exigem R2 real ou permissões que o ensaio não reproduz).
- Boot isolado das candidatas: backend `/health` 200; frontend `/login` 200.
- Pós-release: `/api/health` → `8b9e5bf-docs-20261013`; `/login` e `/empresa/documentos` 200; rotas novas 401 sem login; zero erros no log do backend nos primeiros minutos; backup `montese-20261013-141710.dump`.
- Revisões independentes (Claude Sonnet): QA e segurança, duas rodadas, "aprovado com ressalvas"; achados altos e médios corrigidos e reverificados.

## 5. NÃO VERIFICADO

- Registro da `0079` em `_migrations` de produção (leitura do banco de produção bloqueada para o orquestrador; indício: backend novo no ar sem erro de coluna ausente).
- Funcionalidade em navegador real e upload real para o R2 com o código novo.

**Atualização (2026-10-13):** o proprietário testou no navegador e confirmou que está funcionando. Com isso a `0079` em produção fica INFERIDA como aplicada (a lista de documentos depende das colunas novas).

## 6. Pendências

- Tela de admin para editar as regras (hoje só pela API).
- Decidir os meses de `ltcat`, `lip`, `laudo`, `ficha_epi`, `treinamento` e das categorias da CIPA.
- Decisão de uso: a empresa não edita as datas de documento enviado pelo técnico.
- Trava de escrita das regras no banco (REVOKE ou RLS) — recomendada pela revisão de segurança como defesa extra.
- Os e2e `documents-validity` alteram regras globais durante a execução: só rodar em banco descartável.
- Push de `feat/documentos-validade` e `release/documentos-esocial-20261013`.

## 7. Rollback

`docker tag montese-backend:pre-docs-20261013 montese-backend:latest`, idem frontend, e `docker compose up -d --no-deps backend frontend`. A migration pode ficar: o código anterior ignora as colunas novas.
