import { BadRequestException } from '@nestjs/common';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host: any = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ id: 'r1', method: 'POST', originalUrl: '/x' }),
    }),
  };
  const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  new AllExceptionsFilter().catch(exception, host);
  spy.mockRestore();
  return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

const multer = (code: string, message: string) => Object.assign(new Error(message), { name: 'MulterError', code });

describe('AllExceptionsFilter — erros 4xx que não são HttpException', () => {
  it('HttpException preserva status e corpo', () => {
    const r = run(new BadRequestException('x'));
    expect(r.status).toBe(400);
  });

  it.each([
    ['LIMIT_UNEXPECTED_FILE', 'Unexpected file field'],
    ['LIMIT_FIELD_ARRAY_INDEX', 'Field name array index too large'],
    ['LIMIT_FIELD_NESTING', 'Field name nesting too deep'],
    ['INVALID_FIELD_NAME', 'Invalid field name'],
    ['LIMIT_FIELD_COUNT', 'Too many fields'],
  ])('MulterError %s vira 400 (independe do texto da mensagem)', (code, msg) => {
    const r = run(multer(code, msg));
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain(msg);
  });

  it('MulterError LIMIT_FILE_SIZE vira 413', () => {
    expect(run(multer('LIMIT_FILE_SIZE', 'File too large')).status).toBe(413);
  });

  it('erro http-errors do body-parser (413 / 400) mantém o status', () => {
    expect(run(Object.assign(new Error('request entity too large'), { status: 413, expose: true })).status).toBe(413);
    expect(run(Object.assign(new Error('bad json'), { statusCode: 400, expose: true })).status).toBe(400);
  });

  it('falha de descompressão do corpo (zlib) vira 400', () => {
    expect(run(Object.assign(new Error('incorrect header check'), { code: 'Z_DATA_ERROR', errno: -3 })).status).toBe(400);
  });

  it('erro qualquer sem marca de cliente continua 500 e sem vazar detalhe', () => {
    const r = run(new Error('falha interna com segredo'));
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ statusCode: 500, message: 'Erro interno' });
  });

  it('status 5xx marcado como expose não é rebaixado para 4xx', () => {
    expect(run(Object.assign(new Error('x'), { status: 503, expose: false })).status).toBe(500);
  });
});
