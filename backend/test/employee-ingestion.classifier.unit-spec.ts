import { classifyRows, normalizedCpfs, ExistingEmployee } from '../src/employees/employee-ingestion.classifier';
import { SheetRow } from '../src/employees/employee-sheet.parser';

const U1 = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const U2 = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';

const emp = (over: Partial<ExistingEmployee> = {}): ExistingEmployee => ({
  id: 'e1', cpf: '52998224725', company_unit_id: U1, full_name: 'ANA FICTICIA', esocial_registration: null,
  birth_date: null, sex: null, position: null, admission_date: null, cbo_code: null, activity_description: null, ...over,
});
const row = (line: number, values: SheetRow['values']): SheetRow => ({ line, values });
const byCpf = (...es: ExistingEmployee[]) => new Map(es.map((e) => [e.cpf, e]));

describe('classifyRows', () => {
  it('CPF desconhecido vira "novo", com filial padrão e valores normalizados (CBO com zero, data ISO, sexo maiúsculo)', () => {
    const r = classifyRows([row(10, { full_name: 'BIA FICTICIA', cpf: '111.444.777-35', cbo_code: '51210', birth_date: '03/02/1990', sex: 'f' })], new Map(), U1);
    expect(r.autoApply).toEqual([]);
    expect(r.candidates).toEqual([
      { line: 10, kind: 'novo', values: { full_name: 'BIA FICTICIA', cpf: '11144477735', cbo_code: '051210', birth_date: '1990-02-03', sex: 'F', company_unit_id: U1 } },
    ]);
  });

  it('funcionário existente: campos vazios são auto-aplicados; sem mudança conta em unchanged', () => {
    const r = classifyRows(
      [row(10, { full_name: 'ANA FICTICIA', cpf: '52998224725', position: 'SOLDADORA', sex: 'F' })],
      byCpf(emp()), U1,
    );
    expect(r.autoApply).toEqual([{ line: 10, employee_id: 'e1', values: { position: 'SOLDADORA', sex: 'F' } }]);
    expect(r.candidates).toEqual([]);
    const same = classifyRows([row(10, { full_name: 'ana ficticia', cpf: '52998224725' })], byCpf(emp()), U1);
    expect(same).toEqual({ autoApply: [], candidates: [], unchanged: 1 });
  });

  it('campo diferente e já preenchido é conflito (cadastro intacto); o vazio do mesmo registro ainda é auto-aplicado', () => {
    const r = classifyRows(
      [row(10, { full_name: 'ANA FICTICIA', cpf: '52998224725', position: 'GERENTE', sex: 'F' })],
      byCpf(emp({ position: 'SOLDADORA' })), U1,
    );
    expect(r.autoApply).toEqual([{ line: 10, employee_id: 'e1', values: { sex: 'F' } }]);
    expect(r.candidates).toEqual([
      { line: 10, kind: 'conflito', employee_id: 'e1', full_name: 'ANA FICTICIA', cpf: '52998224725', conflicts: [{ field: 'position', current: 'SOLDADORA', proposed: 'GERENTE' }] },
    ]);
  });

  it('célula vazia na planilha nunca apaga dado existente', () => {
    const r = classifyRows([row(10, { full_name: 'ANA FICTICIA', cpf: '52998224725' })], byCpf(emp({ position: 'SOLDADORA' })), U1);
    expect(r.autoApply).toEqual([]);
    expect(r.candidates).toEqual([]);
    expect(r.unchanged).toBe(1);
  });

  it('funcionário de outra filial: conflito "outra_filial", sem campos aplicáveis e sem auto-aplicar', () => {
    const r = classifyRows([row(10, { full_name: 'ANA FICTICIA', cpf: '52998224725', position: 'SOLDADORA' })], byCpf(emp({ company_unit_id: U2 })), U1);
    expect(r.autoApply).toEqual([]);
    expect(r.candidates).toEqual([
      { line: 10, kind: 'conflito', employee_id: 'e1', full_name: 'ANA FICTICIA', cpf: '52998224725', conflicts: [], reason: 'outra_filial' },
    ]);
  });

  it('CPF inválido, ausente ou campo inválido viram "invalida" sem nome nem CPF; CPF numérico sem zero é restaurado', () => {
    const r = classifyRows(
      [
        row(10, { full_name: 'X FICTICIO', cpf: '12345678900' }),
        row(11, { full_name: 'SEM CPF FICTICIO' }),
        row(12, { cpf: '987.654.321-00' }),
        row(13, { full_name: 'CBO RUIM FICTICIO', cpf: '52998224725', cbo_code: '12' }),
      ],
      new Map(), U1,
    );
    const inv = r.candidates.filter((c) => c.kind === 'invalida');
    expect(inv.map((c) => c.line)).toEqual([10, 11, 12, 13]);
    for (const c of inv) expect(JSON.stringify(c)).not.toMatch(/FICTICIO|\d{9}/);
  });

  it('CPF numérico do Excel sem o(s) zero(s) à esquerda é restaurado (CPFs sintéticos válidos 01000000028 e 00100000037)', () => {
    const r = classifyRows(
      [row(10, { full_name: 'ZERO UM FICTICIO', cpf: '1000000028' }), row(11, { full_name: 'ZERO DOIS FICTICIO', cpf: '100000037' })],
      new Map(), U1,
    );
    expect(r.candidates.map((c) => (c.kind === 'novo' ? c.values.cpf : 'x'))).toEqual(['01000000028', '00100000037']);
  });

  it('CPF repetido na planilha invalida todas as ocorrências', () => {
    const r = classifyRows(
      [row(10, { full_name: 'A FICTICIO', cpf: '529.982.247-25' }), row(11, { full_name: 'B FICTICIO', cpf: '52998224725' })],
      new Map(), U1,
    );
    expect(r.candidates.map((c) => [c.line, c.kind])).toEqual([[10, 'invalida'], [11, 'invalida']]);
  });

  it('linha inválida não contamina outra de CPF diferente', () => {
    const r = classifyRows(
      [row(10, { full_name: 'A FICTICIO', cpf: '52998224725', cbo_code: '12' }), row(11, { full_name: 'B FICTICIO', cpf: '11144477735' })],
      new Map(), U1,
    );
    expect(r.candidates.map((c) => [c.line, c.kind])).toEqual([[10, 'invalida'], [11, 'novo']]);
  });

  it('maiúsculas/minúsculas e espaços diferentes em campo de texto não viram conflito', () => {
    const r = classifyRows(
      [row(10, { full_name: '  ana ficticia ', cpf: '52998224725', position: ' soldadora ' })],
      byCpf(emp({ position: 'SOLDADORA' })), U1,
    );
    expect(r).toEqual({ autoApply: [], candidates: [], unchanged: 1 });
  });
});

