# PGR — Sub-projeto A: acesso dos sócios, GHE, biblioteca de perigos e inventário (spec)

**Data:** 2026-10-27 · **Estado:** rascunho para revisão do proprietário (nada implementado, nada commitado).
**Base de código:** worktree `/opt/montese-work/painel-release` (linhagem de produção, branch `release/painel-atuacao-fase7`). Migrations a partir de **0098** (a 0097 é do sub-projeto Z, já implementado).
**Origem:** pedido "Implementação do módulo PGR" (2026-10-27). Este documento cobre só o sub-projeto A; B (matriz e plano de ação), C (emissão/versões), D (Tabela 24, S-2240, PCMSO) e E (assinatura com provedor) terão spec própria.

## 1. Objetivo
Permitir que Danilo Berto e Évelyn Souza, a partir de `/atuacao`, montem o inventário de riscos de uma empresa cliente Montese reaproveitando os cadastros existentes, sem planilhas e sem redigitação, deixando os dados prontos para as etapas B a E.

## 2. Decisões vinculantes
1. **Acesso (decidido pelo proprietário em 2026-10-27, revisado no mesmo dia):** os dois sócios atendem os clientes assinantes e têm acesso liberado a **todas as empresas clientes Montese**, com **seletor de empresa** na tela deles. Dentro da empresa selecionada: **leitura de toda a área da empresa**; **escrita apenas em documentos e vencimentos/tarefas** (organização do atendimento) e nas tabelas novas do PGR. Cadastros sensíveis (funcionários, dados fiscais, assinatura/pagamento) são só leitura. Toda leitura e escrita é auditada com o sócio e a empresa. "Todas as empresas" = clientes Montese (tenant sem vínculo em `tenant_technicians`/`tenant_partners`); empresas de técnicos parceiros ficam fora (INFERIDO da regra de carteira; confirmar).
1a. **Pré-requisito novo (sub-projeto Z, "Atuação por empresa"):** o seletor de empresa e o acesso aos módulos da empresa não existem; são uma fundação anterior ao A. Ver §12.
2. Abordagem de dados: tabelas de trabalho editáveis; a imutabilidade das versões emitidas (snapshot JSON no fluxo de documentos) é do sub-projeto C. Este sub-projeto já grava o necessário para o snapshot.
3. Nenhum dado de catálogo é gerado por IA ou presumido: a biblioteca **nasce vazia**; carga fornecida/validada pela equipe técnica.
4. Código da Tabela 24 é opcional e nunca presumido (a tabela em si é do sub-projeto D).
5. Sem cálculo automático de nível de ação ou limite: só registra o que o profissional informar.
6. Assinatura continua sendo o registro interno do painel (sem ICP-Brasil/"assinatura digital"); provedor é o sub-projeto E.
7. Sem commit, push, deploy ou alteração de produção sem autorização expressa.

## 3. Reuso (VERIFICADO na auditoria)
`tenants`, `company_units`, `employees` (`department`, `position_id`), `positions`, `epi_catalog_items`, `position_epi_requirements`, `position_training_requirements`, `tenant_epis`, `professional_registrations`, `documents`/armazenamento R2, `audit_log` e `AuditService`, `socio_permissions` + `PermissionsGuard`, `/admin/permissoes-socios`, layout e `api.ts` de `/atuacao`. **Não** se mexe em `pgr_function_risks` (extração de PGRs enviados, usada pelo Pente-Fino).

## 4. Modelo de dados (migrations ≥ 0097)
Todas as tabelas: `id uuid`, `created_at`, `updated_at` (trigger), RLS ligado e **FORCE**. Papéis `montese_app` como dono; funções SECURITY DEFINER pertencem a `montese_auth_bypass`.

