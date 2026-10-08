import { NormativeAssistantService } from '../src/normative/normative-assistant.service';

describe('NormativeAssistantService.searchReference — fonte ativa', () => {
  it('só recupera chunks de fontes ativas, vigentes e indexadas', async () => {
    const queries: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return { rows: [] };
      }),
    };
    const db = { withoutTenantContext: async (cb: (c: any) => any) => cb(client) };
    const service = new NormativeAssistantService(
      {} as any,
      {} as any,
      db as any,
      {} as any,
      {} as any,
    );

    await (service as any).searchReference([0.1, 0.2], 5);

    const sql = queries.find((q) => q.includes('normative_document_chunks'));
    expect(sql).toBeDefined();
    expect(sql).toMatch(/s\.active\s*=\s*true/);
    expect(sql).toMatch(/d\.status\s*=\s*'vigente'/);
    expect(sql).toMatch(/d\.indexed_at\s+IS\s+NOT\s+NULL/);
  });
});
