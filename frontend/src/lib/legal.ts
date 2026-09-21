import { readFileSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { fillCompanyTokens } from './company';

const CONTENT_DIR = join(process.cwd(), 'content', 'legal');

export interface LegalDoc {
  title: string;
  updatedAt: string;
  content: string;
}

export function getLegalDoc(slug: string): LegalDoc {
  const raw = readFileSync(join(CONTENT_DIR, `${slug}.mdx`), 'utf-8');
  const { data, content } = matter(raw);
  return { title: data.title, updatedAt: data.updatedAt, content: fillCompanyTokens(content) };
}
