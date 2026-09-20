# Confiabilidade do Assistente — Etapas 2 e 3 (dataset golden, runner de avaliação e log de uso)

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-20.
> Segunda spec da série que saiu da auditoria dos agentes Montese SST
> (a primeira, `docs/specs/assistente-confiabilidade-etapa-1.md`, já está em
> `main` desde 7cd5f13). Dataset e runner ficam numa spec só porque dividem
> o mesmo formato de registro; a ordem acordada com o fundador é
> **dataset e testes ANTES de qualquer mudança de chunking/busca** — sem
> baseline não há como saber se uma mudança melhorou ou piorou o
> Assistente (o limiar de similaridade 0.4 e a troca de provedor já foram
> decididos sem nenhuma medição).
>
> **O que a auditoria mostrou que esta etapa fecha:** não existe nenhum
> banco de perguntas nem teste de qualidade do Assistente (só testes de
> mecânica, ~16 e2e); a observabilidade é só `Logger.warn` (o Verificador
> v2 registra números com unidade sem base e isso se perde); e o `query()`
> devolve só a resposta final, sem expor quais trechos foram recuperados.
>
> **Não é arquitetura paralela:** reaproveita `NormativeAssistantService`
> (a mesma implementação de produção é medida), `official_sources` /
> `normative_documents` (fonte das evidências), `minimax_usage_log` (custo)
> e o padrão de scripts standalone de `db/caepi-sync.ts`. Não toca em
> chunking, busca, embeddings, prompts nem no monitor.

## 1. Objetivo e escopo

1. **Banco de perguntas golden** — ~60 perguntas, 8 tipos, cada uma com o
   item normativo e o **trecho literal** do PDF como evidência, conferido
   por código.
2. **Runner de avaliação** — mede o pipeline real em duas camadas
   (recuperação, sem custo; resposta real, opt-in com teto de custo) e
   compara com um baseline versionado.
3. **Log de uso persistido** — `assistant_query_log`, só metadados e ids,
   nunca texto de pergunta/claim/resposta.

**Fora de escopo:**

- Chunking estrutural, `tsvector`/busca híbrida, mudança de limiar — é a
  etapa seguinte, **guiada pelo baseline** que esta etapa produz.
- Classificador de pergunta, semáforo 🟢🟡🔴, tela de revisão de perguntas.
- LLM como juiz (dobra o custo e é um modelo se autoconferindo — mesma
  razão da spec da Fase 9 para o Verificador determinístico).
- Perguntas que dependem de dado de empresa (documentos, pendências): já
  cobertas pelos e2e com fixtures; o golden roda sem tenant.
- Perguntas de checklist SST: **segunda leva** do dataset, depois que a
  integração do checklist (`a6dc490`, na branch `feat/assistente-confiabilidade-etapa-1`)
  estiver em `main` (§3.7).
- Bloqueio por números com unidade: continua só registrado; esta etapa gera
  o dado para decidir (§4.5), mas a decisão é do fundador.
- Agendamento automático das avaliações.

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Validador — "rascunho agora, validação depois".** O dataset nasce com
  `status: rascunho` e `validado_por: null`. O runner mede tudo, mas **só
  `status: validado` conta como gate de regressão**; rascunhos são medidos
  e reportados à parte. Validar vira conferir citação e conclusão (rápido
  para um profissional de SST), e a citação é conferida por código antes.
  Rejeitados: exigir validador nomeado antes de começar (bloqueia a etapa
  na agenda de uma pessoa) e tela de revisão dentro da plataforma (UI nova,
  escopo grande).
- **Avaliação em duas camadas, LLM só por flag.** Camada A (recuperação +
  avisos) é determinística, custa centavos de embedding e roda sempre;
  Camada B (resposta real) chama o provedor pago só com `--llm` e teto de
  chamadas. Sem LLM-juiz.
- **Log de uso: só metadados e ids.** Nunca o texto da pergunta, da claim
  ou da resposta. Rejeitados: guardar o texto da pergunta (a pergunta pode
  conter dado da empresa — exige decisão de retenção e ajuste da política de
  privacidade antes) e não persistir uso real (perde o sinal real).
