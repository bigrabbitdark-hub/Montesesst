// Escopo do skin do dashboard novo (ver .skin-dash em globals.css). Painéis compartilhados com a
// área do técnico só ficam com o visual novo quando renderizados dentro deste componente.
export function DashSkin({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`skin-dash ${className}`}>{children}</div>;
}
