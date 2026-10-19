# EPI — Menu, telas do responsável e dashboard (Subsistema 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao responsável a interface completa do módulo EPI (painel, cadastro, movimentação, fichas, assinatura) no dashboard da Empresa e, pelos mesmos componentes, na rota única do técnico/parceiro, com o backend de apoio (dashboard agregado, configuração de alertas, pendências de assinatura) e a rota legada de entrega endurecida.

**Architecture:** Backend NestJS ganha três rotas de leitura/configuração e um endurecimento, todas sob RLS e com `tenant_id` explícito para técnico/parceiro/admin. O frontend ganha `lib/epi/` (cliente tipado, mensagens de erro, download por Blob, chave de idempotência) e `components/epi/` (uma *view* por área, recebendo `tenantId?`), páginas finas em `app/empresa/epi/*` e uma rota única com abas em `app/tecnico/empresas/[tenantId]/epi`. O menu da Empresa troca o item "EPIs" por um setor "EPI".

**Tech Stack:** NestJS, PostgreSQL (RLS), class-validator, Jest + supertest; Next.js 14, React 18, TypeScript, Tailwind, Vitest + Testing Library, `qrcode` (nova, versão fixa).

**Spec:** `docs/superpowers/specs/2026-10-18-epi-telas-dashboard-design.md` (depende das specs dos subsistemas 1 a 3 em `docs/superpowers/specs/`).

## Global Constraints

- **Sem `git commit`, `push`, `reset`, `stash`, `checkout`, `add`.** O proprietário decide os commits; os passos "Entrega" listam arquivos e param. Trabalhar só em `/opt/montese-epi` (branch `feat/epi-estoque`, que contém os subsistemas 1 a 3, sem commit). Nunca em `/opt/Montese` (leitura apenas quando indicado).
- **Testes só em ensaio descartável** (Postgres+Redis próprios, senhas aleatórias, chaves falsas); nunca ler/imprimir `.env`/`ensaio.env`; nunca tocar nos containers `montese_*`, Docker Compose, Nginx, Redis/banco de produção, `Dockerfile`; nunca `run-backend-tests.sh`. **R2 sempre mockado** nos e2e. Nenhuma chamada real a e-mail/Mercado Pago/OpenRouter.
- **Scripts do scratchpad** (`/tmp/claude-0/-opt-Montese/8c2ba2eb-4c11-43d4-a3d0-94e201ce53cb/scratchpad/`; o diretório já foi esvaziado uma vez entre sessões: se faltarem, recriar): `ensaio-up.sh`, `ensaio-migrate.sh`, `ensaio-down.sh`, `run-be-rl.sh <e2e|unit> "<padrões>" <log>` (RATE_LIMIT_MAX alto), `run-fe.sh <log> <comando>` (container descartável `node:20-bookworm-slim` com CÓPIA do frontend e cache `nmf/`), `snap.sh`, `pkg.sh`. Redirecionar log para arquivo e lê-lo com Read/Grep; nunca `| tail` direto; execuções em sequência. A suíte e2e completa num só processo estoura memória: usar padrões ou lotes de 12 (`NODE_OPTIONS="--experimental-vm-modules --max-old-space-size=3072"`). Nenhum script pode conter `rm` de arquivos fora de `docker rm -f` dos containers do ensaio (a verificação de segurança bloqueia remoções em `bash -c`).
- Isolamento entre empresas é crítico: rotas novas sob `req.withTenantContext`; **para `tecnico`/`parceiro`/`admin` o `tenant_id` é obrigatório nas rotas agregadas** (senão a RLS agregaria várias empresas), e para `empresa` ele é opcional e, se enviado, deve ser o próprio (senão 400). Entrada inválida nunca vira 500 (ParseUUIDPipe, class-validator, `DATE_ONLY` e `NO_NUL` de `src/epi/dto/epi-dto-rules.ts`).
- **CPF nunca em tela, resposta nova ou log.** O código e o link de assinatura aparecem só no estado React do diálogo de criação, **uma vez**, são limpos ao fechar e jamais vão a `localStorage`/`sessionStorage`/log.
- Frontend: sem dependência nova além de `qrcode` (versão **fixa**, `--save-exact`) e `@types/qrcode`; rodar `npm audit` e registrar; o lockfile muda e fica sem commit. Sem `console.log` de dados; mensagens de erro de lista fechada (nunca texto cru do servidor); mobile-first, acessível (rótulos, foco em diálogos, `aria-live`, contraste AA, alvos ≥ 44 px, texto ≥ 16 px), estados vazio/erro/carregando, confirmação em ações destrutivas. Reaproveitar `Card`, `Badge`, `KpiCard`, `PageHeader`, `DashSkin`, `AsyncBody`.
- **Decisões do proprietário (2026-10-18):** empresa agora e técnico reaproveitando componentes; `qrcode` aprovada; painel antigo substituído e rota legada endurecida (409 para EPI inativo, CA vencido e EPI com movimentação no livro); período padrão do dashboard 30 dias; dias de aviso ajustáveis no cabeçalho do painel só por `empresa`.
- Rotular o que for afirmado: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.

## Convenção sobre os testes deste plano

Os testes aparecem com **código completo** (os de maior risco) ou **só por título** (`it('…', …)` sem corpo). Os de só título são **especificações**: o implementador escreve o corpo com asserções reais que provem exatamente o que o título afirma, no estilo dos testes completos vizinhos, e o revisor confere que cada título tem um teste que falharia se o comportamento fosse removido. Título sem asserção equivalente é achado do revisor.

## Decisões deste plano que detalham a spec (revisar)

1. **`tenant_id` nas rotas agregadas**: obrigatório (UUID) para técnico/parceiro/admin; para `empresa` ausente = o próprio, divergente = 400.
2. **Rotas novas**: `GET /epis/dashboard`, `GET /epis/settings`, `PATCH /epis/settings` (declaradas ANTES de `:id`), `GET /epi-signatures/pending` (antes de rotas com `:id`). Sem migration (os índices só serão criados se a medição de custo da Task 1 provar necessidade: migration `0084`, a confirmar).
3. **`/epis/search` e `/epis/movements` passam a aceitar `tenant_id`** (UUID, mesma regra do item 1) e `employee_id`/`tenant_epi_id` já existentes; `GET /epis/search` ganha também `employee_id` não (fora de escopo).
4. **Mensagens do backend → texto da tela**: o frontend mapeia por status e por trechos conhecidos das mensagens do subsistema 1/2/3 (tabela na Task 3); qualquer outra vira "Não foi possível concluir a operação. Tente novamente."
5. **Download de PDF** por `fetch` autenticado → Blob → `URL.createObjectURL` (aba nova para prévia/visualização; `download` para baixar); a URL do Blob é revogada após o uso.
6. **Técnico/parceiro**: a rota `/tecnico/empresas/[tenantId]/epi` renderiza as quatro *views* em abas; a página `app/tecnico/empresas/[tenantId]/page.tsx` troca o `EpisPanel` por um cartão-resumo (`EpiResumoCard`) com link.
7. **Contagem do menu**: de 24 para 27 itens (remove "EPIs"; adiciona 4 no setor EPI); atualizar `menu.test.ts`, `shell.test.tsx` e comentários.

## File Structure

