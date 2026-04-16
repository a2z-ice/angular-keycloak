from flask import Flask, jsonify, request, g
from functools import wraps
from jose import jwt, JWTError
import requests
import logging

app = Flask(__name__)

KEYCLOAK_URL = "http://keycloak:8080"
REALM = "myecom"
JWKS_URL = f"{KEYCLOAK_URL}/realms/{REALM}/protocol/openid-connect/certs"
ISSUER = f"https://idp.keycloak.net:8443/realms/{REALM}"

logger = logging.getLogger(__name__)

_jwks_cache = None


def get_jwks():
    global _jwks_cache
    if _jwks_cache is None:
        resp = requests.get(JWKS_URL)
        resp.raise_for_status()
        _jwks_cache = resp.json()
    return _jwks_cache


def get_current_user():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None

    token = auth_header[7:]
    try:
        jwks = get_jwks()
        unverified_header = jwt.get_unverified_header(token)
        key = None
        for k in jwks["keys"]:
            if k["kid"] == unverified_header["kid"]:
                key = k
                break
        if key is None:
            return None

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
        return None


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user = get_current_user()
        if user is None:
            return jsonify({"detail": "Invalid token"}), 401
        g.user = user
        return f(*args, **kwargs)
    return decorated


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


# --- User endpoints (accessible by both user and admin) ---

@app.get("/api/user/profile")
@require_auth
def get_profile():
    user = g.user
    return jsonify({
        "username": user.get("preferred_username"),
        "email": user.get("email"),
        "name": user.get("name"),
        "roles": user.get("realm_access", {}).get("roles", []),
    })


@app.get("/api/user/products")
@require_auth
def get_products():
    return jsonify([
        {"id": 1, "name": "Laptop Pro", "price": 1299.99, "category": "Electronics"},
        {"id": 2, "name": "Wireless Mouse", "price": 49.99, "category": "Accessories"},
        {"id": 3, "name": "Mechanical Keyboard", "price": 129.99, "category": "Accessories"},
        {"id": 4, "name": "Monitor 4K", "price": 599.99, "category": "Electronics"},
    ])


@app.get("/api/user/orders")
@require_auth
def get_orders():
    return jsonify([
        {"id": 101, "product": "Laptop Pro", "status": "Delivered", "total": 1299.99},
        {"id": 102, "product": "Wireless Mouse", "status": "Shipped", "total": 49.99},
    ])


# --- Admin endpoints (accessible only by admin) ---

@app.get("/api/admin/users")
@require_role("admin")
def get_all_users():
    return jsonify([
        {"username": "user1", "email": "user1@myecom.net", "role": "user", "active": True},
        {"username": "admin1", "email": "admin1@myecom.net", "role": "admin", "active": True},
    ])


@app.get("/api/admin/stats")
@require_role("admin")
def get_stats():
    return jsonify({
        "total_users": 2,
        "total_products": 4,
        "total_orders": 2,
        "revenue": 1349.98,
    })


@app.get("/api/admin/settings")
@require_role("admin")
def get_settings():
    return jsonify({
        "site_name": "MyEcom",
        "maintenance_mode": False,
        "max_products_per_page": 20,
        "currency": "USD",
    })


@app.get("/api/health")
def health():
    return jsonify({"status": "ok"})
