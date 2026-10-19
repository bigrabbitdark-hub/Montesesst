# Módulo EPI — Subsistema 1: livro de movimentações e estoque

Status: **implementado e testado no ensaio descartável; não commitado** (worktree `/opt/montese-epi`, branch `feat/epi-estoque`, alterações apenas em stage). Nada em produção.

Rótulos: VERIFICADO (conferido no código, na migration ou em teste existente), NÃO VERIFICADO, RECOMENDADO.
Observação sobre "testes passaram": os resultados dos testes no ensaio foram informados pelo orquestrador; a redação deste documento não reexecutou os testes (NÃO VERIFICADO por quem escreveu, VERIFICADO no código dos testes).

Fontes: `backend/db/migrations/0081_epi_stock_ledger.sql`, `backend/src/epi/*`, `backend/test/epi-*.e2e-spec.ts`, spec `docs/superpowers/specs/2026-10-14-epi-cadastro-movimentacoes-design.md`.

## 1. Visão geral e escopo

O módulo EPI foi dividido em 4 subsistemas. Este documento cobre o **subsistema 1**: cadastro ampliado de EPI, livro de movimentações imutável, saldo materializado, lotes opcionais, alertas e listagem paginada. É só backend (migration, serviço, rotas, testes).

**Não existem ainda** (VERIFICADO: não há código para eles): ficha de controle e PDF (subsistema 2), assinatura eletrônica mobile (3), menu EPI e dashboard (4), e nenhuma tela de frontend. **Atualização:** o subsistema 4 (menu, telas e dashboard) já existe; ver `epi-telas.md` (o trecho "menu EPI e dashboard" e "nenhuma tela" descreve o estado do subsistema 1 isolado). A coluna `employee_epi_deliveries.signature_status` existe só para os próximos subsistemas usarem.

Abordagem (VERIFICADO em `epi-stock.service.ts`): cada movimentação é uma linha imutável em `epi_movements`; o saldo atual fica em `tenant_epis.stock_balance` (e `epi_lots.balance`), atualizado na mesma transação, com `SELECT ... FOR UPDATE` na linha do EPI para serializar concorrência. `EpiStockService.applyMovement` é a única porta de escrita do saldo.

## 2. Modelo de dados (migration 0081)

A migration é aditiva e transacional (nada existente é removido). VERIFICADO no arquivo.

### 2.1 `tenants`
- `epi_alert_days INT NOT NULL DEFAULT 30 CHECK (BETWEEN 1 AND 365)`: janela, em dias, dos alertas de CA/lote a vencer. **Padrão operacional da empresa, não é prazo normativo.** No subsistema 1 não havia rota para alterá-lo. **Atualização (subsistema 4):** agora existe `PATCH /epis/settings` (empresa e admin; `epi_alert_days` 1 a 365; `GET /epis/settings` lê), ver `epi-telas.md` seção 4. Não há tela para o admin (só API).

### 2.2 `tenant_epis` (colunas novas)
`manufacturer`, `model`, `unit` (NOT NULL, padrão `un`), `min_stock` (>= 0), `max_stock` (>= 0), `unit_cost` NUMERIC(12,2) (>= 0), `controls_lot` (NOT NULL, padrão false), `replacement_days` (> 0), `status` (`ativo`/`inativo`, padrão `ativo`), `stock_balance` (NOT NULL, padrão 0, CHECK >= 0), `updated_by_user_id` (FK `users`).
- `chk_tenant_epis_stock_range`: `max_stock >= min_stock` quando ambos existem.
- Índice único `uq_tenant_epis_identity` em `(tenant_id, epi_catalog_item_id, ca_number, COALESCE(manufacturer,''), COALESCE(model,''))`: nulos de fabricante/modelo contam como vazio.

### 2.3 `epi_lots`
`id`, `tenant_id` (FK CASCADE), `tenant_epi_id` (FK RESTRICT), `lot_code`, `valid_until` DATE, `balance` (>= 0), `created_at`. `UNIQUE (tenant_epi_id, lot_code)`; índice `idx_epi_lots_tenant`.

