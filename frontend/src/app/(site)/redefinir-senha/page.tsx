'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';

const MIN_LENGTH = 8;
const MAX_LENGTH = 72;

type Status = 'lendo' | 'sem-token' | 'pronto' | 'concluido';

export default function RedefinirSenhaPage() {
  const [status, setStatus] = useState<Status>('lendo');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [linkInvalido, setLinkInvalido] = useState(false);
  const [loading, setLoading] = useState(false);

  // O token vem no fragmento (#token=...), que o navegador não envia ao
  // servidor. Aqui ele é lido e logo removido da barra de endereço, para não
  // ficar no histórico, em capturas de tela nem em "copiar link da página".
  // `hashchange`: colar um segundo link (novo token) na MESMA aba é uma
  // navegação só de fragmento — o navegador não recarrega a página, então sem
  // este ouvinte o token novo seria ignorado.
  useEffect(() => {
    const readToken = (): string | null =>
      new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token');

    const found = readToken();
    window.history.replaceState(null, '', window.location.pathname);
    if (found) {
      setToken(found);
      setStatus('pronto');
    } else {
      setStatus('sem-token');
    }

    const onHashChange = () => {
      const next = readToken();
      if (!next) return;
      window.history.replaceState(null, '', window.location.pathname);
      setToken(next);
      setError(null);
      setLinkInvalido(false);
      setPassword('');
      setConfirm('');
      setStatus('pronto');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) {
      setError(`A senha precisa ter pelo menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (password.length > MAX_LENGTH) {
      setError(`A senha pode ter no máximo ${MAX_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError('As senhas não conferem.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        setToken('');
        setStatus('concluido');
        return;
      }
      const body = await res.json().catch(() => null);
      if (res.status === 429) {
        setError('Muitas tentativas. Aguarde um pouco e tente novamente.');
      } else if (res.status === 400 && /link/i.test(String(body?.message ?? ''))) {
        setLinkInvalido(true);
        setError('Este link é inválido, expirou ou já foi usado.');
      } else {
        setError(Array.isArray(body?.message) ? body.message[0] : (body?.message ?? 'Não foi possível redefinir a senha.'));
      }
    } catch {
      setError('Não foi possível conectar ao servidor.');
    } finally {
      setLoading(false);
    }
  }

  const invalidLink = (
    <div role="alert" className="flex flex-col gap-4 text-sm text-brand-900">
      <p>Este link é inválido, expirou ou já foi usado.</p>
      <Link href="/esqueci-senha" className="text-center font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-900">
        Pedir um novo link
      </Link>
    </div>
  );

  return (
    <section className="bg-gradient-to-b from-brand-50 to-white px-4 pb-16 pt-14 sm:px-10">
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-[28px] font-extrabold text-brand-900 sm:text-[32px]">Criar nova senha</h1>

        <div className="mt-7 rounded-2xl border border-brand-100 bg-white p-7 text-left shadow-sm">
          {status === 'lendo' && <p className="text-sm text-brand-700">Carregando...</p>}

          {status === 'sem-token' && invalidLink}

          {status === 'concluido' && (
            <div role="status" className="flex flex-col gap-4 text-sm text-brand-900">
              <p>Senha redefinida. Você já pode entrar com a nova senha.</p>
              <Link
                href="/login"
                className="rounded-[9px] bg-brand-500 px-6 py-3.5 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-700"
              >
                Entrar
              </Link>
            </div>
          )}

          {status === 'pronto' && linkInvalido && invalidLink}

          {status === 'pronto' && !linkInvalido && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {/* A regra fica FORA do <label>: dentro dele o nome acessível do campo
                  viraria "Nova senha Entre 8 e 72 caracteres." e o leitor de tela leria
                  a regra duas vezes (no rótulo e via aria-describedby). */}
              <div className="flex flex-col gap-1 text-sm text-brand-900">
                <label htmlFor="nova-senha">Nova senha</label>
                <input
                  id="nova-senha"
                  type="password"
                  required
                  autoComplete="new-password"
                  minLength={MIN_LENGTH}
                  maxLength={MAX_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-describedby="regras-senha"
                  className="w-full rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3.5 text-sm text-brand-900 placeholder:text-brand-300"
                />
                <span id="regras-senha" className="text-xs text-brand-700">
                  Entre {MIN_LENGTH} e {MAX_LENGTH} caracteres.
                </span>
              </div>
              <label className="flex flex-col gap-1 text-sm text-brand-900">
                Repita a nova senha
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3.5 text-sm text-brand-900 placeholder:text-brand-300"
                />
              </label>
              {error && (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="rounded-[9px] bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
              >
                {loading ? 'Salvando...' : 'Salvar nova senha'}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
