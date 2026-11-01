# Módulo EPI — Subsistema 3: assinatura eletrônica mobile de recebimento

Status: **implementado e testado no ensaio descartável; não commitado** (worktree `/opt/montese-epi`, branch `feat/epi-estoque`, sem commits). Nada em produção.

Rótulos: VERIFICADO (conferido no código, na migration ou em teste existente), NÃO VERIFICADO, RECOMENDADO.
Observação sobre "testes passaram": os resultados de execução citados vêm dos relatórios das tarefas (`.superpowers/sdd/2026-10-15-epi-assinatura-eletronica/task-{1..5}-report.md`) e do ledger `progress.md`; a redação deste documento **não reexecutou** os testes (NÃO VERIFICADO por quem escreveu; VERIFICADO no código dos testes). A regressão completa final (Task 6) não tem resultado registrado nas fontes lidas.

Fontes: `backend/db/migrations/0083_epi_signatures.sql`, `backend/src/epi-signature/*`, `backend/src/app-setup.ts`, `backend/src/epi-ficha/*` (anexo de comprovantes), `backend/src/common/pdf/safe-png.util.ts`, `frontend/src/app/assinar/*`, `frontend/src/components/epi/SignaturePad.tsx`, `frontend/src/lib/epi-signature-api.ts`, os testes citados na seção 13 e a spec `docs/superpowers/specs/2026-10-15-epi-assinatura-eletronica-design.md` (com a seção "Decisões e desvios da implementação"). Complementa `epi-estoque.md` (subsistema 1) e `epi-ficha.md` (subsistema 2).

## 1. Visão geral e escopo

O módulo EPI tem 4 subsistemas. Este documento cobre o **subsistema 3**: o responsável (empresa, técnico, parceiro ou admin) gera um **link de uso único** para as entregas pendentes de um funcionário; o funcionário abre o link no próprio celular, digita um **código de 6 dígitos**, confere os itens e o termo, marca o **aceite**, **desenha a assinatura** (ou recusa) e recebe o código do comprovante. O banco grava uma **evidência imutável** e marca as entregas como `assinada` (ou `recusada`). O responsável baixa o **comprovante em PDF** (gerado sob demanda) e a **ficha emitida** (subsistema 2) passa a mostrar o código do comprovante e, na emissão, um anexo com as imagens.

**Não existem** (VERIFICADO: não há código para eles):
- **telas do responsável**: não existiam no subsistema 3 (o backend devolve `url`, `qr_payload` e `code`). **Atualização:** a interface do responsável (diálogo com QR, link e código, presencial, revogação, pendências) foi implementada no subsistema 4; ver `epi-telas.md` seção 7;
- **dashboard/menu EPI**: ver `epi-telas.md` (subsistema 4);
- **envio do link por e-mail, WhatsApp ou SMS** (o funcionário não tem contato cadastrado; `employees` não tem telefone nem e-mail);
- **página pública de verificação de documento** (a verificação da ficha é autenticada; a evidência é recalculável só por quem tem acesso ao banco);
- **certificação ICP-Brasil** ou provedor de assinatura (ver seção 17).

Arquitetura (VERIFICADO): as rotas públicas não têm contexto de empresa (não há usuário). Todo acesso a dados passa por funções SQL `SECURITY DEFINER` (`epi_sig_*`), de dono `montese_auth_bypass` (BYPASSRLS), no padrão `auth_*` da migration 0058. O banco confere token e código a cada chamada; não há sessão entre as chamadas. As rotas autenticadas usam `req.withTenantContext` (RLS) como no restante do módulo.

## 2. Fluxo ponta a ponta

1. **Criar o link** — `POST /epi-signatures/requests` (autenticado). O serviço trava o funcionário, escolhe as entregas elegíveis (`pendente` ou `recusada`, com quantidade), revoga links ativos que as contenham e cria a requisição (24 h).
2. **Mostrar link/QR e código uma vez** — a resposta traz `url` (`<PUBLIC_APP_URL>/assinar#token=<token>`), `qr_payload` (igual à `url`), `code` (6 dígitos) e `expires_at`, com `Cache-Control: no-store`. O código em claro não é recuperável depois: perdido, revoga-se e gera-se outro link. (A tela que exibe isto é do subsistema 4.)
3. **Página `/assinar#token=...`** — o navegador lê o token do fragmento, remove o fragmento da URL (`history.replaceState`) e chama `POST /api/epi-signatures/public/peek`. Link inexistente/expirado/usado/revogado: mensagem única. Link utilizável: mostra só o nome da empresa e pede o código.
4. **Código** — `POST .../open` com token e código. Errado: 401 com `attempts_left`; na 5ª tentativa errada o link é bloqueado (403). Certo: devolve nome do funcionário (sem CPF), itens, validade e o texto do termo.
5. **Conferir** — a página mostra itens (data, descrição, fabricante/modelo, CA, quantidade) e o termo (com selo RASCUNHO enquanto o termo for rascunho).
6. **Aceite** — caixa de aceite explícita; o botão Assinar só habilita com aceite e traço desenhado.
7. **Assinar ou recusar** — `POST .../sign` (PNG em base64, `term_version`, `accepted: true`) ou `POST .../refuse` (motivo opcional, com confirmação na página).
8. **Comprovante** — a resposta do `sign` traz `receipt_code` (`ASEPI-AAAAMMDD-XXXXXXXX`), `signed_at` e `evidence_sha256`; a página mostra o código e a hora de Brasília e manda guardar o código.
9. **Ficha** — as entregas ficam `assinada` (`signed_at`, `signed_by_name` = nome do funcionário). `GET /epi-fichas/employees/:id` passa a trazer `receipt_code`/`signed_at` nas linhas e a lista `signatures`; a emissão da ficha inclui o anexo "Comprovantes de assinatura" com as imagens (seção 11). O responsável baixa o comprovante em `GET /epi-signatures/:id/receipt.pdf`, onde `:id` é o id de `epi_signatures`.

Alternativa **presencial** (funcionário sem celular): `POST /epi-signatures/in-person` (seção 7.3).

## 3. Modelo de dados (migration 0083)

A migration é aditiva (VERIFICADO no arquivo). Depende da 0081 (`epi_tenant_row_exists`, role `montese_app`) e da 0058 (padrão `auth_*`, role `montese_auth_bypass`). `pgcrypto` (`digest`, `gen_random_bytes`) já existe no schema `public` desde a 0001 (VERIFICADO no ensaio; em produção NÃO VERIFICADO).

### 3.1 `epi_signature_requests`
`id` UUID PK; `tenant_id` (FK `tenants` ON DELETE CASCADE); `employee_id` (FK `employees` **ON DELETE RESTRICT**); `token_hash` TEXT UNIQUE, `pin_hash` TEXT (ambos CHECK `^[0-9a-f]{64}$`); `status` CHECK em `ativa, assinada, recusada, expirada, revogada, bloqueada` (padrão `ativa`); `attempts` INT CHECK 0..5; `expires_at`; `term_version`; `term_text_sha256` (CHECK hex 64); `refusal_reason` (nulo ou até 300); `created_by_user_id` (FK `users`); `created_at`; `used_at`; `idempotency_key` TEXT; `UNIQUE (tenant_id, idempotency_key)`. Índice `idx_epi_sig_requests_employee (employee_id, created_at DESC)`.

### 3.2 `epi_signature_request_items`
PK `(request_id, delivery_id)`; `request_id` FK ON DELETE CASCADE; `delivery_id` FK `employee_epi_deliveries` **DEFERRABLE INITIALLY DEFERRED** (NO ACTION adiada, não RESTRICT: protege a entrega contra DELETE direto, mas deixa o cascade de um tenant removido funcionar, porque a ordem dos cascades é indefinida; provado no ensaio, relatório da Task 1, item e). Índice por `delivery_id`.

### 3.3 `epi_signatures` (a evidência)
`id`; `tenant_id` (CASCADE); `request_id` **UNIQUE** (FK RESTRICT); `employee_id` (RESTRICT); `signed_at`; `accepted` CHECK verdadeiro; `term_version`; `term_text_sha256` (CHECK hex 64); `items_snapshot` JSONB; `signature_file_key`; `signature_sha256` (CHECK hex 64); `ip` (CHECK até 64); `user_agent` (CHECK até 300); `code_verified` CHECK verdadeiro; `evidence_payload` JSONB; `evidence_sha256` (CHECK hex 64); `receipt_code`; `UNIQUE (tenant_id, receipt_code)`. Índice `(employee_id, signed_at DESC)`. **Não existe `accepted_at`** (a spec previa): `signed_at` é o instante do aceite e da assinatura.

