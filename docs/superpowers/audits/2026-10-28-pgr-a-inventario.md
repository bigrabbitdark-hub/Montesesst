# PGR — Sub-projeto A (biblioteca de perigos, GHE e inventário) — relatório de entrega

**Data:** 2026-10-28 · **Estado:** implementado e verificado no ensaio descartável; **nada commitado, nada em produção**.
**Base:** worktree `/opt/montese-work/painel-release` (linhagem de produção) + Z (migration 0097) ainda não commitado. **Pré-requisito: Z liberado antes do A.**

## 1. O que foi entregue
- **Migration `0098_pgr_inventario.sql`**: `pgr_hazards`, `pgr_ghes`, `pgr_ghe_positions`, `pgr_risks`, `pgr_risk_controls`, `pgr_risk_measurements`; FORCE RLS (admin; sócio só em cliente Montese via `is_montese_tenant`; perigo global só o admin escreve); triggers de coerência de tenant pai→filho (inclui `document_id`), guarda de imutabilidade de `tenant_id`/`scope`; CHECK de `socio_permissions` com 18 valores; índice único parcial (GHE, perigo); CHECK de tamanho do JSON psicossocial. Cabeçalho com rollback.
- **Permissões** `pgr.read` e `pgr.write` (não sensíveis; `pgr.write` só vale com `pgr.read`).
- **API** `/atuacao/pgr/**`: biblioteca (CRUD, duplicar, inativar, exportar, importar admin ≤500), GHEs/cargos/expostos/`resumo`, riscos/controles/medições (perigo COPIADO; edição da biblioteca não altera riscos), `cargos` e `epi-catalogo` (leitura).
- **Telas** `/atuacao/pgr` (visão geral), `/atuacao/pgr/perigos` (biblioteca) e `/atuacao/pgr/empresas/[tenantId]` (Empresa → Responsáveis → Ambientes → Riscos). Matriz, Plano de ação e Emissão: cartões "Em breve".

## 2. Decisões de projeto (rulings)
- A biblioteca **nasce vazia**: nenhum perigo, limite ou código da Tabela 24 inventado.
- `exposure_type` pode ser NULL ("não informado"); risco só vira `completo` com exposição e tipo de avaliação; `status` do controle é obrigatório (sem padrão presumido).
- Registros profissionais não são exibidos ao sócio (API é admin): a etapa Responsáveis mostra "Registro profissional não cadastrado ou indisponível para consulta". O representante da empresa não é gravado.
- `grau_risco` não existe no cadastro: o resumo devolve `null` e não conta como pendência.
- Sócio sem empresa selecionada vê só perigos globais. Admin também fica restrito à carteira Montese.
- Sem commits por agentes; ledger em `.superpowers/sdd/2026-10-27-pgr-a-inventario/progress.md` (git-ignored).

## 3. Evidências (VERIFICADO no ensaio descartável `montese_prodschema`, não é dump de produção)
- E2E (um por vez, Redis zerado): pgr-rls 53, pgr-perigos 21, pgr-ghes 14, pgr-epi-catalogo 3, pgr-riscos 21, atuacao-permissoes 14, socio-access-matrix 13, tenant-isolation-sweep 10 (execução final do implementador); na rodada anterior, também atuacao-empresas-rls 18, atuacao-empresas 33, atuacao-documentos 45, auth 5 (agente de QA).
- Unit backend: 1888/1891; falhas: `tenant-context-callsites` e `r2-get-object` (pré-existentes) e `employee-document-text` (flake de carga; 26/26 isolado). `tsc` e `build`: ok.
- Frontend: vitest `src/app/atuacao` 224/224 (rodado pelo controlador), suíte completa 1239 (QA), `tsc` ok, build ok, ESLint nos arquivos do PGR limpo. **ESLint global falha (11 erros, 3 avisos) em arquivos que este trabalho não tocou** (pré-existente, VERIFICADO por `git status`).
- Varreduras: 0 "assinatura digital"/"ICP-Brasil"; sem INSERT de seed; sem CPF/nascimento em colunas ou respostas.
- NÃO VERIFICADO: QA visual/responsividade em navegador; integração com backend real além dos testes; desempenho com muitos GHEs/funcionários (`EXPLAIN`).

## 4. Revisões independentes
Cada tarefa teve revisão de outro agente; Tasks 1, 4, 5, 6, 7 tiveram rodadas de correção. Revisão final de segurança (todo o A): 0 críticos, 2 importantes (admin alcançava parceiro na biblioteca; sócio sem empresa via perigos de todos os clientes) e vários menores — corrigidos e re-revistos. Ressalva baixa aceita: parser JSON de 2 MB da importação é lido antes da autenticação (mesma natureza da rota pública de assinatura).

## 5. Pendências e decisões do proprietário
1. **Carga inicial da biblioteca** (equipe técnica): sem ela o módulo abre vazio. Falta UI de admin; hoje só pela API `POST /atuacao/pgr/perigos/importar`.
2. **Grau de risco (NR-04)** no cadastro da empresa: campo novo ou tabela oficial CNAE→grau.
3. **Registros profissionais para o sócio** (permissão `documents.view_registration` ou endpoint próprio) para a etapa Responsáveis.
4. **Retenção** dos dados do PGR (prazo vem de fonte oficial; nada estimado) e base legal LGPD (também pendente do Z).
5. **Nginx**: import de 2 MB — confirmar `client_max_body_size` (hoje 110m no que foi lido); limitar por IP é opcional.
6. Menores estacionados: listagem de riscos devolve texto longo (LIMIT 500, sem paginação), `value/unit` das medições são texto livre, `status_code` da auditoria fixo em 200, registro profissional só validado na aplicação, controles/medições sem edição, foco ao trocar de etapa.
7. Sub-projetos B–E (matriz/plano, emissão PDF/versões, Tabela 24/S-2240/PCMSO, assinatura) não iniciados.
8. Commit e liberação: somente com ordem expressa.
