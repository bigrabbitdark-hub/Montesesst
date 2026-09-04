# Fase 17 — Consulta de CA (base oficial CAEPI/MTE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma tela de consulta de CA (Certificado de Aprovação de EPI) baseada num espelho local, sincronizado sob demanda, da base oficial que o MTE disponibiliza pra download (sistema CAEPI).

**Architecture:** Um script standalone (`npm run caepi:sync`, mesmo padrão de `db:migrate`) baixa a base do FTP público do MTE, faz parsing defensivo de um ZIP malformado na origem, e grava em lote numa tabela nova sem RLS (dado público, não é de tenant). Um módulo NestJS novo (`CaepiModule`) expõe busca só-leitura sobre essa tabela. Frontend ganha uma tela nova, acessível pela empresa e pelo técnico.

**Tech Stack:** NestJS + Postgres no backend (sem SQL novo além da migration), Node/`tsx` pro script de sincronização (biblioteca nova: `basic-ftp`, já verificada nesta sessão contra o servidor real do MTE), Next.js App Router + Tailwind no frontend, sem test runner de frontend (Playwright manual contra produção).

**Spec:** `docs/specs/fase-17-consulta-ca.md`

## Global Constraints

- `caepi_records`/`caepi_sync_status` são dados públicos globais, **não são escopados por tenant e não têm RLS** — diferente de toda tabela criada em fases anteriores desta sessão (fases 12-16, todas CIPA, todas com RLS). **Correção (achada na revisão final)**: já existe precedente real fora desta sessão — `epi_catalog_items` (migration 0013) e `official_sources`/`normative_documents` (migration 0021) seguem o mesmo padrão pelo mesmo motivo (dado de referência compartilhado). Não é uma exceção inédita no projeto. Qualquer usuário autenticado com papel `empresa`/`tecnico`/`parceiro` pode consultar.
- Sincronização é sempre um script rodado manualmente (`npm run caepi:sync`) — sem scheduler novo, sem rota HTTP que dispare a sincronização.
- O ZIP da fonte oficial vem malformado (sem registro de fim de índice central) e pode vir truncado no meio de um registro — o parsing precisa ser defensivo desde o início, não como tratamento de caso extremo. Validado nesta sessão com download real contra `ftp://ftp.mtps.gov.br/portal/fiscalizacao/seguranca-e-saude-no-trabalho/caepi/tgg_export_caepi.zip`: local file header do ZIP + descompressão `raw deflate` (sem esperar o rodapé do zip) usando o módulo `zlib` nativo do Node, e o texto resultante é UTF-8 (não Windows-1252, correção feita durante a pesquisa desta fase).
- Sem associar CA consultado ao cadastro de EPI (`tenant_epis`), sem agente de IA, sem reorganizar a sidebar num grupo "Gestão de EPIs" — fora de escopo desta fase (ver spec §6).
- Um único endpoint de busca (`GET /caepi/search?q=`) cobre número exato de CA e termo livre — sem lógica no frontend decidindo qual rota chamar.
- Backend tem suíte e2e real (Postgres real, sem mock de banco). Frontend sem test runner automatizado (`frontend/package.json` confirmado sem jest/vitest/testing-library) — verificação de frontend é manual, Playwright com sessão sintética via `localStorage` + `page.route()` mockando `/api/*`, contra a build de produção real (`docker compose build frontend`), mesmo padrão de toda fase anterior.
- Rodar a suíte e2e via `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit"` (container efêmero — a imagem de produção do backend não tem devDependencies; `--forceExit` evita o container ficar pendurado). Requer um `docker-compose.override.yml` local, temporário, nunca commitado, montando `./backend:/app` + volume anônimo em `/app/node_modules` + `NODE_ENV: development` — deletar depois de usar.

---

## Task 1: Migration — tabelas `caepi_records` e `caepi_sync_status`

**Files:**
- Create: `backend/db/migrations/0031_caepi.sql`

**Interfaces:**
- Consumes: nada de tasks anteriores (primeira task da fase).
- Produces: tabelas `caepi_records` (chave `numero_ca`) e `caepi_sync_status` (linha única, `id = 1`) — consumidas por Tasks 2 e 3.

- [ ] **Step 1: Criar a migration**

Criar `backend/db/migrations/0031_caepi.sql`:

