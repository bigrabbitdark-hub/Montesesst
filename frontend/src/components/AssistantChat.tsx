'use client';

import { FormEvent, useState } from 'react';
import { getToken } from '@/lib/auth';
import { FileInput } from './FileInput';

interface Citation {
  document_id: string;
  title: string;
  official_url: string;
}

interface CompanyCitation {
  document_id: string;
  title: string;
  category: string;
}

interface ChecklistCitation {
  item_id: string;
  nr_code: string;
  document_name: string;
}

interface Notice {
  // Fase A — Etapa 2: union ampliada com vencimento_vencido, dado_insuficiente
  // e geografia. Mantém os 3 valores antigos (lint exige retro-compat) e
  // aceita os 3 novos emitidos por `question-notices.ts` no backend.
  // Para evitar drift com o backend, qualquer valor fora desse conjunto é
  // sinalizado pelo typecheck — só adicionar chave aqui quando o backend
  // emitir o tipo novo.
  tipo:
    | 'jurisdicao'
    | 'profissional_habilitado'
    | 'contexto'
    | 'vencimento_vencido'
    | 'dado_insuficiente'
    | 'geografia';
  texto: string;
}

interface QueryResult {
  answer: string | null;
  message?: string;
  citations: Citation[];
  company_citations: CompanyCitation[];
  checklist_citations?: ChecklistCitation[];
  notices?: Notice[];
  used_attachment?: boolean;
  attachment_warning?: string;
}

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

const GENERIC_ERROR_MESSAGE = 'Não foi possível consultar agora. Tente de novo.';
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

// Limite duro para uma única consulta ao assistente. Sem ele, um fetch
// pendurado deixaria a UI em 'loading' indefinidamente (sem o spinner
// resolver, sem o botão "Tentar de novo" ficar disponível). 60s é
// folgado o suficiente para uma chamada LLM+RAG completa e curto o
// suficiente para não fazer o usuário desistir.
const QUERY_TIMEOUT_MS = 60_000;

