# Fase 26 — Frontend do Pente-Fino (PGR↔PCMSO)

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-13.
> A Fase 25 construiu o motor de cruzamento "Pente-Fino" inteiro no
> backend ([`POST /pente-fino/run`](../plans/fase-25-pente-fino-pgr-pcmso.md)),
> deliberadamente sem tela nenhuma — spec-only backend, mesma decisão
> da Fase 24. Esta fase constrói a primeira tela que consome esse
> endpoint. Fundador escolheu esta frente via `AskUserQuestion` como
> prioridade imediata após o fechamento da Fase 25.

## 1. Objetivo e escopo

Hoje o relatório do Pente-Fino só existe via chamada HTTP direta —
nenhum usuário real (empresa, técnico ou parceiro) consegue vê-lo.
Esta fase constrói:

1. Um componente `PenteFinoPanel` reutilizável entre papéis (mesmo
   padrão de `DocumentsPanel`/`EpisPanel`/`MapaSstPanel`), que chama
   `POST /pente-fino/run` sob demanda e apresenta o relatório.
2. Duas páginas finas que montam esse componente: uma para `empresa`,
   uma para `técnico`/`parceiro` dentro da área já existente de
   navegação por empresa vinculada.
3. As entradas de navegação correspondentes nas sidebars/páginas já
   existentes.

Fora desta fase: qualquer ação de escrita (cadastrar cargo, editar
documento), qualquer integração com o chat do Assistente, e qualquer
tela nova de gestão de PGR/PCMSO além do que `DocumentsPanel` já
oferece.

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Empresa e técnico/parceiro juntos nesta fatia** (decisão do
  fundador, via `AskUserQuestion`) — não faseado em duas entregas
  separadas.
- **Só leitura, com link pro Mapa SST** (decisão do fundador) — a
  tela não cadastra cargo nem edita nada; pra `nome_sem_correspondencia`
  ela aponta pra `/empresa/mapa-sst` (Fase 23), que já resolve
  cadastro/vínculo de cargo. Não duplicar essa lógica aqui.
