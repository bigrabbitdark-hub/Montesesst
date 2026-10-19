# Módulo EPI — Subsistema 2: ficha de controle e PDF

Status: **implementado e testado no ensaio descartável; não commitado** (worktree `/opt/montese-epi`, branch `feat/epi-estoque`, alterações apenas em stage). Nada em produção.

Rótulos: VERIFICADO (conferido no código, na migration ou em teste existente), NÃO VERIFICADO, RECOMENDADO.
Observação sobre "testes passaram": os resultados de execução citados vêm dos relatórios das tarefas (`.superpowers/sdd/2026-10-14-epi-ficha-pdf/task-*-report.md`) e do ledger `progress.md`; a redação deste documento não reexecutou os testes (NÃO VERIFICADO por quem escreveu; VERIFICADO no código dos testes).

Fontes: `backend/db/migrations/0082_epi_ficha_documents.sql`, `backend/src/epi-ficha/*`, `backend/src/common/pdf/*`, `backend/src/epi/occurred-at.util.ts`, `backend/src/employees/*`, `backend/test/epi-ficha-*.spec.ts` e specs unitários citados na seção 8, spec `docs/superpowers/specs/2026-10-14-epi-ficha-pdf-design.md`. Complementa `docs/architecture/epi-estoque.md` (subsistema 1).

## 1. Visão geral e escopo

O módulo EPI foi dividido em 4 subsistemas. Este documento cobre o **subsistema 2**: ficha de controle de EPI por funcionário (dados em JSON), prévia em PDF, **emissão** de versões numeradas e imutáveis (PDF guardado no R2 + registro com instantâneo e hashes), download e verificação de integridade. É só backend (migration, módulo `epi-ficha`, rotas, testes).

**Não existem** (VERIFICADO: não há código para eles): assinatura eletrônica (subsistema 3), telas/menu/dashboard e formulário de funcionário (subsistema 4), página pública de verificação (a verificação é autenticada), certificação ICP-Brasil (nada no PDF a alega) e rota de edição/exclusão de documento emitido.

Abordagem (VERIFICADO em `epi-ficha.service.ts`): `pdfkit` no servidor; o arquivo emitido é guardado byte a byte no R2 e nunca é regerado, porque uma atualização do `pdfkit` mudaria os bytes e quebraria o hash. A ficha é montada a partir do livro `epi_movements` (subsistema 1) e das entregas legadas, sempre no `client` do contexto do tenant (RLS).

## 2. Modelo de dados (migration 0082)

A migration é aditiva (VERIFICADO no arquivo). Depende da 0081: usa `epi_tenant_row_exists(UUID)` e a role `montese_app`.

### 2.1 `employees`
- **Só `department` é novo**: `department TEXT` (nulo) com `CHECK chk_employees_department_len` (nulo ou até 120 caracteres).
- **`registration_number` JÁ existia desde a 0069** (pré-requisitos do eSocial; mesma matrícula do trabalhador). A 0082 não o cria nem o altera. O limite de 30 caracteres é validado **no serviço do employees** (`employees.service.ts`, `FICHA_TEXT_LIMITS`), por coerência com o eSocial; não há CHECK no banco, de propósito: a coluna é compartilhada com o módulo eSocial, que também escreve nela (ruling do ledger).
- A spec original dizia que não havia matrícula; isso estava errado (ver seção 12 e a spec atualizada).

### 2.2 `epi_ficha_documents`
Colunas (VERIFICADO): `id` UUID PK (`gen_random_uuid()`), `tenant_id` (FK `tenants` ON DELETE CASCADE), `employee_id` (FK `employees` **ON DELETE RESTRICT**), `version` INT (`>= 1`), `document_code` TEXT, `file_key` TEXT (chave no R2), `file_sha256` e `snapshot_sha256` (CHECK `^[0-9a-f]{64}$`), `snapshot` JSONB, `term_version` TEXT, `issued_by_user_id` (FK `users`), `issued_at` TIMESTAMPTZ (padrão `now()`; o serviço grava o instante da emissão), `idempotency_key` TEXT. Todas NOT NULL.

Constraints: `UNIQUE (tenant_id, employee_id, version)`, `UNIQUE (tenant_id, document_code)`, `UNIQUE (tenant_id, idempotency_key)`. Índices: `idx_epi_ficha_documents_tenant (tenant_id)` e `idx_epi_ficha_documents_employee (employee_id, version DESC)`.

Imutabilidade: trigger `trg_epi_ficha_documents_immutable` (BEFORE UPDATE OR DELETE, por linha) chama `epi_ficha_documents_immutable()`: UPDATE e DELETE diretos levantam erro `42501` ("emita uma nova versão"). A exceção é a exclusão em cascata de um tenant inteiro, que roda dentro do trigger de integridade referencial (`pg_trigger_depth() > 1`) e só vale com o tenant já removido (`epi_tenant_row_exists`, SECURITY DEFINER da 0081, consulta sem RLS). Mesmo padrão da 0081.

