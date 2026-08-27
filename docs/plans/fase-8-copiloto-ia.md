# Fase 8 — Copiloto de IA (relato em campo → checklist) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um técnico digita um relato livre de visita em campo e recebe
uma sugestão de preenchimento pros 16 itens do checklist de inspeção já
existente, sempre revisada e aplicada manualmente antes de qualquer
gravação.

**Architecture:** Um endpoint novo, stateless (não escreve no banco),
delega a extração pra um provedor de IA externo (MiniMax) atrás de uma
interface trocável. A tela de checklist já existente ganha uma seção
que chama esse endpoint e mostra a sugestão como um card "Aplicar/
Descartar" por item — aplicar reusa o mecanismo de salvar que a tela já
tem hoje.

**Tech Stack:** NestJS (backend, mesmo módulo `inspections`), `fetch`
nativo do Node 20 (sem SDK novo pro MiniMax), Next.js/React (frontend,
mesmo arquivo de página já existente).

**Spec:** [`docs/specs/fase-8-copiloto-ia.md`](../specs/fase-8-copiloto-ia.md)

## Global Constraints

- Sem IA local — toda chamada de IA é via API externa (MiniMax),
  regra não-negociável do projeto desde `docs/vision.md`.
- `MINIMAX_API_KEY` fica **vazia** no `.env` até o fundador assinar —
  o código de integração fica completo e pronto, mas nunca é ativado
  nesta rodada. Nenhum teste chama a API real do MiniMax.
- O endpoint novo **nunca escreve no banco** — é uma transformação
  stateless (texto → sugestão). Toda gravação continua pelos endpoints
  já existentes (`PATCH /inspections/:id/items/:itemId`).
- Reusa exatamente os 16 `item_key` de
  `backend/src/inspections/checklist-items.const.ts` e o vocabulário de
  status `'C' | 'NC' | 'NA'` — não inventa categoria nova.
- A tela de checklist (`frontend/src/app/tecnico/empresas/[tenantId]/inspecoes/[id]/page.tsx`)
  serve tanto técnico responsável quanto parceiro — não existe árvore
  `/parceiro/...` separada, não criar uma.
- Aviso fixo, não removível, na UI: "Sugestão gerada por IA — revise e
  confirme. Não substitui a avaliação do profissional habilitado."
- Suíte e2e real contra Postgres/Redis reais dos containers Docker
  desta VPS — nenhum mock de banco. O único mock aceito é `global.fetch`
  (chamada de rede ao MiniMax) e o `FieldReportExtractor` via
  `overrideProvider` (mesmo padrão já usado com `MercadoPagoService`).

---

### Task 1: Interface `FieldReportExtractor` + `MiniMaxExtractorService` + `AiCopilotModule`

**Files:**
- Create: `backend/src/ai-copilot/field-report-extractor.interface.ts`
- Create: `backend/src/ai-copilot/minimax-extractor.service.ts`
- Create: `backend/src/ai-copilot/ai-copilot.module.ts`
- Modify: `backend/src/inspections/inspections.module.ts`
- Test: `backend/test/ai-copilot-minimax-extractor.e2e-spec.ts`

**Interfaces:**
- Produces: `FieldReportExtractor` interface (`extract(reportText: string): Promise<ChecklistItemSuggestion[]>`), `ChecklistItemSuggestion` type (`{ item_key: string; status: 'C'|'NC'|'NA'; notes: string }`), `FIELD_REPORT_EXTRACTOR` injection token (Symbol). Task 2 injeta `FIELD_REPORT_EXTRACTOR` no controller.
- Consumes: `CHECKLIST_ITEMS` de `backend/src/inspections/checklist-items.const.ts` (já existe, Fase 6A) — usado pra montar a lista de 16 `item_key` válidos.

- [ ] **Step 1: Criar a interface e o token de injeção**

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

- [ ] **Step 2: Escrever o arquivo de teste (vai falhar até os próximos steps)**

