'use client';

import { FormEvent, useState } from 'react';
import { MountainDivider } from '@/components/MountainDivider';

const FORMATO_CURSO = [
  {
    title: 'Vídeo-aulas',
    description: 'Conteúdo gravado, direto ao ponto, no seu ritmo.',
    icon: <path d="M23 7l-7 5 7 5V7zM14 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" />,
  },
  {
    title: 'Material em PDF',
    description: 'Apostilas e resumos pra consultar quando precisar.',
    icon: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </>
    ),
  },
  {
    title: 'Certificado por técnico especialista',
    description: 'Emitido por um profissional habilitado, dentro das normas.',
    icon: (
      <>
        <circle cx="12" cy="8" r="6" />
        <path d="M15.5 13.5L17 22l-5-3-5 3 1.5-8.5" />
      </>
    ),
  },
];

const CURSOS_PLACEHOLDER = ['[Curso a definir]', '[Curso a definir]', '[Curso a definir]'];

export default function CursosPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'ok'>('idle');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // Sem backend próprio ainda — captura visual até existir um endpoint
    // real de lista de espera.
    setStatus('ok');
  }

  return (
    <div>
      <section className="bg-gradient-to-b from-brand-50 to-white px-4 pb-2 pt-16 sm:px-10 sm:pt-20">
        <div className="mx-auto max-w-2xl text-center">
          <div className="mx-auto flex h-[76px] w-[76px] items-center justify-center rounded-[20px] bg-brand-50">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand-500)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 10L12 5 2 10l10 5 10-5z" />
              <path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5" />
            </svg>
          </div>
          <div className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-accent-500/15 px-3 py-1 text-xs font-bold text-accent-700">
            EM CONSTRUÇÃO
          </div>
          <h1 className="mt-3 text-[28px] font-extrabold text-brand-900 sm:text-[32px]">
            Universidade Montese: cursos chegando em breve
          </h1>
          <p className="mt-3.5 text-[15.5px] leading-relaxed text-brand-700">
            Vamos disponibilizar cursos EAD sobre Segurança do Trabalho — vídeo-aulas, material em PDF e
            certificado emitido por um técnico especialista, cobrindo as Normas Regulamentadoras. Deixe seu
            e-mail para ser avisado no lançamento.
          </p>

          {status === 'ok' ? (
            <p className="mt-8 text-sm font-medium text-brand-700">
              Prontinho — avisamos você assim que os cursos forem lançados.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="mt-7 flex flex-wrap justify-center gap-2.5">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-[280px] rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3.5 text-sm text-brand-900 placeholder:text-brand-300"
              />
              <button
                type="submit"
                className="rounded-[9px] bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Quero ser avisado
              </button>
            </form>
          )}
        </div>

        <div className="mx-auto mt-16 grid max-w-3xl gap-5 sm:grid-cols-3">
          {FORMATO_CURSO.map((item) => (
            <div key={item.title} className="rounded-2xl border border-brand-100 bg-white p-6 text-left">
              <div className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-brand-50">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand-700)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  {item.icon}
                </svg>
              </div>
              <h3 className="mt-4 text-sm font-bold text-brand-900">{item.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-brand-700">{item.description}</p>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-10 grid max-w-3xl gap-4.5 text-left sm:grid-cols-3">
          {CURSOS_PLACEHOLDER.map((label, index) => (
            <div key={index} className="rounded-[14px] border-[1.5px] border-dashed border-brand-300 bg-brand-50 p-5.5">
              <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-brand-100">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand-700)" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v4l3 2" />
                </svg>
              </div>
              <p className="mt-3.5 text-sm font-bold text-brand-700">{label}</p>
              <p className="mt-1 text-xs text-brand-300">Em preparação</p>
            </div>
          ))}
        </div>

        <div className="mt-16">
          <MountainDivider />
        </div>
      </section>
    </div>
  );
}
