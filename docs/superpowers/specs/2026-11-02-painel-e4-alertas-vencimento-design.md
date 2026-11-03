# Painel da Evelyn — E4: alertas de vencimento e notificações (desenho)

**Data:** 2026-11-02 · **Estado:** desenho APROVADO ("autorizado", 2026-11-02) e implementado; ver o relatório em `docs/superpowers/audits/2026-11-02-painel-evelyn-e4-alertas.md`.

> **CORREÇÃO pós-auditoria do código:** a seção 2a abaixo propunha criar `document_validity_rules`, mas essa tabela **já existe** (migration 0079, em produção: `category, validity_months, alert_days`, com PGR 24 e PCMSO 12 meses já semeados e rotas de admin em `/documents/validity-rules`). A implementação reaproveitou a tabela e só acrescentou `notice_days` e `source` (opcionais). Por isso a decisão 3 caiu (o `expires_at` já é calculado por essa regra no upload) e não existe etapa de "confirmação" de regra: os meses seguem como parâmetros operacionais do admin.
**Origem (respostas da engenheira):** alertas configuráveis de 60/30/15/7 dias e no vencimento; "a plataforma não deve tratar todos como documentos com vencimento anual"; PGR a cada 2 anos (planos de ação com alertas mensais), LTCAT segue o PGR, PCMSO 1 ano; "diferenciar documento vencido de documento que precisa de atualização por mudança nas condições de trabalho"; alertas técnicos e de aprovação para ela, operacionais para o técnico, críticos para ambos; calendário geral com filtros; alerta prioritário para vencidos, riscos graves, acidentes, exigências de fiscalização, assinatura perto do prazo, mudanças importantes.

## 1. O que já existe (VERIFICADO por leitura)
- Vencimento = `documents.expires_at` (+ `valid_from`, migration 0079), informado na publicação ou ajustado por `empresas.documentos`. Sem regra por tipo de documento: o prazo é sempre o que alguém digitou.
- Painel e `/atuacao/vencimentos`: faixas cumulativas vencidos / 7 / 15 / 30 dias da carteira Montese, calculadas na hora. **Não há** 60 dias, "no dia do vencimento" nem configuração.
- **Não há notificações dentro do sistema.** Há `EmailService` e jobs `@Cron` (`weekly-digest` da empresa, `visit-reminder`), que rodam como `role: 'admin'` e são idempotentes só por horário.
- Correções (0102) têm prazo, mas não geram alerta; tarefas têm prazo e "atrasadas" só aparecem no painel.

## 2. Proposta (tudo aditivo, nasce vazio)
**a) Regras de validade por tipo de documento** — `document_validity_rules` (categoria, modo `prazo_fixo` | `segue_outro` | `sem_vencimento_automatico`, meses, categoria-base quando "segue", antecedências em dias, **fonte/referência** obrigatória, status `rascunho|confirmada`). Só regra **confirmada** (pela engenheira) alimenta alerta ou calcula vencimento; sem regra, tudo continua como hoje. O sistema **não traz prazos prontos**: os valores citados pela Evelyn são cadastrados por ela com a fonte oficial (NÃO VERIFICADO contra norma; o campo de fonte existe para isso). "LTCAT segue o PGR" = `segue_outro`; "sem vencimento anual automático" = `sem_vencimento_automatico`.

**b) Dois estados distintos** (como ela pediu): *vencido* (prazo formal encerrado) e *revisão por mudança* — registro `document_change_flags` (documento ou empresa, motivo: função, processo, equipamento, risco, estabelecimento, nota curta, quem/quando, resolvido por quem). Aparece como alerta sem alterar o vencimento.

**c) Notificações internas** — `notifications` (usuário, tipo, prioridade, empresa/documento/tarefa referenciados, `dedupe_key` única, lida_em). Job diário (06:30 America/Sao_Paulo, mesmo padrão de contexto admin dos crons existentes) gera notificação **idempotente** por (documento, antecedência) e por correção/tarefa atrasada, sem repetir. RLS: cada sócio lê e marca só as próprias; ninguém mais.

**d) Roteamento por perfil**: técnicos/aprovação → Evelyn; operacionais (visita, coleta de dados) → o técnico (hoje não há; vai para a Evelyn até existir); críticos (vencido obrigatório, atraso) → todos os sócios ativos. Preferência por usuário das antecedências (padrão 60/30/15/7/0).

**e) Telas**: sino com contador e `/atuacao/notificacoes`; calendário/lista geral de vencimentos com filtros empresa, unidade, documento, prioridade, período (estende `/atuacao/vencimentos`); `/atuacao/alertas` para regras e preferências.

**f) E-mail (opcional, desligado)**: resumo diário com **só** título genérico, empresa e dias (sem dado pessoal/de saúde), via `EmailService`. Liga só com decisão do dono.

## 3. Riscos e limites
- Regra errada gera alerta errado ou falso conforto: por isso nasce vazia, exige fonte e confirmação, e o painel mostra "sem regra" explicitamente.
- Job em contexto admin lê a carteira inteira: restringir a `is_montese_tenant` e auditar a execução (contagens, sem títulos).
- Notificação não substitui o prazo legal; a IA não é autoridade normativa (regra do projeto).

## 4. Decisões do proprietário/engenheira
1. Canal: só dentro do sistema (recomendado) ou também e-mail diário?
2. Horário do job e antecedências padrão (60/30/15/7/0, ok?).
3. Como calcular o vencimento: a partir de `valid_from` + meses da regra (recomendado quando houver regra) ou continua a data digitada?
4. Quem recebe o quê enquanto só há uma sócia (tudo para a Evelyn)?
5. Lista de tipos de documento e prazos a cadastrar, com a fonte de cada um (ela cadastra pela tela).
6. Planos de ação "alertas mensais": lembrete recorrente por plano ou por tarefa? (depende do B2/plano de ação, ainda não construído).

## 5. Fatiamento (cada uma com testes, RLS e revisão independente)
- **E4a** migration (regras, change_flags, notifications, preferências) + RLS + permissão `alertas.manage` (regras/preferências) — nova permissão sensível a avaliar; catálogo e testes que fixam 21.
- **E4b** serviço de regras + cálculo de vencimento + API do calendário geral com filtros.
- **E4c** job de notificações idempotente + API de notificações (listar, marcar lida) + roteamento.
- **E4d** telas (sino, notificações, alertas, calendário) e integração no painel.
- **E4e** (se aprovado) e-mail diário.
- Risco: MÉDIO-ALTO (job com leitura ampla, regras que afetam prazos). Revisão `montese-seguranca` obrigatória.
