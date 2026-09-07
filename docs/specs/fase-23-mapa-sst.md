# Fase 23 — Mapa SST: cargo, requisitos e divergência (EPI + treinamento)

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-07.
> Terceira e última fatia conhecida da visão de "Diagnóstico Inicial"
> trazida pelo fundador em 2026-09-06 (as duas primeiras foram a Fase 21,
> upload de documentos em lote, e a Fase 22, importação flexível de
> planilha de funcionários — ambas fechadas). Diferente das duas
> anteriores, o fundador pediu explicitamente pra desenhar as 3 sub-partes
> desta fase juntas numa spec só (grafo de cargo + divergência de EPI +
> divergência de treinamento), em vez de fatiar o brainstorming — a
> implementação, porém, pode ainda ser decomposta em múltiplos planos
> sequenciais na etapa de writing-plans, já que cada sub-parte produz
> software testável de forma independente.

## 1. Objetivo e escopo

Hoje o sistema não tem nenhum conceito de "o que é obrigatório para o
cargo X". `employees.position` é texto livre, sem catálogo. EPI é
registrado como evento solto por funcionário (`employee_epi_deliveries`),
treinamento NR também (`cipa_trainings` por `employee_id`) — nenhum dos
dois é vinculado a um cargo. Não existe hoje nenhuma forma de saber "todo
soldador tem que ter troca de EPI pra corte e NR-35, quem tá faltando?".

Esta fase cria:

1. **Cargo como entidade real** (catálogo `positions` por tenant), com
   vínculo dos funcionários já cadastrados via sugestão automática
   determinística (agrupando texto livre parecido).
2. **Catálogo de requisito por cargo**: quais itens do catálogo de EPI
   (já existente, Fase 6) e quais tipos de treinamento NR (já existentes,
   Fase 15) cada cargo exige — configurado manualmente pela empresa, sem
   nenhuma sugestão automática de "cargo X normalmente precisa de Y" (não
   existe base determinística confiável pra isso).
3. **Divergência**: comparação entre o que o cargo exige e o que cada
   funcionário já tem registrado — funcionário sem EPI exigido entregue,
   ou sem treinamento NR exigido válido, aparece como pendência.
4. **Visualização**: página nova `/empresa/mapa-sst` (lista de cargos com
   drill-down — sem biblioteca de grafo visual, mesmo padrão de
   cards/tabelas já usado no resto do dashboard) + integração com a lista
   de atenção que o dashboard já mostra hoje.

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Cargo vira entidade real** (`positions`, por tenant) — o texto livre
  `employees.position` continua existindo como rótulo de exibição/legado,
  não é removido nem substituído; ganha uma coluna nova `position_id`
  (nullable) ao lado.
- **Vínculo automático sugerido, não obrigatório** — funcionários
  existentes recebem uma sugestão de agrupamento por texto parecido; a
  empresa confirma ou ajusta antes de qualquer vínculo ser salvo.
  Funcionário sem `position_id` simplesmente não entra no cálculo de
  divergência (não gera falsa pendência).
- **Requisito por cargo é 100% manual** — a empresa escolhe os itens do
  catálogo de EPI e os tipos de treinamento NR que cada cargo exige, sem
  nenhuma sugestão de IA nem heurística — segue a disciplina já registrada
  no projeto ("nível 1 antes de nível 3", ver
  `docs/assistente-montese-principios.md`).
- **Duas tabelas de requisito explícitas** (`position_epi_requirements`,
  `position_training_requirements`), não uma tabela genérica polimórfica
  — mantém FK real pro catálogo de EPI, consistente com o padrão já usado
  em todo o schema deste projeto (nenhuma tabela polimórfica existe hoje).
- **EPI "atendido" = pelo menos 1 entrega registrada, sempre** — não
  importa há quanto tempo, nem se o CA daquele EPI específico já venceu
  (isso já é rastreado à parte, como CA vencido, no dashboard existente).
- **Treinamento "divergente" = nunca fez OU venceu** — uma única
  consulta (`NOT EXISTS { tipo, data_validade >= hoje }`) cobre os dois
  casos, sem inventar critério novo além do que a Fase 15 já rastreia.
