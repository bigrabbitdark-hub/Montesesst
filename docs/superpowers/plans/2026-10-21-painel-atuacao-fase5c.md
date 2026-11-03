# Painel de Atuação — Fase 5C (tela do admin para responsabilidades e registros profissionais) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o admin configure, com segurança e sem presumir competência técnica, a matriz de responsabilidades por tipo de documento e os registros profissionais dos sócios, vendo antes se a configuração deixa o fluxo viável — sem nenhum poder de elaborar, revisar, aprovar, assinar ou publicar.

**Architecture:** (1) Backend: duas rotas de leitura **somente admin** (lista de sócios e verificação de viabilidade da matriz, função pura testável). (2) Frontend: página `/admin/documentos-fluxo` na área administrativa existente (um item novo de menu, sem alterar o restante do admin). As escritas reutilizam as rotas já prontas da Fase 5A.

**Tech Stack:** NestJS, TypeScript, PostgreSQL (`pg`), Jest; Next.js, React, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-painel-atuacao-fase5-documentos-design.md` (§1 decisões 2 e 3), `docs/superpowers/audits/2026-10-20-painel-atuacao-fase5a-separacao-funcoes.md` (§5: verificação de viabilidade). **Pré-requisitos:** Fases 5A e 5B prontas.

## Global Constraints

- Sem `commit`/`push`/`reset`. Nada em produção. Não ler `.env`/`ensaio.env`; **proibido** `/opt/Montese/run-backend-tests.sh` e docker fora do necessário (backend: nenhuma migration nesta fase). E2E: somente `<scratchpad>/reset-redis.sh >/dev/null && <scratchpad>/run-e2e.sh <padrão> > <log> 2>&1`, uma suíte por vez. Nunca passar senhas a subagentes. Não tocar nos arquivos alheios (`documents/inspections/0080`, `frontend/src/app/empresa/inspecoes`, `frontend/src/components/inspecoes`) nem em `documents.service.ts`.
- **Decisões vinculantes:** a matriz **não presume competência profissional** (profissão/cargo nunca libera nada); nenhum dado profissional real em código, seed ou teste (testes: conselho `TESTE`, número `0000`); o admin **não** ganha ação do fluxo; a verificação de viabilidade é **informativa** (não bloqueia a gravação da matriz, mas avisa) e nunca marca como "viável" o que o servidor bloquearia.
- **Regra de viabilidade (espelha o servidor):** para a categoria, é viável se existirem pessoas com: `elaborar` (E), `aprovar` (A), `assinar` (S) **com registro profissional confirmado**, `publicar` (P), e ao menos um aprovador **diferente** de algum elaborador (`SEPARACAO_PADRAO.aprovadorDiferenteDoElaborador`), ou seja, existe `e∈E` e `a∈A` com `a≠e`. Aviso (não impede): sem alguém em `revisar` diferente de algum elaborador, "devolver à elaboração" ficará indisponível. Categoria sem nenhuma linha na matriz ⇒ "Não configurada" (nenhuma ação funciona). A função recebe a flag de separação como parâmetro, de modo que ajustes futuros de `SEPARACAO_PADRAO` não exijam reescrever o resultado.
- Textos de confirmação **obrigatórios na interface** (exibidos e testados): ao gravar a matriz — "Habilitar uma ação autoriza esta pessoa a executá-la neste tipo de documento. Isto não comprova competência profissional; confirme com o responsável técnico."; ao confirmar um registro — "Confirme que o conselho, o número e a UF foram conferidos em fonte oficial do conselho profissional."; ao revogar — "A revogação impede novas assinaturas com este registro. Assinaturas já registradas permanecem no histórico.".
- Sem "assinatura digital"/"ICP-Brasil" em qualquer texto novo. Auditoria existente (`document_matrix.changed`, `professional_registration.*`) não muda e continua sem o número do registro; **a tela exibe o número ao admin** (dado do cadastro) mas nunca o coloca em URL, log do navegador ou mensagem de erro.
- Acessibilidade: labels, `role="alert"/"status"`, foco visível e gerenciado em diálogos, tabelas com cabeçalhos, estado em texto (não só cor), sem scroll horizontal da página no mobile. 401 ⇒ `/login`.
- Português do Brasil; rótulos VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
- Fora de escopo: tela para tarefas/agenda/financeiro do admin; atribuição de responsáveis por cliente; mudar `SEPARACAO_PADRAO`; migrations.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/src/atuacao/documentos/documento-fluxo.ts` (modificar) | `avaliarViabilidade` (função pura) |
| `backend/src/atuacao/documentos/documentos-admin.service.ts`, `documentos-admin.controller.ts` (modificar) | `GET socios`, `GET viabilidade` |
| `backend/test/documento-fluxo.unit-spec.ts`, `documentos-admin-service.unit-spec.ts` (modificar) | Unit |
| `backend/test/atuacao-documentos.e2e-spec.ts` (modificar) | E2E |
| `frontend/src/app/admin/documentos-fluxo/page.tsx` (+ componentes) (criar) | Tela |
| `frontend/src/components/admin/nav.ts` (modificar) | 1 item de menu |
| `frontend/src/app/admin/__tests__/documentos-fluxo-page.test.tsx` (criar) | Vitest |

