# Base normativa do LIP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Armazenar, separados e rastreáveis, o trecho literal das normas (dispositivos) e a interpretação técnica do LIP (regras revisadas por humano), ligados à versão exata do documento oficial.

**Architecture:** Duas tabelas novas globais (sem `tenant_id`/RLS, como `official_sources`): `normative_provisions` (gerada por parser determinístico sobre o `raw_text` de um `normative_documents` vigente) e `lip_rules` (+ `lip_rule_provisions`), com máquina de estados `rascunho → revisada ⇄ revisar → retirada`. Um gancho SQL no fluxo de aprovação/retirada existente marca dispositivos como `obsoleto` e regras `revisada` como `revisar` quando o documento deixa de ser vigente. Rotas só de admin.

**Tech Stack:** NestJS, TypeScript, PostgreSQL (`pg`), class-validator, Jest (unit + e2e), tsx para scripts.

**Spec:** [docs/superpowers/specs/2026-10-09-base-normativa-lip-design.md](../specs/2026-10-09-base-normativa-lip-design.md)

> **Nota (2026-10-09, posterior à execução):** este plano é registro histórico. A `0072` criou `lip_rules`/`lip_rule_provisions`;
> a `0073_normative_rules_generalization.sql` renomeia para `normative_rules`/`normative_rule_provisions` (+ coluna `area`). No código
> atual: `LipRulesService` → `NormativeRulesService`, `/lip-rules` → `/normative-rules`, `*-lip-rule.dto.ts` → `*-normative-rule.dto.ts`,
> `lip-normative-base.e2e-spec.ts` → `normative-rules-base.e2e-spec.ts`. Ver o plano `2026-10-09-base-normativa-gro-pgr.md` (Task 2).

## Global Constraints

- **Sem commit/push/reset** pelo agente (AGENTS.md): cada task termina em "checkpoint" (`git status` + `git diff --stat`); quem commita é o proprietário.
- **A migration nunca é aplicada em produção pelo agente.** Testar só em banco descartável (runbook: memória do projeto `reference_running_tests_in_throwaway_container` e `reference_ensaio_descartavel_isolado`). Aplicar em produção exige autorização explícita + `bash ops/backup-postgres.sh` antes. Nunca `docker compose down -v`.
- Confirmar o número livre da migration antes de criar: `ls backend/db/migrations | sort -V | tail -3` (hoje o último é `0064_company_applicable_nrs.sql`; o plano usa `0072`).
- Tabelas novas: **sem `tenant_id`, sem RLS**, nenhum dado de empresa/trabalhador/PII.
- Escrita e leitura só com `@Roles('admin')` e `req.withTenantContext` (padrão de `normative-documents.controller.ts`); nunca contexto vindo de dto/body (`tenant-context-callsites.unit-spec.ts` precisa continuar verde).
- Parser **determinístico, sem modelo**: onde não reconhece estrutura, não cria linha. Nada de texto gerado entra em `literal_text`; vale a invariante `rawText.slice(char_start, char_end) === literal_text`.
- Não alterar provider/modelo de IA. Nenhum dado enviado a modelo.
- Mensagens ao usuário em português BR; logs sem conteúdo de pergunta/texto normativo (só ids, contagens).
- Rodar testes: `npm run test:unit` direto no host; `*.e2e-spec.ts` só no container descartável (e2e usam PROD fora dele).
- Desvios deliberados da spec (aplicados também na spec em "Task 8"): `normative_provisions.anexo` é `text NOT NULL DEFAULT ''` (para a UNIQUE funcionar sem NULL) e a coluna `heading` foi removida (YAGNI: o parser não a preenche).
- Medição de referência do parser (protótipo sobre os textos do `seed-data`, VERIFICADO em 2026-10-09): NR-15 → 296 dispositivos / 67% do texto; NR-16 → 80 / 90%; NR-01 → 162 / 95%. Os testes validam **comportamento**, não esses números.

## File Structure

- Create `backend/src/normative/provision-parser.ts` — função pura `parseProvisions(rawText, kind)`.
- Create `backend/src/normative/provision-lifecycle.ts` — `markDocumentProvisionsObsolete(client, documentId)`.
- Create `backend/src/normative/provisions.service.ts` — gerar/listar dispositivos.
- Create `backend/src/normative/lip-rules.service.ts` — CRUD + máquina de estados das regras.
- Create `backend/src/normative/dto/create-lip-rule.dto.ts`, `update-lip-rule.dto.ts`, `set-rule-provisions.dto.ts`, `review-lip-rule.dto.ts`, `retire-lip-rule.dto.ts`.
- Create `backend/src/normative/provisions.controller.ts`, `lip-rules.controller.ts`.
- Modify `backend/src/normative/normative.module.ts` — registrar providers/controllers.
- Modify `backend/src/normative/normative-documents.service.ts` — chamar o gancho em `finalizeApproval` e `retire`.
- Create `backend/db/migrations/0072_lip_normative_base.sql`.
- Create `backend/db/generate-provisions.ts` + script `db:generate-provisions` em `backend/package.json`.
- Create tests: `backend/test/provision-parser.unit-spec.ts`, `provisions-service.unit-spec.ts`, `lip-rules-service.unit-spec.ts`, `lip-rules-controller.unit-spec.ts`, `lip-normative-migration.unit-spec.ts`, `lip-normative-base.e2e-spec.ts`.
- Create `docs/operations/runbook-ingestao-lip.md`.

---

### Task 1: Parser de dispositivos (puro)

**Files:**
- Create: `backend/src/normative/provision-parser.ts`
- Test: `backend/test/provision-parser.unit-spec.ts`

**Interfaces:**
- Produces:
  - `type ParserKind = 'nr' | 'clt'`
  - `interface ParsedProvision { anexo: string; item_path: string; heading: string | null; literal_text: string; char_start: number; char_end: number }` (`heading` é sempre `null`; mantido fora da tabela — o service ignora o campo)
  - `interface ParseAnomaly { kind: 'anexo_repetido' | 'item_repetido' | 'item_ambiguo'; line: number; detail: string }`
  - `interface ParseResult { provisions: ParsedProvision[]; anomalies: ParseAnomaly[]; total_chars: number; covered_chars: number; coverage: number }`
  - `const PARSER_VERSION = 'provision-parser/1'`
  - `function parseProvisions(rawText: string, kind: ParserKind): ParseResult`

- [ ] **Step 1: Write the failing test**

Create `backend/test/provision-parser.unit-spec.ts`:

```ts
import { parseProvisions, PARSER_VERSION } from '../src/normative/provision-parser';

const paths = (raw: string, kind: 'nr' | 'clt') =>
  parseProvisions(raw, kind).provisions.map((p) => `${p.anexo}|${p.item_path}`);

// Trecho real do texto da NR-15 (db/seed-data/normative-sources/NR-15.txt, linhas 29-32).
const NR15_TRECHO = [
  '15.1 São consideradas atividades ou operações insalubres as que se desenvolvem:',
  '15.1.1 Acima dos limites de tolerância previstos nos Anexos nº 1, 2, 3, 5, 11 e 12;',
  '15.1.2 (Revogado pela Portaria MTE nº 3.751, de 23 de novembro de 1990)',
  '15.1.3 Nas atividades mencionadas nos Anexos nº 6, 13 e 14;',
].join('\n');

describe('PARSER_VERSION', () => {
  it('é versionado', () => expect(PARSER_VERSION).toBe('provision-parser/1'));
});

describe('parseProvisions — NR', () => {
  it('extrai itens numerados de um trecho real da NR-15, na ordem', () => {
    expect(paths(NR15_TRECHO, 'nr')).toEqual(['|15.1', '|15.1.1', '|15.1.2', '|15.1.3']);
  });

  it('invariante: o literal é exatamente o recorte do texto original', () => {
    const r = parseProvisions(NR15_TRECHO, 'nr');
    for (const p of r.provisions) expect(NR15_TRECHO.slice(p.char_start, p.char_end)).toBe(p.literal_text);
    expect(r.coverage).toBeGreaterThan(0.98);
  });

  it('linhas de tabela (sem ponto, ou minúsculas) não viram item e ficam no item anterior', () => {
    const r = parseProvisions('1.1 Texto do item.\n85 dB(A) 8 horas\n250 L\n0.5 mg/m3 limite', 'nr');
    expect(r.provisions).toHaveLength(1);
    expect(r.provisions[0].literal_text.split('\n')).toHaveLength(4);
  });

  it('anexos: arábico, romano e sufixo; o item reinicia por anexo', () => {
    expect(paths('ANEXO Nº 1\n1.1 Ruído contínuo.\nANEXO IV\n1.1 Outro.', 'nr')).toEqual(['1|1.1', '4|1.1']);
    expect(paths('ANEXO II\n1.1 Texto.\nANEXO Nº 13-A\n1.1 Benzeno.', 'nr')).toEqual(['2|1.1', '13-A|1.1']);
  });

  it('cabeçalho de anexo repetido vira anomalia e colisão ambígua NÃO grava nenhum dos dois', () => {
    const r = parseProvisions('ANEXO Nº 1\n1.1 Texto A.\nANEXO Nº 1\n1.1 Texto B.', 'nr');
    expect(r.provisions).toEqual([]);
    expect(r.anomalies.map((a) => a.kind)).toEqual(['anexo_repetido', 'item_ambiguo']);
  });

  it('sumário: o título curto do sumário perde para o título do corpo (que tem filhos)', () => {
    const raw = [
      'SUMÁRIO',
      '1.1 Objetivo',
      '1.2 Campo de aplicação',
      '1.1 Objetivo',
      '1.1.1 O objetivo desta Norma é estabelecer.',
      '1.2 Campo de aplicação',
      '1.2.1 Aplica-se a todos.',
    ].join('\n');
    const r = parseProvisions(raw, 'nr');
    expect(r.provisions.map((p) => p.item_path)).toEqual(['1.1', '1.1.1', '1.2', '1.2.1']);
    expect(r.provisions[0].char_start).toBeGreaterThan(raw.indexOf('1.2 Campo de aplicação'));
    expect(r.anomalies.map((a) => a.kind)).toEqual(['item_repetido', 'item_repetido']);
  });

  it('texto sem estrutura reconhecida: nenhuma linha, cobertura 0', () => {
    const r = parseProvisions('Preâmbulo sem item.\nOutra linha.', 'nr');
    expect(r.provisions).toEqual([]);
    expect(r.coverage).toBe(0);
  });

  it('item que abre com aspa curva é reconhecido', () => {
    expect(paths('1.1 “Termo” significa algo.', 'nr')).toEqual(['|1.1']);
  });

  it('texto vazio não quebra', () => {
    expect(parseProvisions('', 'nr')).toMatchObject({ provisions: [], total_chars: 0, coverage: 0 });
  });
});

// ATENÇÃO: fixture SINTÉTICA — valida só a estrutura (artigo/§/inciso), não é texto da CLT.
// Ao ingerir a CLT real (runbook), acrescentar um teste com trecho real dos arts. 192-193.
describe('parseProvisions — CLT (estrutura sintética)', () => {
  it('artigo, parágrafo, parágrafo único, inciso e artigo com sufixo', () => {
    const raw = 'Art. 192 Caput teste.\n§ 1º Primeiro.\nParágrafo único. Único.\nI - inciso um;\nArt. 193-A Outro.\nArt. 193 outro texto.';
    expect(paths(raw, 'clt')).toEqual([
      '|art. 192',
      '|art. 192 §1',
      '|art. 192 §único',
      '|art. 192 §único inc. I',
      '|art. 193-A',
      '|art. 193',
    ]);
  });

  it('parágrafo antes de qualquer artigo é ignorado', () => {
    expect(paths('§ 1º Solto.\nArt. 1º Teste.', 'clt')).toEqual(['|art. 1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --config ./test/jest-unit.json provision-parser`
