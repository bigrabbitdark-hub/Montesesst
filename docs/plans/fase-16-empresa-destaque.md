# Fase 16 — Reconhecimento: Empresa Destaque Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um selo "🏆 Empresa Destaque" que aparece quando o score de conformidade de documentos de uma empresa é 100%, exibido no dashboard da própria empresa e na lista de empresas do técnico.

**Architecture:** Nenhuma tabela nova, nenhuma migration — `empresa_destaque: boolean` é computado nos dois pontos do backend que já calculam o score de documentos (`DashboardService.getSummary`/`DocumentsService.getPortfolioCompliance`), a partir do mesmo `score` já retornado hoje (`score === 100`). O frontend só exibe o campo novo nos dois lugares que já mostram o score.

**Tech Stack:** NestJS + Postgres no backend (sem SQL novo), Next.js App Router + Tailwind no frontend, sem test runner de frontend (Playwright manual contra produção).

**Spec:** `docs/specs/fase-16-empresa-destaque.md`

## Global Constraints

- `empresa_destaque = true` quando (e só quando) `score === 100` — nunca quando `score === null` (tenant sem nenhum documento com `expires_at` não é "vacuamente" destaque).
- Sem histórico/janela de tolerância — reflete o score calculado na própria consulta, exatamente como `score` já funciona hoje.
- Sem tabela nova, sem migration, sem scheduler/job novo.
- Sem ranking entre empresas, sem indicador de progresso dedicado, sem selo baixável/compartilhável — só um badge visual nos dois lugares que já existem.
- Backend tem suíte e2e real (Postgres real, sem mock de banco) — estender os arquivos já existentes `backend/test/dashboard-summary.e2e-spec.ts` e `backend/test/documents-portfolio.e2e-spec.ts`, não criar arquivos novos.
- Frontend sem test runner automatizado (`frontend/package.json` confirmado sem jest/vitest/testing-library) — verificação de frontend é manual, Playwright com sessão sintética via `localStorage` + `page.route()` mockando `/api/*`, contra a build de produção real (`docker compose build frontend`), mesmo padrão de toda fase anterior.

---

## Task 1: Backend — `empresa_destaque` no dashboard e na carteira do técnico

**Files:**
- Modify: `backend/src/dashboard/dashboard.service.ts`
- Modify: `backend/src/documents/documents.service.ts`
- Modify: `backend/test/dashboard-summary.e2e-spec.ts`
- Modify: `backend/test/documents-portfolio.e2e-spec.ts`

**Interfaces:**
- Consumes: `DocumentsService.getCompliance` (já existente, retorna `{score: number | null, pendencias, avisos}`, usado em `DashboardService.getSummary`); a agregação por tenant já existente dentro de `DocumentsService.getPortfolioCompliance` (`g.total`/`g.emDia` por grupo).
- Produces: `DashboardSummary.empresa_destaque: boolean` e `PortfolioComplianceItem.empresa_destaque: boolean` — consumidos pelo frontend (Task 2).

- [ ] **Step 1: `DashboardSummary.empresa_destaque`**

Modificar `backend/src/dashboard/dashboard.service.ts`:

Na interface `DashboardSummary` (linhas 18-29 hoje), adicionar o campo `empresa_destaque` logo depois de `score`:

```ts
export interface DashboardSummary {
  status: DashboardStatus;
  score: number | null;
  empresa_destaque: boolean;
  updated_at: string;
  resumo: {
    pendencias: number;
    avisos: number;
    acoes_concluidas: number;
    inspecoes_pendentes: number;
  };
  atencao: AttentionItem[];
  proximos_eventos: AttentionItem[];
}
```

No método `getSummary`, no objeto de retorno (hoje):

```ts
    return {
      status,
      score: compliance.score,
      updated_at: new Date().toISOString(),
      resumo: {
        pendencias,
        avisos,
        acoes_concluidas: await this.countAcoesConcluidas(client, tenantId),
        inspecoes_pendentes: inspecoesPendentes,
      },
      atencao: atencao.slice(0, 10),
      proximos_eventos,
    };
```

