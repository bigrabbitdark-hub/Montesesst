# Fase 4 (sub-projeto B — Score de SST + Pendências) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à empresa e ao técnico responsável um indicador de
conformidade (score em % + lista de pendências/avisos), calculado a
partir dos documentos que já existem — sem tabela nova, sem migration.

**Architecture:** Um endpoint novo (`GET /documents/compliance`) no
módulo `documents` já existente, que lê a mesma tabela `documents` (RLS
já garante o isolamento certo) e calcula score/pendências/avisos em
TypeScript puro. No frontend, o resultado entra dentro do próprio
`DocumentsPanel.tsx` (componente já compartilhado entre empresa e
técnico) — aparece nas duas telas automaticamente, sem duplicar nada.

**Tech Stack:** NestJS + `pg` (PoolClient) no backend, React/Next.js 14
no frontend — mesmo stack de todo o projeto, nenhuma dependência nova.

**Spec:** [`docs/specs/fase-4-score-pendencias.md`](../specs/fase-4-score-pendencias.md)

## Global Constraints

- Só documentos com `expires_at` preenchido entram no cálculo — um
  documento sem vencimento não conta nem a favor nem contra.
- Score = `null` quando não existe nenhum documento com `expires_at`
  preenchido (nunca `0%` nem `100%` nesse caso).
- Pendência = `expires_at` no passado (estritamente antes de hoje).
  Aviso = `expires_at` entre hoje (inclusive) e 30 dias no futuro. Mais
  de 30 dias no futuro não aparece em nenhuma das duas listas.
- Mesma regra de `tenant_id` já usada em `GET /documents`: `tecnico`
  precisa passar `?tenant_id=` (400 se ausente), `empresa` não precisa
  (RLS já restringe ao próprio tenant automaticamente).
- Testes: e2e reais contra Postgres real do Docker (rede
  `montese_internal`), sem mock de banco — mesmo padrão de todas as
  fases anteriores. Fixtures de `documents` para estes testes são
  inseridas diretamente via SQL (conexão de superuser do `TestDb`,
  mesmo padrão já usado em `documents-rls.e2e-spec.ts` do sub-projeto
  A) — este sub-projeto testa a lógica de cálculo em cima de linhas já
  existentes na tabela, não o pipeline de upload/R2 em si (isso já foi
  exaustivamente provado no sub-projeto A). Comando de teste completo,
  mesmo formato já usado nas fases anteriores:
  ```bash
  set -a; source /opt/Montese/.env; set +a
  docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
    -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
    -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
    -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
    -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
    -e PUBLIC_APP_URL="https://example.com" \
    -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
    -e AUTH_RATE_LIMIT_MAX=10 -e AUTH_RATE_LIMIT_WINDOW_SECONDS=900 \
    -e REGISTER_RATE_LIMIT_MAX=5 -e REGISTER_RATE_LIMIT_WINDOW_SECONDS=3600 \
    -e CONTACT_EMAIL_TO="comercial@teste.montese.local" \
    -e CONTACT_RATE_LIMIT_MAX=10 -e CONTACT_RATE_LIMIT_WINDOW_SECONDS=3600 \
    -e MERCADOPAGO_ACCESS_TOKEN="${MERCADOPAGO_ACCESS_TOKEN}" \
    -e R2_ACCOUNT_ID="${R2_ACCOUNT_ID}" -e R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
    -e R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" -e R2_BUCKET="${R2_BUCKET}" \
    -e R2_ENDPOINT="${R2_ENDPOINT}" \
    node:20-alpine sh -c "npm run test:e2e"
  ```
  (`PUBLIC_APP_URL="https://example.com"` — mesma ressalva já documentada
  em fases anteriores, necessária só pro `subscriptions.e2e-spec.ts`
  já existente continuar passando; um flake ocasional em
  `register.e2e-spec.ts` no full-suite run já foi investigado antes —
  rodar de novo se acontecer, não é regressão.)
- Frontend: qualquer falha de rede/API neste sub-projeto deve aparecer
  visível pra pessoa (reaproveitar o `listError` já existente em
  `DocumentsPanel.tsx`, não inventar um padrão novo de erro silencioso —
  isso já foi um achado real corrigido no sub-projeto A, não repetir).

---

### Task 1: Backend — `GET /documents/compliance`

**Files:**
- Modify: `backend/src/documents/documents.service.ts`
- Modify: `backend/src/documents/documents.controller.ts`
- Test: `backend/test/documents-compliance.e2e-spec.ts`

**Interfaces:**
- Consumes: tabela `documents` (já existe, sub-projeto A) — só lê,
  nenhuma escrita.
