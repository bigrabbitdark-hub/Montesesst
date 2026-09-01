# Fase 12a — Central da CIPA (núcleo): Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** API completa do núcleo da CIPA — gerador de calendário, reuniões com ata estruturada e fluxo de aprovação (incluindo exportação em PDF), membros e pendências.

**Architecture:** Módulo novo `backend/src/cipa/` com 4 sub-recursos (committees, meetings, members, pendencias), cada um com seu próprio controller/service/DTOs dentro do mesmo `CipaModule`, seguindo exatamente o padrão de `req.withTenantContext(...)`/`@Roles(...)`/`ValidationPipe` já usado em `inspections`/`visits`. Uma migration só cobre as 5 tabelas novas + extensão do `documents`.

**Tech Stack:** NestJS + Postgres (RLS) + `pg` + `class-validator` + `pdfkit` (novo — geração de PDF real da ata, nenhuma lib de geração de PDF existe no projeto hoje, só `pdf-parse` pra leitura). Testes: Jest e2e contra Postgres real.

**Spec:** [`docs/specs/fase-12-central-cipa-nucleo.md`](../specs/fase-12-central-cipa-nucleo.md)

**Nota de escopo:** esta é só a metade backend da Fase 12. O frontend (sidebar, wizard, páginas de reunião/ata, dashboard da CIPA) é um plano separado (`fase-12b-central-cipa-frontend.md`), escrito só depois desta metade estar implantada — evita especificar UI contra uma API que ainda pode mudar durante a revisão do SDD.

## Global Constraints

- Todas as tabelas `cipa_*` guardam `tenant_id` **e** `company_unit_id` — `tenant_id` pro padrão de RLS (cópia exata de `backend/db/migrations/0011_partner_access.sql`), `company_unit_id` pro filtro real de "uma CIPA por estabelecimento".
- Mutação de qualquer recurso CIPA é `@Roles('empresa')`. Leitura (`GET`) fica sem `@Roles` — RLS decide (empresa vê o próprio tenant; técnico/parceiro vinculados veem, mas não escrevem — sem `@Roles` nos endpoints de mutação pra esses dois papéis).
- Toda transição de estado usa `SELECT ... FOR UPDATE` antes de checar o estado, mesmo padrão de `InspectionsService.assertDraft`/`VisitsService.findAndLock` (Fase 11).
- Ordem de criação das tabelas na migration importa por causa de FK: `cipa_committees` → `cipa_meetings` → `cipa_members` → `cipa_meeting_participants` (depende de `cipa_meetings` E `cipa_members`) → `cipa_pendencias`.
- "Plano de Ação" e "Pendências da CIPA" são a mesma tabela (`cipa_pendencias`, `meeting_id` nulável).
- Documentos da CIPA reaproveitam a tabela `documents` já existente — só ganham categorias novas no `CHECK` (`documents_category_check`, nome real confirmado no banco) **e** no array `ALLOWED_CATEGORIES` de `backend/src/documents/documents.service.ts` (validação de aplicação, separada do `CHECK` do banco — as duas precisam mudar, não só uma).
- Ata só é editável enquanto `status_ata = 'rascunho'`. Aprovar grava `aprovado_por_user_id`/`aprovado_em`, trava edição, e gera um PDF real salvo via `DocumentsService.upload()` já existente (`category = 'cipa_ata'`).

---

## Task 1: Migration + CipaModule + CommitteesService (gerador de calendário)

**Files:**
- Create: `backend/db/migrations/0023_cipa_nucleo.sql`
- Modify: `backend/src/documents/documents.service.ts:8` (`ALLOWED_CATEGORIES`)
- Create: `backend/src/cipa/cipa.module.ts`
- Create: `backend/src/cipa/committees.service.ts`
- Create: `backend/src/cipa/committees.controller.ts`
- Create: `backend/src/cipa/dto/create-committee.dto.ts`
- Create: `backend/src/cipa/dto/generate-meetings.dto.ts`
- Modify: `backend/src/app.module.ts` (registrar `CipaModule`)
- Test: `backend/test/cipa-committees.e2e-spec.ts`

**Interfaces:**
- Produces: `CipaCommittee` interface (`{ id, tenant_id, company_unit_id, ano, data_inicio, data_termino, responsavel_user_id, status: 'ativa'|'encerrada', created_at, updated_at }`), exportada de `committees.service.ts`. `CommitteesService.create(client, tenantId, companyUnitId, ano, dataInicio, dataTermino, responsavelUserId): Promise<CipaCommittee>`. `CommitteesService.generateMeetings(client, committeeId, diaSemanaPreferido?: number, horario?: string, local?: string): Promise<CipaMeeting[]>` — `CipaMeeting` type é definido aqui (usado por Task 2 depois) por ser o retorno desta função.
- Consumes: nada de tasks anteriores (primeira task da fase).

- [ ] **Step 1: Escrever a migration**

Criar `backend/db/migrations/0023_cipa_nucleo.sql`:

```sql
-- Fase 12a — núcleo da Central da CIPA. tenant_id em toda tabela (padrão
-- de RLS já usado no projeto inteiro) + company_unit_id (uma CIPA por
-- estabelecimento — exigência legal real, não é escolha de design
-- arbitrária). Ordem de criação importa por causa de FK: committees →
-- meetings → members → meeting_participants (depende dos dois
-- anteriores) → pendencias.

CREATE TABLE cipa_committees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  ano INTEGER NOT NULL,
  data_inicio DATE NOT NULL,
  data_termino DATE NOT NULL,
  responsavel_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'encerrada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cipa_committees_company_unit_idx ON cipa_committees (company_unit_id);
CREATE TRIGGER trg_cipa_committees_updated_at BEFORE UPDATE ON cipa_committees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cipa_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  committee_id UUID NOT NULL REFERENCES cipa_committees(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('ordinaria', 'extraordinaria')),
  numero INTEGER,
  titulo TEXT,
  data DATE,
  hora TIME,
  local TEXT,
  modalidade TEXT CHECK (modalidade IN ('presencial', 'online', 'hibrida')),
  motivo TEXT,
  responsavel_user_id UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'planejada'
    CHECK (status IN ('planejada', 'agendada', 'realizada', 'cancelada', 'reagendada')),
  chk_pauta_definida BOOLEAN NOT NULL DEFAULT false,
  chk_participantes_convocados BOOLEAN NOT NULL DEFAULT false,
  chk_local_confirmado BOOLEAN NOT NULL DEFAULT false,
  chk_presenca_registrada BOOLEAN NOT NULL DEFAULT false,
  chk_assuntos_discutidos BOOLEAN NOT NULL DEFAULT false,
  chk_decisoes_registradas BOOLEAN NOT NULL DEFAULT false,
  chk_ata_criada BOOLEAN NOT NULL DEFAULT false,
  chk_acoes_distribuidas BOOLEAN NOT NULL DEFAULT false,
  chk_pendencias_registradas BOOLEAN NOT NULL DEFAULT false,
  pauta TEXT,
  discussoes TEXT,
  deliberacoes TEXT,
  proxima_reuniao_data DATE,
  status_ata TEXT NOT NULL DEFAULT 'rascunho' CHECK (status_ata IN ('rascunho', 'aprovada')),
  aprovado_por_user_id UUID REFERENCES users(id),
  aprovado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_ordinaria_numero CHECK (
    (tipo = 'ordinaria' AND numero IS NOT NULL AND titulo IS NULL)
    OR (tipo = 'extraordinaria' AND numero IS NULL AND titulo IS NOT NULL)
  )
);
CREATE INDEX cipa_meetings_committee_idx ON cipa_meetings (committee_id);
CREATE TRIGGER trg_cipa_meetings_updated_at BEFORE UPDATE ON cipa_meetings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cipa_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  funcao_empresa TEXT,
  setor TEXT,
  funcao_cipa TEXT NOT NULL CHECK (funcao_cipa IN ('presidente', 'vice_presidente', 'secretario', 'membro')),
  titular_suplente TEXT NOT NULL CHECK (titular_suplente IN ('titular', 'suplente')),
  representacao TEXT NOT NULL CHECK (representacao IN ('empregador', 'empregados')),
  inicio_mandato DATE NOT NULL,
  fim_mandato DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cipa_members_company_unit_idx ON cipa_members (company_unit_id);
CREATE TRIGGER trg_cipa_members_updated_at BEFORE UPDATE ON cipa_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cipa_meeting_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES cipa_meetings(id) ON DELETE CASCADE,
  cipa_member_id UUID REFERENCES cipa_members(id) ON DELETE SET NULL,
  nome_livre TEXT,
  presente BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT chk_participant_source CHECK (
    (cipa_member_id IS NOT NULL AND nome_livre IS NULL)
    OR (cipa_member_id IS NULL AND nome_livre IS NOT NULL)
  )
);
CREATE INDEX cipa_meeting_participants_meeting_idx ON cipa_meeting_participants (meeting_id);

CREATE TABLE cipa_pendencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  meeting_id UUID REFERENCES cipa_meetings(id) ON DELETE SET NULL,
  descricao TEXT NOT NULL,
  responsavel_user_id UUID REFERENCES users(id),
  prazo DATE,
  prioridade TEXT NOT NULL DEFAULT 'media' CHECK (prioridade IN ('alta', 'media', 'baixa')),
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'andamento', 'concluida', 'atrasada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cipa_pendencias_company_unit_idx ON cipa_pendencias (company_unit_id);
CREATE TRIGGER trg_cipa_pendencias_updated_at BEFORE UPDATE ON cipa_pendencias
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS — cópia exata do padrão de 0011_partner_access.sql em cada tabela
-- com tenant_id própria. cipa_meeting_participants não tem tenant_id
-- (igual inspection_checklist_items) — delega via EXISTS contra
-- cipa_meetings.

ALTER TABLE cipa_committees ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_committees FORCE ROW LEVEL SECURITY;
CREATE POLICY cipa_committees_isolation ON cipa_committees USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_committees.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_committees.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

ALTER TABLE cipa_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_meetings FORCE ROW LEVEL SECURITY;
CREATE POLICY cipa_meetings_isolation ON cipa_meetings USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_meetings.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_meetings.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

ALTER TABLE cipa_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_members FORCE ROW LEVEL SECURITY;
CREATE POLICY cipa_members_isolation ON cipa_members USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_members.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_members.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

ALTER TABLE cipa_pendencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_pendencias FORCE ROW LEVEL SECURITY;
CREATE POLICY cipa_pendencias_isolation ON cipa_pendencias USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_pendencias.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_pendencias.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

ALTER TABLE cipa_meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_meeting_participants FORCE ROW LEVEL SECURITY;
CREATE POLICY cipa_meeting_participants_isolation ON cipa_meeting_participants USING (
  EXISTS (SELECT 1 FROM cipa_meetings m WHERE m.id = cipa_meeting_participants.meeting_id)
);

-- Extensão do CHECK de category em documents — Documentos da CIPA
-- reaproveitam esta tabela, sem módulo de biblioteca novo.
ALTER TABLE documents DROP CONSTRAINT documents_category_check;
ALTER TABLE documents ADD CONSTRAINT documents_category_check CHECK (
  category IN ('pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento',
               'cipa_ata', 'cipa_comunicado', 'cipa_documento_eleitoral', 'cipa_anexo')
);
```

