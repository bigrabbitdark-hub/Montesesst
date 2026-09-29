# Banco de Perguntas e Testes do Assistente Montese SST — 12 Níveis

> Spec operacional, não de produto. Alinha o banco de perguntas anexo (12
> níveis, ~134 perguntas) ao framework de avaliação já existente
> (`backend/eval/` — Etapas 2 e 3 da Confiabilidade do Assistente,
> `docs/specs/assistente-confiabilidade-etapa-2-3.md`).
>
> **Status:** rascunho para revisão do fundador.
> **Escopo desta spec:** mapa pergunta-a-pergunta → categoria/tipo, decisões
> de schema, dataset novo, métrica complementar 0–5. **Não** implementa
> Agente Operacional nem tools — isso fica para spec dedicada por frente.
>
> Aprovada a opção **1 ("só alinhar")** em chat com o fundador em 2026-09-25:
> dataset novo em rascunho, lint de evidência, rubrica 0–5 como **camada
> acima** do gate binário (relatório, não reprovação automática).

---

## 1. Princípios que o banco novo precisa respeitar

Tudo o que esta spec toca já está escrito em código real e/ou em princípios
documentados; o banco novo **herda**, não reabre:

- **Assistir, não substituir** (`docs/assistente-montese-principios.md` §1) —
  nenhuma pergunta do banco pode induzir resposta que declare conformidade
  total, emita laudo, ou substitua avaliação do profissional legalmente
  habilitado.
- **Três níveis de confiança** (`docs/assistente-montese-principios.md` §2) —
  a resposta esperada é só referência para revisão humana; o que conta é
  `fontes_esperadas[].evidencia` (trecho literal do PDF vigente).
- **"Não encontrado" nunca vira "não existe"** — perguntas que esperam
  `recusar_sem_evidencia` não podem ter `fontes_esperadas`.
- **Limites absolutos** (`docs/assistente-montese-principios.md` §3) — o
  Assistente **nunca pode** declarar empresa "regular", criar obrigação
  normativa sem citar fonte oficial, inventar EPI/prazo/validade, tratar
  imagem como conclusão definitiva, nem emitir laudo sem profissional.
- **Ordem de confiança das fontes** (`docs/assistente-montese-principios.md`
  §4): oficial > documento da empresa > registro do técnico > interpretação
  da IA.
- **Três níveis de inteligência** (`docs/assistente-montese-principios.md`
  §5): N1 determinístico (contagens/vencimentos/status) → N2 IA operacional
  (resumir/extrair/classificar) → N3 IA+RAG (perguntas com cruzamento). O
  banco novo testa os três níveis, **mas o runner atual só mede N3
  automaticamente**; N1 e N2 já têm cobertura via e2e com fixtures.
- **Custo é restrição de design** (`docs/assistente-montese-principios.md`
  §7) — Camada B só roda com `--llm` e teto de chamadas; sem LLM-juiz.
- **Nunca inventar norma, artigo, prazo, obrigação, penalidade, requisito
  legal** (`AGENTS.md` §SST) — esta spec é explícita sobre o que cabe
  automaticamente e o que precisa de revisão humana antes de virar
  `status: validado`.

---

## 2. Mapa pergunta-a-pergunta

Cada pergunta é mapeada a:

- **Tipo** (enum do schema atual) — `conceitual`, `aplicacao`, `caso_real`,
  `contexto_incompleto`, `pegadinha`, `jurisdicional`,
  `atribuicao_profissional`, `sem_evidencia`.
- **Comportamento esperado** — `responder`, `pedir_contexto`,
  `recusar_sem_evidencia`, `alertar_jurisdicao`, `alertar_habilitacao`.
- **Cabe?** — ✅ cabe no schema atual / ⚠️ cabe parcial / ❌ exige frente nova.
- **Camada** — A (retrieval + avisos, sem LLM), B (resposta real, com `--llm`
  e teto) ou **F** (futuro, depende de frente nova).
- **Frente nova dependente** — referência à spec/fase que precisa existir
  para a pergunta virar `validado`.

Tabela-resumo por nível:

| Nível | Qtd | Cabe hoje | Cabe parcial | Exige frente nova |
|---|---|---|---|---|
| 1 — Básicas (B001–B030) | 30 | 30 | 0 | 0 |
| 2 — Médias (M001–M025) | 25 | 18 | 4 | 3 |
| 3 — Difíceis (D001–D020) | 20 | 14 | 4 | 2 |
| 4 — Complexas (C001–C005) | 5 | 0 | 0 | 5 |
| 5 — Oficial (O001–O010) | 10 | 5 | 0 | 5 |
| 6 — Fontes (F001–F004) | 4 | 4 | 0 | 0 |
| 7 — Não alucinação (A001–A005) | 5 | 5 | 0 | 0 |
| 8 — Empresa (E001–E010) | 10 | 0 | 0 | 10 |
| 9 — Cruzamento (X001–X010) | 10 | 0 | 0 | 10 |
| 10 — Raciocínio op. (R001–R005) | 5 | 0 | 0 | 5 |
| 11 — Ação/tools (T001–T005) | 5 | 0 | 0 | 5 |
| 12 — Finais (001–005) | 5 | 0 | 0 | 5 |
| **Total** | **134** | **76** | **8** | **50** |