### 3.4 Assinatura presencial (2 tabelas)
- `epi_in_person_signatures`: `id`, `tenant_id` (CASCADE), `employee_id` (RESTRICT), `witness_name` (CHECK `length(btrim) BETWEEN 3 AND 120`), `reason` (CHECK 5..300), `registered_by_user_id` (FK `users`), **`term_version` TEXT NOT NULL** (versão do termo vigente no registro), `registered_at`.
- `epi_in_person_signature_items`: `(in_person_id, delivery_id)` PK, `in_person_id` CASCADE, `delivery_id` DEFERRABLE INITIALLY DEFERRED, **`UNIQUE (delivery_id)`** (uma entrega só é registrada como presencial uma vez).
- Imutáveis (UPDATE/DELETE diretos -> 42501; a cascata de um tenant removido continua permitida). `GRANT SELECT, INSERT ... TO montese_app`; `REVOKE TRUNCATE`.

### 3.5 Triggers de imutabilidade e guards
- `trg_epi_signatures_immutable` (BEFORE UPDATE OR DELETE): erro `42501` "epi_signatures é imutável"; exceção só para a cascata de tenant removido (`pg_trigger_depth() > 1 AND NOT epi_tenant_row_exists`). Mesmo padrão da 0081/0082.
- `trg_epi_signatures_insert_guard` (BEFORE INSERT): recusa com `42501` qualquer INSERT cujo `current_user` não seja `montese_auth_bypass` e não seja superusuário. Motivo: `montese_app` **herda** os privilégios de tabela de `montese_auth_bypass`, então só a ACL não impede um INSERT direto da aplicação (provado no ensaio: o INSERT passou até o 23505 de unicidade). Dentro de `epi_sig_sign` o `current_user` é o dono da função.
- `trg_epi_sig_items_guard` (função `epi_sig_items_guard`, SECURITY DEFINER, dono `montese_auth_bypass`, sem EXECUTE para `montese_app`): em INSERT/UPDATE, a entrega precisa ser do **mesmo tenant e funcionário** da requisição, estar `pendente`, e a requisição precisa estar `ativa` (erro `23514`, mensagem sem dado pessoal). Em UPDATE/DELETE com requisição **não ativa**: `42501` (itens de requisição encerrada são imutáveis). Cascata de tenant removido e de requisição removida continuam permitidas.
- `epi_in_person_immutable` nas duas tabelas presenciais (seção 3.4).
- Guards do presencial: `trg_epi_in_person_items_guard` (BEFORE INSERT no item: a entrega deve ser do **mesmo tenant e funcionário** do registro, `23514`); `trg_epi_in_person_items_final` e `trg_epi_in_person_final` (CONSTRAINT TRIGGER **deferidos**, conferidos no COMMIT): a entrega do item deve terminar `presencial` e o registro não pode ficar sem itens. Por isso `registerInPerson` grava registro e itens ANTES do UPDATE das entregas.

### 3.7 Garantias de estado por trigger (onda final) e seus limites
- `trg_epi_deliveries_signature_guard` (BEFORE UPDATE OF `signature_status` em `employee_epi_deliveries`): (a) `assinada` só por quem tem `current_user = montese_auth_bypass` (as funções `epi_sig_*`) ou superusuário (fixtures de teste), senão `42501`; (b) quem está `assinada` ou `presencial` só pode ir para `estornada` (o estorno do livro) — qualquer outra saída é `42501`; (c) `presencial` exige linha em `epi_in_person_signature_items` para a entrega (`23514`). Não bloqueia: criação (`recusada` -> `pendente`), `epi_sig_refuse` (`pendente` -> `recusada`), estorno, fluxo `legado`.
- `trg_epi_signature_requests_guard` (BEFORE UPDATE OR DELETE em `epi_signature_requests`): `token_hash`, `pin_hash`, `tenant_id`, `employee_id`, `term_version`, `term_text_sha256`, `created_by_user_id` e `idempotency_key` são imutáveis; `attempts` só cresce; o status só sai de `ativa`; para quem NÃO é `montese_auth_bypass`/superusuário a única mudança permitida é `ativa` -> `revogada` (nem `attempts`, `used_at`, `refusal_reason` nem `expires_at` mudam); DELETE direto é `42501` (a recusa/assinatura não pode ser apagada), exceto a cascata de um tenant já removido (`pg_trigger_depth() > 1 AND NOT epi_tenant_row_exists`). Não se usou `REVOKE DELETE`.
- **O que isso NÃO é:** proteção contra BUG e contra a aplicação comum, **não contra credencial comprometida**. `montese_app` é a DONA das tabelas (é ela quem migra): com a credencial pode `ALTER TABLE ... DISABLE TRIGGER`, `DROP POLICY` ou `DROP TRIGGER`. RECOMENDADO (fora do escopo desta migration): separar a role que migra/é dona das tabelas da role de runtime da aplicação, que ficaria só com DML.

### 3.6 RLS, grants e TRUNCATE
- `ENABLE` + `FORCE ROW LEVEL SECURITY` nas 5 tabelas. Policies: `epi_sig_requests_isolation`, `epi_signatures_isolation` e `epi_in_person_isolation` (papel `admin`, ou `tenant_id` = `app.tenant_id`, ou `tenant_id IN assigned_tenant_ids_for_current_user()`); `epi_sig_items_isolation` e `epi_in_person_items_isolation` herdam por `EXISTS` na tabela-mãe.
- `REVOKE TRUNCATE ... FROM montese_app` nas 5 tabelas (VERIFICADO no arquivo e em teste).
- `REVOKE INSERT, UPDATE ON epi_signatures FROM montese_app` (DELETE fica para a cascata do tenant). Sozinho não basta (ver guard de INSERT acima; UPDATE é coberto pelo trigger de imutabilidade).
- **GRANTs mínimos por coluna para `montese_auth_bypass`** (BYPASSRLS não concede privilégio de tabela): `SELECT` em requisições e itens; `UPDATE (status, attempts, used_at, refusal_reason)` em requisições; `SELECT, INSERT` em `epi_signatures`; `SELECT` em `employee_epi_deliveries` e `UPDATE (signature_status, signed_at, signed_by_name)`; `SELECT (id, full_name)` em `employees` (**sem CPF**); `SELECT` em `tenants`, `tenant_epis`, `epi_catalog_items`.
- A migration não faz `GRANT` explícito das 3 tabelas eletrônicas a `montese_app`: a concessão vem dos privilégios padrão do schema (INFERIDO a partir do relatório da Task 1; o ensaio tem `ALTER DEFAULT PRIVILEGES`; em produção NÃO VERIFICADO).

## 4. Funções SQL

Todas `SECURITY DEFINER`, `SET search_path = public, pg_temp`, dono `montese_auth_bypass`, `REVOKE ALL ... FROM PUBLIC` (VERIFICADO no arquivo).

| Função | Executável por `montese_app` | O que faz | Resultado |
|---|---|---|---|
| `epi_sig_peek(token_hash)` | sim (GRANT) | trava a requisição (`FOR UPDATE`); se `ativa` e vencida, grava `expirada`; | `usable`, `company_name` (só o nome da empresa, e só se utilizável) |
| `epi_sig_open(token_hash, pin_hash)` | sim | chama `epi_sig_check`; se ok, devolve nome do funcionário, validade, `term_version`, itens | `result`, `attempts_left`, `request_id`, `tenant_id`, `employee_name`, `expires_at`, `term_version`, `items` |
| `epi_sig_sign(token_hash, pin_hash, accepted, signature_key, signature_sha256, ip, user_agent)` | sim | confere; exige aceite; trava as entregas e confere que todas estão pendentes; gera `receipt_code`; monta e hasheia a evidência; insere em `epi_signatures`; marca entregas `assinada`; marca a requisição `assinada` | `result`, `signature_id`, `receipt_code`, `signed_at`, `evidence_sha256` |
| `epi_sig_refuse(token_hash, pin_hash, reason)` | sim | confere; entregas pendentes viram `recusada`; requisição vira `recusada` (`used_at`, `refusal_reason` até 300) | `result` |
| `epi_sig_check(token_hash, pin_hash)` | **não** (interna) | trava a requisição; expira se vencida; `bloqueada` -> `locked`; `attempts >= 5` -> grava `bloqueada` e `locked`; código ausente ou diferente conta tentativa (`wrong_code`, ou `locked` na 5ª); token NULL -> `invalid` | `result`, `attempts_left`, `req_id` |
| `epi_sig_items(request_id)` | **não** (interna) | itens no formato exibido e gravado na evidência (VOLATILE; filtra tenant e funcionário) | JSONB |
| `epi_sig_items_guard()` | **não** (função do trigger) | seção 3.5 | trigger |