RLS: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `epi_ficha_documents_isolation` (papel `admin`, ou `tenant_id` = `app.tenant_id`, ou `tenant_id IN assigned_tenant_ids_for_current_user()`). `REVOKE TRUNCATE ... FROM montese_app`.

Sem FK composta `(employee_id, tenant_id)`: nada no banco impede um registro cujo `tenant_id` difira do tenant do funcionário. O serviço de emissão tira o `tenant_id` da linha do funcionário lida sob RLS (seção 11).

## 3. Regras de negócio

### 3.1 Conteúdo da ficha (`getFicha`)
- **Só o livro e o legado** (VERIFICADO na consulta SQL). Do livro entram movimentações de tipo `entrega`, `troca`, `devolucao` e `estorno`; `entrada`, `baixa`, `ajuste` e `abertura` não aparecem. Do legado entram entregas de `employee_epi_deliveries` com `signature_status = 'legado'` **sem** movimentação vinculada (`NOT EXISTS epi_movements.delivery_id`), tipo `entrega_legada`, `quantity` nula (nunca inventar quantidade) e `source = 'legado'`.
- **Estornadas visíveis**: a linha original permanece, com `reversed = true` (existe movimento que a reverte), e o próprio `estorno` também é linha. No PDF a linha original traz "(ESTORNADA)". Nada some.
- **CPF mascarado** sempre (`maskCpf`): `***.456.789-**` (dígitos 4 a 9); entrada que não tenha 11 dígitos vira `***.***.***-**`. O CPF completo nunca sai na resposta, no instantâneo nem no PDF (teste: nenhuma resposta contém 11 dígitos seguidos).
- **Situação da assinatura** (`signature_status`) do livro só existe para `entrega` e `troca` (CASE em `d.signature_status` da entrega vinculada). Devolução e estorno têm `signature_status` nulo e **ficam de fora** quando o filtro de situação é usado. No legado vale o status da própria entrega.
- **Filtros**: `from`, `to` (AAAA-MM-DD) e `signature_status` (um de `legado, pendente, assinada, recusada, expirada, presencial, estornada`). O período no livro compara o dia civil de São Paulo de `occurred_at`; no legado compara `delivered_at` (já é data).
- **Ordenação**: por instante (`sort_at`), depois `source`, depois UUID. Empates de instante ordenam por UUID (determinístico, não cronológico; minor adiado).
- **Limite de 1000 linhas**: a consulta traz até 1001; acima de 1000 responde 400 "Ficha muito grande: restrinja o período" (vale para JSON, prévia e emissão).
- Dados de empresa (razão social, nome fantasia, CNPJ, endereço em linha única; "não informado" se vazio), do funcionário (nome, CPF mascarado, matrícula, setor, função, admissão, situação, unidade) e o termo vão junto.

### 3.2 `occurred_at` e datas (America/Sao_Paulo)
- `normalizeOccurredAt` (`backend/src/epi/occurred-at.util.ts`, usado em `registerMovement` do subsistema 1): ausente -> `undefined` (banco usa `now()`); **data pura -> meio-dia de São Paulo** (`T12:00:00-03:00`, evita cair no dia anterior ao converter fuso); datetime com `Z` ou offset -> inalterado; **datetime sem offset -> horário de São Paulo** (`-03:00`). O Brasil não tem horário de verão desde 2019 (comentário no código).
- Motivo (ledger, ruling): sem a normalização, data pura virava meia-noite UTC = dia anterior em São Paulo, afetando `delivered_at` e a ficha. Custo se errado: clientes que enviavam datetime sem offset esperando UTC passam a ver 3 h de diferença.
- `delivered_at` das entregas do livro = `(COALESCE(occurred_at, now()) AT TIME ZONE 'America/Sao_Paulo')::date` (VERIFICADO em `epi-stock.service.ts`). Isso fecha a pendência "delivered_at" do subsistema 1 **apenas para a entrega do livro**; a rota legada `POST /epis/:id/deliveries` não foi alterada (NÃO VERIFICADO se ainda usa o fuso do banco; ver `epi.service.ts`).
- A data de cada linha da ficha é o dia de São Paulo (`to_char(... AT TIME ZONE 'America/Sao_Paulo')`).