- Backend create: `backend/src/epi/epi-dashboard.service.ts`, `backend/src/epi/dto/epi-dashboard-query.dto.ts`, `backend/src/epi/dto/epi-settings.dto.ts`, `backend/src/epi/tenant-scope.util.ts`; modify `backend/src/epi/epis.controller.ts`, `epi.module.ts`, `epi.service.ts` (legado + search/movements com tenant), `dto/search-epis-query.dto.ts`, `dto/list-epi-movements-query.dto.ts`, `backend/src/epi-signature/epi-signature.controller.ts`/`epi-signature.service.ts` (pendências).
- Backend tests: `backend/test/epi-dashboard.e2e-spec.ts`, `epi-settings.e2e-spec.ts`, `epi-signature-pending.e2e-spec.ts`, `epi-tenant-scope.e2e-spec.ts`, `epi-legacy-delivery-guard.e2e-spec.ts`.
- Frontend create: `frontend/src/lib/epi/{api.ts,errors.ts,format.ts,idempotency.ts,types.ts}`, `frontend/src/components/epi/{EpiDashboardView,EpiCadastroView,EpiMovimentacaoView,EpiFichasView,EpiResumoCard,SignatureLinkDialog,InPersonDialog,StockBadge,CaBadge,SignatureStatusBadge,ConfirmDialog,Pagination,EpiTabs}.tsx`, `frontend/src/app/empresa/epi/{page.tsx,cadastro/page.tsx,movimentacao/page.tsx,fichas/page.tsx}`, `frontend/src/app/tecnico/empresas/[tenantId]/epi/page.tsx`; modify `frontend/src/lib/dashboard/menu.ts`, `frontend/src/app/empresa/epis/page.tsx` (redirect), `frontend/src/app/tecnico/empresas/[tenantId]/page.tsx`; delete `frontend/src/components/EpisPanel.tsx`; modify `frontend/package.json` + lockfile.
- Frontend tests: `frontend/src/lib/epi/__tests__/*.test.ts`, `frontend/src/components/epi/__tests__/*.test.tsx`, `frontend/src/app/empresa/epi/__tests__/*.test.tsx`; update `lib/dashboard/__tests__/menu.test.ts`, `components/dashboard/__tests__/shell.test.tsx`, `app/empresa/__tests__/skin-paginas.test.tsx`.
- Docs: `docs/architecture/epi-telas.md`.

---

### Task 1: Backend — dashboard agregado, configuração de alertas e escopo de tenant

**Files:**
- Create: `backend/src/epi/tenant-scope.util.ts`, `backend/src/epi/epi-dashboard.service.ts`, `backend/src/epi/dto/epi-dashboard-query.dto.ts`, `backend/src/epi/dto/epi-settings.dto.ts`
- Modify: `backend/src/epi/epis.controller.ts`, `backend/src/epi/epi.module.ts`
- Test: `backend/test/epi-dashboard.e2e-spec.ts`, `backend/test/epi-settings.e2e-spec.ts`, `backend/test/epi-tenant-scope.e2e-spec.ts` (+ unit `backend/test/tenant-scope.unit-spec.ts`)

**Interfaces:**
- Produces: `resolveTenantScope(user: { role: string; tenantId: string | null }, requested?: string): string` (lança `BadRequestException`); `EpiDashboardService.getDashboard(client, tenantId, q): Promise<EpiDashboard>`; `GET /epis/dashboard`, `GET /epis/settings`, `PATCH /epis/settings`.

- [ ] **Step 1: Subir o ensaio e confirmar o baseline** — `ensaio-down.sh; ensaio-up.sh; ensaio-migrate.sh` (Expected `[ok] 0083_epi_signatures.sql`); `run-be-rl.sh e2e "epi-search-update epi-stock-movements epis-crud" <log>` PASS.

- [ ] **Step 2: Util de escopo (unit RED → GREEN)**

`backend/test/tenant-scope.unit-spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { resolveTenantScope } from '../src/epi/tenant-scope.util';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

describe('resolveTenantScope', () => {
  it('empresa sem tenant_id usa o próprio', () => {
    expect(resolveTenantScope({ role: 'empresa', tenantId: T1 })).toBe(T1);
  });
  it('empresa com o próprio tenant_id é aceita; com outro -> 400', () => {
    expect(resolveTenantScope({ role: 'empresa', tenantId: T1 }, T1)).toBe(T1);
    expect(() => resolveTenantScope({ role: 'empresa', tenantId: T1 }, T2)).toThrow(BadRequestException);
  });
  it('tecnico, parceiro e admin exigem tenant_id', () => {
    for (const role of ['tecnico', 'parceiro', 'admin']) {
      expect(resolveTenantScope({ role, tenantId: null }, T2)).toBe(T2);
      expect(() => resolveTenantScope({ role, tenantId: null })).toThrow(BadRequestException);
    }
  });
  it('papel desconhecido -> 400', () => {
    expect(() => resolveTenantScope({ role: 'x', tenantId: T1 }, T1)).toThrow(BadRequestException);
  });
});
```

`backend/src/epi/tenant-scope.util.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

// Define em qual empresa uma rota agregada opera. Técnico/parceiro/admin enxergam várias empresas pela RLS:
// sem tenant_id explícito os números somariam empresas diferentes, então o parâmetro é obrigatório para eles.
export function resolveTenantScope(user: { role: string; tenantId: string | null }, requested?: string): string {
  if (user.role === 'empresa') {
    if (!user.tenantId) throw new BadRequestException('Empresa não identificada');
    if (requested && requested !== user.tenantId) throw new BadRequestException('tenant_id inválido');
    return user.tenantId;
  }
  if (user.role === 'tecnico' || user.role === 'parceiro' || user.role === 'admin') {
    if (!requested) throw new BadRequestException('tenant_id é obrigatório');
    return requested;
  }
  throw new BadRequestException('Perfil sem acesso');
}
```

- [ ] **Step 3: Teste e2e do dashboard (RED)**

`backend/test/epi-dashboard.e2e-spec.ts` — fixtures dos e2e do subsistema 1 (`configureApp(app)`, empresa A e B, técnico/parceiro vinculados e não vinculado, admin, `mov()`/`key()`, `sql` superusuário). Montar na empresa A: EPI1 (min 10, max 50, unit_cost 5.00; abertura 4 → "abaixo"), EPI2 (abertura 0 → "sem estoque"), EPI3 (abertura 20, `ca_valid_until` ontem → CA vencido), EPI4 (abertura 30, CA em +10 dias → a vencer com `epi_alert_days` 30), EPI5 com `controls_lot` e dois lotes (um vencido com saldo 3 e um a vencer com saldo 2), uma entrega `pendente` ao funcionário F1 e uma já `assinada`. Casos:

```ts
it('KPIs batem com as fixtures (estoque, valor, faixas, CA e lotes)', async () => {
  const r = await request(srv).get('/epis/dashboard').set(auth());
  expect(r.status).toBe(200);
  expect(r.body.kpis).toMatchObject({
    epis_total: 5, zero_stock: 1, low_stock: 1, ca_expired: 1, ca_expiring: 1, lots_expired: 1, lots_expiring: 1, pending_signatures: 1,
  });
  expect(r.body.kpis.stock_total).toBe(4 + 0 + 20 + 30 + 5 /* saldo EPI5 = 5 */ - 1 /* entrega pendente baixou 1 */);
  expect(r.body.kpis.stock_value).toBeCloseTo(/* soma saldo*unit_cost dos EPIs com custo */ 0, 2); // calcule da fixture e afirme o valor exato
  expect(r.body.alert_days).toBe(30);
});
it('alerts lista só EPIs em situação crítica, ordenados por gravidade, no máximo 10', async () => {});
it('recent_movements respeita o período (from/to), epi_id e employee_id e traz só nome do funcionário (sem CPF)', async () => {
  const r = await request(srv).get(`/epis/dashboard?from=2020-01-01&to=2099-12-31&employee_id=${f1}`).set(auth());
  expect(JSON.stringify(r.body)).not.toMatch(/(?<![0-9A-Za-z])\d{11}(?![0-9A-Za-z])/);
  expect(r.body.recent_movements.every((m: any) => m.employee_name === 'Funcionário F1')).toBe(true);
});
it('pending traz as entregas aguardando assinatura mais antigas primeiro, no máximo 10', async () => {});
it('período padrão de 30 dias quando from/to ausentes', async () => {});
it('empresa B vê só os próprios números (isolamento)', async () => {});
it('técnico/parceiro vinculados exigem tenant_id (400 sem ele; 200 com); não vinculados -> dados vazios/404 sem vazar; admin com tenant_id 200', async () => {});
it('empresa com tenant_id de outra empresa -> 400', async () => {});
it('entrada inválida -> 400: from/to fora de DATE_ONLY, 2026-02-30, from > to, epi_id/employee_id/tenant_id não UUID, parâmetro desconhecido ou repetido, intervalo > 366 dias', async () => {});
it('dias de aviso diferentes mudam ca_expiring/lots_expiring (PATCH settings epi_alert_days=5 -> 0 a vencer)', async () => {});
```
Run → FAIL (rota inexistente).