```typescript
// backend/test/ai-copilot-minimax-extractor.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import {
  FIELD_REPORT_EXTRACTOR,
  FieldReportExtractor,
} from '../src/ai-copilot/field-report-extractor.interface';

describe('MiniMaxExtractorService (e2e via DI)', () => {
  let app: INestApplication;
  let extractor: FieldReportExtractor;
  let fetchSpy: jest.SpyInstance | undefined;
  const originalApiKey = process.env.MINIMAX_API_KEY;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    extractor = moduleRef.get<FieldReportExtractor>(FIELD_REPORT_EXTRACTOR);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
    if (originalApiKey === undefined) {
      delete process.env.MINIMAX_API_KEY;
    } else {
      process.env.MINIMAX_API_KEY = originalApiKey;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('sem MINIMAX_API_KEY configurada, rejeita antes de qualquer chamada de rede', async () => {
    delete process.env.MINIMAX_API_KEY;
    fetchSpy = jest.spyOn(global, 'fetch');

    await expect(extractor.extract('relato qualquer')).rejects.toThrow(
      'Copiloto de IA ainda não está disponível',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('extrai itens válidos e descarta item_key alucinado pela IA', async () => {
    process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
    const minimaxBody = {
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: 'structure_checklist_items',
                  arguments: JSON.stringify({
                    items: [
                      { item_key: 'extintores', status: 'NC', notes: 'Lacre rompido, validade vencida' },
                      { item_key: 'item_inventado_pela_ia', status: 'NC', notes: 'não deve aparecer' },
                    ],
                  }),
                },
              },
            ],
          },
        },
      ],
    };
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(minimaxBody), { status: 200 }));

    const result = await extractor.extract('Extintor com lacre rompido e vencido.');

    expect(result).toEqual([
      { item_key: 'extintores', status: 'NC', notes: 'Lacre rompido, validade vencida' },
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.minimax.io/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('propaga erro HTTP do MiniMax como 502', async () => {
    process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('erro interno', { status: 500 }));

    await expect(extractor.extract('relato qualquer')).rejects.toThrow(
      'Não foi possível gerar o rascunho agora',
    );
  });

  it('propaga falha de rede como 502', async () => {
    process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(extractor.extract('relato qualquer')).rejects.toThrow(
      'Não foi possível gerar o rascunho agora',
    );
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run (de dentro de `backend/`, contra os containers Docker desta VPS —
ver `docker run --network montese_internal ... npx jest --config
./test/jest-e2e.json --runInBand test/ai-copilot-minimax-extractor.e2e-spec.ts`,
mesmo padrão usado no resto do projeto).

Expected: FAIL — `Cannot find module '../src/ai-copilot/field-report-extractor.interface'`
ou, depois do Step 1, `Nest can't resolve dependencies` / `FIELD_REPORT_EXTRACTOR` sem provider.

- [ ] **Step 4: Implementar `MiniMaxExtractorService`**

