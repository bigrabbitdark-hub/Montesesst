import Link from 'next/link';

// Wordmark de texto temporário — arquivo-fonte do logo (vetor/alta
// resolução) ainda não foi enviado (docs/vision.md seção 4). Trocar só
// este componente quando o arquivo real chegar, sem mexer no resto do site.
export function Logo() {
  return (
    <Link href="/" className="text-xl font-bold text-brand-700">
      Montese
    </Link>
  );
}