- [ ] **Step 4: DTOs**

```ts
// dto/epi-dashboard-query.dto.ts
import { IsISO8601, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { DATE_ONLY } from './epi-dto-rules';

export class EpiDashboardQueryDto {
  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) to?: string;
  @IsOptional() @IsUUID() epi_id?: string;
  @IsOptional() @IsUUID() employee_id?: string;
  @IsOptional() @IsUUID() tenant_id?: string;
}
// dto/epi-settings.dto.ts
import { IsInt, Max, Min } from 'class-validator';
export class UpdateEpiSettingsDto { @IsInt() @Min(1) @Max(365) epi_alert_days: number; }
```
Query de `GET /epis/settings`: apenas `tenant_id` (UUID opcional); `PATCH /epis/settings?tenant_id=` idem (admin exige).

- [ ] **Step 5: Serviço do dashboard**

`epi-dashboard.service.ts` (consultas parametrizadas; todas sob o `client` do `withTenantContext`; datas em `America/Sao_Paulo` como em `epi.service.ts` — reutilize a constante `TODAY_SP` já existente nele, exportando-a se necessário):

```ts
export interface EpiDashboard {
  alert_days: number;
  period: { from: string; to: string };
  kpis: { epis_total: number; stock_total: number; stock_value: string; low_stock: number; zero_stock: number;
          ca_expired: number; ca_expiring: number; lots_expired: number; lots_expiring: number; pending_signatures: number };
  alerts: Array<{ epi_id: string; description: string; ca_number: string; stock_balance: number; min_stock: number | null;
                  stock_band: string; ca_alert: string; ca_valid_until: string | null; lots_expired: number; lots_expiring: number }>;
  recent_movements: Array<{ id: string; type: string; quantity: number; occurred_at: string; epi_id: string; epi_description: string;
                            employee_name: string | null; reason: string | null; reversed: boolean }>;
  pending: Array<{ delivery_id: string; delivered_at: string; employee_id: string; employee_name: string; epi_id: string;
                   epi_description: string; quantity: number | null; signature_status: string; active_request_expires_at: string | null }>;
}

@Injectable()
export class EpiDashboardService {
  async getDashboard(client: PoolClient, tenantId: string, q: { from?: string; to?: string; epiId?: string; employeeId?: string }): Promise<EpiDashboard> {
    const { from, to } = resolvePeriod(q.from, q.to); // padrão: últimos 30 dias (SP); to >= from; no máximo 366 dias -> BadRequest
    const t = await client.query('SELECT COALESCE(epi_alert_days, 30) AS d FROM tenants WHERE id = $1', [tenantId]);
    if (!t.rows[0]) throw new NotFoundException('Empresa não encontrada');
    const days = t.rows[0].d as number;

    const base = `FROM tenant_epis te JOIN epi_catalog_items eci ON eci.id = te.epi_catalog_item_id
                  WHERE te.tenant_id = $1 AND ($2::uuid IS NULL OR te.id = $2)`;
    const kpi = await client.query(`
      SELECT count(*) FILTER (WHERE te.status = 'ativo')::int AS epis_total,
             COALESCE(sum(te.stock_balance) FILTER (WHERE te.status = 'ativo'), 0)::int AS stock_total,
             COALESCE(sum(te.stock_balance * COALESCE(te.unit_cost, 0)) FILTER (WHERE te.status = 'ativo'), 0)::numeric(14,2) AS stock_value,
             count(*) FILTER (WHERE te.status = 'ativo' AND te.stock_balance = 0)::int AS zero_stock,
             count(*) FILTER (WHERE te.status = 'ativo' AND te.stock_balance > 0 AND te.min_stock IS NOT NULL AND te.stock_balance < te.min_stock)::int AS low_stock,
             count(*) FILTER (WHERE te.status = 'ativo' AND te.ca_valid_until < ${TODAY_SP})::int AS ca_expired,
             count(*) FILTER (WHERE te.status = 'ativo' AND te.ca_valid_until >= ${TODAY_SP} AND te.ca_valid_until <= ${TODAY_SP} + $3::int)::int AS ca_expiring
      ${base}`, [tenantId, q.epiId ?? null, days]);
    // lotes (saldo > 0), pendências, alertas, movimentações: consultas análogas — ver spec; cada uma com LIMIT 10 e parâmetros $n.
    …
  }
}
```
Completar as quatro consultas restantes: **lots** (`epi_lots l JOIN tenant_epis te … WHERE te.tenant_id=$1 AND l.balance>0 AND l.valid_until < hoje / entre hoje e hoje+dias`, contando lotes de EPIs ativos); **pending_signatures** e `pending` (`employee_epi_deliveries d JOIN employees e JOIN tenant_epis te JOIN epi_catalog_items eci LEFT JOIN LATERAL (SELECT r.expires_at FROM epi_signature_request_items i JOIN epi_signature_requests r ON r.id = i.request_id WHERE i.delivery_id = d.id AND r.status = 'ativa' ORDER BY r.created_at DESC LIMIT 1)`; filtro `d.signature_status = 'pendente'`, `ORDER BY d.delivered_at, d.id LIMIT 10`; só `e.full_name`); **alerts** (EPIs ativos com faixa `sem_estoque`/`abaixo` ou CA `vencido`/`a_vencer` ou lote vencido/a vencer; ordenar por gravidade: sem estoque/CA vencido primeiro; `LIMIT 10`; reutilizar as expressões CASE de `EpiService.search`); **recent_movements** (`epi_movements m JOIN tenant_epis te JOIN epi_catalog_items eci LEFT JOIN employees e`, período em dia de São Paulo, filtros `epi_id`/`employee_id`, `ORDER BY m.occurred_at DESC, m.created_at DESC LIMIT 10`, `reversed` por `EXISTS(estorno)`; só nome do funcionário). `resolvePeriod` exporta-se para teste unitário (padrão 30 dias; `to < from` → 400; > 366 dias → 400).

- [ ] **Step 6: Rotas e módulo**

No `EpisController` (declarar `dashboard` e `settings` **antes** de `:id`):

