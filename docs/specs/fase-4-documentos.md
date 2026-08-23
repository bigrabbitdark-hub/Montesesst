# Fase 4 (sub-projeto A) — Documentos

> Primeiro sub-projeto da Fase 4 (Dashboard Empresa: score de SST,
> pendências, documentos, agenda). Decisão confirmada em brainstorming de
> 2026-08-23: documentos vem primeiro — é o que a empresa mais precisa
> ver, e score/pendências praticamente dependem dele (documento vencido =
> pendência; % de documentos em dia = score). As outras três peças ficam
> para sub-projetos seguintes da Fase 4, cada uma com sua própria spec.

## 1. Objetivo e escopo

Dar à empresa e ao seu técnico responsável um repositório real de
documentos de conformidade (PGR, PCMSO, laudos, fichas de EPI,
treinamentos) — upload, listagem, download e exclusão — armazenado em
object storage externo (Cloudflare R2, já configurado nesta VPS), nunca
no disco da VPS, conforme princípio não-negociável de arquitetura
(`docs/vision.md`, seção 8, item 2).

**Não é objetivo desta sub-fase:**
- Calcular score de conformidade (%) ou lista de pendências — vem depois,
  como sub-projeto seguinte da Fase 4, consumindo os dados que esta
  sub-fase cria (`expires_at` de cada documento).
- Modelar o catálogo relacional de EPI (CA por equipamento, vínculo
  funcionário↔EPI com assinatura) descrito em
  `docs/reference/modelos-relatorios-sst.md` — "ficha de EPI" aqui é só
  mais uma categoria de documento (um PDF/foto que alguém sobe), não o
  modelo relacional completo. Esse modelo mais rico fica para quando a
  Fase 5 (checklist de visita técnica) existir, seguindo seu próprio
  ciclo de brainstorm → spec → plano.
- Fluxo self-service de vínculo empresa↔técnico (empresa escolher/pedir
  um técnico, técnico aceitar) — o vínculo é criado manualmente pela
  Montese (admin) nesta fase, mesmo critério do diferencial de
  atendimento humano descrito no `docs/vision.md`.

## 2. Modelo de dados

### 2.1 `tenant_technicians` — já existe, endpoint de vínculo já existe (corrigido pra admin-only nesta sub-fase)

```sql
CREATE TABLE tenant_technicians (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status record_status NOT NULL DEFAULT 'ativo',
  PRIMARY KEY (tenant_id, technician_id)
);
```

Criada na migration `0001_init.sql`. **Achado durante o desenho desta
sub-fase, corrigindo uma suposição errada de uma versão anterior desta
spec:** `POST/DELETE /technicians/:id/assign` já existe desde a Fase 1
(`backend/src/technicians/technicians.controller.ts`,
`TechniciansService.assign`/`unassign`) e já faz o INSERT/DELETE em
`tenant_technicians` — mas nunca foi testado (nenhum e2e cobre esse
endpoint) nem ligado a nenhuma tela, e hoje tem `@Roles('empresa',
'admin')`, permitindo a própria empresa se auto-vincular a qualquer
técnico sem intermediação humana — o que contradiz o diferencial de
atendimento humano do `docs/vision.md` e a decisão tomada nesta mesma
sessão de brainstorming. Corrigido: `assign`/`unassign` passam a ser
`@Roles('admin')` apenas (remove `'empresa'` da lista). O resto do
endpoint (lógica de `assign`/`unassign`, `AssignTechnicianDto`) já está
correto e é reaproveitado como está — não precisa recriar do zero.

### 2.2 `documents` — tabela nova

