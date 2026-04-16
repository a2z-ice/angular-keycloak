#!/usr/bin/env bash
set -euo pipefail

# Generate a local CA and sign server certificates for myecom.net and idp.keycloak.net
# The CA is added to macOS Keychain so browsers trust the certs.

CERTS_DIR="$(cd "$(dirname "$0")" && pwd)"
CA_KEY="$CERTS_DIR/ca.key"
CA_CRT="$CERTS_DIR/ca.crt"

echo "==> Creating local Certificate Authority..."
openssl genrsa -out "$CA_KEY" 2048 2>/dev/null
openssl req -x509 -new -nodes -key "$CA_KEY" -sha256 -days 365 \
  -out "$CA_CRT" -subj "/CN=MyEcom Local CA" 2>/dev/null

# --- myecom.net ---
echo "==> Signing certificate for myecom.net..."
openssl genrsa -out "$CERTS_DIR/selfsigned.key" 2048 2>/dev/null
openssl req -new -key "$CERTS_DIR/selfsigned.key" \
  -out "$CERTS_DIR/myecom.csr" -subj "/CN=myecom.net" 2>/dev/null
cat > "$CERTS_DIR/myecom.ext" <<EXTEOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
subjectAltName=DNS:myecom.net
EXTEOF
openssl x509 -req -in "$CERTS_DIR/myecom.csr" \
  -CA "$CA_CRT" -CAkey "$CA_KEY" -CAcreateserial \
  -out "$CERTS_DIR/selfsigned.crt" -days 365 -sha256 \
  -extfile "$CERTS_DIR/myecom.ext" 2>/dev/null

# --- idp.keycloak.net ---
echo "==> Signing certificate for idp.keycloak.net..."
openssl genrsa -out "$CERTS_DIR/keycloak.key" 2048 2>/dev/null
openssl req -new -key "$CERTS_DIR/keycloak.key" \
  -out "$CERTS_DIR/keycloak.csr" -subj "/CN=idp.keycloak.net" 2>/dev/null
cat > "$CERTS_DIR/keycloak.ext" <<EXTEOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
subjectAltName=DNS:idp.keycloak.net
EXTEOF
openssl x509 -req -in "$CERTS_DIR/keycloak.csr" \
  -CA "$CA_CRT" -CAkey "$CA_KEY" -CAcreateserial \
  -out "$CERTS_DIR/keycloak.crt" -days 365 -sha256 \
  -extfile "$CERTS_DIR/keycloak.ext" 2>/dev/null

# Clean up temp files
rm -f "$CERTS_DIR"/*.csr "$CERTS_DIR"/*.ext "$CERTS_DIR"/*.srl

# --- Trust the CA on macOS ---
echo "==> Adding CA to macOS Keychain (requires password)..."
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain "$CA_CRT"

echo "    Done. Browsers will now trust myecom.net and idp.keycloak.net."
