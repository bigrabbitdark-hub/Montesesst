# Fase 9 — RAG Normativo — Plano de Implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans pra implementar este plano tarefa por tarefa. Passos usam checkbox (`- [ ]`) pra rastreio.

**Objetivo:** dar ao Montese SST um "Assistente" que responde perguntas normativas de SST (empresa e técnico/parceiro) sempre ancorado em fonte oficial vigente, alimentado por uma base de normas mantida por monitoramento automático + validação humana obrigatória.

**Arquitetura:** três tabelas novas sem `tenant_id`/RLS (base compartilhada, mesma categoria de `epi_catalog_items`); um job agendado (`@nestjs/schedule`) que detecta mudança nas fontes oficiais e cria versões `aguardando_validacao`; um fluxo admin de aprovação que indexa o texto em pedaços com embedding (`pgvector`); um endpoint de consulta que busca por similaridade e passa por um Verificador determinístico (checagem de código, não uma segunda IA) antes de qualquer afirmação chegar ao usuário.

**Tech Stack:** NestJS + `pg` (backend), `pgvector` no Postgres 16 (`pgvector/pgvector:pg16`), OpenRouter (chat + embeddings, mesma chave da Fase 8), `pdf-parse`, `@nestjs/schedule`, Next.js App Router (frontend), Jest + Supertest (e2e, sem mock de banco).

**Spec:** [`docs/specs/fase-9-rag-normativo.md`](../specs/fase-9-rag-normativo.md)

## Global Constraints

- **Próximo número de migration é `0021`.**
- **Troca da imagem do Postgres e `CREATE EXTENSION vector` são passos manuais via superuser, ANTES da migration 0021 — não dentro dela.** A migration roda com `DATABASE_URL` (role `montese_app`, sem privilégio garantido de `CREATE EXTENSION`); criar tabela com coluna `vector(1536)` depois que a extensão já existe não exige privilégio especial. Isso é uma correção sobre a spec seção 3, que descrevia a criação da extensão como "uma migration" — na prática, fazer isso via superuser evita qualquer risco de falha de permissão em produção.
- **`official_sources`/`normative_documents`/`normative_document_chunks` não têm `tenant_id` nem RLS.** Base compartilhada entre todos os clientes — controle de acesso só via `@Roles()`, mesma categoria de `epi_catalog_items`.
- **Correção sobre a spec seção 4.2:** o monitor compara o hash recém-buscado com o hash do **`normative_document` mais recente da fonte, qualquer status** (`ORDER BY created_at DESC LIMIT 1`), não só o `vigente`. Comparar só com `vigente` recriaria uma linha `aguardando_validacao` duplicada a cada execução do job enquanto a mesma versão ficasse pendente de revisão (ou já tivesse sido rejeitada) — a intenção da spec ("detectar mudança real") só se sustenta comparando com o estado mais recente conhecido, seja ele qual for.
- **`approve()` nunca deixa falha de indexação desfazer a aprovação.** A troca de status (`vigente`/`substituido`) e a indexação (fatiar + gerar embedding + inserir chunks) acontecem na mesma chamada de método, mas a indexação tem seu próprio `try/catch` interno — se falhar, loga e retorna normalmente com `indexed_at` ainda `NULL`. Deixar o erro escapar faria o `withTenantContext` do controller reverter a transação inteira, inclusive a aprovação.
- **Embeddings entram/saem do Postgres como literal de texto `'[v1,v2,...]'::vector`.** O driver `pg` não tem tipo nativo pra `vector` — todo INSERT/SELECT que toca a coluna `embedding` passa o array serializado como string e faz cast explícito `$N::vector` na query.
- **Citação do Assistente sempre aponta pro arquivo salvo no R2 (`GET /normative-documents/:id/download`), nunca pro `official_url` direto.** O R2 guarda exatamente o que foi indexado; a URL externa pode mudar de conteúdo sem o sistema saber. Esse endpoint só serve documentos com `status = 'vigente'` (404 pros demais) — conteúdo pendente/rejeitado não é pra chegar em usuário final.
- **Todo arquivo de teste novo termina em `.e2e-spec.ts`** — é o único padrão que `test/jest-e2e.json` reconhece (`testRegex: ".e2e-spec.ts$"`), mesmo para lógica pura sem I/O (ex.: fatiamento de texto).
- **A única coisa mockada em teste é a chamada de IA paga** (embedding e chat) — via `overrideProvider` (DI) ou `jest.spyOn(global, 'fetch')`, mesmo padrão já usado em `ai-copilot-openrouter-extractor.e2e-spec.ts`. Postgres/Redis são sempre reais.
- **Comando de teste:** `docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app -e DATABASE_URL=... -e TEST_SUPERUSER_DATABASE_URL=... -e REDIS_URL=... node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand <arquivo>"` — `DATABASE_URL`/`TEST_SUPERUSER_DATABASE_URL`/`REDIS_URL` **não existem prontas em `.env`**, montam-se a partir de `POSTGRES_APP_USER`/`POSTGRES_APP_PASSWORD`/`POSTGRES_SUPERUSER`/`POSTGRES_SUPERUSER_PASSWORD`/`POSTGRES_DB`/`REDIS_PASSWORD`:
  ```bash
  source /opt/Montese/.env
  export DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}"
  export TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}"
  export REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379"
  ```
- **Migrations não aplicam sozinhas rodando `docker exec montese_backend npm run db:migrate`** se o arquivo `.sql` foi criado depois do build da imagem — usar o container efêmero que monta o código-fonte do host: `docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app -e DATABASE_URL=... node:20-alpine sh -c "npx tsx db/migrate.ts"`.
- **Novas dependências de backend:** `pdf-parse` (`^2.4.5` — confirmado via `npm view` em 2026-08-28 que a v1 está obsoleta; a v2 troca a API de função (`pdfParse(buffer)`) por classe (`new PDFParse({ data: buffer }).getText()`), ver Task 5), `@nestjs/schedule` (`^4.1.2` — confirmado via `npm view @nestjs/schedule@4.1.2 peerDependencies` que é a última versão da linha 4.x compatível com `@nestjs/core@^10.4.15`; a linha 12.x atual exige Nest v11/v12).
- **Env vars novas:** `OPENROUTER_EMBEDDING_MODEL` (default `openai/text-embedding-3-small`), `OPENROUTER_RAG_MIN_SIMILARITY` (default `0.75`) — cada uma entra em `docker-compose.yml`/`.env.example` na MESMA task que primeiro a consome, nunca numa task de "config" separada (lição da Fase 8: código que lê env var sem a var wired em `docker-compose.yml` já aconteceu uma vez neste projeto).

---

### Task 1: pgvector — troca de imagem, extensão, tabelas

**Files:**
- Modify: `docker-compose.yml` (linha `postgres.image`)
- Create: `backend/db/migrations/0021_normative_base.sql`
- Test: `backend/test/normative-pgvector.e2e-spec.ts`

**Interfaces:**
- Consumes: nada (primeira task da fase).
- Produces: tabelas `official_sources`, `normative_documents`, `normative_document_chunks` — schema exato consumido por todas as tasks seguintes.

- [ ] **Step 1: Trocar a imagem do Postgres**

Em `docker-compose.yml`, no serviço `postgres`:

```yaml
    image: pgvector/pgvector:pg16
```

(era `postgres:16-alpine`).

- [ ] **Step 2: Aplicar a troca de imagem**

```bash
cd /opt/Montese
docker compose pull postgres
docker compose up -d postgres
```

Esperado: `docker compose ps postgres` mostra o container `Up` e `(healthy)` em poucos segundos.

- [ ] **Step 3: Criar a extensão `vector` via superuser (fora de qualquer migration)**

```bash
source /opt/Montese/.env
docker exec montese_postgres psql -U "$POSTGRES_SUPERUSER" -d "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Esperado: `CREATE EXTENSION`. Confirmar:

```bash
docker exec montese_postgres psql -U "$POSTGRES_SUPERUSER" -d "$POSTGRES_DB" -c "\dx vector"
```

deve listar a extensão instalada.

- [ ] **Step 4: Escrever a migration**

Criar `backend/db/migrations/0021_normative_base.sql`:

```sql
-- Fase 9 (RAG Normativo): base de normas oficiais de SST, compartilhada
-- entre todos os clientes — SEM tenant_id, SEM RLS (mesma categoria de
-- epi_catalog_items). A extensão `vector` já foi criada via superuser
-- antes desta migration (a role montese_app, que roda esta migration,
-- não tem privilégio garantido de CREATE EXTENSION). Ver
-- docs/specs/fase-9-rag-normativo.md e docs/plans/fase-9-rag-normativo.md
-- (Global Constraints).

CREATE TABLE official_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity text NOT NULL,
  code text,
  title text NOT NULL,
  official_url text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE normative_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES official_sources(id),
  status text NOT NULL DEFAULT 'aguardando_validacao'
    CHECK (status IN ('aguardando_validacao', 'vigente', 'rejeitado', 'substituido')),
  content_hash text NOT NULL,
  file_key text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  raw_text text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by_user_id uuid REFERENCES users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  supersedes_document_id uuid REFERENCES normative_documents(id),
  indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX normative_documents_one_vigente_per_source
  ON normative_documents(source_id) WHERE status = 'vigente';

CREATE TABLE normative_document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES normative_documents(id) ON DELETE CASCADE,
  chunk_index int NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX normative_document_chunks_embedding_idx
  ON normative_document_chunks USING hnsw (embedding vector_cosine_ops);
```

- [ ] **Step 5: Aplicar a migration**

```bash
cd /opt/Montese
source /opt/Montese/.env
export DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}"
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  -e DATABASE_URL="$DATABASE_URL" \
  node:20-alpine sh -c "npx tsx db/migrate.ts"
```

Esperado: `[ok] 0021_normative_base.sql`.

- [ ] **Step 6: Escrever o teste de prova de vida do pgvector**

Criar `backend/test/normative-pgvector.e2e-spec.ts`:

```ts
import { TestDb } from './db-test-helper';

// Prova que a extensão vector + as 3 tabelas + o índice HNSW funcionam de
// ponta a ponta neste Postgres real — antes de qualquer código de
// aplicação existir em cima delas. Vetor local (não usa nenhum util de
// src/ ainda, propositalmente: esta é a Task 1, os utils só existem a
// partir da Task 2).
function vectorLiteral(nonZeroIndices: number[]): string {
  const vec = new Array(1536).fill(0);
  for (const i of nonZeroIndices) vec[i] = 1;
  return `[${vec.join(',')}]`;
}

