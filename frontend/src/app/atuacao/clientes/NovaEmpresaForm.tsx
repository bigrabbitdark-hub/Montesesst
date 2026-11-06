'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { isValidCnpj, onlyDigits, formatCnpj } from '@/lib/cnpj';
import { useCnpjLookup } from '@/lib/useCnpjLookup';
import { MSG_SENHA_72_BYTES, senhaPassaDe72Bytes } from '@/lib/senha';
import { atuacaoFetch, type CriarEmpresaInput, type CriarEmpresaResultado } from '../api';

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const LABEL = 'mb-1 block text-sm font-medium text-dash-muted';
const SENHA_MIN = 8;
const SENHA_MAX = 72;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A senha temporária fica SÓ em estado deste componente (nunca em URL, storage, console ou atributos).
export function NovaEmpresaForm({ onCriada, onConcluir }: { onCriada: () => void; onConcluir?: () => void }) {
  const [empresa, setEmpresa] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // Trava SÍNCRONA contra duplo envio: o estado `enviando` só vale no próximo render (dois submits no mesmo
  // ciclo passariam os dois); o ref muda na hora. Mesmo padrão do "Abrir como empresa".
  const enviandoRef = useRef(false);
  const [erro, setErro] = useState<string | null>(null);
  const tituloOk = useRef<HTMLHeadingElement>(null);
  const [criada, setCriada] = useState<{ email: string; senha: string } | null>(null);

  // Só preenche a razão social se o campo estiver vazio (não sobrescreve o que a sócia digitou).
  const { state: consulta, lookup } = useCnpjLookup((d) => {
    if (d.razao_social) setEmpresa((atual) => (atual.trim() ? atual : d.razao_social!));
  });

  // Anuncia o resultado ao leitor de tela.
  useEffect(() => { if (criada) tituloOk.current?.focus(); }, [criada]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (enviandoRef.current || enviando) return;
    const dados: CriarEmpresaInput = {
      company_name: empresa.trim(), cnpj: onlyDigits(cnpj), full_name: nome.trim(), email: email.trim(), password: senha,
    };
    if (dados.company_name.length < 2 || dados.company_name.length > 200) return setErro('A razão social deve ter entre 2 e 200 caracteres.');
    if (!isValidCnpj(dados.cnpj)) return setErro('CNPJ inválido. Confira os números digitados.');
    if (dados.full_name.length < 2 || dados.full_name.length > 200) return setErro('O nome do responsável deve ter entre 2 e 200 caracteres.');
    if (!EMAIL_RE.test(dados.email) || dados.email.length > 200) return setErro('Informe um e-mail válido para o RH.');
    if (dados.password.length < SENHA_MIN || dados.password.length > SENHA_MAX) {
      return setErro(`A senha temporária deve ter entre ${SENHA_MIN} e ${SENHA_MAX} caracteres.`);
    }
    if (senhaPassaDe72Bytes(dados.password)) return setErro(MSG_SENHA_72_BYTES);
    enviandoRef.current = true;
    setEnviando(true);
    setErro(null);
    try {
      const r = await atuacaoFetch<CriarEmpresaResultado>('/clientes', { method: 'POST', body: JSON.stringify(dados) });
      setCriada({ email: r?.email ?? dados.email, senha: dados.password });
      setEmpresa(''); setCnpj(''); setNome(''); setEmail(''); setSenha(''); setMostrar(false);
      onCriada();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  function concluir() {
    setCriada(null);
    onConcluir?.();
  }

  if (criada) {
    return (
      <section aria-labelledby="empresa-criada" className="mb-6 rounded-[18px] bg-dash-card p-4 shadow-[0_4px_12px_rgba(15,23,42,0.08)] sm:p-6">
        <h2 id="empresa-criada" ref={tituloOk} tabIndex={-1} className="mb-3 text-lg font-semibold text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary">Cadastro concluído</h2>
        <div role="status" className="mb-4 text-sm text-dash-primary">
          Empresa cadastrada. Repasse o e-mail e a senha temporária ao RH por um canal seguro. A senha não será exibida novamente.
        </div>
        <dl className="mb-4 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase text-dash-muted">E-mail</dt>
            <dd className="mt-0.5 break-all text-sm text-dash-primary">{criada.email}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-dash-muted">Senha temporária</dt>
            <dd className="mt-0.5 break-all font-mono text-sm text-dash-primary">{criada.senha}</dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={concluir}
          className="rounded-md bg-dash-primary px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2"
        >
          Concluir
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby="nova-empresa" className="mb-6 rounded-[18px] bg-dash-card p-4 shadow-[0_4px_12px_rgba(15,23,42,0.08)] sm:p-6">
      <h2 id="nova-empresa" className="mb-1 text-lg font-semibold text-dash-primary">Cadastrar nova empresa</h2>
      <p className="mb-4 text-sm text-dash-muted">Cria a empresa e o acesso do responsável (RH) com uma senha temporária que você define.</p>
      <form onSubmit={enviar} noValidate className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ne-cnpj" className={LABEL}>CNPJ</label>
          <input
            id="ne-cnpj" type="text" inputMode="numeric" autoComplete="off" value={cnpj} className={INPUT}
            onChange={(e) => setCnpj(e.target.value)}
            onBlur={() => { if (isValidCnpj(cnpj)) { setCnpj(formatCnpj(cnpj)); void lookup(cnpj); } }}
          />
          {consulta.status === 'loading' && <p className="mt-1 text-xs text-dash-muted">Consultando CNPJ...</p>}
          {consulta.status === 'erro' && <p className="mt-1 text-xs text-dash-muted">{consulta.message}</p>}
        </div>
        <div>
          <label htmlFor="ne-empresa" className={LABEL}>Razão social</label>
          <input id="ne-empresa" type="text" maxLength={200} value={empresa} onChange={(e) => setEmpresa(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label htmlFor="ne-nome" className={LABEL}>Nome do responsável (RH)</label>
          <input id="ne-nome" type="text" maxLength={200} autoComplete="off" value={nome} onChange={(e) => setNome(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label htmlFor="ne-email" className={LABEL}>E-mail do RH</label>
          <input id="ne-email" type="email" maxLength={200} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="ne-senha" className={LABEL}>Senha temporária</label>
          <input
            id="ne-senha" type={mostrar ? 'text' : 'password'} autoComplete="new-password" value={senha}
            aria-describedby="ne-senha-ajuda" onChange={(e) => setSenha(e.target.value)} className={INPUT}
          />
          <p id="ne-senha-ajuda" className="mt-1 text-xs text-dash-muted">Entre {SENHA_MIN} e {SENHA_MAX} caracteres (acentos contam em dobro). O RH poderá trocá-la depois.</p>
          <label className="mt-2 flex items-center gap-2 text-sm text-dash-muted">
            <input type="checkbox" checked={mostrar} onChange={(e) => setMostrar(e.target.checked)} className="h-4 w-4 focus-visible:ring-2 focus-visible:ring-dash-primary" />
            Mostrar senha
          </label>
        </div>
        {erro && <p role="alert" className="text-sm text-dash-status-crit-text sm:col-span-2">{erro}</p>}
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={enviando}
            className="rounded-md bg-dash-primary px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {enviando ? 'Cadastrando...' : 'Cadastrar empresa'}
          </button>
        </div>
      </form>
    </section>
  );
}
