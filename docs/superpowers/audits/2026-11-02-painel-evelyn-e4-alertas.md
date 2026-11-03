# Painel da Evelyn — E4: alertas de vencimento e notificações (relatório de entrega)

**Data:** 2026-11-02 · **Estado:** implementado e verificado no ensaio descartável; **não commitado, não em produção**.
**Base:** worktree `/opt/montese-work/painel-release`. Migration nova: **0104** (depois da 0103). Desenho: `docs/superpowers/specs/2026-11-02-painel-e4-alertas-vencimento-design.md`.

## Achado que mudou o desenho (VERIFICADO)
`document_validity_rules` **já existia** (0079, em produção desde 2026-10-13): meses de validade por categoria (PGR 24, PCMSO 12), um único `alert_days`, e `documents.expires_source`/`validity_months_applied` mostram que `expires_at` já é calculado pela regra no upload. A E4 **reaproveita** essa tabela (colunas opcionais `notice_days INT[]` e `source`) em vez de criar outra.

## Decisões assumidas (padrões recomendados; o dono autorizou "prossiga")
Só dentro do sistema (e-mail NÃO implementado); job diário 06:30 America/Sao_Paulo; antecedências padrão 60/30/15/7/0; hoje tudo vai para os sócios ativos com `alertas.read` (Évelyn); lembrete mensal dos planos de ação fica para depois do B2.

## Entregue
- **0104**: `notice_days`/`source` na regra existente (CHECK por função IMMUTABLE: 1–8 valores, 0–365); `document_change_flags` (revisão por mudança: função, processo, equipamento, risco, estabelecimento, outro; não altera vencimento); `notifications` (privadas por usuário, só `read_at` muda, `href` só `/atuacao/...`); função `SECURITY DEFINER` `notifications_insert_batch` (dono `montese_auth_bypass`, só `app.role='admin'`, sem PUBLIC); permissões `alertas.read` e `alertas.manage` (sensível). Total de permissões: 23.
- **Job** `AlertasJobService` (`@Cron`, contexto admin, só carteira Montese): documentos (faixa = menor antecedência já atingida; vencido uma vez), tarefas atrasadas (responsável), correções atrasadas (responsável), revisões por mudança (todos). Idempotente por (usuário, chave). Texto genérico: tipo de documento + nome da empresa, nunca título/nota. Auditoria `alertas.job_run` só com contagens.
- **API** `/atuacao/alertas/regras` (GET/PUT), `/atuacao/alertas/mudancas` (GET/POST/resolver), `/atuacao/notificacoes` (lista, resumo, marcar lida, marcar todas).
- **Telas**: sino funcional no header com contador, `/atuacao/notificacoes`, `/atuacao/alertas` (antecedências por tipo e revisões por mudança), item no menu.

## Evidências (VERIFICADO no ensaio `montese_prodschema`, 0104 aplicada só lá)
- e2e novos: `alertas-rls` 6/6, `alertas.e2e` (HTTP + job) 9/9; unit `alertas-unit` 3/3.
- Regressão: `atuacao-permissoes` 14/14, `socio-access-matrix` 13/13; unit backend 2032/2034 (conhecidas: `r2-get-object`, `tenant-context-callsites` — a diferença desta última é de outros módulos, não do job, que foi registrado na lista).
- Frontend: vitest completo 1363 passando; 5 suítes de EPI não rodam por falta do `qrcode` no `node_modules` emprestado (ambiente); `tsc` limpo nos arquivos tocados.
- Armadilhas achadas: `ON CONFLICT DO NOTHING` exige policy de SELECT visível quando há conflito (resolvido com a função de lote, sem dar leitura ao admin); `audit_log.actor_role` é enum (job grava papel nulo).

## NÃO VERIFICADO
- QA visual; revisão de segurança independente (`montese-seguranca`) das migrations 0102–0104 (RLS, função SECURITY DEFINER, permissões); execução do `@Cron` no horário real (testado por chamada direta de `runOnce`); desempenho com carteira grande (limites de 5000 documentos/tarefas por execução); primeira execução em produção pode gerar uma rajada (um aviso por documento já dentro de 60 dias).
- Prazos PGR 2 anos / PCMSO 1 ano: já constam em produção como parâmetros operacionais (0079); NÃO conferidos contra norma oficial por mim.

## Pendências do dono
- Autorizar revisão de segurança, commit e release (ordem 0101→0102→0103→0104; backup antes).
- Conceder `alertas.read`/`alertas.manage` à Évelyn (as 23 permissões) e decidir se haverá e-mail diário.
- Executar o roteiro de desativação do Danilo (sem `alertas.read` ele já não recebe, mas a conta segue ativa até o roteiro).
