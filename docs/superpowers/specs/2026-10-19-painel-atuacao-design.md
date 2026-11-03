# Painel de Atuação Montese — Design (v1)

Data: 2026-10-19 · Status: aprovado em chat (seções 1–6), aguardando revisão do proprietário · Sem código escrito.

## 1. Objetivo e decisões de negócio

Dar ao Danilo e à Évelyn (sócios) uma área operacional própria, `/atuacao`, para atender a carteira de clientes Montese, sem acesso ao administrativo global.

Decisões já tomadas pelo proprietário:
- Carteira compartilhada entre os dois; tarefas individuais.
- Financeiro: leitura de todos os clientes Montese e indicadores gerais; nunca escrita.
- Gestão operacional ampliada dos cadastros, dentro de permissões delegadas.
- Cliente Montese = tenant **sem** vínculo em `tenant_technicians`/`tenant_partners` (inferência, opção 1).
- Papel novo `socio` (opção B): lista explícita de permissão, nega por padrão.

## 2. Estado atual (VERIFICADO no código)

- Papéis fixos: `empresa`, `tecnico`, `parceiro`, `admin` (CHECK em `users.role`, `0001_init`; ~150 `@Roles`).
- Não há camada de permissões granulares.
- RLS usa `app.role = 'admin'` como bypass; `subscriptions` tem `tenant_id` XOR `technician_user_id`.
- Financeiro: `payments/` (`PATCH subscriptions/:id/status`, `PATCH plans/:id`, webhook Mercado Pago); `admin-dashboard` (`alertas`, `financeiro`, `clientes-recentes`).
- Não existe módulo de tarefas nem de reuniões/interações. Existem `visit_requests`, `google-calendar`, ações corretivas.
- `documents` sem status de fluxo nem versionamento; assinaturas só específicas (EPI, inspeção).
- Auditoria: `backend/src/common/audit`.
- Atenção: a árvore tem trabalho não commitado (migration 0080) e a memória do projeto indica 0081–0083 em outro worktree. Conferir a numeração antes de criar migrations.

## 3. Autorização (papel `socio`)

- Migration: incluir `socio` no CHECK de `users.role` (e CHECKs de `assistant_query_log` se aplicável).
- Tabela `socio_permissions(user_id, permission)`; `PermissionsGuard` + `@RequirePermission(...)`, lido no servidor, nunca do token.
- Permissões v1: `clients.read`, `clients.update_operational`, `tasks.*`, `appointments.manage`, `documents.create_draft`, `documents.review`, `documents.sign` (por tipo e profissional), `finance.read`.
- **Não existem** `finance.write`, `billing.manage`, `users.manage`, `settings.manage`.
- Nenhum `@Roles` existente passa a incluir `socio`; só entra onde listado.
- `clients.update_operational`: lista fechada de campos no DTO. CNPJ, titularidade, plano, contrato e faturamento ficam fora.
- Teste de varredura: falha se algum endpoint aceitar `socio` sem `@RequirePermission`.
- Negações e alterações sensíveis vão para o audit-log.

## 4. Carteira e RLS

- Função `is_montese_tenant(tenant_id)`: verdadeira se não há nenhuma linha (qualquer status) em `tenant_technicians` nem `tenant_partners`. `SECURITY DEFINER`, `search_path` fixo (padrão 0055).
- Policies `SELECT` para `app.role='socio'` em `tenants` (somente Montese), tabelas operacionais necessárias, `subscriptions`, `plans`, `payment_events`.
- Escrita do `socio` apenas nas tabelas operacionais liberadas; **nunca** em `subscriptions`, `plans`, `payment_events`.
- Tenants de parceiros invisíveis por RLS, não só por filtro na API.
- `tenant_owners(tenant_id, user_id)` opcional: responsável, só para filtro/atribuição.
- Risco INFERIDO: tenant criado por técnico pode parecer Montese antes do vínculo. Verificar na Fase 0 se cadastro e vínculo ocorrem na mesma transação; cobrir com teste.
- Financeiro com DTO de saída explícito: sem tokens, payloads brutos ou dados do Mercado Pago.

## 5. Tarefas, agenda e interações (módulos novos)

- `tasks` (tenant_id, título, descrição, criador, responsável, prioridade, status, prazo, categoria, referência opcional a visita/ação corretiva) e `task_events` (histórico, somente INSERT).
- Estados: `pending`, `in_progress`, `blocked`, `awaiting_review`, `completed`, `cancelled`.
- Concluir tarefa não aprova nem assina documento.
- Agenda reaproveita `visit_requests` e `google-calendar`.
- `client_interactions` (data, participantes, decisões, próximos passos, arquivos) para reuniões e histórico.

## 6. Documentos e assinaturas

- Lacuna comprovada. Estados: rascunho → em revisão → aprovado → aguardando assinatura → assinado → publicado.
- Tabelas: `document_workflows`, `document_versions`, `document_signers` (profissional habilitado por tipo, registro profissional, data).
- Servidor recusa versão definitiva sem dados essenciais e nunca apresenta como aprovado/assinado fora do estado correspondente.
- Spec própria antes da implementação (Fase 5).
- **Decisão pendente do proprietário:** assinatura com valor legal (ICP-Brasil ou similar). Padrão desta v1: **fora de escopo**, apenas estados, responsáveis e trilha.

## 7. Interface

- Rota `/atuacao`, layout e menu próprios: Minhas tarefas, Clientes Montese, Agenda, Documentação SST, Atendimentos técnicos, Financeiro, Reuniões.
- Redirecionamento pós-login decidido pelo papel no servidor.
- Reaproveita componentes do `dashboard-v2`; não copia `/admin`.
- "Cliente ativo" = tenant Montese com assinatura ativa (via `subscription-access.service.ts`). Indicadores das APIs existentes, sem tabelas de cópia.
- Filtros por cliente, responsável, status e período; tarefas próprias diferenciadas; mensagens claras de ação negada; responsivo.

## 8. Testes

- Matriz positivo/negativo por papel (`admin`, `socio`, `empresa`, `tecnico`, `parceiro`).
- Varredura de controllers; testes de RLS (escrita negada em `subscriptions`/`payment_events`/`plans`; tenant de parceiro invisível; troca de IDs na URL).
- Regressão dos dashboards atuais; testes de UI (login, navegação, tarefas, financeiro).
- Execução em container descartável, nunca contra produção.
- Critérios de aceite: AC-01 a AC-15 da proposta original.

## 9. Fases

0. Auditoria somente leitura (inclui transação de cadastro do técnico e numeração de migrations).
1. Papel `socio`, permissões e guard.
2. Painel e carteira.
3. Tarefas, agenda e interações.
4. Financeiro somente leitura.
5. Documentos e assinaturas (spec própria).
6. Homologação com contas de teste.

Cada fase só avança após validação. Migrations exigem autorização do proprietário antes de aplicar.
