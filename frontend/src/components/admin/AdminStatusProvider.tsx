'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { adminFetch } from './api';
import type { Slice } from './status-state';
import type { AlertasResponse, SystemStatus } from './types';

const POLL_MS = 60_000;

interface AdminStatusValue {
  system: Slice<SystemStatus>;
  alertas: Slice<AlertasResponse>;
  lastUpdated: number | null;
  refresh: () => void;
}

const AdminStatusContext = createContext<AdminStatusValue | null>(null);

export function useAdminStatus(): AdminStatusValue {
  const value = useContext(AdminStatusContext);
  if (!value) throw new Error('useAdminStatus precisa estar dentro de <AdminStatusProvider>');
  return value;
}

// Busca /system-status e /alertas uma vez para o shell inteiro (topbar e
// cards leem daqui). Polling de 60 s, pausado quando a aba está oculta.
export function AdminStatusProvider({ children }: { children: ReactNode }) {
  const [system, setSystem] = useState<Slice<SystemStatus>>({ data: null, error: false });
  const [alertas, setAlertas] = useState<Slice<AlertasResponse>>({ data: null, error: false });
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [s, a] = await Promise.allSettled([
      adminFetch<SystemStatus>('/api/system-status'),
      adminFetch<AlertasResponse>('/api/admin/dashboard/alertas'),
    ]);
    setSystem((prev) =>
      s.status === 'fulfilled' ? { data: s.value, error: false } : { data: prev.data, error: true },
    );
    setAlertas((prev) =>
      a.status === 'fulfilled' ? { data: a.value, error: false } : { data: prev.data, error: true },
    );
    setLastUpdated(Date.now());
  }, []);

  useEffect(() => {
    void load();
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => void load(), POLL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        void load();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  const value = useMemo<AdminStatusValue>(
    () => ({ system, alertas, lastUpdated, refresh: () => void load() }),
    [system, alertas, lastUpdated, load],
  );

  return <AdminStatusContext.Provider value={value}>{children}</AdminStatusContext.Provider>;
}
