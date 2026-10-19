// Erros do módulo de EPI. A mensagem do servidor NUNCA vai para a tela: só serve para escolher
// uma das mensagens fixas abaixo (lista fechada).
export class EpiApiError extends Error {
  // unexpected = resposta 2xx que não é JSON (servidor respondeu, mas algo no caminho quebrou o corpo).
  constructor(public status: number, public serverMessage: string, public attemptsLeft?: number, public unexpected = false) {
    super(serverMessage);
    this.name = 'EpiApiError';
  }
}

const RULES: Array<[RegExp, string]> = [
  [/Estoque insuficiente/i, 'Estoque insuficiente para esta operação.'],
  [/CA vencido/i, 'O CA deste EPI está vencido: não é possível entregá-lo.'],
  [/^Lote já existe com outra validade/i, 'Já existe um lote com este código e outra validade.'],
  [/Lote vencido/i, 'O lote selecionado está vencido.'],
  [/Devolução maior que a quantidade entregue/i, 'A devolução é maior que a quantidade entregue a este funcionário.'],
  [/Estorne antes as devoluções/i, 'Estorne antes as devoluções deste funcionário neste EPI.'],
  [/já estornada/i, 'Esta movimentação já foi estornada.'],
  [/Saldo máximo excedido/i, 'O saldo máximo permitido seria excedido.'],
  [/Chave de idempotência/i, 'Esta operação já foi registrada. Atualize a tela e confira o histórico.'],
  [/EPI inativo/i, 'Este EPI está inativo.'],
  [/movimenta[çc][ãa]o de estoque/i, 'Este EPI usa o registro de movimentação: registre a entrega em Movimentação.'],
  [/termo .* aprovado/i, 'O termo de recebimento ainda não foi aprovado. A assinatura eletrônica fica indisponível até a aprovação.'],
  [/Já existe movimenta/i, 'Este EPI já tem movimentação: use Entrada ou Ajuste.'],
  [/controle de lote com movimenta/i, 'O controle de lote não pode ser alterado: este EPI já tem movimentação.'],
  [/Já existe uma emissão em andamento/i, 'Já existe uma emissão em andamento para este funcionário. Tente de novo em instantes.'],
];

export function mapEpiError(err: unknown): string {
  if (!(err instanceof EpiApiError)) return 'Não foi possível conectar ao servidor. Verifique a conexão e tente de novo.';
  if (err.status === 401) return 'Sua sessão expirou. Entre novamente.';
  if (err.status === 403) return 'Você não tem permissão para esta ação.';
  if (err.status === 404) return 'Registro não encontrado.';
  if (err.status === 429) return 'Muitas tentativas. Aguarde alguns minutos.';
  if (err.unexpected) return 'Resposta inesperada do servidor. Atualize a tela e tente de novo.';
  // As regras vêm antes do 502/503: a emissão de ficha em andamento é respondida pelo backend com 503.
  for (const [re, msg] of RULES) if (re.test(err.serverMessage)) return msg;
  if (err.status === 502 || err.status === 503) return 'O serviço está indisponível agora. Tente novamente em instantes.';
  if (err.status === 400) return 'Verifique os dados informados e tente de novo.';
  if (err.status === 409) return 'A operação conflita com o estado atual. Atualize a tela e tente de novo.';
  return 'Não foi possível concluir a operação. Tente novamente.';
}
