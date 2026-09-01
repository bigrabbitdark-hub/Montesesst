# Fase 12b-2 — Central da CIPA (telas): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interface completa da Central da CIPA no dashboard da empresa — calendário guiado, reuniões com ata/checklist/aprovação, membros, pendências — consumindo a API real da Fase 12a (`backend/src/cipa/`).

**Architecture:** 6 páginas novas em `frontend/src/app/empresa/cipa/`, cada uma um Client Component (`'use client'`) que busca dados via `fetch('/api/cipa/...')` com o token de `lib/auth.ts` (Fase 12b-1), seguindo exatamente o padrão já usado em `empresa/dashboard/page.tsx`. Sem cliente de API centralizado nem gerenciador de estado novo (Redux/Zustand/React Query) — o projeto inteiro hoje usa `fetch` direto + `useState`/`useEffect` em cada página, sem exceção; introduzir uma camada nova só pra CIPA seria inconsistente com o resto do frontend. Sem endpoint de resumo dedicado no backend pra o dashboard da CIPA (a Fase 12a não criou um) — os 8 cards da seção 7 da spec são computados no cliente, combinando as listagens que já existem (`GET /cipa/committees`, `/meetings`, `/members`, `/pendencias`), decisão deliberada dado o volume pequeno de dados por empresa (no máximo dezenas de linhas).

**Tech Stack:** Next.js 14 (App Router) + React 18 + Tailwind (classes já em uso). Sem lib de ícones nova (mesma decisão da Fase 12b-1) — emoji.

**Spec:** [`docs/specs/fase-12-central-cipa-nucleo.md`](../specs/fase-12-central-cipa-nucleo.md), seções 3-7 (modelo de dados, gerador de calendário, página de reunião, API, dashboard da Central).

## Global Constraints

- Depende da Fase 12b-1 estar mesclada primeiro: usa `getToken()`/`logout()` de `frontend/src/lib/auth.ts`, e adiciona o grupo "CIPA" na sidebar que a 12b-1 já reorganizou (`EmpresaSidebar.tsx`).
- **Sem test runner no frontend** (confirmado na 12b-1: `frontend/package.json` não tem jest/vitest/testing-library). Toda verificação desta fase é manual no navegador, documentada no relatório de cada task — não é um desvio, é o estado real do projeto.
- CIPA é escopada por `company_unit_id`. Se o tenant tiver mais de um estabelecimento (`GET /company-units` retornando mais de 1 linha), toda página da CIPA precisa de um seletor de estabelecimento; se tiver só 1, seleciona automaticamente, sem exibir seletor.
- Toda página nova usa `fetch('/api/cipa/...', { headers: { Authorization: `Bearer ${token}` } })` — mesmo padrão de `empresa/dashboard/page.tsx`. Sem cliente de API/hook de fetch centralizado nesta fase (YAGNI — o projeto inteiro não tem um, não é este o momento de introduzir).
- Ata só é editável enquanto `status_ata === 'rascunho'` (o backend já rejeita com 409 se tentar depois de aprovada — o frontend deve refletir isso na UI, desabilitando campos/botões de edição quando `status_ata === 'aprovada'`, não só confiar no erro do backend).
- Datas do backend já vêm normalizadas como `'YYYY-MM-DD'` (Fase 12a corrigiu isso) — o frontend só precisa formatar pra exibição (`DD/MM/AAAA`), nunca lidar com objeto `Date` bruto da API.

---

## Task 1: Grupo CIPA na sidebar + página `/empresa/cipa` (landing/dashboard)

**Files:**
- Modify: `frontend/src/components/EmpresaSidebar.tsx`
- Modify: `frontend/src/components/DocumentsPanel.tsx` (registrar as categorias novas de documento — ver Step 3)
- Create: `frontend/src/app/empresa/cipa/page.tsx`
- Create: `frontend/src/app/empresa/cipa/layout.tsx` (seletor de estabelecimento compartilhado — ver Step 4)
- Create: `frontend/src/lib/cipa-types.ts` (interfaces TypeScript compartilhadas por todas as páginas da CIPA, espelhando as interfaces reais do backend)

**Interfaces:**
- Consumes: `getToken` de `frontend/src/lib/auth.ts` (Fase 12b-1).
- Produces: `CipaCommittee`, `CipaMeeting`, `CipaMember`, `CipaPendencia` (interfaces TypeScript, exportadas de `frontend/src/lib/cipa-types.ts`, usadas por todas as tasks seguintes).

- [ ] **Step 1: Criar as interfaces TypeScript compartilhadas**

Criar `frontend/src/lib/cipa-types.ts` — espelha exatamente as interfaces reais de `backend/src/cipa/{committees,meetings,members,pendencias}.service.ts` (lidas diretamente do código real antes de escrever este arquivo, não do resumo da spec):

```ts
export interface CompanyUnit {
  id: string;
  tenant_id: string;
  name: string;
  address_street: string;
  address_number: string | null;
  address_city: string;
  address_state: string;
  address_zip: string;
}

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
  company_unit_id: string;
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
  ata_document_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CipaMeetingParticipant {
  id: string;
  meeting_id: string;
  cipa_member_id: string | null;
  nome_livre: string | null;
  presente: boolean;
}

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

export function formatDateBR(iso: string | null): string {
  if (!iso) return '—';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

export const FUNCAO_CIPA_LABEL: Record<CipaMember['funcao_cipa'], string> = {
  presidente: 'Presidente',
  vice_presidente: 'Vice-presidente',
  secretario: 'Secretário(a)',
  membro: 'Membro',
};

export const PRIORIDADE_LABEL: Record<CipaPendencia['prioridade'], string> = {
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
};

export const STATUS_PENDENCIA_LABEL: Record<CipaPendencia['status'], string> = {
  aberta: 'Aberta',
  andamento: 'Em andamento',
  concluida: 'Concluída',
  atrasada: 'Atrasada',
};
```

- [ ] **Step 2: Adicionar o grupo CIPA na sidebar**