describe('pgvector: extensão e tabelas normativas (e2e)', () => {
  let db: TestDb;
  let sourceId: string;
  let documentId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    const client = (db as any).client;

    const sourceRes = await client.query(
      `INSERT INTO official_sources (entity, code, title, official_url)
       VALUES ('MTE', 'NR-06', 'NR-06 - EPI', 'https://exemplo.gov.br/nr-06.pdf')
       RETURNING id`,
    );
    sourceId = sourceRes.rows[0].id;

    const docRes = await client.query(
      `INSERT INTO normative_documents (source_id, status, content_hash, file_key, file_name, mime_type, raw_text, indexed_at)
       VALUES ($1, 'vigente', 'hash-teste-pgvector', 'normative/teste.pdf', 'teste.pdf', 'application/pdf', 'texto de teste', now())
       RETURNING id`,
      [sourceId],
    );
    documentId = docRes.rows[0].id;
  });

  afterAll(async () => {
    const client = (db as any).client;
    await client.query('DELETE FROM normative_documents WHERE id = $1', [documentId]);
    await client.query('DELETE FROM official_sources WHERE id = $1', [sourceId]);
    await db.disconnect();
  });

  it('só permite uma versão vigente por fonte (índice único parcial)', async () => {
    const client = (db as any).client;
    await expect(
      client.query(
        `INSERT INTO normative_documents (source_id, status, content_hash, file_key, file_name, mime_type, raw_text)
         VALUES ($1, 'vigente', 'outro-hash', 'normative/outro.pdf', 'outro.pdf', 'application/pdf', 'outro texto')`,
        [sourceId],
      ),
    ).rejects.toThrow();
  });

  it('aceita inserir embeddings e ordena por proximidade real via pgvector', async () => {
    const client = (db as any).client;
    const exact = vectorLiteral([0]);
    const shared = vectorLiteral([0, 1]);
    const orthogonal = vectorLiteral([1]);

    const insertChunk = async (index: number, embedding: string) => {
      const res = await client.query(
        `INSERT INTO normative_document_chunks (document_id, chunk_index, content, embedding)
         VALUES ($1, $2, $3, $4::vector) RETURNING id`,
        [documentId, index, `trecho ${index}`, embedding],
      );
      return res.rows[0].id;
    };

    const orthogonalId = await insertChunk(0, orthogonal);
    const sharedId = await insertChunk(1, shared);
    const exactId = await insertChunk(2, exact);

    const result = await client.query(
      `SELECT id FROM normative_document_chunks WHERE document_id = $1 ORDER BY embedding <=> $2::vector`,
      [documentId, exact],
    );

    expect(result.rows.map((r: any) => r.id)).toEqual([exactId, sharedId, orthogonalId]);

    await client.query('DELETE FROM normative_document_chunks WHERE document_id = $1', [documentId]);
  });
});
```

- [ ] **Step 7: Rodar o teste**

```bash
source /opt/Montese/.env
export TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}"
export REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379"
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  -e TEST_SUPERUSER_DATABASE_URL="$TEST_SUPERUSER_DATABASE_URL" -e REDIS_URL="$REDIS_URL" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative-pgvector"
```

Esperado: 2 testes passando.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml backend/db/migrations/0021_normative_base.sql backend/test/normative-pgvector.e2e-spec.ts
git commit -m "feat: pgvector + tabelas base do RAG normativo (Fase 9)"
```

---

### Task 2: Utils puros — fatiamento de texto e literal de vetor

**Files:**
- Create: `backend/src/normative/chunking.util.ts`
- Create: `backend/src/normative/vector.util.ts`
- Test: `backend/test/normative-chunking.e2e-spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `splitIntoChunks(text: string): string[]` (consumida pela Task 6, indexação) e `toVectorLiteral(embedding: number[]): string` (consumida pelas Tasks 3, 6 e 7).

- [ ] **Step 1: Escrever os testes**

Criar `backend/test/normative-chunking.e2e-spec.ts` (lógica pura, sem I/O — mas o nome termina em `.e2e-spec.ts` porque é o único padrão que `test/jest-e2e.json` reconhece):

```ts
import { splitIntoChunks } from '../src/normative/chunking.util';
import { toVectorLiteral } from '../src/normative/vector.util';

function buildIndexedText(charLength: number): string {
  const tokens: string[] = [];
  for (let i = 0; i * 5 < charLength; i++) {
    tokens.push(i.toString().padStart(5, '0'));
  }
  return tokens.join('').slice(0, charLength);
}

describe('splitIntoChunks', () => {
  it('texto vazio retorna lista vazia', () => {
    expect(splitIntoChunks('')).toEqual([]);
    expect(splitIntoChunks('   ')).toEqual([]);
  });

  it('texto menor que o tamanho do pedaço retorna um único pedaço', () => {
    expect(splitIntoChunks('texto curto')).toEqual(['texto curto']);
  });

  it('divide texto longo em pedaços de 2000 caracteres com 200 de sobreposição', () => {
    const text = buildIndexedText(4500);
    const chunks = splitIntoChunks(text);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(2000);
    expect(chunks[1]).toHaveLength(2000);
    expect(chunks[2]).toHaveLength(900);

    expect(chunks[0].slice(1800)).toBe(chunks[1].slice(0, 200));
    expect(chunks[1].slice(1800)).toBe(chunks[2].slice(0, 200));

    expect(chunks[0] + chunks[1].slice(200) + chunks[2].slice(200)).toBe(text);
  });
});

describe('toVectorLiteral', () => {
  it('serializa um array de números pro formato de literal do pgvector', () => {
    expect(toVectorLiteral([1, 0.5, -2])).toBe('[1,0.5,-2]');
  });

  it('array vazio vira literal vazio', () => {
    expect(toVectorLiteral([])).toBe('[]');
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative-chunking"
```

Esperado: FAIL — `Cannot find module '../src/normative/chunking.util'`.

- [ ] **Step 3: Implementar `chunking.util.ts`**

Criar `backend/src/normative/chunking.util.ts`:

```ts
// Aproximação de ~4 caracteres por token (heurística comum, não é
// tokenização real) — suficiente pra controlar o tamanho de cada pedaço
// indexado, não pra cobrança/billing (isso é medido no lado do provedor
// de embedding). 2000 caracteres ~= 500 tokens, 200 caracteres ~= 50
// tokens de sobreposição (ver docs/specs/fase-9-rag-normativo.md §4.3).
const CHUNK_CHAR_SIZE = 2000;
const CHUNK_CHAR_OVERLAP = 200;

export function splitIntoChunks(text: string): string[] {
  const normalized = text.trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= CHUNK_CHAR_SIZE) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + CHUNK_CHAR_SIZE, normalized.length);
    chunks.push(normalized.slice(start, end));
    if (end === normalized.length) break;
    start = end - CHUNK_CHAR_OVERLAP;
  }
  return chunks;
}
```

- [ ] **Step 4: Implementar `vector.util.ts`**

Criar `backend/src/normative/vector.util.ts`:

```ts
// O driver `pg` não tem tipo nativo pra `vector` — todo INSERT/SELECT
// que toca a coluna `embedding` passa o array serializado como este
// literal de texto e faz cast explícito `$N::vector` na query SQL.
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative-chunking"
```

Esperado: 5 testes passando.

- [ ] **Step 6: Commit**

```bash
git add backend/src/normative/chunking.util.ts backend/src/normative/vector.util.ts backend/test/normative-chunking.e2e-spec.ts
git commit -m "feat: utils de fatiamento de texto e literal de vetor (Fase 9)"
```

---

### Task 3: `EmbeddingProvider` + `OpenRouterEmbeddingService`

**Files:**
- Create: `backend/src/normative/embedding-provider.interface.ts`
- Create: `backend/src/normative/openrouter-embedding.service.ts`
- Test: `backend/test/normative-openrouter-embedding.e2e-spec.ts`
- Modify: `backend/package.json` (nenhuma dependência nova nesta task — só `fetch` nativo, igual `OpenRouterExtractorService`)
- Modify: `docker-compose.yml`, `.env.example` (env var `OPENROUTER_EMBEDDING_MODEL`)

**Interfaces:**
- Consumes: nada.
- Produces: `EmbeddingProvider { embed(text: string): Promise<number[]> }`, token `EMBEDDING_PROVIDER` — consumidos pelas Tasks 6 e 7.

- [ ] **Step 1: Escrever a interface e o token de DI**

Criar `backend/src/normative/embedding-provider.interface.ts`:

```ts
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');
```

- [ ] **Step 2: Escrever o teste (falha primeiro — a classe ainda não existe)**

Criar `backend/test/normative-openrouter-embedding.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { OpenRouterEmbeddingService } from '../src/normative/openrouter-embedding.service';

describe('OpenRouterEmbeddingService', () => {
  let service: OpenRouterEmbeddingService;
  let fetchSpy: jest.SpyInstance | undefined;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.OPENROUTER_EMBEDDING_MODEL;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [OpenRouterEmbeddingService],
    }).compile();
    service = moduleRef.get(OpenRouterEmbeddingService);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.OPENROUTER_EMBEDDING_MODEL;
    else process.env.OPENROUTER_EMBEDDING_MODEL = originalModel;
  });

  it('sem OPENROUTER_API_KEY, rejeita antes de qualquer chamada de rede', async () => {
    delete process.env.OPENROUTER_API_KEY;
    fetchSpy = jest.spyOn(global, 'fetch');

    await expect(service.embed('texto qualquer')).rejects.toThrow(
      'Assistente ainda não está disponível',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('chama o endpoint de embeddings com o modelo configurado e devolve o vetor', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    process.env.OPENROUTER_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
    const fakeEmbedding = [0.1, 0.2, 0.3];
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: fakeEmbedding }] }), { status: 200 }),
    );

    const result = await service.embed('o que é NR-06?');

    expect(result).toEqual(fakeEmbedding);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/embeddings',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, requestInit] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse((requestInit as RequestInit).body as string);
    expect(sentBody.model).toBe('openai/text-embedding-3-small');
    expect(sentBody.input).toBe('o que é NR-06?');
    expect((requestInit as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer chave-de-teste-fake',
    });
  });

  it('usa o modelo default quando OPENROUTER_EMBEDDING_MODEL não está configurada', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    delete process.env.OPENROUTER_EMBEDDING_MODEL;
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), { status: 200 }),
    );

    await service.embed('texto');

    const [, requestInit] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse((requestInit as RequestInit).body as string);
    expect(sentBody.model).toBe('openai/text-embedding-3-small');
  });

  it('propaga erro HTTP do OpenRouter como 502', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('erro', { status: 500 }));

    await expect(service.embed('texto')).rejects.toThrow('Não foi possível gerar o embedding agora');
  });

  it('propaga falha de rede como 502', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.embed('texto')).rejects.toThrow('Não foi possível gerar o embedding agora');
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative-openrouter-embedding"
```

Esperado: FAIL — módulo não encontrado.

- [ ] **Step 4: Implementar `OpenRouterEmbeddingService`**

Criar `backend/src/normative/openrouter-embedding.service.ts`:

```ts
import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { EmbeddingProvider } from './embedding-provider.interface';

// Mesmo padrão de OpenRouterExtractorService (Fase 8) — endpoint,
// headers e tratamento de erro idênticos, só a URL e o corpo mudam
// (embeddings em vez de chat completion).
@Injectable()
export class OpenRouterEmbeddingService implements EmbeddingProvider {
  private readonly logger = new Logger(OpenRouterEmbeddingService.name);

