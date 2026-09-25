/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // As imagens em public/ já são pré-otimizadas (redimensionadas/comprimidas)
  // antes do upload — o pipeline de otimização em runtime do next/image exige
  // o pacote `sharp` em modo standalone, que não está instalado; sem isso ele
  // falha silenciosamente a cada request. Desligar aqui evita a dependência
  // nativa extra sem perder nada, já que o trabalho de otimização já foi feito.
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