| Tabela | Conteúdo | Acesso |
|---|---|---|
| `pgr_hazards` | Biblioteca. `scope` (`global`/`tenant`), `tenant_id` (nulo se global), `category` (fisico, quimico, biologico, ergonomico, acidente, psicossocial), `name`, `description`, `sources`, `health_effects`, `exposure_routes[]`, `default_assessment` (qualitativa/quantitativa), `default_unit`, `tolerance_limit`, `tolerance_reference`, `suggested_controls`, `esocial_code` (texto, opcional), `psychosocial` jsonb (organização, metas, jornada, relações, violência/assédio), `active`, `origin` | global: admin escreve, demais leem; `tenant`: só o próprio contexto |
| `pgr_ghes` | GHE: `tenant_id`, `company_unit_id`, `name`, `environment_description`, `process_description`, `activities`, `machines_products`, `notes` | leitura `pgr.read`, escrita `pgr.write`, só tenants Montese |
| `pgr_ghe_positions` | Junção GHE × `positions` | idem |
| `pgr_risks` | `ghe_id`, `hazard_id` (origem), cópia editável dos campos do perigo, `activity`, `exposure_type` (habitual_permanente/intermitente/eventual), `esocial_code`, `assessment_type`, `assessment_notes`, `status` | idem |
| `pgr_risk_controls` | `risk_id`, `kind` (epc/epi/administrativa/treinamento), descrição, situação, eficácia avaliada, `epi_catalog_item_id` (FK, EPI), `training_tipo` (mesmo vocabulário de `position_training_requirements.tipo`, treinamento) | idem |
| `pgr_risk_measurements` | `risk_id`, agente, valor, unidade, limite, referência, metodologia, equipamento, nº de série, data de calibração, data da avaliação, responsável, `professional_registration_id` (FK, opcional), `document_id` (laudo, FK opcional) | idem |

- **Trabalhadores expostos** = contagem calculada de `employees` com `position_id` em `pgr_ghe_positions` e unidade compatível, apenas funcionários ativos. Nada é copiado para o PGR.
- O perigo é **copiado** para o risco no momento da seleção; editar a biblioteca depois não altera riscos existentes.
- Exclusão: `pgr_hazards` só é inativada (nunca apagada se referenciada).

## 5. Acesso e segurança
- Permissões novas na lista fechada `PERMISSIONS` (CHECK do banco ampliado em migration): `pgr.read` e `pgr.write`. Entram no catálogo da tela `/admin/permissoes-socios` (grupo "PGR"), **não sensíveis** por si; a emissão/aprovação reaproveita `documents.*` (sub-projeto C).
- Policies de **leitura** para `socio` em `employees`, `positions`, `epi_catalog_items`, `position_epi_requirements`, `position_training_requirements`, `tenant_epis`, restritas por `is_montese_tenant(tenant_id)`. **Nenhuma** policy de escrita para `socio` nesses cadastros.
- `RolesGuard`/`PermissionsGuard` nos controllers `@Controller('atuacao/pgr/...')`; `socio` listado nas rotas, com `@RequirePermission`. Empresa, técnico e parceiro: 403.
- Auditoria: toda escrita (`pgr.ghe.*`, `pgr.risk.*`, `pgr.hazard.*`) grava ids e nomes de campo, nunca texto livre. A leitura de lista de funcionários grava `pgr.employees.viewed` (tenant, contagem), sem dados pessoais.
- Dados pessoais: a tela mostra a contagem de expostos; a lista nominal de funcionários só é exigida pelos sub-projetos D (S-2240) e fica atrás de `pgr.read` + auditoria.
- Concorrência: `pg_advisory_xact_lock` por GHE em operações compostas; transações nas gravações de GHE+vínculos e risco+controles.
- **Fotos e anexos ficam FORA da primeira entrega do A** (o sócio não envia arquivos; exigiria nova categoria em `documents` e policy de INSERT). Os campos de evidência entram como referência opcional a documento existente em incremento posterior.

## 6. API (resumo)
`GET/POST/PATCH /atuacao/pgr/perigos` (+ `duplicar`, `inativar`, `importar`, `exportar`; escrita global só admin), `GET/POST/PATCH/DELETE /atuacao/pgr/ghes`, `PUT .../ghes/:id/cargos`, `GET /atuacao/pgr/empresas/:tenantId/resumo` (dados importados + pendências), `GET/POST/PATCH/DELETE /atuacao/pgr/riscos`, `.../controles`, `.../medicoes`, `GET /atuacao/pgr/painel` (lista de PGRs em andamento e completude). Contratos detalhados vão ao plano.

