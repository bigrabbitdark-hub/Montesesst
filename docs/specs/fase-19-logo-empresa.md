# Fase 19 — Personalização visual: logo da empresa no menu

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-04.
> Duas partes do mesmo pedido original: (1) cor de fundo + fonte do
> menu lateral — classificada como **bounded** no brainstorming, já
> implementada e commitada diretamente, sem spec (commit `3688289`);
> (2) upload de logo da empresa, exibida no topo do menu no lugar do
> texto "Montese SST" — classificada como **architectural**, é o que
> esta spec cobre.

## 1. Objetivo e escopo

Hoje o topo do menu lateral da empresa mostra sempre o texto fixo
"Montese SST" (`EmpresaSidebar.tsx`). Esta fase permite que a empresa
cliente suba a própria logo (na tela "Dados da empresa", que já existe
e já é reaberta a qualquer momento, não só no onboarding) e passe a
ver essa logo no lugar do texto — junto com o nome fantasia da
empresa. Sem logo cadastrada, continua exatamente como hoje.

A marca da Montese (o produto) não muda em nenhum lugar — nem no
rodapé da área logada (`DashboardFooter`, que hoje já não tem logo
nenhuma, só texto de copyright) nem no site institucional público
(`SiteFooter`/`Logo.tsx`, componentes completamente isolados da área
logada, confirmado por grafo de imports).

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Só a empresa (`/empresa/*`) ganha essa personalização.** O menu do
  técnico (`TecnicoSidebar.tsx`) continua sempre mostrando "Montese
  SST" — um técnico atende várias empresas ao mesmo tempo, então não
  existe "a logo" certa pra mostrar no menu dele. O tratamento visual
  de cor/fonte (Fase anterior, já commitado) já é igual nos dois;
  **só** a exibição de logo é exclusiva da empresa.
