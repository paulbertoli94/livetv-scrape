# backend/pair.py
from flask import Blueprint, request, jsonify, g
from secrets import token_hex, randbelow
from auth import require_auth_lite
from db import (
    db_session, save_pairing_code, consume_pairing_code,
    upsert_user_and_device, ensure_device, put_inbox, pop_inbox
)

tv_bp = Blueprint("tv", __name__)

PAIR_TTL  = 180
INBOX_TTL = 300

@tv_bp.post("/tv/register")
def tv_register():
    device_id  = token_hex(8)
    device_key = token_hex(32)
    code       = f"{randbelow(10**6):06d}"
    with db_session() as s:
        ensure_device(s, device_id, secret_key=device_key)
        save_pairing_code(s, code, device_id, ttl_seconds=PAIR_TTL)
    return jsonify({"deviceId": device_id, "deviceKey": device_key, "pairCode": code, "expiresIn": PAIR_TTL})

@tv_bp.post("/tv/pair")
@require_auth_lite
def tv_pair():
    data = request.get_json(silent=True) or {}
    pair_code = (data.get("pairCode") or "").strip()
    if not pair_code:
        return jsonify({"detail": "pairCode richiesto"}), 400
    with db_session() as s:
        device_id = consume_pairing_code(s, pair_code)
        if not device_id:
            return jsonify({"detail": "Codice non valido o scaduto"}), 400
        upsert_user_and_device(s, g.user_id, device_id)
    return jsonify({"ok": True, "deviceId": device_id})

@tv_bp.post("/tv/send")
@require_auth_lite
def tv_send():
    data      = request.get_json(silent=True) or {}
    device_id = (data.get("deviceId") or "").strip()
    action    = (data.get("action") or "").strip()
    cid       = data.get("cid")
    url       = data.get("url")

    if not device_id:
        return jsonify({"detail": "deviceId mancante"}), 400
    if action == "acestream" and not cid:
        return jsonify({"detail": "CID mancante"}), 400
    if action == "playUrl" and not url:
        return jsonify({"detail": "URL mancante"}), 400
    if action not in ("acestream", "playUrl"):
        return jsonify({"detail": "Azione non supportata"}), 400

    from db import Device
    with db_session() as s:
        d = s.get(Device, device_id)
        if not d or d.user_id != g.user_id:
            return jsonify({"detail": "Questa TV non è tua"}), 403
        put_inbox(s, device_id, action, cid, url, ttl_seconds=INBOX_TTL)
    return jsonify({"ok": True})

@tv_bp.get("/tv/inbox")
def tv_inbox():
    # resta uguale: TV usa X-Device-Id / X-Device-Key
    device_id_q = (request.args.get("deviceId") or "").strip()
    dev_id_h  = (request.headers.get("X-Device-Id") or "").strip()
    dev_key_h = (request.headers.get("X-Device-Key") or "").strip()
    if not device_id_q or dev_id_h != device_id_q:
        return jsonify({"detail": "deviceId mancante o mismatch"}), 401
    from db import Device
    with db_session() as s:
        d = s.get(Device, dev_id_h)
        if not d or not d.secret_key or d.secret_key != dev_key_h:
            return jsonify({"detail": "Device auth failed"}), 401
        msg = pop_inbox(s, device_id_q)
        return jsonify(msg or {})