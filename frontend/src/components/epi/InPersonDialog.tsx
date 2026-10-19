'use client';

import { useEffect, useRef, useState } from 'react';
import { epiApi } from '@/lib/epi/api';
import type { InPersonResult } from '@/lib/epi/types';
import { Modal } from './Modal';
import { mapSignatureError } from './signatureErrors';
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, LABEL } from './styles';

interface Props {
  open: boolean;
  deliveryIds: string[];
  onClose: () => void;
  onDone: (result: InPersonResult) => void;
}

// Tamanho por pontos de código Unicode depois do trim, como o backend (emoji conta 1; só espaços conta 0).
const cp = (s: string) => [...s.trim()].length;

export function InPersonDialog(props: Props) {
  if (!props.open) return null;
  return <InPersonInner {...props} />;
}

function InPersonInner({ deliveryIds, onClose, onDone }: Props) {
  const [witness, setWitness] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const errRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);
  useEffect(() => { if (error) errRef.current?.focus(); }, [error]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    const w = cp(witness);
    const r = cp(reason);
    if (w < 3 || w > 120) { setError('Informe o nome da testemunha (de 3 a 120 caracteres).'); return; }
    if (r < 5 || r > 300) { setError('Explique o motivo do registro presencial (de 5 a 300 caracteres).'); return; }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await epiApi.inPerson({ delivery_ids: deliveryIds, witness_name: witness.trim(), reason: reason.trim() });
      onDone(res);
      onClose();
    } catch (err) {
      if (aliveRef.current) setError(mapSignatureError(err));
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setBusy(false);
    }
  }

  return (
    <Modal title="Registrar assinatura presencial" onClose={onClose} busy={busy}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <p className="text-base text-dash-muted">
          Use quando o funcionário recebeu o EPI mas não pode assinar pelo celular. Ficam registrados quem fez o registro, a testemunha e o motivo.
          Este registro não gera comprovante eletrônico.
        </p>
        <div ref={errRef} tabIndex={-1} aria-live="assertive" role={error ? 'alert' : undefined} className={error ? 'rounded-lg bg-dash-status-crit-bg p-3 text-base text-dash-status-crit-text' : ''}>
          {error}
        </div>
        <div>
          <label htmlFor="ip-witness" className={LABEL}>Nome da testemunha</label>
          <input id="ip-witness" className={FIELD} maxLength={240} autoComplete="off" value={witness} onChange={(e) => setWitness(e.target.value)} />
        </div>
        <div>
          <label htmlFor="ip-reason" className={LABEL}>Motivo</label>
          <textarea id="ip-reason" rows={3} maxLength={600} className={`${FIELD} py-2`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" aria-disabled={busy} className={BTN_SECONDARY} onClick={() => { if (!busy) onClose(); }}>Cancelar</button>
          <button type="submit" aria-disabled={busy} className={BTN_PRIMARY}>{busy ? 'Registrando...' : 'Registrar assinatura presencial'}</button>
        </div>
      </form>
    </Modal>
  );
}
