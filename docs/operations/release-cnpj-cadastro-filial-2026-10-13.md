# Plano de release — CNPJ no cadastro de empresa e de filial (Correções 1 e 2) — 2026-10-13

> **Status: EXECUTADO em 2026-10-13 (ver §9).** Cada etapa 🔒 mudou produção com autorização explícita do proprietário (AGENTS.md). Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.

## 1. Estado real de produção (VERIFICADO em 2026-10-13, somente leitura)

| Item | Estado |
|---|---|
| Backend em produção | `/health` → `commit: 0969bb7-esocial-wip2`; **não contém** `cnpj-lookup` |
| Frontend em produção | imagem `montese-frontend:latest` = `candidate-menu-20261013`; **não contém** `cnpj-lookup` nem `address_neighborhood` |
| Migrations aplicadas | até `0072_lip_normative_base` (inclui `0064`–`0071`) |
| Pendentes (não minhas) | `0063` (pente-fino), `0073`, `0074`, `0075` (base normativa) |
| Pendentes (esta entrega) | `0076`, `0077`, `0078` |

## 2. O que muda

| Migration | Efeito (todas aditivas, sem backfill, sem DROP/ALTER de dado) |
|---|---|
| `0076_tenants_notes_cnpj_fields.sql` | `tenants`: + `notes`, `address_neighborhood`, `address_complement`, `cnae_code`, `cnae_description` (todas nulas) |
| `0077_company_units_cnpj.sql` | `company_units`: + `cnpj VARCHAR(14)` nula; índice único parcial `(tenant_id, cnpj) WHERE cnpj IS NOT NULL` |
| `0078_company_units_cadastral_fields.sql` | `company_units`: + `legal_name`, `notes`, `address_neighborhood`, `address_complement`, `cnae_code`, `cnae_description` (nulas) |

- `trade_name` **não** é tocado e continua sendo o nome de exibição (dashboard, `EmpresaShell`, e-mail do resumo semanal). "Observação" usa `notes`.
- RLS/FORCE RLS de `tenants` e `company_units` não mudam. As três migrations são independentes de `0063` e `0073`–`0075` (tocam outras tabelas).
- Backend novo: módulo `cnpj-lookup` (`GET /cnpj-lookup/:cnpj`, **pública**, limite por IP), campos novos nos DTOs/serviços de `tenants` e `company-units`.
- Frontend novo: `/cadastro`, `MatrizForm`, `FiliaisForm`, `lib/cnpj.ts`, `lib/useCnpjLookup.ts`.

## 3. Ordem obrigatória e armadilhas

1. **Migrations → backend → frontend.** Nunca o frontend antes do backend: o frontend novo envia `cnpj`, `notes`, `legal_name` etc. e o backend antigo
   usa `forbidNonWhitelisted` → **400 ao salvar a matriz e ao cadastrar filial** (INFERIDO do DTO; o e2e prova que campo fora da lista é rejeitado).
2. **Backend novo sem as migrations** → `INSERT/UPDATE` em colunas inexistentes → 500 ao salvar matriz/filial. Aplicar as migrations antes.
3. **Migrations com backend antigo** = seguro (colunas nulas que o código antigo ignora; `SELECT *` passa a trazer campos extras, inofensivo).
4. **Filial nova passa a exigir CNPJ** (regra pedida). Quem usa a API de filiais por fora (integrações, scripts) precisa enviar `cnpj`. Não há
   integração conhecida; os 3 specs e2e antigos que criavam filial sem CNPJ foram atualizados. Filiais existentes continuam com `cnpj` nulo.
5. **A árvore de trabalho está misturada** (base normativa, pente-fino, eSocial, notícias, esta entrega). Um `docker build` a partir dela leva
   tudo junto. **RECOMENDADO:** commitar esta entrega separada (lista em §6), em branch própria a partir do que está em produção, e construir a
   imagem dali. Decisão do proprietário.
6. **Saída de rede:** o backend precisa alcançar `https://brasilapi.com.br` (HTTPS 443). O serviço envia `User-Agent: MonteseSST/1.0`; **sem UA a
   BrasilAPI responde 403** (VERIFICADO em container). Não mexer nisso.
