# Módulo EPI — Subsistema 3: assinatura eletrônica mobile (design)

Data: 2026-10-15. Status: **implementado e testado no ensaio descartável; não commitado** (nada em produção). O texto abaixo descreve o desenho original; onde a implementação difere, vale a seção final "Decisões e desvios da implementação" e `docs/architecture/epi-assinatura.md`.
Rótulos: VERIFICADO (lido no código), RECOMENDADO (proposta), NÃO VERIFICADO.
Depende dos subsistemas 1 (livro/estoque, migration 0081) e 2 (ficha/PDF, migration 0082), no worktree `/opt/montese-epi` (`feat/epi-estoque`), ainda sem commit.

## Escopo

Entrega: link de assinatura de uso único com código curto, página pública mobile de assinatura (Next.js), registro de evidência imutável, recusa, expiração, revogação, assinatura presencial alternativa, comprovante em PDF e integração com a ficha (status e anexo de comprovantes).

Fora de escopo: envio do link por e-mail/WhatsApp/SMS (o funcionário não tem contato cadastrado); telas do responsável (registrar entrega, exibir o QR, menu EPI, dashboard — subsistema 4); página pública de verificação de documento; certificação ICP-Brasil ou provedor de assinatura (ponto de extensão apenas); nada de produção.

## Estado atual (VERIFICADO)

- `employee_epi_deliveries` tem `signature_status` (`legado`, `pendente`, `assinada`, `recusada`, `expirada`, `presencial`, `estornada`), `signed_by_name`, `signed_at`; entregas do livro nascem `pendente` (subsistema 1). A ficha e o PDF já mostram o status (subsistema 2).
- Rotas públicas existem (`@Public()`), com `@RateLimit({limit, windowSeconds, keyBy: 'ip'|'ip-email'})`. O reset de senha usa funções `SECURITY DEFINER` de dono `montese_auth_bypass` (BYPASSRLS) e token com finalidade; o padrão `auth_*` é o modelo.
- `employees` **não tem telefone nem e-mail**; só `users` tem. `EmailService` (Resend) existe; não há WhatsApp/SMS.
- Frontend: páginas públicas em `frontend/src/app/(site)/` (ex.: `redefinir-senha`); sem biblioteca de assinatura desenhada.
- `pdfkit`, `R2Service`, `brand-footer.util.ts` e o padrão de emissão imutável com hash existem (subsistema 2).

## Decisões do proprietário (2026-10-15)

1. **Entrega do link**: link + QR code mostrados ao responsável no ato da entrega; o funcionário lê o QR com o próprio celular ou recebe o aparelho. Sem dado pessoal novo e sem infraestrutura de envio.
2. **Identificação**: código curto de 6 dígitos de uso único, mostrado ao responsável uma única vez e repassado ao funcionário presente, **mais** aceite explícito. A evidência afirma com franqueza que o desenho + código não prova identidade por si só.
3. **Escopo**: backend + página pública de assinatura. Telas do responsável ficam no subsistema 4.
4. **Padrões aprovados**: expiração de **24 h**, **5 tentativas** de código, comprovante em **PDF** de 1 página.
5. **Termo em rascunho**: a assinatura com termo `draft` fica **bloqueada em produção** (variável `EPI_SIGNATURE_ALLOW_DRAFT_TERM`, padrão `false`; testes ligam `true`) até o proprietário aprovar o texto — RECOMENDADO e aceito na aprovação do desenho; confirmar na revisão desta spec.

## Abordagem

Funções `SECURITY DEFINER` no banco, sem sessão (padrão `auth_*`): cada chamada pública leva token e código e o banco os confere de novo. Rejeitadas: JWT de sessão curta após o código (mais um token, pouco ganho) e papel de banco dedicado (mexe em infraestrutura de banco).

## Modelo de dados (migration 0083; numeração a confirmar)

Aditiva.