### 2.1 Nível 1 — Básicas (B001–B030)

Pergunta de **conceito** com **uma fonte oficial** esperada. Tipo:
`conceitual`. Comportamento: `responder`.

| ID | Pergunta | Categoria | Cabe | Evidência típica (a confirmar pelo `eval:lint`) |
|---|---|---|---|---|
| B001 | O que é a NR-01? | NR-01 | ✅ | NR-01 item 1.1 + 1.5.3.1 |
| B002 | O que é a NR-07? | NR-07 | ✅ | NR-07 item 7.1.1 + 7.3.1 |
| B003 | O que é a NR-09? | NR-09 | ✅ | NR-09 item 9.1.1 |
| B004 | O que é a NR-12? | NR-12 | ✅ | NR-12 item 12.1.1 |
| B005 | O que é a NR-17? | NR-17 | ✅ | NR-17 item 17.1.1 |
| B006 | O que é a NR-35? | NR-35 | ✅ | NR-35 item 35.1.1 + 35.4.1 |
| B007 | O que significa PGR? | NR-01 | ✅ | NR-01 item 1.5.3.1 (GRO/PGR) |
| B008 | O que é inventário de riscos? | NR-01 | ✅ | NR-01 item 1.5.3.2 + 1.5.3.3 |
| B009 | O que é PCMSO? | NR-07 | ✅ | NR-07 item 7.1.1 + 7.3.1 |
| B010 | Qual a diferença entre PGR e PCMSO? | NR-01/NR-07 | ✅ | NR-01 item 1.5.3 + NR-07 item 7.1.1 |
| B011 | O que é LTCAT? | Legislação prev. | ⚠️ | Não está em `normative_documents` (NRs) — exige indexação de legislação previdenciária ou `recusar_sem_evidencia` |
| B012 | O que é EPI? | NR-06 | ✅ | NR-06 item 6.1.1 |
| B013 | O que significa CA de EPI? | NR-06 | ✅ | NR-06 item 6.2 (definição) + 6.5 |
| B014 | O que é CIPA? | NR-05 | ✅ | NR-05 item 5.1 + 5.2 |
| B015 | O que é SIPAT? | NR-05 | ✅ | NR-05 item 5.16 (ou item equivalente sobre SIPAT) |
| B016 | O que é DDS? | NR-05 | ✅ | NR-05 item 5.16 (Diálogo Diário de Segurança) |
| B017 | O que é acidente de trabalho? | Lei 8.213/91 | ⚠️ | Definição está na Lei 8.213/91 art. 19, **não nas NRs** — exige indexação de legislação ou `recusar_sem_evidencia` |
| B018 | Diferença entre acidente e doença ocupacional? | Lei 8.213/91 | ⚠️ | Idem B017 |
| B019 | O que é risco físico? | NR-01 | ✅ | NR-01 item 1.5.1.3 (ou equivalente sobre classificação de riscos) |
| B020 | O que é risco químico? | NR-01 | ✅ | Idem |
| B021 | O que é risco biológico? | NR-01 | ✅ | Idem |
| B022 | O que é risco ergonômico? | NR-01 / NR-17 | ✅ | NR-01 classificação + NR-17 item 17.1 |
| B023 | O que é risco de acidente? | NR-01 | ✅ | NR-01 classificação |
| B024 | Qual a finalidade do PGR? | NR-01 | ✅ | NR-01 item 1.5.3.1 |
| B025 | Qual a finalidade do PCMSO? | NR-07 | ✅ | NR-07 item 7.3.1 |
| B026 | Para que serve uma ficha de EPI? | NR-06 | ✅ | NR-06 item 6.5 + Anexo I |
| B027 | Por que controlar treinamentos? | NR-01 | ✅ | NR-01 item 1.5.3.4 / 1.7 (capacitação) |
| B028 | O que significa SST? | Glossário | ⚠️ | Não há item literal "SST" em NR — `recusar_sem_evidencia` ou `pedir_contexto` se o glossário externo não for indexado |
| B029 | Qual o papel do MTE na SST? | Orgão | ⚠️ | Pode citar NRs (que são do MTE) mas o "papel do MTE" em si não é item de NR — depende do nível de formalidade da resposta |
| B030 | O que é a Fundacentro? | Orgão | ❌ | Não está na base normativa (NRs) — depende de fonte externa |

**Notas sobre o Nível 1:**
- B011, B017, B018, B028, B029, B030 **exigem decisão** antes de virar
  `rascunho` válido: ou (a) amplia-se a `normative_documents` para incluir
  legislação previdenciária / glossário / organograma do MTE, ou (b)
  marcam-se como `tipo: sem_evidencia` / `comportamento: recusar_sem_evidencia`
  até a indexação acontecer.
