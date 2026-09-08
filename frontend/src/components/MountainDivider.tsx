export function MountainDivider({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1440 90"
      preserveAspectRatio="none"
      className={`block h-[70px] w-full sm:h-[90px] ${className}`}
    >
      <polygon
        points="0,90 0,55 180,15 340,55 480,5 620,50 760,15 900,55 1040,20 1200,50 1320,25 1440,55 1440,90"
        fill="var(--color-brand-100)"
      />
      <polygon
        points="0,90 0,70 220,35 400,65 560,25 740,60 900,30 1080,65 1240,35 1440,65 1440,90"
        fill="var(--color-brand-300)"
        opacity="0.75"
      />
    </svg>
  );
}
