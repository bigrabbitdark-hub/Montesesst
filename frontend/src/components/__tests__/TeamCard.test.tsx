import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TeamCard } from '../TeamCard';
import type { TeamMember } from '@/lib/team';

const base: TeamMember = {
  id: 'x',
  name: null,
  role: 'Técnico de Segurança do Trabalho',
  paraOCliente: 'Acompanha a carteira de empresas.',
  photo: null,
  linkedin: null,
  registro: null,
  experiencia: null,
  cidade: null,
  frasePessoal: null,
};

describe('TeamCard', () => {
  it('sem dados pessoais: não mostra registro, experiência, cidade nem frase', () => {
    render(<ul><TeamCard member={base} /></ul>);
    expect(screen.getByText('Acompanha a carteira de empresas.')).toBeInTheDocument();
    expect(screen.queryByText(/registro/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/“/)).not.toBeInTheDocument();
  });

  it('com dados preenchidos: mostra registro, experiência, cidade e frase', () => {
    render(
      <ul>
        <TeamCard
          member={{
            ...base,
            name: 'Fulana',
            registro: 'Registro ativo',
            experiencia: '5 anos na construção civil',
            cidade: 'Tubarão',
            frasePessoal: 'Prevenir é cuidar.',
          }}
        />
      </ul>,
    );
    expect(screen.getByText('Registro ativo · 5 anos na construção civil · Tubarão')).toBeInTheDocument();
    expect(screen.getByText('“Prevenir é cuidar.”')).toBeInTheDocument();
  });
});