```typescript
// backend/src/ai-copilot/minimax-extractor.service.ts
import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { CHECKLIST_ITEMS } from '../inspections/checklist-items.const';
import { ChecklistItemSuggestion, FieldReportExtractor } from './field-report-extractor.interface';

const VALID_ITEM_KEYS = CHECKLIST_ITEMS.map((item) => item.item_key);
const VALID_STATUSES = ['C', 'NC', 'NA'];

const SYSTEM_PROMPT = `Você é um assistente que ajuda técnicos de Segurança e Saúde do
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
  avalia a segurança do local.`;

const TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'structure_checklist_items',
    description: 'Retorna os itens do checklist mencionados no relato do técnico',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              item_key: { type: 'string', enum: VALID_ITEM_KEYS },
              status: { type: 'string', enum: VALID_STATUSES },
              notes: { type: 'string' },
            },
            required: ['item_key', 'status', 'notes'],
          },
        },
      },
      required: ['items'],
    },
  },
};

@Injectable()
export class MiniMaxExtractorService implements FieldReportExtractor {
  private readonly logger = new Logger(MiniMaxExtractorService.name);

  async extract(reportText: string): Promise<ChecklistItemSuggestion[]> {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Copiloto de IA ainda não está disponível');
    }

    const model = process.env.MINIMAX_MODEL || 'MiniMax-M3';
    let response: Response;
    try {
      response = await fetch('https://api.minimax.io/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: reportText },
          ],
          tools: [TOOL_SCHEMA],
          tool_choice: { type: 'function', function: { name: 'structure_checklist_items' } },
        }),
      });
    } catch (err) {
      this.logger.error('Falha de rede ao chamar o MiniMax', (err as Error).stack);
      throw new BadGatewayException('Não foi possível gerar o rascunho agora');
    }

    if (!response.ok) {
      this.logger.error(`MiniMax retornou status ${response.status}`);
      throw new BadGatewayException('Não foi possível gerar o rascunho agora');
    }

    const body = await response.json();
    const toolCall = body?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      this.logger.error('Resposta do MiniMax sem tool_call');
      throw new BadGatewayException('Não foi possível gerar o rascunho agora');
    }

    let parsed: { items?: unknown };
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (err) {
      this.logger.error('Argumentos do tool_call não são JSON válido', (err as Error).stack);
      throw new BadGatewayException('Não foi possível gerar o rascunho agora');
    }

    if (!Array.isArray(parsed.items)) return [];

    return parsed.items.filter((item): item is ChecklistItemSuggestion => {
      if (typeof item !== 'object' || item === null) return false;
      const candidate = item as Record<string, unknown>;
      return (
        typeof candidate.item_key === 'string' &&
        VALID_ITEM_KEYS.includes(candidate.item_key) &&
        typeof candidate.status === 'string' &&
        VALID_STATUSES.includes(candidate.status) &&
        typeof candidate.notes === 'string'
      );
    });
  }
}
```

- [ ] **Step 5: Criar o módulo**

```typescript
// backend/src/ai-copilot/ai-copilot.module.ts
import { Module } from '@nestjs/common';
import { FIELD_REPORT_EXTRACTOR } from './field-report-extractor.interface';
import { MiniMaxExtractorService } from './minimax-extractor.service';

@Module({
  providers: [{ provide: FIELD_REPORT_EXTRACTOR, useClass: MiniMaxExtractorService }],
  exports: [FIELD_REPORT_EXTRACTOR],
})
export class AiCopilotModule {}
```

- [ ] **Step 6: Importar `AiCopilotModule` em `InspectionsModule`**

```typescript
// backend/src/inspections/inspections.module.ts
import { Module } from '@nestjs/common';
import { InspectionsController } from './inspections.controller';
import { ActionPlansController } from './action-plans.controller';
import { InspectionsService } from './inspections.service';
import { AiCopilotModule } from '../ai-copilot/ai-copilot.module';

@Module({
  imports: [AiCopilotModule],
  controllers: [InspectionsController, ActionPlansController],
  providers: [InspectionsService],
})
export class InspectionsModule {}
```

- [ ] **Step 7: Rodar o teste e confirmar que passa**

Run: `npx jest --config ./test/jest-e2e.json --runInBand test/ai-copilot-minimax-extractor.e2e-spec.ts`
Expected: PASS — 4 testes.

- [ ] **Step 8: Commit**

```bash
git add backend/src/ai-copilot backend/src/inspections/inspections.module.ts backend/test/ai-copilot-minimax-extractor.e2e-spec.ts
git commit -m "feat: adiciona FieldReportExtractor + MiniMaxExtractorService (Fase 8)"
```

---

### Task 2: Endpoint `POST /inspections/:id/ai-draft`

**Files:**
- Create: `backend/src/inspections/dto/ai-draft.dto.ts`
- Modify: `backend/src/inspections/inspections.controller.ts`
- Test: `backend/test/inspections-ai-draft.e2e-spec.ts`

