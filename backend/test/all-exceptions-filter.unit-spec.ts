import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { AllExceptionsFilter, exceptionLogFields, redactNums } from '../src/common/filters/all-exceptions.filter';

// O filtro global nunca pode registrar dados do banco nem do usuário em 5xx (ex.: o erro de jsonb do pg traz no `where` o JSON
// da linha com CPF e nome). Erros hostis, todos sintéticos.
const CPF = '52998224725';
const NAME = 'JOAO FICTICIO';

const run = (exception: unknown) => {
  const writes: string[] = [];
  const spy = jest.spyOn(process.stderr, 'write').mockImplementation(((c: string) => { writes.push(String(c)); return true; }) as never);
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ id: 'r1', method: 'POST', originalUrl: '/x' }) }) } as never;
  try {
    new AllExceptionsFilter().catch(exception, host);
  } finally {
    spy.mockRestore();
  }
  return { log: writes.join(''), res };
};
const noLeak = (log: string) => {
  expect(log).not.toContain(CPF);
  expect(log).not.toContain('529.982');
  expect(log).not.toContain(NAME);
};

describe('AllExceptionsFilter: log sem PII', () => {
  it('erro do pg com code + where/detail com CPF e nome: só name/code/routine', () => {
    const pgErr = Object.assign(new Error(`invalid input ${CPF}`), {
      name: 'error', code: '22P05', routine: 'json_ereport_error',
      where: `JSON data, line 1: {"cpf":"${CPF}","full_name":"${NAME}"...`, detail: `Key (cpf)=(${CPF}) ${NAME}`,
      hint: NAME, query: `INSERT ... '${CPF}'`, parameters: [CPF, NAME], table: 'employees', column: 'cpf', constraint: NAME,
    });
    const { log, res } = run(pgErr);
    noLeak(log);
    const line = JSON.parse(log);
    expect(line).toMatchObject({ level: 'error', status_code: 500, error_code: '22P05', error_routine: 'json_ereport_error' });
    expect(line.message).toBeUndefined();
    for (const k of ['where', 'detail', 'hint', 'query', 'parameters', 'table', 'column', 'constraint']) expect(line[k]).toBeUndefined();
    // identificadores seguros do pg aparecem com prefixo; constraint com espaço/nome livre é omitida
    expect(line).toMatchObject({ error_table: 'employees', error_column: 'cpf' });
    expect(line.error_constraint).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ statusCode: 500, message: 'Erro interno' });
  });

  it('Error comum com CPF e nome na message e na stack: nada vai ao log', () => {
    const e = new Error(`falha ${CPF} ${NAME}`);
    e.stack = `Error: falha ${CPF} ${NAME}\n    at fn (/app/x.js:1:1)\n    at ${CPF} (/app/y.js:2:2)`;
    const { log, res } = run(e);
    noLeak(log);
    expect(JSON.parse(log).stack).toContain('at fn');
    expect(JSON.parse(log).stack).not.toContain(CPF);
    expect(res.json).toHaveBeenCalledWith({ statusCode: 500, message: 'Erro interno' });
  });

  it('stack truncada a 20 linhas', () => {
    const e = new Error('x');
    e.stack = 'Error: x\n' + Array.from({ length: 50 }, (_v, i) => `    at f${i} (/a.js:1:1)`).join('\n');
    expect(JSON.parse(run(e).log).stack.split('\n')).toHaveLength(20);
  });

  it('objeto circular, message não-string e valores que não são Error não quebram o filtro', () => {
    const circ: Record<string, unknown> = { name: 'X' };
    circ.self = circ;
    for (const ex of [circ, { message: { a: 1 }, name: 5 }, null, undefined, 42, 'texto ' + CPF, Object.create(null)]) {
      const { log, res } = run(ex);
      expect(log).not.toContain(CPF);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(JSON.parse(log).status_code).toBe(500);
    }
  });

  it('HttpException 5xx estática mantém a message (com 9+ dígitos trocados); 4xx preserva o log e troca os dígitos', () => {
    const bad = JSON.parse(run(new BadGatewayException(`Falha externa ${CPF}`)).log);
    expect(bad.status_code).toBe(502);
    expect(bad.message).toBe('Falha externa [NUM]');
    const c = run(new BadRequestException(`CPF ${CPF} inválido`));
    const line = JSON.parse(c.log);
    expect(line).toMatchObject({ level: 'warn', status_code: 400, message: 'CPF [NUM] inválido' });
    expect(line.stack).toBeUndefined();
    expect(c.res.status).toHaveBeenCalledWith(400); // a resposta HTTP não muda
  });

  it('redactNums troca corridas de 9+ dígitos com separadores e preserva números curtos', () => {
    expect(redactNums('a 529.982.247-25 b 12345 c 5 2 9 9 8 2 2 4 7 2 5')).toBe('a [NUM] b 12345 c [NUM]');
    expect(exceptionLogFields(new Error('x'), 500, false).message).toBeUndefined();
  });
});