Trocar por:

```ts
    return {
      status,
      score: compliance.score,
      // Fase 16: selo "Empresa Destaque" — só quando o score de
      // documentos é exatamente 100 (nunca quando é null, i.e. tenant
      // sem nenhum documento com expires_at — não é "destaque
      // vacuamente", é ausência de dado).
      empresa_destaque: compliance.score === 100,
      updated_at: new Date().toISOString(),
      resumo: {
        pendencias,
        avisos,
        acoes_concluidas: await this.countAcoesConcluidas(client, tenantId),
        inspecoes_pendentes: inspecoesPendentes,
      },
      atencao: atencao.slice(0, 10),
      proximos_eventos,
    };
```

- [ ] **Step 2: `PortfolioComplianceItem.empresa_destaque`**

Modificar `backend/src/documents/documents.service.ts`:

Na interface `PortfolioComplianceItem` (linhas 50-56 hoje), adicionar o campo logo depois de `score`:

```ts
export interface PortfolioComplianceItem {
  tenant_id: string;
  tenant_name: string;
  score: number | null;
  empresa_destaque: boolean;
  pendencias_count: number;
  avisos_count: number;
}
```

No método `getPortfolioCompliance`, o `return order.map(...)` final (hoje):

```ts
    return order.map((tenantId) => {
      const g = groups.get(tenantId)!;
      return {
        tenant_id: tenantId,
        tenant_name: g.tenant_name,
        score: g.total === 0 ? null : Math.round((g.emDia / g.total) * 100),
        pendencias_count: g.pendencias,
        avisos_count: g.avisos,
      };
    });
```

Trocar por (extrai `score` pra uma variável local antes, pra `empresa_destaque` reusar exatamente o mesmo valor em vez de duplicar a expressão):

```ts
    return order.map((tenantId) => {
      const g = groups.get(tenantId)!;
      const score = g.total === 0 ? null : Math.round((g.emDia / g.total) * 100);
      return {
        tenant_id: tenantId,
        tenant_name: g.tenant_name,
        score,
        // Fase 16: mesmo critério de DashboardService.getSummary —
        // só true quando score é exatamente 100, nunca quando é null.
        empresa_destaque: score === 100,
        pendencias_count: g.pendencias,
        avisos_count: g.avisos,
      };
    });
```

- [ ] **Step 3: Teste e2e — `dashboard-summary.e2e-spec.ts`**

Modificar `backend/test/dashboard-summary.e2e-spec.ts`.

No teste já existente `'empresa sem nenhuma pendência recebe status ok e listas vazias'` (por volta da linha 64), adicionar duas asserções ao final do bloco (confirma o caso `score: null` → `empresa_destaque: false`, não `true`):

```ts
  it('empresa sem nenhuma pendência recebe status ok e listas vazias', async () => {
    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.resumo.pendencias).toBe(0);
    expect(res.body.resumo.avisos).toBe(0);
    expect(res.body.atencao).toEqual([]);
    expect(res.body.proximos_eventos).toEqual([]);
    expect(typeof res.body.updated_at).toBe('string');
    expect(res.body.score).toBeNull();
    expect(res.body.empresa_destaque).toBe(false);
  });
```

Adicionar um `it()` novo logo depois do teste `'agrega documento vencido, EPI vencendo e ação pendente em critico com itens de atenção corretos'` (que já limpa o próprio documento vencido no final, então o tenant fica sem nenhum `documents` pendente na sequência):

```ts
  it('empresa com todos os documentos em dia recebe score 100 e empresa_destaque true', async () => {
    const client = (db as any).client;

    const docRes = await client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR em dia teste', 'fixture/pgr-em-dia.pdf', 'pgr-em-dia.pdf', 'application/pdf', 100, $2, $3, 'empresa')
       RETURNING id`,
      [tenantId, iso(90), userId],
    );

    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.score).toBe(100);
    expect(res.body.empresa_destaque).toBe(true);

    await client.query('DELETE FROM documents WHERE id = $1', [docRes.rows[0].id]);
  });