- [ ] **Step 2: Rodar a migration**

Run: `docker exec montese_backend npm run db:migrate`
Expected: `[apply] 0023_cipa_nucleo.sql` seguido de `[ok] 0023_cipa_nucleo.sql`.

- [ ] **Step 3: Atualizar `ALLOWED_CATEGORIES` em `documents.service.ts`**

Modificar `backend/src/documents/documents.service.ts:8`:

```ts
const ALLOWED_CATEGORIES = [
  'pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento',
  'cipa_ata', 'cipa_comunicado', 'cipa_documento_eleitoral', 'cipa_anexo',
];
```

- [ ] **Step 4: Escrever o teste que falha primeiro**

Criar `backend/test/cipa-committees.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST /cipa/committees, POST /cipa/committees/:id/generate-meetings (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let userId: string;
  let companyUnitId: string;
  let empresaToken: string;
  let technicianToken: string;
  let createdCommitteeId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA Committees Teste');
    tenantId = tenant.tenantId;
    userId = tenant.userId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico CIPA Committees Teste');
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    const technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;

    const loginTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = loginTech.body.access_token;
  });

  afterAll(async () => {
    if (createdCommitteeId) {
      await (db as any).client.query('DELETE FROM cipa_committees WHERE id = $1', [createdCommitteeId]);
    }
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa cria uma gestão da CIPA → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/cipa/committees')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        ano: 2026,
        data_inicio: '2026-01-01',
        data_termino: '2026-12-31',
        responsavel_user_id: userId,
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ativa');
    expect(res.body.company_unit_id).toBe(companyUnitId);
    createdCommitteeId = res.body.id;
  });

  it('técnico não cria gestão da CIPA → 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/cipa/committees')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({
        company_unit_id: companyUnitId,
        ano: 2026,
        data_inicio: '2026-01-01',
        data_termino: '2026-12-31',
        responsavel_user_id: userId,
      });

    expect(res.status).toBe(403);
  });

  it('empresa gera as 12 reuniões ordinárias com datas sugeridas → 201, numero 1 a 12', async () => {
    const res = await request(app.getHttpServer())
      .post(`/cipa/committees/${createdCommitteeId}/generate-meetings`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ dia_semana_preferido: 1, horario: '14:00', local: 'Sala de reuniões' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(12);
    expect(res.body.map((m: { numero: number }) => m.numero).sort((a: number, b: number) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    for (const meeting of res.body) {
      expect(meeting.tipo).toBe('ordinaria');
      expect(meeting.status).toBe('planejada');
      expect(meeting.local).toBe('Sala de reuniões');
      expect(meeting.data).toBeTruthy();
      const dataObj = new Date(meeting.data + 'T00:00:00Z');
      expect(dataObj.getUTCDay()).toBe(1); // segunda-feira
    }
  });

  it('gerar de novo na mesma gestão → 409 (já tem reuniões ordinárias)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/cipa/committees/${createdCommitteeId}/generate-meetings`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ dia_semana_preferido: 1 });

    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 5: Rodar o teste e confirmar que falha**

Run (via container efêmero, único jeito que funciona neste ambiente — confirmado nas Fases 9-11):
```bash
source /opt/Montese/.env
export DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}"
export TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}"
export REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379"
docker run --rm --network montese_internal -v /opt/Montese/backend:/app -w /app \
  -e DATABASE_URL="$DATABASE_URL" -e TEST_SUPERUSER_DATABASE_URL="$TEST_SUPERUSER_DATABASE_URL" \
  -e REDIS_URL="$REDIS_URL" -e JWT_SECRET="$JWT_SECRET" -e JWT_EXPIRES_IN="$JWT_EXPIRES_IN" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand cipa-committees"
```
Expected: FAIL — rotas `/cipa/*` não existem ainda (404).

- [ ] **Step 6: Implementar `CommitteesService`**

