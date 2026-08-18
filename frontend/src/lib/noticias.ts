import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';

const CONTENT_DIR = join(process.cwd(), 'content', 'noticias');

export interface PostMeta {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
}

export interface Post extends PostMeta {
  content: string;
}

function readAllFiles(): { slug: string; raw: string }[] {
  return readdirSync(CONTENT_DIR)
    .filter((file) => file.endsWith('.mdx'))
    .map((file) => ({
      slug: file.replace(/\.mdx$/, ''),
      raw: readFileSync(join(CONTENT_DIR, file), 'utf-8'),
    }));
}

export function getAllPosts(): PostMeta[] {
  return readAllFiles()
    .map(({ slug, raw }) => {
      const { data } = matter(raw);
      return { slug, title: data.title, date: data.date, excerpt: data.excerpt };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPostBySlug(slug: string): Post | null {
  const file = readAllFiles().find((entry) => entry.slug === slug);
  if (!file) return null;
  const { data, content } = matter(file.raw);
  return { slug, title: data.title, date: data.date, excerpt: data.excerpt, content };
}
