# Relatório de Visita Técnica — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o gap entre `docs/reference/modelos-relatorios-sst.md` e o módulo Inspeções real: filial+horário da visita, prazo/responsável de não-conformidade (colunas já existentes em `action_plans`, nunca expostas), e exportação em PDF indexada como Document real ao concluir a inspeção.

**Architecture:** Reaproveita 100% o padrão já em produção do CIPA (gerar PDF em memória com `pdfkit` → `DocumentsService.upload` → Document real, mesmo pipeline de indexação da Fase 24) e o padrão já em produção do checklist de prevenção (`assertCompanyUnitBelongsToTenant`). Nenhum subsistema novo — extensão de 2 tabelas existentes (`inspections` ganha 3 colunas nullable; `action_plans` só ganha um caminho de escrita pras colunas `deadline`/`responsible` que já existem desde a migration original) e 1 categoria nova de documento.

**Tech Stack:** NestJS + Postgres (RLS) + Next.js, `pdfkit` (já usado no CIPA), testes e2e reais (Postgres/Redis/R2 reais via `docker-compose.dev.yml` + overlay efêmero de Redis, Node 20 via nvm).

**Spec:** [`docs/specs/relatorio-visita-tecnica-pdf.md`](../specs/relatorio-visita-tecnica-pdf.md)

## Global Constraints

- `company_unit_id` em `inspections` é **nullable no schema** (não quebra inspeções já existentes), mas **obrigatório no DTO de criação** — toda inspeção criada a partir de agora precisa ter filial.
- `started_at`/`ended_at` são digitados manualmente pelo técnico (formato `HH:MM`), nunca capturados automaticamente pelo sistema.
- PDF é gerado **automaticamente ao concluir** a inspeção — nunca um botão separado de "gerar PDF".
- Falha ao gerar/indexar o PDF **nunca** impede a conclusão da inspeção (try/catch, log de warning, segue em frente) — a mudança de status e a geração de `action_plans` são a parte crítica do fluxo.
- `deadline`/`responsible` de `action_plans` são editáveis **mesmo com a inspeção já concluída** — diferente do resto do formulário, que trava após `concluir` (`assertDraft`).
- Assinatura eletrônica real, sugestão automática por IA dos campos novos, e edição/regeneração do PDF depois de concluído estão **fora de escopo** desta fase.
- **Toda mudança que torna `company_unit_id` obrigatório no DTO de criação quebra os testes e2e já existentes que criam inspeção sem esse campo** — ver nota específica na Task 1, é fallout esperado e precisa ser corrigido na mesma task, não descoberto depois.

---

## Pré-requisito: ambiente de testes do backend

Mesma nota já usada nas fases anteriores desta sessão: se `/opt/Montese/run-backend-tests.sh` não existir mais, recrie-o:

```bash
#!/bin/bash
set -e
cd "$(dirname "$0")/backend"
set -a; source ../.env; set +a
export DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@localhost:5432/${POSTGRES_DB}"
export REDIS_URL="redis://localhost:6379"
export AUTH_RATE_LIMIT_MAX=1000
export AUTH_RATE_LIMIT_WINDOW_SECONDS=1
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm use 20 > /dev/null
export NODE_OPTIONS=--experimental-vm-modules
npx "$@"
```

`chmod +x /opt/Montese/run-backend-tests.sh`. Antes de testes que precisem de Postgres/Redis reais (e2e), exponha as portas (nunca crie `docker-compose.override.yml`):

```bash
cd /opt/Montese
cat > docker-compose.dev-redis-temp.yml <<'EOF'
services:
  redis:
    ports:
      - "127.0.0.1:6379:6379"
EOF
docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.dev-redis-temp.yml up -d postgres redis
```

Ao terminar TODOS os testes e2e da fase (fim da Task 3), restaure a stack:

```bash
cd /opt/Montese
rm docker-compose.dev-redis-temp.yml
docker compose up -d postgres redis
```

---

## Task 1: Filial e horário da visita em `inspections`

**Files:**
- Create: `backend/db/migrations/0045_inspection_report_fields.sql`
- Modify: `backend/src/inspections/dto/create-inspection.dto.ts`
- Modify: `backend/src/inspections/dto/update-inspection.dto.ts`
- Modify: `backend/src/inspections/inspections.service.ts`
- Modify: `backend/src/inspections/inspections.controller.ts`
- Test: `backend/test/inspections-fields.unit-spec.ts` (novo)
- Modify (fallout obrigatório — ver nota abaixo): `backend/test/inspections-partner.e2e-spec.ts`, `backend/test/inspections-ai-draft.e2e-spec.ts`, `backend/test/inspections-conclude.e2e-spec.ts`, `backend/test/inspections-create-list.e2e-spec.ts`, `backend/test/inspections-update.e2e-spec.ts`

**Interfaces:**
- Consumes: nenhuma (task isolada, primeira da fase).
- Produces: `Inspection.company_unit_id: string | null`, `Inspection.started_at: string | null`, `Inspection.ended_at: string | null`; `InspectionsService.create(client, tenantId, technicianUserId, visitedAt, companyUnitId, startedAt, endedAt)`; `InspectionDetail.tenant_cnpj: string`, `InspectionDetail.company_unit_address: string | null` (resolvidos em `findOne` — Task 3 e Task 4 dependem desses 2 campos existirem).

**Nota crítica antes de começar — leia isto primeiro**: hoje `POST /inspections` só exige `tenant_id`/`visited_at`. Depois desta task, `company_unit_id` passa a ser **obrigatório** no DTO. Isso quebra, de forma esperada e mecânica, **11 chamadas `.post('/inspections')` em 5 arquivos de teste e2e já existentes** (`inspections-partner.e2e-spec.ts`, `inspections-ai-draft.e2e-spec.ts`, `inspections-conclude.e2e-spec.ts` — 5 chamadas, `inspections-create-list.e2e-spec.ts` — 3 chamadas, `inspections-update.e2e-spec.ts`), porque nenhum deles cria uma filial nem envia `company_unit_id` hoje. Isso é fallout esperado desta task, não uma extensão de escopo — corrija os 5 arquivos como parte desta task (não é opcional, e não deixe pra descobrir rodando a suíte no fim: já leia cada arquivo, adicione um `INSERT INTO company_units (...)` no `beforeAll` de cada um — mesmo padrão exato usado em `backend/test/cipa-ata-approval.e2e-spec.ts:34-39` — e adicione `company_unit_id: unitId` em cada payload de criação). `inspections-rls.e2e-spec.ts` cria inspeção via `INSERT INTO inspections` direto (não via DTO) — não é afetado, não precisa mexer nele.

- [ ] **Step 1: Ler os arquivos reais atuais antes de editar**

Leia por completo: `backend/src/inspections/inspections.service.ts`, `backend/src/inspections/inspections.controller.ts`, `backend/src/inspections/dto/create-inspection.dto.ts`, `backend/src/inspections/dto/update-inspection.dto.ts`, `backend/src/prevention-checklist/prevention-checklist.service.ts` (método `assertCompanyUnitBelongsToTenant`, pra copiar o padrão exato). Se algo divergir do que este plano descreve, **o código real vence** — adapte, documentando a divergência no seu relatório.

- [ ] **Step 2: Criar a migration**

`backend/db/migrations/0045_inspection_report_fields.sql`:

```sql
-- Fecha o gap entre docs/reference/modelos-relatorios-sst.md (seção 2,
-- "Identificação": empresa, CNPJ, endereço, horário da visita) e o que
-- inspections.visited_at sozinho (só data) suporta hoje. Nullable: não
-- quebra as inspeções já existentes em produção sem esse dado — o DTO
-- de criação exige o campo pra toda inspeção NOVA, a coluna em si fica
-- nullable no schema.
ALTER TABLE inspections ADD COLUMN company_unit_id UUID REFERENCES company_units(id) ON DELETE SET NULL;
ALTER TABLE inspections ADD COLUMN started_at TIME;
ALTER TABLE inspections ADD COLUMN ended_at TIME;

CREATE INDEX inspections_company_unit_id_idx ON inspections (company_unit_id);
```