Criar `backend/src/cipa/committees.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface CipaCommittee {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  ano: number;
  data_inicio: string;
  data_termino: string;
  responsavel_user_id: string;
  status: 'ativa' | 'encerrada';
  created_at: string;
  updated_at: string;
}

export interface CipaMeeting {
  id: string;
  tenant_id: string;
  committee_id: string;
  tipo: 'ordinaria' | 'extraordinaria';
  numero: number | null;
  titulo: string | null;
  data: string | null;
  hora: string | null;
  local: string | null;
  modalidade: 'presencial' | 'online' | 'hibrida' | null;
  motivo: string | null;
  responsavel_user_id: string | null;
  status: 'planejada' | 'agendada' | 'realizada' | 'cancelada' | 'reagendada';
  chk_pauta_definida: boolean;
  chk_participantes_convocados: boolean;
  chk_local_confirmado: boolean;
  chk_presenca_registrada: boolean;
  chk_assuntos_discutidos: boolean;
  chk_decisoes_registradas: boolean;
  chk_ata_criada: boolean;
  chk_acoes_distribuidas: boolean;
  chk_pendencias_registradas: boolean;
  pauta: string | null;
  discussoes: string | null;
  deliberacoes: string | null;
  proxima_reuniao_data: string | null;
  status_ata: 'rascunho' | 'aprovada';
  aprovado_por_user_id: string | null;
  aprovado_em: string | null;
  created_at: string;
  updated_at: string;
}

// Primeira ocorrência do dia da semana (0=domingo..6=sábado, convenção
// de Date.getUTCDay()) em cada um dos 12 meses a partir do mês de
// dataInicio — regra de "toda primeira segunda do mês", por exemplo.
// Sugestão, nunca definitiva (o usuário edita cada reunião depois).
export function suggestedMeetingDates(dataInicio: string, diaSemana: number): string[] {
  const start = new Date(`${dataInicio}T00:00:00Z`);
  const dates: string[] = [];
  for (let i = 0; i < 12; i++) {
    const monthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const diff = (diaSemana - monthStart.getUTCDay() + 7) % 7;
    monthStart.setUTCDate(monthStart.getUTCDate() + diff);
    dates.push(monthStart.toISOString().slice(0, 10));
  }
  return dates;
}

@Injectable()
export class CommitteesService {
  async create(
    client: PoolClient,
    tenantId: string,
    companyUnitId: string,
    ano: number,
    dataInicio: string,
    dataTermino: string,
    responsavelUserId: string,
  ): Promise<CipaCommittee> {
    const unitCheck = await client.query('SELECT 1 FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (unitCheck.rowCount === 0) {
      throw new BadRequestException('Estabelecimento inválido para esta empresa');
    }

    const result = await client.query<CipaCommittee>(
      `INSERT INTO cipa_committees (tenant_id, company_unit_id, ano, data_inicio, data_termino, responsavel_user_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, companyUnitId, ano, dataInicio, dataTermino, responsavelUserId],
    );
    return result.rows[0];
  }

  async generateMeetings(
    client: PoolClient,
    committeeId: string,
    diaSemanaPreferido: number | undefined,
    horario: string | undefined,
    local: string | undefined,
  ): Promise<CipaMeeting[]> {
    const committeeResult = await client.query<CipaCommittee>(
      'SELECT * FROM cipa_committees WHERE id = $1',
      [committeeId],
    );
    const committee = committeeResult.rows[0];
    if (!committee) throw new NotFoundException('Gestão da CIPA não encontrada');

    const existing = await client.query(
      `SELECT 1 FROM cipa_meetings WHERE committee_id = $1 AND tipo = 'ordinaria' LIMIT 1`,
      [committeeId],
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new ConflictException('Esta gestão já tem reuniões ordinárias geradas');
    }

    const dates =
      diaSemanaPreferido !== undefined ? suggestedMeetingDates(committee.data_inicio, diaSemanaPreferido) : null;

    const values: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (let numero = 1; numero <= 12; numero++) {
      values.push(`($${i++}, $${i++}, 'ordinaria', $${i++}, $${i++}, $${i++}, $${i++})`);
      params.push(committee.tenant_id, committeeId, numero, dates ? dates[numero - 1] : null, horario ?? null, local ?? null);
    }

    const result = await client.query<CipaMeeting>(
      `INSERT INTO cipa_meetings (tenant_id, committee_id, tipo, numero, data, hora, local)
       VALUES ${values.join(', ')} RETURNING *`,
      params,
    );
    return result.rows;
  }
}
```

- [ ] **Step 7: Criar os DTOs**

Criar `backend/src/cipa/dto/create-committee.dto.ts`:

```ts
import { IsInt, IsISO8601, IsUUID, Max, Min } from 'class-validator';

export class CreateCommitteeDto {
  @IsUUID()
  company_unit_id: string;

  @IsInt()
  @Min(2020)
  @Max(2100)
  ano: number;

  @IsISO8601()
  data_inicio: string;

  @IsISO8601()
  data_termino: string;

  @IsUUID()
  responsavel_user_id: string;
}
```

Criar `backend/src/cipa/dto/generate-meetings.dto.ts`:

```ts
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class GenerateMeetingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dia_semana_preferido?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  horario?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  local?: string;
}
```

- [ ] **Step 8: Implementar `CommitteesController`**

Criar `backend/src/cipa/committees.controller.ts`:

```ts
import { Body, Controller, Param, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CommitteesService } from './committees.service';
import { CreateCommitteeDto } from './dto/create-committee.dto';
import { GenerateMeetingsDto } from './dto/generate-meetings.dto';

@Controller('cipa/committees')
export class CommitteesController {
  constructor(private readonly committees: CommitteesService) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateCommitteeDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.committees.create(
        client,
        req.user.tenantId,
        dto.company_unit_id,
        dto.ano,
        dto.data_inicio,
        dto.data_termino,
        dto.responsavel_user_id,
      ),
    );
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/generate-meetings')
  generateMeetings(@Param('id') id: string, @Body() dto: GenerateMeetingsDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.committees.generateMeetings(client, id, dto.dia_semana_preferido, dto.horario, dto.local),
    );
  }
}
```

- [ ] **Step 9: Criar `CipaModule` e registrar em `app.module.ts`**

Criar `backend/src/cipa/cipa.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CommitteesController } from './committees.controller';
import { CommitteesService } from './committees.service';

