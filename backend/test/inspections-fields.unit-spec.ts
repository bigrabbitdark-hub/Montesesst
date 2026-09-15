import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { InspectionsService } from '../src/inspections/inspections.service';
import { DocumentsService } from '../src/documents/documents.service';

describe('InspectionsService — filial e identificação', () => {
  let service: InspectionsService;
  const fakeDocuments = { upload: jest.fn() };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [InspectionsService, { provide: DocumentsService, useValue: fakeDocuments }],
    }).compile();
    service = moduleRef.get(InspectionsService);
  });

  function fakeClient(handlers: Record<string, unknown>): PoolClient {
    return {
      query: jest.fn(async (sql: string) => {
        for (const [pattern, result] of Object.entries(handlers)) {
          if (sql.includes(pattern)) return result;
        }
        throw new Error(`query inesperada no fake: ${sql}`);
      }),
    } as unknown as PoolClient;
  }

  describe('create', () => {
    it('lança NotFoundException quando a filial não pertence ao tenant', async () => {
      const client = fakeClient({ 'FROM company_units': { rowCount: 0, rows: [] } });
      await expect(
        service.create(client, 'tenant-1', 'user-1', '2026-09-15', 'unidade-de-outro-tenant', undefined, undefined),
      ).rejects.toThrow(NotFoundException);
    });

    it('grava company_unit_id/started_at/ended_at quando a filial pertence ao tenant', async () => {
      const insertedInspection = {
        id: 'insp-1',
        tenant_id: 'tenant-1',
        company_unit_id: 'unidade-1',
        started_at: '08:00',
        ended_at: '10:30',
        visited_at: '2026-09-15',
      };
      // Patterns precisam ser substrings que não colidam entre si: as 3
      // primeiras entradas casam com 3 queries de company_units/tenants
      // DIFERENTES (assertCompanyUnitBelongsToTenant + as 2 de
      // resolveIdentification, que create() também chama agora) — um
      // padrão genérico demais (ex.: só 'FROM company_units') bateria
      // com mais de uma query e o fake devolveria o resultado errado
      // pra uma delas sem avisar.
      const client = fakeClient({
        'company_units WHERE id = $1 AND tenant_id': { rowCount: 1, rows: [{ id: 'unidade-1' }] },
        'SELECT cnpj FROM tenants': { rows: [{ cnpj: '12345678000199' }] },
        address_street: {
          rows: [{ address_street: 'Rua Teste', address_number: '100', address_city: 'São Paulo', address_state: 'SP' }],
        },
        'INSERT INTO inspections': { rows: [insertedInspection] },
        'INSERT INTO inspection_checklist_items': { rows: [] },
      });

      const result = await service.create(client, 'tenant-1', 'user-1', '2026-09-15', 'unidade-1', '08:00', '10:30');

      expect(result.company_unit_id).toBe('unidade-1');
      expect(result.started_at).toBe('08:00');
      expect(result.ended_at).toBe('10:30');
      expect(result.tenant_cnpj).toBe('12345678000199');
      expect(result.company_unit_address).toBe('Rua Teste, 100 — São Paulo/SP');
    });
  });

  describe('resolveIdentification (via findOne)', () => {
    it('resolve CNPJ do tenant e endereço formatado da filial', async () => {
      const client = fakeClient({
        'FROM inspections WHERE id': {
          rows: [{ id: 'insp-1', tenant_id: 'tenant-1', company_unit_id: 'unidade-1' }],
        },
        'FROM inspection_checklist_items': { rows: [] },
        'FROM action_plans': { rows: [] },
        'FROM tenants WHERE id': { rows: [{ cnpj: '12345678000199' }] },
        'FROM company_units WHERE id': {
          rows: [{ address_street: 'Rua Teste', address_number: '100', address_city: 'São Paulo', address_state: 'SP' }],
        },
      });

      const detail = await service.findOne(client, 'insp-1');

      expect(detail.tenant_cnpj).toBe('12345678000199');
      expect(detail.company_unit_address).toBe('Rua Teste, 100 — São Paulo/SP');
    });

    it('company_unit_address fica null quando a inspeção não tem filial', async () => {
      const client = fakeClient({
        'FROM inspections WHERE id': {
          rows: [{ id: 'insp-1', tenant_id: 'tenant-1', company_unit_id: null }],
        },
        'FROM inspection_checklist_items': { rows: [] },
        'FROM action_plans': { rows: [] },
        'FROM tenants WHERE id': { rows: [{ cnpj: '12345678000199' }] },
      });

      const detail = await service.findOne(client, 'insp-1');

      expect(detail.company_unit_address).toBeNull();
    });
  });
});
