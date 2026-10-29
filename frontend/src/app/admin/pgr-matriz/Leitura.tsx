'use client';

import { useState } from 'react';
import { AdminApiError, adminSend } from '@/components/admin/api';
import { DialogoAcao } from './Acao';
import { Previa } from './Previa';
import { BASE_MATRIZ, NAO_INFORMADO, configParaForm, dataBr, usuarioAbreviado, type VersaoDetalhe } from './tipos';

const v = (s: string) => (s.trim() === '' ? NAO_INFORMADO : s);

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-brand-700">{rotulo}</dt>
      <dd className="break-words text-sm text-brand-900">{children}</dd>
    </div>
  );
}

// Versão publicada ou arquivada: somente leitura. Mudar = duplicar (nova versão em rascunho).
export function Leitura({ versao, onDuplicada, onMudou }: { versao: VersaoDetalhe; onDuplicada: (id: string) => void; onMudou: () => void }) {
  const f = configParaForm(versao.config);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [arquivando, setArquivando] = useState(false);

  async function duplicar() {
    if (ocupado) return;
    setOcupado(true); setErro('');
    try {
      const r = await adminSend<{ id: string }>('POST', BASE_MATRIZ, { copiar_de: versao.id });
      onDuplicada(r.id);
    } catch (e) {
      setErro(e instanceof AdminApiError || e instanceof Error ? e.message : 'Não foi possível concluir a ação. Tente novamente.');
      setOcupado(false);
    }
  }

  const m = f.metodologia;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-brand-700">
        {versao.status === 'publicada' ? 'Versão publicada: não pode ser alterada. Para mudar, duplique e publique uma nova versão.' : 'Versão arquivada: somente leitura.'}
      </p>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Linha rotulo="Hash (SHA-256)">{versao.config_sha256 ?? NAO_INFORMADO}</Linha>
        <Linha rotulo="Publicada por">{usuarioAbreviado(versao.published_by)}</Linha>
        <Linha rotulo="Publicada em">{dataBr(versao.published_at)}</Linha>
        <Linha rotulo="Criada em">{dataBr(versao.created_at)}</Linha>
        <Linha rotulo="Observações da versão">{v(versao.notes ?? '')}</Linha>
      </dl>

      {(['severidade', 'probabilidade'] as const).map((k) => (
        <section key={k} aria-labelledby={`leitura-${k}`}>
          <h4 id={`leitura-${k}`} className="text-sm font-semibold text-brand-900">Escala de {k}</h4>
          <div className="mt-2 overflow-x-auto">
            <table className="adm-table">
              <thead><tr><th scope="col">Valor</th><th scope="col">Rótulo</th><th scope="col">Descrição</th></tr></thead>
              <tbody>
                {f[k].map((it, i) => (
                  <tr key={i}><td>{it.valor}</td><td>{v(it.rotulo)}</td><td>{v(it.descricao)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section aria-labelledby="leitura-niveis">
        <h4 id="leitura-niveis" className="text-sm font-semibold text-brand-900">Níveis de risco</h4>
        <div className="mt-2 overflow-x-auto">
          <table className="adm-table">
            <thead><tr><th scope="col">Id</th><th scope="col">Rótulo</th><th scope="col">Aceitabilidade</th><th scope="col">Decisão</th><th scope="col">Bloqueia emissão</th></tr></thead>
            <tbody>
              {f.niveis.map((n, i) => (
                <tr key={i}>
                  <td>{n.id}</td><td>{v(n.rotulo)}</td><td>{v(n.aceitabilidade)}</td><td>{v(n.decisao)}</td>
                  <td>{n.bloqueia === 'sim' ? 'Sim' : n.bloqueia === 'nao' ? 'Não' : NAO_INFORMADO}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="leitura-faixas">
        <h4 id="leitura-faixas" className="text-sm font-semibold text-brand-900">Faixas de escore</h4>
        <div className="mt-2 overflow-x-auto">
          <table className="adm-table">
            <thead><tr><th scope="col">Mínimo</th><th scope="col">Máximo</th><th scope="col">Id do nível</th></tr></thead>
            <tbody>{f.faixas.map((x, i) => <tr key={i}><td>{x.min}</td><td>{x.max}</td><td>{x.nivel_id}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="leitura-metodologia">
        <h4 id="leitura-metodologia" className="text-sm font-semibold text-brand-900">Metodologia</h4>
        <dl className="mt-2 grid gap-3 sm:grid-cols-2">
          <Linha rotulo="Fórmula">{v(m.formula)}</Linha>
          <Linha rotulo="Validada por">{v(m.validada_por)}</Linha>
          <Linha rotulo="Registro">{v(m.registro)}</Linha>
          <Linha rotulo="Data da validação">{v(m.data)}</Linha>
          <Linha rotulo="Observações da metodologia">{v(m.observacoes)}</Linha>
        </dl>
      </section>

      <Previa form={f} />

      {erro && <p role="alert" className="text-sm text-adm-status-crit-text">{erro}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="adm-btn adm-btn-primary disabled:opacity-50" disabled={ocupado} onClick={duplicar}>
          {ocupado ? 'Duplicando…' : 'Duplicar versão'}
        </button>
        {versao.status === 'publicada' && (
          <button type="button" className="adm-btn adm-btn-danger disabled:opacity-50" disabled={ocupado} onClick={() => setArquivando(true)}>
            Arquivar versão
          </button>
        )}
      </div>

      {arquivando && (
        <DialogoAcao
          titulo={`Arquivar versão ${versao.version_number}`}
          texto="A versão arquivada deixa de ser a vigente e continua disponível somente para consulta. Avaliações já feitas com ela não mudam."
          rotuloConfirmar="Confirmar arquivamento"
          perigo
          executar={async () => { await adminSend('POST', `${BASE_MATRIZ}/${versao.id}/arquivar`); onMudou(); }}
          onFechar={() => setArquivando(false)}
        />
      )}
    </div>
  );
}