- [ ] **Step 3: Aplicar a migration**

Run: `./run-backend-tests.sh db:migrate` (a partir de `/opt/Montese`; confirme antes com `docker exec montese_postgres psql -U "$POSTGRES_SUPERUSER" -d "$POSTGRES_DB" -c "SELECT name FROM _migrations ORDER BY name DESC LIMIT 1;"` que `0044` é a última aplicada).

Expected: `[apply] 0045_inspection_report_fields.sql` / `[ok]`.

- [ ] **Step 4: Atualizar `CreateInspectionDto`**

`backend/src/inspections/dto/create-inspection.dto.ts`:

```typescript
import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

export class CreateInspectionDto {
  @IsUUID()
  tenant_id: string;

  @IsISO8601()
  visited_at: string;

  @IsUUID()
  company_unit_id: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'started_at deve estar no formato HH:MM' })
  started_at?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'ended_at deve estar no formato HH:MM' })
  ended_at?: string;
}
```

- [ ] **Step 5: Atualizar `UpdateInspectionDto`**

`backend/src/inspections/dto/update-inspection.dto.ts` — adicione ao arquivo já existente (mantendo os campos atuais intactos):

```typescript
import { IsInt, IsOptional, IsString, MaxLength, Matches, Min } from 'class-validator';

export class UpdateInspectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company_contact?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  dds_topic?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  dds_participants_count?: number;

  @IsOptional()
  @IsString()
  dds_notes?: string;

  @IsOptional()
  @IsString()
  general_recommendations?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  technician_signature_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  company_signature_name?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'started_at deve estar no formato HH:MM' })
  started_at?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'ended_at deve estar no formato HH:MM' })
  ended_at?: string;
}
```

- [ ] **Step 6: Escrever os testes unitários do service ANTES de mudar `inspections.service.ts`**

`backend/test/inspections-fields.unit-spec.ts` (novo — testa `assertCompanyUnitBelongsToTenant`/`create`/`resolveIdentification` isoladamente, sem precisar de Postgres real):

```typescript
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { InspectionsService } from '../src/inspections/inspections.service';
import { DocumentsService } from '../src/documents/documents.service';

describe('InspectionsService — filial e identificação', () => {
  let service: InspectionsService;
  const fakeDocuments = { upload: jest.fn() };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [InspectionsService, { provide: DocumentsService, useValue: fakeDocuments }],
    }).compile();
    service = moduleRef.get(InspectionsService);
  });

  function fakeClient(handlers: Record<string, unknown>): PoolClient {
    return {
      query: jest.fn(async (sql: string) => {
        for (const [pattern, result] of Object.entries(handlers)) {
          if (sql.includes(pattern)) return result;
        }
        throw new Error(`query inesperada no fake: ${sql}`);
      }),
    } as unknown as PoolClient;
  }

  describe('create', () => {
    it('lança NotFoundException quando a filial não pertence ao tenant', async () => {
      const client = fakeClient({ 'FROM company_units': { rowCount: 0, rows: [] } });
      await expect(
        service.create(client, 'tenant-1', 'user-1', '2026-09-15', 'unidade-de-outro-tenant', undefined, undefined),
      ).rejects.toThrow(NotFoundException);
    });

    it('grava company_unit_id/started_at/ended_at quando a filial pertence ao tenant', async () => {
      const insertedInspection = {
        id: 'insp-1',
        tenant_id: 'tenant-1',
        company_unit_id: 'unidade-1',
        started_at: '08:00',
        ended_at: '10:30',
        visited_at: '2026-09-15',
      };
      // Patterns precisam ser substrings que não colidam entre si: as 3
      // primeiras entradas casam com 3 queries de company_units/tenants
      // DIFERENTES (assertCompanyUnitBelongsToTenant + as 2 de
      // resolveIdentification, que create() também chama agora) — um
      // padrão genérico demais (ex.: só 'FROM company_units') bateria
      // com mais de uma query e o fake devolveria o resultado errado
      // pra uma delas sem avisar.
      const client = fakeClient({
        'company_units WHERE id = $1 AND tenant_id': { rowCount: 1, rows: [{ id: 'unidade-1' }] },
        'SELECT cnpj FROM tenants': { rows: [{ cnpj: '12345678000199' }] },
        address_street: {
          rows: [{ address_street: 'Rua Teste', address_number: '100', address_city: 'São Paulo', address_state: 'SP' }],
        },
        'INSERT INTO inspections': { rows: [insertedInspection] },
        'INSERT INTO inspection_checklist_items': { rows: [] },
      });

      const result = await service.create(client, 'tenant-1', 'user-1', '2026-09-15', 'unidade-1', '08:00', '10:30');

      expect(result.company_unit_id).toBe('unidade-1');
      expect(result.started_at).toBe('08:00');
      expect(result.ended_at).toBe('10:30');
      expect(result.tenant_cnpj).toBe('12345678000199');
      expect(result.company_unit_address).toBe('Rua Teste, 100 — São Paulo/SP');
    });
  });

  describe('resolveIdentification (via findOne)', () => {
    it('resolve CNPJ do tenant e endereço formatado da filial', async () => {
      const client = fakeClient({
        'FROM inspections WHERE id': {
          rows: [{ id: 'insp-1', tenant_id: 'tenant-1', company_unit_id: 'unidade-1' }],
        },
        'FROM inspection_checklist_items': { rows: [] },
        'FROM action_plans': { rows: [] },
        'FROM tenants WHERE id': { rows: [{ cnpj: '12345678000199' }] },
        'FROM company_units WHERE id': {
          rows: [{ address_street: 'Rua Teste', address_number: '100', address_city: 'São Paulo', address_state: 'SP' }],
        },
      });

      const detail = await service.findOne(client, 'insp-1');

      expect(detail.tenant_cnpj).toBe('12345678000199');
      expect(detail.company_unit_address).toBe('Rua Teste, 100 — São Paulo/SP');
    });

    it('company_unit_address fica null quando a inspeção não tem filial', async () => {
      const client = fakeClient({
        'FROM inspections WHERE id': {
          rows: [{ id: 'insp-1', tenant_id: 'tenant-1', company_unit_id: null }],
        },
        'FROM inspection_checklist_items': { rows: [] },
        'FROM action_plans': { rows: [] },
        'FROM tenants WHERE id': { rows: [{ cnpj: '12345678000199' }] },
      });

      const detail = await service.findOne(client, 'insp-1');

      expect(detail.company_unit_address).toBeNull();
    });
  });
});
```

- [ ] **Step 7: Rodar e confirmar que os testes falham (função ainda não existe/não aceita os parâmetros novos)**

Run: `cd /opt/Montese && ./run-backend-tests.sh test:unit -- "inspections-fields"`
Expected: FAIL — `create`/`findOne` ainda não aceitam os parâmetros/campos novos.

- [ ] **Step 8: Implementar em `inspections.service.ts`**

Reescreva o arquivo completo:

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { buildSafeSetClause } from '../common/safe-update.util';
import { CHECKLIST_ITEMS, ChecklistBlock } from './checklist-items.const';
import { DocumentsService } from '../documents/documents.service';
import { buildInspectionPdf } from './inspection-pdf.util';

export interface Inspection {
  id: string;
  tenant_id: string;
  technician_user_id: string;
  status: 'rascunho' | 'concluida';
  visited_at: string;
  company_unit_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  company_contact: string | null;
  dds_topic: string | null;
  dds_participants_count: number | null;
  dds_notes: string | null;
  general_recommendations: string | null;
  technician_signature_name: string | null;
  technician_signature_at: string | null;
  company_signature_name: string | null;
  company_signature_at: string | null;
  concluded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  id: string;
  inspection_id: string;
  block: ChecklistBlock;
  item_key: string;
  item_label: string;
  status: 'C' | 'NC' | 'NA' | null;
  notes: string | null;
}

export interface ActionPlan {
  id: string;
  tenant_id: string;
  inspection_id: string;
  checklist_item_id: string | null;
  description: string;
  deadline: string | null;
  responsible: string | null;
  status: 'pendente' | 'resolvido';
  created_at: string;
}

