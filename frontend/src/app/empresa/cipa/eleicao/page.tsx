'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getUser } from '@/lib/auth';
import {
  CipaElection,
  CipaElectionCandidate,
  Employee,
  formatDateBR,
  getSelectedCompanyUnitId,
} from '@/lib/cipa-types';

export default function EleicaoPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [election, setElection] = useState<CipaElection | null>(null);
  const [candidates, setCandidates] = useState<CipaElectionCandidate[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [ano, setAno] = useState(new Date().getFullYear());
  const [dataEleicao, setDataEleicao] = useState('');
  const [inicioMandato, setInicioMandato] = useState('');
  const [fimMandato, setFimMandato] = useState('');

  const [novoEmployeeId, setNovoEmployeeId] = useState('');
  const [novoNomeLivre, setNovoNomeLivre] = useState('');

  // Achado 1 (Important) da revisão: sem isso, uma eleição concluída vira
  // um beco sem saída permanente — o form de criação só aparecia quando
  // `!election`, e depois de concluída `election` nunca mais volta a
  // `null` (a mais recente concluída vira `elections[0]`). Eleições da
  // CIPA são periódicas (mandatos da NR-5 se renovam), então precisa dar
  // pra abrir uma eleição nova depois que a anterior é concluída — o
  // backend já permite isso (só rejeita com 409 se já existe uma aberta).
  const [mostrandoNovaEleicao, setMostrandoNovaEleicao] = useState(false);

  async function load() {
    const token = getToken();
    const user = getUser();
    const unitId = getSelectedCompanyUnitId();
    if (!token || !user) {
      router.push('/login');
      return;
    }
    if (!unitId) {
      setReady(true);
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    const elections: CipaElection[] = await fetch(`/api/cipa/elections?company_unit_id=${unitId}`, {
      headers,
    }).then((r) => (r.ok ? r.json() : []));
    // Mais recente primeiro (já vem ordenado por created_at DESC do
    // backend) — pega a aberta se existir, senão a mais recente
    // concluída (histórico), senão nenhuma.
    const current = elections.find((e) => e.status === 'aberta') ?? elections[0] ?? null;
    setElection(current);

    if (current) {
      const candidatesData: CipaElectionCandidate[] = await fetch(
        `/api/cipa/elections/${current.id}/candidates`,
        { headers },
      ).then((r) => (r.ok ? r.json() : []));
      setCandidates(candidatesData);
    }

    const employeesData: Employee[] = await fetch(`/api/employees?tenant_id=${user.tenantId}`, { headers }).then(
      (r) => (r.ok ? r.json() : []),
    );
    // Achado 2 (Important) da revisão: guarda TODOS os funcionários aqui
    // (sem filtro) — precisamos deles pra resolver o nome de exibição de
    // candidatos já adicionados (abaixo), inclusive os que foram
    // desativados depois de virar candidato. O filtro por `ativo` só faz
    // sentido pro seletor de NOVO candidato, e é derivado separadamente
    // no render (`activeEmployees`).
    setEmployees(employeesData);

    setReady(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createElection(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const token = getToken();
    const unitId = getSelectedCompanyUnitId();
    try {
      const res = await fetch('/api/cipa/elections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          company_unit_id: unitId,
          ano,
          data_eleicao: dataEleicao || undefined,
          inicio_mandato: inicioMandato,
          fim_mandato: fimMandato,
        }),
      });
      if (!res.ok) {
        // 409 = já existe uma eleição aberta pra este estabelecimento
        // (índice único parcial do backend) — mensagem específica em vez
        // da genérica de "confira as datas", que induziria o usuário a
        // mexer nos campos errados.
        if (res.status === 409) {
          setError('Já existe uma eleição aberta para este estabelecimento.');
        } else {
          setError('Não foi possível criar a eleição. Confira as datas informadas.');
        }
        return;
      }
      setMostrandoNovaEleicao(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function addCandidate() {
    if (!election) return;
    setError(null);
    const token = getToken();
    const res = await fetch(`/api/cipa/elections/${election.id}/candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(
        novoEmployeeId ? { employee_id: novoEmployeeId } : { nome_livre: novoNomeLivre },
      ),
    });
    if (res.ok) {
      setNovoEmployeeId('');
      setNovoNomeLivre('');
      await load();
    } else {
      setError('Não foi possível adicionar o candidato.');
    }
  }

  async function updateCandidate(candidateId: string, data: Record<string, unknown>) {
    if (!election) return;
    setError(null);
    const token = getToken();
    const res = await fetch(`/api/cipa/elections/${election.id}/candidates/${candidateId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      await load();
    } else {
      setError('Não foi possível salvar. Candidato eleito precisa de titular/suplente definido.');
    }
  }

  async function concludeElection() {
    if (!election) return;
    if (!confirm('Concluir esta eleição? Os candidatos marcados como eleitos serão adicionados aos membros da CIPA. Esta ação não pode ser desfeita.')) {
      return;
    }
    setError(null);
    setSaving(true);
    const token = getToken();
    try {
      const res = await fetch(`/api/cipa/elections/${election.id}/concluir`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError('Não foi possível concluir a eleição.');
        return;
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (!ready) {
    return <div className="px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  const isAberta = election?.status === 'aberta';
  // Achado 2: filtro de `ativo` derivado só pro seletor de novo candidato
  // — `employees` em si fica sem filtro (usado pra resolver nome de
  // candidatos já adicionados, mesmo que o funcionário tenha sido
  // desativado depois).
  const activeEmployees = employees.filter((e) => e.status === 'ativo');
  const showCreateForm = !election || (election.status === 'concluida' && mostrandoNovaEleicao);

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">🗳️ Eleição da CIPA</h1>
      <p className="mt-1 text-sm text-brand-700">
        Candidatos e resultado da eleição de representantes dos empregados. A votação em si continua física — o
        sistema só registra o que já foi apurado.
      </p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {showCreateForm && (
        <form onSubmit={createElection} className="mt-6 flex flex-col gap-4 rounded-lg border border-brand-100 p-4">
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
            Data da votação (opcional)
            <input
              type="date"
              value={dataEleicao}
              onChange={(e) => setDataEleicao(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Início do mandato
            <input
              type="date"
              required
              value={inicioMandato}
              onChange={(e) => setInicioMandato(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Fim do mandato
            <input
              type="date"
              required
              value={fimMandato}
              onChange={(e) => setFimMandato(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="self-start rounded-[9px] bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? 'Criando...' : 'Criar eleição'}
            </button>
            {election && (
              <button
                type="button"
                onClick={() => setMostrandoNovaEleicao(false)}
                className="text-sm font-semibold text-brand-700 underline"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      {election && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-brand-700">
              Eleição {election.ano} — mandato de {formatDateBR(election.inicio_mandato)} a{' '}
              {formatDateBR(election.fim_mandato)}
            </p>
            <span
              className={
                isAberta
                  ? 'rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700'
                  : 'rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-800'
              }
            >
              {isAberta ? '📝 Aberta' : '✅ Concluída'}
            </span>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {candidates.map((c) => (
              <div key={c.id} className="rounded-md border border-brand-100 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-medium text-brand-900">
                    {c.employee_id ? employees.find((e) => e.id === c.employee_id)?.full_name ?? 'Funcionário' : c.nome_livre}
                  </p>
                  {isAberta ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        placeholder="Votos"
                        value={c.votos ?? ''}
                        onChange={(e) => updateCandidate(c.id, { votos: Number(e.target.value) })}
                        className="w-20 rounded-[9px] border-[1.5px] border-brand-100 px-2 py-1 text-sm"
                      />
                      <select
                        value={c.eleito ? c.titular_suplente ?? '' : ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (!value) {
                            updateCandidate(c.id, { eleito: false });
                          } else {
                            updateCandidate(c.id, { eleito: true, titular_suplente: value });
                          }
                        }}
                        className="rounded-[9px] border-[1.5px] border-brand-100 px-2 py-1 text-sm"
                      >
                        <option value="">Não eleito</option>
                        <option value="titular">Eleito — titular</option>
                        <option value="suplente">Eleito — suplente</option>
                      </select>
                    </div>
                  ) : (
                    <p className="text-xs text-brand-700">
                      {c.votos ?? 0} votos
                      {c.eleito ? ` · Eleito (${c.titular_suplente})` : ''}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {candidates.length === 0 && <p className="text-sm text-brand-700">Nenhum candidato cadastrado ainda.</p>}
          </div>

          {isAberta && (
            <>
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm text-brand-900">
                  Funcionário cadastrado
                  <select
                    value={novoEmployeeId}
                    onChange={(e) => {
                      setNovoEmployeeId(e.target.value);
                      setNovoNomeLivre('');
                    }}
                    className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
                  >
                    <option value="">Selecione...</option>
                    {activeEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.full_name}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="pb-2 text-sm text-brand-700">ou</span>
                <label className="flex flex-col gap-1 text-sm text-brand-900">
                  Nome livre
                  <input
                    type="text"
                    value={novoNomeLivre}
                    onChange={(e) => {
                      setNovoNomeLivre(e.target.value);
                      setNovoEmployeeId('');
                    }}
                    className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
                  />
                </label>
                <button
                  onClick={addCandidate}
                  disabled={!novoEmployeeId && !novoNomeLivre}
                  className="rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  Adicionar candidato
                </button>
              </div>

              <button
                onClick={concludeElection}
                disabled={saving || candidates.length === 0}
                className="mt-8 rounded-[9px] bg-green-600 px-6 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                ✅ Concluir eleição
              </button>
            </>
          )}

          {!isAberta && !mostrandoNovaEleicao && (
            <button
              onClick={() => setMostrandoNovaEleicao(true)}
              className="mt-8 rounded-[9px] bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Criar nova eleição
            </button>
          )}
        </div>
      )}
    </div>
  );
}