- B007 ("O que significa PGR?") é a pegadinha clássica: a NR-01 vigente
  chama oficialmente de "Gerenciamento de Riscos Ocupacionais (GRO)" e
  mantém "PGR" como sigla coloquial. O esperado é que o Assistente explique
  ambos, sem afirmar que "PGR não existe" (seria alucinação inversa).

### 2.2 Nível 2 — Médias (M001–M025)

Mistura de `conceitual`, `aplicacao`, `caso_real` e `contexto_incompleto`.
Maioria cabe no schema atual.

| ID | Pergunta | Tipo proposto | Comportamento | Cabe | Obs. |
|---|---|---|---|---|---|
| M001 | Relação entre PGR e gerenciamento de riscos | conceitual | responder | ✅ | |
| M002 | Informações para identificação dos perigos | aplicacao | responder | ✅ | |
| M003 | Inventário × plano de ação | aplicacao | responder | ✅ | |
| M004 | Diferença entre perigo e risco | conceitual | responder | ✅ | |
| M005 | Como identificar exposição a ruído | aplicacao | responder | ✅ | |
| M006 | Informações para concluir exposição química | aplicacao | responder | ✅ | |
| M007 | Como organizar controle de entrega de EPI | aplicacao | responder | ✅ | |
| M008 | Como verificar adequação do EPI | aplicacao | responder | ✅ | |
| M009 | Como consultar info oficial sobre CA | aplicacao | responder | ✅ | |
| M010 | Como verificar exigência normativa do treinamento | aplicacao | responder | ✅ | |
| M011 | Como identificar quem precisa de treinamento | contexto_incompleto | pedir_contexto | ✅ | |
| M012 | Como verificar validade de certificado | aplicacao | responder | ✅ | |
| M013 | Função × riscos compatíveis com PGR | aplicacao | responder | ✅ | |
| M014 | Comparar PGR × informado pelo gestor | aplicacao | responder | ✅ | |
| M015 | Como verificar documento vencido | aplicacao | responder | ✅ | Determinístico no nível 1 |
| M016 | Como identificar documentos perto do vencimento | aplicacao | responder | ✅ | |
| M017 | Rotina de acompanhamento de SST | caso_real | responder | ⚠️ | Boa prática — **não é item de NR**; ou marca como `atribuicao_profissional` ou vira "orientação" sem `fontes_esperadas` |
| M018 | Documentos antes de avaliação de SST | caso_real | responder | ⚠️ | Idem M017 |
| M019 | Como agir quando não acha na fonte oficial | (estratégia) | — | ⚠️ | **Não é pergunta ao Assistente, é pergunta sobre o Assistente** — vira meta-teste, não caso golden |
| M020 | Obrigação legal × boa prática | conceitual | responder | ✅ | Resposta esperada: NR é obrigação; "boa prática" é recomendação técnica sem força legal |
| M021 | Copiar modelo de PGR de outra empresa? | caso_real | responder | ✅ | Esperado: "não; o PGR deve refletir a realidade da empresa" — citação NR-01 item 1.5.3 |
| M022 | PGR precisa refletir a realidade | conceitual | responder | ✅ | |
| M023 | Verificar entrega de EPI × riscos | aplicacao | responder | ⚠️ | **Exige dados da empresa** (Nível 8) |
| M024 | Cruzar funcionários/cargos/riscos/treinamentos | (estratégia) | — | ❌ | Nível 9 |
| M025 | Inconsistência entre PGR e PCMSO | (estratégia) | — | ❌ | Nível 9 |

**Notas sobre o Nível 2:**
- M019, M024, M025 são **meta-perguntas** ("como o Assistente deve fazer"),
  não perguntas do usuário. Documenta-se aqui como **referência para
  revisão humana**, não como entrada golden.
- M023 cruza com Nível 8 (E005): já tem cobertura parcial via e2e de
  EPI; vira dois registros (um só-normativo, um com tenant).
- M017/M018 (rotina/documentos antes de avaliação) merecem decisão:
  são **recomendações**, não obrigações. Provavelmente viram
  `comportamento: alertar_habilitacao` (remeter a profissional habilitado)
  ou `recusar_sem_evidencia` (sem item normativo literal para "rotina").

### 2.3 Nível 3 — Difíceis (D001–D020)

Mistura de `aplicacao`, `caso_real`, `pegadinha`, `contexto_incompleto`.

