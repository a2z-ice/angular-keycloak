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

### 2.4 Trust the CA

After generating the CA certificate (`ca.crt`), you must add it to your OS trust store so browsers accept the signed certificates without warnings.

#### macOS

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain ca.crt
```

Restart Chrome/Safari/Firefox after running this.

To **remove** the CA later:
```bash
sudo security remove-trusted-cert -d ca.crt
```

#### RHEL 9 / CentOS 9 / Fedora

```bash
# Copy CA cert to the system trust anchors
sudo cp ca.crt /etc/pki/ca-trust/source/anchors/myecom-local-ca.crt

# Update the system trust store
sudo update-ca-trust

# Verify it was added
trust list | grep -i "myecom"
```

Restart Chrome/Firefox after running this. This also makes `curl` and other CLI tools trust the CA (no need for `-k` flag).

To **remove** the CA later:
```bash
sudo rm /etc/pki/ca-trust/source/anchors/myecom-local-ca.crt
sudo update-ca-trust
```

#### Windows 11

**Option A: Command line (PowerShell as Administrator)**
```powershell
# Import CA into the Trusted Root Certification Authorities store
certutil -addstore -f "ROOT" ca.crt
```

To **remove** the CA later:
```powershell
certutil -delstore "ROOT" "MyEcom Local CA"
```

**Option B: GUI**
1. Double-click `ca.crt` file
2. Click **Install Certificate...**
3. Select **Local Machine** → Next
4. Select **Place all certificates in the following store** → Browse
5. Choose **Trusted Root Certification Authorities** → OK → Next → Finish
6. Click **Yes** on the security warning

Restart Chrome/Edge/Firefox after importing.

> **Note for Firefox on all platforms:** Firefox uses its own certificate store by default and may not trust the OS store. To fix this:
> 1. Open `about:config` in Firefox
> 2. Set `security.enterprise_roots.enabled` to `true`
> 3. Restart Firefox
>
> This makes Firefox trust certificates from the OS trust store.

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

### 2.7 Multi-domain certificates (SAN)

Sections 2.2 and 2.3 produce two single-domain certs. A single cert can cover **many** hostnames by listing them as `subjectAltName` (SAN) entries. Use this when:

- You want one cert / one Secret to cover all services (e.g. `myecom.net` + `idp.keycloak.net` + `api.service.net`).
- You need to add a subdomain (`www.myecom.net`) without regenerating everything.
- You want a wildcard for an environment (`*.myecom.net`).
- You need to hit a service by IP during local testing (`127.0.0.1`).

> **Context:** Browsers have ignored the cert's `CN` for name verification since Chrome 58 (2017). Only `subjectAltName` is checked. Single-domain certs still *work* because `generate.sh` puts one `DNS:` entry in SAN — but the pattern scales cleanly to many.

#### 2.7.1 How SAN entries work

The SAN extension is a list of typed names baked into the cert at signing time. Supported types we care about:

| Prefix | Matches | Example |
|--------|---------|---------|
| `DNS:` | Exact hostname | `DNS:myecom.net` |
| `DNS:` (wildcard) | One label only | `DNS:*.myecom.net` matches `api.myecom.net` but **not** `myecom.net` or `a.b.myecom.net` |
| `IP:` | Literal IP in SNI/address | `IP:127.0.0.1` |

Rules to remember:

- A wildcard covers **exactly one** DNS label. `*.myecom.net` does not match the apex `myecom.net` — if you want both, list both: `DNS:myecom.net,DNS:*.myecom.net`.
- Names are case-insensitive but write them lowercase.
- `IP:` entries are distinct from `DNS:` entries; a cert with only `DNS:localhost` will fail if the client connects to `https://127.0.0.1/`.
- Every name you want to serve must be present *before* signing. You cannot append SANs to an existing cert — you re-sign a new one.

#### 2.7.2 Example: one cert covering both project hostnames

This collapses the two cert pairs (`selfsigned.*` + `keycloak.*`) into a single `myecom-multi.*` pair that serves both `myecom.net` and `idp.keycloak.net`, plus a few extras for future use.

