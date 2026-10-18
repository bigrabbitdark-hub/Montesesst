# Ligar o fluxo de auditoria cruzada (fatos → regras → relatório → PDF) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer `POST /pente-fino/run` com `include_pdf: true` gerar o PDF a partir de um `SstAuditReport` real (fatos extraídos + regras + matriz de cobertura), em vez de passar o relatório do comparador direto ao PDF.

**Architecture:** Um montador puro (`sst-audit-assembler.ts`) converte fatos e resultados de regras em `SstAuditReportInput`. Um serviço fino (`SstAuditService`) busca os documentos por id sob RLS, chama `SstAuditFactsService.getFacts` e usa o montador. O controller continua devolvendo `audit_report` (formato do comparador, que o frontend já consome) e acrescenta `sst_audit_report`; o PDF passa a ser gerado a partir de `sst_audit_report`.

**Tech Stack:** NestJS, TypeScript, pg, pdfkit, Jest (`test/jest-unit.json`).

**Spec:** `docs/superpowers/specs/2026-09-30-relatorio-auditoria-cruzada-pdf-design.md`

## Global Constraints

- Contexto de tenant/RLS sai SEMPRE do JWT do usuário, nunca do `tenant_id` do corpo (ver comentário em `PenteFinoComparisonService.run`). O `ctx` é `{ userId: user.id, tenantId: user.tenantId ?? undefined, role: user.role }`.
- A autorização (403 para técnico/parceiro não vinculado) continua vindo de `comparison.run` e DEVE executar antes de qualquer outra chamada.
- Provider/modelo de IA não muda (MiniMax). Nada de novo é enviado ao provider além do que `SstAuditFactsService` já envia (já passa por `redactPii`).
- Sem NC sem regra validada: este plano NÃO adiciona regras. Só liga o que existe.
- Não alterar `buildSstAuditReport`, `evaluateSstAuditRules`, `buildSstCoverageMatrix` nem `buildSstAuditPdf`.
- Não executar commit, push, reset nem migration (AGENTS.md). Os passos "Commit" abaixo são para o proprietário executar ou autorizar.
- Specs unitários rodam no host: `cd /opt/Montese/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json <padrão> --forceExit`. Specs e2e NÃO devem rodar via `run-backend-tests.sh` (usa o `.env` de produção): só em container/clone descartável, conforme a nota de memória "Rodar testes sem travar".
- Baseline: `tenant-context-callsites` já falha por `sst-audit-facts.service.ts` fora da lista ALLOWED. Não editar a lista sem revisar como o `ctx` é montado (guarda do ITEM 008).

## Estado atual verificado (por leitura, 07/10/2026)

- `pente-fino.controller.ts`: com `include_pdf`, chama `buildSstAuditPdf(report as any)` onde `report` é o `PenteFinoReport` do comparador (campos `pgr_document`, `audit_findings`, `warnings`…). `buildSstAuditPdf` lê `report.audit_status`, `report.summary`, `report.findings`, `report.recommendations`, `report.limitations`, que esse objeto não tem; o PDF sai com "Status: undefined" e sem achados.
- `SstAuditFactsService`, `evaluateSstAuditRules`, `buildSstCoverageMatrix` e `buildSstAuditReport` não são chamados por ninguém fora dos próprios arquivos e testes.
- `evaluateSstAuditRules` tem uma única regra concreta (divergência de ruído → `IN`).
- O frontend (`PenteFinoPanel.tsx`, ainda não commitado) lê `body.audit_report`, `body.pdf_base64`, `body.pdf_file_name` e SEMPRE manda `include_pdf: true`. Portanto, cada execução passará a disparar extração de fatos (chamadas de LLM, em cache por sha256 do documento).

## File Structure

- Create `backend/src/pente-fino/sst-audit-assembler.ts` — função pura: fatos + resultados de regras → `SstAuditReportInput`.
- Create `backend/src/pente-fino/sst-audit.service.ts` — `SstAuditService.build(ctx, tenantId, report)`: busca documentos, extrai fatos, monta o relatório.
- Modify `backend/src/pente-fino/pente-fino.module.ts` — registrar `SstAuditService`.
- Modify `backend/src/pente-fino/pente-fino.controller.ts` — usar o serviço e gerar o PDF do `SstAuditReport`.
- Test `backend/test/sst-audit-assembler.unit-spec.ts`, `backend/test/sst-audit-service.unit-spec.ts`, `backend/test/pente-fino-controller.unit-spec.ts`.

