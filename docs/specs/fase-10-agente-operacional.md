# Fase 10 — Agente Operacional (dados da empresa + norma acoplada)

> Spec aprovada por brainstorming em chat com o fundador em 2026-08-31.
> Segundo sub-projeto da frente "Agentes + IA" (ver `docs/vision.md` e
> `docs/specs/fase-9-rag-normativo.md`, que fechou o primeiro: o RAG
> Normativo). Esta fase é o "AGENTE 2 — AGENTE OPERACIONAL" da visão
> original do fundador, com um requisito novo confirmado em chat: cada
> agente precisa estar acoplado ao conhecimento normativo oficial, não
> só ao dado cru da empresa.

## 1. Objetivo e escopo

O Assistente (Fase 9) hoje só responde pergunta normativa ("o que a
NR-06 exige?"). Esta fase adiciona uma segunda fonte de fatos: os
próprios dados da empresa (pendências, documentos, EPIs, ações,
inspeções) — e faz o Assistente combinar as duas fontes numa resposta
só quando fizer sentido. Exemplo motivador: "estou em conformidade com
a NR-06?" precisa saber tanto **o que a norma exige** (fonte
normativa) quanto **o que a empresa tem cadastrado** (fonte
operacional) para responder de verdade.

**Regra central, herdada da Fase 9 e reforçada pelo fundador:** toda
afirmação da resposta continua precisando de uma fonte real e
verificável por trás — agora com dois tipos de fonte possíveis (trecho
normativo real, já recuperado; ou fato operacional real, já calculado
pelo sistema), nunca inventada pela IA em nenhum dos dois casos.

**Fora de escopo desta fase:**
- Orquestrador com roteamento por classificação de intenção (IA
  decidindo "essa pergunta é sobre norma ou sobre a empresa?"). Em vez
  disso, a Fase 10 busca as duas fontes sempre, e deixa o modelo
  decidir o que é relevante citar — mais simples, mais barato, sem uma
  chamada de IA extra só pra rotear. Fica registrado aqui como decisão
  de design, não como algo esquecido.
- Técnico/parceiro perguntando sobre dado operacional de um cliente
  (só empresa nesta fase — técnico/parceiro continuam com acesso
  apenas à parte normativa, igual hoje).
- Verificação numérica exata do texto da resposta contra o valor
  operacional real (ex.: conferir que "3 pendências" bate com o número
  3 seguindo regex no texto livre) — frágil de implementar de forma
  confiável contra texto em português natural. O Verificador desta
  fase confere que todo fato operacional citado veio de um item
  realmente calculado pelo sistema (mesmo padrão de "citação existe",
  não "citação é fiel palavra por palavra" já usado pra normas na Fase
  9 — ver `docs/specs/fase-9-rag-normativo.md` §4.4).

## 2. Reaproveitamento (sem tabela nova, sem serviço novo do zero)

Nenhuma migration nesta fase. Os fatos operacionais já existem,
calculados por `DashboardService.getSummary(client, tenantId)`
(`backend/src/dashboard/dashboard.service.ts`, construído antes da
Fase 9): devolve `resumo` (contadores) e `atencao` (lista priorizada
de até 10 itens, cada um com `tipo`, `titulo`, `prioridade`, `data`,
`responsavel`, `link`) — exatamente os "fatos" que o Agente
Operacional precisa citar. Esta fase consome esse serviço diretamente,
sem duplicar a lógica de agregação.

O retrieval normativo (embedding da pergunta, busca por similaridade,
Verificador de citação) continua sendo o mesmo de `NormativeAssistantService`
(Fase 9) — esta fase estende esse serviço, não cria um paralelo.
Decisão deliberada de manter os nomes de classe/arquivo como estão
(`NormativeAssistantService`/`NormativeAssistantController`) mesmo o
serviço passando a fazer mais que "só normativo" — renomear é uma
limpeza cosmética de baixo risco que pode ficar pra depois; não vale
misturar com a mudança de comportamento desta fase.

## 3. Fluxo da consulta (evolução do `query()` da Fase 9)

