# Conformidade por NR no Dashboard — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o cartão "Em breve" de Conformidade por NR em `/dashboard-v2` por um cartão real, alimentado pelas NRs que o técnico marca como aplicáveis no relatório de visita técnica e pelas evidências já cadastradas da empresa.

**Architecture:** Catálogo de NRs em código (`nr-catalog.ts`) + função pura de status (`nr-status.ts`) + `NrConformidadeService` que consulta as tabelas existentes. Uma tabela nova (`company_applicable_nrs`, com RLS forçada) guarda a aplicabilidade; o rascunho da marcação vive em `inspections.nrs_aplicaveis` (jsonb) e é aplicado ao concluir a visita. Dois endpoints novos no `DashboardController` reaproveitam `withTargetTenant`.

**Tech Stack:** NestJS, TypeScript, PostgreSQL (`pg`, RLS), Jest (unit + e2e), Next.js, React, Tailwind, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-01-conformidade-por-nr-design.md`

## Global Constraints

- **Sem commit, push, reset ou revert automáticos** (AGENTS.md). Onde o skill pediria "commit", este plano usa **Checkpoint**: rodar `git status` e `git diff --stat` e **parar** para o dono decidir. Nunca `git add`/`git commit` por conta própria.
- **Sem alteração de Docker, Nginx, Redis, TLS, DNS, backups, secrets ou produção.** Nenhum deploy neste plano; a implantação é um release à parte, com autorização (spec §10).
- **Nunca `docker compose down -v`.**
- **Migration nova = `backend/db/migrations/0064_company_applicable_nrs.sql`.** Nunca aplicar em produção neste plano. Os e2e rodam contra o Postgres do ambiente (`test/jest-e2e-setup.ts` aponta para produção): **só rodar e2e em clone/banco descartável** conforme a receita de `reference_running_tests_in_throwaway_container` (clone com `CREATE DATABASE montese_rehearsal`, Redis descartável). Specs unitários rodam no host.
- **`tenant_id` sempre do contexto autenticado**, nunca do corpo; `nr_code` sempre validado contra `NR_CODES` no backend.
- **Catálogo inicial (confirmado pelo dono em 2026-10-01):** NR-1, NR-5, NR-6, NR-7, NR-15, NR-16, NR-23. Nada além disso.
- **Texto da tela:** "evidências cadastradas"; nunca "obrigatório" nem "descumprimento". Aviso fixo: "Não substitui a avaliação técnica."
- **Janela de atenção:** 30 dias (igual a `documents.getCompliance`). Evidência sem validade = vigente. Zero evidências = `pendente`.
- **Sem IA, sem envio de dados ao modelo, sem alteração de provider.**
- **Idioma:** responder e documentar em português do Brasil.
- **Marcadores de comunicação:** usar VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO nos relatórios de cada task.

## Mapa de arquivos

**Criar (backend)**
- `backend/db/migrations/0064_company_applicable_nrs.sql` — tabela + RLS + coluna `inspections.nrs_aplicaveis`.
- `backend/src/nr-conformidade/nr-catalog.ts` — catálogo, `NR_CODES`, tipos.
- `backend/src/nr-conformidade/nr-status.ts` — funções puras de data/status (sem banco).
- `backend/src/nr-conformidade/nr-conformidade.service.ts` — consultas, cálculo, `applyMarks`.
- `backend/src/nr-conformidade/nr-conformidade.module.ts`.
- `backend/test/nr-status.unit-spec.ts`, `backend/test/nr-catalog.unit-spec.ts`.
- `backend/test/nr-conformidade.e2e-spec.ts`, `backend/test/inspections-nrs-aplicaveis.e2e-spec.ts`.

**Modificar (backend)**
- `backend/src/dashboard/dashboard.controller.ts`, `dashboard.module.ts` — 2 endpoints.
- `backend/src/inspections/dto/update-inspection.dto.ts`, `inspections.service.ts`, `inspections.module.ts` — campo, update jsonb, aplicação na conclusão.

**Criar (frontend)**
- `frontend/src/components/dashboard/NrConformidadeCard.tsx`
- `frontend/src/components/NrAplicaveisSection.tsx`
- `frontend/src/components/__tests__/NrAplicaveisSection.test.tsx`
- `frontend/src/lib/dashboard/__tests__/menu.test.ts`

**Modificar (frontend)**
- `frontend/src/lib/dashboard/api-types.ts`, `real.ts`, `__tests__/real.test.ts`
- `frontend/src/components/dashboard/__tests__/blocos.test.tsx`
- `frontend/src/app/dashboard-v2/page.tsx`
- `frontend/src/app/tecnico/empresas/[tenantId]/inspecoes/[id]/page.tsx`
- `frontend/src/lib/dashboard/menu.ts`, `frontend/src/app/empresa/inspecoes/page.tsx` (título)

## Ordem e dependências

Task 1 (puro) → Task 2 (migration + service) → Task 3 (endpoints) → Task 4 (inspeções) → Task 5 (cartão) → Task 6 (bloco do técnico) → Task 7 (menu/títulos) → Task 8 (verificação final). Tasks 5–7 só dependem do contrato JSON da Task 3 e do campo `nrs_aplicaveis` da Task 4.

---

### Task 1: Catálogo e lógica pura de status

**Files:**
- Create: `backend/src/nr-conformidade/nr-catalog.ts`
- Create: `backend/src/nr-conformidade/nr-status.ts`
- Test: `backend/test/nr-status.unit-spec.ts`, `backend/test/nr-catalog.unit-spec.ts`

**Interfaces:**
- Produces (`nr-catalog.ts`):
  - `type NrStatus = 'em_dia' | 'atencao' | 'pendente' | 'nao_avaliavel'`
  - `type Regra = { fonte: 'documento'; categorias: readonly string[] } | { fonte: 'cipa' } | { fonte: 'epi' } | { fonte: 'equipamento_incendio' }`
  - `interface NrCatalogEntry { code: string; nome: string; regra: Regra; agregacao: 'alguma' | 'todas' }`
  - `const NR_CATALOG: readonly NrCatalogEntry[]`
  - `const NR_CODES: readonly string[]`
  - `type NrCode = string` (validação em tempo de execução por `isNrCode`)
  - `function isNrCode(value: unknown): value is string`
  - `const FONTE_OFICIAL_NRS_URL: string`
- Produces (`nr-status.ts`):
  - `interface Evidencia { validades: (string | null)[] }`
  - `interface Avaliacao { status: Exclude<NrStatus, 'nao_avaliavel'>; quantidade: number; proxima_validade: string | null }`
  - `function hojeISO(agora?: Date): string` (yyyy-mm-dd, data local)
  - `function somarDias(iso: string, dias: number): string`
  - `function avaliarEvidencia(ev: Evidencia, agregacao: 'alguma' | 'todas', hoje: string): Avaliacao`

- [ ] **Step 1: Escrever o teste de `nr-status` (falhando)**

Criar `backend/test/nr-status.unit-spec.ts`:

```ts
import { avaliarEvidencia, hojeISO, somarDias } from '../src/nr-conformidade/nr-status';

const HOJE = '2026-10-01';

describe('somarDias / hojeISO', () => {
  it('soma dias atravessando mês e ano', () => {
    expect(somarDias('2026-10-01', 30)).toBe('2026-10-31');
    expect(somarDias('2026-12-15', 30)).toBe('2027-01-14');
  });
  it('hojeISO usa a data local no formato yyyy-mm-dd', () => {
    expect(hojeISO(new Date(2026, 9, 1, 23, 30))).toBe('2026-10-01');
  });
});

describe('avaliarEvidencia — agregação "alguma"', () => {
  it('sem evidência: pendente, quantidade 0', () => {
    expect(avaliarEvidencia({ validades: [] }, 'alguma', HOJE)).toEqual({
      status: 'pendente', quantidade: 0, proxima_validade: null,
    });
  });
  it('todas vencidas: pendente', () => {
    const r = avaliarEvidencia({ validades: ['2026-09-30', '2026-01-01'] }, 'alguma', HOJE);
    expect(r.status).toBe('pendente');
    expect(r.quantidade).toBe(2);
    expect(r.proxima_validade).toBeNull();
  });
  it('uma vigente (>30 dias) basta, mesmo com outra vencida: em_dia', () => {
    const r = avaliarEvidencia({ validades: ['2026-01-01', '2027-03-01'] }, 'alguma', HOJE);
    expect(r.status).toBe('em_dia');
    expect(r.proxima_validade).toBe('2027-03-01');
  });
  it('só vencendo (<=30 dias): atencao', () => {
    const r = avaliarEvidencia({ validades: ['2026-10-20'] }, 'alguma', HOJE);
    expect(r.status).toBe('atencao');
    expect(r.proxima_validade).toBe('2026-10-20');
  });
  it('vence hoje conta como vencendo, não vencido', () => {
    expect(avaliarEvidencia({ validades: [HOJE] }, 'alguma', HOJE).status).toBe('atencao');
  });
  it('exatamente 30 dias ainda é vencendo; 31 dias é vigente', () => {
    expect(avaliarEvidencia({ validades: ['2026-10-31'] }, 'alguma', HOJE).status).toBe('atencao');
    expect(avaliarEvidencia({ validades: ['2026-11-01'] }, 'alguma', HOJE).status).toBe('em_dia');
  });
  it('evidência sem validade conta como vigente', () => {
    const r = avaliarEvidencia({ validades: [null] }, 'alguma', HOJE);
    expect(r).toEqual({ status: 'em_dia', quantidade: 1, proxima_validade: null });
  });
});

