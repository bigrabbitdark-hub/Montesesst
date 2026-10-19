# Tabela oficial de funcionários — Fatia 3 (ingestão determinística da planilha modelo + revisão)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir anexar a planilha modelo "Cadastro de Funcionários" (.xlsx) no setor Funcionários: o sistema lê a planilha sem IA, identifica cada pessoa **só por CPF dentro do tenant**, preenche automaticamente apenas campos vazios de funcionário já cadastrado, e manda **novos funcionários e conflitos para revisão manual**, com histórico (origens `documento` e `revisao`) e sem nunca criar, apagar, unir ou transferir de filial por conta própria.

**Architecture:** (1) parser puro da planilha (detecta o cabeçalho, mesmo na linha 8, e ignora linhas de título/observação); (2) classificador puro (`novo` / `conflito` / `invalida` / auto-aplicar campos vazios / sem mudança); (3) migration `0082` (categoria de documento + tabela `employee_document_extractions` com RLS); (4) `EmployeeIngestionService` + `POST /employees/documents` (reusa `DocumentsService.upload`; duas transações: upload e extração) + leitura das extrações; (5) `POST /employees/extractions/:id/resolve`; (6–7) botão "Anexar documento" e painel de revisão no frontend. Sem IA, sem OCR, sem PDF/DOCX nesta fatia.

