# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Três papéis principais, hoje reais no schema e no produto:
- **Empresa (cliente):** RH/gestão de uma empresa com CNPJ e funcionários CLT, responsável por manter a conformidade de SST em dia.
- **Técnico responsável:** profissional de SST em atuação remota, atende uma carteira de empresas.
- **Técnico parceiro:** profissional de SST em atuação presencial (visitas, inspeções em campo).
- **Admin:** operação interna da Montese — painel `/admin` (Fase 7) já construído: gestão de empresas, técnicos e parceiros, financeiro (Mercado Pago), auditoria, base normativa, checklist SST e Visão Geral operacional (status da VPS, alertas, uso de IA); visual "Montese Control" em tema escuro.

## Product Purpose

Montese SST é uma plataforma SaaS de gestão de Saúde e Segurança do Trabalho para o mercado brasileiro (foco inicial: região Sul de Santa Catarina). Substitui um processo hoje fragmentado entre e-mail, PDFs soltos e planilhas por um sistema único que conecta empresa cliente, técnico responsável e rede de técnicos parceiros, com histórico e rastreabilidade completos. Sucesso = dezenas de empresas na região Sul de SC no ano 1, com solidez e confiabilidade auditável antes de velocidade.

## Positioning

"Tecnologia que organiza. Gestão que protege." — o diferencial não é a tecnologia isolada, é o atendimento humano combinado com uma rede de técnicos parceiros reais, apoiada por uma plataforma que centraliza conformidade (score, documentos, vencimentos) em tempo real. Funcionalidades que escondem quem fez o quê entre empresa e técnico vão contra o diferencial central.

## Operating Context

Fluxos reais já em produção (confirmado em `docs/roadmap.md`, commits recentes): cadastro de empresa com confirmação por e-mail; cadastro e planos de técnico com assinatura recorrente via Mercado Pago (Checkout Pro); onboarding (dados da empresa, filiais/`company_units`, funcionários manual ou CSV); documentos (upload/download via Cloudflare R2, com conformidade calculada); score de SST e pendências; agenda de vencimentos (inclui validade de CA de EPI); dashboard do técnico (carteira de empresas vinculadas); inspeções em campo com checklist e geração automática de planos de ação; acesso do técnico parceiro (mesmas áreas do técnico responsável, RLS estendida); catálogo de EPI (93 itens do Anexo I da NR-06) com registro de entrega a funcionário, no painel da empresa e do técnico.

Ainda **não construído** (roadmap, não produto hoje): Copiloto/Agente de IA (Fase 8) — nenhuma chamada de IA existe no backend hoje. "Universidade Montese" (cursos EAD) também não tem conteúdo definido: página `/cursos` atual é uma lista de espera ("cursos a definir"), sem trilhas, sem certificação automatizada. Não há integração automatizada de envio ao eSocial — a plataforma acompanha fontes oficiais (NRs, eSocial, INSS, Diário Oficial) como informação, não como automação de submissão.

## Capabilities and Constraints

- Multi-tenant com Row-Level Security em toda tabela desde o dia 1 (não negociável).
- Documentos nunca ficam no disco da VPS — sempre Cloudflare R2 (S3-compatible).
- Postgres/Redis nunca expostos publicamente; um serviço por container Docker.
- Sem IA local em produção — hoje sem IA em produção alguma (Fase 8 não iniciada).
- **Princípio não-negociável de comunicação:** nunca apresentar mock/roadmap como funcional. Qualquer funcionalidade ainda não construída (IA, Universidade Montese, Admin) precisa ser rotulada como tal (ex.: "em construção") em qualquer superfície pública, inclusive marketing.
- Planos reais e ativos hoje (`plans`, preços atualizados em 2026-08-24): Essencial/Start R$397, Profissional/Premium R$797 (recomendado), Enterprise/Super Premium R$1297, todos "por mês, até um limite de funcionários"; um 4º tier `empresa-enterprise`-like de "valores a combinar" existe para redes/multi-filiais sob consulta. Plano do técnico: 1 tier ("Start Técnico"). Nenhum gate de funcionalidade por plano ainda.
- Contato real: e-mail `contato@montesesst.com.br`, WhatsApp `+55 48 92003-1245`. Dados cadastrais fornecidos pelo fundador em 2026-09-21: CNPJ 69.203.754/0001-45 e endereço comercial Avenida Marcolino Martins Cabral, nº 2644, Bairro Aeroporto, Tubarão/SC, CEP 88705-004 (fonte única: `frontend/src/lib/company.ts`). CNPJ só em rodapés e telas de pagamento; endereço só nos documentos legais. Razão social ainda não informada. Não inventar outro telefone, endereço ou razão social.