Modificar `frontend/src/components/EmpresaSidebar.tsx` — adicionar um grupo novo ao array `GROUPS` (já criado na Fase 12b-1), entre "Segurança" e "Conta":

```tsx
  {
    label: 'CIPA',
    links: [
      { href: '/empresa/cipa', label: 'Central da CIPA', emoji: '🦺' },
      { href: '/empresa/cipa/reunioes', label: 'Reuniões', emoji: '📅' },
      { href: '/empresa/cipa/membros', label: 'Membros', emoji: '👥' },
      { href: '/empresa/cipa/pendencias', label: 'Pendências', emoji: '📌' },
    ],
  },
```

(Inserir esse objeto no array `GROUPS` existente, entre o grupo "Segurança" e o grupo "Conta" — o arquivo já existe da Fase 12b-1, esta é só a adição de um item ao array, não uma reescrita do componente.)

- [ ] **Step 3: Registrar as categorias novas de documento em `DocumentsPanel.tsx`**

A Fase 12a já faz o backend gerar automaticamente um `documents` com `category = 'cipa_ata'` ao aprovar uma ata (a migration `0023` já estendeu o `CHECK` do banco pra aceitar `cipa_ata`/`cipa_comunicado`/`cipa_documento_eleitoral`/`cipa_anexo`). Sem esta correção, esse documento apareceria na listagem genérica de `/empresa/documentos` (que lista TODOS os documentos do tenant, sem filtro de categoria) com rótulo `undefined` — `CATEGORY_LABELS` em `frontend/src/components/DocumentsPanel.tsx` não conhece essas categorias.

Modificar `frontend/src/components/DocumentsPanel.tsx` — adicionar as 4 categorias novas ao `CATEGORY_LABELS` já existente:

```ts
const CATEGORY_LABELS: Record<string, string> = {
  pgr: 'PGR',
  pcmso: 'PCMSO',
  laudo: 'Laudo',
  ficha_epi: 'Ficha de EPI',
  treinamento: 'Treinamento',
  epi: 'EPI',
  cipa_ata: 'Ata da CIPA',
  cipa_comunicado: 'Comunicado da CIPA',
  cipa_documento_eleitoral: 'Documento eleitoral da CIPA',
  cipa_anexo: 'Anexo da CIPA',
};
```

Não precisa entrar no `<select>` de upload manual (essas categorias só são geradas automaticamente pelo backend na aprovação de ata nesta fase, upload manual direto nelas fica fora de escopo) — só no `CATEGORY_LABELS` usado pra exibir a listagem.

- [ ] **Step 4: Criar o layout com seletor de estabelecimento**

Criar `frontend/src/app/empresa/cipa/layout.tsx` — busca os `company_units` do tenant uma vez, guarda a unidade selecionada em `sessionStorage` (persiste só durante a navegação, não precisa ir pro backend), e passa pra baixo via um `<select>` visível só quando há mais de uma unidade:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { CompanyUnit } from '@/lib/cipa-types';

const STORAGE_KEY = 'montese_cipa_company_unit_id';

