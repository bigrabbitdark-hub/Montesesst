import { isRevokedLiteral, parseProvisions, ParserKind, PARSER_VERSION, toCodePointOffsets } from '../src/normative/provision-parser';
import { formatCoverageReport, parseArgs } from '../db/generate-provisions';

const paths = (raw: string, kind: ParserKind) =>
  parseProvisions(raw, kind).provisions.map((p) => `${p.anexo}|${p.item_path}`);

// Trecho real do texto da NR-15 (db/seed-data/normative-sources/NR-15.txt, linhas 29-32).
const NR15_TRECHO = [
  '15.1 São consideradas atividades ou operações insalubres as que se desenvolvem:',
  '15.1.1 Acima dos limites de tolerância previstos nos Anexos nº 1, 2, 3, 5, 11 e 12;',
  '15.1.2 (Revogado pela Portaria MTE nº 3.751, de 23 de novembro de 1990)',
  '15.1.3 Nas atividades mencionadas nos Anexos nº 6, 13 e 14;',
].join('\n');

describe('PARSER_VERSION', () => {
  it('é versionado', () => expect(PARSER_VERSION).toBe('provision-parser/1'));
});

describe('parseProvisions — NR', () => {
  it('extrai itens numerados de um trecho real da NR-15, na ordem', () => {
    expect(paths(NR15_TRECHO, 'nr')).toEqual(['|15.1', '|15.1.1', '|15.1.2', '|15.1.3']);
  });

  it('invariante: o literal é exatamente o recorte do texto original', () => {
    const r = parseProvisions(NR15_TRECHO, 'nr');
    for (const p of r.provisions) expect(NR15_TRECHO.slice(p.char_start, p.char_end)).toBe(p.literal_text);
    expect(r.coverage).toBeGreaterThan(0.98);
  });

  it('linhas de tabela (sem ponto, ou minúsculas) não viram item e ficam no item anterior', () => {
    const r = parseProvisions('1.1 Texto do item.\n85 dB(A) 8 horas\n250 L\n0.5 mg/m3 limite', 'nr');
    expect(r.provisions).toHaveLength(1);
    expect(r.provisions[0].literal_text.split('\n')).toHaveLength(4);
  });

  it('anexos: arábico, romano e sufixo; o item reinicia por anexo', () => {
    expect(paths('ANEXO Nº 1\n1.1 Ruído contínuo.\nANEXO IV\n1.1 Outro.', 'nr')).toEqual(['1|1.1', '4|1.1']);
    expect(paths('ANEXO II\n1.1 Texto.\nANEXO Nº 13-A\n1.1 Benzeno.', 'nr')).toEqual(['2|1.1', '13-A|1.1']);
  });

  it('cabeçalho de anexo repetido vira anomalia e o que vem depois fica em quarentena (não é gravado)', () => {
    // SINTÉTICO (estrutura mínima).
    const r = parseProvisions('ANEXO Nº 1\n1.1 Texto A.\nANEXO Nº 1\n1.1 Texto B.', 'nr');
    expect(r.provisions.map((p) => [p.anexo, p.item_path, p.literal_text])).toEqual([['1', '1.1', '1.1 Texto A.']]);
    expect(r.anomalies.map((a) => [a.kind, a.line])).toEqual([['anexo_repetido', 3]]);
  });

  it('colisão: ocorrência curta DEPOIS do vencedor estrutural torna a chave ambígua (nenhuma grava)', () => {
    // SINTÉTICO (estrutura mínima).
    const r = parseProvisions('1.1 Título\n1.1.1 Filho.\n1.1 Linha de tabela\n1.2 Outro.', 'nr');
    expect(r.provisions.map((p) => p.item_path)).toEqual(['1.1.1', '1.2']);
    expect(r.anomalies).toEqual([{ kind: 'item_ambiguo', line: 1, detail: '1.1 (2x)' }]);
  });

  it('colisão: duas ocorrências com filhos (2 vencedores) é ambígua', () => {
    // SINTÉTICO (estrutura mínima).
    const r = parseProvisions('1.1 A\n1.1.1 Filho A.\n1.1 B\n1.1.1 Filho B.', 'nr');
    expect(r.provisions).toEqual([]);
    expect(r.anomalies.map((a) => a.kind)).toEqual(['item_ambiguo', 'item_ambiguo']);
  });

  it('sumário: o título curto do sumário perde para o título do corpo (que tem filhos)', () => {
    const raw = [
      'SUMÁRIO',
      '1.1 Objetivo',
      '1.2 Campo de aplicação',
      '1.1 Objetivo',
      '1.1.1 O objetivo desta Norma é estabelecer.',
      '1.2 Campo de aplicação',
      '1.2.1 Aplica-se a todos.',
    ].join('\n');
    const r = parseProvisions(raw, 'nr');
    expect(r.provisions.map((p) => p.item_path)).toEqual(['1.1', '1.1.1', '1.2', '1.2.1']);
    expect(r.provisions[0].char_start).toBeGreaterThan(raw.indexOf('1.2 Campo de aplicação'));
    expect(r.anomalies.map((a) => a.kind)).toEqual(['item_repetido', 'item_repetido']);
  });

  it('texto sem estrutura reconhecida: nenhuma linha, cobertura 0', () => {
    const r = parseProvisions('Preâmbulo sem item.\nOutra linha.', 'nr');
    expect(r.provisions).toEqual([]);
    expect(r.coverage).toBe(0);
  });

  it('item que abre com aspa curva (U+201C) é reconhecido', () => {
    // SINTÉTICO. A aspa é a curva REAL \u201C (não ASCII): se ela sair da classe de NR_ITEM_RE este teste falha.
    const raw = '1.1 \u201CTermo\u201D significa algo.';
    expect(raw.charCodeAt(4)).toBe(0x201c);
    expect(paths(raw, 'nr')).toEqual(['|1.1']);
  });

  it('texto vazio não quebra', () => {
    expect(parseProvisions('', 'nr')).toMatchObject({ provisions: [], total_chars: 0, coverage: 0 });
  });
});