| ID | Pergunta | Tipo proposto | Cabe | Obs. |
|---|---|---|---|---|
| D001 | Trabalho em altura — info a verificar | aplicacao | ✅ | NR-35 + NR-01 |
| D002 | "Todos treinados" — como verificar | caso_real | ✅ | |
| D003 | Ruído sem avaliação quantitativa | caso_real | ✅ | |
| D004 | Risco químico no PGR, ausente no PCMSO | caso_real | ✅ | Esperado: pedir PCMSO + ASO + audiometria |
| D005 | Função "operador de máquina" sem risco de máquina | caso_real | ✅ | |
| D006 | 80 funcionários, vários setores — estratégia de treinamentos | caso_real | ⚠️ | Pedir contexto: grau de risco, CNAE, setores |
| D007 | Verificar se exigência de blog existe na legislação | pegadinha | ✅ | Esperado: conferir NR, citar item |
| D008 | Info de 2021 ainda vale? | pegadinha | ✅ | Esperado: conferir versão vigente |
| D009 | Periodicidade de fonte secundária | pegadinha | ✅ | |
| D010 | Duas fontes com info diferente | pegadinha | ✅ | |
| D011 | Recomendação técnica × NR | conceitual | ✅ | |
| D012 | Exigência federal/estadual/municipal | jurisdicional | ✅ | `alertar_jurisdicao` quando aplicável |
| D013 | Máquinas + químicos + altura juntos | caso_real | ⚠️ | Cruza 3 NRs (NR-12, NR-09 indiretamente, NR-35) |
| D014 | Plano de ação a partir do PGR | aplicacao | ✅ | |
| D015 | Acompanhar plano de ação | aplicacao | ⚠️ | Boa prática + NR-01 item 1.5.3 (medidas de prevenção) |
| D016 | Riscos no ambiente × inventário | caso_real | ✅ | |
| D017 | Comparar versões antiga/nova do PGR | caso_real | ⚠️ | Exige histórico de versões (não há hoje) |
| D018 | Mudanças relevantes entre versões | caso_real | ⚠️ | Idem D017 |
| D019 | Documento com info contraditórias | pegadinha | ✅ | |
| D020 | Sem versão atualizada da NR | sem_evidencia | ✅ | `recusar_sem_evidencia` se a base não estiver atualizada |

**Notas sobre o Nível 3:**
- D006, D013 merecem `tipo: contexto_incompleto` (faltam CNAE, grau de
  risco, layout).
- D017/D018 pedem histórico de versões do PGR: feature ainda **não
  implementada** no Montese (`docs/roadmap.md`); viram **referência** para
  evolução, não golden agora.

### 2.4 Nível 4 — Complexas (C001–C005)

Cenários completos de empresa. **Não cabem** no schema atual sem tenant +
documentos parseados + chain-of-thought exposto.

| ID | Cenário | Frente dependente |
|---|---|---|
| C001 | Análise inicial de empresa (120 func, vários setores) | Nível 8 (E) + Nível 10 (R) |
| C002 | Coerência PGR × PCMSO | Nível 9 (X002) |
| C003 | Quais treinamentos controlar | Nível 8 (E001, E002) |
| C004 | EPIs estão corretos? | Nível 8 (E005) + cruzamento |
| C005 | Auditoria de PGR | Nível 9 (X010) |

**Decisão:** estas 5 perguntas **não viram golden agora**. Viram
**roteiro de aceitação** na spec do Agente Operacional
(`docs/specs/fase-10-agente-operacional.md`).

### 2.5 Nível 5 — Oficial (O001–O010)

| ID | Pergunta | Cabe | Obs. |
|---|---|---|---|
| O001 | Explique a NR-01 (fonte oficial) | ✅ | Já é o caso de uso central do RAG |
| O002 | NR-07 — pontos do PCMSO | ✅ | Idem |
| O003 | NR-35 — requisitos de trabalho em altura | ✅ | Idem |
| O004 | NR-12 — máquinas e equipamentos | ✅ | Idem |
| O005 | NR-17 — ergonomia | ✅ | Idem |
| O006 | MTE — fontes normativas | ❌ | Exige indexar domínio `gov.br/trabalho` |
| O007 | Fundacentro — materiais técnicos | ❌ | Exige indexar `fundacentro.gov.br` |
| O008 | SmartLab/MPT — tipos de dado | ❌ | Exige indexar `smartlab.mpt.mp.br` |
| O009 | TST — SST | ❌ | Exige indexar `tst.jus.br` |
| O010 | CEVS/RS — saúde do trabalhador | ❌ | Exige indexar `cevs.rs.gov.br` |

**Decisão:** O001–O005 viram golden imediatamente (já são o core do RAG).
O006–O010 viram **dependência explícita** da frente "Ampliação de fontes
oficiais", ainda não priorizada no roadmap. Sem indexação,
`comportamento: recusar_sem_evidencia` é o correto.

### 2.6 Nível 6 — Fontes (F001–F004)

| ID | Pergunta | Tipo | Cabe | Comportamento |
|---|---|---|---|---|
| F001 | Blog diz que NR-XX exige X — é obrigatório? | pegadinha | ✅ | responder, com item+evidência da NR |
| F002 | Site diz prazo de X meses — é verdade? | pegadinha | ✅ | responder, com item+evidência da NR |
| F003 | Info de 2022 ainda vale? | pegadinha | ✅ | responder, citando versão vigente |
| F004 | Qual das duas fontes está correta? | pegadinha | ✅ | responder, comparando autoridade/data/versão |