7. **CORS:** o backend só aceita `Origin` igual a `PUBLIC_APP_URL`; em produção já é o domínio público (nada a fazer).
8. Variáveis opcionais (padrões já embutidos; **não** adicionar a compose/`.env` sem necessidade): `CNPJ_LOOKUP_RATE_LIMIT_MAX` (20) e
   `CNPJ_LOOKUP_RATE_LIMIT_WINDOW_SECONDS` (600).

## 4. Passo a passo proposto 🔒

| # | Etapa | Muda produção? | Verificação |
|---|---|---|---|
| 0 | Decidir o isolamento do código (§3.5) e fazer commit — **decisão do proprietário** | não | `git status` limpo para os arquivos de §6 |
| 1 | 🔒 Backup: `bash ops/backup-postgres.sh` (dump local + R2) | cria arquivo | dump listado e restaurável |
| 2 | 🔒 Aplicar `0076`, `0077`, `0078` (nessa ordem; cada uma em transação; `docker cp` + `npm run db:migrate` no `montese_backend`, ver `reference_db_access_without_published_ports`) | sim (aditivo) | `\d tenants`, `\d company_units`; contagem de linhas igual à anterior |
| 3 | 🔒 Build e troca da imagem do backend | sim | `/health` 200 e commit novo; `GET /api/cnpj-lookup/00000000000191` → 200 |
| 4 | 🔒 Build e troca da imagem do frontend | sim | `/cadastro` abre; onboarding salva matriz e filial |
| 5 | Fumaça manual (§5) | não | roteiro §5 |

Tempo de indisponibilidade: o da troca de container (já praticado nos releases anteriores). Sem janela especial para as migrations (só `ADD COLUMN` nula + índice em tabela pequena).

## 5. Roteiro de fumaça pós-release (com uma empresa de teste, nunca dado de cliente)

1. `/cadastro`: digitar CNPJ válido → razão social preenchida; CNPJ inválido → mensagem; não sobrescreve nome já digitado.
2. Onboarding, passo 1: campo "Observação" no lugar de "Nome fantasia"; salvar; reabrir e conferir.
3. Passo 2: nova filial com CNPJ → endereço/razão social/CNAE preenchidos; salvar; editar a observação; repetir o CNPJ → mensagem de duplicado; usar o CNPJ da matriz → mensagem.
4. Empresa já existente (com `trade_name`): abre sem erro; `trade_name` continua aparecendo como nome no dashboard.

## 6. Arquivos desta entrega

Backend (novos): `src/cnpj-lookup/{cnpj-lookup.service,cnpj-lookup.controller,cnpj-lookup.module}.ts`, `db/migrations/{0076,0077,0078}_*.sql`,
`test/{cnpj-lookup,tenant-notes-dto,tenants-notes-persistence,company-units-cnpj-dto}.unit-spec.ts`, `test/company-units-cnpj.e2e-spec.ts`.
Backend (alterados): `src/app.module.ts`, `src/tenants/{tenants.service.ts,dto/update-tenant.dto.ts}`,
`src/company-units/{company-units.service.ts,company-units.controller.ts,dto/create-company-unit.dto.ts,dto/update-company-unit.dto.ts}`,
`test/{tenants,company-units,employees-company-unit,employees-import}.e2e-spec.ts`.
Frontend (novos): `src/lib/{cnpj.ts,useCnpjLookup.ts}`, `src/app/(site)/cadastro/__tests__/cadastro-cnpj.test.tsx`,
`src/app/empresa/onboarding/__tests__/{matriz-form,filiais-form}.test.tsx`.
Frontend (alterados): `src/app/(site)/cadastro/page.tsx`, `src/app/empresa/onboarding/{MatrizForm,FiliaisForm,page}.tsx`.

> Atenção: `backend/test/tenant-context-callsites.unit-spec.ts` aparece modificado na árvore **por outra frente** (não é desta entrega).

## 7. Rollback

- Frontend/backend: voltar às imagens anteriores (`montese-frontend:pre-menu-20261013` / imagem anterior do backend). Com o código antigo, as colunas novas são ignoradas.
- Banco: **não desfazer** as migrations (colunas nulas inofensivas). Se o proprietário exigir, `DROP COLUMN` das colunas novas só depois de confirmar que nenhum dado novo precisa ser mantido (🔒, não recomendado).
- Dados gravados com o código novo (observações, CNPJs de filial) permanecem nas colunas novas e voltam a ser usados ao reaplicar o código.

