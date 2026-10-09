import { existsSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { assignNewsPhotos, pickNewsPhoto } from '../news-photos';

const CATEGORIES = [
  'NR-1 e riscos psicossociais', 'Normas Regulamentadoras', 'eSocial SST', 'Medicina Ocupacional', 'PGR, PCMSO e LTCAT',
  'Acidentes de Trabalho', 'Fiscalização e Multas', 'Gestão para RH', 'Jurisprudência Trabalhista',
];

describe('pickNewsPhoto', () => {
  it('é estável: a mesma edição sempre recebe a mesma foto', () => {
    expect(pickNewsPhoto('Normas Regulamentadoras', 'https://x/1')).toBe(pickNewsPhoto('Normas Regulamentadoras', 'https://x/1'));
  });

  it('devolve null para categoria desconhecida ou ausente', () => {
    expect(pickNewsPhoto('Outra', 'a')).toBeNull();
    expect(pickNewsPhoto(undefined, 'a')).toBeNull();
  });

  it('todas as fotos mapeadas existem em public/noticias', () => {
    for (const category of CATEGORIES) {
      for (let i = 0; i < 20; i++) {
        const photo = pickNewsPhoto(category, `seed-${i}`);
        expect(photo, category).not.toBeNull();
        expect(existsSync(join(process.cwd(), 'public', photo as string)), photo as string).toBe(true);
      }
    }
  });
});

describe('assignNewsPhotos', () => {
  const make = (n: number, category: string) => Array.from({ length: n }, (_, i) => ({ url: `https://x/${category}/${i}`, category }));

  it('não repete a mesma foto em edições vizinhas quando a categoria tem várias', () => {
    const posts = make(30, 'Normas Regulamentadoras');
    const map = assignNewsPhotos(posts);
    for (let i = 1; i < posts.length; i++) expect(map.get(posts[i].url)).not.toBe(map.get(posts[i - 1].url));
  });

  it('mantém a foto das edições antigas quando chegam edições novas', () => {
    const old = make(10, 'Acidentes de Trabalho');
    const before = assignNewsPhotos(old);
    const withNew = assignNewsPhotos([{ url: 'https://x/nova', category: 'Acidentes de Trabalho' }, ...old]);
    for (const post of old) expect(withNew.get(post.url)).toBe(before.get(post.url));
  });

  it('ignora categorias sem foto', () => {
    expect(assignNewsPhotos([{ url: 'u', category: 'Outra' }]).size).toBe(0);
  });
});
