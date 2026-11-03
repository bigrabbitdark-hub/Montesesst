/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // O frontend é a raiz do build; evita o Turbopack inferir a raiz do repositório (há um package-lock.json vazio lá).
  turbopack: { root: __dirname },
  // As imagens em public/ já são pré-otimizadas (redimensionadas/comprimidas)
  // antes do upload — o pipeline de otimização em runtime do next/image exige
  // o pacote `sharp` em modo standalone, que não está instalado; sem isso ele
  // falha silenciosamente a cada request. Desligar aqui evita a dependência
  // nativa extra sem perder nada, já que o trabalho de otimização já foi feito.
  images: {
    unoptimized: true,
  },
  // O dashboard antigo da empresa foi substituído pelo /dashboard-v2. `permanent: false` (307)
  // para o navegador não cachear o destino: reverter é só remover esta regra.
  async redirects() {
    return [{ source: '/empresa/dashboard', destination: '/dashboard-v2', permanent: false }];
  },
};

module.exports = nextConfig;