---

### Task 1: Montador puro

**Files:**
- Create: `backend/src/pente-fino/sst-audit-assembler.ts`
- Test: `backend/test/sst-audit-assembler.unit-spec.ts`

**Interfaces:**
- Consumes: `SstAuditFactsResult` de `sst-audit-facts.service.ts`; `evaluateSstAuditRules`, `buildSstCoverageMatrix`, `SstAuditRuleInputFact`, `SstAuditRuleResult` de `sst-audit-rules.ts`; `SstAuditReportInput`, `SstAuditFinding`, `SstAuditDocumentRef` de `sst-audit-report.service.ts`.
- Produces: `export type SstAuditDocType = 'pgr' | 'ltcat' | 'pcmso' | 'lip'`; `export interface SstAuditAssemblerDocument { type: SstAuditDocType; id: string; title: string; extraction: SstAuditFactsResult }`; `export function assembleSstAuditInput(args: { auditDate: Date; company: { id: string; name: string }; documents: SstAuditAssemblerDocument[]; missingTypes: SstAuditDocType[] }): SstAuditReportInput`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// backend/test/sst-audit-assembler.unit-spec.ts
import { assembleSstAuditInput, SstAuditAssemblerDocument } from '../src/pente-fino/sst-audit-assembler';
import { SstAuditFactsResult } from '../src/pente-fino/sst-audit-facts.service';

function extraction(
  documentId: string,
  status: 'complete' | 'partial' | 'failed',
  facts: SstAuditFactsResult['facts'] = [],
  unevaluated: number[] = [],
): SstAuditFactsResult {
  return {
    id: `ext-${documentId}`,
    tenant_id: 'tenant-1',
    document_id: documentId,
    document_sha256: 'abc',
    extractor_version: 'sst-audit-facts-v1',
    page_count: 10,
    status,
    unevaluated_pages: unevaluated,
    facts,
  };
}

function noiseFact(id: string, documentId: string, value: number, page: number) {
  return {
    id,
    tenant_id: 'tenant-1',
    extraction_id: `ext-${documentId}`,
    document_id: documentId,
    fact_type: 'noise_measurement',
    subject_type: 'agent',
    subject_raw: 'Ruído',
    subject_key: 'ruido',
    value_json: { value },
    unit: 'dB(A)',
    evidence_kind: 'direct_measurement' as const,
    confidence: 'high' as const,
    page_number: page,
    source_excerpt: `Ruído em ${value} dB(A).`,
  };
}

const auditDate = new Date('2026-10-07T00:00:00.000Z');
const company = { id: 'tenant-1', name: 'Empresa Teste' };