Expected: FAIL — `Cannot find module '../src/normative/provision-parser'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/normative/provision-parser.ts`:

```ts
// Parser DETERMINÍSTICO de dispositivos (artigo/item/anexo) sobre o raw_text de um documento
// normativo. Sem I/O e sem modelo: onde não reconhece a estrutura, não cria linha — o que
// sobra aparece em `coverage` e `anomalies`, nunca é preenchido às cegas.
// Medição de referência (protótipo, 2026-10-09): NR-15 → 296 dispositivos/67%; NR-16 → 80/90%;
// NR-01 → 162/95%. Heurística: não é garantia de cobertura total.
export type ParserKind = 'nr' | 'clt';

export interface ParsedProvision {
  anexo: string;
  item_path: string;
  heading: string | null;
  literal_text: string;
  char_start: number;
  char_end: number;
}

export interface ParseAnomaly {
  kind: 'anexo_repetido' | 'item_repetido' | 'item_ambiguo';
  line: number;
  detail: string;
}

export interface ParseResult {
  provisions: ParsedProvision[];
  anomalies: ParseAnomaly[];
  total_chars: number;
  covered_chars: number;
  coverage: number;
}

export const PARSER_VERSION = 'provision-parser/1';

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
// Entrada de sumário: título curto cujo próximo dispositivo NÃO é filho dele.
const TOC_MAX_CHARS = 160;

function romanToInt(s: string): number {
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]];
    const next = ROMAN[s[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

// "ANEXO Nº 13-A" → "13-A"; "ANEXO IV" → "4"; "ANEXO (*)" e "ANEXO “A”" não casam.
const ANEXO_RE = /^ANEXO\s+(?:N[º°o]\s*)?(\d+(?:-[A-Z])?|[IVXLC]+)\s*(?:\(\*\))?\s*$/i;
// Exige ponto (15.1, 1.1.1 ou "3.") e iniciar em maiúscula/abre-parêntese/aspas: linhas de
// tabela como "85 dB(A) 8 horas", "250 L" ou "0.5 mg/m3" não são item.
const NR_ITEM_RE = /^(\d+(?:\.\d+)+\.?|\d+\.)\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ("“])/;
const CLT_ART_RE = /^Art\.\s*(\d+)\s*[º°o]?(?:\s*-\s*([A-Z]))?\s*\.?(?=\s|$)/;
const CLT_PAR_RE = /^(?:§\s*(\d+)\s*[º°o]?|(Parágrafo único))\s*\.?(?=\s|$)/;
const CLT_INC_RE = /^([IVXLC]+)\s*[-–—]\s/;

function normalizeAnexo(raw: string): string {
  return /^[IVXLC]+$/i.test(raw) ? String(romanToInt(raw.toUpperCase())) : raw.toUpperCase();
}

interface Line {
  text: string;
  start: number;
}

function splitLines(raw: string): Line[] {
  const lines: Line[] = [];
  let pos = 0;
  for (const part of raw.split('\n')) {
    lines.push({ text: part, start: pos });
    pos += part.length + 1;
  }
  return lines;
}

interface Candidate extends ParsedProvision {
  line: number;
}

interface Open {
  anexo: string;
  item_path: string;
  start: number;
  line: number;
}

function isChild(parent: string, child: string): boolean {
  return child.startsWith(`${parent}.`) || child.startsWith(`${parent} `);
}

export function parseProvisions(rawText: string, kind: ParserKind): ParseResult {
  const lines = splitLines(rawText);
  const candidates: Candidate[] = [];
  const anomalies: ParseAnomaly[] = [];
  const seenAnexos = new Set<string>();
  let anexo = '';
  let open: Open | null = null;
  let artAtual = '';
  let parAtual = '';

  const close = (endExclusive: number) => {
    if (!open) return;
    const literal = rawText.slice(open.start, endExclusive).replace(/\s+$/, '');
    if (literal.length > 0) {
      candidates.push({
        anexo: open.anexo,
        item_path: open.item_path,
        heading: null,
        literal_text: literal,
        char_start: open.start,
        char_end: open.start + literal.length,
        line: open.line,
      });
    }
    open = null;
  };

  const begin = (item_path: string, line: Line, lineNo: number) => {
    open = { anexo, item_path, start: line.start, line: lineNo };
  };

  lines.forEach((line, idx) => {
    const t = line.text.trim();
    const lineNo = idx + 1;

    const anexoMatch = kind === 'nr' ? ANEXO_RE.exec(t) : null;
    if (anexoMatch) {
      close(line.start);
      const id = normalizeAnexo(anexoMatch[1]);
      if (seenAnexos.has(id)) {
        // Sub-anexo ou repetição: o cabeçalho e o que vem até o próximo item reconhecido ficam fora.
        anomalies.push({ kind: 'anexo_repetido', line: lineNo, detail: id });
        return;
      }
      seenAnexos.add(id);
      anexo = id;
      return;
    }

    if (kind === 'nr') {
      const m = NR_ITEM_RE.exec(t);
      if (m) {
        close(line.start);
        begin(m[1].replace(/\.$/, ''), line, lineNo);
      }
      return;
    }

    const art = CLT_ART_RE.exec(t);
    if (art) {
      close(line.start);
      artAtual = `art. ${art[1]}${art[2] ? `-${art[2]}` : ''}`;
      parAtual = '';
      begin(artAtual, line, lineNo);
      return;
    }
    const par = CLT_PAR_RE.exec(t);
    if (par && artAtual) {
      close(line.start);
      parAtual = par[2] ? `${artAtual} §único` : `${artAtual} §${par[1]}`;
      begin(parAtual, line, lineNo);
      return;
    }
    const inc = CLT_INC_RE.exec(t);
    if (inc && artAtual) {
      close(line.start);
      begin(`${parAtual || artAtual} inc. ${inc[1]}`, line, lineNo);
    }
  });
  close(rawText.length);

  // Colisão de chave (mesmo anexo + item). O sumário repete títulos de seção antes do corpo:
  // uma ocorrência é "de sumário" se é curta e o próximo dispositivo não é filho dela. Se sobra
  // exatamente uma ocorrência que não é de sumário, ela vence; senão é ambíguo e NENHUMA é gravada.
  const isToc = (c: Candidate, i: number): boolean => {
    const next = candidates[i + 1];
    return c.literal_text.length <= TOC_MAX_CHARS && !(next && next.anexo === c.anexo && isChild(c.item_path, next.item_path));
  };
  const groups = new Map<string, { c: Candidate; toc: boolean }[]>();
  candidates.forEach((c, i) => {
    const key = `${c.anexo}\u0000${c.item_path}`;
    groups.set(key, [...(groups.get(key) ?? []), { c, toc: isToc(c, i) }]);
  });
  const provisions: ParsedProvision[] = [];
  const strip = ({ line: _line, ...p }: Candidate): ParsedProvision => p;
  for (const group of groups.values()) {
    if (group.length === 1) {
      provisions.push(strip(group[0].c));
      continue;
    }
    const real = group.filter((g) => !g.toc);
    if (real.length === 1) {
      provisions.push(strip(real[0].c));
      group.filter((g) => g !== real[0]).forEach((g) => anomalies.push({ kind: 'item_repetido', line: g.c.line, detail: g.c.item_path }));
    } else {
      anomalies.push({ kind: 'item_ambiguo', line: group[0].c.line, detail: `${group[0].c.item_path} (${group.length}x)` });
    }
  }
  provisions.sort((a, b) => a.char_start - b.char_start);

  const covered = provisions.reduce((s, p) => s + (p.char_end - p.char_start), 0);
  return {
    provisions,
    anomalies,
    total_chars: rawText.length,
    covered_chars: covered,
    coverage: rawText.length === 0 ? 0 : covered / rawText.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest --config ./test/jest-unit.json provision-parser`
Expected: PASS (todos os casos). Rodar também `npx tsc --noEmit -p tsconfig.json` — sem erros.

- [ ] **Step 5: Checkpoint (sem commit)**

Run: `git status --short backend/src/normative backend/test | grep provision` — só os 2 arquivos novos.

---

### Task 2: Migration 0072 (tabelas, constraints, trigger)

**Files:**
- Create: `backend/db/migrations/0072_lip_normative_base.sql`
- Test: `backend/test/lip-normative-migration.unit-spec.ts` (estático), `backend/test/lip-normative-base.e2e-spec.ts` (banco descartável)

**Interfaces:**
- Produces tabelas: `normative_provisions(id, document_id, norma, anexo, item_path, literal_text, char_start, char_end, document_hash, parser_version, status 'ativo'|'obsoleto', created_at)`; `lip_rules(id, rule_key, categoria, agente_ou_atividade, metodo_avaliacao, unidade, criterio, excecoes, dependencias jsonb, interpretacao, exige_revisao_profissional, vigencia_inicio, vigencia_fim, status 'rascunho'|'revisada'|'revisar'|'retirada', reviewed_by_user_id, reviewed_at, reviewer_registro, created_at, updated_at)`; `lip_rule_provisions(rule_id, provision_id, papel 'fundamento'|'criterio'|'excecao'|'metodo')`.

- [ ] **Step 1: Write the failing static test**

