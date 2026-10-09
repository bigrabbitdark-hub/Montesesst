import { describe, expect, it } from 'vitest';
import { cleanDescription, parseFeed } from '../sstnews-feed';

const item = (over: { title?: string; link?: string; date?: string; desc?: string } = {}) => `<item>
<title>${over.title ?? 'Título &amp; teste'}</title>
<link>${over.link ?? 'https://www.sstnews.com.br/edicoes/a'}</link>
<pubDate>${over.date ?? 'Fri, 09 Oct 2026 00:00:00 GMT'}</pubDate>
<category>Normas Regulamentadoras</category>
<description>${over.desc ?? 'Também nesta edição: A · B Bom dia! Selecionamos o que importa em Saúde e Segurança do Trabalho hoje. Em poucos minutos, o que aconteceu, por que importa e o que fazer agora.'}</description>
</item>`;

describe('sstnews-feed', () => {
  it('remove a frase padrão e separa os destaques', () => {
    expect(cleanDescription('Também nesta edição: A · B Bom dia! Selecionamos o que importa em Saúde e Segurança do Trabalho hoje. Em poucos minutos, o que aconteceu, por que importa e o que fazer agora.')).toEqual(['A', 'B']);
  });

  it('devolve lista vazia quando só há a frase padrão', () => {
    expect(cleanDescription('Bom dia! Selecionamos o que importa em Saúde e Segurança do Trabalho hoje. Em poucos minutos, o que aconteceu, por que importa e o que fazer agora.')).toEqual([]);
  });

  it('decodifica entidades e ordena do mais novo ao mais antigo', () => {
    const posts = parseFeed(`<rss>${item({ date: 'Thu, 08 Oct 2026 00:00:00 GMT' })}${item()}</rss>`);
    expect(posts.map((p) => p.date)).toEqual(['2026-10-09', '2026-10-08']);
    expect(posts[0].title).toBe('Título & teste');
  });

  it('descarta itens com link não-http ou data inválida', () => {
    const posts = parseFeed(`<rss>${item({ link: 'javascript:alert(1)' })}${item({ date: 'xx' })}${item()}</rss>`);
    expect(posts).toHaveLength(1);
  });
});
