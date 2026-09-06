# Fase 21 — Documentos: upload em lote com classificação automática

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-06.
> Primeira fatia real da visão de "Diagnóstico Inicial" (onboarding em
> massa) trazida pelo fundador nessa mesma conversa — ver
> `docs/assistente-montese-principios.md` pros princípios que esta
> capacidade herda (assistir não substituir, 3 níveis de confiança,
> nunca inventar validade, interface por capacidade em vez de Model
> Gateway central — decisão reconfirmada nesta mesma conversa).

## 1. Objetivo e escopo

Hoje o upload de documento (`POST /documents`, Fase 4) é um de cada
vez: a empresa escolhe o arquivo, escolhe manualmente a categoria (1 de
7: `pgr`, `pcmso`, `laudo`, `ficha_epi`, `treinamento`, `ltcat`, `lip`),
digita um título, e opcionalmente uma data de validade.

Esta fase permite selecionar **vários arquivos de uma vez**, e um
agente pequeno sugere categoria, título e validade (quando o próprio
documento afirma uma data real) pra cada um — a empresa revisa e edita
antes de confirmar. O upload individual de hoje continua existindo,
inalterado, ao lado do novo modo em lote.

Esta é deliberadamente a menor fatia real da visão maior de
"Diagnóstico Inicial" — não constrói ingestão de planilha de
funcionários, não constrói o "Mapa SST" (grafo empresa → unidade →
cargo → funcionário), não constrói um Model Gateway. É uma extensão
pontual do módulo de documentos que já existe e já funciona.

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Só a implementação MiniMax desta vez** — diferente das capacidades
  anteriores (que sempre ganharam um par MiniMax+OpenRouter "pronto
  pra trocar"), esta capacidade nova ganha só `MiniMaxDocumentClassifierService`.
  A interface (`DocumentClassifierProvider`) já garante trocabilidade
  futura via `useClass`, sem precisar escrever a implementação
  alternativa agora — decisão do fundador de não manter dois builds
  prontos "por precaução" pra cada capacidade nova a partir de agora,
  já que o modelo (MiniMax) está decidido.
- **Nunca inventa validade** — `expires_at` só é sugerido se o texto
  extraído do PDF contiver literalmente uma data de validade/vencimento
  associada ao documento. Sem isso, o campo fica em branco pra
  preenchimento manual — mesma regra já usada no resto do projeto
  (nunca calcular/adivinhar uma data que não está escrita).
- **Categoria fora das 7 válidas, ou confiança baixa, fica em branco**
  — o agente nunca força uma categoria só pra preencher o campo; a
  empresa escolhe manualmente quando o agente não tem certeza.
- **PDF sem texto extraível (escaneado) não chama IA** — mesmo
  comportamento já usado no anexo do Assistente (Fase 20): vai direto
  pra "revisar manualmente", sem gastar uma chamada de IA numa entrada
  que ela não consegue processar.
- **Nenhum endpoint novo de salvar em lote** — o passo de confirmação
  do usuário dispara N chamadas ao `POST /documents` já existente (uma
  por arquivo), reaproveitando 100% da validação/persistência já
  testada. O endpoint novo desta fase (`POST /documents/classify-batch`)
  só sugere, nunca salva.
- **Limite de 10 arquivos por lote, 10MB cada** — mesmo limite de
  tamanho do upload individual de hoje; o limite de contagem evita uma
  chamada que processa dezenas de arquivos de uma vez sem necessidade
  comprovada ainda.
- **Rate limit dedicado** — mesmo padrão manual já usado no anexo do
  Assistente (chave Redis própria, fail-open, mais apertado que o
  limite geral da rota de documentos).
- **Falha num arquivo do lote não derruba os demais** — cada arquivo é
  processado independentemente; um PDF corrompido ou uma falha de rede
  na IA marca só aquela linha como "não foi possível analisar", as
  outras seguem normalmente.

## 3. Modelo de dados

Nenhuma tabela nova. Reaproveita `documents` (já existe, Fase 4) sem
nenhuma coluna nova — o resultado da classificação nunca é persistido
por si só, só existe na resposta HTTP até o usuário confirmar (que aí
vira uma chamada normal ao `POST /documents` já existente).

## 4. Fluxo

1. Empresa seleciona vários arquivos de uma vez na tela de documentos
   (`DocumentsPanel.tsx`, novo modo "Upload em lote" ao lado do upload
   individual que já existe).
2. Frontend envia todos num único `POST /documents/classify-batch`
   (multipart, campo `files`, até 10 arquivos de até 10MB cada).
3. Backend, pra cada arquivo, independentemente:
   - Se não for PDF ou não tiver texto extraível (reaproveitando
     `extractPdfText`, já existe desde a Fase 20): marca
     `needs_review: true`, sem chamar IA.
   - Senão, chama `DocumentClassifierProvider.classify(text)`, que
     devolve `{ category: string | null, title: string | null,
     expires_at: string | null, confidence: 'alta' | 'baixa' }`.
   - `category` fora das 7 válidas ou `confidence: 'baixa'` vira `null`
     na resposta (nunca força uma sugestão de baixa certeza).
4. Resposta: array de
   `{ filename, suggested_category, suggested_title, suggested_expires_at, needs_review }`
   — nada foi salvo ainda.
5. Frontend mostra uma tabela de revisão, uma linha por arquivo, todos
   os campos editáveis (pré-preenchidos com a sugestão quando houver).
6. Empresa confirma — frontend dispara uma chamada `POST /documents`
   (já existente) por linha confirmada, uma de cada vez (sequencial,
   não em paralelo — mesmo raciocínio de simplicidade de
   `WeeklyDigestService`: mostra sucesso/erro por linha à medida que
   cada chamada termina, sem lidar com concorrência de múltiplas
   chamadas simultâneas por um ganho que ainda não foi medido como
   necessário).

## 5. Fora de escopo

- Importação de planilha de funcionários com colunas flexíveis (fatia
  seguinte da visão de Diagnóstico Inicial, ainda sem spec).
- "Mapa SST" / grafo de relações empresa→cargo→funcionário→EPI.
- Qualquer mudança no upload individual de documento já existente.
- Qualquer capacidade envolvendo imagem/foto neste lote (só PDF nesta
  primeira versão — imagem como documento formal fica pra uma fatia
  futura, se necessário).
- Model Gateway central (decisão já registrada em
  `docs/assistente-montese-principios.md`, reconfirmada nesta mesma
  conversa).
