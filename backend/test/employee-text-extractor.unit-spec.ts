import { detectCadastral, extractLocalPeople, HEALTH_MARKERS } from '../src/employees/employee-text-extractor';

const FICHA_ANA = [
  'Nome: ANA FICTICIA', 'CPF: 529.982.247-25', 'Data de nascimento: 03/02/1990', 'Sexo: F', 'Função: SOLDADORA',
  'Data de admissão: 05/01/2020', 'CBO: 7243-15', 'Matrícula eSocial: 00012345678',
].join('\n');

describe('detectCadastral', () => {
  it.each([
    ['ASO', 'ASO do colaborador'],
    ['atestado', 'Atestado de Saúde Ocupacional'],
    ['audiometria', 'Realizada audiometria'],
    ['CID', 'Afastamento CID J00'],
    ['apto para', 'Considerado apto para a função'],
  ])('recusa por saúde (%s) mesmo com CPF válido', (_n, frase) => {
    expect(detectCadastral(`Nome: ANA FICTICIA\nCPF: 529.982.247-25\n${frase}`)).toEqual({ eligible: false, reason: 'saude' });
  });

  it('sem_cpf quando só há 11 dígitos inválidos', () => {
    expect(detectCadastral('Nome: ANA FICTICIA\nCPF: 123.456.789-00')).toEqual({ eligible: false, reason: 'sem_cpf' });
  });

  it('sem_rotulos quando há CPF mas nenhum rótulo cadastral', () => {
    expect(detectCadastral('Contato 529.982.247-25 fim')).toEqual({ eligible: false, reason: 'sem_rotulos' });
  });

  it('elegível com 2 CPFs e rótulos', () => {
    const t = `${FICHA_ANA}\n\nNome: BRUNO FICTICIO\nCPF: 111.444.777-35\nFunção: ELETRICISTA`;
    expect(detectCadastral(t)).toEqual({ eligible: true, cpfCount: 2 });
  });

  it('não dispara saúde em 3 frases cadastrais comuns', () => {
    for (const f of ['Função: Auxiliar Administrativo', 'Admissão: 05/01/2020', 'Cidade: Florianópolis']) {
      expect(detectCadastral(`Nome: ANA FICTICIA\nCPF: 529.982.247-25\n${f}`)).toEqual({ eligible: true, cpfCount: 1 });
    }
  });

  it.each([
    'Parecer: Apto', 'Atestado Saúde Ocupacional', 'ATESTADO MEDICO OCUPACIONAL', 'Exame médico', 'exames médicos realizados',
    'Médico do Trabalho CRM 1234', 'cid: m54', 'audiométrico', 'Atestado de Sau\u0301de', 'A.S.O.', 'PCMSO', 'Classificação Internacional de Doenças',
    'INAPTO', 'Exame Demissional', 'A\u200BSO', 'A  S  O', 'Aptidão física', 'Aptos', 'Atestado', 'Parecer médico', 'Medicina do Trabalho', 'Afastamento INSS B91', 'Audio-metria', 'Esp irometria',
  ])('recusa por saúde (normalizado): %s', (frase) => {
    expect(detectCadastral(`Nome: ANA FICTICIA\nCPF: 529.982.247-25\nFunção: SOLDADORA\n${frase}\n`)).toEqual({ eligible: false, reason: 'saude' });
  });
});

