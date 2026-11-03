'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import {
  atuacaoFetch, AVISO_LGPD_NOTA, CORRECAO_ORIGEM_LABEL, CORRECAO_STATUS_LABEL, correcaoStatusTone, formatDataHora,
  type DocCorrecao, type Responsavel,
} from '../../api';
import { Dialogo } from './Dialogo';

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const BTN =
  'rounded-md bg-dash-primary px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 disabled:opacity-60';
const BTN_SEC =
  'rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm font-semibold text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary disabled:opacity-60';
const LABEL = 'mb-1 block text-sm font-medium text-dash-muted';

function dataBr(iso: string | null): string {
  if (!iso) return 'sem prazo';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

type Acao = 'corrigir' | 'verificar' | 'reabrir' | 'cancelar';
const ROTULO: Record<Acao, string> = { corrigir: 'Marcar como corrigida', verificar: 'Verificar e encerrar', reabrir: 'Reabrir', cancelar: 'Cancelar correção' };
const NOTA_OBRIGATORIA: readonly Acao[] = ['reabrir', 'cancelar'];

type Dlg = { tipo: 'nova' } | { tipo: 'acao'; acao: Acao; correcao: DocCorrecao };

// Seção "Correções" do detalhe do documento. Quem decide se o usuário pode agir é o servidor (permissão por ação);
// as mensagens dele são exibidas como vieram. Os botões seguem apenas o estado da correção.
export function Correcoes({ docId, lista, pendentes, encerrado, onMudou }: {
  docId: string; lista: DocCorrecao[]; pendentes: number; encerrado: boolean; onMudou: () => Promise<void> | void;
}) {
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [equipe, setEquipe] = useState<Responsavel[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const emVoo = useRef(false);

  useEffect(() => {
    atuacaoFetch<Responsavel[]>('/equipe').then((r) => setEquipe(Array.isArray(r) ? r : [])).catch(() => setEquipe([]));
  }, []);

  async function enviar(req: () => Promise<unknown>) {
    if (emVoo.current) return;
    emVoo.current = true;
    setEnviando(true);
    setErro(null);
    try {
      await req();
      setDlg(null);
      await onMudou();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      emVoo.current = false;
      setEnviando(false);
    }
  }

  return (
    <section aria-labelledby="sec-correcoes" className="rounded-[18px] bg-dash-card p-6 shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 id="sec-correcoes" className="text-base font-semibold text-dash-primary">Correções</h3>
        {!encerrado && (
          <button type="button" className={BTN_SEC} onClick={() => { setErro(null); setDlg({ tipo: 'nova' }); }}>Registrar correção</button>
        )}
      </div>
      {pendentes > 0 && (
        <p role="note" className="mb-4 rounded-md border border-dash-status-warn-text bg-dash-status-warn-bg p-3 text-sm font-medium text-dash-status-warn-text">
          {pendentes === 1 ? '1 correção pendente' : `${pendentes} correções pendentes`}: aprovar, assinar e publicar ficam bloqueados até que todas sejam corrigidas e verificadas.
        </p>
      )}
      {lista.length === 0 ? (
        <p className="text-sm text-dash-muted">Nenhuma correção registrada.</p>
      ) : (
        <ul aria-label="Correções do documento" className="flex flex-col gap-3">
          {lista.map((c) => {
            const aberta = c.status === 'aberta';
            const corrigida = c.status === 'corrigida';
            return (
              <li key={c.id} className="rounded-md border border-dash-border-input p-3 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge tone={correcaoStatusTone(c.status)}>{CORRECAO_STATUS_LABEL[c.status]}</Badge>
                  <span className="text-xs text-dash-muted">
                    {CORRECAO_ORIGEM_LABEL[c.origin]}{c.requester_label ? ` (${c.requester_label})` : ''}
                    {c.version_number ? ` · versão ${c.version_number}` : ''}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-dash-primary">{c.description}</p>
                <p className="mt-1 text-xs text-dash-muted">
                  Responsável: {c.responsible_name ?? '—'} · prazo: {dataBr(c.due_date)} · pedida por {c.requested_by_name ?? '—'} em {formatDataHora(c.created_at)}
                </p>
                {c.resolution_note && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-dash-muted">Nota: {c.resolution_note}</p>}
                {(aberta || corrigida) && !encerrado && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {aberta && <button type="button" className={BTN_SEC} onClick={() => { setErro(null); setDlg({ tipo: 'acao', acao: 'corrigir', correcao: c }); }}>{ROTULO.corrigir}</button>}
                    {corrigida && <button type="button" className={BTN_SEC} onClick={() => { setErro(null); setDlg({ tipo: 'acao', acao: 'verificar', correcao: c }); }}>{ROTULO.verificar}</button>}
                    {corrigida && <button type="button" className={BTN_SEC} onClick={() => { setErro(null); setDlg({ tipo: 'acao', acao: 'reabrir', correcao: c }); }}>{ROTULO.reabrir}</button>}
                    <button type="button" className={BTN_SEC} onClick={() => { setErro(null); setDlg({ tipo: 'acao', acao: 'cancelar', correcao: c }); }}>{ROTULO.cancelar}</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!dlg && erro && <p role="alert" className="mt-3 text-sm text-dash-status-crit-text">{erro}</p>}

      {dlg?.tipo === 'nova' && (
        <NovaCorrecao equipe={equipe} enviando={enviando} erro={erro} onFechar={() => { setDlg(null); setErro(null); }}
          onEnviar={(corpo) => void enviar(() => atuacaoFetch(`/documentos/${docId}/correcoes`, { method: 'POST', body: JSON.stringify(corpo) }))} />
      )}
      {dlg?.tipo === 'acao' && (
        <AcaoCorrecao acao={dlg.acao} enviando={enviando} erro={erro} onFechar={() => { setDlg(null); setErro(null); }}
          onEnviar={(nota) => void enviar(() => atuacaoFetch(`/documentos/${docId}/correcoes/${dlg.correcao.id}`, {
            method: 'PATCH', body: JSON.stringify({ acao: dlg.acao, ...(nota ? { nota } : {}) }),
          }))} />
      )}
    </section>
  );
}

function AcaoCorrecao({ acao, enviando, erro, onEnviar, onFechar }: {
  acao: Acao; enviando: boolean; erro: string | null; onEnviar: (nota: string) => void; onFechar: () => void;
}) {
  const [nota, setNota] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const obrig = NOTA_OBRIGATORIA.includes(acao);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    if (obrig && !nota.trim()) { setLocal('Informe a nota (motivo).'); return; }
    onEnviar(nota.trim());
  }
  const msg = local ?? erro;
  return (
    <Dialogo titulo={ROTULO[acao]} onFechar={onFechar} ocupado={enviando}>
      <form onSubmit={submit} noValidate>
        <div className="mb-3">
          <label htmlFor="corr-nota" className={LABEL}>Nota{obrig ? ' (obrigatória)' : ' (opcional)'}</label>
          <textarea id="corr-nota" rows={3} maxLength={1000} value={nota} onChange={(e) => setNota(e.target.value)} aria-describedby="corr-lgpd" className={INPUT} />
          <p id="corr-lgpd" className="mt-1 text-xs text-dash-muted">{AVISO_LGPD_NOTA}</p>
        </div>
        {msg && <p role="alert" className="mb-3 text-sm text-dash-status-crit-text">{msg}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onFechar} disabled={enviando} className={BTN_SEC}>Fechar</button>
          <button type="submit" disabled={enviando} className={BTN}>{enviando ? 'Enviando…' : 'Confirmar'}</button>
        </div>
      </form>
    </Dialogo>
  );
}

function NovaCorrecao({ equipe, enviando, erro, onEnviar, onFechar }: {
  equipe: Responsavel[]; enviando: boolean; erro: string | null;
  onEnviar: (c: { description: string; origin: 'cliente' | 'interna'; requester_label?: string; responsavel_id?: string; prazo?: string }) => void;
  onFechar: () => void;
}) {
  const [descricao, setDescricao] = useState('');
  const [origem, setOrigem] = useState<'cliente' | 'interna'>('interna');
  const [solicitante, setSolicitante] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [prazo, setPrazo] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    if (!descricao.trim()) { setLocal('Descreva o que precisa ser corrigido.'); return; }
    if (origem === 'cliente' && !solicitante.trim()) { setLocal('Informe quem do cliente solicitou.'); return; }
    onEnviar({
      description: descricao.trim(), origin: origem,
      ...(origem === 'cliente' ? { requester_label: solicitante.trim() } : {}),
      ...(responsavel ? { responsavel_id: responsavel } : {}), ...(prazo ? { prazo } : {}),
    });
  }
  const msg = local ?? erro;
  return (
    <Dialogo titulo="Registrar correção" onFechar={onFechar} ocupado={enviando}>
      <form onSubmit={submit} noValidate>
        <div className="mb-3">
          <label htmlFor="nc-desc" className={LABEL}>O que precisa ser corrigido (obrigatório)</label>
          <textarea id="nc-desc" rows={3} maxLength={1000} value={descricao} onChange={(e) => setDescricao(e.target.value)} aria-describedby="nc-lgpd" className={INPUT} />
          <p id="nc-lgpd" className="mt-1 text-xs text-dash-muted">{AVISO_LGPD_NOTA}</p>
        </div>
        <div className="mb-3">
          <label htmlFor="nc-origem" className={LABEL}>Quem identificou</label>
          <select id="nc-origem" value={origem} onChange={(e) => setOrigem(e.target.value as 'cliente' | 'interna')} className={INPUT}>
            <option value="interna">Identificada internamente</option>
            <option value="cliente">Pedido do cliente</option>
          </select>
        </div>
        {origem === 'cliente' && (
          <div className="mb-3">
            <label htmlFor="nc-solic" className={LABEL}>Quem do cliente solicitou</label>
            <input id="nc-solic" type="text" maxLength={120} value={solicitante} onChange={(e) => setSolicitante(e.target.value)} className={INPUT} />
          </div>
        )}
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="nc-resp" className={LABEL}>Responsável (opcional)</label>
            <select id="nc-resp" value={responsavel} onChange={(e) => setResponsavel(e.target.value)} className={INPUT}>
              <option value="">Eu</option>
              {equipe.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="nc-prazo" className={LABEL}>Prazo (opcional)</label>
            <input id="nc-prazo" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} className={INPUT} />
          </div>
        </div>
        {msg && <p role="alert" className="mb-3 text-sm text-dash-status-crit-text">{msg}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onFechar} disabled={enviando} className={BTN_SEC}>Fechar</button>
          <button type="submit" disabled={enviando} className={BTN}>{enviando ? 'Enviando…' : 'Registrar'}</button>
        </div>
      </form>
    </Dialogo>
  );
}
