'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CargoEmpresa, Ghe } from '../../../api';
import { BTN, BTN_PRIMARY, ERRO, LINK } from '../../estilos';

// Seleção múltipla dos cargos da empresa para um GHE. Salva o conjunto completo (PUT substitui); o servidor valida.
export function CargosGhe({ tenantId, ghe, cargos, erroCargos, ocupado, onSalvar }: {
  tenantId: string; ghe: Ghe; cargos: CargoEmpresa[] | null; erroCargos: string | null; ocupado: boolean;
  onSalvar: (ids: string[]) => Promise<boolean>;
}) {
  const [aberto, setAberto] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  if (!aberto) {
    return (
      <button type="button" className={`mt-2 ${BTN}`} disabled={ocupado} aria-label={`Vincular cargos ao GHE ${ghe.name}`}
        onClick={() => { setSel(ghe.positions.map((p) => p.id)); setAberto(true); }}>
        Vincular cargos
      </button>
    );
  }
  return (
    <fieldset className="mt-2 rounded-md border border-dash-border-input p-3" disabled={ocupado}>
      <legend className="px-1 text-sm font-semibold text-dash-primary">Cargos do GHE {ghe.name}</legend>
      {erroCargos && <p role="alert" className={ERRO}>{erroCargos}</p>}
      {!erroCargos && cargos === null && <p role="status" className="text-sm text-dash-muted">Carregando cargos…</p>}
      {cargos !== null && cargos.length === 0 && (
        <p className="text-sm text-dash-muted">
          A empresa ainda não tem cargos cadastrados. <Link href={`/atuacao/clientes/${tenantId}`} className={LINK}>Ir ao cadastro do cliente</Link>
        </p>
      )}
      {cargos !== null && cargos.length > 0 && (
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {cargos.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={sel.includes(c.id)} onChange={(e) => setSel(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))} />
                <span>{c.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={ocupado || cargos === null || cargos.length === 0}
          onClick={async () => { if (await onSalvar(sel)) setAberto(false); }}>
          {ocupado ? 'Salvando…' : 'Salvar cargos'}
        </button>
        <button type="button" className={BTN} onClick={() => setAberto(false)}>Cancelar</button>
      </div>
    </fieldset>
  );
}
