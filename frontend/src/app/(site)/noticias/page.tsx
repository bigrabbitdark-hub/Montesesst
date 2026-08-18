import Link from 'next/link';
import { getAllPosts } from '@/lib/noticias';

export const metadata = { title: 'Notícias — Montese SST' };

export default function NoticiasPage() {
  const posts = getAllPosts();

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold text-brand-900">Notícias</h1>
      <div className="mt-8 flex flex-col gap-8">
        {posts.map((post) => (
          <article key={post.slug} className="border-b border-brand-100 pb-8">
            <Link href={`/noticias/${post.slug}`}>
              <h2 className="text-xl font-semibold text-brand-900 hover:text-brand-700">
                {post.title}
              </h2>
            </Link>
            <p className="mt-1 text-sm text-brand-700">{post.date}</p>
            <p className="mt-2 text-brand-700">{post.excerpt}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
