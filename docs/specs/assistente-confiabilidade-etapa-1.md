# Confiabilidade do Assistente — Etapa 1 (correções críticas)

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-20.
> Primeira das três etapas que saíram da auditoria dos agentes Montese SST
> feita na mesma data (baseada nos documentos `PROMPT_AUDITORIA_AGENTES_MONTESE_SST`
> e `MONTESE_SST_FONTE_DE_CONHECIMENTO_ARQUITETURA`). Para não colidir com
> as Fases 9–28 do produto, o trabalho é chamado de **Etapa 1, 2 e 3 da
> Confiabilidade do Assistente**:
>
> - **Etapa 1 (esta spec)** — correções de baixo risco no Assistente RAG
>   existente e no monitor normativo.
> - **Etapa 2+3 (spec própria, depois)** — banco de perguntas golden,
>   runner de avaliação e log de observabilidade. Ordem acordada:
>   dataset e testes **antes** de qualquer mudança de chunking/busca.
>
> A auditoria confirmou que o pipeline existente (`backend/src/normative/`)
> é sólido — fonte oficial, aprovação humana, versionamento, verificador de
> ids, anti-injeção — e que os buracos estão na camada de evidência.
> **Esta etapa não cria arquitetura paralela**: estende `NormativeAssistantService`,
> `NormativeMonitorService` e `official_sources`. Não toca em chunking,
> embeddings, busca, prompts dos outros agentes nem no catálogo SST.

## 1. Objetivo e escopo

Fechar, sem migrar dados de conhecimento nem mudar a busca, quatro lacunas
da auditoria:

1. **Fallback único e sem regra de jurisdição/atribuição profissional** —
   o Assistente responde só com normas federais, mas nada avisa o usuário
   quando a pergunta depende de lei estadual/municipal ou de habilitação
   profissional.
2. **Verificador só prova que o id citado existe, não que a fonte sustenta
   a afirmação** — uma claim com item ou NR inventado passa desde que cite
   um id válido.
3. **Monitor normativo mudo** — falha de coleta só vai para o log e ninguém
   é avisado de versão pendente de validação.
4. **Docs desatualizados** — roadmap diz que a Fase 9 não foi implementada;
   comentário do módulo diz que a MiniMax nunca foi chamada de verdade.

**Fora de escopo (ficam para etapas posteriores):**

- Chunking estrutural, `tsvector`/busca híbrida, registry ampliado,
  jurisdição como dado — só depois do baseline da Etapa 2+3.
- Bloqueio por números/prazos — só registrado nesta etapa (§4.4).
- Classificador de pergunta completo e semáforo 🟢🟡🔴 — Fase 5 do plano
  da auditoria.
- Detecção de revisão publicada em URL nova — Fase 6 do plano da auditoria;
  aqui o monitor só passa a ser **observável** (§5).
- Persistência da observabilidade em tabela — Etapa 3.

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Detecção de jurisdição/atribuição por regras determinísticas na
  pergunta**, sem LLM (nível 1 de `docs/assistente-montese-principios.md`
  §5). Rejeitados: campo estruturado no tool schema (depende de o modelo
  obedecer, sem dataset para medir) e as duas juntas (dois mecanismos para
  manter já na Etapa 1).