```sql
-- Fase 17: Consulta de CA — espelho local da base pública do MTE
-- (sistema CAEPI). Diferente de toda tabela CIPA deste projeto: é
-- dado público global, igual pra qualquer tenant — sem tenant_id,
-- sem RLS. Ver docs/specs/fase-17-consulta-ca.md.

CREATE TABLE caepi_records (
  numero_ca TEXT PRIMARY KEY,
  data_validade DATE,
  situacao TEXT,
  numero_processo TEXT,
  cnpj TEXT,
  razao_social TEXT,
  natureza TEXT,
  equipamento TEXT,
  descricao_equipamento TEXT,
  marca_ca TEXT,
  referencia TEXT,
  cor TEXT,
  aprovado_laudo TEXT,
  restricao_laudo TEXT,
  observacao_laudo TEXT,
  cnpj_laboratorio TEXT,
  razao_social_laboratorio TEXT,
  numero_laudo TEXT,
  norma TEXT,
  -- Sem trigger set_updated_at() (padrão do resto do projeto) de
  -- propósito — a única gravação nesta tabela é o upsert em lote do
  -- script de sincronização (Task 2), que já sabe o timestamp exato
  -- e grava explicitamente no SET do próprio upsert. Um trigger
  -- disparando em cada uma de até centenas de milhares de linhas por
  -- sincronização seria overhead sem propósito real aqui.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uma linha só (id fixo em 1), sempre substituída por upsert — guarda
-- quando a última sincronização rodou, pra exibir na tela de busca.
CREATE TABLE caepi_sync_status (
  id INT PRIMARY KEY DEFAULT 1,
  last_synced_at TIMESTAMPTZ NOT NULL,
  rows_imported INT NOT NULL,
  rows_skipped INT NOT NULL,
  CONSTRAINT chk_single_row CHECK (id = 1)
);

-- Nenhuma das duas tabelas tem RLS — dado público, não pertence a
-- nenhum tenant. Qualquer usuário autenticado (empresa/tecnico/
-- parceiro) pode ler via a API (Task 3).
```

- [ ] **Step 2: Aplicar a migration e verificar**

Run: `npm run db:migrate` (mesmo mecanismo já usado em toda fase anterior desta sessão — contra o Postgres real do servidor).

Verificar no Postgres real (`\d caepi_records`, `\d caepi_sync_status`): as 2 tabelas existem com as colunas certas, `numero_ca` é `PRIMARY KEY`, `caepi_sync_status` tem o `CHECK (id = 1)`. Confirmar que **nenhuma** das duas tem `rowsecurity` ativado (`SELECT relrowsecurity FROM pg_class WHERE relname IN ('caepi_records', 'caepi_sync_status')` deve devolver `f` nas duas linhas) — é uma exceção deliberada ao padrão de todas as tabelas criadas em fases anteriores, então vale confirmar explicitamente que não foi ativado por engano.

- [ ] **Step 3: Commit**

```bash
git add backend/db/migrations/0031_caepi.sql
git commit -m "feat: migration das tabelas de Consulta de CA — caepi_records, caepi_sync_status (sem RLS, dado público)"
```

---

## Task 2: Script de sincronização (`npm run caepi:sync`)

**Files:**
- Modify: `backend/package.json`
- Create: `backend/db/caepi-sync.ts`

**Interfaces:**
- Consumes: tabelas `caepi_records`/`caepi_sync_status` (Task 1).
- Produces: comando `npm run caepi:sync` — popula as duas tabelas. Nenhuma task seguinte depende de nenhuma função/tipo exportado deste script (é standalone, chamado só via linha de comando).

- [ ] **Step 1: Adicionar a dependência `basic-ftp`**

`basic-ftp` já foi instalado e testado de ponta a ponta nesta sessão
(versão real confirmada: `6.2.1`) contra o servidor real do MTE — o
download, a extração e o parsing completos já funcionaram. Adicionar
como dependência de produção (não devDependency — o script roda no
container de produção via `COPY db ./db` no Dockerfile, mesmo caminho
já usado por `db/migrate.ts`):

```bash
npm install basic-ftp
```

Confirmar que `"basic-ftp"` foi adicionado em `"dependencies"` (não
`"devDependencies"`) de `backend/package.json`.

- [ ] **Step 2: Adicionar o script no `package.json`**

Em `backend/package.json`, no bloco `"scripts"` (hoje tem `db:migrate`/
`db:seed`/etc.), adicionar uma entrada nova:

```json
    "caepi:sync": "tsx db/caepi-sync.ts",
```

- [ ] **Step 3: Escrever o script de sincronização**

Criar `backend/db/caepi-sync.ts`:

```ts
import { readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import * as zlib from 'zlib';
import { Client } from 'pg';
import * as ftp from 'basic-ftp';

const FTP_HOST = 'ftp.mtps.gov.br';
const FTP_PATH = '/portal/fiscalizacao/seguranca-e-saude-no-trabalho/caepi/tgg_export_caepi.zip';
const EXPECTED_COLUMNS = 19;
const BATCH_SIZE = 1000;

interface CaepiRow {
  numero_ca: string;
  data_validade: string | null;
  situacao: string | null;
  numero_processo: string | null;
  cnpj: string | null;
  razao_social: string | null;
  natureza: string | null;
  equipamento: string | null;
  descricao_equipamento: string | null;
  marca_ca: string | null;
  referencia: string | null;
  cor: string | null;
  aprovado_laudo: string | null;
  restricao_laudo: string | null;
  observacao_laudo: string | null;
  cnpj_laboratorio: string | null;
  razao_social_laboratorio: string | null;
  numero_laudo: string | null;
  norma: string | null;
}

function parseBrDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function nullIfEmpty(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

async function downloadZip(destPath: string): Promise<void> {
  const client = new ftp.Client(30_000);
  try {
    // Acesso anônimo — user/password default da lib já são
    // "anonymous"/"guest", equivalente ao USER anonymous / PASS guest
    // que o servidor aceita (confirmado nesta sessão via teste real).
    await client.access({ host: FTP_HOST });
    await client.downloadTo(destPath, FTP_PATH);
  } finally {
    client.close();
  }
}

// O ZIP do próprio MTE vem sem o registro de fim de índice central
// (End of Central Directory) — ferramentas de zip padrão (incluindo
// qualquer lib de zip completa) falham ao abrir esse arquivo. A única
// forma confiável de ler o conteúdo, validada nesta sessão com
// download real, é fazer o parsing manual do cabeçalho local do
// primeiro (e único) arquivo dentro do zip, e então descomprimir o
// restante como um stream deflate bruto (`zlib.createInflateRaw`),
// tolerando que ele termine sem o marcador de fim — o arquivo do
// próprio governo já veio cortado no meio de um registro num teste
// real feito durante o brainstorming desta fase, e é esperado que
// isso aconteça de novo.
async function extractCaepiText(zipPath: string): Promise<Buffer> {
  const data = readFileSync(zipPath);
  if (data.length < 30 || data.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('Arquivo não começa com uma assinatura de local file header de ZIP válida (PK\\x03\\x04)');
  }
  const fnameLen = data.readUInt16LE(26);
  const extraLen = data.readUInt16LE(28);
  const headerEnd = 30 + fnameLen + extraLen;
  const compressed = data.subarray(headerEnd);

  return new Promise((resolve) => {
    const inflater = zlib.createInflateRaw();
    const chunks: Buffer[] = [];
    inflater.on('data', (chunk: Buffer) => chunks.push(chunk));
    // Um 'error' aqui é o comportamento normal e esperado deste
    // arquivo (stream deflate sem marcador de fim, por causa do
    // truncamento na origem) — já recebemos em 'data' tudo que deu
    // pra descomprimir até o ponto do corte, que é o que importa.
    inflater.on('error', () => resolve(Buffer.concat(chunks)));
    inflater.on('end', () => resolve(Buffer.concat(chunks)));
    inflater.end(compressed);
  });
}

// O texto descomprimido já é UTF-8 (confirmado nesta sessão testando
// as três hipóteses de encoding lado a lado contra os bytes reais —
// Windows-1252/Latin-1 corrompem os acentos, só UTF-8 produz texto
// correto) — sem conversão de encoding necessária.
function parseCaepiText(raw: Buffer): { rows: CaepiRow[]; skipped: number } {
  const text = raw.toString('utf8');
  const lines = text.split(/\r?\n/);
  const rows: CaepiRow[] = [];
  let skipped = 0;

  // Primeira linha é o cabeçalho (nomes de coluna) — não é dado.
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = line.split('|');
    if (cols.length !== EXPECTED_COLUMNS) {
      // Linha final cortada, ou qualquer outra linha malformada —
      // pula e conta, não derruba a sincronização inteira por isso.
      skipped++;
      continue;
    }
    const numeroCa = nullIfEmpty(cols[0]);
    if (!numeroCa) {
      skipped++;
      continue;
    }
    rows.push({
      numero_ca: numeroCa,
      data_validade: parseBrDate(cols[1]),
      situacao: nullIfEmpty(cols[2]),
      numero_processo: nullIfEmpty(cols[3]),
      cnpj: nullIfEmpty(cols[4]),
      razao_social: nullIfEmpty(cols[5]),
      natureza: nullIfEmpty(cols[6]),
      equipamento: nullIfEmpty(cols[7]),
      descricao_equipamento: nullIfEmpty(cols[8]),
      marca_ca: nullIfEmpty(cols[9]),
      referencia: nullIfEmpty(cols[10]),
      cor: nullIfEmpty(cols[11]),
      aprovado_laudo: nullIfEmpty(cols[12]),
      restricao_laudo: nullIfEmpty(cols[13]),
      observacao_laudo: nullIfEmpty(cols[14]),
      cnpj_laboratorio: nullIfEmpty(cols[15]),
      razao_social_laboratorio: nullIfEmpty(cols[16]),
      numero_laudo: nullIfEmpty(cols[17]),
      norma: nullIfEmpty(cols[18]),
    });
  }
  return { rows, skipped };
}

async function upsertRows(client: Client, rows: CaepiRow[]): Promise<void> {
  const columns = [
    'numero_ca', 'data_validade', 'situacao', 'numero_processo', 'cnpj', 'razao_social',
    'natureza', 'equipamento', 'descricao_equipamento', 'marca_ca', 'referencia', 'cor',
    'aprovado_laudo', 'restricao_laudo', 'observacao_laudo', 'cnpj_laboratorio',
    'razao_social_laboratorio', 'numero_laudo', 'norma',
  ] as const;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    batch.forEach((row, idx) => {
      const base = idx * columns.length;
      const rowPlaceholders = columns.map((_, k) => `$${base + k + 1}`);
      placeholders.push(`(${rowPlaceholders.join(', ')}, now())`);
      for (const col of columns) {
        values.push(row[col]);
      }
    });

    await client.query(
      `INSERT INTO caepi_records (${columns.join(', ')}, updated_at)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (numero_ca) DO UPDATE SET
         ${columns
           .filter((c) => c !== 'numero_ca')
           .map((c) => `${c} = EXCLUDED.${c}`)
           .join(', ')},
         updated_at = EXCLUDED.updated_at`,
      values,
    );
  }
}

async function main() {
  const tmpZipPath = join(tmpdir(), `caepi-${randomUUID()}.zip`);
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    console.log('[caepi-sync] baixando base do FTP do MTE...');
    await downloadZip(tmpZipPath);

    console.log('[caepi-sync] extraindo e descomprimindo...');
    const raw = await extractCaepiText(tmpZipPath);

    console.log('[caepi-sync] parseando linhas...');
    const { rows, skipped } = parseCaepiText(raw);
    console.log(`[caepi-sync] ${rows.length} linhas válidas, ${skipped} puladas`);

    if (rows.length === 0) {
      throw new Error('Nenhuma linha válida extraída — abortando sem gravar (provável falha de download/parsing, não um estado real da base)');
    }

    await client.connect();
    console.log('[caepi-sync] gravando no banco (upsert em lote)...');
    await upsertRows(client, rows);

    await client.query(
      `INSERT INTO caepi_sync_status (id, last_synced_at, rows_imported, rows_skipped)
       VALUES (1, now(), $1, $2)
       ON CONFLICT (id) DO UPDATE SET
         last_synced_at = EXCLUDED.last_synced_at,
         rows_imported = EXCLUDED.rows_imported,
         rows_skipped = EXCLUDED.rows_skipped`,
      [rows.length, skipped],
    );

    console.log(`[caepi-sync] concluído — ${rows.length} registros importados/atualizados, ${skipped} pulados.`);
  } finally {
    await client.end().catch(() => {});
    try {
      unlinkSync(tmpZipPath);
    } catch {
      // Arquivo temporário já pode não existir se o download falhou
      // antes de completar — não é um erro que importa aqui.
    }
  }
}

main().catch((err) => {
  console.error('[caepi-sync] falhou:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Rodar o script de verdade contra o Postgres real**

**Isto é diferente do guardrail de "nunca rodar seed/SQL direto fora
de fixtures de teste"** — aquele guardrail existe pra proteger dado
de tenant (empresas/usuários fictícios poluindo o banco real). Aqui é
o oposto: `caepi_records`/`caepi_sync_status` são tabelas de
referência pública, sem tenant nenhum, e rodar a sincronização de
verdade contra a base real do MTE **é literalmente a funcionalidade
sendo entregue nesta task** — não precisa (nem deve) ser desfeito
depois. Rode:

```bash
npm run caepi:sync
```

Run isso dentro do container `montese_backend` real (`docker compose
exec backend npm run caepi:sync`) ou localmente contra
`DATABASE_URL` apontando pro Postgres real do servidor — mesmo
mecanismo já usado pra rodar `npm run db:migrate` manualmente.

Confirme no terminal: a mensagem final reporta um número de linhas
importadas na casa de dezenas ou centenas de milhares (a base real
tem um volume grande — no teste desta sessão, mesmo com o arquivo
vindo cortado no meio, ainda foram ~65 mil linhas válidas). Confirme
no Postgres real: `SELECT count(*) FROM caepi_records;` bate com o
número reportado, e `SELECT * FROM caepi_sync_status;` tem uma linha
com `last_synced_at` recente.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/db/caepi-sync.ts
git commit -m "feat: script de sincronização da base CAEPI/MTE (npm run caepi:sync)"
```