describe('extractLocalPeople', () => {
  it('ficha: extrai os campos rotulados e mascara o CPF na evidência', () => {
    const [p, ...rest] = extractLocalPeople(FICHA_ANA);
    expect(rest).toHaveLength(0);
    expect(p.cpf).toBe('52998224725');
    expect(p.values).toEqual({
      full_name: 'ANA FICTICIA', birth_date: '03/02/1990', sex: 'F', position: 'SOLDADORA',
      admission_date: '05/01/2020', cbo_code: '724315', registration_number: '00012345678',
    });
    expect(p.evidence.length).toBeLessThanOrEqual(200);
    expect(p.evidence).toContain('***.***.***-25');
    expect(p.evidence).not.toContain('529.982.247-25');
    expect(p.evidence).not.toContain('52998224725');
    expect(p.start).toBe(FICHA_ANA.indexOf('529.982.247-25'));
  });

  it('lista: nome antes do CPF na linha; uma pessoa por linha; CPF repetido vira uma só', () => {
    const t = ['BRUNO FICTICIO 111.444.777-35 ELETRICISTA 18/06/2018', 'ANA FICTICIA 529.982.247-25 SOLDADORA 05/01/2020',
      'BRUNO FICTICIO 111.444.777-35 ELETRICISTA 18/06/2018'].join('\n');
    const r = extractLocalPeople(t);
    expect(r.map((p) => p.cpf)).toEqual(['11144477735', '52998224725']);
    expect(r.map((p) => p.values.full_name)).toEqual(['BRUNO FICTICIO', 'ANA FICTICIA']);
    expect(r[0].values.position).toBeUndefined();
  });

  it('ausentes ficam ausentes; datas inexistentes e CBO de 4 dígitos mantidos como texto', () => {
    const [p] = extractLocalPeople('CPF: 529.982.247-25\nAdmissão: 31/02/2020\nSexo: Feminino\nCBO 7243');
    expect(p.values).toEqual({ admission_date: '31/02/2020', sex: 'F', cbo_code: '7243' });
    const [m] = extractLocalPeople('Nome: CARLOS FICTICIO\nCPF: 111.444.777-35\nSexo: Masc');
    expect(m.values.sex).toBe('M');
  });

  it('duas pessoas em blocos consecutivos: campos não vazam', () => {
    const t = `${FICHA_ANA}\n\nNome: BRUNO FICTICIO\nCPF: 111.444.777-35\nFunção: ELETRICISTA`;
    const [a, b] = extractLocalPeople(t);
    expect(a.values.full_name).toBe('ANA FICTICIA');
    expect(a.values.position).toBe('SOLDADORA');
    expect(b.values).toEqual({ full_name: 'BRUNO FICTICIO', position: 'ELETRICISTA' });
  });

  it('bloco sem Função não herda a da pessoa anterior', () => {
    const t = 'Nome: ANA FICTICIA\nCPF: 529.982.247-25\nFunção: SOLDADORA\n\nNome: BRUNO FICTICIO\nCPF: 111.444.777-35';
    const [a, b] = extractLocalPeople(t);
    // Regra dos rótulos comuns: Função existe só na ficha de A => o campo é descartado para TODOS (nunca cruza).
    expect(a.values.position).toBeUndefined();
    expect(b.values.position).toBeUndefined();
    expect(a.values.full_name).toBe('ANA FICTICIA');
    expect(b.values.full_name).toBe('BRUNO FICTICIO');
  });

  it('maiúsculas acentuadas e NFD nos rótulos', () => {
    const [p] = extractLocalPeople('NOME: ANA FICTICIA\nCPF: 529.982.247-25\nFUNÇÃO: SOLDADORA\nADMISSÃO: 05/01/2020');
    expect(p.values).toEqual({ full_name: 'ANA FICTICIA', position: 'SOLDADORA', admission_date: '05/01/2020' });
  });

  it('ignora CPF inválido e número de 11 dígitos que não é CPF', () => {
    expect(extractLocalPeople('Nome: X FICTICIO\nCPF: 123.456.789-00\nTelefone: 48920031245')).toEqual([]);
    expect(extractLocalPeople('Contato 48920031245')).toEqual([]);
  });
});

const A = '529.982.247-25';
const B = '111.444.777-35';
const ANA = { full_name: 'ANA FICTICIA', position: 'SOLDADORA' };
const BRUNO = { full_name: 'BRUNO FICTICIO', position: 'ELETRICISTA' };
const vals = (t: string) => extractLocalPeople(t).map((p) => p.values);

