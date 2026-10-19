import { describe, it, expect, vi } from 'vitest';

const redirect = vi.fn<(to: string) => never>(() => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));

import EmpresaEpisRedirect from '../epis/page';

describe('/empresa/epis (rota antiga)', () => {
  it('redireciona para o novo módulo /empresa/epi', () => {
    expect(() => EmpresaEpisRedirect()).toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/empresa/epi');
  });
});