```
1. Embedding da pergunta (sem conexão de banco aberta — mesma regra
   da Fase 9, Finding C1a).
2. Busca normativa por similaridade (mesma query da Fase 9, top-6,
   limiar 0.4).
3. SE o papel do usuário é 'empresa': busca DashboardService.getSummary
   pro tenant dele (conexão curta, com contexto de tenant — RLS entra
   em jogo aqui, diferente do retrieval normativo que não tem RLS).
   Monta uma lista de "itens operacionais" a partir de summary.atencao,
   cada um com um id local (op-0, op-1, ...).
   SE o papel é 'tecnico'/'parceiro': pula este passo — comportamento
   igual à Fase 9, só normativo.
4. Zero trechos normativos relevantes E zero itens operacionais →
   fallback "Não encontrei nada relevante pra essa pergunta.", sem
   chamar o modelo de chat.
5. Caso contrário, chama o modelo de chat com as duas fontes
   disponíveis (o que existir — só normativo, só operacional, ou os
   dois), tool-schema estendido: cada afirmação pode citar
   `chunk_ids` (trechos normativos) e/ou `operational_ref_ids` (itens
   operacionais).
6. Verificador — regra precisa, pra não repetir o bug de "lista vazia
   passa vácuamente" (toda checagem `every()` sobre array vazio dá
   `true` em JS, se não houver uma guarda explícita):
   ```
   sobrevive = (chunk_ids.length > 0 OR operational_ref_ids.length > 0)
     AND every id em chunk_ids pertence ao conjunto normativo recuperado
     AND every id em operational_ref_ids pertence ao conjunto operacional
         calculado nesta consulta
   ```
   Isto é: a afirmação precisa citar pelo menos uma fonte real (de
   qualquer um dos dois tipos, não precisa ser os dois), e toda
   citação que ela de fato fizer, dos dois tipos, precisa ser real.
   Uma afirmação com `chunk_ids: []` e `operational_ref_ids: []` é
   descartada mesmo que nenhuma das duas listas contenha um id
   inválido — vazio não é "sem erro", é "sem fonte".
7. Resposta final = afirmações que sobreviveram, concatenadas +
   citações normativas (como já era) — itens operacionais não geram
   citação com link (são dado da própria empresa, não uma fonte
   externa), só sustentam a afirmação internamente.
```

A busca operacional (passo 3) roda numa transação curta e separada da
busca normativa (passo 2) e do resto — nenhuma delas fica aberta
durante as chamadas de IA (embedding, chat), mesma regra da Fase 9
(Finding C1a da revisão final: nunca segurar conexão do pool durante
chamada HTTP externa).

## 4. Prompt e schema (extensão do `normative-answer-shared.ts`)

Tool schema estendido — cada item ganha `operational_ref_ids` além de
`chunk_ids`:

```json
{
  "type": "function",
  "function": {
    "name": "answer_with_citations",
    "parameters": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "claim": { "type": "string" },
              "chunk_ids": { "type": "array", "items": { "type": "string" } },
              "operational_ref_ids": { "type": "array", "items": { "type": "string" } }
            },
            "required": ["claim", "chunk_ids", "operational_ref_ids"]
          }
        }
      },
      "required": ["items"]
    }
  }
}
```

Prompt de sistema ganha um parágrafo novo explicando a segunda fonte
disponível (quando houver): os itens operacionais fornecidos são fatos
já calculados pelo sistema sobre a empresa do usuário — o modelo pode
citá-los pelo id (`operational_ref_ids`), nunca inventar um fato
operacional que não esteja na lista fornecida, do mesmo jeito que já
não pode inventar um `chunk_id` normativo.

## 5. Modelo de resposta (TypeScript)

```ts
export interface NormativeClaim {
  claim: string;
  chunk_ids: string[];
  operational_ref_ids: string[];
}
```

`NormativeQueryResult` (já existe na Fase 9) não muda de formato —
`answer`/`message`/`citations` continuam do mesmo jeito. O frontend
(`AssistantChat.tsx`) não precisa de nenhuma mudança nesta fase.

## 6. Testes

Mesma disciplina — Postgres real, `overrideProvider` só na chamada de
IA. Casos novos:
- Empresa pergunta algo respondido só por dado operacional (ex.: "eu
  tenho pendência de documento?") — sem chunk normativo relevante,
  resposta cita só `operational_ref_ids`, sem citação normativa.
- Empresa pergunta algo que combina as duas fontes — resposta cita
  `chunk_ids` e `operational_ref_ids` juntos, sobrevive ao Verificador.
- Verificador descarta afirmação com `operational_ref_id` inventado
  (fora do conjunto calculado nesta consulta), mesmo com `chunk_ids`
  válido — precisa que TODAS as citações da afirmação sejam reais, não
  só uma parte.
- Técnico/parceiro: comportamento idêntico à Fase 9 (sem busca
  operacional, mesmo fallback quando não há trecho normativo).
- Sem RLS vazando: consulta de uma empresa nunca traz item operacional
  de outro tenant (teste com dois tenants, dois conjuntos de
  pendências, cada consulta só vê o próprio).

## 7. Pendências

- [ ] Verificação numérica de fidelidade (o texto da afirmação bate
  com o valor real do item citado) — avaliada e descartada nesta fase
  por fragilidade de implementação contra texto livre; se algum dia
  vira preocupação real, o caminho é o modelo devolver o valor
  estruturado (não só o texto), não regex sobre linguagem natural.
- [ ] Rename de `NormativeAssistantService`/`NormativeAssistantController`
  pra um nome que reflita as duas fontes — cosmético, não bloqueia.