  async embed(text: string): Promise<number[]> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Assistente ainda não está disponível');
    }

    const model = process.env.OPENROUTER_EMBEDDING_MODEL || 'openai/text-embedding-3-small';
    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://montesesst.com.br',
          'X-Title': 'Montese SST - Assistente Normativo',
        },
        body: JSON.stringify({ model, input: text }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      this.logger.error('Falha de rede ao chamar o OpenRouter (embeddings)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível gerar o embedding agora');
    }

    if (!response.ok) {
      this.logger.error(`OpenRouter retornou status ${response.status} (embeddings)`);
      throw new BadGatewayException('Não foi possível gerar o embedding agora');
    }

    let body: any;
    try {
      body = await response.json();
    } catch (err) {
      this.logger.error('Resposta do OpenRouter não é JSON válido (embeddings)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível gerar o embedding agora');
    }

    const embedding = body?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
      this.logger.error('Resposta do OpenRouter sem embedding válido');
      throw new BadGatewayException('Não foi possível gerar o embedding agora');
    }

    return embedding;
  }
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative-openrouter-embedding"
```

Esperado: 5 testes passando.

- [ ] **Step 6: Wire `OPENROUTER_EMBEDDING_MODEL` em `docker-compose.yml` e `.env.example`**

Em `docker-compose.yml`, bloco `environment:` do serviço `backend`, junto de `OPENROUTER_MODEL`:

```yaml
      OPENROUTER_EMBEDDING_MODEL: ${OPENROUTER_EMBEDDING_MODEL:-openai/text-embedding-3-small}
```

Em `.env.example`, junto de `OPENROUTER_MODEL`:

```
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/normative/embedding-provider.interface.ts backend/src/normative/openrouter-embedding.service.ts backend/test/normative-openrouter-embedding.e2e-spec.ts docker-compose.yml .env.example
git commit -m "feat: EmbeddingProvider via OpenRouter (Fase 9)"
```

---

### Task 4: `official_sources` — CRUD admin + módulo

**Files:**
- Create: `backend/src/normative/dto/create-official-source.dto.ts`
- Create: `backend/src/normative/official-sources.service.ts`
- Create: `backend/src/normative/official-sources.controller.ts`
- Create: `backend/src/normative/normative.module.ts`
- Modify: `backend/src/app.module.ts` (registra `NormativeModule`)
- Test: `backend/test/normative-sources.e2e-spec.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores diretamente (usa só a tabela da Task 1).
- Produces: `OfficialSourcesService.create(client, dto)`/`findAll(client)`; `NormativeModule` — as tasks 5-7 vão ADICIONAR providers/controllers a este mesmo módulo, não criar um novo.

- [ ] **Step 1: Escrever o teste**

Criar `backend/test/normative-sources.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST/GET /normative-sources (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let createdSourceId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin Normativo Teste');
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const tenant = await db.createTenantWithUser('Empresa Normativo Teste');
    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    if (createdSourceId) {
      await (db as any).client.query('DELETE FROM official_sources WHERE id = $1', [createdSourceId]);
    }
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('bloqueia empresa com 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/normative-sources')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ entity: 'MTE', code: 'NR-06', title: 'NR-06 - EPI', official_url: 'https://exemplo.gov.br/nr-06.pdf' });
    expect(res.status).toBe(403);
  });

  it('admin cadastra uma fonte e ela aparece na listagem', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/normative-sources')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ entity: 'MTE', code: 'NR-06', title: 'NR-06 - EPI', official_url: 'https://exemplo.gov.br/nr-06.pdf' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.entity).toBe('MTE');
    expect(createRes.body.active).toBe(true);
    createdSourceId = createRes.body.id;

    const listRes = await request(app.getHttpServer())
      .get('/normative-sources')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.some((s: any) => s.id === createdSourceId)).toBe(true);
  });

  it('rejeita URL inválida', async () => {
    const res = await request(app.getHttpServer())
      .post('/normative-sources')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ entity: 'MTE', title: 'Fonte inválida', official_url: 'não é uma url' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative-sources"
```

Esperado: FAIL — rota `/normative-sources` não existe (404 em vez de 403/201).

- [ ] **Step 3: Implementar o DTO**

Criar `backend/src/normative/dto/create-official-source.dto.ts`:

```ts
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateOfficialSourceDto {
  @IsString()
  @IsNotEmpty()
  entity: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsUrl()
  official_url: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
```

- [ ] **Step 4: Implementar o service**

Criar `backend/src/normative/official-sources.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface OfficialSource {
  id: string;
  entity: string;
  code: string | null;
  title: string;
  official_url: string;
  active: boolean;
  created_at: string;
}

interface CreateOfficialSourceData {
  entity: string;
  code?: string;
  title: string;
  official_url: string;
  active?: boolean;
}

@Injectable()
export class OfficialSourcesService {
  async create(client: PoolClient, data: CreateOfficialSourceData): Promise<OfficialSource> {
    const result = await client.query<OfficialSource>(
      `INSERT INTO official_sources (entity, code, title, official_url, active)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.entity, data.code ?? null, data.title, data.official_url, data.active ?? true],
    );
    return result.rows[0];
  }

  async findAll(client: PoolClient): Promise<OfficialSource[]> {
    const result = await client.query<OfficialSource>('SELECT * FROM official_sources ORDER BY entity, code');
    return result.rows;
  }
}
```

- [ ] **Step 5: Implementar o controller**

Criar `backend/src/normative/official-sources.controller.ts`:

```ts
import { Body, Controller, Get, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { OfficialSourcesService } from './official-sources.service';
import { CreateOfficialSourceDto } from './dto/create-official-source.dto';

@Controller('normative-sources')
export class OfficialSourcesController {
  constructor(private readonly sources: OfficialSourcesService) {}

  @Roles('admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateOfficialSourceDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.sources.create(client, dto));
  }

  @Roles('admin')
  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.sources.findAll(client));
  }
}
```

- [ ] **Step 6: Criar o módulo e registrar no `AppModule`**

Criar `backend/src/normative/normative.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { OfficialSourcesController } from './official-sources.controller';
import { OfficialSourcesService } from './official-sources.service';

// Módulo único da Fase 9 (RAG Normativo) — as Tasks 5, 6 e 7 adicionam
// providers/controllers aqui (monitor, aprovação/indexação, assistente),
// não criam módulos novos.
@Module({
  controllers: [OfficialSourcesController],
  providers: [OfficialSourcesService],
})
export class NormativeModule {}
```

Em `backend/src/app.module.ts`, adicionar o import e registrar em `imports`:

```ts
import { NormativeModule } from './normative/normative.module';
```

```ts
    DashboardModule,
    NormativeModule,
  ],
```

- [ ] **Step 7: Rodar o teste e confirmar que passa**

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  -e DATABASE_URL="$DATABASE_URL" -e TEST_SUPERUSER_DATABASE_URL="$TEST_SUPERUSER_DATABASE_URL" -e REDIS_URL="$REDIS_URL" -e JWT_SECRET="$JWT_SECRET" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative-sources"
```

Esperado: 3 testes passando.

- [ ] **Step 8: Commit**

```bash
git add backend/src/normative/dto/create-official-source.dto.ts backend/src/normative/official-sources.service.ts backend/src/normative/official-sources.controller.ts backend/src/normative/normative.module.ts backend/src/app.module.ts backend/test/normative-sources.e2e-spec.ts
git commit -m "feat: CRUD admin de fontes oficiais (Fase 9)"
```

---

### Task 5: Monitor — detecção de mudança nas fontes

**Files:**
- Create: `backend/src/normative/normative-documents.service.ts`
- Create: `backend/src/normative/normative-monitor.service.ts`
- Modify: `backend/src/normative/normative.module.ts` (registra os providers novos, importa `R2Service`)
- Modify: `backend/src/app.module.ts` (`ScheduleModule.forRoot()`)
- Modify: `backend/package.json` (`pdf-parse`, `@nestjs/schedule`)
- Test: `backend/test/normative-monitor.e2e-spec.ts`

**Interfaces:**
- Consumes: nada de código de outras tasks (usa a tabela da Task 1 direto).
- Produces: `NormativeDocumentsService.recordDetectedVersion(client, sourceId, text, fileBuffer, mimeType, sourceUrl): Promise<NormativeDocument | null>` e `findOne`/`findByStatus` — consumidos pela Task 6. `NormativeMonitorService.runOnce()` — chamado pelo `@Cron`, também testável direto.

- [ ] **Step 1: Instalar as dependências novas**

```bash
cd /opt/Montese/backend
docker run --rm -v "$(pwd):/app" -w /app node:20-alpine npm install pdf-parse@^2.4.5 @nestjs/schedule@^4.1.2
```

Confirma em `package.json` que `"pdf-parse": "^2.4.5"` e `"@nestjs/schedule": "^4.1.2"` foram adicionados às `dependencies`. `pdf-parse@2` já inclui seus próprios tipos TypeScript (`dist/pdf-parse/cjs/index.d.cts`) — sem necessidade de `@types/pdf-parse` à parte.

- [ ] **Step 2: Escrever o teste**

Criar `backend/test/normative-monitor.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { NormativeMonitorService } from '../src/normative/normative-monitor.service';
import { TestDb } from './db-test-helper';

// Usa o AppModule inteiro (não um módulo mínimo) porque
// NormativeMonitorService depende de DatabaseService, que por sua vez
// abre um Pool real de conexões a partir de DATABASE_URL — bootstrapar
// só os providers deste módulo deixaria essa dependência sem prover.
// Mesmo padrão já usado em ai-copilot-openrouter-extractor.e2e-spec.ts.
describe('NormativeMonitorService (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let monitor: NormativeMonitorService;
  let sourceIdPdf: string;
  let sourceIdFalha: string;
  let fetchSpy: jest.SpyInstance | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    monitor = moduleRef.get(NormativeMonitorService);

    db = new TestDb();
    await db.connect();
    const client = (db as any).client;

    const src1 = await client.query(
      `INSERT INTO official_sources (entity, code, title, official_url, active)
       VALUES ('MTE', 'NR-TESTE', 'Norma de teste', 'https://exemplo.gov.br/norma-teste.html', true) RETURNING id`,
    );
    sourceIdPdf = src1.rows[0].id;

    const src2 = await client.query(
      `INSERT INTO official_sources (entity, code, title, official_url, active)
       VALUES ('MTE', 'NR-FALHA', 'Fonte que falha', 'https://exemplo.gov.br/fora-do-ar.html', true) RETURNING id`,
    );
    sourceIdFalha = src2.rows[0].id;
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
  });

  afterAll(async () => {
    const client = (db as any).client;
    await client.query('DELETE FROM normative_documents WHERE source_id IN ($1, $2)', [sourceIdPdf, sourceIdFalha]);
    await client.query('DELETE FROM official_sources WHERE id IN ($1, $2)', [sourceIdPdf, sourceIdFalha]);
    await db.disconnect();
    await app.close();
  });

  it('cria normative_document aguardando_validacao quando o conteúdo muda, e não repete quando não muda', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      if (url === 'https://exemplo.gov.br/norma-teste.html') {
        return new Response('<html><body><p>Conteúdo da norma de teste.</p></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      throw new Error('URL inesperada nesta chamada do teste: ' + url);
    });

    await monitor.runOnce();

    const client = (db as any).client;
    const afterFirstRun = await client.query(
      `SELECT status, mime_type FROM normative_documents WHERE source_id = $1`,
      [sourceIdPdf],
    );
    expect(afterFirstRun.rows).toHaveLength(1);
    expect(afterFirstRun.rows[0].status).toBe('aguardando_validacao');
    expect(afterFirstRun.rows[0].mime_type).toBe('text/html');

    // Segunda execução com o MESMO conteúdo: não deve criar segunda linha.
    await monitor.runOnce();
    const afterSecondRun = await client.query(
      `SELECT id FROM normative_documents WHERE source_id = $1`,
      [sourceIdPdf],
    );
    expect(afterSecondRun.rows).toHaveLength(1);
  });

  it('falha numa fonte não impede o processamento das demais', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      if (url === 'https://exemplo.gov.br/norma-teste.html') {
        return new Response('<html><body><p>Conteúdo mudou de novo.</p></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      if (url === 'https://exemplo.gov.br/fora-do-ar.html') {
        throw new Error('ECONNREFUSED');
      }
      throw new Error('URL inesperada nesta chamada do teste: ' + url);
    });

    await expect(monitor.runOnce()).resolves.not.toThrow();

    const client = (db as any).client;
    const result = await client.query(
      `SELECT status FROM normative_documents WHERE source_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [sourceIdPdf],
    );
    expect(result.rows[0].status).toBe('aguardando_validacao');
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

