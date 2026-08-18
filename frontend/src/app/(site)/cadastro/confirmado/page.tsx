import Link from 'next/link';

export default function CadastroConfirmadoPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const ok = searchParams.status === 'ok';

  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      {ok ? (
        <>
          <h1 className="text-2xl font-bold text-brand-900">Cadastro confirmado</h1>
          <p className="mt-4 text-brand-700">Sua conta já está ativa.</p>
          <Link
            href="/login"
            className="mt-8 inline-block rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700"
          >
            Entrar
          </Link>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold text-brand-900">Link inválido ou expirado</h1>
          <p className="mt-4 text-brand-700">
            O link de confirmação não é mais válido. Cadastre-se novamente pra receber um novo.
          </p>
          <Link
            href="/cadastro"
            className="mt-8 inline-block rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700"
          >
            Voltar ao cadastro
          </Link>
        </>
      )}
    </div>
  );
}
