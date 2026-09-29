export const ASSET_PATHS = {
  logo: '/dashboard-v2/logo-montese-horizontal.png',
  bannerHero: '/dashboard-v2/bg-banner-montese.jpg',
  sidebarFooter: '/dashboard-v2/bg-menu-tecnicas.jpg',
  columnFooter: '/dashboard-v2/bg-coluna-rh-tecnico.jpg',
} as const;

// Achado da Fase 0 (2026-09-29): nenhum destes arquivos existe em
// /opt/Montese/frontend/public/dashboard-v2/ ainda — a especificação só
// chegou como texto. ImagePlaceholder (ver componente ao lado) renderiza um
// retângulo com o nome do arquivo até os arquivos reais serem adicionados
// nesse caminho.
export const ASSETS_ARE_PLACEHOLDERS = true;
