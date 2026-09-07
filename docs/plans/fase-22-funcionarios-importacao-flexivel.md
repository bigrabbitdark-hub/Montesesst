# Fase 22 — Funcionários: Importação de Planilha com Mapeamento Flexível Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empresa sobe uma planilha (CSV ou XLSX) com qualquer nome/ordem de coluna; um dicionário determinístico sugere o mapeamento pra nome/cpf/cargo/filial; a empresa revisa/confirma; a importação reaproveita a validação/inserção linha-a-linha que já existe hoje.

**Architecture:** Novo utilitário de parsing (`spreadsheet-import.util.ts`) cobrindo CSV (reaproveitando o parser já existente) e XLSX (via `exceljs`, biblioteca nova) + um dicionário de sinônimos determinístico (sem IA). Dois endpoints novos: `POST /employees/import-preview` (só sugere, não salva) e `POST /employees/import-mapped` (salva, reaproveitando a mesma lógica de validação/inserção que `importCsv` já tem, extraída pra um método privado compartilhado). Frontend: `FuncionariosForm.tsx` ganha um fluxo em 2 passos (mapeamento → confirmação), substituindo o upload de CSV simples que existe hoje.

**Tech Stack:** NestJS, `exceljs` (nova dependência, MIT, leitura de XLSX), `FileInterceptor` (single-file, já usado em todo o projeto), React/Next.js no frontend.

**Spec:** `docs/specs/fase-22-funcionarios-importacao-flexivel.md`

## Global Constraints

- Mapeamento de coluna é por ÍNDICE (posição no array de cabeçalhos), nunca por nome — evita ambiguidade com cabeçalhos duplicados.
- Mapeamento é 100% determinístico (dicionário de sinônimos) — nenhuma chamada de IA nesta fase.
- A validação/inserção linha-a-linha (CPF 11 dígitos, filial por nome exato, savepoint por linha, CPF duplicado) não muda — só é extraída pra um método compartilhado entre o caminho antigo (`importCsv`, intocado no comportamento) e o novo (`importMapped`).
- CPF pode vir formatado numa planilha real (`123.456.789-00`) — o novo caminho remove tudo que não é dígito antes de validar os 11 dígitos (o caminho antigo, `parseEmployeesCsv`, continua exigindo exatamente 11 dígitos crus, sem essa normalização — não muda).
- Limite de 2000 linhas e 10MB por arquivo (o limite de linhas já existe, `MAX_IMPORT_ROWS`; o limite de tamanho sobe de 5MB, do endpoint antigo, pra 10MB, já que XLSX é mais pesado que CSV pro mesmo conteúdo).
- `POST /employees/import` (endpoint antigo) não é removido nem alterado — só deixa de ser chamado pela UI.
- Números de linha reportados em erro no caminho novo são aproximados quando há linhas em branco no meio do arquivo original (simplificação deliberada — o caminho antigo preserva alinhamento exato, o novo não, documentado no código).

---

### Task 1: Utilitário de parsing (CSV+XLSX) e dicionário de sinônimos

**Files:**
- Modify: `backend/src/employees/csv-import.util.ts` (exporta `splitCsvLine`, hoje privada)
- Modify: `backend/package.json` (adiciona `exceljs`)
- Create: `backend/src/employees/spreadsheet-import.util.ts`
- Test: `backend/test/spreadsheet-import.unit-spec.ts`

**Interfaces:**
- Consumes: `splitCsvLine(line: string): string[]` e `MAX_IMPORT_ROWS` de `csv-import.util.ts` (já existem, só ganham/mantêm `export`).
- Produces: `parseSpreadsheet(buffer: Buffer, mimetype: string): Promise<SpreadsheetParseResult>` (`{ headers: string[]; rows: string[][]; formatError?: string }`), `suggestColumnMapping(headers: string[]): ColumnMapping` (`{ nome: number | null; cpf: number | null; cargo: number | null; filial: number | null }`), `applyColumnMapping(rows: string[][], mapping: ColumnMapping): MappedEmployeeRow[]` (`{ line: number; full_name: string; cpf: string; position: string; company_unit_name: string }[]`) — Task 2 consome os três.

- [ ] **Step 1: Exportar `splitCsvLine`**

Em `backend/src/employees/csv-import.util.ts`, troque a linha:
```typescript
function splitCsvLine(line: string): string[] {
```
por:
```typescript
export function splitCsvLine(line: string): string[] {
```
(Nenhuma outra mudança neste arquivo — o resto do comportamento de `parseEmployeesCsv` continua idêntico.)

- [ ] **Step 2: Adicionar `exceljs` ao `package.json`**

Em `backend/package.json`, dentro do bloco `"dependencies"`, adicione (ordem alfabética, ao lado de outras entradas com `e`):
```json
    "exceljs": "^4.4.0",
```

- [ ] **Step 3: Escrever o teste que falha**

