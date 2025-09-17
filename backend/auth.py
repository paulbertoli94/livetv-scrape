# backend/auth.py
import os, hmac, hashlib
from functools import wraps
from flask import request, jsonify, g

SECRET = os.environ.get("AUTH_SECRET", "dev-secret-change-me").encode()

def sign_uid(uid: str) -> str:
    return hmac.new(SECRET, uid.encode(), hashlib.sha256).hexdigest()

def verify(uid: str, sig: str) -> bool:
    return hmac.compare_digest(sign_uid(uid), sig)

def require_auth_lite(fn):
    @wraps(fn)
    def wrapper(*a, **k):
        uid = request.headers.get("X-Auth-Uid", "")
        sig = request.headers.get("X-Auth-Sig", "")
        if not uid or not sig or not verify(uid, sig):
            return jsonify({"detail": "Auth failed"}), 401
        g.user_id = uid
        return fn(*a, **k)
    return wrapper