describe('classifyRows - correções da rodada 1', () => {
  it('CPF repetido com só uma linha válida invalida as DUAS', () => {
    const r = classifyRows(
      [row(10, { full_name: 'A FICTICIO', cpf: '52998224725', cbo_code: '12' }), row(11, { full_name: 'B FICTICIO', cpf: '52998224725' })],
      new Map(), U1,
    );
    expect(r.candidates.map((c) => [c.line, c.kind])).toEqual([[10, 'invalida'], [11, 'invalida']]);
    expect(JSON.stringify(r.candidates)).not.toMatch(/FICTICIO|\d{9}/);
  });

  it('novo não carrega status, position_id nem company_unit_id vindos da linha; filial só do defaultUnitId', () => {
    const hostile: any = { full_name: 'H FICTICIO', cpf: '52998224725', status: 'inativo', position_id: 'x', company_unit_id: 'y' };
    const comUnidade = classifyRows([row(10, hostile)], new Map(), U1);
    expect(comUnidade.candidates).toEqual([{ line: 10, kind: 'novo', values: { cpf: '52998224725', full_name: 'H FICTICIO', company_unit_id: U1 } }]);
    const semUnidade = classifyRows([row(10, hostile)], new Map(), null);
    expect(semUnidade.candidates).toEqual([{ line: 10, kind: 'novo', values: { cpf: '52998224725', full_name: 'H FICTICIO' } }]);
  });

  it('funcionário existente sem filial: aplica e conflita normalmente, sem checagem de filial', () => {
    const r = classifyRows(
      [row(10, { full_name: 'ANA FICTICIA', cpf: '52998224725', position: 'GERENTE', sex: 'F' })],
      byCpf(emp({ company_unit_id: null, position: 'SOLDADORA' })), U1,
    );
    expect(r.autoApply).toEqual([{ line: 10, employee_id: 'e1', values: { sex: 'F' } }]);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ kind: 'conflito', conflicts: [{ field: 'position' }] });
  });
});

