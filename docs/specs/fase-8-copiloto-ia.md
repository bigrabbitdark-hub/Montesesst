# Fase 8 — Copiloto de IA (relato em campo → checklist de inspeção)

## 1. Objetivo e escopo

Primeira integração de IA de todo o sistema — hoje nenhuma chamada a API
de IA existe no backend. Escopo definido no briefing original do
fundador (`docs/vision.md`, item 8 do MVP): "Copiloto de IA (relato em
campo → relatório estruturado)".

**O que este sub-projeto faz:** o técnico (responsável ou parceiro), já
dentro de uma inspeção existente (fluxo da Fase 6A), digita um relato
livre do que observou na visita. Um endpoint novo envia esse texto pra
uma IA externa, que devolve uma sugestão de preenchimento para os itens
do checklist que o relato mencionou (`status` C/NC/NA + `notes`). O
frontend pré-preenche os campos do checklist — já existentes — com essa
sugestão, marcada visualmente como rascunho da IA. O técnico revisa,
edita o que quiser, e salva pelos endpoints **já existentes**
(`PATCH /inspections/:id/items/:itemId`, `POST /inspections/:id/concluir`).

**O que este sub-projeto NÃO faz** (fora de escopo, deliberado):
- Não cria nenhuma tabela nova nem grava nada no banco por conta própria
  — é uma transformação stateless (texto → sugestão), nunca persiste.
- Não gera planos de ação — isso já acontece automaticamente ao concluir
  a inspeção, pra qualquer item marcado `NC` (`inspections.service.ts`,
  em torno da linha 207), independente de como o item chegou a `NC`. O
  Copiloto não precisa reimplementar nada disso.
- Não aceita áudio, foto ou qualquer entrada além de texto digitado —
  decisão confirmada com o fundador em 2026-08-27 (mais simples de
  implementar, sem pipeline de transcrição/visão computacional).
- Não gera um documento/relatório separado do checklist — só preenche o
  checklist estruturado que já existe.
- Não fica ativo com uma API paga desde já — ver seção 3.

## 2. Modelo do checklist (já existe, não muda)

O checklist de inspeção tem exatamente **16 itens fixos, em 4 blocos**
(`backend/src/inspections/checklist-items.const.ts`):

| Bloco | `item_key` | Rótulo |
|---|---|---|
| documentacao | `fichas_epi` | Fichas de EPI em dia |
| documentacao | `ordem_servico` | Ordem de Serviço |
| documentacao | `validade_ca` | Validade do CA |
| documentacao | `aso_em_dia` | ASO em dia |
| epis | `uso_adequado` | Uso adequado |
| epis | `estado_conservacao` | Estado de conservação |
| epis | `compatibilidade_risco` | Compatibilidade com risco do setor |
| epis | `reposicao_danificados` | Reposição de danificados |
| instalacoes | `luzes_emergencia` | Luzes de emergência |
| instalacoes | `sinalizacao` | Sinalização |
| instalacoes | `extintores` | Extintores (validade e pressão) |
| instalacoes | `rotas_fuga` | Rotas de fuga |
| maquinas | `protecoes` | Proteções |
| maquinas | `loto` | LOTO (bloqueio/travamento) |
| maquinas | `distancia_seguranca` | Distância de segurança |
| maquinas | `treinamento_operador` | Treinamento do operador |

`status` é `'C' | 'NC' | 'NA'`, `notes` é texto livre opcional — mesmos
nomes de campo de `UpdateChecklistItemDto`
(`backend/src/inspections/dto/update-checklist-item.dto.ts`). O
Copiloto de IA **reusa exatamente esses 16 `item_key` e esse vocabulário
de status** — não inventa categoria nova.

## 3. Provedor de IA: MiniMax, plugado mas desligado

Decisão confirmada com o fundador em 2026-08-27: a assinatura paga da
API do MiniMax só acontece **depois** dos testes internos. Até lá, o
código de integração já é escrito e fica completo, mas atrás de uma
chave vazia — mesmo padrão já usado neste projeto com
`MERCADOPAGO_PROD_ACCESS_TOKEN` (presente no `.env`, não usado até o
fundador decidir vender de verdade).