```ts
@Roles('empresa', 'tecnico', 'parceiro', 'admin')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
@Get('dashboard')
dashboard(@Query() q: EpiDashboardQueryDto, @Req() req: any) {
  const tenantId = resolveTenantScope(req.user, q.tenant_id);
  return req.withTenantContext((client: any) =>
    this.dashboard.getDashboard(client, tenantId, { from: q.from, to: q.to, epiId: q.epi_id, employeeId: q.employee_id }));
}

@Roles('empresa', 'tecnico', 'parceiro', 'admin')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
@Get('settings')
getSettings(@Query() q: TenantOnlyQueryDto, @Req() req: any) {
  const tenantId = resolveTenantScope(req.user, q.tenant_id);
  return req.withTenantContext(async (client: any) => {
    const r = await client.query('SELECT COALESCE(epi_alert_days, 30) AS epi_alert_days FROM tenants WHERE id = $1', [tenantId]);
    if (!r.rows[0]) throw new NotFoundException('Empresa não encontrada');
    return r.rows[0];
  });
}

@Roles('empresa', 'admin')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
@Patch('settings')
async updateSettings(@Query() q: TenantOnlyQueryDto, @Body() dto: UpdateEpiSettingsDto, @Req() req: any) {
  const tenantId = resolveTenantScope(req.user, q.tenant_id);
  return req.withTenantContext(async (client: any) => {
    const r = await client.query('UPDATE tenants SET epi_alert_days = $2 WHERE id = $1 RETURNING epi_alert_days', [tenantId, dto.epi_alert_days]);
    if (!r.rows[0]) throw new NotFoundException('Empresa não encontrada');
    return r.rows[0];
  });
}
```
`TenantOnlyQueryDto` = `{ @IsOptional() @IsUUID() tenant_id?: string }`. Registrar `EpiDashboardService` em `epi.module.ts`. Auditoria: o `AuditInterceptor` global audita o PATCH. Técnico/parceiro não alteram (`@Roles('empresa','admin')`).

- [ ] **Step 7: Testes de configuração e de escopo (e2e)**

`epi-settings.e2e-spec.ts`: GET devolve 30 por padrão; PATCH 10 -> 200 e persiste; 0, 366, '5', 5.5, ausente, campo extra -> 400; técnico/parceiro PATCH -> 403; empresa B não altera a A (o PATCH age só no próprio tenant; com `tenant_id` de outra -> 400); admin com tenant_id -> 200 e sem -> 400; auditoria registra a rota. `epi-tenant-scope.e2e-spec.ts`: ver Task 2 (escopo em search/movements).

- [ ] **Step 8: Medir o custo e decidir índices** — semear num ensaio descartável 5.000 EPIs e 200.000 movimentações por SQL (`generate_series`) para uma empresa e medir `GET /epis/dashboard` (tempo de resposta e `EXPLAIN (ANALYZE, BUFFERS)` das consultas): registrar números; criar a migration `0084_epi_dashboard_indexes.sql` **somente** se algum bloco passar de ~300 ms (índices candidatos: `epi_movements (tenant_id, occurred_at DESC)` já existe; `employee_epi_deliveries (tenant_id, signature_status, delivered_at)`; `epi_lots (tenant_epi_id) WHERE balance > 0`), com rollback testado. Sem prova, sem índice.

- [ ] **Step 9: Rodar** — unit `tenant-scope epi-by-function tenant-context-callsites`; e2e `epi-dashboard epi-settings epi-search-update epi-stock-movements epi-stock-permissions epis-crud epi-ledger-schema`; `tsc --noEmit`; `nest build`. Expected: PASS.

- [ ] **Step 10: Entrega** (listar arquivos; não comitar).

---

### Task 2: Backend — pendências de assinatura, `tenant_id` nas listagens e rota legada endurecida

**Files:**
- Modify: `backend/src/epi-signature/epi-signature.controller.ts`, `epi-signature.service.ts`, `backend/src/epi/epis.controller.ts`, `epi.service.ts`, `dto/search-epis-query.dto.ts`, `dto/list-epi-movements-query.dto.ts`
- Test: `backend/test/epi-signature-pending.e2e-spec.ts`, `backend/test/epi-tenant-scope.e2e-spec.ts`, `backend/test/epi-legacy-delivery-guard.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /epi-signatures/pending`; `tenant_id` opcional em `GET /epis/search` e `GET /epis/movements` (regra de `resolveTenantScope`, mas **opcional** para não-empresa quando a RLS já limita? — **decisão**: nestas duas listagens `tenant_id` é opcional para todos os papéis e, quando presente, filtra `te.tenant_id`/`m.tenant_id`; para `empresa` divergente -> 400); rota legada endurecida.

- [ ] **Step 1: Testes (RED)**

`epi-signature-pending.e2e-spec.ts` (fixtures de assinatura: `configureApp`, `EPI_SIGNATURE_ALLOW_DRAFT_TERM='true'`, fakeR2):

```ts
it('lista entregas pendentes/recusadas com funcionário, EPI e o link ativo (sem token, código nem hash)', async () => {
  const link = await create(emp, { idempotency_key: key() }); // cria requisição ativa para as entregas pendentes
  const r = await request(srv).get('/epi-signatures/pending').set(auth());
  expect(r.status).toBe(200);
  expect(r.body.items[0]).toMatchObject({ employee_name: expect.any(String), epi_description: expect.any(String), signature_status: 'pendente', active_request_status: 'ativa' });
  const txt = JSON.stringify(r.body);
  expect(txt).not.toMatch(/token|pin_hash|token_hash|code/i);
  expect(txt).not.toContain(link.body.url.split('token=')[1]);
});
it('filtra por employee_id e pagina; entregas assinadas/presenciais/estornadas/legado não aparecem', async () => {});
it('isolamento: empresa B não vê; técnico vinculado precisa de tenant_id; não vinculado 404/vazio sem vazar', async () => {});
it('entrada inválida -> 400', async () => {});
```
`epi-legacy-delivery-guard.e2e-spec.ts`:

```ts
it('EPI inativo -> 409', async () => {});
it('CA vencido -> 409 com a mesma mensagem do fluxo novo', async () => {});
it('EPI que já tem movimentação no livro -> 409 orientando a usar a movimentação', async () => {
  await mov(epiId, { type: 'abertura', quantity: 5, idempotency_key: key() });
  const r = await request(srv).post(`/epis/${epiId}/deliveries`).set(auth()).send({ employee_id: emp, delivered_at: '2026-10-18', signed_by_name: 'Responsável' });
  expect(r.status).toBe(409);
  expect(r.body.message).toMatch(/movimenta/i);
});
it('EPI sem livro, ativo e com CA válido continua funcionando como antes (regressão do contrato legado)', async () => {});
```
`epi-tenant-scope.e2e-spec.ts`: search/movements com `tenant_id` da própria empresa -> 200; de outra -> 400 (empresa); técnico vinculado filtra uma empresa; admin idem; UUID inválido -> 400; sem o parâmetro o comportamento anterior (RLS) é mantido.

- [ ] **Step 2: Implementar** — (a) `GET /epi-signatures/pending` no `EpiSignatureController` (declarar antes de `requests/:id/...` e de qualquer `:id`), `@Roles` do módulo, `tenant_id` por `resolveTenantScope`, consulta (`employee_epi_deliveries d JOIN employees e JOIN tenant_epis te JOIN epi_catalog_items eci LEFT JOIN LATERAL (último link ativo)` com `d.signature_status IN ('pendente','recusada') AND d.quantity IS NOT NULL`, `page`/`page_size` ≤ 100, `employee_id` opcional, **colunas explícitas** — nunca `SELECT *` — sem token/hash); (b) `tenant_id` opcional em `SearchEpisQueryDto` e `ListEpiMovementsQueryDto` (`@IsOptional() @IsUUID()`), aplicado no `WHERE` com `resolveTenantScope` apenas para validar `empresa`; (c) `EpiService.createDelivery`: antes do INSERT, ler o EPI (já lido via `findOne`) e lançar `ConflictException` para `status <> 'ativo'`, `ca_valid_until < hoje (SP)` ("CA vencido: não é possível entregar este EPI") e para existência de `epi_movements` do EPI ("Este EPI usa o registro de movimentação de estoque; registre a entrega em Movimentação."). Mantenha as demais mensagens.

