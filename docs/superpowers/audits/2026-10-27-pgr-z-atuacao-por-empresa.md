# Sub-projeto Z — Atuação por empresa: relatório de verificação (2026-10-27)

**Estado:** implementado na árvore de trabalho de `/opt/montese-work/painel-release` (base `c6e6b5b`), **NADA commitado, NADA em produção.** Spec: `docs/superpowers/specs/2026-10-27-pgr-subprojeto-z-atuacao-por-empresa-design.md`. Plano: `docs/superpowers/plans/2026-10-27-pgr-z-atuacao-por-empresa.md`.

## O que entrega
Os sócios (papel `socio`) escolhem um cliente Montese em `/atuacao/empresas` e, dentro dele, consultam visão geral, documentos (com download), vencimentos, funcionários (sem CPF e sem nascimento) e EPI, e ajustam **somente a vigência** (início/vencimento) dos documentos. Nada mais é gravável.

## Arquivos
Migration `backend/db/migrations/0097_socio_empresa_acesso.sql`; backend `backend/src/atuacao/empresas/{empresas.controller,empresas.service}.ts`, `dto/vigencia.dto.ts`, `atuacao.module.ts`, `common/permissions.ts`, `permissoes/permissoes-catalogo.ts`; frontend `frontend/src/app/atuacao/empresas/**`, `api.ts`, `lib/dashboard/menu-atuacao.ts`; testes `atuacao-empresas-rls`, `atuacao-empresas`, `empresas-service`, `empresas.test.tsx` e ajustes em testes de permissões.

## Evidências (VERIFICADO, banco descartável reconstruído das migrations — não é cópia de produção)
- E2E, uma suíte por vez com Redis zerado: empresas-rls 18, empresas 33, permissoes 14, documentos 45, financeiro 21, agenda 29, tarefas 28, carteira 13, socio-access-matrix 13, subscription-status-guard 19, tenant-isolation-sweep 10, admin-dashboard-financeiro 5, auth 5 — todas verdes.
- Backend unit: 1853 passam; falham `r2-get-object` e `tenant-context-callsites` (pré-existentes na base de produção) e `epi-ficha-pdf`/`employee-document-text` apenas sob carga paralela (passam isoladas; arquivos não tocados). `tsc` e `nest build` limpos.
- Frontend: 85 arquivos / 1179 testes, `tsc`, `eslint` e `build` limpos (rotas `/atuacao/empresas` e `/atuacao/empresas/[tenantId]` geradas).
- Varredura: sem "assinatura digital"/"ICP-Brasil"; CPF/nascimento só em comentário.
- Revisões: por tarefa (spec + qualidade), final do conjunto (opus) e **segurança independente** (`montese-seguranca`): sem achados Críticos/Altos; 3 Médios e 5 Baixos tratados ou decididos (abaixo).

## Achados da revisão de segurança e destino
| Achado | Destino |
|---|---|
| Auditoria da vigência fora da transação e sem datas antigas | **Corrigido:** auditoria na mesma transação (falha fechada), com datas antigas→novas |
| Download entrega o arquivo inteiro de qualquer categoria visível (ficha_epi, pcmso, laudo…) | **Decisão do proprietário** (LGPD): lista fechada de categorias baixáveis ou permissão separada |
| "Cliente Montese" = tenant sem vínculo (autocadastro e cliente de parceiro sem vínculo entram) | **Decisão do proprietário** (carteira explícita?) |
| Policy de SELECT em `employee_epi_deliveries` sem uso | **Removida** (menor privilégio) |
| Guarda depende da ordem dos triggers de `documents` | **Teste de regressão** com o conjunto exato de triggers |
| 404 de sondagem não auditado | Aceito (registro apenas de negações 403 pelo guard) |
| `empresas.read` exige também `clients.read` | **Documentado** no catálogo e mensagem específica no seletor |

## Conferência somente-leitura em produção (2026-10-27)
FORCE RLS ligado em `documents`, `employees`, `positions`, `tenant_epis`, `employee_epi_deliveries` (dono `montese_app`); migrations 0090–0096 aplicadas; `is_montese_tenant`/`list_socios` com dono `montese_auth_bypass`; triggers atuais de `documents`: `trg_a_guard_documents_socio_publish`, `trg_documents_updated_at`; policies atuais: hide_employee_registry, isolation, socio_insert, socio_select (sem UPDATE para sócio).

## Limites (NÃO VERIFICADO)
QA visual em navegador real; aplicação da 0097 em cópia fiel do esquema de produção (o banco de ensaio foi reconstruído das migrations, donos das tabelas = superusuário); desempenho (EXPLAIN) das policies com `is_montese_tenant` em volume real.

## Pendências do proprietário
1. Categorias de documento baixáveis pelos sócios; 2. definição de "cliente Montese" (carteira explícita); 3. registro formal da base legal e retenção (LGPD); 4. confirmar empresas de parceiros fora e os 5 módulos da primeira entrega; 5. commit, backup e liberação (ordem: backup → aplicar 0097 → trocar código → verificar), com autorização expressa.
