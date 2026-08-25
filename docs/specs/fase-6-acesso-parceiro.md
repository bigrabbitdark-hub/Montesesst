# Fase 6 (sub-projeto B) — Acesso do técnico parceiro

> Segundo sub-projeto da Fase 6 (Fluxo de visita presencial + Dashboard
> Parceiro). Decisão confirmada em brainstorming de 2026-08-25: entre as
> duas peças adiadas pela sub-fase A (acesso do parceiro e catálogo de
> EPI), o acesso do parceiro vem primeiro — reaproveita 100% do schema e
> das telas que a sub-fase A (fluxo de inspeção) já construiu.

## 1. Objetivo e escopo

O papel `parceiro` existe no banco desde a Fase 1 (tabelas `partners` e
`tenant_partners`, CRUD completo em `backend/src/partners/`), mas nunca
foi usado em nenhuma tela — hoje um usuário `parceiro` loga e o redirect
manda ele para `/` (home pública), e nenhum endpoint reconhece esse papel
além do próprio módulo `partners`.

Esta entrega dá ao técnico parceiro acesso completo às mesmas telas que
o técnico responsável já usa (`/tecnico/empresas`,
`/tecnico/empresas/[tenantId]`, `/tecnico/agenda`, e o fluxo de inspeção
completo) — documentos, conformidade, agenda e inspeções — para as
empresas às quais ele está vinculado via `tenant_partners`, com as
mesmas permissões que o técnico responsável tem hoje (ler tudo, subir e
apagar documento, criar/editar/concluir inspeção).

**Descoberta que mudou o escopo original:** a primeira formulação deste
sub-projeto assumia que seria só abrir permissão nos endpoints de
inspeção. Como a decisão foi reaproveitar as MESMAS telas do técnico
responsável (não criar rotas `/parceiro/*` separadas), essas telas
também dependem de `documents` (upload/listagem/conformidade/portfólio)
e `tenant-technicians/me` — não só de `inspections`. Por isso o escopo
real cobre quatro áreas do backend, não uma.

**Não é objetivo desta entrega:**
- Rotas `/parceiro/*` separadas — decisão explícita de reaproveitar as
  telas do técnico responsável.
- Qualquer mudança na tela em si (JSX/componentes) — é só abertura de
  permissão no backend e uma linha no redirect do login.
- Catálogo de EPI — sub-projeto seguinte da Fase 6, spec própria.

## 2. RLS — três políticas ganham um branch novo

`documents_isolation`, `inspections_isolation` e `action_plans_isolation`
(as duas últimas criadas na migration `0010_inspections.sql`) já têm um
branch para `tecnico` via `EXISTS` contra `tenant_technicians`+`technicians`.
Cada uma ganha um branch simétrico para `parceiro` via `tenant_partners`+
`partners`:

```sql
ALTER POLICY documents_isolation ON documents USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = documents.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = documents.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);
```

Mesmo padrão para `inspections_isolation` (troca `documents.tenant_id`
por `inspections.tenant_id`) e `action_plans_isolation` (troca por
`action_plans.tenant_id`). `inspection_checklist_items_isolation`
continua delegando via `EXISTS (SELECT 1 FROM inspections ...)` — nada
muda ali, herda o novo branch automaticamente.

`ALTER POLICY ... USING (...)` substitui a expressão da policy existente
sem precisar de `DROP`/`CREATE` — migration aditiva, sem janela sem RLS.

## 3. Backend — seis pontos que hoje checam só `'tecnico'`

### 3.1 `documents.controller.ts`

- `upload` (`POST /documents`): `@Roles('empresa', 'tecnico')` vira
  `@Roles('empresa', 'tecnico', 'parceiro')`; a linha `const tenantId =
  user.role === 'tecnico' ? dto.tenant_id : user.tenantId;` vira
  `user.role === 'tecnico' || user.role === 'parceiro' ? dto.tenant_id :
  user.tenantId` — parceiro também não tem `tenant_id` próprio no token,
  precisa informar qual empresa no corpo da requisição, igual ao técnico.
- `findAll`/`compliance` (`GET /documents`, `GET /documents/compliance`):
  o guard `if (req.user.role === 'tecnico' && !tenantId)` vira `if
  ((req.user.role === 'tecnico' || req.user.role === 'parceiro') &&
  !tenantId)`.
- `compliance/portfolio` (`GET /documents/compliance/portfolio`):
  `@Roles('tecnico')` vira `@Roles('tecnico', 'parceiro')` — o método já
  usa `req.user.id` para achar as empresas vinculadas; como o service
  hoje faz o JOIN só contra `tenant_technicians`/`technicians`, também
  precisa aprender a fazer o JOIN certo por papel (ver 3.2, mesmo
  princípio).
- `remove` (`DELETE /documents/:id`): `@Roles('empresa', 'tecnico',
  'admin')` vira `@Roles('empresa', 'tecnico', 'parceiro', 'admin')`.

