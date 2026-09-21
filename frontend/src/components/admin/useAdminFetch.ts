'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from './api';

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
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar.');
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
