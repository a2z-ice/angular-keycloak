# Plan 001: Docker Infrastructure

## Objective
Set up Docker Compose with Keycloak 26.2.5 and an Nginx container to serve the Angular app.

## Services
1. **keycloak** — Keycloak 26.2.5 (quay.io/keycloak/keycloak:26.2.5)
   - Accessible at `http://idp.keycloak.net:8080`
   - Dev mode with H2 database (sufficient for demo)
   - Auto-import realm on first start
   - Admin credentials: admin / admin

2. **angular-app** — Nginx serving the built Angular SPA
   - Accessible at `http://myecom.net:5000`
   - Nginx config handles SPA routing (try_files)

## Files Created
- `docker-compose.yml`
- `nginx/default.conf`
- `Dockerfile` (Angular multi-stage build)

## Network
- Both services on the same Docker network
- Ports: 8080 (Keycloak), 5000 (Angular/Nginx)

## Success Criteria
- `curl http://idp.keycloak.net:8080` returns Keycloak welcome page
- `curl http://myecom.net:5000` returns Angular index.html
