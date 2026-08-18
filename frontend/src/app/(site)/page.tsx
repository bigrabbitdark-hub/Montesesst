'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface StoredUser {
  id: string;
  tenantId: string | null;
  role: string;
}

const ROLES = [
  {
    title: 'Empresa cliente',
    description: 'Acompanhe score de SST, pendências, documentos e agenda num único painel.',
  },
  {
    title: 'Técnico responsável',
    description: 'Carteira de clientes, agenda e relatórios de inspeção — tudo à distância.',
  },
  {
    title: 'Técnico parceiro',
    description: 'Visitas técnicas e checklists de inspeção em campo, sincronizados na hora.',
  },
];

export default function HomePage() {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem('montese_user');
    setUser(raw ? JSON.parse(raw) : null);
    setChecked(true);
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <section className="text-center">
        <h1 className="text-4xl font-bold text-brand-900 sm:text-5xl">
          Tecnologia que organiza. Gestão que protege.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-brand-700">
          A plataforma que conecta empresa, técnico responsável e técnico parceiro num só lugar
          — com histórico e rastreabilidade completos de SST.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          {checked && user ? (
            <p className="text-brand-900">
              Logado como <strong>{user.role}</strong>.
            </p>
          ) : (
            <>
              <Link
                href="/cadastro"
                className="rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700"
              >
                Comece grátis
              </Link>
              <Link
                href="/contato"
                className="rounded-md border border-brand-500 px-6 py-3 font-medium text-brand-700 hover:bg-brand-50"
              >
                Fale com a gente
              </Link>
            </>
          )}
        </div>
      </section>

      <section className="mt-20 grid gap-8 sm:grid-cols-3">
        {ROLES.map((role) => (
          <div key={role.title} className="rounded-lg border border-brand-100 p-6">
            <h2 className="text-lg font-semibold text-brand-900">{role.title}</h2>
            <p className="mt-2 text-sm text-brand-700">{role.description}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
