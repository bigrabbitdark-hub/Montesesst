# Confiabilidade do Assistente — Etapas 2 e 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao Assistente Montese SST um banco de perguntas golden (~60), um runner que mede o pipeline real em duas camadas contra um baseline versionado, e um log de uso real que guarda só metadados — para que qualquer mudança futura de chunking, busca, prompt, modelo ou limiar seja medida e não presumida.

**Architecture:** O `NormativeAssistantService` ganha `retrieve()` e `queryWithTrace()` (aditivos; `query()` mantém assinatura e retorno) e um `QueryTrace` sem nenhum texto. O runner (`backend/eval/`, scripts `tsx`) sobe um contexto Nest sem HTTP e chama o mesmo serviço de produção: Camada A (recuperação + avisos, sem LLM de resposta) e Camada B (resposta real, `--llm`, com teto). O dataset e os baselines são arquivos versionados no repo; o banco de produção só ganha a tabela `assistant_query_log`.

**Tech Stack:** NestJS + Postgres/pgvector (`pg` puro) + Jest/ts-jest + scripts `tsx` (padrão de `db/caepi-sync.ts`).

**Spec:** `docs/specs/assistente-confiabilidade-etapa-2-3.md` (aprovada em 2026-09-20). Executores leem a spec e este plano juntos. **Esclarecimentos que este plano faz sobre a spec** (a Task 10 os grava na spec): (a) a `evidencia` de uma fonte esperada deve **começar pelo número do item** ("35.4.1 Todo trabalho em altura deve…") — é assim que o lint distingue o texto real do sumário que abre as NRs; (b) o lint também rejeita citação com artefato de página no meio (`-- 2 of 12 --`, "Este texto não substitui o publicado no DOU") e citação só de título; (c) "acerto de item" considera o título do item no começo de uma linha do trecho.

## Global Constraints

Toda task abaixo herda estas regras.

- **Dataset em arquivo versionado:** `backend/eval/golden/perguntas.json`, um array de **60** registros com a distribuição fixa: conceitual 8, aplicação 8, caso real 8, contexto incompleto 8, pegadinha 8, jurisdicional 8, atribuição profissional 6, sem evidência 6.
- **Validação "rascunho agora, validação depois":** todo registro nasce `status: rascunho`, `validado_por: null`, `validado_em: null`. **Só `status: validado` conta como gate de regressão**; rascunhos são medidos e reportados à parte. Quem valida é um profissional de SST, decisão do fundador — **nenhuma task marca uma pergunta como `validado`**.
- **Citação literal conferida por código:** cada `evidencia` de `fontes_esperadas` existe literalmente no texto vigente da NR indicada (espaços normalizados nos dois lados), começa pelo número do `item`, não contém artefato de página e tem texto além do título. Erro do lint = código de saída 1.
- **Runner e lint só LEEM o banco.** Nenhum `INSERT`: o log de uso só é gravado por `query()` no fluxo HTTP. O runner não usa tenant.
- **Camada A** (`eval:retrieval`): só embedding, sem LLM de resposta. **Camada B** (`eval:answer`): chama o LLM **real e PAGO**; exige `--llm`, teto `--max-llm-calls` (padrão **15**, amostra que cobre os tipos), `--allow-full` para passar do teto. Estimativa: ~4,3 mil tokens por chamada. **Nenhuma task roda a Camada B sem o ok explícito do usuário e sem o teto à vista.**
- **Gate de regressão:** Camada A (determinística) → código de saída 1 se qualquer pergunta `validado` que passava deixa de passar. Camada B (não determinística) → só reprova com `--fail-on-regression`. Sem meta numérica: o primeiro baseline, gerado **antes** de qualquer mudança de chunking/busca, calibra as metas.
- **`QueryTrace` nunca carrega texto** de pergunta, claim ou resposta — só ids, similaridades, contagens e o hash SHA-256 da pergunta. `query()` mantém **exatamente** a assinatura e o retorno de hoje.
- **Regra de privacidade dos tokens:** `blocking_tokens` e `flagged_numbers` só são guardados quando a claim cita **exclusivamente** trechos normativos oficiais; se cita documento da empresa, item operacional, checklist ou anexo, guarda-se só a contagem. `retrieved` guarda ids só de fontes de referência (normas e checklist); fontes da empresa entram como similaridade, sem ids.
- **Log de uso (`assistant_query_log`):** só metadados e ids; RLS (qualquer contexto insere, só admin lê e apaga); retenção de **90 dias** (job diário); a gravação **nunca** atrasa nem derruba a resposta ao usuário. O interruptor `ASSISTANT_QUERY_LOG_DISABLED=true` é ligado por padrão em **todo** e2e (`test/jest-e2e-setup.ts`) para os e2e — que rodam contra o Postgres de produção — não gravarem linhas de teste no uso real; só `assistant-query-log.e2e-spec.ts` o desliga.
- **Migration `0051` é somente aditiva** e **só é aplicada com o ok explícito do fundador**, depois de confirmar o backup do dia **e de conferir que 0051 é o próximo número livre** (a outra sessão pode ter usado). Nunca `DROP`/`TRUNCATE`.
- Os e2e (`./run-backend-tests.sh test:e2e …`) rodam contra o **mesmo Postgres de produção**, sem banco de teste isolado. Lógica pura vai em `*.unit-spec.ts` (sem banco).
- **Proibido:** `docker compose config`, `docker compose down -v`/`--volumes`, `docker volume rm/prune`, `docker inspect` sem `--format` de nome, `docker exec … env`/`printenv`; ler `.env` ou `docker-compose.override.yml`; `git add -A` / `git add .` (a árvore tem arquivos alheios não commitados — sempre `git add` de caminhos explícitos); editar `docs/compliance/lgpd-compliance.md` (tem alterações do fundador).
- **Commits só se o usuário autorizou commits nesta sessão.** Se não autorizou, cada step "Commit" vira: parar, listar os arquivos alterados e perguntar. Mensagens em português, prefixo `feat:`/`fix:`/`test:`/`docs:`, terminadas com a linha `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- **Deploy (rebuild/restart de container) não faz parte deste plano.**
- Regex de remoção de acentos usa `\p{M}` com a flag `u` (não usar escapes `\u…` no código: a ferramenta de edição pode expandi-los).
- Comentários e mensagens em português (padrão do repo).
- **Não mudar** nesta etapa: chunking, busca, embeddings, limiar de similaridade (0.4), prompts dos outros agentes, `claim-support.ts`, `question-notices.ts`.

## Comandos de verificação (referência)

- Unit: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern <nome>`
- e2e: `/opt/Montese/run-backend-tests.sh test:e2e -- --testPathPattern <nome> --forceExit`
- Typecheck backend (inclui `test/` e `eval/`): `cd /opt/Montese/backend && PATH="/root/.nvm/versions/node/v20.20.2/bin:$PATH" npx tsc --noEmit -p tsconfig.json`
- Scripts de avaliação (carregam o ambiente pelo wrapper): `/opt/Montese/run-backend-tests.sh eval:nr -- NR-35 35.4`. **O wrapper executa `npm run` dentro de `backend/`**: caminhos relativos de `--out`, `--compare` e `--file` são relativos a `backend/` (ex.: `--out eval/baselines/x.json`); no `git add`, que roda na raiz, o caminho é `backend/eval/baselines/x.json`.
- Consulta de leitura ao banco (sempre read-only, sem segredos):
  `echo "<SQL>" | docker exec -i montese_postgres sh -c 'PGOPTIONS="-c default_transaction_read_only=on" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'`

## Pré-requisito de infraestrutura: como alcançar o Postgres e o Redis

O wrapper `run-backend-tests.sh` conecta em `localhost:5432` (Postgres) e `localhost:6379` (Redis). Em 2026-09-20 o `docker-compose.override.yml` que publicava essas portas foi **removido** (era só para o plano do checklist SST) e os containers de produção rodam **sem portas publicadas**. Consequência: o wrapper original **não alcança o banco**, e isso afeta tudo que não é teste unitário puro.

- **Tasks 1 a 3** (testes unitários puros) **não precisam de banco** — o wrapper original serve.
- **Da Task 4 em diante** (scripts que leem o banco, e2e, migration, runner): use uma **cópia do wrapper apontada para os IPs internos da rede do Docker**. Isso **não publica porta, não cria override e não recria container** — recriar o container do Postgres de produção só para abrir uma porta é o que se quer evitar. Receita (o arquivo fica em um diretório temporário seu, **nunca** edite o `/opt/Montese/run-backend-tests.sh`, que é do fundador):

```bash
NET_WRAPPER="$(mktemp -d)/run-backend-tests-net.sh"
PG_IP=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' montese_postgres)
RD_IP=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' montese_redis)
sed -e "s#@localhost:5432#@$PG_IP:5432#g" -e "s#@localhost:6379#@$RD_IP:6379#g" /opt/Montese/run-backend-tests.sh > "$NET_WRAPPER"
chmod +x "$NET_WRAPPER"
echo "$NET_WRAPPER"
```

  **Onde este plano escreve `/opt/Montese/run-backend-tests.sh`, use o caminho da cópia** enquanto as portas não estiverem publicadas. O `docker inspect` só pode ser usado com esse `--format`, que imprime **apenas o IP** (nunca `docker inspect` sem `--format`, nunca `docker compose config`). Os IPs mudam se os containers forem recriados: refaça a cópia. Antes de usá-la, teste a conexão com um comando de leitura: `"$NET_WRAPPER" eval:nr -- NR-35 35.4.1` (depois da Task 4) ou uma consulta `psql` de leitura via `docker exec`.
- **Alternativa (só se o fundador pedir):** republicar as portas em `127.0.0.1` com um override mínimo. Isso **recria os containers de produção do Postgres e do Redis** e deixa uma superfície exposta; exige autorização explícita do fundador e o override deve ser removido ao terminar. **Não é o caminho recomendado.**

## Ordem de execução e portões

| Tasks | Depende de | Observação |
|---|---|---|
| 1–3 (dataset, métricas e apoio, módulos puros) | nada | **Arquivos novos**, testes unitários **sem banco**. Podem rodar já, antes do merge da outra sessão. |
| 4–5 (lint e autoria das 60) | Tasks 1–3 + acesso ao banco (seção acima) | Só arquivos novos e scripts em `backend/package.json`; **leem** o banco pela cópia do wrapper. Podem rodar antes do merge da outra sessão. |
| 6 (trace + refatoração do serviço) | **integração do checklist SST em `main`** | Edita `normative-assistant.service.ts` e os provedores — arquivos que a outra sessão (`montese-5c`) edita. **Não começar** enquanto ela não avisar que terminou e a `feat/assistente-confiabilidade-etapa-1` estiver em `main`. Reler o serviço antes: as âncoras foram geradas contra `c27263f`. |
| 7 (log de uso) | Task 6 + **ok explícito para a migration** | Ponto de parada obrigatório antes de aplicar a `0051`. |
| 8 (runner + baseline A) | Tasks 5, 6, 7 | Primeira rodada usa embeddings pagos (centavos): pedir ok. |
| 9 (Camada B + baseline em amostra) | Task 8 + **ok explícito e teto** | Chamadas reais e pagas ao LLM. |
| 10 (higiene e docs) | Tasks anteriores | Inclui o conserto do teste pré-existente `normative-openrouter-answer`. |

