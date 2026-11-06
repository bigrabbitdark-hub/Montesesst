# Sócia cadastra empresa e atua como empresa — design

Data: 2026-11-05 (atualizado 2026-11-06 para refletir o código final) · Status: **implementado na branch `feat/socio-atua-empresa` (worktree `/opt/montese-work/socio-atua-empresa`), NÃO commitado, NÃO em produção**; migration `0108_socio_cadastra_atua_empresa.sql` (não aplicada em produção) · Rótulos: VERIFICADO = lido no código; INFERIDO / RECOMENDADO onde indicado.

## 1. Objetivo

Em `/atuacao` (painel da Eng. Évelyn, papel `socio`):
1. botão **Cadastrar nova empresa**: ela informa o e-mail do RH e define uma **senha temporária**; a empresa nasce já ativa;
2. botão **Abrir como empresa**: ela usa as mesmas telas `/empresa/*` (documentos, funcionários etc.) da empresa escolhida;
3. o RH da empresa entra depois com e-mail + senha temporária, **troca a senha no primeiro acesso** e acompanha.

Fora de escopo: empresas de técnicos autônomos/parceiros (ela não as vê nem atua nelas); cadastro de técnicos; qualquer mudança em pagamento.

## 2. Fatos verificados no código

- `socio` tem papel próprio; `RolesGuard` nega por padrão e só libera rota que liste `socio` ou use `@RequirePermission`; `PermissionsGuard` lê `socio_permissions` do banco (nunca do token). (`common/guards/*.ts`)
- O contexto de RLS é `app.user_id / app.tenant_id / app.role`, montado em `TenantContextInterceptor` a partir de `request.user` (`id`, `tenantId`, `role`). (`common/interceptors/tenant-context.interceptor.ts`, `database.service.ts`)
- `is_montese_tenant(tenant_id)` (migration 0091, redefinida na 0101) = tenant sem vínculo técnico/parceiro **OU** marcado em `socio_portfolio`. Serve à visibilidade do painel da sócia; **não** é usada para atuar (ver §3, Ruling 6).
- Autocadastro: `RegistrationService.register` → `auth_register_tenant_and_user(...)`, cria tenant/usuário `pendente` e exige confirmação por e-mail. Grava o e-mail como digitado (unicidade e login usam `lower(email)`).
- 27 controllers listam `empresa` em `@Roles`. Não existe hoje impersonação nem tenant escolhido.
- Migrations da base desta branch: até `0105`; esta entrega acrescenta `0108_socio_cadastra_atua_empresa.sql`. **Conflito de numeração:** `/opt/Montese` tem `0108_tecnico_assinante_isolamento.sql` (não rastreada) e há `0107_*` em outras linhagens — a ordem final é decisão do dono no release (Ruling 7/27).

## 3. Decisão de arquitetura (aprovada: "atuar como empresa")

**Token de atuação.** `POST /atuacao/clientes/:tenantId/atuar` (`empresas.atuar`, `@RateLimit` por IP: `SOCIO_ATUAR_RATE_LIMIT_MAX`, padrão 60/h) emite um JWT de **30 min** com a claim `act` = tenant atuado (uuid), `role='socio'`. O JWT continua sendo da Évelyn (`sub` = id dela), então a auditoria registra **ela**. Não é de uso único: cada chamada emite um token novo e vários podem coexistir até vencer. "Sair do modo empresa" só descarta o token no navegador — **não há revogação no servidor** (o token vale até o `exp`, mas é revalidado a cada requisição).

**Papel efetivo.** Quando o token traz `act`, o `ActingTenantGuard` (após `JwtAuthGuard` e `PasswordChangeRequiredGuard`, antes de Subscription/Roles/Permissions) reescreve `request.user` para `{ id: Évelyn, tenantId: X, role: 'empresa', actingAs: true }` e o `TenantContextInterceptor` monta o contexto de RLS como `{ userId: Évelyn, tenantId: X, role: 'empresa' }`. Resultado: **todas as policies existentes de empresa funcionam sem alteração** e o isolamento continua sendo o RLS por `tenant_id`. (VERIFICADO no e2e `socio-atua-empresa`: leitura/escrita por tabela com dois tenants e um de técnico/parceiro.)

