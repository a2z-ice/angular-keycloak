# Plan 006: Python FastAPI Backend

## Objective
Add a Python FastAPI backend that validates JWT tokens from Keycloak and provides
separate API endpoints for user and admin roles.

## Architecture
- FastAPI app with JWT token validation against Keycloak JWKS endpoint
- Role-based endpoint protection using dependency injection
- CORS configured for Angular frontend

## Endpoints

### User Endpoints (user + admin access)
| Method | Path               | Description          |
|--------|--------------------|----------------------|
| GET    | /api/user/profile  | Current user profile |
| GET    | /api/user/products | Product listing      |
| GET    | /api/user/orders   | User's orders        |

### Admin Endpoints (admin only)
| Method | Path               | Description          |
|--------|--------------------|----------------------|
| GET    | /api/admin/users   | All users list       |
| GET    | /api/admin/stats   | System statistics    |
| GET    | /api/admin/settings| App settings         |

### Public
| Method | Path        | Description    |
|--------|-------------|----------------|
| GET    | /api/health | Health check   |

## Docker
- Runs as `api` service on port 8000
- Accessible at `http://api.service.net:8000`

## Success Criteria
- JWT tokens from Keycloak are validated correctly
- User endpoints reject unauthenticated requests (401)
- Admin endpoints reject user-role requests (403)
- Angular frontend can call API with Bearer token
