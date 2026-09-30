# Dashboard "Início" — Fase 2: Conteúdo dos blocos (com dados de exemplo)

> **Para quem executa:** usar superpowers:subagent-driven-development ou
> superpowers:executing-plans. Passos com checkbox. **Sem commit automático**
> (AGENTS.md) — o proprietário decide commit/push.

**Objetivo:** preencher os 10 blocos do casco `/dashboard-v2` (Fase 1) com
componentes de apresentação puros, alimentados pelo contrato de
`docs/dashboard-v2/fixtures/dashboard.sample.json`. **Sem backend, sem dados
reais** (isso é a Fase 3).

**Fontes:** `docs/specs/montese-design-system.md` (visual),
`docs/dashboard-v2/fixtures/dashboard.sample.json` (contrato),
maquete `docs/dashboard-v2/mockups/proposta-design-system.png`.

## Decisões já tomadas

- Design System de 2026-09-30 prevalece sobre a spec anterior.
- Rota paralela `/dashboard-v2`; o dashboard atual `/empresa/dashboard` (dados reais, ITEM 016) **não é tocado** até a Fase 3.
- Gráficos: barras simples em HTML/CSS (NR) e anel em SVG (Score). `recharts` já está instalado, mas só entra se um bloco realmente precisar.

## Perguntas em aberto (bloqueiam a Fase 3, não a Fase 2)

1. **Fórmula do Score SST.** O exemplo (92) não deriva de nenhum campo: média dos documentos ≈ 90,2; média das NRs ≈ 87,8; `auditoriaInteligente.score` = 89. Na Fase 2 o componente **recebe** o número pronto.
2. **Regra do selo de conformidade** ("Minha empresa está em conformidade?", regra de ouro). Proposta provisória, só para a Fase 2: **"Conforme"** (verde) se score ≥ 90 e 0 divergências críticas; **"Conforme, com ressalvas"** (âmbar) se score ≥ 80 ou houver críticas; **"Atenção"** (vermelho) se score < 80. Com o exemplo (92 e 1 crítica) dá âmbar, como na maquete. **A regra oficial é decisão do proprietário**; a Fase 2 a implementa como função isolada e testada, fácil de trocar.
3. **Inconsistências do exemplo:** `pendencias` (4) ≠ planos de ação (3); `divergencias` (14) e `criticas` (3) ≠ lista (3 e 1); S-2240 soma 129 para 128 funcionários. Os componentes não devem assumir que os totais batem com as listas.
4. **Dados de saúde/LGPD (S-2220, PPP, ASO):** na Fase 2 só há dados fictícios. Na Fase 3, decidir minimização antes de qualquer envio à IA (AGENTS.md, seção IA).
5. **Fonte real** de "Auditoria Inteligente", "eSocial" e "IA SST": não existem no backend hoje (ver docs/specs/esocial-*.md). A Fase 3 precisa dizer o que é real e o que fica "Em breve".

---

## Task 1: Tipos do contrato e função do selo

**Files:**
- Create: `frontend/src/lib/dashboard/types.ts`
- Create: `frontend/src/lib/dashboard/status.ts`
- Test: `frontend/src/lib/dashboard/__tests__/status.test.ts`

- [ ] **Step 1:** `types.ts` — interfaces `DashboardData`, `Cruzamento`, `PlanoAcao`, `NrConformidade`, `Notificacao`, `EsocialEvento`, com os campos exatos do JSON. Campos opcionais onde o JSON varia (`validade` e `responsavel` ausentes em `inventarioRiscos`/`planoAcao`). `Criticidade = 'Crítica'|'Alta'|'Média'|'Baixa'`.
- [ ] **Step 2 (teste primeiro):** `status.test.ts` cobre `scoreTone(score)` nas 4 faixas do Design System (0–59 vermelho, 60–79 laranja, 80–89 amarelo, 90–100 verde) incluindo bordas 59/60/79/80/89/90 e valores fora de 0–100 (clamp); e `conformidadeSelo(score, criticas)` conforme a pergunta 2 (função isolada).
- [ ] **Step 3:** rodar `npx vitest run` → FAIL; implementar `status.ts`; rodar → PASS.

## Task 2: Fixture de desenvolvimento

**Files:**
- Create: `frontend/src/lib/dashboard/sample.ts`

