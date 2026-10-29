'use client';

import { useState } from 'react';
import { adminSend } from '@/components/admin/api';
import { Card, CardEmpty } from '@/components/admin/Card';
import { BASE_MATRIZ, NAO_INFORMADO, TEXTO_VAZIO_MATRIZ, dataBr, hashAbreviado, usuarioAbreviado, type StatusMatriz, type VersaoResumo } from './tipos';

const STATUS_ROTULO: Record<StatusMatriz, string> = { rascunho: 'Rascunho', publicada: 'Publicada', arquivada: 'Arquivada' };

// Lista de versões + criação de rascunho (em branco ou copiando outra versão).
export function ListaVersoes({ versoes, selecionada, onAbrir, onCriada }: {
  versoes: VersaoResumo[]; selecionada: string | null; onAbrir: (id: string) => void; onCriada: (id: string) => void;
}) {
  const [copiarDe, setCopiarDe] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  async function criar() {
    if (ocupado) return;
    setOcupado(true); setErro('');
    try {
      const r = await adminSend<{ id: string }>('POST', BASE_MATRIZ, copiarDe ? { copiar_de: copiarDe } : {});
      onCriada(r.id);
      setCopiarDe('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar o rascunho.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card id="versoes" title="Versões da matriz" subtitle="Uma versão publicada não pode ser alterada; para mudar, crie uma nova versão." className="mt-6">
      {versoes.length === 0 ? (
        <CardEmpty>{TEXTO_VAZIO_MATRIZ}</CardEmpty>
      ) : (
        <div className="overflow-x-auto">
          <table className="adm-table">
            <caption className="sr-only">Versões da matriz de risco, da mais nova para a mais antiga</caption>
            <thead>
              <tr>
                <th scope="col">Versão</th><th scope="col">Status</th><th scope="col">Hash</th>
                <th scope="col">Publicada por</th><th scope="col">Publicada em</th><th scope="col"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {versoes.map((v) => (
                <tr key={v.id} aria-current={v.id === selecionada ? 'true' : undefined}>
                  <td className="text-brand-900">{v.version_number}</td>
                  <td className="text-brand-900">{STATUS_ROTULO[v.status]}</td>
                  <td className="font-mono text-brand-700" title={v.config_sha256 ?? undefined}>{hashAbreviado(v.config_sha256)}</td>
                  <td className="text-brand-700">{v.published_by ? usuarioAbreviado(v.published_by) : NAO_INFORMADO}</td>
                  <td className="text-brand-700">{dataBr(v.published_at)}</td>
                  <td>
                    <button type="button" className="adm-link whitespace-nowrap" aria-label={`Abrir versão ${v.version_number}`} onClick={() => onAbrir(v.id)}>
                      {v.id === selecionada ? 'Aberta' : 'Abrir'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void criar(); }}>
        <label className="flex min-w-0 flex-col gap-1 text-sm text-brand-900">
          Copiar de
          <select className="adm-input" value={copiarDe} disabled={ocupado} onChange={(e) => setCopiarDe(e.target.value)}>
            <option value="">Nenhuma (em branco)</option>
            {versoes.map((v) => <option key={v.id} value={v.id}>Versão {v.version_number} — {STATUS_ROTULO[v.status]}</option>)}
          </select>
        </label>
        <button type="submit" className="adm-btn adm-btn-primary disabled:opacity-50" disabled={ocupado}>
          {ocupado ? 'Criando…' : 'Criar rascunho'}
        </button>
      </form>
      {erro && <p role="alert" className="mt-3 text-sm text-adm-status-crit-text">{erro}</p>}
    </Card>
  );
}
