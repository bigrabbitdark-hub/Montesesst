import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCompanyUnitDto } from '../src/company-units/dto/create-company-unit.dto';
import { UpdateCompanyUnitDto } from '../src/company-units/dto/update-company-unit.dto';

const base = { name: 'F', address_street: 'R', address_city: 'C', address_state: 'SC', address_zip: '88801000' };
const opts = { whitelist: true, forbidNonWhitelisted: true };

describe('DTOs de filial — CNPJ', () => {
  it('criação exige CNPJ válido e normaliza a máscara', async () => {
    const ok = plainToInstance(CreateCompanyUnitDto, { ...base, cnpj: '12.345.678/0002-76' });
    expect(await validate(ok, opts)).toHaveLength(0);
    expect(ok.cnpj).toBe('12345678000276');
    expect(await validate(plainToInstance(CreateCompanyUnitDto, base), opts)).not.toHaveLength(0);
    expect(await validate(plainToInstance(CreateCompanyUnitDto, { ...base, cnpj: '12345678000277' }), opts)).not.toHaveLength(0);
    expect(await validate(plainToInstance(CreateCompanyUnitDto, { ...base, cnpj: '' }), opts)).not.toHaveLength(0);
  });

  it('edição: CNPJ é opcional, mas se vier tem que ser válido (vazio não limpa)', async () => {
    expect(await validate(plainToInstance(UpdateCompanyUnitDto, { name: 'X' }), opts)).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateCompanyUnitDto, { cnpj: '12.345.678/0003-57' }), opts)).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateCompanyUnitDto, { cnpj: '' }), opts)).not.toHaveLength(0);
    expect(await validate(plainToInstance(UpdateCompanyUnitDto, { cnpj: '123' }), opts)).not.toHaveLength(0);
  });

  it('campos cadastrais e observação: aceitos, com limites', async () => {
    const dados = { legal_name: 'X SA', notes: 'obs', address_neighborhood: 'Centro', address_complement: 'S4', cnae_code: '4120400', cnae_description: 'Y' };
    expect(await validate(plainToInstance(CreateCompanyUnitDto, { ...base, cnpj: '12345678000276', ...dados }), opts)).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateCompanyUnitDto, dados), opts)).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateCompanyUnitDto, { cnae_code: '' , notes: '' }), opts)).toHaveLength(0);
    expect(await validate(plainToInstance(UpdateCompanyUnitDto, { cnae_code: '12' }), opts)).not.toHaveLength(0);
    expect(await validate(plainToInstance(UpdateCompanyUnitDto, { notes: 'x'.repeat(2001) }), opts)).not.toHaveLength(0);
  });
});