@Module({
  controllers: [CommitteesController],
  providers: [CommitteesService],
})
export class CipaModule {}
```

Modificar `backend/src/app.module.ts`: adicionar `import { CipaModule } from './cipa/cipa.module';` junto dos outros imports de módulo, e `CipaModule` na lista `imports` do `@Module({...})`, logo depois de `VisitsModule`.

- [ ] **Step 10: Build, rodar a migration e o teste**

Run: `docker compose build backend && docker compose up -d backend`
Run: `docker exec montese_backend npm run db:migrate` (deve aplicar `0023_cipa_nucleo.sql` se ainda não aplicou no Step 2, senão `[skip]`)
Run (container efêmero, mesmo comando do Step 5): `... cipa-committees`
Expected: PASS em todos os testes.

- [ ] **Step 11: Rodar a suíte completa e commitar**

Run (container efêmero, env completo — ver nota de ambiente da Fase 11 se faltar variável):
```bash
... -e PUBLIC_APP_URL="${PUBLIC_APP_URL:-http://localhost}" -e R2_ACCOUNT_ID="$R2_ACCOUNT_ID" \
-e R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" -e R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" -e R2_BUCKET="$R2_BUCKET" \
-e R2_ENDPOINT="$R2_ENDPOINT" -e MERCADOPAGO_PUBLIC_KEY="$MERCADOPAGO_PUBLIC_KEY" \
-e MERCADOPAGO_ACCESS_TOKEN="$MERCADOPAGO_ACCESS_TOKEN" -e MERCADOPAGO_WEBHOOK_SECRET="$MERCADOPAGO_WEBHOOK_SECRET" \
-e AUTH_RATE_LIMIT_MAX="${AUTH_RATE_LIMIT_MAX:-10}" node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand"
```
Limpar `ratelimit:*` no Redis real antes, se a suíte completa já rodou uma vez nesta sessão de trabalho (`docker exec montese_redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning KEYS 'ratelimit:*'` e deletar).
Expected: todas as suítes passando, incluindo a nova.

```bash
git add backend/db/migrations/0023_cipa_nucleo.sql backend/src/documents/documents.service.ts backend/src/cipa backend/src/app.module.ts backend/test/cipa-committees.e2e-spec.ts
git commit -m "feat: gestão e gerador de calendário da CIPA (Fase 12a)"
```

---

## Task 2: MeetingsService (CRUD, participantes, checklist, ata rascunho)

**Files:**
- Create: `backend/src/cipa/meetings.service.ts`
- Create: `backend/src/cipa/meetings.controller.ts`
- Create: `backend/src/cipa/dto/create-extraordinaria.dto.ts`
- Create: `backend/src/cipa/dto/update-meeting.dto.ts`
- Create: `backend/src/cipa/dto/set-participants.dto.ts`
- Modify: `backend/src/cipa/cipa.module.ts` (registrar `MeetingsController`/`MeetingsService`)
- Test: `backend/test/cipa-meetings.e2e-spec.ts`

**Interfaces:**
- Consumes: `CipaMeeting` (Task 1, `committees.service.ts`).
- Produces: `MeetingsService` com `createExtraordinaria`, `findAll`, `findOne`, `update`, `setParticipants` — assinaturas completas no Step 3. `CipaMeetingParticipant` interface.

- [ ] **Step 1: Escrever o teste que falha primeiro**

Criar `backend/test/cipa-meetings.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CRUD /cipa/meetings (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let userId: string;
  let companyUnitId: string;
  let committeeId: string;
  let empresaToken: string;
  let memberId: string;
  let extraordinariaId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA Meetings Teste');
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

    const memberResult = await (db as any).client.query(
      `INSERT INTO cipa_members (tenant_id, company_unit_id, nome, funcao_cipa, titular_suplente, representacao, inicio_mandato, fim_mandato)
       VALUES ($1, $2, 'Fulano de Tal', 'membro', 'titular', 'empregados', '2026-01-01', '2027-12-31') RETURNING id`,
      [tenantId, companyUnitId],
    );
    memberId = memberResult.rows[0].id;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM cipa_committees WHERE id = $1', [committeeId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa cria reunião extraordinária → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/cipa/meetings')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        committee_id: committeeId,
        titulo: 'Reunião sobre acidente na linha 3',
        data: '2026-03-10',
        hora: '10:00',
        local: 'Sala de reuniões',
        modalidade: 'presencial',
        motivo: 'Acidente de trabalho',
      });

    expect(res.status).toBe(201);
    expect(res.body.tipo).toBe('extraordinaria');
    expect(res.body.status_ata).toBe('rascunho');
    extraordinariaId = res.body.id;
  });

  it('empresa edita campos de ata (rascunho) → 200', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/cipa/meetings/${extraordinariaId}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        pauta: 'Discutir causas do acidente',
        discussoes: 'Falta de sinalização na área',
        deliberacoes: 'Instalar sinalização em 15 dias',
        chk_pauta_definida: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.pauta).toBe('Discutir causas do acidente');
    expect(res.body.chk_pauta_definida).toBe(true);
  });

  it('empresa registra participantes (membro + convidado externo) → 200', async () => {
    const res = await request(app.getHttpServer())
      .put(`/cipa/meetings/${extraordinariaId}/participants`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        participants: [
          { cipa_member_id: memberId, presente: true },
          { nome_livre: 'Técnico convidado', presente: true },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('GET lista as reuniões da gestão', async () => {
    const res = await request(app.getHttpServer())
      .get(`/cipa/meetings?committee_id=${committeeId}`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.find((m: { id: string }) => m.id === extraordinariaId)).toBeDefined();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run (container efêmero): `... cipa-meetings`
Expected: FAIL — rotas de `/cipa/meetings` ainda não existem (404).

- [ ] **Step 3: Implementar `MeetingsService`**

Criar `backend/src/cipa/meetings.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CipaMeeting } from './committees.service';

export interface CipaMeetingParticipant {
  id: string;
  meeting_id: string;
  cipa_member_id: string | null;
  nome_livre: string | null;
  presente: boolean;
}

const UPDATABLE_FIELDS = [
  'data', 'hora', 'local', 'modalidade', 'responsavel_user_id', 'status',
  'chk_pauta_definida', 'chk_participantes_convocados', 'chk_local_confirmado',
  'chk_presenca_registrada', 'chk_assuntos_discutidos', 'chk_decisoes_registradas',
  'chk_ata_criada', 'chk_acoes_distribuidas', 'chk_pendencias_registradas',
  'pauta', 'discussoes', 'deliberacoes', 'proxima_reuniao_data',
] as const;

@Injectable()
export class MeetingsService {
  async createExtraordinaria(
    client: PoolClient,
    tenantId: string,
    committeeId: string,
    titulo: string,
    data: string | undefined,
    hora: string | undefined,
    local: string | undefined,
    modalidade: string | undefined,
    motivo: string | undefined,
    responsavelUserId: string | undefined,
  ): Promise<CipaMeeting> {
    const result = await client.query<CipaMeeting>(
      `INSERT INTO cipa_meetings (tenant_id, committee_id, tipo, titulo, data, hora, local, modalidade, motivo, responsavel_user_id)
       VALUES ($1, $2, 'extraordinaria', $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [tenantId, committeeId, titulo, data ?? null, hora ?? null, local ?? null, modalidade ?? null, motivo ?? null, responsavelUserId ?? null],
    );
    return result.rows[0];
  }

  async findAll(client: PoolClient, committeeId?: string): Promise<CipaMeeting[]> {
    if (committeeId) {
      const result = await client.query<CipaMeeting>(
        `SELECT * FROM cipa_meetings WHERE committee_id = $1 ORDER BY COALESCE(data, created_at::date)`,
        [committeeId],
      );
      return result.rows;
    }
    const result = await client.query<CipaMeeting>(
      `SELECT * FROM cipa_meetings ORDER BY COALESCE(data, created_at::date)`,
    );
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<CipaMeeting> {
    const result = await client.query<CipaMeeting>('SELECT * FROM cipa_meetings WHERE id = $1', [id]);
    const meeting = result.rows[0];
    if (!meeting) throw new NotFoundException('Reunião não encontrada');
    return meeting;
  }

  async update(client: PoolClient, id: string, data: Record<string, unknown>): Promise<CipaMeeting> {
    const lockResult = await client.query<{ status_ata: string }>(
      'SELECT status_ata FROM cipa_meetings WHERE id = $1 FOR UPDATE',
      [id],
    );
    const meeting = lockResult.rows[0];
    if (!meeting) throw new NotFoundException('Reunião não encontrada');
    if (meeting.status_ata === 'aprovada') {
      throw new ConflictException('Ata já aprovada — reabra antes de editar');
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 2;
    for (const field of UPDATABLE_FIELDS) {
      if (data[field] !== undefined) {
        setClauses.push(`${field} = $${i++}`);
        values.push(data[field]);
      }
    }
    if (setClauses.length === 0) {
      return this.findOne(client, id);
    }

    const result = await client.query<CipaMeeting>(
      `UPDATE cipa_meetings SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    return result.rows[0];
  }

  async setParticipants(
    client: PoolClient,
    meetingId: string,
    participants: { cipa_member_id?: string; nome_livre?: string; presente: boolean }[],
  ): Promise<CipaMeetingParticipant[]> {
    await client.query('DELETE FROM cipa_meeting_participants WHERE meeting_id = $1', [meetingId]);
    if (participants.length === 0) return [];

    const values: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const p of participants) {
      values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
      params.push(meetingId, p.cipa_member_id ?? null, p.nome_livre ?? null, p.presente);
    }

    const result = await client.query<CipaMeetingParticipant>(
      `INSERT INTO cipa_meeting_participants (meeting_id, cipa_member_id, nome_livre, presente)
       VALUES ${values.join(', ')} RETURNING *`,
      params,
    );
    return result.rows;
  }
}
```

- [ ] **Step 4: Criar os DTOs**

Criar `backend/src/cipa/dto/create-extraordinaria.dto.ts`:

```ts
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateExtraordinariaDto {
  @IsUUID()
  committee_id: string;

  @IsString()
  @MaxLength(200)
  titulo: string;

  @IsOptional()
  @IsISO8601()
  data?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  hora?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  local?: string;

  @IsOptional()
  @IsIn(['presencial', 'online', 'hibrida'])
  modalidade?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  motivo?: string;

  @IsOptional()
  @IsUUID()
  responsavel_user_id?: string;
}
```

Criar `backend/src/cipa/dto/update-meeting.dto.ts`:

```ts
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdateMeetingDto {
  @IsOptional() @IsISO8601() data?: string;
  @IsOptional() @IsString() @MaxLength(5) hora?: string;
  @IsOptional() @IsString() @MaxLength(200) local?: string;
  @IsOptional() @IsIn(['presencial', 'online', 'hibrida']) modalidade?: string;
  @IsOptional() @IsUUID() responsavel_user_id?: string;
  @IsOptional() @IsIn(['planejada', 'agendada', 'realizada', 'cancelada', 'reagendada']) status?: string;
  @IsOptional() @IsBoolean() chk_pauta_definida?: boolean;
  @IsOptional() @IsBoolean() chk_participantes_convocados?: boolean;
  @IsOptional() @IsBoolean() chk_local_confirmado?: boolean;
  @IsOptional() @IsBoolean() chk_presenca_registrada?: boolean;
  @IsOptional() @IsBoolean() chk_assuntos_discutidos?: boolean;
  @IsOptional() @IsBoolean() chk_decisoes_registradas?: boolean;
  @IsOptional() @IsBoolean() chk_ata_criada?: boolean;
  @IsOptional() @IsBoolean() chk_acoes_distribuidas?: boolean;
  @IsOptional() @IsBoolean() chk_pendencias_registradas?: boolean;
  @IsOptional() @IsString() @MaxLength(5000) pauta?: string;
  @IsOptional() @IsString() @MaxLength(10000) discussoes?: string;
  @IsOptional() @IsString() @MaxLength(10000) deliberacoes?: string;
  @IsOptional() @IsISO8601() proxima_reuniao_data?: string;
}
```

Criar `backend/src/cipa/dto/set-participants.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsUUID, ValidateNested } from 'class-validator';

class ParticipantDto {
  @IsOptional()
  @IsUUID()
  cipa_member_id?: string;

  @IsOptional()
  nome_livre?: string;

  @IsBoolean()
  presente: boolean;
}

export class SetParticipantsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ParticipantDto)
  participants: ParticipantDto[];
}
```

- [ ] **Step 5: Implementar `MeetingsController`**

Criar `backend/src/cipa/meetings.controller.ts`:

```ts
import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { MeetingsService } from './meetings.service';
import { CreateExtraordinariaDto } from './dto/create-extraordinaria.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';
import { SetParticipantsDto } from './dto/set-participants.dto';

@Controller('cipa/meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateExtraordinariaDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.meetings.createExtraordinaria(
        client, req.user.tenantId, dto.committee_id, dto.titulo, dto.data, dto.hora,
        dto.local, dto.modalidade, dto.motivo, dto.responsavel_user_id,
      ),
    );
  }

  @Get()
  findAll(@Query('committee_id') committeeId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.meetings.findAll(client, committeeId));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.meetings.findOne(client, id));
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMeetingDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.meetings.update(client, id, dto as Record<string, unknown>));
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Put(':id/participants')
  setParticipants(@Param('id') id: string, @Body() dto: SetParticipantsDto, @Req() req: any) {
    for (const p of dto.participants) {
      if (!p.cipa_member_id && !p.nome_livre) {
        throw new BadRequestException('Cada participante precisa de cipa_member_id ou nome_livre');
      }
    }
    return req.withTenantContext((client: any) => this.meetings.setParticipants(client, id, dto.participants));
  }
}
```

- [ ] **Step 6: Registrar no `CipaModule`**

Modificar `backend/src/cipa/cipa.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CommitteesController } from './committees.controller';
import { CommitteesService } from './committees.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

@Module({
  controllers: [CommitteesController, MeetingsController],
  providers: [CommitteesService, MeetingsService],
})
export class CipaModule {}
```

- [ ] **Step 7: Build e rodar os testes**

Run: `docker compose build backend && docker compose up -d backend`
Run (container efêmero): `... cipa-meetings`
Expected: PASS em todos os testes.

- [ ] **Step 8: Rodar a suíte completa e commitar**

Run (container efêmero, suíte completa, mesmo comando do Task 1 Step 11).
Expected: todas as suítes passando.

```bash
git add backend/src/cipa backend/test/cipa-meetings.e2e-spec.ts
git commit -m "feat: CRUD de reuniões da CIPA com checklist e ata rascunho (Fase 12a)"
```

---

## Task 3: Fluxo de aprovação da ata + exportação em PDF

**Files:**
- Modify: `backend/src/cipa/meetings.service.ts` (adicionar `approveAta`/`reopenAta`)
- Create: `backend/src/cipa/ata-pdf.util.ts`
- Modify: `backend/src/cipa/meetings.controller.ts` (adicionar rotas)
- Modify: `backend/src/cipa/cipa.module.ts` (importar `DocumentsModule`)
- Modify: `backend/backend/package.json` — adicionar `pdfkit` (rodar `npm install pdfkit @types/pdfkit --save` dentro do container ou localmente, conferir `package.json`/`package-lock.json` foram atualizados)
- Test: `backend/test/cipa-ata-approval.e2e-spec.ts`

**Interfaces:**
- Consumes: `CipaMeeting` (Task 1). `DocumentsService.upload(client, data: UploadData): Promise<Document>` (já existe, `backend/src/documents/documents.service.ts` — **não modificar** além do Task 1 Step 3).
- Produces: `MeetingsService.approveAta(client, id, userId, documents: DocumentsService): Promise<CipaMeeting>`. `MeetingsService.reopenAta(client, id): Promise<CipaMeeting>`. `buildAtaPdf(meeting: CipaMeeting, tenantName: string, participants: CipaMeetingParticipant[]): Buffer` (exportada de `ata-pdf.util.ts`).

- [ ] **Step 1: Instalar `pdfkit`**

Run: `cd /opt/Montese/backend && npm install pdfkit@^0.15 && npm install -D @types/pdfkit@^0.13`
Verify: `pdfkit` e `@types/pdfkit` aparecem em `backend/package.json` (`dependencies`/`devDependencies`) e `backend/package-lock.json` foi atualizado.

- [ ] **Step 2: Escrever o teste que falha primeiro**

Criar `backend/test/cipa-ata-approval.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST /cipa/meetings/:id/aprovar-ata, /reabrir-ata (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let userId: string;
  let companyUnitId: string;
  let committeeId: string;
  let meetingId: string;
  let empresaToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA Ata Approval Teste');
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
      `INSERT INTO cipa_meetings (tenant_id, committee_id, tipo, titulo, data, pauta, discussoes, deliberacoes)
       VALUES ($1, $2, 'extraordinaria', 'Reunião Teste Ata', '2026-03-10', 'Pauta teste', 'Discussão teste', 'Deliberação teste')
       RETURNING id`,
      [tenantId, committeeId],
    );
    meetingId = meetingResult.rows[0].id;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM documents WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM cipa_committees WHERE id = $1', [committeeId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa aprova a ata → 200, grava aprovador/data, gera documento cipa_ata', async () => {
    const res = await request(app.getHttpServer())
      .post(`/cipa/meetings/${meetingId}/aprovar-ata`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status_ata).toBe('aprovada');
    expect(res.body.aprovado_por_user_id).toBe(userId);
    expect(res.body.aprovado_em).toBeTruthy();

    const docResult = await (db as any).client.query(
      `SELECT * FROM documents WHERE tenant_id = $1 AND category = 'cipa_ata'`,
      [tenantId],
    );
    expect(docResult.rows).toHaveLength(1);
    expect(docResult.rows[0].mime_type).toBe('application/pdf');
  });

  it('editar depois de aprovada → 409', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/cipa/meetings/${meetingId}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ pauta: 'Tentando editar depois de aprovada' });

    expect(res.status).toBe(409);
  });

  it('reabrir volta pra rascunho e permite editar de novo', async () => {
    const reopenRes = await request(app.getHttpServer())
      .post(`/cipa/meetings/${meetingId}/reabrir-ata`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(reopenRes.status).toBe(200);
    expect(reopenRes.body.status_ata).toBe('rascunho');

    const editRes = await request(app.getHttpServer())
      .patch(`/cipa/meetings/${meetingId}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ pauta: 'Editado depois de reabrir' });
    expect(editRes.status).toBe(200);
    expect(editRes.body.pauta).toBe('Editado depois de reabrir');
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run (container efêmero): `... cipa-ata-approval`
Expected: FAIL — rotas `aprovar-ata`/`reabrir-ata` não existem ainda (404).

- [ ] **Step 4: Implementar `buildAtaPdf`**

Criar `backend/src/cipa/ata-pdf.util.ts`:

```ts
import PDFDocument from 'pdfkit';
import { CipaMeeting } from './committees.service';
import { CipaMeetingParticipant } from './meetings.service';

// pdfkit escreve em um stream — coletamos os chunks num Buffer só,
// mesmo padrão de qualquer geração de PDF em memória com essa lib
// (sem escrever em disco, o resultado vai direto pro R2 via
// DocumentsService.upload).
export function buildAtaPdf(
  meeting: CipaMeeting,
  tenantName: string,
  participants: CipaMeetingParticipant[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const titulo =
      meeting.tipo === 'ordinaria'
        ? `${meeting.numero}ª Reunião Ordinária da CIPA`
        : meeting.titulo || 'Reunião Extraordinária da CIPA';

    doc.fontSize(18).text('ATA DA REUNIÃO DA CIPA', { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text(titulo);
    doc.moveDown();

    doc.fontSize(11);
    doc.text(`Empresa: ${tenantName}`);
    doc.text(`Data: ${meeting.data ?? 'não informada'}`);
    doc.text(`Hora: ${meeting.hora ?? 'não informada'}`);
    doc.text(`Local: ${meeting.local ?? 'não informado'}`);
    doc.moveDown();

    doc.fontSize(13).text('Participantes');
    doc.fontSize(11);
    if (participants.length === 0) {
      doc.text('Nenhum participante registrado.');
    } else {
      for (const p of participants) {
        doc.text(`- ${p.nome_livre ?? '(membro da CIPA)'} — ${p.presente ? 'presente' : 'ausente'}`);
      }
    }
    doc.moveDown();

    doc.fontSize(13).text('Pauta');
    doc.fontSize(11).text(meeting.pauta || 'Não informada');
    doc.moveDown();

    doc.fontSize(13).text('Discussões');
    doc.fontSize(11).text(meeting.discussoes || 'Não informadas');
    doc.moveDown();

    doc.fontSize(13).text('Deliberações');
    doc.fontSize(11).text(meeting.deliberacoes || 'Não informadas');
    doc.moveDown();

    if (meeting.proxima_reuniao_data) {
      doc.fontSize(13).text('Próxima reunião');
      doc.fontSize(11).text(meeting.proxima_reuniao_data);
    }

    doc.end();
  });
}
```

- [ ] **Step 5: Adicionar `approveAta`/`reopenAta` em `MeetingsService`**

Modificar `backend/src/cipa/meetings.service.ts` — substituir o arquivo inteiro pelo conteúdo abaixo (acrescenta os 2 imports e os 2 métodos novos; os 5 métodos e os 2 tipos da Task 2 continuam idênticos):

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CipaMeeting } from './committees.service';
import { DocumentsService } from '../documents/documents.service';
import { buildAtaPdf } from './ata-pdf.util';

export interface CipaMeetingParticipant {
  id: string;
  meeting_id: string;
  cipa_member_id: string | null;
  nome_livre: string | null;
  presente: boolean;
}

const UPDATABLE_FIELDS = [
  'data', 'hora', 'local', 'modalidade', 'responsavel_user_id', 'status',
  'chk_pauta_definida', 'chk_participantes_convocados', 'chk_local_confirmado',
  'chk_presenca_registrada', 'chk_assuntos_discutidos', 'chk_decisoes_registradas',
  'chk_ata_criada', 'chk_acoes_distribuidas', 'chk_pendencias_registradas',
  'pauta', 'discussoes', 'deliberacoes', 'proxima_reuniao_data',
] as const;

@Injectable()
export class MeetingsService {
  async createExtraordinaria(
    client: PoolClient,
    tenantId: string,
    committeeId: string,
    titulo: string,
    data: string | undefined,
    hora: string | undefined,
    local: string | undefined,
    modalidade: string | undefined,
    motivo: string | undefined,
    responsavelUserId: string | undefined,
  ): Promise<CipaMeeting> {
    const result = await client.query<CipaMeeting>(
      `INSERT INTO cipa_meetings (tenant_id, committee_id, tipo, titulo, data, hora, local, modalidade, motivo, responsavel_user_id)
       VALUES ($1, $2, 'extraordinaria', $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [tenantId, committeeId, titulo, data ?? null, hora ?? null, local ?? null, modalidade ?? null, motivo ?? null, responsavelUserId ?? null],
    );
    return result.rows[0];
  }

  async findAll(client: PoolClient, committeeId?: string): Promise<CipaMeeting[]> {
    if (committeeId) {
      const result = await client.query<CipaMeeting>(
        `SELECT * FROM cipa_meetings WHERE committee_id = $1 ORDER BY COALESCE(data, created_at::date)`,
        [committeeId],
      );
      return result.rows;
    }
    const result = await client.query<CipaMeeting>(
      `SELECT * FROM cipa_meetings ORDER BY COALESCE(data, created_at::date)`,
    );
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<CipaMeeting> {
    const result = await client.query<CipaMeeting>('SELECT * FROM cipa_meetings WHERE id = $1', [id]);
    const meeting = result.rows[0];
    if (!meeting) throw new NotFoundException('Reunião não encontrada');
    return meeting;
  }

  async update(client: PoolClient, id: string, data: Record<string, unknown>): Promise<CipaMeeting> {
    const lockResult = await client.query<{ status_ata: string }>(
      'SELECT status_ata FROM cipa_meetings WHERE id = $1 FOR UPDATE',
      [id],
    );
    const meeting = lockResult.rows[0];
    if (!meeting) throw new NotFoundException('Reunião não encontrada');
    if (meeting.status_ata === 'aprovada') {
      throw new ConflictException('Ata já aprovada — reabra antes de editar');
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 2;
    for (const field of UPDATABLE_FIELDS) {
      if (data[field] !== undefined) {
        setClauses.push(`${field} = $${i++}`);
        values.push(data[field]);
      }
    }
    if (setClauses.length === 0) {
      return this.findOne(client, id);
    }

    const result = await client.query<CipaMeeting>(
      `UPDATE cipa_meetings SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    return result.rows[0];
  }

  async setParticipants(
    client: PoolClient,
    meetingId: string,
    participants: { cipa_member_id?: string; nome_livre?: string; presente: boolean }[],
  ): Promise<CipaMeetingParticipant[]> {
    await client.query('DELETE FROM cipa_meeting_participants WHERE meeting_id = $1', [meetingId]);
    if (participants.length === 0) return [];

    const values: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const p of participants) {
      values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
      params.push(meetingId, p.cipa_member_id ?? null, p.nome_livre ?? null, p.presente);
    }

    const result = await client.query<CipaMeetingParticipant>(
      `INSERT INTO cipa_meeting_participants (meeting_id, cipa_member_id, nome_livre, presente)
       VALUES ${values.join(', ')} RETURNING *`,
      params,
    );
    return result.rows;
  }

  async approveAta(
    client: PoolClient,
    id: string,
    userId: string,
    documents: DocumentsService,
  ): Promise<CipaMeeting> {
    const lockResult = await client.query<CipaMeeting>(
      'SELECT * FROM cipa_meetings WHERE id = $1 FOR UPDATE',
      [id],
    );
    const meeting = lockResult.rows[0];
    if (!meeting) throw new NotFoundException('Reunião não encontrada');
    if (meeting.status_ata === 'aprovada') {
      throw new ConflictException('Ata já está aprovada');
    }

    const tenantResult = await client.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [
      meeting.tenant_id,
    ]);
    const participantsResult = await client.query<CipaMeetingParticipant>(
      'SELECT * FROM cipa_meeting_participants WHERE meeting_id = $1',
      [id],
    );

    const pdfBuffer = await buildAtaPdf(meeting, tenantResult.rows[0].name, participantsResult.rows);
    const fileName = `ata-${meeting.tipo}-${meeting.numero ?? meeting.id.slice(0, 8)}.pdf`;

    await documents.upload(client, {
      tenantId: meeting.tenant_id,
      category: 'cipa_ata',
      title: `Ata — ${meeting.tipo === 'ordinaria' ? `${meeting.numero}ª Reunião Ordinária` : meeting.titulo}`,
      file: { buffer: pdfBuffer, mimetype: 'application/pdf', originalname: fileName, size: pdfBuffer.length },
      uploadedByUserId: userId,
      uploadedByRole: 'empresa',
    });

    const result = await client.query<CipaMeeting>(
      `UPDATE cipa_meetings SET status_ata = 'aprovada', aprovado_por_user_id = $2, aprovado_em = now()
       WHERE id = $1 RETURNING *`,
      [id, userId],
    );
    return result.rows[0];
  }

  async reopenAta(client: PoolClient, id: string): Promise<CipaMeeting> {
    const result = await client.query<CipaMeeting>(
      `UPDATE cipa_meetings SET status_ata = 'rascunho', aprovado_por_user_id = NULL, aprovado_em = NULL
       WHERE id = $1 RETURNING *`,
      [id],
    );
    if (result.rows.length === 0) throw new NotFoundException('Reunião não encontrada');
    return result.rows[0];
  }
}
```

- [ ] **Step 6: Adicionar as rotas no `MeetingsController`**

Modificar `backend/src/cipa/meetings.controller.ts` — substituir o arquivo inteiro pelo conteúdo abaixo (acrescenta o import de `DocumentsService`, o segundo parâmetro do construtor, e os métodos `approveAta`/`reopenAta`; os 5 métodos da Task 2 continuam idênticos):

```ts
import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { MeetingsService } from './meetings.service';
import { DocumentsService } from '../documents/documents.service';
import { CreateExtraordinariaDto } from './dto/create-extraordinaria.dto';
import { UpdateMeetingDto } from './dto/update-meeting.dto';
import { SetParticipantsDto } from './dto/set-participants.dto';

@Controller('cipa/meetings')
export class MeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly documents: DocumentsService,
  ) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateExtraordinariaDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.meetings.createExtraordinaria(
        client, req.user.tenantId, dto.committee_id, dto.titulo, dto.data, dto.hora,
        dto.local, dto.modalidade, dto.motivo, dto.responsavel_user_id,
      ),
    );
  }

  @Get()
  findAll(@Query('committee_id') committeeId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.meetings.findAll(client, committeeId));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.meetings.findOne(client, id));
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMeetingDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.meetings.update(client, id, dto as Record<string, unknown>));
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Put(':id/participants')
  setParticipants(@Param('id') id: string, @Body() dto: SetParticipantsDto, @Req() req: any) {
    for (const p of dto.participants) {
      if (!p.cipa_member_id && !p.nome_livre) {
        throw new BadRequestException('Cada participante precisa de cipa_member_id ou nome_livre');
      }
    }
    return req.withTenantContext((client: any) => this.meetings.setParticipants(client, id, dto.participants));
  }

  @Roles('empresa')
  @Post(':id/aprovar-ata')
  approveAta(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.meetings.approveAta(client, id, req.user.id, this.documents),
    );
  }

  @Roles('empresa')
  @Post(':id/reabrir-ata')
  reopenAta(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.meetings.reopenAta(client, id));
  }
}
```

- [ ] **Step 7: Importar `DocumentsModule` no `CipaModule`**

Modificar `backend/src/cipa/cipa.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { CommitteesController } from './committees.controller';
import { CommitteesService } from './committees.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

