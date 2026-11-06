# Release — Sócia cadastra empresa (senha temporária) e atua como empresa — 2026-11

> **Status: PREPARADO, NÃO EXECUTADO, NÃO COMMITADO.** Nada foi aplicado em produção. Rótulos: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO. Leitor: proprietário e quem aplicar o release. Detalhes de projeto: `docs/superpowers/specs/2026-11-05-socio-cadastra-e-atua-como-empresa-design.md`.

## 1. Resumo
- **Évelyn (sócia)**, na tela `/atuacao`, ganha o botão **Cadastrar nova empresa**: informa CNPJ, razão social, nome e e-mail do RH e define uma **senha temporária**. A empresa nasce ativa (plano `trial`), já na carteira dela. A senha aparece **uma única vez** na tela; o sistema não a envia por e-mail nem a guarda em log.
- Ela também ganha **Abrir como empresa**: usa as telas `/empresa/*` (documentos, funcionários, CIPA, EPI etc.) de uma empresa, com uma faixa fixa "Você está atuando em {empresa}. Sair". O acesso dura 30 minutos por token e é revalidado a cada requisição.
- **RH da empresa**: entra com e-mail + senha temporária e é obrigado a **trocar a senha no primeiro acesso** (qualquer outra rota responde 403 `PASSWORD_CHANGE_REQUIRED` até a troca; a tela leva a `/trocar-senha`). O reset de senha por e-mail também libera a obrigatoriedade.
- **Sistema**: a migration 0108 acrescenta a coluna `users.must_change_password`, 5 funções no banco, 2 permissões novas (`empresas.criar`, `empresas.atuar`) e redefine `auth_reset_password`. O isolamento continua sendo o RLS por `tenant_id`: no modo atuação o sistema trata a sócia como papel `empresa` daquela empresa, e a auditoria registra **a sócia** como autora.
- A sócia **não** atua em empresas de técnicos autônomos/parceiros. Funções de IA, eSocial/ASO, assinatura/pagamento e edição de dados cadastrais ficam bloqueadas no modo atuação.
- Nada vale até o proprietário conceder as 2 permissões à Évelyn pela tela de admin.

## 2. Estado
- Código na branch `feat/socio-atua-empresa`, worktree `/opt/montese-work/socio-atua-empresa`. **NÃO commitado**; **nada em produção**. Sem push.
- Base: `release/painel-evelyn-20261103` (`810069b`). A árvore `/opt/Montese` está em outra branch e **NÃO tem o painel da Évelyn**: o merge/release deve partir da linhagem do painel, não de `/opt/Montese`.
- Migration nova: `backend/db/migrations/0108_socio_cadastra_atua_empresa.sql` (não aplicada).

## 3. Evidências
Tudo abaixo foi executado em ensaio descartável e isolado (rede própria, credenciais falsas), nunca em produção. Fonte: relatórios `task-14-verify-report.md`, `task-14-fix-report.md` e `progress.md` em `.superpowers/sdd/2026-11-05-socio-cadastra-e-atua-como-empresa/`.

