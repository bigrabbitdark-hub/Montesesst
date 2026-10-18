# Estado do projeto — Montese SST

Última atualização: 2026-10-13, ~14:30 UTC (após o release de documentos). Para atualizar: peça `/relatorio` e diga "atualize o estado".
Rótulos: VERIFICADO (conferido), INFERIDO, NÃO VERIFICADO.

## Produção (VERIFICADO em 2026-10-13 por `/api/health`, `docker ps` e respostas HTTP)
- Backend e frontend rodam o commit `8b9e5bf` (`release/documentos-esocial-20261013`): menu por setores + eSocial/ASO/acidentes + cadastro por CNPJ + início e vencimento de documentos. `/api/health` → `8b9e5bf-docs-20261013`.
- Imagens de retorno: `montese-backend:pre-docs-20261013` e `montese-frontend:pre-docs-20261013` (estado do release de CNPJ das 13h31).
- Migrations em produção, segundo os documentos de release: até `0072`, mais `0076`–`0078` (CNPJ) e `0079` (validade de documentos). **NÃO VERIFICADO diretamente**: a leitura do banco de produção é bloqueada para o orquestrador.
- Item eSocial do menu: "em construção" (o painel está no código, sem link).
- Notas: `docs/operations/release-documentos-validade-2026-10-13.md` e `release-cnpj-cadastro-filial-2026-10-13.md`.

## Código e git (VERIFICADO em 2026-10-13)
- No GitHub: `main` (`b516f21`), `feat/noticias-sstnews` (`39de7d2`), `feat/conformidade-por-nr`, `feat/esocial-transmissao` (`fd3cd19`), `release/cnpj-backend-20261013`, `release/cnpj-frontend-20261013`, `release/documentos-esocial-20261013` (`8b9e5bf`, o que está em produção) e `feat/documentos-validade` (`d427610`), as duas últimas enviadas em 2026-10-13.
- **Só na VPS, sem cópia no GitHub:** `feat/tabela-oficial-funcionarios`, `docs/esocial-auditoria-2026-10-04`, `wip/auditoria-cruzada-pdf-base`, `worktree-dashboard-inicio-fase1`, `worktree-documentos-referencia-sst`, `worktree-esocial-sst-subprojeto1`.
- Pasta principal `/opt/Montese` em `feat/noticias-sstnews` com **131 alterações não commitadas** (base normativa, auditoria SST/pente-fino, orquestração, documentos de projeto). Há pelo menos outra sessão trabalhando nela (cadastro/CNPJ, tabela de funcionários).
- `main` não contém nada do que está em produção desde 30/09: está 20+ commits atrás da branch de release.
- Removidos em 13/10: branch e pasta `agente/tarefa-002`, pasta `/opt/montese-release-menu`, ensaio `docval_*`.

## Em andamento / aguardando decisão do proprietário
1. Push das branches de trabalho único que ainda estão só na VPS (lista acima).
2. **Levar o release para a `main`** (ou definir qual branch é a referência de produção).
3. Validade de documentos conferida no navegador pelo proprietário em 2026-10-13 ("funcionando"); o que isso implica: migration `0079` aplicada em produção (INFERIDO).
4. Validade de documentos: meses de `ltcat`, `lip`, `laudo`, `ficha_epi`, `treinamento` e CIPA; tela de admin para as regras; se a empresa pode editar datas de documento enviado pelo técnico; trava de escrita das regras no banco.
5. Em qual branch entra a **base normativa** (migrations `0063`, `0073`–`0075`, regras em rascunho) e a janela de release. Nenhuma regra está validada por profissional (nome e registro).
6. **Riscos de IA/LGPD** (relatório de 2026-10-12): nome de terceiros e dado de saúde em PGR/LTCAT/LIP podem ir ao modelo na auditoria SST.
7. Liberar ou não o painel do eSocial no menu (depende de ação do proprietário e de certificado A1 real).
8. Crédito de embeddings no OpenRouter.
9. `docs/roadmap.md` defasado (última alteração em 2026-09-23; não registra conformidade por NR, monitor normativo, eSocial, CNPJ, validade de documentos).
10. Lint do frontend: 3 avisos antigos (`MatrizForm`, `FireSafetyEquipmentPanel`, `AdminBrand`).
11. Sobras a limpar: branches `backup-antes-github` e `worktree-agent-a201f32f14eb2bb01` (já contidas em outras), worktree temporário `wt-noticias`, container `montese_sst_audit_redis_test`, imagens `candidate-*` e `builder-*` antigas.

## Testes e ambiente
- Testes com banco devem rodar em **ensaio descartável** (Postgres e Redis próprios, senhas aleatórias, chaves falsas), nunca contra produção. Os e2e `documents-validity` alteram regras globais durante a execução.
- `run-backend-tests.sh` carrega o `.env` de produção: os agentes não devem usá-lo (um agente o usou em 13/10 apesar da proibição; só unitários, nenhum valor impresso).
- No ensaio, 19 e2e falham igual com e sem o código novo (exigem R2 real ou permissões que o ensaio não reproduz); o unitário `r2-get-object` falha na base.
- A trava da sessão do orquestrador bloqueia push, deploy em produção e leitura do banco de produção: esses passos são executados pelo proprietário com comandos preparados.

10. **Repositório do GitHub (bigrabbitdark-hub/Montesesst) parece PÚBLICO** (consulta anônima respondeu HTTP 200 em 2026-10-14). Ação do proprietário: Settings > Danger Zone > Change repository visibility > Make private. Depois: varredura do histórico por chaves/senhas reais e troca do que tiver vazado. Três planos em docs/ têm senhas de EXEMPLO de teste (não confirmado que sejam só de teste).

## Infraestrutura (VERIFICADO em 2026-10-13)
VPS Ubuntu 24.04, 4 vCPU, 15 GB; 6 containers `montese_*` no ar; backups em `/opt/montese-backups/postgres` (último: `montese-20261013-141710.dump`). Produção e agentes dividem a mesma máquina.

## Equipe de agentes
Ver `orquestracao/README.md` e `orquestracao/agentes.conf`. Decisões em `docs/architecture/decisoes.md`.
