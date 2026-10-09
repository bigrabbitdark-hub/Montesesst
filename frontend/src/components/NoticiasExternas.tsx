'use client';

import { useMemo, useState } from 'react';
import type { ExternalPost } from '@/lib/sstnews-feed';
import { assignNewsPhotos } from '@/lib/news-photos';
import { NewsCover } from './NewsCover';

const PAGE_SIZE = 12;
const TODAS = 'Todas';

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

function SourceLink({ post, source }: { post: ExternalPost; source: string }) {
  return (
    <a
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-500 hover:text-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
    >
      Ler na fonte
      <span className="sr-only"> (abre {source} em nova aba): {post.title}</span>
      <span aria-hidden="true">↗</span>
    </a>
  );
}

export function NoticiasExternas({ posts, source }: { posts: ExternalPost[]; source: string }) {
  const [category, setCategory] = useState(TODAS);
  const [page, setPage] = useState(1);

  // Atribuição sobre a lista completa: filtrar por categoria não muda a foto de cada edição.
  const photos = useMemo(() => assignNewsPhotos(posts), [posts]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    posts.forEach((post) => counts.set(post.category, (counts.get(post.category) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [posts]);

  const filtered = category === TODAS ? posts : posts.filter((post) => post.category === category);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const [featured, ...rest] = filtered;
  const visible = page === 1 ? rest.slice(0, PAGE_SIZE - 1) : filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const select = (value: string) => {
    setCategory(value);
    setPage(1);
  };

  return (
    <div>
      <div role="group" aria-label="Filtrar por categoria" className="flex flex-wrap gap-2">
        {[[TODAS, posts.length] as const, ...categories].map(([name, count]) => (
          <button
            key={name}
            type="button"
            onClick={() => select(name)}
            aria-pressed={category === name}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${
              category === name
                ? 'border-brand-500 bg-brand-500 text-white'
                : 'border-brand-100 bg-brand-50 text-brand-700 hover:bg-brand-100'
            }`}
          >
            {name} <span className="opacity-75">({count})</span>
          </button>
        ))}
      </div>

      <p className="mt-4 text-xs text-slate-500" role="status" aria-live="polite">
        {filtered.length} {filtered.length === 1 ? 'edição' : 'edições'}
        {category !== TODAS ? ` em ${category}` : ''}
      </p>

      {featured && page === 1 && (
        <article className="mt-6 overflow-hidden rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50 to-white sm:grid sm:grid-cols-[260px_1fr]">
          <NewsCover category={featured.category} seed={featured.url} photo={photos.get(featured.url) ?? null} className="h-48 sm:h-full sm:min-h-[260px]" sizes="(min-width: 640px) 260px, 100vw" priority />
          <div className="p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="rounded-full bg-brand-700 px-3 py-1 text-white">Mais recente</span>
            <span className="text-brand-700">{featured.category}</span>
            <span className="text-slate-500">{formatDate(featured.date)}</span>
          </div>
          <h2 className="mt-3 text-xl font-extrabold leading-snug text-brand-900 sm:text-2xl">{featured.title}</h2>
          {featured.extras.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-brand-700">
              {featured.extras.map((extra) => <li key={extra}>{extra}</li>)}
            </ul>
          )}
          <p className="mt-4 text-xs text-slate-500">Fonte: {source}</p>
          <SourceLink post={featured} source={source} />
          </div>
        </article>
      )}

      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((post) => (
          <article key={post.url} className="flex flex-col overflow-hidden rounded-2xl border border-brand-100 bg-white transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-900/10">
            <NewsCover category={post.category} seed={post.url} photo={photos.get(post.url) ?? null} />
            <div className="flex flex-1 flex-col p-5">
            <span className="w-fit rounded-full bg-brand-100 px-3 py-1 text-[11px] font-semibold text-brand-700">{post.category}</span>
            <h3 className="mt-3 text-[15.5px] font-bold leading-snug text-brand-900">{post.title}</h3>
            <p className="mt-2 text-xs text-slate-500">{formatDate(post.date)} · Fonte: {source}</p>
            {post.extras.length > 0 && (
              <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-brand-700">{post.extras.join(' · ')}</p>
            )}
            <div className="mt-auto"><SourceLink post={post} source={source} /></div>
            </div>
          </article>
        ))}
      </div>

      {totalPages > 1 && (
        <nav aria-label="Paginação" className="mt-10 flex items-center justify-center gap-4 text-sm font-semibold">
          <button type="button" onClick={() => setPage(page - 1)} disabled={page === 1} className="rounded-lg border border-brand-100 px-4 py-2 text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40">
            Anterior
          </button>
          <span className="text-brand-700" aria-current="page">Página {page} de {totalPages}</span>
          <button type="button" onClick={() => setPage(page + 1)} disabled={page === totalPages} className="rounded-lg border border-brand-100 px-4 py-2 text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40">
            Próxima
          </button>
        </nav>
      )}
    </div>
  );
}