### 2.4 `epi_movements` (imutável)
Colunas: `id`, `tenant_id`, `tenant_epi_id`, `type` (`abertura`, `entrada`, `entrega`, `devolucao`, `troca`, `baixa`, `ajuste`, `estorno`), `direction` (-1/1), `quantity` (> 0), `balance_after` (>= 0), `employee_id`, `supplier`, `lot_id`, `reason`, `occurred_at`, `delivery_id` (FK `employee_epi_deliveries`), `reverses_movement_id` (FK própria), `idempotency_key`, `created_by_user_id` (NOT NULL, FK `users`), `created_at`. Todas as FKs de EPI/funcionário/lote/entrega são `ON DELETE RESTRICT`; `tenant_id` é CASCADE.

Constraints de coerência (VERIFICADO):
- `chk_epi_mov_employee`: entrega, troca e devolução exigem `employee_id`.
- `chk_epi_mov_reason`: baixa, ajuste e estorno exigem `reason` não vazio.
- `chk_epi_mov_supplier`: entrada exige `supplier` não vazio.
- `chk_epi_mov_reverses`: `type = 'estorno'` se e somente se `reverses_movement_id` está preenchido.
- `UNIQUE (tenant_id, idempotency_key)`.
- Índice único parcial `uq_epi_movements_reverses` em `reverses_movement_id` (uma movimentação só é estornada uma vez).
- Índices: `idx_epi_movements_epi (tenant_epi_id, occurred_at DESC)`, `idx_epi_movements_tenant (tenant_id, occurred_at DESC)`, `idx_epi_movements_employee (employee_id) WHERE employee_id IS NOT NULL`.

### 2.5 Trigger de imutabilidade e `epi_tenant_row_exists`
- `trg_epi_movements_immutable` (BEFORE UPDATE OR DELETE, por linha) chama `epi_movements_immutable()`, que levanta `42501` ("epi_movements é imutável (use estorno)").
- Única exceção: DELETE disparado por ação referencial (`pg_trigger_depth() > 1`) **e** o tenant dono da linha já não existe (cascade da exclusão de uma empresa).
- A checagem de existência usa `epi_tenant_row_exists(uuid)`: `SECURITY DEFINER`, VOLATILE, `search_path = public, pg_temp`, dona `montese_auth_bypass` (BYPASSRLS), com `GRANT SELECT ON tenants TO montese_auth_bypass`. Motivo: um tenant que existe mas é invisível ao papel atual por RLS não pode parecer inexistente. `EXECUTE` revogado de PUBLIC e concedido a `montese_app` e ao `current_user` que migra (a ação referencial roda como dono da tabela).
- `REVOKE TRUNCATE ON epi_movements, epi_lots FROM montese_app` (mesmo padrão de `0002_audit_log.sql` e `0068_esocial_events.sql`): TRUNCATE ignora RLS e o trigger. Testado com a role da aplicação (42501).
- **Alcance da imutabilidade**: protege contra bug da aplicação, NÃO contra credencial comprometida; o dono da tabela pode `DISABLE TRIGGER` ou conceder privilégios de volta.
- O erro 42501 vira 403 via `mapPgError`. Os testes `epi-ledger-schema` cobrem UPDATE/DELETE bloqueados, DELETE dentro de outro trigger bloqueado e cascade de tenant com 0 linhas restantes.

### 2.6 `employee_epi_deliveries` (alterações)
`signed_by_name` e `signed_at` passam a aceitar NULL; novas colunas `quantity` (> 0, NULL no legado) e `signature_status` (NOT NULL, padrão `legado`; valores `legado`, `pendente`, `assinada`, `recusada`, `expirada`, `presencial`, `estornada`). **Não há coluna `movement_id`**: o vínculo é só `epi_movements.delivery_id`.

### 2.7 RLS
`epi_lots` e `epi_movements`: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy com o padrão do módulo: papel `admin`, ou `tenant_id = app.tenant_id`, ou `tenant_id IN (assigned_tenant_ids_for_current_user())`. Testes de RLS com a role da aplicação em `epi-ledger-schema`.

## 3. Regras de negócio

Todas em `epi-stock.service.ts` salvo indicação. Roda na transação do `req.withTenantContext`; qualquer exceção desfaz tudo.

