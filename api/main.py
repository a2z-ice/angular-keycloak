from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
import httpx
import logging

app = FastAPI(title="MyEcom API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://myecom.net:5500"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()

KEYCLOAK_URL = "http://keycloak:8080"
REALM = "myecom"
JWKS_URL = f"{KEYCLOAK_URL}/realms/{REALM}/protocol/openid-connect/certs"
ISSUER = f"https://idp.keycloak.net:8443/realms/{REALM}"

logger = logging.getLogger(__name__)

_jwks_cache: dict | None = None


async def get_jwks() -> dict:
    global _jwks_cache
    if _jwks_cache is None:
        async with httpx.AsyncClient() as client:
            resp = await client.get(JWKS_URL)
            resp.raise_for_status()
            _jwks_cache = resp.json()
    return _jwks_cache


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    token = credentials.credentials
    try:
        jwks = await get_jwks()
        unverified_header = jwt.get_unverified_header(token)
        key = None
        for k in jwks["keys"]:
            if k["kid"] == unverified_header["kid"]:
                key = k
                break
        if key is None:
            raise HTTPException(status_code=401, detail="Invalid token key")

        payload = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience="account",
            issuer=ISSUER,
        )
        return payload
    except JWTError as e:
        logger.error(f"JWT validation error: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")


def require_role(role: str):
    async def role_checker(user: dict = Depends(get_current_user)) -> dict:
        roles = user.get("realm_access", {}).get("roles", [])
        if role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{role}' required",
            )
        return user
    return role_checker


# --- User endpoints (accessible by both user and admin) ---

@app.get("/api/user/profile")
async def get_profile(user: dict = Depends(get_current_user)):
    return {
        "username": user.get("preferred_username"),
        "email": user.get("email"),
        "name": user.get("name"),
        "roles": user.get("realm_access", {}).get("roles", []),
    }


@app.get("/api/user/products")
async def get_products(user: dict = Depends(get_current_user)):
    return [
        {"id": 1, "name": "Laptop Pro", "price": 1299.99, "category": "Electronics"},
        {"id": 2, "name": "Wireless Mouse", "price": 49.99, "category": "Accessories"},
        {"id": 3, "name": "Mechanical Keyboard", "price": 129.99, "category": "Accessories"},
        {"id": 4, "name": "Monitor 4K", "price": 599.99, "category": "Electronics"},
    ]


@app.get("/api/user/orders")
async def get_orders(user: dict = Depends(get_current_user)):
    return [
        {"id": 101, "product": "Laptop Pro", "status": "Delivered", "total": 1299.99},
        {"id": 102, "product": "Wireless Mouse", "status": "Shipped", "total": 49.99},
    ]


# --- Admin endpoints (accessible only by admin) ---

@app.get("/api/admin/users")
async def get_all_users(user: dict = Depends(require_role("admin"))):
    return [
        {"username": "user1", "email": "user1@myecom.net", "role": "user", "active": True},
        {"username": "admin1", "email": "admin1@myecom.net", "role": "admin", "active": True},
    ]


@app.get("/api/admin/stats")
async def get_stats(user: dict = Depends(require_role("admin"))):
    return {
        "total_users": 2,
        "total_products": 4,
        "total_orders": 2,
        "revenue": 1349.98,
    }


@app.get("/api/admin/settings")
async def get_settings(user: dict = Depends(require_role("admin"))):
    return {
        "site_name": "MyEcom",
        "maintenance_mode": False,
        "max_products_per_page": 20,
        "currency": "USD",
    }


@app.get("/api/health")
async def health():
    return {"status": "ok"}