describe('extractLocalPeople: sem atribuição cruzada (falha fechada)', () => {
  it('CPF primeiro: cada bloco fica com a sua pessoa', () => {
    expect(vals(`CPF: ${A}\nNome: ANA FICTICIA\nFunção: SOLDADORA\n\nCPF: ${B}\nNome: BRUNO FICTICIO\nFunção: ELETRICISTA\n`)).toEqual([ANA, BRUNO]);
  });
  it('nome primeiro', () => {
    expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\nFunção: SOLDADORA\n\nNome: BRUNO FICTICIO\nCPF: ${B}\nFunção: ELETRICISTA\n`)).toEqual([ANA, BRUNO]);
    // Sem linha em branco (PDF real): o registro é ancorado em "Nome:", não em linha em branco.
    expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\nFunção: SOLDADORA\nNome: BRUNO FICTICIO\nCPF: ${B}\nFunção: ELETRICISTA\n`)).toEqual([ANA, BRUNO]);
  });
  it('nome primeiro: B sem nome não empresta nada de A', () => {
    // 1 "Nome:" para 2 CPFs: a segmentação é recusada (nº de registros != nº de CPFs) => nada por rótulo.
    expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\nFunção: SOLDADORA\n\nCPF: ${B}\nFunção: ELETRICISTA\n`)).toEqual([{}, {}]);
  });
  it('CPF primeiro: B sem nome não empresta o de A', () => {
    // Nome ausente em B => o campo some para todos; Função (presente nos dois) fica.
    expect(vals(`CPF: ${A}\nNome: ANA FICTICIA\nFunção: SOLDADORA\n\nCPF: ${B}\nFunção: ELETRICISTA\n`)).toEqual([{ position: 'SOLDADORA' }, { position: 'ELETRICISTA' }]);
    expect(vals(`CPF: ${A}\nNome: ANA FICTICIA\nFunção: SOLDADORA\nCPF: ${B}\nFunção: ELETRICISTA\n`)).toEqual([{ position: 'SOLDADORA' }, { position: 'ELETRICISTA' }]);
  });
  it('um CPF por linha, nome depois do CPF na mesma linha', () => {
    expect(vals(`CPF: ${A} Nome: ANA FICTICIA\nCPF: ${B} Nome: BRUNO FICTICIO\n`)).toEqual([{ full_name: 'ANA FICTICIA' }, { full_name: 'BRUNO FICTICIO' }]);
  });
  it('2 CPFs na MESMA linha, CPF primeiro: ninguém recebe o nome do outro', () => {
    expect(vals(`CPF: ${A} Nome: ANA FICTICIA CPF: ${B} Nome: BRUNO FICTICIO\n`)).toEqual([{}, {}]);
  });
  it('2 CPFs na mesma linha seguidos de Nome/Função em outra linha: nada atribuído', () => {
    expect(vals(`CPF: ${A} / ${B}\nNome: ANA FICTICIA\nFunção: SOLDADORA\n`)).toEqual([{}, {}]);
  });
  it('2 CPFs na mesma linha, nome primeiro rotulado: só o trecho imediatamente antes de cada CPF', () => {
    expect(vals(`Nome: ANA FICTICIA CPF: ${A} Nome: BRUNO FICTICIO CPF: ${B}\n`)).toEqual([{ full_name: 'ANA FICTICIA' }, { full_name: 'BRUNO FICTICIO' }]);
    expect(vals(`Nome: ANA FICTICIA; CPF: ${A}; Função: SOLDADORA; Nome: BRUNO FICTICIO; CPF: ${B}; Função: ELETRICISTA\n`)).toEqual([{ full_name: 'ANA FICTICIA' }, { full_name: 'BRUNO FICTICIO' }]);
  });
  it('2 pessoas na mesma linha sem rótulo: o cargo de A não entra no nome de B, nem há cargo/datas', () => {
    expect(vals(`ANA FICTICIA ${A} SOLDADORA  BRUNO FICTICIO ${B} ELETRICISTA\n`)).toEqual([{ full_name: 'ANA FICTICIA' }, {}]);
  });
  it('layout misto (CPFs seguidos e nome depois do último): só a mesma linha', () => {
    const [a] = vals(`Nome: ANA FICTICIA\nCPF: ${A}\nCPF: ${B}\nCPF: 168.995.350-09\nNome: CARLA FICTICIA\n`);
    expect(a).toEqual({});
  });
  it('colunas intercaladas: nada atribuído por proximidade', () => {
    expect(vals(`Nome\nCPF\nFunção\nANA FICTICIA\nBRUNO FICTICIO\n${A}\n${B}\nSOLDADORA\nELETRICISTA\n`)).toEqual([{}, {}]);
  });
  it('valor de rótulo não atravessa outro rótulo nem o CPF', () => {
    expect(vals(`Nome: ANA FICTICIA CPF ${A} Função: SOLDADORA Admissão: 05/01/2020`)).toEqual([
      { full_name: 'ANA FICTICIA', position: 'SOLDADORA', admission_date: '05/01/2020' },
    ]);
  });
});

describe('extractLocalPeople: 11 dígitos que não são CPF', () => {
  const ids = (t: string) => extractLocalPeople(`Nome: X FICTICIO\n${t}`).map((p) => p.cpf);
  it.each([
    'NIT: 52998224725', 'PIS/PASEP: 52998224725', 'CTPS 52998224725', 'Documento 52998224725', 'Matrícula\n52998224725',
    'Protocolo 2024-52998224725', 'id=52998224725', 'Prot.ABC52998224725', 'ABC52998224725DEF', 'a1b2-52998224725-ffff',
    'Telefone para contato do funcionario: 52998224725', 'Conta 52998224725', 'Agência 52998224725', 'RG: 52998224725', '1.52998224725',
  ])('rejeita: %s', (t) => expect(ids(t)).toEqual([]));
  it('CPF legítimo continua', () => {
    expect(ids(`CPF: ${A}`)).toEqual(['52998224725']);
    expect(extractLocalPeople(`BRUNO FICTICIO ${B}`)[0].values.full_name).toBe('BRUNO FICTICIO');
    expect(ids(`Matrícula: 123 CPF: ${A}`)).toEqual(['52998224725']);
  });
});

describe('extractLocalPeople: evidência mascarada', () => {
  it.each([
    `Nome: X FICTICIO CPF ${B} ref CPF 529 982 247 25 e 5299822472552998224725 fim`,
    `5299822472552998224725 ${B}`,
    `${'x'.repeat(100)} 529.982.247-25 ${B} ${'y'.repeat(200)}`,
  ])('sem dígitos do CPF alheio na evidência', (t) => {
    for (const p of extractLocalPeople(t)) {
      expect(p.evidence.length).toBeLessThanOrEqual(200);
      const d = p.evidence.replace(/\D/g, '');
      expect(d).not.toMatch(/52998224|29982247|99822472|98224725/);
      expect(d).not.toContain('11144477');
    }
  });
});

describe('extractLocalPeople: blocos (rodada 2)', () => {
  const C = '168.995.350-09';
  it('probe 8: sem linhas em branco, 2 CPFs no mesmo bloco => nenhum campo emprestado', () => {
    expect(vals(`CPF: ${A}\nFunção: SOLDADORA\nNome: BRUNO FICTICIO\nData de nascimento: 01/01/1980\nSexo: M\nCPF: ${B}\n`)).toEqual([{}, {}]);
  });
  it('rótulos na própria linha do CPF valem mesmo em bloco de 2+ CPFs', () => {
    expect(vals(`CPF: ${A} Nome: ANA FICTICIA\nCPF: ${B} Nome: BRUNO FICTICIO\n`)).toEqual([{ full_name: 'ANA FICTICIA' }, { full_name: 'BRUNO FICTICIO' }]);
  });
  it('F1: lista com rodapé de responsável (com blank + encerrador)', () => {
    expect(vals(`ANA FICTICIA | ${A} | SOLD\nBRUNO FICTICIO | ${B} | ELET\n\nResponsável\nNome: JOSE ASSINANTE\nCargo: GERENTE RH\n`))
      .toEqual([{ full_name: 'ANA FICTICIA' }, { full_name: 'BRUNO FICTICIO' }]);
  });
  it('F3: fichas nome-primeiro + rodapé sem CPF', () => {
    expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\n\nNome: BRUNO FICTICIO\nCPF: ${B}\n\nAssinado por\nFunção: GERENTE RH\nAdmissão: 01/01/2000\n`))
      .toEqual([{ full_name: 'ANA FICTICIA' }, { full_name: 'BRUNO FICTICIO' }]);
  });
  it('M8/M9/N21: rodapé após a última pessoa não contamina', () => {
    expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\n\n\nResponsável técnico\nCargo: ENGENHEIRO DE SEGURANÇA\nMatrícula: 998877\n`)).toEqual([{ full_name: 'ANA FICTICIA' }]);
    expect(vals(`ANA FICTICIA | ${A} | SOLD\n\n\nAssinatura\nNome: JOSE ASSINANTE\nFunção: GERENTE RH\n`)).toEqual([{ full_name: 'ANA FICTICIA' }]);
    expect(vals(`CPF: ${A}\nNome: ANA FICTICIA\n\nAssinatura\nCargo: DIRETOR\n`)).toEqual([{ full_name: 'ANA FICTICIA' }]);
  });
  it('encerrador SEM linha em branco antes encerra o bloco', () => {
    expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\nFunção: SOLDADORA\nResponsável técnico\nCargo: ENGENHEIRO\nAdmissão: 01/01/2000\n`)).toEqual([ANA]);
    expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\nFunção: SOLDADORA\nAprovado por: JOSE\nAdmissão: 01/01/2000\n`)).toEqual([ANA]);
  });
  it('ficha única sem blank + rodapé com os MESMOS rótulos: campo repetido com valor diferente é omitido', () => {
    expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\nFunção: SOLDADORA\nAdmissão: 05/01/2020\nFunção: DIRETOR\n`))
      .toEqual([{ full_name: 'ANA FICTICIA', admission_date: '05/01/2020' }]);
  });
  it('bloco sem CPF é ignorado; texto fora do bloco nunca contribui', () => {
    // R25/R27: cabeçalho colado antes da âncora é ignorado. Nome repetido no registro (texto de outra pessoa) recusa a segmentação.
    expect(vals(`Função: CADASTRO GERAL\nCPF: ${A}\nNome: ANA FICTICIA\n\nCPF: ${B}\nNome: BRUNO FICTICIO\n`)).toEqual([{ full_name: 'ANA FICTICIA' }, { full_name: 'BRUNO FICTICIO' }]);
    expect(vals(`Admissões de 2024 - Admissão: 01/01/2024\nNome: ANA FICTICIA\nCPF: ${A}\n`)).toEqual([{ full_name: 'ANA FICTICIA' }]);
    expect(vals(`CPF: ${A}\nNome: ANA FICTICIA\nNome: ZZ FICTICIO\nFunção: ZZ\n`)).toEqual([{}]);
  });
  it('N12/N11: 2+ pessoas na mesma linha com espaço simples: só a primeira ganha nome', () => {
    expect(vals(`ANA FICTICIA ${A} SOLDADORA BRUNO FICTICIO ${B} ELETRICISTA\n`)).toEqual([{ full_name: 'ANA FICTICIA' }, {}]);
    expect(vals(`ANA FICTICIA ${A} BRUNO FICTICIO ${B} CARLA FICTICIA ${C}\n`)).toEqual([{ full_name: 'ANA FICTICIA' }, {}, {}]);
    expect(extractLocalPeople(`ANA FICTICIA ${A} SOLDADORA BRUNO FICTICIO ${B}\n`).map((p) => p.cpf)).toEqual(['52998224725', '11144477735']);
  });
  it('mesma linha com delimitador explícito: cada pessoa tem o seu nome', () => {
    expect(vals(`ANA FICTICIA | ${A} | SOLD | BRUNO FICTICIO | ${B} | ELET\n`)).toEqual([{ full_name: 'ANA FICTICIA' }, { full_name: 'BRUNO FICTICIO' }]);
  });
  it('tabela com pipes e Markdown com células vazias: linha sem nome fica {}', () => {
    const md = `| Nome | CPF | Cargo | Admissão |\n|---|---|---|---|\n| ANA FICTICIA | ${A} | SOLDADORA | 05/01/2020 |\n| BRUNO FICTICIO | ${B} |  | 18/06/2018 |\n| | ${C} | ELETRICISTA | |\n`;
    // Tabela com cabeçalho: os campos vêm da coluna (célula vazia fica sem o campo).
    expect(vals(md)).toEqual([
      { full_name: 'ANA FICTICIA', position: 'SOLDADORA', admission_date: '05/01/2020' },
      { full_name: 'BRUNO FICTICIO', admission_date: '18/06/2018' },
      { position: 'ELETRICISTA' },
    ]);
    expect(vals(`Nome | CPF | Cargo\nANA FICTICIA | ${A} | \n | ${B} | ELETRICISTA\nCARLA FICTICIA | ${C} | SOLD\n`)).toEqual([
      { full_name: 'ANA FICTICIA' }, { position: 'ELETRICISTA' }, { full_name: 'CARLA FICTICIA', position: 'SOLD' },
    ]);
  });
  it('tabs (DOCX): linha sem nome fica {}; rótulo "Cargo:" na linha vale', () => {
    expect(vals(`Nome\tCPF\tCargo\nANA FICTICIA\t${A}\t\nBRUNO FICTICIO\t${B}\tELETRICISTA\n\t${C}\tSOLDADOR\n`)).toEqual([
      { full_name: 'ANA FICTICIA' }, { full_name: 'BRUNO FICTICIO', position: 'ELETRICISTA' }, { position: 'SOLDADOR' },
    ]);
    expect(vals(`ANA FICTICIA\t${A}\tCargo: SOLD\nBRUNO FICTICIO\t${B}\tCargo: ELET\n`)).toEqual([{ full_name: 'ANA FICTICIA', position: 'SOLD' }, { full_name: 'BRUNO FICTICIO', position: 'ELET' }]);
  });
  it('quebras \\r e \\r\\n funcionam e `start` aponta para o CPF no texto original', () => {
    const t = `Nome: ANA FICTICIA\r\nCPF: ${A}\r\n\r\nNome: BRUNO FICTICIO\rCPF: ${B}\r`;
    const r = extractLocalPeople(t);
    expect(r.map((p) => p.values.full_name)).toEqual(['ANA FICTICIA', 'BRUNO FICTICIO']);
    expect(t.slice(r[1].start, r[1].start + 14)).toBe(B);
  });
  it('evidência de linha compartilhada não mostra outro CPF (nem mascarado) nem dígitos', () => {
    for (const p of extractLocalPeople(`${'x '.repeat(38)}${A} ${B} ${A}\n`)) {
      expect(p.evidence.match(/\*{3}\.\*{3}\.\*{3}-\d\d/g)?.length ?? 0).toBeLessThanOrEqual(1);
      expect(p.evidence.replace(/\*{3}\.\*{3}\.\*{3}-\d\d/g, '')).not.toMatch(/\d/);
    }
  });
});