## 8. Riscos e limitações conhecidas

- **BrasilAPI é ponto único de falha** e tem limite de uso próprio: falhou → o formulário avisa e segue manual; nada trava. Um segundo provedor de reserva seria decisão nova.
- **Dados pessoais:** CNPJ de MEI/empresário individual traz o nome da pessoa na razão social. Só trafega CNPJ (dado público) para a BrasilAPI; o backend não registra CNPJ nem resposta nos logs. Mencionar na política de privacidade se o proprietário julgar necessário.
- **Rota pública** `/cnpj-lookup`: protegida só por limite por IP (20/10 min) e cache de 10 min; sem autenticação porque o `/cadastro` é anterior ao login.
- Unicidade de CNPJ de filial vale **dentro da mesma empresa**; entre empresas não é checada (RLS impede sem vazar dados).
- Telas de admin e técnico não exibem CNPJ/razão social/CNAE da filial (decisão do proprietário: fora do escopo).

## 9. Execução (2026-10-13, VERIFICADO)

Código aplicado a partir de **worktrees limpos e destacados** (sem commit, sem branch): backend `/opt/montese-work/cnpj-be` (base `fd3cd19`, o estado em
produção do eSocial) e frontend `/opt/montese-work/cnpj-fe` (base `39de7d2`, a do menu atual). O `dist` do backend em produção foi comparado com o da
nova build: diferem **apenas** nos arquivos desta entrega.

| Hora (UTC) | Etapa | Resultado |
|---|---|---|
| 13:35 | Backup `montese-20261013-133508.dump` (24 MB) + cópia no R2 (md5 `c8aeb865…`) | `pg_restore --list` lê o índice; antes: 32 empresas, 6 filiais, 114 usuários |
| ~13:38 | Migrations `0076`, `0077`, `0078` (psql, superusuário, `--single-transaction`, `lock_timeout`, registro em `_migrations`) | colunas nulas e índice criados; RLS/FORCE RLS intactos; contagens iguais; backend antigo sem reinício |
| 13:44:22 | Backend → `montese-backend:candidate-cnpj-20261013` (commit `fd3cd19-cnpj-20261013`), pelo proprietário | `/health` ok; `/cnpj-lookup/00000000000191` 200; 0 erros |
| ~13:50 | Pelo Nginx: `/api/health` 200, `/api/plans` 200, `/api/cnpj-lookup/<válido>` 200, `<inválido>` 400, `/api/tenants/me` 401 | sem 502 (sem necessidade de reload do Nginx) |
| 13:55:45 | Frontend → `montese-frontend:candidate-cnpj-20261013`, pelo proprietário | container `running`, 0 reinícios; `/`, `/cadastro`, `/login`, `/planos`, `/noticias`, `/dashboard-v2`, `/empresa/onboarding`, `/empresa/assistente`, `/admin/overview`, `/tecnico/empresas` → 200; 0 erros nos logs |

**Rollback (tags guardadas):** `montese-backend:pre-cnpj-20261013` (imagem de 2026-10-07) e `montese-frontend:pre-cnpj-20261013` (`candidate-menu`).
Para voltar: `docker tag <repo>:pre-cnpj-20261013 <repo>:latest` e `docker compose up -d --no-deps <serviço>`. As colunas novas ficam (nulas, inofensivas).

**Não feito / pendente:** roteiro de fumaça do §5 com uma empresa de teste em produção (não criei dados em produção; os fluxos foram exercitados no
navegador num ambiente isolado equivalente); commit do código dos worktrees (decisão do proprietário); a árvore principal segue com as outras frentes sem commit.
Avisos do `compose` sobre `GROQ_API_KEY`, `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` em branco são anteriores a este release (o aviso de Google Calendar desativado já constava no release de 2026-09-30).

**Fumaça pública em produção (2026-10-13, VERIFICADO, sem gravar nada):** Chromium contra `https://montesesst.com.br/cadastro` — CNPJ válido preenche a razão
social (BrasilAPI a partir do servidor de produção), não sobrescreve nome digitado, CNPJ inválido mostra mensagem; **nenhuma requisição de escrita** foi enviada.
Continuam pendentes, por exigirem login numa empresa de teste: Observação na matriz, filial com CNPJ/edição (§5, passos 2–4).