Create `backend/test/lip-normative-migration.unit-spec.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

// Só o SQL executável conta: os comentários da migration mencionam "tenant_id"/"RLS" justamente para dizer que NÃO existem.
const sql = readFileSync(join(__dirname, '..', 'db', 'migrations', '0072_lip_normative_base.sql'), 'utf8').replace(/--.*$/gm, '');

describe('migration 0072 — base normativa do LIP', () => {
  it('é aditiva: nada destrutivo', () => {
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
  });

  it('conhecimento global: sem tenant_id e sem RLS', () => {
    expect(sql).not.toMatch(/tenant_id/i);
    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it('cria as três tabelas', () => {
    for (const t of ['normative_provisions', 'lip_rules', 'lip_rule_provisions']) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE ${t}\\b`));
    }
  });

  it('regra revisada exige revisor identificado e dispositivo ativo (CHECK + trigger)', () => {
    expect(sql).toMatch(/reviewer_registro/);
    expect(sql).toMatch(/status <> 'revisada'/);
    expect(sql).toMatch(/CREATE TRIGGER lip_rules_require_active_provision/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --config ./test/jest-unit.json lip-normative-migration`
Expected: FAIL — `ENOENT ... 0072_lip_normative_base.sql`.

- [ ] **Step 3: Write the migration**

Create `backend/db/migrations/0072_lip_normative_base.sql`:

```sql
-- Base normativa do LIP (docs/superpowers/specs/2026-10-09-base-normativa-lip-design.md).
-- Camada 2 do conhecimento normativo: dispositivos LITERAIS (gerados por parser determinístico
-- sobre normative_documents) separados das regras INTERPRETATIVAS (lip_rules, sempre revisadas
-- por humano). Conhecimento compartilhado entre tenants — SEM tenant_id, SEM RLS (mesma
-- categoria de official_sources/normative_documents). Só aditiva.

CREATE TABLE normative_provisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES normative_documents(id) ON DELETE CASCADE,
  norma text NOT NULL,
  -- '' = corpo da norma (fora de anexo); evita NULL na UNIQUE.
  anexo text NOT NULL DEFAULT '',
  item_path text NOT NULL,
  literal_text text NOT NULL,
  char_start integer NOT NULL,
  char_end integer NOT NULL,
  -- Cópia de normative_documents.content_hash no momento da geração: prova de qual versão.
  document_hash text NOT NULL,
  parser_version text NOT NULL,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'obsoleto')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT normative_provisions_span CHECK (char_start >= 0 AND char_end > char_start),
  CONSTRAINT normative_provisions_unique UNIQUE (document_id, anexo, item_path, parser_version)
);

CREATE INDEX normative_provisions_lookup_idx ON normative_provisions (norma, anexo) WHERE status = 'ativo';

CREATE TABLE lip_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL UNIQUE,
  categoria text NOT NULL CHECK (categoria IN ('insalubridade', 'periculosidade', 'prevencao', 'previdenciario')),
  agente_ou_atividade text NOT NULL,
  metodo_avaliacao text NOT NULL CHECK (metodo_avaliacao IN ('quantitativo', 'qualitativo', 'misto', 'nao_aplicavel')),
  unidade text,
  -- Aponta ao dispositivo literal; números só entram se vierem do dispositivo vinculado.
  criterio text NOT NULL,
  excecoes text,
  dependencias jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Interpretação técnica da Montese: SEMPRE separada do trecho literal.
  interpretacao text NOT NULL,
  exige_revisao_profissional boolean NOT NULL DEFAULT true,
  vigencia_inicio date,
  vigencia_fim date,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'revisada', 'revisar', 'retirada')),
  reviewed_by_user_id uuid REFERENCES users(id),
  reviewed_at timestamptz,
  reviewer_registro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lip_rules_vigencia CHECK (vigencia_fim IS NULL OR vigencia_inicio IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT lip_rules_revisada_exige_revisor CHECK (
    status <> 'revisada'
    OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND length(trim(coalesce(reviewer_registro, ''))) > 0)
  )
);

CREATE INDEX lip_rules_categoria_status_idx ON lip_rules (categoria, status);

CREATE TABLE lip_rule_provisions (
  rule_id uuid NOT NULL REFERENCES lip_rules(id) ON DELETE CASCADE,
  -- RESTRICT: apagar um dispositivo ligado a uma regra não pode deixar a regra 'revisada' sem fundamento;
  -- o fluxo normal é marcar o dispositivo 'obsoleto' (o gancho rebaixa a regra para 'revisar').
  provision_id uuid NOT NULL REFERENCES normative_provisions(id) ON DELETE RESTRICT,
  papel text NOT NULL CHECK (papel IN ('fundamento', 'criterio', 'excecao', 'metodo')),
  PRIMARY KEY (rule_id, provision_id, papel)
);

CREATE INDEX lip_rule_provisions_provision_idx ON lip_rule_provisions (provision_id);

-- Uma regra só pode estar 'revisada' se tiver ao menos um dispositivo literal ATIVO vinculado.
CREATE FUNCTION lip_rules_require_active_provision() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'revisada' AND NOT EXISTS (
    SELECT 1
    FROM lip_rule_provisions rp
    JOIN normative_provisions p ON p.id = rp.provision_id
    WHERE rp.rule_id = NEW.id AND p.status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'lip_rules: regra revisada exige ao menos um dispositivo literal ativo vinculado'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lip_rules_require_active_provision
  BEFORE INSERT OR UPDATE ON lip_rules
  FOR EACH ROW EXECUTE FUNCTION lip_rules_require_active_provision();
```

- [ ] **Step 4: Run static test**

Run: `cd backend && npx jest --config ./test/jest-unit.json lip-normative-migration`
Expected: PASS.

- [ ] **Step 5: Write the e2e (banco descartável) constraints test**

Create `backend/test/lip-normative-base.e2e-spec.ts` (usa o superuser de teste como `db-test-helper.ts`; **só roda no container descartável com a migration 0072 aplicada**):

```ts
import { Client } from 'pg';
import { randomUUID } from 'crypto';

const URL = process.env.TEST_SUPERUSER_DATABASE_URL;

describe('base normativa do LIP — constraints (banco descartável)', () => {
  let c: Client;
  let sourceId: string;
  let docId: string;
  let userId: string;
  const ruleIds: string[] = [];

  const novaRegra = async (status = 'rascunho', extra: Record<string, unknown> = {}) => {
    const id = randomUUID();
    ruleIds.push(id);
    await c.query(
      `INSERT INTO lip_rules (id, rule_key, categoria, agente_ou_atividade, metodo_avaliacao, criterio, interpretacao, status)
       VALUES ($1, $2, 'insalubridade', 'Ruído', 'quantitativo', 'ver dispositivo', 'rascunho de teste', $3)`,
      [id, `TESTE-${id}`, status],
    );
    return id;
  };
  const novoDispositivo = async (path: string, status = 'ativo') => {
    const r = await c.query(
      `INSERT INTO normative_provisions (document_id, norma, anexo, item_path, literal_text, char_start, char_end, document_hash, parser_version, status)
       VALUES ($1, 'NR-TESTE', '', $2, 'texto', 0, 5, 'hash', 'teste/1', $3) RETURNING id`,
      [docId, path, status],
    );
    return r.rows[0].id as string;
  };

  beforeAll(async () => {
    if (!URL) throw new Error('TEST_SUPERUSER_DATABASE_URL não definida');
    c = new Client({ connectionString: URL });
    await c.connect();
    sourceId = randomUUID();
    docId = randomUUID();
    userId = (await c.query(`SELECT id FROM users LIMIT 1`)).rows[0].id;
    await c.query(`INSERT INTO official_sources (id, entity, code, title, official_url) VALUES ($1, 'TESTE', 'NR-TESTE', 'Teste', 'https://exemplo.gov.br/t')`, [sourceId]);
    await c.query(
      `INSERT INTO normative_documents (id, source_id, status, content_hash, file_key, file_name, mime_type, raw_text)
       VALUES ($1, $2, 'vigente', 'hash', 'k', 'f', 'text/html', 'texto')`,
      [docId, sourceId],
    );
  });

  afterAll(async () => {
    await c.query(`DELETE FROM lip_rules WHERE id = ANY($1)`, [ruleIds]);
    await c.query(`DELETE FROM normative_documents WHERE id = $1`, [docId]);
    await c.query(`DELETE FROM official_sources WHERE id = $1`, [sourceId]);
    await c.end();
  });

  it('regra nasce rascunho e NÃO pode nascer revisada', async () => {
    await expect(novaRegra('rascunho')).resolves.toBeTruthy();
    await expect(novaRegra('revisada')).rejects.toThrow();
  });

  it('revisada sem revisor identificado é rejeitada pelo CHECK', async () => {
    const id = await novaRegra();
    const p = await novoDispositivo('t.1');
    await c.query(`INSERT INTO lip_rule_provisions (rule_id, provision_id, papel) VALUES ($1, $2, 'fundamento')`, [id, p]);
    await expect(c.query(`UPDATE lip_rules SET status = 'revisada' WHERE id = $1`, [id])).rejects.toThrow(/revisada_exige_revisor/);
  });

  it('revisada sem dispositivo ativo vinculado é rejeitada pelo trigger', async () => {
    const id = await novaRegra();
    await expect(
      c.query(`UPDATE lip_rules SET status = 'revisada', reviewed_by_user_id = $2, reviewed_at = now(), reviewer_registro = 'CREA 0000' WHERE id = $1`, [id, userId]),
    ).rejects.toThrow(/dispositivo literal ativo/);
  });

  it('revisada com dispositivo ativo e revisor identificado é aceita; vinculada só a obsoleto, não', async () => {
    const ok = await novaRegra();
    const ativo = await novoDispositivo('t.2');
    await c.query(`INSERT INTO lip_rule_provisions (rule_id, provision_id, papel) VALUES ($1, $2, 'fundamento')`, [ok, ativo]);
    await c.query(`UPDATE lip_rules SET status = 'revisada', reviewed_by_user_id = $2, reviewed_at = now(), reviewer_registro = 'CREA 0000' WHERE id = $1`, [ok, userId]);

    const ruim = await novaRegra();
    const obsoleto = await novoDispositivo('t.3', 'obsoleto');
    await c.query(`INSERT INTO lip_rule_provisions (rule_id, provision_id, papel) VALUES ($1, $2, 'fundamento')`, [ruim, obsoleto]);
    await expect(
      c.query(`UPDATE lip_rules SET status = 'revisada', reviewed_by_user_id = $2, reviewed_at = now(), reviewer_registro = 'CREA 0000' WHERE id = $1`, [ruim, userId]),
    ).rejects.toThrow(/dispositivo literal ativo/);
  });

  it('dispositivo duplicado (mesmo documento/anexo/item/versão) é rejeitado', async () => {
    await novoDispositivo('t.dup');
    await expect(novoDispositivo('t.dup')).rejects.toThrow(/normative_provisions_unique/);
  });

  it('as tabelas novas não têm coluna tenant_id', async () => {
    const r = await c.query(
      `SELECT table_name FROM information_schema.columns
       WHERE table_name IN ('normative_provisions','lip_rules','lip_rule_provisions') AND column_name = 'tenant_id'`,
    );
    expect(r.rows).toEqual([]);
  });
});
```

- [ ] **Step 6: Run the e2e in the throwaway container**

Aplicar `0072` no banco **descartável** (nunca produção) e rodar: `npx jest --config ./test/jest-e2e.json --runInBand lip-normative-base`
Expected: PASS (6 testes). Se o container descartável não estiver disponível, **parar e pedir ao proprietário** — não rodar contra produção.

- [ ] **Step 7: Checkpoint (sem commit)** — `git status --short backend/db backend/test`.

---

### Task 3: Serviço de dispositivos + gancho de obsolescência

**Files:**
- Create: `backend/src/normative/provision-lifecycle.ts`, `backend/src/normative/provisions.service.ts`
- Modify: `backend/src/normative/normative-documents.service.ts` (em `finalizeApproval`, logo após `UPDATE normative_documents SET status = 'substituido'`; e em `retire`, logo após o `UPDATE` bem-sucedido)
- Test: `backend/test/provisions-service.unit-spec.ts`

**Interfaces:**
- Consumes: `parseProvisions`, `PARSER_VERSION`, `ParseAnomaly` (Task 1); tabelas (Task 2).
- Produces:
  - `markDocumentProvisionsObsolete(client: PoolClient, documentId: string): Promise<void>`
  - `class ProvisionsService { generate(client, documentId): Promise<GenerateReport>; list(client, filters: ProvisionFilters): Promise<ProvisionRow[]> }`
  - `interface GenerateReport { document_id: string; norma: string; parser_version: string; found: number; inserted: number; coverage: number; anomalies: ParseAnomaly[] }`
  - `interface ProvisionFilters { documentId?: string; norma?: string; anexo?: string; status?: 'ativo' | 'obsoleto'; limit?: number }`
  - `interface ProvisionRow { id; document_id; norma; anexo; item_path; literal_text; char_start; char_end; document_hash; parser_version; status; created_at }`

- [ ] **Step 1: Write the failing test**

Create `backend/test/provisions-service.unit-spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { markDocumentProvisionsObsolete } from '../src/normative/provision-lifecycle';
import { ProvisionsService } from '../src/normative/provisions.service';

type Call = { sql: string; params: any[] };

function montar(doc?: { id: string; status: string; content_hash: string; raw_text: string; code: string | null }, jaTemOutraVersao = false) {
  const calls: Call[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM normative_documents d')) return { rows: doc ? [doc] : [] };
      if (sql.includes('parser_version <>')) return { rows: jaTemOutraVersao ? [{ '?column?': 1 }] : [] };
      if (sql.includes('INSERT INTO normative_provisions')) return { rows: [], rowCount: 3 };
      return { rows: [], rowCount: 0 };
    }),
  };
  const com = (trecho: string) => calls.filter((c) => c.sql.includes(trecho));
  return { client, calls, com, service: new ProvisionsService() };
}

