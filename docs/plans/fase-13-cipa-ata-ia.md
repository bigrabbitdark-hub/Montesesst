# Fase 13 — CIPA: ata por IA (upload de áudio → transcrição → rascunho): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empresa faz upload de um áudio já gravado da reunião na tela `/empresa/cipa/reunioes/[id]`; o sistema transcreve (Groq/Whisper) e usa IA (OpenRouter, mesmo padrão da Fase 8) pra gerar um rascunho dos 3 campos de texto da ata (pauta/discussões/deliberações), que a empresa revisa e aplica campo a campo — nunca grava automaticamente.

**Architecture:** Processamento assíncrono sem fila de jobs nova: o upload grava uma linha em `cipa_meeting_ata_drafts` com `status: 'processando'` dentro da transação da própria requisição, depois dispara (sem `await`) uma função em segundo plano que chama Groq (transcrição) e OpenRouter (extração) fora de qualquer transação Postgres aberta — cada chamada de IA pode levar minutos num áudio longo, e este backend tem só `DB_POOL_MAX=10` conexões, então seguraria o pool à toa. O frontend faz polling em `GET :id/ata-ai-draft` até sair de `processando`. O áudio nunca toca o R2 nem o disco: fica só no buffer em memória do multer durante a chamada de transcrição (deliberadamente diferente do texto literal da spec §4, que mencionava R2 — como não há worker/fila separada, escrever no R2 e reler de volta seria round-trip sem benefício pra um arquivo descartado poucos segundos depois; o comportamento observável da spec, "áudio nunca fica retido", é preservado). Reaproveita diretamente o padrão de extração por function-calling forçado + interface trocável da Fase 8 (`docs/specs/fase-8-copiloto-ia.md`), mas com uma interface nova (`AtaExtractor`) — o formato de saída (3 campos de texto livre) não tem relação com o `FieldReportExtractor` de 16 itens de checklist da Fase 8, então não é reaproveitado diretamente, só o *padrão*.

**Tech Stack:** NestJS + Postgres/RLS (backend, já em uso). Groq (Whisper `whisper-large-v3-turbo`) via `fetch` nativo pra transcrição — primeira vez que o projeto lida com áudio. OpenRouter via `fetch` nativo pra extração (já em uso desde a Fase 8). Next.js 14 + React + Tailwind (frontend, já em uso) — sem lib de ícones nova, emoji.

**Spec:** [`docs/specs/fase-13-cipa-ata-ia.md`](../specs/fase-13-cipa-ata-ia.md)

## Global Constraints

