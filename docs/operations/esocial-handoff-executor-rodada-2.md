# eSocial SST — Hand-off para o executor (Cline + MiniMax) — Rodada 2

> **Para:** quem executa o plano `2026-09-29-esocial-sst-subprojeto1.md` na worktree `esocial-sst-subprojeto1`.
> **De:** revisão do proprietário/Claude, 2026-10-04. **Base:** `docs/audits/auditoria-esocial-2026-10-04.md` (achados E-xx, lacunas G-xx).
> **Contrato de entrega:** `docs/operations/checklist-revisao-esocial.md` (seções 0 e 1). **Regras gerais:** `AGENTS.md`.
> Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO. Afirmar que algo funciona sem rodar é proibido.

## 0. Leia antes de começar

**Esta rodada é só de correção e fortalecimento da base (tasks 1 a 12).** Não avance para as tasks 13 a 23.

**Está BLOQUEADO até decisão do proprietário — não faça:**

- **E-01 (renumerar migrations)** e **E-02 (chave `ESOCIAL_CERT_ENCRYPTION_KEY` obrigatória × opcional):** dependem de decisões em aberto.
  Não renumere, não altere `env.validator.ts`, `docker-compose.yml` nem `.env.example`.
- **G-01 a G-04 (lacunas do plano):** o desenho está **aprovado** (`docs/superpowers/specs/2026-10-04-esocial-lacunas-g01-g04-design.md`, seção 9.1),
  mas **não é para implementar nesta rodada**: vira hand-off próprio (tasks 12b, 12c, 18a) depois que esta rodada for revisada e as decisões abertas da seção 9.2 forem fechadas.
  Não implemente endpoints de evento, tela, nem preenchimento de matrícula/CBO/CNAE.

**Proibido nesta e em qualquer rodada** (AGENTS.md):

- `git push`, `reset`, `revert`, `rebase`, reescrita de histórico, commit na `main`. Commits só na branch `worktree-esocial-sst-subprojeto1`, só do que a rodada pede, com `git add <arquivos>` explícito.
- **Apagar teste para o build passar.** Dois testes foram apagados sem commit (E-03): restaure-os (seção 1.1).
- Segredo em código, log, teste, fixture ou resposta. Certificado de teste = **gerado**, senha de teste óbvia, nunca certificado real.
- Alterar Docker, compose, Nginx, TLS, DNS, backups ou produção. Criar role de banco ou usar superusuário fora do **banco de ensaio descartável**.
- **Ler credenciais de produção** (`docker exec ... echo $POSTGRES_PASSWORD`, `$JWT_SECRET`, `$REDIS_PASSWORD` etc.) ou copiá-las para arquivo. Em 2026-10-04 22:54 UTC o script `/tmp/run-cert-e2e.sh` fez isso e rodou e2e no banco de produção (achado **E-18**). **Nunca mais.** E2E só em **clone descartável do banco + Redis descartável**, com JWT e chaves **falsos de formato válido**, sem `GOOGLE_*` reais (use valores falsos), e sempre com `--forceExit` e limite de tempo. Se não houver clone, escreva **NÃO VERIFICADO** e peça ao proprietário.
- Rodar e2e contra o Postgres de produção, `docker compose down -v`, ou transmitir ao eSocial **real**.
- Mudar provider ou modelo de IA. Inventar norma, prazo, leiaute ou URL.

**Pare e pergunte** se: um teste falhar duas vezes pelo mesmo motivo; uma correção exigir alterar migration **já aplicada** em algum banco compartilhado;
uma tarefa pedir tocar fora de `backend/src/esocial`, `backend/src/aso`, `backend/db/migrations` (das 5 do eSocial) e `backend/test`.

## 1. Tarefas da rodada (ordem obrigatória)

Cada tarefa: **teste vermelho primeiro (RED)**, correção, teste verde (GREEN), saída real colada no relatório.

### 1.1 — E-03 · Restaurar os testes apagados (primeiro de tudo)