---

## Task 3: Backend — `CaepiModule` (busca + status de sincronização)

**Files:**
- Create: `backend/src/caepi/caepi.service.ts`
- Create: `backend/src/caepi/caepi.controller.ts`
- Create: `backend/src/caepi/caepi.module.ts`
- Modify: `backend/src/app.module.ts`
- Create: `backend/test/caepi.e2e-spec.ts`

**Interfaces:**
- Consumes: tabelas `caepi_records`/`caepi_sync_status` (Task 1); `DatabaseService.withoutTenantContext` (`backend/src/common/database/database.service.ts`, já existe — método já pensado exatamente pra este caso, consultas sem contexto de tenant, sem `SET LOCAL`/RLS).
- Produces: `GET /caepi/search?q=`, `GET /caepi/sync-status` — usados pelo frontend (Task 4).

- [ ] **Step 1: `CaepiService`**

Criar `backend/src/caepi/caepi.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';

// Coluna DATE do Postgres — node-pg devolve um objeto Date (não
// string) fora de um contexto que passe por JSON.stringify. Mesmo
// padrão já usado localmente em cada módulo deste projeto (ex.
// dashboard.service.ts) — não importado de outro módulo, já que é
// uma função de 3 linhas sem motivo pra criar uma dependência cruzada
// entre caepi (dado público, sem tenant) e um módulo não relacionado.
function toDateString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

export interface CaepiRecord {
  numero_ca: string;
  data_validade: string | null;
  situacao: string | null;
  numero_processo: string | null;
  cnpj: string | null;
  razao_social: string | null;
  natureza: string | null;
  equipamento: string | null;
  descricao_equipamento: string | null;
  marca_ca: string | null;
  referencia: string | null;
  cor: string | null;
  aprovado_laudo: string | null;
  restricao_laudo: string | null;
  observacao_laudo: string | null;
  cnpj_laboratorio: string | null;
  razao_social_laboratorio: string | null;
  numero_laudo: string | null;
  norma: string | null;
}

export interface CaepiSyncStatus {
  last_synced_at: string | null;
  rows_imported: number | null;
  rows_skipped: number | null;
}

function normalizeRecord(row: CaepiRecord): CaepiRecord {
  return { ...row, data_validade: toDateString(row.data_validade) };
}

@Injectable()
export class CaepiService {
  constructor(private readonly db: DatabaseService) {}

  // Sem contexto de tenant — caepi_records não tem RLS, é dado
  // público. Mesmo raciocínio já documentado em
  // DatabaseService.withoutTenantContext.
  async search(q: string): Promise<CaepiRecord[]> {
    const pattern = `%${q}%`;
    const result = await this.db.withoutTenantContext((client) =>
      client.query<CaepiRecord>(
        `SELECT * FROM caepi_records
         WHERE numero_ca = $1
            OR equipamento ILIKE $2
            OR descricao_equipamento ILIKE $2
            OR marca_ca ILIKE $2
            OR razao_social ILIKE $2
         ORDER BY (numero_ca = $1) DESC, equipamento
         LIMIT 50`,
        [q, pattern],
      ),
    );
    return result.rows.map(normalizeRecord);
  }

  async getSyncStatus(): Promise<CaepiSyncStatus> {
    const result = await this.db.withoutTenantContext((client) =>
      client.query<{ last_synced_at: string; rows_imported: number; rows_skipped: number }>(
        'SELECT last_synced_at, rows_imported, rows_skipped FROM caepi_sync_status WHERE id = 1',
      ),
    );
    const row = result.rows[0];
    if (!row) {
      // Sincronização nunca rodou neste ambiente — estado válido e
      // esperado logo após o deploy inicial desta fase, não um erro.
      return { last_synced_at: null, rows_imported: null, rows_skipped: null };
    }
    return {
      last_synced_at: new Date(row.last_synced_at).toISOString(),
      rows_imported: row.rows_imported,
      rows_skipped: row.rows_skipped,
    };
  }
}
```

