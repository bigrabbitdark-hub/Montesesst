'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminNav } from '@/components/AdminNav';

interface Technician {
  id: string;
  full_name: string;
  email: string;
  registration_number: string | null;
  specialization: string | null;
  status: string;
}

interface TenantOption {
  id: string;
  name: string;
}

export default function AdminTecnicosPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [listError, setListError] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'erro'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const [assignFormId, setAssignFormId] = useState<string | null>(null);
  const [assignTenantId, setAssignTenantId] = useState('');
  const [assignStatus, setAssignStatus] = useState<'idle' | 'loading' | 'erro' | 'sucesso'>('idle');

  async function loadTechnicians() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/technicians', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setTechnicians(await res.json());
        setListError('');
      } else {
        setListError('Não foi possível carregar os técnicos.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
  }

  async function loadTenants() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/tenants', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setTenants(await res.json());
    } catch {
      // seletor de empresa fica vazio; erro de conexão já reportado por loadTechnicians
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
    Promise.all([loadTechnicians(), loadTenants()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setErrorMessage('');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/technicians', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          email,
          password,
          full_name: fullName,
          phone: phone || undefined,
          registration_number: registrationNumber || undefined,
          specialization: specialization || undefined,
        }),
      });
      if (res.ok) {
        setEmail('');
        setPassword('');
        setFullName('');
        setPhone('');
        setRegistrationNumber('');
        setSpecialization('');
        setStatus('idle');
        loadTechnicians();
        return;
      }
      const body = await res.json().catch(() => null);
      setErrorMessage(body?.message ?? 'Não foi possível cadastrar o técnico.');
      setStatus('erro');
    } catch {
      setErrorMessage('Não foi possível conectar ao servidor.');
      setStatus('erro');
    }
  }

  async function handleAssign(event: FormEvent, technicianId: string) {
    event.preventDefault();
    setAssignStatus('loading');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/technicians/${technicianId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: assignTenantId }),
      });
      if (res.ok) {
        setAssignStatus('sucesso');
        setAssignTenantId('');
      } else {
        setAssignStatus('erro');
      }
    } catch {
      setAssignStatus('erro');
    }
  }

  if (!ready) {
    return <div className="mx-auto max-w-4xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Painel administrativo</h1>
      <div className="mt-6">
        <AdminNav />
      </div>

      <section className="mt-8 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Criar técnico</h2>
        <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            E-mail
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Senha
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Nome completo
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Telefone (opcional)
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Registro profissional (opcional)
            <input
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Especialização (opcional)
            <input
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          {status === 'erro' && <p className="text-sm text-red-600">{errorMessage}</p>}
          <button
            type="submit"
            disabled={status === 'loading'}
            className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {status === 'loading' ? 'Cadastrando...' : 'Criar técnico'}
          </button>
        </form>
      </section>

      <section className="mt-8 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Técnicos cadastrados</h2>
        {listError && <p className="mt-2 text-sm text-red-600">{listError}</p>}
        {technicians.length === 0 ? (
          <p className="mt-4 text-sm text-brand-700">Nenhum técnico cadastrado ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {technicians.map((tech) => (
              <li key={tech.id} className="rounded-md border border-brand-100 px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <strong className="text-brand-900">{tech.full_name}</strong>
                    <span className="ml-2 text-brand-700">{tech.email}</span>
                    {tech.specialization && (
                      <span className="ml-2 text-brand-700">({tech.specialization})</span>
                    )}
                    <span className="ml-2 text-brand-700">{tech.status}</span>
                  </div>
                  <button
                    onClick={() => {
                      setAssignFormId(tech.id);
                      setAssignStatus('idle');
                    }}
                    className="text-brand-500 hover:underline"
                  >
                    Vincular a empresa
                  </button>
                </div>

                {assignFormId === tech.id && (
                  <form
                    onSubmit={(e) => handleAssign(e, tech.id)}
                    className="mt-3 flex flex-col gap-2 border-t border-brand-100 pt-3"
                  >
                    <label className="flex flex-col gap-1 text-xs text-brand-900">
                      Empresa
                      <select
                        required
                        value={assignTenantId}
                        onChange={(e) => setAssignTenantId(e.target.value)}
                        className="rounded-md border border-brand-100 px-3 py-2"
                      >
                        <option value="">Selecione</option>
                        {tenants.map((tenant) => (
                          <option key={tenant.id} value={tenant.id}>
                            {tenant.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {assignStatus === 'erro' && (
                      <p className="text-xs text-red-600">Não foi possível vincular.</p>
                    )}
                    {assignStatus === 'sucesso' && (
                      <p className="text-xs text-brand-700">Vinculado com sucesso.</p>
                    )}
                    <div className="flex gap-3">
                      <button
                        type="submit"
                        className="self-start rounded-md bg-brand-500 px-4 py-2 text-xs font-medium text-white hover:bg-brand-700"
                      >
                        Confirmar vínculo
                      </button>
                      <button
                        type="button"
                        onClick={() => setAssignFormId(null)}
                        className="self-start rounded-md border border-brand-100 px-4 py-2 text-xs font-medium text-brand-700"
                      >
                        Fechar
                      </button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