**Coordenação de execução:** os e2e compartilham o mesmo Postgres de produção, o Redis e o rate-limit global (300 requisições por 300 s por IP; a rota `ata-audio` tem janela de 24 h). Antes de rodar jest/e2e, avise a outra sessão e confirme que ela não está rodando testes; ao rodar a suíte completa, exporte `RATE_LIMIT_MAX=100000` e use `--forceExit`. A suíte e2e completa num único worker **bate no limite de heap do Node por volta de 99 suítes**: rode-a em duas invocações (divida com `--testPathPattern`). Linha de base conhecida da suíte e2e completa: `cipa-ata-ai` falha por 429 da janela de 24 h (não tem relação com este plano); `normative-openrouter-answer` (1 teste) é consertada na Task 10.

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/eval/golden/quote.ts` | Criar | normalização e conferência de citação literal; título de item em trecho |
| `backend/eval/golden/golden-schema.ts` | Criar | tipos e validação do registro/dataset golden |
| `backend/eval/golden/nr-blocks.ts` | Criar | quebra o texto de uma NR em blocos por item (ajuda de autoria) |
| `backend/eval/golden/perguntas.json` | Criar | o banco de perguntas (60) |
| `backend/eval/metrics.ts` | Criar | métricas das Camadas A e B, agregados e detecção de regressão |
| `backend/eval/args.ts` | Criar | parse dos argumentos dos comandos `eval:*` |
| `backend/eval/llm-plan.ts` | Criar | teto e amostra da Camada B |
| `backend/eval/report.ts` | Criar | baselines, resumos e markdown de revisão |
| `backend/eval/usage-summary.ts` | Criar | agregação do log de uso |
| `backend/eval/lint-golden.ts`, `nr-text.ts`, `notices-check.ts` | Criar | `eval:lint`, `eval:nr`, `eval:notices` (só leitura) |
| `backend/eval/run-eval.ts`, `usage-report.ts` | Criar | `eval:retrieval`/`eval:answer`, `eval:usage` |
| `backend/eval/baselines/*.json` (+ `.md`) | Criar | baselines commitados |
| `backend/src/normative/query-trace.ts` | Criar | tipo `QueryTrace`, hash da pergunta, regra de privacidade dos tokens |
| `backend/src/normative/normative-assistant.service.ts` | Modificar | `retrieve()`, `queryWithTrace()`, trace, log |
| `backend/src/normative/normative-answer-provider.interface.ts`, `minimax-…`, `openrouter-…` | Modificar | `modelName` para o trace |
| `backend/src/normative/assistant-query-log.service.ts` | Criar | grava o trace, purge de 90 dias |
| `backend/src/normative/normative.module.ts` | Modificar | registra o serviço de log |
| `backend/db/migrations/0051_assistant_query_log.sql` | Criar | tabela + RLS |
| `backend/test/*.unit-spec.ts`, `assistant-trace.e2e-spec.ts`, `assistant-query-log.e2e-spec.ts`, `jest-e2e-setup.ts`, `jest-e2e.json` | Criar/Modificar | testes e interruptor do log nos e2e |
| `backend/package.json` | Modificar | scripts `eval:*` |
| `docs/specs/assistente-confiabilidade-etapa-2-3.md`, `docs/assistente-montese-principios.md`, `docs/roadmap.md`, `backend/test/normative-openrouter-answer.e2e-spec.ts` | Modificar | docs e higiene |

---

### Task 1: Formato do dataset e conferência de citações (módulos puros)

**Files:**
- Create: `backend/eval/golden/quote.ts`, `backend/eval/golden/golden-schema.ts`
- Test: `backend/test/golden-quote.unit-spec.ts`, `backend/test/golden-schema.unit-spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces (usadas pelas Tasks 2–5 e 8):
  ```ts
  // quote.ts
  export function escapeRegExp(value: string): string;
  export function normalizeForQuote(text: string): string;
  export type EvidenceFailure = 'evidencia_nao_comeca_pelo_item' | 'evidencia_com_marcador_de_pagina' | 'evidencia_curta_demais' | 'evidencia_nao_encontrada';
  export function checkEvidence(documentText: string, item: string, evidencia: string): { ok: boolean; reason?: EvidenceFailure };
  export function chunkContainsItemHeading(content: string, item: string): boolean;
  // golden-schema.ts
  export const TIPOS, COMPORTAMENTOS, AVISOS, RISCOS, JURISDICOES, STATUS;
  export interface GoldenQuestion { … }   // ver o arquivo
  export function validateGoldenQuestion(raw: unknown): string[];
  export function validateGoldenDataset(raw: unknown): string[];
  export function parseGoldenDataset(raw: unknown): GoldenQuestion[];
  export function countByTipo(questions: GoldenQuestion[]): Record<Tipo, number>;
  ```

- [ ] **Step 1: Escrever os testes (falham)**

Criar `backend/test/golden-quote.unit-spec.ts`:

```ts
import { checkEvidence, chunkContainsItemHeading, normalizeForQuote } from '../eval/golden/quote';

// Trecho REAL da NR-35 vigente (35.4.1), com as quebras de linha do PDF, e o
// sumário que antecede o texto nas NRs — o "35.4 Capacitação e treinamento"
// do sumário não pode ser confundido com a seção de verdade.
const NR35_TEXT = [
  'Sumário',
  '35.4 Capacitação e treinamento',
  '35.5 Planejamento',
  '35.4.1 Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado pela',
  'organização.',
  '35.4.1.1 Considera-se trabalhador autorizado para trabalho em altura aquele capacitado cujo',
  'estado de saúde foi avaliado, tendo sido considerado apto para executar suas atividades.',
].join('\n');

describe('normalizeForQuote (unit)', () => {
  it('colapsa quebras de linha e espaços em um espaço só', () => {
    expect(normalizeForQuote('pela\n  organização.\n\n')).toBe('pela organização.');
  });

  it('troca espaço sem quebra (NBSP) por espaço comum e remove hífen suave', () => {
    const nbsp = String.fromCharCode(160);
    const softHyphen = String.fromCharCode(173);
    expect(normalizeForQuote(`trabalho${nbsp}em al${softHyphen}tura`)).toBe('trabalho em altura');
  });

  it('hífen no fim da linha é mantido e a linha seguinte é juntada (fiel ao PDF)', () => {
    expect(normalizeForQuote('o gru-\npo de trabalho')).toBe('o gru-po de trabalho');
  });
});

describe('checkEvidence (unit)', () => {
  it('aceita uma citação literal que começa pelo item, mesmo atravessando quebra de linha', () => {
    const result = checkEvidence(
      NR35_TEXT,
      '35.4.1',
      '35.4.1 Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado pela organização.',
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejeita evidência que não começa pelo número do item', () => {
    const result = checkEvidence(
      NR35_TEXT,
      '35.4.1',
      'Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado pela organização.',
    );
    expect(result).toEqual({ ok: false, reason: 'evidencia_nao_comeca_pelo_item' });
  });

  it('rejeita linha do sumário: só o número e o título não são citação', () => {
    const result = checkEvidence(NR35_TEXT, '35.4', '35.4 Capacitação e treinamento');
    expect(result).toEqual({ ok: false, reason: 'evidencia_curta_demais' });
  });

  it('rejeita citação que não existe no texto vigente', () => {
    const result = checkEvidence(
      NR35_TEXT,
      '35.4.1',
      '35.4.1 Todo trabalho em altura deve ser realizado somente por engenheiro de segurança do trabalho.',
    );
    expect(result).toEqual({ ok: false, reason: 'evidencia_nao_encontrada' });
  });

  it('rejeita citação que atravessa a quebra de página (marcador e cabeçalho do DOU no meio do item)', () => {
    const paginado = [
      '6.5.1 Cabe à organização, quanto ao EPI:',
      'c) fornecer ao empregado, gratuitamente, EPI adequado ao risco, nas situações previstas',
      '-- 2 of 12 --Este texto não substitui o publicado no DOU',
      'no subitem 1.5.5.1.2 da Norma.',
    ].join('\n');
    const suja = '6.5.1 Cabe à organização, quanto ao EPI: c) fornecer ao empregado, gratuitamente, EPI adequado ao risco, nas situações previstas -- 2 of 12 --Este texto não substitui o publicado no DOU no subitem 1.5.5.1.2 da Norma.';
    expect(checkEvidence(paginado, '6.5.1', suja)).toEqual({ ok: false, reason: 'evidencia_com_marcador_de_pagina' });
    const limpa = '6.5.1 Cabe à organização, quanto ao EPI: c) fornecer ao empregado, gratuitamente, EPI adequado ao risco, nas situações previstas';
    expect(checkEvidence(paginado, '6.5.1', limpa)).toEqual({ ok: true });
  });

  it('a normalização vale para os dois lados: espaços duplos na evidência não atrapalham', () => {
    const result = checkEvidence(
      NR35_TEXT,
      '35.4.1.1',
      '35.4.1.1  Considera-se trabalhador autorizado para trabalho em altura aquele capacitado cujo estado de saúde foi avaliado',
    );
    expect(result).toEqual({ ok: true });
  });
});

describe('chunkContainsItemHeading (unit)', () => {
  it('reconhece o título do item no começo de uma linha do trecho', () => {
    expect(chunkContainsItemHeading('texto anterior\n35.4.1 Todo trabalho em altura', '35.4.1')).toBe(true);
  });

  it('reconhece o título no começo do próprio trecho', () => {
    expect(chunkContainsItemHeading('35.4.1 Todo trabalho em altura', '35.4.1')).toBe(true);
  });

  it('uma simples menção ao item no meio do texto não conta', () => {
    expect(chunkContainsItemHeading('conforme o item 35.4.1 desta norma', '35.4.1')).toBe(false);
  });

  it('35.4.1 não casa com o título do item 35.4.10', () => {
    expect(chunkContainsItemHeading('\n35.4.10 Outro assunto', '35.4.1')).toBe(false);
  });

  it('trecho que começa depois do número (título cortado) não contém o item', () => {
    expect(chunkContainsItemHeading(' Todo trabalho em altura deve ser realizado', '35.4.1')).toBe(false);
  });
});
```

Criar `backend/test/golden-schema.unit-spec.ts`:

```ts
import {
  countByTipo,
  GoldenQuestion,
  parseGoldenDataset,
  validateGoldenDataset,
  validateGoldenQuestion,
} from '../eval/golden/golden-schema';

function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'NR35-001',
    tipo: 'conceitual',
    categoria: 'NR-35',
    subcategoria: 'Autorização',
    pergunta: 'Quem pode realizar trabalho em altura?',
    resposta_esperada: 'Trabalhador formalmente autorizado pela organização.',
    comportamento_esperado: 'responder',
    fontes_esperadas: [
      {
        fonte: 'norma',
        source_code: 'NR-35',
        item: '35.4.1',
        evidencia: '35.4.1 Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado pela organização.',
      },
    ],
    avisos_esperados: [],
    jurisdicao: 'federal',
    risco_resposta: 'medio',
    versao_fonte: null,
    data_verificacao: null,
    status: 'rascunho',
    gerado_por: 'claude-sonnet-5 (rascunho)',
    validado_por: null,
    validado_em: null,
    ...overrides,
  };
}

describe('validateGoldenQuestion (unit)', () => {
  it('registro válido não tem erros', () => {
    expect(validateGoldenQuestion(valid())).toEqual([]);
  });

  it('rejeita o que não é objeto', () => {
    expect(validateGoldenQuestion(null)).toEqual(['registro não é um objeto']);
    expect(validateGoldenQuestion([])).toEqual(['registro não é um objeto']);
  });

  it('exige textos obrigatórios e formato do id', () => {
    const errors = validateGoldenQuestion(valid({ id: 'nr35', pergunta: '  ' }));
    expect(errors).toContain('pergunta: texto obrigatório');
    expect(errors).toContain('id: formato esperado como NR35-001');
  });

  it('rejeita valores fora dos enums', () => {
    const errors = validateGoldenQuestion(
      valid({ tipo: 'outro', comportamento_esperado: 'talvez', risco_resposta: 'grande', jurisdicao: 'mundial', status: 'ok' }),
    );
    expect(errors.filter((e) => e.startsWith('tipo:'))).toHaveLength(1);
    expect(errors.filter((e) => e.startsWith('comportamento_esperado:'))).toHaveLength(1);
    expect(errors.filter((e) => e.startsWith('risco_resposta:'))).toHaveLength(1);
    expect(errors.filter((e) => e.startsWith('jurisdicao:'))).toHaveLength(1);
    expect(errors.filter((e) => e.startsWith('status:'))).toHaveLength(1);
  });

  it('jurisdição aceita estadual e municipal (a pergunta pode se referir a elas)', () => {
    expect(validateGoldenQuestion(valid({ jurisdicao: 'estadual' }))).toEqual([]);
    expect(validateGoldenQuestion(valid({ jurisdicao: 'municipal' }))).toEqual([]);
  });

  it('fonte esperada: exige campos e que a evidência comece pelo item', () => {
    const errors = validateGoldenQuestion(
      valid({ fontes_esperadas: [{ fonte: 'norma', source_code: 'NR-35', item: '35.4.1', evidencia: 'Todo trabalho em altura' }] }),
    );
    expect(errors).toContain('fontes_esperadas[0].evidencia: deve começar pelo número do item ("35.4.1 …")');
  });

  it("fonte 'checklist' ainda é rejeitada (segunda leva)", () => {
    const errors = validateGoldenQuestion(
      valid({ fontes_esperadas: [{ fonte: 'checklist', source_code: 'NR-13', item: 'Prontuário', evidencia: 'Prontuário x' }] }),
    );
    expect(errors.some((e) => e.includes("só 'norma' é suportada"))).toBe(true);
  });

  it('responder exige pelo menos uma fonte esperada', () => {
    expect(validateGoldenQuestion(valid({ fontes_esperadas: [] }))).toContain(
      'comportamento responder exige pelo menos 1 fonte esperada',
    );
  });

  it('recusar_sem_evidencia exige fontes vazias', () => {
    expect(validateGoldenQuestion(valid({ comportamento_esperado: 'recusar_sem_evidencia' }))).toContain(
      'comportamento recusar_sem_evidencia exige fontes_esperadas vazio',
    );
    expect(
      validateGoldenQuestion(valid({ comportamento_esperado: 'recusar_sem_evidencia', fontes_esperadas: [] })),
    ).toEqual([]);
  });

  it('pedir_contexto, alertar_jurisdicao e alertar_habilitacao exigem o aviso correspondente', () => {
    const base = { fontes_esperadas: [] as unknown[] };
    expect(validateGoldenQuestion(valid({ ...base, comportamento_esperado: 'pedir_contexto' }))).toContain(
      "comportamento pedir_contexto exige o aviso 'contexto'",
    );
    expect(validateGoldenQuestion(valid({ ...base, comportamento_esperado: 'alertar_jurisdicao' }))).toContain(
      "comportamento alertar_jurisdicao exige o aviso 'jurisdicao'",
    );
    expect(validateGoldenQuestion(valid({ ...base, comportamento_esperado: 'alertar_habilitacao' }))).toContain(
      "comportamento alertar_habilitacao exige o aviso 'profissional_habilitado'",
    );
    expect(
      validateGoldenQuestion(
        valid({ ...base, comportamento_esperado: 'alertar_jurisdicao', avisos_esperados: ['jurisdicao'] }),
      ),
    ).toEqual([]);
  });

  it('aviso desconhecido é rejeitado', () => {
    expect(validateGoldenQuestion(valid({ avisos_esperados: ['outro'] })).some((e) => e.includes('"outro" inválido'))).toBe(true);
  });

  it('proibido_regex precisa compilar', () => {
    expect(validateGoldenQuestion(valid({ proibido_regex: ['sim,? todo'] }))).toEqual([]);
    expect(validateGoldenQuestion(valid({ proibido_regex: ['(nao fecha'] }))).toContain('proibido_regex: "(nao fecha" não compila');
  });

  it('status validado exige validado_por e validado_em; rascunho exige ambos nulos', () => {
    expect(validateGoldenQuestion(valid({ status: 'validado' }))).toContain('status validado exige validado_por e validado_em');
    expect(
      validateGoldenQuestion(valid({ status: 'validado', validado_por: 'Fulana, Eng. Seg. Trabalho, CREA 123', validado_em: '2026-09-25' })),
    ).toEqual([]);
    expect(validateGoldenQuestion(valid({ validado_por: 'Alguém' }))).toContain(
      'status rascunho exige validado_por e validado_em nulos',
    );
  });

  it('data_verificacao precisa estar em YYYY-MM-DD ou ser null', () => {
    expect(validateGoldenQuestion(valid({ data_verificacao: '2026-09-21', versao_fonte: 'NR-35:ab12cd34' }))).toEqual([]);
    expect(validateGoldenQuestion(valid({ data_verificacao: '21/09/2026' }))).toContain('data_verificacao: YYYY-MM-DD ou null');
  });
});

describe('validateGoldenDataset / parseGoldenDataset / countByTipo (unit)', () => {
  it('dataset precisa ser um array', () => {
    expect(validateGoldenDataset({})).toEqual(['o dataset deve ser um array']);
  });

  it('detecta id duplicado e prefixa os erros com o id', () => {
    const errors = validateGoldenDataset([valid(), valid(), valid({ id: 'NR35-002', pergunta: '' })]);
    expect(errors).toContain('NR35-001: id duplicado');
    expect(errors).toContain('NR35-002: pergunta: texto obrigatório');
  });

  it('parseGoldenDataset devolve o array tipado quando válido e lança quando inválido', () => {
    const parsed = parseGoldenDataset([valid()]);
    expect(parsed[0].id).toBe('NR35-001');
    expect(() => parseGoldenDataset([valid({ tipo: 'x' })])).toThrow(/Dataset golden inválido/);
  });

  it('countByTipo conta por tipo e devolve zero para os tipos ausentes', () => {
    const questions = [valid(), valid({ id: 'NR35-002', tipo: 'pegadinha' }), valid({ id: 'NR35-003', tipo: 'pegadinha' })] as unknown as GoldenQuestion[];
    const counts = countByTipo(questions);
    expect(counts.conceitual).toBe(1);
    expect(counts.pegadinha).toBe(2);
    expect(counts.sem_evidencia).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern golden-`
Expected: FAIL nas duas suítes — `Cannot find module '../eval/golden/quote'` / `'../eval/golden/golden-schema'`.

- [ ] **Step 3: Implementar `quote.ts`**

Criar `backend/eval/golden/quote.ts`:

```ts
// Conferência de citações literais do dataset golden (Etapas 2 e 3 da
// Confiabilidade do Assistente, spec docs/specs/assistente-confiabilidade-etapa-2-3.md
// §3.5). Módulo puro: sem I/O.
//
// O texto vigente de uma NR vem de PDF: quebra de linha no meio da frase,
// sumário no começo (o "6.3 Disposições gerais" do sumário aparece ANTES da
// seção de verdade) e hifenização no fim da linha. Por isso a `evidencia` de
// uma pergunta precisa COMEÇAR pelo número do item ("35.4.1 Todo trabalho em
// altura deve ser…"): isso ancora a citação numa seção real e evita casar com
// uma linha do sumário.

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mesma normalização nos dois lados da comparação (texto do documento e
// evidência) e na saída do helper de autoria (eval:nr), então uma citação
// copiada do helper bate por construção. Hífen no fim da linha é MANTIDO
// (só se junta a linha seguinte): fiel ao PDF, sem inventar palavra colada.
export function normalizeForQuote(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\p{Cf}/gu, '')
    .replace(/\p{Zs}/gu, ' ')
    .replace(/-[ \t]*\n\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export type EvidenceFailure =
  | 'evidencia_nao_comeca_pelo_item'
  | 'evidencia_com_marcador_de_pagina'
  | 'evidencia_curta_demais'
  | 'evidencia_nao_encontrada';

export interface EvidenceCheck {
  ok: boolean;
  reason?: EvidenceFailure;
}

// Só o número do item não é citação: exige um mínimo de texto depois dele.
const MIN_EVIDENCE_TEXT_LENGTH = 30;

// O texto extraído dos PDFs traz artefatos de página no MEIO do item — o
// marcador "-- 2 of 12 --" e o cabeçalho "Este texto não substitui o publicado
// no DOU". Uma citação que os atravessa carregaria esse lixo; quem redige deve
// parar antes da quebra de página.
const PAGE_ARTIFACT = /--\s*\d+\s+of\s+\d+\s*--|Este texto não substitui o publicado no DOU/i;

export function checkEvidence(documentText: string, item: string, evidencia: string): EvidenceCheck {
  const quote = normalizeForQuote(evidencia);
  if (!quote.startsWith(`${item} `)) return { ok: false, reason: 'evidencia_nao_comeca_pelo_item' };
  if (PAGE_ARTIFACT.test(quote)) return { ok: false, reason: 'evidencia_com_marcador_de_pagina' };
  if (quote.length - item.length - 1 < MIN_EVIDENCE_TEXT_LENGTH) {
    return { ok: false, reason: 'evidencia_curta_demais' };
  }
  if (!normalizeForQuote(documentText).includes(quote)) {
    return { ok: false, reason: 'evidencia_nao_encontrada' };
  }
  return { ok: true };
}

// O item aparece como título numerado no começo de uma linha do trecho
// (chunks são fatias do texto bruto, com as quebras de linha originais).
// Uma simples menção ("conforme o item 35.4.1") não conta.
export function chunkContainsItemHeading(content: string, item: string): boolean {
  return new RegExp(`(^|\\n)${escapeRegExp(item)}\\s`).test(content);
}
```

- [ ] **Step 4: Implementar `golden-schema.ts`**

Criar `backend/eval/golden/golden-schema.ts`:

```ts
// Formato do banco de perguntas golden (Etapas 2 e 3 da Confiabilidade do
// Assistente, spec docs/specs/assistente-confiabilidade-etapa-2-3.md §3).
// Módulo puro: sem I/O, sem NestJS.
import { normalizeForQuote } from './quote';

export const TIPOS = [
  'conceitual',
  'aplicacao',
  'caso_real',
  'contexto_incompleto',
  'pegadinha',
  'jurisdicional',
  'atribuicao_profissional',
  'sem_evidencia',
] as const;
export type Tipo = (typeof TIPOS)[number];

export const COMPORTAMENTOS = [
  'responder',
  'pedir_contexto',
  'recusar_sem_evidencia',
  'alertar_jurisdicao',
  'alertar_habilitacao',
] as const;
export type Comportamento = (typeof COMPORTAMENTOS)[number];

// Mesmos valores de NoticeType (backend/src/normative/question-notices.ts).
export const AVISOS = ['jurisdicao', 'profissional_habilitado', 'contexto'] as const;
export type AvisoTipo = (typeof AVISOS)[number];

export const RISCOS = ['baixo', 'medio', 'alto'] as const;
export type Risco = (typeof RISCOS)[number];

// A jurisdição A QUE A PERGUNTA SE REFERE — não a das fontes disponíveis
// (hoje só há fonte federal; é justamente o que as perguntas jurisdicionais
// expõem).
export const JURISDICOES = ['federal', 'estadual', 'municipal'] as const;
export type Jurisdicao = (typeof JURISDICOES)[number];

export const STATUS = ['rascunho', 'validado'] as const;
export type Status = (typeof STATUS)[number];

export interface FonteEsperada {
  // 'checklist' fica reservado para a segunda leva do dataset (spec §3.7) e
  // é rejeitado por enquanto.
  fonte: 'norma';
  source_code: string;
  item: string;
  // Trecho LITERAL do PDF vigente; começa pelo número do item.
  evidencia: string;
}

export interface GoldenQuestion {
  id: string;
  tipo: Tipo;
  categoria: string;
  subcategoria: string;
  pergunta: string;
  resposta_esperada: string;
  comportamento_esperado: Comportamento;
  fontes_esperadas: FonteEsperada[];
  avisos_esperados: AvisoTipo[];
  proibido_regex?: string[];
  jurisdicao: Jurisdicao;
  risco_resposta: Risco;
  // Preenchidos por `eval:lint --write` (hash do documento vigente e data).
  versao_fonte: string | null;
  data_verificacao: string | null;
  status: Status;
  gerado_por: string;
  validado_por: string | null;
  validado_em: string | null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

// Devolve a lista de problemas do registro; lista vazia = válido.
export function validateGoldenQuestion(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return ['registro não é um objeto'];
  }
  const q = raw as Record<string, unknown>;
  const errors: string[] = [];

  for (const field of ['id', 'categoria', 'subcategoria', 'pergunta', 'resposta_esperada', 'gerado_por']) {
    if (!isNonEmptyString(q[field])) errors.push(`${field}: texto obrigatório`);
  }
  if (isNonEmptyString(q.id) && !/^[A-Z0-9]+-\d{3}$/.test(q.id)) {
    errors.push('id: formato esperado como NR35-001');
  }

  if (!isOneOf(TIPOS, q.tipo)) errors.push(`tipo: valor inválido (${TIPOS.join(' | ')})`);
  if (!isOneOf(COMPORTAMENTOS, q.comportamento_esperado)) {
    errors.push(`comportamento_esperado: valor inválido (${COMPORTAMENTOS.join(' | ')})`);
  }
  if (!isOneOf(RISCOS, q.risco_resposta)) errors.push(`risco_resposta: valor inválido (${RISCOS.join(' | ')})`);
  if (!isOneOf(JURISDICOES, q.jurisdicao)) errors.push(`jurisdicao: valor inválido (${JURISDICOES.join(' | ')})`);
  if (!isOneOf(STATUS, q.status)) errors.push(`status: valor inválido (${STATUS.join(' | ')})`);

  let fontesCount = 0;
  if (!Array.isArray(q.fontes_esperadas)) {
    errors.push('fontes_esperadas: deve ser uma lista');
  } else {
    fontesCount = q.fontes_esperadas.length;
    q.fontes_esperadas.forEach((fonte, index) => {
      const where = `fontes_esperadas[${index}]`;
      if (typeof fonte !== 'object' || fonte === null) {
        errors.push(`${where}: deve ser um objeto`);
        return;
      }
      const f = fonte as Record<string, unknown>;
      if (f.fonte !== 'norma') {
        errors.push(`${where}.fonte: só 'norma' é suportada (checklist fica para a segunda leva)`);
      }
      for (const field of ['source_code', 'item', 'evidencia']) {
        if (!isNonEmptyString(f[field])) errors.push(`${where}.${field}: texto obrigatório`);
      }
      if (
        isNonEmptyString(f.item) &&
        isNonEmptyString(f.evidencia) &&
        !normalizeForQuote(f.evidencia).startsWith(`${f.item} `)
      ) {
        errors.push(`${where}.evidencia: deve começar pelo número do item ("${f.item} …")`);
      }
    });
  }

  let avisos: string[] = [];
  if (!Array.isArray(q.avisos_esperados)) {
    errors.push('avisos_esperados: deve ser uma lista');
  } else {
    avisos = q.avisos_esperados as string[];
    for (const aviso of avisos) {
      if (!isOneOf(AVISOS, aviso)) errors.push(`avisos_esperados: "${String(aviso)}" inválido (${AVISOS.join(' | ')})`);
    }
  }

  const comportamento = q.comportamento_esperado;
  if (comportamento === 'responder' && fontesCount === 0) {
    errors.push('comportamento responder exige pelo menos 1 fonte esperada');
  }
  if (comportamento === 'recusar_sem_evidencia' && fontesCount > 0) {
    errors.push('comportamento recusar_sem_evidencia exige fontes_esperadas vazio');
  }
  if (comportamento === 'pedir_contexto' && !avisos.includes('contexto')) {
    errors.push("comportamento pedir_contexto exige o aviso 'contexto'");
  }
  if (comportamento === 'alertar_jurisdicao' && !avisos.includes('jurisdicao')) {
    errors.push("comportamento alertar_jurisdicao exige o aviso 'jurisdicao'");
  }
  if (comportamento === 'alertar_habilitacao' && !avisos.includes('profissional_habilitado')) {
    errors.push("comportamento alertar_habilitacao exige o aviso 'profissional_habilitado'");
  }

  if (q.proibido_regex !== undefined) {
    if (!Array.isArray(q.proibido_regex)) {
      errors.push('proibido_regex: deve ser uma lista');
    } else {
      for (const pattern of q.proibido_regex) {
        try {
          new RegExp(String(pattern), 'i');
        } catch {
          errors.push(`proibido_regex: "${String(pattern)}" não compila`);
        }
      }
    }
  }

  if (q.versao_fonte !== null && !isNonEmptyString(q.versao_fonte)) {
    errors.push('versao_fonte: texto ou null');
  }
  if (q.data_verificacao !== null && !(typeof q.data_verificacao === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.data_verificacao))) {
    errors.push('data_verificacao: YYYY-MM-DD ou null');
  }

  if (q.status === 'validado') {
    if (!isNonEmptyString(q.validado_por) || !isNonEmptyString(q.validado_em)) {
      errors.push('status validado exige validado_por e validado_em');
    }
  } else if (q.status === 'rascunho') {
    if (q.validado_por !== null || q.validado_em !== null) {
      errors.push('status rascunho exige validado_por e validado_em nulos');
    }
  }

  return errors;
}

export function validateGoldenDataset(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ['o dataset deve ser um array'];
  const errors: string[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    const id = isNonEmptyString((item as { id?: unknown } | null)?.id) ? (item as { id: string }).id : `#${index}`;
    for (const error of validateGoldenQuestion(item)) errors.push(`${id}: ${error}`);
    if (seen.has(id)) errors.push(`${id}: id duplicado`);
    seen.add(id);
  });
  return errors;
}

export function parseGoldenDataset(raw: unknown): GoldenQuestion[] {
  const errors = validateGoldenDataset(raw);
  if (errors.length > 0) {
    throw new Error(`Dataset golden inválido:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }
  return raw as GoldenQuestion[];
}

export function countByTipo(questions: GoldenQuestion[]): Record<Tipo, number> {
  const counts = Object.fromEntries(TIPOS.map((tipo) => [tipo, 0])) as Record<Tipo, number>;
  for (const q of questions) counts[q.tipo] += 1;
  return counts;
}
```

- [ ] **Step 5: Rodar e confirmar que passam**

Run: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern golden-`
Expected: PASS — 2 suítes, **32 testes** (14 de `golden-quote` + 18 de `golden-schema`).

- [ ] **Step 6: Typecheck**

Run o comando de typecheck do backend. Expected: sem saída (0 erros).

- [ ] **Step 7: Commit** (só se o usuário autorizou commits)

```bash
cd /opt/Montese
git add backend/eval/golden/quote.ts backend/eval/golden/golden-schema.ts \
  backend/test/golden-quote.unit-spec.ts backend/test/golden-schema.unit-spec.ts
git commit -m "feat: formato do dataset golden e conferência de citação literal (eval)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Métricas das Camadas A e B (módulo puro)

**Files:**
- Create: `backend/eval/metrics.ts`
- Test: `backend/test/eval-metrics.unit-spec.ts`

**Interfaces:**
- Consumes (Task 1): `GoldenQuestion`, `FonteEsperada`, `AvisoTipo`, `Comportamento`, `Status`, `Tipo` de `./golden/golden-schema`; `chunkContainsItemHeading` de `./golden/quote`.
- Produces (usadas pelas Tasks 3 e 8):
  ```ts
  export interface RetrievedChunkObs { chunk_id: string; source_code: string | null; content: string; similarity: number }
  export interface RetrievalObservation { chunks: RetrievedChunkObs[]; threshold: number; notices: AvisoTipo[] }
  export function evaluateRetrieval(q: GoldenQuestion, obs: RetrievalObservation): RetrievalResult;
  export function aggregateRetrieval(results: RetrievalResult[]): RetrievalAggregate;
  export interface AnswerObservation { answer: string | null; notices: AvisoTipo[]; retrieved: RetrievedChunkObs[]; kept_claims_chunk_ids: string[][]; claims_dropped_support: number; flagged_numbers: string[] }
  export function evaluateAnswer(q: GoldenQuestion, obs: AnswerObservation): AnswerResult;
  export function aggregateAnswer(results: AnswerResult[]): AnswerAggregate;
  export function findRegressions(baseline: ComparableResult[], current: ComparableResult[]): Regression[];
  export function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]>;
  ```

- [ ] **Step 1: Escrever o teste (falha)**

Criar `backend/test/eval-metrics.unit-spec.ts`:

```ts
import { GoldenQuestion } from '../eval/golden/golden-schema';
import {
  aggregateAnswer,
  aggregateRetrieval,
  evaluateAnswer,
  evaluateRetrieval,
  findRegressions,
  groupBy,
  RetrievedChunkObs,
} from '../eval/metrics';

function question(overrides: Partial<GoldenQuestion> = {}): GoldenQuestion {
  return {
    id: 'NR35-001',
    tipo: 'conceitual',
    categoria: 'NR-35',
    subcategoria: 'Autorização',
    pergunta: 'Quem pode realizar trabalho em altura?',
    resposta_esperada: 'Trabalhador formalmente autorizado.',
    comportamento_esperado: 'responder',
    fontes_esperadas: [
      {
        fonte: 'norma',
        source_code: 'NR-35',
        item: '35.4.1',
        evidencia: '35.4.1 Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado pela organização.',
      },
    ],
    avisos_esperados: [],
    jurisdicao: 'federal',
    risco_resposta: 'medio',
    versao_fonte: null,
    data_verificacao: null,
    status: 'rascunho',
    gerado_por: 'teste',
    validado_por: null,
    validado_em: null,
    ...overrides,
  };
}

function chunk(overrides: Partial<RetrievedChunkObs> = {}): RetrievedChunkObs {
  return {
    chunk_id: 'c1',
    source_code: 'NR-35',
    content: '35.4.1 Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado',
    similarity: 0.62,
    ...overrides,
  };
}

const THRESHOLD = 0.4;

describe('evaluateRetrieval — Camada A (unit)', () => {
  it('acerta NR e item quando um trecho acima do limiar é da NR esperada e traz o título do item', () => {
    const result = evaluateRetrieval(question(), { chunks: [chunk()], threshold: THRESHOLD, notices: [] });
    expect(result.acerto_nr).toBe(true);
    expect(result.acerto_item).toBe(true);
    expect(result.acerto_item_topk).toBe(true);
    expect(result.melhor_similaridade).toBe(0.62);
    expect(result.passou).toBe(true);
  });

  it('acerta a NR mas erra o item quando o trecho é da NR certa sem o título do item (chunk cortado)', () => {
    const cortado = chunk({ content: ' Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado' });
    const result = evaluateRetrieval(question(), { chunks: [cortado], threshold: THRESHOLD, notices: [] });
    expect(result.acerto_nr).toBe(true);
    expect(result.acerto_item).toBe(false);
    expect(result.passou).toBe(false);
  });

  it('trecho abaixo do limiar não conta no acerto com limiar, mas conta no topk', () => {
    const fraco = chunk({ similarity: 0.31 });
    const result = evaluateRetrieval(question(), { chunks: [fraco], threshold: THRESHOLD, notices: [] });
    expect(result.acerto_item).toBe(false);
    expect(result.acerto_item_topk).toBe(true);
    expect(result.passou).toBe(false);
  });

  it('trecho de outra NR com o mesmo número de item não conta', () => {
    const outraNr = chunk({ source_code: 'NR-18' });
    const result = evaluateRetrieval(question(), { chunks: [outraNr], threshold: THRESHOLD, notices: [] });
    expect(result.acerto_nr).toBe(false);
    expect(result.acerto_item).toBe(false);
  });

  it('pergunta sem fonte esperada: acertos ficam null e não reprovam por isso', () => {
    const q = question({ comportamento_esperado: 'pedir_contexto', fontes_esperadas: [], avisos_esperados: ['contexto'] });
    const result = evaluateRetrieval(q, { chunks: [], threshold: THRESHOLD, notices: ['contexto'] });
    expect(result.acerto_nr).toBeNull();
    expect(result.acerto_item).toBeNull();
    expect(result.melhor_similaridade).toBeNull();
    expect(result.passou).toBe(true);
  });

  it('avisos precisam ser exatamente os esperados: faltando ou sobrando reprova', () => {
    const q = question({ avisos_esperados: ['jurisdicao'], comportamento_esperado: 'alertar_jurisdicao', fontes_esperadas: [] });
    expect(evaluateRetrieval(q, { chunks: [], threshold: THRESHOLD, notices: [] }).avisos_ok).toBe(false);
    expect(evaluateRetrieval(q, { chunks: [], threshold: THRESHOLD, notices: ['jurisdicao', 'contexto'] }).avisos_ok).toBe(false);
    expect(evaluateRetrieval(q, { chunks: [], threshold: THRESHOLD, notices: ['jurisdicao'] }).avisos_ok).toBe(true);
  });

  it('recusa esperada: melhor similaridade acima do limiar é falso relevante e reprova', () => {
    const q = question({ comportamento_esperado: 'recusar_sem_evidencia', fontes_esperadas: [], tipo: 'sem_evidencia' });
    const relevante = evaluateRetrieval(q, { chunks: [chunk({ similarity: 0.48 })], threshold: THRESHOLD, notices: [] });
    expect(relevante.falso_relevante).toBe(true);
    expect(relevante.passou).toBe(false);
    const irrelevante = evaluateRetrieval(q, { chunks: [chunk({ similarity: 0.21 })], threshold: THRESHOLD, notices: [] });
    expect(irrelevante.falso_relevante).toBe(false);
    expect(irrelevante.passou).toBe(true);
  });

  it('falso_relevante é null para perguntas que não esperam recusa', () => {
    expect(evaluateRetrieval(question(), { chunks: [chunk()], threshold: THRESHOLD, notices: [] }).falso_relevante).toBeNull();
  });
});

describe('aggregateRetrieval (unit)', () => {
  it('conta só perguntas com fonte nos acertos e só recusas no falso relevante', () => {
    const ok = evaluateRetrieval(question(), { chunks: [chunk()], threshold: THRESHOLD, notices: [] });
    const semAcerto = evaluateRetrieval(question({ id: 'NR35-002' }), { chunks: [], threshold: THRESHOLD, notices: [] });
    const recusa = evaluateRetrieval(
      question({ id: 'GERAL-001', comportamento_esperado: 'recusar_sem_evidencia', fontes_esperadas: [], tipo: 'sem_evidencia' }),
      { chunks: [chunk({ similarity: 0.5 })], threshold: THRESHOLD, notices: [] },
    );
    expect(aggregateRetrieval([ok, semAcerto, recusa])).toEqual({
      total: 3,
      passou: 1,
      com_fontes: 2,
      acerto_nr: 1,
      acerto_item: 1,
      acerto_item_topk: 1,
      recusa_total: 1,
      falso_relevante: 1,
      avisos_ok: 3,
    });
  });
});

describe('evaluateAnswer — Camada B (unit)', () => {
  const retrieved = [chunk({ chunk_id: 'c-item' }), chunk({ chunk_id: 'c-outro', content: 'texto de outro item' })];

  it('responder passa quando responde, cita o trecho do item esperado e nada proibido aparece', () => {
    const result = evaluateAnswer(question(), {
      answer: 'O trabalho em altura exige trabalhador autorizado.',
      notices: [],
      retrieved,
      kept_claims_chunk_ids: [['c-item']],
      claims_dropped_support: 0,
      flagged_numbers: [],
    });
    expect(result.citou_item).toBe(true);
    expect(result.passou).toBe(true);
  });

  it('responder reprova quando só cita um trecho que não tem o item esperado', () => {
    const result = evaluateAnswer(question(), {
      answer: 'Resposta qualquer.',
      notices: [],
      retrieved,
      kept_claims_chunk_ids: [['c-outro']],
      claims_dropped_support: 0,
      flagged_numbers: [],
    });
    expect(result.citou_item).toBe(false);
    expect(result.passou).toBe(false);
  });

  it('responder reprova quando o Assistente recusa (resposta nula)', () => {
    const result = evaluateAnswer(question(), {
      answer: null,
      notices: [],
      retrieved,
      kept_claims_chunk_ids: [],
      claims_dropped_support: 0,
      flagged_numbers: [],
    });
    expect(result.respondeu).toBe(false);
    expect(result.passou).toBe(false);
  });

  it('proibido_regex reprova a resposta que aceita a premissa errada', () => {
    const q = question({ tipo: 'pegadinha', proibido_regex: ['sim,? todo trabalhador que usa escada'] });
    const result = evaluateAnswer(q, {
      answer: 'Sim, todo trabalhador que usa escada precisa de NR-35.',
      notices: [],
      retrieved,
      kept_claims_chunk_ids: [['c-item']],
      claims_dropped_support: 0,
      flagged_numbers: [],
    });
    expect(result.proibido_ok).toBe(false);
    expect(result.passou).toBe(false);
  });

  it('recusar_sem_evidencia passa só se a resposta é nula', () => {
    const q = question({ comportamento_esperado: 'recusar_sem_evidencia', fontes_esperadas: [], tipo: 'sem_evidencia' });
    const base = { notices: [], retrieved: [], kept_claims_chunk_ids: [], claims_dropped_support: 0, flagged_numbers: [] };
    expect(evaluateAnswer(q, { ...base, answer: null }).passou).toBe(true);
    expect(evaluateAnswer(q, { ...base, answer: 'Inventou uma resposta.' }).passou).toBe(false);
  });

  it('pedir_contexto passa quando o aviso esperado disparou e marca a lacuna de não perguntar de volta', () => {
    const q = question({ comportamento_esperado: 'pedir_contexto', fontes_esperadas: [], avisos_esperados: ['contexto'], tipo: 'contexto_incompleto' });
    const result = evaluateAnswer(q, {
      answer: 'Depende da atividade.',
      notices: ['contexto'],
      retrieved: [],
      kept_claims_chunk_ids: [],
      claims_dropped_support: 0,
      flagged_numbers: [],
    });
    expect(result.passou).toBe(true);
    expect(result.nao_pergunta_de_volta).toBe(true);
  });

  it('alertar_jurisdicao reprova quando o aviso esperado não disparou', () => {
    const q = question({ comportamento_esperado: 'alertar_jurisdicao', fontes_esperadas: [], avisos_esperados: ['jurisdicao'], tipo: 'jurisdicional' });
    const result = evaluateAnswer(q, {
      answer: null,
      notices: [],
      retrieved: [],
      kept_claims_chunk_ids: [],
      claims_dropped_support: 0,
      flagged_numbers: [],
    });
    expect(result.avisos_ok).toBe(false);
    expect(result.passou).toBe(false);
  });

  it('registra claims descartadas por suporte e números sinalizados sem usá-los como critério', () => {
    const result = evaluateAnswer(question(), {
      answer: 'Resposta.',
      notices: [],
      retrieved,
      kept_claims_chunk_ids: [['c-item']],
      claims_dropped_support: 2,
      flagged_numbers: ['8 horas', '30 dias'],
    });
    expect(result.claims_dropped_support).toBe(2);
    expect(result.flagged_numbers).toBe(2);
    expect(result.passou).toBe(true);
  });
});

describe('aggregateAnswer (unit)', () => {
  it('soma as contagens', () => {
    const base = { notices: [], retrieved: [chunk({ chunk_id: 'c-item' })], claims_dropped_support: 1, flagged_numbers: ['8 horas'] };
    const a = evaluateAnswer(question(), { ...base, answer: 'ok', kept_claims_chunk_ids: [['c-item']] });
    const b = evaluateAnswer(question({ id: 'NR35-002' }), { ...base, answer: null, kept_claims_chunk_ids: [] });
    expect(aggregateAnswer([a, b])).toEqual({
      total: 2,
      passou: 1,
      responderam: 1,
      com_fontes: 2,
      citaram_item: 1,
      claims_descartadas_por_suporte: 2,
      numeros_sinalizados: 2,
    });
  });
});

describe('findRegressions / groupBy (unit)', () => {
  it('regressão = validado que passava e deixou de passar', () => {
    const baseline = [
      { id: 'A', status: 'validado' as const, passou: true },
      { id: 'B', status: 'validado' as const, passou: true },
      { id: 'C', status: 'validado' as const, passou: false },
      { id: 'D', status: 'rascunho' as const, passou: true },
    ];
    const current = [
      { id: 'A', status: 'validado' as const, passou: true },
      { id: 'B', status: 'validado' as const, passou: false },
      { id: 'C', status: 'validado' as const, passou: false },
      { id: 'D', status: 'rascunho' as const, passou: false },
      { id: 'E', status: 'validado' as const, passou: false },
    ];
    expect(findRegressions(baseline, current)).toEqual([{ id: 'B', motivo: 'passava no baseline e deixou de passar' }]);
  });

  it('pergunta removida do dataset não é regressão', () => {
    expect(findRegressions([{ id: 'A', status: 'validado', passou: true }], [])).toEqual([]);
  });

  it('groupBy agrupa por chave', () => {
    expect(groupBy([1, 2, 3, 4], (n) => (n % 2 === 0 ? 'par' : 'impar'))).toEqual({ par: [2, 4], impar: [1, 3] });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern eval-metrics`
Expected: FAIL — `Cannot find module '../eval/metrics'`.

- [ ] **Step 3: Implementar**

Criar `backend/eval/metrics.ts`:

```ts
// Métricas do runner de avaliação (Etapas 2 e 3 da Confiabilidade do
// Assistente, spec docs/specs/assistente-confiabilidade-etapa-2-3.md §5).
// Módulo puro: recebe observações já coletadas do pipeline e devolve
// resultados — sem I/O, sem NestJS, sem LLM.
import { AvisoTipo, Comportamento, FonteEsperada, GoldenQuestion, Status, Tipo } from './golden/golden-schema';
import { chunkContainsItemHeading } from './golden/quote';

export interface RetrievedChunkObs {
  chunk_id: string;
  source_code: string | null;
  content: string;
  similarity: number;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

function isSubset(expected: readonly string[], detected: readonly string[]): boolean {
  return expected.every((value) => detected.includes(value));
}

function chunkMatchesFonte(chunk: RetrievedChunkObs, fonte: FonteEsperada): boolean {
  return chunk.source_code === fonte.source_code && chunkContainsItemHeading(chunk.content, fonte.item);
}

function anyItemHit(chunks: RetrievedChunkObs[], fontes: FonteEsperada[]): boolean {
  return chunks.some((chunk) => fontes.some((fonte) => chunkMatchesFonte(chunk, fonte)));
}

function anyNrHit(chunks: RetrievedChunkObs[], fontes: FonteEsperada[]): boolean {
  return chunks.some((chunk) => fontes.some((fonte) => chunk.source_code === fonte.source_code));
}

// ---------------------------------------------------------------------
// Camada A — recuperação e avisos (sem LLM de resposta)
// ---------------------------------------------------------------------

export interface RetrievalObservation {
  // Os candidatos do topo (chunk_limit), INCLUSIVE os abaixo do limiar.
  chunks: RetrievedChunkObs[];
  threshold: number;
  notices: AvisoTipo[];
}

export interface RetrievalResult {
  id: string;
  tipo: Tipo;
  status: Status;
  // null = não se aplica (pergunta sem fonte esperada). Os acertos "com
  // limiar" consideram só o que chegaria ao LLM (similaridade >= limiar);
  // `acerto_item_topk` ignora o limiar e diagnostica se a falha é da busca
  // ou do corte.
  acerto_nr: boolean | null;
  acerto_item: boolean | null;
  acerto_item_topk: boolean | null;
  melhor_similaridade: number | null;
  falso_relevante: boolean | null;
  avisos_esperados: AvisoTipo[];
  avisos_detectados: AvisoTipo[];
  avisos_ok: boolean;
  passou: boolean;
}

export function evaluateRetrieval(q: GoldenQuestion, obs: RetrievalObservation): RetrievalResult {
  const passed = obs.chunks.filter((chunk) => chunk.similarity >= obs.threshold);
  const temFontes = q.fontes_esperadas.length > 0;
  const melhor = obs.chunks.length > 0 ? Math.max(...obs.chunks.map((chunk) => chunk.similarity)) : null;

  const acertoNr = temFontes ? anyNrHit(passed, q.fontes_esperadas) : null;
  const acertoItem = temFontes ? anyItemHit(passed, q.fontes_esperadas) : null;
  const acertoItemTopk = temFontes ? anyItemHit(obs.chunks, q.fontes_esperadas) : null;

  const falsoRelevante =
    q.comportamento_esperado === 'recusar_sem_evidencia' ? melhor !== null && melhor >= obs.threshold : null;

  const avisosOk = sameSet(q.avisos_esperados, obs.notices);

  return {
    id: q.id,
    tipo: q.tipo,
    status: q.status,
    acerto_nr: acertoNr,
    acerto_item: acertoItem,
    acerto_item_topk: acertoItemTopk,
    melhor_similaridade: melhor,
    falso_relevante: falsoRelevante,
    avisos_esperados: q.avisos_esperados,
    avisos_detectados: obs.notices,
    avisos_ok: avisosOk,
    passou: (!temFontes || acertoItem === true) && avisosOk && falsoRelevante !== true,
  };
}

export interface RetrievalAggregate {
  total: number;
  passou: number;
  com_fontes: number;
  acerto_nr: number;
  acerto_item: number;
  acerto_item_topk: number;
  recusa_total: number;
  falso_relevante: number;
  avisos_ok: number;
}

export function aggregateRetrieval(results: RetrievalResult[]): RetrievalAggregate {
  const comFontes = results.filter((r) => r.acerto_item !== null);
  const recusas = results.filter((r) => r.falso_relevante !== null);
  return {
    total: results.length,
    passou: results.filter((r) => r.passou).length,
    com_fontes: comFontes.length,
    acerto_nr: comFontes.filter((r) => r.acerto_nr === true).length,
    acerto_item: comFontes.filter((r) => r.acerto_item === true).length,
    acerto_item_topk: comFontes.filter((r) => r.acerto_item_topk === true).length,
    recusa_total: recusas.length,
    falso_relevante: recusas.filter((r) => r.falso_relevante === true).length,
    avisos_ok: results.filter((r) => r.avisos_ok).length,
  };
}

// ---------------------------------------------------------------------
// Camada B — resposta real (LLM, só com --llm)
// ---------------------------------------------------------------------

export interface AnswerObservation {
  answer: string | null;
  notices: AvisoTipo[];
  // Trechos normativos recuperados (com o conteúdo, para achar o item).
  retrieved: RetrievedChunkObs[];
  // Ids de trecho citados por cada claim que SOBREVIVEU ao verificador.
  kept_claims_chunk_ids: string[][];
  claims_dropped_support: number;
  flagged_numbers: string[];
}

export interface AnswerResult {
  id: string;
  tipo: Tipo;
  status: Status;
  comportamento: Comportamento;
  respondeu: boolean;
  // null = pergunta sem fonte esperada.
  citou_item: boolean | null;
  // Os avisos esperados estão contidos nos detectados.
  avisos_ok: boolean;
  proibido_ok: boolean;
  claims_dropped_support: number;
  flagged_numbers: number;
  // O sistema ainda não pergunta de volta: em pedir_contexto isto é uma
  // lacuna informativa, não motivo de reprovação.
  nao_pergunta_de_volta: boolean;
  passou: boolean;
}

export function evaluateAnswer(q: GoldenQuestion, obs: AnswerObservation): AnswerResult {
  const respondeu = obs.answer !== null && obs.answer.trim() !== '';
  const proibidoOk = !(q.proibido_regex ?? []).some((pattern) => new RegExp(pattern, 'i').test(obs.answer ?? ''));
  const avisosOk = isSubset(q.avisos_esperados, obs.notices);

  let citouItem: boolean | null = null;
  if (q.fontes_esperadas.length > 0) {
    const esperados = new Set(
      obs.retrieved
        .filter((chunk) => q.fontes_esperadas.some((fonte) => chunkMatchesFonte(chunk, fonte)))
        .map((chunk) => chunk.chunk_id),
    );
    citouItem = obs.kept_claims_chunk_ids.some((ids) => ids.some((id) => esperados.has(id)));
  }

  let passou: boolean;
  switch (q.comportamento_esperado) {
    case 'responder':
      passou = respondeu && citouItem === true && proibidoOk;
      break;
    case 'recusar_sem_evidencia':
      passou = !respondeu;
      break;
    default:
      passou = avisosOk && proibidoOk;
  }

  return {
    id: q.id,
    tipo: q.tipo,
    status: q.status,
    comportamento: q.comportamento_esperado,
    respondeu,
    citou_item: citouItem,
    avisos_ok: avisosOk,
    proibido_ok: proibidoOk,
    claims_dropped_support: obs.claims_dropped_support,
    flagged_numbers: obs.flagged_numbers.length,
    nao_pergunta_de_volta: q.comportamento_esperado === 'pedir_contexto',
    passou,
  };
}

export interface AnswerAggregate {
  total: number;
  passou: number;
  responderam: number;
  com_fontes: number;
  citaram_item: number;
  claims_descartadas_por_suporte: number;
  numeros_sinalizados: number;
}

export function aggregateAnswer(results: AnswerResult[]): AnswerAggregate {
  const comFontes = results.filter((r) => r.citou_item !== null);
  return {
    total: results.length,
    passou: results.filter((r) => r.passou).length,
    responderam: results.filter((r) => r.respondeu).length,
    com_fontes: comFontes.length,
    citaram_item: comFontes.filter((r) => r.citou_item === true).length,
    claims_descartadas_por_suporte: results.reduce((sum, r) => sum + r.claims_dropped_support, 0),
    numeros_sinalizados: results.reduce((sum, r) => sum + r.flagged_numbers, 0),
  };
}

// ---------------------------------------------------------------------
// Baseline e gate de regressão
// ---------------------------------------------------------------------

export interface ComparableResult {
  id: string;
  status: Status;
  passou: boolean;
}

export interface Regression {
  id: string;
  motivo: string;
}

// Regressão = pergunta `validado` que PASSAVA no baseline e deixou de
// passar. Pergunta nova (sem par no baseline), removida ou ainda rascunho
// nunca é regressão.
export function findRegressions(baseline: ComparableResult[], current: ComparableResult[]): Regression[] {
  const before = new Map(baseline.map((result) => [result.id, result]));
  const regressions: Regression[] = [];
  for (const now of current) {
    const prev = before.get(now.id);
    if (now.status === 'validado' && prev?.passou === true && !now.passou) {
      regressions.push({ id: now.id, motivo: 'passava no baseline e deixou de passar' });
    }
  }
  return regressions;
}

export function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    (groups[key(item)] ??= []).push(item);
  }
  return groups;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern eval-metrics`
Expected: PASS — **21 testes**.

- [ ] **Step 5: Typecheck** — comando de typecheck do backend; 0 erros.

- [ ] **Step 6: Commit** (só se o usuário autorizou commits)

```bash
cd /opt/Montese
git add backend/eval/metrics.ts backend/test/eval-metrics.unit-spec.ts
git commit -m "feat: métricas das camadas A e B do runner de avaliação (eval)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Módulos puros de apoio ao runner

**Files:**
- Create: `backend/eval/args.ts`, `backend/eval/llm-plan.ts`, `backend/eval/golden/nr-blocks.ts`, `backend/eval/report.ts`, `backend/eval/usage-summary.ts`
- Test: `backend/test/eval-args.unit-spec.ts`, `backend/test/eval-report.unit-spec.ts`, `backend/test/eval-usage-summary.unit-spec.ts`

**Interfaces:**
- Consumes (Tasks 1–2): `GoldenQuestion`, `TIPOS`; `normalizeForQuote`; os tipos e agregadores de `./metrics`.
- Produces (usadas pelas Tasks 4 e 8):
  ```ts
  export interface EvalArgs { tipos: string[]; ids: string[]; out: string | null; compare: string | null; file: string | null; grep: string | null; llm: boolean; maxLlmCalls: number; allowFull: boolean; failOnRegression: boolean; write: boolean; days: number; positional: string[] }
  export function parseEvalArgs(argv: string[]): EvalArgs;            // DEFAULT_MAX_LLM_CALLS = 15
  export function planLlmRun(args: EvalArgs, selected: GoldenQuestion[]): { questions: GoldenQuestion[]; estimatedTokens: number };
  export function sampleByTipo(questions: GoldenQuestion[], n: number): GoldenQuestion[];
  export function splitIntoItemBlocks(rawText: string): { item: string; text: string }[];
  export function blocksWithPrefix(blocks: ItemBlock[], prefix: string): ItemBlock[];
  export function blocksContaining(blocks: ItemBlock[], term: string): ItemBlock[];
  export function buildRetrievalBaseline(meta: BaselineMeta, results: RetrievalResult[]): BaselineFile<…>;
  export function buildAnswerBaseline(meta: BaselineMeta, results: AnswerResult[]): BaselineFile<…>;
  export function formatRetrievalSummary(b): string;  export function formatAnswerSummary(b): string;
  export function renderReviewMarkdown(items: ReviewItem[]): string;  export function datasetHash(json: string): string;
  export function summarizeUsage(rows: UsageRow[]): UsageSummary;
  ```

- [ ] **Step 1: Escrever os testes (falham)**

Criar `backend/test/eval-args.unit-spec.ts`:

```ts
import { DEFAULT_MAX_LLM_CALLS, parseEvalArgs } from '../eval/args';
import { GoldenQuestion, TIPOS } from '../eval/golden/golden-schema';
import { ESTIMATED_TOKENS_PER_CALL, planLlmRun, sampleByTipo } from '../eval/llm-plan';

function question(id: string, tipo: GoldenQuestion['tipo']): GoldenQuestion {
  return {
    id,
    tipo,
    categoria: 'NR-01',
    subcategoria: 'x',
    pergunta: 'p',
    resposta_esperada: 'r',
    comportamento_esperado: 'recusar_sem_evidencia',
    fontes_esperadas: [],
    avisos_esperados: [],
    jurisdicao: 'federal',
    risco_resposta: 'baixo',
    versao_fonte: null,
    data_verificacao: null,
    status: 'rascunho',
    gerado_por: 't',
    validado_por: null,
    validado_em: null,
  };
}

describe('parseEvalArgs (unit)', () => {
  it('sem argumentos devolve os padrões seguros', () => {
    const args = parseEvalArgs([]);
    expect(args.llm).toBe(false);
    expect(args.allowFull).toBe(false);
    expect(args.failOnRegression).toBe(false);
    expect(args.maxLlmCalls).toBe(DEFAULT_MAX_LLM_CALLS);
    expect(args.days).toBe(30);
    expect(args.tipos).toEqual([]);
    expect(args.out).toBeNull();
    expect(args.grep).toBeNull();
  });

  it('lê flags com valor, listas separadas por vírgula e flags booleanas', () => {
    const args = parseEvalArgs([
      '--tipo', 'pegadinha,jurisdicional',
      '--ids', 'NR35-001, NR06-002',
      '--out', 'backend/eval/baselines/x.json',
      '--compare', 'backend/eval/baselines/y.json',
      '--llm', '--allow-full', '--fail-on-regression', '--write',
      '--max-llm-calls', '5', '--days', '7',
    ]);
    expect(args.tipos).toEqual(['pegadinha', 'jurisdicional']);
    expect(args.ids).toEqual(['NR35-001', 'NR06-002']);
    expect(args.out).toBe('backend/eval/baselines/x.json');
    expect(args.compare).toBe('backend/eval/baselines/y.json');
    expect([args.llm, args.allowFull, args.failOnRegression, args.write]).toEqual([true, true, true, true]);
    expect(args.maxLlmCalls).toBe(5);
    expect(args.days).toBe(7);
  });

  it('argumentos posicionais são preservados (eval:nr NR-35 35.4)', () => {
    expect(parseEvalArgs(['NR-35', '35.4']).positional).toEqual(['NR-35', '35.4']);
  });

  it('--grep recebe o termo e convive com os posicionais', () => {
    const args = parseEvalArgs(['NR-35', '--grep', 'altura']);
    expect(args.positional).toEqual(['NR-35']);
    expect(args.grep).toBe('altura');
  });

  it('rejeita flag desconhecida, flag sem valor e número inválido', () => {
    expect(() => parseEvalArgs(['--foo'])).toThrow('Flag desconhecida: --foo');
    expect(() => parseEvalArgs(['--out'])).toThrow('--out exige um valor');
    expect(() => parseEvalArgs(['--out', '--llm'])).toThrow('--out exige um valor');
    expect(() => parseEvalArgs(['--max-llm-calls', '0'])).toThrow('inteiro positivo');
    expect(() => parseEvalArgs(['--days', 'abc'])).toThrow('inteiro positivo');
  });
});

describe('sampleByTipo / planLlmRun (unit)', () => {
  const dataset = [
    question('A-001', 'conceitual'),
    question('A-002', 'conceitual'),
    question('B-001', 'pegadinha'),
    question('B-002', 'pegadinha'),
    question('C-001', 'sem_evidencia'),
  ];

  it('amostra cobre um de cada tipo por rodada, na ordem do dataset', () => {
    expect(sampleByTipo(dataset, 3).map((q) => q.id)).toEqual(['A-001', 'B-001', 'C-001']);
    expect(sampleByTipo(dataset, 4).map((q) => q.id)).toEqual(['A-001', 'B-001', 'C-001', 'A-002']);
  });

  it('amostra maior ou igual ao dataset devolve tudo', () => {
    expect(sampleByTipo(dataset, 99)).toHaveLength(5);
  });

  it('amostra usa só tipos conhecidos e não ultrapassa n', () => {
    const all = TIPOS.flatMap((tipo, i) => [question(`T${i}-001`, tipo), question(`T${i}-002`, tipo)]);
    const sample = sampleByTipo(all, 10);
    expect(sample).toHaveLength(10);
    expect(new Set(sample.slice(0, 8).map((q) => q.tipo)).size).toBe(8);
  });

  it('sem --llm o plano recusa: chamada de LLM é paga e tem que ser explícita', () => {
    expect(() => planLlmRun(parseEvalArgs([]), dataset)).toThrow('rode com --llm');
  });

  it('com --llm roda só o teto (padrão 15) e estima os tokens', () => {
    const many = Array.from({ length: 30 }, (_, i) => question(`X-${String(i).padStart(3, '0')}`, 'conceitual'));
    const plan = planLlmRun(parseEvalArgs(['--llm']), many);
    expect(plan.questions).toHaveLength(15);
    expect(plan.estimatedTokens).toBe(15 * ESTIMATED_TOKENS_PER_CALL);
  });

  it('--max-llm-calls ajusta o teto e --allow-full remove o teto', () => {
    const many = Array.from({ length: 30 }, (_, i) => question(`X-${String(i).padStart(3, '0')}`, 'conceitual'));
    expect(planLlmRun(parseEvalArgs(['--llm', '--max-llm-calls', '4']), many).questions).toHaveLength(4);
    expect(planLlmRun(parseEvalArgs(['--llm', '--allow-full']), many).questions).toHaveLength(30);
  });
});
```

Criar `backend/test/eval-report.unit-spec.ts`:

```ts
import { blocksContaining, blocksWithPrefix, splitIntoItemBlocks } from '../eval/golden/nr-blocks';
import { AnswerResult, RetrievalResult } from '../eval/metrics';
import {
  BaselineMeta,
  buildAnswerBaseline,
  buildRetrievalBaseline,
  datasetHash,
  formatAnswerSummary,
  formatRetrievalSummary,
  ratio,
  renderReviewMarkdown,
} from '../eval/report';

const NR35_TEXT = [
  'Sumário',
  '35.4 Capacitação e treinamento',
  '35.4.1 Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado pela',
  'organização.',
  '35.4.1.1 Considera-se trabalhador autorizado para trabalho em altura aquele capacitado cujo',
  'estado de saúde foi avaliado.',
  'a) as atividades que serão desenvolvidas pelo trabalhador;',
  '35.5.1 Outro assunto qualquer da norma.',
].join('\n');

describe('splitIntoItemBlocks / blocksWithPrefix (unit)', () => {
  it('cada bloco começa numa linha com número de item e junta as continuações e alíneas', () => {
    const blocks = splitIntoItemBlocks(NR35_TEXT);
    expect(blocks.map((b) => b.item)).toEqual(['35.4', '35.4.1', '35.4.1.1', '35.5.1']);
    expect(blocks[1].text).toBe(
      '35.4.1 Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado pela organização.',
    );
    expect(blocks[2].text).toContain('estado de saúde foi avaliado. a) as atividades que serão desenvolvidas pelo trabalhador;');
  });

  it('o texto antes do primeiro item ("Sumário") é descartado', () => {
    expect(splitIntoItemBlocks(NR35_TEXT).some((b) => b.text.includes('Sumário'))).toBe(false);
  });

  it('a linha do sumário vira um bloco curto, distinguível do item de verdade', () => {
    const [sumario, item] = splitIntoItemBlocks(NR35_TEXT);
    expect(sumario.text).toBe('35.4 Capacitação e treinamento');
    expect(item.text.length).toBeGreaterThan(sumario.text.length);
  });

  it('blocksWithPrefix filtra pelo item e seus descendentes, sem casar 35.4 com 35.40', () => {
    const blocks = [...splitIntoItemBlocks(NR35_TEXT), ...splitIntoItemBlocks('35.40 Item com prefixo parecido e texto longo o bastante')];
    expect(blocksWithPrefix(blocks, '35.4').map((b) => b.item)).toEqual(['35.4', '35.4.1', '35.4.1.1']);
    expect(blocksWithPrefix(blocks, '35.5').map((b) => b.item)).toEqual(['35.5.1']);
  });
});

describe('blocksContaining (unit)', () => {
  it('busca por termo sem acento e sem diferenciar maiúsculas', () => {
    const blocks = splitIntoItemBlocks(NR35_TEXT);
    expect(blocksContaining(blocks, 'ORGANIZACAO').map((b) => b.item)).toEqual(['35.4.1']);
    expect(blocksContaining(blocks, 'capacitado').map((b) => b.item)).toEqual(['35.4.1.1']);
  });

  it('termo que não aparece devolve lista vazia (é assim que se confirma a ausência de um assunto)', () => {
    expect(blocksContaining(splitIntoItemBlocks(NR35_TEXT), 'eSocial')).toEqual([]);
  });
});

const META: BaselineMeta = {
  layer: 'retrieval',
  gerado_em: '2026-09-21T12:00:00.000Z',
  commit: 'abc1234',
  dataset_sha256: 'x',
  questions: 2,
  threshold: 0.4,
  chunk_limit: 6,
  llm_calls: null,
  llm_tokens_delta: null,
};

function retrievalResult(overrides: Partial<RetrievalResult> = {}): RetrievalResult {
  return {
    id: 'NR35-001',
    tipo: 'conceitual',
    status: 'rascunho',
    acerto_nr: true,
    acerto_item: true,
    acerto_item_topk: true,
    melhor_similaridade: 0.6,
    falso_relevante: null,
    avisos_esperados: [],
    avisos_detectados: [],
    avisos_ok: true,
    passou: true,
    ...overrides,
  };
}

describe('report (unit)', () => {
  it('ratio mostra n/d e o percentual, ou traço quando não há denominador', () => {
    expect(ratio(3, 4)).toBe('3/4 (75%)');
    expect(ratio(0, 0)).toBe('0/0 (—)');
  });

  it('datasetHash é um SHA-256 estável do conteúdo', () => {
    expect(datasetHash('a')).toBe(datasetHash('a'));
    expect(datasetHash('a')).not.toBe(datasetHash('b'));
    expect(datasetHash('a')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('baseline da Camada A separa geral, validado, rascunho e por tipo', () => {
    const baseline = buildRetrievalBaseline(META, [
      retrievalResult(),
      retrievalResult({ id: 'NR35-002', tipo: 'pegadinha', status: 'validado', passou: false, acerto_item: false }),
    ]);
    expect(baseline.agregados.geral.total).toBe(2);
    expect(baseline.agregados.validado.total).toBe(1);
    expect(baseline.agregados.validado.passou).toBe(0);
    expect(baseline.agregados.rascunho.passou).toBe(1);
    expect(Object.keys(baseline.agregados.por_tipo).sort()).toEqual(['conceitual', 'pegadinha']);
    expect(baseline.resultados).toHaveLength(2);
  });

  it('resumo da Camada A traz os números e o gate (validado) em linhas próprias', () => {
    const summary = formatRetrievalSummary(buildRetrievalBaseline(META, [retrievalResult()]));
    expect(summary).toContain('Camada A — recuperação e avisos (2 perguntas, limiar 0.4, top 6)');
    expect(summary).toContain('GERAL');
    expect(summary).toContain('validado (gate)');
    expect(summary).toContain('passou 1/1 (100%)');
    expect(summary).toContain('conceitual');
  });

  it('baseline e resumo da Camada B trazem chamadas, tokens e contagens de alucinação', () => {
    const answer: AnswerResult = {
      id: 'NR35-001',
      tipo: 'conceitual',
      status: 'rascunho',
      comportamento: 'responder',
      respondeu: true,
      citou_item: true,
      avisos_ok: true,
      proibido_ok: true,
      claims_dropped_support: 1,
      flagged_numbers: 2,
      nao_pergunta_de_volta: false,
      passou: true,
    };
    const meta = { ...META, layer: 'answer' as const, llm_calls: 1, llm_tokens_delta: 4321 };
    const summary = formatAnswerSummary(buildAnswerBaseline(meta, [answer]));
    expect(summary).toContain('1 chamadas ao LLM, tokens 4321');
    expect(summary).toContain('claims descartadas 1');
    expect(summary).toContain('números sinalizados 2');
  });
});

describe('renderReviewMarkdown (unit)', () => {
  const item = {
    id: 'NR35-001',
    tipo: 'conceitual',
    pergunta: 'Que condição o trabalhador precisa cumprir para executar trabalho em altura?',
    resposta_esperada: 'Ser formalmente autorizado pela organização.',
    answer: 'O trabalhador deve ser formalmente autorizado.',
    notices: [] as string[],
    citations: ['NR-35 - Trabalho em Altura'],
    passou: true,
  };

  it('mostra pergunta, resposta esperada e obtida lado a lado, com as fontes e a linha de revisão', () => {
    const markdown = renderReviewMarkdown([item]);
    expect(markdown).toContain('# Revisão lado a lado — Camada B');
    expect(markdown).toContain('### NR35-001 — conceitual — passou');
    expect(markdown).toContain('**Resposta esperada:** Ser formalmente autorizado pela organização.');
    expect(markdown).toContain('**Resposta obtida:** O trabalhador deve ser formalmente autorizado.');
    expect(markdown).toContain('**Fontes citadas:** NR-35 - Trabalho em Altura');
    expect(markdown).toContain('[ ] resposta correta');
  });

  it('resposta nula aparece como recusa, e pergunta que não passou fica marcada', () => {
    const markdown = renderReviewMarkdown([{ ...item, answer: null, citations: [], passou: false, notices: ['contexto'] }]);
    expect(markdown).toContain('NÃO passou');
    expect(markdown).toContain('_(o Assistente recusou: sem resposta)_');
    expect(markdown).toContain('**Avisos:** contexto');
    expect(markdown).toContain('**Fontes citadas:** —');
  });
});
```

Criar `backend/test/eval-usage-summary.unit-spec.ts`:

```ts
import { summarizeUsage, UsageRow } from '../eval/usage-summary';

function row(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    role: 'empresa',
    outcome: 'respondeu',
    notices: [],
    retrieved: [{ similarity: 0.6, passed_threshold: true }],
    claims_total: 2,
    claims_dropped_ids: 0,
    claims_dropped_support: 0,
    blocking_tokens: [],
    flagged_numbers: [],
    latency_ms: 1000,
    ...overrides,
  };
}

describe('summarizeUsage (unit)', () => {
  it('sem linhas devolve zeros e nulls, sem dividir por zero', () => {
    const summary = summarizeUsage([]);
    expect(summary.total).toBe(0);
    expect(summary.taxa_fallback).toBeNull();
    expect(summary.latencia_media_ms).toBeNull();
    expect(summary.melhor_similaridade).toEqual({ p50: null, p90: null });
    expect(summary.numeros_sinalizados_top).toEqual([]);
  });

  it('conta desfechos, papéis e avisos e calcula a taxa de fallback', () => {
    const summary = summarizeUsage([
      row(),
      row({ outcome: 'fallback_sem_evidencia', role: 'tecnico', notices: ['jurisdicao'] }),
      row({ outcome: 'fallback_claims_descartadas', notices: ['jurisdicao', 'contexto'] }),
      row(),
    ]);
    expect(summary.total).toBe(4);
    expect(summary.por_desfecho).toEqual({
      respondeu: 2,
      fallback_sem_evidencia: 1,
      fallback_claims_descartadas: 1,
    });
    expect(summary.taxa_fallback).toBe(0.5);
    expect(summary.por_papel).toEqual({ empresa: 3, tecnico: 1 });
    expect(summary.avisos).toEqual({ jurisdicao: 2, contexto: 1 });
  });

  it('percentis da melhor similaridade por linha (nearest-rank), ignorando linhas sem trecho', () => {
    const summary = summarizeUsage([
      row({ retrieved: [{ similarity: 0.2, passed_threshold: false }, { similarity: 0.3, passed_threshold: false }] }),
      row({ retrieved: [{ similarity: 0.5, passed_threshold: true }] }),
      row({ retrieved: [{ similarity: 0.7, passed_threshold: true }] }),
      row({ retrieved: [{ similarity: 0.9, passed_threshold: true }] }),
      row({ retrieved: [] }),
    ]);
    // melhores por linha, ordenadas: 0.3, 0.5, 0.7, 0.9 -> p50 = 0.5, p90 = 0.9
    expect(summary.melhor_similaridade).toEqual({ p50: 0.5, p90: 0.9 });
  });

  it('soma claims e agrega os tokens mais frequentes com desempate estável', () => {
    const summary = summarizeUsage([
      row({ claims_total: 3, claims_dropped_ids: 1, claims_dropped_support: 1, flagged_numbers: ['8 horas', '30 dias'], blocking_tokens: ['item 35.4.7'] }),
      row({ claims_total: 1, flagged_numbers: ['8 horas'] }),
    ]);
    expect(summary.claims).toEqual({ total: 4, descartadas_ids: 1, descartadas_suporte: 1 });
    expect(summary.numeros_sinalizados_top).toEqual([
      { token: '8 horas', vezes: 2 },
      { token: '30 dias', vezes: 1 },
    ]);
    expect(summary.tokens_bloqueados_top).toEqual([{ token: 'item 35.4.7', vezes: 1 }]);
  });

  it('latência média arredondada', () => {
    expect(summarizeUsage([row({ latency_ms: 1000 }), row({ latency_ms: 2001 })]).latencia_media_ms).toBe(1501);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern "eval-args|eval-report|eval-usage"`
Expected: FAIL — `Cannot find module` para `../eval/args`, `../eval/llm-plan`, `../eval/report`, `../eval/golden/nr-blocks`, `../eval/usage-summary`.

- [ ] **Step 3: Implementar `args.ts`**

Criar `backend/eval/args.ts`:

```ts
// Argumentos dos comandos eval:* (Etapas 2 e 3 da Confiabilidade do
// Assistente). Módulo puro: sem I/O.
export const DEFAULT_MAX_LLM_CALLS = 15;
const DEFAULT_USAGE_DAYS = 30;

export interface EvalArgs {
  tipos: string[];
  ids: string[];
  out: string | null;
  compare: string | null;
  file: string | null;
  grep: string | null;
  llm: boolean;
  maxLlmCalls: number;
  allowFull: boolean;
  failOnRegression: boolean;
  write: boolean;
  days: number;
  positional: string[];
}

const BOOLEAN_FLAGS = new Set(['--llm', '--allow-full', '--fail-on-regression', '--write']);
const VALUE_FLAGS = new Set(['--tipo', '--ids', '--out', '--compare', '--file', '--grep', '--max-llm-calls', '--days']);

function parsePositiveInt(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} exige um inteiro positivo (recebido "${raw}")`);
  }
  return value;
}

function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

export function parseEvalArgs(argv: string[]): EvalArgs {
  const args: EvalArgs = {
    tipos: [],
    ids: [],
    out: null,
    compare: null,
    file: null,
    grep: null,
    llm: false,
    maxLlmCalls: DEFAULT_MAX_LLM_CALLS,
    allowFull: false,
    failOnRegression: false,
    write: false,
    days: DEFAULT_USAGE_DAYS,
    positional: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args.positional.push(token);
      continue;
    }
    if (BOOLEAN_FLAGS.has(token)) {
      if (token === '--llm') args.llm = true;
      if (token === '--allow-full') args.allowFull = true;
      if (token === '--fail-on-regression') args.failOnRegression = true;
      if (token === '--write') args.write = true;
      continue;
    }
    if (!VALUE_FLAGS.has(token)) {
      throw new Error(`Flag desconhecida: ${token}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${token} exige um valor`);
    }
    i += 1;
    if (token === '--tipo') args.tipos = parseList(value);
    if (token === '--ids') args.ids = parseList(value);
    if (token === '--out') args.out = value;
    if (token === '--compare') args.compare = value;
    if (token === '--file') args.file = value;
    if (token === '--grep') args.grep = value;
    if (token === '--max-llm-calls') args.maxLlmCalls = parsePositiveInt(token, value);
    if (token === '--days') args.days = parsePositiveInt(token, value);
  }
  return args;
}
```

- [ ] **Step 4: Implementar `llm-plan.ts`**

Criar `backend/eval/llm-plan.ts`:

```ts
// Plano de custo da Camada B (chamadas reais e PAGAS ao LLM) — spec
// docs/specs/assistente-confiabilidade-etapa-2-3.md §5.3. Módulo puro.
import { GoldenQuestion, TIPOS } from './golden/golden-schema';
import { EvalArgs } from './args';

// ~4,3 mil tokens por chamada, medido no log real (27 chamadas de
// `assistant_normative_query` = 116.645 tokens em 2026-09-20).
export const ESTIMATED_TOKENS_PER_CALL = 4300;

// Amostra determinística que cobre todos os tipos: pega uma pergunta de cada
// tipo, em rodadas, na ordem em que aparecem no dataset, até completar `n`.
export function sampleByTipo(questions: GoldenQuestion[], n: number): GoldenQuestion[] {
  if (n >= questions.length) return [...questions];
  const queues = new Map(TIPOS.map((tipo) => [tipo, questions.filter((q) => q.tipo === tipo)]));
  const sample: GoldenQuestion[] = [];
  while (sample.length < n) {
    let progressed = false;
    for (const tipo of TIPOS) {
      const next = queues.get(tipo)?.shift();
      if (next) {
        sample.push(next);
        progressed = true;
        if (sample.length === n) break;
      }
    }
    if (!progressed) break;
  }
  return sample;
}

export interface LlmPlan {
  questions: GoldenQuestion[];
  estimatedTokens: number;
}

// Sem --llm não roda; com --allow-full roda todas as selecionadas; senão roda
// no máximo --max-llm-calls (padrão 15), em amostra que cobre os tipos.
export function planLlmRun(args: EvalArgs, selected: GoldenQuestion[]): LlmPlan {
  if (!args.llm) {
    throw new Error('eval:answer chama o LLM real e PAGO — rode com --llm (e, para além do teto, --allow-full)');
  }
  const questions = args.allowFull ? [...selected] : sampleByTipo(selected, args.maxLlmCalls);
  return { questions, estimatedTokens: questions.length * ESTIMATED_TOKENS_PER_CALL };
}
```

- [ ] **Step 5: Implementar `nr-blocks.ts`**

Criar `backend/eval/golden/nr-blocks.ts`:

```ts
// Ajuda de autoria do dataset golden (eval:nr): quebra o texto vigente de uma
// NR em blocos por item, para quem redige as perguntas copiar uma citação
// literal. Módulo puro: sem I/O.
import { normalizeForQuote } from './quote';

export interface ItemBlock {
  item: string;
  // Texto do bloco normalizado com a MESMA função que o lint usa; uma
  // citação copiada daqui bate por construção.
  text: string;
}

const ITEM_HEADING = /^(\d+(?:\.\d+)+)\s/;

// Um bloco começa numa linha que abre com número de item ("35.4.1 Todo…") e
// vai até a próxima linha assim. Alíneas ("a) …") e continuações de frase
// ficam no bloco anterior. As linhas do sumário viram blocos de uma linha só
// (curtos) — quem consulta vê o tamanho e distingue.
export function splitIntoItemBlocks(rawText: string): ItemBlock[] {
  const blocks: { item: string; lines: string[] }[] = [];
  for (const line of rawText.split('\n')) {
    const heading = ITEM_HEADING.exec(line);
    if (heading) {
      blocks.push({ item: heading[1], lines: [line] });
    } else if (blocks.length > 0) {
      blocks[blocks.length - 1].lines.push(line);
    }
  }
  return blocks.map((block) => ({ item: block.item, text: normalizeForQuote(block.lines.join('\n')) }));
}

export function blocksWithPrefix(blocks: ItemBlock[], prefix: string): ItemBlock[] {
  return blocks.filter((block) => block.item === prefix || block.item.startsWith(`${prefix}.`));
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// Busca por termo, sem acentos e sem diferenciar maiúsculas — serve tanto para
// achar o item que sustenta uma pergunta quanto para CONFIRMAR que a base não
// cobre um assunto (perguntas sem_evidencia).
export function blocksContaining(blocks: ItemBlock[], term: string): ItemBlock[] {
  const wanted = fold(term);
  return blocks.filter((block) => fold(block.text).includes(wanted));
}
```

- [ ] **Step 6: Implementar `report.ts`**

Criar `backend/eval/report.ts`:

```ts
// Montagem e resumo dos baselines do runner de avaliação (Etapas 2 e 3 da
// Confiabilidade do Assistente, spec docs/specs/assistente-confiabilidade-etapa-2-3.md §5.4).
// Módulo puro: sem I/O.
import { createHash } from 'crypto';
import { TIPOS } from './golden/golden-schema';
import {
  AnswerAggregate,
  AnswerResult,
  RetrievalAggregate,
  RetrievalResult,
  aggregateAnswer,
  aggregateRetrieval,
  groupBy,
} from './metrics';

export interface BaselineMeta {
  layer: 'retrieval' | 'answer';
  gerado_em: string;
  commit: string;
  dataset_sha256: string;
  questions: number;
  threshold: number | null;
  chunk_limit: number | null;
  llm_calls: number | null;
  llm_tokens_delta: number | null;
}

export interface BaselineFile<Result, Aggregate> {
  meta: BaselineMeta;
  resultados: Result[];
  agregados: {
    geral: Aggregate;
    validado: Aggregate;
    rascunho: Aggregate;
    por_tipo: Record<string, Aggregate>;
  };
}

export function datasetHash(datasetJson: string): string {
  return createHash('sha256').update(datasetJson).digest('hex');
}

function build<Result extends { tipo: string; status: string }, Aggregate>(
  meta: BaselineMeta,
  results: Result[],
  aggregate: (subset: Result[]) => Aggregate,
): BaselineFile<Result, Aggregate> {
  const porTipo = groupBy(results, (r) => r.tipo);
  return {
    meta,
    resultados: results,
    agregados: {
      geral: aggregate(results),
      validado: aggregate(results.filter((r) => r.status === 'validado')),
      rascunho: aggregate(results.filter((r) => r.status === 'rascunho')),
      por_tipo: Object.fromEntries(TIPOS.filter((tipo) => porTipo[tipo]).map((tipo) => [tipo, aggregate(porTipo[tipo])])),
    },
  };
}

export function buildRetrievalBaseline(
  meta: BaselineMeta,
  results: RetrievalResult[],
): BaselineFile<RetrievalResult, RetrievalAggregate> {
  return build(meta, results, aggregateRetrieval);
}

export function buildAnswerBaseline(
  meta: BaselineMeta,
  results: AnswerResult[],
): BaselineFile<AnswerResult, AnswerAggregate> {
  return build(meta, results, aggregateAnswer);
}

// "n/d (xx%)" — ou "—" no percentual quando não há denominador.
export function ratio(n: number, d: number): string {
  return d === 0 ? `${n}/${d} (—)` : `${n}/${d} (${Math.round((n / d) * 100)}%)`;
}

function retrievalLine(label: string, a: RetrievalAggregate): string {
  return (
    `${label.padEnd(24)} passou ${ratio(a.passou, a.total).padEnd(12)}` +
    ` acerto NR ${ratio(a.acerto_nr, a.com_fontes).padEnd(12)}` +
    ` acerto item ${ratio(a.acerto_item, a.com_fontes).padEnd(12)}` +
    ` (topk ${ratio(a.acerto_item_topk, a.com_fontes)})` +
    ` falso relevante ${ratio(a.falso_relevante, a.recusa_total)}` +
    ` avisos ok ${ratio(a.avisos_ok, a.total)}`
  );
}

function answerLine(label: string, a: AnswerAggregate): string {
  return (
    `${label.padEnd(24)} passou ${ratio(a.passou, a.total).padEnd(12)}` +
    ` responderam ${ratio(a.responderam, a.total).padEnd(12)}` +
    ` citaram item ${ratio(a.citaram_item, a.com_fontes).padEnd(12)}` +
    ` claims descartadas ${a.claims_descartadas_por_suporte}` +
    ` números sinalizados ${a.numeros_sinalizados}`
  );
}

export function formatRetrievalSummary(baseline: BaselineFile<RetrievalResult, RetrievalAggregate>): string {
  const { agregados } = baseline;
  const lines = [
    `Camada A — recuperação e avisos (${baseline.meta.questions} perguntas, limiar ${baseline.meta.threshold}, top ${baseline.meta.chunk_limit})`,
    retrievalLine('GERAL', agregados.geral),
    retrievalLine('  validado (gate)', agregados.validado),
    retrievalLine('  rascunho', agregados.rascunho),
    ...Object.entries(agregados.por_tipo).map(([tipo, a]) => retrievalLine(`  ${tipo}`, a)),
  ];
  return lines.join('\n');
}

export function formatAnswerSummary(baseline: BaselineFile<AnswerResult, AnswerAggregate>): string {
  const { agregados, meta } = baseline;
  const lines = [
    `Camada B — resposta real (${meta.questions} perguntas, ${meta.llm_calls ?? 0} chamadas ao LLM, tokens ${meta.llm_tokens_delta ?? 'n/d'})`,
    answerLine('GERAL', agregados.geral),
    answerLine('  validado (gate)', agregados.validado),
    answerLine('  rascunho', agregados.rascunho),
    ...Object.entries(agregados.por_tipo).map(([tipo, a]) => answerLine(`  ${tipo}`, a)),
  ];
  return lines.join('\n');
}

export interface ReviewItem {
  id: string;
  tipo: string;
  pergunta: string;
  resposta_esperada: string;
  // null = o Assistente recusou (fallback).
  answer: string | null;
  notices: string[];
  citations: string[];
  passou: boolean;
}

// Markdown lado a lado para o profissional de SST validar as perguntas: a
// métrica não julga a semântica da prosa, então quem revisa vê a resposta
// esperada e a obtida juntas (spec §5.3).
export function renderReviewMarkdown(items: ReviewItem[]): string {
  const blocks = items.map((item) =>
    [
      `### ${item.id} — ${item.tipo} — ${item.passou ? 'passou' : 'NÃO passou'}`,
      '',
      `**Pergunta:** ${item.pergunta}`,
      '',
      `**Resposta esperada:** ${item.resposta_esperada}`,
      '',
      `**Resposta obtida:** ${item.answer ?? '_(o Assistente recusou: sem resposta)_'}`,
      '',
      `**Avisos:** ${item.notices.length > 0 ? item.notices.join(', ') : '—'}`,
      '',
      `**Fontes citadas:** ${item.citations.length > 0 ? item.citations.join('; ') : '—'}`,
      '',
      'Revisão: [ ] resposta correta  [ ] incompleta  [ ] errada — Observações:',
      '',
    ].join('\n'),
  );
  return `# Revisão lado a lado — Camada B\n\n${blocks.join('\n')}`;
}
```

- [ ] **Step 7: Implementar `usage-summary.ts`**

Criar `backend/eval/usage-summary.ts`:

```ts
// Resumo do log de uso real do Assistente (Etapas 2 e 3 da Confiabilidade
// do Assistente, spec docs/specs/assistente-confiabilidade-etapa-2-3.md
// §4.5). Módulo puro: agrega linhas já lidas de assistant_query_log.
export interface UsageRow {
  role: string;
  outcome: string;
  notices: string[];
  retrieved: { similarity: number; passed_threshold: boolean }[];
  claims_total: number;
  claims_dropped_ids: number;
  claims_dropped_support: number;
  blocking_tokens: string[];
  flagged_numbers: string[];
  latency_ms: number;
}

export interface UsageSummary {
  total: number;
  por_desfecho: Record<string, number>;
  // fallback_* / total; null sem linhas.
  taxa_fallback: number | null;
  por_papel: Record<string, number>;
  avisos: Record<string, number>;
  melhor_similaridade: { p50: number | null; p90: number | null };
  claims: { total: number; descartadas_ids: number; descartadas_suporte: number };
  numeros_sinalizados_top: { token: string; vezes: number }[];
  tokens_bloqueados_top: { token: string; vezes: number }[];
  latencia_media_ms: number | null;
}

function count(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function top(values: string[], limit: number): { token: string; vezes: number }[] {
  return Object.entries(count(values))
    .map(([token, vezes]) => ({ token, vezes }))
    .sort((a, b) => b.vezes - a.vezes || a.token.localeCompare(b.token))
    .slice(0, limit);
}

// Nearest-rank sobre a lista já ordenada.
function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(sortedAsc.length, Math.max(1, rank)) - 1];
}

export function summarizeUsage(rows: UsageRow[]): UsageSummary {
  const best = rows
    .filter((row) => row.retrieved.length > 0)
    .map((row) => Math.max(...row.retrieved.map((chunk) => chunk.similarity)))
    .sort((a, b) => a - b);
  const fallbacks = rows.filter((row) => row.outcome.startsWith('fallback')).length;

  return {
    total: rows.length,
    por_desfecho: count(rows.map((row) => row.outcome)),
    taxa_fallback: rows.length > 0 ? fallbacks / rows.length : null,
    por_papel: count(rows.map((row) => row.role)),
    avisos: count(rows.flatMap((row) => row.notices)),
    melhor_similaridade: { p50: percentile(best, 50), p90: percentile(best, 90) },
    claims: {
      total: rows.reduce((sum, row) => sum + row.claims_total, 0),
      descartadas_ids: rows.reduce((sum, row) => sum + row.claims_dropped_ids, 0),
      descartadas_suporte: rows.reduce((sum, row) => sum + row.claims_dropped_support, 0),
    },
    numeros_sinalizados_top: top(rows.flatMap((row) => row.flagged_numbers), 10),
    tokens_bloqueados_top: top(rows.flatMap((row) => row.blocking_tokens), 10),
    latencia_media_ms:
      rows.length > 0 ? Math.round(rows.reduce((sum, row) => sum + row.latency_ms, 0) / rows.length) : null,
  };
}
```

- [ ] **Step 8: Rodar e confirmar que passam**

Run: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern "eval-|golden-"`
Expected: PASS — 6 suítes (`eval-args` 11 · `eval-report` 13 · `eval-usage-summary` 5 · `eval-metrics` 21 · `golden-quote` 14 · `golden-schema` 18) = **82 testes**.

- [ ] **Step 9: Typecheck** — comando de typecheck do backend; 0 erros.

- [ ] **Step 10: Commit** (só se o usuário autorizou commits)

```bash
cd /opt/Montese
git add backend/eval/args.ts backend/eval/llm-plan.ts backend/eval/golden/nr-blocks.ts backend/eval/report.ts backend/eval/usage-summary.ts \
  backend/test/eval-args.unit-spec.ts backend/test/eval-report.unit-spec.ts backend/test/eval-usage-summary.unit-spec.ts
git commit -m "feat: apoio puro ao runner — argumentos, teto da camada B, baselines, resumo de uso (eval)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Scripts de leitura do banco — `eval:lint`, `eval:nr`, `eval:notices`

**Files:**
- Create: `backend/eval/lint-golden.ts`, `backend/eval/nr-text.ts`, `backend/eval/notices-check.ts`
- Modify: `backend/package.json` (scripts)

**Interfaces:**
- Consumes (Tasks 1 e 3): `parseEvalArgs`, `checkEvidence`, `validateGoldenDataset`, `splitIntoItemBlocks`, `blocksWithPrefix`, `blocksContaining`, `parseGoldenDataset`; `detectNotices` de `../src/normative/question-notices`.
- Produces: comandos `eval:lint`, `eval:nr`, `eval:notices`, usados na autoria (Task 5) e na verificação.

- [ ] **Step 1: Criar `lint-golden.ts`**

```ts
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { parseEvalArgs } from './args';
import { checkEvidence } from './golden/quote';
import { GoldenQuestion, validateGoldenDataset } from './golden/golden-schema';

// eval:lint — confere, por código, que cada `evidencia` do dataset golden existe
// LITERALMENTE no texto vigente da NR indicada (spec
// docs/specs/assistente-confiabilidade-etapa-2-3.md §3.5). Só LÊ o banco.
// Com --write, grava versao_fonte (hash do documento vigente) e
// data_verificacao — e só se o dataset inteiro estiver sem erro.
//
// Uso: ./run-backend-tests.sh eval:lint [-- --file caminho.json] [-- --write]
const DEFAULT_FILE = join(__dirname, 'golden', 'perguntas.json');

interface VigenteDocument {
  source_code: string;
  content_hash: string;
  raw_text: string;
}

async function main() {
  const args = parseEvalArgs(process.argv.slice(2));
  const file = args.file ?? DEFAULT_FILE;
  const raw = JSON.parse(readFileSync(file, 'utf8'));

  const schemaErrors = validateGoldenDataset(raw);
  if (schemaErrors.length > 0) {
    console.error(`[eval:lint] schema inválido em ${file}:`);
    for (const error of schemaErrors) console.error(`  - ${error}`);
    process.exit(1);
  }
  const questions = raw as GoldenQuestion[];

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query<VigenteDocument>(
    `SELECT s.code AS source_code, d.content_hash, d.raw_text
     FROM normative_documents d
     JOIN official_sources s ON s.id = d.source_id
     WHERE d.status = 'vigente'`,
  );
  await client.end();
  const vigentes = new Map(rows.map((row) => [row.source_code, row]));

  const today = new Date().toISOString().slice(0, 10);
  let errors = 0;
  let checked = 0;
  for (const q of questions) {
    const hashes = new Set<string>();
    for (const fonte of q.fontes_esperadas) {
      const doc = vigentes.get(fonte.source_code);
      if (!doc) {
        console.error(`${q.id}: "${fonte.source_code}" não tem documento vigente no banco`);
        errors += 1;
        continue;
      }
      const check = checkEvidence(doc.raw_text, fonte.item, fonte.evidencia);
      checked += 1;
      if (!check.ok) {
        console.error(`${q.id}: ${fonte.source_code} ${fonte.item} — ${check.reason}`);
        errors += 1;
      } else {
        hashes.add(`${fonte.source_code}:${doc.content_hash.slice(0, 8)}`);
      }
    }
    if (args.write && hashes.size > 0) {
      q.versao_fonte = Array.from(hashes).join(',');
      q.data_verificacao = today;
    }
  }

  if (errors > 0) {
    console.error(`[eval:lint] ${errors} problema(s) em ${checked} citação(ões) — nada foi gravado`);
    process.exit(1);
  }
  if (args.write) {
    writeFileSync(file, `${JSON.stringify(questions, null, 2)}\n`);
    console.log(`[eval:lint] versao_fonte e data_verificacao gravadas em ${file}`);
  }
  console.log(`[eval:lint] OK — ${questions.length} perguntas, ${checked} citação(ões) conferida(s) contra o texto vigente`);
}

main().catch((err) => {
  console.error('[eval:lint] falhou:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Criar `nr-text.ts`**

```ts
import { Client } from 'pg';
import { parseEvalArgs } from './args';
import { blocksContaining, blocksWithPrefix, splitIntoItemBlocks } from './golden/nr-blocks';

// eval:nr — ajuda de autoria do dataset golden: imprime, já normalizados na
// MESMA forma que o eval:lint confere, os itens de uma NR. Só LÊ o banco.
//
// Uso: ./run-backend-tests.sh eval:nr -- NR-35 35.4          (itens sob um prefixo)
//      ./run-backend-tests.sh eval:nr -- NR-35 --grep altura  (itens que citam o termo)
//      ./run-backend-tests.sh eval:nr -- --grep "grau de risco" (busca em TODAS as NRs;
//        use para confirmar que a base NÃO cobre um assunto antes de escrever uma
//        pergunta sem_evidencia)
// Os itens do sumário aparecem como blocos curtos; o tamanho ajuda a distinguir.
const PREVIEW_CHARS = 420;

async function main() {
  const args = parseEvalArgs(process.argv.slice(2));
  const [sourceCode, prefix] = args.positional;
  if (!sourceCode && !args.grep) {
    console.error('Uso: eval:nr -- <NR-XX> [prefixo] [--grep termo]   ou   eval:nr -- --grep termo');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query<{ source_code: string; raw_text: string }>(
    `SELECT s.code AS source_code, d.raw_text
     FROM normative_documents d
     JOIN official_sources s ON s.id = d.source_id
     WHERE d.status = 'vigente' AND ($1::text IS NULL OR s.code = $1)
     ORDER BY s.code`,
    [sourceCode ?? null],
  );
  await client.end();
  if (rows.length === 0) {
    console.error(`"${sourceCode}" não tem documento vigente no banco`);
    process.exit(1);
  }

  let total = 0;
  for (const row of rows) {
    let blocks = splitIntoItemBlocks(row.raw_text);
    if (prefix) blocks = blocksWithPrefix(blocks, prefix);
    if (args.grep) blocks = blocksContaining(blocks, args.grep);
    if (blocks.length === 0) continue;
    total += blocks.length;
    console.log(`=== ${row.source_code}: ${blocks.length} item(ns) ===\n`);
    for (const block of blocks) {
      const preview = block.text.length > PREVIEW_CHARS ? `${block.text.slice(0, PREVIEW_CHARS)}…` : block.text;
      console.log(`[${block.text.length} chars] ${preview}\n`);
    }
  }
  if (total === 0) console.log('Nenhum item encontrado.');
}

main().catch((err) => {
  console.error('[eval:nr] falhou:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Criar `notices-check.ts`**

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { detectNotices } from '../src/normative/question-notices';
import { parseEvalArgs } from './args';
import { parseGoldenDataset } from './golden/golden-schema';

// eval:notices — compara, para cada pergunta do dataset, os avisos ESPERADOS com
// os que o detector determinístico (question-notices.ts) realmente dispara.
// Não usa banco, embedding nem LLM: é grátis e serve de ajuda de autoria. Uma
// diferença tem dois significados possíveis, e quem redige decide qual:
//   - a pergunta foi escrita de um jeito que dispara/omite o aviso sem querer
//     (reescreva a pergunta); ou
//   - o detector tem uma lacuna real (mantenha a pergunta: é justamente o que o
//     golden existe para expor — a Camada A vai reprová-la).
// Só informa; nunca sai com erro por causa de uma diferença.
//
// Uso: ./run-backend-tests.sh eval:notices [-- --file caminho.json]
const DEFAULT_FILE = join(__dirname, 'golden', 'perguntas.json');

const args = parseEvalArgs(process.argv.slice(2));
const questions = parseGoldenDataset(JSON.parse(readFileSync(args.file ?? DEFAULT_FILE, 'utf8')));

let diferentes = 0;
for (const q of questions) {
  const detectados = detectNotices(q.pergunta).map((notice) => notice.tipo);
  const iguais =
    detectados.length === q.avisos_esperados.length && detectados.every((tipo) => q.avisos_esperados.includes(tipo));
  if (!iguais) {
    diferentes += 1;
    console.log(`DIFERENTE ${q.id}: esperado=${JSON.stringify(q.avisos_esperados)} detectado=${JSON.stringify(detectados)}`);
  }
}
console.log(`\n[eval:notices] ${questions.length - diferentes}/${questions.length} perguntas com avisos iguais aos esperados`);
```

- [ ] **Step 4: Registrar os scripts no `package.json`**

Em `backend/package.json`, `old_string`:

```json
    "db:embed-sst-checklist": "tsx db/embed-sst-checklist.ts",
```
`new_string`:

```json
    "db:embed-sst-checklist": "tsx db/embed-sst-checklist.ts",
    "eval:lint": "tsx eval/lint-golden.ts",
    "eval:nr": "tsx eval/nr-text.ts",
    "eval:notices": "tsx eval/notices-check.ts",
```

- [ ] **Step 5: Typecheck** — comando de typecheck do backend; 0 erros.

- [ ] **Step 6: Verificar `eval:nr` contra o texto real (só leitura)**

Run: `/opt/Montese/run-backend-tests.sh eval:nr -- NR-35 35.4.1 2>&1 | tail -14`
Expected: começa com `=== NR-35: 5 item(ns) ===` e o primeiro bloco é
`[106 chars] 35.4.1 Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado pela organização.`

Run: `/opt/Montese/run-backend-tests.sh eval:nr -- --grep "eSocial" 2>&1 | tail -2`
Expected: `Nenhum item encontrado.` (a base só tem as NRs federais — é assim que se confirma a ausência de um assunto).

- [ ] **Step 7: Verificar `eval:lint` e `eval:notices` com datasets mínimos (fora do repo)**

```bash
TMP=$(mktemp -d)
python3 - "$TMP" <<'PY'
import json, sys
tmp = sys.argv[1]
def q(id, evidencia, item="35.4.1"):
    return {"id": id, "tipo": "conceitual", "categoria": "NR-35", "subcategoria": "Autorização",
        "pergunta": "Quem pode realizar trabalho em altura?", "resposta_esperada": "Trabalhador autorizado.",
        "comportamento_esperado": "responder",
        "fontes_esperadas": [{"fonte": "norma", "source_code": "NR-35", "item": item, "evidencia": evidencia}],
        "avisos_esperados": [], "jurisdicao": "federal", "risco_resposta": "medio",
        "versao_fonte": None, "data_verificacao": None, "status": "rascunho",
        "gerado_por": "teste", "validado_por": None, "validado_em": None}
good = q("NR35-001", "35.4.1 Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado pela organização.")
json.dump([good], open(tmp + "/good.json", "w"), ensure_ascii=False)
json.dump([good,
           q("NR35-002", "35.4.1 Todo trabalho em altura deve ser realizado somente por engenheiro de segurança do trabalho."),
           q("NR35-003", "35.4 Capacitação e treinamento", item="35.4")], open(tmp + "/bad.json", "w"), ensure_ascii=False)
PY
echo "--- citação verdadeira: esperado OK, exit 0 ---"
/opt/Montese/run-backend-tests.sh eval:lint -- --file "$TMP/good.json" 2>&1 | tail -1; echo "exit=${PIPESTATUS[0]}"
echo "--- uma adulterada + uma só de título: esperado 2 problemas, exit 1, nada gravado ---"
/opt/Montese/run-backend-tests.sh eval:lint -- --file "$TMP/bad.json" --write 2>&1 | grep -E "NR35-|eval:lint"; echo "exit=${PIPESTATUS[0]}"
echo "--- --write no arquivo bom: grava versao_fonte (NR-35:<8 hex>) e a data de hoje ---"
/opt/Montese/run-backend-tests.sh eval:lint -- --file "$TMP/good.json" --write 2>&1 | tail -2
python3 -c "import json;r=json.load(open('$TMP/good.json'))[0];print(r['versao_fonte'], r['data_verificacao'])"
echo "--- eval:notices: a pergunta 'Quem pode realizar…' dispara profissional_habilitado sem estar esperado ---"
/opt/Montese/run-backend-tests.sh eval:notices -- --file "$TMP/good.json" 2>&1 | grep -E "DIFERENTE|eval:notices"
rm -rf "$TMP"
```
Expected, na ordem: `OK — 1 perguntas, 1 citação(ões) conferida(s) contra o texto vigente` com `exit=0`; depois `NR35-002: NR-35 35.4.1 — evidencia_nao_encontrada`, `NR35-003: NR-35 35.4 — evidencia_curta_demais`, `2 problema(s) em 3 citação(ões) — nada foi gravado` com `exit=1`; depois `NR-35:<hash> <data>`; por fim `DIFERENTE NR35-001: esperado=[] detectado=["profissional_habilitado"]` e `0/1 perguntas com avisos iguais aos esperados`.

- [ ] **Step 8: Commit** (só se o usuário autorizou commits)

```bash
cd /opt/Montese
git add backend/eval/lint-golden.ts backend/eval/nr-text.ts backend/eval/notices-check.ts backend/package.json
git commit -m "feat: eval:lint, eval:nr e eval:notices — autoria e conferência do dataset golden (só leitura)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: O banco de perguntas golden (60) e o teste que o guarda

**Files:**
- Create: `backend/eval/golden/perguntas.json`
- Test: `backend/test/golden-dataset.unit-spec.ts`

**Interfaces:**
- Consumes (Tasks 1 e 4): o schema e os comandos `eval:nr`, `eval:notices`, `eval:lint`.
- Produces: o dataset consumido pela Task 8; regras que a Task 10 grava na spec.

Esta é uma task de **redação**, feita na sessão de implementação a partir do texto vigente já indexado. Não há LLM em runtime: quem redige é o próprio executor, e a proteção contra erro de redação é o `eval:lint`.

- [ ] **Step 1: Escrever o teste que guarda o dataset (falha)**

Criar `backend/test/golden-dataset.unit-spec.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { countByTipo, GoldenQuestion, Tipo, validateGoldenDataset } from '../eval/golden/golden-schema';

// Distribuição definida na spec (docs/specs/assistente-confiabilidade-etapa-2-3.md §3.3).
const EXPECTED_DISTRIBUTION: Record<Tipo, number> = {
  conceitual: 8,
  aplicacao: 8,
  caso_real: 8,
  contexto_incompleto: 8,
  pegadinha: 8,
  jurisdicional: 8,
  atribuicao_profissional: 6,
  sem_evidencia: 6,
};

describe('banco de perguntas golden — backend/eval/golden/perguntas.json (unit)', () => {
  const raw = JSON.parse(readFileSync(join(__dirname, '../eval/golden/perguntas.json'), 'utf8'));

  it('é válido pelo schema (sem nenhum erro)', () => {
    expect(validateGoldenDataset(raw)).toEqual([]);
  });

  it('tem exatamente a distribuição de 60 perguntas por tipo definida na spec', () => {
    expect(countByTipo(raw as GoldenQuestion[])).toEqual(EXPECTED_DISTRIBUTION);
  });

  it('toda pergunta com fonte esperada foi conferida pelo eval:lint --write (versao_fonte e data_verificacao)', () => {
    const naoConferidas = (raw as GoldenQuestion[])
      .filter((q) => q.fontes_esperadas.length > 0 && (q.versao_fonte === null || q.data_verificacao === null))
      .map((q) => q.id);
    expect(naoConferidas).toEqual([]);
  });

  it('não há duas perguntas com o mesmo texto', () => {
    const textos = (raw as GoldenQuestion[]).map((q) => q.pergunta.trim().toLowerCase());
    expect(new Set(textos).size).toBe(textos.length);
  });
});
```

Run: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern golden-dataset`
Expected: FAIL — `ENOENT … perguntas.json` (o arquivo ainda não existe).

- [ ] **Step 2: Semear o dataset com os 7 registros de referência**

Criar `backend/eval/golden/perguntas.json` com os registros abaixo. **São reais e já passam no `eval:lint`** (4 citações conferidas contra o texto vigente); servem de modelo de cada tipo:

```json
[
  {
    "id": "NR35-001",
    "tipo": "conceitual",
    "categoria": "NR-35",
    "subcategoria": "Autorização",
    "pergunta": "Que condição o trabalhador precisa cumprir para executar trabalho em altura?",
    "resposta_esperada": "Somente o trabalhador formalmente autorizado pela organização.",
    "comportamento_esperado": "responder",
    "fontes_esperadas": [
      {
        "fonte": "norma",
        "source_code": "NR-35",
        "item": "35.4.1",
        "evidencia": "35.4.1 Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado pela organização."
      }
    ],
    "avisos_esperados": [],
    "jurisdicao": "federal",
    "risco_resposta": "medio",
    "versao_fonte": null,
    "data_verificacao": null,
    "status": "rascunho",
    "gerado_por": "claude-sonnet-5 (rascunho)",
    "validado_por": null,
    "validado_em": null
  },
  {
    "id": "NR07-001",
    "tipo": "aplicacao",
    "categoria": "NR-07",
    "subcategoria": "ASO",
    "pergunta": "O ASO precisa ser entregue ao empregado?",
    "resposta_esperada": "Sim: o ASO deve ser comprovadamente disponibilizado ao empregado, em meio físico quando solicitado.",
    "comportamento_esperado": "responder",
    "fontes_esperadas": [
      {
        "fonte": "norma",
        "source_code": "NR-07",
        "item": "7.5.19",
        "evidencia": "7.5.19 Para cada exame clínico ocupacional realizado, o médico emitirá Atestado de Saúde Ocupacional - ASO, que deve ser comprovadamente disponibilizado ao empregado, devendo ser fornecido em meio físico quando solicitado."
      }
    ],
    "avisos_esperados": [],
    "jurisdicao": "federal",
    "risco_resposta": "medio",
    "versao_fonte": null,
    "data_verificacao": null,
    "status": "rascunho",
    "gerado_por": "claude-sonnet-5 (rascunho)",
    "validado_por": null,
    "validado_em": null
  },
  {
    "id": "NR06-001",
    "tipo": "pegadinha",
    "categoria": "NR-06",
    "subcategoria": "Fornecimento",
    "pergunta": "O empregador pode cobrar do empregado pelo EPI?",
    "resposta_esperada": "Não: cabe à organização fornecer o EPI gratuitamente, adequado ao risco e em perfeito estado.",
    "comportamento_esperado": "responder",
    "fontes_esperadas": [
      {
        "fonte": "norma",
        "source_code": "NR-06",
        "item": "6.5.1",
        "evidencia": "6.5.1 Cabe à organização, quanto ao EPI: a) adquirir somente o aprovado pelo órgão de âmbito nacional competente em matéria de segurança e saúde no trabalho; b) orientar e treinar o empregado; c) fornecer ao empregado, gratuitamente, EPI adequado ao risco, em perfeito estado de conservação e funcionamento, nas situações previstas no subitem 1.5.5.1.2 da Norma"
      }
    ],
    "avisos_esperados": [],
    "proibido_regex": [
      "pode ser cobrad",
      "(sim|pode)[^.]{0,30}cobrar"
    ],
    "jurisdicao": "federal",
    "risco_resposta": "medio",
    "versao_fonte": null,
    "data_verificacao": null,
    "status": "rascunho",
    "gerado_por": "claude-sonnet-5 (rascunho)",
    "validado_por": null,
    "validado_em": null
  },
  {
    "id": "NR01-001",
    "tipo": "contexto_incompleto",
    "categoria": "NR-01",
    "subcategoria": "GRO",
    "pergunta": "Minha empresa precisa de PGR?",
    "resposta_esperada": "Depende: o gerenciamento de riscos é por estabelecimento; faltam atividade, número de empregados e grau de risco.",
    "comportamento_esperado": "pedir_contexto",
    "fontes_esperadas": [
      {
        "fonte": "norma",
        "source_code": "NR-01",
        "item": "1.5.3.1",
        "evidencia": "1.5.3.1 A organização deve implementar, por estabelecimento, o gerenciamento de riscos ocupacionais em suas atividades."
      }
    ],
    "avisos_esperados": [
      "contexto"
    ],
    "jurisdicao": "federal",
    "risco_resposta": "medio",
    "versao_fonte": null,
    "data_verificacao": null,
    "status": "rascunho",
    "gerado_por": "claude-sonnet-5 (rascunho)",
    "validado_por": null,
    "validado_em": null
  },
  {
    "id": "GERAL-001",
    "tipo": "jurisdicional",
    "categoria": "PPCI",
    "subcategoria": "Exigência local",
    "pergunta": "Minha empresa precisa de PPCI no meu município?",
    "resposta_esperada": "Depende da legislação estadual e municipal do Corpo de Bombeiros, que não está na base; pedir UF, município e dados da edificação.",
    "comportamento_esperado": "alertar_jurisdicao",
    "fontes_esperadas": [],
    "avisos_esperados": [
      "jurisdicao",
      "contexto"
    ],
    "jurisdicao": "municipal",
    "risco_resposta": "alto",
    "versao_fonte": null,
    "data_verificacao": null,
    "status": "rascunho",
    "gerado_por": "claude-sonnet-5 (rascunho)",
    "validado_por": null,
    "validado_em": null
  },
  {
    "id": "GERAL-002",
    "tipo": "atribuicao_profissional",
    "categoria": "PGR",
    "subcategoria": "Responsável",
    "pergunta": "Quem pode assinar o PGR?",
    "resposta_esperada": "Depende da habilitação profissional exigida; o Assistente explica o requisito e remete ao conselho competente.",
    "comportamento_esperado": "alertar_habilitacao",
    "fontes_esperadas": [],
    "avisos_esperados": [
      "profissional_habilitado"
    ],
    "jurisdicao": "federal",
    "risco_resposta": "alto",
    "versao_fonte": null,
    "data_verificacao": null,
    "status": "rascunho",
    "gerado_por": "claude-sonnet-5 (rascunho)",
    "validado_por": null,
    "validado_em": null
  },
  {
    "id": "GERAL-003",
    "tipo": "sem_evidencia",
    "categoria": "eSocial",
    "subcategoria": "S-2240",
    "pergunta": "Qual o prazo para transmitir o evento S-2240 no eSocial?",
    "resposta_esperada": "Não há fundamento nas fontes disponíveis (a base só tem as NRs federais); deve recusar.",
    "comportamento_esperado": "recusar_sem_evidencia",
    "fontes_esperadas": [],
    "avisos_esperados": [],
    "jurisdicao": "federal",
    "risco_resposta": "alto",
    "versao_fonte": null,
    "data_verificacao": null,
    "status": "rascunho",
    "gerado_por": "claude-sonnet-5 (rascunho)",
    "validado_por": null,
    "validado_em": null
  }
]
```

- [ ] **Step 3: Regras de redação das 53 perguntas restantes**

1. **Pergunta como um usuário real:** curta, em português corrente, sem citar o número do item e sem nenhum dado de empresa ou pessoa (o dataset é sintético; nada de PII).
2. **`evidencia`:** copie **do `eval:nr`** (`/opt/Montese/run-backend-tests.sh eval:nr -- NR-XX prefixo` ou `-- NR-XX --grep termo`). Ela **começa pelo número do item**, é a menor frase contínua que sustenta a conclusão, e **não atravessa quebra de página** (pare antes de `-- N of M --`). Se o item só existe atravessando a quebra, escolha outro item.
3. **`resposta_esperada`:** 1–3 frases, só com o que o trecho diz. Nunca acrescente prazo, valor ou obrigação que não esteja na evidência.
4. **`pegadinha`:** a pergunta embute uma premissa falsa; `resposta_esperada` corrige a premissa; `proibido_regex` lista 1–3 padrões (sem acentos problemáticos, `i` implícito) que só apareceriam numa resposta que **aceita** a premissa.
5. **`sem_evidencia`:** o tema **não pode** existir na base. Antes de escrever, prove com `eval:nr -- --grep "<termo>"` (busca em todas as NRs) que volta `Nenhum item encontrado.`. Nunca invente uma NR.
6. **`jurisdicional`:** `jurisdicao` `estadual` ou `municipal`, `risco_resposta: alto`, `comportamento_esperado: alertar_jurisdicao`; `fontes_esperadas` vazio.
7. **`atribuicao_profissional`:** `comportamento_esperado: alertar_habilitacao`, `avisos_esperados: ["profissional_habilitado"]`, `risco_resposta: alto`.
8. **`contexto_incompleto`:** `comportamento_esperado: pedir_contexto`, `avisos_esperados` contendo `contexto`.
9. **Avisos esperados = o comportamento desejado**, não o do detector. Depois de escrever, rode `eval:notices`: cada `DIFERENTE` é (a) a pergunta escrita de um jeito que dispara ou omite o aviso sem querer — **reescreva a pergunta** — ou (b) uma lacuna real do detector — **mantenha**, é exatamente o que o golden existe para expor.
10. `status: rascunho`, `gerado_por: "claude-sonnet-5 (rascunho)"`, `validado_por` e `validado_em` `null`, `versao_fonte` e `data_verificacao` `null` (o lint preenche).
11. **Ids:** `<NR>-<NNN>` com o mesmo prefixo da NR (`NR35-002`); perguntas sem fonte usam `GERAL-<NNN>`. Únicos.
12. Cuidado com o texto extraído do PDF: ele traz `Ogerenciamento` (espaço engolido) e hífens partidos no fim de linha. A citação copiada do `eval:nr` já bate por construção; prefira itens cuja redação saia limpa.

- [ ] **Step 4: Tabela dos 53 slots restantes (tema por slot)**

Cada linha dá o **id, o tipo, a NR e o tema**; os fatos (item, texto, prazos) vêm do `eval:nr`, nunca desta tabela.

| id | tipo | NR | tema |
|---|---|---|---|
| NR05-001 | conceitual | NR-05 | objetivo/finalidade da CIPA |
| NR06-002 | conceitual | NR-06 | conceito de EPI |
| NR07-002 | conceitual | NR-07 | objetivo do PCMSO |
| NR01-002 | conceitual | NR-01 | o que é o gerenciamento de riscos ocupacionais |
| NR33-001 | conceitual | NR-33 | definição de espaço confinado |
| NR10-001 | conceitual | NR-10 | campo de aplicação/objetivo |
| NR17-001 | conceitual | NR-17 | objetivo da norma de ergonomia |
| NR06-003 | aplicacao | NR-06 | obrigação de fornecer EPI (subitens de 6.5) |
| NR07-003 | aplicacao | NR-07 | tipos de exame clínico ocupacional |
| NR35-002 | aplicacao | NR-35 | capacitação/treinamento para trabalho em altura (35.4.x) |
| NR12-001 | aplicacao | NR-12 | proteção em máquinas: requisito geral |
| NR18-001 | aplicacao | NR-18 | obra: requisito de capacitação ou de gerenciamento de riscos |
| NR23-001 | aplicacao | NR-23 | proteção contra incêndio: requisito geral |
| NR26-001 | aplicacao | NR-26 | sinalização de segurança |
| NR35-003 | caso_real | NR-35 | manutenção em altura: o que verificar antes de liberar o serviço |
| NR33-002 | caso_real | NR-33 | entrada em espaço confinado: requisitos prévios |
| NR10-002 | caso_real | NR-10 | serviço em instalação elétrica: autorização/qualificação |
| NR12-002 | caso_real | NR-12 | manutenção de máquina: impedir o acionamento |
| NR06-004 | caso_real | NR-06 | EPI danificado: reposição |
| NR07-004 | caso_real | NR-07 | retorno ao trabalho: exame |
| NR18-002 | caso_real | NR-18 | trabalho em obra: um requisito específico existente na norma |
| NR20-001 | caso_real | NR-20 | inflamáveis e combustíveis: requisito para a atividade |
| NR05-002 | contexto_incompleto | NR-05 | "Preciso de CIPA?" |
| NR04-001 | contexto_incompleto | NR-04 | "Preciso de SESMT?" |
| NR07-005 | contexto_incompleto | NR-07 | "Preciso de PCMSO?" |
| NR23-002 | contexto_incompleto | NR-23 | "Preciso de brigada de incêndio?" |
| NR06-005 | contexto_incompleto | NR-06 | "Qual EPI devo fornecer?" |
| NR35-004 | contexto_incompleto | NR-35 | "Que treinamento é exigido para trabalhar em altura?" |
| GERAL-004 | contexto_incompleto | — | "Qual a periodicidade dos exames?" (sem NR) |
| NR35-005 | pegadinha | NR-35 | premissa falsa: "todo trabalhador que usa escada precisa de NR-35" |
| NR07-006 | pegadinha | NR-07 | premissa falsa: "o ASO é opcional" |
| NR05-003 | pegadinha | NR-05 | premissa falsa: "a CIPA é obrigatória para toda empresa, de qualquer tamanho" |
| NR35-006 | pegadinha | NR-35 | premissa numérica falsa sobre a altura que caracteriza o trabalho em altura |
| NR12-003 | pegadinha | NR-12 | premissa falsa: "a NR-12 só vale para máquinas novas" |
| NR33-003 | pegadinha | NR-33 | premissa falsa: "todo local fechado é espaço confinado" |
| NR01-003 | pegadinha | NR-01 | premissa falsa: "o PGR só é obrigatório acima de 20 funcionários" |
| GERAL-005 | jurisdicional | — | AVCB/CLCB e o Corpo de Bombeiros de SC |
| GERAL-006 | jurisdicional | — | alvará de funcionamento municipal |
| GERAL-007 | jurisdicional | — | licença ambiental e órgão estadual |
| GERAL-008 | jurisdicional | — | código de obras do município (pé-direito) |
| GERAL-009 | jurisdicional | — | lei estadual de extintores/inspeção (PR) |
| GERAL-010 | jurisdicional | — | inspeção predial obrigatória por lei municipal |
| GERAL-011 | jurisdicional | — | exigência do Corpo de Bombeiros do RS para brigada |
| GERAL-012 | atribuicao_profissional | — | "Técnico de segurança pode assinar LTCAT?" |
| GERAL-013 | atribuicao_profissional | — | "Quem pode assinar a ART de instalação elétrica?" |
| GERAL-014 | atribuicao_profissional | — | "Preciso de engenheiro para elaborar o PCMSO?" |
| GERAL-015 | atribuicao_profissional | — | "Quem pode emitir o projeto de proteção de máquinas?" |
| GERAL-016 | atribuicao_profissional | — | "Quem pode ministrar o treinamento de NR-35?" |
| GERAL-017 | sem_evidencia | — | alíquota do RAT/FAP (tema previdenciário) |
| GERAL-018 | sem_evidencia | — | prazo de guarda do PPP |
| GERAL-019 | sem_evidencia | — | "O que a NR-99 estabelece?" (norma que não existe) |
| GERAL-020 | sem_evidencia | — | certificação ISO 14001 |
| GERAL-021 | sem_evidencia | — | piso salarial do técnico de segurança do trabalho |

**Conferência da contagem** (os 7 do seed + os 53 acima): conceitual 1+7=8 · aplicação 1+7=8 · caso real 0+8=8 · contexto incompleto 1+7=8 · pegadinha 1+7=8 · jurisdicional 1+7=8 · atribuição 1+5=6 · sem evidência 1+5=6 → **60**.

- [ ] **Step 5: Redigir em lotes, conferindo a cada lote**

Para cada tipo, na ordem da tabela: (1) achar o item com `eval:nr`; (2) escrever o registro em `perguntas.json`; (3) rodar `eval:notices` e decidir cada `DIFERENTE` (regra 9); (4) rodar `eval:lint` (sem `--write`) até `OK`. **Não avance de lote com o lint falhando.**

Run (a cada lote): `/opt/Montese/run-backend-tests.sh eval:lint 2>&1 | tail -5`
Expected: `[eval:lint] OK — N perguntas, M citação(ões) conferida(s) contra o texto vigente`.

- [ ] **Step 6: Gravar `versao_fonte` e `data_verificacao`**

Run: `/opt/Montese/run-backend-tests.sh eval:lint -- --write 2>&1 | tail -3`
Expected: `versao_fonte e data_verificacao gravadas em …/perguntas.json` e `OK — 60 perguntas, … citação(ões) conferida(s)`.

- [ ] **Step 7: Rodar o teste do dataset e ver passar**

Run: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern golden-dataset`
Expected: PASS — **4 testes** (schema sem erros · distribuição exata dos 60 · toda pergunta com fonte conferida · sem texto repetido).

- [ ] **Step 8: Relatório de avisos para o fundador**

Run: `/opt/Montese/run-backend-tests.sh eval:notices 2>&1 | tail -20` e guarde a saída para o resumo final: cada `DIFERENTE` mantido é uma lacuna real do detector de avisos (dado que a Etapa 1 não tinha como medir).

- [ ] **Step 9: Commit** (só se o usuário autorizou commits)

```bash
cd /opt/Montese
git add backend/eval/golden/perguntas.json backend/test/golden-dataset.unit-spec.ts
git commit -m "feat: banco de perguntas golden — 60 perguntas em rascunho, citações conferidas contra o texto vigente

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `QueryTrace`, `retrieve()` e `queryWithTrace()` — refatoração aditiva do serviço

> 🛑 **Portão:** só começar depois que a integração do checklist SST estiver em `main` **e** a outra sessão (`montese-5c`) avisar que terminou. Antes de editar, releia `normative-assistant.service.ts`, `normative-answer-provider.interface.ts` e os dois provedores: as âncoras abaixo foram geradas contra o commit `c27263f` e **cada texto antigo precisa aparecer exatamente uma vez** no arquivo real. Se o arquivo mudou, adapte mantendo a intenção e avise o usuário.

**Files:**
- Create: `backend/src/normative/query-trace.ts`
- Modify: `backend/src/normative/normative-assistant.service.ts`, `backend/src/normative/normative-answer-provider.interface.ts`, `backend/src/normative/minimax-normative-answer.service.ts`, `backend/src/normative/openrouter-normative-answer.service.ts`
- Test: `backend/test/query-trace.unit-spec.ts`, `backend/test/assistant-trace.e2e-spec.ts`

**Interfaces:**
- Consumes: `NoticeType` de `./question-notices`.
- Produces (usadas pelas Tasks 7, 8 e 9):
  ```ts
  // query-trace.ts
  export type QueryOutcome = 'respondeu' | 'fallback_sem_evidencia' | 'fallback_claims_descartadas';
  export interface QueryTrace { … }                       // ver o arquivo
  export function hashQuestion(question: string): string;
  export function tokensAllowedForClaim(kinds: ClaimSourceKinds): boolean;
  // normative-assistant.service.ts (novos, públicos)
  export interface ReferenceSearch { normativeRows: RetrievedChunk[]; checklistRows: RetrievedChecklistItem[] }
  export interface ReferenceRetrieval extends ReferenceSearch { threshold: number; chunkLimit: number }
  export interface TracedQueryResult { result: NormativeQueryResult; trace: QueryTrace }
  class NormativeAssistantService {
    query(question, user, attachment?, tenantId?): Promise<NormativeQueryResult>;        // inalterado
    retrieve(question: string, chunkLimit?: number): Promise<ReferenceRetrieval>;         // novo
    queryWithTrace(question, user, attachment?, tenantId?): Promise<TracedQueryResult>;   // novo
  }
  // provedores: readonly modelName?: string
  ```

- [ ] **Step 1: Teste unitário do trace (falha)**

Criar `backend/test/query-trace.unit-spec.ts`:

```ts
import { hashQuestion, tokensAllowedForClaim } from '../src/normative/query-trace';

describe('hashQuestion (unit)', () => {
  it('é um SHA-256 hexadecimal de 64 caracteres', () => {
    expect(hashQuestion('Quem pode trabalhar em altura?')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignora maiúsculas e espaços extras: a mesma pergunta dá o mesmo hash', () => {
    expect(hashQuestion('  Quem  pode\ntrabalhar em ALTURA? ')).toBe(hashQuestion('quem pode trabalhar em altura?'));
  });

  it('perguntas diferentes dão hashes diferentes e o hash não contém o texto', () => {
    const a = hashQuestion('pergunta um');
    expect(a).not.toBe(hashQuestion('pergunta dois'));
    expect(a).not.toContain('pergunta');
  });
});

describe('tokensAllowedForClaim (unit)', () => {
  const none = { chunk_ids: [], operational_ref_ids: [], company_chunk_ids: [], checklist_ref_ids: [], uses_attachment: false };

  it('permite quando a claim cita só trechos normativos oficiais', () => {
    expect(tokensAllowedForClaim({ ...none, chunk_ids: ['c1', 'c2'] })).toBe(true);
  });

  it('não permite sem nenhum trecho normativo', () => {
    expect(tokensAllowedForClaim(none)).toBe(false);
  });

  it('não permite se a claim também cita documento da empresa, item operacional, checklist ou anexo', () => {
    expect(tokensAllowedForClaim({ ...none, chunk_ids: ['c1'], company_chunk_ids: ['d1'] })).toBe(false);
    expect(tokensAllowedForClaim({ ...none, chunk_ids: ['c1'], operational_ref_ids: ['op-0'] })).toBe(false);
    expect(tokensAllowedForClaim({ ...none, chunk_ids: ['c1'], checklist_ref_ids: ['k1'] })).toBe(false);
    expect(tokensAllowedForClaim({ ...none, chunk_ids: ['c1'], uses_attachment: true })).toBe(false);
  });
});
```

Run: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern query-trace`
Expected: FAIL — `Cannot find module '../src/normative/query-trace'`.

- [ ] **Step 2: Criar `query-trace.ts`**

Criar `backend/src/normative/query-trace.ts`:

```ts
// Trace de uma pergunta ao Assistente (Etapas 2 e 3 da Confiabilidade do
// Assistente, spec docs/specs/assistente-confiabilidade-etapa-2-3.md §4).
// Tipos + funções puras. O trace NUNCA carrega o texto da pergunta, das
// claims nem da resposta: só ids, similaridades, contagens e o hash da
// pergunta. É o que o runner de avaliação lê e o que o log de uso persiste.
import { createHash } from 'crypto';
import { NoticeType } from './question-notices';

export type QueryOutcome = 'respondeu' | 'fallback_sem_evidencia' | 'fallback_claims_descartadas';

export interface TraceNormativeChunk {
  chunk_id: string;
  document_id: string;
  source_code: string | null;
  similarity: number;
  passed_threshold: boolean;
}

export interface TraceChecklistItem {
  item_id: string;
  nr_code: string;
  similarity: number;
  passed_threshold: boolean;
}

// Fontes da empresa entram só como similaridade — sem ids.
export interface TraceSimilarity {
  similarity: number;
  passed_threshold: boolean;
}

export interface QueryTrace {
  question_hash: string;
  role: string;
  tenant_id: string | null;
  threshold: number;
  chunk_limit: number;
  // Todos os candidatos do topo, INCLUSIVE os cortados pelo limiar.
  normative: TraceNormativeChunk[];
  checklist: TraceChecklistItem[];
  company: TraceSimilarity[];
  operational_count: number;
  claims_total: number;
  claims_dropped_ids: number;
  claims_dropped_support: number;
  blocking_tokens: string[];
  flagged_numbers: string[];
  // Só os ids de trecho normativo que cada claim sobrevivente cita.
  kept_claims: { chunk_ids: string[] }[];
  notices: NoticeType[];
  outcome: QueryOutcome;
  used_attachment: boolean;
  model: string | null;
  latency_ms: number;
  retrieval_ms: number;
}

// SHA-256 da pergunta normalizada (minúsculas, espaços colapsados). Serve
// para contar perguntas repetidas; NÃO é anonimização forte (uma pergunta
// comum é adivinhável por dicionário).
export function hashQuestion(question: string): string {
  const normalized = question.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex');
}

export interface ClaimSourceKinds {
  chunk_ids: string[];
  operational_ref_ids: string[];
  company_chunk_ids: string[];
  checklist_ref_ids: string[];
  uses_attachment: boolean;
}

// Regra de privacidade (spec §4.3): os tokens sinalizados (item/NR e números
// com unidade) só são gravados quando a claim cita EXCLUSIVAMENTE trechos
// normativos oficiais. Se ela cita documento da empresa, item operacional,
// checklist ou anexo, o token poderia vir de dado da empresa — grava-se só a
// contagem.
export function tokensAllowedForClaim(kinds: ClaimSourceKinds): boolean {
  return (
    kinds.chunk_ids.length > 0 &&
    kinds.operational_ref_ids.length === 0 &&
    kinds.company_chunk_ids.length === 0 &&
    kinds.checklist_ref_ids.length === 0 &&
    !kinds.uses_attachment
  );
}
```

- [ ] **Step 3: Rodar e confirmar que passa**

Run: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern query-trace`
Expected: PASS — **6 testes**.

- [ ] **Step 4: e2e do trace (falha até as edições)**

Criar `backend/test/assistant-trace.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { EMBEDDING_PROVIDER } from '../src/common/embedding/embedding-provider.interface';
import { NORMATIVE_ANSWER_PROVIDER } from '../src/normative/normative-answer-provider.interface';
import { NormativeAssistantService } from '../src/normative/normative-assistant.service';
import { hashQuestion } from '../src/normative/query-trace';
import { toVectorLiteral } from '../src/common/vector/vector.util';
import { AuthenticatedUser } from '../src/common/types';
import { TestDb } from './db-test-helper';

const CHUNK_TEXT = '99.1.1 Trecho oficial de teste do trace sobre uso de protetor auricular.';

function claim(text: string, overrides: Record<string, unknown> = {}) {
  return {
    claim: text,
    chunk_ids: [] as string[],
    operational_ref_ids: [] as string[],
    company_chunk_ids: [] as string[],
    checklist_ref_ids: [] as string[],
    uses_attachment: false,
    ...overrides,
  };
}

describe('Assistente — trace da pergunta e recuperação de referência (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: TestDb;
  let assistant: NormativeAssistantService;
  let empresa: AuthenticatedUser;
  let sourceId: string;
  let documentId: string;
  let chunkId: string;
  let expiredDocumentId: string;

  const exactVector = new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0));
  const orthogonalVector = new Array(1536).fill(0).map((_, i) => (i === 1 ? 1 : 0));
  const fakeAnswer = jest.fn();
  const fakeEmbed = jest.fn();

  // Pergunta única por teste, sem nenhum gatilho de aviso.
  const uniqueQuestion = () => `Pergunta única do trace ${randomUUID()}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({ embed: fakeEmbed })
      .overrideProvider(NORMATIVE_ANSWER_PROVIDER)
      .useValue({ answer: fakeAnswer })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    assistant = moduleRef.get(NormativeAssistantService);

    db = new TestDb();
    await db.connect();
    const client = (db as any).client;

    const tenant = await db.createTenantWithUser('Empresa Trace Teste');
    empresa = { id: tenant.userId, tenantId: tenant.tenantId, role: 'empresa' };

    // Documento vencido: gera um item operacional ("op-0") pra este tenant.
    const expired = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'Documento vencido teste do trace', $2, $2, 'application/pdf', 100, (now() - interval '5 days')::date, $3, 'empresa')
       RETURNING id`,
      [tenant.tenantId, `fixture/${tenant.tenantId}-trace.pdf`, tenant.userId],
    );
    expiredDocumentId = expired.rows[0].id;

    const src = await client.query(
      `INSERT INTO official_sources (entity, code, title, official_url)
       VALUES ('MTE', 'NR-TRACE', 'Norma teste do trace', 'https://exemplo.gov.br/trace.html') RETURNING id`,
    );
    sourceId = src.rows[0].id;
    const doc = await client.query(
      `INSERT INTO normative_documents (source_id, status, content_hash, file_key, file_name, mime_type, raw_text, indexed_at)
       VALUES ($1, 'vigente', 'hash-trace', 'normative/trace.html', 'trace.html', 'text/html', 'Texto vigente do trace', now())
       RETURNING id`,
      [sourceId],
    );
    documentId = doc.rows[0].id;
    const chunk = await client.query(
      `INSERT INTO normative_document_chunks (document_id, chunk_index, content, embedding)
       VALUES ($1, 0, $2, $3::vector) RETURNING id`,
      [documentId, CHUNK_TEXT, toVectorLiteral(exactVector)],
    );
    chunkId = chunk.rows[0].id;
  });

  beforeEach(() => {
    fakeEmbed.mockResolvedValue(exactVector);
  });

  afterEach(() => {
    fakeAnswer.mockReset();
    fakeEmbed.mockReset();
  });

  afterAll(async () => {
    const client = (db as any).client;
    await client.query('DELETE FROM documents WHERE id = $1', [expiredDocumentId]);
    await client.query('DELETE FROM normative_document_chunks WHERE document_id = $1', [documentId]);
    await client.query('DELETE FROM normative_documents WHERE id = $1', [documentId]);
    await client.query('DELETE FROM official_sources WHERE id = $1', [sourceId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('query() devolve exatamente o mesmo resultado que queryWithTrace()', async () => {
    const question = uniqueQuestion();
    fakeAnswer.mockResolvedValue([claim('É obrigatório o uso de protetor auricular.', { chunk_ids: [chunkId] })]);

    const direct = await assistant.query(question, empresa);
    const traced = await assistant.queryWithTrace(question, empresa);

    expect(direct).toEqual(traced.result);
    expect(direct.answer).toBe('É obrigatório o uso de protetor auricular.');
  });

  it('o trace registra a recuperação e o verificador, sem nenhum texto de pergunta ou de claim', async () => {
    const question = uniqueQuestion();
    fakeAnswer.mockResolvedValue([claim('É obrigatório o uso de protetor auricular.', { chunk_ids: [chunkId] })]);

    const { trace } = await assistant.queryWithTrace(question, empresa);

    const candidate = trace.normative.find((c) => c.chunk_id === chunkId);
    expect(candidate).toMatchObject({ document_id: documentId, source_code: 'NR-TRACE', passed_threshold: true });
    expect(candidate!.similarity).toBeGreaterThan(0.99);
    expect(trace.threshold).toBeGreaterThan(0);
    expect(trace.chunk_limit).toBe(6);
    expect(trace).toMatchObject({
      outcome: 'respondeu',
      role: 'empresa',
      tenant_id: null,
      claims_total: 1,
      claims_dropped_ids: 0,
      claims_dropped_support: 0,
      notices: [],
      used_attachment: false,
      model: null,
    });
    expect(trace.kept_claims).toEqual([{ chunk_ids: [chunkId] }]);
    expect(trace.question_hash).toBe(hashQuestion(question));
    expect(trace.retrieval_ms).toBeGreaterThanOrEqual(0);
    expect(trace.latency_ms).toBeGreaterThanOrEqual(trace.retrieval_ms);

    const serialized = JSON.stringify(trace);
    expect(serialized).not.toContain(question);
    expect(serialized).not.toContain('protetor auricular');
  });

  it('sem trecho relevante: fallback_sem_evidencia, candidatos abaixo do limiar e provedor não chamado', async () => {
    fakeEmbed.mockResolvedValue(orthogonalVector);

    const { result, trace } = await assistant.queryWithTrace(uniqueQuestion(), empresa);

    expect(result.answer).toBeNull();
    expect(trace.outcome).toBe('fallback_sem_evidencia');
    expect(trace.normative.length).toBeGreaterThan(0);
    expect(trace.normative.every((c) => !c.passed_threshold)).toBe(true);
    expect(fakeAnswer).not.toHaveBeenCalled();
  });

  it('claim com item inventado é descartada e o token fica registrado (só citava trecho normativo)', async () => {
    fakeAnswer.mockResolvedValue([
      claim('Conforme o item 99.9.9, o protetor é obrigatório.', { chunk_ids: [chunkId] }),
    ]);

    const { result, trace } = await assistant.queryWithTrace(uniqueQuestion(), empresa);

    expect(result.answer).toBeNull();
    expect(trace).toMatchObject({
      outcome: 'fallback_claims_descartadas',
      claims_total: 1,
      claims_dropped_ids: 0,
      claims_dropped_support: 1,
      blocking_tokens: ['item 99.9.9'],
      kept_claims: [],
    });
  });

  it('claim com id inexistente é contada como descartada pelo id-check', async () => {
    fakeAnswer.mockResolvedValue([
      claim('Afirmação com fonte inventada.', { chunk_ids: ['00000000-0000-0000-0000-000000000000'] }),
    ]);

    const { trace } = await assistant.queryWithTrace(uniqueQuestion(), empresa);

    expect(trace).toMatchObject({
      outcome: 'fallback_claims_descartadas',
      claims_dropped_ids: 1,
      claims_dropped_support: 0,
    });
  });

  it('número com unidade sem base só é registrado: a claim sobrevive e o token vai para flagged_numbers', async () => {
    fakeAnswer.mockResolvedValue([
      claim('O protetor deve ser trocado a cada 8 horas de uso.', { chunk_ids: [chunkId] }),
    ]);

    const { result, trace } = await assistant.queryWithTrace(uniqueQuestion(), empresa);

    expect(result.answer).toBe('O protetor deve ser trocado a cada 8 horas de uso.');
    expect(trace.outcome).toBe('respondeu');
    expect(trace.flagged_numbers).toEqual(['8 horas']);
    expect(trace.blocking_tokens).toEqual([]);
  });

  it('privacidade: claim que também cita item operacional da empresa não grava os tokens, só a contagem', async () => {
    fakeAnswer.mockResolvedValue([
      claim('Conforme o item 99.9.9 e a sua pendência.', { chunk_ids: [chunkId], operational_ref_ids: ['op-0'] }),
    ]);

    const { trace } = await assistant.queryWithTrace(uniqueQuestion(), empresa, undefined, empresa.tenantId ?? undefined);

    expect(trace.tenant_id).toBe(empresa.tenantId);
    expect(trace.operational_count).toBeGreaterThan(0);
    expect(trace.claims_dropped_support).toBe(1);
    expect(trace.blocking_tokens).toEqual([]);
    expect(trace.flagged_numbers).toEqual([]);
  });

  it('retrieve() faz só a busca de referência: sem LLM, devolvendo limiar, limite e candidatos', async () => {
    const retrieval = await assistant.retrieve(uniqueQuestion());

    expect(fakeAnswer).not.toHaveBeenCalled();
    expect(retrieval.chunkLimit).toBe(6);
    expect(retrieval.threshold).toBeGreaterThan(0);
    const row = retrieval.normativeRows.find((r) => r.chunk_id === chunkId);
    expect(row?.source_code).toBe('NR-TRACE');
    expect(row?.similarity).toBeGreaterThan(0.99);

    const limited = await assistant.retrieve(uniqueQuestion(), 2);
    expect(limited.chunkLimit).toBe(2);
    expect(limited.normativeRows.length).toBeLessThanOrEqual(2);
  });
});
```

Run: `/opt/Montese/run-backend-tests.sh test:e2e -- --testPathPattern assistant-trace --forceExit`
Expected: FAIL de compilação — `Property 'queryWithTrace' does not exist on type 'NormativeAssistantService'` (e `retrieve`).

- [ ] **Step 5: Aplicar as edições do serviço e dos provedores, na ordem**

Aplique cada edição abaixo com a ferramenta de edição (`old_string` → `new_string`). São **24 edições**, **em ordem**; cada `old_string` deve casar **exatamente uma vez** no arquivo naquele ponto.

**Edição 1 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
import { checkClaimSupport } from './claim-support';
```
`new_string`:
```ts
import { checkClaimSupport } from './claim-support';
import { QueryOutcome, QueryTrace, hashQuestion, tokensAllowedForClaim } from './query-trace';
```

**Edição 2 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts

interface RetrievedChunk {
```
`new_string`:
```ts

export interface RetrievedChunk {
```

**Edição 3 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts

interface RetrievedChecklistItem {
```
`new_string`:
```ts

export interface RetrievedChecklistItem {
```

**Edição 4 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
@Injectable()
export class NormativeAssistantService {
```
`new_string`:
```ts
// Resultado da busca de referência (normas oficiais + checklist interno), com os
// candidatos do topo ANTES do corte pelo limiar de similaridade.
export interface ReferenceSearch {
  normativeRows: RetrievedChunk[];
  checklistRows: RetrievedChecklistItem[];
}

export interface ReferenceRetrieval extends ReferenceSearch {
  threshold: number;
  chunkLimit: number;
}

export interface TracedQueryResult {
  result: NormativeQueryResult;
  trace: QueryTrace;
}

@Injectable()
export class NormativeAssistantService {
```

**Edição 5 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
  async query(
    question: string,
    user: AuthenticatedUser,
    attachment?: QueryAttachment,
    tenantId?: string,
  ): Promise<NormativeQueryResult> {
    // Avisos determinísticos (sem I/O, sem custo) — calculados antes de
    // qualquer embedding/busca e devolvidos em todos os caminhos de retorno.
    const notices = detectNotices(question);
```
`new_string`:
```ts
  // Mesma assinatura e mesmo retorno de sempre. O trace só serve ao runner de
  // avaliação (queryWithTrace) e, depois, ao log de uso.
  async query(
    question: string,
    user: AuthenticatedUser,
    attachment?: QueryAttachment,
    tenantId?: string,
  ): Promise<NormativeQueryResult> {
    const { result } = await this.queryWithTrace(question, user, attachment, tenantId);
    return result;
  }

  // Só a recuperação de referência (embedding + busca), SEM tenant e SEM LLM de
  // resposta — a Camada A do runner de avaliação mede exatamente isto.
  async retrieve(question: string, chunkLimit: number = CHUNK_LIMIT_DEFAULT): Promise<ReferenceRetrieval> {
    const embedding = await this.embeddings.embed(question);
    const search = await this.searchReference(embedding, chunkLimit);
    return { ...search, threshold: this.ragThreshold(), chunkLimit };
  }

  // O pipeline completo, devolvendo também o trace (recuperação, verificador,
  // avisos). Não persiste nada.
  async queryWithTrace(
    question: string,
    user: AuthenticatedUser,
    attachment?: QueryAttachment,
    tenantId?: string,
  ): Promise<TracedQueryResult> {
    // Avisos determinísticos (sem I/O, sem custo) — calculados antes de
    // qualquer embedding/busca e devolvidos em todos os caminhos de retorno.
    const notices = detectNotices(question);

    // Estado do trace, preenchido nos pontos onde cada dado nasce. O trace NUNCA
    // carrega texto de pergunta, claim ou resposta — só ids, similaridades e
    // contagens (ver query-trace.ts).
    const startedAt = Date.now();
    let retrievalStartedAt = startedAt;
    const traceState = {
      usedAttachment: false,
      threshold: 0,
      chunkLimit: 0,
      normative: [] as QueryTrace['normative'],
      checklist: [] as QueryTrace['checklist'],
      company: [] as QueryTrace['company'],
      operationalCount: 0,
      claimsTotal: 0,
      claimsDroppedIds: 0,
      claimsDroppedSupport: 0,
      blockingTokens: [] as string[],
      flaggedNumbers: [] as string[],
      keptClaims: [] as QueryTrace['kept_claims'],
      retrievalMs: 0,
    };
    const finish = (result: NormativeQueryResult, outcome: QueryOutcome): TracedQueryResult => ({
      result,
      trace: {
        question_hash: hashQuestion(question),
        role: user.role,
        tenant_id: tenantId ?? null,
        threshold: traceState.threshold,
        chunk_limit: traceState.chunkLimit,
        normative: traceState.normative,
        checklist: traceState.checklist,
        company: traceState.company,
        operational_count: traceState.operationalCount,
        claims_total: traceState.claimsTotal,
        claims_dropped_ids: traceState.claimsDroppedIds,
        claims_dropped_support: traceState.claimsDroppedSupport,
        blocking_tokens: traceState.blockingTokens,
        flagged_numbers: traceState.flaggedNumbers,
        kept_claims: traceState.keptClaims,
        notices: notices.map((notice) => notice.tipo),
        outcome,
        used_attachment: traceState.usedAttachment,
        model: this.answerer.modelName ?? null,
        latency_ms: Date.now() - startedAt,
        retrieval_ms: traceState.retrievalMs,
      },
    });
```

**Edição 6 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
    const questionEmbedding = await this.embeddings.embed(question);
```
`new_string`:
```ts
    traceState.usedAttachment = attachmentInput !== undefined;
    retrievalStartedAt = Date.now();
    const questionEmbedding = await this.embeddings.embed(question);
```

**Edição 7 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
    const threshold = envFloat('OPENROUTER_RAG_MIN_SIMILARITY', 0.4);
```
`new_string`:
```ts
    const threshold = this.ragThreshold();
```

**Edição 8 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
    // `official_sources`, `normative_documents` e
    // `normative_document_chunks` não têm tenant_id nem RLS — não há
    // contexto de tenant a propagar aqui. Usar withoutTenantContext (só
    // pool.connect()/release(), sem BEGIN/COMMIT) garante que nenhuma
    // conexão do pool fica presa "idle in transaction" durante as
    // chamadas HTTP externas lentas (embed acima, answer abaixo) — ver
    // Finding C1a da revisão final da Fase 9.
    const { rows } = await this.db.withoutTenantContext((client) =>
      client.query<RetrievedChunk>(
        `SELECT c.id AS chunk_id, c.content, d.id AS document_id, s.title AS source_title, s.code AS source_code, s.official_url,
                1 - (c.embedding <=> $1::vector) AS similarity
         FROM normative_document_chunks c
         JOIN normative_documents d ON d.id = c.document_id
         JOIN official_sources s ON s.id = d.source_id
         WHERE d.status = 'vigente' AND d.indexed_at IS NOT NULL
         ORDER BY c.embedding <=> $1::vector
         LIMIT $2`,
        [toVectorLiteral(questionEmbedding), chunkLimit],
      ),
    );
    const relevant = rows.filter((r) => r.similarity >= threshold);

    // Busca no checklist interno de documentação SST (Montese) — mesmo
    // padrão da busca em normative_document_chunks acima: sempre
    // executada (não depende de tenantId, é conhecimento geral, não
    // específico de uma empresa), mesma transação curta e separada
    // (withoutTenantContext), mesmo threshold/limit. `content` usa a
    // MESMA fórmula de 4 campos do texto embedado (ver Global
    // Constraints) — assim o texto que o modelo lê no prompt é
    // exatamente o texto que foi usado pra calcular a similaridade que
    // trouxe esse item pra cá, incluindo o requisito legal literal
    // (útil quando a pergunta cita um número de item de norma).
    const { rows: checklistRows } = await this.db.withoutTenantContext((client) =>
      client.query<RetrievedChecklistItem>(
        `SELECT id AS item_id, nr_code, document_name,
                nr_code || ' — ' || document_name || ': ' || description || ' — ' || legal_requirement AS content,
                1 - (embedding <=> $1::vector) AS similarity
         FROM sst_checklist_items
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        [toVectorLiteral(questionEmbedding), chunkLimit],
      ),
    );
    const relevantChecklist = checklistRows.filter((r) => r.similarity >= threshold);
```
`new_string`:
```ts
    const { normativeRows, checklistRows } = await this.searchReference(questionEmbedding, chunkLimit);
    const relevant = normativeRows.filter((r) => r.similarity >= threshold);
    const relevantChecklist = checklistRows.filter((r) => r.similarity >= threshold);
    traceState.threshold = threshold;
    traceState.chunkLimit = chunkLimit;
    traceState.normative = normativeRows.map((r) => ({
      chunk_id: r.chunk_id,
      document_id: r.document_id,
      source_code: r.source_code,
      similarity: r.similarity,
      passed_threshold: r.similarity >= threshold,
    }));
    traceState.checklist = checklistRows.map((r) => ({
      item_id: r.item_id,
      nr_code: r.nr_code,
      similarity: r.similarity,
      passed_threshold: r.similarity >= threshold,
    }));
```

**Edição 9 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
    // Busca de trechos de documento da própria empresa (PGR/PCMSO/LTCAT/
```
`new_string`:
```ts
    traceState.operationalCount = operationalItems.length;

    // Busca de trechos de documento da própria empresa (PGR/PCMSO/LTCAT/
```

**Edição 10 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
      companyChunks = companyRows.filter((r) => r.similarity >= threshold);
```
`new_string`:
```ts
      companyChunks = companyRows.filter((r) => r.similarity >= threshold);
      traceState.company = companyRows.map((r) => ({
        similarity: r.similarity,
        passed_threshold: r.similarity >= threshold,
      }));
```

**Edição 11 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
    if (
      relevant.length === 0 &&
      operationalItems.length === 0 &&
      companyChunks.length === 0 &&
      relevantChecklist.length === 0 &&
      !attachmentInput
    ) {
      return {
        answer: null,
        message: FALLBACK_MESSAGE,
        citations: [],
        company_citations: [],
        checklist_citations: [],
        notices,
        attachment_warning: attachmentWarning,
      };
    }
```
`new_string`:
```ts
    traceState.retrievalMs = Date.now() - retrievalStartedAt;

    if (
      relevant.length === 0 &&
      operationalItems.length === 0 &&
      companyChunks.length === 0 &&
      relevantChecklist.length === 0 &&
      !attachmentInput
    ) {
      return finish(
        {
          answer: null,
          message: FALLBACK_MESSAGE,
          citations: [],
          company_citations: [],
          checklist_citations: [],
          notices,
          attachment_warning: attachmentWarning,
        },
        'fallback_sem_evidencia',
      );
    }
```

**Edição 12 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
      attachmentInput,
    );

    const validChunkIds
```
`new_string`:
```ts
      attachmentInput,
    );
    traceState.claimsTotal = claims.length;

    const validChunkIds
```

**Edição 13 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
      if (!idsAreValid) return false;
```
`new_string`:
```ts
      if (!idsAreValid) {
        traceState.claimsDroppedIds += 1;
        return false;
      }
```

**Edição 14 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
      if (support.logged.length > 0) {
        this.logger.warn(
```
`new_string`:
```ts
      // Regra de privacidade do trace: os tokens só são guardados quando a claim cita
      // EXCLUSIVAMENTE trechos normativos oficiais (ver tokensAllowedForClaim).
      const tokensAllowed = tokensAllowedForClaim({
        chunk_ids: claim.chunk_ids,
        operational_ref_ids: claim.operational_ref_ids,
        company_chunk_ids: claim.company_chunk_ids,
        checklist_ref_ids: claim.checklist_ref_ids,
        uses_attachment: attachmentIsReal && claim.uses_attachment === true,
      });
      if (support.logged.length > 0) {
        if (tokensAllowed) traceState.flaggedNumbers.push(...support.logged);
        this.logger.warn(
```

**Edição 15 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
      if (support.blocking.length > 0) {
        this.logger.warn(
```
`new_string`:
```ts
      if (support.blocking.length > 0) {
        traceState.claimsDroppedSupport += 1;
        if (tokensAllowed) traceState.blockingTokens.push(...support.blocking);
        this.logger.warn(
```

**Edição 16 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
        return false;
      }
      return true;
    });
```
`new_string`:
```ts
        return false;
      }
      traceState.keptClaims.push({ chunk_ids: claim.chunk_ids });
      return true;
    });
```

**Edição 17 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
    if (survivingClaims.length === 0) {
      return {
        answer: null,
        message: FALLBACK_MESSAGE,
        citations: [],
        company_citations: [],
        checklist_citations: [],
        notices,
        attachment_warning: attachmentWarning,
      };
    }
```
`new_string`:
```ts
    if (survivingClaims.length === 0) {
      return finish(
        {
          answer: null,
          message: FALLBACK_MESSAGE,
          citations: [],
          company_citations: [],
          checklist_citations: [],
          notices,
          attachment_warning: attachmentWarning,
        },
        'fallback_claims_descartadas',
      );
    }
```

**Edição 18 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
    return {
      answer: survivingClaims.map((c) => c.claim).join('\n\n'),
```
`new_string`:
```ts
    const result: NormativeQueryResult = {
      answer: survivingClaims.map((c) => c.claim).join('\n\n'),
```

**Edição 19 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
      used_attachment: usedAttachment ? true : undefined,
      attachment_warning: attachmentWarning,
    };
  }
}
```
`new_string`:
```ts
      used_attachment: usedAttachment ? true : undefined,
      attachment_warning: attachmentWarning,
    };
    return finish(result, 'respondeu');
  }

  private ragThreshold(): number {
    return envFloat('OPENROUTER_RAG_MIN_SIMILARITY', 0.4);
  }

  // Busca de referência (sem tenant e sem LLM): normas oficiais vigentes e checklist
  // interno. Extraída de queryWithTrace para que o runner de avaliação (Camada A) e a
  // pergunta real usem EXATAMENTE a mesma busca — sem cópia que possa divergir.
  private async searchReference(questionEmbedding: number[], chunkLimit: number): Promise<ReferenceSearch> {
    // `official_sources`, `normative_documents` e
    // `normative_document_chunks` não têm tenant_id nem RLS — não há
    // contexto de tenant a propagar aqui. Usar withoutTenantContext (só
    // pool.connect()/release(), sem BEGIN/COMMIT) garante que nenhuma
    // conexão do pool fica presa "idle in transaction" durante as
    // chamadas HTTP externas lentas (embed acima, answer abaixo) — ver
    // Finding C1a da revisão final da Fase 9.
    const { rows: normativeRows } = await this.db.withoutTenantContext((client) =>
      client.query<RetrievedChunk>(
        `SELECT c.id AS chunk_id, c.content, d.id AS document_id, s.title AS source_title, s.code AS source_code, s.official_url,
                1 - (c.embedding <=> $1::vector) AS similarity
         FROM normative_document_chunks c
         JOIN normative_documents d ON d.id = c.document_id
         JOIN official_sources s ON s.id = d.source_id
         WHERE d.status = 'vigente' AND d.indexed_at IS NOT NULL
         ORDER BY c.embedding <=> $1::vector
         LIMIT $2`,
        [toVectorLiteral(questionEmbedding), chunkLimit],
      ),
    );

    // Busca no checklist interno de documentação SST (Montese) — mesmo
    // padrão da busca em normative_document_chunks acima: sempre
    // executada (não depende de tenantId, é conhecimento geral, não
    // específico de uma empresa), mesma transação curta e separada
    // (withoutTenantContext), mesmo threshold/limit. `content` usa a
    // MESMA fórmula de 4 campos do texto embedado (ver Global
    // Constraints) — assim o texto que o modelo lê no prompt é
    // exatamente o texto que foi usado pra calcular a similaridade que
    // trouxe esse item pra cá, incluindo o requisito legal literal
    // (útil quando a pergunta cita um número de item de norma).
    const { rows: checklistRows } = await this.db.withoutTenantContext((client) =>
      client.query<RetrievedChecklistItem>(
        `SELECT id AS item_id, nr_code, document_name,
                nr_code || ' — ' || document_name || ': ' || description || ' — ' || legal_requirement AS content,
                1 - (embedding <=> $1::vector) AS similarity
         FROM sst_checklist_items
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        [toVectorLiteral(questionEmbedding), chunkLimit],
      ),
    );
    return { normativeRows, checklistRows };
  }
}
```

**Edição 20 — `backend/src/normative/normative-answer-provider.interface.ts`**

`old_string`:
```ts
export interface NormativeAnswerProvider {
  answer(
```
`new_string`:
```ts
export interface NormativeAnswerProvider {
  // Rótulo do modelo em uso — só para o trace/log de uso; opcional para não
  // quebrar provedores de teste.
  readonly modelName?: string;
  answer(
```

**Edição 21 — `backend/src/normative/minimax-normative-answer.service.ts`**

`old_string`:
```ts
  constructor(private readonly usageLog: AiUsageLogService) {}

  async answer(
```
`new_string`:
```ts
  constructor(private readonly usageLog: AiUsageLogService) {}

  get modelName(): string {
    return process.env.MINIMAX_MODEL || 'MiniMax-M3';
  }

  async answer(
```

**Edição 22 — `backend/src/normative/minimax-normative-answer.service.ts`**

`old_string`:
```ts
    const model = process.env.MINIMAX_MODEL || 'MiniMax-M3';
```
`new_string`:
```ts
    const model = this.modelName;
```

**Edição 23 — `backend/src/normative/openrouter-normative-answer.service.ts`**

`old_string`:
```ts
  private readonly logger = new Logger(OpenRouterNormativeAnswerService.name);

  async answer(
```
`new_string`:
```ts
  private readonly logger = new Logger(OpenRouterNormativeAnswerService.name);

  get modelName(): string {
    return process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-5';
  }

  async answer(
```

**Edição 24 — `backend/src/normative/openrouter-normative-answer.service.ts`**

`old_string`:
```ts
    const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-5';
```
`new_string`:
```ts
    const model = this.modelName;
```


- [ ] **Step 6: Typecheck**

Run o comando de typecheck do backend. Expected: sem saída (0 erros). Se aparecer erro em `normative-assistant.service.ts`, releia a edição correspondente — não "conserte" o tipo com `any`.

- [ ] **Step 7: Rodar o e2e do trace e todos os e2e do Assistente**

Run: `/opt/Montese/run-backend-tests.sh test:e2e -- --testPathPattern "assistant-trace|normative-assistant" --forceExit`
Expected: PASS em `assistant-trace` (**8 testes**) e em todas as suítes `normative-assistant*` que já existiam — a prova de que `query()` não mudou. Se algum teste antigo falhar, **não afrouxe nada**: pare e investigue.

- [ ] **Step 8: Commit** (só se o usuário autorizou commits)

```bash
cd /opt/Montese
git add backend/src/normative/query-trace.ts backend/src/normative/normative-assistant.service.ts \
  backend/src/normative/normative-answer-provider.interface.ts backend/src/normative/minimax-normative-answer.service.ts \
  backend/src/normative/openrouter-normative-answer.service.ts backend/test/query-trace.unit-spec.ts backend/test/assistant-trace.e2e-spec.ts
git commit -m "feat: QueryTrace, retrieve() e queryWithTrace() — trace do Assistente sem texto, query() inalterado

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Log de uso real — migration `0051`, gravação e purge

**Files:**
- Create: `backend/db/migrations/0051_assistant_query_log.sql`, `backend/src/normative/assistant-query-log.service.ts`, `backend/test/jest-e2e-setup.ts`
- Modify: `backend/src/normative/normative-assistant.service.ts`, `backend/src/normative/normative.module.ts`, `backend/test/jest-e2e.json`
- Test: `backend/test/assistant-query-log.e2e-spec.ts`

**Interfaces:**
- Consumes (Task 6): `QueryTrace`, `queryWithTrace`.
- Produces: tabela `assistant_query_log`; `AssistantQueryLogService.record(trace: QueryTrace): Promise<void>` (nunca lança) e `purgeOlderThan(days: number): Promise<number>`; `QUERY_LOG_RETENTION_DAYS = 90`.

- [ ] **Step 1: Interruptor do log nos e2e (ANTES de ligar a gravação)**

Criar `backend/test/jest-e2e-setup.ts`:

```ts
// Roda antes de cada arquivo e2e (setupFiles em jest-e2e.json). Os e2e usam o
// Postgres de produção; sem isto, qualquer e2e que chame o Assistente gravaria
// linhas de teste em assistant_query_log e poluiria o uso real. Só o e2e do log
// (assistant-query-log.e2e-spec.ts) religa o registro.
process.env.ASSISTANT_QUERY_LOG_DISABLED = 'true';
```

Em `backend/test/jest-e2e.json`, `old_string`:

```json
  "testRegex": ".e2e-spec.ts$",
```
`new_string`:

```json
  "testRegex": ".e2e-spec.ts$",
  "setupFiles": ["<rootDir>/jest-e2e-setup.ts"],
```

Isto vem **antes** de o `query()` passar a gravar: sem o interruptor, cada e2e que chama o Assistente (os seus e os de outros módulos) inseriria linhas de teste no log de uso de produção.

- [ ] **Step 2: Escrever a migration**

Criar `backend/db/migrations/0051_assistant_query_log.sql`:

```sql
-- Etapas 2 e 3 da Confiabilidade do Assistente
-- (docs/specs/assistente-confiabilidade-etapa-2-3.md §4.3): log de uso real do
-- Assistente, SÓ metadados e ids — NUNCA o texto da pergunta, das claims nem
-- da resposta. Serve para medir recuperação, falsos positivos do verificador
-- (números com unidade sinalizados) e custo sem tocar em dado de empresa.
--
-- Privacidade dos tokens: `blocking_tokens` e `flagged_numbers` só são
-- gravados quando a claim citava EXCLUSIVAMENTE trechos normativos oficiais
-- (regra aplicada em query-trace.ts, antes de chegar aqui). `retrieved` guarda
-- ids só de fontes de referência (normas e checklist); fontes da empresa entram
-- como similaridade, sem ids. `question_hash` (SHA-256) serve para contar
-- perguntas repetidas — NÃO é anonimização forte.
--
-- Somente aditiva. Retenção de 90 dias (job diário em
-- AssistantQueryLogService). RLS no mesmo padrão de audit_log (0002): qualquer
-- contexto grava (o query() roda com qualquer papel), só admin lê e apaga.
CREATE TABLE assistant_query_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  role text NOT NULL CHECK (role IN ('empresa', 'tecnico', 'parceiro', 'admin')),
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  question_hash text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('respondeu', 'fallback_sem_evidencia', 'fallback_claims_descartadas')),
  notices text[] NOT NULL DEFAULT '{}',
  retrieved jsonb NOT NULL,
  claims_total int NOT NULL,
  claims_dropped_ids int NOT NULL,
  claims_dropped_support int NOT NULL,
  blocking_tokens text[] NOT NULL DEFAULT '{}',
  flagged_numbers text[] NOT NULL DEFAULT '{}',
  used_attachment boolean NOT NULL DEFAULT false,
  model text,
  latency_ms int NOT NULL,
  retrieval_ms int NOT NULL
);

CREATE INDEX assistant_query_log_created_at_idx ON assistant_query_log (created_at);

ALTER TABLE assistant_query_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_query_log FORCE ROW LEVEL SECURITY;

CREATE POLICY assistant_query_log_select ON assistant_query_log FOR SELECT USING (
  current_setting('app.role', true) = 'admin'
);

-- Escrita: qualquer contexto pode inserir (mesmo raciocínio de audit_log_insert).
-- É só INSERT: nunca libera SELECT. O INSERT não pode usar RETURNING, porque
-- o RETURNING exige passar pela policy de SELECT (só admin).
CREATE POLICY assistant_query_log_insert ON assistant_query_log FOR INSERT WITH CHECK (true);

-- Apagar (retenção): só admin. Não há policy de UPDATE: o log não é editável.
CREATE POLICY assistant_query_log_delete ON assistant_query_log FOR DELETE USING (
  current_setting('app.role', true) = 'admin'
);
```

- [ ] **Step 3: 🛑 PARAR — pedir autorização para aplicar a migration em produção**

**Não aplicar sem o ok explícito do usuário.** Antes de pedir:

- Conferir o número livre (leitura): `ls /opt/Montese/backend/db/migrations | tail -3` — se já existe `0051_*` de outra sessão, **renomeie** a migration para o próximo número livre e ajuste os comentários que a citam.
- Confirmar o backup do dia: `ls -la /opt/montese-backups/postgres/ | tail -2` (deve haver um `montese-<hoje>-0300*.dump`).
- Confirmar que só esta migration está pendente (leitura): `echo "SELECT count(*) FROM _migrations;" | docker exec -i montese_postgres sh -c 'PGOPTIONS="-c default_transaction_read_only=on" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'` deve ser igual ao número de arquivos `.sql` **menos 1**.

Dizer ao usuário: "A migration `0051` é aditiva (uma tabela nova com RLS, só metadados). Backup de hoje: `<arquivo>`. Comando: `/opt/Montese/run-backend-tests.sh db:migrate`. Posso aplicar?"

- [ ] **Step 4: Aplicar a migration (somente após o ok)**

Run: `/opt/Montese/run-backend-tests.sh db:migrate`
Expected: uma linha `[skip]` por migration já aplicada, depois `[apply] 0051_assistant_query_log.sql`, `[ok] 0051_…`, `Migrations concluídas.`

Verificar (leitura):

```bash
echo "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'assistant_query_log';" | docker exec -i montese_postgres sh -c 'PGOPTIONS="-c default_transaction_read_only=on" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'
```
Expected: `assistant_query_log|t|t`.

- [ ] **Step 5: e2e do log (falha até a gravação existir)**

Criar `backend/test/assistant-query-log.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/common/database/database.service';
import { EMBEDDING_PROVIDER } from '../src/common/embedding/embedding-provider.interface';
import { NORMATIVE_ANSWER_PROVIDER } from '../src/normative/normative-answer-provider.interface';
import { AssistantQueryLogService } from '../src/normative/assistant-query-log.service';
import { NormativeAssistantService } from '../src/normative/normative-assistant.service';
import { hashQuestion } from '../src/normative/query-trace';
import { toVectorLiteral } from '../src/common/vector/vector.util';
import { AuthenticatedUser } from '../src/common/types';
import { TestDb } from './db-test-helper';

const CHUNK_TEXT = '98.1.1 Trecho oficial de teste do log de uso sobre uso de luvas de proteção.';

function claim(text: string, overrides: Record<string, unknown> = {}) {
  return {
    claim: text,
    chunk_ids: [] as string[],
    operational_ref_ids: [] as string[],
    company_chunk_ids: [] as string[],
    checklist_ref_ids: [] as string[],
    uses_attachment: false,
    ...overrides,
  };
}

describe('assistant_query_log — log de uso real do Assistente (e2e)', () => {
  // test/jest-e2e-setup.ts liga o interruptor em todo e2e; só este arquivo o
  // desliga, porque é o que testa a gravação de verdade.
  const previousFlag = process.env.ASSISTANT_QUERY_LOG_DISABLED;

  let app: INestApplication;
  let moduleRef: TestingModule;
  let db: TestDb;
  let database: DatabaseService;
  let assistant: NormativeAssistantService;
  let logService: AssistantQueryLogService;
  let empresa: AuthenticatedUser;
  let sourceId: string;
  let documentId: string;
  let chunkId: string;
  let expiredDocumentId: string;
  const hashesToClean: string[] = [];

  const exactVector = new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0));
  const fakeAnswer = jest.fn();
  const fakeEmbed = jest.fn();

  function uniqueQuestion(prefix = 'Pergunta única do log'): string {
    const question = `${prefix} ${randomUUID()}`;
    hashesToClean.push(hashQuestion(question));
    return question;
  }

  async function rowsByHash(hash: string): Promise<any[]> {
    const result = await (db as any).client.query('SELECT * FROM assistant_query_log WHERE question_hash = $1', [hash]);
    return result.rows;
  }

  // O log é gravado sem ninguém esperar (o query() não aguarda): espera a linha aparecer.
  async function waitForRows(hash: string, expected = 1, timeoutMs = 4000): Promise<any[]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const rows = await rowsByHash(hash);
      if (rows.length >= expected || Date.now() > deadline) return rows;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  beforeAll(async () => {
    process.env.ASSISTANT_QUERY_LOG_DISABLED = 'false';

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({ embed: fakeEmbed })
      .overrideProvider(NORMATIVE_ANSWER_PROVIDER)
      .useValue({ answer: fakeAnswer })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    assistant = moduleRef.get(NormativeAssistantService);
    logService = moduleRef.get(AssistantQueryLogService);
    database = moduleRef.get(DatabaseService);

    db = new TestDb();
    await db.connect();
    const client = (db as any).client;

    const tenant = await db.createTenantWithUser('Empresa Log Uso Teste');
    empresa = { id: tenant.userId, tenantId: tenant.tenantId, role: 'empresa' };

    const expired = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'Documento vencido teste do log', $2, $2, 'application/pdf', 100, (now() - interval '5 days')::date, $3, 'empresa')
       RETURNING id`,
      [tenant.tenantId, `fixture/${tenant.tenantId}-log.pdf`, tenant.userId],
    );
    expiredDocumentId = expired.rows[0].id;

    const src = await client.query(
      `INSERT INTO official_sources (entity, code, title, official_url)
       VALUES ('MTE', 'NR-LOGUSO', 'Norma teste do log de uso', 'https://exemplo.gov.br/loguso.html') RETURNING id`,
    );
    sourceId = src.rows[0].id;
    const doc = await client.query(
      `INSERT INTO normative_documents (source_id, status, content_hash, file_key, file_name, mime_type, raw_text, indexed_at)
       VALUES ($1, 'vigente', 'hash-loguso', 'normative/loguso.html', 'loguso.html', 'text/html', 'Texto vigente do log', now())
       RETURNING id`,
      [sourceId],
    );
    documentId = doc.rows[0].id;
    const chunk = await client.query(
      `INSERT INTO normative_document_chunks (document_id, chunk_index, content, embedding)
       VALUES ($1, 0, $2, $3::vector) RETURNING id`,
      [documentId, CHUNK_TEXT, toVectorLiteral(exactVector)],
    );
    chunkId = chunk.rows[0].id;
  });

  beforeEach(() => {
    fakeEmbed.mockResolvedValue(exactVector);
  });

  afterEach(() => {
    fakeAnswer.mockReset();
    fakeEmbed.mockReset();
    process.env.ASSISTANT_QUERY_LOG_DISABLED = 'false';
  });

  afterAll(async () => {
    const client = (db as any).client;
    await client.query('DELETE FROM assistant_query_log WHERE question_hash = ANY($1)', [hashesToClean]);
    await client.query('DELETE FROM documents WHERE id = $1', [expiredDocumentId]);
    await client.query('DELETE FROM normative_document_chunks WHERE document_id = $1', [documentId]);
    await client.query('DELETE FROM normative_documents WHERE id = $1', [documentId]);
    await client.query('DELETE FROM official_sources WHERE id = $1', [sourceId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
    if (previousFlag === undefined) delete process.env.ASSISTANT_QUERY_LOG_DISABLED;
    else process.env.ASSISTANT_QUERY_LOG_DISABLED = previousFlag;
  });

  it('uma pergunta grava exatamente 1 linha e nenhuma coluna contém o texto da pergunta nem da resposta', async () => {
    const question = uniqueQuestion();
    const answerText = 'É obrigatório o uso de luvas de proteção.';
    fakeAnswer.mockResolvedValue([claim(answerText, { chunk_ids: [chunkId] })]);

    const result = await assistant.query(question, empresa);
    expect(result.answer).toBe(answerText);

    const hash = hashQuestion(question);
    const rows = await waitForRows(hash);
    expect(rows).toHaveLength(1);
    // Nenhuma linha duplicada aparece depois.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await rowsByHash(hash)).toHaveLength(1);

    const row = rows[0];
    expect(row).toMatchObject({
      role: 'empresa',
      tenant_id: null,
      outcome: 'respondeu',
      claims_total: 1,
      claims_dropped_ids: 0,
      claims_dropped_support: 0,
      used_attachment: false,
    });
    expect(row.retrieved.normative.find((c: any) => c.chunk_id === chunkId)).toMatchObject({
      source_code: 'NR-LOGUSO',
      passed_threshold: true,
    });
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(question);
    expect(serialized).not.toContain('luvas de proteção');
  });

  it('grava os tipos de aviso disparados pela pergunta', async () => {
    const question = uniqueQuestion('Quais as regras de PPCI?');
    fakeAnswer.mockResolvedValue([]);

    await assistant.query(question, empresa);

    const rows = await waitForRows(hashQuestion(question));
    expect(rows).toHaveLength(1);
    expect(rows[0].notices).toEqual(['jurisdicao']);
  });

  it('privacidade dos tokens: só grava item/NR inventado quando a claim cita apenas trecho normativo', async () => {
    const apenasNormativo = uniqueQuestion();
    fakeAnswer.mockResolvedValue([claim('Conforme o item 99.9.9, a luva é obrigatória.', { chunk_ids: [chunkId] })]);
    await assistant.query(apenasNormativo, empresa);

    const comEmpresa = uniqueQuestion();
    fakeAnswer.mockResolvedValue([
      claim('Conforme o item 99.9.9 e a sua pendência.', { chunk_ids: [chunkId], operational_ref_ids: ['op-0'] }),
    ]);
    await assistant.query(comEmpresa, empresa, undefined, empresa.tenantId ?? undefined);

    const [rowNormativo] = await waitForRows(hashQuestion(apenasNormativo));
    expect(rowNormativo.claims_dropped_support).toBe(1);
    expect(rowNormativo.blocking_tokens).toEqual(['item 99.9.9']);

    const [rowEmpresa] = await waitForRows(hashQuestion(comEmpresa));
    expect(rowEmpresa.tenant_id).toBe(empresa.tenantId);
    expect(rowEmpresa.claims_dropped_support).toBe(1);
    expect(rowEmpresa.blocking_tokens).toEqual([]);
    expect(rowEmpresa.retrieved.operational_count).toBeGreaterThan(0);
  });

  it('o interruptor ASSISTANT_QUERY_LOG_DISABLED impede a gravação', async () => {
    process.env.ASSISTANT_QUERY_LOG_DISABLED = 'true';
    const question = uniqueQuestion();
    fakeAnswer.mockResolvedValue([claim('É obrigatório o uso de luvas de proteção.', { chunk_ids: [chunkId] })]);

    await assistant.query(question, empresa);

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await rowsByHash(hashQuestion(question))).toHaveLength(0);
  });

  it('falha na gravação nunca derruba: record() resolve mesmo com uma linha inválida, e nada é gravado', async () => {
    const question = uniqueQuestion();
    fakeAnswer.mockResolvedValue([claim('É obrigatório o uso de luvas de proteção.', { chunk_ids: [chunkId] })]);
    process.env.ASSISTANT_QUERY_LOG_DISABLED = 'true'; // este queryWithTrace não deve gravar por conta própria
    const { trace } = await assistant.queryWithTrace(question, empresa);
    process.env.ASSISTANT_QUERY_LOG_DISABLED = 'false';

    await expect(logService.record({ ...trace, outcome: 'invalido' as any })).resolves.toBeUndefined();

    expect(await rowsByHash(trace.question_hash)).toHaveLength(0);
  });

  it('RLS: a empresa não lê o log, o admin lê', async () => {
    const question = uniqueQuestion();
    fakeAnswer.mockResolvedValue([claim('É obrigatório o uso de luvas de proteção.', { chunk_ids: [chunkId] })]);
    await assistant.query(question, empresa);
    const hash = hashQuestion(question);
    await waitForRows(hash);

    const asEmpresa = await database.withTenantContext(
      { role: 'empresa', tenantId: empresa.tenantId ?? undefined, userId: empresa.id },
      (client) => client.query('SELECT count(*)::int AS n FROM assistant_query_log WHERE question_hash = $1', [hash]),
    );
    expect(asEmpresa.rows[0].n).toBe(0);

    const asAdmin = await database.withTenantContext({ role: 'admin' }, (client) =>
      client.query('SELECT count(*)::int AS n FROM assistant_query_log WHERE question_hash = $1', [hash]),
    );
    expect(asAdmin.rows[0].n).toBe(1);
  });

  it('retenção: purgeOlderThan(90) apaga a linha antiga e preserva a recente', async () => {
    const oldHash = `purge-antiga-${randomUUID()}`;
    const recentHash = `purge-recente-${randomUUID()}`;
    hashesToClean.push(oldHash, recentHash);
    const insert = `INSERT INTO assistant_query_log
      (created_at, role, question_hash, outcome, retrieved, claims_total, claims_dropped_ids, claims_dropped_support, latency_ms, retrieval_ms)
      VALUES (now() - ($2 || ' days')::interval, 'empresa', $1, 'respondeu', '{}'::jsonb, 0, 0, 0, 1, 1)`;
    await (db as any).client.query(insert, [oldHash, '100']);
    await (db as any).client.query(insert, [recentHash, '10']);

    const deleted = await logService.purgeOlderThan(90);

    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await rowsByHash(oldHash)).toHaveLength(0);
    expect(await rowsByHash(recentHash)).toHaveLength(1);
  });
});
```

Run: `/opt/Montese/run-backend-tests.sh test:e2e -- --testPathPattern assistant-query-log --forceExit`
Expected: FAIL de compilação — `Cannot find module '../src/normative/assistant-query-log.service'`.

- [ ] **Step 6: Criar o serviço de log**

Criar `backend/src/normative/assistant-query-log.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../common/database/database.service';
import { QueryTrace } from './query-trace';

// Retenção do log de uso (spec docs/specs/assistente-confiabilidade-etapa-2-3.md §4.3).
export const QUERY_LOG_RETENTION_DAYS = 90;

// Grava o trace de cada pergunta real em assistant_query_log — só metadados e
// ids, nunca texto (ver a migration 0051 e query-trace.ts).
@Injectable()
export class AssistantQueryLogService {
  private readonly logger = new Logger(AssistantQueryLogService.name);

  constructor(private readonly db: DatabaseService) {}

  // Nunca lança: registrar uso é best-effort e jamais pode atrasar nem derrubar
  // a resposta ao usuário (quem chama não espera por isto). Sem RETURNING: o
  // RETURNING exigiria passar pela policy de SELECT, que é só do admin.
  async record(trace: QueryTrace): Promise<void> {
    // Interruptor por ambiente: os e2e rodam contra o Postgres de produção e
    // (todos, inclusive os de outros módulos) chamam o Assistente — sem isto
    // cada execução da suíte gravaria linhas de teste no log de uso real e
    // poluiria as estatísticas que este log existe para medir.
    // test/jest-e2e-setup.js liga o interruptor; só o e2e do próprio log o desliga.
    if (process.env.ASSISTANT_QUERY_LOG_DISABLED === 'true') return;
    try {
      const retrieved = {
        threshold: trace.threshold,
        chunk_limit: trace.chunk_limit,
        normative: trace.normative,
        checklist: trace.checklist,
        company: trace.company,
        operational_count: trace.operational_count,
      };
      await this.db.withoutTenantContext((client) =>
        client.query(
          `INSERT INTO assistant_query_log
             (role, tenant_id, question_hash, outcome, notices, retrieved,
              claims_total, claims_dropped_ids, claims_dropped_support,
              blocking_tokens, flagged_numbers, used_attachment, model,
              latency_ms, retrieval_ms)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            trace.role,
            trace.tenant_id,
            trace.question_hash,
            trace.outcome,
            trace.notices,
            JSON.stringify(retrieved),
            trace.claims_total,
            trace.claims_dropped_ids,
            trace.claims_dropped_support,
            trace.blocking_tokens,
            trace.flagged_numbers,
            trace.used_attachment,
            trace.model,
            trace.latency_ms,
            trace.retrieval_ms,
          ],
        ),
      );
    } catch (err) {
      this.logger.error('Falha ao registrar o log de uso do Assistente', (err as Error).stack);
    }
  }

  // Diário, 03:30 (depois do monitor normativo, 03:00). `runOnce`-style: a
  // lógica fica em purgeOlderThan, chamável direto pelos testes.
  @Cron('30 3 * * *')
  async handlePurgeCron(): Promise<void> {
    try {
      const deleted = await this.purgeOlderThan(QUERY_LOG_RETENTION_DAYS);
      if (deleted > 0) this.logger.log(`Log de uso do Assistente: ${deleted} linha(s) além de ${QUERY_LOG_RETENTION_DAYS} dias apagada(s)`);
    } catch (err) {
      this.logger.error('Falha ao apagar o log de uso antigo do Assistente', (err as Error).stack);
    }
  }

  // Só admin apaga (policy de DELETE); o job de sistema usa o mesmo contexto que
  // TenantContextInterceptor monta pra uma requisição de admin, como
  // VisitReminderCronService.
  async purgeOlderThan(days: number): Promise<number> {
    return this.db.withTenantContext({ role: 'admin' }, async (client) => {
      const result = await client.query(
        `DELETE FROM assistant_query_log WHERE created_at < now() - make_interval(days => $1)`,
        [days],
      );
      return result.rowCount ?? 0;
    });
  }
}
```

- [ ] **Step 7: Ligar o log ao `query()` e registrar o serviço**

Aplique, em ordem, as **6 edições** abaixo (cada `old_string` deve casar exatamente uma vez; se o serviço mudou desde a Task 6, releia e adapte):

**Edição 1 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
import { QueryOutcome, QueryTrace, hashQuestion, tokensAllowedForClaim } from './query-trace';
```
`new_string`:
```ts
import { QueryOutcome, QueryTrace, hashQuestion, tokensAllowedForClaim } from './query-trace';
import { AssistantQueryLogService } from './assistant-query-log.service';
```

**Edição 2 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
    private readonly dashboard: DashboardService,
  ) {}
```
`new_string`:
```ts
    private readonly dashboard: DashboardService,
    private readonly queryLog: AssistantQueryLogService,
  ) {}
```

**Edição 3 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
  // Mesma assinatura e mesmo retorno de sempre. O trace só serve ao runner de
  // avaliação (queryWithTrace) e, depois, ao log de uso.
```
`new_string`:
```ts
  // Mesma assinatura e mesmo retorno de sempre. Além de responder, grava o trace
  // no log de uso (só metadados e ids) — sem esperar e sem nunca derrubar a
  // resposta: record() captura qualquer erro.
```

**Edição 4 — `backend/src/normative/normative-assistant.service.ts`**

`old_string`:
```ts
    const { result } = await this.queryWithTrace(question, user, attachment, tenantId);
    return result;
```
`new_string`:
```ts
    const { result, trace } = await this.queryWithTrace(question, user, attachment, tenantId);
    void this.queryLog.record(trace);
    return result;
```

**Edição 5 — `backend/src/normative/normative.module.ts`**

`old_string`:
```ts
import { NormativeAssistantService } from './normative-assistant.service';
```
`new_string`:
```ts
import { NormativeAssistantService } from './normative-assistant.service';
import { AssistantQueryLogService } from './assistant-query-log.service';
```

**Edição 6 — `backend/src/normative/normative.module.ts`**

`old_string`:
```ts
    NormativeAssistantService,
    OpenRouterNormativeAnswerService,
```
`new_string`:
```ts
    NormativeAssistantService,
    AssistantQueryLogService,
    OpenRouterNormativeAnswerService,
```


- [ ] **Step 8: Typecheck** — comando de typecheck do backend; 0 erros.

- [ ] **Step 9: Anotar a contagem do log antes dos e2e**

Leitura (o superusuário do container ignora RLS): 

```bash
echo "SELECT count(*) FROM assistant_query_log;" | docker exec -i montese_postgres sh -c 'PGOPTIONS="-c default_transaction_read_only=on" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'
```
Anote o número (`N0`). Antes de qualquer deploy ele é `0`; depois de um deploy futuro terá linhas reais, por isso a conferência abaixo compara **antes e depois**, nunca exige zero.

- [ ] **Step 10: Rodar o e2e do log e o do trace**

Run: `/opt/Montese/run-backend-tests.sh test:e2e -- --testPathPattern "assistant-query-log|assistant-trace" --forceExit`
Expected: PASS — `assistant-query-log` (**7 testes**) e `assistant-trace` (**8 testes**).

- [ ] **Step 11: Rodar os e2e do Assistente que já existiam e conferir que o log não recebeu lixo**

Run: `/opt/Montese/run-backend-tests.sh test:e2e -- --testPathPattern "normative-assistant" --forceExit`
Expected: PASS em todas.

Repita a consulta do Step 9. Expected: **o mesmo `N0`** — o `afterAll` do e2e do log apaga o que criou, e o interruptor manteve **todos** os outros e2e fora do log de uso real. Se o número aumentou, algum e2e gravou no log: pare e investigue o interruptor (`test/jest-e2e-setup.ts`).

- [ ] **Step 12: Commit** (só se o usuário autorizou commits)

```bash
cd /opt/Montese
git add backend/db/migrations/0051_assistant_query_log.sql backend/src/normative/assistant-query-log.service.ts \
  backend/src/normative/normative-assistant.service.ts backend/src/normative/normative.module.ts \
  backend/test/jest-e2e-setup.ts backend/test/jest-e2e.json backend/test/assistant-query-log.e2e-spec.ts
git commit -m "feat: log de uso real do Assistente — só metadados e ids, RLS, retenção de 90 dias

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Runner (Camadas A e B), `usage-report` e o primeiro baseline

**Files:**
- Create: `backend/eval/run-eval.ts`, `backend/eval/usage-report.ts`, `backend/eval/baselines/<data>-retrieval.json`
- Modify: `backend/package.json` (scripts)

**Interfaces:**
- Consumes (Tasks 1–3, 5, 6): tudo de `backend/eval/`, `NormativeAssistantService.retrieve/queryWithTrace`, o dataset.
- Produces: comandos `eval:retrieval`, `eval:answer`, `eval:usage`; o baseline da Camada A **antes de qualquer mudança de chunking/busca**.

- [ ] **Step 1: Criar `run-eval.ts`**

```ts
import 'reflect-metadata';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AuthenticatedUser } from '../src/common/types';
import { DatabaseService } from '../src/common/database/database.service';
import { NormativeAssistantService } from '../src/normative/normative-assistant.service';
import { detectNotices } from '../src/normative/question-notices';
import { EvalArgs, parseEvalArgs } from './args';
import { GoldenQuestion, parseGoldenDataset } from './golden/golden-schema';
import { planLlmRun } from './llm-plan';
import {
  AnswerObservation,
  AnswerResult,
  ComparableResult,
  RetrievalResult,
  evaluateAnswer,
  evaluateRetrieval,
  findRegressions,
} from './metrics';
import {
  BaselineMeta,
  buildAnswerBaseline,
  buildRetrievalBaseline,
  datasetHash,
  formatAnswerSummary,
  formatRetrievalSummary,
  renderReviewMarkdown,
  ReviewItem,
} from './report';

// Runner de avaliação do Assistente (Etapas 2 e 3 da Confiabilidade do
// Assistente, spec docs/specs/assistente-confiabilidade-etapa-2-3.md §5).
// Sobe um contexto Nest SEM servidor HTTP e chama o mesmo
// NormativeAssistantService de produção.
//
//   eval:retrieval — Camada A: recuperação + avisos. Sem LLM de resposta (só o
//                    embedding da pergunta, centavos por rodada).
//   eval:answer    — Camada B: resposta real. Chama o LLM PAGO; exige --llm e
//                    tem teto (--max-llm-calls, padrão 15; --allow-full remove).
//
// Só LÊ o banco: queryWithTrace não grava nada (só query() grava no log de uso).
//
// Uso: ./run-backend-tests.sh eval:retrieval [-- --tipo pegadinha --out arquivo.json --compare base.json]
//      ./run-backend-tests.sh eval:answer -- --llm [--max-llm-calls 15 ...]
const DEFAULT_DATASET = join(__dirname, 'golden', 'perguntas.json');
// Usuário sintético, sem tenant: a avaliação mede só a base normativa.
const EVAL_USER: AuthenticatedUser = { id: '00000000-0000-0000-0000-000000000000', tenantId: null, role: 'tecnico' };

function selectQuestions(all: GoldenQuestion[], args: EvalArgs): GoldenQuestion[] {
  const selected = all.filter(
    (q) => (args.ids.length === 0 || args.ids.includes(q.id)) && (args.tipos.length === 0 || args.tipos.includes(q.tipo)),
  );
  if (selected.length === 0) throw new Error('Nenhuma pergunta selecionada pelos filtros --ids/--tipo');
  return selected;
}

function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'desconhecido';
  }
}

async function runRetrieval(assistant: NormativeAssistantService, questions: GoldenQuestion[], meta: Omit<BaselineMeta, 'threshold' | 'chunk_limit'>) {
  const results: RetrievalResult[] = [];
  let threshold = 0;
  let chunkLimit = 0;
  for (const [index, q] of questions.entries()) {
    const retrieval = await assistant.retrieve(q.pergunta);
    threshold = retrieval.threshold;
    chunkLimit = retrieval.chunkLimit;
    results.push(
      evaluateRetrieval(q, {
        chunks: retrieval.normativeRows.map((row) => ({
          chunk_id: row.chunk_id,
          source_code: row.source_code,
          content: row.content,
          similarity: row.similarity,
        })),
        threshold: retrieval.threshold,
        notices: detectNotices(q.pergunta).map((notice) => notice.tipo),
      }),
    );
    if ((index + 1) % 10 === 0) console.log(`  … ${index + 1}/${questions.length}`);
  }
  const baseline = buildRetrievalBaseline({ ...meta, threshold, chunk_limit: chunkLimit }, results);
  console.log(`\n${formatRetrievalSummary(baseline)}`);
  const falhas = results.filter((r) => !r.passou);
  if (falhas.length > 0) {
    console.log(`\nNão passaram (${falhas.length}): ${falhas.map((r) => r.id).join(', ')}`);
  }
  return { baseline, review: null };
}

async function fetchChunkContents(db: DatabaseService, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.withoutTenantContext((client) =>
    client.query<{ id: string; content: string }>(
      'SELECT id, content FROM normative_document_chunks WHERE id = ANY($1::uuid[])',
      [ids],
    ),
  );
  return new Map(rows.map((row) => [row.id, row.content]));
}

async function runAnswer(
  assistant: NormativeAssistantService,
  db: DatabaseService,
  questions: GoldenQuestion[],
  meta: Omit<BaselineMeta, 'threshold' | 'chunk_limit' | 'llm_calls' | 'llm_tokens_delta'>,
) {
  const startedAt = (await db.withoutTenantContext((client) => client.query<{ now: Date }>('SELECT now() AS now'))).rows[0].now;
  const results: AnswerResult[] = [];
  const review: ReviewItem[] = [];
  let threshold = 0;
  let chunkLimit = 0;
  for (const [index, q] of questions.entries()) {
    const { result, trace } = await assistant.queryWithTrace(q.pergunta, EVAL_USER);
    threshold = trace.threshold;
    chunkLimit = trace.chunk_limit;
    const contents = await fetchChunkContents(db, trace.normative.map((c) => c.chunk_id));
    const observation: AnswerObservation = {
      answer: result.answer,
      notices: trace.notices,
      retrieved: trace.normative.map((c) => ({
        chunk_id: c.chunk_id,
        source_code: c.source_code,
        content: contents.get(c.chunk_id) ?? '',
        similarity: c.similarity,
      })),
      kept_claims_chunk_ids: trace.kept_claims.map((claim) => claim.chunk_ids),
      claims_dropped_support: trace.claims_dropped_support,
      flagged_numbers: trace.flagged_numbers,
    };
    const evaluated = evaluateAnswer(q, observation);
    results.push(evaluated);
    review.push({
      id: q.id,
      tipo: q.tipo,
      pergunta: q.pergunta,
      resposta_esperada: q.resposta_esperada,
      answer: result.answer,
      notices: trace.notices,
      citations: result.citations.map((citation) => citation.title),
      passou: evaluated.passou,
    });
    console.log(`  ${index + 1}/${questions.length} ${q.id}: ${evaluated.passou ? 'passou' : 'NÃO passou'}`);
  }
  const tokens = (
    await db.withoutTenantContext((client) =>
      client.query<{ tokens: number }>(
        `SELECT COALESCE(SUM(total_tokens), 0)::int AS tokens FROM minimax_usage_log
         WHERE capability = 'assistant_normative_query' AND created_at >= $1`,
        [startedAt],
      ),
    )
  ).rows[0].tokens;
  const baseline = buildAnswerBaseline(
    { ...meta, threshold, chunk_limit: chunkLimit, llm_calls: questions.length, llm_tokens_delta: tokens },
    results,
  );
  console.log(`\n${formatAnswerSummary(baseline)}`);
  console.log('\n(o gasto em tokens soma o de qualquer uso real que tenha ocorrido no mesmo intervalo)');
  return { baseline, review };
}

async function main() {
  const [layer, ...rest] = process.argv.slice(2);
  if (layer !== 'retrieval' && layer !== 'answer') {
    console.error('Uso: run-eval.ts <retrieval|answer> [flags]');
    process.exit(1);
  }
  const args = parseEvalArgs(rest);

  const datasetJson = readFileSync(args.file ?? DEFAULT_DATASET, 'utf8');
  const dataset = parseGoldenDataset(JSON.parse(datasetJson));
  const selected = selectQuestions(dataset, args);

  let questions = selected;
  if (layer === 'answer') {
    const plan = planLlmRun(args, selected); // exige --llm; aplica o teto
    questions = plan.questions;
    console.log(
      `Camada B: ${questions.length} de ${selected.length} perguntas, ~${plan.estimatedTokens} tokens estimados ` +
        `(chamadas REAIS e PAGAS ao LLM configurado)`,
    );
  } else {
    console.log(`Camada A: ${questions.length} pergunta(s) — só embedding, sem LLM de resposta`);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  let exitCode = 0;
  try {
    const assistant = app.get(NormativeAssistantService);
    const meta = {
      layer,
      gerado_em: new Date().toISOString(),
      commit: gitCommit(),
      dataset_sha256: datasetHash(datasetJson),
      questions: questions.length,
      llm_calls: null,
      llm_tokens_delta: null,
    } as const;

    const { baseline, review } =
      layer === 'retrieval'
        ? await runRetrieval(assistant, questions, meta)
        : await runAnswer(assistant, app.get(DatabaseService), questions, meta);

    if (args.out) {
      writeFileSync(args.out, `${JSON.stringify(baseline, null, 2)}\n`);
      console.log(`\nBaseline gravado em ${args.out}`);
      if (review) {
        const markdownPath = args.out.replace(/\.json$/, '') + '.md';
        writeFileSync(markdownPath, `${renderReviewMarkdown(review)}\n`);
        console.log(`Revisão lado a lado (para o validador) gravada em ${markdownPath}`);
      }
    }

    if (args.compare) {
      const previous = JSON.parse(readFileSync(args.compare, 'utf8'));
      if (previous.meta?.layer !== layer) {
        throw new Error(`--compare aponta para um baseline da camada "${previous.meta?.layer}", esta rodada é "${layer}"`);
      }
      const regressions = findRegressions(
        previous.resultados as ComparableResult[],
        baseline.resultados as ComparableResult[],
      );
      if (regressions.length === 0) {
        console.log('\nGate: nenhuma regressão entre as perguntas validadas.');
      } else {
        console.log(`\nGate: ${regressions.length} regressão(ões) entre as perguntas validadas:`);
        for (const regression of regressions) console.log(`  - ${regression.id}: ${regression.motivo}`);
        // Camada A é determinística: reprova. Camada B oscila com o LLM: só reprova se pedido.
        if (layer === 'retrieval' || args.failOnRegression) exitCode = 1;
      }
    }
  } finally {
    await app.close();
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[eval] falhou:', err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Criar `usage-report.ts`**

```ts
import { Client } from 'pg';
import { parseEvalArgs } from './args';
import { summarizeUsage, UsageRow } from './usage-summary';

// Linha como vem do banco: `retrieved` é o jsonb inteiro do trace.
interface LogRow extends Omit<UsageRow, 'retrieved'> {
  retrieved: { normative?: UsageRow['retrieved'] } | null;
}

// eval:usage — resume o log de uso real do Assistente (assistant_query_log) dos
// últimos N dias: fallback, similaridade do melhor trecho, números sinalizados
// pelo verificador, papel, latência. É o insumo para o fundador decidir se
// números com unidade já podem virar bloqueio. Só LÊ o banco.
//
// A tabela tem RLS (leitura só do admin): a transação injeta app.role = 'admin'
// da mesma forma que DatabaseService.withTenantContext.
//
// Uso: ./run-backend-tests.sh eval:usage [-- --days 30]
async function main() {
  const { days } = parseEvalArgs(process.argv.slice(2));

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SELECT set_config('app.role', 'admin', true)");
    const { rows } = await client.query<LogRow>(
      `SELECT role, outcome, notices, retrieved, claims_total, claims_dropped_ids,
              claims_dropped_support, blocking_tokens, flagged_numbers, latency_ms
       FROM assistant_query_log
       WHERE created_at >= now() - make_interval(days => $1)`,
      [days],
    );
    await client.query('COMMIT');

    const usageRows: UsageRow[] = rows.map((row) => ({
      ...row,
      // O jsonb guarda { normative, checklist, company, ... }; o resumo usa a
      // similaridade dos trechos normativos candidatos.
      retrieved: row.retrieved?.normative ?? [],
    }));
    console.log(`Log de uso do Assistente — últimos ${days} dia(s)\n`);
    console.log(JSON.stringify(summarizeUsage(usageRows), null, 2));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[eval:usage] falhou:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Registrar os scripts**

Em `backend/package.json`, `old_string`:

```json
    "eval:notices": "tsx eval/notices-check.ts",
```
`new_string`:

```json
    "eval:notices": "tsx eval/notices-check.ts",
    "eval:retrieval": "tsx eval/run-eval.ts retrieval",
    "eval:answer": "tsx eval/run-eval.ts answer",
    "eval:usage": "tsx eval/usage-report.ts",
```

- [ ] **Step 4: Typecheck** — comando de typecheck do backend; 0 erros.

- [ ] **Step 5: Verificações sem custo e sem chamar IA**

Run: `/opt/Montese/run-backend-tests.sh eval:retrieval -- --ids NAO-EXISTE 2>&1 | tail -2`
Expected: `[eval] falhou: Nenhuma pergunta selecionada pelos filtros --ids/--tipo` (falha antes de subir o Nest e sem custo).

Run: `/opt/Montese/run-backend-tests.sh eval:answer 2>&1 | tail -2`
Expected: `[eval] falhou: eval:answer chama o LLM real e PAGO — rode com --llm …` (sem `--llm` recusa antes de qualquer chamada).

Run: `/opt/Montese/run-backend-tests.sh eval:usage 2>&1 | tail -22`
Expected: JSON com `"total"` (0 ou o volume real dos últimos 30 dias), `"taxa_fallback"` e os demais campos — só leitura, sem custo.

- [ ] **Step 6: 🛑 PARAR — pedir ok para a primeira rodada da Camada A**

A Camada A chama o **embedding** (OpenRouter) uma vez por pergunta: ~60 chamadas, **centavos**. Não há LLM de resposta. Dizer ao usuário: "Vou rodar a Camada A nas 60 perguntas (só embeddings, centavos) para gerar o primeiro baseline, **antes de qualquer mudança de chunking ou busca**. Posso rodar?" Só prossiga com o ok.

- [ ] **Step 7: Gerar o primeiro baseline (Camada A)**

```bash
cd /opt/Montese
/opt/Montese/run-backend-tests.sh eval:retrieval -- --out eval/baselines/$(date +%F)-retrieval.json
```
Expected: `Camada A: 60 pergunta(s) — só embedding, sem LLM de resposta`, o resumo (linhas `GERAL`, `validado (gate)`, `rascunho` e uma por tipo) e `Baseline gravado em eval/baselines/<data>-retrieval.json`. **Guarde o resumo impresso**: os números de "acerto NR" e "acerto item" são o que quantifica o problema do chunking (o acerto de item deve sair bem abaixo do acerto de NR).

- [ ] **Step 8: Verificar o gate com uma regressão simulada (Camada A)**

O dataset ainda não tem pergunta `validado`, então o gate se exercita com arquivos temporários (custa 1 embedding):

```bash
TMP=$(mktemp -d)
python3 - "$TMP" <<'PY'
import json, sys
tmp = sys.argv[1]
q = {"id": "NR35-900", "tipo": "conceitual", "categoria": "NR-35", "subcategoria": "Teste do gate",
     "pergunta": "Qual é a capital da França?", "resposta_esperada": "x", "comportamento_esperado": "responder",
     "fontes_esperadas": [{"fonte": "norma", "source_code": "NR-35", "item": "35.4.1",
        "evidencia": "35.4.1 Todo trabalho em altura deve ser realizado por trabalhador formalmente autorizado pela organização."}],
     "avisos_esperados": [], "jurisdicao": "federal", "risco_resposta": "baixo",
     "versao_fonte": None, "data_verificacao": None, "status": "validado",
     "gerado_por": "teste do gate", "validado_por": "Teste", "validado_em": "2026-09-20"}
json.dump([q], open(tmp + "/dataset.json", "w"), ensure_ascii=False)
base = {"meta": {"layer": "retrieval"}, "resultados": [{"id": "NR35-900", "status": "validado", "passou": True}]}
json.dump(base, open(tmp + "/baseline.json", "w"))
PY
/opt/Montese/run-backend-tests.sh eval:retrieval -- --file "$TMP/dataset.json" --compare "$TMP/baseline.json" 2>&1 | grep -E "Gate|NR35-900"; echo "exit=${PIPESTATUS[0]}"
rm -rf "$TMP"
```
Expected: `Gate: 1 regressão(ões) entre as perguntas validadas:`, `- NR35-900: passava no baseline e deixou de passar` e `exit=1` (a pergunta sobre a França não recupera o item 35.4.1, e o baseline afirmava que passava).

- [ ] **Step 9: Commit** (só se o usuário autorizou commits)

```bash
cd /opt/Montese
git add backend/eval/run-eval.ts backend/eval/usage-report.ts backend/package.json backend/eval/baselines/
git commit -m "feat: runner de avaliação (camadas A e B), eval:usage e o baseline da camada A antes de mexer em chunking

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Camada B — baseline em amostra (chamadas REAIS e PAGAS)

**Files:**
- Create: `backend/eval/baselines/<data>-answer.json` e `backend/eval/baselines/<data>-answer.md`

**Interfaces:**
- Consumes (Task 8): `eval:answer`.
- Produces: o baseline da Camada B e o markdown lado a lado para o validador.

> 🛑 Esta task chama o **LLM real e pago**. O histórico do projeto tem um estouro de crédito por chamada sem limite; **não execute sem o ok explícito do usuário com o teto à vista**.

- [ ] **Step 1: Mostrar a estimativa e pedir o ok**

Dizer ao usuário, com os números: "Camada B em amostra: **15 perguntas** (uma de cada tipo por rodada), ~**4,3 mil tokens** cada ≈ **64 mil tokens** no provedor configurado (MiniMax). Sem `--allow-full`, o runner nunca passa de 15. O gasto se soma ao do uso real no `minimax_usage_log`. Posso rodar?" Só prossiga com o ok. Se o usuário quiser outro teto, use `--max-llm-calls N`.

- [ ] **Step 2: Rodar a amostra**

```bash
cd /opt/Montese
/opt/Montese/run-backend-tests.sh eval:answer -- --llm --max-llm-calls 15 --out eval/baselines/$(date +%F)-answer.json
```
Expected: `Camada B: 15 de 60 perguntas, ~64500 tokens estimados (chamadas REAIS e PAGAS …)`, uma linha `n/15 <id>: passou|NÃO passou` por pergunta, o resumo com `chamadas ao LLM`, `tokens <n>`, `claims descartadas` e `números sinalizados`, e a gravação de `<data>-answer.json` **e** `<data>-answer.md`.

Se o runner falhar por credencial (`Assistente ainda não está disponível`), **pare e avise o usuário** — não procure nem exponha a chave.

- [ ] **Step 3: Ler o resultado com o usuário**

Reporte: (a) quantas passaram por tipo; (b) `claims descartadas por suporte` e `números sinalizados` — o dado que faltava para o fundador decidir se números com unidade podem virar bloqueio; (c) que **o markdown `<data>-answer.md` é o material para o profissional validar as perguntas** (a métrica não julga a prosa). Não afirme que o Assistente "está correto" com base nesses números.

- [ ] **Step 4: Commit** (só se o usuário autorizou commits)

```bash
cd /opt/Montese
git add backend/eval/baselines/
git commit -m "feat: baseline da camada B (amostra de 15) e revisão lado a lado para o validador

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Higiene do baseline de testes e documentação

**Files:**
- Modify: `backend/test/normative-openrouter-answer.e2e-spec.ts`, `docs/specs/assistente-confiabilidade-etapa-2-3.md`, `docs/assistente-montese-principios.md`, `docs/roadmap.md`

**Interfaces:** nenhuma (correção de teste e texto).

- [ ] **Step 1: Consertar o teste pré-existente que reprova a linha de base**

O teste espera `DADO,` mas o prompt (correto) diz `DADOS, nunca instrução` — o descompasso é antigo (existe em `main` desde a Fase 10). A correção certa é na regex do spec. Em `backend/test/normative-openrouter-answer.e2e-spec.ts`, `old_string`:

```ts
    expect(systemMessage).toMatch(/DADO,\s+nunca\s+instrução/);
```
`new_string`:

```ts
    expect(systemMessage).toMatch(/DADOS,\s+nunca\s+instrução/);
```

Run: `/opt/Montese/run-backend-tests.sh test:e2e -- --testPathPattern normative-openrouter-answer --forceExit`
Expected: PASS em todos os testes da suíte (o que falhava antes agora passa). Se outro teste dessa suíte falhar, **não mexa em mais nada**: reporte.

- [ ] **Step 2: Gravar na spec o que a implementação esclareceu (§3.5)**

Em `docs/specs/assistente-confiabilidade-etapa-2-3.md`, `old_string`:

```
(quebras de linha, espaços duplos) nos dois lados, e que o `item` aparece
no trecho ou imediatamente antes dele. Também grava `versao_fonte` a partir
```
`new_string`:

```
(quebras de linha, espaços duplos) nos dois lados, e que a `evidencia`
**começa pelo número do `item`** ("35.4.1 Todo trabalho em altura deve…") —
isso ancora a citação numa seção real e a distingue do sumário que abre as
NRs e repete os títulos. Também rejeita citação com artefato de página no
meio (`-- 2 of 12 --`, "Este texto não substitui o publicado no DOU") e
citação que é só o título. Também grava `versao_fonte` a partir
```

- [ ] **Step 3: Registrar o mecanismo nos princípios**

Em `docs/assistente-montese-principios.md`, `old_string`:

```
Spec: `docs/specs/assistente-confiabilidade-etapa-1.md`.
```
`new_string`:

```
Spec: `docs/specs/assistente-confiabilidade-etapa-1.md`.

A qualidade do Assistente é medida, não presumida: o banco de perguntas golden
(`backend/eval/golden/perguntas.json`) e o runner (`npm run eval:retrieval`,
`eval:answer`) comparam qualquer mudança de chunking, busca, prompt, modelo ou
limiar com um baseline versionado (`backend/eval/baselines/`); só perguntas
`validado` por um profissional de SST reprovam o gate. O uso real é registrado
apenas como metadados em `assistant_query_log` (sem texto de pergunta, claim ou
resposta; 90 dias). Spec: `docs/specs/assistente-confiabilidade-etapa-2-3.md`.
```

- [ ] **Step 4: Registrar no roadmap**

Acrescentar ao **fim** de `docs/roadmap.md`:

```bash
cat >> /opt/Montese/docs/roadmap.md <<'EOF'

## Confiabilidade do Assistente — Etapas 1, 2 e 3: status

Série que saiu da auditoria dos agentes Montese SST (2026-09-20).

- **Etapa 1** (em `main`): avisos determinísticos de jurisdição/atribuição/contexto,
  Verificador v2 (item e NR citados precisam constar nas fontes da claim) e monitor
  normativo com estado por fonte e alerta por e-mail. Spec:
  [`docs/specs/assistente-confiabilidade-etapa-1.md`](specs/assistente-confiabilidade-etapa-1.md).
- **Etapas 2 e 3**: banco de perguntas golden (60, `status: rascunho` até a validação de
  um profissional de SST), runner de avaliação em duas camadas com baseline versionado e
  log de uso real só com metadados. Spec:
  [`docs/specs/assistente-confiabilidade-etapa-2-3.md`](specs/assistente-confiabilidade-etapa-2-3.md).
  Comandos: `eval:lint`, `eval:nr`, `eval:notices` (grátis, só leitura), `eval:retrieval`
  (Camada A, centavos de embedding), `eval:answer -- --llm` (Camada B, LLM pago, teto de
  15), `eval:usage`. Baselines em `backend/eval/baselines/`.
- **Pendências do fundador:** definir quem valida o dataset (`validado_por`); registrar o
  log de uso em `docs/compliance/lgpd-compliance.md`; decidir, com o `eval:usage` e a
  Camada B na mão, se números com unidade sem base podem virar bloqueio; decidir o
  guard de evidência vazia do verificador (claim sobre imagem anexada passa sem checagem).
- **Próxima etapa (guiada pelo baseline):** chunking estrutural e busca híbrida.
EOF
```

- [ ] **Step 5: Verificação final**

Run: comando de typecheck do backend; `/opt/Montese/run-backend-tests.sh test:unit`; `/opt/Montese/run-backend-tests.sh test:e2e -- --testPathPattern "normative|assistant-" --forceExit`.
Expected: tsc sem erros; **unitário completo verde** (as 6 suítes do `eval` + `query-trace` + `golden-dataset` incluídas); e2e do domínio normativo todo verde (incluindo `normative-openrouter-answer`, agora consertada). Conferir que a contagem do log de uso real continua igual à anotada na Task 7 (Step 9) — nenhum e2e gravou linha de teste.

- [ ] **Step 6: Commit** (só se o usuário autorizou commits)

```bash
cd /opt/Montese
git add backend/test/normative-openrouter-answer.e2e-spec.ts docs/specs/assistente-confiabilidade-etapa-2-3.md \
  docs/assistente-montese-principios.md docs/roadmap.md
git commit -m "docs: esclarece as regras do lint, registra o mecanismo de avaliação e conserta a regex do teste do openrouter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Rollback

Tudo é aditivo. Código: `git revert` dos commits (ou descartar o diff se não commitado). Banco: a tabela `assistant_query_log` pode ficar — o código antigo a ignora. Se for preciso removê-la, `DROP TABLE assistant_query_log` **só com autorização explícita do usuário** (DDL em produção); o job de retenção já limita o crescimento a 90 dias.

## Self-Review

**Cobertura da spec:** §3.1–3.7 (dataset, schema, lint, gate, segunda leva) → Tasks 1, 4, 5 (segunda leva fica explicitamente fora: `fonte: 'checklist'` é rejeitada pelo schema); §4.1 refatoração aditiva → Task 6; §4.2 `QueryTrace` → Task 6; §4.3 `assistant_query_log` (colunas, privacidade dos tokens, RLS, 90 dias, nunca bloqueia) → Task 7; §4.4 runner não escreve na tabela → Task 8 (usa `queryWithTrace`); §4.5 `usage-report` → Task 8; §5.1 execução/comandos → Tasks 4 e 8; §5.2 Camada A → Tasks 2 e 8; §5.3 Camada B (teto, estimativa, regras, markdown do validador) → Tasks 2, 3, 8 e 9; §5.4 baseline e gate (Camada A exit 1; B só com flag) → Tasks 2, 8 e 9; §6 custo e segurança → Global Constraints e os portões das Tasks 7, 8 e 9; §7 testes → unitários (Tasks 1–3, 5, 6) e e2e (Tasks 6 e 7); §8 ordem e coordenação → tabela "Ordem de execução e portões"; §9 riscos → o lint trata artefato de página e hifenização; §10 critérios de sucesso → Task 5 Step 6/7 (100% das evidências), Tasks 8–9 (baselines), Task 7 (log sem texto, com e2e), Task 6 Step 7 (e2e existentes intactos), Task 8 Step 8 (gate com exit 1).

**Consistência de tipos e nomes:** `RetrievedChunkObs`, `RetrievalObservation`, `AnswerObservation` definidos na Task 2 e usados na 8; `EvalArgs.grep` definido na Task 3 e usado na 4; `QueryTrace`/`hashQuestion`/`tokensAllowedForClaim` da Task 6 usados nas Tasks 7 e 8; `ReferenceRetrieval.normativeRows` (Task 6) alimenta `run-eval.ts` (Task 8); `modelName` (interface e provedores, Task 6) lido em `finish()`; `ASSISTANT_QUERY_LOG_DISABLED` definido na Task 7 (setup e serviço) e usado no e2e do log. O `assistant-trace.e2e-spec.ts` **não** liga o log (a chave vem `true` do setup, criado na Task 7 — na Task 6 o `query()` ainda não grava, então não há efeito).