**Tech Stack:** NestJS + pg, `exceljs` (já em `package.json`), Postgres com RLS, Next.js/React/Tailwind, Jest (`*.unit-spec.ts`, `*.e2e-spec.ts`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-tabela-oficial-funcionarios-design.md` (§2 modelo, §3 decisões 1, 3 e 4, §4 `employee_document_extractions`, §5 `EmployeeIngestionService` e endpoints, §6 painel de revisão). Fatias anteriores: `...-fatia-1.md` e `...-fatia-2.md` (histórico com `app.change_source`).

## Global Constraints
- Sem commit, push, reset ou alteração de histórico git: "Checkpoint" só lista o que mudou; quem commita é o proprietário. Implementadores não commitam.
- **Dados de teste 100% sintéticos.** A planilha real em `data/Cadastro Funcionários - Laudos e eSocial.xlsx` contém dados de funcionários reais: **não** usar como fixture, **não** copiar para o repositório, **não** imprimir seu conteúdo. Os testes montam planilhas em memória com `exceljs` copiando só o *layout* (título nas linhas 1–7, cabeçalho na linha 8, linha 9 vazia, dados a partir da 10, observações mescladas depois) com nomes e CPFs fictícios válidos (ex.: `52998224725`, `11144477735`, `12345678909`, `98765432100`, `11122233396`, `39053344705`).
- Migration só aditiva; **não aplicar em produção** sem autorização. Número **`0082`** (a `0080` e a `0081` são das fatias 1 e 2; produção está em `0079`). **Atenção:** este worktree não tem as migrations 0065–0079 de produção; por isso a `0082` **não pode reescrever a lista de categorias de memória** — deve ler a `CHECK` vigente e só acrescentar a categoria nova (Task 3).
- e2e **nunca** contra produção: ensaio descartável (Postgres+Redis próprios, imagem `node:20-bookworm-slim`, senhas aleatórias geradas na hora, R2 falso com `overrideProvider(R2Service)`, **sem** credencial de produção). Nunca ler/imprimir `.env` nem o `ensaio.env`. Receita: memória `reference_ensaio_descartavel_isolado`; scripts de montagem de sessões anteriores em `/tmp/claude-0/-opt-Montese/f0c08821-fcae-4b9b-aa80-910b26f3e2ad/scratchpad/{ens2,sdd-fatia2/run-e2e.sh}` (se sumiram, recriar a partir da receita). O ensaio de outra sessão (`ensaio_pg`, `ensaio_redis`) não se mexe.
- Unit backend: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json <padrão> --forceExit`. Frontend: `cd frontend && npx vitest run <arquivo>`.
- Tenant sempre do token (`req.user.tenantId`; admin informa `tenant_id`); `company_unit_id` conferido contra o tenant; permissões `empresa`/`admin`, validadas no backend.
- Identificação **somente por CPF no tenant**. Nome parecido nunca une nem cria. Nunca transfere funcionário entre filiais, nunca apaga duplicata, nunca limpa campo (célula vazia na planilha nunca apaga dado existente), nunca reativa funcionário inativo.
- **Funcionário novo vindo de documento nunca é criado direto**: vai para revisão e, ao aprovar, passa por `EmployeesService.create` (valida e respeita o limite do plano).
- **PII mínima:** itens `invalida` guardam só linha + motivo (sem nome/CPF). Itens `novo`/`conflito` guardam os valores só até a resolução; ao resolver, `candidates` é zerado. As respostas da API mostram CPF **mascarado** (`***.***.***-NN`). Logs e mensagens de erro nunca contêm CPF, nome ou conteúdo da planilha.
- Origem no histórico (Fatia 2): auto-aplicação grava `source='documento'`; resolução grava `source='revisao'` (via `set_config('app.change_source', <valor literal>, true)`; só esses literais).
- Baseline conhecido (NÃO é regressão): `r2-get-object.unit-spec` falha no HEAD; lint do frontend falha por 3 avisos antigos (`MatrizForm`, `FireSafetyEquipmentPanel`, `AdminBrand`).

## Decisões de escopo (para o proprietário confirmar; a execução segue estas)
1. **Só `.xlsx` nesta fatia.** CSV já tem o fluxo de importação existente (que não passa por revisão); PDF/DOCX/imagem exigem texto livre + IA/OCR e ficam para a Fatia 4 (spec §3.3). Qualquer outro formato em `POST /employees/documents` devolve 400 com mensagem em português.
2. **Células vazias nunca apagam dados.** Só preenchem.
3. **Campo diferente entre planilha e cadastro = conflito**, mesmo que a planilha pareça mais nova (spec §3.1: conflito sempre revisão manual). Preenchimento de campo vazio no mesmo registro é aplicado automaticamente e os campos conflitantes vão para revisão.
4. **Funcionário já cadastrado em outra filial** que a selecionada → item `conflito` com motivo `outra_filial`, sem campos aplicáveis (só "ignorar").
5. `matrícula eSocial` que colidiria com a de outra pessoa na auto-aplicação → item `invalida` (a linha inteira não é aplicada), sem derrubar o resto.
6. Resolução é **atômica** (tudo ou nada); exige decisão para todo item pendente.

## Mapa de arquivos
- Create `backend/src/employees/employee-sheet.parser.ts` (parser puro) e `backend/test/employee-sheet.parser.unit-spec.ts`
- Create `backend/src/employees/employee-ingestion.classifier.ts` (classificador puro) e `backend/test/employee-ingestion.classifier.unit-spec.ts`
- Create `backend/db/migrations/0082_employee_document_extractions.sql`
- Create `backend/src/employees/employee-ingestion.service.ts`, `backend/src/employees/dto/resolve-extraction.dto.ts`
- Modify `backend/src/employees/employees.module.ts` (importa `DocumentsModule`, provê o serviço), `employees.controller.ts` (rotas), `backend/src/documents/documents.service.ts` (`ALLOWED_CATEGORIES`)
- Create `backend/test/employee-ingestion.e2e-spec.ts`
- Create `frontend/src/lib/employees-ingestion.ts`, `frontend/src/components/AnexarDocumentoPanel.tsx`, `frontend/src/components/RevisaoExtracaoPanel.tsx`
- Modify `frontend/src/app/empresa/funcionarios/page.tsx`
- Tests: `frontend/src/lib/__tests__/employees-ingestion.test.ts`, `frontend/src/components/__tests__/AnexarDocumentoPanel.test.tsx`, `frontend/src/components/__tests__/RevisaoExtracaoPanel.test.tsx`, ajuste em `frontend/src/app/empresa/__tests__/funcionarios-page.test.tsx`

---

### Task 1: Parser puro da planilha modelo

**Files:** Create `backend/src/employees/employee-sheet.parser.ts`; Test `backend/test/employee-sheet.parser.unit-spec.ts`

**Interfaces — Produces:**
```ts
export const SHEET_FIELDS = ['full_name','esocial_registration','cpf','birth_date','sex','position','admission_date','cbo_code','activity_description'] as const;
export type SheetField = (typeof SHEET_FIELDS)[number];
export interface SheetRow { line: number; values: Partial<Record<SheetField, string>> } // line = número da linha na planilha (1-based); valores já como texto, vazios omitidos
export interface SheetParseResult { rows: SheetRow[]; ignored: number; formatError?: string }
export async function parseEmployeeSheet(buffer: Buffer): Promise<SheetParseResult>;
```

- [ ] **Step 1: Teste que falha** — `backend/test/employee-sheet.parser.unit-spec.ts` (planilha montada em memória; nada de arquivo real):
```ts
import ExcelJS from 'exceljs';
import { parseEmployeeSheet } from '../src/employees/employee-sheet.parser';

const HEADER = ['Qtde', 'Funcionário ', 'Matrícula esocial', 'CPF', 'Data de nascimento', 'Sexo F/M', 'Função/Cargo', 'Data de Admissão', 'CBO', 'Descrição da atividade'];

async function build(fill: (ws: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Plan1');
  fill(ws);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Layout do modelo: título nas linhas 1-7, cabeçalho na 8, linha 9 vazia, dados a partir da 10.
function modelSheet(ws: ExcelJS.Worksheet, dataRows: unknown[][], tail: (ws: ExcelJS.Worksheet) => void = () => {}) {
  ws.mergeCells('A1:J1');
  ws.getCell('A1').value = 'CADASTRO DE FUNCIONÁRIOS';
  ws.getCell('A3').value = 'Empresa: ';
  ws.getCell('C3').value = 'EMPRESA FICTICIA LTDA';
  ws.getRow(8).values = HEADER;
  dataRows.forEach((r, i) => (ws.getRow(10 + i).values = r as ExcelJS.CellValue[]));
  tail(ws);
}

describe('parseEmployeeSheet', () => {
  it('acha o cabeçalho na linha 8, mapeia as 9 colunas e devolve a linha real da planilha', async () => {
    const buf = await build((ws) =>
      modelSheet(ws, [
        [1, 'ANA FICTICIA', '00012345678', '529.982.247-25', new Date(Date.UTC(1990, 1, 3)), 'F', 'SOLDADORA', new Date(Date.UTC(2020, 0, 5)), 623115, 'Solda'],
        [2, 'BRUNO FICTICIO', '00012345679', '111.444.777-35', new Date(Date.UTC(1985, 10, 20)), 'M', 'ELETRICISTA', new Date(Date.UTC(2018, 5, 18)), 51210, ''],
      ]),
    );
    const res = await parseEmployeeSheet(buf);
    expect(res.formatError).toBeUndefined();
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toEqual({
      line: 10,
      values: {
        full_name: 'ANA FICTICIA', esocial_registration: '00012345678', cpf: '529.982.247-25',
        birth_date: '1990-02-03', sex: 'F', position: 'SOLDADORA', admission_date: '2020-01-05',
        cbo_code: '623115', activity_description: 'Solda',
      },
    });
    expect(res.rows[1].line).toBe(11);
    expect(res.rows[1].values.cbo_code).toBe('51210'); // número do Excel: o zero à esquerda é restaurado pelo classificador
    expect(res.rows[1].values.activity_description).toBeUndefined(); // vazio é omitido
  });

  it('ignora linhas em branco e linhas de observação mescladas (texto repetido em todas as colunas)', async () => {
    const buf = await build((ws) =>
      modelSheet(
        ws,
        [[1, 'CARLA FICTICIA', '', '123.456.789-09', '', 'F', 'AUXILIAR', '', '', '']],
        (w) => {
          w.mergeCells('A30:J30');
          w.getCell('A30').value = 'OBSERVAÇÕES: preencher todos os campos';
          w.getCell('A32').value = 'texto solto sem nome nem CPF';
        },
      ),
    );
    const res = await parseEmployeeSheet(buf);
    expect(res.rows.map((r) => r.line)).toEqual([10]);
    expect(res.ignored).toBe(2);
  });

  it('uma linha com nome mas sem CPF (ou CPF sem nome) continua sendo dado (o classificador a marca inválida)', async () => {
    const buf = await build((ws) =>
      modelSheet(ws, [
        [1, 'SEM CPF FICTICIO', '', '', '', '', '', '', '', ''],
        [2, '', '', '987.654.321-00', '', '', '', '', '', ''],
      ]),
    );
    const res = await parseEmployeeSheet(buf);
    expect(res.rows.map((r) => r.line)).toEqual([10, 11]);
  });

  it('aceita cabeçalho na linha 1 e sinônimos (Nome, Cargo, Admissão)', async () => {
    const buf = await build((ws) => {
      ws.getRow(1).values = ['Nome', 'CPF', 'Cargo', 'Admissão'];
      ws.getRow(2).values = ['DUDA FICTICIA', '12345678909', 'AUXILIAR', '05/01/2020'];
    });
    const res = await parseEmployeeSheet(buf);
    expect(res.rows).toEqual([
      { line: 2, values: { full_name: 'DUDA FICTICIA', cpf: '12345678909', position: 'AUXILIAR', admission_date: '05/01/2020' } },
    ]);
  });

  it('CPF e matrícula numéricos do Excel viram texto sem notação científica', async () => {
    const buf = await build((ws) => modelSheet(ws, [[1, 'EDU FICTICIO', 32000006, 52998224725, '', '', '', '', '', '']]));
    const res = await parseEmployeeSheet(buf);
    expect(res.rows[0].values.cpf).toBe('52998224725');
    expect(res.rows[0].values.esocial_registration).toBe('32000006');
  });

  it('sem cabeçalho reconhecível devolve formatError em português; arquivo corrompido também', async () => {
    const semCab = await build((ws) => (ws.getRow(1).values = ['a', 'b', 'c']));
    expect((await parseEmployeeSheet(semCab)).formatError).toMatch(/cabeçalho/i);
    const lixo = await parseEmployeeSheet(Buffer.from('isto não é um xlsx'));
    expect(lixo.formatError).toMatch(/ler o arquivo/i);
    expect(lixo.rows).toEqual([]);
  });

  it('respeita o limite de linhas de dados', async () => {
    const buf = await build((ws) => {
      ws.getRow(1).values = ['Nome', 'CPF'];
      for (let i = 0; i < 2001; i++) ws.getRow(2 + i).values = [`PESSOA ${i}`, '52998224725'];
    });
    expect((await parseEmployeeSheet(buf)).formatError).toMatch(/2000/);
  });
});
```
- [ ] **Step 2: Run** `jest-unit.json employee-sheet` → FAIL (módulo inexistente).
- [ ] **Step 3: Implementar** — `backend/src/employees/employee-sheet.parser.ts`:
```ts
import ExcelJS from 'exceljs';
import { verifyFileContent } from '../common/files/file-content.util';

export const SHEET_FIELDS = [
  'full_name', 'esocial_registration', 'cpf', 'birth_date', 'sex', 'position', 'admission_date', 'cbo_code', 'activity_description',
] as const;
export type SheetField = (typeof SHEET_FIELDS)[number];
export interface SheetRow { line: number; values: Partial<Record<SheetField, string>> }
export interface SheetParseResult { rows: SheetRow[]; ignored: number; formatError?: string }

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSX_MAX_BYTES = 3 * 1024 * 1024;
const MAX_DATA_ROWS = 2000;
const HEADER_SCAN_ROWS = 40;
const UNREADABLE = 'Não foi possível ler o arquivo .xlsx — verifique se não está corrompido';

const SYNONYMS: Record<SheetField, string[]> = {
  full_name: ['funcionario', 'nome', 'nome completo', 'colaborador', 'nome do funcionario'],
  esocial_registration: ['matricula esocial', 'matricula e-social', 'matricula'],
  cpf: ['cpf', 'cpf/mf'],
  birth_date: ['data de nascimento', 'data nascimento', 'nascimento'],
  sex: ['sexo f/m', 'sexo', 'sexo (f/m)'],
  position: ['funcao/cargo', 'cargo/funcao', 'cargo', 'funcao'],
  admission_date: ['data de admissao', 'data admissao', 'admissao'],
  cbo_code: ['cbo'],
  activity_description: ['descricao da atividade', 'atividade'],
};

function normalizeHeader(h: string): string {
  return h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Texto de uma célula do exceljs. Data vira AAAA-MM-DD pelas partes UTC (o exceljs entrega
// datas do Excel em UTC; nunca serializar com fuso local). Número vira texto inteiro, sem notação científica.
function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${cell.getUTCFullYear()}-${p(cell.getUTCMonth() + 1)}-${p(cell.getUTCDate())}`;
  }
  if (typeof cell === 'number') return Number.isInteger(cell) ? cell.toFixed(0) : String(cell);
  if (typeof cell === 'object') {
    const o = cell as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((x) => x.text ?? '').join('').trim();
    if ('result' in o) return cellText(o.result);
    if (typeof o.text === 'string') return o.text.trim();
    return '';
  }
  return String(cell).trim();
}