**Interfaces:**
- Consumes: `FIELD_REPORT_EXTRACTOR` / `FieldReportExtractor` (Task 1), `InspectionsService.findOne(client, id): Promise<InspectionDetail>` (já existe, Fase 6A — usado aqui só pela checagem de existência/RLS, lança `NotFoundException` se a inspeção não existir ou não for visível pro usuário).
- Produces: `POST /inspections/:id/ai-draft` devolvendo `ChecklistItemSuggestion[]` — consumido pelo frontend na Task 3.

- [ ] **Step 1: Escrever o arquivo de teste (vai falhar até os próximos steps)**

```typescript
// backend/test/inspections-ai-draft.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FIELD_REPORT_EXTRACTOR } from '../src/ai-copilot/field-report-extractor.interface';
import { TestDb } from './db-test-helper';

describe('POST /inspections/:id/ai-draft (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  const fakeExtractor = { extract: jest.fn() };

  let tenantId: string;
  let technicianId: string;
  let technicianToken: string;
  let empresaToken: string;
  let inspectionId: string;

  let otherTenantId: string;
  let otherTechnicianId: string;
  let otherTechnicianToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FIELD_REPORT_EXTRACTOR)
      .useValue(fakeExtractor)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa AI Draft Teste');
    tenantId = tenant.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico AI Draft Teste');
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    const loginTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = loginTech.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;

    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-27' });
    inspectionId = createRes.body.id;

    const otherTenant = await db.createTenantWithUser('Empresa AI Draft Nao Vinculada Teste');
    otherTenantId = otherTenant.tenantId;
    const otherTech = await db.createUserWithRole('tecnico', 'Tecnico AI Draft Nao Vinculado Teste');
    const otherTechResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [otherTech.userId],
    );
    otherTechnicianId = otherTechResult.rows[0].id;
    const loginOtherTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: otherTech.email, password: otherTech.password });
    otherTechnicianToken = loginOtherTech.body.access_token;
  });

  afterEach(() => {
    fakeExtractor.extract.mockReset();
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM inspections WHERE id = $1', [inspectionId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = ANY($1)', [
      [technicianId, otherTechnicianId],
    ]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('técnico vinculado recebe a sugestão devolvida pelo extractor', async () => {
    fakeExtractor.extract.mockResolvedValue([
      { item_key: 'extintores', status: 'NC', notes: 'Lacre rompido' },
    ]);

    const res = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/ai-draft`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ report_text: 'Extintor com lacre rompido.' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual([{ item_key: 'extintores', status: 'NC', notes: 'Lacre rompido' }]);
    expect(fakeExtractor.extract).toHaveBeenCalledWith('Extintor com lacre rompido.');
  });

  it('rejeita report_text vazio com 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/ai-draft`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ report_text: '' });

    expect(res.status).toBe(400);
    expect(fakeExtractor.extract).not.toHaveBeenCalled();
  });

  it('bloqueia empresa com 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/ai-draft`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ report_text: 'relato qualquer' });

    expect(res.status).toBe(403);
  });

  it('técnico sem vínculo com a inspeção recebe 404 (RLS)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/ai-draft`)
      .set('Authorization', `Bearer ${otherTechnicianToken}`)
      .send({ report_text: 'relato qualquer' });

    expect(res.status).toBe(404);
    expect(fakeExtractor.extract).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx jest --config ./test/jest-e2e.json --runInBand test/inspections-ai-draft.e2e-spec.ts`
Expected: FAIL — `404` genérico do Nest (rota não existe ainda) nos dois
primeiros testes.

- [ ] **Step 3: Criar o DTO**

```typescript
// backend/src/inspections/dto/ai-draft.dto.ts
import { IsNotEmpty, IsString } from 'class-validator';

export class AiDraftDto {
  @IsString()
  @IsNotEmpty()
  report_text: string;
}
```

- [ ] **Step 4: Adicionar o endpoint no controller**

Modificar `backend/src/inspections/inspections.controller.ts` — trocar o
import do `@nestjs/common` no topo (linha 1-13) pra incluir `Inject`, e
adicionar os dois imports novos e o endpoint:

```typescript
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { InspectionsService } from './inspections.service';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { UpdateInspectionDto } from './dto/update-inspection.dto';
import { UpdateChecklistItemDto } from './dto/update-checklist-item.dto';
import { AiDraftDto } from './dto/ai-draft.dto';
import { FIELD_REPORT_EXTRACTOR, FieldReportExtractor } from '../ai-copilot/field-report-extractor.interface';

@Controller('inspections')
export class InspectionsController {
  constructor(
    private readonly inspections: InspectionsService,
    @Inject(FIELD_REPORT_EXTRACTOR) private readonly extractor: FieldReportExtractor,
  ) {}
```

E, logo após o método `updateItem` (antes do método `conclude`),
adicionar:

```typescript
  @Roles('tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/ai-draft')
  async aiDraft(@Param('id') id: string, @Body() dto: AiDraftDto, @Req() req: any) {
    await req.withTenantContext((client: any) => this.inspections.findOne(client, id));
    return this.extractor.extract(dto.report_text);
  }
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx jest --config ./test/jest-e2e.json --runInBand test/inspections-ai-draft.e2e-spec.ts`
Expected: PASS — 4 testes.

- [ ] **Step 6: Rodar a suíte e2e completa**

Run: `npx jest --config ./test/jest-e2e.json --runInBand`
Expected: PASS — todas as suítes, incluindo as duas novas.

- [ ] **Step 7: Commit**

```bash
git add backend/src/inspections/dto/ai-draft.dto.ts backend/src/inspections/inspections.controller.ts backend/test/inspections-ai-draft.e2e-spec.ts
git commit -m "feat: adiciona POST /inspections/:id/ai-draft (Fase 8)"
```

---

### Task 3: Frontend — Copiloto de IA na tela de checklist

**Files:**
- Modify: `frontend/src/app/tecnico/empresas/[tenantId]/inspecoes/[id]/page.tsx`

**Interfaces:**
- Consumes: `POST /api/inspections/:id/ai-draft` (Task 2), devolve
  `{ item_key: string; status: 'C'|'NC'|'NA'; notes: string }[]`. Reusa
  `saveItem(itemId: string, patch: { status?: string; notes?: string })`
  (já existe no arquivo, linha 105) — não cria nenhum mecanismo de
  salvar novo.

- [ ] **Step 1: Adicionar o tipo de sugestão e o estado novo**

Logo após a interface `ChecklistItem` (linha 6-13), adicionar:

```typescript
interface AiSuggestion {
  status: 'C' | 'NC' | 'NA';
  notes: string;
}
```

Dentro do componente, logo após a declaração de `concluding` (linha 56),
adicionar:

```typescript
  const [reportText, setReportText] = useState('');
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, AiSuggestion>>({});
```

(`aiSuggestions` é indexado por `item_key`, não por `id` do item — o
endpoint devolve `item_key`, que é estável e já vem em cada
`ChecklistItem.item_key`.)

- [ ] **Step 2: Adicionar os handlers**

Logo após a função `saveItem` (depois da linha 126, antes de
`handleConcluir`), adicionar:

```typescript
  async function handleGenerateDraft() {
    setGeneratingDraft(true);
    setAiError('');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/inspections/${params.id}/ai-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ report_text: reportText }),
      });
      if (res.ok) {
        const suggestions: { item_key: string; status: 'C' | 'NC' | 'NA'; notes: string }[] = await res.json();
        const byItemKey: Record<string, AiSuggestion> = {};
        for (const s of suggestions) {
          byItemKey[s.item_key] = { status: s.status, notes: s.notes };
        }
        setAiSuggestions(byItemKey);
      } else if (res.status === 503) {
        setAiError('Copiloto de IA ainda não está disponível nesta conta.');
      } else {
        setAiError('Não foi possível gerar o rascunho agora, tente novamente.');
      }
    } catch {
      setAiError('Não foi possível conectar ao servidor.');
    }
    setGeneratingDraft(false);
  }

  function applySuggestion(item: ChecklistItem) {
    const suggestion = aiSuggestions[item.item_key];
    if (!suggestion) return;
    saveItem(item.id, { status: suggestion.status, notes: suggestion.notes });
    setAiSuggestions((prev) => {
      const next = { ...prev };
      delete next[item.item_key];
      return next;
    });
  }

  function discardSuggestion(itemKey: string) {
    setAiSuggestions((prev) => {
      const next = { ...prev };
      delete next[itemKey];
      return next;
    });
  }
