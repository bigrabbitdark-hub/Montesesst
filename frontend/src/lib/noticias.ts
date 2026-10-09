import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { parseFeed, type ExternalPost } from './sstnews-feed';

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

export interface ExternalNews {
  source: string;
  sourceUrl: string;
  syncedAt: string;
  posts: ExternalPost[];
}

const SSTNEWS_FEED_URL = 'https://www.sstnews.com.br/feed.xml';
const SSTNEWS_REVALIDATE_SECONDS = 60 * 60 * 24;

function readExternalSnapshot(): ExternalNews | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'content', 'noticias-externas', 'sstnews.json'), 'utf-8'));
  } catch {
    return null;
  }
}

type FeedFetcher = (url: string, init: { next: { revalidate: number }; signal: AbortSignal }) => Promise<Response>;

// Busca o feed público (sem cookies nem dados de tenant). Se falhar ou vier vazio,
// usa o último snapshot gravado por scripts/sync-sstnews.ts.
export async function getExternalNews(fetcher: FeedFetcher = fetch as FeedFetcher): Promise<ExternalNews | null> {
  const snapshot = readExternalSnapshot();
  try {
    const response = await fetcher(SSTNEWS_FEED_URL, {
      next: { revalidate: SSTNEWS_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return snapshot;
    const posts = parseFeed(await response.text());
    if (posts.length === 0) return snapshot;
    return {
      source: 'SST News',
      sourceUrl: 'https://www.sstnews.com.br',
      syncedAt: new Date().toISOString(),
      posts,
    };
  } catch {
    return snapshot;
  }
}