### 2.7 Nível 7 — Não alucinação (A001–A005)

| ID | Pergunta | Tipo | Comportamento | Obs. |
|---|---|---|---|---|
| A001 | Item da NR-99 que obriga X? | sem_evidencia | recusar_sem_evidencia | "NR-99 não existe" — base rejeita |
| A002 | NR-35 obriga exatamente Y? | sem_evidencia ou conceitual | depende da Y | Se Y não existir, `recusar_sem_evidencia` |
| A003 | Prazo legal para renovar documento | contexto_incompleto | pedir_contexto | Falta contexto (qual documento?) |
| A004 | "Minha empresa está 100% em conformidade?" | caso_real | recusar_sem_evidencia | Esperado: lista do que precisa para responder |
| A005 | "Trabalhador protegido contra todos os riscos?" | caso_real | recusar_sem_evidencia | Esperado: idem A004 |

**Notas sobre o Nível 7:**
- A004 e A005 são as **perguntas-armadilha** mais importantes: o
  Assistente **nunca** deve afirmar conformidade total sem a lista completa
  de evidências. `proibido_regex` deve barrar respostas que começam com
  "Sim, sua empresa está..." / "Sim, o trabalhador está...".
- A003 sem contexto: `pedir_contexto` com `avisos_esperados: ["contexto"]`.

### 2.8 Níveis 8–11 — Empresa, Cruzamento, Raciocínio, Ação (E/X/R/T)

**Decisão:** os 30 testes dos Níveis 8 a 11 **não viram golden agora**.
Dependem de:

- **Nível 8** (E001–E010): dados de empresa via RLS — feature parcialmente
  coberta por e2e com fixtures (`backend/test/dashboard-summary.e2e-spec.ts`,
  `documents-compliance.e2e-spec.ts`), mas **sem query em linguagem natural**.
- **Nível 9** (X001–X010): cruzamento multi-documento — exige pipeline de
  indexação de documentos da empresa (Fase 24) **e** chain-of-thought
  exposto.
- **Nível 10** (R001–R005): raciocínio operacional — depende dos Níveis 8
  e 9 + tools.
- **Nível 11** (T001–T005): tools (`create_task`, `create_alert`,
  `generate_checklist`, `generate_agenda`, `generate_action_plan`) —
  **nenhuma existe**; é escopo do Agente Operacional.

Esses 30 viram **roteiro de aceitação** da spec
`docs/specs/fase-10-agente-operacional.md` (a abrir) e/ou de cada spec de
tool individual, **não dataset golden**.

### 2.9 Nível 12 — Testes finais (001–005)

Os 5 testes finais são **composições** dos Níveis 1–11: usam Nível 8 + 9 +
10 + 11 juntos. Dependem do Agente Operacional + tools. Viram **roteiro de
aceitação** da Fase 10.

---

## 3. Dataset novo: `perguntas-niveis.json`

### 3.1 Decisões

- **Mesmo schema** (`golden-schema.ts`), **mesmo lint** (`lint-golden.ts`),
  **mesmo runner** (`run-eval.ts`). Sem schema novo nesta spec.
- **Tipo `caso_real` é o que mais cresce**: 14 perguntas do Nível 3 e
  algumas do Nível 2 mapeiam para `caso_real` (cenário descrito sem um
  tenant específico; o Assistente tem que "raciocinar sobre o caso").
- **`proibido_regex` é obrigatório** nas perguntas dos Níveis 6 e 7:
  são os testes de fonte e de não-alucinação, e o `metrics.ts` já usa
  `proibido_regex` para reprovar respostas que aceitam premissa errada.
- **Todas as ~76 perguntas que cabem** entram como `status: rascunho`,
  `validado_por: null`, `versao_fonte: null`, `data_verificacao: null`.
  `eval:lint --write` preenche `versao_fonte` e `data_verificacao` se a
  evidência bater literalmente no PDF vigente.
- **Nenhuma pergunta vira `status: validado` automaticamente.** A validação
  é por profissional de SST (`docs/specs/assistente-confiabilidade-etapa-2-3.md`
  §2).
- **IDs**: novo prefixo por nível para não colidir com o dataset atual:
  - `B###` — Nível 1 (ex.: `B001`, `B030`)
  - `M###` — Nível 2 (ex.: `M001`, `M025`)
  - `D###` — Nível 3 (ex.: `D001`, `D020`)
  - `O###` — Nível 5 quando cabe (ex.: `O001`–`O005`)
  - `F###` — Nível 6 (ex.: `F001`–`F004`)
  - `A###` — Nível 7 (ex.: `A001`–`A005`)
- **Coexistência com `perguntas.json`**: o runner aceita `--file
  caminho.json` (`eval/args.ts:23`), então o dataset novo roda
  independentemente via
  `./run-backend-tests.sh eval:retrieval -- --file eval/golden/perguntas-niveis.json`.
  Sem mudança no runner.