// Varredura com semente fixa: nenhum valor atribuído a X pode vir de texto sem relação com X.
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function makeCpf(n: number): string {
  const b = String(100000000 + n * 7919 + 13).slice(0, 9).split('').map(Number);
  const dv = (d: number[]) => { const s = d.reduce((a, v, i) => a + v * (d.length + 1 - i), 0); const r = (s * 10) % 11; return r >= 10 ? 0 : r; };
  const d1 = dv(b); const d2 = dv([...b, d1]);
  const s = [...b, d1, d2].join('');
  return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
}
const NAMES = ['ALFA BRAVO', 'CHARLIE DELTA', 'ECHO FOXTROT', 'GOLF HOTEL', 'INDIA JULIET', 'KILO LIMA', 'MIKE NOVEMBER', 'OSCAR PAPA'];

describe('invariante de não-cruzamento (200 documentos sintéticos, semente fixa)', () => {
  it('values de X só contém marcadores de X', () => {
    const rand = rng(20261014);
    const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
    let withData = 0;
    for (let doc = 0; doc < 200; doc++) {
      const n = 1 + Math.floor(rand() * 4);
      const layout = pick(['name_first', 'cpf_first', 'inline', 'table', 'shared_line']);
      const sep = pick(['\n\n', '\n', '\n\n\n']);
      const people = Array.from({ length: n }, (_, i) => ({ i, cpf: makeCpf(doc * 10 + i), name: NAMES[(doc + i) % NAMES.length], pos: `CARGO_${doc}_${i}`, adm: `0${i + 1}/0${i + 1}/20${10 + i}` }));
      const blocks = people.map((p) => {
        if (layout === 'name_first') return `Nome: ${p.name}\nCPF: ${p.cpf}\nFunção: ${p.pos}\nAdmissão: ${p.adm}`;
        if (layout === 'cpf_first') return `CPF: ${p.cpf}\nNome: ${p.name}\nFunção: ${p.pos}\nAdmissão: ${p.adm}`;
        if (layout === 'inline') return `Nome: ${p.name}; CPF: ${p.cpf}; Função: ${p.pos}; Admissão: ${p.adm}`;
        if (layout === 'table') return `${p.name} | ${p.cpf} | ${rand() < 0.5 ? p.pos : ''} |`;
        return `${p.name} | ${p.cpf} | ${p.pos}`;
      });
      // Ficha sem a linha "Função" em UMA pessoa: o campo tem de sumir para TODAS (regra dos rótulos comuns).
      const dropIdx = (layout === 'name_first' || layout === 'cpf_first') && n > 1 && rand() < 0.4 ? Math.floor(rand() * n) : -1;
      if (dropIdx >= 0) blocks[dropIdx] = blocks[dropIdx].replace(/\nFunção: [^\n]*/, '');
      let text = layout === 'shared_line' && rand() < 0.5 ? blocks.join(' | ') : blocks.join(sep);
      // Rodapé sem encerrador só é seguro quando REPETE os rótulos de todos (conflito => descartado); se uma pessoa não tinha
      // o rótulo, o rodapé poderia ocupar a vaga: esse caso é limite conhecido e não entra na varredura.
      const footers = ['', '\n\nResponsável técnico\nFunção: CARGO_FOOT\nAdmissão: 09/09/2099', '\nResponsável técnico\nFunção: CARGO_FOOT\nAdmissão: 09/09/2099', '\n\nAssinatura\nNome: FOOT FICTICIO\nFunção: CARGO_FOOT'];
      if (dropIdx < 0) footers.push('\n\nRodapé\nFunção: CARGO_FOOT\nAdmissão: 09/09/2099', '\n\nAssinado\nNome: FOOT FICTICIO\nFunção: CARGO_FOOT');
      const footer = pick(footers);
      text += footer;
      const out = extractLocalPeople(text);
      for (const o of out) {
        const mine = people.find((p) => onlyDigitsT(p.cpf) === o.cpf);
        expect(mine).toBeDefined();
        const v = o.values;
        if (v.full_name) expect(v.full_name).toBe(mine!.name);
        if (v.position) expect(v.position).toBe(mine!.pos);
        if (v.admission_date) expect(v.admission_date).toBe(mine!.adm);
        expect(JSON.stringify(v)).not.toContain('FOOT');
        if (dropIdx >= 0 && out.length === n) expect(v.position).toBeUndefined();
        if (Object.keys(v).length) withData++;
      }
    }
    expect(withData).toBeGreaterThan(100); // a varredura não é vazia: há extração real
  });
});
const onlyDigitsT = (s: string) => s.replace(/\D/g, '');

