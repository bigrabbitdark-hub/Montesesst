# Princípios do Assistente Montese SST

> Documento de princípios, não de arquitetura de implementação. Registra
> *o que o Assistente é e não é*, e as regras que qualquer agente futuro
> (existente ou ainda não construído) precisa respeitar — não decide quantos
> agentes existem, se há um orquestrador, ou como cada pipeline funciona.
> Essas decisões pertencem à spec de cada frente específica, quando ela for
> brainstormada. Complementa `docs/vision.md` (visão geral do produto);
> não o substitui.
>
> Boa parte das regras aqui já está implementada, não é aspiracional — este
> documento generaliza pra qualquer agente futuro o que hoje já vale só
> pro Assistente RAG Normativo (Fase 9/10). Onde isso é o caso, o texto
> aponta o código real.
>
> Escrito a partir de uma visão trazida pelo fundador em 2026-09-04 sobre
> expandir o Assistente pra um sistema multiagente (documental, pessoas,
> EPI, treinamentos, normativo, auditor). Antes de especificar qualquer
> agente novo, este documento fixa por escrito os princípios que já valiam
> implicitamente e que qualquer expansão futura precisa herdar.

## 1. Missão

> O Assistente Montese SST transforma dados e documentos fornecidos pela
> empresa em uma estrutura operacional de SST organizada, rastreável e
> acionável, usando conhecimento normativo vindo prioritariamente de fontes
> oficiais — sem substituir a responsabilidade e a avaliação do profissional
> de Segurança e Saúde do Trabalho.

