# SPDX-License-Identifier: AGPL-3.0-or-later
"""Controlador de porta simulado (equivalente ao firmware ESP32) e bus de mensaxes MQTT.

O controlador decide por si mesmo: comproba a sinatura do QR coa chave pública, a instalación e a franxa.
Só recibe pola canle MQTT (a) anulacións, (b) a caché de códigos do día e (c) a orde do botón.
Cando está sen conexión non recibe nada disto, pero o QR e o código seguen abrindo.
"""
import json
import os
import threading
import time

from . import qr
from .core import conn, eff_rules, initials, now, notify, row, rows, kv_get, kv_set
from .domain import conflict_ids

BUTTON_TTL = 30  # segundos para premer o pulsador
UNLOCK_SECONDS = 8

_mqtt = {"client": None, "ok": False}


def mqtt_start():
    host = os.environ.get("MQTT_HOST")
    if not host:
        return
    try:
        import paho.mqtt.client as mqtt
        try:
            cl = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="pista-api")
        except Exception:
            cl = mqtt.Client(client_id="pista-api")
        cl.connect_async(host, int(os.environ.get("MQTT_PORT", "1883")), 30)
        cl.loop_start()
        _mqtt["client"] = cl
        _mqtt["ok"] = True
    except Exception as e:  # o broker é opcional na demo
        print("MQTT non dispoñible:", e)


def publish(c, t, topic, payload):
    """Rexístrase sempre (monitor da demo) e, se hai broker, publícase de verdade."""
    full = f"pista/{t}/{topic}"
    body = json.dumps(payload, separators=(",", ":"))
    c.execute("INSERT INTO mqtt_log(ts,topic,payload) VALUES(?,?,?)", (now(c), full, body))
    c.execute("DELETE FROM mqtt_log WHERE id < (SELECT MAX(id)-300 FROM mqtt_log)")
    cl = _mqtt["client"]
    if cl:
        try:
            cl.publish(full, body, qos=1)
        except Exception:
            pass


def ensure(c, fac):
    if fac.get("device_id") and not row(c, "SELECT 1 FROM devices WHERE id=?", (fac["device_id"],)):
        c.execute("INSERT INTO devices(id,facility_id,last_seen) VALUES(?,?,?)", (fac["device_id"], fac["id"], now(c)))


def dev(c, did):
    return row(c, "SELECT * FROM devices WHERE id=?", (did,))


def fac_of(c, d):
    return row(c, "SELECT * FROM facilities WHERE id=?", (d["facility_id"],))


def sync(c, t, fac):
    """Empurra á porta a lista de códigos válidos das próximas 36 h (só se ten conexión)."""
    if not fac.get("device_id"):
        return
    d = dev(c, fac["device_id"])
    if not d or not d["online"]:
        return
    n = now(c)
    ids = conflict_ids(c, fac["id"])
    q = ",".join("?" * len(ids))
    rs = rows(c, f"SELECT id,code,start,end,nonce,user_id FROM reservations WHERE facility_id IN ({q}) AND status='confirmed' AND end>? AND start<?",
              tuple(ids) + (n, n + 36 * 3600))
    cache = [{"r": r["id"], "code": r["code"], "a": r["start"], "b": r["end"], "u": r["user_id"]} for r in rs]
    c.execute("UPDATE devices SET cache=?, last_seen=? WHERE id=?", (json.dumps(cache), n, d["id"]))
    publish(c, t, f"{d['id']}/cache", {"n": len(cache)})


def revoke(c, t, res):
    fac = row(c, "SELECT * FROM facilities WHERE id=?", (res["facility_id"],))
    # revoga na porta da propia instalación e na do pai/partes
    ids = conflict_ids(c, fac["id"])
    for d in rows(c, f"SELECT * FROM devices WHERE facility_id IN ({','.join('?' * len(ids))})", tuple(ids)):
        publish(c, t, f"{d['id']}/revoke", {"r": res["id"], "n": res["nonce"]})
        if d["online"]:
            rv = json.loads(d["revoked"])
            rv.append(res["id"])
            c.execute("UPDATE devices SET revoked=? WHERE id=?", (json.dumps(rv[-200:]), d["id"]))
        else:
            ps = json.loads(d["pending_sync"])
            ps.append({"revoke": res["id"]})
            c.execute("UPDATE devices SET pending_sync=? WHERE id=?", (json.dumps(ps), d["id"]))