describe('extractLocalPeople: registros ancorados em rótulo (rodada 3, sondas dos revisores)', () => {
  it('V1: ficha vizinha SEM CPF colada não cede campos ao CPF', () => {
    expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\nFunção: SOLD\nNome: BRUNO FICTICIO\nSexo: M\nAdmissão: 02/02/2021\nCBO: 7243-15\nMatrícula: 00099999\n`)).toEqual([{}]);
  });
  it('V2: ficha vizinha com CPF digitado errado não cede campos', () => {
    expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\nNome: BRUNO FICTICIO\nCPF: 111.444.777-36\nFunção: ELET\nSexo: M\n`)).toEqual([{}]);
  });
  it('V5: ficha sem CPF ANTES da ficha com CPF', () => {
    expect(vals(`Nome: BRUNO FICTICIO\nSexo: M\nAdmissão: 01/01/2000\nNome: ANA FICTICIA\nCPF: ${A}\n`)).toEqual([{}]);
  });
  it('V6: nome solto de quem não tem CPF não é emprestado', () => {
    expect(vals(`Matrícula: 000123456\nAdmissão: 01/01/2000\nBRUNO FICTICIO\nANA FICTICIA ${A}\n`)).toEqual([{ full_name: 'ANA FICTICIA' }]);
  });
  it('R1: A sem Nome colada a B com Nome: o nome de B nunca vai para A', () => {
    const r = vals(`CPF: ${A}\nFunção: SOLD\nNome: BRUNO FICTICIO\nCPF: ${B}\nFunção: ELET\n`);
    expect(r).toEqual([{ position: 'SOLD' }, { position: 'ELET' }]);
  });
  it('R13: valor quebrado pelo PDF em duas linhas é omitido', () => {
    expect(vals(`Nome: ANA\nFICTICIA DA SILVA\nCPF: ${A}\nFunção: SOLDADORA DE\nPRECISAO\n`)).toEqual([{}]);
  });
  it('R18: linha de encerramento com CPF não é âncora nem pessoa', () => {
    expect(vals(`Responsável: JOSE CPF ${B}\nNome: BRUNO FICTICIO\nFunção: ELET\n`)).toEqual([]);
  });
  it('R19/R32: rótulo de identidade repetido no registro recusa a segmentação', () => {
    expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\nNome: ANA FICTICIA\nFunção: SOLD\n`)).toEqual([{}]);
    expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\nFunção: SOLD\nCPF: 111.111.111-11\nNome: ZZZ FICTICIO\n`)).toEqual([{}]);
  });
  it('R21/R22: fichas lado a lado (2 rótulos na linha) não são segmentadas', () => {
    expect(vals(`Nome: ANA FICTICIA\tNome: BRUNO FICTICIO\nCPF: ${A}\tCPF: ${B}\nFunção: SOLD\tFunção: ELET\n`)).toEqual([{}, {}]);
    expect(vals(`Nome: ANA FICTICIA\tNome: BRUNO FICTICIO\n\nCPF: ${A}\tCPF: ${B}\n`)).toEqual([{}, {}]);
  });
  it('R24: DOCX com "Rótulo:<tab>valor"', () => {
    expect(vals(`Nome:\tANA FICTICIA\nCPF:\t${A}\nFunção:\tSOLD\n\nNome:\tBRUNO FICTICIO\nCPF:\t${B}\nFunção:\tELET\n`))
      .toEqual([{ full_name: 'ANA FICTICIA', position: 'SOLD' }, { full_name: 'BRUNO FICTICIO', position: 'ELET' }]);
  });
  it('R25/R26/R27: cabeçalho colado não vira campo do 1º CPF', () => {
    expect(vals(`Função: CADASTRO GERAL\nCPF: ${A}\nNome: ANA FICTICIA\n\nCPF: ${B}\nNome: BRUNO FICTICIO\n`)).toEqual([{ full_name: 'ANA FICTICIA' }, { full_name: 'BRUNO FICTICIO' }]);
    expect(vals(`Admissões de 2024 - Admissão: 01/01/2024\nNome: ANA FICTICIA\nCPF: ${A}\n`)).toEqual([{ full_name: 'ANA FICTICIA' }]);
    expect(vals(`Nome: ACME LTDA\nCPF: ${A}\nNome: ANA FICTICIA\n`)).toEqual([{}]);
  });
  it('R30: linha só de traços entre fichas', () => {
    expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\n-----\nNome: BRUNO FICTICIO\nCPF: ${B}\nFunção: ELET\n`)).toEqual([{ full_name: 'ANA FICTICIA' }, { full_name: 'BRUNO FICTICIO' }]);
  });
  it('tabela vertical com cabeçalho (DOCX) e aborto por célula faltando', () => {
    expect(vals(`Nome\nCPF\nFunção\nANA FICTICIA\n${A}\nSOLD\nBRUNO FICTICIO\n${B}\nELET\n`))
      .toEqual([{ full_name: 'ANA FICTICIA', position: 'SOLD' }, { full_name: 'BRUNO FICTICIO', position: 'ELET' }]);
    expect(vals(`Nome\nCPF\nFunção\nANA FICTICIA\n${A}\nSOLD\nBRUNO FICTICIO\n${B}\n`)).toEqual([{}, {}]);
    expect(vals(`Nome\nCPF\nFunção\nANA FICTICIA\n${A}\nSOLD\nBRUNO FICTICIO\nELET\n${B}\n`)).toEqual([{}, {}]);
  });
  it('tabela DOCX de 2 colunas "Nome:"/valor em parágrafos separados', () => {
    expect(vals(`Nome:\nANA FICTICIA\nCPF:\n${A}\nFunção:\nSOLD\nNome:\nBRUNO FICTICIO\nCPF:\n${B}\nFunção:\nELET\n`))
      .toEqual([{ full_name: 'ANA FICTICIA', position: 'SOLD' }, { full_name: 'BRUNO FICTICIO', position: 'ELET' }]);
  });
  it('regra dos rótulos comuns: campo ausente em UM registro some para todos', () => {
    expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\nFunção: SOLD\nAdmissão: 01/01/2020\nNome: BRUNO FICTICIO\nCPF: ${B}\nFunção: ELET\n`))
      .toEqual([{ full_name: 'ANA FICTICIA', position: 'SOLD' }, { full_name: 'BRUNO FICTICIO', position: 'ELET' }]);
  });
});

