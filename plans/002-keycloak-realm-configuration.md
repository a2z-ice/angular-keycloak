# Plan 002: Keycloak Realm Configuration

## Objective
Configure Keycloak with realm, client, roles, and users via a realm export JSON.

## Realm: `myecom`

### Client: `myecom-spa`
- Client Protocol: openid-connect
- Access Type: public (SPA — no client secret)
- Standard Flow Enabled: true (Authorization Code)
- PKCE: S256 enforced
- Valid Redirect URIs: `http://myecom.net:5000/*`
- Web Origins: `http://myecom.net:5000`
- Post Logout Redirect URIs: `http://myecom.net:5000/*`

### Realm Roles
- `admin` — Full access to all routes
- `user` — Limited access (dashboard, profile, products)

### Users
1. **user1** / password: `user1`
   - Roles: `user`
   - Email: user1@myecom.net
2. **admin1** / password: `admin1`
   - Roles: `admin`
   - Email: admin1@myecom.net

## Files Created
- `keycloak/realm-export.json`

## Success Criteria
- Users can authenticate via OIDC Code+PKCE flow
- Access tokens contain realm roles in `realm_access.roles`
