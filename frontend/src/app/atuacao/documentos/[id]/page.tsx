'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { AsyncBody } from '@/components/ui/AsyncBody';
import { Badge } from '@/components/ui/Badge';
import {
  atuacaoFetch, AVISO_LGPD_NOTA, DOC_ACCEPT, DOC_MAX_BYTES, DOC_MAX_MB, DOC_TIPOS_ACEITOS, docCategoriaLabel, docEventoLabel,
  docStatusLabel, docStatusTone, formatDataHora, formatTamanho, hashAbreviado,
  type DocAcaoNome, type DocAssinatura, type DocumentoDetalhe, type DocVersao,
} from '../../api';
import { Dialogo } from './Dialogo';

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const LINK =
  'font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 rounded';
const BTN =
  'rounded-md bg-dash-primary px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 disabled:opacity-60';
const BTN_SEC =
  'rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm font-semibold text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary disabled:opacity-60';
const LABEL = 'mb-1 block text-sm font-medium text-dash-muted';

// Rótulos dos botões (só apresentação). Quem decide quais aparecem é `acoes_permitidas`, vinda do servidor.
const ACAO_BOTAO: Record<DocAcaoNome, string> = {
  nova_versao: 'Nova versão', enviar_revisao: 'Enviar para revisão', devolver: 'Devolver para elaboração',
  aprovar: 'Aprovar', assinar: 'Registrar assinatura interna', publicar: 'Publicar', cancelar: 'Cancelar documento',
};
const ACAO_OK: Record<DocAcaoNome, string> = {
  nova_versao: 'Nova versão enviada.', enviar_revisao: 'Documento enviado para revisão.',
  devolver: 'Documento devolvido para elaboração.', aprovar: 'Documento aprovado.',
  assinar: 'Assinatura interna registrada.', publicar: 'Documento publicado.', cancelar: 'Documento cancelado.',
};
const ROTA: Record<Exclude<DocAcaoNome, 'nova_versao'>, string> = {
  enviar_revisao: 'enviar-revisao', devolver: 'devolver', aprovar: 'aprovar', assinar: 'assinar',
  publicar: 'publicar', cancelar: 'cancelar',
};
const COM_DIALOGO: readonly DocAcaoNome[] = ['nova_versao', 'devolver', 'assinar', 'publicar', 'cancelar'];

function Secao({ id, titulo, children }: { id: string; titulo: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-[18px] bg-dash-card p-6 shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
      <h3 id={id} className="mb-4 text-base font-semibold text-dash-primary">{titulo}</h3>
      {children}
    </section>
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <p role="note" className="rounded-md border border-dash-status-warn-text bg-dash-status-warn-bg p-3 text-sm font-medium text-dash-status-warn-text">
      {texto}
    </p>
  );
}

function Hash({ hash, rotulo }: { hash: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { /* sem permissão de área de transferência: o valor completo continua legível */ }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span aria-hidden="true" title={hash} className="font-mono text-xs">{hashAbreviado(hash)}</span>
      <span className="sr-only">SHA-256 completo: {hash}</span>
      <button type="button" onClick={copiar} aria-label={`Copiar hash ${rotulo}`} className={`${BTN_SEC} !px-2 !py-0.5 !text-xs`}>
        {copiado ? 'Copiado' : 'Copiar'}
      </button>
    </span>
  );
}

