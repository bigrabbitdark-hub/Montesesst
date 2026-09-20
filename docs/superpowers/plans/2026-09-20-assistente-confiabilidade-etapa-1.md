# Confiabilidade do Assistente — Etapa 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar quatro lacunas do Assistente RAG e do monitor normativo — avisos determinísticos de jurisdição/atribuição/contexto, verificador que confere item e NR citados contra as fontes, monitor observável com alerta por e-mail, e docs atualizados — sem tocar em chunking, busca ou embeddings.

**Architecture:** Duas funções puras novas (`question-notices.ts`, `claim-support.ts`) chamadas de dentro de `NormativeAssistantService.query()`; `NormativeQueryResult` ganha `notices` (só aditivo). O monitor (`NormativeMonitorService`) passa a gravar estado por fonte em colunas novas de `official_sources` (migration `0050`) e manda um e-mail-resumo só na anomalia, reaproveitando `EmailService`. Nada de arquitetura paralela: tudo estende o pipeline existente de `backend/src/normative/`.

**Tech Stack:** NestJS + Postgres (`pg` puro, pgvector) + Jest/ts-jest (unit `*.unit-spec.ts`, e2e `*.e2e-spec.ts`) + Next.js 14 (App Router, sem test runner no frontend).

**Spec:** `docs/specs/assistente-confiabilidade-etapa-1.md` (aprovada em 2026-09-20). Executores leem a spec e este plano juntos.

## Global Constraints

Toda task abaixo herda estas regras.

- Os módulos novos são **funções puras**: sem I/O, sem LLM, sem dependência de NestJS.
- Textos fixos dos avisos (copiar exatamente):
  - `jurisdicao`: "A base atual só contém as Normas Regulamentadoras federais (MTE). Exigências estaduais e municipais — como as do Corpo de Bombeiros, licenciamento e alvarás — não estão na base. Informe o estado e o município e confirme com o órgão competente."
  - `profissional_habilitado`: "Posso explicar o que a norma exige, mas quem executa ou assina este serviço depende da habilitação legal do profissional. Confirme com o conselho profissional competente."
  - `contexto`: "Para uma resposta precisa, informe o número de empregados, a atividade (CNAE), o grau de risco e o estado da empresa."
- Texto do fallback (copiar exatamente): "Não encontrei fundamento suficiente nas fontes consultadas para afirmar isso. Isso não significa que a exigência não exista, só que não a localizei."
- No máximo **um aviso por tipo**, sempre na ordem `jurisdicao`, `profissional_habilitado`, `contexto`.
- `NormativeQueryResult.notices` é **sempre presente** (lista possivelmente vazia) nos três pontos de retorno de `query()`. Mudança só aditiva.
- Verificador v2: **bloqueia** (descarta a claim) item `X.Y.Z` e `NR-XX` ausentes das fontes que a própria claim cita; **só registra** número com unidade. Item pai é apoiado por descendente (`35.4` apoiado por `35.4.4`). O código e o título da fonte (`NR-35 …`) contam como evidência do chunk.
- Logs do verificador levam **ids das fontes e tokens sinalizados, nunca o texto da pergunta nem da claim** (LGPD).
- `NormativeClaim` e o formato de resposta ao cliente não mudam (além de `notices`).
- Migration `0050` é **somente aditiva** (4 colunas com default/NULL em `official_sources`) e **só é aplicada com o ok explícito do fundador**, depois de confirmar backup do dia.
- E-mail do monitor: **só** quando uma fonte atinge **exatamente** 2 falhas seguidas ou quando entra versão nova como `aguardando_validacao`; **um único e-mail-resumo por execução** para cada usuário `role='admin'` e `status='ativo'` (buscados com `withTenantContext({ role: 'admin' })`); falha de envio só vai para o log.
- `runOnce(options?: { onlySourceIds?: string[] })`: o cron chama sem argumento. **Todo e2e do monitor passa `onlySourceIds` e mocka `EmailService`** — os e2e rodam contra o Postgres de produção (36 NRs reais) e não podem gravar estado nelas nem mandar e-mail real.
- Os e2e (`./run-backend-tests.sh test:e2e …`) rodam contra o **mesmo Postgres de produção**, sem banco de teste isolado — padrão deliberado do projeto. Lógica pura vai em `*.unit-spec.ts` (sem banco).
- **Proibido:** `docker compose config`, `docker compose down -v`/`--volumes`, `docker volume rm/prune`, `docker inspect` sem `--format` de nome, `docker exec … env`/`printenv`; ler `.env` ou `docker-compose.override.yml`; `git add -A` / `git add .` (a árvore tem muitos arquivos alheios não commitados — sempre `git add` de caminhos explícitos).
- **Commits só se o usuário autorizou commits nesta sessão.** Se não autorizou, cada step "Commit" vira: parar, listar os arquivos alterados e perguntar. Mensagens em português, prefixo `feat:`/`fix:`/`docs:`/`test:`, terminadas com a linha `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Deploy (rebuild/restart de container) **não faz parte deste plano** — só com ordem explícita do usuário.
- Regex de remoção de acentos usa `\p{M}` com a flag `u` (não usar escapes `\u…` no código: a ferramenta de edição pode expandi-los).
- Comentários e mensagens em português (padrão do repo).
- **Não mudar:** chunking, threshold (0.4), top-K, embeddings, prompts dos outros agentes, catálogo SST (`sst-checklist`).

## Comandos de verificação (referência)

- Unit: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern <nome>`
- e2e: `/opt/Montese/run-backend-tests.sh test:e2e -- --testPathPattern <nome>`
- Typecheck backend: `cd /opt/Montese/backend && PATH="/root/.nvm/versions/node/v20.20.2/bin:$PATH" npx tsc --noEmit -p tsconfig.json` (inclui `test/`)
- Typecheck frontend: `cd /opt/Montese/frontend && PATH="/root/.nvm/versions/node/v20.20.2/bin:$PATH" npx tsc --noEmit --incremental false`
- Consulta de leitura ao banco (sempre read-only, sem segredos):
  `echo "<SQL>" | docker exec -i montese_postgres sh -c 'PGOPTIONS="-c default_transaction_read_only=on" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'`

## Coordenação com o plano do checklist SST

`docs/superpowers/plans/2026-09-17-checklist-sst-conhecimento-assistente.md` (Task 3, **ainda não executada**) também edita `normative-assistant.service.ts`, `normative-answer-shared.ts` e a interface do provider. Não há conflito hoje. Quando aquela Task 3 for executada depois desta etapa, ela precisa (a) somar o texto dos itens do checklist à lista de evidências do `checkClaimSupport` (mesma função `evidenceTexts` da Task 3 daqui) e (b) reconciliar os números de linha, que terão mudado.

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `backend/src/normative/question-notices.ts` | Criar | `detectNotices(question)` — gatilhos determinísticos → avisos fixos |
| `backend/test/question-notices.unit-spec.ts` | Criar | Testes unitários dos gatilhos |
| `backend/src/normative/claim-support.ts` | Criar | `checkClaimSupport(claim, evidenceTexts)` — item/NR bloqueiam, número só registra |
| `backend/test/claim-support.unit-spec.ts` | Criar | Testes unitários do verificador |
| `backend/src/normative/normative-assistant.service.ts` | Modificar | Chama os dois módulos; `notices`; `source_code`; novo fallback; logs |
| `backend/src/normative/normative-answer-shared.ts` | Modificar | Regra nova no `SYSTEM_PROMPT` |
| `backend/test/normative-answer-shared.unit-spec.ts` | Modificar | Teste da regra do prompt |
| `backend/test/normative-assistant.e2e-spec.ts` | Modificar | Fallback novo + casos novos (verificador, avisos) |
| `frontend/src/components/AssistantChat.tsx` | Modificar | Renderiza `notices` numa caixa âmbar |
| `backend/db/migrations/0050_official_sources_monitor_state.sql` | Criar | 4 colunas de estado do monitor |
| `backend/src/normative/normative-monitor-email.ts` | Criar | `buildMonitorAlertEmail(events)` — corpo do e-mail, puro |
| `backend/test/normative-monitor-email.unit-spec.ts` | Criar | Testes unitários do e-mail |
| `backend/src/normative/normative-monitor.service.ts` | Modificar | `runOnce(options)`, estado por fonte, e-mail-resumo |
| `backend/test/normative-monitor.e2e-spec.ts` | Modificar | Escopo `onlySourceIds`, `EmailService` mockado, casos novos |
| `backend/src/normative/official-sources.service.ts` | Modificar | Interface `OfficialSource` com os campos novos |
| `frontend/src/app/admin/normativa/page.tsx` | Modificar | "verificada há X" + selo de falha |
| `docs/roadmap.md`, `backend/src/normative/normative.module.ts`, `docs/assistente-montese-principios.md` | Modificar | Docs atualizados |

---

### Task 1: Módulo puro `question-notices`

**Files:**
- Create: `backend/src/normative/question-notices.ts`
- Test: `backend/test/question-notices.unit-spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces (usadas pela Task 3):
  ```ts
  export type NoticeType = 'jurisdicao' | 'profissional_habilitado' | 'contexto';
  export interface NormativeNotice { tipo: NoticeType; texto: string }
  export function detectNotices(question: string): NormativeNotice[];
  ```

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/test/question-notices.unit-spec.ts`:

```ts
import { detectNotices } from '../src/normative/question-notices';

const tipos = (question: string) => detectNotices(question).map((n) => n.tipo);

describe('detectNotices (unit)', () => {
  it('pergunta sem gatilho não gera aviso', () => {
    expect(detectNotices('Qual o prazo de validade do ASO periódico?')).toEqual([]);
  });

  it('jurisdição: PPCI e "meu município" disparam o aviso, e "minha empresa precisa" dispara contexto — na ordem fixa', () => {
    expect(tipos('Minha empresa precisa de PPCI no meu município?')).toEqual(['jurisdicao', 'contexto']);
  });

  it('jurisdição dispara com e sem acento', () => {
    expect(tipos('Qual o alvará do Corpo de Bombeiros?')).toEqual(['jurisdicao']);
    expect(tipos('qual o alvara do corpo de bombeiros')).toEqual(['jurisdicao']);
  });

  it('jurisdição: licença ambiental, licenciamento e legislação estadual/municipal', () => {
    expect(tipos('Preciso de licença ambiental?')).toContain('jurisdicao');
    expect(tipos('Como funciona o licenciamento?')).toEqual(['jurisdicao']);
    expect(tipos('A lei municipal exige algo a mais?')).toEqual(['jurisdicao']);
  });

  it('profissional habilitado: "quem pode assinar" e ART', () => {
    expect(tipos('Quem pode assinar o PGR?')).toEqual(['profissional_habilitado']);
    expect(tipos('Preciso de ART para o laudo?')).toContain('profissional_habilitado');
  });

  it('"art." / "art" seguido de número é artigo de lei e NÃO dispara profissional_habilitado', () => {
    expect(detectNotices('O art. 157 da CLT fala de EPI?')).toEqual([]);
    expect(detectNotices('O art 157 da CLT fala de EPI?')).toEqual([]);
  });

  it('profissional habilitado: responsável técnico, RRT e "legalmente habilitado"', () => {
    expect(tipos('Quem é o responsável técnico?')).toEqual(['profissional_habilitado']);
    expect(tipos('Preciso de RRT?')).toContain('profissional_habilitado');
    expect(tipos('Isso exige profissional legalmente habilitado?')).toEqual(['profissional_habilitado']);
  });

  it('contexto: "sou obrigado" e "é obrigatório"', () => {
    expect(tipos('Sou obrigado a ter CIPA?')).toEqual(['contexto']);
    expect(tipos('É obrigatório ter brigada?')).toContain('contexto');
  });

  it('no máximo um aviso por tipo, mesmo com vários gatilhos do mesmo tipo', () => {
    const notices = detectNotices('PPCI, AVCB e bombeiros no meu estado?');
    expect(notices.filter((n) => n.tipo === 'jurisdicao')).toHaveLength(1);
  });

  it('cada aviso traz o texto fixo do seu tipo', () => {
    const [aviso] = detectNotices('Preciso de PPCI?');
    expect(aviso.tipo).toBe('jurisdicao');
    expect(aviso.texto).toContain('Normas Regulamentadoras federais');
    expect(detectNotices('Quem pode assinar o PGR?')[0].texto).toContain('conselho profissional competente');
    expect(detectNotices('Sou obrigado a ter CIPA?')[0].texto).toContain('número de empregados');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern question-notices`