Crie `backend/test/spreadsheet-import.unit-spec.ts`:

```typescript
import ExcelJS from 'exceljs';
import {
  applyColumnMapping,
  parseSpreadsheet,
  suggestColumnMapping,
} from '../src/employees/spreadsheet-import.util';

async function buildTestXlsx(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Funcionários');
  rows.forEach((row) => worksheet.addRow(row));
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe('spreadsheet-import.util', () => {
  describe('parseSpreadsheet — CSV', () => {
    it('extrai cabeçalho e linhas de um CSV com cabeçalho não-padrão', async () => {
      const csv = 'Nome Completo,Documento,Função,Unidade\nJoão Silva,12345678900,Eletricista,Matriz\n';
      const result = await parseSpreadsheet(Buffer.from(csv, 'utf-8'), 'text/csv');

      expect(result.formatError).toBeUndefined();
      expect(result.headers).toEqual(['Nome Completo', 'Documento', 'Função', 'Unidade']);
      expect(result.rows).toEqual([['João Silva', '12345678900', 'Eletricista', 'Matriz']]);
    });

    it('devolve formatError pra arquivo vazio', async () => {
      const result = await parseSpreadsheet(Buffer.from('', 'utf-8'), 'text/csv');
      expect(result.formatError).toBe('Arquivo vazio');
    });

    it('devolve formatError quando excede MAX_IMPORT_ROWS', async () => {
      const header = 'nome,cpf,cargo,filial\n';
      const rows = Array.from({ length: 2001 }, (_, i) => `Nome ${i},12345678900,Cargo,Matriz`).join('\n');
      const result = await parseSpreadsheet(Buffer.from(header + rows, 'utf-8'), 'text/csv');
      expect(result.formatError).toContain('2001 linhas');
    });
  });

  describe('parseSpreadsheet — XLSX', () => {
    it('extrai cabeçalho e linhas de um XLSX real', async () => {
      const buffer = await buildTestXlsx([
        ['Nome Completo', 'Documento', 'Função', 'Unidade'],
        ['Maria Souza', '98765432100', 'Técnica', 'Filial SP'],
      ]);
      const result = await parseSpreadsheet(
        buffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      expect(result.formatError).toBeUndefined();
      expect(result.headers).toEqual(['Nome Completo', 'Documento', 'Função', 'Unidade']);
      expect(result.rows).toEqual([['Maria Souza', '98765432100', 'Técnica', 'Filial SP']]);
    });
  });

  describe('parseSpreadsheet — formato não suportado', () => {
    it('devolve formatError pra mimetype desconhecido', async () => {
      const result = await parseSpreadsheet(Buffer.from('qualquer coisa'), 'application/pdf');
      expect(result.formatError).toContain('não suportado');
    });
  });

  describe('suggestColumnMapping', () => {
    it('reconhece o cabeçalho exato já usado hoje', () => {
      const mapping = suggestColumnMapping(['nome', 'cpf', 'cargo', 'filial']);
      expect(mapping).toEqual({ nome: 0, cpf: 1, cargo: 2, filial: 3 });
    });

    it('reconhece sinônimos comuns em ordem diferente', () => {
      const mapping = suggestColumnMapping(['Documento', 'Nome Completo', 'Unidade', 'Função']);
      expect(mapping).toEqual({ nome: 1, cpf: 0, cargo: 3, filial: 2 });
    });

    it('reconhece sinônimo com acento e maiúsculas', () => {
      const mapping = suggestColumnMapping(['FUNÇÃO', 'NOME COMPLETO', 'CPF', 'FILIAL']);
      expect(mapping.cargo).toBe(0);
      expect(mapping.nome).toBe(1);
    });

    it('devolve null pro campo sem cabeçalho reconhecível', () => {
      const mapping = suggestColumnMapping(['Coluna Misteriosa', 'cpf', 'cargo', 'filial']);
      expect(mapping.nome).toBeNull();
      expect(mapping.cpf).toBe(1);
    });
  });

  describe('applyColumnMapping', () => {
    it('extrai os 4 campos usando o mapeamento, removendo formatação do CPF', () => {
      const rows = [['João Silva', '123.456.789-00', 'Eletricista', 'Matriz']];
      const mapping = { nome: 0, cpf: 1, cargo: 2, filial: 3 };
      const result = applyColumnMapping(rows, mapping);

      expect(result).toEqual([
        { line: 2, full_name: 'João Silva', cpf: '12345678900', position: 'Eletricista', company_unit_name: 'Matriz' },
      ]);
    });

    it('campo com índice null vira string vazia', () => {
      const rows = [['João Silva', '12345678900']];
      const mapping = { nome: 0, cpf: 1, cargo: null, filial: null };
      const result = applyColumnMapping(rows, mapping);

      expect(result[0].position).toBe('');
      expect(result[0].company_unit_name).toBe('');
    });
  });
});
```

