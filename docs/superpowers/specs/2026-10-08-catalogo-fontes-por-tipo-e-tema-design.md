# Catálogo de fontes normativas por tipo e tema — design (rascunho para decisão)

> Data: 2026-10-08 · Escopo: **backend (`backend/src/normative`) + migration + frontend (`/admin/normativa`)** · **Nenhum código ainda** · Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
> Origem: decisão do proprietário de 2026-10-08 (classificar fontes por tipo, separar "fonte" de "tema", impedir que uma página-portal seja tratada como norma). Continua a fatia 2a (commit `3e114fa`).

## 1. Problema (VERIFICADO no código de 2026-10-08)

1. `official_sources` tem só `entity, code, title, official_url, active` + estado do monitor (migrations 0021, 0050, 0052). **Não há tipo, tema nem status de curadoria.** Um portal (Imprensa Nacional "Normas e Legislação") e uma lei têm a mesma forma.
2. **Desativar uma fonte não a tira do Assistente.** `searchReference` (`normative-assistant.service.ts`, ~L675) filtra só `d.status = 'vigente' AND d.indexed_at IS NOT NULL`; **não filtra `official_sources.active`** (busca por `active` no arquivo: nenhuma ocorrência). `active=false` apenas faz o cron pular a fonte; o documento vigente dela continua alimentando as respostas.
3. Consequência prática: uma fonte-portal que já tenha documento `vigente` continua sendo citável, e as duas fontes de 9 caracteres vigentes (achadas na fatia 1) também. Desativar a Imprensa Nacional pela tela, como decidido, **não basta** para tirá-la do RAG.
4. Não existe agrupamento por tema: "LTCAT" é uma fonte única com uma URL, quando na verdade é um tema com várias normas (Decreto 3.048/99, IN do INSS, eSocial S-2240, NRs, jurisprudência).
5. As citações do Assistente (`NormativeQueryCitation`) trazem `title`, `code`, `official_url` da fonte, mas nada que diga **que tipo de autoridade** é (norma primária, jurisprudência, manual).

## 2. Decisões propostas

### 2.1 Tipo da fonte (`source_type`)
Coluna `text NOT NULL` com CHECK, valores iniciais (do texto do proprietário):
`norma_primaria` (lei, decreto) · `norma_trabalhista` (NR) · `norma_previdenciaria` (INSS, Decreto 3.048) · `jurisprudencia` (TNU, STF, STJ, TST) · `esocial` (manual, leiaute, notas técnicas) · `orgao_oficial` (MTE, INSS, CJF) · `descoberta` (portal de normas/notícias) · `documento_empresa` (PGR, LTCAT, PCMSO — modelo, não norma).
- **`descoberta` nunca alimenta o RAG de resposta** (regra do retrieval, §2.3); serve só para monitorar e sugerir (fatia futura).
- Fontes existentes: valor inicial **`norma_trabalhista` para as com `code` NR-xx** e **`norma_primaria`/`orgao_oficial` por revisão do proprietário** para as demais; o que não for classificado fica `nao_classificada` e **não é citável até classificar** (decisão aberta §5-A).

### 2.2 Estado de curadoria derivado, sem duplicar o que existe
Não criar um status paralelo ao que já temos. Os estados do proprietário (ATIVA, PENDENTE_VALIDACAO, DESATIVADA, ERRO_EXTRACAO, URL_ALTERADA) são **calculados** a partir de campos existentes e mostrados na tela:
| Estado | Origem |
|---|---|
| DESATIVADA | `active = false` |
| ERRO_EXTRACAO | `consecutive_failures > 0` |
| PENDENTE_VALIDACAO | existe documento `aguardando_validacao` |
| URL_ALTERADA | `last_check_status IS NULL` depois de trocar a URL (a edição já zera o estado) |
| ATIVA | demais |
Isso evita estados que dessincronizam. Só vira coluna nova se o proprietário quiser um estado **manual** (ex.: "em análise"), o que não está pedido.

