// Escapa texto e atributos para o XML do evento. Os XSD do eSocial só usam strings simples, mas o
// nome do trabalhador/médico vem de cadastro livre: sem escapar, "&" ou "<" quebraria o XML (ou
// permitiria injetar elementos no evento antes de assinar).
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