describe('avaliarEvidencia — agregação "todas"', () => {
  it('sem evidência: pendente', () => {
    expect(avaliarEvidencia({ validades: [] }, 'todas', HOJE).status).toBe('pendente');
  });
  it('qualquer vencida torna pendente, mesmo havendo vigentes', () => {
    expect(avaliarEvidencia({ validades: ['2027-05-01', '2026-09-01'] }, 'todas', HOJE).status).toBe('pendente');
  });
  it('sem vencidas e alguma vencendo: atencao', () => {
    expect(avaliarEvidencia({ validades: ['2027-05-01', '2026-10-10'] }, 'todas', HOJE).status).toBe('atencao');
  });
  it('todas vigentes ou sem validade: em_dia, proxima = menor data futura', () => {
    const r = avaliarEvidencia({ validades: ['2027-05-01', null, '2026-12-01'] }, 'todas', HOJE);
    expect(r.status).toBe('em_dia');
    expect(r.proxima_validade).toBe('2026-12-01');
    expect(r.quantidade).toBe(3);
  });
});
```

- [ ] **Step 2: Escrever o teste do catálogo (falhando)**

Criar `backend/test/nr-catalog.unit-spec.ts`:

```ts
import { FONTE_OFICIAL_NRS_URL, isNrCode, NR_CATALOG, NR_CODES } from '../src/nr-conformidade/nr-catalog';