### 2.3 Regra do retrieval (a correção de maior valor e menor risco)
`searchReference` passa a exigir `s.active = true AND s.source_type <> 'descoberta' AND s.source_type <> 'documento_empresa'` (e, decisão §5-A, `<> 'nao_classificada'`). Efeito: **desativar uma fonte também a tira das respostas**, sem apagar o documento nem o histórico. É mudança de comportamento do Assistente → exige rodar a avaliação (Camada A) antes de liberar.

### 2.4 Tema (`normative_topics`) e relação com fontes
- Tabela `normative_topics (id, slug, name, description)` e `normative_topic_sources (topic_id, source_id, role)` com `role` opcional (`base_legal`, `procedimento`, `esocial`, `jurisprudencia`).
- Tema inicial a modelar: **LTCAT** (Decreto 3.048/99 · IN INSS aplicável · eSocial S-2240 · NRs relacionadas · TNU), conforme o proprietário. **Quais fontes entram em cada tema é decisão do proprietário**; a Montese não escolhe norma nem URL.
- Tela: aba/seção "Temas" listando fontes por tema, com aviso de tema sem base legal (nenhuma fonte `norma_*`).
- Uso no Assistente (fase seguinte, não nesta): ao responder sobre um tema, recuperar de preferência as fontes do tema e citar a **base legal** separando tipo de autoridade na citação. Fora do escopo da primeira entrega.

### 2.5 Citações com tipo
`NormativeQueryCitation` ganha `source_type` (aditivo, opcional). A UI do Assistente pode mostrar o tipo ("Jurisprudência — TNU") sem mudar o fluxo.

## 3. Entregas sugeridas (ordem)
1. **E1 — corrigir o retrieval para respeitar `active`** (sem migration; função + teste; avaliação Camada A). Resolve a decisão "desativar Imprensa Nacional" de fato. **RECOMENDADO fazer primeiro, mesmo que o resto espere.**
2. **E2 — `source_type` (migration aditiva 00xx) + tela:** coluna, edição, filtro, regras de retrieval do §2.3, estados calculados do §2.2. Classificação das fontes existentes por revisão do proprietário.
3. **E3 — temas:** tabelas, tela de temas, cadastro do tema LTCAT com as fontes que o proprietário indicar.
4. **E4 — Assistente por tema + citação com tipo.**

## 4. Riscos
- **Retrieval mais restritivo reduz cobertura** se muitas fontes forem marcadas como não citáveis: medir com a avaliação Camada A antes/depois (não rodar contra produção sem autorização).
- **Migration**: aditiva (coluna com DEFAULT `nao_classificada`, tabelas novas, sem RLS como `official_sources`). Não destrutiva; mesmo assim, só aplicar com autorização e backup lembrado.
- **Classificar errado uma fonte** esconde norma boa das respostas: por isso o default seguro (§5-A) é decisão do proprietário, e a tela mostra quantas fontes ficaram fora do RAG.
- Segue valendo: **a IA não é autoridade normativa**; tipo e tema são curadoria humana, nada é inferido por modelo.

## 5. Decisões abertas do proprietário
A. Fonte `nao_classificada`: **citável (compatível com hoje) ou fora do RAG até classificar?** RECOMENDADO: citável nas fontes que já têm `vigente` até a classificação terminar, com contador na tela, e depois virar fora-do-RAG.
B. Valores de `source_type`: a lista do §2.1 está completa? Algum a acrescentar (ex.: `manual_orgao`)?
C. Quais fontes o tema LTCAT reúne e quem indica as normas.
D. Fazer a E1 já (independente do resto)?

## 6. Fora de escopo
Descoberta automática de normas novas por portais; classificação por IA; versionamento por tema; escolha de URLs oficiais; as fatias 2b/3 do monitor.

## 7. Git e release
Sem commit, push ou deploy automáticos (AGENTS.md). Migration só com autorização explícita.
