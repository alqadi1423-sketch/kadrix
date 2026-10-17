#!/usr/bin/env bash
# Prepares a GitHub Codespace to run Kadrix: keeps .env with fresh secrets
# and this Codespace's own address (checked again on every start, since
# the app refuses requests from any other address), then starts the app.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "${CODESPACE_NAME:-}" ]; then
  base="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
else
  base="http://localhost:3000"
fi

if [ ! -f .env ]; then
  cat > .env <<ENV
AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
POSTGRES_PASSWORD=$(openssl rand -hex 16)
TRUST_PROXY=1
ENV
fi
grep -v '^BASE_URL=\|^TRUSTED_ORIGINS=' .env > .env.tmp || true
echo "BASE_URL=$base" >> .env.tmp
# Codespaces rewrites the browser's Origin header to localhost, so accept it.
echo "TRUSTED_ORIGINS=https://localhost:3000,http://localhost:3000" >> .env.tmp
mv .env.tmp .env

# Build here so it works even before a published image can be pulled.
docker compose build
docker compose up -d
echo "Kadrix is starting at $base"