describe('AllExceptionsFilter: localização do erro sem PII', () => {
  it('Error comum: registra name e a primeira linha da stack (arquivo:linha), nunca a message', () => {
    const e = new TypeError(`falha ${CPF} ${NAME}`);
    e.stack = `TypeError: falha ${CPF} ${NAME}\n    at EmployeeIngestionService.apply (/app/dist/src/employees/employee-ingestion.service.js:200:15)\n    at next (/app/x.js:1:1)`;
    const line = JSON.parse(run(e).log);
    expect(line.error_name).toBe('TypeError');
    expect(line.error_at).toBe('at EmployeeIngestionService.apply (/app/dist/src/employees/employee-ingestion.service.js:200:15)');
    expect(line.message).toBeUndefined();
    noLeak(JSON.stringify(line));
  });
});

describe('AllExceptionsFilter: sondas hostis da revisão', () => {
  const PII = ['Maria Souza da Silva', '123.456.789-09', '12345678909', 'maria@x.com'];
  const runReq = (thrown: unknown, url = '/employees') => {
    const writes: string[] = [];
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(((c: string) => { writes.push(String(c)); return true; }) as never);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ id: 'r1', method: 'GET', originalUrl: url }) }) } as never;
    let threw: unknown = null;
    try { new AllExceptionsFilter().catch(thrown, host); } catch (e) { threw = e; } finally { spy.mockRestore(); }
    return { log: writes.join(''), res, threw };
  };
  const clean = (x: ReturnType<typeof runReq>) => {
    expect(x.threw).toBeNull();
    for (const p of PII) expect(x.log).not.toContain(p);
    expect(x.res.status).toHaveBeenCalledWith(500);
    expect(x.res.json).toHaveBeenCalledWith({ statusCode: 500, message: 'Erro interno' });
    expect(() => JSON.parse(x.log)).not.toThrow();
  };

  it('2: message com linhas "at ..." forjadas: as linhas da message saem da stack', () => {
    const e = new Error('bad\n    at Maria Souza da Silva (x)\n    at 12345678909');
    const x = runReq(e);
    clean(x);
    expect(JSON.parse(x.log).stack).not.toMatch(/Maria|12345678909/);
  });
  it('3: message-objeto cujo toString lança', () => {
    const e: any = new Error('x');
    e.message = { toString() { throw new Error('boom'); } };
    clean(runReq(e));
  });
  it('4: objeto circular não-Error com name de PII', () => {
    const c: any = { a: 1, name: 'Maria Souza da Silva' };
    c.self = c;
    clean(runReq(c));
  });
  it('10: code com PII vira [omitido]', () => {
    const c: any = new Error('x');
    c.code = 'Maria Souza da Silva'.repeat(20);
    const x = runReq(c);
    clean(x);
    expect(JSON.parse(x.log).error_code).toBe('[omitido]');
  });
  it('11: getter de stack que lança', () => {
    const g: any = new Error('x');
    Object.defineProperty(g, 'stack', { get() { throw new Error('stack boom'); } });
    clean(runReq(g));
  });
  it('13: name com PII vira [omitido]', () => {
    const n: any = new Error('x');
    n.name = 'Maria Souza da Silva 12345678909';
    const x = runReq(n);
    clean(x);
    expect(JSON.parse(x.log).error_name).toBe('[omitido]');
  });
  it('14: nome de função com PII na stack vira [omitido] (ou o frame é descartado)', () => {
    const e = new Error('e');
    e.stack = 'Error: e\n    at Maria,Souza@da (/app/x.js:1:2)\n    at Maria Souza da Silva (/app/w.js:1:2)\n    at ok (/app/y.js:3:4)';
    const x = runReq(e);
    clean(x);
    const line = JSON.parse(x.log);
    expect(line.stack).toContain('at [omitido] (/app/x.js:1:2)');
    expect(line.stack).toContain('at ok (/app/y.js:3:4)');
  });
  it('15: message Symbol', () => {
    const e: any = new Error('x');
    e.message = Symbol('s');
    clean(runReq(e));
  });
  it('16: query string da URL não vai ao log', () => {
    const x = runReq(new Error('e'), '/employees?search=Maria%20Souza%20da%20Silva&cpf=12345678909');
    clean(x);
    expect(JSON.parse(x.log).path).toBe('/employees');
  });
  it('stack enorme, não-string, Proxy hostil, null/undefined/string', () => {
    const huge = new Error('h');
    huge.stack = 'Error: h\n' + Array.from({ length: 100000 }, (_v, i) => `    at fn${i} (/app/x.js:${i}:1)`).join('\n');
    clean(runReq(huge));
    const st: any = new Error('x');
    st.stack = 12345;
    clean(runReq(st));
    clean(runReq(new Proxy({}, { get() { throw new Error('p'); }, has() { throw new Error('p'); } })));
    for (const v of [null, undefined, 'Maria Souza da Silva']) clean(runReq(v));
  });
  it('Error com status 400 que não é HttpException continua 500 e sem PII', () => {
    const e: any = new Error('Maria Souza da Silva');
    e.status = 400;
    clean(runReq(e));
  });
  it('frames fora do formato são descartados; error_at é o primeiro frame fora de node_modules', () => {
    const e = new Error('x');
    e.stack = 'Error: x\n    at lixo com Maria Souza da Silva\n    at Client.query (/app/node_modules/pg/lib/client.js:10:5)\n    at EmployeesService.save (/app/dist/employees.service.js:7:9)\n    at /app/dist/z.js:1:1\n    at node:internal/process/task_queues:95:5';
    const line = JSON.parse(runReq(e).log);
    expect(line.stack).not.toContain('lixo');
    expect(line.stack.split('\n')).toHaveLength(4);
    expect(line.error_at).toBe('at EmployeesService.save (/app/dist/employees.service.js:7:9)');
  });
  it('TypeError: libera só as mensagens de programação exatas', () => {
    const ok = JSON.parse(runReq(new TypeError("Cannot read properties of undefined (reading 'cpf')")).log);
    expect(ok.message).toBe("Cannot read properties of undefined (reading 'cpf')");
    expect(JSON.parse(runReq(new TypeError('foo.bar is not a function')).log).message).toBe('foo.bar is not a function');
    for (const bad of [`Cannot read properties of undefined (reading 'x') ${CPF}`, `${NAME} is not a function`, `The "path" argument must be string. Received ${NAME}`]) {
      expect(JSON.parse(runReq(new TypeError(bad)).log).message).toBeUndefined();
    }
    expect(JSON.parse(runReq(new SyntaxError("Unexpected token 'x' in JSON")).log).message).toBeUndefined();
  });
});