describe('assembleSstAuditInput', () => {
  it('converte divergência de ruído em achado IN com evidência e página', () => {
    const documents: SstAuditAssemblerDocument[] = [
      { type: 'lip', id: 'doc-lip', title: 'LIP 2026', extraction: extraction('doc-lip', 'complete', [noiseFact('f1', 'doc-lip', 91.6, 3)]) },
      { type: 'ltcat', id: 'doc-ltcat', title: 'LTCAT 2026', extraction: extraction('doc-ltcat', 'complete', [noiseFact('f2', 'doc-ltcat', 85.0, 7)]) },
    ];

    const input = assembleSstAuditInput({ auditDate, company, documents, missingTypes: [] });

    expect(input.findings).toHaveLength(1);
    expect(input.findings[0]).toMatchObject({ category: 'IN', status: 'to_confirm', confidence: 'medium', priority: 2 });
    expect(input.findings[0].evidence.map((e) => e.page)).toEqual([3, 7]);
    expect(input.documents.map((d) => d.status)).toEqual(['complete', 'complete']);
    expect(input.recommendations.length).toBeGreaterThan(0);
  });

  it('marca documento parcial e documento falho, e lista os ausentes como limitação', () => {
    const documents: SstAuditAssemblerDocument[] = [
      { type: 'pcmso', id: 'doc-pcmso', title: 'PCMSO', extraction: extraction('doc-pcmso', 'partial', [], [4, 5]) },
      { type: 'pgr', id: 'doc-pgr', title: 'PGR', extraction: extraction('doc-pgr', 'failed') },
    ];

    const input = assembleSstAuditInput({ auditDate, company, documents, missingTypes: ['lip'] });

    expect(input.documents.find((d) => d.id === 'doc-pcmso')?.status).toBe('partial');
    expect(input.documents.find((d) => d.id === 'doc-pgr')?.status).toBe('not_evaluable');
    expect(input.limitations).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/PCMSO.*4, 5/),
        expect.stringMatching(/PGR.*não foi possível/i),
        expect.stringMatching(/LIP.*não localizado/i),
      ]),
    );
    expect(input.findings).toHaveLength(0);
  });

  it('sem documentos nem fatos não inventa achado nem conformidade', () => {
    const input = assembleSstAuditInput({ auditDate, company, documents: [], missingTypes: ['pgr', 'pcmso', 'ltcat', 'lip'] });
    expect(input.findings).toEqual([]);
    expect(input.limitations).toHaveLength(4 + 1);
  });
});
```

(Para o último teste: 4 ausentes + 1 limitação vinda da regra `not_reported` "Sem fatos extraídos…", totalizando 5.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /opt/Montese/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json sst-audit-assembler --forceExit`
Expected: FAIL com "Cannot find module '../src/pente-fino/sst-audit-assembler'".

- [ ] **Step 3: Implementar**