// Trechos REAIS de db/seed-data/normative-sources (linhas citadas em cada bloco). Trechos não contíguos
// são concatenados na ordem do arquivo; nada foi reescrito.
describe('parseProvisions — cabeçalhos de anexo não reconhecidos e colisões em texto real', () => {
  const byKey = (raw: string) => new Map(parseProvisions(raw, 'nr').provisions.map((p) => [`${p.anexo}|${p.item_path}`, p]));

  it('NR-16 Anexo VI + `ANEXO (*)`: o quadro de radiações vira anexo `(*)`, nada dele é gravado como 6|…; 6|2.2 e 6|3.1 com literal correto', () => {
    const raw = [
  // NR-16.txt:801-835
  'ANEXO VI',
  'ATIVIDADES PERIGOSAS DOS AGENTES DAS AUTORIDADES DE TRÂNSITO',
  '(Inserido pela Portaria MTE nº 1.411, de 22 de agosto de 2025)',
  '1. Objetivo',
  '1.1 O objetivo deste Anexo é estabelecer critérios para regulamentação das atividades ou operações',
  'perigosas realizadas por Agentes das Autoridades de Trânsito.',
  '2. Campo de aplicação',
  '2.1 Este anexo aplica-se às atividades profissionais realizadas pelos Agentes das Autoridades de',
  'Trânsito com exposição ao risco de colisões, atropelamentos ou outras espécies de acidentes ou',
  'violências.',
  '2.1.1 Para efeitos deste anexo, são considerados agentes das autoridades de trânsito aqueles previstos',
  'nos conceitos e definições no Anexo I da Lei nº 9.503, de 23 de setembro de 1997 (Código de Trânsito',
  'Brasileiro).',
  '',
  '-- 17 of 22 --',
  '',
  'Este texto não substitui o publicado no DOU',
  '2.2 Nos termos previstos em lei, aplica-se o disposto nesse anexo a outras relações jurídicas.',
  '3. Caracterização da atividade ou operação perigosa',
  '3.1 As atividades ou operações realizadas pelos Agentes das Autoridades de Trânsito com exposição ao',
  'risco de colisões, atropelamentos ou outras espécies de acidentes ou violências são consideradas',
  'perigosas.',
  '3.2 É responsabilidade da organização a caracterização ou descaracterização da periculosidade dos',
  'Agentes das Autoridades de Trânsito, conforme estabelecido no item 16.3 dessa Norma',
  'Regulamentadora (NR), sendo assegurada a hipótese prevista no item 16.4 dessa mesma NR.',
  '3.2.1 Na elaboração do laudo, deve ser analisada a exposição do trabalhador ao risco de colisões,',
  'atropelamentos ou outras espécies de acidentes ou violências, independentemente do local de',
  'realização da atividade.',
  'ANEXO (*)',
  'ATIVIDADES E OPERAÇÕES PERIGOSAS COM RADIAÇÕES IONIZANTES OU SUBSTÂNCIAS',
  'RADIOATIVAS',
  '(Adotado pela Portaria MTE nº 518, de 04 de abril de 2003)',
  'ATIVIDADES/ÁREAS DE RISCO',
  'ATIVIDADES ÁREAS DE RISCO',
  '1. Produção, utilização, processamento, transporte,',
  // NR-16.txt:836-847
  'guarda, estocagem e manuseio de materiais',
  'radioativos, selados e não selados, de estado físico',
  'e forma química quaisquer, naturais ou artificiais,',
  'incluindo:',
  'Minas e depósitos de materiais radioativos.',
  'Plantas-piloto e Usinas de beneficiamento de',
  'minerais radioativos.',
  'Outras áreas sujeitas a risco potencial devido',
  'às radiações ionizantes',
  '1.1. Prospecção, mineração, operação,',
  'beneficiamento e processamento de minerais',
  'radioativos.',
  // NR-16.txt:924-931
  '2.1. Montagem, instalação, substituição e inspeção',
  'de elementos combustíveis.',
  'Instalações de tratamento e estocagem de',
  'rejeitos radioativos.',
  '2.2. Manutenção de componentes integrantes do',
  'reator e dos sistemas hidráulicos mecânicos e',
  'elétricos, irradiados, contaminados ou situados em',
  'áreas de radiação.',
  // NR-16.txt:1059-1062
  'Nota Explicativa:',
  '(Inserida pela Portaria MTE nº 595, de 07 de maio de 2015)',
  '1. Não são consideradas perigosas, para efeito deste anexo, as atividades desenvolvidas em áreas que',
  'utilizam equipamentos móveis de Raios X para diagnóstico médico.',
    ].join('\n');
    const r = parseProvisions(raw, 'nr');
    for (const p of r.provisions) expect(raw.slice(p.char_start, p.char_end)).toBe(p.literal_text);
    // `ANEXO (*)` é um anexo NOVO de id literal '(*)' (a fonte não o numera): nenhum 6|… passa do cabeçalho.
    const inicioQuadro = raw.indexOf('ANEXO (*)');
    expect(r.provisions.filter((p) => p.anexo === '6').every((p) => p.char_end <= inicioQuadro)).toBe(true);
    expect(r.anexos.map((a) => [a.id, a.header_line])).toEqual([
      ['6', 1],
      ['(*)', raw.split('\n').indexOf('ANEXO (*)') + 1],
    ]);
    expect(r.anomalies.filter((a) => a.kind === 'anexo_nao_reconhecido')).toEqual([]);
    expect(r.quarantines).toEqual([]);
    const k = byKey(raw);
    expect(k.get('(*)|1.1')?.literal_text).toBe(
      ['1.1. Prospecção, mineração, operação,', 'beneficiamento e processamento de minerais', 'radioativos.'].join('\n'),
    );
    expect(k.get('(*)|2.2')?.literal_text.startsWith('2.2. Manutenção de componentes integrantes do')).toBe(true);
    // Texto real: o "1." da Nota Explicativa (NR-16.txt:1061, longo, DEPOIS do vencedor) colide com o "1. Produção…"
    // do quadro → (*)|1 é ambíguo e nenhuma ocorrência grava (regra de colisão existente; não improvisamos).
    expect(k.has('(*)|1')).toBe(false);
    expect(r.anomalies).toContainEqual({ kind: 'item_ambiguo', line: raw.split('\n').indexOf('ANEXO (*)') + 7, detail: '1 (2x)' });
    // 6|2.2 e 6|3.1 têm UMA ocorrência no anexo 6: gravam com o literal do Anexo VI (o "2.2. Manutenção…" do
    // quadro agora é (*)|2.2, não compete).
    expect(k.get('6|2.2')?.literal_text).toBe('2.2 Nos termos previstos em lei, aplica-se o disposto nesse anexo a outras relações jurídicas.');
    expect(k.get('6|3.1')?.literal_text).toBe(
      [
        '3.1 As atividades ou operações realizadas pelos Agentes das Autoridades de Trânsito com exposição ao',
        'risco de colisões, atropelamentos ou outras espécies de acidentes ou violências são consideradas',
        'perigosas.',
      ].join('\n'),
    );
    expect(k.get('6|1')?.literal_text).toBe('1. Objetivo');
    expect(k.get('6|3.2.1')?.literal_text.endsWith('realização da atividade.')).toBe(true);
    expect(r.anomalies.filter((a) => a.kind === 'item_ambiguo').map((a) => a.detail)).toEqual(['1 (2x)']);
  });

  it('NR-15 Anexo 3: "1. Objetivos" colide com linhas de tabela "1. Sem carga"/"2. Com carga" → ambíguo, nada da tabela é gravado', () => {
    const raw = [
  // NR-15.txt:167-176
  'ANEXO Nº 3',
  'LIMITES DE TOLERÂNCIA PARA EXPOSIÇÃO AO CALOR',
  '(Alterado pela Portaria SEPRT nº 1.359, de 09 de dezembro de 2019)',
  'Sumário:',
  '1. Objetivos',
  '2. Caracterização da atividade ou operação insalubre',
  '3. Laudo Técnico para caracterização da exposição ocupacional ao calor',
  '1. Objetivos',
  '1.1 O objetivo deste Anexo é estabelecer critério para caracterizar as atividades ou operações',
  'insalubres decorrentes da exposição ocupacional ao calor em ambientes fechados ou ambientes',
  // NR-15.txt:300-322
  '',
  'Este texto não substitui o publicado no DOU',
  'Andando no plano',
  '1. Sem carga',
  '• 2 km/h 198',
  '• 3 km/h 252',
  '• 4 km/h 297',
  '• 5 km/h 360',
  '2. Com carga',
  '• 10 kg, 4 km/h 333',
  '• 30 kg, 4 km/h 450',
  'Correndo no plano',
  '• 9 km/h 787',
  '• 12 km/h 873',
  '• 15 km/h 990',
  'Subindo rampa',
  '1. Sem carga',
  '• com 5° de inclinação, 4 km/h 324',
  '• com 15° de inclinação, 3 km/h 378',
  '• com 25° de inclinação, 3 km/h 540',
  '2. Com carga de 20 kg',
  '• com 15° de inclinação, 4 km/h 486',
  '• com 25° de inclinação, 4 km/h 738',
    ].join('\n');
    const r = parseProvisions(raw, 'nr');
    const k = byKey(raw);
    // Regra estrutural estrita: "1. Objetivos" (corpo) é o único vencedor (o próximo é 1.1, filho), mas há
    // ocorrências curtas DEPOIS dele (linhas de tabela) → 3|1 é ambíguo e nenhuma ocorrência grava. Idem 3|2
    // (nenhum vencedor). O texto real não permite distinguir item de linha de tabela só pela forma "N. Título".
    expect(k.has('3|1')).toBe(false);
    expect(k.has('3|2')).toBe(false);
    expect(k.get('3|1.1')?.literal_text.startsWith('1.1 O objetivo deste Anexo')).toBe(true);
    expect(r.provisions.some((p) => /Sem carga|Com carga/.test(p.literal_text.split('\n')[0]))).toBe(false);
    expect(r.anomalies).toEqual(
      expect.arrayContaining([
        { kind: 'item_ambiguo', line: 5, detail: '1 (4x)' },
        { kind: 'item_ambiguo', line: 6, detail: '2 (3x)' },
      ]),
    );
  });

  it('NR-15 Anexo 6 + sub-anexo `ANEXO “A”`: o conteúdo do sub-anexo não é gravado sob o Anexo 6', () => {
    const raw = [
  // NR-15.txt:362-371
  'ANEXO Nº 6',
  'TRABALHO SOB CONDIÇÕES HIPERBÁRICAS',
  '(Título alterado pela Portaria SSMT nº 24, de 14 de setembro de 1983)',
  'Este Anexo trata dos trabalhos sob ar comprimido e dos trabalhos submersos.',
  '1. TRABALHOS SOB AR COMPRIMIDO',
  '(Alterado pela Portaria SSMT nº 05, de 09 de fevereiro de 1983)',
  '1.1 Trabalhos sob ar comprimido são os efetuados em ambientes onde o trabalhador é obrigado a',
  'suportar pressões maiores que a atmosférica e onde se exige cuidadosa descompressão, de acordo',
  'com as tabelas anexas.',
  '1.2 Para fins de aplicação deste item, define-se:',
  // NR-15.txt:1701-1722
  '2.14 Das Disposições Gerais.',
  '2.14.1 O trabalho submerso ou sob pressão somente será permitido a trabalhadores com idade',
  'mínima de 18 (dezoito) anos.',
  '2.14.2 A atividade de mergulho é considerada como atividade insalubre em grau máximo.',
  '2.14.3 O descumprimento ao disposto no item 2 - Trabalhos Submersos caracterizará o grave e',
  'iminente risco para os fins e efeitos previstos na NR-3.',
  'ANEXO “A”',
  'PADRÕES PSICOFÍSICOS PARA SELEÇÃO DOS CANDIDATOS',
  'À ATIVIDADE DE MERGULHO',
  'I - IDADE',
  'O trabalho submerso ou sob pressão somente será permitido a trabalhadores com idade mínima',
  'de 18 (dezoito) anos.',
  'II - ANAMNESE',
  'Inabilita o candidato à atividade de mergulho a ocorrência ou constatação de patologias',
  'referentes a: epilepsia, meningite, tuberculose, asma e qualquer doença pulmonar crônica;',
  'sinusites crônicas ou repetidas; otite média e otite externa crônica; doença incapacitante do',
  'aparelho locomotor; distúrbios gastrointestinais crônicos ou repetidos; alcoolismo crônico e',
  'sífilis (salvo quando convenientemente tratada e sem a persistência de nenhum sintoma',
  'conseqüente); outras a critério médico.',
  'III - EXAME MÉDICO',
  '1. BIOMETRIA',
  'Peso: os candidatos à atividade de mergulho serão selecionados de acordo com o seu biotipo e',
  // NR-15.txt:4446
  'ANEXO Nº 7',
    ].join('\n');
    const r = parseProvisions(raw, 'nr');
    const k = byKey(raw);
    expect(r.anomalies).toContainEqual({ kind: 'anexo_nao_reconhecido', line: raw.split('\n').indexOf('ANEXO “A”') + 1, detail: 'ANEXO “A”' });
    // O item anterior termina ANTES do cabeçalho não reconhecido (antes ele engolia o sub-anexo).
    expect(k.get('6|2.14.3')?.literal_text.endsWith('previstos na NR-3.')).toBe(true);
    expect(r.provisions.some((p) => /BIOMETRIA|ANAMNESE|PADRÕES PSICOFÍSICOS/.test(p.literal_text))).toBe(false);
    expect(k.get('6|1')?.literal_text.startsWith('1. TRABALHOS SOB AR COMPRIMIDO')).toBe(true);
    // A quarentena termina no próximo anexo reconhecido como novo.
    expect(r.anexos.map((a) => a.id)).toEqual(['6', '7']);
  });

  it('NR-15 Anexo 12 + `ANEXO Nº 1`/`ANEXO II`/`ANEXO III` internos: nada após eles vai para o Anexo 12; MANGANÊS abre seção 12/…', () => {
    const raw = [
  // NR-15.txt:73
  'ANEXO Nº 1',
  // NR-15.txt:152
  'ANEXO Nº 2',
  // NR-15.txt:167
  'ANEXO Nº 3',
  // NR-15.txt:4875-4880
  'ANEXO Nº 12',
  'LIMITES DE TOLERÂNCIA PARA POEIRAS MINERAIS',
  'ASBESTO',
  '(Instituído pela Portaria SSST nº 01, de 28 de maio de 1991)',
  '1. O presente Anexo aplica-se a todas e quaisquer atividades nas quais os trabalhadores estão',
  'expostos ao asbesto no exercício do trabalho.',
  // NR-15.txt:5025-5026
  '22. As exigências contidas neste anexo entrarão em vigor em 180 (cento e oitenta dias) a contar',
  'da data de sua publicação, revogadas as disposições em contrário.',
  // NR-15.txt:5031-5044
  'ANEXO Nº 1',
  'MODELO DO CADASTRO DOS UTILIZADORES DO ASBESTO',
  'I - IDENTIFICAÇÃO',
  'Nome_________________________________________________________________Endereço:',
  '_________________________________________Bairro:________________',
  'Cidade:_____________________________Telefone:___________CEP:____________',
  'CGC:__________________________________________________________________',
  'Ramo de Atividade:____________________',
  'CNAE___________________________________',
  'II - DADOS DE PRODUÇÃO',
  '1. Número de Trabalhadores',
  '• Total:________________ Menores:_________________ Mulheres: _________________',
  '• Em contato direto com o asbesto: ____________________________________________',
  '1. Procedência do asbesto',
  // NR-15.txt:5071-5072
  'ANEXO II',
  'ANEXO III',
  // NR-15.txt:5092-5095
  'MANGANÊS E SEUS COMPOSTOS',
  '(Incluído pela Portaria DNSST nº 08, de 05 de outubro de 1992)',
  '1. O limite de tolerância para as operações com manganês e seus compostos referente à',
  'extração, tratamento, moagem, transporte do minério, ou ainda a outras operações com',
  // NR-15.txt:5202-5205
  'ANEXO Nº 13',
  'AGENTES QUÍMICOS',
  '1. Relação das atividades e operações envolvendo agentes químicos, consideradas, insalubres',
  'em decorrência de inspeção realizada no local de trabalho. Excluam-se desta relação as',
    ].join('\n');
    const r = parseProvisions(raw, 'nr');
    const k = byKey(raw);
    expect(r.anomalies.filter((a) => a.kind === 'anexo_repetido').map((a) => a.detail)).toEqual(['1', '2', '3']);
    const anexo12 = r.provisions.filter((p) => p.anexo === '12');
    expect(anexo12.map((p) => p.item_path)).toEqual(['1', '22']);
    expect(anexo12.some((p) => /Número de Trabalhadores|Procedência|manganês/.test(p.literal_text))).toBe(false);
    expect(k.get('12|22')?.literal_text.endsWith('revogadas as disposições em contrário.')).toBe(true);
    expect(k.get('13|1')?.literal_text.startsWith('1. Relação das atividades')).toBe(true);
    // Seção titulada (MAIÚSCULAS + "(Incluído…" na linha seguinte) depois da quarentena: sai da quarentena e os
    // itens recebem `12/<TÍTULO>`. O "ASBESTO" logo após o título do Anexo 12 NÃO vira seção (sem item antes).
    expect(k.get('12/MANGANÊS E SEUS COMPOSTOS|1')?.literal_text.startsWith('1. O limite de tolerância para as operações com manganês')).toBe(true);
    expect(r.anexos.map((a) => a.id)).toEqual(['1', '2', '3', '12', '12/MANGANÊS E SEUS COMPOSTOS', '13']);
    const linha = (s: string) => raw.split('\n').indexOf(s) + 1;
    expect(r.anexos.find((a) => a.id === '12/MANGANÊS E SEUS COMPOSTOS')?.header_line).toBe(linha('MANGANÊS E SEUS COMPOSTOS'));
    // Um trecho de quarentena por cabeçalho não reconhecido/repetido, até o próximo cabeçalho ou seção.
    const iAnexo1 = raw.lastIndexOf('ANEXO Nº 1\n');
    expect(r.quarantines).toEqual([
      { header_line: raw.slice(0, iAnexo1).split('\n').length, header: 'ANEXO Nº 1', chars: raw.indexOf('ANEXO II') - iAnexo1 },
      { header_line: linha('ANEXO II'), header: 'ANEXO II', chars: 'ANEXO II\n'.length },
      { header_line: linha('ANEXO III'), header: 'ANEXO III', chars: 'ANEXO III\n'.length },
    ]);
  });

  it('NR-15 Anexo 12: SÍLICA LIVRE CRISTALIZADA abre outra seção 12/… (pai é o anexo 12, não a seção anterior)', () => {
    const raw = [
  // NR-15.txt:152 e 167 (sem eles, "ANEXO II"/"ANEXO III" seriam anexos novos)
  'ANEXO Nº 2',
  'ANEXO Nº 3',
  // NR-15.txt:4875-4880
  'ANEXO Nº 12',
  'LIMITES DE TOLERÂNCIA PARA POEIRAS MINERAIS',
  'ASBESTO',
  '(Instituído pela Portaria SSST nº 01, de 28 de maio de 1991)',
  '1. O presente Anexo aplica-se a todas e quaisquer atividades nas quais os trabalhadores estão',
  'expostos ao asbesto no exercício do trabalho.',
  // NR-15.txt:5071-5072
  'ANEXO II',
  'ANEXO III',
  // NR-15.txt:5092-5097
  'MANGANÊS E SEUS COMPOSTOS',
  '(Incluído pela Portaria DNSST nº 08, de 05 de outubro de 1992)',
  '1. O limite de tolerância para as operações com manganês e seus compostos referente à',
  'extração, tratamento, moagem, transporte do minério, ou ainda a outras operações com',
  'exposição a poeiras do manganês ou de seus compostos é de até 5mg/m3 no ar, para jornada de',
  'até 8 (oito) horas por dia.',
  // NR-15.txt:5149-5164
  '- Proibição de se tomarem refeições nos locais de trabalho.',
  'SÍLICA LIVRE CRISTALIZADA',
  '(Incluído pela Portaria DNSST nº 08, de 05 de outubro de 1992)',
  '1. O limite de tolerância, expresso em milhões de partículas por decímetro cúbico, é dado pela',
  'seguinte fórmula:',
  '8,5',
  'L.T. = ———————— mppdc (milhões de partículas por decímetro cúbico)',
  '% quartzo + 10',
  'Esta fórmula é válida para amostras tomadas com impactador (impinger) no nível da zona',
  'respiratória e contadas pela técnica de campo claro. A percentagem de quartzo é a quantidade',
  'determinada através de amostras em suspensão aérea.',
  '2. O limite de tolerância para poeira respirável, expresso em mg/m3, é dado pela seguinte',
  'fórmula:',
  '8',
  'L.T. = ——————— mg/m3',
  '% quartzo + 2',
  // NR-15.txt:5202
  'ANEXO Nº 13',
    ].join('\n');
    const r = parseProvisions(raw, 'nr');
    for (const p of r.provisions) expect(raw.slice(p.char_start, p.char_end)).toBe(p.literal_text);
    expect(paths(raw, 'nr')).toEqual(['12|1', '12/MANGANÊS E SEUS COMPOSTOS|1', '12/SÍLICA LIVRE CRISTALIZADA|1', '12/SÍLICA LIVRE CRISTALIZADA|2']);
    const k = byKey(raw);
    const silica1 = k.get('12/SÍLICA LIVRE CRISTALIZADA|1')?.literal_text ?? '';
    expect(silica1).toMatch(/^1\. O limite de tolerância, expresso em milhões de partículas/);
    expect(silica1).toContain('L.T. = ———————— mppdc');
    expect(silica1.endsWith('determinada através de amostras em suspensão aérea.')).toBe(true);
    // O item anterior termina ANTES do título da seção seguinte.
    expect(k.get('12/MANGANÊS E SEUS COMPOSTOS|1')?.literal_text).not.toContain('SÍLICA');
    expect(r.anexos.map((a) => a.id)).toEqual(['2', '3', '12', '12/MANGANÊS E SEUS COMPOSTOS', '12/SÍLICA LIVRE CRISTALIZADA', '13']);
  });

  it('NR-15 Anexo 13-A: "2021. (Alterado…" é continuação do 7.4, não item (NR-15.txt:5413, 5578-5584)', () => {
    const raw = [
      'ANEXO Nº 13-A',
      'Este texto não substitui o publicado no DOU',
      '7.4. As avaliações ambientais deverão seguir o disposto no Anexo IX (Avaliação das',
      'Concentrações de Benzeno em Ambientes de Trabalho) da Instrução Normativa - IN nº 2, de',
      '2021. (Alterado pela Portaria MTP nº 806, de 13 de abril de 2022)',
      '8. Entende-se como Vigilância da Saúde o conjunto de ações e procedimentos que visam à',
      'detecção, o mais precocemente possível, de efeitos nocivos induzidos pelo benzeno à saúde dos',
    ].join('\n');
    const k = byKey(raw);
    expect(k.has('13-A|2021')).toBe(false);
    expect([...k.keys()]).toEqual(['13-A|7.4', '13-A|8']);
    expect(k.get('13-A|7.4')?.literal_text).toContain('2021. (Alterado pela Portaria MTP nº 806');
  });

  it('título em MAIÚSCULAS seguido de "(Revogado…" não abre seção (NR-15.txt:5413 e 5674-5681)', () => {
    const raw = [
      // NR-15.txt:5413
      'ANEXO Nº 13-A',
      // NR-15.txt:5674-5681
      'Fabricação e transporte de cal e cimento nas fases de grande exposição à poeira.',
      'Trabalhos de carregamento, descarregamento ou remoção de enxofre ou sulfitos em geral, em',
      'sacos ou granel.',
      'AGENTES BIOLÓGICOS',
      '(Revogado pela Portaria SSST nº 12, de 12 de novembro de 1979)',
      'ANEXO Nº 14',
      '(Aprovado pela Portaria SSST nº 12, de 12 de novembro de 1979)',
      'AGENTES BIOLÓGICOS',
    ].join('\n');
    expect(parseProvisions(raw, 'nr').anexos.map((a) => a.id)).toEqual(['13-A', '14']);
  });

  it('seção titulada sem nenhum item antes do próximo anexo não gera entrada nem dispositivo', () => {
    // SINTÉTICO (estrutura mínima): o título casa o gatilho ("(Alterado"), mas nenhum item segue.
    const raw = 'ANEXO Nº 5\n1.1 Item.\nTÍTULO VAZIO\n(Alterado pela Portaria X)\nTexto sem item.\nANEXO Nº 6\n1.1 Outro.';
    const r = parseProvisions(raw, 'nr');
    expect(r.anexos.map((a) => [a.id, a.chars])).toEqual([
      ['5', raw.indexOf('ANEXO Nº 6')],
      ['6', raw.length - raw.indexOf('ANEXO Nº 6')],
    ]);
    expect(paths(raw, 'nr')).toEqual(['5|1.1', '6|1.1']);
  });

  it('o título do próprio anexo (logo após o cabeçalho, antes de qualquer item) NÃO vira seção', () => {
    // SINTÉTICO (estrutura mínima).
    const raw = [
      'ANEXO Nº 4',
      'TÍTULO DO ANEXO',
      '(Alterado pela Portaria X)',
      '1.1 Item do anexo.',
      'OUTRO ASSUNTO',
      '(Redação dada pela Portaria Y)',
      '1.1 Item da seção.',
      'SEM GATILHO',
      '1.2 Continua na seção.',
    ].join('\n');
    expect(paths(raw, 'nr')).toEqual(['4|1.1', '4/OUTRO ASSUNTO|1.1', '4/OUTRO ASSUNTO|1.2']);
  });

  it('título em 2 linhas ("QUADRO 1 - …" + "POEIRA CONTENDO…"): a 2ª linha CONTINUA o título e NÃO abre seção (NR-07.txt:786-788, 912-917, 981-983)', () => {
    // Trechos reais de db/seed-data/normative-sources/NR-07.txt (texto idêntico ao PDF oficial da NR-07), nas linhas
    // indicadas; as linhas omitidas entre os trechos são o resto do Anexo III e a tabela do Quadro 1.
    const raw = [
      // NR-07.txt:786-788
      'ANEXO III',
      'CONTROLE RADIOLÓGICO E ESPIROMÉTRICO DA EXPOSIÇÃO A AGENTES QUÍMICOS',
      '1. A organização deve atender às obrigações de periodicidade, condições técnicas e parâmetros',
      // NR-07.txt:912-917
      '2.17.2 O trabalhador receberá, por ocasião da demissão e retornos posteriores, comunicação da',
      'data e local da próxima avaliação médica. (Inserido pela Portaria MTP nº 567, de 10 de março de 2022)',
      'QUADRO 1 - PERIODICIDADE DOS EXAMES RADIOLÓGICOS PARA EMPREGADOS EXPOSTOS',
      'POEIRA CONTENDO SÍLICA, ASBESTO OU CARVÃO MINERAL',
      '(Alterado pela Portaria MTP nº 567, de 10 de março de 2022)',
      'Empresas com medições quantitativas periódicas Radiografia de Tórax',
      // NR-07.txt:981-983
      '3. ESPIROMETRIAS OCUPACIONAIS',
      '3.1 Os empregados expostos ocupacionalmente a poeiras minerais indicadas no inventário de riscos',
      'do PGR devem ser submetidos a espirometria nos exames médicos admissional e a cada dois anos.',
    ].join('\n');
    const r = parseProvisions(raw, 'nr');
    expect(paths(raw, 'nr')).toEqual(['3|1', '3|2.17.2', '3|3', '3|3.1']);
    expect(r.anexos.map((a) => a.id)).toEqual(['3']);
    // O título (2 linhas) encerra o item anterior no mesmo ponto de antes: o 2.17.2 não engole a tabela do quadro.
    const item = r.provisions.find((p) => p.item_path === '2.17.2')!;
    expect(item.literal_text.endsWith('QUADRO 1 - PERIODICIDADE DOS EXAMES RADIOLÓGICOS PARA EMPREGADOS EXPOSTOS')).toBe(true);
    expect(item.literal_text).not.toContain('POEIRA');
    for (const p of r.provisions) expect(raw.slice(p.char_start, p.char_end)).toBe(p.literal_text);
  });

  it('título de UMA linha precedido de texto comum continua abrindo seção; precedido de outro título em maiúsculas, não', () => {
    // SINTÉTICO (estrutura mínima).
    const base = ['ANEXO Nº 4', '1.1 Item do anexo.', 'texto comum do item.'];
    const comum = [...base, 'OUTRO ASSUNTO', '(Redação dada pela Portaria Y)', '1.1 Item da seção.'].join('\n');
    expect(paths(comum, 'nr')).toEqual(['4|1.1', '4/OUTRO ASSUNTO|1.1']);
    const continuacao = [...base, 'TABELA 2 - PRIMEIRA LINHA DO TÍTULO', '', 'SEGUNDA LINHA DO TÍTULO', '(Redação dada pela Portaria Y)', '2.1 Item.'].join('\n');
    expect(paths(continuacao, 'nr')).toEqual(['4|1.1', '4|2.1']);
  });

  it('linha curta em caixa mista que começa com "Anexo" no meio de frase NÃO entra em quarentena (NR-15.txt:1694-1697)', () => {
    const raw = [
      '2.13.1 As tabelas empregadas em todas as operações de mergulho onde o ar comprimido seja',
      'utilizado como suprimento respiratório, inclusive as de tratamento, serão as constantes do',
      'Anexo C.',
      '2.13.1.1 Outras tabelas poderão ser empregadas, desde que devidamente homologadas pela',
    ].join('\n');
    const r = parseProvisions(raw, 'nr');
    expect(r.provisions.map((p) => p.item_path)).toEqual(['2.13.1', '2.13.1.1']);
    expect(r.anomalies).toEqual([]);
  });

  it('sumário da NR-01 com "Anexo I - Termos e definições" não entra em quarentena; "Anexo I da NR-01" abre o anexo 1 (NR-01.txt:30-35, 504-507)', () => {
    const raw = [
      '1.9 Disposições finais',
      'Anexo I - Termos e definições',
      'Anexo II - Diretrizes e requisitos mínimos para utilização da modalidade de ensino a distância',
      'e semipresencial.',
      '1.1 Objetivo',
      '1.1.1 O objetivo desta Norma é estabelecer as disposições gerais, o campo de aplicação, os',
      '1.9.2 Os casos omissos verificados no cumprimento das NR serão decididos pela Secretaria de',
      'Trabalho, ouvida a SIT.',
      'Anexo I da NR-01',
      'Termos e definições',
    ].join('\n');
    const r = parseProvisions(raw, 'nr');
    expect(r.provisions.map((p) => p.item_path)).toEqual(['1.9', '1.1', '1.1.1', '1.9.2']);
    expect(r.provisions[3].literal_text.endsWith('ouvida a SIT.')).toBe(true);
    expect(r.anomalies).toEqual([]);
    expect(r.quarantines).toEqual([]);
    expect(r.anexos.map((a) => [a.id, a.header_line])).toEqual([
      ['', 0],
      ['1', 9],
    ]);
  });
});