1. **Saldo nunca negativo.** Serviço: 409 "Estoque insuficiente" (e "Estoque insuficiente no lote"). Banco: CHECK `stock_balance >= 0`, `balance >= 0`, `balance_after >= 0`.
2. **Ordem das validações** em `applyMovement`: trava o EPI (404 se invisível) -> repetição idempotente -> direção e regras de campos -> estorno duplicado -> funcionário do mesmo tenant -> devolução -> estorno de entrega -> lote -> abertura -> CA/lote vencidos -> saldo.
3. **Abertura**: no máximo uma por EPI; em EPI com `controls_lot`, uma por lote. Recusada (409) se já existe qualquer movimentação para o EPI (ou para o lote). Só `empresa` e `admin` (controller, 403).
4. **Idempotência**: `idempotency_key` (8 a 100 caracteres) única por empresa. Repetição com a mesma operação devolve a movimentação original, HTTP 200, sem mexer no saldo. A comparação inclui: EPI, tipo, quantidade, direção (quando informada), movimentação estornada, funcionário, lote (resolvido por `lot_id` ou `lot_code`), fornecedor e motivo (com `trim`). Qualquer diferença: 409 "Chave de idempotência já usada em outra operação". A mesma chave pode existir em empresas diferentes.
5. **Estorno** (`reverse`): cria movimentação `estorno` de direção oposta, mesma quantidade, funcionário e lote da original, `reverses_movement_id` preenchido; a original permanece. Motivo obrigatório. Cada movimentação é estornada uma vez (409 "Movimentação já estornada"); estorno não pode ser estornado (409). Estornar uma entrega/troca marca a entrega vinculada como `signature_status = 'estornada'`.
   - **Estorno de entrega/troca com devolução**: se o saldo do funcionário neste EPI (entregue - devolvido, sem contar movimentações já estornadas) ficaria negativo, 409 "Estorne antes as devoluções deste funcionário neste EPI" (evita estoque fantasma). Estornar a devolução libera de novo a quantidade devolvível.
6. **Devolução limitada ao entregue**: quantidade <= (entregas + trocas - devoluções) do funcionário naquele EPI, ignorando movimentações estornadas; senão 409 "Devolução maior que a quantidade entregue ao funcionário". Entrega estornada não é devolvível.
7. **CA vencido bloqueia** entrega e troca (409 "CA vencido"); **lote vencido bloqueia** entrega e troca daquele lote (409 "Lote vencido"). Sem exceção autorizada nesta fase. Datas comparadas como `AAAA-MM-DD` com o dia do Brasil (`todayDateOnly`).
8. **EPI inativo** recusa abertura, entrada, entrega e troca (409 "EPI inativo"). Baixa, devolução, ajuste e estorno continuam possíveis.
9. **Lote opcional por EPI** (`controls_lot`): se o EPI controla lote, toda movimentação exige `lot_id` ou `lot_code` (400); em movimentação de entrada de saldo (direção +1) `lot_code` cria o lote se não existir; lote existente com outra validade informada: 409. Em EPI sem lote, informar lote é 400. `controls_lot` não pode ser alterado depois que há movimentações (409 no PATCH). Saldo do lote é mantido junto com o do EPI.
10. **Tipos e direção**: abertura, entrada, devolucao = +1; entrega, troca, baixa = -1; ajuste e estorno recebem a direção explícita.
11. **Troca = saída do EPI novo + devolução separada.** A movimentação `troca` é saída do EPI informado na rota e cria entrega pendente; a devolução do EPI antigo é uma movimentação `devolucao` própria, registrada pelo cliente.
12. **Entrega/troca** cria, na mesma transação e antes do movimento (callback `beforeInsert`, que só roda se não for repetição idempotente), uma linha em `employee_epi_deliveries` com `signature_status = 'pendente'`, `signed_by_name` e `signed_at` nulos e `quantity`; o movimento guarda `delivery_id`.
13. **Alertas e faixas de estoque** (`search`, `epi.service.ts`):
    - `stock_band`: `sem_estoque` (saldo 0); `abaixo` (saldo < `min_stock`); `acima` (saldo > `max_stock`); senão `otimo`.
    - `ca_alert`: `sem_validade`; `vencido` (CA antes de hoje); `a_vencer` (até hoje + `epi_alert_days`); senão `ok`. "Hoje" no fuso `America/Sao_Paulo`.
    - `lots_expired` e `lots_expiring`: contam só lotes com saldo > 0.
    - `stock_value` = saldo x custo unitário (custo nulo conta 0).
