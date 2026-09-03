# Fase 15 — CIPA: Capacitação (Treinamentos, DDS, SIPAT) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Três controles novos dentro da Central da CIPA — treinamentos obrigatórios de NR por funcionário (com validade/reciclagem), registro próprio de DDS pela empresa, e organização de SIPAT por edição anual com atividades — unidos numa navegação só ("🎓 Capacitação", 3 abas) mas independentes por baixo.

**Architecture:** Quatro tabelas novas (`cipa_trainings`, `cipa_dds_records`, `cipa_sipat_editions`, `cipa_sipat_activities`) seguindo os padrões RLS/trigger já estabelecidos no módulo CIPA. Três módulos de backend independentes (`TrainingsService`/Controller, `DdsService`/Controller, `SipatService`/Controller) plugados no `CipaModule` já existente. Certificado de treinamento reaproveita o `DocumentsService` já existente (categoria `treinamento`) em vez de reinventar upload — só um link de volta (`certificado_document_id`), mesmo padrão de `cipa_meetings.ata_document_id`. Pendência de treinamento vencido/vencendo é calculada na consulta de `GET /cipa/pendencias`, não uma linha gravável — sem scheduler novo.

**Tech Stack:** NestJS + Postgres (RLS) no backend, Next.js App Router + Tailwind no frontend, sem test runner de frontend (Playwright manual contra produção).

**Spec:** `docs/specs/fase-15-cipa-capacitacao.md`

## Global Constraints

- Sem login de colaborador, nesta fase nem em nenhuma futura de CIPA — quem sempre opera é o usuário `empresa`.
- Treinamentos cobre qualquer NR, qualquer funcionário do tenant — não é restrito a `cipa_members`.
- Catálogo de tipos de treinamento é fixo no código (constante, não tabela), com validade padrão sugerida por tipo, sempre editável.
- Certificado é opcional, anexado via `DocumentsService.upload` já existente (categoria `treinamento`) — `cipa_trainings` guarda só `certificado_document_id`, nunca lida com R2 diretamente. Download reaproveita `GET /documents/:id/download` já existente — sem endpoint dedicado novo.
- Reciclagem não é uma ação especial — novo registro pro mesmo funcionário+tipo. Histórico completo sempre visível; **o vencimento considerado pra pendência é sempre o do registro mais recente daquele tipo** (não cada registro histórico individualmente).
- Pendência de treinamento é calculada em `GET /cipa/pendencias`, mesclada com as pendências manuais já existentes — sem scheduler novo. Não é escopada por `company_unit_id` (treinamento não tem essa coluna — `employees` é tenant-wide). DDS e SIPAT não geram pendência automática.
- DDS registra só contagem numérica de participantes, sem lista nomeada. Sem vínculo obrigatório com inspeção do técnico.
- SIPAT: uma edição por `(company_unit_id, ano)` (índice único), com atividades planejadas/realizadas/canceladas. Sem "encerrar edição" — cada atividade tem seu próprio status.
- `cipa_trainings.employee_id` é `ON DELETE RESTRICT` (não `SET NULL`) — histórico de treinamento é registro de compliance NR, deve sobreviver ao desligamento do funcionário. Apagar um funcionário com histórico de treinamento precisa de tratamento explícito em `EmployeesService.remove`, mesmo padrão já usado pra `cipa_election_candidates` (Fase 14).
- Sem mapeamento automático cargo→treinamento, sem notificação por e-mail/WhatsApp, sem edição de registro de treinamento/DDS já criado (só apagar e recriar), sem reabertura de atividade de SIPAT de edição de ano anterior.
- Sem test runner no frontend (`frontend/package.json` confirmado sem jest/vitest/testing-library) — verificação de frontend é manual, Playwright com sessão sintética via `localStorage` + `page.route()` mockando `/api/*`, contra a build de produção real (`docker compose build frontend`), mesmo padrão de toda fase anterior de CIPA. Backend tem suíte e2e real (Postgres real, sem mock de banco).
- Rodar a suíte e2e via `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit"` (container efêmero — a imagem de produção do backend não tem devDependencies; `--forceExit` evita o container ficar pendurado). Requer um `docker-compose.override.yml` local, temporário, nunca commitado, montando `./backend:/app` + volume anônimo em `/app/node_modules` + `NODE_ENV: development` — deletar depois de usar.

---

## Task 1: Migration — quatro tabelas de Capacitação

**Files:**
- Create: `backend/db/migrations/0030_cipa_capacitacao.sql`

**Interfaces:**
- Consumes: `set_updated_at()` (função de trigger já existente, usada em toda migration do módulo CIPA); tabelas `tenants`, `company_units`, `employees`, `documents`, `tenant_technicians`/`technicians`, `tenant_partners`/`partners` (já existentes).
- Produces: tabelas `cipa_trainings`, `cipa_dds_records`, `cipa_sipat_editions`, `cipa_sipat_activities` — consumidas por Tasks 2, 3 e 4.

- [ ] **Step 1: Criar a migration**

Criar `backend/db/migrations/0030_cipa_capacitacao.sql`:

```sql
-- Fase 15: Central da CIPA — Capacitação (Treinamentos, DDS, SIPAT).
-- Três subsistemas independentes por baixo, unidos só pela navegação
-- do frontend. Ver docs/specs/fase-15-cipa-capacitacao.md.

CREATE TABLE cipa_trainings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- RESTRICT, não SET NULL nem CASCADE — histórico de treinamento é
  -- registro de compliance NR, deve sobreviver mesmo se o funcionário
  -- for desligado/apagado depois. Apagar um funcionário com histórico
  -- de treinamento passa a exigir tratamento explícito no service
  -- (Task 2, mesmo padrão de EmployeesService.remove/EpiService.remove
  -- já usado pra cipa_election_candidates/employee_epi_deliveries).
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'nr-05', 'nr-06', 'nr-10', 'nr-11', 'nr-12', 'nr-18', 'nr-20',
    'nr-33', 'nr-35', 'outro'
  )),
  -- Preenchido só quando tipo = 'outro'; NULL nos demais casos.
  tipo_outro TEXT,
  data_realizacao DATE NOT NULL,
  -- Sugerida automaticamente a partir da tabela de validade padrão
  -- por tipo (constante no backend, Task 2), sempre editável antes de
  -- salvar. Guardada como valor final, não recalculada depois.
  data_validade DATE NOT NULL,
  carga_horaria INT,
  -- Link pro documents criado via DocumentsService.upload (categoria
  -- 'treinamento'), NULL quando não há certificado anexado. Mesmo
  -- padrão de cipa_meetings.ata_document_id (0026): SET NULL, não
  -- CASCADE — apagar o documents (rota genérica DELETE /documents/:id,
  -- já existente) não deveria arrastar o registro de treinamento
  -- junto, só desvincular o certificado.
  certificado_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_tipo_outro CHECK (
    (tipo = 'outro' AND tipo_outro IS NOT NULL)
    OR (tipo != 'outro' AND tipo_outro IS NULL)
  )
);
CREATE TRIGGER trg_cipa_trainings_updated_at BEFORE UPDATE ON cipa_trainings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX cipa_trainings_employee_idx ON cipa_trainings (employee_id);
CREATE INDEX cipa_trainings_validade_idx ON cipa_trainings (data_validade);

ALTER TABLE cipa_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_trainings FORCE ROW LEVEL SECURITY;
-- Tenant_id direto, mesmo padrão de cipa_elections_isolation.
CREATE POLICY cipa_trainings_isolation ON cipa_trainings USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_trainings.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_trainings.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

CREATE TABLE cipa_dds_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  tema TEXT NOT NULL,
  numero_participantes INT,
  responsavel TEXT,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_cipa_dds_records_updated_at BEFORE UPDATE ON cipa_dds_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX cipa_dds_records_company_unit_idx ON cipa_dds_records (company_unit_id);

ALTER TABLE cipa_dds_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_dds_records FORCE ROW LEVEL SECURITY;
-- Mesma política de cipa_elections_isolation.
CREATE POLICY cipa_dds_records_isolation ON cipa_dds_records USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_dds_records.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_dds_records.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

CREATE TABLE cipa_sipat_editions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  ano INT NOT NULL,
  periodo_inicio DATE NOT NULL,
  periodo_fim DATE NOT NULL,
  tema TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_cipa_sipat_editions_updated_at BEFORE UPDATE ON cipa_sipat_editions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Não faz sentido duas edições de SIPAT no mesmo ano pro mesmo
-- estabelecimento.
CREATE UNIQUE INDEX cipa_sipat_editions_unit_year
  ON cipa_sipat_editions (company_unit_id, ano);

ALTER TABLE cipa_sipat_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_sipat_editions FORCE ROW LEVEL SECURITY;
-- Mesma política de cipa_elections_isolation.
CREATE POLICY cipa_sipat_editions_isolation ON cipa_sipat_editions USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_sipat_editions.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_sipat_editions.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

CREATE TABLE cipa_sipat_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES cipa_sipat_editions(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  titulo TEXT NOT NULL,
  responsavel TEXT,
  publico_alvo TEXT,
  status TEXT NOT NULL DEFAULT 'planejada' CHECK (status IN ('planejada', 'realizada', 'cancelada')),
  numero_participantes INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_cipa_sipat_activities_updated_at BEFORE UPDATE ON cipa_sipat_activities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX cipa_sipat_activities_edition_idx ON cipa_sipat_activities (edition_id);

ALTER TABLE cipa_sipat_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_sipat_activities FORCE ROW LEVEL SECURITY;
-- Mesmo padrão de cipa_election_candidates_isolation — sem tenant_id
-- próprio, isolamento via EXISTS contra cipa_sipat_editions (que já
-- tem sua própria RLS, então a composição escopa corretamente).
CREATE POLICY cipa_sipat_activities_isolation ON cipa_sipat_activities USING (
  EXISTS (SELECT 1 FROM cipa_sipat_editions e WHERE e.id = cipa_sipat_activities.edition_id)
);
```

- [ ] **Step 2: Aplicar a migration e verificar**

Run: `npm run db:migrate` (mesmo mecanismo já usado em toda fase anterior — contra o Postgres real do servidor).

Verificar no Postgres real (`\d cipa_trainings`, `\d cipa_dds_records`, `\d cipa_sipat_editions`, `\d cipa_sipat_activities`): as 4 tabelas existem, `cipa_trainings.employee_id` tem `ON DELETE RESTRICT`, `cipa_trainings.certificado_document_id` tem `ON DELETE SET NULL`, o índice único `cipa_sipat_editions_unit_year` existe, e as 4 políticas RLS existem (`\d+` ou consulta em `pg_policies`).

- [ ] **Step 3: Commit**

```bash
git add backend/db/migrations/0030_cipa_capacitacao.sql
git commit -m "feat: migration das tabelas de Capacitação da CIPA — treinamentos, DDS, SIPAT"
```

---

