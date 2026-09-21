# Admin — Montese Control (SP1): shell escuro + Visão Geral — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o novo shell escuro do painel `/admin` (sidebar, topbar, drawer mobile, logo) e uma Visão Geral com dados reais, mais CNPJ/endereço comercial da Montese exibidos só onde faz sentido.

**Architecture:** Tema escuro escopado a `/admin` por um wrapper `.admin-theme` que inverte a escala `--color-brand-*` (as 8 telas atuais herdam sem reescrita). O backend ganha um módulo de leitura `admin-dashboard` com 3 endpoints (`alertas`, `financeiro`, `clientes-recentes`); a Visão Geral é composta por cards independentes que buscam o próprio endpoint e falham isolados. Gráficos são SVG inline. Widgets sem fonte de dados mostram o selo "Em construção" e nenhum número.

**Tech Stack:** NestJS + `pg` + Jest/supertest (backend); Next.js 14 (App Router) + React 18 + Tailwind CSS v4 + TypeScript (frontend). Nenhuma dependência nova no projeto (Playwright e sharp só no scratchpad, para QA e para gerar o PNG do logo).

**Spec:** [`docs/specs/admin-montese-control-shell-visao-geral.md`](../../specs/admin-montese-control-shell-visao-geral.md) — leia inteira antes de começar; as seções 3 (correções) e 5 (card a card) mandam sobre qualquer suposição deste plano.

## Global Constraints

Valem para todas as tarefas (copiados da spec e do `PRODUCT.md`):

- **Nunca apresentar mock/roadmap como funcional.** Card sem fonte de dados mostra o selo "Em construção" e **nenhum número inventado**; sem dados fictícios em nenhuma tela.
- **Nenhuma dependência nova** no `package.json` do frontend nem do backend (sem Recharts, sem biblioteca de ícones, sem runner de teste novo). `sharp`/`playwright` existem só no scratchpad.
- **Tema escuro só dentro de `/admin`.** Não alterar `frontend/src/app/globals.css` nem `frontend/src/components/Logo.tsx` (mudanças não commitadas do redesign do site).
- **Estado nunca só por cor:** sempre ícone + texto ("Online", "Fora do ar", "Crítico").
- **Contraste de texto ≥ 4,5:1**; foco visível em todo elemento interativo; respeitar `prefers-reduced-motion`.
- **Endpoints novos:** `@Roles('admin')`, somente leitura, **nenhuma migration**, e `/alertas` **não faz chamada externa** (só banco e `os`).
- **Fuso:** "dia", "hoje" e "mês" financeiros em `America/Sao_Paulo`.
- **Dados da empresa** (fornecidos pelo fundador em 2026-09-21): CNPJ `69.203.754/0001-45`; endereço comercial Avenida Marcolino Martins Cabral, nº 2644, Bairro Aeroporto, Tubarão/SC, CEP 88705-004. CNPJ só em rodapés e telas de pagamento; endereço só em Termos de Uso e Política de Privacidade. **Razão social e foro não são preenchidos** (continuam placeholders explícitos).
- **Texto de interface, mensagens de commit e comentários em português do Brasil.**
- **Nome do produto no admin:** "Montese Control" ("Centro de comando da Montese").

---

## Ambiente e segurança — leia antes de qualquer comando

Este projeto teve **4 incidentes reais** com Docker/segredos (ver `docs/operations/` e as regras abaixo). Estas regras valem para você e para qualquer subagente:

**Comandos proibidos, sem exceção:** `docker compose config`; `docker inspect` sem `--format` (ou com `{{.Config.Env}}`); `docker exec … env|printenv`; `docker compose down -v` / `--volumes`, `docker volume rm|prune`; qualquer `grep`/`awk` "filtrando" a saída de um desses. Se um container parecer estranho, **pare e pergunte** — nunca recrie volume. Não crie `docker-compose.override.yml`.

**Segredos e credenciais:** nunca procure, leia, imprima nem peça senha/token de admin. Testes e2e criam um admin temporário pelo `TestDb` (já existente); o QA visual usa **respostas interceptadas** (fixtures), sem login real. Não imprima `.env`.

**O banco dos e2e é o de produção.** Não existe banco de teste isolado. Portanto: (1) todo dado criado por um teste usa marcador único (`admin-dash-…-${Date.now()}`) e é apagado no `afterAll`; (2) **nunca assuma tabela vazia** — compare valores antes e depois (delta); (3) não toque em linhas que o teste não criou; (4) não apague `audit_log` (o `montese_app` não pode, e os testes existentes deixam suas linhas de login).

**Git:** faça `git add` **só dos caminhos da tarefa** (nunca `git add -A` nem `git add .`). A árvore tem mudanças não commitadas do fundador que **não entram** nos seus commits — `git status --short` antes de cada commit e confira `git diff --cached --stat`. Os únicos arquivos com mudança do fundador que esta entrega precisa tocar são `frontend/src/app/(site)/tecnico/planos/page.tsx` e `frontend/src/app/(site)/planos/assinatura-concluida/page.tsx` → use o helper `stage_edit.py` (Tarefa 6). `PRODUCT.md` é não versionado: edite, **não** o inclua em commit. Termine cada mensagem de commit com a linha `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

**Frontend:** nunca rode `next build` enquanto `next dev` estiver de pé (quebra os chunks do dev). Para checar tipos use `cd /opt/Montese/frontend && npx tsc --noEmit` (seguro com o dev rodando).

### Preparação (uma vez, antes da Tarefa 1)

```bash
# Use o SEU diretório scratchpad se for diferente deste.
export SCRATCH=/tmp/claude-0/-opt-Montese/175b0fdd-28bf-4002-bccc-21b3a5966b87/scratchpad
mkdir -p "$SCRATCH/qa"

# Cópia do wrapper de testes apontada para os IPs internos do Docker (as portas
# não são publicadas). NÃO edite o wrapper original e NÃO publique portas.
PG_IP=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' montese_postgres)
RD_IP=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' montese_redis)
sed -e "s#@localhost:5432#@$PG_IP:5432#g" -e "s#@localhost:6379#@$RD_IP:6379#g" \
  /opt/Montese/run-backend-tests.sh > "$SCRATCH/run-net.sh"