- [ ] **Step 4: Rodar o teste, confirmar que falha**

Crie o override temporário de desenvolvimento (necessário pra `jest`/`ts-jest`, ausentes na imagem de produção):
```yaml
services:
  backend:
    volumes:
      - ./backend:/app
      - backend_test_node_modules:/app/node_modules
    environment:
      NODE_ENV: development

volumes:
  backend_test_node_modules:
```
```bash
docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-unit.json -- spreadsheet-import"
```
Esperado: FAIL — `Cannot find module '../src/employees/spreadsheet-import.util'`.

- [ ] **Step 5: Implementar o utilitário**

Crie `backend/src/employees/spreadsheet-import.util.ts`:

```typescript
import ExcelJS from 'exceljs';
import { MAX_IMPORT_ROWS, splitCsvLine } from './csv-import.util';

export interface SpreadsheetParseResult {
  headers: string[];
  rows: string[][];
  formatError?: string;
}

export interface ColumnMapping {
  nome: number | null;
  cpf: number | null;
  cargo: number | null;
  filial: number | null;
}

export interface MappedEmployeeRow {
  line: number;
  full_name: string;
  cpf: string;
  position: string;
  company_unit_name: string;
}

const CSV_MIME_TYPES = ['text/csv', 'application/vnd.ms-excel'];
const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function parseCsvRows(content: string): string[][] {
  return content
    .split(/\r\n|\n|\r/)
    .filter((line) => line.length > 0)
    .map((line) => splitCsvLine(line));
}

async function parseXlsxRows(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];
  const rows: string[][] = [];
  worksheet.eachRow((row) => {
    const values = row.values as unknown[];
    // exceljs é 1-indexed — values[0] é sempre undefined, os valores reais
    // começam em values[1].
    rows.push(
      values.slice(1).map((cell) => (cell === null || cell === undefined ? '' : String(cell).trim())),
    );
  });
  return rows;
}

export async function parseSpreadsheet(buffer: Buffer, mimetype: string): Promise<SpreadsheetParseResult> {
  let rows: string[][];
  if (CSV_MIME_TYPES.includes(mimetype)) {
    rows = parseCsvRows(buffer.toString('utf-8'));
  } else if (mimetype === XLSX_MIME_TYPE) {
    rows = await parseXlsxRows(buffer);
  } else {
    return { headers: [], rows: [], formatError: 'Formato de arquivo não suportado — envie um .csv ou .xlsx' };
  }

  if (rows.length === 0) {
    return { headers: [], rows: [], formatError: 'Arquivo vazio' };
  }

  const [headers, ...dataRows] = rows;
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return {
      headers: [],
      rows: [],
      formatError: `Arquivo tem ${dataRows.length} linhas, o máximo permitido é ${MAX_IMPORT_ROWS}`,
    };
  }

  return { headers, rows: dataRows };
}

// Sinônimos reconhecidos, comparação case-insensitive e sem acento (ver
// normalizeHeader). "setor" entra como sinônimo aproximado de "filial" —
// se um dia existir um campo "setor" de funcionário separado, revisitar
// esta entrada (nota já registrada na spec desta fase).
const SYNONYMS: Record<keyof ColumnMapping, string[]> = {
  nome: ['nome', 'nome completo', 'funcionario', 'colaborador', 'nome do funcionario'],
  cpf: ['cpf', 'documento', 'cpf/mf', 'numero do cpf', 'n do cpf'],
  cargo: ['cargo', 'funcao', 'cargo/funcao', 'posicao'],
  filial: ['filial', 'unidade', 'local', 'unidade/filial', 'setor'],
};

function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function suggestColumnMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const mapping: ColumnMapping = { nome: null, cpf: null, cargo: null, filial: null };
  (Object.keys(SYNONYMS) as (keyof ColumnMapping)[]).forEach((field) => {
    const idx = normalized.findIndex((h) => SYNONYMS[field].includes(h));
    if (idx !== -1) mapping[field] = idx;
  });
  return mapping;
}

export function applyColumnMapping(rows: string[][], mapping: ColumnMapping): MappedEmployeeRow[] {
  return rows.map((row, i) => ({
    // +2: +1 porque `rows` já excluiu a linha de cabeçalho, +1 porque
    // linha é 1-indexada pro usuário. Aproximado se houve linha em branco
    // no meio do arquivo original (simplificação documentada na spec).
    line: i + 2,
    full_name: mapping.nome !== null ? (row[mapping.nome] ?? '') : '',
    cpf: mapping.cpf !== null ? (row[mapping.cpf] ?? '').replace(/\D/g, '') : '',
    position: mapping.cargo !== null ? (row[mapping.cargo] ?? '') : '',
    company_unit_name: mapping.filial !== null ? (row[mapping.filial] ?? '') : '',
  }));
}
```