## Task 2: Backend — Treinamentos (+ merge de pendências + fix em EmployeesService)

**Files:**
- Create: `backend/src/cipa/trainings.service.ts`
- Create: `backend/src/cipa/dto/create-training.dto.ts`
- Create: `backend/src/cipa/trainings.controller.ts`
- Modify: `backend/src/cipa/cipa.module.ts`
- Modify: `backend/src/cipa/pendencias.service.ts`
- Modify: `backend/src/cipa/pendencias.controller.ts`
- Modify: `backend/src/employees/employees.service.ts`
- Create: `backend/test/cipa-trainings.e2e-spec.ts`
- Modify: `backend/test/cipa-pendencias.e2e-spec.ts`

**Interfaces:**
- Consumes: tabela `cipa_trainings` (Task 1); `mapPgError` (`backend/src/common/pg-error.util.ts`); `toDateString` (`backend/src/cipa/committees.service.ts`); `DocumentsService.upload` (`backend/src/documents/documents.service.ts`, já exportado por `DocumentsModule`, já importado em `CipaModule`) — assinatura `upload(client, { tenantId, category, title, file: {buffer, mimetype, originalname, size}, uploadedByUserId, uploadedByRole, companyUnitId? }): Promise<Document>`, `Document.id` é o que vira `certificado_document_id`.
- Produces: `TRAINING_TYPES`, `TrainingType`, `TRAINING_TYPE_LABEL`, `TRAINING_VALIDITY_MONTHS` (exportados de `trainings.service.ts`, reusados pelo frontend em Task 5 — os mesmos valores, não importados de fato, já que frontend/backend são pacotes separados, mas devem ficar idênticos); endpoints `POST /cipa/trainings` (multipart), `GET /cipa/trainings`, `DELETE /cipa/trainings/:id` — usados pelo frontend (Task 5); `GET /cipa/pendencias` passa a incluir itens com `origem: 'treinamento'`.

- [ ] **Step 1: `TrainingsService`**

Criar `backend/src/cipa/trainings.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { toDateString } from './committees.service';
import { DocumentsService } from '../documents/documents.service';

export const TRAINING_TYPES = [
  'nr-05', 'nr-06', 'nr-10', 'nr-11', 'nr-12', 'nr-18', 'nr-20', 'nr-33', 'nr-35', 'outro',
] as const;
export type TrainingType = (typeof TRAINING_TYPES)[number];

export const TRAINING_TYPE_LABEL: Record<TrainingType, string> = {
  'nr-05': 'NR-05 — Membro da CIPA',
  'nr-06': 'NR-06 — Uso de EPI',
  'nr-10': 'NR-10 — Segurança em eletricidade',
  'nr-11': 'NR-11 — Transporte/movimentação de materiais',
  'nr-12': 'NR-12 — Segurança em máquinas e equipamentos',
  'nr-18': 'NR-18 — Condições de segurança na construção civil',
  'nr-20': 'NR-20 — Inflamáveis e combustíveis',
  'nr-33': 'NR-33 — Espaço confinado',
  'nr-35': 'NR-35 — Trabalho em altura',
  outro: 'Outro',
};

// Validade padrão sugerida, em meses — sempre editável pela empresa
// antes de salvar (decisão da spec, seção 2). 'outro' não tem
// sugestão (o próprio TRAINING_TYPE_LABEL cobre a exibição, mas não
// existe aqui porque não há um número universal pra "outro").
export const TRAINING_VALIDITY_MONTHS: Record<Exclude<TrainingType, 'outro'>, number> = {
  'nr-05': 24,
  'nr-06': 12,
  'nr-10': 24,
  'nr-11': 12,
  'nr-12': 24,
  'nr-18': 12,
  'nr-20': 12,
  'nr-33': 12,
  'nr-35': 24,
};

const VENCENDO_WINDOW_DAYS = 60;

export interface CipaTraining {
  id: string;
  tenant_id: string;
  employee_id: string;
  tipo: TrainingType;
  tipo_outro: string | null;
  data_realizacao: string;
  data_validade: string;
  carga_horaria: number | null;
  certificado_document_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CipaTrainingWithStatus extends CipaTraining {
  employee_full_name: string;
  status: 'valido' | 'vencendo' | 'vencido';
}

interface UploadFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

function normalizeTraining(row: CipaTraining): CipaTraining {
  return {
    ...row,
    data_realizacao: toDateString(row.data_realizacao) as string,
    data_validade: toDateString(row.data_validade) as string,
  };
}

// Mesmo cálculo usado tanto na listagem quanto no merge de pendências
// (pendencias.service.ts) — cada um decide separadamente SE aplica o
// filtro de "só o registro mais recente por funcionário+tipo" (a
// listagem mostra todo o histórico, o merge de pendências não).
export function computeTrainingStatus(dataValidade: string, today: Date = new Date()): 'valido' | 'vencendo' | 'vencido' {
  const todayMidnight = new Date(today);
  todayMidnight.setHours(0, 0, 0, 0);
  const validade = new Date(`${dataValidade}T00:00:00`);
  const diffDays = Math.floor((validade.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'vencido';
  if (diffDays <= VENCENDO_WINDOW_DAYS) return 'vencendo';
  return 'valido';
}

@Injectable()
export class TrainingsService {
  constructor(private readonly documents: DocumentsService) {}

  async create(
    client: PoolClient,
    tenantId: string,
    userId: string,
    data: {
      employeeId: string;
      tipo: TrainingType;
      tipoOutro?: string;
      dataRealizacao: string;
      dataValidade: string;
      cargaHoraria?: number;
      file?: UploadFile;
    },
  ): Promise<CipaTraining> {
    // Achado da revisão final da Fase 14 (ElectionsService.addCandidate):
    // employee_id é client-supplied e o FK sozinho não impede um id de
    // outro tenant (checagem de FK roda com RLS bypassada por design do
    // Postgres). Mesma checagem, mesmo motivo.
    const empCheck = await client.query<{ full_name: string }>(
      'SELECT full_name FROM employees WHERE id = $1 AND tenant_id = $2',
      [data.employeeId, tenantId],
    );
    const employee = empCheck.rows[0];
    if (!employee) {
      throw new BadRequestException('Funcionário informado não pertence a este tenant');
    }

    let certificadoDocumentId: string | null = null;
    if (data.file) {
      const document = await this.documents.upload(client, {
        tenantId,
        category: 'treinamento',
        title: `Certificado — ${TRAINING_TYPE_LABEL[data.tipo]} — ${employee.full_name}`,
        file: data.file,
        uploadedByUserId: userId,
        uploadedByRole: 'empresa',
      });
      certificadoDocumentId = document.id;
    }

    try {
      const result = await client.query<CipaTraining>(
        `INSERT INTO cipa_trainings (tenant_id, employee_id, tipo, tipo_outro, data_realizacao, data_validade, carga_horaria, certificado_document_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          tenantId,
          data.employeeId,
          data.tipo,
          data.tipoOutro ?? null,
          data.dataRealizacao,
          data.dataValidade,
          data.cargaHoraria ?? null,
          certificadoDocumentId,
        ],
      );
      return normalizeTraining(result.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(
    client: PoolClient,
    filters: { employeeId?: string; tipo?: string; status?: string },
  ): Promise<CipaTrainingWithStatus[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (filters.employeeId) {
      conditions.push(`t.employee_id = $${i++}`);
      values.push(filters.employeeId);
    }
    if (filters.tipo) {
      conditions.push(`t.tipo = $${i++}`);
      values.push(filters.tipo);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await client.query<CipaTraining & { employee_full_name: string }>(
      `SELECT t.*, e.full_name AS employee_full_name
       FROM cipa_trainings t
       JOIN employees e ON e.id = t.employee_id
       ${where}
       ORDER BY t.data_validade`,
      values,
    );

    // Status é por-registro, não "só o mais recente" — a listagem
    // mostra o histórico completo, e um certificado antigo mostrando
    // "vencido" é só um fato histórico verdadeiro, não uma ação
    // pendente (essa distinção é exclusiva do merge de pendências, ver
    // pendencias.service.ts).
    const withStatus: CipaTrainingWithStatus[] = result.rows.map((row) => {
      const normalized = normalizeTraining(row);
      return {
        ...normalized,
        employee_full_name: row.employee_full_name,
        status: computeTrainingStatus(normalized.data_validade),
      };
    });

    if (filters.status) {
      return withStatus.filter((t) => t.status === filters.status);
    }
    return withStatus;
  }

  async remove(client: PoolClient, id: string): Promise<void> {
    const result = await client.query('DELETE FROM cipa_trainings WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundException('Registro de treinamento não encontrado');
  }
}
```

- [ ] **Step 2: DTO**

Criar `backend/src/cipa/dto/create-training.dto.ts` (importa `TRAINING_TYPES` do `trainings.service.ts` criado no Step 1):

```ts
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { TRAINING_TYPES } from '../trainings.service';

export class CreateTrainingDto {
  @IsUUID()
  employee_id: string;

  @IsIn(TRAINING_TYPES)
  tipo: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tipo_outro?: string;

  @IsISO8601()
  data_realizacao: string;

  @IsISO8601()
  data_validade: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  carga_horaria?: number;
}
```

- [ ] **Step 3: `TrainingsController`**

Criar `backend/src/cipa/trainings.controller.ts`:

```ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/decorators/roles.decorator';
import { TrainingsService, TrainingType } from './trainings.service';
import { CreateTrainingDto } from './dto/create-training.dto';

@Controller('cipa/trainings')
export class TrainingsController {
  constructor(private readonly trainings: TrainingsService) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  @UseInterceptors(FileInterceptor('certificado', { limits: { fileSize: 10 * 1024 * 1024 } }))
  create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateTrainingDto,
    @Req() req: any,
  ) {
    // Mesma checagem manual de "exatamente um / exatamente nenhum"
    // já usada em MeetingsController.setParticipants e
    // ElectionsController.addCandidate, adaptada pro par
    // tipo='outro'/tipo_outro (aqui não é "um dos dois", é "tipo_outro
    // só existe quando tipo é 'outro'").
    if (dto.tipo === 'outro' && !dto.tipo_outro) {
      throw new BadRequestException('tipo_outro é obrigatório quando tipo = "outro"');
    }
    if (dto.tipo !== 'outro' && dto.tipo_outro) {
      throw new BadRequestException('tipo_outro só pode ser enviado quando tipo = "outro"');
    }
    return req.withTenantContext((client: any) =>
      this.trainings.create(client, req.user.tenantId, req.user.id, {
        employeeId: dto.employee_id,
        tipo: dto.tipo as TrainingType,
        tipoOutro: dto.tipo_outro,
        dataRealizacao: dto.data_realizacao,
        dataValidade: dto.data_validade,
        cargaHoraria: dto.carga_horaria,
        file: file
          ? { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname, size: file.size }
          : undefined,
      }),
    );
  }

  @Get()
  findAll(
    @Query('employee_id') employeeId: string | undefined,
    @Query('tipo') tipo: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) => this.trainings.findAll(client, { employeeId, tipo, status }));
  }

  @Roles('empresa')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.trainings.remove(client, id));
  }
}
```

- [ ] **Step 4: Wiring em `CipaModule`**

Modificar `backend/src/cipa/cipa.module.ts` — adicionar os imports de `TrainingsController`/`TrainingsService` e incluí-los nos arrays `controllers`/`providers` já existentes (não tocar em mais nada — `DocumentsModule` já está importado, `TrainingsService` só precisa entrar em `providers` pra sua injeção de `DocumentsService` funcionar):

```ts
import { TrainingsController } from './trainings.controller';
import { TrainingsService } from './trainings.service';
```

```ts
  controllers: [CommitteesController, MeetingsController, MembersController, PendenciasController, ElectionsController, TrainingsController],
  providers: [
    CommitteesService,
    MeetingsService,
    MembersService,
    PendenciasService,
    ElectionsService,
    TrainingsService,
    AtaAiService,
    GroqTranscriptionService,
    { provide: AUDIO_TRANSCRIPTION_SERVICE, useClass: GroqTranscriptionService },
    OpenRouterAtaExtractorService,
    { provide: ATA_EXTRACTOR, useClass: OpenRouterAtaExtractorService },
  ],
