'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminPageHeader } from '@/components/admin/PageHeader';
import { Badge, Card } from '@/components/admin/Card';

interface Partner {
  id: string;
  full_name: string;
  email: string;
  service_region: string;
  status: string;
}

interface TenantOption {
  id: string;
  name: string;
}

export default function AdminParceirosPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [listError, setListError] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [serviceRegion, setServiceRegion] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'erro'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const [assignFormId, setAssignFormId] = useState<string | null>(null);
  const [assignTenantId, setAssignTenantId] = useState('');
  const [assignStatus, setAssignStatus] = useState<'idle' | 'loading' | 'erro' | 'sucesso'>('idle');

  async function loadPartners() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/partners', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setPartners(await res.json());
        setListError('');
      } else {
        setListError('Não foi possível carregar os parceiros.');
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
      // seletor de empresa fica vazio; erro de conexão já reportado por loadPartners
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
    Promise.all([loadPartners(), loadTenants()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setErrorMessage('');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          email,
          password,
          full_name: fullName,
          phone: phone || undefined,
          service_region: serviceRegion,
        }),
      });
      if (res.ok) {
        setEmail('');
        setPassword('');
        setFullName('');
        setPhone('');
        setServiceRegion('');
        setStatus('idle');
        loadPartners();
        return;
      }
      const body = await res.json().catch(() => null);
      setErrorMessage(body?.message ?? 'Não foi possível cadastrar o parceiro.');
      setStatus('erro');
    } catch {
      setErrorMessage('Não foi possível conectar ao servidor.');
      setStatus('erro');
    }
  }

  async function handleAssign(event: FormEvent, partnerId: string) {
    event.preventDefault();
    setAssignStatus('loading');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/partners/${partnerId}/assign`, {
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
    return <p className="text-center text-brand-700">Carregando...</p>;
  }

  return (
    <div>
      <AdminPageHeader title="Parceiros" />

      <Card title="Criar parceiro" className="mt-6">
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
            Região de atendimento
            <input
              required
              value={serviceRegion}
              onChange={(e) => setServiceRegion(e.target.value)}
              className="adm-input"
            />
          </label>
          {status === 'erro' && <p className="text-sm text-red-600">{errorMessage}</p>}
          <button
            type="submit"
            disabled={status === 'loading'}
            className="adm-btn adm-btn-primary self-start disabled:opacity-50"
          >
            {status === 'loading' ? 'Cadastrando...' : 'Criar parceiro'}
          </button>
        </form>
      </Card>

      <Card title="Parceiros cadastrados" className="mt-8">
        {listError && <p className="mb-2 text-sm text-red-600">{listError}</p>}
        {partners.length === 0 ? (
          <p className="text-sm text-brand-700">Nenhum parceiro cadastrado ainda.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {partners.map((partner) => (
              <li key={partner.id} className="adm-card-2 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 break-words">
                    <strong className="text-brand-900">{partner.full_name}</strong>
                    <span className="ml-2 text-brand-700">{partner.email}</span>
                    <span className="ml-2 text-brand-700">({partner.service_region})</span>
                    <span className="ml-2">
                      <Badge tone="neutral">{partner.status}</Badge>
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setAssignFormId(partner.id);
                      setAssignStatus('idle');
                    }}
                    className="adm-link shrink-0 whitespace-nowrap"
                  >
                    Vincular a empresa
                  </button>
                </div>

                {assignFormId === partner.id && (
                  <form
                    onSubmit={(e) => handleAssign(e, partner.id)}
                    className="mt-3 flex flex-col gap-2 border-t border-brand-100 pt-3"
                  >
                    <label className="flex flex-col gap-1 text-xs text-brand-900">
                      Empresa
                      <select
                        required
                        value={assignTenantId}
                        onChange={(e) => setAssignTenantId(e.target.value)}
                        className="adm-input"
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
                        className="adm-btn adm-btn-primary self-start"
                      >
                        Confirmar vínculo
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