- [ ] **Step 2: `CaepiController`**

Criar `backend/src/caepi/caepi.controller.ts`:

```ts
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { CaepiService } from './caepi.service';

@Controller('caepi')
export class CaepiController {
  constructor(private readonly caepi: CaepiService) {}

  // Sem @Roles — mesmo padrão já usado em outras rotas GET só-leitura
  // deste projeto (ex. PendenciasController.findAll): qualquer papel
  // autenticado (empresa/tecnico/parceiro/admin) pode consultar, o
  // guard global de JWT já exige autenticação.
  @Get('search')
  search(@Query('q') q: string | undefined) {
    const trimmed = (q ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('Parâmetro de busca "q" é obrigatório');
    }
    return this.caepi.search(trimmed);
  }

  @Get('sync-status')
  syncStatus() {
    return this.caepi.getSyncStatus();
  }
}
```

- [ ] **Step 3: `CaepiModule`**

Criar `backend/src/caepi/caepi.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CaepiController } from './caepi.controller';
import { CaepiService } from './caepi.service';

@Module({
  controllers: [CaepiController],
  providers: [CaepiService],
})
export class CaepiModule {}
```

- [ ] **Step 4: Wiring em `AppModule`**

Modificar `backend/src/app.module.ts` — adicionar o import e incluir
`CaepiModule` no array `imports` já existente (depois de `CipaModule`,
mantendo a ordem em que os módulos foram sendo adicionados):

```ts
import { CaepiModule } from './caepi/caepi.module';
```

```ts
    CipaModule,
    CaepiModule,
  ],
```

- [ ] **Step 5: Teste e2e**

