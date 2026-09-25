import { notFound } from 'next/navigation';
import { MDXRemote } from 'next-mdx-remote/rsc';
import { getAllPosts, getPostBySlug } from '@/lib/noticias';

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const post = getPostBySlug(params.slug);
  return { title: post ? `${post.title} — Montese SST` : 'Notícia — Montese SST' };
}

export default function NoticiaPage({ params }: { params: { slug: string } }) {
  const post = getPostBySlug(params.slug);
  if (!post) notFound();

  return (
    <article className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-[28px] font-extrabold text-brand-900 sm:text-[32px]">{post.title}</h1>
      <p className="mt-2 text-sm text-slate-500">{post.date}</p>
      <div className="prose prose-headings:text-brand-900 prose-a:text-brand-500 prose-strong:text-brand-900 mt-8 max-w-none">
        <MDXRemote source={post.content} />
      </div>
    </article>
  );
}
