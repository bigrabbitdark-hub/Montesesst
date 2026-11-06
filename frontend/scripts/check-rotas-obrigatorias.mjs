// Trava de build: falha se o frontend estiver sem módulos que já foram entregues
// (EPI, tabela de funcionários, painéis). Evita publicar imagem construída a partir
// de uma linhagem de branch antiga (regressão de 06/11/2026). Roda em prebuild
// (código-fonte) e postbuild --artefato (o que foi realmente compilado).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const OBRIGATORIAS = [
  'empresa/epi',
  'empresa/epi/cadastro',
  'empresa/epi/movimentacao',
  'empresa/epi/fichas',
  'empresa/funcionarios',
  'assinar',
];
const artefato = process.argv.includes('--artefato');
const base = artefato ? '.next/server/app' : 'src/app';
const faltando = OBRIGATORIAS.filter((r) => {
  const dir = join(raiz, base, r);
  return artefato ? !(existsSync(dir) || existsSync(dir + '.html')) : !existsSync(join(dir, 'page.tsx'));
});
if (faltando.length) {
  console.error('\nBUILD BLOQUEADO: rotas obrigatórias ausentes (' + (artefato ? 'artefato' : 'código') + '):\n  ' + faltando.join('\n  '));
  console.error('\nEste código parece vir de uma linhagem de branch antiga. Construa a partir da base de produção (release/painel-e5-20261103 ou posterior).\n');
  process.exit(1);
}
console.log('check-rotas-obrigatorias' + (artefato ? ' (artefato compilado)' : '') + ': OK');