| Item | Resultado | Rótulo |
|---|---|---|
| Backend unitários (jest) | 140 suítes (138 ok); 2257 testes (2255 ok). Só falham `r2-get-object` (usa bucket real) e `tenant-context-callsites` (idêntica ao baseline: employees 2, certificates 1, esocial-events 1) | VERIFICADO |
| Backend `tsc --noEmit` / `npm run build` | exit 0 / exit 0 (build medido na rodada de verificação, antes da onda de correções) | VERIFICADO |
| Frontend vitest | 108 arquivos / 1570 testes, todos ok | VERIFICADO |
| Frontend `tsc --noEmit` | exit 0 | VERIFICADO |
| Frontend `npm run build` | exit 0 (rodada de verificação, antes da onda de correções) | VERIFICADO |
| Frontend eslint | 0 erros nos 23 arquivos tocados. `npm run lint` completo tinha 11 erros + 3 avisos em 8 arquivos NÃO tocados (pré-existentes por inferência: não rodado na base) | VERIFICADO / INFERIDO |
| e2e no ensaio | socio-empresa-funcoes 12/12; socio-atua-empresa 59/59; tenant-isolation-sweep 10/10; atuacao-permissoes 14/14; auth 5/5; password-reset 20/20 | VERIFICADO |
| e2e da verificação inicial | atuacao-empresas-rls 18/18; atuacao-painel 16/16; atuacao-carteira 13/13; register 9/9; register-technician 5/5; admin-carteira-socios 10/11 na 1a execução (busca por CNPJ com curingas, spec:145) e 11/11 na 2a após FLUSHALL (intermitente; causa INFERIDA: dado aleatório) | VERIFICADO / INFERIDO |
| Sabotagens (teste falha quando o código é quebrado) | `socio_can_act_on_tenant` sabotada derruba 2 testes; tabela de parceiro sabotada detectada; `socio-controller-sweep` reprova ao colocar `socio` em handler indevido; DTOs de senha (72 bytes) sabotados derrubam 2 testes | VERIFICADO |
| Migration 0108 aplicada como `montese_app` | banco novo `montese_final`, 0001–0105 + 0108, `--single-transaction` com `ON_ERROR_STOP`: 101 arquivos, 0 falhas; spec das funções 11/11. Erro no `afterAll`: `permission denied for table audit_log` — artefato de limpeza do teste (audit_log pertencia a `montese_app`), não da 0108. Depois a `auth_reset_password` nova foi aplicada só nesse trecho e testada: 12/12 | VERIFICADO |
| Resíduos no ensaio | tenants 0, users 0, socio_permissions 0, audit_log `atuacao.acesso` 0 | VERIFICADO |
| Revisões independentes | segurança (`montese-seguranca`): 0 crítico, 1 alto (perímetro, ver §8), 3 médios, 6 baixos, 5 info; QA (`montese-qa`): aprovado com ressalvas, achados corrigidos na onda final | VERIFICADO |

**NÃO VERIFICADO:**
- Build de **imagem Docker** e boot isolado das candidatas (Ruling 2: não executado para não mexer em Docker). Antes de subir, RECOMENDADO construir as imagens candidatas e fazer boot em rede descartável como no release do painel.
- Teste em **navegador real** (Playwright/QA visual) das telas novas: só vitest.
- e2e (HTTP/RLS) de **todos** os controllers liberados com `@ActingAllowed` (26: 21 por classe + 5 por método). O e2e `socio-atua-empresa` cobre leitura/escrita por tabela com dois tenants e um de técnico/parceiro, mas os relatórios não listam cada controller; INFERIDO que o restante depende do RLS comum de `empresa` e da trava `acting-allowed-lista.unit-spec`. Quantos foram exercitados via HTTP não consta nos relatórios.
- Migration 0108 sobre o **banco real de produção** (dados reais).
- E-mail real, R2 e MiniMax: não exercitados.

## 4. Pré-requisitos e ORDEM (obrigatória)

> **AVISO:** se o backend novo subir ANTES da migration 0108, **TODO login falha (erro 500)**: o login consulta `auth_user_must_change_password`, que só existe após a migration. Ordem: backup → migration → conferência → backend → frontend.

1. **Conferir** que nenhuma outra sessão está mexendo em produção e anotar o commit no ar (`curl -sk https://localhost/api/health -H 'Host: www.montesesst.com.br'`).
2. **Backup:**
```bash
cd /opt/Montese && bash ops/backup-postgres.sh
```
Anote o nome do dump gerado e confirme que existe.
3. **Migration 0108, aplicada PELO PROPRIETÁRIO** (a sessão do agente é bloqueada de escrever no banco de produção). Superusuário, transação única, registro em `_migrations` na mesma transação, SQL por stdin (nada é deixado no container, sem `rm`). **Nunca `npm run db:migrate`.**
```bash
M=/opt/montese-work/socio-atua-empresa/backend/db/migrations/0108_socio_cadastra_atua_empresa.sql
{ echo "SET lock_timeout='5s';"; cat "$M"; echo "INSERT INTO _migrations (name) VALUES ('0108_socio_cadastra_atua_empresa.sql');"; } \
| docker exec -i montese_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction -v ON_ERROR_STOP=1'
```
Se falhar, a transação desfaz tudo; pare e não suba o backend. (INFERIDO: o comando espelha o do release do painel, adaptado para stdin; o cabeçalho da migration já contém `SET LOCAL lock_timeout`. Não foi executado.)
4. **Conferência** (todas devem passar):
```bash
docker exec -i montese_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT max(name), count(*) FROM _migrations;                 -- deve conter 0108_socio_cadastra_atua_empresa.sql
\d users                                                      -- deve mostrar must_change_password boolean not null default false
\df socio_can_act_on_tenant
\df socio_create_company
\df auth_change_password
\df auth_own_password_hash
\df auth_user_must_change_password
\df auth_reset_password
SQL
```
Devem aparecer as 5 funções novas e a `auth_reset_password` (redefinida).
5. **Imagem do backend** (depois da migration). 6. **Imagem do frontend.** (Construir as imagens candidatas e fazer o boot isolado antes é RECOMENDADO; ver §3.) Depois de subir: `/api/health` com o commit novo, `docker ps`, log do backend sem erro, login normal de uma conta existente funcionando e `/login` 200.