- Restaurar `backend/test/esocial-layout-versions.unit-spec.ts` (`git checkout -- <arquivo>`): confere que a migration `0061` traz a URL de **Produção Restrita** verificada e **nenhuma URL de Produção real** como fato.
- Recriar `esocial-events-rls.e2e-spec.ts` **compilando**: adicionar a `db-test-helper.ts` os helpers que faltam (`insertRawRow`, `getActiveLayoutVersionId`,
  e login real via `/auth/login` no lugar de `tenant.token`, como já feito em `certificates-service.e2e-spec.ts`).
- **Aceite:** `npx tsc --noEmit` **exit 0 com os dois arquivos presentes**; `nest build` exit 0; o e2e de RLS de eventos prova que o tenant A **não** lê evento do tenant B (**404, não 403**), com sanity check.

### 1.2 — E-04 · `pkcs12.util`: certificado correto, chave correta

Problemas: pega `certBags[0]` (a cadeia ICP-Brasil pode vir em qualquer ordem); só aceita `pkcs8ShroudedKeyBag`; não valida o certificado.

- Escolher o **certificado da folha**: o que casa com a chave privada (por `localKeyId` ou comparando o módulo/expoente da chave pública), não o primeiro.
- Aceitar `keyBag` (chave sem cifra interna) além de `pkcs8ShroudedKeyBag`.
- Rejeitar (com `InvalidCertificateError` e mensagem clara, **sem vazar a senha**): chave RSA < 2048 bits; certificado ainda não válido (`notBefore` futuro);
  `keyUsage` presente sem `digitalSignature`. **Não** invente regra de ICP-Brasil que não esteja no spec (INFERIDO → registrar, não travar).
- **Testes novos (fixtures geradas por `node-forge` no próprio teste, nunca arquivo real):**
  1. PFX com **cadeia** (folha + CA intermediária) com a CA **antes** da folha → extrai a folha (thumbprint e CN da folha).
  2. PFX com `keyBag` sem cifra interna → aceito.
  3. Chave de 1024 bits → rejeitada.
  4. Certificado com `notBefore` futuro → rejeitado.
  5. Senha errada → rejeitada e a mensagem **não contém** a senha.
- **Aceite:** os 3 testes atuais de `pkcs12-util` continuam verdes + os 5 novos.

### 1.3 — E-05 · Certificado expirado não pode ser usado

- `loadRawPfxForTransmission` e `loadForSigning` devem recusar certificado com `not_after <= now()` (mesmo com `status='ativo'`), com erro claro e **sem decifrar** nada antes.
- `list` deve devolver o status efetivo (`expirado` quando `not_after` passou) **sem** precisar de cron para estar correto.
- **Testes:** (a) certificado com `not_after` no passado inserido por fixture → `loadForSigning` lança; (b) o R2 **não** é consultado nesse caso (mock com contagem de chamadas = 0);
  (c) `list` marca `expirado`.
- **Aceite:** testes verdes; nenhum caminho decifra certificado vencido.

### 1.4 — E-06 · ASO: integridade entre tenants

Chave estrangeira ignora RLS: hoje `employeeId` e `pcmsoPhysicianId` de **outro tenant** passam.

- Em `AsoService.createRecord`: antes do `INSERT`, `SELECT` do funcionário **e** (se informado) do médico **sob o mesmo contexto de tenant** (RLS os esconde de outro tenant).
  Se não encontrar → `404 Funcionário não encontrado` / `404 Médico não encontrado` (a **mesma** mensagem para "não existe" e "é de outro tenant", para não virar oráculo de existência).
- Validar também `GET /aso/records?employeeId=` com `ParseUUIDPipe` (UUID inválido → 400, não 500).
- **Testes e2e:** tenant A cria ASO com `employeeId` do tenant B → **404**; com `pcmsoPhysicianId` do tenant B → **404**; mensagens idênticas à de UUID inexistente.
- **Aceite:** e2e verdes no banco de ensaio; nenhuma das duas rotas devolve 500 para entrada inválida.

### 1.5 — E-07 · Não apagar evidência em cascata (**só se o proprietário aprovar a retenção — pergunte antes**)