**`epi_signature_requests`**: `id`, `tenant_id`, `employee_id` (FK RESTRICT), `token_hash` (SHA-256 hex, único), `pin_hash` (HMAC-SHA256 hex com chave = token e mensagem = código: sem segredo de servidor, e o código não é quebrável offline sem o token, que só existe em hash), `status` (`ativa`, `assinada`, `recusada`, `expirada`, `revogada`, `bloqueada`), `attempts` (int), `expires_at`, `term_version`, `term_text_sha256`, `created_by_user_id`, `created_at`, `used_at`. **`epi_signature_request_items`**: (`request_id`, `delivery_id`) — uma requisição cobre N entregas pendentes do mesmo funcionário e empresa (CHECK por trigger/função: mesmo `employee_id`, status `pendente`). Só o hash do token e do código é guardado; os valores em claro existem apenas na resposta de criação.

**`epi_signatures`** (imutável): `id`, `tenant_id`, `request_id` (único), `employee_id`, `signed_at`, `accepted` (true), `accepted_at`, `term_version`, `term_text_sha256`, `items_snapshot` (JSONB: descrição, CA, quantidade, data de cada entrega; nunca CPF), `signature_file_key`, `signature_sha256`, `ip`, `user_agent` (truncado), `code_verified` (true), `evidence_sha256` (SHA-256 do JSON canônico do registro de evidência, incluindo `signature_sha256`), `receipt_code` (legível, único), `receipt_file_key`, `receipt_sha256`.

Trigger de imutabilidade e `REVOKE TRUNCATE` (padrão 0081/0082), RLS + FORCE RLS com a policy padrão do módulo, índices por `tenant_id`. Grants mínimos a `montese_auth_bypass` nas tabelas que as funções tocam (`epi_signature_*`, `employee_epi_deliveries` UPDATE, `employees`/`tenants` SELECT); a numeração do `GRANT ... TO montese_app` segue o padrão das migrations anteriores (migração rodando como `montese_app`: VERIFICADO no subsistema 1).

**Funções SQL** (`SECURITY DEFINER`, `search_path` fixo, dono `montese_auth_bypass`, `REVOKE ALL ... FROM PUBLIC`, `GRANT EXECUTE` a `montese_app`): `epi_sig_peek(token_hash)` (só devolve o nome da empresa e se o link está utilizável), `epi_sig_open(token_hash, pin_hash)` (conta tentativa, bloqueia na 5ª, devolve nome do funcionário e itens), `epi_sig_sign(...)` (grava evidência e atualiza entregas, tudo sob `FOR UPDATE` da requisição), `epi_sig_refuse(...)`. Respostas de falha não distinguem inexistente, expirado, usado ou revogado.

## Regras