A palavra que resume o papel do Assistente em qualquer contexto: **assistir,
não substituir**. Isso já está fixo publicamente em
`frontend/content/legal/compromisso-sst.mdx` ("a Montese SST não substitui a
avaliação de um profissional legalmente habilitado...") e vale com a mesma
força pra qualquer agente futuro, não só pros já construídos.

## 2. Três níveis de confiança, sempre visíveis

Toda informação que o Assistente apresenta — de qualquer agente, sobre
qualquer assunto — carrega um destes três níveis, nunca fica implícito:

- 🟢 **Confirmado** — existe evidência direta suficiente (um documento, uma
  data, um trecho normativo real).
- 🟡 **Requer verificação** — existe alguma informação, mas não o bastante
  pra uma conclusão sozinha.
- 🔴 **Atenção prioritária** — existe evidência que justifica ação ou revisão
  profissional antes de prosseguir.

**Regra fixa, não negociável: "não encontrado" nunca vira "não existe".**
Se o Assistente não localiza um documento/dado, a frase é sempre "não
localizado na documentação analisada" — nunca "a empresa não possui". A
ausência de evidência não é evidência de ausência.

## 3. Limites absolutos

O Assistente (qualquer agente, presente ou futuro) **pode**: organizar,
comparar, localizar, alertar, buscar normas, explicar, sugerir ações,
preparar rascunhos de documento/relatório, apoiar o técnico, identificar
inconsistências, apontar registros.

O Assistente **nunca pode**: declarar uma empresa "regular" em qualquer
aspecto legal; substituir avaliação profissional; criar uma obrigação
normativa sem citar a fonte oficial; inventar EPI, prazo ou validade;
tratar uma imagem como conclusão definitiva de risco; emitir laudo técnico
sem um profissional responsável assinando.

Isso já é código real, não só intenção — o prompt de sistema do Assistente
RAG hoje diz literalmente: *"Você nunca responde com conhecimento próprio,
memória ou suposição — só com o que está literalmente nos trechos e nos
itens fornecidos"* (`backend/src/normative/normative-answer-shared.ts:5`), e
toda resposta passa por um verificador determinístico que descarta qualquer
afirmação sem uma fonte citada de verdade (`normative-assistant.service.ts:116-130`).
Qualquer agente novo precisa da mesma garantia — não é obrigatório reusar o
mesmo mecanismo, mas o resultado (nunca afirmar sem fonte real) é inegociável.

## 4. Hierarquia de fontes

Quando uma resposta depende de mais de uma fonte, a ordem de confiança é:

1. Fonte oficial (MTE, legislação, órgão competente).
2. Documento fornecido pela própria empresa (PGR, laudos, certificados).
3. Registro feito pelo técnico (inspeção, validação, ação).
4. Interpretação da IA sobre as três fontes acima — nunca fonte primária de
   obrigação normativa por conta própria.

## 5. Três níveis de inteligência — banco primeiro, IA quando necessário

Discutido com o fundador em 2026-09-04. Nenhum dos três é aspiracional —
os três já existem, espalhados pelo código, sem estar nomeados assim:

- **Nível 1 — Determinístico, sem LLM.** Contagens, vencimentos, status,
  permissões, regras simples. Ex.: a importação de planilha de
  funcionários (`backend/src/employees/csv-import.util.ts`) é 100%
  determinística — parsing de string + regex + lookup em tabela, zero IA.
- **Nível 2 — IA operacional.** Resumir, extrair, classificar texto/áudio
  livre — o Copiloto de relato (Fase 8) e a ata por IA (Fase 13).
- **Nível 3 — IA especializada + RAG.** Perguntas que dependem de cruzar
  fonte oficial com dado da empresa — o Assistente RAG Normativo/
  Operacional (Fase 9/10).

Qualquer capacidade nova começa perguntando "isso precisa mesmo de LLM,
ou é nível 1?" antes de gastar uma chamada de IA.

## 6. Acesso a modelos: interface por capacidade, não um Gateway único

Cada capacidade de IA já é desacoplada do provedor por trás dela através
de uma interface pequena e específica, trocável via injeção de dependência
do NestJS (`useClass`) — não por um "Model Gateway" central. Precedente
real: `FieldReportExtractor` (`backend/src/ai-copilot/field-report-extractor.interface.ts`)
tem duas implementações completas hoje, `OpenRouterExtractorService`
(ativa) e `MiniMaxExtractorService` (escrita, testada, só não ligada) —
trocar é mudar uma linha de `useClass`, sem tocar em nenhum agente que a
consome.

**Decisão deliberada: cada capacidade nova ganha sua própria interface
pequena, não um Gateway único cobrindo extração/embeddings/chat/
transcrição de uma vez.** Um Gateway centralizado antes de existir dor real
de manutenção repetida seria infraestrutura adiantada — a mesma disciplina
já seguida em outras frentes deste projeto (ex.: CAEPI, Fase 17, não usa o
`@nestjs/schedule` que já existe porque a dor de agendar automaticamente
não existe ainda). Revisitar isso só se um padrão de dor real aparecer
depois de mais agentes construídos.

## 7. Custo é uma restrição de design, não um detalhe posterior

`OPENROUTER_API_KEY` já é uma conta real, com saldo real — já houve um
incidente real de estouro de crédito numa chamada sem limite de tokens
(Fase 8). Qualquer agente novo entra com rate limit dedicado por endpoint
**desde a ativação**, mesmo padrão já usado em `AI_DRAFT_RATE_LIMIT_MAX`/
`ASSISTANT_RATE_LIMIT_MAX`/`ATA_AUDIO_RATE_LIMIT_MAX` — e nenhum agente é
anunciado como ativo pro fundador antes de ser validado contra a API real
(paga), não só contra mock. `MINIMAX_API_KEY` não é necessária pra nenhuma
capacidade planejada hoje — só entraria em jogo se um dia vocês quiserem
comparar custo/qualidade contra o que já está ativo.

## 8. Fora de escopo deste documento

- Quantos agentes existem, se há um orquestrador central, ou qualquer
  decisão de arquitetura de implementação — decisão de cada spec futura.
- Qualquer frente específica (upload de planilha de RH, classificação de
  cargo/setor, pipeline de extração de documento) — cada uma vira sua
  própria spec, brainstormada e aprovada antes de qualquer plano.
- Cronograma, pricing, ou nomes de plano (Start/Assistido/Gestão/Enterprise).
