'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import {
  atuacaoFetch, erroEscritaPgr, erroLeituraPgr, type Ghe, type PerigoResumo, type Risco, type RiscosCriados,
} from '../../../api';
import { BTN, BTN_PRIMARY, ERRO, INPUT, LABEL } from '../../estilos';
import { PerigosPicker } from './PerigosPicker';
import { RiscoCard } from './RiscoCard';
import { useMatrizVigente } from './useMatrizVigente';

const plural = (n: number, um: string, varios: string) => (n === 1 ? `1 ${um}` : `${n} ${varios}`);

// Etapa 4 — inventário de riscos por GHE. O servidor copia os valores do perigo; a edição é sempre da cópia.
export function Riscos({ tenantId, ghes, onMudou }: { tenantId: string; ghes: Ghe[]; onMudou: () => void }) {
  const [gheId, setGheId] = useState('');
  const [riscos, setRiscos] = useState<Risco[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [perigos, setPerigos] = useState<PerigoResumo[] | null>(null);
  const [erroPerigos, setErroPerigos] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [origem, setOrigem] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const seq = useRef(0);
  const matriz = useMatrizVigente();
  const base = `/pgr/empresas/${tenantId}`;

  useEffect(() => {
    let vivo = true;
    atuacaoFetch<PerigoResumo[]>(`/pgr/perigos?ativo=true&tenantId=${encodeURIComponent(tenantId)}`)
      .then((d) => { if (vivo) setPerigos(d); })
      .catch((e) => { if (vivo) setErroPerigos(erroLeituraPgr(e)); });
    return () => { vivo = false; };
  }, [tenantId]);

  const carregar = useCallback(() => {
    const id = ++seq.current;
    setRiscos(null); setErro(null);
    if (!gheId) return;
    atuacaoFetch<Risco[]>(`${base}/ghes/${gheId}/riscos`)
      .then((d) => { if (id === seq.current) setRiscos(d); })
      .catch((e) => { if (id === seq.current) setErro(erroLeituraPgr(e)); });
  }, [base, gheId]);
  useEffect(carregar, [carregar]);

  const ghe = ghes.find((g) => g.id === gheId);
  const nomePerigo = (id: string) => perigos?.find((p) => p.id === id)?.name ?? 'perigo da biblioteca';
  const outros = ghes.filter((g) => g.id !== gheId && g.riscos > 0);
  const trocar = (id: string, f: (r: Risco) => Risco) => setRiscos((l) => (l ? l.map((x) => (x.id === id ? f(x) : x)) : l));

  function resumoIgnorados(ign: string[], depois: string) {
    if (!ign.length) return '';
    return ` ${ign.length === 1 ? '1 já estava' : `${ign.length} já estavam`} no GHE${depois}: ${ign.map(nomePerigo).join(', ')}.`;
  }

  async function adicionar(ids: string[], exposicao: string): Promise<boolean> {
    setOcupado(true); setErro(null); setAviso(null);
    const seqAtual = seq.current;
    try {
      const r = await atuacaoFetch<RiscosCriados>(`${base}/ghes/${gheId}/riscos`, {
        method: 'POST', body: JSON.stringify(exposicao ? { hazard_ids: ids, exposure_type: exposicao } : { hazard_ids: ids }),
      });
      if (seqAtual === seq.current) setRiscos((l) => [...(l ?? []), ...r.riscos]);
      setAviso(`${plural(r.riscos.length, 'risco adicionado', 'riscos adicionados')}.${resumoIgnorados(r.ignorados, '')}`);
      onMudou();
      return true;
    } catch (e) { setErro(erroEscritaPgr(e)); return false; } finally { setOcupado(false); }
  }

  async function copiar() {
    setOcupado(true); setErro(null); setAviso(null);
    const seqAtual = seq.current;
    try {
      const r = await atuacaoFetch<RiscosCriados>(`${base}/ghes/${gheId}/copiar-riscos`, { method: 'POST', body: JSON.stringify({ from_ghe_id: origem }) });
      if (seqAtual === seq.current) setRiscos((l) => [...(l ?? []), ...r.riscos]);
      setAviso(`${plural(r.riscos.length, 'risco copiado', 'riscos copiados')} como rascunho (medições não são copiadas).${r.ignorados.length ? ` ${plural(r.ignorados.length, 'ignorado', 'ignorados')} por já existir no GHE.` : ''}`);
      setOrigem(''); onMudou();
    } catch (e) { setErro(erroEscritaPgr(e)); } finally { setOcupado(false); setConfirmando(false); }
  }

  return (
    <Card title="Riscos e inventário">
      {ghes.length === 0 ? (
        <p className="text-sm text-dash-muted">Cadastre ao menos um ambiente (GHE) na etapa Ambientes para registrar os riscos.</p>
      ) : (
        <div className="max-w-xl">
          <label htmlFor="riscos-ghe" className={LABEL}>Ambiente (GHE)</label>
          <select
            id="riscos-ghe" value={gheId} className={INPUT}
            onChange={(e) => { setGheId(e.target.value); setAviso(null); setOrigem(''); setConfirmando(false); }}
          >
            <option value="">Selecione um GHE</option>
            {ghes.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
      )}
      {aviso && <p role="status" className="mt-3 text-sm text-dash-primary">{aviso}</p>}
      {erro && <p role="alert" className={`mt-3 ${ERRO}`}>{erro}</p>}
      {ghe && riscos === null && !erro && <p role="status" className="mt-3 text-sm text-dash-muted">Carregando riscos…</p>}
      {ghe && riscos !== null && (
        <>
          <p className="mt-3 text-sm text-dash-muted">Riscos de {ghe.name}: {riscos.length}</p>
          {riscos.length === 0 && <p className="mt-1 text-sm text-dash-muted">Nenhum risco neste GHE ainda.</p>}
          <div className="mt-2 grid gap-3">
            {riscos.map((r) => (
              <RiscoCard
                key={r.id} risco={r} tenantId={tenantId} matriz={matriz} onRisco={(f) => trocar(r.id, f)}
                onExcluido={(id) => { setRiscos((l) => (l ?? []).filter((x) => x.id !== id)); onMudou(); }}
              />
            ))}
          </div>
          <PerigosPicker perigos={perigos} erro={erroPerigos} ocupado={ocupado} onAdicionar={adicionar} />
          {outros.length > 0 && (
            <section aria-labelledby="copiar-titulo" className="mt-4 rounded-md border border-dash-border-input p-3">
              <h4 id="copiar-titulo" className="text-sm font-semibold text-dash-primary">Copiar de outro GHE</h4>
              <div className="mt-2 max-w-xl">
                <label htmlFor="riscos-origem" className={LABEL}>Copiar riscos de</label>
                <select id="riscos-origem" value={origem} disabled={ocupado} className={INPUT} onChange={(e) => { setOrigem(e.target.value); setConfirmando(false); }}>
                  <option value="">Selecione o GHE de origem</option>
                  {outros.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              {!confirmando && <button type="button" className={`mt-2 ${BTN}`} disabled={!origem || ocupado} onClick={() => setConfirmando(true)}>Copiar riscos</button>}
              {confirmando && (
                <div className="mt-2" role="group" aria-label="Confirmar cópia">
                  <p className="text-sm">
                    Copiar os riscos e controles de {ghes.find((g) => g.id === origem)?.name} para {ghe.name}? As cópias nascem como rascunho; medições não são copiadas e riscos já presentes são ignorados.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className={BTN_PRIMARY} disabled={ocupado} onClick={copiar}>{ocupado ? 'Copiando…' : 'Confirmar cópia'}</button>
                    <button type="button" className={BTN} disabled={ocupado} onClick={() => setConfirmando(false)}>Cancelar</button>
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </Card>
  );
}