- [ ] **Step 3: Rodar** — e2e `epi-signature-pending epi-tenant-scope epi-legacy-delivery-guard epi-deliveries epis-crud epi-signature-create epi-search-update epi-stock-movements`; `tsc --noEmit`; `nest build`. Expected: PASS (o teste `epi-deliveries` existente continua verde).

- [ ] **Step 4: Entrega** (listar arquivos; não comitar).

---

### Task 3: Frontend — fundação (`lib/epi`, menu, `qrcode`, redirecionamento, remoção do painel antigo)

**Files:**
- Create: `frontend/src/lib/epi/{types.ts,api.ts,errors.ts,format.ts,idempotency.ts}`, componentes base `StockBadge.tsx`, `CaBadge.tsx`, `SignatureStatusBadge.tsx`, `ConfirmDialog.tsx`, `Pagination.tsx`, `EpiTabs.tsx` em `frontend/src/components/epi/`
- Modify: `frontend/src/lib/dashboard/menu.ts`, `frontend/src/app/empresa/epis/page.tsx` (redirect), `frontend/src/app/empresa/__tests__/skin-paginas.test.tsx`, `lib/dashboard/__tests__/menu.test.ts`, `components/dashboard/__tests__/shell.test.tsx`, `frontend/package.json` + lockfile
- Delete: `frontend/src/components/EpisPanel.tsx` (somente na Task 6, depois que a página do técnico deixar de importá-lo)
- Test: `frontend/src/lib/epi/__tests__/{errors,api,format,idempotency}.test.ts(x)`, testes dos componentes base

**Interfaces:**
- Produces: `epiApi` (funções tipadas abaixo), `mapEpiError(err: unknown): string`, `downloadBlob(path, opts)`, `newIdempotencyKey(): string`, `formatDate`, `formatDateTime`, `formatMoney`, `formatQty`; componentes base.

- [ ] **Step 1: Ambiente de testes do frontend e baseline** — criar (se não existir) o cache `nmf/` no scratchpad (`npm ci` do `frontend/package-lock.json` em container descartável com rede só para o npm) e `run-fe.sh`. **Registrar o BASELINE antes de qualquer mudança**: `vitest run` completo (452 testes no fim do subsistema 3), `tsc --noEmit`, `npm run lint` (14 problemas pré-existentes: 11 erros em `esocial/*` e 3 avisos) e `next build`.

- [ ] **Step 2: Dependência `qrcode` (versão fixa)** — num container descartável com CÓPIA do frontend (não escrever `node_modules` no worktree): `npm install --save-exact qrcode@1.5.4 && npm install --save-dev --save-exact @types/qrcode@1.5.5`; copiar de volta **somente** `package.json` e `package-lock.json` para `/opt/montese-epi/frontend/`; rodar `npm audit --omit=dev` e registrar o resultado literal (vulnerabilidades novas introduzidas pela `qrcode` bloqueiam: reportar); confirmar que `vitest` ainda roda. Nada de commit.

- [ ] **Step 3: Tipos e erros (unit RED → GREEN)**

`lib/epi/errors.ts` — tabela fechada de mensagens (testar cada linha):

```ts
export class EpiApiError extends Error {
  constructor(public status: number, public serverMessage: string, public attemptsLeft?: number) { super(serverMessage); }
}
const RULES: Array<[RegExp, string]> = [
  [/Estoque insuficiente/i, 'Estoque insuficiente para esta operação.'],
  [/CA vencido/i, 'O CA deste EPI está vencido: não é possível entregá-lo.'],
  [/Lote vencido/i, 'O lote selecionado está vencido.'],
  [/Devolução maior que a quantidade entregue/i, 'A devolução é maior que a quantidade entregue a este funcionário.'],
  [/Estorne antes as devoluções/i, 'Estorne antes as devoluções deste funcionário neste EPI.'],
  [/já estornada/i, 'Esta movimentação já foi estornada.'],
  [/Saldo máximo excedido/i, 'O saldo máximo permitido seria excedido.'],
  [/Chave de idempotência/i, 'Esta operação já foi registrada. Atualize a tela e confira o histórico.'],
  [/EPI inativo/i, 'Este EPI está inativo.'],
  [/movimenta[çc][ãa]o de estoque/i, 'Este EPI usa o registro de movimentação: registre a entrega em Movimentação.'],
  [/termo .* aprovado/i, 'O termo de recebimento ainda não foi aprovado. A assinatura eletrônica fica indisponível até a aprovação.'],
  [/Já existe movimenta/i, 'Este EPI já tem movimentação: use Entrada ou Ajuste.'],
  [/Já existe uma emissão em andamento/i, 'Já existe uma emissão em andamento para este funcionário. Tente de novo em instantes.'],
];
export function mapEpiError(err: unknown): string {
  if (!(err instanceof EpiApiError)) return 'Não foi possível conectar ao servidor. Verifique a conexão e tente de novo.';
  if (err.status === 401) return 'Sua sessão expirou. Entre novamente.';
  if (err.status === 403) return 'Você não tem permissão para esta ação.';
  if (err.status === 404) return 'Registro não encontrado.';
  if (err.status === 429) return 'Muitas tentativas. Aguarde alguns minutos.';
  if (err.status === 502 || err.status === 503) return 'O serviço está indisponível agora. Tente novamente em instantes.';
  for (const [re, msg] of RULES) if (re.test(err.serverMessage)) return msg;
  if (err.status === 400) return 'Verifique os dados informados e tente de novo.';
  if (err.status === 409) return 'A operação conflita com o estado atual. Atualize a tela e tente de novo.';
  return 'Não foi possível concluir a operação. Tente novamente.';
}
```
Teste unitário: cada regra, 401/403/404/429/502/503, 400 genérico, 409 genérico, erro de rede (não `EpiApiError`), e que **nenhum texto cru do servidor** (ex.: 'SELECT secreto') aparece na saída.

`lib/epi/idempotency.ts`: `newIdempotencyKey = () => (globalThis.crypto?.randomUUID?.() ?? fallbackUuid())` (≥ 8 caracteres, sem NUL); teste: formato e unicidade.
`lib/epi/format.ts`: `formatDate('2026-10-18')`→`18/10/2026` (sem fuso), `formatDateTime(iso)` em `America/Sao_Paulo`, `formatMoney('12.5')`→`R$ 12,50`, `formatQty`; testes com datas de borda (virada de dia em UTC vs SP).
`lib/epi/types.ts`: interfaces espelhando as respostas reais do backend (`EpiRow` de `/epis/search`, `Dashboard`, `Movement`, `PendingDelivery`, `Ficha`, `FichaDocument`, `SignatureRequest`, `CreateRequestResult` etc.) — leia os controllers/serviços para copiar os campos exatos.

- [ ] **Step 4: Cliente da API (unit RED → GREEN)**

`lib/epi/api.ts` — um único `request<T>()`:

```ts
import { getToken } from '@/lib/auth';
import { EpiApiError } from './errors';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    cache: 'no-store',
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new EpiApiError(res.status, typeof data?.message === 'string' ? data.message : '', typeof data?.attempts_left === 'number' ? data.attempts_left : undefined);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const epiApi = {
  dashboard: (q: { tenantId?: string; from?: string; to?: string; epiId?: string; employeeId?: string }) =>
    request<Dashboard>(`/epis/dashboard${qs({ tenant_id: q.tenantId, from: q.from, to: q.to, epi_id: q.epiId, employee_id: q.employeeId })}`),
  getSettings: (tenantId?: string) => request<{ epi_alert_days: number }>(`/epis/settings${qs({ tenant_id: tenantId })}`),
  updateSettings: (days: number, tenantId?: string) => request<{ epi_alert_days: number }>(`/epis/settings${qs({ tenant_id: tenantId })}`, { method: 'PATCH', body: JSON.stringify({ epi_alert_days: days }) }),
  searchEpis: (q: SearchQuery) => request<Page<EpiRow>>(`/epis/search${qs({ /* campos snake_case */ })}`),
  // createEpi, updateEpi, lots, catalog, caepiSearch, movements, registerMovement, adjust, reverse, employees,
  // fichaGet, fichaIssue, fichaDocuments, fichaVerify, createSignatureRequest, listSignatureRequests, revokeSignatureRequest, inPerson, pending
  // — cada uma é uma linha no mesmo padrão, com os caminhos REAIS do backend (leia os controllers).
};

// Download/visualização autenticada: Blob -> URL temporária (revogada logo depois). Nunca URL pública.
export async function fetchBlob(path: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`/api${path}`, { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new EpiApiError(res.status, typeof d?.message === 'string' ? d.message : ''); }
  return res.blob();
}
export async function openOrDownload(path: string, opts: { filename?: string; mode: 'open' | 'download' }): Promise<void> {
  const blob = await fetchBlob(path);
  const url = URL.createObjectURL(blob);
  try {
    if (opts.mode === 'open') window.open(url, '_blank', 'noopener');
    else { const a = document.createElement('a'); a.href = url; a.download = opts.filename ?? 'documento.pdf'; document.body.appendChild(a); a.click(); a.remove(); }
  } finally { setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}
```
Testes (fetch mockado): cabeçalho `Authorization`; query string só com campos definidos (sem `undefined`/vazios); 401/403/404/409 viram `EpiApiError` com status e mensagem; corpo não JSON não derruba; `openOrDownload` revoga a URL, `noopener`; nenhuma função grava em storage.

- [ ] **Step 5: Menu (unit RED → GREEN)**

`menu.ts`: remover `{ href: '/empresa/epis', label: 'EPIs', … }` do setor "Segurança" e acrescentar, após o setor "Segurança", o setor:

```ts
  { titulo: 'EPI', itens: [
    { href: '/empresa/epi', label: 'Painel de EPI', icon: LayoutDashboard, implemented: true },
    { href: '/empresa/epi/cadastro', label: 'Cadastro de EPI', icon: ShieldCheck, implemented: true },
    { href: '/empresa/epi/movimentacao', label: 'Movimentação de EPI', icon: ArrowLeftRight, implemented: true },
    { href: '/empresa/epi/fichas', label: 'Fichas de controle', icon: ClipboardList, implemented: true },
  ]},
```
(importar `ArrowLeftRight`, `ClipboardList` de `lucide-react` — confirmar que existem na versão instalada). Atualizar `menu.test.ts` (lista literal de hrefs: 27 itens; ordem; "Consulta de CA" continua em Segurança; `itemAtivo('/empresa/epi/cadastro/x')` → `/empresa/epi/cadastro` e `'/empresa/epi'` não casa `/empresa/epis`) e `shell.test.tsx` (27 links) e comentários. `app/empresa/epis/page.tsx` vira redirect (`redirect('/empresa/epi')` ou `useRouter().replace` conforme o padrão do projeto); teste. Ajustar `skin-paginas.test.tsx` (remove `Epis`/`EpisPanel`; a nova página de painel entra no Task 4).

- [ ] **Step 6: Componentes base (RED → GREEN)**

`StockBadge` (faixa → tom/texto: `sem_estoque`→crit "Sem estoque", `abaixo`→warn "Abaixo do mínimo", `otimo`→ok "Estoque ok", `acima`→info "Acima do máximo"), `CaBadge` (`vencido`→crit, `a_vencer`→warn, `ok`→ok, `sem_validade`→info), `SignatureStatusBadge` (pendente→warn, assinada→ok, recusada→crit, expirada→crit, presencial→info "Presencial", legado→info "Anterior ao módulo", estornada→crit), `ConfirmDialog` (`role="dialog"`, `aria-modal`, foco no primeiro botão, Esc fecha, devolve o foco ao acionador, botão destrutivo com texto explícito), `Pagination` (página atual, total, anterior/próxima, `aria-label`), `EpiTabs` (tablist acessível com setas). Cada um com teste (texto, tom, teclado, foco).

- [ ] **Step 7: Rodar** — `run-fe.sh`: `vitest run` completo (regressão: nenhum teste anterior quebra além dos de menu/shell/skin-paginas atualizados), `tsc --noEmit`, `npm run lint` (sem aviso novo vs baseline), `next build`. Expected: OK.

- [ ] **Step 8: Entrega** (listar arquivos, inclusive `package.json`/lockfile; não comitar).

---

### Task 4: Frontend — Painel e Cadastro

**Files:**
- Create: `frontend/src/components/epi/{EpiDashboardView,EpiCadastroView}.tsx`, `frontend/src/app/empresa/epi/page.tsx`, `frontend/src/app/empresa/epi/cadastro/page.tsx`
- Test: `frontend/src/components/epi/__tests__/{EpiDashboardView,EpiCadastroView}.test.tsx`, `frontend/src/app/empresa/epi/__tests__/paginas.test.tsx`

**Interfaces:**
- Consumes: `epiApi`, `mapEpiError`, componentes base (Task 3).
- Produces: `EpiDashboardView({ tenantId?: string })`, `EpiCadastroView({ tenantId?: string })`; páginas finas que montam as views dentro de `PageHeader` + `DashSkin` como em `app/empresa/epis/page.tsx` (guarda de token no `useEffect`).

- [ ] **Step 1: Testes do painel (RED)** (Vitest, `fetch` mockado por `vi.stubGlobal`):

```tsx
it('mostra os 6 indicadores com os números do servidor e os dias de aviso', async () => {});
it('estados: carregando (skeleton), erro com "Tentar novamente", vazio (nenhum EPI) com chamada para cadastrar', async () => {});
it('período padrão 30 dias; mudar o período e o equipamento/funcionário refaz a consulta com os parâmetros certos', async () => {});
it('alertas e pendências listados; cada pendência tem a ação "Gerar link" que abre o diálogo de assinatura (Task 5) — aqui só chama o callback onGerarLink(deliveryId)', async () => {});
it('ajuste dos dias de aviso: só empresa vê o controle; valor 1..365; salvar chama PATCH e atualiza os alertas; erro mostra mensagem de lista fechada; técnico NÃO vê o controle', async () => {});
it('atalhos: registrar entrega, abrir ficha e consultar estoque apontam para as rotas certas (empresa) ou para as abas (técnico)', async () => {});
it('nenhum CPF e nenhum storage', async () => {});
```
- [ ] **Step 2: Implementar `EpiDashboardView`** — `useEffect` com geração (descartar respostas atrasadas, como na página de assinatura); `KpiCard`s (EPIs cadastrados, Estoque disponível, Estoque baixo/zerado, CA e lotes vencidos/a vencer, Aguardando assinatura, Valor em estoque); `Card` de alertas (badges `StockBadge`/`CaBadge`), movimentações recentes (tipo em português: Entrada, Entrega, Devolução, Troca, Baixa, Ajuste, Estorno, Abertura; `reversed` marcado), entregas aguardando assinatura; filtros (período `from/to` com padrão dos últimos 30 dias em data de São Paulo, equipamento, funcionário — listas vindas de `searchEpis`/`employees`); controle dos dias de aviso apenas se `getUser()?.role === 'empresa'` (ou prop `canEditSettings`). Textos em português claro; responsivo (grade de 1/2/3 colunas); `AsyncBody` para estados.
- [ ] **Step 3: Testes do cadastro (RED)**:

```tsx
it('lista com busca, filtros (situação, categoria, faixa de estoque, alerta de CA) e paginação refazendo a consulta com os parâmetros certos', async () => {});
it('cada linha mostra descrição, CA, fabricante/modelo, saldo, StockBadge e CaBadge; custo e valor formatados em reais', async () => {});
it('criar EPI: escolher item do catálogo, informar CA (e consulta ao CAEPI opcional), validade, fabricante, modelo, mín/máx, custo, controla lote; erros 409 de duplicidade e 400 viram mensagem de lista fechada; sucesso recarrega a lista', async () => {});
it('editar (PATCH) e inativar com confirmação; controls_lot não editável quando já há movimentação (mensagem do 409)', async () => {});
it('ver lotes de um EPI com validade e saldo', async () => {});
it('abertura de estoque e ajuste só aparecem para empresa; técnico não os vê', async () => {});
it('estados vazio/erro/carregando; formulário acessível (rótulos, foco no erro, Enter envia, botão desabilitado durante o envio — duplo clique envia uma vez)', async () => {});
```
- [ ] **Step 4: Implementar `EpiCadastroView`** (+ formulário em diálogo/`<dialog>` acessível; usa `ConfirmDialog` para inativar; `Pagination`).
- [ ] **Step 5: Páginas** `app/empresa/epi/page.tsx` e `cadastro/page.tsx`: padrão de `app/empresa/epis/page.tsx` (guarda de token, `PageHeader`, `DashSkin`, `Card`); teste de página (título e miolo dentro de `.skin-dash`, como `skin-paginas.test.tsx`).
- [ ] **Step 6: Rodar** — `run-fe.sh`: vitest (arquivos novos + suíte inteira), `tsc`, `lint`, `next build`; **verificação visual** (screenshots mobile 390×844 e desktop com API falsa local, ferramental da memória `project_visual_qa_tooling`; inspecionar com `Read`).
- [ ] **Step 7: Entrega** (listar arquivos; não comitar).

---

### Task 5: Frontend — Movimentação e assinatura do lado do responsável

**Files:**
- Create: `frontend/src/components/epi/{EpiMovimentacaoView,SignatureLinkDialog,InPersonDialog}.tsx`, `frontend/src/app/empresa/epi/movimentacao/page.tsx`
- Test: `frontend/src/components/epi/__tests__/{EpiMovimentacaoView,SignatureLinkDialog,InPersonDialog}.test.tsx`

**Interfaces:**
- Produces: `SignatureLinkDialog({ open, tenantId?, employeeId, deliveryIds?, onClose })`, `InPersonDialog({ open, deliveryIds, onClose, onDone })`; `EpiMovimentacaoView({ tenantId?, initialFilters? })`.

- [ ] **Step 1: Testes do `SignatureLinkDialog` (RED) — o de maior risco**:

```tsx
it('cria o link (POST com idempotency_key nova), mostra QR, link e o código de 6 dígitos UMA vez com aviso explícito de que não pode ser recuperado', async () => {});
it('o QR codifica exatamente o link devolvido (qrcode.toDataURL/toCanvas chamado com a URL) e é gerado no navegador (nenhuma requisição a terceiros)', async () => {});
it('copiar link e copiar código usam navigator.clipboard; sem clipboard mostra o texto selecionável', async () => {});
it('ao fechar ou ao desmontar, link e código somem do estado e do DOM; reabrir NÃO mostra o código antigo', async () => {});
it('nunca grava link/código em localStorage/sessionStorage/cookie/console (espiar)', async () => {});
it('409 por termo não aprovado mostra a mensagem explicativa (assinatura indisponível até a aprovação do termo) e nenhum link', async () => {});
it('409 de chave de idempotência/entregas sem pendência/404 de entrega -> mensagens de lista fechada; 503 de emissão em andamento -> orientação para tentar de novo', async () => {});
it('mostra a validade (expira em 24 h, horário de Brasília) e como o funcionário usa (ler o QR; informar o código ao funcionário presente)', async () => {});
it('acessibilidade: role=dialog, foco inicial, Esc fecha, foco devolvido ao acionador, aria-live para o resultado', async () => {});
```
`qrcode` é mockada nos testes (`vi.mock('qrcode')`) e validada em um teste de integração separado que gera um QR real com a biblioteca instalada (`toDataURL` devolve `data:image/png;base64,`).
- [ ] **Step 2: Implementar `SignatureLinkDialog`** — chama `epiApi.createSignatureRequest({ employee_id, delivery_ids, idempotency_key: newIdempotencyKey() }, tenant)`; o resultado vive só em `useState` local; `useEffect` de limpeza no fechamento/desmontagem zera o estado; o código é exibido em tipografia grande com espaçamento (`123 456`), com texto "Anote ou informe ao funcionário agora: este código não poderá ser exibido de novo."; QR com `QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' })` em `<img alt="QR code do link de assinatura">`.
- [ ] **Step 3: Testes e implementação do `InPersonDialog`** — campos testemunha (3–120) e motivo (5–300) com contagem por caracteres Unicode (`[...s.trim()].length`, como o backend), rejeitar só espaços; `POST /epi-signatures/in-person`; erros: 409 termo não aprovado (mensagem), 409 entrega já tratada, 400 validação; sucesso fecha e chama `onDone`; foco/acessibilidade.
- [ ] **Step 4: Testes da `EpiMovimentacaoView` (RED)**:

```tsx
it('histórico com filtros (EPI, funcionário, tipo, período) e paginação; tipos em português; estornadas marcadas', async () => {});
it('formulário por tipo: entrada (fornecedor/origem, lote e validade quando o EPI controla lote), entrega (funcionário, quantidade, lote), devolução (funcionário, motivo), troca, baixa (motivo), ajuste (mais/menos + motivo; só empresa), abertura (só empresa)', async () => {});
it('cada envio usa uma idempotency_key nova; reenviar o MESMO formulário após falha de rede reaproveita a mesma chave (mantida em ref até sucesso)', async () => {});
it('mensagens dos erros do backend (Estoque insuficiente, CA vencido, Lote vencido, devolução maior, etc.) saem da lista fechada, nunca texto cru', async () => {});
it('baixa, ajuste e estorno pedem confirmação (ConfirmDialog) com o motivo; cancelar não envia', async () => {});
it('após entrega bem-sucedida aparece "Gerar link de assinatura" e "Registrar assinatura presencial" com os delivery_ids da entrega; revogar link ativo', async () => {});
it('quantidade: inteiro positivo ≤ 100000 (validação no cliente) e o botão fica desabilitado durante o envio (duplo clique envia uma vez)', async () => {});
```
- [ ] **Step 5: Implementar `EpiMovimentacaoView` e a página** `app/empresa/epi/movimentacao/page.tsx`; seletores de EPI e funcionário carregados por `searchEpis`/`employees`; para `tenantId` (técnico) repassar o parâmetro em todas as chamadas.
- [ ] **Step 6: Rodar** — `run-fe.sh` (vitest completo, tsc, lint, build) + **verificação visual** (dialogo com QR e código; formulário de entrega mobile) e inspeção com `Read`. **Prova ponta a ponta com Chromium real**: com o backend do ensaio no ar (ou o servidor falso fiel ao contrato), gerar o link pela tela, abrir o link numa segunda página e assinar; registrar o resultado.
- [ ] **Step 7: Entrega** (listar arquivos; não comitar).

---

### Task 6: Frontend — Fichas, rota do técnico, resumo e remoção do painel antigo