14. **Dias de aviso por empresa**: `tenants.epi_alert_days`, padrão 30, faixa 1-365. É um padrão operacional recomendado, **não** é prazo normativo.
15. **Exclusão de EPI**: `DELETE /epis/:id` converte qualquer violação de FK (23503) em 409 "Não é possível apagar um EPI com entregas registradas"; com movimentações a FK RESTRICT também dispara esse caminho (INFERIDO pelo código; sem teste dedicado). Para tirar de uso, inativar via PATCH.

## 4. API

Todas sob `/epis`, autenticadas (JWT). Guards globais: rate limit, JWT, status de assinatura, `RolesGuard`. Papel fora de `@Roles` recebe 403. O tenant nunca vem do corpo para decidir acesso: o EPI é lido sob RLS (outra empresa = 404). Corpos validados com `ValidationPipe` (`whitelist`; `forbidNonWhitelisted` onde indicado). Rotas literais (`search`, `movements`) são declaradas antes das rotas com `:id`.

| Método e caminho | Papéis | DTO | Resposta |
|---|---|---|---|
| `POST /epis` | empresa, tecnico, parceiro | `CreateEpiDto` | 201; 400 validação/estoque máx < mín; 409 identidade duplicada |
| `GET /epis` | qualquer autenticado (sem `@Roles`) | query `tenant_id` opcional | 200 array (inalterado) |
| `GET /epis/search` | empresa, tecnico, parceiro, admin | `SearchEpisQueryDto` (query); `tenant_id` opcional (subsistema 4) | 200 `{items,total,page,page_size}`; 400 parâmetro inválido/desconhecido/repetido, ou empresa com `tenant_id` de outra; técnico/parceiro com tenant invisível: 200 vazio |
| `PATCH /epis/:id` | empresa, tecnico, parceiro, admin | `UpdateEpiDto` | 200; 400; 404; 409 |
| `GET /epis/:id/lots` | empresa, tecnico, parceiro, admin | - | 200; 400 (UUID); 404 |
| `DELETE /epis/:id` | empresa, tecnico, parceiro, admin | - | 200; 404; 409 |
| `POST /epis/:id/deliveries` (legado) | empresa, tecnico, parceiro | `CreateEpiDeliveryDto` | contrato antigo, ver 4.3 |
| `GET /epis/:id/deliveries` | qualquer autenticado | - | 200 |
| `POST /epis/:id/movements` | empresa, tecnico, parceiro, admin (abertura: só empresa/admin) | `CreateEpiMovementDto` | 201 novo; 200 repetição idempotente; 400; 403; 404; 409 |
| `POST /epis/:id/adjustments` | empresa, admin | `CreateEpiAdjustmentDto` | 201/200; 400; 403; 404; 409 |
| `POST /epis/movements/:movementId/reversal` | empresa, admin | `ReverseEpiMovementDto` | 201/200; 400; 403; 404; 409 |
| `GET /epis/movements` | empresa, tecnico, parceiro, admin | `ListEpiMovementsQueryDto` (query); `tenant_id` opcional (subsistema 4) | 200 `{items,total,page,page_size}`, cada item com `reversed` (boolean, subsistema 4); 400; tenant invisível: 200 vazio |
| `GET /epis/dashboard` (subsistema 4) | empresa, tecnico, parceiro, admin | query `from`,`to`,`epi_id`,`employee_id`,`tenant_id` | 200 indicadores; 400; 404. Ver `epi-telas.md` |
| `GET /epis/settings`, `PATCH /epis/settings` (subsistema 4) | GET: os 4; PATCH: empresa, admin | `tenant_id`; corpo `{epi_alert_days}` 1-365 | 200; 400; 403; 404. Ver `epi-telas.md` |