describe('NR_CATALOG', () => {
  it('contém exatamente o catálogo confirmado pelo dono (2026-10-01), em ordem', () => {
    expect(NR_CODES).toEqual(['NR-1', 'NR-5', 'NR-6', 'NR-7', 'NR-15', 'NR-16', 'NR-23']);
  });
  it('códigos são únicos e todo item tem nome e regra', () => {
    expect(new Set(NR_CODES).size).toBe(NR_CODES.length);
    for (const e of NR_CATALOG) {
      expect(e.nome.length).toBeGreaterThan(0);
      expect(e.regra.fonte).toBeTruthy();
    }
  });
  it('isNrCode aceita só códigos do catálogo', () => {
    expect(isNrCode('NR-7')).toBe(true);
    expect(isNrCode('NR-99')).toBe(false);
    expect(isNrCode('nr-7')).toBe(false);
    expect(isNrCode(undefined)).toBe(false);
  });
  it('a fonte oficial é uma URL https de gov.br', () => {
    const u = new URL(FONTE_OFICIAL_NRS_URL);
    expect(u.protocol).toBe('https:');
    expect(u.hostname.endsWith('gov.br')).toBe(true);
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falham**

Run (no host): `cd /opt/Montese/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json nr-status nr-catalog --forceExit`
Expected: FAIL (`Cannot find module '../src/nr-conformidade/...'`).

- [ ] **Step 4: Implementar `nr-catalog.ts`**

Criar `backend/src/nr-conformidade/nr-catalog.ts`:

```ts
// Catálogo de NRs do cartão "Conformidade por NR". Guarda só REFERÊNCIA
// (código, rótulo curto, regra de evidência) — nunca texto normativo. Quem
// decide se uma NR se aplica à empresa é o técnico (company_applicable_nrs);
// este catálogo só diz onde procurar evidência já cadastrada no sistema.
// Catálogo inicial confirmado pelo dono em 2026-10-01. NRs sem evidência
// estruturada (NR-10, 12, 18, 35 etc.) entram só quando houver fonte real.

export type NrStatus = 'em_dia' | 'atencao' | 'pendente' | 'nao_avaliavel';

export type Regra =
  | { fonte: 'documento'; categorias: readonly string[] }
  | { fonte: 'cipa' }
  | { fonte: 'epi' }
  | { fonte: 'equipamento_incendio' };

export interface NrCatalogEntry {
  code: string;
  nome: string; // rótulo curto, não o título oficial completo
  regra: Regra;
  // 'alguma': basta uma evidência vigente. 'todas': qualquer vencida torna a NR pendente.
  agregacao: 'alguma' | 'todas';
}

// URL da página "Normas Regulamentadoras Vigentes" do MTE, indicada pelo dono nos
// anexos (o PDF traz só o texto do link). NÃO VERIFICADO até o Step 7 da Task 1.
export const FONTE_OFICIAL_NRS_URL =
  'https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/seguranca-e-saude-no-trabalho/ctpp-nrs/normas-regulamentadoras-vigentes';

export const NR_CATALOG: readonly NrCatalogEntry[] = [
  { code: 'NR-1', nome: 'Disposições gerais e gerenciamento de riscos (PGR)', regra: { fonte: 'documento', categorias: ['pgr'] }, agregacao: 'alguma' },
  { code: 'NR-5', nome: 'CIPA', regra: { fonte: 'cipa' }, agregacao: 'alguma' },
  { code: 'NR-6', nome: 'Equipamento de proteção individual (EPI)', regra: { fonte: 'epi' }, agregacao: 'todas' },
  { code: 'NR-7', nome: 'PCMSO', regra: { fonte: 'documento', categorias: ['pcmso'] }, agregacao: 'alguma' },
  { code: 'NR-15', nome: 'Atividades e operações insalubres', regra: { fonte: 'documento', categorias: ['lip'] }, agregacao: 'alguma' },
  { code: 'NR-16', nome: 'Atividades e operações perigosas', regra: { fonte: 'documento', categorias: ['lip'] }, agregacao: 'alguma' },
  { code: 'NR-23', nome: 'Proteção contra incêndios', regra: { fonte: 'equipamento_incendio' }, agregacao: 'todas' },
];

export const NR_CODES: readonly string[] = NR_CATALOG.map((e) => e.code);

export type NrCode = string;

export function isNrCode(value: unknown): value is NrCode {
  return typeof value === 'string' && NR_CODES.includes(value);
}
```

- [ ] **Step 5: Implementar `nr-status.ts`**

Criar `backend/src/nr-conformidade/nr-status.ts`:

```ts
import type { NrStatus } from './nr-catalog';

export interface Evidencia {
  // Uma entrada por item de evidência; null = item sem data de validade.
  validades: (string | null)[];
}

export interface Avaliacao {
  status: Exclude<NrStatus, 'nao_avaliavel'>;
  quantidade: number;
  proxima_validade: string | null;
}

const JANELA_ATENCAO_DIAS = 30; // mesma janela de documents.getCompliance

export function hojeISO(agora: Date = new Date()): string {
  const y = agora.getFullYear();
  const m = String(agora.getMonth() + 1).padStart(2, '0');
  const d = String(agora.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function somarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

type Situacao = 'vencida' | 'vencendo' | 'vigente';

function situacaoDe(validade: string | null, hoje: string, limite: string): Situacao {
  if (validade === null) return 'vigente'; // sem data informada: não há como afirmar que venceu
  if (validade < hoje) return 'vencida';
  if (validade <= limite) return 'vencendo';
  return 'vigente';
}

export function avaliarEvidencia(ev: Evidencia, agregacao: 'alguma' | 'todas', hoje: string): Avaliacao {
  const quantidade = ev.validades.length;
  const futuras = ev.validades.filter((v): v is string => v !== null && v >= hoje).sort();
  const proxima_validade = futuras[0] ?? null;

  if (quantidade === 0) return { status: 'pendente', quantidade, proxima_validade };

  const limite = somarDias(hoje, JANELA_ATENCAO_DIAS);
  const situacoes = ev.validades.map((v) => situacaoDe(v, hoje, limite));

  if (agregacao === 'alguma') {
    if (situacoes.every((s) => s === 'vencida')) return { status: 'pendente', quantidade, proxima_validade };
    if (situacoes.includes('vigente')) return { status: 'em_dia', quantidade, proxima_validade };
    return { status: 'atencao', quantidade, proxima_validade };
  }

  if (situacoes.includes('vencida')) return { status: 'pendente', quantidade, proxima_validade };
  if (situacoes.includes('vencendo')) return { status: 'atencao', quantidade, proxima_validade };
  return { status: 'em_dia', quantidade, proxima_validade };
}
```

- [ ] **Step 6: Rodar e confirmar que passam**

Run: `cd /opt/Montese/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json nr-status nr-catalog --forceExit`
Expected: PASS (todos os `it`).

- [ ] **Step 7: Verificar a URL oficial (obrigatório antes de seguir)**

Usar a ferramenta WebFetch na `FONTE_OFICIAL_NRS_URL` e confirmar que a página responde e é a lista de NRs vigentes do MTE. **Se não responder ou não for essa página: PARAR e pedir a URL correta ao dono** (não inventar). Registrar o resultado como VERIFICADO ou NÃO VERIFICADO no relatório da task.

- [ ] **Step 8: Checkpoint (sem commit)**

Run: `cd /opt/Montese && git status --short && git diff --stat`
Parar. O dono decide o commit.

---

### Task 2: Migration 0064 e `NrConformidadeService`

**Files:**
- Create: `backend/db/migrations/0064_company_applicable_nrs.sql`
- Create: `backend/src/nr-conformidade/nr-conformidade.service.ts`
- Create: `backend/src/nr-conformidade/nr-conformidade.module.ts`

**Interfaces:**
- Consumes (Task 1): `NR_CATALOG`, `NR_CODES`, `isNrCode`, `FONTE_OFICIAL_NRS_URL`, `NrStatus`, `Regra`, `avaliarEvidencia`, `hojeISO`.
- Produces (`NrConformidadeService`):
  - `getAplicaveis(client: PoolClient, tenantId: string): Promise<{ catalogo: { code: string; nome: string }[]; marcadas: string[] }>`
  - `getConformidade(client: PoolClient, tenantId: string, hoje?: string): Promise<{ nrs: NrConformidadeItem[] }>`
  - `applyMarks(client: PoolClient, tenantId: string, inspectionId: string, userId: string, desejadas: readonly string[]): Promise<void>`
  - `interface NrConformidadeItem { code: string; nome: string; status: NrStatus; evidencia: { quantidade: number; proxima_validade: string | null } | null; fonte_oficial_url: string; mensagem?: string }`
- Produces: `NrConformidadeModule` exporta `NrConformidadeService`.

Os testes e2e desta task ficam na Task 3 (precisam dos endpoints); aqui a validação é a migration + compilação.

- [ ] **Step 1: Escrever a migration**

Criar `backend/db/migrations/0064_company_applicable_nrs.sql`:

```sql
-- Conformidade por NR (spec 2026-10-01): aplicabilidade das NRs por empresa,
-- marcada por técnico/parceiro no relatório de visita técnica.
-- Aditiva e sem alteração destrutiva. `nr_code` NÃO tem CHECK no banco: o
-- catálogo vive em código (backend/src/nr-conformidade/nr-catalog.ts) e é
-- validado no backend. Desmarcar grava `unmarked_at` (rastreabilidade).
CREATE TABLE company_applicable_nrs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nr_code TEXT NOT NULL,
  marked_by_user_id UUID NOT NULL REFERENCES users(id),
  source_inspection_id UUID REFERENCES inspections(id) ON DELETE SET NULL,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unmarked_at TIMESTAMPTZ
);

-- No máximo uma marcação VIGENTE por empresa + NR.
CREATE UNIQUE INDEX company_applicable_nrs_active_uq
  ON company_applicable_nrs (tenant_id, nr_code) WHERE unmarked_at IS NULL;
CREATE INDEX company_applicable_nrs_tenant_idx ON company_applicable_nrs (tenant_id);

ALTER TABLE company_applicable_nrs ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_applicable_nrs FORCE ROW LEVEL SECURITY;
CREATE POLICY company_applicable_nrs_isolation ON company_applicable_nrs USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

-- Rascunho da marcação enquanto a visita está aberta (lista de nr_code).
-- NULL = o técnico não mexeu no bloco; NULL em todas as inspeções antigas.
ALTER TABLE inspections ADD COLUMN nrs_aplicaveis JSONB;
```

- [ ] **Step 2: Implementar o service**

Criar `backend/src/nr-conformidade/nr-conformidade.service.ts`:

```ts
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { FONTE_OFICIAL_NRS_URL, isNrCode, NR_CATALOG, NrCatalogEntry, NrStatus, Regra } from './nr-catalog';
import { avaliarEvidencia, Evidencia, hojeISO } from './nr-status';

export interface NrConformidadeItem {
  code: string;
  nome: string;
  status: NrStatus;
  evidencia: { quantidade: number; proxima_validade: string | null } | null;
  fonte_oficial_url: string;
  mensagem?: string;
}

@Injectable()
export class NrConformidadeService {
  private readonly logger = new Logger(NrConformidadeService.name);

  async getAplicaveis(client: PoolClient, tenantId: string) {
    const marcadas = await this.marcadasVigentes(client, tenantId);
    return {
      catalogo: NR_CATALOG.map((e) => ({ code: e.code, nome: e.nome })),
      marcadas: NR_CATALOG.map((e) => e.code).filter((c) => marcadas.has(c)),
    };
  }

  // Só NRs marcadas e vigentes, na ordem do catálogo. Cada NR roda dentro de um
  // SAVEPOINT: um erro de SQL numa regra aborta a transação inteira (25P02) e
  // derrubaria as demais; o savepoint isola a falha e a NR vira "nao_avaliavel".
  async getConformidade(client: PoolClient, tenantId: string, hoje: string = hojeISO()): Promise<{ nrs: NrConformidadeItem[] }> {
    const marcadas = await this.marcadasVigentes(client, tenantId);
    const nrs: NrConformidadeItem[] = [];
    for (const entrada of NR_CATALOG) {
      if (!marcadas.has(entrada.code)) continue;
      nrs.push(await this.avaliar(client, tenantId, entrada, hoje));
    }
    return { nrs };
  }

  // Aplica o rascunho da visita: insere o que é novo, marca `unmarked_at` no que saiu,
  // não toca no que ficou igual. Chamado na conclusão da inspeção, na mesma transação.
  async applyMarks(
    client: PoolClient,
    tenantId: string,
    inspectionId: string,
    userId: string,
    desejadas: readonly string[],
  ): Promise<void> {
    const invalidas = desejadas.filter((c) => !isNrCode(c));
    if (invalidas.length > 0) throw new BadRequestException(`NR fora do catálogo: ${invalidas.join(', ')}`);

    const alvo = new Set(desejadas);
    const vigentes = await this.marcadasVigentes(client, tenantId);

    for (const code of alvo) {
      if (vigentes.has(code)) continue;
      await client.query(
        `INSERT INTO company_applicable_nrs (tenant_id, nr_code, marked_by_user_id, source_inspection_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, nr_code) WHERE unmarked_at IS NULL DO NOTHING`,
        [tenantId, code, userId, inspectionId],
      );
    }
    for (const code of vigentes) {
      if (alvo.has(code)) continue;
      await client.query(
        `UPDATE company_applicable_nrs SET unmarked_at = now()
         WHERE tenant_id = $1 AND nr_code = $2 AND unmarked_at IS NULL`,
        [tenantId, code],
      );
    }
  }

  private async marcadasVigentes(client: PoolClient, tenantId: string): Promise<Set<string>> {
    const { rows } = await client.query<{ nr_code: string }>(
      `SELECT nr_code FROM company_applicable_nrs WHERE tenant_id = $1 AND unmarked_at IS NULL`,
      [tenantId],
    );
    return new Set(rows.map((r) => r.nr_code));
  }

  private async avaliar(client: PoolClient, tenantId: string, entrada: NrCatalogEntry, hoje: string): Promise<NrConformidadeItem> {
    const base = { code: entrada.code, nome: entrada.nome, fonte_oficial_url: FONTE_OFICIAL_NRS_URL };
    await client.query('SAVEPOINT nr_eval');
    try {
      const evidencia = await this.buscarEvidencia(client, tenantId, entrada.regra);
      const r = avaliarEvidencia(evidencia, entrada.agregacao, hoje);
      await client.query('RELEASE SAVEPOINT nr_eval');
      return { ...base, status: r.status, evidencia: { quantidade: r.quantidade, proxima_validade: r.proxima_validade } };
    } catch (err) {
      this.logger.error(`Falha ao avaliar ${entrada.code} (tenant ${tenantId})`, (err as Error).stack);
      await client.query('ROLLBACK TO SAVEPOINT nr_eval');
      return { ...base, status: 'nao_avaliavel', evidencia: null, mensagem: 'Não foi possível calcular agora.' };
    }
  }

  // `tenant_id` explícito em toda consulta: técnico/parceiro enxergam VÁRIOS tenants pela RLS,
  // então o filtro explícito é o que garante a empresa certa. `::text` devolve DATE como
  // 'yyyy-mm-dd' (sem a armadilha do objeto Date do node-pg).
  private async buscarEvidencia(client: PoolClient, tenantId: string, regra: Regra): Promise<Evidencia> {
    let sql: string;
    let params: unknown[] = [tenantId];
    switch (regra.fonte) {
      case 'documento':
        sql = `SELECT expires_at::text AS d FROM documents WHERE tenant_id = $1 AND category = ANY($2::text[])`;
        params = [tenantId, [...regra.categorias]];
        break;
      case 'cipa':
        sql = `SELECT data_termino::text AS d FROM cipa_committees WHERE tenant_id = $1 AND status = 'ativa'`;
        break;
      case 'epi':
        sql = `SELECT ca_valid_until::text AS d FROM tenant_epis WHERE tenant_id = $1`;
        break;
      case 'equipamento_incendio':
        sql = `SELECT proxima_manutencao::text AS d FROM fire_safety_equipment WHERE tenant_id = $1`;
        break;
    }
    const { rows } = await client.query<{ d: string | null }>(sql, params);
    return { validades: rows.map((r) => r.d) };
  }
}
```

- [ ] **Step 3: Implementar o módulo**

Criar `backend/src/nr-conformidade/nr-conformidade.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { NrConformidadeService } from './nr-conformidade.service';

@Module({
  providers: [NrConformidadeService],
  exports: [NrConformidadeService],
})
export class NrConformidadeModule {}
```

- [ ] **Step 4: Compilar**

Run: `cd /opt/Montese/backend && npx tsc --noEmit -p tsconfig.json`
Expected: sem erros. (Se o projeto usar outro tsconfig para build, usar `npx nest build` num diretório temporário não é necessário; `tsc --noEmit` basta aqui.)

- [ ] **Step 5: Revisar a migration contra o padrão (sem aplicar)**

Run: `cd /opt/Montese/backend && diff <(sed -n '/ENABLE ROW LEVEL SECURITY/,$p' db/migrations/0036_fire_safety_equipment.sql | head -8) <(sed -n '/ENABLE ROW LEVEL SECURITY/,/^);/p' db/migrations/0064_company_applicable_nrs.sql | head -8)`
Expected: diferem só no nome da tabela/policy. **Não aplicar a migration em produção.** Ela é aplicada só no clone descartável, na Task 3.

- [ ] **Step 6: Checkpoint (sem commit)**

Run: `cd /opt/Montese && git status --short && git diff --stat`
Parar.

---

### Task 3: Endpoints no dashboard + e2e de isolamento e permissões

**Files:**
- Modify: `backend/src/dashboard/dashboard.controller.ts`
- Modify: `backend/src/dashboard/dashboard.module.ts`
- Test: `backend/test/nr-conformidade.e2e-spec.ts`

**Interfaces:**
- Consumes (Task 2): `NrConformidadeService.getAplicaveis`, `getConformidade`.
- Produces:
  - `GET /dashboard/nr-conformidade[?tenant_id=]` → `{ nrs: NrConformidadeItem[] }`
  - `GET /dashboard/nr-aplicaveis[?tenant_id=]` → `{ catalogo: {code,nome}[]; marcadas: string[] }`
  - Ambos `@Roles('empresa','tecnico','parceiro')`, via `withTargetTenant` (técnico/parceiro exigem `tenant_id` e `assertTenantLinked`).

- [ ] **Step 1: Escrever o e2e (falhando)**

Criar `backend/test/nr-conformidade.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /dashboard/nr-conformidade e /nr-aplicaveis (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenA: string;
  let tokenB: string;
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let techToken: string;
  let techUserId: string;
  let technicianId: string;
  let tenantC: string; // não vinculado ao técnico
  const client = () => (db as any).client;

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    return res.body.access_token;
  }
  async function doc(tenantId: string, userId: string, category: string, expiresSql: string) {
    await client().query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, $2, 'Doc NR Teste', 'fixture/x.pdf', 'x.pdf', 'application/pdf', 100, ${expiresSql}, $3, 'empresa')`,
      [tenantId, category, userId],
    );
  }
  async function marcar(tenantId: string, code: string, userId: string) {
    await client().query(
      `INSERT INTO company_applicable_nrs (tenant_id, nr_code, marked_by_user_id) VALUES ($1, $2, $3)`,
      [tenantId, code, userId],
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const a = await db.createTenantWithUser('Empresa NR A Teste');
    const b = await db.createTenantWithUser('Empresa NR B Teste');
    const c = await db.createTenantWithUser('Empresa NR C Teste');
    tenantA = a.tenantId;
    tenantB = b.tenantId;
    tenantC = c.tenantId;
    userA = a.userId;
    tokenA = await login(a.email, a.password);
    tokenB = await login(b.email, b.password);

    const tech = await db.createUserWithRole('tecnico', 'Tecnico NR Teste');
    techUserId = tech.userId;
    const t = await client().query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tech.userId]);
    technicianId = t.rows[0].id;
    await client().query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [tenantA, technicianId]);
    techToken = await login(tech.email, tech.password);

    // Empresa A: NR-1 e NR-7 marcadas; PGR vigente (+200 dias), PCMSO vencido (-5 dias).
    await marcar(tenantA, 'NR-1', userA);
    await marcar(tenantA, 'NR-7', userA);
    await doc(tenantA, userA, 'pgr', 'current_date + 200');
    await doc(tenantA, userA, 'pcmso', 'current_date - 5');
    // Empresa B: tem documento PGR mas NENHUMA NR marcada.
    await doc(tenantB, b.userId, 'pgr', 'current_date + 200');
    // Empresa C: marcada e com dados, mas o técnico NÃO é vinculado a ela.
    await marcar(tenantC, 'NR-1', c.userId);
  });

  afterAll(async () => {
    await client().query('DELETE FROM company_applicable_nrs WHERE tenant_id = ANY($1::uuid[])', [[tenantA, tenantB, tenantC]]);
    await client().query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantA]);
    await client().query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('calcula o status por NR marcada, na ordem do catálogo, com fonte oficial', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard/nr-conformidade').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.nrs.map((n: any) => [n.code, n.status])).toEqual([
      ['NR-1', 'em_dia'],
      ['NR-7', 'pendente'],
    ]);
    expect(res.body.nrs[0].evidencia.quantidade).toBe(1);
    expect(res.body.nrs[0].evidencia.proxima_validade).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.nrs[0].fonte_oficial_url).toMatch(/^https:\/\//);
  });

  it('empresa sem NR marcada recebe lista vazia, mesmo com documentos (isolamento A×B)', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard/nr-conformidade').set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.nrs).toEqual([]);
  });

  it('empresa ignora tenant_id da query e só vê a própria (nunca confia no id do frontend)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/dashboard/nr-conformidade?tenant_id=${tenantA}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.nrs).toEqual([]);
  });

  it('técnico vinculado lê a empresa A pelo tenant_id', async () => {
    const res = await request(app.getHttpServer())
      .get(`/dashboard/nr-conformidade?tenant_id=${tenantA}`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    expect(res.body.nrs.map((n: any) => n.code)).toEqual(['NR-1', 'NR-7']);
  });

  it('técnico NÃO vinculado recebe 403 (não um "tudo vazio")', async () => {
    const res = await request(app.getHttpServer())
      .get(`/dashboard/nr-conformidade?tenant_id=${tenantC}`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(403);
  });

  it('técnico sem tenant_id recebe 400', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard/nr-conformidade').set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(400);
  });

  it('sem token recebe 401', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard/nr-conformidade');
    expect(res.status).toBe(401);
  });

  it('nr-aplicaveis devolve o catálogo completo e só as marcadas vigentes', async () => {
    const res = await request(app.getHttpServer())
      .get(`/dashboard/nr-aplicaveis?tenant_id=${tenantA}`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    expect(res.body.catalogo.map((n: any) => n.code)).toEqual(['NR-1', 'NR-5', 'NR-6', 'NR-7', 'NR-15', 'NR-16', 'NR-23']);
    expect(res.body.marcadas).toEqual(['NR-1', 'NR-7']);
  });

  it('NR desmarcada (unmarked_at) some do cálculo', async () => {
    await client().query(`UPDATE company_applicable_nrs SET unmarked_at = now() WHERE tenant_id = $1 AND nr_code = 'NR-7'`, [tenantA]);
    const res = await request(app.getHttpServer()).get('/dashboard/nr-conformidade').set('Authorization', `Bearer ${tokenA}`);
    expect(res.body.nrs.map((n: any) => n.code)).toEqual(['NR-1']);
    await client().query(`UPDATE company_applicable_nrs SET unmarked_at = NULL WHERE tenant_id = $1 AND nr_code = 'NR-7'`, [tenantA]);
  });

  it('NR marcada sem nenhuma evidência fica pendente com quantidade 0', async () => {
    await marcar(tenantA, 'NR-23', userA);
    const res = await request(app.getHttpServer()).get('/dashboard/nr-conformidade').set('Authorization', `Bearer ${tokenA}`);
    const nr23 = res.body.nrs.find((n: any) => n.code === 'NR-23');
    expect(nr23.status).toBe('pendente');
    expect(nr23.evidencia.quantidade).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha (404 nos endpoints)**

Preparar o clone descartável e aplicar a `0064` **somente nele** (receita em `reference_running_tests_in_throwaway_container`: `CREATE DATABASE montese_rehearsal` a partir do dump local mais recente, `DATABASE_URL`/`TEST_SUPERUSER_DATABASE_URL` apontando para o clone, Redis descartável). Rodar:
`docker run --rm --network montese_internal ... node:20-alpine sh -c "... npx jest --config ./test/jest-e2e.json nr-conformidade --runInBand --forceExit --verbose" > <log no scratchpad> 2>&1 &`
(redirecionar para arquivo; nunca `| tail`).
Expected: FAIL — os GET retornam 404.

- [ ] **Step 3: Adicionar os endpoints**

Em `backend/src/dashboard/dashboard.controller.ts`, trocar o import e o construtor e adicionar os dois métodos depois de `overview`:

```ts
import { BadRequestException, Controller, Get, Query, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';
import { NrConformidadeService } from '../nr-conformidade/nr-conformidade.service';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly nrConformidade: NrConformidadeService,
  ) {}
```

```ts
  // Status por NR marcada como aplicável (evidências já cadastradas). Não afirma obrigação legal.
  @Roles('empresa', 'tecnico', 'parceiro')
  @Get('nr-conformidade')
  nrConformidadeStatus(@Query('tenant_id') tenantIdQuery: string | undefined, @Req() req: any) {
    return this.withTargetTenant(req, tenantIdQuery, (client, tenantId) => this.nrConformidade.getConformidade(client, tenantId));
  }

  // Catálogo + NRs hoje marcadas, para pré-preencher o bloco do relatório de visita.
  @Roles('empresa', 'tecnico', 'parceiro')
  @Get('nr-aplicaveis')
  nrAplicaveis(@Query('tenant_id') tenantIdQuery: string | undefined, @Req() req: any) {
    return this.withTargetTenant(req, tenantIdQuery, (client, tenantId) => this.nrConformidade.getAplicaveis(client, tenantId));
  }
```

Em `backend/src/dashboard/dashboard.module.ts`, adicionar o import e incluir `NrConformidadeModule` em `imports`:

```ts
import { NrConformidadeModule } from '../nr-conformidade/nr-conformidade.module';
// ...
  imports: [
    DocumentsModule,
    PositionsModule,
    FireSafetyEquipmentModule,
    FireBrigadeModule,
    PreventionCorrectiveActionsModule,
    NrConformidadeModule,
  ],
```

- [ ] **Step 4: Rodar o e2e e confirmar que passa**

Mesmo comando do Step 2 (um log novo).
Expected: PASS — 10 testes. Se algum falhar por 429 ou timeout de `beforeAll`, reexecutar isolado antes de concluir (armadilha documentada na memória do projeto).

- [ ] **Step 5: Rodar o dashboard existente (regressão)**

Rodar no clone: `dashboard-overview dashboard-summary` (mesmo comando, specs diferentes).
Expected: PASS (nenhuma mudança de comportamento).

- [ ] **Step 6: Checkpoint (sem commit)**

Run: `cd /opt/Montese && git status --short && git diff --stat`
Parar.

---

### Task 4: Inspeções — campo, atualização jsonb e aplicação na conclusão

**Files:**
- Modify: `backend/src/inspections/dto/update-inspection.dto.ts`
- Modify: `backend/src/inspections/inspections.service.ts` (interface `Inspection` ~linha 9-30; `update` ~linha 230; `conclude` ~linha 270; construtor)
- Modify: `backend/src/inspections/inspections.module.ts`
- Test: `backend/test/inspections-nrs-aplicaveis.e2e-spec.ts`

**Interfaces:**
- Consumes (Tasks 1–2): `NR_CODES`, `NrConformidadeService.applyMarks`.
- Produces: `PATCH /inspections/:id` aceita `nrs_aplicaveis?: string[]` (validado contra `NR_CODES`, sem duplicatas); `GET /inspections/:id` devolve `nrs_aplicaveis: string[] | null`; `POST /inspections/:id/concluir` aplica o rascunho em `company_applicable_nrs` (só se `nrs_aplicaveis` não for NULL).

- [ ] **Step 1: Escrever o e2e (falhando)**

Criar `backend/test/inspections-nrs-aplicaveis.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Inspeções — NRs aplicáveis (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let companyUnitId: string;
  let technicianId: string;
  let technicianToken: string;
  let empresaToken: string;
  const client = () => (db as any).client;
  const http = () => request(app.getHttpServer());

  async function novaInspecao(): Promise<string> {
    const res = await http()
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-10-01', company_unit_id: companyUnitId });
    return res.body.id;
  }
  async function vigentes(): Promise<string[]> {
    const r = await client().query(
      `SELECT nr_code FROM company_applicable_nrs WHERE tenant_id = $1 AND unmarked_at IS NULL ORDER BY nr_code`,
      [tenantId],
    );
    return r.rows.map((x: any) => x.nr_code);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Inspecao NR Teste');
    tenantId = tenant.tenantId;
    const unit = await client().query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unit.rows[0].id;
    const tech = await db.createUserWithRole('tecnico', 'Tecnico Inspecao NR Teste');
    const t = await client().query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tech.userId]);
    technicianId = t.rows[0].id;
    await client().query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [tenantId, technicianId]);
    const lt = await http().post('/auth/login').send({ email: tech.email, password: tech.password });
    technicianToken = lt.body.access_token;
    const le = await http().post('/auth/login').send({ email: tenant.email, password: tenant.password });
    empresaToken = le.body.access_token;
  });

  afterAll(async () => {
    await client().query('DELETE FROM company_applicable_nrs WHERE tenant_id = $1', [tenantId]);
    await client().query('DELETE FROM inspections WHERE tenant_id = $1', [tenantId]);
    await client().query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await client().query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('PATCH grava o rascunho em nrs_aplicaveis e o GET devolve a lista', async () => {
    const id = await novaInspecao();
    const patch = await http().patch(`/inspections/${id}`).set('Authorization', `Bearer ${technicianToken}`).send({ nrs_aplicaveis: ['NR-1', 'NR-5'] });
    expect(patch.status).toBe(200);
    expect(patch.body.nrs_aplicaveis).toEqual(['NR-1', 'NR-5']);
    const get = await http().get(`/inspections/${id}`).set('Authorization', `Bearer ${technicianToken}`);
    expect(get.body.nrs_aplicaveis).toEqual(['NR-1', 'NR-5']);
    expect(await vigentes()).toEqual([]); // rascunho NÃO grava aplicabilidade ainda
  });

  it('rejeita NR fora do catálogo (400) e lista com duplicata (400)', async () => {
    const id = await novaInspecao();
    const fora = await http().patch(`/inspections/${id}`).set('Authorization', `Bearer ${technicianToken}`).send({ nrs_aplicaveis: ['NR-99'] });
    expect(fora.status).toBe(400);
    const dup = await http().patch(`/inspections/${id}`).set('Authorization', `Bearer ${technicianToken}`).send({ nrs_aplicaveis: ['NR-1', 'NR-1'] });
    expect(dup.status).toBe(400);
  });

  it('empresa não marca NR (403): só técnico/parceiro edita a inspeção', async () => {
    const id = await novaInspecao();
    const res = await http().patch(`/inspections/${id}`).set('Authorization', `Bearer ${empresaToken}`).send({ nrs_aplicaveis: ['NR-1'] });
    expect(res.status).toBe(403);
  });

  it('concluir aplica o rascunho: insere as NRs com autoria e visita de origem', async () => {
    const id = await novaInspecao();
    await http().patch(`/inspections/${id}`).set('Authorization', `Bearer ${technicianToken}`).send({ nrs_aplicaveis: ['NR-1', 'NR-5'] });
    const done = await http().post(`/inspections/${id}/concluir`).set('Authorization', `Bearer ${technicianToken}`);
    expect(done.status).toBeLessThan(300);
    expect(await vigentes()).toEqual(['NR-1', 'NR-5']);
    const r = await client().query(
      `SELECT source_inspection_id, marked_by_user_id FROM company_applicable_nrs WHERE tenant_id = $1 AND nr_code = 'NR-1' AND unmarked_at IS NULL`,
      [tenantId],
    );
    expect(r.rows[0].source_inspection_id).toBe(id);
    expect(r.rows[0].marked_by_user_id).toBeTruthy();
  });

  it('nova visita que desmarca NR-5 e adiciona NR-7: NR-5 recebe unmarked_at, NR-1 não duplica', async () => {
    const id = await novaInspecao();
    await http().patch(`/inspections/${id}`).set('Authorization', `Bearer ${technicianToken}`).send({ nrs_aplicaveis: ['NR-1', 'NR-7'] });
    await http().post(`/inspections/${id}/concluir`).set('Authorization', `Bearer ${technicianToken}`);
    expect(await vigentes()).toEqual(['NR-1', 'NR-7']);
    const hist = await client().query(
      `SELECT count(*)::int AS n FROM company_applicable_nrs WHERE tenant_id = $1 AND nr_code = 'NR-5' AND unmarked_at IS NOT NULL`,
      [tenantId],
    );
    expect(hist.rows[0].n).toBe(1); // desmarcar não apaga: o histórico fica
    const nr1 = await client().query(`SELECT count(*)::int AS n FROM company_applicable_nrs WHERE tenant_id = $1 AND nr_code = 'NR-1'`, [tenantId]);
    expect(nr1.rows[0].n).toBe(1);
  });

  it('visita em que o técnico não mexeu no bloco (NULL) não altera a aplicabilidade', async () => {
    const antes = await vigentes();
    const id = await novaInspecao();
    const done = await http().post(`/inspections/${id}/concluir`).set('Authorization', `Bearer ${technicianToken}`);
    expect(done.status).toBeLessThan(300);
    expect(await vigentes()).toEqual(antes);
  });

  it('lista vazia explícita desmarca tudo', async () => {
    const id = await novaInspecao();
    await http().patch(`/inspections/${id}`).set('Authorization', `Bearer ${technicianToken}`).send({ nrs_aplicaveis: [] });
    await http().post(`/inspections/${id}/concluir`).set('Authorization', `Bearer ${technicianToken}`);
    expect(await vigentes()).toEqual([]);
  });

  it('a marcação persiste mesmo se o PDF não puder ser gerado/indexado (ordem antes do SAVEPOINT)', async () => {
    // No ambiente de teste o storage R2 normalmente não existe, então a indexação do PDF falha
    // e cai no ROLLBACK TO SAVEPOINT. A marcação já aplicada não pode ser desfeita por isso.
    const id = await novaInspecao();
    await http().patch(`/inspections/${id}`).set('Authorization', `Bearer ${technicianToken}`).send({ nrs_aplicaveis: ['NR-23'] });
    await http().post(`/inspections/${id}/concluir`).set('Authorization', `Bearer ${technicianToken}`);
    expect(await vigentes()).toEqual(['NR-23']);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

No clone (com a `0064` aplicada): `... npx jest --config ./test/jest-e2e.json inspections-nrs-aplicaveis --runInBand --forceExit --verbose` > log novo.
Expected: FAIL (o PATCH com `nrs_aplicaveis` volta 400 por `forbidNonWhitelisted`).

- [ ] **Step 3: DTO**

Em `backend/src/inspections/dto/update-inspection.dto.ts`, ajustar o import de `class-validator` e adicionar o campo no fim da classe:

```ts
import { ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Matches, Min } from 'class-validator';
import { NR_CODES } from '../../nr-conformidade/nr-catalog';
```

```ts
  // Rascunho das NRs aplicáveis (só é gravado em company_applicable_nrs ao concluir).
  // `NR_CODES` é readonly string[]; IsIn exige array mutável, daí o spread.
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn([...NR_CODES], { each: true })
  nrs_aplicaveis?: string[];
```

(`Transform` continua importado de `class-transformer` na linha 1 — não remover.)

- [ ] **Step 4: Serviço — interface, update e conclusão**

Em `backend/src/inspections/inspections.service.ts`:

1. Import e construtor: adicionar `import { NrConformidadeService } from '../nr-conformidade/nr-conformidade.service';` e `private readonly nrConformidade: NrConformidadeService,` ao construtor existente (manter os demais parâmetros e a ordem; só acrescentar no fim).
2. Na interface `Inspection`, antes de `concluded_at`, acrescentar: `nrs_aplicaveis: string[] | null;`
3. Em `update`, substituir a linha `const { setClauses, values } = buildSafeSetClause(data, INSPECTION_UPDATABLE_FIELDS, 2);` por:

```ts
    // jsonb: o node-pg converteria um array JS em array Postgres, não em JSON — por isso
    // este campo fica fora de buildSafeSetClause e é serializado explicitamente.
    const { nrs_aplicaveis, ...resto } = data as Partial<Inspection>;
    const { setClauses, values } = buildSafeSetClause(resto, INSPECTION_UPDATABLE_FIELDS, 2);
    if (nrs_aplicaveis !== undefined) {
      setClauses.push(`nrs_aplicaveis = $${values.length + 2}::jsonb`);
      values.push(JSON.stringify(nrs_aplicaveis));
    }
```

   As duas checagens seguintes (`(data as any).technician_signature_name` e `company_signature_name`) continuam usando `data`, sem mudança.

4. Em `conclude`, logo **depois** do `for (const item of ncItemsResult.rows) { ... }` e **antes** de `const detail = await this.findOne(client, id);`, inserir:

```ts
    // Aplicabilidade das NRs (spec conformidade-por-nr): aplicada AQUI, antes do SAVEPOINT do
    // PDF, para que uma falha de geração/indexação do PDF nunca desfaça a marcação. NULL = o
    // técnico não mexeu no bloco nesta visita: não altera nada.
    const draftResult = await client.query<{ nrs_aplicaveis: string[] | null }>(
      'SELECT nrs_aplicaveis FROM inspections WHERE id = $1',
      [id],
    );
    const draftNrs = draftResult.rows[0].nrs_aplicaveis;
    if (draftNrs !== null) {
      await this.nrConformidade.applyMarks(client, tenantId, id, userId, draftNrs);
    }
```

- [ ] **Step 5: Módulo**

Em `backend/src/inspections/inspections.module.ts`, importar `NrConformidadeModule` (`import { NrConformidadeModule } from '../nr-conformidade/nr-conformidade.module';`) e acrescentá-lo ao array `imports` existente.

- [ ] **Step 6: Compilar e achar construtores manuais**

Run: `cd /opt/Montese/backend && npx tsc --noEmit -p tsconfig.json && grep -rn "new InspectionsService(" src test`
Expected: sem erro de tipo; o grep não deve achar nada. Se achar, acrescentar o novo parâmetro nesses testes.

- [ ] **Step 7: Rodar o e2e novo e a regressão de inspeções**

No clone, em sequência (um log por run): `inspections-nrs-aplicaveis`, depois `inspections-update inspections-conclude inspections-rls inspections-partner inspections-create-list inspection-pdf`.
Expected: PASS em tudo. (`inspection-pdf` pode ter falha preexistente por R2 ausente — comparar com o HEAD antes de concluir que é regressão.)

- [ ] **Step 8: Checkpoint (sem commit)**

Run: `cd /opt/Montese && git status --short && git diff --stat`
Parar.

---

### Task 5: Cartão "Conformidade por NR" no dashboard

**Files:**
- Modify: `frontend/src/lib/dashboard/api-types.ts`
- Modify: `frontend/src/lib/dashboard/real.ts`
- Modify: `frontend/src/lib/dashboard/__tests__/real.test.ts`
- Create: `frontend/src/components/dashboard/NrConformidadeCard.tsx`
- Modify: `frontend/src/components/dashboard/__tests__/blocos.test.tsx`
- Modify: `frontend/src/app/dashboard-v2/page.tsx`

**Interfaces:**
- Consumes: JSON de `GET /api/dashboard/nr-conformidade` → `{ nrs: ApiNrItem[] }`.
- Produces: `ApiNrStatus`, `ApiNrItem` (em `api-types.ts`); `NrLinha` e `paraNrLinhas(itens: ApiNrItem[]): NrLinha[]` (em `real.ts`); `NrConformidadeCard({ itens }: { itens: NrLinha[] | null })`.

- [ ] **Step 1: Teste do conversor (falhando)**

No fim de `frontend/src/lib/dashboard/__tests__/real.test.ts`, acrescentar (e incluir `paraNrLinhas` no import existente de `../real`, e `ApiNrItem` em um `import type` de `../api-types`):

```ts
describe('paraNrLinhas', () => {
  const base = { nome: 'PCMSO', fonte_oficial_url: 'https://www.gov.br/x' };
  it('mapeia status para rótulo em texto e tom', () => {
    const itens: ApiNrItem[] = [
      { ...base, code: 'NR-1', status: 'em_dia', evidencia: { quantidade: 2, proxima_validade: '2027-03-01' } },
      { ...base, code: 'NR-6', status: 'atencao', evidencia: { quantidade: 1, proxima_validade: '2026-10-20' } },
      { ...base, code: 'NR-7', status: 'pendente', evidencia: { quantidade: 0, proxima_validade: null } },
    ];
    const linhas = paraNrLinhas(itens);
    expect(linhas.map((l) => [l.code, l.rotulo, l.tone])).toEqual([
      ['NR-1', 'Em dia', 'ok'],
      ['NR-6', 'Atenção', 'warn'],
      ['NR-7', 'Pendente', 'crit'],
    ]);
  });
  it('detalhe usa "evidências cadastradas" e a próxima validade formatada', () => {
    const [a, b, c] = paraNrLinhas([
      { ...base, code: 'NR-1', status: 'em_dia', evidencia: { quantidade: 2, proxima_validade: '2027-03-01' } },
      { ...base, code: 'NR-5', status: 'em_dia', evidencia: { quantidade: 1, proxima_validade: null } },
      { ...base, code: 'NR-7', status: 'pendente', evidencia: { quantidade: 0, proxima_validade: null } },
    ]);
    expect(a.detalhe).toBe('2 evidências cadastradas · próxima validade 01/03/2027');
    expect(b.detalhe).toBe('1 evidência cadastrada');
    expect(c.detalhe).toBe('Nenhuma evidência cadastrada');
  });
  it('nao_avaliavel mostra a mensagem do backend e não inventa número', () => {
    const [l] = paraNrLinhas([{ ...base, code: 'NR-23', status: 'nao_avaliavel', evidencia: null, mensagem: 'Não foi possível calcular agora.' }]);
    expect(l.rotulo).toBe('Não avaliável');
    expect(l.tone).toBe('info');
    expect(l.detalhe).toBe('Não foi possível calcular agora.');
  });
});
```

- [ ] **Step 2: Teste do cartão (falhando)**

Em `frontend/src/components/dashboard/__tests__/blocos.test.tsx`, acrescentar `import { NrConformidadeCard } from '../NrConformidadeCard';` e `import type { NrLinha } from '@/lib/dashboard/real';` aos imports e, no fim do arquivo:

```tsx
describe('NrConformidadeCard', () => {
  const linhas: NrLinha[] = [
    { code: 'NR-1', nome: 'PGR', rotulo: 'Em dia', tone: 'ok', detalhe: '1 evidência cadastrada', fonteUrl: 'https://www.gov.br/x' },
    { code: 'NR-7', nome: 'PCMSO', rotulo: 'Pendente', tone: 'crit', detalhe: 'Nenhuma evidência cadastrada', fonteUrl: 'https://www.gov.br/x' },
  ];
  it('lista cada NR com status em TEXTO, detalhe e link da fonte oficial', () => {
    render(<NrConformidadeCard itens={linhas} />);
    expect(screen.getByText('NR-7')).toBeInTheDocument();
    expect(screen.getByText('Pendente')).toBeInTheDocument();
    expect(screen.getByText('Em dia')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Fonte oficial da NR-1' });
    expect(link).toHaveAttribute('href', 'https://www.gov.br/x');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
  it('mostra o aviso de que não substitui a avaliação técnica', () => {
    render(<NrConformidadeCard itens={linhas} />);
    expect(screen.getByText(/Não substitui a avaliação técnica/)).toBeInTheDocument();
  });
  it('sem NRs marcadas: estado vazio explicativo, sem número', () => {
    render(<NrConformidadeCard itens={[]} />);
    expect(screen.getByText(/Nenhuma visita técnica registrou NRs aplicáveis/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
  it('backend indisponível (null): diz "indisponível" e não inventa dado', () => {
    render(<NrConformidadeCard itens={null} />);
    expect(screen.getByText(/indisponível no momento/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falham**

Run: `cd /opt/Montese/frontend && npx vitest run src/lib/dashboard/__tests__/real.test.ts src/components/dashboard/__tests__/blocos.test.tsx`
Expected: FAIL (`paraNrLinhas`/`NrConformidadeCard` não existem).

- [ ] **Step 4: Tipos**

Em `frontend/src/lib/dashboard/api-types.ts`, acrescentar no fim:

```ts
// Espelho de backend/src/nr-conformidade/nr-conformidade.service.ts (NrConformidadeItem).
export type ApiNrStatus = 'em_dia' | 'atencao' | 'pendente' | 'nao_avaliavel';

export interface ApiNrItem {
  code: string;
  nome: string;
  status: ApiNrStatus;
  evidencia: { quantidade: number; proxima_validade: string | null } | null; // yyyy-mm-dd
  fonte_oficial_url: string;
  mensagem?: string;
}
```

- [ ] **Step 5: Conversor**

Em `frontend/src/lib/dashboard/real.ts`: trocar a linha de import de tipos por `import type { ApiAttentionItem, ApiNrItem, ApiNrStatus, ApiPrioridade, ApiStatus } from './api-types';` e acrescentar, antes de `// Data local de hoje...`:

```ts
const NR_STATUS: Record<ApiNrStatus, { rotulo: string; tone: Tone }> = {
  em_dia: { rotulo: 'Em dia', tone: 'ok' },
  atencao: { rotulo: 'Atenção', tone: 'warn' },
  pendente: { rotulo: 'Pendente', tone: 'crit' },
  nao_avaliavel: { rotulo: 'Não avaliável', tone: 'info' },
};

export interface NrLinha {
  code: string;
  nome: string;
  rotulo: string;
  tone: Tone;
  detalhe: string;
  fonteUrl: string;
}

// Texto sempre "evidências cadastradas": o sistema não afirma obrigação nem descumprimento.
export function paraNrLinhas(itens: ApiNrItem[]): NrLinha[] {
  return itens.map((item) => {
    const { rotulo, tone } = NR_STATUS[item.status];
    let detalhe: string;
    if (item.evidencia === null) {
      detalhe = item.mensagem ?? 'Sem dados para avaliar.';
    } else if (item.evidencia.quantidade === 0) {
      detalhe = 'Nenhuma evidência cadastrada';
    } else {
      const q = item.evidencia.quantidade;
      detalhe = `${q} ${q === 1 ? 'evidência cadastrada' : 'evidências cadastradas'}`;
      if (item.evidencia.proxima_validade) {
        detalhe += ` · próxima validade ${formatarData(item.evidencia.proxima_validade)}`;
      }
    }
    return { code: item.code, nome: item.nome, rotulo, tone, detalhe, fonteUrl: item.fonte_oficial_url };
  });
}
```

- [ ] **Step 6: Componente**

Criar `frontend/src/components/dashboard/NrConformidadeCard.tsx`:

```tsx
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { NrLinha } from '@/lib/dashboard/real';

// `itens` null = backend sem o dado (degrada como os demais cartões); [] = nenhuma NR
// marcada como aplicável. Nunca mostra número ou barra inventados.
export function NrConformidadeCard({ itens }: { itens: NrLinha[] | null }) {
  return (
    <Card title="Conformidade por NR" className="h-full">
      <p className="-mt-2 mb-3 text-xs text-dash-faint">Evidências cadastradas das NRs aplicáveis à empresa</p>
      {itens === null ? (
        <p className="text-sm text-dash-muted">Dado indisponível no momento.</p>
      ) : itens.length === 0 ? (
        <p className="text-sm text-dash-muted">
          Nenhuma visita técnica registrou NRs aplicáveis à sua empresa. O técnico marca as NRs no relatório de visita técnica.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-dash-border-soft">
          {itens.map((n) => (
            <li key={n.code} className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
              <div className="min-w-0">
                <p className="font-semibold text-dash-primary">
                  <span>{n.code}</span> <span className="font-normal text-dash-muted">· {n.nome}</span>
                </p>
                <p className="mt-0.5 text-[13px] text-dash-muted">{n.detalhe}</p>
                <a
                  href={n.fonteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Fonte oficial da ${n.code}`}
                  className="mt-0.5 inline-block text-[13px] font-semibold text-dash-brand-green-dark hover:underline"
                >
                  Fonte oficial
                </a>
              </div>
              <Badge tone={n.tone}>{n.rotulo}</Badge>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[12px] text-dash-faint">Baseado em evidências cadastradas. Não substitui a avaliação técnica.</p>
    </Card>
  );
}
```

- [ ] **Step 7: Página**

Em `frontend/src/app/dashboard-v2/page.tsx`:
1. Imports: `import { NrConformidadeCard } from '@/components/dashboard/NrConformidadeCard';`; ampliar o import de tipos para `import type { ApiNrItem, ApiOverview, ApiSummary } from '@/lib/dashboard/api-types';` e o de `real` para incluir `paraNrLinhas`.
2. Estado: `const [nrs, setNrs] = useState<ApiNrItem[] | null>(null);` (junto aos outros `useState`).
3. No `Promise.all`, trocar a desestruturação e a lista por:

```ts
      const [tenantRes, summaryRes, overviewRes, nrRes] = await Promise.all([
        fetch('/api/tenants/me', { headers }),
        fetch('/api/dashboard/summary', { headers }),
        fetch('/api/dashboard/overview', { headers }),
        fetch('/api/dashboard/nr-conformidade', { headers }),
      ]);
```
4. Logo depois de `setOverview(...)`:

```ts
      // Sem esta resposta o cartão mostra "indisponível"; o resto do painel segue.
      setNrs(nrRes.ok ? ((await nrRes.json()) as { nrs: ApiNrItem[] }).nrs : null);
```
5. Trocar a linha do `EmBreveCard titulo="Conformidade por NR"` por: `<NrConformidadeCard itens={nrs === null ? null : paraNrLinhas(nrs)} />`
   (o `EmBreveCard` continua importado e usado pelo cartão eSocial.)

- [ ] **Step 8: Rodar e confirmar que passam**

Run: `cd /opt/Montese/frontend && npx vitest run src/lib/dashboard src/components/dashboard`
Expected: PASS (incluindo os testes antigos).

- [ ] **Step 9: Typecheck**

Run: `cd /opt/Montese/frontend && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 10: Checkpoint (sem commit)**

Run: `cd /opt/Montese && git status --short && git diff --stat`
Parar.

---

### Task 6: Bloco "NRs aplicáveis à empresa" no relatório do técnico

**Files:**
- Create: `frontend/src/components/NrAplicaveisSection.tsx`
- Test: `frontend/src/components/__tests__/NrAplicaveisSection.test.tsx`
- Modify: `frontend/src/app/tecnico/empresas/[tenantId]/inspecoes/[id]/page.tsx`

**Interfaces:**
- Consumes (Tasks 3–4): `GET /api/dashboard/nr-aplicaveis?tenant_id=` → `{ catalogo: {code,nome}[]; marcadas: string[] }`; `PATCH /api/inspections/:id` com `{ nrs_aplicaveis: string[] }`; campo `nrs_aplicaveis: string[] | null` no GET da inspeção.
- Produces: `NrAplicaveisSection({ catalogo, selecionadas, disabled, onChange })`.

- [ ] **Step 1: Teste do componente (falhando)**

Criar `frontend/src/components/__tests__/NrAplicaveisSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NrAplicaveisSection } from '../NrAplicaveisSection';

const catalogo = [
  { code: 'NR-1', nome: 'PGR' },
  { code: 'NR-5', nome: 'CIPA' },
];

describe('NrAplicaveisSection', () => {
  it('mostra uma caixa por NR do catálogo, marcando as selecionadas', () => {
    render(<NrAplicaveisSection catalogo={catalogo} selecionadas={['NR-5']} disabled={false} onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /NR-1/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /NR-5/ })).toBeChecked();
  });
  it('marcar e desmarcar chama onChange com a lista nova, na ordem do catálogo', async () => {
    const onChange = vi.fn();
    render(<NrAplicaveisSection catalogo={catalogo} selecionadas={['NR-5']} disabled={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /NR-1/ }));
    expect(onChange).toHaveBeenLastCalledWith(['NR-1', 'NR-5']);
    await userEvent.click(screen.getByRole('checkbox', { name: /NR-5/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
  it('desabilitado (visita concluída): caixas travadas', () => {
    render(<NrAplicaveisSection catalogo={catalogo} selecionadas={[]} disabled onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /NR-1/ })).toBeDisabled();
  });
  it('explica que a decisão é do técnico e que só vale ao concluir', () => {
    render(<NrAplicaveisSection catalogo={catalogo} selecionadas={[]} disabled={false} onChange={() => {}} />);
    expect(screen.getByText(/aplicabilidade é decisão do técnico/i)).toBeInTheDocument();
    expect(screen.getByText(/ao concluir a visita/i)).toBeInTheDocument();
  });
});
```

Se `@testing-library/user-event` não estiver em `frontend/package.json`, trocar `userEvent.click` por `fireEvent.click` (importado de `@testing-library/react`) e `await` por chamadas síncronas — **não adicionar dependência nova** sem autorização.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd /opt/Montese/frontend && npx vitest run src/components/__tests__/NrAplicaveisSection.test.tsx`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Componente**

Criar `frontend/src/components/NrAplicaveisSection.tsx`:

```tsx
interface NrOpcao {
  code: string;
  nome: string;
}

// Bloco do relatório de visita técnica. Presentacional: quem carrega e salva é a página.
export function NrAplicaveisSection({
  catalogo,
  selecionadas,
  disabled,
  onChange,
}: {
  catalogo: NrOpcao[];
  selecionadas: string[];
  disabled: boolean;
  onChange: (proximas: string[]) => void;
}) {
  function alternar(code: string) {
    const marcadas = new Set(selecionadas);
    if (marcadas.has(code)) marcadas.delete(code);
    else marcadas.add(code);
    onChange(catalogo.map((n) => n.code).filter((c) => marcadas.has(c)));
  }

  return (
    <section className="mt-6 rounded-lg border border-brand-100 p-6">
      <h2 className="text-lg font-bold text-brand-900">NRs aplicáveis à empresa</h2>
      <p className="mt-2 text-sm text-brand-700">
        A aplicabilidade é decisão do técnico. O sistema não decide nem afirma obrigação legal. A marcação passa a valer
        ao concluir a visita e alimenta o cartão &quot;Conformidade por NR&quot; do painel da empresa.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {catalogo.map((n) => (
          <li key={n.code}>
            <label className="flex items-center gap-2 text-sm text-brand-900">
              <input
                type="checkbox"
                checked={selecionadas.includes(n.code)}
                disabled={disabled}
                onChange={() => alternar(n.code)}
              />
              <span>
                <strong>{n.code}</strong> · {n.nome}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `cd /opt/Montese/frontend && npx vitest run src/components/__tests__/NrAplicaveisSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Ligar na página do técnico**

Em `frontend/src/app/tecnico/empresas/[tenantId]/inspecoes/[id]/page.tsx`:

1. Import: `import { NrAplicaveisSection } from '@/components/NrAplicaveisSection';`
2. Na interface `InspectionDetail`, antes de `items: ChecklistItem[];`, acrescentar: `nrs_aplicaveis: string[] | null;`
3. Junto aos outros `useState`:

```tsx
  const [nrCatalogo, setNrCatalogo] = useState<{ code: string; nome: string }[]>([]);
  const [nrMarcadasVigentes, setNrMarcadasVigentes] = useState<string[]>([]);
```
4. Depois de `loadInspection()`, a função de carga do catálogo e o efeito (o efeito existente chama `loadInspection()`; acrescentar a chamada ali, no mesmo `useEffect`, logo após `loadInspection();`):

```tsx
  async function loadNrAplicaveis() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/dashboard/nr-aplicaveis?tenant_id=${params.tenantId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const body = await res.json();
        setNrCatalogo(body.catalogo);
        setNrMarcadasVigentes(body.marcadas);
      }
    } catch {
      // Sem o catálogo o bloco simplesmente não aparece; o resto do relatório segue normal.
    }
  }
```

   e dentro do `useEffect` existente: `loadInspection();` → `loadInspection();` seguido de `loadNrAplicaveis();`.

5. Junto de `saveHeaderField`, o salvamento do rascunho:

```tsx
  async function saveNrs(proximas: string[]) {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/inspections/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nrs_aplicaveis: proximas }),
      });
      if (res.ok) {
        const updated = await res.json();
        setInspection((prev) => (prev ? { ...prev, ...updated } : prev));
      } else {
        setError('Não foi possível salvar as NRs aplicáveis.');
      }
    } catch {
      setError('Não foi possível conectar ao servidor.');
    }
  }
```

6. Renderizar o bloco logo **depois** da `</section>` de "Identificação" (a seção que começa com `<h2 ...>Identificação</h2>` e fecha antes do `{BLOCK_ORDER.map(...)}`):

```tsx
      {nrCatalogo.length > 0 && (
        <NrAplicaveisSection
          catalogo={nrCatalogo}
          selecionadas={inspection.nrs_aplicaveis ?? nrMarcadasVigentes}
          disabled={!isDraft}
          onChange={saveNrs}
        />
      )}
```

   Pré-preenchimento: enquanto o técnico não mexeu, `inspection.nrs_aplicaveis` é `null` e a tela mostra as NRs vigentes da empresa; ao primeiro clique, o PATCH grava o rascunho completo.

- [ ] **Step 6: Typecheck e testes**

Run: `cd /opt/Montese/frontend && npx tsc --noEmit && npx vitest run`
Expected: sem erros de tipo; suíte inteira PASS.

- [ ] **Step 7: Checkpoint (sem commit)**

Run: `cd /opt/Montese && git status --short && git diff --stat`
Parar.

---

### Task 7: Menu "Relatório de visita técnica" e títulos

**Files:**
- Modify: `frontend/src/lib/dashboard/menu.ts`
- Test: `frontend/src/lib/dashboard/__tests__/menu.test.ts` (novo — não existe teste do menu hoje, VERIFICADO)
- Modify: `frontend/src/app/empresa/inspecoes/page.tsx` (título da página, linha ~147)
- Modify: `frontend/src/app/tecnico/empresas/[tenantId]/page.tsx` (título da seção, linha ~215)

**Interfaces:**
- Consumes: `MENU_ITEMS`, `EXTRA_MENU_ITEMS`, `MenuItem` (existentes).
- Produces: item `{ href: '/empresa/inspecoes', label: 'Relatório de visita técnica', ... }` no grupo principal, imediatamente depois de Documentos.

- [ ] **Step 1: Teste do menu (falhando)**

Criar `frontend/src/lib/dashboard/__tests__/menu.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EXTRA_MENU_ITEMS, MENU_ITEMS } from '../menu';

describe('menu do dashboard', () => {
  it('"Relatório de visita técnica" fica logo depois de Documentos, no grupo principal', () => {
    const labels = MENU_ITEMS.map((i) => i.label);
    const iDocs = labels.indexOf('Documentos');
    expect(iDocs).toBeGreaterThanOrEqual(0);
    expect(labels[iDocs + 1]).toBe('Relatório de visita técnica');
  });
  it('mantém a rota existente (links antigos continuam válidos) e está implementado', () => {
    const item = MENU_ITEMS.find((i) => i.label === 'Relatório de visita técnica');
    expect(item?.href).toBe('/empresa/inspecoes');
    expect(item?.implemented).toBe(true);
  });
  it('não sobra o item antigo "Inspeções" nem duplicata da mesma rota', () => {
    expect(EXTRA_MENU_ITEMS.some((i) => i.label === 'Inspeções')).toBe(false);
    const hrefs = [...MENU_ITEMS, ...EXTRA_MENU_ITEMS].map((i) => i.href);
    expect(hrefs.filter((h) => h === '/empresa/inspecoes')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `cd /opt/Montese/frontend && npx vitest run src/lib/dashboard/__tests__/menu.test.ts`
Expected: FAIL.

- [ ] **Step 3: Ajustar `menu.ts`**

Em `frontend/src/lib/dashboard/menu.ts`:
- Em `MENU_ITEMS`, logo após a linha de `Documentos`, inserir:
  `  { href: '/empresa/inspecoes', label: 'Relatório de visita técnica', icon: ClipboardCheck, implemented: true },`
- Em `EXTRA_MENU_ITEMS`, **remover** a linha `{ href: '/empresa/inspecoes', label: 'Inspeções', icon: ClipboardCheck, implemented: true },`.

(`ClipboardCheck` já está importado.)

- [ ] **Step 4: Títulos das páginas**

- `frontend/src/app/empresa/inspecoes/page.tsx`: trocar `<h1 className="text-2xl font-bold text-brand-900">Inspeções</h1>` por `...>Relatório de visita técnica</h1>`.
- `frontend/src/app/tecnico/empresas/[tenantId]/page.tsx`: trocar `<h2 className="text-lg font-bold text-brand-900">Inspeções</h2>` por `...>Relatórios de visita técnica</h2>`.
- Não alterar `EmpresaSidebar.tsx` (sidebar antiga, fora do escopo) nem as páginas de admin.

- [ ] **Step 5: Rodar tudo do frontend**

Run: `cd /opt/Montese/frontend && npx vitest run && npx tsc --noEmit`
Expected: PASS e sem erro de tipo. Se algum teste existente referenciar o rótulo "Inspeções", atualizar o texto esperado.

- [ ] **Step 6: Checkpoint (sem commit)**

Run: `cd /opt/Montese && git status --short && git diff --stat`
Parar.

---

### Task 8: Verificação final (nada de deploy)

**Files:**
- Modify: `docs/superpowers/specs/2026-10-01-conformidade-por-nr-design.md` (só se algo divergiu na implementação)

- [ ] **Step 1: Typecheck e build**

Run:
`cd /opt/Montese/backend && npx tsc --noEmit -p tsconfig.json`
`cd /opt/Montese/frontend && npx tsc --noEmit && npx next build` (se `next build` exigir variáveis de ambiente indisponíveis no host, registrar como NÃO VERIFICADO em vez de forçar).
Expected: sem erros.

- [ ] **Step 2: Suíte unitária do backend (host)**

Run: `cd /opt/Montese/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json --forceExit`
Expected: PASS nos novos. Falhas já conhecidas e **não** causadas por esta mudança: `question-notices`, `normative-answer-shared`, `r2-get-object`. Qualquer outra falha: investigar antes de concluir.

- [ ] **Step 3: Varredura de isolamento (clone descartável)**

No clone com a `0064` aplicada: `test:isolation` (`tenant-context-callsites` unit e `tenant-isolation-sweep` e2e). Expected: PASS. Se o sweep enumerar tabelas com `tenant_id` e exigir registro da nova tabela, registrar `company_applicable_nrs` conforme o padrão do próprio teste.

- [ ] **Step 4: Prova de que a proteção de RLS é real (RED→GREEN)**

No clone, sabotar a policy de `company_applicable_nrs` (`MUTATION_SQL`, receita do `rehearsal2.sh`: `DROP POLICY company_applicable_nrs_isolation ON company_applicable_nrs; CREATE POLICY company_applicable_nrs_isolation ON company_applicable_nrs USING (true);`) e rodar `nr-conformidade` no banco sabotado.
Expected: o teste de isolamento A×B **continua passando por causa do filtro explícito de `tenant_id`**; registrar isso como VERIFICADO (a defesa em profundidade é a RLS, o filtro explícito é a primeira barreira). Restaurar o clone depois. Se preferir uma prova direta de RLS, consultar `company_applicable_nrs` como `app.tenant_id` da empresa B por SQL e confirmar 0 linhas da A.

- [ ] **Step 5: Limpar resíduos de teste**

No clone nada a limpar além do próprio clone (apagar `montese_rehearsal` ao fim). Em qualquer banco real tocado por engano: conferir `tenants`/`users` recentes com "Teste" no nome e apagar por id (armadilha documentada: run cancelado deixa fixtures).

- [ ] **Step 6: Relatório final ao dono**

Entregar: o que foi feito, o que foi **VERIFICADO** (com o comando e a saída), o que ficou **NÃO VERIFICADO** (ex.: `next build`, página do MTE se não confirmada, qualquer teste não executado) e o que **depende de autorização**:
- Aplicar a migration `0064` em produção (backup antes: `bash ops/backup-postgres.sh`);
- Deploy do backend e do frontend (release completo, modelo em `docs/operations/release-backend-2026-09-30.md`);
- Commits e push (decisão do dono).

- [ ] **Step 7: Checkpoint final (sem commit)**

Run: `cd /opt/Montese && git status --short && git diff --stat`
Parar. Nenhum commit foi feito por este plano.