```

- [ ] **Step 4: Teste e2e — `documents-portfolio.e2e-spec.ts`**

Modificar `backend/test/documents-portfolio.e2e-spec.ts`.

Adicionar a declaração `let tenantDId: string;` junto das outras (`tenantAId`/`tenantBId`/`tenantCId`, por volta da linha 10-12):

```ts
  let tenantAId: string;
  let tenantBId: string;
  let tenantCId: string;
  let tenantDId: string;
```

No `beforeAll`, depois da criação de `tenantC` (hoje):

```ts
    const tenantA = await db.createTenantWithUser('Empresa Portfolio A');
    const tenantB = await db.createTenantWithUser('Empresa Portfolio B (sem vencimento)');
    const tenantC = await db.createTenantWithUser('Empresa Portfolio C (nao vinculada)');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;
    tenantCId = tenantC.tenantId;
```

Adicionar a criação do tenant D logo depois (empresa com score 100, pra provar `empresa_destaque: true` na carteira do técnico — nenhum dos tenants A/B/C existentes tem score exatamente 100):

```ts
    const tenantA = await db.createTenantWithUser('Empresa Portfolio A');
    const tenantB = await db.createTenantWithUser('Empresa Portfolio B (sem vencimento)');
    const tenantC = await db.createTenantWithUser('Empresa Portfolio C (nao vinculada)');
    const tenantD = await db.createTenantWithUser('Empresa Portfolio D (destaque)');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;
    tenantCId = tenantC.tenantId;
    tenantDId = tenantD.tenantId;
```

Trocar o `INSERT INTO tenant_technicians` (hoje só linka A e B) pra também linkar D:

```ts
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2), ($3, $2), ($4, $2)',
      [tenantAId, technicianId, tenantBId, tenantDId],
    );
    // tenantC fica sem vínculo — deve ficar de fora da carteira do técnico.
```

Depois dos três `insertDocument(...)` já existentes, adicionar um documento em dia pro tenant D (único documento dele, então `score` fica em 100%):

```ts
    await insertDocument(tenantAId, tenantA.userId, 'pgr', 'PGR Vencido A', isoDateDaysFromNow(-5));
    await insertDocument(tenantAId, tenantA.userId, 'laudo', 'Laudo Em Dia A', isoDateDaysFromNow(90));
    await insertDocument(tenantCId, tenantC.userId, 'pgr', 'PGR C (não deve aparecer)', isoDateDaysFromNow(-1));
    await insertDocument(tenantDId, tenantD.userId, 'laudo', 'Laudo Em Dia D', isoDateDaysFromNow(90));
```

No teste `'GET /documents/compliance/portfolio devolve uma linha por empresa vinculada, com score e contagens corretos'`, trocar o corpo (hoje):

```ts
  it('GET /documents/compliance/portfolio devolve uma linha por empresa vinculada, com score e contagens corretos', async () => {
    const res = await request(app.getHttpServer())
      .get('/documents/compliance/portfolio')
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const byId: Record<string, any> = Object.fromEntries(res.body.map((item: any) => [item.tenant_id, item]));

    expect(byId[tenantAId].score).toBe(50);
    expect(byId[tenantAId].pendencias_count).toBe(1);
    expect(byId[tenantAId].avisos_count).toBe(0);

    expect(byId[tenantBId].score).toBeNull();
    expect(byId[tenantBId].pendencias_count).toBe(0);
    expect(byId[tenantBId].avisos_count).toBe(0);

    expect(byId[tenantCId]).toBeUndefined();
  });
