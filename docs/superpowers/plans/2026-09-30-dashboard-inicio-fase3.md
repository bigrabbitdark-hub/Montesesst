# Dashboard "Início" — Fase 3: dados reais

> **Status: levantamento concluído (2026-09-30); execução aguardando aprovação
> das 3 decisões abaixo.** Sem commit automático (AGENTS.md). Testes e2e deste
> projeto rodam contra o Postgres real: usar o container descartável de
> `reference_running_tests_in_throwaway_container`, nunca `docker compose down -v`.

**Objetivo:** ligar `/dashboard-v2` a dados reais da empresa logada, por
`GET /api/dashboard/…` com tenant context/RLS, e mostrar "Em breve" (nunca
número inventado) nos blocos sem fonte real.

## 1. O que existe de real hoje (VERIFICADO no código)

Fonte: `backend/src/dashboard/dashboard.service.ts` (`GET /dashboard/summary`,
`@Roles('empresa','tecnico','parceiro')`, contexto de tenant vindo do usuário
autenticado, nunca do query param; técnico/parceiro passa por
`assertTenantLinked`).

| Bloco do dashboard v2 | Situação | Fonte real |
|---|---|---|
| Score SST | **Real, com ressalva** | `documents.getCompliance`: % de documentos *com validade* ainda em dia (vencendo em ≤30 dias conta como em dia). É score **documental**, não de SST inteira. `null` se não há documento com validade. |
| Selo de conformidade | **Real** | `status` do summary: `ok` / `atencao` / `critico` (regra já usada no dashboard atual). |
| Pendências | **Real** | `resumo.pendencias` e `atencao` (top 10): documentos, EPIs (CA), cargos×EPI/treinamento, equipamentos de incêndio, brigada, ações corretivas, CIPA, Pente-Fino, planos de ação. Cada item tem prioridade, data e link. |
| Vencimentos | **Real** | `atencao`/`proximos_eventos` (7 dias) e `compliance.avisos` (≤30 dias). Hoje o limite é 30 dias (o exemplo usava 60). |
| Auditoria Inteligente | **Parcial** | Só **PGR × PCMSO** existe de verdade, via Pente-Fino (`risco_sem_exame` = alta; `exame_sem_risco` = média). LTCAT, PPP, S-2240, S-2220 não existem. |
| Eventos recentes | **Parcial** | `proximos_eventos` (7 dias). Sem "eventos" de eSocial. |
| Empresas / filiais | **Falta endpoint** | Tabelas existem (`tenants`, `company_units`); precisa de contagem. |
| Funcionários | **Falta endpoint** | Tabela `employees`; precisa de contagem (só número, sem nomes). |
| Documentos | **Falta endpoint** | Tabela `documents`; contagem total. |
| Conformidade por NR | **Não existe** | Não há mapeamento documento/requisito → NR. |
| eSocial (S-2210/2220/2240) | **Não existe** | Só specs em `docs/specs/esocial-*.md`; nenhuma migration ou serviço. |
| Mensagem e ações da IA SST | **Não existe** | O Assistente normativo é chat; não gera resumo de auditoria. |
| Setores, Dias sem acidente, treinamentos etc. | **Não existe** | Fora do escopo dos blocos atuais. |

## 2. Decisões que preciso de você (com recomendação)

1. **Fórmula do Score SST — RECOMENDADO: manter a fórmula atual (score
   documental) agora**, chamá-la de "Score SST" na tela mas com o rótulo
   auxiliar "baseado em documentos com validade", e só trocar por uma fórmula
   composta quando você definir pesos. Motivo: qualquer fórmula composta inventa
   critério de conformidade legal (proibido pelo AGENTS.md sem fonte). Níveis
   propostos (decisão de produto, não normativa): 90–100 "Excelente", 80–89
   "Bom", 60–79 "Atenção", 0–59 "Crítico". Sem documentos com validade: mostrar
   "Sem dados" (não 0%).
2. **Regra do selo — RECOMENDADO: usar o `status` do backend** (`ok` →
   "Conforme"; `atencao` → "Conforme, com ressalvas"; `critico` → "Pendências
   críticas"), no lugar da regra provisória de front (`conformidadeSelo`).
   Assim `/empresa/dashboard` e o novo painel nunca discordam.
3. **Real vs "Em breve" — RECOMENDADO:** ligar agora os blocos marcados "Real",
   contagens novas (empresas, filiais, funcionários, documentos) e Auditoria só
   com PGR×PCMSO; blocos **Conformidade por NR** e **eSocial** viram cartões
   "Em breve" (sem número, sem barras). IA SST: mensagem e botões ficam "Em
   breve". Quando eSocial/NR tiverem backend, cada um vira sua própria fase.

## 3. Passos (após aprovação)

- [ ] **Task 1 — backend, contagens.** `GET /dashboard/overview` (mesmo
  controller/guardas, mesmo padrão de contexto de tenant) devolve
  `{ filiais, funcionarios, documentos }` **apenas contagens**. Teste e2e de
  isolamento: empresa A nunca vê contagem da B; técnico não vinculado → 403.
- [ ] **Task 2 — mapeadores puros no front** (`lib/dashboard/real.ts`): converte
  `DashboardSummary` + `overview` nos props dos componentes da Fase 2
  (ordenação, `dd/mm/aaaa`, nível do Score, "Sem dados"), com testes Vitest.
- [ ] **Task 3 — página.** Buscar com `AsyncBody` (loading/erro/"Tentar de
  novo"; 401 → login; 403 `SUBSCRIPTION_INACTIVE` → mensagem, igual ao
  dashboard atual/ITEM 016). Remover `SAMPLE` e a faixa de "dados de exemplo"
  **só** depois de todos os blocos estarem reais ou "Em breve".
- [ ] **Task 4 — "Em breve".** Componente `EmBreveCard` (título + texto
  "Disponível em breve", sem valor); usado em NR, eSocial e IA.
- [ ] **Task 5 — verificação.** typecheck, lint, Vitest, e2e do backend no
  container descartável, build, conferência visual com empresa de teste.
- [ ] **Task 6 — troca.** Só com seu OK explícito: `/empresa/dashboard` passa a
  apontar/redirecionar para o novo painel. Até lá, ele segue intacto.

## 4. Riscos e cuidados

- **LGPD/IA:** a tela mostra títulos com nome de funcionário (cargos, brigada)
  apenas ao próprio tenant (já é assim hoje). Nada disso vai para a IA; a
  lista `ATTENTION_TIPO_AI_SAFE` continua valendo.
- **Desempenho:** `summary` faz ~10 consultas em paralelo; `overview` são 3
  `count(*)` indexados por `tenant_id`. Sem chamada de LLM em rota de dashboard.
- **Consistência de dois painéis** durante a transição: por isso a decisão 2.