`result` ∈ {`ok`, `invalid`, `locked`, `wrong_code`, `conflict`, `not_accepted`}. `invalid` não distingue inexistente, expirado, usado ou revogado. Ordem de travas (VERIFICADO): **requisição primeiro, entregas depois**; a criação no serviço Nest segue a mesma ordem (funcionário -> requisições -> entregas) para evitar deadlock `40P01`.

As 4 públicas têm `GRANT EXECUTE ... TO montese_app`; nas internas há `REVOKE ALL ... FROM montese_app` explícito (os privilégios padrão do ensaio davam EXECUTE a toda função nova).

### 4.1 LIMITAÇÃO herdada da arquitetura `auth_*` (não é da 0083)
`montese_app` é membro **com herança** de `montese_auth_bypass` (BYPASSRLS). Consequências (VERIFICADO no ensaio, relatório da Task 1):
- `has_function_privilege('montese_app','epi_sig_check(text,text)','EXECUTE')` é **true** por herança, apesar do `REVOKE` explícito: as internas continuam alcançáveis por quem rodar SQL como `montese_app`;
- `SET ROLE montese_auth_bypass` funciona e enxerga todos os tenants: **contorna a RLS e também os guards desta migration** (o guard de INSERT passa a ver `current_user = montese_auth_bypass`);
- as policies aceitam `app.role = 'admin'` via `set_config`.

Ou seja: quem conseguir executar SQL arbitrário com a role da aplicação (por exemplo, por injeção de SQL) não é contido pela RLS nem pelos guards. Os guards protegem contra **erro de programação** e contra o uso normal da aplicação, não contra esse atacante. O teste de ACL do ensaio por isso verifica a ACL (sem concessão direta nas internas, concessão nas 4 públicas) e não um 42501.

**RECOMENDADO (estrutural, decisão do proprietário, fora desta entrega):** separar a role de migração da role de execução da aplicação e conceder a pertença com `GRANT montese_auth_bypass TO ... WITH INHERIT FALSE` (PostgreSQL 16+), de modo que a aplicação só alcance as funções públicas por `EXECUTE` e não herde BYPASSRLS nem privilégios de tabela. Isso muda papéis de banco (infraestrutura) e toca todo o padrão `auth_*`; exige o `montese-banco-rls` e autorização.

## 5. Segredos

- **Token**: `randomBytes(32)` em base64url (43 caracteres, 256 bits). Só o `SHA-256` hex vai ao banco (`token_hash`). Em claro existe apenas na resposta de criação e no link entregue ao funcionário.
- **Código**: `randomInt(0, 1_000_000)` com zeros à esquerda (6 dígitos). O banco guarda `pin_hash = HMAC-SHA256(chave = token, mensagem = código)`: não há segredo de servidor, e o código não é quebrável offline sem o token (que só existe em hash).
- **Mostrados uma vez**: a resposta de criação (`no-store`) é a única que traz token e código. Repetir a `idempotency_key` devolve 409 (o código não é recuperável).
- **Força bruta**: o atacante precisa do token (256 bits) **e** acertar o código. Com o token, a chance por link é `5 / 1.000.000 = 5e-6`, porque o bloqueio é **persistente no banco** em 5 tentativas erradas (`attempts` CHECK até 5; concorrência provada: 8 tentativas erradas simultâneas terminam em `attempts = 5`, `bloqueada`, sem violar o CHECK). Quem tem o token pode também bloquear o link de propósito (efeito colateral aceito; INFERIDO).
- Nada registra token, código, base64 da imagem ou CPF em log (e2e `epi-signature-public` "nenhuma resposta ou log contém o token, o código, o base64...", fluxos feliz e de erro; usa o logger padrão, não o `JsonLoggerService`).
- A resposta ao link inexistente, expirado, usado ou revogado é uma mensagem única: `Link inválido ou expirado` (404). Link **bloqueado** responde 403 (distinguível de propósito; só quem tem o token vê).

## 6. Evidência

`epi_sig_sign` monta `evidence_payload` (JSONB) com: `request_id`, `tenant_id`, `employee_id`, `receipt_code`, `signed_at` (UTC, microssegundos, sufixo `Z`), `accepted` (true), `term_version`, `term_text_sha256`, `items` (data, descrição, fabricante, modelo, CA, quantidade e `delivery_id` de cada entrega), `signature_sha256`, `ip` (até 64), `user_agent` (até 300), `code_verified` (true). **Sem CPF** (nem formatado; teste dedicado).

`evidence_sha256` = SHA-256 hex de `evidence_payload::text`, **calculado no banco** com `digest(v_payload::text, 'sha256')` (pgcrypto). Qualquer um com acesso ao banco recalcula `encode(digest(evidence_payload::text,'sha256'),'hex')` (o teste de schema faz isso).

**Ressalva (VERIFICADO no código; limitação):** `jsonb::text` é a serialização do PostgreSQL (ordem de chaves e espaçamento próprios do `jsonb`), **não** o JSON canônico RFC 8785 nem o `canonicalJson` do subsistema 2. O hash só é reproduzível fora do PostgreSQL por quem replicar essa serialização; uma futura página pública de verificação precisa documentar isso ou recalcular no banco.

O que a evidência registra: o instante, o IP visto pelo servidor (`req.ip`), o User-Agent informado pelo cliente (só evidência), o hash da imagem, o texto do termo (hash e versão) e os itens exatos. Ver seção 17 sobre o que isso **não** prova.

## 7. Regras de negócio (backend autenticado)

Todas as rotas: `@Roles('empresa','tecnico','parceiro','admin')`; o tenant vem do JWT/RLS (`req.withTenantContext`); `employee_id`/`delivery_ids`/`:id` nunca decidem o tenant (o `tenant_id` da requisição vem da **linha do funcionário** lida sob RLS). Técnico/parceiro só alcançam empresas vinculadas (RLS); sem vínculo, 404. `ValidationPipe` com `whitelist` + `forbidNonWhitelisted`; `ParseUUIDPipe` nos ids.

### 7.1 Criação (`createRequest`)
1. Termo rascunho e `EPI_SIGNATURE_ALLOW_DRAFT_TERM` diferente de `true` -> 409 `O termo de recebimento ainda não foi aprovado para uso` (nada é criado).
2. `SET LOCAL lock_timeout` (`EPI_SIGNATURE_LOCK_TIMEOUT_MS`, padrão 5000) e `FOR NO KEY UPDATE` no funcionário; estouro (`55P03`) -> 503. Funcionário inexistente ou invisível por RLS -> 404.
3. Idempotência: `(tenant_id, idempotency_key)` já usada -> 409 `Link já emitido com esta chave; revogue e gere outro`.
4. Entregas elegíveis: `pendente` ou `recusada` do funcionário, **com quantidade** (`quantity IS NOT NULL`; legadas sem quantidade ficam de fora). Com `delivery_ids`: todas precisam existir sob RLS e ser do funcionário (senão 404) e estar elegíveis (senão 409). Sem `delivery_ids`: todas as elegíveis; nenhuma -> 409.
5. Revoga (`UPDATE ... 'revogada'`) as requisições `ativa` que contenham alguma das entregas **antes** de travar as entregas; trava as entregas (`FOR UPDATE`) e confere de novo (mudou -> 409). Resultado provado: duas criações concorrentes para as mesmas entregas deixam exatamente 1 requisição ativa, sem 500 nem deadlock.
6. Insere a requisição (24 h), devolve `recusada -> pendente` nas entregas e insere os itens (o guard exige entrega pendente e requisição ativa).
7. Resposta **201** `{ id, url, qr_payload, code, expires_at, delivery_ids }`, `Cache-Control: no-store`. Base da URL: `PUBLIC_APP_URL` sem barra final; sem a variável cai em `https://app.invalid` (a URL sai inutilizável; configurar em produção).

### 7.2 Listagem e revogação
- `GET /epi-signatures/requests?employee_id=` devolve `id, employee_id, status, attempts, expires_at, created_at, used_at, refusal_reason, delivery_ids`; **nunca** `token_hash`, `pin_hash`, token nem código. O `status` é o gravado: uma requisição vencida continua `ativa` na listagem até alguém tocá-la (ver seção 17).
- `POST /epi-signatures/requests/:id/revoke`: `ativa` -> `revogada` (resposta `{id, status}`, 201); inexistente 404; não ativa 409.