**Revalidação a cada requisição.** Com `act`, o guard chama `socio_can_act_on_tenant(sócia, X)` (0108): sócia `ativo` com `role=socio` + permissão `empresas.atuar` no banco + tenant `ativo` + **checagem explícita de ausência de linha em `tenant_technicians` e `tenant_partners`**. **Não** usa `is_montese_tenant` (Ruling 6: desde a 0101 ela aceita empresas com técnico marcadas no portfólio). Se a empresa ganhar vínculo com técnico/parceiro, a permissão for revogada, a sócia desativada ou a empresa inativada, o token deixa de valer na hora. Assinatura `cancelled`: o token é emitido, mas o uso responde 403 `SUBSCRIPTION_INACTIVE`.

**Auditoria de leituras (Ruling 20).** Além das escritas (AuditInterceptor, `detail='atuando_como_empresa'`), o guard grava `action='atuacao.acesso'` para cada GET/HEAD permitido no modo atuação: ator = sócia, `actor_role='socio'`, `actor_tenant_id` = tenant atuado, método, `path` **sem query string**, `status_code` 200 nominal (registra o acesso autorizado pelo guard, não a resposta final). Exceções (ruído): `/tenants/me*` e `/dashboard/*`. Fire-and-forget: falha de auditoria nunca derruba a requisição. Negações viram `atuacao.negada` (403).

**Lista de rotas liberadas (fail-closed).** Decorator `@ActingAllowed()` aplicado **somente** nos controllers/handlers abaixo (lista fechada, travada por `backend/test/acting-allowed-lista.unit-spec.ts`; definida na Task 8 a partir do levantamento das chamadas de `app/empresa`, `app/dashboard-v2`, `components` e `lib` do frontend). Sem a marca, o `ActingTenantGuard` nega (`ACTING_ROUTE_DENIED`). Com a marca, o papel efetivo é `empresa`: handlers cujo `@Roles` não inclui `empresa` (só técnico/parceiro/admin) continuam negados pelo `RolesGuard`. Regra: **nenhum handler que envie dado a provedor de IA para extrair/classificar/responder é marcado** (decisão do dono pendente).

| Controller | Decisão | Motivo / uso nas telas |
|---|---|---|
| `cipa/committees`, `dds`, `elections`, `members`, `pendencias`, `sipat`, `trainings` | liberado (classe) | telas `/empresa/cipa/*` |
| `cipa/meetings` | método a método | liberados: CRUD, participantes, aprovar/reabrir ata, `GET :id/ata-ai-draft` (só lê). **Negado:** `POST :id/ata-audio` (áudio → transcrição/extração por IA) |
| `company-units` | liberado (classe) | filiais (onboarding e filtros de quase todas as telas). Inclui `PATCH company-units/:id`: legal_name, CNAE e endereço (inclusive da matriz) editáveis; CNPJ da matriz protegido no service (não muda por aqui) e matriz não pode ser desativada/removida |
| `dashboard` | liberado (classe) | `/dashboard-v2` (`summary`, `overview`, `nr-conformidade`); `nr-aplicaveis` só leitura |
| `documents` | método a método | liberados: upload, listar, compliance, regras (GET), validade, download, excluir. **Negados:** `POST classify-batch` (texto ao MiniMax), `PATCH validity-rules/:category` (admin), `GET compliance/portfolio` (técnico/parceiro). **Ruling 11:** no modo atuação o upload grava o documento mas **não indexa** embeddings no provedor externo (`request.user.actingAs` → pula `extractAndEmbed`/`persistChunks`; fail-closed até decisão do dono). Fora do modo atuação, comportamento inalterado |
| `employees` | método a método | liberados: CRUD, tabela, histórico, importação por planilha (`import`, `import-preview`, `import-mapped`), lista/revisão de extrações, e `PATCH employees/bulk` (edição em lote da tabela oficial, até 200 mudanças). **Negado:** `POST documents` (cadastro por documento; pode enviar texto ao MiniMax) |
| `emergency-drill`, `fire-brigade`, `fire-safety-equipment` | liberado (classe) | simulados, brigada, equipamentos |
| `epi/epis`, `epi/epi-catalog`, `epi-ficha`, `epi-signature` | liberado (classe) | `/empresa/epi/*` (estoque, ficha, assinatura) |
| `inspections/action-plans`, `prevention-checklist`, `prevention-corrective-actions` | liberado (classe) | inspeções/planos, checklist de prevenção (escritas do checklist são só do técnico) |
| `inspections/inspections` | método a método | liberados só os GET (`''`, `modelo-pdf`, `:id`); escrita e `ai-draft` são do técnico |
| `positions` | liberado (classe) | cargos e mapa SST (`link-suggestions` é heurística local, sem IA) |
| `caepi` | liberado (classe) | consulta CA |
| `tenants` | só `GET me` (método) | `EmpresaShell` (nome/logo). `PATCH me`, `POST/DELETE me/logo` e rotas de admin negados — portanto o **onboarding** (`/empresa/onboarding`, dados cadastrais e logo) fica **indisponível** no modo atuação; `GET :id/logo` é `@Public` |
| `cnpj-lookup`, `epi-signature-public`, `health`, `contact`, `plans`, `payments/webhook` | sem marca | rotas `@Public` (o guard não se aplica) ou sem uso no modo atuação |
| `pente-fino` | **proibido** | único handler (`POST run`) dispara até 7 chamadas de LLM com o conteúdo de PGR/PCMSO/LTCAT/LIP |
| `assistant`, `normative-documents`, `normative-sources`, `ai-copilot`, `admin/ai-usage` | **proibido** | IA / base normativa |
| `esocial/*`, `aso` | **proibido (duvidoso)** | certificado A1 e dados de saúde; tela `/empresa/esocial` fica oculta até decisão do dono |
| `subscriptions`, `tenant-technicians`, `partners`, `technicians`, `visits`, `google-calendar`, `auth` | **proibido** | pagamento, vínculos, agenda do técnico, autenticação. `/empresa/agendamentos` e o `SubscriptionNotice` do `EmpresaShell` (`/subscriptions/me`) precisam ser ocultados no modo atuação (Task 13) |
| `atuacao/*`, `admin-dashboard`, `admin/carteira-socios`, `overview`, `sst-checklist`, `system-status`, `audit-log` | **proibido** | painel da sócia / admin; não usados pelas telas da empresa |