// Texto REAL da NR-01 vigente a partir de 26/05/2026: backend/test/fixtures/normative/NR-01-vigente-2026-05-26.txt
// (extraído com pdf-parse de https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/participacao-social/
// conselhos-e-orgaos-colegiados/comissao-tripartite-partitaria-permanente/normas-regulamentadora/
// normas-regulamentadoras-vigentes/nr-01-atualizada-2025-i-3.pdf; sha256 do PDF 39e0ced67472db5f…;
// sha256 do texto afaf953765022672dd058ba385ace393be6b88f5612cbb03a8e5219a2d662fb0; baixado em 2026-10-09).
describe('parseProvisions — `Anexo <id> da NR-<n>` (NR-01 vigente, texto real)', () => {
  // NR-01-vigente-2026-05-26.txt:30-34 (sumário) + 569-575 (fim do corpo e Anexo I); linhas 35-568 omitidas.
  const TRECHO_ANEXO_I = [
    '1.9 Disposições finais',
    'Anexo I - Termos e definições',
    'Anexo II - Diretrizes e requisitos mínimos para utilização da modalidade de ensino a distância e',
    'semipresencial.',
    '1.1 Objetivo',
    '1.9 Disposições finais',
    '1.9.1 O não-cumprimento das disposições legais e regulamentares sobre segurança e saúde',
    'no trabalho acarretará a aplicação das penalidades previstas na legislação pertinente.',
    '1.9.2 Os casos omissos verificados no cumprimento das NR serão decididos pela Secretaria de',
    'Trabalho, ouvida a SIT.',
    'Anexo I da NR-01',
    'Termos e definições',
  ];
  // NR-01-vigente-2026-05-26.txt:690-708 (fim do Anexo I, cabeçalho do Anexo II, sumário e início do corpo).
  const TRECHO_ANEXO_II = [
    'Trabalhador: pessoa física inserida em uma relação de trabalho, inclusive de natureza',
    'administrativa, como os empregados e outros sem vínculo de emprego.',
    'Anexo II da NR-01',
    '',
    '-- 17 of 21 --',
    '',
    'Este texto não substitui o publicado no DOU 18',
    'Diretrizes e requisitos mínimos para utilização da modalidade de ensino a',
    'distância esemipresencial.',
    'Sumário:',
    '1. Objetivo',
    '2. Disposições gerais',
    '3. Estruturação pedagógica',
    '4. Requisitos operacionais e administrativo',
    '5. Requisitos tecnológicos',
    '6. Glossário',
    '1. Objetivo',
    '1.1 Estabelecer diretrizes e requisitos mínimos para utilização da modalidade de ensino à',
    'distância e semipresencial para as capacitações previstas nas NR, disciplinando tanto aspectos',
  ];

  it('"Anexo I da NR-01" e "Anexo II da NR-01" abrem os anexos 1 e 2; o sumário ("Anexo I - Termos…") não', () => {
    const raw = [...TRECHO_ANEXO_I, ...TRECHO_ANEXO_II].join('\n');
    const r = parseProvisions(raw, 'nr');
    const linha = (s: string) => raw.split('\n').indexOf(s) + 1;
    expect(r.anomalies.filter((a) => a.kind === 'anexo_nao_reconhecido' || a.kind === 'anexo_repetido')).toEqual([]);
    expect(r.quarantines).toEqual([]);
    expect(r.anexos.map((a) => [a.id, a.header_line])).toEqual([
      ['', 0],
      ['1', linha('Anexo I da NR-01')],
      ['2', linha('Anexo II da NR-01')],
    ]);
    // Corpo intacto até o fim do 1.9.2. O "1.9" do sumário engole as duas entradas "Anexo …" do sumário (> 160
    // chars), então a chave 1.9 é ambígua e nenhuma ocorrência grava — comportamento PRÉ-EXISTENTE, inalterado.
    const corpo = r.provisions.filter((p) => p.anexo === '');
    expect(corpo.map((p) => p.item_path)).toEqual(['1.1', '1.9.1', '1.9.2']);
    expect(r.anomalies).toContainEqual({ kind: 'item_ambiguo', line: 1, detail: '1.9 (2x)' });
    expect(corpo[2].literal_text.endsWith('ouvida a SIT.')).toBe(true);
    // Anexo II: o "1. Objetivo" do corpo (com filho 1.1) vence o do sumário; o que veio do Anexo I não vaza para o 2.
    const doDois = r.provisions.filter((p) => p.anexo === '2').map((p) => p.item_path);
    expect(doDois).toEqual(['2', '3', '4', '5', '6', '1', '1.1']);
    const um = r.provisions.find((p) => p.anexo === '2' && p.item_path === '1')!;
    expect(um.char_start).toBe(raw.lastIndexOf('1. Objetivo'));
    for (const p of r.provisions) expect(raw.slice(p.char_start, p.char_end)).toBe(p.literal_text);
  });

  it('com pontuação final, ou com texto depois do número da NR, NÃO é cabeçalho de anexo (NR-18.txt:965-966; NR-36.txt:31)', () => {
    const raw = [
      'supervisão de profissional legalmente habilitado, ou quando em conformidade com o item 4 do',
      'Anexo XII da NR-12;',
      'Anexo I da NR-36 - Glossário',
    ].join('\n');
    const r = parseProvisions(raw, 'nr');
    expect(r.anexos.map((a) => a.id)).toEqual(['']);
    expect(r.anomalies).toEqual([]);
    expect(r.quarantines).toEqual([]);
  });

  it('a forma em CAIXA ALTA "ANEXO I da NR-09" continua em quarentena (fora do escopo; NR-09.txt:96-100)', () => {
    const raw = [
      '9.6.1.2 Considera-se nível de ação, o valor acima do qual devem ser implementadas ações de',
      'controle sistemático de forma a minimizar a probabilidade de que as exposições ocupacionais',
      'ultrapassem os limites de exposição.',
      'ANEXO I da NR-09',
      'VIBRAÇÃO',
    ].join('\n');
    const r = parseProvisions(raw, 'nr');
    expect(r.anomalies).toEqual([{ kind: 'anexo_nao_reconhecido', line: 4, detail: 'ANEXO I da NR-09' }]);
    expect(r.anexos.map((a) => a.id)).toEqual(['']);
  });
});

