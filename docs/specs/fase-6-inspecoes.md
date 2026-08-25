# Fase 6 (sub-projeto A) — Fluxo de inspeção

> Primeiro sub-projeto da Fase 6 (Fluxo de visita presencial + Dashboard
> Parceiro). Decisão confirmada em brainstorming de 2026-08-25: o núcleo
> da fase — schema + formulário de inspeção + geração automática de plano
> de ação — vem primeiro, porque o catálogo de EPI e o acesso do técnico
> parceiro dependem pouco ou nada dele e ficam para sub-projetos
> seguintes, cada um com spec própria.

## 1. Objetivo e escopo

Dar ao técnico responsável uma forma real de registrar uma visita técnica
presencial — o checklist estruturado de 9 blocos já usado hoje em papel
pela Montese (`docs/reference/modelos-relatorios-sst.md`, seção 2) — e à
empresa cliente visibilidade em tempo real do que foi encontrado,
incluindo os planos de ação gerados automaticamente de toda não
conformidade.

**Não é objetivo deste sub-projeto:**
- Acesso do técnico **parceiro** ao fluxo — só o técnico responsável cria
  e preenche inspeções nesta entrega (decisão do brainstorming). Abrir
  isso para o parceiro fica para um sub-projeto seguinte da Fase 6.
- Catálogo relacional de EPI (CA por equipamento, vínculo
  funcionário↔EPI) — modelo 1 do documento de referência, adiado desde a
  Fase 5, continua fora daqui, sub-projeto próprio.
- Acompanhamento/atualização de status dos planos de ação (marcar como
  resolvido, mudar prazo) — esta entrega só cria e lista; o fluxo de
  acompanhamento é trabalho futuro.
- Tela de configuração dos itens de checklist — os itens são fixos no
  código nesta entrega (ver seção 2.2); uma tela de administração fica
  para quando essa necessidade aparecer de verdade.
- Assinatura desenhada na tela (canvas) — MVP usa nome digitado +
  confirmação, mesmo padrão que a nota do documento de referência chama
  de "assinatura eletrônica simples".

## 2. Modelo de dados

### 2.1 `inspections` — tabela nova

```sql
CREATE TABLE inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  technician_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'concluida')),
  visited_at DATE NOT NULL,
  company_contact TEXT,
  dds_topic TEXT,
  dds_participants_count INTEGER,
  dds_notes TEXT,
  general_recommendations TEXT,
  technician_signature_name TEXT,
  technician_signature_at TIMESTAMPTZ,
  company_signature_name TEXT,
  company_signature_at TIMESTAMPTZ,
  concluded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_inspections_updated_at BEFORE UPDATE ON inspections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Cobre os blocos 1 (Identificação — `visited_at`, `company_contact`, mais
`tenant_id`/`technician_user_id` como os outros dois lados da
identificação), 4 (DDS), 8 (Recomendações gerais) e 9 (Assinaturas) do
modelo de referência. `status` controla o ciclo rascunho→concluída
decidido no brainstorming (técnico pode salvar pela metade e continuar
depois).

### 2.2 `inspection_checklist_items` — tabela nova, itens fixos semeados na criação

```sql
CREATE TABLE inspection_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  block TEXT NOT NULL CHECK (block IN ('documentacao', 'epis', 'instalacoes', 'maquinas')),
  item_key TEXT NOT NULL,
  item_label TEXT NOT NULL,
  status TEXT CHECK (status IN ('C', 'NC', 'NA')),
  notes TEXT,
  UNIQUE (inspection_id, item_key)
);
```

Cobre os blocos 2, 3, 5 e 6 (todos no mesmo padrão C/NC/N.A. + observação
que o documento de referência descreve como recorrente). Genérico
(`category`/`item_label`/`status`/`notes`, não colunas fixas) — permite
adicionar blocos novos (NR-12, NR-35) depois só mudando a constante de
código (seção 3.1), sem migration.

**Itens fixos desta entrega** (`backend/src/inspections/checklist-items.const.ts`,
única fonte de verdade, usada tanto para semear quanto para os rótulos
que a API devolve):

| Bloco | `item_key` | `item_label` |
|---|---|---|
| `documentacao` | `fichas_epi` | Fichas de EPI em dia |
| `documentacao` | `ordem_servico` | Ordem de Serviço |
| `documentacao` | `validade_ca` | Validade do CA |
| `documentacao` | `aso_em_dia` | ASO em dia |
| `epis` | `uso_adequado` | Uso adequado |
| `epis` | `estado_conservacao` | Estado de conservação |
| `epis` | `compatibilidade_risco` | Compatibilidade com risco do setor |
| `epis` | `reposicao_danificados` | Reposição de danificados |
| `instalacoes` | `luzes_emergencia` | Luzes de emergência |
| `instalacoes` | `sinalizacao` | Sinalização |
| `instalacoes` | `extintores` | Extintores (validade e pressão) |
| `instalacoes` | `rotas_fuga` | Rotas de fuga |
| `maquinas` | `protecoes` | Proteções |
| `maquinas` | `loto` | LOTO (bloqueio/travamento) |
| `maquinas` | `distancia_seguranca` | Distância de segurança |
| `maquinas` | `treinamento_operador` | Treinamento do operador |

### 2.3 `action_plans` — tabela nova

```sql
CREATE TABLE action_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  checklist_item_id UUID REFERENCES inspection_checklist_items(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  deadline DATE,
  responsible TEXT,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'resolvido')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Cobre o bloco 7 (Não conformidades identificadas). Não existe endpoint
