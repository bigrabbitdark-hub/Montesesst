# Conformidade por NR no Dashboard — Design

> Brainstorming em chat com o fundador em 2026-10-01. Caminho: arquitetural.
> Status: **spec aguardando revisão do fundador**. Nenhum código escrito.
> Sem commit automático (AGENTS.md).

## 1. Objetivo e escopo

Substituir o cartão "Em breve" **Conformidade por NR** de `/dashboard-v2` por um
cartão real que mostra, para cada NR **marcada como aplicável pelo técnico**, o
status das **evidências já cadastradas** da empresa.

É a **fase A** (cobertura por evidência). A **fase B** (decidir quais NRs se
aplicam por CNAE/grau de risco, e o que cada NR exige) está **fora de escopo**.

Princípios (AGENTS.md): o sistema não decide aplicabilidade, não afirma
"obrigatório" nem "descumprimento", e não inventa norma. A IA não participa
desta fase (nenhum dado vai ao modelo).

### Decisões fechadas em brainstorming

1. Cobertura por NR a partir de evidências cadastradas (não aplicabilidade automática).
2. A aplicabilidade é marcada por um **técnico/parceiro vinculado**, no relatório
   de visita; a empresa só lê.
3. O relatório da visita é o **módulo Inspeções existente**, renomeado
   "Relatório de visita técnica" e posicionado junto de Documentos no menu. Não
   se cria um segundo formulário.
4. Catálogo de NRs **em código** (constante versionada), com cálculo na leitura.
   Não há tabelas de catálogo nem painel de edição.
5. O catálogo guarda só **referência** (código, nome, link oficial, regra de
   evidência), nunca texto normativo.

## 2. Estado atual (VERIFICADO no código em 2026-10-01)

- O formulário colado pelo fundador já existe como **Inspeções**
  (`backend/src/inspections`, `/empresa/inspecoes`): checklists, DDS, não
  conformidades com prazo/responsável, assinaturas e PDF gerado ao concluir,
  indexado como documento (categoria `relatorio_visita`). Spec original:
  `docs/specs/relatorio-visita-tecnica-pdf.md`.