- **Verificador v2 híbrido**: bloqueia item (`X.Y.Z`) e NR (`NR-XX`)
  ausentes das fontes citadas; só **registra** número com unidade. Motivo:
  item/NR são strings exatas com risco baixo de falso positivo; número com
  unidade tem formas equivalentes ("8 horas", "oito horas", "8 (oito)
  horas") que ainda não dá para medir sem dataset. Rejeitada a verificação
  por uma segunda chamada de IA (custo, e um modelo se autoconferindo — mesma
  razão da spec da Fase 9 para o Verificador determinístico).
- **Alerta do monitor**: estado no banco + selo na tela admin + e-mail só
  na anomalia. O estado gravado vira o `data_verificacao` do registry da
  Fase 2 da arquitetura.
- **Testes com lógica pura, sem banco, sempre que possível** —
  `run-backend-tests.sh` carrega o `.env` real e os e2e rodam contra o
  mesmo Postgres de produção, sem banco de teste isolado. Só o que tem SQL
  de verdade ganha e2e.

## 3. Avisos determinísticos e fallback

### 3.1 Módulo puro `question-notices.ts`

Novo arquivo `backend/src/normative/question-notices.ts`, sem I/O, sem
LLM, sem dependência de NestJS:

```ts
export type NoticeType = 'jurisdicao' | 'profissional_habilitado' | 'contexto';
export interface NormativeNotice { tipo: NoticeType; texto: string }
export function detectNotices(question: string): NormativeNotice[];
```

A pergunta é normalizada (minúsculas, sem acentos via NFD, espaços
colapsados) antes de casar os gatilhos. No máximo **um aviso por tipo**,
sempre na ordem `jurisdicao`, `profissional_habilitado`, `contexto`.

Gatilhos iniciais (lista inicial, ajustável sem mudar o contrato — a suíte
unitária é a fonte de verdade):

| Tipo | Gatilhos |
|---|---|
| `jurisdicao` | `ppci`, `avcb`, `clcb`, `bombeiro(s)`, `alvara`, `licenca ambiental`, `licenciamento`, `codigo de obras`, `meu estado/municipio/cidade`, `estadual/estaduais`, `municipal/municipais` |
| `profissional_habilitado` | `quem pode (assinar\|emitir\|elaborar\|executar\|realizar)`, `art` (**exceto** `art.`/`art` seguido de número, que é artigo de lei), `rrt`, `responsavel tecnico`, `atribuicao/atribuicoes profissional/is`, `profissional habilitado`, `legalmente habilitado`, `assinar (o/a/um/uma)? (laudo\|projeto\|pgr\|pcmso\|ltcat\|ppra\|apr)` |
| `contexto` | `minha empresa (precisa\|tem que\|deve)`, `sou obrigado/a`, `preciso (ter\|fazer\|elaborar\|implantar\|de)`, `e obrigatorio` |

Textos fixos dos avisos:

- `jurisdicao`: "A base atual só contém as Normas Regulamentadoras
  federais (MTE). Exigências estaduais e municipais — como as do Corpo de
  Bombeiros, licenciamento e alvarás — não estão na base. Informe o estado
  e o município e confirme com o órgão competente."
- `profissional_habilitado`: "Posso explicar o que a norma exige, mas quem
  executa ou assina este serviço depende da habilitação legal do
  profissional. Confirme com o conselho profissional competente."
- `contexto`: "Para uma resposta precisa, informe o número de empregados,
  a atividade (CNAE), o grau de risco e o estado da empresa."

### 3.2 Contrato

`NormativeQueryResult` (em `normative-assistant.service.ts`) ganha:

```ts
notices: NormativeNotice[];   // sempre presente, possivelmente vazio
```

Mudança **somente aditiva** — clientes atuais ignoram o campo. Os três
pontos de retorno de `query()` (dois de fallback, um de sucesso) devolvem
`notices`. `detectNotices(question)` é chamado no início de `query()`, antes
de qualquer embedding, e não altera o fluxo de busca nem chama o provedor.

### 3.3 Texto do fallback

`FALLBACK_MESSAGE` passa de "Não encontrei nada relevante pra essa
pergunta." para: "Não encontrei fundamento suficiente nas fontes
consultadas para afirmar isso. Isso não significa que a exigência não
exista, só que não a localizei." (alinha com `docs/assistente-montese-principios.md`
§2, "não encontrado nunca vira não existe").

### 3.4 Regra no prompt

Uma regra a mais em `SYSTEM_PROMPT` (`normative-answer-shared.ts`), na
seção "Regras obrigatórias": se a pergunta depender de legislação estadual
ou municipal, ou da habilitação legal de um profissional, não responder
como se a regra fosse universal — limitar-se ao que os trechos dizem e
declarar o que eles não cobrem.

### 3.5 Frontend

`AssistantChat.tsx`: o tipo `QueryResult` ganha `notices`; cada aviso é
renderizado numa caixa âmbar **acima** da resposta (mesmo estilo visual do
`attachment_warning`). Sem outras mudanças de UI.

