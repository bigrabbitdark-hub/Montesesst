'use client';

export interface DiffHunk {
  kind: 'added' | 'removed' | 'context';
  text: string;
}

export interface DocumentDiff {
  has_previous: boolean;
  summary: { added: number; removed: number; unchanged: number };
  truncated: boolean;
  hunks: DiffHunk[];
}

const PREFIXO = { added: '+', removed: '−', context: ' ' } as const;
const ROTULO = { added: 'Adicionado', removed: 'Removido', context: 'Sem mudança' } as const;
const COR = {
  added: 'text-adm-status-ok-text',
  removed: 'text-adm-status-crit-text',
  context: 'text-brand-700',
} as const;

// Texto do documento é texto extraído: sempre exibido como texto React.
export function DiffView({ diff }: { diff: DocumentDiff }) {
  return (
    <div>
      <p className="text-sm font-bold text-brand-900">
        +{diff.summary.added} / −{diff.summary.removed} parágrafos
        <span className="ml-2 font-normal text-brand-700">({diff.summary.unchanged} sem mudança)</span>
      </p>
      {diff.truncated && (
        <p role="status" className="mt-1 text-xs text-brand-700">
          Mostrando só parte das mudanças. Use “Ver texto completo lado a lado” para conferir o restante.
        </p>
      )}
      <ul className="mt-2 flex max-h-96 flex-col gap-1 overflow-y-auto text-sm">
        {diff.hunks.map((h, i) => (
          <li key={i} aria-label={`${ROTULO[h.kind]}: ${h.text}`} className={`adm-card-2 flex gap-2 break-words px-3 py-2 ${COR[h.kind]}`}>
            <span aria-hidden="true" className="w-4 shrink-0 font-mono">{PREFIXO[h.kind]}</span>
            <span className="min-w-0 whitespace-pre-wrap">{h.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
