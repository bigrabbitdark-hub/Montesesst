# Monitor normativo — revisar melhor (fatia 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Revisar uma versão normativa lendo só o que mudou (diff por parágrafos), rejeitar vários pendentes de uma vez e retirar um documento vigente do Assistente, tudo pela tela `/admin/normativa`.

**Architecture:** Utilitário puro `paragraph-diff.util.ts` (sem dependência) + três métodos novos em `NormativeDocumentsService` (`diffForDocument`, `rejectBatch`, `retire`) + três rotas em `NormativeDocumentsController`. No frontend, `DiffView.tsx` e mudanças em `page.tsx` (seleção em lote, botão "Retirar", diff na revisão).

**Spec:** `docs/superpowers/specs/2026-10-09-monitor-normativo-revisao-design.md` (decisões A e B: retirar via `rejeitado` com prefixo "Retirada:", sem migration; lote de até 50).

## Global Constraints

- **Sem migration**, sem env nova, sem dependência nova (`package.json` não muda), sem mudança de Docker/Nginx/RLS.
- Comandos do backend em `/opt/Montese/backend`; do frontend em `/opt/Montese/frontend`; sempre com `timeout`.
- **Sem `git commit/add/push/reset/revert/stash`** (AGENTS.md). Onde o skill diria "commit", faça só `git status --short <caminho>`. A árvore tem WIP de outras frentes (`backend/src/pente-fino/*`, `docker-compose.yml`, `PenteFinoPanel*`, docs de eSocial): **nunca** `git add -A`, nunca tocar neles.
- **e2e usam o banco de produção: não rodar.** Testes novos são unitários com cliente/`req` falsos. Nunca ler/escrever o banco de produção neste plano.
- **Aprovação em lote não existe e não deve ser criada**: aprovar exige leitura humana de cada versão. Nenhuma rota nova aprova ou publica norma; `retire` e `reject-batch` só tiram coisas do caminho.
- Texto do documento é **texto extraído**: a tela o exibe como texto React (nunca `dangerouslySetInnerHTML`).
- Suíte unitária do backend: 8 suítes já falham no HEAD limpo (`company-document-indexer`, `document-checklist-extractor`, `lip-agent-extractor`, `pdf-text-full`, `pdf-text`, `pente-fino-comparison`, `pente-fino-extractor`, `r2-get-object`). A comparação confiável é HEAD limpo + só esta fatia vs HEAD limpo.
- Testes de página: router estável (`const router = vi.hoisted(() => ({ push: vi.fn() }))`); convenção do admin (`adm-*` sem `rounded/bg/border/padding/fonte/cor` indevidos, `convencoes-paginas.test.ts`); tema escuro mantido. Os testes existentes `normativa-page.test.tsx` e `normativa-fontes.test.tsx` devem continuar passando; se a nova chamada de diff quebrar o mock deles, ajuste o **componente** para tratar falha do diff (cair no lado a lado) antes de mexer em teste.
- Comentários em PT-BR, curtos. Mensagens ao usuário em PT-BR.

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/src/normative/paragraph-diff.util.ts` | criar | `splitParagraphs`, `diffParagraphs` |
| `backend/test/paragraph-diff.unit-spec.ts` | criar | Testes do diff (inclui desempenho) |
| `backend/src/normative/normative-documents.service.ts` | modificar | `diffForDocument`, `rejectBatch`, `retire` |
| `backend/src/normative/dto/reject-batch.dto.ts`, `dto/retire-document.dto.ts` | criar | DTOs |
| `backend/src/normative/normative-documents.controller.ts` | modificar | `GET :id/diff`, `POST reject-batch`, `POST :id/retire` |
| `backend/test/normative-documents-review.unit-spec.ts` | criar | Serviço (cliente falso), controller (`req` falso), DTOs, roles |
| `frontend/src/app/admin/normativa/DiffView.tsx` | criar | Lista de trechos do diff |
| `frontend/src/app/admin/normativa/page.tsx` | modificar | Seleção em lote, Retirar, diff na revisão |
| `frontend/src/app/admin/__tests__/normativa-revisao.test.tsx` | criar | Testes da tela |
| `frontend/src/app/admin/__tests__/convencoes-paginas.test.ts` | modificar (só `PAGINAS`) | Inclui `normativa/DiffView.tsx` |

---

### Task 1: Diff por parágrafos (utilitário puro)

**Files:** Create `backend/src/normative/paragraph-diff.util.ts`, `backend/test/paragraph-diff.unit-spec.ts`.

**Interfaces — Produces:**
- `type DiffKind = 'added' | 'removed' | 'context'`
- `interface DiffHunk { kind: DiffKind; text: string }`
- `interface ParagraphDiff { summary: { added: number; removed: number; unchanged: number }; truncated: boolean; hunks: DiffHunk[] }`
- `splitParagraphs(text: string): string[]`
- `diffParagraphs(oldText: string, newText: string): ParagraphDiff`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { diffParagraphs, splitParagraphs } from '../src/normative/paragraph-diff.util';

const texto = (...ps: string[]) => ps.join('\n');

describe('splitParagraphs', () => {
  it('quebra por linha, colapsa espaços, descarta vazios', () => {
    expect(splitParagraphs('  Art. 1º   Fica\n\n\nArt. 2º  \n')).toEqual(['Art. 1º Fica', 'Art. 2º']);
  });
  it('texto vazio dá lista vazia', () => {
    expect(splitParagraphs('  \n \n')).toEqual([]);
  });
});

describe('diffParagraphs', () => {
  it('textos iguais: sem alterações', () => {
    const d = diffParagraphs(texto('a', 'b', 'c'), texto('a', 'b', 'c'));
    expect(d.summary).toEqual({ added: 0, removed: 0, unchanged: 3 });
    expect(d.hunks.filter((h) => h.kind !== 'context')).toEqual([]);
    expect(d.truncated).toBe(false);
  });

  it('um parágrafo alterado vira 1 removido + 1 adicionado, com contexto', () => {
    const d = diffParagraphs(texto('a', 'b', 'c', 'd'), texto('a', 'B', 'c', 'd'));
    expect(d.summary).toEqual({ added: 1, removed: 1, unchanged: 3 });
    const mudancas = d.hunks.filter((h) => h.kind !== 'context');
    expect(mudancas).toEqual([
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
    ]);
    expect(d.hunks.some((h) => h.kind === 'context' && h.text === 'a')).toBe(true);
  });

  it('parágrafo inserido no meio e outro removido', () => {
    const d = diffParagraphs(texto('a', 'b', 'c', 'd', 'e'), texto('a', 'b', 'NOVO', 'c', 'e'));
    expect(d.summary).toEqual({ added: 1, removed: 1, unchanged: 4 });
    expect(d.hunks.filter((h) => h.kind === 'added').map((h) => h.text)).toEqual(['NOVO']);
    expect(d.hunks.filter((h) => h.kind === 'removed').map((h) => h.text)).toEqual(['d']);
  });

  it('ignora diferença só de espaços', () => {
    const d = diffParagraphs('Art.  1º  Fica', 'Art. 1º Fica');
    expect(d.summary).toEqual({ added: 0, removed: 0, unchanged: 1 });
  });

  it('sem versão anterior (texto antigo vazio): tudo adicionado', () => {
    const d = diffParagraphs('', texto('a', 'b'));
    expect(d.summary).toEqual({ added: 2, removed: 0, unchanged: 0 });
  });

  it('blocos grandes sem mudança viram um único contexto resumido', () => {
    const base = Array.from({ length: 50 }, (_, i) => `p${i}`);
    const novo = [...base];
    novo[25] = 'MUDOU';
    const d = diffParagraphs(base.join('\n'), novo.join('\n'));
    expect(d.hunks.length).toBeLessThan(12);
    expect(d.hunks.some((h) => h.kind === 'context' && /parágrafos sem mudança/.test(h.text))).toBe(true);
  });

  it('limita a 500 trechos alterados e marca truncated', () => {
    const velho = Array.from({ length: 600 }, (_, i) => `velho ${i}`).join('\n');
    const novo = Array.from({ length: 600 }, (_, i) => `novo ${i}`).join('\n');
    const d = diffParagraphs(velho, novo);
    expect(d.summary.removed).toBe(600);
    expect(d.summary.added).toBe(600);
    expect(d.hunks.filter((h) => h.kind !== 'context').length).toBeLessThanOrEqual(500);
    expect(d.truncated).toBe(true);
  });

  it('documento enorme (miolo acima de 4 M células): cai para diferença sem ordem e marca truncated', () => {
    const n = 2500;
    const velho = Array.from({ length: n }, (_, i) => `v${i}`);
    const novo = Array.from({ length: n }, (_, i) => `n${i}`);
    novo[10] = 'v10'; // um parágrafo em comum, para provar que não vira tudo "novo"
    const d = diffParagraphs(velho.join('\n'), novo.join('\n'));
    expect(d.truncated).toBe(true);
    expect(d.summary.unchanged).toBe(1);
    expect(d.summary.removed).toBe(n - 1);
    expect(d.summary.added).toBe(n - 1);
  });

  it('desempenho: 20 mil parágrafos com ~40 mudanças dispersas roda em menos de 3 s', () => {
    const base = Array.from({ length: 20000 }, (_, i) => `Parágrafo número ${i} do texto normativo.`);
    const novo = [...base];
    for (let i = 0; i < 40; i++) novo[i * 500] = `ALTERADO ${i}`;
    const inicio = Date.now();
    const d = diffParagraphs(base.join('\n'), novo.join('\n'));
    expect(Date.now() - inicio).toBeLessThan(3000);
    expect(d.summary.added).toBe(40);
    expect(d.summary.removed).toBe(40);
    expect(d.truncated).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /opt/Montese/backend && timeout 180 npx jest --config ./test/jest-unit.json paragraph-diff` — Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

