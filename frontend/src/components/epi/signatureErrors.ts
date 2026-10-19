import { EpiApiError, mapEpiError } from '@/lib/epi/errors';

// Mensagens fechadas dos erros da assinatura (link e presencial). Regras locais e estreitas: não entram em
// errors.ts para não afetar as outras telas. O texto do servidor só escolhe a mensagem, nunca é exibido.
export function mapSignatureError(err: unknown): string {
  if (!(err instanceof EpiApiError) || err.unexpected) return mapEpiError(err);
  const m = err.serverMessage;
  // termo não aprovado: regra já existente em mapEpiError
  if (/termo .* aprovado/i.test(m)) return mapEpiError(err);
  if (err.status === 503 && /outra opera[çc][ãa]o de assinatura em andamento/i.test(m)) {
    return 'Há outra emissão de assinatura em andamento para este funcionário. Aguarde alguns instantes e tente de novo.';
  }
  if (err.status === 409) {
    if (/Link já emitido/i.test(m)) {
      return 'Um link já foi emitido e o código não pode ser exibido de novo. Gerar outro invalida o anterior.';
    }
    if (/N[ãa]o h[áa] entregas aguardando assinatura/i.test(m)) return 'Não há entregas aguardando assinatura para este funcionário.';
    if (/n[ãa]o aguardam assinatura|j[áa] foram tratadas/i.test(m)) {
      return 'Estas entregas já foram tratadas (assinadas ou registradas). Atualize a tela e confira o histórico.';
    }
    if (/entregas mudaram de situa/i.test(m)) return 'A situação das entregas mudou. Atualize a tela e tente de novo.';
  }
  if (err.status === 404) {
    if (/Entrega n[ãa]o encontrada/i.test(m)) return 'Entrega não encontrada. Atualize a tela e tente de novo.';
    if (/Funcion[áa]rio n[ãa]o encontrado/i.test(m)) return 'Funcionário não encontrado.';
  }
  return mapEpiError(err);
}