Spec §8: XML, recibo e histórico ficam **indefinidamente**. Hoje `ON DELETE CASCADE` apaga eventos e histórico ao excluir ASO, funcionário ou tenant.
**Não altere nada ainda:** registre na entrega a lista exata de FKs afetadas (`aso_records`→`esocial_events`→`esocial_event_history`, `tenants`, `employees`) e aguarde a decisão.

### 1.6 — E-08 · `esocial_layout_versions` somente leitura para a aplicação

- Na migration `0061` (ainda não aplicada em nenhum banco compartilhado — confirme antes de editar), acrescentar `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON esocial_layout_versions FROM montese_app;`.
- **Teste e2e (banco de ensaio, com a role `montese_app`):** `UPDATE esocial_layout_versions SET producao_restrita_envio_url = 'x'` falha com `permission denied`; `SELECT` continua funcionando.
- **Aceite:** teste verde; leitura da versão ativa segue funcionando para o código.

### 1.7 — E-09 · Papéis

- `POST`/`DELETE /esocial/certificates`: retirar `admin` de `@Roles` **ou** exigir tenant alvo validado — **escolha a primeira (menor risco)** e registre. Hoje o `admin` recebe 500 (`tenant_id` nulo).
- **Teste:** `admin` em `POST /esocial/certificates` → **403** (não 500). `tecnico` em `POST`/`DELETE` → 403.
- Não implemente o "motivo registrado" para leitura de ASO pelo admin: está em G-04 (aguardando aprovação).

### 1.8 — E-10 a E-12 · Endurecimento barato (faça se couber, nesta ordem)

- E-10: gravar no R2 **depois** do `INSERT` (e remover o objeto se o commit falhar) **ou** limpar o objeto no erro; `ParseUUIDPipe` no `:id` do `DELETE`; `UNIQUE (tenant_id, thumbprint_sha256)` parcial (`WHERE status <> 'removido'`) — o `409` deve explicar "certificado já cadastrado".
- E-11: passar `authTagLength: 16` em `createDecipheriv`/`setAuthTag`; **não** unifique ainda `secret-crypto.util.ts` (outro módulo, em produção): só registre a duplicação.
- E-12: validadores de CPF (dígito verificador), UF do CRM (lista das 27 UFs), `examDate` não futuro. Testes unitários dos validadores.

## 2. Como entregar (para a revisão)

1. Um commit por tarefa (1.1 a 1.8), mensagem `fix(esocial|aso): E-0x <resumo>`, com `Co-Authored-By` da ferramenta usada.
2. **Relatório** `task-r2-report.md` no padrão `task-N-report.md`: por tarefa, arquivos, **saída real** (colada, não resumida) de `tsc --noEmit`, `nest build` e dos testes; desvios justificados.
3. Rodar e2e **apenas** em banco de ensaio descartável na rede `montese_internal` (receita em `reference_running_tests_in_throwaway_container`), **nunca** no Postgres de produção. Se não puder, escreva **NÃO VERIFICADO** — não afirme que passou.
4. Conferir resíduo: `tenants`/`users` de teste órfãos (cancelar um run no meio deixa fixtures).
5. Parar ao final da 1.8. **Não** iniciar tasks 13+.

## 3. Critério de aceite da rodada

| # | Critério | Como será conferido |
|---|---|---|
| 1 | `tsc --noEmit` e `nest build` exit 0 **com todos os testes restaurados** | saída colada + `git status` sem ` D` em `backend/test` |
| 2 | Suíte unitária: nenhuma falha **nova** (baseline: `normative-answer-shared`, `question-notices`, `r2-get-object`) | `jest-unit.json` completo |
| 3 | Novos testes de E-04, E-05, E-06, E-08, E-09 existem, falharam antes e passam agora | commits RED/GREEN ou relato com a saída vermelha |
| 4 | Nenhum segredo/certificado real em código, fixture ou log | varredura do checklist, seção 1, item 1 |
| 5 | Nenhum arquivo fora do escopo da seção 0 alterado; nada de compose/env/Docker | `git diff --stat <base>..HEAD` |