### 3.3 Emissão (`issue`)
Passos (VERIFICADO em `epi-ficha.service.ts`), todos no mesmo client/transação do contexto do tenant:
1. `SET LOCAL lock_timeout` (`EPI_FICHA_LOCK_TIMEOUT_MS`, padrão 5000 ms) e `SELECT id, tenant_id FROM employees WHERE id = $1 FOR NO KEY UPDATE`. Estouro (`55P03`) -> 503 "Já existe uma emissão em andamento para este funcionário; tente novamente". Depois `SET LOCAL lock_timeout = 0`. `FOR NO KEY UPDATE` serializa as emissões do mesmo funcionário sem bloquear os `FOR KEY SHARE` de inserts em movimentos/entregas (teste: a trava não bloqueia entrega ao mesmo funcionário).
2. Funcionário inexistente ou invisível por RLS -> 404. **O tenant do documento vem da linha do funcionário**, nunca do corpo nem do token (admin emite com o tenant correto).
3. **Idempotência**: procura `(tenant_id, idempotency_key)`. Se existir e for do **mesmo funcionário** e dos **mesmos filtros** (comparação por `canonicalJson` dos filtros limpos de `undefined`), devolve o documento existente (200). Qualquer diferença (outro funcionário ou outros filtros) -> 409 "Chave de idempotência já usada em outra operação". Só isso é comparado; o conteúdo da ficha não é recomparado, então repetir a chave depois de novas movimentações devolve o documento antigo. A mesma chave pode ser usada por empresas diferentes (a unicidade é por tenant). Mesma chave em paralelo no mesmo funcionário -> `[201, 200]`, mesmo `id`, um só registro (a trava serializa).
4. **Versão** = `COALESCE(MAX(version), 0) + 1` do funcionário (sob a trava). Emissões seguintes são v2, v3...; as anteriores permanecem intactas.
5. **Instantâneo canônico**: `snapshot = { ...ficha, filters, version, document_code, issued_at, issued_by_user_id }`. `ficha` já vem com `cpf_masked` e sem `file_key`. Congela o que foi impresso: editar depois o cadastro do funcionário ou do EPI não altera documento emitido (teste dedicado).
6. **Dois hashes** (seção 3.4), PDF gerado por `buildFichaPdf` com `preview: false`.
7. **R2 primeiro, registro depois**. Chave: `tenants/<tenant_id>/epi-fichas/<employee_id>/v<versão>-<UUID>.pdf` (UUID novo por emissão: nunca sobrescreve nem apaga o arquivo de outro documento). Falha ou estouro do PUT (`EPI_FICHA_R2_TIMEOUT_MS`, padrão 8000 ms, por `Promise.race`) -> exclusão best-effort do arquivo e **502** "Não foi possível guardar o documento", sem registro e sem consumir a versão. Falha do INSERT -> exclusão best-effort e erro mapeado por `mapPgError` (`23505` -> 409 "Registro duplicado", p.ex. colisão de `document_code`; `23503` -> 400). A exclusão best-effort nunca lança e nunca espera mais que `EPI_FICHA_R2_TIMEOUT_MS`; falha ou estouro só gera log de "arquivo órfão possível" com a chave (sem dado pessoal).
8. `R2Service` global **não foi alterado**: o timeout é feito no serviço da ficha (ruling do ledger). Consequência: um PUT tardio, após o timeout, pode deixar objeto órfão (ver seção 11).

### 3.4 Código do documento e os dois hashes
- **`document_code`** = `FEPI-AAAAMMDD-XXXXXXXX`: data de emissão no fuso de São Paulo (a mesma que o leitor vê no rodapé) + 8 hex maiúsculos de `randomBytes(4)`. Teste: emissão em `2026-10-15T01:30Z` gera `FEPI-20261014-...`. Colisão de código -> 409, e o arquivo do documento original não é apagado (a chave do R2 é por UUID, não pelo código).
- **`snapshot_sha256`** = SHA-256 do `canonicalJson(snapshot)` (JSON com chaves ordenadas recursivamente; `Date` vira ISO como no `JSON.stringify`). Os 12 primeiros caracteres vão impressos na linha técnica do PDF.
- **`file_sha256`** = SHA-256 dos bytes do PDF guardado. **Não pode constar dentro do arquivo** (seria circular: o hash dependeria de si mesmo); fica no sistema (tabela e respostas da API). O hash do instantâneo, ao contrário, é calculado antes do PDF e por isso pode ser impresso nele.

### 3.5 Verificação (`verify`)
Lê o arquivo do R2 pelo backend e compara o SHA-256 com `file_sha256`. Resposta: `status` = `integro` | `divergente` | `arquivo_ausente` (`NoSuchKey`), com `document_code`, `version`, `expected_sha256` e `actual_sha256` (nulo quando ausente). Erro de leitura que não seja `NoSuchKey` -> 502 (nunca devolve "íntegro" em caso de erro). Não há verificação por upload de PDF (POST -> 404). Sem rota pública.

