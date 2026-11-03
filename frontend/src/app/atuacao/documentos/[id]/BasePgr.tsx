'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import {
  atuacaoFetch, CATEGORIAS_COM_BASE, docCategoriaLabel, docStatusLabel, docStatusTone,
  type DocAvisoBase, type DocBase, type DocDerivado, type DocumentoResumo,
} from '../../api';

const SELECT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const BTN =
  'rounded-md bg-dash-primary px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 disabled:opacity-60';
const LINK = 'rounded font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';

// Seção "PGR-base" do detalhe: LTCAT/LIP/laudo escolhem o PGR da mesma empresa (opcional, só em elaboração); o PGR lista
// os documentos que partem dele. Os avisos são informativos e vêm do servidor; quem valida o vínculo é o banco.
export function BasePgr({ docId, tenantId, category, status, base, avisos, derivados, onMudou }: {
  docId: string; tenantId: string; category: string; status: string;
  base: DocBase | null; avisos: DocAvisoBase[]; derivados: DocDerivado[]; onMudou: () => Promise<void> | void;
}) {
  const temBase = (CATEGORIAS_COM_BASE as readonly string[]).includes(category);
  const editavel = temBase && status === 'em_elaboracao';
  const [pgrs, setPgrs] = useState<DocumentoResumo[]>([]);
  const [escolhido, setEscolhido] = useState(base?.id ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const emVoo = useRef(false);

  useEffect(() => { setEscolhido(base?.id ?? ''); }, [base?.id]);
  useEffect(() => {
    if (!editavel) return;
    atuacaoFetch<DocumentoResumo[]>(`/documentos?tenantId=${tenantId}&category=pgr`)
      .then((r) => setPgrs(Array.isArray(r) ? r.filter((x) => x.status !== 'cancelado') : []))
      .catch(() => setPgrs([]));
  }, [editavel, tenantId]);

  async function salvar(novo: string | null) {
    if (emVoo.current) return;
    emVoo.current = true;
    setEnviando(true);
    setErro(null);
    try {
      await atuacaoFetch(`/documentos/${docId}/base`, { method: 'PATCH', body: JSON.stringify({ base_draft_id: novo }) });
      await onMudou();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      emVoo.current = false;
      setEnviando(false);
    }
  }

  if (!temBase && derivados.length === 0) return null;

  return (
    <section aria-labelledby="sec-base" className="rounded-[18px] bg-dash-card p-4 shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
      <h2 id="sec-base" className="mb-3 text-base font-semibold text-dash-primary">{temBase ? 'PGR-base' : 'Documentos que partem deste PGR'}</h2>

      {temBase && (
        <>
          {base ? (
            <p className="text-sm text-dash-primary">
              <Link href={`/atuacao/documentos/${base.id}`} className={LINK}>{base.title}</Link>{' '}
              <Badge tone={docStatusTone(base.status)}>{docStatusLabel(base.status)}</Badge>
              {base.versao !== null && <span className="ml-2 text-xs text-dash-muted">versão {base.versao}</span>}
            </p>
          ) : (
            <p className="text-sm text-dash-muted">Nenhum PGR vinculado. O vínculo é opcional.</p>
          )}
          {avisos.length > 0 && (
            <ul aria-label="Avisos do PGR-base" className="mt-3 flex flex-col gap-2">
              {avisos.map((a) => (
                <li key={a.codigo} className="flex items-start gap-2 text-sm text-dash-primary">
                  <Badge tone={a.codigo === 'base_cancelada' ? 'crit' : 'warn'}>Aviso</Badge>
                  <span>{a.mensagem}</span>
                </li>
              ))}
            </ul>
          )}
          {editavel && (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="min-w-[14rem] flex-1">
                <label htmlFor="base-pgr" className="mb-1 block text-sm font-medium text-dash-muted">PGR da mesma empresa</label>
                <select id="base-pgr" className={SELECT} value={escolhido} onChange={(e) => setEscolhido(e.target.value)} disabled={enviando}>
                  <option value="">— sem vínculo —</option>
                  {pgrs.map((p) => (
                    <option key={p.id} value={p.id}>{p.title} · {docStatusLabel(p.status)}{p.versao_atual ? ` · v${p.versao_atual}` : ''}</option>
                  ))}
                </select>
              </div>
              <button type="button" className={BTN} disabled={enviando || escolhido === (base?.id ?? '')} onClick={() => void salvar(escolhido || null)}>
                {escolhido ? 'Salvar vínculo' : 'Remover vínculo'}
              </button>
            </div>
          )}
          {!editavel && <p className="mt-3 text-xs text-dash-muted">O PGR-base só pode ser alterado com o documento em elaboração.</p>}
          {erro && <p role="alert" className="mt-3 text-sm text-dash-status-crit-text">{erro}</p>}
        </>
      )}

      {derivados.length > 0 && (
        <ul aria-label="Documentos derivados" className="flex flex-col gap-2">
          {derivados.map((x) => (
            <li key={x.id} className="text-sm text-dash-primary">
              <span className="text-dash-muted">{docCategoriaLabel(x.category)} · </span>
              <Link href={`/atuacao/documentos/${x.id}`} className={LINK}>{x.title}</Link>{' '}
              <Badge tone={docStatusTone(x.status)}>{docStatusLabel(x.status)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