### 4.1 DTOs (em `backend/src/epi/dto/`)
- `CreateEpiDto`: `epi_catalog_item_id` (UUID), `ca_number` (1-100), `ca_valid_until` (`AAAA-MM-DD`), `manufacturer`, `model` (<=120), `unit` (1-20), `min_stock`, `max_stock`, `unit_cost` (2 casas), `controls_lot`, `replacement_days` (>= 1), `tenant_id` (só lido para tecnico/parceiro; empresa usa o do token). Regras comuns em `epi-dto-rules.ts` (sem NUL, limites de INT e dinheiro, data estrita).
- `UpdateEpiDto`: campos editáveis `ca_number`, `ca_valid_until`, `manufacturer`, `model`, `unit`, `min_stock`, `max_stock`, `unit_cost`, `replacement_days`, `controls_lot`, `status`. Opcionais anuláveis aceitam `null` explícito para limpar; campos NOT NULL não aceitam `null`. `tenant_id`, `epi_catalog_item_id` e `stock_balance` não são aceitos (400, `forbidNonWhitelisted`): o saldo só muda por movimentação.
- `CreateEpiMovementDto`: `type` (`abertura|entrada|entrega|devolucao|troca|baixa`), `quantity` (1-100000), `employee_id`, `supplier` (<=200), `lot_id`, `lot_code` (<=60), `lot_valid_until` (só `AAAA-MM-DD`, data real), `reason` (<=500), `occurred_at` (`AAAA-MM-DD` ou `AAAA-MM-DDThh:mm[:ss[.fff]][Z|±hh:mm]`, ISO estrito, offset até ±15:59, ano != 0000; texto livre sem NUL), `idempotency_key` (8-100). `ajuste` e `estorno` só entram pelas rotas próprias.
- `CreateEpiAdjustmentDto`: `direction` (`mais|menos`), `quantity`, `reason` (5-500), `lot_id`, `idempotency_key`.
- `ReverseEpiMovementDto`: `reason` (5-500), `idempotency_key` (8-100).
- `ListEpiMovementsQueryDto`: `tenant_epi_id`, `employee_id` (UUID), `type`, `from`, `to` (data ou data-hora ISO restrita), `page` (1-10000, padrão 1), `page_size` (1-100, padrão 25). Ordenação: `occurred_at DESC, created_at DESC`.
- `SearchEpisQueryDto`: `q` (<=100, curingas escapados; busca em descrição do catálogo, CA e fabricante), `status`, `category` (A-I), `stock_band` (`sem_estoque|abaixo|otimo|acima`), `ca_alert` (`vencido|a_vencer|ok|sem_validade`), `page`, `page_size` (mesmos limites). Ordenação por descrição, CA, id.

### 4.2 Códigos de resposta (VERIFICADO no código)
- 200: leitura, PATCH, repetição idempotente. 201: movimento novo.
- 400: validação de DTO, UUID inválido, funcionário/fornecedor/motivo ausente, lote ausente ou em EPI sem lote, estoque máx < mín.
- 403: papel sem permissão (`RolesGuard`), abertura por tecnico/parceiro, erro 42501 do banco.
- 404: EPI, movimentação, lote ou funcionário inexistente ou de outra empresa (RLS).
- 409: saldo insuficiente, abertura duplicada, devolução acima do entregue, CA/lote vencido, EPI inativo, estorno duplicado/de estorno/de entrega com devolução, idempotência conflitante, identidade de EPI duplicada, lote com outra validade, `controls_lot` com histórico.

### 4.3 Rota legada `POST /epis/:id/deliveries`
**Atualização (subsistema 4):** passou a responder **409** para EPI inativo, CA vencido e EPI com qualquer movimentação no livro (VERIFICADO em `epi.service.ts`); detalhes em `epi-telas.md` seção 4.4. Para EPI sem livro, ativo e com CA válido, o comportamento é o abaixo: grava em `employee_epi_deliveries` com `signed_by_name` e `delivered_at` do corpo (`signature_status` fica `legado`) e **não movimenta estoque**, não gera movimentação nem exige saldo. Deve ser migrada no frontend para `POST /epis/:id/movements` (tipo `entrega`). Ver seção 8.

## 5. Papéis

| Ação | empresa | tecnico | parceiro | admin |
|---|---|---|---|---|
| Cadastrar/editar EPI, listar, ver lotes | sim | sim (vinculado) | sim (vinculado) | editar/listar sim; `POST /epis` não |
| Entrada, entrega, devolução, troca, baixa | sim | sim | sim | sim |
| **Abertura** | sim | não (403) | não (403) | sim |
| **Ajuste** | sim | não (403) | não (403) | sim |
| **Estorno** | sim | não (403) | não (403) | sim |

