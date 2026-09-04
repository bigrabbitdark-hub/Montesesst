# Fase 20 — Assistente: anexar documento/imagem na pergunta

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-04.
> Primeira frente concreta da visão maior de "Assistente Montese SST"
> trazida pelo fundador nessa mesma conversa — ver
> `docs/assistente-montese-principios.md` (princípios que qualquer
> agente novo, incluindo este, precisa herdar) para o contexto completo
> da visão e as decisões já tomadas sobre arquitetura de modelo
> (interface por capacidade, não Model Gateway central) e MiniMax (não
> necessário pra esta fase).

## 1. Objetivo e escopo

Hoje o Assistente (`POST /assistant/normative-query`, Fase 9/10)
responde só a partir de texto — a pergunta do usuário, os trechos
normativos oficiais recuperados por busca semântica, e (pra empresa) um
resumo do próprio dashboard. Esta fase permite anexar **um documento
(PDF) ou uma imagem** na mesma pergunta, e o Assistente passa a
considerar esse anexo, junto com as fontes que já usa, pra responder.

Esta é deliberadamente a menor fatia real da visão maior trazida pelo
fundador — não constrói um pipeline de ingestão em massa nem um agente
documental separado. É uma extensão pontual do Assistente que já existe
e já funciona.

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **PDF e imagem, ambos nesta primeira versão** — o modelo já ativo
  (`OPENROUTER_MODEL`, hoje `anthropic/claude-sonnet-5`, roteado pelo
  OpenRouter) já é multimodal e já é usado pelo Assistente hoje; imagem
  entra como bloco `image_url` na mesma chamada de chat completions
  (formato OpenAI-compatível, confirmado no código real de
  `openrouter-normative-answer.service.ts`/`normative-answer-shared.ts`),
  sem precisar de nenhum pipeline de OCR.
- **Nenhuma persistência do anexo** — o arquivo é processado em memória
  (extrai texto do PDF via `pdf-parse`, já em uso no monitor normativo;
  imagem vai direto como bloco de imagem) e descartado depois da
  resposta. Não grava no R2, não cria linha em nenhuma tabela. Isso é
  consistente com o fato de a conversa do Assistente já não ter
  histórico persistido hoje (cada pergunta já é isolada,
  `normative-assistant.service.ts` não recebe nem grava
  `conversationId`) — anexar um documento não perde nada que já não se
  perdia ao recarregar a página.
- **Cruza com a RAG normativa, não substitui** — quando há anexo, o
  Assistente ainda busca trechos normativos oficiais e (pra empresa)
  o resumo operacional, só que com orçamento mais apertado dos dois
  lados (seção 4).
- **Limite de 5MB** — menor que os 10MB de documento formal
  (`documents`, Fase 4), porque isto é conteúdo efêmero de uma pergunta,
  não um registro de compliance de longo prazo.
- **Mimetypes aceitos: `application/pdf`, `image/jpeg`, `image/png`** —
  mesmo conjunto já usado pelo módulo de documentos, sem adicionar
  formatos novos.
- **Interface pequena e trocável, não um Gateway central** — mesma
  disciplina já registrada nos princípios: uma interface nova
  (ex. `AttachmentAnalyzer` ou nome equivalente definido na spec/plano
  de implementação) com uma implementação OpenRouter, sem expandir
  `NormativeAssistantService` num monólito.
- **Rate limit dedicado, mais apertado** — uma pergunta com anexo custa
  mais tokens que uma pergunta simples; ganha seu próprio limite (não
  reaproveita o `ASSISTANT_RATE_LIMIT_MAX` de 20/hora das perguntas sem
  anexo).
- **Sem validação contra a API real antes de ativar, sem anúncio como
  pronto** — mesma regra de toda fase de IA anterior (Fase 8/13):
  validar contra o OpenRouter real, com um PDF e uma imagem reais,
  antes de considerar a fase fechada.

## 3. Modelo de dados

**Nenhum.** Sem migration, sem tabela nova, sem coluna nova. O anexo
nunca é persistido (seção 2) — não há nada para modelar no banco.

## 4. Fluxo

### 4.1 Requisição

`POST /assistant/normative-query` (rota existente, não uma rota nova)
passa a aceitar multipart: campo `question` (texto, já existente, até
1000 caracteres) + campo opcional `file` (PDF ou imagem, até 5MB). Sem
`file`, o comportamento é idêntico ao de hoje — compatibilidade total
com o que já existe.

### 4.2 Processamento do anexo

- **PDF**: extrai texto via `pdf-parse` (mesma lib já usada em
  `normative-monitor.service.ts`). Trunca o texto extraído em ~8.000
  caracteres (~2.000 tokens) antes de injetar no prompt — evita
  estourar o orçamento de contexto com um PDF grande. Se a extração não
  encontrar texto nenhum (PDF escaneado sem camada de texto — cenário
  já conhecido do monitor normativo, sem OCR), a resposta explicita isso
  ao usuário ("não consegui ler texto neste PDF") em vez de responder
  como se o documento estivesse vazio de propósito.
- **Imagem**: nenhuma extração — vai direto como bloco `image_url` (base64)
  na mesma chamada de chat completions que já existe, deixando o modelo
  multimodal interpretar.

### 4.3 Orçamento de contexto ajustado

Com anexo presente, o número de trechos normativos buscados cai de 6
(padrão de hoje) para 3, liberando espaço no prompt pro conteúdo do
anexo. A pergunta e o resumo operacional (pra empresa) mantêm os
mesmos limites de hoje.

### 4.4 Resposta

Mesmo formato de resposta de hoje (`NormativeQueryResult`: `answer`,
`citations`), com uma extensão: quando uma afirmação usa o anexo como
fonte, a citação identifica isso como "documento anexado nesta
pergunta" — distinto de uma citação de norma oficial (`document_id`/
`title`/`official_url`) ou de item operacional. Mantém a hierarquia de
fontes já registrada nos princípios (documento fornecido pela empresa é
nível 2, abaixo de fonte oficial nível 1) — a linguagem da resposta
precisa deixar claro que "o documento anexado diz X" não é o mesmo peso
que "a norma oficial Y diz X".

### 4.5 Rate limit

Endpoint com anexo ganha um limite dedicado, mais apertado que os 20/hora
das perguntas sem anexo — valor exato fica pra decisão do plano de
implementação (o mecanismo `@RateLimit({ keyBy: 'ip', ... })` já
existente suporta um limite por rota/handler sem mudança no guard).

## 5. Fora de escopo

- Persistir o anexo em qualquer lugar, ou permitir "continuar a
  conversa" sobre o mesmo documento numa pergunta seguinte — cada
  pergunta com anexo é isolada, mesmo padrão do resto do Assistente
  hoje.
- OCR de imagem/PDF escaneado — o modelo multimodal já cobre imagem
  diretamente; PDF sem camada de texto real fica como limitação
  conhecida, comunicada ao usuário, não escondida.
- Upload em lote de múltiplos documentos numa pergunta só.
- Qualquer agente separado (documental, de pessoas, de EPI, etc.) da
  visão maior trazida pelo fundador — esta fase estende o Assistente
  que já existe, não cria um agente novo do zero.
- Ativação real do MiniMax — não necessária pra esta fase (ver
  `docs/assistente-montese-principios.md` §7).
