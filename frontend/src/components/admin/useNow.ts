'use client';

import { useEffect, useState } from 'react';

// Relógio que re-renderiza a cada `intervalMs` — para textos "há X min" não ficarem congelados.
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
