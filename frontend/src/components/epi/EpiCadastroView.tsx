'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getUser } from '@/lib/auth';
import { epiApi } from '@/lib/epi/api';
import { mapEpiError } from '@/lib/epi/errors';
import { formatDate, formatMoney, formatQty } from '@/lib/epi/format';
import type { CaAlert, EpiCatalogItem, EpiCategory, EpiRow, EpiStatus, Page, StockBand } from '@/lib/epi/types';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { StockBadge } from './StockBadge';
import { CaBadge } from './CaBadge';
import { ConfirmDialog } from './ConfirmDialog';
import { Pagination } from './Pagination';
import { AdjustDialog, EpiFormDialog, LotsDialog, OpeningDialog } from './EpiCadastroDialogs';
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, LABEL } from './styles';

const PAGE_SIZE = 25;
const CATEGORIES: EpiCategory[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

interface Props {
  tenantId?: string;
  // Abertura de estoque e ajuste: por padrão só para o papel 'empresa' (a autoridade é o backend).
  canManageStock?: boolean;
}

type Dialog =
  | { kind: 'form'; epi?: EpiRow }
  | { kind: 'lots'; epi: EpiRow }
  | { kind: 'opening'; epi: EpiRow }
  | { kind: 'adjust'; epi: EpiRow }
  | null;

// Trocar de empresa remonta a view: lista, filtros, página e consultas em voo da empresa anterior somem.
export function EpiCadastroView(props: Props) {
  return <EpiCadastroInner key={props.tenantId ?? ''} {...props} />;
}

function EpiCadastroInner({ tenantId, canManageStock }: Props) {
  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [status, setStatus] = useState<EpiStatus | ''>('');
  const [category, setCategory] = useState<EpiCategory | ''>('');
  const [stockBand, setStockBand] = useState<StockBand | ''>('');
  const [caAlert, setCaAlert] = useState<CaAlert | ''>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<EpiRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const gen = useRef(0);

  const [catalog, setCatalog] = useState<EpiCatalogItem[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toInactivate, setToInactivate] = useState<EpiRow | null>(null);
  const [inactivating, setInactivating] = useState(false);
  const [inactivateError, setInactivateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const reactivating = useRef(false);

  const stockAllowed = canManageStock ?? getUser()?.role === 'empresa';

  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogTry, setCatalogTry] = useState(0);

  useEffect(() => {
    let alive = true;
    setCatalogError(null);
    epiApi.catalog().then((r) => { if (alive) setCatalog(r); }).catch((e) => { if (alive) setCatalogError(mapEpiError(e)); });
    return () => { alive = false; };
  }, [catalogTry]);

  // Ao desmontar, invalida qualquer consulta em voo.
  useEffect(() => () => { gen.current += 1; }, []);

  useEffect(() => {
    const mine = ++gen.current;
    setLoading(true);
    setError(null);
    epiApi
      .searchEpis({
        tenantId, q: appliedQ || undefined, status: status || undefined, category: category || undefined,
        stockBand: stockBand || undefined, caAlert: caAlert || undefined, page, pageSize: PAGE_SIZE,
      })
      .then((r) => {
        if (mine !== gen.current) return;
        // Página ficou vazia (ex.: inativou o último item dela): volta para a última página que existe.
        if (r.items.length === 0 && page > 1) { setPage(Math.max(1, Math.min(page - 1, Math.ceil(r.total / PAGE_SIZE)))); return; }
        setData(r);
        setLoading(false);
      })
      .catch((e) => { if (mine === gen.current) { setError(mapEpiError(e)); setLoading(false); } });
  }, [tenantId, appliedQ, status, category, stockBand, caAlert, page, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  function saved(message: string) {
    setDialog(null);
    setNotice(message);
    setRowError(null);
    refresh();
  }

  async function confirmInactivate() {
    if (!toInactivate || inactivating) return;
    setInactivating(true);
    setInactivateError(null);
    try {
      await epiApi.updateEpi(toInactivate.id, { status: 'inativo' });
      setToInactivate(null);
      setNotice('EPI inativado.');
      refresh();
    } catch (e) {
      setInactivateError(mapEpiError(e));
    } finally {
      setInactivating(false);
    }
  }

  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  async function reactivate(epi: EpiRow) {
    if (reactivating.current) return;
    reactivating.current = true;
    setReactivatingId(epi.id);
    setRowError(null);
    try {
      await epiApi.updateEpi(epi.id, { status: 'ativo' });
      setNotice('EPI reativado.');
      refresh();
    } catch (e) {
      setRowError(mapEpiError(e));
    } finally {
      reactivating.current = false;
      setReactivatingId(null);
    }
  }

  const hasFilters = appliedQ !== '' || status !== '' || category !== '' || stockBand !== '' || caAlert !== '';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form
          role="search" aria-label="Buscar EPI" className="flex w-full gap-2 sm:max-w-md"
          onSubmit={(e) => { e.preventDefault(); setAppliedQ(q.trim()); setPage(1); }}
        >
          <div className="flex-1">
            <label htmlFor="epi-q" className="sr-only">Buscar por descrição, CA, fabricante ou modelo</label>
            <input id="epi-q" type="search" className={FIELD} placeholder="Descrição, CA ou fabricante" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
          </div>
          <button type="submit" className={BTN_SECONDARY}>Buscar</button>
        </form>
        <button type="button" className={BTN_PRIMARY} onClick={() => { setNotice(null); setDialog({ kind: 'form' }); }}>Cadastrar EPI</button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="f-status" className={LABEL}>Situação</label>
          <select id="f-status" className={FIELD} value={status} onChange={(e) => filter(setStatus)(e.target.value as EpiStatus | '')}>
            <option value="">Todas</option>
            <option value="ativo">Ativos</option>
            <option value="inativo">Inativos</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-cat" className={LABEL}>Categoria</label>
          <select id="f-cat" className={FIELD} value={category} onChange={(e) => filter(setCategory)(e.target.value as EpiCategory | '')}>
            <option value="">Todas</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>Categoria {c}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="f-stock" className={LABEL}>Faixa de estoque</label>
          <select id="f-stock" className={FIELD} value={stockBand} onChange={(e) => filter(setStockBand)(e.target.value as StockBand | '')}>
            <option value="">Todas</option>
            <option value="sem_estoque">Sem estoque</option>
            <option value="abaixo">Abaixo do mínimo</option>
            <option value="otimo">Dentro da faixa</option>
            <option value="acima">Acima do máximo</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-ca" className={LABEL}>Situação do CA</label>
          <select id="f-ca" className={FIELD} value={caAlert} onChange={(e) => filter(setCaAlert)(e.target.value as CaAlert | '')}>
            <option value="">Todas</option>
            <option value="vencido">CA vencido</option>
            <option value="a_vencer">CA a vencer</option>
            <option value="ok">CA válido</option>
            <option value="sem_validade">CA sem validade</option>
          </select>
        </div>
      </div>

      <div aria-live="polite" className="space-y-1">
        {notice && <p role="status" className="text-base text-dash-status-ok-text">{notice}</p>}
        {catalogError && (
          <p role="alert" className="text-base text-dash-status-crit-text">
            {catalogError} O catálogo de equipamentos não foi carregado: o cadastro de novos EPIs depende dele.{' '}
            <button type="button" className="underline" onClick={() => setCatalogTry((n) => n + 1)}>Tentar novamente</button>
          </p>
        )}
        {rowError && <p role="alert" className="text-base text-dash-status-crit-text">{rowError}</p>}
      </div>

      {loading && !data && <div role="status" aria-label="Carregando EPIs" className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 w-full" />)}</div>}

      {error && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-[18px] bg-dash-card p-6 text-base text-dash-status-crit-text">
          <span>{error}</span>
          <button type="button" onClick={refresh} className={BTN_SECONDARY}>Tentar novamente</button>
        </div>
      )}

      {!error && data && data.items.length === 0 && (
        <Card>
          <p className="text-base text-dash-primary">{hasFilters || status !== '' ? 'Nenhum EPI encontrado com estes filtros.' : 'Nenhum EPI cadastrado ainda. Use "Cadastrar EPI" para começar.'}</p>
        </Card>
      )}

      {!error && data && data.items.length > 0 && (
        <div className={loading ? 'opacity-60' : ''} aria-busy={loading}>
          <ul className="space-y-3">
            {data.items.map((e) => (
              <li key={e.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-semibold text-dash-primary">{e.description}</h3>
                      <p className="text-base text-dash-muted">
                        CA {e.ca_number} · validade {formatDate(e.ca_valid_until)}
                        {(e.manufacturer || e.model) && ` · ${[e.manufacturer, e.model].filter(Boolean).join(' / ')}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {e.status === 'inativo' && <Badge tone="info" large>Inativo</Badge>}
                      <StockBadge band={e.stock_band} />
                      <CaBadge alert={e.ca_alert} />
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-base sm:grid-cols-4">
                    <div><dt className="text-dash-muted">Saldo</dt><dd className="font-medium text-dash-primary">{formatQty(e.stock_balance)} {e.unit}</dd></div>
                    <div><dt className="text-dash-muted">Mín. / máx.</dt><dd className="font-medium text-dash-primary">{formatQty(e.min_stock)} / {formatQty(e.max_stock)}</dd></div>
                    <div><dt className="text-dash-muted">Custo unitário</dt><dd className="font-medium text-dash-primary">{formatMoney(e.unit_cost)}</dd></div>
                    <div><dt className="text-dash-muted">Valor em estoque</dt><dd className="font-medium text-dash-primary">{formatMoney(e.stock_value)}</dd></div>
                  </dl>
                  {(e.lots_expired > 0 || e.lots_expiring > 0) && (
                    <p className="mt-2 text-base text-dash-status-warn-text">
                      {e.lots_expired > 0 && `${formatQty(e.lots_expired)} lote(s) vencido(s). `}
                      {e.lots_expiring > 0 && `${formatQty(e.lots_expiring)} lote(s) a vencer.`}
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" className={BTN_SECONDARY} aria-label={`Editar ${e.description}`} onClick={() => { setNotice(null); setDialog({ kind: 'form', epi: e }); }}>Editar</button>
                    {e.controls_lot && <button type="button" className={BTN_SECONDARY} aria-label={`Ver lotes de ${e.description}`} onClick={() => setDialog({ kind: 'lots', epi: e })}>Ver lotes</button>}
                    {stockAllowed && e.status === 'ativo' && (
                      <button type="button" className={BTN_SECONDARY} aria-label={`Abertura de estoque de ${e.description}`} onClick={() => { setNotice(null); setDialog({ kind: 'opening', epi: e }); }}>Abertura de estoque</button>
                    )}
                    {stockAllowed && (
                      <button type="button" className={BTN_SECONDARY} aria-label={`Ajustar estoque de ${e.description}`} onClick={() => { setNotice(null); setDialog({ kind: 'adjust', epi: e }); }}>Ajustar estoque</button>
                    )}
                    {e.status === 'ativo' ? (
                      <button type="button" className={BTN_SECONDARY} aria-label={`Inativar ${e.description}`} onClick={() => { setInactivateError(null); setToInactivate(e); }}>Inativar</button>
                    ) : (
                      <button type="button" className={BTN_SECONDARY} aria-label={`Reativar ${e.description}`} aria-disabled={reactivatingId !== null} onClick={() => reactivate(e)}>{reactivatingId === e.id ? 'Reativando...' : 'Reativar'}</button>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <div className="mt-4"><Pagination page={data.page} pageSize={data.page_size} total={data.total} onChange={setPage} /></div>
        </div>
      )}

      {dialog?.kind === 'form' && (
        <EpiFormDialog
          epi={dialog.epi} catalog={catalog} tenantId={tenantId} onClose={() => setDialog(null)}
          onSaved={() => saved(dialog.epi ? 'EPI atualizado.' : 'EPI cadastrado.')}
        />
      )}
      {dialog?.kind === 'lots' && <LotsDialog epi={dialog.epi} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'opening' && <OpeningDialog epi={dialog.epi} onClose={() => setDialog(null)} onSaved={() => saved('Abertura de estoque registrada.')} />}
      {dialog?.kind === 'adjust' && <AdjustDialog epi={dialog.epi} onClose={() => setDialog(null)} onSaved={() => saved('Ajuste de estoque registrado.')} />}

      <ConfirmDialog
        open={toInactivate !== null}
        title={`Inativar ${toInactivate?.description ?? 'EPI'}?`}
        description="O EPI deixa de aceitar novas entregas e entradas. O histórico e o saldo permanecem e você pode reativá-lo depois."
        confirmLabel="Inativar EPI"
        destructive
        busy={inactivating}
        onConfirm={confirmInactivate}
        onCancel={() => setToInactivate(null)}
      >
        {inactivateError && <p role="alert" className="text-base text-dash-status-crit-text">{inactivateError}</p>}
      </ConfirmDialog>
    </div>
  );
}