O teste bootstrapa o `AppModule` inteiro (ver comentário no Step 2), então precisa das mesmas env vars de qualquer teste que já faz isso:

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  -e DATABASE_URL="$DATABASE_URL" -e TEST_SUPERUSER_DATABASE_URL="$TEST_SUPERUSER_DATABASE_URL" -e REDIS_URL="$REDIS_URL" -e JWT_SECRET="$JWT_SECRET" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative-monitor"
```

Esperado: FAIL — módulos não encontrados.

- [ ] **Step 4: Implementar `NormativeDocumentsService` (parte 1 — detecção)**

Criar `backend/src/normative/normative-documents.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID, createHash } from 'crypto';
import { R2Service } from '../documents/r2.service';

export type NormativeDocumentStatus = 'aguardando_validacao' | 'vigente' | 'rejeitado' | 'substituido';

export interface NormativeDocument {
  id: string;
  source_id: string;
  status: NormativeDocumentStatus;
  content_hash: string;
  file_key: string;
  file_name: string;
  mime_type: string;
  raw_text: string;
  detected_at: string;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  supersedes_document_id: string | null;
  indexed_at: string | null;
  created_at: string;
}

@Injectable()
export class NormativeDocumentsService {
  constructor(private readonly r2: R2Service) {}

