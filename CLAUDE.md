# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack Overview

A demo e-commerce auth stack showing OIDC Authorization Code + PKCE with role-based access:

- **Angular 20 SPA** (`myecom-app/`) using `angular-auth-oidc-client` — served as static files by nginx
- **Keycloak 26.2.5** (realm `myecom`, client `myecom-spa` — public, PKCE S256) — runs plain HTTP internally
- **Flask API** (`api/main.py`) — validates Keycloak JWTs via JWKS, not FastAPI despite the name
- **Single nginx container** that: (a) serves the Angular SPA, (b) reverse-proxies `/api/*` → Flask, (c) terminates SSL for Keycloak on a second `server` block

Deployable via Docker Compose (`run.sh`) or Kind/Kubernetes (`deploy-k8s.sh`). Both reuse the same Docker images and TLS certs.

## URLs, Ports, and Host Entries

The stack assumes these entries in `/etc/hosts`:
```
127.0.0.1  idp.keycloak.net  myecom.net  api.service.net
```

- Angular SPA: `https://myecom.net:5500` (container port 443 → host 5500; macOS AirPlay blocks 5000)
- Keycloak: `https://idp.keycloak.net:8443` (nginx SSL termination → keycloak:8080)
- API: reached via `https://myecom.net:5500/api/*` (same-origin, no CORS needed). Direct Docker port 8000 only exists in `docker-compose.yml`.

## Test users

Defined in `keycloak/realm-export.json`:
- `user1` / `user1` — realm role `user`
- `admin1` / `admin1` — realm roles `user` + `admin`

## Common commands

```bash
# Bring the whole stack up (compose). Adds --test to run Playwright after.
./run.sh [--test]

# Kind/K8s deployment. Deletes the existing cluster first.
./deploy-k8s.sh [--test]

# Angular dev / build / unit tests (Karma+Jasmine)
cd myecom-app && npm start            # ng serve (HTTP dev only — no PKCE)
cd myecom-app && npm run build        # production build to dist/
cd myecom-app && npm test             # unit tests

# E2E (stack must already be running)
cd e2e && npx playwright test
cd e2e && npx playwright test tests/auth.spec.ts              # single file
cd e2e && npx playwright test -g "admin1 can login"           # by title
cd e2e && npx playwright test --project=chromium              # single browser
cd e2e && npx playwright test --headed

# Regenerate certs (normally run.sh does this the first time)
./certs/generate.sh

# Tear down
docker compose down -v
kind delete cluster --name k8s-angular
```

## Architecture notes you need before editing

- **HTTPS everywhere is mandatory.** PKCE S256 uses `crypto.subtle`, which browsers only expose in secure contexts. Don't "simplify" by switching to HTTP.
- **Keycloak is HTTP internally; nginx terminates SSL.** Keycloak is started with `KC_PROXY_HEADERS=xforwarded`. When changing nginx/Keycloak wiring, preserve `X-Forwarded-Proto https` and `X-Forwarded-Port 8443` in `nginx/keycloak-proxy.conf` — Keycloak uses these to build issuer and redirect URLs, and a mismatch with the SPA's configured `authority` breaks discovery.
- **Roles come from the access token, not the ID token.** Keycloak puts `realm_access.roles` in the access token. The Angular `AuthService` (`myecom-app/src/app/services/auth.service.ts`) and `roleGuard` (`.../auth/role.guard.ts`) manually base64-decode `access_token.split('.')[1]`. The Flask API (`api/main.py`) reads the same claim via `python-jose` after JWKS validation. If you add role-gated features, extend both sides consistently.
- **Two guard layers on routes.** `authGuard` triggers `oidcService.authorize()` on unauth (so protected routes auto-redirect to Keycloak); `roleGuard('admin')` returns `/unauthorized` for logged-in users missing the role. Compose them in `app.routes.ts` as `canActivate: [authGuard, roleGuard('admin')]`.
- **Auth tokens are attached by an HTTP interceptor** (`myecom-app/src/app/interceptors/auth.interceptor.ts`) on every request. The `secureRoutes` entry in `auth.config.ts` must match the API base (`https://myecom.net:5500/api`) or tokens won't be sent.
- **API JWT validation** hits `http://keycloak:8080/.../certs` (in-cluster HTTP) for JWKS but validates `iss` against `https://idp.keycloak.net:8443/realms/myecom` (external HTTPS). Both strings appear in `api/main.py` — if you rename hosts/ports, update both.
- **CA-signed local certs.** `certs/generate.sh` creates a local CA (`ca.crt`) and signs `selfsigned.crt` (myecom.net) + `keycloak.crt` (idp.keycloak.net). `run.sh`/`deploy-k8s.sh` copy these to `nginx/certs/`. Browsers need the CA installed to trust them without warnings — see `MANUAL-TESTING.md` for macOS/Linux/Windows instructions.
- **Kind vs Compose parity.** `k8s/` manifests mirror `docker-compose.yml`: same images (`myecom-angular:latest`, `myecom-api:latest`), same TLS secret layout. `deploy-k8s.sh` always rebuilds and `kind load docker-image`s both images. Keep the two deployment paths in sync when changing networking, env vars, or volume mounts.

## Documentation and plans

- `TECHNICAL-GUIDE.md` — end-to-end rebuild walkthrough (certs, Keycloak setup, Angular wiring, nginx, k8s). Read this before large restructuring.
- `MANUAL-TESTING.md` — prerequisites, host entries, per-OS CA trust steps, manual smoke flows.
- `plans/00X-*.md` — incremental design notes (docker infra, Keycloak realm, Angular setup, Playwright, Python API, future enhancements). Numbered chronologically; add the next integer for new plans.
