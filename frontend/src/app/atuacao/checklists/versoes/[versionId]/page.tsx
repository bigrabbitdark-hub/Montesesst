'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { AsyncBody } from '@/components/ui/AsyncBody';
import { Badge } from '@/components/ui/Badge';
import {
  atuacaoFetch, CHECKLIST_STATUS_LABEL, CHECKLIST_TIPO_LABEL, checklistServicoLabel, checklistStatusTone, formatDataHora,
  type ChecklistItemModelo, type ChecklistTipo, type ChecklistVersao,
} from '../../../api';

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const BTN =
  'rounded-md bg-dash-primary px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 disabled:opacity-60';
const BTN_SEC =
  'rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm font-semibold text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary disabled:opacity-60';
const LABEL = 'mb-1 block text-sm font-medium text-dash-muted';
const MAX_ITENS = 100;

const novoItem = (): ChecklistItemModelo => ({ label: '', instruction: null, kind: 'sim_nao_na', required: true, blocks_review: false });

export default function ChecklistVersaoPage() {
  const { versionId } = useParams<{ versionId: string }>();
  const router = useRouter();
  const [versao, setVersao] = useState<ChecklistVersao | null>(null);
  const [itens, setItens] = useState<ChecklistItemModelo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  const [confirmaAprovar, setConfirmaAprovar] = useState(false);
  const emVoo = useRef(false);

  const aplicar = (v: ChecklistVersao) => { setVersao(v); setItens(v.itens.map((i) => ({ ...i }))); };
  const carregar = useCallback(() => {
    setLoading(true);
    setError(null);
    return atuacaoFetch<ChecklistVersao>(`/checklists/versoes/${versionId}`)
      .then(aplicar)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [versionId]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function acao<T>(fn: () => Promise<T>, ok: string, depois?: (r: T) => void) {
    if (emVoo.current) return;
    emVoo.current = true;
    setOcupado(true);
    setErroAcao(null);
    setAviso('');
    try {
      const r = await fn();
      setAviso(ok);
      depois?.(r);
    } catch (e) {
      setErroAcao((e as Error).message);
    } finally {
      emVoo.current = false;
      setOcupado(false);
    }
  }

  const salvar = () => {
    if (itens.some((i) => !i.label.trim())) { setErroAcao('Todos os itens precisam de um texto.'); return Promise.resolve(); }
    return acao(
      () => atuacaoFetch<ChecklistVersao>(`/checklists/versoes/${versionId}/itens`, {
        method: 'PUT',
        body: JSON.stringify({ items: itens.map((i) => ({ label: i.label.trim(), instruction: i.instruction?.trim() || undefined, kind: i.kind, required: i.required, blocks_review: i.required && i.blocks_review })) }),
      }),
      'Itens salvos.', aplicar,
    );
  };
  const aprovar = () => acao(
    async () => {
      // Salva antes de aprovar: o que está na tela é o que será aprovado.
      await atuacaoFetch(`/checklists/versoes/${versionId}/itens`, {
        method: 'PUT',
        body: JSON.stringify({ items: itens.map((i) => ({ label: i.label.trim(), instruction: i.instruction?.trim() || undefined, kind: i.kind, required: i.required, blocks_review: i.required && i.blocks_review })) }),
      });
      return atuacaoFetch<ChecklistVersao>(`/checklists/versoes/${versionId}/aprovar`, { method: 'POST' });
    },
    'Modelo aprovado. A partir de agora ele pode ser usado em documentos.', (v) => { setConfirmaAprovar(false); aplicar(v); },
  );
  const novaVersao = (v: ChecklistVersao) => acao(
    () => atuacaoFetch<ChecklistVersao>(`/checklists/modelos/${v.template_id}/versoes`, { method: 'POST', body: JSON.stringify({}) }),
    'Nova versão criada em rascunho, com os itens da anterior.', (n) => router.push(`/atuacao/checklists/versoes/${n.id}`),
  );
  const excluir = () => acao(
    () => atuacaoFetch(`/checklists/versoes/${versionId}`, { method: 'DELETE' }),
    'Rascunho excluído.', () => router.push('/atuacao/checklists'),
  );

  const mut = (idx: number, parte: Partial<ChecklistItemModelo>) => setItens((l) => l.map((i, k) => (k === idx ? { ...i, ...parte } : i)));
  const mover = (idx: number, d: -1 | 1) => setItens((l) => {
    const j = idx + d;
    if (j < 0 || j >= l.length) return l;
    const c = [...l];
    [c[idx], c[j]] = [c[j], c[idx]];
    return c;
  });

  return (
    <div className="px-4 py-8 sm:px-6">
      <Link href="/atuacao/checklists" className="mb-4 inline-block rounded text-sm font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2">
        Voltar para os modelos
      </Link>
      <div role="status" className="mb-3 text-sm font-medium text-dash-status-ok-text empty:hidden">{aviso}</div>
      <AsyncBody
        data={versao}
        error={error}
        loading={loading}
        onRetry={() => void carregar()}
        skeletonClassName="h-64 w-full"
        render={(v) => {
          const editavel = v.status === 'rascunho';
          return (
            <>
              <PageHeader titulo={v.name} descricao={`${checklistServicoLabel(v.service)} · versão ${v.version_number}`} />
              <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-dash-primary">
                <Badge tone={checklistStatusTone(v.status)}>{CHECKLIST_STATUS_LABEL[v.status]}</Badge>
                {v.approved_at && <span className="text-dash-muted">Aprovado por {v.approved_by_name ?? '—'} em {formatDataHora(v.approved_at)}</span>}
                {v.change_note && <span className="text-dash-muted">Nota: {v.change_note}</span>}
              </div>
              {!editavel && (
                <p role="note" className="mb-4 rounded-md border border-dash-border-input p-3 text-sm text-dash-muted">
                  {v.status === 'aprovado' ? 'Versão aprovada não pode ser alterada. Para mudar itens, crie uma nova versão e aprove-a.' : 'Versão substituída por uma mais recente; mantida para consulta e rastreabilidade.'}
                </p>
              )}
              <ol aria-label="Itens do checklist" className="flex flex-col gap-3">
                {itens.map((it, idx) => (
                  <li key={it.id ?? `novo-${idx}`} className="rounded-[18px] bg-dash-card p-4 shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
                    {editavel ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                          <label htmlFor={`it-${idx}-l`} className={LABEL}>Item {idx + 1}</label>
                          <input id={`it-${idx}-l`} type="text" maxLength={300} value={it.label} onChange={(e) => mut(idx, { label: e.target.value })} className={INPUT} />
                        </div>
                        <div className="sm:col-span-2">
                          <label htmlFor={`it-${idx}-i`} className={LABEL}>Instrução (opcional)</label>
                          <textarea id={`it-${idx}-i`} rows={2} maxLength={1000} value={it.instruction ?? ''} onChange={(e) => mut(idx, { instruction: e.target.value })} className={INPUT} />
                        </div>
                        <div>
                          <label htmlFor={`it-${idx}-k`} className={LABEL}>Tipo de resposta</label>
                          <select id={`it-${idx}-k`} value={it.kind} onChange={(e) => mut(idx, { kind: e.target.value as ChecklistTipo })} className={INPUT}>
                            {(Object.keys(CHECKLIST_TIPO_LABEL) as ChecklistTipo[]).map((k) => <option key={k} value={k}>{CHECKLIST_TIPO_LABEL[k]}</option>)}
                          </select>
                        </div>
                        <fieldset className="text-sm text-dash-primary">
                          <legend className={LABEL}>Regras</legend>
                          <label className="mr-4 inline-flex items-center gap-2">
                            <input type="checkbox" checked={it.required} onChange={(e) => mut(idx, { required: e.target.checked, blocks_review: e.target.checked ? it.blocks_review : false })} /> Obrigatório
                          </label>
                          <label className="inline-flex items-center gap-2">
                            <input type="checkbox" checked={it.blocks_review} disabled={!it.required} onChange={(e) => mut(idx, { blocks_review: e.target.checked })} /> Bloqueia o envio para revisão
                          </label>
                        </fieldset>
                        <div className="flex flex-wrap gap-2 sm:col-span-2">
                          <button type="button" className={BTN_SEC} disabled={idx === 0} onClick={() => mover(idx, -1)} aria-label={`Subir item ${idx + 1}`}>Subir</button>
                          <button type="button" className={BTN_SEC} disabled={idx === itens.length - 1} onClick={() => mover(idx, 1)} aria-label={`Descer item ${idx + 1}`}>Descer</button>
                          <button type="button" className={BTN_SEC} onClick={() => setItens((l) => l.filter((_, k) => k !== idx))} aria-label={`Remover item ${idx + 1}`}>Remover</button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-dash-primary">
                        <p className="font-medium">{idx + 1}. {it.label}</p>
                        {it.instruction && <p className="mt-1 whitespace-pre-wrap text-dash-muted">{it.instruction}</p>}
                        <p className="mt-1 text-xs text-dash-muted">
                          {CHECKLIST_TIPO_LABEL[it.kind]} · {it.required ? 'obrigatório' : 'opcional'}{it.blocks_review ? ' · bloqueia o envio para revisão' : ''}
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              {itens.length === 0 && <p className="mt-3 text-sm text-dash-muted">{editavel ? 'Nenhum item ainda. Adicione os itens que a engenharia definiu para este serviço.' : 'Esta versão não tem itens.'}</p>}
              {erroAcao && <p role="alert" className="mt-4 text-sm text-dash-status-crit-text">{erroAcao}</p>}
              <div className="mt-6 flex flex-wrap gap-2">
                {editavel && (
                  <>
                    <button type="button" className={BTN_SEC} disabled={ocupado || itens.length >= MAX_ITENS} onClick={() => setItens((l) => [...l, novoItem()])}>Adicionar item</button>
                    <button type="button" className={BTN} disabled={ocupado} onClick={() => void salvar()}>Salvar itens</button>
                    {!confirmaAprovar && <button type="button" className={BTN_SEC} disabled={ocupado || itens.length === 0} onClick={() => setConfirmaAprovar(true)}>Aprovar modelo</button>}
                    <button type="button" className={BTN_SEC} disabled={ocupado} onClick={() => void excluir()}>Excluir rascunho</button>
                  </>
                )}
                {v.status === 'aprovado' && <button type="button" className={BTN} disabled={ocupado} onClick={() => void novaVersao(v)}>Criar nova versão</button>}
              </div>
              {editavel && confirmaAprovar && (
                <div role="alertdialog" aria-label="Confirmar aprovação" className="mt-4 rounded-md border border-dash-status-warn-text bg-dash-status-warn-bg p-4 text-sm text-dash-status-warn-text">
                  <p className="mb-3 font-medium">Ao aprovar, os itens não poderão mais ser alterados e a versão anterior aprovada deste modelo será substituída. Confirmar a aprovação técnica?</p>
                  <div className="flex gap-2">
                    <button type="button" className={BTN} disabled={ocupado} onClick={() => void aprovar()}>Confirmar aprovação</button>
                    <button type="button" className={BTN_SEC} disabled={ocupado} onClick={() => setConfirmaAprovar(false)}>Cancelar</button>
                  </div>
                </div>
              )}
            </>
          );
        }}
      />
    </div>
  );
}
