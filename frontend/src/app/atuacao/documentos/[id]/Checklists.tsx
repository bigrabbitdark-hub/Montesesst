'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import {
  atuacaoFetch, AVISO_LGPD_NOTA, CHECKLIST_TIPO_LABEL, checklistServicoLabel, formatDataHora,
  type ChecklistDoDocumento, type ChecklistItemResposta, type ChecklistModeloResumo,
} from '../../api';

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const BTN =
  'rounded-md bg-dash-primary px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 disabled:opacity-60';
const BTN_SEC =
  'rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm font-semibold text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary disabled:opacity-60';
const LABEL = 'mb-1 block text-sm font-medium text-dash-muted';

// Seção "Checklists" do detalhe do documento: aplicar um modelo aprovado e registrar as respostas.
// O servidor decide permissões e estado; as mensagens dele são exibidas como vieram.
export function Checklists({ docId, encerrado, onMudou }: { docId: string; encerrado: boolean; onMudou?: () => void }) {
  const [lista, setLista] = useState<ChecklistDoDocumento[] | null>(null);
  const [modelos, setModelos] = useState<ChecklistModeloResumo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [indisponivel, setIndisponivel] = useState<string | null>(null);
  const [escolhido, setEscolhido] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const emVoo = useRef(false);

  const carregar = useCallback(() => {
    atuacaoFetch<ChecklistDoDocumento[]>(`/documentos/${docId}/checklists`)
      .then((l) => { setLista(Array.isArray(l) ? l : []); setIndisponivel(null); })
      .catch((e: Error) => setIndisponivel(e.message));
    atuacaoFetch<ChecklistModeloResumo[]>('/checklists/modelos').then((m) => setModelos(Array.isArray(m) ? m : [])).catch(() => setModelos([]));
  }, [docId]);
  useEffect(() => { carregar(); }, [carregar]);

  async function executar(req: () => Promise<ChecklistDoDocumento[]>) {
    if (emVoo.current) return;
    emVoo.current = true;
    setOcupado(true);
    setErro(null);
    try {
      setLista(await req());
      onMudou?.();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      emVoo.current = false;
      setOcupado(false);
    }
  }

  const aprovados = modelos.filter((m) => m.versao_aprovada_id);
  const aplicar = () => escolhido && void executar(() => atuacaoFetch<ChecklistDoDocumento[]>(`/documentos/${docId}/checklists`, {
    method: 'POST', body: JSON.stringify({ template_version_id: escolhido }),
  })).then(() => setEscolhido(''));

  return (
    <section aria-labelledby="sec-checklists" className="rounded-[18px] bg-dash-card p-6 shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
      <h3 id="sec-checklists" className="mb-4 text-base font-semibold text-dash-primary">Checklists</h3>
      {indisponivel && lista === null ? (
        <p className="text-sm text-dash-muted">{indisponivel}</p>
      ) : (
        <>
          {!encerrado && (
            <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <label htmlFor="ck-modelo" className={LABEL}>Aplicar modelo aprovado</label>
                <select id="ck-modelo" value={escolhido} onChange={(e) => setEscolhido(e.target.value)} className={INPUT}>
                  <option value="">{aprovados.length ? 'Selecione…' : 'Nenhum modelo aprovado ainda'}</option>
                  {aprovados.map((m) => <option key={m.id} value={m.versao_aprovada_id as string}>{`${checklistServicoLabel(m.service)} — ${m.name} (v${m.versao_aprovada})`}</option>)}
                </select>
              </div>
              <button type="button" className={BTN} disabled={ocupado || !escolhido} onClick={aplicar}>Aplicar</button>
            </div>
          )}
          {erro && <p role="alert" className="mb-3 text-sm text-dash-status-crit-text">{erro}</p>}
          {lista === null ? <p className="text-sm text-dash-muted">Carregando…</p> : lista.length === 0 ? (
            <p className="text-sm text-dash-muted">
              Nenhum checklist aplicado a este documento. Os modelos são gerenciados em <Link href="/atuacao/checklists" className="font-semibold underline">Checklists</Link>.
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              {lista.map((c) => (
                <div key={c.id}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold text-dash-primary">{c.name}</h4>
                    <span className="text-xs text-dash-muted">{checklistServicoLabel(c.service)} · v{c.version_number}</span>
                    {c.completude.obrigatorios_pendentes > 0
                      ? <Badge tone="warn">{`${c.completude.obrigatorios_pendentes} obrigatório(s) pendente(s)`}</Badge>
                      : <Badge tone="ok">Obrigatórios respondidos</Badge>}
                    {c.completude.bloqueiam_revisao > 0 && <Badge tone="crit">{`${c.completude.bloqueiam_revisao} bloqueia(m) o envio para revisão`}</Badge>}
                  </div>
                  <ul aria-label={`Itens de ${c.name}`} className="flex flex-col gap-3">
                    {c.itens.map((it) => (
                      <Item key={it.id} docId={docId} checklistId={c.id} item={it} encerrado={encerrado} ocupado={ocupado}
                        onSalvar={(valor, nota) => executar(() => atuacaoFetch<ChecklistDoDocumento[]>(
                          `/documentos/${docId}/checklists/${c.id}/itens/${it.id}`,
                          { method: 'PUT', body: JSON.stringify({ value: valor, ...(nota ? { note: nota } : {}) }) },
                        ))} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Item({ checklistId, item, encerrado, ocupado, onSalvar }: {
  docId: string; checklistId: string; item: ChecklistItemResposta; encerrado: boolean; ocupado: boolean;
  onSalvar: (valor: string, nota: string) => Promise<void>;
}) {
  const [valor, setValor] = useState(item.resposta ?? '');
  const [nota, setNota] = useState(item.resposta_nota ?? '');
  useEffect(() => { setValor(item.resposta ?? ''); setNota(item.resposta_nota ?? ''); }, [item.resposta, item.resposta_nota]);
  const idv = `ck-${checklistId}-${item.id}`;
  const mudou = valor !== (item.resposta ?? '') || nota !== (item.resposta_nota ?? '');
  return (
    <li className="rounded-md border border-dash-border-input p-3 text-sm">
      <p className="font-medium text-dash-primary">
        {item.position}. {item.label}{item.required ? ' *' : ''}
        {item.blocks_review && <span className="ml-2 text-xs font-normal text-dash-muted">(bloqueia o envio para revisão)</span>}
      </p>
      {item.instruction && <p className="mt-1 whitespace-pre-wrap text-xs text-dash-muted">{item.instruction}</p>}
      <div className="mt-2 grid gap-2 sm:grid-cols-[200px_1fr_auto] sm:items-end">
        <div>
          <label htmlFor={`${idv}-v`} className={LABEL}>Resposta ({CHECKLIST_TIPO_LABEL[item.kind]})</label>
          {item.kind === 'sim_nao_na' ? (
            <select id={`${idv}-v`} value={valor} disabled={encerrado} onChange={(e) => setValor(e.target.value)} className={INPUT}>
              <option value="">Sem resposta</option><option value="sim">Sim</option><option value="nao">Não</option><option value="na">Não se aplica</option>
            </select>
          ) : (
            <input id={`${idv}-v`} type={item.kind === 'data' ? 'date' : 'text'} inputMode={item.kind === 'numero' ? 'decimal' : undefined}
              maxLength={1000} value={valor} disabled={encerrado} onChange={(e) => setValor(e.target.value)} className={INPUT} />
          )}
        </div>
        <div>
          <label htmlFor={`${idv}-n`} className={LABEL}>Observação (opcional)</label>
          <input id={`${idv}-n`} type="text" maxLength={1000} value={nota} disabled={encerrado} onChange={(e) => setNota(e.target.value)} aria-describedby={`${idv}-lgpd`} className={INPUT} />
          <span id={`${idv}-lgpd`} className="sr-only">{AVISO_LGPD_NOTA}</span>
        </div>
        {!encerrado && (
          <button type="button" className={BTN_SEC} disabled={ocupado || !valor || !mudou} onClick={() => void onSalvar(valor, nota)}>Salvar</button>
        )}
      </div>
      {item.resposta && item.answered_at && <p className="mt-1 text-xs text-dash-muted">Respondido por {item.respondido_por ?? '—'} em {formatDataHora(item.answered_at)}</p>}
    </li>
  );
}