### 7.3 Presencial (`registerInPerson`)
Corpo: `delivery_ids` (1 a 50, únicos), `witness_name` (3 a 120), `reason` (5 a 300), sem NUL e sem valor só de espaços; o tamanho é medido por **caracteres (code points)** depois do `trim` (`' 😀😀 '` abaixo do mínimo é 400, nunca 500). Depende do termo aprovado como a criação de link: `EPI_SIGNATURE_ALLOW_DRAFT_TERM` diferente de `true` com termo rascunho -> **409** e nada é gravado; o registro grava `term_version`. Mesma ordem de travas; revoga os links ativos das entregas e exige todas `pendente`/`recusada` (senão 409). Revogar os links antes de validar o status só é seguro porque tudo roda numa única transação (um 409 desfaz a revogação). Na mesma transação: grava `epi_in_person_signatures` (autor, testemunha, motivo, `term_version`, data) e os itens e **só então** marca as entregas `presencial` (`signed_at = now()`, `signed_by_name` = **nome do funcionário**, como no fluxo eletrônico; o sinal de presencial é o `signature_status`). Resposta 201 `{in_person_id, registered_at, deliveries}`. Sem imagem, sem evidência eletrônica, **sem comprovante**.

### 7.4 Comprovante (`GET /epi-signatures/:id/receipt.pdf`)
PDF A4 gerado **sob demanda** a partir de `epi_signatures` (evidência já gravada, nunca valores do cliente): empresa e CNPJ, funcionário com **CPF mascarado** (`***.456.789-**`), itens do `items_snapshot`, texto do termo (só impresso se `term_version` e `term_text_sha256` forem exatamente os do termo vigente; senão diz que o texto integral não está disponível e mostra o hash), declaração de assinatura eletrônica simples, hash da evidência, hash da imagem, hash do termo, IP, data/hora em America/Sao_Paulo, cabeçalho e rodapé de marca com "Página X de Y". **A imagem da assinatura não é embutida** (fica guardada à parte, identificada pelo hash). Nada é guardado no R2. A transação do tenant fecha antes de gerar o PDF. Cabeçalhos `Content-Type: application/pdf`, `Content-Disposition: inline; filename="<receipt_code>.pdf"`, `Cache-Control: private, no-store`. O `:id` é o id da **assinatura** (o id da requisição e o `receipt_code` não abrem: 404 e 400).

## 8. Validação da imagem e PNG canônico

Endpoint público: o arquivo é tratado como hostil. `validateSignaturePng` (`signature-png.util.ts`):
- Formato exigido: **PNG RGBA 8 bits**, sem entrelaçamento. Entrada de até **200 KB** (`MAX_SIGNATURE_BYTES`) e canônico de até **256 KB** (`MAX_CANONICAL_BYTES`; uma assinatura real tem ~6 KB; acima disso 400); base64 estrito (comprimento múltiplo de 4, regex, até 300.000 caracteres antes de decodificar).
- **Dimensões:** mínimo 50x30 e **teto 1200x600**. A página desenha em canvas interno **fixo 600x200** (independente de `devicePixelRatio`), então o teto é folgado. 2000x1000 é rejeitado.
- Estrutura inteira conferida: IHDR primeiro e único, IDAT contíguos, IEND obrigatório e **nada depois**, **CRC32** de todos os chunks, chunk crítico desconhecido e APNG (`acTL/fcTL/fdAT`) rejeitados, acessórios (`tEXt` etc.) descartados. Inflate com `maxOutputLength` (bomba de descompressão) e tamanho exato.
- **Desfiltra** todas as linhas (filtros 0 a 4); byte de filtro > 4 -> 400.
- Imagem em branco (0 pixels com alfa >= 128) -> 400; menos de **20 pixels** com alfa >= 128 -> 400.
- O validador **regrava um PNG canônico** (filtro 0 em todas as linhas, só IHDR + IDAT + IEND, `deflate` nível 3). **É o canônico que vai ao R2 e que é hasheado** (`signature_sha256` = SHA-256 do canônico); nada do que o cliente enviou é guardado. Consequência: o hash da imagem **não** é o do arquivo que o navegador enviou. Em um traço normal 600x200 o canônico tem ~6 KB; o canônico pode passar de 200 KB mas é recusado (400) acima de 256 KB (`MAX_CANONICAL_BYTES`), e **não** deve ser revalidado com o limite de entrada.

**Por que (VERIFICADO pelo revisor da Task 3, achado crítico):** um PNG com byte de filtro inválido era aceito, gravado como evidência imutável e **derrubava o processo Node** quando o `pdfkit` (via `png-js`) o desenhava: o `pdfkit` decodifica RGBA de forma assíncrona e lança dentro de um callback, onde nenhum `try/catch` ao redor de `doc.image()` captura. A correção é dupla: validar/regravar na entrada e só entregar ao `pdfkit` o canônico depois de `probeSafePng` (seção 11).

`probeSafePng` (`common/pdf/safe-png.util.ts`) reproduz de forma síncrona as condições do `png-js`: só o formato canônico (IHDR, IDAT, IEND; 8 bits RGBA), dimensões até 1200x600, inflate com tamanho exato e filtro <= 4 em cada linha. NÃO confere CRC (a integridade vem do hash conferido antes e de o arquivo ser o canônico regravado). Resultado reportado: 31 PNGs hostis + fuzz de 4000 casos, 0 quedas (relatório da revisão da Task 4; não reexecutado aqui).

## 9. API

### 9.1 Pública (sem JWT; `@Public()`; token e código **sempre no corpo POST**, nunca na URL)

Prefixo `/epi-signatures/public` (no navegador: `/api/epi-signatures/public/...`). `ValidationPipe` com `whitelist` + `forbidNonWhitelisted` (corpo com campo extra -> 400). Token: `^[A-Za-z0-9_-]{43}$`; código: `^\d{6}$`. **`Cache-Control: no-store` em toda resposta sob este prefixo**, inclusive 4xx/5xx, 413, preflight (OPTIONS) e erro de CORS.

| Rota | Corpo | Sucesso | Erros |
|---|---|---|---|
| `POST peek` | `{token}` | **200** `{usable: true, company_name}` ou `{usable: false}` | 400, 429 |
| `POST open` | `{token, code}` | **200** `{employee_name, expires_at, items[], term{version,draft,title,paragraphs}, attempts_left}` | 400; **401** `{message:'Código incorreto', attempts_left}`; **403** bloqueado; **404** link inválido (uniforme; também quando o termo da requisição não é o vigente); 429 |
| `POST sign` | `{token, code, accepted: true, term_version, signature_png_base64}` | **201** `{receipt_code, signed_at, evidence_sha256}` | **400** (imagem inválida/branca/grande, sem aceite, termo desatualizado); 401; 403; 404; **409** (termo ainda rascunho e variável desligada; ou "Estas entregas já foram tratadas"); **413** (corpo > 300 KB); 429; **502** (R2 indisponível; o link continua utilizável) |
| `POST refuse` | `{token, code, reason?}` (até 300, sem NUL) | **200** `{status: 'recusada'}` | 400; **401 sem `attempts_left`** (a tentativa é contada no banco); 403; 404; 429 |

Ordem do `sign` (VERIFICADO): variável do termo (409) -> `term_version` (400) -> aceite (400) -> base64/PNG (400, **antes** de gastar tentativa ou chamar o R2) -> `epi_sig_open` (confere e conta tentativa) -> PUT da imagem canônica no R2 (chave `tenants/<tenant>/epi-signatures/<uuid>.png`, prazo `EPI_FICHA_R2_TIMEOUT_MS`; falha ou estouro -> 502 e exclusão best-effort **depois** de o PUT liquidar) -> `epi_sig_sign` (atômico). Se o banco responde algo que não seja `ok` (corrida perdida, etc.), a imagem é apagada (best-effort). Se `epi_sig_sign` **lança erro**, a imagem **não** é apagada (o commit é ambíguo; apagar poderia deixar a evidência sem imagem) e fica só um log "possível imagem órfã" com a chave. `refuse` não é bloqueado pela variável do termo.

Seis assinaturas simultâneas no mesmo link: exatamente 1 vence; as demais recebem 404 uniforme e o R2 não fica com imagem das perdedoras (e2e).

### 9.2 Autenticada (JWT; papéis da seção 7)

