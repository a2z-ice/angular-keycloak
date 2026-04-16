#!/usr/bin/env bash
set -euo pipefail

# Usage: ./run.sh [--test]
#   --test    Run Playwright E2E tests after stack is up

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CERTS_DIR="$ROOT_DIR/certs"
NGINX_CERTS="$ROOT_DIR/nginx/certs"
E2E_DIR="$ROOT_DIR/e2e"
RUN_TESTS=false

for arg in "$@"; do
  case "$arg" in
    --test) RUN_TESTS=true ;;
    *) echo "Usage: $0 [--test]"; exit 1 ;;
  esac
done

cd "$ROOT_DIR"

echo "==> Tearing down existing stack..."
docker compose down -v 2>/dev/null || true

# ── Generate certs if CA doesn't exist ────────────────────────────
if [ ! -f "$CERTS_DIR/ca.crt" ]; then
  echo "==> Generating CA-signed SSL certificates..."
  "$CERTS_DIR/generate.sh"
else
  echo "==> Certificates already exist (reusing)."
fi

# Copy certs to nginx mount directory
mkdir -p "$NGINX_CERTS"
cp "$CERTS_DIR/selfsigned.crt" "$CERTS_DIR/selfsigned.key" \
   "$CERTS_DIR/keycloak.crt" "$CERTS_DIR/keycloak.key" "$NGINX_CERTS/"

echo "==> Building Docker images..."
docker compose build --no-cache

echo "==> Starting stack..."
docker compose up -d

echo "==> Waiting for Keycloak to become healthy..."
until docker inspect --format='{{.State.Health.Status}}' keycloak 2>/dev/null | grep -q "healthy"; do
  sleep 2
done
echo "    Keycloak is healthy."

echo "==> Waiting for all services to be ready..."
until curl -sk -o /dev/null -w '' https://myecom.net:5500 2>/dev/null; do sleep 1; done
until curl -sk -o /dev/null -w '' https://idp.keycloak.net:8443/realms/myecom 2>/dev/null; do sleep 1; done
until curl -sk -o /dev/null -w '' https://myecom.net:5500/api/health 2>/dev/null; do sleep 1; done

echo "==> Verifying services..."
curl -sk -o /dev/null -w "    Angular:  %{http_code}\n" https://myecom.net:5500
curl -sk -o /dev/null -w "    Keycloak: %{http_code}\n" https://idp.keycloak.net:8443/realms/myecom/.well-known/openid-configuration
curl -sk -o /dev/null -w "    API:      %{http_code}\n" https://myecom.net:5500/api/health

echo ""
echo "Stack is running:"
echo "  Angular  -> https://myecom.net:5500"
echo "  Keycloak -> https://idp.keycloak.net:8443"
echo "  API      -> https://myecom.net:5500/api"
echo ""

if [ "$RUN_TESTS" = true ]; then
  echo "==> Installing E2E dependencies..."
  cd "$E2E_DIR"
  npm install --silent
  npx playwright install chromium firefox webkit 2>/dev/null

  echo "==> Running Playwright E2E tests..."
  rm -rf test-results
  npx playwright test
else
  echo "To run E2E tests: ./run.sh --test"
  echo "Or manually:      cd e2e && npx playwright test"
fi
