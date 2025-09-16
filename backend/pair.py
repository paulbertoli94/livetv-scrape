# backend/pair.py
from pathlib import Path
from flask import Blueprint, request, jsonify
from secrets import token_hex, randbelow
import json, time, os

# ---- Storage semplice su file (per mesi) ----
BASE_DIR = Path(__file__).resolve().parent
STORE_FILE = BASE_DIR / "store.json"

def _load():
    if not STORE_FILE.exists():
        return {"pair_codes": {}, "owners": {}, "device_keys": {}, "inbox": {}}
    return json.loads(STORE_FILE.read_text())

def _save(db): STORE_FILE.write_text(json.dumps(db))

db = _load()
def now(): return int(time.time())

# TTL e scadenze
PAIR_TTL  = 180   # codice pairing valido 3 min
INBOX_TTL = 300   # messaggi TV validi 5 min

# ---- Blueprint ----
tv_bp = Blueprint("tv", __name__)

@tv_bp.post("/tv/register")
def tv_register():
    """La TV chiama: riceve deviceId/deviceKey permanenti e pairCode temporaneo."""
    device_id  = token_hex(8)
    device_key = token_hex(32)
    code       = f"{randbelow(10**6):06d}"

    db["pair_codes"][code]    = {"deviceId": device_id, "exp": now() + PAIR_TTL}
    db["device_keys"][device_id] = device_key
    _save(db)

    return jsonify({
        "deviceId": device_id,
        "deviceKey": device_key,
        "pairCode": code,
        "expiresIn": PAIR_TTL
    })

@tv_bp.post("/tv/pair")
def tv_pair():
    """Il sito inserisce il pairCode: leghiamo la TV all'utente (userId)."""
    data = request.get_json(silent=True) or {}
    pair_code = (data.get("pairCode") or "").strip()
    user_id   = (data.get("userId") or "").strip()
    if not pair_code or not user_id:
        return jsonify({"detail": "pairCode e userId richiesti"}), 400

    rec = db["pair_codes"].get(pair_code)
    if not rec or rec["exp"] < now():
        return jsonify({"detail": "Codice non valido o scaduto"}), 400

    device_id = rec["deviceId"]
    db["owners"][device_id] = user_id     # legame PERSISTENTE
    db["pair_codes"].pop(pair_code, None)
    _save(db)

    return jsonify({"ok": True, "deviceId": device_id})

@tv_bp.post("/tv/send")
def tv_send():
    """
    Il sito invia un comando alla propria TV.
    (Per demo, userId arriva in query ?userId=..., in prod usa auth vera.)
    """
    user_id  = (request.args.get("userId") or "").strip()
    data     = request.get_json(silent=True) or {}
    device_id = data.get("deviceId")
    action    = data.get("action")      # "acestream" | "playUrl"
    cid       = data.get("cid")
    url       = data.get("url")

    if not user_id:
        return jsonify({"detail": "User non autenticato"}), 401
    if db["owners"].get(device_id) != user_id:
        return jsonify({"detail": "Questa TV non è tua"}), 403
    if action == "acestream" and not cid:
        return jsonify({"detail": "CID mancante"}), 400
    if action == "playUrl"   and not url:
        return jsonify({"detail": "URL mancante"}), 400

    db["inbox"][device_id] = {"action": action, "cid": cid, "url": url, "exp": now() + INBOX_TTL}
    _save(db)
    return jsonify({"ok": True})

@tv_bp.get("/tv/inbox")
def tv_inbox():
    """
    La TV legge l'ultimo comando e lo consuma.
    Autenticazione con header X-Device-Id / X-Device-Key + query ?deviceId=...
    """
    device_id_q = (request.args.get("deviceId") or "").strip()
    dev_id_h  = request.headers.get("X-Device-Id", "")
    dev_key_h = request.headers.get("X-Device-Key", "")

    if not device_id_q or dev_id_h != device_id_q:
        return jsonify({"detail": "deviceId mancante o mismatch"}), 401
    if db["device_keys"].get(dev_id_h) != dev_key_h:
        return jsonify({"detail": "Device auth failed"}), 401

    msg = db["inbox"].get(device_id_q)
    if not msg or msg["exp"] < now():
        db["inbox"].pop(device_id_q, None); _save(db)
        return jsonify({})

    db["inbox"].pop(device_id_q, None); _save(db)
    return jsonify({"action": msg["action"], "cid": msg.get("cid"), "url": msg.get("url")})