"Dono da conta" da spec = papel `empresa` (mais `admin`). Não há distinção de usuário-dono dentro da empresa (VERIFICADO: o código só checa o papel). Técnico/parceiro enxergam apenas empresas vinculadas, via RLS (`assigned_tenant_ids_for_current_user()`); sem vínculo, 404. O tenant da movimentação vem da linha do EPI, nunca do corpo.

## 6. Auditoria

- `AuditInterceptor` global (`APP_INTERCEPTOR`) registra toda rota mutante (POST/PATCH/PUT/DELETE, exceto `/auth`) com ator, papel, tenant do ator, método, caminho, status e IP. Para `POST /epis/:id/movements` a ação gravada é a sub-rota (`movements`); para `POST /epis/movements/:movementId/reversal` é `reversal`; PATCH usa `update`. Sem corpo da requisição nem CPF.
- Além disso, cada movimento grava o autor em `epi_movements.created_by_user_id` (NOT NULL), mais `reason` e, em `tenant_epis`, `updated_by_user_id`. Teste: "ajuste manual ... fica registrado com autor".
- NÃO VERIFICADO: o conteúdo exato das linhas de auditoria no banco para essas rotas (não há teste dedicado).

## 7. Testes

Specs novos (todos em `backend/test/`, e2e contra banco real; usam `TestDb`, que exige `TEST_SUPERUSER_DATABASE_URL`):

| Arquivo | O que prova |
|---|---|
| `epi-ledger-schema.e2e-spec.ts` | CHECKs (quantidade, saldo), trigger de imutabilidade (UPDATE/DELETE), unicidade da chave de idempotência, motivo/origem obrigatórios, unicidade da identidade do EPI, regras de estorno único, cascade de tenant, RLS com a role da aplicação |
| `epi-stock-movements.e2e-spec.ts` | abertura única (por lote), entrada/baixa, saldo insuficiente, idempotência (inclui comparação de funcionário/fornecedor/EPI), lote e lote vencido, entrega cria entrega pendente, estorno e marcação `estornada`, devolução limitada ao entregue, parciais, estorno de entrega com devolução, CA vencido, ajuste, validação de UUID e queries, saldo = soma das movimentações |
| `epi-stock-concurrency.e2e-spec.ts` | 10 entregas simultâneas sobre saldo 5 (5 passam), 10 requisições idênticas = 1 movimentação, devoluções simultâneas limitadas ao entregue |
| `epi-stock-permissions.e2e-spec.ts` | tecnico/parceiro: 403 em abertura/ajuste/estorno e 201 em entrada/baixa; isolamento entre empresas (404); chave igual em empresas distintas; autor gravado; admin ajusta e estorna |
| `epi-search-update.e2e-spec.ts` | PATCH (campos, null, 400, 409, permissões), `search` (paginação, faixas, alerta de CA, curingas, isolamento, parâmetros inválidos), `epi_alert_days`, lotes, rotas literais não engolidas por `:id` |
| `epi-input-hardening.e2e-spec.ts` | 400 para `lot_valid_until`/`occurred_at`/NUL nas rotas de movimento, ajuste e estorno; offset de `from` fora do limite; devolução não cria lote; ParseUUID em delete/deliveries; teto de saldo (409) |
| `epi-create-validation.e2e-spec.ts` | entradas inválidas em `POST /epis` retornam 400; POST válido segue 201 e `GET /epis` devolve array |

Também alterado: `positions-divergence.e2e-spec.ts` (acompanha o filtro `signature_status <> 'estornada'` em `positions.service.ts`: entrega estornada deixa de contar como EPI entregue). Testes existentes a manter verdes: `epis-crud`, `epi-deliveries`, `epi-catalog-rls`, `caepi`, `epi-by-function`.

