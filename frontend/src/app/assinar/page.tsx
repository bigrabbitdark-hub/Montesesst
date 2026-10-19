'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, openLink, peek, refuse, sign, type OpenData } from '@/lib/epi-signature-api';
import { SignaturePad, type SignaturePadHandle } from '@/components/epi/SignaturePad';

type View = 'lendo' | 'verificando' | 'codigo' | 'conferencia' | 'assinado' | 'recusado' | 'fim';

const MSG = {
  invalido: 'Este link não é válido ou expirou. Peça um novo link ao responsável.',
  bloqueado: 'Este link foi bloqueado por tentativas incorretas. Peça um novo link ao responsável.',
  indisponivel: 'A assinatura ainda não está disponível. Procure o responsável.',
  tratadas: 'Estas entregas já foram tratadas. Procure o responsável se precisar de ajuda.',
  imagem: 'Não foi possível enviar a assinatura. Limpe e assine de novo.',
  muitas: 'Muitas tentativas. Aguarde alguns minutos.',
  falha: 'Não foi possível concluir agora. Tente novamente.',
  termoNovo: 'O termo foi atualizado. Toque em "Atualizar termo" para ver a versão atual e aceitar de novo.',
};

type Mapped = { text: string; fatal?: boolean; termo?: boolean };

// Só mensagens conhecidas, em português: nunca repassa o texto cru do servidor.
function mapError(e: unknown): Mapped {
  if (!(e instanceof ApiError)) return { text: MSG.falha };
  switch (e.status) {
    case 404:
      return { text: MSG.invalido, fatal: true };
    case 401:
      return { text: e.attemptsLeft === undefined ? 'Código incorreto.' : `Código incorreto. Restam ${e.attemptsLeft} ${e.attemptsLeft === 1 ? 'tentativa' : 'tentativas'}.` };
    case 403:
      return { text: MSG.bloqueado, fatal: true };
    case 409:
      return /tratadas/i.test(e.message) ? { text: MSG.tratadas, fatal: true } : { text: MSG.indisponivel };
    case 413:
      return { text: MSG.imagem };
    case 400:
      return /termo desatualizado/i.test(e.message) ? { text: MSG.termoNovo, termo: true } : { text: MSG.imagem };
    case 429:
      return { text: MSG.muitas };
    default:
      return { text: MSG.falha };
  }
}

function formatDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const tz = 'America/Sao_Paulo';
  return `${d.toLocaleDateString('pt-BR', { timeZone: tz })} às ${d.toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' })} (horário de Brasília)`;
}

const BTN = 'min-h-[48px] rounded-[9px] px-6 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = `${BTN} bg-brand-500 text-white hover:bg-brand-700`;
const SECONDARY = `${BTN} border-[1.5px] border-brand-700 bg-white text-brand-700 hover:bg-brand-50`;