## 4. Verificador v2

### 4.1 Módulo puro `claim-support.ts`

Novo arquivo `backend/src/normative/claim-support.ts`, sem I/O:

```ts
export interface ClaimSupportResult {
  blocking: string[];  // tokens de item/NR sem base nas evidências
  logged: string[];    // números com unidade sem base (só registrados)
}
export function checkClaimSupport(claimText: string, evidenceTexts: string[]): ClaimSupportResult;
```

### 4.2 O que é extraído da claim

- **NR**: `NR-XX` ou `NR XX`, comparado pelo **número inteiro**
  (`NR-07` = `NR-7`).
- **Item**: token pontuado `\d{1,2}(\.\d{1,3})+`, tratado como item se:
  (a) tem 3 ou mais segmentos; ou (b) tem 2 segmentos e o segundo tem no
  máximo 2 dígitos (`35.4`, `12.10`); ou (c) vem até 12 caracteres depois
  de `item`, `itens`, `subitem` ou `subitens`. Isso evita tratar `2.000`
  (milhar) como item. Um token de 2 segmentos seguido diretamente de
  unidade (`3.5 metros`, `1.5 m`) é tratado como número, não item —
  **exceto** quando a regra (c) se aplica, que prevalece.

### 4.3 Regra de bloqueio

Para cada NR e cada item extraídos, o token precisa constar nas
evidências da própria claim (concatenadas e com espaços normalizados):

- **NR**: aparece em alguma evidência, casada pelo número inteiro.
- **Item**: aparece com borda numérica — casa `(?<![\d.])ITEM(?!\d)` —, o
  que aceita **descendente** (`35.4` é apoiado por um trecho que contém
  `35.4.4`) e rejeita prefixo de outro número (`5.4` não casa dentro de
  `35.4`; `35.4.4` não casa dentro de `35.4.44`).

Se qualquer token falhar, a claim é **descartada**, exatamente como o
id-check atual descarta. Claim sem item nem NR passa como hoje.

### 4.4 Só registra: números com unidade

Números com unidade na claim (dias, horas, minutos, meses, anos, semanas,
`%`/"por cento", `R$`/reais, metros, cm, mm, kg, dB, °C) são comparados
com as evidências: o mesmo número imediatamente seguido (tolerando
espaços e um parêntese) da mesma família de unidade. Número por extenso
na evidência **não** é convertido — conta como ausente e vai para o log;
é justamente o falso positivo que a Etapa 3 vai medir antes de qualquer
bloqueio.

### 4.5 Evidências consideradas por claim

Só as fontes que a própria claim cita:

- `chunk_ids` → texto do chunk **precedido do código e do título da
  fonte** (`NR-35 …`). Necessário porque o texto de um chunk nem sempre
  repete o nome da norma; sem isso, "conforme a NR-35" seria bloqueado
  indevidamente. Exige `s.code AS source_code` na query de `RetrievedChunk`.
- `operational_ref_ids` → título do item operacional.
- `company_chunk_ids` → conteúdo do chunk e título do documento.
- `uses_attachment` (real) → texto completo do anexo quando o tipo é
  `pdf_text`/`docx_text`/`xlsx_text`. Anexo do tipo `image` não tem texto
  verificável: uma claim que só cita a imagem não é checada.

### 4.6 Integração

Em `normative-assistant.service.ts`, no filtro `survivingClaims`, depois
do id-check atual, chamando `checkClaimSupport` com as evidências da claim.
Se todas forem descartadas, cai no fallback como hoje.

Registro (`Logger.warn`) para toda claim bloqueada e para todo número
sinalizado: ids das fontes citadas + tokens sinalizados. **Nunca** o texto
da pergunta nem da claim (dados de empresa/LGPD). A Etapa 3 troca esse log
por persistência.

`NormativeClaim` e o formato de resposta ao cliente **não mudam**.

## 5. Monitor normativo: estado e alerta

### 5.1 Migration `0050` (somente aditiva)

Em `official_sources`:

```sql
ALTER TABLE official_sources
  ADD COLUMN last_checked_at timestamptz,
  ADD COLUMN last_check_status text CHECK (last_check_status IN ('ok', 'erro')),
  ADD COLUMN last_error text,
  ADD COLUMN consecutive_failures int NOT NULL DEFAULT 0;
```

As 36 fontes atuais ficam com `NULL`/`0` até a primeira execução do cron.
Nada é apagado nem reescrito. **A migration roda no Postgres de produção e
só é aplicada com o ok explícito do fundador**; o backup diário das 03:00
cobre o risco (ver `docs/operations/backups.md`).

### 5.2 Registro do resultado por fonte

`processSource` (em `normative-monitor.service.ts`) passa a gravar, ao fim
de cada fonte:

- sucesso (inclusive "conteúdo igual", sem versão nova): `status = 'ok'`,
  `last_checked_at = now()`, `last_error = NULL`, `consecutive_failures = 0`;
- falha em qualquer etapa do `processSource` (status HTTP ≠ 2xx, timeout,
  erro de parse, falha ao gravar no R2): `status = 'erro'`,
  `last_checked_at = now()`, `last_error` = mensagem truncada em 500
  caracteres, `consecutive_failures = consecutive_failures + 1`.

`last_error` guarda só a mensagem do erro (status/timeout/parse), nunca a
resposta da fonte.

### 5.3 E-mail só na anomalia

`runOnce` acumula eventos da rodada:

- **fonte que atingiu exatamente 2 falhas seguidas** — um e-mail por
  episódio; a 3ª, 4ª… falha não reenvia; sucesso zera o contador e um novo
  episódio volta a alertar na 2ª falha;
- **versão nova entrou como `aguardando_validacao`** (`recordDetectedVersion`
  devolveu um documento).

Se houver eventos, envia **um único e-mail resumo por execução** a cada
usuário `role = 'admin'` e `status = 'ativo'`, buscados com
`withTenantContext({ role: 'admin' }, …)` (`users` tem `FORCE ROW LEVEL
SECURITY`; mesmo padrão de `VisitReminderCronService`). Usa `EmailService`
(`to` é uma string: um `send` por admin) e `escapeHtml`. O corpo lista
código, título e `last_error` das fontes falhando e código/título das
versões pendentes, e manda o admin abrir Admin > Normativa (sem link novo,
para não criar variável de ambiente de URL base).

Sem eventos, sem e-mail. Falha de envio (por admin) é logada e nunca
derruba o monitor. Sem nenhum admin ativo, loga aviso.

### 5.4 Tela admin

`frontend/src/app/admin/normativa/page.tsx`: cada fonte mostra "verificada
há X" (a partir de `last_checked_at`, "nunca verificada" se `NULL`) e um
selo vermelho quando `consecutive_failures > 0`, com o `last_error`.
`GET /normative-sources` já devolve as colunas novas (`SELECT *`); só a
interface `OfficialSource` (backend e frontend) ganha os campos.

### 5.5 Isolamento nos testes (achado na escrita do plano)

`runOnce()` percorre **todas** as fontes ativas do banco, e os e2e rodam
contra o mesmo Postgres de produção. Hoje isso é inofensivo — as 36 NRs
reais falham no mock de `fetch` e só geram log. Com estado persistido e
e-mail, o e2e gravaria falhas nas fontes reais e poderia mandar aviso a
admins reais. Por isso:

- `runOnce(options?: { onlySourceIds?: string[] })` — o cron chama sem
  argumento (todas as fontes ativas, comportamento de produção inalterado);
  os testes passam só os ids das fontes de fixture. Os dois e2e já
  existentes do monitor passam a usar esse escopo.
- Os e2e do monitor substituem `EmailService` por um mock
  (`overrideProvider`, padrão de `weekly-digest.e2e-spec.ts`), então nenhum
  e-mail real sai mesmo que o banco tenha admins reais.

## 6. Documentação

- `docs/roadmap.md`: a Fase 9 deixa de constar como "ainda não
  implementada"; registra o que está em produção (36 NRs vigentes
  indexadas em 2026-08-31, Assistente ativo, evoluções das Fases 10/20/24).
