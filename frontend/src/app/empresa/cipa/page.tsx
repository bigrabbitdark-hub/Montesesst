'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import {
  CipaCommittee,
  CipaMeeting,
  CipaMember,
  CipaPendencia,
  formatDateBR,
  getSelectedCompanyUnitId,
} from '@/lib/cipa-types';

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