- Só upload de arquivo já gravado — sem captura de microfone no navegador.
- IA extrai só os 3 campos de texto da ata (pauta/discussões/deliberações) — nunca participantes, nunca checklist.
- Processamento assíncrono, sem fila de jobs nova (sem BullMQ/Redis pra isso) — em processo, com trade-off aceito de perder o job sem retry se o backend reiniciar no meio.
- Áudio nunca fica retido — só a transcrição em texto persiste.
- Transcrição fica visível pra empresa numa seção "Ver transcrição" na tela da reunião.
- Aplicar o rascunho é por campo (3 cards, Aplicar/Descartar cada um) — nunca tudo-ou-nada, nunca grava automaticamente no campo real.
- `GROQ_API_KEY` fica vazia de propósito até o fundador decidir ativar (mesmo padrão do `MINIMAX_API_KEY` original da Fase 8) — código pronto, endpoint devolve erro claro (503) sem a chave.
- `max_tokens` explícito em toda chamada de IA (achado real da Fase 8: sem isso, o pedido tenta usar o teto de saída do modelo e pode estourar orçamento).
- Toda chamada de IA usa `AbortSignal.timeout(...)` explícito.
- Variáveis de ambiente novas entram corretas no `docker-compose.yml`/`.env.example` no mesmo commit que as introduz — não depois (achado #1 da revisão final da Fase 8).
- Sem test runner no frontend (`frontend/package.json` confirmado sem jest/vitest/testing-library) — verificação de frontend é manual, Playwright com sessão sintética via `localStorage` + `page.route()` mockando `/api/*`, contra a build de produção real (`docker compose build frontend`), mesmo padrão de toda a Fase 12b. Backend tem suíte e2e real (`npm run test:e2e`, Postgres real, sem mock de banco) — toda mudança de backend precisa de teste e2e cobrindo.
- Lock `SELECT ... FOR UPDATE` na linha de `cipa_meetings` antes de criar/substituir o rascunho de IA — mesmo padrão de `MeetingsService.update`/`setParticipants`, evita corrida entre dois uploads quase simultâneos na mesma reunião.

---

## Task 1: Migration — tabela `cipa_meeting_ata_drafts`

**Files:**
- Create: `backend/db/migrations/0027_cipa_meeting_ata_drafts.sql`

**Interfaces:**
- Consumes: nada (primeira task da fase).
- Produces: tabela `cipa_meeting_ata_drafts` (colunas: `id`, `meeting_id` UNIQUE, `tenant_id`, `company_unit_id`, `status`, `transcript`, `draft_pauta`, `draft_discussoes`, `draft_deliberacoes`, `error_message`, `created_at`, `updated_at`), usada por todas as tasks seguintes.

- [ ] **Step 1: Criar a migration**

Criar `backend/db/migrations/0027_cipa_meeting_ata_drafts.sql`:

```sql
-- Fase 13: ata por IA (upload de áudio → transcrição → rascunho). Tabela
-- satélite de cipa_meetings, mesmo padrão de cipa_meeting_participants —
-- um rascunho de IA ativo por reunião (meeting_id UNIQUE), substituído
-- inteiro a cada novo upload de áudio (ON CONFLICT DO UPDATE em vez de
-- múltiplas linhas por reunião).
CREATE TABLE cipa_meeting_ata_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL UNIQUE REFERENCES cipa_meetings(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('processando', 'concluido', 'falhou')),
  transcript TEXT,
  draft_pauta TEXT,
  draft_discussoes TEXT,
  draft_deliberacoes TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mesma política de cipa_meetings_isolation (0023_cipa_nucleo.sql) — esta
-- tabela tem tenant_id direto, igual cipa_meetings, então usa o mesmo
-- formato (diferente de cipa_meeting_participants, que não tem tenant_id
-- próprio e usa EXISTS contra cipa_meetings).
ALTER TABLE cipa_meeting_ata_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_meeting_ata_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY cipa_meeting_ata_drafts_isolation ON cipa_meeting_ata_drafts USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_meeting_ata_drafts.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_meeting_ata_drafts.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);
```

- [ ] **Step 2: Aplicar a migration e verificar**

Run: `docker compose exec backend npm run db:migrate` (o runner real do projeto, `backend/db/migrate.ts` — lê `backend/db/migrations/*.sql` em ordem, aplica só as que ainda não estão na tabela `_migrations`, cada uma dentro de uma transação própria).

Expected: saída incluindo `[apply] 0027_cipa_meeting_ata_drafts.sql` e `[ok] 0027_cipa_meeting_ata_drafts.sql`, sem erro. Confirmar com:
```sql
\d cipa_meeting_ata_drafts
SELECT polname, qual FROM pg_policies WHERE tablename = 'cipa_meeting_ata_drafts';
```
que a tabela e a política existem como esperado.

- [ ] **Step 3: Commit**

```bash
git add backend/db/migrations/0027_cipa_meeting_ata_drafts.sql
git commit -m "feat: migration da tabela cipa_meeting_ata_drafts (Fase 13)"
```

---

## Task 2: Backend — transcrição, extração, endpoints e processamento assíncrono

**Files:**
- Create: `backend/src/cipa/ata-ai/audio-transcription.interface.ts`
- Create: `backend/src/cipa/ata-ai/groq-transcription.service.ts`
- Create: `backend/src/cipa/ata-ai/ata-extractor.interface.ts`
- Create: `backend/src/cipa/ata-ai/ata-extraction-shared.ts`
- Create: `backend/src/cipa/ata-ai/openrouter-ata-extractor.service.ts`
- Create: `backend/src/cipa/ata-ai/ata-ai.service.ts`
- Modify: `backend/src/cipa/meetings.controller.ts`
- Modify: `backend/src/cipa/cipa.module.ts`
- Modify: `docker-compose.yml`
- Modify: `backend/.env.example`
- Modify: `nginx/conf.d/default.conf`
- Create: `backend/test/cipa-ata-ai-groq-transcription.e2e-spec.ts`
- Create: `backend/test/cipa-ata-ai-openrouter-extractor.e2e-spec.ts`
- Create: `backend/test/cipa-ata-ai.e2e-spec.ts`

**Interfaces:**
- Consumes: tabela `cipa_meeting_ata_drafts` (Task 1); `DatabaseService.withTenantContext` (`backend/src/common/database/database.service.ts`, já existe); `RateLimit`/`envInt` (já existem); `req.withTenantContext` (já existe, via `TenantContextInterceptor`).
- Produces: `AtaAiService.createDraft`/`getDraft`/`processDraft`, `AUDIO_TRANSCRIPTION_SERVICE`/`ATA_EXTRACTOR` tokens exportados de `CipaModule` — usados só dentro deste módulo nesta fase, mas exportados pro padrão ficar consistente com `AiCopilotModule`.

- [ ] **Step 1: Interface + serviço de transcrição (Groq)**

Criar `backend/src/cipa/ata-ai/audio-transcription.interface.ts`:

```ts
export interface AudioTranscriptionService {
  transcribe(audio: Buffer, mimetype: string, filename: string): Promise<string>;
}

export const AUDIO_TRANSCRIPTION_SERVICE = Symbol('AUDIO_TRANSCRIPTION_SERVICE');
```

Criar `backend/src/cipa/ata-ai/groq-transcription.service.ts`:

```ts
import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AudioTranscriptionService } from './audio-transcription.interface';

// Groq hospeda Whisper (large-v3-turbo) com API compatível com o formato
// OpenAI de /audio/transcriptions — inferência muito mais rápida que tempo
// real e historicamente a opção mais barata do mercado. Preço/modelo exato
// a confirmar contra a página atual do Groq antes de ativar em produção,
// mesmo processo que a Fase 8 seguiu com o OpenRouter (rodar exemplo real,
// medir custo real, documentar — ver Step 7 deste plano).
// GROQ_API_KEY fica vazia de propósito até o fundador decidir ativar,
// mesmo padrão do MINIMAX_API_KEY original da Fase 8.
@Injectable()
export class GroqTranscriptionService implements AudioTranscriptionService {
  private readonly logger = new Logger(GroqTranscriptionService.name);

  async transcribe(audio: Buffer, mimetype: string, filename: string): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Transcrição de áudio ainda não está disponível');
    }

    const model = process.env.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo';
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mimetype }), filename);
    form.append('model', model);
    form.append('language', 'pt');
    form.append('response_format', 'json');

    let response: Response;
    try {
      response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        // Áudios longos (até ~3h por enquanto) — Groq é rápido, mas dá
        // folga generosa; isso protege a função em segundo plano de travar
        // indefinidamente, não a requisição HTTP (que já respondeu antes
        // desta chamada rodar — ver AtaAiService.processDraft).
        signal: AbortSignal.timeout(300_000),
      });
    } catch (err) {
      this.logger.error('Falha de rede ao chamar o Groq', (err as Error).stack);
      throw new BadGatewayException('Não foi possível transcrever o áudio agora');
    }

    if (!response.ok) {
      this.logger.error(`Groq retornou status ${response.status}`);
      throw new BadGatewayException('Não foi possível transcrever o áudio agora');
    }

    let body: any;
    try {
      body = await response.json();
    } catch (err) {
      this.logger.error('Resposta do Groq não é JSON válido', (err as Error).stack);
      throw new BadGatewayException('Não foi possível transcrever o áudio agora');
    }

    if (typeof body?.text !== 'string') {
      this.logger.error('Resposta do Groq sem campo "text"');
      throw new BadGatewayException('Não foi possível transcrever o áudio agora');
    }

    return body.text;
  }
}
```

- [ ] **Step 2: Interface + serviço de extração da ata (OpenRouter)**

Criar `backend/src/cipa/ata-ai/ata-extractor.interface.ts`:

```ts
export interface AtaDraftFields {
  pauta: string;
  discussoes: string;
  deliberacoes: string;
}

export interface AtaExtractor {
  extract(transcript: string): Promise<AtaDraftFields>;
}

export const ATA_EXTRACTOR = Symbol('ATA_EXTRACTOR');
```

Criar `backend/src/cipa/ata-ai/ata-extraction-shared.ts`:

```ts
import { AtaDraftFields } from './ata-extractor.interface';

export const SYSTEM_PROMPT = `Você é um assistente que ajuda empresas a estruturar a ata de uma
reunião da CIPA (Comissão Interna de Prevenção de Acidentes) a partir da
transcrição em texto do áudio da reunião. Você organiza o que foi dito —
você NUNCA toma decisão técnica de segurança do trabalho nem avalia se
algo é seguro.

A ata tem 3 campos de texto:
- pauta: os assuntos planejados/anunciados para a reunião.
- discussoes: o que foi efetivamente discutido/relatado durante a reunião.
- deliberacoes: decisões, ações combinadas e encaminhamentos definidos.

Chame a ferramenta structure_ata_fields com os 3 campos preenchidos em
português, cada um um resumo claro e objetivo (não uma transcrição
literal) do que a transcrição contém para aquele campo. Se a transcrição
não tiver conteúdo claro pra um campo, devolva uma string vazia para ele
— nunca invente conteúdo que não está na transcrição.`;

export const TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'structure_ata_fields',
    description: 'Retorna os 3 campos estruturados da ata a partir da transcrição da reunião',
    parameters: {
      type: 'object',
      properties: {
        pauta: { type: 'string' },
        discussoes: { type: 'string' },
        deliberacoes: { type: 'string' },
      },
      required: ['pauta', 'discussoes', 'deliberacoes'],
    },
  },
};

export function buildChatCompletionBody(model: string, transcript: string) {
  return {
    model,
    // Resposta são 3 blocos de texto resumidos — 2048 dá folga suficiente
    // mesmo pra reuniões longas (a Fase 8 usou 1024 pra um checklist bem
    // mais curto), sem deixar o pedido tentar usar o teto de saída do
    // modelo por padrão (mesmo achado real da Fase 8: sem max_tokens
    // explícito, o pedido pode estourar saldo de conta).
    max_tokens: 2048,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: transcript },
    ],
    tools: [TOOL_SCHEMA],
    tool_choice: { type: 'function', function: { name: 'structure_ata_fields' } },
  };
}

export function parseChatCompletionToolCall(body: any): Record<string, unknown> | null {
  const toolCall = body?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) return null;
  try {
    return JSON.parse(toolCall.function.arguments);
  } catch {
    return null;
  }
}

// Garante que os 3 campos sempre existem como string, mesmo se a IA
// omitir um deles apesar do "required" do schema (alguns modelos não
// respeitam 100% do tempo) — proteção contra alucinação/omissão, mesmo
// espírito do filterValidSuggestions da Fase 8.
export function toAtaDraftFields(parsed: Record<string, unknown> | null): AtaDraftFields {
  return {
    pauta: typeof parsed?.pauta === 'string' ? parsed.pauta : '',
    discussoes: typeof parsed?.discussoes === 'string' ? parsed.discussoes : '',
    deliberacoes: typeof parsed?.deliberacoes === 'string' ? parsed.deliberacoes : '',
  };
}
```

Criar `backend/src/cipa/ata-ai/openrouter-ata-extractor.service.ts`:

```ts
import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AtaDraftFields, AtaExtractor } from './ata-extractor.interface';
import { buildChatCompletionBody, parseChatCompletionToolCall, toAtaDraftFields } from './ata-extraction-shared';

@Injectable()
export class OpenRouterAtaExtractorService implements AtaExtractor {
  private readonly logger = new Logger(OpenRouterAtaExtractorService.name);

  async extract(transcript: string): Promise<AtaDraftFields> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Geração de rascunho de ata ainda não está disponível');
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
          'X-Title': 'Montese SST - CIPA Ata IA',
        },
        body: JSON.stringify(buildChatCompletionBody(model, transcript)),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      this.logger.error('Falha de rede ao chamar o OpenRouter', (err as Error).stack);
      throw new BadGatewayException('Não foi possível gerar o rascunho da ata agora');
    }

    if (!response.ok) {
      this.logger.error(`OpenRouter retornou status ${response.status}`);
      throw new BadGatewayException('Não foi possível gerar o rascunho da ata agora');
    }

    let body: any;
    try {
      body = await response.json();
    } catch (err) {
      this.logger.error('Resposta do OpenRouter não é JSON válido', (err as Error).stack);
      throw new BadGatewayException('Não foi possível gerar o rascunho da ata agora');
    }

    const parsed = parseChatCompletionToolCall(body);
    if (!parsed) {
      this.logger.error('Resposta do OpenRouter sem tool_call válido');
      throw new BadGatewayException('Não foi possível gerar o rascunho da ata agora');
    }

    return toAtaDraftFields(parsed);
  }
}
```

- [ ] **Step 3: `AtaAiService` — orquestração (criação do rascunho + processamento em segundo plano)**

Criar `backend/src/cipa/ata-ai/ata-ai.service.ts`:

```ts
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database/database.service';
import { AUDIO_TRANSCRIPTION_SERVICE, AudioTranscriptionService } from './audio-transcription.interface';
import { ATA_EXTRACTOR, AtaExtractor } from './ata-extractor.interface';

export interface CipaMeetingAtaDraft {
  id: string;
  meeting_id: string;
  tenant_id: string;
  company_unit_id: string;
  status: 'processando' | 'concluido' | 'falhou';
  transcript: string | null;
  draft_pauta: string | null;
  draft_discussoes: string | null;
  draft_deliberacoes: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface AudioUpload {
  buffer: Buffer;
  mimetype: string;
  filename: string;
}

interface TenantContext {
  userId: string;
  tenantId: string;
  role: string;
}

@Injectable()
export class AtaAiService {
  private readonly logger = new Logger(AtaAiService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(AUDIO_TRANSCRIPTION_SERVICE) private readonly transcriber: AudioTranscriptionService,
    @Inject(ATA_EXTRACTOR) private readonly extractor: AtaExtractor,
  ) {}

  // Roda dentro da transação da requisição original (req.withTenantContext,
  // já vem de fora). Valida a reunião, tranca a linha (mesmo padrão de
  // MeetingsService.update/setParticipants) e cria/substitui o rascunho com
  // status 'processando'. O processamento de verdade roda depois, fora
  // desta transação — ver processDraft.
  async createDraft(client: PoolClient, meetingId: string): Promise<CipaMeetingAtaDraft> {
    const meetingResult = await client.query<{ status_ata: string; tenant_id: string; company_unit_id: string }>(
      'SELECT status_ata, tenant_id, company_unit_id FROM cipa_meetings WHERE id = $1 FOR UPDATE',
      [meetingId],
    );
    const meeting = meetingResult.rows[0];
    if (!meeting) throw new NotFoundException('Reunião não encontrada');
    if (meeting.status_ata === 'aprovada') {
      throw new ConflictException('Ata já aprovada — reabra antes de gerar um rascunho por áudio');
    }

    const existingResult = await client.query<{ status: string }>(
      'SELECT status FROM cipa_meeting_ata_drafts WHERE meeting_id = $1 FOR UPDATE',
      [meetingId],
    );
    if (existingResult.rows[0]?.status === 'processando') {
      throw new ConflictException('Já existe uma transcrição em andamento para esta reunião');
    }

    const result = await client.query<CipaMeetingAtaDraft>(
      `INSERT INTO cipa_meeting_ata_drafts (meeting_id, tenant_id, company_unit_id, status)
       VALUES ($1, $2, $3, 'processando')
       ON CONFLICT (meeting_id) DO UPDATE SET
         status = 'processando', transcript = NULL, draft_pauta = NULL,
         draft_discussoes = NULL, draft_deliberacoes = NULL, error_message = NULL,
         updated_at = now()
       RETURNING *`,
      [meetingId, meeting.tenant_id, meeting.company_unit_id],
    );
    return result.rows[0];
  }

  async getDraft(client: PoolClient, meetingId: string): Promise<CipaMeetingAtaDraft | null> {
    const result = await client.query<CipaMeetingAtaDraft>(
      'SELECT * FROM cipa_meeting_ata_drafts WHERE meeting_id = $1',
      [meetingId],
    );
    return result.rows[0] ?? null;
  }

  // Chamado SEM await pelo controller, depois que a resposta HTTP do
  // upload já foi enviada (ver MeetingsController.uploadAtaAudio). Abre
  // suas próprias transações curtas — uma por escrita — em vez de segurar
  // uma conexão do pool aberta durante as chamadas de IA, que podem levar
  // minutos num áudio longo (este backend tem só DB_POOL_MAX=10 conexões
  // — ver docker-compose.yml).
  async processDraft(ctx: TenantContext, meetingId: string, audio: AudioUpload): Promise<void> {
    try {
      const transcript = await this.transcriber.transcribe(audio.buffer, audio.mimetype, audio.filename);
      await this.db.withTenantContext(ctx, (client) =>
        client.query(
          `UPDATE cipa_meeting_ata_drafts SET transcript = $2, updated_at = now() WHERE meeting_id = $1`,
          [meetingId, transcript],
        ),
      );

      const draft = await this.extractor.extract(transcript);
      await this.db.withTenantContext(ctx, (client) =>
        client.query(
          `UPDATE cipa_meeting_ata_drafts
           SET status = 'concluido', draft_pauta = $2, draft_discussoes = $3, draft_deliberacoes = $4, updated_at = now()
           WHERE meeting_id = $1`,
          [meetingId, draft.pauta, draft.discussoes, draft.deliberacoes],
        ),
      );
    } catch (err) {
      this.logger.error(`Falha ao processar rascunho de ata da reunião ${meetingId}`, (err as Error).stack);
      const message = err instanceof Error ? err.message : 'Falha desconhecida ao processar o áudio';
      await this.db
        .withTenantContext(ctx, (client) =>
          client.query(
            `UPDATE cipa_meeting_ata_drafts SET status = 'falhou', error_message = $2, updated_at = now() WHERE meeting_id = $1`,
            [meetingId, message],
          ),
        )
        .catch((updateErr) =>
          this.logger.error(`Falha ao gravar status de erro do rascunho ${meetingId}`, (updateErr as Error).stack),
        );
    }
  }
}
```

- [ ] **Step 4: Endpoints em `MeetingsController` + wiring em `CipaModule`**

Modificar `backend/src/cipa/meetings.controller.ts` — adicionar aos imports existentes:

```ts
import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Put, Query, Req, UploadedFile, UseInterceptors, UsePipes, ValidationPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';
import { AtaAiService } from './ata-ai/ata-ai.service';
```

(A linha de `@nestjs/common` substitui a existente, acrescentando `NotFoundException`, `UploadedFile`, `UseInterceptors`.)

Adicionar ao constructor:

```ts
constructor(
  private readonly meetings: MeetingsService,
  private readonly documents: DocumentsService,
  private readonly ataAi: AtaAiService,
) {}
```

Adicionar antes do fechamento da classe (depois de `reopenAta`):

```ts
  private static readonly ALLOWED_AUDIO_MIME_TYPES = [
    'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a',
    'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave',
  ];

  @Roles('empresa')
  @RateLimit({
    limit: envInt('ATA_AUDIO_RATE_LIMIT_MAX', 10),
    windowSeconds: envInt('ATA_AUDIO_RATE_LIMIT_WINDOW_SECONDS', 86400),
    keyBy: 'ip',
  })
  @Post(':id/ata-audio')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
  async uploadAtaAudio(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    if (!MeetingsController.ALLOWED_AUDIO_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Formato de áudio não suportado. Envie mp3, m4a, ogg ou wav.');
    }

    const draft = await req.withTenantContext((client: any) => this.ataAi.createDraft(client, id));

    // Dispara o processamento em segundo plano (sem aguardar) — a resposta
    // HTTP volta na hora, o frontend acompanha via GET :id/ata-ai-draft
    // (polling). Contexto de tenant capturado como valores simples agora,
    // não reaproveita a conexão da transação de createDraft (já volta pro
    // pool assim que este método retornar).
    void this.ataAi.processDraft(
      { userId: req.user.id, tenantId: req.user.tenantId, role: req.user.role },
      id,
      { buffer: file.buffer, mimetype: file.mimetype, filename: file.originalname },
    );

    return draft;
  }

  @Get(':id/ata-ai-draft')
  async getAtaAiDraft(@Param('id') id: string, @Req() req: any) {
    const draft = await req.withTenantContext((client: any) => this.ataAi.getDraft(client, id));
    if (!draft) throw new NotFoundException('Nenhum rascunho de ata por áudio para esta reunião');
    return draft;
  }
```

Modificar `backend/src/cipa/cipa.module.ts` — substituir o arquivo inteiro:

```ts
import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { CommitteesController } from './committees.controller';
import { CommitteesService } from './committees.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { PendenciasController } from './pendencias.controller';
import { PendenciasService } from './pendencias.service';
import { AtaAiService } from './ata-ai/ata-ai.service';
import { AUDIO_TRANSCRIPTION_SERVICE } from './ata-ai/audio-transcription.interface';
import { GroqTranscriptionService } from './ata-ai/groq-transcription.service';
import { ATA_EXTRACTOR } from './ata-ai/ata-extractor.interface';
import { OpenRouterAtaExtractorService } from './ata-ai/openrouter-ata-extractor.service';

@Module({
  imports: [DocumentsModule],
  controllers: [CommitteesController, MeetingsController, MembersController, PendenciasController],
  providers: [
    CommitteesService,
    MeetingsService,
    MembersService,
    PendenciasService,
    AtaAiService,
    GroqTranscriptionService,
    { provide: AUDIO_TRANSCRIPTION_SERVICE, useClass: GroqTranscriptionService },
    OpenRouterAtaExtractorService,
    { provide: ATA_EXTRACTOR, useClass: OpenRouterAtaExtractorService },
  ],
})
export class CipaModule {}
```

(`DatabaseService` não precisa ser importado — `DatabaseModule` é `@Global()`, já disponível em qualquer serviço do projeto, confirmado em `backend/src/common/database/database.module.ts`.)

- [ ] **Step 5: Variáveis de ambiente + limite de upload do nginx**

Modificar `docker-compose.yml` — adicionar ao bloco `environment:` do serviço `backend`, junto das outras chaves de IA (`OPENROUTER_*`):

```yaml
      GROQ_API_KEY: ${GROQ_API_KEY}
      GROQ_TRANSCRIPTION_MODEL: ${GROQ_TRANSCRIPTION_MODEL:-whisper-large-v3-turbo}
      ATA_AUDIO_RATE_LIMIT_MAX: ${ATA_AUDIO_RATE_LIMIT_MAX:-10}
      ATA_AUDIO_RATE_LIMIT_WINDOW_SECONDS: ${ATA_AUDIO_RATE_LIMIT_WINDOW_SECONDS:-86400}
```

Modificar `backend/.env.example` — adicionar junto das outras chaves de IA:

```
GROQ_API_KEY=
GROQ_TRANSCRIPTION_MODEL=whisper-large-v3-turbo
ATA_AUDIO_RATE_LIMIT_MAX=10
ATA_AUDIO_RATE_LIMIT_WINDOW_SECONDS=86400
```

Modificar `nginx/conf.d/default.conf:27` — trocar:
```
    client_max_body_size 20m;
```
por:
```
    client_max_body_size 200m;
```
(Limite global do server block — o backend já aplica seu próprio limite mais apertado de 10MB pra upload de documentos via `FileInterceptor`, então isso só afeta a rota nova de áudio, que precisa de até 200MB per `uploadAtaAudio` acima.)

- [ ] **Step 6: Testes e2e**

Criar `backend/test/cipa-ata-ai-groq-transcription.e2e-spec.ts` (mesmo padrão de `ai-copilot-minimax-extractor.e2e-spec.ts` — resolve a classe concreta via DI, spia `global.fetch` diretamente, sem subir HTTP):

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { GroqTranscriptionService } from '../src/cipa/ata-ai/groq-transcription.service';

describe('GroqTranscriptionService (e2e via DI)', () => {
  let app: INestApplication;
  let transcriber: GroqTranscriptionService;
  let fetchSpy: jest.SpyInstance | undefined;
  const originalApiKey = process.env.GROQ_API_KEY;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    transcriber = moduleRef.get(GroqTranscriptionService);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
    if (originalApiKey === undefined) {
      delete process.env.GROQ_API_KEY;
    } else {
      process.env.GROQ_API_KEY = originalApiKey;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('sem GROQ_API_KEY configurada, rejeita antes de qualquer chamada de rede', async () => {
    delete process.env.GROQ_API_KEY;
    fetchSpy = jest.spyOn(global, 'fetch');

    await expect(transcriber.transcribe(Buffer.from('audio-fake'), 'audio/mpeg', 'reuniao.mp3')).rejects.toThrow(
      'Transcrição de áudio ainda não está disponível',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('transcreve com sucesso e envia multipart form com file/model/language', async () => {
    process.env.GROQ_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ text: 'Reunião discutiu uso de EPI.' }), { status: 200 }));

    const result = await transcriber.transcribe(Buffer.from('audio-fake'), 'audio/mpeg', 'reuniao.mp3');

    expect(result).toBe('Reunião discutiu uso de EPI.');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, requestInit] = fetchSpy.mock.calls[0];
    expect((requestInit as RequestInit).body).toBeInstanceOf(FormData);
    const sentForm = (requestInit as RequestInit).body as FormData;
    expect(sentForm.get('model')).toBe('whisper-large-v3-turbo');
    expect(sentForm.get('language')).toBe('pt');
    expect((requestInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer chave-de-teste-fake' });
  });

  it('propaga erro HTTP do Groq como 502', async () => {
    process.env.GROQ_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('erro interno', { status: 500 }));

    await expect(
      transcriber.transcribe(Buffer.from('audio-fake'), 'audio/mpeg', 'reuniao.mp3'),
    ).rejects.toThrow('Não foi possível transcrever o áudio agora');
  });

  it('propaga falha de rede como 502', async () => {
    process.env.GROQ_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      transcriber.transcribe(Buffer.from('audio-fake'), 'audio/mpeg', 'reuniao.mp3'),
    ).rejects.toThrow('Não foi possível transcrever o áudio agora');
  });
});
```

Criar `backend/test/cipa-ata-ai-openrouter-extractor.e2e-spec.ts` (mesmo padrão, pro extrator de ata):

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { OpenRouterAtaExtractorService } from '../src/cipa/ata-ai/openrouter-ata-extractor.service';

describe('OpenRouterAtaExtractorService (e2e via DI)', () => {
  let app: INestApplication;
  let extractor: OpenRouterAtaExtractorService;
  let fetchSpy: jest.SpyInstance | undefined;
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    extractor = moduleRef.get(OpenRouterAtaExtractorService);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
    if (originalApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('sem OPENROUTER_API_KEY configurada, rejeita antes de qualquer chamada de rede', async () => {
    delete process.env.OPENROUTER_API_KEY;
    fetchSpy = jest.spyOn(global, 'fetch');

    await expect(extractor.extract('transcrição qualquer')).rejects.toThrow(
      'Geração de rascunho de ata ainda não está disponível',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('extrai os 3 campos e preenche string vazia pro que a IA omitir', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    const openrouterBody = {
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: 'structure_ata_fields',
                  arguments: JSON.stringify({
                    pauta: 'Uso de EPI no setor de produção',
                    discussoes: 'Discutido reposição de luvas danificadas',
                    // deliberacoes omitida de propósito — deve virar ''
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
      .mockResolvedValue(new Response(JSON.stringify(openrouterBody), { status: 200 }));

    const result = await extractor.extract('Reunião sobre uso de EPI...');

    expect(result).toEqual({
      pauta: 'Uso de EPI no setor de produção',
      discussoes: 'Discutido reposição de luvas danificadas',
      deliberacoes: '',
    });
    const [, requestInit] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse((requestInit as RequestInit).body as string);
    expect(sentBody.max_tokens).toBe(2048);
    expect(sentBody.tools[0].function.name).toBe('structure_ata_fields');
  });

  it('propaga erro HTTP do OpenRouter como 502', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('erro interno', { status: 500 }));

    await expect(extractor.extract('transcrição qualquer')).rejects.toThrow(
      'Não foi possível gerar o rascunho da ata agora',
    );
  });
});
```

