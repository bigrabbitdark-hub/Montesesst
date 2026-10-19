import { redirect } from 'next/navigation';

// A tela antiga de EPIs foi substituída pelo módulo em /empresa/epi (painel, cadastro, movimentação e fichas).
// Mantém links e favoritos antigos funcionando.
export default function EmpresaEpisRedirect() {
  redirect('/empresa/epi');
}