- **Criação** (responsável autenticado: `empresa`, `tecnico`/`parceiro` vinculados, `admin`): para um funcionário e uma lista de entregas pendentes dele (ou todas as pendentes); revoga requisições `ativa` anteriores do mesmo funcionário que compartilhem entregas; gera token de 256 bits (base64url) e código de 6 dígitos; devolve **uma vez** `{ url, qr_payload, code, expires_at }` (QR é renderizado pelo frontend do subsistema 4; a spec devolve o conteúdo do QR). A URL não contém CPF nem nome. Idempotency key obrigatória (repetição devolve 409 'link já emitido; revogue e gere outro': o código em claro não é recuperável).
- **Página pública** (`/assinar/<token>`): antes do código só mostra o nome da empresa. Com o código correto mostra nome do funcionário (sem CPF), itens, quantidades, CA, datas e o termo; exige aceite explícito e desenho não vazio; mostra o comprovante ao final. Recusar é possível, com motivo opcional (texto livre limitado, sem NUL).
- **Tentativas**: 5 códigos errados → `bloqueada`; limite de requisições por IP e por token; mesma resposta para qualquer falha de link.
- **Expiração**: 24 h; expira de forma preguiçosa (na consulta) e por rotina; entregas continuam `pendente` (a requisição vira `expirada`; o status `expirada` da entrega é aplicado quando a requisição expira sem substituta — RECOMENDADO, decidir no plano).
- **Assinatura**: PNG ≤ 200 KB, assinatura de magic bytes `\x89PNG`, dimensões máximas, rejeita imagem vazia (canvas em branco) pelo servidor; guardada no R2 com chave `tenants/<t>/epi-signatures/<uuid>.png`; grava evidência + comprovante PDF e atualiza as entregas para `assinada` (`signed_at`, `signed_by_name` = nome do funcionário) na mesma transação; falha do R2 → erro sem registro.
- **Termo**: `term_version` e SHA-256 do texto aceito entram na evidência; o termo rascunho só permite assinatura com `EPI_SIGNATURE_ALLOW_DRAFT_TERM=true`.
- **Assinatura presencial** (alternativa para funcionário sem celular): rota autenticada que marca entregas pendentes como `presencial`, exigindo nome da testemunha e motivo, registrando autor e data (sem imagem, sem evidência eletrônica); auditoria.
- **Recusada/expirada/pendente**: o responsável escolhe gerar novo link, registrar presencial ou estornar a entrega (já existente).
- **Comprovante**: PDF A4 de 1 página (empresa, funcionário com CPF mascarado, itens, data/hora, código do comprovante, hash da evidência, rodapé de marca), guardado no R2 com hash; baixável pelo responsável (autenticado).
- **Ficha**: linhas `assinada` mostram data/hora e `receipt_code`; as imagens de assinatura entram só num anexo "Comprovantes de assinatura" no PDF emitido, apenas para entregas com evidência (sem evidência: nenhuma imagem/selo). Sem alegar ICP-Brasil.
- **LGPD**: a página pública só expõe dados após o código; resposta com `Cache-Control: no-store`; nenhum log de token, código ou imagem; IP e user-agent só na evidência.

## API

Pública (`@Public()`, `@RateLimit`): `GET /epi-signatures/public/:token` (peek), `POST /epi-signatures/public/:token/open` {code}, `POST /epi-signatures/public/:token/sign` {code, accepted, signature_png_base64, term_version}, `POST /epi-signatures/public/:token/refuse` {code, reason?}.
Autenticada: `POST /epi-signatures/requests` {employee_id, delivery_ids?, idempotency_key}, `GET /epi-signatures/requests?employee_id=`, `POST /epi-signatures/requests/:id/revoke`, `POST /epi-signatures/in-person` {delivery_ids, witness_name, reason}, `GET /epi-signatures/:id/receipt.pdf`.
DTOs com `whitelist` + `forbidNonWhitelisted`, ids com `ParseUUIDPipe`, entrada inválida nunca vira 500; `configureApp` nos e2e.

## Frontend

`frontend/src/app/assinar/[token]/page.tsx` (fora do grupo `(site)` para não carregar o cabeçalho do site): mobile-first, canvas próprio com eventos de ponteiro, acessível (rótulos, foco, contraste), estados (carregando, link inválido/expirado, código errado, bloqueado, itens/termo, aceite, assinado, recusado), botão "Limpar", sem dependência nova. Testes de componente com a infraestrutura do frontend existente.

## Testes (ensaio descartável; R2 sempre mockado)

Schema/imutabilidade/RLS/TRUNCATE; criação (token/código só em claro na resposta; hash no banco), revogação e idempotência; abertura com código certo/errado, bloqueio na 5ª tentativa, concorrência de tentativas; resposta uniforme para link inexistente/expirado/usado/revogado; assinatura válida (evidência, entregas `assinada`, comprovante, hash), reutilização do link (409/uniforme), expirada, recusada; assinatura simultânea (uma vence); imagem inválida/vazia/grande; termo rascunho bloqueado por padrão; presencial; isolamento entre empresas e permissões; rate limit; ficha/PDF com anexo só quando há evidência; sem CPF/token/código em logs ou respostas; regressão dos subsistemas 1 e 2.

## Riscos e pontos em aberto

- Texto do termo depende de revisão jurídica; a assinatura fica bloqueada em produção com termo rascunho.
- Validade probatória: assinatura eletrônica simples com evidências; não equivale a ICP-Brasil; identificação limitada ao código repassado pelo responsável.
- Primeira rota pública que expõe dados de funcionário: exige revisão de segurança dedicada e limite de requisições.
- Migration 0083 depende da ordem de release (0081 → 0082 → 0083) e da numeração frente à `0080`.
- O código só existe em claro na resposta de criação: perdido, o link precisa ser revogado e regerado.
- Nada deste subsistema foi implementado ou testado ainda.