```bash
# 1. Generate the server key
openssl genrsa -out myecom-multi.key 2048

# 2. CSR — the CN here is mostly cosmetic; SAN does the real work
openssl req -new -key myecom-multi.key \
  -out myecom-multi.csr \
  -subj "/CN=myecom.net"

# 3. Extensions file — the important bit is subjectAltName with multiple entries
cat > myecom-multi.ext <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=@alt_names

[alt_names]
DNS.1 = myecom.net
DNS.2 = www.myecom.net
DNS.3 = idp.keycloak.net
DNS.4 = api.service.net
DNS.5 = *.myecom.net
IP.1  = 127.0.0.1
EOF

# 4. Sign with the local CA from §2.1
openssl x509 -req -in myecom-multi.csr \
  -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out myecom-multi.crt -days 365 -sha256 \
  -extfile myecom-multi.ext
```

The `[alt_names]` stanza is the flexible part — add or remove rows as needed. The `DNS.N` / `IP.N` keys are just ordinal labels required by OpenSSL's config parser; the numbers don't have to be contiguous or in any order.

> **Single-line alternative.** If you dislike the alt_names block, you can inline everything:
> ```bash
> cat > myecom-multi.ext <<EOF
> authorityKeyIdentifier=keyid,issuer
> basicConstraints=CA:FALSE
> subjectAltName=DNS:myecom.net,DNS:www.myecom.net,DNS:idp.keycloak.net,DNS:api.service.net,DNS:*.myecom.net,IP:127.0.0.1
> EOF
> ```
> Same output, less typing — the `[alt_names]` form is only nicer when you have many entries or want to mix types.

#### 2.7.3 Verify the SANs landed

Always inspect the signed cert before deploying it — typos in the `.ext` file fail silently at signing and loudly at TLS handshake.

```bash
openssl x509 -in myecom-multi.crt -noout -text \
  | grep -A1 "Subject Alternative Name"
# X509v3 Subject Alternative Name:
#     DNS:myecom.net, DNS:www.myecom.net, DNS:idp.keycloak.net,
#     DNS:api.service.net, DNS:*.myecom.net, IP Address:127.0.0.1
```

Or, if you only want the SAN list without the rest of the cert text:

```bash
openssl x509 -in myecom-multi.crt -noout -ext subjectAltName
```

Run a handshake to confirm each hostname actually serves this cert (after wiring it into nginx — see §2.7.5):

```bash
echo | openssl s_client -connect myecom.net:5500 -servername myecom.net 2>/dev/null \
  | openssl x509 -noout -subject -ext subjectAltName

echo | openssl s_client -connect idp.keycloak.net:8443 -servername idp.keycloak.net 2>/dev/null \
  | openssl x509 -noout -subject -ext subjectAltName
```

Both should print the same multi-SAN cert.

#### 2.7.4 Wildcard-only variant

If all your services live under one parent domain (`*.myecom.net`), a single wildcard cert is simpler. Remember the one-label rule — list the apex separately if you need it:

```ini
subjectAltName=@alt_names

[alt_names]
DNS.1 = myecom.net              # apex — NOT covered by *.myecom.net
DNS.2 = *.myecom.net            # covers www.myecom.net, api.myecom.net, idp.myecom.net
```

This does **not** work for the current project because `idp.keycloak.net` is on a different parent domain — you'd still need a second SAN (or a second cert) for it.

#### 2.7.5 Wire the multi-domain cert into the stack

Swapping in the consolidated cert is a three-file change. Only do this if you're actually consolidating — keeping two separate certs is also a valid design.

**(a) `nginx/default.conf`** — keep as-is, no change needed if you reuse the same filename. To point at the new cert:

```nginx
server {
    listen 443 ssl;
    server_name myecom.net;
    ssl_certificate     /etc/nginx/certs/myecom-multi.crt;
    ssl_certificate_key /etc/nginx/certs/myecom-multi.key;
    ...
}
```

**(b) `nginx/keycloak-proxy.conf`** — point at the **same** files:

```nginx
server {
    listen 8443 ssl;
    server_name idp.keycloak.net;
    ssl_certificate     /etc/nginx/certs/myecom-multi.crt;
    ssl_certificate_key /etc/nginx/certs/myecom-multi.key;
    ...
}
```

nginx is happy serving the same cert from two `server` blocks because the cert contains both names in SAN — TLS picks the right one based on SNI, and the `server_name` directive picks the right block afterwards.

**(c) Docker Compose** — just drop the new pair into `nginx/certs/` alongside (or instead of) the old ones, then `docker compose up -d --build`. No other change required.

**(d) Kubernetes** — update the `tls-certs` Secret to contain the consolidated pair. Either in addition to the old keys (safe) or instead of them (clean):

