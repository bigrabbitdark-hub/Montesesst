import { DocumentsController } from '../src/documents/documents.controller';

// Ruling 11: no modo "atuar como empresa" o upload grava o documento, mas NÃO indexa no provedor
// externo de embedding (spec 2026-11-05-socio-cadastra-e-atua-como-empresa §3). Fora desse modo o
// comportamento atual é preservado.
function montar() {
  const documento = { id: 'doc-1', category: 'pgr', mime_type: 'application/pdf' };
  const documents = { upload: jest.fn().mockResolvedValue(documento) };
  const indexer = {
    shouldIndex: jest.fn().mockReturnValue(true),
    extractAndEmbed: jest.fn().mockResolvedValue([]),
    persistChunks: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new DocumentsController(documents as any, indexer as any, {} as any);
  const client = { query: jest.fn().mockResolvedValue({ rows: [{ full_name: 'Fulano' }] }) };
  const req = (user: Record<string, unknown>) => ({ user, withTenantContext: (fn: (c: any) => any) => fn(client) });
  const file = { buffer: Buffer.from('%PDF-1.4'), mimetype: 'application/pdf', originalname: 'pgr.pdf', size: 8 } as any;
  const dto = { category: 'pgr', title: 'PGR' } as any;
  return { controller, documents, indexer, req, file, dto, documento };
}

describe('DocumentsController.upload — indexação no modo atuação (Ruling 11)', () => {
  it('atuando como empresa: grava o documento e NÃO chama o indexador', async () => {
    const { controller, documents, indexer, req, file, dto, documento } = montar();
    const user = { id: 'socia-1', tenantId: 't-1', role: 'empresa', actingAs: true, actingTenantId: 't-1' };
    await expect(controller.upload(file, dto, req(user))).resolves.toBe(documento);
    expect(documents.upload).toHaveBeenCalledTimes(1);
    expect(indexer.extractAndEmbed).not.toHaveBeenCalled();
    expect(indexer.persistChunks).not.toHaveBeenCalled();
  });

  it('empresa comum (sem actingAs): continua indexando', async () => {
    const { controller, indexer, req, file, dto, documento } = montar();
    const user = { id: 'rh-1', tenantId: 't-1', role: 'empresa' };
    await expect(controller.upload(file, dto, req(user))).resolves.toBe(documento);
    expect(indexer.extractAndEmbed).toHaveBeenCalledWith(documento, file.buffer, ['Fulano']);
    expect(indexer.persistChunks).toHaveBeenCalledTimes(1);
  });
});