| Rota | Corpo/parâmetros | Resposta |
|---|---|---|
| `POST /epi-signatures/requests` | `employee_id` (UUID), `delivery_ids?` (até 50, únicos), `idempotency_key` (8 a 100, sem NUL) | **201** `{id, url, qr_payload, code, expires_at, delivery_ids}` `no-store`; 400; 401; 404; 409; 503 |
| `GET /epi-signatures/requests` | query `employee_id` | 200 lista (seção 7.2); 400; 404 |
| `POST /epi-signatures/requests/:id/revoke` | — | 201 `{id, status}`; 404; 409 |
| `POST /epi-signatures/in-person` | `delivery_ids`, `witness_name`, `reason` | 201; 400; 404; 409; 503 |
| `GET /epi-signatures/pending` (subsistema 4) | query `tenant_id` (obrigatório para tecnico/parceiro/admin; empresa só o próprio), `employee_id?`, `page` (1-10000), `page_size` (1-100, padrão 25) | 200 `{items,total,page,page_size}`; 400; 404 (empresa inexistente ou não vinculada) |
| `GET /epi-signatures/:id/receipt.pdf` | — | 200 PDF; 400 (id inválido); 404 |

`GET /epi-signatures/pending` (VERIFICADO em `epi-signature.service.ts`): papéis empresa, tecnico, parceiro, admin; lista entregas `pendente`/`recusada` **com quantidade**, ordenadas por `delivered_at`; campos `delivery_id, employee_id, employee_name, tenant_epi_id, epi_description, ca_number, quantity, delivered_at, signature_status, active_request_id, active_request_status, active_request_expires_at` (link `ativa` e não vencido). **Sem** token, hash, código nem CPF. Detalhes e regra de `tenant_id` em `epi-telas.md` seções 4.1 e 4.2.

403 por papel fora da lista é INFERIDO do decorator `@Roles` (os 4 papéis estão em todas as rotas). Auditoria: `AuditInterceptor` registra a criação sem o corpo (teste: o código não é gravado); as rotas públicas aparecem com ator nulo, caminho sem token e `resourceId` nulo (relatório da Task 3; não reexecutado).

## 10. Rate limit, IP real e limite de corpo

### 10.1 Rate limit
`@RateLimit` explícito por rota, **por IP**, contador isolado por rota, janela de 10 minutos (VERIFICADO no controller e em teste de metadados): `open`, `sign`, `refuse` = **120**; `peek` = **200**. Acima disso: 429 com `Retry-After` e `no-store`. O guard roda antes da validação (429 também para entrada inválida). Esse limite **só protege recursos** (CPU, banco, R2) e tolera mutirão no mesmo Wi-Fi/NAT (30 a 50 funcionários); o valor inicial de 20 por 10 min foi descartado na revisão por bloquear mutirões. **A defesa contra força bruta do código é o bloqueio por link (seção 5), não este limite.** As rotas autenticadas estão sujeitas ao guard global (`RATE_LIMIT_MAX`, padrão 300; INFERIDO do subsistema 2).

### 10.2 Dependência do IP real atrás do Nginx — NÃO VERIFICADO
`configureApp` define `trust proxy = 1` e o código usa `req.ip` (truncado a 64) como IP da evidência e como chave do limite. O ledger registra que `nginx/conf.d/default.conf` usa `$proxy_add_x_forwarded_for`, mas **a configuração real de produção não foi conferida**. Se o IP não chegar correto: o rate limit agrupa todos num IP só (falha para o lado de **bloquear**, não de liberar) e o IP gravado na evidência fica impreciso. Se `X-Forwarded-For` puder ser forjado (Nginx que repassa o cabeçalho do cliente sem anexar), o IP da evidência e o limite podem ser burlados. Por isso a página chama a API **a partir do navegador** (um `fetch` no servidor do Next faria todos dividirem o IP do container).

**Procedimento seguro para o proprietário verificar (somente leitura, sem alterar nada):**
1. No servidor do Nginx: `nginx -T | grep -in 'forwarded\|real_ip'` (confirmar `$proxy_add_x_forwarded_for` e ausência de `real_ip` indevido).
2. Confirmar se o DNS passa por Cloudflare ou outro proxy: nesse caso o `$remote_addr` visto pelo Nginx é o da Cloudflare, e o `trust proxy = 1` entrega o IP do proxy, não o do cliente (precisaria de `real_ip` com a lista de IPs do proxy; mudança de infraestrutura, só com autorização).
3. Teste prático: abrir a página num celular em **4G** (IP diferente do escritório) e fazer um `peek`; olhar o campo `ip` nos logs do backend. Repetir enviando um `X-Forwarded-For` forjado e conferir que o IP registrado **não** é o forjado.

## 11. Ficha: anexo de comprovantes e orçamento de imagens

(VERIFICADO em `epi-ficha.service.ts`, `signature-image-budget.util.ts`, `ficha-pdf.util.ts`.)
- `GET /epi-fichas/employees/:id` passa a devolver, nas linhas `assinada` do livro, `receipt_code` e `signed_at` (ISO UTC), e a lista `signatures` (`receipt_code`, `signed_at`, `evidence_sha256`, `signature_sha256`). **`signature_file_key` nunca sai** (nem no instantâneo). O frontend do subsistema 4 que consumir este JSON não existe ainda (NÃO VERIFICADO).
- **Prévia** não lê o R2: mostra só código e data. A **emissão** lê as imagens canônicas e inclui o anexo **"Comprovantes de assinatura"**, só para entregas com evidência eletrônica. Sem evidência: nenhum anexo, nenhuma imagem, nenhuma leitura do R2. Presencial aparece como "Registrada presencialmente", sem comprovante e sem imagem.
- **Orçamento por emissão:** no máximo **100 imagens** (`MAX_SIGNATURE_IMAGES`; as demais listam código e data); **12 megapixels** somados (largura x altura lidas do IHDR); **8 MB** lidos do R2. Objeto do R2 **maior que 256 KB** é tratado como indisponível **antes** do SHA-256. Ordem das checagens: tamanho do objeto, orçamento de bytes, hash contra `signature_sha256` da evidência, cabeçalho plausível (<= 1200x600), orçamento de pixels. Hash divergente, ausente (`NoSuchKey`) ou cabeçalho implausível -> `(imagem indisponível/divergente)`; estourou 12 Mpx/8 MB -> `(imagem não incluída (limite do documento))`. Só o PNG que passa por `probeSafePng` é entregue ao `pdfkit`.
- Qualquer outra falha de leitura, estouro do prazo ou do orçamento -> **502** e **nenhum documento registrado**.
- Pior caso medido em teste (onda final, limites novos de 256 KB/8 MB; 80 KB por imagem de entrada no teste denso): emissão ~1,7 s e RSS ~1,15 GB de pico, igual ao medido antes (o teto de pixels é que limita o custo; o teto de bytes limita o que é lido). Antes: 100 assinaturas 1200x600 de traço denso respeitam 12 Mpx (só 16 imagens), terminam rápido e o PDF fica razoável (e2e `epi-signature-ficha`). Antes do orçamento, 100 imagens 2000x1000 chegaram a ~10 s de CPU e ~1 GB de RSS (achado da revisão da Task 4).
- Repetição idempotente da emissão não relê as imagens.

## 12. Frontend (`/assinar`)

