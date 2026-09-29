import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tsconfig usa "jsx": "preserve" (delegado ao compilador do Next.js em dev/build).
  // O esbuild do Vite precisa de um modo explícito para o runtime de testes; sem isto,
  // ele cai no transform clássico (React.createElement) e falha com "React is not defined",
  // já que os componentes do projeto não importam React explicitamente (novo JSX transform).
  esbuild: { jsx: 'automatic' },
  test: { environment: 'jsdom', globals: true },
});
