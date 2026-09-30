# Auditoria Montese Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renomear Pente-Fino para Auditoria Montese e expor achados de auditoria rastreáveis na página própria e no Assistente.

**Architecture:** `PenteFinoComparisonService` continua como fonte única de comparação e passa a retornar achados tipados com evidência. O painel existente consome o contrato aditivo tanto na página de auditoria quanto no Assistente; a rota e o endpoint atuais permanecem compatíveis.

**Tech Stack:** NestJS, TypeScript, PostgreSQL/RLS já existentes, Next.js, React, Jest e Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-auditoria-montese-design.md`

## Global Constraints

- Comparar somente fatos que os extratores atuais sustentam; página não capturada deve continuar marcada como não capturada.
- Ausência no conjunto de documentos recebido não prova inexistência; ausência de extração não vira achado factual.
- Diferenças numéricas são “a esclarecer”, não erro ou não conformidade automática.
- Manter `/empresa/pente-fino`, `/pente-fino/run`, autenticação, vínculo técnico/parceiro e `TenantContext` oriundo do JWT.
- Não criar grafo, persistência de relatórios, migration, regra normativa automática ou alteração de provider/modelo.
- Não incluir PII ou dados clínicos individuais desnecessários.
- Não criar commits automaticamente.

---

### Task 1: Achados determinísticos com evidência

**Files:**
- Modify: `backend/src/pente-fino/pente-fino-comparison.service.ts`
- Test: `backend/test/pente-fino-comparison.unit-spec.ts`
- Test: `backend/test/pente-fino-run.e2e-spec.ts`

**Interfaces:**
- Add `AuditFinding` to `PenteFinoReport` as an additive `audit_findings` array. `type` is `function_exam_gap | agent_coverage_gap | quantitative_divergence`; `status` is `inconsistency | insufficient_evidence | to_confirm`; `confidence` is `high | medium | low`. Each finding also contains `id`, `summary`, `evidence[]`, `limitations[]`, and `recommended_verification`.
- Each evidence item contains `document_id`, `title`, `source_excerpt`, and `page: null`; the page is null because current extraction does not capture it.
- Add a pure `buildMeasurementDivergenceFindings(lipRows: LipAgentRow[], ltcatRows: LipAgentRow[], lipDocument: PenteFinoDocumentRef, ltcatDocument: PenteFinoDocumentRef): AuditFinding[]` helper. It compares only exact normalized agent names and values with parseable, matching units; it emits a discrepancy only for unequal numeric values.
- `status` is `inconsistency` for a directly cited quantitative divergence, `to_confirm` for one-sided coverage/function-exam gaps, and `insufficient_evidence` only when a claim is present but the evidence needed to compare it is unavailable. No finding type is a legal NC.
- Confidence is deterministic: `high` for directly cited comparable facts on both sides, `medium` for direct single-sided coverage evidence, and `low` only for an explicitly labeled possibility. The initial implementation does not infer new risks from activity descriptions.

- [ ] **Step 1: Write failing unit tests for comparable measurements**

In `pente-fino-comparison.unit-spec.ts`, add tests for: same normalized agent + same normalized unit + different values emits one `inconsistency`/quantitative-divergence finding with both real excerpts and a recommendation to clarify; equal values emit none; different agents emit none; different or missing units emit no quantitative comparison; unparsable values emit no quantitative comparison.

- [ ] **Step 2: Run the focused unit test and confirm the new behavior fails**

Run from `backend/`:

```bash
NODE_OPTIONS=--experimental-vm-modules npm run test:unit -- --runTestsByPath test/pente-fino-comparison.unit-spec.ts
```

Expected: the new imports/assertions fail because the comparator and finding contract do not exist yet; existing tests remain unchanged.

- [ ] **Step 3: Implement strict value/unit parsing and the pure comparator**

Implement local helpers in `pente-fino-comparison.service.ts`. Accept only a single numeric value and explicit unit in `measuredValueRaw`; normalize decimal comma/dot and unit whitespace/case. Pair rows only when `normalizePositionText(agentNameRaw)` matches exactly and normalized units match. Do not compare by category alone and do not assign a tolerance.

- [ ] **Step 4: Run the focused unit test and confirm it passes**

Run from `backend/`:

```bash
NODE_OPTIONS=--experimental-vm-modules npm run test:unit -- --runTestsByPath test/pente-fino-comparison.unit-spec.ts
```

Expected: all existing comparison tests and the new comparator tests pass.

- [ ] **Step 5: Add typed findings for existing function/exam and agent coverage results**

Map the existing `functions` and `agent_coverage` results into `audit_findings` without changing their legacy fields. A missing extracted match is labeled `to_confirm`; one-sided LIP/LTCAT coverage is labeled `to_confirm`, never a contradiction. Include source document references and excerpts only when present. Include the quantitative findings from Step 3.

- [ ] **Step 6: Preserve agent source excerpts when reading cached extraction rows**

In `ensureAgentFindings`, select `source_excerpt` from `lip_agent_findings` and return it in cached `LipAgentRow` objects instead of `sourceExcerpt: ''`. Extend the existing cache-focused unit test with a cached excerpt and assert it reaches the report. This ensures evidence is stable on the second audit run, not only immediately after extraction.

- [ ] **Step 7: Verify the full audit response and evidence references in e2e**

Extend `pente-fino-run.e2e-spec.ts` to assert that a run includes the additive `audit_findings` array, preserves legacy fields, and includes the source excerpt/document reference for a supported finding. Keep the existing role/vínculo checks and do not weaken tenant isolation assertions.

- [ ] **Step 8: Run backend focused tests**

Run from `backend/`:

```bash
npm run test:unit -- --runTestsByPath test/pente-fino-comparison.unit-spec.ts
NODE_OPTIONS=--experimental-vm-modules npm run test:e2e -- --runTestsByPath test/pente-fino-run.e2e-spec.ts
```

Expected: both commands pass; the e2e requires the repository test database and Redis configured by the existing test environment.

### Task 2: Renomear e reaproveitar o painel

**Files:**
- Modify: `frontend/src/components/EmpresaSidebar.tsx`
- Modify: `frontend/src/components/PenteFinoPanel.tsx`
- Modify: `frontend/src/app/empresa/pente-fino/page.tsx`
- Modify: `frontend/src/app/tecnico/empresas/[tenantId]/page.tsx`
- Modify: `frontend/src/app/tecnico/empresas/[tenantId]/pente-fino/page.tsx`
- Test: `frontend/src/components/__tests__/PenteFinoPanel.test.tsx`

**Interfaces:**
- Keep the exported component name and its `tenantId?: string` prop to avoid unrelated route/API churn.
- Add an optional `presentation?: 'full' | 'assistant'` prop, defaulting to `full`. `assistant` shows the run action, summary and findings with expandable evidence in the same page; it does not fire a request during render/mount.
- Extend the frontend report type with the backend `audit_findings` contract while preserving existing report sections.

- [ ] **Step 1: Add failing component tests for the new report contract and manual action**

Create `PenteFinoPanel.test.tsx` using Vitest and Testing Library. Mock `fetch` and `localStorage`; assert that `assistant` presentation makes no request on mount, clicking “Executar Auditoria Montese” posts to `/api/pente-fino/run`, renders a returned finding with confidence and source excerpt, and displays a page as unavailable rather than inventing one when `page` is null. Add cases for `429` and API/network errors.

- [ ] **Step 2: Run the focused frontend test and confirm it fails**

Run from `frontend/`:

```bash
npm test -- src/components/__tests__/PenteFinoPanel.test.tsx
```

Expected: tests fail because the presentation prop, new action label, and `audit_findings` rendering are not implemented.

- [ ] **Step 3: Render typed findings and evidence in the shared panel**

Extend `PenteFinoPanel` to display finding type/status/confidence, summary, document title, source excerpt, limitations, and recommended verification. Keep the existing raw report sections available in full mode and make the assistant presentation expandable without executing another request. Render missing document/extraction information as “não localizado nos documentos disponíveis” or “não capturado”, based on the actual state. Replace all user-visible “Pente-Fino” text in this component, including loading-limit and error messages, with “Auditoria Montese”.

- [ ] **Step 4: Run the focused frontend test and confirm it passes**

Run from `frontend/`:

```bash
npm test -- src/components/__tests__/PenteFinoPanel.test.tsx
```

Expected: all new component states pass and no automatic fetch occurs.

- [ ] **Step 5: Rename visible navigation and page copy without changing paths**

Change client sidebar label, customer page heading/button, technician company card heading/link text, and technician report page heading to “Auditoria Montese”. Keep every existing `href`, route segment, API path, and exported identifier unchanged.

- [ ] **Step 6: Add the audit action to the customer Assistant page**

Render `<PenteFinoPanel presentation="assistant" />` in `frontend/src/app/empresa/assistente/page.tsx` before `AssistantChat`. Keep the normative chat and its request contract independent. The action remains user-triggered; link to the full audit route without auto-running either view.

- [ ] **Step 7: Run frontend typecheck and lint**

Run from `frontend/`:

```bash
npm run typecheck
npm run lint
```

Expected: both commands pass without new errors.

### Task 3: Cross-flow regression verification

**Files:**
- Verify: `backend/src/pente-fino/pente-fino.controller.ts`
- Verify: `backend/src/pente-fino/pente-fino-comparison.service.ts`
- Verify: `frontend/src/app/empresa/assistente/page.tsx`
- Verify: `frontend/src/components/PenteFinoPanel.tsx`

**Interfaces:**
- No new API route or tenant-selection contract. Company users use the tenant from JWT; technician/partner uses the current validated target-tenant flow.

- [ ] **Step 1: Run the full focused audit and frontend checks together**

From `backend/`:

```bash
NODE_OPTIONS=--experimental-vm-modules npm run test:unit -- --runTestsByPath test/pente-fino-comparison.unit-spec.ts
NODE_OPTIONS=--experimental-vm-modules npm run test:e2e -- --runTestsByPath test/pente-fino-run.e2e-spec.ts
```

From `frontend/`:

```bash
npm test -- src/components/__tests__/PenteFinoPanel.test.tsx
npm run typecheck
npm run lint
```

Expected: all commands pass; test environment availability is reported separately if database/Redis are unavailable.

- [ ] **Step 2: Review changed files for contract, copy, and tenant-safety regressions**

Verify the response remains additive, every displayed finding has source evidence or an explicit “a confirmar” state, empty extraction does not become proof of absence, and no client-provided tenant ID becomes the RLS context. Do not commit changes.