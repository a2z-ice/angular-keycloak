#!/usr/bin/env bash
set -euo pipefail

# Usage: ./run.sh [--test]
#   --test    Run Playwright E2E tests after stack is up

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CERTS_DIR="$ROOT_DIR/nginx/certs"
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

echo "==> Generating SSL certificates..."
mkdir -p "$CERTS_DIR"
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "$CERTS_DIR/selfsigned.key" -out "$CERTS_DIR/selfsigned.crt" \
  -subj "/CN=myecom.net" 2>/dev/null
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "$CERTS_DIR/keycloak.key" -out "$CERTS_DIR/keycloak.crt" \
  -subj "/CN=idp.keycloak.net" 2>/dev/null
echo "    Certificates created."

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
until curl -s -o /dev/null -w '' http://localhost:8000/api/health 2>/dev/null; do sleep 1; done

echo "==> Verifying services..."
curl -sk -o /dev/null -w "    Angular:  %{http_code}\n" https://myecom.net:5500
curl -sk -o /dev/null -w "    Keycloak: %{http_code}\n" https://idp.keycloak.net:8443/realms/myecom/.well-known/openid-configuration
curl -s  -o /dev/null -w "    API:      %{http_code}\n" http://localhost:8000/api/health

echo ""
echo "Stack is running:"
echo "  Angular  -> https://myecom.net:5500"
echo "  Keycloak -> https://idp.keycloak.net:8443"
echo "  API      -> http://api.service.net:8000"
echo ""

if [ "$RUN_TESTS" = true ]; then
  echo "==> Installing E2E dependencies..."
  cd "$E2E_DIR"
  npm install --silent
  npx playwright install chromium 2>/dev/null

  echo "==> Running Playwright E2E tests..."
  rm -rf test-results
  npx playwright test
else
  echo "To run E2E tests: ./run.sh --test"
  echo "Or manually:      cd e2e && npx playwright test"
fi