- [ ] **Step 6: Rodar o teste, confirmar que passa**

```bash
docker compose run --rm backend sh -c "npx jest --config ./test/jest-unit.json -- spreadsheet-import"
```
Esperado: PASS, 12 testes verdes.

- [ ] **Step 7: Apagar o override e buildar**

```bash
rm -f docker-compose.override.yml
docker compose build backend
```
Esperado: build limpo.

- [ ] **Step 8: Commit**

```bash
git add backend/src/employees/csv-import.util.ts backend/src/employees/spreadsheet-import.util.ts backend/package.json backend/package-lock.json backend/test/spreadsheet-import.unit-spec.ts
git commit -m "feat: utilitário de parsing CSV+XLSX e dicionário de sinônimos pra importação de funcionários"
```

---

### Task 2: Backend — endpoints `import-preview` e `import-mapped`

**Files:**
- Modify: `backend/src/employees/employees.service.ts`
- Modify: `backend/src/employees/employees.controller.ts`
- Test: `backend/test/employees-import-flexible.e2e-spec.ts`

**Interfaces:**
- Consumes: `parseSpreadsheet`/`suggestColumnMapping`/`applyColumnMapping`/`ColumnMapping`/`MappedEmployeeRow` de `./spreadsheet-import.util` (Task 1).
- Produces: `POST /employees/import-preview` devolvendo `{ headers: string[]; suggested_mapping: ColumnMapping; sample_rows: string[][]; total_rows: number }`; `POST /employees/import-mapped` devolvendo `ImportResult` (`{ importados: number; erros: ImportRowError[] }`, já existente) — Task 3 (frontend) consome os dois.

- [ ] **Step 1: Escrever o teste e2e que falha**

Crie `backend/test/employees-import-flexible.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

async function buildTestXlsx(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Funcionários');
  rows.forEach((row) => worksheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('POST /employees/import-preview e /employees/import-mapped (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let unitName: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Import Flexivel Teste');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;

    const unitRes = await (db as any).client.query(
      `SELECT name FROM company_units WHERE tenant_id = $1 LIMIT 1`,
      [tenant.tenantId],
    );
    unitName = unitRes.rows[0].name;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('preview: XLSX com cabeçalho não-padrão devolve mapeamento sugerido correto', async () => {
    const xlsx = await buildTestXlsx([
      ['Documento', 'Nome Completo', 'Unidade', 'Função'],
      ['12345678900', 'João Silva', unitName, 'Eletricista'],
    ]);

    const res = await request(app.getHttpServer())
      .post('/employees/import-preview')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', xlsx, {
        filename: 'funcionarios.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(res.status).toBe(201);
    expect(res.body.headers).toEqual(['Documento', 'Nome Completo', 'Unidade', 'Função']);
    expect(res.body.suggested_mapping).toEqual({ nome: 1, cpf: 0, cargo: 3, filial: 2 });
    expect(res.body.sample_rows).toEqual([['12345678900', 'João Silva', unitName, 'Eletricista']]);
    expect(res.body.total_rows).toBe(1);
  });

  it('preview: sem arquivo devolve 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/employees/import-preview')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('preview: formato não suportado devolve 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/employees/import-preview')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('conteudo'), { filename: 'foto.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });

  it('mapped: importa usando o mapeamento confirmado, CPF formatado é normalizado', async () => {
    const csv = 'Documento,Nome Completo,Unidade,Função\n123.456.789-01,Maria Souza,' + unitName + ',Técnica\n';

    const res = await request(app.getHttpServer())
      .post('/employees/import-mapped')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', JSON.stringify({ nome: 1, cpf: 0, cargo: 3, filial: 2 }))
      .attach('file', Buffer.from(csv, 'utf-8'), { filename: 'funcionarios.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(res.body.importados).toBe(1);
    expect(res.body.erros).toEqual([]);

    const listRes = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.body.some((e: any) => e.cpf === '12345678901')).toBe(true);
  });

  it('mapped: linha com CPF inválido vira erro, não derruba as demais', async () => {
    const csv =
      'Documento,Nome Completo,Unidade,Função\n123,Pedro Alves,' +
      unitName +
      ',Ajudante\n98765432100,Carla Lima,' +
      unitName +
      ',Supervisora\n';

    const res = await request(app.getHttpServer())
      .post('/employees/import-mapped')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', JSON.stringify({ nome: 1, cpf: 0, cargo: 3, filial: 2 }))
      .attach('file', Buffer.from(csv, 'utf-8'), { filename: 'funcionarios.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(res.body.importados).toBe(1);
    expect(res.body.erros).toHaveLength(1);
    expect(res.body.erros[0].motivo).toContain('CPF inválido');
  });

  it('mapped: mapeamento inválido (JSON malformado) devolve 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/employees/import-mapped')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', 'não é json')
      .attach('file', Buffer.from('nome,cpf\nx,y', 'utf-8'), { filename: 'f.csv', contentType: 'text/csv' });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

```bash
docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- employees-import-flexible"
```
(Override temporário igual ao da Task 1, mas com `TEST_SUPERUSER_DATABASE_URL` também — este teste usa Postgres real:)
```yaml
services:
  backend:
    volumes:
      - ./backend:/app
      - backend_test_node_modules:/app/node_modules
    environment:
      NODE_ENV: development
      TEST_SUPERUSER_DATABASE_URL: postgres://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}