Criar `backend/test/cipa-ata-ai.e2e-spec.ts` (nível HTTP, overriding os 2 tokens com mocks — mesmo padrão de `inspections-ai-draft.e2e-spec.ts`):

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AUDIO_TRANSCRIPTION_SERVICE } from '../src/cipa/ata-ai/audio-transcription.interface';
import { ATA_EXTRACTOR } from '../src/cipa/ata-ai/ata-extractor.interface';
import { TestDb } from './db-test-helper';

describe('POST /cipa/meetings/:id/ata-audio, GET :id/ata-ai-draft (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  const fakeTranscriber = { transcribe: jest.fn() };
  const fakeExtractor = { extract: jest.fn() };

  let tenantId: string;
  let userId: string;
  let companyUnitId: string;
  let committeeId: string;
  let meetingId: string;
  let approvedMeetingId: string;
  let empresaToken: string;

  async function waitForDraftStatus(id: string, token: string, notStatus: string) {
    for (let i = 0; i < 40; i++) {
      const res = await request(app.getHttpServer())
        .get(`/cipa/meetings/${id}/ata-ai-draft`)
        .set('Authorization', `Bearer ${token}`);
      if (res.body?.status !== notStatus) return res.body;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Rascunho da reunião ${id} não saiu do status "${notStatus}" a tempo`);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUDIO_TRANSCRIPTION_SERVICE)
      .useValue(fakeTranscriber)
      .overrideProvider(ATA_EXTRACTOR)
      .useValue(fakeExtractor)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA Ata IA Teste');
    tenantId = tenant.tenantId;
    userId = tenant.userId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const committeeResult = await (db as any).client.query(
      `INSERT INTO cipa_committees (tenant_id, company_unit_id, ano, data_inicio, data_termino, responsavel_user_id)
       VALUES ($1, $2, 2026, '2026-01-01', '2026-12-31', $3) RETURNING id`,
      [tenantId, companyUnitId, userId],
    );
    committeeId = committeeResult.rows[0].id;

    const meetingResult = await (db as any).client.query(
      `INSERT INTO cipa_meetings (tenant_id, committee_id, company_unit_id, tipo, titulo, data)
       VALUES ($1, $2, $3, 'extraordinaria', 'Reunião Teste Ata IA', '2026-03-10') RETURNING id`,
      [tenantId, committeeId, companyUnitId],
    );
    meetingId = meetingResult.rows[0].id;

    const approvedMeetingResult = await (db as any).client.query(
      `INSERT INTO cipa_meetings (tenant_id, committee_id, company_unit_id, tipo, titulo, data, status_ata)
       VALUES ($1, $2, $3, 'extraordinaria', 'Reunião Já Aprovada Teste', '2026-03-11', 'aprovada') RETURNING id`,
      [tenantId, committeeId, companyUnitId],
    );
    approvedMeetingId = approvedMeetingResult.rows[0].id;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterEach(() => {
    fakeTranscriber.transcribe.mockReset();
    fakeExtractor.extract.mockReset();
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM cipa_committees WHERE id = $1', [committeeId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('faz upload, processa em segundo plano e conclui com os 3 campos', async () => {
    fakeTranscriber.transcribe.mockResolvedValue('Transcrição: discutido uso de EPI e reposição de luvas.');
    fakeExtractor.extract.mockResolvedValue({
      pauta: 'Uso de EPI',
      discussoes: 'Reposição de luvas danificadas',
      deliberacoes: 'Comprar luvas novas até sexta',
    });

    const uploadRes = await request(app.getHttpServer())
      .post(`/cipa/meetings/${meetingId}/ata-audio`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .attach('file', Buffer.from('conteudo-fake-de-audio'), { filename: 'reuniao.mp3', contentType: 'audio/mpeg' });

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.status).toBe('processando');

    const finalDraft = await waitForDraftStatus(meetingId, empresaToken, 'processando');
    expect(finalDraft.status).toBe('concluido');
    expect(finalDraft.transcript).toBe('Transcrição: discutido uso de EPI e reposição de luvas.');
    expect(finalDraft.draft_pauta).toBe('Uso de EPI');
    expect(finalDraft.draft_discussoes).toBe('Reposição de luvas danificadas');
    expect(finalDraft.draft_deliberacoes).toBe('Comprar luvas novas até sexta');
    expect(fakeTranscriber.transcribe).toHaveBeenCalledTimes(1);
    expect(fakeExtractor.extract).toHaveBeenCalledWith('Transcrição: discutido uso de EPI e reposição de luvas.');
  });

  it('rejeita formato de arquivo não suportado com 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/cipa/meetings/${meetingId}/ata-audio`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .attach('file', Buffer.from('nao-e-audio'), { filename: 'texto.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(fakeTranscriber.transcribe).not.toHaveBeenCalled();
  });

  it('rejeita upload numa reunião com ata já aprovada com 409', async () => {
    const res = await request(app.getHttpServer())
      .post(`/cipa/meetings/${approvedMeetingId}/ata-audio`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .attach('file', Buffer.from('audio-fake'), { filename: 'reuniao.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(409);
    expect(fakeTranscriber.transcribe).not.toHaveBeenCalled();
  });

  it('rejeita upload enquanto já existe um rascunho "processando" com 409', async () => {
    await (db as any).client.query(
      `INSERT INTO cipa_meeting_ata_drafts (meeting_id, tenant_id, company_unit_id, status)
       VALUES ($1, $2, $3, 'processando')`,
      [meetingId, tenantId, companyUnitId],
    );

    const res = await request(app.getHttpServer())
      .post(`/cipa/meetings/${meetingId}/ata-audio`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .attach('file', Buffer.from('audio-fake'), { filename: 'reuniao.mp3', contentType: 'audio/mpeg' });

    expect(res.status).toBe(409);
    expect(fakeTranscriber.transcribe).not.toHaveBeenCalled();

    // Limpa pra não vazar pro próximo teste (meetingId é reusado acima).
    await (db as any).client.query('DELETE FROM cipa_meeting_ata_drafts WHERE meeting_id = $1', [meetingId]);
  });

  it('falha na transcrição grava status "falhou" com mensagem, sem travar o rascunho em "processando"', async () => {
    fakeTranscriber.transcribe.mockRejectedValue(new Error('Não foi possível transcrever o áudio agora'));

    const uploadRes = await request(app.getHttpServer())
      .post(`/cipa/meetings/${meetingId}/ata-audio`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .attach('file', Buffer.from('audio-fake'), { filename: 'reuniao.mp3', contentType: 'audio/mpeg' });

    expect(uploadRes.status).toBe(201);

    const finalDraft = await waitForDraftStatus(meetingId, empresaToken, 'processando');
    expect(finalDraft.status).toBe('falhou');
    expect(finalDraft.error_message).toBe('Não foi possível transcrever o áudio agora');
    expect(fakeExtractor.extract).not.toHaveBeenCalled();
  });

  it('GET sem nenhum upload prévio devolve 404', async () => {
    const res = await request(app.getHttpServer())
      .get(`/cipa/meetings/${approvedMeetingId}/ata-ai-draft`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(404);
  });
});
```

Run: `cd backend && npm run test:e2e -- cipa-ata-ai` (ou o comando/wrapper Docker já usado no projeto pra rodar a suíte contra o Postgres real — ver o comando documentado em `docs/roadmap.md` seção "Checkpoint formal da Fase 1" se `npm run test:e2e` direto não conectar; **não** precisa de `GROQ_API_KEY`/`OPENROUTER_API_KEY` reais pra estes 3 arquivos — os 2 primeiros testam a classe concreta isolada via `jest.spyOn(global, 'fetch')`, sem chamada de rede de verdade; o terceiro usa mocks via `overrideProvider`).

Expected: todos os testes passam.

- [ ] **Step 7: Verificar manualmente — build + validação real do formato de resposta do Groq/OpenRouter**

Run: `docker compose build backend` — confirmar zero erros de TypeScript.

Se o fundador já tiver decidido testar com uma `GROQ_API_KEY` real neste ponto (opcional, fora do fluxo automatizado — mesma decisão que a Fase 8 tomou por fora do plano, "código pronto, chave vazia até o fundador decidir"): gravar um áudio curto de teste (ex.: 10-20 segundos, uma frase falada em português) e chamar `GroqTranscriptionService.transcribe` (ou o endpoint HTTP completo) com uma `GROQ_API_KEY` real, confirmar que o campo `text` da resposta bate com o que foi dito e que o formato de multipart/response realmente é o documentado (`{text: string}` pra `response_format: 'json'`) — a API do Groq pode ter mudado desde o conhecimento usado pra escrever este plano. Documentar o resultado (e o custo real, se possível) no relatório desta task, mesmo padrão da validação real que a Fase 8 fez com o OpenRouter. **Se não houver `GROQ_API_KEY` disponível neste momento**, documentar isso explicitamente como pendência de validação real antes de considerar a fase pronta pra produção — não é bloqueante pro merge do código (mesmo raciocínio do `MINIMAX_API_KEY` vazio na primeira volta da Fase 8), mas precisa ficar registrado, não silenciado.

- [ ] **Step 8: Commit**

```bash
git add backend/src/cipa/ata-ai backend/src/cipa/meetings.controller.ts backend/src/cipa/cipa.module.ts docker-compose.yml backend/.env.example nginx/conf.d/default.conf backend/test/cipa-ata-ai-groq-transcription.e2e-spec.ts backend/test/cipa-ata-ai-openrouter-extractor.e2e-spec.ts backend/test/cipa-ata-ai.e2e-spec.ts
git commit -m "feat: transcrição de áudio (Groq) + geração de rascunho de ata por IA (OpenRouter)"
```

---

## Task 3: Frontend — upload, acompanhamento e sugestões na tela de reunião

**Files:**
- Modify: `frontend/src/lib/cipa-types.ts`
- Modify: `frontend/src/app/empresa/cipa/reunioes/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/cipa/meetings/:id/ata-ai-draft`, `POST /api/cipa/meetings/:id/ata-audio` (Task 2).
- Produces: nada consumido por task seguinte (última task da fase).

- [ ] **Step 1: Tipo `CipaMeetingAtaDraft`**

Modificar `frontend/src/lib/cipa-types.ts` — adicionar depois da interface `CipaMeetingParticipant`:

```ts
export interface CipaMeetingAtaDraft {
  id: string;
  meeting_id: string;
  status: 'processando' | 'concluido' | 'falhou';
  transcript: string | null;
  draft_pauta: string | null;
  draft_discussoes: string | null;
  draft_deliberacoes: string | null;
  error_message: string | null;
}
```

- [ ] **Step 2: Seção "Gerar ata por áudio" na tela de reunião**

Modificar `frontend/src/app/empresa/cipa/reunioes/[id]/page.tsx`:

No import de `cipa-types`, acrescentar `CipaMeetingAtaDraft`:

```ts
import { CipaMeeting, CipaMeetingParticipant, CipaMeetingAtaDraft, CipaMember, formatDateBR } from '@/lib/cipa-types';
```

Acrescentar aos imports de React, `useRef` (pro polling):

```ts
import { useEffect, useRef, useState } from 'react';
```

Acrescentar aos estados do componente (junto dos outros `useState`):

```ts
  const [ataDraft, setAtaDraft] = useState<CipaMeetingAtaDraft | null>(null);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
```

No `load()`, depois de popular `participants` (antes de `setReady(true)`), acrescentar a busca do rascunho de IA existente (não bloqueia o carregamento se der 404 — significa que nunca houve upload):

```ts
    const draftRes = await fetch(`/api/cipa/meetings/${params.id}/ata-ai-draft`, { headers });
    if (draftRes.ok) {
      const draft: CipaMeetingAtaDraft = await draftRes.json();
      setAtaDraft(draft);
      if (draft.status === 'processando') startPolling();
    }
```

Depois da função `load` e antes de `useEffect(() => { load(); }, ...)`, acrescentar as funções de upload/polling (precisam ficar fora do corpo de `load` porque `startPolling` é referenciada de dois lugares — do `load()` acima, ao retomar um processamento em andamento, e de `uploadAudio` abaixo):

```ts
  function startPolling() {
    if (pollTimer.current) return;
    pollTimer.current = setInterval(async () => {
      const token = getToken();
      if (!token) return;
      const res = await fetch(`/api/cipa/meetings/${params.id}/ata-ai-draft`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const draft: CipaMeetingAtaDraft = await res.json();
      setAtaDraft(draft);
      if (draft.status !== 'processando' && pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    }, 4000);
  }

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  async function uploadAudio(file: File) {
    setAudioError(null);
    setUploadingAudio(true);
    const token = getToken();
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`/api/cipa/meetings/${params.id}/ata-audio`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        setAudioError('Não foi possível iniciar a transcrição. Confira o formato do arquivo.');
        return;
      }
      const draft: CipaMeetingAtaDraft = await res.json();
      setAtaDraft(draft);
      startPolling();
    } finally {
      setUploadingAudio(false);
    }
  }

  function applyDraftField(field: 'pauta' | 'discussoes' | 'deliberacoes', value: string) {
    if (field === 'pauta') setPauta(value);
    if (field === 'discussoes') setDiscussoes(value);
    if (field === 'deliberacoes') setDeliberacoes(value);
  }

  function discardDraftField(field: 'draft_pauta' | 'draft_discussoes' | 'draft_deliberacoes') {
    if (!ataDraft) return;
    setAtaDraft({ ...ataDraft, [field]: null });
  }
```

Na função `load` que já existe, `startPolling` é chamada antes de estar declarada no arquivo (hoisting de `function` declarations resolve isso normalmente, mas como `load` é uma `async function` declarada ANTES de `startPolling` no arquivo, e ambas são declarações `function` no mesmo escopo do módulo do componente, o hoisting do JavaScript já cobre isso — não precisa reordenar).

Na JSX, entre o fechamento do bloco do Checklist (`{(['Antes', 'Durante', 'Depois'] as const).map(...)}`) e o `<h2>Ata</h2>`, inserir a seção nova:

```tsx
      {(isRascunho || ataDraft?.transcript) && (
        <>
          <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-brand-700">
            🎙️ Gerar ata por áudio
          </h2>
          <div className="mt-3 rounded-lg border border-brand-100 p-4">
            {isRascunho && (
              <>
                {audioError && <p className="mb-2 text-sm text-red-600">{audioError}</p>}

                {(!ataDraft || ataDraft.status === 'falhou') && (
                  <div className="flex flex-col gap-2">
                    {ataDraft?.status === 'falhou' && (
                      <p className="text-sm text-red-600">
                        {ataDraft.error_message ?? 'Não foi possível gerar o rascunho.'} Tente enviar o áudio de novo.
                      </p>
                    )}
                    <label className="flex flex-col gap-1 text-sm text-brand-900">
                      Áudio da reunião (mp3, m4a, ogg ou wav)
                      <input
                        type="file"
                        accept="audio/*"
                        disabled={uploadingAudio}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadAudio(file);
                          e.target.value = '';
                        }}
                        className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
                      />
                    </label>
                  </div>
                )}

                {ataDraft?.status === 'processando' && (
                  <p className="text-sm text-brand-700">
                    Transcrevendo e gerando rascunho... isso pode levar alguns minutos. Pode continuar usando a página normalmente.
                  </p>
                )}

                {ataDraft?.status === 'concluido' && (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs font-semibold text-brand-500">
                      Sugestão gerada por IA — revise e confirme. Não substitui a avaliação do profissional habilitado.
                    </p>
                    {([
                      { field: 'draft_pauta' as const, applyField: 'pauta' as const, label: 'Pauta', value: ataDraft.draft_pauta },
                      { field: 'draft_discussoes' as const, applyField: 'discussoes' as const, label: 'Discussões', value: ataDraft.draft_discussoes },
                      { field: 'draft_deliberacoes' as const, applyField: 'deliberacoes' as const, label: 'Deliberações', value: ataDraft.draft_deliberacoes },
                    ]).map((card) =>
                      card.value === null ? null : (
                        <div key={card.field} className="rounded-md border border-brand-100 bg-brand-50 p-3">
                          <p className="text-xs font-semibold text-brand-700">{card.label} (sugestão)</p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-brand-900">{card.value || '(vazio)'}</p>
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => {
                                applyDraftField(card.applyField, card.value ?? '');
                                discardDraftField(card.field);
                              }}
                              className="rounded-[9px] bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                            >
                              Aplicar
                            </button>
                            <button
                              onClick={() => discardDraftField(card.field)}
                              className="rounded-[9px] border border-brand-100 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-white"
                            >
                              Descartar
                            </button>
                          </div>
                        </div>
                      ),
                    )}
                    <button
                      onClick={() => setAtaDraft(null)}
                      className="self-start text-xs font-semibold text-brand-700 underline"
                    >
                      Enviar outro áudio
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Fora do isRascunho acima de propósito: a transcrição continua
                consultável depois da ata aprovada — é justamente nesse ponto
                (alguém questionando se a ata reflete bem o que foi dito) que
                ela é mais útil, já que o áudio original não existe mais pra
                reouvir (spec §2: "áudio original é descartado após a
                transcrição"). Mesmo raciocínio do link de download do PDF,
                que também só faz sentido — e só aparece — depois de aprovada. */}
            {ataDraft?.transcript && (
              <div className={isRascunho ? 'mt-3' : undefined}>
                <button
                  onClick={() => setShowTranscript(!showTranscript)}
                  className="text-xs font-semibold text-brand-700 underline"
                >
                  {showTranscript ? 'Ocultar transcrição' : 'Ver transcrição'}
                </button>
                {showTranscript && (
                  <p className="mt-2 whitespace-pre-wrap rounded-md bg-brand-50 p-3 text-xs text-brand-700">
                    {ataDraft.transcript}
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}
```

Nota: os cards de sugestão desaparecem um a um conforme Aplicar/Descartar é clicado em cada campo (`discardDraftField` zera o `draft_*` correspondente no estado local — não faz nova chamada à API, já que o rascunho em si não precisa ser "consumido" no backend, só deixa de aparecer na tela). Isso é intencional e mais simples que uma chamada de API extra só pra marcar "visto". A seção inteira (título + card) só aparece se houver algo a mostrar: em rascunho, sempre (é onde o upload acontece); depois de aprovada, só se existir uma transcrição de uma geração anterior — uma reunião aprovada que nunca teve upload de áudio não ganha uma seção vazia.

- [ ] **Step 3: Verificar manualmente no navegador**

Seguir o mesmo método de toda a Fase 12b — `docker compose build frontend`, depois Playwright com sessão sintética via `localStorage` e `page.route()` mockando `/api/*`, contra a build de produção real. Cobrir:

1. Reunião em rascunho, sem rascunho de IA (`GET .../ata-ai-draft` mockado como 404): seção "🎙️ Gerar ata por áudio" mostra só o input de arquivo.
2. Selecionar um arquivo → `POST .../ata-audio` mockado devolvendo `{status: 'processando', ...}` → confirmar que a mensagem "Transcrevendo..." aparece e que `GET .../ata-ai-draft` é chamado repetidamente (mock a 2ª chamada em diante devolvendo `{status: 'concluido', draft_pauta: '...', draft_discussoes: '...', draft_deliberacoes: '...', transcript: '...'}`).
3. Ao concluir: os 3 cards de sugestão aparecem com o aviso fixo. Clicar "Aplicar" na pauta: confirmar que o campo real "Pauta" (textarea já existente) passa a mostrar o texto sugerido, e que o card da pauta some (os outros 2 continuam). Clicar "Descartar" nas discussões: card some, campo real de discussões continua vazio.
4. Confirmar a seção "Ver transcrição" abre/fecha e mostra o texto de `transcript`.
5. Mockar `GET .../ata-ai-draft` devolvendo `{status: 'falhou', error_message: 'Não foi possível transcrever o áudio agora'}` já no carregamento da página (simula reabrir a página depois de uma falha em sessão anterior): confirmar que a mensagem de erro aparece e o input de arquivo volta a ficar disponível pra tentar de novo.
6. Numa reunião **aprovada** (`status_ata: 'aprovada'`) sem nenhum rascunho de IA (`GET .../ata-ai-draft` mockado como 404): a seção "🎙️ Gerar ata por áudio" inteira não aparece (nada a mostrar).
7. Numa reunião **aprovada** com um rascunho de uma geração anterior (`GET .../ata-ai-draft` mockado devolvendo `{status: 'concluido', transcript: '...', ...}`): a seção aparece só com "Ver transcrição" — sem input de arquivo, sem cards de Aplicar/Descartar (esses continuam escondidos fora do rascunho).
8. Reabrir a página com `GET .../ata-ai-draft` já devolvendo `{status: 'processando'}` desde o primeiro carregamento (sem nenhum upload feito nesta sessão) — confirmar que o polling começa sozinho (item já coberto pela lógica de `load()`, mas vale confirmar em teste real que não travou nem exige um upload novo).

Rodar `docker compose build frontend` e confirmar zero erros de TypeScript/lint antes de considerar a task pronta.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/cipa-types.ts frontend/src/app/empresa/cipa/reunioes/\[id\]/page.tsx
git commit -m "feat: upload de áudio + rascunho de ata por IA na tela de reunião"
```

---

## Depois da última task

1. Rodar a suíte e2e completa do backend (`npm run test:e2e`) e confirmar que nada quebrou nas outras 71+ suítes já existentes.
2. Rodar `docker compose build backend && docker compose build frontend` (build completa, ambos) e confirmar zero erros.
3. Passada visual final ponta a ponta: reunião em rascunho → upload de um áudio curto real (se `GROQ_API_KEY` já estiver disponível nesse ponto) ou mockado → acompanhar até concluir → aplicar os 3 campos → salvar ata → aprovar → confirmar que o fluxo de aprovação/PDF da Fase 12a continua funcionando normalmente com os campos preenchidos por IA (não deveria haver nenhuma diferença — os campos reais são só texto, igual digitado à mão).
4. Seguir com `superpowers:finishing-a-development-branch` (branch é `main` direto, sem remote — só confirmar e reportar, mesmo padrão de toda fase anterior deste projeto).
5. Atualizar `docs/roadmap.md` fechando o status da Fase 13, mesmo formato das fases anteriores — registrar explicitamente se `GROQ_API_KEY` foi validada contra a API real ou se ficou pendente (mesma transparência que a Fase 8 usou pro `MINIMAX_API_KEY`).
6. Próximas frentes da CIPA, na ordem já acordada (`docs/specs/fase-12-central-cipa-nucleo.md` §1): eleição/votação digital → treinamentos/DDS/SIPAT → reconhecimento/gamificação → consulta de CA/documentos técnicos → card da CIPA no dashboard principal. Nenhuma tem spec escrita ainda — cada uma passa por brainstorming próprio antes de qualquer plano.
