import { isValidCpf } from '../src/employees/employee-fields.util';

describe('CPFs de fixture dos e2e de funcionários', () => {
  const cpfs = [
    '11122233396', '55566677720', '99988877714',
    '40000000043', '40000002925', '40000003069', '40000004030', '40000007994',
    '11144477735', '52998224725', '12345678909',
  ];
  it.each(cpfs)('%s é válido', (cpf) => {
    expect(isValidCpf(cpf)).toBe(true);
  });
});