```ts
// backend/src/pente-fino/sst-audit-assembler.ts
import { SstAuditFact, SstAuditFactsResult } from './sst-audit-facts.service';
import { SstAuditDocumentRef, SstAuditFinding, SstAuditReportInput } from './sst-audit-report.service';
import {
  buildSstCoverageMatrix,
  evaluateSstAuditRules,
  SstAuditRuleInputFact,
  SstAuditRuleResult,
} from './sst-audit-rules';

export type SstAuditDocType = 'pgr' | 'ltcat' | 'pcmso' | 'lip';

export interface SstAuditAssemblerDocument {
  type: SstAuditDocType;
  id: string;
  title: string;
  extraction: SstAuditFactsResult;
}

const DOC_LABEL: Record<SstAuditDocType, string> = { pgr: 'PGR', ltcat: 'LTCAT', pcmso: 'PCMSO', lip: 'LIP' };
const FINDING_OUTCOMES = new Set(['NC', 'IN', 'EA', 'RC', 'AT', 'RT']);

function documentStatus(status: SstAuditFactsResult['status']): SstAuditDocumentRef['status'] {
  if (status === 'complete') return 'complete';
  if (status === 'partial') return 'partial';
  return 'not_evaluable';
}

function toRuleFact(fact: SstAuditFact, title: string): SstAuditRuleInputFact {
  return {
    id: fact.id,
    document_id: fact.document_id,
    document_title: title,
    fact_type: fact.fact_type,
    subject_type: fact.subject_type,
    subject_raw: fact.subject_raw,
    subject_key: fact.subject_key,
    value_json: fact.value_json,
    unit: fact.unit,
    page_number: fact.page_number,
    source_excerpt: fact.source_excerpt,
  };
}

function toFinding(result: SstAuditRuleResult, index: number, facts: SstAuditRuleInputFact[]): SstAuditFinding {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const isNc = result.outcome === 'NC';
  return {
    id: `rule-${index + 1}`,
    category: result.outcome as SstAuditFinding['category'],
    status: isNc ? 'confirmed' : 'to_confirm',
    confidence: isNc ? 'high' : 'medium',
    summary: result.summary,
    evidence: result.fact_ids
      .map((id) => byId.get(id))
      .filter((fact): fact is SstAuditRuleInputFact => Boolean(fact))
      .map((fact) => ({
        document_id: fact.document_id,
        title: fact.document_title,
        source_excerpt: fact.source_excerpt,
        page: fact.page_number,
      })),
    limitations: result.limitations,
    recommended_verification: result.recommended_verification,
    priority: isNc ? 1 : result.outcome === 'IN' ? 2 : 3,
  };
}

export function assembleSstAuditInput(args: {
  auditDate: Date;
  company: { id: string; name: string };
  documents: SstAuditAssemblerDocument[];
  missingTypes: SstAuditDocType[];
}): SstAuditReportInput {
  const titles = new Map(args.documents.map((document) => [document.id, document.title]));
  const ruleFacts = args.documents.flatMap((document) =>
    document.extraction.facts.map((fact) => toRuleFact(fact, titles.get(fact.document_id) ?? document.title)),
  );

  const results = evaluateSstAuditRules(ruleFacts, args.auditDate);
  const findings = results
    .filter((result) => FINDING_OUTCOMES.has(result.outcome))
    .map((result, index) => toFinding(result, index, ruleFacts));

  const limitations: string[] = [];
  for (const type of args.missingTypes) {
    limitations.push(`${DOC_LABEL[type]} não localizado entre os documentos da empresa.`);
  }
  for (const document of args.documents) {
    const label = DOC_LABEL[document.type];
    if (document.extraction.status === 'failed') {
      limitations.push(`${label}: não foi possível extrair fatos; documento não avaliado.`);
    } else if (document.extraction.unevaluated_pages.length > 0) {
      limitations.push(
        `${label}: página(s) não avaliada(s): ${document.extraction.unevaluated_pages.join(', ')}.`,
      );
    }
  }
  for (const result of results) {
    if (result.outcome === 'not_reported' || result.outcome === 'not_evaluated') {
      limitations.push(result.summary);
    }
  }

  const recommendations = Array.from(
    new Set(results.map((result) => result.recommended_verification).filter(Boolean)),
  );

  return {
    audit_date: args.auditDate.toISOString().slice(0, 10),
    company: args.company,
    documents: args.documents.map((document) => ({
      id: document.id,
      type: document.type,
      title: document.title,
      status: documentStatus(document.extraction.status),
    })),
    findings,
    recommendations,
    limitations,
    coverage_matrix: buildSstCoverageMatrix(
      ruleFacts,
      args.documents.map((document) => ({ id: document.id, title: document.title, extracted_at: null })),
    ),
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: mesmo comando do Step 2.
Expected: PASS (3 testes). Se o terceiro teste falhar por contagem de limitações, ajustar a expectativa ao número real de resultados `not_reported`, não a regra.

- [ ] **Step 5: Commit (proprietário)**

```bash
git add backend/src/pente-fino/sst-audit-assembler.ts backend/test/sst-audit-assembler.unit-spec.ts
git commit -m "feat(pente-fino): montador do relatório de auditoria cruzada a partir de fatos e regras"
```

---

### Task 2: Serviço que busca documentos e extrai fatos

**Files:**
- Create: `backend/src/pente-fino/sst-audit.service.ts`
- Modify: `backend/src/pente-fino/pente-fino.module.ts` (adicionar import e `SstAuditService` em `providers`)
- Test: `backend/test/sst-audit-service.unit-spec.ts`

**Interfaces:**
- Consumes: `DatabaseService.withTenantContext(ctx, fn)` e `TenantContext` de `common/database/database.service`; `SstAuditFactsService.getFacts(ctx, document)`; `Document` de `documents/documents.service`; `assembleSstAuditInput` e `SstAuditAssemblerDocument`, `SstAuditDocType` (Task 1); `buildSstAuditReport` e `SstAuditReport` de `sst-audit-report.service`; `PenteFinoReport` de `pente-fino-comparison.service`.
- Produces: `class SstAuditService { build(ctx: TenantContext, tenantId: string, report: PenteFinoReport, now?: Date): Promise<SstAuditReport> }`.

Decisão: o serviço recebe o `PenteFinoReport` já produzido (e portanto já autorizado) e usa apenas os ids de documento dele (`pgr_document.id` etc.). A leitura dos `Document` passa por `withTenantContext(ctx, …)` com `WHERE id = ANY($1) AND tenant_id = $2`; a RLS continua valendo.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// backend/test/sst-audit-service.unit-spec.ts
import { SstAuditService } from '../src/pente-fino/sst-audit.service';

const ctx = { userId: 'user-1', tenantId: 'tenant-1', role: 'empresa' };

function ref(id: string, title: string) {
  return {
    id, title, extracted_at: null, elaboration_date: null, elaboration_date_source_excerpt: null,
    professional_name: null, professional_registro: null, professional_papel: null, professional_source_excerpt: null,
  };
}

function makeService(documents: any[], getFacts: jest.Mock) {
  const db = {
    withTenantContext: jest.fn(async (_ctx: any, fn: any) => {
      const client = {
        query: jest.fn(async (sql: string) =>
          sql.includes('FROM tenants') ? { rows: [{ name: 'Empresa Teste' }] } : { rows: documents },
        ),
      };
      return fn(client);
    }),
  };
  return new SstAuditService(db as any, { getFacts } as any);
}

describe('SstAuditService.build', () => {
  it('extrai fatos só dos documentos presentes e lista os ausentes como limitação', async () => {
    const getFacts = jest.fn(async (_ctx: any, document: any) => ({
      id: `ext-${document.id}`, tenant_id: 'tenant-1', document_id: document.id, document_sha256: 'x',
      extractor_version: 'v', page_count: 2, status: 'complete', unevaluated_pages: [], facts: [],
    }));
    const service = makeService(
      [{ id: 'doc-pgr', title: 'PGR 2026', category: 'pgr' }],
      getFacts,
    );

    const report = await service.build(
      ctx, 'tenant-1',
      { pgr_document: ref('doc-pgr', 'PGR 2026'), pcmso_document: null, ltcat_document: null, lip_document: null,
        functions: [], lip_agents: [], agent_coverage: [], audit_findings: [], warnings: [] } as any,
      new Date('2026-10-07T12:00:00Z'),
    );

    expect(getFacts).toHaveBeenCalledTimes(1);
    expect(report.company).toEqual({ id: 'tenant-1', name: 'Empresa Teste' });
    expect(report.documents).toEqual([{ id: 'doc-pgr', type: 'pgr', title: 'PGR 2026', status: 'complete' }]);
    expect(report.limitations).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/PCMSO.*não localizado/),
        expect.stringMatching(/LTCAT.*não localizado/),
        expect.stringMatching(/LIP.*não localizado/),
      ]),
    );
  });

  it('documento cujo getFacts devolve failed vira not_evaluable e não derruba o relatório', async () => {
    const getFacts = jest.fn(async (_ctx: any, document: any) => ({
      id: null, tenant_id: 'tenant-1', document_id: document.id, document_sha256: null,
      extractor_version: 'v', page_count: 0, status: 'failed', unevaluated_pages: [], facts: [],
    }));
    const service = makeService([{ id: 'doc-pcmso', title: 'PCMSO', category: 'pcmso' }], getFacts);

    const report = await service.build(
      ctx, 'tenant-1',
      { pgr_document: null, pcmso_document: ref('doc-pcmso', 'PCMSO'), ltcat_document: null, lip_document: null,
        functions: [], lip_agents: [], agent_coverage: [], audit_findings: [], warnings: [] } as any,
    );

    expect(report.documents[0].status).toBe('not_evaluable');
    expect(report.summary.nc_count).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /opt/Montese/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json sst-audit-service --forceExit`
