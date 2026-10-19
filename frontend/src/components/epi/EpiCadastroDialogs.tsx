'use client';

import { useEffect, useRef, useState } from 'react';
import { epiApi } from '@/lib/epi/api';
import { EpiApiError, mapEpiError } from '@/lib/epi/errors';
import { formatDate, formatQty } from '@/lib/epi/format';
import { newIdempotencyKey } from '@/lib/epi/idempotency';
import type { CreateEpiInput, EpiCatalogItem, EpiLot, EpiRow, UpdateEpiInput } from '@/lib/epi/types';
import { Modal } from './Modal';
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, LABEL } from './styles';

function ErrorBox({ message, boxRef }: { message: string | null; boxRef: React.RefObject<HTMLDivElement> }) {
  return (
    <div ref={boxRef} tabIndex={-1} role={message ? 'alert' : undefined} aria-live="assertive" className={message ? 'rounded-lg bg-dash-status-crit-bg p-3 text-base text-dash-status-crit-text' : ''}>
      {message}
    </div>
  );
}

// Limite do backend por movimentação (create-epi-movement.dto / create-epi-adjustment.dto).
const MAX_QTY = 100000;
const MAX_QTY_TEXT = '100.000';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const toInt = (s: string): number | null => (/^\d{1,9}$/.test(s.trim()) ? Number(s.trim()) : null);
const toMoney = (s: string): number | null => {
  const t = s.trim().replace(',', '.');
  return /^\d{1,10}(\.\d{1,2})?$/.test(t) ? Number(t) : null;
};
const dateOnly = (v: string | null): string => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');

// ---------------------------------------------------------------- cadastro / edição

interface FormProps {
  epi?: EpiRow; // ausente = novo cadastro
  catalog: EpiCatalogItem[];
  tenantId?: string;
  onClose: () => void;
  onSaved: () => void;
}