- Produces: `DocumentsService.getCompliance(client, tenantId?):
  Promise<ComplianceResult>` onde `ComplianceResult = { score: number |
  null; pendencias: ComplianceItem[]; avisos: ComplianceItem[] }` e
  `ComplianceItem = { id: string; category: string; title: string;
  expires_at: string; dias_vencido?: number; dias_restantes?: number }`
  — Task 2 (frontend) consome exatamente esse shape JSON de `GET
  /documents/compliance`.

- [ ] **Step 1: Adicionar o método ao service**

Em `backend/src/documents/documents.service.ts` — adicionar as duas
interfaces novas no nível do módulo (junto de `Document`, não dentro da
classe) e o método novo na classe (depois de `findAll`, mantém tudo que
já existe intacto):

```typescript
export interface ComplianceItem {
  id: string;
  category: string;
  title: string;
  expires_at: string;
  dias_vencido?: number;
  dias_restantes?: number;
}

export interface ComplianceResult {
  score: number | null;
  pendencias: ComplianceItem[];
  avisos: ComplianceItem[];
}
```

```typescript
  async getCompliance(client: PoolClient, tenantId?: string): Promise<ComplianceResult> {
    const rows = tenantId
      ? (
          await client.query<ComplianceItem>(
            `SELECT id, category, title, expires_at FROM documents
             WHERE expires_at IS NOT NULL AND tenant_id = $1
             ORDER BY expires_at ASC`,
            [tenantId],
          )
        ).rows
      : (
          await client.query<ComplianceItem>(
            `SELECT id, category, title, expires_at FROM documents
             WHERE expires_at IS NOT NULL
             ORDER BY expires_at ASC`,
          )
        ).rows;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pendencias: ComplianceItem[] = [];
    const avisos: ComplianceItem[] = [];
    let emDiaCount = 0;

    for (const row of rows) {
      const expiresAt = new Date(row.expires_at);
      expiresAt.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expiresAt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        pendencias.push({ ...row, dias_vencido: -diffDays });
      } else if (diffDays <= 30) {
        avisos.push({ ...row, dias_restantes: diffDays });
        emDiaCount++;
      } else {
        emDiaCount++;
      }
    }

    const score = rows.length === 0 ? null : Math.round((emDiaCount / rows.length) * 100);
    return { score, pendencias, avisos };
  }
```

- [ ] **Step 2: Adicionar o endpoint ao controller**

Em `backend/src/documents/documents.controller.ts` — adicionar o método
novo, colocado logo depois de `findAll` (antes de `download`):

```typescript
  @Get('compliance')
  compliance(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    if (req.user.role === 'tecnico' && !tenantId) {
      throw new BadRequestException('tenant_id é obrigatório');
    }
    return req.withTenantContext((client: any) => this.documents.getCompliance(client, tenantId));
  }
```

Nenhum import novo é necessário — `Get`, `Query`, `Req`,
`BadRequestException` já estão importados no topo do arquivo (usados
por `findAll`).

- [ ] **Step 3: Escrever o teste**

`backend/test/documents-compliance.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /documents/compliance (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  const insertedDocIds: string[] = [];

  function isoDateDaysFromNow(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  async function insertDocument(category: string, title: string, expiresAt: string | null): Promise<string> {
    const result = await (db as any).client.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, $2, $3, 'test-key', 'test.pdf', 'application/pdf', 100, $4, (SELECT id FROM users WHERE tenant_id = $1 LIMIT 1), 'empresa')
       RETURNING id`,
      [tenantId, category, title, expiresAt],
    );
    const id = result.rows[0].id;
    insertedDocIds.push(id);
    return id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Compliance Teste');
    tenantId = tenant.tenantId;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;
  });

  afterAll(async () => {
    if (insertedDocIds.length > 0) {
      await (db as any).client.query('DELETE FROM documents WHERE id = ANY($1)', [insertedDocIds]);
    }
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('classifica vencido/aviso/em-dia e calcula o score corretamente', async () => {
    await insertDocument('pgr', 'PGR Vencido', isoDateDaysFromNow(-10));
    await insertDocument('ficha_epi', 'Ficha Vencendo', isoDateDaysFromNow(15));
    await insertDocument('laudo', 'Laudo Em Dia', isoDateDaysFromNow(90));
    await insertDocument('treinamento', 'Sem Vencimento', null);

    const res = await request(app.getHttpServer())
      .get('/documents/compliance')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // 3 documentos com expires_at (o "Sem Vencimento" fica de fora):
    // 1 vencido, 2 em dia (1 deles em aviso) -> score = round(2/3*100) = 67
    expect(res.body.score).toBe(67);
    expect(res.body.pendencias).toHaveLength(1);
    expect(res.body.pendencias[0].title).toBe('PGR Vencido');
    expect(res.body.pendencias[0].dias_vencido).toBe(10);
    expect(res.body.avisos).toHaveLength(1);
    expect(res.body.avisos[0].title).toBe('Ficha Vencendo');
    expect(res.body.avisos[0].dias_restantes).toBe(15);
  });

  it('retorna score null quando não há documento com vencimento definido', async () => {
    const emptyTenant = await db.createTenantWithUser('Empresa Compliance Vazia');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: emptyTenant.email, password: emptyTenant.password });

    const res = await request(app.getHttpServer())
      .get('/documents/compliance')
      .set('Authorization', `Bearer ${loginRes.body.access_token}`);

    expect(res.status).toBe(200);
    expect(res.body.score).toBeNull();
    expect(res.body.pendencias).toHaveLength(0);
    expect(res.body.avisos).toHaveLength(0);
  });

  it('exige tenant_id quando quem chama é técnico', async () => {
    const tech = await db.createUserWithRole('tecnico', 'Tecnico Compliance Teste');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });

    const res = await request(app.getHttpServer())
      .get('/documents/compliance')
      .set('Authorization', `Bearer ${loginRes.body.access_token}`);

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/documents-compliance.e2e-spec.ts"
```

Esperado: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add backend/src/documents backend/test/documents-compliance.e2e-spec.ts
git commit -m "feat: adiciona GET /documents/compliance (score de SST + pendencias)"
```

