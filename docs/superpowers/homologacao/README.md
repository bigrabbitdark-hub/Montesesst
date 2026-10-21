# Ambiente de homologação do Painel de Atuação (descartável)

- `HOM_DIR=<pasta fora do repositório> ./hom-up.sh` — cria o banco `montese_hom`, aplica as migrations, semeia dados FICTÍCIOS e sobe `socio_hom_{s3,nginx,backend,frontend}` na rede `socio_ensaio` (sem publicar porta; produção intocada; nenhum `.env` lido).
- `./hom-run.sh <jornada.mjs>` — roda uma jornada Playwright (Chromium do host) contra `http://<ip do nginx de teste>`.
- `./hom-sql.sh "SELECT ..."` — consulta somente leitura ao `montese_hom`.
- `./hom-down.sh` — remove os containers e o banco `montese_hom`.
- Segredos de teste (aleatórios) ficam em `$HOM_DIR/hom.env` (600), fora do repositório. Contas: `admin.hom`, `socio.a.hom`, `socio.b.hom`, `empresa.hom`, `tecnico.hom` (`@teste.invalid`).
- Dados: clientes Montese A (em dia) e B (pendência), empresa de parceiro (fora da carteira), matriz de TESTE só para `pgr` (A elabora/revisa; B revisa/aprova/assina/publica), registros profissionais FICTÍCIOS (`TESTE/0001`, `TESTE/0002`).
- Limitações: `NODE_ENV=development` (validação de ambiente de produção não exercida); sem TLS; sem R2 real (stub em memória); sem Mercado Pago/e-mail/IA reais.
