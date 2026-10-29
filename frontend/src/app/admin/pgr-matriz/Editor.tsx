'use client';

import { useEffect, useRef, useState } from 'react';
import { AdminApiError, adminSend } from '@/components/admin/api';
import { DialogoAcao } from './Acao';
import { EscalaEditor } from './Escalas';
import { MetodologiaEditor } from './Metodologia';
import { FaixasEditor, NiveisEditor } from './NiveisFaixas';
import { Previa } from './Previa';
import { ResultadoValidacao } from './Resultado';
import { BASE_MATRIZ, TEXTO_CONFIRMA_PUBLICAR, configParaForm, formParaConfig, type FormMatriz, type Validacao, type VersaoDetalhe } from './tipos';

type Acao = 'salvar' | 'validar' | null;
interface Retorno { mensagem?: string; erros: string[]; pendencias: string[]; vazio?: string }

const snapshot = (f: FormMatriz, notes: string) => JSON.stringify([f, notes]);

// Editor de um RASCUNHO. Tudo começa como o servidor devolveu (ou vazio): nenhum valor de exemplo.
// O servidor é a autoridade: salvar, validar e publicar passam por ele; a tela só apresenta o que ele responde.
export function Editor({ versao, onPublicada }: { versao: VersaoDetalhe; onPublicada: () => void }) {
  const [inicial] = useState(() => configParaForm(versao.config));
  const [form, setForm] = useState<FormMatriz>(inicial);
  const [notes, setNotes] = useState(versao.notes ?? '');
  const [salvo, setSalvo] = useState(() => snapshot(inicial, versao.notes ?? ''));
  const [acao, setAcao] = useState<Acao>(null);
  const [retorno, setRetorno] = useState<Retorno | null>(null);
  const [status, setStatus] = useState('');
  const [publicando, setPublicando] = useState(false);
  const [encerrada, setEncerrada] = useState(false);
  // updated_at do rascunho que a tela leu/salvou por último: a publicação só vale se o rascunho não mudou desde então.
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(versao.updated_at);
  const geracao = useRef(0);
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);

  const sujo = snapshot(form, notes) !== salvo;
  const ocupado = acao !== null;

  // Qualquer edição invalida resultados anteriores e respostas ainda em voo (não descrevem mais o formulário).
  function mudar(fn: (f: FormMatriz) => FormMatriz) {
    geracao.current += 1;
    setForm(fn);
    setRetorno(null);
    setStatus('');
  }

  function aplicarFalha(e: unknown): Retorno {
    return e instanceof AdminApiError
      ? { mensagem: e.message, erros: e.erros, pendencias: e.pendencias }
      : { mensagem: e instanceof Error ? e.message : 'Não foi possível concluir a ação. Tente novamente.', erros: [], pendencias: [] };
  }

  async function salvar() {
    if (ocupado) return;
    const g = geracao.current;
    const enviado = snapshot(form, notes);
    setAcao('salvar'); setRetorno(null); setStatus('');
    try {
      const r = await adminSend<VersaoDetalhe>('PATCH', `${BASE_MATRIZ}/${versao.id}`, { config: formParaConfig(form), notes });
      if (!vivo.current) return;
      setSalvo(enviado);
      setAtualizadoEm(r.updated_at ?? null);
      if (g !== geracao.current) return;
      const v: Validacao = r.validacao ?? { erros: [], pendencias: [] };
      setStatus('Rascunho salvo.');
      setRetorno({ erros: v.erros, pendencias: v.pendencias });
    } catch (e) {
      if (vivo.current && g === geracao.current) setRetorno(aplicarFalha(e));
    } finally {
      if (vivo.current) setAcao(null);
    }
  }

  async function validar() {
    if (ocupado) return;
    const g = geracao.current;
    setAcao('validar'); setRetorno(null); setStatus('');
    try {
      const r = await adminSend<Validacao>('POST', `${BASE_MATRIZ}/validar`, { config: formParaConfig(form), publicar: true });
      if (vivo.current && g === geracao.current) {
        setRetorno({ erros: r.erros ?? [], pendencias: r.pendencias ?? [], vazio: 'Nenhum erro ou pendência encontrado pelo servidor.' });
      }
    } catch (e) {
      if (vivo.current && g === geracao.current) setRetorno(aplicarFalha(e));
    } finally {
      if (vivo.current) setAcao(null);
    }
  }

  async function publicar() {
    if (!atualizadoEm) throw new Error('Recarregue o rascunho antes de publicar.');
    await adminSend('POST', `${BASE_MATRIZ}/${versao.id}/publicar`, { updated_at: atualizadoEm });
    setEncerrada(true);
    onPublicada();
  }

  if (encerrada) return <p role="status" className="text-sm text-brand-700">Versão publicada. Carregando…</p>;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-brand-700">
        Rascunho: ainda pode ser alterado. Nada aqui vem preenchido; o servidor valida e indica o que falta.
      </p>
      <EscalaEditor chave="severidade" nome="Severidade" itens={form.severidade} mudar={mudar} bloqueado={ocupado} />
      <EscalaEditor chave="probabilidade" nome="Probabilidade" itens={form.probabilidade} mudar={mudar} bloqueado={ocupado} />
      <NiveisEditor niveis={form.niveis} mudar={mudar} bloqueado={ocupado} />
      <FaixasEditor faixas={form.faixas} niveis={form.niveis} mudar={mudar} bloqueado={ocupado} />
      <MetodologiaEditor valor={form.metodologia} mudar={mudar} bloqueado={ocupado} />
      <label className="flex flex-col gap-1 text-sm text-brand-900">
        Observações da versão
        <textarea rows={2} maxLength={4000} className="adm-input" value={notes} disabled={ocupado}
          onChange={(e) => { geracao.current += 1; setNotes(e.target.value); setRetorno(null); setStatus(''); }} />
      </label>

      <Previa form={form} />

      {status && <p role="status" className="text-sm text-adm-status-ok-text">{status}</p>}
      {retorno && <ResultadoValidacao {...retorno} />}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="adm-btn adm-btn-primary disabled:opacity-50" disabled={ocupado} onClick={salvar}>
          {acao === 'salvar' ? 'Salvando…' : 'Salvar rascunho'}
        </button>
        <button type="button" className="adm-btn disabled:opacity-50" disabled={ocupado} onClick={validar}>
          {acao === 'validar' ? 'Validando…' : 'Validar'}
        </button>
        <button type="button" className="adm-btn disabled:opacity-50" disabled={ocupado || sujo} onClick={() => setPublicando(true)}>
          Publicar versão
        </button>
        {sujo && <span className="text-xs text-brand-700">Salve o rascunho antes de publicar: a publicação usa a versão salva.</span>}
      </div>

      {publicando && (
        <DialogoAcao
          titulo={`Publicar versão ${versao.version_number}`}
          texto={TEXTO_CONFIRMA_PUBLICAR}
          rotuloConfirmar="Confirmar publicação"
          executar={publicar}
          rotuloRecarregar="Recarregar rascunho"
          onRecarregar={() => { setPublicando(false); onPublicada(); }}
          onFechar={() => setPublicando(false)}
        />
      )}
    </div>
  );
}