describe('extractLocalPeople: contagem coincidente, rodapé e evidência (rodada 4)', () => {
  const C = '168.995.350-09';
  it('G1/G2: Nome de B nunca vai para o CPF de C (âncoras e CPFs em igual número)', () => {
    expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\nFunção: SOLD\nNome: BRUNO FICTICIO\nSexo: M\nAdmissão: 02/02/2021\nCPF: ${C}\n`)).toEqual([{}, {}]);
    expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\nNome: BRUNO FICTICIO\nSexo: M\nCPF: ${C}\nSexo: F\n`)).toEqual([{}, {}]);
  });
  it('fichas legítimas com a MESMA estrutura continuam lidas', () => {
    expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\nFunção: SOLD\nNome: BRUNO FICTICIO\nCPF: ${C}\nFunção: ELET\n`)).toEqual([ANA_S, BRUNO_E]);
  });
  it('ordem relativa diferente dos rótulos descarta os campos divergentes', () => {
    const r = vals(`Nome: ANA FICTICIA\nCPF: ${A}\nFunção: SOLD\nSexo: F\nNome: BRUNO FICTICIO\nCPF: ${C}\nSexo: M\nFunção: ELET\n`);
    expect(r.every((v) => v.position === undefined && v.sex === undefined)).toBe(true);
    expect(r.map((v) => v.full_name)).toEqual(['ANA FICTICIA', 'BRUNO FICTICIO']);
  });
  it('E16: rodapé conhecido (Observações) encerra; o revisor vê de onde veio um campo de outra linha', () => {
    expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\nObservações\nCargo: DIRETOR\n`)).toEqual([{ full_name: 'ANA FICTICIA' }]);
    for (const c of ['Obs.: x', 'Nota: x', 'Anexo 1', 'Rodapé', 'Declaração', 'Certifico que', 'Atenciosamente']) {
      expect(vals(`Nome: ANA FICTICIA\nCPF: ${A}\n${c}\nCargo: DIRETOR\n`)).toEqual([{ full_name: 'ANA FICTICIA' }]);
    }
    const [p] = extractLocalPeople(`Nome: ANA FICTICIA\nCPF: ${A}\nFunção: SOLDADORA\nAdmissão: 05/01/2020\n`);
    expect(p.evidence).toContain('Função: SOLDADORA');
    expect(p.evidence).toContain('***.***.***-25');
    expect(p.evidence).not.toContain('529.982.247-25');
    expect(p.evidence.length).toBeLessThanOrEqual(200);
  });
  it('evidência de linhas de valor mascara qualquer sequência de 11 dígitos', () => {
    const [p] = extractLocalPeople(`Nome: ANA FICTICIA\nCPF: ${A}\nFunção: SOLD 11144477735 e 111 444 777 35\n`);
    expect(p.evidence.replace(/\*{3}\.\*{3}\.\*{3}-\d\d/g, '').replace(/\D/g, '')).not.toMatch(/\d{5,}/);
  });
});
const ANA_S = { full_name: 'ANA FICTICIA', position: 'SOLD' };
const BRUNO_E = { full_name: 'BRUNO FICTICIO', position: 'ELET' };