**API do MiniMax (confirmado via documentação oficial,
`platform.minimax.io/docs/api-reference/text-openai-api`):**
- Compatível com o formato OpenAI Chat Completions.
- Endpoint: `https://api.minimax.io/v1/chat/completions`.
- Autenticação: header `Authorization: Bearer <MINIMAX_API_KEY>`.
- Corpo mínimo: `{ model, messages: [{role, content}] }`.
- Saída estruturada via `tools` (function calling) — o modelo devolve
  `tool_calls` na mensagem de resposta, no mesmo formato do OpenAI SDK.

**Variável de ambiente nova:** `MINIMAX_API_KEY` (vazia no `.env` até o
fundador assinar) e `MINIMAX_MODEL` (ex.: `MiniMax-M3`, com valor
default no código pra não exigir configuração extra).

**Sem chave configurada:** o endpoint responde `503` com uma mensagem
clara ("Copiloto de IA ainda não está disponível") **antes** de tentar
qualquer chamada de rede — nunca deixa a tentativa falhar com um erro
de rede genérico.

## 4. Backend

### 4.1 Interface trocável

```typescript
// backend/src/ai-copilot/field-report-extractor.interface.ts
export interface ChecklistItemSuggestion {
  item_key: string;
  status: 'C' | 'NC' | 'NA';
  notes: string;
}

export interface FieldReportExtractor {
  extract(reportText: string): Promise<ChecklistItemSuggestion[]>;
}

export const FIELD_REPORT_EXTRACTOR = Symbol('FIELD_REPORT_EXTRACTOR');
```

`FIELD_REPORT_EXTRACTOR` é o token de injeção do Nest — permite trocar a
implementação real por uma falsa nos testes (`overrideProvider`), mesmo
padrão já usado com `MercadoPagoService` em
`subscriptions-update-status.e2e-spec.ts`.

### 4.2 Implementação real (MiniMax)

`backend/src/ai-copilot/minimax-extractor.service.ts` implementa
`FieldReportExtractor`:

1. Se `process.env.MINIMAX_API_KEY` estiver vazio, lança
   `ServiceUnavailableException('Copiloto de IA ainda não está
   disponível')` **antes** de montar a requisição.
2. Monta a chamada HTTP pro endpoint do MiniMax (via `fetch` nativo do
   Node 20, sem SDK novo — o formato é simples o bastante pra não
   justificar uma dependência nova) com:
   - `system` message: o prompt da seção 5 abaixo, com os 16 `item_key`
     e regras de extração.
   - `user` message: o `reportText` recebido.
   - `tools`: um único tool `structure_checklist_items` com o JSON
     Schema da seção 5, `tool_choice` forçando o uso desse tool (evita
     resposta em texto livre não estruturado).
3. Extrai `tool_calls[0].function.arguments` (string JSON), faz
   `JSON.parse`, valida que cada `item_key` está entre os 16 válidos e
   cada `status` está em `['C','NC','NA']` — descarta silenciosamente
   qualquer item fora disso (a IA pode alucinar uma chave; nunca deixa
   passar pro frontend um `item_key` que o checklist não reconhece).
4. Erros de rede/HTTP da API do MiniMax propagam como `502 Bad Gateway`
   (a chamada existe mas falhou) — distinto do `503` de "não
   configurado" acima.

### 4.3 Endpoint novo

`backend/src/inspections/inspections.controller.ts` ganha:

```
POST /inspections/:id/ai-draft
Roles: tecnico, parceiro (mesmo par de roles de
       `PATCH .../items/:itemId`)
Body: { report_text: string }  (obrigatório, não vazio)
Resposta: ChecklistItemSuggestion[]
```

Só valida que a inspeção existe (`SELECT` via `withTenantContext`, mesmo
padrão de todo o resto do controller) — não lê nem escreve nenhum item
do checklist, só delega pro `FieldReportExtractor` injetado e devolve o
resultado. O acesso entre técnico/parceiro e a inspeção **não é checado
em código** aqui, assim como não é em nenhum outro endpoint deste
controller — é RLS (`FORCE ROW LEVEL SECURITY` em `inspections`, via
`EXISTS` contra `tenant_technicians`/`tenant_partners`) que impede a
consulta de enxergar uma inspeção de um tenant sem vínculo, devolvendo
"não encontrada" nesse caso. A chamada de IA em si acontece fora dessa
transação de banco — mesmo princípio de "rede fora de qualquer conexão
do pool" já usado com Mercado Pago.

