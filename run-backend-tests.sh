#!/usr/bin/env bash
set -euo pipefail
set -a
source /opt/Montese/.env
set +a
export DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@localhost:5432/${POSTGRES_DB}"
export TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@localhost:5432/${POSTGRES_DB}"
export REDIS_URL="redis://:${REDIS_PASSWORD}@localhost:6379"
export JWT_SECRET JWT_EXPIRES_IN
export NODE_ENV=test
export AUTH_RATE_LIMIT_MAX="${AUTH_RATE_LIMIT_MAX:-10}"
export AUTH_RATE_LIMIT_WINDOW_SECONDS="${AUTH_RATE_LIMIT_WINDOW_SECONDS:-900}"
export PATH="/root/.nvm/versions/node/v20.20.2/bin:$PATH"
export NODE_OPTIONS=--experimental-vm-modules
cd /opt/Montese/backend
npm run "$@"
