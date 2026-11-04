# Plano de release — chamada de diagnóstico + carrossel de banners na home (2026-11-04)

Estado: **EM PRODUÇÃO desde 2026-11-04 (~13:52 UTC).** Código commitado localmente na branch `feat/home-diagnostico-carrossel` (`26b60d3`), **sem push ao GitHub**. Só frontend; sem migration, sem mudança de backend, banco ou Nginx.

## Execução do release (autorizado pelo proprietário)
- Tag de rollback da imagem anterior: `montese-frontend:pre-home-carrossel-20261104` (`6ba629def179`, igual a `cnpj-fix2-20261104`).
- Imagem construída da branch: `montese-frontend:candidate-home-carrossel-20261104` (`0ec7abc828be`), depois marcada como `latest`.
- Teste de fumaça em contêiner descartável (porta local): home 200, carrossel e faixa presentes, `/banners/*.webp` 200. `/_next/image` dá 404 por desenho: `images.unoptimized` em `next.config.js`.
- Troca: `docker compose up -d --no-deps frontend` (sem override, sem `compose config`). Só `montese_frontend` foi recriado; backend, banco, Redis e Nginx intocados.
- Verificação pelo Nginx (https://www.montesesst.com.br): `/`, `/login`, `/cadastro` 200; banner 200 (141.794 bytes); HTML traz carrossel, faixa, `wa.me/5548992050516?text=…` e `mailto:eng.evelynsouza@…`. Logs do contêiner sem erro.
- Aviso do Compose (preexistente, fora desta mudança): `AI_CONFIG_ENCRYPTION_KEY` não definida.

## O que muda para o visitante
- Faixa "Diagnóstico gratuito para empresas" logo abaixo do hero, com botões de WhatsApp e e-mail.
- Carrossel de 2 banners abaixo da seção "Conheça nossa história" (diagnóstico gratuito e diagnóstico tributário), com links sobre os botões da arte, pausa, setas, indicadores, deslizar no celular e botões reais no mobile.
- Legenda sob o banner tributário: o diagnóstico parte do cruzamento de documentos e a redução legal de custos depende de a documentação estar em ordem.

## Arquivos
`frontend/src/app/(site)/page.tsx`, `frontend/src/lib/company.ts` (e-mail do diagnóstico, `whatsappUrl(mensagem?)`, `diagnosticoMailtoUrl()`), `frontend/src/components/DiagnosticoHero.tsx`, `frontend/src/components/BannerCarousel.tsx`, `frontend/public/banners/*.webp` (2 imagens, ~140 e ~165 KB) e testes.

## Evidência (VERIFICADO)
- Suíte do frontend: 50 arquivos, 603 testes passando. `tsc --noEmit` ok. `next build` ok e trava `check-dados-descontinuados` ok.
- Lint: 10 problemas (7 erros, 3 avisos), os mesmos sem esta mudança; nenhum nos arquivos novos.
- Navegador (Chromium, `next start` local): sem rolagem horizontal em 1366 e 390 px; links sobre os botões acertam o alvo; slide 2 e mobile conferidos visualmente.

## NÃO verificado
- Execução na imagem Alpine de produção (testei em `next start` no host).
- Clique real nos dois destinos (mailto e wa.me) e gesto de deslizar com toque real.
- Slide 1 no mobile após a última mudança; 320 px.
- Contraste medido por ferramenta (só por leitura visual).
- Texto pequeno dos banners no celular: precisa de arte vertical/4:5 (pendência de design).

## Decisões do proprietário antes do deploy
1. Confirmar o conteúdo do banner tributário (promete "oportunidades tributárias" e "redução de custos"; a legenda condiciona a documentação em ordem). Validar juridicamente o que a Montese pode afirmar.
2. Telefone e e-mail exibidos nos banners: (48) 99205-0516 e eng.evelynsouza@montesesst.com.br (informados por você).
3. ~~Autorizar build da imagem candidata e o deploy do frontend.~~ Autorizado e executado em 2026-11-04. **Pendente:** validação jurídica do banner tributário, já público.

## Passos planejados (executados; ver acima)
1. Backup preventivo não é necessário para o frontend, mas manter a imagem atual com tag: `montese-frontend:latest` = `6ba629def179` (já também tag `cnpj-fix2-20261104`).
2. Construir a candidata a partir da branch: `docker build -t montese-frontend:candidate-home-carrossel-20261104 ./frontend` (o Dockerfile roda `npm install` + `npm run build`).
3. Subir a candidata só no serviço `frontend`, **sem** `docker compose config` e **sem** override presente (hoje não existe `docker-compose.override.yml`). Antes de qualquer `compose up`, conferir que não há override.
4. Verificar na produção: home carrega, banners aparecem (imagens em `/banners/`), `mailto:` e `wa.me` abrem, rodapé e CNPJ/WhatsApp corretos, `/cadastro` e `/login` intactos.
5. Rollback: `docker tag montese-frontend:pre-home-carrossel-20261104 montese-frontend:latest` e `docker compose up -d --no-deps frontend`. Sem migration envolvida.

## Observação de linhagem (INFERIDO)
A branch parte de `84e8011` (correção de CNPJ/WhatsApp antigos, com trava de build), igual à base da imagem em produção `cnpj-fix2-20261104`; o diff é apenas esta feature. Conferir `git diff 84e8011..HEAD --stat` antes de construir.
