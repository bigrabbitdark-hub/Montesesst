import { EmployeeIngestionService } from '../src/employees/employee-ingestion.service';

// `fields` das linhas `novo`: o revisor vê o que será gravado. Só CPF (válido ou formatado) é mascarado.
describe('toPublic: fields do item novo', () => {
  const svc = new EmployeeIngestionService({} as never, {} as never);
  const fieldsOf = (values: Record<string, string>) =>
    svc.toPublic({
      id: 'x', tenant_id: 't', document_id: 'd', status: 'requer_revisao', summary: {}, created_at: new Date(), resolved_at: null,
      candidates: [{ line: 1, kind: 'novo', values: { full_name: 'ANA FICTICIA', cpf: '52998224725', ...values } }],
    } as never).items[0].fields;

  it('matrícula que NÃO é CPF válido aparece inteira; CPF válido como matrícula é mascarado; datas e ordem fixa', () => {
    expect(fieldsOf({ registration_number: '00012345678', admission_date: '2020-01-05', position: 'SOLDADOR', birth_date: '1988-03-05', cbo_code: '715615' })).toEqual([
      { field: 'birth_date', value: '1988-03-05' },
      { field: 'position', value: 'SOLDADOR' },
      { field: 'admission_date', value: '2020-01-05' },
      { field: 'registration_number', value: '00012345678' },
      { field: 'cbo_code', value: '715615' },
    ]);
    expect(fieldsOf({ registration_number: '52998224725' })).toEqual([{ field: 'registration_number', value: '***.***.***-25' }]);
  });

  it('CPF embutido (válido ou só formatado) em texto livre é mascarado; número longo que não é CPF fica', () => {
    const v = fieldsOf({ position: 'AJUDANTE 529.982.247-25 e 111.111.111-11 ref 123456789012345' });
    expect(v?.[0].value).toBe('AJUDANTE ***.***.***-25 e [CPF removido] ref 123456789012345');
    expect(JSON.stringify(v)).not.toContain('52998224725');
    expect(fieldsOf({ position: 'x'.repeat(500) })?.[0].value).toBe(`${'x'.repeat(200)}…`);
    expect(fieldsOf({ activity_description: 'y'.repeat(200) })?.[0].value).toBe('y'.repeat(200)); // no limite: sem reticências
    expect(fieldsOf({ activity_description: `${'y'.repeat(200)}z` })?.[0].value).toBe(`${'y'.repeat(200)}…`);
    expect(fieldsOf({})).toEqual([]);
  });
});