```

- [ ] **Step 3: Adicionar a seção "Copiloto de IA" na tela**

Logo após o bloco `{error && ...}` (linha 164) e antes da seção
"Identificação" (linha 166), adicionar — só quando `isDraft` (não faz
sentido gerar rascunho numa inspeção já concluída):

```typescript
      {isDraft && (
        <section className="mt-6 rounded-lg border border-brand-100 p-6">
          <h2 className="text-lg font-bold text-brand-900">Copiloto de IA</h2>
          <p className="mt-2 text-xs text-brand-700">
            Sugestão gerada por IA — revise e confirme. Não substitui a avaliação do profissional
            habilitado.
          </p>
          <textarea
            value={reportText}
            onChange={(e) => setReportText(e.target.value)}
            placeholder="Descreva o que você observou na visita..."
            className="mt-3 w-full rounded-md border border-brand-100 px-3 py-2 text-sm"
            rows={4}
          />
          <button
            type="button"
            onClick={handleGenerateDraft}
            disabled={generatingDraft || reportText.trim() === ''}
            className="mt-3 rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {generatingDraft ? 'Gerando...' : 'Gerar rascunho com IA'}
          </button>
          {aiError && <p className="mt-2 text-sm text-red-600">{aiError}</p>}
        </section>
      )}