## 7. Interface (`/atuacao/pgr/...`)
Item de menu "PGR — Programa de Gerenciamento de Riscos" (só com `pgr.read`). Visão geral, fluxo guiado em quatro etapas (Empresa, Responsáveis, Ambientes, Riscos) com indicador de progresso e rascunho salvo a cada etapa, Biblioteca de Perigos e Inventário também acessíveis direto. Matriz, plano, emissão, Tabela 24 e integrações aparecem como "em breve". Correções de cadastro do cliente usam a edição operacional já existente em `/atuacao/clientes/[id]`. Acessibilidade: labels, `role="alert"/"status"`, foco gerenciado em diálogos, estado em texto, sem rolagem horizontal no mobile, botões desabilitados em requisição, 401 para `/login`.

## 8. Testes e verificação
- Unit: cálculo de expostos, cópia perigo→risco, validações de DTO.
- E2E (Postgres descartável com esquema real de produção + migrations novas, uma suíte por vez, Redis zerado): permissões (`pgr.read` sem `pgr.write`, papéis proibidos), isolamento (cliente não-Montese inacessível ao sócio; perigo `tenant` não vaza), imutabilidade da cópia, auditoria sem dados pessoais, dono das funções SECURITY DEFINER (`pg_proc.proowner` + `rolbypassrls`), concorrência.
- Regressão: `socio-access-matrix`, `socio-controller-sweep`, `tenant-isolation-sweep`, `tenant-context-callsites` (novos chamadores entram em `ALLOWED` após revisão), suítes de funcionários/EPI/posições.
- Frontend: Vitest por tela, convenções de páginas, tsc, eslint, build.
- Rotulagem nos relatórios: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO. QA visual em navegador real: a planejar na homologação.

## 9. Riscos e pendências do proprietário
1. **LGPD:** a leitura ampla de `employees` por sócios foi **aprovada pelo proprietário em 2026-10-27** para o atendimento aos clientes. O registro formal da base legal e a política de retenção (item 6 da folha de decisões) seguem como pendência documental dele.
2. **Carga da biblioteca de perigos:** precisa ser fornecida/validada pela equipe técnica; sem ela o módulo abre vazio.
3. **Cargos vs GHE:** o cadastro de `positions` pode estar incompleto em clientes; a tela mostra a pendência.
4. **Colisão de numeração de migrations** entre linhagens (já conhecida): confirmar 0097+ livre antes do release.
5. Liberação em produção, backup e commit: somente com autorização expressa.

## 10. Fora de escopo
Matriz e classificação, plano de ação, emissão/PDF/versões, Tabela 24, S-2240, exportação PCMSO, sincronização de CA/treinamentos, assinatura com provedor.

## 12. Sub-projeto Z — Atuação por empresa (fundação, a especificar antes do A)
- **O quê:** seletor de empresa em `/atuacao` (lista de clientes Montese com busca) que define o contexto de atendimento; páginas da empresa (documentos, vencimentos, funcionários, EPI etc.) abertas em modo "atendimento", reaproveitando as telas existentes quando possível, sem duplicá-las.
- **Banco:** policies de **SELECT** para `socio` (via `is_montese_tenant`) nas tabelas da área da empresa; policies de **escrita** apenas em `documents` (e validade/vencimentos) e `tasks`; nenhuma escrita em `employees`, dados fiscais, assinaturas e pagamentos. Cada nova policy com teste de isolamento (cliente não-Montese inacessível) e dono correto das funções.
- **Backend:** o contexto da empresa vem de parâmetro validado no servidor (nunca confiado no frontend): checa `is_montese_tenant` e `pgr.read`/permissão do módulo; auditoria `company.accessed`/`company.<módulo>.changed` com sócio e empresa.
- **Permissões:** novas permissões fechadas por módulo (a definir na spec do Z), para o admin conceder pela tela existente.
- **Impacto:** é a maior mudança de acesso do painel (hoje o sócio não lê `documents`, `employees`, EPI). Exige revisão de segurança independente (agente `montese-seguranca`) antes do release e decisão LGPD (base legal, retenção) do proprietário.
- **Ordem recomendada:** Z → A → B → C → D → E. O A não começa a ser implementado antes do Z.

## 11. Autoauditoria da spec
Sem "TBD". Termos de abrangência explícitos (escrita só nas tabelas do PGR). Ambiguidade resolvida: contagem de expostos considera só funcionários ativos; perigo é cópia, não referência viva; permissões `pgr.*` não são sensíveis.
