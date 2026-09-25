const SCORE = 92;
const RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const TREND = [58, 64, 61, 70, 76, 82, 92];

export function DashboardPreview() {
  const offset = CIRCUMFERENCE - (SCORE / 100) * CIRCUMFERENCE;
  const trendPoints = TREND.map((v, i) => {
    const x = (i / (TREND.length - 1)) * 100;
    const y = 34 - (v / 100) * 30;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="relative flex h-[380px] items-center justify-center sm:h-[440px] lg:h-[480px]">
      {/* Back window card — mini dashboard chrome */}
      <div className="absolute left-0 top-[110px] w-[200px] -rotate-6 rounded-2xl bg-white/95 p-4 shadow-xl shadow-black/25 backdrop-blur sm:left-2 sm:top-[130px] sm:w-[220px]">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red-300" />
          <span className="h-2 w-2 rounded-full bg-amber-300" />
          <span className="h-2 w-2 rounded-full bg-brand-300" />
          <span className="ml-2 text-[10px] font-semibold text-slate-400">Dashboard SST</span>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center justify-between rounded-lg bg-brand-50 px-2.5 py-1.5">
            <span className="text-[11px] font-medium text-brand-700">Documentos em dia</span>
            <span className="text-[11px] font-bold text-brand-700">18/20</span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-amber-50 px-2.5 py-1.5">
            <span className="text-[11px] font-medium text-amber-700">Vencimentos em 30 dias</span>
            <span className="text-[11px] font-bold text-amber-700">4</span>
          </div>
        </div>
        <svg viewBox="0 0 100 34" preserveAspectRatio="none" className="mt-3 h-9 w-full">
          <polyline points={trendPoints} fill="none" stroke="var(--color-brand-500)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Small floating badge card */}
      <div className="absolute left-5 top-6 flex items-center gap-2.5 rounded-2xl bg-white/95 px-4 py-3 shadow-xl shadow-black/20 backdrop-blur sm:left-8 sm:top-8">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand-500)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18" />
            <path d="M7 15l4-6 4 3 4-7" />
          </svg>
        </div>
        <div>
          <p className="text-[12.5px] font-bold leading-none text-brand-900">Painel Montese</p>
          <p className="mt-1 text-[10.5px] leading-none text-slate-500">Score em tempo real</p>
        </div>
      </div>

      {/* Main compliance card */}
      <div className="absolute bottom-6 right-4 w-[248px] rounded-2xl bg-white p-5 shadow-2xl shadow-black/30 sm:bottom-9 sm:right-7 sm:w-[268px]">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Conformidade</p>
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            Tempo real
          </span>
        </div>

        <div className="mt-3 flex items-center gap-4">
          <div className="relative h-[92px] w-[92px] shrink-0">
            <svg viewBox="0 0 130 130" className="h-full w-full -rotate-90">
              <circle cx="65" cy="65" r={RADIUS} fill="none" stroke="var(--color-brand-50)" strokeWidth="12" />
              <circle
                cx="65"
                cy="65"
                r={RADIUS}
                fill="none"
                stroke="var(--color-brand-500)"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={offset}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[22px] font-extrabold leading-none text-brand-900">{SCORE}%</span>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-2.5">
            <div className="flex items-center justify-between rounded-lg bg-red-50 px-2.5 py-1.5">
              <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-red-700">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                Pendências
              </span>
              <span className="text-[11.5px] font-bold text-red-700">1</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-amber-50 px-2.5 py-1.5">
              <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-amber-700">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Vencendo em breve
              </span>
              <span className="text-[11.5px] font-bold text-amber-700">2</span>
            </div>
          </div>
        </div>

        <p className="mt-3.5 border-t border-brand-50 pt-3 text-[10.5px] leading-snug text-slate-400">
          Ilustrativo — calculado a partir dos documentos da sua empresa.
        </p>
      </div>

      {/* Shield/check accent badge */}
      <div className="absolute right-8 top-8 flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-xl shadow-black/20 sm:right-12 sm:top-10">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z" fill="var(--color-brand-500)" />
          <path d="M8.5 12.2l2.3 2.3L16 9.3" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </div>
    </div>
  );
}