- **Cargo é por tenant, não por filial** — mesmo escopo que o texto livre
  `position` já tem hoje (nenhum dos dois é vinculado a `company_unit`).
- **Sem visualização de grafo** — lista de cargos com drill-down,
  reaproveitando os padrões visuais já usados no resto do dashboard
  (cards de status, cores ok/atenção/crítico). Nenhuma biblioteca de
  grafo visual entra no projeto nesta fase.
- **Cálculo de divergência é sob demanda**, sem cache — mesmo padrão já
  usado em `DashboardService.getSummary` (que já faz várias consultas
  via `Promise.all` a cada requisição).
- **Divergência alimenta o dashboard existente** — cada divergência
  encontrada vira um item na lista `atencao` que `DashboardService`
  já monta hoje (mesmo formato dos itens de documento/CA vencido),
  prioridade `alta`, e conta em `resumo.pendencias` (deixando `status`
  como `critico` quando há alguma) — é uma lacuna de compliance real,
  não um aviso de vencimento futuro.

## 3. Modelo de dados

Migration nova (próximo número disponível):

```sql
CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions FORCE ROW LEVEL SECURITY;
CREATE POLICY positions_isolation ON positions USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

ALTER TABLE employees ADD COLUMN position_id UUID REFERENCES positions(id) ON DELETE SET NULL;
-- SET NULL, não CASCADE nem RESTRICT: apagar um cargo não pode apagar
-- nem bloquear a exclusão do funcionário — ele só perde o vínculo e some
-- do cálculo de divergência, mesmo comportamento de "sem cargo vinculado".

CREATE TABLE position_epi_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  epi_catalog_item_id UUID NOT NULL REFERENCES epi_catalog_items(id),
  UNIQUE (position_id, epi_catalog_item_id)
);

ALTER TABLE position_epi_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE position_epi_requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY position_epi_requirements_isolation ON position_epi_requirements USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

CREATE TABLE position_training_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'nr-05', 'nr-06', 'nr-10', 'nr-11', 'nr-12', 'nr-18', 'nr-20',
    'nr-33', 'nr-35', 'outro'
  )),
  UNIQUE (position_id, tipo)
);

ALTER TABLE position_training_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE position_training_requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY position_training_requirements_isolation ON position_training_requirements USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
```

`tipo` reaproveita EXATAMENTE o mesmo enum já usado em
`cipa_trainings.tipo` (migration `0030_cipa_capacitacao.sql`) — nenhum
tipo novo é criado nesta fase.

`tenant_id` é redundante com o que já dá pra derivar via
`positions.tenant_id` nas duas tabelas de requisito, mas é mantido
explícito (mesmo padrão já usado em `employee_epi_deliveries`, que
também tem `tenant_id` redundante com `tenant_epis.tenant_id`) — permite
que a policy de RLS não dependa de um JOIN pra decidir visibilidade.

## 4. Fluxo — vínculo de funcionário a cargo

1. Empresa acessa `/empresa/mapa-sst`. Se existem funcionários com
   `position_id IS NULL` e `position IS NOT NULL`, aparece um banner
   "N funcionários sem cargo vinculado" com um botão "Revisar".