```

- [ ] **Step 5: Merge de pendências computadas em `PendenciasService`**

Modificar `backend/src/cipa/pendencias.service.ts`:

Adicionar `origem?: 'treinamento';` no final da interface `CipaPendencia`:

```ts
export interface CipaPendencia {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  meeting_id: string | null;
  descricao: string;
  responsavel_user_id: string | null;
  prazo: string | null;
  prioridade: 'alta' | 'media' | 'baixa';
  status: 'aberta' | 'andamento' | 'concluida' | 'atrasada';
  created_at: string;
  updated_at: string;
  origem?: 'treinamento';
}
```

Substituir o método `findAll` inteiro por esta versão (mesma lógica de antes pras pendências manuais, com o merge adicionado no fim) e adicionar o novo método privado `computeTrainingPendencias` logo depois dele:

```ts
  async findAll(client: PoolClient, companyUnitId?: string): Promise<CipaPendencia[]> {
    const manualResult = companyUnitId
      ? await client.query<CipaPendencia>(
          'SELECT * FROM cipa_pendencias WHERE company_unit_id = $1 ORDER BY prazo NULLS LAST, created_at',
          [companyUnitId],
        )
      : await client.query<CipaPendencia>('SELECT * FROM cipa_pendencias ORDER BY prazo NULLS LAST, created_at');

    const computed = await this.computeTrainingPendencias(client);
    return [...manualResult.rows.map(normalizePendencia), ...computed];
  }

  // Fase 15: treinamento vencido/vencendo (janela de 60 dias, mesma de
  // TrainingsService) vira pendência calculada na consulta — sem
  // scheduler novo (decisão da spec). Não filtra por company_unit_id
  // porque cipa_trainings não tem essa coluna (employees é
  // tenant-wide, decisão já registrada na spec) — aparece
  // independente do estabelecimento selecionado. DISTINCT ON pega só
  // o registro MAIS RECENTE por funcionário+tipo (decisão da spec:
  // "o vencimento considerado é sempre o do registro mais recente
  // daquele tipo" — sem isso, um certificado antigo já renovado
  // continuaria gerando pendência pra sempre).
  private async computeTrainingPendencias(client: PoolClient): Promise<CipaPendencia[]> {
    const result = await client.query<{
      id: string;
      tipo: string;
      tipo_outro: string | null;
      data_validade: string | Date;
      employee_full_name: string;
    }>(
      `SELECT DISTINCT ON (t.employee_id, t.tipo) t.id, t.tipo, t.tipo_outro, t.data_validade, e.full_name AS employee_full_name
       FROM cipa_trainings t
       JOIN employees e ON e.id = t.employee_id
       ORDER BY t.employee_id, t.tipo, t.data_realizacao DESC, t.created_at DESC`,
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nowIso = new Date().toISOString();

    const items: CipaPendencia[] = [];
    for (const row of result.rows) {
      const dataValidade = toDateString(row.data_validade) as string;
      const validade = new Date(`${dataValidade}T00:00:00`);
      const diffDays = Math.floor((validade.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 60) continue; // válido, fora da janela — não é pendência

      const tipoLabel = row.tipo === 'outro' ? row.tipo_outro : row.tipo.toUpperCase();
      const descricao = diffDays < 0
        ? `${tipoLabel} de ${row.employee_full_name} venceu há ${Math.abs(diffDays)} dia(s)`
        : `${tipoLabel} de ${row.employee_full_name} vence em ${diffDays} dia(s)`;

      items.push({
        id: `treinamento:${row.id}`,
        tenant_id: '',
        company_unit_id: '',
        meeting_id: null,
        descricao,
        responsavel_user_id: null,
        prazo: dataValidade,
        prioridade: diffDays < 0 ? 'alta' : 'media',
        status: 'aberta',
        created_at: nowIso,
        updated_at: nowIso,
        origem: 'treinamento',
      });
    }
    return items;
  }
```

Modificar `backend/src/cipa/pendencias.controller.ts` — no método `update`, adicionar a checagem de guarda ANTES de chamar `this.pendencias.update` (uma pendência computada não é uma linha real, `PATCH` nela não faz sentido e sem essa checagem estouraria um erro de sintaxe de UUID não tratado):

```ts
  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePendenciaDto, @Req() req: any) {
    if (id.startsWith('treinamento:')) {
      throw new BadRequestException(
        'Pendência de treinamento é calculada automaticamente — resolva registrando um novo treinamento pro funcionário',
      );
    }
    return req.withTenantContext((client: any) => this.pendencias.update(client, id, dto as Record<string, unknown>));
  }
```

(Adicionar `BadRequestException` ao import de `@nestjs/common` no topo do arquivo, junto dos que já estão lá.)

- [ ] **Step 6: Fix em `EmployeesService.remove`**

Modificar `backend/src/employees/employees.service.ts`, método `remove` (por volta da linha 148) — trocar o `if (pgErr.code === '23503')` único por uma checagem que distingue qual FK disparou o erro, usando `pgErr.constraint` (campo que o driver `pg` já expõe, além de `code`):

```ts
  async remove(client: PoolClient, id: string): Promise<void> {
    try {
      const result = await client.query('DELETE FROM employees WHERE id = $1', [id]);
      if (result.rowCount === 0) throw new NotFoundException('Funcionário não encontrado');
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === '23503') {
        // Fase 15: cipa_trainings.employee_id também é RESTRICT agora
        // (histórico de treinamento é compliance NR, não pode ser
        // apagado junto com o funcionário). O nome da constraint abaixo
        // é o gerado automaticamente pelo Postgres pra uma FK sem nome
        // explícito (<tabela>_<coluna>_fkey) — confirmado contra o
        // Postgres real depois de aplicar a migration 0030 (Step 2 do
        // Task 1), não é um palpite.
        if (pgErr.constraint === 'cipa_trainings_employee_id_fkey') {
          throw new ConflictException('Não é possível apagar um funcionário que tem histórico de treinamento registrado');
        }
        throw new ConflictException('Não é possível apagar um funcionário que já foi candidato em uma eleição da CIPA');
      }
      mapPgError(err);
    }
  }