describe('M1: cargo e rótulo quebrado pelo PDF no fim da linha', () => {
  const pos = (v: string) => extractLocalPeople(`Nome: ANA FICTICIA\nCPF: 529.982.247-25\nFunção: ${v}\n`)[0].values.position;
  it.each([
    ['ALMOXARIFE  Admissão:', 'ALMOXARIFE'], ['SOLDADOR Nascimento:', 'SOLDADOR'], ['OPERADOR Data de Admissão -', 'OPERADOR'],
    ['AUXILIAR Sexo:', 'AUXILIAR'], ['ELETRICISTA CBO:', 'ELETRICISTA'],
  ])('contaminado %s sai limpo', (v, esp) => expect(pos(v)).toBe(esp));
  it.each(['Analista de Admissão', 'Gerente de Matrícula', 'Auxiliar de Nome Social', 'Técnico de Nascimento'])('legítimo %s fica intacto', (v) => expect(pos(v)).toBe(v));
  it('mesma linha: "Função: ALMOXARIFE  Admissão:" + quebra do PDF', () => {
    expect(extractLocalPeople('Nome: ANA FICTICIA  CPF: 529.982.247-25  Função: ALMOXARIFE  Admissão:\n01/02/2020')[0].values.position).toBe('ALMOXARIFE');
  });
});

