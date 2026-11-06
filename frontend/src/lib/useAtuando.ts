'use client';

import { useSyncExternalStore } from 'react';
import { ACTING_EVENT, getActing } from '@/lib/acting';

function subscribe(cb: () => void): () => void {
  window.addEventListener('storage', cb); // outras abas
  window.addEventListener(ACTING_EVENT, cb); // startActing/stopActing nesta aba
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener(ACTING_EVENT, cb);
  };
}

// Modo atuação lido de localStorage. Servidor/hidratação = `null` (ainda não sabemos); numa montagem só no cliente o
// valor real vem já no primeiro render (sem piscar). Duas regras de uso:
//  - MOSTRAR/ESCONDER botão ou link: `atuando !== true` (null mostra, como a empresa comum);
//  - montar algo que BUSCA dados (rota que a sócia não pode chamar): `atuando === false`.
export function useAtuando(): boolean | null {
  return useSyncExternalStore<boolean | null>(subscribe, () => getActing() !== null, () => null);
}