export async function parseEmployeeSheet(buffer: Buffer): Promise<SheetParseResult> {
  const fail = (formatError: string): SheetParseResult => ({ rows: [], ignored: 0, formatError });
  if (buffer.length > XLSX_MAX_BYTES) return fail(`Arquivo .xlsx muito grande (máximo ${XLSX_MAX_BYTES / (1024 * 1024)}MB)`);
  // Confere o conteúdo real (inclui o teto de descompressão contra zip bomb) antes de montar o workbook.
  if (await verifyFileContent(buffer, XLSX_MIME)) return fail(UNREADABLE);

  let ws: ExcelJS.Worksheet | undefined;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    ws = wb.worksheets[0];
  } catch {
    return fail(UNREADABLE);
  }
  if (!ws) return fail(UNREADABLE);

  const text = (r: number, c: number) => cellText(ws!.getRow(r).getCell(c).value);
  const cols = Math.max(ws.columnCount, 1);

  // 1) cabeçalho: primeira linha (até HEADER_SCAN_ROWS) em que apareçam, no mínimo, Funcionário/Nome e CPF.
  let headerRow = 0;
  const colOf: Partial<Record<SheetField, number>> = {};
  for (let r = 1; r <= Math.min(HEADER_SCAN_ROWS, ws.rowCount) && !headerRow; r++) {
    const found: Partial<Record<SheetField, number>> = {};
    for (let c = 1; c <= cols; c++) {
      const h = normalizeHeader(text(r, c));
      if (!h) continue;
      for (const f of SHEET_FIELDS) if (found[f] === undefined && SYNONYMS[f].includes(h)) found[f] = c;
    }
    if (found.full_name !== undefined && found.cpf !== undefined) {
      headerRow = r;
      Object.assign(colOf, found);
    }
  }
  if (!headerRow) return fail('Cabeçalho não reconhecido — use a planilha modelo (colunas Funcionário e CPF são obrigatórias)');

  // 2) linhas de dados
  const rows: SheetRow[] = [];
  let ignored = 0;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const cells: string[] = [];
    for (let c = 1; c <= cols; c++) cells.push(text(r, c));
    const filled = cells.filter((x) => x !== '');
    if (filled.length === 0) continue;
    // Observação mesclada: o exceljs repete o mesmo texto em todas as células da mescla.
    if (filled.length >= 2 && new Set(filled).size === 1) { ignored++; continue; }
    const values: Partial<Record<SheetField, string>> = {};
    for (const f of SHEET_FIELDS) {
      const c = colOf[f];
      const v = c === undefined ? '' : cells[c - 1];
      if (v !== '') values[f] = v;
    }
    if (values.full_name === undefined && values.cpf === undefined) { ignored++; continue; }
    rows.push({ line: r, values });
    if (rows.length > MAX_DATA_ROWS) return fail(`A planilha tem mais de ${MAX_DATA_ROWS} linhas de dados (máximo ${MAX_DATA_ROWS})`);
  }
  return { rows, ignored };
}
```
  (Se `ws.columnCount` ficar menor que a coluna do cabeçalho por causa de mescla, usar `Math.max(ws.columnCount, 10)`; conferir com o teste de cabeçalho na linha 8.)
- [ ] **Step 4: Run** → PASS; `npx tsc --noEmit -p tsconfig.json` 0 erros.
- [ ] **Step 5: Checkpoint** — listar arquivos; não commitar.

---

### Task 2: Classificador puro

**Files:** Create `backend/src/employees/employee-ingestion.classifier.ts`; Test `backend/test/employee-ingestion.classifier.unit-spec.ts`

**Interfaces — Consumes:** `SheetRow` (Task 1); `normalizeEmployeeInput`, `onlyDigits` (`employee-fields.util.ts`, Fatia 1). **Produces:**
```ts
export const COMPARABLE_FIELDS = ['full_name','esocial_registration','birth_date','sex','position','admission_date','cbo_code','activity_description'] as const;
export interface ExistingEmployee { id: string; cpf: string; company_unit_id: string | null; full_name: string; esocial_registration: string | null; birth_date: string | null; sex: string | null; position: string | null; admission_date: string | null; cbo_code: string | null; activity_description: string | null }
export interface FieldConflict { field: string; current: string; proposed: string }
export type Candidate =
  | { line: number; kind: 'novo'; values: Record<string, string> }                       // values inclui cpf e, se houver, company_unit_id
  | { line: number; kind: 'conflito'; employee_id: string; full_name: string; cpf: string; conflicts: FieldConflict[]; reason?: 'outra_filial' }
  | { line: number; kind: 'invalida'; reason: string };                                   // sem nome nem CPF (PII mínima)
export interface AutoApply { line: number; employee_id: string; values: Record<string, string> }
export interface ClassifyResult { autoApply: AutoApply[]; candidates: Candidate[]; unchanged: number }
export function classifyRows(rows: SheetRow[], existingByCpf: Map<string, ExistingEmployee>, defaultUnitId: string | null): ClassifyResult;
```

- [ ] **Step 1: Teste que falha** — `backend/test/employee-ingestion.classifier.unit-spec.ts`:
```ts
import { classifyRows, ExistingEmployee } from '../src/employees/employee-ingestion.classifier';
import { SheetRow } from '../src/employees/employee-sheet.parser';

const U1 = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const U2 = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';

const emp = (over: Partial<ExistingEmployee> = {}): ExistingEmployee => ({
  id: 'e1', cpf: '52998224725', company_unit_id: U1, full_name: 'ANA FICTICIA', esocial_registration: null,
  birth_date: null, sex: null, position: null, admission_date: null, cbo_code: null, activity_description: null, ...over,
});
const row = (line: number, values: SheetRow['values']): SheetRow => ({ line, values });
const byCpf = (...es: ExistingEmployee[]) => new Map(es.map((e) => [e.cpf, e]));

