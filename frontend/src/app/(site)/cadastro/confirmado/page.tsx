import Link from 'next/link';

export default function CadastroConfirmadoPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const ok = searchParams.status === 'ok';

  return (
    <section className="bg-gradient-to-b from-brand-50 to-white px-4 pb-16 pt-14 sm:px-10">
      <div className="mx-auto max-w-md text-center">
        {ok ? (
          <>
            <h1 className="text-[28px] font-extrabold text-brand-900 sm:text-[32px]">
              Cadastro confirmado
            </h1>
            <p className="mt-3.5 text-[15.5px] leading-relaxed text-brand-700">Sua conta já está ativa.</p>
            <Link
              href="/login"
              className="mt-8 inline-block rounded-[9px] bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            >
              Entrar
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-[28px] font-extrabold text-brand-900 sm:text-[32px]">
              Link inválido ou expirado
            </h1>
            <p className="mt-3.5 text-[15.5px] leading-relaxed text-brand-700">
              O link de confirmação não é mais válido. Cadastre-se novamente pra receber um novo.
            </p>
            <Link
              href="/cadastro"
              className="mt-8 inline-block rounded-[9px] bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            >
              Voltar ao cadastro
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
