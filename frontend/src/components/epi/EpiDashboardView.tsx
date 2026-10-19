'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getUser } from '@/lib/auth';
import { epiApi, MAX_PERIOD_DAYS } from '@/lib/epi/api';
import { EpiApiError, mapEpiError } from '@/lib/epi/errors';
import { addDays, diffDays, formatDate, formatDateTime, formatMoney, formatQty, todayDateOnly } from '@/lib/epi/format';
import type { EmployeeLite, EpiDashboard, EpiRow, MovementType } from '@/lib/epi/types';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { StockBadge } from './StockBadge';
import { CaBadge } from './CaBadge';
import { SignatureStatusBadge } from './SignatureStatusBadge';
import { BTN_PRIMARY, BTN_SECONDARY, FIELD } from './styles';

export type EpiTabId = 'painel' | 'cadastro' | 'movimentacao' | 'fichas';

interface Props {
  tenantId?: string;
  // Quando informado, o controle dos dias de aviso aparece; por padrão só para o papel 'empresa'.
  canEditSettings?: boolean;
  // Chamado ao clicar em "Gerar link" numa pendência (o diálogo de assinatura é montado por quem usa a view).
  onGerarLink?: (deliveryId: string, employeeId: string) => void;
  // Técnico/parceiro navegam por abas (não por rotas): quando informado, os atalhos chamam esta função.
  onNavigate?: (tab: EpiTabId) => void;
  // Registrar assinatura presencial de uma entrega pendente (o diálogo é montado por quem usa a view).
  onPresencial?: (deliveryId: string) => void;
  // Muda quando algo foi alterado fora da view (ex.: link de assinatura gerado): recarrega pendências e números.
  refreshKey?: number;
}

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  abertura: 'Abertura', entrada: 'Entrada', entrega: 'Entrega', devolucao: 'Devolução', troca: 'Troca',
  baixa: 'Baixa', ajuste: 'Ajuste', estorno: 'Estorno',
};

const ROUTES: Record<Exclude<EpiTabId, 'painel'>, string> = {
  cadastro: '/empresa/epi/cadastro',
  movimentacao: '/empresa/epi/movimentacao',
  fichas: '/empresa/epi/fichas',
};

function Shortcut({ tab, label, onNavigate }: { tab: Exclude<EpiTabId, 'painel'>; label: string; onNavigate?: (t: EpiTabId) => void }) {
  if (onNavigate) {
    return <button type="button" className={BTN_SECONDARY} onClick={() => onNavigate(tab)}>{label}</button>;
  }
  return <Link href={ROUTES[tab]} className={BTN_SECONDARY}>{label}</Link>;
}

// Trocar de empresa remonta a view: dados, dias de aviso, filtros, erro e consultas em voo da empresa anterior somem.
export function EpiDashboardView(props: Props) {
  return <EpiDashboardInner key={props.tenantId ?? ''} {...props} />;
}

