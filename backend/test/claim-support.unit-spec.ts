import { checkClaimSupport } from '../src/normative/claim-support';

describe('checkClaimSupport (unit)', () => {
  describe('itens', () => {
    it('claim sem item nem NR não tem nada a bloquear', () => {
      expect(checkClaimSupport('É obrigatório o uso de capacete.', ['Trecho sobre capacete.'])).toEqual({
        blocking: [],
        logged: [],
      });
    });

    it('item presente exatamente no trecho é apoiado', () => {
      const result = checkClaimSupport('Conforme o item 35.4.4, a organização avalia a saúde.', [
        '35.4.4 Cabe à organização avaliar o estado de saúde dos empregados',
      ]);
      expect(result.blocking).toEqual([]);
    });

    it('item pai é apoiado por um trecho que contém o descendente (35.4 apoiado por 35.4.4)', () => {
      const result = checkClaimSupport('Segundo o item 35.4 há exigência de capacitação.', [
        '35.4.4 Cabe à organização avaliar o estado de saúde',
      ]);
      expect(result.blocking).toEqual([]);
    });

    it('item inventado é bloqueado', () => {
      const result = checkClaimSupport('O item 35.4.7 exige treinamento anual.', [
        '35.4.4 Cabe à organização avaliar o estado de saúde',
        '35.4.1 Outro texto qualquer',
      ]);
      expect(result.blocking).toEqual(['item 35.4.7']);
    });

    it('35.4.4 NÃO é apoiado por 35.4.44 (borda numérica)', () => {
      const result = checkClaimSupport('Conforme o item 35.4.4.', ['35.4.44 texto de outro item']);
      expect(result.blocking).toEqual(['item 35.4.4']);
    });

    it('5.4 NÃO casa dentro de 35.4 (borda à esquerda)', () => {
      const result = checkClaimSupport('Conforme o item 5.4.', ['35.4 texto de outro item']);
      expect(result.blocking).toEqual(['item 5.4']);
    });

    it('item de 3 segmentos sem a palavra "item" também é verificado', () => {
      const result = checkClaimSupport('A regra do 18.7.1 se aplica.', ['18.7.2 texto']);
      expect(result.blocking).toEqual(['item 18.7.1']);
    });

    it('milhar (2.000 e 1.000.000) não é tratado como item', () => {
      expect(checkClaimSupport('A multa é de 2.000 reais.', ['sem números aqui']).blocking).toEqual([]);
      expect(checkClaimSupport('Há 1.000.000 de casos.', ['sem números aqui']).blocking).toEqual([]);
    });

    it('a palavra "item" antes do token faz ele contar como item mesmo parecendo milhar', () => {
      const result = checkClaimSupport('Veja o item 2.000 da norma.', ['sem números aqui']);
      expect(result.blocking).toEqual(['item 2.000']);
    });

    it('decimal com unidade colada (3.5 metros) é número, não item', () => {
      const result = checkClaimSupport('A altura mínima é de 3.5 metros.', ['sem números aqui']);
      expect(result.blocking).toEqual([]);
      expect(result.logged).toEqual(['3.5 metros']);
    });

    it('data com pontos (12.09.2025) não vira o falso item 12.09', () => {
      expect(checkClaimSupport('O documento venceu em 12.09.2025.', ['sem números aqui']).blocking).toEqual([]);
    });

    it('item repetido na claim aparece uma vez só', () => {
      const result = checkClaimSupport('O item 9.9.9 e de novo o item 9.9.9.', ['nada']);
      expect(result.blocking).toEqual(['item 9.9.9']);
    });
  });

  describe('NR', () => {
    it('NR-07 e NR-7 são a mesma norma', () => {
      const result = checkClaimSupport('Conforme a NR-07, o PCMSO é obrigatório.', ['... de acordo com a NR-7 ...']);
      expect(result.blocking).toEqual([]);
    });

    it('o código da fonte, quando entra como evidência, apoia a NR citada', () => {
      const result = checkClaimSupport('Segundo a NR-35, o trabalhador precisa de capacitação.', [
        'NR-35 Trabalho em Altura',
        'Trecho que não repete o nome da norma.',
      ]);
      expect(result.blocking).toEqual([]);
    });

    it('NR citada que não está em nenhuma evidência é bloqueada', () => {
      const result = checkClaimSupport('A NR-18 também exige isso.', ['NR-35 Trabalho em Altura', 'texto']);
      expect(result.blocking).toEqual(['NR-18']);
    });
  });

  describe('números com unidade (só registrados)', () => {
    it('número por extenso na evidência vai para logged e nunca para blocking', () => {
      const result = checkClaimSupport('O prazo é de 8 horas.', ['o curso tem carga de oito horas']);
      expect(result.blocking).toEqual([]);
      expect(result.logged).toEqual(['8 horas']);
    });

    it('número com parêntese por extenso na evidência ("8 (oito) horas") é apoiado', () => {
      const result = checkClaimSupport('O curso tem 8 horas.', ['carga horária de 8 (oito) horas']);
      expect(result.logged).toEqual([]);
    });

    it('"por cento" na evidência apoia "%" na claim, e a ausência é registrada', () => {
      expect(checkClaimSupport('São 10% do total.', ['dez por cento']).logged).toEqual(['10 %']);
      expect(checkClaimSupport('São 10% do total.', ['10 por cento do total']).logged).toEqual([]);
    });

    it('valor em reais com prefixo R$ é comparado com a evidência', () => {
      expect(checkClaimSupport('A multa é de R$ 1.500,00.', ['multa de R$ 1.500,00']).logged).toEqual([]);
      expect(checkClaimSupport('A multa é de R$ 1.500,00.', ['multa qualquer']).logged).toEqual(['R$ 1.500,00']);
    });

    it('dias e meses são famílias diferentes: 30 dias não é apoiado por 30 meses', () => {
      expect(checkClaimSupport('Prazo de 30 dias.', ['prazo de 30 meses']).logged).toEqual(['30 dias']);
    });
  });

  describe('evidência ausente', () => {
    it('sem nenhum texto de evidência (claim só cita imagem anexada) nada é verificado', () => {
      expect(checkClaimSupport('Conforme o item 99.9.9 da NR-99.', [])).toEqual({ blocking: [], logged: [] });
    });
  });
});
