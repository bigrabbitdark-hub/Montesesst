// Trava de build: falha se dados institucionais DESCONTINUADOS (CNPJ e WhatsApp
// antigos) voltarem ao código do frontend. Roda automaticamente em `npm run build`
// (hook prebuild), inclusive dentro do `docker build`. Os padrões são regex para
// que este arquivo não case com ele mesmo.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PROIBIDOS = [
  { nome: 'CNPJ descontinuado', re: /69[.\s]?203[.\s]?754[\/\s]?0001[-\s]?45|69203754000145/ },
  { nome: 'WhatsApp antigo', re: /48\)?[\s-]*9[\s.-]?2003[\s.-]?1245|5548\s?9?2003\s?1245|\b92003-?1245\b/ },
];
const EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.md', '.mdx', '.html', '.css', '.rsc', '.txt', '.body', '.meta']);
const IGNORAR = new Set(['node_modules', '.next', '.git', 'coverage']);
const achados = [];

function varrer(dir) {
  for (const nome of readdirSync(dir)) {
    if (IGNORAR.has(nome)) continue;
    const caminho = join(dir, nome);
    const st = statSync(caminho);
    if (st.isDirectory()) { varrer(caminho); continue; }
    if (!EXT.has(extname(nome)) || nome === 'check-dados-descontinuados.mjs' || nome === 'dados-institucionais.test.tsx') continue;
    const linhas = readFileSync(caminho, 'utf8').split('\n');
    linhas.forEach((l, i) => {
      for (const p of PROIBIDOS) if (p.re.test(l)) achados.push(`${relative(raiz, caminho)}:${i + 1} (${p.nome})`);
    });
  }
}
// Modo --artefato (hook postbuild): confere o que foi REALMENTE compilado, não só o código-fonte.
const artefato = process.argv.includes('--artefato');
const alvos = artefato ? ['.next/server', '.next/static'] : ['src', 'public', 'content'];
for (const sub of alvos) {
  try { varrer(join(raiz, sub)); } catch { if (artefato) { console.error('Artefato ausente: ' + sub); process.exit(1); } }
}
if (achados.length) {
  console.error('\nBUILD BLOQUEADO: dado institucional descontinuado encontrado:\n  ' + achados.join('\n  '));
  console.error('\nCNPJ e WhatsApp antigo foram removidos de propósito. Fonte única: frontend/src/lib/company.ts\n');
  process.exit(1);
}
console.log('check-dados-descontinuados' + (artefato ? ' (artefato compilado)' : '') + ': OK');