describe('parseProvisions — anexos no resultado', () => {
  it('lista TODOS os anexos reconhecidos em ordem, inclusive sem dispositivos, e o corpo', () => {
    // SINTÉTICO (estrutura mínima).
    const raw = 'Preâmbulo.\n1.1 Item do corpo.\nANEXO Nº 5\nTexto sem item.\nANEXO Nº 6\n1.1 Item.\nANEXO “A”\n1.1 Fora.';
    const r = parseProvisions(raw, 'nr');
    expect(r.anexos.map((a) => [a.id, a.header_line, a.provisions])).toEqual([
      ['', 0, 1],
      ['5', 3, 0],
      ['6', 5, 1],
    ]);
    const a6 = r.anexos[2];
    expect(a6.chars).toBe('ANEXO Nº 6\n1.1 Item.\n'.length);
    expect(a6.covered_chars).toBe('1.1 Item.'.length);
    expect(r.anexos[1].covered_chars).toBe(0);
  });
});

// ATENÇÃO: fixtures SINTÉTICAS — validam só a estrutura (artigo/§/inciso), não são texto de lei. Os trechos REAIS da CLT,
// da Lei 8.213 e do Decreto 3.048 (com a redação riscada do Planalto) estão em planalto-extract.unit-spec.ts.
describe('parseProvisions — leis e códigos (kind "lei"; "clt" é o nome antigo, mesmo parser)', () => {
  it('artigo, parágrafo, parágrafo único, inciso e artigo com sufixo', () => {
    const raw = 'Art. 192 Caput teste.\n§ 1º Primeiro.\nParágrafo único. Único.\nI - inciso um;\nArt. 193-A Outro.\nArt. 193 outro texto.';
    const esperado = ['|art. 192', '|art. 192 §1', '|art. 192 §único', '|art. 192 §único inc. I', '|art. 193-A', '|art. 193'];
    expect(paths(raw, 'lei')).toEqual(esperado);
    expect(paths(raw, 'clt')).toEqual(esperado);
  });

  it('parágrafo antes de qualquer artigo é ignorado', () => {
    expect(paths('§ 1º Solto.\nArt. 1º Teste.', 'lei')).toEqual(['|art. 1']);
  });

  it('"Art. 193 - São…" (hífen com espaço) é o art. 193, não o sufixo 193-S; "Art. 70-A." e "Art.70-G." são sufixo', () => {
    const raw = [
      'Art. 192 - O exercício de trabalho.',
      'Art.194 - O direito do empregado.',
      'Art.195 - A caracterização.',
      'Art. 193 - São consideradas.',
      'Art. 70-A. A concessão.',
      'Art.70-G. É facultado.',
      'Art. 4º-A Fica.',
    ].join('\n');
    expect(paths(raw, 'lei')).toEqual(['|art. 192', '|art. 194', '|art. 195', '|art. 193', '|art. 70-A', '|art. 70-G', '|art. 4-A']);
  });

  it('variações reais do número do artigo: "Art .193", "Art. . 189 -", "Art. 1º", "Art. 1o", "Art. 64."', () => {
    const raw = ['Art .193 - Texto.', 'Art. . 189 - Texto.', 'Art. 1º Texto.', 'Art. 2o Texto.', 'Art. 64. Texto.', 'Art. 5 o Texto.'].join('\n');
    expect(paths(raw, 'lei')).toEqual(['|art. 193', '|art. 189', '|art. 1', '|art. 2', '|art. 64', '|art. 5']);
  });

  it('número do artigo partido por espaço antes do ponto ("Art. 5 7. (VETADO).") é o art. 57, não um 2º art. 5 (LGPD)', () => {
    // Trecho real da LGPD extraído pelo pipeline do monitor (extractHtmlText + PLANALTO_EXTRACT_OPTIONS) de
    // https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm (baixado em 2026-10-10,
    // sha256 989b7aec…d5d4f), linhas 43-45 e 474-478 do texto extraído. No HTML (linhas 3218-3228) o número está
    // partido em dois <span> ("Art. 5" + "7."), e o espaço entre eles é renderizado.
    const raw = [
      'Art. 5º Para os fins desta Lei, considera-se:',
      'I - dado pessoal: informação relacionada a pessoa natural identificada ou identificável;',
      'II - dado pessoal sensível: dado pessoal sobre origem racial ou étnica, convicção religiosa, opinião política, filiação a sindicato ou a organização de caráter religioso, filosófico ou político, dado referente à saúde ou à vida sexual, dado genético ou biométrico, quando vinculado a uma pessoa natural;',
      'Art. 56. (VETADO).',
      'Art. 5 7. (VETADO).',
      'Seção II',
      'Do Conselho Nacional de Proteção de Dados Pessoais e da Privacidade',
      'Art. 58. (VETADO).',
    ].join('\n');
    const r = parseProvisions(raw, 'lei');
    expect(r.anomalies).toEqual([]);
    expect(r.provisions.map((p) => p.item_path)).toEqual(['art. 5', 'art. 5 inc. I', 'art. 5 inc. II']);
    expect(r.provisions[0].literal_text).toBe('Art. 5º Para os fins desta Lei, considera-se:');
    expect(r.provisions[2].literal_text).toContain('dado referente à saúde');
    expect(r.provisions[2].literal_text).not.toContain('VETADO');
    // SINTÉTICO: com texto vigente, o artigo partido vira o art. 57 (e "Art. 5 o" continua sendo o art. 5).
    expect(paths('Art. 5 7. Texto.\nArt. 5 o Texto.\nArt. 1 2º Texto.', 'lei')).toEqual(['|art. 57', '|art. 5', '|art. 12']);
  });

  it('não é artigo: referência no meio de frase, "Artigo", "Art. 5ºA" colado em palavra', () => {
    const raw = ['Art. 1º Caput.', 'conforme o Art. 2º desta Lei.', 'Artigo 3º texto.', 'Art. 5ºAlgo.'].join('\n');
    expect(paths(raw, 'lei')).toEqual(['|art. 1']);
  });

  it('parágrafo com sufixo e formatos do Planalto: "§ 1º-A", "§1º", "§ 4 o", "§ 11.", "Parágrafo único -"', () => {
    const raw = ['Art. 64. Caput.', '§ 1º Um.', '§ 1º-A Para fins.', '§2º Dois.', '§ 4 o Quatro.', '§ 11. Onze.', 'Art. 65. Caput.', 'Parágrafo único - Único.'].join('\n');
    expect(paths(raw, 'lei')).toEqual([
      '|art. 64',
      '|art. 64 §1',
      '|art. 64 §1-A',
      '|art. 64 §2',
      '|art. 64 §4',
      '|art. 64 §11',
      '|art. 65',
      '|art. 65 §único',
    ]);
  });

  it('inciso com hífen, meia-risca ou travessão; romano sem traço não é inciso; alíneas ficam dentro do pai', () => {
    const raw = ['Art. 193. Caput:', 'I - inflamáveis;', 'II – roubos;', 'III — colisões, atropelamentos.', 'a) alínea um;', 'b) alínea dois.', 'IV colisões sem traço.', 'V Texto.'].join('\n');
    const r = parseProvisions(raw, 'lei');
    expect(r.provisions.map((p) => p.item_path)).toEqual(['art. 193', 'art. 193 inc. I', 'art. 193 inc. II', 'art. 193 inc. III']);
    expect(r.provisions[3].literal_text).toBe('III — colisões, atropelamentos.\na) alínea um;\nb) alínea dois.\nIV colisões sem traço.\nV Texto.');
  });

  it('dispositivo só com nota de revogação/veto não vira dispositivo e encerra o anterior (sem dispositivo falso)', () => {
    const raw = [
      'Art. 69. Caput.',
      'Parágrafo único. O segurado que retornar.',
      'Art. 70. (Revogado pelo Decreto nº 10.410, de 2020).',
      '§ 1 o (Revogado pelo Decreto nº 10.410, de 2020).',
      '§ 2º (VETADO).',
      '§ 3º Vigente depois de revogados.',
      'III - ; (Revogado pela Lei nº 9.876, de 26.11.1999)',
      'Art. 17 - (Revogado pela Lei nº 13.874, de 2019) (Vide Lei nº 1, de 2000)',
      'Art. 18. Vigente.',
    ].join('\n');
    const r = parseProvisions(raw, 'lei');
    expect(r.provisions.map((p) => p.item_path)).toEqual(['art. 69', 'art. 69 §único', 'art. 70 §3', 'art. 18']);
    expect(r.provisions[1].literal_text).toBe('Parágrafo único. O segurado que retornar.');
    expect(r.provisions[2].literal_text).toBe('§ 3º Vigente depois de revogados.');
    expect(r.anomalies).toEqual([]);
  });

  it('cabeçalho de divisão (LIVRO/TÍTULO/CAPÍTULO/SEÇÃO/Subseção) encerra o dispositivo anterior e o título não entra no literal', () => {
    const raw = [
      'Art. 197. Caput.',
      'Parágrafo único - Os estabelecimentos afixarão avisos.',
      'SEÇÃO XIV',
      'DA PREVENÇÃO DA FADIGA',
      'Art. 198. Outro.',
      '§ 4º A empresa deverá elaborar perfil profissiográfico.',
      'Subseção V',
      'Do Auxílio-Doença',
      'Subseção IV-A',
      '(Incluído pelo Decreto nº 8.145, de 2013)',
      'CAPÍTULO V',
      'TÍTULO II',
      'Seção I',
      'Art. 199. Fim.',
    ].join('\n');
    const r = parseProvisions(raw, 'lei');
    expect(r.provisions.map((p) => [p.item_path, p.literal_text])).toEqual([
      ['art. 197', 'Art. 197. Caput.'],
      ['art. 197 §único', 'Parágrafo único - Os estabelecimentos afixarão avisos.'],
      ['art. 198', 'Art. 198. Outro.'],
      ['art. 198 §4', '§ 4º A empresa deverá elaborar perfil profissiográfico.'],
      ['art. 199', 'Art. 199. Fim.'],
    ]);
  });

  it('artigo com texto que só MENCIONA revogação continua sendo dispositivo', () => {
    const raw = 'Art. 9º Fica revogado o art. 8º.\nArt. 10. (Redação dada pela Lei nº 1, de 2000) Texto vigente.';
    expect(paths(raw, 'lei')).toEqual(['|art. 9', '|art. 10']);
  });

  // SINTÉTICO, com as formas reais do fim das páginas do Planalto: Lei 8.213 (assinatura + "Este texto não substitui…"
  // depois do art. 156), CLT ("ANEXO" depois do art. 922) e Decreto 3.048 ("A N E X O I" depois do art. 382).
  it('cauda do documento (assinatura, "Este texto não substitui…", ANEXO / A N E X O) encerra o último artigo e não vira dispositivo', () => {
    const raw = [
      'Art. 155. Esta Lei entra em vigor na data de sua publicação.',
      'Art. 156. Revogam-se as disposições em contrário.',
      'Brasília, em 24 de julho de 1991; 170º da Independência e 103º da República.',
      'FERNANDO COLLOR',
      'Este texto não substitui o publicado no DOU de 25.7.1991',
      'ANEXO',
      'Quadro a que se refere o art. 577',
      'I - item do quadro',
      'Art. 3º linha do anexo',
    ].join('\n');
    const r = parseProvisions(raw, 'lei');
    expect(r.provisions.map((p) => [p.item_path, p.literal_text])).toEqual([
      ['art. 155', 'Art. 155. Esta Lei entra em vigor na data de sua publicação.'],
      ['art. 156', 'Art. 156. Revogam-se as disposições em contrário.'],
    ]);
    const inicio = raw.indexOf('Brasília');
    const linha = 'Brasília, em 24 de julho de 1991; 170º da Independência e 103º da República.';
    expect(r.anomalies).toEqual([
      { kind: 'cauda_nao_classificada', line: 3, detail: `${linha.slice(0, 60)}… (${raw.length - inicio} caracteres sem dispositivo)` },
    ]);
    // Depois de cabeçalho de anexo nada mais vira dispositivo, nem linha que parece artigo.
    for (const fim of ['ANEXO', 'A N E X O I', 'ANEXO II - Quadro']) {
      const r2 = parseProvisions(`Art. 1º Caput.\n§ 1º Parágrafo.\n${fim}\nI - linha da tabela\nArt. 2º não é artigo`, 'lei');
      expect(r2.provisions.map((p) => [p.item_path, p.literal_text])).toEqual([
        ['art. 1', 'Art. 1º Caput.'],
        ['art. 1 §1', '§ 1º Parágrafo.'],
      ]);
      expect(r2.anomalies.map((a) => [a.kind, a.line])).toEqual([['cauda_nao_classificada', 3]]);
    }
  });

  it('preâmbulo real da CLT/Decreto 3.048 (decreto que aprova o texto, assinatura, aviso, depois o texto aprovado): a assinatura encerra o artigo do preâmbulo e o próximo artigo retoma', () => {
    const raw = [
      'Rio de Janeiro, 1 de maio de 1943, 122º da Independência e 55º da República.',
      'Art. 2º O presente decreto-lei entrará em vigor em 10 de novembro de 1943.',
      'Rio de Janeiro, 1 de maio de 1943, 122º da Independência e 55º da República.',
      'GETÚLIO VARGAS',
      'Este texto não substitui o publicado no DOU de 9.8.1943',
      'CONSOLIDAÇÃO DAS LEIS DO TRABALHO',
      'TÍTULO I',
      'I - linha solta antes do artigo',
      'Art. 3º Esta Consolidação estatui as normas.',
      'Art. 4º Considera-se empregador.',
    ].join('\n');
    const r = parseProvisions(raw, 'lei');
    expect(r.provisions.map((p) => [p.item_path, p.literal_text])).toEqual([
      ['art. 2', 'Art. 2º O presente decreto-lei entrará em vigor em 10 de novembro de 1943.'],
      ['art. 3', 'Art. 3º Esta Consolidação estatui as normas.'],
      ['art. 4', 'Art. 4º Considera-se empregador.'],
    ]);
    expect(r.anomalies).toEqual([]);
  });

  it('"Anexo" no meio do texto, em caixa mista ou com texto depois, não é cauda', () => {
    const raw = 'Art. 68. A relação é aquela constante do\nAnexo IV.\nANEXOS DIVERSOS do quadro\nArt. 69. Seguinte.';
    expect(paths(raw, 'lei')).toEqual(['|art. 68', '|art. 69']);
  });
});