- **Dataset e resultados em arquivos versionados no repo**
  (`backend/eval/`), não no banco. O baseline anterior a mexer em chunking
  fica congelado no histórico do git e todo pedido de validação vira um diff
  revisável. O banco de produção só ganha a tabela do log de uso.
- **Abordagem trace-first.** O serviço é refatorado para expor um
  `QueryTrace` (recuperação, verificador, avisos) e o runner chama o mesmo
  código de produção. Rejeitados: runner com SQL próprio (mede uma cópia
  que pode divergir da busca real) e runner por HTTP (produção ainda roda o
  código antigo, exigiria credenciais de usuário e a resposta não traz os
  trechos).
- **A implementação da parte que toca o serviço espera a outra sessão.**
  `normative-assistant.service.ts` está sendo alterado pela integração do
  checklist SST; só se refatora depois que essa integração estiver em
  `main` (§8).

## 3. Dataset golden

### 3.1 Arquivos

```text
backend/eval/golden/perguntas.json       # array de ~60 registros
backend/eval/golden/golden-schema.ts     # tipos + validateGoldenQuestion (puro)
backend/eval/lint-golden.ts              # confere evidências contra o banco (só leitura)
```

### 3.2 Registro

Mapeamento do formato do doc 2 §23 para o que o projeto já tem. Campos com
função hoje:

| Campo | Tipo | Para que serve |
|---|---|---|
| `id` | string | `NR35-001`; único |
| `tipo` | enum | `conceitual`, `aplicacao`, `caso_real`, `contexto_incompleto`, `pegadinha`, `jurisdicional`, `atribuicao_profissional`, `sem_evidencia` |
| `categoria`, `subcategoria` | string | `NR-35`, `Treinamento` |
| `pergunta` | string | texto enviado ao Assistente |
| `resposta_esperada` | string | referência para revisão humana e para o relatório |
| `comportamento_esperado` | enum | `responder`, `pedir_contexto`, `recusar_sem_evidencia`, `alertar_jurisdicao`, `alertar_habilitacao` |
| `fontes_esperadas[]` | objeto | `{ fonte: 'norma', source_code, item, evidencia }` — `evidencia` é o trecho literal; `fonte: 'checklist'` reservado para a segunda leva |
| `avisos_esperados[]` | enum[] | subconjunto de `jurisdicao`, `profissional_habilitado`, `contexto` |
| `proibido_regex[]` | string[] | padrões que a resposta **não** pode conter (útil nas pegadinhas); opcional |
| `jurisdicao` | enum | `federal`, `estadual` ou `municipal` — a jurisdição **a que a pergunta se refere**, não a das fontes disponíveis (hoje só há fonte federal; é justamente o que as perguntas `jurisdicional` expõem) |
| `risco_resposta` | enum | `baixo`, `medio`, `alto` |
| `versao_fonte` | string | `content_hash` do `normative_documents` vigente na verificação |
| `data_verificacao` | `YYYY-MM-DD` | quando o lint conferiu a evidência |
| `status` | enum | `rascunho` ou `validado` |
| `gerado_por` | string | ex.: `claude-sonnet-5 (rascunho)` |
| `validado_por`, `validado_em` | string/data \| null | preenchidos só na validação |

Omitidos por YAGNI (não têm função hoje): `nivel`, `cargo`,
`palavras_chave`, `aplica_se`, `excecoes`, `fonte_url` (deriva de
`official_sources`), `deve_pedir_contexto` e `pode_responder_sem_consulta`
(cobertos por `comportamento_esperado`) e `resposta_se_nao_houver_evidencia`
(é o texto fixo do fallback).

Regras do schema (`validateGoldenQuestion`, função pura, com teste
unitário), por `comportamento_esperado`:

- `responder` — exige `fontes_esperadas` com pelo menos 1 item, cada um com
  `source_code`, `item` e `evidencia` não vazios.
- `recusar_sem_evidencia` — exige `fontes_esperadas` vazio.
- `pedir_contexto` — exige `avisos_esperados` contendo `contexto`.
- `alertar_jurisdicao` — exige `avisos_esperados` contendo `jurisdicao`.
- `alertar_habilitacao` — exige `avisos_esperados` contendo
  `profissional_habilitado`.