```ts
// Diff por parágrafos, sem dependência. Unidade = linha de texto (a extração separa parágrafos por \n).

export type DiffKind = 'added' | 'removed' | 'context';

export interface DiffHunk {
  kind: DiffKind;
  text: string;
}

export interface ParagraphDiff {
  summary: { added: number; removed: number; unchanged: number };
  truncated: boolean;
  hunks: DiffHunk[];
}

type Op = { kind: 'same' | 'added' | 'removed'; text: string };

const MAX_CELLS = 4_000_000;
const MAX_CHANGED = 500;
const CONTEXT = 2;

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

// Maior subsequência comum por programação dinâmica; o miolo tem no máximo MAX_CELLS células,
// então a menor dimensão é ≤ 2000 e Uint16Array comporta o comprimento da subsequência.
function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const t = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = a[i] === b[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) {
      ops.push({ kind: 'removed', text: a[i++] });
    } else {
      ops.push({ kind: 'added', text: b[j++] });
    }
  }
  while (i < n) ops.push({ kind: 'removed', text: a[i++] });
  while (j < m) ops.push({ kind: 'added', text: b[j++] });
  return ops;
}

// Fallback para miolos enormes: diferença por multiconjunto (sem ordem).
function multisetOps(a: string[], b: string[]): Op[] {
  const contagem = new Map<string, number>();
  for (const p of b) contagem.set(p, (contagem.get(p) ?? 0) + 1);
  const ops: Op[] = [];
  const usados = new Map<string, number>();
  for (const p of a) {
    const restante = contagem.get(p) ?? 0;
    if (restante > 0) {
      contagem.set(p, restante - 1);
      usados.set(p, (usados.get(p) ?? 0) + 1);
      ops.push({ kind: 'same', text: p });
    } else {
      ops.push({ kind: 'removed', text: p });
    }
  }
  const sobras = new Map(contagem);
  for (const p of b) {
    const restante = sobras.get(p) ?? 0;
    if (restante > 0) {
      sobras.set(p, restante - 1);
      ops.push({ kind: 'added', text: p });
    }
  }
  return ops;
}

export function diffParagraphs(oldText: string, newText: string): ParagraphDiff {
  const a = splitParagraphs(oldText);
  const b = splitParagraphs(newText);

  let prefixo = 0;
  while (prefixo < a.length && prefixo < b.length && a[prefixo] === b[prefixo]) prefixo++;
  let sufixo = 0;
  while (
    sufixo < a.length - prefixo &&
    sufixo < b.length - prefixo &&
    a[a.length - 1 - sufixo] === b[b.length - 1 - sufixo]
  ) {
    sufixo++;
  }
  const miolo_a = a.slice(prefixo, a.length - sufixo);
  const miolo_b = b.slice(prefixo, b.length - sufixo);

  let truncated = false;
  let meio: Op[];
  if (miolo_a.length * miolo_b.length <= MAX_CELLS) {
    meio = lcsOps(miolo_a, miolo_b);
  } else {
    meio = multisetOps(miolo_a, miolo_b);
    truncated = true;
  }

  const ops: Op[] = [
    ...a.slice(0, prefixo).map((text): Op => ({ kind: 'same', text })),
    ...meio,
    ...a.slice(a.length - sufixo).map((text): Op => ({ kind: 'same', text })),
  ];

  const summary = { added: 0, removed: 0, unchanged: 0 };
  for (const op of ops) {
    if (op.kind === 'added') summary.added++;
    else if (op.kind === 'removed') summary.removed++;
    else summary.unchanged++;
  }

  // Marca o que entra na saída: alterações (até MAX_CHANGED) e CONTEXT parágrafos ao redor de cada uma.
  const mostrar = new Array<boolean>(ops.length).fill(false);
  let alteradosMostrados = 0;
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].kind === 'same') continue;
    if (alteradosMostrados >= MAX_CHANGED) {
      truncated = true;
      break;
    }
    alteradosMostrados++;
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(ops.length - 1, i + CONTEXT); k++) mostrar[k] = true;
  }

  const hunks: DiffHunk[] = [];
  let omitidos = 0;
  const fecharOmitidos = () => {
    if (omitidos > 0) {
      hunks.push({ kind: 'context', text: `… ${omitidos} parágrafos sem mudança …` });
      omitidos = 0;
    }
  };
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (!mostrar[i]) {
      omitidos++;
      continue;
    }
    fecharOmitidos();
    hunks.push({ kind: op.kind === 'same' ? 'context' : op.kind, text: op.text });
  }
  fecharOmitidos();

  return { summary, truncated, hunks };
}
```
Observação: ao truncar em 500 alterações, os parágrafos alterados restantes (e o resto do texto) caem em `omitidos` e viram um único "… N parágrafos sem mudança …"; ajuste a mensagem para `parágrafos não exibidos` **somente se** `truncated` for por limite de 500 (simples: se `alteradosMostrados >= MAX_CHANGED` e ainda houver alterações, emita `… N parágrafos não exibidos …` no lugar). O teste `limita a 500` só exige ≤ 500 alterados + `truncated`.