Expected: FAIL com "Cannot find module '../src/pente-fino/sst-audit.service'".

- [ ] **Step 3: Implementar**

```ts
// backend/src/pente-fino/sst-audit.service.ts
import { Injectable } from '@nestjs/common';
import { DatabaseService, TenantContext } from '../common/database/database.service';
import { Document } from '../documents/documents.service';
import { PenteFinoReport } from './pente-fino-comparison.service';
import { SstAuditFactsService } from './sst-audit-facts.service';
import { assembleSstAuditInput, SstAuditAssemblerDocument, SstAuditDocType } from './sst-audit-assembler';
import { buildSstAuditReport, SstAuditReport } from './sst-audit-report.service';

const DOC_TYPES: SstAuditDocType[] = ['pgr', 'pcmso', 'ltcat', 'lip'];

@Injectable()
export class SstAuditService {
  constructor(
    private readonly db: DatabaseService,
    private readonly facts: SstAuditFactsService,
  ) {}

  // `report` já passou pela autorização de PenteFinoComparisonService.run; aqui
  // só se usam os ids de documento dele. O `ctx` vem do JWT (nunca do tenantId
  // alvo) e a leitura continua sob RLS.
  async build(
    ctx: TenantContext,
    tenantId: string,
    report: PenteFinoReport,
    now: Date = new Date(),
  ): Promise<SstAuditReport> {
    const refs: Record<SstAuditDocType, { id: string } | null> = {
      pgr: report.pgr_document,
      pcmso: report.pcmso_document,
      ltcat: report.ltcat_document,
      lip: report.lip_document,
    };
    const ids = DOC_TYPES.map((type) => refs[type]?.id).filter((id): id is string => Boolean(id));

    const { documents, companyName } = await this.db.withTenantContext(ctx, async (client) => {
      const docs = ids.length
        ? await client.query<Document>(`SELECT * FROM documents WHERE id = ANY($1::uuid[]) AND tenant_id = $2`, [ids, tenantId])
        : { rows: [] as Document[] };
      const tenant = await client.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [tenantId]);
      return { documents: docs.rows, companyName: tenant.rows[0]?.name ?? 'Empresa' };
    });

    const byId = new Map(documents.map((document) => [document.id, document]));
    const assembled: SstAuditAssemblerDocument[] = [];
    const missingTypes: SstAuditDocType[] = [];
    for (const type of DOC_TYPES) {
      const document = refs[type] ? byId.get(refs[type]!.id) : undefined;
      if (!document) {
        missingTypes.push(type);
        continue;
      }
      assembled.push({ type, id: document.id, title: document.title, extraction: await this.facts.getFacts(ctx, document) });
    }

    return buildSstAuditReport(
      assembleSstAuditInput({ auditDate: now, company: { id: tenantId, name: companyName }, documents: assembled, missingTypes }),
    );
  }
}
```

