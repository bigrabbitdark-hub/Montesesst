# Fase 10 — Agente Operacional — Plano de Implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans pra implementar este plano tarefa por tarefa. Passos usam checkbox (`- [ ]`) pra rastreio.

**Objetivo:** o Assistente (Fase 9) passa a combinar retrieval normativo com fatos operacionais reais da própria empresa (pendências, EPIs, ações, documentos) numa resposta só, com todo fato — normativo ou operacional — verificado contra uma fonte real antes de chegar ao usuário.

**Arquitetura:** estende o `NormativeAssistantService`/`NormativeAssistantController` já em produção (Fase 9) — nenhum serviço novo, nenhuma tabela nova. Fatos operacionais vêm do `DashboardService.getSummary()` já existente (mesmo que alimenta "Sua atenção hoje" no dashboard da empresa), buscado numa transação curta e separada, só quando o usuário é `empresa`. O Verificador ganha uma segunda dimensão: toda afirmação sobrevive só se citar pelo menos uma fonte real (trecho normativo e/ou item operacional), com toda citação que fizer sendo real.

**Tech Stack:** NestJS + `pg` (backend), Postgres 16 com RLS (`pgvector` já ativo desde a Fase 9), Jest + Supertest (e2e, sem mock de banco).

**Spec:** [`docs/specs/fase-10-agente-operacional.md`](../specs/fase-10-agente-operacional.md)

## Global Constraints

- **Sem migration nova nesta fase.** Todos os fatos operacionais já são calculados por `DashboardService.getSummary(client, tenantId)` (`backend/src/dashboard/dashboard.service.ts`) — reaproveitado, não duplicado.
- **Nunca segurar conexão do pool durante chamada de IA (embedding ou chat).** Regra herdada do Finding C1a da revisão final da Fase 9. A busca operacional (nova nesta fase) roda numa transação curta e própria, via `this.db.withTenantContext(...)`, que abre e fecha ANTES de qualquer chamada a `this.answerer.answer(...)` — nunca durante.
- **O controller NÃO volta a envolver a chamada inteira em `req.withTenantContext(...)`.** Essa era exatamente a causa do Finding C1a, corrigida na Fase 9 removendo esse wrapper do controller. Esta fase reintroduz `@Req() req: any` no controller só pra ler `req.user` (papel/tenantId) — nunca pra abrir uma transação em volta de todo o método. A transação curta pra buscar dado operacional vive DENTRO do service, não no controller.
- **Regra exata do Verificador** (copiada da spec §3 passo 6 — não simplificar):
  ```
  sobrevive = (chunk_ids.length > 0 OR operational_ref_ids.length > 0)
    AND every id em chunk_ids pertence ao conjunto normativo recuperado
    AND every id em operational_ref_ids pertence ao conjunto operacional
        calculado nesta consulta
  ```
  Uma afirmação com as duas listas vazias é descartada mesmo que nenhuma
  das duas contenha um id inválido — `Array.prototype.every` sobre array
  vazio dá `true` em JS, então a checagem de "tem pelo menos uma fonte"
  precisa ser uma condição própria, não inferida das duas `every()`.
- **Mensagem de fallback muda** de `'Não encontrei uma norma vigente na base que trate disso.'` (texto da Fase 9) para `'Não encontrei nada relevante pra essa pergunta.'` — mais genérica porque agora cobre dois tipos de fonte, não só normativa. Isso muda 2 asserções em testes já existentes (Task 2, Step 1).
- **Só `empresa` recebe busca operacional.** `tecnico`/`parceiro` mantêm exatamente o comportamento de hoje (só normativo, `operationalItems` sempre `[]`) — consulta de dado operacional de cliente por técnico/parceiro fica fora de escopo desta fase (spec §1).
- **`NormativeQueryResult` (formato da resposta HTTP) não muda.** `answer`/`message`/`citations` continuam do mesmo jeito — o frontend (`AssistantChat.tsx`) não precisa de nenhuma alteração nesta fase.
- **Testes e2e reais**, sem mock de banco — mesmo padrão de todo o projeto. A única coisa mockada é a chamada de IA paga (`EMBEDDING_PROVIDER`/`NORMATIVE_ANSWER_PROVIDER` via `overrideProvider`, ou `jest.spyOn(global, 'fetch')` nos testes isolados do provider).
- **Comando de teste** (mesmo padrão da Fase 9):
  ```bash
  source /opt/Montese/.env
  export DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}"
  export TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}"
  export REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379"
  docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
    -e DATABASE_URL="$DATABASE_URL" -e TEST_SUPERUSER_DATABASE_URL="$TEST_SUPERUSER_DATABASE_URL" -e REDIS_URL="$REDIS_URL" -e JWT_SECRET="$JWT_SECRET" \
    node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand <arquivo>"
  ```