- [ ] **Step 4: Rodar e ver passar**

Run: `timeout 180 npx jest --config ./test/jest-unit.json paragraph-diff && npx tsc --noEmit -p tsconfig.json` — Expected: PASS; tsc limpo. Se o teste de desempenho passar de 3 s, **investigar** (provavelmente um `slice`/`concat` indevido), não afrouxar o limite sem relatar.

- [ ] **Step 5: Checkpoint (sem commit):** `git status --short src/normative test | grep -i paragraph`.

---

### Task 2: Serviço e controller (diff, lote, retirada)

**Files:** Modify `normative-documents.service.ts`, `normative-documents.controller.ts`; Create `dto/reject-batch.dto.ts`, `dto/retire-document.dto.ts`, `backend/test/normative-documents-review.unit-spec.ts`.

**Interfaces — Consumes:** `diffParagraphs`, `splitParagraphs` (Task 1). **Produces:**
- `NormativeDocumentsService.diffForDocument(client, id): Promise<{ has_previous: boolean } & ParagraphDiff>`
- `NormativeDocumentsService.rejectBatch(client, ids: string[], reviewerUserId: string, reason: string): Promise<{ rejected: number }>`
- `NormativeDocumentsService.retire(client, id, reviewerUserId, reason): Promise<NormativeDocument>`
- Rotas (admin): `GET /normative-documents/:id/diff`, `POST /normative-documents/reject-batch`, `POST /normative-documents/:id/retire`.