Criar `backend/test/caepi.e2e-spec.ts`. **Atenção**: `caepi_records`
não tem `tenant_id` nem RLS — diferente de todo outro teste e2e deste
projeto, a limpeza de fixture não pode depender do cascade de
`db.cleanup()` (que só apaga o que está vinculado aos tenants
rastreados pela fixture). Usa números de CA claramente fictícios
(prefixo `TESTE-`) e apaga explicitamente no `afterAll`.

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CAEPI — consulta de CA (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let empresaToken: string;
  const testCaNumbers = ['TESTE-99001', 'TESTE-99002'];
  // caepi_sync_status é uma tabela global de uma linha só, sem
  // tenant — a Task 2 pode já ter rodado a sincronização real contra
  // este mesmo Postgres antes deste teste (comportamento esperado e
  // correto). O teste de sync-status precisa gravar um valor
  // conhecido pra ser determinístico, então captura o que já existia
  // aqui pra restaurar no afterAll — nunca deixa o registro real
  // (ou a ausência dele) corrompido por dado de teste.
  let originalSyncStatus: { last_synced_at: string; rows_imported: number; rows_skipped: number } | null = null;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CAEPI Teste');
    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;

    const client = (db as any).client;
    await client.query(
      `INSERT INTO caepi_records (numero_ca, data_validade, situacao, equipamento, marca_ca, razao_social)
       VALUES
         ($1, CURRENT_DATE + INTERVAL '365 days', 'VÁLIDO', 'CAPACETE DE SEGURANÇA TESTE', 'MARCA TESTE X', 'FABRICANTE TESTE LTDA'),
         ($2, CURRENT_DATE - INTERVAL '30 days', 'VENCIDO', 'LUVA DE SEGURANÇA TESTE', 'MARCA TESTE Y', 'OUTRO FABRICANTE TESTE LTDA')`,
      testCaNumbers,
    );

    const existing = await client.query('SELECT last_synced_at, rows_imported, rows_skipped FROM caepi_sync_status WHERE id = 1');
    originalSyncStatus = existing.rows[0] ?? null;
  });

  afterAll(async () => {
    const client = (db as any).client;
    // Limpeza explícita — caepi_records não tem tenant_id, então o
    // cascade de db.cleanup() (abaixo) não alcança essas linhas.
    await client.query('DELETE FROM caepi_records WHERE numero_ca = ANY($1)', [testCaNumbers]);

    // Restaura caepi_sync_status pro estado de antes deste describe —
    // ver comentário na declaração de originalSyncStatus acima.
    if (originalSyncStatus) {
      await client.query(
        `INSERT INTO caepi_sync_status (id, last_synced_at, rows_imported, rows_skipped)
         VALUES (1, $1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET
           last_synced_at = EXCLUDED.last_synced_at,
           rows_imported = EXCLUDED.rows_imported,
           rows_skipped = EXCLUDED.rows_skipped`,
        [originalSyncStatus.last_synced_at, originalSyncStatus.rows_imported, originalSyncStatus.rows_skipped],
      );
    } else {
      await client.query('DELETE FROM caepi_sync_status WHERE id = 1');
    }

    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('busca por número de CA exato devolve o registro certo primeiro', async () => {
    const res = await request(app.getHttpServer())
      .get('/caepi/search?q=TESTE-99001')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].numero_ca).toBe('TESTE-99001');
    expect(res.body[0].situacao).toBe('VÁLIDO');
  });

  it('busca livre por equipamento encontra por ILIKE', async () => {
    const res = await request(app.getHttpServer())
      .get('/caepi/search?q=CAPACETE DE SEGURANÇA TESTE')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.some((r: any) => r.numero_ca === 'TESTE-99001')).toBe(true);
  });

  it('rejeita busca sem "q" com 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/caepi/search')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(400);
  });

  it('bloqueia acesso sem autenticação', async () => {
    const res = await request(app.getHttpServer()).get('/caepi/search?q=TESTE-99001');
    expect(res.status).toBe(401);
  });

  it('sync-status devolve exatamente os dados gravados na tabela', async () => {
    const client = (db as any).client;
    // Grava um estado conhecido diretamente — não confia em nenhum
    // estado ambiente que a sincronização real da Task 2 possa ou não
    // ter deixado neste mesmo Postgres (caepi_sync_status é uma
    // tabela global, sem tenant, então esse ambiente é compartilhado
    // com qualquer sincronização real já rodada). Torna o teste
    // determinístico independente da ordem de execução das tasks —
    // o valor original é restaurado no afterAll (ver
    // originalSyncStatus), então esta escrita não corrompe o estado
    // real de sincronização de forma permanente.
    await client.query(
      `INSERT INTO caepi_sync_status (id, last_synced_at, rows_imported, rows_skipped)
       VALUES (1, '2026-01-15T10:00:00Z', 12345, 6)
       ON CONFLICT (id) DO UPDATE SET
         last_synced_at = EXCLUDED.last_synced_at,
         rows_imported = EXCLUDED.rows_imported,
         rows_skipped = EXCLUDED.rows_skipped`,
    );

    const res = await request(app.getHttpServer())
      .get('/caepi/sync-status')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.rows_imported).toBe(12345);
    expect(res.body.rows_skipped).toBe(6);
    expect(new Date(res.body.last_synced_at).toISOString()).toBe('2026-01-15T10:00:00.000Z');
  });
});
```

- [ ] **Step 6: Verificar manualmente — build + suíte completa**

Run: `docker compose build backend` — confirmar zero erros de TypeScript.

Rodar a suíte e2e completa uma vez (ver Global Constraints pro comando
exato) e confirmar que `caepi.e2e-spec.ts` passa. Falhas em outras
suítes com `Received: 429` são o rate limiter global já documentado
em fases anteriores desta sessão (não relacionado a esta task).

- [ ] **Step 7: Commit**

```bash
git add backend/src/caepi/caepi.service.ts backend/src/caepi/caepi.controller.ts backend/src/caepi/caepi.module.ts backend/src/app.module.ts backend/test/caepi.e2e-spec.ts
git commit -m "feat: API de consulta de CA — busca e status de sincronização (GET /caepi/search, GET /caepi/sync-status)"
```

---

## Task 4: Frontend — tela de consulta de CA (empresa + técnico)

**Files:**
- Modify: `frontend/src/components/EmpresaSidebar.tsx`
- Modify: `frontend/src/components/TecnicoSidebar.tsx`
- Create: `frontend/src/app/empresa/consulta-ca/page.tsx`
- Create: `frontend/src/app/tecnico/consulta-ca/page.tsx`

**Interfaces:**
- Consumes: `GET /api/caepi/search?q=`, `GET /api/caepi/sync-status` (Task 3).
- Produces: nada consumido por task seguinte (última task da fase).

- [ ] **Step 1: Link na sidebar da empresa**

Modificar `frontend/src/components/EmpresaSidebar.tsx` — no grupo
`'Segurança'`, adicionar uma linha nova logo depois de `'EPIs'`:

```ts
      { href: '/empresa/assistente', label: 'Assistente', emoji: '💬' },
      { href: '/empresa/documentos', label: 'Documentos', emoji: '📄' },
      { href: '/empresa/epis', label: 'EPIs', emoji: '🦺' },
      { href: '/empresa/consulta-ca', label: 'Consulta de CA', emoji: '🔎' },