- **Rota** `frontend/src/app/assinar/page.tsx` (fora do grupo `(site)`, sem cabeçalho do site) e `layout.tsx` (`robots: noindex, nofollow`, `referrer: no-referrer`). Cliente da API em `frontend/src/lib/epi-signature-api.ts`.
- **Token no fragmento:** lido de `#token=` e **removido da URL** com `history.replaceState` assim que lido; vive só em estado do React. **Nada em `localStorage`/`sessionStorage`** (teste). `hashchange`: um segundo link colado na mesma aba troca o token; um contador de geração descarta respostas atrasadas do link anterior (teste: peek de A pendente e sign em voo + hashchange).
- **Chamadas:** `fetch('/api/epi-signatures/public/<rota>')` do navegador, `POST` com JSON, `cache: 'no-store'`, `referrerPolicy: 'no-referrer'`; token e código só no corpo.
- **Canvas** (`SignaturePad.tsx`): tamanho interno **fixo 600x200**, fundo **transparente** (nunca preenchido), traço **preto** de 3 px, escala só por CSS (`width: 100%`, `aspect-ratio 3/1`), `touch-action: none`, eventos de ponteiro com `setPointerCapture`; ignora multitoque (rastreia o `pointerId` ativo); `pointercancel` descarta o traço em andamento e redesenha só os concluídos (nunca emite PNG parcial); "Limpar" volta a vazio. `role="img"` com `aria-label="Área para assinar com o dedo"`.
- **Estados:** `lendo`, `verificando`, `codigo`, `conferencia`, `assinado`, `recusado`, `fim`.
- **Mensagens** (PT-BR, só da lista conhecida; nunca repassa o texto cru do servidor): link inválido ou expirado; bloqueado; "A assinatura ainda não está disponível. Procure o responsável." (409 do termo em rascunho); "Estas entregas já foram tratadas..."; imagem não enviada; "Muitas tentativas. Aguarde alguns minutos." (429); falha genérica; código errado com "Restam N tentativas". Termo desatualizado (400) oferece **"Atualizar termo"**, que reabre com o código sem perder o link (um `reload` perderia o token, que já saiu do fragmento).
- **Terminais:** em sucesso, recusa e estados fatais (404, 403, 409 "tratadas") a página apaga código, token, nome, itens, desenho e aceite do estado; não há botão para assinar de novo. "Tentar de novo" só existe em falha recuperável do `peek`. Em 502 e erro de rede o desenho é preservado.
- **Comprovante na tela:** código do comprovante, data e hora em horário de Brasília, "Guarde este código"; sem promessa de validade jurídica.
- **Acessibilidade:** foco no título a cada etapa, foco na mensagem de erro na conferência, `role="alert"` único, alvos de toque >= 44 px, texto >= 16 px, campo do código com `inputMode="numeric"`, `autoComplete="one-time-code"`, `maxLength=6`. Nota abaixo do canvas: se não conseguir assinar na tela, procurar o responsável (presencial).
- **StrictMode em `next dev` (INFERIDO, não afeta produção):** o efeito que lê o fragmento roda duas vezes; na segunda o fragmento já foi removido e a página pode mostrar "Link inválido". Mesmo padrão de `redefinir-senha`. RECOMENDADO para testar à mão: usar `next build` + `next start` (NÃO VERIFICADO se desligar `reactStrictMode` basta).
- Testes de frontend (relatório da Task 5): vitest 42 arquivos / 452 testes ok, `tsc` ok, `next build` ok (`/assinar` ~5 kB); `lint` com 14 problemas, **idêntico ao baseline** (11 erros pré-existentes em `esocial/*`).

## 13. Testes

Backend (`backend/test/`):

| Arquivo | O que prova |
|---|---|
| `signature-secrets.unit-spec.ts` | token 43 caracteres base64url e distinto a cada chamada; código 6 dígitos com zeros à esquerda; `hashToken` SHA-256 e `hashPin` HMAC com chave = token; termo rascunho só assina com a variável ligada; hash do termo estável |
| `signature-png.unit-spec.ts` | aceita PNG válido (e perto de 200 KB); filtros 1 a 4 desfiltrados corretamente; filtro 7 -> 400; branco, alfa 0, poucos pixels; chunks acessórios/críticos/APNG; CRC errado, dados após IEND, IEND ausente, IDAT não contíguos, IHDR duplicado; dimensões/cor/entrelaçamento; bomba de descompressão; > 200 KB; 2000x1000 rejeitado e 1200x600 em < 200 ms; canonical desenhado pelo `pdfkit` sem exceção; filtro 7 nunca chega ao `pdfkit` |
| `epi-signature-image-budget.unit-spec.ts` | orçamento: dimensões compartilhadas validador/probe, objeto > 256 KB indisponível antes do SHA-256, 12 Mpx e 8 MB omitem o excedente |
| `epi-signature-receipt.unit-spec.ts` | PDF do comprovante: código, itens, CPF mascarado, hashes, declaração de assinatura simples, hora de São Paulo, termo aprovado sem "RASCUNHO", nome com emoji/CJK e 80 itens, texto enorme, data inválida é erro |
| `epi-signature-schema.e2e-spec.ts` | peek/open/sign/refuse no banco; 5 erros bloqueiam; hash da evidência confere; imutabilidade e TRUNCATE; constraints; RLS; ACL das funções; cascata de tenant; código NULL e token NULL; concorrência (assinatura e tentativas erradas); guard dos itens; guard de INSERT direto; evidência sem CPF; CHECKs de tamanho |
| `epi-signature-create.e2e-spec.ts` | criação, `PUBLIC_APP_URL`, `delivery_ids`, revogação do link anterior, recusada -> pendente, idempotência, 404/409, termo rascunho bloqueado, revoke, presencial, permissões e isolamento, entrada inválida, auditoria, criações concorrentes |
| `epi-signature-public.e2e-spec.ts` | rotas públicas: resposta uniforme, tentativas, assinatura completa (R2 com hash igual), 400 sem gastar link, código errado não envia ao R2, corrida, refuse, R2 indisponível -> 502, termo rascunho -> 409, rate limit (121ª/201ª = 429; metadados 120/200), pilha do Express (uma camada `jsonParser`), login normal, CORS/preflight `no-store`, PNG com filtro 7 -> 400, limite de corpo (global 100 KB; público ~200 KB aceito, acima 413), entrada inválida, nada sensível em respostas/logs |
| `epi-signature-ficha.e2e-spec.ts` | ficha com e sem evidência, prévia sem R2, emissão com anexo, presencial sem comprovante, imagem ausente/divergente, 502 sem registro, idempotência sem reler, filtro de status, > 100 assinaturas, objeto > 256 KB, `EPI_FICHA_LOCKED_BUDGET_MS`, pior caso de 12 Mpx, comprovante em PDF (conteúdo, papéis, 404/400/401) |
| `tenant-context-callsites.unit-spec.ts` | guarda existente; **não** enxerga `withoutTenantContext` (seção 17) |

Frontend: `frontend/src/app/assinar/__tests__/assinar-page.test.tsx` (fragmento removido, mensagens, tentativas, bloqueio, conferência, aceite, envio sem prefixo data URL, comprovante, 502 e rede preservam desenho, termo desatualizado, recusa, nenhum storage, hashchange e respostas atrasadas, limpeza de dados nos estados terminais) e `frontend/src/components/epi/__tests__/SignaturePad.test.tsx` (vazio/limpar, coordenadas 600x200, botão não primário, fundo transparente, multitoque, `pointercancel`).

### Como rodar (somente ensaio descartável)
- **Nunca contra produção.** Os e2e criam e apagam dados reais no banco apontado. Não usar `run-backend-tests.sh` para e2e (carrega o `.env` e aponta para o ambiente principal). Use o ensaio isolado (Postgres e Redis descartáveis em rede própria, migrations em ordem **até a 0083**, chaves falsas), conforme a memória do projeto `reference_ensaio_descartavel_isolado`. Os scripts do ensaio não estão no repositório.
- **Migrar o ensaio como `montese_app`** (como o `db:migrate` real, VERIFICADO no ensaio): a 0083 exige o dono das tabelas para `ALTER FUNCTION ... OWNER TO` e `GRANT`.
- **R2 sempre mockado** (os specs sobrescrevem o `R2Service`); nunca credencial real.
- Jest com `--config ./test/jest-e2e.json --runInBand --forceExit`, imagem glibc (`node:20-bookworm-slim`), `NODE_ENV=test`, `TEST_SUPERUSER_DATABASE_URL` apontando para o banco do ensaio.
- **O e2e completo precisa de lotes** (a suíte inteira num processo estoura memória; o plano usa lotes de 12 com `NODE_OPTIONS="--experimental-vm-modules --max-old-space-size=3072"`) **e de `RATE_LIMIT_MAX` alto** no ambiente do ensaio (guard global, padrão 300). Os limites das rotas públicas são fixos (`@RateLimit`) e **não** usam `RATE_LIMIT_MAX`; cada chamada de teste usa um IP próprio via `X-Forwarded-For`.
- Unit: `/opt/Montese/run-backend-tests.sh test:unit` (sem banco de e2e). Baseline do unit no ensaio: só `r2-get-object` falha (por não haver R2).
- **Frontend**: `vitest`, `tsc`, `lint` e `next build` em **container descartável** (`node:20-bookworm-slim`, cópia do frontend, worktree só leitura, cache de dependências feito com `npm ci` fora do worktree). Lint tem baseline vermelho por `esocial/*`.
- Resultados do relatório da Task 6 (regressão completa em lotes): não registrados nas fontes lidas (NÃO VERIFICADO).

### Prova com navegador real
VERIFICADO pelo controlador em 2026-10-15 (ledger, Task 5; **não reexecutado** por quem redigiu): Chromium via Playwright, `devicePixelRatio` 1, 2 e 3: canvas interno **600x200** nos três; o PNG enviado ao `sign` passou em `validateSignaturePng` (600x200); canônico de **~6 KB** (6217 bytes); `probeSafePng` ok; `pdfkit` desenhou sem exceção. Antes disso os testes de componente rodavam em jsdom sem canvas real.

## 14. Variáveis de ambiente