volumes:
  backend_test_node_modules:
```
Esperado: FAIL — rotas `/employees/import-preview` e `/employees/import-mapped` ainda não existem (404 em todos os casos).

- [ ] **Step 3: Extrair a lógica de validação/inserção compartilhada em `employees.service.ts`**

Em `backend/src/employees/employees.service.ts`, troque o import do topo de:
```typescript
import { parseEmployeesCsv } from './csv-import.util';
```
por:
```typescript
import { parseEmployeesCsv, ParsedCsvRow } from './csv-import.util';
import { applyColumnMapping, ColumnMapping, MappedEmployeeRow, parseSpreadsheet, suggestColumnMapping } from './spreadsheet-import.util';
```

Troque o método `importCsv` inteiro de:
```typescript
  async importCsv(client: PoolClient, tenantId: string, csvContent: string): Promise<ImportResult> {
    const { rows, formatError } = parseEmployeesCsv(csvContent);
    if (formatError) throw new BadRequestException(formatError);

    const unitsResult = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM company_units WHERE tenant_id = $1',
      [tenantId],
    );
    const unitsByName = new Map(unitsResult.rows.map((u) => [u.name, u.id]));

    const erros: ImportRowError[] = [];
    let importados = 0;

    for (const row of rows) {
      if (!row.full_name) {
        erros.push({ linha: row.line, motivo: 'Nome é obrigatório' });
        continue;
      }
      if (!/^\d{11}$/.test(row.cpf)) {
        erros.push({ linha: row.line, motivo: 'CPF inválido (precisa ter 11 dígitos)' });
        continue;
      }
      const unitId = unitsByName.get(row.company_unit_name);
      if (!unitId) {
        erros.push({ linha: row.line, motivo: `Filial "${row.company_unit_name}" não encontrada` });
        continue;
      }

      // SAVEPOINT por linha: sem isso, o primeiro erro de INSERT (ex: CPF
      // duplicado) deixa a transação inteira "aborted" no Postgres, e
      // toda linha seguinte falharia com "current transaction is
      // aborted", mesmo capturada pelo catch do lado do Node.
      await client.query('SAVEPOINT import_row');
      try {
        await client.query(
          `INSERT INTO employees (tenant_id, full_name, cpf, position, company_unit_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, row.full_name, row.cpf, row.position || null, unitId],
        );
        await client.query('RELEASE SAVEPOINT import_row');
        importados++;
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT import_row');
        const pgErr = err as { code?: string };
        if (pgErr.code === '23505') {
          erros.push({ linha: row.line, motivo: 'CPF já cadastrado nesta empresa' });
        } else {
          erros.push({ linha: row.line, motivo: 'Erro ao importar esta linha' });
        }
      }
    }

    return { importados, erros };
  }
}
```
por:
```typescript
  async importCsv(client: PoolClient, tenantId: string, csvContent: string): Promise<ImportResult> {
    const { rows, formatError } = parseEmployeesCsv(csvContent);
    if (formatError) throw new BadRequestException(formatError);
    return this.processImportRows(client, tenantId, rows);
  }

  async previewSpreadsheet(
    buffer: Buffer,
    mimetype: string,
  ): Promise<{ headers: string[]; suggested_mapping: ColumnMapping; sample_rows: string[][]; total_rows: number }> {
    const { headers, rows, formatError } = await parseSpreadsheet(buffer, mimetype);
    if (formatError) throw new BadRequestException(formatError);

    return {
      headers,
      suggested_mapping: suggestColumnMapping(headers),
      sample_rows: rows.slice(0, 5),
      total_rows: rows.length,
    };
  }

  async importMapped(
    client: PoolClient,
    tenantId: string,
    buffer: Buffer,
    mimetype: string,
    mapping: ColumnMapping,
  ): Promise<ImportResult> {
    const { rows, formatError } = await parseSpreadsheet(buffer, mimetype);
    if (formatError) throw new BadRequestException(formatError);

    const mappedRows = applyColumnMapping(rows, mapping);
    return this.processImportRows(client, tenantId, mappedRows);
  }

  // Compartilhado entre importCsv (caminho antigo, cabeçalho fixo) e
  // importMapped (Fase 22, mapeamento flexível de coluna) — os dois
  // convergem pro mesmo formato de linha (ParsedCsvRow e
  // MappedEmployeeRow têm exatamente os mesmos 5 campos) antes de chegar
  // aqui, então a validação/inserção em si nunca precisou saber de onde a
  // linha veio.
  private async processImportRows(
    client: PoolClient,
    tenantId: string,
    rows: (ParsedCsvRow | MappedEmployeeRow)[],
  ): Promise<ImportResult> {
    const unitsResult = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM company_units WHERE tenant_id = $1',
      [tenantId],
    );
    const unitsByName = new Map(unitsResult.rows.map((u) => [u.name, u.id]));

    const erros: ImportRowError[] = [];
    let importados = 0;

    for (const row of rows) {
      if (!row.full_name) {
        erros.push({ linha: row.line, motivo: 'Nome é obrigatório' });
        continue;
      }
      if (!/^\d{11}$/.test(row.cpf)) {
        erros.push({ linha: row.line, motivo: 'CPF inválido (precisa ter 11 dígitos)' });
        continue;
      }
      const unitId = unitsByName.get(row.company_unit_name);
      if (!unitId) {
        erros.push({ linha: row.line, motivo: `Filial "${row.company_unit_name}" não encontrada` });
        continue;
      }

      await client.query('SAVEPOINT import_row');
      try {
        await client.query(
          `INSERT INTO employees (tenant_id, full_name, cpf, position, company_unit_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, row.full_name, row.cpf, row.position || null, unitId],
        );
        await client.query('RELEASE SAVEPOINT import_row');
        importados++;
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT import_row');
        const pgErr = err as { code?: string };
        if (pgErr.code === '23505') {
          erros.push({ linha: row.line, motivo: 'CPF já cadastrado nesta empresa' });
        } else {
          erros.push({ linha: row.line, motivo: 'Erro ao importar esta linha' });
        }
      }
    }

    return { importados, erros };
  }
}
```

- [ ] **Step 4: Confirmar que `ParsedCsvRow` já é exportada de `csv-import.util.ts`**

Abra `backend/src/employees/csv-import.util.ts` e confirme que a interface `ParsedCsvRow` (topo do arquivo) já tem `export` — ela já tinha antes desta fase, nenhuma mudança necessária aqui, só confirmação.

- [ ] **Step 5: Adicionar os 2 endpoints no controller**

Em `backend/src/employees/employees.controller.ts`, troque o import do topo de:
```typescript
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
```
por:
```typescript
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ColumnMapping } from './spreadsheet-import.util';
```

Adicione os dois métodos novos logo depois do método `importCsv` já existente (antes do `@Get()` que já vem em seguida):

```typescript
  @Roles('empresa', 'admin')
  @Post('import-preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async previewImport(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    return this.employees.previewSpreadsheet(file.buffer, file.mimetype);
  }

  @Roles('empresa', 'admin')
  @Post('import-mapped')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  importMapped(
    @UploadedFile() file: Express.Multer.File,
    @Body('mapping') mappingRaw: string,
    @Query('tenant_id') tenantIdParam: string | undefined,
    @Req() req: any,
  ) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    let mapping: ColumnMapping;
    try {
      mapping = JSON.parse(mappingRaw);
    } catch {
      throw new BadRequestException('Mapeamento de colunas inválido');
    }
    const tenantId = req.user.role === 'admin' ? tenantIdParam : req.user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.employees.importMapped(client, tenantId, file.buffer, file.mimetype, mapping),
    );
  }