export function EpiFormDialog({ epi, catalog, tenantId, onClose, onSaved }: FormProps) {
  const editing = Boolean(epi);
  const [catalogId, setCatalogId] = useState(epi?.epi_catalog_item_id ?? '');
  const [ca, setCa] = useState(epi?.ca_number ?? '');
  const [validUntil, setValidUntil] = useState(dateOnly(epi?.ca_valid_until ?? null));
  const [manufacturer, setManufacturer] = useState(epi?.manufacturer ?? '');
  const [model, setModel] = useState(epi?.model ?? '');
  const [unit, setUnit] = useState(epi?.unit ?? 'un');
  const [minStock, setMinStock] = useState(epi?.min_stock != null ? String(epi.min_stock) : '');
  const [maxStock, setMaxStock] = useState(epi?.max_stock != null ? String(epi.max_stock) : '');
  const [cost, setCost] = useState(epi?.unit_cost != null ? String(epi.unit_cost).replace('.', ',') : '');
  const [replacement, setReplacement] = useState(epi?.replacement_days != null ? String(epi.replacement_days) : '');
  const [controlsLot, setControlsLot] = useState(epi?.controls_lot ?? false);
  const [error, setError] = useState<string | null>(null);
  // Contador de tentativas: a mesma mensagem repetida também leva o foco ao aviso.
  const [errSeq, setErrSeq] = useState(0);
  const fail = (m: string) => { setError(m); setErrSeq((k) => k + 1); };
  const [caepiMsg, setCaepiMsg] = useState<string | null>(null);
  const [caepiBusy, setCaepiBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const errRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (error) errRef.current?.focus(); }, [error, errSeq]);

  async function lookupCaepi() {
    if (caepiBusy) return;
    if (!ca.trim()) { setCaepiMsg('Informe o número do CA para consultar.'); return; }
    setCaepiBusy(true);
    setCaepiMsg(null);
    try {
      const recs = await epiApi.caepiSearch(ca);
      const rec = recs.find((r) => r.numero_ca === ca.trim()) ?? recs[0];
      if (!rec) {
        setCaepiMsg('CA não encontrado no CAEPI. Preencha os dados manualmente.');
      } else {
        const v = dateOnly(rec.data_validade);
        if (v) setValidUntil(v);
        if (!manufacturer.trim() && rec.razao_social) setManufacturer(rec.razao_social.slice(0, 120));
        setCaepiMsg(`CAEPI: CA ${rec.numero_ca}, situação ${rec.situacao ?? 'não informada'}, validade ${formatDate(rec.data_validade)}. Confira os campos preenchidos.`);
      }
    } catch (e) {
      setCaepiMsg(mapEpiError(e));
    } finally {
      setCaepiBusy(false);
    }
  }

  function validate(): { body?: CreateEpiInput | UpdateEpiInput; message?: string } {
    if (!editing && !catalogId) return { message: 'Escolha o item do catálogo.' };
    if (!ca.trim()) return { message: 'Informe o número do CA.' };
    if (validUntil && !DATE_ONLY.test(validUntil)) return { message: 'Informe uma validade do CA válida.' };
    const min = minStock.trim() === '' ? null : toInt(minStock);
    const max = maxStock.trim() === '' ? null : toInt(maxStock);
    if (minStock.trim() !== '' && min === null) return { message: 'O estoque mínimo deve ser um número inteiro, zero ou maior.' };
    if (maxStock.trim() !== '' && max === null) return { message: 'O estoque máximo deve ser um número inteiro, zero ou maior.' };
    if (min !== null && max !== null && max < min) return { message: 'O estoque máximo não pode ser menor que o mínimo.' };
    const money = cost.trim() === '' ? null : toMoney(cost);
    if (cost.trim() !== '' && money === null) return { message: 'Informe o custo unitário em reais, com até 2 casas decimais.' };
    const rep = replacement.trim() === '' ? null : toInt(replacement);
    if (replacement.trim() !== '' && (rep === null || rep < 1)) return { message: 'A troca recomendada deve ser de 1 dia ou mais.' };
    if (!unit.trim()) return { message: 'Informe a unidade (por exemplo, un ou par).' };

    if (!editing) {
      const body: CreateEpiInput = { epi_catalog_item_id: catalogId, ca_number: ca.trim(), controls_lot: controlsLot, unit: unit.trim() };
      if (validUntil) body.ca_valid_until = validUntil;
      if (manufacturer.trim()) body.manufacturer = manufacturer.trim();
      if (model.trim()) body.model = model.trim();
      if (min !== null) body.min_stock = min;
      if (max !== null) body.max_stock = max;
      if (money !== null) body.unit_cost = money;
      if (rep !== null) body.replacement_days = rep;
      if (tenantId) body.tenant_id = tenantId;
      return { body };
    }
    // Edição: só o que mudou. Campo limpo vira null (limpa no servidor).
    const cur = epi as EpiRow;
    const body: UpdateEpiInput = {};
    if (ca.trim() !== cur.ca_number) body.ca_number = ca.trim();
    if ((validUntil || null) !== (dateOnly(cur.ca_valid_until) || null)) body.ca_valid_until = validUntil || null;
    if ((manufacturer.trim() || null) !== (cur.manufacturer ?? null)) body.manufacturer = manufacturer.trim() || null;
    if ((model.trim() || null) !== (cur.model ?? null)) body.model = model.trim() || null;
    if (unit.trim() !== cur.unit) body.unit = unit.trim();
    if (min !== cur.min_stock) body.min_stock = min;
    if (max !== cur.max_stock) body.max_stock = max;
    if (money !== (cur.unit_cost != null ? Number(cur.unit_cost) : null)) body.unit_cost = money;
    if (rep !== cur.replacement_days) body.replacement_days = rep;
    if (controlsLot !== cur.controls_lot) body.controls_lot = controlsLot;
    return { body };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    const v = validate();
    if (v.message || !v.body) { fail(v.message ?? 'Verifique os dados informados.'); return; }
    if (editing && Object.keys(v.body).length === 0) { onClose(); return; }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      if (editing && epi) await epiApi.updateEpi(epi.id, v.body as UpdateEpiInput);
      else await epiApi.createEpi(v.body as CreateEpiInput);
      onSaved();
    } catch (err) {
      // 409 de unicidade do cadastro de EPI: tratado só aqui (a mesma mensagem do servidor existe em outros fluxos).
      fail(err instanceof EpiApiError && err.status === 409 && /duplicado/i.test(err.serverMessage)
        ? 'Já existe um EPI cadastrado com estes dados.'
        : mapEpiError(err));
      busyRef.current = false;
      setBusy(false);
    }
  }

  const selected = catalog.find((c) => c.id === catalogId);

  return (
    <Modal title={editing ? `Editar EPI: ${epi?.description}` : 'Cadastrar EPI'} onClose={onClose} busy={busy}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <ErrorBox message={error} boxRef={errRef} />
        {!editing && (
          <div>
            <label htmlFor="epi-catalog" className={LABEL}>Item do catálogo (obrigatório)</label>
            <select id="epi-catalog" className={FIELD} value={catalogId} onChange={(e) => setCatalogId(e.target.value)} required>
              <option value="">Escolha o equipamento</option>
              {catalog.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.description}</option>)}
            </select>
            {selected && <p className="mt-1 text-base text-dash-muted">Protege contra: {selected.risk_protected}</p>}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="epi-ca" className={LABEL}>Número do CA (obrigatório)</label>
            <input id="epi-ca" className={FIELD} value={ca} maxLength={100} onChange={(e) => setCa(e.target.value)} required />
            <button type="button" aria-disabled={caepiBusy} onClick={lookupCaepi} className={`${BTN_SECONDARY} mt-2`}>
              {caepiBusy ? 'Consultando...' : 'Consultar CAEPI'}
            </button>
          </div>
          <div>
            <label htmlFor="epi-valid" className={LABEL}>Validade do CA</label>
            <input id="epi-valid" type="date" className={FIELD} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
        </div>
        <p aria-live="polite" className="text-base text-dash-muted">{caepiMsg}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="epi-manufacturer" className={LABEL}>Fabricante</label>
            <input id="epi-manufacturer" className={FIELD} value={manufacturer} maxLength={120} onChange={(e) => setManufacturer(e.target.value)} />
          </div>
          <div>
            <label htmlFor="epi-model" className={LABEL}>Modelo</label>
            <input id="epi-model" className={FIELD} value={model} maxLength={120} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div>
            <label htmlFor="epi-unit" className={LABEL}>Unidade</label>
            <input id="epi-unit" className={FIELD} value={unit} maxLength={20} onChange={(e) => setUnit(e.target.value)} />
          </div>
          <div>
            <label htmlFor="epi-cost" className={LABEL}>Custo unitário (R$)</label>
            <input id="epi-cost" inputMode="decimal" className={FIELD} value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <div>
            <label htmlFor="epi-min" className={LABEL}>Estoque mínimo</label>
            <input id="epi-min" inputMode="numeric" className={FIELD} value={minStock} onChange={(e) => setMinStock(e.target.value)} />
          </div>
          <div>
            <label htmlFor="epi-max" className={LABEL}>Estoque máximo</label>
            <input id="epi-max" inputMode="numeric" className={FIELD} value={maxStock} onChange={(e) => setMaxStock(e.target.value)} />
          </div>
          <div>
            <label htmlFor="epi-replacement" className={LABEL}>Troca recomendada (dias)</label>
            <input id="epi-replacement" inputMode="numeric" className={FIELD} value={replacement} onChange={(e) => setReplacement(e.target.value)} />
          </div>
        </div>
        <div className="flex min-h-[44px] items-center gap-3">
          <input id="epi-lot" type="checkbox" className="h-6 w-6" checked={controlsLot} onChange={(e) => setControlsLot(e.target.checked)} />
          <label htmlFor="epi-lot" className="text-base text-dash-primary">Controla lote (cada entrada informa lote e validade)</label>
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" aria-disabled={busy} className={BTN_SECONDARY} onClick={() => { if (!busy) onClose(); }}>Cancelar</button>
          <button type="submit" aria-disabled={busy} className={BTN_PRIMARY}>{busy ? 'Salvando...' : editing ? 'Salvar alterações' : 'Cadastrar EPI'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- lotes

export function LotsDialog({ epi, onClose }: { epi: EpiRow; onClose: () => void }) {
  const [lots, setLots] = useState<EpiLot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setLots(null);
    setError(null);
    epiApi.lots(epi.id).then((r) => { if (alive) setLots(r); }).catch((e) => { if (alive) setError(mapEpiError(e)); });
    return () => { alive = false; };
  }, [epi.id, attempt]);

  return (
    <Modal title={`Lotes de ${epi.description}`} onClose={onClose}>
      <div aria-live="polite">
        {!lots && !error && <p role="status" className="text-base text-dash-muted">Carregando lotes...</p>}
        {error && (
          <div role="alert" className="flex flex-col items-start gap-3 text-base text-dash-status-crit-text">
            <span>{error}</span>
            <button type="button" className={BTN_SECONDARY} onClick={() => setAttempt((n) => n + 1)}>Tentar novamente</button>
          </div>
        )}
        {lots && lots.length === 0 && <p className="text-base text-dash-muted">Nenhum lote registrado.</p>}
        {lots && lots.length > 0 && (
          <ul className="divide-y divide-dash-border-soft">
            {lots.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-base">
                <span className="font-medium text-dash-primary">Lote {l.lot_code}</span>
                <span className="text-dash-muted">Validade {formatDate(l.valid_until)} · saldo {formatQty(l.balance)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-6 flex justify-end"><button type="button" className={BTN_SECONDARY} onClick={onClose}>Fechar</button></div>
    </Modal>
  );
}

// ---------------------------------------------------------------- abertura de estoque e ajuste (empresa)

interface StockProps { epi: EpiRow; onClose: () => void; onSaved: () => void }

export function OpeningDialog({ epi, onClose, onSaved }: StockProps) {
  const [quantity, setQuantity] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [lotValid, setLotValid] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Contador de tentativas: a mesma mensagem repetida também leva o foco ao aviso.
  const [errSeq, setErrSeq] = useState(0);
  const fail = (m: string) => { setError(m); setErrSeq((k) => k + 1); };
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const keyRef = useRef(newIdempotencyKey());
  const errRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errRef.current?.focus(); }, [error, errSeq]);
  const touch = () => { keyRef.current = newIdempotencyKey(); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    const q = toInt(quantity);
    if (q === null || q < 1 || q > MAX_QTY) { fail(`Informe a quantidade inicial (número inteiro de 1 a ${MAX_QTY_TEXT}).`); return; }
    if (epi.controls_lot && !lotCode.trim()) { fail('Informe o código do lote.'); return; }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await epiApi.registerMovement(epi.id, {
        type: 'abertura', quantity: q, idempotency_key: keyRef.current,
        ...(epi.controls_lot ? { lot_code: lotCode.trim(), ...(lotValid ? { lot_valid_until: lotValid } : {}) } : {}),
      });
      onSaved();
    } catch (err) {
      fail(mapEpiError(err));
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal title={`Abertura de estoque: ${epi.description}`} onClose={onClose} busy={busy}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <p className="text-base text-dash-muted">Registra o saldo inicial deste EPI. Depois da abertura, use Entrada ou Ajuste.</p>
        <ErrorBox message={error} boxRef={errRef} />
        <div>
          <label htmlFor="open-qty" className={LABEL}>Quantidade inicial</label>
          <input id="open-qty" inputMode="numeric" className={FIELD} value={quantity} onChange={(e) => { setQuantity(e.target.value); touch(); }} />
        </div>
        {epi.controls_lot && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="open-lot" className={LABEL}>Código do lote</label>
              <input id="open-lot" className={FIELD} maxLength={60} value={lotCode} onChange={(e) => { setLotCode(e.target.value); touch(); }} />
            </div>
            <div>
              <label htmlFor="open-lot-valid" className={LABEL}>Validade do lote</label>
              <input id="open-lot-valid" type="date" className={FIELD} value={lotValid} onChange={(e) => { setLotValid(e.target.value); touch(); }} />
            </div>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" aria-disabled={busy} className={BTN_SECONDARY} onClick={() => { if (!busy) onClose(); }}>Cancelar</button>
          <button type="submit" aria-disabled={busy} className={BTN_PRIMARY}>{busy ? 'Salvando...' : 'Registrar abertura'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function AdjustDialog({ epi, onClose, onSaved }: StockProps) {
  const [direction, setDirection] = useState<'mais' | 'menos'>('menos');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [lotId, setLotId] = useState('');
  const [lots, setLots] = useState<EpiLot[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Contador de tentativas: a mesma mensagem repetida também leva o foco ao aviso.
  const [errSeq, setErrSeq] = useState(0);
  const fail = (m: string) => { setError(m); setErrSeq((k) => k + 1); };
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const keyRef = useRef(newIdempotencyKey());
  const errRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errRef.current?.focus(); }, [error, errSeq]);
  const touch = () => { keyRef.current = newIdempotencyKey(); };

  useEffect(() => {
    if (!epi.controls_lot) return;
    let alive = true;
    epiApi.lots(epi.id).then((r) => { if (alive) setLots(r); }).catch((e) => { if (alive) fail(mapEpiError(e)); });
    return () => { alive = false; };
  }, [epi.id, epi.controls_lot]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    const q = toInt(quantity);
    if (q === null || q < 1 || q > MAX_QTY) { fail(`Informe a quantidade (número inteiro de 1 a ${MAX_QTY_TEXT}).`); return; }
    if (reason.trim().length < 5) { fail('Explique o motivo do ajuste (mínimo de 5 caracteres).'); return; }
    if (epi.controls_lot && !lotId) { fail('Escolha o lote a ajustar.'); return; }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await epiApi.adjust(epi.id, { direction, quantity: q, reason: reason.trim(), idempotency_key: keyRef.current, ...(epi.controls_lot ? { lot_id: lotId } : {}) });
      onSaved();
    } catch (err) {
      fail(mapEpiError(err));
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal title={`Ajuste de estoque: ${epi.description}`} onClose={onClose} busy={busy}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <p className="text-base text-dash-muted">Saldo atual: {formatQty(epi.stock_balance)}. O ajuste fica no histórico com o motivo informado.</p>
        <ErrorBox message={error} boxRef={errRef} />
        <fieldset className="flex flex-wrap gap-4">
          <legend className={LABEL}>Tipo de ajuste</legend>
          {(['menos', 'mais'] as const).map((d) => (
            <label key={d} className="flex min-h-[44px] items-center gap-2 text-base text-dash-primary">
              <input type="radio" name="adj-direction" className="h-5 w-5" checked={direction === d} onChange={() => { setDirection(d); touch(); }} />
              {d === 'menos' ? 'Retirar do estoque' : 'Acrescentar ao estoque'}
            </label>
          ))}
        </fieldset>
        <div>
          <label htmlFor="adj-qty" className={LABEL}>Quantidade</label>
          <input id="adj-qty" inputMode="numeric" className={FIELD} value={quantity} onChange={(e) => { setQuantity(e.target.value); touch(); }} />
        </div>
        {epi.controls_lot && (
          <div>
            <label htmlFor="adj-lot" className={LABEL}>Lote</label>
            <select id="adj-lot" className={FIELD} value={lotId} onChange={(e) => { setLotId(e.target.value); touch(); }}>
              <option value="">Escolha o lote</option>
              {lots.map((l) => <option key={l.id} value={l.id}>Lote {l.lot_code} (saldo {formatQty(l.balance)})</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="adj-reason" className={LABEL}>Motivo</label>
          <textarea id="adj-reason" rows={3} maxLength={500} className={`${FIELD} py-2`} value={reason} onChange={(e) => { setReason(e.target.value); touch(); }} />
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" aria-disabled={busy} className={BTN_SECONDARY} onClick={() => { if (!busy) onClose(); }}>Cancelar</button>
          <button type="submit" aria-disabled={busy} className={BTN_PRIMARY}>{busy ? 'Salvando...' : 'Registrar ajuste'}</button>
        </div>
      </form>
    </Modal>
  );
}