export interface InspectionDetail extends Inspection {
  items: ChecklistItem[];
  action_plans: ActionPlan[];
  tenant_cnpj: string;
  company_unit_address: string | null;
}

const INSPECTION_UPDATABLE_FIELDS = [
  'company_contact',
  'dds_topic',
  'dds_participants_count',
  'dds_notes',
  'general_recommendations',
  'technician_signature_name',
  'company_signature_name',
  'started_at',
  'ended_at',
] as const;

const CHECKLIST_ITEM_UPDATABLE_FIELDS = ['status', 'notes'] as const;
const ACTION_PLAN_UPDATABLE_FIELDS = ['deadline', 'responsible', 'status'] as const;

@Injectable()
export class InspectionsService {
  constructor(private readonly documents: DocumentsService) {}

  private async assertCompanyUnitBelongsToTenant(client: PoolClient, companyUnitId: string, tenantId: string): Promise<void> {
    const result = await client.query('SELECT id FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (result.rowCount === 0) throw new NotFoundException('Filial não encontrada');
  }

  private async resolveIdentification(
    client: PoolClient,
    tenantId: string,
    companyUnitId: string | null,
  ): Promise<{ tenant_cnpj: string; company_unit_address: string | null }> {
    const tenantResult = await client.query<{ cnpj: string }>('SELECT cnpj FROM tenants WHERE id = $1', [tenantId]);

    let companyUnitAddress: string | null = null;
    if (companyUnitId) {
      const unitResult = await client.query<{
        address_street: string;
        address_number: string | null;
        address_city: string;
        address_state: string;
      }>(
        'SELECT address_street, address_number, address_city, address_state FROM company_units WHERE id = $1',
        [companyUnitId],
      );
      const unit = unitResult.rows[0];
      if (unit) {
        companyUnitAddress = `${unit.address_street}${unit.address_number ? `, ${unit.address_number}` : ''} — ${unit.address_city}/${unit.address_state}`;
      }
    }

    return { tenant_cnpj: tenantResult.rows[0].cnpj, company_unit_address: companyUnitAddress };
  }

  async create(
    client: PoolClient,
    tenantId: string,
    technicianUserId: string,
    visitedAt: string,
    companyUnitId: string,
    startedAt: string | undefined,
    endedAt: string | undefined,
  ): Promise<InspectionDetail> {
    await this.assertCompanyUnitBelongsToTenant(client, companyUnitId, tenantId);

    try {
      const inspectionResult = await client.query<Inspection>(
        `INSERT INTO inspections (tenant_id, technician_user_id, visited_at, company_unit_id, started_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [tenantId, technicianUserId, visitedAt, companyUnitId, startedAt ?? null, endedAt ?? null],
      );
      const inspection = inspectionResult.rows[0];

      const values: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const { block, item_key, item_label } of CHECKLIST_ITEMS) {
        values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
        params.push(inspection.id, block, item_key, item_label);
      }
      const itemsResult = await client.query<ChecklistItem>(
        `INSERT INTO inspection_checklist_items (inspection_id, block, item_key, item_label)
         VALUES ${values.join(', ')} RETURNING *`,
        params,
      );

      // Reaproveita resolveIdentification (mesma lógica de findOne) em
      // vez de devolver tenant_cnpj/company_unit_address vazios só pra
      // satisfazer o tipo — o frontend não usa esses 2 campos da
      // resposta de create() hoje (navega direto pra tela de detalhe,
      // que já busca tudo de novo via findOne), mas devolver um valor
      // estruturalmente errado (string vazia) é pior que uma query a
      // mais, que já ia acontecer de qualquer forma segundos depois.
      const identification = await this.resolveIdentification(client, tenantId, companyUnitId);

      return {
        ...inspection,
        items: itemsResult.rows,
        action_plans: [],
        ...identification,
      };
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(client: PoolClient, tenantId?: string): Promise<Inspection[]> {
    if (tenantId) {
      const result = await client.query<Inspection>(
        'SELECT * FROM inspections WHERE tenant_id = $1 ORDER BY visited_at DESC',
        [tenantId],
      );
      return result.rows;
    }
    const result = await client.query<Inspection>('SELECT * FROM inspections ORDER BY visited_at DESC');
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<InspectionDetail> {
    const inspectionResult = await client.query<Inspection>('SELECT * FROM inspections WHERE id = $1', [id]);
    const inspection = inspectionResult.rows[0];
    if (!inspection) throw new NotFoundException('Inspeção não encontrada');

    const itemsResult = await client.query<ChecklistItem>(
      'SELECT * FROM inspection_checklist_items WHERE inspection_id = $1 ORDER BY block, item_key',
      [id],
    );
    const actionPlansResult = await client.query<ActionPlan>(
      'SELECT * FROM action_plans WHERE inspection_id = $1 ORDER BY created_at',
      [id],
    );
    const identification = await this.resolveIdentification(client, inspection.tenant_id, inspection.company_unit_id);

    return { ...inspection, ...identification, items: itemsResult.rows, action_plans: actionPlansResult.rows };
  }

  private async assertDraft(client: PoolClient, id: string): Promise<void> {
    const result = await client.query<{ status: string }>(
      'SELECT status FROM inspections WHERE id = $1 FOR UPDATE',
      [id],
    );
    const inspection = result.rows[0];
    if (!inspection) throw new NotFoundException('Inspeção não encontrada');
    if (inspection.status !== 'rascunho') {
      throw new ConflictException('Inspeção já concluída — não pode mais ser editada');
    }
  }

  async update(client: PoolClient, id: string, data: Partial<Inspection>): Promise<Inspection> {
    await this.assertDraft(client, id);

    const { setClauses, values } = buildSafeSetClause(data, INSPECTION_UPDATABLE_FIELDS, 2);
    if ((data as any).technician_signature_name !== undefined) {
      setClauses.push('technician_signature_at = now()');
    }
    if ((data as any).company_signature_name !== undefined) {
      setClauses.push('company_signature_at = now()');
    }

    if (setClauses.length === 0) {
      const result = await client.query<Inspection>('SELECT * FROM inspections WHERE id = $1', [id]);
      return result.rows[0];
    }

    const result = await client.query<Inspection>(
      `UPDATE inspections SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    return result.rows[0];
  }

  async updateItem(
    client: PoolClient,
    inspectionId: string,
    itemId: string,
    data: Partial<ChecklistItem>,
  ): Promise<ChecklistItem> {
    await this.assertDraft(client, inspectionId);

    const { setClauses, values } = buildSafeSetClause(data, CHECKLIST_ITEM_UPDATABLE_FIELDS, 3);
    if (setClauses.length === 0) {
      const result = await client.query<ChecklistItem>(
        'SELECT * FROM inspection_checklist_items WHERE id = $1 AND inspection_id = $2',
        [itemId, inspectionId],
      );
      const item = result.rows[0];
      if (!item) throw new NotFoundException('Item de checklist não encontrado');
      return item;
    }

    const result = await client.query<ChecklistItem>(
      `UPDATE inspection_checklist_items SET ${setClauses.join(', ')}
       WHERE id = $1 AND inspection_id = $2 RETURNING *`,
      [itemId, inspectionId, ...values],
    );
    const item = result.rows[0];
    if (!item) throw new NotFoundException('Item de checklist não encontrado');
    return item;
  }

  async conclude(client: PoolClient, id: string, userId: string, userRole: 'tecnico' | 'parceiro'): Promise<InspectionDetail> {
    await this.assertDraft(client, id);

    const updateResult = await client.query<{ tenant_id: string }>(
      `UPDATE inspections SET status = 'concluida', concluded_at = now() WHERE id = $1 RETURNING tenant_id`,
      [id],
    );
    const tenantId = updateResult.rows[0].tenant_id;

    const ncItemsResult = await client.query<ChecklistItem>(
      `SELECT * FROM inspection_checklist_items WHERE inspection_id = $1 AND status = 'NC'`,
      [id],
    );

    for (const item of ncItemsResult.rows) {
      await client.query(
        `INSERT INTO action_plans (tenant_id, inspection_id, checklist_item_id, description)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, id, item.id, item.item_label],
      );
    }

    const detail = await this.findOne(client, id);

    try {
      const tenantResult = await client.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [
        detail.tenant_id,
      ]);
      const pdfBuffer = await buildInspectionPdf(detail, {
        tenantName: tenantResult.rows[0].name,
        tenantCnpj: detail.tenant_cnpj,
        companyUnitAddress: detail.company_unit_address,
      });
      await this.documents.upload(client, {
        tenantId: detail.tenant_id,
        category: 'relatorio_visita',
        title: `Relatório de Visita — ${detail.visited_at}`,
        file: {
          buffer: pdfBuffer,
          mimetype: 'application/pdf',
          originalname: `relatorio-visita-${detail.id.slice(0, 8)}.pdf`,
          size: pdfBuffer.length,
        },
        uploadedByUserId: userId,
        uploadedByRole: userRole,
        companyUnitId: detail.company_unit_id ?? undefined,
      });
    } catch (err) {
      // Nunca derruba a conclusão da inspeção por causa do PDF.
      console.warn(`Falha ao gerar/indexar PDF da inspeção ${id}: ${(err as Error).message}`);
    }

    return detail;
  }

  async findActionPlans(client: PoolClient, tenantId?: string): Promise<ActionPlan[]> {
    if (tenantId) {
      const result = await client.query<ActionPlan>(
        'SELECT * FROM action_plans WHERE tenant_id = $1 ORDER BY created_at DESC',
        [tenantId],
      );
      return result.rows;
    }
    const result = await client.query<ActionPlan>('SELECT * FROM action_plans ORDER BY created_at DESC');
    return result.rows;
  }

  async updateActionPlan(client: PoolClient, id: string, data: Partial<ActionPlan>): Promise<ActionPlan> {
    const { setClauses, values } = buildSafeSetClause(data, ACTION_PLAN_UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) {
      const result = await client.query<ActionPlan>('SELECT * FROM action_plans WHERE id = $1', [id]);
      const plan = result.rows[0];
      if (!plan) throw new NotFoundException('Ação corretiva não encontrada');
      return plan;
    }
    const result = await client.query<ActionPlan>(
      `UPDATE action_plans SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    const plan = result.rows[0];
    if (!plan) throw new NotFoundException('Ação corretiva não encontrada');
    return plan;
  }
}
```

**Atenção — isto é só a Task 1**: o `import { buildInspectionPdf } from './inspection-pdf.util'` e a chamada dentro de `conclude()` referenciam um arquivo que só é criado na **Task 3**. Para esta task compilar e os testes desta task passarem, **comente essas duas linhas por enquanto** (o `import` e o bloco `try` inteiro que chama `buildInspectionPdf`/`this.documents.upload`), deixando só a lógica de `company_unit_id`/`started_at`/`ended_at`/`resolveIdentification` funcionando. A Task 3 descomenta e completa isso. Documente isso claramente no seu relatório — não é normal deixar código comentado, mas aqui é uma dependência real entre tasks do mesmo plano, não um placeholder esquecido.

- [ ] **Step 9: Atualizar `inspections.controller.ts`**

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
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { envInt } from '../common/env';
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

  @Roles('tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateInspectionDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.inspections.create(client, dto.tenant_id, req.user.id, dto.visited_at, dto.company_unit_id, dto.started_at, dto.ended_at),
    );
  }

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    if ((req.user.role === 'tecnico' || req.user.role === 'parceiro') && !tenantId) {
      throw new BadRequestException('tenant_id é obrigatório');
    }
    return req.withTenantContext((client: any) => this.inspections.findAll(client, tenantId));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.inspections.findOne(client, id));
  }

  @Roles('tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateInspectionDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.inspections.update(client, id, dto));
  }

  @Roles('tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateChecklistItemDto,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) => this.inspections.updateItem(client, id, itemId, dto));
  }

  @Roles('tecnico', 'parceiro')
  @RateLimit({
    limit: envInt('AI_DRAFT_RATE_LIMIT_MAX', 20),
    windowSeconds: envInt('AI_DRAFT_RATE_LIMIT_WINDOW_SECONDS', 3600),
    keyBy: 'ip',
  })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/ai-draft')
  async aiDraft(@Param('id') id: string, @Body() dto: AiDraftDto, @Req() req: any) {
    await req.withTenantContext((client: any) => this.inspections.findOne(client, id));
    return this.extractor.extract(dto.report_text);
  }

  @Roles('tecnico', 'parceiro')
  @Post(':id/concluir')
  conclude(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.inspections.conclude(client, id, req.user.id, req.user.role),
    );
  }
}
```

- [ ] **Step 10: Rodar e confirmar que os testes unitários da Task 1 passam**

Run: `cd /opt/Montese && ./run-backend-tests.sh test:unit -- "inspections-fields"`
Expected: `4 passed`.

- [ ] **Step 11: Tipos**

Run: `cd /opt/Montese/backend && npx tsc --noEmit`
Expected: sem erros (lembre do Step 8 — o import/chamada de `buildInspectionPdf` precisa estar comentado nesta task, senão vai dar erro de módulo não encontrado).

- [ ] **Step 12: Corrigir o fallout nos 5 arquivos de teste e2e existentes**

Para cada um de `inspections-partner.e2e-spec.ts`, `inspections-ai-draft.e2e-spec.ts`, `inspections-conclude.e2e-spec.ts`, `inspections-create-list.e2e-spec.ts`, `inspections-update.e2e-spec.ts`:

1. Leia o `beforeAll` do arquivo. Adicione, logo depois da criação do tenant/usuário, uma filial real:

```typescript
const unitResult = await (db as any).client.query(
  `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
   VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
  [tenantId],
);
const companyUnitId = unitResult.rows[0].id;
```

(ajuste o nome da variável `tenantId` pro nome real usado em cada arquivo — pode divergir ligeiramente entre eles, confira antes de copiar.)

2. Em TODA chamada `.post('/inspections')` do arquivo, adicione `company_unit_id: companyUnitId` ao corpo enviado (`.send({...})`).

- [ ] **Step 13: Rodar a regressão e2e completa dos 6 arquivos de Inspeções**

Exponha Postgres/Redis reais (ver "Pré-requisito" no topo deste plano).

Run: `cd /opt/Montese && ./run-backend-tests.sh test:e2e -- "inspections"`
Expected: todos os 6 arquivos (`inspections-partner`, `inspections-ai-draft`, `inspections-conclude`, `inspections-create-list`, `inspections-update`, `inspections-rls`) passam, sem nenhuma falha de validação por `company_unit_id` ausente.

- [ ] **Step 14: Restaurar a stack Docker sem exposição de porta**

```bash
cd /opt/Montese
rm docker-compose.dev-redis-temp.yml
docker compose up -d postgres redis
```

- [ ] **Step 15: Commit**

```bash
cd /opt/Montese
git add backend/db/migrations/0045_inspection_report_fields.sql \
  backend/src/inspections/dto/create-inspection.dto.ts \
  backend/src/inspections/dto/update-inspection.dto.ts \
  backend/src/inspections/inspections.service.ts \
  backend/src/inspections/inspections.controller.ts \
  backend/test/inspections-fields.unit-spec.ts \
  backend/test/inspections-partner.e2e-spec.ts \
  backend/test/inspections-ai-draft.e2e-spec.ts \
  backend/test/inspections-conclude.e2e-spec.ts \
  backend/test/inspections-create-list.e2e-spec.ts \
  backend/test/inspections-update.e2e-spec.ts
git commit -m "feat: filial e horário da visita em Inspeções (Relatório de Visita Técnica)"
```

---

## Task 2: `PATCH /action-plans/:id` (prazo/responsável/status)

**Files:**
- Create: `backend/src/inspections/dto/update-action-plan.dto.ts`
- Modify: `backend/src/inspections/action-plans.controller.ts`
- Test: `backend/test/action-plans-update.e2e-spec.ts` (novo)

**Interfaces:**
- Consumes: `InspectionsService.updateActionPlan` (Task 1, já implementado no arquivo do service).
- Produces: `PATCH /action-plans/:id` — consumido pela Task 4 (frontend).

- [ ] **Step 1: Ler o arquivo real atual**

Leia `backend/src/inspections/action-plans.controller.ts` e `backend/src/prevention-corrective-actions/prevention-corrective-actions.controller.ts` (mesmo padrão de PATCH já em produção pra ação corretiva do checklist de prevenção). Se algo divergir deste plano, o código real vence.

- [ ] **Step 2: Criar o DTO**

`backend/src/inspections/dto/update-action-plan.dto.ts`:

```typescript
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateActionPlanDto {
  @IsOptional()
  @IsISO8601()
  deadline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  responsible?: string;

  @IsOptional()
  @IsIn(['pendente', 'resolvido'])
  status?: 'pendente' | 'resolvido';
}
```

- [ ] **Step 3: Escrever o teste e2e ANTES de adicionar a rota**

`backend/test/action-plans-update.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('PATCH /action-plans/:id (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let userId: string;
  let companyUnitId: string;
  let token: string;
  let actionPlanId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Action Plans Update Teste');
    tenantId = tenant.tenantId;
    userId = tenant.userId;
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${token}`)
      .send({ tenant_id: tenantId, visited_at: '2026-09-15', company_unit_id: companyUnitId });
    const inspectionId = createRes.body.id;

    const items = createRes.body.items as { id: string; block: string }[];
    const firstItem = items[0];
    await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${firstItem.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'NC' });

    const concludeRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${token}`);
    actionPlanId = concludeRes.body.action_plans[0].id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('atualiza deadline e responsible de uma ação corretiva', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/action-plans/${actionPlanId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ deadline: '2026-10-01', responsible: 'João Silva' });

    expect(res.status).toBe(200);
    expect(res.body.deadline.slice(0, 10)).toBe('2026-10-01');
    expect(res.body.responsible).toBe('João Silva');
  });

  it('atualiza status pra resolvido', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/action-plans/${actionPlanId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'resolvido' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolvido');
  });

  it('rejeita status inválido (fora de pendente/resolvido)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/action-plans/${actionPlanId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'em_andamento' });

    expect(res.status).toBe(400);
  });

