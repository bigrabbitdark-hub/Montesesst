import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CriarEmpresaDto } from '../src/atuacao/dto/criar-empresa.dto';
import { ChangePasswordDto } from '../src/auth/dto/change-password.dto';
import { MaxBytes, MSG_SENHA_72_BYTES } from '../src/common/validators/max-bytes.decorator';

// Ruling 26: bcrypt usa só os primeiros 72 BYTES; @MaxLength conta caracteres ('ç' = 2 bytes em UTF-8).
const opts = { whitelist: true, forbidNonWhitelisted: true };
const empresa = { company_name: 'Empresa X', cnpj: '11222333000181', full_name: 'Fulana', email: 'rh@exemplo.com.br' };
const errosDe = async (cls: any, o: Record<string, unknown>) => validate(plainToInstance(cls, o) as object, opts);
const msgs = (erros: any[], campo: string) => erros.filter((e) => e.property === campo).flatMap((e) => Object.values(e.constraints ?? {}));

describe('MaxBytes(72) — senha medida em bytes', () => {
  it("'ç' x 72 (144 bytes) é recusada no cadastro de empresa, com mensagem em português", async () => {
    const erros = await errosDe(CriarEmpresaDto, { ...empresa, password: 'ç'.repeat(72) });
    expect(msgs(erros, 'password')).toEqual([MSG_SENHA_72_BYTES]);
    expect(MSG_SENHA_72_BYTES).toBe('A senha não pode passar de 72 bytes (acentos e símbolos contam mais de 1)');
  });
  it('72 ASCII é aceita no cadastro', async () => {
    expect(await errosDe(CriarEmpresaDto, { ...empresa, password: 'a'.repeat(72) })).toHaveLength(0);
  });
  it("36 'ç' (72 bytes) é aceita no cadastro", async () => {
    expect(await errosDe(CriarEmpresaDto, { ...empresa, password: 'ç'.repeat(36) })).toHaveLength(0);
  });
  it("37 'ç' (74 bytes) é recusada no cadastro", async () => {
    expect(msgs(await errosDe(CriarEmpresaDto, { ...empresa, password: 'ç'.repeat(37) }), 'password')).toEqual([MSG_SENHA_72_BYTES]);
  });
  it("troca de senha: new_password 'ç' x 72 recusada; 36 'ç' e 72 ASCII aceitas", async () => {
    expect(msgs(await errosDe(ChangePasswordDto, { current_password: 'x', new_password: 'ç'.repeat(72) }), 'new_password')).toEqual([MSG_SENHA_72_BYTES]);
    expect(await errosDe(ChangePasswordDto, { current_password: 'x', new_password: 'ç'.repeat(36) })).toHaveLength(0);
    expect(await errosDe(ChangePasswordDto, { current_password: 'x', new_password: 'a'.repeat(72) })).toHaveLength(0);
  });
  it("troca de senha: current_password 'ç' x 72 recusada (não truncar a comparação)", async () => {
    expect(msgs(await errosDe(ChangePasswordDto, { current_password: 'ç'.repeat(72), new_password: 'novaSenha123' }), 'current_password')).toEqual([MSG_SENHA_72_BYTES]);
  });
  it('valor não-string não passa (e não lança)', async () => {
    class X { @MaxBytes(4) s: unknown; }
    expect(await validate(Object.assign(new X(), { s: 12345 }))).toHaveLength(1);
    expect(await validate(Object.assign(new X(), { s: 'abcd' }))).toHaveLength(0);
  });
});
