# Prevenção e Emergência — sub-projeto B: gestão da brigada de incêndio

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-09.
> Segundo dos 7 sub-projetos do "Centro de Gestão de Prevenção e
> Emergências" (sub-projeto A, equipamentos contra incêndio, já
> concluído — `docs/specs/prevencao-emergencia-equipamentos.md`). Os
> outros 5 (checklists+simulados; plano de ação de emergência;
> documentos PPCI/PSPCI/APPCI; dashboard "índice de prevenção"; agente
> especialista em incêndio) ficam pra quando for a vez, cada um com seu
> próprio brainstorming.

## 1. Objetivo e escopo

Cadastro e controle da brigada de incêndio: quem são os brigadistas,
qual a função de cada um, se o treinamento está em dia, e um painel de
cobertura que mostra quantos brigadistas a filial precisa vs. quantos
tem treinados/ativos hoje. Hoje nenhuma dessas entidades existe no
produto — o precedente mais próximo (CIPA) tem uma forma
estruturalmente incompatível (eleição, mandato fixo, titular/suplente)
que não serve pra brigada.

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Brigadista é vinculado a um funcionário já cadastrado**
  (`employee_id`, obrigatório) — não um cadastro à parte com nome
  digitado à mão (diferente de `cipa_members`). Herda nome/cargo/CPF
  de `employees`, sem duplicar dado.
- **Sem entidade "brigada" própria com ciclo/mandato** — diferente de
  `cipa_committees`. Lista plana de membros por filial, sem eleição,
  sem período de vigência fixo. Brigadista entra/sai quando a empresa
  decidir.
- **Número "necessário" do painel de cobertura é definido manualmente**
  pela empresa/técnico, por filial — não calculado a partir de norma
  (headcount, classe de risco do prédio). A legislação de brigada
  varia por estado/porte e é a mesma frente de curadoria normativa já
  adiada pra depois em todos os 7 sub-projetos.
- **Função na brigada é uma lista fechada**: `líder`, `vice-líder`,
  `brigadista` — não texto livre.
- **Treinamento de brigada tem tabela própria**
  (`fire_brigade_trainings`), não reaproveita `cipa_trainings` —
  decisão explícita do fundador, ao contrário da recomendação inicial
  de reaproveitar a tabela genérica já existente.
- **Telefone é campo próprio do vínculo com a brigada**, não puxado de
  `employees`/`users` (que não têm telefone confiável hoje — a maioria
  dos funcionários não tem `user_id`/conta de login). É o contato de
  emergência específico desse papel, pode ser diferente de qualquer
  telefone de conta.
- **Turno é texto livre** — sem lista fixa, nada no produto hoje
  modela turno de forma estruturada.
- **Mesmo conjunto de papéis do sub-projeto A** (`empresa`, `tecnico`,
  `parceiro`, `+admin` pra apagar) — mesma resolução de `tenant_id`.
- **Integra com o dashboard já existente**, mesmo formato do
  sub-projeto A: brigadista sem treinamento válido entra em `atencao`
  como `prioridade: 'alta'`, vencendo como `media`.

## 3. Modelo de dados

Migration `backend/db/migrations/0037_fire_brigade.sql`:

```sql
CREATE TABLE fire_brigade_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  funcao_brigada TEXT NOT NULL CHECK (funcao_brigada IN ('lider', 'vice_lider', 'brigadista')),
  turno TEXT,
  telefone TEXT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id)
);
CREATE INDEX fire_brigade_members_company_unit_idx ON fire_brigade_members (company_unit_id);
CREATE TRIGGER trg_fire_brigade_members_updated_at BEFORE UPDATE ON fire_brigade_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE fire_brigade_trainings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- CASCADE, não RESTRICT como cipa_trainings.employee_id — aqui o
  -- "dono" do histórico é o vínculo com a brigada, não o funcionário
  -- em si. Se o brigadista sai da brigada, o histórico de treinamento
  -- de brigada não tem mais sentido isolado.
  member_id UUID NOT NULL REFERENCES fire_brigade_members(id) ON DELETE CASCADE,
  data_realizacao DATE NOT NULL,
  data_validade DATE NOT NULL,
  carga_horaria INT,
  certificado_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fire_brigade_trainings_member_idx ON fire_brigade_trainings (member_id);
CREATE INDEX fire_brigade_trainings_validade_idx ON fire_brigade_trainings (data_validade);
CREATE TRIGGER trg_fire_brigade_trainings_updated_at BEFORE UPDATE ON fire_brigade_trainings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE fire_brigade_coverage_targets (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  quantidade_necessaria INT NOT NULL DEFAULT 0 CHECK (quantidade_necessaria >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_unit_id)
);
CREATE TRIGGER trg_fire_brigade_coverage_targets_updated_at BEFORE UPDATE ON fire_brigade_coverage_targets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE fire_brigade_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_brigade_members FORCE ROW LEVEL SECURITY;
CREATE POLICY fire_brigade_members_isolation ON fire_brigade_members USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

ALTER TABLE fire_brigade_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_brigade_trainings FORCE ROW LEVEL SECURITY;
CREATE POLICY fire_brigade_trainings_isolation ON fire_brigade_trainings USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

ALTER TABLE fire_brigade_coverage_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_brigade_coverage_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY fire_brigade_coverage_targets_isolation ON fire_brigade_coverage_targets USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
```

`UNIQUE (tenant_id, employee_id)` em `fire_brigade_members`: um
funcionário só pode ter um vínculo de brigada por vez (sem duplicidade
de cadastro). Reingressar depois de `status='inativo'` é um `PATCH`
que reativa a mesma linha, não um `INSERT` novo — mesmo espírito da
reativação de funcionário já implementada (`docs/specs/planos-limite-funcionarios.md`),
mas aqui sem nenhum limite de plano associado.

`fire_brigade_coverage_targets` usa `company_unit_id` como chave
primária direta (uma meta por filial, sem histórico de mudanças —
sobrescreve o valor anterior).

## 4. Cálculo do painel de cobertura

Todos os números abaixo são calculados on-the-fly a partir de
`fire_brigade_members`/`fire_brigade_trainings`/`fire_brigade_coverage_targets`
pra uma filial (`company_unit_id`) — nada persistido:

- **Necessários** = `quantidade_necessaria` da filial (`0` se nunca
  configurada).
- **Ativos** = `COUNT(*)` de membros com `status = 'ativo'`.
- **Treinados** = membros ativos com pelo menos um
  `fire_brigade_trainings.data_validade >= hoje`.
- **Vencendo** = membros treinados cuja MAIOR `data_validade` entre
  todos os treinamentos (não o mais recente por `data_realizacao` —
  um treinamento cadastrado depois pode ter validade mais curta que
  um anterior) está entre hoje e hoje+30 dias (mesma janela de 30
  dias usada em todo o resto do produto).
- **Vencido** = membros ativos SEM nenhum treinamento com
  `data_validade >= hoje` (nunca treinou, ou todo treinamento já
  expirou) — equivalente a dizer que a MAIOR `data_validade` entre
  todos os treinamentos do membro é anterior a hoje (ou não existe
  nenhum treinamento).
- **Vagas necessárias** = `max(0, necessários - treinados)`.

## 5. Fluxo e API

Módulo novo `backend/src/fire-brigade/`. Mesmos papéis do
sub-projeto A: `@Roles('empresa', 'tecnico', 'parceiro')` pra
criar/editar membro e registrar treinamento; `+'admin'` pra apagar
membro. Resolução de `tenant_id` idêntica (técnico/parceiro mandam no
body, empresa usa o do próprio token).

