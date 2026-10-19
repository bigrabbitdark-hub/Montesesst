'use client';

import { useState } from 'react';

// Etapa 1 do Relatório de Visita Técnica: lista os PDFs anexos a
// uma inspeção, com botão de download (URL presigned via
// /documents/:id/download — mesma rota usada em DocumentsPanel,
// mesma proteção multi-tenant por RLS). Projeção enxuta: o backend
// só devolve id, title, file_name, mime_type, size_bytes,
// uploaded_by_role e created_at (sem file_key/tenant_id) — ver
// InspectionsService.findOne() e o teste inspection-document-rls
// que cobre a forma exata do payload.
export interface InspectionAnexo {
  id: string;
  title: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by_role: string;
  created_at: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(iso: string): string {
  // "2026-09-15T13:45:00.000Z" -> "15/09/2026 10:45"
  // (UTC -> America/Sao_Paulo -03; feito com offset fixo pra não
  // depender de locale do navegador. Boa o suficiente pro card.)
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hh}:${mm} UTC`;
}

export function InspectionAttachmentsList({ anexos }: { anexos: InspectionAnexo[] }) {
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Mesmo padrão do DocumentsPanel.handleDownload: pega URL
  // presigned e abre em nova aba. Mantém o loading visual só
  // durante o clique do botão (não bloqueia o resto da tela).
  async function handleDownload(id: string) {
    const token = localStorage.getItem('montese_token');
    setError('');
    setDownloadingId(id);
    try {
      const res = await fetch(`/api/documents/${id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const { url } = await res.json();
        window.open(url, '_blank');
      } else {
        setError('Não foi possível baixar o PDF.');
      }
    } catch {
      setError('Não foi possível conectar ao servidor.');
    } finally {
      setDownloadingId(null);
    }
  }

  if (anexos.length === 0) {
    return (
      <p className="mt-2 text-sm text-brand-700">
        Nenhum relatório anexado. Use o botão &ldquo;Anexar relatório&rdquo; acima pra vincular um PDF a esta inspeção.
      </p>
    );
  }

  return (
    <div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <ul className="mt-3 flex flex-col gap-2">
        {anexos.map((anexo) => (
          <li
            key={anexo.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand-100 px-4 py-3 text-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-brand-900">{anexo.title}</p>
              <p className="truncate text-xs text-brand-700">
                {anexo.file_name} · {formatBytes(anexo.size_bytes)} · enviado em {formatDateTime(anexo.created_at)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleDownload(anexo.id)}
              disabled={downloadingId === anexo.id}
              className="rounded-md border border-brand-500 px-3 py-1.5 text-sm font-medium text-brand-500 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {downloadingId === anexo.id ? 'Baixando...' : 'Baixar PDF'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
