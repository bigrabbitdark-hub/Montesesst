# Provisionamento de conta admin

> Fase 7 sub-projeto A (Gestão de tenants e vínculos). Diferente de
> técnico/parceiro (`POST /technicians`, `POST /partners`), não existe
> endpoint de cadastro para o papel `admin` — decisão confirmada em
> brainstorming de 2026-08-26: "insert manual documentado", já que só um
> punhado de pessoas da Montese será admin. Ver
> [`docs/specs/fase-7-gestao-tenants.md`](../specs/fase-7-gestao-tenants.md)
> seção 4.

## Pré-requisito

`role = 'admin'` já existe no tipo `user_role` desde a Fase 1
(`0001_init.sql`) e todo RLS multi-tenant do projeto já reconhece essa
role — nenhuma migration é necessária, só a linha em `users`.

## Passo 1 — gerar o hash da senha

Rodar direto no host (Node 20 via nvm) dentro de `backend/`, **não**
dentro de um container `node:20-alpine`: o binding nativo do `bcrypt`
em `backend/node_modules` é compilado pra libc do host (glibc), e
rodar num container Alpine (musl) causa segfault silencioso (exit code
139, sem mensagem de erro útil) — confirmado na prática em 2026-09-14.

```bash
cd /opt/Montese/backend
node -e "const bcrypt = require('bcrypt'); bcrypt.hash(process.argv[1], 10).then((h) => console.log(h));" \
  "SENHA_FORTE_AQUI"
```

Copiar a saída (uma string começando com `$2b$10$...`) — esse é o
`password_hash` usado no passo 2.

## Passo 2 — inserir a conta

`users` tem RLS (`users_isolation`) — inserir direto como
`POSTGRES_APP_USER` exigiria as variáveis de sessão `app.role`/
`app.tenant_id` que só a aplicação define. Pra uma inserção manual
única, conectar como superuser (mesmo padrão que
`backend/test/db-test-helper.ts` já usa pra fixtures de teste — bypassa
RLS por definição). **Cheque antes se já não existe uma conta admin**
(`SELECT id, email, full_name, created_at FROM users WHERE role =
'admin';` — ver "Contas existentes" abaixo, que já ficou desatualizada
uma vez) pra não criar duplicata; se já existir, use o `UPDATE`
alternativo logo abaixo em vez do `INSERT`.

O hash gerado no Passo 1 contém `$` — usar aspas simples no bash em
volta do comando inteiro e *dollar-quoting* do Postgres (`$tag$...$tag$`)
pros valores, em vez de aspas duplas ou `psql -v`/`:'var'` (a
interpolação de variável do psql não funciona de forma confiável com
`-c`, só com `\echo` — confirmado em 2026-09-14):

```bash
set -a; source /opt/Montese/.env; set +a
docker exec -i montese_postgres psql -U "${POSTGRES_SUPERUSER}" -d "${POSTGRES_DB}" -c '
INSERT INTO users (tenant_id, role, email, password_hash, full_name, status)
VALUES (NULL, '"'"'admin'"'"', $email$EMAIL_DO_ADMIN_AQUI$email$, $hash$HASH_GERADO_NO_PASSO_1$hash$, $name$NOME_DO_ADMIN_AQUI$name$, '"'"'ativo'"'"');
'
```

Pra **atualizar** uma conta admin já existente em vez de criar uma
nova (troca de senha/nome):

```bash
docker exec -i montese_postgres psql -U "${POSTGRES_SUPERUSER}" -d "${POSTGRES_DB}" -c '
UPDATE users SET password_hash = $hash$HASH_GERADO_NO_PASSO_1$hash$, full_name = $name$NOME_DO_ADMIN_AQUI$name$
WHERE id = $id$ID_DA_CONTA_AQUI$id$
RETURNING id, email, full_name, role, status, updated_at;
'
```

`tenant_id = NULL` é a convenção do projeto pra essas roles — a
constraint em `0001_init.sql:41` só EXIGE `tenant_id NOT NULL` pra
`role = 'empresa'`; ela não proíbe um valor não-nulo pra
`tecnico`/`parceiro`/`admin`, mas por convenção essas roles sempre usam
`NULL` (documentado no comentário da coluna em `0001_init.sql:30`).

## Passo 3 — verificar

Login manual em `https://montesesst.com.br/login` com o e-mail/senha
escolhidos. Deve redirecionar para `/admin/empresas` e mostrar a lista
de empresas cadastradas.

## Contas existentes

Em 2026-08-26 não havia nenhuma (`SELECT COUNT(*) ... = 0`), mas uma
conta foi criada em algum momento entre então e 2026-08-28 fora deste
runbook documentado (origem não registrada) — a nota do roadmap da
Fase 26 (2026-09-13) ainda afirmava "nenhuma conta admin em produção",
o que já estava desatualizado nessa data.

Conta atual confirmada em 2026-09-14: `contato@montesesst.com.br`
(`id = bf58c399-807e-4891-a11b-fe6ab22a8031`), senha/nome atualizados
via o `UPDATE` acima. Login e acesso a `GET /tenants` confirmados reais
em produção nessa data.

**Antes de rodar este runbook de novo**, sempre confira o estado atual
com `SELECT id, email, full_name, created_at FROM users WHERE role =
'admin';` — esta seção é conhecidamente propensa a ficar desatualizada.