---

### Task 2: Frontend — bloco de conformidade no `DocumentsPanel`

**Files:**
- Modify: `frontend/src/components/DocumentsPanel.tsx`

**Interfaces:**
- Consumes: `GET /api/documents/compliance` (Task 1), resposta
  `{score, pendencias, avisos}` conforme definido acima.
- Produces: nenhuma — última peça desta sub-fase.

- [ ] **Step 1: Adicionar os tipos e o estado**

Em `frontend/src/components/DocumentsPanel.tsx` — adicionar as duas
interfaces novas logo depois de `DocumentRow` (antes de
`CATEGORY_LABELS`):

```typescript
interface ComplianceItem {
  id: string;
  category: string;
  title: string;
  expires_at: string;
  dias_vencido?: number;
  dias_restantes?: number;
}

interface ComplianceResult {
  score: number | null;
  pendencias: ComplianceItem[];
  avisos: ComplianceItem[];
}
```

Dentro do componente, adicionar o estado novo junto dos outros
`useState` já existentes:

```typescript
  const [compliance, setCompliance] = useState<ComplianceResult | null>(null);
```

- [ ] **Step 2: Adicionar `complianceUrl()` e `loadCompliance()`**

Logo depois da função `listUrl()` já existente:

```typescript
  function complianceUrl(): string {
    return tenantId ? `/api/documents/compliance?tenant_id=${tenantId}` : '/api/documents/compliance';
  }

  async function loadCompliance() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(complianceUrl(), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setCompliance(await res.json());
      } else {
        setListError('Não foi possível carregar o score de conformidade.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
  }
```

- [ ] **Step 3: Chamar `loadCompliance()` nos mesmos pontos que `loadDocuments()`**

No `useEffect` inicial, chamar as duas funções:

```typescript
  useEffect(() => {
    loadDocuments();
    loadCompliance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Em `handleUpload`, dentro do bloco `if (res.ok) { ... }` (onde já chama
`loadDocuments();` depois de limpar o formulário), adicionar
`loadCompliance();` logo depois — um novo documento pode mudar o score:

```typescript
      if (res.ok) {
        setTitle('');
        setExpiresAt('');
        setFile(null);
        setStatus('idle');
        loadDocuments();
        loadCompliance();
        return;
      }
```

Em `handleDelete`, dentro do `if (res.ok) loadDocuments();`, trocar por:

```typescript
      if (res.ok) {
        loadDocuments();
        loadCompliance();
      } else {
        setListError('Não foi possível apagar o documento.');
      }
