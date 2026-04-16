# Plan 004: Playwright E2E Tests

## Objective
Write comprehensive E2E tests verifying authentication and authorization flows.

## Test Suites

### 1. Authentication Flow
- Unauthenticated user visiting protected route gets redirected to Keycloak login
- user1 can log in with correct credentials
- admin1 can log in with correct credentials
- After login, user is redirected back to the app
- Logout clears session and redirects to home

### 2. User Role Authorization
- user1 can access: /dashboard, /profile, /products
- user1 CANNOT access: /admin-panel, /user-management, /settings
- user1 attempting admin routes sees unauthorized page

### 3. Admin Role Authorization
- admin1 can access ALL protected routes
- admin1 can access: /admin-panel, /user-management, /settings

### 4. Navigation
- Nav bar shows correct links based on role
- Admin sees admin menu items, user does not

## Test Infrastructure
- Playwright config pointing at `http://myecom.net:5000`
- Helper function for Keycloak login (fill username/password on KC form)
- Tests run against Docker-deployed services

## Files Created
- `e2e/playwright.config.ts`
- `e2e/tests/auth.spec.ts`
- `e2e/tests/user-access.spec.ts`
- `e2e/tests/admin-access.spec.ts`
- `e2e/helpers/login.ts`

## Success Criteria
- All tests pass against running Docker services