### 3.6 Configuração por ambiente
- `EPI_FICHA_R2_TIMEOUT_MS`: padrão 8000 (PUT ao R2 e exclusão best-effort).
- `EPI_FICHA_LOCK_TIMEOUT_MS`: padrão 5000 (espera pela trava do funcionário).
- Valor inválido (não inteiro positivo) volta ao padrão. Lidos a cada chamada, para os testes poderem encurtar.
- Pior caso sob a trava: ~16 s (PUT 8 s + delete 8 s), maior que o `lock_timeout` das concorrentes, que viram 503 (correto; minor registrado).
- `RATE_LIMIT_MAX` (guard global, padrão 300) vale também para estas rotas; não há limite dedicado.

## 4. PDF

Gerado por `buildFichaPdf` (`ficha-pdf.util.ts`) com `pdfkit` (VERIFICADO no código):
- **A4**, margens esquerda/direita 40, topo 95, base = altura do rodapé de marca + 14.
- **Cabeçalho em todas as páginas**: logo Montese (altura 40), razão social e CNPJ à direita, linha verde.
- **Conteúdo**: "FICHA DE CONTROLE DE EPI"; empresa contratante (razão social, nome fantasia, CNPJ, endereço); colaborador (nome, CPF mascarado, matrícula, setor, função, admissão, situação, unidade; "não informada/não informado" quando vazio); tabela "Histórico de equipamentos" com colunas Data, Equipamento (descrição, fabricante e modelo), CA, Qtd. ("—" no legado), Movimento / motivo e Assinatura, com quebra de página e cabeçalho da tabela repetido; "Nenhuma movimentação registrada no período." quando vazio.
- **Termo**: "Termo de recebimento e responsabilidade (RASCUNHO)", versão `rascunho-1`, 4 parágrafos, e a frase "(texto em rascunho, pendente de revisão)". Não cita norma, artigo ou prazo. A versão do termo vai ao registro (`term_version`).
- **Assinatura**: **sem selo e sem imagem de assinatura**; a situação aparece como texto (Pendente, Assinada, Recusada, Expirada, Registrada presencialmente, Histórico anterior ao módulo, Estornada) e o PDF diz que não há assinatura eletrônica registrada além da indicada em cada linha. Nada é alegado como ICP-Brasil.
- **Rodapé de marca em todas as páginas** (`common/pdf/brand-footer.util.ts`): imagem fornecida pelo proprietário (PNG 3200x672) em largura total da página; altura ≈ 125 pt + 18 pt da **linha técnica** acima dela. O e-mail e os textos fazem parte da imagem e não são gerados nem validados pelo sistema. Linha técnica do emitido: `<código> — Versão <n> — Emitido em dd/mm/aaaa hh:mm — Hash do instantâneo <12 hex> — Página X de Y` (data em America/Sao_Paulo; cabeçalho/rodapé são desenhados ao final com `bufferPages`, para o "Y" ser correto). Helper reutilizável, mas **só a ficha o usa** (ver seção 11).
- **Prévia**: marca d'água "NÃO EMITIDO" em todas as páginas e linha técnica "Prévia não emitida — Página X de Y"; não grava registro, não gera código nem versão.
- `buildFichaPdf` com `preview: false` e sem `documentCode`, `version`, `issuedAt` ou `snapshotHash` rejeita (erro de programação, nunca "undefined" no PDF).
- **Ativos**: `backend/src/common/pdf/assets/montese-logo.png` (365.064 bytes) e `montese-footer.png` (410.378 bytes), copiados ao `dist/src` pelo `nest-cli.json` (`assets`). Dockerfile não alterado; o ledger registra que ele copia `dist` inteiro (VERIFICADO pelo executor da Task 3; não reconferido aqui).
- **Limitações**: (a) a fonte é Helvetica padrão do PDF (WinAnsi): caracteres fora desse conjunto (emoji, CJK etc.) renderizam mal; testes só provam que o PDF continua válido, com um rodapé por página. (b) **Tamanho ~780 KB por PDF** (logo 365 KB + rodapé 410 KB, cada um embutido uma vez). Reduzir o logo/quantizar o rodapé é **decisão do proprietário** (os arquivos são dele). (c) Linha de tabela mais alta que uma página desenharia colunas na página errada; é inalcançável pelos DTOs/limites atuais (minor adiado).

## 5. API

Controller `epi-fichas`. Todas as rotas: JWT obrigatório, `@Roles('empresa','tecnico','parceiro','admin')`; o tenant vem do JWT/RLS (`req.withTenantContext`), o `employeeId`/`documentId` da URL nunca decide o tenant. Ids com `ParseUUIDPipe` (não UUID -> 400). Nas rotas com query/corpo: `ValidationPipe` com `whitelist` + `forbidNonWhitelisted` (parâmetro desconhecido ou repetido -> 400). Resposta de PDF com `Cache-Control: private, no-store`. Respostas de documento nunca incluem `file_key`, `snapshot`, `tenant_id` nem `idempotency_key`.