chmod +x "$SCRATCH/run-net.sh"
grep -c "$PG_IP" "$SCRATCH/run-net.sh"   # esperado: 1
```

Os IPs mudam se os containers forem recriados — refaça a cópia se os e2e não conectarem.

Comandos de teste usados adiante:

- Unitário: `cd /opt/Montese/backend && npm run test:unit -- <padrão>`
- E2E: `"$SCRATCH/run-net.sh" test:e2e -- <padrão>`
- Tipos backend: `cd /opt/Montese/backend && npx tsc --noEmit -p tsconfig.json`
- Tipos frontend: `cd /opt/Montese/frontend && npx tsc --noEmit`

---

## File Structure

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `backend/src/admin-dashboard/payment-status.ts` | grupos de status de `payment_events` (aprovado/pendente/recusado) | 1 |
| `backend/src/admin-dashboard/alert-rules.ts` | `computeAlerts` — regras determinísticas e limites | 1 |
| `backend/src/admin-dashboard/admin-dashboard.service.ts` | consultas de alertas, financeiro e clientes recentes | 2–4 |
| `backend/src/admin-dashboard/admin-dashboard.controller.ts` | 3 rotas `admin/dashboard/*` | 2–4 |
| `backend/src/admin-dashboard/admin-dashboard.module.ts` | módulo; importa `OverviewModule` e `SystemStatusModule` | 2 |
| `backend/test/admin-alert-rules.unit-spec.ts` | unitário das regras de alerta | 1 |
| `backend/test/admin-dashboard-{alertas,financeiro,clientes-recentes}.e2e-spec.ts` | e2e dos endpoints | 2–4 |
| `frontend/src/lib/company.ts` | fonte única de CNPJ/endereço + `fillCompanyTokens` | 5 |
| `frontend/src/components/PaymentIssuerNote.tsx` | linha "Mercado Pago · Montese SST · CNPJ …" | 6 |
| `frontend/public/brand/logo-icon-mark.png` | ícone recortado (fundo transparente) | 7 |
| `frontend/src/components/admin/AdminBrand.tsx` | logo + "MONTESE CONTROL" | 7 |
| `frontend/src/app/admin/admin-theme.css` | tokens e inversão da escala `brand` | 8 |
| `frontend/src/components/admin/{icons.tsx,nav.ts,AdminSidebar.tsx,AdminFooter.tsx,AdminShell.tsx}` | shell: ícones, navegação, sidebar/drawer, rodapé, composição | 8 |
| `frontend/src/components/admin/{types.ts,api.ts,useAdminFetch.ts,status-state.ts,AdminStatusProvider.tsx,AdminTopbar.tsx,CommandPalette.tsx}` | dados compartilhados, topbar e paleta Ctrl+K | 9 |
| `frontend/src/components/admin/{format.ts,useNow.ts,Card.tsx,charts/*}` | primitivos de card e gráficos SVG | 10 |
| `frontend/src/components/admin/overview/*` | os cards da Visão Geral | 11–12 |
| `frontend/src/app/admin/overview/page.tsx` | composição da Visão Geral (reescrita) | 11–12 |
| `docs/roadmap.md`, `docs/compliance/matriz-conformidade.md`, `PRODUCT.md` | documentação | 14 |

**Arquivo removido:** `frontend/src/components/AdminSidebar.tsx` (só `admin/layout.tsx` o usava) — Tarefa 8.

---

## Tarefa 1: Regras de alerta (função pura) e grupos de status de pagamento

**Files:**
- Create: `backend/src/admin-dashboard/payment-status.ts`
- Create: `backend/src/admin-dashboard/alert-rules.ts`
- Test: `backend/test/admin-alert-rules.unit-spec.ts`

**Interfaces:**
- Produces (usados nas Tarefas 2–4):
  - `payment-status.ts`: `APPROVED_STATUSES`, `PENDING_STATUSES`, `REJECTED_STATUSES` (`readonly string[]`).
  - `alert-rules.ts`: `type AlertSeverity = 'critico' | 'atencao' | 'info'`; `interface AlertItem { id: string; severidade: AlertSeverity; titulo: string; detalhe: string; href: string }`; `interface AlertInput { services: { postgres: boolean; redis: boolean; site: boolean }; disk_used_percent: number; ram_used_percent: number; payments_rejected_7d: number; payments_pending_stale: number; documentos_vencendo: number; epis_vencendo: number }`; `interface AlertResult { contagem: Record<AlertSeverity, number>; itens: AlertItem[] }`; `computeAlerts(input: AlertInput, options?: { ramEnabled?: boolean }): AlertResult`; constantes `THRESHOLDS`, `PENDING_STALE_DAYS = 3`, `REJECTED_WINDOW_DAYS = 7`, `RAM_ALERT_ENABLED`.

- [ ] **Step 1: Escrever o teste que falha**

Create `backend/test/admin-alert-rules.unit-spec.ts`:

```ts
// Testes unitários puros das regras de alerta da Visão Geral do admin —
// sem banco, sem rede. Roda com `npm run test:unit -- admin-alert-rules`.
import { AlertInput, AlertResult, computeAlerts } from '../src/admin-dashboard/alert-rules';

function base(overrides: Partial<AlertInput> = {}): AlertInput {
  return {
    services: { postgres: true, redis: true, site: true },
    disk_used_percent: 40,
    ram_used_percent: 50,
    payments_rejected_7d: 0,
    payments_pending_stale: 0,
    documentos_vencendo: 0,
    epis_vencendo: 0,
    ...overrides,
  };
}

const ids = (r: AlertResult) => r.itens.map((i) => i.id);
const find = (r: AlertResult, id: string) => r.itens.find((i) => i.id === id);

describe('computeAlerts', () => {
  it('não gera alerta quando tudo está normal', () => {
    const r = computeAlerts(base());
    expect(r.itens).toEqual([]);
    expect(r.contagem).toEqual({ critico: 0, atencao: 0, info: 0 });
  });

  it.each([
    ['postgres', 'postgres_down', 'Banco de dados inacessível'],
    ['redis', 'redis_down', 'Redis inacessível'],
    ['site', 'site_down', 'Site inacessível'],
  ] as const)('serviço %s fora do ar gera alerta crítico', (service, id, titulo) => {
    const r = computeAlerts(base({ services: { postgres: true, redis: true, site: true, [service]: false } }));
    expect(ids(r)).toEqual([id]);
    expect(find(r, id)).toMatchObject({ severidade: 'critico', titulo, href: '/admin/overview' });
    expect(r.contagem).toEqual({ critico: 1, atencao: 0, info: 0 });
  });

  it.each([
    [79.99, null],
    [80, 'atencao'],
    [89.99, 'atencao'],
    [90, 'critico'],
    [100, 'critico'],
  ] as const)('disco em %s%% -> %s', (pct, severidade) => {
    const item = find(computeAlerts(base({ disk_used_percent: pct })), 'disk_high');
    if (severidade === null) expect(item).toBeUndefined();
    else expect(item?.severidade).toBe(severidade);
  });

  it('formata o percentual do disco arredondado no título', () => {
    expect(find(computeAlerts(base({ disk_used_percent: 84.4 })), 'disk_high')?.titulo).toBe('Disco em 84%');
  });

  it.each([
    [89.99, null],
    [90, 'atencao'],
    [94.99, 'atencao'],
    [95, 'critico'],
  ] as const)('RAM em %s%% -> %s', (pct, severidade) => {
    const item = find(computeAlerts(base({ ram_used_percent: pct }), { ramEnabled: true }), 'ram_high');
    if (severidade === null) expect(item).toBeUndefined();
    else expect(item?.severidade).toBe(severidade);
  });

  it('não avalia RAM quando a regra está desligada', () => {
    const r = computeAlerts(base({ ram_used_percent: 99 }), { ramEnabled: false });
    expect(find(r, 'ram_high')).toBeUndefined();
  });

  it('cobranças recusadas: singular e plural', () => {
    expect(find(computeAlerts(base({ payments_rejected_7d: 1 })), 'payments_rejected')).toMatchObject({
      severidade: 'atencao',
      titulo: '1 cobrança recusada nos últimos 7 dias',
      href: '/admin/financeiro',
    });
    expect(find(computeAlerts(base({ payments_rejected_7d: 3 })), 'payments_rejected')?.titulo).toBe(
      '3 cobranças recusadas nos últimos 7 dias',
    );
    expect(find(computeAlerts(base({ payments_rejected_7d: 0 })), 'payments_rejected')).toBeUndefined();
  });

  it('cobranças pendentes há mais de 3 dias: singular e plural', () => {
    expect(find(computeAlerts(base({ payments_pending_stale: 1 })), 'payments_pending_stale')).toMatchObject({
      severidade: 'atencao',
      titulo: '1 cobrança pendente há mais de 3 dias',
    });
    expect(find(computeAlerts(base({ payments_pending_stale: 2 })), 'payments_pending_stale')?.titulo).toBe(
      '2 cobranças pendentes há mais de 3 dias',
    );
  });

  it('documentos e EPIs vencendo são informativos', () => {
    const r = computeAlerts(base({ documentos_vencendo: 5, epis_vencendo: 1 }));
    expect(find(r, 'documents_expiring')).toMatchObject({
      severidade: 'info',
      titulo: '5 documentos vencem em 30 dias',
      href: '/admin/empresas',
    });
    expect(find(r, 'epis_expiring')?.titulo).toBe('1 EPI com CA vencendo em 30 dias');
    expect(r.contagem).toEqual({ critico: 0, atencao: 0, info: 2 });
    expect(find(computeAlerts(base({ documentos_vencendo: 1 })), 'documents_expiring')?.titulo).toBe(
      '1 documento vence em 30 dias',
    );
    expect(find(computeAlerts(base({ epis_vencendo: 4 })), 'epis_expiring')?.titulo).toBe(
      '4 EPIs com CA vencendo em 30 dias',
    );
  });

  it('ordena crítico antes de atenção antes de info, independente da ordem das regras', () => {
    const r = computeAlerts(
      base({ disk_used_percent: 85, ram_used_percent: 96, documentos_vencendo: 2 }),
      { ramEnabled: true },
    );
    expect(ids(r)).toEqual(['ram_high', 'disk_high', 'documents_expiring']);
    expect(r.contagem).toEqual({ critico: 1, atencao: 1, info: 1 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /opt/Montese/backend && npm run test:unit -- admin-alert-rules`
Expected: FAIL — `Cannot find module '../src/admin-dashboard/alert-rules'`.

- [ ] **Step 3: Implementar**

Create `backend/src/admin-dashboard/payment-status.ts`:

```ts
// Grupos de status de `payment_events`. O valor gravado vem de
// `payment.status` do Mercado Pago (não do status de agendamento) — ver
// docs/specs/fase-7-financeiro.md. Status fora dos três grupos (refunded,
// charged_back, in_mediation…) só contam em "cobrado" e aparecem com o
// status bruto nas listas.
export const APPROVED_STATUSES = ['approved'] as const;
export const PENDING_STATUSES = ['pending', 'in_process', 'authorized'] as const;
export const REJECTED_STATUSES = ['rejected', 'cancelled'] as const;
```

Create `backend/src/admin-dashboard/alert-rules.ts`:

```ts
// Regras de alerta determinísticas da Visão Geral do admin. Função pura:
// recebe números já coletados e devolve a lista de alertas — não toca em
// banco, rede nem relógio, para ser testável sem infraestrutura.
export type AlertSeverity = 'critico' | 'atencao' | 'info';

export interface AlertItem {
  id: string;
  severidade: AlertSeverity;
  titulo: string;
  detalhe: string;
  href: string;
}

export interface AlertInput {
  services: { postgres: boolean; redis: boolean; site: boolean };
  disk_used_percent: number;
  ram_used_percent: number;
  payments_rejected_7d: number;
  payments_pending_stale: number;
  documentos_vencendo: number;
  epis_vencendo: number;
}

export interface AlertResult {
  contagem: Record<AlertSeverity, number>;
  itens: AlertItem[];
}

export const THRESHOLDS = {
  DISK_ATENCAO: 80,
  DISK_CRITICO: 90,
  RAM_ATENCAO: 90,
  RAM_CRITICO: 95,
} as const;

export const PENDING_STALE_DAYS = 3;
export const REJECTED_WINDOW_DAYS = 7;

// `used_percent` de memória sai de os.freemem(), que em Linux pode ignorar
// cache de página e superestimar o uso. Só ligar depois de conferir contra
// `free -h` (MemAvailable) na VPS — ver Tarefa 14 do plano.
export const RAM_ALERT_ENABLED = true;

const ORDEM: Record<AlertSeverity, number> = { critico: 0, atencao: 1, info: 2 };

export function computeAlerts(
  input: AlertInput,
  options: { ramEnabled?: boolean } = {},
): AlertResult {
  const ramEnabled = options.ramEnabled ?? RAM_ALERT_ENABLED;
  const itens: AlertItem[] = [];

  if (!input.services.postgres) {
    itens.push({
      id: 'postgres_down',
      severidade: 'critico',
      titulo: 'Banco de dados inacessível',
      detalhe: 'O PostgreSQL não respondeu à checagem de conexão.',
      href: '/admin/overview',
    });
  }
  if (!input.services.redis) {
    itens.push({
      id: 'redis_down',
      severidade: 'critico',
      titulo: 'Redis inacessível',
      detalhe: 'O Redis não respondeu ao ping.',
      href: '/admin/overview',
    });
  }
  if (!input.services.site) {
    itens.push({
      id: 'site_down',
      severidade: 'critico',
      titulo: 'Site inacessível',
      detalhe: 'O frontend não respondeu à checagem de saúde.',
      href: '/admin/overview',
    });
  }

  if (input.disk_used_percent >= THRESHOLDS.DISK_ATENCAO) {
    itens.push({
      id: 'disk_high',
      severidade: input.disk_used_percent >= THRESHOLDS.DISK_CRITICO ? 'critico' : 'atencao',
      titulo: `Disco em ${Math.round(input.disk_used_percent)}%`,
      detalhe: 'Libere espaço ou amplie o disco da VPS antes que chegue a 100%.',
      href: '/admin/overview',
    });
  }

  if (ramEnabled && input.ram_used_percent >= THRESHOLDS.RAM_ATENCAO) {
    itens.push({
      id: 'ram_high',
      severidade: input.ram_used_percent >= THRESHOLDS.RAM_CRITICO ? 'critico' : 'atencao',
      titulo: `Memória em ${Math.round(input.ram_used_percent)}%`,
      detalhe: 'Uso de RAM acima do normal na VPS.',
      href: '/admin/overview',
    });
  }

  if (input.payments_rejected_7d > 0) {
    const n = input.payments_rejected_7d;
    itens.push({
      id: 'payments_rejected',
      severidade: 'atencao',
      titulo:
        n === 1
          ? `1 cobrança recusada nos últimos ${REJECTED_WINDOW_DAYS} dias`
          : `${n} cobranças recusadas nos últimos ${REJECTED_WINDOW_DAYS} dias`,
      detalhe: 'Confira as assinaturas afetadas em Financeiro.',
      href: '/admin/financeiro',
    });
  }

  if (input.payments_pending_stale > 0) {
    const n = input.payments_pending_stale;
    itens.push({
      id: 'payments_pending_stale',
      severidade: 'atencao',
      titulo:
        n === 1
          ? `1 cobrança pendente há mais de ${PENDING_STALE_DAYS} dias`
          : `${n} cobranças pendentes há mais de ${PENDING_STALE_DAYS} dias`,
      detalhe: 'O Mercado Pago não confirmou nem recusou essas cobranças.',
      href: '/admin/financeiro',
    });
  }

  if (input.documentos_vencendo > 0) {
    const n = input.documentos_vencendo;
    itens.push({
      id: 'documents_expiring',
      severidade: 'info',
      titulo: n === 1 ? '1 documento vence em 30 dias' : `${n} documentos vencem em 30 dias`,
      detalhe: 'Somando todas as empresas.',
      href: '/admin/empresas',
    });
  }

  if (input.epis_vencendo > 0) {
    const n = input.epis_vencendo;
    itens.push({
      id: 'epis_expiring',
      severidade: 'info',
      titulo: n === 1 ? '1 EPI com CA vencendo em 30 dias' : `${n} EPIs com CA vencendo em 30 dias`,
      detalhe: 'Somando todas as empresas.',
      href: '/admin/empresas',
    });
  }

  itens.sort((a, b) => ORDEM[a.severidade] - ORDEM[b.severidade]);

  const contagem: Record<AlertSeverity, number> = { critico: 0, atencao: 0, info: 0 };
  for (const item of itens) contagem[item.severidade] += 1;

  return { contagem, itens };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /opt/Montese/backend && npm run test:unit -- admin-alert-rules`
Expected: PASS (todos os casos). Se o runner falhar por motivo de ambiente (não por asserção), repita com `"$SCRATCH/run-net.sh" test:unit -- admin-alert-rules`.

- [ ] **Step 5: Commit**

```bash
cd /opt/Montese && git status --short | head -3 && git add backend/src/admin-dashboard/payment-status.ts backend/src/admin-dashboard/alert-rules.ts backend/test/admin-alert-rules.unit-spec.ts && git diff --cached --stat && git commit -m "$(cat <<'EOF'
feat: regras determinísticas de alerta do admin (computeAlerts) com testes unitários

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarefa 2: Módulo `admin-dashboard` e endpoint `GET /admin/dashboard/alertas`

**Files:**
- Create: `backend/src/admin-dashboard/admin-dashboard.service.ts`
- Create: `backend/src/admin-dashboard/admin-dashboard.controller.ts`
- Create: `backend/src/admin-dashboard/admin-dashboard.module.ts`
- Modify: `backend/src/overview/overview.module.ts` (exporta `OverviewService`)
- Modify: `backend/src/system-status/system-status.module.ts` (exporta `SystemStatusService`)
- Modify: `backend/src/app.module.ts` (registra `AdminDashboardModule`)
- Test: `backend/test/admin-dashboard-alertas.e2e-spec.ts`

**Interfaces:**
- Consumes: `computeAlerts`, `AlertResult`, `PENDING_STALE_DAYS`, `REJECTED_WINDOW_DAYS` (`alert-rules.ts`); `APPROVED/PENDING/REJECTED_STATUSES` (`payment-status.ts`); `SystemStatusService.getStatus()`; `OverviewService.getMetrics(client)`.
- Produces: rota `GET /admin/dashboard/alertas` → `{ gerado_em: string; contagem: Record<'critico'|'atencao'|'info', number>; itens: AlertItem[] }`; classe `AdminDashboardService` (as Tarefas 3 e 4 adicionam métodos a ela e rotas ao controller).

- [ ] **Step 1: Escrever o e2e que falha**

Create `backend/test/admin-dashboard-alertas.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

const RUN = `admin-dash-alertas-${Date.now()}`;

describe('GET /admin/dashboard/alertas (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let subscriptionId: string;
  const q = (text: string, params?: unknown[]) => (db as any).client.query(text, params);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa Dash Alertas');
    const admin = await db.createUserWithRole('admin', 'Admin Dash Alertas');

    const plan = await q(`SELECT id FROM plans WHERE audience = 'empresa' LIMIT 1`);
    const sub = await q(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'authorized', $3) RETURNING id`,
      [plan.rows[0].id, tenant.tenantId, `${RUN}-preapproval`],
    );
    subscriptionId = sub.rows[0].id;

    // Cobrança pendente há 10 dias: dispara payments_pending_stale
    // independente do que já exista na base real.
    await q(
      `INSERT INTO payment_events (subscription_id, mercadopago_payment_id, amount_cents, status, occurred_at)
       VALUES ($1, $2, 39700, 'pending', now() - interval '10 days')`,
      [subscriptionId, `${RUN}-pendente`],
    );

    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await q('DELETE FROM payment_events WHERE subscription_id = $1', [subscriptionId]);
    await q('DELETE FROM subscriptions WHERE id = $1', [subscriptionId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('exige autenticação (401 sem token)', async () => {
    const res = await request(app.getHttpServer()).get('/admin/dashboard/alertas');
    expect(res.status).toBe(401);
  });

  it('bloqueia empresa com 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/dashboard/alertas')
      .set('Authorization', `Bearer ${tokenEmpresa}`);
    expect(res.status).toBe(403);
  });

  it('admin recebe contagem coerente com os itens', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/dashboard/alertas')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(new Date(res.body.gerado_em).toString()).not.toBe('Invalid Date');
    expect(Array.isArray(res.body.itens)).toBe(true);

    const contagem = { critico: 0, atencao: 0, info: 0 };
    for (const item of res.body.itens) {
      expect(['critico', 'atencao', 'info']).toContain(item.severidade);
      expect(typeof item.id).toBe('string');
      expect(item.titulo.length).toBeGreaterThan(0);
      expect(item.detalhe.length).toBeGreaterThan(0);
      expect(item.href.startsWith('/admin')).toBe(true);
      contagem[item.severidade as 'critico' | 'atencao' | 'info'] += 1;
    }
    expect(res.body.contagem).toEqual(contagem);
  });

  it('inclui payments_pending_stale quando há cobrança pendente com mais de 3 dias', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/dashboard/alertas')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const item = res.body.itens.find((i: any) => i.id === 'payments_pending_stale');
    expect(item).toBeDefined();
    expect(item.severidade).toBe('atencao');
    expect(item.titulo).toMatch(/cobrança(s)? pendente(s)? há mais de 3 dias/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `"$SCRATCH/run-net.sh" test:e2e -- admin-dashboard-alertas`
Expected: FAIL — os 4 testes falham com `expected 401/403/200, received 404` (a rota ainda não existe).

- [ ] **Step 3: Implementar**

Create `backend/src/admin-dashboard/admin-dashboard.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { OverviewService } from '../overview/overview.service';
import { SystemStatusService } from '../system-status/system-status.service';
import { AlertResult, computeAlerts, PENDING_STALE_DAYS, REJECTED_WINDOW_DAYS } from './alert-rules';
import { PENDING_STATUSES, REJECTED_STATUSES } from './payment-status';

export interface AlertasResponse extends AlertResult {
  gerado_em: string;
}

// Só leitura. Chamado apenas por rotas @Roles('admin'); o `client` vem de
// req.withTenantContext, então as políticas RLS de admin já se aplicam.
@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly systemStatus: SystemStatusService,
    private readonly overview: OverviewService,
  ) {}

  // Nenhuma chamada externa aqui (nada de OpenRouter etc.): só banco e `os`,
  // para a resposta ser rápida e o sino da topbar nunca travar por terceiro.
  async getAlertas(client: PoolClient): Promise<AlertasResponse> {
    const [status, metrics, payments] = await Promise.all([
      this.systemStatus.getStatus(),
      this.overview.getMetrics(client),
      this.countPaymentAlerts(client),
    ]);

    const result = computeAlerts({
      services: {
        postgres: status.services.postgres.reachable,
        redis: status.services.redis.reachable,
        site: status.services.frontend.reachable,
      },
      disk_used_percent: status.disk.used_percent,
      ram_used_percent: status.memory.used_percent,
      payments_rejected_7d: payments.rejected,
      payments_pending_stale: payments.pendingStale,
      documentos_vencendo: metrics.documentos_vencendo,
      epis_vencendo: metrics.epis_vencendo,
    });

    return { gerado_em: new Date().toISOString(), ...result };
  }

  private async countPaymentAlerts(
    client: PoolClient,
  ): Promise<{ rejected: number; pendingStale: number }> {
    const result = await client.query<{ rejected: number; pending_stale: number }>(
      `SELECT
         (SELECT count(*) FROM payment_events
            WHERE status = ANY($1::text[])
              AND occurred_at >= now() - make_interval(days => $3::int))::int AS rejected,
         (SELECT count(*) FROM payment_events
            WHERE status = ANY($2::text[])
              AND occurred_at < now() - make_interval(days => $4::int))::int AS pending_stale`,
      [[...REJECTED_STATUSES], [...PENDING_STATUSES], REJECTED_WINDOW_DAYS, PENDING_STALE_DAYS],
    );
    return { rejected: result.rows[0].rejected, pendingStale: result.rows[0].pending_stale };
  }
}
```

Create `backend/src/admin-dashboard/admin-dashboard.controller.ts`:

```ts
import { Controller, Get, Req } from '@nestjs/common';
import { PoolClient } from 'pg';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminDashboardService } from './admin-dashboard.service';

@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Roles('admin')
  @Get('alertas')
  getAlertas(@Req() req: any) {
    return req.withTenantContext((client: PoolClient) => this.dashboard.getAlertas(client));
  }
}
```

Create `backend/src/admin-dashboard/admin-dashboard.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { OverviewModule } from '../overview/overview.module';
import { SystemStatusModule } from '../system-status/system-status.module';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';

@Module({
  imports: [OverviewModule, SystemStatusModule],
  controllers: [AdminDashboardController],
  providers: [AdminDashboardService],
})
export class AdminDashboardModule {}
```

Modify `backend/src/overview/overview.module.ts` — add `exports`:

```ts
@Module({
  controllers: [OverviewController],
  providers: [OverviewService],
  exports: [OverviewService],
})
export class OverviewModule {}
```

Modify `backend/src/system-status/system-status.module.ts` — add `exports`:

```ts
@Module({
  controllers: [SystemStatusController],
  providers: [SystemStatusService],
  exports: [SystemStatusService],
})
export class SystemStatusModule {}
```

Modify `backend/src/app.module.ts`: add the import line after `import { SystemStatusModule } from './system-status/system-status.module';`

```ts
import { AdminDashboardModule } from './admin-dashboard/admin-dashboard.module';
```

and add `AdminDashboardModule,` in the `imports` array right after `SystemStatusModule,`.

- [ ] **Step 4: Checar tipos e rodar o e2e**

Run: `cd /opt/Montese/backend && npx tsc --noEmit -p tsconfig.json`
Expected: sem erros.

Run: `"$SCRATCH/run-net.sh" test:e2e -- admin-dashboard-alertas`
Expected: PASS (4 testes). Rode também `"$SCRATCH/run-net.sh" test:e2e -- system-status` e `-- overview` para garantir que os `exports` novos não quebraram os módulos.

- [ ] **Step 5: Commit**

```bash
cd /opt/Montese && git add backend/src/admin-dashboard/admin-dashboard.service.ts backend/src/admin-dashboard/admin-dashboard.controller.ts backend/src/admin-dashboard/admin-dashboard.module.ts backend/src/overview/overview.module.ts backend/src/system-status/system-status.module.ts backend/src/app.module.ts backend/test/admin-dashboard-alertas.e2e-spec.ts && git diff --cached --stat && git commit -m "$(cat <<'EOF'
feat: endpoint GET /admin/dashboard/alertas (regras determinísticas, sem chamada externa)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```


---

## Tarefa 3: Endpoint `GET /admin/dashboard/financeiro`

**Files:**
- Modify: `backend/src/admin-dashboard/admin-dashboard.service.ts`
- Modify: `backend/src/admin-dashboard/admin-dashboard.controller.ts`
- Test: `backend/test/admin-dashboard-financeiro.e2e-spec.ts`

**Interfaces:**
- Consumes: `APPROVED_STATUSES`, `PENDING_STATUSES`, `REJECTED_STATUSES` (`payment-status.ts`).
- Produces: rota `GET /admin/dashboard/financeiro?dias=7|30|90` (padrão 30; qualquer outro valor → 30) →
  `{ periodo_dias: number; serie: { data: 'YYYY-MM-DD'; cobrado_cents: number; aprovado_cents: number }[]; hoje: { cobrado_cents; aprovado_cents; pendente_cents }; mes: { cobrado_cents; aprovado_cents; pendente_cents; recusado_cents }; recentes: { id; mercadopago_payment_id; amount_cents; status; occurred_at; cliente: string | null; plano: string | null }[] }`. `serie` tem **um item por dia** (zeros nos dias sem evento), em ordem crescente, no fuso `America/Sao_Paulo`. Consumido pelo frontend nas Tarefas 11–12.

- [ ] **Step 1: Escrever o e2e que falha**

Create `backend/test/admin-dashboard-financeiro.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

const RUN = `admin-dash-fin-${Date.now()}`;

// Data de hoje no fuso de São Paulo, formato YYYY-MM-DD.
function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

describe('GET /admin/dashboard/financeiro (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let subscriptionId: string;
  let tenantName: string;
  let planName: string;
  const q = (text: string, params?: unknown[]) => (db as any).client.query(text, params);

  async function get(query = '') {
    return request(app.getHttpServer())
      .get(`/admin/dashboard/financeiro${query}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
  }

  async function insertEvent(
    suffix: string,
    cents: number,
    status: string,
    occurredAtSql: string,
    withSubscription = true,
  ) {
    await q(
      `INSERT INTO payment_events (subscription_id, mercadopago_payment_id, amount_cents, status, occurred_at)
       VALUES ($1, $2, $3, $4, ${occurredAtSql})`,
      [withSubscription ? subscriptionId : null, `${RUN}-${suffix}`, cents, status],
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa Dash Financeiro');
    const admin = await db.createUserWithRole('admin', 'Admin Dash Financeiro');

    tenantName = (await q('SELECT name FROM tenants WHERE id = $1', [tenant.tenantId])).rows[0].name;
    const plan = await q(`SELECT id, name FROM plans WHERE audience = 'empresa' LIMIT 1`);
    planName = plan.rows[0].name;
    const sub = await q(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'authorized', $3) RETURNING id`,
      [plan.rows[0].id, tenant.tenantId, `${RUN}-preapproval`],
    );
    subscriptionId = sub.rows[0].id;

    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await q(`DELETE FROM payment_events WHERE mercadopago_payment_id LIKE $1`, [`${RUN}-%`]);
    await q('DELETE FROM subscriptions WHERE id = $1', [subscriptionId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('exige autenticação e bloqueia empresa', async () => {
    const semToken = await request(app.getHttpServer()).get('/admin/dashboard/financeiro');
    expect(semToken.status).toBe(401);
    const empresa = await request(app.getHttpServer())
      .get('/admin/dashboard/financeiro')
      .set('Authorization', `Bearer ${tokenEmpresa}`);
    expect(empresa.status).toBe(403);
  });

  it('aceita 7, 30 e 90 dias; qualquer outro valor cai em 30', async () => {
    const casos: [string | undefined, number][] = [
      ['7', 7],
      ['30', 30],
      ['90', 90],
      ['15', 30],
      ['abc', 30],
      [undefined, 30],
    ];
    for (const [param, esperado] of casos) {
      const res = await get(param === undefined ? '' : `?dias=${param}`);
      expect(res.status).toBe(200);
      expect(res.body.periodo_dias).toBe(esperado);
      expect(res.body.serie).toHaveLength(esperado);
    }
  });

  it('devolve uma série completa, ordenada, terminando hoje (São Paulo)', async () => {
    const { serie } = (await get('?dias=7')).body;
    for (let i = 1; i < serie.length; i++) {
      expect(serie[i].data > serie[i - 1].data).toBe(true);
    }
    for (const ponto of serie) {
      expect(ponto.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isInteger(ponto.cobrado_cents)).toBe(true);
      expect(Number.isInteger(ponto.aprovado_cents)).toBe(true);
      expect(ponto.aprovado_cents).toBeLessThanOrEqual(ponto.cobrado_cents);
    }
    expect(serie[serie.length - 1].data).toBe(hojeSaoPaulo());
  });

  it('classifica cobrado, aprovado, pendente e recusado e vincula cliente e plano', async () => {
    const antes = (await get('?dias=7')).body;

    await insertEvent('ok', 12345, 'approved', 'now()');
    await insertEvent('pend', 2345, 'pending', 'now()');
    await insertEvent('rej', 345, 'rejected', 'now()');
    await insertEvent('ref', 45, 'refunded', 'now()'); // só conta em "cobrado"
    await insertEvent('orfao', 6, 'approved', 'now()', false); // sem assinatura

    const depois = (await get('?dias=7')).body;
    const total = 12345 + 2345 + 345 + 45 + 6;

    expect(depois.hoje.cobrado_cents - antes.hoje.cobrado_cents).toBe(total);
    expect(depois.hoje.aprovado_cents - antes.hoje.aprovado_cents).toBe(12345 + 6);
    expect(depois.hoje.pendente_cents - antes.hoje.pendente_cents).toBe(2345);
    expect(depois.mes.recusado_cents - antes.mes.recusado_cents).toBe(345);

    const ultimo = depois.serie[depois.serie.length - 1];
    const ultimoAntes = antes.serie[antes.serie.length - 1];
    expect(ultimo.cobrado_cents - ultimoAntes.cobrado_cents).toBe(total);
    expect(ultimo.aprovado_cents - ultimoAntes.aprovado_cents).toBe(12345 + 6);

    expect(depois.recentes.length).toBeLessThanOrEqual(5);
    const ok = depois.recentes.find((r: any) => r.mercadopago_payment_id === `${RUN}-ok`);
    expect(ok).toMatchObject({ amount_cents: 12345, status: 'approved', cliente: tenantName, plano: planName });
    const orfao = depois.recentes.find((r: any) => r.mercadopago_payment_id === `${RUN}-orfao`);
    expect(orfao.cliente).toBeNull();
    expect(orfao.plano).toBeNull();
  });

  it('atribui o evento ao dia de São Paulo, não ao dia UTC', async () => {
    const antes = (await get('?dias=7')).body.serie;

    // 23:59 de ontem no horário de São Paulo — em UTC isso já é "hoje".
    await insertEvent(
      'tz',
      777,
      'approved',
      `(date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 minute') AT TIME ZONE 'America/Sao_Paulo'`,
    );

    const depois = (await get('?dias=7')).body.serie;
    const n = depois.length;
    expect(depois[n - 2].cobrado_cents - antes[n - 2].cobrado_cents).toBe(777);
    expect(depois[n - 1].cobrado_cents - antes[n - 1].cobrado_cents).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `"$SCRATCH/run-net.sh" test:e2e -- admin-dashboard-financeiro`
Expected: FAIL — `expected 200, received 404` (rota inexistente).

- [ ] **Step 3: Implementar**

Modify `backend/src/admin-dashboard/admin-dashboard.service.ts`:

(a) Trocar a linha de import de `payment-status` por:

```ts
import { APPROVED_STATUSES, PENDING_STATUSES, REJECTED_STATUSES } from './payment-status';
```

(b) Adicionar, logo depois de `export interface AlertasResponse … { … }`:

```ts
export interface FinanceiroPeriodo {
  cobrado_cents: number;
  aprovado_cents: number;
  pendente_cents: number;
}

export interface PagamentoRecente {
  id: string;
  mercadopago_payment_id: string;
  amount_cents: number;
  status: string;
  occurred_at: string;
  cliente: string | null;
  plano: string | null;
}

export interface FinanceiroResponse {
  periodo_dias: number;
  serie: { data: string; cobrado_cents: number; aprovado_cents: number }[];
  hoje: FinanceiroPeriodo;
  mes: FinanceiroPeriodo & { recusado_cents: number };
  recentes: PagamentoRecente[];
}

interface ResumoRow {
  hoje_cobrado_cents: number;
  hoje_aprovado_cents: number;
  hoje_pendente_cents: number;
  mes_cobrado_cents: number;
  mes_aprovado_cents: number;
  mes_pendente_cents: number;
  mes_recusado_cents: number;
}
```

(c) Adicionar este método dentro da classe `AdminDashboardService`, antes de `private async countPaymentAlerts`:

```ts
  // "Cobrado" = soma de todos os eventos do período; "aprovado" = status
  // approved; "pendente"/"recusado" seguem os grupos de payment-status.ts.
  // Dia, hoje e mês em America/Sao_Paulo — um evento às 23:59 de Brasília é
  // do dia de Brasília, mesmo que em UTC já seja o dia seguinte.
  async getFinanceiro(client: PoolClient, dias: number): Promise<FinanceiroResponse> {
    const approved = [...APPROVED_STATUSES];
    const pending = [...PENDING_STATUSES];
    const rejected = [...REJECTED_STATUSES];

    const [serie, resumo, recentes] = await Promise.all([
      client.query<{ data: string; cobrado_cents: number; aprovado_cents: number }>(
        `WITH dias AS (
           SELECT generate_series(
             ((now() AT TIME ZONE 'America/Sao_Paulo')::date - ($1::int - 1))::timestamp,
             (now() AT TIME ZONE 'America/Sao_Paulo')::date::timestamp,
             interval '1 day'
           )::date AS dia
         )
         SELECT to_char(d.dia, 'YYYY-MM-DD') AS data,
                COALESCE(sum(e.amount_cents), 0)::int AS cobrado_cents,
                COALESCE(sum(e.amount_cents) FILTER (WHERE e.status = ANY($2::text[])), 0)::int AS aprovado_cents
         FROM dias d
         LEFT JOIN payment_events e
           ON (e.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date = d.dia
         GROUP BY d.dia
         ORDER BY d.dia`,
        [dias, approved],
      ),
      client.query<ResumoRow>(
        `WITH hoje AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d),
              e AS (
                SELECT amount_cents, status,
                       (occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia
                FROM payment_events
                WHERE occurred_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
                                       AT TIME ZONE 'America/Sao_Paulo'
              )
         SELECT
           COALESCE(sum(e.amount_cents) FILTER (WHERE e.dia = hoje.d), 0)::int AS hoje_cobrado_cents,
           COALESCE(sum(e.amount_cents) FILTER (WHERE e.dia = hoje.d AND e.status = ANY($1::text[])), 0)::int AS hoje_aprovado_cents,
           COALESCE(sum(e.amount_cents) FILTER (WHERE e.dia = hoje.d AND e.status = ANY($2::text[])), 0)::int AS hoje_pendente_cents,
           COALESCE(sum(e.amount_cents), 0)::int AS mes_cobrado_cents,
           COALESCE(sum(e.amount_cents) FILTER (WHERE e.status = ANY($1::text[])), 0)::int AS mes_aprovado_cents,
           COALESCE(sum(e.amount_cents) FILTER (WHERE e.status = ANY($2::text[])), 0)::int AS mes_pendente_cents,
           COALESCE(sum(e.amount_cents) FILTER (WHERE e.status = ANY($3::text[])), 0)::int AS mes_recusado_cents
         FROM e CROSS JOIN hoje`,
        [approved, pending, rejected],
      ),
      // Mesmo join de SubscriptionsService.findAllForAdmin; LEFT JOIN porque
      // evento gravado sem vínculo de assinatura é legítimo (webhook órfão).
      client.query<PagamentoRecente>(
        `SELECT e.id, e.mercadopago_payment_id, e.amount_cents, e.status, e.occurred_at,
                COALESCE(t.name, u.full_name) AS cliente, p.name AS plano
         FROM payment_events e
         LEFT JOIN subscriptions s ON s.id = e.subscription_id
         LEFT JOIN plans p ON p.id = s.plan_id
         LEFT JOIN tenants t ON t.id = s.tenant_id
         LEFT JOIN users u ON u.id = s.technician_user_id
         ORDER BY e.occurred_at DESC
         LIMIT 5`,
      ),
    ]);

    const r = resumo.rows[0];
    return {
      periodo_dias: dias,
      serie: serie.rows,
      hoje: {
        cobrado_cents: r.hoje_cobrado_cents,
        aprovado_cents: r.hoje_aprovado_cents,
        pendente_cents: r.hoje_pendente_cents,
      },
      mes: {
        cobrado_cents: r.mes_cobrado_cents,
        aprovado_cents: r.mes_aprovado_cents,
        pendente_cents: r.mes_pendente_cents,
        recusado_cents: r.mes_recusado_cents,
      },
      recentes: recentes.rows,
    };
  }
```

Modify `backend/src/admin-dashboard/admin-dashboard.controller.ts`: trocar o import do Nest por `import { Controller, Get, Query, Req } from '@nestjs/common';`, adicionar antes da classe

```ts
const DIAS_PERMITIDOS = [7, 30, 90];

function parseDias(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return DIAS_PERMITIDOS.includes(parsed) ? parsed : 30;
}
```

e dentro da classe, depois de `getAlertas`:

```ts
  @Roles('admin')
  @Get('financeiro')
  getFinanceiro(@Query('dias') dias: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: PoolClient) =>
      this.dashboard.getFinanceiro(client, parseDias(dias)),
    );
  }
```

- [ ] **Step 4: Checar tipos e rodar o e2e**

Run: `cd /opt/Montese/backend && npx tsc --noEmit -p tsconfig.json` → sem erros.
Run: `"$SCRATCH/run-net.sh" test:e2e -- admin-dashboard-financeiro` → PASS (5 testes). Rode também `-- admin-dashboard-alertas` (regressão).

- [ ] **Step 5: Commit**

```bash
cd /opt/Montese && git add backend/src/admin-dashboard/admin-dashboard.service.ts backend/src/admin-dashboard/admin-dashboard.controller.ts backend/test/admin-dashboard-financeiro.e2e-spec.ts && git diff --cached --stat && git commit -m "$(cat <<'EOF'
feat: endpoint GET /admin/dashboard/financeiro (série diária, hoje/mês e pagamentos recentes)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarefa 4: Endpoint `GET /admin/dashboard/clientes-recentes`

**Files:**
- Modify: `backend/src/admin-dashboard/admin-dashboard.service.ts`
- Modify: `backend/src/admin-dashboard/admin-dashboard.controller.ts`
- Test: `backend/test/admin-dashboard-clientes-recentes.e2e-spec.ts`

**Interfaces:**
- Produces: rota `GET /admin/dashboard/clientes-recentes?limit=` (padrão 5, máximo 20, inválido → 5) →
  `{ id: string; nome: string; plano: string; status: string; mrr_cents: number | null; ultimo_acesso: string | null; created_at: string }[]`, ordenado por `tenants.created_at DESC`. `plano`/`mrr_cents` vêm da assinatura `authorized` mais recente; sem assinatura → `plano` = `tenants.plan` (ex.: `trial`) e `mrr_cents` = `null`. `ultimo_acesso` = último `login_success` do tenant em `audit_log` (ou `null`). Consumido na Tarefa 12.

- [ ] **Step 1: Escrever o e2e que falha**

Create `backend/test/admin-dashboard-clientes-recentes.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb, TestTenantFixture } from './db-test-helper';

const RUN = `admin-dash-cli-${Date.now()}`;

async function waitFor<T>(fn: () => Promise<T | null>, tries = 30, delayMs = 100): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

describe('GET /admin/dashboard/clientes-recentes (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let tenantA: TestTenantFixture; // com assinatura e com login
  let tenantB: TestTenantFixture; // sem assinatura, sem login (criado depois: mais novo)
  let subscriptionId: string;
  let planName: string;
  let planPriceCents: number;
  const q = (text: string, params?: unknown[]) => (db as any).client.query(text, params);

  async function list(limit?: string) {
    return request(app.getHttpServer())
      .get(`/admin/dashboard/clientes-recentes${limit === undefined ? '' : `?limit=${limit}`}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin Dash Clientes');
    tenantA = await db.createTenantWithUser('Empresa Recentes A');

    const plan = await q(`SELECT id, name, price_cents FROM plans WHERE audience = 'empresa' LIMIT 1`);
    planName = plan.rows[0].name;
    planPriceCents = plan.rows[0].price_cents;
    const sub = await q(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'authorized', $3) RETURNING id`,
      [plan.rows[0].id, tenantA.tenantId, `${RUN}-preapproval`],
    );
    subscriptionId = sub.rows[0].id;

    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    // O login real da empresa A grava um `login_success` em audit_log (o
    // teste não escreve nessa tabela — ela é append-only por desenho).
    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.email, password: tenantA.password });
    tokenEmpresa = loginEmpresa.body.access_token;

    tenantB = await db.createTenantWithUser('Empresa Recentes B');
  });

  afterAll(async () => {
    await q('DELETE FROM subscriptions WHERE id = $1', [subscriptionId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('exige autenticação e bloqueia empresa', async () => {
    const semToken = await request(app.getHttpServer()).get('/admin/dashboard/clientes-recentes');
    expect(semToken.status).toBe(401);
    const empresa = await request(app.getHttpServer())
      .get('/admin/dashboard/clientes-recentes')
      .set('Authorization', `Bearer ${tokenEmpresa}`);
    expect(empresa.status).toBe(403);
  });

  it('empresa sem assinatura e sem login: plano do tenant, MRR e último acesso nulos', async () => {
    const res = await list('20');
    expect(res.status).toBe(200);
    const b = res.body.find((r: any) => r.id === tenantB.tenantId);
    expect(b).toBeDefined();
    expect(b.nome).toMatch(/^Empresa Recentes B/);
    expect(b.status).toBe('ativo');
    expect(b.plano).toBe('trial');
    expect(b.mrr_cents).toBeNull();
    expect(b.ultimo_acesso).toBeNull();
    expect(new Date(b.created_at).toString()).not.toBe('Invalid Date');
  });

  it('empresa com assinatura autorizada e login: plano, MRR e último acesso', async () => {
    const a = await waitFor(async () => {
      const res = await list('20');
      const row = res.body.find((r: any) => r.id === tenantA.tenantId);
      return row?.ultimo_acesso ? row : null;
    });
    expect(a).not.toBeNull();
    expect(a.plano).toBe(planName);
    expect(a.mrr_cents).toBe(planPriceCents);
    expect(new Date(a.ultimo_acesso).toString()).not.toBe('Invalid Date');
  });

  it('ordena da mais nova para a mais antiga', async () => {
    const res = await list('20');
    const idx = (id: string) => res.body.findIndex((r: any) => r.id === id);
    expect(idx(tenantB.tenantId)).toBeGreaterThanOrEqual(0);
    expect(idx(tenantA.tenantId)).toBeGreaterThanOrEqual(0);
    expect(idx(tenantB.tenantId)).toBeLessThan(idx(tenantA.tenantId));
  });

  it('respeita limit: padrão 5, máximo 20, inválido cai em 5', async () => {
    expect((await list()).body.length).toBeLessThanOrEqual(5);
    expect((await list('2')).body.length).toBeLessThanOrEqual(2);
    expect((await list('999')).body.length).toBeLessThanOrEqual(20);
    expect((await list('abc')).body.length).toBeLessThanOrEqual(5);
    expect((await list('0')).body.length).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `"$SCRATCH/run-net.sh" test:e2e -- admin-dashboard-clientes-recentes`
Expected: FAIL — `expected 200, received 404`.

- [ ] **Step 3: Implementar**

Modify `backend/src/admin-dashboard/admin-dashboard.service.ts`:

(a) Adicionar depois da interface `FinanceiroResponse`:

```ts
export interface ClienteRecente {
  id: string;
  nome: string;
  plano: string;
  status: string;
  mrr_cents: number | null;
  ultimo_acesso: string | null;
  created_at: string;
}
```

(b) Adicionar dentro da classe, antes de `private async countPaymentAlerts`:

```ts
  // "Último acesso" vem de audit_log (login_success), não de
  // users.last_login_at — essa coluna existe no schema mas nenhum código a
  // grava. LATERAL + LIMIT: o custo cresce com `limit`, não com a base.
  async getClientesRecentes(client: PoolClient, limit: number): Promise<ClienteRecente[]> {
    const result = await client.query<ClienteRecente>(
      `SELECT t.id, t.name AS nome, t.status::text AS status, t.created_at,
              COALESCE(sub.plan_name, t.plan) AS plano,
              sub.price_cents AS mrr_cents,
              acesso.ultimo_acesso
       FROM tenants t
       LEFT JOIN LATERAL (
         SELECT p.name AS plan_name, p.price_cents
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
         WHERE s.tenant_id = t.id AND s.status = 'authorized'
         ORDER BY s.created_at DESC
         LIMIT 1
       ) sub ON true
       LEFT JOIN LATERAL (
         SELECT max(al.occurred_at) AS ultimo_acesso
         FROM audit_log al
         WHERE al.actor_tenant_id = t.id AND al.action = 'login_success'
       ) acesso ON true
       ORDER BY t.created_at DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows;
  }
```

Modify `backend/src/admin-dashboard/admin-dashboard.controller.ts`: adicionar antes da classe

```ts
function parseLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return Math.min(parsed, 20);
}
```

e dentro da classe, depois de `getFinanceiro`:

```ts
  @Roles('admin')
  @Get('clientes-recentes')
  getClientesRecentes(@Query('limit') limit: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: PoolClient) =>
      this.dashboard.getClientesRecentes(client, parseLimit(limit)),
    );
  }
```

- [ ] **Step 4: Checar tipos e rodar os e2e do módulo**

Run: `cd /opt/Montese/backend && npx tsc --noEmit -p tsconfig.json` → sem erros.
Run: `"$SCRATCH/run-net.sh" test:e2e -- admin-dashboard` → PASS nos 3 arquivos (`alertas`, `financeiro`, `clientes-recentes`).

- [ ] **Step 5: Commit**

```bash
cd /opt/Montese && git add backend/src/admin-dashboard/admin-dashboard.service.ts backend/src/admin-dashboard/admin-dashboard.controller.ts backend/test/admin-dashboard-clientes-recentes.e2e-spec.ts && git diff --cached --stat && git commit -m "$(cat <<'EOF'
feat: endpoint GET /admin/dashboard/clientes-recentes (plano, MRR e último acesso por login)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarefa 5: Harness de QA, dev server e `company.ts` (CNPJ/endereço nos rodapés e nos textos legais)

**Files:**
- Create: `frontend/src/lib/company.ts`
- Modify: `frontend/src/lib/legal.ts`
- Modify: `frontend/content/legal/termos.mdx`, `frontend/content/legal/privacidade.mdx`
- Modify: `frontend/src/components/SiteFooter.tsx`, `frontend/src/components/DashboardFooter.tsx`
- Scratch (**não commitar**): `$SCRATCH/qa/fixtures.mjs`, `$SCRATCH/qa/shots.mjs`

**Interfaces:**
- Produces (usados nas Tarefas 6, 8 e 14):
  - `company.ts`: `interface CompanyInfo { nomeFantasia: string; razaoSocial: string | null; cnpj: string; endereco: { logradouro: string; numero: string; bairro: string; municipio: string; uf: string; cep: string } }`; `export const company: CompanyInfo`; `formatAddress(): string`; `formatIdentification(): string`; `fillCompanyTokens(text: string): string` (substitui o token `[[EMPRESA_IDENTIFICACAO]]`).
  - Harness: `node $SCRATCH/qa/shots.mjs <cenario> <pastaSaida> <rotas,separadas,por,virgula> [viewports]` — cenários `cheio | vazio | degradado | erro`, viewports `desktop,tablet,mobile` (1440/820/390 px); imprime erros de console de cada página. Dev server em `http://localhost:3100`.

- [ ] **Step 1: Montar o harness de QA (scratchpad, sem commit)**

```bash
cd "$SCRATCH/qa"
# Reaproveita Playwright 1.48 + sharp 0.33 de uma sessão anterior (o Chromium 1140 já está em ~/.cache/ms-playwright).
ln -sfn /tmp/claude-0/-opt-Montese/045aa16f-802b-4ff3-9680-9a954e1f428b/scratchpad/node_modules node_modules
node -e "require('playwright'); require('sharp'); console.log('playwright+sharp ok')"
```

Se falhar: `cd "$SCRATCH/qa" && rm -f node_modules && npm init -y >/dev/null && npm install playwright@1.48 sharp@0.33` (versões mais novas exigem outro Node). Se o Chromium reclamar de biblioteca do sistema, instale só as libs (`libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libxdamage1 libasound2t64 libatspi2.0-0t64`) com `apt-get` — nada de Docker.

Create `$SCRATCH/qa/fixtures.mjs`:

```js
// QA visual do admin — respostas interceptadas pelo Playwright. NADA aqui é dado
// real e NADA daqui vai para o repositório: são fixtures para renderizar telas
// e estados (cheio, vazio, degradado, erro) sem login e sem banco.
const DAY = 86_400_000;
const ok = (body) => ({ status: 200, body });
const isoAgo = (min) => new Date(Date.now() - min * 60_000).toISOString();
const ymdUtc = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);
const ymdSp = (d) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + d * DAY));

const overview = {
  empresas_ativas: 12, tecnicos_vinculados: 5, parceiros_vinculados: 3, inspecoes_no_mes: 18,
  documentos_vencendo: 7, epis_vencendo: 4, assinaturas_ativas: 9, receita_mensal_cents: 642300,
  planos_acao_pendentes: 11,
};
const overviewVazio = Object.fromEntries(Object.keys(overview).map((k) => [k, 0]));

const systemStatus = (degradado) => ({
  memory: { total_gb: 15.6, free_gb: degradado ? 0.4 : 7.2, used_percent: degradado ? 97.4 : 53.8 },
  cpu: { cores: 4, load_avg_1m: 1.24, load_avg_5m: 0.98, load_avg_15m: 0.85 },
  disk: { total_gb: 193.4, free_gb: degradado ? 12.1 : 101.2, used_percent: degradado ? 93.7 : 47.7 },
  services: {
    postgres: { reachable: true, active_connections: 9 },
    redis: { reachable: !degradado },
    frontend: { reachable: true },
  },
});

const openrouter = {
  configured: true, provider: 'openrouter', is_free_tier: false, total_credits: 20, total_usage: 7.41,
  usage_monthly: 1.93, low_balance_warning: false, dashboard_url: 'https://openrouter.ai/credits',
};

// last_7_days sem dias ausentes preenchidos, como o endpoint real (ontem falta).
const miniMax = (vazio) => ({
  total_calls: vazio ? 0 : 412,
  total_tokens: vazio ? 0 : 3_820_000,
  by_capability: vazio ? [] : [
    { capability: 'assistente', calls: 230, prompt_tokens: 1_500_000, completion_tokens: 600_000, total_tokens: 2_100_000 },
    { capability: 'pente-fino', calls: 120, prompt_tokens: 900_000, completion_tokens: 300_000, total_tokens: 1_200_000 },
    { capability: 'checklist', calls: 62, prompt_tokens: 380_000, completion_tokens: 140_000, total_tokens: 520_000 },
  ],
  last_7_days: vazio ? [] : [-6, -5, -3, 0].map((d, i) => ({ date: ymdUtc(d), total_tokens: [180_000, 240_000, 310_000, 95_000][i] })),
});

function financeiro(dias, vazio) {
  const serie = Array.from({ length: dias }, (_, i) => {
    const cobrado = vazio ? 0 : Math.round(60_000 + 45_000 * Math.sin(i / 3) + (i % 5) * 9_000);
    return { data: ymdSp(-(dias - 1 - i)), cobrado_cents: cobrado, aprovado_cents: Math.round(cobrado * 0.84) };
  });
  const z = { cobrado_cents: 0, aprovado_cents: 0, pendente_cents: 0 };
  return {
    periodo_dias: dias,
    serie,
    hoje: vazio ? z : { cobrado_cents: 148_700, aprovado_cents: 132_500, pendente_cents: 16_200 },
    mes: vazio
      ? { ...z, recusado_cents: 0 }
      : { cobrado_cents: 4_123_000, aprovado_cents: 3_921_000, pendente_cents: 162_000, recusado_cents: 40_000 },
    recentes: vazio ? [] : [
      { id: 'p1', mercadopago_payment_id: '1001', amount_cents: 79_700, status: 'approved', occurred_at: isoAgo(35), cliente: 'Metalúrgica ABC', plano: 'Premium' },
      { id: 'p2', mercadopago_payment_id: '1002', amount_cents: 39_700, status: 'approved', occurred_at: isoAgo(120), cliente: 'Construtora Silva', plano: 'Start' },
      { id: 'p3', mercadopago_payment_id: '1003', amount_cents: 129_700, status: 'pending', occurred_at: isoAgo(600), cliente: 'Indústria Beta', plano: 'Super Premium' },
      { id: 'p4', mercadopago_payment_id: '1004', amount_cents: 79_700, status: 'rejected', occurred_at: isoAgo(1500), cliente: 'Logística Prime', plano: 'Premium' },
      { id: 'p5', mercadopago_payment_id: '1005', amount_cents: 9_900, status: 'approved', occurred_at: isoAgo(2900), cliente: null, plano: null },
    ],
  };
}

const alertas = (cenario) =>
  cenario === 'vazio'
    ? { gerado_em: isoAgo(0), contagem: { critico: 0, atencao: 0, info: 0 }, itens: [] }
    : cenario === 'degradado'
      ? {
          gerado_em: isoAgo(0), contagem: { critico: 2, atencao: 2, info: 1 },
          itens: [
            { id: 'redis_down', severidade: 'critico', titulo: 'Redis inacessível', detalhe: 'O Redis não respondeu ao ping.', href: '/admin/overview' },
            { id: 'disk_high', severidade: 'critico', titulo: 'Disco em 94%', detalhe: 'Libere espaço ou amplie o disco da VPS antes que chegue a 100%.', href: '/admin/overview' },
            { id: 'ram_high', severidade: 'atencao', titulo: 'Memória em 97%', detalhe: 'Uso de RAM acima do normal na VPS.', href: '/admin/overview' },
            { id: 'payments_rejected', severidade: 'atencao', titulo: '2 cobranças recusadas nos últimos 7 dias', detalhe: 'Confira as assinaturas afetadas em Financeiro.', href: '/admin/financeiro' },
            { id: 'documents_expiring', severidade: 'info', titulo: '7 documentos vencem em 30 dias', detalhe: 'Somando todas as empresas.', href: '/admin/empresas' },
          ],
        }
      : {
          gerado_em: isoAgo(0), contagem: { critico: 0, atencao: 1, info: 1 },
          itens: [
            { id: 'payments_pending_stale', severidade: 'atencao', titulo: '1 cobrança pendente há mais de 3 dias', detalhe: 'O Mercado Pago não confirmou nem recusou essas cobranças.', href: '/admin/financeiro' },
            { id: 'documents_expiring', severidade: 'info', titulo: '7 documentos vencem em 30 dias', detalhe: 'Somando todas as empresas.', href: '/admin/empresas' },
          ],
        };

const clientes = [
  { id: 'c1', nome: 'Metalúrgica ABC', plano: 'Premium', status: 'ativo', mrr_cents: 79_700, ultimo_acesso: isoAgo(25), created_at: isoAgo(60 * 24 * 2) },
  { id: 'c2', nome: 'Construtora Silva', plano: 'Start', status: 'ativo', mrr_cents: 39_700, ultimo_acesso: isoAgo(60 * 20), created_at: isoAgo(60 * 24 * 5) },
  { id: 'c3', nome: 'Indústria Beta', plano: 'Super Premium', status: 'pendente', mrr_cents: 129_700, ultimo_acesso: null, created_at: isoAgo(60 * 24 * 9) },
  { id: 'c4', nome: 'Logística Prime', plano: 'trial', status: 'ativo', mrr_cents: null, ultimo_acesso: isoAgo(60 * 50), created_at: isoAgo(60 * 24 * 12) },
];

const auditLog = [
  [201, 'create', 'technicians', 'POST', '/technicians', '187.10.1.23'],
  [200, 'login_success', 'auth', 'POST', '/auth/login', '187.10.1.23'],
  [401, 'login_failure', 'auth', 'POST', '/auth/login', '177.22.4.90'],
  [500, 'update', 'subscriptions', 'PATCH', '/subscriptions/1/status', '187.10.1.23'],
  [200, 'update', 'plans', 'PATCH', '/plans/2', '187.10.1.23'],
  [403, 'read', 'tenants', 'GET', '/tenants', '201.8.44.7'],
  [201, 'create', 'documents', 'POST', '/documents', '187.10.1.23'],
  [200, 'login_success', 'auth', 'POST', '/auth/login', '187.10.1.23'],
].map(([status_code, action, resource_type, method, path, ip_address], i) => ({
  id: `a${i}`, occurred_at: isoAgo(6 + i * 47), actor_user_id: null, actor_full_name: 'Admin QA', actor_role: 'admin',
  actor_tenant_id: null, actor_tenant_name: null, action, resource_type, resource_id: null, method, path,
  status_code, ip_address, detail: 'ignorado pelo card',
}));

const plans = [
  { id: 'pl1', audience: 'empresa', slug: 'empresa-start', name: 'Start', price_cents: 39_700, employee_limit: 10 },
  { id: 'pl2', audience: 'empresa', slug: 'empresa-premium', name: 'Premium', price_cents: 79_700, employee_limit: 50 },
  { id: 'pl3', audience: 'empresa', slug: 'empresa-super-premium', name: 'Super Premium', price_cents: 129_700, employee_limit: 200 },
  { id: 'pl4', audience: 'empresa', slug: 'empresa-enterprise', name: 'Enterprise', price_cents: 500_000, employee_limit: null },
  { id: 'pl5', audience: 'tecnico', slug: 'tecnico-start', name: 'Start Técnico', price_cents: 9_900, employee_limit: null },
];
const subscriptions = [
  { id: 's1', status: 'authorized', created_at: isoAgo(60 * 24 * 20), plan_name: 'Premium', price_cents: 79_700, tenant_name: 'Metalúrgica ABC', technician_name: null },
  { id: 's2', status: 'paused', created_at: isoAgo(60 * 24 * 40), plan_name: 'Start', price_cents: 39_700, tenant_name: 'Construtora Silva', technician_name: null },
];
const tenants = clientes.map((c) => ({ id: c.id, name: c.nome, cnpj: '11222333000181', plan: c.plano, status: c.status, technicians: [{ id: 't1', name: 'Técnico QA' }], partners: [] }));

export function respond(cenario, pathname, params) {
  if (cenario === 'erro') return { status: 500, body: { message: 'erro simulado' } };
  const vazio = cenario === 'vazio';
  switch (pathname) {
    case '/api/overview': return ok(vazio ? overviewVazio : overview);
    case '/api/system-status': return ok(systemStatus(cenario === 'degradado'));
    case '/api/ai-copilot/usage':
      return ok(vazio ? { configured: false, provider: 'openrouter', dashboard_url: 'https://openrouter.ai/credits' } : openrouter);
    case '/api/admin/ai-usage': return ok(miniMax(vazio));
    case '/api/admin/dashboard/financeiro': {
      const dias = Number(params.get('dias'));
      return ok(financeiro([7, 30, 90].includes(dias) ? dias : 30, vazio));
    }
    case '/api/admin/dashboard/clientes-recentes': return ok(vazio ? [] : clientes);
    case '/api/admin/dashboard/alertas': return ok(alertas(cenario));
    case '/api/audit-log': return ok(vazio ? [] : auditLog);
    case '/api/plans': return ok(plans);
    case '/api/subscriptions': return ok(vazio ? [] : subscriptions);
    case '/api/tenants': return ok(vazio ? [] : tenants);
    default: return ok([]);
  }
}
```

Create `$SCRATCH/qa/shots.mjs`:

```js
// Uso: node shots.mjs <cenario> <pastaSaida> <rotas,separadas,por,virgula> [desktop,tablet,mobile]
// Variáveis opcionais (interação antes da captura):
//   QA_CLICK='seletor css'   clica no elemento      QA_KEYS='Control+k'   pressiona a tecla/combinação
//   QA_TYPE='texto'          digita texto           QA_FULLPAGE=0         captura só a viewport (drawer/paleta)
//   QA_TAG='drawer'          sufixo no nome do arquivo (evita sobrescrever)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { respond } from './fixtures.mjs';

const [cenario = 'cheio', outDir = './out', rotasArg = '/admin/overview', vpArg = 'desktop,tablet,mobile'] =
  process.argv.slice(2);
const BASE = process.env.QA_BASE ?? 'http://localhost:3100';
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1100 },
  mobile: { width: 390, height: 844 },
};

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
for (const vp of vpArg.split(',')) {
  const context = await browser.newContext({ viewport: VIEWPORTS[vp] });
  await context.addInitScript(() => {
    localStorage.setItem('montese_token', 'qa-token-fixture');
    localStorage.setItem('montese_user', JSON.stringify({ id: 'qa', role: 'admin', tenantId: null }));
  });
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const { status, body } = respond(cenario, url.pathname, url.searchParams);
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  for (const rota of rotasArg.split(',')) {
    const page = await context.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') erros.push(`console: ${m.text()}`); });
    await page.goto(BASE + rota, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    // rolagem incremental para acionar imagens lazy, e volta ao topo
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 40));
      }
      window.scrollTo(0, 0);
    });
    if (process.env.QA_CLICK) await page.click(process.env.QA_CLICK);
    if (process.env.QA_KEYS) await page.keyboard.press(process.env.QA_KEYS);
    if (process.env.QA_TYPE) await page.keyboard.type(process.env.QA_TYPE);
    if (process.env.QA_CLICK || process.env.QA_KEYS || process.env.QA_TYPE) await page.waitForTimeout(400);
    const tag = process.env.QA_TAG ? `-${process.env.QA_TAG}` : '';
    const nome = `${cenario}-${vp}-${rota.replace(/[^a-z0-9]+/gi, '_')}${tag}.png`;
    await page.screenshot({ path: `${outDir}/${nome}`, fullPage: process.env.QA_FULLPAGE !== '0' });
    console.log(nome, erros.length ? `\n  ${erros.join('\n  ')}` : '(sem erros de console)');
    await page.close();
  }
  await context.close();
}
await browser.close();
```

- [ ] **Step 2: Subir o dev server do frontend (fica de pé até a Tarefa 14)**

```bash
cd /opt/Montese/frontend
(npx next dev -p 3100 > "$SCRATCH/next-dev.log" 2>&1 & echo $! > "$SCRATCH/next-dev.pid")
timeout 180 bash -c 'until curl -sf -o /dev/null http://localhost:3100/termos; do sleep 2; done' && echo "dev server no ar"
```

Lembrete: **não rode `next build`** enquanto ele estiver de pé. Se a porta 3100 estiver ocupada, use outra e exporte `QA_BASE=http://localhost:<porta>`.

- [ ] **Step 3: Criar `frontend/src/lib/company.ts`**

```ts
// Fonte única dos dados cadastrais públicos da Montese SST. Forneceu o
// fundador em 2026-09-21. Onde cada dado aparece (decisão do fundador):
//  - CNPJ: só em rodapés e telas de pagamento;
//  - endereço comercial: só nos documentos legais (Termos e Privacidade).
// A razão social ainda NÃO foi informada — nunca inventar: enquanto for
// `null`, os textos legais mostram o placeholder explícito abaixo.
export interface CompanyInfo {
  nomeFantasia: string;
  razaoSocial: string | null;
  cnpj: string;
  endereco: {
    logradouro: string;
    numero: string;
    bairro: string;
    municipio: string;
    uf: string;
    cep: string;
  };
}

export const company: CompanyInfo = {
  nomeFantasia: 'Montese SST',
  razaoSocial: null,
  cnpj: '69.203.754/0001-45',
  endereco: {
    logradouro: 'Avenida Marcolino Martins Cabral',
    numero: '2644',
    bairro: 'Aeroporto',
    municipio: 'Tubarão',
    uf: 'SC',
    cep: '88705-004',
  },
};

const RAZAO_SOCIAL_PENDENTE = '[RAZÃO SOCIAL — PREENCHER]';

export function formatAddress(): string {
  const e = company.endereco;
  return `${e.logradouro}, nº ${e.numero}, Bairro ${e.bairro}, ${e.municipio}/${e.uf}, CEP ${e.cep}`;
}

export function formatIdentification(): string {
  const razao = company.razaoSocial ?? RAZAO_SOCIAL_PENDENTE;
  return `${razao}, inscrita no CNPJ sob o nº ${company.cnpj}, com endereço comercial na ${formatAddress()}`;
}

// Os documentos em content/legal/*.mdx usam este token onde vai a
// identificação do controlador; getLegalDoc o substitui antes de compilar o MDX.
export function fillCompanyTokens(text: string): string {
  return text.replaceAll('[[EMPRESA_IDENTIFICACAO]]', formatIdentification());
}
```

- [ ] **Step 4: Ligar o token em `lib/legal.ts` e nos MDX**

Modify `frontend/src/lib/legal.ts`: adicionar `import { fillCompanyTokens } from './company';` depois do import de `matter` e trocar o `return` de `getLegalDoc` por:

```ts
  return { title: data.title, updatedAt: data.updatedAt, content: fillCompanyTokens(content) };
```

Ver o front matter dos dois MDX:

```bash
cd /opt/Montese/frontend/content/legal && sed -n 1,6p termos.mdx && sed -n 1,6p privacidade.mdx
```

Em `termos.mdx` (linhas ~17–18) trocar

```
A plataforma é oferecida pela Montese SST
([RAZÃO SOCIAL/CNPJ — PREENCHER]).
```

por

```
A plataforma é oferecida pela Montese SST
([[EMPRESA_IDENTIFICACAO]]).
```

Em `privacidade.mdx` (linha ~13) trocar `A Montese SST ([RAZÃO SOCIAL/CNPJ — PREENCHER]) oferece uma plataforma` por `A Montese SST ([[EMPRESA_IDENTIFICACAO]]) oferece uma plataforma`.

Nos dois arquivos, mudar `updatedAt` no front matter para `2026-09-21` (o texto mudou de fato). **Não** mexer na cláusula de foro (`[CIDADE/ESTADO — PREENCHER]`, linha ~103 de `termos.mdx`): é decisão jurídica do fundador.

- [ ] **Step 5: CNPJ nos rodapés**

Modify `frontend/src/components/SiteFooter.tsx`: adicionar `import { company } from '@/lib/company';` depois de `import Image from 'next/image';` e trocar

```tsx
          <p className="text-xs text-brand-100">montesesst.com.br</p>
```

por

```tsx
          <p className="text-xs text-brand-100">{`CNPJ ${company.cnpj} · montesesst.com.br`}</p>
```

Modify `frontend/src/components/DashboardFooter.tsx`: adicionar na primeira linha `import { company } from '@/lib/company';` (linha em branco depois) e trocar

```tsx
        <p>&copy; {new Date().getFullYear()} Montese SST. Todos os direitos reservados.</p>
```

por

```tsx
        <p>{`© ${new Date().getFullYear()} Montese SST · CNPJ ${company.cnpj}. Todos os direitos reservados.`}</p>
```

(O template string mantém o texto em **um** nó, sem comentários `<!-- -->` do React no HTML — útil para os `grep` abaixo.)

- [ ] **Step 6: Verificar**

```bash
cd /opt/Montese/frontend && npx tsc --noEmit && echo "tipos ok"
for p in termos privacidade contato planos; do
  echo "== /$p: CNPJ=$(curl -s http://localhost:3100/$p | grep -o '69.203.754/0001-45' | wc -l) endereço=$(curl -s http://localhost:3100/$p | grep -c 'Marcolino Martins Cabral')"
done
curl -s http://localhost:3100/termos | grep -o '\[RAZÃO SOCIAL — PREENCHER\]\|\[CIDADE/ESTADO — PREENCHER\]' | sort | uniq -c
```

Expected: `termos` e `privacidade` com CNPJ ≥ 2 (corpo + rodapé) e endereço = 1; `contato` e `planos` com CNPJ = 1 (só o rodapé) e **endereço = 0**; os dois placeholders (`RAZÃO SOCIAL — PREENCHER` e `CIDADE/ESTADO — PREENCHER`) ainda presentes em `/termos`.

- [ ] **Step 7: Commit** (o harness fica de fora — vive no scratchpad)

```bash
cd /opt/Montese && git status --short | grep -E "lib/company|lib/legal|content/legal|SiteFooter|DashboardFooter" && git add frontend/src/lib/company.ts frontend/src/lib/legal.ts frontend/content/legal/termos.mdx frontend/content/legal/privacidade.mdx frontend/src/components/SiteFooter.tsx frontend/src/components/DashboardFooter.tsx && git diff --cached --stat && git commit -m "$(cat <<'EOF'
feat: CNPJ nos rodapés e endereço comercial nos documentos legais (fonte única em lib/company)

Razão social e foro seguem como placeholders explícitos até o fundador informar.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarefa 6: CNPJ nas telas de pagamento e no Financeiro do admin

**Files:**
- Create: `frontend/src/components/PaymentIssuerNote.tsx`
- Modify: `frontend/src/app/(site)/planos/page.tsx` (limpo)
- Modify: `frontend/src/app/admin/financeiro/page.tsx` (limpo)
- Modify: `frontend/src/app/(site)/tecnico/planos/page.tsx` (**tem mudanças não commitadas do fundador**)
- Modify: `frontend/src/app/(site)/planos/assinatura-concluida/page.tsx` (**idem**)
- Scratch: `$SCRATCH/stage_edit.py`

**Interfaces:**
- Consumes: `company` (`lib/company.ts`, Tarefa 5).
- Produces: `PaymentIssuerNote({ className?: string })` — renderiza `Pagamento processado pelo Mercado Pago · Montese SST · CNPJ 69.203.754/0001-45`.

- [ ] **Step 1: Criar o componente**

Create `frontend/src/components/PaymentIssuerNote.tsx`:

```tsx
import { company } from '@/lib/company';

// Identifica quem recebe o pagamento. Só o CNPJ — o endereço comercial fica
// restrito aos documentos legais (decisão do fundador).
export function PaymentIssuerNote({ className = '' }: { className?: string }) {
  return (
    <p className={`text-center text-xs text-brand-700 ${className}`}>
      {`Pagamento processado pelo Mercado Pago · ${company.nomeFantasia} · CNPJ ${company.cnpj}`}
    </p>
  );
}
```

- [ ] **Step 2: Criar o helper que faz stage só da edição (protege o WIP do fundador)**

Create `$SCRATCH/stage_edit.py`:

```python
"""Aplica edições ancoradas em um arquivo E na versão do HEAD, e faz stage só
de HEAD+edição — sem levar para o commit mudanças não commitadas do fundador.

Uso:  from stage_edit import stage_edit
      stage_edit('caminho/relativo.tsx', [dict(anchor='...', insert='...', where='after')])

where: 'before' | 'after' | 'replace'. Cada âncora precisa aparecer EXATAMENTE
1x no arquivo de trabalho e no HEAD; senão aborta sem escrever nada.
"""
import subprocess

REPO = '/opt/Montese'


def _apply(text, edits):
    for e in edits:
        anchor, insert, where = e['anchor'], e['insert'], e['where']
        n = text.count(anchor)
        if n != 1:
            raise SystemExit(f"âncora deve aparecer 1x, apareceu {n}x: {anchor[:70]!r}")
        if where == 'before':
            text = text.replace(anchor, insert + anchor)
        elif where == 'after':
            text = text.replace(anchor, anchor + insert)
        elif where == 'replace':
            text = text.replace(anchor, insert)
        else:
            raise SystemExit(f'where inválido: {where}')
    return text


def stage_edit(path, edits):
    full = f'{REPO}/{path}'
    work = open(full, encoding='utf-8').read()
    head = subprocess.run(['git', 'show', f'HEAD:{path}'], cwd=REPO, check=True,
                          capture_output=True).stdout.decode('utf-8')
    new_work, new_head = _apply(work, edits), _apply(head, edits)  # valida as duas antes de escrever
    open(full, 'w', encoding='utf-8').write(new_work)
    blob = subprocess.run(['git', 'hash-object', '-w', '--stdin'], cwd=REPO, check=True,
                          input=new_head.encode('utf-8'), capture_output=True).stdout.decode().strip()
    mode = subprocess.run(['git', 'ls-files', '-s', '--', path], cwd=REPO, check=True,
                          capture_output=True).stdout.decode().split()[0]
    subprocess.run(['git', 'update-index', '--cacheinfo', f'{mode},{blob},{path}'], cwd=REPO, check=True)
    print('ok:', path)
```

- [ ] **Step 3: Aplicar nos dois arquivos com mudança do fundador**

```bash
cd "$SCRATCH" && python3 - <<'EOF'
import sys; sys.path.insert(0, '.')
from stage_edit import stage_edit

stage_edit('frontend/src/app/(site)/planos/assinatura-concluida/page.tsx', [
    dict(anchor="import Link from 'next/link';\n", where='after',
         insert="import { PaymentIssuerNote } from '@/components/PaymentIssuerNote';\n"),
    dict(anchor="          Entrar\n        </Link>\n", where='after',
         insert='        <PaymentIssuerNote className="mt-8" />\n'),
])

stage_edit('frontend/src/app/(site)/tecnico/planos/page.tsx', [
    dict(anchor="import Link from 'next/link';\n", where='after',
         insert="import { PaymentIssuerNote } from '@/components/PaymentIssuerNote';\n"),
    dict(anchor="                Entrar para assinar\n              </Link>\n            )}\n", where='after',
         insert='            <PaymentIssuerNote className="mt-4" />\n'),
])
EOF
```

Se aparecer `âncora deve aparecer 1x, apareceu 0x`: o arquivo do fundador (ou o HEAD) difere do esperado. **Não force.** Edite só a cópia de trabalho com o Edit tool (mesmas linhas), **não** faça stage desse arquivo e registre no relatório final que a edição ficou sem commit.

Conferir que o stage levou **só** as linhas novas e que o WIP do fundador continua no working tree:

```bash
cd /opt/Montese
git diff --cached --stat -- "frontend/src/app/(site)/tecnico/planos/page.tsx" "frontend/src/app/(site)/planos/assinatura-concluida/page.tsx"   # esperado: poucas linhas (2 arquivos, ~+3 cada)
git diff --stat -- "frontend/src/app/(site)/tecnico/planos/page.tsx" "frontend/src/app/(site)/planos/assinatura-concluida/page.tsx"          # esperado: ainda mostra as mudanças do fundador (não vazio)
```

- [ ] **Step 4: Aplicar nos dois arquivos limpos**

Em `frontend/src/app/(site)/planos/page.tsx`: adicionar `import { PaymentIssuerNote } from '@/components/PaymentIssuerNote';` logo depois do último `import` do arquivo (`sed -n 1,10p` para ver) e trocar

```tsx
        <div className="mx-auto max-w-4xl px-4 pb-12">
          <h2 className="text-center text-[24px] font-extrabold text-brand-900">
            O Assistente Montese SST está em todos os planos.
```

por

```tsx
        <PaymentIssuerNote className="mx-auto max-w-4xl px-4 pb-10" />

        <div className="mx-auto max-w-4xl px-4 pb-12">
          <h2 className="text-center text-[24px] font-extrabold text-brand-900">
            O Assistente Montese SST está em todos os planos.
```

Em `frontend/src/app/admin/financeiro/page.tsx`: adicionar `import { company } from '@/lib/company';` depois do último `import` e trocar

```tsx
      <h2 className="text-xl font-bold text-brand-900">Financeiro</h2>
```

por

```tsx
      <h2 className="text-xl font-bold text-brand-900">Financeiro</h2>
      <p className="mt-1 text-sm text-brand-700">{`Recebedor: ${company.nomeFantasia} · CNPJ ${company.cnpj}`}</p>
```

- [ ] **Step 5: Verificar**

```bash
cd /opt/Montese/frontend && npx tsc --noEmit && echo "tipos ok"
for p in planos planos/assinatura-concluida; do
  echo "== /$p: CNPJ=$(curl -s http://localhost:3100/$p | grep -o '69.203.754/0001-45' | wc -l) endereço=$(curl -s http://localhost:3100/$p | grep -c 'Marcolino')"
done
node "$SCRATCH/qa/shots.mjs" cheio "$SCRATCH/qa/out" /tecnico/planos,/admin/financeiro desktop
```

Expected: `planos` e `assinatura-concluida` com CNPJ = 2 (rodapé + nota) e endereço = 0. Abra `$SCRATCH/qa/out/cheio-desktop-_tecnico_planos.png` com a ferramenta Read e confirme a nota dentro do card do plano, sem quebrar o layout. `_admin_financeiro.png` mostra "Recebedor: …" sob o título (ainda no tema claro — o tema escuro vem na Tarefa 8).

- [ ] **Step 6: Commit**

```bash
cd /opt/Montese && git add frontend/src/components/PaymentIssuerNote.tsx "frontend/src/app/(site)/planos/page.tsx" frontend/src/app/admin/financeiro/page.tsx && git diff --cached --stat && git commit -m "$(cat <<'EOF'
feat: CNPJ do recebedor nas telas de pagamento e no Financeiro do admin

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)" && git status --short | grep -E "tecnico/planos|assinatura-concluida"   # devem continuar " M" (WIP do fundador preservado)
```

(O `git commit` leva também as duas páginas do fundador **como estavam no stage do Step 3** — HEAD + só as linhas da nota. As mudanças do fundador continuam só no working tree.)

---

## Tarefa 7: Logo do painel — ícone recortado e `AdminBrand`

**Files:**
- Create: `frontend/public/brand/logo-icon-mark.png`
- Create: `frontend/src/components/admin/AdminBrand.tsx`
- Scratch: `$SCRATCH/qa/make-logo-mark.cjs`

**Interfaces:**
- Produces: `AdminBrand({ compact?: boolean })` — logo (ícone + "MONTESE" / "CONTROL" / "Centro de comando da Montese") com link para `/admin/overview`; usado pela sidebar (Tarefa 8).

- [ ] **Step 1: Gerar o PNG do ícone (fundo transparente)**

Create `$SCRATCH/qa/make-logo-mark.cjs`:

```js
// Gera frontend/public/brand/logo-icon-mark.png a partir de logo-horizontal.jpg:
// recorta o ícone (montanha + escudo), remove o fundo branco ligado às bordas
// (flood fill) e converte a franja de anti-aliasing em transparência parcial
// ("color to alpha"), para não deixar halo claro sobre o marinho do painel.
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SRC = '/opt/Montese/frontend/public/brand/logo-horizontal.jpg';
const OUT = '/opt/Montese/frontend/public/brand/logo-icon-mark.png';
const PREVIEW = path.join(__dirname, 'out', 'logo-preview-on-navy.png');
const ICON_MAX_X = 705; // a linha vertical divisória do logo fica em x≈712
const BG_MIN = 225; // canal mínimo a partir do qual o pixel conta como fundo branco
const BAND = 2; // largura (px) da franja tratada por color-to-alpha

(async () => {
  fs.mkdirSync(path.dirname(PREVIEW), { recursive: true });
  const meta = await sharp(SRC).metadata();
  const { data, info } = await sharp(SRC)
    .extract({ left: 0, top: 0, width: Math.min(ICON_MAX_X, meta.width), height: meta.height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const idx = (x, y) => (y * W + x) * 3;
  const minCh = (i) => Math.min(data[i], data[i + 1], data[i + 2]);

  // 1) fundo = pixels quase brancos conectados à borda
  const bg = new Uint8Array(W * H);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = y * W + x;
    if (bg[p] || minCh(idx(x, y)) < BG_MIN) return;
    bg[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % W;
    const y = (p - x) / W;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  // 2) franja: pixels que não são fundo mas estão a até BAND px de um pixel de fundo
  const band = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (bg[y * W + x]) continue;
      search: for (let dy = -BAND; dy <= BAND; dy++) {
        for (let dx = -BAND; dx <= BAND; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && bg[ny * W + nx]) { band[y * W + x] = 1; break search; }
        }
      }
    }
  }

  // 3) monta RGBA e mede a caixa do ícone
  const rgba = Buffer.alloc(W * H * 4);
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x, i = idx(x, y), o = p * 4;
      let r = data[i], g = data[i + 1], b = data[i + 2], a = 255;
      if (bg[p]) a = 0;
      else if (band[p]) {
        const alpha = Math.min(1, Math.max(0, (255 - minCh(i)) / 255));
        if (alpha < 0.03) a = 0;
        else {
          const un = (c) => Math.max(0, Math.min(255, Math.round((c - 255 * (1 - alpha)) / alpha)));
          r = un(r); g = un(g); b = un(b); a = Math.round(alpha * 255);
        }
      }
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
      if (a > 0) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }

  const pad = 4;
  const left = Math.max(0, minX - pad), top = Math.max(0, minY - pad);
  const crop = { left, top, width: Math.min(W, maxX + pad + 1) - left, height: Math.min(H, maxY + pad + 1) - top };
  const png = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract(crop).resize({ width: 320 }).png({ compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(OUT, png);
  const m = await sharp(png).metadata();
  console.log(`logo-icon-mark.png: ${m.width}x${m.height}, ${png.length} bytes`);

  // preview 2x sobre o marinho do painel, para conferir halo e serrilhado
  await sharp({ create: { width: m.width * 2 + 40, height: m.height * 2 + 40, channels: 3, background: '#0a1220' } })
    .composite([{ input: await sharp(png).resize({ width: m.width * 2 }).toBuffer(), left: 20, top: 20 }])
    .png().toFile(PREVIEW);
  console.log('preview:', PREVIEW);
})();
```

Run: `cd "$SCRATCH/qa" && node make-logo-mark.cjs`
Expected: imprime as dimensões do PNG (largura 320) e o caminho do preview.

- [ ] **Step 2: Conferir o resultado visualmente**

Abra `$SCRATCH/qa/out/logo-preview-on-navy.png` com a ferramenta Read. Critérios de aceite: montanha e escudo nítidos; capacete branco preservado dentro do escudo; **sem halo claro** nem bordas serrilhadas visíveis contra o marinho; nenhum resto do texto "Montese" ou da linha divisória.

- Se **passar**: siga para o Step 3.
- Se **falhar** (halo/serrilhado): tente uma vez `BG_MIN = 235` e `BAND = 3` e rode de novo. Se ainda falhar, use o **fallback da spec (§4.2)**: apague `logo-icon-mark.png`, e no Step 3 troque o `<img>` do ícone por `<span className="rounded-lg bg-white px-2 py-1"><img src="/brand/logo-horizontal.jpg" alt="" height={28} className="h-7 w-auto" /></span>` e remova o texto "MONTESE/CONTROL" ao lado (o JPG já tem o nome) — mantendo só "CONTROL" e "Centro de comando da Montese" abaixo.

- [ ] **Step 3: Criar `AdminBrand`**

Create `frontend/src/components/admin/AdminBrand.tsx`:

```tsx
import Link from 'next/link';

// Marca do painel: ícone da Montese (montanha + escudo, fundo transparente) +
// texto em Poppins. Não altera components/Logo.tsx (mudanças do site em andamento).
// <img> simples: o next.config usa images.unoptimized, então next/image não traria ganho.
export function AdminBrand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/admin/overview"
      aria-label="Montese Control — Visão Geral"
      className="flex items-center gap-3 rounded-lg outline-offset-4 focus-visible:outline-2 focus-visible:outline-emerald-400"
    >
      <img src="/brand/logo-icon-mark.png" alt="" height={32} className="h-8 w-auto shrink-0" />
      <span className="flex flex-col leading-none">
        <span className="text-[17px] font-extrabold tracking-wide text-white">MONTESE</span>
        <span className="mt-1 text-[10px] font-semibold tracking-[0.42em] text-emerald-400">CONTROL</span>
        {!compact && <span className="adm-text-faint mt-1.5 text-[9px]">Centro de comando da Montese</span>}
      </span>
    </Link>
  );
}
```

- [ ] **Step 4: Checar tipos**

Run: `cd /opt/Montese/frontend && npx tsc --noEmit && echo "tipos ok"` → sem erros. (O componente só aparece na tela na Tarefa 8; `adm-text-faint` é definida lá.)

- [ ] **Step 5: Commit**

```bash
cd /opt/Montese && git add frontend/public/brand/logo-icon-mark.png frontend/src/components/admin/AdminBrand.tsx && git diff --cached --stat && git commit -m "$(cat <<'EOF'
feat: ícone da Montese com fundo transparente e AdminBrand para o painel Montese Control

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarefa 8: Tema escuro, ícones, navegação, sidebar/drawer, rodapé e shell

**Files:**
- Create: `frontend/src/app/admin/admin-theme.css`
- Create: `frontend/src/components/admin/icons.tsx`
- Create: `frontend/src/components/admin/nav.ts`
- Create: `frontend/src/components/admin/AdminSidebar.tsx`
- Create: `frontend/src/components/admin/AdminFooter.tsx`
- Create: `frontend/src/components/admin/AdminShell.tsx`
- Modify (reescrever): `frontend/src/app/admin/layout.tsx`
- Delete: `frontend/src/components/AdminSidebar.tsx`

**Interfaces:**
- Consumes: `AdminBrand` (Tarefa 7), `company` (Tarefa 5), `logout` de `@/lib/auth`.
- Produces (usados nas Tarefas 9–13):
  - CSS: classes `.adm-card`, `.adm-card-2`, `.adm-sidebar`, `.adm-topbar`, `.adm-text-faint` e as variáveis `--admin-*`, todas sob `.admin-theme`. **Regra:** as classes `.adm-*` não são de camada do Tailwind (vencem qualquer utilitário na mesma propriedade). Por isso: `.adm-card`/`.adm-card-2` definem `background`, `border` e `border-radius` — **não** combine com `rounded-*`/`bg-*`/`border-*` no mesmo elemento; `.adm-text-faint` define `color` — **não** combine com `text-<cor>` no mesmo elemento. Para texto principal use `text-brand-900`, para secundário `text-brand-700` (a escala está invertida dentro de `.admin-theme`).
  - `icons.tsx`: `type AdminIconName`; `AdminIcon({ name, className?, ...svgProps })` (SVG 24×24, `stroke="currentColor"`, `aria-hidden`).
  - `nav.ts`: `interface AdminNavItem { href: string; label: string; icon: AdminIconName; keywords?: string }`; `interface AdminNavGroup { label: string | null; items: AdminNavItem[] }`; `ADMIN_NAV: AdminNavGroup[]`; `ADMIN_NAV_FLAT: AdminNavItem[]`; `isNavActive(pathname: string, href: string): boolean`.
  - `AdminSidebar({ open: boolean; onClose: () => void })` — `id="admin-sidebar"`; `AdminShell({ children })`.

- [ ] **Step 1: Tema**

Create `frontend/src/app/admin/admin-theme.css`:

```css
/*
 * Tema escuro do painel /admin (Montese Control). Escopado ao wrapper
 * `.admin-theme` (AdminShell) — não altera globals.css nem as outras áreas.
 *
 * 1) Inverte a escala --color-brand-*: as telas antigas do admin (que usam
 *    text-brand-900, border-brand-100, bg-brand-50…) ficam legíveis sem
 *    reescrita. Dentro do admin: brand-900 = texto principal, brand-700 =
 *    texto secundário, brand-100 = borda, brand-50 = superfície elevada.
 * 2) Tokens --admin-* e classes .adm-* dos componentes novos.
 *
 * ATENÇÃO: este CSS não está em @layer, então vence qualquer utilitário do
 * Tailwind na MESMA propriedade. Não combine .adm-card com rounded-*/bg-*/
 * border-* nem .adm-text-faint com text-<cor> no mesmo elemento.
 */
