#!/usr/bin/env bash
set -euo pipefail

# Usage: ./deploy-k8s.sh [--test]
#   --test    Run Playwright E2E tests after deployment

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
CERTS_DIR="$ROOT_DIR/certs"
NGINX_CERTS="$ROOT_DIR/nginx/certs"
E2E_DIR="$ROOT_DIR/e2e"
CLUSTER_NAME="k8s-angular"
RUN_TESTS=false

for arg in "$@"; do
  case "$arg" in
    --test) RUN_TESTS=true ;;
    *) echo "Usage: $0 [--test]"; exit 1 ;;
  esac
done

cd "$ROOT_DIR"

# ── 1. Clean up ──────────────────────────────────────────────────
echo "==> Deleting existing Kind cluster (if any)..."
kind delete cluster --name "$CLUSTER_NAME" 2>/dev/null || true

# Stop docker compose stack if running (free ports)
docker compose down -v 2>/dev/null || true

# ── 2. Generate certs if CA doesn't exist ────────────────────────
if [ ! -f "$CERTS_DIR/ca.crt" ]; then
  echo "==> Generating CA-signed SSL certificates..."
  "$CERTS_DIR/generate.sh"
else
  echo "==> Certificates already exist (reusing)."
fi

mkdir -p "$NGINX_CERTS"
cp "$CERTS_DIR/selfsigned.crt" "$CERTS_DIR/selfsigned.key" \
   "$CERTS_DIR/keycloak.crt" "$CERTS_DIR/keycloak.key" "$NGINX_CERTS/"

# ── 3. Build Docker images ───────────────────────────────────────
echo "==> Building Docker images..."
docker build -t myecom-angular:latest -f Dockerfile . --quiet
docker build -t myecom-api:latest -f api/Dockerfile api --quiet
echo "    Images built."

# ── 4. Create Kind cluster ───────────────────────────────────────
echo "==> Creating Kind cluster '$CLUSTER_NAME'..."
kind create cluster --config k8s/kind-config.yaml --wait 60s

# ── 5. Load images into Kind ─────────────────────────────────────
echo "==> Loading images into Kind..."
kind load docker-image myecom-angular:latest --name "$CLUSTER_NAME"
kind load docker-image myecom-api:latest --name "$CLUSTER_NAME"
echo "    Images loaded."

# ── 6. Create TLS secret ─────────────────────────────────────────
echo "==> Creating TLS secrets..."
kubectl create secret generic tls-certs \
  --from-file=selfsigned.crt="$NGINX_CERTS/selfsigned.crt" \
  --from-file=selfsigned.key="$NGINX_CERTS/selfsigned.key" \
  --from-file=keycloak.crt="$NGINX_CERTS/keycloak.crt" \
  --from-file=keycloak.key="$NGINX_CERTS/keycloak.key"

# ── 7. Deploy manifests ──────────────────────────────────────────
echo "==> Deploying Keycloak..."
kubectl apply -f k8s/keycloak.yaml

echo "==> Waiting for Keycloak to be ready..."
kubectl rollout status deployment/keycloak --timeout=180s

echo "==> Deploying API..."
kubectl apply -f k8s/api.yaml
kubectl rollout status deployment/api --timeout=60s

echo "==> Deploying Nginx (Angular + Keycloak proxy)..."
kubectl apply -f k8s/nginx.yaml
kubectl rollout status deployment/nginx --timeout=60s

# ── 8. Wait for services ─────────────────────────────────────────
echo "==> Waiting for all services to be ready..."
until curl -sk -o /dev/null -w '' https://myecom.net:5500 2>/dev/null; do sleep 2; done
until curl -sk -o /dev/null -w '' https://idp.keycloak.net:8443/realms/myecom 2>/dev/null; do sleep 2; done
until curl -sk -o /dev/null -w '' https://myecom.net:5500/api/health 2>/dev/null; do sleep 2; done

# ── 9. Verify ─────────────────────────────────────────────────────
echo "==> Verifying services..."
curl -sk -o /dev/null -w "    Angular:  %{http_code}\n" https://myecom.net:5500
curl -sk -o /dev/null -w "    Keycloak: %{http_code}\n" https://idp.keycloak.net:8443/realms/myecom/.well-known/openid-configuration
curl -sk -o /dev/null -w "    API:      %{http_code}\n" https://myecom.net:5500/api/health

echo ""
echo "K8s cluster '$CLUSTER_NAME' is running:"
echo "  Angular  -> https://myecom.net:5500"
echo "  Keycloak -> https://idp.keycloak.net:8443"
echo "  API      -> https://myecom.net:5500/api"
echo ""
kubectl get pods -o wide
echo ""

# ── 10. E2E tests (optional) ─────────────────────────────────────
if [ "$RUN_TESTS" = true ]; then
  echo "==> Installing E2E dependencies..."
  cd "$E2E_DIR"
  npm install --silent
  npx playwright install chromium firefox webkit 2>/dev/null

  echo "==> Running Playwright E2E tests..."
  rm -rf test-results
  npx playwright test
else
  echo "To run E2E tests: ./deploy-k8s.sh --test"
  echo "To delete cluster: kind delete cluster --name $CLUSTER_NAME"
fi