## 5. Prompt e schema de extração

Validado manualmente nesta conversa (2026-08-27) contra exemplos de
relato antes de virar código — ver seção 7.

**System prompt:**

```
Você é um assistente que ajuda técnicos de Segurança e Saúde do
Trabalho (SST) a estruturar relatos de visita em campo dentro de um
checklist fixo de inspeção. Você organiza o que o técnico já observou e
relatou — você NUNCA toma decisão técnica de SST nem avalia se algo é
seguro.

O checklist tem exatamente estes 16 itens, em 4 blocos:

documentacao: fichas_epi (Fichas de EPI em dia), ordem_servico (Ordem de
Serviço), validade_ca (Validade do CA), aso_em_dia (ASO em dia)

epis: uso_adequado (Uso adequado), estado_conservacao (Estado de
conservação), compatibilidade_risco (Compatibilidade com risco do
setor), reposicao_danificados (Reposição de danificados)

instalacoes: luzes_emergencia (Luzes de emergência), sinalizacao
(Sinalização), extintores (Extintores, validade e pressão), rotas_fuga
(Rotas de fuga)

maquinas: protecoes (Proteções), loto (LOTO, bloqueio/travamento),
distancia_seguranca (Distância de segurança), treinamento_operador
(Treinamento do operador)

Para cada item que o relato mencionar, direta ou indiretamente, chame a
ferramenta structure_checklist_items com:
- item_key: a chave exata da lista acima
- status: "C" (conforme), "NC" (não conforme) ou "NA" (não se aplica)
- notes: um resumo curto (1-2 frases), em português, só com o que o
  relato realmente disse sobre aquele item

Regras obrigatórias:
- Nunca inclua um item que o relato não mencionou, nem direta nem
  indiretamente.
- Se o relato for ambíguo sobre um item (não dá pra saber se é conforme
  ou não), não inclua esse item — melhor deixar de fora do que
  adivinhar.
- Não adicione recomendação, opinião técnica ou conclusão que não
  esteja explícita no relato. Você estrutura o que o técnico disse, não
  avalia a segurança do local.
```

**Tool schema (function calling):**

```json
{
  "name": "structure_checklist_items",
  "description": "Retorna os itens do checklist mencionados no relato do técnico",
  "parameters": {
    "type": "object",
    "properties": {
      "items": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "item_key": {
              "type": "string",
              "enum": ["fichas_epi", "ordem_servico", "validade_ca", "aso_em_dia",
                       "uso_adequado", "estado_conservacao", "compatibilidade_risco", "reposicao_danificados",
                       "luzes_emergencia", "sinalizacao", "extintores", "rotas_fuga",
                       "protecoes", "loto", "distancia_seguranca", "treinamento_operador"]
            },
            "status": { "type": "string", "enum": ["C", "NC", "NA"] },
            "notes": { "type": "string" }
          },
          "required": ["item_key", "status", "notes"]
        }
      }
    },
    "required": ["items"]
  }
}
```

## 6. Frontend

Tela de checklist da inspeção (`frontend/src/app/tecnico/.../inspecoes/[id]`
e a equivalente de parceiro) ganha uma seção "Copiloto de IA" no topo:
textarea pro relato + botão "Gerar rascunho com IA". Ao clicar:

1. Chama `POST /api/inspections/:id/ai-draft`.
2. Pré-preenche, no estado do formulário já existente, `status`/`notes`
   dos itens sugeridos — sem chamar nenhum endpoint de salvar ainda.
3. Cada campo pré-preenchido pela IA ganha um indicador visual (ex.:
   borda/badge "sugestão da IA") até o técnico interagir com aquele
   campo — depois disso vira um campo normal, sem diferença visual do
   preenchimento manual.
