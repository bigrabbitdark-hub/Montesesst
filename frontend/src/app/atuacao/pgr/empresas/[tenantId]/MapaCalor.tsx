'use client';

import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import {
  atuacaoFetch, AVALIACAO_KINDS, AVALIACAO_KIND_LABEL, erroLeituraPgr, MSG_MATRIZ_AGUARDANDO, plural,
  type AvaliacaoKind, type MapaCalorResposta, type MatrizVigente,
} from '../../../api';
import { ERRO, INPUT, LABEL } from '../../estilos';
import { ehErroDeVersao, useMatrizVigente } from './useMatrizVigente';

const riscos = (n: number) => plural(n, 'risco', 'riscos');

// A intensidade do fundo vem só da contagem (não de um nível "perigoso"): o nível é sempre dito em texto.
function fundo(qtd: number, max: number): React.CSSProperties {
  if (!qtd || !max) return {};
  return { backgroundColor: `rgba(30, 64, 175, ${(0.08 + 0.32 * (qtd / max)).toFixed(2)})` };
}

function Grade({ matriz, mapa }: { matriz: MatrizVigente; mapa: MapaCalorResposta }) {
  const { severidade, probabilidade, niveis } = matriz.config;
  const max = Math.max(0, ...mapa.cells.map((c) => c.quantidade));
  const nivel = (id: string) => niveis.find((n) => n.id === id)?.rotulo ?? id;
  return (
    <div className="overflow-x-auto">
      <table className="mt-3 w-full border-collapse text-sm">
        <caption className="mb-2 text-left text-sm text-dash-muted">
          Mapa de calor — {AVALIACAO_KIND_LABEL[mapa.kind].toLowerCase()}, matriz versão {mapa.matrix_version.version_number}. Linhas: severidade; colunas: probabilidade.
        </caption>
        <thead>
          <tr>
            <td className="border border-dash-border-input p-2" />
            {probabilidade.map((p) => (
              <th key={p.valor} scope="col" className="border border-dash-border-input p-2 text-left font-semibold">{p.valor} — {p.rotulo}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {severidade.map((s) => (
            <tr key={s.valor}>
              <th scope="row" className="border border-dash-border-input p-2 text-left font-semibold">{s.valor} — {s.rotulo}</th>
              {probabilidade.map((p) => {
                const c = mapa.cells.find((x) => x.severidade === s.valor && x.probabilidade === p.valor);
                if (!c) return <td key={p.valor} className="border border-dash-border-input p-2">—</td>;
                return (
                  <td key={p.valor} style={fundo(c.quantidade, max)} className="border border-dash-border-input p-2 align-top">
                    <span className="block font-semibold">{riscos(c.quantidade)}</span>
                    <span className="block text-xs">{nivel(c.nivel_id)} · escore {c.score}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Etapa "Classificação": mapa de calor da empresa para a matriz vigente (contagem = avaliação vigente de cada risco).
export function MapaCalor({ tenantId }: { tenantId: string }) {
  const matriz = useMatrizVigente();
  const [kind, setKind] = useState<AvaliacaoKind>('inerente');
  const [mapa, setMapa] = useState<MapaCalorResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aguardando, setAguardando] = useState(false);
  const seq = useRef(0);
  const vigente = matriz.status === 'ok' ? matriz.matriz : null;
  const vigenteId = vigente?.id;
  const recarregarMatriz = matriz.recarregar;

  useEffect(() => {
    const id = ++seq.current;
    setMapa(null); setErro(null); setAguardando(false);
    if (!vigenteId) return;
    atuacaoFetch<MapaCalorResposta>(`/pgr/empresas/${tenantId}/mapa-calor?kind=${kind}&matrix_version_id=${encodeURIComponent(vigenteId)}`)
      .then((d) => { if (id === seq.current) setMapa(d); })
      .catch((e) => {
        if (id !== seq.current) return;
        const m = erroLeituraPgr(e);
        if (m === MSG_MATRIZ_AGUARDANDO) setAguardando(true); else setErro(m);
        if (ehErroDeVersao(m)) recarregarMatriz();
      });
  }, [tenantId, kind, vigenteId, recarregarMatriz]);

  const espera = matriz.status === 'aguardando' || aguardando;
  const mensagemErro = erro ?? (matriz.status === 'erro' ? matriz.mensagem : null);
  const carregando = !espera && !mensagemErro && (matriz.status === 'carregando' || !mapa);

  return (
    <Card title="Classificação dos riscos">
      <div className="max-w-xs">
        <label htmlFor="mapa-kind" className={LABEL}>Tipo de risco</label>
        <select id="mapa-kind" value={kind} className={INPUT} onChange={(e) => setKind(e.target.value as AvaliacaoKind)}>
          {AVALIACAO_KINDS.map((k) => <option key={k} value={k}>{AVALIACAO_KIND_LABEL[k]}</option>)}
        </select>
      </div>
      {espera && <p role="status" className="mt-3 text-sm text-dash-muted">{MSG_MATRIZ_AGUARDANDO}</p>}
      {mensagemErro && <p role="alert" className={`mt-3 ${ERRO}`}>{mensagemErro}</p>}
      {carregando && <p role="status" className="mt-3 text-sm text-dash-muted">Carregando mapa de calor…</p>}
      {mapa && vigente && (
        <>
          <Grade matriz={vigente} mapa={mapa} />
          <ul className="mt-3 grid gap-1 text-sm">
            <li>{riscos(mapa.total_riscos)} no inventário; {riscos(mapa.classificados)} classificados na versão {mapa.matrix_version.version_number}.</li>
            <li>{riscos(mapa.sem_avaliacao)} sem avaliação (não classificados).</li>
            <li>{mapa.em_outra_versao === 1 ? '1 risco avaliado' : `${mapa.em_outra_versao} riscos avaliados`} em outra versão da matriz (reavaliar para entrar no mapa).</li>
          </ul>
          {mapa.por_versao.length > 0 && (
            <div className="mt-2">
              <h4 className="text-sm font-semibold text-dash-primary">Última avaliação por versão da matriz</h4>
              <ul className="text-sm">
                {mapa.por_versao.map((v) => <li key={v.version_number}>Versão {v.version_number}: {riscos(v.n)}</li>)}
              </ul>
            </div>
          )}
          <div className="mt-2">
            <h4 className="text-sm font-semibold text-dash-primary">Níveis da matriz</h4>
            <ul className="text-sm">
              {vigente.config.niveis.map((n) => <li key={n.id}>{n.rotulo}: {n.aceitabilidade} — {n.decisao}</li>)}
            </ul>
          </div>
        </>
      )}
    </Card>
  );
}
