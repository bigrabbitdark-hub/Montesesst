import { createHash } from 'crypto';
import { NormativeDocumentsService } from '../src/normative/normative-documents.service';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

type Ultimo = { id: string; status: string; content_hash: string; raw_text: string; file_key: string };

function montar(ultimo?: Ultimo) {
  const consultas: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      if (sql.includes('SELECT id, status, content_hash, raw_text, file_key')) return { rows: ultimo ? [ultimo] : [] };
      if (sql.includes('INSERT INTO normative_documents')) return { rows: [{ id: params[0], status: 'aguardando_validacao' }] };
      return { rows: [], rowCount: 1 };
    }),
  };
  const r2: any = { putObject: jest.fn(async () => undefined), deleteObject: jest.fn(async () => undefined) };
  const service = new NormativeDocumentsService(r2, {} as any);
  const gravou = (prefixo: string) => consultas.filter((c) => c.sql.trim().startsWith(prefixo));
  return { service, client, r2, gravou };
}

const URL = 'https://exemplo.gov.br/norma.htm';
const ultimo = (status: string, texto: string, id = 'doc-1'): Ultimo => ({
  id,
  status,
  content_hash: sha(texto),
  raw_text: texto,
  file_key: `normative/src-1/${id}/norma.htm`,
});

describe('recordDetectedVersion', () => {
  it('primeira versão da fonte: cria o pendente e devolve a linha', async () => {
    const { service, client, r2, gravou } = montar();
    const criado = await service.recordDetectedVersion(client, 'src-1', 'Art. 1º Texto novo.', Buffer.from('x'), 'text/html', URL);
    expect(criado).not.toBeNull();
    expect(gravou('INSERT INTO normative_documents')).toHaveLength(1);
    expect(r2.putObject).toHaveBeenCalledTimes(1);
  });

  it('mesmo texto da versão mais recente: não faz nada', async () => {
    const { service, client, r2, gravou } = montar(ultimo('vigente', 'Art. 1º Texto.'));
    const r = await service.recordDetectedVersion(client, 'src-1', 'Art. 1º Texto.', Buffer.from('x'), 'text/html', URL);
    expect(r).toBeNull();
    expect(gravou('INSERT')).toHaveLength(0);
    expect(gravou('UPDATE')).toHaveLength(0);
    expect(r2.putObject).not.toHaveBeenCalled();
  });

  it('só o rótulo "Modificado em" mudou (caso real do LTCAT): não é versão nova', async () => {
    const antes = 'Criado em 23/09/2020 14:06 Modificado em 28/08/2026 09:37 Compartilhe texto da norma';
    const depois = 'Criado em 23/09/2020 14:06 Modificado em 05/10/2026 15:17 Compartilhe texto da norma';
    const { service, client, r2, gravou } = montar(ultimo('vigente', antes));
    const r = await service.recordDetectedVersion(client, 'src-1', depois, Buffer.from('x'), 'text/html', URL);
    expect(r).toBeNull();
    expect(gravou('INSERT')).toHaveLength(0);
    expect(gravou('UPDATE')).toHaveLength(0);
    expect(r2.putObject).not.toHaveBeenCalled();
  });

  it('mudança real sobre a vigente: cria um pendente novo e devolve a linha', async () => {
    const { service, client, gravou } = montar(ultimo('vigente', 'Art. 1º O prazo é de 30 dias.'));
    const criado = await service.recordDetectedVersion(client, 'src-1', 'Art. 1º O prazo é de 60 dias.', Buffer.from('x'), 'text/html', URL);
    expect(criado).not.toBeNull();
    expect(gravou('INSERT INTO normative_documents')).toHaveLength(1);
    expect(gravou('UPDATE')).toHaveLength(0);
  });

  it('mudança real sobre uma rejeitada: cria um pendente novo', async () => {
    const { service, client, gravou } = montar(ultimo('rejeitado', 'texto antigo rejeitado'));
    const criado = await service.recordDetectedVersion(client, 'src-1', 'texto bem diferente agora', Buffer.from('x'), 'text/html', URL);
    expect(criado).not.toBeNull();
    expect(gravou('INSERT INTO normative_documents')).toHaveLength(1);
  });

  it('já existe um pendente e o texto mudou de verdade: NÃO altera nada (congelado)', async () => {
    const { service, client, r2, gravou } = montar(ultimo('aguardando_validacao', 'versão de ontem', 'doc-pend'));
    const r = await service.recordDetectedVersion(client, 'src-1', 'versão de hoje, diferente', Buffer.from('novo'), 'text/html', URL);
    expect(r).toBeNull();
    expect(gravou('INSERT')).toHaveLength(0);
    expect(gravou('UPDATE')).toHaveLength(0);
    expect(r2.putObject).not.toHaveBeenCalled();
    expect(r2.deleteObject).not.toHaveBeenCalled();
  });
  it('texto antigo colapsado vs. novo com quebras de linha (mesmas palavras): não cria pendente', async () => {
    const colapsado = 'Art. 1º Fica instituída a norma. Art. 2º Esta norma entra em vigor.';
    const comQuebras = 'Art. 1º Fica instituída a norma.\nArt. 2º Esta norma entra em vigor.';
    expect(sha(colapsado)).not.toBe(sha(comQuebras));
    const { service, client, r2, gravou } = montar(ultimo('vigente', colapsado));
    const r = await service.recordDetectedVersion(client, 'src-1', comQuebras, Buffer.from('x'), 'text/html', URL);
    expect(r).toBeNull();
    expect(gravou('INSERT')).toHaveLength(0);
    expect(gravou('UPDATE')).toHaveLength(0);
    expect(r2.putObject).not.toHaveBeenCalled();
  });
});
