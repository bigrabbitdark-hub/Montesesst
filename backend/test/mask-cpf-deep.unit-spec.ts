import { createHash, randomUUID } from 'crypto';
import { maskCpfDeep } from '../src/common/pii/mask-cpf-deep.util';

describe('maskCpfDeep', () => {
  it('mascara CPF com e sem máscara em strings aninhadas (objeto e array), sem alterar o original', () => {
    const src = { a: 'CPF 52998224725 e 529.982.247-25', b: [{ c: 'x 111.444.777-35 y' }, ['CPF 52998224725']], n: 5, d: null as null };
    const out = maskCpfDeep(src);
    expect(out).toEqual({ a: 'CPF ***.982.247-** e ***.982.247-**', b: [{ c: 'x ***.444.777-** y' }, ['CPF ***.982.247-**']], n: 5, d: null });
    expect(src.a).toContain('52998224725');
    expect(maskCpfDeep('CPF 52998224725')).toBe('CPF ***.982.247-**');
    expect(maskCpfDeep('529.982.247-25')).toBe('***.982.247-**');
  });

  it('não mexe em números maiores (recibo/protocolo), CNPJ ou datas', () => {
    const when = new Date('2026-10-19T00:00:00Z');
    const out = maskCpfDeep({ r: '1.2.0000000000000000077', p: '1.2.202610.0000000000000000042', cnpj: '12345678000190', when });
    expect(out.r).toBe('1.2.0000000000000000077');
    expect(out.p).toBe('1.2.202610.0000000000000000042');
    expect(out.cnpj).toBe('12345678000190');
    expect(out.when).toBe(when);
  });

  it('UUID com 11 dígitos colados a letras nas bordas não é alterado (em texto livre e como valor)', () => {
    for (const u of ['3f2504e0-4f89-41d3-9a0c-a12345678901', '3f2504e0-4f89-41d3-9a0c-12345678901a']) {
      expect(maskCpfDeep(u)).toBe(u);
      expect(maskCpfDeep(`evento ${u} ok`)).toBe(`evento ${u} ok`);
      expect(maskCpfDeep({ detail: u })).toEqual({ detail: u });
    }
  });

  it('valores de chaves id/*_id/*_ids ficam intactos mesmo se parecerem CPF', () => {
    const u = '3f2504e0-4f89-41d3-9a0c-012345678901';
    expect(maskCpfDeep(u)).toBe(u);
    const ids = { id: '52998224725', employee_id: u, actor_user_id: u, tenant_ids: [u, '52998224725'] };
    expect(maskCpfDeep(ids)).toEqual(ids);
  });

  it('hash sha256 hex não é alterado', () => {
    const h = createHash('sha256').update('x').digest('hex');
    expect(maskCpfDeep(h)).toBe(h);
    const fake = '0123456789a' + '52998224725' + 'b'.repeat(42);
    expect(maskCpfDeep({ sha: fake })).toEqual({ sha: fake });
  });

  it('5.000 UUIDs aleatórios não mudam (soltos, em texto e em chaves *_id)', () => {
    const ids = Array.from({ length: 5000 }, () => randomUUID());
    expect(maskCpfDeep(ids)).toEqual(ids);
    const text = ids.join(' ');
    expect(maskCpfDeep(text)).toBe(text);
    const rows = ids.map((id) => ({ id, aso_record_id: id, detail: `ref ${id}` }));
    expect(maskCpfDeep(rows)).toEqual(rows);
  });

  it('ciclo e profundidade > 20 não lançam e não vazam CPF', () => {
    const a: any = { cpf: 'CPF 52998224725' };
    a.self = a;
    const out: any = maskCpfDeep(a);
    expect(out.cpf).toBe('CPF ***.982.247-**');
    expect(out.self).toBe('[omitido]');
    let deep: any = { v: 'CPF 52998224725' };
    for (let i = 0; i < 30; i++) deep = { n: deep };
    expect(() => maskCpfDeep(deep)).not.toThrow();
    expect(JSON.stringify(maskCpfDeep(deep))).not.toContain('52998224725');
  });
});