export default function CipaLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [units, setUnits] = useState<CompanyUnit[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push('/login');
      return;
    }
    fetch('/api/company-units', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: CompanyUnit[]) => {
        setUnits(data);
        const stored = sessionStorage.getItem(STORAGE_KEY);
        const initial = stored && data.some((u) => u.id === stored) ? stored : data[0]?.id ?? '';
        setSelectedUnitId(initial);
        if (initial) sessionStorage.setItem(STORAGE_KEY, initial);
        setReady(true);
      })
      .catch(() => setReady(true));
  }, [router]);

  function handleChange(unitId: string) {
    setSelectedUnitId(unitId);
    sessionStorage.setItem(STORAGE_KEY, unitId);
    // Recarrega a página atual pra ela buscar os dados da unidade nova —
    // mais simples que propagar a mudança via Context pra páginas que já
    // fazem fetch próprio no useEffect delas.
    window.location.reload();
  }

  if (!ready) {
    return <div className="px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  if (units.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-brand-700">
          Nenhum estabelecimento cadastrado ainda.{' '}
          <a href="/empresa/onboarding" className="font-semibold text-brand-900 underline">
            Cadastre um em Dados da empresa
          </a>{' '}
          antes de usar a Central da CIPA.
        </p>
      </div>
    );
  }

  return (
    <div>
      {units.length > 1 && (
        <div className="mx-4 mt-8 flex items-center gap-2 text-sm sm:mx-0">
          <label htmlFor="cipa-unit-select" className="font-medium text-brand-700">
            Estabelecimento:
          </label>
          <select
            id="cipa-unit-select"
            value={selectedUnitId}
            onChange={(e) => handleChange(e.target.value)}
            className="rounded-md border border-brand-100 px-2 py-1"
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {children}
    </div>
  );
}

// Helper reaproveitado pelas páginas filhas — lê a unidade selecionada
// sem precisar buscar /company-units de novo em cada uma.
export function getSelectedCompanyUnitId(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(STORAGE_KEY);
}
```

- [ ] **Step 5: Criar a página landing/dashboard `/empresa/cipa`**

Criar `frontend/src/app/empresa/cipa/page.tsx` — se não houver `cipa_committees` pra unidade selecionada, mostra CTA pra criar; se houver, mostra os cards da seção 7 da spec, computados a partir das listagens:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { CipaCommittee, CipaMeeting, CipaMember, CipaPendencia, formatDateBR } from '@/lib/cipa-types';
import { getSelectedCompanyUnitId } from './layout';

function Card({ emoji, label, value, href }: { emoji: string; label: string; value: string | number; href?: string }) {
  const content = (
    <div className="rounded-lg border border-brand-100 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-500">
        {emoji} {label}
      </p>
      <p className="mt-1 text-xl font-bold text-brand-900">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export default function CipaDashboardPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [committee, setCommittee] = useState<CipaCommittee | null>(null);
  const [meetings, setMeetings] = useState<CipaMeeting[]>([]);
  const [members, setMembers] = useState<CipaMember[]>([]);
  const [pendencias, setPendencias] = useState<CipaPendencia[]>([]);

  useEffect(() => {
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
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`/api/cipa/committees?company_unit_id=${unitId}`, { headers }).then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/cipa/members?company_unit_id=${unitId}`, { headers }).then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/cipa/pendencias?company_unit_id=${unitId}`, { headers }).then((r) => (r.ok ? r.json() : [])),
    ]).then(async ([committees, membersData, pendenciasData]: [CipaCommittee[], CipaMember[], CipaPendencia[]]) => {
      const active = committees.find((c) => c.status === 'ativa') ?? committees[0] ?? null;
      setCommittee(active);
      setMembers(membersData);
      setPendencias(pendenciasData);
      if (active) {
        const meetingsData = await fetch(`/api/cipa/meetings?committee_id=${active.id}`, { headers }).then((r) =>
          r.ok ? r.json() : [],
        );
        setMeetings(meetingsData);
      }
      setReady(true);
    });
  }, [router]);

  if (!ready) {
    return <div className="px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  if (!committee) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-brand-900">🦺 Central da CIPA</h1>
        <p className="mt-4 text-brand-700">Nenhuma gestão da CIPA cadastrada ainda para este estabelecimento.</p>
        <Link
          href="/empresa/cipa/nova-gestao"
          className="mt-6 inline-block rounded-[9px] bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700"
        >
          📅 Criar calendário da CIPA
        </Link>
      </div>
    );
  }

  const now = new Date().toISOString().slice(0, 10);
  const proximaReuniao = meetings
    .filter((m) => m.status !== 'cancelada' && m.status !== 'realizada' && m.data && m.data >= now)
    .sort((a, b) => (a.data! < b.data! ? -1 : 1))[0];
  const realizadas = meetings.filter((m) => m.status === 'realizada').length;
  const pendentes = meetings.filter((m) => m.status === 'planejada' || m.status === 'agendada').length;
  const membrosAtivos = members.filter((m) => m.status === 'ativo').length;
  const pendenciasAbertas = pendencias.filter((p) => p.status === 'aberta' || p.status === 'andamento').length;
  const ultimaAta = meetings
    .filter((m) => m.status_ata === 'aprovada' && m.aprovado_em)
    .sort((a, b) => (a.aprovado_em! > b.aprovado_em! ? -1 : 1))[0];
  const ordinariasComData = meetings.filter((m) => m.tipo === 'ordinaria' && m.data).length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">🦺 Central da CIPA</h1>
      <p className="mt-1 text-sm text-brand-700">
        Gestão {committee.ano} — {formatDateBR(committee.data_inicio)} a {formatDateBR(committee.data_termino)}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card
          emoji="📅"
          label="Próxima reunião"
          value={proximaReuniao ? formatDateBR(proximaReuniao.data) : 'Nenhuma'}
          href="/empresa/cipa/reunioes"
        />
        <Card emoji="✅" label="Reuniões realizadas" value={realizadas} href="/empresa/cipa/reunioes" />
        <Card emoji="⏳" label="Reuniões pendentes" value={pendentes} href="/empresa/cipa/reunioes" />
        <Card emoji="👥" label="Membros ativos" value={membrosAtivos} href="/empresa/cipa/membros" />
        <Card emoji="📌" label="Pendências abertas" value={pendenciasAbertas} href="/empresa/cipa/pendencias" />
        <Card emoji="📄" label="Última ata" value={ultimaAta ? formatDateBR(ultimaAta.data) : 'Nenhuma'} />
        <Card
          emoji="🗓️"
          label="Status do calendário"
          value={`${ordinariasComData}/12 datadas`}
          href="/empresa/cipa/reunioes"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verificar manualmente no navegador**

Subir o frontend, logar como empresa (usar uma empresa de teste com pelo menos 1 `company_unit` cadastrado — se não houver nenhuma via seed, cadastrar uma via `/empresa/onboarding` primeiro), navegar até `/empresa/cipa` pelo link novo na sidebar.
Expected: sem gestão criada → mostra CTA "Criar calendário da CIPA". Depois de criar uma gestão manualmente via `curl`/Postman contra a API real (não precisa esperar a Task 2 pra isso — é só pra validar esta página), recarregar e confirmar que os 7 cards aparecem com valores corretos (zerados, já que não há reuniões/membros/pendências ainda). Confirmar também que `/empresa/documentos` (página já existente, não desta fase) não quebra visualmente mesmo sem nenhum documento `cipa_ata` ainda — é só uma checagem de não-regressão do Step 3.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/EmpresaSidebar.tsx frontend/src/components/DocumentsPanel.tsx frontend/src/app/empresa/cipa/page.tsx frontend/src/app/empresa/cipa/layout.tsx frontend/src/lib/cipa-types.ts
git commit -m "feat: grupo CIPA na sidebar + dashboard da Central da CIPA"
```

---

## Task 2: Wizard de criação de calendário

**Files:**
- Create: `frontend/src/app/empresa/cipa/nova-gestao/page.tsx`

**Interfaces:**
- Consumes: `CipaCommittee` (Task 1), `getToken` (Fase 12b-1), `getSelectedCompanyUnitId` (Task 1).

- [ ] **Step 1: Implementar o wizard de 2 passos**

Criar `frontend/src/app/empresa/cipa/nova-gestao/page.tsx` — passo 1 cria a `cipa_committees` (`POST /cipa/committees`), passo 2 gera as 12 reuniões (`POST /cipa/committees/:id/generate-meetings`), com opção de pular a sugestão de data (spec seção 4: "o sistema deve permitir edição completa — nenhuma data deve ser considerada definitiva sem confirmação"):

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getUser } from '@/lib/auth';
import { getSelectedCompanyUnitId } from '../layout';

const DIAS_SEMANA = [
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
];