## 5. Numeração da migration (decisão do proprietário)
- Este worktree usa `0108_socio_cadastra_atua_empresa.sql`. Existem **outras linhagens não commitadas** com 0107/0108: `0107_tecnico_assinante_isolamento` e `0108_tecnico_assinante_isolamento` em `/opt/Montese`, e `0107_auth_session_user_function` em `/opt/montese-sessao`.
- O runner aplica qualquer arquivo que não esteja em `_migrations`, mas a **ordem e os números finais são do proprietário no merge**. Lembrar o incidente da 0079 duplicada: nunca deixe dois arquivos com o mesmo número entrarem na mesma árvore sem decisão explícita.
- Se a linhagem do **técnico assinante** entrar junto, `socio_can_act_on_tenant` **PRECISA** ganhar `AND owner_technician_id IS NULL` (e um teste que prove que a sócia não atua em empresa de técnico assinante). Hoje a função só checa ausência de linha em `tenant_technicians` e `tenant_partners`. NÃO VERIFICADO: o comportamento combinado das duas linhagens.
- **Gate do técnico assinante (para o merge de 0107/0108_tecnico_assinante_isolamento):** empresas de técnico assinante têm dono (`owner_technician_id`) e não têm usuário próprio; ao juntar essa linhagem, `socio_can_act_on_tenant` precisa ganhar `AND owner_technician_id IS NULL`, com teste que prove que a sócia não atua nelas.
- **Conflito de código com `/opt/montese-sessao` (S-03, migration `0107_auth_get_session_user_function`):** o working tree dela também altera `backend/src/auth/strategies/jwt.strategy.ts` e `backend/src/auth/auth.service.ts`. O merge dessas linhagens vai conflitar e DEVE preservar os claims `act`/`mcp` (JwtStrategy), a consulta `auth_user_must_change_password` no login e o `AuthService.changePassword`, além da revalidação de sessão da outra linhagem. RECOMENDADO rodar após o merge: `socio-atua-empresa.e2e-spec`, `acting-tenant-guard.unit-spec` e `auth-change-password.unit-spec`.

## 6. Pós-release (passo a passo)
1. Entrar como admin em `/admin/permissoes-socios` e conceder à Évelyn `empresas.criar` e `empresas.atuar`. São **sensíveis** (pedem confirmação extra).
2. Évelyn faz logout/login. Teste com **UMA empresa de teste** (CNPJ válido seu, e-mail seu, nome claramente "TESTE"):
   1. Em `/atuacao/clientes`, **Cadastrar nova empresa** com uma senha temporária (8 a 72 bytes; acento conta 2).
   2. **Anotar a senha** exibida (ela não aparece de novo).
   3. Em **janela anônima**, login do RH com e-mail + senha temporária.
   4. O sistema deve forçar a **troca de senha** (`/trocar-senha`); conferir que antes disso nenhuma outra tela abre.
   5. Évelyn, na ficha da empresa, **Abrir como empresa** (faixa "Você está atuando em ..." visível).
   6. **Subir um documento** de teste.
   7. **Cadastrar um funcionário** de teste.
   8. Conferir que "classificar em lote", pente-fino, assistente, eSocial e onboarding aparecem indisponíveis.
   9. **Sair** do modo empresa (volta à lista de clientes da sócia).
   10. Conferir a **auditoria** (leitura, no banco):
```bash
docker exec -i montese_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT occurred_at, action, actor_role, actor_tenant_id, detail
  FROM audit_log WHERE action LIKE 'atuacao.%' OR action = 'empresa.criada_por_socio'
 ORDER BY occurred_at DESC LIMIT 30;
SQL
```
   Esperado: `empresa.criada_por_socio`, emissão do token, `atuacao.acesso` (leituras) e escritas com `detail='atuando_como_empresa'`, sempre com a Évelyn como autora. (Colunas do SELECT conferidas em `backend/db/migrations/0002_audit_log.sql` — `occurred_at`, `action`, `actor_role`, `actor_tenant_id`, `detail` existem; nenhuma migration posterior altera as colunas de `audit_log`. VERIFICADO por leitura das fontes; o SELECT em si não foi executado em produção.)
