# Dashboard "Início" v2 — registro de imagens

Toda imagem em `frontend/public/dashboard-v2/` deve constar aqui com origem,
autor e licença. Imagem sem linha preenchida não vai para produção.

| Arquivo | Uso | Origem | Autor | Licença | Status |
|---|---|---|---|---|---|
| `bg-menu-tecnicas.jpg` (640×480) | Cartão inferior da sidebar (só em telas com altura ≥ 1100px) | Enviada pelo proprietário em 2026-09-30 | Não informado | Uso autorizado pelo proprietário (declarado em 2026-09-30); licença de origem não documentada | EM USO — autorização declarada, sem documento |
| `bg-coluna-rh-tecnico.jpg` (750×409) | Card "Apoio técnico" no fim do dashboard | Enviada pelo proprietário em 2026-09-30 | Não informado | Uso autorizado pelo proprietário (declarado em 2026-09-30); licença de origem não documentada | EM USO — autorização declarada, sem documento |
| `bg-banner-montese.jpg` (1920×250) | Banner do topo do dashboard (Montese e o Appennino Modenese) | [Wikimedia Commons: Montese - Appennino Modenese foto 2.jpg](https://commons.wikimedia.org/wiki/File:Montese_-_Appennino_Modenese_foto_2.jpg), obra própria, 2023-09-30 | Macribo71 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | EM USO — recorte de faixa da foto original 1920×1080. Atribuição "Foto: Macribo71 · CC BY-SA 4.0" com link exibida no banner (`DashboardBanner.tsx`) e **obrigatória**. Obra derivada: deve permanecer sob CC BY-SA 4.0 |
| `logo-montese-horizontal.png` (1224×270) | Logo da sidebar | Enviado pelo proprietário em 2026-09-30 (logotipo da marca Montese SST) | Montese SST | Marca do proprietário | INSTALADO — margem branca recortada do original 2172×724 |
| `logo-montese-central.jpg` (871×690) | Versão central/vertical do logo (sem uso na Fase 1) | Enviado pelo proprietário em 2026-09-30 | Montese SST | Marca do proprietário | INSTALADO — reservado |

## Requisitos das imagens pendentes

- **Banner (histórico):** mínimo 2000 px de largura (o hero ocupa ~990 px; 2x para telas
  nítidas), proporção ~8:1 recortável a partir de foto panorâmica. A foto deve
  ser identificada pela fonte como Montese ou região; não usar paisagem
  genérica apresentada como o local.
- **Licença aceita:** domínio público, CC0, CC-BY/CC-BY-SA (com atribuição
  registrada aqui) ou licenças Unsplash/Pexels. Sem hotlink: o arquivo é
  hospedado no próprio projeto (Global Constraints da Fase 1).
- Para trocar um placeholder, basta colocar o arquivo em
  `frontend/public/dashboard-v2/` e usar `next/image` no componente
  (`DashboardHero.tsx` ainda usa `ImagePlaceholder`).
