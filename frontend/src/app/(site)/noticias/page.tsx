import Link from 'next/link';
import { getAllPosts } from '@/lib/noticias';
import { MountainDivider } from '@/components/MountainDivider';

export const metadata = { title: 'Notícias — Montese SST' };

const FONTES = ['MTE', 'eSocial', 'INSS', 'Diário Oficial da União'];

export default function NoticiasPage() {
  const posts = getAllPosts();

  return (
    <div>
      <section className="bg-gradient-to-b from-brand-50 to-white px-4 pb-6 pt-16 sm:px-10 sm:pt-20">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-[36px] font-extrabold text-brand-900 sm:text-[40px]">Notícias</h1>
          <p className="mt-3.5 text-[16.5px] leading-relaxed text-brand-700">
            Tudo sobre Segurança e Saúde do Trabalho, direto de fontes oficiais.
          </p>
        </div>

        <div className="mx-auto mt-7 flex max-w-3xl flex-wrap items-center justify-center gap-2.5">
          <span className="mr-1 text-xs font-semibold text-brand-700">Fontes que acompanhamos:</span>
          {FONTES.map((fonte) => (
            <span key={fonte} className="rounded-full border border-brand-100 bg-brand-50 px-3.5 py-1.5 text-xs font-semibold text-brand-700">
              {fonte}
            </span>
          ))}
        </div>

        <div className="mt-10">
          <MountainDivider />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-10">
        {posts.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/noticias/${post.slug}`}
                className="overflow-hidden rounded-2xl border border-brand-100 bg-white transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-900/10"
              >
                <div className="flex h-[130px] items-center justify-center bg-gradient-to-br from-brand-100 to-brand-300">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand-700)" strokeWidth="1.8">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                </div>
                <div className="p-5">
                  <h2 className="text-[15.5px] font-bold leading-snug text-brand-900">{post.title}</h2>
                  <p className="mt-2.5 text-xs text-slate-500">{post.date}</p>
                  <p className="mt-2 text-[13px] leading-relaxed text-brand-700">{post.excerpt}</p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-center text-brand-700">Novas notícias em breve.</p>
        )}
      </section>
    </div>
  );
}
