#!/bin/sh
set -e
cd "$(dirname "$0")/.."

docker run --rm \
  -v "$(pwd)/nginx/certbot-webroot:/var/www/certbot" \
  -v "$(pwd)/nginx/letsencrypt:/etc/letsencrypt" \
  certbot/certbot renew --webroot -w /var/www/certbot --quiet

docker exec montese_nginx nginx -s reload
