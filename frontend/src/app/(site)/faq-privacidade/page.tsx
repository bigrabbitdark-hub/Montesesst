import { MDXRemote } from 'next-mdx-remote/rsc';
import { getLegalDoc } from '@/lib/legal';

export function generateMetadata() {
  return { title: 'FAQ de Segurança e Privacidade — Montese SST' };
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export default function FaqPrivacidadePage() {
  const doc = getLegalDoc('faq');

  return (
    <article className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-[28px] font-extrabold text-brand-900 sm:text-[32px]">{doc.title}</h1>
      <p className="mt-2 text-sm text-slate-500">Última atualização: {formatDate(doc.updatedAt)}</p>
      <div className="prose prose-headings:text-brand-900 prose-a:text-brand-500 prose-strong:text-brand-900 mt-8 max-w-none">
        <MDXRemote source={doc.content} />
      </div>
    </article>
  );
}
