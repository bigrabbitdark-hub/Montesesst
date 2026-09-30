'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface StoredUser {
  id: string;
  tenantId: string | null;
  role: string;
}

export function HomeHeroCTA() {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem('montese_user');
    setUser(raw ? JSON.parse(raw) : null);
    setChecked(true);
  }, []);

  if (checked && user) {
    return (
      <p className="text-white">
        Logado como <strong>{user.role}</strong>.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-3.5">
      <Link
        href="/cadastro"
        className="rounded-xl bg-brand-500 px-7 py-4 text-[15px] font-semibold text-white shadow-lg shadow-black/20 ring-1 ring-white/15 transition-colors hover:bg-brand-700"
      >
        Comece grátis
      </Link>
      <Link
        href="/quem-somos"
        className="rounded-xl border-[1.5px] border-white/60 px-7 py-4 text-[15px] font-semibold text-white transition-colors hover:bg-white/10"
      >
        Conheça a Montese
      </Link>
    </div>
  );
}