```bash
kubectl delete secret tls-certs
kubectl create secret generic tls-certs \
  --from-file=myecom-multi.crt=nginx/certs/myecom-multi.crt \
  --from-file=myecom-multi.key=nginx/certs/myecom-multi.key
kubectl rollout restart deployment/nginx
```

See §8.4.7 for the full rotation flow, including why the rollout restart is needed.

#### 2.7.6 Updating `certs/generate.sh` (optional)

If you want `run.sh` / `deploy-k8s.sh` to produce the multi-SAN cert automatically, replace the two separate signing blocks in `certs/generate.sh` with one. The relevant section becomes:

```bash
echo "==> Signing multi-domain certificate..."
openssl genrsa -out "$CERTS_DIR/myecom-multi.key" 2048 2>/dev/null
openssl req -new -key "$CERTS_DIR/myecom-multi.key" \
  -out "$CERTS_DIR/myecom-multi.csr" -subj "/CN=myecom.net" 2>/dev/null

cat > "$CERTS_DIR/myecom-multi.ext" <<EXTEOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
subjectAltName=DNS:myecom.net,DNS:www.myecom.net,DNS:idp.keycloak.net,DNS:api.service.net,DNS:*.myecom.net,IP:127.0.0.1
EXTEOF

openssl x509 -req -in "$CERTS_DIR/myecom-multi.csr" \
  -CA "$CA_CRT" -CAkey "$CA_KEY" -CAcreateserial \
  -out "$CERTS_DIR/myecom-multi.crt" -days 365 -sha256 \
  -extfile "$CERTS_DIR/myecom-multi.ext" 2>/dev/null
```

Then update the copy step in `run.sh` / `deploy-k8s.sh` to copy `myecom-multi.{crt,key}` instead of the two old pairs, and update the `--from-file=` keys for `kubectl create secret tls-certs` to match the filenames referenced in the nginx config (see the filename contract in §8.4.6).

#### 2.7.7 Gotchas

- **`/etc/hosts` must still list every SAN name** you plan to hit locally. SAN doesn't do DNS — it only says "this cert is valid for these names."
- **Wildcards and apex.** `*.example.com` is **not** `example.com`. Always list both if both are served.
- **CA trust is unchanged.** The CA (`ca.crt`) signs the multi-SAN leaf the same way it signs a single-SAN leaf. You don't need to re-trust anything when changing leaf SANs.
- **Don't put SANs in the CSR only.** Some ad-hoc guides put SAN in the CSR and not in the signing `-extfile`. OpenSSL will drop the SAN on sign unless you pass `-copy_extensions copy` — it's safer to put SANs in the `.ext` file passed to `openssl x509 -req` as shown above.
- **Cert renewals re-issue.** "Adding a name" always means re-signing a fresh cert and rotating it. There's no in-place edit.

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