Expected: FAIL — `Cannot find module '../src/normative/question-notices'`.

- [ ] **Step 3: Implementar**

Criar `backend/src/normative/question-notices.ts`:

```ts
// Avisos determinísticos por pergunta (Etapa 1 da Confiabilidade do
// Assistente, spec docs/specs/assistente-confiabilidade-etapa-1.md §3).
// Módulo puro: sem I/O, sem LLM, sem dependência de NestJS — detecta, por
// gatilhos de texto, perguntas que dependem de legislação estadual/municipal,
// de habilitação profissional ou de contexto que o usuário não informou, e
// devolve um aviso fixo por tipo. O aviso é aditivo: nunca bloqueia a
// resposta.
export type NoticeType = 'jurisdicao' | 'profissional_habilitado' | 'contexto';

export interface NormativeNotice {
  tipo: NoticeType;
  texto: string;
}

const NOTICE_TEXTS: Record<NoticeType, string> = {
  jurisdicao:
    'A base atual só contém as Normas Regulamentadoras federais (MTE). Exigências estaduais e municipais — como as do Corpo de Bombeiros, licenciamento e alvarás — não estão na base. Informe o estado e o município e confirme com o órgão competente.',
  profissional_habilitado:
    'Posso explicar o que a norma exige, mas quem executa ou assina este serviço depende da habilitação legal do profissional. Confirme com o conselho profissional competente.',
  contexto:
    'Para uma resposta precisa, informe o número de empregados, a atividade (CNAE), o grau de risco e o estado da empresa.',
};

// Ordem do array = ordem dos avisos no resultado. Os padrões rodam sobre a
// pergunta já normalizada (minúsculas, sem acentos), então "alvará" vira
// "alvara" e "município" vira "municipio".
const TRIGGERS: { tipo: NoticeType; patterns: RegExp[] }[] = [
  {
    tipo: 'jurisdicao',
    patterns: [
      /\bppci\b/,
      /\bavcb\b/,
      /\bclcb\b/,
      /\bbombeiros?\b/,
      /\balvara\b/,
      /\blicenca ambiental\b/,
      /\blicenciamento\b/,
      /\bcodigo de obras\b/,
      /\bmeu (estado|municipio|cidade)\b/,
      /\b(estadual|estaduais|municipal|municipais)\b/,
    ],
  },
  {
    tipo: 'profissional_habilitado',
    patterns: [
      /\bquem pode (assinar|emitir|elaborar|executar|realizar)\b/,
      // "art" sozinho é a ART (Anotação de Responsabilidade Técnica); "art. 157"
      // / "art 157" é artigo de lei e não pode disparar o aviso.
      /\bart\b(?!\.?\s*\d)/,
      /\brrt\b/,
      /\bresponsavel tecnico\b/,
      /\batribuic(ao|oes) profissiona(l|is)\b/,
      /\bprofissional habilitado\b/,
      /\blegalmente habilitado\b/,
      /\bassinar (o |a |um |uma )?(laudo|projeto|pgr|pcmso|ltcat|ppra|apr)\b/,
    ],
  },
  {
    tipo: 'contexto',
    patterns: [
      /\bminha empresa (precisa|tem que|deve)\b/,
      /\bsou obrigad[oa]\b/,
      /\bpreciso (ter|fazer|elaborar|implantar|de)\b/,
      /\be obrigatorio\b/,
    ],
  },
];

function normalizeQuestion(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectNotices(question: string): NormativeNotice[] {
  const normalized = normalizeQuestion(question);
  const notices: NormativeNotice[] = [];
  for (const { tipo, patterns } of TRIGGERS) {
    if (patterns.some((pattern) => pattern.test(normalized))) {
      notices.push({ tipo, texto: NOTICE_TEXTS[tipo] });
    }
  }
  return notices;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern question-notices`
Expected: PASS — 10 testes.

- [ ] **Step 5: Commit** (só se o usuário autorizou commits)

```bash
cd /opt/Montese
git add backend/src/normative/question-notices.ts backend/test/question-notices.unit-spec.ts
git commit -m "feat: avisos determinísticos de jurisdição, atribuição e contexto (question-notices)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Módulo puro `claim-support` (Verificador v2)

**Files:**
- Create: `backend/src/normative/claim-support.ts`
- Test: `backend/test/claim-support.unit-spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces (usada pela Task 3):
  ```ts
  export interface ClaimSupportResult { blocking: string[]; logged: string[] }
  export function checkClaimSupport(claimText: string, evidenceTexts: string[]): ClaimSupportResult;
  ```
  `blocking` → tokens como `'item 35.4.7'` / `'NR-18'`; `logged` → números com unidade sem base, ex. `'8 horas'`. Lista `evidenceTexts` vazia → `{ blocking: [], logged: [] }`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/test/claim-support.unit-spec.ts`:

```ts
import { checkClaimSupport } from '../src/normative/claim-support';

