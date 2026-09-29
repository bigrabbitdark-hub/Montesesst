export function Card({ title, className = '', children }: { title?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-[10px] bg-dash-card shadow-[0_1px_3px_rgba(15,23,42,0.08)] ${className}`}>
      {title && <h3 className="border-b border-dash-border-soft px-4 py-3 text-sm font-bold text-dash-primary">{title}</h3>}
      <div className="p-4">{children}</div>
    </div>
  );
}