```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (
    category IN ('pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento')
  ),
  title TEXT NOT NULL,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  expires_at DATE,
  uploaded_by_user_id UUID NOT NULL REFERENCES users(id),
  uploaded_by_role TEXT NOT NULL CHECK (uploaded_by_role IN ('empresa', 'tecnico')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- `file_key`: caminho do objeto no bucket R2 (`tenants/{tenant_id}/documents/{id}/{file_name}`
  — usa o próprio UUID do documento no caminho, evita colisão de nome).
- `expires_at`: opcional (nem todo documento vence) — campo que o
  próximo sub-projeto da Fase 4 (score/pendências) vai consumir pra
  calcular o que está vencido, sem precisar de migration nova depois.
- `uploaded_by_role`: guardado explicitamente (não só derivado de
  `users.role`, que pode teoricamente mudar) — usado na regra de
  permissão de exclusão (seção 3.3).

### 2.3 RLS de `documents` — política nova, mais complexa que o padrão usual

Diferente de `employees`/`company_units`/`subscriptions` (onde RLS
compara só `tenant_id = app.tenant_id`), aqui um técnico também precisa
enxergar documentos de **qualquer tenant ao qual ele esteja vinculado**
via `tenant_technicians` — o técnico não tem um `tenant_id` próprio (é
`NULL` pra esse papel), então a policy precisa checar o vínculo via
`EXISTS`, não uma comparação direta de coluna:

```sql
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY documents_isolation ON documents USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = documents.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
);
```

Sem `WITH CHECK` separado — por padrão do Postgres, uma policy `FOR ALL`
com só `USING` aplica a mesma expressão em INSERT/UPDATE também, então
um técnico só consegue inserir documento pra um tenant ao qual já está
vinculado (a query de `EXISTS` roda igual na hora do INSERT).

## 3. Backend

### 3.1 Vínculo técnico↔empresa — corrige o endpoint existente, adiciona a listagem do técnico

- `backend/src/technicians/technicians.controller.ts`: `assign`/`unassign`
  trocam `@Roles('empresa', 'admin')` por `@Roles('admin')` — única
  mudança nesses dois métodos, resto do arquivo intacto. `AssignTechnicianDto`
  e `TechniciansService.assign`/`unassign` não mudam (já fazem exatamente
  o INSERT/DELETE certo em `tenant_technicians`). A Montese (admin) aciona
  `POST /technicians/:id/assign` via API diretamente por enquanto — sem
  tela de Dashboard Admin (Fase 7 ainda não existe).
- `GET /tenant-technicians/me` (`@Roles('tecnico')`, módulo novo
  `tenant-technicians`) — lista as empresas vinculadas ao técnico
  autenticado (join `technicians.user_id = req.user.id` →
  `tenant_technicians` → `tenants`, retorna `{tenant_id, tenant_name,
  tenant_cnpj}` por linha). Alimenta a tela do técnico escolher qual
  empresa ver (seção 4.2). Este é o único endpoint genuinamente novo
  desta seção — a criação do vínculo em si já existe, só a listagem pro
  lado do técnico que faltava.

### 3.2 Upload — `POST /documents`

`@Roles('empresa', 'tecnico')`, `multipart/form-data` via
`FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } })`
(mesmo padrão já usado em `POST /employees/import`, Fase 3).

Campos do form: `category` (uma das 5 fixas), `title`, `expires_at`
(opcional, `YYYY-MM-DD`), e `tenant_id` (só lido quando quem envia é
`tecnico` — precisa escolher pra qual das empresas vinculadas está
subindo; quando quem envia é `empresa`, sempre usa o próprio
`req.user.tenantId`, `tenant_id` do body é ignorado, mesma regra já
estabelecida pra `tenants` na Fase 3 — nunca confiar em id de tenant
vindo de fora quando existe uma fonte mais confiável).

Validação **antes** de tocar no R2 (fail fast, não gasta upload num
arquivo que vai ser rejeitado):
1. `mimetype` precisa ser `application/pdf`, `image/jpeg` ou `image/png`
   — outros tipos rejeitados com 400 antes do upload.
2. Tamanho já limitado pelo multer (10MB, acima disso o multer rejeita
   antes mesmo do controller rodar).
3. `category` precisa ser uma das 5 válidas (senão 400).

Fluxo: valida → gera o `id` do documento (`gen_random_uuid()` no
`INSERT ... RETURNING id`, ou gerado no service antes do upload pra já
montar o `file_key` — decisão de implementação, não muda o contrato) →
envia o arquivo pro R2 (`PutObjectCommand`, SDK S3 — ver seção 3.4) →
insere a linha em `documents` com o `file_key` real. Se o upload pro R2
falhar, não insere a linha (evita metadado órfão apontando pra um
arquivo que não existe).

### 3.3 Listagem, download e exclusão

- `GET /documents` — sem `@Roles` (RLS decide o que aparece).
  - Quando quem chama é `empresa`: sem filtro adicional necessário (RLS
    já restringe ao próprio tenant).
  - Quando quem chama é `tecnico`: **exige** query param `?tenant_id=`
    (400 se ausente) — o técnico pode estar vinculado a várias empresas,
    então a listagem sempre precisa ser de uma de cada vez (a RLS já
    impede ver uma empresa não vinculada; o filtro por query param é só
    pra UX, escolher qual das permitidas mostrar agora).
- `GET /documents/:id/download` — gera uma URL pré-assinada de leitura
  do R2 (`GetObjectCommand` + `getSignedUrl`, validade curta, 5 minutos)
  e retorna `{url}` — o navegador baixa direto do R2, sem o arquivo
  passar de novo pelo backend. Diferente do upload (que passa pelo
  backend por segurança), uma URL assinada de **leitura**, de curta
  duração, pra um objeto que já existe, não abre a mesma superfície de
  risco que aceitar upload direto abriria.
- `DELETE /documents/:id` (`@Roles('empresa', 'tecnico')`) — só quem
  subiu o documento pode apagar (`uploaded_by_user_id = req.user.id`,
  checado no service antes de deletar; RLS já impede ver/mexer em
  documento de tenant não autorizado, esta checagem adicional é sobre
  *quem dentro do tenant autorizado* pode apagar). Admin pode apagar
  qualquer um. Ao apagar, remove o objeto do R2 (`DeleteObjectCommand`)
  e a linha do banco.

### 3.4 Cliente R2 (S3-compatible)

Dependência nova: `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner`
(R2 é compatível com a API S3, funciona com o SDK oficial da AWS
apontando pro endpoint do R2).

```typescript
new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});
```

Credenciais já configuradas no `.env` real desta VPS (`R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`) —
token de conta restrito a permissão de leitura/gravação de objeto, só no
bucket `montese-documentos`, confirmado em 2026-08-22.

## 4. Frontend

### 4.1 Empresa — `/empresa/documentos` (página nova)

Lista os documentos do tenant (categoria, título, vencimento se houver,
quem subiu, data), formulário de upload (categoria, título, arquivo,
vencimento opcional), link de download por documento, botão de apagar
só nos documentos que o próprio usuário subiu.

### 4.2 Técnico — primeira página autenticada do técnico

Hoje o login não redireciona `tecnico` pra lugar nenhum específico (vai
pra `/`, mesmo destino de `parceiro`/`admin`, decisão da Fase 3). Esta
sub-fase muda isso só para `tecnico`:

- `frontend/src/app/login/page.tsx`: `role === 'empresa' ?
  '/empresa/onboarding' : role === 'tecnico' ? '/tecnico/empresas' : '/'`.
- `/tecnico/empresas` (página nova): lista as empresas vinculadas
  (`GET /tenant-technicians/me`), cada uma leva pra
  `/tecnico/empresas/[tenantId]` (rota dinâmica).
- `/tecnico/empresas/[tenantId]` (página nova): mesma UI de documentos
  da empresa (lista + upload + download + apagar), mas chamando
  `GET/POST /documents?tenant_id=[tenantId]` explicitamente, já que o
  técnico não tem um tenant "implícito" como a empresa tem.

## 5. Testes

Mesmo padrão rigoroso já usado no projeto inteiro: e2e reais, sem mock.
Aqui isso significa **subir e apagar arquivos de verdade no bucket R2
real** (não um emulador tipo LocalStack) — mesma régua já aplicada ao
Mercado Pago sandbox e à Resend real. Arquivos de teste usam um prefixo
identificável (`file_key` começando com `tenants/{tenant_id}/documents/`
já é suficiente pra identificar, já que `tenant_id` de teste nunca é um
tenant real) e cada teste apaga o que criou ao final (`afterAll`/
`afterEach`), confirmando via `HeadObjectCommand` (ou tentativa de
`GetObjectCommand` esperando erro) que o objeto realmente sumiu do R2,
não só que a linha do Postgres foi removida.

Casos obrigatórios:
- Upload real de um PDF pequeno → aparece em `GET /documents` → download
  real via a URL assinada retorna o conteúdo correto → delete real
  confirma remoção no R2 e no Postgres.
- Tipo de arquivo não permitido (ex: `.exe`) rejeitado com 400, sem
  chegar a tocar no R2.
- RLS: uma empresa não vê documento de outra (mesmo padrão de teste já
  usado em `company-units-rls.e2e-spec.ts`).
- RLS: técnico vinculado a uma empresa vê os documentos dela; técnico
  **não** vinculado não vê (a policy com `EXISTS` precisa ser provada
  nos dois sentidos, positivo e negativo).
- `DELETE` por quem não subiu o documento (mesmo dentro do tenant
  autorizado) é rejeitado.
- `POST /technicians/:id/assign` rejeita chamada de role `empresa` com
  403 (prova a correção da seção 3.1 — antes desta sub-fase, uma empresa
  conseguia chamar isso).

## 6. Decisões confirmadas (brainstorming de 2026-08-23)

| Decisão | Escolha |
|---|---|
| Ordem da Fase 4 | Documentos primeiro; score/pendências/agenda ficam para sub-projetos seguintes |
| Quem sobe documento | Empresa e técnico responsável, os dois |
| Vínculo empresa↔técnico | Atribuído manualmente pela Montese (admin), não self-service |
| Categorias de documento | Fixas: PGR, PCMSO, laudo, ficha de EPI, treinamento |
| Vencimento | Campo opcional, já no modelo de dados desde agora |
| Quem pode apagar | Só quem subiu (ou admin) |
| Tipos de arquivo | PDF, JPG, PNG, até 10MB |
| Caminho do upload | Passa pelo backend (valida, então envia pro R2) — não upload direto do navegador |
| Download | URL pré-assinada de leitura, curta duração, direto do R2 |

## 7. Pendências

- [ ] **Score de SST e pendências** — sub-projeto seguinte da Fase 4,
      consome `documents.expires_at`.
- [ ] **Agenda** — sub-projeto seguinte da Fase 4, spec própria.
- [ ] **Catálogo relacional de EPI** (CA por equipamento, vínculo
      funcionário↔EPI) — fora de escopo, fica para quando a Fase 5
      (checklist de visita técnica) existir.
- [ ] **Vínculo self-service empresa↔técnico** — não é mais pendência
      futura, é uma falha real de permissão já existente desde a Fase 1
      (`POST /technicians/:id/assign` aceitava `role: 'empresa'`), sendo
      corrigida dentro desta própria sub-fase (seção 3.1). Registrado
      aqui só como referência histórica, não como trabalho a fazer
      depois.
- [ ] **Verificação de CA no CAEPI/consultaca.com** (mencionada em
      `docs/reference/modelos-relatorios-sst.md` como sugestão pro
      modelo de EPI) — não se aplica a esta sub-fase (aqui não existe
      catálogo de EPI, só upload de documento genérico).