  // Compara com a linha MAIS RECENTE da fonte, qualquer status — não só
  // `vigente` (correção sobre a spec seção 4.2, ver Global Constraints
  // do plano). Comparar só com `vigente` recriaria uma linha
  // `aguardando_validacao` duplicada a cada execução do monitor enquanto
  // a mesma versão ficasse pendente de revisão ou já rejeitada.
  async recordDetectedVersion(
    client: PoolClient,
    sourceId: string,
    text: string,
    fileBuffer: Buffer,
    mimeType: string,
    sourceUrl: string,
  ): Promise<NormativeDocument | null> {
    const hash = createHash('sha256').update(text).digest('hex');

    const mostRecent = await client.query<{ content_hash: string }>(
      `SELECT content_hash FROM normative_documents WHERE source_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [sourceId],
    );
    if (mostRecent.rows[0]?.content_hash === hash) {
      return null;
    }

    const id = randomUUID();
    const fileName = sourceUrl.split('/').pop() || 'documento';
    const fileKey = `normative/${sourceId}/${id}/${fileName}`;
    await this.r2.putObject(fileKey, fileBuffer, mimeType);

    const result = await client.query<NormativeDocument>(
      `INSERT INTO normative_documents (id, source_id, status, content_hash, file_key, file_name, mime_type, raw_text)
       VALUES ($1, $2, 'aguardando_validacao', $3, $4, $5, $6, $7) RETURNING *`,
      [id, sourceId, hash, fileKey, fileName, mimeType, text],
    );
    return result.rows[0];
  }

  async findOne(client: PoolClient, id: string): Promise<NormativeDocument> {
    const result = await client.query<NormativeDocument>(
      'SELECT * FROM normative_documents WHERE id = $1',
      [id],
    );
    const document = result.rows[0];
    if (!document) throw new NotFoundException('Documento normativo não encontrado');
    return document;
  }

  async findByStatus(client: PoolClient, status?: string): Promise<NormativeDocument[]> {
    if (status) {
      const result = await client.query<NormativeDocument>(
        'SELECT * FROM normative_documents WHERE status = $1 ORDER BY detected_at DESC',
        [status],
      );
      return result.rows;
    }
    const result = await client.query<NormativeDocument>(
      'SELECT * FROM normative_documents ORDER BY detected_at DESC',
    );
    return result.rows;
  }
}
```

- [ ] **Step 5: Implementar `NormativeMonitorService`**

Criar `backend/src/normative/normative-monitor.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PDFParse } from 'pdf-parse';
import { DatabaseService } from '../common/database/database.service';
import { NormativeDocumentsService } from './normative-documents.service';

function extractHtmlText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

@Injectable()
export class NormativeMonitorService {
  private readonly logger = new Logger(NormativeMonitorService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly documents: NormativeDocumentsService,
  ) {}

  @Cron('0 3 * * *')
  async handleCron(): Promise<void> {
    await this.runOnce();
  }

  // Job de sistema, sem usuário autenticado nem tenant — terceiro caso
  // legítimo de withoutTenantContext além dos dois já documentados em
  // DatabaseService (health check e bootstrap de login). As tabelas
  // tocadas aqui não têm RLS de qualquer forma.
  async runOnce(): Promise<void> {
    const sources = await this.db.withoutTenantContext((client) =>
      client.query<{ id: string; official_url: string }>(
        'SELECT id, official_url FROM official_sources WHERE active = true',
      ),
    );

    for (const source of sources.rows) {
      try {
        await this.processSource(source.id, source.official_url);
      } catch (err) {
        this.logger.error(`Falha ao monitorar fonte ${source.id}`, (err as Error).stack);
      }
    }
  }

  private async processSource(sourceId: string, url: string): Promise<void> {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`Fonte respondeu status ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const buffer = Buffer.from(await response.arrayBuffer());

    let text: string;
    let mimeType: string;
    if (contentType.includes('pdf') || url.toLowerCase().endsWith('.pdf')) {
      // pdf-parse v2 é baseado em classe, não em função (mudança de API
      // confirmada em 2026-08-28 — ver Global Constraints do plano).
      // `data` aceita Buffer do Node diretamente (convertido pra
      // Uint8Array internamente pela própria lib).
      const parser = new PDFParse({ data: buffer });
      try {
        text = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
      mimeType = 'application/pdf';
    } else {
      text = extractHtmlText(buffer.toString('utf-8'));
      mimeType = 'text/html';
    }

    await this.db.withoutTenantContext((client) =>
      this.documents.recordDetectedVersion(client, sourceId, text, buffer, mimeType, url),
    );
  }
}
```

- [ ] **Step 5b: Verificar `pdf-parse` v2 contra um PDF real (fora do teste automatizado)**

O teste do Step 2 só cobre o caminho HTML — não existe forma barata de
fabricar um PDF válido de verdade dentro de um teste automatizado, e a
API do `pdf-parse` acabou de mudar de versão (função → classe) nesta
mesma task. Antes de seguir pra Task 6, confirma que a extração de
texto realmente funciona neste container:

```bash
docker run --rm -v /opt/Montese/backend:/app -w /app node:20-alpine node -e "
const { PDFParse } = require('pdf-parse');
(async () => {
  const res = await fetch('https://bitcoin.org/bitcoin.pdf');
  const buffer = Buffer.from(await res.arrayBuffer());
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  console.log('Caracteres extraídos:', result.text.length);
  console.log('Trecho:', result.text.slice(0, 120));
})();
"
```

Esperado: imprime um número de caracteres bem maior que zero (o
whitepaper tem várias páginas de texto) e um trecho legível em inglês.
Se der erro (módulo WASM faltando, worker não inicializa, etc.), pare
e investigue antes de prosseguir — o resto da fase depende deste
caminho funcionar de verdade contra PDFs reais das fontes oficiais.

- [ ] **Step 6: Registrar `ScheduleModule` no `AppModule`**

Em `backend/src/app.module.ts`:

```ts
import { ScheduleModule } from '@nestjs/schedule';
```

```ts
    DatabaseModule,
    ScheduleModule.forRoot(),
```

- [ ] **Step 7: Registrar os providers novos no `NormativeModule`**

Em `backend/src/normative/normative.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { OfficialSourcesController } from './official-sources.controller';
import { OfficialSourcesService } from './official-sources.service';
import { NormativeDocumentsService } from './normative-documents.service';
import { NormativeMonitorService } from './normative-monitor.service';
import { R2Service } from '../documents/r2.service';

@Module({
  controllers: [OfficialSourcesController],
  providers: [OfficialSourcesService, NormativeDocumentsService, NormativeMonitorService, R2Service],
})
export class NormativeModule {}
```

- [ ] **Step 8: Rodar o teste e confirmar que passa**

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  -e DATABASE_URL="$DATABASE_URL" -e TEST_SUPERUSER_DATABASE_URL="$TEST_SUPERUSER_DATABASE_URL" -e REDIS_URL="$REDIS_URL" -e JWT_SECRET="$JWT_SECRET" \
  -e R2_ENDPOINT="$R2_ENDPOINT" -e R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" -e R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" -e R2_BUCKET="$R2_BUCKET" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative-monitor"
```

Esperado: 2 testes passando.

- [ ] **Step 9: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/normative/normative-documents.service.ts backend/src/normative/normative-monitor.service.ts backend/src/normative/normative.module.ts backend/src/app.module.ts backend/test/normative-monitor.e2e-spec.ts
git commit -m "feat: monitor de fontes oficiais com deteccao de mudanca (Fase 9)"
```

---

### Task 6: Aprovação, rejeição, indexação e download

**Files:**
- Modify: `backend/src/normative/normative-documents.service.ts` (adiciona `approve`/`reject`/`reindex`/`findOneWithPrevious`/`getDownloadUrl`)
- Create: `backend/src/normative/dto/reject-document.dto.ts`
- Create: `backend/src/normative/normative-documents.controller.ts`
- Modify: `backend/src/normative/normative.module.ts` (registra o controller, injeta `EMBEDDING_PROVIDER`)
- Test: `backend/test/normative-documents-approval.e2e-spec.ts`

**Interfaces:**
- Consumes: `NormativeDocumentsService` (Task 5), `splitIntoChunks`/`toVectorLiteral` (Task 2), `EMBEDDING_PROVIDER`/`EmbeddingProvider` (Task 3).
- Produces: `POST /normative-documents/:id/approve`, `/reject`, `/reindex`, `GET /normative-documents`, `/:id`, `/:id/download` — consumidos pelas Tasks 8 (frontend admin) e indiretamente pela Task 7 (a Assistant só lê `vigente`/`indexed_at`, que só esta task preenche).

- [ ] **Step 1: Escrever o teste**

Criar `backend/test/normative-documents-approval.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EMBEDDING_PROVIDER } from '../src/normative/embedding-provider.interface';
import { TestDb } from './db-test-helper';

describe('Fluxo de aprovação/indexação de normative_documents (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let sourceId: string;
  let fakeEmbed: jest.Mock;

  beforeAll(async () => {
    fakeEmbed = jest.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({ embed: fakeEmbed })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin Aprovacao Normativa Teste');
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const src = await (db as any).client.query(
      `INSERT INTO official_sources (entity, code, title, official_url)
       VALUES ('MTE', 'NR-APROVACAO', 'Norma teste aprovacao', 'https://exemplo.gov.br/aprovacao.html') RETURNING id`,
    );
    sourceId = src.rows[0].id;
  });

  afterEach(() => {
    fakeEmbed.mockClear();
    fakeEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  afterAll(async () => {
    const client = (db as any).client;
    await client.query('DELETE FROM normative_document_chunks WHERE document_id IN (SELECT id FROM normative_documents WHERE source_id = $1)', [sourceId]);
    await client.query('DELETE FROM normative_documents WHERE source_id = $1', [sourceId]);
    await client.query('DELETE FROM official_sources WHERE id = $1', [sourceId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  async function insertPendingDocument(text: string) {
    const res = await (db as any).client.query(
      `INSERT INTO normative_documents (source_id, status, content_hash, file_key, file_name, mime_type, raw_text)
       VALUES ($1, 'aguardando_validacao', $2, $3, $3, 'text/html', $4) RETURNING id`,
      [sourceId, `hash-${Date.now()}-${Math.random()}`, `normative/${sourceId}/teste.html`, text],
    );
    return res.rows[0].id;
  }

  it('aprova, indexa em chunks com embedding, e marca indexed_at', async () => {
    const documentId = await insertPendingDocument('Texto curto de norma para indexar.');

    const res = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('vigente');
    expect(res.body.indexed_at).not.toBeNull();

    const chunks = await (db as any).client.query(
      'SELECT chunk_index FROM normative_document_chunks WHERE document_id = $1 ORDER BY chunk_index',
      [documentId],
    );
    expect(chunks.rows).toHaveLength(1);
    expect(fakeEmbed).toHaveBeenCalledTimes(1);
  });

  it('segunda aprovação da mesma fonte substitui a vigente anterior', async () => {
    const documentId = await insertPendingDocument('Texto novo que substitui o anterior.');

    const res = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('vigente');
    expect(res.body.supersedes_document_id).not.toBeNull();

    const vigentes = await (db as any).client.query(
      `SELECT id FROM normative_documents WHERE source_id = $1 AND status = 'vigente'`,
      [sourceId],
    );
    expect(vigentes.rows).toHaveLength(1);
    expect(vigentes.rows[0].id).toBe(documentId);

    const anterior = await (db as any).client.query(
      `SELECT status FROM normative_documents WHERE id = $1`,
      [res.body.supersedes_document_id],
    );
    expect(anterior.rows[0].status).toBe('substituido');
  });

  it('falha na indexação deixa indexed_at nulo, mas a aprovação não é desfeita', async () => {
    const documentId = await insertPendingDocument('Texto que vai falhar ao indexar.');
    fakeEmbed.mockRejectedValueOnce(new Error('falha simulada no provedor de embedding'));

    const res = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('vigente');
    expect(res.body.indexed_at).toBeNull();
  });

  it('reindex reprocessa um documento vigente com indexação pendente', async () => {
    const documentId = await insertPendingDocument('Texto pra reindexar depois.');
    fakeEmbed.mockRejectedValueOnce(new Error('falha simulada'));
    await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    const res = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/reindex`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    expect(res.body.indexed_at).not.toBeNull();
  });

  it('rejeita com motivo', async () => {
    const documentId = await insertPendingDocument('Texto que vai ser rejeitado.');

    const res = await request(app.getHttpServer())
      .post(`/normative-documents/${documentId}/reject`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ reason: 'Fonte extraiu texto corrompido, revisar manualmente.' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('rejeitado');
    expect(res.body.rejection_reason).toBe('Fonte extraiu texto corrompido, revisar manualmente.');
  });

  it('download só funciona pra documento vigente', async () => {
    const pendingId = await insertPendingDocument('Ainda não aprovado.');
    const pendingRes = await request(app.getHttpServer())
      .get(`/normative-documents/${pendingId}/download`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(pendingRes.status).toBe(404);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  -e DATABASE_URL="$DATABASE_URL" -e TEST_SUPERUSER_DATABASE_URL="$TEST_SUPERUSER_DATABASE_URL" -e REDIS_URL="$REDIS_URL" -e JWT_SECRET="$JWT_SECRET" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative-documents-approval"
```

Esperado: FAIL — rotas não existem.

- [ ] **Step 3: Estender `NormativeDocumentsService`**

Em `backend/src/normative/normative-documents.service.ts`, adicionar os imports e os métodos novos (o construtor passa a receber também o `EmbeddingProvider`):

```ts
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID, createHash } from 'crypto';
import { R2Service } from '../documents/r2.service';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from './embedding-provider.interface';
import { splitIntoChunks } from './chunking.util';
import { toVectorLiteral } from './vector.util';
```

```ts
@Injectable()
export class NormativeDocumentsService {
  private readonly logger = new Logger(NormativeDocumentsService.name);

  constructor(
    private readonly r2: R2Service,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
  ) {}

  // ... recordDetectedVersion, findOne, findByStatus continuam iguais (Task 5) ...

  async findOneWithPrevious(
    client: PoolClient,
    id: string,
  ): Promise<{ document: NormativeDocument; previous_text: string | null }> {
    const document = await this.findOne(client, id);
    const previous = await client.query<{ raw_text: string }>(
      `SELECT raw_text FROM normative_documents WHERE source_id = $1 AND status = 'vigente' AND id != $2`,
      [document.source_id, id],
    );
    return { document, previous_text: previous.rows[0]?.raw_text ?? null };
  }

  async approve(client: PoolClient, documentId: string, reviewerUserId: string): Promise<NormativeDocument> {
    const doc = await this.findOne(client, documentId);
    if (doc.status !== 'aguardando_validacao') {
      throw new BadRequestException('Só documentos aguardando validação podem ser aprovados');
    }

    const previous = await client.query<{ id: string }>(
      `SELECT id FROM normative_documents WHERE source_id = $1 AND status = 'vigente'`,
      [doc.source_id],
    );
    const previousId = previous.rows[0]?.id ?? null;

    if (previousId) {
      await client.query(`UPDATE normative_documents SET status = 'substituido' WHERE id = $1`, [previousId]);
    }
    await client.query(
      `UPDATE normative_documents
       SET status = 'vigente', reviewed_by_user_id = $2, reviewed_at = now(), supersedes_document_id = $3
       WHERE id = $1`,
      [documentId, reviewerUserId, previousId],
    );

    await this.indexDocument(client, documentId, doc.raw_text);

    return this.findOne(client, documentId);
  }

  async reject(client: PoolClient, documentId: string, reviewerUserId: string, reason: string): Promise<NormativeDocument> {
    const doc = await this.findOne(client, documentId);
    if (doc.status !== 'aguardando_validacao') {
      throw new BadRequestException('Só documentos aguardando validação podem ser rejeitados');
    }
    await client.query(
      `UPDATE normative_documents
       SET status = 'rejeitado', reviewed_by_user_id = $2, reviewed_at = now(), rejection_reason = $3
       WHERE id = $1`,
      [documentId, reviewerUserId, reason],
    );
    return this.findOne(client, documentId);
  }

  async reindex(client: PoolClient, documentId: string): Promise<NormativeDocument> {
    const doc = await this.findOne(client, documentId);
    if (doc.status !== 'vigente') {
      throw new BadRequestException('Só documentos vigentes podem ser reindexados');
    }
    await client.query('DELETE FROM normative_document_chunks WHERE document_id = $1', [documentId]);
    await client.query('UPDATE normative_documents SET indexed_at = NULL WHERE id = $1', [documentId]);
    await this.indexDocument(client, documentId, doc.raw_text);
    return this.findOne(client, documentId);
  }

  async getDownloadUrl(client: PoolClient, id: string): Promise<{ url: string; file_name: string }> {
    const document = await this.findOne(client, id);
    if (document.status !== 'vigente') {
      throw new NotFoundException('Documento normativo não encontrado');
    }
    const url = await this.r2.getPresignedDownloadUrl(document.file_key);
    return { url, file_name: document.file_name };
  }

  // Nunca deixa uma falha de indexação desfazer a aprovação — o
  // try/catch fica dentro deste método (não propaga), senão o
  // withTenantContext do controller reverteria a transação inteira,
  // inclusive a troca de status já aplicada acima. `indexed_at`
  // simplesmente continua NULL (ver Global Constraints do plano).
  private async indexDocument(client: PoolClient, documentId: string, rawText: string): Promise<void> {
    try {
      const chunks = splitIntoChunks(rawText);
      for (let i = 0; i < chunks.length; i++) {
        const embedding = await this.embeddings.embed(chunks[i]);
        await client.query(
          `INSERT INTO normative_document_chunks (document_id, chunk_index, content, embedding)
           VALUES ($1, $2, $3, $4::vector)`,
          [documentId, i, chunks[i], toVectorLiteral(embedding)],
        );
      }
      await client.query(`UPDATE normative_documents SET indexed_at = now() WHERE id = $1`, [documentId]);
    } catch (err) {
      this.logger.error(`Falha ao indexar documento ${documentId}`, (err as Error).stack);
    }
  }
}
```

- [ ] **Step 4: Implementar o DTO de rejeição**

Criar `backend/src/normative/dto/reject-document.dto.ts`:

```ts
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
```

- [ ] **Step 5: Implementar o controller**

Criar `backend/src/normative/normative-documents.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { NormativeDocumentsService } from './normative-documents.service';
import { RejectDocumentDto } from './dto/reject-document.dto';

@Controller('normative-documents')
export class NormativeDocumentsController {
  constructor(private readonly documents: NormativeDocumentsService) {}

  @Roles('admin')
  @Get()
  findAll(@Query('status') status: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.findByStatus(client, status));
  }

  @Roles('admin')
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.findOneWithPrevious(client, id));
  }

  @Roles('admin')
  @Post(':id/approve')
  approve(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.approve(client, id, req.user.id));
  }

  @Roles('admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectDocumentDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.reject(client, id, req.user.id, dto.reason));
  }

  @Roles('admin')
  @Post(':id/reindex')
  reindex(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.reindex(client, id));
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Get(':id/download')
  download(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.getDownloadUrl(client, id));
  }
}
```

- [ ] **Step 6: Registrar o controller e o `EMBEDDING_PROVIDER` no módulo**

Em `backend/src/normative/normative.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { OfficialSourcesController } from './official-sources.controller';
import { OfficialSourcesService } from './official-sources.service';
import { NormativeDocumentsService } from './normative-documents.service';
import { NormativeDocumentsController } from './normative-documents.controller';
import { NormativeMonitorService } from './normative-monitor.service';
import { R2Service } from '../documents/r2.service';
import { EMBEDDING_PROVIDER } from './embedding-provider.interface';
import { OpenRouterEmbeddingService } from './openrouter-embedding.service';

@Module({
  controllers: [OfficialSourcesController, NormativeDocumentsController],
  providers: [
    OfficialSourcesService,
    NormativeDocumentsService,
    NormativeMonitorService,
    R2Service,
    OpenRouterEmbeddingService,
    { provide: EMBEDDING_PROVIDER, useClass: OpenRouterEmbeddingService },
  ],
})
export class NormativeModule {}
```

- [ ] **Step 7: Rodar o teste e confirmar que passa**

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  -e DATABASE_URL="$DATABASE_URL" -e TEST_SUPERUSER_DATABASE_URL="$TEST_SUPERUSER_DATABASE_URL" -e REDIS_URL="$REDIS_URL" -e JWT_SECRET="$JWT_SECRET" \
  -e R2_ENDPOINT="$R2_ENDPOINT" -e R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" -e R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" -e R2_BUCKET="$R2_BUCKET" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative-documents-approval"
```

Esperado: 6 testes passando.

- [ ] **Step 8: Commit**

```bash
git add backend/src/normative/normative-documents.service.ts backend/src/normative/normative-documents.controller.ts backend/src/normative/dto/reject-document.dto.ts backend/src/normative/normative.module.ts backend/test/normative-documents-approval.e2e-spec.ts
git commit -m "feat: aprovacao, rejeicao, indexacao e download de normas (Fase 9)"
```

---

### Task 7: Assistente — consulta e Verificador

**Files:**
- Create: `backend/src/normative/normative-answer-provider.interface.ts`
- Create: `backend/src/normative/normative-answer-shared.ts`
- Create: `backend/src/normative/openrouter-normative-answer.service.ts`
- Create: `backend/src/normative/normative-assistant.service.ts`
- Create: `backend/src/normative/dto/normative-query.dto.ts`
- Create: `backend/src/normative/normative-assistant.controller.ts`
- Modify: `backend/src/normative/normative.module.ts`
- Modify: `backend/src/common/env.ts` (`envFloat`)
- Modify: `docker-compose.yml`, `.env.example` (`OPENROUTER_RAG_MIN_SIMILARITY`)
- Test: `backend/test/normative-assistant.e2e-spec.ts`

**Interfaces:**
- Consumes: `EMBEDDING_PROVIDER` (Task 3), tabelas indexadas pela Task 6.
- Produces: `POST /assistant/normative-query` — endpoint final consumido pela Task 9 (frontend).

- [ ] **Step 1: Adicionar `envFloat`**

Em `backend/src/common/env.ts`:

```ts
export function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}
```

- [ ] **Step 2: Escrever o teste**

Criar `backend/test/normative-assistant.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EMBEDDING_PROVIDER } from '../src/normative/embedding-provider.interface';
import { NORMATIVE_ANSWER_PROVIDER } from '../src/normative/normative-answer-provider.interface';
import { toVectorLiteral } from '../src/normative/vector.util';
import { TestDb } from './db-test-helper';

describe('POST /assistant/normative-query (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let sourceId: string;
  let documentId: string;
  let chunkId: string;
  const fakeAnswer = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({ embed: jest.fn().mockResolvedValue(new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0))) })
      .overrideProvider(NORMATIVE_ANSWER_PROVIDER)
      .useValue({ answer: fakeAnswer })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin Assistente Teste');
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const tenant = await db.createTenantWithUser('Empresa Assistente Teste');
    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;

    const client = (db as any).client;
    const src = await client.query(
      `INSERT INTO official_sources (entity, code, title, official_url)
       VALUES ('MTE', 'NR-ASSISTENTE', 'Norma teste assistente', 'https://exemplo.gov.br/assistente.html') RETURNING id`,
    );
    sourceId = src.rows[0].id;

    const doc = await client.query(
      `INSERT INTO normative_documents (source_id, status, content_hash, file_key, file_name, mime_type, raw_text, indexed_at)
       VALUES ($1, 'vigente', 'hash-assistente', 'normative/assistente.html', 'assistente.html', 'text/html', 'Texto vigente de teste', now())
       RETURNING id`,
      [sourceId],
    );
    documentId = doc.rows[0].id;

    const exactVector = toVectorLiteral(new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0)));
    const chunk = await client.query(
      `INSERT INTO normative_document_chunks (document_id, chunk_index, content, embedding)
       VALUES ($1, 0, 'Trecho oficial sobre uso de capacete.', $2::vector) RETURNING id`,
      [documentId, exactVector],
    );
    chunkId = chunk.rows[0].id;
  });

  afterEach(() => {
    fakeAnswer.mockReset();
  });

  afterAll(async () => {
    const client = (db as any).client;
    await client.query('DELETE FROM normative_document_chunks WHERE document_id = $1', [documentId]);
    await client.query('DELETE FROM normative_documents WHERE id = $1', [documentId]);
    await client.query('DELETE FROM official_sources WHERE id = $1', [sourceId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('bloqueia admin com 403 (admin não é usuário final do Assistente)', async () => {
    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ question: 'preciso usar capacete?' });
    expect(res.status).toBe(403);
  });

  it('responde com citação quando o Verificador confirma o chunk_id', async () => {
    fakeAnswer.mockResolvedValue([{ claim: 'É obrigatório o uso de capacete.', chunk_ids: [chunkId] }]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'preciso usar capacete?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBe('É obrigatório o uso de capacete.');
    expect(res.body.citations).toEqual([
      { document_id: documentId, title: 'Norma teste assistente', official_url: 'https://exemplo.gov.br/assistente.html' },
    ]);
  });

  it('Verificador descarta claim com chunk_id fora do conjunto recuperado', async () => {
    fakeAnswer.mockResolvedValue([
      { claim: 'Afirmação sem fonte válida.', chunk_ids: ['00000000-0000-0000-0000-000000000000'] },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'pergunta qualquer' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBeNull();
    expect(res.body.message).toBe('Não encontrei uma norma vigente na base que trate disso.');
    expect(res.body.citations).toEqual([]);
  });

  it('claim com chunk_ids vazio é descartada', async () => {
    fakeAnswer.mockResolvedValue([{ claim: 'Afirmação sem citação nenhuma.', chunk_ids: [] }]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'pergunta qualquer' });

    expect(res.body.answer).toBeNull();
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  -e DATABASE_URL="$DATABASE_URL" -e TEST_SUPERUSER_DATABASE_URL="$TEST_SUPERUSER_DATABASE_URL" -e REDIS_URL="$REDIS_URL" -e JWT_SECRET="$JWT_SECRET" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative-assistant"
```

Esperado: FAIL — módulos não encontrados.

- [ ] **Step 4: Interface + prompt/schema compartilhado**

Criar `backend/src/normative/normative-answer-provider.interface.ts`:

```ts
export interface NormativeClaim {
  claim: string;
  chunk_ids: string[];
}

export interface NormativeAnswerProvider {
  answer(question: string, chunks: { id: string; content: string }[]): Promise<NormativeClaim[]>;
}

export const NORMATIVE_ANSWER_PROVIDER = Symbol('NORMATIVE_ANSWER_PROVIDER');
```

Criar `backend/src/normative/normative-answer-shared.ts`:

```ts
export const SYSTEM_PROMPT = `Você é um assistente que responde perguntas sobre normas oficiais de
Segurança e Saúde do Trabalho (SST) brasileiras, usando SOMENTE os
trechos de fonte oficial fornecidos abaixo. Você nunca responde com
conhecimento próprio, memória ou suposição — só com o que está
literalmente nos trechos.

Para cada afirmação normativa que você fizer, chame a ferramenta
answer_with_citations com uma lista de itens, cada um com:
- claim: a afirmação em português, curta e direta
- chunk_ids: a lista dos ids dos trechos (fornecidos abaixo) que
  sustentam literalmente essa afirmação

Regras obrigatórias:
- Toda afirmação precisa de pelo menos um chunk_id real da lista de
  trechos fornecida. Nunca invente um chunk_id.
- Se os trechos fornecidos não contêm informação suficiente para
  responder a pergunta, devolva uma lista vazia de itens — não tente
  responder com conhecimento geral.
- Não dê conselho, opinião ou interpretação além do que os trechos
  literalmente dizem.`;

export const TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'answer_with_citations',
    description: 'Responde a pergunta normativa citando os trechos oficiais usados',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              claim: { type: 'string' },
              chunk_ids: { type: 'array', items: { type: 'string' } },
            },
            required: ['claim', 'chunk_ids'],
          },
        },
      },
      required: ['items'],
    },
  },
};

export function buildRagChatCompletionBody(
  model: string,
  question: string,
  chunks: { id: string; content: string }[],
) {
  const context = chunks.map((c) => `[${c.id}] ${c.content}`).join('\n\n');
  return {
    model,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Trechos disponíveis:\n\n${context}\n\nPergunta: ${question}` },
    ],
    tools: [TOOL_SCHEMA],
    tool_choice: { type: 'function', function: { name: 'answer_with_citations' } },
  };
}

// Cópia local proposital do parser de tool_call (mesma lógica de
// checklist-extraction-shared.ts, na Fase 8) — mantém o módulo
// `normative` sem depender do módulo `ai-copilot` por uma função de 6
// linhas.
export function parseRagToolCall(body: any): { items?: unknown } | null {
  const toolCall = body?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) return null;
  try {
    return JSON.parse(toolCall.function.arguments);
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Implementar `OpenRouterNormativeAnswerService`**

Criar `backend/src/normative/openrouter-normative-answer.service.ts`:

```ts
import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { NormativeAnswerProvider, NormativeClaim } from './normative-answer-provider.interface';
import { buildRagChatCompletionBody, parseRagToolCall } from './normative-answer-shared';

@Injectable()
export class OpenRouterNormativeAnswerService implements NormativeAnswerProvider {
  private readonly logger = new Logger(OpenRouterNormativeAnswerService.name);

  async answer(question: string, chunks: { id: string; content: string }[]): Promise<NormativeClaim[]> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Assistente ainda não está disponível');
    }

    const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-5';
    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://montesesst.com.br',
          'X-Title': 'Montese SST - Assistente Normativo',
        },
        body: JSON.stringify(buildRagChatCompletionBody(model, question, chunks)),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      this.logger.error('Falha de rede ao chamar o OpenRouter (assistente)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível responder agora');
    }

    if (!response.ok) {
      this.logger.error(`OpenRouter retornou status ${response.status} (assistente)`);
      throw new BadGatewayException('Não foi possível responder agora');
    }

    let body: any;
    try {
      body = await response.json();
    } catch (err) {
      this.logger.error('Resposta do OpenRouter não é JSON válido (assistente)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível responder agora');
    }

    const parsed = parseRagToolCall(body);
    if (!parsed || !Array.isArray(parsed.items)) return [];

    return parsed.items.filter((item): item is NormativeClaim => {
      if (typeof item !== 'object' || item === null) return false;
      const candidate = item as Record<string, unknown>;
      return typeof candidate.claim === 'string' && Array.isArray(candidate.chunk_ids);
    });
  }
}
```

- [ ] **Step 6: Implementar `NormativeAssistantService`**

Criar `backend/src/normative/normative-assistant.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from './embedding-provider.interface';
import { NORMATIVE_ANSWER_PROVIDER, NormativeAnswerProvider } from './normative-answer-provider.interface';
import { toVectorLiteral } from './vector.util';
import { envFloat } from '../common/env';