---

### Task 1: Schema/prompt/provider — `operational_ref_ids` (sem dado real ainda)

**Files:**
- Modify: `backend/src/normative/normative-answer-provider.interface.ts`
- Modify: `backend/src/normative/normative-answer-shared.ts`
- Modify: `backend/src/normative/openrouter-normative-answer.service.ts`
- Test: Create `backend/test/normative-openrouter-answer.e2e-spec.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores (primeira task da fase).
- Produces: `OperationalItem { id: string; titulo: string }`, `NormativeClaim` com `operational_ref_ids: string[]` (campo novo, obrigatório), `NormativeAnswerProvider.answer(question, chunks, operationalItems)` — assinatura nova, consumida pela Task 2.

Esta task só mexe no "provedor" — o `NormativeAssistantService` (Task 2) ainda não passa itens operacionais reais, mas o provider já precisa aceitar e validar o campo novo.

- [ ] **Step 1: Escrever o teste**

Criar `backend/test/normative-openrouter-answer.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { OpenRouterNormativeAnswerService } from '../src/normative/openrouter-normative-answer.service';

describe('OpenRouterNormativeAnswerService', () => {
  let service: OpenRouterNormativeAnswerService;
  let fetchSpy: jest.SpyInstance | undefined;
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [OpenRouterNormativeAnswerService],
    }).compile();
    service = moduleRef.get(OpenRouterNormativeAnswerService);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
  });

  function fakeToolCallResponse(items: unknown[]): Response {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: 'answer_with_citations',
                    arguments: JSON.stringify({ items }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    );
  }

  it('sem OPENROUTER_API_KEY, rejeita antes de qualquer chamada de rede', async () => {
    delete process.env.OPENROUTER_API_KEY;
    fetchSpy = jest.spyOn(global, 'fetch');

    await expect(service.answer('pergunta', [], [])).rejects.toThrow(
      'Assistente ainda não está disponível',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('inclui a seção de itens operacionais no corpo da requisição quando fornecidos, e o schema exige operational_ref_ids', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(fakeToolCallResponse([]));

    await service.answer(
      'estou em conformidade?',
      [{ id: 'chunk-1', content: 'Trecho normativo.' }],
      [{ id: 'op-0', titulo: 'Documento vencido: PGR' }],
    );

    const [, requestInit] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse((requestInit as RequestInit).body as string);
    const userMessage = sentBody.messages[1].content as string;

    expect(userMessage).toContain('Itens operacionais da empresa do usuário');
    expect(userMessage).toContain('[op-0] Documento vencido: PGR');
    expect(sentBody.tools[0].function.parameters.properties.items.items.required).toEqual([
      'claim',
      'chunk_ids',
      'operational_ref_ids',
    ]);
  });

  it('omite a seção de itens operacionais quando a lista está vazia (caso técnico/parceiro)', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(fakeToolCallResponse([]));

    await service.answer('pergunta normativa', [{ id: 'chunk-1', content: 'Trecho.' }], []);

    const [, requestInit] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse((requestInit as RequestInit).body as string);
    const userMessage = sentBody.messages[1].content as string;

    expect(userMessage).not.toContain('Itens operacionais');
  });

  it('extrai claims válidas e descarta item sem operational_ref_ids', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      fakeToolCallResponse([
        { claim: 'Afirmação válida.', chunk_ids: ['c1'], operational_ref_ids: ['op-0'] },
        { claim: 'Sem operational_ref_ids — deve ser descartada.', chunk_ids: ['c1'] },
      ]),
    );

    const result = await service.answer(
      'pergunta',
      [{ id: 'c1', content: 'trecho' }],
      [{ id: 'op-0', titulo: 'item' }],
    );

    expect(result).toEqual([{ claim: 'Afirmação válida.', chunk_ids: ['c1'], operational_ref_ids: ['op-0'] }]);
  });

  it('propaga erro HTTP do OpenRouter como 502', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('erro', { status: 500 }));

    await expect(service.answer('pergunta', [], [])).rejects.toThrow('Não foi possível responder agora');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative-openrouter-answer"
```

Esperado: FAIL — `service.answer` ainda tem assinatura de 2 argumentos, `operational_ref_ids` não existe no schema.

- [ ] **Step 3: Atualizar a interface**

Em `backend/src/normative/normative-answer-provider.interface.ts`, substituir o conteúdo inteiro por:

```ts
export interface OperationalItem {
  id: string;
  titulo: string;
}

export interface NormativeClaim {
  claim: string;
  chunk_ids: string[];
  operational_ref_ids: string[];
}

