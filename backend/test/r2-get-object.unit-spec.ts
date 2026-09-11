import { R2Service } from '../src/common/r2/r2.service';

// Testa contra o R2 real (mesmo bucket já usado pelos outros testes de
// upload/download deste projeto) — sobe um objeto de teste com
// putObject (já existente e testado), lê de volta com getObject, e
// confirma que o conteúdo bate byte a byte. Apaga o objeto de teste no
// final.
describe('R2Service.getObject', () => {
  const r2 = new R2Service();
  const testKey = `test/r2-get-object-${Date.now()}.txt`;
  const testContent = Buffer.from('conteúdo de teste pra getObject');

  afterAll(async () => {
    await r2.deleteObject(testKey);
  });

  it('devolve o mesmo conteúdo que foi enviado via putObject', async () => {
    await r2.putObject(testKey, testContent, 'text/plain');
    const result = await r2.getObject(testKey);
    expect(result.equals(testContent)).toBe(true);
  });
});
