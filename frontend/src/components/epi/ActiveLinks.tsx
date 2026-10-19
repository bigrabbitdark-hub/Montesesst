'use client';

import { useEffect, useRef, useState } from 'react';
import { epiApi } from '@/lib/epi/api';
import { mapEpiError } from '@/lib/epi/errors';
import { formatDateTime } from '@/lib/epi/format';
import type { SignatureRequest } from '@/lib/epi/types';
import { ConfirmDialog } from './ConfirmDialog';
import { BTN_SECONDARY } from './styles';

// Links ativos da entrega recém-registrada: permite revogar (o código nunca é exibido de novo).
export function ActiveLinks({ employeeId, deliveryId, tenantKey, refreshKey }: { employeeId: string; deliveryId?: string; tenantKey: string; refreshKey: number }) {
  const [links, setLinks] = useState<SignatureRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toRevoke, setToRevoke] = useState<SignatureRequest | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const busy = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  async function load() {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    setDone(null);
    try {
      const r = await epiApi.listSignatureRequests(employeeId);
      if (aliveRef.current) setLinks(r.filter((x) => x.status === 'ativa' && (!deliveryId || x.delivery_ids.includes(deliveryId))));
    } catch (e) {
      if (aliveRef.current) setError(mapEpiError(e));
    } finally {
      busy.current = false;
      if (aliveRef.current) setLoading(false);
    }
  }

  // Um link novo foi gerado: a lista mostrada passa a refletir o servidor sem o usuário precisar consultar de novo.
  useEffect(() => { if (refreshKey > 0) void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  async function revoke() {
    if (!toRevoke || busy.current) return;
    busy.current = true;
    setRevoking(true);
    setError(null);
    try {
      await epiApi.revokeSignatureRequest(toRevoke.id);
      if (aliveRef.current) {
        setLinks((l) => (l ?? []).filter((x) => x.id !== toRevoke.id));
        setDone('Link revogado.');
        setToRevoke(null);
      }
    } catch (e) {
      if (aliveRef.current) setError(mapEpiError(e));
    } finally {
      busy.current = false;
      if (aliveRef.current) setRevoking(false);
    }
  }

  return (
    <div data-tenant={tenantKey} className="space-y-2">
      <button type="button" aria-disabled={loading} className={BTN_SECONDARY} onClick={load}>{loading ? 'Consultando...' : deliveryId ? 'Ver links ativos desta entrega' : 'Ver links ativos do funcionário'}</button>
      <div aria-live="polite">
        {done && <p role="status" className="text-base text-dash-status-ok-text">{done}</p>}
        {error && !toRevoke && <p role="alert" className="text-base text-dash-status-crit-text">{error}</p>}
        {links && links.length === 0 && !done && <p className="text-base text-dash-muted">Nenhum link ativo.</p>}
      </div>
      {links && links.length > 0 && (
        <ul className="space-y-2">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-base text-dash-primary">
              <span>Link ativo, expira em {formatDateTime(l.expires_at)}</span>
              <button type="button" className={BTN_SECONDARY} onClick={() => { setError(null); setToRevoke(l); }}>Revogar link</button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={toRevoke !== null}
        title="Revogar o link de assinatura?"
        description="O funcionário não conseguirá mais assinar por este link. Você poderá gerar outro."
        confirmLabel="Revogar link"
        destructive
        busy={revoking}
        onConfirm={revoke}
        onCancel={() => setToRevoke(null)}
      >
        {error && <p role="alert" className="text-base text-dash-status-crit-text">{error}</p>}
      </ConfirmDialog>
    </div>
  );
}