- Sempre: `id` único, `tipo`/`status`/`risco_resposta` no enum,
  `validado_por` e `validado_em` não nulos **se e somente se** `status` é
  `validado`, cada `proibido_regex` compila.

### 3.3 Distribuição

60 perguntas: conceitual 8, aplicação 8, caso real 8, contexto incompleto 8,
pegadinha 8, jurisdicional 8, atribuição profissional 6, sem evidência 6.
Comportamento típico por tipo (não imposto pelo schema): conceitual/
aplicação/caso real → `responder`; contexto incompleto → `pedir_contexto`;
pegadinha → `responder` (com `proibido_regex` que barra aceitar a premissa
errada); jurisdicional → `alertar_jurisdicao`; atribuição profissional →
`alertar_habilitacao`; sem evidência → `recusar_sem_evidencia`. As NRs de
maior uso concentram as perguntas de `responder` (NR-01, 05, 06, 07, 10, 12,
13, 15, 17, 18, 20, 23, 33, 35), mas todas as 36 vigentes podem aparecer.

### 3.4 Geração dos rascunhos

Os rascunhos são redigidos na sessão de implementação, a partir do texto
vigente já indexado (`normative_documents.raw_text`, `status = 'vigente'`).
Não há LLM em runtime nessa etapa. Todo registro nasce `status: rascunho`,
`validado_por: null`, `gerado_por` preenchido.

### 3.5 Lint das citações

`backend/eval/lint-golden.ts` (só leitura no banco) confere **por código**
que cada `evidencia` de `fontes_esperadas` existe literalmente no texto
vigente da `source_code` indicada, com espaços em branco normalizados
(quebras de linha, espaços duplos) nos dois lados, e que o `item` aparece
no trecho ou imediatamente antes dele. Também grava `versao_fonte` a partir
do `content_hash` do documento vigente. Citação que não existe no PDF é
**erro** e o lint sai com código 1 — protege o dataset contra alucinação de
quem o redige. Falha legítima de normalização (hifenização, cabeçalho de
página no meio do trecho) se corrige na própria evidência, nunca relaxando
o lint.

### 3.6 Gate

Só `status: validado` entra como gate de regressão (§5.4). Rascunhos são
medidos e aparecem no relatório em seção separada.

### 3.7 Segunda leva (checklist)

`fonte: 'checklist'` em `fontes_esperadas[]` referencia
`sst_checklist_items` por `nr_code` + `document_name`. Entra numa segunda
leva do dataset, depois que a integração do checklist estiver em `main`, com
o mesmo schema e o mesmo runner.

## 4. `QueryTrace` e log de uso

### 4.1 Refatoração do serviço (aditiva)

`NormativeAssistantService` ganha:

- `retrieve(question, ...)` — a recuperação (embedding + busca nas fontes)
  extraída para um método próprio, chamado pelos dois caminhos abaixo.
- `queryWithTrace(question, user, attachment?, tenantId?)` — devolve
  `{ result, trace }`. **Não persiste nada.**
- `query(...)` — **mesma assinatura e mesmo retorno de hoje**: chama
  `queryWithTrace`, grava o trace no log (§4.3) e devolve só o `result`.

Há uma única implementação do pipeline. O contrato HTTP não muda.

### 4.2 `QueryTrace`

Novo tipo em `backend/src/normative/query-trace.ts`:

- **Recuperação** — para cada fonte:
  - normativa: cada trecho candidato, incluindo os cortados pelo limiar,
    com `chunk_id`, `document_id`, `source_code`, `similarity`,
    `passed_threshold`;
  - checklist: `item_id`, `nr_code`, `similarity`, `passed_threshold`;
  - documentos da empresa e itens operacionais: **só** contagem e
    similaridades, sem ids;
  - `threshold` e `chunk_limit` usados.
- **Verificador** — `claims_total`, `claims_dropped_ids`,
  `claims_dropped_support`, `blocking_tokens`, `flagged_numbers`, e
  `kept_claims[]` com **apenas** os ids das fontes que cada claim
  sobrevivente cita (nunca o texto).
- `notices` (tipos), `outcome` (`respondeu`, `fallback_sem_evidencia`,
  `fallback_claims_descartadas`), `used_attachment`, `model`,
  `latency_ms`, `retrieval_ms`.
