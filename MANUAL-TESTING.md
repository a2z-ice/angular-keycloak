# Manual Testing Guide

## Prerequisites

1. Docker installed and running
2. The following entries in `/etc/hosts`:
   ```
   127.0.0.1  idp.keycloak.net  myecom.net  api.service.net
   ```
3. Chrome/Firefox browser

## 1. Start the Stack

### Option A: Docker Compose
```bash
./run.sh
```

### Option B: Kind Kubernetes
```bash
./deploy-k8s.sh
```

Wait until you see all services return `200`.

---

## 2. Accept Self-Signed Certificate

Open **https://idp.keycloak.net:8443** in your browser. You will see a certificate warning.

- **Chrome**: Click "Advanced" → "Proceed to idp.keycloak.net (unsafe)"
- **Firefox**: Click "Advanced" → "Accept the Risk and Continue"

Do the same for **https://myecom.net:5500**.

> **Important:** You must accept both certificates before testing, otherwise the OIDC redirect will fail silently.

---

## 3. Test Unauthenticated Access

| Step | Action | Expected Result |
|------|--------|-----------------|
| 3.1 | Open `https://myecom.net:5500` | Home page with "Welcome to MyEcom" and a **Login** button |
| 3.2 | Check the navbar | Only **Home** and **Login** visible |
| 3.3 | Click **Dashboard** link (if visible) or navigate to `https://myecom.net:5500/dashboard` | Redirected to Keycloak login page at `idp.keycloak.net` |

---

## 4. Test User Login (user1)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 4.1 | On the home page, click **Login** | Redirected to Keycloak login page |
| 4.2 | Enter username: `user1`, password: `user1` | Credentials accepted |
| 4.3 | Click **Sign In** | Redirected back to `https://myecom.net:5500` |
| 4.4 | Check the navbar | Shows: **Home**, **Dashboard**, **Profile**, **Products**, **Logout** |
| 4.5 | Verify **no admin links** visible | Admin Panel, Users, Settings should NOT appear |

---

## 5. Test User1 Page Access

| Step | Action | Expected Result |
|------|--------|-----------------|
| 5.1 | Click **Dashboard** | Dashboard page loads, shows user info and orders |
| 5.2 | Click **Profile** | Profile page loads, shows username `user1`, email, roles |
| 5.3 | Click **Products** | Products page loads, shows 4 product cards |

---

## 6. Test User1 Admin Restriction

| Step | Action | Expected Result |
|------|--------|-----------------|
| 6.1 | Navigate to `https://myecom.net:5500/admin-panel` | **Access Denied** page |
| 6.2 | Navigate to `https://myecom.net:5500/user-management` | **Access Denied** page |
| 6.3 | Navigate to `https://myecom.net:5500/settings` | **Access Denied** page |

---

## 7. Test Logout

| Step | Action | Expected Result |
|------|--------|-----------------|
| 7.1 | Click **Logout** button in navbar | Session cleared |
| 7.2 | Navigate to `https://myecom.net:5500` | Home page with **Login** button (not Logout) |
| 7.3 | Navigate to `https://myecom.net:5500/dashboard` | Redirected to Keycloak login (session gone) |

---

## 8. Test Admin Login (admin1)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 8.1 | On the home page, click **Login** | Redirected to Keycloak login page |
| 8.2 | Enter username: `admin1`, password: `admin1` | Credentials accepted |
| 8.3 | Click **Sign In** | Redirected back to app |
| 8.4 | Check the navbar | Shows ALL links: Home, Dashboard, Profile, Products, **Admin Panel**, **Users**, **Settings**, Logout |

---

## 9. Test Admin Page Access

| Step | Action | Expected Result |
|------|--------|-----------------|
| 9.1 | Click **Dashboard** | Dashboard page with user info |
| 9.2 | Click **Profile** | Profile page, roles should include `admin` |
| 9.3 | Click **Products** | Products listing |
| 9.4 | Click **Admin Panel** | Admin panel with system stats (total users, products, orders, revenue) |
| 9.5 | Click **Users** | User management table showing `user1` and `admin1` |
| 9.6 | Click **Settings** | Settings page with application config |

---

## 10. Test API Endpoints Directly

### Health Check (Public)
```bash
curl -sk https://myecom.net:5500/api/health
```
Expected: `{"status":"ok"}`