function EpiDashboardInner({ tenantId, canEditSettings, onGerarLink, onNavigate, onPresencial, refreshKey }: Props) {
  const today = todayDateOnly();
  const [from, setFrom] = useState(() => addDays(today, -29));
  const [to, setTo] = useState(today);
  const [epiId, setEpiId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [epis, setEpis] = useState<EpiRow[]>([]);
  const [episTruncated, setEpisTruncated] = useState(false);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [data, setData] = useState<EpiDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reload, setReload] = useState(0);
  const gen = useRef(0);

  const [days, setDays] = useState('');
  const [daysError, setDaysError] = useState<string | null>(null);
  const [daysOk, setDaysOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const editable = canEditSettings ?? getUser()?.role === 'empresa';

  const periodInvalid = from !== '' && to !== '' && diffDays(from, to) < 0;
  const periodClamped = from !== '' && to !== '' && diffDays(from, to) > MAX_PERIOD_DAYS;

  // Listas dos filtros (uma vez). Se falharem, os filtros ficam sem opções, sem derrubar o painel.
  useEffect(() => {
    let alive = true;
    epiApi.searchAllEpis(tenantId).then((r) => { if (alive) { setEpis(r.items); setEpisTruncated(r.truncated); } }).catch(() => {});
    epiApi.employees(tenantId).then((r) => { if (alive) setEmployees(r); }).catch(() => {});
    return () => { alive = false; };
  }, [tenantId]);

  // Cada consulta recebe um número; resposta de consulta antiga (período/filtro mudou) é descartada.
  useEffect(() => {
    if (periodInvalid) return;
    const mine = ++gen.current;
    setLoading(true);
    setError(null);
    setNotFound(false);
    epiApi
      .dashboard({ tenantId, from: from || undefined, to: to || undefined, epiId: epiId || undefined, employeeId: employeeId || undefined })
      .then((r) => {
        if (mine !== gen.current) return;
        setData(r);
        setDays((cur) => (cur === '' ? String(r.alert_days) : cur));
        setLoading(false);
      })
      .catch((e) => {
        if (mine !== gen.current) return;
        if (e instanceof EpiApiError && e.status === 404) { setNotFound(true); setError('Empresa não encontrada ou sem acesso para você.'); }
        else setError(mapEpiError(e));
        setLoading(false);
      });
  }, [tenantId, from, to, epiId, employeeId, reload, periodInvalid, refreshKey]);

  // Ao desmontar, invalida qualquer consulta em voo.
  useEffect(() => () => { gen.current += 1; }, []);

  const retry = useCallback(() => setReload((n) => n + 1), []);

  async function saveDays(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setDaysOk(false);
    const n = Number(days);
    if (!/^\d+$/.test(days.trim()) || n < 1 || n > 365) {
      setDaysError('Informe um número inteiro de 1 a 365 dias.');
      return;
    }
    setDaysError(null);
    setSaving(true);
    try {
      const r = await epiApi.updateSettings(n, tenantId);
      setDays(String(r.epi_alert_days));
      setDaysOk(true);
      setReload((c) => c + 1);
    } catch (err) {
      setDaysError(mapEpiError(err));
    } finally {
      setSaving(false);
    }
  }

  const filtered = epiId !== '' || employeeId !== '';
  const isEmpty = data !== null && data.kpis.epis_total === 0 && !filtered;

  return (
    <div className="space-y-6">
      <form className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => e.preventDefault()} aria-label="Filtros do painel">
        <div>
          <label htmlFor="epi-from" className="mb-1 block text-base font-medium text-dash-primary">De</label>
          <input id="epi-from" type="date" className={FIELD} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label htmlFor="epi-to" className="mb-1 block text-base font-medium text-dash-primary">Até</label>
          <input id="epi-to" type="date" className={FIELD} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label htmlFor="epi-filter-epi" className="mb-1 block text-base font-medium text-dash-primary">Equipamento</label>
          <select id="epi-filter-epi" className={FIELD} value={epiId} onChange={(e) => setEpiId(e.target.value)}>
            <option value="">Todos os equipamentos</option>
            {epis.map((x) => <option key={x.id} value={x.id}>{x.description} (CA {x.ca_number})</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="epi-filter-emp" className="mb-1 block text-base font-medium text-dash-primary">Funcionário</label>
          <select id="epi-filter-emp" className={FIELD} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Todos os funcionários</option>
            {employees.map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
          </select>
        </div>
      </form>
      <div aria-live="polite">
        {episTruncated && <p className="text-base text-dash-muted">Mostrando os primeiros 1000 EPIs; refine pela busca.</p>}
        {periodInvalid && <p role="alert" className="text-base text-dash-status-crit-text">A data inicial não pode ser depois da data final.</p>}
        {periodClamped && !periodInvalid && (
          <p className="text-base text-dash-muted">O período máximo é de {MAX_PERIOD_DAYS} dias: as movimentações mostradas começam {MAX_PERIOD_DAYS} dias antes da data final.</p>
        )}
      </div>

      {loading && !data && (
        <div role="status" aria-label="Carregando painel" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      )}

      {error && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-[18px] bg-dash-card p-6 text-base text-dash-status-crit-text">
          <span>{error}</span>
          {!notFound && <button type="button" onClick={retry} className={BTN_SECONDARY}>Tentar novamente</button>}
        </div>
      )}

      {!error && isEmpty && (
        <Card>
          <p className="text-base text-dash-primary">Nenhum EPI ativo. Cadastre os equipamentos ou reative os inativos para acompanhar estoque, CA e assinaturas.</p>
          <div className="mt-4"><Shortcut tab="cadastro" label="Cadastrar EPI" onNavigate={onNavigate} /></div>
        </Card>
      )}

      {!error && data && editable && (
        <div>
          <Card title="Dias de aviso de vencimento">
              <form onSubmit={saveDays} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="sm:w-56">
                  <label htmlFor="epi-alert-days" className="mb-1 block text-base font-medium text-dash-primary">Avisar com quantos dias de antecedência</label>
                  <input
                    id="epi-alert-days" type="number" inputMode="numeric" min={1} max={365} step={1} className={FIELD}
                    value={days} onChange={(e) => { setDays(e.target.value); setDaysOk(false); }}
                    aria-invalid={daysError ? true : undefined} aria-describedby="epi-alert-days-msg"
                  />
                </div>
                <button type="submit" aria-disabled={saving} className={BTN_PRIMARY}>{saving ? 'Salvando...' : 'Salvar dias de aviso'}</button>
              </form>
              <p id="epi-alert-days-msg" aria-live="polite" className={`mt-2 text-base ${daysError ? 'text-dash-status-crit-text' : 'text-dash-muted'}`} role={daysError ? 'alert' : undefined}>
                {daysError ?? (daysOk ? 'Dias de aviso salvos.' : 'Vale para CA e lotes a vencer (1 a 365 dias).')}
              </p>
            </Card>
        </div>
      )}

      {!error && data && !isEmpty && (
        <div className={loading ? 'opacity-60' : ''} aria-busy={loading}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard large label="EPIs ativos" value={formatQty(data.kpis.epis_total)} />
            <KpiCard large label="Estoque disponível" value={formatQty(data.kpis.stock_total)} hint="unidades dos EPIs ativos" />
            <KpiCard
              large
              label="Estoque baixo ou zerado"
              value={formatQty(data.kpis.low_stock + data.kpis.zero_stock)}
              hint={`${formatQty(data.kpis.low_stock)} abaixo do mínimo · ${formatQty(data.kpis.zero_stock)} sem estoque`}
            />
            <KpiCard
              large
              label="CA e lotes vencidos ou a vencer"
              value={formatQty(data.kpis.ca_expired + data.kpis.ca_expiring + data.kpis.lots_expired + data.kpis.lots_expiring)}
              hint={`CA: ${formatQty(data.kpis.ca_expired)} vencidos, ${formatQty(data.kpis.ca_expiring)} a vencer · Lotes: ${formatQty(data.kpis.lots_expired)} vencidos, ${formatQty(data.kpis.lots_expiring)} a vencer`}
            />
            <KpiCard large label="Aguardando assinatura" value={formatQty(data.kpis.pending_signatures)} hint="entregas sem assinatura do funcionário" />
            <KpiCard large label="Valor em estoque" value={formatMoney(data.kpis.stock_value)} />
          </div>

          <p className="mt-4 text-base text-dash-muted">
            Avisos de vencimento: {formatQty(data.alert_days)} dias. Período das movimentações: {formatDate(data.period.from)} a {formatDate(data.period.to)}.
          </p>

          <div className="mt-6 flex flex-wrap gap-3" aria-label="Atalhos">
            <Shortcut tab="movimentacao" label="Registrar entrega" onNavigate={onNavigate} />
            <Shortcut tab="fichas" label="Abrir ficha" onNavigate={onNavigate} />
            <Shortcut tab="cadastro" label="Consultar estoque" onNavigate={onNavigate} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Alertas">
              {data.alerts.length === 0 ? (
                <p className="text-base text-dash-muted">Nenhum alerta de estoque ou validade.</p>
              ) : (
                <ul className="divide-y divide-dash-border-soft">
                  {data.alerts.map((a) => (
                    <li key={a.epi_id} className="py-3">
                      <p className="text-base font-medium text-dash-primary">{a.description} <span className="font-normal text-dash-muted">(CA {a.ca_number})</span></p>
                      <p className="mt-1 text-base text-dash-muted">
                        Saldo {formatQty(a.stock_balance)}{a.min_stock !== null ? ` · mínimo ${formatQty(a.min_stock)}` : ''} · CA até {formatDate(a.ca_valid_until)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(a.stock_band === 'sem_estoque' || a.stock_band === 'abaixo') && <StockBadge band={a.stock_band} />}
                        {(a.ca_alert === 'vencido' || a.ca_alert === 'a_vencer') && <CaBadge alert={a.ca_alert} />}
                        {a.lots_expired > 0 && <span className="text-base text-dash-status-crit-text">{formatQty(a.lots_expired)} lote(s) vencido(s)</span>}
                        {a.lots_expiring > 0 && <span className="text-base text-dash-status-warn-text">{formatQty(a.lots_expiring)} lote(s) a vencer</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Entregas aguardando assinatura">
              {data.pending.length === 0 ? (
                <p className="text-base text-dash-muted">Nenhuma entrega aguardando assinatura.</p>
              ) : (
                <ul className="divide-y divide-dash-border-soft">
                  {data.pending.map((p) => (
                    <li key={p.delivery_id} className="py-3">
                      <p className="text-base font-medium text-dash-primary">{p.employee_name}</p>
                      <p className="mt-1 text-base text-dash-muted">
                        {p.epi_description}{p.quantity !== null ? ` · ${formatQty(p.quantity)} un.` : ''} · entregue em {formatDate(p.delivered_at)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <SignatureStatusBadge status={p.signature_status} />
                        {p.active_request_expires_at && <span className="text-base text-dash-muted">Link válido até {formatDateTime(p.active_request_expires_at)}</span>}
                        {onGerarLink && (
                          <button type="button" className={BTN_SECONDARY} aria-label={`Gerar link de assinatura para ${p.employee_name}, ${p.epi_description}`} onClick={() => onGerarLink(p.delivery_id, p.employee_id)}>
                            Gerar link
                          </button>
                        )}
                        {onPresencial && (
                          <button type="button" className={BTN_SECONDARY} aria-label={`Registrar assinatura presencial de ${p.employee_name}, ${p.epi_description}`} onClick={() => onPresencial(p.delivery_id)}>
                            Registrar assinatura presencial
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Movimentações recentes" className="mt-6">
            {data.recent_movements.length === 0 ? (
              <p className="text-base text-dash-muted">Nenhuma movimentação no período.</p>
            ) : (
              <ul className="divide-y divide-dash-border-soft">
                {data.recent_movements.map((m) => (
                  <li key={m.id} className="py-3">
                    <p className="text-base font-medium text-dash-primary">
                      {MOVEMENT_LABEL[m.type] ?? m.type} · {formatQty(m.quantity)} un. · {m.epi_description}
                      {m.reversed && <span className="ml-2 rounded-[5px] bg-dash-status-crit-bg px-2 py-0.5 text-base font-semibold text-dash-status-crit-text">Estornada</span>}
                    </p>
                    <p className="mt-1 text-base text-dash-muted">
                      {formatDateTime(m.occurred_at)}{m.employee_name ? ` · ${m.employee_name}` : ''}{m.reason ? ` · ${m.reason}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
