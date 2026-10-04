# Relatório Completo de Auditoria Cruzada SST — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produzir na Auditoria Montese um relatório completo e rastreável de PGR, LTCAT, PCMSO e LIP na tela e em PDF, seguindo o modelo aprovado.

**Architecture:** Extrair fatos com página e citação literal em cache tenant-scoped, aplicar regras determinísticas ligadas a fontes oficiais vigentes/aprovadas, montar um snapshot estruturado e gerar o PDF no mesmo request quando solicitado. O front mantém o resultado e os bytes na memória até o usuário baixar; não há histórico ou PDF permanente.

**Tech Stack:** NestJS, PostgreSQL/RLS, Redis existente, MiniMax provider atual, `pdf-parse`, `pdfkit`, Next.js, React, Jest, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-relatorio-auditoria-cruzada-pdf-design.md`

## Global Constraints

- Uma NC exige evidência direta, regra oficial aplicável à data e comparação objetiva; nenhum exemplo do modelo é uma regra automática.
- Preservar documento, página, trecho literal, tipo de evidência, hash e versão do extrator em cada fato.
- “Não capturado”, “não localizado nos arquivos recebidos” e “não avaliado” nunca significam “inexistente” ou “conforme”.
- Usar fontes oficiais aprovadas e vigência confirmada; se a fonte/regra não puder ser confirmada, registrar revisão necessária e não emitir NC.
- Não enviar nomes/CPF ou resultado clínico individual desnecessário ao MiniMax; citar somente trechos sem esses identificadores.
- Preservar autenticação, `TenantContext` do JWT, vínculo técnico/parceiro, RLS e FORCE RLS. Nunca usar `tenant_id` do corpo como contexto RLS.
- Manter MiniMax como provider. Não persistir relatório/PDF em Postgres/R2; só cache de extração de fatos sob RLS.
- Os quatro documentos são PGR, LTCAT, PCMSO e LIP. PPP/eSocial não são validados sem dados fornecidos/integrados.
- Não executar migration em produção, deploy, commit ou push automaticamente.

## File Map

- `backend/src/common/pdf/pdf-text.util.ts`: parser PDF atual; receberá extração page-aware mantendo compatibilidade de `extractPdfTextFull`.
- `backend/src/pente-fino/`: tipos de fatos, provider MiniMax, cache/extrator, regras determinísticas, composição de relatório e renderizador PDF; o módulo atual é a fronteira de autorização e execução.
- `backend/db/migrations/0063_sst_audit_document_facts.sql`: registro de extração por hash/versão e fatos paginados, com cascade, índices, RLS e FORCE RLS.
- `backend/assets/brand/` e `backend/assets/fonts/`: logo horizontal oficial e fontes WOFF2 locais Poppins/Inter com licenças SIL OFL incluídas na imagem backend; PDFKit já traz `fontkit` com suporte WOFF2.
- `backend/assets/brand/`: logo horizontal oficial copiado para o contexto de build do backend.
- `backend/package.json`/lock: `@fontsource/poppins` e `@fontsource/inter` fornecem WOFF2 e licenças SIL OFL locais; PDFKit já traz `fontkit` com suporte WOFF2.
- `backend/Dockerfile`: copiar o logo para a imagem runtime; as fontes ficam nos pacotes de produção, sem download em runtime.
- `backend/test/`: specs unitários do parser/extrator/regras/PDF e e2e de execução/autorização.
- `frontend/src/components/PenteFinoPanel.tsx`: conservar resultado na sessão, exibir estado de cobertura e oferecer download explícito do PDF gerado pelo backend.
- `frontend/src/components/__tests__/PenteFinoPanel.test.tsx`: interação manual, PDF disponível/erro e download do mesmo resultado.

---

### Task 1: Extração PDF preservando páginas

**Files:**
- Modify: `backend/src/common/pdf/pdf-text.util.ts`
- Test: `backend/test/pdf-text-full.unit-spec.ts`

**Interfaces:**
- Add `export interface PdfPageText { pageNumber: number; text: string }`.
- Add `export async function extractPdfPages(buffer: Buffer): Promise<PdfPageText[]>`, adaptando `PDFParse.getText()` e `TextResult.pages[].num/text` do `pdf-parse` v2.
- Keep `extractPdfTextFull(buffer): Promise<string | null>` public contract, implemented from non-empty page texts joined in order.

- [ ] **Step 1: Escrever teste RED com PDF de duas páginas**

Use `pdfkit` como nos testes do backend para gerar um PDF em memória com frases distintas nas páginas 1 e 2. Verifique `[{ pageNumber: 1, text: ... }, { pageNumber: 2, text: ... }]`, a ordem, página vazia e o retorno compatível de `extractPdfTextFull`.

- [ ] **Step 2: Rodar o teste focal e confirmar falha por função ausente**

Run from `backend/`:

```bash
NODE_OPTIONS=--experimental-vm-modules npm run test:unit -- --runTestsByPath test/pdf-text-full.unit-spec.ts
```

Expected: falha porque `extractPdfPages` não existe; não aceitar falha de fixture/parser como RED correto.

- [ ] **Step 3: Implementar extração por página usando `PDFParse` v2**

Ler o resultado page-level do parser, devolver páginas numeradas a partir de 1, preservar texto de cada página e destruir o parser em `finally`. Reimplementar `extractPdfTextFull` como compatibilidade sem concatenar marcadores artificiais de página.

- [ ] **Step 4: Reexecutar unit test e validar os consumidores atuais**

Run:

```bash
NODE_OPTIONS=--experimental-vm-modules npm run test:unit -- --runTestsByPath test/pdf-text-full.unit-spec.ts test/pdf-text.unit-spec.ts
```

Expected: os dois arquivos passam e a extração sem texto continua devolvendo `null` no helper legado.

### Task 2: Cache de fatos com RLS

**Files:**
- Create: `backend/db/migrations/0063_sst_audit_document_facts.sql`
- Create: `backend/src/pente-fino/sst-audit-facts.types.ts`
- Test: `backend/test/pente-fino-audit-facts-rls.e2e-spec.ts`

**Interfaces:**
- `AuditEvidenceKind = 'quoted_claim' | 'direct_measurement' | 'document_metadata' | 'tenant_registry' | 'inference' | 'not_located'`.
- `SstAuditFact` tem `fact_type`, `subject_type`, `subject_raw`, `subject_key`, `value` (`Record<string, unknown>`), `unit`, `page_number`, `source_excerpt`, `evidence_kind`, `confidence` e referência à extração.
- `SstAuditDocumentExtraction` tem `id`, `tenant_id`, `document_id`, `document_sha256`, `extractor_version`, `page_count`, `status: 'complete' | 'partial' | 'failed'` e `created_at`.

- [ ] **Step 1: Escrever e2e RED para política e isolamento tenant**

O teste cria duas empresas por `TestDb`, aplica a migration, cria extração/fato no tenant A e usa contextos de A, B, técnico vinculado, técnico não vinculado e admin. A deve ver o fato; B e técnico não vinculado não; técnico vinculado e admin seguem as regras atuais. Verifique catálogo para RLS ativa e forçada.

- [ ] **Step 2: Rodar migration/e2e apenas em DB e Redis descartáveis**

Run from `backend/` com `TEST_SUPERUSER_DATABASE_URL` e `REDIS_URL` apontando para recursos descartáveis:

```bash
NODE_OPTIONS=--experimental-vm-modules npm run test:e2e -- --runTestsByPath test/pente-fino-audit-facts-rls.e2e-spec.ts
```

Expected: falha RED por migration/tabelas ausentes. Nunca apontar esse teste ao banco `montese` da aplicação.

- [ ] **Step 3: Implementar migration 0063 e tipos**

Criar tabela de extrações única por documento/hash/versão e tabela de fatos vinculada por FK. Ambas levam `tenant_id`, índice por tenant/document/extraction, cascata ao apagar documento, RLS + FORCE RLS e policy com admin, tenant atual e `assigned_tenant_ids_for_current_user()`.

- [ ] **Step 4: Rodar o e2e de RLS novamente**

Run:

```bash
NODE_OPTIONS=--experimental-vm-modules npm run test:e2e -- --runTestsByPath test/pente-fino-audit-facts-rls.e2e-spec.ts
```

Expected: isolamento de todos os papéis passa; registrar o requisito de ambiente descartável no runbook.

### Task 3: Extrator estruturado por documento/página

**Files:**
- Create: `backend/src/pente-fino/sst-audit-facts-provider.interface.ts`
- Create: `backend/src/pente-fino/minimax-sst-audit-facts-provider.service.ts`
- Create: `backend/src/pente-fino/sst-audit-facts.service.ts`
- Modify: `backend/src/pente-fino/pente-fino.module.ts`
- Use: `backend/src/common/text/pii-redaction.util.ts`
- Test: `backend/test/sst-audit-facts.unit-spec.ts`

**Interfaces:**
- `SstAuditFactCandidate` contém `factType`, `subjectType`, `subjectRaw`, `subjectKey`, `value: Record<string, string | number | boolean | null>`, `unit`, `pageNumber`, `sourceExcerptMasked` e `evidenceKind: 'quoted_claim' | 'direct_measurement' | 'document_metadata'`.
- `SstAuditExtractionPayload` é `{ facts: SstAuditFactCandidate[] }`; provider `extract(input: { documentType: 'pgr' | 'ltcat' | 'pcmso' | 'lip'; pages: PdfPageText[]; groupIndex: number }): Promise<SstAuditExtractionPayload>`.
- Service: `getFacts(ctx: TenantContext, document: Document): Promise<SstAuditDocumentExtraction & { facts: SstAuditFact[] }>`.
- `FACT_EXTRACTOR_VERSION` identifica a versão do contrato do provider/cache.

- [ ] **Step 1: Escrever unit tests RED para páginas, citação, privacidade e cache**

Com provider/R2/DB fakes, cobrir: citação mascarada na página correta aceita; página inexistente ou excerto que só aparece em outra página rejeitado; zero fatos é cacheado como extração completa; hash/versão igual reutiliza cache; hash/versão diferente reextrai; nome/CPF cadastrado não é enviado ao provider; página com resultado clínico individual inseparável é marcada `not_evaluated`; saída que ainda cita identificador individual é descartada.

- [ ] **Step 2: Rodar o spec novo e confirmar falha pelo serviço/provider ausente**

Run from `backend/`:

```bash
npm run test:unit -- --runTestsByPath test/sst-audit-facts.unit-spec.ts
```

- [ ] **Step 3: Implementar leitura R2, checksum, sanitização e cache**

Baixar o arquivo do R2, calcular SHA-256, extrair páginas e remover CPF/nomes cadastrados antes de chamar MiniMax. Para o PCMSO, enviar apenas riscos/funções/exames previstos e periodicidade necessários; excluir resultados clínicos individuais. Se um bloco sensível não puder ser isolado com segurança, não enviá-lo e marcar a página como `not_evaluated`. Particionar páginas contíguas de acordo com o limite de contexto documentado do modelo configurado, mantendo `pageNumber` e índice do grupo, com concorrência máxima 2. Validar cada candidato contra a versão mascarada do texto naquela página e contra schema/tipo permitido; validar de novo que o trecho final não contém CPF/nome/resultado individual; nunca persistir inferências como fatos documentados. Falha parcial marca `partial` com páginas afetadas; falha integral marca `failed` sem converter para resultado vazio/conforme.

- [ ] **Step 4: Persistir extração/fatos em contexto tenant e registrar uso do provider**

Usar `DatabaseService.withTenantContext` para todas as consultas/escritas; não segurar conexão durante chamada ao MiniMax. Preservar `AiUsageLogService`/provider MiniMax conforme o padrão existente.

- [ ] **Step 5: Reexecutar unit tests do extrator**

Run:

```bash
npm run test:unit -- --runTestsByPath test/sst-audit-facts.unit-spec.ts
```

Expected: todos os casos de citação, redaction, cache e partial extraction passam.

### Task 4: Entidades canônicas, matriz e regras versionadas

**Files:**
- Create: `backend/src/pente-fino/sst-audit-rules.ts`
- Create: `backend/src/pente-fino/sst-audit-rules.service.ts`
- Create: `backend/test/sst-audit-rules.unit-spec.ts`
- Modify: `backend/src/pente-fino/pente-fino-comparison.service.ts`

**Interfaces:**
- `RuleResult` contém `outcome: 'NC' | 'IN' | 'EA' | 'RC' | 'AT' | 'RT' | 'consistent' | 'not_applicable' | 'not_reported' | 'not_evaluated'`, `summary`, `fact_ids`, `limitations[]` e `recommended_verification`.
- `SstAuditRule` contém `id`, `source_code`, `source_document_id`, `source_content_hash`, `item`, `official_url`, `valid_from`, `valid_to`, `required_fact_types`, `evaluate(facts, auditDate): RuleResult` e prioridade/recomendação da regra.
- `SstAuditFinding` contém `id`, `category: 'NC' | 'IN' | 'EA' | 'RC' | 'AT' | 'RT'`, `status: 'confirmed' | 'to_confirm' | 'insufficient_evidence'`, `confidence: 'high' | 'medium' | 'low'`, `summary`, `evidence: AuditEvidence[]`, `limitations[]`, `rule_reference?`, `recommended_verification` e `priority?: 1 | 2 | 3`.
- `CoverageCell` contém `item`, `document_results: { document_type; status: 'consistent' | 'divergent' | 'not_applicable' | 'not_reported' | 'not_evaluated'; fact_ids: string[]; evidence: AuditEvidence[] }[]`.
- `buildSstCoverageMatrix(facts, documentRefs): CoverageCell[]` gera uma célula por item do modelo e não preenche campos sem fato.

- [ ] **Step 1: Escrever testes RED para as cinco regras do modelo**

Cobrir (1) ruído comparado só com mesmo agente/unidade, divergência vira IN; (2) LTCAT e ruído só vira NC se valor, critério, setor/função e regra aplicável estiverem presentes; (3) LIP “salubre” com EPI sem cadeia de eficácia vira EA/RT, nunca NC automática; (4) periodicidade PCMSO versus risco PGR exige regra vigente/data e relação funcional; (5) risco relevante sem ação correspondente no plano vira achado apenas quando o risco e o plano foram extraídos. Adicionar casos de método/população diferentes, dados faltantes e regra fora de vigência: nenhum deve emitir NC.

- [ ] **Step 2: Rodar os testes RED**

Run:

```bash
npm run test:unit -- --runTestsByPath test/sst-audit-rules.unit-spec.ts
```

- [ ] **Step 3: Implementar crosswalk sem casamento silencioso**

Normalizar empresa, setor, função, agente, unidade e período sem apagar os valores raw. Ligar entidades apenas por correspondência exata/canônica existente; ambiguidades viram `RC`/`RT` com evidências, nunca vínculo presumido.

- [ ] **Step 4: Implementar registry testável com fonte oficial e vigência**

Criar no registry apenas regras cobertas por fonte oficial aprovada. Cada avaliação verifica `official_sources.active`, `normative_documents.id/status/content_hash` do documento aprovado, `valid_from <= audit_date` e (`valid_to` nulo ou `audit_date <= valid_to`). Datas de aplicação fazem parte da entrada revisada da regra (o schema normativo atual não as fornece por item); regra sem intervalo aprovado devolve `RT` sem conclusão normativa. Incluir jurisprudência como referência distinta quando disponível e aprovada; não criar artigos ou consequências por aproximação.

- [ ] **Step 5: Implementar classificação, confidence e matriz**

Funções puras determinam NC/IN/EA/RC/AT/RT, confiança baseada em evidência direta e prioridade explicável. NC requer confidence alta e regra aplicável; RC inferido tem baixa confiança. Cobertura de documento/fato usa explicitamente `not_reported` versus `not_evaluated`.

- [ ] **Step 6: Reexecutar unit tests das regras/matriz**

Run:

```bash
npm run test:unit -- --runTestsByPath test/sst-audit-rules.unit-spec.ts test/pente-fino-comparison.unit-spec.ts
```

Expected: regras novas passam e contratos unitários anteriores do Pente-Fino permanecem compatíveis.

### Task 5: Compor o relatório completo

**Files:**
- Create: `backend/src/pente-fino/sst-audit-report.service.ts`
- Create: `backend/test/sst-audit-report.unit-spec.ts`
- Modify: `backend/src/pente-fino/pente-fino-comparison.service.ts`

**Interfaces:**
- `SstAuditInput` contém `audit_date`, `company`, `documents`, `facts`, `rule_results`, `scope_counts` e `extraction_status` por documento/página.
- `SstAuditReport` contém `audit_id`, `generated_at`, `audit_status: 'complete' | 'partial' | 'not_evaluable'`, `company`, `documents[]`, `scope_counts`, `summary: { conclusion; nc_count; inconsistency_count; missing_evidence_count; risks_to_confirm_count; first_correction_priority? }`, `coverage_matrix: CoverageCell[]`, `findings: SstAuditFinding[]`, `recommendations[]`, `limitations[]` e os campos legados `functions`, `lip_agents`, `agent_coverage`, `warnings`.
- `buildSstAuditReport(input: SstAuditInput): SstAuditReport` é puro; não chama DB/R2/LLM.

- [ ] **Step 1: Escrever testes RED de composição por seção**

Usar facts sintéticos para cobrir as seções 1–8, matriz `Igual/Divergente/Não se aplica/Não informa/Não avaliado`, resumo determinístico com contagens, documento faltante, página ilegível, limites/ressalvas, priorização, CNAE/validade/assinatura desconhecidos e ausência de dados de PPP/eSocial. Verificar que não aparecem nome/CPF/resultados de empregado nem cliente Durant do modelo.

- [ ] **Step 2: Rodar o spec RED**

Run:

```bash
npm run test:unit -- --runTestsByPath test/sst-audit-report.unit-spec.ts
```

- [ ] **Step 3: Montar snapshots de documento e escopo**

Usar cadastro da empresa apenas para os campos existentes (razão social/CNPJ/endereço); demais campos vêm de fatos de documento. Separar `expires_at` do sistema de validade declarada no texto. Calcular páginas pelo parser; timestamps usam `America/Sao_Paulo`. Identificador de auditoria nunca aparece como validation/signature code.

- [ ] **Step 4: Construir resumo e seções somente dos resultados determinísticos**

Agrupar findings por NC/IN/EA/RC/AT/RT. `complete` quer dizer quatro documentos recebidos e todas as páginas extraíveis; `partial` declara faltas; `not_evaluable` quando não houver cruzamento confiável. Nenhum desses estados é “100% conforme”.

- [ ] **Step 5: Reexecutar composição**

Run:

```bash
npm run test:unit -- --runTestsByPath test/sst-audit-report.unit-spec.ts
```

### Task 6: Renderizar PDF multi-página

**Files:**
- Create: `backend/src/pente-fino/sst-audit-pdf.service.ts`
- Create: `backend/test/sst-audit-pdf.unit-spec.ts`
- Create: `backend/assets/brand/logo-horizontal.jpg`
- Modify: `backend/Dockerfile`
- Modify: `backend/package.json` e `backend/package-lock.json`
Copiar `frontend/public/brand/logo-horizontal.jpg` sem alteração para `backend/assets/brand/logo-horizontal.jpg`. Em `backend/`, adicionar `@fontsource/poppins` e `@fontsource/inter`, conferir a licença SIL OFL e resolver WOFF2 latinos por `require.resolve('@fontsource/poppins/files/poppins-latin-400-normal.woff2')` e os arquivos equivalentes de Poppins bold/Inter normal/bold. Confirmar a leitura pelo PDFKit num teste com acentos PT-BR. Atualizar o Dockerfile runtime para copiar `backend/assets/brand`; os pacotes ficam instalados por `npm install --omit=dev`.

**Interfaces:**
- `buildSstAuditPdf(report: SstAuditReport): Promise<Buffer>`.
- A função é determinística para o mesmo snapshot; não consulta DB/R2, não chama LLM e não escreve no disco.

- [ ] **Step 1: Escrever unit test RED do conteúdo PDF**

Montar um `SstAuditReport` sintético multi-página e verificar que o buffer começa com `%PDF`, tem tamanho > 0 e, ao passar pelo `extractPdfTextFull`, contém título, identificação, NC, IN, EA/RC, recomendações, ressalvas e número de página. Testar datas grandes, trechos longos e tabelas que cruzam página.

- [ ] **Step 2: Rodar o teste PDF RED com VM modules**

Run:

```bash
NODE_OPTIONS=--experimental-vm-modules npm run test:unit -- --runTestsByPath test/sst-audit-pdf.unit-spec.ts
```

- [ ] **Step 3: Empacotar marca e fontes locais**

Copiar `frontend/public/brand/logo-horizontal.jpg` sem alteração para `backend/assets/brand/logo-horizontal.jpg`. Em `backend/`, adicionar `@fontsource/poppins` e `@fontsource/inter`, conferir a licença SIL OFL e resolver WOFF2 latinos por `require.resolve('@fontsource/poppins/files/poppins-latin-400-normal.woff2')` e os arquivos equivalentes de Poppins bold/Inter normal/bold. Confirmar a leitura pelo PDFKit num teste com acentos PT-BR. Atualizar o Dockerfile runtime para copiar `backend/assets/brand`; os pacotes ficam instalados por `npm install --omit=dev`.

- [ ] **Step 4: Implementar cabeçalho, rodapé e tabelas paginadas**

Usar PDFKit A4, logo, título azul-marinho, acento verde Montese, fontes locais, zebra de tabela, cabeçalho repetido, page break antes de ficha NC que não caiba, número total/página no rodapé e texto de footer do relatório. Não desenhar tudo como strings concatenadas: quebrar linhas por célula e calcular altura antes de renderizar a linha.

- [ ] **Step 5: Reexecutar testes e inspecionar PDF multi-página**

Run:

```bash
NODE_OPTIONS=--experimental-vm-modules npm run test:unit -- --runTestsByPath test/sst-audit-pdf.unit-spec.ts
```

Renderizar a fixture de teste em imagem/PDF e revisar cabeçalhos repetidos, células cortadas, acentos, cabeçalho/rodapé e o logo; não usar dados reais de empresa nos fixtures.

### Task 7: Integrar endpoint e download no painel

**Files:**
- Modify: `backend/src/pente-fino/dto/run-pente-fino.dto.ts`
- Modify: `backend/src/pente-fino/pente-fino.controller.ts`
- Modify: `backend/src/pente-fino/pente-fino.module.ts`
- Modify: `backend/src/pente-fino/pente-fino-comparison.service.ts`
- Modify: `frontend/src/components/PenteFinoPanel.tsx`
- Test: `frontend/src/components/__tests__/PenteFinoPanel.test.tsx`
- Test: `backend/test/pente-fino-run.e2e-spec.ts`

**Interfaces:**
- `RunPenteFinoDto.include_pdf?: boolean` com validação `@IsOptional()` e `@IsBoolean()`.
- `POST /pente-fino/run` mantém os campos atuais; com `include_pdf: true`, a resposta inclui `audit_report`, `pdf_base64`, `pdf_file_name`. Clientes antigos que não enviam a flag mantêm JSON legado/aditivo sem PDF.
- A UI armazena `audit_report` e PDF base64 no estado local. Após sucesso apresenta “Baixar PDF”; clique converte base64 para `Blob('application/pdf')`, baixa com o nome retornado e revoga o object URL.

- [ ] **Step 1: Escrever testes frontend RED para estado e download**

Estender os testes atuais para afirmar: request manual envia `include_pdf: true`; o relatório aparece; “Baixar PDF” não aparece antes do sucesso; download usa o base64/nome retornados sem outro fetch; resposta sem PDF mantém achados visíveis e mostra erro de geração; 429/rede não cria arquivo.

- [ ] **Step 2: Rodar os testes frontend RED**

Run from `frontend/`:

```bash
npm test -- src/components/__tests__/PenteFinoPanel.test.tsx
```

- [ ] **Step 3: Escrever e2e RED para endpoint JSON+PDF**

No `pente-fino-run.e2e-spec.ts`, ampliar providers fake com facts sintéticos por página e logo/font fixture. Assertar `include_pdf:true` produz JSON legado + `audit_report` + base64 decodificável com `%PDF`; `include_pdf:false` não inclui PDF. Preservar asserts atuais de 401, vínculo e RLS; resposta do técnico não vinculado não pode incluir dados nem PDF.

- [ ] **Step 4: Implementar DTO e composição única do snapshot**

O serviço executa extração/cache, engine e `buildSstAuditReport` uma vez. Se `include_pdf`, chama `buildSstAuditPdf` com o mesmo objeto e anexa Base64/nome. Capturar falha de render como campo de erro isolado sem descartar o relatório JSON.

- [ ] **Step 5: Implementar a ação baixar no painel**

Solicitar a flag, salvar bytes/nome no estado local, apresentar CTA acessível só quando PDF existe e baixar sem nova análise. Mostrar erro independente para PDF; não limpar resultado da tela. Manter caminhos/rate-limit/autorização existentes.

- [ ] **Step 6: Rodar unit, frontend e e2e em ambiente descartável**

Run from `backend/`:

```bash
NODE_OPTIONS=--experimental-vm-modules npm run test:unit -- --runTestsByPath test/sst-audit-facts.unit-spec.ts test/sst-audit-rules.unit-spec.ts test/sst-audit-report.unit-spec.ts test/sst-audit-pdf.unit-spec.ts test/pente-fino-comparison.unit-spec.ts
NODE_OPTIONS=--experimental-vm-modules npm run test:e2e -- --runTestsByPath test/pente-fino-run.e2e-spec.ts test/pente-fino-audit-facts-rls.e2e-spec.ts
npm run build
```

Run from `frontend/`:

```bash
npm test
npm run typecheck
npm run build
```

E2E só roda com `TEST_SUPERUSER_DATABASE_URL` e Redis descartáveis; nunca apontar para o banco/Redis de produção.

### Task 8: Homologar e preparar release

**Files:**
- Verify: `docs/operations/release-backend-2026-09-30.md`
- Verify: `backend/src/pente-fino/**`
- Verify: `frontend/src/components/PenteFinoPanel.tsx`

**Interfaces:**
- Uma execução gera o mesmo snapshot para tela/PDF, respeita escopo tenant e não cria histórico permanente.

- [ ] **Step 1: Executar auditoria com quatro documentos sintéticos multipágina**

Usar provedor fake e os mesmos facts de teste para todas as seções; conferir Status `complete`, output PDF, count da matriz, NC/IN/EA/RC e ressalvas. Rodar novamente sem alterar arquivos e confirmar cache por hash/versão; substituir um PDF e confirmar reextração.

- [ ] **Step 2: Testar geração parcial e falhas controladas**

Sem um documento, com PDF sem texto, uma página ilegível, fonte normativa pendente, falha de provider e falha de PDF: verificar `partial`/`not_evaluable` ou erro apropriado, sem transformar falha em “ausência” nem perder resultados disponíveis.

- [ ] **Step 3: Revalidar segurança**

Verificar empresa própria, técnico vinculado, não vinculado, resposta não autorizada sem campos/PDF, RLS/FORCE RLS nas novas tabelas e ausência de nomes/CPF/dados clínicos no provider fake e no PDF.

- [ ] **Step 4: Executar gates finais e registrar o resultado**

Build, testes unitários, e2e isolado, typecheck, lint e inspeção visual de PDF são pré-requisitos de homologação. Atualizar o runbook com hashes/commit e resultados; execução de migration ou deploy exige autorização separada do proprietário. Não commitar nem fazer push automaticamente.