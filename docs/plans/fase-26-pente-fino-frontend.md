# Fase 26 — Frontend do Pente-Fino (PGR↔PCMSO) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a primeira tela que consome `POST /pente-fino/run` (Fase 25, backend já fechado) — um componente `PenteFinoPanel` reutilizável entre empresa e técnico/parceiro, mais as duas páginas e entradas de navegação que o expõem.

**Architecture:** Um componente cliente único (`PenteFinoPanel`) parametrizado por `tenantId?: string`, mesmo padrão de `DocumentsPanel`/`EpisPanel` já existentes. Duas páginas finas montam esse componente: uma pra `empresa` (sem prop, backend resolve tenant do JWT), uma pra `técnico`/`parceiro` dentro da área já existente `/tecnico/empresas/[tenantId]/`. Sem estado global, sem lib de API client — `fetch` direto + `useState`, mesmo padrão de toda página deste projeto.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript, Tailwind (classes utilitárias, sem CSS novo).

**Spec:** [`docs/specs/fase-26-pente-fino-frontend.md`](../specs/fase-26-pente-fino-frontend.md)

## Global Constraints

- Frontend sem infraestrutura de teste automatizado (`frontend/package.json` sem jest/vitest/testing-library) — toda verificação é manual, Playwright real (`playwright@1.48`, Node 18.19.1) contra a build de produção. Nunca contra dev server. Deploy de verificação: `docker compose build frontend && docker compose up -d frontend`, confirmando com `docker compose ps` que a stack inteira (incluindo `nginx`) está de pé antes de testar `https://montesesst.com.br`.
- Sessão sintética (quando credencial real não disponível para um cenário) via `page.evaluate` setando `localStorage` numa navegação inicial — nunca `page.addInitScript`. Isso só serve pra verificar guarda de rota client-side (a página não chuta pro login); qualquer chamada real a `POST /pente-fino/run` exige um JWT genuíno emitido pelo backend (login real), porque o endpoint é autenticado server-side.
- Componente único `PenteFinoPanel({ tenantId }: { tenantId?: string })` — nunca dois componentes separados por papel.
- Disparo do relatório é **sempre manual via botão** — nunca `useEffect` automático. O endpoint é limitado a `PENTE_FINO_RUN_RATE_LIMIT_MAX` execuções/hora por IP (default `5`) e pode levar até ~2 minutos.
- Contrato de `POST /pente-fino/run` é fixo (Fase 25, já em produção) — não alterar nada em `backend/src/pente-fino/`. Tipos exatos:
  ```typescript
  interface PenteFinoDocumentRef { id: string; title: string; extracted_at: string | null; }
  interface FunctionReportItem {
    position_id: string | null;
    position_name: string | null;
    function_text_raw: string;
    status: 'ok' | 'risco_sem_exame' | 'exame_sem_risco' | 'nome_sem_correspondencia';
    risks: { description: string; source_excerpt: string }[];
    exams: { description: string; source_excerpt: string }[];
  }
  interface PenteFinoReport {
    pgr_document: PenteFinoDocumentRef | null;
    pcmso_document: PenteFinoDocumentRef | null;
    functions: FunctionReportItem[]; // já ordenado por prioridade — nunca reordenar no frontend
    warnings: string[];
  }
  ```
- Corpo da requisição: `{}` para `empresa`; `{ tenant_id: string }` para `técnico`/`parceiro`.
- Paleta de status (classes Tailwind exatas, reaproveitadas de convenções já em produção — nunca inventar cor nova):
  | status | rótulo | classe |
  |---|---|---|
  | `risco_sem_exame` | "Risco sem exame" | `text-red-600` |
  | `exame_sem_risco` | "Exame sem risco correspondente" | `text-amber-700` |
  | `ok` | "Em dia" | `text-green-700` |
  | `nome_sem_correspondencia` | "Sem cargo cadastrado" | `text-slate-500` |
