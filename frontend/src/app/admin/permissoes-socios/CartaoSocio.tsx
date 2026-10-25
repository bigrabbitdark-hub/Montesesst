'use client';

import { useId, useRef, useState } from 'react';
import { adminSend } from '@/components/admin/api';
import { Dialogo } from '../documentos-fluxo/Dialogo';
import { BASE_PERMISSOES, TEXTO_OBRIGATORIO, TEXTO_SENSIVEL, type GrupoCatalogo, type SocioPermissoes } from './tipos';

// Um cartão por sócio. O estado marcado parte do que o servidor devolveu; a diferença (adicionadas/removidas)
// é sempre calculada contra esse estado carregado. Gravar passa pelo diálogo de confirmação.
export function CartaoSocio({ socio, grupos, onSalvo }: {
  socio: SocioPermissoes; grupos: GrupoCatalogo[]; onSalvo: (mensagem: string) => void;
}) {
  const [marcadas, setMarcadas] = useState<string[]>(socio.permissoes);
  const [aberto, setAberto] = useState(false);
  const [confirmou, setConfirmou] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const emVoo = useRef(false);
  const tituloId = useId();

  const itens = grupos.flatMap((g) => g.itens);
  const rotulo = (p: string) => itens.find((i) => i.permissao === p)?.rotulo ?? p;
  const sensivel = (p: string) => itens.find((i) => i.permissao === p)?.sensivel ?? false;
  // Ordem estável do catálogo; permissões desconhecidas do servidor ficam no fim e são preservadas.
  const ordem = (lista: string[]) => [...lista].sort((a, b) => {
    const ia = itens.findIndex((i) => i.permissao === a);
    const ib = itens.findIndex((i) => i.permissao === b);
    return (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib);
  });
  const adicionadas = ordem(marcadas.filter((p) => !socio.permissoes.includes(p)));
  const removidas = ordem(socio.permissoes.filter((p) => !marcadas.includes(p)));
  const alterado = adicionadas.length > 0 || removidas.length > 0;
  const comSensivel = adicionadas.some(sensivel);

  function alternar(p: string) {
    setMarcadas((m) => (m.includes(p) ? m.filter((x) => x !== p) : [...m, p]));
  }
  function abrir() { setErro(''); setConfirmou(false); setAberto(true); }

  async function gravar() {
    if (emVoo.current || (comSensivel && !confirmou)) return;
    emVoo.current = true;
    setOcupado(true);
    setErro('');
    try {
      await adminSend('PUT', `${BASE_PERMISSOES}/${encodeURIComponent(socio.id)}`, {
        permissoes: ordem(marcadas),
        ...(comSensivel ? { confirmar_sensiveis: true } : {}),
      });
      setAberto(false);
      onSalvo(`Permissões de ${socio.nome} salvas.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir a ação. Tente novamente.');
    } finally {
      emVoo.current = false;
      setOcupado(false);
    }
  }

  return (
    <article aria-labelledby={tituloId} className="adm-card flex min-w-0 flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h4 id={tituloId} className="text-[15px] font-semibold text-brand-900">{socio.nome}</h4>
        {!socio.ativo && <span className="text-xs font-semibold text-adm-status-warn-text">Inativo</span>}
      </div>
      {!socio.ativo && (
        <p className="text-xs text-brand-700">Sócio inativo: só é possível remover permissões.</p>
      )}

      {grupos.map((g) => (
        <fieldset key={g.id} className="min-w-0">
          <legend className="mb-2 text-sm font-semibold text-brand-900">{g.titulo}</legend>
          <ul className="flex flex-col gap-2">
            {g.itens.map((i) => (
              <li key={i.permissao}>
                <label className="adm-card-2 flex cursor-pointer items-start gap-3 px-3 py-2 text-sm text-brand-900 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2">
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0"
                    checked={marcadas.includes(i.permissao)}
                    disabled={!socio.ativo && !socio.permissoes.includes(i.permissao)}
                    onChange={() => alternar(i.permissao)}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{i.rotulo}</span>
                    <span className="block text-xs text-brand-700">{i.descricao}</span>
                    {i.sensivel && <span className="mt-1 block text-xs font-semibold text-adm-status-warn-text">{TEXTO_SENSIVEL}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}

      <div className="flex justify-end">
        <button
          type="button"
          aria-label={`Salvar permissões de ${socio.nome}`}
          disabled={!alterado}
          onClick={abrir}
          className="adm-btn adm-btn-primary disabled:opacity-50"
        >
          Salvar
        </button>
      </div>

      {aberto && (
        <Dialogo titulo={`Confirmar permissões de ${socio.nome}`} ocupado={ocupado} onFechar={() => setAberto(false)}>
          {adicionadas.length > 0 && (
            <div className="text-sm text-brand-900">
              <p className="font-medium">Adicionadas:</p>
              <ul className="list-disc pl-5">{adicionadas.map((p) => <li key={p}>{rotulo(p)}</li>)}</ul>
            </div>
          )}
          {removidas.length > 0 && (
            <div className="mt-3 text-sm text-brand-900">
              <p className="font-medium">Removidas:</p>
              <ul className="list-disc pl-5">{removidas.map((p) => <li key={p}>{rotulo(p)}</li>)}</ul>
            </div>
          )}
          {comSensivel && (
            <>
              <p className="mt-3 text-sm font-medium text-brand-900">{TEXTO_OBRIGATORIO}</p>
              <label className="mt-3 flex items-start gap-2 text-sm text-brand-900">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={confirmou}
                  disabled={ocupado}
                  onChange={(e) => setConfirmou(e.target.checked)}
                />
                <span>Li e confirmo a concessão das permissões sensíveis.</span>
              </label>
            </>
          )}
          {erro && <p role="alert" className="mt-3 text-sm text-adm-status-crit-text">{erro}</p>}
          <div className="mt-4 flex flex-wrap justify-end gap-3">
            <button type="button" onClick={() => setAberto(false)} disabled={ocupado} className="adm-btn disabled:opacity-50">
              Cancelar
            </button>
            <button
              type="button"
              onClick={gravar}
              disabled={ocupado || (comSensivel && !confirmou)}
              className="adm-btn adm-btn-primary disabled:opacity-50"
            >
              {ocupado ? 'Salvando...' : 'Confirmar e salvar'}
            </button>
          </div>
        </Dialogo>
      )}
    </article>
  );
}