describe('checkClaimSupport (unit)', () => {
  describe('itens', () => {
    it('claim sem item nem NR não tem nada a bloquear', () => {
      expect(checkClaimSupport('É obrigatório o uso de capacete.', ['Trecho sobre capacete.'])).toEqual({
        blocking: [],
        logged: [],
      });
    });

    it('item presente exatamente no trecho é apoiado', () => {
      const result = checkClaimSupport('Conforme o item 35.4.4, a organização avalia a saúde.', [
        '35.4.4 Cabe à organização avaliar o estado de saúde dos empregados',
      ]);
      expect(result.blocking).toEqual([]);
    });

    it('item pai é apoiado por um trecho que contém o descendente (35.4 apoiado por 35.4.4)', () => {
      const result = checkClaimSupport('Segundo o item 35.4 há exigência de capacitação.', [
        '35.4.4 Cabe à organização avaliar o estado de saúde',
      ]);
      expect(result.blocking).toEqual([]);
    });

    it('item inventado é bloqueado', () => {
      const result = checkClaimSupport('O item 35.4.7 exige treinamento anual.', [
        '35.4.4 Cabe à organização avaliar o estado de saúde',
        '35.4.1 Outro texto qualquer',
      ]);
      expect(result.blocking).toEqual(['item 35.4.7']);
    });

    it('35.4.4 NÃO é apoiado por 35.4.44 (borda numérica)', () => {
      const result = checkClaimSupport('Conforme o item 35.4.4.', ['35.4.44 texto de outro item']);
      expect(result.blocking).toEqual(['item 35.4.4']);
    });

    it('5.4 NÃO casa dentro de 35.4 (borda à esquerda)', () => {
      const result = checkClaimSupport('Conforme o item 5.4.', ['35.4 texto de outro item']);
      expect(result.blocking).toEqual(['item 5.4']);
    });

    it('item de 3 segmentos sem a palavra "item" também é verificado', () => {
      const result = checkClaimSupport('A regra do 18.7.1 se aplica.', ['18.7.2 texto']);
      expect(result.blocking).toEqual(['item 18.7.1']);
    });

    it('milhar (2.000 e 1.000.000) não é tratado como item', () => {
      expect(checkClaimSupport('A multa é de 2.000 reais.', ['sem números aqui']).blocking).toEqual([]);
      expect(checkClaimSupport('Há 1.000.000 de casos.', ['sem números aqui']).blocking).toEqual([]);
    });

    it('a palavra "item" antes do token faz ele contar como item mesmo parecendo milhar', () => {
      const result = checkClaimSupport('Veja o item 2.000 da norma.', ['sem números aqui']);
      expect(result.blocking).toEqual(['item 2.000']);
    });

    it('decimal com unidade colada (3.5 metros) é número, não item', () => {
      const result = checkClaimSupport('A altura mínima é de 3.5 metros.', ['sem números aqui']);
      expect(result.blocking).toEqual([]);
      expect(result.logged).toEqual(['3.5 metros']);
    });

    it('data com pontos (12.09.2025) não vira o falso item 12.09', () => {
      expect(checkClaimSupport('O documento venceu em 12.09.2025.', ['sem números aqui']).blocking).toEqual([]);
    });

    it('item repetido na claim aparece uma vez só', () => {
      const result = checkClaimSupport('O item 9.9.9 e de novo o item 9.9.9.', ['nada']);
      expect(result.blocking).toEqual(['item 9.9.9']);
    });
  });

  describe('NR', () => {
    it('NR-07 e NR-7 são a mesma norma', () => {
      const result = checkClaimSupport('Conforme a NR-07, o PCMSO é obrigatório.', ['... de acordo com a NR-7 ...']);
      expect(result.blocking).toEqual([]);
    });

    it('o código da fonte, quando entra como evidência, apoia a NR citada', () => {
      const result = checkClaimSupport('Segundo a NR-35, o trabalhador precisa de capacitação.', [
        'NR-35 Trabalho em Altura',
        'Trecho que não repete o nome da norma.',
      ]);
      expect(result.blocking).toEqual([]);
    });

    it('NR citada que não está em nenhuma evidência é bloqueada', () => {
      const result = checkClaimSupport('A NR-18 também exige isso.', ['NR-35 Trabalho em Altura', 'texto']);
      expect(result.blocking).toEqual(['NR-18']);
    });
  });

  describe('números com unidade (só registrados)', () => {
    it('número por extenso na evidência vai para logged e nunca para blocking', () => {
      const result = checkClaimSupport('O prazo é de 8 horas.', ['o curso tem carga de oito horas']);
      expect(result.blocking).toEqual([]);
      expect(result.logged).toEqual(['8 horas']);
    });

    it('número com parêntese por extenso na evidência ("8 (oito) horas") é apoiado', () => {
      const result = checkClaimSupport('O curso tem 8 horas.', ['carga horária de 8 (oito) horas']);
      expect(result.logged).toEqual([]);
    });

    it('"por cento" na evidência apoia "%" na claim, e a ausência é registrada', () => {
      expect(checkClaimSupport('São 10% do total.', ['dez por cento']).logged).toEqual(['10 %']);
      expect(checkClaimSupport('São 10% do total.', ['10 por cento do total']).logged).toEqual([]);
    });

    it('valor em reais com prefixo R$ é comparado com a evidência', () => {
      expect(checkClaimSupport('A multa é de R$ 1.500,00.', ['multa de R$ 1.500,00']).logged).toEqual([]);
      expect(checkClaimSupport('A multa é de R$ 1.500,00.', ['multa qualquer']).logged).toEqual(['R$ 1.500,00']);
    });

    it('dias e meses são famílias diferentes: 30 dias não é apoiado por 30 meses', () => {
      expect(checkClaimSupport('Prazo de 30 dias.', ['prazo de 30 meses']).logged).toEqual(['30 dias']);
    });
  });

  describe('evidência ausente', () => {
    it('sem nenhum texto de evidência (claim só cita imagem anexada) nada é verificado', () => {
      expect(checkClaimSupport('Conforme o item 99.9.9 da NR-99.', [])).toEqual({ blocking: [], logged: [] });
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern claim-support`
Expected: FAIL — `Cannot find module '../src/normative/claim-support'`.

- [ ] **Step 3: Implementar**

Criar `backend/src/normative/claim-support.ts`:

```ts
// Verificador v2 (Etapa 1 da Confiabilidade do Assistente, spec
// docs/specs/assistente-confiabilidade-etapa-1.md §4). Módulo puro: sem I/O.
//
// O id-check de NormativeAssistantService só prova que o id citado existe;
// aqui checamos se o que a claim afirma sobre ITEM (35.4.4) e NR (NR-12)
// aparece de fato no texto das fontes que ela mesma cita. Item e NR são
// strings exatas — falha = a claim é descartada. Número com unidade ("8
// horas", "R$ 1.500") tem formas equivalentes ("oito horas") que ainda não
// dá para medir sem dataset, então só é registrado, nunca bloqueia.
export interface ClaimSupportResult {
  // Itens/NRs citados na claim sem base nas evidências — bloqueiam a claim.
  blocking: string[];
  // Números com unidade sem base nas evidências — só registrados.
  logged: string[];
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Família de unidade -> formas de escrita aceitas (já normalizadas).
const UNIT_FAMILIES: Record<string, string[]> = {
  percent: ['%', 'por cento'],
  real: ['reais', 'real'],
  hora: ['horas', 'hora', 'h'],
  dia: ['dias', 'dia'],
  minuto: ['minutos', 'minuto', 'min'],
  mes: ['meses', 'mes'],
  ano: ['anos', 'ano'],
  semana: ['semanas', 'semana'],
  metro: ['metros', 'metro', 'm'],
  cm: ['cm'],
  mm: ['mm'],
  kg: ['kg'],
  db: ['db'],
  grau: ['graus', 'grau', '°c'],
};

const SURFACE_TO_FAMILY = new Map<string, string>();
for (const [family, forms] of Object.entries(UNIT_FAMILIES)) {
  for (const form of forms) SURFACE_TO_FAMILY.set(form, family);
}
// Mais longas primeiro, para "horas" ganhar de "h" e "meses" de "mes".
const UNIT_ALTERNATION = Array.from(SURFACE_TO_FAMILY.keys())
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join('|');

const UNIT_RIGHT_AFTER_NUMBER = new RegExp(`^\\s*(?:${UNIT_ALTERNATION})(?![a-z])`);

// Token pontuado (35.4.4, 12.10, 2.000). Não pode começar no meio de outro
// número nem continuar em ".dígito" — assim "12.09.2025" (data) não vira o
// falso item "12.09".
const DOTTED_TOKEN = /(?<![\d.,])\d{1,2}(?:\.\d{1,3})+(?!\d|\.\d)/g;
const ITEM_KEYWORD_BEFORE = /\b(?:sub)?ite(?:m|ns)\b[^\d]{0,12}$/;
const THOUSANDS_GROUPING = /^\d{1,3}(?:\.\d{3})+$/;

function extractItemRefs(claim: string): string[] {
  const items = new Set<string>();
  for (const match of claim.matchAll(DOTTED_TOKEN)) {
    const token = match[0];
    const start = match.index as number;
    const before = claim.slice(Math.max(0, start - 24), start);
    const after = claim.slice(start + token.length);

    // A palavra "item" logo antes prevalece sobre qualquer outra regra.
    const afterKeyword = ITEM_KEYWORD_BEFORE.test(before);
    if (afterKeyword) {
      items.add(token);
      continue;
    }
    if (THOUSANDS_GROUPING.test(token)) continue;

    const segments = token.split('.');
    if (segments.length >= 3) {
      items.add(token);
    } else if (segments[1].length <= 2 && !UNIT_RIGHT_AFTER_NUMBER.test(after)) {
      items.add(token);
    }
  }
  return Array.from(items);
}

const NR_REF = /\bnr[-\s]?(\d{1,2})\b/g;

function extractNrNumbers(text: string): Set<number> {
  const numbers = new Set<number>();
  for (const match of text.matchAll(NR_REF)) numbers.add(parseInt(match[1], 10));
  return numbers;
}

// Aceita o item exato ou um descendente (35.4 é apoiado por 35.4.4), e
// rejeita prefixo de outro número (5.4 não casa em 35.4; 35.4.4 não casa em
// 35.4.44).
function evidenceHasItem(evidence: string, item: string): boolean {
  return new RegExp(`(?<![\\d.])${escapeRegExp(item)}(?!\\d)`).test(evidence);
}

const NUMBER_WITH_UNIT = new RegExp(
  `(?<![\\d.,])(\\d+(?:[.,]\\d+)*)\\s*(${UNIT_ALTERNATION})(?![a-z])`,
  'g',
);
const REAL_PREFIX = /r\$\s*(\d[\d.,]*\d|\d)/g;

interface NumberWithUnit {
  label: string;
  number: string;
  family: string;
}

function extractNumbersWithUnit(claim: string): NumberWithUnit[] {
  const found: NumberWithUnit[] = [];
  for (const match of claim.matchAll(NUMBER_WITH_UNIT)) {
    found.push({
      label: `${match[1]} ${match[2]}`,
      number: match[1],
      family: SURFACE_TO_FAMILY.get(match[2]) as string,
    });
  }
  for (const match of claim.matchAll(REAL_PREFIX)) {
    found.push({ label: `R$ ${match[1]}`, number: match[1], family: 'real' });
  }
  return found;
}

// Só o mesmo número, aceitando "," ou "." como separador decimal/milhar.
function numberPattern(number: string): string {
  return escapeRegExp(number).replace(/\\[.]|,/g, '[.,]');
}

// O mesmo número imediatamente seguido (tolerando espaços e um parêntese
// curto, "8 (oito) horas") de uma unidade da mesma família. Número por
// extenso na evidência NÃO é convertido — conta como ausente e vai para o
// log, que é exatamente o falso positivo que a Etapa 3 vai medir.
function evidenceHasNumberWithUnit(evidence: string, item: NumberWithUnit): boolean {
  const num = numberPattern(item.number);
  const forms = UNIT_FAMILIES[item.family].map(escapeRegExp).join('|');
  const suffixed = new RegExp(`(?<![\\d.,])${num}\\s*(?:\\([^)]{0,25}\\)\\s*)?(?:${forms})(?![a-z])`);
  if (suffixed.test(evidence)) return true;
  if (item.family === 'real') {
    return new RegExp(`r\\$\\s*${num}(?!\\d)`).test(evidence);
  }
  return false;
}

export function checkClaimSupport(claimText: string, evidenceTexts: string[]): ClaimSupportResult {
  // Sem texto de evidência (ex.: a claim só cita uma imagem anexada) não há
  // o que verificar — mesmo comportamento de "claim sem item/NR": passa.
  if (evidenceTexts.length === 0) return { blocking: [], logged: [] };

  const claim = normalize(claimText);
  const evidence = normalize(evidenceTexts.join('\n'));

  const blocking: string[] = [];

  const evidenceNrs = extractNrNumbers(evidence);
  for (const nr of extractNrNumbers(claim)) {
    if (!evidenceNrs.has(nr)) blocking.push(`NR-${nr}`);
  }
  for (const item of extractItemRefs(claim)) {
    if (!evidenceHasItem(evidence, item)) blocking.push(`item ${item}`);
  }

  const logged: string[] = [];
  for (const candidate of extractNumbersWithUnit(claim)) {
    if (!evidenceHasNumberWithUnit(evidence, candidate) && !logged.includes(candidate.label)) {
      logged.push(candidate.label);
    }
  }

  return { blocking, logged };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern claim-support`
Expected: PASS — 21 testes.

- [ ] **Step 5: Typecheck do backend**

Run: `cd /opt/Montese/backend && PATH="/root/.nvm/versions/node/v20.20.2/bin:$PATH" npx tsc --noEmit -p tsconfig.json`
Expected: sem saída (0 erros).

- [ ] **Step 6: Commit** (só se o usuário autorizou commits)

```bash
cd /opt/Montese
git add backend/src/normative/claim-support.ts backend/test/claim-support.unit-spec.ts
git commit -m "feat: verificador v2 — item e NR citados precisam constar nas fontes da claim (claim-support)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Integração no Assistente (serviço, prompt, e2e)

**Files:**
- Modify: `backend/src/normative/normative-assistant.service.ts`
- Modify: `backend/src/normative/normative-answer-shared.ts`
- Modify: `backend/test/normative-answer-shared.unit-spec.ts`
- Modify: `backend/test/normative-assistant.e2e-spec.ts`

**Interfaces:**
- Consumes (Tasks 1–2): `detectNotices`, `NormativeNotice` de `./question-notices`; `checkClaimSupport` de `./claim-support`.
- Produces (usado pela Task 4): `NormativeQueryResult.notices: NormativeNotice[]` no JSON de `POST /assistant/normative-query`, sempre presente.

- [ ] **Step 1: Escrever o teste unitário da regra do prompt (falha)**

Acrescentar ao final de `backend/test/normative-answer-shared.unit-spec.ts` (novo `describe`, depois do último existente). Primeiro ajustar o import da linha 1 para incluir `SYSTEM_PROMPT`:

```ts
import { buildRagChatCompletionBody, SYSTEM_PROMPT, TOOL_SCHEMA } from '../src/normative/normative-answer-shared';
```

E acrescentar no fim do arquivo:

```ts
describe('SYSTEM_PROMPT — regra de jurisdição e habilitação profissional (unit)', () => {
  it('manda não responder como se a regra federal fosse universal quando depender de lei estadual/municipal ou de habilitação', () => {
    expect(SYSTEM_PROMPT).toContain('legislação estadual ou municipal');
    expect(SYSTEM_PROMPT).toContain('habilitação legal');
    expect(SYSTEM_PROMPT).toContain('declare explicitamente o que eles não cobrem');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern normative-answer-shared`
Expected: FAIL no teste novo (`Expected substring: "legislação estadual ou municipal"`); os 5 anteriores passam.

- [ ] **Step 3: Adicionar a regra ao prompt**

Em `backend/src/normative/normative-answer-shared.ts`, na lista "Regras obrigatórias", depois do item que termina em `itens e anexo fornecidos literalmente dizem.` e antes do parágrafo `O texto de cada trecho normativo`, inserir:

```
- Se a pergunta depender de legislação estadual ou municipal, ou da
  habilitação legal de um profissional para executar ou assinar algo,
  não responda como se a regra federal fosse universal: limite-se ao que
  os trechos dizem e declare explicitamente o que eles não cobrem.
```

Edit exato — `old_string`:

```
- Não dê conselho, opinião ou interpretação além do que os trechos,
  itens e anexo fornecidos literalmente dizem.
```

`new_string`:

```
- Não dê conselho, opinião ou interpretação além do que os trechos,
  itens e anexo fornecidos literalmente dizem.
- Se a pergunta depender de legislação estadual ou municipal, ou da
  habilitação legal de um profissional para executar ou assinar algo,
  não responda como se a regra federal fosse universal: limite-se ao que
  os trechos dizem e declare explicitamente o que eles não cobrem.
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern normative-answer-shared`
Expected: PASS — 6 testes.

- [ ] **Step 5: Atualizar o e2e do Assistente (falha esperada)**

Em `backend/test/normative-assistant.e2e-spec.ts`:

(a) Depois da constante `ASSISTANT_RATE_LIMIT_KEY` (linha 20), adicionar:

```ts
const FALLBACK_MESSAGE =
  'Não encontrei fundamento suficiente nas fontes consultadas para afirmar isso. Isso não significa que a exigência não exista, só que não a localizei.';
```

(b) Substituir as 4 ocorrências (linhas 182, 220, 333 e 416) — usar Edit com `replace_all: true`:

`old_string`: `expect(res.body.message).toBe('Não encontrei nada relevante pra essa pergunta.');`
`new_string`: `expect(res.body.message).toBe(FALLBACK_MESSAGE);`

(c) Acrescentar antes do `});` final do arquivo (âncora: o fim do último teste, `await client.query('DELETE FROM tenants WHERE id = $1', [brigadaTenant.tenantId]);\n  });\n});`), os testes novos:

```ts
  it('Verificador v2: claim que cita um item inexistente nas fontes citadas é descartada mesmo com chunk_id válido', async () => {
    fakeAnswer.mockResolvedValue([
      {
        claim: 'Conforme o item 99.9.9, o capacete é obrigatório.',
        chunk_ids: [chunkId],
        operational_ref_ids: [],
        company_chunk_ids: [],
        uses_attachment: false,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'preciso usar capacete?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBeNull();
    expect(res.body.message).toBe(FALLBACK_MESSAGE);
  });

  it('Verificador v2: claim que cita uma NR ausente das fontes citadas é descartada', async () => {
    // A fonte de fixture tem código "NR-ASSISTENTE" (sem número) e o trecho
    // não menciona NR-35 — a NR citada pela claim não tem base nenhuma.
    fakeAnswer.mockResolvedValue([
      {
        claim: 'Conforme a NR-35, o capacete é obrigatório.',
        chunk_ids: [chunkId],
        operational_ref_ids: [],
        company_chunk_ids: [],
        uses_attachment: false,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'preciso usar capacete?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBeNull();
  });

  it('Verificador v2: o código da fonte (source_code) conta como evidência da NR citada pela claim', async () => {
    const client = (db as any).client;
    const src = await client.query(
      `INSERT INTO official_sources (entity, code, title, official_url)
       VALUES ('MTE', 'NR-97', 'Norma de teste sem numero no titulo', 'https://exemplo.gov.br/nr97.html') RETURNING id`,
    );
    const doc = await client.query(
      `INSERT INTO normative_documents (source_id, status, content_hash, file_key, file_name, mime_type, raw_text, indexed_at)
       VALUES ($1, 'vigente', 'hash-nr97', 'normative/nr97.html', 'nr97.html', 'text/html', 'Texto vigente NR97 de teste', now())
       RETURNING id`,
      [src.rows[0].id],
    );
    const exactVector = toVectorLiteral(new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0)));
    const chunk = await client.query(
      `INSERT INTO normative_document_chunks (document_id, chunk_index, content, embedding)
       VALUES ($1, 0, 'Trecho que não repete o número da norma.', $2::vector) RETURNING id`,
      [doc.rows[0].id, exactVector],
    );

    try {
      fakeAnswer.mockResolvedValue([
        {
          claim: 'Segundo a NR-97, a regra vale.',
          chunk_ids: [chunk.rows[0].id],
          operational_ref_ids: [],
          company_chunk_ids: [],
          uses_attachment: false,
        },
      ]);

      const res = await request(app.getHttpServer())
        .post('/assistant/normative-query')
        .set('Authorization', `Bearer ${tokenEmpresa}`)
        .send({ question: 'o que diz a norma de teste?' });

      expect(res.status).toBe(201);
      expect(res.body.answer).toBe('Segundo a NR-97, a regra vale.');
    } finally {
      await client.query('DELETE FROM normative_document_chunks WHERE document_id = $1', [doc.rows[0].id]);
      await client.query('DELETE FROM normative_documents WHERE id = $1', [doc.rows[0].id]);
      await client.query('DELETE FROM official_sources WHERE id = $1', [src.rows[0].id]);
    }
  });

  it('notices é sempre devolvido: lista vazia quando a pergunta não tem gatilho', async () => {
    fakeAnswer.mockResolvedValue([
      {
        claim: 'É obrigatório o uso de capacete.',
        chunk_ids: [chunkId],
        operational_ref_ids: [],
        company_chunk_ids: [],
        uses_attachment: false,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'preciso usar capacete?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBe('É obrigatório o uso de capacete.');
    expect(res.body.notices).toEqual([]);
  });

  it('o aviso de jurisdição acompanha uma resposta federal válida', async () => {
    fakeAnswer.mockResolvedValue([
      {
        claim: 'É obrigatório o uso de capacete.',
        chunk_ids: [chunkId],
        operational_ref_ids: [],
        company_chunk_ids: [],
        uses_attachment: false,
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'o corpo de bombeiros exige capacete?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBe('É obrigatório o uso de capacete.');
    expect(res.body.notices.map((n: any) => n.tipo)).toEqual(['jurisdicao']);
  });

  it('o aviso também sai no fallback de busca vazia (provedor de resposta não é chamado)', async () => {
    fakeEmbed.mockResolvedValueOnce(new Array(1536).fill(0).map((_, i) => (i === 1 ? 1 : 0)));

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenTecnico}`)
      .send({ question: 'quem pode assinar o PGR?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBeNull();
    expect(res.body.message).toBe(FALLBACK_MESSAGE);
    expect(res.body.notices.map((n: any) => n.tipo)).toEqual(['profissional_habilitado']);
    expect(fakeAnswer).not.toHaveBeenCalled();
  });

  it('o aviso também sai no fallback depois que o Verificador descarta tudo', async () => {
    fakeAnswer.mockResolvedValue([]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'sou obrigado a ter CIPA?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBeNull();
    expect(res.body.message).toBe(FALLBACK_MESSAGE);
    expect(res.body.notices.map((n: any) => n.tipo)).toEqual(['contexto']);
  });
```

- [ ] **Step 6: Rodar o e2e e confirmar que falha pelos motivos certos**

Run: `/opt/Montese/run-backend-tests.sh test:e2e -- --testPathPattern normative-assistant.e2e`
Expected: FAIL em **10 testes** — os 4 asserts antigos de fallback (texto antigo), os 2 de Verificador v2 que esperam descarte (item `99.9.9` e `NR-35`, que hoje sobrevivem) e os 4 de `notices` (`undefined` / texto do fallback). O teste do `NR-97` **passa** já agora (sem verificador a claim sobrevive) — ele só passa a provar que o `source_code` entra na evidência depois do Step 7, quando o par negativo (`NR-35` descartada) garante que o verificador existe. Os demais testes antigos passam. Se algum teste **antigo** que não é de fallback falhar, pare e investigue antes de seguir.

- [ ] **Step 7: Alterar o serviço**

Em `backend/src/normative/normative-assistant.service.ts`:

(a) Import do Nest e dos módulos novos — trocar a linha 1 e acrescentar dois imports depois de `import { extractXlsxRows … }`:

`old_string`: `import { Inject, Injectable } from '@nestjs/common';`
`new_string`: `import { Inject, Injectable, Logger } from '@nestjs/common';`

`old_string`: `import { extractXlsxRows, XLSX_MIME_TYPE } from '../common/xlsx/xlsx-text.util';`
`new_string`:
```ts
import { extractXlsxRows, XLSX_MIME_TYPE } from '../common/xlsx/xlsx-text.util';
import { detectNotices, NormativeNotice } from './question-notices';
import { checkClaimSupport } from './claim-support';
```

(b) Texto do fallback:

`old_string`: `const FALLBACK_MESSAGE = 'Não encontrei nada relevante pra essa pergunta.';`
`new_string`:
```ts
const FALLBACK_MESSAGE =
  'Não encontrei fundamento suficiente nas fontes consultadas para afirmar isso. Isso não significa que a exigência não exista, só que não a localizei.';
```

(c) `notices` no resultado:

`old_string`:
```ts
  citations: NormativeQueryCitation[];
  company_citations: CompanyDocumentCitation[];
  // true quando alguma afirmação sobrevivente usou o anexo desta
```
`new_string`:
```ts
  citations: NormativeQueryCitation[];
  company_citations: CompanyDocumentCitation[];
  // Avisos determinísticos por pergunta (question-notices.ts) — sempre
  // presente, possivelmente vazio; nunca bloqueia a resposta.
  notices: NormativeNotice[];
  // true quando alguma afirmação sobrevivente usou o anexo desta
```

(d) `source_code` no chunk recuperado:

`old_string`:
```ts
  document_id: string;
  source_title: string;
  official_url: string;
  similarity: number;
}
```
`new_string`:
```ts
  document_id: string;
  source_title: string;
  source_code: string | null;
  official_url: string;
  similarity: number;
}
```

(e) Query dos chunks normativos:

`old_string`: `SELECT c.id AS chunk_id, c.content, d.id AS document_id, s.title AS source_title, s.official_url,`
`new_string`: `SELECT c.id AS chunk_id, c.content, d.id AS document_id, s.title AS source_title, s.code AS source_code, s.official_url,`

(f) Logger e `notices` no início de `query()`:

`old_string`:
```ts
export class NormativeAssistantService {
  constructor(
```
`new_string`:
```ts
export class NormativeAssistantService {
  private readonly logger = new Logger(NormativeAssistantService.name);

  constructor(
```

`old_string`:
```ts
  ): Promise<NormativeQueryResult> {
    // `tenantId` aqui é o ALVO
```
`new_string`:
```ts
  ): Promise<NormativeQueryResult> {
    // Avisos determinísticos (sem I/O, sem custo) — calculados antes de
    // qualquer embedding/busca e devolvidos em todos os caminhos de retorno.
    const notices = detectNotices(question);

    // `tenantId` aqui é o ALVO
```

(g) `notices` nos dois retornos de fallback — são dois blocos idênticos que terminam em `attachment_warning: attachmentWarning,\n      };`. Em cada um, acrescentar `notices,` logo depois de `company_citations: [],`. (Use Edit com contexto único: o primeiro bloco vem depois de `if (relevant.length === 0 && operationalItems.length === 0 …`, o segundo depois de `if (survivingClaims.length === 0) {`.)

Primeiro bloco — `old_string`:
```ts
    if (relevant.length === 0 && operationalItems.length === 0 && companyChunks.length === 0 && !attachmentInput) {
      return {
        answer: null,
        message: FALLBACK_MESSAGE,
        citations: [],
        company_citations: [],
```
`new_string`:
```ts
    if (relevant.length === 0 && operationalItems.length === 0 && companyChunks.length === 0 && !attachmentInput) {
      return {
        answer: null,
        message: FALLBACK_MESSAGE,
        citations: [],
        company_citations: [],
        notices,
```

Segundo bloco — `old_string`:
```ts
    if (survivingClaims.length === 0) {
      return {
        answer: null,
        message: FALLBACK_MESSAGE,
        citations: [],
        company_citations: [],
```
`new_string`:
```ts
    if (survivingClaims.length === 0) {
      return {
        answer: null,
        message: FALLBACK_MESSAGE,
        citations: [],
        company_citations: [],
        notices,
```

(h) `notices` no retorno de sucesso:

`old_string`:
```ts
      company_citations: Array.from(companyCitationsByDocument.values()),
      used_attachment: usedAttachment ? true : undefined,
```
`new_string`:
```ts
      company_citations: Array.from(companyCitationsByDocument.values()),
      notices,
      used_attachment: usedAttachment ? true : undefined,
```

(i) Verificador v2 no filtro de claims — substituir o bloco `const survivingClaims = claims.filter((claim) => { … });` inteiro.

`old_string`:
```ts
    const survivingClaims = claims.filter((claim) => {
      const hasSource =
        claim.chunk_ids.length > 0 ||
        claim.operational_ref_ids.length > 0 ||
        claim.company_chunk_ids.length > 0 ||
        (attachmentIsReal && claim.uses_attachment === true);
      return (
        hasSource &&
        claim.chunk_ids.every((id) => validChunkIds.has(id)) &&
        claim.operational_ref_ids.every((id) => validOperationalIds.has(id)) &&
        claim.company_chunk_ids.every((id) => validCompanyChunkIds.has(id))
      );
    });
```
`new_string`:
```ts
    // Evidência textual de cada fonte que uma claim pode citar, para o
    // Verificador v2 (claim-support.ts). O chunk normativo entra precedido do
    // código e do título da fonte ("NR-35 …"): o texto de um chunk nem
    // sempre repete o nome da norma, e sem isso "conforme a NR-35" seria
    // bloqueado indevidamente. Anexo de imagem não tem texto verificável.
    const chunkEvidence = new Map<string, string>(
      relevant.map((r): [string, string] => [r.chunk_id, `${r.source_code ?? ''} ${r.source_title}\n${r.content}`]),
    );
    const operationalEvidence = new Map<string, string>(
      operationalItems.map((o): [string, string] => [o.id, o.titulo]),
    );
    const companyEvidence = new Map<string, string>(
      companyChunks.map((c): [string, string] => [c.chunk_id, `${c.document_title}\n${c.content}`]),
    );
    const attachmentText =
      attachmentInput && attachmentInput.kind !== 'image' ? attachmentInput.content : undefined;

    const survivingClaims = claims.filter((claim) => {
      const hasSource =
        claim.chunk_ids.length > 0 ||
        claim.operational_ref_ids.length > 0 ||
        claim.company_chunk_ids.length > 0 ||
        (attachmentIsReal && claim.uses_attachment === true);
      const idsAreValid =
        hasSource &&
        claim.chunk_ids.every((id) => validChunkIds.has(id)) &&
        claim.operational_ref_ids.every((id) => validOperationalIds.has(id)) &&
        claim.company_chunk_ids.every((id) => validCompanyChunkIds.has(id));
      if (!idsAreValid) return false;

      const evidenceTexts = [
        ...claim.chunk_ids.map((id) => chunkEvidence.get(id) as string),
        ...claim.operational_ref_ids.map((id) => operationalEvidence.get(id) as string),
        ...claim.company_chunk_ids.map((id) => companyEvidence.get(id) as string),
      ];
      if (attachmentText && attachmentIsReal && claim.uses_attachment === true) {
        evidenceTexts.push(attachmentText);
      }

      const support = checkClaimSupport(claim.claim, evidenceTexts);
      // Registro sem o texto da pergunta nem da claim (dados de empresa,
      // LGPD): só ids das fontes citadas e os tokens sinalizados.
      const citedIds = [...claim.chunk_ids, ...claim.operational_ref_ids, ...claim.company_chunk_ids];
      if (support.logged.length > 0) {
        this.logger.warn(
          `Número com unidade sem base nas fontes citadas (só registrado): ${support.logged.join('; ')} — fontes: ${citedIds.join(', ')}`,
        );
      }
      if (support.blocking.length > 0) {
        this.logger.warn(
          `Claim descartada — item/NR sem base nas fontes citadas: ${support.blocking.join('; ')} — fontes: ${citedIds.join(', ')}`,
        );
        return false;
      }
      return true;
    });
```

- [ ] **Step 8: Typecheck do backend**

Run: `cd /opt/Montese/backend && PATH="/root/.nvm/versions/node/v20.20.2/bin:$PATH" npx tsc --noEmit -p tsconfig.json`
Expected: sem saída (0 erros).

- [ ] **Step 9: Rodar os e2e do Assistente e confirmar que passam**

Run: `/opt/Montese/run-backend-tests.sh test:e2e -- --testPathPattern normative-assistant`
Expected: PASS em `normative-assistant.e2e`, `normative-assistant-attachment.e2e`, `normative-assistant-company-documents.e2e` e `normative-assistant-tecnico-tenant.e2e`. Se algum teste antigo falhar por causa do verificador (uma claim de fixture que cita um item/NR ausente da evidência), **não afrouxe o verificador**: leia a claim e a evidência do teste e decida com o usuário se o fixture é que está errado.

- [ ] **Step 10: Commit** (só se o usuário autorizou commits)

```bash
cd /opt/Montese
git add backend/src/normative/normative-assistant.service.ts backend/src/normative/normative-answer-shared.ts \
  backend/test/normative-answer-shared.unit-spec.ts backend/test/normative-assistant.e2e-spec.ts
git commit -m "feat: Assistente devolve avisos determinísticos e descarta claim com item/NR sem base nas fontes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Frontend — avisos no `AssistantChat`

**Files:**
- Modify: `frontend/src/components/AssistantChat.tsx`

**Interfaces:**
- Consumes (Task 3): campo `notices: { tipo: 'jurisdicao' | 'profissional_habilitado' | 'contexto'; texto: string }[]` no JSON da resposta.
- Produces: nada (folha).

Sem test runner no frontend — verificação por typecheck.

- [ ] **Step 1: Tipar `notices` em `QueryResult`**

`old_string`:
```tsx
interface QueryResult {
  answer: string | null;
  message?: string;
  citations: Citation[];
  company_citations: CompanyCitation[];
```
`new_string`:
```tsx
interface Notice {
  tipo: 'jurisdicao' | 'profissional_habilitado' | 'contexto';
  texto: string;
}

interface QueryResult {
  answer: string | null;
  message?: string;
  citations: Citation[];
  company_citations: CompanyCitation[];
  notices?: Notice[];
```

(`notices?` opcional de propósito: o front nunca deve quebrar se falar com um backend ainda sem o campo.)

- [ ] **Step 2: Renderizar os avisos acima da resposta**

`old_string`:
```tsx
        <div className="mt-6 rounded-lg border border-brand-100 p-6">
          <p className="whitespace-pre-wrap text-sm text-brand-900">{result.answer ?? result.message}</p>
```
`new_string`:
```tsx
        <div className="mt-6 rounded-lg border border-brand-100 p-6">
          {(result.notices ?? []).map((notice) => (
            <p
              key={notice.tipo}
              className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            >
              {notice.texto}
            </p>
          ))}
          <p className="whitespace-pre-wrap text-sm text-brand-900">{result.answer ?? result.message}</p>
```

- [ ] **Step 3: Typecheck do frontend**

Run: `cd /opt/Montese/frontend && PATH="/root/.nvm/versions/node/v20.20.2/bin:$PATH" npx tsc --noEmit --incremental false`
Expected: sem saída (0 erros).

- [ ] **Step 4: Commit** (só se o usuário autorizou commits)

```bash
cd /opt/Montese
git add frontend/src/components/AssistantChat.tsx
git commit -m "feat: AssistantChat mostra os avisos de jurisdição/atribuição/contexto acima da resposta

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Monitor normativo — estado, alerta e e-mail (migration `0050`)

**Files:**
- Create: `backend/db/migrations/0050_official_sources_monitor_state.sql`
- Create: `backend/src/normative/normative-monitor-email.ts`
- Test: `backend/test/normative-monitor-email.unit-spec.ts`
- Modify: `backend/src/normative/normative-monitor.service.ts`
- Modify: `backend/test/normative-monitor.e2e-spec.ts`

**Interfaces:**
- Consumes: `EmailService.send({ to, subject, html })` de `../common/email/email.service`; `escapeHtml` de `../common/html-escape.util`; `DatabaseService.withoutTenantContext` / `withTenantContext({ role: 'admin' }, …)`.
- Produces (usados pela Task 6): colunas `last_checked_at timestamptz`, `last_check_status text` (`'ok'|'erro'`), `last_error text`, `consecutive_failures int` em `official_sources`; assinatura `runOnce(options?: MonitorRunOptions)`.

> **Ordem obrigatória — leia antes de começar.** O e2e existente do monitor chama `runOnce()` sobre **todas** as fontes ativas do banco de produção. Hoje é inofensivo (as 36 NRs reais falham no mock e só geram log); depois que o monitor persistir estado, esse mesmo teste gravaria falhas nas NRs reais. Por isso o escopo `onlySourceIds` e o mock de `EmailService` entram **antes** de qualquer persistência (Step 1–3), e o e2e antigo **nunca** deve ser rodado contra o código novo sem esse escopo.

- [ ] **Step 1: Escopar os testes existentes do monitor (antes de mudar o serviço)**

Em `backend/test/normative-monitor.e2e-spec.ts`:

(a) Import — depois de `import { AppModule } from '../src/app.module';`:

```ts
import { EmailService } from '../src/common/email/email.service';
```

(b) No `describe('NormativeMonitorService (e2e)'`, acrescentar as variáveis após `let fetchSpy: jest.SpyInstance | undefined;`:

```ts
  let adminEmail: string;
  // EmailService mockado: este banco de teste É o de produção e pode ter
  // admins reais — nenhum e-mail real pode sair daqui.
  const sendMock = jest.fn().mockResolvedValue(undefined);
```

(c) No `beforeAll`, trocar a criação do módulo:

`old_string`: `const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();`
`new_string`:
```ts
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({ send: sendMock })
      .compile();
```

E, logo depois de `await db.connect();` no `beforeAll`:

```ts
    const admin = await db.createUserWithRole('admin', 'Admin Monitor Teste');
    adminEmail = admin.email;
```

(d) `afterEach` — limpar o mock além do fetch:

`old_string`:
```ts
  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
  });
```
`new_string`:
```ts
  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
    sendMock.mockReset().mockResolvedValue(undefined);
  });
```

(e) `afterAll` — remover o admin de teste:

`old_string`:
```ts
    await client.query('DELETE FROM official_sources WHERE id IN ($1, $2)', [sourceIdPdf, sourceIdFalha]);
    await db.disconnect();
```
`new_string`:
```ts
    await client.query('DELETE FROM official_sources WHERE id IN ($1, $2)', [sourceIdPdf, sourceIdFalha]);
    await db.cleanup();
    await db.disconnect();
```

(f) Os dois testes existentes passam a escopar a rodada:

No teste `cria normative_document aguardando_validacao…`, as duas chamadas `await monitor.runOnce();` viram `await monitor.runOnce({ onlySourceIds: [sourceIdPdf] });`.

No teste `falha numa fonte não impede…`, a chamada vira:
`await expect(monitor.runOnce({ onlySourceIds: [sourceIdPdf, sourceIdFalha] })).resolves.not.toThrow();`

- [ ] **Step 2: Acrescentar o escopo ao `runOnce` (sem persistência ainda)**

Em `backend/src/normative/normative-monitor.service.ts`, trocar o método `runOnce`:

`old_string`:
```ts
  async runOnce(): Promise<void> {
    const sources = await this.db.withoutTenantContext((client) =>
      client.query<{ id: string; official_url: string }>(
        'SELECT id, official_url FROM official_sources WHERE active = true',
      ),
    );
```
`new_string`:
```ts
  async runOnce(options: MonitorRunOptions = {}): Promise<void> {
    const sources = await this.db.withoutTenantContext((client) =>
      client.query<{ id: string; official_url: string }>(
        options.onlySourceIds
          ? 'SELECT id, official_url FROM official_sources WHERE active = true AND id = ANY($1::uuid[])'
          : 'SELECT id, official_url FROM official_sources WHERE active = true',
        options.onlySourceIds ? [options.onlySourceIds] : [],
      ),
    );
```

E, antes de `@Injectable()`:

```ts
export interface MonitorRunOptions {
  // Restringe a rodada a estas fontes. O cron chama sem opções (todas as
  // fontes ativas, comportamento de produção); só os testes usam isto — os
  // e2e rodam contra o mesmo Postgres de produção e não podem tocar nas 36
  // NRs reais.
  onlySourceIds?: string[];
}
```

- [ ] **Step 3: Rodar os e2e do monitor (comportamento ainda idêntico) e confirmar que passam**

Run: `/opt/Montese/run-backend-tests.sh test:e2e -- --testPathPattern normative-monitor`
Expected: PASS — 4 testes (2 de `extractHtmlText`, 2 do monitor), agora escopados.

- [ ] **Step 4: Escrever a migration**

Criar `backend/db/migrations/0050_official_sources_monitor_state.sql`:

```sql
-- Etapa 1 da Confiabilidade do Assistente (docs/specs/assistente-confiabilidade-etapa-1.md
-- §5): estado da última verificação de cada fonte oficial, gravado pelo
-- NormativeMonitorService, para o admin ver se o monitor está vivo e para
-- disparar alerta em falha repetida. Só aditiva: as fontes existentes ficam
-- com NULL/0 até a primeira execução do cron. Sem RLS (official_sources não
-- tem tenant_id). `last_checked_at` é também o futuro `data_verificacao` do
-- registry de fontes.
ALTER TABLE official_sources
  ADD COLUMN last_checked_at timestamptz,
  ADD COLUMN last_check_status text CHECK (last_check_status IN ('ok', 'erro')),
  ADD COLUMN last_error text,
  ADD COLUMN consecutive_failures int NOT NULL DEFAULT 0;
```

- [ ] **Step 5: 🛑 PARAR — pedir autorização para aplicar a migration em produção**

**Não aplicar sem o ok explícito do usuário.** Os e2e do monitor (Step 9) rodam contra o Postgres de produção e precisam das colunas, então esta é a última barreira antes de tocar o banco real. Antes de pedir:

- Confirmar que existe backup do dia (leitura): `ls -la /opt/montese-backups/postgres/ | tail -2` — deve haver um `montese-<hoje>-0300*.dump`.
- Confirmar que 0050 será a única pendente (leitura): `echo "SELECT count(*) FROM _migrations;" | docker exec -i montese_postgres sh -c 'PGOPTIONS="-c default_transaction_read_only=on" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'` → `49`, e o diretório `backend/db/migrations/` deve ter 50 arquivos.

Dizer ao usuário: "A migration `0050` é aditiva (4 colunas em `official_sources`, sem reescrever linhas). Backup de hoje: `<arquivo>`. Comando: `/opt/Montese/run-backend-tests.sh db:migrate`. Posso aplicar?"

- [ ] **Step 6: Aplicar a migration (somente após o ok)**

Run: `/opt/Montese/run-backend-tests.sh db:migrate`
Expected: 49 linhas `[skip] … (já aplicada)`, depois `[apply] 0050_official_sources_monitor_state.sql`, `[ok] 0050_…`, `Migrations concluídas.`

Verificar (leitura):

```bash
echo "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'official_sources' AND column_name IN ('last_checked_at','last_check_status','last_error','consecutive_failures') ORDER BY column_name;" | docker exec -i montese_postgres sh -c 'PGOPTIONS="-c default_transaction_read_only=on" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'
```
Expected: 4 linhas (`consecutive_failures | integer | 0`, `last_check_status | text`, `last_checked_at | timestamp with time zone`, `last_error | text`).

- [ ] **Step 7: Escrever o teste unitário do e-mail (falha)**

Criar `backend/test/normative-monitor-email.unit-spec.ts`:

```ts
import { buildMonitorAlertEmail, MONITOR_ALERT_SUBJECT } from '../src/normative/normative-monitor-email';

describe('buildMonitorAlertEmail (unit)', () => {
  it('usa o assunto fixo', () => {
    const { subject } = buildMonitorAlertEmail([{ kind: 'nova_versao', source: 'NR-01 — Disposições Gerais' }]);
    expect(subject).toBe(MONITOR_ALERT_SUBJECT);
  });

  it('só inclui a seção de falhas quando há eventos de falha', () => {
    const { html } = buildMonitorAlertEmail([
      { kind: 'falha_repetida', source: 'NR-01 — Disposições Gerais', error: 'Fonte respondeu status 404' },
    ]);
    expect(html).toContain('2 falhas seguidas');
    expect(html).toContain('NR-01 — Disposições Gerais');
    expect(html).toContain('Fonte respondeu status 404');
    expect(html).not.toContain('aguardando validação');
  });

  it('só inclui a seção de versões novas quando há eventos de versão nova', () => {
    const { html } = buildMonitorAlertEmail([{ kind: 'nova_versao', source: 'NR-35 — Trabalho em Altura' }]);
    expect(html).toContain('Versões novas aguardando validação');
    expect(html).toContain('NR-35 — Trabalho em Altura');
    expect(html).not.toContain('2 falhas seguidas');
  });

  it('inclui as duas seções quando há os dois tipos de evento', () => {
    const { html } = buildMonitorAlertEmail([
      { kind: 'falha_repetida', source: 'NR-01', error: 'timeout' },
      { kind: 'nova_versao', source: 'NR-35' },
    ]);
    expect(html).toContain('2 falhas seguidas');
    expect(html).toContain('Versões novas aguardando validação');
  });

  it('escapa HTML no rótulo da fonte e no erro', () => {
    const { html } = buildMonitorAlertEmail([
      { kind: 'falha_repetida', source: '<script>alert(1)</script>', error: '<img src=x onerror=alert(1)>' },
    ]);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });
});
```

Run: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern normative-monitor-email`
Expected: FAIL — `Cannot find module '../src/normative/normative-monitor-email'`.

- [ ] **Step 8: Implementar o builder do e-mail**

Criar `backend/src/normative/normative-monitor-email.ts`:

```ts
import { escapeHtml } from '../common/html-escape.util';

// Evento acumulado por NormativeMonitorService.runOnce durante uma rodada:
// fonte que atingiu exatamente 2 falhas seguidas, ou versão nova que entrou
// como aguardando_validacao. `source` é o rótulo já pronto ("NR-35 — Trabalho
// em Altura").
export type MonitorEvent =
  | { kind: 'falha_repetida'; source: string; error: string }
  | { kind: 'nova_versao'; source: string };

export const MONITOR_ALERT_SUBJECT = 'Montese SST — monitor normativo precisa de atenção';

// Função pura: monta o e-mail-resumo de UMA rodada do monitor. Rótulo de
// fonte e mensagem de erro entram escapados (o título de uma fonte é texto
// digitado por um admin e o erro vem de uma resposta externa).
export function buildMonitorAlertEmail(events: MonitorEvent[]): { subject: string; html: string } {
  const failures = events.filter(
    (e): e is Extract<MonitorEvent, { kind: 'falha_repetida' }> => e.kind === 'falha_repetida',
  );
  const versions = events.filter(
    (e): e is Extract<MonitorEvent, { kind: 'nova_versao' }> => e.kind === 'nova_versao',
  );

  const parts = ['<p>O monitor normativo da Montese SST precisa de atenção.</p>'];
  if (failures.length > 0) {
    const items = failures.map((f) => `<li>${escapeHtml(f.source)} — ${escapeHtml(f.error)}</li>`).join('');
    parts.push(`<h3>Fontes com 2 falhas seguidas na verificação</h3><ul>${items}</ul>`);
  }
  if (versions.length > 0) {
    const items = versions.map((v) => `<li>${escapeHtml(v.source)}</li>`).join('');
    parts.push(`<h3>Versões novas aguardando validação</h3><ul>${items}</ul>`);
  }
  parts.push('<p>Abra Admin › Normativa para revisar.</p>');

  return { subject: MONITOR_ALERT_SUBJECT, html: parts.join('') };
}
```

Run: `/opt/Montese/run-backend-tests.sh test:unit -- --testPathPattern normative-monitor-email`
Expected: PASS — 5 testes.

- [ ] **Step 9: Escrever os e2e novos do monitor (falha)**

Em `backend/test/normative-monitor.e2e-spec.ts`, acrescentar antes do `});` final do `describe('NormativeMonitorService (e2e)'`:

```ts
  async function stateOf(sourceId: string) {
    const result = await (db as any).client.query(
      `SELECT last_checked_at, last_check_status, last_error, consecutive_failures FROM official_sources WHERE id = $1`,
      [sourceId],
    );
    return result.rows[0];
  }

  async function setFailures(sourceId: string, failures: number) {
    await (db as any).client.query(`UPDATE official_sources SET consecutive_failures = $2 WHERE id = $1`, [
      sourceId,
      failures,
    ]);
  }

  function mockFetchFalhaFora() {
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      if (url === 'https://exemplo.gov.br/fora-do-ar.html') throw new Error('ECONNREFUSED');
      throw new Error('URL inesperada nesta chamada do teste: ' + url);
    });
  }

  it('sucesso grava status ok, atualiza last_checked_at e zera o contador de falhas', async () => {
    await (db as any).client.query(
      `UPDATE official_sources SET consecutive_failures = 1, last_check_status = 'erro', last_error = 'falha antiga' WHERE id = $1`,
      [sourceIdPdf],
    );
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      if (url === 'https://exemplo.gov.br/norma-teste.html') {
        return new Response('<html><body><p>Conteúdo mudou de novo.</p></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      throw new Error('URL inesperada nesta chamada do teste: ' + url);
    });

    await monitor.runOnce({ onlySourceIds: [sourceIdPdf] });

    const state = await stateOf(sourceIdPdf);
    expect(state.last_check_status).toBe('ok');
    expect(state.consecutive_failures).toBe(0);
    expect(state.last_error).toBeNull();
    expect(state.last_checked_at).not.toBeNull();
  });

  it('falha grava status erro, guarda a mensagem e incrementa o contador — sem e-mail na 1ª falha', async () => {
    await setFailures(sourceIdFalha, 0);
    mockFetchFalhaFora();

    await monitor.runOnce({ onlySourceIds: [sourceIdFalha] });

    const state = await stateOf(sourceIdFalha);
    expect(state.last_check_status).toBe('erro');
    expect(state.last_error).toBe('ECONNREFUSED');
    expect(state.consecutive_failures).toBe(1);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('e-mail só na 2ª falha seguida — a 3ª não reenvia', async () => {
    await setFailures(sourceIdFalha, 1);
    mockFetchFalhaFora();

    await monitor.runOnce({ onlySourceIds: [sourceIdFalha] });

    expect((await stateOf(sourceIdFalha)).consecutive_failures).toBe(2);
    const paraOAdmin = sendMock.mock.calls.filter(([arg]) => arg.to === adminEmail);
    expect(paraOAdmin).toHaveLength(1);
    expect(paraOAdmin[0][0].html).toContain('NR-FALHA');
    expect(paraOAdmin[0][0].html).toContain('ECONNREFUSED');

    sendMock.mockClear();
    await monitor.runOnce({ onlySourceIds: [sourceIdFalha] });

    expect((await stateOf(sourceIdFalha)).consecutive_failures).toBe(3);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('um único e-mail-resumo por rodada quando há uma falha repetida e uma versão nova', async () => {
    await setFailures(sourceIdFalha, 1);
    const conteudoNovo = `Conteúdo versão ${Date.now()}`;
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      if (url === 'https://exemplo.gov.br/norma-teste.html') {
        return new Response(`<html><body><p>${conteudoNovo}</p></body></html>`, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      if (url === 'https://exemplo.gov.br/fora-do-ar.html') throw new Error('ECONNREFUSED');
      throw new Error('URL inesperada nesta chamada do teste: ' + url);
    });

    await monitor.runOnce({ onlySourceIds: [sourceIdPdf, sourceIdFalha] });

    const paraOAdmin = sendMock.mock.calls.filter(([arg]) => arg.to === adminEmail);
    expect(paraOAdmin).toHaveLength(1);
    expect(paraOAdmin[0][0].html).toContain('NR-FALHA');
    expect(paraOAdmin[0][0].html).toContain('NR-TESTE');
  });

  it('falha no envio do e-mail não derruba a rodada e o estado continua gravado', async () => {
    sendMock.mockRejectedValueOnce(new Error('resend fora do ar'));
    await setFailures(sourceIdFalha, 1);
    mockFetchFalhaFora();

    await expect(monitor.runOnce({ onlySourceIds: [sourceIdFalha] })).resolves.not.toThrow();

    expect((await stateOf(sourceIdFalha)).consecutive_failures).toBe(2);
  });
```

Run: `/opt/Montese/run-backend-tests.sh test:e2e -- --testPathPattern normative-monitor`
Expected: FAIL nos 5 testes novos (colunas existem, mas o serviço ainda não grava nada nem manda e-mail). Os 4 anteriores passam.

- [ ] **Step 10: Implementar o estado e o e-mail no monitor**

Em `backend/src/normative/normative-monitor.service.ts`:

(a) Imports — acrescentar depois de `import { NormativeDocumentsService } from './normative-documents.service';`:

```ts
import { EmailService } from '../common/email/email.service';
import { MonitorEvent, buildMonitorAlertEmail } from './normative-monitor-email';
```

(b) Constantes e tipo — logo depois da interface `MonitorRunOptions` (criada no Step 2):

```ts
const LAST_ERROR_MAX_LENGTH = 500;
// Um e-mail por episódio de falha: só na falha de número exatamente 2.
const REPEATED_FAILURE_THRESHOLD = 2;

interface MonitoredSource {
  id: string;
  code: string | null;
  title: string;
  official_url: string;
}

function sourceLabel(source: MonitoredSource): string {
  return source.code ? `${source.code} — ${source.title}` : source.title;
}
```

(c) Construtor — injetar o `EmailService` (o módulo `EmailModule` é `@Global()`, não precisa importar nada no `NormativeModule`):

`old_string`:
```ts
  constructor(
    private readonly db: DatabaseService,
    private readonly documents: NormativeDocumentsService,
  ) {}
```
`new_string`:
```ts
  constructor(
    private readonly db: DatabaseService,
    private readonly documents: NormativeDocumentsService,
    private readonly email: EmailService,
  ) {}
```

(d) Duas edições em `runOnce` (o escopo do Step 2 já está lá) e a adição dos métodos auxiliares.

**d1 — a query passa a trazer `code` e `title` (para o rótulo do e-mail).**

`old_string`:
```ts
      client.query<{ id: string; official_url: string }>(
        options.onlySourceIds
          ? 'SELECT id, official_url FROM official_sources WHERE active = true AND id = ANY($1::uuid[])'
          : 'SELECT id, official_url FROM official_sources WHERE active = true',
        options.onlySourceIds ? [options.onlySourceIds] : [],
      ),
```
`new_string`:
```ts
      client.query<MonitoredSource>(
        options.onlySourceIds
          ? 'SELECT id, code, title, official_url FROM official_sources WHERE active = true AND id = ANY($1::uuid[])'
          : 'SELECT id, code, title, official_url FROM official_sources WHERE active = true',
        options.onlySourceIds ? [options.onlySourceIds] : [],
      ),
```

**d2 — o laço registra estado, junta eventos e avisa os admins; os três métodos auxiliares entram logo depois de `runOnce`.**

`old_string`:
```ts
    for (const source of sources.rows) {
      try {
        await this.processSource(source.id, source.official_url);
      } catch (err) {
        this.logger.error(`Falha ao monitorar fonte ${source.id}`, (err as Error).stack);
      }
    }
  }
```
`new_string`:
```ts
    const events: MonitorEvent[] = [];
    for (const source of sources.rows) {
      try {
        const createdNewVersion = await this.processSource(source.id, source.official_url);
        await this.recordSuccess(source.id);
        if (createdNewVersion) {
          events.push({ kind: 'nova_versao', source: sourceLabel(source) });
        }
      } catch (err) {
        this.logger.error(`Falha ao monitorar fonte ${source.id}`, (err as Error).stack);
        const message = (err as Error).message ?? String(err);
        const failures = await this.recordFailure(source.id, message);
        if (failures === REPEATED_FAILURE_THRESHOLD) {
          events.push({
            kind: 'falha_repetida',
            source: sourceLabel(source),
            error: message.slice(0, LAST_ERROR_MAX_LENGTH),
          });
        }
      }
    }

    await this.notifyAdmins(events);
  }

  // Nunca lançam: registrar estado é best-effort e jamais pode contar como
  // falha da própria fonte nem derrubar a rodada.
  private async recordSuccess(sourceId: string): Promise<void> {
    try {
      await this.db.withoutTenantContext((client) =>
        client.query(
          `UPDATE official_sources
           SET last_checked_at = now(), last_check_status = 'ok', last_error = NULL, consecutive_failures = 0
           WHERE id = $1`,
          [sourceId],
        ),
      );
    } catch (err) {
      this.logger.error(`Falha ao gravar estado da fonte ${sourceId}`, (err as Error).stack);
    }
  }

  private async recordFailure(sourceId: string, message: string): Promise<number> {
    try {
      const { rows } = await this.db.withoutTenantContext((client) =>
        client.query<{ consecutive_failures: number }>(
          `UPDATE official_sources
           SET last_checked_at = now(), last_check_status = 'erro', last_error = $2,
               consecutive_failures = consecutive_failures + 1
           WHERE id = $1
           RETURNING consecutive_failures`,
          [sourceId, message.slice(0, LAST_ERROR_MAX_LENGTH)],
        ),
      );
      return rows[0]?.consecutive_failures ?? 0;
    } catch (err) {
      this.logger.error(`Falha ao gravar estado da fonte ${sourceId}`, (err as Error).stack);
      return 0;
    }
  }

  // Um único e-mail-resumo por rodada, só quando houve evento. `users` tem
  // FORCE ROW LEVEL SECURITY e a role da aplicação não tem BYPASSRLS, então
  // a busca dos admins usa withTenantContext({ role: 'admin' }) — mesmo
  // padrão de VisitReminderCronService. Falha de envio só vai pro log.
  private async notifyAdmins(events: MonitorEvent[]): Promise<void> {
    if (events.length === 0) return;

    let adminEmails: string[];
    try {
      const { rows } = await this.db.withTenantContext({ role: 'admin' }, (client) =>
        client.query<{ email: string }>(`SELECT email FROM users WHERE role = 'admin' AND status = 'ativo'`),
      );
      adminEmails = rows.map((row) => row.email);
    } catch (err) {
      this.logger.error('Falha ao buscar admins pro alerta do monitor normativo', (err as Error).stack);
      return;
    }
    if (adminEmails.length === 0) {
      this.logger.warn('Monitor normativo tem eventos pra avisar, mas não há nenhum admin ativo');
      return;
    }

    const { subject, html } = buildMonitorAlertEmail(events);
    for (const to of adminEmails) {
      try {
        await this.email.send({ to, subject, html });
      } catch (err) {
        this.logger.error(`Falha ao enviar o alerta do monitor normativo pra ${to}`, (err as Error).stack);
      }
    }
  }
```

(e) `processSource` passa a devolver se criou versão nova:

`old_string`: `  private async processSource(sourceId: string, url: string): Promise<void> {`
`new_string`: `  private async processSource(sourceId: string, url: string): Promise<boolean> {`

`old_string`:
```ts
    await this.db.withoutTenantContext((client) =>
      this.documents.recordDetectedVersion(client, sourceId, text, buffer, mimeType, url),
    );
  }
```
`new_string`:
```ts
    const created = await this.db.withoutTenantContext((client) =>
      this.documents.recordDetectedVersion(client, sourceId, text, buffer, mimeType, url),
    );
    return created !== null;
  }
```

- [ ] **Step 11: Typecheck do backend**

Run: `cd /opt/Montese/backend && PATH="/root/.nvm/versions/node/v20.20.2/bin:$PATH" npx tsc --noEmit -p tsconfig.json`
Expected: sem saída (0 erros).

- [ ] **Step 12: Rodar os e2e do monitor e confirmar que passam**

Run: `/opt/Montese/run-backend-tests.sh test:e2e -- --testPathPattern normative-monitor`
Expected: PASS — 9 testes (2 de `extractHtmlText` + 7 do monitor).

Confirmar que **nenhuma fonte real** foi tocada (leitura — deve devolver `0`). As fontes reais têm URL `https://www.gov.br/…`; as de fixture usam `exemplo.gov.br` e já foram apagadas pelo `afterAll`:

```bash
echo "SELECT count(*) FROM official_sources WHERE official_url LIKE 'https://www.gov.br/%' AND (last_checked_at IS NOT NULL OR consecutive_failures <> 0 OR last_error IS NOT NULL);" | docker exec -i montese_postgres sh -c 'PGOPTIONS="-c default_transaction_read_only=on" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'
```
Expected: `0`. Enquanto o **deploy não foi feito**, o cron de produção roda o código antigo e nada mais grava esse estado — então qualquer valor > 0 significa que o escopo `onlySourceIds` vazou. Se der > 0, **pare**: não rode mais nada contra o banco e avise o usuário. (Depois de um deploy futuro esta checagem deixa de valer, porque o cron passa a gravar o estado das fontes reais de propósito.)

- [ ] **Step 13: Commit** (só se o usuário autorizou commits)

```bash
cd /opt/Montese
git add backend/db/migrations/0050_official_sources_monitor_state.sql \
  backend/src/normative/normative-monitor-email.ts backend/test/normative-monitor-email.unit-spec.ts \
  backend/src/normative/normative-monitor.service.ts backend/test/normative-monitor.e2e-spec.ts
git commit -m "feat: monitor normativo grava estado por fonte e avisa admins só na anomalia

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Tela admin — "verificada há X" e selo de falha

**Files:**
- Modify: `backend/src/normative/official-sources.service.ts`
- Modify: `frontend/src/app/admin/normativa/page.tsx`

**Interfaces:**
- Consumes (Task 5): colunas `last_checked_at`, `last_check_status`, `last_error`, `consecutive_failures` em `official_sources` (já devolvidas por `GET /normative-sources`, que usa `SELECT *`).
- Produces: nada (folha).

- [ ] **Step 1: Interface do backend**

Em `backend/src/normative/official-sources.service.ts`:

`old_string`:
```ts
  official_url: string;
  active: boolean;
  created_at: string;
}
```
`new_string`:
```ts
  official_url: string;
  active: boolean;
  created_at: string;
  // Estado da última verificação do monitor (migration 0050).
  last_checked_at: string | null;
  last_check_status: 'ok' | 'erro' | null;
  last_error: string | null;
  consecutive_failures: number;
}
```

- [ ] **Step 2: Interface e helper no frontend**

Em `frontend/src/app/admin/normativa/page.tsx`:

`old_string`:
```tsx
  official_url: string;
  active: boolean;
}

interface NormativeDocument {
```
`new_string`:
```tsx
  official_url: string;
  active: boolean;
  last_checked_at: string | null;
  last_check_status: 'ok' | 'erro' | null;
  last_error: string | null;
  consecutive_failures: number;
}

interface NormativeDocument {
```

`old_string`:
```tsx
function authHeaders() {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}
```
`new_string`:
```tsx
function authHeaders() {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}

function formatChecked(iso: string | null): string {
  if (!iso) return 'nunca verificada';
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return 'verificada há menos de 1 h';
  if (hours < 48) return `verificada há ${hours} h`;
  return `verificada há ${Math.floor(hours / 24)} dias`;
}
```

- [ ] **Step 3: Mostrar o estado em cada fonte**

`old_string`:
```tsx
            <li key={s.id}>
              {s.entity} {s.code ? `— ${s.code}` : ''} — {s.title}
            </li>
```
`new_string`:
```tsx
            <li key={s.id}>
              {s.entity} {s.code ? `— ${s.code}` : ''} — {s.title}
              <span className="ml-2 text-xs text-brand-500">{formatChecked(s.last_checked_at)}</span>
              {s.consecutive_failures > 0 && (
                <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                  Falhando ({s.consecutive_failures}){s.last_error ? ` — ${s.last_error}` : ''}
                </span>
              )}
            </li>
```

- [ ] **Step 4: Typecheck dos dois lados e e2e das fontes**

Run (backend): `cd /opt/Montese/backend && PATH="/root/.nvm/versions/node/v20.20.2/bin:$PATH" npx tsc --noEmit -p tsconfig.json` → 0 erros.
Run (frontend): `cd /opt/Montese/frontend && PATH="/root/.nvm/versions/node/v20.20.2/bin:$PATH" npx tsc --noEmit --incremental false` → 0 erros.
Run: `/opt/Montese/run-backend-tests.sh test:e2e -- --testPathPattern normative-sources` → PASS (nenhum assert do e2e compara o formato exato da linha).

- [ ] **Step 5: Commit** (só se o usuário autorizou commits)

```bash
cd /opt/Montese
git add backend/src/normative/official-sources.service.ts frontend/src/app/admin/normativa/page.tsx
git commit -m "feat: tela admin/normativa mostra quando cada fonte foi verificada e destaca as que falham

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Documentação

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `backend/src/normative/normative.module.ts`
- Modify: `docs/assistente-montese-principios.md`

**Interfaces:** nenhuma (só texto).

- [ ] **Step 1: Roadmap — Fase 9 deixa de constar como "não implementada"**

Em `docs/roadmap.md` (nenhum link do repo aponta para a âncora do título antigo — confirmado por busca em `docs/` e `frontend/content/`):

`old_string`: `## Fase 9 — RAG Normativo: spec escrita`
`new_string`: `## Fase 9 — RAG Normativo: status`

`old_string`:
```
Ainda não implementada — próximo passo é escrever o plano de
implementação (`writing-plans`) a partir desta spec.
```
`new_string`:
```
**Status atualizado em 2026-09-20 (auditoria dos agentes): implementada e
em produção.** 36 NRs vigentes do MTE (NR-02 e NR-27 estão revogadas e
ficam de fora) foram cadastradas e indexadas em 2026-08-31 — 1.622
pedaços vigentes com `pgvector`, busca por similaridade de cosseno. O
monitor roda todo dia às 03:00 e nenhuma versão nova entra na base sem
aprovação humana. O Assistente recebeu depois as Fases 10 (itens
operacionais), 20 (anexos) e 24 (documentos da empresa) — ver as seções
dessas fases. A evolução de confiabilidade do Assistente (avisos de
jurisdição, verificador de item/NR, monitor observável) está em
[`docs/specs/assistente-confiabilidade-etapa-1.md`](specs/assistente-confiabilidade-etapa-1.md).
```

- [ ] **Step 2: Comentário do módulo — dizer só o que o log prova**

Em `backend/src/normative/normative.module.ts`:

`old_string`:
```
// Provedor ativo hoje: MiniMax (decisão do fundador em 2026-09-05, no
// lugar do OpenRouter). MiniMaxNormativeAnswerService tem o mesmo formato
// OpenAI-compatible já testado (build limpo, suíte e2e mockada sem
// regressão) — mas a chamada real de validação (tool_choice forçado +
// image_url em data: URI contra a API de verdade) NUNCA foi possível de
// rodar nesta sessão: o classificador de segurança do ambiente bloqueou
// toda tentativa de chamar a API paga da MiniMax, mesmo por caminhos
// diferentes (script isolado, teste jest dedicado). Ativado mesmo assim
// por decisão explícita do fundador — a validação real fica pendente pra
// quando ele mesmo rodar ou destravar a permissão. OpenRouterNormativeAnswerService
// continua registrado, pronto pra reverter (mudar só a linha `useClass`
// abaixo), mesmo padrão do AiCopilotModule (Fase 8).
```
`new_string`:
```
// Provedor ativo hoje: MiniMax (decisão do fundador em 2026-09-05, no
// lugar do OpenRouter). MiniMaxNormativeAnswerService tem o mesmo formato
// OpenAI-compatible já testado (build limpo, suíte e2e mockada sem
// regressão). Em 2026-09-20, `minimax_usage_log` tinha 27 chamadas reais
// de `assistant_normative_query` registradas — o caminho de texto (com
// tool_choice forçado, formato fixo de buildRagChatCompletionBody) já
// rodou contra a API de verdade. O caminho com imagem (image_url em data:
// URI) tem validação NÃO CONFIRMADA: só o fundador pode afirmar o
// contrário. OpenRouterNormativeAnswerService continua registrado, pronto
// pra reverter (mudar só a linha `useClass` abaixo), mesmo padrão do
// AiCopilotModule (Fase 8).
```

- [ ] **Step 3: Princípios — registrar as duas camadas da garantia**

Em `docs/assistente-montese-principios.md`:

`old_string`: `mesmo mecanismo, mas o resultado (nunca afirmar sem fonte real) é inegociável.`
`new_string`:
```
mesmo mecanismo, mas o resultado (nunca afirmar sem fonte real) é inegociável.

Desde 2026-09-20 a garantia tem duas camadas: o verificador de ids acima e o
Verificador v2 (`backend/src/normative/claim-support.ts`), que descarta uma
afirmação cujo item (`35.4.4`) ou NR citados não aparecem no texto das
fontes que ela própria cita — números com unidade só são registrados, ainda
não bloqueiam. Perguntas que dependem de legislação estadual/municipal, de
habilitação profissional ou de contexto não informado recebem um aviso fixo
e determinístico (`backend/src/normative/question-notices.ts`), sem LLM.
Spec: `docs/specs/assistente-confiabilidade-etapa-1.md`.
```

- [ ] **Step 4: Typecheck do backend (o comentário do módulo mudou)**

Run: `cd /opt/Montese/backend && PATH="/root/.nvm/versions/node/v20.20.2/bin:$PATH" npx tsc --noEmit -p tsconfig.json`
Expected: 0 erros.

- [ ] **Step 5: Commit** (só se o usuário autorizou commits)

```bash
cd /opt/Montese
git add docs/roadmap.md backend/src/normative/normative.module.ts docs/assistente-montese-principios.md
git commit -m "docs: roadmap da Fase 9, comentário do módulo normativo e princípios refletem o estado real

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Verificação final

**Files:** nenhum arquivo novo.

- [ ] **Step 1: Suíte unitária completa**

Run: `/opt/Montese/run-backend-tests.sh test:unit`
Expected: todas as suítes `*.unit-spec.ts` passam, incluindo as 3 novas (`question-notices`, `claim-support`, `normative-monitor-email`) e a de `normative-answer-shared` (6 testes).

- [ ] **Step 2: e2e do domínio normativo**

Run: `/opt/Montese/run-backend-tests.sh test:e2e -- --testPathPattern "normative"`
Expected: todas as suítes `normative-*` passam (assistente, anexo, documentos da empresa, tenant do técnico, monitor, fontes, aprovação, chunking, pgvector, providers).

- [ ] **Step 3: Typecheck dos dois lados**

Backend e frontend com os comandos da seção "Comandos de verificação". Expected: 0 erros em ambos.

- [ ] **Step 4: Conferir o que mudou na árvore**

Run: `cd /opt/Montese && git status --short`
Expected: aparecem, além dos arquivos alheios que já estavam modificados antes desta etapa (ver `gitStatus` do início da sessão), **só** os arquivos da tabela "File Structure" acima. Se aparecer qualquer outro arquivo tocado por este plano, explicar antes de encerrar.

- [ ] **Step 5: Conferir que as fontes reais não foram tocadas**

Repetir a consulta de leitura do Task 5 Step 12 (fontes `https://www.gov.br/…` com estado gravado). Expected: `0` — válido só enquanto o deploy não foi feito.

- [ ] **Step 6: Reportar ao usuário**

Resumo em português: o que ficou pronto, resultado de cada verificação com a saída real (não "deve passar"), quais commits foram feitos (ou que nenhum foi, se não autorizados), e lembrar que **o deploy não foi feito**: o backend/frontend em produção continuam com o código antigo até o usuário mandar reconstruir os containers (as colunas da `0050` já existem e são ignoradas pelo código antigo). Registrar também o risco aceito da spec §9 (falso positivo do bloqueio por item/NR) e que a Etapa 3 vai medi-lo pelo log.

---

## Rollback

Tudo é aditivo. Código: `git revert` dos commits (ou descartar o diff se não commitado). Banco: as 4 colunas de `0050` podem ficar — o código antigo as ignora; se for preciso removê-las, `ALTER TABLE official_sources DROP COLUMN …` **só com autorização explícita do usuário** (é DDL em produção).

## Self-Review

**Cobertura da spec:** §3.1–3.2 → Task 1 + Task 3 (Steps 5 e 7); §3.3 fallback → Task 3 Step 7(b); §3.4 prompt → Task 3 Steps 1–4; §3.5 frontend → Task 4; §4.1–4.5 → Task 2; §4.6 integração/log → Task 3 Step 7(i); §5.1 migration → Task 5 Steps 4–6; §5.2 estado → Task 5 Step 10(d); §5.3 e-mail → Task 5 Steps 7–10; §5.4 tela admin → Task 6; §5.5 isolamento → Task 5 Steps 1–3 e Global Constraints; §6 docs → Task 7; §7 testes → Tasks 1, 2, 3, 5; §8 ordem → ordem das tasks; §9 riscos → Task 8 Step 6; §10 lacunas → registradas na spec.

**Consistência de tipos:** `NormativeNotice`/`detectNotices` (Task 1) usados em Task 3; `checkClaimSupport` retorna `{ blocking, logged }` (Task 2) e Task 3 lê exatamente esses campos; `MonitorEvent` (`falha_repetida`/`nova_versao`) definido em Task 5 Step 8 e usado em Step 10; `MonitorRunOptions.onlySourceIds` definido no Step 2 e usado nos e2e do Step 1/9; campos `consecutive_failures`/`last_error`/`last_checked_at` idênticos na migration (Step 4), no serviço (Step 10), nos e2e (Step 9) e na UI (Task 6).