- `EPI_SIGNATURE_ALLOW_DRAFT_TERM`: padrão **ausente = false**. Só importa se o termo vigente voltar a ser `draft: true` (o vigente é `v1-2026-11`, aprovado em 2026-11-01, `draft: false`). Nesse caso, só o valor exato `true` libera **criar link** e **assinar**. Por quê: o texto do termo é um rascunho sem revisão jurídica; assinar sob ele criaria evidência **imutável** vinculada a um texto não aprovado. Os testes ligam `true`. Recusar não é bloqueado.
- `EPI_FICHA_R2_TIMEOUT_MS`: padrão 8000. Prazo do PUT da imagem no `sign` e do delete best-effort (mesma variável da ficha).
- `EPI_FICHA_LOCK_TIMEOUT_MS`: padrão 5000. Usada pela emissão da ficha (espera pela trava do funcionário). **A criação de link e o presencial usam outra**: `EPI_SIGNATURE_LOCK_TIMEOUT_MS` (padrão 5000), que não estava na lista combinada e foi encontrada no código.
- `EPI_FICHA_LOCKED_BUDGET_MS`: padrão 15000. Orçamento total da seção sob a trava do funcionário na emissão da ficha (leitura das imagens + PUT do PDF + delete); cada operação de R2 usa `min(EPI_FICHA_R2_TIMEOUT_MS, restante)`; esgotado -> 502 sem registro.
- `PUBLIC_APP_URL`: base do link (`<base>/assinar#token=...`) e origem permitida no CORS. Sem ela o link sai com `https://app.invalid`. Valores inválidos (não inteiro positivo) das variáveis de prazo voltam ao padrão.

## 15. ROLLBACK

Arquivo de origem: scratchpad da sessão (`0083.down.sql`; fora do repositório). **Provado de novo na onda final** com dois bancos descartáveis (`rb_a` = migrations até a 0082; `rb_b` = até a 0083 + este down): `pg_dump --schema-only` (sem as linhas `\restrict`/`\unrestrict`) **idêntico** (`diff` vazio, VERIFICADO), e a 0083 foi reaplicada em seguida com sucesso. Recusas provadas, uma por vez, num terceiro banco: requisição `recusada`, linha em `epi_signatures` e linha em `epi_in_person_signatures` abortam com `rollback recusado`; só requisição `ativa` permite. NÃO VERIFICADO em produção. Fazer backup antes.

**O que ele recusa:** qualquer linha em `epi_signatures` OU em `epi_in_person_signatures`, ou qualquer requisição com status fora de `ativa` e `expirada`. Remove também o trigger/função que a 0083 pôs em `employee_epi_deliveries` e os GRANTs que ela introduziu; o `SELECT` em `tenants` vem da 0081 e fica.

```sql
-- Rollback manual da 0083 (EPI: assinatura eletrônica mobile). SÓ PARA ENSAIO; não faz parte do repositório.
-- Recusa executar se já houver evidência (eletrônica ou presencial) ou requisição que não esteja ativa/expirada.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM epi_signatures) THEN
    RAISE EXCEPTION 'rollback recusado: existem assinaturas em epi_signatures';
  END IF;
  IF EXISTS (SELECT 1 FROM epi_in_person_signatures) THEN
    RAISE EXCEPTION 'rollback recusado: existem registros em epi_in_person_signatures';
  END IF;
  IF EXISTS (SELECT 1 FROM epi_signature_requests WHERE status NOT IN ('ativa','expirada')) THEN
    RAISE EXCEPTION 'rollback recusado: existem requisições que não estão ativas/expiradas';
  END IF;
END $$;
-- trigger que a 0083 pôs em tabela anterior (as dos objetos próprios caem com as tabelas)
DROP TRIGGER trg_epi_deliveries_signature_guard ON employee_epi_deliveries;
DROP FUNCTION epi_deliveries_signature_guard();
DROP TABLE epi_in_person_signature_items;
DROP TABLE epi_in_person_signatures;
DROP FUNCTION epi_in_person_immutable();
DROP FUNCTION epi_in_person_items_guard();
DROP FUNCTION epi_in_person_items_final_check();
DROP FUNCTION epi_in_person_final_check();
DROP FUNCTION epi_sig_sign(text,text,boolean,text,text,text,text);
DROP FUNCTION epi_sig_refuse(text,text,text);
DROP FUNCTION epi_sig_open(text,text);
DROP FUNCTION epi_sig_peek(text);
DROP FUNCTION epi_sig_items(uuid);
DROP FUNCTION epi_sig_check(text,text);
DROP TABLE epi_signatures;
DROP TABLE epi_signature_request_items;
DROP TABLE epi_signature_requests;
DROP FUNCTION epi_signature_requests_guard();
DROP FUNCTION epi_signatures_immutable();
DROP FUNCTION epi_signatures_insert_guard();
DROP FUNCTION epi_sig_items_guard();
-- concessões à role das funções que a 0083 introduziu (as demais já existiam antes)
REVOKE SELECT, UPDATE (signature_status, signed_at, signed_by_name) ON employee_epi_deliveries FROM montese_auth_bypass;
REVOKE SELECT (id, full_name) ON employees FROM montese_auth_bypass;
REVOKE SELECT ON tenant_epis, epi_catalog_items FROM montese_auth_bypass;
DELETE FROM _migrations WHERE name = '0083_epi_signatures.sql';
COMMIT;
```

Se a numeração mudar no merge, ajustar o `name` no último `DELETE`. Depois de haver assinaturas, o rollback não vale: a correção é nova versão/novo registro, não desfazer a migration.

## 16. Ordem de release e riscos

Ordem RECOMENDADA:
1. **0081 -> 0082 -> 0083** (a 0083 usa `epi_tenant_row_exists` da 0081 e as tabelas de entregas/EPI do subsistema 1). Ver `epi-estoque.md` e `epi-ficha.md`.
2. **Backup** antes de aplicar.
3. **Numeração**: confirmar frente à `0080` da branch `feat/tabela-oficial-funcionarios` (não mesclada) e renumerar se necessário (ajustar o `DELETE` do rollback). A 0083 foi **reaberta** para incluir as tabelas presenciais em vez de criar a 0084 (decisão do ledger, porque ainda não foi aplicada em produção); se alguma cópia já a tiver aplicado sem as tabelas presenciais, ela não será reaplicada.
4. Aplicar a migration, depois o backend. Backend novo sem a 0083 quebra (tabelas/funções ausentes); migration sem o backend novo é inofensiva (aditiva).
5. Definir `PUBLIC_APP_URL` com o endereço público real e decidir `EPI_SIGNATURE_ALLOW_DRAFT_TERM` (seção 17).
6. Conferir o IP real atrás do Nginx (seção 10.2) **antes** de abrir a rota ao uso.

Riscos de ambiente:
- A 0083 roda como `montese_app` e faz `ALTER FUNCTION ... OWNER TO montese_auth_bypass`, `GRANT`s e `REVOKE TRUNCATE` (VERIFICADO no ensaio migrado como `montese_app`; em produção NÃO VERIFICADO, depende dos papéis reais).
- **`pgcrypto` (`digest`, `gen_random_bytes`) em produção: NÃO VERIFICADO** (a 0001 cria a extensão e o ensaio funciona com `search_path = public, pg_temp`; confirmar no banco de produção em modo leitura, `SELECT extname, extnamespace::regnamespace FROM pg_extension WHERE extname='pgcrypto'`).
- **Problema PREEXISTENTE do `audit_log` (fora do escopo, também afeta 0081/0082):** `audit_log` tem `actor_tenant_id` e `actor_user_id` com `ON DELETE SET NULL` e `REVOKE UPDATE/DELETE/TRUNCATE` de `montese_app`. Se a tabela **pertence a `montese_app`** (porque o `migrate.ts` usa o `DATABASE_URL` da aplicação), a ação referencial roda como dono e **nenhum tenant ou usuário pode ser apagado** (`permission denied for table audit_log`; reproduzido no ensaio migrado como `montese_app`, o teste de cascade de tenant falha nas três suítes de schema do módulo). Conferir em produção, **somente leitura**: `SELECT tablename, tableowner FROM pg_tables WHERE tablename IN ('audit_log','tenants');`. Afeta a exclusão de empresa/usuário (LGPD); a decisão e a correção são do proprietário com o `montese-banco-rls`.
- `express` é dependência **transitiva** de `@nestjs/platform-express`, importada diretamente em `app-setup.ts` (`import { json } from 'express'`); não foi acrescentada ao `package.json` para não mexer no lockfile. Declarar quando houver janela.