describe('normalizedCpfs', () => {
  it('devolve CPFs válidos normalizados, com zeros restaurados e sem repetição; ignora inválidos', () => {
    const cpfs = normalizedCpfs([
      row(10, { full_name: 'A FICTICIO', cpf: '529.982.247-25' }),
      row(11, { full_name: 'B FICTICIO', cpf: '52998224725' }),
      row(12, { full_name: 'C FICTICIO', cpf: '1000000028' }),
      row(13, { full_name: 'D FICTICIO', cpf: '12345678900' }),
      row(14, { full_name: 'E FICTICIO' }),
    ]);
    expect(cpfs).toEqual(['52998224725', '01000000028']);
  });
});

describe('classifyRows — reviewOnly e evidence (Fatia 4)', () => {
  const rv = (line: number, values: SheetRow['values'], extra: Partial<SheetRow> = {}): SheetRow => ({ line, values, ...extra });
  const ANA = { full_name: 'ANA FICTICIA', cpf: '52998224725' };

  it('(a) campo reviewOnly vazio no cadastro vira sugestao (nunca autoApply); os demais campos seguem a regra da Fatia 3', () => {
    const r = classifyRows(
      [rv(10, { ...ANA, position: 'SOLDADORA', sex: 'F', cbo_code: '51210' }, { reviewOnly: ['position', 'cbo_code'], evidence: 'Função: SOLDADORA' })],
      byCpf(emp()), U1,
    );
    expect(r.autoApply).toEqual([{ line: 10, employee_id: 'e1', values: { sex: 'F' } }]);
    expect(r.candidates).toEqual([{
      line: 10, kind: 'sugestao', employee_id: 'e1', full_name: 'ANA FICTICIA', cpf: '52998224725',
      suggestions: [{ field: 'position', proposed: 'SOLDADORA' }, { field: 'cbo_code', proposed: '051210' }], evidence: 'Função: SOLDADORA',
    }]);
    expect(r.unchanged).toBe(0);
  });

  it('(b) campo reviewOnly diferente do cadastro é conflito normal, com evidence; campo não reviewOnly vazio continua auto-aplicado', () => {
    const r = classifyRows(
      [rv(10, { ...ANA, position: 'GERENTE', sex: 'F' }, { reviewOnly: ['position'], evidence: 'Cargo: GERENTE' })],
      byCpf(emp({ position: 'SOLDADORA' })), U1,
    );
    expect(r.autoApply).toEqual([{ line: 10, employee_id: 'e1', values: { sex: 'F' } }]);
    expect(r.candidates).toEqual([{
      line: 10, kind: 'conflito', employee_id: 'e1', full_name: 'ANA FICTICIA', cpf: '52998224725',
      conflicts: [{ field: 'position', current: 'SOLDADORA', proposed: 'GERENTE' }], evidence: 'Cargo: GERENTE',
    }]);
  });

  it('campo não reviewOnly diferente continua conflito mesmo com outros campos reviewOnly na linha', () => {
    const r = classifyRows(
      [rv(10, { ...ANA, sex: 'M', position: 'SOLDADORA' }, { reviewOnly: ['position'] })],
      byCpf(emp({ sex: 'F' })), U1,
    );
    expect(r.autoApply).toEqual([]);
    // Um item por linha: o conflito carrega as sugestões da mesma linha.
    expect(r.candidates).toEqual([{
      line: 10, kind: 'conflito', employee_id: 'e1', full_name: 'ANA FICTICIA', cpf: '52998224725',
      conflicts: [{ field: 'sex', current: 'F', proposed: 'M' }], suggestions: [{ field: 'position', proposed: 'SOLDADORA' }],
    }]);
  });

  it('(c) CPF desconhecido com campos reviewOnly vira novo (revisão), com evidence', () => {
    const r = classifyRows(
      [rv(10, { full_name: 'BIA FICTICIA', cpf: '11144477735', position: 'PINTORA' }, { reviewOnly: ['position', 'full_name'], evidence: 'BIA FICTICIA - PINTORA' })],
      new Map(), U1,
    );
    expect(r.autoApply).toEqual([]);
    expect(r.candidates).toEqual([
      { line: 10, kind: 'novo', values: { full_name: 'BIA FICTICIA', cpf: '11144477735', position: 'PINTORA', company_unit_id: U1 }, evidence: 'BIA FICTICIA - PINTORA' },
    ]);
  });

  it('(d) evidence é propagada a novo/conflito/sugestao e ausente em invalida', () => {
    const r = classifyRows(
      [
        rv(1, { full_name: 'BIA FICTICIA', cpf: '11144477735' }, { evidence: 'ev-novo' }),
        rv(2, { ...ANA, position: 'X' }, { evidence: 'ev-conf' }),
        rv(3, { full_name: 'CAIO FICTICIO', cpf: '12345678909', position: 'Y' }, { reviewOnly: ['position'], evidence: 'ev-sug' }),
        rv(4, { full_name: 'DUDA FICTICIA', cpf: '123' }, { evidence: 'ev-inv' }),
        rv(5, { full_name: 'EVA FICTICIA', cpf: '39053344705' }, { evidence: 'ev-rep' }),
        rv(6, { full_name: 'EVA FICTICIA', cpf: '39053344705' }, { evidence: 'ev-rep2' }),
      ],
      byCpf(emp({ position: 'SOLDADORA' }), emp({ id: 'e3', cpf: '12345678909', full_name: 'CAIO FICTICIO' })), U1,
    );
    const ev = (line: number) => r.candidates.find((c) => c.line === line) as Record<string, unknown>;
    expect(ev(1)).toMatchObject({ kind: 'novo', evidence: 'ev-novo' });
    expect(ev(2)).toMatchObject({ kind: 'conflito', evidence: 'ev-conf' });
    expect(ev(3)).toMatchObject({ kind: 'sugestao', evidence: 'ev-sug' });
    for (const l of [4, 5, 6]) {
      expect(ev(l).kind).toBe('invalida');
      expect('evidence' in ev(l)).toBe(false);
    }
  });

  it('(e) linha só com campos reviewOnly e funcionário já igual é unchanged', () => {
    const r = classifyRows(
      [rv(10, { ...ANA, position: 'soldadora' }, { reviewOnly: ['position', 'full_name'], evidence: 'x' })],
      byCpf(emp({ position: 'SOLDADORA' })), U1,
    );
    expect(r).toEqual({ autoApply: [], candidates: [], unchanged: 1 });
  });

  it('(f) evidence nunca guarda dígitos de CPF: completo, formatado, com espaços e já mascarado', () => {
    const run = (evidence: string) => (classifyRows([rv(1, { full_name: 'BIA FICTICIA', cpf: '11144477735' }, { evidence })], new Map(), U1)
      .candidates[0] as { evidence?: string }).evidence as string;
    for (const e of [
      'CPF 52998224725 do ANA', 'CPF 529.982.247-25 do ANA', 'CPF 529 982 247 25 do ANA', 'CPF 529 . 982 . 247 - 25',
      '529\n982\n247\n25', 'X 5 2 9 9 8 2 2 4 7 2 5 Y', 'ID 529982247', 'ab 529.982.247-25 | Nome: BIA',
    ]) {
      const out = run(e);
      expect(out.replace(/\D/g, '').length).toBeLessThan(9);
      expect(out).not.toMatch(/529|982|247/);
    }
    expect(run('Nome: ANA | Função: PINTORA')).toBe('Nome: ANA | Função: PINTORA');
    expect(run('Matrícula 1234 e CBO 51210')).toBe('Matrícula 1234 e CBO 51210');
  });

  it('evidence é limitada a 200 caracteres (mascara antes de cortar) e vazia vira ausente', () => {
    const run = (evidence: unknown) => classifyRows([rv(1, { full_name: 'BIA FICTICIA', cpf: '11144477735' }, { evidence: evidence as string })], new Map(), U1)
      .candidates[0] as { evidence?: string };
    const longo = run('a'.repeat(195) + ' 529.982.247-25');
    expect(longo.evidence!.length).toBeLessThanOrEqual(200);
    expect(longo.evidence).not.toMatch(/\d{3}/);
    expect(run('b'.repeat(500)).evidence).toHaveLength(200);
    expect('evidence' in run('   ')).toBe(false);
    expect('evidence' in run(123)).toBe(false);
  });

  it('funcionário existente com sugestao também expõe full_name e CPF do cadastro; outra_filial nunca gera sugestao', () => {
    const r = classifyRows(
      [
        rv(1, { full_name: 'ana ficticia cadastro', cpf: '52998224725', position: 'SOLDADORA' }, { reviewOnly: ['position'], evidence: 'ev' }),
        rv(2, { full_name: 'CAIO FICTICIO', cpf: '12345678909', position: 'Y' }, { reviewOnly: ['position'], evidence: 'ev2' }),
      ],
      byCpf(emp({ full_name: 'Ana Ficticia Cadastro' }), emp({ id: 'e2', cpf: '12345678909', full_name: 'CAIO FICTICIO', company_unit_id: U2 })), U1,
    );
    expect(r.candidates[0]).toMatchObject({ kind: 'sugestao', full_name: 'Ana Ficticia Cadastro', cpf: '52998224725' });
    expect(r.candidates[1]).toEqual({
      line: 2, kind: 'conflito', employee_id: 'e2', full_name: 'CAIO FICTICIO', cpf: '12345678909', conflicts: [], reason: 'outra_filial', evidence: 'ev2',
    });
    expect(r.candidates).toHaveLength(2);
  });

  it('chaves hostis em reviewOnly e evidence não vazam para o candidato novo', () => {
    const hostil = rv(1, { full_name: 'BIA FICTICIA', cpf: '11144477735', position: 'PINTORA' }, {
      reviewOnly: ['__proto__', 'status', 'cpf', 'company_unit_id', 'position'] as never,
      evidence: { __proto__: { status: 'aprovado' }, status: 'aprovado', toString: () => 'x' } as never,
    });
    const r = classifyRows([hostil], new Map(), U1);
    const c = r.candidates[0] as { kind: string; values: Record<string, string>; evidence?: string };
    expect(c.kind).toBe('novo');
    expect(Object.keys(c.values).sort()).toEqual(['company_unit_id', 'cpf', 'full_name', 'position']);
    expect(c.values.company_unit_id).toBe(U1);
    expect('status' in c.values).toBe(false);
    expect('evidence' in c).toBe(false);
    expect(({} as Record<string, unknown>).status).toBeUndefined();
  });

  it('reviewOnly hostil em funcionário existente não faz cpf/chaves estranhas virarem sugestao; position continua sugestao', () => {
    const r = classifyRows(
      [rv(1, { ...ANA, position: 'SOLDADORA' }, { reviewOnly: ['__proto__', 'cpf', 'status', 'position'] as never })],
      byCpf(emp()), U1,
    );
    expect(r.autoApply).toEqual([]);
    expect(r.candidates).toMatchObject([{ kind: 'sugestao', suggestions: [{ field: 'position', proposed: 'SOLDADORA' }] }]);
  });

  it('funcionário de outra filial com campos reviewOnly vazios: conflito outra_filial, sem sugestões nem autoApply', () => {
    const r = classifyRows(
      [rv(1, { ...ANA, position: 'SOLDADORA' }, { reviewOnly: ['position'] })],
      byCpf(emp({ company_unit_id: U2 })), U1,
    );
    expect(r.autoApply).toEqual([]);
    expect(r.candidates).toEqual([
      { line: 1, kind: 'conflito', employee_id: 'e1', full_name: 'ANA FICTICIA', cpf: '52998224725', conflicts: [], reason: 'outra_filial' },
    ]);
  });

  it('ordenação por line e normalizedCpfs inalterados com reviewOnly/evidence', () => {
    const rows = [
      rv(30, { full_name: 'C FICTICIO', cpf: '39053344705' }, { evidence: 'c' }),
      rv(10, { ...ANA, position: 'S' }, { reviewOnly: ['position'], evidence: 'a' }),
      rv(20, { full_name: 'B FICTICIA', cpf: '11144477735' }, { evidence: 'b' }),
    ];
    const r = classifyRows(rows, byCpf(emp()), U1);
    expect(r.candidates.map((c) => c.line)).toEqual([10, 20, 30]);
    expect(normalizedCpfs(rows)).toEqual(['39053344705', '52998224725', '11144477735']);
  });

  it('reviewOnly malformado falha fechado: nada da linha vai para autoApply; [] explícito e null mantêm o comportamento normal', () => {
    const base = { ...ANA, position: 'SOLDADORA', sex: 'F' };
    const bad: unknown[] = [{ position: 1 }, 'position', [['position']], ['cargo'], ['position', 7], ['__proto__'], ['position', {}]];
    for (const ro of bad) {
      const r = classifyRows([rv(1, base, { reviewOnly: ro as never })], byCpf(emp()), U1);
      expect(r.autoApply).toEqual([]);
      expect(r.candidates).toMatchObject([{ kind: 'sugestao', suggestions: [{ field: 'sex' }, { field: 'position' }] }]);
    }
    for (const ro of [[], null, undefined]) {
      const r = classifyRows([rv(1, base, { reviewOnly: ro as never })], byCpf(emp()), U1);
      expect(r.autoApply).toEqual([{ line: 1, employee_id: 'e1', values: { position: 'SOLDADORA', sex: 'F' } }]);
      expect(r.candidates).toEqual([]);
    }
  });

  it('valor de campo que não é texto invalida a linha (nunca "[object Object]")', () => {
    for (const bad of [{ a: 1 }, ['A'], 42]) {
      const r = classifyRows([rv(1, { ...ANA, position: bad as never }, { reviewOnly: ['position'] })], byCpf(emp()), U1);
      expect(r.autoApply).toEqual([]);
      expect(r.candidates).toEqual([{ line: 1, kind: 'invalida', reason: expect.any(String) }]);
    }
  });

  it('undefined no cadastro conta como vazio e não lança', () => {
    const r = classifyRows([rv(1, { ...ANA, position: 'X' })], byCpf(emp({ position: undefined as never })), U1);
    expect(r.autoApply).toEqual([{ line: 1, employee_id: 'e1', values: { position: 'X' } }]);
  });

  it('evidence: NFKC (sobrescritos, circulados, largura total) e marcadores legítimos preservados quando colados a números', () => {
    const run = (evidence: string) => (classifyRows([rv(1, { full_name: 'BIA FICTICIA', cpf: '11144477735' }, { evidence })], new Map(), U1)
      .candidates[0] as { evidence?: string }).evidence as string;
    for (const e of ['⁵²⁹⁹⁸²²⁴⁷²⁵', '⑤②⑨⑨⑧②②④⑦②⑤', '５２９９８２２４７２５']) expect(run(e)).not.toMatch(/\d{3}|[⁰-⁹①-⑳]/);
  });

  it('N1: marcadores forjados não protegem dígitos de CPF (tabela do revisor)', () => {
    const run = (evidence: string) => (classifyRows([rv(1, { full_name: 'BIA FICTICIA', cpf: '11144477735' }, { evidence })], new Map(), U1)
      .candidates[0] as { evidence?: string }).evidence ?? '';
    for (const e of [
      '[CPF_1]52998224725', '5299[MAT_1]8224725', '529.982[CPF_1]247-25', '[CPF_52998224725]', '[MAT_52998224725]', '[CBO_529982247]',
      '[CPF_1] 529982247', '5299[CPF]8224725', '529[MAT_]982[CBO_]24725',
    ]) expect(run(e).replace(/\D/g, '').length).toBeLessThan(6);
  });

  it('N1: fuzz de 3000 evidences com marcadores forjados dentro de CPFs de 11 dígitos: 0 vazamentos de 6+ dígitos', () => {
    let seed = 777;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
    const seps = ['', ' ', '.', '-', '  ', '\n', '/', '_'];
    const marks = ['[CPF_1]', '[MAT_22]', '[CBO_3]', '[CPF]', '[CPF_529982]', '[MAT_]'];
    let leaks = 0;
    for (let i = 0; i < 3000; i++) {
      const cpf = String(10000000000 + Math.floor(rnd() * 89999999999)).split('');
      let out = '';
      cpf.forEach((d, k) => { out += d; if (k < 10) { out += pick(seps); if (rnd() < 0.3) out += pick(marks) + pick(seps); } });
      const ev = `Nome: ${pick(['ANA', 'BIA'])} | ${out} | fim`;
      const got = (classifyRows([rv(1, { full_name: 'BIA FICTICIA', cpf: '11144477735' }, { evidence: ev })], new Map(), U1).candidates[0] as { evidence?: string }).evidence ?? '';
      if (got.replace(/\D/g, '').length >= 6) leaks++;
    }
    expect(leaks).toBe(0);
  });

  it('N2: line duplicada na entrada lança erro estático (classifyRows e normalizedCpfs); vazia e 2000 únicas funcionam', () => {
    const dupl = [rv(1, ANA), rv(1, { full_name: 'B FICTICIA', cpf: '11144477735' })];
    expect(() => classifyRows(dupl, new Map(), U1)).toThrow('Linhas duplicadas na entrada do classificador');
    expect(() => normalizedCpfs(dupl)).toThrow('Linhas duplicadas na entrada do classificador');
    expect(() => classifyRows([rv(5, ANA), rv(5, { full_name: '', cpf: 'x' })], new Map(), U1)).toThrow('Linhas duplicadas');
    expect(classifyRows([], new Map(), U1)).toEqual({ autoApply: [], candidates: [], unchanged: 0 });
    const many = Array.from({ length: 2000 }, (_, i) => rv(i + 2, { full_name: 'P FICTICIO ' + i, cpf: 'x' + i }));
    const t = Date.now();
    expect(classifyRows(many, new Map(), U1).candidates).toHaveLength(2000);
    expect(Date.now() - t).toBeLessThan(10000);
  });

  it('reviewOnly com length > 64 (inclusive array esparso gigante) é malformado e não trava; cpf de invalida por valor não-texto conta na repetição', () => {
    const sparse = new Array(2 ** 32 - 1) as never;
    const t = Date.now();
    const r = classifyRows([rv(1, { ...ANA, position: 'X' }, { reviewOnly: sparse })], byCpf(emp()), U1);
    expect(Date.now() - t).toBeLessThan(5000);
    expect(r.autoApply).toEqual([]);
    expect(r.candidates).toMatchObject([{ kind: 'sugestao' }]);
    const rep = classifyRows([rv(1, { ...ANA, position: 7 as never }), rv(2, { ...ANA })], byCpf(emp()), U1);
    expect(rep.candidates.map((c) => c.kind)).toEqual(['invalida', 'invalida']);
    expect((rep.candidates[1] as { reason: string }).reason).toBe('CPF repetido na planilha');
  });

  it('invariante: nunca há duas entradas com a mesma line (500 entradas aleatórias, seed fixa)', () => {
    let seed = 20261014;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
    const cpfs = ['52998224725', '11144477735', '12345678909', '39053344705', 'abc'];
    const fields = ['position', 'sex', 'cbo_code', 'full_name'] as const;
    const valuesFor: Record<string, (string | undefined)[]> = { position: ['SOLDADOR', 'Outro', undefined], sex: ['F', 'M', undefined], cbo_code: ['51210', '99999', undefined], full_name: ['ANA FICTICIA', 'OUTRA FICTICIA', 'X'] };
    let sawConfSug = 0;
    for (let i = 0; i < 500; i++) {
      const rows: SheetRow[] = [];
      for (let j = 0; j < 1 + Math.floor(rnd() * 8); j++) {
        const values: SheetRow['values'] = { cpf: pick(cpfs), full_name: pick(valuesFor.full_name) as string };
        for (const f of fields) { const v = pick(valuesFor[f]); if (v !== undefined) (values as Record<string, string>)[f] = v; }
        rows.push(rv(100 - j * 3 - Math.floor(rnd() * 3), values, { // line única por entrada (o parser nunca repete)
          
          reviewOnly: pick([undefined, [], ['position'], ['sex', 'cbo_code'], [...fields], ['cargo'] as never]),
          evidence: pick([undefined, 'ev']),
        }));
      }
      const ex = ['52998224725', '11144477735', '12345678909'].filter(() => rnd() < 0.7).map((c) => emp({
        id: 'id' + c, cpf: c, company_unit_id: pick([null, U1, U2]), full_name: pick(['ANA FICTICIA', 'Outro']),
        position: pick([null, 'SOLDADOR', 'Outro']), sex: pick([null, 'F', 'M']), cbo_code: pick([null, '051210']),
      }));
      const r = classifyRows(rows, byCpf(...ex), pick([null, U1, U2]));
      const lines = r.candidates.map((c) => c.line);
      expect(new Set(lines).size).toBe(lines.length);
      expect(lines).toEqual([...lines].sort((a, b) => a - b));
      for (const c of r.candidates) {
        if (c.kind === 'conflito' && c.suggestions) sawConfSug++;
        if (c.kind === 'conflito' && c.reason === 'outra_filial') expect(c.suggestions).toBeUndefined();
        if (c.kind === 'invalida') expect('evidence' in c).toBe(false);
        if ('evidence' in c && c.evidence) expect(c.evidence.length).toBeLessThanOrEqual(200);
      }
    }
    expect(sawConfSug).toBeGreaterThan(0);
  });
});