- [ ] **Step 1: Escrever o teste que falha** (`normative-documents-review.unit-spec.ts`)

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { NormativeDocumentsController } from '../src/normative/normative-documents.controller';
import { NormativeDocumentsService } from '../src/normative/normative-documents.service';
import { RejectBatchDto } from '../src/normative/dto/reject-batch.dto';
import { RetireDocumentDto } from '../src/normative/dto/retire-document.dto';

const UUID = (n: number) => `123e4567-e89b-42d3-a456-4266141740${String(n).padStart(2, '0')}`;
const erros = async (Classe: any, dados: object) => (await validate(plainToInstance(Classe, dados))).map((e) => e.property);

function clienteFalso(respostas: (sql: string, params: any[]) => any) {
  const consultas: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      return respostas(sql, params) ?? { rows: [] };
    }),
  };
  return { client, consultas };
}
const doc = (extra: object = {}) => ({ id: UUID(1), source_id: 's1', status: 'aguardando_validacao', raw_text: 'a\nb', ...extra });
const novoService = () => new NormativeDocumentsService({} as any, {} as any);

describe('DTOs', () => {
  it('lote: 1 a 50 UUIDs distintos e motivo', async () => {
    expect(await erros(RejectBatchDto, { ids: [], reason: 'x' })).toContain('ids');
    expect(await erros(RejectBatchDto, { ids: ['nao-uuid'], reason: 'x' })).toContain('ids');
    expect(await erros(RejectBatchDto, { ids: [UUID(1), UUID(1)], reason: 'x' })).toContain('ids');
    expect(await erros(RejectBatchDto, { ids: Array.from({ length: 51 }, (_, i) => UUID(i)), reason: 'x' })).toContain('ids');
    expect(await erros(RejectBatchDto, { ids: [UUID(1)], reason: '' })).toContain('reason');
    expect(await erros(RejectBatchDto, { ids: [UUID(1), UUID(2)], reason: 'ruído' })).toEqual([]);
  });
  it('retirada: motivo obrigatório, até 900 caracteres', async () => {
    expect(await erros(RetireDocumentDto, { reason: '' })).toContain('reason');
    expect(await erros(RetireDocumentDto, { reason: 'a'.repeat(901) })).toContain('reason');
    expect(await erros(RetireDocumentDto, { reason: 'texto de 9 caracteres' })).toEqual([]);
  });
});

describe('NormativeDocumentsService.diffForDocument', () => {
  it('sem vigente anterior: has_previous false', async () => {
    const { client } = clienteFalso((sql) => (sql.includes('FROM normative_documents WHERE id') ? { rows: [doc()] } : { rows: [] }));
    const r = await novoService().diffForDocument(client, UUID(1));
    expect(r.has_previous).toBe(false);
    expect(r.hunks).toEqual([]);
  });
  it('com vigente: devolve o diff entre o vigente e o documento', async () => {
    const { client } = clienteFalso((sql) =>
      sql.includes("status = 'vigente'") ? { rows: [{ raw_text: 'a\nb\nc' }] } : { rows: [doc({ raw_text: 'a\nB\nc' })] },
    );
    const r = await novoService().diffForDocument(client, UUID(1));
    expect(r.has_previous).toBe(true);
    expect(r.summary).toEqual({ added: 1, removed: 1, unchanged: 2 });
  });
});

describe('NormativeDocumentsService.rejectBatch', () => {
  it('rejeita todos numa transação quando todos estão pendentes', async () => {
    const { client, consultas } = clienteFalso((sql) =>
      sql.startsWith('SELECT') ? { rows: [{ id: UUID(1), status: 'aguardando_validacao' }, { id: UUID(2), status: 'aguardando_validacao' }] } : { rows: [], rowCount: 2 },
    );
    const r = await novoService().rejectBatch(client, [UUID(1), UUID(2)], 'adm', 'ruído');
    expect(r).toEqual({ rejected: 2 });
    const upd = consultas.find((c) => c.sql.includes('UPDATE'))!;
    expect(upd.sql).toContain("status = 'rejeitado'");
    expect(upd.params).toEqual([[UUID(1), UUID(2)], 'adm', 'ruído']);
  });
  it('se algum não está pendente ou não existe, não rejeita nenhum e lista os inválidos', async () => {
    const { client, consultas } = clienteFalso((sql) =>
      sql.startsWith('SELECT') ? { rows: [{ id: UUID(1), status: 'aguardando_validacao' }, { id: UUID(2), status: 'vigente' }] } : { rows: [] },
    );
    await expect(novoService().rejectBatch(client, [UUID(1), UUID(2), UUID(3)], 'adm', 'x')).rejects.toThrow(BadRequestException);
    expect(consultas.some((c) => c.sql.includes('UPDATE'))).toBe(false);
  });
});