.admin-theme {
  color-scheme: dark;

  --admin-bg: #0a1220;
  --admin-sidebar: #08101d;
  --admin-surface: #0f1a2e;
  --admin-surface-2: #14233b;
  --admin-border: #1e2f4a;
  --admin-text: #e6ecf7;
  --admin-muted: #9db0cc;
  --admin-faint: #7b8fb0;
  --admin-accent: #2f9e5c;
  --admin-accent-hover: #3bb56c;

  --color-brand-50: #14233b;
  --color-brand-100: #1e2f4a;
  --color-brand-300: #7fcf9d;
  --color-brand-500: #2f9e5c;
  --color-brand-700: #9db0cc;
  --color-brand-900: #e6ecf7;

  /* textos de erro/aviso das telas antigas, com contraste sobre fundo escuro */
  --color-red-600: #f87171;
  --color-red-700: #fca5a5;
  --color-green-700: #34d399;
  --color-yellow-800: #fcd34d;

  background: var(--admin-bg);
  color: var(--admin-text);
}

/* evita a faixa branca no overscroll quando o admin está aberto */
html:has(.admin-theme) {
  background: #0a1220;
}

.admin-theme .adm-sidebar {
  background: var(--admin-sidebar);
}

.admin-theme .adm-topbar {
  background: color-mix(in srgb, var(--admin-bg) 88%, transparent);
  backdrop-filter: blur(8px);
}