// Literais REAIS (parse 'lei' da página inteira da CLT, del5452.htm baixada em 2026-10-09; sha256 no README de
// test/fixtures/normative/previdenciario) e do Decreto 3.048 (art. 70, fixture dec-3048-arts-64-70.txt).
describe('isRevokedLiteral', () => {
  it('reconhece revogação/veto com e sem parênteses, considerando só o que vem depois do endereço', () => {
    for (const lit of [
      'I - revogado; (Redação dada pela Lei nº 13.103, de 2015) (Vigência)',
      'III - revogado. (Redação dada pela Lei nº 13.103, de 2015) (Vigência)',
      '§ 2 o Revogado. (Redação dada pela Lei nº 10.097, de 19.12.2000)',
      'Parágrafo único. Revogado. (Redação dada pela Lei nº 10.097, de 19.12.2000)',
      '§ 4 o (Declarado inconstitucional pela ADI 5766)',
      'Art. 70. (Revogado pelo Decreto nº 10.410, de 2020).',
      '§ 1 o (Revogado pelo Decreto nº 10.410, de 2020).',
      'Art. 17 - (Revogado pela Lei nº 13.874, de 2019) (Vide Lei nº 1, de 2000)',
      '§ 2º (VETADO).',
      'III - ; (Revogado pela Lei nº 9.876, de 26.11.1999)',
      '15.1.2 (Revogado pela Portaria MTE nº 3.751, de 23 de novembro de 1990)',
      'Art. 152 (Revogado pela Lei nº 9.528, de 1997)',
    ]) {
      expect([lit, isRevokedLiteral(lit)]).toEqual([lit, true]);
    }
  });

  it('texto vigente que MENCIONA revogação, ou que só tem nota de redação, não é revogado', () => {
    for (const lit of [
      'Art. 156. Revogam-se as disposições em contrário.',
      'Art. 9º Fica revogado o art. 8º.',
      'Art. 10. (Redação dada pela Lei nº 1, de 2000) Texto vigente.',
      'Art. 70-A. Revogada a autorização, o órgão comunicará o fato.',
      '§ 1º A efetiva exposição a agente prejudicial à saúde configura-se quando, mesmo após a adoção das medidas de controle previstas na legislação trabalhista, a nocividade não seja eliminada ou neutralizada. (Redação dada pelo Decreto nº 10.410, de 2020).',
      '§ 6º O benefício previsto neste artigo será financiado. (Redação dada pela Lei nº 9.732, de 11.12.98) (Vide Lei nº 9.732, de 11.12.98)',
    ]) {
      expect([lit, isRevokedLiteral(lit)]).toEqual([lit, false]);
    }
  });
});