| Método e caminho | Parâmetros / corpo | Resposta |
|---|---|---|
| `GET /epi-fichas/employees/:employeeId` | query opcional `from`, `to` (AAAA-MM-DD, data válida), `signature_status` | 200 JSON `{company, employee, filters, lines, term}`; 400 (filtro inválido, id não UUID, ficha > 1000 linhas); 401; 404 (funcionário inexistente, de outra empresa ou técnico/parceiro não vinculado) |
| `GET /epi-fichas/employees/:employeeId/preview.pdf` | mesmos filtros | 200 `application/pdf` inline `ficha-epi-previa.pdf`, não grava nada; 400; 401; 404 |
| `POST /epi-fichas/employees/:employeeId/issue` | corpo: `idempotency_key` (string, 8 a 100, sem NUL, obrigatório) + `from`, `to`, `signature_status` opcionais | **201** nova versão; **200** repetição idempotente; 400 (entrada inválida, corpo com campo extra, ficha > 1000 linhas); 401; 404; **409** (chave usada em outra operação, colisão de `document_code`); **502** (falha ou timeout do R2 ao guardar); **503** (emissão em andamento: `lock_timeout`). Corpo: `{id, employee_id, version, document_code, file_sha256, snapshot_sha256, term_version, issued_by_user_id, issued_at}` |
| `GET /epi-fichas/employees/:employeeId/documents` | — | 200 array (versão mais nova primeiro), mesmos campos públicos; 400; 401; 404 |
| `GET /epi-fichas/documents/:documentId/download` | — | 200 `application/pdf` inline `<document_code>.pdf`, bytes lidos do R2 pelo backend (sem URL pública); 400; 401; 404 (documento inexistente/outra empresa, ou arquivo ausente: "Arquivo indisponível"); 502 (erro de leitura do R2) |
| `GET /epi-fichas/documents/:documentId/verify` | — | 200 `{status, document_code, version, expected_sha256, actual_sha256}`; 400; 401; 404; 502 |

Outros códigos: 403 para papel fora da lista (INFERIDO do decorator `@Roles`; não há teste dedicado a esse caso). Não existem PATCH/PUT/DELETE de documento nem POST de verificação (teste: 404).

## 6. Papéis

`empresa`, `tecnico`, `parceiro` e `admin` consultam, emitem, listam, baixam e verificam. Técnico e parceiro só enxergam empresas vinculadas, via RLS (`assigned_tenant_ids_for_current_user()`); sem vínculo, 404 em tudo. Empresa B recebe 404 para funcionário/documento da empresa A. Não há restrição por papel dentro da emissão (diferente de abertura/ajuste/estorno do subsistema 1). VERIFICADO em `epi-ficha-permissions.e2e-spec.ts` e `epi-ficha-data.e2e-spec.ts`.

## 7. Auditoria

- `AuditInterceptor` global registra a emissão (única rota mutante do módulo): método POST, caminho, status, ator, papel, tenant do ator, IP; ação = sub-rota (`issue`), tipo de recurso `epi-fichas`. O `resourceId` tende a ser o `id` do documento (o interceptor usa `params.id` ou o `id` da resposta; a rota usa `employeeId`) — INFERIDO do código do interceptor; NÃO VERIFICADO em teste. Sem corpo da requisição e sem CPF.
- O registro `epi_ficha_documents` guarda o autor (`issued_by_user_id`, NOT NULL) e o instante da emissão. Leituras (GET, download, verify) não são auditadas.
- Logs do módulo não trazem dado pessoal: só o `document_code`, o tipo de falha e, para órfão possível, a chave do R2 (que contém ids de tenant e funcionário, não nome nem CPF).

## 8. Testes

Todos os e2e chamam `configureApp(app)` (exceto `epi-ficha-schema.e2e-spec`, que só usa o banco) (espelha o `ValidationPipe` global da produção) e o e2e de emissão troca o `R2Service` por um R2 em memória (`overrideProvider`). Nenhum teste usa o R2 real.