Em `pente-fino.module.ts`: `import { SstAuditService } from './sst-audit.service';` e adicionar `SstAuditService,` após `SstAuditFactsService,` em `providers`.

- [ ] **Step 4: Rodar e ver passar**

Run: mesmo comando do Step 2.
Expected: PASS (2 testes). Rodar também `npx tsc --noEmit -p tsconfig.json` no backend: 0 erros novos.

- [ ] **Step 5: Commit (proprietário)**

```bash
git add backend/src/pente-fino/sst-audit.service.ts backend/src/pente-fino/pente-fino.module.ts backend/test/sst-audit-service.unit-spec.ts
git commit -m "feat(pente-fino): serviço que extrai fatos e monta o relatório de auditoria cruzada"
```

---

### Task 3: Ligar o controller

**Files:**
- Modify: `backend/src/pente-fino/pente-fino.controller.ts`
- Test: `backend/test/pente-fino-controller.unit-spec.ts`

**Interfaces:**
- Consumes: `SstAuditService.build(ctx, tenantId, report)` (Task 2); `buildSstAuditPdf(report: any): Promise<Buffer>`.
- Produces: com `include_pdf`, resposta `{ audit_report: PenteFinoReport, sst_audit_report: SstAuditReport, pdf_base64: string, pdf_file_name: string }`. Sem `include_pdf`, a resposta continua sendo o `PenteFinoReport` puro (contrato atual preservado).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// backend/test/pente-fino-controller.unit-spec.ts
import { PenteFinoController } from '../src/pente-fino/pente-fino.controller';
import { extractPdfTextFull } from '../src/common/pdf/pdf-text.util';

const comparisonReport = { pgr_document: null, audit_findings: [], warnings: [] };
const sstReport = {
  audit_id: 'audit-2026-10-07', generated_at: '2026-10-07T00:00:00.000Z', audit_status: 'partial',
  company: { id: 'tenant-1', name: 'Empresa Teste' }, documents: [],
  scope_counts: { total: 0, complete: 0, partial: 0, not_evaluable: 0 },
  summary: { conclusion: 'Auditoria parcial de teste.', nc_count: 0, inconsistency_count: 1, missing_evidence_count: 0, risks_to_confirm_count: 0 },
  coverage_matrix: [],
  findings: [{ id: 'rule-1', category: 'IN', status: 'to_confirm', confidence: 'medium', summary: 'Divergência de ruído entre LIP e LTCAT', evidence: [], limitations: [], recommended_verification: 'Conferir medições' }],
  recommendations: ['Conferir medições'], limitations: [], functions: [], lip_agents: [], agent_coverage: [], warnings: [],
};