const FALLBACK_MESSAGE = 'Não encontrei uma norma vigente na base que trate disso.';

export interface NormativeQueryCitation {
  document_id: string;
  title: string;
  official_url: string;
}

export interface NormativeQueryResult {
  answer: string | null;
  message?: string;
  citations: NormativeQueryCitation[];
}

interface RetrievedChunk {
  chunk_id: string;
  content: string;
  document_id: string;
  source_title: string;
  official_url: string;
  similarity: number;
}

@Injectable()
export class NormativeAssistantService {
  constructor(
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(NORMATIVE_ANSWER_PROVIDER) private readonly answerer: NormativeAnswerProvider,
  ) {}

  async query(client: PoolClient, question: string): Promise<NormativeQueryResult> {
    const questionEmbedding = await this.embeddings.embed(question);
    const threshold = envFloat('OPENROUTER_RAG_MIN_SIMILARITY', 0.75);

    const { rows } = await client.query<RetrievedChunk>(
      `SELECT c.id AS chunk_id, c.content, d.id AS document_id, s.title AS source_title, s.official_url,
              1 - (c.embedding <=> $1::vector) AS similarity
       FROM normative_document_chunks c
       JOIN normative_documents d ON d.id = c.document_id
       JOIN official_sources s ON s.id = d.source_id
       WHERE d.status = 'vigente' AND d.indexed_at IS NOT NULL
       ORDER BY c.embedding <=> $1::vector
       LIMIT 6`,
      [toVectorLiteral(questionEmbedding)],
    );

    const relevant = rows.filter((r) => r.similarity >= threshold);
    if (relevant.length === 0) {
      return { answer: null, message: FALLBACK_MESSAGE, citations: [] };
    }

    const claims = await this.answerer.answer(
      question,
      relevant.map((r) => ({ id: r.chunk_id, content: r.content })),
    );

    const validChunkIds = new Set(relevant.map((r) => r.chunk_id));
    const survivingClaims = claims.filter(
      (claim) => claim.chunk_ids.length > 0 && claim.chunk_ids.every((id) => validChunkIds.has(id)),
    );

    if (survivingClaims.length === 0) {
      return { answer: null, message: FALLBACK_MESSAGE, citations: [] };
    }

    const usedChunkIds = new Set(survivingClaims.flatMap((c) => c.chunk_ids));
    const citationsByDocument = new Map<string, NormativeQueryCitation>();
    for (const chunk of relevant) {
      if (usedChunkIds.has(chunk.chunk_id)) {
        citationsByDocument.set(chunk.document_id, {
          document_id: chunk.document_id,
          title: chunk.source_title,
          official_url: chunk.official_url,
        });
      }
    }

    return {
      answer: survivingClaims.map((c) => c.claim).join('\n\n'),
      citations: Array.from(citationsByDocument.values()),
    };
  }
}
```

- [ ] **Step 7: DTO e controller**

Criar `backend/src/normative/dto/normative-query.dto.ts`:

```ts
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class NormativeQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  question: string;
}
```

Criar `backend/src/normative/normative-assistant.controller.ts`:

```ts
import { Body, Controller, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { NormativeAssistantService } from './normative-assistant.service';
import { NormativeQueryDto } from './dto/normative-query.dto';

@Controller('assistant')
export class NormativeAssistantController {
  constructor(private readonly assistant: NormativeAssistantService) {}

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('normative-query')
  query(@Body() dto: NormativeQueryDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.assistant.query(client, dto.question));
  }
}
```

- [ ] **Step 8: Registrar tudo no módulo**

Em `backend/src/normative/normative.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { OfficialSourcesController } from './official-sources.controller';
import { OfficialSourcesService } from './official-sources.service';
import { NormativeDocumentsService } from './normative-documents.service';
import { NormativeDocumentsController } from './normative-documents.controller';
import { NormativeMonitorService } from './normative-monitor.service';
import { NormativeAssistantService } from './normative-assistant.service';
import { NormativeAssistantController } from './normative-assistant.controller';
import { R2Service } from '../documents/r2.service';
import { EMBEDDING_PROVIDER } from './embedding-provider.interface';
import { OpenRouterEmbeddingService } from './openrouter-embedding.service';
import { NORMATIVE_ANSWER_PROVIDER } from './normative-answer-provider.interface';
import { OpenRouterNormativeAnswerService } from './openrouter-normative-answer.service';

