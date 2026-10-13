'use client';

import { FormEvent, useRef, useState } from 'react';
import { AuthSplit } from '@/components/AuthSplit';
import { useCnpjLookup } from '@/lib/useCnpjLookup';

export default function CadastroPage() {
  const [companyName, setCompanyName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'erro'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  // Razão social vinda da consulta: só é trocada por outra consulta se o
  // usuário não tiver editado o campo (nunca sobrescreve o que ele digitou).
  const autoFilledName = useRef<string | null>(null);
  const [nameFromLookup, setNameFromLookup] = useState(false);
  const companyNameRef = useRef(companyName);
  companyNameRef.current = companyName;
  const { state: lookupState, lookup } = useCnpjLookup((data) => {
    if (!data.razao_social) return;
    const current = companyNameRef.current;
    if (current.trim() && current !== autoFilledName.current) return;
    autoFilledName.current = data.razao_social;
    setCompanyName(data.razao_social);
    setNameFromLookup(true);
  });

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
      <AuthSplit
        photo="/photos/mountain-hero.jpg"
        photoAlt=""
        quote="Tecnologia que organiza. Gestão que protege."
      >
        <div className="text-center">
          <h1 className="text-[28px] font-extrabold text-brand-900 sm:text-[32px]">Verifique seu e-mail</h1>
          <p className="mt-3.5 text-[15.5px] leading-relaxed text-brand-700">
            Enviamos um link de confirmação para <strong>{email}</strong>. Confirme pra ativar o
            cadastro e poder entrar.
          </p>
        </div>
      </AuthSplit>
    );
  }

  return (
    <AuthSplit
      photo="/photos/mountain-hero.jpg"
      photoAlt=""
      quote="Tecnologia que organiza. Gestão que protege."
      checklist={['Trial grátis, sem cartão de crédito', 'Atualizado com as NRs', 'Auditoria de ponta a ponta']}
    >
      <div className="text-center">
        <h1 className="text-[28px] font-extrabold text-brand-900 sm:text-[32px]">Comece grátis</h1>

        <div className="mt-7 rounded-2xl border border-brand-100 bg-white p-7 text-left shadow-sm">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Nome da empresa
              <input
                required
                value={companyName}
                onChange={(e) => {
                  setCompanyName(e.target.value);
                  setNameFromLookup(false);
                }}
                className="w-full rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3.5 text-sm text-brand-900 placeholder:text-brand-300"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              CNPJ
              <input
                required
                value={cnpj}
                onChange={(e) => setCnpj(e.target.value)}
                onBlur={() => lookup(cnpj)}
                placeholder="00.000.000/0000-00"
                aria-describedby="cnpj-status"
                className="w-full rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3.5 text-sm text-brand-900 placeholder:text-brand-300"
              />
              <span id="cnpj-status" role="status" aria-live="polite" className="text-xs">
                {lookupState.status === 'loading' && (
                  <span className="text-brand-700">Consultando CNPJ...</span>
                )}
                {lookupState.status === 'erro' && (
                  <span className="text-red-600">{lookupState.message}</span>
                )}
                {lookupState.status === 'done' && nameFromLookup && (
                  <span className="text-brand-700">
                    Razão social preenchida pela consulta (BrasilAPI / Receita Federal). Confira antes de continuar.
                  </span>
                )}
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Nome do responsável
              <input
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3.5 text-sm text-brand-900 placeholder:text-brand-300"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              E-mail
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3.5 text-sm text-brand-900 placeholder:text-brand-300"
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
                className="w-full rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3.5 text-sm text-brand-900 placeholder:text-brand-300"
              />
            </label>
            {status === 'erro' && <p className="text-sm text-red-600">{errorMessage}</p>}
            <button
              type="submit"
              disabled={status === 'loading'}
              className="rounded-[9px] bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              {status === 'loading' ? 'Enviando...' : 'Criar conta'}
            </button>
          </form>
        </div>
      </div>
    </AuthSplit>
  );
}
