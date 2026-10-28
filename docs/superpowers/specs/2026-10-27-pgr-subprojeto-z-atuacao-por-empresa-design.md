# Sub-projeto Z — Atuação por empresa (seletor de empresa dos sócios) (spec)

**Data:** 2026-10-27 · **Estado:** rascunho para revisão do proprietário (nada implementado, nada commitado).
**Base de código:** `/opt/montese-work/painel-release` (linhagem de produção). Migrations a partir de **0097**.
**Posição:** fundação anterior ao PGR (ver `2026-10-27-pgr-subprojeto-a-design.md`, §12). Ordem: Z → A → B → C → D → E.

## 1. Objetivo
Danilo Berto e Évelyn Souza atendem os clientes assinantes. Precisam escolher uma empresa na tela deles e, dentro dela, consultar tudo, organizar documentação e vencimentos e executar tarefas, sem trocar de conta e sem ganhar poder de edição sobre os cadastros sensíveis do cliente.

## 2. Decisões do proprietário (2026-10-27)
1. Os dois sócios têm acesso liberado a **todas as empresas clientes Montese**, com seletor de empresa.
2. Dentro da empresa: **leitura de toda a área**; **escrita só em documentos e vencimentos/tarefas** (e nas tabelas do PGR, no sub-projeto A).
3. Leitura ampla de dados de funcionários pelos sócios: **aprovada pelo proprietário** como parte da prestação do atendimento. O registro formal da base legal e a política de retenção (proposta em `docs/compliance/2026-10-20-painel-atuacao-retencao-lgpd-proposta.md`) seguem como pendência documental do proprietário; o agente não afirma base legal.
4. "Todas as empresas" = clientes Montese (tenant sem vínculo em `tenant_technicians`/`tenant_partners`, função `is_montese_tenant`); empresas de parceiros ficam fora (INFERIDO; confirmar).

## 3. Reuso e achados (VERIFICADO)
- Padrão atual de escopo por empresa: `epi/tenant-scope.util.ts` (`resolveTenantScope`): técnico/parceiro/admin enviam `tenant_id`, que **nunca amplia o escopo**; a RLS (`assigned_tenant_ids_for_current_user()`, usada em ~20 migrations) é a barreira. Empresa usa o `tenantId` do JWT.
- O sócio tem hoje policies de SELECT só em `tenants`, `subscriptions`, `company_units`, `payment_events` e nas tabelas do painel. `RolesGuard` nega `socio` por padrão em rotas que não o listam.
- Telas existentes de atendimento: `/tecnico/empresas/[tenantId]/...` (técnico) e `/empresa/*` (empresa). Serviços de backend de documentos, funcionários, EPI etc. já aceitam o contexto por `withTenantContext`.

## 4. Abordagens avaliadas
| | Abordagem | Avaliação |
|---|---|---|
| 1 | Incluir o sócio em `assigned_tenant_ids_for_current_user()` | Rápido, mas essas policies são `FOR ALL`: o sócio ganharia **escrita** em funcionários, EPI, CIPA, eSocial etc. Contraria a decisão 2. **Rejeitada.** |
| 2 | **Função e policies próprias, só de leitura, + rotas `/atuacao/empresas/:tenantId/*` que reutilizam os serviços existentes** (recomendada) | Escrita liberada tabela a tabela e só onde decidido; cada acesso auditado; sem mexer nas policies de técnico/empresa. Mais trabalho. |
| 3 | Adicionar `socio` ao `@Roles` dos controllers existentes | Reutiliza telas, mas espalha a permissão por dezenas de rotas e depende de cada uma lembrar de restringir escrita. **Não recomendada.** |

