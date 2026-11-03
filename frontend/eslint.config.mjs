import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const config = [
  ...coreWebVitals,
  ...typescript,
  {
    // Regra nova do React 19 / eslint-plugin-react-hooks 7. A linha base (Next 14) não a tinha.
    // Mantida como aviso até as telas logadas serem verificadas; depois, migrar efeito a efeito.
    rules: { 'react-hooks/set-state-in-effect': 'warn' },
  },
  { ignores: ['.next/**', 'node_modules/**'] },
];

export default config;