### Como rodar (somente ensaio descartável)
- **Nunca contra produção.** Os e2e criam e apagam dados reais no banco apontado. O script `run-backend-tests.sh` carrega o `.env` do diretório pai e aponta para o ambiente principal: não usar para e2e. Use o ensaio isolado (Postgres+Redis descartáveis em rede própria, migrations aplicadas por `psql` em ordem incluindo a 0081, chaves falsas), conforme a memória do projeto `reference_ensaio_descartavel_isolado`. Scripts do ensaio não estão no repositório.
- Jest com `--config ./test/jest-e2e.json --runInBand --forceExit`, imagem glibc (`node:20-bookworm-slim`), `NODE_ENV=test`, `TEST_SUPERUSER_DATABASE_URL` apontando para o banco do ensaio.
- **A suíte e2e completa estoura memória num único processo: rodar em lotes** (um ou poucos arquivos por execução), por exemplo os 6 specs acima e os 5 existentes de EPI em lotes separados.
- Unit: `npm run test:unit` não precisa de banco de e2e.
- NÃO VERIFICADO por quem escreveu este documento: qualquer resultado de execução (ver nota no topo).

## 8. Limitações conhecidas e decisões pendentes do proprietário

1. **Rota legada `POST /epis/:id/deliveries` não mexe no estoque** até o frontend migrar para `/movements`. Enquanto isso, entregas feitas por ela não baixam saldo.
2. **EPIs existentes começam com saldo 0 e sem abertura.** É preciso registrar a abertura (empresa/admin) para o saldo inicial.
3. **Entregas legadas não geram movimentação** e não podem ser devolvidas pelo livro (devolução é limitada ao entregue registrado no livro).
4. ~~`GET /epis/search` não filtra por empresa~~ **Atualizado (subsistema 4):** aceita `tenant_id` opcional (e `GET /epis/movements` também). Sem o parâmetro, técnico/parceiro ainda recebem todas as empresas vinculadas pela RLS; as telas novas sempre enviam o `tenant_id` na rota do técnico. Ver `epi-telas.md` seção 4.2.
5. **"Dono da conta" = papel `empresa`** (mais `admin`); não existe usuário-dono distinto. Confirmar com o proprietário.
6. **CA vencido bloqueia entrega/troca sem exceção** (sem permissão especial nem justificativa). Decisão pendente se haverá exceção.
7. Assinatura, ficha, PDF e dashboard ficam para os subsistemas 2 a 4; nesta entrega nada altera `pendente` para `assinada`/`recusada`/`expirada`/`presencial` (não há código para isso), só o estorno marca `estornada`.
8. ~~`tenants.epi_alert_days` não tem rota de edição.~~ **Atualizado:** `PATCH /epis/settings` (ver `epi-telas.md`).
9. `DELETE /epis/:id` de EPI com movimentações responde 409 com a mensagem "...com entregas registradas", que não menciona movimentações (INFERIDO; NÃO VERIFICADO em teste). RECOMENDADO ajustar a mensagem e orientar a inativar.
10. Listagem de movimentações não restringe por empresa além da RLS; sem filtros devolve tudo que o papel enxerga, paginado.
11. **Lote novo só em `entrada`/`abertura`**: nos demais tipos `lot_code`/`lot_valid_until` dão 400 e em EPI com lote exige-se `lot_id` existente (404 se não existir). Saldo acima de 2147483647 (EPI ou lote) -> 409 "Saldo máximo excedido".

Pendências ROTULADAS, NÃO implementadas (decisão do proprietário):
- **I3 (resolvida no subsistema 4: a rota legada agora recusa EPI inativo, CA vencido e EPI com livro; ver `epi-telas.md`)**: a rota legada `POST /epis/:id/deliveries` ignora CA vencido e EPI inativo. Decidir: aplicar as mesmas checagens OU recusá-la quando o EPI já tem movimentação no livro; antes do frontend publicar o fluxo novo.
- **M2 (pendente)**: apagar funcionário com movimentações no livro esbarra em RESTRICT, e a resposta de `employees.service.ts` usa a mensagem genérica de CIPA. Funcionário com entrega no livro não pode ser apagado (retenção da ficha; decisão LGPD do proprietário); mensagem a corrigir depois.
- **delivered_at (pendente)**: usa `now()::date` no fuso do banco; corrigir para America/Sao_Paulo antes do subsistema 2, que usa `delivered_at` na ficha.
- **Devolução (pendente)**: o limite é por EPI e não por lote.

## 9. Ordem de release e riscos