describe('NormativeDocumentsService.retire', () => {
  it('só retira documento vigente', async () => {
    const { client } = clienteFalso(() => ({ rows: [doc({ status: 'aguardando_validacao' })] }));
    await expect(novoService().retire(client, UUID(1), 'adm', 'motivo')).rejects.toThrow(/vigente/);
  });
  it('vigente: vira rejeitado com prefixo Retirada, apaga os chunks e zera indexed_at', async () => {
    const { client, consultas } = clienteFalso((sql) => (sql.startsWith('SELECT') ? { rows: [doc({ status: 'vigente' })] } : { rows: [] }));
    await novoService().retire(client, UUID(1), 'adm', 'extração vazia');
    const upd = consultas.find((c) => c.sql.includes('UPDATE'))!;
    expect(upd.sql).toContain("status = 'rejeitado'");
    expect(upd.sql).toContain('indexed_at = NULL');
    expect(upd.params).toContain('Retirada: extração vazia');
    const del = consultas.find((c) => c.sql.includes('DELETE FROM normative_document_chunks'))!;
    expect(del.params).toEqual([UUID(1)]);
  });
  it('documento inexistente: 404', async () => {
    const { client } = clienteFalso(() => ({ rows: [] }));
    await expect(novoService().retire(client, UUID(9), 'adm', 'x')).rejects.toThrow(NotFoundException);
  });
});

describe('NormativeDocumentsController', () => {
  function montar() {
    const documents: any = {
      diffForDocument: jest.fn(async () => ({ has_previous: false })),
      rejectBatch: jest.fn(async () => ({ rejected: 2 })),
      retire: jest.fn(async () => ({ id: UUID(1) })),
    };
    const req: any = { user: { id: 'adm' }, withTenantContext: (fn: any) => fn({}) };
    return { controller: new NormativeDocumentsController(documents), documents, req };
  }
  it('delegam ao serviço com o usuário do token', async () => {
    const { controller, documents, req } = montar();
    await controller.diff(UUID(1), req);
    expect(documents.diffForDocument).toHaveBeenCalledWith({}, UUID(1));
    await controller.rejectBatch({ ids: [UUID(1), UUID(2)], reason: 'r' } as any, req);
    expect(documents.rejectBatch).toHaveBeenCalledWith({}, [UUID(1), UUID(2)], 'adm', 'r');
    await controller.retire(UUID(1), { reason: 'r' } as any, req);
    expect(documents.retire).toHaveBeenCalledWith({}, UUID(1), 'adm', 'r');
  });
  it('as 3 rotas novas exigem a role admin', () => {
    const reflector = new Reflector();
    for (const metodo of ['diff', 'rejectBatch', 'retire'] as const) {
      const roles = reflector.get<string[]>(ROLES_KEY, NormativeDocumentsController.prototype[metodo]);
      expect(roles).toContain('admin');
    }
  });
});
```
(Confirme a chave real exportada por `common/decorators/roles.decorator.ts`; use a que existir.)

- [ ] **Step 2: Rodar e ver falhar:** `timeout 180 npx jest --config ./test/jest-unit.json normative-documents-review` — Expected: FAIL.

- [ ] **Step 3: Implementar — DTOs**

`dto/reject-batch.dto.ts`:
```ts
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class RejectBatchDto {
  @IsArray({ message: 'Informe os documentos a rejeitar' })
  @ArrayMinSize(1, { message: 'Selecione ao menos um documento' })
  @ArrayMaxSize(50, { message: 'Selecione no máximo 50 documentos por vez' })
  @ArrayUnique({ message: 'Há documentos repetidos na seleção' })
  @IsUUID('all', { each: true, message: 'Identificador de documento inválido' })
  ids: string[];

  @IsString()
  @IsNotEmpty({ message: 'Informe o motivo da rejeição' })
  @MaxLength(1000)
  reason: string;
}
```
`dto/retire-document.dto.ts`:
```ts
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// 900 + "Retirada: " cabe nos 1000 caracteres do motivo de rejeição.
export class RetireDocumentDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o motivo da retirada' })
  @MaxLength(900, { message: 'O motivo pode ter no máximo 900 caracteres' })
  reason: string;
}
```

- [ ] **Step 4: Implementar — serviço** (acrescentar import `import { diffParagraphs, ParagraphDiff } from './paragraph-diff.util';` e os métodos)

```ts
  // Diff entre a versão vigente da mesma fonte e este documento (revisão de pendente).
  async diffForDocument(client: PoolClient, id: string): Promise<{ has_previous: boolean } & ParagraphDiff> {
    const document = await this.findOne(client, id);
    const previous = await client.query<{ raw_text: string }>(
      `SELECT raw_text FROM normative_documents WHERE source_id = $1 AND status = 'vigente' AND id != $2`,
      [document.source_id, id],
    );
    const anterior = previous.rows[0];
    if (!anterior) {
      return { has_previous: false, summary: { added: 0, removed: 0, unchanged: 0 }, truncated: false, hunks: [] };
    }
    return { has_previous: true, ...diffParagraphs(anterior.raw_text, document.raw_text) };
  }

  // Rejeita vários pendentes de uma vez, tudo ou nada (a chamada roda dentro de req.withTenantContext).
  async rejectBatch(client: PoolClient, ids: string[], reviewerUserId: string, reason: string): Promise<{ rejected: number }> {
    const found = await client.query<{ id: string; status: NormativeDocumentStatus }>(
      'SELECT id, status FROM normative_documents WHERE id = ANY($1::uuid[]) FOR UPDATE',
      [ids],
    );
    const pendentes = new Set(found.rows.filter((r) => r.status === 'aguardando_validacao').map((r) => r.id));
    const invalidos = ids.filter((id) => !pendentes.has(id));
    if (invalidos.length > 0) {
      throw new BadRequestException(
        `Nenhum documento foi rejeitado: ${invalidos.length} não existe(m) ou não está(ão) aguardando validação (${invalidos.slice(0, 3).map((i) => i.slice(0, 8)).join(', ')})`,
      );
    }
    await client.query(
      `UPDATE normative_documents
       SET status = 'rejeitado', reviewed_by_user_id = $2, reviewed_at = now(), rejection_reason = $3
       WHERE id = ANY($1::uuid[])`,
      [ids, reviewerUserId, reason],
    );
    return { rejected: ids.length };
  }

  // Tira um documento vigente do Assistente sem apagar o texto nem o arquivo: vira `rejeitado` com o
  // prefixo "Retirada:" (o CHECK de status não tem valor próprio e não criamos migration para isso).
  async retire(client: PoolClient, documentId: string, reviewerUserId: string, reason: string): Promise<NormativeDocument> {
    const doc = await this.findOne(client, documentId);
    if (doc.status !== 'vigente') {
      throw new BadRequestException('Só documentos vigentes podem ser retirados');
    }
    await client.query(
      `UPDATE normative_documents
       SET status = 'rejeitado', reviewed_by_user_id = $2, reviewed_at = now(), rejection_reason = $3, indexed_at = NULL
       WHERE id = $1`,
      [documentId, reviewerUserId, `Retirada: ${reason}`],
    );
    await client.query('DELETE FROM normative_document_chunks WHERE document_id = $1', [documentId]);
    return this.findOne(client, documentId);
  }