1. **Cadastro de brigadista** (`POST /fire-brigade/members`): valida
   que `employee_id` pertence ao tenant resolvido e está
   `status='ativo'` em `employees` (mesmo espírito da checagem de
   posse de `company_unit_id` já usada em Funcionários/EPI/sub-projeto
   A). Valida que `company_unit_id` também pertence ao mesmo tenant.
2. **Listagem** (`GET /fire-brigade/members?tenant_id=&company_unit_id=&status=`):
   devolve os membros com o `full_name`/`position_id` do funcionário
   vinculado via JOIN (pra não obrigar o frontend a fazer uma segunda
   chamada por membro).
3. **Edição/exclusão** (`PATCH`/`DELETE /fire-brigade/members/:id`).
4. **Registro de treinamento** (`POST /fire-brigade/members/:id/trainings`):
   data de realização, validade, carga horária, certificado opcional
   (upload via R2, mesmo padrão de upload usado no sub-projeto A —
   `multipart/form-data`, campo `file`).
5. **Histórico de treinamento** (`GET /fire-brigade/members/:id/trainings`).
6. **Painel de cobertura** (`GET /fire-brigade/coverage?company_unit_id=`):
   devolve os 5 números da Seção 4 pra uma filial.
7. **Meta de cobertura** (`PUT /fire-brigade/coverage-target`):
   `{ company_unit_id, quantidade_necessaria, tenant_id? }` — cria ou
   sobrescreve a meta daquela filial (upsert por `company_unit_id`).
   Mesma resolução de `tenant_id` do restante da API: `tecnico`/
   `parceiro` mandam `tenant_id` no body (obrigatório pra eles),
   `empresa` sempre usa o do próprio token e não precisa mandar. O
   service valida que `company_unit_id` pertence ao tenant resolvido
   antes do upsert, mesma checagem já usada em `POST /members`.
8. **Integração com o dashboard**: `DashboardService.getSummary` ganha
   uma nova fonte, ao lado de `getEpiStatus`/`getFireSafetyEquipmentStatus`
   já existentes no mesmo `Promise.all`, somando brigadistas
   vencidos/vencendo em `atencao`/`resumo.pendencias`/`resumo.avisos`.
   Cada tenant pode ter várias filiais — a fonte percorre todas as
   filiais do tenant, não uma só.

## 6. Frontend

Página nova `/empresa/brigada`, mesmo padrão de arquivo único já
usado em EPI/Mapa SST/sub-projeto A:

- Painel de cobertura no topo (os 5 números da Seção 4), por filial
  selecionada (seletor de filial quando a empresa tem mais de uma).
- Formulário de cadastro de brigadista: busca/seleção de funcionário
  já cadastrado (não texto livre), função na brigada, turno, telefone,
  filial.
- Tabela de membros: nome (do funcionário vinculado), função, filial,
  turno, telefone, status do treinamento (🟢/🟡/🔴, mesmo padrão visual
  do sub-projeto A), ação de registrar treinamento (abre um
  mini-formulário: data, validade, carga horária, upload de
  certificado opcional).
- Campo pra editar a meta de cobertura da filial selecionada.

## 7. Fora de escopo

- Os outros 5 sub-projetos ainda não iniciados (checklists de
  prevenção + simulados de emergência; Plano de Ação de Emergência;
  documentos PPCI/PSPCI/APPCI; dashboard "índice de prevenção"; agente
  especialista em incêndio).
- Legislação estadual multi-UF sobre tamanho mínimo de brigada — frente
  à parte, de conteúdo/curadoria normativa, já adiada em todos os 7
  sub-projetos.
- Simulados de evacuação e presença de brigadista em simulado (isso é
  o sub-projeto C, que vai referenciar `fire_brigade_members` quando
  chegar a vez).
- Qualquer cálculo automático do número "necessário" a partir de
  headcount/classe de risco do prédio.
- Notificação/alerta fora do dashboard já existente (e-mail dedicado,
  push) — o mesmo mecanismo de `atencao`/digest semanal já usado no
  resto do produto cobre isso.