See [section 8.4](#84-tls-certs-secret-lifecycle) for the full lifecycle of `tls-certs`.

### 8.4 tls-certs Secret lifecycle

The `tls-certs` Secret is how the locally-generated SSL material from `certs/generate.sh` reaches the nginx pod inside the Kind cluster. Nginx needs four files on disk — two cert/key pairs, one for each `server_name` it listens on — and a Kubernetes `generic` Secret is the cleanest way to inject them without baking private keys into the image.

The flow end-to-end:

```
certs/generate.sh  ─►  nginx/certs/*.crt,*.key  ─►  kubectl create secret tls-certs
                                                              │
                                                              ▼
                                                 K8s API server (stored in etcd)
                                                              │
                                                              ▼ (kubelet pull on pod start)
                                                 tmpfs volume in nginx pod
                                                              │
                                                              ▼ (mounted at /etc/nginx/certs)
                                                 nginx reads ssl_certificate paths
```

Each step in detail below.

#### 1. Source files on the host

`certs/generate.sh` builds a local CA (`ca.key` / `ca.crt`) and then signs two leaf certificates — one per hostname nginx serves. After it runs, `deploy-k8s.sh` copies the four files nginx needs from `certs/` into `nginx/certs/`:

```
nginx/certs/
├── selfsigned.crt   # PEM, CN=myecom.net,        SAN=DNS:myecom.net        (served on :443)
├── selfsigned.key   # PEM, unencrypted RSA 2048 private key
├── keycloak.crt     # PEM, CN=idp.keycloak.net,  SAN=DNS:idp.keycloak.net  (served on :8443)
└── keycloak.key     # PEM, unencrypted RSA 2048 private key
```

Two important notes:

- **Unencrypted keys.** `openssl genrsa` in `generate.sh` writes private keys without a passphrase. nginx starts non-interactively inside a container, so it can't prompt for one. If you ever re-generate with `-aes256` you will need either `ssl_password_file` in nginx or a different strategy — plain keys are the right default here.
- **The CA (`ca.crt`) is deliberately NOT in the Secret.** The CA is what *browsers and the Flask JWT validator* need to trust; the server only needs its own leaf cert + key. Mixing them would be harmless but it's clearer to keep responsibilities split: `nginx/certs/` = server material, `certs/ca.crt` = trust anchor.

Quick sanity check that a cert and key actually belong together (matching modulus means they're a valid pair):

```bash
openssl x509 -in nginx/certs/selfsigned.crt -noout -modulus | openssl md5
openssl rsa  -in nginx/certs/selfsigned.key -noout -modulus | openssl md5
# Both hashes must be identical. If they differ, nginx will fail with:
#   SSL_CTX_use_PrivateKey_file() failed ... key values mismatch
```

#### 2. Create the Secret (imperative form used by `deploy-k8s.sh`)

`deploy-k8s.sh` creates the Secret before applying any manifests so it exists by the time the nginx Deployment is scheduled:

```bash
kubectl create secret generic tls-certs \
  --from-file=selfsigned.crt=nginx/certs/selfsigned.crt \
  --from-file=selfsigned.key=nginx/certs/selfsigned.key \
  --from-file=keycloak.crt=nginx/certs/keycloak.crt \
  --from-file=keycloak.key=nginx/certs/keycloak.key
```

Breakdown of the flags:

| Flag | Meaning |
|------|---------|
| `generic` | Arbitrary key/value payload. Other subtypes (`tls`, `docker-registry`) impose fixed keys and are wrong for this use case. |
| `tls-certs` | The Secret's `metadata.name`. Referenced verbatim as `secretName: tls-certs` in the Deployment. |
| `--from-file=<key>=<path>` | Read the file at `<path>`, base64-encode it, store it under the map key `<key>`. When the Secret is later mounted as a volume, `<key>` becomes the **filename**. This is the contract nginx depends on. |

If you omit the `<key>=` prefix (`--from-file=nginx/certs/selfsigned.crt`), `kubectl` uses the basename of the path as the key — which happens to be fine here but is fragile if you ever move files around, so the explicit form is preferred.

> **Why `generic` and not `kubernetes.io/tls`?** A `tls` Secret enforces exactly two keys: `tls.crt` and `tls.key`. We need **two independent pairs** — one for `myecom.net:443`, one for `idp.keycloak.net:8443` — so a single `tls` Secret can't represent it. Options were:
> - Two separate `tls` Secrets (`tls-myecom` + `tls-keycloak`) — more idiomatic but requires two volume mounts and two ConfigMap edits.
> - One `generic` Secret with four named keys — one mount, one config path convention. We picked this for simplicity.

Verify what landed in etcd:

```bash
# List the map keys (file names that will appear in the pod)
kubectl get secret tls-certs -o jsonpath='{.data}' | jq 'keys'
# [ "keycloak.crt", "keycloak.key", "selfsigned.crt", "selfsigned.key" ]

# Decode one entry back to PEM and confirm it's the cert you expect
kubectl get secret tls-certs -o jsonpath='{.data.selfsigned\.crt}' \
  | base64 -d \
  | openssl x509 -noout -subject -issuer -dates
# subject= CN=myecom.net
# issuer=  CN=MyEcom Local CA
# notBefore=... notAfter=...
```

#### 3. Declarative equivalent (for reference)

`kubectl create secret generic --from-file=...` is just sugar over the following YAML. Showing it makes the base64 encoding explicit:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: tls-certs
type: Opaque               # same as "generic" on the CLI
data:                      # values here MUST be base64-encoded
  selfsigned.crt: LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t...
  selfsigned.key: LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0t...
  keycloak.crt:   LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t...
  keycloak.key:   LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0t...
```

To produce a value by hand:

```bash
base64 -w0 nginx/certs/selfsigned.crt      # Linux
base64     nginx/certs/selfsigned.crt      # macOS (already single-line friendly)
```

> **Warning:** `data` holds base64 **not** encryption. Anyone with read access to the Secret can decode it in one command. Never commit this YAML to Git. If you want human-readable input, use `stringData:` — the API server will base64-encode on write:
> ```yaml
> stringData:
>   selfsigned.crt: |
>     -----BEGIN CERTIFICATE-----
>     MIID...
>     -----END CERTIFICATE-----
> ```

We use the imperative form in `deploy-k8s.sh` because it keeps private-key bytes out of any checked-in file.

#### 4. How the nginx Deployment consumes it

In `k8s/nginx.yaml`, the Secret is wired up in **two** places on the Pod spec — one declares the volume, the other mounts it into the container. The names must match.

```yaml
spec:
  containers:
    - name: nginx
      image: myecom-angular:latest
      volumeMounts:                        # ─── (b) container-level
        - name: tls-certs                  # must match volumes[].name below
          mountPath: /etc/nginx/certs      # directory nginx reads from
          readOnly: true                   # defensive; Secret volumes are read-only anyway
  volumes:                                 # ─── (a) pod-level
    - name: tls-certs                      # volume name (arbitrary, local to pod)
      secret:
        secretName: tls-certs              # name of the Secret object from step 2
        # defaultMode: 0400                # optional; tightens file perms if needed
        # optional: false                  # default — pod will fail to start if Secret missing
```

What the kubelet actually does when the pod starts:

1. It reads the `tls-certs` Secret from the API server.
2. It creates a **tmpfs** volume on the node (Secret volumes are in-memory — they never touch disk on the host, which is why Secrets are slightly safer than hostPath files).
3. For each key in `Secret.data`, it writes one file into that tmpfs with the key as the filename and the base64-decoded value as the contents.
4. It bind-mounts that tmpfs into the container at `mountPath`.

The result inside the container:

```
$ kubectl exec deploy/nginx -- ls -l /etc/nginx/certs
total 0
lrwxrwxrwx 1 root root 21 Apr 16 09:47 keycloak.crt   -> ..data/keycloak.crt
lrwxrwxrwx 1 root root 21 Apr 16 09:47 keycloak.key   -> ..data/keycloak.key
lrwxrwxrwx 1 root root 23 Apr 16 09:47 selfsigned.crt -> ..data/selfsigned.crt
lrwxrwxrwx 1 root root 23 Apr 16 09:47 selfsigned.key -> ..data/selfsigned.key
```

(The `..data` → timestamped-directory symlink indirection is how kubelet supports atomic updates when the Secret changes — see §8.4.7.)

File permissions default to `0644` for files, `0755` for the directory. If you want stricter permissions (recommended for real production keys), set `defaultMode: 0400` under the `secret:` block or `mode: 0400` per item in a `secret.items[]` list.

If the Secret is missing when the pod starts, the pod stays in `ContainerCreating` with:

```
MountVolume.SetUp failed for volume "tls-certs" : secret "tls-certs" not found
```

That's why `deploy-k8s.sh` creates the Secret *before* `kubectl apply -f k8s/nginx.yaml`.

#### 5. How nginx uses the mounted files

The `nginx-config` ConfigMap (also in `k8s/nginx.yaml`) hard-codes the paths that match the Secret's map keys:

```nginx
# default.conf   → Angular SPA + /api reverse proxy, listens on :443
server {
    listen 443 ssl;
    server_name myecom.net;
    ssl_certificate     /etc/nginx/certs/selfsigned.crt;
    ssl_certificate_key /etc/nginx/certs/selfsigned.key;
    ...
}

# keycloak-proxy.conf → Keycloak SSL termination, listens on :8443
server {
    listen 8443 ssl;
    server_name idp.keycloak.net;
    ssl_certificate     /etc/nginx/certs/keycloak.crt;
    ssl_certificate_key /etc/nginx/certs/keycloak.key;
    ...
}
```

Two Secret-related things to notice:

- **Both `server` blocks live in the same nginx process**, each with its own cert. This is why we need two pairs in one Secret rather than one pair in a `kubernetes.io/tls` Secret.
- **nginx reads the cert files once at startup** (or on `nginx -s reload`). Changing the Secret contents does NOT hot-reload nginx — see §8.4.7 for the rotation flow.

Quick runtime checks from outside the cluster:

```bash
# What cert is served on :5500 (the Angular SPA edge)?
echo | openssl s_client -connect myecom.net:5500 -servername myecom.net 2>/dev/null \
  | openssl x509 -noout -subject -issuer
# subject= CN=myecom.net
# issuer=  CN=MyEcom Local CA

# And on :8443 (the Keycloak proxy)?
echo | openssl s_client -connect idp.keycloak.net:8443 -servername idp.keycloak.net 2>/dev/null \
  | openssl x509 -noout -subject -issuer
# subject= CN=idp.keycloak.net
# issuer=  CN=MyEcom Local CA
```

#### 6. Filename contract — the thing to keep in sync

Three places must agree on the filenames `selfsigned.crt`, `selfsigned.key`, `keycloak.crt`, `keycloak.key`:

1. The `--from-file=<key>=...` keys in `deploy-k8s.sh` (controls Secret map keys → mounted filenames).
2. The `ssl_certificate` / `ssl_certificate_key` paths in the `nginx-config` ConfigMap (controls what nginx reads).
3. The filenames produced by `certs/generate.sh` (controls what gets copied into `nginx/certs/`).

If any of these drift, the symptoms are:

| Drift | Symptom |
|-------|---------|
| Secret key renamed, nginx.conf unchanged | nginx CrashLoopBackOff: `cannot load certificate "/etc/nginx/certs/selfsigned.crt": BIO_new_file() ... No such file or directory` |
| `generate.sh` writes different filename than `deploy-k8s.sh` expects | `deploy-k8s.sh` fails at `kubectl create secret` with "file not found" |
| `mountPath` changed but nginx.conf unchanged | Same nginx BIO_new_file error — directory exists but files don't |

`kubectl describe pod/<nginx-pod>` and `kubectl logs deploy/nginx` will show the actual reason in each case.

#### 7. Rotating certs (the right way)

Secret volumes are automatically refreshed on the node — the kubelet updates the `..data` symlink to point at a new directory when the Secret changes — but **nginx won't pick up new files until the worker processes are recycled**. The simplest reliable flow is rolling the Deployment:

```bash
# 1. Regenerate cert material (on the host)
./certs/generate.sh
cp certs/selfsigned.{crt,key} certs/keycloak.{crt,key} nginx/certs/

# 2. Replace the Secret atomically (delete + recreate, or apply --force)
kubectl delete secret tls-certs
kubectl create secret generic tls-certs \
  --from-file=selfsigned.crt=nginx/certs/selfsigned.crt \
  --from-file=selfsigned.key=nginx/certs/selfsigned.key \
  --from-file=keycloak.crt=nginx/certs/keycloak.crt \
  --from-file=keycloak.key=nginx/certs/keycloak.key

# 3. Trigger a rolling restart so nginx re-reads the certs
kubectl rollout restart deployment/nginx
kubectl rollout status  deployment/nginx
```

A pure `kubectl exec deploy/nginx -- nginx -s reload` would also work *if* the kubelet has already refreshed the projected files (can take up to the kubelet's sync period, default ~60s). Rolling the Deployment is deterministic and only costs a few seconds of 502s on a single-replica demo stack.

#### 8. Debugging checklist

When TLS doesn't work after deploy, check in this order:

```bash
# Is the Secret present and complete?
kubectl get secret tls-certs -o jsonpath='{.data}' | jq 'keys'
# Expect: ["keycloak.crt","keycloak.key","selfsigned.crt","selfsigned.key"]

# Is the nginx pod running? If not, why?
kubectl get pods -l app=nginx
kubectl describe pod -l app=nginx | grep -A3 -i 'mount\|secret\|event'

# What does nginx see on disk?
kubectl exec deploy/nginx -- ls -l /etc/nginx/certs
kubectl exec deploy/nginx -- openssl x509 -in /etc/nginx/certs/selfsigned.crt -noout -subject

# What does nginx actually say on startup?
kubectl logs deploy/nginx --tail=50

# End-to-end: does the cert served match the one in the Secret?
kubectl exec deploy/nginx -- openssl x509 -in /etc/nginx/certs/selfsigned.crt -noout -fingerprint -sha256
echo | openssl s_client -connect myecom.net:5500 -servername myecom.net 2>/dev/null \
  | openssl x509 -noout -fingerprint -sha256
# Both fingerprints should match.
```

A cert/key modulus mismatch (the #1 way this fails after a regeneration) is easiest to catch with the `openssl x509 -modulus | md5` vs `openssl rsa -modulus | md5` comparison from §8.4.1.

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

### 8.5 Deploy

```bash
./deploy-k8s.sh           # Deploy only
./deploy-k8s.sh --test    # Deploy + run 54 E2E tests
```

### 8.6 Teardown

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
