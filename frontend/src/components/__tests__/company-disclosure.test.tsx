import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardFooter } from '../DashboardFooter';
import { PaymentIssuerNote } from '../PaymentIssuerNote';
import { SiteFooter } from '../SiteFooter';
import { AdminFooter } from '../admin/AdminFooter';
import { fillCompanyTokens, formatIdentification } from '@/lib/company';

describe('institutional CNPJ disclosure', () => {
  it('omits an unconfigured CNPJ from site, dashboard, admin, and payment surfaces', () => {
    render(
      <>
        <SiteFooter />
        <DashboardFooter />
        <AdminFooter />
        <PaymentIssuerNote />
      </>,
    );

    expect(screen.queryByText(/CNPJ/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b(?:undefined|null)\b/i);
    expect(screen.getByRole('link', { name: 'Política de Privacidade' })).toHaveAttribute('href', '/privacidade');
    expect(screen.getByRole('link', { name: 'Termos de Uso' })).toHaveAttribute('href', '/termos');
    expect(screen.getByRole('link', { name: 'contato@montesesst.com.br' })).toBeInTheDocument();
    expect(screen.getByText('montesesst.com.br')).toBeInTheDocument();
  });

  it('omits the CNPJ clause from the legal identity until one is configured', () => {
    expect(formatIdentification()).not.toContain('CNPJ');
    expect(fillCompanyTokens('Responsável: [[EMPRESA_IDENTIFICACAO]]')).not.toContain('CNPJ');
  });
});