export default function NovaGestaoPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [committeeId, setCommitteeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [ano, setAno] = useState(new Date().getFullYear());
  const [dataInicio, setDataInicio] = useState('');
  const [dataTermino, setDataTermino] = useState('');

  const [diaSemana, setDiaSemana] = useState<number | ''>('');
  const [horario, setHorario] = useState('');
  const [local, setLocal] = useState('');
  const [skipSugestao, setSkipSugestao] = useState(false);

  async function handleStep1(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const token = getToken();
    const user = getUser();
    const unitId = getSelectedCompanyUnitId();
    if (!token || !user || !unitId) {
      setError('Sessão inválida — recarregue a página.');
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/cipa/committees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          company_unit_id: unitId,
          ano,
          data_inicio: dataInicio,
          data_termino: dataTermino,
          responsavel_user_id: user.id,
        }),
      });
      if (!res.ok) {
        setError('Não foi possível criar a gestão. Confira as datas informadas.');
        return;
      }
      const data = await res.json();
      setCommitteeId(data.id);
      setStep(2);
    } finally {
      setLoading(false);
    }
  }

  async function handleStep2(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const token = getToken();
    try {
      const res = await fetch(`/api/cipa/committees/${committeeId}/generate-meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          dia_semana_preferido: skipSugestao || diaSemana === '' ? undefined : diaSemana,
          horario: horario || undefined,
          local: local || undefined,
        }),
      });
      if (!res.ok) {
        setError('Não foi possível gerar as reuniões.');
        return;
      }
      router.push('/empresa/cipa/reunioes');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">📅 Criar Calendário da CIPA</h1>
      <p className="mt-1 text-sm text-brand-700">Passo {step} de 2</p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {step === 1 && (
        <form onSubmit={handleStep1} className="mt-6 flex flex-col gap-4">
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
            Data de início da gestão
            <input
              type="date"
              required
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Data de término da gestão
            <input
              type="date"
              required
              value={dataTermino}
              onChange={(e) => setDataTermino(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-[9px] bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? 'Salvando...' : 'Continuar'}
          </button>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={handleStep2} className="mt-6 flex flex-col gap-4">
          <p className="text-sm text-brand-700">
            As 12 reuniões ordinárias serão criadas. Você pode sugerir um padrão de data agora, ou pular e
            preencher cada data manualmente depois — nenhuma data fica definitiva sem sua confirmação.
          </p>
          <label className="flex items-center gap-2 text-sm text-brand-900">
            <input type="checkbox" checked={skipSugestao} onChange={(e) => setSkipSugestao(e.target.checked)} />
            Pular sugestão de data (preencher cada reunião manualmente depois)
          </label>
          {!skipSugestao && (
            <>
              <label className="flex flex-col gap-1 text-sm text-brand-900">
                Dia da semana preferido
                <select
                  value={diaSemana}
                  onChange={(e) => setDiaSemana(e.target.value === '' ? '' : Number(e.target.value))}
                  className="rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
                >
                  <option value="">Selecione...</option>
                  {DIAS_SEMANA.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-brand-900">
                Horário
                <input
                  type="time"
                  value={horario}
                  onChange={(e) => setHorario(e.target.value)}
                  className="rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-brand-900">
                Local
                <input
                  type="text"
                  value={local}
                  onChange={(e) => setLocal(e.target.value)}
                  className="rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
                />
              </label>
            </>
          )}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-[9px] bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? 'Gerando...' : 'Gerar as 12 reuniões'}
          </button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar manualmente no navegador**

Fluxo completo: `/empresa/cipa` (sem gestão) → clicar "Criar calendário da CIPA" → preencher passo 1 (ano/datas) → passo 2, com "pular sugestão" desmarcado, escolher segunda-feira/14:00/"Sala de reuniões" → gerar → confirmar redirecionamento pra `/empresa/cipa/reunioes` (só existe de verdade na Task 3 — por enquanto confirmar que a URL muda e não dá erro 404 de rota, mesmo a página ainda não existindo completamente). Repetir criando uma segunda gestão com "pular sugestão" marcado, confirmar que as 12 reuniões saem sem data.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/empresa/cipa/nova-gestao
git commit -m "feat: wizard de criação de calendário da CIPA"
```

---

## Task 3: Lista de reuniões (mensal/lista/anual) + reunião extraordinária

**Files:**
- Create: `frontend/src/app/empresa/cipa/reunioes/page.tsx`
- Create: `frontend/src/app/empresa/cipa/reunioes/NovaExtraordinariaForm.tsx`

**Interfaces:**
- Consumes: `CipaMeeting`, `CipaCommittee` (Task 1).
- Produces: nada consumido por tasks seguintes (Task 4 é uma rota separada, `[id]`, que faz seu próprio fetch).

- [ ] **Step 1: Implementar a página de lista de reuniões**

Criar `frontend/src/app/empresa/cipa/reunioes/page.tsx` — três visualizações (mensal/lista/anual) sobre os MESMOS dados (spec seção 4: "o calendário deve possuir: visão calendário mensal, visão lista, visão anual"), começando pela mais simples (lista) com um seletor de visão:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { CipaCommittee, CipaMeeting, formatDateBR } from '@/lib/cipa-types';
import { getSelectedCompanyUnitId } from '../layout';
import { NovaExtraordinariaForm } from './NovaExtraordinariaForm';

const STATUS_LABEL: Record<CipaMeeting['status'], string> = {
  planejada: 'Planejada',
  agendada: 'Agendada',
  realizada: 'Realizada',
  cancelada: 'Cancelada',
  reagendada: 'Reagendada',
};

const STATUS_CLASS: Record<CipaMeeting['status'], string> = {
  planejada: 'bg-brand-50 text-brand-700',
  agendada: 'bg-amber-50 text-amber-800',
  realizada: 'bg-green-50 text-green-800',
  cancelada: 'bg-red-50 text-red-800',
  reagendada: 'bg-amber-50 text-amber-800',
};

type View = 'lista' | 'mensal' | 'anual';

export default function ReunioesPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [committee, setCommittee] = useState<CipaCommittee | null>(null);
  const [meetings, setMeetings] = useState<CipaMeeting[]>([]);
  const [view, setView] = useState<View>('lista');
  const [showForm, setShowForm] = useState(false);

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
    const headers = { Authorization: `Bearer ${token}` };
    const committees = await fetch(`/api/cipa/committees?company_unit_id=${unitId}`, { headers }).then((r) =>
      r.ok ? r.json() : [],
    );
    const active: CipaCommittee | null = committees.find((c: CipaCommittee) => c.status === 'ativa') ?? committees[0] ?? null;
    setCommittee(active);
    if (active) {
      const meetingsData = await fetch(`/api/cipa/meetings?committee_id=${active.id}`, { headers }).then((r) =>
        r.ok ? r.json() : [],
      );
      setMeetings(meetingsData);
    }
    setReady(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) {
    return <div className="px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  if (!committee) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-brand-700">
          Nenhuma gestão da CIPA ainda.{' '}
          <Link href="/empresa/cipa/nova-gestao" className="font-semibold text-brand-900 underline">
            Criar calendário
          </Link>
        </p>
      </div>
    );
  }

  const ordinarias = [...meetings].filter((m) => m.tipo === 'ordinaria').sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0));
  const extraordinarias = meetings.filter((m) => m.tipo === 'extraordinaria');
  const porMes: Record<number, CipaMeeting[]> = {};
  for (const m of meetings) {
    if (!m.data) continue;
    const mes = Number(m.data.split('-')[1]);
    porMes[mes] = [...(porMes[mes] ?? []), m];
  }

  function MeetingRow({ m }: { m: CipaMeeting }) {
    const titulo = m.tipo === 'ordinaria' ? `${m.numero}ª Reunião Ordinária` : m.titulo;
    return (
      <Link
        href={`/empresa/cipa/reunioes/${m.id}`}
        className="flex items-center justify-between gap-4 rounded-md border border-brand-100 px-4 py-3 hover:border-brand-500"
      >
        <div>
          <p className="text-sm font-medium text-brand-900">{titulo}</p>
          <p className="mt-0.5 text-xs text-brand-700">{m.data ? formatDateBR(m.data) : 'Sem data definida'}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[m.status]}`}>
          {STATUS_LABEL[m.status]}
        </span>
      </Link>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-900">📅 Reuniões da CIPA</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          ⚠️ Reunião extraordinária
        </button>
      </div>

      {showForm && (
        <NovaExtraordinariaForm
          committeeId={committee.id}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      <div className="mt-6 flex gap-2">
        {(['lista', 'mensal', 'anual'] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={
              view === v
                ? 'rounded-md bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-900'
                : 'rounded-md px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50'
            }
          >
            {v === 'lista' ? 'Lista' : v === 'mensal' ? 'Mensal' : 'Anual'}
          </button>
        ))}
      </div>

      {view === 'lista' && (
        <div className="mt-6 flex flex-col gap-2">
          {[...ordinarias, ...extraordinarias]
            .sort((a, b) => (a.data ?? '9999') < (b.data ?? '9999') ? -1 : 1)
            .map((m) => (
              <MeetingRow key={m.id} m={m} />
            ))}
        </div>
      )}

      {view === 'anual' && (
        <div className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {ordinarias.map((m) => (
            <MeetingRow key={m.id} m={m} />
          ))}
        </div>
      )}

      {view === 'mensal' && (
        <div className="mt-6 flex flex-col gap-6">
          {Object.entries(porMes)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([mes, ms]) => (
              <div key={mes}>
                <p className="text-xs font-bold uppercase tracking-wide text-brand-500">Mês {mes}</p>
                <div className="mt-2 flex flex-col gap-2">
                  {ms.map((m) => (
                    <MeetingRow key={m.id} m={m} />
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implementar o formulário de reunião extraordinária**

Criar `frontend/src/app/empresa/cipa/reunioes/NovaExtraordinariaForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { getToken } from '@/lib/auth';

export function NovaExtraordinariaForm({ committeeId, onCreated }: { committeeId: string; onCreated: () => void }) {
  const [titulo, setTitulo] = useState('');
  const [data, setData] = useState('');
  const [hora, setHora] = useState('');
  const [local, setLocal] = useState('');
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const token = getToken();
    try {
      const res = await fetch('/api/cipa/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          committee_id: committeeId,
          titulo,
          data: data || undefined,
          hora: hora || undefined,
          local: local || undefined,
          motivo: motivo || undefined,
        }),
      });
      if (!res.ok) {
        setError('Não foi possível criar a reunião. Confira os campos.');
        return;
      }
      onCreated();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <label className="flex flex-col gap-1 text-sm text-brand-900">
        Título
        <input
          type="text"
          required
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Data
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Horário
          <input
            type="time"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
            className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm text-brand-900">
        Local
        <input
          type="text"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-brand-900">
        Motivo
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
        />
      </label>
      <button
        type="submit"
        disabled={loading}
        className="self-start rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {loading ? 'Criando...' : 'Criar reunião extraordinária'}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Verificar manualmente no navegador**

