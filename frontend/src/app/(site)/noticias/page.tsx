import Link from 'next/link';
import Image from 'next/image';
import { getAllPosts, getExternalNews } from '@/lib/noticias';
import { MountainDivider } from '@/components/MountainDivider';
import { NewsCover } from '@/components/NewsCover';
import { NoticiasExternas } from '@/components/NoticiasExternas';

export const metadata = { title: 'Notícias — Montese SST' };

export const revalidate = 86400;

export default async function NoticiasPage() {
  const posts = getAllPosts();
  const external = await getExternalNews();

  return (
    <div>
      <section className="bg-gradient-to-b from-brand-50 to-white px-4 pb-6 pt-16 sm:px-10 sm:pt-20">
        <div className="mx-auto max-w-2xl text-center">
          <Image src="/brand/logo-horizontal-transparente.png" alt="Montese SST" width={1489} height={306} priority className="mx-auto h-16 w-auto sm:h-20" />
          <h1 className="mt-4 text-[36px] font-extrabold text-brand-900 sm:text-[40px]">Notícias</h1>
          <p className="mt-3.5 text-[16.5px] leading-relaxed text-brand-700">
            O que importa em Segurança e Saúde do Trabalho, organizado por tema.
          </p>
          {external && (
            <p className="mt-3 text-[13px] leading-relaxed text-slate-600">
              Resumos das edições do{' '}
              <a href={external.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-500 underline underline-offset-2 hover:text-brand-700">
                {external.source}
              </a>
              . O crédito e o texto completo são da fonte original. Confira sempre a norma oficial.
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">Fotos: Unsplash (licença gratuita).</p>
        </div>

        <div className="mt-10">
          <MountainDivider />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-10">
        {external && external.posts.length > 0 && <NoticiasExternas posts={external.posts} source={external.source} />}

        {posts.length > 0 && (
          <div className={external ? 'mt-16' : ''}>
            <h2 className="text-xl font-extrabold text-brand-900">Publicações do Montese SST</h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <Link
                  key={post.slug}
                  href={`/noticias/${post.slug}`}
                  className="overflow-hidden rounded-2xl border border-brand-100 bg-white transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-900/10"
                >
                  <NewsCover category="Montese SST" />
                  <div className="p-5">
                  <span className="rounded-full bg-brand-700 px-3 py-1 text-[11px] font-semibold text-white">Montese SST</span>
                  <h3 className="mt-3 text-[15.5px] font-bold leading-snug text-brand-900">{post.title}</h3>
                  <p className="mt-2 text-xs text-slate-500">{post.date}</p>
                  <p className="mt-2 text-[13px] leading-relaxed text-brand-700">{post.excerpt}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {!external && posts.length === 0 && <p className="text-center text-brand-700">Novas notícias em breve.</p>}
      </section>
    </div>
  );
}
