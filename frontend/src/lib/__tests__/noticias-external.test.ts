import { describe, expect, it } from 'vitest';
import { getExternalNews } from '../noticias';

const feed = `<rss><item><title>Nova</title><link>https://www.sstnews.com.br/edicoes/x</link><pubDate>Fri, 09 Oct 2026 00:00:00 GMT</pubDate><category>eSocial SST</category><description>Também nesta edição: A</description></item></rss>`;
const ok = (body: string, status = 200) => async () => new Response(body, { status });

describe('getExternalNews', () => {
  it('usa o feed quando responde com itens válidos', async () => {
    const news = await getExternalNews(ok(feed));
    expect(news?.posts).toHaveLength(1);
    expect(news?.posts[0].title).toBe('Nova');
  });

  it.each([
    ['HTTP de erro', ok('x', 503)],
    ['feed sem itens', ok('<rss></rss>')],
    ['falha de rede', async () => { throw new Error('offline'); }],
  ])('cai no snapshot em %s', async (_name, fetcher) => {
    const news = await getExternalNews(fetcher);
    expect(news?.source).toBe('SST News');
    expect(news?.posts.length).toBeGreaterThan(1);
  });
});
