#!/bin/sh
# backend/test/fixtures/esocial/generate-test-certificate.sh
# Gera um .pfx de teste self-signed. Não é uma cadeia ICP-Brasil real — serve
# só para testar unitariamente o parsing PKCS#12 do nosso código (pkcs12.util.ts).
# Senha fixa "teste1234", usada nos testes. Rodar uma vez; o arquivo gerado é
# commitado (não contém segredo real, é só um fixture de teste).
set -e
DIR="$(dirname "$0")"
TMP_KEY=$(mktemp)
TMP_CERT=$(mktemp)
openssl req -x509 -newkey rsa:2048 -keyout "$TMP_KEY" -out "$TMP_CERT" -days 3650 -nodes \
  -subj "/CN=EMPRESA TESTE LTDA:00000000000191/O=Teste Montese"
openssl pkcs12 -export -out "$DIR/test-certificate.pfx" \
  -inkey "$TMP_KEY" -in "$TMP_CERT" -password pass:teste1234
rm -f "$TMP_KEY" "$TMP_CERT"
echo "Gerado: $DIR/test-certificate.pfx (senha: teste1234)"