- **Sem tokens de LLM:** o custo já é registrado em `minimax_usage_log`
  pelos provedores; mudar a interface do provedor seria escopo à toa.

### 4.3 Tabela `assistant_query_log`

Migration nova, **somente aditiva** (próximo número livre — `0051` no
momento desta spec, a confirmar contra a outra sessão na hora de
implementar):

- `id`, `created_at`, `role` (`empresa`/`tecnico`/`parceiro`),
  `tenant_id` (`REFERENCES tenants ON DELETE SET NULL`),
  `question_hash` (SHA-256 da pergunta — serve para contar repetidas; **não**
  é anonimização forte), `outcome`, `notices text[]`, `retrieved jsonb`,
  `claims_total`, `claims_dropped_ids`, `claims_dropped_support`,
  `blocking_tokens text[]`, `flagged_numbers text[]`, `used_attachment`,
  `model`, `latency_ms`, `retrieval_ms`.
- **Nunca** o texto da pergunta, da claim ou da resposta.
- **Regra de privacidade dos tokens:** `blocking_tokens` e
  `flagged_numbers` só são gravados quando a claim citava **apenas** trechos
  normativos oficiais. Se citava documento da empresa, item operacional ou
  anexo, grava-se só a contagem, porque o token poderia vir de dado da
  empresa.
- `retrieved` guarda ids só de fontes de referência (normativas e
  checklist); fontes da empresa entram como contagem e similaridade.
- **RLS:** habilitada; leitura só de `app.role = 'admin'`; inserção aberta à
  aplicação (o `query()` roda com qualquer papel). Segue o padrão das
  migrations de RLS já existentes.
- **Retenção de 90 dias:** job diário `@Cron` no mesmo padrão dos crons
  existentes, apagando `created_at < now() - interval '90 days'`.
- A gravação **nunca bloqueia nem derruba a resposta** ao usuário: falha
  vira log de erro.

### 4.4 O runner não escreve na tabela

O runner chama `queryWithTrace` direto e guarda o resultado em arquivo. Isso
mantém as estatísticas do uso real limpas, sem coluna `origem`.

### 4.5 `usage-report`

`backend/eval/usage-report.ts` (só leitura) agrega o log dos últimos N dias:
taxa de fallback por desfecho, distribuição da similaridade do melhor
trecho, frequência de `flagged_numbers` e de `blocking_tokens`, papel e
volume. É o insumo para o fundador decidir se números com unidade já podem
virar bloqueio; a spec só garante que o dado existe.

## 5. Runner e métricas

### 5.1 Execução

Scripts `tsx` (padrão de `db/caepi-sync.ts`) em `backend/eval/`, expostos por
`npm run` e executados pelo wrapper que carrega o ambiente
(`./run-backend-tests.sh eval:retrieval`):

| Comando | O que faz |
|---|---|
| `eval:lint` | confere as evidências do dataset contra o banco (§3.5) |
| `eval:retrieval` | Camada A |
| `eval:answer` | Camada B (exige `--llm`) |
| `eval:usage` | `usage-report` (§4.5) |

O runner sobe um contexto Nest **sem servidor HTTP** e chama o mesmo
`NormativeAssistantService` de produção. Filtros: `--tipo`, `--ids`.
Saída: `--out backend/eval/baselines/<data>-<camada>.json` e
`--compare <baseline.json>`.

### 5.2 Camada A — recuperação e avisos (sem LLM de resposta)

Chama só `retrieve()` (embedding + busca SQL) e `detectNotices`. Por
pergunta e agregado por tipo:

- **Acerto de NR** — algum dos `chunk_limit` (6) trechos do topo é da
  `source_code` esperada.
- **Acerto de item** — algum dos trechos do topo é da NR esperada **e**
  contém o `item` esperado. Hoje o chunking corta no meio de frase, então
  esta métrica deve sair baixa — é o número que justifica mexer no chunking
  depois.
- **Falso relevante** — das perguntas `recusar_sem_evidencia`, a proporção
  cuja melhor similaridade fica acima do limiar (chegaria ao LLM com trecho
  irrelevante).
- **Avisos** — precisão e recall de `detectNotices` contra
  `avisos_esperados`, por tipo de aviso.