export function AssistantChat({ tenantId }: { tenantId?: string }) {
  const [question, setQuestion] = useState('');
  // Anexo opcional da pergunta atual. Vive aqui (e não em ref) porque é
  // fonte de verdade da UI: o `<FileInput>` lê daqui, o `runQuery` lê
  // daqui para montar o FormData, e o reset pós-sucesso também escreve
  // aqui (`setFile(null)`).
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'erro'>('idle');
  // Mensagem mostrada na região `role="alert"` quando `status === 'erro'`.
  // É re-inicializada com o texto genérico no início de cada `runQuery` —
  // o que significa que entre uma consulta e outra sempre exibimos o
  // genérico até o backend responder com o motivo específico (413/400/429)
  // ou o catch assumir com a mesma string.
  const [errorMessage, setErrorMessage] = useState(GENERIC_ERROR_MESSAGE);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await runQuery();
  }

  // Lógica pura de submit, separada do FormEvent handler para que o botão
  // "Tentar de novo" (quando o resultado anterior terminou em erro) possa
  // re-submeter sem disparar evento de form nenhum — preserva `question`
  // e `file` que já vivem em estado.
  async function runQuery() {
    if (!question.trim()) return;
    setStatus('loading');
    setResult(null);
    setErrorMessage(GENERIC_ERROR_MESSAGE);
    // `AbortController` + `setTimeout` para garantir que um fetch
    // pendurado não deixa a UI em 'loading' para sempre (o usuário
    // ficaria sem spinner E sem botão "Tentar de novo"). 60s cobre uma
    // chamada LLM+RAG completa com folga; o `clearTimeout` no `finally`
    // libera o handle mesmo em caminho de sucesso.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);
    try {
      let res: Response;
      if (file) {
        // Checagem client-side antes de montar o FormData — evita subir
        // um arquivo grande inteiro só pra levar um 413 do Multer no
        // backend (o limite real, que continua sendo aplicado lá).
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setErrorMessage('Arquivo maior que 5MB — escolha um arquivo menor.');
          setStatus('erro');
          return;
        }
        const formData = new FormData();
        formData.append('question', question);
        if (tenantId) formData.append('tenant_id', tenantId);
        formData.append('file', file);
        res = await fetch('/api/assistant/normative-query', {
          method: 'POST',
          headers: authHeaders(),
          body: formData,
          signal: controller.signal,
        });
      } else {
        res = await fetch('/api/assistant/normative-query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(tenantId ? { question, tenant_id: tenantId } : { question }),
          signal: controller.signal,
        });
      }
      if (res.ok) {
        setResult(await res.json());
        setStatus('idle');
        setFile(null);
        return;
      }
      // As três respostas de erro determinísticas e causadas pelo próprio
      // usuário que o endpoint de anexo introduziu (413/400/429) merecem
      // uma mensagem específica — repetir a tentativa sem mudar nada vai
      // falhar do mesmo jeito todas as vezes, então a mensagem genérica
      // não ajuda nesses três casos.
      if (res.status === 413) {
        setErrorMessage('Arquivo maior que 5MB — escolha um arquivo menor.');
      } else if (res.status === 400) {
        setErrorMessage('Tipo de arquivo não aceito — use PDF, JPG ou PNG.');
      } else if (res.status === 429) {
        setErrorMessage('Muitas perguntas com anexo em pouco tempo — tente de novo mais tarde.');
      } else {
        setErrorMessage(GENERIC_ERROR_MESSAGE);
      }
      setStatus('erro');
    } catch (err) {
      // Erro de rede/timeout — o fetch foi abortado pelo AbortController
      // ou a rede caiu antes da resposta chegar. Em qualquer dos casos
      // não temos status HTTP para exibir uma mensagem específica, então
      // usamos a genérica (consistente com a branch `else` acima), com
      // uma exceção: quando o erro é um AbortError (timeout), avisamos
      // o usuário de forma específica para que ele saiba que vale tentar
      // de novo em vez de presumir que a pergunta está malformada.
      if (err instanceof Error && err.name === 'AbortError') {
        setErrorMessage('A consulta demorou demais e foi cancelada — tente novamente.');
      } else {
        setErrorMessage(GENERIC_ERROR_MESSAGE);
      }
      setStatus('erro');
    } finally {
      // Sempre limpa o timeout — quer o fetch tenha sucesso, falhado
      // ou sido abortado, o setTimeout não deve ficar pendente pra sempre
      // segurando o AbortController vivo até o próximo tick de 60s.
      clearTimeout(timeoutId);
    }
  }

  async function openCitation(documentId: string) {
    const res = await fetch(`/api/normative-documents/${documentId}/download`, { headers: authHeaders() });
    if (res.ok) {
      const { url } = await res.json();
      window.open(url, '_blank');
    }
  }

  async function openCompanyCitation(documentId: string) {
    const res = await fetch(`/api/documents/${documentId}/download`, { headers: authHeaders() });
    if (res.ok) {
      const { url } = await res.json();
      window.open(url, '_blank');
    }
  }

  return (
    <div>
      {/*
        Região viva para leitores de tela: anuncia transições
        loading → idle (sucesso) sem interromper o que o usuário está
        ouvindo. A falha continua sendo anunciada pelo `role="alert"`
        existente abaixo — cobri-la aqui geraria anúncio duplicado.
      */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {status === 'loading' && 'Consultando o assistente, por favor aguarde.'}
        {status === 'idle' && result && 'Resposta recebida do assistente.'}
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <textarea
          required
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Pergunte sobre uma norma de SST — ex: preciso fornecer capacete pra que função?"
          rows={3}
          disabled={status === 'loading'}
          className="rounded-md border border-brand-100 px-3 py-2 text-sm disabled:bg-brand-50"
        />
        <div className="flex flex-col gap-1 text-sm text-brand-900">
          <span>Anexar documento ou imagem (opcional — PDF, JPG ou PNG, até 5MB)</span>
          <FileInput file={file} onChange={setFile} accept="application/pdf,image/jpeg,image/png" label="Escolher arquivo" disabled={status === 'loading'} />
        </div>
        <button
          type="submit"
          disabled={status === 'loading' || !question.trim()}
          className="inline-flex items-center self-start rounded-md bg-brand-500 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'loading' && (
            <svg
              className="mr-2 inline h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
          )}
          {status === 'loading' ? 'Consultando...' : 'Perguntar'}
        </button>
        {status === 'erro' && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2"
          >
            <p className="text-sm text-red-700">{errorMessage}</p>
            <button
              type="button"
              onClick={() => {
                void runQuery();
              }}
              disabled={!question.trim()}
              className="self-start rounded border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              Tentar de novo
            </button>
          </div>
        )}
      </form>

      {result && (
        <div className="mt-6 rounded-lg border border-brand-100 p-6">
          {(result.notices ?? []).map((notice) => {
            // Fase A — Etapa 2: avisos novos (`vencimento_vencido`,
            // `dado_insuficiente`, `geografia`) são alertas de bloqueio
            // (a resposta fica incompleta até o usuário resolver). Os
            // antigos (`jurisdicao`, `profissional_habilitado`,
            // `contexto`) seguem em amber-claro como avisos de contexto.
            // Cor mais forte aqui (red-50/red-200/red-900) sinaliza "isso
            // precisa ser resolvido antes da resposta servir".
            const isBlocking =
              notice.tipo === 'vencimento_vencido' ||
              notice.tipo === 'dado_insuficiente' ||
              notice.tipo === 'geografia';
            return (
              <p
                key={notice.tipo}
                role={isBlocking ? 'alert' : undefined}
                className={
                  isBlocking
                    ? 'mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-900'
                    : 'mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800'
                }
              >
                {notice.texto}
              </p>
            );
          })}
          <p className="whitespace-pre-wrap text-sm text-brand-900">{result.answer ?? result.message}</p>
          {result.attachment_warning && (
            <p
              role="alert"
              className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
            >
              {result.attachment_warning}
            </p>
          )}
          {result.used_attachment && (
            <p className="mt-2 text-xs font-medium text-brand-700">
              Parte desta resposta vem do arquivo que você anexou nesta pergunta, não de uma fonte normativa oficial.
            </p>
          )}
          {result.citations.length > 0 && (
            <div className="mt-4 flex flex-col gap-1">
              <h4 className="text-xs font-bold uppercase tracking-wide text-brand-700">Fontes</h4>
              {result.citations.map((c) => (
                <button
                  key={c.document_id}
                  onClick={() => openCitation(c.document_id)}
                  className="text-left text-sm text-brand-500 underline hover:text-brand-700"
                >
                  {c.title}
                </button>
              ))}
            </div>
          )}
          {result.company_citations.length > 0 && (
            <div className="mt-4 flex flex-col gap-1">
              <h4 className="text-xs font-bold uppercase tracking-wide text-brand-700">
                Documentos da empresa usados nesta resposta
              </h4>
              {result.company_citations.map((c) => (
                <button
                  key={c.document_id}
                  onClick={() => openCompanyCitation(c.document_id)}
                  className="text-left text-sm text-brand-500 underline hover:text-brand-700"
                >
                  {c.title}
                </button>
              ))}
            </div>
          )}
          {(result.checklist_citations ?? []).length > 0 && (
            <div className="mt-4 flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3">
              <h4 className="text-xs font-bold uppercase tracking-wide text-amber-800">
                Checklist interno Montese — não é o texto oficial da norma
              </h4>
              <ul className="flex flex-col gap-1 pl-4 list-disc">
                {(result.checklist_citations ?? []).map((c) => (
                  <li key={c.item_id} className="text-sm text-amber-900">
                    {c.nr_code} — {c.document_name}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className="mt-6 text-xs text-brand-700">
        O Assistente organiza informação de fontes oficiais e, quando indicado, de materiais de
        referência da Montese e de documentos da sua empresa — ele não substitui a avaliação de um
        profissional de Segurança e Saúde do Trabalho legalmente habilitado.
      </p>
    </div>
  );
}
