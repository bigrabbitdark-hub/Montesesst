'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getUser } from '@/lib/auth';
import { epiApi } from '@/lib/epi/api';
import { mapEpiError } from '@/lib/epi/errors';
import { formatDate, formatDateTime, formatQty } from '@/lib/epi/format';
import { newIdempotencyKey } from '@/lib/epi/idempotency';
import type { EmployeeLite, EpiLot, EpiRow, Movement, MovementType, Page } from '@/lib/epi/types';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ConfirmDialog } from './ConfirmDialog';
import { Pagination } from './Pagination';
import { SignatureLinkDialog } from './SignatureLinkDialog';
import { InPersonDialog } from './InPersonDialog';
import { ActiveLinks } from './ActiveLinks';
import { MOVEMENT_LABEL } from './EpiDashboardView';
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, LABEL } from './styles';

const PAGE_SIZE = 20;
const MAX_QTY = 100000;
const NEW_LOT = '__novo__';

type FormType = 'entrada' | 'entrega' | 'devolucao' | 'troca' | 'baixa' | 'ajuste' | 'abertura';

const FORM_LABEL: Record<FormType, string> = {
  entrada: 'Entrada de estoque', entrega: 'Entrega a funcionário', devolucao: 'Devolução de funcionário', troca: 'Troca de EPI',
  baixa: 'Baixa (perda ou descarte)', ajuste: 'Ajuste de estoque', abertura: 'Abertura de estoque',
};
const FORM_DONE: Record<FormType, string> = {
  entrada: 'Entrada registrada.', entrega: 'Entrega registrada.', devolucao: 'Devolução registrada.', troca: 'Troca registrada.',
  baixa: 'Baixa registrada.', ajuste: 'Ajuste registrado.', abertura: 'Abertura de estoque registrada.',
};
const HISTORY_TYPES: MovementType[] = ['abertura', 'entrada', 'entrega', 'devolucao', 'troca', 'baixa', 'ajuste', 'estorno'];

const toInt = (s: string): number | null => (/^\d{1,9}$/.test(s.trim()) ? Number(s.trim()) : null);
const cp = (s: string) => [...s.trim()].length;

export interface MovimentacaoFilters { epiId?: string; employeeId?: string; type?: MovementType; from?: string; to?: string }

interface Props {
  tenantId?: string;
  initialFilters?: MovimentacaoFilters;
  // Abertura, ajuste e estorno: por padrão só para o papel 'empresa' (a autoridade é o backend).
  canManageStock?: boolean;
}

// Trocar de empresa remonta a view: histórico, formulário, filtros e consultas em voo da empresa anterior somem.
export function EpiMovimentacaoView(props: Props) {
  return <EpiMovimentacaoInner key={props.tenantId ?? ''} {...props} />;
}

interface Delivered { employeeId: string; employeeName: string; deliveryId: string; label: string }