- **`passou_A`** de uma pergunta: (sem `fontes_esperadas` **ou** acerto de
  item) **e** avisos detectados = avisos esperados **e** (se
  `recusar_sem_evidencia`) melhor similaridade abaixo do limiar.

### 5.3 Camada B — resposta real (só com `--llm`)

Chama `queryWithTrace` e portanto o provedor pago configurado.

- **Tetos:** `--max-llm-calls` (padrão 15), parada dura ao atingir o teto,
  e recusa de rodar as 60 sem `--allow-full`. Antes de começar, imprime a
  estimativa (~4,3 mil tokens por chamada, medida no log real) e, ao fim, a
  diferença de tokens em `minimax_usage_log` (que não é separável do uso
  real).
- **Regras por `comportamento_esperado`:**
  - `responder` — resposta não nula, algum trecho esperado (com o item)
    citado por uma claim sobrevivente (`kept_claims`), e nenhum
    `proibido_regex` casa a resposta;
  - `recusar_sem_evidencia` — resposta nula;
  - `pedir_contexto`, `alertar_jurisdicao`, `alertar_habilitacao` — avisos
    detectados contêm os `avisos_esperados`, e nenhum `proibido_regex` casa.
    O sistema **ainda não pergunta de volta**: para `pedir_contexto` o
    relatório marca essa lacuna à parte, sem reprovar por ela.
- **Alucinação, como proxy determinístico:** contagem de claims descartadas
  por item/NR inventado (`claims_dropped_support`), números sinalizados
  (`flagged_numbers`) e `proibido_regex`. Reportados, não são critério de
  aprovação por si.
- **Limite assumido:** não julga a semântica da prosa. Para isso o relatório
  gera um markdown lado a lado (pergunta, `resposta_esperada`, resposta
  obtida, citações) pensado para a revisão do profissional.

### 5.4 Baseline e gate

- O baseline (`backend/eval/baselines/<data>-<camada>.json`) guarda o
  resultado por pergunta, os agregados e metadados: commit, modelo,
  `threshold`, `chunk_limit`, hash do dataset.
- **Gate:** antes de mexer em chunking, busca, prompt, modelo ou limiar,
  roda-se a avaliação e compara-se com o baseline. Na **Camada A**
  (determinística) é regressão — código de saída 1 — se qualquer pergunta
  `validado` que passava em `passou_A` deixa de passar. Na **Camada B**, o
  LLM não é determinístico: regressões aparecem no relatório como atenção e
  só reprovam com `--fail-on-regression`. Rascunhos e agregados são só
  informativos.
- **Sem meta numérica agora.** O primeiro baseline, gerado **antes** de
  qualquer mudança de chunking/busca, é o que calibra as metas depois.

## 6. Custo e segurança

- **Camada A:** ~60 embeddings por rodada (`text-embedding-3-small`) —
  centavos.
- **Camada B:** só com `--llm` e teto de chamadas (§5.3); roda em amostra por
  padrão. O histórico do projeto tem um estouro de crédito por chamada de IA
  sem limite (Fase 8) — custo é restrição de design
  (`docs/assistente-montese-principios.md` §7).
- **Banco:** runner e `lint-golden` **só leem**; nenhum `INSERT` (o log só é
  gravado por `query()`). O runner não usa tenant, então nunca toca tabela
  com RLS de empresa.
- **Ambiente:** o runner é executado pelo wrapper que carrega o ambiente e
  nunca imprime variáveis nem chaves.
- **Dataset:** perguntas sintéticas sobre normas; sem dado de empresa nem PII.
- **LGPD do log:** metadados, 90 dias, sem texto, RLS só admin. **Pendência
  do fundador:** registrar o log de uso em `docs/compliance/lgpd-compliance.md`
  (arquivo com alterações não commitadas do fundador — esta etapa não o
  edita).
- **Migration:** aditiva; só aplicada com o ok explícito do fundador, com
  backup do dia confirmado (mesma barreira da `0050`).

## 7. Testes

**Unitários (`*.unit-spec.ts`, sem banco):**

- `golden-schema` — cada regra de §3.2 (comportamento × campos exigidos,
  `id` duplicado, enum inválido, `proibido_regex` que não compila,
  validado sem `validado_por`).