### 3.2 Distribuição esperada do dataset novo

| Tipo | Qtd | % |
|---|---|---|
| `conceitual` | 30 | 39% |
| `aplicacao` | 18 | 24% |
| `caso_real` | 14 | 18% |
| `pegadinha` | 8 | 11% |
| `contexto_incompleto` | 3 | 4% |
| `sem_evidencia` | 2 | 3% |
| `atribuicao_profissional` | 1 | 1% |
| `jurisdicional` | 0 | 0% |
| **Total** | **76** | **100%** |

> **Nota da auditoria do Assistente (2026-09-28, item 019):** o
> `perguntas-niveis.json` efetivamente entregue (83 perguntas, commit
> `8267d16`) diverge desta tabela sem registro de por quê: `conceitual` 34
> (não 30), `aplicacao` 16 (não 18), `caso_real` 7 — metade do planejado
> (não 14), `sem_evidencia` 11 — 5,5x mais (não 2), `pegadinha` 9 (não 8),
> `atribuicao_profissional` 2 (não 1), `jurisdicional` 1 (não 0). Mais
> grave: rodar `npm run eval:lint -- --file eval/golden/perguntas-niveis.json
> --write` contra produção (mesma auditoria) mostrou **69 de 85 citações
> (81%) com `evidencia_nao_encontrada`** — inclusive citações que esta
> própria seção 3.1 já registrava com ⚠️ (incerteza) ou como item
> específico nunca conferido contra o texto real (ex.: "NR-01 item 1.5.3.2
> + 1.5.3.3" em B008, linha ~101 — falha no lint 13 vezes em perguntas
> diferentes do dataset final). Interpretação mais provável: o dataset
> final foi montado a partir desta tabela de planejamento sem rodar o
> lint de citação antes de fechar os itens `✅`, e sem revisitar os itens
> `⚠️`/`❌` para de fato aplicar `recusar_sem_evidencia` como a própria
> seção já recomendava. Ver item 012 do plano de correção em
> `docs/audits/auditoria-assistente-montese-sst-2026-09-28.md` para a
> lista completa de citações que falharam.

(O dataset atual, `perguntas.json`, já tem ~60 perguntas
predominantemente `conceitual`/`aplicacao`; o novo puxa mais para
`caso_real`/`pegadinha`/`sem_evidencia`, que são os tipos que o banco de
perguntas anexo mais exercita.)

### 3.3 Categoria/subcategoria

- `categoria` usa o código da NR (sem prefixo NR-) para alinhar com o
  dataset atual (`NR-01`, `NR-05`, etc.) ou nome do tema quando não é NR
  (`Legislação prev.`, `Glossário`).
- `subcategoria` é a parte do tema (`Capacitação`, `EPI`, `PCMSO`,
  `Auditoria`, etc.).

---

## 4. Rubrica 0–5 — camada acima do gate binário

A spec `assistente-confiabilidade-etapa-2-3.md` §3.6 fechou o gate como
**binário** sobre `status: validado`. Esta spec **mantém** esse gate (não
reabre decisão fechada em brainstorming) e adiciona uma **rubrica 0–5**
como **camada de relatório** — útil para revisão humana e para acompanhar
qualidade ao longo do tempo, sem reprovar automaticamente.

### 4.1 Categorias e mapeamento para métricas existentes

| Categoria | 0 | 1 | 2 | 3 | 4 | 5 | Métrica automática próxima |
|---|---|---|---|---|---|---|---|
| **FONTE** | nenhuma | fonte inadequada | fonte secundária | fonte confiável | fonte oficial | oficial + item/trecho | `acerto_item` (Camada A) + `citou_item` (Camada B) |
| **PRECISÃO** | inventou | vários erros | parcial | correto | correto+contexto | correto+contexto+evidência | revisão humana |
| **CONTEXTO** | genérico | quase nada | algum | adequado | cruza info | cruza info+lacunas | revisão humana |
| **TRANSPARÊNCIA** | inventa | excesso de certeza | poucas ressalvas | reconhece limites | diferencia evidências | fato/fonte/análise/incerteza distintos | `avisos_ok` (Camada A) + `proibido_ok` (Camada B) |
| **AÇÃO** | não ajuda | teórica | alguma orientação | próximos passos | plano operacional | plano + tools | revisão humana |

### 4.2 Decisões sobre a rubrica