Navegar até `/empresa/cipa/reunioes` (usando a gestão criada na Task 2). Confirmar: as 12 reuniões ordinárias aparecem nas 3 visualizações; clicar "Reunião extraordinária", preencher e criar, confirmar que aparece na lista depois; clicar numa reunião (rota `[id]` só existe de verdade na Task 4 — confirmar só que a navegação não quebra).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/empresa/cipa/reunioes/page.tsx frontend/src/app/empresa/cipa/reunioes/NovaExtraordinariaForm.tsx
git commit -m "feat: lista de reuniões da CIPA (mensal/lista/anual) + extraordinária"
```

---

## Task 4: Página de reunião individual — ata, checklist, participantes, aprovação

**Files:**
- Create: `frontend/src/app/empresa/cipa/reunioes/[id]/page.tsx`

**Interfaces:**
- Consumes: `CipaMeeting`, `CipaMeetingParticipant`, `CipaMember` (Task 1).

- [ ] **Step 1: Implementar a página de reunião**

Criar `frontend/src/app/empresa/cipa/reunioes/[id]/page.tsx` — a página mais densa da fase: campos de ata editáveis só em rascunho, checklist de 9 itens, participantes (membro cadastrado ou convidado por nome), aprovar/reabrir, link de download da ata quando aprovada:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { CipaMeeting, CipaMeetingParticipant, CipaMember, formatDateBR } from '@/lib/cipa-types';

const CHECKLIST_ITEMS: { field: keyof CipaMeeting; label: string; group: 'Antes' | 'Durante' | 'Depois' }[] = [
  { field: 'chk_pauta_definida', label: 'Pauta definida', group: 'Antes' },
  { field: 'chk_participantes_convocados', label: 'Participantes convocados', group: 'Antes' },
  { field: 'chk_local_confirmado', label: 'Local confirmado', group: 'Antes' },
  { field: 'chk_presenca_registrada', label: 'Presença registrada', group: 'Durante' },
  { field: 'chk_assuntos_discutidos', label: 'Assuntos discutidos', group: 'Durante' },
  { field: 'chk_decisoes_registradas', label: 'Decisões registradas', group: 'Durante' },
  { field: 'chk_ata_criada', label: 'Ata criada', group: 'Depois' },
  { field: 'chk_acoes_distribuidas', label: 'Ações distribuídas', group: 'Depois' },
  { field: 'chk_pendencias_registradas', label: 'Pendências registradas', group: 'Depois' },
];

export default function ReuniaoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [meeting, setMeeting] = useState<CipaMeeting | null>(null);
  const [participants, setParticipants] = useState<CipaMeetingParticipant[]>([]);
  const [members, setMembers] = useState<CipaMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [pauta, setPauta] = useState('');
  const [discussoes, setDiscussoes] = useState('');
  const [deliberacoes, setDeliberacoes] = useState('');
  const [novoNomeLivre, setNovoNomeLivre] = useState('');
  const [novoMembroId, setNovoMembroId] = useState('');

  async function load() {
    const token = getToken();
    if (!token) {
      router.push('/login');
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    const m: CipaMeeting = await fetch(`/api/cipa/meetings/${params.id}`, { headers }).then((r) => r.json());
    setMeeting(m);
    setPauta(m.pauta ?? '');
    setDiscussoes(m.discussoes ?? '');
    setDeliberacoes(m.deliberacoes ?? '');
    const membersData: CipaMember[] = await fetch(`/api/cipa/members?company_unit_id=${m.company_unit_id}`, {
      headers,
    }).then((r) => (r.ok ? r.json() : []));
    setMembers(membersData);
    setReady(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  if (!ready || !meeting) {
    return <div className="px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  const isRascunho = meeting.status_ata === 'rascunho';

  async function patch(data: Record<string, unknown>) {
    setError(null);
    setSaving(true);
    const token = getToken();
    try {
      const res = await fetch(`/api/cipa/meetings/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        setError('Não foi possível salvar. A ata pode já estar aprovada.');
        return;
      }
      const updated = await res.json();
      setMeeting(updated);
    } finally {
      setSaving(false);
    }
  }

  async function toggleChecklist(field: keyof CipaMeeting) {
    if (!isRascunho) return;
    await patch({ [field]: !meeting[field] });
  }

  async function saveAta() {
    await patch({ pauta, discussoes, deliberacoes });
  }

  async function addParticipant() {
    const next = [
      ...participants,
      novoMembroId
        ? { cipa_member_id: novoMembroId, presente: true }
        : { nome_livre: novoNomeLivre, presente: true },
    ];
    const token = getToken();
    const res = await fetch(`/api/cipa/meetings/${params.id}/participants`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ participants: next }),
    });
    if (res.ok) {
      setParticipants(await res.json());
      setNovoNomeLivre('');
      setNovoMembroId('');
    } else {
      setError('Não foi possível adicionar o participante.');
    }
  }

  async function approve() {
    if (!confirm('Aprovar esta ata? Depois de aprovada, ela fica travada para edição.')) return;
    setError(null);
    setSaving(true);
    const token = getToken();
    try {
      const res = await fetch(`/api/cipa/meetings/${params.id}/aprovar-ata`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError('Não foi possível aprovar a ata.');
        return;
      }
      setMeeting(await res.json());
    } finally {
      setSaving(false);
    }
  }

  async function reopen() {
    if (!confirm('Reabrir esta ata para edição?')) return;
    setError(null);
    setSaving(true);
    const token = getToken();
    try {
      const res = await fetch(`/api/cipa/meetings/${params.id}/reabrir-ata`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError('Não foi possível reabrir a ata.');
        return;
      }
      setMeeting(await res.json());
    } finally {
      setSaving(false);
    }
  }

  const titulo = meeting.tipo === 'ordinaria' ? `${meeting.numero}ª Reunião Ordinária da CIPA` : meeting.titulo;

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">{titulo}</h1>
      <p className="mt-1 text-sm text-brand-700">
        {meeting.data ? formatDateBR(meeting.data) : 'Sem data'} {meeting.hora ? `às ${meeting.hora}` : ''}
        {meeting.local ? ` — ${meeting.local}` : ''}
      </p>

      <div className="mt-3">
        {isRascunho ? (
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
            📝 Rascunho
          </span>
        ) : (
          <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800">
            ✅ Ata aprovada
          </span>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-brand-700">Checklist</h2>
      {(['Antes', 'Durante', 'Depois'] as const).map((group) => (
        <div key={group} className="mt-3">
          <p className="text-xs font-semibold text-brand-500">{group}</p>
          <div className="mt-1 flex flex-col gap-1">
            {CHECKLIST_ITEMS.filter((i) => i.group === group).map((item) => (
              <label key={item.field} className="flex items-center gap-2 text-sm text-brand-900">
                <input
                  type="checkbox"
                  checked={Boolean(meeting[item.field])}
                  disabled={!isRascunho || saving}
                  onChange={() => toggleChecklist(item.field)}
                />
                {item.label}
              </label>
            ))}
          </div>
        </div>
      ))}

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-brand-700">Ata</h2>
      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Pauta
          <textarea
            value={pauta}
            disabled={!isRascunho}
            onChange={(e) => setPauta(e.target.value)}
            className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2 disabled:bg-brand-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Discussões
          <textarea
            value={discussoes}
            disabled={!isRascunho}
            onChange={(e) => setDiscussoes(e.target.value)}
            className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2 disabled:bg-brand-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Deliberações
          <textarea
            value={deliberacoes}
            disabled={!isRascunho}
            onChange={(e) => setDeliberacoes(e.target.value)}
            className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2 disabled:bg-brand-50"
          />
        </label>
        {isRascunho && (
          <button
            onClick={saveAta}
            disabled={saving}
            className="self-start rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar ata'}
          </button>
        )}
      </div>

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-brand-700">Participantes</h2>
      <div className="mt-3 flex flex-col gap-2">
        {participants.map((p) => (
          <p key={p.id} className="text-sm text-brand-900">
            {p.cipa_member_id ? members.find((m) => m.id === p.cipa_member_id)?.nome ?? 'Membro' : p.nome_livre}
          </p>
        ))}
      </div>
      {isRascunho && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Membro cadastrado
            <select
              value={novoMembroId}
              onChange={(e) => {
                setNovoMembroId(e.target.value);
                setNovoNomeLivre('');
              }}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            >
              <option value="">Selecione...</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </label>
          <span className="pb-2 text-sm text-brand-700">ou</span>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Convidado (nome livre)
            <input
              type="text"
              value={novoNomeLivre}
              onChange={(e) => {
                setNovoNomeLivre(e.target.value);
                setNovoMembroId('');
              }}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <button
            onClick={addParticipant}
            disabled={!novoMembroId && !novoNomeLivre}
            className="rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Adicionar
          </button>
        </div>
      )}

      <div className="mt-10 flex gap-3">
        {isRascunho ? (
          <button
            onClick={approve}
            disabled={saving}
            className="rounded-[9px] bg-green-600 px-6 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            ✅ Aprovar ata
          </button>
        ) : (
          <>
            {meeting.ata_document_id && (
              <a
                href={`/api/documents/${meeting.ata_document_id}/download`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-[9px] border border-brand-500 px-6 py-3 text-sm font-semibold text-brand-700 hover:bg-brand-50"
              >
                📄 Baixar ata (PDF)
              </a>
            )}
            <button
              onClick={reopen}
              disabled={saving}
              className="rounded-[9px] border border-brand-100 px-6 py-3 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50"
            >
              🔓 Reabrir ata
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar manualmente no navegador**

Fluxo completo numa reunião real: preencher pauta/discussões/deliberações e salvar; marcar itens do checklist (confirmar persistência recarregando a página); adicionar um participante membro cadastrado e um convidado por nome; aprovar a ata (confirmar que os campos ficam desabilitados, o botão de aprovar some e os de baixar/reabrir aparecem); clicar em "Baixar ata (PDF)" e confirmar que o PDF abre/baixa com conteúdo real (data certa, nome do participante — não "(membro da CIPA)"); reabrir e confirmar que os campos voltam a ficar editáveis.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/empresa/cipa/reunioes/[id]
git commit -m "feat: página de reunião — ata, checklist, participantes, aprovação"
```

---

## Task 5: Membros da CIPA

**Files:**
- Create: `frontend/src/app/empresa/cipa/membros/page.tsx`

**Interfaces:**
- Consumes: `CipaMember`, `FUNCAO_CIPA_LABEL` (Task 1).

- [ ] **Step 1: Implementar a página de membros**

Criar `frontend/src/app/empresa/cipa/membros/page.tsx` — lista + formulário de criação inline + edição de status (ativo/inativo):

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { CipaMember, FUNCAO_CIPA_LABEL, formatDateBR } from '@/lib/cipa-types';
import { getSelectedCompanyUnitId } from '../layout';

export default function MembrosPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [members, setMembers] = useState<CipaMember[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [nome, setNome] = useState('');
  const [funcaoEmpresa, setFuncaoEmpresa] = useState('');
  const [setor, setSetor] = useState('');
  const [funcaoCipa, setFuncaoCipa] = useState<CipaMember['funcao_cipa']>('membro');
  const [titularSuplente, setTitularSuplente] = useState<CipaMember['titular_suplente']>('titular');
  const [representacao, setRepresentacao] = useState<CipaMember['representacao']>('empregados');
  const [inicioMandato, setInicioMandato] = useState('');
  const [fimMandato, setFimMandato] = useState('');

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
    const data = await fetch(`/api/cipa/members?company_unit_id=${unitId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : []));
    setMembers(data);
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
      const res = await fetch('/api/cipa/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          company_unit_id: unitId,
          nome,
          funcao_empresa: funcaoEmpresa || undefined,
          setor: setor || undefined,
          funcao_cipa: funcaoCipa,
          titular_suplente: titularSuplente,
          representacao,
          inicio_mandato: inicioMandato,
          fim_mandato: fimMandato,
        }),
      });
      if (!res.ok) {
        setError('Não foi possível cadastrar o membro. Confira os campos.');
        return;
      }
      setShowForm(false);
      setNome('');
      setFuncaoEmpresa('');
      setSetor('');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(member: CipaMember) {
    const token = getToken();
    const novoStatus = member.status === 'ativo' ? 'inativo' : 'ativo';
    const res = await fetch(`/api/cipa/members/${member.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: novoStatus }),
    });
    if (res.ok) await load();
  }

  if (!ready) {
    return <div className="px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-900">👥 Membros da CIPA</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + Novo membro
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-3 rounded-lg border border-brand-100 p-4">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Nome
            <input
              type="text"
              required
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Função na empresa
              <input
                type="text"
                value={funcaoEmpresa}
                onChange={(e) => setFuncaoEmpresa(e.target.value)}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Setor
              <input
                type="text"
                value={setor}
                onChange={(e) => setSetor(e.target.value)}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Função na CIPA
              <select
                value={funcaoCipa}
                onChange={(e) => setFuncaoCipa(e.target.value as CipaMember['funcao_cipa'])}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              >
                {Object.entries(FUNCAO_CIPA_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Titular/Suplente
              <select
                value={titularSuplente}
                onChange={(e) => setTitularSuplente(e.target.value as CipaMember['titular_suplente'])}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              >
                <option value="titular">Titular</option>
                <option value="suplente">Suplente</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Representação
              <select
                value={representacao}
                onChange={(e) => setRepresentacao(e.target.value as CipaMember['representacao'])}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              >
                <option value="empregados">Empregados</option>
                <option value="empregador">Empregador</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Início do mandato
              <input
                type="date"
                required
                value={inicioMandato}
                onChange={(e) => setInicioMandato(e.target.value)}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Fim do mandato
              <input
                type="date"
                required
                value={fimMandato}
                onChange={(e) => setFimMandato(e.target.value)}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="self-start rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Cadastrar membro'}
          </button>
        </form>
      )}

      <div className="mt-6 flex flex-col gap-2">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between rounded-md border border-brand-100 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-brand-900">
                {m.nome} — {FUNCAO_CIPA_LABEL[m.funcao_cipa]} ({m.titular_suplente})
              </p>
              <p className="mt-0.5 text-xs text-brand-700">
                Mandato: {formatDateBR(m.inicio_mandato)} a {formatDateBR(m.fim_mandato)}
              </p>
            </div>
            <button
              onClick={() => toggleStatus(m)}
              className={
                m.status === 'ativo'
                  ? 'rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800'
                  : 'rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-500'
              }
            >
              {m.status === 'ativo' ? 'Ativo' : 'Inativo'}
            </button>
          </div>
        ))}
        {members.length === 0 && <p className="text-sm text-brand-700">Nenhum membro cadastrado ainda.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar manualmente no navegador**

Navegar até `/empresa/cipa/membros`, cadastrar um membro (todos os campos), confirmar que aparece na lista com o mandato formatado corretamente, clicar no badge de status pra alternar ativo/inativo e confirmar que persiste ao recarregar.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/empresa/cipa/membros
git commit -m "feat: página de membros da CIPA"
```

---

## Task 6: Pendências da CIPA

**Files:**
- Create: `frontend/src/app/empresa/cipa/pendencias/page.tsx`

**Interfaces:**
- Consumes: `CipaPendencia`, `PRIORIDADE_LABEL`, `STATUS_PENDENCIA_LABEL` (Task 1).

- [ ] **Step 1: Implementar a página de pendências**

Criar `frontend/src/app/empresa/cipa/pendencias/page.tsx` — lista + criação de pendência solta (sem `meeting_id` — pendências nascidas de reunião já são criadas a partir da própria reunião numa fase futura; esta página cobre o caso "registrar pendência avulsa" da spec seção 8):

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { CipaPendencia, PRIORIDADE_LABEL, STATUS_PENDENCIA_LABEL, formatDateBR } from '@/lib/cipa-types';
import { getSelectedCompanyUnitId } from '../layout';

const STATUS_CLASS: Record<CipaPendencia['status'], string> = {
  aberta: 'bg-red-50 text-red-800',
  andamento: 'bg-amber-50 text-amber-800',
  concluida: 'bg-green-50 text-green-800',
  atrasada: 'bg-red-100 text-red-900',
};

export default function PendenciasPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [pendencias, setPendencias] = useState<CipaPendencia[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [descricao, setDescricao] = useState('');
  const [prazo, setPrazo] = useState('');
  const [prioridade, setPrioridade] = useState<CipaPendencia['prioridade']>('media');

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
    const data = await fetch(`/api/cipa/pendencias?company_unit_id=${unitId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : []));
    setPendencias(data);
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
      const res = await fetch('/api/cipa/pendencias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          company_unit_id: unitId,
          descricao,
          prazo: prazo || undefined,
          prioridade,
        }),
      });
      if (!res.ok) {
        setError('Não foi possível registrar a pendência.');
        return;
      }
      setShowForm(false);
      setDescricao('');
      setPrazo('');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(p: CipaPendencia, status: CipaPendencia['status']) {
    const token = getToken();
    const res = await fetch(`/api/cipa/pendencias/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    });
    if (res.ok) await load();
  }

  if (!ready) {
    return <div className="px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-900">📌 Pendências da CIPA</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + Nova pendência
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-3 rounded-lg border border-brand-100 p-4">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Descrição
            <textarea
              required
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Prazo
              <input
                type="date"
                value={prazo}
                onChange={(e) => setPrazo(e.target.value)}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Prioridade
              <select
                value={prioridade}
                onChange={(e) => setPrioridade(e.target.value as CipaPendencia['prioridade'])}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              >
                {Object.entries(PRIORIDADE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="self-start rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Registrar pendência'}
          </button>
        </form>
      )}

      <div className="mt-6 flex flex-col gap-2">
        {pendencias.map((p) => (
          <div key={p.id} className="rounded-md border border-brand-100 px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-900">{p.descricao}</p>
                <p className="mt-0.5 text-xs text-brand-700">
                  {PRIORIDADE_LABEL[p.prioridade]} · Prazo: {formatDateBR(p.prazo)}
                  {p.meeting_id && ' · Originada de reunião'}
                </p>
              </div>
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
            </div>
          </div>
        ))}
        {pendencias.length === 0 && <p className="text-sm text-brand-700">Nenhuma pendência registrada.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar manualmente no navegador**

Navegar até `/empresa/cipa/pendencias`, registrar uma pendência solta, confirmar que aparece na lista, mudar o status pelo seletor e confirmar que persiste ao recarregar.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/empresa/cipa/pendencias
git commit -m "feat: página de pendências da CIPA"
```

---

## Depois da última task

1. Rodar build de produção do frontend (`docker compose build frontend`) pra confirmar que não há erro de TypeScript/lint em nenhuma das 6 telas novas.
2. Fazer uma passada visual final ponta a ponta: criar gestão → gerar calendário → editar e aprovar a ata de uma reunião (conferindo o PDF baixado) → cadastrar membro → registrar e concluir uma pendência — o fluxo completo que a spec descreve como o diferencial da CIPA.
3. Seguir com `superpowers:finishing-a-development-branch` (branch é `main` direto, sem remote — só confirmar e reportar).
4. Atualizar `docs/roadmap.md` fechando o status da Fase 12b (12b-1 + 12b-2 juntas), mesmo formato das fases anteriores.