```

Antes de escrever esse código: confirme o nome real da constraint gerada pelo Postgres pra `cipa_trainings.employee_id` (`\d cipa_trainings` ou consulta em `information_schema.table_constraints`, mesmo mecanismo já usado na Fase 14 pra `cipa_election_candidates`). Se o nome real divergir de `cipa_trainings_employee_id_fkey`, use o nome real.

- [ ] **Step 7: Testes e2e — `cipa-trainings.e2e-spec.ts`**

Criar `backend/test/cipa-trainings.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CIPA trainings (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let employeeId: string;
  let empresaToken: string;
  let outroTenantEmployeeId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA Treinamentos Teste');
    tenantId = tenant.tenantId;
    employeeId = tenant.employeeId;

    const outroTenant = await db.createTenantWithUser('Empresa CIPA Treinamentos Outro Tenant');
    outroTenantEmployeeId = outroTenant.employeeId;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await app.close();
  });

  it('cria treinamento sem certificado, calcula status válido, rejeita employee_id de outro tenant', async () => {
    const futuro = new Date();
    futuro.setFullYear(futuro.getFullYear() + 1);
    const dataValidade = futuro.toISOString().slice(0, 10);

    const res = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', employeeId)
      .field('tipo', 'nr-35')
      .field('data_realizacao', '2026-01-10')
      .field('data_validade', dataValidade)
      .field('carga_horaria', '8');

    expect(res.status).toBe(201);
    expect(res.body.certificado_document_id).toBeNull();

    const list = await request(app.getHttpServer())
      .get('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`);
    const created = list.body.find((t: any) => t.id === res.body.id);
    expect(created.status).toBe('valido');
    expect(created.employee_full_name).toBeTruthy();

    const cruzado = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', outroTenantEmployeeId)
      .field('tipo', 'nr-06')
      .field('data_realizacao', '2026-01-10')
      .field('data_validade', dataValidade);
    expect(cruzado.status).toBe(400);
  });

  it('rejeita tipo="outro" sem tipo_outro e tipo!="outro" com tipo_outro', async () => {
    const semTipoOutro = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', employeeId)
      .field('tipo', 'outro')
      .field('data_realizacao', '2026-01-10')
      .field('data_validade', '2027-01-10');
    expect(semTipoOutro.status).toBe(400);

    const tipoOutroIndevido = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', employeeId)
      .field('tipo', 'nr-06')
      .field('tipo_outro', 'Não devia vir')
      .field('data_realizacao', '2026-01-10')
      .field('data_validade', '2027-01-10');
    expect(tipoOutroIndevido.status).toBe(400);
  });

  it('cria com certificado anexado e o download funciona', async () => {
    const res = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', employeeId)
      .field('tipo', 'nr-10')
      .field('data_realizacao', '2026-01-10')
      .field('data_validade', '2028-01-10')
      .attach('certificado', Buffer.from('%PDF-1.4 fake'), { filename: 'cert.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.certificado_document_id).toBeTruthy();

    const download = await request(app.getHttpServer())
      .get(`/documents/${res.body.certificado_document_id}/download`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(download.status).toBe(200);
    expect(download.body.url).toBeTruthy();
  });

  it('filtra por status vencido/vencendo/valido e apaga um registro', async () => {
    const vencido = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', employeeId)
      .field('tipo', 'nr-33')
      .field('data_realizacao', '2020-01-10')
      .field('data_validade', '2021-01-10');
    expect(vencido.status).toBe(201);

    const listaVencidos = await request(app.getHttpServer())
      .get('/cipa/trainings?status=vencido')
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(listaVencidos.body.some((t: any) => t.id === vencido.body.id)).toBe(true);
    expect(listaVencidos.body.every((t: any) => t.status === 'vencido')).toBe(true);

    const del = await request(app.getHttpServer())
      .delete(`/cipa/trainings/${vencido.body.id}`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(del.status).toBe(200);

    const listaDepois = await request(app.getHttpServer())
      .get('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(listaDepois.body.some((t: any) => t.id === vencido.body.id)).toBe(false);
  });

  it('rejeita apagar funcionário com histórico de treinamento (409), permite depois de apagar o treinamento', async () => {
    const training = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', employeeId)
      .field('tipo', 'nr-18')
      .field('data_realizacao', '2026-01-10')
      .field('data_validade', '2027-01-10');
    expect(training.status).toBe(201);

    const delEmployee = await request(app.getHttpServer())
      .delete(`/employees/${employeeId}`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(delEmployee.status).toBe(409);
    expect(delEmployee.body.message).toContain('histórico de treinamento');

    await request(app.getHttpServer())
      .delete(`/cipa/trainings/${training.body.id}`)
      .set('Authorization', `Bearer ${empresaToken}`);

    const delEmployeeDepois = await request(app.getHttpServer())
      .delete(`/employees/${employeeId}`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(delEmployeeDepois.status).toBe(200);
  });
});
```

- [ ] **Step 8: Teste e2e do merge de pendências**

Modificar `backend/test/cipa-pendencias.e2e-spec.ts` — adicionar um novo `it()` ao final do `describe` já existente (reaproveitando `tenantId`/`companyUnitId`/`empresaToken` já criados no `beforeAll` do arquivo):

```ts
  it('mescla pendência computada de treinamento vencido, some quando renovado (Fase 15)', async () => {
    const employeeResult = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status)
       VALUES ($1, 'Funcionário Treinamento Pendência', '99988877766', 'ativo') RETURNING id`,
      [tenantId],
    );
    const trainingEmployeeId = employeeResult.rows[0].id;

    const vencido = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', trainingEmployeeId)
      .field('tipo', 'nr-35')
      .field('data_realizacao', '2020-01-10')
      .field('data_validade', '2021-01-10');
    expect(vencido.status).toBe(201);

    const semFiltro = await request(app.getHttpServer())
      .get('/cipa/pendencias')
      .set('Authorization', `Bearer ${empresaToken}`);
    const computada = semFiltro.body.find((p: any) => p.origem === 'treinamento' && p.id === `treinamento:${vencido.body.id}`);
    expect(computada).toBeTruthy();
    expect(computada.prioridade).toBe('alta');
    expect(computada.descricao).toContain('Funcionário Treinamento Pendência');

    // Renova o mesmo tipo pro mesmo funcionário com validade futura —
    // a pendência do registro vencido não deve mais aparecer (só o
    // mais recente conta, decisão da spec).
    const renovado = await request(app.getHttpServer())
      .post('/cipa/trainings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .field('employee_id', trainingEmployeeId)
      .field('tipo', 'nr-35')
      .field('data_realizacao', '2026-06-01')
      .field('data_validade', '2028-06-01');
    expect(renovado.status).toBe(201);

    const depoisDaRenovacao = await request(app.getHttpServer())
      .get('/cipa/pendencias')
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(depoisDaRenovacao.body.some((p: any) => p.id === `treinamento:${vencido.body.id}`)).toBe(false);
    expect(depoisDaRenovacao.body.some((p: any) => p.id === `treinamento:${renovado.body.id}`)).toBe(false);
  });

  it('rejeita PATCH numa pendência computada de treinamento (Fase 15)', async () => {
    const res = await request(app.getHttpServer())
      .patch('/cipa/pendencias/treinamento:00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ status: 'concluida' });
    expect(res.status).toBe(400);
  });
```

- [ ] **Step 9: Verificar manualmente — build + suíte completa**

Run: `docker compose build backend` — confirmar zero erros de TypeScript.

Rodar a suíte completa uma vez (ver Global Constraints pro comando exato) e confirmar que nada mais quebrou — nenhuma rota tocada nesta task tem rate limit dedicado.

- [ ] **Step 10: Commit**

```bash
git add backend/src/cipa/dto/create-training.dto.ts backend/src/cipa/trainings.service.ts backend/src/cipa/trainings.controller.ts backend/src/cipa/cipa.module.ts backend/src/cipa/pendencias.service.ts backend/src/cipa/pendencias.controller.ts backend/src/employees/employees.service.ts backend/test/cipa-trainings.e2e-spec.ts backend/test/cipa-pendencias.e2e-spec.ts
git commit -m "feat: treinamentos da CIPA — validade, certificado, pendência automática"
```

---

## Task 3: Backend — DDS

**Files:**
- Create: `backend/src/cipa/dto/create-dds-record.dto.ts`
- Create: `backend/src/cipa/dds.service.ts`
- Create: `backend/src/cipa/dds.controller.ts`
- Modify: `backend/src/cipa/cipa.module.ts`
- Create: `backend/test/cipa-dds.e2e-spec.ts`

**Interfaces:**
- Consumes: tabela `cipa_dds_records` (Task 1); `mapPgError`, `toDateString`.
- Produces: endpoints `POST /cipa/dds`, `GET /cipa/dds`, `DELETE /cipa/dds/:id` — usados pelo frontend (Task 5).

- [ ] **Step 1: DTO**

Criar `backend/src/cipa/dto/create-dds-record.dto.ts`:

```ts
import { IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateDdsRecordDto {
  @IsUUID()
  company_unit_id: string;

  @IsISO8601()
  data: string;

  @IsString()
  @MaxLength(300)
  tema: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  numero_participantes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  responsavel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacoes?: string;
}
```

- [ ] **Step 2: `DdsService`**

Criar `backend/src/cipa/dds.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { toDateString } from './committees.service';

export interface CipaDdsRecord {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  data: string;
  tema: string;
  numero_participantes: number | null;
  responsavel: string | null;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

function normalizeDds(row: CipaDdsRecord): CipaDdsRecord {
  return { ...row, data: toDateString(row.data) as string };
}

@Injectable()
export class DdsService {
  async create(
    client: PoolClient,
    tenantId: string,
    companyUnitId: string,
    data: {
      data: string;
      tema: string;
      numeroParticipantes?: number;
      responsavel?: string;
      observacoes?: string;
    },
  ): Promise<CipaDdsRecord> {
    // Mesma checagem de CommitteesService.create/ElectionsService.create
    // — FK sozinho não impede company_unit_id de outro tenant sob RLS.
    const unitCheck = await client.query('SELECT 1 FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (unitCheck.rowCount === 0) {
      throw new BadRequestException('Estabelecimento inválido para esta empresa');
    }

    try {
      const result = await client.query<CipaDdsRecord>(
        `INSERT INTO cipa_dds_records (tenant_id, company_unit_id, data, tema, numero_participantes, responsavel, observacoes)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          tenantId,
          companyUnitId,
          data.data,
          data.tema,
          data.numeroParticipantes ?? null,
          data.responsavel ?? null,
          data.observacoes ?? null,
        ],
      );
      return normalizeDds(result.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(client: PoolClient, companyUnitId?: string): Promise<CipaDdsRecord[]> {
    if (companyUnitId) {
      const result = await client.query<CipaDdsRecord>(
        'SELECT * FROM cipa_dds_records WHERE company_unit_id = $1 ORDER BY data DESC',
        [companyUnitId],
      );
      return result.rows.map(normalizeDds);
    }
    const result = await client.query<CipaDdsRecord>('SELECT * FROM cipa_dds_records ORDER BY data DESC');
    return result.rows.map(normalizeDds);
  }

  async remove(client: PoolClient, id: string): Promise<void> {
    const result = await client.query('DELETE FROM cipa_dds_records WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundException('Registro de DDS não encontrado');
  }
}
```

- [ ] **Step 3: `DdsController`**

Criar `backend/src/cipa/dds.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { DdsService } from './dds.service';
import { CreateDdsRecordDto } from './dto/create-dds-record.dto';

@Controller('cipa/dds')
export class DdsController {
  constructor(private readonly dds: DdsService) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateDdsRecordDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.dds.create(client, req.user.tenantId, dto.company_unit_id, {
        data: dto.data,
        tema: dto.tema,
        numeroParticipantes: dto.numero_participantes,
        responsavel: dto.responsavel,
        observacoes: dto.observacoes,
      }),
    );
  }

  @Get()
  findAll(@Query('company_unit_id') companyUnitId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.dds.findAll(client, companyUnitId));
  }

  @Roles('empresa')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.dds.remove(client, id));
  }
}
```

- [ ] **Step 4: Wiring em `CipaModule`**

Modificar `backend/src/cipa/cipa.module.ts` — adicionar imports de `DdsController`/`DdsService` e incluí-los em `controllers`/`providers` (mesmo padrão do Step 4 do Task 2).

- [ ] **Step 5: Testes e2e**

Criar `backend/test/cipa-dds.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CIPA DDS records (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let companyUnitId: string;
  let empresaToken: string;
  let outroTenantCompanyUnitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA DDS Teste');
    tenantId = tenant.tenantId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const outroTenant = await db.createTenantWithUser('Empresa CIPA DDS Outro Tenant');
    const outroUnitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Outro Tenant', 'Rua Outro', 'Cidade Outro', 'SP', '02000000') RETURNING id`,
      [outroTenant.tenantId],
    );
    outroTenantCompanyUnitId = outroUnitResult.rows[0].id;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await app.close();
  });

  it('cria, lista, filtra por estabelecimento, rejeita estabelecimento de outro tenant, e apaga', async () => {
    const create = await request(app.getHttpServer())
      .post('/cipa/dds')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        data: '2026-06-01',
        tema: 'Uso correto de EPI',
        numero_participantes: 12,
        responsavel: 'João Técnico',
      });
    expect(create.status).toBe(201);
    expect(create.body.tema).toBe('Uso correto de EPI');

    const cruzado = await request(app.getHttpServer())
      .post('/cipa/dds')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ company_unit_id: outroTenantCompanyUnitId, data: '2026-06-01', tema: 'Não deveria criar' });
    expect(cruzado.status).toBe(400);

    const list = await request(app.getHttpServer())
      .get(`/cipa/dds?company_unit_id=${companyUnitId}`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(list.body.some((r: any) => r.id === create.body.id)).toBe(true);

    const del = await request(app.getHttpServer())
      .delete(`/cipa/dds/${create.body.id}`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(del.status).toBe(200);

    const listDepois = await request(app.getHttpServer())
      .get(`/cipa/dds?company_unit_id=${companyUnitId}`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(listDepois.body.some((r: any) => r.id === create.body.id)).toBe(false);
  });
});
```

- [ ] **Step 6: Verificar manualmente — build + suíte completa**

Run: `docker compose build backend` — confirmar zero erros de TypeScript.

Rodar a suíte completa uma vez (ver Global Constraints).

- [ ] **Step 7: Commit**

```bash
git add backend/src/cipa/dto/create-dds-record.dto.ts backend/src/cipa/dds.service.ts backend/src/cipa/dds.controller.ts backend/src/cipa/cipa.module.ts backend/test/cipa-dds.e2e-spec.ts
git commit -m "feat: registro de DDS da CIPA — módulo completo, independente de inspeção"
```

---

## Task 4: Backend — SIPAT

**Files:**
- Create: `backend/src/cipa/dto/create-sipat-edition.dto.ts`
- Create: `backend/src/cipa/dto/create-sipat-activity.dto.ts`
- Create: `backend/src/cipa/dto/update-sipat-activity.dto.ts`
- Create: `backend/src/cipa/sipat.service.ts`
- Create: `backend/src/cipa/sipat.controller.ts`
- Modify: `backend/src/cipa/cipa.module.ts`
- Create: `backend/test/cipa-sipat.e2e-spec.ts`

**Interfaces:**
- Consumes: tabelas `cipa_sipat_editions`/`cipa_sipat_activities` (Task 1); `mapPgError`, `toDateString`.
- Produces: endpoints `POST /cipa/sipat/editions`, `GET /cipa/sipat/editions`, `DELETE /cipa/sipat/editions/:id`, `GET /cipa/sipat/editions/:id/activities`, `POST /cipa/sipat/editions/:id/activities`, `PATCH /cipa/sipat/editions/:id/activities/:activityId` — usados pelo frontend (Task 5).

- [ ] **Step 1: DTOs**

Criar `backend/src/cipa/dto/create-sipat-edition.dto.ts`:

```ts
import { IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSipatEditionDto {
  @IsUUID()
  company_unit_id: string;

  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  ano: number;

  @IsISO8601()
  periodo_inicio: string;

  @IsISO8601()
  periodo_fim: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tema?: string;
}
```

Criar `backend/src/cipa/dto/create-sipat-activity.dto.ts`:

```ts
import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSipatActivityDto {
  @IsISO8601()
  data: string;

  @IsString()
  @MaxLength(300)
  titulo: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  responsavel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  publico_alvo?: string;
}
```

Criar `backend/src/cipa/dto/update-sipat-activity.dto.ts`:

```ts
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateSipatActivityDto {
  @IsOptional()
  @IsIn(['planejada', 'realizada', 'cancelada'])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  numero_participantes?: number;
}
```

- [ ] **Step 2: `SipatService`**

Criar `backend/src/cipa/sipat.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { toDateString } from './committees.service';

export interface CipaSipatEdition {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  ano: number;
  periodo_inicio: string;
  periodo_fim: string;
  tema: string | null;
  created_at: string;
  updated_at: string;
}

export interface CipaSipatActivity {
  id: string;
  edition_id: string;
  data: string;
  titulo: string;
  responsavel: string | null;
  publico_alvo: string | null;
  status: 'planejada' | 'realizada' | 'cancelada';
  numero_participantes: number | null;
  created_at: string;
  updated_at: string;
}

function normalizeEdition(row: CipaSipatEdition): CipaSipatEdition {
  return {
    ...row,
    periodo_inicio: toDateString(row.periodo_inicio) as string,
    periodo_fim: toDateString(row.periodo_fim) as string,
  };
}

function normalizeActivity(row: CipaSipatActivity): CipaSipatActivity {
  return { ...row, data: toDateString(row.data) as string };
}

@Injectable()
export class SipatService {
  async createEdition(
    client: PoolClient,
    tenantId: string,
    companyUnitId: string,
    ano: number,
    periodoInicio: string,
    periodoFim: string,
    tema: string | undefined,
  ): Promise<CipaSipatEdition> {
    // FOR UPDATE em company_units — mesmo raciocínio de
    // ElectionsService.create, serializa duas criações quase
    // simultâneas pro mesmo estabelecimento+ano. O índice único
    // (0030_cipa_capacitacao.sql) é o backstop de banco.
    const unitCheck = await client.query('SELECT 1 FROM company_units WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [
      companyUnitId,
      tenantId,
    ]);
    if (unitCheck.rowCount === 0) {
      throw new BadRequestException('Estabelecimento inválido para esta empresa');
    }

    const dupCheck = await client.query('SELECT 1 FROM cipa_sipat_editions WHERE company_unit_id = $1 AND ano = $2', [
      companyUnitId,
      ano,
    ]);
    if ((dupCheck.rowCount ?? 0) > 0) {
      throw new ConflictException('Já existe uma edição de SIPAT para este ano neste estabelecimento');
    }

    try {
      const result = await client.query<CipaSipatEdition>(
        `INSERT INTO cipa_sipat_editions (tenant_id, company_unit_id, ano, periodo_inicio, periodo_fim, tema)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [tenantId, companyUnitId, ano, periodoInicio, periodoFim, tema ?? null],
      );
      return normalizeEdition(result.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }

  async findEditions(client: PoolClient, companyUnitId?: string): Promise<CipaSipatEdition[]> {
    if (companyUnitId) {
      const result = await client.query<CipaSipatEdition>(
        'SELECT * FROM cipa_sipat_editions WHERE company_unit_id = $1 ORDER BY ano DESC',
        [companyUnitId],
      );
      return result.rows.map(normalizeEdition);
    }
    const result = await client.query<CipaSipatEdition>('SELECT * FROM cipa_sipat_editions ORDER BY ano DESC');
    return result.rows.map(normalizeEdition);
  }

  async removeEdition(client: PoolClient, id: string): Promise<void> {
    // Cascateia pras atividades via FK (ON DELETE CASCADE,
    // 0030_cipa_capacitacao.sql) — não precisa apagar as atividades
    // manualmente aqui.
    const result = await client.query('DELETE FROM cipa_sipat_editions WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundException('Edição de SIPAT não encontrada');
  }

  async addActivity(
    client: PoolClient,
    editionId: string,
    data: string,
    titulo: string,
    responsavel: string | undefined,
    publicoAlvo: string | undefined,
  ): Promise<CipaSipatActivity> {
    const editionCheck = await client.query('SELECT 1 FROM cipa_sipat_editions WHERE id = $1', [editionId]);
    if (editionCheck.rowCount === 0) throw new NotFoundException('Edição de SIPAT não encontrada');

    try {
      const result = await client.query<CipaSipatActivity>(
        `INSERT INTO cipa_sipat_activities (edition_id, data, titulo, responsavel, publico_alvo)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [editionId, data, titulo, responsavel ?? null, publicoAlvo ?? null],
      );
      return normalizeActivity(result.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }

  // Mesmo padrão de ElectionsService.findCandidates — sem checar
  // existência da edição primeiro, um edition_id inválido/de outro
  // tenant só devolve lista vazia (RLS de cipa_sipat_editions já
  // filtra o que o EXISTS de cipa_sipat_activities_isolation enxerga).
  async findActivities(client: PoolClient, editionId: string): Promise<CipaSipatActivity[]> {
    const result = await client.query<CipaSipatActivity>(
      'SELECT * FROM cipa_sipat_activities WHERE edition_id = $1 ORDER BY data',
      [editionId],
    );
    return result.rows.map(normalizeActivity);
  }

  async updateActivity(
    client: PoolClient,
    editionId: string,
    activityId: string,
    data: { status?: string; numeroParticipantes?: number },
  ): Promise<CipaSipatActivity> {
    // Mesmo padrão de dynamic SET de ElectionsService.updateCandidate —
    // só inclui no SET o que veio de fato no payload.
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 3;
    if (data.status !== undefined) {
      setClauses.push(`status = $${i++}`);
      values.push(data.status);
    }
    if (data.numeroParticipantes !== undefined) {
      setClauses.push(`numero_participantes = $${i++}`);
      values.push(data.numeroParticipantes);
    }

    if (setClauses.length === 0) {
      const result = await client.query<CipaSipatActivity>(
        'SELECT * FROM cipa_sipat_activities WHERE id = $1 AND edition_id = $2',
        [activityId, editionId],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException('Atividade não encontrada');
      return normalizeActivity(row);
    }

    try {
      const result = await client.query<CipaSipatActivity>(
        `UPDATE cipa_sipat_activities SET ${setClauses.join(', ')} WHERE id = $1 AND edition_id = $2 RETURNING *`,
        [activityId, editionId, ...values],
      );
      if (result.rows.length === 0) throw new NotFoundException('Atividade não encontrada');
      return normalizeActivity(result.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }
}
```

- [ ] **Step 3: `SipatController`**

Criar `backend/src/cipa/sipat.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { SipatService } from './sipat.service';
import { CreateSipatEditionDto } from './dto/create-sipat-edition.dto';
import { CreateSipatActivityDto } from './dto/create-sipat-activity.dto';
import { UpdateSipatActivityDto } from './dto/update-sipat-activity.dto';

@Controller('cipa/sipat/editions')
export class SipatController {
  constructor(private readonly sipat: SipatService) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  createEdition(@Body() dto: CreateSipatEditionDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.sipat.createEdition(client, req.user.tenantId, dto.company_unit_id, dto.ano, dto.periodo_inicio, dto.periodo_fim, dto.tema),
    );
  }

  @Get()
  findEditions(@Query('company_unit_id') companyUnitId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.sipat.findEditions(client, companyUnitId));
  }

  @Roles('empresa')
  @Delete(':id')
  removeEdition(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.sipat.removeEdition(client, id));
  }

  @Get(':id/activities')
  findActivities(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.sipat.findActivities(client, id));
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/activities')
  addActivity(@Param('id') id: string, @Body() dto: CreateSipatActivityDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.sipat.addActivity(client, id, dto.data, dto.titulo, dto.responsavel, dto.publico_alvo),
    );
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id/activities/:activityId')
  updateActivity(
    @Param('id') id: string,
    @Param('activityId') activityId: string,
    @Body() dto: UpdateSipatActivityDto,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) =>
      this.sipat.updateActivity(client, id, activityId, { status: dto.status, numeroParticipantes: dto.numero_participantes }),
    );
  }
}
```

- [ ] **Step 4: Wiring em `CipaModule`**

Modificar `backend/src/cipa/cipa.module.ts` — adicionar imports de `SipatController`/`SipatService` e incluí-los em `controllers`/`providers`.

- [ ] **Step 5: Testes e2e**

Criar `backend/test/cipa-sipat.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CIPA SIPAT (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let companyUnitId: string;
  let empresaToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA SIPAT Teste');
    tenantId = tenant.tenantId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await app.close();
  });

  it('cria edição, rejeita duplicata do mesmo ano/estabelecimento com 409', async () => {
    const create = await request(app.getHttpServer())
      .post('/cipa/sipat/editions')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ company_unit_id: companyUnitId, ano: 2026, periodo_inicio: '2026-10-19', periodo_fim: '2026-10-23', tema: 'Segurança é prioridade' });
    expect(create.status).toBe(201);

    const duplicada = await request(app.getHttpServer())
      .post('/cipa/sipat/editions')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ company_unit_id: companyUnitId, ano: 2026, periodo_inicio: '2026-11-01', periodo_fim: '2026-11-05' });
    expect(duplicada.status).toBe(409);
  });

  it('adiciona atividade, atualiza status/participantes, lista, e apagar edição cascateia', async () => {
    const edition = await request(app.getHttpServer())
      .post('/cipa/sipat/editions')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ company_unit_id: companyUnitId, ano: 2027, periodo_inicio: '2027-10-18', periodo_fim: '2027-10-22' });
    expect(edition.status).toBe(201);
    const editionId = edition.body.id;

    const activity = await request(app.getHttpServer())
      .post(`/cipa/sipat/editions/${editionId}/activities`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ data: '2027-10-19', titulo: 'Palestra de prevenção de acidentes', responsavel: 'Dr. Fulano' });
    expect(activity.status).toBe(201);
    expect(activity.body.status).toBe('planejada');

    const updated = await request(app.getHttpServer())
      .patch(`/cipa/sipat/editions/${editionId}/activities/${activity.body.id}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ status: 'realizada', numero_participantes: 40 });
    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe('realizada');
    expect(updated.body.numero_participantes).toBe(40);

    const list = await request(app.getHttpServer())
      .get(`/cipa/sipat/editions/${editionId}/activities`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].numero_participantes).toBe(40);

    const del = await request(app.getHttpServer())
      .delete(`/cipa/sipat/editions/${editionId}`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(del.status).toBe(200);

    const listDepois = await request(app.getHttpServer())
      .get(`/cipa/sipat/editions/${editionId}/activities`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(listDepois.body).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Verificar manualmente — build + suíte completa**

Run: `docker compose build backend` — confirmar zero erros de TypeScript.

Rodar a suíte completa uma vez (ver Global Constraints).

- [ ] **Step 7: Commit**

```bash
git add backend/src/cipa/dto/create-sipat-edition.dto.ts backend/src/cipa/dto/create-sipat-activity.dto.ts backend/src/cipa/dto/update-sipat-activity.dto.ts backend/src/cipa/sipat.service.ts backend/src/cipa/sipat.controller.ts backend/src/cipa/cipa.module.ts backend/test/cipa-sipat.e2e-spec.ts
git commit -m "feat: SIPAT da CIPA — edições anuais e atividades planejadas/realizadas"
```

---

## Task 5: Frontend — sidebar + página de Capacitação (3 abas)

**Files:**
- Modify: `frontend/src/lib/cipa-types.ts`
- Modify: `frontend/src/components/EmpresaSidebar.tsx`
- Modify: `frontend/src/app/empresa/cipa/pendencias/page.tsx`
- Create: `frontend/src/app/empresa/cipa/capacitacao/page.tsx`
- Create: `frontend/src/app/empresa/cipa/capacitacao/TreinamentosTab.tsx`
- Create: `frontend/src/app/empresa/cipa/capacitacao/DdsTab.tsx`
- Create: `frontend/src/app/empresa/cipa/capacitacao/SipatTab.tsx`

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/cipa/trainings` (multipart no POST), `GET/POST/DELETE /api/cipa/dds`, `GET/POST/DELETE /api/cipa/sipat/editions`, `GET/POST/PATCH /api/cipa/sipat/editions/:id/activities[/:activityId]` (Tasks 2-4); `GET /api/cipa/pendencias` agora com itens `origem: 'treinamento'`; `GET /api/employees?tenant_id=` (já existe); `GET /api/documents/:id/download` (já existe, retorna `{url, file_name}`); `getToken`/`getUser` (`@/lib/auth`); `getSelectedCompanyUnitId`/`formatDateBR` (`@/lib/cipa-types`, já existem).
- Produces: nada consumido por task seguinte (última task da fase).

- [ ] **Step 1: Tipos**

Modificar `frontend/src/lib/cipa-types.ts` — adicionar logo depois da interface `Employee` já existente (mantém os tipos de Capacitação próximos do tipo `Employee` que `CipaTraining` referencia):

```ts
export const TRAINING_TYPES = [
  'nr-05', 'nr-06', 'nr-10', 'nr-11', 'nr-12', 'nr-18', 'nr-20', 'nr-33', 'nr-35', 'outro',
] as const;
export type TrainingType = (typeof TRAINING_TYPES)[number];

export const TRAINING_TYPE_LABEL: Record<TrainingType, string> = {
  'nr-05': 'NR-05 — Membro da CIPA',
  'nr-06': 'NR-06 — Uso de EPI',
  'nr-10': 'NR-10 — Segurança em eletricidade',
  'nr-11': 'NR-11 — Transporte/movimentação de materiais',
  'nr-12': 'NR-12 — Segurança em máquinas e equipamentos',
  'nr-18': 'NR-18 — Condições de segurança na construção civil',
  'nr-20': 'NR-20 — Inflamáveis e combustíveis',
  'nr-33': 'NR-33 — Espaço confinado',
  'nr-35': 'NR-35 — Trabalho em altura',
  outro: 'Outro',
};

// Mesmos valores de TRAINING_VALIDITY_MONTHS em
// backend/src/cipa/trainings.service.ts — usado só pra pré-preencher
// a sugestão de data de validade no formulário, o backend não confia
// nesse valor (o valor final enviado é sempre o que estiver no campo).
export const TRAINING_VALIDITY_MONTHS: Record<Exclude<TrainingType, 'outro'>, number> = {
  'nr-05': 24,
  'nr-06': 12,
  'nr-10': 24,
  'nr-11': 12,
  'nr-12': 24,
  'nr-18': 12,
  'nr-20': 12,
  'nr-33': 12,
  'nr-35': 24,
};

export interface CipaTraining {
  id: string;
  employee_id: string;
  employee_full_name: string;
  tipo: TrainingType;
  tipo_outro: string | null;
  data_realizacao: string;
  data_validade: string;
  carga_horaria: number | null;
  certificado_document_id: string | null;
  status: 'valido' | 'vencendo' | 'vencido';
}

export interface CipaDdsRecord {
  id: string;
  company_unit_id: string;
  data: string;
  tema: string;
  numero_participantes: number | null;
  responsavel: string | null;
  observacoes: string | null;
}

export interface CipaSipatEdition {
  id: string;
  company_unit_id: string;
  ano: number;
  periodo_inicio: string;
  periodo_fim: string;
  tema: string | null;
}

export interface CipaSipatActivity {
  id: string;
  edition_id: string;
  data: string;
  titulo: string;
  responsavel: string | null;
  publico_alvo: string | null;
  status: 'planejada' | 'realizada' | 'cancelada';
  numero_participantes: number | null;
}
```

Modificar a interface `CipaPendencia` já existente — adicionar um campo novo `origem` no final (opcional, ausente pra pendências manuais):

```ts
export interface CipaPendencia {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  meeting_id: string | null;
  descricao: string;
  responsavel_user_id: string | null;
  prazo: string | null;
  prioridade: 'alta' | 'media' | 'baixa';
  status: 'aberta' | 'andamento' | 'concluida' | 'atrasada';
  created_at: string;
  updated_at: string;
  origem?: 'treinamento';
}
```

- [ ] **Step 2: Link novo na sidebar**

Modificar `frontend/src/components/EmpresaSidebar.tsx` — adicionar uma linha nova no array `links` do grupo `CIPA`, depois de "Pendências":

```ts
      { href: '/empresa/cipa', label: 'Central da CIPA', emoji: '🦺' },
      { href: '/empresa/cipa/reunioes', label: 'Reuniões', emoji: '📅' },
      { href: '/empresa/cipa/membros', label: 'Membros', emoji: '👥' },
      { href: '/empresa/cipa/eleicao', label: 'Eleição', emoji: '🗳️' },
      { href: '/empresa/cipa/pendencias', label: 'Pendências', emoji: '📌' },
      { href: '/empresa/cipa/capacitacao', label: 'Capacitação', emoji: '🎓' },
```

- [ ] **Step 3: Página de Capacitação — shell com abas**

Criar `frontend/src/app/empresa/cipa/capacitacao/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import TreinamentosTab from './TreinamentosTab';
import DdsTab from './DdsTab';
import SipatTab from './SipatTab';

type Tab = 'treinamentos' | 'dds' | 'sipat';

const TABS: { key: Tab; label: string }[] = [
  { key: 'treinamentos', label: 'Treinamentos' },
  { key: 'dds', label: 'DDS' },
  { key: 'sipat', label: 'SIPAT' },
];

export default function CapacitacaoPage() {
  const [tab, setTab] = useState<Tab>('treinamentos');

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">🎓 Capacitação</h1>
      <p className="mt-1 text-sm text-brand-700">Treinamentos obrigatórios, DDS e SIPAT da empresa.</p>

      <div className="mt-6 flex gap-2 border-b border-brand-100">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-semibold ${
              tab === t.key ? 'border-b-2 border-brand-500 text-brand-900' : 'text-brand-700 hover:text-brand-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === 'treinamentos' && <TreinamentosTab />}
        {tab === 'dds' && <DdsTab />}
        {tab === 'sipat' && <SipatTab />}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Aba Treinamentos**

Criar `frontend/src/app/empresa/cipa/capacitacao/TreinamentosTab.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getUser } from '@/lib/auth';
import {
  CipaTraining,
  Employee,
  TRAINING_TYPE_LABEL,
  TRAINING_TYPES,
  TRAINING_VALIDITY_MONTHS,
  TrainingType,
  formatDateBR,
} from '@/lib/cipa-types';