```

- [ ] **Step 2: Link na sidebar do técnico**

Modificar `frontend/src/components/TecnicoSidebar.tsx` — no grupo
`'Trabalho'`, adicionar uma linha nova:

```ts
  {
    label: 'Trabalho',
    links: [
      { href: '/tecnico/agenda', label: 'Agenda', emoji: '📅' },
      { href: '/tecnico/assistente', label: 'Assistente', emoji: '💬' },
      { href: '/tecnico/consulta-ca', label: 'Consulta de CA', emoji: '🔎' },
    ],
  },
```

- [ ] **Step 3: Página de consulta (empresa)**

Criar `frontend/src/app/empresa/consulta-ca/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface CaepiRecord {
  numero_ca: string;
  data_validade: string | null;
  situacao: string | null;
  equipamento: string | null;
  descricao_equipamento: string | null;
  marca_ca: string | null;
  razao_social: string | null;
  norma: string | null;
}

interface CaepiSyncStatus {
  last_synced_at: string | null;
  rows_imported: number | null;
  rows_skipped: number | null;
}

const SITUACAO_CLASS: Record<string, string> = {
  'VÁLIDO': 'bg-green-50 text-green-800',
  SUSPENSO: 'bg-amber-50 text-amber-800',
  VENCIDO: 'bg-red-50 text-red-800',
  CANCELADO: 'bg-red-50 text-red-800',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

function formatSyncedAt(iso: string | null): string {
  if (!iso) return 'nunca sincronizada';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function ConsultaCaPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CaepiRecord[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<CaepiSyncStatus | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
    fetch('/api/caepi/sync-status', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then(setSyncStatus)
      .catch(() => {});
  }, [router]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = query.trim();
    if (!trimmed) return;
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/caepi/search?q=${encodeURIComponent(trimmed)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError('Não foi possível buscar. Tente novamente.');
        return;
      }
      const data: CaepiRecord[] = await res.json();
      setResults(data);
      setSearched(true);
    } catch {
      setError('Falha de conexão ao buscar.');
    }
  }

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">🔎 Consulta de CA</h1>
      <p className="mt-1 text-sm text-brand-700">
        Busque pelo número do Certificado de Aprovação (CA) ou por equipamento/fabricante, na base
        oficial do MTE (sistema CAEPI).
      </p>

      <form onSubmit={handleSearch} className="mt-6 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Número do CA ou nome do equipamento"
          className="flex-1 rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
        />
        <button
          type="submit"
          className="rounded-[9px] bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Consultar
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 flex flex-col gap-2">
        {results.map((r) => (
          <div key={r.numero_ca} className="rounded-md border border-brand-100 px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-900">
                  CA {r.numero_ca} — {r.equipamento || 'Equipamento não informado'}
                </p>
                <p className="mt-0.5 text-xs text-brand-700">
                  Fabricante: {r.razao_social || '—'} · Marca: {r.marca_ca || '—'} · Validade:{' '}
                  {formatDate(r.data_validade)}
                  {r.norma && ` · Norma: ${r.norma}`}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  SITUACAO_CLASS[r.situacao ?? ''] ?? 'bg-brand-50 text-brand-700'
                }`}
              >
                {r.situacao ?? 'SITUAÇÃO DESCONHECIDA'}
              </span>
            </div>
          </div>
        ))}
        {searched && results.length === 0 && (
          <p className="text-sm text-brand-700">Nenhum CA encontrado pra essa busca.</p>
        )}
      </div>

      <p className="mt-8 text-xs text-brand-700">
        Fonte oficial: MTE / CAEPI. Base local atualizada em {formatSyncedAt(syncStatus?.last_synced_at ?? null)}.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Página de consulta (técnico)**

Criar `frontend/src/app/tecnico/consulta-ca/page.tsx` — o backend
(`GET /caepi/search`/`GET /caepi/sync-status`, Task 3) não distingue
por papel, então este arquivo é idêntico ao criado no Step 3, exceto
pelo nome do componente exportado (`TecnicoConsultaCaPage` em vez de
`ConsultaCaPage`, evitando dois componentes com o mesmo nome no
projeto — Next.js não exige isso, mas facilita navegação/debug):

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface CaepiRecord {
  numero_ca: string;
  data_validade: string | null;
  situacao: string | null;
  equipamento: string | null;
  descricao_equipamento: string | null;
  marca_ca: string | null;
  razao_social: string | null;
  norma: string | null;
}

interface CaepiSyncStatus {
  last_synced_at: string | null;
  rows_imported: number | null;
  rows_skipped: number | null;
}

const SITUACAO_CLASS: Record<string, string> = {
  'VÁLIDO': 'bg-green-50 text-green-800',
  SUSPENSO: 'bg-amber-50 text-amber-800',
  VENCIDO: 'bg-red-50 text-red-800',
  CANCELADO: 'bg-red-50 text-red-800',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

function formatSyncedAt(iso: string | null): string {
  if (!iso) return 'nunca sincronizada';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function TecnicoConsultaCaPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CaepiRecord[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<CaepiSyncStatus | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
    fetch('/api/caepi/sync-status', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then(setSyncStatus)
      .catch(() => {});
  }, [router]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = query.trim();
    if (!trimmed) return;
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/caepi/search?q=${encodeURIComponent(trimmed)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError('Não foi possível buscar. Tente novamente.');
        return;
      }
      const data: CaepiRecord[] = await res.json();
      setResults(data);
      setSearched(true);
    } catch {
      setError('Falha de conexão ao buscar.');
    }
  }

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">🔎 Consulta de CA</h1>
      <p className="mt-1 text-sm text-brand-700">
        Busque pelo número do Certificado de Aprovação (CA) ou por equipamento/fabricante, na base
        oficial do MTE (sistema CAEPI).
      </p>

      <form onSubmit={handleSearch} className="mt-6 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Número do CA ou nome do equipamento"
          className="flex-1 rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
        />
        <button
          type="submit"
          className="rounded-[9px] bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Consultar
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 flex flex-col gap-2">
        {results.map((r) => (
          <div key={r.numero_ca} className="rounded-md border border-brand-100 px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-900">
                  CA {r.numero_ca} — {r.equipamento || 'Equipamento não informado'}
                </p>
                <p className="mt-0.5 text-xs text-brand-700">
                  Fabricante: {r.razao_social || '—'} · Marca: {r.marca_ca || '—'} · Validade:{' '}
                  {formatDate(r.data_validade)}
                  {r.norma && ` · Norma: ${r.norma}`}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  SITUACAO_CLASS[r.situacao ?? ''] ?? 'bg-brand-50 text-brand-700'
                }`}
              >
                {r.situacao ?? 'SITUAÇÃO DESCONHECIDA'}
              </span>
            </div>
          </div>
        ))}
        {searched && results.length === 0 && (
          <p className="text-sm text-brand-700">Nenhum CA encontrado pra essa busca.</p>
        )}
      </div>

      <p className="mt-8 text-xs text-brand-700">
        Fonte oficial: MTE / CAEPI. Base local atualizada em {formatSyncedAt(syncStatus?.last_synced_at ?? null)}.
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Verificar manualmente no navegador**