- A conclusão usa transação com `SAVEPOINT pdf_indexing`
  ([inspections.service.ts:317](backend/src/inspections/inspections.service.ts#L317)).
- Endpoints de inspeção são `@Roles('tecnico','parceiro')`
  ([inspections.controller.ts](backend/src/inspections/inspections.controller.ts)).
- `GET /dashboard/summary` e `/overview` usam `@Roles('empresa','tecnico','parceiro')`
  e `assertTenantLinked` para técnico/parceiro
  ([dashboard.controller.ts](backend/src/dashboard/dashboard.controller.ts)).
- O cartão atual é `EmBreveCard` em `frontend/src/app/dashboard-v2/page.tsx`.
- Migration desta feature: `0064` (última de produção: `0062_minimax_usage_estimated_cost.sql`; `0063` já foi tomada pela frente de auditoria cruzada em PDF, `0063_sst_audit_document_facts.sql`, em `backend/db/migrations`).
- O menu está em [menu.ts](frontend/src/lib/dashboard/menu.ts); "Inspeções" está hoje em `EXTRA_MENU_ITEMS`.

## 3. Dados

### 3.1 Migration `0064` — `company_applicable_nrs`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL | vem do contexto autenticado, nunca do corpo |
| `nr_code` | text NOT NULL | validado contra o catálogo no backend |
| `marked_by_user_id` | uuid NOT NULL | quem marcou |
| `source_inspection_id` | uuid NULL | visita que originou a marcação |
| `marked_at` | timestamptz NOT NULL | |
| `unmarked_at` | timestamptz NULL | desmarcar não apaga (rastreabilidade) |

- Índice único parcial em `(tenant_id, nr_code) WHERE unmarked_at IS NULL`.
- Índice em `tenant_id`.
- `ENABLE` e `FORCE ROW LEVEL SECURITY`, com política por `tenant_id`, no padrão das migrations existentes.
- Migration aditiva; nenhuma alteração destrutiva.

### 3.2 Coluna em `inspections`

`nrs_aplicaveis jsonb NULL`: rascunho da marcação (lista de `nr_code`) enquanto
a visita está em edição. `NULL` em todas as inspeções antigas (sem quebrar o
que existe em produção). Mesma migration `0064`.

## 4. Catálogo (em código)

Arquivo novo, único: `backend/src/nr-conformidade/nr-catalog.ts`.
Cada entrada: `code`, `nome`, `regra`, `agregacao` (a URL oficial é uma constante única, `FONTE_OFICIAL_NRS_URL`).

**Catálogo inicial** (INFERIDO a partir dos módulos existentes; os campos exatos
de cada regra são **NÃO VERIFICADOS** e devem ser confirmados no plano):

| NR | Evidência |
|---|---|
| NR-1 | Documentos `pgr` (alguma evidência vigente) |
| NR-5 | `cipa_committees` com `status='ativa'` e mandato (`data_termino`) vigente |
| NR-6 | `tenant_epis`: validade dos CAs (`ca_valid_until`), todas vigentes |
| NR-7 | Documentos `pcmso` (alguma evidência vigente) |
| NR-15 e NR-16 | Documentos `lip` (alguma evidência vigente) |
| NR-23 | `fire_safety_equipment.proxima_manutencao`, todas vigentes |

> Regras **simplificadas em 2026-10-01** ao ler os esquemas reais (VERIFICADO
> nas migrations 0008, 0013, 0023, 0036, 0046): NR-5 usa só a comissão ativa
> (ata e capacitação ficam fora); NR-6 usa só os CAs cadastrados (a ficha de
> EPI em PDF fica fora); NR-23 usa só os equipamentos (a brigada fica fora).
> Motivo: cada critério extra afirmaria uma exigência que a spec não tem fonte
> para sustentar. Agregação: "alguma vigente" = basta uma evidência em dia;
> "todas vigentes" = qualquer vencida torna a NR pendente. Evidência sem data
> de validade conta como vigente; zero evidências = `pendente`. Janela de
> atenção: 30 dias (igual a `getCompliance`).

Fora do catálogo: NR-9 e NR-17 (sem evidência própria; o PGR cobre NR-1/NR-9),
NR-10, NR-12, NR-18, NR-35 e demais setoriais (sem fonte estruturada; a
categoria `treinamento` é genérica e não identifica a NR). Entram quando houver
evidência real.

**Fora do catálogo por não serem NR:** LTCAT, PPP e eSocial (S-2220/S-2240).
Pertencem ao cartão Auditoria Montese e ao futuro eSocial.

`FONTE_OFICIAL_NRS_URL` (exposta como `fonte_oficial_url` na API): só a página "Normas Regulamentadoras Vigentes" do MTE,
fornecida pelo fundador nos anexos. O link deve ser **conferido antes de
publicar**; os demais links dos anexos (Planalto, Receita, STF, TNU, TST) não
foram conferidos nem aparecem no catálogo.

Os fatos normativos dos PDFs do fundador (datas, portarias, limites de
ruído, NHOs, jurisprudência) são **NÃO VERIFICADOS** e **não** entram no
catálogo nem na tela nesta fase.

## 5. Fluxo do técnico

1. Em "Relatório de visita técnica", o formulário ganha o bloco **"NRs
   aplicáveis à empresa"**: uma caixa por NR do catálogo, pré-preenchida com as
   marcações vigentes do tenant. O bloco aparece em **qualquer** visita (não há
   tipo "visita inicial"), o que permite revisar a aplicabilidade depois.
2. As alterações ficam em `inspections.nrs_aplicaveis` enquanto a visita está aberta.
3. Ao **concluir**, dentro da transação de conclusão e **antes** do `SAVEPOINT
   pdf_indexing`, o backend aplica o diff em `company_applicable_nrs`:
   - NR nova → insere (`marked_by_user_id`, `source_inspection_id`, `marked_at`);
   - NR desmarcada → grava `unmarked_at`;
   - NR inalterada → não faz nada.
   Uma falha na indexação do PDF não pode desfazer a marcação (e o inverso:
   falha na marcação aborta a conclusão, que é transacional).
4. O técnico anexa os documentos pelo upload de Documentos existente (sem mudança).
5. A empresa vê o resultado no dashboard.

Permissões: marcar exige `tecnico` ou `parceiro` vinculado ao tenant
(`assertTenantLinked`). A empresa não marca. `nr_code` fora do catálogo → 400.

## 6. API e cartão

### 6.1 `GET /dashboard/nr-conformidade`

Mesmos guards, `@Roles` e contexto de tenant de `/dashboard/overview`.
Resposta, por NR marcada e vigente:

```
{ nrs: [{ code, nome, status, evidencia: { quantidade, proxima_validade } | null, fonte_oficial_url, mensagem? }] }
```

`status`: `em_dia` | `atencao` (evidência vencendo; janela de 30 dias, igual ao
compliance atual) | `pendente` (evidência ausente ou vencida) | `nao_avaliavel`
(regra sem dados suficientes ou falha ao calcular). As regras exatas por NR
entram no plano.

### 6.2 Cartão no frontend

- Substitui o `EmBreveCard` "Conformidade por NR".
- Conversor novo em `frontend/src/lib/dashboard/real.ts`, no padrão existente.
- Texto: "evidências cadastradas"; nunca "obrigatório" ou "descumprimento".
  Aviso fixo: "Não substitui a avaliação técnica."
- Link "Fonte oficial" por NR.
- Estados: **vazio** ("Nenhuma visita técnica registrou NRs aplicáveis"),
  **normal**, **falha parcial** (a NR com erro vira `nao_avaliavel` com
  mensagem; as demais continuam), **backend indisponível** (mesmo
  degradado dos outros cartões: "indisponível", sem número inventado).

### 6.3 Menu

"Inspeções" passa a se chamar **"Relatório de visita técnica"** e vai para o
grupo principal, junto de Documentos, em `menu.ts`. A rota `/empresa/inspecoes`
não muda (links existentes seguem válidos). Ajustar os testes do menu.

## 7. Segurança e multi-tenancy

- `tenant_id` sempre do contexto autenticado, nunca do corpo ou query.
- RLS e FORCE RLS na tabela nova; técnico/parceiro passam por `assertTenantLinked`.
- A resposta traz só contagens, validades e links, sem PII nem nomes de funcionários.
- Sem dados enviados ao modelo; sem alteração de provider.
- Sem secrets em código ou logs.

## 8. Testes

- Unitários: cada regra do catálogo (em dia, atenção, pendente, não avaliável).
- e2e de isolamento: empresa A nunca vê as NRs da B; técnico não vinculado → 403.
- e2e de permissão: empresa tentando marcar → 403; `nr_code` fora do catálogo → 400.
- e2e da conclusão: marcação aplicada junto da conclusão; falha do PDF não
  desfaz a marcação; desmarcar grava `unmarked_at`.
- Frontend: cartão nos estados vazio, normal, falha parcial e indisponível; teste do menu.
- Migration aplicada e testada no container descartável
  (`reference_running_tests_in_throwaway_container`). Nunca `docker compose down -v`.
- Typecheck e build do backend e do frontend.

## 9. Fora de escopo

- Fase B: aplicabilidade automática por CNAE/grau de risco e "o que cada NR exige".
- NRs setoriais sem evidência estruturada (NR-10, NR-12, NR-18, NR-35 etc.).
- LTCAT, PPP e eSocial no cartão por NR.
- Verificação de conteúdo do PGR (riscos psicossociais etc.), que é do Auditoria Montese.
- Qualquer uso de IA.

## 10. Implantação

Mudança de schema + backend + frontend = **release**, não deploy isolado
(ver `docs/operations/release-backend-2026-09-30.md` como modelo): backup,
migration `0064`, deploy, verificação. Requer autorização explícita do dono.
O frontend degrada bem sem o backend novo (cartão "indisponível").

## 11. Riscos e perguntas abertas

- As regras de evidência por NR (campos exatos de CIPA, brigada, equipamentos
  de incêndio e CAs) são **NÃO VERIFICADAS**; o plano deve lê-las no código antes de fixar.
- O catálogo inicial (NR-1, 5, 6, 7, 15, 16, 23) foi **confirmado pelo
  fundador em 2026-10-01**, sem mudanças. Spec aprovada para virar plano.
- A página do MTE foi conferida em 2026-10-01 (WebFetch): título "Normas Regulamentadoras Vigentes", lista as 7 NRs do catálogo. A URL do plano original dava 404 e foi substituída.
- Mexer em Inspeções (produção): a coluna é nullable e o bloco novo não pode
  mudar o comportamento de visitas antigas.

## 12. Limitações conhecidas (revisão final, 2026-10-01)

- **Rascunhos simultâneos:** o rascunho `nrs_aplicaveis` é uma foto da lista inteira. Com duas visitas abertas
  na mesma empresa, a última a ser concluída reverte o que a outra marcou (diff contra as marcações vigentes, §5.3).
- **Visita concluída sem rascunho** (técnico não mexeu no bloco): a tela mostra as marcações vigentes de hoje, o que
  pode parecer registro histórico daquela visita.
- **Catálogo que encolhe:** um rascunho com código removido do catálogo faz `applyMarks` rejeitar (400) a conclusão
  até o técnico revisar o bloco. Hoje o catálogo só cresce.
- **Técnico não vinculado em /inspections:** recebe 404 pela RLS (os endpoints de inspeção não usam
  `assertTenantLinked`), enquanto os endpoints `/dashboard/nr-*` devolvem 403.
- **Migration 0064:** o `db:migrate` aplica TODOS os `.sql` pendentes do diretório. A `0063_sst_audit_document_facts.sql`
  (outra frente) não pode ir junto sem autorização própria; o release deve sair de um commit só com os arquivos desta feature.
- **Ordem obrigatória do release:** migration 0064 → backend → frontend. O backend antes da migration quebra TODA
  conclusão de inspeção (`SELECT nrs_aplicaveis`). O frontend antes do backend degrada para "indisponível".
