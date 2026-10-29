'use client';

import { useEffect, useRef, useState } from 'react';
import { AdminApiError } from '@/components/admin/api';
import { Dialogo } from '../documentos-fluxo/Dialogo';
import { ResultadoValidacao } from './Resultado';

// Diálogo de confirmação de uma ação do servidor (publicar/arquivar). Fica aberto enquanto o servidor recusa,
// mostrando a mensagem e as listas de erros/pendências dele; fecha só no sucesso ou em Cancelar.
export function DialogoAcao({ titulo, texto, rotuloConfirmar, perigo = false, executar, onFechar, onRecarregar, rotuloRecarregar }: {
  titulo: string; texto: string; rotuloConfirmar: string; perigo?: boolean;
  executar: () => Promise<void>; onFechar: () => void; onRecarregar?: () => void; rotuloRecarregar?: string;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [falha, setFalha] = useState<{ mensagem: string; erros: string[]; pendencias: string[] } | null>(null);
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);

  async function confirmar() {
    if (ocupado) return;
    setOcupado(true);
    setFalha(null);
    try {
      await executar();
      if (vivo.current) onFechar();
    } catch (e) {
      const f = e instanceof AdminApiError
        ? { mensagem: e.message, erros: e.erros, pendencias: e.pendencias }
        : { mensagem: e instanceof Error ? e.message : 'Não foi possível concluir a ação. Tente novamente.', erros: [], pendencias: [] };
      if (!vivo.current) return;
      setFalha(f);
      setOcupado(false);
    }
  }

  return (
    <Dialogo titulo={titulo} ocupado={ocupado} onFechar={onFechar}>
      <p className="text-sm text-brand-900">{texto}</p>
      {falha && <div className="mt-3"><ResultadoValidacao mensagem={falha.mensagem} erros={falha.erros} pendencias={falha.pendencias} /></div>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="adm-btn" disabled={ocupado} onClick={onFechar}>Cancelar</button>
        {falha && onRecarregar && <button type="button" className="adm-btn" disabled={ocupado} onClick={onRecarregar}>{rotuloRecarregar ?? 'Recarregar'}</button>}
        <button
          type="button"
          className={`adm-btn ${perigo ? 'adm-btn-danger' : 'adm-btn-primary'} disabled:opacity-50`}
          disabled={ocupado}
          onClick={confirmar}
        >
          {ocupado ? 'Enviando…' : rotuloConfirmar}
        </button>
      </div>
    </Dialogo>
  );
}
