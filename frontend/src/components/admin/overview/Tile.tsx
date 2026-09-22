// Bloco de métrica pequeno. Deve ficar dentro de um <dl> (dt = rótulo, dd = valor e dica).
export function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="adm-card-2 min-w-0 p-3">
      <dt className="text-xs text-brand-700">{label}</dt>
      <dd className="mt-1 truncate text-lg font-semibold text-brand-900">{value}</dd>
      {hint && <dd className="mt-0.5 truncate text-[11px] text-brand-700">{hint}</dd>}
    </div>
  );
}
