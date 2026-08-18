'use client';

import { FormEvent, useState } from 'react';

export default function CadastroPage() {
  const [companyName, setCompanyName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'erro'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName,
          cnpj,
          full_name: fullName,
          email,
          password,
        }),
      });
      if (res.ok) {
        setStatus('ok');
        return;
      }
      const body = await res.json().catch(() => null);
      setErrorMessage(
        res.status === 409
          ? 'CNPJ ou e-mail já cadastrado.'
          : body?.message ?? 'Não foi possível concluir o cadastro.',
      );
      setStatus('erro');
    } catch {
      setErrorMessage('Não foi possível conectar ao servidor.');
      setStatus('erro');
    }
  }

  if (status === 'ok') {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-brand-900">Verifique seu e-mail</h1>
        <p className="mt-4 text-brand-700">
          Enviamos um link de confirmação para <strong>{email}</strong>. Confirme pra ativar o
          cadastro e poder entrar.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Comece grátis</h1>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Nome da empresa
          <input
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          CNPJ
          <input
            required
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
            placeholder="00.000.000/0000-00"
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Nome do responsável
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          E-mail
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Senha
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        {status === 'erro' && <p className="text-sm text-red-600">{errorMessage}</p>}
        <button
          type="submit"
          disabled={status === 'loading'}
          className="rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Enviando...' : 'Criar conta'}
        </button>
      </form>
    </div>
  );
}