---

### Task 1: Backend — sócios (admin) e verificação de viabilidade

**Interfaces (HTTP, `@Controller('atuacao/admin/documentos')`, `@Roles('admin')`, só `GET`):**
- `GET socios` → `{ id, nome }[]` (via `list_socios()`, que já funciona no contexto admin).
- `GET viabilidade` → `{ category, status: 'viavel'|'inviavel'|'nao_configurada', faltas: string[], avisos: string[], habilitados: { acao, pessoas: { id, nome, registro_confirmado?: boolean }[] }[] }[]` para **todas** as categorias de `CATEGORIAS_DOCUMENTO`. `registro_confirmado` só para a ação `assinar`. Não devolve conselho nem número.
- Função pura em `documento-fluxo.ts`: `avaliarViabilidade(input: { matriz: { userId: string; acoes: DocAcao[] }[]; registrosConfirmados: ReadonlySet<string>; separacao: typeof SEPARACAO_PADRAO }): { status; faltas: string[]; avisos: string[] }` — `faltas` em português e específicas (ex.: "Ninguém habilitado a assinar com registro profissional confirmado.", "O único aprovador é também o único elaborador, e o aprovador não pode ser o elaborador.").

- [ ] **Step 1: Testes que falham.** Unit da função pura (tabela): matriz vazia ⇒ `nao_configurada`; só elaborar ⇒ inviável com faltas de aprovar/assinar/publicar; A e E com a mesma única pessoa ⇒ inviável (separação) e viável com duas pessoas; assinar sem registro confirmado ⇒ inviável; registro confirmado ⇒ viável; `separacao.aprovadorDiferenteDoElaborador=false` ⇒ a mesma pessoa serve; aviso de "devolver" quando não há revisor diferente do elaborador; revogado/pendente não conta como confirmado. Unit do service (client mockado). E2E (semeie matriz e registros via `db.client` com dados `TESTE/0000`): resposta cobre todas as categorias; categoria sem linhas ⇒ `nao_configurada`; fluxo **fim-a-fim coerente com o servidor**: para uma categoria que a API marca `viavel`, o fluxo completo elaborar→aprovar→assinar→publicar de fato funciona (reutilize helpers da suíte); para uma marcada `inviavel` por falta de registro confirmado, `assinar` real dá 403; sócio/empresa/técnico/parceiro ⇒ 403 em `socios` e `viabilidade`; admin continua 403 nas rotas do sócio; respostas não contêm conselho nem número.
- [ ] **Step 2: Implementar**; **Step 3: Rodar** unit (`documento-fluxo documentos-admin socio-controller-sweep tenant-context-callsites`), `tsc`, e2e `atuacao-documentos` + regressão (`socio-access-matrix`, `atuacao-carteira`), `npm run build`; **Step 4: Checkpoint**.

