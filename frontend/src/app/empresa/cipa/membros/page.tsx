'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { CipaMember, FUNCAO_CIPA_LABEL, formatDateBR, getSelectedCompanyUnitId } from '@/lib/cipa-types';

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