@Module({
  controllers: [OfficialSourcesController, NormativeDocumentsController, NormativeAssistantController],
  providers: [
    OfficialSourcesService,
    NormativeDocumentsService,
    NormativeMonitorService,
    NormativeAssistantService,
    R2Service,
    OpenRouterEmbeddingService,
    { provide: EMBEDDING_PROVIDER, useClass: OpenRouterEmbeddingService },
    OpenRouterNormativeAnswerService,
    { provide: NORMATIVE_ANSWER_PROVIDER, useClass: OpenRouterNormativeAnswerService },
  ],
})
export class NormativeModule {}
```

- [ ] **Step 9: Wire `OPENROUTER_RAG_MIN_SIMILARITY`**

Em `docker-compose.yml`, junto das outras `OPENROUTER_*`:

```yaml
      OPENROUTER_RAG_MIN_SIMILARITY: ${OPENROUTER_RAG_MIN_SIMILARITY:-0.75}
```

Em `.env.example`:

```
OPENROUTER_RAG_MIN_SIMILARITY=0.75
```

- [ ] **Step 10: Rodar o teste e confirmar que passa**

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  -e DATABASE_URL="$DATABASE_URL" -e TEST_SUPERUSER_DATABASE_URL="$TEST_SUPERUSER_DATABASE_URL" -e REDIS_URL="$REDIS_URL" -e JWT_SECRET="$JWT_SECRET" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative-assistant"
```

Esperado: 4 testes passando.

- [ ] **Step 11: Rodar a suíte inteira de `normative-*` pra confirmar que nada quebrou entre tasks**

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  -e DATABASE_URL="$DATABASE_URL" -e TEST_SUPERUSER_DATABASE_URL="$TEST_SUPERUSER_DATABASE_URL" -e REDIS_URL="$REDIS_URL" -e JWT_SECRET="$JWT_SECRET" \
  -e R2_ENDPOINT="$R2_ENDPOINT" -e R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" -e R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" -e R2_BUCKET="$R2_BUCKET" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative"
```

Esperado: todas as suítes `normative-*` passando (22 testes ao todo entre as Tasks 1-7).

- [ ] **Step 12: Commit**

```bash
git add backend/src/normative/normative-answer-provider.interface.ts backend/src/normative/normative-answer-shared.ts backend/src/normative/openrouter-normative-answer.service.ts backend/src/normative/normative-assistant.service.ts backend/src/normative/dto/normative-query.dto.ts backend/src/normative/normative-assistant.controller.ts backend/src/normative/normative.module.ts backend/src/common/env.ts docker-compose.yml .env.example backend/test/normative-assistant.e2e-spec.ts
git commit -m "feat: consulta do Assistente com Verificador deterministico (Fase 9)"
```

---

### Task 8: Frontend — tela admin "Base normativa"

**Files:**
- Create: `frontend/src/app/admin/normativa/page.tsx`
- Modify: `frontend/src/components/AdminSidebar.tsx`

**Interfaces:**
- Consumes: `GET/POST /normative-sources`, `GET /normative-documents`, `GET /normative-documents/:id`, `POST /normative-documents/:id/approve|reject|reindex` (Tasks 4 e 6).
- Produces: nada consumido por outra task.

- [ ] **Step 1: Adicionar o item no `AdminSidebar`**

Em `frontend/src/components/AdminSidebar.tsx`, no array `LINKS`:

```ts
const LINKS = [
  { href: '/admin/overview', label: 'Visão Geral' },
  { href: '/admin/empresas', label: 'Empresas' },
  { href: '/admin/tecnicos', label: 'Técnicos' },
  { href: '/admin/parceiros', label: 'Parceiros' },
  { href: '/admin/normativa', label: 'Base normativa' },
  { href: '/admin/auditoria', label: 'Auditoria' },
  { href: '/admin/financeiro', label: 'Financeiro' },
];
```

- [ ] **Step 2: Criar a página**

Criar `frontend/src/app/admin/normativa/page.tsx`:

```tsx
'use client';

import { FormEvent, useEffect, useState } from 'react';

interface OfficialSource {
  id: string;
  entity: string;
  code: string | null;
  title: string;
  official_url: string;
  active: boolean;
}

interface NormativeDocument {
  id: string;
  source_id: string;
  status: string;
  file_name: string;
  detected_at: string;
  indexed_at: string | null;
  rejection_reason: string | null;
}

interface DocumentDetail {
  document: NormativeDocument & { raw_text: string };
  previous_text: string | null;
}

function authHeaders() {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}

