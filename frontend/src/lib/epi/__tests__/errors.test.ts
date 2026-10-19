import { describe, it, expect } from 'vitest';
import { EpiApiError, mapEpiError } from '../errors';

const e = (status: number, msg = '') => new EpiApiError(status, msg);

describe('mapEpiError', () => {
  it.each([
    ['Estoque insuficiente (saldo 2)', 'Estoque insuficiente para esta operação.'],
    ['CA vencido', 'O CA deste EPI está vencido: não é possível entregá-lo.'],
    ['Lote vencido', 'O lote selecionado está vencido.'],
    ['Devolução maior que a quantidade entregue', 'A devolução é maior que a quantidade entregue a este funcionário.'],
    ['Estorne antes as devoluções deste funcionário', 'Estorne antes as devoluções deste funcionário neste EPI.'],
    ['Movimentação já estornada', 'Esta movimentação já foi estornada.'],
    ['Saldo máximo excedido', 'O saldo máximo permitido seria excedido.'],
    ['Chave de idempotência reutilizada com outro conteúdo', 'Esta operação já foi registrada. Atualize a tela e confira o histórico.'],
    ['EPI inativo', 'Este EPI está inativo.'],
    ['Este EPI usa movimentação de estoque', 'Este EPI usa o registro de movimentação: registre a entrega em Movimentação.'],
    ['O termo de recebimento não está aprovado', 'O termo de recebimento ainda não foi aprovado. A assinatura eletrônica fica indisponível até a aprovação.'],
    ['Já existe movimentação para este EPI', 'Este EPI já tem movimentação: use Entrada ou Ajuste.'],
    ['Não é possível alterar o controle de lote com movimentações registradas', 'O controle de lote não pode ser alterado: este EPI já tem movimentação.'],
    ['Já existe uma emissão em andamento', 'Já existe uma emissão em andamento para este funcionário. Tente de novo em instantes.'],
  ])('regra "%s" (409/400) vira mensagem fixa', (server, expected) => {
    expect(mapEpiError(e(409, server))).toBe(expected);
    expect(mapEpiError(e(400, server))).toBe(expected);
  });

  it('"Registro duplicado" fora do cadastro cai na mensagem genérica de 409', () => {
    expect(mapEpiError(e(409, 'Registro duplicado'))).toBe('A operação conflita com o estado atual. Atualize a tela e tente de novo.');
  });

  it('aceita "movimentacao de estoque" sem acento', () => {
    expect(mapEpiError(e(409, 'usa movimentacao de estoque'))).toContain('registro de movimentação');
  });

  it.each([
    [401, 'Sua sessão expirou. Entre novamente.'],
    [403, 'Você não tem permissão para esta ação.'],
    [404, 'Registro não encontrado.'],
    [429, 'Muitas tentativas. Aguarde alguns minutos.'],
  ])('status %i tem prioridade e mensagem fixa', (status, expected) => {
    expect(mapEpiError(e(status, 'Estoque insuficiente'))).toBe(expected);
  });

  it('502 genérico é "serviço indisponível"', () => {
    expect(mapEpiError(e(502, 'Bad Gateway'))).toBe('O serviço está indisponível agora. Tente novamente em instantes.');
  });
  it('503 com a mensagem real do backend (emissão em andamento) usa a regra, não "indisponível"', () => {
    const out = mapEpiError(e(503, 'Já existe uma emissão em andamento para este funcionário; tente novamente'));
    expect(out).toBe('Já existe uma emissão em andamento para este funcionário. Tente de novo em instantes.');
  });
  it('503 genérico continua "serviço indisponível"', () => {
    expect(mapEpiError(e(503, 'Service Unavailable'))).toBe('O serviço está indisponível agora. Tente novamente em instantes.');
    expect(mapEpiError(e(503, ''))).toContain('indisponível');
  });
  it('resposta 2xx inesperada tem mensagem própria', () => {
    expect(mapEpiError(new EpiApiError(200, '', undefined, true))).toBe('Resposta inesperada do servidor. Atualize a tela e tente de novo.');
  });
  it('400 e 409 genéricos', () => {
    expect(mapEpiError(e(400, 'algo'))).toBe('Verifique os dados informados e tente de novo.');
    expect(mapEpiError(e(409, 'algo'))).toBe('A operação conflita com o estado atual. Atualize a tela e tente de novo.');
  });

  it('outros status (500) caem no texto genérico', () => {
    expect(mapEpiError(e(500, 'boom'))).toBe('Não foi possível concluir a operação. Tente novamente.');
  });

  it('erro que não é EpiApiError (rede) vira mensagem de conexão', () => {
    expect(mapEpiError(new TypeError('Failed to fetch'))).toBe('Não foi possível conectar ao servidor. Verifique a conexão e tente de novo.');
    expect(mapEpiError(undefined)).toContain('conectar ao servidor');
  });

  it('nunca devolve texto cru do servidor', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 502, 503]) {
      const out = mapEpiError(e(status, 'SELECT secreto FROM users'));
      expect(out).not.toContain('SELECT');
      expect(out).not.toContain('secreto');
    }
  });

  it('EpiApiError guarda status, mensagem e tentativas restantes', () => {
    const err = new EpiApiError(400, 'x', 2);
    expect([err.status, err.serverMessage, err.attemptsLeft]).toEqual([400, 'x', 2]);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('mapEpiError: lote existente com outra validade', () => {
  it('409 "Lote já existe com outra validade" tem mensagem própria', () => {
    expect(mapEpiError(e(409, 'Lote já existe com outra validade'))).toBe('Já existe um lote com este código e outra validade.');
  });
  it('mensagens parecidas não são capturadas indevidamente', () => {
    expect(mapEpiError(e(409, 'Outro erro: Lote já existe com outra validade'))).not.toBe('Já existe um lote com este código e outra validade.');
    expect(mapEpiError(e(409, 'Lote vencido'))).toBe('O lote selecionado está vencido.');
    expect(mapEpiError(e(409, 'Já existe movimentação'))).toBe('Este EPI já tem movimentação: use Entrada ou Ajuste.');
  });
});