Consequência no frontend (Task 13): no modo atuação ocultar/desabilitar "classificar em lote" (documentos), "enviar documento de cadastro" (funcionários), "gravar áudio da ata" (CIPA), pente-fino, assistente, eSocial, agendamentos, onboarding/dados da empresa (PATCH `/tenants/me` e logo) e o aviso de assinatura.

**Por quê não dar o papel `empresa` ao sócio:** perderia a rastreabilidade e o limite por empresa.

## 4. Fatia 1 — cadastro com senha temporária

- `POST /atuacao/clientes` (`@Roles('socio')` + `@RequirePermission('empresas.criar')`), DTO com `whitelist/forbidNonWhitelisted`: razão social, CNPJ (validação existente + consulta CNPJ existente no front), nome do responsável, e-mail, senha temporária.
- Função própria `socio_create_company(...)` (0108, SECURITY DEFINER; Ruling 8) em vez de `auth_register_tenant_and_user` (que cria tenant/usuário `pendente`): tenant `ativo` (plano `trial`), usuário `empresa` **ativo/confirmado** (sem e-mail de confirmação) e com `must_change_password = true`. Exige `app.role='socio'`, `app.user_id = p_socio_id` e a permissão `empresas.criar`. `@RateLimit` por IP (`SOCIO_CREATE_COMPANY_RATE_LIMIT_MAX`). O e-mail é gravado como digitado, igual ao autocadastro.
- Inserir a Évelyn em `tenant_owners` (carteira dela). Auditar `action='empresa.criada_por_socio'`.
- Senha temporária: mínimo 8; **máximo 72 BYTES** em UTF-8 (`@MaxBytes(72)` no backend e `TextEncoder` no front; acentos contam 2 bytes — o bcrypt ignora o que passa de 72 bytes; Ruling 26); o sistema nunca a registra em log nem a devolve após a criação; **exibida uma única vez** na tela com aviso para repassar ao RH por canal seguro. Não enviamos a senha por e-mail.
- Erros: CNPJ ou e-mail duplicado → 409 (o servidor diz "Registro duplicado"; a tela mostra "CNPJ ou e-mail já cadastrado.").
- **Migration nova:** coluna `users.must_change_password boolean not null default false`; `login`/`/auth/me` devolvem a flag; qualquer rota (exceto troca de senha e logout) responde 403 `PASSWORD_CHANGE_REQUIRED` enquanto a flag estiver ativa; a troca (`POST /auth/change-password`, exige a senha atual, também limitada a 72 bytes) limpa a flag; **o reset de senha por e-mail também limpa** (`auth_reset_password` redefinida na 0108 com `must_change_password = false`; Ruling 21). Frontend redireciona para `/trocar-senha`.
- Permissões novas em `common/permissions.ts` e no cadastro de permissões da Évelyn: `empresas.criar`, `empresas.atuar` (concessão pelo admin, como as outras).