### Without Token (Should Fail)
```bash
curl -sk https://myecom.net:5500/api/user/profile
```
Expected: `401` response

### Get a User Token
```bash
TOKEN=$(curl -sk -X POST https://idp.keycloak.net:8443/realms/myecom/protocol/openid-connect/token \
  -d "grant_type=password" \
  -d "client_id=myecom-spa" \
  -d "username=user1" \
  -d "password=user1" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

### User Endpoints (user1 token)
```bash
# Should succeed (200)
curl -sk -H "Authorization: Bearer $TOKEN" https://myecom.net:5500/api/user/profile
curl -sk -H "Authorization: Bearer $TOKEN" https://myecom.net:5500/api/user/products
curl -sk -H "Authorization: Bearer $TOKEN" https://myecom.net:5500/api/user/orders

# Should fail (403 - Forbidden)
curl -sk -w "\nHTTP %{http_code}" -H "Authorization: Bearer $TOKEN" https://myecom.net:5500/api/admin/users
curl -sk -w "\nHTTP %{http_code}" -H "Authorization: Bearer $TOKEN" https://myecom.net:5500/api/admin/stats
```

### Get an Admin Token
```bash
ADMIN_TOKEN=$(curl -sk -X POST https://idp.keycloak.net:8443/realms/myecom/protocol/openid-connect/token \
  -d "grant_type=password" \
  -d "client_id=myecom-spa" \
  -d "username=admin1" \
  -d "password=admin1" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

### Admin Endpoints (admin1 token)
```bash
# Should all succeed (200)
curl -sk -H "Authorization: Bearer $ADMIN_TOKEN" https://myecom.net:5500/api/admin/users
curl -sk -H "Authorization: Bearer $ADMIN_TOKEN" https://myecom.net:5500/api/admin/stats
curl -sk -H "Authorization: Bearer $ADMIN_TOKEN" https://myecom.net:5500/api/admin/settings
```

---

## 11. Test Keycloak Admin Console

| Step | Action | Expected Result |
|------|--------|-----------------|
| 11.1 | Open `https://idp.keycloak.net:8443` | Keycloak welcome page |
| 11.2 | Click **Administration Console** | Login page |
| 11.3 | Login with `admin` / `admin` | Keycloak admin dashboard |
| 11.4 | Select realm **myecom** (top-left dropdown) | Realm settings load |
| 11.5 | Go to **Users** | Should see `user1` and `admin1` |
| 11.6 | Go to **Realm roles** | Should see `admin` and `user` roles |
| 11.7 | Go to **Clients** → **myecom-spa** | Client config with PKCE S256, redirect URIs |

---

## 12. Run Automated E2E Tests

```bash
# From project root
cd e2e
npm install
npx playwright install chromium
npx playwright test

# Or use the scripts
./run.sh --test          # Docker Compose
./deploy-k8s.sh --test   # Kind Kubernetes
```

All 12 tests should pass covering authentication flow, user role access, and admin role access.

---

## Access Matrix Summary

| Route | Public | user1 | admin1 |
|-------|--------|-------|--------|
| `/` (Home) | Yes | Yes | Yes |
| `/dashboard` | No → Login | Yes | Yes |
| `/profile` | No → Login | Yes | Yes |
| `/products` | No → Login | Yes | Yes |
| `/admin-panel` | No → Login | Access Denied | Yes |
| `/user-management` | No → Login | Access Denied | Yes |
| `/settings` | No → Login | Access Denied | Yes |
| `/unauthorized` | Yes | Yes | Yes |

| API Endpoint | No Token | user1 | admin1 |
|-------------|----------|-------|--------|
| `GET /api/health` | 200 | 200 | 200 |
| `GET /api/user/*` | 401 | 200 | 200 |
| `GET /api/admin/*` | 401 | 403 | 200 |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Login redirects but page stays blank | Accept the self-signed cert for `idp.keycloak.net:8443` in your browser first |
| "Access Denied" immediately after login | Clear browser storage (localStorage, sessionStorage) and try again |
| API returns 401 with valid token | The JWKS cache may be stale; restart the API container |
| Port 5500 already in use | macOS AirPlay uses port 5000; check `lsof -i :5500` and stop the conflicting process |
| Kind cluster port conflict | Run `kind delete cluster --name k8s-angular` and `docker compose down` before deploying |
