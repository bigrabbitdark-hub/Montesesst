# Painel de Atuação — Fase 5B (telas do fluxo de documentos) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar aos sócios as telas do fluxo de documentos (lista, criação de rascunho, detalhe com linha do tempo, versões, ações permitidas e registro de assinatura interna), refletindo fielmente as regras que o servidor já impõe.

**Architecture:** Somente frontend em `/atuacao/documentos`. A tela **nunca decide** permissões: ela mostra exatamente as ações devolvidas pela API em `acoes_permitidas` e as mensagens de bloqueio do servidor. Reaproveita a casca `/atuacao` e os padrões das fases anteriores. Nenhuma alteração de backend ou banco.

**Tech Stack:** Next.js, React, TypeScript, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-painel-atuacao-fase5-documentos-design.md` (§1 decisões vinculantes, §5). **Pré-requisitos:** Fase 5A (backend) pronta. **Contratos:** ler `backend/src/atuacao/documentos/documentos.controller.ts`, `documentos.service.ts` (tipos do resumo e do detalhe), `dto/documentos.dto.ts` e `documento-fluxo.ts` (constantes `AVISO_ASSINATURA_INTERNA`, `MSG_ACAO_NAO_HABILITADA`).

## Global Constraints

- Sem `commit`/`push`/`reset`. Não ler `.env`; **proibido** docker e `/opt/Montese/run-backend-tests.sh`. Não tocar nos arquivos alheios (`frontend/src/app/empresa/inspecoes`, `frontend/src/components/inspecoes`) nem em backend/banco. Nunca passar senhas a subagentes.
- **O aviso da assinatura interna é exibido exatamente como a API devolve** (`aviso_assinatura`), em destaque, junto a toda assinatura e ao botão de assinar. **Nenhum texto da interface** usa "assinatura digital", "ICP-Brasil" (fora do aviso vindo da API), "válido juridicamente" ou equivalentes. O botão se chama **"Registrar assinatura interna"**, e o rótulo da seção, **"Assinaturas internas registradas"**.
- Ações exibidas = `acoes_permitidas` da API; ações ausentes não aparecem como botões ativos. Quando o usuário não tem a ação, mostrar a **mensagem do servidor** (ex.: `MSG_ACAO_NAO_HABILITADA`) em `role="alert"`, sem reinterpretar.
- Conselho, número e UF do signatário **só são exibidos se a API os devolver** (depende de `documents.view_registration`); caso contrário mostrar "Registro profissional confirmado: sim/não" e o nome. Nunca inferir nem completar.
- Datas pt-BR (`dd/mm/aaaa`) sem converter fuso de `DATE`; carimbos de tempo em `America/Sao_Paulo`. Hash (SHA-256) exibido abreviado (8 primeiros + 8 últimos) com o valor completo acessível ao leitor de tela e por cópia.
- Upload: aceitar os mesmos tipos que `documents` (PDF, JPEG, PNG, DOCX, XLSX), até 10 MB; validar antes de enviar (UX; o servidor decide); resposta 413/400 com mensagem clara.
- Acessibilidade: labels, `role="alert"/"status"`, foco visível, foco gerenciado em diálogos, cartões no mobile, sem scroll horizontal da página. 401 ⇒ limpa a sessão e `/login`; 403 ⇒ "Você não tem permissão para esta ação.".
- Sem números ou dados fictícios; erros isolados por seção; guarda `useRef` contra corrida de requisições; PATCH/POST enviam só o necessário.
- Texto livre pode conter dado pessoal: nos campos de nota, mostrar o aviso "Não inclua dados pessoais sensíveis ou de saúde." (política de retenção LGPD ainda em validação).
- Fora de escopo: tela do admin para matriz e registros; geração de documentos; indexação RAG; edição de conteúdo; assinatura em lote; notificações.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `frontend/src/app/atuacao/api.ts` (modificar) | Tipos, rótulos de estado/ação/evento, upload multipart, helpers |
| `frontend/src/app/atuacao/documentos/page.tsx` (criar) | Lista, filtros, criar rascunho |
| `frontend/src/app/atuacao/documentos/[id]/page.tsx` (criar) | Detalhe e ações |
| `frontend/src/app/atuacao/documentos/[id]/*.tsx` (criar, opcional) | Componentes: linha do tempo, versões, assinaturas, diálogo de nota |
| `frontend/src/lib/dashboard/menu-atuacao.ts`, `frontend/src/app/atuacao/page.tsx` (modificar) | Menu e KPI |
| `frontend/src/app/atuacao/clientes/[tenantId]/page.tsx` (modificar) | Atalho "Documentos deste cliente" |
| `frontend/src/app/atuacao/__tests__/documentos.test.tsx`, `documento-detalhe.test.tsx` (criar) | Vitest |

---

### Task 1: Lista, criação de rascunho, menu e KPI

**Files:** conforme tabela (api.ts, `documentos/page.tsx`, menu, painel, ficha do cliente, `documentos.test.tsx`).

- [ ] **Step 1: Testes que falham (Vitest)**: menu ganha "Documentos" (`/atuacao/documentos`) e só rotas existentes; lista traz título, cliente, categoria, estado (rótulo em português + `Badge` e texto), versão atual e última atualização; filtros por estado, categoria e cliente enviam `status`, `category`, `tenantId`; sem corrida de requisições; estado vazio ("Nenhum documento em elaboração."); erro com "Tentar novamente"; 403 com a frase padrão; 401 limpa sessão e vai a `/login`; **criar rascunho** (cliente via `GET /atuacao/clientes`, categoria, título, unidade opcional) envia só os campos preenchidos, navega ao detalhe em sucesso e, em 403 com a mensagem de matriz, exibe **exatamente** a mensagem do servidor mantendo o formulário; KPI do painel "Documentos aguardando ação" calculado a partir de `GET /atuacao/documentos` (contagem real de `em_revisao|aprovado|assinado`, sem números fictícios, erro isolado); ficha do cliente ganha o link "Documentos deste cliente" (`/atuacao/documentos?tenantId=...`).
- [ ] **Step 2: Implementar** seguindo os padrões das fases anteriores (`AsyncBody`, `KpiCard`, `PageHeader`, `Badge`).
- [ ] **Step 3: Rodar** `cd /opt/Montese/frontend && npx vitest run src/app/atuacao`, `npx vitest run`, `npx tsc --noEmit`, `npm run build`.
- [ ] **Step 4: Checkpoint** — listar arquivos.

---

### Task 2: Detalhe do documento e ações do fluxo

**Files:** `documentos/[id]/page.tsx` (+ componentes), `api.ts`, `documento-detalhe.test.tsx`.

- [ ] **Step 1: Testes que falham (Vitest)**:
  - Cabeçalho: título, cliente, categoria, estado; **linha do tempo** em ordem cronológica com ator ("de {nome}" em texto), tipo do evento traduzido, nota e data/hora; lista de **versões** (número, arquivo, tamanho, hash abreviado + completo acessível, autor, data, nota) com "Baixar" (chama a rota de download e abre a URL temporária) — nunca link permanente.
  - **Ações:** só os botões correspondentes às `acoes_permitidas` (nova versão com upload, enviar à revisão, devolver [nota obrigatória], aprovar, registrar assinatura interna, publicar [vencimento opcional, data real], cancelar [nota obrigatória]). Ação ausente ⇒ botão ausente; um teste afirma que, com `acoes_permitidas: []`, **nenhum botão de transição** é exibido.
  - **Assinaturas internas registradas:** cada uma com signatário, data/hora, versão, hash, e a marcação **"vigente"/"não vigente (versão substituída)"** em texto; o `aviso_assinatura` da API aparece em destaque na seção e no diálogo/botão de assinar; **teste de varredura do DOM**: nenhum texto contém "assinatura digital" nem "ICP-Brasil" fora do aviso vindo da API, e o botão se chama "Registrar assinatura interna".
  - **Visibilidade de registro:** com conselho/número/UF no JSON da API, são exibidos; sem eles, aparece "Registro profissional confirmado: sim/não" e nada é inferido (teste com os dois formatos).
  - Mensagens do servidor: 403 de matriz/registro, 409 de estado/separação e 400 de validação aparecem em `role="alert"` **sem reescrita**, mantendo o formulário/diálogo aberto; após sucesso a tela recarrega o detalhe (estado novo) e anuncia em `role="status"`.
  - Upload de versão: valida tipo e 10 MB antes de enviar; envia `multipart/form-data` com `file` e `note?`; progresso/estado de envio; 413/400 com mensagem clara.
  - Estados terminais: `publicado` mostra o vínculo "Publicado em documentos do cliente" (sem link para área da empresa) e **nenhuma** ação de edição ou exclusão; `cancelado` idem.
  - Diálogos: foco preso e restaurado; Esc fecha; botões desabilitados durante a requisição (sem duplo envio).
  - Aviso LGPD nos campos de nota; 401/403/404 (documento de outro tenant ⇒ "Documento não encontrado.").
- [ ] **Step 2: Implementar.** Reaproveitar as constantes de rótulo do `api.ts`; **não** duplicar regra de fluxo no frontend (nem tabela de transições): a UI só reflete `acoes_permitidas`.
- [ ] **Step 3: Rodar** `npx vitest run src/app/atuacao`, `npx vitest run`, `npx tsc --noEmit`, `npm run build`. QA visual: NÃO VERIFICADO salvo se o ambiente permitir.
- [ ] **Step 4: Checkpoint** — listar arquivos.

---

### Task 3: Verificação final da Fase 5B

- [ ] **Step 1:** `cd /opt/Montese/frontend && npx vitest run && npx tsc --noEmit && npm run build`.
- [ ] **Step 2:** varredura estática: `grep -rniE "assinatura digital|icp|validade jurídica" frontend/src/app/atuacao frontend/src/lib/dashboard/menu-atuacao.ts` não pode achar nada fora de comentários e dos testes que afirmam a ausência.
- [ ] **Step 3:** blocos "Fase 5B — evidências" em `docs/superpowers/audits/2026-10-19-painel-atuacao-fase0.md` e atualização da memória `project_painel_atuacao_socios.md`.
- [ ] **Step 4:** parar para o proprietário (commit; produção; preenchimento da matriz; tela do admin para matriz e registros ainda não existe).

---

## Auto-revisão contra a spec e as decisões

- **Decisão 1 (assinatura interna, aviso, sem "ICP-Brasil"):** texto controlado, botão e rótulos fixos, varredura do DOM — Task 2/3.
- **Decisão 2 (matriz vazia, bloqueio):** UI exibe a mensagem do servidor, sem contornar — Tasks 1/2.
- **Decisão 3 (registro profissional):** só exibido quando a API devolve; sem inferência — Task 2.
- **Decisão 4 (sem segunda linhagem):** a UI só usa a API do fluxo; publicação não cria rota/atalho para `documents` — Task 2.
- **Riscos declarados:** (1) a tela depende de `acoes_permitidas` estar completa e correta no servidor; (2) sem tela do admin, a matriz e os registros só podem ser configurados por API; (3) QA visual e integração com o backend real NÃO VERIFICADOS; (4) a política de retenção de notas ainda não foi aprovada.
