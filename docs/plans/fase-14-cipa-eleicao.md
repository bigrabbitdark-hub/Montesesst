# Fase 14 — CIPA: eleição de representantes: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empresa cadastra candidatos (funcionário já cadastrado ou nome livre) pra eleição da CIPA, registra o resultado da votação física depois de apurado, e ao concluir a eleição o sistema cria automaticamente os membros eleitos em `cipa_members` — sem redigitação.

**Architecture:** Duas tabelas novas (`cipa_elections`, `cipa_election_candidates`), um par controller/service novo (`ElectionsController`/`ElectionsService`) espelhando exatamente o padrão já estabelecido em `MembersController`/`MembersService` e `CommitteesService` (mesmo estilo de query parametrizada, `mapPgError`, `toDateString`, guarda `FOR UPDATE` antes de transição de estado). A votação em si é sempre física — o sistema só registra candidatos e resultado já apurado, nunca conduz a votação (decisão fechada na spec, "sem login de colaborador" vale também aqui). Reaproveita `GET /employees` (já existe) pro seletor de candidato, sem endpoint novo pra isso.

**Tech Stack:** NestJS + Postgres/RLS (backend, já em uso). Next.js 14 + React + Tailwind (frontend, já em uso) — sem lib de ícones nova, emoji.

**Spec:** [`docs/specs/fase-14-cipa-eleicao.md`](../specs/fase-14-cipa-eleicao.md)

## Global Constraints

- A votação em si nunca acontece dentro do sistema — só registro de candidatos e resultado já apurado fisicamente. Sem login de colaborador, nesta fase nem em nenhuma futura de CIPA (decisão fechada).
- Escopo raso: só candidatos + resultado final. Sem calendário guiado com etapas do processo legal, sem geração de ata em PDF.
- Uma eleição `aberta` por estabelecimento por vez — índice único parcial no banco como rede de segurança, checagem de aplicação (`FOR UPDATE`) como caminho principal de erro claro (409).
- Candidato é `employee_id` (FK pra `employees`, já existe) **ou** `nome_livre` — exatamente um dos dois, nunca os dois, nunca nenhum. Checagem manual no controller, mesmo padrão já usado em `MeetingsController.setParticipants`.
- `eleito = true` exige `titular_suplente` preenchido — validado tanto no PATCH do candidato quanto (defesa em profundidade) ao concluir a eleição.
- Concluir a eleição é irreversível nesta fase — sem rota de reabertura (diferente da ata, que tem `reabrir-ata`).
- `cipa_members.inicio_mandato`/`fim_mandato` são `NOT NULL` — a eleição captura essas datas na criação (`inicio_mandato`/`fim_mandato` da própria eleição) e repassa pros membros criados ao concluir.
- Sem test runner no frontend (`frontend/package.json` confirmado sem jest/vitest/testing-library) — verificação de frontend é manual, Playwright com sessão sintética via `localStorage` + `page.route()` mockando `/api/*`, contra a build de produção real (`docker compose build frontend`), mesmo padrão de toda fase anterior de CIPA. Backend tem suíte e2e real (`npm run test:e2e`, Postgres real, sem mock de banco) — toda mudança de backend precisa de teste e2e cobrindo.
- Rodar a suíte e2e completa via `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit"` (mecanismo já documentado e validado nas fases anteriores de CIPA — a imagem de produção do backend não tem devDependencies; `--forceExit` evita o container ficar pendurado depois que os testes terminam).

---

## Task 1: Migration — tabelas `cipa_elections` e `cipa_election_candidates`

**Files:**
- Create: `backend/db/migrations/0028_cipa_elections.sql`

**Interfaces:**
- Consumes: nada (primeira task da fase).
- Produces: tabelas `cipa_elections` (colunas: `id`, `tenant_id`, `company_unit_id`, `ano`, `data_eleicao`, `inicio_mandato`, `fim_mandato`, `status`, `created_at`, `updated_at`) e `cipa_election_candidates` (`id`, `election_id`, `employee_id`, `nome_livre`, `votos`, `eleito`, `titular_suplente`, `created_at`, `updated_at`), usadas por todas as tasks seguintes.

- [ ] **Step 1: Criar a migration**

Criar `backend/db/migrations/0028_cipa_elections.sql`:

```sql
-- Fase 14: eleição de representantes da CIPA. Duas tabelas: a eleição em
-- si (uma "aberta" por estabelecimento por vez) e os candidatos dela.
CREATE TABLE cipa_elections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  ano INT NOT NULL,
  data_eleicao DATE,
  -- cipa_members.inicio_mandato/fim_mandato são NOT NULL (Fase 12a) — a
  -- eleição captura o período do mandato aqui pra poder alimentar os
  -- membros ao concluir (ElectionsService.conclude). Mesmo padrão já
  -- usado em cipa_committees.
  inicio_mandato DATE NOT NULL,
  fim_mandato DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'concluida')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_cipa_elections_updated_at BEFORE UPDATE ON cipa_elections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Rede de segurança de banco pro invariante "uma eleição aberta por
-- estabelecimento" — a checagem de aplicação (FOR UPDATE em
-- company_units antes de checar isso) é o caminho principal de erro
-- claro (409), este índice é o backstop contra corrida de verdade,
-- mesmo raciocínio do índice único parcial de
-- 0025_cipa_meetings_unique_ordinaria.sql.
CREATE UNIQUE INDEX cipa_elections_one_open_per_unit
  ON cipa_elections (company_unit_id) WHERE status = 'aberta';

ALTER TABLE cipa_elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_elections FORCE ROW LEVEL SECURITY;
-- Mesma política de cipa_meetings_isolation (0023_cipa_nucleo.sql) —
-- esta tabela tem tenant_id direto, igual cipa_meetings.
CREATE POLICY cipa_elections_isolation ON cipa_elections USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_elections.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_elections.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

CREATE TABLE cipa_election_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID NOT NULL REFERENCES cipa_elections(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  nome_livre TEXT,
  votos INT,
  eleito BOOLEAN NOT NULL DEFAULT false,
  titular_suplente TEXT CHECK (titular_suplente IN ('titular', 'suplente')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Backstop de banco — a checagem real acontece no controller
  -- (ElectionsController.addCandidate), mesmo padrão de
  -- cipa_meeting_participants (0023_cipa_nucleo.sql).
  CONSTRAINT chk_candidate_source CHECK (
    (employee_id IS NOT NULL AND nome_livre IS NULL)
    OR (employee_id IS NULL AND nome_livre IS NOT NULL)
  )
);
CREATE TRIGGER trg_cipa_election_candidates_updated_at BEFORE UPDATE ON cipa_election_candidates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX cipa_election_candidates_election_idx ON cipa_election_candidates (election_id);

ALTER TABLE cipa_election_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_election_candidates FORCE ROW LEVEL SECURITY;
-- Mesmo padrão de cipa_meeting_participants — esta tabela não tem
-- tenant_id próprio, isolamento via EXISTS contra cipa_elections.
CREATE POLICY cipa_election_candidates_isolation ON cipa_election_candidates USING (
  EXISTS (SELECT 1 FROM cipa_elections e WHERE e.id = cipa_election_candidates.election_id)
);
```

- [ ] **Step 2: Aplicar a migration e verificar**

Run: `docker compose exec backend npm run db:migrate` (o runner real do projeto, `backend/db/migrate.ts`).

Expected: saída incluindo `[apply] 0028_cipa_elections.sql` e `[ok] 0028_cipa_elections.sql`, sem erro. Confirmar com:
```sql
\d cipa_elections
\d cipa_election_candidates
SELECT polname FROM pg_policies WHERE tablename IN ('cipa_elections', 'cipa_election_candidates');
SELECT indexname FROM pg_indexes WHERE tablename = 'cipa_elections';
```
que as duas tabelas, as 2 políticas e o índice único parcial existem como esperado.

- [ ] **Step 3: Commit**

```bash
git add backend/db/migrations/0028_cipa_elections.sql
git commit -m "feat: migration das tabelas cipa_elections e cipa_election_candidates (Fase 14)"
```

---

## Task 2: Backend — `ElectionsService`/`ElectionsController`

**Files:**
- Create: `backend/src/cipa/elections.service.ts`
- Create: `backend/src/cipa/elections.controller.ts`
- Create: `backend/src/cipa/dto/create-election.dto.ts`
- Create: `backend/src/cipa/dto/create-candidate.dto.ts`
- Create: `backend/src/cipa/dto/update-candidate.dto.ts`
- Modify: `backend/src/cipa/cipa.module.ts`
- Create: `backend/test/cipa-elections.e2e-spec.ts`

**Interfaces:**
- Consumes: tabelas `cipa_elections`/`cipa_election_candidates` (Task 1); `mapPgError` (`backend/src/common/pg-error.util.ts`, já existe); `toDateString` (`backend/src/cipa/committees.service.ts`, já existe, já exportada pra reuso); `assertUserInTenant` não é necessária aqui (eleição não tem `responsavel_user_id`).
- Produces: endpoints `POST /cipa/elections`, `GET /cipa/elections`, `GET /cipa/elections/:id`, `GET /cipa/elections/:id/candidates`, `POST /cipa/elections/:id/candidates`, `PATCH /cipa/elections/:id/candidates/:candidateId`, `POST /cipa/elections/:id/concluir` — usados pelo frontend (Task 3).

- [ ] **Step 1: DTOs**

Criar `backend/src/cipa/dto/create-election.dto.ts`:

```ts
import { IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateElectionDto {
  @IsUUID()
  company_unit_id: string;

  @Type(() => Number)
  @IsInt()
  @Min(2020)
  @Max(2100)
  ano: number;

  @IsOptional()
  @IsISO8601()
  data_eleicao?: string;

  @IsISO8601()
  inicio_mandato: string;

  @IsISO8601()
  fim_mandato: string;
}
```

Criar `backend/src/cipa/dto/create-candidate.dto.ts`:

```ts
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateCandidateDto {
  @IsOptional()
  @IsUUID()
  employee_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nome_livre?: string;
}
```

Criar `backend/src/cipa/dto/update-candidate.dto.ts`:

```ts
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateCandidateDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  votos?: number;

  @IsOptional()
  @IsBoolean()
  eleito?: boolean;

  @IsOptional()
  @IsIn(['titular', 'suplente'])
  titular_suplente?: string;
}
```

- [ ] **Step 2: `ElectionsService`**