export interface NormativeAnswerProvider {
  answer(
    question: string,
    chunks: { id: string; content: string }[],
    operationalItems: OperationalItem[],
  ): Promise<NormativeClaim[]>;
}

export const NORMATIVE_ANSWER_PROVIDER = Symbol('NORMATIVE_ANSWER_PROVIDER');
```

- [ ] **Step 4: Atualizar o prompt e o schema compartilhados**

Em `backend/src/normative/normative-answer-shared.ts`, substituir o arquivo inteiro por:

```ts
export const SYSTEM_PROMPT = `Você é um assistente que responde perguntas sobre normas oficiais de
Segurança e Saúde do Trabalho (SST) brasileiras e, quando disponível,
sobre a situação da própria empresa do usuário — usando SOMENTE os
trechos de fonte oficial e os itens operacionais fornecidos abaixo.
Você nunca responde com conhecimento próprio, memória ou suposição —
só com o que está literalmente nos trechos e nos itens fornecidos.

Para cada afirmação que você fizer, chame a ferramenta
answer_with_citations com uma lista de itens, cada um com:
- claim: a afirmação em português, curta e direta
- chunk_ids: a lista dos ids dos trechos normativos (fornecidos
  abaixo, se houver) que sustentam literalmente essa afirmação
- operational_ref_ids: a lista dos ids dos itens operacionais da
  empresa (fornecidos abaixo, se houver) que sustentam essa afirmação

Regras obrigatórias:
- Toda afirmação precisa citar pelo menos um chunk_id real OU pelo
  menos um operational_ref_id real — nunca as duas listas vazias ao
  mesmo tempo. Nunca invente um id que não esteja nas listas
  fornecidas.
- Se nem os trechos normativos nem os itens operacionais fornecidos
  contêm informação suficiente para responder a pergunta, devolva uma
  lista vazia de itens — não tente responder com conhecimento geral.
- Não dê conselho, opinião ou interpretação além do que os trechos e
  itens fornecidos literalmente dizem.`;

export const TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'answer_with_citations',
    description: 'Responde a pergunta citando os trechos normativos e/ou itens operacionais usados',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              claim: { type: 'string' },
              chunk_ids: { type: 'array', items: { type: 'string' } },
              operational_ref_ids: { type: 'array', items: { type: 'string' } },
            },
            required: ['claim', 'chunk_ids', 'operational_ref_ids'],
          },
        },
      },
      required: ['items'],
    },
  },
};

export function buildRagChatCompletionBody(
  model: string,
  question: string,
  chunks: { id: string; content: string }[],
  operationalItems: { id: string; titulo: string }[] = [],
) {
  const sections: string[] = [];
  if (chunks.length > 0) {
    const normativeContext = chunks.map((c) => `[${c.id}] ${c.content}`).join('\n\n');
    sections.push(`Trechos normativos disponíveis:\n\n${normativeContext}`);
  }
  if (operationalItems.length > 0) {
    const operationalContext = operationalItems.map((o) => `[${o.id}] ${o.titulo}`).join('\n');
    sections.push(`Itens operacionais da empresa do usuário:\n\n${operationalContext}`);
  }
  sections.push(`Pergunta: ${question}`);

  return {
    model,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: sections.join('\n\n') },
    ],
    tools: [TOOL_SCHEMA],
    tool_choice: { type: 'function', function: { name: 'answer_with_citations' } },
  };
}