  it('funciona mesmo com a inspeção já concluída (deadline/responsible não travam com assertDraft)', async () => {
    // A inspeção de origem já foi concluída no beforeAll — este PATCH
    // confirma que updateActionPlan não chama assertDraft (decisão da
    // spec §2: prazo/responsável continuam editáveis pós-conclusão).
    const res = await request(app.getHttpServer())
      .patch(`/action-plans/${actionPlanId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ responsible: 'Maria Souza' });

    expect(res.status).toBe(200);
    expect(res.body.responsible).toBe('Maria Souza');
  });
});
```

- [ ] **Step 4: Rodar e confirmar que falha (rota ainda não existe)**

Exponha Postgres/Redis reais (ver "Pré-requisito").

Run: `cd /opt/Montese && ./run-backend-tests.sh test:e2e -- "action-plans-update"`
Expected: FAIL — `PATCH /action-plans/:id` devolve 404 (rota não existe).

- [ ] **Step 5: Adicionar a rota em `action-plans.controller.ts`**

Reescreva o arquivo completo:

```typescript
import { BadRequestException, Body, Controller, Get, Param, Patch, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { InspectionsService } from './inspections.service';
import { UpdateActionPlanDto } from './dto/update-action-plan.dto';

@Controller('action-plans')
export class ActionPlansController {
  constructor(private readonly inspections: InspectionsService) {}

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    if ((req.user.role === 'tecnico' || req.user.role === 'parceiro') && !tenantId) {
      throw new BadRequestException('tenant_id é obrigatório');
    }
    return req.withTenantContext((client: any) => this.inspections.findActionPlans(client, tenantId));
  }

  @Roles('tecnico', 'parceiro', 'empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateActionPlanDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.inspections.updateActionPlan(client, id, dto));
  }
}
```

- [ ] **Step 6: Rodar e confirmar que os 4 testes passam**

Run: `cd /opt/Montese && ./run-backend-tests.sh test:e2e -- "action-plans-update"`
Expected: `4 passed`.

- [ ] **Step 7: Regressão — confirmar que os e2e de Inspeções da Task 1 continuam passando**

Run: `cd /opt/Montese && ./run-backend-tests.sh test:e2e -- "inspections"`
Expected: sem quebra.

- [ ] **Step 8: Restaurar a stack Docker**

```bash
cd /opt/Montese
rm docker-compose.dev-redis-temp.yml
docker compose up -d postgres redis
```

- [ ] **Step 9: Tipos e commit**

Run: `cd /opt/Montese/backend && npx tsc --noEmit` — sem erros.

```bash
cd /opt/Montese
git add backend/src/inspections/dto/update-action-plan.dto.ts \
  backend/src/inspections/action-plans.controller.ts \
  backend/test/action-plans-update.e2e-spec.ts
git commit -m "feat: PATCH /action-plans/:id expõe prazo e responsável (Relatório de Visita Técnica)"
```

---

## Task 3: Geração de PDF e indexação como Document ao concluir

**Files:**
- Create: `backend/src/inspections/inspection-pdf.util.ts`
- Modify: `backend/src/inspections/inspections.service.ts:1-3` (descomentar o import e o bloco de PDF deixados comentados na Task 1)
- Modify: `backend/src/inspections/inspections.module.ts`
- Modify: `backend/src/documents/documents.service.ts` (adicionar `'relatorio_visita'` a `ALLOWED_CATEGORIES`)
- Test: `backend/test/inspection-pdf.e2e-spec.ts` (novo)

**Interfaces:**
- Consumes: `InspectionDetail` completo (Task 1, já tem `tenant_cnpj`/`company_unit_address`/`started_at`/`ended_at`), `DocumentsService.upload` (já existe).
- Produces: `buildInspectionPdf(inspection, ctx): Promise<Buffer>` — usado só dentro de `InspectionsService.conclude`, não é consumido por nenhuma task posterior.

- [ ] **Step 1: Ler os arquivos reais atuais antes de editar**

Leia por completo `backend/src/cipa/ata-pdf.util.ts` (padrão exato de geração de PDF em memória com `pdfkit`), `backend/src/cipa/meetings.service.ts` (trecho que chama `buildAtaPdf` + `documents.upload`, pra confirmar o padrão de integração), `backend/src/documents/documents.service.ts` (`ALLOWED_CATEGORIES`, interface `UploadData`), `backend/test/cipa-ata-approval.e2e-spec.ts` (padrão de teste que baixa o PDF real do R2 e confirma o texto com `pdf-parse`). Se algo divergir deste plano, o código real vence.

- [ ] **Step 2: Adicionar a categoria nova em `documents.service.ts`**

Em `backend/src/documents/documents.service.ts`, altere `ALLOWED_CATEGORIES`:

```typescript
const ALLOWED_CATEGORIES = [
  'pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento',
  'cipa_ata', 'cipa_comunicado', 'cipa_documento_eleitoral', 'cipa_anexo',
  'ltcat', 'lip',
  'relatorio_visita',
];
```

- [ ] **Step 3: Criar `inspection-pdf.util.ts`**

```typescript
import PDFDocument from 'pdfkit';
import { InspectionDetail } from './inspections.service';

interface InspectionPdfContext {
  tenantName: string;
  tenantCnpj: string;
  companyUnitAddress: string | null;
}

const BLOCK_LABELS: Record<string, string> = {
  documentacao: 'Documentação',
  epis: 'Uso de EPIs',
  instalacoes: 'Inspeção de instalações',
  maquinas: 'Riscos em máquinas e equipamentos',
};

const STATUS_LABELS: Record<string, string> = { C: 'Conforme', NC: 'Não conforme', NA: 'Não se aplica' };

// inspection.visited_at é coluna DATE — se node-pg devolver como objeto
// Date bruto em vez de string, interpolar aqui produziria
// "Tue Sep 15 2026 00:00:00 GMT..." em vez de "2026-09-15" (mesma
// armadilha documentada em ata-pdf.util.ts). Confirme contra o valor
// REAL devolvido por InspectionsService.findOne antes de assumir que já
// vem como string — se vier como Date, normalize aqui (mesmo padrão de
// toDateString em dashboard.service.ts) antes de interpolar.
export function buildInspectionPdf(inspection: InspectionDetail, ctx: InspectionPdfContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text('RELATÓRIO DE VISITA TÉCNICA', { align: 'center' });
    doc.fontSize(12).text('Segurança do Trabalho', { align: 'center' });
    doc.moveDown();

    doc.fontSize(13).text('1. Identificação');
    doc.fontSize(11);
    doc.text(`Empresa: ${ctx.tenantName}`);
    doc.text(`CNPJ: ${ctx.tenantCnpj}`);
    doc.text(`Endereço: ${ctx.companyUnitAddress ?? 'não informado'}`);
    doc.text(`Data da visita: ${inspection.visited_at}`);
    doc.text(`Horário: ${inspection.started_at ?? '—'} às ${inspection.ended_at ?? '—'}`);
    doc.text(`Responsável pela empresa: ${inspection.company_contact ?? 'não informado'}`);
    doc.moveDown();

    for (const block of ['documentacao', 'epis', 'instalacoes', 'maquinas'] as const) {
      doc.fontSize(13).text(`${BLOCK_LABELS[block]}`);
      doc.fontSize(11);
      const items = inspection.items.filter((i) => i.block === block);
      for (const item of items) {
        const status = item.status ? STATUS_LABELS[item.status] : 'não avaliado';
        doc.text(`- ${item.item_label}: ${status}${item.notes ? ` — ${item.notes}` : ''}`);
      }
      doc.moveDown();
    }

    doc.fontSize(13).text('Conscientização (DDS)');
    doc.fontSize(11);
    doc.text(`Tema abordado: ${inspection.dds_topic ?? 'não informado'}`);
    doc.text(`Participantes: ${inspection.dds_participants_count ?? 'não informado'}`);
    doc.text(`Pontos reforçados: ${inspection.dds_notes ?? 'não informados'}`);
    doc.moveDown();

    doc.fontSize(13).text('Não conformidades identificadas');
    doc.fontSize(11);
    if (inspection.action_plans.length === 0) {
      doc.text('Nenhuma não conformidade identificada nesta visita.');
    } else {
      for (const plan of inspection.action_plans) {
        doc.text(
          `- ${plan.description} | Prazo: ${plan.deadline ?? 'não definido'} | Responsável: ${plan.responsible ?? 'não definido'} | Status: ${plan.status}`,
        );
      }
    }
    doc.moveDown();

    doc.fontSize(13).text('Recomendações gerais');
    doc.fontSize(11).text(inspection.general_recommendations || 'Nenhuma recomendação registrada.');
    doc.moveDown();

    doc.fontSize(13).text('Assinaturas');
    doc.fontSize(11);
    doc.text(`Técnico responsável: ${inspection.technician_signature_name ?? 'não assinado'}`);
    doc.text(`Responsável pela empresa: ${inspection.company_signature_name ?? 'não assinado'}`);

    doc.end();
  });
}
```

**Atenção**: se ao testar (Step 6) o texto do PDF mostrar uma data errada
(ex.: um dia a mais/a menos, ou o formato `Tue Sep...`), é a mesma
armadilha de serialização de `DATE` já documentada em várias fases
anteriores deste projeto — normalize `inspection.visited_at` (e
`plan.deadline`, mesma coluna `DATE`) pra string `AAAA-MM-DD` antes de
interpolar, mesmo padrão de `toDateString`/`normalizeMeeting` já usado
no resto do projeto. Ajuste o código acima seguindo esse padrão real se
o teste expuser o problema — não assuma que já está certo só porque o
plano não previu explicitamente.

- [ ] **Step 4: Descomentar o import e o bloco de PDF em `inspections.service.ts`**

Volte no arquivo editado na Task 1 e descomente exatamente o `import { buildInspectionPdf } from './inspection-pdf.util';` e o bloco `try { ... } catch { ... }` dentro de `conclude()` que ficou comentado — o código já está completo desde a Task 1, só precisa deixar de ser comentário.

- [ ] **Step 5: `InspectionsModule` importa `DocumentsModule`**

`backend/src/inspections/inspections.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { InspectionsController } from './inspections.controller';
import { ActionPlansController } from './action-plans.controller';
import { InspectionsService } from './inspections.service';
import { AiCopilotModule } from '../ai-copilot/ai-copilot.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [AiCopilotModule, DocumentsModule],
  controllers: [InspectionsController, ActionPlansController],
  providers: [InspectionsService],
})
export class InspectionsModule {}
```

- [ ] **Step 6: Escrever o teste e2e**

`backend/test/inspection-pdf.e2e-spec.ts` (mesmo padrão exato de
`cipa-ata-approval.e2e-spec.ts`: sem override de provider nenhum, R2
real, baixa o objeto de verdade e confere o texto extraído):

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { PDFParse } from 'pdf-parse';
import { AppModule } from '../src/app.module';
import { R2Service } from '../src/common/r2/r2.service';
import { TestDb } from './db-test-helper';

describe('POST /inspections/:id/concluir — gera PDF e indexa como Document (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let token: string;
  let companyUnitId: string;
  let s3: S3Client;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Inspection PDF Teste');
    tenantId = tenant.tenantId;
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_number, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz PDF Teste', 'Rua das Flores', '42', 'São Paulo', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    s3 = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
      },
    });
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('concluir gera um Document real (categoria relatorio_visita) com o conteúdo certo', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tenant_id: tenantId,
        visited_at: '2026-09-15',
        company_unit_id: companyUnitId,
        started_at: '08:00',
        ended_at: '10:30',
      });
    expect(createRes.status).toBe(201);
    const inspectionId = createRes.body.id;
    const firstItem = createRes.body.items[0];

