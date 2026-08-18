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
      <h1 className="text-3xl font-bold text-brand-900">{post.title}</h1>
      <p className="mt-1 text-sm text-brand-700">{post.date}</p>
      <div className="prose mt-8 max-w-none">
        <MDXRemote source={post.content} />
      </div>
    </article>
  );
}