```

- [ ] **Step 5: Implementar — controller** (imports `RejectBatchDto`, `RetireDocumentDto`; `Get(':id/diff')` e `Post('reject-batch')` ficam declaradas **antes** de `@Get(':id')`/`@Post(':id/...')` para não haver ambiguidade)

```ts
  @Roles('admin')
  @Get(':id/diff')
  diff(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.diffForDocument(client, id));
  }

  @Roles('admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('reject-batch')
  rejectBatch(@Body() dto: RejectBatchDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.rejectBatch(client, dto.ids, req.user.id, dto.reason));
  }

  @Roles('admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/retire')
  retire(@Param('id') id: string, @Body() dto: RetireDocumentDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.retire(client, id, req.user.id, dto.reason));
  }
```

- [ ] **Step 6: Rodar e ver passar:** `timeout 240 npx jest --config ./test/jest-unit.json normative-documents-review paragraph-diff normative-monitor normative-record && npx tsc --noEmit -p tsconfig.json` — Expected: PASS. Conferir com `grep -n "@Get\|@Post" src/normative/normative-documents.controller.ts` que `:id/diff`, `reject-batch` e `:id/retire` existem. Confirmar (leitura do código de `recordDetectedVersion`) o efeito da retirada no monitor descrito na spec §2.4 e anotar no relatório; se divergir, relatar.

- [ ] **Step 7: Checkpoint (sem commit):** `git status --short src/normative test | grep -iE "document|diff"` — nada em `pente-fino`.

---

### Task 3: Tela — diff, seleção em lote e retirada

**Files:** Create `frontend/src/app/admin/normativa/DiffView.tsx`, `frontend/src/app/admin/__tests__/normativa-revisao.test.tsx`; Modify `page.tsx`, `convencoes-paginas.test.ts` (só `PAGINAS`).

**Interfaces — Consumes:** `GET /api/normative-documents/:id/diff`, `POST /api/normative-documents/reject-batch`, `POST /api/normative-documents/:id/retire` (Task 2).

- [ ] **Step 1: Teste que falha** (`normativa-revisao.test.tsx`; router estável; `fetch` falso com respostas por `"MÉTODO url"`, como em `normativa-fontes.test.tsx`)

Casos obrigatórios (escreva-os seguindo o padrão do `normativa-fontes.test.tsx` existente):
1. Ao clicar **Revisar**, a página busca `GET /api/normative-documents/:id` **e** `GET /api/normative-documents/:id/diff`; mostra "+1 / −1 parágrafos", o trecho removido com prefixo "−" e o adicionado com "+", o contexto neutro, e o botão **Ver texto completo lado a lado** que revela os dois blocos atuais ("Texto anterior"/"Texto novo").
2. `truncated: true` mostra o aviso "Mostrando só parte das mudanças".
3. `has_previous: false` mostra só o texto novo e a frase "(nenhuma versão vigente anterior)", sem lista de trechos.
4. Se o `GET …/diff` falhar (resposta não-ok ou rejeição), a revisão cai no lado a lado e **Aprovar/Rejeitar continuam funcionando** (o endpoint de diff não pode bloquear a revisão).
5. Seleção em lote: caixa por pendente (`aria-label="Selecionar <file_name>"`), "Selecionar todos", motivo (`aria-label="Motivo da rejeição em lote"`), botão `Rejeitar selecionados (2)` desabilitado sem seleção ou sem motivo; ao clicar, pede confirmação (`window.confirm` mockado para `true`) e envia `POST /api/normative-documents/reject-batch` com `{ ids: [...], reason }`; sucesso recarrega a lista e limpa a seleção; erro 400 mostra a mensagem da API e mantém a seleção.
6. Retirar vigente: botão `Retirar` por vigente (`aria-label="Retirar <file_name>"`) abre campo de motivo obrigatório (`aria-label="Motivo da retirada"`) e botão `Confirmar retirada` (desabilitado sem motivo); envia `POST /api/normative-documents/<id>/retire` com `{ reason }`; sucesso recarrega; sem `window.confirm` aceito, nada é enviado.
7. Vigente com `rejection_reason` iniciado em "Retirada:" não aparece na lista de vigentes (a lista só traz `status=vigente`; apenas garanta que o componente não quebra com o campo).

- [ ] **Step 2: Rodar e ver falhar:** `cd /opt/Montese/frontend && timeout 180 npx vitest run src/app/admin/__tests__/normativa-revisao.test.tsx`.

- [ ] **Step 3: Implementar `DiffView.tsx`**

```tsx
'use client';