describe('classifyRows', () => {
  it('CPF desconhecido vira "novo", com filial padrão e valores normalizados (CBO com zero, data ISO, sexo maiúsculo)', () => {
    const r = classifyRows([row(10, { full_name: 'BIA FICTICIA', cpf: '111.444.777-35', cbo_code: '51210', birth_date: '03/02/1990', sex: 'f' })], new Map(), U1);
    expect(r.autoApply).toEqual([]);
    expect(r.candidates).toEqual([
      { line: 10, kind: 'novo', values: { full_name: 'BIA FICTICIA', cpf: '11144477735', cbo_code: '051210', birth_date: '1990-02-03', sex: 'F', company_unit_id: U1 } },
    ]);
  });

  it('funcionário existente: campos vazios são auto-aplicados; sem mudança conta em unchanged', () => {
    const r = classifyRows(
      [row(10, { full_name: 'ANA FICTICIA', cpf: '52998224725', position: 'SOLDADORA', sex: 'F' })],
      byCpf(emp()), U1,
    );
    expect(r.autoApply).toEqual([{ line: 10, employee_id: 'e1', values: { position: 'SOLDADORA', sex: 'F' } }]);
    expect(r.candidates).toEqual([]);
    const same = classifyRows([row(10, { full_name: 'ana ficticia', cpf: '52998224725' })], byCpf(emp()), U1);
    expect(same).toEqual({ autoApply: [], candidates: [], unchanged: 1 });
  });

  it('campo diferente e já preenchido é conflito (cadastro intacto); o vazio do mesmo registro ainda é auto-aplicado', () => {
    const r = classifyRows(
      [row(10, { full_name: 'ANA FICTICIA', cpf: '52998224725', position: 'GERENTE', sex: 'F' })],
      byCpf(emp({ position: 'SOLDADORA' })), U1,
    );
    expect(r.autoApply).toEqual([{ line: 10, employee_id: 'e1', values: { sex: 'F' } }]);
    expect(r.candidates).toEqual([
      { line: 10, kind: 'conflito', employee_id: 'e1', full_name: 'ANA FICTICIA', cpf: '52998224725', conflicts: [{ field: 'position', current: 'SOLDADORA', proposed: 'GERENTE' }] },
    ]);
  });

  it('célula vazia na planilha nunca apaga dado existente', () => {
    const r = classifyRows([row(10, { full_name: 'ANA FICTICIA', cpf: '52998224725' })], byCpf(emp({ position: 'SOLDADORA' })), U1);
    expect(r.autoApply).toEqual([]);
    expect(r.candidates).toEqual([]);
    expect(r.unchanged).toBe(1);
  });

  it('funcionário de outra filial: conflito "outra_filial", sem campos aplicáveis e sem auto-aplicar', () => {
    const r = classifyRows([row(10, { full_name: 'ANA FICTICIA', cpf: '52998224725', position: 'SOLDADORA' })], byCpf(emp({ company_unit_id: U2 })), U1);
    expect(r.autoApply).toEqual([]);
    expect(r.candidates).toEqual([
      { line: 10, kind: 'conflito', employee_id: 'e1', full_name: 'ANA FICTICIA', cpf: '52998224725', conflicts: [], reason: 'outra_filial' },
    ]);
  });

  it('CPF inválido, ausente ou campo inválido viram "invalida" sem nome nem CPF; CPF numérico sem zero é restaurado', () => {
    const r = classifyRows(
      [
        row(10, { full_name: 'X FICTICIO', cpf: '12345678900' }),
        row(11, { full_name: 'SEM CPF FICTICIO' }),
        row(12, { cpf: '987.654.321-00' }),
        row(13, { full_name: 'CBO RUIM FICTICIO', cpf: '52998224725', cbo_code: '12' }),
      ],
      new Map(), U1,
    );
    const inv = r.candidates.filter((c) => c.kind === 'invalida');
    expect(inv.map((c) => c.line)).toEqual([10, 11, 12, 13]);
    for (const c of inv) expect(JSON.stringify(c)).not.toMatch(/FICTICIO|\d{9}/);
  });

  it('CPF numérico do Excel sem o(s) zero(s) à esquerda é restaurado (CPFs sintéticos válidos 01000000028 e 00100000037)', () => {
    const r = classifyRows(
      [row(10, { full_name: 'ZERO UM FICTICIO', cpf: '1000000028' }), row(11, { full_name: 'ZERO DOIS FICTICIO', cpf: '100000037' })],
      new Map(), U1,
    );
    expect(r.candidates.map((c) => (c.kind === 'novo' ? c.values.cpf : 'x'))).toEqual(['01000000028', '00100000037']);
  });

  it('CPF repetido na planilha invalida todas as ocorrências', () => {
    const r = classifyRows(
      [row(10, { full_name: 'A FICTICIO', cpf: '529.982.247-25' }), row(11, { full_name: 'B FICTICIO', cpf: '52998224725' })],
      new Map(), U1,
    );
    expect(r.candidates.map((c) => [c.line, c.kind])).toEqual([[10, 'invalida'], [11, 'invalida']]);
  });
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar** — `employee-ingestion.classifier.ts`:
```ts
import { normalizeEmployeeInput, onlyDigits } from './employee-fields.util';
import { SheetRow } from './employee-sheet.parser';

export const COMPARABLE_FIELDS = [
  'full_name', 'esocial_registration', 'birth_date', 'sex', 'position', 'admission_date', 'cbo_code', 'activity_description',
] as const;
const TEXT_FIELDS = new Set(['full_name', 'position', 'activity_description']);

export interface ExistingEmployee {
  id: string; cpf: string; company_unit_id: string | null; full_name: string;
  esocial_registration: string | null; birth_date: string | null; sex: string | null; position: string | null;
  admission_date: string | null; cbo_code: string | null; activity_description: string | null;
}
export interface FieldConflict { field: string; current: string; proposed: string }
export type Candidate =
  | { line: number; kind: 'novo'; values: Record<string, string> }
  | { line: number; kind: 'conflito'; employee_id: string; full_name: string; cpf: string; conflicts: FieldConflict[]; reason?: 'outra_filial' }
  | { line: number; kind: 'invalida'; reason: string };
export interface AutoApply { line: number; employee_id: string; values: Record<string, string> }
export interface ClassifyResult { autoApply: AutoApply[]; candidates: Candidate[]; unchanged: number }

// O Excel entrega CPF numérico sem o zero à esquerda; restaura só quando não há pontuação e faltam 1–2 dígitos.
function restoreCpf(raw: string | undefined): string {
  const v = raw ?? '';
  const d = onlyDigits(v);
  return /^\d+$/.test(v.trim()) && d.length >= 9 && d.length < 11 ? d.padStart(11, '0') : v;
}

const same = (field: string, a: string, b: string) =>
  TEXT_FIELDS.has(field) ? a.trim().toLowerCase() === b.trim().toLowerCase() : a === b;

export function classifyRows(rows: SheetRow[], existingByCpf: Map<string, ExistingEmployee>, defaultUnitId: string | null): ClassifyResult {
  const result: ClassifyResult = { autoApply: [], candidates: [], unchanged: 0 };
  const valid: { line: number; values: Record<string, string> }[] = [];

  for (const r of rows) {
    const { values, errors } = normalizeEmployeeInput({ ...r.values, cpf: restoreCpf(r.values.cpf) });
    if (Object.keys(errors).length > 0 || typeof values.cpf !== 'string' || typeof values.full_name !== 'string') {
      result.candidates.push({ line: r.line, kind: 'invalida', reason: 'Dados inválidos ou ausentes (confira nome, CPF e os demais campos)' });
      continue;
    }
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) if (typeof v === 'string' && v !== '') clean[k] = v;
    valid.push({ line: r.line, values: clean });
  }

  const count = new Map<string, number>();
  for (const v of valid) count.set(v.values.cpf, (count.get(v.values.cpf) ?? 0) + 1);

  for (const v of valid) {
    if ((count.get(v.values.cpf) ?? 0) > 1) {
      result.candidates.push({ line: v.line, kind: 'invalida', reason: 'CPF repetido na planilha' });
      continue;
    }
    const existing = existingByCpf.get(v.values.cpf);
    if (!existing) {
      result.candidates.push({ line: v.line, kind: 'novo', values: { ...v.values, ...(defaultUnitId ? { company_unit_id: defaultUnitId } : {}) } });
      continue;
    }
    if (existing.company_unit_id && defaultUnitId && existing.company_unit_id !== defaultUnitId) {
      result.candidates.push({
        line: v.line, kind: 'conflito', employee_id: existing.id, full_name: existing.full_name, cpf: existing.cpf, conflicts: [], reason: 'outra_filial',
      });
      continue;
    }
    const fills: Record<string, string> = {};
    const conflicts: FieldConflict[] = [];
    for (const f of COMPARABLE_FIELDS) {
      const proposed = v.values[f];
      if (proposed === undefined) continue; // célula vazia nunca apaga
      const current = existing[f];
      if (current === null || current === '') fills[f] = proposed;
      else if (!same(f, current, proposed)) conflicts.push({ field: f, current, proposed });
    }
    if (Object.keys(fills).length > 0) result.autoApply.push({ line: v.line, employee_id: existing.id, values: fills });
    if (conflicts.length > 0) {
      result.candidates.push({ line: v.line, kind: 'conflito', employee_id: existing.id, full_name: existing.full_name, cpf: existing.cpf, conflicts });
    }
    if (Object.keys(fills).length === 0 && conflicts.length === 0) result.unchanged++;
  }
  result.candidates.sort((a, b) => a.line - b.line);
  return result;
}
```
- [ ] **Step 4: Run** → PASS; `tsc` 0 erros.
- [ ] **Step 5: Checkpoint.**

---

### Task 3: Migration `0082` (categoria de documento + extrações)

**Files:** Create `backend/db/migrations/0082_employee_document_extractions.sql`; Modify `backend/src/documents/documents.service.ts` (`ALLOWED_CATEGORIES`); Test: `backend/test/employee-ingestion.e2e-spec.ts` (criado aqui)

**Interfaces — Produces:** categoria `documents.category = 'cadastro_funcionarios'` (NÃO exposta pelo `CreateDocumentDto` do endpoint genérico); tabela `employee_document_extractions(id, tenant_id, document_id, content_hash, status, summary JSONB, candidates JSONB, created_by, created_at, resolved_by, resolved_at)`.

- [ ] **Step 1: Teste que falha** — criar o spec com o setup padrão (copiar o `beforeAll`/`login`/`sql` do `employee-history.e2e-spec.ts`, incluindo `overrideProvider(R2Service).useValue({ putObject: jest.fn(), deleteObject: jest.fn(), getObject: jest.fn() })` — **obrigatório**: sem isso o upload gravaria no bucket real) e este primeiro teste:
```ts
it('a CHECK de documents.category ganha cadastro_funcionarios sem perder nenhuma categoria existente', async () => {
  const def = (await sql(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'documents_category_check' AND conrelid = 'documents'::regclass`)).rows[0].d as string;
  for (const c of ['pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento', 'cipa_ata', 'cipa_comunicado', 'cipa_documento_eleitoral', 'cipa_anexo', 'ltcat', 'lip', 'relatorio_visita', 'cadastro_funcionarios']) {
    expect(def).toContain(`'${c}'`);
  }
});