function EpiMovimentacaoInner({ tenantId, initialFilters, canManageStock }: Props) {
  const stockAllowed = canManageStock ?? getUser()?.role === 'empresa';
  const types: FormType[] = stockAllowed
    ? ['entrega', 'devolucao', 'troca', 'entrada', 'baixa', 'ajuste', 'abertura']
    : ['entrega', 'devolucao', 'troca', 'entrada', 'baixa'];

  // ---- listas de apoio
  const [epis, setEpis] = useState<EpiRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [episTruncated, setEpisTruncated] = useState(false);
  const [listsError, setListsError] = useState<string | null>(null);
  const [epiTick, setEpiTick] = useState(0);
  const [listsTry, setListsTry] = useState(0);

  useEffect(() => {
    let alive = true;
    setListsError(null);
    epiApi.searchAllEpis(tenantId).then((r) => { if (alive) { setEpis(r.items); setEpisTruncated(r.truncated); } }).catch((e) => { if (alive) setListsError(mapEpiError(e)); });
    epiApi.employees(tenantId).then((r) => { if (alive) setEmployees(r); }).catch((e) => { if (alive) setListsError(mapEpiError(e)); });
    return () => { alive = false; };
  }, [tenantId, epiTick, listsTry]);

  const epiName = (id: string) => epis.find((e) => e.id === id)?.description ?? 'EPI';
  const employeeName = (id: string | null) => (id ? employees.find((e) => e.id === id)?.full_name ?? 'Funcionário' : null);

  // ---- histórico
  const [fEpi, setFEpi] = useState(initialFilters?.epiId ?? '');
  const [fEmployee, setFEmployee] = useState(initialFilters?.employeeId ?? '');
  const [fType, setFType] = useState<MovementType | ''>(initialFilters?.type ?? '');
  const [fFrom, setFFrom] = useState(initialFilters?.from ?? '');
  const [fTo, setFTo] = useState(initialFilters?.to ?? '');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<Movement> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [localReversed, setLocalReversed] = useState<string[]>([]);
  const gen = useRef(0);
  const periodInvalid = fFrom !== '' && fTo !== '' && fFrom > fTo;

  useEffect(() => {
    if (periodInvalid) return;
    const mine = ++gen.current;
    setLoading(true);
    setError(null);
    epiApi
      .movements({
        tenantId, tenantEpiId: fEpi || undefined, employeeId: fEmployee || undefined, type: fType || undefined,
        from: fFrom ? `${fFrom}T00:00:00-03:00` : undefined, to: fTo ? `${fTo}T23:59:59-03:00` : undefined, page, pageSize: PAGE_SIZE,
      })
      .then((r) => {
        if (mine !== gen.current) return;
        if (r.items.length === 0 && page > 1) { setPage(Math.max(1, Math.min(page - 1, Math.ceil(r.total / PAGE_SIZE)))); return; }
        setData(r);
        setLoading(false);
      })
      .catch((e) => { if (mine === gen.current) { setError(mapEpiError(e)); setLoading(false); } });
  }, [tenantId, fEpi, fEmployee, fType, fFrom, fTo, page, reload, periodInvalid]);
  useEffect(() => () => { gen.current += 1; }, []);

  const refreshHistory = useCallback(() => { setPage(1); setReload((n) => n + 1); }, []);
  const filter = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  // "Estornada" vem da flag do servidor; o estado local só adianta a marca logo após estornar nesta sessão.
  const isReversed = (m: Movement) => m.reversed === true || localReversed.includes(m.id);

  // ---- formulário
  const [type, setType] = useState<FormType>('entrega');
  const [epiId, setEpiId] = useState(initialFilters?.epiId ?? '');
  const [employeeId, setEmployeeId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [supplier, setSupplier] = useState('');
  const [reason, setReason] = useState('');
  const [direction, setDirection] = useState<'mais' | 'menos'>('menos');
  const [lotSel, setLotSel] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [lotValid, setLotValid] = useState('');
  const [lots, setLots] = useState<EpiLot[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [linksTick, setLinksTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [delivered, setDelivered] = useState<Delivered | null>(null);
  const busyRef = useRef(false);
  const keyRef = useRef(newIdempotencyKey());
  const errRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (formError) errRef.current?.focus(); }, [formError]);
  // Qualquer mudança no formulário é outra operação: chave nova. Reenviar o MESMO formulário reaproveita a chave.
  const touch = () => { keyRef.current = newIdempotencyKey(); };

  const epi = epis.find((e) => e.id === epiId);
  const controlsLot = epi?.controls_lot ?? false;
  const [lotTick, setLotTick] = useState(0);
  useEffect(() => {
    setLots([]);
    if (!epiId || !controlsLot) return;
    let alive = true;
    epiApi.lots(epiId).then((r) => { if (alive) setLots(r); }).catch((e) => { if (alive) setFormError(mapEpiError(e)); });
    return () => { alive = false; };
  }, [epiId, controlsLot, lotTick]);

  const needsEmployee = type === 'entrega' || type === 'devolucao' || type === 'troca';
  const canCreateLot = type === 'entrada' || type === 'abertura';

  function validate(): { qty: number } | string {
    if (!epiId) return 'Escolha o EPI.';
    if (needsEmployee && !employeeId) return 'Escolha o funcionário.';
    const q = toInt(quantity);
    if (q === null || q < 1 || q > MAX_QTY) return 'Informe a quantidade (número inteiro de 1 a 100.000).';
    if (type === 'entrada' && cp(supplier) < 1) return 'Informe o fornecedor ou a origem.';
    if ((type === 'baixa' || type === 'ajuste') && cp(reason) < 5) return 'Explique o motivo (mínimo de 5 caracteres).';
    if (controlsLot) {
      if (!lotSel) return canCreateLot ? 'Escolha o lote ou informe um novo.' : 'Escolha o lote.';
      if (lotSel === NEW_LOT && !lotCode.trim()) return 'Informe o código do lote.';
    }
    return { qty: q };
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    const v = validate();
    if (typeof v === 'string') { setFormError(v); return; }
    setFormError(null);
    setNotice(null);
    if (type === 'baixa' || type === 'ajuste') { setConfirmOpen(true); return; }
    void send(v.qty);
  }

  async function send(qty: number) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFormError(null);
    const lotPart = controlsLot && lotSel
      ? (lotSel === NEW_LOT ? { lot_code: lotCode.trim(), ...(lotValid ? { lot_valid_until: lotValid } : {}) } : { lot_id: lotSel })
      : {};
    try {
      let m: Movement;
      if (type === 'ajuste') {
        m = await epiApi.adjust(epiId, {
          direction, quantity: qty, reason: reason.trim(), idempotency_key: keyRef.current,
          ...(controlsLot && lotSel && lotSel !== NEW_LOT ? { lot_id: lotSel } : {}),
        });
      } else {
        m = await epiApi.registerMovement(epiId, {
          type, quantity: qty, idempotency_key: keyRef.current,
          ...(needsEmployee ? { employee_id: employeeId } : {}),
          ...(type === 'entrada' ? { supplier: supplier.trim() } : {}),
          ...((type === 'baixa' || type === 'devolucao' || type === 'troca') && cp(reason) > 0 ? { reason: reason.trim() } : {}),
          ...lotPart,
        });
      }
      setNotice(FORM_DONE[type]);
      if ((type === 'entrega' || type === 'troca') && m.delivery_id) {
        setDelivered({ employeeId, employeeName: employeeName(employeeId) ?? 'Funcionário', deliveryId: m.delivery_id, label: `${FORM_LABEL[type]}: ${epiName(epiId)}` });
      } else {
        setDelivered(null);
      }
      setQuantity(''); setSupplier(''); setReason(''); setLotSel(''); setLotCode(''); setLotValid(''); setEmployeeId('');
      keyRef.current = newIdempotencyKey();
      refreshHistory();
      setEpiTick((n) => n + 1);
      setLotTick((n) => n + 1);
    } catch (err) {
      // A chave é mantida: reenviar o mesmo formulário depois de uma falha de rede não duplica o registro.
      setFormError(mapEpiError(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  // ---- estorno
  const [toReverse, setToReverse] = useState<Movement | null>(null);
  const [revReason, setRevReason] = useState('');
  const [revError, setRevError] = useState<string | null>(null);
  const [reversing, setReversing] = useState(false);
  const revBusy = useRef(false);
  const revKey = useRef(newIdempotencyKey());

  async function confirmReverse() {
    if (!toReverse || revBusy.current) return;
    if (cp(revReason) < 5) { setRevError('Explique o motivo do estorno (mínimo de 5 caracteres).'); return; }
    revBusy.current = true;
    setReversing(true);
    setRevError(null);
    try {
      await epiApi.reverse(toReverse.id, { reason: revReason.trim(), idempotency_key: revKey.current });
      setLocalReversed((l) => [...l, toReverse.id]);
      setToReverse(null);
      setNotice('Movimentação estornada.');
      refreshHistory();
      setEpiTick((n) => n + 1);
    } catch (err) {
      setRevError(mapEpiError(err));
    } finally {
      revBusy.current = false;
      setReversing(false);
    }
  }

  // ---- assinatura da entrega registrada
  const [linkOpen, setLinkOpen] = useState(false);
  const [personOpen, setPersonOpen] = useState(false);

  const hasFilters = fEpi !== '' || fEmployee !== '' || fType !== '' || fFrom !== '' || fTo !== '';
  

  return (
    <div className="space-y-8">
      {episTruncated && <p className="text-base text-dash-muted">Mostrando os primeiros 1000 EPIs; refine pela busca.</p>}
      {listsError && (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-[18px] bg-dash-card p-4 text-base text-dash-status-crit-text">
          <span>{listsError} As listas de EPI e de funcionários podem estar incompletas.</span>
          <button type="button" className={BTN_SECONDARY} onClick={() => setListsTry((n) => n + 1)}>Tentar novamente</button>
        </div>
      )}

      <section aria-labelledby="mov-form-title">
        <Card>
          <h2 id="mov-form-title" className="text-lg font-semibold text-dash-primary">Registrar movimentação</h2>
          <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
            <div ref={errRef} tabIndex={-1} aria-live="assertive" role={formError ? 'alert' : undefined} className={formError ? 'rounded-lg bg-dash-status-crit-bg p-3 text-base text-dash-status-crit-text' : ''}>
              {formError}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="mov-type" className={LABEL}>Tipo de movimentação</label>
                <select id="mov-type" className={FIELD} value={type} onChange={(e) => { setType(e.target.value as FormType); setLotSel(''); setFormError(null); touch(); }}>
                  {types.map((t) => <option key={t} value={t}>{FORM_LABEL[t]}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="mov-epi" className={LABEL}>EPI</label>
                <select id="mov-epi" className={FIELD} value={epiId} onChange={(e) => { setEpiId(e.target.value); setLotSel(''); touch(); }}>
                  <option value="">Escolha o EPI</option>
                  {epis.map((e) => <option key={e.id} value={e.id}>{e.description} (CA {e.ca_number}){e.status === 'inativo' ? ' - inativo' : ''}</option>)}
                </select>
                {epi && <p className="mt-1 text-base text-dash-muted">Saldo atual: {formatQty(epi.stock_balance)} {epi.unit}</p>}
              </div>
              {needsEmployee && (
                <div>
                  <label htmlFor="mov-employee" className={LABEL}>Funcionário</label>
                  <select id="mov-employee" className={FIELD} value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); touch(); }}>
                    <option value="">Escolha o funcionário</option>
                    {employees.map((x) => <option key={x.id} value={x.id}>{x.full_name}{x.registration_number ? ` (${x.registration_number})` : ''}</option>)}
                  </select>
                </div>
              )}
              {type === 'ajuste' && (
                <fieldset className="flex flex-wrap gap-4">
                  <legend className={LABEL}>Tipo de ajuste</legend>
                  {(['menos', 'mais'] as const).map((d) => (
                    <label key={d} className="flex min-h-[44px] items-center gap-2 text-base text-dash-primary">
                      <input type="radio" name="mov-direction" className="h-5 w-5" checked={direction === d} onChange={() => { setDirection(d); touch(); }} />
                      {d === 'menos' ? 'Retirar do estoque' : 'Acrescentar ao estoque'}
                    </label>
                  ))}
                </fieldset>
              )}
              <div>
                <label htmlFor="mov-qty" className={LABEL}>Quantidade</label>
                <input id="mov-qty" inputMode="numeric" autoComplete="off" className={FIELD} value={quantity} onChange={(e) => { setQuantity(e.target.value); touch(); }} />
              </div>
              {type === 'entrada' && (
                <div>
                  <label htmlFor="mov-supplier" className={LABEL}>Fornecedor ou origem</label>
                  <input id="mov-supplier" className={FIELD} maxLength={200} value={supplier} onChange={(e) => { setSupplier(e.target.value); touch(); }} />
                </div>
              )}
              {controlsLot && (
                <div>
                  <label htmlFor="mov-lot" className={LABEL}>Lote</label>
                  <select id="mov-lot" className={FIELD} value={lotSel} onChange={(e) => { setLotSel(e.target.value); touch(); }}>
                    <option value="">Escolha o lote</option>
                    {lots.map((l) => <option key={l.id} value={l.id}>Lote {l.lot_code} (saldo {formatQty(l.balance)}, validade {formatDate(l.valid_until)})</option>)}
                    {canCreateLot && <option value={NEW_LOT}>Novo lote</option>}
                  </select>
                </div>
              )}
              {controlsLot && lotSel === NEW_LOT && (
                <>
                  <div>
                    <label htmlFor="mov-lot-code" className={LABEL}>Código do novo lote</label>
                    <input id="mov-lot-code" className={FIELD} maxLength={60} value={lotCode} onChange={(e) => { setLotCode(e.target.value); touch(); }} />
                  </div>
                  <div>
                    <label htmlFor="mov-lot-valid" className={LABEL}>Validade do lote</label>
                    <input id="mov-lot-valid" type="date" className={FIELD} value={lotValid} onChange={(e) => { setLotValid(e.target.value); touch(); }} />
                  </div>
                </>
              )}
            </div>
            {(type === 'devolucao' || type === 'troca' || type === 'baixa' || type === 'ajuste') && (
              <div>
                <label htmlFor="mov-reason" className={LABEL}>
                  {type === 'baixa' || type === 'ajuste' ? 'Motivo' : 'Motivo (opcional)'}
                </label>
                <textarea id="mov-reason" rows={2} maxLength={500} className={`${FIELD} py-2`} value={reason} onChange={(e) => { setReason(e.target.value); touch(); }} />
              </div>
            )}
            <div className="flex justify-end">
              <button type="submit" aria-disabled={busy} className={BTN_PRIMARY}>{busy ? 'Registrando...' : `Registrar ${FORM_LABEL[type].toLowerCase()}`}</button>
            </div>
          </form>

          <div aria-live="polite" className="mt-3">
            {notice && <p role="status" className="text-base text-dash-status-ok-text">{notice}</p>}
          </div>

          {delivered && (
            <div className="mt-4 space-y-3 rounded-lg border border-dash-border-input p-4" role="region" aria-label="Assinatura da entrega registrada">
              <p className="text-base text-dash-primary">
                <strong>{delivered.label}</strong> para {delivered.employeeName}. A entrega aguarda a assinatura do funcionário.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BTN_PRIMARY} onClick={() => setLinkOpen(true)}>Gerar link de assinatura</button>
                <button type="button" className={BTN_SECONDARY} onClick={() => setPersonOpen(true)}>Registrar assinatura presencial</button>
              </div>
              <ActiveLinks employeeId={delivered.employeeId} deliveryId={delivered.deliveryId} tenantKey={tenantId ?? ''} refreshKey={linksTick} />
            </div>
          )}
        </Card>
      </section>

      <section aria-labelledby="mov-hist-title" className="space-y-4">
        <h2 id="mov-hist-title" className="text-lg font-semibold text-dash-primary">Histórico de movimentações</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label htmlFor="h-epi" className={LABEL}>EPI</label>
            <select id="h-epi" className={FIELD} value={fEpi} onChange={(e) => filter(setFEpi)(e.target.value)}>
              <option value="">Todos</option>
              {epis.map((e) => <option key={e.id} value={e.id}>{e.description}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="h-emp" className={LABEL}>Funcionário</label>
            <select id="h-emp" className={FIELD} value={fEmployee} onChange={(e) => filter(setFEmployee)(e.target.value)}>
              <option value="">Todos</option>
              {employees.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="h-type" className={LABEL}>Tipo</label>
            <select id="h-type" className={FIELD} value={fType} onChange={(e) => filter(setFType)(e.target.value as MovementType | '')}>
              <option value="">Todos</option>
              {HISTORY_TYPES.map((t) => <option key={t} value={t}>{MOVEMENT_LABEL[t]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="h-from" className={LABEL}>De</label>
            <input id="h-from" type="date" className={FIELD} value={fFrom} onChange={(e) => filter(setFFrom)(e.target.value)} />
          </div>
          <div>
            <label htmlFor="h-to" className={LABEL}>Até</label>
            <input id="h-to" type="date" className={FIELD} value={fTo} onChange={(e) => filter(setFTo)(e.target.value)} />
          </div>
        </div>
        {periodInvalid && <p role="alert" className="text-base text-dash-status-crit-text">A data inicial não pode ser depois da data final.</p>}

        {loading && !data && <div role="status" aria-label="Carregando histórico" className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>}

        {error && (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-[18px] bg-dash-card p-6 text-base text-dash-status-crit-text">
            <span>{error}</span>
            <button type="button" onClick={() => setReload((n) => n + 1)} className={BTN_SECONDARY}>Tentar novamente</button>
          </div>
        )}

        {!error && data && data.items.length === 0 && (
          <Card><p className="text-base text-dash-primary">{hasFilters ? 'Nenhuma movimentação encontrada com estes filtros.' : 'Nenhuma movimentação registrada ainda.'}</p></Card>
        )}

        {!error && data && data.items.length > 0 && (
          <div className={loading ? 'opacity-60' : ''} aria-busy={loading}>
            <ul className="space-y-3">
              {data.items.map((m) => {
                const reversed = isReversed(m);
                const who = employeeName(m.employee_id);
                return (
                  <li key={m.id}>
                    <Card>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className="text-base font-semibold text-dash-primary">{epiName(m.tenant_epi_id)}</h3>
                          <p className="text-base text-dash-muted">
                            {formatDateTime(m.occurred_at)}{who ? ` · ${who}` : ''}{m.supplier ? ` · origem: ${m.supplier}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge tone={m.type === 'estorno' ? 'warn' : m.direction === 1 ? 'ok' : 'info'} large>{MOVEMENT_LABEL[m.type]}</Badge>
                          {reversed && <Badge tone="crit" large>Estornada</Badge>}
                        </div>
                      </div>
                      <p className="mt-2 text-base text-dash-primary">
                        <span className="font-medium">{m.direction === 1 ? '+' : '−'}{formatQty(m.quantity)}</span>
                        <span className="text-dash-muted"> · saldo após: {formatQty(m.balance_after)}</span>
                      </p>
                      {m.type === 'estorno' && <p className="text-base text-dash-muted">Desfaz uma movimentação anterior.</p>}
                      {m.reason && <p className="mt-1 text-base text-dash-muted">Motivo: {m.reason}</p>}
                      {stockAllowed && m.type !== 'estorno' && !reversed && (
                        <div className="mt-3">
                          <button
                            type="button" className={BTN_SECONDARY}
                            aria-label={`Estornar ${MOVEMENT_LABEL[m.type].toLowerCase()} de ${epiName(m.tenant_epi_id)}`}
                            onClick={() => { setRevReason(''); setRevError(null); revKey.current = newIdempotencyKey(); setToReverse(m); }}
                          >Estornar</button>
                        </div>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4"><Pagination page={data.page} pageSize={data.page_size} total={data.total} onChange={setPage} /></div>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmOpen}
        title={type === 'ajuste' ? 'Confirmar ajuste de estoque?' : 'Confirmar baixa de estoque?'}
        description={`${type === 'ajuste' ? (direction === 'mais' ? 'Acrescenta ao' : 'Retira do') : 'Retira do'} estoque: ${quantity.trim()} un. de ${epiName(epiId)}. Fica registrado no histórico e só pode ser desfeito por estorno.`}
        confirmLabel={type === 'ajuste' ? 'Registrar ajuste' : 'Registrar baixa'}
        destructive
        busy={busy}
        onConfirm={() => { const v = validate(); if (typeof v !== 'string') void send(v.qty); }}
        onCancel={() => setConfirmOpen(false)}
      >
        <p className="text-base text-dash-primary"><span className="font-medium">Motivo:</span> {reason.trim()}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={toReverse !== null}
        title="Estornar movimentação?"
        description="O estorno cria uma movimentação inversa; a original permanece no histórico. Informe o motivo."
        confirmLabel="Estornar movimentação"
        destructive
        busy={reversing}
        onConfirm={confirmReverse}
        onCancel={() => setToReverse(null)}
      >
        <label htmlFor="rev-reason" className={LABEL}>Motivo do estorno</label>
        <textarea id="rev-reason" rows={3} maxLength={500} className={`${FIELD} py-2`} value={revReason} onChange={(e) => { setRevReason(e.target.value); revKey.current = newIdempotencyKey(); }} />
        {revError && <p role="alert" className="mt-2 text-base text-dash-status-crit-text">{revError}</p>}
      </ConfirmDialog>

      {delivered && (
        <>
          <SignatureLinkDialog open={linkOpen} tenantId={tenantId} employeeId={delivered.employeeId} deliveryIds={[delivered.deliveryId]} onClose={(changed) => { setLinkOpen(false); if (changed) setLinksTick((n) => n + 1); }} />
          <InPersonDialog
            open={personOpen} deliveryIds={[delivered.deliveryId]} onClose={() => setPersonOpen(false)}
            onDone={() => { setDelivered(null); setNotice('Assinatura presencial registrada.'); setReload((n) => n + 1); }}
          />
        </>
      )}
    </div>
  );
}