```

Por:

```ts
  it('GET /documents/compliance/portfolio devolve uma linha por empresa vinculada, com score, empresa_destaque e contagens corretos', async () => {
    const res = await request(app.getHttpServer())
      .get('/documents/compliance/portfolio')
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);

    const byId: Record<string, any> = Object.fromEntries(res.body.map((item: any) => [item.tenant_id, item]));

    expect(byId[tenantAId].score).toBe(50);
    expect(byId[tenantAId].empresa_destaque).toBe(false);
    expect(byId[tenantAId].pendencias_count).toBe(1);
    expect(byId[tenantAId].avisos_count).toBe(0);

    expect(byId[tenantBId].score).toBeNull();
    expect(byId[tenantBId].empresa_destaque).toBe(false);
    expect(byId[tenantBId].pendencias_count).toBe(0);
    expect(byId[tenantBId].avisos_count).toBe(0);

    expect(byId[tenantDId].score).toBe(100);
    expect(byId[tenantDId].empresa_destaque).toBe(true);
    expect(byId[tenantDId].pendencias_count).toBe(0);
    expect(byId[tenantDId].avisos_count).toBe(0);

    expect(byId[tenantCId]).toBeUndefined();
  });
```

- [ ] **Step 5: Verificar manualmente — build + suíte completa**

Run: `docker compose build backend` — confirmar zero erros de TypeScript.

Rodar a suíte e2e completa uma vez via container efêmero (mecanismo já validado em toda fase anterior desta sessão — `docker-compose.override.yml` local/temporário/nunca commitado, montando `./backend:/app` + volume anônimo em `/app/node_modules` + `NODE_ENV: development`):

```bash
docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit"
```

Confirmar `dashboard-summary.e2e-spec.ts` e `documents-portfolio.e2e-spec.ts` como `PASS`. Falhas em outras suítes com `Received: 429` são o rate limiter global já documentado em fases anteriores desta sessão (não relacionado a esta task) — confirme por `grep` que são só isso antes de seguir. Deletar o override ao final.

- [ ] **Step 6: Commit**

```bash
git add backend/src/dashboard/dashboard.service.ts backend/src/documents/documents.service.ts backend/test/dashboard-summary.e2e-spec.ts backend/test/documents-portfolio.e2e-spec.ts
git commit -m "feat: selo Empresa Destaque — empresa_destaque no dashboard e na carteira do técnico"
```

---

## Task 2: Frontend — badge no dashboard da empresa e na lista do técnico

**Files:**
- Modify: `frontend/src/app/empresa/dashboard/page.tsx`
- Modify: `frontend/src/app/tecnico/empresas/page.tsx`

**Interfaces:**
- Consumes: `GET /api/dashboard/summary` (Task 1, agora com `empresa_destaque: boolean`); `GET /api/documents/compliance/portfolio` (Task 1, agora com `empresa_destaque: boolean` por item).
- Produces: nada consumido por task seguinte (última task da fase).

- [ ] **Step 1: Dashboard da empresa**

Modificar `frontend/src/app/empresa/dashboard/page.tsx`.

Na interface `DashboardSummary` local (linhas 24-36 hoje), adicionar o campo logo depois de `score`:

```ts
interface DashboardSummary {
  status: DashboardStatus;
  score: number | null;
  empresa_destaque: boolean;
  updated_at: string;
  resumo: {
    pendencias: number;
    avisos: number;
    acoes_concluidas: number;
    inspecoes_pendentes: number;
  };
  atencao: AttentionItem[];
  proximos_eventos: AttentionItem[];
}
```

No corpo do componente, logo depois do bloco do banner de status (hoje):

```tsx
      {status && summary && (
        <div className={`mt-4 flex items-center justify-between rounded-md border px-4 py-3 text-sm ${status.className}`}>
          <span className="font-semibold">
            {status.emoji} {status.label}
          </span>
          <span className="text-xs opacity-80">Atualizado às {formatUpdatedAt(summary.updated_at)}</span>
        </div>
      )}
