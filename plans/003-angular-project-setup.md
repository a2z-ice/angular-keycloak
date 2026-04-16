# Plan 003: Angular 20 Project Setup

## Objective
Scaffold Angular 20 project with OIDC authentication using angular-auth-oidc-client.

## Auth Library
- `angular-auth-oidc-client` — mature, well-maintained OIDC library for Angular
- Configured for Authorization Code + PKCE flow

## Project Structure
```
src/
├── app/
│   ├── app.component.ts          # Root with nav bar
│   ├── app.config.ts             # Standalone app config
│   ├── app.routes.ts             # Route definitions with guards
│   ├── auth/
│   │   ├── auth.config.ts        # OIDC configuration
│   │   ├── auth.guard.ts         # Authentication guard
│   │   └── role.guard.ts         # Role-based authorization guard
│   ├── interceptors/
│   │   └── auth.interceptor.ts   # Attach Bearer token to API calls
│   ├── pages/
│   │   ├── home/                 # Public — accessible by all
│   │   ├── dashboard/            # Protected — user + admin
│   │   ├── profile/              # Protected — user + admin
│   │   ├── products/             # Protected — user + admin
│   │   ├── admin-panel/          # Protected — admin only
│   │   ├── user-management/      # Protected — admin only
│   │   ├── settings/             # Protected — admin only
│   │   ├── unauthorized/         # Shown when role check fails
│   │   └── callback/             # OIDC callback handler
│   └── services/
│       └── auth.service.ts       # Auth helper service
```

## Routes & Access Matrix
| Route              | Public | User | Admin |
|--------------------|--------|------|-------|
| /                  | ✅     | ✅   | ✅    |
| /dashboard         | ❌     | ✅   | ✅    |
| /profile           | ❌     | ✅   | ✅    |
| /products          | ❌     | ✅   | ✅    |
| /admin-panel       | ❌     | ❌   | ✅    |
| /user-management   | ❌     | ❌   | ✅    |
| /settings          | ❌     | ❌   | ✅    |
| /unauthorized      | ✅     | ✅   | ✅    |

## Key Features
- Auto-redirect to Keycloak login if unauthenticated
- Role extracted from access token `realm_access.roles`
- Navigation bar shows/hides links based on role
- Logout via Keycloak end-session endpoint

## Success Criteria
- `ng build` succeeds
- Auth flow redirects to Keycloak and back
- Role-based guards block/allow correctly