## 5. Fatia 2 — atuar como empresa (backend)

- `POST /atuacao/clientes/:tenantId/atuar` → valida (seção 3) e devolve token de atuação. Não existe endpoint de saída: sair só descarta o token no front.
- `JwtStrategy`/`request.user` passam `actingTenantId` quando a claim `act` é um uuid e o `role` é `socio` (assinatura e `exp` conferidos; token com `purpose` é recusado como sessão). Token de atuação não emite outro token.
- Auditoria: `AuditInterceptor` grava ator = sócia, `actor_tenant_id` = tenant atuado e `detail='atuando_como_empresa'` nas escritas; leituras via `atuacao.acesso` (§3); emissão do token também auditada. Limitação: 21 serviços gravam `actorRole: req.user.role` e, atuando, registram `empresa` (o `actor_user_id` continua sendo a sócia).
- Quem não é `socio` (empresa/técnico/parceiro/admin) recebe 403 ao tentar emitir token ou enviar `acting_tenant_id`.

## 6. Fatia 3 — frontend

- `/atuacao/clientes`: botão **Cadastrar nova empresa** (formulário com consulta de CNPJ; tela de sucesso mostra a senha uma vez) e botão **Abrir como empresa** na ficha.
- Ao abrir como empresa, o token de atuação ocupa `localStorage['montese_token']` e a sessão real da sócia fica em `localStorage['montese_socio_session']` (desvio consciente do plano original de memória/`sessionStorage` — ver §9), com **faixa fixa e acessível**: "Você está atuando em {empresa}. Sair". Sair volta a `/atuacao/clientes/{id}`.
- Telas `/empresa/*` reaproveitadas sem duplicação (leem o token do `localStorage`, por isso o slot é trocado). Itens de menu que levam a rotas excluídas ficam ocultos nesse modo (`useAtuando`, `IndisponivelAtuando`).
- Sessão: 401 durante a atuação (`sessionExpired`, `RoleGuard`, faixa ao vencer) restaura a sessão da sócia e volta a `/atuacao/clientes?atuacao=expirada`; **se a sessão guardada da sócia já estiver vencida, não é restaurada**: tudo é limpo e vai ao login (Ruling 22). Logout/`clearSession` limpam as quatro chaves.
- Alertas/vencimentos: nenhum trabalho novo; a empresa entra nos alertas E4 assim que tiver documentos com validade.

## 7. Testes (obrigatórios)

1. **Isolamento:** `socio` não emite token para tenant com vínculo de técnico/parceiro; token de X não lê/escreve dados de Y (teste por tabela das telas liberadas, com 2 tenants Montese e 1 de técnico); vínculo criado depois invalida o token; token expirado/forjado/`purpose` errado recusados.
2. **Papéis:** `empresa/tecnico/parceiro/admin` não emitem token nem usam `acting_tenant_id`; rotas excluídas retornam 403 para o sócio atuando.
3. **Cadastro:** CNPJ/e-mail duplicado, senha fraca, permissão ausente, usuário nasce confirmado e com troca obrigatória; senha nunca aparece em log/auditoria.
4. **Troca obrigatória:** bloqueia todas as rotas exceto troca/logout; limpa após trocar.
5. **Auditoria:** ações em modo atuação gravam ator = Évelyn e tenant atuado.
6. Frontend: formulário, senha exibida uma vez, faixa "Atuando em", ocultação de menu, saída.
7. `typecheck` e `build` de backend e frontend. Execução no ensaio descartável/isolado (memória do projeto); e2e de produção **não** rodam.
8. **Revisão final por `montese-seguranca`** (quem implementa não aprova), e `montese-qa` no diff.