```

Adicionar o badge de destaque logo depois (só aparece quando `empresa_destaque` é `true` — nunca substitui o banner de status, que continua mostrando `ok`/`atencao`/`critico` normalmente):

```tsx
      {status && summary && (
        <div className={`mt-4 flex items-center justify-between rounded-md border px-4 py-3 text-sm ${status.className}`}>
          <span className="font-semibold">
            {status.emoji} {status.label}
          </span>
          <span className="text-xs opacity-80">Atualizado às {formatUpdatedAt(summary.updated_at)}</span>
        </div>
      )}

      {summary?.empresa_destaque && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="text-lg">🏆</span>
          <span className="font-semibold">Empresa Destaque Montese — todos os documentos em dia!</span>
        </div>
      )}
```

- [ ] **Step 2: Lista de empresas do técnico**

Modificar `frontend/src/app/tecnico/empresas/page.tsx`.

Na interface `PortfolioComplianceItem` local (linhas 13-19 hoje), adicionar o campo logo depois de `score`:

```ts
interface PortfolioComplianceItem {
  tenant_id: string;
  tenant_name: string;
  score: number | null;
  empresa_destaque: boolean;
  pendencias_count: number;
  avisos_count: number;
}
```

No `<span>` que mostra o score de cada empresa (hoje):

```tsx
                  {item && (
                    <span className="flex items-center gap-2 text-sm">
                      <span className="font-semibold text-brand-900">
                        {item.score === null ? 'Sem dados' : `${item.score}%`}
                      </span>
                      {item.pendencias_count > 0 && (
                        <span className="text-red-600">{item.pendencias_count} pendência(s)</span>
                      )}
                    </span>
                  )}
```

Trocar por (badge antes do texto do score, só quando `empresa_destaque` é `true`):

```tsx
                  {item && (
                    <span className="flex items-center gap-2 text-sm">
                      {item.empresa_destaque && (
                        <span title="Empresa Destaque Montese">🏆</span>
                      )}
                      <span className="font-semibold text-brand-900">
                        {item.score === null ? 'Sem dados' : `${item.score}%`}
                      </span>
                      {item.pendencias_count > 0 && (
                        <span className="text-red-600">{item.pendencias_count} pendência(s)</span>
                      )}
                    </span>
                  )}
```

- [ ] **Step 3: Verificar manualmente no navegador**

`docker compose build frontend` — confirmar zero erros de TypeScript/lint. Recriar o container (`docker compose up -d frontend`) antes de testar.

Playwright contra a build de produção real (`https://montesesst.com.br`), sessão sintética via `localStorage` (`page.evaluate` numa navegação inicial, não `page.addInitScript`), `page.route()` mockando `/api/tenants/me`, `/api/dashboard/summary`, `/api/tenant-technicians/me`, `/api/documents/compliance/portfolio`. Cenários mínimos:

1. `/empresa/dashboard` com `GET /api/dashboard/summary` mockado retornando `empresa_destaque: true` (junto com `score: 100`, `status: 'ok'`) — banner "🏆 Empresa Destaque Montese" aparece, junto com o banner de status normal (os dois coexistem).
2. `/empresa/dashboard` com `empresa_destaque: false` (`score` != 100 ou `null`) — banner de destaque NÃO aparece, resto da tela funciona normalmente.
3. `/tecnico/empresas` com `GET /api/documents/compliance/portfolio` mockado retornando duas empresas, uma com `empresa_destaque: true` e outra com `empresa_destaque: false` — o emoji 🏆 aparece só na linha da empresa com `true`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/empresa/dashboard/page.tsx frontend/src/app/tecnico/empresas/page.tsx
git commit -m "feat: badge Empresa Destaque no dashboard da empresa e na lista do técnico"
```

---

## Depois da última task

- Gerar o pacote de revisão final de toda a branch (merge-base = commit da spec/plano) e despachar a revisão final no modelo mais capaz disponível, seguindo `subagent-driven-development`.
- Fechar `docs/roadmap.md` com uma entrada detalhada desta fase, mesmo formato de toda fase anterior.
- Próxima frente da ordem já acordada (spec da Fase 12 §1): consulta de CA/documentos técnicos (LTCAT/LIP) — ainda sem spec, precisa de brainstorming antes de qualquer plano.