- **Entra como campo na tela "Dados da empresa" já existente**
  (`/empresa/onboarding`, reaberta a qualquer momento pelo link "Conta
  → Dados da empresa"), não como um passo especial de "primeira
  configuração" que só aparece uma vez. A empresa pode subir, trocar
  ou remover a logo quando quiser.
- **Upload é uma ação imediata e independente**, como o upload de
  documentos já funciona hoje (`DocumentsPanel`) — não fica amarrado
  ao botão "Salvar" dos outros campos da matriz (que hoje envia JSON
  via `PATCH /tenants/me`; upload de arquivo precisa de `multipart`,
  então vira uma chamada própria).
- **Formato aceito: só JPG e PNG, até 2MB.** Sem SVG — evita qualquer
  risco de SVG malicioso (script embutido), e PNG já resolve fundo
  transparente. Bem mais restrito que documentos (10MB, +PDF) porque
  é só um ícone pequeno, não um documento.
- **A logo é servida por uma rota pública** (`GET /tenants/:id/logo`,
  `@Public()`, sem JWT) — não é dado sensível, e evitar autenticação
  aqui evita um round-trip de API só pra descobrir uma URL assinada
  toda vez que o menu carrega. A rota devolve um redirect 302 pra uma
  URL assinada do R2 (reaproveita `R2Service.getPresignedDownloadUrl`
  tal como já existe, sem método novo no serviço) — o navegador segue
  o redirect sozinho, sem cache do redirect em si (senão o navegador
  poderia reusar uma URL assinada já vencida).
- **Layout no menu: logo pequena (ícone quadrado, ~36px) + nome
  fantasia da empresa ao lado** — não é só a logo sozinha, nem um
  banner grande ocupando a largura toda (variações descartadas depois
  de comparação visual). Se a empresa não tiver nome fantasia
  cadastrado, usa a razão social (`name`, sempre presente) como
  fallback.
- **Sem histórico de logos** — cada upload novo substitui o anterior
  (mesmo raciocínio de qualquer outro campo simples da tabela
  `tenants`), o objeto antigo é apagado do R2 depois que o novo já
  está gravado com sucesso.

## 3. Modelo de dados

```sql
ALTER TABLE tenants ADD COLUMN logo_file_key TEXT;
```

Nullable, sem valor padrão — mesmo padrão de toda coluna já adicionada
em `tenants` (`0018_tenants_full_address.sql` é o precedente mais
recente). Sem tabela nova, sem índice, sem RLS própria (`tenants` já
não tem RLS hoje — confirmado em `tenants.service.ts`, comentário
sobre `findAll`/`@Roles('admin')` ser a única barreira).

## 4. Fluxo

### 4.1 Upload / remoção (autenticado, só `empresa`)

`POST /tenants/me/logo` — multipart, campo `file`, limite 2MB,
`@Roles('empresa')`. Mesma validação de mimetype que documentos já
faz (`ALLOWED_MIME_TYPES`), mas só com `image/jpeg`/`image/png`.
Fluxo, espelhando o rollback já usado em `DocumentsService.upload`:

1. Valida mimetype/tamanho (`BadRequestException` se inválido).
2. Gera `fileKey = tenants/${tenantId}/branding/logo-${randomUUID()}.${ext}`
   e grava no R2 (`r2.putObject`).
3. **Antes de atualizar**, faz `SELECT logo_file_key FROM tenants WHERE id = $1`
   pra capturar o valor antigo (um `UPDATE ... RETURNING` só devolveria
   o valor novo, não serve pra saber o que apagar depois).
4. Tenta `UPDATE tenants SET logo_file_key = $1 WHERE id = $2`.
   - Se falhar: apaga o objeto recém-gravado no R2 (best-effort,
     não mascara o erro real) e propaga o erro.
   - Se funcionar: se o passo 3 encontrou um `logo_file_key` antigo,
     apaga esse objeto antigo do R2 (best-effort — uma falha aqui não
     derruba a resposta de sucesso, só um log).
5. Devolve `{ has_logo: true }`.

`DELETE /tenants/me/logo` — `@Roles('empresa')`. Se `logo_file_key`
for `NULL`, no-op (200, sem erro). Senão: apaga o objeto do R2, seta
a coluna pra `NULL`.

### 4.2 Exibição (pública, sem autenticação)

`GET /tenants/:id/logo` — `@Public()`, sem `@Roles`. Uma rota pública
não tem `req.user` (o `TenantContextInterceptor` monta
`req.withTenantContext` a partir de `user?.id`/`user?.tenantId`, que
aqui seriam `undefined`) — usa **`DatabaseService.withoutTenantContext`**
(injetado direto no service, mesmo mecanismo já usado por `CaepiService`
na Fase 17 pra dado sem contexto de tenant), não `req.withTenantContext`.
Busca `logo_file_key` pelo `id` recebido. Se `NULL` ou tenant não
existir: `404`. Senão: `res.redirect(302, await r2.getPresignedDownloadUrl(key))`.

`GET /tenants/me` (já existe) — resposta ganha um campo novo,
`has_logo: boolean` (`logo_file_key IS NOT NULL`), calculado no
`TenantsService.findOne`. **Não devolve uma URL pronta** — o backend
não sabe do prefixo `/api/` que o nginx usa pra rotear pro backend
(`nginx/conf.d/default.conf`, `location /api/ { proxy_pass
http://backend_upstream/; }`), e todo o resto do frontend já monta
esse prefixo na hora de cada `fetch()` (nunca o backend). O frontend
monta a URL da imagem como `` `/api/tenants/${tenant.id}/logo` ``
quando `has_logo` for `true` — `tenant.id` já vem na mesma resposta de
`GET /tenants/me` (campo `id`, já existente).

### 4.3 Frontend — tela "Dados da empresa"

`MatrizForm.tsx` ganha um bloco novo, "Logo da empresa (opcional)":
preview da logo atual (se `has_logo` vier `true` na mesma busca de
`GET /tenants/me` que a tela já faz hoje, monta
`` `/api/tenants/${id}/logo` `` igual à seção 4.4), campo de arquivo
(`accept="image/jpeg,image/png"`), upload dispara na hora ao escolher
o arquivo (`POST /tenants/me/logo`, `FormData`), sem depender do botão
"Salvar" dos outros campos — depois de um upload bem-sucedido, atualiza
o preview local com a resposta (`{ has_logo: true }`) sem precisar
recarregar a página. Com logo existente, mostra um botão "Remover
logo" (`DELETE /tenants/me/logo`, some o preview e volta ao estado
"sem logo" na resposta bem-sucedida).

### 4.4 Frontend — menu lateral da empresa

`EmpresaSidebar.tsx` passa a ser um componente com estado: busca
`GET /tenants/me` num `useEffect` (mesmo token de `localStorage`/
`getToken()` já usado no resto do app). Enquanto carrega ou se a
busca falhar, mostra "Montese SST" (comportamento atual, nunca pisca
vazio). Com dado carregado:

- `has_logo === true` → `<img src={`/api/tenants/${tenant.id}/logo`}>`
  (~36×36, `object-cover`, cantos arredondados) + `{trade_name ?? name}`
  ao lado, truncando se o nome for longo pro espaço de 224px do menu.
- `has_logo === false` → mantém o `<h1>Montese SST</h1>` exatamente
  como hoje.

`TecnicoSidebar.tsx` **não é alterado nesta fase** — continua sempre
"Montese SST" (decisão fechada, seção 2).

## 5. Fora de escopo

- Qualquer personalização de logo no site institucional público, em
  e-mails transacionais, ou nos PDFs de ata de CIPA — candidatos
  óbvios pra uma frente futura, mas não pedidos aqui.
- Recorte/crop de imagem no upload — a empresa sobe a imagem já do
  jeito que quer que apareça; sem editor de imagem embutido.
- Histórico de logos anteriores.
- Qualquer mudança no `TecnicoSidebar.tsx` além do que a fase anterior
  (cor/fonte) já fez.