export default function AdminNormativaPage() {
  const [sources, setSources] = useState<OfficialSource[]>([]);
  const [pending, setPending] = useState<NormativeDocument[]>([]);
  const [vigentes, setVigentes] = useState<NormativeDocument[]>([]);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [entity, setEntity] = useState('');
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [officialUrl, setOfficialUrl] = useState('');
  const [createStatus, setCreateStatus] = useState<'idle' | 'loading' | 'erro'>('idle');

  async function loadAll() {
    const [sourcesRes, pendingRes, vigentesRes] = await Promise.all([
      fetch('/api/normative-sources', { headers: authHeaders() }),
      fetch('/api/normative-documents?status=aguardando_validacao', { headers: authHeaders() }),
      fetch('/api/normative-documents?status=vigente', { headers: authHeaders() }),
    ]);
    if (sourcesRes.ok) setSources(await sourcesRes.json());
    if (pendingRes.ok) setPending(await pendingRes.json());
    if (vigentesRes.ok) setVigentes(await vigentesRes.json());
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleCreateSource(event: FormEvent) {
    event.preventDefault();
    setCreateStatus('loading');
    const res = await fetch('/api/normative-sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ entity, code: code || undefined, title, official_url: officialUrl }),
    });
    if (res.ok) {
      setEntity('');
      setCode('');
      setTitle('');
      setOfficialUrl('');
      setCreateStatus('idle');
      loadAll();
      return;
    }
    setCreateStatus('erro');
  }

  async function openDetail(id: string) {
    const res = await fetch(`/api/normative-documents/${id}`, { headers: authHeaders() });
    if (res.ok) setDetail(await res.json());
  }

  async function handleApprove(id: string) {
    await fetch(`/api/normative-documents/${id}/approve`, { method: 'POST', headers: authHeaders() });
    setDetail(null);
    loadAll();
  }

  async function handleReject(id: string) {
    await fetch(`/api/normative-documents/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ reason: rejectReason }),
    });
    setRejectReason('');
    setDetail(null);
    loadAll();
  }

  async function handleReindex(id: string) {
    await fetch(`/api/normative-documents/${id}/reindex`, { method: 'POST', headers: authHeaders() });
    loadAll();
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-brand-900">Base normativa</h2>

      <section className="mt-8 rounded-lg border border-brand-100 p-6">
        <h3 className="text-lg font-bold text-brand-900">Fontes monitoradas</h3>
        <form onSubmit={handleCreateSource} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input placeholder="Entidade (ex: MTE)" value={entity} onChange={(e) => setEntity(e.target.value)} required className="rounded-md border border-brand-100 px-3 py-2" />
          <input placeholder="Código (ex: NR-06)" value={code} onChange={(e) => setCode(e.target.value)} className="rounded-md border border-brand-100 px-3 py-2" />
          <input placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} required className="rounded-md border border-brand-100 px-3 py-2 sm:col-span-2" />
          <input placeholder="URL oficial" value={officialUrl} onChange={(e) => setOfficialUrl(e.target.value)} required className="rounded-md border border-brand-100 px-3 py-2 sm:col-span-2" />
          {createStatus === 'erro' && <p className="text-sm text-red-600 sm:col-span-2">Não foi possível cadastrar. Confira a URL.</p>}
          <button type="submit" disabled={createStatus === 'loading'} className="self-start rounded-md bg-brand-500 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 sm:col-span-2">
            Cadastrar fonte
          </button>
        </form>
        <ul className="mt-4 flex flex-col gap-1 text-sm text-brand-700">
          {sources.map((s) => (
            <li key={s.id}>
              {s.entity} {s.code ? `— ${s.code}` : ''} — {s.title}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 rounded-lg border border-brand-100 p-6">
        <h3 className="text-lg font-bold text-brand-900">Aguardando validação ({pending.length})</h3>
        <ul className="mt-4 flex flex-col gap-2">
          {pending.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between rounded-md border border-brand-100 px-3 py-2 text-sm">
              <span>{doc.file_name} — detectado em {new Date(doc.detected_at).toLocaleDateString('pt-BR')}</span>
              <button onClick={() => openDetail(doc.id)} className="text-brand-500 underline">Revisar</button>
            </li>
          ))}
          {pending.length === 0 && <p className="text-sm text-brand-700">Nada pendente.</p>}
        </ul>
      </section>

      <section className="mt-8 rounded-lg border border-brand-100 p-6">
        <h3 className="text-lg font-bold text-brand-900">Vigentes ({vigentes.length})</h3>
        <ul className="mt-4 flex flex-col gap-2">
          {vigentes.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between rounded-md border border-brand-100 px-3 py-2 text-sm">
              <span>{doc.file_name} — {doc.indexed_at ? 'indexado' : 'aprovado, indexação pendente'}</span>
              {!doc.indexed_at && (
                <button onClick={() => handleReindex(doc.id)} className="text-brand-500 underline">Reindexar</button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {detail && (
        <section className="mt-8 rounded-lg border border-brand-500 p-6">
          <h3 className="text-lg font-bold text-brand-900">Revisar versão</h3>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <h4 className="text-sm font-bold text-brand-700">Texto anterior</h4>
              <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-brand-700">
                {detail.previous_text || '(nenhuma versão vigente anterior)'}
              </p>
            </div>
            <div>
              <h4 className="text-sm font-bold text-brand-700">Texto novo</h4>
              <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-brand-900">
                {detail.document.raw_text}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button onClick={() => handleApprove(detail.document.id)} className="rounded-md bg-brand-500 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Aprovar
            </button>
            <input
              placeholder="Motivo da rejeição"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="flex-1 rounded-md border border-brand-100 px-3 py-2 text-sm"
            />
            <button onClick={() => handleReject(detail.document.id)} disabled={!rejectReason} className="rounded-md border border-red-600 px-6 py-2 text-sm font-medium text-red-600 disabled:opacity-50">
              Rejeitar
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar o build**

```bash
cd /opt/Montese/frontend
npx tsc --noEmit -p tsconfig.json
```

Esperado: sem erros. Depois:

```bash
docker build -t montese-frontend-buildcheck .
docker rmi montese-frontend-buildcheck
```

Esperado: build completo sem erro, imagem removida em seguida.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/admin/normativa/page.tsx frontend/src/components/AdminSidebar.tsx
git commit -m "feat: tela admin Base normativa (Fase 9)"
```

---

### Task 9: Frontend — Assistente (empresa e técnico)

**Files:**
- Create: `frontend/src/components/AssistantChat.tsx`
- Create: `frontend/src/app/empresa/assistente/page.tsx`
- Create: `frontend/src/app/tecnico/assistente/page.tsx`
- Modify: `frontend/src/components/EmpresaSidebar.tsx`

**Interfaces:**
- Consumes: `POST /assistant/normative-query`, `GET /normative-documents/:id/download` (Task 6, 7).
- Produces: nada consumido por outra task — última task da fase.

- [ ] **Step 1: Adicionar o item no `EmpresaSidebar`**

Em `frontend/src/components/EmpresaSidebar.tsx`, no array `LINKS`:

```ts
const LINKS = [
  { href: '/empresa/dashboard', label: 'Início' },
  { href: '/empresa/assistente', label: 'Assistente' },
  { href: '/empresa/documentos', label: 'Documentos' },
  { href: '/empresa/epis', label: 'EPIs' },
  { href: '/empresa/inspecoes', label: 'Inspeções' },
  { href: '/empresa/onboarding', label: 'Dados da empresa' },
];
```

Técnico e parceiro ainda não têm sidebar própria (só o rodapé, adicionado antes desta fase) — `/tecnico/assistente` fica acessível como página, sem link de navegação nova ainda, conforme já registrado em `docs/specs/fase-9-rag-normativo.md` §5 (isso faz parte do sub-projeto futuro "Sistema do técnico", fora de escopo aqui).

- [ ] **Step 2: Criar o componente compartilhado**

Criar `frontend/src/components/AssistantChat.tsx`:

```tsx
'use client';

import { FormEvent, useState } from 'react';

interface Citation {
  document_id: string;
  title: string;
  official_url: string;
}

interface QueryResult {
  answer: string | null;
  message?: string;
  citations: Citation[];
}

function authHeaders() {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}

export function AssistantChat() {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'erro'>('idle');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setResult(null);
    try {
      const res = await fetch('/api/assistant/normative-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ question }),
      });
      if (res.ok) {
        setResult(await res.json());
        setStatus('idle');
        return;
      }
      setStatus('erro');
    } catch {
      setStatus('erro');
    }
  }

  async function openCitation(documentId: string) {
    const res = await fetch(`/api/normative-documents/${documentId}/download`, { headers: authHeaders() });
    if (res.ok) {
      const { url } = await res.json();
      window.open(url, '_blank');
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <textarea
          required
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Pergunte sobre uma norma de SST — ex: preciso fornecer capacete pra que função?"
          rows={3}
          className="rounded-md border border-brand-100 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={status === 'loading' || !question.trim()}
          className="self-start rounded-md bg-brand-500 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Consultando...' : 'Perguntar'}
        </button>
        {status === 'erro' && <p className="text-sm text-red-600">Não foi possível consultar agora. Tente de novo.</p>}
      </form>

      {result && (
        <div className="mt-6 rounded-lg border border-brand-100 p-6">
          <p className="whitespace-pre-wrap text-sm text-brand-900">{result.answer ?? result.message}</p>
          {result.citations.length > 0 && (
            <div className="mt-4 flex flex-col gap-1">
              <h4 className="text-xs font-bold uppercase tracking-wide text-brand-700">Fontes</h4>
              {result.citations.map((c) => (
                <button
                  key={c.document_id}
                  onClick={() => openCitation(c.document_id)}
                  className="text-left text-sm text-brand-500 underline hover:text-brand-700"
                >
                  {c.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="mt-6 text-xs text-brand-700">
        O Assistente organiza informação de fontes oficiais — ele não substitui a avaliação de um
        profissional de Segurança e Saúde do Trabalho legalmente habilitado.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Criar a página da empresa**

Criar `frontend/src/app/empresa/assistente/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AssistantChat } from '@/components/AssistantChat';

export default function EmpresaAssistentePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Assistente Montese SST</h1>
      <p className="mt-2 text-brand-700">Pergunte sobre normas de SST — a resposta sempre vem com a fonte oficial.</p>
      <div className="mt-8">
        <AssistantChat />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Criar a página do técnico**

Criar `frontend/src/app/tecnico/assistente/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AssistantChat } from '@/components/AssistantChat';

export default function TecnicoAssistentePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Assistente Montese SST</h1>
      <p className="mt-2 text-brand-700">Pergunte sobre normas de SST — a resposta sempre vem com a fonte oficial.</p>
      <div className="mt-8">
        <AssistantChat />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verificar o build**

```bash
cd /opt/Montese/frontend
npx tsc --noEmit -p tsconfig.json
docker build -t montese-frontend-buildcheck .
docker rmi montese-frontend-buildcheck
```

Esperado: sem erros de tipo, build completo, imagem removida.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/AssistantChat.tsx frontend/src/app/empresa/assistente/page.tsx frontend/src/app/tecnico/assistente/page.tsx frontend/src/components/EmpresaSidebar.tsx
git commit -m "feat: pagina Assistente para empresa e tecnico (Fase 9)"
```

---

## Depois da última task

Rodar a suíte e2e completa (não só `normative-*`) pra confirmar zero regressão:

```bash
source /opt/Montese/.env
export DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}"
export TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}"
export REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379"
docker exec montese_redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'ratelimit:*' | xargs -r -I{} docker exec montese_redis redis-cli -a "$REDIS_PASSWORD" DEL {}
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  -e DATABASE_URL="$DATABASE_URL" -e TEST_SUPERUSER_DATABASE_URL="$TEST_SUPERUSER_DATABASE_URL" -e REDIS_URL="$REDIS_URL" -e JWT_SECRET="$JWT_SECRET" \
  -e R2_ENDPOINT="$R2_ENDPOINT" -e R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" -e R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" -e R2_BUCKET="$R2_BUCKET" \
  -e OPENROUTER_API_KEY="$OPENROUTER_API_KEY" -e MERCADOPAGO_ACCESS_TOKEN="$MERCADOPAGO_ACCESS_TOKEN" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand"
```

Depois: deploy real (`docker compose build backend frontend && docker compose up -d backend frontend`), rodar `db:migrate` no container de produção (no-op se já aplicado), e ao menos uma consulta real ao Assistente contra a API paga da OpenRouter com uma fonte de verdade cadastrada e aprovada manualmente — mesmo processo de validação manual da Fase 8 (spec §6/pendências), pra medir custo real por consulta antes de anunciar a funcionalidade como pronta.

Por fim, atualizar `docs/compliance/matriz-conformidade.md` (categoria G, "Política de Funcionamento dos Agentes Especializados") — mesmo padrão da Fase 8: o texto formal nasce junto da ativação em produção, não durante a implementação (spec §8, primeiro item de pendência).
