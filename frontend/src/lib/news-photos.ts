// Fotos reais (Unsplash License) em public/noticias; créditos em public/noticias/CREDITS.md.
const PHOTOS: Record<string, string[]> = {
  'NR-1 e riscos psicossociais': ['psicossociais-1', 'psicossociais-2', 'psicossociais-3', 'psicossociais-4'],
  'Normas Regulamentadoras': ['normas-1', 'normas-2', 'normas-3', 'normas-4', 'normas-5', 'normas-6'],
  'eSocial SST': ['esocial-1', 'rh-1', 'pgr-4'],
  'Medicina Ocupacional': ['medicina-1', 'medicina-2', 'medicina-3'],
  'PGR, PCMSO e LTCAT': ['pgr-1', 'pgr-2', 'pgr-3', 'pgr-4', 'pgr-5'],
  'Acidentes de Trabalho': ['acidentes-1', 'acidentes-2', 'acidentes-3', 'acidentes-4'],
  'Fiscalização e Multas': ['fiscalizacao-1', 'pgr-5', 'normas-6', 'pgr-4'],
  'Gestão para RH': ['rh-1', 'esocial-1', 'psicossociais-2', 'rh-2'],
  'Jurisprudência Trabalhista': ['juris-1', 'juris-2'],
};

function hash(seed: string): number {
  let value = 0;
  for (let i = 0; i < seed.length; i++) value = (value * 31 + seed.charCodeAt(i)) >>> 0;
  return value;
}

// Mesma edição → sempre a mesma foto; edições da mesma categoria alternam entre as fotos disponíveis.
export function pickNewsPhoto(category: string | undefined, seed: string): string | null {
  const pool = category ? PHOTOS[category] : undefined;
  if (!pool || pool.length === 0) return null;
  return `/noticias/${pool[hash(seed) % pool.length]}.jpg`;
}

const RECENT_WINDOW = 6;

// Distribui fotos evitando repetir as usadas há pouco. Recebe as edições da mais nova para a mais antiga
// e percorre ao contrário, então a foto de uma edição já publicada não muda quando chegam edições novas.
export function assignNewsPhotos(postsNewestFirst: { url: string; category: string }[]): Map<string, string> {
  const assigned = new Map<string, string>();
  const recent: string[] = [];
  for (const post of [...postsNewestFirst].reverse()) {
    const pool = PHOTOS[post.category];
    if (!pool || pool.length === 0) continue;
    // Escolhe a foto do pool usada há mais tempo (ou nunca usada); empate resolvido por hash para variar.
    let best = pool[0];
    let bestScore = Infinity;
    for (const name of pool) {
      const lastUse = recent.lastIndexOf(name);
      const score = (lastUse === -1 ? -1000 : lastUse) * 1000 + ((hash(post.url + name) % 997) / 997) * 999;
      if (score < bestScore) {
        best = name;
        bestScore = score;
      }
    }
    recent.push(best);
    if (recent.length > RECENT_WINDOW) recent.shift();
    assigned.set(post.url, `/noticias/${best}.jpg`);
  }
  return assigned;
}
