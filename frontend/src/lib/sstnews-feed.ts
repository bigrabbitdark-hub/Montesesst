export interface ExternalPost {
  title: string;
  url: string;
  date: string; // YYYY-MM-DD
  category: string;
  extras: string[];
}

const BOILERPLATE = /Bom dia!\s*Selecionamos o que importa[\s\S]*?o que fazer agora\.?/i;
const EXTRAS_PREFIX = /^\s*Também nesta edição:\s*/i;

function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function tag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return match ? decode(match[1]) : '';
}

export function cleanDescription(description: string): string[] {
  const withoutBoilerplate = description.replace(BOILERPLATE, '').replace(EXTRAS_PREFIX, '').trim();
  if (!withoutBoilerplate) return [];
  return withoutBoilerplate
    .split(' · ')
    .map((part) => part.trim())
    .filter(Boolean);
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

export function parseFeed(xml: string): ExternalPost[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const posts: ExternalPost[] = [];
  for (const item of items) {
    const title = tag(item, 'title');
    const url = tag(item, 'link');
    const pubDate = new Date(tag(item, 'pubDate'));
    if (!title || !isHttpUrl(url) || Number.isNaN(pubDate.getTime())) continue;
    posts.push({
      title,
      url,
      date: pubDate.toISOString().slice(0, 10),
      category: tag(item, 'category') || 'Geral',
      extras: cleanDescription(tag(item, 'description')),
    });
  }
  return posts.sort((a, b) => (a.date < b.date ? 1 : -1));
}