```

(a linha `else` já existe do sub-projeto A — só está sendo mostrada aqui
pra deixar claro onde a chamada nova entra, não precisa duplicar a
lógica de erro que já está lá.)

- [ ] **Step 4: Adicionar o bloco de conformidade no JSX**

Dentro do `return`, como o **primeiro filho** de
`<div className="flex flex-col gap-8">` (antes da seção "Enviar
documento"):

```tsx
      {compliance && (
        <section className="rounded-lg border border-brand-100 p-6">
          <h2 className="text-lg font-bold text-brand-900">Conformidade</h2>
          <p className="mt-2 text-3xl font-bold text-brand-900">
            {compliance.score === null ? 'Sem dados ainda' : `${compliance.score}%`}
          </p>
          {compliance.pendencias.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-bold text-red-600">Pendências</h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-red-600">
                {compliance.pendencias.map((item) => (
                  <li key={item.id}>
                    {CATEGORY_LABELS[item.category]} — {item.title} (venceu há {item.dias_vencido} dia(s))
                  </li>
                ))}
              </ul>
            </div>
          )}
          {compliance.avisos.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-bold text-yellow-700">Vencendo em breve</h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-yellow-700">
                {compliance.avisos.map((item) => (
                  <li key={item.id}>
                    {CATEGORY_LABELS[item.category]} — {item.title} (vence em {item.dias_restantes} dia(s))
                  </li>
                ))}
              </ul>
            </div>
          )}
          {compliance.score !== null && compliance.pendencias.length === 0 && compliance.avisos.length === 0 && (
            <p className="mt-4 text-sm text-green-700">Tudo em dia.</p>
          )}
        </section>
      )}
```

- [ ] **Step 5: Build de produção e verificação real**

```bash
docker run --rm -v "$(pwd)/frontend:/app" -w /app node:20-alpine npm run build
docker compose up -d --build frontend
sleep 3
```

Verificação real (não só build/curl de existência — este sub-projeto já
teve um achado de verificação rasa na fase anterior, não repetir):
usando a empresa seed (`rh-a@seed.montese.local` / `Seed@Montese123`),
logar de verdade, chamar `GET /api/documents/compliance` real via curl
com o token, confirmar que a resposta bate com o que a empresa seed
realmente tem cadastrado (ou `score: null` se ela não tiver nenhum
documento com vencimento ainda), e confirmar via `curl` que a página
`/empresa/documentos` continua respondendo `200` depois da mudança
(prova que o build não quebrou a página, mesmo sem poder clicar num
navegador real).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/DocumentsPanel.tsx
git commit -m "feat: adiciona bloco de score de SST e pendencias ao DocumentsPanel"
```

---

### Task 3: Integração final, deploy real e documentação

**Files:**
- Modify: `docs/roadmap.md`

**Interfaces:**
- Consumes: tudo das Tasks 1-2.
- Produces: nenhuma — task de fechamento.

- [ ] **Step 1: Rebuild e deploy dos containers reais desta VPS**

```bash
docker compose build backend frontend
docker compose up -d backend frontend
sleep 3
docker compose ps
```

Esperado: `montese_backend` e `montese_frontend` com status `Up`.

- [ ] **Step 2: Suíte e2e completa, sem regressão**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e PUBLIC_APP_URL="https://example.com" \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  -e AUTH_RATE_LIMIT_MAX=10 -e AUTH_RATE_LIMIT_WINDOW_SECONDS=900 \
  -e REGISTER_RATE_LIMIT_MAX=5 -e REGISTER_RATE_LIMIT_WINDOW_SECONDS=3600 \
  -e CONTACT_EMAIL_TO="comercial@teste.montese.local" \
  -e CONTACT_RATE_LIMIT_MAX=10 -e CONTACT_RATE_LIMIT_WINDOW_SECONDS=3600 \
  -e MERCADOPAGO_ACCESS_TOKEN="${MERCADOPAGO_ACCESS_TOKEN}" \
  -e R2_ACCOUNT_ID="${R2_ACCOUNT_ID}" -e R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
  -e R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" -e R2_BUCKET="${R2_BUCKET}" \
  -e R2_ENDPOINT="${R2_ENDPOINT}" \
  node:20-alpine sh -c "npm run test:e2e"
```

Esperado: todas as suites `PASS`, incluindo a nova desta fase.

- [ ] **Step 3: Smoke test real via `curl`**

```bash
curl -s -o /dev/null -w "/empresa/documentos -> %{http_code}\n" https://montesesst.com.br/empresa/documentos
curl -s -o /dev/null -w "GET /api/documents/compliance sem token -> %{http_code}\n" https://montesesst.com.br/api/documents/compliance
```

Esperado: `200` na página; `401` no endpoint sem token.

- [ ] **Step 4: Atualizar `docs/roadmap.md`**

Adicionar uma seção "Fase 4 (sub-projeto B — Score de SST + Pendências):
status", mesmo formato de tabela já usado nas fases anteriores, listando
as 2 tasks de código e a evidência real do smoke test. Marcar como
fechada — sem pendência bloqueante, não depende de nenhuma ação externa
do fundador.

- [ ] **Step 5: Commit final**

```bash
git add docs/roadmap.md
git commit -m "docs: fecha Fase 4 sub-projeto B (Score de SST + Pendencias)"
```