| Arquivo (`backend/test/`) | O que prova |
|---|---|
| `canonical-json.unit-spec.ts` | chaves ordenadas recursivamente, null/undefined como no JSON, SHA-256 com 64 hex, `Date` vira ISO inclusive aninhado |
| `cpf-mask.unit-spec.ts` | só dígitos 4 a 9; CPF formatado; entrada inválida nunca vaza dígito |
| `occurred-at-util.unit-spec.ts` | ausente, data pura (meio-dia SP), com `Z`/offset, sem offset (SP) |
| `epi-ficha-pdf.unit-spec.ts` | PDF de prévia (marca, CPF mascarado, "não informada"); emitido com código/versão/prefixo do hash; várias páginas com "Página X de Y"; sem selo; acentos e legado sem quantidade; presencial; data `dd/mm/aaaa hh:mm`; meta obrigatória; emoji/CJK/NUL; linha alta; termo longo; um rodapé por página |
| `epi-ficha-schema.e2e-spec.ts` | `department` nulo e limitado a 120; CHECKs de hash e versão; unicidades; imutabilidade (UPDATE/DELETE -> 42501); TRUNCATE negado à role da aplicação; RLS entre empresas; cascata de tenant com documentos |
| `employees-registration.e2e-spec.ts` | criar/editar com matrícula e setor; campos antigos intactos; 400 para valor longo/NUL (POST e PATCH); matrícula de exatamente 30; campo desconhecido -> 400; `tenant_id` de outro tenant no corpo não cria no tenant do corpo (prova também o achado da seção 12) |
| `epi-ficha-data.e2e-spec.ts` | só movimentações reais em ordem, CPF mascarado e nunca 11 dígitos; estornada/estorno visíveis; legado sem quantidade; filtros e datas inválidas; filtro de assinatura só alcança entrega/troca; isolamento e papéis; legado + filtro; 401; matrícula/setor nulos ou preenchidos; limite de linhas (400); `delivered_at` e `occurred_at` (data pura, sem offset) no dia de São Paulo |
| `epi-ficha-pdf.e2e-spec.ts` | prévia 200 `application/pdf` sem cache com "NÃO EMITIDO"; não grava em `epi_ficha_documents`; 404 outra empresa; 400; 401 |
| `epi-ficha-issue.e2e-spec.ts` | versões 1..n; hash confere; idempotência (200 e 409); 8 emissões concorrentes consecutivas; documento antigo imutável após mudar cadastro; verify íntegro/divergente/ausente; falha do R2 -> 502 sem registro nem versão consumida; falha do INSERT remove o arquivo; download (bytes, cabeçalhos, outra empresa 404, arquivo ausente 404); PDF "Pendente" sem selo e "Registrada presencialmente"; entradas inválidas; rotas inexistentes; data de SP no código; `file_key` distinto; colisão de código; PUT pendurado -> 502 < 2 s; `lock_timeout` -> 503; a trava não bloqueia entrega; mesma chave em paralelo; `getObject` com erro genérico -> 502 e verify nunca "íntegro"; chave igual em empresas distintas; PUT e delete pendurados -> 502 limitado; INSERT falho com delete pendurado; `getObject` pendurado -> 502 < 2 s e pool livre (12 downloads); parceiro não vinculado 404 (403 por papel não se aplica: os 4 papéis estão em todas as rotas) |
| `epi-ficha-permissions.e2e-spec.ts` | empresa B 404; técnico não vinculado 404; técnico/parceiro vinculados e admin operam; tenant do documento = tenant do funcionário mesmo com admin; 400/401; PATCH/PUT/DELETE -> 404 |

Resultados reportados nos relatórios das tarefas (NÃO reexecutados aqui): Task 1 (schema + employees) 6 suites / 46 passed no ensaio; Task 4 unit (`canonical-json`, `epi-ficha-pdf`) 14 passed e e2e issue + permissions 19 passed na primeira rodada (o e2e de emissão cresceu depois, para 22 casos nas rodadas de correção); `tsc --noEmit` e `nest build` sem erro nos relatórios das Tasks 1 e 4. Baseline do unit no ensaio: só `r2-get-object` falha, por não haver R2.

### Como rodar (somente ensaio descartável)
- **Nunca contra produção.** Os e2e criam e apagam dados reais no banco apontado. Não usar `run-backend-tests.sh` para e2e (ele carrega o `.env` e aponta para o ambiente principal). Use o ensaio isolado (Postgres+Redis descartáveis em rede própria, migrations aplicadas em ordem **até a 0082**, chaves falsas), conforme a memória do projeto `reference_ensaio_descartavel_isolado`. Os scripts do ensaio não estão no repositório.
- **R2 sempre mockado** (o spec de emissão sobrescreve o `R2Service`); nunca credencial real de R2.
- Jest com `--config ./test/jest-e2e.json --runInBand --forceExit`, imagem glibc (`node:20-bookworm-slim`), `NODE_ENV=test`, `TEST_SUPERUSER_DATABASE_URL` apontando para o banco do ensaio.
- **O e2e completo precisa de lotes** (a suíte inteira num processo estoura memória) **e de `RATE_LIMIT_MAX` alto** no ambiente do ensaio (padrão 300 do guard global; muitas requisições por lote chegam ao limite).
- Unit: `npm run test:unit` (ou `/opt/Montese/run-backend-tests.sh test:unit`) não usa banco de e2e.