### 3.2 `tenant-technicians.controller.ts` / `.service.ts`

`@Roles('tecnico')` em `GET /me` vira `@Roles('tecnico', 'parceiro')`.
`TenantTechniciansService.findMyTenants` passa a receber também o papel
de quem chama, e monta o JOIN certo:

```typescript
async findMyTenants(client: PoolClient, userId: string, role: 'tecnico' | 'parceiro'): Promise<LinkedTenant[]> {
  const linkTable = role === 'tecnico' ? 'tenant_technicians' : 'tenant_partners';
  const linkColumn = role === 'tecnico' ? 'technician_id' : 'partner_id';
  const personTable = role === 'tecnico' ? 'technicians' : 'partners';
  const result = await client.query<LinkedTenant>(
    `SELECT t.id AS tenant_id, t.name AS tenant_name, t.cnpj AS tenant_cnpj
     FROM ${linkTable} lt
     JOIN ${personTable} p ON p.id = lt.${linkColumn}
     JOIN tenants t ON t.id = lt.tenant_id
     WHERE p.user_id = $1
     ORDER BY t.name`,
    [userId],
  );
  return result.rows;
}
```

Nomes de tabela/coluna interpolados vêm de uma allowlist fixa de dois
valores literais no código (`role === 'tecnico' ? '...' : '...'`), nunca
de entrada do usuário — não é o mesmo risco que interpolar uma chave de
`body` (ver `backend/src/common/safe-update.util.ts` para o motivo dessa
distinção já documentado no projeto).

O controller passa `req.user.role` na chamada. `DocumentsService.getPortfolioCompliance`
(consumida por `compliance/portfolio`, seção 3.1) recebe o mesmo
tratamento — hoje o JOIN ali está hardcoded contra `tenant_technicians`,
precisa da mesma bifurcação por papel.

### 3.3 `inspections.controller.ts`

`create`, `update`, `updateItem`, `concluir` — os quatro `@Roles('tecnico')`
viram `@Roles('tecnico', 'parceiro')`. `findAll`/`findOne` já não têm
`@Roles` (RLS decide), mas o guard de `tenant_id` obrigatório em `findAll`
(`if (req.user.role === 'tecnico' && !tenantId)`) recebe o mesmo
tratamento do item 3.1. `action-plans.controller.ts` (`GET /action-plans`)
idem.

## 4. Frontend — uma linha

`frontend/src/app/(site)/login/page.tsx`:

```typescript
role === 'empresa' ? '/empresa/onboarding' : (role === 'tecnico' || role === 'parceiro') ? '/tecnico/empresas' : '/',
```

Nenhum outro arquivo de frontend muda — as telas já são genéricas o
bastante (chamam os mesmos endpoints, não checam `role` no cliente).

## 5. Testes

Mesmo padrão do projeto: e2e reais contra o Postgres real, sem mock.

- RLS: parceiro vinculado vê `documents`/`inspections`/`action_plans` da
  empresa vinculada; parceiro não vinculado não vê nada — mesmo par de
  testes positivo/negativo já usado para `tecnico` em
  `documents-rls.e2e-spec.ts` e `inspections-rls.e2e-spec.ts`, agora
  também para `parceiro`.
- `GET /tenant-technicians/me` chamado por um usuário `parceiro` retorna
  as empresas vinculadas via `tenant_partners` (não as vinculadas a
  outro técnico via `tenant_technicians`).
- Cada endpoint com `@Roles` ampliado: parceiro vinculado consegue
  chamar (antes só técnico conseguia); papel sem vínculo nenhum (nem
  `tenant_technicians` nem `tenant_partners`) continua sem ver nada, via
  RLS.
- `POST /documents` e `POST /inspections` por um parceiro pra uma
  empresa à qual ele NÃO está vinculado é rejeitado pela RLS (`42501`) e
  mapeado para 403 pelo `mapPgError` já existente nos dois services.

## 6. Decisões confirmadas (brainstorming de 2026-08-25)

| Decisão | Escolha |
|---|---|
| Ordem da Fase 6 | Acesso do parceiro antes do catálogo de EPI |
| O que o parceiro pode fazer | Tudo que o técnico responsável já faz (criar/editar/concluir inspeção, subir/apagar documento) |
| Telas | Reaproveita `/tecnico/*` integralmente — sem rotas `/parceiro/*` |
| Alcance do acesso | Completo (documentos, conformidade, agenda, inspeções) — não só inspeções |

## 7. Pendências

- [ ] **Catálogo de EPI** — sub-projeto seguinte da Fase 6, spec própria.
- [ ] **Dashboard Parceiro visualmente distinto** — não é escopo desta
      entrega (decisão explícita de reaproveitar as telas do técnico
      responsável); se um dia fizer sentido separar visualmente, é um
      sub-projeto à parte que não deveria exigir mudança de backend
      (RLS/roles já ficam prontos aqui).