describe('desempenho: laços de cabeçalho, teto de linhas e padrões adversariais (rodada 4)', () => {
  const CPF = '529.982.247-25';
  const run = (nome: string, t: string) => it(nome, () => {
    const s = Date.now();
    expect(() => extractLocalPeople(t)).not.toThrow();
    expect(Date.now() - s).toBeLessThan(5000);
  });
  const pats: Record<string, string> = {
    'Nome\\n': 'Nome\n', 'Nome\\nCPF\\n': 'Nome\nCPF\n', 'CPF\\n': 'CPF\n', 'Nome:\\n': 'Nome:\n',
    'cabeçalhos alternados com CPFs': `Nome\nCPF\n${CPF}\n`, 'lista': `ANA FICTICIA ${CPF} SOLD\n`,
    'fichas': `Nome: ANA FICTICIA\nCPF: ${CPF}\nFunção: SOLD\n`, 'tabela vertical': `Nome\nCPF\nFunção\nANA FICTICIA\n${CPF}\nSOLD\n`,
  };
  for (const [name, unit] of Object.entries(pats)) {
    run(`${name} x8000`, unit.repeat(8000) + CPF);
    run(`${name} no teto de 200 000 caracteres`, unit.repeat(Math.ceil(200000 / unit.length)).slice(0, 200000));
  }
  run('Nome\\nCPF\\n x5000 + CPF + 5000 cabeçalhos alternados', 'Nome\nCPF\n'.repeat(5000) + `${CPF}\n` + 'Nome\n'.repeat(5000));
  run('CPF\\n x50000', 'CPF\n'.repeat(50000));
  run('Nome:\\n x20000', 'Nome:\n'.repeat(20000));
  run('20 000 linhas de lista', Array.from({ length: 20000 }, (_, i) => `PESSOA FICTICIA${'ABCDEFGHIJ'[i % 10]} ${makeCpf(i + 3)} X`).join('\n'));
  run('tabela vertical de 2000 linhas', 'Nome\nCPF\nFunção\n' + Array.from({ length: 2000 }, (_, i) => `PESSOA FICTICIA\n${makeCpf(i + 5)}\nXY`).join('\n'));
  it('mais de 50 000 linhas: o excedente é ignorado', () => {
    const t = Array.from({ length: 60000 }, (_, i) => `PESSOA FICTICIA ${makeCpf(i + 1)}`).join('\n');
    expect(extractLocalPeople(t).length).toBeLessThanOrEqual(50000);
  });
});

describe('desempenho (sem ReDoS)', () => {
  const run = (t: string) => {
    const s = Date.now();
    expect(() => { detectCadastral(t); extractLocalPeople(t); }).not.toThrow();
    expect(Date.now() - s).toBeLessThan(10000);
  };
  it('100 000 espaços', () => run(' '.repeat(100_000)));
  it('linha de 1 MB sem quebras', () => run('Nome: ' + 'A'.repeat(1_000_000)));
  it('1 MB de letras e espaços alternados com rótulos', () => run('Função: AB '.repeat(90_000)));
  it('2000 pessoas em ficha e em tabela com pipes', () => {
    const ps = Array.from({ length: 2000 }, (_, i) => ({ cpf: makeCpf(i + 7), n: `PESSOA FICTICIA${'ABCDEFGHIJ'[i % 10]}` }));
    const ficha = ps.map((p) => `Nome: ${p.n.replace(/\d/g, '')}\nCPF: ${p.cpf}\nFunção: XY`).join('\n\n');
    const tabela = ['Nome | CPF | Cargo', ...ps.map((p) => `${p.n} | ${p.cpf} | XY`)].join('\n');
    for (const t of [ficha, tabela]) {
      const s = Date.now();
      const r = extractLocalPeople(t);
      expect(Date.now() - s).toBeLessThan(10000);
      expect(r).toHaveLength(2000);
      expect(r.every((p) => p.values.position === 'XY')).toBe(true);
    }
  });
  it('5 000 CPFs válidos', () => {
    run(Array.from({ length: 5000 }, () => 'Nome: ANA FICTICIA CPF: 529.982.247-25 Função: X').join(' '));
    const t = Array.from({ length: 5000 }, (_, i) => `PESSOA${i} FICTICIA 111.444.777-35 `).join('');
    run(t);
  });
});