`docker compose build frontend` — confirmar zero erros de
TypeScript/lint. Recriar o container (`docker compose up -d
frontend`) antes de testar — confirme que a stack inteira
(`postgres`/`redis`/`backend`/`frontend`/`nginx`) está de pé com
`docker compose ps` antes de testar contra `https://montesesst.com.br`
(nota já registrada em fase anterior desta sessão: `docker compose up
-d frontend` sozinho não reergue o `nginx` se a stack inteira estiver
parada).

Playwright contra a build de produção real, sessão sintética via
`localStorage` (`page.evaluate` numa navegação inicial, não
`page.addInitScript`), `page.route()` mockando `/api/caepi/search` e
`/api/caepi/sync-status`. Cenários mínimos, repetidos pras duas
páginas (`/empresa/consulta-ca` e `/tecnico/consulta-ca`):

1. Busca por número de CA — mock devolve 1 resultado com `situacao:
   'VÁLIDO'` — resultado aparece com badge verde, equipamento,
   fabricante, validade formatada em `DD/MM/AAAA`.
2. Busca sem resultado — mock devolve `[]` — mensagem "Nenhum CA
   encontrado pra essa busca" aparece.
3. `sync-status` mockado com `last_synced_at: null` — rodapé mostra
   "Base local atualizada em nunca sincronizada".
4. `sync-status` mockado com uma data real — rodapé mostra a data
   formatada.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/EmpresaSidebar.tsx frontend/src/components/TecnicoSidebar.tsx frontend/src/app/empresa/consulta-ca/page.tsx frontend/src/app/tecnico/consulta-ca/page.tsx
git commit -m "feat: tela de Consulta de CA — empresa e técnico"
```

---

## Depois da última task

- Rodar `docker compose build backend && docker compose build frontend`
  combinados uma última vez.
- Gerar o pacote de revisão final de toda a branch (merge-base =
  commit da spec/plano) e despachar a revisão final no modelo mais
  capaz disponível, seguindo `subagent-driven-development`.
- Fechar `docs/roadmap.md` com uma entrada detalhada desta fase, mesmo
  formato de toda fase anterior.
- Próxima frente da ordem já acordada (spec da Fase 12 §1): Documentos
  Técnicos (LTCAT/LIP) — segunda metade do item original do roadmap
  que esta fase não cobriu; e, mais adiante, o card da CIPA no
  dashboard principal (última da lista original). Nenhuma tem spec
  ainda, cada uma precisa de brainstorming próprio antes de qualquer
  plano.