- **Sem Mapa SST pro técnico/parceiro hoje** (achado desta fase,
  confirmado por grep: `MapaSstPanel` só é importado em
  `app/empresa/mapa-sst/page.tsx`) — cadastro de cargo é ação da
  própria empresa sobre o próprio catálogo (`positions`), técnico não
  gerencia isso. Pra técnico/parceiro, `nome_sem_correspondencia` vira
  texto informativo ("peça pra empresa cadastrar este cargo em Mapa
  SST"), nunca um link — não existe rota pra levar.
- **Disparo manual, nunca automático ao abrir a página.** O endpoint é
  limitado a `PENTE_FINO_RUN_RATE_LIMIT_MAX` execuções/hora **por IP**
  (default 5, Fase 25) e pode levar até ~2 minutos (até duas chamadas
  de LLM de até 60s cada, mais dois downloads no R2). Carregar sozinho
  no `useEffect` — o padrão de `MapaSstPanel`/`DocumentsPanel` — gastaria
  cota da cota compartilhada por IP sem o usuário pedir, inclusive em
  reload acidental de página. A tela abre em estado parado, com um
  botão explícito "Rodar Pente-Fino".
- **Sem polling nem WebSocket.** A chamada é uma única requisição
  síncrona (`await fetch`) que só resolve quando o backend termina — o
  endpoint não tem estado intermediário nem job assíncrono. O único
  estado de "carregando" é a duração da própria requisição.
- **Componente único parametrizado por `tenantId?: string`**, não dois
  componentes separados — mesmo padrão já usado por `DocumentsPanel`
  (`{ tenantId }: { tenantId?: string }`, `app/tecnico/empresas/[tenantId]/page.tsx:87`)
  pro mesmo problema (mesmo dado, visível por papéis diferentes com
  origem de tenant diferente). Evita duplicar toda a lógica de
  apresentação entre uma versão "empresa" e uma versão "técnico".

## 3. Contrato consumido (não muda nesta fase)

Da Fase 25, `backend/src/pente-fino/pente-fino-comparison.service.ts`
e `pente-fino.controller.ts` — copiado aqui verbatim como referência,
não redefinido:

```typescript
interface PenteFinoDocumentRef {
  id: string;
  title: string;
  extracted_at: string | null;
}

interface FunctionReportItem {
  position_id: string | null;
  position_name: string | null;
  function_text_raw: string;
  status: 'ok' | 'risco_sem_exame' | 'exame_sem_risco' | 'nome_sem_correspondencia';
  risks: { description: string; source_excerpt: string }[];
  exams: { description: string; source_excerpt: string }[];
}

interface PenteFinoReport {
  pgr_document: PenteFinoDocumentRef | null;
  pcmso_document: PenteFinoDocumentRef | null;
  functions: FunctionReportItem[]; // já vem ordenado por prioridade de status
  warnings: string[];
}
```

`POST /pente-fino/run`:
- Corpo: `{}` pra `empresa` (ignorado se enviado); `{ tenant_id: string }`
  **obrigatório** pra `tecnico`/`parceiro` (`RunPenteFinoDto`, `@IsUUID()`).
- `201` — sempre devolve `PenteFinoReport`, mesmo com `functions: []` e
  ambos os documentos `null` (nesse caso `warnings` explica o motivo).
- `400` — `tenant_id` ausente pra papel que precisa dele (não deve
  acontecer se a tela sempre inclui `tenantId` da rota).
- `403` — técnico/parceiro sem vínculo com a empresa (`ForbiddenException`,
  mensagem `"Você não está vinculado a esta empresa"`).
- `429` — limite de execuções por IP atingido; header `Retry-After`
  presente (segundos), mesmo padrão de `rate-limit.e2e-spec.ts`.
- `401` — sem token, tratado pelo guard de página já existente em todo
  o projeto (`if (!localStorage.getItem('montese_token')) router.push('/login')`).

Ordem dos `functions` já vem correta do backend
(`sortFunctionsByPriority`) — o frontend nunca reordena.

## 4. Componente `PenteFinoPanel`

**Arquivo novo:** `frontend/src/components/PenteFinoPanel.tsx`

**Props:** `{ tenantId }: { tenantId?: string }` — `undefined` quando
chamado pela página empresa (o backend resolve o tenant do próprio
JWT); string quando chamado pela página técnico/parceiro.

**Estado local** (mesmo padrão de `MapaSstPanel`/`DocumentsPanel`:
`useState` cru, sem lib de estado):
- `status: 'idle' | 'loading' | 'done' | 'error'`
- `report: PenteFinoReport | null`
- `errorMessage: string`
- `retryAfterSeconds: number | null` (só setado no caso `429`)
- `expandedRowKeys: Set<string>` — controla quais linhas da tabela
  estão com risco/exame expandido (chave = `position_id ?? function_text_raw`,
  já que `position_id` pode ser `null`)

**Fluxo:**
1. Estado inicial `idle` — mostra um resumo estático (texto explicando
   o que a ferramenta faz, aviso de que pode levar até 2 minutos) e o
   botão "Rodar Pente-Fino". Nenhuma requisição dispara sozinha.
2. Clique no botão → `status = 'loading'`, desabilita o botão, chama
   `POST /pente-fino/run` com o corpo certo pro papel (ver §3).
3. Resposta `201` → `status = 'done'`, guarda `report`.
4. Resposta `403` → `status = 'error'`, `errorMessage` = a mensagem
   literal do corpo do erro (`res.body.message`, já vem em português
   pronta pra exibir — mesma convenção de erro do resto do projeto).
5. Resposta `429` → `status = 'error'`, lê `Number(res.headers.get('Retry-After'))`
   em segundos, guarda em `retryAfterSeconds`, `errorMessage` fixa:
   `"Limite de execuções do Pente-Fino atingido. Tente novamente mais tarde."`
6. Qualquer outro erro (rede, 400, 500) → `status = 'error'`,
   `errorMessage` genérica: `"Não foi possível rodar o Pente-Fino agora. Tente novamente."`
   (mesmo texto genérico já usado em `MapaSstPanel`/`DocumentsPanel`
   pra falha de rede).
7. Em qualquer estado `error` ou `done`, o botão "Rodar Pente-Fino"
   continua disponível pra rodar de novo (re-clicar substitui o
   relatório anterior).

**Apresentação do estado `done`:**

Seção de documentos-fonte, sempre visível quando `report` existe:
```
PGR: {pgr_document?.title ?? 'nenhum PGR encontrado'} {extracted_at formatado, se houver}
PCMSO: {pcmso_document?.title ?? 'nenhum PCMSO encontrado'} {extracted_at formatado, se houver}
```
`extracted_at` formatado com a mesma função `formatDate`/`toDateString`
já usada em outras páginas do projeto (data no formato `DD/MM/AAAA`;
`extracted_at` vem como string ISO completa — usar só a parte de data,
mesmo tratamento que `technician-agenda`/`visits` já dão a timestamps).

`warnings` (se o array não for vazio): lista de avisos em caixa âmbar
(`border-amber-300 bg-amber-50`, mesma classe já usada em
`MapaSstPanel.tsx:241`), um `<li>` por warning, texto literal do
backend.

Tabela de `functions` (se `functions.length > 0`; caso contrário,
mensagem "Nenhuma função extraída ainda — envie PGR e PCMSO e rode de
novo."):

Cada linha:
- Nome: `position_name ?? function_text_raw` (cargo cadastrado tem
  prioridade sobre o texto cru extraído).
- Badge de status, cores fixas (mesma paleta de `MapaSstPanel.tsx:376-379`,
  que já usa `text-red-600`/`text-green-700` pra pendência/em-dia):
  | status | texto do badge | classe |
  |---|---|---|
  | `risco_sem_exame` | "Risco sem exame" | `text-red-600` |
  | `exame_sem_risco` | "Exame sem risco correspondente" | `text-amber-600` |
  | `ok` | "Em dia" | `text-green-700` |
  | `nome_sem_correspondencia` | "Sem cargo cadastrado" | `text-slate-500` |
- Botão "Ver detalhes" alterna a chave da linha em `expandedRowKeys`.
  Quando expandida, mostra duas sublistas (só as que tiverem itens):
  - "Riscos (PGR)": cada `risks[i]` como `description` + citação em
    itálico do `source_excerpt` (mesmo padrão de citação visível já
    usado no `AssistantChat.tsx` pra chunks normativos — nunca esconder
    a fonte).
  - "Exames (PCMSO)": mesmo formato para `exams[i]`.
- Quando `status === 'nome_sem_correspondencia'`:
  - Se `tenantId` prop for `undefined` (contexto empresa): link
    `<Link href="/empresa/mapa-sst">Cadastrar cargo no Mapa SST</Link>`.
  - Se `tenantId` prop estiver definida (contexto técnico/parceiro):
    texto simples, sem link: `"Sem cargo cadastrado — peça pra empresa cadastrar em Mapa SST."`

## 5. Páginas e navegação

**Arquivo novo:** `frontend/src/app/empresa/pente-fino/page.tsx`

Mesma estrutura mínima de `app/empresa/mapa-sst/page.tsx`: guarda de
token (`if (!localStorage.getItem('montese_token')) router.push('/login')`),
título `<h1>`, monta `<PenteFinoPanel />` sem prop.

**Arquivo novo:** `frontend/src/app/tecnico/empresas/[tenantId]/pente-fino/page.tsx`

Mesma estrutura mínima de `app/tecnico/empresas/[tenantId]/page.tsx`
(guarda de token, lê `tenantId` de `useParams<{ tenantId: string }>()`),
monta `<PenteFinoPanel tenantId={params.tenantId} />`.

**Navegação:**
- `frontend/src/components/EmpresaSidebar.tsx` — novo link no grupo
  `'Segurança'`, logo após o de Mapa SST:
  `{ href: '/empresa/pente-fino', label: 'Pente-Fino', emoji: '🔬' }`.
- `frontend/src/app/tecnico/empresas/[tenantId]/page.tsx` — essa página
  hoje lista inspeções e monta `DocumentsPanel`/`EpisPanel` diretamente
  (não é um shell com abas separadas — é uma página só). Adicionar um
  link de texto simples pra nova rota, no mesmo estilo dos links já
  presentes ali (verificar o JSX exato da página ao implementar; não
  criar um sistema de abas novo pra uma página só).
- `TecnicoSidebar.tsx` **não muda** — a navegação pra dados de uma
  empresa específica já passa por `/tecnico/empresas` → `[tenantId]`,
  igual a Inspeções/Documentos/EPIs hoje. Pente-Fino segue o mesmo
  caminho, não vira item de sidebar de nível superior.

## 6. Erros e estados de borda

- **Sem PGR nem PCMSO cadastrado**: `report.functions` vazio, os dois
  `warnings` presentes — tela mostra os avisos, tabela vazia com a
  mensagem do §4, sem tratar como erro (é resposta `201` válida).
- **Um dos dois documentos falta** (só PGR ou só PCMSO): um warning
  presente, o outro documento aparece como "nenhum X encontrado" na
  seção de documentos-fonte; `functions` pode ter itens de um lado só
  (ex.: só `risco_sem_exame` nunca aparece se não há PCMSO — na
  prática, `buildFunctionReport` já trata isso client-side nenhuma
  lógica nova aqui, só exibição do que a API manda).
- **Duplo clique / clique durante `loading`**: botão desabilitado
  durante `status === 'loading'` evita disparo duplo (mesmo padrão já
  usado em botões de submissão no resto do projeto, ex.:
  `handleNovaInspecao`/`creating` em `tecnico/empresas/[tenantId]/page.tsx`).
- **Retry-After ausente ou não-numérico** (não deveria acontecer,
  mas o header é texto): `Number(...)` vira `NaN`; nesse caso
  `retryAfterSeconds` fica `null` e a mensagem de erro genérica de 429
  aparece sem o tempo específico, sem quebrar a tela.

## 7. Testes

Mesma situação de todo o frontend deste projeto desde a Fase 12b: zero
infraestrutura de teste automatizado (`frontend/package.json` não tem
jest/vitest/testing-library). Verificação manual via Playwright real
contra a produção (`https://montesesst.com.br`), cobrindo no mínimo:
- Empresa: abre `/empresa/pente-fino`, roda, vê tabela com pelo menos
  um `status` de cada tipo (usar tenant de teste com PGR/PCMSO reais já
  cadastrados, mesmo fixture que a Fase 25 já validou no backend).
- Empresa: clica "Ver detalhes" numa linha, confirma que
  `source_excerpt` aparece.
- Empresa: linha `nome_sem_correspondencia` mostra o link pro Mapa SST
  e ele navega pra lá.
- Técnico vinculado: mesma tela via `/tecnico/empresas/[tenantId]/pente-fino`,
  confirma que `nome_sem_correspondencia` mostra texto (não link).
- Técnico não vinculado: confirma mensagem de erro 403, sem vazar
  nenhum dado da empresa.
- Forçar `429`: mais barato e seguro testar via `curl`/script direto
  no endpoint (6 chamadas seguidas) do que via clique repetido na UI —
  evita rodar 6 extrações reais (LLM+R2) só pra ver o texto de erro.
  Depois de confirmar, **resetar a chave no Redis**
  (`ratelimit:PenteFinoController.run:<ip>`, mesmo padrão de limpeza já
  usado nos testes e2e do backend) — sem isso, a produção fica com a
  cota daquele IP zerada por até 1h pra qualquer usuário real atrás do
  mesmo IP.

## 8. Fora de escopo

- Qualquer ação de escrita nesta tela (cadastro de cargo, edição de
  documento) — só leitura, decisão do fundador (§2).
- Integração com o chat do Assistente — seguem duas ferramentas
  separadas por enquanto.
- Indicador de progresso incremental durante os até ~2 minutos de
  espera (ex.: "extraindo PGR... extraindo PCMSO...") — o backend não
  expõe esse estado intermediário; um spinner genérico é suficiente
  nesta fatia.
- Qualquer mudança em `positions`, `documents`, ou no endpoint
  `POST /pente-fino/run` em si — este é o contrato fixo consumido,
  não alterado (§3).
- Tela de histórico de execuções passadas — o backend não persiste
  execuções do relatório em si (só a extração por documento, já
  cacheada); cada clique em "Rodar" é sempre a visão atual.