4. Se o endpoint devolver `503` (não configurado): mostra
   "Copiloto de IA ainda não está disponível nesta conta." Se devolver
   `502`: "Não foi possível gerar o rascunho agora, tente novamente."
5. Salvar continua 100% pelo fluxo já existente — nenhum novo botão de
   "salvar com IA".

**Aviso obrigatório, fixo, não removível**, acima da textarea — regra
confirmada pelo fundador e já registrada na categoria G da
[matriz de conformidade](../compliance/matriz-conformidade.md):

> "Sugestão gerada por IA — revise e confirme. Não substitui a
> avaliação do profissional habilitado."

Mesma frase-chave já publicada em `/compromisso-sst`.

## 7. Validação manual do prompt (2026-08-27)

Dois exemplos rodados manualmente nesta conversa, simulando o papel do
MiniMax, antes de qualquer código:

**Exemplo 1** — relato rico: *"Cheguei na obra, os funcionários estavam
todos de capacete e óculos, mas dois sem protetor auricular perto da
serra circular. A ordem de serviço tava afixada certinho. Vi um
extintor com o lacre rompido e a data vencida desde março. As rotas de
fuga estavam sinalizadas mas tinha material de obra bloqueando uma
delas."*

Extração esperada: `uso_adequado` → NC (protetor auricular ausente
perto da serra); `ordem_servico` → C; `extintores` → NC (lacre rompido,
vencido); `rotas_fuga` → NC (bloqueada por material); `sinalizacao` → C
(a sinalização em si estava correta, distinto da rota estar
fisicamente obstruída). Mostra que o modelo consegue diferenciar dois
itens relacionados (sinalização vs. rota de fuga) sem confundir um pelo
outro.

**Exemplo 2** — relato ambíguo: *"Empresa parece organizada, conversar
com o encarregado sobre treinamento."*

Extração esperada: nenhum item — "conversar sobre treinamento" não
afirma se o treinamento existe ou não, então `treinamento_operador` fica
de fora, conforme a regra de não adivinhar.

Os dois casos validam o desenho do prompt e do schema antes de gastar
qualquer chamada real (não há chave do MiniMax ainda).

## 8. Testes

Suíte e2e real contra Postgres (padrão do projeto), com
`FieldReportExtractor` trocado por uma implementação falsa via
`overrideProvider` — nenhum teste chama o MiniMax de verdade, porque não
existe chave configurada ainda:

- `POST /inspections/:id/ai-draft` com extractor falso devolve as
  sugestões mapeadas corretamente pros 16 `item_key`.
- `item_key` fora da lista de 16 (simulando alucinação da IA) é
  descartado, não aparece na resposta.
- Sem `MINIMAX_API_KEY` (testando a implementação real, não a falsa):
  `503` antes de qualquer tentativa de rede.
- Papel `empresa` ou `admin`: `403`.
- Técnico/parceiro sem vínculo com a inspeção: `404` (RLS esconde a
  linha, mesmo comportamento de `PATCH .../items/:itemId` hoje).

## 9. Decisões confirmadas (brainstorming de 2026-08-27)

- Entrada: só texto livre digitado — sem áudio, sem foto.
- Saída: preenche o checklist estruturado já existente — não gera
  documento separado.
- Revisão humana obrigatória antes de qualquer gravação — o endpoint
  novo nunca escreve no banco.
- Provedor: MiniMax, mas fica "plugado e desligado" até o fundador
  assinar — mesmo padrão do `MERCADOPAGO_PROD_*`.
- Papel do Claude nesta fase de testes internos: desenhar e validar o
  prompt manualmente (seção 7), não substituir a chamada real em
  produção.

## 10. Pendências

- [ ] Assinatura real da API do MiniMax — decisão e ação do fundador,
      fora do escopo técnico deste sub-projeto.
- [ ] Depois que `MINIMAX_API_KEY` existir de verdade: rodar os dois
      exemplos da seção 7 contra a API real e comparar com a extração
      manual, antes de liberar pra uso em produção.
- [ ] Custo por chamada (tokens de entrada/saída) não foi medido —
      só relevante depois que a chave existir.