const STATUS_CLASS: Record<CipaTraining['status'], string> = {
  valido: 'bg-green-50 text-green-800',
  vencendo: 'bg-amber-50 text-amber-800',
  vencido: 'bg-red-50 text-red-800',
};

const STATUS_LABEL: Record<CipaTraining['status'], string> = {
  valido: 'Válido',
  vencendo: 'Vencendo',
  vencido: 'Vencido',
};

export default function TreinamentosTab() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [trainings, setTrainings] = useState<CipaTraining[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [filterEmployeeId, setFilterEmployeeId] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const [employeeId, setEmployeeId] = useState('');
  const [tipo, setTipo] = useState<TrainingType>('nr-05');
  const [tipoOutro, setTipoOutro] = useState('');
  const [dataRealizacao, setDataRealizacao] = useState('');
  const [dataValidade, setDataValidade] = useState('');
  const [cargaHoraria, setCargaHoraria] = useState('');
  const [certificado, setCertificado] = useState<File | null>(null);

  async function load() {
    const token = getToken();
    const user = getUser();
    if (!token || !user) {
      router.push('/login');
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    const params = new URLSearchParams();
    if (filterEmployeeId) params.set('employee_id', filterEmployeeId);
    if (filterTipo) params.set('tipo', filterTipo);
    if (filterStatus) params.set('status', filterStatus);
    const [trainingsData, employeesData] = await Promise.all([
      fetch(`/api/cipa/trainings?${params.toString()}`, { headers }).then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/employees?tenant_id=${user.tenantId}`, { headers }).then((r) => (r.ok ? r.json() : [])),
    ]);
    setTrainings(trainingsData);
    setEmployees(employeesData.filter((e: Employee) => e.status === 'ativo'));
    setReady(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterEmployeeId, filterTipo, filterStatus]);

  function suggestValidade(realizacao: string, tipoSelecionado: TrainingType) {
    if (!realizacao || tipoSelecionado === 'outro') return;
    const months = TRAINING_VALIDITY_MONTHS[tipoSelecionado];
    const d = new Date(`${realizacao}T00:00:00`);
    d.setMonth(d.getMonth() + months);
    setDataValidade(d.toISOString().slice(0, 10));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const token = getToken();
    try {
      const formData = new FormData();
      formData.set('employee_id', employeeId);
      formData.set('tipo', tipo);
      if (tipo === 'outro') formData.set('tipo_outro', tipoOutro);
      formData.set('data_realizacao', dataRealizacao);
      formData.set('data_validade', dataValidade);
      if (cargaHoraria) formData.set('carga_horaria', cargaHoraria);
      if (certificado) formData.set('certificado', certificado);

      const res = await fetch('/api/cipa/trainings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        setError('Não foi possível registrar o treinamento. Confira os campos.');
        return;
      }
      setShowForm(false);
      setEmployeeId('');
      setTipoOutro('');
      setDataRealizacao('');
      setDataValidade('');
      setCargaHoraria('');
      setCertificado(null);
      await load();
    } catch {
      setError('Falha de conexão ao enviar o treinamento.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Apagar este registro de treinamento?')) return;
    const token = getToken();
    const res = await fetch(`/api/cipa/trainings/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      await load();
    } else {
      setError('Não foi possível apagar o registro.');
    }
  }

  async function handleDownload(documentId: string) {
    const token = getToken();
    const res = await fetch(`/api/documents/${documentId}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setError('Não foi possível gerar o link do certificado.');
      return;
    }
    const { url } = await res.json();
    window.open(url, '_blank');
  }

  if (!ready) {
    return <div className="py-8 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <select
            value={filterEmployeeId}
            onChange={(e) => setFilterEmployeeId(e.target.value)}
            className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2 text-sm"
          >
            <option value="">Todos os funcionários</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.full_name}
              </option>
            ))}
          </select>
          <select
            value={filterTipo}
            onChange={(e) => setFilterTipo(e.target.value)}
            className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2 text-sm"
          >
            <option value="">Todos os tipos</option>
            {TRAINING_TYPES.map((t) => (
              <option key={t} value={t}>
                {TRAINING_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2 text-sm"
          >
            <option value="">Todos os status</option>
            <option value="valido">Válido</option>
            <option value="vencendo">Vencendo</option>
            <option value="vencido">Vencido</option>
          </select>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + Novo treinamento
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-3 rounded-lg border border-brand-100 p-4">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Funcionário
            <select
              required
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            >
              <option value="">Selecione...</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Tipo
            <select
              value={tipo}
              onChange={(e) => {
                const value = e.target.value as TrainingType;
                setTipo(value);
                suggestValidade(dataRealizacao, value);
              }}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            >
              {TRAINING_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TRAINING_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          {tipo === 'outro' && (
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Nome do treinamento
              <input
                required
                value={tipoOutro}
                onChange={(e) => setTipoOutro(e.target.value)}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Data de realização
              <input
                type="date"
                required
                value={dataRealizacao}
                onChange={(e) => {
                  setDataRealizacao(e.target.value);
                  suggestValidade(e.target.value, tipo);
                }}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Válido até
              <input
                type="date"
                required
                value={dataValidade}
                onChange={(e) => setDataValidade(e.target.value)}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Carga horária (opcional)
            <input
              type="number"
              min={0}
              value={cargaHoraria}
              onChange={(e) => setCargaHoraria(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Certificado (opcional, PDF/JPG/PNG)
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => setCertificado(e.target.files?.[0] ?? null)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="self-start rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Registrar treinamento'}
          </button>
        </form>
      )}

      <div className="mt-6 flex flex-col gap-2">
        {trainings.map((t) => (
          <div key={t.id} className="rounded-md border border-brand-100 px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-900">
                  {t.tipo === 'outro' ? t.tipo_outro : TRAINING_TYPE_LABEL[t.tipo]} — {t.employee_full_name}
                </p>
                <p className="mt-0.5 text-xs text-brand-700">
                  Realizado em {formatDateBR(t.data_realizacao)} · Válido até {formatDateBR(t.data_validade)}
                  {t.carga_horaria ? ` · ${t.carga_horaria}h` : ''}
                </p>
                {t.certificado_document_id && (
                  <button
                    onClick={() => handleDownload(t.certificado_document_id as string)}
                    className="mt-1 text-xs font-semibold text-brand-500 hover:underline"
                  >
                    📎 Ver certificado
                  </button>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[t.status]}`}>
                  {STATUS_LABEL[t.status]}
                </span>
                <button onClick={() => handleDelete(t.id)} className="text-xs text-red-600 hover:underline">
                  Apagar
                </button>
              </div>
            </div>
          </div>
        ))}
        {trainings.length === 0 && <p className="text-sm text-brand-700">Nenhum treinamento registrado.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Aba DDS**

Criar `frontend/src/app/empresa/cipa/capacitacao/DdsTab.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { CipaDdsRecord, formatDateBR, getSelectedCompanyUnitId } from '@/lib/cipa-types';

export default function DdsTab() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [records, setRecords] = useState<CipaDdsRecord[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [data, setData] = useState('');
  const [tema, setTema] = useState('');
  const [numeroParticipantes, setNumeroParticipantes] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [observacoes, setObservacoes] = useState('');

  async function load() {
    const token = getToken();
    const unitId = getSelectedCompanyUnitId();
    if (!token) {
      router.push('/login');
      return;
    }
    if (!unitId) {
      setReady(true);
      return;
    }
    const result = await fetch(`/api/cipa/dds?company_unit_id=${unitId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : []));
    setRecords(result);
    setReady(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const token = getToken();
    const unitId = getSelectedCompanyUnitId();
    try {
      const res = await fetch('/api/cipa/dds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          company_unit_id: unitId,
          data,
          tema,
          numero_participantes: numeroParticipantes ? Number(numeroParticipantes) : undefined,
          responsavel: responsavel || undefined,
          observacoes: observacoes || undefined,
        }),
      });
      if (!res.ok) {
        setError('Não foi possível registrar o DDS.');
        return;
      }
      setShowForm(false);
      setData('');
      setTema('');
      setNumeroParticipantes('');
      setResponsavel('');
      setObservacoes('');
      await load();
    } catch {
      setError('Falha de conexão ao registrar o DDS.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Apagar este registro de DDS?')) return;
    const token = getToken();
    const res = await fetch(`/api/cipa/dds/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      await load();
    } else {
      setError('Não foi possível apagar o registro.');
    }
  }

  if (!ready) {
    return <div className="py-8 text-center text-brand-700">Carregando...</div>;
  }

  if (!getSelectedCompanyUnitId()) {
    return <p className="text-sm text-brand-700">Selecione um estabelecimento pra ver os DDS.</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-end">
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + Novo DDS
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-3 rounded-lg border border-brand-100 p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Data
              <input
                type="date"
                required
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Nº de participantes
              <input
                type="number"
                min={0}
                value={numeroParticipantes}
                onChange={(e) => setNumeroParticipantes(e.target.value)}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Tema abordado
            <input
              required
              value={tema}
              onChange={(e) => setTema(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Responsável (opcional)
            <input
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Observações (opcional)
            <textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="self-start rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Registrar DDS'}
          </button>
        </form>
      )}

      <div className="mt-6 flex flex-col gap-2">
        {records.map((r) => (
          <div key={r.id} className="rounded-md border border-brand-100 px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-900">{r.tema}</p>
                <p className="mt-0.5 text-xs text-brand-700">
                  {formatDateBR(r.data)}
                  {r.numero_participantes !== null && ` · ${r.numero_participantes} participantes`}
                  {r.responsavel && ` · ${r.responsavel}`}
                </p>
                {r.observacoes && <p className="mt-1 text-xs text-brand-700">{r.observacoes}</p>}
              </div>
              <button onClick={() => handleDelete(r.id)} className="shrink-0 text-xs text-red-600 hover:underline">
                Apagar
              </button>
            </div>
          </div>
        ))}
        {records.length === 0 && <p className="text-sm text-brand-700">Nenhum DDS registrado.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Aba SIPAT**

Criar `frontend/src/app/empresa/cipa/capacitacao/SipatTab.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { CipaSipatActivity, CipaSipatEdition, formatDateBR, getSelectedCompanyUnitId } from '@/lib/cipa-types';

const STATUS_LABEL: Record<CipaSipatActivity['status'], string> = {
  planejada: 'Planejada',
  realizada: 'Realizada',
  cancelada: 'Cancelada',
};

const STATUS_CLASS: Record<CipaSipatActivity['status'], string> = {
  planejada: 'bg-brand-50 text-brand-700',
  realizada: 'bg-green-50 text-green-800',
  cancelada: 'bg-red-50 text-red-800',
};

export default function SipatTab() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [editions, setEditions] = useState<CipaSipatEdition[]>([]);
  const [selectedEditionId, setSelectedEditionId] = useState('');
  const [activities, setActivities] = useState<CipaSipatActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [showEditionForm, setShowEditionForm] = useState(false);
  const [ano, setAno] = useState(new Date().getFullYear());
  const [periodoInicio, setPeriodoInicio] = useState('');
  const [periodoFim, setPeriodoFim] = useState('');
  const [tema, setTema] = useState('');

  const [showActivityForm, setShowActivityForm] = useState(false);
  const [atividadeData, setAtividadeData] = useState('');
  const [titulo, setTitulo] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [publicoAlvo, setPublicoAlvo] = useState('');

  async function loadEditions() {
    const token = getToken();
    const unitId = getSelectedCompanyUnitId();
    if (!token) {
      router.push('/login');
      return;
    }
    if (!unitId) {
      setReady(true);
      return;
    }
    const result: CipaSipatEdition[] = await fetch(`/api/cipa/sipat/editions?company_unit_id=${unitId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : []));
    setEditions(result);
    setReady(true);
    return result;
  }

  async function loadActivities(editionId: string) {
    const token = getToken();
    const result: CipaSipatActivity[] = await fetch(`/api/cipa/sipat/editions/${editionId}/activities`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : []));
    setActivities(result);
  }

  useEffect(() => {
    loadEditions().then((result) => {
      if (result && result.length > 0) {
        setSelectedEditionId(result[0].id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedEditionId) {
      loadActivities(selectedEditionId);
    } else {
      setActivities([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEditionId]);

  async function handleCreateEdition(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const token = getToken();
    const unitId = getSelectedCompanyUnitId();
    try {
      const res = await fetch('/api/cipa/sipat/editions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          company_unit_id: unitId,
          ano,
          periodo_inicio: periodoInicio,
          periodo_fim: periodoFim,
          tema: tema || undefined,
        }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          setError('Já existe uma edição de SIPAT para este ano neste estabelecimento.');
        } else {
          setError('Não foi possível criar a edição de SIPAT.');
        }
        return;
      }
      const created: CipaSipatEdition = await res.json();
      setShowEditionForm(false);
      setPeriodoInicio('');
      setPeriodoFim('');
      setTema('');
      await loadEditions();
      setSelectedEditionId(created.id);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteEdition(id: string) {
    if (!confirm('Apagar esta edição de SIPAT e todas as suas atividades? Não pode ser desfeito.')) return;
    const token = getToken();
    const res = await fetch(`/api/cipa/sipat/editions/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setSelectedEditionId('');
      await loadEditions();
    } else {
      setError('Não foi possível apagar a edição.');
    }
  }

  async function handleAddActivity(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const token = getToken();
    const res = await fetch(`/api/cipa/sipat/editions/${selectedEditionId}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        data: atividadeData,
        titulo,
        responsavel: responsavel || undefined,
        publico_alvo: publicoAlvo || undefined,
      }),
    });
    if (res.ok) {
      setShowActivityForm(false);
      setAtividadeData('');
      setTitulo('');
      setResponsavel('');
      setPublicoAlvo('');
      await loadActivities(selectedEditionId);
    } else {
      setError('Não foi possível adicionar a atividade.');
    }
  }

  async function updateActivity(activityId: string, data: Record<string, unknown>) {
    const token = getToken();
    const res = await fetch(`/api/cipa/sipat/editions/${selectedEditionId}/activities/${activityId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      setError(null);
      await loadActivities(selectedEditionId);
    } else {
      setError('Não foi possível atualizar a atividade.');
    }
  }

  if (!ready) {
    return <div className="py-8 text-center text-brand-700">Carregando...</div>;
  }

  if (!getSelectedCompanyUnitId()) {
    return <p className="text-sm text-brand-700">Selecione um estabelecimento pra ver a SIPAT.</p>;
  }

  const selectedEdition = editions.find((ed) => ed.id === selectedEditionId) ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Edição
          <select
            value={selectedEditionId}
            onChange={(e) => setSelectedEditionId(e.target.value)}
            className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
          >
            <option value="">Selecione...</option>
            {editions.map((ed) => (
              <option key={ed.id} value={ed.id}>
                SIPAT {ed.ano}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => setShowEditionForm(!showEditionForm)}
          className="rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + Nova edição
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {showEditionForm && (
        <form onSubmit={handleCreateEdition} className="mt-4 flex flex-col gap-3 rounded-lg border border-brand-100 p-4">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Ano
            <input
              type="number"
              required
              value={ano}
              onChange={(e) => setAno(Number(e.target.value))}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Início do período
              <input
                type="date"
                required
                value={periodoInicio}
                onChange={(e) => setPeriodoInicio(e.target.value)}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Fim do período
              <input
                type="date"
                required
                value={periodoFim}
                onChange={(e) => setPeriodoFim(e.target.value)}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Tema (opcional)
            <input
              value={tema}
              onChange={(e) => setTema(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="self-start rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Criando...' : 'Criar edição'}
          </button>
        </form>
      )}

      {selectedEdition && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-brand-700">
              {formatDateBR(selectedEdition.periodo_inicio)} a {formatDateBR(selectedEdition.periodo_fim)}
              {selectedEdition.tema && ` · ${selectedEdition.tema}`}
            </p>
            <button onClick={() => handleDeleteEdition(selectedEdition.id)} className="text-xs text-red-600 hover:underline">
              Apagar edição
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {activities.map((a) => (
              <div key={a.id} className="rounded-md border border-brand-100 px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-brand-900">{a.titulo}</p>
                    <p className="mt-0.5 text-xs text-brand-700">
                      {formatDateBR(a.data)}
                      {a.responsavel && ` · ${a.responsavel}`}
                      {a.publico_alvo && ` · ${a.publico_alvo}`}
                      {a.numero_participantes !== null && ` · ${a.numero_participantes} participantes`}
                    </p>
                  </div>
                  <select
                    value={a.status}
                    onChange={(e) => updateActivity(a.id, { status: e.target.value })}
                    className={`shrink-0 rounded-full border-0 px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[a.status]}`}
                  >
                    {Object.entries(STATUS_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                {a.status === 'realizada' && (
                  <label className="mt-2 flex items-center gap-2 text-xs text-brand-700">
                    Participantes:
                    <input
                      type="number"
                      min={0}
                      defaultValue={a.numero_participantes ?? ''}
                      onBlur={(e) => {
                        if (e.target.value !== String(a.numero_participantes ?? '')) {
                          updateActivity(a.id, { numero_participantes: Number(e.target.value) });
                        }
                      }}
                      className="w-20 rounded-[9px] border-[1.5px] border-brand-100 px-2 py-1"
                    />
                  </label>
                )}
              </div>
            ))}
            {activities.length === 0 && <p className="text-sm text-brand-700">Nenhuma atividade cadastrada.</p>}
          </div>

          <button
            onClick={() => setShowActivityForm(!showActivityForm)}
            className="mt-4 rounded-[9px] border border-brand-100 px-4 py-2 text-sm font-semibold text-brand-900 hover:bg-brand-50"
          >
            + Adicionar atividade
          </button>

          {showActivityForm && (
            <form onSubmit={handleAddActivity} className="mt-3 flex flex-col gap-3 rounded-lg border border-brand-100 p-4">
              <label className="flex flex-col gap-1 text-sm text-brand-900">
                Data
                <input
                  type="date"
                  required
                  value={atividadeData}
                  onChange={(e) => setAtividadeData(e.target.value)}
                  className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-brand-900">
                Título
                <input
                  required
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-sm text-brand-900">
                  Responsável (opcional)
                  <input
                    value={responsavel}
                    onChange={(e) => setResponsavel(e.target.value)}
                    className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-brand-900">
                  Público-alvo (opcional)
                  <input
                    value={publicoAlvo}
                    onChange={(e) => setPublicoAlvo(e.target.value)}
                    className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
                  />
                </label>
              </div>
              <button
                type="submit"
                className="self-start rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Adicionar
              </button>
            </form>
          )}
        </div>
      )}

      {!selectedEdition && editions.length === 0 && (
        <p className="mt-6 text-sm text-brand-700">Nenhuma edição de SIPAT criada ainda.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Pendências — exibir itens computados de treinamento**

Modificar `frontend/src/app/empresa/cipa/pendencias/page.tsx` — trocar o bloco do `<select>` de status (dentro do `.map((p) => ...)`) por uma renderização condicional: pendências computadas (`p.origem === 'treinamento'`) mostram um badge fixo em vez do `<select>` editável, e ganham uma marcação extra na linha de detalhes. Trecho completo do `.map` depois da mudança:

```tsx
        {pendencias.map((p) => (
          <div key={p.id} className="rounded-md border border-brand-100 px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-900">{p.descricao}</p>
                <p className="mt-0.5 text-xs text-brand-700">
                  {PRIORIDADE_LABEL[p.prioridade]} · Prazo: {formatDateBR(p.prazo)}
                  {p.meeting_id && ' · Originada de reunião'}
                  {p.origem === 'treinamento' && ' · Treinamento'}
                </p>
              </div>
              {p.origem === 'treinamento' ? (
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    p.prioridade === 'alta' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'
                  }`}
                >
                  🎓 Treinamento
                </span>
              ) : (
                <select
                  value={p.status}
                  onChange={(e) => updateStatus(p, e.target.value as CipaPendencia['status'])}
                  className={`shrink-0 rounded-full border-0 px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[p.status]}`}
                >
                  {Object.entries(STATUS_PENDENCIA_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        ))}
```

- [ ] **Step 8: Verificar manualmente no navegador**

`docker compose build frontend` — confirmar zero erros de TypeScript/lint. Recriar o container (`docker compose up -d frontend`) antes de testar.

Playwright contra a build de produção real (`https://montesesst.com.br`), sessão sintética via `localStorage` (`page.evaluate` numa navegação inicial, não `page.addInitScript`), `page.route()` mockando `/api/company-units`, `/api/employees`, `/api/cipa/trainings`, `/api/cipa/dds`, `/api/cipa/sipat/editions[/:id/activities]`, `/api/documents/:id/download`, e `/api/cipa/pendencias`. Cenários mínimos:

1. Abrir `/empresa/cipa/capacitacao` — aba Treinamentos ativa por padrão, form de novo treinamento funciona (inclusive a sugestão automática de `data_validade` ao escolher um tipo com `data_realizacao` já preenchida), upload de certificado com `setInputFiles` num arquivo de teste, link "Ver certificado" chama `/api/documents/:id/download` e abre a URL retornada.
2. Trocar pra aba DDS — form de novo DDS funciona, lista aparece.
3. Trocar pra aba SIPAT — criar edição, adicionar atividade, mudar status de `planejada` pra `realizada` dispara o `<select>` corretamente, editar participantes no `onBlur` sem disparar PATCH a cada tecla (mesma checagem já usada na Fase 14 pro campo de votos — confirmar que digitar rápido não dispara múltiplos PATCHs).
4. Tentar criar uma segunda edição de SIPAT pro mesmo ano — mensagem de erro 409 específica aparece.
5. `/empresa/cipa/pendencias` com uma pendência mockada `origem: 'treinamento'` — badge "🎓 Treinamento" aparece em vez do `<select>` de status editável.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/lib/cipa-types.ts frontend/src/components/EmpresaSidebar.tsx frontend/src/app/empresa/cipa/pendencias/page.tsx frontend/src/app/empresa/cipa/capacitacao/
git commit -m "feat: tela de Capacitação da CIPA — treinamentos, DDS e SIPAT em 3 abas"
```

---

## Depois da última task

- Rodar `docker compose build backend && docker compose build frontend` combinados uma última vez.
- Gerar o pacote de revisão final de toda a branch (merge-base = commit da Task 1, migration) e despachar a revisão final no modelo mais capaz disponível, seguindo `subagent-driven-development`.
- Fechar `docs/roadmap.md` com uma entrada detalhada desta fase, mesmo formato de toda fase anterior.
- Próxima frente da ordem já acordada (spec da Fase 12 §1): Reconhecimento/gamificação (Troféu Montese, Empresa Destaque) — ainda sem spec, precisa de brainstorming antes de qualquer plano.
