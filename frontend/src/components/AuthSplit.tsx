import Image from 'next/image';
import type { ReactNode } from 'react';

export function AuthSplit({
  photo,
  photoAlt,
  quote,
  checklist,
  children,
}: {
  photo: string;
  photoAlt: string;
  quote: string;
  checklist?: string[];
  children: ReactNode;
}) {
  return (
    <div className="grid lg:min-h-[calc(100vh-73px)] lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-brand-900 lg:block">
        <Image src={photo} alt={photoAlt} fill className="object-cover [filter:grayscale(0.35)_brightness(0.9)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-brand-900/90 via-brand-900/25 to-brand-900/50" />
        <div className="absolute inset-x-0 bottom-0 p-10 xl:p-14">
          <p className="max-w-md text-[22px] font-semibold leading-snug text-white xl:text-[26px]">{quote}</p>
          {checklist && (
            <div className="mt-6 flex flex-col gap-2.5">
              {checklist.map((item) => (
                <div key={item} className="flex items-center gap-2.5 text-[13.5px] font-medium text-brand-100">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand-300)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  {item}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="relative overflow-hidden bg-brand-900 lg:hidden">
        <Image src={photo} alt={photoAlt} width={800} height={280} className="h-[180px] w-full object-cover [filter:grayscale(0.35)_brightness(0.9)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-brand-900/85 via-brand-900/10 to-brand-900/40" />
        <p className="absolute inset-x-0 bottom-0 p-5 text-[15px] font-semibold leading-snug text-white">{quote}</p>
      </div>

      <div className="flex items-center justify-center bg-gradient-to-b from-brand-50 to-white px-4 py-14 sm:px-10">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