## 5. Desenho (abordagem 2)
**Banco (migrations ≥ 0097, aditivas)**
- Função `socio_company_ids()` (SECURITY DEFINER, dono `montese_auth_bypass`, search_path fixo): retorna os tenants Montese **se** `app.role = 'socio'`; vazio para os demais.
- Policies `FOR SELECT` para `socio` (`tenant_id IN (SELECT socio_company_ids())`) na área da empresa: `employees`, `positions`, `position_*_requirements`, `epi_*`, `tenant_epis`, `employee_epi_deliveries`, `documents`, `document_validity_rules`/campos de validade, `cipa_*`, `fire_*`, `emergency_drills`, `inspections`, `prevention_*`, `sst_checklist_*`, `aso_*`, `work_accidents`, `esocial_events` (metadados), `company_applicable_nrs`. Lista final fechada na fase de plano, tabela a tabela, com justificativa; tabelas de pagamento/assinatura continuam como na Fase 4.
- Policies de **escrita** para `socio` apenas em: `documents` (insert/update de arquivo e validade, **sem delete**), `tasks`/`task_events` (já existentes). Triggers de guarda impedem mudar `tenant_id`, `uploaded_by` e campos de identidade.
- **Nenhuma** escrita em `employees`, `tenants` (além do que a Fase 2 já permite, 6 campos operacionais), cadastros fiscais, pagamentos, assinaturas e eSocial.

**Backend**
- Módulo `atuacao/empresas`: `GET /atuacao/empresas` (seletor: clientes Montese com busca e situação), `GET /atuacao/empresas/:tenantId/{visao-geral,documentos,vencimentos,funcionarios,epi,...}` reutilizando os serviços existentes dentro de `req.withTenantContext`, com `tenantId` validado por `is_montese_tenant` e `ParseUUIDPipe`; `POST/PATCH` apenas para documentos e vencimentos.
- Permissões novas na lista fechada (CHECK ampliado): `empresas.read` (ver empresa e áreas), `empresas.documentos` (escrita de documentos/vencimentos). Concedidas pela tela `/admin/permissoes-socios`. Funcionários: dados nominais exigem `empresas.read` e geram auditoria.
- Auditoria: `company.accessed` (empresa + módulo) e `company.documents.changed`; sem texto livre e sem dados pessoais do trabalhador.
- `tenant-context-callsites`: novos chamadores entram em `ALLOWED` só após revisão.

**Frontend**
- Seletor de empresa fixo no topo de `/atuacao` (busca por nome/CNPJ, última empresa lembrada no navegador); empresa ativa visível o tempo todo. Rotas `/atuacao/empresas/[tenantId]/...`: visão geral, documentos, vencimentos, funcionários (somente leitura), EPI, demais módulos em leitura. Reaproveita componentes das telas existentes quando possível. Empresa inexistente ou não Montese: 404 sem vazar dados.

## 6. Segurança e privacidade
Isolamento por RLS **e** por validação no servidor; `tenant_id` do frontend nunca amplia o escopo. Revisão independente (`montese-seguranca`) obrigatória antes de qualquer release. Teste de regressão: sócio não lê empresa de parceiro, não escreve em funcionários/EPI, não apaga documento, não altera `tenant_id`. Dono de funções SECURITY DEFINER testado (`pg_proc.proowner` + `rolbypassrls`).

## 7. Testes
Unit (seleção de escopo, DTOs); E2E em Postgres descartável com esquema real de produção + migrations novas (uma suíte por vez, Redis zerado): matriz de acesso do sócio por tabela (SELECT permitido, escrita negada exceto documentos/tarefas), isolamento (parceiro, outro papel), auditoria, concorrência; regressão `socio-access-matrix`, `socio-controller-sweep`, `tenant-isolation-sweep`. Frontend: Vitest do seletor e das telas, tsc, eslint, build.

## 8. Fora de escopo
Edição de funcionários, dados fiscais, pagamentos, eSocial, CIPA e demais cadastros pelo sócio; empresas de parceiros; PGR (sub-projeto A).

## 9. Pendências do proprietário
1. Confirmar que empresas de parceiros ficam fora.
2. Registro formal da base legal e política de retenção.
3. Quais módulos da empresa entram na primeira entrega do Z (sugestão: visão geral, documentos, vencimentos, funcionários e EPI).
4. Liberação em produção, backup e commit: só com autorização expressa.