@Module({
  imports: [DocumentsModule],
  controllers: [CommitteesController, MeetingsController],
  providers: [CommitteesService, MeetingsService],
})
export class CipaModule {}
```

- [ ] **Step 8: Build e rodar os testes**

Run: `docker compose build backend && docker compose up -d backend`
Run (container efêmero, precisa das env vars de R2 reais — `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/`R2_ENDPOINT` — pra `DocumentsService.upload` gravar no bucket de verdade): `... cipa-ata-approval`
Expected: PASS em todos os testes.

- [ ] **Step 9: Rodar a suíte completa e commitar**

Run (container efêmero, suíte completa).
Expected: todas as suítes passando.

```bash
git add backend/package.json backend/package-lock.json backend/src/cipa backend/test/cipa-ata-approval.e2e-spec.ts
git commit -m "feat: aprovação de ata da CIPA com exportação em PDF (Fase 12a)"
```

---

## Task 4: MembersService (CRUD de membros)

**Files:**
- Create: `backend/src/cipa/members.service.ts`
- Create: `backend/src/cipa/members.controller.ts`
- Create: `backend/src/cipa/dto/create-member.dto.ts`
- Create: `backend/src/cipa/dto/update-member.dto.ts`
- Modify: `backend/src/cipa/cipa.module.ts` (registrar)
- Test: `backend/test/cipa-members.e2e-spec.ts`

