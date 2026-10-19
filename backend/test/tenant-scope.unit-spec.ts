import { BadRequestException } from '@nestjs/common';
import { resolveTenantScope } from '../src/epi/tenant-scope.util';
import { resolvePeriod } from '../src/epi/epi-dashboard.service';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

describe('resolveTenantScope', () => {
  it('empresa sem tenant_id usa o próprio', () => {
    expect(resolveTenantScope({ role: 'empresa', tenantId: T1 })).toBe(T1);
  });
  it('empresa com o próprio tenant_id é aceita; com outro -> 400', () => {
    expect(resolveTenantScope({ role: 'empresa', tenantId: T1 }, T1)).toBe(T1);
    expect(() => resolveTenantScope({ role: 'empresa', tenantId: T1 }, T2)).toThrow(BadRequestException);
  });
  it('empresa sem tenant na sessão -> 400', () => {
    expect(() => resolveTenantScope({ role: 'empresa', tenantId: null })).toThrow(BadRequestException);
  });
  it('tecnico, parceiro e admin exigem tenant_id', () => {
    for (const role of ['tecnico', 'parceiro', 'admin']) {
      expect(resolveTenantScope({ role, tenantId: null }, T2)).toBe(T2);
      expect(() => resolveTenantScope({ role, tenantId: null })).toThrow(BadRequestException);
    }
  });
  it('papel desconhecido -> 400', () => {
    expect(() => resolveTenantScope({ role: 'x', tenantId: T1 }, T1)).toThrow(BadRequestException);
  });
});

describe('resolvePeriod', () => {
  const now = new Date('2026-10-18T15:00:00Z'); // 12:00 em São Paulo
  it('padrão: últimos 30 dias (hoje e 29 anteriores)', () => {
    expect(resolvePeriod(undefined, undefined, now)).toEqual({ from: '2026-09-19', to: '2026-10-18' });
  });
  it('usa o dia de São Paulo (01:00 UTC ainda é o dia anterior)', () => {
    expect(resolvePeriod(undefined, undefined, new Date('2026-10-18T01:00:00Z')).to).toBe('2026-10-17');
  });
  it('só from: vai até hoje; só to: 30 dias até to', () => {
    expect(resolvePeriod('2026-10-01', undefined, now)).toEqual({ from: '2026-10-01', to: '2026-10-18' });
    expect(resolvePeriod(undefined, '2026-03-31', now)).toEqual({ from: '2026-03-02', to: '2026-03-31' });
  });
  it('to < from -> 400', () => {
    expect(() => resolvePeriod('2026-10-10', '2026-10-09', now)).toThrow(BadRequestException);
  });
  it('mais de 366 dias -> 400; exatamente 366 passa', () => {
    expect(() => resolvePeriod('2025-01-01', '2026-01-03', now)).toThrow(BadRequestException);
    expect(resolvePeriod('2025-01-01', '2026-01-02', now)).toEqual({ from: '2025-01-01', to: '2026-01-02' });
  });
  it('data inexistente -> 400', () => {
    expect(() => resolvePeriod('2026-02-30', undefined, now)).toThrow(BadRequestException);
  });
});
