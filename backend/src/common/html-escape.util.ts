// Escapa entidades HTML em texto de usuário antes de interpolar em corpo de
// e-mail (Tasks 2 e 4 inserem full_name/nome/mensagem digitados pelo
// visitante do site dentro de HTML) — sem isso, um campo malicioso poderia
// injetar markup no e-mail recebido.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