- `nome_sem_correspondencia`: link pro Mapa SST (`/empresa/mapa-sst`) **só quando `tenantId` prop é `undefined`** (contexto empresa); texto informativo sem link quando `tenantId` está definido (contexto técnico/parceiro — não existe Mapa SST nessa área).
- `source_excerpt` de cada risco/exame **nunca fica escondido** quando a linha é expandida — sempre citado, em itálico, junto da descrição.
- `Retry-After` do `429` é lido de `res.headers.get('Retry-After')` (segundos) — `Headers.get` já é case-insensitive.

---

### Task 1: `PenteFinoPanel` + página empresa + navegação

**Files:**
- Create: `frontend/src/components/PenteFinoPanel.tsx`
- Create: `frontend/src/app/empresa/pente-fino/page.tsx`
- Modify: `frontend/src/components/EmpresaSidebar.tsx:33` (adiciona uma linha)

**Interfaces:**
- Produces: `PenteFinoPanel({ tenantId }: { tenantId?: string })` — export nomeado, consumido pela página desta task (sem prop) e pela página técnico da Task 2 (com prop).
- Consome: nada de tasks anteriores (primeira task da fase). Consome o contrato real de `POST /pente-fino/run` (Fase 25, já em produção — ver Global Constraints).

- [ ] **Step 1: Criar `frontend/src/components/PenteFinoPanel.tsx`**