```

- [ ] **Step 6: Rodar o teste, confirmar que passa**

```bash
docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- employees-import-flexible"
```
Esperado: PASS, 6/6.

- [ ] **Step 7: Rodar a suíte `employees` já existente (regressão)**

```bash
docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- employees"
```
Esperado: PASS — `importCsv` (caminho antigo) continua funcionando idêntico depois da extração pra `processImportRows`.

- [ ] **Step 8: Apagar o override e buildar**

```bash
rm -f docker-compose.override.yml
docker compose build backend
```
Esperado: build limpo.

- [ ] **Step 9: Commit**

```bash
git add backend/src/employees/employees.service.ts backend/src/employees/employees.controller.ts backend/test/employees-import-flexible.e2e-spec.ts
git commit -m "feat: endpoints de importação flexível de funcionários (preview + mapeamento confirmado)"
```

---

### Task 3: Frontend — fluxo de 2 passos em `FuncionariosForm.tsx`

**Files:**
- Modify: `frontend/src/app/empresa/onboarding/FuncionariosForm.tsx`

**Interfaces:**
- Consumes: `POST /employees/import-preview` (Task 2) devolvendo `{ headers: string[]; suggested_mapping: ColumnMapping; sample_rows: string[][]; total_rows: number }`; `POST /employees/import-mapped` (Task 2) devolvendo `ImportResult` (já existente, mesmo shape do endpoint antigo).
- Produces: nada (última task do plano).

- [ ] **Step 1: Substituir os tipos e o estado do formulário de importação**

Em `frontend/src/app/empresa/onboarding/FuncionariosForm.tsx`, troque:
```tsx
interface ImportRowError {
  linha: number;
  motivo: string;
}