**Files:**
- Create: `frontend/src/components/epi/{EpiFichasView,EpiResumoCard}.tsx`, `frontend/src/app/empresa/epi/fichas/page.tsx`, `frontend/src/app/tecnico/empresas/[tenantId]/epi/page.tsx`
- Modify: `frontend/src/app/tecnico/empresas/[tenantId]/page.tsx`
- Delete: `frontend/src/components/EpisPanel.tsx`
- Test: `frontend/src/components/epi/__tests__/{EpiFichasView,EpiResumoCard}.test.tsx`, `frontend/src/app/tecnico/empresas/__tests__/epi-rota.test.tsx`

**Interfaces:**
- Produces: `EpiFichasView({ tenantId? })`, `EpiResumoCard({ tenantId })`; rota do técnico com abas (`EpiTabs`: Painel, Cadastro, Movimentação, Fichas).

- [ ] **Step 1: Testes das Fichas (RED)**:

```tsx
it('seleciona funcionário (busca por nome), carrega a ficha com filtros de período e situação da assinatura; mostra empresa, funcionário (CPF mascarado vindo do servidor, nunca montado no cliente), matrícula/setor/função ("não informada" quando nulos) e o histórico com status por linha', async () => {});
it('pré-visualizar abre o PDF em nova aba por Blob autenticado (noopener) e revoga a URL; erro 400/404/502 viram mensagem de lista fechada', async () => {});
it('emitir pede confirmação, usa idempotency_key nova (reaproveita em retentativa), mostra a versão/código do documento e atualiza a lista; 502/503/409 com mensagens claras; ficha > 1000 linhas orienta restringir o período', async () => {});
it('lista de versões: código, versão, data/hora (Brasília), baixar (Blob), verificar integridade (íntegro/divergente/arquivo ausente com textos e cores distintas)', async () => {});
it('linhas assinadas mostram o comprovante e permitem baixar o comprovante PDF; entregas pendentes têm "Gerar link"', async () => {});
it('termo em rascunho: aviso de que o documento emitido carrega o termo em rascunho', async () => {});
it('nenhum CPF cru e nenhum storage; respostas atrasadas de outro funcionário são descartadas (geração)', async () => {});
```
- [ ] **Step 2: Implementar `EpiFichasView`** e a página `empresa/epi/fichas`.
- [ ] **Step 3: Rota do técnico e resumo** — `tecnico/empresas/[tenantId]/epi/page.tsx` (`'use client'`; `params.tenantId`; `EpiTabs` com as quatro views passando `tenantId`; o layout do técnico já aplica `RoleGuard` e `DashSkin`); `EpiResumoCard({ tenantId })` mostra 3 números do dashboard (EPIs, estoque crítico, assinaturas pendentes) e link "Abrir módulo de EPI" para essa rota; em `tecnico/empresas/[tenantId]/page.tsx` trocar o bloco `<EpisPanel tenantId=… />` pelo `EpiResumoCard`; **remover `components/EpisPanel.tsx`** e atualizar qualquer teste que o mockava. Testes: a rota passa `tenantId` a todas as chamadas (`tenant_id` na query), técnico não vê o ajuste de dias de aviso e as ações restritas a `empresa`; a página da empresa mostra o resumo; nenhum import restante de `EpisPanel` (`grep`).
- [ ] **Step 4: Rodar** — `run-fe.sh` completo; **verificação visual** (fichas, abas do técnico) com `Read`; prova ponta a ponta com Chromium real do fluxo ficha → emitir → baixar → verificar.
- [ ] **Step 5: Entrega** (listar arquivos; não comitar).

---

### Task 7: Regressão, revisão independente, documentação e relatório

**Files:**
- Create: `docs/architecture/epi-telas.md`

- [ ] **Step 1: Regressão** — backend no ensaio recriado do zero só com as migrations: unit completo e e2e completo em lotes (comparar as falhas com as 16 suítes que já falhavam por R2/Mercado Pago/OpenRouter falsos, com os mesmos 46 testes; nenhuma suíte nova pode falhar); frontend: `vitest run` completo, `tsc`, `lint` (sem aviso novo; baseline de 14 problemas), `next build`. Registrar comandos e resultados literais.
- [ ] **Step 2: Prova ponta a ponta no navegador** (Chromium/Playwright, ensaio de banco + backend + frontend descartáveis, R2 falso): responsável abre o painel, cadastra EPI, faz a abertura, registra uma entrega, gera o link de assinatura (QR e código), o funcionário assina numa segunda página, o painel mostra a assinatura, o responsável emite a ficha, baixa e verifica a integridade. Registrar capturas de tela e o resultado de cada passo (VERIFICADO ou o motivo do que não foi possível).
- [ ] **Step 3: Revisão independente** (quem implementa não aprova): `montese-seguranca` (isolamento de tenant das rotas novas e do `tenant_id`, papéis, ausência de CPF/token/código em estado persistente/log, download por Blob, XSS, rota legada) e `montese-qa` (diff real, critérios de aceitação, acessibilidade e responsividade). Corrigir só achados confirmados, numa única onda, com uma re-revisão escopada.
- [ ] **Step 4: Documentação** `docs/architecture/epi-telas.md`: mapa de rotas e menu, componentes, API consumida e endpoints novos (rota, papéis, parâmetros, códigos), regras de escopo de tenant, tabela de mensagens de erro, fluxo de assinatura do lado do responsável (código exibido uma vez), downloads por Blob, rota do técnico, rota legada endurecida, dependência `qrcode` (versão e auditoria), testes e como rodá-los (ensaio, `run-fe.sh`), limitações (sem importação de planilha, sem navegação própria do técnico, termo rascunho bloqueia assinatura em produção, sessão expirada durante download, desempenho do dashboard medido) e decisões pendentes do proprietário, rotulando VERIFICADO/NÃO VERIFICADO. Atualizar `docs/architecture/epi-assinatura.md` e a spec do subsistema 4 com os desvios. Não editar `PROJECT_STATE.md` sem autorização.
- [ ] **Step 5: Relatório final** ao proprietário: arquivos, testes e resultados literais, riscos restantes, validação manual sugerida, ordem de release (0081 → 0082 → 0083 → [0084 se criada]; backup; pacote do frontend com a nova dependência) e as decisões que ficam com ele. Não aplicar nada em produção.

---

## Self-Review (spec × plano)

- Menu com setor EPI e redirecionamento; contagem de itens → Task 3. Painel, Cadastro → Task 4. Movimentação + diálogos de assinatura (QR, código uma vez, presencial, revogação) → Task 5. Fichas (prévia, emitir, baixar, verificar) + rota do técnico + resumo + remoção do painel antigo → Task 6.
- Endpoints novos (dashboard agregado, configuração de dias de aviso, pendências de assinatura), `tenant_id` explícito e rota legada endurecida → Tasks 1-2. Desempenho do dashboard medido e índices só com prova → Task 1 Step 8.
- `qrcode` com versão fixa, auditoria e lockfile sem commit → Task 3 Step 2.
- Segurança: escopo de tenant (`resolveTenantScope`), código/link só em estado React e limpos, nenhum storage/log, downloads por Blob autenticado, mensagens de erro de lista fechada → Global Constraints + Tasks 3-6.
- Testes: backend e2e por rota, frontend por view, prova ponta a ponta no navegador, regressão e verificação visual → Tasks 1-7.
- Pontos a verificar na execução (NÃO VERIFICADO até rodar): ícones `ArrowLeftRight`/`ClipboardList` na versão instalada do `lucide-react`; comportamento de `qrcode` sob Vitest/jsdom (mock + teste de integração); `@types/qrcode`; que `GET /epis/search` e `/epis/movements` já usam o mesmo `WHERE` por tenant esperado; que `window.open` com Blob funciona em Safari iOS (alternativa: `download`); `crypto.randomUUID` em contextos não seguros (fallback); custo real do dashboard; limite de corpo e `ValidationPipe` global não interferem nos novos DTOs de query.