## 9. ROLLBACK

Arquivo de origem: scratchpad da sessão (`0082.down.sql`). Foi testado: aplicado sobre o schema pós-0082 em banco descartável, o schema voltou **idêntico** ao pré-0082 (relatório da Task 5 no ledger); a 0082 é reaplicável depois. **Recusa executar se existirem documentos emitidos** (não destrói evidência). NÃO VERIFICADO em produção. Fazer backup antes. Observação: ele remove a coluna `department` (e qualquer setor já digitado); `registration_number` não é tocado.

```sql
-- Rollback manual da 0082 (EPI: documentos emitidos da ficha + setor do funcionário).
-- Recusa executar se já houver documento emitido (para não destruir evidência).
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM epi_ficha_documents) THEN
    RAISE EXCEPTION 'rollback recusado: existem documentos emitidos em epi_ficha_documents';
  END IF;
END $$;
DROP TABLE epi_ficha_documents;
DROP FUNCTION epi_ficha_documents_immutable();
ALTER TABLE employees DROP CONSTRAINT chk_employees_department_len, DROP COLUMN department;
DELETE FROM _migrations WHERE name = '0082_epi_ficha_documents.sql';
COMMIT;
```

Se a numeração mudar no merge, ajustar o `name` no último `DELETE`. Depois de emitir documentos, o rollback não vale: a correção é emitir nova versão, não desfazer a migration.

## 10. Ordem de release e riscos

Ordem RECOMENDADA:
1. **A 0081 antes da 0082** (a 0082 usa `epi_tenant_row_exists`). Ver `epi-estoque.md`, seção 9 (consulta de duplicidade da 0081, backup, papéis).
2. **Backup** antes de aplicar.
3. **Numeração**: o arquivo é `0082`; confirmar frente à `0080` da branch `feat/tabela-oficial-funcionarios` (não mesclada), e à 0081, e renumerar se necessário no merge (a 0079 está em produção). Ajustar também o `DELETE` do rollback.
4. Aplicar a migration, depois o backend. Backend novo sem a 0082 quebra (`department` e a tabela não existem); migration sem backend novo é inofensiva (aditiva).
5. Conferir que a imagem do backend inclui `dist/src/common/pdf/assets/*` (ativos copiados pelo `nest-cli.json`). NÃO VERIFICADO em build de imagem real.

Riscos: a 0082 roda como `montese_app` e usa `REVOKE TRUNCATE ... FROM montese_app` e a função da 0081 (VERIFICADO no ensaio; NÃO VERIFICADO em produção, depende dos papéis reais). Colisão de numeração (item 3).

## 11. Limitações conhecidas e decisões pendentes do proprietário

1. **Termo é rascunho** (`rascunho-1`): precisa de revisão jurídica do proprietário antes de uso definitivo. O PDF e o registro declaram o rascunho. RECOMENDADO (da spec): permitir emitir com o termo impresso como rascunho até a aprovação.
2. **Objetos órfãos no R2**. Dois caminhos podem deixar arquivo sem registro: (a) falha do `COMMIT` da transação depois do INSERT já executado (o arquivo existe e o registro não); (b) PUT tardio que chega ao R2 depois do timeout e do delete best-effort. Inofensivo (chave única por UUID, privada), mas ocupa espaço. **Não há reconciliação implementada.** RECOMENDADO: rotina (script de operação) que lista `tenants/*/epi-fichas/` no R2 e apaga o que **não** tem `file_key` correspondente em `epi_ficha_documents` e tem idade maior que N horas (N maior que o pior caso de uma emissão, p.ex. 24 h); rodar primeiro em modo listagem.
3. **Leitura do R2 em download e verify** agora ocorre FORA da transação (`findDocumentRef` no banco, depois `readDocumentBytes` com prazo `EPI_FICHA_R2_TIMEOUT_MS` -> 502): R2 pendurado não prende o pool (coberto por e2e com 12 downloads simultâneos).
4. **Funcionário com ficha não pode ser apagado** (`employee_id` RESTRICT). A resposta de `employees.service.ts` ao `23503` usa a mensagem genérica de CIPA ("...já foi candidato em uma eleição da CIPA") para qualquer FK que não seja a de treinamento, o que é enganoso para funcionário com ficha ou movimentações. Retenção da ficha e a decisão LGPD (apagar vs. reter) são do proprietário.
5. **Sem FK composta `(employee_id, tenant_id)`** (seção 2.2): a integridade tenant×funcionário depende do serviço e da RLS.
6. **Rodapé de marca só na ficha**: `drawBrandFooter` é reutilizável, mas adotá-lo nos PDFs de visita e da ata da CIPA muda módulos fora deste subsistema e é decisão separada.
7. **Foto `1.jpg`** (EPIs, 1024x606) fornecida pelo proprietário **não é usada** no PDF nem está no repositório (NÃO VERIFICADO se o arquivo foi copiado; o código não a referencia).
8. **Tamanho do PDF (~780 KB)**: reduzir logo/rodapé é decisão do proprietário (seção 4).
9. **Matrícula e setor sem tela** até o subsistema 4: só são graváveis por API (`POST/PATCH /employees`) e a matrícula também pelo eSocial. A importação de funcionários não ganhou coluna de setor (fora de escopo).
10. **Caracteres fora do WinAnsi** renderizam mal (seção 4).
11. **503 sem `Retry-After`** e testes que alteram `process.env` (rodam em série); erro `23514` no INSERT viraria 500 (inalcançável por entrada do cliente). Minors adiados.
12. **Ordem de empates** por UUID (3.1) e linha de tabela maior que a página (seção 4): minors adiados.
13. **Sem retenção/arquivamento**: documentos emitidos e arquivos do R2 não têm prazo nem rotina de expurgo.
14. **DTOs de employees agora com validadores reais** (seção 12): mudança de contrato visível para quem usa `POST/PATCH /employees`.

