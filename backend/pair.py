# backend/pair.py
import logging
import threading
import time
from secrets import token_hex, randbelow  # già importato

from flask import Blueprint, request, jsonify, g

from auth import require_auth_lite
from db import (
    db_session, save_pairing_code, consume_pairing_code,
    ensure_device, set_fcm_token, link_user_device, user_has_access, list_users_for_device, unlink_user_device
)
from fcm import send_to_token

tv_bp = Blueprint("tv", __name__)

PAIR_TTL = 180

_PENDING = {}
_PENDING_LOCK = threading.Lock()


def _put_pending(cmd_id, device_id):
    with _PENDING_LOCK:
        _PENDING[cmd_id] = {"device_id": device_id, "ack": False, "ts": time.time()}
        # GC semplice (2 minuti)
        cutoff = time.time() - 120
        for k, v in list(_PENDING.items()):
            if v["ts"] < cutoff:
                _PENDING.pop(k, None)


def _mark_ack(cmd_id, device_id=None):
    with _PENDING_LOCK:
        info = _PENDING.get(cmd_id)
        if not info:
            return False
        if device_id and info["device_id"] != device_id:
            return False
        info["ack"] = True
        info["ts_ack"] = time.time()
        return True


def _is_acked(cmd_id):
    with _PENDING_LOCK:
        return bool(_PENDING.get(cmd_id, {}).get("ack"))


def _require_device_auth():
    dev_id = (request.headers.get("X-Device-Id") or "").strip()
    dev_key = (request.headers.get("X-Device-Key") or "").strip()
    if not dev_id or not dev_key:
        return None, (jsonify({"detail": "Auth o token mancanti"}), 400)
    from db import Device
    with db_session() as s:
        d = s.get(Device, dev_id)
        if not d or not d.secret_key or d.secret_key != dev_key:
            return None, (jsonify({"detail": "Device auth failed"}), 401)
    return dev_id, None


@tv_bp.post("/tv/token")
def tv_token():
    """
    La TV invia il proprio FCM token.
    Auth: header X-Device-Id / X-Device-Key
    Body: { "token": "<fcm_token>" }
    """
    dev_id, err = _require_device_auth()
    if err:
        return err
    token = (request.json or {}).get("token", "").strip()
    if not token:
        return jsonify({"detail": "token mancante"}), 400

    from db import Device
    with db_session() as s:
        set_fcm_token(s, dev_id, token)
        d2 = s.get(Device, dev_id)
        ok_saved = bool(d2 and d2.fcm_token)
        logging.info(f"ok_saved: {d2.fcm_token} with deviceId: {dev_id}")
        return jsonify({"ok": ok_saved, "savedTokenLen": len(d2.fcm_token) if ok_saved else 0})