    await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${firstItem.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'NC', notes: 'Extintor vencido' });

    const concludeRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${token}`);
    expect(concludeRes.status).toBe(201);
    expect(concludeRes.body.status).toBe('concluida');

    const docResult = await (db as any).client.query(
      `SELECT * FROM documents WHERE tenant_id = $1 AND category = 'relatorio_visita'`,
      [tenantId],
    );
    expect(docResult.rows).toHaveLength(1);
    expect(docResult.rows[0].mime_type).toBe('application/pdf');
    expect(docResult.rows[0].company_unit_id).toBe(companyUnitId);

    const getRes = await s3.send(
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: docResult.rows[0].file_key }),
    );
    const bytes = await getRes.Body!.transformToByteArray();
    const parser = new PDFParse({ data: Buffer.from(bytes) });
    let text: string;
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }

    expect(text).toContain('Empresa Inspection PDF Teste');
    expect(text).toContain('Rua das Flores, 42 — São Paulo/SP');
    expect(text).toContain('2026-09-15');
    expect(text).toContain('08:00');
    expect(text).toContain('10:30');
    expect(text).toContain('Extintor vencido');
  });

  it('filial apagada depois da inspeção criada: PDF é gerado com "endereço não informado", sem quebrar', async () => {
    // ON DELETE SET NULL (spec §6) — a inspeção sobrevive, company_unit_id
    // vira null. Isto testa esse caso de borda específico (endereço
    // ausente é tratado graciosamente), NÃO o try/catch de resiliência a
    // falha real — nesse caminho a geração do PDF continua tendo
    // sucesso (só sem endereço), não lança nada pra o catch pegar. O
    // teste de resiliência de verdade (R2 falhando) é o describe
    // separado logo abaixo, com provider sobreposto.
    const tempUnitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Filial Temporária', 'Rua Temp', 'Cidade Temp', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    const tempUnitId = tempUnitResult.rows[0].id;

    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${token}`)
      .send({ tenant_id: tenantId, visited_at: '2026-09-15', company_unit_id: tempUnitId });
    const inspectionId = createRes.body.id;

    await (db as any).client.query('DELETE FROM company_units WHERE id = $1', [tempUnitId]);

    const concludeRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${token}`);

    expect(concludeRes.status).toBe(201);
    expect(concludeRes.body.status).toBe('concluida');

    const docResult = await (db as any).client.query(
      `SELECT * FROM documents WHERE tenant_id = $1 AND category = 'relatorio_visita' AND title LIKE '%2026-09-15%' ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    expect(docResult.rows).toHaveLength(1);
    const getRes = await s3.send(
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: docResult.rows[0].file_key }),
    );
    const bytes = await getRes.Body!.transformToByteArray();
    const parser = new PDFParse({ data: Buffer.from(bytes) });
    let text: string;
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
    expect(text).toContain('Endereço: não informado');
  });
});

