export const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
export const btnCls = 'rounded-lg bg-dash-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
export const btn2Cls = 'rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50';
export const fmt = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-dash-primary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-dash-muted">{hint}</span>}
    </label>
  );
}