export default function AssinarPage() {
  const [view, setView] = useState<View>('lendo');
  const [token, setToken] = useState('');
  const [company, setCompany] = useState('');
  const [code, setCode] = useState('');
  const [data, setData] = useState<OpenData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [termoVelho, setTermoVelho] = useState(false);
  const [retryPeek, setRetryPeek] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [png, setPng] = useState<string | null>(null);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState('');
  const [receipt, setReceipt] = useState<{ code: string; at: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  // Geração do link: sobe a cada token novo/retry/desmontagem. Toda resposta assíncrona compara a geração que
  // capturou ao sair com a atual e é DESCARTADA se diferir (link colado no meio de uma requisição em voo).
  const genRef = useRef(0);
  const nextGen = useCallback(() => ++genRef.current, []);
  const padRef = useRef<SignaturePadHandle>(null);

  // Estado terminal: o link não serve mais (ou já foi concluído). Apaga código, token e dados pessoais da memória.
  const wipe = useCallback(() => {
    setCode('');
    setToken('');
    setData(null);
    setPng(null);
    setAccepted(false);
    setReason('');
    setRefusing(false);
  }, []);

  const verify = useCallback(async (t: string, g: number) => {
    setView('verificando');
    setMessage(null);
    setRetryPeek(false);
    try {
      const r = await peek(t);
      if (g !== genRef.current) return;
      if (r.usable) {
        setCompany(r.company_name ?? '');
        setView('codigo');
      } else {
        setMessage(MSG.invalido);
        wipe();
        setView('fim');
      }
    } catch (e) {
      if (g !== genRef.current) return;
      const m = mapError(e);
      setMessage(m.text);
      setRetryPeek(!m.fatal); // "Tentar de novo" só onde o token ainda é necessário
      if (m.fatal) wipe();
      setView('fim');
    }
  }, [wipe]);

  // O token vem no fragmento (#token=...), que o navegador não envia ao servidor; é lido e removido da barra de
  // endereço logo de cara e fica só em estado React (nunca em storage). `hashchange`: um segundo link colado na
  // mesma aba é navegação só de fragmento, sem recarregar a página.
  useEffect(() => {
    const read = (): string | null => new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token');
    const start = (t: string) => {
      const g = nextGen();
      wipe();
      padRef.current?.clear();
      setToken(t);
      setReceipt(null);
      setMessage(null);
      setTermoVelho(false);
      setLoading(false);
      void verify(t, g);
    };
    const found = read();
    window.history.replaceState(null, '', window.location.pathname);
    if (found) start(found);
    else {
      nextGen();
      setMessage(MSG.invalido);
      setView('fim');
    }
    const onHashChange = () => {
      const next = read();
      if (!next) return;
      window.history.replaceState(null, '', window.location.pathname);
      start(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      nextGen(); // invalida respostas em voo ao desmontar
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [verify, wipe, nextGen]);

  // Foco no título ao trocar de etapa (leitor de tela anuncia a nova tela; teclado continua de onde faz sentido).
  useEffect(() => {
    headingRef.current?.focus();
  }, [view, refusing]);

  // Foco na mensagem de erro da conferência (sem tocar no desenho).
  useEffect(() => {
    if (message && view === 'conferencia') errorRef.current?.focus();
  }, [message, view]);

  function fail(e: unknown) {
    const m = mapError(e);
    setMessage(m.text);
    setTermoVelho(Boolean(m.termo));
    if (m.fatal) {
      wipe();
      setView('fim');
    }
  }

  async function handleCode(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setMessage('Digite os 6 números do código.');
      return;
    }
    setMessage(null);
    setLoading(true);
    const g = genRef.current;
    try {
      const d = await openLink(token, code);
      if (g !== genRef.current) return;
      setData(d);
      setView('conferencia');
    } catch (e) {
      if (g !== genRef.current) return;
      fail(e);
    } finally {
      if (g === genRef.current) setLoading(false);
    }
  }

  async function handleSign() {
    if (!data || !png || !accepted) return;
    setMessage(null);
    setTermoVelho(false);
    setLoading(true);
    const g = genRef.current;
    try {
      const r = await sign(token, code, data.term.version, png);
      if (g !== genRef.current) return;
      setReceipt({ code: r.receipt_code, at: r.signed_at });
      wipe();
      setView('assinado');
    } catch (e) {
      if (g !== genRef.current) return;
      fail(e); // o desenho continua na tela: o funcionário só toca em "Assinar" de novo
    } finally {
      if (g === genRef.current) setLoading(false);
    }
  }

  async function handleRefuse() {
    setMessage(null);
    setLoading(true);
    const g = genRef.current;
    try {
      await refuse(token, code, reason.trim() || undefined);
      if (g !== genRef.current) return;
      wipe();
      setView('recusado');
    } catch (e) {
      if (g !== genRef.current) return;
      fail(e);
    } finally {
      if (g === genRef.current) setLoading(false);
    }
  }

  async function handleRefreshTerm() {
    setMessage(null);
    setLoading(true);
    const g = genRef.current;
    try {
      const d = await openLink(token, code);
      if (g !== genRef.current) return;
      setData(d);
      setAccepted(false);
      setTermoVelho(false);
      padRef.current?.clear(); // termo novo: o desenho antigo não vale para ele
    } catch (e) {
      if (g !== genRef.current) return;
      fail(e);
    } finally {
      if (g === genRef.current) setLoading(false);
    }
  }

  const h1 = 'text-2xl font-extrabold text-brand-900 outline-none';
  const error = (
    <p ref={errorRef} tabIndex={-1} role="alert" className="min-h-0 text-base font-medium text-red-700 outline-none">
      {message}
    </p>
  );

  return (
    <main className="min-h-screen bg-brand-50 px-4 py-6 text-base text-brand-900">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
        <p className="text-base font-semibold text-brand-700">Montese SST</p>

        {(view === 'lendo' || view === 'verificando') && (
          <p role="status" className="rounded-2xl border border-brand-100 bg-white p-6">
            Verificando o link...
          </p>
        )}

        {view === 'fim' && (
          <section className="flex flex-col gap-4 rounded-2xl border border-brand-100 bg-white p-6">
            <h1 ref={headingRef} tabIndex={-1} className={h1}>
              Link indisponível
            </h1>
            {error}
            {retryPeek && (
              <button type="button" className={PRIMARY} onClick={() => void verify(token, nextGen())}>
                Tentar de novo
              </button>
            )}
          </section>
        )}

        {view === 'codigo' && (
          <section className="flex flex-col gap-4 rounded-2xl border border-brand-100 bg-white p-6">
            <h1 ref={headingRef} tabIndex={-1} className={h1}>
              Assinatura de recebimento de EPI
            </h1>
            {company && <p>Empresa: {company}</p>}
            <form onSubmit={handleCode} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-1">
                <label htmlFor="codigo" className="font-semibold">
                  Código de 6 números
                </label>
                <input
                  id="codigo"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="[0-9]*"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  aria-describedby="codigo-ajuda"
                  className="min-h-[52px] w-full rounded-[9px] border-[1.5px] border-brand-700 px-4 text-center text-2xl tracking-[0.4em]"
                />
                <span id="codigo-ajuda" className="text-base text-brand-700">
                  O responsável da empresa passa este código a você.
                </span>
              </div>
              {error}
              <button type="submit" disabled={loading || code.length !== 6} className={PRIMARY}>
                {loading ? 'Verificando...' : 'Continuar'}
              </button>
            </form>
          </section>
        )}

        {view === 'conferencia' && data && (
          <section className="flex flex-col gap-5">
            <div className="flex flex-col gap-1 rounded-2xl border border-brand-100 bg-white p-6">
              <h1 ref={headingRef} tabIndex={-1} className={h1}>
                {refusing ? 'Recusar recebimento' : 'Confira e assine'}
              </h1>
              <p>
                Funcionário: <strong>{data.employee_name}</strong>
              </p>
            </div>

            <div className="rounded-2xl border border-brand-100 bg-white p-6">
              <h2 className="mb-3 text-lg font-bold">Itens recebidos</h2>
              <ul className="flex flex-col divide-y divide-brand-100">
                {data.items.map((it) => (
                  <li key={it.delivery_id} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
                    <span className="font-semibold">{it.epi_description}</span>
                    <span>{[it.manufacturer, it.model].filter(Boolean).join(' · ') || 'Fabricante não informado'}</span>
                    <span>
                      CA {it.ca_number}
                      {it.quantity != null && ` · Quantidade: ${it.quantity}`}
                    </span>
                    <span>Entregue em {formatDate(it.date)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-brand-100 bg-white p-6">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold">{data.term.title}</h2>
                {data.term.draft && <span className="rounded-full bg-amber-100 px-3 py-1 text-base font-bold text-amber-900">RASCUNHO</span>}
              </div>
              {data.term.draft && <p className="mb-3 font-medium text-amber-900">Este termo ainda não foi aprovado. A assinatura só é aceita quando o termo for aprovado.</p>}
              <div className="flex flex-col gap-2">
                {data.term.paragraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
              <label className="mt-4 flex min-h-[44px] items-start gap-3 font-semibold">
                <input type="checkbox" checked={accepted} disabled={loading} onChange={(e) => setAccepted(e.target.checked)} className="mt-1 h-6 w-6 shrink-0 accent-brand-500" />
                <span>Li e aceito o termo e confirmo o recebimento dos itens acima</span>
              </label>
            </div>

            <div className="rounded-2xl border border-brand-100 bg-white p-6">
              <h2 className="mb-1 text-lg font-bold">Sua assinatura</h2>
              <p className="mb-3 text-brand-700">Assine com o dedo na área abaixo.</p>
              <SignaturePad ref={padRef} onChange={setPng} disabled={loading} />
              <p className="mt-3 text-brand-700">Se não conseguir assinar na tela, procure o responsável: ele pode registrar o recebimento presencialmente.</p>
            </div>

            {termoVelho && (
              <button type="button" className={PRIMARY} disabled={loading} onClick={() => void handleRefreshTerm()}>
                Atualizar termo
              </button>
            )}
            {error}

            {!refusing ? (
              <div className="flex flex-col gap-3 sm:flex-row-reverse">
                <button type="button" className={`${PRIMARY} flex-1`} disabled={loading || !accepted || !png} onClick={() => void handleSign()}>
                  {loading ? 'Enviando...' : 'Assinar'}
                </button>
                <button type="button" className={`${SECONDARY} flex-1`} disabled={loading} onClick={() => { setMessage(null); setRefusing(true); }}>
                  Recusar
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 rounded-2xl border border-brand-100 bg-white p-6">
                <p>Se você não recebeu estes itens ou não concorda, pode recusar. O responsável será avisado.</p>
                <label htmlFor="motivo" className="font-semibold">
                  Motivo (opcional)
                </label>
                <textarea
                  id="motivo"
                  maxLength={300}
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded-[9px] border-[1.5px] border-brand-700 px-4 py-3 text-base"
                />
                <div className="flex flex-col gap-3 sm:flex-row-reverse">
                  <button type="button" className={`${PRIMARY} flex-1`} disabled={loading} onClick={() => void handleRefuse()}>
                    {loading ? 'Enviando...' : 'Confirmar recusa'}
                  </button>
                  <button type="button" className={`${SECONDARY} flex-1`} disabled={loading} onClick={() => { setMessage(null); setRefusing(false); }}>
                    Voltar
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {view === 'assinado' && receipt && (
          <section role="status" className="flex flex-col gap-4 rounded-2xl border border-brand-100 bg-white p-6">
            <h1 ref={headingRef} tabIndex={-1} className={h1}>
              Assinatura registrada
            </h1>
            <p>Seu recebimento dos itens foi registrado. Você já pode fechar esta página.</p>
            <div className="rounded-[9px] bg-brand-50 p-4">
              <p className="text-brand-700">Código do comprovante</p>
              <p className="break-all text-2xl font-extrabold">{receipt.code}</p>
              <p className="mt-2">{formatDateTime(receipt.at)}</p>
            </div>
            <p className="font-semibold">Guarde este código.</p>
          </section>
        )}

        {view === 'recusado' && (
          <section role="status" className="flex flex-col gap-4 rounded-2xl border border-brand-100 bg-white p-6">
            <h1 ref={headingRef} tabIndex={-1} className={h1}>
              Recusa registrada
            </h1>
            <p>Sua recusa foi registrada e o responsável da empresa será avisado. Você já pode fechar esta página.</p>
          </section>
        )}
      </div>
    </main>
  );
}