describe('PenteFinoController.run', () => {
  const user = { id: 'user-1', tenantId: 'tenant-1', role: 'empresa' };

  it('sem include_pdf devolve o relatório do comparador e não extrai fatos', async () => {
    const comparison = { run: jest.fn(async () => comparisonReport) };
    const audit = { build: jest.fn() };
    const controller = new PenteFinoController(comparison as any, audit as any);

    const result = await controller.run({} as any, { user });

    expect(result).toBe(comparisonReport);
    expect(audit.build).not.toHaveBeenCalled();
  });

  it('com include_pdf gera o PDF a partir do SstAuditReport, não do relatório do comparador', async () => {
    const comparison = { run: jest.fn(async () => comparisonReport) };
    const audit = { build: jest.fn(async () => sstReport) };
    const controller = new PenteFinoController(comparison as any, audit as any);

    const result: any = await controller.run({ include_pdf: true } as any, { user });

    expect(audit.build).toHaveBeenCalledWith(
      { userId: 'user-1', tenantId: 'tenant-1', role: 'empresa' }, 'tenant-1', comparisonReport,
    );
    expect(result.audit_report).toBe(comparisonReport);
    expect(result.sst_audit_report).toBe(sstReport);
    const text = await extractPdfTextFull(Buffer.from(result.pdf_base64, 'base64'));
    expect(text).toContain('Divergência de ruído entre LIP e LTCAT');
    expect(text).not.toContain('undefined');
  });

  it('para técnico usa o tenant do corpo como alvo, mas o ctx sai do JWT', async () => {
    const comparison = { run: jest.fn(async () => comparisonReport) };
    const audit = { build: jest.fn(async () => sstReport) };
    const controller = new PenteFinoController(comparison as any, audit as any);

    await controller.run({ include_pdf: true, tenant_id: 'tenant-alvo' } as any, {
      user: { id: 'tec-1', tenantId: null, role: 'tecnico' },
    });

    expect(audit.build).toHaveBeenCalledWith(
      { userId: 'tec-1', tenantId: undefined, role: 'tecnico' }, 'tenant-alvo', comparisonReport,
    );
  });
});
```

Se `extractPdfTextFull` tiver outra assinatura, ler `backend/src/common/pdf/pdf-text.util.ts` e usar o helper que `sst-audit-pdf.unit-spec.ts` já usa para ler o PDF gerado.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /opt/Montese/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json pente-fino-controller --forceExit`
Expected: FAIL (construtor do controller só aceita 1 argumento; `audit.build` não é chamado).

- [ ] **Step 3: Implementar**

Em `pente-fino.controller.ts`: importar `SstAuditService` de `./sst-audit.service`, `TenantContext` de `../common/database/database.service`; trocar o construtor por
`constructor(private readonly comparison: PenteFinoComparisonService, private readonly sstAudit: SstAuditService) {}`
e substituir o trecho final de `run` por:

```ts
    const report = await this.comparison.run(tenantId, user);
    if (!dto.include_pdf) return report;

    const ctx: TenantContext = { userId: user.id, tenantId: user.tenantId ?? undefined, role: user.role };
    const sstAuditReport = await this.sstAudit.build(ctx, tenantId, report);
    const pdf = await buildSstAuditPdf(sstAuditReport);
    return {
      audit_report: report,
      sst_audit_report: sstAuditReport,
      pdf_base64: pdf.toString('base64'),
      pdf_file_name: `auditoria-montese-${Date.now()}.pdf`,
    };
```

Atualizar também o comentário do `@RateLimit` acima de `run`: com `include_pdf`, cada execução pode somar chamadas de extração de fatos (em lotes de até 8 páginas ou 16.000 caracteres, no máximo 2 em paralelo, em cache por sha256 do documento).