**Interfaces:**
- Produces: `CipaMember` interface, `MembersService` com `create`/`findAll`/`update`.

- [ ] **Step 1: Escrever o teste que falha primeiro**

Criar `backend/test/cipa-members.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CRUD /cipa/members (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let companyUnitId: string;
  let empresaToken: string;
  let memberId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA Members Teste');
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
    await (db as any).client.query('DELETE FROM cipa_members WHERE company_unit_id = $1', [companyUnitId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa cadastra um membro da CIPA → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/cipa/members')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        nome: 'Maria Silva',
        funcao_empresa: 'Operadora de máquina',
        setor: 'Produção',
        funcao_cipa: 'presidente',
        titular_suplente: 'titular',
        representacao: 'empregador',
        inicio_mandato: '2026-01-01',
        fim_mandato: '2027-12-31',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ativo');
    memberId = res.body.id;
  });

  it('GET lista os membros do estabelecimento', async () => {
    const res = await request(app.getHttpServer())
      .get(`/cipa/members?company_unit_id=${companyUnitId}`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.find((m: { id: string }) => m.id === memberId)).toBeDefined();
  });

  it('empresa atualiza status do membro pra inativo → 200', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/cipa/members/${memberId}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ status: 'inativo' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('inativo');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run (container efêmero): `... cipa-members`
Expected: FAIL — rotas `/cipa/members` ainda não existem (404).

- [ ] **Step 3: Implementar `MembersService`**

Criar `backend/src/cipa/members.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface CipaMember {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  nome: string;
  funcao_empresa: string | null;
  setor: string | null;
  funcao_cipa: 'presidente' | 'vice_presidente' | 'secretario' | 'membro';
  titular_suplente: 'titular' | 'suplente';
  representacao: 'empregador' | 'empregados';
  inicio_mandato: string;
  fim_mandato: string;
  status: 'ativo' | 'inativo';
  created_at: string;
  updated_at: string;
}