export interface DiffHunk {
  kind: 'added' | 'removed' | 'context';
  text: string;
}

export interface DocumentDiff {
  has_previous: boolean;
  summary: { added: number; removed: number; unchanged: number };
  truncated: boolean;
  hunks: DiffHunk[];
}

const PREFIXO = { added: '+', removed: '−', context: ' ' } as const;
const ROTULO = { added: 'Adicionado', removed: 'Removido', context: 'Sem mudança' } as const;
const COR = {
  added: 'text-adm-status-ok-text',
  removed: 'text-adm-status-crit-text',
  context: 'text-brand-700',
} as const;

export function DiffView({ diff }: { diff: DocumentDiff }) {
  return (
    <div>
      <p className="text-sm font-bold text-brand-900">
        +{diff.summary.added} / −{diff.summary.removed} parágrafos
        <span className="ml-2 font-normal text-brand-700">({diff.summary.unchanged} sem mudança)</span>
      </p>
      {diff.truncated && (
        <p role="status" className="mt-1 text-xs text-brand-700">
          Mostrando só parte das mudanças. Use “Ver texto completo lado a lado” para conferir o restante.
        </p>
      )}
      <ul className="mt-2 flex max-h-96 flex-col gap-1 overflow-y-auto text-sm">
        {diff.hunks.map((h, i) => (
          <li key={i} aria-label={`${ROTULO[h.kind]}: ${h.text}`} className={`flex gap-2 break-words ${COR[h.kind]}`}>
            <span aria-hidden="true" className="w-4 shrink-0 font-mono">{PREFIXO[h.kind]}</span>
            <span className="min-w-0 whitespace-pre-wrap">{h.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```
Confira em `globals.css`/`admin-theme.css` os nomes reais das cores (`text-adm-status-ok-text`, `text-adm-status-crit-text` existem, conforme o FontesPanel/teste de página); respeite `convencoes-paginas.test.ts` e acrescente `normativa/DiffView.tsx` a `PAGINAS`.

- [ ] **Step 4: Implementar em `page.tsx`**
  1. `openDetail(id)`: busca o detalhe (como hoje) **e**, em paralelo, o diff dentro de try/catch; guarda `diff` (ou `null` se falhar/não ok) e `showSideBySide` (false por padrão; `true` se não houver diff utilizável).
  2. No cartão "Revisar versão": se `diff?.has_previous`, mostra `<DiffView diff={diff} />` e o botão "Ver texto completo lado a lado" que alterna os dois blocos atuais; se não, o comportamento atual (lado a lado / "(nenhuma versão vigente anterior)"). Aprovar/Rejeitar inalterados.
  3. Pendentes: estado `selecionados: Set<string>`, `batchReason`, `batchError`; caixa de seleção por item e "Selecionar todos"; botão `Rejeitar selecionados (n)`; `handleRejectBatch` com `window.confirm('Rejeitar N documentos? Esta ação não pode ser desfeita pela tela.')`, `POST reject-batch` com `{ ids, reason }`, erro mostra `body.message` (string ou array; use o mesmo helper de mensagem do FontesPanel ou um local) e mantém a seleção; sucesso limpa seleção/motivo e chama `loadAll()` (com o recarregamento tratado como em `FontesPanel`: falha do recarregamento não vira mensagem de erro de gravação).
  4. Vigentes: botão `Retirar` por item → mostra campo "Motivo da retirada" + `Confirmar retirada` (desabilitado sem motivo); `handleRetire` com `window.confirm('Retirar este documento do Assistente? Ele deixa de ser usado nas respostas.')`, `POST …/retire` com `{ reason }`; sucesso recarrega; erro mostra a mensagem. Só um vigente em retirada por vez (`retirandoId`).
  5. Reutilize as classes `adm-*` existentes (`adm-btn`, `adm-btn-danger`, `adm-input`, `adm-link`); controles com `aria-label` conforme os testes; erros com `role="alert"`.

- [ ] **Step 5: Rodar e ver passar:** `timeout 300 npx vitest run src/app/admin && npx tsc --noEmit && npx eslint src/app/admin src/components/admin` — Expected: PASS em `normativa-revisao`, `normativa-page` (sem edição, salvo ajuste mínimo e justificado), `normativa-fontes`, `convencoes-paginas`; tsc limpo; eslint 0 erros (aviso antigo `AdminBrand.tsx:13` aceito).

- [ ] **Step 6: Checkpoint (sem commit):** `git status --short src/app/admin | grep -i normativa`.

---

### Task 4: Verificação, QA visual e documentação

**Files:** Modify `docs/superpowers/specs/2026-10-09-monitor-normativo-revisao-design.md` (seção `## 8. Resultado da verificação`), `docs/operations/release-frontend-shell-empresa-2026-10-04.md` (seção `## 0.7 Revisão do monitor normativo (2026-10-09)`). Sem código de produção novo.

- [ ] **Step 1: Backend** — `npx tsc --noEmit -p tsconfig.json`; comparação rigorosa: worktree em `…/scratchpad/wt-fatia2b` do HEAD + só os arquivos da fatia (`paragraph-diff.util.ts`, `normative-documents.service.ts`, `normative-documents.controller.ts`, os 2 DTOs, os 2 specs); jest unitário completo nos dois; as **mesmas 8 suítes** falham (nenhuma a mais) e as novas passam. Remover a worktree (`rm $WT/backend/node_modules && git worktree remove --force $WT`).
- [ ] **Step 2: Frontend** — `vitest run` completo, `tsc --noEmit`, `eslint src/app/admin src/components/admin` (0 erros), `NODE_OPTIONS=--max-old-space-size=2048 timeout 540 npx next build`.
- [ ] **Step 3: QA visual (Playwright, API simulada)** — memória `project_visual_qa_tooling`; servidor próprio na porta 3100, PID guardado, **nunca** matar o `next-server` de `cwd=/app`; sessão falsa; sem Docker/produção. Em `/admin/normativa`, 1440×900 e 390×844: 0 erros de console, `scrollWidth <= innerWidth`; **ler os screenshots**: revisão com diff (removido/adicionado/contexto, aviso de truncado), lado a lado alternado, pendentes com seleção + motivo + "Rejeitar selecionados", vigente com "Retirar" aberto; conferir os corpos de `reject-batch` e `retire`; foco por Tab. Relatório com tabela rota × viewport.
- [ ] **Step 4: Desempenho do diff com texto real** — usar um texto público grande (ex.: a CLT em `https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm`, GET público, extraído com `extractHtmlText`/`decodeHtmlBuffer` do monitor) duas vezes com ~30 parágrafos alterados artificialmente; medir tempo e memória de `diffParagraphs`; registrar os números.
- [ ] **Step 5: Documentar** — seções com números reais e o que ficou **NÃO VERIFICADO** (e2e; rotas com banco real; comportamento em produção; efeito da retirada no monitor se não confirmado por leitura/teste). Não executar nenhum passo 🔒.
- [ ] **Step 6: Checkpoint final (sem commit):** `git status --short` filtrado nos arquivos desta fatia, sem nada de `backend/src/pente-fino/*`; reportar e **parar** (commit e release são do proprietário).

---

## Self-Review

- **Cobertura da spec:** diff por parágrafos com limites e fallback (T1) e endpoint (T2); rejeição em lote tudo-ou-nada, até 50 (T2/T3); retirada com prefixo, sem migration, apagando chunks e `indexed_at` (T2/T3); tela com diff, seleção, retirada e fallback quando o diff falha (T3); verificação, QA e desempenho real (T4). Aprovação em lote deliberadamente ausente.
- **Placeholders:** nenhum; o único ponto aberto é a mensagem de truncamento por 500 trechos (T1, observação explícita) e os nomes reais de cores/chave de role, conferidos pelo implementador.
- **Consistência:** `diffParagraphs`/`ParagraphDiff` (T1) consumidos pelo serviço (T2); formato `{ has_previous, summary, truncated, hunks }` (T2) igual ao `DocumentDiff` (T3); rotas e corpos (`{ids, reason}`, `{reason}`) iguais nos testes de backend e frontend.
- **Riscos:** desempenho medido (T1 teste + T4 texto real); lote atômico; retirada com confirmação; `GET :id/diff` não bloqueia a revisão se falhar; release backend+frontend juntos.
