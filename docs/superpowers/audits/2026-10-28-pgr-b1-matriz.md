# PGR — Sub-projeto B1 (matriz de risco versionada e classificação) — relatório de entrega

**Data:** 2026-10-28 · **Estado:** implementado e verificado no ensaio descartável; **não commitado, não em produção**.
**Base:** worktree `/opt/montese-work/painel-release` sobre o commit `2e327a3` (Z + A). Pré-requisito: Z (0097) e A (0098) liberados antes; B1 = migration **0099**.

## 1. O que foi entregue
- **Migration `0099_pgr_matriz.sql`**: `pgr_matrix_versions` (global; só o admin escreve; sócio lê apenas publicada/arquivada; versão publicada imutável — config, hash e número congelados; status só avança rascunho→publicada→arquivada; DELETE e TRUNCATE bloqueados) e `pgr_risk_assessments` (por empresa, append-only; só aceita versão publicada; coerência de tenant com o risco). Triggers que impedem apagar risco ou GHE que tenham avaliações (exclusão de empresa inteira continua em cascata). Índice para o mapa de calor. Cabeçalho com rollback.
- **Funções puras** `matriz-config.ts`: validação (escalas, faixas sem lacuna/sobreposição, níveis, metodologia, lista branca de chaves, tetos de tamanho), cálculo, células do mapa, SHA-256 canônico.
- **API** `/atuacao/pgr/matriz` (admin: criar rascunho, editar, validar, publicar com controle de concorrência por `updated_at`, arquivar; sócio com `pgr.read`: ler versões e a vigente) e `/atuacao/pgr/empresas/:tenantId/riscos/:riscoId/avaliacoes` (classificação inerente e residual previsto, só na versão vigente; pontuação e nível calculados no servidor) e `mapa-calor`.
- **Telas:** `/admin/pgr-matriz` (editor, validação, prévia, publicar/arquivar com confirmação) e, no fluxo da empresa, nova etapa **Classificação** com cartão de avaliação por risco e mapa de calor.

## 2. Decisões (rulings do controlador; a confirmar pelo proprietário)
1. A matriz **nasce vazia**: nenhuma escala, faixa, nível ou texto normativo inventado (decisão do proprietário).
2. Matriz **global da Montese**; **só o admin publica/arquiva** (sem permissão nova para sócio).
3. Metodologia: severidade × probabilidade; "validada por", registro e data são texto informado pelo admin (publicar exige "validada por" e data; **registro é opcional** — decisão pendente).
4. Risco residual é **previsto** (informado pelo técnico).
5. Classificações só acrescentam registros; a vigente é a de maior número entre as publicadas; classificar exige a vigente (outra ⇒ 409 e a tela recarrega).
6. Cobertura de faixas: todo inteiro do menor ao maior produto possível deve estar em alguma faixa, sem sobreposição.
7. Mapa de calor: risco entra na célula só se a avaliação mais recente for da versão escolhida; as demais vão para "em outra versão" (+ contagem por versão).

## 3. Evidências (VERIFICADO no ensaio descartável `montese_prodschema`)
- Unit backend: 1960 passaram, 2 falharam (`r2-get-object`, `tenant-context-callsites`, pré-existentes); depois da rodada final, `pgr-` 111/111.
- E2E (um por vez, Redis zerado), antes da rodada final: pgr-matriz-rls 60, pgr-matriz 75, pgr-avaliacoes 15, pgr-rls 53, pgr-perigos 21, pgr-ghes 14, pgr-epi-catalogo 3, pgr-riscos 21, atuacao-empresas-rls 18, atuacao-empresas 33, atuacao-permissoes 14, atuacao-documentos 45, socio-access-matrix 13, tenant-isolation-sweep 10, auth 5. Depois da rodada final: pgr-matriz-rls 64, pgr-matriz 18, pgr-avaliacoes 15, pgr-rls 53, pgr-ghes 14, pgr-riscos 21, atuacao-empresas-rls 18, socio-access-matrix 13, tenant-isolation-sweep 10.
- Frontend: Vitest completo 1327 (antes da rodada final); `src/app/atuacao` + `src/app/admin` 549/549 e `tsc` ok (rodado pelo controlador depois da rodada final); ESLint sem erros nos arquivos do B1 (aviso antigo em `AdminBrand.tsx`); build ok.
- Varreduras: sem "assinatura digital"/"ICP-Brasil", sem rótulo de escala fixo no código, sem CPF/nascimento.
- NÃO VERIFICADO: QA visual (grade de 5 etapas no celular, contraste do mapa), integração com backend real além dos e2e, desempenho do mapa com dezenas de milhares de avaliações. Suíte e2e completa e unit completa **não foram reexecutadas após a rodada final** (apenas as listadas).

## 4. Revisões independentes
Revisão por tarefa (1, 2, 3, 4, 5) com rodadas de correção; revisão final de segurança do B1: 0 críticos, 2 importantes (classificar com versão antiga ainda publicada; apagar GHE apagava histórico) — corrigidos e re-revistos ("All addressed"). Ressalvas baixas aceitas: janela de corrida mínima entre checar a vigente e gravar (a avaliação fica na versão vigente no instante anterior); `updated_at` opcional na API de publicar (a tela sempre envia); texto do cabeçalho de rollback com ordem imprecisa.

## 5. Pendências do proprietário
1. Confirmar rulings 1–7. 2. Exigir **registro profissional** na metodologia ao publicar? 3. A regra de bloqueio de emissão "alto/crítico" (`bloqueia_emissao`) é só guardada; será aplicada na emissão (sub-projeto C). 4. Aplicar 0099 em produção (depois de 0097 e 0098) só com autorização, backup antes. 5. Parser de 300 KB para o corpo da matriz (config até 200 KB) e 2 MB na importação de perigos: confirmar `client_max_body_size` do nginx. 6. B2 (plano de ação, evidências com upload — risco ALTO) e C–E seguem pendentes; perguntas 8–12 da spec do B continuam abertas.