- `metrics` — funções puras: acerto de NR/item, falso relevante,
  precisão/recall de avisos, regras da Camada B, comparação de baselines e
  detecção de regressão, com fixtures.
- `usage-report` — agregação pura sobre linhas de exemplo.

**e2e (Postgres real, padrão existente):**

- `queryWithTrace` devolve um trace coerente e `query()` continua idêntico
  — os e2e atuais do Assistente são a prova.
- Uma pergunta grava **exatamente 1 linha** em `assistant_query_log` e
  **nenhuma coluna contém o texto** da pergunta.
- Falha na gravação do log não derruba a resposta.
- RLS: só admin lê a tabela.
- Purge: apaga a linha de fixture com `created_at` antigo e preserva a
  recente.
- Regra de privacidade dos tokens: claim que cita documento da empresa não
  grava `flagged_numbers`.

`eval:lint` e os runners são comandos do fluxo de validação, não suítes
jest.

## 8. Ordem de implementação e coordenação

1. **Dataset:** schema, ~60 perguntas em rascunho, `eval:lint`. Arquivos
   novos em `backend/eval/` — **podem andar antes** de a outra sessão
   terminar.
2. **`retrieve()`, `queryWithTrace` e `QueryTrace`.** Toca
   `normative-assistant.service.ts` — **só depois** que a integração do
   checklist SST estiver em `main`.
3. **Migration `assistant_query_log`**, gravação, purge e RLS. Também depois
   do passo 2, e com o ok explícito para aplicar a migration.
4. **Runner Camada A**, métricas e `--compare`; **primeiro baseline
   commitado, antes de mexer em chunking.**
5. **Runner Camada B** e baseline em amostra de 15.
6. **`usage-report`** e documentação.

As partes puras do passo 4 (`metrics`, comparação de baselines) também são
arquivos novos e podem começar junto do passo 1.

## 9. Riscos e limites assumidos

- **Lint de citação e PDF:** hifenização, cabeçalho/rodapé de página no meio
  de um trecho e itens que atravessam páginas podem gerar falso erro no lint.
  Corrige-se a evidência (citando um trecho contíguo), nunca o lint.
- **Rascunhos redigidos por um modelo** podem refletir conhecimento
  imperfeito. Mitigado pelo lint (a citação é real), pelo `status: rascunho`
  e pela validação profissional — mas a redação da `resposta_esperada` só
  fica confiável depois de validada.
- **Acerto de item depende do conteúdo do chunk:** o número do item só está
  no trecho se o corte cair depois do cabeçalho da seção. É um limite
  conhecido do chunking cego, e a métrica existe justamente para
  quantificá-lo.
- **Não determinismo da Camada B:** por isso o gate rígido é só da Camada A.
- **Hash da pergunta:** perguntas comuns são adivinháveis por dicionário; o
  hash serve para contagem, não para anonimizar.
- **Custo não separável:** o gasto da Camada B se soma ao do uso real em
  `minimax_usage_log`; o runner reporta a diferença, não isola.
- **Coordenação de arquivos:** o passo 2 depende de a outra sessão terminar;
  se ela atrasar, os passos 1 e 4 (parte pura) não ficam bloqueados.

## 10. Critérios de sucesso

1. As ~60 perguntas têm **100% das evidências confirmadas** pelo `eval:lint`.
2. Baselines das Camadas A e B (amostra) **commitados**.
3. O log grava **sem texto** e as regras de privacidade têm e2e.
4. Os e2e existentes do Assistente seguem intactos.
5. O gate devolve código 1 quando se simula uma regressão na Camada A.

## 11. Lacunas da auditoria que esta etapa fecha

| Lacuna | Situação depois das Etapas 2 e 3 |
|---|---|
| C3 — sem dataset nem teste de qualidade | Fechada: dataset golden + runner + baseline |
| M1 — observabilidade rasa | Fechada em nível de metadados; texto fica de fora por LGPD |
| A1 — chunking cego | **Quantificada** (acerto de item); correção é a etapa seguinte |
| A3 — sem busca lexical | **Quantificada** pela mesma métrica; correção é a etapa seguinte |
| C2 — números com unidade só registrados | Passa a ter dado para a decisão (`usage-report` e Camada B) |