que insira aqui diretamente — toda linha nasce de `POST
/inspections/:id/concluir` (seção 3.3), uma por item marcado `NC`,
`description` copiado do `item_label` do item de origem.

### 2.4 RLS — mesmo padrão de `documents`, sem gate extra de status

Decisão do brainstorming: a empresa vê a inspeção completa (cabeçalho +
itens do checklist) em tempo real, mesmo em rascunho — só os planos de
ação (que só existem depois da conclusão, por construção) aparecem mais
tarde. Isso significa que `inspections` usa exatamente a mesma policy que
`documents_isolation` (`docs/specs/fase-4-documentos.md`, seção 2.3), sem
condição adicional sobre `status`:

```sql
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections FORCE ROW LEVEL SECURITY;
CREATE POLICY inspections_isolation ON inspections USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = inspections.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
);
```

`inspection_checklist_items` e `action_plans` não têm um jeito direto de
comparar `tenant_id` de quem está logado sem um join — em vez de
duplicar a lógica de `EXISTS` contra `tenant_technicians`, a policy
delega para a policy de `inspections`, que já resolve isso (uma subquery
contra uma tabela com RLS aplica a RLS dela também):

```sql
ALTER TABLE inspection_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_checklist_items FORCE ROW LEVEL SECURITY;
CREATE POLICY inspection_checklist_items_isolation ON inspection_checklist_items USING (
  EXISTS (SELECT 1 FROM inspections i WHERE i.id = inspection_checklist_items.inspection_id)
);

ALTER TABLE action_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY action_plans_isolation ON action_plans USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = action_plans.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
);
```

## 3. Backend (`InspectionsModule` novo)

### 3.1 `POST /inspections` — cria rascunho

`@Roles('tecnico')`. Corpo: `tenant_id`, `visited_at`. Na mesma
transação: insere a linha em `inspections` (`status: 'rascunho'`,
`technician_user_id: req.user.id`) e semeia as 16 linhas de
`inspection_checklist_items` a partir da constante da seção 2.2 (`status:
null`, `notes: null`). RLS já impede criar para um tenant ao qual o
técnico não está vinculado (mesmo raciocínio de `documents`, seção 2.3
da spec da Fase 4).

### 3.2 Consulta e edição

- `GET /inspections?tenant_id=` — mesmo padrão de `GET /documents`:
  técnico exige `tenant_id` (400 se ausente); empresa não precisa (RLS já
  restringe ao próprio tenant).
- `GET /inspections/:id` — cabeçalho + itens agrupados por `block` +
  planos de ação (lista vazia se ainda em rascunho).
- `PATCH /inspections/:id` (`@Roles('tecnico')`) — atualiza campos do
  cabeçalho (`company_contact`, `dds_*`, `general_recommendations`,
  `technician_signature_name`, `company_signature_name` — ao gravar um
  nome de assinatura, o backend também grava o `_at` correspondente com
  `now()`). Rejeita com 409 se `status = 'concluida'` (inspeção fechada
  não edita mais).
- `PATCH /inspections/:id/items/:itemId` (`@Roles('tecnico')`) — atualiza
  `status` (`C`/`NC`/`NA`) e/ou `notes` de um item. Mesma regra: 409 se a
  inspeção já está concluída.

### 3.3 `POST /inspections/:id/concluir`

`@Roles('tecnico')`. Rejeita com 409 se já `concluida`. Numa única
transação: define `status = 'concluida'`, `concluded_at = now()`; para
cada linha de `inspection_checklist_items` com `status = 'NC'`, insere
uma linha em `action_plans` (`description` = `item_label` do item,
`checklist_item_id` apontando pra ele, `deadline`/`responsible` nulos —
preenchidos depois, fora do escopo desta entrega).