# ---- validación (compartida coa persoa validadora) ---------------------------
def validate(c, t, fac, text, kind, device=None, online=True):
    """Devolve (reserva|None, motivo). motivo='ok' se vale.
    Con device e sen conexión só se usa o que o controlador sabe localmente."""
    n = now(c)
    rules = eff_rules(c, fac)
    grace = rules["open_grace_min"] * 60
    ids = conflict_ids(c, fac["id"])
    res = None
    if kind == "qr":
        p, err = qr.verify(t, text)
        if err:
            return None, err
        if p["f"] not in ids:
            return None, "wrong_facility"
        a, b, rid = p["a"], p["b"], p["r"]
        if device is not None and not online:
            res = {"id": rid, "start": a, "end": b, "user_id": None, "facility_id": p["f"]}
        else:
            res = row(c, "SELECT * FROM reservations WHERE id=?", (rid,))
            if not res or res["nonce"] != p["n"]:
                return None, "unknown"
            if res["status"] == "cancelled":
                return res, "revoked"
            if res["status"] == "no_show":
                return res, "outside_slot"
        if device is not None and online:
            if rid in json.loads(device["revoked"]):
                return res, "revoked"
    else:
        code = (text or "").replace(" ", "")
        mcode = kv_get(c, "maintenance_code", "777000")
        if code == mcode and device is not None:
            return {"id": None, "maintenance": True, "user_id": None, "facility_id": fac["id"]}, "ok"
        if device is not None:
            hit = next((x for x in json.loads(device["cache"]) if x["code"] == code), None)
            if not hit:
                return None, "unknown_code"
            if online and hit["r"] in json.loads(device["revoked"]):
                return None, "revoked"
            res = {"id": hit["r"], "start": hit["a"], "end": hit["b"], "user_id": hit["u"], "facility_id": fac["id"]}
            if online:
                full = row(c, "SELECT * FROM reservations WHERE id=?", (hit["r"],))
                if full and full["status"] == "cancelled":
                    return full, "revoked"
        else:
            res = row(c, "SELECT * FROM reservations WHERE code=? AND status IN ('confirmed','attended') AND facility_id IN (%s) AND end>?" % ",".join("?" * len(ids)),
                      (code, *ids, n - 3600))
            if not res:
                return None, "unknown_code"
    if n < res["start"] - grace:
        return res, "too_early"
    if n > res["end"] + grace:
        return res, "too_late"
    return res, "ok"


def _log(c, d, fac, res, medium, result, reason, actor=None):
    uid = res.get("user_id") if res else None
    entry = {"ts": now(c), "facility_id": fac["id"], "reservation_id": (res or {}).get("id"), "user_id": uid,
             "medium": medium, "result": result, "reason": reason, "actor": actor or d["id"]}
    if d["online"]:
        c.execute("INSERT INTO access_log(ts,facility_id,reservation_id,user_id,medium,result,reason,actor) VALUES(?,?,?,?,?,?,?,?)",
                  (entry["ts"], fac["id"], entry["reservation_id"], uid, medium, result, reason, entry["actor"]))
        _mark_attended(c, entry["reservation_id"], entry["ts"], result)
    else:
        ll = json.loads(d["local_log"])
        ll.append(entry)
        c.execute("UPDATE devices SET local_log=? WHERE id=?", (json.dumps(ll[-200:]), d["id"]))


def _mark_attended(c, rid, ts, result):
    if rid and result == "ok":
        c.execute("UPDATE reservations SET status=CASE WHEN status='confirmed' THEN 'attended' ELSE status END, entered_at=COALESCE(entered_at,?) WHERE id=?", (ts, rid))


def _open(c, t, d, fac, res, medium):
    n = now(c)
    c.execute("UPDATE devices SET locked=0, unlock_until=? WHERE id=?", (time.time() + UNLOCK_SECONDS, d["id"]))
    if fac["light_auto"] and res and res.get("end"):
        c.execute("UPDATE devices SET light=1, light_until=? WHERE id=?", (res["end"], d["id"]))
    publish(c, t, f"{d['id']}/events", {"ev": "open", "m": medium, "r": (res or {}).get("id")})


