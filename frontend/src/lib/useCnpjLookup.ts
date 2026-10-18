'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CnpjData, lookupCnpj } from './cnpj';

export type CnpjLookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; data: CnpjData }
  | { status: 'erro'; message: string };

// Garante que só a ÚLTIMA consulta aplica resultado: cada chamada aborta a
// anterior e carrega um número de sequência; resposta de sequência velha (ou
// de componente já desmontado) é descartada. Reconsultar o mesmo CNPJ já
// aplicado não dispara nova chamada.
export function useCnpjLookup(onResult: (data: CnpjData) => void) {
  const [state, setState] = useState<CnpjLookupState>({ status: 'idle' });
  const seq = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const lastApplied = useRef<string | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => () => {
    seq.current += 1;
    controller.current?.abort();
  }, []);

  const lookup = useCallback(async (rawCnpj: string, force = false) => {
    const digits = rawCnpj.replace(/\D/g, '');
    if (!digits) {
      seq.current += 1;
      controller.current?.abort();
      setState({ status: 'idle' });
      return;
    }
    if (!force && lastApplied.current === digits) return;

    controller.current?.abort();
    const mine = ++seq.current;
    const ctl = new AbortController();
    controller.current = ctl;
    setState({ status: 'loading' });

    const outcome = await lookupCnpj(digits, ctl.signal);
    if (mine !== seq.current) return;
    if (outcome.ok) {
      lastApplied.current = digits;
      setState({ status: 'done', data: outcome.data });
      onResultRef.current(outcome.data);
    } else if (outcome.reason !== 'aborted') {
      setState({ status: 'erro', message: outcome.message });
    }
  }, []);

  return { state, lookup };
}