3. **Desativar a empresa de teste** pela tela de admin (inativar o tenant); com a empresa inativa o token de atuação deixa de valer na hora. Não apague linhas por SQL.

## 7. Retorno (rollback)
1. **Código:** voltar as imagens anteriores do backend e do frontend (crie as tags `pre-socio-atua-empresa` das imagens atuais ANTES de subir as novas) e `docker compose up -d --no-deps backend frontend`. O código anterior ignora a coluna e as funções novas.
2. **Banco:** as colunas e funções da 0108 são **aditivas e podem ficar**. Exceção: `auth_reset_password` foi redefinida (a nova limpa `must_change_password`); o código antigo funciona com ela.
3. **Rollback SQL completo** (destrutivo, só com autorização; está no cabeçalho da migration, na ordem): `DROP FUNCTION` das 5 funções; **restaurar a `auth_reset_password` da 0058 ANTES de remover a coluna** (o corpo novo a referencia): `CREATE OR REPLACE FUNCTION auth_reset_password(p_user_id UUID, p_old_password_hash TEXT, p_new_password_hash TEXT) RETURNS TABLE(user_id UUID, tenant_id UUID, role user_role) ... UPDATE users u SET password_hash = p_new_password_hash WHERE u.id = p_user_id AND u.password_hash = p_old_password_hash AND u.status = 'ativo' RETURNING u.id, u.tenant_id, u.role` (texto completo no cabeçalho do arquivo; `CREATE OR REPLACE` mantém dono e GRANT); depois `ALTER TABLE users DROP COLUMN must_change_password`; `DELETE FROM socio_permissions WHERE permission IN ('empresas.criar','empresas.atuar')`; restaurar o CHECK da 0104 sem as duas permissões; `REVOKE SELECT ON socio_permissions` e `REVOKE INSERT ON tenant_owners` de `montese_auth_bypass`; `DELETE FROM _migrations WHERE name = '0108_socio_cadastra_atua_empresa.sql'`.
4. **Revogar** `empresas.criar` e `empresas.atuar` da Évelyn pela tela de admin (basta isso para desligar a funcionalidade sem mexer em código).
5. **Efeito:** tokens de atuação já emitidos expiram em **até 30 min** (não há revogação no servidor, mas a permissão é revalidada a cada requisição; revogar a permissão os invalida na hora). Empresas e usuários criados pela sócia permanecem; contas com troca obrigatória pendente voltam a entrar sem a trava se a coluna for removida.

## 8. Limitações conhecidas e DECISÕES PENDENTES DO DONO
Limitações (spec §10): matriz/filiais e onboarding indisponíveis no modo atuação; CIPA "Nova gestão" indisponível; documentos presos ao uploader; assinatura `cancelled` bloqueia (403 `SUBSCRIPTION_INACTIVE`); IA/eSocial/ASO fora.

Decisões (spec §11), cada uma com a consequência e a opção RECOMENDADA:
1. **Perímetro (A1, achado ALTO).** A sócia atua em **toda empresa ativa sem técnico/parceiro**, inclusive as que só assinam o SaaS, com acesso a CPF, ASO/PCMSO e exclusão de funcionários. Sem base contratual/LGPD isso é exposição de dado pessoal e de saúde. RECOMENDADO: confirmar base contratual ou restringir à carteira dela (1 `EXISTS` em `tenant_owners` em `socio_can_act_on_tenant`).
2. **Senha temporária escolhida pela sócia, sem expiração (M2).** Vale até a troca; quem a conhece (a sócia) sabe a senha. RECOMENDADO: senha gerada pelo sistema com prazo de 48–72 h ou convite por e-mail.
3. **E-mail do RH não verificado (B5).** O usuário nasce confirmado; e-mail digitado errado dá acesso a terceiro. RECOMENDADO: convite por e-mail ou confirmação no primeiro acesso.
4. **Documentos presos ao uploader (B6/QA4).** O RH não corrige o que a sócia enviou, e vice-versa. RECOMENDADO: permitir que o RH da empresa gerencie documentos enviados pela sócia (decidir o inverso também).
5. **Assinatura presencial de EPI e emissão de ficha liberadas à sócia (I5).** Ela pode assinar/emitir pelo funcionário. RECOMENDADO: manter só se houver respaldo operacional; caso contrário, retirar a marca desses controllers.
6. **Matriz/filiais e onboarding bloqueados (`PATCH /tenants/me`).** A empresa nasce sem Matriz e a sócia não a cadastra no modo atuação (o RH precisa fazê-lo; a CIPA pede a Matriz). RECOMENDADO: liberar `PATCH /tenants/me` e o onboarding (uma marca + testes).
7. **Indexação de embeddings pulada no upload em modo atuação (Ruling 11).** Documentos enviados pela sócia ficam fora do RAG/copiloto até reindexar. RECOMENDADO: manter pulado até decidir a base legal de enviar dados ao provedor de IA; reversível numa linha.
8. **Papel gravado na auditoria (B1).** 21 pontos gravam `empresa` com o id da sócia. RECOMENDADO: helper `effectiveActorRole` para gravar `socio`.
9. **Numeração da migration e técnico assinante** (ver §5). RECOMENDADO: decidir a ordem das linhagens antes do merge e incluir `owner_technician_id IS NULL`.
10. **Base legal/LGPD da sócia como operadora.** Dado de saúde de funcionários fica acessível a ela. RECOMENDADO: registrar no contrato com os clientes e na política de privacidade.
11. **Assistente de IA no modo atuação** continua fora. RECOMENDADO: manter fora até decisão sobre dados enviados ao modelo.