def scan(c, t, did, text, kind):
    d = dev(c, did)
    fac = fac_of(c, d)
    res, reason = validate(c, t, fac, text, kind, device=d, online=bool(d["online"]))
    medium = "qr" if kind == "qr" else "code"
    if res and res.get("maintenance"):
        _log(c, d, fac, {"id": None, "user_id": None}, "maintenance", "ok", "maintenance", "Mantemento, J. R.")
        _open(c, t, d, fac, None, "maintenance")
        return {"ok": True, "reason": "maintenance", "label": "Mantemento"}
    if reason == "ok":
        _log(c, d, fac, res, medium, "ok", "offline_ok" if not d["online"] else "ok")
        _open(c, t, d, fac, res, medium)
        who = None
        if res.get("user_id"):
            u = row(c, "SELECT name,surname FROM users WHERE id=?", (res["user_id"],))
            who = initials(u)
        return {"ok": True, "reason": "ok", "offline": not d["online"], "who": who, "start": res["start"], "end": res["end"]}
    _log(c, d, fac, res, medium, "denied", reason)
    publish(c, t, f"{d['id']}/events", {"ev": "denied", "why": reason})
    return {"ok": False, "reason": reason}


def arm(c, t, res, user):
    """Orde do botón do móbil: a plataforma comproba a reserva e envía unha orde curta á porta."""
    fac = row(c, "SELECT * FROM facilities WHERE id=?", (res["facility_id"],))
    d = dev(c, fac["device_id"]) if fac.get("device_id") else None
    if not d:
        return None, "no_device"
    if res["status"] != "confirmed" and res["status"] != "attended":
        return None, "revoked"
    n = now(c)
    grace = eff_rules(c, fac)["open_grace_min"] * 60
    if n < res["start"] - grace:
        return None, "too_early"
    if n > res["end"] + grace:
        return None, "too_late"
    if not d["online"]:
        return None, "device_offline"
    until = time.time() + BUTTON_TTL
    c.execute("UPDATE devices SET armed_res=?, armed_until=? WHERE id=?", (res["id"], until, d["id"]))
    publish(c, t, f"{d['id']}/cmd", {"cmd": "arm", "r": res["id"], "ttl": BUTTON_TTL})
    return {"armed_until": until, "ttl": BUTTON_TTL}, "ok"


def press(c, t, did):
    d = dev(c, did)
    fac = fac_of(c, d)
    if d["armed_res"] and time.time() < d["armed_until"]:
        res = row(c, "SELECT * FROM reservations WHERE id=?", (d["armed_res"],))
        c.execute("UPDATE devices SET armed_res=NULL, armed_until=0 WHERE id=?", (did,))
        if res and res["status"] in ("confirmed", "attended"):
            _log(c, d, fac, res, "button", "ok", "ok")
            _open(c, t, d, fac, res, "button")
            return {"ok": True, "reason": "ok"}
        _log(c, d, fac, res, "button", "denied", "revoked")
        return {"ok": False, "reason": "revoked"}
    _log(c, d, fac, None, "button", "denied", "not_armed")
    return {"ok": False, "reason": "not_armed"}


def remote_open(c, t, did, actor):
    d = dev(c, did)
    fac = fac_of(c, d)
    if not d["online"]:
        return {"ok": False, "reason": "device_offline"}
    _log(c, d, fac, {"id": None, "user_id": None}, "remote", "ok", "remote", actor)
    _open(c, t, d, fac, None, "remote")
    return {"ok": True}


def sensor(c, t, did, closed):
    d = dev(c, did)
    n = now(c)
    if closed:
        c.execute("UPDATE devices SET door_closed=1, locked=1, unlock_until=0, open_since=NULL WHERE id=?", (did,))
        kv_set(c, f"alert_open_{did}", False)
    else:
        c.execute("UPDATE devices SET door_closed=0, open_since=? WHERE id=?", (n, did))
    publish(c, t, f"{did}/events", {"ev": "sensor", "closed": bool(closed)})


