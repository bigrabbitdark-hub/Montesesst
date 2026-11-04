// Regressão: CNPJ e WhatsApp antigos NÃO podem reaparecer nas superfícies públicas.
// Renderiza os componentes reais (não procura string em código-fonte) e confere o HTML gerado.
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { company, formatIdentification, whatsappUrl } from '@/lib/company';
import { SiteFooter } from '@/components/SiteFooter';
import { DashboardFooter } from '@/components/DashboardFooter';
import { WhatsAppButton } from '@/components/WhatsAppButton';
import ContatoPage from '@/app/(site)/contato/page';

const CNPJ_ANTIGO = /69[.\s]?203[.\s]?754[\/\s]?0001[-\s]?45|69203754000145/;
const FONE_ANTIGO = /5548\s?9?2003\s?1245|\(?48\)?[\s-]*9[\s.-]?2003[\s.-]?1245|92003-?1245/;
const FONE_NOVO_URL = 'https://wa.me/5548992050516';

function hrefsWhatsApp(html: string): string[] {
  return [...html.matchAll(/href="(https:\/\/wa\.me\/[^"]+)"/g)].map((m) => m[1]);
}

describe('dados institucionais — fonte única', () => {
  it('company.ts expõe o WhatsApp oficial e nenhum CNPJ', () => {
    expect(company.whatsapp.numero).toBe('5548992050516');
    expect(company.whatsapp.exibicao).toBe('+55 48 99205-0516');
    expect(whatsappUrl()).toBe(FONE_NOVO_URL);
    expect(company.cnpj).toBe('');
    expect(formatIdentification()).not.toMatch(/CNPJ/);
    expect(formatIdentification()).not.toMatch(CNPJ_ANTIGO);
  });

  const superficies: Array<[string, () => JSX.Element]> = [
    ['rodapé do site', () => <SiteFooter />],
    ['rodapé do dashboard', () => <DashboardFooter />],
    ['botão flutuante', () => <WhatsAppButton />],
    ['página /contato', () => <ContatoPage />],
  ];

  it.each(superficies)('%s: só o telefone novo, sem CNPJ nem telefone antigo', (_nome, ui) => {
    const { container } = render(ui());
    const html = container.innerHTML;
    expect(html).not.toMatch(CNPJ_ANTIGO);
    expect(html).not.toMatch(FONE_ANTIGO);
    expect(html).not.toMatch(/CNPJ/); // sem CNPJ vazio pendurado ("CNPJ ·")
    const links = hrefsWhatsApp(html);
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toBe(FONE_NOVO_URL);
  });

  it('o rodapé do site mostra o número novo formatado', () => {
    const { container } = render(<SiteFooter />);
    expect(container.textContent).toContain('+55 48 99205-0516');
  });
});