Criar `backend/src/cipa/elections.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { toDateString } from './committees.service';

export interface CipaElection {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  ano: number;
  data_eleicao: string | null;
  inicio_mandato: string;
  fim_mandato: string;
  status: 'aberta' | 'concluida';
  created_at: string;
  updated_at: string;
}

export interface CipaElectionCandidate {
  id: string;
  election_id: string;
  employee_id: string | null;
  nome_livre: string | null;
  votos: number | null;
  eleito: boolean;
  titular_suplente: 'titular' | 'suplente' | null;
  created_at: string;
  updated_at: string;
}

function normalizeElection(row: CipaElection): CipaElection {
  return {
    ...row,
    data_eleicao: toDateString(row.data_eleicao),
    inicio_mandato: toDateString(row.inicio_mandato) as string,
    fim_mandato: toDateString(row.fim_mandato) as string,
  };
}

@Injectable()
export class ElectionsService {
  async create(
    client: PoolClient,
    tenantId: string,
    companyUnitId: string,
    ano: number,
    dataEleicao: string | undefined,
    inicioMandato: string,
    fimMandato: string,
  ): Promise<CipaElection> {
    // FOR UPDATE em company_units — serializa duas criações quase
    // simultâneas pro mesmo estabelecimento, mesmo raciocínio de
    // AtaAiService.createDraft (Fase 13): sem isso, duas requisições
    // concorrentes passam as duas pela checagem de "já existe eleição
    // aberta" antes de qualquer uma comitar. O índice único parcial
    // (0028_cipa_elections.sql) é o backstop de banco.
    const unitCheck = await client.query('SELECT 1 FROM company_units WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [
      companyUnitId,
      tenantId,
    ]);
    if (unitCheck.rowCount === 0) {
      throw new BadRequestException('Estabelecimento inválido para esta empresa');
    }

    const openCheck = await client.query(
      `SELECT 1 FROM cipa_elections WHERE company_unit_id = $1 AND status = 'aberta'`,
      [companyUnitId],
    );
    if ((openCheck.rowCount ?? 0) > 0) {
      throw new ConflictException('Já existe uma eleição aberta para este estabelecimento');
    }

    try {
      const result = await client.query<CipaElection>(
        `INSERT INTO cipa_elections (tenant_id, company_unit_id, ano, data_eleicao, inicio_mandato, fim_mandato)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [tenantId, companyUnitId, ano, dataEleicao ?? null, inicioMandato, fimMandato],
      );
      return normalizeElection(result.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(client: PoolClient, companyUnitId?: string): Promise<CipaElection[]> {
    if (companyUnitId) {
      const result = await client.query<CipaElection>(
        'SELECT * FROM cipa_elections WHERE company_unit_id = $1 ORDER BY created_at DESC',
        [companyUnitId],
      );
      return result.rows.map(normalizeElection);
    }
    const result = await client.query<CipaElection>('SELECT * FROM cipa_elections ORDER BY created_at DESC');
    return result.rows.map(normalizeElection);
  }

  async findOne(client: PoolClient, id: string): Promise<CipaElection> {
    const result = await client.query<CipaElection>('SELECT * FROM cipa_elections WHERE id = $1', [id]);
    const election = result.rows[0];
    if (!election) throw new NotFoundException('Eleição não encontrada');
    return normalizeElection(election);
  }

  async findCandidates(client: PoolClient, electionId: string): Promise<CipaElectionCandidate[]> {
    const result = await client.query<CipaElectionCandidate>(
      'SELECT * FROM cipa_election_candidates WHERE election_id = $1 ORDER BY created_at',
      [electionId],
    );
    return result.rows;
  }

  async addCandidate(
    client: PoolClient,
    electionId: string,
    employeeId: string | undefined,
    nomeLivre: string | undefined,
  ): Promise<CipaElectionCandidate> {
    const electionResult = await client.query<{ status: string }>(
      'SELECT status FROM cipa_elections WHERE id = $1',
      [electionId],
    );
    const election = electionResult.rows[0];
    if (!election) throw new NotFoundException('Eleição não encontrada');
    if (election.status === 'concluida') {
      throw new ConflictException('Eleição já concluída — não é possível adicionar candidato');
    }

    try {
      const result = await client.query<CipaElectionCandidate>(
        `INSERT INTO cipa_election_candidates (election_id, employee_id, nome_livre)
         VALUES ($1, $2, $3) RETURNING *`,
        [electionId, employeeId ?? null, nomeLivre ?? null],
      );
      return result.rows[0];
    } catch (err) {
      mapPgError(err);
    }
  }

  async updateCandidate(
    client: PoolClient,
    electionId: string,
    candidateId: string,
    data: { votos?: number; eleito?: boolean; titular_suplente?: string },
  ): Promise<CipaElectionCandidate> {
    const electionResult = await client.query<{ status: string }>(
      'SELECT status FROM cipa_elections WHERE id = $1',
      [electionId],
    );
    const election = electionResult.rows[0];
    if (!election) throw new NotFoundException('Eleição não encontrada');
    if (election.status === 'concluida') {
      throw new ConflictException('Eleição já concluída — não é possível editar candidato');
    }

    const currentResult = await client.query<CipaElectionCandidate>(
      'SELECT * FROM cipa_election_candidates WHERE id = $1 AND election_id = $2 FOR UPDATE',
      [candidateId, electionId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new NotFoundException('Candidato não encontrado');

    // Estado final calculado ANTES de gravar — cobre tanto "manda eleito
    // e titular_suplente juntos" quanto "titular_suplente já estava
    // setado de um PATCH anterior, manda só eleito: true agora".
    // Desmarcar eleito (eleito: false) sempre limpa titular_suplente —
    // não deixa um candidato não-eleito com titular_suplente "fantasma"
    // de antes.
    const finalEleito = data.eleito ?? current.eleito;
    const finalTitularSuplente = data.eleito === false ? null : data.titular_suplente ?? current.titular_suplente;
    if (finalEleito && !finalTitularSuplente) {
      throw new BadRequestException('Candidato eleito precisa de titular_suplente definido');
    }

    // Lista dinâmica de SET — mesmo padrão de MembersService.update, em
    // vez de COALESCE com parâmetro possivelmente `undefined` (o driver
    // `pg` não tem uma conversão undefined→NULL garantida/documentada
    // pra parâmetros de query — mais seguro só incluir no SET o que
    // veio de fato no payload).
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 3;
    if (data.votos !== undefined) {
      setClauses.push(`votos = $${i++}`);
      values.push(data.votos);
    }
    if (data.eleito !== undefined) {
      setClauses.push(`eleito = $${i++}`);
      values.push(data.eleito);
    }
    // titular_suplente grava o valor final calculado acima sempre que
    // `eleito` OU `titular_suplente` vierem no payload — inclusive pra
    // limpar (NULL) quando só `eleito: false` é enviado.
    if (data.eleito !== undefined || data.titular_suplente !== undefined) {
      setClauses.push(`titular_suplente = $${i++}`);
      values.push(finalTitularSuplente);
    }

    if (setClauses.length === 0) {
      return current;
    }

    try {
      const result = await client.query<CipaElectionCandidate>(
        `UPDATE cipa_election_candidates SET ${setClauses.join(', ')} WHERE id = $1 AND election_id = $2 RETURNING *`,
        [candidateId, electionId, ...values],
      );
      return result.rows[0];
    } catch (err) {
      mapPgError(err);
    }
  }

  async conclude(client: PoolClient, electionId: string): Promise<CipaElection> {
    const electionResult = await client.query<CipaElection>(
      'SELECT * FROM cipa_elections WHERE id = $1 FOR UPDATE',
      [electionId],
    );
    const electionRow = electionResult.rows[0];
    if (!electionRow) throw new NotFoundException('Eleição não encontrada');
    if (electionRow.status === 'concluida') {
      throw new ConflictException('Eleição já concluída');
    }
    const election = normalizeElection(electionRow);

    // Defesa em profundidade — updateCandidate já garante isso a cada
    // PATCH, mas concluir não confia cegamente num estado que pode ter
    // sido montado por chamadas fora de ordem.
    const invalidCheck = await client.query(
      `SELECT 1 FROM cipa_election_candidates WHERE election_id = $1 AND eleito = true AND titular_suplente IS NULL LIMIT 1`,
      [electionId],
    );
    if ((invalidCheck.rowCount ?? 0) > 0) {
      throw new BadRequestException('Há candidato eleito sem titular_suplente definido');
    }

    try {
      await client.query(`UPDATE cipa_elections SET status = 'concluida' WHERE id = $1`, [electionId]);
      // INSERT...SELECT único cobre os dois casos de origem do
      // candidato (employee_id ou nome_livre) via COALESCE/LEFT JOIN —
      // sem N+1 de queries pra cada eleito.
      await client.query(
        `INSERT INTO cipa_members (tenant_id, company_unit_id, nome, funcao_cipa, titular_suplente, representacao, inicio_mandato, fim_mandato)
         SELECT $2, $3, COALESCE(emp.full_name, c.nome_livre), 'membro', c.titular_suplente, 'empregados', $4, $5
         FROM cipa_election_candidates c
         LEFT JOIN employees emp ON emp.id = c.employee_id
         WHERE c.election_id = $1 AND c.eleito = true`,
        [electionId, election.tenant_id, election.company_unit_id, election.inicio_mandato, election.fim_mandato],
      );
    } catch (err) {
      mapPgError(err);
    }

    return this.findOne(client, electionId);
  }
}
```

- [ ] **Step 3: `ElectionsController`**

Criar `backend/src/cipa/elections.controller.ts`:

```ts
import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { ElectionsService } from './elections.service';
import { CreateElectionDto } from './dto/create-election.dto';
import { CreateCandidateDto } from './dto/create-candidate.dto';
import { UpdateCandidateDto } from './dto/update-candidate.dto';

@Controller('cipa/elections')
export class ElectionsController {
  constructor(private readonly elections: ElectionsService) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateElectionDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.elections.create(
        client,
        req.user.tenantId,
        dto.company_unit_id,
        dto.ano,
        dto.data_eleicao,
        dto.inicio_mandato,
        dto.fim_mandato,
      ),
    );
  }

  @Get()
  findAll(@Query('company_unit_id') companyUnitId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.elections.findAll(client, companyUnitId));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.elections.findOne(client, id));
  }

  @Get(':id/candidates')
  findCandidates(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.elections.findCandidates(client, id));
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/candidates')
  addCandidate(@Param('id') id: string, @Body() dto: CreateCandidateDto, @Req() req: any) {
    // Mesma checagem manual de MeetingsController.setParticipants —
    // exatamente um entre employee_id e nome_livre.
    if ((!dto.employee_id && !dto.nome_livre) || (dto.employee_id && dto.nome_livre)) {
      throw new BadRequestException('Cada candidato precisa de exatamente um entre employee_id e nome_livre');
    }
    return req.withTenantContext((client: any) =>
      this.elections.addCandidate(client, id, dto.employee_id, dto.nome_livre),
    );
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id/candidates/:candidateId')
  updateCandidate(
    @Param('id') id: string,
    @Param('candidateId') candidateId: string,
    @Body() dto: UpdateCandidateDto,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) => this.elections.updateCandidate(client, id, candidateId, dto));
  }

  @Roles('empresa')
  @Post(':id/concluir')
  conclude(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.elections.conclude(client, id));
  }
}
```

- [ ] **Step 4: Wiring em `CipaModule`**

Modificar `backend/src/cipa/cipa.module.ts` — adicionar `ElectionsController`/`ElectionsService` aos arrays existentes (junto de `CommitteesController`/`MeetingsController`/etc., sem tocar no que já existe do módulo de IA da Fase 13):

```ts
import { ElectionsController } from './elections.controller';
import { ElectionsService } from './elections.service';
```

E adicionar `ElectionsController` ao array `controllers: [...]` e `ElectionsService` ao array `providers: [...]` já existentes no `@Module({...})`.

- [ ] **Step 5: Testes e2e**

Criar `backend/test/cipa-elections.e2e-spec.ts` (mesmo padrão de fixture setup de `cipa-ata-approval.e2e-spec.ts`: `db.createTenantWithUser`, INSERT direto de `company_units`, login real via `/auth/login`):

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CIPA elections (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let companyUnitId: string;
  let employeeId: string;
  let empresaToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA Eleição Teste');
    tenantId = tenant.tenantId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const employeeResult = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status)
       VALUES ($1, 'Fulano Candidato Teste', '11122233344', 'ativo') RETURNING id`,
      [tenantId],
    );
    employeeId = employeeResult.rows[0].id;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM company_units WHERE id = $1', [companyUnitId]);
    await (db as any).client.query('DELETE FROM employees WHERE id = $1', [employeeId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('cria eleição, rejeita segunda eleição aberta pro mesmo estabelecimento com 409', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/cipa/elections')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        ano: 2026,
        inicio_mandato: '2026-06-01',
        fim_mandato: '2027-05-31',
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe('aberta');
    const electionId = createRes.body.id;

    const duplicateRes = await request(app.getHttpServer())
      .post('/cipa/elections')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        ano: 2026,
        inicio_mandato: '2026-06-01',
        fim_mandato: '2027-05-31',
      });
    expect(duplicateRes.status).toBe(409);

    await (db as any).client.query('DELETE FROM cipa_elections WHERE id = $1', [electionId]);
  });

  it('fluxo completo: candidato vinculado + nome livre, rejeita ambos/nenhum, vota, conclui e cria os membros', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/cipa/elections')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        ano: 2026,
        data_eleicao: '2026-05-10',
        inicio_mandato: '2026-06-01',
        fim_mandato: '2027-05-31',
      });
    const electionId = createRes.body.id;

    const rejectBothRes = await request(app.getHttpServer())
      .post(`/cipa/elections/${electionId}/candidates`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ employee_id: employeeId, nome_livre: 'Não pode os dois' });
    expect(rejectBothRes.status).toBe(400);

    const rejectNeitherRes = await request(app.getHttpServer())
      .post(`/cipa/elections/${electionId}/candidates`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({});
    expect(rejectNeitherRes.status).toBe(400);

    const candidate1Res = await request(app.getHttpServer())
      .post(`/cipa/elections/${electionId}/candidates`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ employee_id: employeeId });
    expect(candidate1Res.status).toBe(201);
    const candidate1Id = candidate1Res.body.id;

    const candidate2Res = await request(app.getHttpServer())
      .post(`/cipa/elections/${electionId}/candidates`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ nome_livre: 'Beltrano Candidato Nome Livre' });
    expect(candidate2Res.status).toBe(201);
    const candidate2Id = candidate2Res.body.id;

    const eleitoSemTitularRes = await request(app.getHttpServer())
      .patch(`/cipa/elections/${electionId}/candidates/${candidate1Id}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ votos: 42, eleito: true });
    expect(eleitoSemTitularRes.status).toBe(400);

    const updateCandidate1Res = await request(app.getHttpServer())
      .patch(`/cipa/elections/${electionId}/candidates/${candidate1Id}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ votos: 42, eleito: true, titular_suplente: 'titular' });
    expect(updateCandidate1Res.status).toBe(200);
    expect(updateCandidate1Res.body.eleito).toBe(true);
    expect(updateCandidate1Res.body.titular_suplente).toBe('titular');

    const updateCandidate2Res = await request(app.getHttpServer())
      .patch(`/cipa/elections/${electionId}/candidates/${candidate2Id}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ votos: 10, eleito: false });
    expect(updateCandidate2Res.status).toBe(200);
    expect(updateCandidate2Res.body.eleito).toBe(false);

    const concludeRes = await request(app.getHttpServer())
      .post(`/cipa/elections/${electionId}/concluir`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(concludeRes.status).toBe(201);
    expect(concludeRes.body.status).toBe('concluida');

    const membersRes = await request(app.getHttpServer())
      .get('/cipa/members')
      .query({ company_unit_id: companyUnitId })
      .set('Authorization', `Bearer ${empresaToken}`);
    const createdMember = membersRes.body.find((m: any) => m.nome === 'Fulano Candidato Teste');
    expect(createdMember).toBeDefined();
    expect(createdMember.representacao).toBe('empregados');
    expect(createdMember.titular_suplente).toBe('titular');
    expect(createdMember.inicio_mandato).toBe('2026-06-01');
    expect(createdMember.fim_mandato).toBe('2027-05-31');
    const notElectedMember = membersRes.body.find((m: any) => m.nome === 'Beltrano Candidato Nome Livre');
    expect(notElectedMember).toBeUndefined();

    const addAfterConcludeRes = await request(app.getHttpServer())
      .post(`/cipa/elections/${electionId}/candidates`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ nome_livre: 'Tarde Demais' });
    expect(addAfterConcludeRes.status).toBe(409);

    const concludeAgainRes = await request(app.getHttpServer())
      .post(`/cipa/elections/${electionId}/concluir`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(concludeAgainRes.status).toBe(409);

    await (db as any).client.query('DELETE FROM cipa_members WHERE company_unit_id = $1', [companyUnitId]);
    await (db as any).client.query('DELETE FROM cipa_elections WHERE id = $1', [electionId]);
  });
});
```

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- cipa-elections"` (mesmo mecanismo já validado nas fases anteriores — ver Global Constraints).

Expected: todos os testes passam.

- [ ] **Step 6: Verificar manualmente — build + suíte completa**

Run: `docker compose build backend` — confirmar zero erros de TypeScript.

Run a suíte completa uma vez (ver Global Constraints pro comando exato) e confirmar que nada mais quebrou — as fases anteriores de CIPA já deixaram documentado que o rate limit da rota de áudio da Fase 13 é a única pegadinha conhecida de rodar a suíte mais de uma vez no mesmo dia; esta task não mexe em nenhuma rota com rate limit dedicado, então não deveria ter esse problema.

- [ ] **Step 7: Commit**

```bash
git add backend/src/cipa/elections.service.ts backend/src/cipa/elections.controller.ts backend/src/cipa/dto/create-election.dto.ts backend/src/cipa/dto/create-candidate.dto.ts backend/src/cipa/dto/update-candidate.dto.ts backend/src/cipa/cipa.module.ts backend/test/cipa-elections.e2e-spec.ts
git commit -m "feat: CRUD de eleição da CIPA — candidatos, resultado, conclusão alimenta membros"
```

---

## Task 3: Frontend — sidebar + página de eleição

**Files:**
- Modify: `frontend/src/lib/cipa-types.ts`
- Modify: `frontend/src/components/EmpresaSidebar.tsx`
- Create: `frontend/src/app/empresa/cipa/eleicao/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/cipa/elections`, `GET /api/cipa/elections/:id/candidates`, `POST /api/cipa/elections/:id/candidates`, `PATCH /api/cipa/elections/:id/candidates/:candidateId`, `POST /api/cipa/elections/:id/concluir` (Task 2); `GET /api/employees?tenant_id=` (já existe, usado pelo seletor de candidato); `getToken`/`getUser` (`@/lib/auth`); `getSelectedCompanyUnitId` (`@/lib/cipa-types`, já existe).
- Produces: nada consumido por task seguinte (última task da fase).

- [ ] **Step 1: Tipos**

Modificar `frontend/src/lib/cipa-types.ts` — adicionar depois da interface `CipaMeetingAtaDraft`:

```ts
export interface CipaElection {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  ano: number;
  data_eleicao: string | null;
  inicio_mandato: string;
  fim_mandato: string;
  status: 'aberta' | 'concluida';
  created_at: string;
  updated_at: string;
}

export interface CipaElectionCandidate {
  id: string;
  election_id: string;
  employee_id: string | null;
  nome_livre: string | null;
  votos: number | null;
  eleito: boolean;
  titular_suplente: 'titular' | 'suplente' | null;
}

export interface Employee {
  id: string;
  full_name: string;
  status: 'ativo' | 'inativo';
}
```

- [ ] **Step 2: Link novo na sidebar**

Modificar `frontend/src/components/EmpresaSidebar.tsx` — no grupo `CIPA` já existente, inserir um item entre "Membros" e "Pendências":

```tsx
      { href: '/empresa/cipa/eleicao', label: 'Eleição', emoji: '🗳️' },
```

(Grupo `CIPA` fica: Central da CIPA, Reuniões, Membros, **Eleição**, Pendências — inserção de uma linha no array `links` já existente, não uma reescrita do componente.)

- [ ] **Step 3: Página de eleição**

Criar `frontend/src/app/empresa/cipa/eleicao/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getUser } from '@/lib/auth';
import {
  CipaElection,
  CipaElectionCandidate,
  Employee,
  formatDateBR,
  getSelectedCompanyUnitId,
} from '@/lib/cipa-types';

export default function EleicaoPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [election, setElection] = useState<CipaElection | null>(null);
  const [candidates, setCandidates] = useState<CipaElectionCandidate[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [ano, setAno] = useState(new Date().getFullYear());
  const [dataEleicao, setDataEleicao] = useState('');
  const [inicioMandato, setInicioMandato] = useState('');
  const [fimMandato, setFimMandato] = useState('');

  const [novoEmployeeId, setNovoEmployeeId] = useState('');
  const [novoNomeLivre, setNovoNomeLivre] = useState('');

  async function load() {
    const token = getToken();
    const user = getUser();
    const unitId = getSelectedCompanyUnitId();
    if (!token || !user) {
      router.push('/login');
      return;
    }
    if (!unitId) {
      setReady(true);
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    const elections: CipaElection[] = await fetch(`/api/cipa/elections?company_unit_id=${unitId}`, {
      headers,
    }).then((r) => (r.ok ? r.json() : []));
    // Mais recente primeiro (já vem ordenado por created_at DESC do
    // backend) — pega a aberta se existir, senão a mais recente
    // concluída (histórico), senão nenhuma.
    const current = elections.find((e) => e.status === 'aberta') ?? elections[0] ?? null;
    setElection(current);

    if (current) {
      const candidatesData: CipaElectionCandidate[] = await fetch(
        `/api/cipa/elections/${current.id}/candidates`,
        { headers },
      ).then((r) => (r.ok ? r.json() : []));
      setCandidates(candidatesData);
    }

    const employeesData: Employee[] = await fetch(`/api/employees?tenant_id=${user.tenantId}`, { headers }).then(
      (r) => (r.ok ? r.json() : []),
    );
    setEmployees(employeesData.filter((e) => e.status === 'ativo'));

    setReady(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createElection(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const token = getToken();
    const unitId = getSelectedCompanyUnitId();
    try {
      const res = await fetch('/api/cipa/elections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          company_unit_id: unitId,
          ano,
          data_eleicao: dataEleicao || undefined,
          inicio_mandato: inicioMandato,
          fim_mandato: fimMandato,
        }),
      });
      if (!res.ok) {
        setError('Não foi possível criar a eleição. Confira as datas informadas.');
        return;
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function addCandidate() {
    if (!election) return;
    setError(null);
    const token = getToken();
    const res = await fetch(`/api/cipa/elections/${election.id}/candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(
        novoEmployeeId ? { employee_id: novoEmployeeId } : { nome_livre: novoNomeLivre },
      ),
    });
    if (res.ok) {
      setNovoEmployeeId('');
      setNovoNomeLivre('');
      await load();
    } else {
      setError('Não foi possível adicionar o candidato.');
    }
  }

  async function updateCandidate(candidateId: string, data: Record<string, unknown>) {
    if (!election) return;
    setError(null);
    const token = getToken();
    const res = await fetch(`/api/cipa/elections/${election.id}/candidates/${candidateId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      await load();
    } else {
      setError('Não foi possível salvar. Candidato eleito precisa de titular/suplente definido.');
    }
  }

  async function concludeElection() {
    if (!election) return;
    if (!confirm('Concluir esta eleição? Os candidatos marcados como eleitos serão adicionados aos membros da CIPA. Esta ação não pode ser desfeita.')) {
      return;
    }
    setError(null);
    setSaving(true);
    const token = getToken();
    try {
      const res = await fetch(`/api/cipa/elections/${election.id}/concluir`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError('Não foi possível concluir a eleição.');
        return;
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (!ready) {
    return <div className="px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  const isAberta = election?.status === 'aberta';

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">🗳️ Eleição da CIPA</h1>
      <p className="mt-1 text-sm text-brand-700">
        Candidatos e resultado da eleição de representantes dos empregados. A votação em si continua física — o
        sistema só registra o que já foi apurado.
      </p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {!election && (
        <form onSubmit={createElection} className="mt-6 flex flex-col gap-4 rounded-lg border border-brand-100 p-4">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Ano
            <input
              type="number"
              required
              value={ano}
              onChange={(e) => setAno(Number(e.target.value))}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Data da votação (opcional)
            <input
              type="date"
              value={dataEleicao}
              onChange={(e) => setDataEleicao(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Início do mandato
            <input
              type="date"
              required
              value={inicioMandato}
              onChange={(e) => setInicioMandato(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Fim do mandato
            <input
              type="date"
              required
              value={fimMandato}
              onChange={(e) => setFimMandato(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="self-start rounded-[9px] bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Criando...' : 'Criar eleição'}
          </button>
        </form>
      )}

      {election && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-brand-700">
              Eleição {election.ano} — mandato de {formatDateBR(election.inicio_mandato)} a{' '}
              {formatDateBR(election.fim_mandato)}
            </p>
            <span
              className={
                isAberta
                  ? 'rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700'
                  : 'rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800'
              }
            >
              {isAberta ? '📝 Aberta' : '✅ Concluída'}
            </span>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {candidates.map((c) => (
              <div key={c.id} className="rounded-md border border-brand-100 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-medium text-brand-900">
                    {c.employee_id ? employees.find((e) => e.id === c.employee_id)?.full_name ?? 'Funcionário' : c.nome_livre}
                  </p>
                  {isAberta ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        placeholder="Votos"
                        value={c.votos ?? ''}
                        onChange={(e) => updateCandidate(c.id, { votos: Number(e.target.value) })}
                        className="w-20 rounded-[9px] border-[1.5px] border-brand-100 px-2 py-1 text-sm"
                      />
                      <select
                        value={c.eleito ? c.titular_suplente ?? '' : ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (!value) {
                            updateCandidate(c.id, { eleito: false });
                          } else {
                            updateCandidate(c.id, { eleito: true, titular_suplente: value });
                          }
                        }}
                        className="rounded-[9px] border-[1.5px] border-brand-100 px-2 py-1 text-sm"
                      >
                        <option value="">Não eleito</option>
                        <option value="titular">Eleito — titular</option>
                        <option value="suplente">Eleito — suplente</option>
                      </select>
                    </div>
                  ) : (
                    <p className="text-xs text-brand-700">
                      {c.votos ?? 0} votos
                      {c.eleito ? ` · Eleito (${c.titular_suplente})` : ''}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {candidates.length === 0 && <p className="text-sm text-brand-700">Nenhum candidato cadastrado ainda.</p>}
          </div>

          {isAberta && (
            <>
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm text-brand-900">
                  Funcionário cadastrado
                  <select
                    value={novoEmployeeId}
                    onChange={(e) => {
                      setNovoEmployeeId(e.target.value);
                      setNovoNomeLivre('');
                    }}
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
                <span className="pb-2 text-sm text-brand-700">ou</span>
                <label className="flex flex-col gap-1 text-sm text-brand-900">
                  Nome livre
                  <input
                    type="text"
                    value={novoNomeLivre}
                    onChange={(e) => {
                      setNovoNomeLivre(e.target.value);
                      setNovoEmployeeId('');
                    }}
                    className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
                  />
                </label>
                <button
                  onClick={addCandidate}
                  disabled={!novoEmployeeId && !novoNomeLivre}
                  className="rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  Adicionar candidato
                </button>
              </div>

              <button
                onClick={concludeElection}
                disabled={saving || candidates.length === 0}
                className="mt-8 rounded-[9px] bg-green-600 px-6 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                ✅ Concluir eleição
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verificar manualmente no navegador**

Mesmo método de toda fase anterior de CIPA — `docker compose build frontend`, Playwright com sessão sintética via `localStorage` e `page.route()` mockando `/api/*` (incluindo `/api/company-units` e `/api/employees`), contra a build de produção real. Cobrir:

1. Sem eleição (`GET /api/cipa/elections?company_unit_id=` mockado como `[]`): formulário de criação aparece.
2. Criar eleição (mock do `POST` devolvendo `{status: 'aberta', ...}`, seguido de `load()` mockando a mesma eleição): formulário some, tela de candidatos aparece vazia.
3. Adicionar candidato por funcionário cadastrado e por nome livre (mock do `POST /candidates` + reload da lista): os dois aparecem corretamente identificados (nome do funcionário resolvido via `employees`, nome livre direto).
4. Marcar um candidato como eleito titular via o seletor: `PATCH` disparado com `{eleito: true, titular_suplente: 'titular'}`. Marcar outro como "Não eleito" depois de já ter sido eleito: `PATCH` disparado com `{eleito: false}` (sem `titular_suplente`, confirma que o frontend não manda o campo obsoleto).
5. Clicar "Concluir eleição", confirmar o diálogo, mockar o `POST /concluir` devolvendo `{status: 'concluida'}`: tela vira somente-leitura (sem inputs de voto/seletor, sem formulário de adicionar candidato, sem botão de concluir).
6. Reabrir a página com uma eleição já `concluida` mockada desde o primeiro load: mesma tela somente-leitura aparece direto, sem precisar concluir de novo.

Rodar `docker compose build frontend` e confirmar zero erros de TypeScript/lint antes de considerar a task pronta.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/cipa-types.ts frontend/src/components/EmpresaSidebar.tsx frontend/src/app/empresa/cipa/eleicao
git commit -m "feat: tela de eleição da CIPA — candidatos, resultado, conclusão"
```

---

## Depois da última task

1. Rodar a suíte e2e completa do backend (`npm run test:e2e` via o mecanismo documentado nas Global Constraints) e confirmar que nada quebrou nas suítes já existentes.
2. Rodar `docker compose build backend && docker compose build frontend` (build completa, ambos) e confirmar zero erros.
3. Passada visual final ponta a ponta: criar eleição → adicionar 2-3 candidatos (misturando funcionário cadastrado e nome livre) → registrar votos e marcar eleitos → concluir → confirmar na tela de Membros (já existente) que os eleitos aparecem corretamente, com mandato/representação/titular-suplente certos.
4. Seguir com `superpowers:finishing-a-development-branch` (branch é `main` direto, sem remote — só confirmar e reportar, mesmo padrão de toda fase anterior deste projeto).
5. Atualizar `docs/roadmap.md` fechando o status da Fase 14, mesmo formato das fases anteriores.
6. Próximas frentes da CIPA, na ordem já acordada (`docs/specs/fase-12-central-cipa-nucleo.md` §1): treinamentos/DDS/SIPAT → reconhecimento/gamificação → consulta de CA/documentos técnicos → card da CIPA no dashboard principal. Nenhuma tem spec escrita ainda — cada uma passa por brainstorming próprio antes de qualquer plano.
