# Fase 6 (sub-projeto C) — Catálogo de EPI

> Terceiro e último sub-projeto pendente da Fase 6 (Fluxo de visita
> presencial + Dashboard Parceiro). Decisão confirmada em brainstorming
> de 2026-08-25: modelo 1 do documento de referência original
> (`docs/reference/modelos-relatorios-sst.md`, seção 1), adiado três
> vezes (Fase 4A, Fase 5, Fase 6 sub-projeto A) pra manter escopo
> controlado. Escopo mudou nesta rodada: o fundador anexou o catálogo
> oficial completo do Anexo I da NR-06 (93 itens, 9 categorias),
> preservado em
> [`docs/reference/catalogo-epi-nr06.md`](../reference/catalogo-epi-nr06.md)
> — isso substitui a ideia original de campo de texto livre por uma
> tabela de referência fixa, mesmo padrão dos itens de checklist da
> inspeção.

## 1. Objetivo e escopo

Dar à empresa e ao seu técnico (responsável ou parceiro) um catálogo
real dos EPIs que a empresa possui — cada um referenciando um dos 93
itens oficiais do Anexo I da NR-06, com o número de CA real do produto
físico — e o vínculo de entrega desse EPI a um funcionário específico,
com confirmação por assinatura eletrônica simples (mesmo padrão já
usado na conclusão de inspeção).

**Não é objetivo desta entrega:**
- Verificação automática de CA no CAEPI/consultaca.com — campo de texto
  digitado, sem integração.
- Inspeção de desgaste do equipamento, separada da validade do CA —
  fora de escopo; só a validade do próprio CA é rastreada.
- Contar EPI no score de conformidade (Fase 4B) — só entra na agenda de
  vencimentos, não no cálculo de score.
- Tela de configuração dos 93 itens do Anexo I — são fixos, semeados
  uma vez via migration, iguais em espírito aos itens fixos do
  checklist de inspeção (`docs/specs/fase-6-inspecoes.md`, seção 2.2).

## 2. Modelo de dados

### 2.1 `epi_catalog_items` — tabela de referência global, fixa

**Correção feita durante o planejamento (2026-08-25):** a versão original
desta seção tinha `code UNIQUE`. Isso está errado contra o dado real —
`code` (ex. `A.1`, `F.1`) identifica uma *subcategoria* do Anexo I, não
uma linha: `A.1` aparece 3 vezes (capacete contra impacto, contra
choque elétrico, contra agentes térmicos), `F.1` aparece 9 vezes só
para variações de luva. A unicidade real de cada linha é `id` (UUID);
`code` sozinho nunca foi único nos dados de origem. Corrigido abaixo
para `UNIQUE (code, description)` — impede duplicar a mesma linha exata
na semeadura, sem impor uma restrição que os dados não cumprem.

```sql
CREATE TABLE epi_catalog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I')),
  code TEXT NOT NULL,
  equipment_group TEXT NOT NULL,
  description TEXT NOT NULL,
  risk_protected TEXT NOT NULL,
  related_nr TEXT,
  legal_basis TEXT NOT NULL DEFAULT 'NR-06, Anexo I',
  UNIQUE (code, description)
);
```

Sem `tenant_id`, sem RLS — é dado de referência público (o mesmo Anexo I
vale pra qualquer empresa), igual em espírito a uma tabela de enum
estendida. Semeada uma vez via `INSERT` na própria migration, com os 93
itens de
[`docs/reference/catalogo-epi-nr06.md`](../reference/catalogo-epi-nr06.md)
— o frontend agrupa o seletor por `category` e depois por `code`
(`A.1`, `F.3`, etc.), mas cada opção selecionável é uma linha
individual (`id`), já que `code` sozinho pode cobrir várias descrições
diferentes dentro do mesmo grupo.

### 2.2 `tenant_epis` — EPI real que a empresa possui

