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
    // Item 008 (auditoria do Assistente, 2026-09-28): antes desta correção,
    // "oito horas" na evidência NUNCA apoiava "8 horas" na claim — ia pro
    // log como se a evidência não tivesse a informação, mesmo tendo.
    it('número por extenso simples na evidência apoia o dígito na claim (item 008)', () => {
      const result = checkClaimSupport('O prazo é de 8 horas.', ['o curso tem carga de oito horas']);
      expect(result.blocking).toEqual([]);
      expect(result.logged).toEqual([]);
    });

    it('número por extenso composto ("vinte e quatro") também é reconhecido', () => {
      expect(checkClaimSupport('Prazo de 24 horas.', ['deve ser cumprido em vinte e quatro horas']).logged).toEqual([]);
      expect(checkClaimSupport('Validade de 30 dias.', ['validade de trinta dias']).logged).toEqual([]);
    });

    it('forma feminina do número por extenso é reconhecida ("duas horas", "um ano")', () => {
      expect(checkClaimSupport('Intervalo de 2 horas.', ['intervalo de duas horas']).logged).toEqual([]);
      expect(checkClaimSupport('Repetir a cada 1 ano.', ['deve ser repetido a cada um ano']).logged).toEqual([]);
    });

    it('número por extenso fora de 0-999 (limite documentado) continua só registrado, nunca bloqueia', () => {
      const result = checkClaimSupport('O valor é de 1200 dias.', ['prazo de mil e duzentos dias']);
      expect(result.blocking).toEqual([]);
      expect(result.logged).toEqual(['1200 dias']);
    });

    it('número com parêntese por extenso na evidência ("8 (oito) horas") é apoiado', () => {
      const result = checkClaimSupport('O curso tem 8 horas.', ['carga horária de 8 (oito) horas']);
      expect(result.logged).toEqual([]);
    });

    it('"por cento" na evidência apoia "%" na claim, inclusive por extenso, e a ausência de verdade é registrada', () => {
      expect(checkClaimSupport('São 10% do total.', ['10 por cento do total']).logged).toEqual([]);
      // "dez por cento" combina duas equivalências ao mesmo tempo (número
      // por extenso, item 008, e "por cento" como forma de "%") — passou a
      // ser reconhecido pela mesma correção.
      expect(checkClaimSupport('São 10% do total.', ['dez por cento']).logged).toEqual([]);
      // Percentual genuinamente diferente do citado continua registrado.
      expect(checkClaimSupport('São 10% do total.', ['são 25% do total']).logged).toEqual(['10 %']);
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