it('employee_document_extractions: RLS+FORCE, só INSERT/SELECT/UPDATE para a role da aplicação (sem DELETE), único por (tenant, documento, hash)', async () => {
  const t = (await sql(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'employee_document_extractions'`)).rows[0];
  expect(t).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  const priv = (await sql(`SELECT has_table_privilege('montese_app', 'employee_document_extractions', 'DELETE') AS del, has_table_privilege('montese_app', 'employee_document_extractions', 'UPDATE') AS upd`)).rows[0];
  expect(priv).toEqual({ del: false, upd: true });
});
```
- [ ] **Step 2: Run** (ensaio sem a migration) → FAIL.
- [ ] **Step 3: Criar a migration** — `0082_employee_document_extractions.sql`:
```sql
-- 1) Categoria nova de documento. A CHECK vigente é LIDA e só ganha o valor novo: produção tem migrations
--    (0065–0079) que mexem em categorias e que este arquivo não conhece; reescrever a lista de memória
--    poderia bloquear categorias existentes. Se o formato da CHECK não for o esperado, a migration aborta
--    inteira (nada é alterado).
DO $$
DECLARE
  def TEXT;
  new_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conname = 'documents_category_check' AND conrelid = 'documents'::regclass;
  IF def IS NULL THEN
    RAISE EXCEPTION 'documents_category_check não encontrada';
  END IF;
  IF def LIKE '%''cadastro_funcionarios''%' THEN
    RETURN;
  END IF;
  IF def !~ 'ARRAY\[.*\]' THEN
    RAISE EXCEPTION 'formato inesperado da CHECK de categorias: %', def;
  END IF;
  new_def := regexp_replace(def, '(ARRAY\[.*)\]', '\1, ''cadastro_funcionarios''::text]');
  EXECUTE format('ALTER TABLE documents DROP CONSTRAINT documents_category_check, ADD CONSTRAINT documents_category_check %s', new_def);
END $$;

-- 2) Extrações de documentos cadastrais (spec §4). Valores brutos de novos/conflitos ficam em `candidates`
--    só até a resolução; itens inválidos guardam apenas linha e motivo.
CREATE TABLE employee_document_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processando', 'aplicado', 'requer_revisao', 'sem_dados', 'ilegivel', 'erro')),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  UNIQUE (tenant_id, document_id, content_hash)
);

CREATE INDEX employee_document_extractions_tenant_status_idx
  ON employee_document_extractions (tenant_id, status, created_at DESC);

ALTER TABLE employee_document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_document_extractions FORCE ROW LEVEL SECURITY;

-- Só empresa dona e admin enxergam/alteram; técnico e parceiro não.
CREATE POLICY employee_document_extractions_access ON employee_document_extractions
  USING (
    current_setting('app.role', true) = 'admin'
    OR (
      current_setting('app.role', true) = 'empresa'
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.role', true) = 'admin'
    OR (
      current_setting('app.role', true) = 'empresa'
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  );

-- Sem DELETE para a aplicação (rastreabilidade); some junto com o documento/tenant por cascata.
REVOKE DELETE, TRUNCATE ON employee_document_extractions FROM montese_app;
```
  e em `documents.service.ts` acrescentar `'cadastro_funcionarios'` ao array `ALLOWED_CATEGORIES` (o `CreateDocumentDto` **não** muda: o upload genérico continua sem aceitar a categoria).
- [ ] **Step 4: Run** no ensaio recriado com as migrations do worktree → PASS; regressão `documents employees tenant-isolation-sweep rls-isolation` → sem falhas; `tsc` 0 erros.
- [ ] **Step 5:** `grep -rn "relatorio_visita" frontend/src` e conferir como a UI de Documentos trata categorias: o item novo **não** pode quebrar a listagem (rótulo desconhecido). Registrar o que existir no relatório; só corrigir se quebrar (nesse caso, mapa de rótulo com "Cadastro de funcionários").
- [ ] **Step 6: Checkpoint.**

---

### Task 4: Serviço de ingestão, upload e leitura das extrações

**Files:** Create `backend/src/employees/employee-ingestion.service.ts`; Modify `employees.module.ts`, `employees.controller.ts`; Test: `backend/test/employee-ingestion.e2e-spec.ts`

**Interfaces — Consumes:** `parseEmployeeSheet` (T1), `classifyRows` (T2), `DocumentsService.upload` (`UploadData`: tenantId, category, title, file{buffer,mimetype,originalname,size}, uploadedByUserId, uploadedByRole, companyUnitId), `EmployeesService.update(client, id, data, callerRole)`. **Produces:**
```ts
export type ExtractionStatus = 'processando' | 'aplicado' | 'requer_revisao' | 'sem_dados' | 'ilegivel' | 'erro';
export interface PublicItem { line: number; kind: 'novo' | 'conflito' | 'invalida'; full_name?: string; cpf_masked?: string; conflicts?: FieldConflict[]; reason?: string }
export interface ExtractionPublic {
  id: string; document_id: string; status: ExtractionStatus;
  summary: { applied: number; unchanged: number; novo: number; conflito: number; invalida: number; ignored_rows: number; resolved?: { aplicados: number; ignorados: number } };
  items: PublicItem[]; created_at: string; resolved_at: string | null;
}
class EmployeeIngestionService {
  extract(client, p: { tenantId: string; documentId: string; buffer: Buffer; companyUnitId: string | null; actorUserId: string; actorRole: string }): Promise<ExtractionPublic>;
  get(client, id: string): Promise<ExtractionPublic>;           // 404 se não existe/outro tenant
  listPending(client): Promise<ExtractionPublic[]>;             // status = requer_revisao, mais novas primeiro
}
```
Rotas (`@Roles('empresa','admin')`): `POST /employees/documents` (multipart `file`, campos opcionais `company_unit_id` e, para admin, `tenant_id` → 201 `ExtractionPublic`), `GET /employees/extractions?status=requer_revisao` → `{ items: ExtractionPublic[] }`, `GET /employees/extractions/:id`. Declarar `extractions` e `documents` **antes** de `@Get(':id')`/`@Patch(':id')`.

- [ ] **Step 1: Testes que falham** — no `employee-ingestion.e2e-spec.ts` (helper `xlsx(rows)` monta a planilha em memória como no teste do parser; CPFs/nomes fictícios; filial criada via `POST /company-units` como nos specs anteriores):
  1. **upload cria revisão e não cria funcionário:** planilha com 2 CPFs desconhecidos → `201`, `status='requer_revisao'`, `summary.novo=2`, `items` com `full_name` e `cpf_masked` (`***.***.***-25`), **nenhum CPF completo** em `JSON.stringify(res.body)`; `SELECT count(*) FROM employees WHERE tenant_id=…` não mudou; existe 1 `documents` com `category='cadastro_funcionarios'`.
  2. **auto-aplica só vazios, com histórico:** funcionário existente (criado por `POST /employees`) com `position='SOLDADORA'` e sem sexo; planilha traz `position='GERENTE'`, `sex='F'` → `sex` preenchido, `position` intacto; `summary.applied=1`, `conflito=1`; histórico do campo `sex` com `source='documento'`; `position` sem linha nova.
  3. **idempotência e igualdade:** reenviar a mesma planilha → nada muda (`unchanged`), nenhuma linha nova de histórico para os campos já iguais.
  4. **outra filial:** funcionário da filial A, planilha enviada com `company_unit_id` da filial B → item `conflito` com `reason='outra_filial'`, `company_unit_id` do funcionário inalterado.
  5. **inválidas sem PII persistida:** linha com CPF inválido e nome fictício `NOME SECRETO FICTICIO` → `invalida`; `SELECT candidates::text FROM employee_document_extractions` não contém `SECRETO` nem o CPF.
  6. **colisão de matrícula na auto-aplicação:** planilha preenche `esocial_registration` de A com a matrícula já usada por B → linha de A vira `invalida` e a de outro funcionário na mesma planilha é aplicada normalmente.
  7. **formato e permissões:** PDF (mimetype `application/pdf`) → 400 com mensagem sobre enviar `.xlsx`; bytes aleatórios com mimetype xlsx → 400; técnico → 403; sem arquivo → 400; `GET /employees/extractions/:id` do tenant B para extração do A → 404; `GET /employees/extractions?status=requer_revisao` lista só as do próprio tenant; planilha sem cabeçalho → `status='ilegivel'` (201) com `summary` zerado.
- [ ] **Step 2: Run** → FAIL (rotas inexistentes).
- [ ] **Step 3: Implementar o serviço** — `employee-ingestion.service.ts`. Pontos obrigatórios (escrever o código completo seguindo o padrão do `EmployeesService`):
  - `hash = sha256(buffer).hex` (`crypto.createHash`).
  - `SELECT * FROM employee_document_extractions WHERE tenant_id=$1 AND document_id=$2 AND content_hash=$3` → se existir, devolve `toPublic(row)` sem reprocessar. Senão `INSERT ... status='processando'`.
  - `parseEmployeeSheet(buffer)`: `formatError` → `status='ilegivel'`, `summary` zerado, retorna; `rows.length===0` → `'sem_dados'`.
  - Carrega existentes: `SELECT id, cpf, company_unit_id, full_name, esocial_registration, sex, position, cbo_code, activity_description, to_char(birth_date,'YYYY-MM-DD') AS birth_date, to_char(admission_date,'YYYY-MM-DD') AS admission_date FROM employees WHERE tenant_id=$1 AND cpf = ANY($2)` (CPFs já normalizados — normalizar as linhas antes de montar a lista, reutilizando a lógica do classificador; exportar um helper `normalizedCpfs(rows)` do classificador se necessário). Monta `Map` por CPF.
  - `await client.query("SELECT set_config('app.change_source','documento',true)")`, depois `classifyRows(rows, map, companyUnitId)`.
  - Para cada `autoApply`: `SAVEPOINT ing_row` → `this.employees.update(client, employee_id, values, actorRole)` → `RELEASE`. Em `HttpException` (ex.: 409 de matrícula) → `ROLLBACK TO SAVEPOINT` e acrescentar `{ line, kind:'invalida', reason: <mensagem do erro> }` aos candidatos (a linha inteira não é aplicada; mensagem sem dados pessoais). Contar `applied` só os bem-sucedidos.
  - `candidates` persistidos: `novo` e `conflito` com seus valores; `invalida` só `{line, kind, reason}`. `summary = { applied, unchanged, novo, conflito, invalida, ignored_rows: parsed.ignored }`.
  - `status`: há `novo` ou `conflito` → `'requer_revisao'`; senão `'aplicado'` (com `candidates` contendo só as inválidas).
  - `toPublic`: converte `novo` → `{line, kind, full_name: values.full_name, cpf_masked}` e `conflito` → `{line, kind, full_name, cpf_masked, conflicts, reason}`; `invalida` → `{line, kind, reason}`. Máscara: `'***.***.***-' + cpf.slice(-2)`. **Nunca** devolver `cpf` inteiro nem `values` completos.
  - `get`: `SELECT ... WHERE id=$1` (RLS isola); 404 `NotFoundException('Extração não encontrada')` se vazio; validar UUID (400). `listPending`: `WHERE status='requer_revisao' ORDER BY created_at DESC LIMIT 20`.
- [ ] **Step 4: Implementar controller e módulo.** `employees.module.ts`: `imports: [PaymentsModule, DocumentsModule]`, `providers: [EmployeesService, EmployeeIngestionService]`. Controller: injeta `EmployeeIngestionService` e `DocumentsService`; rota `@Post('documents')` com `FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } })`:
  - `tenantId = user.role === 'admin' ? body.tenant_id : user.tenantId` (400 se faltar); `company_unit_id` opcional (validar UUID; `DocumentsService.upload` já confere a filial contra o tenant);
  - rejeitar com 400 se `file.mimetype !== XLSX_MIME` ("Nesta versão, anexe a planilha modelo (.xlsx). PDF e imagens chegam na próxima etapa.");
  - **transação 1:** `req.withTenantContext(c => this.documents.upload(c, { tenantId, category:'cadastro_funcionarios', title: <nome do arquivo sem extensão, máx. 200>, file:{...}, uploadedByUserId: user.id, uploadedByRole: user.role === 'admin' ? 'empresa' : user.role, companyUnitId }))` — o `uploadedByRole` do `UploadData` não aceita `admin`; conferir como o `DocumentsController` trata admin e seguir o mesmo critério (se o admin não puder subir documento, restringir a rota a `@Roles('empresa')` e registrar a decisão);
  - **transação 2:** `req.withTenantContext(c => this.ingestion.extract(c, {...}))`. Falha inesperada na 2ª transação: logar só o `documentId` e a mensagem de erro (sem conteúdo) e relançar.
  - rotas `GET extractions` (query `status` aceita só `requer_revisao`; outro valor → 400) e `GET extractions/:id`.
  - `ValidationPipe` global usa `forbidNonWhitelisted`: campos multipart não declarados em DTO podem dar 400 — seguir como `POST /employees/import` faz com `company_unit_id` (ler o controller antes e imitar).
- [ ] **Step 5: Run** o e2e no ensaio (`employee-ingestion employees employee-history tenant-isolation-sweep rls-isolation documents`) → PASS; `tsc` 0 erros; unit completo → só o baseline.
- [ ] **Step 6: Checkpoint.**

---

### Task 5: Resolver a revisão

**Files:** Modify `employee-ingestion.service.ts`, `employees.controller.ts`; Create `backend/src/employees/dto/resolve-extraction.dto.ts`; Test: `employee-ingestion.e2e-spec.ts`

**Interfaces — Produces:** `POST /employees/extractions/:id/resolve` com corpo
```ts
{ decisions: { line: number; action: 'aplicar' | 'ignorar'; fields?: string[] }[] }   // fields: só para conflito+aplicar
```
→ `200 ExtractionPublic` (`status='aplicado'`, `summary.resolved = { aplicados, ignorados }`, `items` só as inválidas). Erros: 400 (decisão faltando/sobrando, campo que não está no conflito, `fields` em item `novo`), 403 (limite do plano — vem do `create`), 404, 409 (extração já resolvida; ou dado mudou desde a extração).
```ts
async resolve(client, id: string, decisions: ResolveDecision[], actor: { userId: string; role: string }): Promise<ExtractionPublic>
```

- [ ] **Step 1: Testes que falham:**
  1. **aprovar novos cria via `create` e grava histórico `revisao`:** planilha com 2 novos → resolve `aplicar` num e `ignorar` noutro → 1 funcionário criado (com a filial selecionada e todos os campos da planilha), histórico `source='revisao'`; `status='aplicado'`; `SELECT candidates FROM employee_document_extractions` é `[]` ou só inválidas, **sem** nome/CPF (`::text` não contém o nome fictício).
  2. **conflito aplica só os campos escolhidos:** dois campos conflitantes, `fields:['position']` → só `position` muda (histórico `revisao`), o outro permanece.
  3. **decisões incompletas/estranhas:** faltou um item → 400 e nada muda; `line` inexistente → 400; `fields` com campo fora do conflito → 400; `fields` em item `novo` → 400; `ignorar` com `fields` → 400.
  4. **dado mudou desde a extração:** após o upload, `PATCH /employees/:id` altera o campo conflitante; resolver `aplicar` → 409 e nada aplicado (atomicidade: um item OK + um obsoleto ⇒ nenhum aplicado).
  5. **limite do plano:** tenant no limite de funcionários + resolver `aplicar` num novo → 403 com mensagem do limite, nada criado, extração continua `requer_revisao`.
  6. **ressolver duas vezes:** segunda chamada → 409. **Isolamento/permissão:** tenant B → 404; técnico → 403; `outra_filial` + `aplicar` → 400 (só `ignorar`).
  7. **concorrência:** duas resoluções simultâneas da mesma extração → exatamente uma 200 e outra 409 (a linha é lida `FOR UPDATE`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar** — dentro do `resolve`: `SELECT * FROM employee_document_extractions WHERE id=$1 FOR UPDATE` (404 se vazio; 409 se `status!=='requer_revisao'`); `pending = candidates.filter(kind in novo|conflito)`; validar que o conjunto de `line` das decisões é exatamente o de `pending` (sem repetição); `set_config('app.change_source','revisao',true)`; para cada decisão:
  - `ignorar` → só conta;
  - `novo` + `aplicar` → `this.employees.create(client, tenantId, { ...values, ... }, actor.role)` (valores já normalizados; `company_unit_id` do item);
  - `conflito` + `aplicar` → `reason==='outra_filial'` ⇒ 400; `fields` obrigatório e não vazio, subconjunto dos campos do conflito; ler o funcionário (`SELECT` dos mesmos campos, com `to_char` nas datas) e comparar o valor atual de cada campo escolhido com `conflict.current` (diferente ⇒ `ConflictException('Os dados do funcionário mudaram desde a análise. Reenvie a planilha.')`, sem citar valores); aplicar com `this.employees.update(client, employee_id, {campo: proposed...}, actor.role)`.
  Ao final: `UPDATE ... SET status='aplicado', candidates = <só as inválidas>, summary = summary || jsonb_build_object('resolved', jsonb_build_object('aplicados', $a, 'ignorados', $i)), resolved_by=$u, resolved_at=now()`. Tudo na mesma transação (qualquer exceção desfaz tudo). `ResolveExtractionDto` com `class-validator` (`@IsArray() @ArrayMaxSize(2000) @ValidateNested`, `line` inteiro ≥ 1, `action` em `['aplicar','ignorar']`, `fields` opcional array de strings), mensagens em português.
- [ ] **Step 4: Run** → PASS; regressão completa do e2e de employees/histórico/isolamento; `tsc` 0 erros.
- [ ] **Step 5: Checkpoint.**

---

### Task 6: Frontend — lib e botão "Anexar documento"

**Files:** Create `frontend/src/lib/employees-ingestion.ts`, `frontend/src/components/AnexarDocumentoPanel.tsx`; Test: `frontend/src/lib/__tests__/employees-ingestion.test.ts`, `frontend/src/components/__tests__/AnexarDocumentoPanel.test.tsx`

**Interfaces — Produces:**
```ts
export interface FieldConflict { field: string; current: string; proposed: string }
export interface ExtractionItem { line: number; kind: 'novo' | 'conflito' | 'invalida'; full_name?: string; cpf_masked?: string; conflicts?: FieldConflict[]; reason?: string }
export interface Extraction { id: string; document_id: string; status: 'processando'|'aplicado'|'requer_revisao'|'sem_dados'|'ilegivel'|'erro'; summary: { applied: number; unchanged: number; novo: number; conflito: number; invalida: number; ignored_rows: number; resolved?: { aplicados: number; ignorados: number } }; items: ExtractionItem[]; created_at: string; resolved_at: string | null }
export const FIELD_LABELS: Record<string, string>;     // mesmos rótulos de employees-history.ts (reusar/importar de lá, sem duplicar)
export function statusMessage(e: Extraction): string;   // frase em português para o resultado (ver testes)
export function reasonLabel(reason?: string): string;   // 'outra_filial' → "Já cadastrado em outra filial"
// <AnexarDocumentoPanel units={UnitOption[]} defaultUnitId? disabled? onDone={(e: Extraction) => void} />
```

- [ ] **Step 1: Testes que falham** — lib: `statusMessage` para cada status (`aplicado` com `applied=3, unchanged=1` → "3 funcionários atualizados, 1 sem mudança."; `requer_revisao` → "Há N itens para revisar."; `sem_dados` → "Nenhum funcionário encontrado na planilha."; `ilegivel` → "Não foi possível ler a planilha. Use o modelo oficial (.xlsx)."; `erro` → mensagem genérica) e `reasonLabel`. Componente (molde de `FuncionarioHistoricoDrawer.test.tsx`: `resp()`, `vi.stubGlobal('fetch')`): (a) o botão "Anexar documento" abre o painel; (b) `input type=file` aceita só `.xlsx`; escolher um `.pdf` mostra erro "Anexe a planilha modelo (.xlsx)" sem chamar `fetch`; (c) enviar `.xlsx` faz `POST /api/employees/documents` com `FormData` contendo `file` e `company_unit_id` (se escolhida) e `Authorization`, mostra "Enviando e analisando..." (`role="status"`), e ao responder chama `onDone` com a extração e exibe `statusMessage`; (d) erro 400 do backend aparece em `role="alert"` com a mensagem; (e) com `disabled`, o botão fica desabilitado.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar** — componente `'use client'` seguindo as classes `dash-*` de `NovoFuncionarioForm.tsx`; select de filial com as `units` (padrão `defaultUnitId` ou vazio = "Sem filial definida"); texto de ajuda: "Use a planilha modelo (.xlsx). Funcionários novos e diferenças vão para revisão antes de qualquer mudança."; botões "Enviar e analisar" e "Fechar"; `fetch` sem `Content-Type` manual (o navegador define o boundary).
- [ ] **Step 4: Run** → PASS; `tsc --noEmit` 0 erros.
- [ ] **Step 5: Checkpoint.**

---

### Task 7: Frontend — painel de revisão e integração na página

**Files:** Create `frontend/src/components/RevisaoExtracaoPanel.tsx`; Modify `frontend/src/app/empresa/funcionarios/page.tsx`; Test: `frontend/src/components/__tests__/RevisaoExtracaoPanel.test.tsx`, ajuste em `frontend/src/app/empresa/__tests__/funcionarios-page.test.tsx`

**Interfaces — Consumes:** `Extraction`, `ExtractionItem`, `FIELD_LABELS` (Task 6); `POST /api/employees/extractions/:id/resolve`; `GET /api/employees/extractions?status=requer_revisao`. **Produces:** `<RevisaoExtracaoPanel extraction={Extraction} onResolved={(e: Extraction) => void} onCancel={() => void} />`.

- [ ] **Step 1: Testes que falham** — painel: (a) agrupa por seção "Novos funcionários", "Diferenças com o cadastro" e "Linhas com problema" (somente leitura, com o motivo); (b) cada novo tem checkbox "Cadastrar" (marcado por padrão **não**: o proprietário decide; começam desmarcados); cada campo conflitante tem checkbox "Usar o valor da planilha" mostrando "atual → planilha" (separados em elementos próprios) e começam desmarcados; item `outra_filial` mostra o aviso e nenhuma opção; (c) "Confirmar decisões" envia `POST .../resolve` com `decisions` para **todos** os itens pendentes (`aplicar` com `fields` marcados, ou `ignorar`) — e fica desabilitado enquanto envia; sucesso chama `onResolved` e mostra "N aplicados, M ignorados."; (d) erros 403/409/400 do backend aparecem em `role="alert"` sem fechar o painel e sem perder as marcações; (e) "Descartar tudo" pede confirmação ("Nada será alterado no cadastro.") e envia tudo como `ignorar`; (f) foco/ARIA: região rotulada "Revisão da planilha enviada", `aria-live` no resumo, CPF só mascarado na tela. Página: ao montar, `GET /api/employees/extractions?status=requer_revisao`; se houver, mostra o painel da mais recente acima da tabela; `AnexarDocumentoPanel` ao lado de `NovoFuncionarioForm`, desabilitado enquanto a tabela está em edição (`tableEditing`) ou há revisão aberta; ao concluir (`onDone`/`onResolved`), `setRefreshKey` recarrega a tabela e, se `requer_revisao`, abre o painel de revisão.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar** os componentes e a integração (classes `dash-*`, seções com `<h3>`, listas `<ul>`, checkboxes com `<label>` visível, sem elemento sem função). Estado das decisões em `useState<Record<line, { aplicar: boolean; fields: string[] }>>`.
- [ ] **Step 4: Run** `npx vitest run src/components src/lib src/app/empresa` → sem falhas; `npx tsc --noEmit` 0 erros; `npm run lint` → só os 3 avisos antigos.
- [ ] **Step 5: Conferência visual** — `next dev` do worktree em porta livre, API interceptada no Playwright com sessão `empresa` **falsa** só no `localStorage` (JWT sem assinatura com `exp` futuro + `montese_user`; receita das fatias anteriores), dados fictícios; capturar o painel de envio e o painel de revisão em 1440 px e 390 px; checar `scrollWidth === innerWidth`, ausência de `pageerror`, e **olhar** as imagens. Encerrar só o `next dev` próprio. Não declarar "responsivo" sem a captura.
- [ ] **Step 6: Checkpoint.**

---

### Task 8: Verificação final e entrega da fatia

- [ ] **Step 1:** backend `npx tsc --noEmit` → 0 erros; unit completo → só `r2-get-object`; e2e no ensaio: `employee-ingestion employees employee-history tenant-isolation-sweep rls-isolation company-units documents` → todos passam (saída real).
- [ ] **Step 2:** frontend `npx vitest run` completo, `npx tsc --noEmit`, `npm run lint` (só os 3 avisos antigos).
- [ ] **Step 3:** `superpowers:verification-before-completion`; relatório com VERIFICADO / NÃO VERIFICADO.
- [ ] **Step 4: Revisão independente** (agentes diferentes de quem implementou): `montese-qa` (diff real + critérios) e `montese-seguranca` (RLS da nova tabela, PII em `candidates`, máscara de CPF nas respostas, `FOR UPDATE` e atomicidade do resolve, zip bomb / limites do parser, upload só `.xlsx`, categoria nova não exposta no endpoint genérico, ausência de CPF em logs, mass assignment em `values`, transferência entre filiais impossível). Corrigir os achados em UMA onda e reexecutar o que for afetado.
- [ ] **Step 5: Relatório da fatia:** funcionalidades, arquivos, migration, testes, pendências; confirmar que **nenhum dado existente foi alterado** (migration só acrescenta categoria e cria tabela), que **nada foi aplicado em produção** e que a planilha real de `data/` não foi usada nem copiada.

## Critérios de aceitação da fatia
1. Planilha modelo (cabeçalho na linha 8, observações mescladas, datas e CBO numéricos do Excel) é lida corretamente; formatos diferentes de `.xlsx` são recusados em português.
2. Identificação só por CPF no tenant; campo vazio no cadastro é preenchido automaticamente (histórico `documento`); campo diferente vira conflito (nada muda sem revisão); célula vazia nunca apaga; funcionário de outra filial nunca é alterado.
3. Funcionário novo nunca é criado no upload; só ao aprovar na revisão, via `create` (limite do plano respeitado, histórico `revisao`).
4. Resolução atômica, exige decisão de todos os itens, detecta dado alterado desde a análise (409) e não corre em duplicidade.
5. Nenhum CPF completo nas respostas da API, nos logs nem em itens inválidos; `candidates` zerado ao resolver; técnico/parceiro sem acesso; tenant B não enxerga nem resolve extrações do A.
6. Fluxos existentes (import CSV, edição em lote, histórico, documentos) continuam passando.

## Riscos desta fatia
- **CHECK de categorias em produção:** a `0082` lê e estende a CHECK vigente; **testar a migration contra um dump estrutural da produção** antes do release (o ensaio só tem as migrations do worktree). Se a CHECK de produção tiver outro formato, a migration aborta sem alterar nada.
- **Planilha com milhares de linhas:** cada auto-aplicação é um `update` com SAVEPOINT (≤ 2000 linhas); aceitável, mas NÃO VERIFICADO em volume — medir antes de aumentar o limite.
- **Documento aparece na listagem de Documentos** com categoria que a UI não conhece (Task 3, passo 5).
- **PII em `candidates` até a revisão:** extrações `requer_revisao` esquecidas retêm nomes/CPFs completos. Decisão pendente do proprietário: prazo de expiração automática (RECOMENDADO 30 dias, com job de limpeza) — fora desta fatia.
- **Retenção do histórico (LGPD)** da Fatia 2 segue pendente de decisão do proprietário.
- **Planilha real em `data/` com dados reais:** não faz parte do repositório; manter fora de commits.

## Auto-revisão contra a spec
- §2 modelo e colunas: Task 1 (cabeçalho na linha 8, linhas de observação ignoradas, `Qtde` nunca usado como identificador). §3.1 conflito sempre revisão, auto-aplica só vazios por CPF: Task 2. §3.3 híbrida: nesta fatia só a parte determinística (planilha); regex em texto livre e MiniMax ficam na Fatia 4 (declarado em "Decisões de escopo"). §3.4 novo nunca criado direto: Tasks 4–5. §4 `employee_document_extractions`: Task 3 (sem `document_id` nulo; idempotência por `(tenant, document, hash)`; valores brutos apagados ao resolver). §5 endpoints `documents`, `extractions/:id`, `resolve`: Tasks 4–5. §6 botão "Anexar documento" + painel de revisão: Tasks 6–7.
- Tipos: `Extraction`/`ExtractionItem`/`FieldConflict` do frontend ≡ `ExtractionPublic`/`PublicItem`/`FieldConflict` do backend; `Candidate` interno (com valores) nunca sai pela API; literais de `app.change_source` (`documento`, `revisao`) ≡ `CHECK` da migration `0081`.

## Desvios da execução (registrados em 2026-10-14, após a revisão final)
- **Parser:** reescrito para NÃO criar linhas/células (planilha de ~6 KB com célula em XFD2/A5000 derrubava o Node por memória); varre só linhas existentes, ≤ 30 colunas, teto de 20000 linhas varridas, limites de descompressão menores (20 MB), tudo dentro do `try/catch`, caracteres invisíveis removidos.
- **Classificador:** CPF repetido conta linhas com outros campos inválidos; só `cpf`, `full_name` e os campos comparáveis chegam a `novo`/`autoApply` (nunca `status`, `position_id` ou `company_unit_id` vindos da linha).
- **Migration `0082`:** guarda de formato ancorada (exatamente um `ARRAY[`), verificação pós-ALTER de que nenhuma categoria se perdeu, `created_by`/`resolved_by` sem FK.
- **Idempotência:** dedupe por conteúdo no tenant (`pg_advisory_xact_lock` + extração `processando`/`requer_revisao` com o mesmo hash → `reused:true`), extração criada `processando` na transação 1, processada na 2 (`extract` por `extractionId`), marcada `erro` na 3 se falhar; `FOR UPDATE OF e` nos funcionários existentes; `GET extractions` do admin exige `?tenant_id`; `POST documents` e `resolve` só para `empresa`.
- **Frontend:** foco ao abrir, regiões vivas montadas, `setReview((cur) => cur ?? list[0])`, guarda de resposta inválida, linhas com problema visíveis após resolver/upload; texto de `sem_dados` = "Nenhuma linha de funcionário encontrada na planilha."
- **Rate limit:** `POST /employees/documents` limitado (20/h por IP, configurável por `EMPLOYEE_DOCUMENTS_RATE_LIMIT_MAX`/`_WINDOW_SECONDS`).
- **Pendente de decisão do proprietário / antes do release:** ver o relatório final da execução (retenção e acesso de técnico/parceiro à planilha no R2, cascata x REVOKE DELETE, vínculo do histórico com documento/extração, merge sobre a linha de produção 0079, dump estrutural de produção).
