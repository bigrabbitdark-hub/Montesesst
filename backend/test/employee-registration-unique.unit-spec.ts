import { ConflictException } from '@nestjs/common';
import { EmployeesService } from '../src/employees/employees.service';

// Unicidade da matrícula garantida pelo código (sem o índice único da 0080, que pode não ser criado em produção
// com duplicatas legadas). Client do pg mockado: nenhum DDL, nenhum banco.
const TENANT = '11111111-1111-4111-8111-111111111111';
const EMP = '22222222-2222-4222-8222-222222222222';

type Handler = (sql: string, params: unknown[]) => { rows: any[]; rowCount: number } | undefined;

function fakeClient(handler: Handler) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return handler(sql, params) ?? { rows: [], rowCount: 0 };
    }),
  };
  return { client: client as any, calls };
}

const service = () =>
  new EmployeesService({ getActiveEmployeeLimit: jest.fn().mockResolvedValue(null) } as any);

const isRegistrationLookup = (sql: string) => /registration_number = \$2 AND id IS DISTINCT FROM \$3/.test(sql);

describe('EmployeesService: matrícula única no código', () => {
  it('create: matrícula já usada no tenant => 409 e nenhum INSERT', async () => {
    const { client, calls } = fakeClient((sql) => (isRegistrationLookup(sql) ? { rows: [{ '?column?': 1 }], rowCount: 1 } : undefined));
    await expect(
      service().create(client, TENANT, { full_name: 'Ana', cpf: '52998224725', registration_number: 'MAT-1' }, 'empresa'),
    ).rejects.toThrow(new ConflictException('Matrícula eSocial já cadastrada nesta empresa'));
    const lookup = calls.find((c) => isRegistrationLookup(c.sql));
    expect(lookup?.params).toEqual([TENANT, 'MAT-1', null]);
    expect(calls.some((c) => /INSERT INTO employees/.test(c.sql))).toBe(false);
  });

  it('create: matrícula livre => INSERT com registration_number normalizado', async () => {
    const { client, calls } = fakeClient((sql) =>
      /INSERT INTO employees/.test(sql) ? { rows: [{ id: EMP }], rowCount: 1 } : undefined,
    );
    await service().create(client, TENANT, { full_name: 'Ana', cpf: '52998224725', registration_number: ' MAT-2 ' }, 'empresa');
    const insert = calls.find((c) => /INSERT INTO employees/.test(c.sql));
    expect(insert?.params).toContain('MAT-2');
  });

  it('create sem matrícula não consulta unicidade', async () => {
    const { client, calls } = fakeClient((sql) => (/INSERT INTO employees/.test(sql) ? { rows: [{ id: EMP }], rowCount: 1 } : undefined));
    await service().create(client, TENANT, { full_name: 'Ana', cpf: '52998224725' }, 'empresa');
    expect(calls.some((c) => isRegistrationLookup(c.sql))).toBe(false);
  });

  it('update: usa o tenant do funcionário ALVO, exclui o próprio id e dá 409 sem UPDATE', async () => {
    const { client, calls } = fakeClient((sql) => {
      if (/SELECT tenant_id FROM employees WHERE id = \$1/.test(sql)) return { rows: [{ tenant_id: TENANT }], rowCount: 1 };
      if (isRegistrationLookup(sql)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
      return undefined;
    });
    await expect(service().update(client, EMP, { registration_number: 'MAT-1' }, 'empresa')).rejects.toBeInstanceOf(ConflictException);
    expect(calls.find((c) => isRegistrationLookup(c.sql))?.params).toEqual([TENANT, 'MAT-1', EMP]);
    expect(calls.some((c) => /^UPDATE employees/.test(c.sql.trim()))).toBe(false);
  });

  it('update limpando a matrícula (vazio => null) não consulta unicidade', async () => {
    const { client, calls } = fakeClient((sql) => (/^UPDATE employees/.test(sql.trim()) ? { rows: [{ id: EMP }], rowCount: 1 } : undefined));
    await service().update(client, EMP, { registration_number: '  ' }, 'empresa');
    expect(calls.some((c) => isRegistrationLookup(c.sql))).toBe(false);
  });
});