describe('formatCoverageReport', () => {
  it('resume cobertura, contagem por anexo e anomalias em texto', () => {
    const r = parseProvisions('ANEXO Nº 1\n1.1 Texto A.\nANEXO Nº 3\n3.1 Texto B.\n3.2 Texto C.', 'nr');
    const txt = formatCoverageReport('NR-15', r);
    expect(txt).toMatch(/NR-15/);
    expect(txt).toMatch(/dispositivos: 3/);
    expect(txt).toMatch(/anexo 1: 1/);
    expect(txt).toMatch(/anexo 3: 2/);
    expect(txt).toMatch(/cobertura: \d+%/);
  });

  it('mostra anexo sem dispositivos com destaque, em ordem de aparição, e o corpo como (corpo)', () => {
    // SINTÉTICO (estrutura mínima).
    const r = parseProvisions('1.1 Corpo.\nANEXO Nº 5\nTexto sem item.\nANEXO Nº 3\n3.1 Texto B.', 'nr');
    const linhas = formatCoverageReport('NR-15', r).split('\n');
    const anexos = linhas.filter((l) => l.startsWith('  anexo '));
    expect(anexos[0]).toMatch(/^ {2}anexo \(corpo\): 1 dispositivo, \d+% do texto do anexo$/);
    expect(anexos[1]).toBe('  anexo 5: 0 dispositivos ⚠');
    expect(anexos[2]).toMatch(/^ {2}anexo 3: 1 dispositivo, \d+% do texto do anexo$/);
  });

  it('lista cada trecho em quarentena e o total, depois da lista de anexos; seções aparecem como entradas próprias', () => {
    // SINTÉTICO (estrutura mínima).
    const raw = 'ANEXO Nº 1\n1.1 A.\nANEXO “A”\ntexto fora\nANEXO Nº 1\nSEÇÃO X\n(Incluído pela Portaria Z)\n1. B.';
    const r = parseProvisions(raw, 'nr');
    expect(r.quarantines).toEqual([
      { header_line: 3, header: 'ANEXO “A”', chars: 'ANEXO “A”\ntexto fora\n'.length },
      { header_line: 5, header: 'ANEXO Nº 1', chars: 'ANEXO Nº 1\n'.length },
    ]);
    const linhas = formatCoverageReport('NR-15', r).split('\n');
    expect(linhas.slice(1)).toEqual([
      '  anexo 1: 1 dispositivo, 33% do texto do anexo',
      '  anexo 1/SEÇÃO X: 1 dispositivo, 12% do texto do anexo',
      '  quarentena (linha 3, "ANEXO “A”"): 21 caracteres sem dispositivo',
      '  quarentena (linha 5, "ANEXO Nº 1"): 11 caracteres sem dispositivo',
      '  quarentena total: 32 caracteres sem dispositivo em 2 trechos',
      '  ! anexo_nao_reconhecido ANEXO “A” (linha 3)',
      '  ! anexo_repetido 1 (linha 5)',
    ]);
  });

  it('avisa quando corta a lista de anomalias', () => {
    const anomalies = Array.from({ length: 25 }, (_, i) => ({ kind: 'item_ambiguo' as const, line: i + 1, detail: `x${i}` }));
    const txt = formatCoverageReport('NR-15', { provisions: [], anomalies, anexos: [], quarantines: [], total_chars: 10, covered_chars: 0, coverage: 0 });
    expect(txt).toMatch(/anomalias: mostrando 20 de 25/);
    expect(txt.split('\n').filter((l) => l.startsWith('  ! '))).toHaveLength(20);
    const poucas = formatCoverageReport('NR-15', { provisions: [], anomalies: anomalies.slice(0, 3), anexos: [], quarantines: [], total_chars: 10, covered_chars: 0, coverage: 0 });
    expect(poucas).not.toMatch(/mostrando/);
  });

  it('percentuais com piso: 99,6% aparece como 99%, nunca 100%', () => {
    const txt = formatCoverageReport('NR-15', {
      provisions: [],
      anomalies: [],
      anexos: [{ id: '1', header_line: 1, provisions: 3, chars: 1000, covered_chars: 996 }],
      quarantines: [],
      total_chars: 1000,
      covered_chars: 996,
      coverage: 0.996,
    });
    expect(txt).toMatch(/cobertura: 99%/);
    expect(txt).toMatch(/anexo 1: 3 dispositivos, 99% do texto do anexo/);
    expect(txt).not.toMatch(/100%/);
  });
});

