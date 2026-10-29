'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminApiError, adminFetch } from './api';

export const ERRO_CARREGAR_PADRAO = 'Não foi possível carregar.';

export interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

// Busca um endpoint do admin. `path = null` não busca (útil para condicionar).
// `refreshKey` força nova busca quando muda (botão "Atualizar" da página).
// Mantém o dado anterior enquanto recarrega — o card não pisca.
export function useAdminFetch<T>(path: string | null, refreshKey = 0): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    setLoading(true);
    adminFetch<T>(path)
      .then((json) => {
        if (cancelled) return;
        setData(json);
        setError(null);
      })
      .catch((e) => {
        // 403/404 com mensagem do servidor: mostra a mensagem dele; os demais erros seguem genéricos.
        const especifico = e instanceof AdminApiError && e.doServidor && (e.status === 403 || e.status === 404);
        if (!cancelled) setError(especifico ? e.message : ERRO_CARREGAR_PADRAO);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, refreshKey, tick]);

  return { data, error, loading, reload };
}