const RAW = '15.1 São consideradas atividades ou operações insalubres.\n15.1.1 Acima dos limites de tolerância.\n15.1.2 (Revogado)';
const doc = (over: object = {}) => ({ id: 'd1', status: 'vigente', content_hash: 'h1', raw_text: RAW, code: 'NR-15', ...over });

describe('markDocumentProvisionsObsolete', () => {
  it('regras revisadas ligadas voltam para "revisar" ANTES de os dispositivos virarem obsoletos', async () => {
    const { client, calls } = montar();
    await markDocumentProvisionsObsolete(client, 'd1');
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toMatch(/UPDATE lip_rules SET status = 'revisar'/);
    expect(calls[0].sql).toMatch(/status = 'revisada'/);
    expect(calls[1].sql).toMatch(/UPDATE normative_provisions SET status = 'obsoleto'/);
    expect(calls[0].params).toEqual(['d1']);
  });
});

describe('ProvisionsService.generate', () => {
  it('documento inexistente → 404', async () => {
    const { service, client } = montar(undefined);
    await expect(service.generate(client, 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('só documento vigente gera dispositivos', async () => {
    const { service, client } = montar(doc({ status: 'aguardando_validacao' }));
    await expect(service.generate(client, 'd1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fonte sem parser (código que não é NR/CLT) → 400, sem escrever', async () => {
    const { service, client, com } = montar(doc({ code: 'NHO 01' }));
    await expect(service.generate(client, 'd1')).rejects.toBeInstanceOf(BadRequestException);
    expect(com('INSERT INTO normative_provisions')).toHaveLength(0);
  });

  it('NR vigente: insere com hash do documento e versão do parser, e devolve o relatório', async () => {
    const { service, client, com } = montar(doc());
    const rep = await service.generate(client, 'd1');
    const ins = com('INSERT INTO normative_provisions')[0];
    expect(ins.params.slice(0, 4)).toEqual(['d1', 'NR-15', 'h1', 'provision-parser/1']);
    expect(ins.params[5]).toEqual(['15.1', '15.1.1', '15.1.2']);
    expect(ins.sql).toMatch(/ON CONFLICT .* DO NOTHING/s);
    expect(rep).toMatchObject({ document_id: 'd1', norma: 'NR-15', parser_version: 'provision-parser/1', found: 3, inserted: 3 });
    expect(rep.coverage).toBeGreaterThan(0.9);
  });

  it('código "NR 15" e "nr-15" normalizam para "NR-15"; "CLT" usa o parser de CLT', async () => {
    const a = montar(doc({ code: 'NR 15' }));
    expect((await a.service.generate(a.client, 'd1')).norma).toBe('NR-15');
    const b = montar(doc({ code: 'CLT', raw_text: 'Art. 192 Texto.' }));
    expect((await b.service.generate(b.client, 'd1')).norma).toBe('CLT');
  });

  it('já existem dispositivos ativos de OUTRA versão do parser → marca obsoleto antes de gerar', async () => {
    const { service, client, calls } = montar(doc(), true);
    await service.generate(client, 'd1');
    const iObs = calls.findIndex((c) => c.sql.includes("UPDATE normative_provisions SET status = 'obsoleto'"));
    const iIns = calls.findIndex((c) => c.sql.includes('INSERT INTO normative_provisions'));
    expect(iObs).toBeGreaterThan(-1);
    expect(iObs).toBeLessThan(iIns);
  });

  it('texto sem estrutura reconhecida: nada inserido e relatório com found 0', async () => {
    const { service, client, com } = montar(doc({ raw_text: 'Sem itens aqui.' }));
    const rep = await service.generate(client, 'd1');
    expect(rep.found).toBe(0);
    expect(com('INSERT INTO normative_provisions')).toHaveLength(0);
  });
});

describe('ProvisionsService.list', () => {
  it('filtra por documento/norma/anexo/status com parâmetros e limita a 500', async () => {
    const { service, client, calls } = montar();
    await service.list(client, { documentId: 'd1', norma: 'NR-15', anexo: '3', status: 'ativo', limit: 9999 });
    expect(calls[0].sql).toMatch(/document_id = \$1/);
    expect(calls[0].sql).toMatch(/norma = \$2/);
    expect(calls[0].sql).toMatch(/anexo = \$3/);
    expect(calls[0].sql).toMatch(/status = \$4/);
    expect(calls[0].params).toEqual(['d1', 'NR-15', '3', 'ativo', 500]);
  });

  it('sem filtros: status padrão "ativo"', async () => {
    const { service, client, calls } = montar();
    await service.list(client, {});
    expect(calls[0].params).toEqual(['ativo', 200]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --config ./test/jest-unit.json provisions-service`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/normative/provision-lifecycle.ts`:

```ts
import { PoolClient } from 'pg';

// Chamado quando um documento deixa de ser vigente (substituído por nova versão ou retirado).
// Ordem importa: a subquery das regras depende de os dispositivos ainda estarem 'ativo'.
// Regras 'rascunho' não mudam; 'revisada' volta a 'revisar' (precisa de nova revisão humana).
export async function markDocumentProvisionsObsolete(client: PoolClient, documentId: string): Promise<void> {
  await client.query(
    `UPDATE lip_rules SET status = 'revisar', updated_at = now()
     WHERE status = 'revisada' AND id IN (
       SELECT rp.rule_id FROM lip_rule_provisions rp
       JOIN normative_provisions p ON p.id = rp.provision_id
       WHERE p.document_id = $1 AND p.status = 'ativo'
     )`,
    [documentId],
  );
  await client.query(
    `UPDATE normative_provisions SET status = 'obsoleto' WHERE document_id = $1 AND status = 'ativo'`,
    [documentId],
  );
}
```

Create `backend/src/normative/provisions.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { markDocumentProvisionsObsolete } from './provision-lifecycle';
import { PARSER_VERSION, ParseAnomaly, ParserKind, parseProvisions } from './provision-parser';

export interface GenerateReport {
  document_id: string;
  norma: string;
  parser_version: string;
  found: number;
  inserted: number;
  coverage: number;
  anomalies: ParseAnomaly[];
}

export interface ProvisionFilters {
  documentId?: string;
  norma?: string;
  anexo?: string;
  status?: 'ativo' | 'obsoleto';
  limit?: number;
}

export interface ProvisionRow {
  id: string;
  document_id: string;
  norma: string;
  anexo: string;
  item_path: string;
  literal_text: string;
  char_start: number;
  char_end: number;
  document_hash: string;
  parser_version: string;
  status: 'ativo' | 'obsoleto';
  created_at: string;
}

const MAX_ANOMALIES_IN_REPORT = 200;

// Código da fonte → (norma normalizada, parser). Só NR e CLT têm parser nesta entrega.
function resolveKind(code: string | null): { norma: string; kind: ParserKind } {
  const c = (code ?? '').trim();
  const nr = /^NR[\s-]?(\d{1,2})$/i.exec(c);
  if (nr) return { norma: `NR-${nr[1].padStart(2, '0')}`, kind: 'nr' };
  if (/^CLT$/i.test(c)) return { norma: 'CLT', kind: 'clt' };
  throw new BadRequestException('Esta fonte ainda não tem parser de dispositivos (só NR e CLT)');
}

@Injectable()
export class ProvisionsService {
  async generate(client: PoolClient, documentId: string): Promise<GenerateReport> {
    const found = await client.query<{ id: string; status: string; content_hash: string; raw_text: string; code: string | null }>(
      `SELECT d.id, d.status, d.content_hash, d.raw_text, s.code
       FROM normative_documents d JOIN official_sources s ON s.id = d.source_id
       WHERE d.id = $1`,
      [documentId],
    );
    const doc = found.rows[0];
    if (!doc) throw new NotFoundException('Documento normativo não encontrado');
    if (doc.status !== 'vigente') throw new BadRequestException('Só documentos vigentes geram dispositivos');
    const { norma, kind } = resolveKind(doc.code);

    const result = parseProvisions(doc.raw_text, kind);

    const outraVersao = await client.query(
      `SELECT 1 FROM normative_provisions WHERE document_id = $1 AND status = 'ativo' AND parser_version <> $2 LIMIT 1`,
      [documentId, PARSER_VERSION],
    );
    if (outraVersao.rows.length > 0) await markDocumentProvisionsObsolete(client, documentId);

    let inserted = 0;
    if (result.provisions.length > 0) {
      const p = result.provisions;
      const ins = await client.query(
        `INSERT INTO normative_provisions (document_id, norma, anexo, item_path, literal_text, char_start, char_end, document_hash, parser_version)
         SELECT $1, $2, t.anexo, t.item_path, t.literal_text, t.char_start, t.char_end, $3, $4
         FROM unnest($5::text[], $6::text[], $7::text[], $8::int[], $9::int[]) AS t(anexo, item_path, literal_text, char_start, char_end)
         ON CONFLICT (document_id, anexo, item_path, parser_version) DO NOTHING`,
        [
          documentId,
          norma,
          doc.content_hash,
          PARSER_VERSION,
          p.map((x) => x.anexo),
          p.map((x) => x.item_path),
          p.map((x) => x.literal_text),
          p.map((x) => x.char_start),
          p.map((x) => x.char_end),
        ],
      );
      inserted = ins.rowCount ?? 0;
    }

    return {
      document_id: documentId,
      norma,
      parser_version: PARSER_VERSION,
      found: result.provisions.length,
      inserted,
      coverage: result.coverage,
      anomalies: result.anomalies.slice(0, MAX_ANOMALIES_IN_REPORT),
    };
  }

  async list(client: PoolClient, filters: ProvisionFilters): Promise<ProvisionRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (cond: string, value: unknown) => {
      params.push(value);
      where.push(cond.replace('?', `$${params.length}`));
    };
    if (filters.documentId) add('document_id = ?', filters.documentId);
    if (filters.norma) add('norma = ?', filters.norma);
    if (filters.anexo !== undefined) add('anexo = ?', filters.anexo);
    add('status = ?', filters.status ?? 'ativo');
    params.push(Math.min(filters.limit ?? 200, 500));
    const result = await client.query<ProvisionRow>(
      `SELECT * FROM normative_provisions WHERE ${where.join(' AND ')} ORDER BY norma, anexo, char_start LIMIT $${params.length}`,
      params,
    );
    return result.rows;
  }
}
```

Ordem dos parâmetros do INSERT: `[documentId, norma, hash, versão, anexos[], item_paths[], literais[], starts[], ends[]]` (por isso o teste lê `params[5]` para os `item_path`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest --config ./test/jest-unit.json provisions-service`
Expected: PASS.

- [ ] **Step 5: Wire the lifecycle hook into the documents service**

Edit `backend/src/normative/normative-documents.service.ts`:
- import: `import { markDocumentProvisionsObsolete } from './provision-lifecycle';`
- em `finalizeApproval`, dentro de `if (previousId) {` logo após o `UPDATE ... 'substituido'`:
  ```ts
      await markDocumentProvisionsObsolete(client, previousId);
  ```
- em `retire`, depois do `if (updated.rowCount === 0) { throw ... }` e antes do `DELETE FROM normative_document_chunks`:
  ```ts
    await markDocumentProvisionsObsolete(client, documentId);
  ```

- [ ] **Step 6: Add a test for the hook and run the whole normative unit suite**

Append to `backend/test/provisions-service.unit-spec.ts`:

```ts
import { NormativeDocumentsService } from '../src/normative/normative-documents.service';

describe('gancho de obsolescência no fluxo de documentos', () => {
  it('retire() marca dispositivos do documento como obsoletos', async () => {
    const calls: string[] = [];
    const client: any = {
      query: jest.fn(async (sql: string) => {
        calls.push(sql);
        if (sql.includes('SELECT * FROM normative_documents')) return { rows: [{ id: 'd1', status: 'vigente' }] };
        return { rows: [], rowCount: 1 };
      }),
    };
    const service = new NormativeDocumentsService({} as any, {} as any);
    await service.retire(client, 'd1', 'u1', 'motivo');
    expect(calls.some((s) => s.includes("UPDATE normative_provisions SET status = 'obsoleto'"))).toBe(true);
  });
});
```

Run: `cd backend && npx jest --config ./test/jest-unit.json normative provisions tenant-context-callsites` e `npx tsc --noEmit`
Expected: tudo PASS (os specs existentes de `normative-*` e `tenant-context-callsites` seguem verdes; o mock devolve `rowCount: 1` para consultas não previstas).
Se algum spec existente quebrar por contagem de queries, ajustar **o spec existente** para aceitar as 2 queries novas e registrar o motivo no comentário.

- [ ] **Step 7: Checkpoint (sem commit)** — `git diff --stat backend/src/normative/normative-documents.service.ts` deve mostrar só o import e 2 chamadas.

---

### Task 4: Serviço das regras LIP (máquina de estados)

**Files:**
- Create: `backend/src/normative/lip-rules.service.ts`
- Test: `backend/test/lip-rules-service.unit-spec.ts`

**Interfaces:**
- Produces:
  - `type RuleStatus = 'rascunho' | 'revisada' | 'revisar' | 'retirada'`
  - `interface LipRule { id; rule_key; categoria; agente_ou_atividade; metodo_avaliacao; unidade: string | null; criterio; excecoes: string | null; dependencias: unknown[]; interpretacao; exige_revisao_profissional: boolean; vigencia_inicio: string | null; vigencia_fim: string | null; status: RuleStatus; reviewed_by_user_id: string | null; reviewed_at: string | null; reviewer_registro: string | null; created_at: string; updated_at: string }`
  - `interface RuleProvisionLink { provision_id: string; papel: 'fundamento' | 'criterio' | 'excecao' | 'metodo' }`
  - `class LipRulesService { create(client, data: CreateRuleData): Promise<LipRule>; list(client, f: { categoria?: string; status?: string }): Promise<LipRule[]>; findOne(client, id): Promise<LipRule & { provisions: ProvisionRow[] }>; update(client, id, data: UpdateRuleData): Promise<LipRule>; setProvisions(client, id, links: RuleProvisionLink[]): Promise<LipRule>; review(client, id, reviewerUserId: string, registro: string): Promise<LipRule>; retire(client, id): Promise<LipRule> }`
  - `CreateRuleData = Pick<LipRule, 'rule_key'|'categoria'|'agente_ou_atividade'|'metodo_avaliacao'|'criterio'|'interpretacao'> & Partial<Pick<LipRule, 'unidade'|'excecoes'|'dependencias'|'exige_revisao_profissional'|'vigencia_inicio'|'vigencia_fim'>>`; `UpdateRuleData = Partial<Omit<CreateRuleData, 'rule_key'>>`.
- Regras: `update`/`setProvisions` em regra `revisada` → vira `revisar`; em `retirada` → 409. `review` só a partir de `rascunho`/`revisar`, exige ≥1 dispositivo `ativo` vinculado (400) e `registro` não vazio (400). `retire` a partir de qualquer estado ≠ `retirada`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/lip-rules-service.unit-spec.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { LipRulesService } from '../src/normative/lip-rules.service';

type Call = { sql: string; params: any[] };

function montar(opts: { rule?: object | null; ativos?: number; provisoesValidas?: string[] } = {}) {
  const calls: Call[] = [];
  const rule = opts.rule === undefined ? { id: 'r1', status: 'rascunho' } : opts.rule;
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM lip_rules WHERE id')) return { rows: rule ? [rule] : [] };
      if (sql.includes('COUNT(*)')) return { rows: [{ n: String(opts.ativos ?? 0) }] };
      if (sql.includes('FROM normative_provisions WHERE id = ANY')) {
        return { rows: (opts.provisoesValidas ?? []).map((id) => ({ id })) };
      }
      if (sql.includes('UPDATE lip_rules') || sql.includes('INSERT INTO lip_rules')) return { rows: [{ id: 'r1', status: 'x' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  };
  const com = (t: string) => calls.filter((c) => c.sql.includes(t));
  return { client, calls, com, service: new LipRulesService() };
}

const NOVA = {
  rule_key: 'NR15-A1-RUIDO',
  categoria: 'insalubridade',
  agente_ou_atividade: 'Ruído contínuo ou intermitente',
  metodo_avaliacao: 'quantitativo',
  criterio: 'Ver dispositivo vinculado do Anexo 1.',
  interpretacao: 'Rascunho de interpretação.',
} as const;

describe('LipRulesService.create', () => {
  it('sempre nasce como rascunho, com exige_revisao_profissional true por padrão', async () => {
    const { service, client, com } = montar();
    await service.create(client, { ...NOVA });
    const ins = com('INSERT INTO lip_rules')[0];
    expect(ins.sql).toMatch(/'rascunho'/);
    expect(ins.params).toContain('NR15-A1-RUIDO');
    expect(ins.params).toContain(true);
  });
});

describe('LipRulesService.update', () => {
  it('regra inexistente → 404; retirada → 409', async () => {
    const vazio = montar({ rule: null });
    await expect(vazio.service.update(vazio.client, 'x', { criterio: 'a' })).rejects.toBeInstanceOf(NotFoundException);
    const m = montar({ rule: { id: 'r1', status: 'retirada' } });
    await expect(m.service.update(m.client, 'r1', { criterio: 'a' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('editar uma regra revisada a devolve para "revisar"; rascunho continua rascunho', async () => {
    const a = montar({ rule: { id: 'r1', status: 'revisada' } });
    await a.service.update(a.client, 'r1', { criterio: 'novo' });
    expect(a.com('UPDATE lip_rules')[0].sql).toMatch(/status = 'revisar'/);
    const b = montar({ rule: { id: 'r1', status: 'rascunho' } });
    await b.service.update(b.client, 'r1', { criterio: 'novo' });
    expect(b.com('UPDATE lip_rules')[0].sql).not.toMatch(/status = 'revisar'/);
  });

  it('só colunas da lista branca entram no UPDATE', async () => {
    const { service, client, com } = montar();
    await service.update(client, 'r1', { criterio: 'x', ['status' as any]: 'revisada', ['reviewed_by_user_id' as any]: 'u' });
    const sql = com('UPDATE lip_rules')[0].sql;
    expect(sql).toMatch(/criterio = \$/);
    expect(sql).not.toMatch(/reviewed_by_user_id = \$/);
  });
});

describe('LipRulesService.setProvisions', () => {
  it('rejeita dispositivo inexistente/obsoleto (só ativos valem)', async () => {
    const { service, client } = montar({ provisoesValidas: ['p1'] });
    await expect(
      service.setProvisions(client, 'r1', [
        { provision_id: 'p1', papel: 'fundamento' },
        { provision_id: 'p2', papel: 'criterio' },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('substitui os vínculos; em regra revisada devolve para "revisar"', async () => {
    const { service, client, com } = montar({ rule: { id: 'r1', status: 'revisada' }, provisoesValidas: ['p1'] });
    await service.setProvisions(client, 'r1', [{ provision_id: 'p1', papel: 'fundamento' }]);
    expect(com('DELETE FROM lip_rule_provisions')).toHaveLength(1);
    expect(com('INSERT INTO lip_rule_provisions')).toHaveLength(1);
    expect(com('UPDATE lip_rules')[0].sql).toMatch(/status = 'revisar'/);
  });
});

describe('LipRulesService.review', () => {
  it('sem dispositivo ativo vinculado → 400 e nada é atualizado', async () => {
    const { service, client, com } = montar({ ativos: 0 });
    await expect(service.review(client, 'r1', 'u1', 'CREA 0000')).rejects.toBeInstanceOf(BadRequestException);
    expect(com('UPDATE lip_rules')).toHaveLength(0);
  });

  it('registro profissional vazio → 400', async () => {
    const { service, client } = montar({ ativos: 2 });
    await expect(service.review(client, 'r1', 'u1', '   ')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('só rascunho ou revisar podem ser revisadas', async () => {
    for (const status of ['revisada', 'retirada']) {
      const m = montar({ rule: { id: 'r1', status }, ativos: 1 });
      await expect(m.service.review(m.client, 'r1', 'u1', 'CREA 0000')).rejects.toBeInstanceOf(ConflictException);
    }
  });

  it('caminho feliz: grava revisor, data e registro', async () => {
    const { service, client, com } = montar({ ativos: 1 });
    await service.review(client, 'r1', 'u1', ' CREA 0000 ');
    const up = com('UPDATE lip_rules')[0];
    expect(up.sql).toMatch(/status = 'revisada'/);
    expect(up.params).toEqual(['r1', 'u1', 'CREA 0000']);
  });
});

describe('LipRulesService.retire', () => {
  it('retira; retirar de novo → 409', async () => {
    const a = montar();
    await a.service.retire(a.client, 'r1');
    expect(a.com('UPDATE lip_rules')[0].sql).toMatch(/status = 'retirada'/);
    const b = montar({ rule: { id: 'r1', status: 'retirada' } });
    await expect(b.service.retire(b.client, 'r1')).rejects.toBeInstanceOf(ConflictException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --config ./test/jest-unit.json lip-rules-service`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Write the implementation**

Create `backend/src/normative/lip-rules.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ProvisionRow } from './provisions.service';

export type RuleStatus = 'rascunho' | 'revisada' | 'revisar' | 'retirada';
export type RulePapel = 'fundamento' | 'criterio' | 'excecao' | 'metodo';

export interface LipRule {
  id: string;
  rule_key: string;
  categoria: string;
  agente_ou_atividade: string;
  metodo_avaliacao: string;
  unidade: string | null;
  criterio: string;
  excecoes: string | null;
  dependencias: unknown[];
  interpretacao: string;
  exige_revisao_profissional: boolean;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  status: RuleStatus;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  reviewer_registro: string | null;
  created_at: string;
  updated_at: string;
}

export interface RuleProvisionLink {
  provision_id: string;
  papel: RulePapel;
}

export type CreateRuleData = Pick<LipRule, 'rule_key' | 'categoria' | 'agente_ou_atividade' | 'metodo_avaliacao' | 'criterio' | 'interpretacao'> &
  Partial<Pick<LipRule, 'unidade' | 'excecoes' | 'dependencias' | 'exige_revisao_profissional' | 'vigencia_inicio' | 'vigencia_fim'>>;

export type UpdateRuleData = Partial<Omit<CreateRuleData, 'rule_key'>>;

// Lista branca: status e campos de revisão NUNCA entram por update(); só por review()/retire().
const UPDATABLE = [
  'categoria',
  'agente_ou_atividade',
  'metodo_avaliacao',
  'unidade',
  'criterio',
  'excecoes',
  'dependencias',
  'interpretacao',
  'exige_revisao_profissional',
  'vigencia_inicio',
  'vigencia_fim',
] as const;

@Injectable()
export class LipRulesService {
  async create(client: PoolClient, data: CreateRuleData): Promise<LipRule> {
    const result = await client.query<LipRule>(
      `INSERT INTO lip_rules (rule_key, categoria, agente_ou_atividade, metodo_avaliacao, unidade, criterio, excecoes,
                              dependencias, interpretacao, exige_revisao_profissional, vigencia_inicio, vigencia_fim, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, 'rascunho') RETURNING *`,
      [
        data.rule_key,
        data.categoria,
        data.agente_ou_atividade,
        data.metodo_avaliacao,
        data.unidade ?? null,
        data.criterio,
        data.excecoes ?? null,
        JSON.stringify(data.dependencias ?? []),
        data.interpretacao,
        data.exige_revisao_profissional ?? true,
        data.vigencia_inicio ?? null,
        data.vigencia_fim ?? null,
      ],
    );
    return result.rows[0];
  }

  async list(client: PoolClient, f: { categoria?: string; status?: string }): Promise<LipRule[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.categoria) {
      params.push(f.categoria);
      where.push(`categoria = $${params.length}`);
    }
    if (f.status) {
      params.push(f.status);
      where.push(`status = $${params.length}`);
    }
    const result = await client.query<LipRule>(
      `SELECT * FROM lip_rules ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY rule_key`,
      params,
    );
    return result.rows;
  }

  private async load(client: PoolClient, id: string, forUpdate = false): Promise<LipRule> {
    const result = await client.query<LipRule>(`SELECT * FROM lip_rules WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
    const rule = result.rows[0];
    if (!rule) throw new NotFoundException('Regra não encontrada');
    return rule;
  }

  async findOne(client: PoolClient, id: string): Promise<LipRule & { provisions: (ProvisionRow & { papel: RulePapel })[] }> {
    const rule = await this.load(client, id);
    const provisions = await client.query<ProvisionRow & { papel: RulePapel }>(
      `SELECT p.*, rp.papel FROM lip_rule_provisions rp JOIN normative_provisions p ON p.id = rp.provision_id
       WHERE rp.rule_id = $1 ORDER BY p.norma, p.anexo, p.char_start`,
      [id],
    );
    return { ...rule, provisions: provisions.rows };
  }

  async update(client: PoolClient, id: string, data: UpdateRuleData): Promise<LipRule> {
    const rule = await this.load(client, id);
    if (rule.status === 'retirada') throw new ConflictException('Regra retirada não pode ser editada');
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const col of UPDATABLE) {
      if ((data as Record<string, unknown>)[col] === undefined) continue;
      const value = (data as Record<string, unknown>)[col];
      params.push(col === 'dependencias' ? JSON.stringify(value) : value);
      sets.push(`${col} = $${params.length}${col === 'dependencias' ? '::jsonb' : ''}`);
    }
    if (sets.length === 0) return rule;
    // Editar o conteúdo de uma regra já revisada invalida a revisão.
    if (rule.status === 'revisada') sets.push(`status = 'revisar'`);
    sets.push('updated_at = now()');
    const result = await client.query<LipRule>(`UPDATE lip_rules SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
    return result.rows[0];
  }

  async setProvisions(client: PoolClient, id: string, links: RuleProvisionLink[]): Promise<LipRule> {
    const rule = await this.load(client, id);
    if (rule.status === 'retirada') throw new ConflictException('Regra retirada não pode ser editada');
    const ids = [...new Set(links.map((l) => l.provision_id))];
    const valid = await client.query<{ id: string }>(
      `SELECT id FROM normative_provisions WHERE id = ANY($1::uuid[]) AND status = 'ativo'`,
      [ids],
    );
    const validIds = new Set(valid.rows.map((r) => r.id));
    const invalid = ids.filter((x) => !validIds.has(x));
    if (invalid.length > 0) throw new BadRequestException('Há dispositivos inexistentes ou obsoletos na lista');

    await client.query('DELETE FROM lip_rule_provisions WHERE rule_id = $1', [id]);
    for (const l of links) {
      await client.query(
        `INSERT INTO lip_rule_provisions (rule_id, provision_id, papel) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [id, l.provision_id, l.papel],
      );
    }
    const result = await client.query<LipRule>(
      `UPDATE lip_rules SET ${rule.status === 'revisada' ? `status = 'revisar', ` : ''}updated_at = now() WHERE id = $1 RETURNING *`,
      [id],
    );
    return result.rows[0];
  }

  async review(client: PoolClient, id: string, reviewerUserId: string, registro: string): Promise<LipRule> {
    const rule = await this.load(client, id);
    if (rule.status !== 'rascunho' && rule.status !== 'revisar') {
      throw new ConflictException('Só regras em rascunho ou a revisar podem ser marcadas como revisadas');
    }
    const reg = registro.trim();
    if (!reg) throw new BadRequestException('Informe o registro do profissional habilitado');
    const ativos = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM lip_rule_provisions rp JOIN normative_provisions p ON p.id = rp.provision_id
       WHERE rp.rule_id = $1 AND p.status = 'ativo'`,
      [id],
    );
    if (Number(ativos.rows[0].n) < 1) {
      throw new BadRequestException('Vincule ao menos um dispositivo literal ativo antes de marcar a regra como revisada');
    }
    const result = await client.query<LipRule>(
      `UPDATE lip_rules
       SET status = 'revisada', reviewed_by_user_id = $2, reviewed_at = now(), reviewer_registro = $3, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, reviewerUserId, reg],
    );
    return result.rows[0];
  }

  async retire(client: PoolClient, id: string): Promise<LipRule> {
    const rule = await this.load(client, id);
    if (rule.status === 'retirada') throw new ConflictException('A regra já está retirada');
    const result = await client.query<LipRule>(
      `UPDATE lip_rules SET status = 'retirada', updated_at = now() WHERE id = $1 RETURNING *`,
      [id],
    );
    return result.rows[0];
  }
}
```

Observação para o executor: o teste "caminho feliz" espera `up.params` igual a `['r1','u1','CREA 0000']` — coincide com a ordem acima ($1 id, $2 revisor, $3 registro).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest --config ./test/jest-unit.json lip-rules-service && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Checkpoint (sem commit)** — `git status --short backend/src/normative backend/test`.

---

### Task 5: DTOs, controllers e registro no módulo

**Files:**
- Create: `backend/src/normative/dto/create-lip-rule.dto.ts`, `update-lip-rule.dto.ts`, `set-rule-provisions.dto.ts`, `review-lip-rule.dto.ts`
- Create: `backend/src/normative/provisions.controller.ts`, `backend/src/normative/lip-rules.controller.ts`
- Modify: `backend/src/normative/normative.module.ts`
- Test: `backend/test/lip-rules-controller.unit-spec.ts`

**Interfaces:**
- Consumes: `ProvisionsService`, `LipRulesService` (Tasks 3–4).
- Produces rotas (todas `@Roles('admin')`):
  - `GET /normative-provisions?documentId=&norma=&anexo=&status=&limit=`
  - `POST /normative-provisions/generate/:documentId`
  - `GET /lip-rules?categoria=&status=`, `GET /lip-rules/:id`, `POST /lip-rules`, `PATCH /lip-rules/:id`, `PUT /lip-rules/:id/provisions`, `POST /lip-rules/:id/review`, `POST /lip-rules/:id/retire`

- [ ] **Step 1: Write the failing test**

Create `backend/test/lip-rules-controller.unit-spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { CreateLipRuleDto } from '../src/normative/dto/create-lip-rule.dto';
import { ReviewLipRuleDto } from '../src/normative/dto/review-lip-rule.dto';
import { SetRuleProvisionsDto } from '../src/normative/dto/set-rule-provisions.dto';
import { UpdateLipRuleDto } from '../src/normative/dto/update-lip-rule.dto';
import { LipRulesController } from '../src/normative/lip-rules.controller';
import { ProvisionsController } from '../src/normative/provisions.controller';
import { Reflector } from '@nestjs/core';

const erros = async (Classe: any, dados: object) => (await validate(plainToInstance(Classe, dados))).map((e) => e.property);

const valida = {
  rule_key: 'NR15-A1-RUIDO',
  categoria: 'insalubridade',
  agente_ou_atividade: 'Ruído',
  metodo_avaliacao: 'quantitativo',
  criterio: 'Ver dispositivo.',
  interpretacao: 'Rascunho.',
};

describe('DTOs de regra LIP', () => {
  it('cadastro válido não tem erros', async () => expect(await erros(CreateLipRuleDto, valida)).toEqual([]));

  it('rejeita categoria, método e rule_key inválidos', async () => {
    expect(await erros(CreateLipRuleDto, { ...valida, categoria: 'outra' })).toContain('categoria');
    expect(await erros(CreateLipRuleDto, { ...valida, metodo_avaliacao: 'chute' })).toContain('metodo_avaliacao');
    expect(await erros(CreateLipRuleDto, { ...valida, rule_key: 'minúscula com espaço' })).toContain('rule_key');
  });

  it('edição: tudo opcional, o que vier é validado, e rule_key/status não existem no DTO', async () => {
    expect(await erros(UpdateLipRuleDto, {})).toEqual([]);
    expect(await erros(UpdateLipRuleDto, { categoria: 'x' })).toContain('categoria');
    expect(Object.keys(new UpdateLipRuleDto())).not.toContain('rule_key');
  });

  it('vínculos: papel válido, uuid, lista não vazia', async () => {
    const ok = { links: [{ provision_id: '3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b', papel: 'fundamento' }] };
    expect(await erros(SetRuleProvisionsDto, ok)).toEqual([]);
    expect(await erros(SetRuleProvisionsDto, { links: [] })).toContain('links');
    expect(await erros(SetRuleProvisionsDto, { links: [{ provision_id: 'x', papel: 'fundamento' }] })).toContain('links');
  });

  it('revisão exige registro profissional', async () => {
    expect(await erros(ReviewLipRuleDto, {})).toContain('registro');
    expect(await erros(ReviewLipRuleDto, { registro: 'CREA 0000' })).toEqual([]);
  });
});

describe('controllers — somente admin', () => {
  const reflector = new Reflector();
  const rotas = (Classe: any) =>
    Object.getOwnPropertyNames(Classe.prototype).filter((n) => n !== 'constructor');

  it.each([ProvisionsController, LipRulesController])('%p: toda rota é @Roles("admin")', (Classe: any) => {
    for (const nome of rotas(Classe)) {
      expect(reflector.get(ROLES_KEY, Classe.prototype[nome])).toEqual(['admin']);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --config ./test/jest-unit.json lip-rules-controller`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Write DTOs**

`backend/src/normative/dto/create-lip-rule.dto.ts`:

```ts
import { IsArray, IsBoolean, IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export const CATEGORIAS = ['insalubridade', 'periculosidade', 'prevencao', 'previdenciario'] as const;
export const METODOS = ['quantitativo', 'qualitativo', 'misto', 'nao_aplicavel'] as const;

export class CreateLipRuleDto {
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_.-]{2,79}$/, { message: 'rule_key deve ter 3-80 caracteres: A-Z, 0-9, _ . -' })
  rule_key: string;

  @IsIn(CATEGORIAS)
  categoria: (typeof CATEGORIAS)[number];

  @IsString() @IsNotEmpty() @MaxLength(300)
  agente_ou_atividade: string;

  @IsIn(METODOS)
  metodo_avaliacao: (typeof METODOS)[number];

  @IsOptional() @IsString() @MaxLength(100)
  unidade?: string;

  @IsString() @IsNotEmpty() @MaxLength(5000)
  criterio: string;

  @IsOptional() @IsString() @MaxLength(5000)
  excecoes?: string;

  @IsOptional() @IsArray()
  dependencias?: unknown[];

  @IsString() @IsNotEmpty() @MaxLength(10000)
  interpretacao: string;

  @IsOptional() @IsBoolean()
  exige_revisao_profissional?: boolean;

  @IsOptional() @IsDateString()
  vigencia_inicio?: string;

  @IsOptional() @IsDateString()
  vigencia_fim?: string;
}
```

`backend/src/normative/dto/update-lip-rule.dto.ts`:

```ts
import { IsArray, IsBoolean, IsDateString, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { CATEGORIAS, METODOS } from './create-lip-rule.dto';

// Sem rule_key e sem status: a chave é imutável e o status só muda por review()/retire().
export class UpdateLipRuleDto {
  @IsOptional() @IsIn(CATEGORIAS)
  categoria?: (typeof CATEGORIAS)[number];

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(300)
  agente_ou_atividade?: string;

  @IsOptional() @IsIn(METODOS)
  metodo_avaliacao?: (typeof METODOS)[number];

  @IsOptional() @IsString() @MaxLength(100)
  unidade?: string;

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(5000)
  criterio?: string;

  @IsOptional() @IsString() @MaxLength(5000)
  excecoes?: string;

  @IsOptional() @IsArray()
  dependencias?: unknown[];

  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(10000)
  interpretacao?: string;

  @IsOptional() @IsBoolean()
  exige_revisao_profissional?: boolean;

  @IsOptional() @IsDateString()
  vigencia_inicio?: string;

  @IsOptional() @IsDateString()
  vigencia_fim?: string;
}
```

`backend/src/normative/dto/set-rule-provisions.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsUUID, ValidateNested } from 'class-validator';

export class RuleProvisionLinkDto {
  @IsUUID()
  provision_id: string;

  @IsIn(['fundamento', 'criterio', 'excecao', 'metodo'])
  papel: 'fundamento' | 'criterio' | 'excecao' | 'metodo';
}

export class SetRuleProvisionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RuleProvisionLinkDto)
  links: RuleProvisionLinkDto[];
}
```

`backend/src/normative/dto/review-lip-rule.dto.ts`:

```ts
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReviewLipRuleDto {
  // Identificação do profissional habilitado (ex.: "CREA-SP 000000" / "MTE 0000"). Texto livre revisado por humano.
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  registro: string;
}
```

- [ ] **Step 4: Write controllers**

`backend/src/normative/provisions.controller.ts`:

```ts
import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { ProvisionsService } from './provisions.service';

@Controller('normative-provisions')
export class ProvisionsController {
  constructor(private readonly provisions: ProvisionsService) {}

  @Roles('admin')
  @Get()
  list(
    @Query('documentId') documentId: string | undefined,
    @Query('norma') norma: string | undefined,
    @Query('anexo') anexo: string | undefined,
    @Query('status') status: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) =>
      this.provisions.list(client, {
        documentId,
        norma,
        anexo,
        status: status === 'obsoleto' ? 'obsoleto' : 'ativo',
        limit: limit ? Number(limit) || undefined : undefined,
      }),
    );
  }

  @Roles('admin')
  @Post('generate/:documentId')
  generate(@Param('documentId', ParseUUIDPipe) documentId: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.provisions.generate(client, documentId));
  }
}
```

`backend/src/normative/lip-rules.controller.ts`:

```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateLipRuleDto } from './dto/create-lip-rule.dto';
import { ReviewLipRuleDto } from './dto/review-lip-rule.dto';
import { SetRuleProvisionsDto } from './dto/set-rule-provisions.dto';
import { UpdateLipRuleDto } from './dto/update-lip-rule.dto';
import { LipRulesService } from './lip-rules.service';

const PIPE = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

@Controller('lip-rules')
export class LipRulesController {
  constructor(private readonly rules: LipRulesService) {}

  @Roles('admin')
  @Get()
  list(@Query('categoria') categoria: string | undefined, @Query('status') status: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.rules.list(client, { categoria, status }));
  }

  @Roles('admin')
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.rules.findOne(client, id));
  }

  @Roles('admin')
  @UsePipes(PIPE)
  @Post()
  create(@Body() dto: CreateLipRuleDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.rules.create(client, dto));
  }

  @Roles('admin')
  @UsePipes(PIPE)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLipRuleDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.rules.update(client, id, dto));
  }

  @Roles('admin')
  @UsePipes(PIPE)
  @Put(':id/provisions')
  setProvisions(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRuleProvisionsDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.rules.setProvisions(client, id, dto.links));
  }

  @Roles('admin')
  @UsePipes(PIPE)
  @Post(':id/review')
  review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewLipRuleDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.rules.review(client, id, req.user.id, dto.registro));
  }

  @Roles('admin')
  @Post(':id/retire')
  retire(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.rules.retire(client, id));
  }
}
```

- [ ] **Step 5: Register in the module**

Edit `backend/src/normative/normative.module.ts`: importar `ProvisionsController`, `LipRulesController`, `ProvisionsService`, `LipRulesService`; acrescentar os controllers a `controllers: [...]` e os services a `providers: [...]`.

- [ ] **Step 6: Run tests, typecheck, build**

Run: `cd backend && npx jest --config ./test/jest-unit.json lip-rules-controller && npx tsc --noEmit && npm run build`
Expected: PASS; sem erro de tipo; build limpo.

- [ ] **Step 7: Run isolation guard + full unit suite**

Run: `cd backend && npm run test:unit`
Expected: todos PASS, incluindo `tenant-context-callsites` (nenhum `withTenantContext` novo com contexto escolhido pelo chamador).

- [ ] **Step 8: Checkpoint (sem commit)** — `git status --short`.

---

### Task 6: Comando manual de geração de dispositivos (dry-run por padrão)

**Files:**
- Create: `backend/db/generate-provisions.ts`
- Modify: `backend/package.json` (script `"db:generate-provisions": "tsx db/generate-provisions.ts"`, ao lado de `db:reseed-normative-sources`)
- Test: `backend/test/provision-parser.unit-spec.ts` (acrescentar o teste de relatório abaixo)

**Interfaces:**
- Consumes: `parseProvisions`, `PARSER_VERSION` (Task 1); `ProvisionsService.generate` (Task 3).
- Produces: CLI `npm run db:generate-provisions -- <documentId> [--apply]` e `parseArgs(argv)`. Sem `--apply` **só lê e imprime** o relatório (cobertura, contagem por anexo, anomalias); nada é escrito. Requer `resolveKind` exportado de `provisions.service.ts`.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/provision-parser.unit-spec.ts`:

```ts
import { formatCoverageReport, parseArgs } from '../db/generate-provisions';

describe('formatCoverageReport', () => {
  it('resume cobertura, contagem por anexo e anomalias em texto', () => {
    const r = parseProvisions('ANEXO Nº 1\n1.1 Texto A.\nANEXO Nº 3\n3.1 Texto B.\n3.2 Texto C.', 'nr');
    const txt = formatCoverageReport('NR-15', r);
    expect(txt).toMatch(/NR-15/);
    expect(txt).toMatch(/dispositivos: 3/);
    expect(txt).toMatch(/anexo 1: 1/);
    expect(txt).toMatch(/anexo 3: 2/);
    expect(txt).toMatch(/cobertura: \d+%/);
  });
});

describe('parseArgs', () => {
  it('--apply em qualquer posição; o documento é o primeiro argumento sem --', () => {
    expect(parseArgs(['--apply', 'abc'])).toEqual({ documentId: 'abc', apply: true });
    expect(parseArgs(['abc'])).toEqual({ documentId: 'abc', apply: false });
    expect(parseArgs([])).toEqual({ documentId: undefined, apply: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --config ./test/jest-unit.json provision-parser`
Expected: FAIL — `Cannot find module '../db/generate-provisions'`.

- [ ] **Step 3: Write the script**