## Brand Commitments

- Nome: **Montese** — inspirado na comuna italiana onde a Força Expedicionária Brasileira lutou a Batalha de Montese (abril de 1945); símbolo combina montanha (solidez/elevação) com capacete + escudo (proteção). Ver seção "Quem somos" já escrita na home — não reescrever a história, é conteúdo factual confirmado pelo fundador.
- Tagline principal: "Tecnologia que organiza. Gestão que protege." Tagline alternativa usada no hero: "Chegue no topo com segurança."
- Paleta: tons de verde (escuro a menta) com branco neutro — já implementada em `frontend/src/app/globals.css` (`--color-brand-*`), aproximação confirmada até chegar arquivo-fonte de identidade visual exato.
- Tipografia: Poppins.
- Painel admin ("Montese Control"): tema escuro marinho + verde da marca, escopado a `/admin` — exceção intencional ao tema claro do resto do produto (decisão do fundador em 2026-09-21).
- Logo real já versionado em `frontend/public/brand/` (`logo-horizontal.jpg`, `logo-icon.jpg`) — não é mais placeholder de texto.
- Fotografia real já versionada em `frontend/public/photos/`: `mountain-hero.jpg` (Alpes, alta qualidade), `trabalhador-epi.jpg` (canteiro de obra real, alta qualidade). `tecnico-tablet.jpg` é um recorte de banco de imagens de baixa qualidade (fundo amarelo chapado, sem ambientação) — não representa o padrão de qualidade da marca e é candidato a substituição.

## Evidence on Hand

- `docs/vision.md`, `docs/roadmap.md` e specs em `docs/specs/*`/`docs/plans/*` documentam decisões e status fase a fase — fonte de verdade sobre o que é real vs. roadmap.
- `frontend/public/referencia/montese-site.png`: mockup visual de referência fornecido pelo fundador (idêntico à imagem colada no pedido) — estrutura e estilo alvo para o redesign da home, mas contém seções (IA 24h, Universidade SST com cursos "Disponível", eSocial automatizado, painel "SST Pro" com CRM/Financeiro) que retratam como prontas funcionalidades que hoje são roadmap ou não existem — essas seções devem ser adaptadas para refletir o estado real do produto, preservando o nível visual e estrutural do mockup.
- Nenhum testemunho, cliente citado publicamente ou benchmark deve ser inventado — não há caso de cliente real disponível ainda (produto pré-escala, dezenas de empresas é a meta do ano 1).

## Product Principles

1. Tecnologia organiza, gente protege — nenhuma seção de produto pode implicar que automação substitui o técnico responsável ou a rede de parceiros.
2. Nunca apresentar roadmap como funcionalidade pronta — rótulo explícito ("em construção"/"em breve") em qualquer capacidade ainda não construída, mesmo sob pressão de ficar visualmente "mais completo".
3. Solidez antes de velocidade — precisão e conformidade (LGPD, RLS, auditoria) não são negociáveis por polish visual.
4. Conteúdo institucional é regional e factual (Sul de SC, qualquer CNPJ com CLT) — não inflar escala ou alcance geográfico ainda não alcançados.

## Accessibility & Inclusion

Nenhum requisito específico de acessibilidade foi confirmado além de boas práticas padrão (contraste, semântica, navegação por teclado) — aplicar como piso de qualidade, não como decisão de produto documentada.