## 17. LIMITAÇÕES E DECISÕES PENDENTES DO PROPRIETÁRIO

1. **Termo APROVADO pelo proprietário em 2026-11-01** (`v1-2026-11`, `draft: false`); a revisão jurídica do texto segue pendente fora do sistema. Se o texto mudar, vira nova versão e os links ativos deixam de abrir. Histórico da decisão original (o termo foi `rascunho-1`, `draft: true`, e a criação de link e a assinatura ficavam **bloqueadas** (409) via `EPI_SIGNATURE_ALLOW_DRAFT_TERM`). Decisão tomada: aprovar o texto (revisão jurídica) e então trocar `EPI_TERM` (versão nova, `draft: false`), ou ligar a variável conscientemente com o rascunho. Links criados com versão anterior do termo viram "inválidos" (404) quando o termo vigente muda (o serviço compara `term_version` **e** o hash do texto: `epi_sig_open` devolve `term_text_sha256` e `callOpen` exige igualdade com `termTextSha256()`; o teste unitário `signature-secrets` FIXA o par versão -> hash, então alterar o texto sem trocar a versão quebra o teste). O presencial também depende da variável e grava `term_version`.
2. **Assinatura eletrônica simples, não ICP-Brasil.** A evidência registra aceite explícito, código de 6 dígitos, imagem, IP, User-Agent, termo e itens. **O que o código e o desenho NÃO provam: identidade.** O código é repassado pelo próprio responsável a quem está presente; não há biometria, documento, geolocalização, verificação do aparelho nem canal independente. Quem tiver o link e o código assina por qualquer funcionário. O comprovante e a tela dizem isso com franqueza e não alegam validade jurídica específica; a força probatória é questão jurídica do proprietário.
3. **Envio do link só presencial**: o responsável mostra o QR/link ao funcionário (ou entrega o aparelho). Sem e-mail/WhatsApp/SMS e sem telas do responsável até o subsistema 4.
4. **Presencial**: grava testemunha, motivo e autor em tabela própria, mas **não aparece no instantâneo da ficha** (a linha só diz "Registrada presencialmente") **e não tem comprovante** (pendência). Agora há guards de mesmo tenant/funcionário/status nos itens e `presencial` exige registro (seção 3.7).
5. **Leitura das imagens sob a trava do funcionário** na emissão da ficha (dívida técnica): a seção roda sob `FOR NO KEY UPDATE` e com a conexão do pool presa. Mitigada por `EPI_FICHA_LOCKED_BUDGET_MS` (15 s). Pior caso ~15 s + 1 s (piso do delete best-effort); com R2 pendurado e várias emissões simultâneas o pool pode esgotar por esse tempo. Evolução: pré-ler as imagens **antes** da trava e conferir depois que o conjunto de assinaturas não mudou.
6. **Órfãos de imagem no R2 sem varredura**: (a) processo cai entre o PUT e `epi_sig_sign`; (b) `epi_sig_sign` lança erro ambíguo e a imagem não é apagada; (c) delete best-effort que falha. Chave `tenants/<t>/epi-signatures/<uuid>.png` imprevisível e privada, então inofensivo, mas ocupa espaço. RECOMENDADO: rotina que liste `tenants/*/epi-signatures/` e apague o que não tem `signature_file_key` correspondente e é mais antigo que N horas, primeiro em modo listagem.
7. **Rótulo "indisponível/divergente" impreciso**: também aparece para imagem íntegra mas maior que 1200x600 ou objeto > 256 KB. O teto de 8 MB é aplicado depois de ler tudo (pico transitório de memória em caso extremo; `R2Service.getObject` sem limite).
8. **`refuse` 401 sem `attempts_left`** (a função `epi_sig_refuse` devolve só `result`); a página mostra "Código incorreto." sem o número.
9. **409 "tratadas" por regex no frontend** (`/tratadas/i` sobre o texto do servidor); o backend não tem código de erro estruturado. Trocar o texto no backend quebra a distinção.
10. **Expiração só preguiçosa**: a requisição vira `expirada` quando alguém a consulta (`peek`/`open`/`sign`/`refuse`); não há rotina agendada neste módulo (VERIFICADO por leitura). A listagem pode mostrar `ativa` com `expires_at` vencido. As entregas **continuam `pendente`** quando o link expira (decisão do ledger; o status `expirada` da entrega não é aplicado).
11. **Corpo maior que 100 KB em rotas comuns responde 500** (e não 413): o erro do `body-parser` cai no `AllExceptionsFilter`, que só reconhece `HttpException`. **Preexistente**; só o caminho `/epi-signatures/public` tem tratador próprio (413/400 em JSON, limite 300 KB).
12. **Nome `jsonParser` no Nest**: o `json()` do Express tem esse nome; o Nest só monta o parser global (100 KB) se **não** achar uma camada com esse nome. O parser de 300 KB do caminho público é por isso embrulhado numa função anônima em `app-setup.ts` (sem isso o login devolvia 400 e todas as rotas ficavam sem corpo). Qualquer mudança nessa área deve manter isso (teste: após `app.init` há exatamente **uma** camada `jsonParser`, e as públicas vêm antes).
13. **Guarda `tenant-context-callsites`** só conta `.withTenantContext(`; o serviço público usa `withoutTenantContext` e não está na lista `ALLOWED`. Uma lista própria para `withoutTenantContext` é evolução (RECOMENDADO).
14. **Retenção/LGPD**: IP e User-Agent ficam na evidência imutável por desenho; funcionário com assinatura não pode ser apagado (`employee_id` RESTRICT). Retenção e decisão de apagar vs. reter são do proprietário.
15. **Minors adiados do ledger que ainda valem** (Task 1 a 5):
    - T1: `epi_sig_items_guard` lê o status da requisição sem `FOR SHARE` (inalcançável no fluxo legítimo); o teste da segunda camada (item plantado por bypass) tem título sem corpo equivalente; `DELETE` direto de requisição recusada/revogada leva os itens junto (comportamento existente); o guard de INSERT nega qualquer role não superusuária exceto o bypass.
    - T2: texto da testemunha/motivo com emoji conta UTF-16 no JS e code points no PG (dois emojis passam no serviço e violam o CHECK -> 500; usar `[...s].length`); sem trigger nos itens presenciais (item 4); o `0083.down.sql` não recusa com presenciais (seção 15).
    - T3: link bloqueado segue 403 após expirar (oráculo só para quem tem o token); a validação do PNG é síncrona (~90 a 130 ms no pior caso de 2000x1000 hostil de 9 KB, hoje limitado pelo teto 1200x600; teste < 200 ms); teste de log usa o logger padrão.
    - T4: delete best-effort inútil quando o PUT nem foi tentado.
    - T5: `<p role="alert">` vazio sempre renderizado (espaço extra) e foco + `role="alert"` podem anunciar duas vezes; `lostpointercapture`/`disabled` no meio do traço não tratados.
16. **Primeira rota pública do módulo que expõe dado de funcionário** (nome e itens, só após o código). Exige a revisão de segurança dedicada do plano (`montese-seguranca`); este documento não a substitui. A LIMITAÇÃO da seção 4.1 vale para todo o padrão `auth_*`.

---
Ao integrar, acrescentar a linha apontando para `epi-assinatura.md` em `docs/architecture/README.md`

## 18. Onda final: ordem das validações do `sign` e pendências aceitas

- **`sign` consulta o link antes de gastar CPU (I-2).** Depois de termo/aceite/`term_version`, chama `epi_sig_peek(hashToken(token))`: link inexistente, expirado, usado, revogado ou **bloqueado** -> 404 uniforme `Link inválido ou expirado` ANTES de decodificar o base64 e validar o PNG (50-90 ms síncronos). Quem tem link válido continua levando 400 do PNG antes de gastar tentativa. Efeito colateral aceito: `sign` num link bloqueado passa a responder 404 (e não 403); `open` e `refuse` continuam 403.
- **Hash do termo (I-3):** ver seção 17, item 1.
- **Pendências aceitas (podem esperar, NÃO feitas nesta onda):** `epi_sig_items_guard` sem `FOR SHARE`; `withoutTenantContext` fora da guarda (lista própria); corpo > 100 KB em rotas comuns responde 500; `refuse` sem `attempts_left`; varredura de órfãos no R2; `role="alert"` vazio na página; 409 reconhecido por regex no frontend; StrictMode do `next dev`; fallback sem Redis do rate limit ignora o limite da rota (60/min); `audit_log` recebe uma linha por requisição pública anônima; estorno de entrega assinada a tira do anexo (decisão de produto).
