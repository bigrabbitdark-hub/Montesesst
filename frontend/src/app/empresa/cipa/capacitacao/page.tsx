'use client';

import { useState } from 'react';
import TreinamentosTab from './TreinamentosTab';
import DdsTab from './DdsTab';
import SipatTab from './SipatTab';

type Tab = 'treinamentos' | 'dds' | 'sipat';

const TABS: { key: Tab; label: string }[] = [
  { key: 'treinamentos', label: 'Treinamentos' },
  { key: 'dds', label: 'DDS' },
  { key: 'sipat', label: 'SIPAT' },
];

export default function CapacitacaoPage() {
  const [tab, setTab] = useState<Tab>('treinamentos');

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">🎓 Capacitação</h1>
      <p className="mt-1 text-sm text-brand-700">Treinamentos obrigatórios, DDS e SIPAT da empresa.</p>

      <div className="mt-6 flex gap-2 border-b border-brand-100">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-semibold ${
              tab === t.key ? 'border-b-2 border-brand-500 text-brand-900' : 'text-brand-700 hover:text-brand-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === 'treinamentos' && <TreinamentosTab />}
        {tab === 'dds' && <DdsTab />}
        {tab === 'sipat' && <SipatTab />}
      </div>
    </div>
  );
}
