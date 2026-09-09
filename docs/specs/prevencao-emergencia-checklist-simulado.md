# Prevenção e Emergência — sub-projeto C: checklist de prevenção + simulado de emergência

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-09.
> Terceiro dos 7 sub-projetos do "Centro de Gestão de Prevenção e
> Emergências" (sub-projeto A, equipamentos contra incêndio, e
> sub-projeto B, brigada de incêndio, já concluídos). Os outros 4
> (Plano de Ação de Emergência; documentos PPCI/PSPCI/APPCI; dashboard
> "índice de prevenção"; agente especialista em incêndio) ficam pra
> quando for a vez, cada um com seu próprio brainstorming.

## 1. Objetivo e escopo

Duas entidades relacionadas mas com forma de dado diferente,
agrupadas num sub-projeto só por proximidade temática (prevenção
contínua):

1. **Checklist de prevenção**: vistoria técnica periódica com 14
   itens fixos (extintores, saídas, iluminação, alarmes, brigadistas
   disponíveis, etc.), cada item marcável C/NC/NA com foto opcional —
   mesmo espírito do checklist de Inspeções (Fase 6), mas com
   capacidade de evidência fotográfica que Inspeções nunca teve.
2. **Simulado de emergência**: registro de um simulado de evacuação
   pela própria empresa, com lista de presença nominal por
   funcionário, tempo de evacuação, e 4 flags de problema encontrado.

Ambos geram ações corretivas numa tabela nova, compartilhada entre os
dois.

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Uma spec só, duas entidades** — mantém a decomposição original do
  fundador (checklist + simulado juntos no sub-projeto C), mas com
  tabelas/fluxos claramente separados dentro da spec, não uma
  entidade tentando servir aos dois.
- **Checklist é só técnico/parceiro** (`@Roles('tecnico', 'parceiro')`,
  sem `'empresa'`), mesmo padrão de Inspeções — vistoria formal, não
  autoatendimento.
- **Lista de itens do checklist é fixa**, mesmo padrão de Inspeções
  (constante TypeScript, sem tela de configuração) — não configurável
  por tenant.
- **Foto por item usa upload direto ao R2** (mesmo padrão do
  sub-projeto A, equipamentos) — não passa pelo `DocumentsService`
  (que é pra documento formal de compliance com categoria/validade;
  foto de item de checklist é evidência pontual, sem essas duas
  coisas).
- **Simulado é registrado diretamente pela empresa** (`@Roles('empresa',
  'tecnico', 'parceiro')`, mesma resolução de `tenant_id` dos
  sub-projetos A/B) — diferente do checklist, não depende de visita
  técnica agendada.
- **Lista de presença do simulado é nominal por funcionário**
  (`employee_id` obrigatório, sem nome livre) — decisão explícita do
  fundador, ao contrário da recomendação inicial de só contagem
  numérica. Permite saber QUEM não evacuou, não só quantos.
- **Sem participante externo (visitante/terceirizado)** — decisão
  explícita do fundador, ao contrário do padrão de `cipa_meeting_
  participants` (que aceita nome livre). Só funcionário cadastrado.
- **"Brigadistas presentes" é calculado, nunca persistido** — JOIN de
  `emergency_drill_participants` (com `presente=true`) contra
  `fire_brigade_members` (sub-projeto B, já existente), não um campo
  próprio.
- **Ações corretivas têm tabela própria** (`prevention_corrective_
  actions`), não reaproveita `action_plans` (que tem `inspection_id
  NOT NULL`, exigiria alterar uma tabela compartilhada já em
  produção) — decisão explícita do fundador, mesmo padrão de "tabela
  nova em vez de alterar tabela legada" já usado nos sub-projetos A/B.

## 3. Modelo de dados

Migration `backend/db/migrations/0039_prevention_checklist_and_drills.sql`:

