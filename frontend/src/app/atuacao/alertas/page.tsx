'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card } from '@/components/ui/Card';
import { AsyncBody } from '@/components/ui/AsyncBody';
import {
  atuacaoFetch, DOC_CATEGORIAS, docCategoriaLabel, formatDataHora, MOTIVO_MUDANCA_LABEL, parseAntecedencias,
  type ClienteResumo, type MotivoMudanca, type MudancaCondicoes, type RegraAlerta,
} from '../api';

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const BTN =
  'rounded-md bg-dash-primary px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 disabled:opacity-60';
const BTN_SEC =
  'rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm font-semibold text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary disabled:opacity-60';
const LABEL = 'mb-1 block text-sm font-medium text-dash-muted';

export default function AlertasPage() {
  return (
    <div className="px-4 py-8 sm:px-6">
      <PageHeader titulo="Alertas e notificações" descricao="Antecedência dos avisos de vencimento por tipo de documento e revisões por mudança nas condições de trabalho. Os prazos de validade em meses são definidos pela administração; aqui você ajusta só quando avisar." />
      <div className="flex flex-col gap-6">
        <Regras />
        <Mudancas />
      </div>
    </div>
  );
}

function Regras() {
  const [regras, setRegras] = useState<RegraAlerta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState<string | null>(null);
  const [antec, setAntec] = useState('');
  const [fonte, setFonte] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => {
    setLoading(true);
    setError(null);
    return atuacaoFetch<RegraAlerta[]>('/alertas/regras').then(setRegras).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  function abrir(r: RegraAlerta) {
    setEditando(r.category);
    setAntec(r.notice_days_efetivo.join(', '));
    setFonte(r.source ?? '');
    setErro(null);
    setAviso('');
  }
  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (ocupado || !editando) return;
    const lista = parseAntecedencias(antec);
    if (!lista) { setErro('Informe de 1 a 8 antecedências em dias (0 a 365), sem repetir. Exemplo: 60, 30, 15, 7, 0.'); return; }
    setOcupado(true);
    setErro(null);
    try {
      await atuacaoFetch(`/alertas/regras/${editando}`, { method: 'PUT', body: JSON.stringify({ notice_days: lista, ...(fonte.trim() ? { source: fonte.trim() } : {}) }) });
      setEditando(null);
      setAviso('Antecedências salvas.');
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card title="Antecedência dos avisos de vencimento">
      <div role="status" className="mb-2 text-sm font-medium text-dash-status-ok-text empty:hidden">{aviso}</div>
      <AsyncBody
        data={regras}
        error={error}
        loading={loading}
        onRetry={() => void carregar()}
        skeletonClassName="h-40 w-full"
        render={(lista) => (
          <>
            <p className="mb-3 text-sm text-dash-muted">Sem ajuste, os avisos saem com 60, 30, 15 e 7 dias de antecedência e no dia do vencimento. Parâmetros operacionais, não prazos legais.</p>
            <ul aria-label="Regras por tipo de documento" className="flex flex-col gap-2">
              {lista.map((r) => (
                <li key={r.category} className="rounded-md border border-dash-border-input p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-dash-primary">{docCategoriaLabel(r.category)}</span>
                    <span className="text-dash-muted">
                      {r.validity_months ? `Validade: ${r.validity_months} meses · ` : 'Sem validade automática · '}
                      Avisos: {r.notice_days_efetivo.map((n) => (n === 0 ? 'no dia' : `${n} d`)).join(', ')}{r.usa_padrao ? ' (padrão)' : ''}
                    </span>
                    {editando !== r.category && <button type="button" className={BTN_SEC} onClick={() => abrir(r)} aria-label={`Ajustar avisos de ${docCategoriaLabel(r.category)}`}>Ajustar</button>}
                  </div>
                  {r.source && editando !== r.category && <p className="mt-1 text-xs text-dash-muted">Fonte: {r.source}</p>}
                  {editando === r.category && (
                    <form onSubmit={salvar} noValidate className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor="ar-antec" className={LABEL}>Antecedências em dias, separadas por vírgula</label>
                        <input id="ar-antec" type="text" value={antec} onChange={(e) => setAntec(e.target.value)} className={INPUT} />
                      </div>
                      <div>
                        <label htmlFor="ar-fonte" className={LABEL}>Fonte ou referência (opcional)</label>
                        <input id="ar-fonte" type="text" maxLength={500} value={fonte} onChange={(e) => setFonte(e.target.value)} className={INPUT} />
                      </div>
                      {erro && <p role="alert" className="text-sm text-dash-status-crit-text sm:col-span-2">{erro}</p>}
                      <div className="flex gap-2 sm:col-span-2">
                        <button type="submit" className={BTN} disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar'}</button>
                        <button type="button" className={BTN_SEC} disabled={ocupado} onClick={() => setEditando(null)}>Cancelar</button>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      />
    </Card>
  );
}

function Mudancas() {
  const [lista, setLista] = useState<MudancaCondicoes[] | null>(null);
  const [clientes, setClientes] = useState<ClienteResumo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState('');
  const [categoria, setCategoria] = useState('pgr');
  const [motivo, setMotivo] = useState<MotivoMudanca>('funcao');
  const [nota, setNota] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const emVoo = useRef(false);

  const carregar = useCallback(() => {
    setLoading(true);
    setError(null);
    return atuacaoFetch<MudancaCondicoes[]>('/alertas/mudancas').then(setLista).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    void carregar();
    atuacaoFetch<ClienteResumo[]>('/clientes').then((c) => setClientes(Array.isArray(c) ? c : [])).catch(() => setClientes([]));
  }, [carregar]);

  async function executar(req: () => Promise<unknown>) {
    if (emVoo.current) return;
    emVoo.current = true;
    setOcupado(true);
    setErro(null);
    try { await req(); await carregar(); } catch (e) { setErro((e as Error).message); } finally { emVoo.current = false; setOcupado(false); }
  }
  function registrar(e: FormEvent) {
    e.preventDefault();
    if (!tenant) { setErro('Escolha a empresa.'); return; }
    void executar(async () => {
      await atuacaoFetch('/alertas/mudancas', { method: 'POST', body: JSON.stringify({ tenant_id: tenant, category: categoria, reason: motivo, ...(nota.trim() ? { note: nota.trim() } : {}) }) });
      setNota('');
    });
  }

  return (
    <Card title="Revisão por mudança nas condições de trabalho">
      <p className="mb-3 text-sm text-dash-muted">Registre quando uma mudança (função, processo, equipamento, risco ou estabelecimento) exige revisar um documento, mesmo dentro da validade. Não altera a data de vencimento.</p>
      <form onSubmit={registrar} noValidate className="mb-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="mc-emp" className={LABEL}>Empresa</label>
          <select id="mc-emp" value={tenant} onChange={(e) => setTenant(e.target.value)} className={INPUT}>
            <option value="">Selecione…</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.trade_name || c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="mc-cat" className={LABEL}>Documento a revisar</label>
          <select id="mc-cat" value={categoria} onChange={(e) => setCategoria(e.target.value)} className={INPUT}>
            {DOC_CATEGORIAS.map((c) => <option key={c} value={c}>{docCategoriaLabel(c)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="mc-mot" className={LABEL}>Motivo</label>
          <select id="mc-mot" value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoMudanca)} className={INPUT}>
            {(Object.keys(MOTIVO_MUDANCA_LABEL) as MotivoMudanca[]).map((m) => <option key={m} value={m}>{MOTIVO_MUDANCA_LABEL[m]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="mc-nota" className={LABEL}>Observação curta (opcional, sem dados pessoais)</label>
          <input id="mc-nota" type="text" maxLength={500} value={nota} onChange={(e) => setNota(e.target.value)} className={INPUT} />
        </div>
        {erro && <p role="alert" className="text-sm text-dash-status-crit-text sm:col-span-2">{erro}</p>}
        <div className="sm:col-span-2"><button type="submit" className={BTN} disabled={ocupado}>Registrar mudança</button></div>
      </form>
      <AsyncBody
        data={lista}
        error={error}
        loading={loading}
        onRetry={() => void carregar()}
        skeletonClassName="h-24 w-full"
        render={(l) => l.length === 0 ? (
          <p className="text-sm text-dash-muted">Nenhuma revisão por mudança em aberto.</p>
        ) : (
          <ul aria-label="Revisões por mudança em aberto" className="flex flex-col gap-2">
            {l.map((m) => (
              <li key={m.id} className="rounded-md border border-dash-border-input p-3 text-sm">
                <p className="font-medium text-dash-primary">{m.empresa} — {MOTIVO_MUDANCA_LABEL[m.reason]}{m.category ? ` (${docCategoriaLabel(m.category)})` : ''}</p>
                {m.note && <p className="mt-1 whitespace-pre-wrap break-words text-dash-muted">{m.note}</p>}
                <p className="mt-1 text-xs text-dash-muted">Registrado por {m.created_by_name ?? '—'} em {formatDataHora(m.created_at)}</p>
                <button type="button" className={`${BTN_SEC} mt-2`} disabled={ocupado} onClick={() => void executar(() => atuacaoFetch(`/alertas/mudancas/${m.id}/resolver`, { method: 'POST', body: JSON.stringify({}) }))}>
                  Marcar como revisado
                </button>
              </li>
            ))}
          </ul>
        )}
      />
    </Card>
  );
}
