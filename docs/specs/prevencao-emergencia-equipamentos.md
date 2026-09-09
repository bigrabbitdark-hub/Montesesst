# Prevenção e Emergência — sub-projeto A: equipamentos contra incêndio

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-09.
> Primeiro dos 7 sub-projetos do "Centro de Gestão de Prevenção e
> Emergências" que o fundador propôs (extintores/equipamentos;
> brigada; checklists+simulados; plano de ação de emergência;
> documentos PPCI/PSPCI/APPCI; dashboard "índice de prevenção"; agente
> especialista em incêndio) — os outros 6 ficam pra quando for a vez,
> cada um com seu próprio brainstorming. A arquitetura multi-estado
> (legislação de Corpo de Bombeiros por UF) é tratada como uma frente
> à parte, de conteúdo/curadoria normativa, não desta spec.

## 1. Objetivo e escopo

Cadastro e controle de equipamentos contra incêndio (extintor,
hidrante, mangueira, alarme, detector, iluminação de emergência,
saída de emergência, porta corta-fogo, sprinkler, central de alarme,
outro) — hoje nenhum desses itens existe como entidade rastreável no
produto (a única menção a "extintores" é um rótulo de checklist fixo
em Inspeções, sem nenhum dado próprio). Todos os 11 tipos entram desde
o início, numa tabela só, com os campos específicos de extintor (o
único tipo que o fundador detalhou com atributos próprios) e campos
comuns pros demais.

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Todos os ~11 tipos de equipamento desde o início** (decisão
  explícita do fundador, ao contrário da recomendação inicial de
  começar só com extintor) — uma tabela só, não uma por tipo.
- **Sem catálogo de referência fixo** (diferente do EPI, que tem
  `epi_catalog_items` da NR-06) — os campos de extintor
  (`agente_extintor`/`capacidade`/`classe_fogo`) são descritivos da
  própria instância cadastrada, não referências a uma lista fechada.
- **Localização por filial + texto livre** — reaproveita
  `company_units` já existente como o nível "prédio/unidade"; não cria
  hierarquia nova de andar/setor. `localizacao` é um campo de texto
  livre pra descrever onde dentro da filial.
- **Sem planta/foto do ambiente com posicionamento visual** (pin-drop
  numa imagem) — fora de escopo, mesma decisão já tomada pro Mapa SST
  (Fase 23) sobre grafo visual. Lista/tabela, não mapa interativo.
- **Status calculado, nunca digitado** — 🟢/🟡/🔴 a partir de
  `proxima_manutencao`: vencido (🔴, já passou), vencendo (🟡, até 30
  dias), regular (🟢, mais de 30 dias). Mesma disciplina "nível 1, sem
  IA" já usada em todo o produto pra esse tipo de cálculo.
- **Mesmo conjunto de papéis do EPI** (`empresa`, `tecnico`,
  `parceiro`), não `admin`-only como funcionário — um técnico ou
  parceiro pode cadastrar equipamento durante uma visita.
- **Integra com o dashboard já existente** (`DashboardService.
  getSummary`) — vencido entra em `atencao` como `prioridade: 'alta'`
  (conta em `resumo.pendencias`, `status: 'critico'`); vencendo entra
  como `media`. O dashboard dedicado "índice de prevenção" (sub-
  projeto F, futuro) é uma visão mais elaborada depois, não o único
  lugar onde isso aparece.
- **Foto do equipamento**: reaproveita o padrão de upload já usado em
  Documentos (Cloudflare R2) — um campo opcional de referência a um
  arquivo, não um sistema de anexo próprio.

## 3. Modelo de dados

Migration `backend/db/migrations/0036_fire_safety_equipment.sql`:

```sql
CREATE TABLE fire_safety_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID REFERENCES company_units(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'extintor', 'hidrante', 'mangueira', 'alarme', 'detector',
    'iluminacao_emergencia', 'saida_emergencia', 'porta_corta_fogo',
    'sprinkler', 'central_alarme', 'outro'
  )),
  codigo TEXT,
  localizacao TEXT,
  data_instalacao DATE,
  data_ultima_manutencao DATE,
  proxima_manutencao DATE,
  empresa_responsavel TEXT,
  observacoes TEXT,
  foto_r2_key TEXT,
  -- Só usados quando tipo = 'extintor'; NULL nos demais casos (mesmo
  -- padrão já usado em cipa_trainings.tipo_outro pra campo condicional).
  agente_extintor TEXT,
  capacidade TEXT,
  classe_fogo TEXT,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_fire_safety_equipment_updated_at BEFORE UPDATE ON fire_safety_equipment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE fire_safety_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_safety_equipment FORCE ROW LEVEL SECURITY;
CREATE POLICY fire_safety_equipment_isolation ON fire_safety_equipment USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
```

`company_unit_id` é `ON DELETE SET NULL` (apagar uma filial não pode
apagar nem bloquear o equipamento — mesmo raciocínio já usado em
`employees.position_id`). Nenhum campo de status é persistido — é
sempre calculado a partir de `proxima_manutencao` no momento da
leitura (service layer, não SQL gerado).

## 4. Fluxo

1. **Cadastro** (`POST /fire-safety-equipment`, `@Roles('empresa',
   'tecnico', 'parceiro')`): campos comuns obrigatórios são `tipo` e
   `codigo`; os demais (localização, datas, empresa responsável,
   observações, foto) são opcionais. Campos de extintor
   (`agente_extintor`/`capacidade`/`classe_fogo`) só são aceitos
   quando `tipo === 'extintor'` — enviados com outro tipo, são
   ignorados silenciosamente pelo service (não é erro de validação,
   já que o cliente pode reenviar o mesmo formulário genérico pra
   qualquer tipo).
2. **Listagem** (`GET /fire-safety-equipment?tenant_id=&tipo=&status=`):
   devolve cada equipamento com um campo `status` calculado
   (`'regular' | 'vencendo' | 'vencido'`) derivado de
   `proxima_manutencao`; filtro opcional por `tipo`/`status` na query.
3. **Edição/exclusão** (`PATCH`/`DELETE /fire-safety-equipment/:id`):
   mesmo padrão de posse de tenant já usado em EPI/funcionário
   (checagem explícita, não só RLS, já que RLS tem bypass de admin).
4. **Integração com o dashboard**: `DashboardService.getSummary` ganha
   uma nova fonte (`FireSafetyEquipmentService.getStatusSummary`,
   ao lado de `getEpiStatus`/`getActionPlans` já existentes no mesmo
   `Promise.all`), somando equipamentos vencidos/vencendo em
   `atencao`/`resumo.pendencias`/`resumo.avisos`.

## 5. Fora de escopo

- Os outros 6 sub-projetos da visão do fundador (brigada de incêndio,
  checklists de prevenção, simulados de emergência, Plano de Ação de
  Emergência, documentos PPCI/PSPCI/APPCI, dashboard "índice de
  prevenção", agente especialista em incêndio) — cada um com seu
  próprio brainstorming futuro.
- Legislação estadual multi-UF (CBMRS/CBMSC/CBMPR/etc.) — frente à
  parte, de conteúdo/curadoria normativa.
- Planta/foto do ambiente com posicionamento visual dos equipamentos.
- Catálogo de referência fixo de tipos/modelos de equipamento.
- Qualquer mudança no módulo de Inspeções (o rótulo "extintores" no
  checklist fixo continua existindo do jeito que está, sem ligação com
  esta tabela nova).
