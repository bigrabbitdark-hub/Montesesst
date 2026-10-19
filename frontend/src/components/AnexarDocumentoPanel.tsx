'use client';

import { useEffect, useRef, useState } from 'react';
import { sessionExpired } from '@/lib/auth';
import type { UnitOption } from '@/components/NovoFuncionarioForm';
import { PROCESSING_NOTICE, UNEXPECTED_RESPONSE, WAIT_NOTICE, asList, reasonLabel, safeText, statusMessage, type Extraction, type ExtractionItem } from '@/lib/employees-ingestion';

const MAX_BYTES = 10 * 1024 * 1024;
// Extensão E tipo MIME têm de bater (o backend confere o conteúdo de novo).
const ACCEPTED: Array<{ ext: RegExp; mime: string }> = [
  { ext: /\.xlsx$/i, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { ext: /\.pdf$/i, mime: 'application/pdf' },
  { ext: /\.docx$/i, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
];
const FORMATS_ERROR = 'Anexe a planilha modelo (.xlsx), um PDF com texto ou um DOCX.';
const IMAGE_ERROR = 'Imagens ainda não são lidas para o cadastro. Envie a planilha modelo (.xlsx), um PDF com texto ou um DOCX.';
// Leitura + IA no backend pode levar uns 3 min: o limite aqui só evita espera infinita.
const REQUEST_TIMEOUT_MS = 4 * 60 * 1000;
const WAIT_NOTICE_AFTER_MS = 10_000;
// Leitura ainda em andamento no servidor: consulta a cada 5 s por até 3 min.
const POLL_EVERY_S = 5;
const POLL_MAX_S = 180;
const SERVER_MAY_CONTINUE =
  'A leitura pode ter continuado no servidor. Aguarde alguns instantes e atualize a página; se houver revisão pendente ela aparecerá no topo.';
const isValid = (d: unknown): d is Extraction => Array.isArray((d as Extraction)?.items) && typeof (d as Extraction)?.status === 'string';

export function AnexarDocumentoPanel({
  units,
  defaultUnitId = '',
  disabled = false,
  onDone,
}: {
  units: UnitOption[];
  defaultUnitId?: string;
  disabled?: boolean;
  onDone: (e: Extraction) => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [unitId, setUnitId] = useState(defaultUnitId);
  const [sending, setSending] = useState(false);
  const [slow, setSlow] = useState(false);
  // Polling: id da extração em leitura e segundos decorridos (um polling por vez).
  const [pollId, setPollId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [invalidas, setInvalidas] = useState<ExtractionItem[]>([]);
  const sendingRef = useRef(false);
  const openBtnRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [pickedUnit, setPickedUnit] = useState(false);

  const isDoc = !!file && !/\.xlsx$/i.test(file.name);

  function close() {
    setPollId(null);
    setElapsed(0);
    setOpen(false);
    setFile(null);
    setError('');
    setResult('');
    setInvalidas([]);
    setUnitId(defaultUnitId);
    setPickedUnit(false);
    returnFocusRef.current = true;
  }

  // O botão de abrir só existe com o painel fechado: devolve o foco depois que ele volta à árvore.
  // Ao abrir, o foco vai para o título do painel (o botão que o tinha sumiu); ao fechar, volta ao botão.
  useEffect(() => {
    if (open) headingRef.current?.focus();
    else if (returnFocusRef.current) {
      returnFocusRef.current = false;
      openBtnRef.current?.focus();
    }
  }, [open]);

  // Enquanto a pessoa não escolheu a filial, acompanha o padrão (filtro/filiais carregam depois).
  useEffect(() => {
    if (!pickedUnit) setUnitId(defaultUnitId);
  }, [defaultUnitId, pickedUnit]);

  // Frase de espera só depois de 10 s: envios rápidos não ganham texto extra.
  useEffect(() => {
    if (!sending) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), WAIT_NOTICE_AFTER_MS);
    return () => clearTimeout(t);
  }, [sending]);

  // Acompanha uma leitura que seguiu no servidor. O efeito limpa o timer ao fechar, trocar de id ou desmontar.
  useEffect(() => {
    if (!pollId) return;
    let cancelled = false;
    let inFlight = false;
    let seconds = 0;
    const finish = (e: Extraction) => {
      setPollId(null);
      setResult(statusMessage(e));
      setInvalidas(asList<ExtractionItem>(e.items).filter((i) => i.kind === 'invalida'));
      onDoneRef.current(e);
    };
    async function check() {
      if (inFlight) return;
      inFlight = true;
      try {
        const token = localStorage.getItem('montese_token');
        const res = await fetch(`/api/employees/extractions/${encodeURIComponent(pollId as string)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (res.status === 401) {
          setPollId(null);
          sessionExpired();
          return;
        }
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          setPollId(null);
          setError('Não foi possível acompanhar a leitura. Atualize a página para conferir.');
          return;
        }
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.ok && isValid(data) && data.status !== 'processando') finish(data);
      } catch {
        // Falha pontual de rede: tenta de novo no próximo ciclo.
      } finally {
        inFlight = false;
      }
    }
    const t = setInterval(() => {
      seconds += 1;
      if (seconds >= POLL_MAX_S) {
        setPollId(null);
        setResult('A leitura está demorando. Atualize a página em instantes.');
        return;
      }
      setElapsed(seconds);
      if (seconds % POLL_EVERY_S === 0) void check();
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [pollId]);

  async function submit() {
    if (sendingRef.current) return;
    setError('');
    setResult('');
    setInvalidas([]);
    if (file && /\.(jpe?g|png)$/i.test(file.name)) {
      setError(IMAGE_ERROR);
      return;
    }
    const kind = file ? ACCEPTED.find((a) => a.ext.test(file.name)) : undefined;
    if (!file || !kind || (file.type && file.type !== kind.mime)) {
      setError(FORMATS_ERROR);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('O arquivo é maior que 10 MB. Envie um arquivo menor.');
      return;
    }
    const form = new FormData();
    form.append('file', file);
    if (unitId) form.append('company_unit_id', unitId);

    sendingRef.current = true;
    setSending(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const token = localStorage.getItem('montese_token');
      // Sem Content-Type manual: o navegador define o boundary do multipart.
      const res = await fetch('/api/employees/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: controller.signal,
      });
      if (res.status === 401) {
        sessionExpired();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.message === 'string' && data.message ? data.message : `Não foi possível enviar ${isDoc ? 'o documento' : 'a planilha'}. Tente novamente.`);
        return;
      }
      if (!isValid(data)) {
        setError(UNEXPECTED_RESPONSE);
        return;
      }
      setResult(data.status === 'processando' ? PROCESSING_NOTICE : statusMessage(data));
      setInvalidas(asList<ExtractionItem>(data.items).filter((i) => i.kind === 'invalida'));
      if (data.status === 'processando') {
        // Servidor ainda lendo (ex.: reenvio de arquivo em leitura): acompanha até terminar.
        setElapsed(0);
        if (typeof data.id === 'string' && data.id) setPollId(data.id);
        return;
      }
      onDone(data);
    } catch {
      setError(`Não foi possível enviar ${isDoc ? 'o documento' : 'a planilha'}. Verifique a conexão e tente novamente.`);
      // Sem o id da extração não dá para acompanhar: só avisa que o servidor pode ter continuado.
      setResult(SERVER_MAY_CONTINUE);
    } finally {
      clearTimeout(timer);
      sendingRef.current = false;
      setSending(false);
    }
  }

  const busy = sending || pollId !== null;
  const btn =
    'rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dash-primary disabled:cursor-not-allowed disabled:opacity-50';
  const inputCls =
    'w-full rounded-md border border-dash-border-soft bg-dash-card px-2 py-1.5 text-sm text-dash-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-dash-primary';

  if (!open) {
    return (
      <button
        ref={openBtnRef}
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={`${btn} border border-dash-border-soft text-dash-primary`}
      >
        Anexar documento
      </button>
    );
  }

  return (
    <section
      role="region"
      aria-label="Anexar documento"
      hidden={disabled}
      className="flex flex-col gap-4 rounded-lg border border-dash-border-soft p-4"
    >
      <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-dash-primary focus:outline-none">
        Anexar documento
      </h2>
      <p className="text-sm text-dash-muted">
        Envie a planilha modelo (.xlsx), um PDF com texto ou um DOCX (até 10 MB). Funcionários novos e diferenças vão para revisão antes de qualquer mudança.
        A leitura de PDF e DOCX não aplica nada sozinha: tudo vai para revisão.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="anexar-doc-file" className="text-xs font-semibold text-dash-muted">
            Planilha ou documento (.xlsx, .pdf ou .docx)
          </label>
          <input
            id="anexar-doc-file"
            type="file"
            accept=".xlsx,.pdf,.docx"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError('');
              setResult('');
              setInvalidas([]);
            }}
            className={inputCls}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="anexar-doc-unit" className="text-xs font-semibold text-dash-muted">
            Filial
          </label>
          <select id="anexar-doc-unit" value={unitId} disabled={busy} onChange={(e) => {
              setUnitId(e.target.value);
              setPickedUnit(true);
            }} className={inputCls}>
            <option value="">Sem filial definida</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {/* Regiões vivas sempre montadas: o texto entra depois, para os leitores de tela anunciarem. */}
      <div role="status" className={sending || pollId ? 'text-sm font-semibold text-dash-muted' : result ? 'text-sm font-semibold text-dash-status-ok-text' : undefined}>
        {sending
          ? `Enviando e analisando...${slow ? ` ${WAIT_NOTICE}` : ''}`
          : pollId
            ? `Lendo o documento... ${elapsed} s. ${result}`
            : result}
      </div>
      {invalidas.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-dash-primary">Linhas com problema</h3>
          <ul className="flex flex-col gap-1">
            {invalidas.map((i) => (
              <li key={i.line} className="text-sm text-dash-primary">
                Linha {i.line}: {safeText(reasonLabel(i.reason))}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div
        role="alert"
        className={error ? 'rounded-md bg-dash-status-crit-bg px-3 py-2 text-sm text-dash-status-crit-text' : undefined}
      >
        {error}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={submit} disabled={busy} className={`${btn} bg-dash-primary text-white`}>
          Enviar e analisar
        </button>
        <button type="button" onClick={close} disabled={sending} className={`${btn} border border-dash-border-soft text-dash-primary`}>
          Fechar
        </button>
      </div>
    </section>
  );
}