Ordem RECOMENDADA:
1. **Antes de tudo, em produção e somente leitura (pelo proprietário)**, rodar a consulta de duplicidade do cabeçalho da migration 0081. A migration falha, e nada é aplicado, se houver EPIs duplicados (mesma empresa, catálogo, CA, fabricante e modelo):
   ```sql
   SELECT tenant_id, epi_catalog_item_id, ca_number, count(*) FROM tenant_epis
   GROUP BY 1,2,3 HAVING count(*) > 1;
   ```
   (a consulta é por tenant, catálogo e CA; fabricante/modelo nascem nulos nas linhas existentes, então duplicatas nessas três colunas são as que bloqueiam o índice). Se retornar linhas, resolver antes.
2. **Fazer backup** antes de aplicar.
3. **Numeração**: o arquivo é `0081`; confirmar frente à `0080` da branch `feat/tabela-oficial-funcionarios` (ainda não mesclada) e renumerar se necessário no momento do merge. A 0079 está em produção.
4. Aplicar a migration, depois o backend. Backend novo sem migration quebra (colunas inexistentes); migration sem backend novo é inofensiva (aditiva), mas a coluna `signature_status` passa a valer `legado` nas entregas existentes.
5. Migrar o frontend da entrega para `/movements` e só então registrar aberturas.

Riscos:
- A migration roda como `montese_app` e usa o papel `montese_auth_bypass` (`GRANT SELECT ON tenants`, `ALTER FUNCTION ... OWNER TO`): **VERIFICADO no ensaio; NÃO VERIFICADO em produção** (depende dos papéis e privilégios reais, conferir antes).
- Colisão de numeração (item 3).
- `DROP NOT NULL` em `signed_by_name`/`signed_at` afrouxa o contrato antigo: consumidores que assumem assinatura preenchida devem tratar entregas `pendente`. O filtro em `positions.service.ts` já exclui apenas `estornada`; entregas `pendente` ainda contam como entregues (decisão a confirmar).
- Backfill: nenhum (ver seção 8.2 e 8.3).

## 10. ROLLBACK

Arquivo de origem: scratchpad da sessão (`0081.down.sql`). Foi testado: aplicado sobre o schema pós-0081 em banco descartável, o schema voltou idêntico ao pré-0081. Recusa executar se já houver movimentações ou entregas pendentes (não destrói histórico). NÃO VERIFICADO em produção. Fazer backup antes.

```sql
-- Rollback manual da 0081 (EPI: livro de movimentações). Só use se NENHUM movimento/entrega nova existir:
-- ele recusa executar se houver dados criados pelo novo fluxo (para não destruir histórico).
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM epi_movements) THEN
    RAISE EXCEPTION 'rollback recusado: existem movimentações em epi_movements';
  END IF;
  IF EXISTS (SELECT 1 FROM employee_epi_deliveries WHERE signed_by_name IS NULL OR signed_at IS NULL) THEN
    RAISE EXCEPTION 'rollback recusado: existem entregas pendentes (sem assinatura) criadas pelo novo fluxo';
  END IF;
END $$;
DROP TABLE epi_movements;
DROP TABLE epi_lots;
DROP FUNCTION epi_movements_immutable();
DROP FUNCTION epi_tenant_row_exists(UUID);
ALTER TABLE employee_epi_deliveries
  DROP COLUMN signature_status,
  DROP COLUMN quantity,
  ALTER COLUMN signed_by_name SET NOT NULL,
  ALTER COLUMN signed_at SET NOT NULL;
DROP INDEX uq_tenant_epis_identity;
ALTER TABLE tenant_epis
  DROP CONSTRAINT chk_tenant_epis_stock_range,
  DROP COLUMN manufacturer, DROP COLUMN model, DROP COLUMN unit, DROP COLUMN min_stock,
  DROP COLUMN max_stock, DROP COLUMN unit_cost, DROP COLUMN controls_lot, DROP COLUMN replacement_days,
  DROP COLUMN status, DROP COLUMN stock_balance, DROP COLUMN updated_by_user_id;
ALTER TABLE tenants DROP COLUMN epi_alert_days;
DELETE FROM _migrations WHERE name = '0081_epi_stock_ledger.sql';
COMMIT;
```

Observações: se a numeração for alterada no merge, ajustar o `name` no último `DELETE`. O rollback só vale enquanto não houver movimentos; depois disso, a correção é por estorno, não por rollback.
