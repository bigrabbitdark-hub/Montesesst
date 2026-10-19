'use client';

import { useEffect, useState } from 'react';
import { FileInput } from '../FileInput';

// Etapa 1 do Relatório de Visita Técnica: modal de upload que
// EXIGE selecionar uma inspeção existente antes de habilitar o
// envio. Garante o vínculo via campo `inspection_id` do
// DocumentsService (que valida inspeção existe + mesmo tenant).
// Sem essa exigência, o usuário poderia esquecer o vínculo e o
// PDF ficaria órfão.

export interface InspectionOption {
  id: string;
  visited_at: string;
  status: 'rascunho' | 'concluida';
}

export function InspectionUploadModal({
  open,
  onClose,
  onUploaded,
  inspections,
  defaultInspectionId,
}: {
  open: boolean;
  onClose: () => void;
  // Chamado após 201 do backend; o pai (página) decide se recarrega
  // a lista inteira ou só insere o item na lista de anexos em
  // memória. Mantém o componente desacoplado.
  onUploaded: (newDocumentId: string) => void;
  // Lista de inspeções que o usuário pode escolher (já carregada
  // pela página via /api/inspections). Não refazemos a busca aqui
  // pra não duplicar trabalho e pra não divergir do estado da
  // página.
  inspections: InspectionOption[];
  // Pré-seleciona quando aberto a partir do card de uma inspeção
  // específica (ex.: da tela de detalhe).
  defaultInspectionId?: string;
}) {
  const [inspectionId, setInspectionId] = useState(defaultInspectionId ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset do estado toda vez que o modal é reaberto, e
  // sincroniza o `inspectionId` pré-selecionado.
  useEffect(() => {
    if (open) {
      setInspectionId(defaultInspectionId ?? '');
      setFile(null);
      setError('');
      setSubmitting(false);
    }
  }, [open, defaultInspectionId]);

  if (!open) return null;

  // Inspeção válida = a selecionada está na lista (não confiar
  // num id que veio de outra fonte). Inspeções em rascunho
  // também podem receber PDF (a UI permite visualizar/baixar
  // mesmo antes da conclusão, o técnico pode subir a versão
  // assinada depois).
  const canSubmit = Boolean(inspectionId && inspections.some((i) => i.id === inspectionId) && file && !submitting);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    const token = localStorage.getItem('montese_token');
    const formData = new FormData();
    formData.append('file', file!);
    formData.append('category', 'relatorio_visita');
    // Título derivado do nome do arquivo (sem extensão) — o
    // backend também aceita title customizado, mas a Etapa 1 não
    // precisa de UI pra isso. Mantém o título curto e legível.
    const baseTitle = (file!.name || 'relatorio').replace(/\.[^.]+$/, '');
    formData.append('title', baseTitle);
    formData.append('inspection_id', inspectionId);
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        const created = await res.json();
        onUploaded(created.id);
        onClose();
      } else {
        // Mantém a mensagem genérica do backend se vier JSON
        // com `message`, senão cai num texto padrão.
        let msg = 'Não foi possível enviar o PDF.';
        try {
          const body = await res.json();
          if (body?.message) {
            const m = Array.isArray(body.message) ? body.message.join(', ') : body.message;
            if (typeof m === 'string' && m.toLowerCase().includes('inválid')) {
              msg = m;
            }
          }
        } catch {
          // sem corpo JSON, usa a msg padrão
        }
        setError(msg);
      }
    } catch {
      setError('Não foi possível conectar ao servidor.');
    } finally {
      setSubmitting(false);
    }
  }

  function formatDate(iso: string): string {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Anexar relatório de visita"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl"
      >
        <h2 className="text-lg font-bold text-brand-900">Anexar relatório de visita</h2>
        <p className="mt-1 text-sm text-brand-700">
          Escolha a visita técnica (inspeção) a que este PDF pertence. A visita é registrada pelo técnico; o PDF
          fica vinculado a ela.
        </p>
        {inspections.length === 0 && (
          <p role="status" className="mt-3 rounded-md bg-yellow-50 p-3 text-sm text-yellow-800">
            Nenhuma visita registrada ainda. Peça ao técnico responsável para registrar a visita no sistema; depois
            você poderá anexar o relatório aqui.
          </p>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <label className="mt-4 flex flex-col gap-1 text-sm text-brand-900">
          Visita técnica
          <select
            required
            disabled={inspections.length === 0}
            value={inspectionId}
            onChange={(e) => setInspectionId(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          >
            <option value="">Selecione uma visita</option>
            {inspections.map((insp) => (
              <option key={insp.id} value={insp.id}>
                {formatDate(insp.visited_at)} — {insp.status === 'concluida' ? 'Concluída' : 'Rascunho'}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4 flex flex-col gap-1 text-sm text-brand-900">
          Arquivo PDF
          <FileInput file={file} onChange={setFile} accept="application/pdf" />
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-brand-100 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </form>
    </div>
  );
}