---

### Task 2: Frontend — `/admin/documentos-fluxo`

**Files:** página + componentes, item em `nav.ts` (grupo "Sistema", rótulo "Documentos — responsabilidades", ícone existente adequado, `keywords` coerentes), teste Vitest. Padrões: `app/admin/ia/page.tsx`, `components/admin/Card.tsx`, `useAdminFetch.ts`, `api.ts` do admin, `admin-theme.css`, `convencoes-paginas.test.ts` (**ler e obedecer as convenções de páginas do admin**).

- [ ] **Step 1: Testes que falham (Vitest)**: página só renderiza para `admin` (RoleGuard já no layout); **Viabilidade**: um cartão por categoria com estado em TEXTO ("Viável", "Inviável", "Não configurada"), lista de faltas e avisos e quem está habilitado por ação; **Matriz**: seleção de categoria e tabela sócios × 5 ações (checkboxes rotulados), botão "Salvar" por sócio que abre diálogo com o texto obrigatório de confirmação, envia `PUT` só com as ações marcadas, mostra sucesso em `role="status"` e **recarrega a viabilidade**; erro 400/403/404 em `role="alert"` mantendo o diálogo; **Registros**: lista (sócio, conselho, número, UF, status em texto), formulário de cadastro (sócio, conselho 2–20, número 1–30, UF 2 letras maiúsculas) com validação antes de enviar, ações "Confirmar" (texto obrigatório) e "Revogar" (texto obrigatório) só para os estados aplicáveis, duplicata (409) com mensagem; o número do registro **não aparece** em mensagens de erro, URL nem `console`; aviso permanente de que a habilitação não comprova competência; nenhuma ação de elaborar/revisar/aprovar/assinar/publicar na página; varredura do DOM sem "assinatura digital"/"ICP-Brasil"; 401 ⇒ `/login`; sem corrida de requisições; estado vazio e erros isolados por seção.
- [ ] **Step 2: Implementar** (usar `adminFetch`; para POST/PUT crie helper no mesmo arquivo de api do admin seguindo o padrão, com 401 ⇒ `/login` e corpo JSON; mensagens do servidor mostradas sem reescrever).
- [ ] **Step 3: Rodar** `cd /opt/Montese/frontend && npx vitest run src/app/admin src/app/atuacao`, `npx vitest run`, `npx tsc --noEmit`, `npm run build`; QA visual NÃO VERIFICADO salvo se possível. **Step 4: Checkpoint**.

---

### Task 3: Verificação final da Fase 5C

- [ ] unit completo (esperado: só `r2-get-object` falhando, pré-existente), `tsc`, `npm run build`; e2e uma suíte por vez com `reset-redis.sh`: `atuacao-documentos atuacao-financeiro atuacao-agenda atuacao-tarefas atuacao-carteira socio-access-matrix subscription-status-guard tenant-isolation-sweep admin-dashboard-financeiro auth`; frontend `npx vitest run && npx tsc --noEmit && npm run build`; varredura estática de termos proibidos; blocos "Fase 5C — evidências" no relatório de auditoria e atualização da memória; parar para o proprietário.

---

## Auto-revisão

- **Decisão 2 (matriz sem presumir competência):** aviso fixo + diálogo obrigatório + viabilidade informativa — Tasks 1–2.
- **Decisão 3 (registros):** confirmar exige conferência em fonte oficial (texto obrigatório); número visível só ao admin; nada em log/URL — Task 2.
- **Recomendação da análise de separação:** verificação de viabilidade — Task 1.
- **Riscos declarados:** (1) a viabilidade espelha as regras do servidor por reimplementação em função pura: o e2e fim-a-fim a mantém honesta, mas uma mudança de regra exige atualizar as duas; (2) a página é a primeira escrita do admin sobre o fluxo — risco de uso indevido mitigado por confirmações e auditoria; (3) QA visual NÃO VERIFICADO.