```tsx
'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';

interface PenteFinoDocumentRef {
  id: string;
  title: string;
  extracted_at: string | null;
}

interface FunctionReportItem {
  position_id: string | null;
  position_name: string | null;
  function_text_raw: string;
  status: 'ok' | 'risco_sem_exame' | 'exame_sem_risco' | 'nome_sem_correspondencia';
  risks: { description: string; source_excerpt: string }[];
  exams: { description: string; source_excerpt: string }[];
}

interface PenteFinoReport {
  pgr_document: PenteFinoDocumentRef | null;
  pcmso_document: PenteFinoDocumentRef | null;
  functions: FunctionReportItem[];
  warnings: string[];
}

type RunStatus = 'idle' | 'loading' | 'done' | 'error';

const STATUS_LABELS: Record<FunctionReportItem['status'], string> = {
  risco_sem_exame: 'Risco sem exame',
  exame_sem_risco: 'Exame sem risco correspondente',
  ok: 'Em dia',
  nome_sem_correspondencia: 'Sem cargo cadastrado',
};

const STATUS_CLASSES: Record<FunctionReportItem['status'], string> = {
  risco_sem_exame: 'text-red-600',
  exame_sem_risco: 'text-amber-700',
  ok: 'text-green-700',
  nome_sem_correspondencia: 'text-slate-500',
};

function formatDate(isoDateTime: string): string {
  const [year, month, day] = isoDateTime.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function PenteFinoPanel({ tenantId }: { tenantId?: string }) {
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [report, setReport] = useState<PenteFinoReport | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [expandedIndexes, setExpandedIndexes] = useState<Set<number>>(new Set());

  function toggleExpanded(index: number) {
    setExpandedIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function handleRun() {
    setRunStatus('loading');
    setErrorMessage('');
    setRetryAfterSeconds(null);
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/pente-fino/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(tenantId ? { tenant_id: tenantId } : {}),
      });
      if (res.ok) {
        setReport(await res.json());
        setExpandedIndexes(new Set());
        setRunStatus('done');
        return;
      }
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        setRetryAfterSeconds(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
        setErrorMessage('Limite de execuções do Pente-Fino atingido. Tente novamente mais tarde.');
        setRunStatus('error');
        return;
      }
      const body = await res.json().catch(() => null);
      setErrorMessage(body?.message ?? 'Não foi possível rodar o Pente-Fino agora. Tente novamente.');
      setRunStatus('error');
    } catch {
      setErrorMessage('Não foi possível conectar ao servidor.');
      setRunStatus('error');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Cruzamento PGR × PCMSO</h2>
        <p className="mt-2 text-sm text-brand-700">
          Compara as funções descritas no PGR com os exames do PCMSO e aponta risco sem exame
          correspondente, exame sem risco que o justifique, e nomes de função sem cargo cadastrado.
          Pode levar até 2 minutos.
        </p>
        <button
          type="button"
          onClick={handleRun}
          disabled={runStatus === 'loading'}
          className="mt-4 self-start rounded-md bg-brand-500 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {runStatus === 'loading' ? 'Rodando...' : 'Rodar Pente-Fino'}
        </button>
        {runStatus === 'error' && (
          <p className="mt-3 text-sm text-red-600">
            {errorMessage}
            {retryAfterSeconds !== null &&
              ` (tente novamente em ${Math.ceil(retryAfterSeconds / 60)} minuto(s))`}
          </p>
        )}
      </section>

      {report && (
        <>
          <section className="rounded-lg border border-brand-100 p-6">
            <h3 className="text-sm font-bold uppercase tracking-wide text-brand-700">Documentos-fonte</h3>
            <p className="mt-2 text-sm text-brand-900">
              PGR: {report.pgr_document ? report.pgr_document.title : 'nenhum PGR encontrado'}
              {report.pgr_document?.extracted_at &&
                ` (extraído em ${formatDate(report.pgr_document.extracted_at)})`}
            </p>
            <p className="mt-1 text-sm text-brand-900">
              PCMSO: {report.pcmso_document ? report.pcmso_document.title : 'nenhum PCMSO encontrado'}
              {report.pcmso_document?.extracted_at &&
                ` (extraído em ${formatDate(report.pcmso_document.extracted_at)})`}
            </p>
            {report.warnings.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                {report.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-brand-100 p-6">
            <h3 className="text-sm font-bold uppercase tracking-wide text-brand-700">Funções</h3>
            {report.functions.length === 0 ? (
              <p className="mt-4 text-sm text-brand-700">
                Nenhuma função extraída ainda — envie PGR e PCMSO e rode de novo.
              </p>
            ) : (
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="text-left text-brand-700">
                    <th className="px-2 py-1">Função</th>
                    <th className="px-2 py-1">Status</th>
                    <th className="px-2 py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {report.functions.map((item, index) => {
                    const isExpanded = expandedIndexes.has(index);
                    const hasDetails = item.risks.length > 0 || item.exams.length > 0;
                    return (
                      <Fragment key={`${item.position_id ?? item.function_text_raw}-${index}`}>
                        <tr className="border-t border-brand-50">
                          <td className="px-2 py-2 font-medium text-brand-900">
                            {item.position_name ?? item.function_text_raw}
                          </td>
                          <td className={`px-2 py-2 ${STATUS_CLASSES[item.status]}`}>
                            {STATUS_LABELS[item.status]}
                          </td>
                          <td className="px-2 py-2 text-right">
                            {hasDetails && (
                              <button
                                type="button"
                                onClick={() => toggleExpanded(index)}
                                className="text-brand-500 hover:underline"
                              >
                                {isExpanded ? 'Ocultar detalhes' : 'Ver detalhes'}
                              </button>
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-t border-brand-50 bg-brand-50">
                            <td colSpan={3} className="px-2 py-3">
                              {item.risks.length > 0 && (
                                <div className="mb-3">
                                  <h4 className="text-xs font-bold uppercase tracking-wide text-brand-700">
                                    Riscos (PGR)
                                  </h4>
                                  <ul className="mt-1 flex flex-col gap-2">
                                    {item.risks.map((risk, i) => (
                                      <li key={i} className="text-sm text-brand-900">
                                        {risk.description}
                                        <p className="text-xs italic text-brand-700">
                                          &quot;{risk.source_excerpt}&quot;
                                        </p>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {item.exams.length > 0 && (
                                <div>
                                  <h4 className="text-xs font-bold uppercase tracking-wide text-brand-700">
                                    Exames (PCMSO)
                                  </h4>
                                  <ul className="mt-1 flex flex-col gap-2">
                                    {item.exams.map((exam, i) => (
                                      <li key={i} className="text-sm text-brand-900">
                                        {exam.description}
                                        <p className="text-xs italic text-brand-700">
                                          &quot;{exam.source_excerpt}&quot;
                                        </p>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {item.status === 'nome_sem_correspondencia' &&
                                (tenantId ? (
                                  <p className="mt-2 text-sm text-slate-500">
                                    Sem cargo cadastrado — peça pra empresa cadastrar em Mapa SST.
                                  </p>
                                ) : (
                                  <Link
                                    href="/empresa/mapa-sst"
                                    className="mt-2 inline-block text-sm text-brand-500 underline hover:text-brand-700"
                                  >
                                    Cadastrar cargo no Mapa SST
                                  </Link>
                                ))}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Criar `frontend/src/app/empresa/pente-fino/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PenteFinoPanel } from '@/components/PenteFinoPanel';