```sql
CREATE TABLE prevention_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  technician_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'concluida')),
  data_realizacao DATE NOT NULL,
  concluded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX prevention_checklists_company_unit_idx ON prevention_checklists (company_unit_id);
CREATE TRIGGER trg_prevention_checklists_updated_at BEFORE UPDATE ON prevention_checklists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE prevention_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES prevention_checklists(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  item_label TEXT NOT NULL,
  status TEXT CHECK (status IN ('C', 'NC', 'NA')),
  observacoes TEXT,
  foto_r2_key TEXT,
  UNIQUE (checklist_id, item_key)
);

CREATE TABLE emergency_drills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  data_realizacao DATE NOT NULL,
  horario TIME,
  tempo_evacuacao_segundos INT,
  ponto_encontro_adequado BOOLEAN,
  falhas_sinalizacao BOOLEAN NOT NULL DEFAULT false,
  falhas_iluminacao BOOLEAN NOT NULL DEFAULT false,
  portas_bloqueadas BOOLEAN NOT NULL DEFAULT false,
  extintores_obstruidos BOOLEAN NOT NULL DEFAULT false,
  observacoes TEXT,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX emergency_drills_company_unit_idx ON emergency_drills (company_unit_id);
CREATE TRIGGER trg_emergency_drills_updated_at BEFORE UPDATE ON emergency_drills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE emergency_drill_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_id UUID NOT NULL REFERENCES emergency_drills(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  presente BOOLEAN NOT NULL,
  UNIQUE (drill_id, employee_id)
);

CREATE TABLE prevention_corrective_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  checklist_item_id UUID REFERENCES prevention_checklist_items(id) ON DELETE CASCADE,
  drill_id UUID REFERENCES emergency_drills(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  deadline DATE,
  responsible TEXT,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'resolvido')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_corrective_action_source CHECK (
    (checklist_item_id IS NOT NULL AND drill_id IS NULL)
    OR (checklist_item_id IS NULL AND drill_id IS NOT NULL)
  )
);

ALTER TABLE prevention_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE prevention_checklists FORCE ROW LEVEL SECURITY;
CREATE POLICY prevention_checklists_isolation ON prevention_checklists USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

ALTER TABLE prevention_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE prevention_checklist_items FORCE ROW LEVEL SECURITY;
CREATE POLICY prevention_checklist_items_isolation ON prevention_checklist_items USING (
  EXISTS (SELECT 1 FROM prevention_checklists c WHERE c.id = prevention_checklist_items.checklist_id)
);

ALTER TABLE emergency_drills ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_drills FORCE ROW LEVEL SECURITY;
CREATE POLICY emergency_drills_isolation ON emergency_drills USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

ALTER TABLE emergency_drill_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_drill_participants FORCE ROW LEVEL SECURITY;
CREATE POLICY emergency_drill_participants_isolation ON emergency_drill_participants USING (
  EXISTS (SELECT 1 FROM emergency_drills d WHERE d.id = emergency_drill_participants.drill_id)
);

ALTER TABLE prevention_corrective_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prevention_corrective_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY prevention_corrective_actions_isolation ON prevention_corrective_actions USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
```

`prevention_checklist_items`/`emergency_drill_participants` não têm
`tenant_id` próprio (delegam via `EXISTS`) — mesmo padrão já usado em
`inspection_checklist_items`/`cipa_meeting_participants`.

**Lista fixa dos 14 itens do checklist** (constante
`backend/src/prevention-checklist/prevention-checklist-items.const.ts`,
mesmo padrão de `checklist-items.const.ts` de Inspeções):
extintores acessíveis, extintores sinalizados, sem obstrução, lacre
íntegro, manômetro em condição adequada (quando aplicável), mangueiras
acessíveis, saídas desobstruídas, sinalização visível, iluminação de
emergência, alarmes, portas de emergência, rotas de fuga, ponto de
encontro, brigadistas disponíveis.

## 4. Fluxo

### 4.1 Checklist de prevenção

1. **Criação** (`POST /prevention-checklists`, `@Roles('tecnico',
   'parceiro')`): cria o checklist em `status='rascunho'` e semeia os
   14 itens da constante (sem status ainda).
2. **Preenchimento** (`PATCH /prevention-checklists/:id/items/:itemId`):
   define `status`/`observacoes`, upload de foto opcional
   (`POST .../items/:itemId/foto`, R2 direto).