2. `GET /positions/link-suggestions` (novo, não salva nada): agrupa
   `employees.position` (só os com `position_id IS NULL`) por forma
   normalizada (mesma normalização já usada em `normalizeHeader` da Fase
   22 — NFD, remove acento, lowercase, trim, colapsa espaços). Cada grupo
   normalizado distinto vira uma sugestão: `{ suggested_name: string,
   employee_ids: string[], employee_count: number }` — `suggested_name`
   é o texto RAW mais frequente do grupo (empate desfeito por ordem
   alfabética, determinístico). Funcionários com `position` NULL (sem
   texto algum) não entram em nenhum grupo — ficam de fora da sugestão,
   precisam de vínculo manual (Seção 4, último parágrafo).
   **Limitação conhecida, documentada explicitamente pra empresa na UI**:
   abreviações ou grafias muito diferentes do mesmo cargo ("Aux.
   Administrativo" vs "Auxiliar Administrativo") viram grupos SEPARADOS —
   a normalização só resolve acento/case/espaço, não sinônimo. A empresa
   pode mesclar dois grupos manualmente antes de confirmar (edita o
   `suggested_name` de um grupo pra ser igual ao de outro na tela — o
   frontend então os trata como uma única entrada ao montar o payload de
   confirmação).
3. Frontend mostra cada grupo com o nome sugerido (editável) e a lista de
   funcionários daquele grupo. Empresa revisa, edita nomes se quiser,
   pode remover um funcionário de um grupo (ele fica de fora desta
   rodada, tratável depois manualmente).
4. Empresa confirma. Frontend chama `POST /positions/confirm-links`
   (novo) com o payload final: `{ groups: { name: string, employee_ids:
   string[] }[] }`. Backend, numa transação: pra cada grupo, faz
   `INSERT ... ON CONFLICT (tenant_id, name) DO UPDATE SET name =
   EXCLUDED.name RETURNING id` em `positions` (idempotente — se a
   empresa já tem um cargo com esse nome de uma rodada anterior,
   reaproveita em vez de duplicar), depois `UPDATE employees SET
   position_id = $1 WHERE id = ANY($2)` pra cada `employee_ids` do
   grupo.
5. **Vínculo manual individual** (fora do fluxo de sugestão em lote):
   `employees.position_id` entra em `UPDATABLE_FIELDS`
   (`employees.service.ts`) — `PATCH /employees/:id` já aceita o campo,
   sem endpoint novo. Usado tanto pra ajustar um vínculo sugerido errado
   quanto pra vincular um funcionário novo, cadastrado depois desta
   rodada, direto na tela de detalhe do funcionário ou na tela de
   detalhe do cargo (Seção 6). **Precisa da mesma checagem de posse já
   usada pra `company_unit_id`**: `EmployeesService.update()` já valida
   que um `company_unit_id` recebido pertence ao mesmo tenant do
   funcionário-alvo antes de gravar (`assertCompanyUnitBelongsToTenant`,
   já existente) — `position_id` precisa do mesmo tratamento (`SELECT id
   FROM positions WHERE id = $1 AND tenant_id = $2`, 400 se não achar),
   senão um `position_id` de outro tenant passaria pela RLS de
   `employees` (que é sobre o funcionário, não sobre o cargo
   referenciado) sem nenhuma validação cruzada.

## 5. Fluxo — configuração de requisitos por cargo

1. `GET /positions` (novo): lista os cargos do tenant, cada um com
   `{ id, name, employee_count, epi_requirement_count,
   training_requirement_count, divergence_count }`.
2. `POST /positions` (novo): cria um cargo manualmente (`{ name }`,
   valida unicidade por tenant, 409 se já existe).
3. `PATCH /positions/:id` (novo): renomeia (mesma validação de
   unicidade).
4. `GET /positions/:id` (novo): detalhe — requisitos configurados
   (lista de `epi_catalog_item_id`/`tipo`) + funcionários vinculados,
   cada um com o status de cada requisito (`atendido` / `divergente`,
   Seção 6).
5. `PUT /positions/:id/epi-requirements` (novo): substitui a lista
   completa de `epi_catalog_item_id` exigidos (`{ epi_catalog_item_ids:
   string[] }` — idempotente, sempre a lista final, não add/remove
   incremental). Frontend mostra os itens do catálogo de EPI (já
   existente, Fase 6) agrupados pelas categorias A-I da NR-06, com
   checkbox por item.
6. `PUT /positions/:id/training-requirements` (novo): substitui a lista
   completa de `tipo` exigidos (`{ tipos: string[] }`, mesmo enum de
   `cipa_trainings.tipo`). Frontend mostra os 10 tipos como checkbox.

## 6. Fluxo — cálculo e exibição de divergência

**Backend — `PositionsService.getDivergences(client, tenantId)`**, nova
consulta (sem parâmetro de cargo — sempre calcula pra todo o tenant,
reaproveitada tanto pela página quanto pelo dashboard):

```sql
-- Divergência de EPI: funcionário com cargo, cargo exige o item, sem
-- nenhuma entrega registrada daquele item. `categoria` aqui identifica
-- a NATUREZA da divergência (epi vs treinamento) — não confundir com
-- AttentionItem.tipo (que é a categoria de exibição no dashboard,
-- ganha o valor único 'cargo' pras duas, ver abaixo).
SELECT e.id AS employee_id, e.full_name AS employee_name, p.name AS position_name,
       'epi' AS categoria, eci.description AS requisito,
       EXISTS (SELECT 1 FROM tenant_epis te WHERE te.tenant_id = e.tenant_id
               AND te.epi_catalog_item_id = eci.id) AS empresa_tem_no_catalogo
FROM employees e
JOIN positions p ON p.id = e.position_id
JOIN position_epi_requirements per ON per.position_id = p.id
JOIN epi_catalog_items eci ON eci.id = per.epi_catalog_item_id
WHERE e.tenant_id = $1
  AND NOT EXISTS (
    SELECT 1 FROM employee_epi_deliveries eed
    JOIN tenant_epis te ON te.id = eed.tenant_epi_id
    WHERE eed.employee_id = e.id AND te.epi_catalog_item_id = eci.id
  );

-- Divergência de treinamento: funcionário com cargo, cargo exige o
-- tipo, sem registro válido (nunca fez OU venceu).
SELECT e.id AS employee_id, e.full_name AS employee_name, p.name AS position_name,
       'treinamento' AS categoria, ptr.tipo AS requisito
FROM employees e
JOIN positions p ON p.id = e.position_id
JOIN position_training_requirements ptr ON ptr.position_id = p.id
WHERE e.tenant_id = $1
  AND NOT EXISTS (
    SELECT 1 FROM cipa_trainings ct
    WHERE ct.employee_id = e.id AND ct.tipo = ptr.tipo AND ct.data_validade >= CURRENT_DATE
  );
```

Quando `empresa_tem_no_catalogo = false` (a empresa nunca cadastrou
aquele item em `tenant_epis`), a mensagem exibida é diferente: "EPI
exigido não está no catálogo cadastrado desta empresa" em vez de "EPI
não entregue" — evita confundir "esqueceram de entregar" com "nem
compraram o EPI".

**Página `/empresa/mapa-sst`**: lista de cargos (Seção 5) com resumo de
divergência por cargo; drill-down mostra os funcionários daquele cargo
com status por requisito (✓ atendido / ⚠ divergente, com a mensagem
específica de cada caso).

**Integração com o dashboard existente**
(`backend/src/dashboard/dashboard.service.ts`): `AttentionItem['tipo']`
ganha o valor novo `'cargo'`; `DashboardService.getSummary` adiciona
`this.positions.getDivergences(client, tenantId)` ao `Promise.all` já
existente (junto de `getEpiStatus`/`getActionPlans`/
`countInspecoesPendentes`), mapeia cada divergência pra um
`AttentionItem` (`titulo` = "EPI não entregue: {requisito} — {employee_name}
({position_name})" ou "Treinamento {requisito} pendente/vencido —
{employee_name} ({position_name})", `prioridade: 'alta'`, `data: null`,
`responsavel: 'empresa'`, `link: '/empresa/mapa-sst'`), e soma a
`resumo.pendencias` (mesmo efeito de deixar `status: 'critico'` que
documento/CA vencido já têm hoje).

## 7. Fora de escopo

- Qualquer visualização de grafo visual (nós/linhas) — fica pra uma
  fase futura, se algum dia for pedida explicitamente.
- Sugestão automática (IA ou heurística) de "quais EPI/treinamento o
  cargo X deveria exigir" — sempre manual nesta fase.
- Fusão automática de grupos de sugestão de vínculo com grafia muito
  diferente (abreviação, sinônimo) — mesclagem é sempre manual na tela
  de revisão.
- Cargo vinculado a filial (`company_unit_id`) — cargo é por tenant.
- Qualquer mudança em `employee_epi_deliveries`/`cipa_trainings` em si
  (criação, edição, exclusão) — esta fase só LÊ esses dados pra calcular
  divergência, não altera o fluxo de registro que já existe.
- Qualquer mudança nas Fases 21/22 (upload de documentos em lote,
  importação de planilha de funcionários).
- Qualquer uso de IA/MiniMax nesta fase — todo o cálculo é
  determinístico (SQL puro).