.admin-theme .adm-card {
  background: var(--admin-surface);
  border: 1px solid var(--admin-border);
  border-radius: 0.875rem;
}

.admin-theme .adm-card-2 {
  background: var(--admin-surface-2);
  border-radius: 0.625rem;
}

.admin-theme .adm-text-faint {
  color: var(--admin-faint);
}

.admin-theme :focus-visible {
  outline: 2px solid #34d399;
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .admin-theme *,
  .admin-theme *::before,
  .admin-theme *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 2: Ícones e navegação**

Create `frontend/src/components/admin/icons.tsx`:

```tsx
import type { ReactNode, SVGProps } from 'react';

export type AdminIconName =
  | 'home' | 'wallet' | 'building' | 'user' | 'users' | 'book' | 'check' | 'shield'
  | 'search' | 'bell' | 'menu' | 'close' | 'logout' | 'chevron' | 'refresh' | 'server'
  | 'dollar' | 'sparkle' | 'alert' | 'info';

// Conjunto mínimo de ícones de traço (24x24) — sem biblioteca de ícones.
const PATHS: Record<AdminIconName, ReactNode> = {
  home: (<><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /></>),
  wallet: (<><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M3 10h18" /><circle cx="16.5" cy="14.5" r="1" /></>),
  building: (<><rect x="5" y="3" width="14" height="18" rx="1" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" /></>),
  user: (<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></>),
  users: (<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2.2.6 3.5 2.6 3.5 5.5" /></>),
  book: (<><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z" /><path d="M5 17a3 3 0 0 1 3-3h11" /></>),
  check: (<><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16.5 9.5" /></>),
  shield: (<><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6L12 3z" /><path d="m9 12 2.2 2.2L15.5 10" /></>),
  search: (<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>),
  bell: (<><path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  logout: (<><path d="M14 4h5v16h-5" /><path d="M4 12h11m-3-3.5 3.5 3.5-3.5 3.5" /></>),
  chevron: <path d="m6 9 6 6 6-6" />,
  refresh: (<><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" /></>),
  server: (<><rect x="4" y="5" width="16" height="6" rx="1.5" /><rect x="4" y="13" width="16" height="6" rx="1.5" /><path d="M8 8h.01M8 16h.01" /></>),
  dollar: (<><path d="M12 3v18" /><path d="M16.5 7.5c-.8-1.3-2.5-2-4.5-2-2.5 0-4.5 1.2-4.5 3.2 0 4.8 9.5 2.4 9.5 7.1 0 2-2.2 3.2-5 3.2-2.3 0-4.2-.8-5-2.3" /></>),
  sparkle: (<><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2" /></>),
  alert: (<><path d="M12 4 2.8 19h18.4L12 4z" /><path d="M12 10v4M12 17h.01" /></>),
  info: (<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>),
};

export function AdminIcon({
  name,
  className = 'h-5 w-5',
  ...rest
}: { name: AdminIconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
```

Create `frontend/src/components/admin/nav.ts`:

```ts
import type { AdminIconName } from './icons';

export interface AdminNavItem {
  href: string;
  label: string;
  icon: AdminIconName;
  keywords?: string;
}

export interface AdminNavGroup {
  label: string | null;
  items: AdminNavItem[];
}

// Só páginas que existem. Itens futuros ficam de fora de propósito (evita
// links mortos); o que ainda não existe aparece como "Em construção" na
// Visão Geral.
export const ADMIN_NAV: AdminNavGroup[] = [
  { label: null, items: [{ href: '/admin/overview', label: 'Visão Geral', icon: 'home', keywords: 'inicio painel resumo dashboard' }] },
  { label: 'Financeiro', items: [{ href: '/admin/financeiro', label: 'Financeiro', icon: 'wallet', keywords: 'pagamentos assinaturas planos mercado pago cobranças' }] },
  {
    label: 'Clientes',
    items: [
      { href: '/admin/empresas', label: 'Empresas', icon: 'building', keywords: 'clientes cnpj tenants' },
      { href: '/admin/tecnicos', label: 'Técnicos', icon: 'user', keywords: 'tecnicos responsaveis' },
      { href: '/admin/parceiros', label: 'Parceiros', icon: 'users', keywords: 'parceiros campo' },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { href: '/admin/normativa', label: 'Base normativa', icon: 'book', keywords: 'nr normas fontes oficiais' },
      { href: '/admin/checklist-sst', label: 'Checklist SST', icon: 'check', keywords: 'catalogo itens infracao' },
      { href: '/admin/auditoria', label: 'Auditoria', icon: 'shield', keywords: 'logs eventos acessos' },
    ],
  },
];

export const ADMIN_NAV_FLAT: AdminNavItem[] = ADMIN_NAV.flatMap((group) => group.items);

export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
```

- [ ] **Step 3: Sidebar/drawer, rodapé e shell**

Create `frontend/src/components/admin/AdminSidebar.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { logout } from '@/lib/auth';
import { AdminBrand } from './AdminBrand';
import { AdminIcon } from './icons';
import { ADMIN_NAV, isNavActive } from './nav';

// Fixa e visível em ≥ 1024 px; abaixo disso vira drawer (foco preso enquanto
// aberto, Esc fecha, fecha ao navegar e devolve o foco a quem abriu).
export function AdminSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);

  // Fecha ao navegar. Só `pathname` nas deps de propósito: `onClose` é estável
  // no AdminShell (useCallback), mas não queremos re-disparar por isso.
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(ref.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [open, onClose]);

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" aria-hidden="true" onClick={onClose} />}
      <aside
        ref={ref}
        id="admin-sidebar"
        aria-label="Menu do painel"
        className={`adm-sidebar fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-brand-100 px-4 py-5 transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 ${
          open ? 'translate-x-0' : 'invisible -translate-x-full lg:visible'
        }`}
      >
        <div className="flex items-start justify-between gap-2 px-1">
          <AdminBrand />
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={onClose}
            className="rounded-md p-1.5 text-brand-700 hover:bg-brand-50 hover:text-brand-900 lg:hidden"
          >
            <AdminIcon name="close" className="h-5 w-5" />
          </button>
        </div>

        <nav aria-label="Seções do painel" className="mt-7 flex flex-1 flex-col gap-5 overflow-y-auto">
          {ADMIN_NAV.map((group, index) => (
            <div key={group.label ?? `grupo-${index}`}>
              {group.label && (
                <p className="adm-text-faint px-3 text-[11px] font-semibold uppercase tracking-wider">{group.label}</p>
              )}
              <ul className="mt-1 flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = isNavActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                          active
                            ? 'bg-emerald-500/15 font-semibold text-brand-900'
                            : 'text-brand-700 hover:bg-brand-50 hover:text-brand-900'
                        }`}
                      >
                        {active && (
                          <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-emerald-400" />
                        )}
                        <AdminIcon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <button
          type="button"
          onClick={logout}
          className="mt-4 flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-brand-700 hover:bg-brand-50 hover:text-brand-900"
        >
          <AdminIcon name="logout" className="h-[18px] w-[18px] shrink-0" />
          Sair
        </button>
      </aside>
    </>
  );
}
```

Create `frontend/src/components/admin/AdminFooter.tsx`:

```tsx
import { company } from '@/lib/company';