// Describe separado: sobrepõe R2Service pra forçar uma falha REAL de
// upload (não um caso de borda de dado, um erro de infraestrutura de
// verdade) e confirma que conclude() nunca deixa isso derrubar a
// conclusão da inspeção (spec §6, "nunca lança" por causa do PDF).
describe('POST /inspections/:id/concluir — resiliência real a falha de upload do PDF (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let token: string;
  let companyUnitId: string;
  const fakePutObject = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2Service)
      .useValue({ putObject: fakePutObject, getObject: jest.fn(), getPresignedDownloadUrl: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Inspection PDF Falha Teste');
    tenantId = tenant.tenantId;
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Falha Teste', 'Rua Falha', 'Cidade Falha', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('R2 fora do ar durante o upload do PDF: inspeção ainda assim é concluída com sucesso', async () => {
    fakePutObject.mockRejectedValue(new Error('R2 fora do ar (simulado)'));

    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${token}`)
      .send({ tenant_id: tenantId, visited_at: '2026-09-15', company_unit_id: companyUnitId });
    const inspectionId = createRes.body.id;

    const concludeRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${token}`);

    // A parte crítica (mudar status, gerar action_plans) precisa ter
    // sucesso mesmo com o R2 rejeitando toda chamada de putObject.
    expect(concludeRes.status).toBe(201);
    expect(concludeRes.body.status).toBe('concluida');

    const docResult = await (db as any).client.query(
      `SELECT * FROM documents WHERE tenant_id = $1 AND category = 'relatorio_visita'`,
      [tenantId],
    );
    expect(docResult.rows).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Rodar e confirmar que os 3 testes passam**

Exponha Postgres/Redis reais (ver "Pré-requisito").

Run: `cd /opt/Montese && ./run-backend-tests.sh test:e2e -- "inspection-pdf"`
Expected: `3 passed` (2 suítes: a principal com R2 real + a de resiliência com R2 sobreposto). Se o texto extraído não bater (data errada, endereço ausente), veja a nota do Step 3 sobre serialização de `DATE`.

- [ ] **Step 8: Regressão completa — Inspeções + ação corretiva + documentos**

Run: `cd /opt/Montese && ./run-backend-tests.sh test:e2e -- "inspections|action-plans|documents"`
Expected: sem quebra em nenhum arquivo (confirma que a categoria nova em `ALLOWED_CATEGORIES` e a mudança em `conclude()` não afetaram nada do módulo de documentos já existente).

- [ ] **Step 9: Restaurar a stack Docker**

```bash
cd /opt/Montese
rm docker-compose.dev-redis-temp.yml
docker compose up -d postgres redis
```

- [ ] **Step 10: Tipos e commit**

Run: `cd /opt/Montese/backend && npx tsc --noEmit` — sem erros.

```bash
cd /opt/Montese
git add backend/src/inspections/inspection-pdf.util.ts \
  backend/src/inspections/inspections.service.ts \
  backend/src/inspections/inspections.module.ts \
  backend/src/documents/documents.service.ts \
  backend/test/inspection-pdf.e2e-spec.ts
git commit -m "feat: gera PDF do relatório de visita ao concluir e indexa como Document (Relatório de Visita Técnica)"
```

---

## Task 4: Frontend — filial/horário na criação, identificação e prazo/responsável na tela de detalhe

**Files:**
- Modify: `frontend/src/app/tecnico/empresas/[tenantId]/page.tsx`
- Modify: `frontend/src/app/tecnico/empresas/[tenantId]/inspecoes/[id]/page.tsx`

**Interfaces:**
- Consumes: `POST /inspections` (Task 1, exige `company_unit_id`), `GET /inspections/:id` (Task 1, devolve `tenant_cnpj`/`company_unit_address`/`started_at`/`ended_at`), `PATCH /action-plans/:id` (Task 2).

- [ ] **Step 1: Ler os arquivos reais atuais antes de editar**

Leia por completo `frontend/src/app/tecnico/empresas/[tenantId]/page.tsx` (já tem `units`/`loadUnits`/o seletor de filial da seção "Checklist de prevenção", construídos nesta mesma sessão — reaproveite o padrão exato, não invente um novo) e `frontend/src/app/tecnico/empresas/[tenantId]/inspecoes/[id]/page.tsx`. Se algo divergir deste plano, o código real vence.

- [ ] **Step 2: `handleNovaInspecao` ganha filial e horários**

Em `frontend/src/app/tecnico/empresas/[tenantId]/page.tsx`, a seção "Inspeções" já existente. Adicione estado novo:

```typescript
const [inspectionUnitId, setInspectionUnitId] = useState('');
const [inspectionStartedAt, setInspectionStartedAt] = useState('');
const [inspectionEndedAt, setInspectionEndedAt] = useState('');
```

(`units`/`loadUnits` já existem no arquivo — reaproveite, não duplique.)

Altere `handleNovaInspecao`:

```typescript
async function handleNovaInspecao() {
  if (!inspectionUnitId) {
    setError('Selecione a filial.');
    return;
  }
  setCreating(true);
  setError('');
  const token = localStorage.getItem('montese_token');
  try {
    const res = await fetch('/api/inspections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        tenant_id: params.tenantId,
        visited_at: new Date().toISOString().slice(0, 10),
        company_unit_id: inspectionUnitId,
        started_at: inspectionStartedAt || undefined,
        ended_at: inspectionEndedAt || undefined,
      }),
    });
    if (res.ok) {
      const inspection = await res.json();
      router.push(`/tecnico/empresas/${params.tenantId}/inspecoes/${inspection.id}`);
      return;
    }
    setError('Não foi possível criar a inspeção.');
  } catch {
    setError('Não foi possível conectar ao servidor.');
  }
  setCreating(false);
}
```

Na seção JSX "Inspeções" já existente, antes do botão "Nova inspeção", adicione o seletor de filial e os 2 campos de horário (mesmo `<select>`/estilo já usado na seção "Checklist de prevenção" logo abaixo):

```tsx
<div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
  <label className="flex flex-1 flex-col gap-1 text-sm text-brand-900">
    Filial
    <select
      value={inspectionUnitId}
      onChange={(e) => setInspectionUnitId(e.target.value)}
      className="rounded-md border border-brand-100 px-3 py-2"
    >
      <option value="">Selecione</option>
      {units.map((unit) => (
        <option key={unit.id} value={unit.id}>
          {unit.name}
        </option>
      ))}
    </select>
  </label>
  <label className="flex flex-col gap-1 text-sm text-brand-900">
    Início
    <input
      type="time"
      value={inspectionStartedAt}
      onChange={(e) => setInspectionStartedAt(e.target.value)}
      className="rounded-md border border-brand-100 px-3 py-2"
    />
  </label>
  <label className="flex flex-col gap-1 text-sm text-brand-900">
    Término
    <input
      type="time"
      value={inspectionEndedAt}
      onChange={(e) => setInspectionEndedAt(e.target.value)}
      className="rounded-md border border-brand-100 px-3 py-2"
    />
  </label>
  <button
    onClick={handleNovaInspecao}
    disabled={creating}
    className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
  >
    {creating ? 'Criando...' : 'Nova inspeção'}
  </button>
</div>
```

(Remova o `<button>` "Nova inspeção" solto que existia antes junto do `<h2>` — ele passa a fazer parte do bloco acima, junto dos campos novos.)

- [ ] **Step 3: Seção "Identificação" + horários editáveis na tela de detalhe**

Em `frontend/src/app/tecnico/empresas/[tenantId]/inspecoes/[id]/page.tsx`, atualize a interface local:

```typescript
interface InspectionDetail {
  id: string;
  status: 'rascunho' | 'concluida';
  visited_at: string;
  started_at: string | null;
  ended_at: string | null;
  tenant_cnpj: string;
  company_unit_address: string | null;
  company_contact: string | null;
  dds_topic: string | null;
  dds_participants_count: number | null;
  dds_notes: string | null;
  general_recommendations: string | null;
  technician_signature_name: string | null;
  company_signature_name: string | null;
  items: ChecklistItem[];
  action_plans: ActionPlan[];
}
```

Atualize `ActionPlan`:

```typescript
interface ActionPlan {
  id: string;
  description: string;
  deadline: string | null;
  responsible: string | null;
  status: 'pendente' | 'resolvido';
}
```

Adicione a seção "Identificação" logo depois do `<h1>`/badge de status, antes da seção "Identificação" já existente (que hoje só tem "Responsável pela empresa" — renomeie o título dela pra não colidir, ou funda as duas: mais simples é ADICIONAR os campos novos dentro da seção já existente, que já tem `<h2>Identificação</h2>`):

```tsx
<section className="mt-6 rounded-lg border border-brand-100 p-6">
  <h2 className="text-lg font-bold text-brand-900">Identificação</h2>
  <p className="mt-2 text-sm text-brand-700">CNPJ: {inspection.tenant_cnpj}</p>
  <p className="mt-1 text-sm text-brand-700">
    Endereço: {inspection.company_unit_address ?? 'não informado'}
  </p>
  <div className="mt-3 flex gap-3">
    <label className="flex flex-col gap-1 text-sm text-brand-900">
      Início
      <input
        type="time"
        defaultValue={inspection.started_at ?? ''}
        disabled={!isDraft}
        onBlur={(e) => saveHeaderField('started_at', e.target.value)}
        className="rounded-md border border-brand-100 px-3 py-2 disabled:bg-brand-50"
      />
    </label>
    <label className="flex flex-col gap-1 text-sm text-brand-900">
      Término
      <input
        type="time"
        defaultValue={inspection.ended_at ?? ''}
        disabled={!isDraft}
        onBlur={(e) => saveHeaderField('ended_at', e.target.value)}
        className="rounded-md border border-brand-100 px-3 py-2 disabled:bg-brand-50"
      />
    </label>
  </div>
  <label className="mt-3 flex flex-col gap-1 text-sm text-brand-900">
    Responsável pela empresa
    <input
      defaultValue={inspection.company_contact ?? ''}
      disabled={!isDraft}
      onBlur={(e) => saveHeaderField('company_contact', e.target.value)}
      className="rounded-md border border-brand-100 px-3 py-2 disabled:bg-brand-50"
    />
  </label>
</section>
```

(Isso substitui a seção "Identificação" já existente no arquivo, que hoje só tem o campo "Responsável pela empresa" — não crie uma segunda seção com o mesmo título.)

- [ ] **Step 4: Prazo/Responsável editáveis na seção "Planos de ação gerados"**

Localize a seção já existente:

```tsx
{inspection.action_plans.length > 0 && (
  <section className="mt-6 rounded-lg border border-brand-100 p-6">
    <h2 className="text-lg font-bold text-brand-900">Planos de ação gerados</h2>
    <ul className="mt-3 flex flex-col gap-1 text-sm text-red-600">
      {inspection.action_plans.map((plan) => (
        <li key={plan.id}>{plan.description}</li>
      ))}
    </ul>
  </section>
)}
```

Substitua por (SEMPRE editável, mesmo com `status === 'concluida'` —
decisão da spec §2, por isso os inputs abaixo não usam `disabled={!isDraft}`):

```tsx
{inspection.action_plans.length > 0 && (
  <section className="mt-6 rounded-lg border border-brand-100 p-6">
    <h2 className="text-lg font-bold text-brand-900">Planos de ação gerados</h2>
    <ul className="mt-3 flex flex-col gap-3">
      {inspection.action_plans.map((plan) => (
        <li key={plan.id} className="rounded-md border border-red-100 p-3">
          <p className="text-sm font-medium text-red-600">{plan.description}</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1 text-xs text-brand-900">
              Prazo
              <input
                type="date"
                defaultValue={plan.deadline ? plan.deadline.slice(0, 10) : ''}
                onBlur={(e) => saveActionPlan(plan.id, { deadline: e.target.value })}
                className="rounded-md border border-brand-100 px-3 py-2"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs text-brand-900">
              Responsável
              <input
                defaultValue={plan.responsible ?? ''}
                onBlur={(e) => saveActionPlan(plan.id, { responsible: e.target.value })}
                className="rounded-md border border-brand-100 px-3 py-2"
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-brand-700">
            Status: {plan.status === 'resolvido' ? 'Resolvido' : 'Pendente'}
          </p>
        </li>
      ))}
    </ul>
  </section>
)}
```

Adicione a função `saveActionPlan`, junto das outras funções de save já existentes (`saveHeaderField`/`saveItem`):

```typescript
async function saveActionPlan(planId: string, patch: { deadline?: string; responsible?: string }) {
  const token = localStorage.getItem('montese_token');
  try {
    const res = await fetch(`/api/action-plans/${planId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const updatedPlan = await res.json();
      setInspection((prev) =>
        prev
          ? { ...prev, action_plans: prev.action_plans.map((p) => (p.id === planId ? updatedPlan : p)) }
          : prev,
      );
    } else {
      setError('Não foi possível salvar a ação corretiva.');
    }
  } catch {
    setError('Não foi possível conectar ao servidor.');
  }
}
```

- [ ] **Step 5: Tipos**

Run: `cd /opt/Montese/frontend && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Build de produção**

