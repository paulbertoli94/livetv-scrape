# backend/fcm.py
import os, time, requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request

FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "acetvpair")
SCOPES = ["https://www.googleapis.com/auth/firebase.messaging"]
_FCM_TOKEN_CACHE = {"exp": 0, "token": None}

def _get_access_token():
    now = time.time()
    if _FCM_TOKEN_CACHE["token"] and now < _FCM_TOKEN_CACHE["exp"] - 60:
        return _FCM_TOKEN_CACHE["token"]
    creds = service_account.Credentials.from_service_account_file(
        os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "./service-account.json"), scopes=SCOPES
    )
    creds.refresh(Request())
    _FCM_TOKEN_CACHE["token"] = creds.token
    _FCM_TOKEN_CACHE["exp"] = now + int(creds.expiry.timestamp() - now)
    return _FCM_TOKEN_CACHE["token"]

def send_to_token(token: str, data: dict):
    """
    data: solo stringhe! (FCM data message)
    """
    url = f"https://fcm.googleapis.com/v1/projects/{FIREBASE_PROJECT_ID}/messages:send"
    body = {
        "message": {
            "token": token,
            "android": {"priority": "HIGH"},
            "data": {k: str(v) for k, v in data.items()},
        }
    }
    headers = {"Authorization": f"Bearer {_get_access_token()}"}
    r = requests.post(url, json=body, headers=headers, timeout=10)
    if r.status_code >= 300:
        raise RuntimeError(f"FCM error {r.status_code}: {r.text}")
    return r.json()
