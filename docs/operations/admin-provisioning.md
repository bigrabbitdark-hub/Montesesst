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

Rodar dentro de um container Node isolado (mesma imagem usada nos testes
e2e do projeto, com `bcrypt` já compilado em `backend/node_modules`):

```bash
cd /opt/Montese
docker run --rm -v "$(pwd)/backend:/app" -w /app node:20-alpine \
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
RLS por definição):

```bash
set -a; source /opt/Montese/.env; set +a
docker exec -it montese_postgres psql -U "${POSTGRES_SUPERUSER}" -d "${POSTGRES_DB}" -c "
INSERT INTO users (tenant_id, role, email, password_hash, full_name, status)
VALUES (NULL, 'admin', 'EMAIL_DO_ADMIN_AQUI', 'HASH_GERADO_NO_PASSO_1', 'NOME_DO_ADMIN_AQUI', 'ativo');
"
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

Nenhuma — em 2026-08-26, `SELECT COUNT(*) FROM users WHERE role =
'admin'` retorna `0`. A primeira conta real é criada seguindo este
runbook, fora do escopo automático deste plano de implementação (ver
nota da Task 6).