Create `backend/db/generate-provisions.ts`:

```ts
import { Client } from 'pg';
import { PoolClient } from 'pg';
import { ParseResult, parseProvisions } from '../src/normative/provision-parser';
import { ProvisionsService, resolveKind } from '../src/normative/provisions.service';

// Comando manual, mesmo padrão de db/reseed-normative-sources.ts (standalone, sem Nest DI).
// Dry-run por padrão e SOMENTE LEITURA: lê o documento numa transação READ ONLY e imprime o relatório de
// cobertura do parser em memória; não chama o gerador e não toma lock de escrita. Só --apply grava,
// e só com autorização do proprietário (AGENTS.md).
export function formatCoverageReport(norma: string, r: ParseResult): string {
  const porAnexo = new Map<string, number>();
  for (const p of r.provisions) porAnexo.set(p.anexo || '(corpo)', (porAnexo.get(p.anexo || '(corpo)') ?? 0) + 1);
  const linhas = [
    `${norma} — dispositivos: ${r.provisions.length} | cobertura: ${Math.round(r.coverage * 100)}% | anomalias: ${r.anomalies.length}`,
    ...[...porAnexo.entries()].map(([a, n]) => `  anexo ${a}: ${n}`),
    ...r.anomalies.slice(0, 20).map((a) => `  ! ${a.kind} ${a.detail} (linha ${a.line})`),
  ];
  return linhas.join('\n');
}

export function parseArgs(argv: string[]): { documentId: string | undefined; apply: boolean } {
  return { documentId: argv.find((a) => !a.startsWith('--')), apply: argv.includes('--apply') };
}

async function main() {
  const { documentId, apply } = parseArgs(process.argv.slice(2));
  if (!documentId) throw new Error('uso: npm run db:generate-provisions -- <documentId> [--apply]');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não definida');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (apply) {
      await client.query('BEGIN');
      const report = await new ProvisionsService().generate(client as unknown as PoolClient, documentId);
      await client.query('COMMIT');
      console.log(
        `[apply] gravado: ${report.norma} v=${report.parser_version} encontrados=${report.found} inseridos=${report.inserted} cobertura=${Math.round(report.coverage * 100)}%`,
      );
      report.anomalies.slice(0, 20).forEach((a) => console.log(`  ! ${a.kind} ${a.detail} (linha ${a.line})`));
      return;
    }
    await client.query('BEGIN READ ONLY');
    const found = await client.query<{ status: string; raw_text: string; code: string | null }>(
      `SELECT d.status, d.raw_text, s.code FROM normative_documents d JOIN official_sources s ON s.id = d.source_id WHERE d.id = $1`,
      [documentId],
    );
    await client.query('ROLLBACK');
    const doc = found.rows[0];
    if (!doc) throw new Error('documento não encontrado');
    const { norma, kind } = resolveKind(doc.code);
    console.log(formatCoverageReport(norma, parseProvisions(doc.raw_text, kind)));
    if (doc.status !== 'vigente') console.log(`! o documento está "${doc.status}": --apply só aceita documentos vigentes`);
    console.log('[dry-run] somente leitura; nada foi gravado (use --apply com autorização)');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
```

