export function Card({ title, className = '', children }: { title?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-[18px] bg-dash-card shadow-[0_4px_12px_rgba(15,23,42,0.08)] ${className}`}>
      {title && <h3 className="px-6 pt-6 text-base font-semibold text-dash-primary">{title}</h3>}
      <div className="p-6">{children}</div>
    </div>
  );
}