Run: `cd /opt/Montese/frontend && npx next build`
Expected: build limpo, sem erro de tipo nem de rota.

- [ ] **Step 7: Verificação manual real em produção via Playwright**

Depois do redeploy (backend + frontend, autorização do fundador necessária a cada deploy):

1. Crie uma inspeção nova como técnico, escolhendo uma filial real e preenchendo horário de início/término.
2. Confirme que a tela de detalhe mostra CNPJ e endereço da filial escolhida na seção "Identificação", e que os horários aparecem nos campos certos.
3. Marque pelo menos 1 item como "NC" com uma observação, e conclua a inspeção.
4. Confirme que a seção "Planos de ação gerados" aparece com os campos de Prazo/Responsável editáveis — preencha os dois, recarregue a página, confirme que persistiram.
5. Confirme que, mesmo com a inspeção já concluída, os campos de Prazo/Responsável continuam editáveis (diferente dos outros campos do formulário, que ficam travados).
6. Vá em Documentos da empresa (`DocumentsPanel`, já na mesma página) e confirme que um documento novo apareceu, categoria/título relacionados ao relatório de visita, baixável.
7. Console do navegador sem erro em todas as verificações.

- [ ] **Step 8: Commit**

```bash
cd /opt/Montese
git add "frontend/src/app/tecnico/empresas/[tenantId]/page.tsx" \
  "frontend/src/app/tecnico/empresas/[tenantId]/inspecoes/[id]/page.tsx"
git commit -m "feat: filial/horário na criação, identificação e prazo/responsável editáveis (Relatório de Visita Técnica)"
```

---

## Nota de ambiente (referência rápida)

Mesma nota já usada nas fases anteriores: se `/opt/Montese/run-backend-tests.sh` não existir mais nesta sessão, recrie-o conforme o bloco "Pré-requisito" no topo deste plano antes da Task 1. Nunca crie `docker-compose.override.yml`. Sempre delete o overlay efêmero de Redis e restaure a stack (`docker compose up -d postgres redis`, sem `-f`) ao terminar de rodar testes e2e.