describe('toCodePointOffsets (UTF-16 → pontos de código, como o substring do Postgres)', () => {
  // SINTÉTICO: '𝑀' é U+1D440 (par substituto: 2 unidades UTF-16, 1 ponto de código).
  it('texto sem caractere astral: identidade', () => {
    expect(toCodePointOffsets('abc def', [0, 3, 7])).toEqual([0, 3, 7]);
  });

  it('desconta só os pares ANTES do offset (antes, logo depois do par, e no fim do texto)', () => {
    const t = 'a𝑀b𝑀c'; // UTF-16: a=0, 𝑀=1-2, b=3, 𝑀=4-5, c=6; comprimento 7 (5 pontos de código)
    expect(t.length).toBe(7);
    expect(toCodePointOffsets(t, [0, 1, 3, 4, 6, 7])).toEqual([0, 1, 2, 3, 4, 5]);
    expect(Array.from(t).slice(2, 3).join('')).toBe(t.slice(3, 4));
  });

  it('offsets vazios e texto começando com o par', () => {
    expect(toCodePointOffsets('𝑀x', [])).toEqual([]);
    expect(toCodePointOffsets('𝑀x', [0, 2, 3])).toEqual([0, 1, 2]);
  });

  it('offsets fora de ordem são convertidos um a um', () => {
    expect(toCodePointOffsets('𝑀𝑀ab', [5, 0, 4, 2])).toEqual([3, 0, 2, 1]);
  });

  it('trecho REAL da NR-15 com U+1D440 (NR-15.txt:202-206): o recorte em pontos de código reproduz o literal', () => {
    const raw = [
      'atividades, apresentadas no Quadro 2, ambos deste anexo.',
      '2.4 O Índice de Bulbo Úmido Termômetro de Globo Médio - IBUTG e a Taxa Metabólica Média - 𝑀, a',
      'serem considerados na avaliação da exposição ao calor, devem ser aqueles que, obtidos no período',
      'de 60 (sessenta) minutos corridos, resultem na condição mais crítica de exposição.',
      '2.4.1 A avaliação quantitativa deve ser representativa da exposição, devendo ser desconsideradas',
    ].join('\n');
    expect(raw).toContain('\u{1D440}');
    const r = parseProvisions(raw, 'nr');
    expect(r.provisions.map((p) => p.item_path)).toEqual(['2.4', '2.4.1']);
    const cps = Array.from(raw);
    for (const p of r.provisions) {
      const [s, e] = toCodePointOffsets(raw, [p.char_start, p.char_end]);
      expect(cps.slice(s, e).join('')).toBe(p.literal_text);
    }
    // Depois do 𝑀, o offset em pontos de código é 1 menor que o UTF-16.
    const p241 = r.provisions[1];
    expect(toCodePointOffsets(raw, [p241.char_start])).toEqual([p241.char_start - 1]);
  });
});

describe('parseArgs', () => {
  it('--apply em qualquer posição; o documento é o primeiro argumento sem --', () => {
    expect(parseArgs(['--apply', 'abc'])).toEqual({ documentId: 'abc', apply: true });
    expect(parseArgs(['abc'])).toEqual({ documentId: 'abc', apply: false });
    expect(parseArgs([])).toEqual({ documentId: undefined, apply: false });
  });
});
