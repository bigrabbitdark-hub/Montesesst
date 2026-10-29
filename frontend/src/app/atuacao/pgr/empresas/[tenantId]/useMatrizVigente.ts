'use client';

import { useCallback, useEffect, useState } from 'react';
import { atuacaoFetch, erroLeituraPgr, MSG_MATRIZ_AGUARDANDO, type MatrizVigente } from '../../../api';

export type MatrizEstado =
  | { status: 'carregando' }
  | { status: 'aguardando' }
  | { status: 'erro'; mensagem: string }
  | { status: 'ok'; matriz: MatrizVigente };

// Matriz vigente (global da Montese). 404 = ainda não há matriz publicada: é um estado esperado, não um erro.
export type MatrizCtx = MatrizEstado & { recarregar: () => void };
// Mensagens do servidor que indicam que a versão usada deixou de ser a vigente (arquivada/não publicada/sem matriz).
export const ehErroDeVersao = (m: string) => /arquivada|não foi publicada|não está publicada|Aguardando matriz publicada|matriz vigente mudou/.test(m);

export function useMatrizVigente(): MatrizCtx {
  const [estado, setEstado] = useState<MatrizEstado>({ status: 'carregando' });
  const [tick, setTick] = useState(0);
  const recarregar = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let vivo = true;
    atuacaoFetch<MatrizVigente>('/pgr/matriz/vigente')
      .then((matriz) => { if (vivo) setEstado({ status: 'ok', matriz }); })
      .catch((e) => {
        if (!vivo) return;
        const m = erroLeituraPgr(e);
        setEstado(m === MSG_MATRIZ_AGUARDANDO ? { status: 'aguardando' } : { status: 'erro', mensagem: m });
      });
    return () => { vivo = false; };
  }, [tick]);
  return { ...estado, recarregar };
}

export const rotuloEscala = (l: Array<{ valor: number; rotulo: string }>, v: number) => l.find((x) => x.valor === v)?.rotulo;