// Rodapé enxuto do painel (o DashboardFooter continua sendo o de empresa e técnico).
export function AdminFooter() {
  return (
    <footer className="border-t border-brand-100 px-4 py-4 text-xs text-brand-700 lg:px-8">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2">
        <p>{`Montese Control · ${company.nomeFantasia} · CNPJ ${company.cnpj}`}</p>
        <p>{`© ${new Date().getFullYear()} Todos os direitos reservados.`}</p>
      </div>
    </footer>
  );
}
```

Create `frontend/src/components/admin/AdminShell.tsx` (versão da Tarefa 8; a Tarefa 9 a reescreve por inteiro):

```tsx
'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { AdminBrand } from './AdminBrand';
import { AdminFooter } from './AdminFooter';
import { AdminSidebar } from './AdminSidebar';
import { AdminIcon } from './icons';

export function AdminShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <div className="admin-theme min-h-screen">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-emerald-600 focus:px-3 focus:py-2 focus:text-white"
      >
        Pular para o conteúdo
      </a>
      <div className="flex min-h-screen">
        <AdminSidebar open={menuOpen} onClose={closeMenu} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="adm-topbar sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-brand-100 px-4 lg:hidden">
            <button
              type="button"
              aria-label="Abrir menu"
              aria-controls="admin-sidebar"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
              className="rounded-md p-2 text-brand-900 hover:bg-brand-50"
            >
              <AdminIcon name="menu" />
            </button>
            <AdminBrand compact />
          </header>
          <main id="conteudo" className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 lg:px-8">
            {children}
          </main>
          <AdminFooter />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Trocar o layout do admin e remover a sidebar antiga**

Confirme que nada mais usa a sidebar antiga:

```bash
cd /opt/Montese/frontend && grep -rn "components/AdminSidebar\|from './AdminSidebar'" src   # esperado: só src/app/admin/layout.tsx
```

Rewrite `frontend/src/app/admin/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import './admin-theme.css';
import { AdminShell } from '@/components/admin/AdminShell';
import { WhatsAppButton } from '@/components/WhatsAppButton';

export const metadata = { title: 'Montese Control — Admin' };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AdminShell>{children}</AdminShell>
      <WhatsAppButton />
    </>
  );
}
```

(`WhatsAppButton` é mantido como no layout anterior — comportamento inalterado. **Observação para o relatório final:** esse componente está *não versionado* hoje e o HEAD já o importava; não é regressão desta entrega.)

```bash
cd /opt/Montese && git rm -q frontend/src/components/AdminSidebar.tsx
```

- [ ] **Step 5: Verificar**

```bash
cd /opt/Montese/frontend && npx tsc --noEmit && echo "tipos ok"
cd "$SCRATCH/qa"
node shots.mjs cheio out /admin/empresas,/admin/financeiro desktop
QA_CLICK='button[aria-label="Abrir menu"]' QA_FULLPAGE=0 QA_TAG=drawer node shots.mjs cheio out /admin/empresas mobile
node shots.mjs cheio out /admin/empresas mobile
```

Abra os PNGs em `$SCRATCH/qa/out/` com a ferramenta Read e confira:
1. **Desktop:** sidebar de 256 px com o logo (ícone + MONTESE/CONTROL), grupos "Financeiro/Clientes/Sistema", item da página atual destacado em verde com barra à esquerda; conteúdo das telas antigas **legível** (texto claro sobre marinho, bordas visíveis, botões verdes, links de erro em vermelho claro); rodapé com "CNPJ 69.203.754/0001-45".
2. **Mobile:** sem sidebar, cabeçalho com hambúrguer + marca compacta; `-drawer.png` mostra o drawer aberto sobre um overlay escuro.
3. O log do script não mostra `pageerror`.
4. Logo: se houver halo/serrilhado, volte à Tarefa 7 (fallback).

Se alguma tela antiga tiver superfície clara solta ou texto ilegível, corrija **pontualmente** naquela tela (troque a classe clara por uma da escala `brand` ou por uma variante escura do Tailwind, ex.: `bg-red-500/10 text-red-300`) — a varredura completa das 7 telas é a Tarefa 13.

- [ ] **Step 6: Commit**

```bash
cd /opt/Montese && git add frontend/src/app/admin/admin-theme.css frontend/src/components/admin/icons.tsx frontend/src/components/admin/nav.ts frontend/src/components/admin/AdminSidebar.tsx frontend/src/components/admin/AdminFooter.tsx frontend/src/components/admin/AdminShell.tsx frontend/src/app/admin/layout.tsx && git diff --cached --stat && git commit -m "$(cat <<'EOF'
feat: shell escuro do painel admin (tema marinho, sidebar/drawer, rodapé com CNPJ)

Substitui a sidebar antiga; o tema inverte a escala brand só dentro de /admin.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarefa 9: Dados compartilhados, topbar (estado, sino, usuário) e paleta Ctrl+K

**Files:**
- Create: `frontend/src/components/admin/types.ts`
- Create: `frontend/src/components/admin/api.ts`
- Create: `frontend/src/components/admin/useAdminFetch.ts`
- Create: `frontend/src/components/admin/status-state.ts`
- Create: `frontend/src/components/admin/AdminStatusProvider.tsx`
- Create: `frontend/src/components/admin/AdminTopbar.tsx`
- Create: `frontend/src/components/admin/CommandPalette.tsx`
- Modify (reescrever): `frontend/src/components/admin/AdminShell.tsx`

**Interfaces:**
- Consumes: `AdminIcon`, `ADMIN_NAV_FLAT`, `AdminBrand`, `logout`.
- Produces (usados nas Tarefas 10–12):
  - `types.ts`: `SystemStatus`, `OverviewMetrics`, `AlertSeverity`, `AlertItem`, `AlertasResponse`, `FinanceiroPeriodo`, `PagamentoRecente`, `FinanceiroResponse`, `ClienteRecente`, `OpenRouterUsage`, `MiniMaxUsage`, `AuditLogRow`.
  - `api.ts`: `adminFetch<T>(path: string): Promise<T>` (envia o Bearer; 401 → `/login`).
  - `useAdminFetch.ts`: `interface FetchState<T> { data: T | null; error: string | null; loading: boolean; reload: () => void }`; `useAdminFetch<T>(path: string | null, refreshKey = 0): FetchState<T>` (mantém o dado anterior enquanto recarrega).
  - `status-state.ts`: `interface Slice<T> { data: T | null; error: boolean }`; `type SystemState = 'carregando' | 'online' | 'degradado' | 'sem-resposta'`; `deriveSystemState(slice: Slice<SystemStatus>): SystemState`; `SYSTEM_STATE_LABEL`; `alertBadgeCount(slice: Slice<AlertasResponse>): number`.
  - `AdminStatusProvider` + `useAdminStatus(): { system: Slice<SystemStatus>; alertas: Slice<AlertasResponse>; lastUpdated: number | null; refresh: () => void }` (polling 60 s, pausado com a aba oculta).

- [ ] **Step 1: Tipos e chamada autenticada**

Create `frontend/src/components/admin/types.ts`:

```ts
// Contratos das respostas que o painel consome. Espelham os endpoints do
// backend (overview, system-status, ai-copilot/usage, admin/ai-usage,
// admin/dashboard/*, audit-log). `AuditLogRow` NÃO inclui `detail`: o card de
// logs não deve ler nem exibir esse campo (contém e-mail em falhas de login).
export interface SystemStatus {
  memory: { total_gb: number; free_gb: number; used_percent: number };
  cpu: { cores: number; load_avg_1m: number; load_avg_5m: number; load_avg_15m: number };
  disk: { total_gb: number; free_gb: number; used_percent: number };
  services: {
    postgres: { reachable: boolean; active_connections: number | null };
    redis: { reachable: boolean };
    frontend: { reachable: boolean };
  };
}

export interface OverviewMetrics {
  empresas_ativas: number;
  tecnicos_vinculados: number;
  parceiros_vinculados: number;
  inspecoes_no_mes: number;
  documentos_vencendo: number;
  epis_vencendo: number;
  assinaturas_ativas: number;
  receita_mensal_cents: number;
  planos_acao_pendentes: number;
}

export type AlertSeverity = 'critico' | 'atencao' | 'info';

export interface AlertItem {
  id: string;
  severidade: AlertSeverity;
  titulo: string;
  detalhe: string;
  href: string;
}

export interface AlertasResponse {
  gerado_em: string;
  contagem: Record<AlertSeverity, number>;
  itens: AlertItem[];
}

export interface FinanceiroPeriodo {
  cobrado_cents: number;
  aprovado_cents: number;
  pendente_cents: number;
}

export interface PagamentoRecente {
  id: string;
  mercadopago_payment_id: string;
  amount_cents: number;
  status: string;
  occurred_at: string;
  cliente: string | null;
  plano: string | null;
}

export interface FinanceiroResponse {
  periodo_dias: number;
  serie: { data: string; cobrado_cents: number; aprovado_cents: number }[];
  hoje: FinanceiroPeriodo;
  mes: FinanceiroPeriodo & { recusado_cents: number };
  recentes: PagamentoRecente[];
}

export interface ClienteRecente {
  id: string;
  nome: string;
  plano: string;
  status: string;
  mrr_cents: number | null;
  ultimo_acesso: string | null;
  created_at: string;
}

export interface OpenRouterUsage {
  configured: boolean;
  provider: 'openrouter';
  is_free_tier?: boolean;
  total_credits?: number;
  total_usage?: number;
  usage_monthly?: number;
  low_balance_warning?: boolean;
  dashboard_url: string;
  error?: string;
}

export interface MiniMaxUsage {
  total_calls: number;
  total_tokens: number;
  by_capability: {
    capability: string;
    calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  }[];
  last_7_days: { date: string; total_tokens: number }[];
}

export interface AuditLogRow {
  id: string;
  occurred_at: string;
  actor_full_name: string | null;
  action: string;
  resource_type: string;
  method: string;
  path: string;
  status_code: number;
  ip_address: string | null;
}
```

Create `frontend/src/components/admin/api.ts`:

```ts
import { getToken } from '@/lib/auth';

// Chamada autenticada ao backend (via /api do nginx). Sessão ausente ou
// expirada (401) volta ao login. Só roda no navegador.
export async function adminFetch<T>(path: string): Promise<T> {
  const token = getToken();
  if (!token) {
    window.location.href = '/login';
    throw new Error('sem sessão');
  }
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('sessão expirada');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}
```

Create `frontend/src/components/admin/useAdminFetch.ts`:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from './api';

export interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

// Busca um endpoint do admin. `path = null` não busca (útil para condicionar).
// `refreshKey` força nova busca quando muda (botão "Atualizar" da página).
// Mantém o dado anterior enquanto recarrega — o card não pisca.
export function useAdminFetch<T>(path: string | null, refreshKey = 0): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    setLoading(true);
    adminFetch<T>(path)
      .then((json) => {
        if (cancelled) return;
        setData(json);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, refreshKey, tick]);

  return { data, error, loading, reload };
}
```

- [ ] **Step 2: Estado do sistema e provider com polling**

Create `frontend/src/components/admin/status-state.ts`:

```ts
import type { AlertasResponse, SystemStatus } from './types';

export interface Slice<T> {
  data: T | null;
  error: boolean; // a última tentativa falhou (data pode ser a leitura anterior)
}

export type SystemState = 'carregando' | 'online' | 'degradado' | 'sem-resposta';

export const SYSTEM_STATE_LABEL: Record<SystemState, string> = {
  carregando: 'Verificando…',
  online: 'Sistema online',
  degradado: 'Sistema degradado',
  'sem-resposta': 'Sem resposta',
};

// online = Postgres, Redis e Site acessíveis; degradado = algum não está;
// sem-resposta = a própria chamada falhou (nunca afirmamos "online" sem leitura).
export function deriveSystemState(slice: Slice<SystemStatus>): SystemState {
  if (slice.error) return 'sem-resposta';
  if (!slice.data) return 'carregando';
  const s = slice.data.services;
  return s.postgres.reachable && s.redis.reachable && s.frontend.reachable ? 'online' : 'degradado';
}

// O sino conta só crítico + atenção; severidade "info" não conta.
export function alertBadgeCount(slice: Slice<AlertasResponse>): number {
  return slice.data ? slice.data.contagem.critico + slice.data.contagem.atencao : 0;
}
```

Create `frontend/src/components/admin/AdminStatusProvider.tsx`:

```tsx
'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { adminFetch } from './api';
import type { Slice } from './status-state';
import type { AlertasResponse, SystemStatus } from './types';

const POLL_MS = 60_000;

interface AdminStatusValue {
  system: Slice<SystemStatus>;
  alertas: Slice<AlertasResponse>;
  lastUpdated: number | null;
  refresh: () => void;
}

const AdminStatusContext = createContext<AdminStatusValue | null>(null);

export function useAdminStatus(): AdminStatusValue {
  const value = useContext(AdminStatusContext);
  if (!value) throw new Error('useAdminStatus precisa estar dentro de <AdminStatusProvider>');
  return value;
}

// Busca /system-status e /alertas uma vez para o shell inteiro (topbar e
// cards leem daqui). Polling de 60 s, pausado quando a aba está oculta.
export function AdminStatusProvider({ children }: { children: ReactNode }) {
  const [system, setSystem] = useState<Slice<SystemStatus>>({ data: null, error: false });
  const [alertas, setAlertas] = useState<Slice<AlertasResponse>>({ data: null, error: false });
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [s, a] = await Promise.allSettled([
      adminFetch<SystemStatus>('/api/system-status'),
      adminFetch<AlertasResponse>('/api/admin/dashboard/alertas'),
    ]);
    setSystem((prev) =>
      s.status === 'fulfilled' ? { data: s.value, error: false } : { data: prev.data, error: true },
    );
    setAlertas((prev) =>
      a.status === 'fulfilled' ? { data: a.value, error: false } : { data: prev.data, error: true },
    );
    setLastUpdated(Date.now());
  }, []);

  useEffect(() => {
    void load();
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => void load(), POLL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        void load();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  const value = useMemo<AdminStatusValue>(
    () => ({ system, alertas, lastUpdated, refresh: () => void load() }),
    [system, alertas, lastUpdated, load],
  );

  return <AdminStatusContext.Provider value={value}>{children}</AdminStatusContext.Provider>;
}
```

- [ ] **Step 3: Topbar**

Create `frontend/src/components/admin/AdminTopbar.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { logout } from '@/lib/auth';
import { AdminBrand } from './AdminBrand';
import { useAdminStatus } from './AdminStatusProvider';
import { AdminIcon } from './icons';
import { alertBadgeCount, deriveSystemState, SYSTEM_STATE_LABEL } from './status-state';
import type { SystemState } from './status-state';

const PILL: Record<SystemState, { dot: string; text: string; box: string }> = {
  carregando: { dot: 'bg-slate-400', text: 'text-slate-300', box: 'border-slate-500/40 bg-slate-500/10' },
  online: { dot: 'bg-emerald-400', text: 'text-emerald-300', box: 'border-emerald-400/30 bg-emerald-400/10' },
  degradado: { dot: 'bg-red-400', text: 'text-red-300', box: 'border-red-400/30 bg-red-400/10' },
  'sem-resposta': { dot: 'bg-slate-400', text: 'text-slate-300', box: 'border-slate-500/40 bg-slate-500/10' },
};

// O texto é o que comunica o estado; o ponto colorido é só reforço visual.
function StatusPill() {
  const { system } = useAdminStatus();
  const state = deriveSystemState(system);
  const s = PILL[state];
  return (
    <span role="status" className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-medium ${s.box} ${s.text}`}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${s.dot}`} />
      <span className="sr-only sm:not-sr-only">{SYSTEM_STATE_LABEL[state]}</span>
    </span>
  );
}

function AlertBell() {
  const { alertas } = useAdminStatus();
  const count = alertBadgeCount(alertas);
  const label =
    count > 0
      ? `${count} ${count === 1 ? 'alerta precisa' : 'alertas precisam'} de atenção`
      : 'Nenhum alerta que precise de atenção';
  return (
    <Link
      href="/admin/overview#alertas"
      aria-label={label}
      className="relative rounded-lg p-2 text-brand-700 hover:bg-brand-50 hover:text-brand-900"
    >
      <AdminIcon name="bell" />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
        >
          {count}
        </span>
      )}
    </Link>
  );
}

function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // O token só carrega id/role/tenantId — sem nome nem e-mail (spec §3, item 1).
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-brand-900 hover:bg-brand-50"
      >
        <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
          <AdminIcon name="user" className="h-4 w-4" />
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-[13px] font-semibold">Administrador</span>
          <span className="block text-[11px] text-brand-700">Montese Control</span>
        </span>
        <AdminIcon name="chevron" className="hidden h-4 w-4 text-brand-700 sm:block" />
      </button>
      {open && (
        <div role="menu" className="adm-card absolute right-0 top-full z-50 mt-2 w-48 p-1">
          <button
            type="button"
            role="menuitem"
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-brand-900 hover:bg-brand-50"
          >
            <AdminIcon name="logout" className="h-4 w-4" />
            Sair
          </button>
        </div>
      )}
    </div>
  );
}

export function AdminTopbar({
  menuOpen,
  onMenu,
  onSearch,
}: {
  menuOpen: boolean;
  onMenu: () => void;
  onSearch: () => void;
}) {
  return (
    <header className="adm-topbar sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-brand-100 px-4 lg:px-8">
      <button
        type="button"
        aria-label="Abrir menu"
        aria-controls="admin-sidebar"
        aria-expanded={menuOpen}
        onClick={onMenu}
        className="rounded-md p-2 text-brand-900 hover:bg-brand-50 lg:hidden"
      >
        <AdminIcon name="menu" />
      </button>
      <div className="lg:hidden">
        <AdminBrand compact />
      </div>

      <button
        type="button"
        onClick={onSearch}
        aria-label="Ir para uma página (Ctrl+K)"
        className="hidden max-w-md flex-1 items-center gap-2 rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 text-left text-sm text-brand-700 hover:border-emerald-400/40 sm:flex"
      >
        <AdminIcon name="search" className="h-4 w-4" />
        <span className="flex-1">Ir para… (Ctrl+K)</span>
      </button>

      <div className="flex-1 sm:hidden" />
      <button
        type="button"
        onClick={onSearch}
        aria-label="Ir para uma página"
        className="rounded-lg p-2 text-brand-700 hover:bg-brand-50 hover:text-brand-900 sm:hidden"
      >
        <AdminIcon name="search" />
      </button>

      <div className="hidden flex-1 sm:block" />
      <StatusPill />
      <AlertBell />
      <UserMenu />
    </header>
  );
}
```

- [ ] **Step 4: Paleta Ctrl+K (navegação entre páginas)**

Create `frontend/src/components/admin/CommandPalette.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AdminIcon } from './icons';
import { ADMIN_NAV_FLAT } from './nav';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Paleta de NAVEGAÇÃO entre as páginas do admin. Não busca empresa/técnico
// (fora do escopo do SP1) — o texto do campo diz exatamente isso.
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = norm(query.trim());
    return ADMIN_NAV_FLAT.filter((item) => !q || norm(`${item.label} ${item.keywords ?? ''}`).includes(q));
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const previous = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      previous?.focus();
    };
  }, [open]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      go(results[active].href);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[15vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ir para uma página do painel"
        className="adm-card w-full max-w-lg overflow-hidden"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-brand-100 px-3">
          <AdminIcon name="search" className="h-4 w-4 text-brand-700" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-autocomplete="list"
            aria-activedescendant={results[active] ? `palette-item-${active}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ir para… (Visão Geral, Empresas, Financeiro)"
            className="w-full bg-transparent py-3 text-sm text-brand-900 placeholder:text-brand-700"
          />
        </div>
        <ul id="palette-list" role="listbox" aria-label="Páginas" className="max-h-72 overflow-y-auto p-1">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-brand-700">Nenhuma página encontrada.</li>
          )}
          {results.map((item, i) => (
            <li
              key={item.href}
              id={`palette-item-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(item.href)}
              className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm ${
                i === active ? 'bg-emerald-500/15 text-brand-900' : 'text-brand-700'
              }`}
            >
              <AdminIcon name={item.icon} className="h-4 w-4" />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Reescrever o shell com provider, topbar e paleta**

Rewrite `frontend/src/components/admin/AdminShell.tsx` inteiro:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AdminFooter } from './AdminFooter';
import { AdminSidebar } from './AdminSidebar';
import { AdminStatusProvider } from './AdminStatusProvider';
import { AdminTopbar } from './AdminTopbar';
import { CommandPalette } from './CommandPalette';

export function AdminShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="admin-theme min-h-screen">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-emerald-600 focus:px-3 focus:py-2 focus:text-white"
      >
        Pular para o conteúdo
      </a>
      <AdminStatusProvider>
        <div className="flex min-h-screen">
          <AdminSidebar open={menuOpen} onClose={closeMenu} />
          <div className="flex min-w-0 flex-1 flex-col">
            <AdminTopbar menuOpen={menuOpen} onMenu={() => setMenuOpen(true)} onSearch={() => setPaletteOpen(true)} />
            <main id="conteudo" className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 lg:px-8">
              {children}
            </main>
            <AdminFooter />
          </div>
        </div>
        <CommandPalette open={paletteOpen} onClose={closePalette} />
      </AdminStatusProvider>
    </div>
  );
}
```

- [ ] **Step 6: Verificar**

```bash
cd /opt/Montese/frontend && npx tsc --noEmit && echo "tipos ok"
cd "$SCRATCH/qa"
for c in cheio degradado erro; do node shots.mjs $c out /admin/empresas desktop; done
QA_KEYS=Control+k QA_FULLPAGE=0 QA_TAG=paleta node shots.mjs cheio out /admin/empresas desktop
QA_KEYS=Control+k QA_TYPE=fin QA_FULLPAGE=0 QA_TAG=paleta-fin node shots.mjs cheio out /admin/empresas desktop
node shots.mjs degradado out /admin/empresas mobile
```

Abra os PNGs e confira:
1. **`cheio`:** pílula "Sistema online" (verde); sino com badge **1** (1 atenção; o `info` não conta).
2. **`degradado`:** pílula "Sistema degradado" (vermelha); badge **4** (2 críticos + 2 atenção).
3. **`erro`:** pílula "Sem resposta" (cinza); **sem** badge no sino.
4. **`-paleta`:** diálogo com as 8 páginas; **`-paleta-fin`:** só "Financeiro", destacado.
5. **Mobile:** topbar com hambúrguer, marca compacta, lupa, pílula só com o ponto (texto só para leitor de tela), sino e avatar — sem estouro horizontal.
6. Nenhum `pageerror` no log (os `console: … 500` do cenário `erro` são esperados).

- [ ] **Step 7: Commit**

```bash
cd /opt/Montese && git add frontend/src/components/admin/types.ts frontend/src/components/admin/api.ts frontend/src/components/admin/useAdminFetch.ts frontend/src/components/admin/status-state.ts frontend/src/components/admin/AdminStatusProvider.tsx frontend/src/components/admin/AdminTopbar.tsx frontend/src/components/admin/CommandPalette.tsx frontend/src/components/admin/AdminShell.tsx && git diff --cached --stat && git commit -m "$(cat <<'EOF'
feat: topbar do admin com estado do sistema, sino de alertas, menu do usuário e paleta Ctrl+K

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarefa 10: Primitivos de card e gráficos SVG

**Files:**
- Create: `frontend/src/components/admin/format.ts`
- Create: `frontend/src/components/admin/useNow.ts`
- Create: `frontend/src/components/admin/Card.tsx`
- Create: `frontend/src/components/admin/charts/Sparkline.tsx`
- Create: `frontend/src/components/admin/charts/AreaChart.tsx`
- Create: `frontend/src/components/admin/charts/Gauge.tsx`

**Interfaces:**
- Consumes: `FetchState<T>` (`useAdminFetch.ts`, Tarefa 9); `.adm-card`/`.adm-card-2` (Tarefa 8).
- Produces (usados nas Tarefas 11–12):
  - `format.ts`: `formatCents(cents: number): string` (R$), `formatCentsAxis(cents: number): string` (eixo, ex.: `R$ 1,2 mil`), `formatUsd(v: number): string`, `formatInt(n: number): string`, `formatCompact(n: number): string`, `plural(n: number, one: string, many: string): string`, `formatDayMonth(ymd: string): string` (`DD/MM`), `formatDateTime(iso: string): string` (`DD/MM, HH:mm` em São Paulo), `formatTime(iso: string): string`, `relativeTime(value: string | number | null, now?: number): string`, `lastDaysUtc(n: number, now?: number): string[]`, `fillDailySeries(rows: { date: string; total_tokens: number }[], days?: number, now?: number): { date: string; total_tokens: number }[]`.
  - `useNow(intervalMs = 15000): number`.
  - `Card.tsx`: `Card({ id?, title, subtitle?, action?, className?, children })`, `CardLink({ href, children })`, `CardSkeleton({ rows? })`, `CardError({ onRetry, message? })`, `CardEmpty({ children })`, `UnderConstructionBadge()`, `UnderConstructionCard({ id?, title, description, className? })`, `AsyncBody<T>({ state: FetchState<T>; rows?; children: (data: T) => ReactNode })`, `type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral'`, `Badge({ tone, children })`.
  - `Sparkline({ values: number[]; color?: string; label: string; className?: string })`; `AreaChart({ labels: string[]; series: { name: string; color: string; values: number[] }[]; format: (n: number) => string; formatAxis?: (n: number) => string; ariaLabel: string })`; `Gauge({ percent: number | null; label: string; caption?: string })`.

Não há tela que use estes componentes até a Tarefa 11; a verificação desta tarefa é `tsc` (os componentes são exercitados por screenshot na Tarefa 11).

- [ ] **Step 1: Formatação e relógio**

Create `frontend/src/components/admin/format.ts`:

```ts
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const INT = new Intl.NumberFormat('pt-BR');
const COMPACT = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const TZ = 'America/Sao_Paulo';
const DAY_MS = 86_400_000;

export const formatCents = (cents: number): string => BRL.format(cents / 100);
export const formatCentsAxis = (cents: number): string =>
  cents === 0 ? 'R$ 0' : `R$ ${COMPACT.format(cents / 100)}`;
export const formatUsd = (value: number): string => USD.format(value);
export const formatInt = (n: number): string => INT.format(n);
export const formatCompact = (n: number): string => COMPACT.format(n);
export const plural = (n: number, one: string, many: string): string =>
  `${INT.format(n)} ${n === 1 ? one : many}`;

// 'YYYY-MM-DD' -> 'DD/MM'
export function formatDayMonth(ymd: string): string {
  const [, month, day] = ymd.split('-');
  return `${day}/${month}`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export function relativeTime(value: string | number | null, now: number = Date.now()): string {
  if (value === null) return '—';
  const t = typeof value === 'number' ? value : new Date(value).getTime();
  const min = Math.floor(Math.max(0, now - t) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} d`;
}

// Últimos `n` dias em UTC (YYYY-MM-DD), do mais antigo ao mais novo (o último é hoje em UTC).
export function lastDaysUtc(n: number, now: number = Date.now()): string[] {
  return Array.from({ length: n }, (_, i) => new Date(now - (n - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

// /api/admin/ai-usage devolve só os dias COM uso, agrupados por dia no fuso da
// sessão do Postgres (UTC). Preenche os dias ausentes com 0 — assim "hoje" é o
// último item e o sparkline tem sempre 7 pontos.
export function fillDailySeries(
  rows: { date: string; total_tokens: number }[],
  days = 7,
  now: number = Date.now(),
): { date: string; total_tokens: number }[] {
  const byDate = new Map(rows.map((r) => [r.date, Number(r.total_tokens)]));
  return lastDaysUtc(days, now).map((date) => ({ date, total_tokens: byDate.get(date) ?? 0 }));
}
```

Create `frontend/src/components/admin/useNow.ts`:

```ts
'use client';

import { useEffect, useState } from 'react';

// Relógio que re-renderiza a cada `intervalMs` — para textos "há X min" não ficarem congelados.
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
```

- [ ] **Step 2: Card e estados**

Create `frontend/src/components/admin/Card.tsx`:

```tsx
'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { FetchState } from './useAdminFetch';

// `.adm-card` define fundo, borda e raio — não some `rounded-*`/`bg-*` aqui.
export function Card({
  id,
  title,
  subtitle,
  action,
  className = '',
  children,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const titleId = id ? `${id}-titulo` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={`adm-card flex min-w-0 scroll-mt-20 flex-col p-4 sm:p-5 ${className}`}
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={titleId} className="text-[15px] font-semibold text-brand-900">
            {title}
          </h3>
          {subtitle && <p className="mt-0.5 text-xs text-brand-700">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="shrink-0 text-xs font-medium text-emerald-400 hover:underline">
      {children}
    </Link>
  );
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Carregando" className="flex animate-pulse flex-col gap-2.5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="adm-card-2 h-4" style={{ width: `${90 - i * 14}%` }} />
      ))}
    </div>
  );
}

export function CardError({
  onRetry,
  message = 'Não foi possível carregar este card.',
}: {
  onRetry: () => void;
  message?: string;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-sm text-red-300">
      <p>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-red-400/40 px-3 py-1 text-xs font-medium text-red-200 hover:bg-red-400/10"
      >
        Tentar novamente
      </button>
    </div>
  );
}

export function CardEmpty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-center text-sm text-brand-700">{children}</p>;
}

export function UnderConstructionBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
      Em construção
    </span>
  );
}

// Moldura de um widget da referência que ainda não tem fonte de dados: mesmo
// visual dos demais, selo explícito e NENHUM número.
export function UnderConstructionCard({
  id,
  title,
  description,
  className = '',
}: {
  id?: string;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <Card id={id} title={title} action={<UnderConstructionBadge />} className={className}>
      <p className="text-sm text-brand-700">{description}</p>
    </Card>
  );
}

// Mostra o dado se houver (mesmo enquanto recarrega); senão erro com retry; senão skeleton.
export function AsyncBody<T>({
  state,
  rows = 3,
  children,
}: {
  state: FetchState<T>;
  rows?: number;
  children: (data: T) => ReactNode;
}) {
  if (state.data !== null) return <>{children(state.data)}</>;
  if (state.error) return <CardError onRetry={state.reload} />;
  return <CardSkeleton rows={rows} />;
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

const TONES: Record<Tone, string> = {
  ok: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  warn: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  bad: 'border-red-400/30 bg-red-400/10 text-red-300',
  info: 'border-blue-400/30 bg-blue-400/10 text-blue-300',
  neutral: 'border-slate-400/30 bg-slate-400/10 text-slate-300',
};

// Estado é sempre o TEXTO do badge; a cor é só reforço.
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}
```

- [ ] **Step 3: Gráficos SVG**

Create `frontend/src/components/admin/charts/Sparkline.tsx`:

```tsx
'use client';

import { useId } from 'react';