function Versoes({ versoes, atualId, baixando, onBaixar }: {
  versoes: DocVersao[]; atualId: string | null; baixando: string | null; onBaixar: (v: DocVersao) => void;
}) {
  if (versoes.length === 0) return <p className="text-sm text-dash-muted">Nenhuma versão enviada.</p>;
  return (
    <ol aria-label="Versões" className="flex flex-col gap-3">
      {versoes.map((v) => (
        <li key={v.id} className="rounded-md border border-dash-border-input p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-dash-primary">
              Versão {v.version_number}{v.id === atualId && <span className="ml-2"><Badge tone="info">Atual</Badge></span>}
            </p>
            <button type="button" disabled={baixando === v.id} onClick={() => onBaixar(v)} aria-label={`Baixar versão ${v.version_number}`} className={BTN_SEC}>
              {baixando === v.id ? 'Abrindo…' : 'Baixar'}
            </button>
          </div>
          <p className="mt-1 break-words text-dash-primary">{v.file_name} · {formatTamanho(v.size_bytes)}</p>
          <p className="mt-1 text-xs text-dash-muted">
            de {v.created_by_name ?? 'autor não identificado'} · {formatDataHora(v.created_at)}
          </p>
          <p className="mt-1 text-xs text-dash-muted">SHA-256: <Hash hash={v.sha256} rotulo={`da versão ${v.version_number}`} /></p>
          {v.note && <p className="mt-1 whitespace-pre-wrap break-words text-dash-primary">{v.note}</p>}
        </li>
      ))}
    </ol>
  );
}