Nota (ruling pós-revisão): o dry-run é SOMENTE LEITURA (`BEGIN READ ONLY` + parser em memória); só `--apply` chama `generate()`. Rodar o gerador em transação com ROLLBACK tomaria locks de escrita em banco possivelmente de produção.

- [ ] **Step 4: Add the npm script and run tests**

Edit `backend/package.json`: adicionar `"db:generate-provisions": "tsx db/generate-provisions.ts",` junto aos demais `db:*`.
Run: `cd backend && npx jest --config ./test/jest-unit.json provision-parser && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Smoke test no banco descartável**

No container descartável, com a migration 0072 aplicada e um documento `vigente` da NR-15 carregado (via `db:reseed-normative-sources` **no descartável**): `npm run db:generate-provisions -- <id>`
Expected: imprime `NR-15 ... cobertura≈67%` (referência do protótipo) e `[dry-run] nada foi gravado`; `SELECT count(*) FROM normative_provisions` continua 0.

- [ ] **Step 6: Checkpoint (sem commit).**

---

### Task 7: Runbook de ingestão das fontes do LIP (documento; sem execução)

**Files:**
- Create: `docs/operations/runbook-ingestao-lip.md`

Esta task só escreve o runbook; **nenhum passo dele é executado pelo agente sem o "pode" do proprietário**, um a um.

- [ ] **Step 1: Write the runbook**

Create `docs/operations/runbook-ingestao-lip.md` com o conteúdo abaixo (copiar integralmente):

````markdown
# Runbook — ingestão das fontes oficiais do LIP

> Origem: spec `docs/superpowers/specs/2026-10-09-base-normativa-lip-design.md`. Marcadores: VERIFICADO / NÃO VERIFICADO / RECOMENDADO.
> **Cada passo que grava em produção exige "pode" explícito do proprietário e backup antes (`bash ops/backup-postgres.sh`).** Nunca `docker compose down -v`.

## 0. O que já existe (VERIFICADO em 2026-10-09)

- `backend/db/seed-data/normative-sources/manifest.json` tem 36 NRs (NR-01, 03–26, 28–38), texto conferido por hash contra produção. Cobrem as NRs de apoio do LIP: **01, 06, 07, 09, 10, 15, 16, 17, 20, 23**.
- Os **anexos da NR-15 e da NR-16 estão no mesmo texto da norma** (uma fonte por NR; não cadastrar uma fonte por anexo).
- **Não há** no manifesto: **CLT (arts. 189–197)** e **NHOs da Fundacentro**. Estas precisam de fonte nova.
- **ALERTA (VERIFICADO no texto):** o `NR-15.txt` do manifesto lista alterações só até a Portaria SEPRT nº 1.359/2019 e traz "Este texto não substitui o publicado no DOU". Antes de tratá-lo como base vigente do LIP, **comparar com a página oficial atual do MTE** (passo 2). Idem NR-16 (o seu material cita atos até a Portaria MTE nº 2.021/2025 — NÃO VERIFICADO).

## 1. Cadastro das fontes novas (CLT, NHOs) — RECOMENDADO

1. Obter do proprietário/oficial as URLs: CLT (Planalto), catálogo de NHO (Fundacentro). **Não escolher URL de memória.**
2. Pela tela `/admin/normativa` (Fontes → "testar URL"), ou `POST /normative-sources/preview`: confirmar status 200, tipo de conteúdo e amostra de texto sem aviso de extração suspeita.
3. Cadastrar (`code`: `CLT`; NHO: `NHO 01`…). O parser de dispositivos só cobre `NR-xx` e `CLT` nesta entrega; NHO fica como fonte/RAG sem dispositivos até existir parser.
4. Páginas-portal ("todas as NRs", portal do PGR, manuais eSocial): **não cadastrar como ativas** (decisão A da spec); servem só para conferência manual.

## 2. Conferir vigência das NRs já presentes

1. Para NR-15, NR-16 (e NR-01, 06, 07, 09, 10, 17, 20, 23): rodar o monitor/“verificar agora” da tela. Documento novo aparece como `aguardando_validacao` com diff de parágrafos.
2. O proprietário revisa o diff e aprova ou rejeita **um por vez**.
3. Registrar a data de verificação (fica em `official_sources.last_checked_at`). Datas de vigência citadas em material externo só valem se aparecerem no texto oficial.

## 3. Aprovação e indexação

1. Aprovar na tela existente (`/normative-documents/:id/approve`) — indexação vetorial depende do crédito de embeddings (OpenRouter). **Sem crédito, a aprovação falha na indexação**; resolver antes (decisão C da spec) ou adiar a aprovação.
2. Documento aprovado vira `vigente` e o anterior `substituido` (o gancho marca dispositivos antigos `obsoleto` e regras `revisada` ligadas voltam a `revisar`).

## 4. Geração de dispositivos

1. Dry-run (não grava): `npm run db:generate-provisions -- <documentId>` — conferir cobertura e anomalias.
   Referência do protótipo (2026-10-09): NR-15 ≈ 296 dispositivos / 67%; NR-16 ≈ 80 / 90%; NR-01 ≈ 162 / 95%.
2. Anomalias `item_ambiguo`/`anexo_repetido` são esperadas (sumários, sub-anexos). Revisar as de anexos do LIP (NR-15 anexos 1, 2, 3, 8, 11, 12; NR-16 todos) e decidir se o parser precisa de ajuste (nova `PARSER_VERSION`).
3. Com autorização: `npm run db:generate-provisions -- <documentId> --apply` (ou `POST /normative-provisions/generate/:documentId`).

## 5. Matriz de regras (rascunhos)

1. Criar regras por `POST /lip-rules` (nascem `rascunho`), a partir do texto dos dispositivos gerados.
2. Vincular dispositivos: `PUT /lip-rules/:id/provisions`.
3. Revisão pelo responsável técnico: `POST /lip-rules/:id/review` com o registro profissional. Sem dispositivo ativo vinculado, o sistema recusa.
4. Percentuais (art. 192) e 30% (art. 193 §1º): são **dispositivos literais** da CLT; a regra de cálculo fica com `exige_revisao_profissional = true`.

## 6. Pendências de decisão do proprietário

A. Páginas-portal: não cadastrar (RECOMENDADO) ou cadastrar inativas.
B. Nome e registro do(s) profissional(is) revisor(es).
C. Crédito dos embeddings (OpenRouter) ou troca de provedor (exige autorização — AGENTS.md).
````

- [ ] **Step 2: Checkpoint (sem commit)** — `git status --short docs/operations`.

---

### Task 8: Alinhar a spec e verificação final

**Files:**
- Modify: `docs/superpowers/specs/2026-10-09-base-normativa-lip-design.md`

- [ ] **Step 1: Atualizar a spec com os desvios e achados**

Em `docs/superpowers/specs/2026-10-09-base-normativa-lip-design.md`:
- §3.1: trocar `anexo (nullable)` por `anexo text NOT NULL DEFAULT ''` e remover `heading (nullable)` da lista de campos; acrescentar "UNIQUE `(document_id, anexo, item_path, parser_version)`".
- §4: acrescentar "As NRs 01, 06, 07, 09, 10, 15, 16, 17, 20 e 23 já existem no `seed-data/normative-sources/manifest.json`; os anexos da NR-15/16 estão no mesmo texto (uma fonte por NR). Faltam CLT e NHOs. O texto do manifesto da NR-15 lista alterações só até 2019: conferir vigência antes de usar (runbook)."
- §5: acrescentar "Colisões de chave: título curto de sumário perde para o do corpo (que tem filhos); caso ambíguo grava nenhum e vai a `anomalies`. Medição de referência: NR-15 ≈ 296/67%, NR-16 ≈ 80/90%, NR-01 ≈ 162/95%."

- [ ] **Step 2: Verificação final completa**

Run (no host): `cd backend && npx tsc --noEmit && npm run build && npm run test:unit`
Run (container descartável, migration 0072 aplicada): `npx jest --config ./test/jest-e2e.json --runInBand lip-normative-base normative-documents-approval`
Run (container descartável): `npm run test:isolation`
Expected: tudo PASS; relatar a saída real de cada comando (VERIFICADO) e o que não pôde ser rodado (NÃO VERIFICADO).

- [ ] **Step 3: Relatório ao proprietário**

Entregar: arquivos criados/alterados, resultado dos comandos acima, o que **não** foi feito (migration em produção, ingestão, geração `--apply`, regras), e as 3 decisões pendentes (A, B, C). **Não commitar.**

---

## Self-review (spec × plano)

- §3.1 `normative_provisions` → Tasks 1–3 (parser, migration, serviço). §3.2/3.3 regras e vínculos → Tasks 2, 4, 5. §3.4 invalidação por versão → Task 3 (gancho + teste).
- §4 fontes/ingestão → Task 7 (runbook; execução condicionada a autorização). Achado novo (NRs já no manifesto, anexos no mesmo texto, NR-15 desatualizada) → Tasks 7–8.
- §5 parser → Task 1. Relatório de cobertura → Tasks 3 e 6.
- §6 conteúdo das regras (matriz) → deliberadamente **fora das tasks de código**: depende dos textos ingeridos e da revisão profissional; o runbook (passo 5) descreve o fluxo. Sem rascunhos redigidos de memória.
- §7 consumo (Assistente/Auditoria) → fora desta rodada, como na spec; esta entrega expõe só a API admin.
- §8 segurança → constraints globais + teste estático + e2e "sem tenant_id" + `tenant-context-callsites`.
- §9 testes → unit (parser, serviços, DTOs/roles, migration estática), e2e em banco descartável, typecheck, build, isolamento.
- Consistência de tipos: `ProvisionRow` (Task 3) é usado em Task 4; `GenerateReport`/`ParseAnomaly` usados em Tasks 3 e 6; `CATEGORIAS`/`METODOS` definidos no DTO de criação e reutilizados no de edição; `PARSER_VERSION` único.