- [ ] **Step 4: Rodar e ver passar**

Run: mesmo comando do Step 2, depois `npx jest --config ./test/jest-unit.json pente-fino sst-audit --forceExit` e `npx tsc --noEmit`.
Expected: PASS; `tenant-context-callsites` continua com as mesmas falhas do baseline (nenhuma nova). Se aparecer o novo `sst-audit.service.ts` na lista de falhas, NÃO editar a lista ALLOWED: registrar e perguntar ao proprietário.

- [ ] **Step 5: Commit (proprietário)**

```bash
git add backend/src/pente-fino/pente-fino.controller.ts backend/test/pente-fino-controller.unit-spec.ts
git commit -m "feat(pente-fino): PDF da auditoria gerado a partir do relatório cruzado real"
```

---

### Task 4: Verificação ponta a ponta em ambiente descartável

**Files:** nenhum arquivo de produção. Só execução.

- [ ] **Step 1:** Rodar os specs afetados no host: `npx jest --config ./test/jest-unit.json pente-fino sst-audit --forceExit` e `npx tsc --noEmit`. Anotar resultado e comparar com o baseline (585/588; 3 falhas conhecidas).
- [ ] **Step 2:** Rodar `pente-fino-run.e2e-spec.ts` e `pente-fino-audit-facts-rls.e2e-spec.ts` SOMENTE em container node:20-alpine na rede `montese_internal`, com banco e Redis descartáveis (nota "Ensaio descartável e isolado"), com `SST_AUDIT_FACTS_PROVIDER` sobreposto por fake via `overrideProvider` (como o e2e existente faz com os outros providers). Não passar chaves reais de MiniMax/R2.
- [ ] **Step 3:** Para o e2e novo opcional: um teste em `pente-fino-run.e2e-spec.ts` com `include_pdf: true` e provider de fatos fake que devolve duas medições de ruído divergentes; esperar `sst_audit_report.findings[0].category === 'IN'` e `pdf_base64` não vazio. Escrever o teste seguindo o padrão do arquivo (fake de `getObject` com PDF real via `buildTestPdf`).
- [ ] **Step 4:** Registrar no handoff: VERIFICADO (o que rodou e passou), NÃO VERIFICADO (qualquer coisa não rodada, em especial chamadas reais ao MiniMax e o custo/tempo de extração em documentos reais).

---

## Fora de escopo (decisão dos sócios ou plano próprio)

- Novas regras normativas (hoje só existe a de ruído) e o catálogo versionado de fontes oficiais.
- Layout do PDF (logo, tabelas, estrutura do modelo): `buildSstAuditPdf` é texto corrido.
- `audit_id` único: hoje é `audit-<data>`, igual para empresas diferentes no mesmo dia. Corrigir exige alterar `buildSstAuditReport` e seu teste.
- Preencher `functions`, `lip_agents` e `agent_coverage` do `SstAuditReport` (hoje listas vazias em `buildSstAuditReport`).
- Impacto de custo: o frontend sempre manda `include_pdf: true`, então toda execução passa a extrair fatos. Medir custo e tempo reais antes de liberar para clientes; considerar um botão separado "Gerar PDF".
- Fluxo de captação do diagnóstico gratuito (upload sem cadastro completo, consentimento LGPD, anti-abuso).

## Self-review

- **Cobertura da spec:** este plano cobre só a ligação (extração → cruzamento → relatório → PDF) e a exibição de status parcial/não avaliado e de documentos ausentes. As demais exigências da spec (catálogo de regras versionado, layout Durant, grafo/crosswalk) estão em "Fora de escopo".
- **Placeholders:** nenhum; o único ponto condicional é a assinatura de `extractPdfTextFull` no teste da Task 3, com instrução explícita de onde conferir.
- **Consistência de tipos:** `SstAuditDocType`, `SstAuditAssemblerDocument` e `assembleSstAuditInput` têm a mesma forma nas Tasks 1 e 2; `SstAuditService.build(ctx, tenantId, report, now?)` é o mesmo nas Tasks 2 e 3.
- **Risco aberto:** o terceiro teste da Task 1 depende do número de resultados `not_reported` da regra atual (um, quando não há fatos). Confirmar na execução.