// Cópia local proposital do parser de tool_call (mesma lógica de
// checklist-extraction-shared.ts, na Fase 8) — mantém o módulo
// `normative` sem depender do módulo `ai-copilot` por uma função de 6
// linhas.
export function parseRagToolCall(body: any): { items?: unknown } | null {
  const toolCall = body?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) return null;
  try {
    return JSON.parse(toolCall.function.arguments);
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Atualizar `OpenRouterNormativeAnswerService`**

Em `backend/src/normative/openrouter-normative-answer.service.ts`, substituir o arquivo inteiro por:

```ts
import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { NormativeAnswerProvider, NormativeClaim, OperationalItem } from './normative-answer-provider.interface';
import { buildRagChatCompletionBody, parseRagToolCall } from './normative-answer-shared';

@Injectable()
export class OpenRouterNormativeAnswerService implements NormativeAnswerProvider {
  private readonly logger = new Logger(OpenRouterNormativeAnswerService.name);

  async answer(
    question: string,
    chunks: { id: string; content: string }[],
    operationalItems: OperationalItem[],
  ): Promise<NormativeClaim[]> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Assistente ainda não está disponível');
    }

    const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-5';
    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://montesesst.com.br',
          'X-Title': 'Montese SST - Assistente Normativo',
        },
        body: JSON.stringify(buildRagChatCompletionBody(model, question, chunks, operationalItems)),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      this.logger.error('Falha de rede ao chamar o OpenRouter (assistente)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível responder agora');
    }

    if (!response.ok) {
      this.logger.error(`OpenRouter retornou status ${response.status} (assistente)`);
      throw new BadGatewayException('Não foi possível responder agora');
    }

    let body: any;
    try {
      body = await response.json();
    } catch (err) {
      this.logger.error('Resposta do OpenRouter não é JSON válido (assistente)', (err as Error).stack);
      throw new BadGatewayException('Não foi possível responder agora');
    }

    const parsed = parseRagToolCall(body);
    if (!parsed || !Array.isArray(parsed.items)) return [];

    return parsed.items.filter((item): item is NormativeClaim => {
      if (typeof item !== 'object' || item === null) return false;
      const candidate = item as Record<string, unknown>;
      return (
        typeof candidate.claim === 'string' &&
        Array.isArray(candidate.chunk_ids) &&
        Array.isArray(candidate.operational_ref_ids)
      );
    });
  }
}
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative-openrouter-answer"
```

Esperado: 5 testes passando.

- [ ] **Step 7: `tsc --noEmit` — confirmar que `NormativeAssistantService` ainda compila**

`NormativeAssistantService` (Task 2) ainda não foi tocado nesta task, mas ele chama `this.answerer.answer(question, chunks)` com 2 argumentos — a interface agora exige 3. Isso vai quebrar a compilação até a Task 2. Rodar:

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  node:20-alpine sh -c "npx tsc --noEmit -p tsconfig.json"
```

Esperado: **erro de tipo em `normative-assistant.service.ts`** (chamada com 2 argumentos, 3 exigidos). Isso é esperado e temporário — a Task 2 corrige na mesma tarefa que estende o service. Não tente corrigir `normative-assistant.service.ts` nesta task — é escopo da Task 2.

- [ ] **Step 8: Commit**

```bash
git add backend/src/normative/normative-answer-provider.interface.ts backend/src/normative/normative-answer-shared.ts backend/src/normative/openrouter-normative-answer.service.ts backend/test/normative-openrouter-answer.e2e-spec.ts
git commit -m "feat: operational_ref_ids no schema/prompt/provider do Assistente (Fase 10)"
```

---

### Task 2: Busca operacional condicional + Verificador estendido

**Files:**
- Modify: `backend/src/dashboard/dashboard.module.ts`
- Modify: `backend/src/normative/normative.module.ts`
- Modify: `backend/src/normative/normative-assistant.service.ts`
- Modify: `backend/src/normative/normative-assistant.controller.ts`
- Modify: `backend/test/normative-assistant.e2e-spec.ts`

**Interfaces:**
- Consumes: `OperationalItem`, `NormativeClaim.operational_ref_ids`, `NormativeAnswerProvider.answer(question, chunks, operationalItems)` (Task 1); `DashboardService.getSummary(client, tenantId): Promise<DashboardSummary>` (já existe, `backend/src/dashboard/dashboard.service.ts`); `DatabaseService.withTenantContext(ctx: {userId?, tenantId?, role?}, fn)` (já existe); `AuthenticatedUser { id, tenantId, role }` (`backend/src/common/types.ts`, já existe).
- Produces: `NormativeAssistantService.query(question: string, user: AuthenticatedUser): Promise<NormativeQueryResult>` — assinatura nova (antes era só `query(question: string)`), consumida pelo controller.

- [ ] **Step 1: Atualizar os testes existentes (mensagem de fallback mudou)**

Em `backend/test/normative-assistant.e2e-spec.ts`, trocar as duas ocorrências do texto antigo pelo novo em `Não encontrei uma norma vigente na base que trate disso.` → `Não encontrei nada relevante pra essa pergunta.` (linhas 125 e 154 do arquivo atual — nos testes `'Verificador descarta claim com chunk_id fora do conjunto recuperado'` e `'não chama o provedor de resposta quando nenhum chunk atinge o limiar de similaridade'`).

- [ ] **Step 2: Escrever os testes novos**

No mesmo arquivo `backend/test/normative-assistant.e2e-spec.ts`, adicionar ao `describe` principal (após os imports existentes, adicionar mais um):

```ts
import { NormativeAssistantService } from '../src/normative/normative-assistant.service';
```

Adicionar variáveis de estado no topo do `describe` (junto das já existentes `tokenAdmin`, `tokenEmpresa` etc.):

```ts
  let tokenTecnico: string;
  let expiredDocumentId: string;

  function iso(daysFromToday: number): string {
    const d = new Date();
    d.setDate(d.getDate() + daysFromToday);
    return d.toISOString().slice(0, 10);
  }

  async function insertExpiredDocument(tenantId: string, userId: string, title: string) {
    const res = await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', $2, $3, $3, 'application/pdf', 100, $4, $5, 'empresa')
       RETURNING id`,
      [tenantId, title, `fixture/${tenantId}-pgr-teste.pdf`, iso(-5), userId],
    );
    return res.rows[0].id;
  }
```

Dentro de `beforeAll`, depois do bloco que já cria `tokenEmpresa` e antes do bloco que cria `sourceId` (ou logo depois — a ordem entre esses dois blocos não importa, contanto que ambos rodem antes dos testes), adicionar:

```ts
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Assistente Teste');
    const loginTecnico = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tecnico.email, password: tecnico.password });
    tokenTecnico = loginTecnico.body.access_token;

    expiredDocumentId = await insertExpiredDocument(
      tenant.tenantId,
      tenant.userId,
      'Documento vencido teste operacional',
    );
```

Em `afterAll`, antes do `await client.query('DELETE FROM normative_document_chunks ...')` já existente, adicionar a limpeza do documento (o `db.cleanup()` já cuidaria disso via CASCADE do tenant, mas o documento precisa sumir antes do `db.cleanup()` rodar por causa da FK — na prática o CASCADE de `tenants` já cobre `documents`, então isto é redundante mas inofensivo; adicionar por clareza):

```ts
    await client.query('DELETE FROM documents WHERE id = $1', [expiredDocumentId]);
```

Adicionar os testes novos, ao final do arquivo (antes do fechamento do `describe`):

```ts
  it('empresa recebe itens operacionais reais e o provedor de resposta é chamado com eles', async () => {
    fakeAnswer.mockResolvedValue([]);

    await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'quais minhas pendências?' });

    expect(fakeAnswer).toHaveBeenCalled();
    const lastCall = fakeAnswer.mock.calls[fakeAnswer.mock.calls.length - 1];
    const operationalItemsArg = lastCall[2];
    expect(operationalItemsArg).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ titulo: expect.stringContaining('Documento vencido teste operacional') }),
      ]),
    );
  });

  it('claim que cita só operational_ref_ids (sem chunk_ids) sobrevive ao Verificador', async () => {
    fakeAnswer.mockResolvedValue([
      { claim: 'Você tem um documento vencido.', chunk_ids: [], operational_ref_ids: ['op-0'] },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'quais minhas pendências?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBe('Você tem um documento vencido.');
    expect(res.body.citations).toEqual([]);
  });

  it('claim que cita as duas fontes juntas (chunk_ids e operational_ref_ids válidos) sobrevive ao Verificador', async () => {
    fakeAnswer.mockResolvedValue([
      {
        claim: 'Você tem capacete obrigatório e um documento vencido pra regularizar.',
        chunk_ids: [chunkId],
        operational_ref_ids: ['op-0'],
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'preciso de capacete e quais minhas pendências?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBe('Você tem capacete obrigatório e um documento vencido pra regularizar.');
    expect(res.body.citations).toEqual([
      { document_id: documentId, title: 'Norma teste assistente', official_url: 'https://exemplo.gov.br/assistente.html' },
    ]);
  });

  it('claim com operational_ref_id inventado (fora do conjunto calculado) é descartada mesmo com chunk_id válido', async () => {
    fakeAnswer.mockResolvedValue([
      {
        claim: 'Afirmação com referência operacional inventada.',
        chunk_ids: [chunkId],
        operational_ref_ids: ['op-999-nao-existe'],
      },
    ]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'preciso usar capacete e quais minhas pendências?' });

    expect(res.status).toBe(201);
    expect(res.body.answer).toBeNull();
    expect(res.body.message).toBe('Não encontrei nada relevante pra essa pergunta.');
  });

  it('técnico nunca recebe busca operacional — operationalItems sempre vazio', async () => {
    fakeAnswer.mockResolvedValue([{ claim: 'Resposta normativa.', chunk_ids: [chunkId], operational_ref_ids: [] }]);

    const res = await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenTecnico}`)
      .send({ question: 'preciso usar capacete?' });

    expect(res.status).toBe(201);
    const lastCall = fakeAnswer.mock.calls[fakeAnswer.mock.calls.length - 1];
    expect(lastCall[2]).toEqual([]);
  });