function Assinaturas({ lista, aviso }: { lista: DocAssinatura[]; aviso: string }) {
  return (
    <section aria-labelledby="sec-assinaturas" className="rounded-[18px] bg-dash-card p-6 shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
      <h3 id="sec-assinaturas" className="mb-4 text-base font-semibold text-dash-primary">Assinaturas internas registradas</h3>
      <Aviso texto={aviso} />
      {lista.length === 0 ? (
        <p className="mt-4 text-sm text-dash-muted">Nenhuma assinatura interna registrada.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {lista.map((a) => (
            <li key={a.id} className="rounded-md border border-dash-border-input p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-dash-primary">{a.signer_name ?? 'Signatário não identificado'}</p>
                <Badge tone={a.vigente ? 'ok' : 'high'}>{a.vigente ? 'vigente' : 'não vigente (versão substituída)'}</Badge>
              </div>
              <p className="mt-1 text-xs text-dash-muted">Versão {a.version_number} · {formatDataHora(a.signed_at)}</p>
              <p className="mt-1 text-xs text-dash-muted">SHA-256: <Hash hash={a.version_sha256} rotulo={`da assinatura de ${a.signer_name ?? 'signatário'}`} /></p>
              <p className="mt-1 text-dash-primary">
                Registro profissional confirmado: {a.registro_confirmado ? 'sim' : 'não'}
                {a.council && a.registration_number && a.uf ? ` — ${a.council} ${a.registration_number}/${a.uf}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Dlg = Extract<DocAcaoNome, 'nova_versao' | 'devolver' | 'assinar' | 'publicar' | 'cancelar'>;

function DialogoAcao({ acao, aviso, enviando, erro, onEnviar, onFechar }: {
  acao: Dlg; aviso: string; enviando: boolean; erro: string | null;
  onEnviar: (dados: { note?: string; expires_at?: string; file?: File }) => void; onFechar: () => void;
}) {
  const [nota, setNota] = useState('');
  const [validade, setValidade] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const notaObrigatoria = acao === 'devolver' || acao === 'cancelar';
  const comNota = notaObrigatoria || acao === 'nova_versao';

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setErroLocal(null);
    if (notaObrigatoria && !nota.trim()) { setErroLocal('Informe a nota.'); return; }
    if (acao === 'nova_versao') {
      if (!arquivo) { setErroLocal('Selecione um arquivo.'); return; }
      if (!DOC_TIPOS_ACEITOS.includes(arquivo.type)) { setErroLocal('Tipo de arquivo não aceito. Use PDF, JPEG, PNG, DOCX ou XLSX.'); return; }
      if (arquivo.size > DOC_MAX_BYTES) { setErroLocal(`O arquivo excede o limite de ${DOC_MAX_MB} MB.`); return; }
    }
    onEnviar({ note: nota.trim() || undefined, expires_at: validade || undefined, file: arquivo ?? undefined });
  }

  const mensagem = erroLocal ?? erro;
  return (
    <Dialogo titulo={ACAO_BOTAO[acao]} onFechar={onFechar} ocupado={enviando}>
      <form onSubmit={enviar} noValidate>
        {acao === 'assinar' && <Aviso texto={aviso} />}
        {acao === 'nova_versao' && (
          <div className="mb-3">
            <label htmlFor="dlg-arquivo" className={LABEL}>Arquivo (PDF, JPEG, PNG, DOCX ou XLSX, até {DOC_MAX_MB} MB)</label>
            <input id="dlg-arquivo" type="file" accept={DOC_ACCEPT} onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} className={INPUT} />
          </div>
        )}
        {acao === 'publicar' && (
          <div className="mb-3">
            <label htmlFor="dlg-validade" className={LABEL}>Vencimento (opcional)</label>
            <input id="dlg-validade" type="date" value={validade} onChange={(e) => setValidade(e.target.value)} className={INPUT} />
          </div>
        )}
        {comNota && (
          <div className="mb-3">
            <label htmlFor="dlg-nota" className={LABEL}>Nota{notaObrigatoria ? ' (obrigatória)' : ' (opcional)'}</label>
            <textarea id="dlg-nota" rows={3} maxLength={1000} value={nota} onChange={(e) => setNota(e.target.value)} aria-describedby="dlg-lgpd" className={INPUT} />
            <p id="dlg-lgpd" className="mt-1 text-xs text-dash-muted">{AVISO_LGPD_NOTA}</p>
          </div>
        )}
        {mensagem && <p role="alert" className="mb-3 text-sm text-dash-status-crit-text">{mensagem}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onFechar} disabled={enviando} className={BTN_SEC}>Fechar</button>
          <button type="submit" disabled={enviando} className={BTN}>
            {enviando ? 'Enviando…' : acao === 'nova_versao' ? 'Enviar' : 'Confirmar'}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}

export default function DocumentoDetalhePage() {
  const { id } = useParams<{ id: string }>();
  const [doc, setDoc] = useState<DocumentoDetalhe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogo, setDialogo] = useState<Dlg | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  const [baixando, setBaixando] = useState<string | null>(null);
  const ultima = useRef(0);
  const emVoo = useRef(false);

  const carregar = useCallback((silencioso = false) => {
    const n = ++ultima.current;
    if (!silencioso) setLoading(true);
    setError(null);
    return atuacaoFetch<DocumentoDetalhe>(`/documentos/${id}`)
      .then((d) => { if (n === ultima.current) setDoc(d); })
      .catch((e: Error) => { if (n === ultima.current) setError(e.message); })
      .finally(() => { if (n === ultima.current) setLoading(false); });
  }, [id]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function executar(acao: DocAcaoNome, dados: { note?: string; expires_at?: string; file?: File } = {}) {
    if (emVoo.current) return;
    emVoo.current = true;
    setEnviando(true);
    setErroAcao(null);
    setAviso('');
    try {
      if (acao === 'nova_versao') {
        const form = new FormData();
        form.append('file', dados.file as File);
        if (dados.note) form.append('note', dados.note);
        await atuacaoFetch(`/documentos/${id}/versoes`, { method: 'POST', body: form });
      } else {
        const corpo: Record<string, string> = {};
        if (acao === 'devolver' || acao === 'cancelar') corpo.note = dados.note ?? '';
        if (acao === 'publicar' && dados.expires_at) corpo.expires_at = dados.expires_at;
        await atuacaoFetch(`/documentos/${id}/${ROTA[acao]}`, {
          method: 'POST', ...(Object.keys(corpo).length ? { body: JSON.stringify(corpo) } : {}),
        });
      }
      setDialogo(null);
      setAviso(ACAO_OK[acao]);
      await carregar(true);
    } catch (err) {
      setErroAcao((err as Error).message);
    } finally {
      emVoo.current = false;
      setEnviando(false);
    }
  }

  function escolher(acao: DocAcaoNome) {
    setErroAcao(null);
    setAviso('');
    if (COM_DIALOGO.includes(acao)) setDialogo(acao as Dlg);
    else void executar(acao);
  }

  async function baixar(v: DocVersao) {
    setBaixando(v.id);
    setErroAcao(null);
    try {
      const r = await atuacaoFetch<{ url: string; file_name: string }>(`/documentos/${id}/versoes/${v.id}/download`);
      window.open(r.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setErroAcao((err as Error).message);
    } finally {
      setBaixando(null);
    }
  }

  return (
    <div className="px-4 py-8 sm:px-6">
      <Link href="/atuacao/documentos" className="mb-4 inline-block rounded text-sm font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2">
        Voltar para documentos
      </Link>
      <div role="status" className="mb-3 text-sm font-medium text-dash-status-ok-text empty:hidden">{aviso}</div>
      <AsyncBody
        data={doc}
        error={error}
        loading={loading}
        onRetry={() => void carregar()}
        skeletonClassName="h-64 w-full"
        render={(d) => {
          const acoes = d.acoes_permitidas ?? [];
          const versaoDe = (vid: string | null) => d.versoes.find((v) => v.id === vid)?.version_number;
          return (
            <>
              <PageHeader titulo={d.title} descricao={`Cliente: ${d.tenant_name}`} />
              <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-dash-primary">
                <Badge tone={docStatusTone(d.status)}>{docStatusLabel(d.status)}</Badge>
                <span>{docCategoriaLabel(d.category)}</span>
                <span className="text-dash-muted">Criado por {d.created_by_name ?? '—'} · atualizado em {formatDataHora(d.updated_at)}</span>
                <Link href={`/atuacao/clientes/${d.tenant_id}`} className={LINK}>Ver ficha do cliente</Link>
              </div>
              {d.status === 'publicado' && (
                <p className="mb-6 text-sm font-semibold text-dash-status-ok-text">Publicado em documentos do cliente</p>
              )}

              {acoes.length > 0 && (
                <div className="mb-6 rounded-[18px] bg-dash-card p-6 shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
                  <div role="group" aria-label="Ações do documento" className="flex flex-wrap gap-2">
                    {acoes.map((a) => (
                      <button key={a} type="button" disabled={enviando} onClick={() => escolher(a)} className={a === 'cancelar' ? BTN_SEC : BTN}>
                        {ACAO_BOTAO[a] ?? a}
                      </button>
                    ))}
                  </div>
                  {acoes.includes('assinar') && <div className="mt-4"><Aviso texto={d.aviso_assinatura} /></div>}
                </div>
              )}
              {!dialogo && erroAcao && <p role="alert" className="mb-4 text-sm text-dash-status-crit-text">{erroAcao}</p>}

              <div className="grid gap-6 lg:grid-cols-2">
                <Secao id="sec-linha" titulo="Linha do tempo">
                  <ol aria-label="Linha do tempo" className="flex flex-col gap-3">
                    {d.eventos.map((e) => (
                      <li key={e.id} className="border-l-2 border-dash-border-input pl-3 text-sm">
                        <p className="font-medium text-dash-primary">
                          {docEventoLabel(e.type)}{versaoDe(e.version_id) ? ` (versão ${versaoDe(e.version_id)})` : ''}
                        </p>
                        <p className="text-xs text-dash-muted">de {e.actor_name ?? 'ator não identificado'} · {formatDataHora(e.created_at)}</p>
                        {e.note && <p className="mt-1 whitespace-pre-wrap break-words text-dash-primary">{e.note}</p>}
                      </li>
                    ))}
                  </ol>
                </Secao>
                <Secao id="sec-versoes" titulo="Versões">
                  <Versoes versoes={d.versoes} atualId={d.current_version_id} baixando={baixando} onBaixar={(v) => void baixar(v)} />
                </Secao>
              </div>
              <div className="mt-6">
                <Assinaturas lista={d.assinaturas} aviso={d.aviso_assinatura} />
              </div>

              {dialogo && (
                <DialogoAcao
                  acao={dialogo}
                  aviso={d.aviso_assinatura}
                  enviando={enviando}
                  erro={erroAcao}
                  onEnviar={(dados) => void executar(dialogo, dados)}
                  onFechar={() => { setDialogo(null); setErroAcao(null); }}
                />
              )}
            </>
          );
        }}
      />
    </div>
  );
}
