import { readFileSync } from 'fs';
import { join } from 'path';

describe('esocial_layout_versions migration', () => {
  it('contém a URL de Produção Restrita verificada e nenhuma URL de Produção hardcoded como fato', () => {
    const sql = readFileSync(
      join(__dirname, '../db/migrations/0065_esocial_layout_versions.sql'),
      'utf8',
    );
    expect(sql).toContain('webservices.producaorestrita.esocial.gov.br');
    expect(sql).toContain("'S-1.3'");
    // Garante que ninguém adicionou uma URL de produção real sem atualizar este teste
    // e o comentário de verificação junto dela.
    expect(sql).not.toMatch(/producao_envio_url,\s*producao_consulta_url\s*\)\s*VALUES/i);
  });
});