interface ImportResult {
  importados: number;
  erros: ImportRowError[];
}
```
por:
```tsx
interface ImportRowError {
  linha: number;
  motivo: string;
}

interface ImportResult {
  importados: number;
  erros: ImportRowError[];
}

interface ColumnMapping {
  nome: number | null;
  cpf: number | null;
  cargo: number | null;
  filial: number | null;
}

interface ImportPreview {
  headers: string[];
  suggested_mapping: ColumnMapping;
  sample_rows: string[][];
  total_rows: number;
}
```

Troque:
```tsx
  const [file, setFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'loading' | 'erro'>('idle');
```
por:
```tsx
  const [file, setFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'analisando' | 'importando' | 'erro'>('idle');
  const [importError, setImportError] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({ nome: null, cpf: null, cargo: null, filial: null });
```

- [ ] **Step 2: Substituir `handleImport` por `handleAnalyze` + `handleConfirmImport`**

Troque:
```tsx
  async function handleImport(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setImportStatus('loading');
    setImportResult(null);
    const token = localStorage.getItem('montese_token');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/employees/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        setImportResult(await res.json());
        setImportStatus('idle');
        onChanged();
        return;
      }
      setImportStatus('erro');
    } catch {
      setImportStatus('erro');
    }
  }
```
por:
```tsx
  async function handleAnalyze(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setImportStatus('analisando');
    setImportError('');
    setImportResult(null);
    setPreview(null);
    const token = localStorage.getItem('montese_token');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/employees/import-preview', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        const data: ImportPreview = await res.json();
        setPreview(data);
        setMapping(data.suggested_mapping);
        setImportStatus('idle');
        return;
      }
      const body = await res.json().catch(() => null);
      setImportError(body?.message ?? 'Não foi possível analisar a planilha.');
      setImportStatus('erro');
    } catch {
      setImportError('Não foi possível conectar ao servidor.');
      setImportStatus('erro');
    }
  }

  async function handleConfirmImport() {
    if (!file) return;
    setImportStatus('importando');
    setImportError('');
    const token = localStorage.getItem('montese_token');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('mapping', JSON.stringify(mapping));
    try {
      const res = await fetch('/api/employees/import-mapped', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        setImportResult(await res.json());
        setImportStatus('idle');
        setPreview(null);
        setFile(null);
        onChanged();
        return;
      }
      const body = await res.json().catch(() => null);
      setImportError(body?.message ?? 'Não foi possível importar.');
      setImportStatus('erro');
    } catch {
      setImportError('Não foi possível conectar ao servidor.');
      setImportStatus('erro');
    }
  }

  const canConfirmImport = mapping.nome !== null && mapping.cpf !== null && mapping.cargo !== null && mapping.filial !== null;