### 3.4 `GET /action-plans?tenant_id=`

Sem `@Roles` (RLS decide). Mesma regra de `tenant_id` obrigatório para
técnico que os outros endpoints agregadores. Lista simples, sem
paginação (volume esperado é baixo — poucas dezenas de planos de ação
por empresa no ano).

## 4. Frontend

### 4.1 Técnico

- `/tecnico/empresas/[tenantId]` (página já existente, ganha uma seção
  nova) — lista de inspeções da empresa (`GET /inspections?tenant_id=`),
  botão "Nova inspeção" que cria o rascunho (`POST /inspections`) e
  redireciona para o formulário.
- `/tecnico/empresas/[tenantId]/inspecoes/[id]` (página nova) — os 9
  blocos em sequência; cada item de checklist é um seletor C/NC/N.A. +
  campo de observação, salvando via `PATCH .../items/:itemId` a cada
  mudança (sem botão de salvar por item — mesmo espírito de "autosave"
  que o rascunho pede). Campos de cabeçalho (contato, DDS, recomendações,
  assinaturas) num formulário próprio, salvo via `PATCH /inspections/:id`
  ao perder foco ou num botão "Salvar". Botão "Concluir inspeção" no
  final, chama `POST /inspections/:id/concluir` e trava a tela pra
  somente-leitura.

### 4.2 Empresa

- `/empresa/inspecoes` (página nova) — lista de inspeções (rascunho e
  concluída, com selo indicando qual), cada uma abre uma visão
  somente-leitura dos 9 blocos; seção separada com os planos de ação
  pendentes de todas as inspeções (`GET /action-plans`).

## 5. Testes

Mesmo padrão do projeto: e2e reais contra o Postgres desta VPS, sem
mock. Casos obrigatórios:
- Criar inspeção → semeia os 16 itens corretamente.
- Editar item e cabeçalho em rascunho → reflete em `GET /inspections/:id`.
- Editar depois de concluída → 409, nos dois endpoints de PATCH.
- Concluir com itens NC → gera exatamente um `action_plan` por item NC,
  com `description` correto; itens C/N.A. não geram nada.
- Concluir sem nenhum item NC → `action_plans` fica vazio, sem erro.
- RLS: empresa vê a inspeção do próprio tenant mesmo em rascunho (prova a
  decisão da seção 2.4); não vê de outro tenant. Técnico vinculado vê;
  não vinculado não vê — nos três, `inspections`, `inspection_checklist_items`
  e `action_plans`.
- Empresa tentando `PATCH`/`POST /concluir` → 403 (`@Roles('tecnico')`
  barra antes mesmo de chegar na RLS).

## 6. Decisões confirmadas (brainstorming de 2026-08-25)

| Decisão | Escolha |
|---|---|
| Ordem da Fase 6 | Fluxo de inspeção primeiro; catálogo de EPI e acesso do parceiro ficam para sub-projetos seguintes |
| Quem inicia uma inspeção | Só o técnico responsável (não o parceiro, nesta entrega) |
| Empresa vê o relatório? | Sim, inclusive em tempo real durante o rascunho |
| Itens de checklist | Fixos no código (constante), não configuráveis por admin |
| Assinatura | Nome digitado + confirmação (não canvas) |
| Planos de ação | Só criação + listagem simples; acompanhamento de status fica para depois |
| Geração dos planos de ação | Só na conclusão da inspeção, não item a item durante o rascunho |
| Rascunho | Permite salvar pela metade e continuar depois (sem exigir preencher tudo de uma vez) |
| Navegação (técnico) | Dentro de `/tecnico/empresas/[tenantId]`, não uma rota isolada |
| Navegação (empresa) | Página própria `/empresa/inspecoes`, não dentro do `DocumentsPanel` |

## 7. Pendências

- [ ] **Catálogo de EPI** — sub-projeto seguinte da Fase 6, spec própria.
- [ ] **Acesso do técnico parceiro** — sub-projeto seguinte da Fase 6;
      hoje só o técnico responsável usa este fluxo.
- [ ] **Acompanhamento de planos de ação** (mudar status, prazo) —
      trabalho futuro, fora desta entrega.
- [ ] **Assinatura desenhada (canvas)** — mencionada no documento de
      referência como possível "fase 2"; fora do MVP desta entrega.
- [ ] **Tela de configuração de itens de checklist** — fica para quando
      a necessidade de categorias novas (NR-12, NR-35) aparecer de
      verdade; o schema genérico já suporta isso via código, sem
      migration.
