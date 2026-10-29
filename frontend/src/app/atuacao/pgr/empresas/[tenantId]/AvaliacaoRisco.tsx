'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  atuacaoFetch, AVALIACAO_KINDS, MSG_PGR_ESCRITA_INVENTARIO, AVALIACAO_KIND_LABEL, erroEscritaPgr, erroLeituraPgr, MSG_MATRIZ_AGUARDANDO,
  type AvaliacaoKind, type AvaliacaoRisco as Avaliacao, type AvaliacoesResposta, type MatrizVigente, type Risco,
} from '../../../api';
import { BTN, BTN_PRIMARY, ERRO, INPUT, LABEL } from '../../estilos';
import { ehErroDeVersao, rotuloEscala, type MatrizCtx } from './useMatrizVigente';

const MAX_JUSTIFICATIVA = 4000;
const MSG_CLASSIFICAR_403 = "Você não tem a permissão 'Elaborar o PGR' (pgr.write) para classificar riscos.";
const data = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR'); };

function Resultado({ a, matriz }: { a: Avaliacao; matriz: MatrizVigente | null }) {
  const sev = matriz && a.matrix_version_id === matriz.id ? rotuloEscala(matriz.config.severidade, a.severity_value) : undefined;
  const prob = matriz && a.matrix_version_id === matriz.id ? rotuloEscala(matriz.config.probabilidade, a.probability_value) : undefined;
  return (
    <div className="text-sm">
      <p>
        <span className="font-semibold">Escore: {a.score}</span> · Nível: <span className="font-semibold">{a.nivel?.rotulo ?? a.level_id}</span>
        {' '}· Matriz versão {a.matrix_version_number}
      </p>
      <p className="text-dash-muted">
        Severidade {a.severity_value}{sev ? ` (${sev})` : ''} · Probabilidade {a.probability_value}{prob ? ` (${prob})` : ''}
      </p>
      {a.nivel && <p>Aceitabilidade: {a.nivel.aceitabilidade} · Decisão: {a.nivel.decisao}</p>}
      <p className="text-dash-muted">Justificativa: {a.justification}</p>
      <p className="text-xs text-dash-muted">Em {data(a.assessed_at)}</p>
    </div>
  );
}

function Formulario({ kind, risco, tenantId, matriz, onSalva, onVersao }: {
  kind: AvaliacaoKind; risco: Risco; tenantId: string; matriz: MatrizVigente; onSalva: (a: Avaliacao) => void; onVersao: () => void;
}) {
  const [sev, setSev] = useState('');
  const [prob, setProb] = useState('');
  const [just, setJust] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  // Nova versão vigente: as escalas podem ter mudado, então a escolha antiga não vale; a justificativa é mantida.
  useEffect(() => { setSev(''); setProb(''); }, [matriz.id]);
  const id = (k: string) => `av-${kind}-${k}-${risco.id}`;
  const escSev = matriz.config.severidade.find((x) => String(x.valor) === sev);
  const escProb = matriz.config.probabilidade.find((x) => String(x.valor) === prob);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    const texto = just.trim();
    setOk(null);
    if (!sev || !prob) return setErro('Selecione a severidade e a probabilidade.');
    if (!texto) return setErro('Informe a justificativa.');
    if (texto.length > MAX_JUSTIFICATIVA) return setErro(`A justificativa deve ter no máximo ${MAX_JUSTIFICATIVA} caracteres.`);
    setOcupado(true); setErro(null);
    try {
      // O servidor calcula escore e nível: aqui vão só as escolhas e a versão da matriz que o usuário viu.
      const a = await atuacaoFetch<Avaliacao>(`/pgr/empresas/${tenantId}/riscos/${risco.id}/avaliacoes`, {
        method: 'POST',
        body: JSON.stringify({ kind, matrix_version_id: matriz.id, severity_value: Number(sev), probability_value: Number(prob), justification: texto }),
      });
      onSalva(a);
      if (vivo.current) { setSev(''); setProb(''); setJust(''); setOk('Classificação salva.'); }
    } catch (x) {
      if (vivo.current) {
        const m = erroEscritaPgr(x);
        if (ehErroDeVersao(m)) { setErro(`${m} A matriz vigente foi atualizada; escolha novamente a severidade e a probabilidade.`); onVersao(); } else setErro(m === MSG_PGR_ESCRITA_INVENTARIO ? MSG_CLASSIFICAR_403 : m);
      }
    } finally { if (vivo.current) setOcupado(false); }
  }

  return (
    <form onSubmit={salvar} noValidate aria-label={`Classificar ${AVALIACAO_KIND_LABEL[kind].toLowerCase()}`} className="mt-3 grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor={id('sev')} className={LABEL}>Severidade</label>
        <select id={id('sev')} value={sev} disabled={ocupado} className={INPUT} aria-describedby={escSev ? id('sev-d') : undefined} onChange={(e) => { setSev(e.target.value); setOk(null); }}>
          <option value="">Selecione</option>
          {matriz.config.severidade.map((x) => <option key={x.valor} value={x.valor}>{x.valor} — {x.rotulo}</option>)}
        </select>
        {escSev && <p id={id('sev-d')} className="mt-1 text-xs text-dash-muted">{escSev.descricao}</p>}
      </div>
      <div>
        <label htmlFor={id('prob')} className={LABEL}>Probabilidade</label>
        <select id={id('prob')} value={prob} disabled={ocupado} className={INPUT} aria-describedby={escProb ? id('prob-d') : undefined} onChange={(e) => { setProb(e.target.value); setOk(null); }}>
          <option value="">Selecione</option>
          {matriz.config.probabilidade.map((x) => <option key={x.valor} value={x.valor}>{x.valor} — {x.rotulo}</option>)}
        </select>
        {escProb && <p id={id('prob-d')} className="mt-1 text-xs text-dash-muted">{escProb.descricao}</p>}
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={id('just')} className={LABEL}>Justificativa</label>
        <textarea id={id('just')} rows={2} value={just} disabled={ocupado} className={INPUT} onChange={(e) => { setJust(e.target.value); setOk(null); }} />
        <p className="mt-1 text-xs text-dash-muted">Obrigatória, até {MAX_JUSTIFICATIVA} caracteres. O escore e o nível são calculados pelo servidor.</p>
      </div>
      {erro && <p role="alert" className={`sm:col-span-2 ${ERRO}`}>{erro}</p>}
      {ok && <p role="status" className="text-sm text-dash-primary sm:col-span-2">{ok}</p>}
      <div className="sm:col-span-2">
        <button type="submit" disabled={ocupado} className={BTN_PRIMARY}>{ocupado ? 'Salvando…' : 'Salvar classificação'}</button>
      </div>
    </form>
  );
}