## 9. Armadilhas e observações técnicas
- **Ordem dos guards:** `JwtAuth` → `PasswordChangeRequired` → `ActingTenant` → Subscription → Roles → Permissions. O `ActingTenantGuard` roda antes dos guards de papel/assinatura; por isso uma leitura depois negada por eles ainda fica como `atuacao.acesso` com status 200 nominal.
- **Token de atuação em `localStorage`** (`montese_token`; sessão real da sócia em `montese_socio_session`): desvio do plano original (memória/`sessionStorage`), porque ~145 páginas da empresa leem o token direto do `localStorage`. Risco: exposição a XSS enquanto atua e compartilhamento entre abas. Mitigações: TTL 30 min, revalidação no servidor a cada requisição, limpeza total em logout/401, não restaurar a sessão guardada se estiver vencida (vai ao login), nunca em URL.
- **Janela de 30 min:** vários tokens podem coexistir; "Sair" só descarta o token no navegador. Revogar a permissão ou inativar a empresa invalida na hora.
- **Auditoria:** `atuacao.acesso` registra leituras (GET/HEAD; path sem query), exceto `/tenants/me*` e `/dashboard/*`; `atuacao.negada` registra negações (403); escritas levam `detail='atuando_como_empresa'`. O `auditDenied` não tem `try` síncrono (minor antigo). O volume de `atuacao.acesso` pode crescer.
- **21 pontos de auditoria** em serviços/triggers gravam o papel `empresa` com o id da sócia como autora (decisão 8).
- Assinatura `cancelled`: o token é emitido (201), mas o uso responde 403.
- Falhas de teste **pré-existentes** (não causadas por esta entrega): `r2-get-object` e `tenant-context-callsites`. O e2e `admin-carteira-socios` falhou uma vez de forma intermitente (curingas na busca por CNPJ).
- Senha: máx. 72 **bytes** em UTF-8 (acento = 2 bytes). `register.dto` e `reset-password.dto` seguem com limite em caracteres (dívida pré-existente). O e-mail não é normalizado para minúsculas (como no autocadastro); unicidade e login já ignoram maiúsculas.
- Dashboard usa `Promise.all` no mesmo cliente do pool (DeprecationWarning do `pg@9`, débito anterior).

## 10. Perguntas em aberto para o proprietário
1. Mantém o perímetro "toda empresa sem técnico/parceiro" ou restringe à carteira da Évelyn? Qual a base contratual/LGPD?
2. Senha temporária: aceitar escolhida pela sócia sem prazo, ou migrar para senha gerada com validade/convite por e-mail?
3. Exigir confirmação do e-mail do RH?
4. Liberar o cadastro de Matriz/filiais (`PATCH /tenants/me`) no modo atuação?
5. O RH poderá gerenciar documentos enviados pela sócia (e vice-versa)?
6. Manter a assinatura presencial de EPI e a emissão de ficha liberadas à sócia?
7. Indexar embeddings dos uploads feitos no modo atuação?
8. Gravar `socio` (e não `empresa`) como papel nos 21 pontos de auditoria?
9. Qual a ordem final das migrations 0107/0108 entre as linhagens, e a do técnico assinante entra junto (exige `owner_technician_id IS NULL`)?
10. Constrói-se a imagem candidata e faz-se o boot isolado (hoje NÃO VERIFICADO) antes do release? E o QA visual em navegador?
