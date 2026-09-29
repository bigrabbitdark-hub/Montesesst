export function ImagePlaceholder({ label, className = '' }: { label: string; className?: string }) {
  return (
    <div
      className={`flex items-center justify-center bg-[repeating-linear-gradient(45deg,#1a2550,#1a2550_10px,#0a1640_10px,#0a1640_20px)] text-center text-[10px] font-semibold text-white/70 ${className}`}
      role="img"
      aria-label={`Imagem pendente: ${label}`}
    >
      IMAGEM PENDENTE
      <br />
      {label}
    </div>
  );
}