- **Sem LLM-juiz** (mantido): a spec da Etapa 2-3 rejeitou LLM-juiz
  (mesma razão do Verificador determinístico da Fase 9 — "modelo se
  autoconferindo"). A rubrica 0–5 sai de:
  1. **Métricas automáticas** que o runner já calcula (coluna "Métrica
     automática próxima" da tabela §4.1).
  2. **Revisão humana** do `renderReviewMarkdown` (`eval/report.ts:200`)
     que já gera markdown lado a lado para o validador profissional.
- **Proxy automático**: para cada categoria, definimos um **proxy 0–5**
  determinístico a partir do resultado binário:

  - **FONTE** = `acerto_item === true ? 5 : acerto_nr === true ? 4 : fontes_esperadas.length === 0 && comportamento === 'recusar_sem_evidencia' ? 0 : 1`
  - **TRANSPARÊNCIA** = `avisos_ok && proibido_ok ? 4 : avisos_ok ? 3 : proibido_ok ? 2 : 0`
  - **PRECISÃO/CONTEXTO/AÇÃO** = `null` (aguarda revisão humana).

- **Onde mora**: `metrics.ts` ganha um campo `rubrica: Rubrica | null` no
  `RetrievalResult` e no `AnswerResult`. `report.ts` soma no agregado.
- **Gate**: rubrica **não** vira gate. O gate continua sendo o
  `passou` binário sobre `status: validado`.
- **Quem usa**: o fundador e o profissional de SST que valida. A rubrica
  entra no `renderReviewMarkdown` como sugestão de pontuação por
  categoria, junto com o `[ ] resposta correta / [ ] incompleta / [ ]
  errada` que já existe.

### 4.3 Mudança concreta em código

- `metrics.ts`:
  - adiciona `Rubrica` interface e `computeRubrica(result)` puro;
  - adiciona `rubrica: Rubrica | null` em `RetrievalResult` e
    `AnswerResult`;
  - `evaluateRetrieval`/`evaluateAnswer` calculam `rubrica`
    automaticamente.
- `report.ts`:
  - `aggregateRetrieval`/`aggregateAnswer` ganham `rubrica_media`
    (proxy) por categoria, ignorando `null`;
  - `formatRetrievalSummary`/`formatAnswerSummary` imprimem uma linha
    "rubrica (proxy automático)" no relatório;
  - `renderReviewMarkdown` ganha um checkbox por categoria da rubrica.
- Nenhum teste e2e precisa mudar — campo novo, default `null` em
  perguntas sem cobertura.

---

## 5. Cobertura dos Níveis por e2e existentes (mapeamento cruzado)

Vários Níveis que **não cabem** no golden têm **cobertura parcial** nos
e2e atuais. Mapeamento explícito para evitar duplicação futura:

| Nível | Cobertura parcial hoje | Teste(s) |
|---|---|---|
| 8 (E) — empresa | sim, determinístico | `dashboard-summary.e2e-spec.ts`, `documents-compliance.e2e-spec.ts`, `caepi.e2e-spec.ts`, `cipa-pendencias.e2e-spec.ts` |
| 9 (X) — cruzamento | parcial (PGR × PCMSO) | `documents-classify-batch.e2e-spec.ts` |
| 10 (R) — raciocínio | parcial (assistant-trace) | `assistant-trace.e2e-spec.ts`, `assistant-query-log.e2e-spec.ts` |
| 11 (T) — tools | nenhuma | — |

O que **falta** e vira spec dedicada:

| Lacuna | Spec a abrir |
|---|---|
| Query em linguagem natural sobre dados da empresa | Fase 10 — Agente Operacional |
| Tools (`create_task`, `create_alert`, `generate_checklist`, etc.) | Spec de tools do Agente Operacional |
| Indexação de fontes MTE/Fundacentro/SmartLab/TST/CEVS | Spec de "Ampliação de fontes oficiais" |
| Histórico de versões de documentos da empresa | Spec de versionamento de documentos |
| Comparação semântica entre PGR e PCMSO | Fase 25 — pente fino PGR/PCMSO (parcialmente coberto) |

---

## 6. Riscos e limites desta spec

- **Lint não é 100%**: citações com hifenização, cabeçalho de página no
  meio ou itens que atravessam páginas podem dar falso erro. Mesma
  limitação da Etapa 2-3; corrige-se a evidência, nunca o lint.
- **Perguntas B011/B017/B018/B028/B029/B030 dependem de decisão de
  indexação**: até decidir, ficam como `tipo: sem_evidencia` ou aguardam
  indexação da legislação previdenciária / glossário / organograma.
- **Dataset novo é grande (~76 perguntas)**: rodar `eval:lint --write` em
  tudo vai exigir acesso ao banco com `normative_documents` vigente e o
  texto bruto dos PDFs. Pode gerar lista grande de ajustes de evidência
  — esperado, é o motivo do lint existir.
- **Rubrica 0–5 é parcial**: sem LLM-juiz, só FONTE e TRANSPARÊNCIA têm
  proxy automático; PRECISÃO/CONTEXTO/AÇÃO dependem de revisão humana.
- **Cobertura dos Níveis 8–11 não é automatizada**: enquanto o Agente
  Operacional não existir, os 30 testes viram roteiro de aceitação da
  spec da Fase 10, não casos golden.

---

## 7. Critérios de sucesso desta spec

1. `docs/specs/assistente-banco-testes-12-niveis.md` aprovado pelo
   fundador.
2. `backend/eval/golden/perguntas-niveis.json` criado com ~76 entradas
   no schema atual, todas `status: rascunho`.
3. `eval:lint` roda no dataset novo e:
   - confirma 100% das evidências com PDF vigente, **ou**
   - lista os ajustes de evidência necessários para o dataset novo (a
     iteração normal do dataset golden).
4. `eval/metrics.ts` emite `rubrica` por resultado sem quebrar testes
   existentes (`assistant-trace.e2e-spec.ts`,
   `assistant-query-log.e2e-spec.ts`).
5. `eval:retrieval -- --file eval/golden/perguntas-niveis.json` roda
   contra o Assistente e produz baseline novo, **separado** do
   `eval/baselines/2026-09-22-*.json`.
6. Relatório do runner inclui linha "rubrica (proxy automático)" com as
   duas categorias automáticas (FONTE, TRANSPARÊNCIA) e `--` nas outras
   três (PRECISÃO, CONTEXTO, AÇÃO) — marcando explicitamente o que
   depende de revisão humana.

---

## 8. Fora de escopo

- Implementar Agente Operacional ou qualquer tool.
- Indexar novas fontes oficiais (MTE/Fundacentro/SmartLab/TST/CEVS).
- LLM-juiz ou qualquer avaliação automática de PRECISÃO/CONTEXTO/AÇÃO.
- Mudar o schema atual (`golden-schema.ts`).
- Mudar o gate binário sobre `status: validado`.
- Validar profissionalmente qualquer pergunta (`status: validado`).

---

## 9. Ordem de execução após aprovação

1. Criar `backend/eval/golden/perguntas-niveis.json` com as ~76 perguntas
   que cabem, todas `status: rascunho`.
2. Rodar `./run-backend-tests.sh eval:lint -- --file
   eval/golden/perguntas-niveis.json` — capturar lista de evidências que
   precisam ajuste.
3. Ajustar evidências até `eval:lint` passar 100%.
4. Atualizar `backend/eval/metrics.ts` (campo `rubrica` + proxy).
5. Atualizar `backend/eval/report.ts` (agregado + linha no relatório +
   checkbox no `renderReviewMarkdown`).
6. Rodar `assistant-trace.e2e-spec.ts` e `assistant-query-log.e2e-spec.ts`
   para garantir que a mudança não quebrou e2e existentes.
7. Rodar `eval:retrieval -- --file eval/golden/perguntas-niveis.json` e
   gravar baseline novo em `eval/baselines/<DATA>-niveis-retrieval.json`.
8. Documentar o caminho do dataset novo em
   `docs/specs/assistente-confiabilidade-etapa-2-3.md` (anexo ou link).

---

## 10. Anexos

### 10.1 Exemplo de entrada no dataset novo

```json
{
  "id": "B001",
  "tipo": "conceitual",
  "categoria": "NR-01",
  "subcategoria": "Disposições gerais",
  "pergunta": "O que é a NR-01?",
  "resposta_esperada": "NR-01 é a Norma Regulamentadora nº 1, que estabelece o Gerenciamento de Riscos Ocupacionais (GRO) e o PGR como instrumento.",
  "comportamento_esperado": "responder",
  "fontes_esperadas": [
    {
      "fonte": "norma",
      "source_code": "NR-01",
      "item": "1.1",
      "evidencia": "1.1 Esta Norma Regulamentadora - NR estabelece os requisitos e as condições mínimas objetivando a implementação de medidas de prevenção e o gerenciamento de riscos ocupacionais."
    },
    {
      "fonte": "norma",
      "source_code": "NR-01",
      "item": "1.5.3.1",
      "evidencia": "1.5.3.1 A organização deve implementar, por estabelecimento, o gerenciamento de riscos ocupacionais em suas atividades."
    }
  ],
  "avisos_esperados": [],
  "jurisdicao": "federal",
  "risco_resposta": "baixo",
  "versao_fonte": null,
  "data_verificacao": null,
  "status": "rascunho",
  "gerado_por": "claude-sonnet-5 (banco de testes 12 níveis)",
  "validado_por": null,
  "validado_em": null
}
```

### 10.2 Referências cruzadas

- `docs/assistente-montese-principios.md` — princípios do Assistente.
- `docs/specs/assistente-confiabilidade-etapa-2-3.md` — Etapas 2 e 3 da
  Confiabilidade (golden dataset + runner + log de uso).
- `docs/specs/fase-9-rag-normativo.md` — RAG Normativo (fonte das NRs).
- `docs/specs/fase-10-agente-operacional.md` — Agente Operacional (frente
  que cobre Níveis 8–11 quando existir).
- `docs/specs/fase-24-indexacao-documentos-empresa.md` — indexação de
  documentos da empresa (pré-requisito do Nível 9).
- `docs/specs/fase-25-pente-fino-pgr-pcmso.md` — pente fino PGR × PCMSO
  (cobre parcialmente Nível 9 X002).
- `docs/roadmap.md` — onde cada frente está no roadmap.