- Comentário de `normative.module.ts`: diz só o que o log prova — MiniMax
  ativa, com 27 chamadas reais de `assistant_normative_query` registradas
  em `minimax_usage_log` (até 2026-09-20). O caminho com imagem
  (`image_url`) fica marcado como "validação não confirmada" até o
  fundador confirmar o contrário.
- `docs/assistente-montese-principios.md`: uma linha registrando os avisos
  determinísticos (§3) e o verificador v2 (§4) como implementação do
  princípio de nunca afirmar sem fonte real.

## 7. Testes

**Unitários (`*.unit-spec.ts`, sem banco):**

- `question-notices`: cada gatilho, com e sem acento; `art. 157` não
  dispara `profissional_habilitado`; no máximo um aviso por tipo; ordem
  estável; pergunta sem gatilho → lista vazia.
- `claim-support`: `2.000` não é item; `35.4` apoiado por `35.4.4`;
  `35.4.4` não apoiado por `35.4.44` nem por `35.4.1`; `5.4` não casa em
  `35.4`; `NR-07` = `NR-7`; código da fonte conta como evidência de NR;
  `3.5 metros` é número, não item; número por extenso vai para `logged` e
  nunca para `blocking`; claim sem item/NR → resultado vazio; anexo de
  imagem não é checado.

**e2e do Assistente** (`normative-assistant.e2e-spec.ts`, Postgres real,
padrão existente):

- Atualizar os 4 asserts que dependem do texto antigo do fallback (linhas
  182, 220, 333 e 416).
- Casos novos: claim com item inventado é descartada mesmo com `chunk_id`
  válido; `notices` sempre presente; aviso de jurisdição acompanha uma
  resposta federal; aviso presente também no caminho de fallback.

**e2e do monitor** (`normative-monitor.e2e-spec.ts`, padrão existente,
sempre com `onlySourceIds` e `EmailService` mockado — ver §5.5): estado
gravado em sucesso e em falha; e-mail só na 2ª falha seguida e não na 3ª;
um único e-mail resumo por rodada; e-mail também quando entra versão nova;
falha de envio não derruba a rodada; sucesso zera o contador.

**Unitário do e-mail** (`normative-monitor-email.unit-spec.ts`): o corpo é
montado por função pura (`buildMonitorAlertEmail`) que escapa HTML e só
inclui as seções que têm eventos.

## 8. Ordem de implementação

Um commit por passo:

1. Módulos puros (`question-notices`, `claim-support`) com seus testes
   unitários.
2. Integração no serviço + `source_code` na query + ajuste/adição dos e2e
   do Assistente + regra no prompt.
3. Frontend dos avisos (`AssistantChat`).
4. Migration `0050`, monitor, e-mail e tela admin (com e2e do monitor).
5. Documentação.

## 9. Riscos e limites assumidos

- **Recall limitado dos gatilhos** — só pega o que está na lista. Aceito:
  o aviso é aditivo, nunca bloqueia resposta; o classificador real vem na
  Fase 5 do plano da auditoria.
- **Falso positivo do bloqueio por item/NR** — uma claim correta pode ser
  descartada se o modelo citar um item que a fonte não repete no trecho
  recuperado (o chunk pode começar no meio de uma seção). Aceito por
  seguir "fonte > memória do modelo"; o registro em log permite medir a
  frequência, e a Etapa 3 formaliza a medição.
- **Migration em produção** — aditiva, com defaults, sem reescrever linhas;
  só com ok explícito.
- **Nenhum comportamento de busca muda** — chunking, threshold (0.4),
  top-K e embeddings permanecem intactos até existir baseline.

## 10. Lacunas da auditoria que esta etapa fecha

| Lacuna | Situação depois da Etapa 1 |
|---|---|
| C2 — verificador não confere sustentação | Parcial: bloqueia item/NR; números só registrados |
| A5 — fallback único, sem atribuição profissional | Fechada em nível determinístico; classificador real na Fase 5 |
| C1 — jurisdição inexistente | Só mitigada por aviso; jurisdição como dado fica na Fase 2 da arquitetura |
| A4 — monitor cego | Parcial: passa a ser observável; revisão em URL nova continua sem detecção |
| Baixo — docs desatualizados | Fechada |