## 12. Achado fora do escopo — POST/PATCH /employees

**Fato verificado em e2e do ensaio**: `CreateEmployeeDto` e `UpdateEmployeeDto` não tinham nenhum decorator de `class-validator`. O `ValidationPipe` global (`configureApp`: `whitelist` + `forbidNonWhitelisted`) trata como inexistente toda propriedade de um DTO sem decorator e rejeita todas elas. Provado em e2e que usa `configureApp`: `POST /employees` com `full_name` -> 400 `property full_name should not exist`. Os e2e antigos de employees **não chamam `configureApp`**, por isso nunca viram o problema.

**O que esta entrega fez**: uma primeira versão aplicou `@Allow()` (só marca a propriedade como conhecida, não valida), mas isso liberava 500 em `POST/PATCH /employees` (CPF repetido 23505, CPF com máscara 22001, datas inválidas, status fora do enum, UUID inválido, NOT NULL). A versão final usa **validadores reais de class-validator**:
- `full_name`: string, 1 a 200, sem NUL, apara as pontas; `cpf`: remove não-dígitos (aceita `123.456.789-09`, grava só os 11 dígitos) e exige `^\d{11}$`;
- `birth_date`/`admission_date`: `AAAA-MM-DD` estrito (`DATE_ONLY` + `IsISO8601 strict`); `position` até 120, sem NUL; `company_unit_id`/`position_id`/`tenant_id`: UUID (`''` vira null); `status` em `ativo|inativo|pendente`;
- `registration_number` (até 30) e `department` (até 120): sem NUL, apara e vazio/só espaços vira null;
- no PATCH tudo é opcional; `null` só nos campos anuláveis (limpa o campo); `full_name`, `cpf` e `status` não aceitam null.
O serviço mantém as checagens (defesa em profundidade) e traduz erros do Postgres: 23505 -> 409 ("CPF já cadastrado nesta empresa" quando a constraint é a do CPF), 22P02/22001/22007/22008/22003/23502/22021/23514 -> 400 "Dados inválidos", sem expor texto do pg. O controller repassa `registration_number` e `department`. Frontend (só leitura): o onboarding (`FuncionariosForm.tsx`) envia `full_name`, `cpf` (possivelmente com máscara), `position` (ou omitido) e `company_unit_id` (string, possivelmente vazia): todos continuam aceitos.

**NÃO VERIFICADO**: se a produção (`/opt/Montese`, commit `8b9e5bf`) está de fato rejeitando `POST/PATCH /employees`. O frontend chama `POST /api/employees` no onboarding (`FuncionariosForm.tsx`; não reconferido aqui). Pode ser que o app de produção monte o pipe de outra forma ou que o bug seja real e passe despercebido.

**RECOMENDADO** ao proprietário: conferir em ambiente seguro (ensaio ou cópia, nunca com dados reais) se `POST /employees` com o corpo do onboarding retorna 400 na versão em produção. Se confirmado, tratar como **correção independente** e urgente (o cadastro de funcionário no onboarding estaria quebrado), sem esperar o release do módulo EPI. Se o bug existir, a correção desta entrega é a mesma.

---
Ao integrar, acrescentar a linha apontando para `epi-ficha.md` (e `epi-estoque.md`) em `docs/architecture/README.md`.