```sql
CREATE TABLE tenant_epis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  epi_catalog_item_id UUID NOT NULL REFERENCES epi_catalog_items(id),
  ca_number TEXT NOT NULL,
  ca_valid_until DATE,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_tenant_epis_updated_at BEFORE UPDATE ON tenant_epis
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

`ca_valid_until` opcional (nem todo CA tem validade rastreada
manualmente) — mesmo padrão de `documents.expires_at`, consumido pela
agenda de vencimentos (seção 4).

### 2.3 `employee_epi_deliveries` — vínculo funcionário↔EPI

```sql
CREATE TABLE employee_epi_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_epi_id UUID NOT NULL REFERENCES tenant_epis(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  delivered_at DATE NOT NULL,
  signed_by_name TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`tenant_id` denormalizado aqui (em vez de só derivar de `tenant_epi_id`
→ `tenant_epis.tenant_id`) pelo mesmo motivo que `action_plans` já
denormaliza: a RLS compara `tenant_id` direto na própria linha, sem
precisar de mais um `JOIN` na policy. `signed_by_name`/`signed_at`
seguem exatamente o padrão de assinatura eletrônica simples já usado em
`inspections.technician_signature_name`/`_at` — nome digitado por quem
está confirmando a entrega, sem canvas.

### 2.4 RLS — mesmo padrão de `documents`/`inspections`

`tenant_epis` e `employee_epi_deliveries` usam a policy idêntica em
forma à `documents_isolation` (já estendida pra `parceiro` na Fase 6
sub-projeto B — `docs/specs/fase-6-acesso-parceiro.md`, seção 2):
`admin` vê tudo; `empresa` vê o próprio `tenant_id`; `tecnico`/`parceiro`
veem tenants vinculados via `tenant_technicians`/`tenant_partners`.

```sql
ALTER TABLE tenant_epis ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_epis FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_epis_isolation ON tenant_epis USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = tenant_epis.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = tenant_epis.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);
```

`employee_epi_deliveries_isolation` idêntica, trocando `tenant_epis` por
`employee_epi_deliveries`. `epi_catalog_items` não tem RLS (seção 2.1).

## 3. Backend (`EpiModule` novo)

- `GET /epi-catalog-items` — sem `@Roles`, sem filtro de tenant (dado
  público). Lista os 93 itens fixos, usada pelo frontend pra popular o
  seletor de categoria/item ao cadastrar um EPI novo.
- `POST /epis` (`@Roles('empresa', 'tecnico', 'parceiro')`) — cria um
  `tenant_epis`. Corpo: `epi_catalog_item_id`, `ca_number`,
  `ca_valid_until` (opcional), e `tenant_id` (só lido quando quem envia
  é `tecnico`/`parceiro`, mesmo padrão já estabelecido em
  `documents`/`inspections`).
- `GET /epis` (sem `@Roles`) — `tenant_id` obrigatório pra
  `tecnico`/`parceiro` (mesmo guard já usado em `GET /documents`, `GET
  /inspections`), opcional pra empresa (RLS decide).
- `DELETE /epis/:id` (`@Roles('empresa', 'tecnico', 'parceiro', 'admin')`)
  — sem checagem de "só quem cadastrou apaga" (diferente de
  `documents`): qualquer usuário com acesso ao tenant pode remover um
  EPI cadastrado errado, já que isso é dado de catálogo compartilhado
  da empresa, não um arquivo de autoria individual.
- `POST /epis/:id/deliveries` (`@Roles('empresa', 'tecnico', 'parceiro')`)
  — cria um `employee_epi_deliveries`. Corpo: `employee_id`,
  `delivered_at`, `signed_by_name`.
- `GET /epis/:id/deliveries` (sem `@Roles`) — lista as entregas de um
  EPI específico.

## 4. Frontend

### 4.1 Empresa — `/empresa/epis` (página nova)

Lista os EPIs cadastrados (categoria/código/descrição do Anexo I +
CA + validade se houver), formulário de cadastro (seletor de item do
Anexo I agrupado por categoria, campo de CA, validade opcional), e por
EPI uma lista de entregas + botão "Registrar entrega" (seleciona
funcionário já cadastrado, campo de nome de quem confere, data).

### 4.2 Técnico — seção em `/tecnico/empresas/[tenantId]`

Mesma UI da empresa, reaproveitando o mesmo componente (mesmo padrão já
usado pra `DocumentsPanel`), chamando os endpoints com `?tenant_id=`
explícito.

### 4.3 Agenda de vencimentos — reaproveita a lógica existente

As páginas de agenda (`/tecnico/agenda`, seção de agenda em
`DocumentsPanel`) passam a também buscar `GET /epis` (além de `GET
/documents`), mapeiam cada EPI com `ca_valid_until` preenchido pro
mesmo formato `{id, category: 'epi', title, expires_at}` já usado pra
documentos, e mesclam as duas listas no cliente antes de agrupar por
mês — sem UNION no backend, mesmo espírito 100%-frontend da Fase 4C.
`title` do item de agenda: `"CA {ca_number} — {equipment_group}"`.

## 5. Testes

Mesmo padrão do projeto: e2e reais contra o Postgres real, sem mock.

- `GET /epi-catalog-items` retorna os 93 itens semeados.
- Empresa cadastra um `tenant_epis`, aparece em `GET /epis`.
- Técnico/parceiro vinculado cadastra EPI pra empresa vinculada; não
  vinculado é rejeitado pela RLS (`42501` → 403 via `mapPgError`).
- Registrar entrega gera `employee_epi_deliveries` com
  `signed_by_name`/`signed_at` preenchidos.
- RLS: empresa não vê `tenant_epis`/`employee_epi_deliveries` de outro
  tenant; técnico/parceiro só vê tenants vinculados — mesmo par de
  testes positivo/negativo já usado em `documents-rls.e2e-spec.ts` e
  `inspections-rls.e2e-spec.ts`.
- `DELETE /epis/:id` funciona pra qualquer usuário com acesso ao
  tenant, não só quem cadastrou (confirma a diferença intencional da
  seção 3).

## 6. Decisões confirmadas (brainstorming de 2026-08-25)

| Decisão | Escolha |
|---|---|
| Modelo do catálogo | Referência fixa global (93 itens do Anexo I), não texto livre por empresa |
| Escopo desta entrega | Catálogo + vínculo funcionário↔EPI juntos, não separados |
| Assinatura de entrega | Mesmo padrão de nome digitado + confirmação já usado na inspeção |
| Quem gerencia | Empresa e técnico/parceiro, mesma regra de acesso já estabelecida |
| Local na UI | Página própria, não dentro do `DocumentsPanel` |
| Verificação de CA / desgaste | Fora de escopo, campo de texto simples |
| Validade do CA | Campo opcional, entra na agenda de vencimentos existente |

## 7. Pendências

- [ ] **Verificação automática de CA** (CAEPI/consultaca.com) — fora de
      escopo, mencionado como sugestão futura desde
      `docs/reference/modelos-relatorios-sst.md`.
- [ ] **Inspeção de desgaste do equipamento** — fora de escopo, campo
      conceitualmente diferente da validade do CA.
- [ ] **Score de conformidade incluindo EPI** — decisão de produto a
      confirmar depois; hoje o score (Fase 4B) só considera `documents`.
- [ ] Com o Catálogo de EPI fechado, a Fase 6 fica completa (fluxo de
      inspeção, acesso do parceiro, catálogo de EPI) — próximo item do
      roadmap original é a Fase 7 (Dashboard Admin).