def set_online(c, t, did, online):
    d = dev(c, did)
    fac = fac_of(c, d)
    c.execute("UPDATE devices SET online=?, last_seen=? WHERE id=?", (1 if online else 0, now(c), did))
    if online:
        # recupera a rede: aplica anulacións pendentes, envía o rexistro local e refresca a caché
        for p in json.loads(d["pending_sync"]):
            if "revoke" in p:
                rv = json.loads(dev(c, did)["revoked"])
                rv.append(p["revoke"])
                c.execute("UPDATE devices SET revoked=? WHERE id=?", (json.dumps(rv[-200:]), did))
        for e in json.loads(d["local_log"]):
            c.execute("INSERT INTO access_log(ts,facility_id,reservation_id,user_id,medium,result,reason,actor) VALUES(?,?,?,?,?,?,?,?)",
                      (e["ts"], e["facility_id"], e["reservation_id"], e["user_id"], e["medium"], e["result"], "synced_" + str(e["reason"]), e["actor"]))
            _mark_attended(c, e["reservation_id"], e["ts"], e["result"])
        c.execute("UPDATE devices SET pending_sync='[]', local_log='[]' WHERE id=?", (did,))
        sync(c, t, fac)
    publish(c, t, f"{did}/status", {"online": bool(online)})


def state(c, did):
    d = dev(c, did)
    n = now(c)
    tm = time.time()
    unlocked = tm < d["unlock_until"]
    armed = d["armed_res"] and tm < d["armed_until"]
    return {"id": did, "facility_id": d["facility_id"], "online": bool(d["online"]), "locked": not unlocked,
            "door_closed": bool(d["door_closed"]), "light": bool(d["light"] and n < d["light_until"]),
            "armed": bool(armed), "armed_left": max(0, round(d["armed_until"] - tm)) if armed else 0,
            "cache": len(json.loads(d["cache"])), "revoked": len(json.loads(d["revoked"])),
            "pending": len(json.loads(d["pending_sync"])), "local_log": len(json.loads(d["local_log"])),
            "last_seen": d["last_seen"], "fw": d["fw"]}


# ---- tarefas periódicas ------------------------------------------------------
def tick(c, t):
    n = now(c)
    # non presentados
    for r in rows(c, "SELECT r.*,f.access_mode FROM reservations r JOIN facilities f ON f.id=r.facility_id WHERE r.status='confirmed' AND r.seasonal=0 AND r.end<?", (n,)):
        c.execute("UPDATE reservations SET status='no_show' WHERE id=?", (r["id"],))
        notify(c, r["user_id"], "no_show", {"res": r["id"], "start": r["start"]})
    # lembretes
    for r in rows(c, "SELECT r.*,f.name fname FROM reservations r JOIN facilities f ON f.id=r.facility_id WHERE r.status='confirmed' AND r.reminded=0 AND r.start>? AND r.start<?", (n, n + 3 * 3600)):
        notify(c, r["user_id"], "reminder", {"res": r["id"], "facility": r["fname"], "start": r["start"]})
        c.execute("UPDATE reservations SET reminded=1 WHERE id=?", (r["id"],))
    # porta aberta despois de rematar a franxa
    for d in rows(c, "SELECT * FROM devices WHERE door_closed=0 AND open_since IS NOT NULL"):
        if kv_get(c, f"alert_open_{d['id']}", False):
            continue
        fac = fac_of(c, d)
        active = row(c, "SELECT * FROM reservations WHERE facility_id=? AND status IN ('confirmed','attended') AND start<=? AND end>=?", (fac["id"], n, n))
        last = row(c, "SELECT * FROM reservations WHERE facility_id=? AND status='attended' AND end<? ORDER BY end DESC LIMIT 1", (fac["id"], n))
        if not active and last and d["open_since"] > last["start"] and n > last["end"] + 60:
            c.execute("INSERT INTO incidents(reservation_id,facility_id,user_id,ts,category,queue,text) VALUES(?,?,?,?,?,?,?)",
                      (last["id"], fac["id"], last["user_id"], n, "door_left_open", "operational", "auto"))
            c.execute("UPDATE reservations SET note=COALESCE(note,'')||' [porta aberta ao rematar]' WHERE id=?", (last["id"],))
            for m in rows(c, "SELECT id FROM users WHERE role='manager'"):
                notify(c, m["id"], "door_left_open", {"facility": fac["name"]})
            kv_set(c, f"alert_open_{d['id']}", True)


_started = {"on": False}


def start_background(tenants):
    if _started["on"]:
        return
    _started["on"] = True

    def loop():
        while True:
            time.sleep(5)
            for t in tenants:
                try:
                    with conn(t) as c:
                        tick(c, t)
                except Exception as e:
                    print("tick error", t, e)

    threading.Thread(target=loop, daemon=True).start()