// Classificação do risco (inerente e residual previsto) com a matriz vigente. Nada presumido: sem avaliação = "não classificado".
export function AvaliacaoRisco({ risco, tenantId, matriz }: { risco: Risco; tenantId: string; matriz: MatrizCtx }) {
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState<AvaliacoesResposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const seq = useRef(0);
  const url = `/pgr/empresas/${tenantId}/riscos/${risco.id}/avaliacoes`;

  const carregar = useCallback(() => {
    const id = ++seq.current;
    setDados(null); setErro(null);
    atuacaoFetch<AvaliacoesResposta>(url)
      .then((d) => { if (id === seq.current) setDados(d); })
      .catch((e) => { if (id === seq.current) setErro(erroLeituraPgr(e)); });
  }, [url]);
  useEffect(() => { if (aberto) carregar(); else seq.current++; }, [aberto, carregar]);

  const vigente = matriz.status === 'ok' ? matriz.matriz : null;
  function salva(a: Avaliacao) {
    setDados((d) => (d ? { historico: [a, ...d.historico], vigente: { ...d.vigente, [a.kind]: a } } : d));
  }

  return (
    <section aria-label={`Classificação do risco ${risco.name}`} className="mt-3 border-t border-dash-border-input pt-3">
      <button
        type="button" className={BTN} aria-expanded={aberto}
        aria-label={`${aberto ? 'Fechar classificação do risco' : 'Classificar risco'} ${risco.name}`}
        onClick={() => setAberto(!aberto)}
      >
        {aberto ? 'Fechar classificação' : 'Classificar risco'}
      </button>
      {aberto && (
        <div className="mt-2">
          {matriz.status === 'carregando' && <p role="status" className="text-sm text-dash-muted">Carregando matriz…</p>}
          {matriz.status === 'aguardando' && <p role="status" className="text-sm text-dash-muted">{MSG_MATRIZ_AGUARDANDO}</p>}
          {matriz.status === 'erro' && <p role="alert" className={ERRO}>{matriz.mensagem}</p>}
          {erro && <p role="alert" className={ERRO}>{erro}</p>}
          {!erro && !dados && <p role="status" className="text-sm text-dash-muted">Carregando classificações…</p>}
          {dados && AVALIACAO_KINDS.map((kind) => {
            const atual = dados.vigente[kind];
            const antiga = atual && vigente && atual.matrix_version_id !== vigente.id;
            return (
              <section key={kind} role="region" aria-label={AVALIACAO_KIND_LABEL[kind]} className="mb-3 rounded-md border border-dash-border-input p-3">
                <h5 className="text-sm font-semibold text-dash-primary">{AVALIACAO_KIND_LABEL[kind]}</h5>
                {atual ? <Resultado a={atual} matriz={vigente} /> : <p className="text-sm text-dash-muted">Não classificado</p>}
                {antiga && vigente && (
                  <p role="status" className="mt-1 text-sm text-dash-status-warn-text">
                    Avaliado na versão {atual.matrix_version_number}; a matriz vigente é a versão {vigente.version_number}. Reavalie para classificar na versão atual.
                  </p>
                )}
                {vigente && <Formulario kind={kind} risco={risco} tenantId={tenantId} matriz={vigente} onSalva={salva} onVersao={matriz.recarregar} />}
              </section>
            );
          })}
          {dados && dados.historico.length > 0 && (
            <div>
              <h5 className="text-sm font-semibold text-dash-primary">Histórico de classificações</h5>
              <ul aria-label="Histórico de classificações" className="mt-1 grid gap-1 text-sm">
                {dados.historico.map((h) => (
                  <li key={h.id} className="rounded border border-dash-border-input p-2">
                    <span className="font-semibold">{AVALIACAO_KIND_LABEL[h.kind]}</span> · versão {h.matrix_version_number} · escore {h.score} · {h.nivel?.rotulo ?? h.level_id}
                    <span className="block text-xs text-dash-muted">{data(h.assessed_at)} · {h.justification}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
