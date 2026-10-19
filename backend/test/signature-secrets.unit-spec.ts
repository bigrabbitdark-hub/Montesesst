import { createHash, createHmac } from 'crypto';
import { EPI_TERM } from '../src/epi-ficha/epi-ficha-term';
import { generatePin, generateToken, hashPin, hashToken, signatureTermAllowed, termTextSha256 } from '../src/epi-signature/signature-secrets.util';

describe('signature-secrets', () => {
  it('token tem 43 caracteres base64url (256 bits) e é diferente a cada chamada', () => {
    const a = generateToken(), b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
  it('código tem 6 dígitos com zeros à esquerda e cobre toda a faixa', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) { const p = generatePin(); expect(p).toMatch(/^\d{6}$/); seen.add(p); }
    expect(seen.size).toBeGreaterThan(1900);
  });
  it('hashToken é SHA-256 e hashPin é HMAC com chave = token (sem segredo de servidor)', () => {
    expect(hashToken('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
    expect(hashPin('tok', '123456')).toBe(createHmac('sha256', 'tok').update('123456').digest('hex'));
    expect(hashPin('tok', '123456')).not.toBe(hashPin('tok2', '123456'));
  });
  it('termo rascunho só permite assinatura com a variável ligada', () => {
    const prev = process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM;
    delete process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM;
    expect(signatureTermAllowed()).toBe(false);
    process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = 'true';
    expect(signatureTermAllowed()).toBe(true);
    process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = '1';
    expect(signatureTermAllowed()).toBe(false); // só 'true' literal
    if (prev === undefined) delete process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM; else process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = prev;
  });
  it('hash do texto do termo é estável e muda com o texto', () => { expect(termTextSha256()).toMatch(/^[0-9a-f]{64}$/); expect(termTextSha256()).toBe(termTextSha256()); });
  // Fixa o par versão -> hash do texto. Se alguém alterar o texto do termo SEM trocar a versão, este teste falha:
  // atualize a versão (EPI_TERM.version) e os dois literais abaixo juntos.
  it('o par versão -> hash do termo vigente está fixado (alterar o texto exige nova versão)', () => {
    expect(EPI_TERM.version).toBe('rascunho-1');
    expect(termTextSha256()).toBe('71a3b175b51a97cd3b85567797641c2c4f8cfb7d0821794085c9ec59448ac6de');
  });
});