@tv_bp.post("/tv/send")
@require_auth_lite
def tv_send():
    """
    Invia un comando alla TV via FCM e attende brevemente un ACK.
    Risposte:
      - 200 {"status":"delivered","cmdId": "..."}        → consegnato e ack ricevuto
      - 202 {"status":"queued_no_ack","cmdId":"..."}      → inviato ma nessun ack rapido
      - 202 {"status":"deferred_no_token"}                → device senza token FCM
      - 202 {"status":"deferred_fcm_fail"}                → invio a FCM fallito
      - 403 {"detail":"Questa TV non è tra i tuoi dispositivi"}
      - 404 {"detail":"Device inesistente"}
    """
    import time

    data = request.get_json(silent=True) or {}
    device_id = (data.get("deviceId") or "").strip()
    action = (data.get("action") or "").strip()
    cid = data.get("cid") or None
    url = data.get("url") or None

    # Validazioni base
    if not device_id:
        return jsonify({"detail": "deviceId mancante"}), 400
    if action not in ("acestream", "playUrl"):
        return jsonify({"detail": "Azione non supportata"}), 400
    if action == "acestream" and not cid:
        return jsonify({"detail": "CID mancante"}), 400
    if action == "playUrl" and not url:
        return jsonify({"detail": "URL mancante"}), 400

    # Limiti lunghezze (difensivo)
    MAX_URL_LEN = 1024
    MAX_CID_LEN = 256
    if cid and len(str(cid)) > MAX_CID_LEN:
        return jsonify({"detail": "CID troppo lungo"}), 400
    if url and len(str(url)) > MAX_URL_LEN:
        return jsonify({"detail": "URL troppo lungo"}), 400

    from db import Device
    with db_session() as s:
        logging.info(f"[tv_send] device={device_id} user={g.user_id} action={action}")
        d = s.get(Device, device_id)
        if not d:
            return jsonify({"detail": "Device inesistente"}), 404

        # Autorizzazione: user deve essere collegato al device
        if not user_has_access(s, g.user_id, device_id):
            logging.info(f"[tv_send] access denied for user={g.user_id} on device={device_id}")
            return jsonify({"detail": "Questa TV non è tra i tuoi dispositivi"}), 403

        # Nessun token FCM salvato → il FE può tentare il wake via Cast e poi ritentare
        if not d.fcm_token:
            logging.info(f"[tv_send] no FCM token for device={device_id}")
            return jsonify({"detail": "No FCM token for device"}), 403

        # Prepara comando + tracking ACK
        cmd_id = token_hex(8)
        _put_pending(cmd_id, device_id)

        payload = {"action": action, "cmdId": cmd_id}
        if action == "acestream":
            payload["cid"] = cid
        elif action == "playUrl":
            payload["url"] = url

        # Invio FCM
        try:
            send_to_token(d.fcm_token, payload)
        except Exception:
            logging.exception("[tv_send] FCM send error")
            # pulizia best-effort
            with _PENDING_LOCK:
                _PENDING.pop(cmd_id, None)
            return jsonify({"status": "deferred_fcm_fail"}), 202

        # Attendi breve ACK (~1.5s)
        deadline = time.time() + 1.5
        while time.time() < deadline:
            if _is_acked(cmd_id):
                with _PENDING_LOCK:
                    _PENDING.pop(cmd_id, None)
                return jsonify({"status": "delivered", "cmdId": cmd_id}), 200
            time.sleep(0.05)

        # Nessun ACK rapido → lascia al FE il fallback (Cast + retry)
        return jsonify({"status": "queued_no_ack", "cmdId": cmd_id}), 202


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
    """
    La TV richiede un nuovo pairing code.
    Auth: header X-Device-Id / X-Device-Key
    Ritorna: { deviceId, deviceKey, pairCode, expiresIn }
    """
    dev_id, err = _require_device_auth()
    if err:
        return err

    code = f"{randbelow(10 ** 6):06d}"

    from db import Device
    with db_session() as s:
        # ensure_device non cambia la secret, serve solo a toccare last_seen
        d = s.get(Device, dev_id)
        ensure_device(s, dev_id, secret_key=d.secret_key if d else None)

        save_pairing_code(s, code, dev_id, ttl_seconds=PAIR_TTL)

        logging.info(f"[tv_code] generated code for device {dev_id}: {code}")
        return jsonify({
            "deviceId": dev_id,
            "deviceKey": d.secret_key if d else None,
            "pairCode": code,
            "expiresIn": PAIR_TTL
        })


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
        link_user_device(s, g.user_id, device_id)
        return jsonify({"ok": True, "deviceId": device_id})


@tv_bp.get("/tv/status")
@require_auth_lite
def tv_status():
    device_id = (request.args.get("deviceId") or "").strip()
    if not device_id:
        return jsonify({"detail": "deviceId mancante"}), 400
    from db import Device
    with db_session() as s:
        d = s.get(Device, device_id)
        if not d:
            return jsonify({"detail": "Device inesistente"}), 404
        if not user_has_access(s, g.user_id, device_id):
            return jsonify({"detail": "Questa TV non è tra i tuoi dispositivi"}), 403
        # now = datetime.utcnow()
        # delta = (now - (d.last_seen or now)).total_seconds()
        # ONLINE_WINDOW = 180  # sec
        return jsonify({
            "deviceId": d.id,
            "paired": True,
            # "status": "online" if delta < ONLINE_WINDOW else "idle",
            "hasFcmToken": bool(d.fcm_token),
            "lastSeen": d.last_seen.isoformat() if d.last_seen else None,
        })


@tv_bp.get("/tv/linked-users")
def tv_linked_users():
    dev_id, err = _require_device_auth()
    if err: return err
    with db_session() as s:
        users = list_users_for_device(s, dev_id)
        return jsonify({"deviceId": dev_id, "count": len(users), "users": users})


@tv_bp.delete("/tv/linked-users/<user_id>")
def tv_unlink_user(user_id):
    dev_id, err = _require_device_auth()
    if err: return err
    with db_session() as s:
        ok = unlink_user_device(s, user_id, dev_id)
        return jsonify({"ok": ok, "deviceId": dev_id, "userId": user_id})


@tv_bp.post("/tv/ack")
def tv_ack():
    # la TV si autentica con X-Device-Id / X-Device-Key
    dev_id, err = _require_device_auth()
    if err:
        return err
    data = request.get_json(silent=True) or {}
    cmd_id = (data.get("cmdId") or "").strip()
    if not cmd_id:
        return jsonify({"detail": "cmdId mancante"}), 400
    ok = _mark_ack(cmd_id, device_id=dev_id)
    return jsonify({"ok": ok, "cmdId": cmd_id})
