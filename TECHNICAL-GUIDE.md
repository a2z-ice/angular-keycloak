# Technical Guide: Angular + Keycloak + Flask OIDC PKCE Stack

A step-by-step guide to build and deploy an Angular 20 application with Keycloak authentication (OIDC Authorization Code + PKCE), a Flask API with JWT validation, and nginx as a reverse proxy with SSL termination.

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [SSL Certificates](#2-ssl-certificates)
3. [Keycloak Configuration](#3-keycloak-configuration)
4. [Angular Application](#4-angular-application)
5. [Flask API](#5-flask-api)
6. [Nginx Configuration](#6-nginx-configuration)
7. [Docker Compose Deployment](#7-docker-compose-deployment)
8. [Kind Kubernetes Deployment](#8-kind-kubernetes-deployment)
9. [E2E Testing](#9-e2e-testing)

---

## 1. Architecture Overview

```
                         ┌─────────────────────────────────────────┐
                         │           nginx container               │
  Browser ──────────────►│                                         │
                         │  :443  (myecom.net)                     │
  https://myecom.net:5500│    ├── /api/*  ──► api:8000 (Flask)     │
         ────────────────│    └── /*      ──► Angular SPA (static) │
                         │                                         │
  https://idp.keycloak   │  :8443 (idp.keycloak.net)               │
         .net:8443       │    └── /*  ──► keycloak:8080 (HTTP)      │
         ────────────────│                                         │
                         └─────────────────────────────────────────┘
```

**Key design decisions:**

- **Single nginx container** serves Angular SPA, proxies API requests, AND terminates SSL for Keycloak
- **Keycloak runs plain HTTP** internally — nginx handles SSL termination
- **PKCE (S256)** requires `crypto.subtle` which needs HTTPS — that's why we can't use plain HTTP
- **Roles are read from the access token** (not ID token) because Keycloak puts `realm_access` in the access token by default
- **API is same-origin** via nginx (`/api/*` → Flask) — no CORS needed

---

## 2. SSL Certificates

PKCE uses `crypto.subtle` which is only available in secure contexts (HTTPS or localhost). Since we use custom domains (`myecom.net`, `idp.keycloak.net`), we need HTTPS.

### 2.1 Create a Local Certificate Authority

Generate a root CA that will sign both server certificates:

```bash
# Generate CA private key
openssl genrsa -out ca.key 2048

# Generate CA certificate (valid 365 days)
openssl req -x509 -new -nodes -key ca.key -sha256 -days 365 \
  -out ca.crt -subj "/CN=MyEcom Local CA"
```

### 2.2 Sign Certificate for myecom.net

```bash
# Generate server key
openssl genrsa -out selfsigned.key 2048

# Generate CSR
openssl req -new -key selfsigned.key \
  -out myecom.csr -subj "/CN=myecom.net"

# Create extensions file (required for SAN)
cat > myecom.ext <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
subjectAltName=DNS:myecom.net
EOF

# Sign with CA
openssl x509 -req -in myecom.csr \
  -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out selfsigned.crt -days 365 -sha256 \
  -extfile myecom.ext
```

### 2.3 Sign Certificate for idp.keycloak.net

```bash
openssl genrsa -out keycloak.key 2048

openssl req -new -key keycloak.key \
  -out keycloak.csr -subj "/CN=idp.keycloak.net"

cat > keycloak.ext <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
subjectAltName=DNS:idp.keycloak.net
EOF

openssl x509 -req -in keycloak.csr \
  -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out keycloak.crt -days 365 -sha256 \
  -extfile keycloak.ext
```

### 2.4 Trust the CA (macOS)

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain ca.crt
```

This makes Chrome, Safari, and Firefox trust any certificate signed by this CA. Restart browsers after running this.

### 2.5 Trust the CA (manual browser acceptance)

If you don't want to run the `sudo` command, accept certs manually:

1. Visit `https://idp.keycloak.net:8443` **first** and accept the certificate warning
2. Then visit `https://myecom.net:5500` and accept

> Keycloak must be accepted first because the Angular app fetches OIDC config from `https://idp.keycloak.net:8443` in the background. If that cert isn't accepted, the fetch fails silently.

### 2.6 Files produced

```
certs/
├── ca.key              # CA private key (keep secret)
├── ca.crt              # CA certificate (distribute to trust)
├── selfsigned.key      # myecom.net private key
├── selfsigned.crt      # myecom.net certificate (signed by CA)
├── keycloak.key        # idp.keycloak.net private key
└── keycloak.crt        # idp.keycloak.net certificate (signed by CA)
```

---

## 3. Keycloak Configuration

Keycloak is configured via a realm export JSON file that is auto-imported on first start.

### 3.1 Realm: `myecom`

```json
{
  "realm": "myecom",
  "enabled": true,
  "sslRequired": "none"
}
```

`sslRequired: "none"` because Keycloak runs HTTP internally — SSL is handled by nginx.

### 3.2 Client: `myecom-spa`

```json
{
  "clientId": "myecom-spa",
  "publicClient": true,
  "standardFlowEnabled": true,
  "directAccessGrantsEnabled": true,
  "protocol": "openid-connect",
  "rootUrl": "https://myecom.net:5500",
  "redirectUris": ["https://myecom.net:5500/*"],
  "webOrigins": ["https://myecom.net:5500"],
  "attributes": {
    "pkce.code.challenge.method": "S256",
    "post.logout.redirect.uris": "https://myecom.net:5500/*"
  }
}
```

Key settings:
- **`publicClient: true`** — SPA has no client secret
- **`standardFlowEnabled: true`** — enables Authorization Code flow
- **`pkce.code.challenge.method: S256`** — enforces PKCE with SHA-256
- **`directAccessGrantsEnabled: true`** — allows password grant for testing/E2E

### 3.3 Realm Roles

```json
{
  "roles": {
    "realm": [
      { "name": "admin", "description": "Full access" },
      { "name": "user", "description": "Limited access" }
    ]
  }
}
```

### 3.4 Users

| Username | Password | Roles |
|----------|----------|-------|
| `user1` | `user1` | `user` |
| `admin1` | `admin1` | `admin` |

```json
{
  "username": "user1",
  "credentials": [{ "type": "password", "value": "user1", "temporary": false }],
  "realmRoles": ["user", "default-roles-myecom"]
}
```

### 3.5 Docker environment

```yaml
environment:
  KC_BOOTSTRAP_ADMIN_USERNAME: admin    # Keycloak admin console login
  KC_BOOTSTRAP_ADMIN_PASSWORD: admin
  KC_PROXY_HEADERS: xforwarded          # Trust nginx X-Forwarded-* headers
```

`KC_PROXY_HEADERS: xforwarded` is **required** when Keycloak is behind a reverse proxy. Without it, Keycloak generates `http://` URLs in OIDC responses instead of `https://`.

---

## 4. Angular Application

### 4.1 Install OIDC Library

```bash
ng new myecom-app --style=css --ssr=false --routing
cd myecom-app
npm install angular-auth-oidc-client
```

### 4.2 OIDC Configuration

**`src/app/auth/auth.config.ts`**

```typescript
import { PassedInitialConfig } from 'angular-auth-oidc-client';

export const authConfig: PassedInitialConfig = {
  config: {
    authority: 'https://idp.keycloak.net:8443/realms/myecom',
    redirectUrl: 'https://myecom.net:5500',
    postLogoutRedirectUri: 'https://myecom.net:5500',
    clientId: 'myecom-spa',
    scope: 'openid profile email',
    responseType: 'code',             // Authorization Code flow
    silentRenew: true,
    useRefreshToken: true,
    secureRoutes: ['https://myecom.net:5500/api'],  // auto-attach Bearer token
  },
};
```

Key points:
- **`authority`** — Keycloak realm URL (through nginx proxy)
- **`responseType: 'code'`** — Authorization Code flow (PKCE is auto-enabled)
- **`secureRoutes`** — the interceptor auto-attaches the Bearer token for these URL prefixes

### 4.3 App Configuration with Auth Initializer

**`src/app/app.config.ts`**

```typescript
import { provideAuth, withAppInitializerAuthCheck } from 'angular-auth-oidc-client';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAuth(authConfig, withAppInitializerAuthCheck()),
  ],
};
```

`withAppInitializerAuthCheck()` ensures the OIDC library is fully initialized before any route guard runs. Without this, `authorize()` calls fail silently because the library hasn't fetched the OIDC discovery document yet.

### 4.4 Authentication Guard

**`src/app/auth/auth.guard.ts`**

```typescript
export const authGuard: CanActivateFn = () => {
  const oidcService = inject(OidcSecurityService);

  return oidcService.isAuthenticated$.pipe(
    take(1),
    map(({ isAuthenticated }) => {
      if (!isAuthenticated) {
        oidcService.authorize();  // Redirect to Keycloak login
        return false;
      }
      return true;
    })
  );
};
```

### 4.5 Role Guard (reads from access token)

**`src/app/auth/role.guard.ts`**

```typescript
export function roleGuard(requiredRole: string): CanActivateFn {
  return () => {
    const oidcService = inject(OidcSecurityService);
    const router = inject(Router);

    return oidcService.getAccessToken().pipe(
      take(1),
      map(token => {
        if (!token) return router.createUrlTree(['/unauthorized']);
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          const roles: string[] = payload.realm_access?.roles ?? [];
          if (roles.includes(requiredRole)) return true;
        } catch {}
        return router.createUrlTree(['/unauthorized']);
      })
    );
  };
}
```

**Why decode the access token?** Keycloak puts `realm_access.roles` in the **access token** by default, not the ID token. The OIDC library's `userData$` comes from the ID token/userinfo endpoint which doesn't include realm roles.

### 4.6 HTTP Interceptor (auto-attach Bearer token)

**`src/app/interceptors/auth.interceptor.ts`**

```typescript
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const oidcService = inject(OidcSecurityService);

  return oidcService.getAccessToken().pipe(
    take(1),
    switchMap(token => {
      if (token) {
        const cloned = req.clone({
          setHeaders: { Authorization: `Bearer ${token}` },
        });
        return next(cloned);
      }
      return next(req);
    })
  );
};
```

This only attaches the token for URLs matching `secureRoutes` in the auth config.

### 4.7 Routes

```typescript
export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/...') },

  // Protected — any authenticated user
  { path: 'dashboard', loadComponent: ..., canActivate: [authGuard] },
  { path: 'profile',   loadComponent: ..., canActivate: [authGuard] },
  { path: 'products',  loadComponent: ..., canActivate: [authGuard] },

  // Protected — admin only
  { path: 'admin-panel',      loadComponent: ..., canActivate: [authGuard, roleGuard('admin')] },
  { path: 'user-management',  loadComponent: ..., canActivate: [authGuard, roleGuard('admin')] },
  { path: 'settings',         loadComponent: ..., canActivate: [authGuard, roleGuard('admin')] },

  { path: 'unauthorized', loadComponent: ... },
  { path: '**', redirectTo: '' },
];
```

### 4.8 Auth Service (role detection from access token)

```typescript
export class AuthService {
  roles$ = this.oidcService.getAccessToken().pipe(
    map(token => {
      if (!token) return [];
      const payload = JSON.parse(atob(token.split('.')[1]));
      return (payload.realm_access?.roles as string[]) ?? [];
    })
  );

  hasRole$(role: string) {
    return this.roles$.pipe(map(roles => roles.includes(role)));
  }
}
```

### 4.9 API Service (same-origin calls)

```typescript
export class ApiService {
  private baseUrl = '';  // Same origin — nginx proxies /api/* to Flask

  getProfile() { return this.http.get(`${this.baseUrl}/api/user/profile`); }
  getStats()   { return this.http.get(`${this.baseUrl}/api/admin/stats`); }
}
```

`baseUrl` is empty because the API is served from the same domain via nginx reverse proxy. No CORS needed.

---

## 5. Flask API

### 5.1 Dependencies

```
flask==3.1.1
gunicorn==23.0.0
python-jose[cryptography]==3.4.0
requests==2.32.3
```

### 5.2 JWT Validation

```python
KEYCLOAK_URL = "http://keycloak:8080"           # Internal Docker/K8s URL (plain HTTP)
ISSUER = "https://idp.keycloak.net:8443/realms/myecom"  # Public URL (what's in the token)
```

The API fetches JWKS (JSON Web Key Set) from Keycloak internally via HTTP, but validates the token's `issuer` against the public HTTPS URL. This is because:
- The **browser** gets tokens from `https://idp.keycloak.net:8443` (through nginx)
- The **API** fetches JWKS from `http://keycloak:8080` (direct internal network)
- The token's `iss` claim contains the public URL

```python
def get_jwks():
    resp = requests.get(JWKS_URL)  # http://keycloak:8080/realms/myecom/.../certs
    return resp.json()

payload = jwt.decode(token, key, algorithms=["RS256"],
                     audience="account", issuer=ISSUER)
```

### 5.3 Authentication Decorator

```python
def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user = get_current_user()
        if user is None:
            return jsonify({"detail": "Invalid token"}), 401
        g.user = user
        return f(*args, **kwargs)
    return decorated
```

### 5.4 Authorization Decorator

```python
def require_role(role):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            user = get_current_user()
            if user is None:
                return jsonify({"detail": "Invalid token"}), 401
            roles = user.get("realm_access", {}).get("roles", [])
            if role not in roles:
                return jsonify({"detail": f"Role '{role}' required"}), 403
            g.user = user
            return f(*args, **kwargs)
        return decorated
    return decorator
```

### 5.5 Endpoint Access Matrix

```python
@app.get("/api/health")              # Public — no decorator
def health(): ...

@app.get("/api/user/profile")
@require_auth                        # Any authenticated user
def get_profile(): ...

@app.get("/api/admin/users")
@require_role("admin")               # Admin only
def get_all_users(): ...
```

---

## 6. Nginx Configuration

A single nginx container handles three responsibilities:

### 6.1 Angular SPA + API Proxy (`default.conf`)

```nginx
upstream api_backend {
    server api:8000;          # Flask container
}

server {
    listen 443 ssl;
    server_name myecom.net;

    ssl_certificate /etc/nginx/certs/selfsigned.crt;
    ssl_certificate_key /etc/nginx/certs/selfsigned.key;

    root /usr/share/nginx/html;   # Angular built files

    # API requests → Flask backend
    location /api/ {
        proxy_pass http://api_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Everything else → Angular SPA (try_files for client-side routing)
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 6.2 Keycloak SSL Proxy (`keycloak-proxy.conf`)

```nginx
upstream keycloak_backend {
    server keycloak:8080;     # Keycloak container (plain HTTP)
}

server {
    listen 8443 ssl;
    server_name idp.keycloak.net;

    ssl_certificate /etc/nginx/certs/keycloak.crt;
    ssl_certificate_key /etc/nginx/certs/keycloak.key;

    location / {
        proxy_pass http://keycloak_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;    # Tell Keycloak it's HTTPS
        proxy_set_header X-Forwarded-Port 8443;
        proxy_buffer_size 128k;                      # Keycloak sends large headers
        proxy_buffers 4 256k;
        proxy_busy_buffers_size 256k;
    }
}
```

The `proxy_buffer_size` settings are important — Keycloak sends large response headers (tokens, cookies) that exceed nginx's default 4k buffer.

---

## 7. Docker Compose Deployment

### 7.1 docker-compose.yml

```yaml
services:
  keycloak:
    image: quay.io/keycloak/keycloak:26.2.5
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
      KC_PROXY_HEADERS: xforwarded
    command: ["start-dev", "--import-realm"]
    volumes:
      - ./keycloak/realm-export.json:/opt/keycloak/data/import/realm-export.json:ro
    # No ports exposed — only accessible via nginx proxy

  api:
    build: ./api
    ports: ["8000:8000"]        # Direct access for debugging

  angular-app:                   # nginx container
    build: .
    ports:
      - "5500:443"              # Angular SPA
      - "8443:8443"             # Keycloak proxy
    volumes:
      - ./nginx/certs:/etc/nginx/certs:ro
```

### 7.2 Angular Dockerfile (multi-stage)

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY myecom-app/package*.json ./
RUN npm ci
COPY myecom-app/ ./
RUN npx ng build --configuration=production

FROM nginx:alpine
COPY --from=build /app/dist/myecom-app/browser /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/keycloak-proxy.conf /etc/nginx/conf.d/keycloak-proxy.conf
```

### 7.3 Deploy

```bash
# Generate certs (first time)
./certs/generate.sh

# Copy certs to nginx mount
mkdir -p nginx/certs
cp certs/selfsigned.* certs/keycloak.* nginx/certs/

# Build and run
docker compose build --no-cache
docker compose up -d

# Wait for Keycloak health
until docker inspect --format='{{.State.Health.Status}}' keycloak | grep -q healthy; do
  sleep 2
done

# Verify
curl -sk https://myecom.net:5500          # Angular
curl -sk https://idp.keycloak.net:8443    # Keycloak
curl -sk https://myecom.net:5500/api/health  # API
```

Or simply run:

```bash
./run.sh           # Deploy only
./run.sh --test    # Deploy + run 54 E2E tests
```

---

## 8. Kind Kubernetes Deployment

### 8.1 Kind Cluster Config

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: k8s-angular
nodes:
  - role: control-plane
    extraPortMappings:
      - containerPort: 30443    # → nginx :443 (Angular)
        hostPort: 5500
      - containerPort: 30844    # → nginx :8443 (Keycloak proxy)
        hostPort: 8443
```

### 8.2 Kubernetes Resources

| Resource | Type | Purpose |
|----------|------|---------|
| `keycloak-realm` | ConfigMap | Realm export JSON |
| `keycloak` | Deployment + ClusterIP Service | Keycloak on port 8080 |
| `api` | Deployment + ClusterIP Service | Flask API on port 8000 |
| `nginx-config` | ConfigMap | nginx conf files |
| `tls-certs` | Secret | SSL certificates |
| `nginx` | Deployment + NodePort Service | nginx on 30443/30844 |

### 8.3 Key Details

**Images are loaded locally** (not pulled from registry):
```bash
docker build -t myecom-angular:latest .
docker build -t myecom-api:latest api/
kind load docker-image myecom-angular:latest --name k8s-angular
kind load docker-image myecom-api:latest --name k8s-angular
```

**TLS certs stored as a K8s Secret:**
```bash
kubectl create secret generic tls-certs \
  --from-file=selfsigned.crt=nginx/certs/selfsigned.crt \
  --from-file=selfsigned.key=nginx/certs/selfsigned.key \
  --from-file=keycloak.crt=nginx/certs/keycloak.crt \
  --from-file=keycloak.key=nginx/certs/keycloak.key
```

**Nginx pod mounts ConfigMap (overrides baked-in config) + Secret (certs):**
```yaml
volumes:
  - name: nginx-config
    configMap:
      name: nginx-config       # default.conf + keycloak-proxy.conf
  - name: tls-certs
    secret:
      secretName: tls-certs    # .crt + .key files
```

**NodePort Service exposes nginx through Kind port mappings:**
```yaml
spec:
  type: NodePort
  ports:
    - name: https
      port: 443
      nodePort: 30443           # → host port 5500
    - name: keycloak-proxy
      port: 8443
      nodePort: 30844           # → host port 8443
```

### 8.4 Deploy

```bash
./deploy-k8s.sh           # Deploy only
./deploy-k8s.sh --test    # Deploy + run 54 E2E tests
```

### 8.5 Teardown

```bash
kind delete cluster --name k8s-angular
```

---

## 9. E2E Testing

### 9.1 Test Structure

```
e2e/
├── playwright.config.ts      # 3 browsers: Chromium, Firefox, WebKit
├── helpers/
│   └── login.ts              # Keycloak login helper
└── tests/
    ├── auth.spec.ts           # Authentication flow (6 tests)
    ├── user-access.spec.ts    # User role access (3 tests)
    ├── admin-access.spec.ts   # Admin role access (3 tests)
    └── api.spec.ts            # API endpoint tests (6 tests)
```

### 9.2 Test Coverage (18 tests x 3 browsers = 54 total)

**Authentication Flow:**
- Home page shows Login button when not authenticated
- Login button redirects to Keycloak
- Protected route redirects to Keycloak when unauthenticated
- user1 can login via Keycloak
- admin1 can login via Keycloak
- Logout clears session

**User Role Access:**
- user1 can navigate to Dashboard, Profile, Products
- user1 sees "Access Denied" on admin pages
- user1 nav bar does not show admin links

**Admin Role Access:**
- admin1 can navigate to all user pages
- admin1 can navigate to all admin pages
- admin1 nav bar shows all links

**API Endpoints:**
- `/api/health` is public (200)
- User endpoints return 401 without token
- Admin endpoints return 401 without token
- user1 can access `/api/user/*` (200)
- user1 gets 403 on `/api/admin/*`
- admin1 can access all endpoints (200)

### 9.3 Run Tests

```bash
cd e2e
npm install
npx playwright install chromium firefox webkit

# Headless (all 3 browsers)
npx playwright test

# Headed — watch in visible browser
npx playwright test --headed --project=chromium
npx playwright test --headed --project=webkit
npx playwright test --headed --project=firefox
```

### 9.4 How Playwright Handles Self-Signed Certs

The Playwright config uses `ignoreHTTPSErrors: true`:

```typescript
projects: [
  {
    name: 'chromium',
    use: {
      baseURL: 'https://myecom.net:5500',
      ignoreHTTPSErrors: true,     // Bypasses cert validation
    },
  },
],
```

This makes Playwright's embedded browsers accept self-signed certificates without needing the CA trusted in the system Keychain. Real browsers (Chrome, Safari, Firefox) require either the CA to be trusted or manual cert acceptance.

---

## Quick Reference

### URLs

| Service | URL |
|---------|-----|
| Angular App | `https://myecom.net:5500` |
| Keycloak | `https://idp.keycloak.net:8443` |
| Keycloak Admin | `https://idp.keycloak.net:8443` (admin/admin) |
| API Health | `https://myecom.net:5500/api/health` |

### Users

| Username | Password | Role | Access |
|----------|----------|------|--------|
| `user1` | `user1` | user | Dashboard, Profile, Products |
| `admin1` | `admin1` | admin | All pages + Admin Panel, Users, Settings |

### Scripts

| Script | Purpose |
|--------|---------|
| `./certs/generate.sh` | Generate CA + server certs, trust CA on macOS |
| `./run.sh` | Deploy with Docker Compose |
| `./run.sh --test` | Deploy + run 54 E2E tests |
| `./deploy-k8s.sh` | Deploy to Kind K8s cluster |
| `./deploy-k8s.sh --test` | Deploy to K8s + run 54 E2E tests |

### Ports

| Port | Host Mapping | Service |
|------|-------------|---------|
| 443 | 5500 | Angular SPA (nginx) |
| 8443 | 8443 | Keycloak proxy (nginx) |
| 8080 | not exposed | Keycloak internal (HTTP) |
| 8000 | 8000 (compose only) | Flask API |