```

- [ ] **Step 3: Substituir o bloco de UI "Importar em massa"**

Troque:
```tsx
      <div className="mt-6 border-t border-brand-100 pt-6">
        <h3 className="text-sm font-bold text-brand-900">Importar em massa (CSV)</h3>
        <p className="mt-1 text-sm text-brand-700">
          Cabeçalho obrigatório: <code>nome,cpf,cargo,filial</code> — o nome da filial precisa
          bater com uma das já cadastradas acima.
        </p>
        <form onSubmit={handleImport} className="mt-3 flex flex-col gap-3">
          <FileInput file={file} onChange={setFile} accept=".csv" label="Escolher arquivo CSV" />
          {importStatus === 'erro' && (
            <p className="text-sm text-red-600">Não foi possível importar. Tente de novo.</p>
          )}
          <button
            type="submit"
            disabled={!file || importStatus === 'loading'}
            className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {importStatus === 'loading' ? 'Importando...' : 'Importar CSV'}
          </button>
        </form>
        {importResult && (
          <div className="mt-4 text-sm">
            <p className="text-green-700">{importResult.importados} funcionário(s) importado(s).</p>
            {importResult.erros.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-red-600">
                {importResult.erros.map((erro) => (
                  <li key={erro.linha}>
                    Linha {erro.linha}: {erro.motivo}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
```
por:
```tsx
      <div className="mt-6 border-t border-brand-100 pt-6">
        <h3 className="text-sm font-bold text-brand-900">Importar em massa (CSV ou XLSX)</h3>
        <p className="mt-1 text-sm text-brand-700">
          Suba a planilha do seu jeito — nós identificamos as colunas de nome/CPF/cargo/filial
          automaticamente, e você confirma antes de importar. O nome da filial precisa bater com
          uma das já cadastradas acima.
        </p>
        <form
          onSubmit={handleAnalyze}
          className="mt-3 flex flex-col gap-3"
        >
          <FileInput
            file={file}
            onChange={(f) => {
              setFile(f);
              setPreview(null);
              setImportResult(null);
              setImportError('');
            }}
            accept=".csv,.xlsx"
            label="Escolher planilha"
          />
          {importError && <p className="text-sm text-red-600">{importError}</p>}
          <button
            type="submit"
            disabled={!file || importStatus === 'analisando'}
            className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {importStatus === 'analisando' ? 'Analisando...' : 'Analisar planilha'}
          </button>
        </form>

        {preview && (
          <div className="mt-4 flex flex-col gap-3 rounded-md border border-brand-100 p-4">
            <p className="text-sm text-brand-700">{preview.total_rows} linha(s) encontrada(s). Confirme o mapeamento:</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(['nome', 'cpf', 'cargo', 'filial'] as const).map((field) => (
                <label key={field} className="flex flex-col gap-1 text-sm text-brand-900">
                  {field === 'nome' ? 'Nome' : field === 'cpf' ? 'CPF' : field === 'cargo' ? 'Cargo' : 'Filial'}
                  <select
                    value={mapping[field] ?? ''}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, [field]: e.target.value === '' ? null : Number(e.target.value) }))
                    }
                    className="rounded-md border border-brand-100 px-3 py-2"
                  >
                    <option value="">Selecione a coluna...</option>
                    {preview.headers.map((header, i) => (
                      <option key={i} value={i}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {preview.sample_rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="mt-2 w-full text-xs">
                  <thead>
                    <tr>
                      {preview.headers.map((header, i) => (
                        <th key={i} className="px-2 py-1 text-left font-bold text-brand-700">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample_rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j} className="px-2 py-1 text-brand-900">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {importError && <p className="text-sm text-red-600">{importError}</p>}
            <button
              type="button"
              onClick={handleConfirmImport}
              disabled={!canConfirmImport || importStatus === 'importando'}
              className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {importStatus === 'importando' ? 'Importando...' : 'Confirmar e importar'}
            </button>
          </div>
        )}

        {importResult && (
          <div className="mt-4 text-sm">
            <p className="text-green-700">{importResult.importados} funcionário(s) importado(s).</p>
            {importResult.erros.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-red-600">
                {importResult.erros.map((erro) => (
                  <li key={erro.linha}>
                    Linha {erro.linha}: {erro.motivo}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
```

- [ ] **Step 4: Build**

```bash
docker compose build frontend
```
Esperado: build limpo, zero erros de TypeScript/lint.

- [ ] **Step 5: Verificação manual via Playwright contra produção real**

Este projeto não tem test runner de frontend — verificação manual via Playwright contra `https://montesesst.com.br`, `/api/*` mockado via `page.route()`, sessão sintética via `localStorage`. Depois do build, recrie o container de verdade (`docker compose up -d --force-recreate frontend`) e confirme via grep dentro do container (`docker compose exec frontend sh -c "grep -rl 'Analisar planilha' /app/.next/static/chunks/"`) que o bundle novo está servido ANTES de rodar o Playwright.

Cenários a cobrir:
1. Selecionar um arquivo → botão "Analisar planilha" habilita; mock de `POST /api/employees/import-preview` devolvendo `headers`/`suggested_mapping`/`sample_rows` → tabela de revisão aparece com os 4 dropdowns pré-preenchidos conforme `suggested_mapping`, e a tabela de amostra mostra as linhas mockadas.
2. Trocar manualmente um dos dropdowns (ex: mudar "Filial" pra outra coluna) → `mapping` reflete a mudança (confirme via `POST /api/employees/import-mapped` mockado, inspecionando o campo `mapping` do FormData enviado).
3. Com um dos 4 campos do mapeamento vazio (`null`), botão "Confirmar e importar" fica desabilitado; preencher todos os 4 habilita.
4. Confirmar importação → mock de `POST /api/employees/import-mapped` devolvendo `{ importados: 2, erros: [] }` → resultado aparece na tela, e uma chamada nova a `GET /employees` (ou o que `onChanged` dispara) acontece.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/empresa/onboarding/FuncionariosForm.tsx
git commit -m "feat: fluxo de importação flexível de planilha de funcionários (mapeamento + revisão)"
```

---

## Depois da última task

- Rodar `docker compose build backend && docker compose build frontend` combinados uma última vez.
- Gerar o pacote de revisão final de toda a branch (merge-base = commit da spec, `ffda3b1`) e despachar a revisão final no modelo mais capaz disponível, seguindo `subagent-driven-development`.
- Fechar `docs/roadmap.md` com uma entrada detalhada desta fase, mesmo formato de toda fase anterior.
- Terceira e última fatia conhecida da visão de "Diagnóstico Inicial" — o "Mapa SST" (grafo empresa→cargo→funcionário→EPI→treinamento com detecção de divergência) — ainda sem spec, fica pra quando for a vez.
