'use client';

import { useState } from 'react';

const FAQ_ITEMS = [
  {
    question: 'O que é SST?',
    answer:
      'SST significa Segurança e Saúde do Trabalho — o conjunto de medidas e práticas que protegem a integridade física e mental dos trabalhadores, prevenindo acidentes e doenças ocupacionais.',
  },
  {
    question: 'Por que a SST é obrigatória?',
    answer:
      'Porque a legislação trabalhista brasileira (CLT e as Normas Regulamentadoras do Ministério do Trabalho e Emprego) exige que todo empregador com funcionários CLT mantenha processos de prevenção de acidentes e doenças do trabalho — não é uma escolha, é uma obrigação legal, fiscalizada e sujeita a penalidades.',
  },
  {
    question: 'Quais empresas precisam ter programas de SST?',
    answer:
      'Qualquer empresa com CNPJ e ao menos um funcionário com carteira assinada (CLT), independente do porte ou do setor de atividade — não é uma exigência exclusiva de indústria ou construção civil.',
  },
  {
    question: 'O que é o PCMSO?',
    answer:
      'PCMSO é o Programa de Controle Médico de Saúde Ocupacional (NR-7) — define os exames médicos que a empresa deve oferecer aos funcionários, como admissional, periódico e demissional, para monitorar a saúde relacionada ao trabalho.',
  },
  {
    question: 'O que é o PGR?',
    answer:
      'PGR é o Programa de Gerenciamento de Riscos (NR-1) — o documento que identifica, avalia e define ações de controle para os riscos ocupacionais existentes na empresa: físicos, químicos, biológicos, ergonômicos e de acidentes.',
  },
  {
    question: 'Quais são os exames ocupacionais obrigatórios?',
    answer:
      'Os principais são: admissional (antes de começar), periódico (durante o contrato, com frequência definida pelo PCMSO), de mudança de função, de retorno ao trabalho (após afastamento) e demissional.',
  },
  {
    question: 'Quais são as consequências de não cumprir as normas de SST?',
    answer:
      'Multas aplicadas pela fiscalização do trabalho, interdição ou embargo de atividades em casos graves, e o risco de responsabilização em ações trabalhistas por acidentes ou doenças ocupacionais que poderiam ter sido evitados.',
  },
  {
    question: 'Como a Montese pode ajudar minha empresa?',
    answer:
      'Reunindo toda a gestão de SST — documentos, prazos, conformidade — num só painel, com uma rede de técnicos parceiros de verdade acompanhando sua empresa, em vez de depender de e-mails soltos e planilhas.',
  },
];

export function FAQAccordion() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="mx-auto mt-10 flex max-w-3xl flex-col gap-3">
      {FAQ_ITEMS.map((item, index) => {
        const isOpen = openIndex === index;
        return (
          <div key={item.question} className="overflow-hidden rounded-2xl border border-brand-100 bg-white">
            <button
              type="button"
              onClick={() => setOpenIndex(isOpen ? null : index)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-6 py-4.5 text-left"
            >
              <span className="text-[15px] font-semibold text-brand-900">{item.question}</span>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-brand-500)"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {isOpen && (
              <p className="px-6 pb-5 text-[14px] leading-relaxed text-brand-700">{item.answer}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
