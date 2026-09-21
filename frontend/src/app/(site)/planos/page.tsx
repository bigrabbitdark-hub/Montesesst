'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MountainDivider } from '@/components/MountainDivider';
import { PaymentIssuerNote } from '@/components/PaymentIssuerNote';
import { ASSISTANT_STEPS, ASSISTANT_TECHNICIAN_STEP, COMPARISON_TABLE, PLAN_CONTENT } from './plan-content';

interface Plan {
  id: string;
  slug: string;
  name: string;
  price_cents: number;
  employee_limit: number | null;
}

const ENTERPRISE_SLUG = 'empresa-enterprise';
const RECOMMENDED_SLUG = 'empresa-premium';

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function renderCell(value: string | boolean) {
  if (value === true) return <span className="text-brand-500">✓</span>;
  if (value === false) return <span className="text-brand-200">—</span>;
  return <span className="text-brand-700">{value}</span>;
}

export default function PlanosPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loggedIn, setLoggedIn] = useState(false);
  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoggedIn(!!localStorage.getItem('montese_token'));
    fetch('/api/plans?audience=empresa')
      .then((res) => res.json())
      .then(setPlans)
      .catch(() => setPlans([]));
  }, []);

  async function handleSubscribe(planId: string) {
    setError(null);
    setSubscribingPlanId(planId);
    try {
      const token = localStorage.getItem('montese_token');
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan_id: planId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? 'Não foi possível iniciar a assinatura.');
        setSubscribingPlanId(null);
        return;
      }
      const data = await res.json();
      window.location.href = data.initPoint;
    } catch {
      setError('Não foi possível conectar ao servidor.');
      setSubscribingPlanId(null);
    }
  }

  return (
    <div>
      <section className="bg-gradient-to-b from-brand-50 to-white px-4 pb-2 pt-16 sm:px-10 sm:pt-20">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-[36px] font-extrabold text-brand-900 sm:text-[40px]">
            Segurança do Trabalho organizada, acompanhada e acessível.
          </h1>
          <p className="mt-3.5 text-[16.5px] leading-relaxed text-brand-700">
            O Montese SST combina plataforma, inteligência artificial especializada e suporte profissional
            para ajudar sua empresa e o RH a manter a rotina de SST organizada.
          </p>
          <div className="mx-auto mt-6 grid max-w-xl grid-cols-1 gap-x-6 gap-y-2 text-left text-[13.5px] text-brand-700 sm:grid-cols-2">
            <p>
              🤖 <strong>Assistente Montese SST</strong> — organiza informações, documentos e alertas.
            </p>
            <p>
              📚 <strong>Base normativa</strong> — fundamentada em fontes oficiais de SST.
            </p>
            <p>
              📊 <strong>Gestão operacional</strong> — funcionários, documentos, EPIs, inspeções, treinamentos.
            </p>
            <p>
              🔔 <strong>Alertas e acompanhamento</strong> — datas, pendências e pontos de atenção.
            </p>
            <p className="sm:col-span-2 sm:text-center">
              🔐 <strong>Histórico e rastreabilidade</strong> — tudo registrado para consulta e acompanhamento.
            </p>
          </div>
          <p className="mt-6 text-[15px] font-semibold text-brand-900">
            Qual nível de acompanhamento sua empresa precisa?
          </p>
        </div>

        {error && <p className="mt-6 text-center text-sm text-red-600">{error}</p>}

        <div className="mx-auto mt-12 grid max-w-6xl gap-5 pb-16 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => {
            const isEnterprise = plan.slug === ENTERPRISE_SLUG;
            const isRecommended = plan.slug === RECOMMENDED_SLUG;
            const content = PLAN_CONTENT[plan.slug];

            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-2xl p-7 transition-all ${
                  isEnterprise
                    ? 'bg-brand-900'
                    : isRecommended
                      ? 'border-2 border-brand-500 bg-white shadow-xl shadow-brand-500/15'
                      : 'border border-brand-100 bg-white hover:-translate-y-1 hover:shadow-lg'
                }`}
              >
                {isRecommended && (
                  <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-brand-500 px-3.5 py-1 text-[11px] font-bold tracking-wide text-white">
                    RECOMENDADO
                  </span>
                )}

                <h2 className={`text-[17px] font-bold ${isEnterprise ? 'text-white' : 'text-brand-900'}`}>
                  {plan.name}
                </h2>
                {content && (
                  <>
                    <p
                      className={`mt-1 text-[13px] font-semibold italic ${
                        isEnterprise ? 'text-brand-300' : 'text-brand-600'
                      }`}
                    >
                      {content.positioning}
                    </p>
                    <p className={`mt-1.5 text-[13px] ${isEnterprise ? 'text-brand-300' : 'text-brand-700'}`}>
                      {content.subtitle}
                    </p>
                  </>
                )}

                <div className="mt-6">
                  {isEnterprise ? (
                    <span className="text-[22px] font-extrabold text-white">Valores a combinar</span>
                  ) : (
                    <div className="flex items-baseline gap-1">
                      <span className="text-sm font-semibold text-brand-700">R$</span>
                      <span className="text-[38px] font-extrabold text-brand-900">
                        {(plan.price_cents / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                      </span>
                      <span className="text-[13px] text-brand-700">/mês</span>
                    </div>
                  )}
                </div>

                {content && (
                  <ul className="mt-6 flex flex-col gap-2.5">
                    {content.bullets.map((bullet, i) =>
                      bullet.isNote ? (
                        <li
                          key={i}
                          className={`text-[12.5px] font-semibold italic ${
                            isEnterprise ? 'text-brand-200' : 'text-brand-600'
                          }`}
                        >
                          {bullet.text}
                        </li>
                      ) : (
                        <li
                          key={i}
                          className={`flex items-start gap-2 text-[13px] leading-snug ${
                            isEnterprise ? 'text-brand-100' : 'text-brand-700'
                          }`}
                        >
                          <span className={`mt-0.5 ${isEnterprise ? 'text-brand-300' : 'text-brand-500'}`}>
                            <CheckIcon />
                          </span>
                          {bullet.text}
                        </li>
                      ),
                    )}
                  </ul>
                )}

                {plan.employee_limit && (
                  <p className="mt-4 text-[11.5px] text-brand-400">Até {plan.employee_limit} funcionários</p>
                )}

                <div className="flex-1" />

                {isEnterprise ? (
                  <Link
                    href="/contato"
                    className="mt-7 rounded-[9px] bg-white px-4 py-3 text-center text-sm font-semibold text-brand-900 hover:bg-brand-50"
                  >
                    {content?.ctaLabel ?? 'Falar com especialista'}
                  </Link>
                ) : loggedIn ? (
                  <button
                    onClick={() => handleSubscribe(plan.id)}
                    disabled={subscribingPlanId === plan.id}
                    className={`mt-7 rounded-[9px] px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
                      isRecommended
                        ? 'bg-brand-500 text-white hover:bg-brand-700'
                        : 'border-[1.5px] border-brand-500 text-brand-700 hover:bg-brand-50'
                    }`}
                  >
                    {subscribingPlanId === plan.id ? 'Redirecionando...' : (content?.ctaLabel ?? 'Assinar')}
                  </button>
                ) : (
                  <Link
                    href={content?.ctaHref ?? '/login'}
                    className={`mt-7 rounded-[9px] px-4 py-3 text-center text-sm font-semibold transition-colors ${
                      isRecommended
                        ? 'bg-brand-500 text-white hover:bg-brand-700'
                        : 'border-[1.5px] border-brand-500 text-brand-700 hover:bg-brand-50'
                    }`}
                  >
                    {content?.ctaLabel ?? 'Entrar para assinar'}
                  </Link>
                )}
              </div>
            );
          })}
        </div>

        <PaymentIssuerNote className="mx-auto max-w-4xl px-4 pb-10" />

        <div className="mx-auto max-w-4xl px-4 pb-12">
          <h2 className="text-center text-[24px] font-extrabold text-brand-900">
            O Assistente Montese SST está em todos os planos.
          </h2>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-4">
            {ASSISTANT_STEPS.map((step) => (
              <div key={step.title} className="rounded-xl border border-brand-100 bg-white p-4 text-center">
                <p className="text-[14px] font-bold text-brand-900">{step.title}</p>
                <p className="mt-1.5 text-[12.5px] text-brand-700">{step.description}</p>
              </div>
            ))}
            <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50 p-4 text-center opacity-80">
              <p className="text-[14px] font-bold text-brand-700">{ASSISTANT_TECHNICIAN_STEP.title}</p>
              <p className="mt-1.5 text-[12.5px] text-brand-600">{ASSISTANT_TECHNICIAN_STEP.description}</p>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-5xl px-4 pb-16">
          <h2 className="text-center text-[24px] font-extrabold text-brand-900">
            Compare o que sua empresa terá
          </h2>
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-brand-100 text-left text-brand-900">
                  <th className="py-3 pr-4 font-semibold">Recurso</th>
                  <th className="px-4 py-3 text-center font-semibold">Start</th>
                  <th className="px-4 py-3 text-center font-semibold">Premium</th>
                  <th className="px-4 py-3 text-center font-semibold">Super Premium</th>
                  <th className="px-4 py-3 text-center font-semibold">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_TABLE.map((row) => (
                  <tr key={row.feature} className="border-b border-brand-50">
                    <td className="py-3 pr-4 text-brand-700">{row.feature}</td>
                    <td className="px-4 py-3 text-center">{renderCell(row.start)}</td>
                    <td className="px-4 py-3 text-center">{renderCell(row.premium)}</td>
                    <td className="px-4 py-3 text-center">{renderCell(row.superPremium)}</td>
                    <td className="px-4 py-3 text-center">{renderCell(row.enterprise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mx-auto max-w-2xl px-4 pb-6 text-center">
          <p className="text-[15px] leading-relaxed text-brand-700">
            Comece gratuitamente e conheça o Montese SST na prática. Organize sua empresa, conheça o
            Assistente Montese e descubra como a tecnologia pode reduzir o trabalho operacional do RH e
            melhorar o acompanhamento de SST. Sem compromisso durante o período de teste.
          </p>
        </div>

        <div className="mx-auto flex max-w-2xl flex-wrap justify-center gap-3.5 pb-16">
          <Link
            href="/cadastro"
            className="rounded-[9px] bg-brand-500 px-7 py-3.5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Ainda não é cliente? Comece grátis
          </Link>
          <Link
            href="/contato"
            className="rounded-[9px] border-[1.5px] border-brand-500 px-7 py-3.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            Fale com vendas
          </Link>
        </div>

        <MountainDivider />
      </section>
    </div>
  );
}
