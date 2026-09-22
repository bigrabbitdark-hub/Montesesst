import { readFileSync } from 'fs';
import { join } from 'path';
import { detectNotices } from '../src/normative/question-notices';
import { parseEvalArgs } from './args';
import { parseGoldenDataset } from './golden/golden-schema';

// eval:notices — compara, para cada pergunta do dataset, os avisos ESPERADOS com
// os que o detector determinístico (question-notices.ts) realmente dispara.
// Não usa banco, embedding nem LLM: é grátis e serve de ajuda de autoria. Uma
// diferença tem dois significados possíveis, e quem redige decide qual:
//   - a pergunta foi escrita de um jeito que dispara/omite o aviso sem querer
//     (reescreva a pergunta); ou
//   - o detector tem uma lacuna real (mantenha a pergunta: é justamente o que o
//     golden existe para expor — a Camada A vai reprová-la).
// Só informa; nunca sai com erro por causa de uma diferença.
//
// Uso: ./run-backend-tests.sh eval:notices [-- --file caminho.json]
const DEFAULT_FILE = join(__dirname, 'golden', 'perguntas.json');

const args = parseEvalArgs(process.argv.slice(2));
const questions = parseGoldenDataset(JSON.parse(readFileSync(args.file ?? DEFAULT_FILE, 'utf8')));

let diferentes = 0;
for (const q of questions) {
  const detectados = detectNotices(q.pergunta).map((notice) => notice.tipo);
  const iguais =
    detectados.length === q.avisos_esperados.length && detectados.every((tipo) => q.avisos_esperados.includes(tipo));
  if (!iguais) {
    diferentes += 1;
    console.log(`DIFERENTE ${q.id}: esperado=${JSON.stringify(q.avisos_esperados)} detectado=${JSON.stringify(detectados)}`);
  }
}
console.log(`\n[eval:notices] ${questions.length - diferentes}/${questions.length} perguntas com avisos iguais aos esperados`);
