'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getUser, homeFor } from '@/lib/auth';
import { MSG_SENHA_72_BYTES, senhaPassaDe72Bytes } from '@/lib/senha';

const inputClass =
  'w-full rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3.5 text-sm text-brand-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

export default function TrocarSenhaPage() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Esta rota fica fora do RoleGuard (evita laço): decide aqui quem pode ficar.
  useEffect(() => {
    const token = getToken();
    const user = getUser();
    if (!token || !user) {
      router.replace('/login');
      return;
    }
    if (!user.mustChangePassword) {
      router.replace(homeFor(user.role));
      return;
    }
    setPronto(true);
  }, [router]);

  async function enviar(event: FormEvent) {
    event.preventDefault();
    setErro(null);
    if (nova.length < 8 || nova.length > 72) {
      setErro('A nova senha deve ter entre 8 e 72 caracteres.');
      return;
    }
    if (senhaPassaDe72Bytes(nova)) {
      setErro(MSG_SENHA_72_BYTES);
      return;
    }
    if (nova !== confirmacao) {
      setErro('A confirmação não é igual à nova senha.');
      return;
    }
    if (nova === atual) {
      setErro('A nova senha deve ser diferente da senha temporária.');
      return;
    }
    const user = getUser();
    setEnviando(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ current_password: atual, new_password: nova }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.access_token || !user) {
        setErro(typeof data?.message === 'string' ? data.message : Array.isArray(data?.message) ? data.message.join(' ') : 'Não foi possível trocar a senha.');
        return;
      }
      localStorage.setItem('montese_token', data.access_token);
      localStorage.setItem('montese_user', JSON.stringify({ ...user, mustChangePassword: false }));
      router.push(homeFor(user.role));
    } catch {
      setErro('Não foi possível conectar ao servidor.');
    } finally {
      setEnviando(false);
    }
  }

  if (!pronto) {
    return (
      <div role="status" aria-live="polite" className="flex min-h-[40vh] items-center justify-center px-4 text-sm text-brand-700">
        Verificando acesso...
      </div>
    );
  }

  return (
    <section className="bg-gradient-to-b from-brand-50 to-white px-4 pb-16 pt-14 sm:px-10">
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-[28px] font-extrabold text-brand-900 sm:text-[32px]">Defina sua nova senha</h1>
        <p className="mt-3 text-sm text-brand-700">
          Você entrou com uma senha temporária. Por segurança, escolha uma senha só sua para continuar.
        </p>
        <div className="mt-7 rounded-2xl border border-brand-100 bg-white p-7 text-left shadow-sm">
          <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1 text-sm text-brand-900">
              <label htmlFor="senha-temporaria">Senha temporária</label>
              <input id="senha-temporaria" type="password" required autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} className={inputClass} />
            </div>
            <div className="flex flex-col gap-1 text-sm text-brand-900">
              <label htmlFor="nova-senha">Nova senha</label>
              <input id="nova-senha" type="password" required minLength={8} maxLength={72} autoComplete="new-password" aria-describedby="nova-senha-ajuda" value={nova} onChange={(e) => setNova(e.target.value)} className={inputClass} />
              <span id="nova-senha-ajuda" className="text-xs text-brand-700">De 8 a 72 caracteres (acentos contam em dobro), diferente da senha temporária.</span>
            </div>
            <div className="flex flex-col gap-1 text-sm text-brand-900">
              <label htmlFor="confirmar-nova-senha">Confirmar nova senha</label>
              <input id="confirmar-nova-senha" type="password" required autoComplete="new-password" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} className={inputClass} />
            </div>
            {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
            <button
              type="submit"
              disabled={enviando}
              className="rounded-[9px] bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-900 focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {enviando ? 'Trocando senha...' : 'Trocar senha'}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