## 8. Entrega e restrições

- Sem commit, push ou deploy; migration entregue ao proprietário (a trava da sessão bloqueia escrita no banco de produção). Ordem: migration → backend → frontend; reversão = voltar imagens anteriores (a coluna `must_change_password` é aditiva).
- Cadastrar as duas permissões novas para a Évelyn pela tela de admin após o release.

## 9. Riscos e pontos abertos

- **Risco principal:** policies de alguma tabela que dependam de `users.tenant_id` do `app.user_id` (a Évelyn tem `tenant_id` nulo) falhariam no modo atuação. Mitigação: teste por tabela na Fatia 2; tabela problemática fica fora da lista liberada até ajuste revisado.
- **Desvio consciente (Ruling 22):** token de atuação e sessão guardada da sócia ficam em `localStorage` (nunca em URL), não em memória/`sessionStorage`: ~145 páginas da empresa leem o token direto do `localStorage` e mudá-las estava fora de escopo. Consequências: exposição a XSS enquanto atua e compartilhamento entre abas. Mitigações: TTL 30 min, revalidação no servidor a cada requisição, limpeza total em logout/401, não restaurar sessão vencida.
- Dado de saúde de funcionários fica acessível à Évelyn nas empresas Montese; base legal/LGPD e papel dela como operadora a confirmar pelo dono (RECOMENDADO registrar no contrato com os clientes).
- Assistente de IA no modo atuação: fora desta entrega até decisão do dono.

## 10. Limitações conhecidas no modo atuação (código final)

- **Matriz/filiais e onboarding indisponíveis:** `PATCH /tenants/me` e logo bloqueados (Ruling 17); a empresa criada pela sócia nasce sem Matriz e ela não a cadastra no modo atuação.
- **CIPA "Nova gestão" indisponível** (Ruling 25): o responsável precisa ser usuário da empresa; a tela mostra aviso e os atalhos somem.
- **Documentos presos ao uploader:** documentos enviados pela sócia ficam com `uploaded_by_user_id` dela (e `uploaded_by_role='empresa'`); o RH não corrige os dela e vice-versa (Ruling 28).
- **Assinatura inativa bloqueia:** empresa `cancelled` → 403 `SUBSCRIPTION_INACTIVE` ao usar o token.
- **IA fora:** pente-fino, assistente, classificação em lote, cadastro por documento, ata por áudio e eSocial/ASO negados; upload não indexa embeddings (Ruling 11).

## 11. Decisões pendentes do dono

1. **A1 — perímetro:** hoje a sócia atua em **toda** empresa ativa sem técnico/parceiro (inclusive as que só assinam o SaaS), com acesso a CPF, ASO/PCMSO e exclusão de funcionários. Confirmar a base legal/contratual (LGPD) ou restringir à carteira dela (1 `EXISTS` em `tenant_owners` em `socio_can_act_on_tenant`).
2. **M2 — senha temporária sem expiração:** escolhida pela sócia e válida até a troca. Opções: senha gerada pelo sistema + prazo (48–72 h) ou convite por e-mail.
3. **B5 — e-mail do RH não verificado:** o usuário nasce confirmado; um e-mail digitado errado cria acesso para terceiro.
4. **B6/QA4 — documentos presos ao uploader:** permitir que o RH gerencie os documentos enviados pela sócia (e vice-versa)?
5. **I5 — EPI:** assinatura presencial de EPI e emissão de ficha estão liberadas à sócia no modo atuação; manter?
6. **Liberar `PATCH /tenants/me` e o onboarding (matriz/filiais)** no modo atuação (uma marca + testes).
7. **Indexação de embeddings no upload** feito no modo atuação (hoje pulada, fail-closed).
8. **B1 — papel gravado durante a atuação:** 21 pontos em serviços/triggers gravam `actorRole`/`*_role` = `empresa`; opção: helper `effectiveActorRole` para gravar `socio`.
9. **Numeração da migration:** `0108_socio_cadastra_atua_empresa` colide com `0108_tecnico_assinante_isolamento` (`/opt/Montese`); ao juntar as linhagens, `socio_can_act_on_tenant` deve ganhar `AND owner_technician_id IS NULL` (técnico assinante).
