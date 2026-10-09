import { BadRequestException, ConflictException, NotFoundException, ParseUUIDPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { NormativeDocumentsController } from '../src/normative/normative-documents.controller';
import { NormativeDocumentsService } from '../src/normative/normative-documents.service';
import { RejectBatchDto } from '../src/normative/dto/reject-batch.dto';
import { RetireDocumentDto } from '../src/normative/dto/retire-document.dto';

const UUID = (n: number) => `123e4567-e89b-42d3-a456-4266141740${String(n).padStart(2, '0')}`;
const erros = async (Classe: any, dados: object) => (await validate(plainToInstance(Classe, dados))).map((e) => e.property);

function clienteFalso(respostas: (sql: string, params: any[]) => any) {
  const consultas: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      return respostas(sql, params) ?? { rows: [] };
    }),
  };
  return { client, consultas };
}
const doc = (extra: object = {}) => ({ id: UUID(1), source_id: 's1', status: 'aguardando_validacao', raw_text: 'a\nb', ...extra });
const novoService = () => new NormativeDocumentsService({} as any, {} as any);

describe('DTOs', () => {
  it('lote: 1 a 50 UUIDs distintos e motivo', async () => {
    expect(await erros(RejectBatchDto, { ids: [], reason: 'x' })).toContain('ids');
    expect(await erros(RejectBatchDto, { ids: ['nao-uuid'], reason: 'x' })).toContain('ids');
    expect(await erros(RejectBatchDto, { ids: [UUID(1), UUID(1)], reason: 'x' })).toContain('ids');
    expect(await erros(RejectBatchDto, { ids: Array.from({ length: 51 }, (_, i) => UUID(i)), reason: 'x' })).toContain('ids');
    expect(await erros(RejectBatchDto, { ids: [UUID(1)], reason: '' })).toContain('reason');
    expect(await erros(RejectBatchDto, { ids: [UUID(1), UUID(2)], reason: 'ruído' })).toEqual([]);
  });
  it('retirada: motivo obrigatório, até 900 caracteres', async () => {
    expect(await erros(RetireDocumentDto, { reason: '' })).toContain('reason');
    expect(await erros(RetireDocumentDto, { reason: 'a'.repeat(901) })).toContain('reason');
    expect(await erros(RetireDocumentDto, { reason: 'texto de 9 caracteres' })).toEqual([]);
  });
});

describe('NormativeDocumentsService.diffForDocument', () => {
  it('sem vigente anterior: has_previous false', async () => {
    const { client } = clienteFalso((sql) => (sql.includes('FROM normative_documents WHERE id') ? { rows: [doc()] } : { rows: [] }));
    const r = await novoService().diffForDocument(client, UUID(1));
    expect(r.has_previous).toBe(false);
    expect(r.hunks).toEqual([]);
  });
  it('com vigente: devolve o diff entre o vigente e o documento', async () => {
    const { client } = clienteFalso((sql) =>
      sql.includes("status = 'vigente'") ? { rows: [{ raw_text: 'a\nb\nc' }] } : { rows: [doc({ raw_text: 'a\nB\nc' })] },
    );
    const r = await novoService().diffForDocument(client, UUID(1));
    expect(r.has_previous).toBe(true);
    expect(r.summary).toEqual({ added: 1, removed: 1, unchanged: 2 });
  });
});

describe('NormativeDocumentsService.rejectBatch', () => {
  it('rejeita todos numa transação quando todos estão pendentes', async () => {
    const { client, consultas } = clienteFalso((sql) =>
      sql.startsWith('SELECT') ? { rows: [{ id: UUID(1), status: 'aguardando_validacao' }, { id: UUID(2), status: 'aguardando_validacao' }] } : { rows: [], rowCount: 2 },
    );
    const r = await novoService().rejectBatch(client, [UUID(1), UUID(2)], 'adm', 'ruído');
    expect(r).toEqual({ rejected: 2, ids: [UUID(1), UUID(2)] });
    const upd = consultas.find((c) => c.sql.startsWith('UPDATE'))!;
    expect(upd.sql).toContain("status = 'rejeitado'");
    expect(upd.params).toEqual([[UUID(1), UUID(2)], 'adm', 'ruído']);
  });
  it('se algum não está pendente ou não existe, não rejeita nenhum e lista os inválidos', async () => {
    const { client, consultas } = clienteFalso((sql) =>
      sql.startsWith('SELECT') ? { rows: [{ id: UUID(1), status: 'aguardando_validacao' }, { id: UUID(2), status: 'vigente' }] } : { rows: [] },
    );
    await expect(novoService().rejectBatch(client, [UUID(1), UUID(2), UUID(3)], 'adm', 'x')).rejects.toThrow(BadRequestException);
    expect(consultas.some((c) => c.sql.startsWith('UPDATE'))).toBe(false);
  });
});

