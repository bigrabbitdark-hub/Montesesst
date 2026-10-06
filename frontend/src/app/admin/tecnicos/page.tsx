'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminPageHeader } from '@/components/admin/PageHeader';
import { Badge, Card } from '@/components/admin/Card';

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
  const [assignTenantIds, setAssignTenantIds] = useState<string[]>([]);
  const [assignStatus, setAssignStatus] = useState<'idle' | 'loading' | 'erro' | 'sucesso' | 'parcial'>('idle');

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

  function toggleAssignTenant(tenantId: string) {
    setAssignTenantIds((prev) =>
      prev.includes(tenantId) ? prev.filter((id) => id !== tenantId) : [...prev, tenantId],
    );
  }

  async function handleAssign(event: FormEvent, technicianId: string) {
    event.preventDefault();
    setAssignStatus('loading');
    const token = localStorage.getItem('montese_token');
    // Backend só aceita uma empresa por chamada — repete a chamada pra
    // cada empresa marcada, sequencial (evita corrida se o técnico
    // clicar em duas empresas que disparassem o mesmo PATCH ao mesmo
    // tempo, e mantém o erro de uma chamada isolado das outras).
    let failures = 0;
    for (const tenantId of assignTenantIds) {
      try {
        const res = await fetch(`/api/technicians/${technicianId}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tenant_id: tenantId }),
        });
        if (!res.ok) failures += 1;
      } catch {
        failures += 1;
      }
    }
    if (failures === 0) {
      setAssignStatus('sucesso');
      setAssignTenantIds([]);
    } else if (failures === assignTenantIds.length) {
      setAssignStatus('erro');
    } else {
      setAssignStatus('parcial');
    }
  }

  if (!ready) {
    return <p className="text-center text-brand-700">Carregando...</p>;
  }

  return (
    <div>
      <AdminPageHeader title="Técnicos" />

      <Card title="Criar técnico" className="mt-6">
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            E-mail
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="adm-input"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Senha
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="adm-input"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Nome completo
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="adm-input"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Telefone (opcional)
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="adm-input"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Registro profissional (opcional)
            <input
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
              className="adm-input"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Especialização (opcional)
            <input
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
              className="adm-input"
            />
          </label>
          {status === 'erro' && <p className="text-sm text-red-600">{errorMessage}</p>}
          <button
            type="submit"
            disabled={status === 'loading'}
            className="adm-btn adm-btn-primary self-start disabled:opacity-50"
          >
            {status === 'loading' ? 'Cadastrando...' : 'Criar técnico'}
          </button>
        </form>
      </Card>

      <Card title="Técnicos cadastrados" className="mt-8">
        {listError && <p className="mb-2 text-sm text-red-600">{listError}</p>}
        {technicians.length === 0 ? (
          <p className="text-sm text-brand-700">Nenhum técnico cadastrado ainda.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {technicians.map((tech) => (
              <li key={tech.id} className="adm-card-2 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 break-words">
                    <strong className="text-brand-900">{tech.full_name}</strong>
                    <span className="ml-2 text-brand-700">{tech.email}</span>
                    {tech.specialization && (
                      <span className="ml-2 text-brand-700">({tech.specialization})</span>
                    )}
                    <span className="ml-2">
                      <Badge tone="neutral">{tech.status}</Badge>
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setAssignFormId(tech.id);
                      setAssignTenantIds([]);
                      setAssignStatus('idle');
                    }}
                    className="adm-link shrink-0 whitespace-nowrap"
                  >
                    Vincular a empresa
                  </button>
                </div>

                {assignFormId === tech.id && (
                  <form
                    onSubmit={(e) => handleAssign(e, tech.id)}
                    className="mt-3 flex flex-col gap-2 border-t border-brand-100 pt-3"
                  >
                    <p className="text-xs text-brand-900">Empresas (selecione uma ou mais)</p>
                    <div className="adm-input flex max-h-40 flex-col gap-1 overflow-y-auto">
                      {tenants.map((tenant) => (
                        <label key={tenant.id} className="flex items-center gap-2 text-xs text-brand-900">
                          <input
                            type="checkbox"
                            checked={assignTenantIds.includes(tenant.id)}
                            onChange={() => toggleAssignTenant(tenant.id)}
                          />
                          {tenant.name}
                        </label>
                      ))}
                    </div>
                    {assignStatus === 'erro' && (
                      <p className="text-xs text-red-600">Não foi possível vincular a nenhuma empresa selecionada.</p>
                    )}
                    {assignStatus === 'parcial' && (
                      <p className="text-xs text-red-600">
                        Vinculado a algumas empresas, mas não a todas — confira e tente de novo as que faltaram.
                      </p>
                    )}
                    {assignStatus === 'sucesso' && (
                      <p className="text-xs text-brand-700">Vinculado com sucesso.</p>
                    )}
                    <div className="flex gap-3">
                      <button
                        type="submit"
                        disabled={assignTenantIds.length === 0 || assignStatus === 'loading'}
                        className="adm-btn adm-btn-primary self-start disabled:opacity-50"
                      >
                        {assignStatus === 'loading' ? 'Vinculando...' : 'Confirmar vínculo'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAssignFormId(null)}
                        className="adm-btn self-start"
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
      </Card>
    </div>
  );
}
