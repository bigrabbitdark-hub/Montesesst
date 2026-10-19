import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTenantDto } from '../src/tenants/dto/update-tenant.dto';

async function erros(body: object) {
  return validate(plainToInstance(UpdateTenantDto, body), { whitelist: true, forbidNonWhitelisted: true });
}

describe('UpdateTenantDto — observação e campos do CNPJ', () => {
  it('aceita observação, bairro, complemento e CNAE', async () => {
    expect(
      await erros({
        notes: 'Obra com 3 turnos',
        address_neighborhood: 'Centro',
        address_complement: 'Sala 4',
        cnae_code: '4120400',
        cnae_description: 'Construção de edifícios',
      }),
    ).toHaveLength(0);
  });

  it('aceita limpar observação e CNAE (string vazia)', async () => {
    expect(await erros({ notes: '', cnae_code: '' })).toHaveLength(0);
  });

  it('rejeita CNAE fora do formato e observação acima de 2000 caracteres', async () => {
    expect(await erros({ cnae_code: '41204' })).not.toHaveLength(0);
    expect(await erros({ notes: 'x'.repeat(2001) })).not.toHaveLength(0);
  });

  it('payload antigo (só trade_name e endereço) continua válido — compatibilidade', async () => {
    expect(await erros({ trade_name: 'Fantasia', address_street: 'Rua A', address_state: 'SP' })).toHaveLength(0);
  });
});