export function Sparkline({
  values,
  color = '#34d399',
  label,
  className = 'h-8 w-24',
}: {
  values: number[];
  color?: string;
  label: string;
  className?: string;
}) {
  const gid = useId().replace(/:/g, '');
  if (values.length === 0) return null;
  const vs = values.length === 1 ? [values[0], values[0]] : values;
  const W = 100;
  const H = 32;
  const PAD = 2;
  const max = Math.max(...vs);
  const min = Math.min(...vs);
  const span = max - min || 1;
  const step = W / (vs.length - 1);
  const pts = vs.map((v, i) => [i * step, H - PAD - ((v - min) / span) * (H - PAD * 2)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className={className}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
```

Create `frontend/src/components/admin/charts/AreaChart.tsx`:

```tsx
'use client';

import { useId, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

export interface ChartSeries {
  name: string;
  color: string;
  values: number[];
}

const W = 640;
const H = 240;
const PAD = { l: 64, r: 12, t: 12, b: 28 };
const IW = W - PAD.l - PAD.r;
const IH = H - PAD.t - PAD.b;

function niceMax(v: number): number {
  const pow = 10 ** Math.floor(Math.log10(v));
  const f = v / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

// Gráfico de área com N séries. Acessível: o grupo é focável (setas percorrem os
// dias e mostram o valor), e há uma tabela só para leitor de tela com todos os dados.
export function AreaChart({
  labels,
  series,
  format,
  formatAxis,
  ariaLabel,
}: {
  labels: string[];
  series: ChartSeries[];
  format: (n: number) => string;
  formatAxis?: (n: number) => string;
  ariaLabel: string;
}) {
  const gid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  if (n === 0) return null;

  const axis = formatAxis ?? format;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i: number) => PAD.l + (n > 1 ? (i / (n - 1)) * IW : IW / 2);
  const y = (v: number) => PAD.t + IH - (v / max) * IH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.max(1, Math.ceil(n / 6));

  const line = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = (values: number[]) =>
    `${line(values)} L${x(n - 1).toFixed(1)} ${(PAD.t + IH).toFixed(1)} L${x(0).toFixed(1)} ${(PAD.t + IH).toFixed(1)} Z`;

  const indexFromPointer = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    return Math.min(n - 1, Math.max(0, Math.round(((px - PAD.l) / IW) * (n - 1))));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setHover((h) => Math.max(0, (h ?? n) - 1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    } else if (e.key === 'Escape') {
      setHover(null);
    }
  };

  return (
    <div
      className="relative"
      tabIndex={0}
      role="group"
      aria-label={`${ariaLabel}. Use as setas para percorrer os dias.`}
      onKeyDown={onKeyDown}
      onFocus={() => setHover((h) => h ?? n - 1)}
      onBlur={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" aria-hidden="true">
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.name} id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={s.color} stopOpacity="0.28" />
              <stop offset="1" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--admin-border)" strokeWidth="1" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--admin-faint)">
              {axis(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % every === 0 || i === n - 1 ? (
            <text key={`${l}-${i}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--admin-faint)">
              {l}
            </text>
          ) : null,
        )}
        {series.map((s, i) => (
          <g key={s.name}>
            <path d={area(s.values)} fill={`url(#${gid}-${i})`} />
            <path d={line(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + IH} stroke="var(--admin-faint)" strokeDasharray="3 3" />
            {series.map((s) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r="4" fill={s.color} stroke="var(--admin-surface)" strokeWidth="2" />
            ))}
          </g>
        )}
        <rect
          x={PAD.l}
          y={PAD.t}
          width={IW}
          height={IH}
          fill="transparent"
          onPointerMove={(e) => setHover(indexFromPointer(e))}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      {hover !== null && (
        <div
          role="status"
          className="adm-card-2 pointer-events-none absolute top-2 min-w-36 px-3 py-2 text-xs shadow-lg"
          style={{ left: `${Math.min(70, Math.max(0, (x(hover) / W) * 100 - 8))}%` }}
        >
          <p className="font-semibold text-brand-900">{labels[hover]}</p>
          {series.map((s) => (
            <p key={s.name} className="mt-0.5 flex items-center gap-1.5 text-brand-700">
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.name}: <span className="font-medium text-brand-900">{format(s.values[hover])}</span>
            </p>
          ))}
        </div>
      )}

      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th>Dia</th>
            {series.map((s) => (
              <th key={s.name}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={`${l}-${i}`}>
              <td>{l}</td>
              {series.map((s) => (
                <td key={s.name}>{format(s.values[i])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Create `frontend/src/components/admin/charts/Gauge.tsx`:

```tsx
// Medidor circular. O número (ou "—") está sempre escrito no centro: a cor do
// arco (verde < 80%, âmbar 80–89%, vermelho ≥ 90%) é só reforço.
export function Gauge({
  percent,
  label,
  caption,
}: {
  percent: number | null;
  label: string;
  caption?: string;
}) {
  const R = 34;
  const C = 2 * Math.PI * R;
  const p = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  const color = p >= 90 ? '#f87171' : p >= 80 ? '#fbbf24' : '#34d399';
  const text = percent === null ? 'sem dado' : `${Math.round(p)}%`;
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 text-center">
      <div className="relative h-[84px] w-[84px]" role="img" aria-label={`${label}: ${text}`}>
        <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="42" cy="42" r={R} fill="none" stroke="var(--admin-border)" strokeWidth="7" />
          {percent !== null && (
            <circle
              cx="42"
              cy="42"
              r={R}
              fill="none"
              stroke={color}
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={`${(p / 100) * C} ${C}`}
            />
          )}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-brand-900">
          {percent === null ? '—' : `${Math.round(p)}%`}
        </span>
      </div>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">{label}</span>
      {caption && <span className="adm-text-faint text-[11px] leading-tight">{caption}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Checar tipos**

Run: `cd /opt/Montese/frontend && npx tsc --noEmit && echo "tipos ok"` → sem erros.

- [ ] **Step 5: Commit**

```bash
cd /opt/Montese && git add frontend/src/components/admin/format.ts frontend/src/components/admin/useNow.ts frontend/src/components/admin/Card.tsx frontend/src/components/admin/charts/Sparkline.tsx frontend/src/components/admin/charts/AreaChart.tsx frontend/src/components/admin/charts/Gauge.tsx && git diff --cached --stat && git commit -m "$(cat <<'EOF'
feat: primitivos de card (estados, selo Em construção) e gráficos SVG do painel admin

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarefa 11: Visão Geral — cabeçalho, KPIs, saúde, alertas e financeiro

**Files:**
- Create: `frontend/src/components/admin/overview/KpiRow.tsx`
- Create: `frontend/src/components/admin/overview/HealthCard.tsx`
- Create: `frontend/src/components/admin/overview/AlertsCard.tsx`
- Create: `frontend/src/components/admin/overview/FinanceCard.tsx`
- Create: `frontend/src/components/admin/overview/Tile.tsx`
- Modify (reescrever): `frontend/src/app/admin/overview/page.tsx`

**Interfaces:**
- Consumes: tudo das Tarefas 8–10; endpoints `/api/overview`, `/api/admin/ai-usage`, `/api/ai-copilot/usage`, `/api/admin/dashboard/financeiro`; contexto `useAdminStatus()`.
- Produces: `Tile({ label: string; value: string; hint?: string })` (usar dentro de um `<dl>`), `KpiRow({ overview, miniMax, openrouter })`, `HealthCard({ className? })`, `AlertsCard({ className? })`, `FinanceCard({ state, dias, onDias, className? })`, `PERIODOS`, `type Periodo = 7 | 30 | 90` (usados na Tarefa 12).

- [ ] **Step 1: KPIs (MRR, clientes ativos, uso de IA)**

Create `frontend/src/components/admin/overview/KpiRow.tsx`:

```tsx
'use client';

import type { ReactNode } from 'react';
import { Sparkline } from '../charts/Sparkline';
import { AsyncBody } from '../Card';
import { fillDailySeries, formatCents, formatCompact, formatUsd, plural } from '../format';
import { AdminIcon } from '../icons';
import type { FetchState } from '../useAdminFetch';
import type { MiniMaxUsage, OpenRouterUsage, OverviewMetrics } from '../types';

type Tint = 'green' | 'blue' | 'violet';

const TINT: Record<Tint, string> = {
  green: 'bg-emerald-500/15 text-emerald-300',
  blue: 'bg-blue-500/15 text-blue-300',
  violet: 'bg-violet-500/15 text-violet-300',
};

function KpiCard({ icon, tint, label, children }: { icon: ReactNode; tint: Tint; label: string; children: ReactNode }) {
  return (
    <div className="adm-card flex min-w-0 items-start gap-4 p-4 sm:p-5">
      <span aria-hidden="true" className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${TINT[tint]}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-brand-700">{label}</p>
        {children}
      </div>
    </div>
  );
}

const VALUE = 'mt-1 text-[26px] font-bold leading-tight text-brand-900';
const NOTE = 'mt-1 text-xs text-brand-700';

function OpenRouterLine({ state }: { state: FetchState<OpenRouterUsage> }) {
  if (state.data === null) return <>{state.error ? 'OpenRouter indisponível' : 'OpenRouter: carregando…'}</>;
  const o = state.data;
  if (!o.configured) return <>OpenRouter não configurado</>;
  if (o.error) return <>OpenRouter: falha ao consultar</>;
  return (
    <>
      {typeof o.usage_monthly === 'number'
        ? `OpenRouter: ${formatUsd(o.usage_monthly)} este mês`
        : 'OpenRouter: sem dado do mês'}
      {o.low_balance_warning && <span className="text-amber-300"> · saldo baixo</span>}
    </>
  );
}

export function KpiRow({
  overview,
  miniMax,
  openrouter,
}: {
  overview: FetchState<OverviewMetrics>;
  miniMax: FetchState<MiniMaxUsage>;
  openrouter: FetchState<OpenRouterUsage>;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <KpiCard icon={<AdminIcon name="dollar" className="h-6 w-6" />} tint="green" label="MRR (assinaturas ativas)">
        <AsyncBody state={overview} rows={2}>
          {(m) => (
            <>
              <p className={VALUE}>{formatCents(m.receita_mensal_cents)}</p>
              <p className={NOTE}>{plural(m.assinaturas_ativas, 'assinatura ativa', 'assinaturas ativas')}</p>
            </>
          )}
        </AsyncBody>
      </KpiCard>

      <KpiCard icon={<AdminIcon name="building" className="h-6 w-6" />} tint="blue" label="Clientes ativos">
        <AsyncBody state={overview} rows={2}>
          {(m) => (
            <>
              <p className={VALUE}>{m.empresas_ativas}</p>
              <p className={NOTE}>
                {`${plural(m.tecnicos_vinculados, 'técnico', 'técnicos')} · ${plural(m.parceiros_vinculados, 'parceiro', 'parceiros')} vinculados`}
              </p>
            </>
          )}
        </AsyncBody>
      </KpiCard>

      <KpiCard icon={<AdminIcon name="sparkle" className="h-6 w-6" />} tint="violet" label="Uso de IA (7 dias)">
        <AsyncBody state={miniMax} rows={2}>
          {(u) => {
            const serie = fillDailySeries(u.last_7_days);
            const total7 = serie.reduce((sum, d) => sum + d.total_tokens, 0);
            return (
              <div className="mt-1 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[26px] font-bold leading-tight text-brand-900">
                    {formatCompact(total7)} <span className="text-sm font-medium text-brand-700">tokens</span>
                  </p>
                  <p className={NOTE}>
                    <OpenRouterLine state={openrouter} />
                  </p>
                </div>
                <Sparkline values={serie.map((d) => d.total_tokens)} color="#a78bfa" label="Tokens por dia nos últimos 7 dias" />
              </div>
            );
          }}
        </AsyncBody>
      </KpiCard>
    </div>
  );
}
```

- [ ] **Step 2: Saúde do sistema (resumo) e alertas**

Create `frontend/src/components/admin/overview/HealthCard.tsx`:

```tsx
'use client';

import { useAdminStatus } from '../AdminStatusProvider';
import { Card, CardError, CardSkeleton, UnderConstructionBadge } from '../Card';
import { AdminIcon } from '../icons';
import { deriveSystemState, SYSTEM_STATE_LABEL } from '../status-state';

// Resumo do estado do sistema. O detalhe por serviço está no card "Status dos
// serviços". O "score geral" (%) da referência NÃO existe ainda: selo, sem número.
export function HealthCard({ className = '' }: { className?: string }) {
  const { system, refresh } = useAdminStatus();
  const state = deriveSystemState(system);
  const s = system.data?.services;
  const up = s ? [s.postgres.reachable, s.redis.reachable, s.frontend.reachable].filter(Boolean).length : 0;
  const ok = state === 'online';

  return (
    <Card id="saude" title="Saúde do sistema" className={className}>
      {state === 'carregando' && <CardSkeleton rows={2} />}
      {state === 'sem-resposta' && (
        <CardError onRetry={refresh} message="Não foi possível consultar o servidor." />
      )}
      {(state === 'online' || state === 'degradado') && (
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
              ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
            }`}
          >
            <AdminIcon name={ok ? 'shield' : 'alert'} className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className={`text-lg font-semibold ${ok ? 'text-emerald-300' : 'text-red-300'}`}>
              {SYSTEM_STATE_LABEL[state]}
            </p>
            <p className="text-xs text-brand-700">{`${up} de 3 serviços monitorados acessíveis`}</p>
          </div>
        </div>
      )}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-brand-100 pt-3">
        <p className="text-xs text-brand-700">Score geral de saúde</p>
        <UnderConstructionBadge />
      </div>
    </Card>
  );
}
```

Create `frontend/src/components/admin/overview/AlertsCard.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useAdminStatus } from '../AdminStatusProvider';
import { Card, CardError, CardSkeleton } from '../Card';
import { formatTime } from '../format';
import { AdminIcon } from '../icons';
import type { AlertSeverity } from '../types';

const SEV: Record<AlertSeverity, { label: string; icon: 'alert' | 'info'; text: string; box: string }> = {
  critico: { label: 'Crítico', icon: 'alert', text: 'text-red-300', box: 'border-red-400/40 bg-red-400/10' },
  atencao: { label: 'Atenção', icon: 'alert', text: 'text-amber-300', box: 'border-amber-400/40 bg-amber-400/10' },
  info: { label: 'Info', icon: 'info', text: 'text-blue-300', box: 'border-blue-400/40 bg-blue-400/10' },
};

// "O que precisa da minha atenção" (spec §49). Calculado na hora no backend por
// regras determinísticas — sem persistência, então sem "há X min" por item.
export function AlertsCard({ className = '' }: { className?: string }) {
  const { alertas, refresh } = useAdminStatus();
  const data = alertas.data;

  return (
    <Card
      id="alertas"
      title="Precisa da sua atenção"
      subtitle={data ? `Verificado às ${formatTime(data.gerado_em)}` : undefined}
      className={className}
    >
      {data === null && !alertas.error && <CardSkeleton rows={3} />}
      {data === null && alertas.error && <CardError onRetry={refresh} message="Não foi possível carregar os alertas." />}
      {data !== null && data.itens.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <AdminIcon name="check" className="h-7 w-7 text-emerald-400" />
          <p className="text-sm text-brand-700">Nenhum alerta — tudo certo.</p>
        </div>
      )}
      {data !== null && data.itens.length > 0 && (
        <ul className="-mx-2 flex flex-col">
          {data.itens.map((item) => {
            const s = SEV[item.severidade];
            return (
              <li key={item.id}>
                <Link href={item.href} className="flex items-start gap-3 rounded-lg p-2 hover:bg-brand-50">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${s.box} ${s.text}`}
                  >
                    <AdminIcon name={s.icon} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[11px] font-semibold uppercase tracking-wide ${s.text}`}>{s.label}</span>
                    <span className="mt-0.5 block text-sm font-medium text-brand-900">{item.titulo}</span>
                    <span className="block text-xs text-brand-700">{item.detalhe}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {data !== null && alertas.error && (
        <p className="mt-2 text-xs text-amber-300">A última verificação falhou; exibindo a leitura anterior.</p>
      )}
    </Card>
  );
}
```

- [ ] **Step 3: Faturamento e recebimentos**

Create `frontend/src/components/admin/overview/Tile.tsx`:

```tsx
// Bloco de métrica pequeno. Deve ficar dentro de um <dl> (dt = rótulo, dd = valor e dica).
export function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="adm-card-2 min-w-0 p-3">
      <dt className="text-xs text-brand-700">{label}</dt>
      <dd className="mt-1 truncate text-lg font-semibold text-brand-900">{value}</dd>
      {hint && <dd className="mt-0.5 truncate text-[11px] text-brand-700">{hint}</dd>}
    </div>
  );
}
```

Create `frontend/src/components/admin/overview/FinanceCard.tsx`:

```tsx
'use client';

import { AreaChart } from '../charts/AreaChart';
import { AsyncBody, Card, CardEmpty } from '../Card';
import { formatCents, formatCentsAxis, formatDayMonth } from '../format';
import type { FetchState } from '../useAdminFetch';
import type { FinanceiroResponse } from '../types';
import { Tile } from './Tile';

export const PERIODOS = [7, 30, 90] as const;
export type Periodo = (typeof PERIODOS)[number];

const COBRADO = '#60a5fa';
const APROVADO = '#34d399';

// "Cobrado" = todos os eventos de cobrança do Mercado Pago; "Aprovado" = os
// aprovados (é o que de fato entrou). Não usamos "faturamento/recebido" porque
// a base só registra eventos de cobrança — ver spec §6.
export function FinanceCard({
  state,
  dias,
  onDias,
  className = '',
}: {
  state: FetchState<FinanceiroResponse>;
  dias: Periodo;
  onDias: (d: Periodo) => void;
  className?: string;
}) {
  return (
    <Card
      id="financeiro"
      title="Faturamento e recebimentos"
      subtitle="Cobranças registradas pelo Mercado Pago"
      className={className}
      action={
        <div role="group" aria-label="Período do gráfico" className="flex rounded-lg border border-brand-100 p-0.5">
          {PERIODOS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={dias === d}
              onClick={() => onDias(d)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                dias === d ? 'bg-emerald-500/20 text-emerald-200' : 'text-brand-700 hover:text-brand-900'
              }`}
            >
              {d} dias
            </button>
          ))}
        </div>
      }
    >
      <AsyncBody state={state} rows={5}>
        {(f) => {
          const vazio = f.serie.every((p) => p.cobrado_cents === 0);
          return (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px]">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap gap-4 text-xs text-brand-700">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: COBRADO }} />
                    Cobrado
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: APROVADO }} />
                    Aprovado
                  </span>
                </div>
                {vazio ? (
                  <CardEmpty>Sem cobranças no período.</CardEmpty>
                ) : (
                  <AreaChart
                    labels={f.serie.map((p) => formatDayMonth(p.data))}
                    series={[
                      { name: 'Cobrado', color: COBRADO, values: f.serie.map((p) => p.cobrado_cents) },
                      { name: 'Aprovado', color: APROVADO, values: f.serie.map((p) => p.aprovado_cents) },
                    ]}
                    format={formatCents}
                    formatAxis={formatCentsAxis}
                    ariaLabel={`Cobrado e aprovado por dia nos últimos ${f.periodo_dias} dias`}
                  />
                )}
              </div>
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">
                <Tile label="Hoje (aprovado)" value={formatCents(f.hoje.aprovado_cents)} hint={`de ${formatCents(f.hoje.cobrado_cents)} cobrados`} />
                <Tile label="Pendente hoje" value={formatCents(f.hoje.pendente_cents)} hint="aguardando confirmação" />
                <Tile
                  label="No mês (aprovado)"
                  value={formatCents(f.mes.aprovado_cents)}
                  hint={`recusado ${formatCents(f.mes.recusado_cents)}`}
                />
              </dl>
            </div>
          );
        }}
      </AsyncBody>
    </Card>
  );
}
```

- [ ] **Step 4: Reescrever a página com a grade da referência (versão parcial — a Tarefa 12 completa)**

Rewrite `frontend/src/app/admin/overview/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useAdminStatus } from '@/components/admin/AdminStatusProvider';
import { relativeTime } from '@/components/admin/format';
import { AdminIcon } from '@/components/admin/icons';
import { AlertsCard } from '@/components/admin/overview/AlertsCard';
import { FinanceCard } from '@/components/admin/overview/FinanceCard';
import type { Periodo } from '@/components/admin/overview/FinanceCard';
import { HealthCard } from '@/components/admin/overview/HealthCard';
import { KpiRow } from '@/components/admin/overview/KpiRow';
import type { FinanceiroResponse, MiniMaxUsage, OpenRouterUsage, OverviewMetrics } from '@/components/admin/types';
import { useAdminFetch } from '@/components/admin/useAdminFetch';
import { useNow } from '@/components/admin/useNow';

export default function AdminOverviewPage() {
  const status = useAdminStatus();
  const now = useNow();
  const [refreshKey, setRefreshKey] = useState(0);
  const [dias, setDias] = useState<Periodo>(30);

  const overview = useAdminFetch<OverviewMetrics>('/api/overview', refreshKey);
  const miniMax = useAdminFetch<MiniMaxUsage>('/api/admin/ai-usage', refreshKey);
  const openrouter = useAdminFetch<OpenRouterUsage>('/api/ai-copilot/usage', refreshKey);
  const financeiro = useAdminFetch<FinanceiroResponse>(`/api/admin/dashboard/financeiro?dias=${dias}`, refreshKey);

  const refreshAll = () => {
    setRefreshKey((k) => k + 1);
    status.refresh();
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-brand-900">Visão Geral</h2>
          <p className="mt-1 text-sm text-brand-700">
            Acompanhe o desempenho, as finanças, os clientes e a saúde do sistema.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-brand-700">
          <span>{status.lastUpdated ? `Status atualizado ${relativeTime(status.lastUpdated, now)}` : 'Carregando…'}</span>
          <button
            type="button"
            onClick={refreshAll}
            className="flex items-center gap-1.5 rounded-lg border border-brand-100 px-3 py-1.5 font-medium text-brand-900 hover:bg-brand-50"
          >
            <AdminIcon name="refresh" className="h-4 w-4" />
            Atualizar
          </button>
        </div>
      </div>

      {/* Mobile: uma coluna, "Precisa da sua atenção" primeiro (order-*).
          ≥ xl: duas colunas independentes (os wrappers deixam de ser `contents`). */}
      <div className="mt-6 flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
        <div className="contents xl:flex xl:flex-col xl:gap-4">
          <div className="order-2 xl:order-none">
            <KpiRow overview={overview} miniMax={miniMax} openrouter={openrouter} />
          </div>
          <div className="order-4 xl:order-none">
            <FinanceCard state={financeiro} dias={dias} onDias={setDias} />
          </div>
        </div>
        <div className="contents xl:flex xl:flex-col xl:gap-4">
          <div className="order-1 xl:order-none">
            <AlertsCard />
          </div>
          <div className="order-3 xl:order-none">
            <HealthCard />
          </div>
        </div>
      </div>
    </div>
  );
}
```

O subtítulo **não** diz "em tempo real" (a spec do fundador §7 usa a expressão, mas os dados atualizam a cada 60 s ou ao clicar em Atualizar — não afirmamos o que não é verdade).

- [ ] **Step 5: Verificar**

```bash
cd /opt/Montese/frontend && npx tsc --noEmit && echo "tipos ok"
cd "$SCRATCH/qa"
node shots.mjs cheio out /admin/overview desktop,tablet,mobile
node shots.mjs vazio out /admin/overview desktop
node shots.mjs degradado out /admin/overview desktop
node shots.mjs erro out /admin/overview desktop
```

Abra os PNGs e confira:
1. **`cheio` desktop:** 3 KPIs (MRR R$ 6.423,00 · 9 assinaturas ativas; 12 clientes · "5 técnicos · 3 parceiros vinculados"; tokens de 7 dias com sparkline roxo e "OpenRouter: US$ 1,93 este mês"); gráfico "Cobrado × Aprovado" com eixos em R$ e datas `DD/MM`; painéis Hoje/Pendente/No mês; coluna direita com "Precisa da sua atenção" (1 atenção + 1 info, cada um com rótulo em texto) e "Saúde do sistema" (Sistema online · 3 de 3, selo "Em construção" no score).
2. **Botões 7/30/90 dias** mudam o gráfico (rode `QA_CLICK='button:has-text("7 dias")' QA_TAG=7d node shots.mjs cheio out /admin/overview desktop` e confira 7 pontos).
3. **`vazio`:** "Sem cobranças no período.", alertas "Nenhum alerta — tudo certo.", KPIs zerados — **sem** números inventados.
4. **`degradado`:** alertas críticos em vermelho com rótulo "Crítico"; "Sistema degradado · 2 de 3".
5. **`erro`:** cada card mostra "Não foi possível carregar…" + "Tentar novamente"; a página não quebra.
6. **Mobile:** ordem = alertas → KPIs → saúde → financeiro; sem rolagem horizontal da página.
7. Nenhum `pageerror` no log.

- [ ] **Step 6: Commit**

```bash
cd /opt/Montese && git add frontend/src/components/admin/overview/KpiRow.tsx frontend/src/components/admin/overview/HealthCard.tsx frontend/src/components/admin/overview/AlertsCard.tsx frontend/src/components/admin/overview/FinanceCard.tsx frontend/src/components/admin/overview/Tile.tsx frontend/src/app/admin/overview/page.tsx && git diff --cached --stat && git commit -m "$(cat <<'EOF'
feat: Visão Geral do admin com KPIs, saúde do sistema, alertas e gráfico financeiro (dados reais)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarefa 12: Visão Geral — serviços, VPS, IA & tokens, clientes, pagamentos, logs e cards "Em construção"

**Files:**
- Create: `frontend/src/components/admin/overview/labels.ts`
- Create: `frontend/src/components/admin/overview/ServicesCard.tsx`
- Create: `frontend/src/components/admin/overview/VpsCard.tsx`
- Create: `frontend/src/components/admin/overview/AiTokensCard.tsx`
- Create: `frontend/src/components/admin/overview/RecentClientsCard.tsx`
- Create: `frontend/src/components/admin/overview/RecentPaymentsCard.tsx`
- Create: `frontend/src/components/admin/overview/RecentLogsCard.tsx`
- Modify (reescrever): `frontend/src/app/admin/overview/page.tsx`

**Interfaces:**
- Consumes: Tarefas 8–11 (`Card`, `AsyncBody`, `Badge`, `Tone`, `Tile`, `Gauge`, formatadores, `useAdminStatus`, `useAdminFetch`, tipos).
- Produces: `labels.ts` — `TENANT_STATUS`, `PAYMENT_STATUS` (`Record<string, { label: string; tone: Tone }>`), `statusOf(map, key)`, `logLevel(statusCode: number): 'ERRO' | 'AVISO' | 'INFO'`, `LOG_TONE`, `planLabel(plano: string): string`; os 6 cards (`ServicesCard({ className? })`, `VpsCard({ className? })`, `AiTokensCard({ miniMax, className? })`, `RecentClientsCard({ state, className? })`, `RecentPaymentsCard({ state, className? })`, `RecentLogsCard({ state, className? })`).

- [ ] **Step 1: Rótulos**

Create `frontend/src/components/admin/overview/labels.ts`:

```ts
import type { Tone } from '../Card';

// Estados em português. Chave desconhecida cai no valor bruto (statusOf) —
// nunca escondemos um status novo do Mercado Pago.
export const TENANT_STATUS: Record<string, { label: string; tone: Tone }> = {
  ativo: { label: 'Ativo', tone: 'ok' },
  pendente: { label: 'Pendente', tone: 'warn' },
  inativo: { label: 'Inativo', tone: 'neutral' },
};

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  approved: { label: 'Aprovado', tone: 'ok' },
  authorized: { label: 'Autorizado', tone: 'info' },
  pending: { label: 'Pendente', tone: 'warn' },
  in_process: { label: 'Em análise', tone: 'warn' },
  in_mediation: { label: 'Em mediação', tone: 'warn' },
  rejected: { label: 'Recusado', tone: 'bad' },
  cancelled: { label: 'Cancelado', tone: 'bad' },
  refunded: { label: 'Estornado', tone: 'neutral' },
  charged_back: { label: 'Contestado', tone: 'bad' },
};

export function statusOf(
  map: Record<string, { label: string; tone: Tone }>,
  key: string,
): { label: string; tone: Tone } {
  return map[key] ?? { label: key, tone: 'neutral' };
}

export type LogLevel = 'ERRO' | 'AVISO' | 'INFO';

// Nível derivado do status HTTP registrado na auditoria (não é um log de aplicação).
export function logLevel(statusCode: number): LogLevel {
  if (statusCode >= 500) return 'ERRO';
  if (statusCode >= 400) return 'AVISO';
  return 'INFO';
}

export const LOG_TONE: Record<LogLevel, Tone> = { ERRO: 'bad', AVISO: 'warn', INFO: 'info' };

export function planLabel(plano: string): string {
  return plano === 'trial' ? 'Trial' : plano;
}
```

- [ ] **Step 2: Serviços e VPS**

Create `frontend/src/components/admin/overview/ServicesCard.tsx`:

```tsx
'use client';

import { useAdminStatus } from '../AdminStatusProvider';
import { Card, CardError, CardSkeleton, UnderConstructionBadge } from '../Card';
import { plural } from '../format';
import { AdminIcon } from '../icons';
import { deriveSystemState } from '../status-state';

function ServiceRow({ name, ok, detail }: { name: string; ok: boolean; detail?: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span className="flex min-w-0 items-center gap-2.5">
        <AdminIcon
          name={ok ? 'check' : 'alert'}
          className={`h-[18px] w-[18px] shrink-0 ${ok ? 'text-emerald-400' : 'text-red-400'}`}
        />
        <span className="min-w-0">
          <span className="block text-sm text-brand-900">{name}</span>
          {detail && <span className="block text-xs text-brand-700">{detail}</span>}
        </span>
      </span>
      <span className={`shrink-0 text-xs font-semibold ${ok ? 'text-emerald-300' : 'text-red-300'}`}>
        {ok ? 'Online' : 'Fora do ar'}
      </span>
    </li>
  );
}

// Só os 3 serviços que o backend realmente checa (Postgres, Redis, Site).
// O resto da referência (Qdrant, Docker, worker…) NÃO é medido: fica em texto
// com selo, sem bolinha verde.
export function ServicesCard({ className = '' }: { className?: string }) {
  const { system, refresh } = useAdminStatus();
  const state = deriveSystemState(system);
  const s = system.data?.services;
  const show = s && (state === 'online' || state === 'degradado');
  const up = s ? [s.postgres.reachable, s.redis.reachable, s.frontend.reachable].filter(Boolean).length : 0;

  return (
    <Card id="servicos" title="Status dos serviços" subtitle={show ? `${up} de 3 online` : undefined} className={className}>
      {state === 'carregando' && <CardSkeleton rows={3} />}
      {state === 'sem-resposta' && <CardError onRetry={refresh} message="Não foi possível consultar os serviços." />}
      {show && s && (
        <ul className="divide-y divide-brand-100">
          <ServiceRow
            name="PostgreSQL"
            ok={s.postgres.reachable}
            detail={
              s.postgres.active_connections !== null
                ? plural(s.postgres.active_connections, 'conexão ativa', 'conexões ativas')
                : undefined
            }
          />
          <ServiceRow name="Redis" ok={s.redis.reachable} />
          <ServiceRow name="Site (frontend)" ok={s.frontend.reachable} />
        </ul>
      )}
      <div className="mt-3 flex items-start justify-between gap-3 border-t border-brand-100 pt-3">
        <p className="text-xs text-brand-700">Qdrant, Docker, worker, WhatsApp e Mercado Pago ainda não são monitorados.</p>
        <UnderConstructionBadge />
      </div>
    </Card>
  );
}
```

Create `frontend/src/components/admin/overview/VpsCard.tsx`:

```tsx
'use client';

import { useAdminStatus } from '../AdminStatusProvider';
import { Card, CardError, CardSkeleton, UnderConstructionBadge } from '../Card';
import { Gauge } from '../charts/Gauge';
import { plural } from '../format';
import { deriveSystemState } from '../status-state';

const gb = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

// RAM, disco e carga vêm de /system-status (leitura instantânea do host). Rede
// e histórico de 24 h NÃO existem ainda: selo. "Carga" = média de 1 min ÷ núcleos.
export function VpsCard({ className = '' }: { className?: string }) {
  const { system, refresh } = useAdminStatus();
  const state = deriveSystemState(system);
  const d = system.data;
  const show = d && (state === 'online' || state === 'degradado');

  return (
    <Card id="vps" title="Servidor (VPS)" subtitle="Leitura instantânea" className={className}>
      {state === 'carregando' && <CardSkeleton rows={4} />}
      {state === 'sem-resposta' && <CardError onRetry={refresh} message="Não foi possível consultar o servidor." />}
      {show && d && (
        <div className="grid grid-cols-3 gap-2">
          <Gauge
            percent={d.memory.used_percent}
            label="RAM"
            caption={`${gb(d.memory.total_gb - d.memory.free_gb)} de ${gb(d.memory.total_gb)} GB`}
          />
          <Gauge
            percent={d.disk.used_percent}
            label="Disco"
            caption={`${gb(d.disk.total_gb - d.disk.free_gb)} de ${gb(d.disk.total_gb)} GB`}
          />
          <Gauge
            percent={Math.min(100, (d.cpu.load_avg_1m / d.cpu.cores) * 100)}
            label="Carga"
            caption={`${d.cpu.load_avg_1m.toFixed(2)} em ${plural(d.cpu.cores, 'núcleo', 'núcleos')}`}
          />
        </div>
      )}
      <div className="mt-3 flex items-start justify-between gap-3 border-t border-brand-100 pt-3">
        <p className="text-xs text-brand-700">Rede e histórico de 24 horas.</p>
        <UnderConstructionBadge />
      </div>
    </Card>
  );
}
```

- [ ] **Step 3: IA & tokens**

Create `frontend/src/components/admin/overview/AiTokensCard.tsx`:

```tsx
'use client';

import { AsyncBody, Card, CardEmpty } from '../Card';
import { fillDailySeries, formatCompact, formatInt } from '../format';
import type { FetchState } from '../useAdminFetch';
import type { MiniMaxUsage } from '../types';
import { Tile } from './Tile';

// Dados de /admin/ai-usage (tabela minimax_usage_log): total, 7 dias e por
// capacidade. "Hoje" usa a data UTC (o endpoint agrupa por dia em UTC e não
// devolve dias sem uso — fillDailySeries preenche). A referência mostra "por
// agente" e "por modelo": aqui o que existe é "por capacidade"; modelo é SP2.
export function AiTokensCard({ miniMax, className = '' }: { miniMax: FetchState<MiniMaxUsage>; className?: string }) {
  return (
    <Card id="ia" title="IA & tokens" subtitle="MiniMax — chamadas registradas pela plataforma" className={className}>
      <AsyncBody state={miniMax} rows={4}>
        {(u) => {
          if (u.total_calls === 0) return <CardEmpty>Nenhuma chamada de IA registrada ainda.</CardEmpty>;
          const serie = fillDailySeries(u.last_7_days);
          const hoje = serie[serie.length - 1].total_tokens;
          const total7 = serie.reduce((sum, d) => sum + d.total_tokens, 0);
          const maxCap = Math.max(1, ...u.by_capability.map((c) => Number(c.total_tokens)));
          return (
            <>
              <dl className="grid grid-cols-3 gap-2">
                <Tile label="Hoje (UTC)" value={formatCompact(hoje)} />
                <Tile label="7 dias" value={formatCompact(total7)} />
                <Tile label="Total" value={formatCompact(u.total_tokens)} hint={`${formatInt(u.total_calls)} chamadas`} />
              </dl>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-brand-700">Por capacidade</p>
              <ul className="mt-2 flex flex-col gap-2.5">
                {u.by_capability.map((c) => (
                  <li key={c.capability}>
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="truncate text-brand-900">{c.capability}</span>
                      <span className="shrink-0 text-brand-700">
                        {`${formatCompact(Number(c.total_tokens))} · ${formatInt(Number(c.calls))} chamadas`}
                      </span>
                    </div>
                    <div className="adm-card-2 mt-1 h-1.5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-violet-400"
                        style={{ width: `${Math.max(2, (Number(c.total_tokens) / maxCap) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <a
                href="https://platform.minimax.io/user-center/payment/balance"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 text-xs font-medium text-emerald-400 hover:underline"
              >
                Ver saldo no painel da MiniMax
              </a>
            </>
          );
        }}
      </AsyncBody>
    </Card>
  );
}
```

- [ ] **Step 4: Clientes, pagamentos e logs**

Create `frontend/src/components/admin/overview/RecentClientsCard.tsx`:

```tsx
'use client';

import { AsyncBody, Badge, Card, CardEmpty, CardLink } from '../Card';
import { formatCents, formatDateTime, relativeTime } from '../format';
import type { FetchState } from '../useAdminFetch';
import { useNow } from '../useNow';
import type { ClienteRecente } from '../types';
import { planLabel, statusOf, TENANT_STATUS } from './labels';

export function RecentClientsCard({ state, className = '' }: { state: FetchState<ClienteRecente[]>; className?: string }) {
  const now = useNow();
  return (
    <Card
      id="clientes"
      title="Clientes recentes"
      subtitle="Últimas empresas cadastradas"
      action={<CardLink href="/admin/empresas">Ver todas</CardLink>}
      className={className}
    >
      <AsyncBody state={state} rows={4}>
        {(rows) =>
          rows.length === 0 ? (
            <CardEmpty>Nenhuma empresa cadastrada ainda.</CardEmpty>
          ) : (
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead>
                  <tr className="text-xs text-brand-700">
                    <th scope="col" className="px-1 pb-2 font-medium">Empresa</th>
                    <th scope="col" className="px-1 pb-2 font-medium">Plano</th>
                    <th scope="col" className="px-1 pb-2 font-medium">Status</th>
                    <th scope="col" className="px-1 pb-2 text-right font-medium">MRR</th>
                    <th scope="col" className="px-1 pb-2 font-medium">Último acesso</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const st = statusOf(TENANT_STATUS, c.status);
                    return (
                      <tr key={c.id} className="border-t border-brand-100">
                        <td className="px-1 py-2 font-medium text-brand-900">{c.nome}</td>
                        <td className="px-1 py-2 text-brand-700">{planLabel(c.plano)}</td>
                        <td className="px-1 py-2">
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </td>
                        <td className="px-1 py-2 text-right text-brand-900">
                          {c.mrr_cents === null ? '—' : formatCents(c.mrr_cents)}
                        </td>
                        <td
                          className="px-1 py-2 text-brand-700"
                          title={c.ultimo_acesso ? formatDateTime(c.ultimo_acesso) : 'Sem login registrado'}
                        >
                          {relativeTime(c.ultimo_acesso, now)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </AsyncBody>
    </Card>
  );
}
```

Create `frontend/src/components/admin/overview/RecentPaymentsCard.tsx`:

```tsx
'use client';

import { AsyncBody, Badge, Card, CardEmpty, CardLink } from '../Card';
import { formatCents, formatDateTime } from '../format';
import type { FetchState } from '../useAdminFetch';
import type { FinanceiroResponse } from '../types';
import { PAYMENT_STATUS, statusOf } from './labels';
import { Tile } from './Tile';

// Reaproveita a resposta do endpoint financeiro (resumo de hoje/mês + as 5
// últimas cobranças) — nenhuma chamada a mais.
export function RecentPaymentsCard({ state, className = '' }: { state: FetchState<FinanceiroResponse>; className?: string }) {
  return (
    <Card
      id="pagamentos"
      title="Pagamentos — Mercado Pago"
      subtitle="Últimas cobranças registradas"
      action={<CardLink href="/admin/financeiro">Ver todos</CardLink>}
      className={className}
    >
      <AsyncBody state={state} rows={4}>
        {(f) => (
          <>
            <dl className="grid grid-cols-3 gap-2">
              <Tile label="Hoje (aprovado)" value={formatCents(f.hoje.aprovado_cents)} />
              <Tile label="Pendente hoje" value={formatCents(f.hoje.pendente_cents)} />
              <Tile label="No mês (aprovado)" value={formatCents(f.mes.aprovado_cents)} />
            </dl>
            {f.recentes.length === 0 ? (
              <CardEmpty>Nenhuma cobrança registrada ainda.</CardEmpty>
            ) : (
              <div className="-mx-1 mt-3 overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead>
                    <tr className="text-xs text-brand-700">
                      <th scope="col" className="px-1 pb-2 font-medium">Cliente</th>
                      <th scope="col" className="px-1 pb-2 font-medium">Plano</th>
                      <th scope="col" className="px-1 pb-2 text-right font-medium">Valor</th>
                      <th scope="col" className="px-1 pb-2 font-medium">Status</th>
                      <th scope="col" className="px-1 pb-2 font-medium">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.recentes.map((p) => {
                      const st = statusOf(PAYMENT_STATUS, p.status);
                      return (
                        <tr key={p.id} className="border-t border-brand-100">
                          <td className="px-1 py-2 font-medium text-brand-900">{p.cliente ?? 'Sem vínculo'}</td>
                          <td className="px-1 py-2 text-brand-700">{p.plano ?? '—'}</td>
                          <td className="px-1 py-2 text-right text-brand-900">{formatCents(p.amount_cents)}</td>
                          <td className="px-1 py-2">
                            <Badge tone={st.tone}>{st.label}</Badge>
                          </td>
                          <td className="px-1 py-2 text-brand-700">{formatDateTime(p.occurred_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </AsyncBody>
    </Card>
  );
}
```

Create `frontend/src/components/admin/overview/RecentLogsCard.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { AsyncBody, Badge, Card, CardEmpty, CardLink } from '../Card';
import { formatDateTime } from '../format';
import type { FetchState } from '../useAdminFetch';
import type { AuditLogRow } from '../types';
import { LOG_TONE, logLevel } from './labels';
import type { LogLevel } from './labels';

const FILTROS = [
  { id: 'TODOS', label: 'Todos' },
  { id: 'ERRO', label: 'Erro' },
  { id: 'AVISO', label: 'Aviso' },
  { id: 'INFO', label: 'Info' },
] as const;
type Filtro = (typeof FILTROS)[number]['id'];

// Rotulado "Auditoria": são as ações registradas em audit_log, não logs de
// aplicação. NÃO exibe `detail` (pode conter e-mail em falhas de login).
export function RecentLogsCard({ state, className = '' }: { state: FetchState<AuditLogRow[]>; className?: string }) {
  const [filtro, setFiltro] = useState<Filtro>('TODOS');
  return (
    <Card
      id="logs"
      title="Logs recentes"
      subtitle="Auditoria — ações registradas"
      action={<CardLink href="/admin/auditoria">Ver todos</CardLink>}
      className={className}
    >
      <div role="group" aria-label="Filtrar por nível" className="mb-3 flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filtro === f.id}
            onClick={() => setFiltro(f.id)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
              filtro === f.id
                ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200'
                : 'border-brand-100 text-brand-700 hover:text-brand-900'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <AsyncBody state={state} rows={5}>
        {(rows) => {
          const visiveis = rows.filter((r) => filtro === 'TODOS' || logLevel(r.status_code) === (filtro as LogLevel));
          if (rows.length === 0) return <CardEmpty>Nenhum evento registrado.</CardEmpty>;
          if (visiveis.length === 0) return <CardEmpty>Nenhum evento neste nível.</CardEmpty>;
          return (
            <ul className="flex flex-col">
              {visiveis.map((r) => {
                const level = logLevel(r.status_code);
                return (
                  <li key={r.id} className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 border-t border-brand-100 py-2 text-xs">
                    <span className="text-brand-700">{formatDateTime(r.occurred_at)}</span>
                    <Badge tone={LOG_TONE[level]}>{level}</Badge>
                    <span className="min-w-0 truncate text-brand-900">
                      {`${r.resource_type} · ${r.action}`}
                      {r.ip_address && <span className="text-brand-700">{` · ${r.ip_address}`}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          );
        }}
      </AsyncBody>
    </Card>
  );
}
```

- [ ] **Step 5: Página final da Visão Geral**

Rewrite `frontend/src/app/admin/overview/page.tsx` inteiro:

```tsx
'use client';

import { useState } from 'react';
import { useAdminStatus } from '@/components/admin/AdminStatusProvider';
import { UnderConstructionCard } from '@/components/admin/Card';
import { relativeTime } from '@/components/admin/format';
import { AdminIcon } from '@/components/admin/icons';
import { AiTokensCard } from '@/components/admin/overview/AiTokensCard';
import { AlertsCard } from '@/components/admin/overview/AlertsCard';
import { FinanceCard } from '@/components/admin/overview/FinanceCard';
import type { Periodo } from '@/components/admin/overview/FinanceCard';
import { HealthCard } from '@/components/admin/overview/HealthCard';
import { KpiRow } from '@/components/admin/overview/KpiRow';
import { RecentClientsCard } from '@/components/admin/overview/RecentClientsCard';
import { RecentLogsCard } from '@/components/admin/overview/RecentLogsCard';
import { RecentPaymentsCard } from '@/components/admin/overview/RecentPaymentsCard';
import { ServicesCard } from '@/components/admin/overview/ServicesCard';
import { VpsCard } from '@/components/admin/overview/VpsCard';
import type {
  AuditLogRow,
  ClienteRecente,
  FinanceiroResponse,
  MiniMaxUsage,
  OpenRouterUsage,
  OverviewMetrics,
} from '@/components/admin/types';
import { useAdminFetch } from '@/components/admin/useAdminFetch';
import { useNow } from '@/components/admin/useNow';

export default function AdminOverviewPage() {
  const status = useAdminStatus();
  const now = useNow();
  const [refreshKey, setRefreshKey] = useState(0);
  const [dias, setDias] = useState<Periodo>(30);

  // Um fetch por endpoint; os cards recebem o estado e falham isolados.
  const overview = useAdminFetch<OverviewMetrics>('/api/overview', refreshKey);
  const miniMax = useAdminFetch<MiniMaxUsage>('/api/admin/ai-usage', refreshKey);
  const openrouter = useAdminFetch<OpenRouterUsage>('/api/ai-copilot/usage', refreshKey);
  const financeiro = useAdminFetch<FinanceiroResponse>(`/api/admin/dashboard/financeiro?dias=${dias}`, refreshKey);
  const clientes = useAdminFetch<ClienteRecente[]>('/api/admin/dashboard/clientes-recentes?limit=5', refreshKey);
  const logs = useAdminFetch<AuditLogRow[]>('/api/audit-log?limit=8', refreshKey);

  const refreshAll = () => {
    setRefreshKey((k) => k + 1);
    status.refresh();
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-brand-900">Visão Geral</h2>
          <p className="mt-1 text-sm text-brand-700">
            Acompanhe o desempenho, as finanças, os clientes e a saúde do sistema.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-brand-700">
          <span>{status.lastUpdated ? `Status atualizado ${relativeTime(status.lastUpdated, now)}` : 'Carregando…'}</span>
          <button
            type="button"
            onClick={refreshAll}
            className="flex items-center gap-1.5 rounded-lg border border-brand-100 px-3 py-1.5 font-medium text-brand-900 hover:bg-brand-50"
          >
            <AdminIcon name="refresh" className="h-4 w-4" />
            Atualizar
          </button>
        </div>
      </div>

      {/* Mobile: uma coluna, "Precisa da sua atenção" primeiro (order-*).
          ≥ xl: duas colunas independentes (os wrappers deixam de ser `contents`). */}
      <div className="mt-6 flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
        <div className="contents xl:flex xl:flex-col xl:gap-4">
          <div className="order-2 xl:order-none">
            <KpiRow overview={overview} miniMax={miniMax} openrouter={openrouter} />
          </div>
          <div className="order-4 xl:order-none">
            <FinanceCard state={financeiro} dias={dias} onDias={setDias} />
          </div>
          <div className="order-5 grid gap-4 md:grid-cols-2 xl:order-none xl:grid-cols-3">
            <ServicesCard />
            <VpsCard />
            <AiTokensCard miniMax={miniMax} className="md:col-span-2 xl:col-span-1" />
          </div>
          <div className="order-6 grid gap-4 md:grid-cols-2 xl:order-none">
            <RecentClientsCard state={clientes} className="md:col-span-2" />
            <RecentPaymentsCard state={financeiro} className="md:col-span-2" />
            <RecentLogsCard state={logs} />
            <UnderConstructionCard
              id="seguranca"
              title="Segurança"
              description="Tentativas de login, IPs bloqueados e sessões ativas ainda não são medidos aqui."
            />
          </div>
        </div>

        <div className="contents xl:flex xl:flex-col xl:gap-4">
          <div className="order-1 xl:order-none">
            <AlertsCard />
          </div>
          <div className="order-3 xl:order-none">
            <HealthCard />
          </div>
          <div className="order-7 xl:order-none">
            <UnderConstructionCard
              id="modelos"
              title="Uso de modelos e roteamento"
              description="Divisão de tokens por modelo e regras de roteamento entre provedores. Hoje o registro de uso guarda só a capacidade, não o modelo."
            />
          </div>
          <div className="order-8 xl:order-none">
            <UnderConstructionCard
              id="backups"
              title="Backups"
              description="O backup diário do Postgres roda por script na VPS; o status ainda não é exibido no painel."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verificar**

```bash
cd /opt/Montese/frontend && npx tsc --noEmit && echo "tipos ok"
cd "$SCRATCH/qa"
node shots.mjs cheio out /admin/overview desktop,tablet,mobile
node shots.mjs vazio out /admin/overview desktop,mobile
node shots.mjs degradado out /admin/overview desktop
node shots.mjs erro out /admin/overview desktop,mobile
QA_CLICK='button:has-text("Erro")' QA_TAG=filtro-erro node shots.mjs cheio out /admin/overview desktop
```

Abra os PNGs e confira (compare com `frontend/public/referencia/…`/a imagem de referência do fundador — mesma composição, com os limites reais):
1. **`cheio` desktop:** todos os cards presentes; o VPS mostra 3 medidores com número no centro (RAM 54%, Disco 48%, Carga); "IA & tokens" com Hoje/7 dias/Total e barras por capacidade; tabelas de clientes e pagamentos legíveis; logs com níveis em texto (ERRO/AVISO/INFO) e IP, **sem** o texto "ignorado pelo card"; três cards "Em construção" (Segurança, Uso de modelos, Backups) **sem nenhum número**.
2. **`-filtro-erro`:** só a linha de status 500 (nível ERRO).
3. **`vazio`:** estados vazios honestos em cada card ("Nenhuma empresa…", "Nenhuma cobrança…", "Nenhuma chamada de IA…", "Nenhum evento…").
4. **`degradado`:** VPS com RAM/Disco em vermelho e o **número** visível; serviços com Redis "Fora do ar".
5. **`erro`:** cada card mostra erro + "Tentar novamente"; os cards "Em construção" continuam normais.
6. **Tablet/mobile:** sem rolagem horizontal da página; tabelas rolam **dentro** do card.

- [ ] **Step 7: Commit**

```bash
cd /opt/Montese && git add frontend/src/components/admin/overview/labels.ts frontend/src/components/admin/overview/ServicesCard.tsx frontend/src/components/admin/overview/VpsCard.tsx frontend/src/components/admin/overview/AiTokensCard.tsx frontend/src/components/admin/overview/RecentClientsCard.tsx frontend/src/components/admin/overview/RecentPaymentsCard.tsx frontend/src/components/admin/overview/RecentLogsCard.tsx frontend/src/app/admin/overview/page.tsx && git diff --cached --stat && git commit -m "$(cat <<'EOF'
feat: Visão Geral completa do admin (serviços, VPS, IA, clientes, pagamentos, logs e cards Em construção)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tarefa 13: Varredura das telas antigas e verificações automáticas de acessibilidade/responsivo

**Files:**
- Scratch: `$SCRATCH/qa/checks.mjs`
- Modify (só se a varredura achar problema): `frontend/src/app/admin/{financeiro,empresas,empresas/[id],tecnicos,parceiros,normativa,checklist-sst,auditoria}/page.tsx`, `frontend/src/app/admin/admin-theme.css`

- [ ] **Step 1: Criar o script de verificações**

Create `$SCRATCH/qa/checks.mjs`:

```js
// Verificações automáticas do admin (QA). Playwright com respostas interceptadas.
// Uso: node checks.mjs      → imprime OK/FALHA por verificação; sai com código 1 se algo falhar.
import { chromium } from 'playwright';
import { respond } from './fixtures.mjs';

const BASE = process.env.QA_BASE ?? 'http://localhost:3100';
const ROTAS = [
  '/admin/overview', '/admin/financeiro', '/admin/empresas', '/admin/tecnicos',
  '/admin/parceiros', '/admin/normativa', '/admin/checklist-sst', '/admin/auditoria',
];
const VIEWPORTS = { desktop: [1440, 900], tablet: [820, 1100], mobile: [390, 844] };
let falhas = 0;
const check = (ok, msg) => { console.log(`${ok ? 'OK   ' : 'FALHA'} ${msg}`); if (!ok) falhas += 1; };

// ---- contraste WCAG (texto normal exige ≥ 4,5:1) ----
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const PARES = [
  ['texto principal / card', '#e6ecf7', '#0f1a2e'], ['texto principal / fundo', '#e6ecf7', '#0a1220'],
  ['secundário / card', '#9db0cc', '#0f1a2e'], ['secundário / fundo', '#9db0cc', '#0a1220'],
  ['secundário / card-2', '#9db0cc', '#14233b'], ['discreto / card', '#7b8fb0', '#0f1a2e'],
  ['discreto / sidebar', '#7b8fb0', '#08101d'], ['discreto / card-2', '#7b8fb0', '#14233b'],
  ['verde 400 / card', '#34d399', '#0f1a2e'], ['verde 300 / card', '#6ee7b7', '#0f1a2e'],
  ['vermelho 300 / card', '#fca5a5', '#0f1a2e'], ['vermelho 400 (telas antigas) / fundo', '#f87171', '#0a1220'],
  ['âmbar 300 / card', '#fcd34d', '#0f1a2e'], ['azul 300 / card', '#93c5fd', '#0f1a2e'],
];
for (const [nome, fg, bg] of PARES) check(ratio(fg, bg) >= 4.5, `contraste ${nome}: ${ratio(fg, bg).toFixed(2)}:1`);

const browser = await chromium.launch();
async function nova(vp, cenario = 'cheio') {
  const [width, height] = VIEWPORTS[vp];
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript(() => {
    localStorage.setItem('montese_token', 'qa-token-fixture');
    localStorage.setItem('montese_user', JSON.stringify({ id: 'qa', role: 'admin', tenantId: null }));
  });
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const { status, body } = respond(cenario, url.pathname, url.searchParams);
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await context.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  return { context, page, erros };
}
const abrir = async (page, rota) => { await page.goto(BASE + rota, { waitUntil: 'networkidle' }); await page.waitForTimeout(500); };

// 1) sem rolagem horizontal e sem erro de página, em todas as telas e larguras
for (const vp of Object.keys(VIEWPORTS)) {
  const { context, page, erros } = await nova(vp);
  for (const rota of ROTAS) {
    await abrir(page, rota);
    const excesso = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(excesso <= 0, `${vp} ${rota}: sem rolagem horizontal (excesso ${excesso}px)`);
  }
  check(erros.length === 0, `${vp}: sem erro de página (${erros.join(' | ') || 'nenhum'})`);
  await context.close();
}

// 2) Visão Geral: conteúdo honesto
{
  const { context, page } = await nova('desktop');
  await abrir(page, '/admin/overview');
  await page.waitForTimeout(400);
  check(!(await page.content()).includes('ignorado pelo card'), 'logs: o campo detail não é exibido');
  check((await page.locator('text=Em construção').count()) === 6,
    'exatamente 6 selos "Em construção" (score, rede/24h, serviços, modelos, segurança, backups)');
  for (const id of ['modelos', 'seguranca', 'backups']) {
    const texto = await page.locator(`#${id}`).innerText();
    check(!/\d/.test(texto), `card "${id}" em construção não tem nenhum número`);
  }
  check((await page.locator('#alertas').count()) === 1, 'existe o card #alertas (destino do sino)');
  const sino = await page.locator('a[href$="/admin/overview#alertas"]').first().getAttribute('aria-label');
  check(/1 alerta precisa de atenção/.test(sino ?? ''), `sino descreve a contagem (cenário cheio): "${sino}"`);
  await context.close();
}

// 3) teclado: link "pular", drawer e paleta
{
  const { context, page } = await nova('desktop');
  await abrir(page, '/admin/empresas');
  await page.keyboard.press('Tab');
  check((await page.evaluate(() => document.activeElement?.textContent?.trim())) === 'Pular para o conteúdo',
    'primeiro Tab foca "Pular para o conteúdo"');
  await page.keyboard.press('Control+k');
  check(await page.locator('[role="dialog"]').isVisible(), 'Ctrl+K abre a paleta');
  await page.keyboard.type('fin');
  check((await page.locator('[role="option"]').count()) === 1, 'digitar "fin" deixa 1 resultado');
  await page.keyboard.press('Enter');
  await page.waitForURL('**/admin/financeiro');
  check(page.url().endsWith('/admin/financeiro'), 'Enter na paleta navega para /admin/financeiro');
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  check(!(await page.locator('[role="dialog"]').isVisible()), 'Esc fecha a paleta');
  await context.close();
}
{
  const { context, page } = await nova('mobile');
  await abrir(page, '/admin/empresas');
  const sidebar = page.locator('#admin-sidebar');
  check((await sidebar.evaluate((el) => getComputedStyle(el).visibility)) === 'hidden', 'mobile: drawer fechado fica oculto');
  await page.click('button[aria-label="Abrir menu"]');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => !!document.activeElement?.closest('#admin-sidebar')), 'abrir o drawer leva o foco para dentro dele');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check((await sidebar.evaluate((el) => getComputedStyle(el).visibility)) === 'hidden', 'Esc fecha o drawer');
  check((await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Abrir menu',
    'Esc devolve o foco ao botão do menu');
  await context.close();
}

// 4) estado de erro: cards falham isolados, página não quebra
{
  const { context, page, erros } = await nova('desktop', 'erro');
  await abrir(page, '/admin/overview');
  const tentar = await page.locator('button:has-text("Tentar novamente")').count();
  check(tentar >= 5, `cenário erro: ${tentar} cards mostram "Tentar novamente"`);
  check(erros.length === 0, 'cenário erro: sem erro de página');
  await context.close();
}

await browser.close();
console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} verificação(ões) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
```

- [ ] **Step 2: Rodar as verificações**

Run: `cd "$SCRATCH/qa" && node checks.mjs`
Expected: todas `OK`, terminando em "Tudo certo.". Para cada `FALHA`: corrija a causa no código (não afrouxe a verificação), rode de novo. Falhas comuns: excesso de largura numa tela antiga (tabela larga → envolver em `<div className="overflow-x-auto">`), token de contraste (ajuste o valor em `admin-theme.css` e no `PARES`, mantendo os dois iguais), e o nome exato do botão/`aria-label` (a verificação e o componente têm que concordar).

- [ ] **Step 3: Varredura visual das 7 telas antigas**

```bash
cd "$SCRATCH/qa"
node shots.mjs cheio out /admin/financeiro,/admin/empresas,/admin/tecnicos,/admin/parceiros,/admin/normativa,/admin/checklist-sst,/admin/auditoria desktop,mobile
node shots.mjs erro out /admin/financeiro,/admin/empresas,/admin/tecnicos,/admin/parceiros,/admin/normativa,/admin/checklist-sst,/admin/auditoria desktop
```

Abra cada PNG com a ferramenta Read. Critérios por tela: texto legível (nada escuro sobre escuro nem claro sobre claro); formulários e inputs visíveis com borda; botões `bg-brand-500 text-white` verdes; mensagens de erro em vermelho claro; badges/alertas de fundo claro (`bg-*-50`) trocados por variantes escuras (ex.: `bg-red-500/10 text-red-300`, `bg-yellow-500/10 text-yellow-300`, `bg-green-500/10 text-green-300`); `<select>` e `<textarea>` no tema escuro (`color-scheme: dark` já está no wrapper). Anote e corrija **arquivo por arquivo**, trocando só as classes problemáticas (sem reescrever a tela). `grep -rn "bg-white\|bg-green-50\|bg-red-50\|bg-yellow-50\|-50 " frontend/src/app/admin` ajuda a achar os candidatos.

- [ ] **Step 4: Tipos, nova rodada e commit**

```bash
cd /opt/Montese/frontend && npx tsc --noEmit && echo "tipos ok"
cd "$SCRATCH/qa" && node checks.mjs
cd /opt/Montese && git status --short frontend/src/app/admin frontend/src/components/admin
```

Se houve correções, faça `git add` **só dos arquivos corrigidos** (liste-os explicitamente) e:

```bash
git commit -m "$(cat <<'EOF'
fix: ajustes de contraste e overflow nas telas antigas do admin após o tema escuro

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

Se nada precisou de correção, não há commit nesta tarefa.

---

## Tarefa 14: RAM, documentação e verificação final

**Files:**
- Modify (condicional): `backend/src/admin-dashboard/alert-rules.ts` (`RAM_ALERT_ENABLED`)
- Modify: `docs/roadmap.md`, `docs/compliance/matriz-conformidade.md`
- Modify (**não commitar**): `PRODUCT.md` (não versionado)

- [ ] **Step 1: Decidir se a regra de RAM entra ligada (spec §7)**

`used_percent` de memória vem de `os.freemem()`; em algumas versões do Node/libuv isso é `MemFree` (ignora cache) e superestima o uso.

```bash
grep -m1 '^FROM' /opt/Montese/backend/Dockerfile; node -v
node -e "
const os = require('os'), fs = require('fs');
const m = Object.fromEntries(fs.readFileSync('/proc/meminfo', 'utf8').trim().split('\n').map((l) => { const [k, v] = l.split(':'); return [k, parseInt(v)]; }));
const pct = (free) => ((m.MemTotal - free) / m.MemTotal * 100).toFixed(1) + '%';
console.log('os.freemem() :', (((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(1) + '%');
console.log('MemFree      :', pct(m.MemFree));
console.log('MemAvailable :', pct(m.MemAvailable));
"
```

Regra: mantenha `RAM_ALERT_ENABLED = true` **somente se** `os.freemem()` ficar a no máximo 3 pontos de `MemAvailable` **e** a versão do Node da imagem do backend (linha `FROM` acima) for ≥ à do host (20). Caso contrário, em `backend/src/admin-dashboard/alert-rules.ts` troque para:

```ts
// Desligada em 2026-09-21: os.freemem() (MemFree) superestimava o uso frente a
// MemAvailable na VPS (ver docs/roadmap.md, sub-projeto F). Religar depois de
// ler MemAvailable em system-status.
export const RAM_ALERT_ENABLED = false;
```

e rode `cd /opt/Montese/backend && npm run test:unit -- admin-alert-rules` (os testes de RAM passam `{ ramEnabled: true }` explicitamente, então continuam verdes). Registre o resultado da medição no roadmap (Step 3). Se alterou o arquivo, commit à parte: `git add backend/src/admin-dashboard/alert-rules.ts && git commit -m "fix: desliga o alerta de RAM até system-status ler MemAvailable"` (com a linha `Co-Authored-By`).

- [ ] **Step 2: `PRODUCT.md` (fica sem commit) e matriz de conformidade**

Em `/opt/Montese/PRODUCT.md`, com o Edit tool:

1. Trocar `- **Admin:** operação interna da Montese (Fase 7, ainda não construída).` por
   `- **Admin:** operação interna da Montese — painel \`/admin\` (Fase 7) já construído: gestão de empresas, técnicos e parceiros, financeiro (Mercado Pago), auditoria, base normativa, checklist SST e Visão Geral operacional (status da VPS, alertas, uso de IA); visual "Montese Control" em tema escuro.`
2. Trocar `Ainda **não construído** (roadmap, não produto hoje): Dashboard Admin (Fase 7) e Copiloto/Agente de IA (Fase 8) —` por `Ainda **não construído** (roadmap, não produto hoje): Copiloto/Agente de IA (Fase 8) —` (**não** mexer no resto da frase — ver o aviso no relatório final).
3. Trocar `Não inventar outro telefone/endereço.` por `Dados cadastrais fornecidos pelo fundador em 2026-09-21: CNPJ 69.203.754/0001-45 e endereço comercial Avenida Marcolino Martins Cabral, nº 2644, Bairro Aeroporto, Tubarão/SC, CEP 88705-004 (fonte única: \`frontend/src/lib/company.ts\`). CNPJ só em rodapés e telas de pagamento; endereço só nos documentos legais. Razão social ainda não informada. Não inventar outro telefone, endereço ou razão social.`
4. Depois da linha que começa com `- Tipografia: Poppins.` adicionar: `- Painel admin ("Montese Control"): tema escuro marinho + verde da marca, escopado a \`/admin\` — exceção intencional ao tema claro do resto do produto (decisão do fundador em 2026-09-21).`

Em `/opt/Montese/docs/compliance/matriz-conformidade.md`:

```bash
grep -n "PREENCHER" /opt/Montese/docs/compliance/matriz-conformidade.md
```

- Na linha do item "Termos de Uso" (≈ 42): trocar o trecho `e dois placeholders explícitos (\`[RAZÃO SOCIAL/CNPJ — PREENCHER]\`, \`[CIDADE/ESTADO — PREENCHER]\`) aguardando dado real do fundador` por `CNPJ e endereço comercial preenchidos em 2026-09-21; seguem como placeholders explícitos a razão social (\`[RAZÃO SOCIAL — PREENCHER]\`) e o foro (\`[CIDADE/ESTADO — PREENCHER]\`), aguardando dado real do fundador`.
- No bullet "Dois placeholders nos Termos de Uso" (≈ 211): leia as linhas ao redor (`sed -n 205,218p`) e reescreva o bullet inteiro como: `**Placeholders nos Termos de Uso e na Política de Privacidade** — CNPJ (\`69.203.754/0001-45\`) e endereço comercial preenchidos em 2026-09-21 (fonte: \`frontend/src/lib/company.ts\`). Pendentes, dependem do fundador: **razão social** (\`[RAZÃO SOCIAL — PREENCHER]\`) e **foro** (\`[CIDADE/ESTADO — PREENCHER]\`, cláusula 10 dos Termos — escolha jurídica; não decorre do endereço da sede).` Preserve o restante da lista.

**Não** editar `docs/compliance/lgpd-compliance.md` (mudanças não commitadas do fundador).

- [ ] **Step 3: Roadmap**

```bash
tail -15 /opt/Montese/docs/roadmap.md
```

Acrescente ao **final** de `docs/roadmap.md` (ajuste só o resultado da medição de RAM):

```markdown

## Fase 7 (sub-projeto F — Montese Control SP1: shell escuro + Visão Geral): status

Primeiro sub-projeto da reformulação do painel `/admin` inspirada na referência
"Montese Control" do fundador (spec completa de 8 fases decomposta em
brainstorming de 2026-09-21). Spec em
[`docs/specs/admin-montese-control-shell-visao-geral.md`](specs/admin-montese-control-shell-visao-geral.md),
plano em
[`docs/superpowers/plans/2026-09-21-admin-montese-control-shell-visao-geral.md`](superpowers/plans/2026-09-21-admin-montese-control-shell-visao-geral.md).

**Implementado e verificado localmente** (unitário, e2e contra o Postgres real,
`tsc`, QA visual com respostas interceptadas em 3 larguras e 4 cenários,
verificações automáticas de contraste/teclado/overflow). **Deploy pendente**
(rebuild de frontend e backend exige o OK do fundador).

| Área | Estado |
|---|---|
| Shell (tema marinho + verde da marca, sidebar/drawer, topbar, Ctrl+K de navegação, logo) | ✅ |
| Visão Geral com dado real: MRR, clientes, uso de IA, alertas, financeiro, serviços, VPS, IA & tokens, clientes recentes, pagamentos, logs (auditoria) | ✅ |
| 3 endpoints `GET /admin/dashboard/{alertas,financeiro,clientes-recentes}` | ✅ (sem migration) |
| CNPJ nos rodapés e telas de pagamento; endereço só nos Termos/Privacidade | ✅ |
| Score de saúde, rede/histórico 24 h, Qdrant/Docker/worker/WhatsApp, uso por modelo/agente, segurança, backups | ⏳ "Em construção" na tela, sem número |

Achados: `users.last_login_at` existe mas nada a grava (último acesso vem de
`audit_log`); `/admin/ai-usage` não devolve dias sem uso (o cliente preenche);
`used_percent` de RAM — medição de 2026-09-21: `os.freemem()` = {A}%, `MemAvailable` = {B}% (Node do host {C}, imagem do backend {D}); alerta de RAM {ligado|desligado}.

Pendências do fundador: **razão social** (placeholder nos Termos e na
Privacidade) e **foro** dos Termos (escolha jurídica). Próximos sub-projetos:
SP2 IA & Tokens (custo por modelo/agente — exige migration), SP3 Infraestrutura
(histórico de CPU/RAM, rede), SP4 Logs & Segurança (o `audit_log` já tem
`login_success`/`login_failure` com IP), SP5 Backups, alertas persistentes e
Control AI.
```

Substitua `{A}`, `{B}`, `{C}`, `{D}` e a escolha `{ligado|desligado}` pelos valores medidos no Step 1 — o texto commitado **não pode** conter chaves `{}`.

- [ ] **Step 4: Verificação final completa**

```bash
cd /opt/Montese/backend && npm run test:unit -- admin-alert-rules
"$SCRATCH/run-net.sh" test:e2e -- admin-dashboard
"$SCRATCH/run-net.sh" test:e2e -- overview
"$SCRATCH/run-net.sh" test:e2e -- system-status
"$SCRATCH/run-net.sh" test:e2e -- audit-log
cd /opt/Montese/backend && npx tsc --noEmit -p tsconfig.json && echo "tipos backend ok"
cd /opt/Montese/frontend && npx tsc --noEmit && echo "tipos frontend ok"
cd "$SCRATCH/qa" && node checks.mjs
node shots.mjs cheio out /admin/overview desktop,tablet,mobile
```

Expected: tudo verde/OK. Abra `cheio-desktop-_admin_overview.png` uma última vez e compare com a imagem de referência do fundador (mesma composição, logo da Montese, dados reais ou selo "Em construção"). Confira também `curl -s http://localhost:3100/planos | grep -c "69.203.754/0001-45"` ≥ 1 e `curl -s http://localhost:3100/contato | grep -c Marcolino` = 0.

Auditoria dos commits (nada do fundador foi levado e nada fora do escopo mudou):

```bash
cd /opt/Montese && git log --oneline | head -20 && git status --short
```

Use o hash do commit do plano (a mensagem "docs: plano de implementação do shell escuro e da Visão Geral do admin") como base: `git diff --stat <hash-do-plano>..HEAD` deve listar **somente** arquivos desta entrega (backend `admin-dashboard/*` e seus testes, módulos `overview`/`system-status`/`app.module`, `frontend/src/{lib/company.ts,lib/legal.ts,components/{admin/**,PaymentIssuerNote.tsx,SiteFooter.tsx,DashboardFooter.tsx},app/admin/**,app/(site)/{planos,tecnico/planos,planos/assinatura-concluida}/page.tsx}`, `frontend/content/legal/*.mdx`, `frontend/public/brand/logo-icon-mark.png`, docs). As mudanças do fundador (`globals.css`, `Logo.tsx`, `SiteHeader`, `SiteLayout`, `next.config.js`, home, cadastro, contato, notícias, `lgpd-compliance.md` etc.) devem continuar como `M` no `git status`, **fora** dos commits.

- [ ] **Step 5: Encerrar o dev server e commitar a documentação**

```bash
kill "$(cat "$SCRATCH/next-dev.pid")" 2>/dev/null; sleep 1; (ss -ltn | grep -q ":3100 " && echo "AINDA NO AR — encerre o processo" || echo "dev server encerrado")
cd /opt/Montese && git check-ignore -q frontend/.next && echo ".next ignorado pelo git" || echo "ATENÇÃO: frontend/.next não está ignorado — avise o fundador, não apague"
git add docs/roadmap.md docs/compliance/matriz-conformidade.md && git diff --cached --stat && git commit -m "$(cat <<'EOF'
docs: roadmap do Montese Control SP1 e matriz de conformidade com CNPJ e endereço preenchidos

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

(`PRODUCT.md` fica de fora do commit — é não versionado.)

- [ ] **Step 6: Relatório final ao fundador (em português)**

Inclua, sem omitir: o que foi entregue e verificado (com os comandos e resultados reais); o que ficou "Em construção" e por quê; **pendências dele** — razão social e foro; **avisos** — (1) `WhatsAppButton.tsx` está não versionado e o HEAD do admin já o importava; (2) `PRODUCT.md` ainda diz "nenhuma chamada de IA existe no backend hoje" (desatualizado — existem MiniMax/OpenRouter), não editado por não ter sido verificado em detalhe; (3) as duas páginas de pagamento com mudança dele foram commitadas só com as linhas do CNPJ (ou, se o helper abortou, ficaram sem commit — dizer qual); (4) o resultado da checagem de RAM e se o alerta foi ligado; (5) o e2e deixou linhas de `login_success` em `audit_log` (a tabela é append-only por desenho, como nos e2e anteriores); (6) **deploy não foi feito** — exige o OK dele (sem override, nunca `down -v`); (7) o subtítulo da Visão Geral não diz "em tempo real" de propósito.
