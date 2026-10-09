// Uso: npx vite-node scripts/sync-sstnews.ts
// Baixa o feed público do SST News e grava só metadados (título, link, data, categoria, resumo curto).
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { parseFeed } from '../src/lib/sstnews-feed';

const FEED_URL = 'https://www.sstnews.com.br/feed.xml';
const OUTPUT = join(process.cwd(), 'content', 'noticias-externas', 'sstnews.json');

async function main() {
  const response = await fetch(FEED_URL, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Feed respondeu HTTP ${response.status}`);
  const posts = parseFeed(await response.text());
  if (posts.length === 0) throw new Error('Feed sem itens válidos; arquivo mantido.');
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify({ source: 'SST News', sourceUrl: 'https://www.sstnews.com.br', syncedAt: new Date().toISOString(), posts }, null, 2) + '\n');
  console.log(`${posts.length} edições gravadas em ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
