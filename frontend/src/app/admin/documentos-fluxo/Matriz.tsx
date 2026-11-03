'use client';

import { useRef, useState } from 'react';
import { AsyncBody, CardEmpty, CardError, CardSkeleton } from '@/components/admin/Card';
import { adminSend } from '@/components/admin/api';
import { useAdminFetch, type FetchState } from '@/components/admin/useAdminFetch';
import { DOC_CATEGORIA_LABEL, DOC_CATEGORIAS } from '@/app/atuacao/api';
import { Dialogo } from './Dialogo';
import { ACAO_LABEL, BASE_DOCUMENTOS, DOC_ACOES, TEXTO_MATRIZ, type DocAcao, type LinhaMatriz, type Socio } from './tipos';

type Marcadas = Record<string, DocAcao[]>;

// Seletor de categoria + tabela sócios × ações. Nenhuma linha vem pré-marcada: o que está marcado é
// exatamente o que o servidor devolveu. Gravar sempre passa pelo diálogo de confirmação.
export function MatrizResponsabilidades({ socios, onSalvo }: { socios: FetchState<Socio[]>; onSalvo: () => void }) {
  const [category, setCategory] = useState<string>(DOC_CATEGORIAS[0]);
  const [mensagem, setMensagem] = useState('');

  return (
    <div>
      <label className="flex max-w-sm flex-col gap-1 text-sm text-brand-900">
        Tipo de documento
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); setMensagem(''); }}
          className="adm-input"
        >
          {DOC_CATEGORIAS.map((c) => <option key={c} value={c}>{DOC_CATEGORIA_LABEL[c]}</option>)}
        </select>
      </label>

      {mensagem && <p role="status" className="mt-3 text-sm text-adm-status-ok-text">{mensagem}</p>}

      <div className="mt-3">
        {socios.data ? (
          // key: ao trocar de categoria o bloco é recriado, então nunca mostra dados de outra categoria.
          <MatrizDaCategoria key={category} category={category} socios={socios.data} setMensagem={setMensagem} onSalvo={onSalvo} />
        ) : socios.error ? (
          <CardError onRetry={socios.reload} message="Não foi possível carregar os sócios." />
        ) : (
          <CardSkeleton rows={3} />
        )}
      </div>
    </div>
  );
}

function MatrizDaCategoria({ category, socios, setMensagem, onSalvo }: {
  category: string; socios: Socio[]; setMensagem: (m: string) => void; onSalvo: () => void;
}) {
  const matriz = useAdminFetch<LinhaMatriz[]>(`${BASE_DOCUMENTOS}/matriz?category=${encodeURIComponent(category)}`);
  if (socios.length === 0) return <CardEmpty>Nenhum sócio cadastrado.</CardEmpty>;
  return (
    <AsyncBody state={matriz} rows={4}>
      {(linhas) => (
        <Tabela category={category} socios={socios} linhas={linhas} setMensagem={setMensagem} onSalvo={onSalvo} />
      )}
    </AsyncBody>
  );
}

function Tabela({ category, socios, linhas, setMensagem, onSalvo }: {
  category: string; socios: Socio[]; linhas: LinhaMatriz[]; setMensagem: (m: string) => void; onSalvo: () => void;
}) {
  const [marcadas, setMarcadas] = useState<Marcadas>(() =>
    Object.fromEntries(socios.map((s) => [s.id, linhas.find((l) => l.user_id === s.id)?.acoes ?? []])),
  );
  const [alvo, setAlvo] = useState<Socio | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const emVoo = useRef(false);
  const nomeCategoria = DOC_CATEGORIA_LABEL[category] ?? category;

  function alternar(userId: string, acao: DocAcao) {
    setMarcadas((m) => {
      const atual = m[userId] ?? [];
      return { ...m, [userId]: atual.includes(acao) ? atual.filter((a) => a !== acao) : [...atual, acao] };
    });
  }
  const ordenadas = (userId: string) => DOC_ACOES.filter((a) => (marcadas[userId] ?? []).includes(a));

  function abrir(s: Socio) { setErro(''); setMensagem(''); setAlvo(s); }

  async function gravar() {
    if (!alvo || emVoo.current) return;
    emVoo.current = true;
    setOcupado(true);
    setErro('');
    try {
      await adminSend('PUT', `${BASE_DOCUMENTOS}/matriz/${encodeURIComponent(category)}/usuarios/${encodeURIComponent(alvo.id)}`, { acoes: ordenadas(alvo.id) });
      setMensagem(`Responsabilidades de ${alvo.nome} salvas para ${nomeCategoria}.`);
      setAlvo(null);
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir a ação. Tente novamente.');
    } finally {
      emVoo.current = false;
      setOcupado(false);
    }
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="adm-table">
          <caption className="sr-only">Responsabilidades por sócio em {nomeCategoria}</caption>
          <thead>
            <tr>
              <th scope="col">Sócio</th>
              {DOC_ACOES.map((a) => <th key={a} scope="col">{ACAO_LABEL[a]}</th>)}
              <th scope="col"><span className="sr-only">Gravar</span></th>
            </tr>
          </thead>
          <tbody>
            {socios.map((s) => (
              <tr key={s.id}>
                <th scope="row" className="text-left font-medium text-brand-900">{s.nome}</th>
                {DOC_ACOES.map((a) => (
                  <td key={a} className="text-brand-900">
                    <input
                      type="checkbox"
                      aria-label={`${ACAO_LABEL[a]}: ${s.nome}`}
                      checked={(marcadas[s.id] ?? []).includes(a)}
                      onChange={() => alternar(s.id, a)}
                    />
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    aria-label={`Salvar responsabilidades de ${s.nome}`}
                    onClick={() => abrir(s)}
                    className="adm-link whitespace-nowrap"
                  >
                    Salvar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {alvo && (
        <Dialogo titulo="Confirmar responsabilidades" ocupado={ocupado} onFechar={() => setAlvo(null)}>
          <p className="text-sm text-brand-900">
            {alvo.nome} — {nomeCategoria}:{' '}
            {ordenadas(alvo.id).length ? ordenadas(alvo.id).map((a) => ACAO_LABEL[a]).join(', ') : 'nenhuma ação (remove todas as habilitações)'}.
          </p>
          <p className="mt-3 text-sm text-brand-900">{TEXTO_MATRIZ}</p>
          {erro && <p role="alert" className="mt-3 text-sm text-adm-status-crit-text">{erro}</p>}
          <div className="mt-4 flex flex-wrap justify-end gap-3">
            <button type="button" onClick={() => setAlvo(null)} disabled={ocupado} className="adm-btn disabled:opacity-50">
              Cancelar
            </button>
            <button type="button" onClick={gravar} disabled={ocupado} className="adm-btn adm-btn-primary disabled:opacity-50">
              {ocupado ? 'Salvando...' : 'Confirmar e salvar'}
            </button>
          </div>
        </Dialogo>
      )}
    </>
  );
}