```

Nota: o teste `'claim com operational_ref_id inventado...'` usa uma pergunta que também teria similaridade baixa contra o único chunk indexado no arquivo (chunk exato só bate com o vetor `[1,0,0,...]`, e o `fakeEmbed` padrão já devolve esse vetor exato pra qualquer pergunta nos outros testes) — então `chunk_ids: [chunkId]` É um id real e recuperado (o `fakeEmbed` sempre devolve o vetor exato, então a busca normativa sempre recupera o mesmo `chunkId` nos testes deste arquivo, independente do texto da pergunta). O que torna essa claim inválida é só o `operational_ref_ids` inventado — exatamente o que o teste quer provar (falha em qualquer citação, mesmo com as outras válidas, derruba a afirmação inteira).

- [ ] **Step 3: Rodar os testes e confirmar que falham**

```bash
source /opt/Montese/.env
export DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}"
export TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}"
export REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379"
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  -e DATABASE_URL="$DATABASE_URL" -e TEST_SUPERUSER_DATABASE_URL="$TEST_SUPERUSER_DATABASE_URL" -e REDIS_URL="$REDIS_URL" -e JWT_SECRET="$JWT_SECRET" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative-assistant"
```

Esperado: FAIL — `NormativeAssistantService.query` ainda tem assinatura de 1 argumento; testes novos esperam que `req.user` seja usado e que a busca operacional aconteça.

- [ ] **Step 4: Exportar `DashboardService` do `DashboardModule`**

Em `backend/src/dashboard/dashboard.module.ts`, substituir o arquivo inteiro por:

```ts
import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [DocumentsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
```

- [ ] **Step 5: Importar `DashboardModule` no `NormativeModule`**

Em `backend/src/normative/normative.module.ts`, adicionar o import e registrar em `imports`:

```ts
import { DashboardModule } from '../dashboard/dashboard.module';
```

```ts
@Module({
  imports: [DashboardModule],
  controllers: [OfficialSourcesController, NormativeDocumentsController, NormativeAssistantController],
  providers: [
    OfficialSourcesService,
    NormativeDocumentsService,
    NormativeMonitorService,
    NormativeAssistantService,
    R2Service,
    OpenRouterEmbeddingService,
    { provide: EMBEDDING_PROVIDER, useClass: OpenRouterEmbeddingService },
    OpenRouterNormativeAnswerService,
    { provide: NORMATIVE_ANSWER_PROVIDER, useClass: OpenRouterNormativeAnswerService },
  ],
})
export class NormativeModule {}
```

- [ ] **Step 6: Estender `NormativeAssistantService`**

Em `backend/src/normative/normative-assistant.service.ts`, substituir o arquivo inteiro por:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from './embedding-provider.interface';
import {
  NORMATIVE_ANSWER_PROVIDER,
  NormativeAnswerProvider,
  OperationalItem,
} from './normative-answer-provider.interface';
import { toVectorLiteral } from './vector.util';
import { envFloat } from '../common/env';
import { DatabaseService } from '../common/database/database.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { AuthenticatedUser } from '../common/types';

const FALLBACK_MESSAGE = 'Não encontrei nada relevante pra essa pergunta.';

export interface NormativeQueryCitation {
  document_id: string;
  title: string;
  official_url: string;
}

export interface NormativeQueryResult {
  answer: string | null;
  message?: string;
  citations: NormativeQueryCitation[];
}

interface RetrievedChunk {
  chunk_id: string;
  content: string;
  document_id: string;
  source_title: string;
  official_url: string;
  similarity: number;
}

@Injectable()
export class NormativeAssistantService {
  constructor(
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(NORMATIVE_ANSWER_PROVIDER) private readonly answerer: NormativeAnswerProvider,
    private readonly db: DatabaseService,
    private readonly dashboard: DashboardService,
  ) {}

  async query(question: string, user: AuthenticatedUser): Promise<NormativeQueryResult> {
    const questionEmbedding = await this.embeddings.embed(question);
    // 0.75 (valor original do plano) nunca teria funcionado de verdade —
    // calibrado contra as 38 NRs reais indexadas em 2026-08-31:
    // pergunta irrelevante ("capital da França") ~0.13, tangencial ("bolo
    // de chocolate") ~0.30, pergunta claramente respondida pela base
    // ("cinto de segurança em altura" -> NR-35) 0.63-0.67. `text-
    // embedding-3-small` não produz similaridade alta mesmo pra pares
    // pergunta/trecho genuinamente relevantes — 0.4 separa com folga dos
    // dois lados dessa amostra real.
    const threshold = envFloat('OPENROUTER_RAG_MIN_SIMILARITY', 0.4);

    // `official_sources`, `normative_documents` e
    // `normative_document_chunks` não têm tenant_id nem RLS — não há
    // contexto de tenant a propagar aqui. Usar withoutTenantContext (só
    // pool.connect()/release(), sem BEGIN/COMMIT) garante que nenhuma
    // conexão do pool fica presa "idle in transaction" durante as
    // chamadas HTTP externas lentas (embed acima, answer abaixo) — ver
    // Finding C1a da revisão final da Fase 9.
    const { rows } = await this.db.withoutTenantContext((client) =>
      client.query<RetrievedChunk>(
        `SELECT c.id AS chunk_id, c.content, d.id AS document_id, s.title AS source_title, s.official_url,
                1 - (c.embedding <=> $1::vector) AS similarity
         FROM normative_document_chunks c
         JOIN normative_documents d ON d.id = c.document_id
         JOIN official_sources s ON s.id = d.source_id
         WHERE d.status = 'vigente' AND d.indexed_at IS NOT NULL
         ORDER BY c.embedding <=> $1::vector
         LIMIT 6`,
        [toVectorLiteral(questionEmbedding)],
      ),
    );
    const relevant = rows.filter((r) => r.similarity >= threshold);

    // Busca operacional só pra empresa, numa transação curta e SEPARADA
    // — mesma regra de nunca segurar conexão durante chamada de IA (ver
    // Finding C1a). Roda ANTES de chamar this.answerer.answer(...),
    // então não estende a janela de conexão aberta durante embedding/chat.
    // technico/parceiro: operationalItems fica [] sempre, comportamento
    // idêntico ao da Fase 9.
    let operationalItems: OperationalItem[] = [];
    if (user.role === 'empresa' && user.tenantId) {
      const tenantId = user.tenantId;
      const summary = await this.db.withTenantContext(
        { userId: user.id, tenantId, role: user.role },
        (client) => this.dashboard.getSummary(client, tenantId),
      );
      operationalItems = summary.atencao.map((item, i) => ({ id: `op-${i}`, titulo: item.titulo }));
    }

    if (relevant.length === 0 && operationalItems.length === 0) {
      return { answer: null, message: FALLBACK_MESSAGE, citations: [] };
    }

    const claims = await this.answerer.answer(
      question,
      relevant.map((r) => ({ id: r.chunk_id, content: r.content })),
      operationalItems,
    );

    const validChunkIds = new Set(relevant.map((r) => r.chunk_id));
    const validOperationalIds = new Set(operationalItems.map((o) => o.id));
    // Regra exata (ver Global Constraints do plano): uma afirmação com
    // as duas listas vazias é descartada mesmo que nenhuma das duas
    // contenha um id inválido — every() sobre array vazio dá true em
    // JS, então "tem pelo menos uma fonte" é checado à parte, nunca
    // inferido só das duas every().
    const survivingClaims = claims.filter((claim) => {
      const hasSource = claim.chunk_ids.length > 0 || claim.operational_ref_ids.length > 0;
      return (
        hasSource &&
        claim.chunk_ids.every((id) => validChunkIds.has(id)) &&
        claim.operational_ref_ids.every((id) => validOperationalIds.has(id))
      );
    });

    if (survivingClaims.length === 0) {
      return { answer: null, message: FALLBACK_MESSAGE, citations: [] };
    }

    const usedChunkIds = new Set(survivingClaims.flatMap((c) => c.chunk_ids));
    const citationsByDocument = new Map<string, NormativeQueryCitation>();
    for (const chunk of relevant) {
      if (usedChunkIds.has(chunk.chunk_id)) {
        citationsByDocument.set(chunk.document_id, {
          document_id: chunk.document_id,
          title: chunk.source_title,
          official_url: chunk.official_url,
        });
      }
    }

    return {
      answer: survivingClaims.map((c) => c.claim).join('\n\n'),
      citations: Array.from(citationsByDocument.values()),
    };
  }
}
```

- [ ] **Step 7: Atualizar o controller**

Em `backend/src/normative/normative-assistant.controller.ts`, substituir o arquivo inteiro por:

```ts
import { Body, Controller, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';
import { NormativeAssistantService } from './normative-assistant.service';
import { NormativeQueryDto } from './dto/normative-query.dto';

@Controller('assistant')
export class NormativeAssistantController {
  constructor(private readonly assistant: NormativeAssistantService) {}

  @Roles('empresa', 'tecnico', 'parceiro')
  @RateLimit({
    limit: envInt('ASSISTANT_RATE_LIMIT_MAX', 20),
    windowSeconds: envInt('ASSISTANT_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('normative-query')
  query(@Body() dto: NormativeQueryDto, @Req() req: any) {
    return this.assistant.query(dto.question, req.user);
  }
}
```

Note: `@Req() req: any` volta a existir só pra ler `req.user` — **não** volta a envolver a chamada em `req.withTenantContext(...)`. Essa distinção é o ponto central do Global Constraints deste plano.

- [ ] **Step 8: Rodar os testes e confirmar que passam**

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  -e DATABASE_URL="$DATABASE_URL" -e TEST_SUPERUSER_DATABASE_URL="$TEST_SUPERUSER_DATABASE_URL" -e REDIS_URL="$REDIS_URL" -e JWT_SECRET="$JWT_SECRET" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative-assistant"
```

Esperado: 9 testes passando (4 já existentes da Fase 9 + 5 novos desta task).

- [ ] **Step 9: Commit**

```bash
git add backend/src/dashboard/dashboard.module.ts backend/src/normative/normative.module.ts backend/src/normative/normative-assistant.service.ts backend/src/normative/normative-assistant.controller.ts backend/test/normative-assistant.e2e-spec.ts
git commit -m "feat: busca operacional condicional por papel no Assistente (Fase 10)"
```

---

### Task 3: Isolamento entre tenants + regressão completa

**Files:**
- Modify: `backend/test/normative-assistant.e2e-spec.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1-2. Última task da fase — nenhuma outra depende dela.

- [ ] **Step 1: Escrever o teste de isolamento**

No mesmo arquivo, adicionar ao final (depois dos testes da Task 2):

```ts
  it('isolamento entre tenants: empresa nunca recebe item operacional de outro tenant', async () => {
    const outroTenant = await db.createTenantWithUser('Empresa Assistente Teste — Outro Tenant');
    const outroDocumentId = await insertExpiredDocument(
      outroTenant.tenantId,
      outroTenant.userId,
      'Documento vencido do OUTRO tenant — nunca deve aparecer',
    );

    fakeAnswer.mockResolvedValue([]);

    await request(app.getHttpServer())
      .post('/assistant/normative-query')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ question: 'quais minhas pendências?' });

    const lastCall = fakeAnswer.mock.calls[fakeAnswer.mock.calls.length - 1];
    const operationalItemsArg = lastCall[2];
    const titulos = operationalItemsArg.map((o: any) => o.titulo);

    expect(titulos.some((t: string) => t.includes('Documento vencido teste operacional'))).toBe(true);
    expect(titulos.some((t: string) => t.includes('OUTRO tenant'))).toBe(false);

    await (db as any).client.query('DELETE FROM documents WHERE id = $1', [outroDocumentId]);
    await (db as any).client.query('DELETE FROM users WHERE tenant_id = $1', [outroTenant.tenantId]);
    await (db as any).client.query('DELETE FROM tenants WHERE id = $1', [outroTenant.tenantId]);
  });
```

- [ ] **Step 2: Rodar o teste e confirmar que passa**

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  -e DATABASE_URL="$DATABASE_URL" -e TEST_SUPERUSER_DATABASE_URL="$TEST_SUPERUSER_DATABASE_URL" -e REDIS_URL="$REDIS_URL" -e JWT_SECRET="$JWT_SECRET" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand normative-assistant"
```

Esperado: 10 testes passando.

- [ ] **Step 3: Rodar a suíte `normative*` inteira (regressão)**

```bash
docker exec montese_redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'ratelimit:*' | xargs -r -I{} docker exec montese_redis redis-cli -a "$REDIS_PASSWORD" DEL {}
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  -e DATABASE_URL="$DATABASE_URL" -e TEST_SUPERUSER_DATABASE_URL="$TEST_SUPERUSER_DATABASE_URL" -e REDIS_URL="$REDIS_URL" -e JWT_SECRET="$JWT_SECRET" \
  -e R2_ENDPOINT="$R2_ENDPOINT" -e R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" -e R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" -e R2_BUCKET="$R2_BUCKET" \
  node:20-alpine sh -c "npx tsc --noEmit -p tsconfig.json && npx jest --config ./test/jest-e2e.json --runInBand normative"
```

Esperado: `tsc` limpo, todas as suítes `normative-*` passando (8 suítes: as 7 da Fase 9 + `normative-openrouter-answer` desta fase).

- [ ] **Step 4: Commit**

```bash
git add backend/test/normative-assistant.e2e-spec.ts
git commit -m "test: isolamento entre tenants na busca operacional do Assistente (Fase 10)"
```

---

## Depois da última task

Build + deploy real (`docker compose build backend && docker compose up -d backend`), `db:migrate` no container de produção (no-op — sem migration nova nesta fase), e uma consulta real contra a API paga combinando as duas fontes (ex.: "estou em conformidade com a NR-06?" pra uma empresa com pendência real cadastrada) — mesmo processo de validação manual das Fases 8 e 9, pra confirmar que o modelo real combina os dois tipos de fonte do jeito esperado antes de considerar a fase pronta.
