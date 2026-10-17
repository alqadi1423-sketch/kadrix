#!/usr/bin/env bash
# Prepares a GitHub Codespace to run Kadrix: writes .env with fresh secrets
# and the Codespace's own address, then builds and starts the app.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  if [ -n "${CODESPACE_NAME:-}" ]; then
    base="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  else
    base="http://localhost:3000"
  fi
  cat > .env <<ENV
AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
POSTGRES_PASSWORD=$(openssl rand -hex 16)
BASE_URL=$base
TRUST_PROXY=1
ENV
fi

# Build here so it works even before a published image can be pulled.
docker compose build
docker compose up -d
echo "Kadrix is starting at $(grep BASE_URL .env | cut -d= -f2)"