describe('NormativeDocumentsService.retire', () => {
  it('só retira documento vigente', async () => {
    const { client } = clienteFalso(() => ({ rows: [doc({ status: 'aguardando_validacao' })] }));
    await expect(novoService().retire(client, UUID(1), 'adm', 'motivo')).rejects.toThrow(/vigente/);
  });
  it('vigente: vira rejeitado com prefixo Retirada, apaga os chunks e zera indexed_at', async () => {
    const { client, consultas } = clienteFalso((sql) => (sql.startsWith('SELECT') ? { rows: [doc({ status: 'vigente' })] } : { rows: [] }));
    await novoService().retire(client, UUID(1), 'adm', 'extração vazia');
    const upd = consultas.find((c) => c.sql.includes('UPDATE'))!;
    expect(upd.sql).toContain("status = 'rejeitado'");
    expect(upd.sql).toContain('indexed_at = NULL');
    expect(upd.params).toContain('Retirada: extração vazia');
    const del = consultas.find((c) => c.sql.includes('DELETE FROM normative_document_chunks'))!;
    expect(del.params).toEqual([UUID(1)]);
  });
  it('perdeu a corrida (UPDATE sem linhas): 409 e não apaga os chunks', async () => {
    const { client, consultas } = clienteFalso((sql) =>
      sql.startsWith('SELECT') ? { rows: [doc({ status: 'vigente' })] } : sql.startsWith('UPDATE') ? { rows: [], rowCount: 0 } : { rows: [] },
    );
    await expect(novoService().retire(client, UUID(1), 'adm', 'x')).rejects.toThrow(ConflictException);
    expect(consultas.some((c) => c.sql.includes('DELETE'))).toBe(false);
  });
  it('documento inexistente: 404', async () => {
    const { client } = clienteFalso(() => ({ rows: [] }));
    await expect(novoService().retire(client, UUID(9), 'adm', 'x')).rejects.toThrow(NotFoundException);
  });
});

describe('NormativeDocumentsController', () => {
  function montar() {
    const documents: any = {
      diffForDocument: jest.fn(async () => ({ has_previous: false })),
      rejectBatch: jest.fn(async () => ({ rejected: 2 })),
      retire: jest.fn(async () => ({ id: UUID(1) })),
    };
    const req: any = { user: { id: 'adm' }, withTenantContext: (fn: any) => fn({}) };
    return { controller: new NormativeDocumentsController(documents), documents, req };
  }
  it('delegam ao serviço com o usuário do token', async () => {
    const { controller, documents, req } = montar();
    await controller.diff(UUID(1), req);
    expect(documents.diffForDocument).toHaveBeenCalledWith({}, UUID(1));
    await controller.rejectBatch({ ids: [UUID(1), UUID(2)], reason: 'r' } as any, req);
    expect(documents.rejectBatch).toHaveBeenCalledWith({}, [UUID(1), UUID(2)], 'adm', 'r');
    await controller.retire(UUID(1), { reason: 'r' } as any, req);
    expect(documents.retire).toHaveBeenCalledWith({}, UUID(1), 'adm', 'r');
  });
  it('as 3 rotas novas exigem a role admin', () => {
    const reflector = new Reflector();
    for (const metodo of ['diff', 'rejectBatch', 'retire'] as const) {
      const roles = reflector.get<string[]>(ROLES_KEY, NormativeDocumentsController.prototype[metodo]);
      expect(roles).toContain('admin');
    }
  });
});

describe('ParseUUIDPipe nas rotas :id', () => {
  it('rejeita id inválido e aceita UUID', async () => {
    const pipe = new ParseUUIDPipe();
    await expect(pipe.transform('abc', { type: 'param' } as any)).rejects.toThrow(BadRequestException);
    await expect(pipe.transform(UUID(1), { type: 'param' } as any)).resolves.toBe(UUID(1));
  });
  it('as rotas diff e retire declaram o pipe no parâmetro id', () => {
    for (const metodo of ['diff', 'retire']) {
      const args = Reflect.getMetadata('__routeArguments__', NormativeDocumentsController, metodo);
      const pipes = Object.values<any>(args).flatMap((a) => a.pipes ?? []);
      expect(pipes).toContain(ParseUUIDPipe);
    }
  });
});