## Critérios de aceitação

1. O funcionário assina no celular, com código e aceite explícito; a evidência fica vinculada às entregas exatas.
2. Link de uso único, expirável, revogável; força bruta de código limitada; respostas sem sondagem.
3. Evidência imutável com hashes; comprovante em PDF; ficha mostra o status correto e o anexo só com evidência.
4. Recusa, expiração, presencial e estorno tratados; estoque coerente.
5. Isolamento e permissões comprovados por testes; testes dos subsistemas anteriores continuam verdes; build e typecheck limpos.

## Decisões e desvios da implementação

Status da implementação: **implementado e testado no ensaio; não commitado**. Detalhes, fontes e rótulos em `docs/architecture/epi-assinatura.md`. Onde esta seção contradiz as seções acima, vale esta.

1. **Token no fragmento e rotas `POST`.** O link é `<PUBLIC_APP_URL>/assinar#token=<token>` (não `/assinar/<token>`), e as rotas públicas são `POST /epi-signatures/public/{peek,open,sign,refuse}` com token e código **no corpo** (não `GET .../:token`). O fragmento não vai ao servidor nem a logs de acesso; a página o remove da URL ao ler. Não existe `frontend/src/app/assinar/[token]/page.tsx`: a página é `frontend/src/app/assinar/page.tsx`.
2. **Comprovante sob demanda.** O PDF é gerado a cada `GET /epi-signatures/:id/receipt.pdf` a partir da evidência gravada; **não é guardado no R2** e não há `receipt_file_key` nem `receipt_sha256`. A imagem da assinatura não é embutida no comprovante (só na ficha emitida). O `:id` é o da assinatura (`epi_signatures`).
3. **`accepted_at` não existe.** `signed_at` é o instante do aceite e da assinatura.
4. **A entrega continua `pendente` quando o link expira.** O status `expirada` da entrega não é aplicado; só a requisição vira `expirada`, e de forma preguiçosa (na consulta). Não há rotina agendada.
5. **Presencial com tabela estruturada própria.** `epi_in_person_signatures` e `epi_in_person_signature_items` (imutáveis, RLS, `UNIQUE(delivery_id)`) guardam autor, testemunha, motivo e data; entraram na própria 0083 (reaberta, ainda não aplicada em produção) em vez de uma 0084. `signed_by_name` continua sendo o **nome do funcionário** também no presencial; o sinal é `signature_status = 'presencial'`. Não aparece no instantâneo da ficha e não tem comprovante.
6. **PNG canônico e canvas 600x200.** O validador regrava um PNG canônico (filtro 0) e só ele vai ao R2 e é hasheado (`signature_sha256` é do canônico). Entrada de até 200 KB, RGBA 8 bits, mínimo 50x30, **teto 1200x600** (a spec dizia "dimensões máximas" sem valor; o primeiro desenho usava 2000x1000), canvas interno **fixo 600x200**, fundo transparente, traço preto, >= 20 pixels visíveis. Motivo: PNG com byte de filtro inválido derrubava o Node via `pdfkit`/`png-js` (VERIFICADO pelo revisor).
7. **Rate limit público 120/200.** `open`, `sign`, `refuse`: 120 por 10 minutos por IP; `peek`: 200. O desenho inicial (20) foi descartado por bloquear mutirão no mesmo Wi-Fi/NAT. A defesa contra força bruta é o bloqueio persistente do link em 5 tentativas (5e-6 por link).
8. **Orçamentos da ficha.** Anexo de imagens: até 100 imagens, 12 megapixels, 30 MB lidos, objeto > 2 MB indisponível; imagens só na emissão (a prévia não lê o R2); `EPI_FICHA_LOCKED_BUDGET_MS` (15 s) limita a seção sob a trava do funcionário; `probeSafePng` protege o `pdfkit`. A spec dizia "1 página" para o comprovante: o PDF é A4 com cabeçalho/rodapé de marca e "Página X de Y", sem garantia de página única.
9. **Guards e GRANTs por coluna.** Trigger `epi_sig_items_guard` (entrega pendente, mesmo tenant e funcionário, requisição ativa; itens de requisição encerrada imutáveis); trigger `epi_signatures_insert_guard` (INSERT só pelo dono das funções, porque `montese_app` herda os privilégios de `montese_auth_bypass`); `REVOKE INSERT, UPDATE ON epi_signatures FROM montese_app`; `GRANT SELECT (id, full_name)` em `employees` (sem CPF) e `UPDATE` por coluna em requisições e entregas para `montese_auth_bypass`. LIMITE herdado de `auth_*`: `SET ROLE montese_auth_bypass` contorna RLS e guards.
10. **Funções internas.** Além das 4 públicas (`epi_sig_peek`, `epi_sig_open`, `epi_sig_sign`, `epi_sig_refuse`), existem `epi_sig_check` (trava a requisição, confere token/código, conta tentativas) e `epi_sig_items` (itens no formato da evidência), com `REVOKE` explícito de `montese_app` (efetivo só na ACL; ver limite acima). `epi_sig_items` é `VOLATILE`. A evidência é montada e hasheada **no banco** (`digest(evidence_payload::text, 'sha256')`, pgcrypto); `jsonb::text` não é RFC 8785.
11. **Expiração e bloqueio.** 24 h; 5 tentativas; `bloqueada` é persistente (inclusive o código ausente conta como tentativa errada); resposta uniforme `Link inválido ou expirado` (404) para inexistente/expirado/usado/revogado; bloqueado responde 403. Criar novo link para as mesmas entregas revoga o anterior; uma entrega só pertence a uma requisição ativa. O link criado com versão antiga do termo vira 404 quando o termo vigente muda.
12. **Termo em rascunho bloqueia criação e assinatura** em produção (`EPI_SIGNATURE_ALLOW_DRAFT_TERM` ausente ou diferente de `true`); recusar não é bloqueado.
13. **Outros desvios.** `EPI_SIGNATURE_LOCK_TIMEOUT_MS` (padrão 5000) para a criação/presencial; limite de corpo de 300 KB só em `/epi-signatures/public` (`app-setup.ts`); `Cache-Control: no-store` em todas as respostas públicas e na criação; `epi_signature_requests` ganhou `idempotency_key` (criação repetida -> 409, o código em claro não é recuperável); `refuse` responde 401 sem `attempts_left`; elegíveis só entregas com quantidade.
14. **Onda final (revisão final do subsistema).** (I-1) Garantias por trigger: `assinada` só por `epi_sig_*`/superusuário; `assinada`/`presencial` só saem para `estornada`; `presencial` exige registro presencial; `epi_signature_requests` com campos imutáveis, `attempts` só cresce, status só sai de `ativa`, a aplicação só revoga e DELETE direto é recusado (cascata de tenant permitida). Isso protege contra BUG e contra a aplicação comum, **não contra a credencial comprometida**: `montese_app` é dona das tabelas e pode `DISABLE TRIGGER`/`DROP POLICY`; separar as roles de migração e de runtime é RECOMENDADO. (I-2) `sign` consulta `epi_sig_peek` antes de decodificar/validar o PNG (404 uniforme; link bloqueado também responde 404 no `sign`). (I-3) `epi_sig_open` devolve `term_text_sha256` e a assinatura exige igualdade com o hash do termo vigente (404 uniforme); teste fixa o par versão -> hash. (I-4) O presencial depende de `EPI_SIGNATURE_ALLOW_DRAFT_TERM` (mesmo 409) e grava `term_version`. Guards de mesmo tenant/funcionário/status nos itens presenciais. Limites: canônico 256 KB, total lido do R2 por ficha 8 MB. Rollback endurecido (recusa também com registros presenciais; schema idêntico provado). Pendências aceitas: ver `docs/architecture/epi-assinatura.md` seção 18.

