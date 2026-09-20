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
  tipo: 'jurisdicao' | 'profissional_habilitado' | 'contexto';
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

export function AssistantChat({ tenantId }: { tenantId?: string }) {
  const [question, setQuestion] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'erro'>('idle');
  const [errorMessage, setErrorMessage] = useState(GENERIC_ERROR_MESSAGE);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setResult(null);
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
        });
      } else {
        res = await fetch('/api/assistant/normative-query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(tenantId ? { question, tenant_id: tenantId } : { question }),
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
    } catch {
      setErrorMessage(GENERIC_ERROR_MESSAGE);
      setStatus('erro');
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
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <textarea
          required
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Pergunte sobre uma norma de SST — ex: preciso fornecer capacete pra que função?"
          rows={3}
          className="rounded-md border border-brand-100 px-3 py-2 text-sm"
        />
        <div className="flex flex-col gap-1 text-sm text-brand-900">
          <span>Anexar documento ou imagem (opcional — PDF, JPG ou PNG, até 5MB)</span>
          <FileInput file={file} onChange={setFile} accept="application/pdf,image/jpeg,image/png" label="Escolher arquivo" />
        </div>
        <button
          type="submit"
          disabled={status === 'loading' || !question.trim()}
          className="self-start rounded-md bg-brand-500 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Consultando...' : 'Perguntar'}
        </button>
        {status === 'erro' && <p className="text-sm text-red-600">{errorMessage}</p>}
      </form>

      {result && (
        <div className="mt-6 rounded-lg border border-brand-100 p-6">
          {(result.notices ?? []).map((notice) => (
            <p
              key={notice.tipo}
              className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
            >
              {notice.texto}
            </p>
          ))}
          <p className="whitespace-pre-wrap text-sm text-brand-900">{result.answer ?? result.message}</p>
          {result.attachment_warning && (
            <p className="mt-2 text-sm text-amber-700">{result.attachment_warning}</p>
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
            <div className="mt-4 flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 p-3">
              <h4 className="text-xs font-bold uppercase tracking-wide text-amber-800">
                Checklist interno Montese — não é o texto oficial da norma
              </h4>
              {(result.checklist_citations ?? []).map((c) => (
                <p key={c.item_id} className="text-sm text-amber-900">
                  {c.nr_code} — {c.document_name}
                </p>
              ))}
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