const UPDATABLE_FIELDS = [
  'nome', 'funcao_empresa', 'setor', 'funcao_cipa', 'titular_suplente',
  'representacao', 'inicio_mandato', 'fim_mandato', 'status',
] as const;

@Injectable()
export class MembersService {
  async create(
    client: PoolClient,
    tenantId: string,
    data: Omit<CipaMember, 'id' | 'tenant_id' | 'status' | 'created_at' | 'updated_at'>,
  ): Promise<CipaMember> {
    const result = await client.query<CipaMember>(
      `INSERT INTO cipa_members (tenant_id, company_unit_id, nome, funcao_empresa, setor, funcao_cipa, titular_suplente, representacao, inicio_mandato, fim_mandato)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        tenantId, data.company_unit_id, data.nome, data.funcao_empresa ?? null, data.setor ?? null,
        data.funcao_cipa, data.titular_suplente, data.representacao, data.inicio_mandato, data.fim_mandato,
      ],
    );
    return result.rows[0];
  }

  async findAll(client: PoolClient, companyUnitId?: string): Promise<CipaMember[]> {
    if (companyUnitId) {
      const result = await client.query<CipaMember>(
        'SELECT * FROM cipa_members WHERE company_unit_id = $1 ORDER BY nome',
        [companyUnitId],
      );
      return result.rows;
    }
    const result = await client.query<CipaMember>('SELECT * FROM cipa_members ORDER BY nome');
    return result.rows;
  }

  async update(client: PoolClient, id: string, data: Record<string, unknown>): Promise<CipaMember> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 2;
    for (const field of UPDATABLE_FIELDS) {
      if (data[field] !== undefined) {
        setClauses.push(`${field} = $${i++}`);
        values.push(data[field]);
      }
    }
    if (setClauses.length === 0) {
      const result = await client.query<CipaMember>('SELECT * FROM cipa_members WHERE id = $1', [id]);
      const member = result.rows[0];
      if (!member) throw new NotFoundException('Membro não encontrado');
      return member;
    }

    const result = await client.query<CipaMember>(
      `UPDATE cipa_members SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    if (result.rows.length === 0) throw new NotFoundException('Membro não encontrado');
    return result.rows[0];
  }
}
```

- [ ] **Step 4: Criar os DTOs**

Criar `backend/src/cipa/dto/create-member.dto.ts`:

```ts
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateMemberDto {
  @IsUUID()
  company_unit_id: string;

  @IsString()
  @MaxLength(200)
  nome: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  funcao_empresa?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  setor?: string;

  @IsIn(['presidente', 'vice_presidente', 'secretario', 'membro'])
  funcao_cipa: string;

  @IsIn(['titular', 'suplente'])
  titular_suplente: string;

  @IsIn(['empregador', 'empregados'])
  representacao: string;

  @IsISO8601()
  inicio_mandato: string;

  @IsISO8601()
  fim_mandato: string;
}
```

Criar `backend/src/cipa/dto/update-member.dto.ts`:

```ts
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMemberDto {
  @IsOptional() @IsString() @MaxLength(200) nome?: string;
  @IsOptional() @IsString() @MaxLength(200) funcao_empresa?: string;
  @IsOptional() @IsString() @MaxLength(200) setor?: string;
  @IsOptional() @IsIn(['presidente', 'vice_presidente', 'secretario', 'membro']) funcao_cipa?: string;
  @IsOptional() @IsIn(['titular', 'suplente']) titular_suplente?: string;
  @IsOptional() @IsIn(['empregador', 'empregados']) representacao?: string;
  @IsOptional() @IsISO8601() inicio_mandato?: string;
  @IsOptional() @IsISO8601() fim_mandato?: string;
  @IsOptional() @IsIn(['ativo', 'inativo']) status?: string;
}
```

- [ ] **Step 5: Implementar `MembersController`**

Criar `backend/src/cipa/members.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { MembersService } from './members.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';

@Controller('cipa/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateMemberDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.members.create(client, req.user.tenantId, dto as any));
  }