export default function EmpresaPenteFinoPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('montese_token')) {
      router.push('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Pente-Fino</h1>
      <div className="mt-8">
        <PenteFinoPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Adicionar a entrada na sidebar da empresa**

Em `frontend/src/components/EmpresaSidebar.tsx`, dentro do grupo `'Segurança'`, logo após a linha do Mapa SST (linha 33 no arquivo atual):

```typescript
      { href: '/empresa/mapa-sst', label: 'Mapa SST', emoji: '🗺️' },
      { href: '/empresa/pente-fino', label: 'Pente-Fino', emoji: '🔬' },
```

(a linha do Mapa SST já existe — só adicionar a linha do Pente-Fino logo depois dela, dentro do mesmo array `links`. Não mexer em mais nada do arquivo.)

- [ ] **Step 4: Checar tipos**

Run: `cd /opt/Montese/frontend && npx tsc --noEmit`
Expected: nenhum erro (a build já falharia antes se houvesse — este step é só pra pegar erro de tipo mais rápido, sem esperar o build completo do Next).

- [ ] **Step 5: Rebuild e redeploy do frontend**

```bash
cd /opt/Montese
docker compose build frontend
docker compose up -d frontend
docker compose ps
```

Expected: build sem erro; `docker compose ps` mostra `montese_frontend` e `montese_nginx` (e todo o resto da stack) com status `Up`/`running`. Se `nginx` não estiver de pé, `docker compose up -d` (sem argumento) reergue a stack inteira antes de prosseguir.

- [ ] **Step 6: Verificação manual via Playwright real**

Contra `https://montesesst.com.br`, com login real de uma conta `empresa` de teste (a mesma já usada em verificações de fases anteriores desta sessão; se nenhuma estiver disponível/lembrada, criar uma nova via fluxo de cadastro público e fazer upload de um PGR e um PCMSO de teste antes de continuar — não é necessário que o conteúdo real gere `risco_sem_exame`/`exame_sem_risco`/`ok` simultaneamente, qualquer resultado real do endpoint é uma verificação válida):

1. Login como empresa, navegar até `/empresa/pente-fino` pela sidebar (confirmar que o item "Pente-Fino" aparece no grupo Segurança, logo abaixo de "Mapa SST", com o emoji 🔬).
2. Confirmar que a página abre em estado parado — nenhuma chamada a `/api/pente-fino/run` disparada sozinha (checar a aba Network do navegador: nenhuma chamada a essa rota antes do clique).
3. Clicar em "Rodar Pente-Fino" — botão fica desabilitado e mostra "Rodando..." durante a chamada.
4. Confirmar que o relatório aparece: seção "Documentos-fonte" mostra título de PGR/PCMSO reais (ou "nenhum X encontrado" se algum não estiver cadastrado nessa conta de teste) e qualquer `warning` real em caixa âmbar.
5. Se `functions` vier com pelo menos um item: clicar em "Ver detalhes" numa linha que tenha risco ou exame, confirmar que a descrição E o `source_excerpt` (entre aspas, em itálico) aparecem. Se algum item tiver status `nome_sem_correspondencia`, confirmar que aparece o link "Cadastrar cargo no Mapa SST" e que ele navega pra `/empresa/mapa-sst`.
6. Clicar em "Rodar Pente-Fino" de novo — confirma que o relatório antigo é substituído (não duplicado) e nenhum erro de console aparece.
7. **Caso `429`** — mais barato e seguro forçar via `curl` direto no endpoint do que via 6 cliques reais na UI (evita gastar 6 execuções reais de LLM):
   ```bash
   TOKEN="<jwt real da conta empresa de teste>"
   for i in 1 2 3 4 5 6; do
     curl -s -o /dev/null -w "%{http_code}\n" -X POST https://montesesst.com.br/api/pente-fino/run \
       -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
   done
   ```
   Confirmar que a 6ª chamada devolve `429` (as 5 primeiras podem devolver `201` ou repetir chamadas já contadas nesta hora — o que importa é ver pelo menos um `429`). Só então, na UI, clicar em "Rodar Pente-Fino" e confirmar a mensagem "Limite de execuções do Pente-Fino atingido. Tente novamente mais tarde." com o texto de minutos. **Depois de confirmar, resetar a chave no Redis real** (mesmo padrão de limpeza dos testes e2e do backend):
   ```bash
   docker compose exec redis redis-cli -a "$REDIS_PASSWORD" DEL "ratelimit:PenteFinoController.run:<ip-real-usado-no-teste>"
   ```
   Sem esse reset, a cota daquele IP fica zerada por até 1h pra qualquer usuário real atrás do mesmo IP.

- [ ] **Step 7: Commit**

```bash
cd /opt/Montese
git add frontend/src/components/PenteFinoPanel.tsx frontend/src/app/empresa/pente-fino/page.tsx frontend/src/components/EmpresaSidebar.tsx
git commit -m "feat: PenteFinoPanel + tela da empresa pro Pente-Fino (Fase 26)"
```

---

### Task 2: Página técnico/parceiro + navegação

**Files:**
- Create: `frontend/src/app/tecnico/empresas/[tenantId]/pente-fino/page.tsx`
- Modify: `frontend/src/app/tecnico/empresas/[tenantId]/page.tsx`

**Interfaces:**
- Consome: `PenteFinoPanel` da Task 1 (`import { PenteFinoPanel } from '@/components/PenteFinoPanel'`), passando `tenantId={params.tenantId}`.
- Produces: nada consumido por task posterior (última task da fase).

- [ ] **Step 1: Criar `frontend/src/app/tecnico/empresas/[tenantId]/pente-fino/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PenteFinoPanel } from '@/components/PenteFinoPanel';

export default function TecnicoEmpresaPenteFinoPage() {
  const router = useRouter();
  const params = useParams<{ tenantId: string }>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('montese_token')) {
      router.push('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Pente-Fino</h1>
      <div className="mt-8">
        <PenteFinoPanel tenantId={params.tenantId} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Adicionar o link em `frontend/src/app/tecnico/empresas/[tenantId]/page.tsx`**

Arquivo completo (a única mudança real é a nova `<section>` "Pente-Fino", inserida entre o bloco do `DocumentsPanel` e a seção "Inspeções" — todo o resto do arquivo permanece exatamente como está hoje):

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { DocumentsPanel } from '@/components/DocumentsPanel';
import { EpisPanel } from '@/components/EpisPanel';

interface InspectionRow {
  id: string;
  status: 'rascunho' | 'concluida';
  visited_at: string;
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export default function TecnicoEmpresaDocumentosPage() {
  const router = useRouter();
  const params = useParams<{ tenantId: string }>();
  const [ready, setReady] = useState(false);
  const [inspections, setInspections] = useState<InspectionRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function loadInspections() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/inspections?tenant_id=${params.tenantId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setInspections(await res.json());
      } else {
        setError('Não foi possível carregar as inspeções.');
      }
    } catch {
      setError('Não foi possível conectar ao servidor.');
    }
  }

  useEffect(() => {
    if (!localStorage.getItem('montese_token')) {
      router.push('/login');
      return;
    }
    setReady(true);
    loadInspections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleNovaInspecao() {
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

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Documentos da empresa</h1>
      <div className="mt-8">
        <DocumentsPanel tenantId={params.tenantId} />
      </div>

      <section className="mt-10 rounded-lg border border-brand-100 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-brand-900">Pente-Fino</h2>
          <Link
            href={`/tecnico/empresas/${params.tenantId}/pente-fino`}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Abrir Pente-Fino
          </Link>
        </div>
        <p className="mt-2 text-sm text-brand-700">
          Cruza as funções do PGR com os exames do PCMSO desta empresa.
        </p>
      </section>

      <section className="mt-10 rounded-lg border border-brand-100 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-brand-900">Inspeções</h2>
          <button
            onClick={handleNovaInspecao}
            disabled={creating}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {creating ? 'Criando...' : 'Nova inspeção'}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {inspections.length === 0 ? (
          <p className="mt-4 text-sm text-brand-700">Nenhuma inspeção registrada ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {inspections.map((inspection) => (
              <li key={inspection.id}>
                <Link
                  href={`/tecnico/empresas/${params.tenantId}/inspecoes/${inspection.id}`}
                  className="flex items-center justify-between rounded-md border border-brand-100 px-4 py-3 text-sm hover:bg-brand-100"
                >
                  <span className="text-brand-900">{formatDate(inspection.visited_at)}</span>
                  <span className={inspection.status === 'concluida' ? 'text-green-700' : 'text-yellow-700'}>
                    {inspection.status === 'concluida' ? 'Concluída' : 'Rascunho'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Catálogo de EPI</h2>
        <div className="mt-4">
          <EpisPanel tenantId={params.tenantId} />
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Checar tipos**

Run: `cd /opt/Montese/frontend && npx tsc --noEmit`
Expected: nenhum erro.

- [ ] **Step 4: Rebuild e redeploy do frontend**

```bash
cd /opt/Montese
docker compose build frontend
docker compose up -d frontend
docker compose ps
```

Expected: mesmo checklist da Task 1 Step 5.

- [ ] **Step 5: Verificação manual via Playwright real**

Contra `https://montesesst.com.br`:

1. Login como `tecnico` **vinculado** a uma empresa de teste com PGR/PCMSO cadastrados (mesma empresa usada na Task 1, se o técnico de teste estiver vinculado a ela; senão, vincular via fluxo de admin já existente, ou usar qualquer par técnico-vinculado/empresa disponível).
2. Navegar até `/tecnico/empresas/<tenantId>`, confirmar que a nova seção "Pente-Fino" aparece entre "Documentos da empresa" e "Inspeções", com o botão "Abrir Pente-Fino".
3. Clicar no botão, confirmar que chega em `/tecnico/empresas/<tenantId>/pente-fino` e que o painel abre no mesmo estado parado da Task 1 (sem chamada automática).
4. Clicar em "Rodar Pente-Fino", confirmar que o relatório real da empresa vinculada aparece.
5. Se algum item vier com status `nome_sem_correspondencia`: confirmar que aparece o texto **"Sem cargo cadastrado — peça pra empresa cadastrar em Mapa SST."**, SEM nenhum link clicável (diferente do comportamento da Task 1) — inspecionar o HTML da linha pra confirmar que não há `<a>`/`<Link>` ali.
6. Login como um `tecnico` **sem vínculo** com essa mesma empresa (ou usar sessão sintética via `page.evaluate` em `localStorage` com um token real de um técnico não vinculado, se disponível): tentar `/tecnico/empresas/<tenantId>/pente-fino`, clicar em "Rodar Pente-Fino", confirmar que a mensagem de erro é exatamente **"Você não está vinculado a esta empresa"** (texto literal devolvido pelo backend) e que nenhum dado da empresa (título de documento, nome de função, `source_excerpt`) aparece na tela nesse caso.

- [ ] **Step 6: Commit**

```bash
cd /opt/Montese
git add frontend/src/app/tecnico/empresas/\[tenantId\]/pente-fino/page.tsx frontend/src/app/tecnico/empresas/\[tenantId\]/page.tsx
git commit -m "feat: página técnico/parceiro do Pente-Fino + navegação (Fase 26)"
```

---

## Depois da última task

Revisão final de todo o branch (mesmo padrão de toda fase anterior via
Subagent-Driven Development), e registrar o fechamento em
`docs/roadmap.md`. Como este projeto trabalha direto na `main` (sem
worktree, consentimento já obtido em fases anteriores), a revisão final
cobre o diff completo `main` desde antes da Task 1 até o HEAD após a
Task 2.
