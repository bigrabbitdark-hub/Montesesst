# Painel do Danilo — D2 (tarefas com status de espera, encaminhar, histórico de atendimento) — relatório

**Data:** 2026-10-29 · Base: `63c95b5` (D1). Migration **0100** (aditiva). Sem permissão nova. Sem push/deploy.

## Entregue
- **Migration 0100:** amplia `tasks.status` com `awaiting_client`, `awaiting_execution`, `awaiting_efficacy` (rollback converte para `blocked`, sem perder tarefas). Aplicada só no banco de ensaio.
- **Backend:** transições livres entre estados abertos (concluída/cancelada finais; concluir só de em andamento ou espera); `POST /atuacao/tarefas/:id/encaminhar` (outro sócio ativo, nota ≤500 só em `task_events`, auditoria com ids); `GET /atuacao/interacoes` (histórico global da carteira, paginado, resumo ≤200 chars); painel ganha contagens por categoria de espera e pendência `tarefa_aguardando`.
- **Frontend:** novos status e rótulos ("Aguardando avaliação técnica" para `awaiting_review`), Encaminhar e Assumir tarefa, página `/atuacao/atendimentos` + menu "Histórico de atendimento", bloco "Pendências por categoria" no dashboard.

## Evidências (VERIFICADO no ensaio descartável)
Unit 2010/2012 (falham `tenant-context-callsites` e `r2-get-object`, pré-existentes; `epi-ficha-pdf` só sob carga, 18/18 isolado); `tsc`/build ok; e2e novos: tarefas-status-espera 17, atuacao-tarefas-espera 8, atuacao-interacoes-lista 7, atuacao-painel 16; regressões verdes (agenda 29, carteira 13, financeiro 21, empresas 18+33, permissoes 14, documentos 45, access-matrix 13, isolation-sweep 10, pgr-matriz 82, pgr-avaliacoes 15, pgr-riscos 21, pgr-rls 53, auth 5); `atuacao-tarefas` teve timeout de `beforeAll` na 1ª rodada e passou 28/28 isolada (flake de arranque). Frontend: vitest 1433 (verificação) / 651 em atuacao+admin após a última correção, tsc, build ok; ESLint só com o aviso antigo de `AdminBrand.tsx`. As falhas de `tenant-context-callsites` listam `employees`, `esocial/certificates`, `esocial/events` — arquivos não alterados por este trabalho (git status).
Revisões independentes: backend aprovado (sem críticos/importantes); frontend aprovado (minors tratados: Assumir tarefa, avisos, foco).
NÃO VERIFICADO: QA visual, integração navegador↔backend reais.

## Dívidas / pendências
Auditoria de `encaminhar` e da lista global é gravada após o commit (padrão do módulo); teste e2e do painel pode ficar intermitente com ≥20 pendências de outros tipos; nota de encaminhamento é texto livre (UI avisa para não incluir dados pessoais/de saúde); evento `assigned` mostra "Responsável alterado" sem nomes.
