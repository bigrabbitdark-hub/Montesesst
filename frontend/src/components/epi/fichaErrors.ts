import { EpiApiError, mapEpiError } from '@/lib/epi/errors';

export type FichaCtx = 'carregar' | 'previa' | 'emitir' | 'baixar' | 'verificar' | 'comprovante' | 'funcionarios';

// Mensagens fechadas das fichas. Regras locais e estreitas (não entram em errors.ts); o texto do servidor só escolhe a mensagem.
export function mapFichaError(err: unknown, ctx: FichaCtx): string {
  if (!(err instanceof EpiApiError) || err.unexpected) return mapEpiError(err);
  const m = err.serverMessage;
  if (err.status === 400 && /Ficha muito grande/i.test(m)) {
    return 'A ficha tem registros demais para um único documento. Restrinja o período e tente de novo.';
  }
  if (err.status === 400 && (ctx === 'carregar' || ctx === 'previa' || ctx === 'emitir')) {
    return 'Verifique o período e a situação da assinatura escolhidos e tente de novo.';
  }
  if (err.status === 404 && ctx === 'funcionarios') return 'Não foi possível carregar os funcionários desta empresa.';
  if (err.status === 404) {
    if (ctx === 'baixar' || ctx === 'verificar') return 'O arquivo deste documento não está disponível.';
    if (ctx === 'comprovante') return 'Comprovante não encontrado.';
    return 'Funcionário não encontrado. Atualize a lista e tente de novo.';
  }
  if (err.status === 409 && ctx === 'emitir') {
    return 'Esta emissão já foi registrada com outros dados. Atualize a lista de versões e confira antes de emitir de novo.';
  }
  if (err.status === 502) {
    if (ctx === 'emitir') return 'Não foi possível guardar o documento agora. Nenhuma versão foi criada; tente de novo em instantes.';
    if (ctx === 'baixar' || ctx === 'verificar') return 'Não foi possível ler o documento agora. Tente novamente em instantes.';
    if (ctx === 'previa') return 'Não foi possível gerar a prévia agora. Tente novamente em instantes.';
  }
  return mapEpiError(err);
}