```

- [ ] **Step 4: Mostrar o card de sugestão por item**

Dentro do `.map((item) => (...))` do checklist (linha 185-209), logo
depois de `<p className="text-sm font-medium text-brand-900">{item.item_label}</p>`
(linha 187) e antes do `<div className="mt-2 flex gap-3 text-sm">`
(linha 188), adicionar:

```typescript
                  {aiSuggestions[item.item_key] && (
                    <div className="mt-2 rounded-md bg-brand-50 p-3 text-xs">
                      <p className="text-brand-900">
                        IA sugere: <strong>{aiSuggestions[item.item_key].status}</strong> —{' '}
                        {aiSuggestions[item.item_key].notes}
                      </p>
                      <div className="mt-2 flex gap-3">
                        <button
                          type="button"
                          onClick={() => applySuggestion(item)}
                          className="font-medium text-brand-500 hover:underline"
                        >
                          Aplicar
                        </button>
                        <button
                          type="button"
                          onClick={() => discardSuggestion(item.item_key)}
                          className="text-brand-700 hover:underline"
                        >
                          Descartar
                        </button>
                      </div>
                    </div>
                  )}
```

- [ ] **Step 5: Build isolado do frontend**

Run:
```bash
cd /opt/Montese/frontend && docker build -t montese-frontend-buildcheck .
```
Expected: `✓ Compiled successfully`, sem erro de tipo — mesmo processo
usado nas fases anteriores desta sessão. Depois, remover a imagem de
teste: `docker rmi montese-frontend-buildcheck`.

- [ ] **Step 6: Commit**

```bash
git add "frontend/src/app/tecnico/empresas/[tenantId]/inspecoes/[id]/page.tsx"
git commit -m "feat: adiciona Copiloto de IA na tela de checklist de inspecao (Fase 8)"
```