3. **Conclusão** (`POST /prevention-checklists/:id/concluir`): muda
   `status` pra `'concluida'`, seta `concluded_at`, e cria uma linha
   em `prevention_corrective_actions` pra cada item com
   `status='NC'` (mesmo padrão do `conclude()` de Inspeções).
4. **Listagem/detalhe**: `GET /prevention-checklists` /
   `GET /prevention-checklists/:id` (com os itens).

### 4.2 Simulado de emergência

1. **Registro** (`POST /emergency-drills`, `@Roles('empresa',
   'tecnico', 'parceiro')`): cria o simulado com os campos de data/
   horário/tempo/flags de problema, e a lista de presença
   (`participants: [{employee_id, presente}]`) num payload só —
   diferente do checklist, não é um fluxo rascunho→conclusão (o
   simulado é um evento que já aconteceu quando é registrado). A
   lista de participantes deve cobrir todo funcionário que deveria
   participar (tipicamente todo funcionário `status='ativo'` da
   filial), cada um com `presente` explícito `true`/`false` — não só
   uma lista de quem compareceu. Sem isso, `participantes_ausentes`
   (Seção 4.2, item 3) não tem como ser calculado; o frontend busca a
   lista de funcionários ativos da filial e monta o formulário com
   todos pré-listados, marcando presença/ausência por funcionário.
2. **Geração de ações corretivas**: ao criar, cada flag de problema
   marcada `true` (`falhas_sinalizacao`, `falhas_iluminacao`,
   `portas_bloqueadas`, `extintores_obstruidos`) gera uma linha em
   `prevention_corrective_actions` com uma descrição padrão (ex.:
   "Falha de sinalização identificada no simulado de {data}").
3. **Relatório** (`GET /emergency-drills/:id`): devolve o registro
   com os números calculados — `participantes_total`
   (`COUNT(*)` de `emergency_drill_participants`),
   `participantes_ausentes` (`COUNT(*)` com `presente=false`),
   `brigadistas_presentes` (`COUNT(*)` de participantes com
   `presente=true` cujo `employee_id` também existe em
   `fire_brigade_members` com `status='ativo'`), `nao_conformidades`
   (soma das 4 flags `true` + `participantes_ausentes > 0`).
4. **Listagem**: `GET /emergency-drills`.

### 4.3 Ações corretivas

`GET /prevention-corrective-actions` (lista, com filtro por
`status`), `PATCH /prevention-corrective-actions/:id` (só `status`,
qualquer um dos 3 papéis pode marcar `'resolvido'`).

### 4.4 Integração com o dashboard

`DashboardService.getSummary` ganha uma nova fonte: ação corretiva
`status='pendente'` com `deadline` vencido entra em `atencao` como
`prioridade: 'alta'` (conta em `resumo.pendencias`); vencendo em até
30 dias como `media` (conta em `resumo.avisos`) — mesmo formato dos
sub-projetos A/B.

## 5. Frontend

Duas páginas novas, mesmo padrão de arquivo único já usado no resto
do produto:

- `/empresa/checklist-prevencao`: lista de checklists (por técnico/
  parceiro que os criou, visível pra empresa em modo leitura), cada
  um mostrando os 14 itens com status/foto/observação.
- `/empresa/simulados`: formulário de registro (data/horário/tempo/
  flags de problema + lista de presença marcável por funcionário já
  cadastrado) e lista dos simulados já registrados com o relatório
  calculado (Seção 4.2, item 3).

## 6. Fora de escopo

- Os outros 4 sub-projetos ainda não iniciados (Plano de Ação de
  Emergência; documentos PPCI/PSPCI/APPCI; dashboard "índice de
  prevenção"; agente especialista em incêndio).
- Configuração de itens do checklist por tenant.
- Participante externo (visitante/terceirizado) na lista de presença
  do simulado.
- Qualquer alteração na tabela `action_plans`/módulo de Inspeções já
  existente — o padrão "NC → ação corretiva" é reaproveitado como
  conceito, não como schema compartilhado.
- Geração de PDF/relatório formal do simulado (o "relatório" desta
  fase é só a tela com os números calculados, não um documento
  exportável).