  @Get()
  findAll(@Query('company_unit_id') companyUnitId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.members.findAll(client, companyUnitId));
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMemberDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.members.update(client, id, dto as Record<string, unknown>));
  }
}
```

- [ ] **Step 6: Registrar no `CipaModule`**

Modificar `backend/src/cipa/cipa.module.ts` — substituir o arquivo inteiro pelo conteúdo abaixo (acrescenta `MembersController`/`MembersService`; `DocumentsModule` e os controllers/services das tasks anteriores continuam idênticos):

```ts
import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { CommitteesController } from './committees.controller';
import { CommitteesService } from './committees.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  imports: [DocumentsModule],
  controllers: [CommitteesController, MeetingsController, MembersController],
  providers: [CommitteesService, MeetingsService, MembersService],
})
export class CipaModule {}
```

- [ ] **Step 7: Build e rodar os testes**

Run: `docker compose build backend && docker compose up -d backend`
Run (container efêmero): `... cipa-members`
Expected: PASS.

- [ ] **Step 8: Rodar a suíte completa e commitar**

```bash
git add backend/src/cipa backend/test/cipa-members.e2e-spec.ts
git commit -m "feat: CRUD de membros da CIPA (Fase 12a)"
```

---

## Task 5: PendenciasService (CRUD unificado de pendências/plano de ação)

**Files:**
- Create: `backend/src/cipa/pendencias.service.ts`
- Create: `backend/src/cipa/pendencias.controller.ts`
- Create: `backend/src/cipa/dto/create-pendencia.dto.ts`
- Create: `backend/src/cipa/dto/update-pendencia.dto.ts`
- Modify: `backend/src/cipa/cipa.module.ts` (registrar)
- Test: `backend/test/cipa-pendencias.e2e-spec.ts`

**Interfaces:**
- Produces: `CipaPendencia` interface, `PendenciasService` com `create`/`findAll`/`update`.

- [ ] **Step 1: Escrever o teste que falha primeiro**

Criar `backend/test/cipa-pendencias.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CRUD /cipa/pendencias (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let userId: string;
  let companyUnitId: string;
  let committeeId: string;
  let meetingId: string;
  let empresaToken: string;
  let pendenciaSoltaId: string;
  let pendenciaDeReuniaoId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA Pendencias Teste');
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
      `INSERT INTO cipa_meetings (tenant_id, committee_id, tipo, titulo)
       VALUES ($1, $2, 'extraordinaria', 'Reunião Teste Pendencias') RETURNING id`,
      [tenantId, committeeId],
    );
    meetingId = meetingResult.rows[0].id;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM cipa_committees WHERE id = $1', [committeeId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa registra pendência solta (sem reunião de origem) → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/cipa/pendencias')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        descricao: 'Instalar sinalização na área de risco',
        prazo: '2026-04-01',
        prioridade: 'alta',
      });

    expect(res.status).toBe(201);
    expect(res.body.meeting_id).toBeNull();
    expect(res.body.status).toBe('aberta');
    pendenciaSoltaId = res.body.id;
  });

  it('empresa registra pendência nascida de reunião (plano de ação) → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/cipa/pendencias')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        meeting_id: meetingId,
        descricao: 'Revisar procedimento de bloqueio de máquina',
        prazo: '2026-04-15',
        prioridade: 'media',
      });

    expect(res.status).toBe(201);
    expect(res.body.meeting_id).toBe(meetingId);
    pendenciaDeReuniaoId = res.body.id;
  });

  it('GET lista as duas pendências do estabelecimento', async () => {
    const res = await request(app.getHttpServer())
      .get(`/cipa/pendencias?company_unit_id=${companyUnitId}`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    const ids = res.body.map((p: { id: string }) => p.id);
    expect(ids).toContain(pendenciaSoltaId);
    expect(ids).toContain(pendenciaDeReuniaoId);
  });

  it('empresa marca pendência como concluída → 200', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/cipa/pendencias/${pendenciaSoltaId}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ status: 'concluida' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('concluida');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run (container efêmero): `... cipa-pendencias`
Expected: FAIL — rotas `/cipa/pendencias` ainda não existem (404).

- [ ] **Step 3: Implementar `PendenciasService`**

Criar `backend/src/cipa/pendencias.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';

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
}

const UPDATABLE_FIELDS = ['descricao', 'responsavel_user_id', 'prazo', 'prioridade', 'status'] as const;

@Injectable()
export class PendenciasService {
  async create(
    client: PoolClient,
    tenantId: string,
    companyUnitId: string,
    meetingId: string | undefined,
    descricao: string,
    responsavelUserId: string | undefined,
    prazo: string | undefined,
    prioridade: string | undefined,
  ): Promise<CipaPendencia> {
    const result = await client.query<CipaPendencia>(
      `INSERT INTO cipa_pendencias (tenant_id, company_unit_id, meeting_id, descricao, responsavel_user_id, prazo, prioridade)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'media')) RETURNING *`,
      [tenantId, companyUnitId, meetingId ?? null, descricao, responsavelUserId ?? null, prazo ?? null, prioridade ?? null],
    );
    return result.rows[0];
  }

  async findAll(client: PoolClient, companyUnitId?: string): Promise<CipaPendencia[]> {
    if (companyUnitId) {
      const result = await client.query<CipaPendencia>(
        'SELECT * FROM cipa_pendencias WHERE company_unit_id = $1 ORDER BY prazo NULLS LAST, created_at',
        [companyUnitId],
      );
      return result.rows;
    }
    const result = await client.query<CipaPendencia>(
      'SELECT * FROM cipa_pendencias ORDER BY prazo NULLS LAST, created_at',
    );
    return result.rows;
  }

  async update(client: PoolClient, id: string, data: Record<string, unknown>): Promise<CipaPendencia> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 2;
    for (const field of UPDATABLE_FIELDS) {
      if (data[field] !== undefined) {
        setClauses.push(`${field} = $${i++}`);
        values.push(data[field]);
      }
    }
    if (setClauses.length === 0) {
      const result = await client.query<CipaPendencia>('SELECT * FROM cipa_pendencias WHERE id = $1', [id]);
      const pendencia = result.rows[0];
      if (!pendencia) throw new NotFoundException('Pendência não encontrada');
      return pendencia;
    }

    const result = await client.query<CipaPendencia>(
      `UPDATE cipa_pendencias SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    if (result.rows.length === 0) throw new NotFoundException('Pendência não encontrada');
    return result.rows[0];
  }
}
```

- [ ] **Step 4: Criar os DTOs**

Criar `backend/src/cipa/dto/create-pendencia.dto.ts`:

```ts
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreatePendenciaDto {
  @IsUUID()
  company_unit_id: string;

  @IsOptional()
  @IsUUID()
  meeting_id?: string;

  @IsString()
  @MaxLength(1000)
  descricao: string;

  @IsOptional()
  @IsUUID()
  responsavel_user_id?: string;

  @IsOptional()
  @IsISO8601()
  prazo?: string;

  @IsOptional()
  @IsIn(['alta', 'media', 'baixa'])
  prioridade?: string;
}
```

Criar `backend/src/cipa/dto/update-pendencia.dto.ts`:

```ts
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdatePendenciaDto {
  @IsOptional() @IsString() @MaxLength(1000) descricao?: string;
  @IsOptional() @IsUUID() responsavel_user_id?: string;
  @IsOptional() @IsISO8601() prazo?: string;
  @IsOptional() @IsIn(['alta', 'media', 'baixa']) prioridade?: string;
  @IsOptional() @IsIn(['aberta', 'andamento', 'concluida', 'atrasada']) status?: string;
}
```

- [ ] **Step 5: Implementar `PendenciasController`**

Criar `backend/src/cipa/pendencias.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { PendenciasService } from './pendencias.service';
import { CreatePendenciaDto } from './dto/create-pendencia.dto';
import { UpdatePendenciaDto } from './dto/update-pendencia.dto';

@Controller('cipa/pendencias')
export class PendenciasController {
  constructor(private readonly pendencias: PendenciasService) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreatePendenciaDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.pendencias.create(
        client, req.user.tenantId, dto.company_unit_id, dto.meeting_id,
        dto.descricao, dto.responsavel_user_id, dto.prazo, dto.prioridade,
      ),
    );
  }

  @Get()
  findAll(@Query('company_unit_id') companyUnitId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.pendencias.findAll(client, companyUnitId));
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePendenciaDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.pendencias.update(client, id, dto as Record<string, unknown>));
  }
}
```

- [ ] **Step 6: Registrar no `CipaModule` (versão final)**

Modificar `backend/src/cipa/cipa.module.ts` — arquivo completo final:

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

@Module({
  imports: [DocumentsModule],
  controllers: [CommitteesController, MeetingsController, MembersController, PendenciasController],
  providers: [CommitteesService, MeetingsService, MembersService, PendenciasService],
})
export class CipaModule {}
```

- [ ] **Step 7: Build e rodar os testes**

Run: `docker compose build backend && docker compose up -d backend`
Run (container efêmero): `... cipa-pendencias`
Expected: PASS.

- [ ] **Step 8: Rodar a suíte completa, migração no-op e commitar**

Run: `docker exec montese_backend npm run db:migrate` (deve mostrar tudo `[skip] ... (já aplicada)`)
Run (container efêmero, suíte completa).
Expected: todas as suítes passando — soma final desta fase: 5 novas suítes (`cipa-committees`, `cipa-meetings`, `cipa-ata-approval`, `cipa-members`, `cipa-pendencias`) sobre a base da Fase 11.

```bash
git add backend/src/cipa backend/test/cipa-pendencias.e2e-spec.ts
git commit -m "feat: CRUD de pendências/plano de ação da CIPA (Fase 12a)"
```

---

## Depois da última task

1. Atualizar `docs/roadmap.md` com o status da Fase 12a (mesmo formato das entradas anteriores).
2. Escrever `docs/plans/fase-12b-central-cipa-frontend.md` a partir da API real e final desta metade (endpoints, formatos de request/response confirmados pelos testes, não só o resumo da spec) — só depois desta metade estar implantada e com a revisão final limpa.
3. Seguir com `superpowers:finishing-a-development-branch` — mesmo fluxo das Fases 9-11 (branch é `main` direto, sem remote configurado — o "finish" aqui é só confirmar suíte verde e reportar, sem menu de merge/PR).
