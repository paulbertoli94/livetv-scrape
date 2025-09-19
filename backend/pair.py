# backend/pair.py
import logging
from secrets import token_hex, randbelow

from flask import Blueprint, request, jsonify, g

from auth import require_auth_lite
from db import (
    db_session, save_pairing_code, consume_pairing_code,
    upsert_user_and_device, ensure_device, set_fcm_token
)
from fcm import send_to_token

tv_bp = Blueprint("tv", __name__)

PAIR_TTL = 180


@tv_bp.post("/tv/token")
def tv_token():
    """
    La TV invia il proprio FCM token.
    Auth: header X-Device-Id / X-Device-Key
    Body: { "token": "<fcm_token>" }
    """
    dev_id = (request.headers.get("X-Device-Id") or "").strip()
    dev_key = (request.headers.get("X-Device-Key") or "").strip()
    token = (request.json or {}).get("token", "").strip()
    if not dev_id or not dev_key or not token:
        return jsonify({"detail": "Auth o token mancanti"}), 400

    from db import Device
    with db_session() as s:
        d = s.get(Device, dev_id)
        if not d or not d.secret_key or d.secret_key != dev_key:
            return jsonify({"detail": "Device auth failed"}), 401
        set_fcm_token(s, dev_id, token)
        d2 = s.get(Device, dev_id)
        ok_saved = bool(d2 and d2.fcm_token)
        logging.log(logging.INFO, f"ok_saved: {d2.fcm_token} with devicId: {dev_id}")
        return jsonify({"ok": ok_saved, "savedTokenLen": len(d2.fcm_token) if ok_saved else 0})


@tv_bp.post("/tv/send")
@require_auth_lite
def tv_send():
    data = request.get_json(silent=True) or {}
    device_id = (data.get("deviceId") or "").strip()
    action = (data.get("action") or "").strip()
    cid = data.get("cid")
    url = data.get("url")

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
        logging.log(logging.INFO, f"search deviceId: {device_id}")
        d = s.get(Device, device_id)
        if not d or d.user_id != g.user_id:
            return jsonify({"detail": "Questa TV non è tua"}), 403
        # 🔔 INVIO FCM (data-only)
        logging.log(logging.INFO, f"device fcmToken: {d.fcm_token}")
        if d.fcm_token:
            payload = {"action": action}
            if cid: payload["cid"] = cid
            if url: payload["url"] = url
            try:
                send_to_token(d.fcm_token, payload)
                return jsonify({"ok": True, "via": "fcm"})
            except Exception as e:
                return jsonify({"ok": True, "via": "inbox", "note": "FCM fallito"}), 202
        return jsonify({"ok": True, "via": "inbox"})


@tv_bp.post("/tv/register")
def tv_register():
    device_id = token_hex(8)
    device_key = token_hex(32)
    code = f"{randbelow(10 ** 6):06d}"
    with db_session() as s:
        ensure_device(s, device_id, secret_key=device_key)
        save_pairing_code(s, code, device_id, ttl_seconds=PAIR_TTL)
        return jsonify({"deviceId": device_id, "deviceKey": device_key, "pairCode": code, "expiresIn": PAIR_TTL})


@tv_bp.post("/tv/code")
def tv_code():
    device_id = (request.headers.get("X-Device-Id") or "").strip()
    device_key = (request.headers.get("X-Device-Key") or "").strip()
    code = f"{randbelow(10 ** 6):06d}"
    if not device_id or not device_key:
        return jsonify({"detail": "Auth o token mancanti"}), 400

    from db import Device
    with db_session() as s:
        d = s.get(Device, device_id)
        if not d or not d.secret_key or d.secret_key != device_key:
            return jsonify({"detail": "Device auth failed"}), 401
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