- [ ] **Step 1:** copiar o JSON de `docs/dashboard-v2/fixtures/` para `frontend/src/lib/dashboard/sample-data.json` e exportar `SAMPLE: DashboardData` tipado (`resolveJsonModule` — confirmar no `tsconfig`). Comentário no topo: **dados fictícios, não usar em produção**.
- [ ] **Step 2:** a página `/dashboard-v2` usa `SAMPLE` e exibe, no topo, uma faixa fixa "Dados de exemplo — não são da sua empresa" (acessível, `role="note"`), para ninguém confundir a pré-visualização com dados reais.

## Task 3: Componentes de indicador

**Files:**
- Create: `frontend/src/components/dashboard/KpiCard.tsx` (rótulo, valor, subtexto)
- Create: `frontend/src/components/dashboard/ScoreRing.tsx` (SVG, `role="img"` + `aria-label="Score SST 92%, Excelente"`, cor por `scoreTone`, texto do nível sempre visível — cor nunca é o único indicador)
- Test: `frontend/src/components/dashboard/__tests__/ScoreRing.test.tsx`

- [ ] **Step 1 (teste):** ScoreRing renderiza "92%" e o rótulo; `aria-label` presente; para 55 usa o tom vermelho e o texto do nível.
- [ ] **Step 2:** implementar; PASS.

## Task 4: Blocos da linha 2

**Files:** `NrBars.tsx`, `AuditoriaCard.tsx`, `PendenciasCard.tsx`
- `NrBars`: barra por NR, cor por faixa, valor em texto ao lado, marca da meta 90%.
- `AuditoriaCard`: lista de cruzamentos `origem × destino`, descrição, selo de criticidade com **texto** (`Badge`), cabeçalho "score N · M não conformidades". Ordenar por criticidade (Crítica primeiro).
- `PendenciasCard`: planos de ação com responsável, prazo `dd/mm/aaaa`, selo de prioridade.
- [ ] Testes: ordenação por criticidade; formatação de data `2026-10-15` → `15/10/2026`; lista vazia mostra "Nenhuma pendência".

## Task 5: Blocos da linha 3

**Files:** `EsocialCard.tsx`, `VencimentosCard.tsx`, `EventosCard.tsx`
- `EsocialCard`: S-2210/S-2220/S-2240 com enviados e pendentes (texto + cor).
- `VencimentosCard`: documentos com `validade`, ordenados; "vence em N dias" calculado a partir da data de referência **recebida por prop** (não `Date.now()` dentro do componente → testável). Exemplo do JSON: LTCAT 2026-11-25 a partir de 2026-09-30 = 56 dias (usar como teste).
- `EventosCard`: notificações por tipo (`warning|danger|info`) + mensagem da IA SST com ações (Gerar PDF, Abrir Auditoria) **desabilitadas com aviso "Em breve"** — não há backend para elas.
- [ ] Testes: cálculo de dias (56), ordenação, botões de IA desabilitados e rotulados.

## Task 6: Montagem e responsividade

**Files:** `frontend/src/app/dashboard-v2/page.tsx`
- [ ] Trocar os cards "Conteúdo na Fase 2" pelos componentes; manter a ordem do Design System.
- [ ] Responsivo: ≥1024px como a maquete; 768px sidebar recolhível (botão com `aria-expanded`); <768px blocos empilhados. Hoje a sidebar é fixa em 280px — este passo a torna recolhível.
- [ ] Header mostra o nome do usuário real quando existir; até lá, o nome da empresa (limitação já registrada).

## Task 7: Verificação

- [ ] `cd frontend && npm run typecheck && npx vitest run && npm run build` (não rodar `next build` com `next dev` no ar).
- [ ] Captura em 1440, 1024, 768 e 390 px; conferir contra a maquete.
- [ ] Acessibilidade: navegação por teclado, foco visível, contraste dos selos (texto ≥ 4,5:1), nenhum estado só por cor.
- [ ] Lint: os 2 erros e 4 avisos anteriores fora do escopo (`admin/auditoria`, etc.) continuam; os arquivos novos não podem acrescentar nenhum.

## Fora desta fase

Dados reais e endpoints (Fase 3), cálculo oficial do Score, permissões/RLS de novos dados (Fase 4), Lighthouse e a11y fina (Fase 5), troca do `/empresa/dashboard` pelo novo.
