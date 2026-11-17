# SPDX-License-Identifier: AGPL-3.0-or-later
"""API REST de Ponte en Pista (FastAPI). Documentación OpenAPI en /api/docs."""
import csv
import io
import json
import os
import secrets
import time
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import device, domain, qr, seed
from .core import (DEFAULT_TENANT, check_pw, hash_pw, add_days, audit, conn, day_start, db_path, eff_rules, init_db, initials, kv_get, kv_set,
                   loc, new_session, notify, now, row, rows, tenant_cfg, tenant_ids, user_by_token, week_bounds, at)
from .courses import COURSES

VERSION = "0.9.0-demo"
app = FastAPI(title="Ponte en Pista · API", version=VERSION, docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None,
              description="API REST aberta de Ponte en Pista (AGPL-3.0). Demo para o I Certame GOBTEC de Software Libre.")
STATIC = os.path.join(os.path.dirname(__file__), "..", "static")


@app.on_event("startup")
def startup():
    for t in tenant_ids():
        if not os.path.exists(db_path(t)):
            seed.reset(t)
        else:
            init_db(t)
    device.mqtt_start()
    device.start_background(tenant_ids())


# ---- contexto ----------------------------------------------------------------
class Ctx:
    def __init__(self, c, t, user):
        self.c, self.t, self.user = c, t, user


def get_ctx(request: Request, authorization: Optional[str] = Header(None), x_tenant: Optional[str] = Header(None)):
    t = x_tenant or request.query_params.get("t") or DEFAULT_TENANT
    if t not in tenant_ids():
        raise HTTPException(404, "tenant_unknown")
    with conn(t) as c:
        tok = authorization.split(" ", 1)[1] if authorization and authorization.startswith("Bearer ") else None
        yield Ctx(c, t, user_by_token(c, tok))


def need(x: Ctx, *roles):
    if not x.user:
        raise HTTPException(401, "login_required")
    if roles and x.user["role"] not in roles:
        raise HTTPException(403, "forbidden")
    return x.user


def err(code, status=400, **extra):
    raise HTTPException(status, {"code": code, **extra})


def pub_user(u, c=None):
    if not u:
        return None
    d = {k: u[k] for k in ("id", "name", "surname", "email", "phone", "role", "level", "empadronado", "reduced", "club", "birth_year", "tutor_id",
                           "authorised", "id_method", "doc_checked", "passkey", "notif_email", "notif_push", "lang", "cal_token", "facility_scope")}
    if c:
        d["minor"] = domain.is_minor(u, c)
        d["age"] = domain.age(u, c)
        cur = row(c, "SELECT MAX(version) v FROM norms")["v"]
        acc = row(c, "SELECT version FROM norm_acceptances WHERE user_id=? ORDER BY version DESC LIMIT 1", (u["id"],))
        d["norms_ok"] = bool(row(c, "SELECT 1 FROM norm_acceptances WHERE user_id=? AND version=?", (u["id"], cur)))
        d["norms_current"] = cur
        d["norms_accepted"] = acc["version"] if acc else None
    return d


def fac_row(c, fid):
    f = row(c, "SELECT * FROM facilities WHERE id=?", (fid,))
    if not f:
        err("facility_not_found", 404)
    return f


def fac_pub(c, f, user=None, extra=True):
    d = dict(f)
    for k in ("schedule", "prices", "rules", "closed_dates"):
        d[k] = json.loads(d[k] or "{}" if k != "closed_dates" else d[k] or "[]")
    d["effective_rules"] = eff_rules(c, f)
    if extra:
        d["parts"] = [x["id"] for x in rows(c, "SELECT id FROM facilities WHERE parent_id=?", (f["id"],))]
        d["next_free"] = domain.next_free(c, f, user) if f["status"] == "open" else None
        d["tariff"] = None
        if user:
            n, p = domain.tariff_for(user, f)
            d["tariff"] = {"name": n, "price": p}
    return d


# ---- meta ---------------------------------------------------------------------
@app.get("/healthz", include_in_schema=False)
def healthz():
    return {"ok": True}


@app.get("/api/meta", tags=["meta"])
def meta(x: Ctx = Depends(get_ctx)):
    ts = []
    for t in tenant_ids():
        with conn(t) as c:
            cfg = tenant_cfg(c)
            ts.append({"id": t, "name": cfg["name"], "short": cfg["short"], "color": cfg["color"], "default_lang": cfg["default_lang"]})
    return {"tenants": ts, "tenant": x.t, "config": tenant_cfg(x.c), "now": now(x.c), "clock_offset": kv_get(x.c, "clock_offset", 0),
            "mqtt": bool(device._mqtt["ok"]), "version": VERSION, "license": "AGPL-3.0-or-later", "pubkey": qr.public_key_b64(x.t),
            "demo": True, "norms_current": row(x.c, "SELECT MAX(version) v FROM norms")["v"]}


@app.get("/api/tenant", tags=["meta"])
def tenant_get(x: Ctx = Depends(get_ctx)):
    return {"config": tenant_cfg(x.c), "rules": kv_get(x.c, "rules")}


class TenantIn(BaseModel):
    config: dict = {}
    rules: Optional[dict] = None


@app.put("/api/tenant", tags=["meta"])
def tenant_put(b: TenantIn, x: Ctx = Depends(get_ctx)):
    u = need(x, "manager")
    cfg = tenant_cfg(x.c)
    for k in ("name", "short", "color", "accent", "email", "phone", "domain", "legal_gl", "legal_es", "default_lang", "retention_days", "holidays", "summer"):
        if k in b.config:
            cfg[k] = b.config[k]
    kv_set(x.c, "config", cfg)
    if b.rules:
        r = kv_get(x.c, "rules")
        for k, v in b.rules.items():
            if k in r:
                r[k] = v
        kv_set(x.c, "rules", r)
    audit(x.c, u["id"], "tenant_update", {"keys": list(b.config) + list(b.rules or {})})
    return {"ok": True}


# ---- autenticación (simulada na demo) -------------------------------------------
class Sel(BaseModel):
    user_id: int


@app.get("/api/auth/personas", tags=["auth"])
def personas(x: Ctx = Depends(get_ctx)):
    """Persoas de proba para a demo (accesos rápidos e Cl@ve/certificado simulados)."""
    us = rows(x.c, "SELECT * FROM users WHERE active=1 AND COALESCE(email,'') NOT LIKE 'vecino%' ORDER BY CASE role WHEN 'citizen' THEN 0 ELSE 1 END, id LIMIT 24")
    return [{"id": u["id"], "name": f"{u['name']} {u['surname'] or ''}".strip(), "role": u["role"], "level": u["level"], "empadronado": u["empadronado"],
             "minor": domain.is_minor(u, x.c), "id_method": u["id_method"], "club": u["club"]} for u in us]


@app.post("/api/auth/demo", tags=["auth"])
def auth_demo(b: Sel, x: Ctx = Depends(get_ctx)):
    u = row(x.c, "SELECT * FROM users WHERE id=? AND active=1", (b.user_id,))
    if not u:
        err("user_not_found", 404)
    return {"token": new_session(x.c, u["id"]), "user": pub_user(u, x.c)}


@app.post("/api/auth/clave", tags=["auth"])
def auth_clave(b: Sel, method: str = "clave", x: Ctx = Depends(get_ctx)):
    """Cl@ve / certificado electrónico (simulados): acreditan a identidade (nivel 2)."""
    u = row(x.c, "SELECT * FROM users WHERE id=? AND active=1", (b.user_id,))
    if not u or u["role"] != "citizen" or domain.age(u, x.c) < 18 and not u["tutor_id"] and not u["club"]:
        err("user_not_found", 404)
    x.c.execute("UPDATE users SET level=2, id_method=?, doc_checked=1 WHERE id=? AND level<2", (method, u["id"]))
    u = row(x.c, "SELECT * FROM users WHERE id=?", (u["id"],))
    return {"token": new_session(x.c, u["id"]), "user": pub_user(u, x.c)}


class RegIn(BaseModel):
    name: str
    surname: str = ""
    email: str
    phone: str
    birth_year: int = 1990
    password: Optional[str] = None


@app.post("/api/auth/register", tags=["auth"])
def auth_register(b: RegIn, x: Ctx = Depends(get_ctx)):
    """Alta de conta (nivel 1): envía un código ao correo e ao móbil. Na demo o código é 123456."""
    if row(x.c, "SELECT 1 FROM users WHERE lower(email)=lower(?) AND active=1", (b.email,)):
        err("email_taken", 409)
    uid = x.c.execute("INSERT INTO users(name,surname,email,phone,level,birth_year,role,password,cal_token,created_at,id_method) VALUES(?,?,?,?,0,?,?,?,?,?,?)",
                      (b.name.strip(), b.surname.strip(), b.email.strip(), b.phone.strip(), b.birth_year, "citizen", hash_pw(b.password), secrets.token_urlsafe(12), now(x.c), "correo")).lastrowid
    return {"user_id": uid, "demo_code": "123456"}


class VerifyIn(BaseModel):
    user_id: int
    code: str


@app.post("/api/auth/verify", tags=["auth"])
def auth_verify(b: VerifyIn, x: Ctx = Depends(get_ctx)):
    u = row(x.c, "SELECT * FROM users WHERE id=?", (b.user_id,))
    if not u or b.code.strip() != "123456":
        err("bad_code", 400)
    x.c.execute("UPDATE users SET level=MAX(level,1) WHERE id=?", (u["id"],))
    u = row(x.c, "SELECT * FROM users WHERE id=?", (u["id"],))
    return {"token": new_session(x.c, u["id"]), "user": pub_user(u, x.c)}


class PwdIn(BaseModel):
    email: str
    password: str
    code: str = ""


@app.post("/api/auth/password", tags=["auth"])
def auth_password(b: PwdIn, x: Ctx = Depends(get_ctx)):
    """Contrasinal + dobre factor (persoal). Na demo: contrasinal «demo» e código 123456."""
    u = row(x.c, "SELECT * FROM users WHERE lower(email)=lower(?) AND active=1", (b.email,))
    if not u or not check_pw(b.password, u["password"]):
        err("bad_credentials", 401)
    if u["role"] != "citizen" and b.code.strip() != "123456":
        err("bad_2fa", 401)
    return {"token": new_session(x.c, u["id"]), "user": pub_user(u, x.c)}


@app.post("/api/auth/logout", tags=["auth"])
def logout(authorization: Optional[str] = Header(None), x: Ctx = Depends(get_ctx)):
    if authorization:
        x.c.execute("DELETE FROM sessions WHERE token=?", (authorization.split(" ", 1)[1],))
    return {"ok": True}


@app.get("/api/me", tags=["auth"])
def me(x: Ctx = Depends(get_ctx)):
    u = need(x)
    return pub_user(u, x.c)


class MeIn(BaseModel):
    notif_email: Optional[bool] = None
    notif_push: Optional[bool] = None
    lang: Optional[str] = None
    passkey: Optional[bool] = None
    phone: Optional[str] = None
    email: Optional[str] = None


@app.patch("/api/me", tags=["auth"])
def me_patch(b: MeIn, x: Ctx = Depends(get_ctx)):
    u = need(x)
    for k, v in b.model_dump(exclude_none=True).items():
        x.c.execute(f"UPDATE users SET {k}=? WHERE id=?", (int(v) if isinstance(v, bool) else v, u["id"]))
    return pub_user(row(x.c, "SELECT * FROM users WHERE id=?", (u["id"],)), x.c)


class AccIn(BaseModel):
    method: str = "certificado"


@app.post("/api/me/accredit", tags=["auth"])
def me_accredit(b: AccIn, x: Ctx = Depends(get_ctx)):
    """Acredita a identidade (Cl@ve ou certificado simulados) -> nivel 2."""
    u = need(x)
    x.c.execute("UPDATE users SET level=2, id_method=?, doc_checked=1 WHERE id=?", (b.method, u["id"]))
    return pub_user(row(x.c, "SELECT * FROM users WHERE id=?", (u["id"],)), x.c)


@app.post("/api/me/norms", tags=["auth"])
def me_norms(x: Ctx = Depends(get_ctx)):
    u = need(x)
    cur = row(x.c, "SELECT MAX(version) v FROM norms")["v"]
    x.c.execute("INSERT INTO norm_acceptances VALUES(?,?,?)", (u["id"], cur, now(x.c)))
    return pub_user(u, x.c)


@app.get("/api/me/export", tags=["auth"])
def me_export(x: Ctx = Depends(get_ctx)):
    """Portabilidade: todos os datos persoais en JSON."""
    u = need(x)
    return {"user": pub_user(u, x.c), "reservations": rows(x.c, "SELECT * FROM reservations WHERE user_id=?", (u["id"],)),
            "access": rows(x.c, "SELECT * FROM access_log WHERE user_id=?", (u["id"],)), "incidents": rows(x.c, "SELECT * FROM incidents WHERE user_id=?", (u["id"],)),
            "norm_acceptances": rows(x.c, "SELECT * FROM norm_acceptances WHERE user_id=?", (u["id"],)),
            "notifications": rows(x.c, "SELECT * FROM notifications WHERE user_id=?", (u["id"],))}


@app.delete("/api/me", tags=["auth"])
def me_delete(x: Ctx = Depends(get_ctx)):
    """Baixa da conta: cancela reservas futuras e anonimiza os datos persoais."""
    u = need(x)
    if u["role"] != "citizen":
        err("forbidden", 403)
    for r in rows(x.c, "SELECT * FROM reservations WHERE user_id=? AND status='confirmed' AND end>?", (u["id"], now(x.c))):
        domain.cancel(x.c, x.t, r, u["id"], "user")
    x.c.execute("UPDATE users SET active=0,name='Persoa',surname='(baixa)',email=NULL,phone=NULL,password=NULL WHERE id=?", (u["id"],))
    x.c.execute("DELETE FROM sessions WHERE user_id=?", (u["id"],))
    audit(x.c, u["id"], "account_deleted", {})
    return {"ok": True}


@app.get("/api/me/notifications", tags=["auth"])
def my_notifs(x: Ctx = Depends(get_ctx)):
    u = need(x)
    return rows(x.c, "SELECT * FROM notifications WHERE user_id=? ORDER BY ts DESC, id DESC LIMIT 60", (u["id"],))


@app.post("/api/me/notifications/read", tags=["auth"])
def notifs_read(x: Ctx = Depends(get_ctx)):
    u = need(x)
    x.c.execute("UPDATE notifications SET read=1 WHERE user_id=?", (u["id"],))
    return {"ok": True}


@app.get("/api/me/linked", tags=["auth"])
def linked(x: Ctx = Depends(get_ctx)):
    u = need(x)
    return [pub_user(m, x.c) for m in rows(x.c, "SELECT * FROM users WHERE tutor_id=? AND active=1", (u["id"],))]


class LinkIn(BaseModel):
    name: str
    surname: str = ""
    birth_year: int
    email: str = ""


@app.post("/api/me/linked", tags=["auth"])
def linked_add(b: LinkIn, x: Ctx = Depends(get_ctx)):
    """A persoa titora identificada engade unha persoa menor vinculada."""
    u = need(x)
    if u["level"] < 2:
        err("level_required", 403, level=2)
    yr = loc(now(x.c)).year
    if yr - b.birth_year >= 18:
        err("not_minor")
    young = yr - b.birth_year < 14
    nid = x.c.execute("INSERT INTO users(name,surname,email,level,empadronado,birth_year,tutor_id,authorised,cal_token,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                      (b.name, b.surname or u["surname"], b.email, 1, u["empadronado"], b.birth_year, u["id"], 1 if young else 0, secrets.token_urlsafe(12), now(x.c))).lastrowid
    return pub_user(row(x.c, "SELECT * FROM users WHERE id=?", (nid,)), x.c)


class AuthzIn(BaseModel):
    authorised: bool = True


@app.post("/api/me/linked/{mid}/authorise", tags=["auth"])
def linked_auth(mid: int, b: AuthzIn, x: Ctx = Depends(get_ctx)):
    u = need(x)
    m = row(x.c, "SELECT * FROM users WHERE id=? AND tutor_id=?", (mid, u["id"]))
    if not m:
        err("not_found", 404)
    x.c.execute("UPDATE users SET authorised=? WHERE id=?", (int(b.authorised), mid))
    audit(x.c, u["id"], "minor_authorisation", {"minor": mid, "authorised": b.authorised})
    return pub_user(row(x.c, "SELECT * FROM users WHERE id=?", (mid,)), x.c)


# ---- instalacións e franxas ----------------------------------------------------------
@app.get("/api/facilities", tags=["catálogo"])
def facilities(x: Ctx = Depends(get_ctx)):
    """Catálogo público (sen conta)."""
    return [fac_pub(x.c, f, x.user) for f in rows(x.c, "SELECT * FROM facilities ORDER BY sort,id")]


@app.get("/api/facilities/{fid}", tags=["catálogo"])
def facility(fid: int, x: Ctx = Depends(get_ctx)):
    f = fac_row(x.c, fid)
    d = fac_pub(x.c, f, x.user)
    d["rule_texts"] = {"window_resident": d["effective_rules"]["window_days"], "window_general": d["effective_rules"]["window_days"] - d["effective_rules"]["padron_early_days"]}
    return d


@app.get("/api/facilities/{fid}/slots", tags=["catálogo"])
def slots(fid: int, start: Optional[int] = None, days: int = Query(7, ge=1, le=21), x: Ctx = Depends(get_ctx)):
    f = fac_row(x.c, fid)
    return {"facility_id": fid, "days": domain.availability(x.c, f, start or now(x.c), days, x.user), "now": now(x.c)}


class FacIn(BaseModel):
    name: Optional[str] = None
    sport: Optional[str] = None
    description: Optional[str] = None
    access_mode: Optional[str] = None
    slot_minutes: Optional[int] = None
    schedule: Optional[dict] = None
    closed_dates: Optional[list] = None
    prices: Optional[dict] = None
    rules: Optional[dict] = None
    accessibility: Optional[str] = None
    norms: Optional[str] = None
    min_level: Optional[int] = None
    allow_minors: Optional[bool] = None
    light_auto: Optional[bool] = None
    parent_id: Optional[int] = None
    device_id: Optional[str] = None


def _fac_values(b: FacIn):
    out = {}
    for k, v in b.model_dump(exclude_none=True).items():
        if k in ("schedule", "closed_dates", "prices", "rules"):
            v = json.dumps(v)
        elif isinstance(v, bool):
            v = int(v)
        out[k] = v
    return out


@app.post("/api/facilities", tags=["xestión"])
def fac_create(b: FacIn, x: Ctx = Depends(get_ctx)):
    u = need(x, "manager")
    v = _fac_values(b)
    v.setdefault("name", "Nova instalación")
    v.setdefault("schedule", json.dumps(seed.sched(0, 0)))
    v.setdefault("prices", json.dumps({"general": 0}))
    if v.get("access_mode") == "door" and not v.get("device_id"):
        v["device_id"] = "porta-" + secrets.token_hex(2)
    fid = x.c.execute(f"INSERT INTO facilities({','.join(v)}) VALUES({','.join('?' * len(v))})", tuple(v.values())).lastrowid
    f = fac_row(x.c, fid)
    device.ensure(x.c, f)
    audit(x.c, u["id"], "facility_create", {"id": fid})
    return fac_pub(x.c, f)


@app.put("/api/facilities/{fid}", tags=["xestión"])
def fac_update(fid: int, b: FacIn, x: Ctx = Depends(get_ctx)):
    u = need(x, "manager")
    f = fac_row(x.c, fid)
    v = _fac_values(b)
    if v.get("access_mode") == "door" and not (v.get("device_id") or f["device_id"]):
        v["device_id"] = "porta-" + secrets.token_hex(2)
    if v:
        x.c.execute(f"UPDATE facilities SET {','.join(k + '=?' for k in v)} WHERE id=?", (*v.values(), fid))
    f = fac_row(x.c, fid)
    device.ensure(x.c, f)
    audit(x.c, u["id"], "facility_update", {"id": fid, "keys": list(v)})
    return fac_pub(x.c, f)


class CloseIn(BaseModel):
    reason: str = "Avaría"


@app.post("/api/facilities/{fid}/close", tags=["xestión"])
def fac_close(fid: int, b: CloseIn, x: Ctx = Depends(get_ctx)):
    """Peche por avaría: desaparecen as franxas do catálogo, anúlanse os QR e avísase a quen tiña reserva."""
    u = need(x, "manager")
    f = fac_row(x.c, fid)
    x.c.execute("UPDATE facilities SET status='closed', closed_reason=? WHERE id=?", (b.reason, fid))
    n = 0
    for r in rows(x.c, "SELECT * FROM reservations WHERE facility_id=? AND status='confirmed' AND end>?", (fid, now(x.c))):
        domain.cancel(x.c, x.t, r, u["id"], "closure")
        n += 1
    audit(x.c, u["id"], "facility_close", {"id": fid, "reason": b.reason, "cancelled": n})
    return {"ok": True, "cancelled": n}


@app.post("/api/facilities/{fid}/reopen", tags=["xestión"])
def fac_reopen(fid: int, x: Ctx = Depends(get_ctx)):
    u = need(x, "manager")
    x.c.execute("UPDATE facilities SET status='open', closed_reason=NULL WHERE id=?", (fid,))
    audit(x.c, u["id"], "facility_reopen", {"id": fid})
    return {"ok": True}


# ---- regras e reservas ---------------------------------------------------------------
def holder_for(x: Ctx, holder_id: Optional[int]):
    u = need(x)
    if not holder_id or holder_id == u["id"]:
        return u
    h = row(x.c, "SELECT * FROM users WHERE id=? AND active=1", (holder_id,))
    if not h:
        err("user_not_found", 404)
    if u["role"] == "manager" or h["tutor_id"] == u["id"]:
        return h
    err("forbidden", 403)


@app.get("/api/rules/check", tags=["reservas"])
def rules_check(facility_id: int, start: int, holder_id: Optional[int] = None, x: Ctx = Depends(get_ctx)):
    """Previsualiza que regras se aplican antes de confirmar (a persoa ve sempre o motivo e cando poderá reservar de novo)."""
    h = holder_for(x, holder_id)
    f = fac_row(x.c, facility_id)
    end = start + f["slot_minutes"] * 60
    v = domain.check(x.c, h, f, start, end)
    tn, pr = domain.tariff_for(h, f)
    return {"violations": v, "tariff": {"name": tn, "price": pr}, "limits": domain.limits_summary(x.c, h, f, start), "end": end,
            "holder": pub_user(h, x.c)}


class ResIn(BaseModel):
    facility_id: int
    start: int
    holder_id: Optional[int] = None
    channel: str = "web"
    override: bool = False
    reason: str = ""
    accept_norms: bool = False
    delivery: Optional[str] = None
    qr_for_minor: bool = False


HARD = {"not_a_slot", "past", "taken", "facility_closed"}


@app.post("/api/reservations", tags=["reservas"])
def res_create(b: ResIn, x: Ctx = Depends(get_ctx)):
    u = need(x)
    h = holder_for(x, b.holder_id)
    f = fac_row(x.c, b.facility_id)
    end = b.start + f["slot_minutes"] * 60
    channel = b.channel if u["role"] == "manager" and b.channel in ("phone", "office") else "web"
    if u["role"] == "manager" and b.accept_norms:
        cur = row(x.c, "SELECT MAX(version) v FROM norms")["v"]
        if not row(x.c, "SELECT 1 FROM norm_acceptances WHERE user_id=? AND version=?", (h["id"], cur)):
            x.c.execute("INSERT INTO norm_acceptances VALUES(?,?,?)", (h["id"], cur, now(x.c)))
    v = domain.check(x.c, h, f, b.start, end)
    if v:
        soft = [i for i in v if i["code"] not in HARD]
        if u["role"] == "manager" and b.override and b.reason.strip() and len(soft) == len(v) - len([i for i in v if i["code"] in HARD]) and not any(i["code"] in HARD for i in v):
            audit(x.c, u["id"], "rule_exception", {"holder": h["id"], "facility": f["id"], "start": b.start, "rules": [i["code"] for i in v], "reason": b.reason})
        else:
            raise HTTPException(409, {"code": "rules", "violations": v})
    res = domain.create(x.c, x.t, h, f, b.start, u["id"], channel, note=("Excepción: " + b.reason) if v else None, delivery=b.delivery, qr_for_minor=b.qr_for_minor)
    # sae da lista de espera
    x.c.execute("DELETE FROM waitlist WHERE facility_id=? AND start=? AND user_id=?", (f["id"], b.start, h["id"]))
    return res_detail(x, res["id"])


def can_view(x: Ctx, r):
    u = x.user
    if not u:
        return False
    if u["role"] in ("manager", "tech"):
        return True
    if u["role"] == "validator":
        sc = (u["facility_scope"] or "").split(",")
        return str(r["facility_id"]) in sc
    if r["user_id"] == u["id"] or r["booked_by"] == u["id"]:
        return True
    h = row(x.c, "SELECT tutor_id FROM users WHERE id=?", (r["user_id"],))
    return bool(h and h["tutor_id"] == u["id"])


def get_res(x: Ctx, rid: int):
    r = row(x.c, "SELECT * FROM reservations WHERE id=?", (rid,))
    if not r:
        err("not_found", 404)
    if not can_view(x, r):
        err("forbidden", 403)
    return r


def res_detail(x: Ctx, rid: int):
    r = get_res(x, rid)
    d = domain.view(x.c, r)
    f = fac_row(x.c, r["facility_id"])
    d["tariff_label"] = r["tariff"]
    d["facility_full"] = fac_pub(x.c, f, extra=False)
    d["qr"] = qr.sign(x.t, r) if r["status"] in ("confirmed", "attended") else None
    holder = x.user["role"] in ("manager",) or r["user_id"] == x.user["id"] or r["booked_by"] == x.user["id"] or d["holder"]["id"] in [m["id"] for m in rows(x.c, "SELECT id FROM users WHERE tutor_id=?", (x.user["id"],))]
    if not holder and x.user["role"] != "manager":
        d.pop("code", None)
        d["qr"] = None
    rules = eff_rules(x.c, f)
    d["can_change"] = r["status"] == "confirmed" and r["start"] - now(x.c) >= rules["cancel_hours"] * 3600 and not r["seasonal"]
    d["can_cancel"] = r["status"] == "confirmed" and r["start"] > now(x.c)
    d["cancel_hours"] = rules["cancel_hours"]
    d["now"] = now(x.c)
    return d


@app.get("/api/reservations", tags=["reservas"])
def res_list(scope: str = "mine", facility_id: Optional[int] = None, status: Optional[str] = None, channel: Optional[str] = None,
             date_from: Optional[int] = None, date_to: Optional[int] = None, limit: int = 300, x: Ctx = Depends(get_ctx)):
    u = need(x)
    q, a = "SELECT * FROM reservations WHERE 1=1", []
    if scope == "all":
        need(x, "manager", "tech")
    else:
        ids = [u["id"]] + [m["id"] for m in rows(x.c, "SELECT id FROM users WHERE tutor_id=?", (u["id"],))]
        q += f" AND user_id IN ({','.join('?' * len(ids))})"
        a += ids
    if facility_id:
        q += " AND facility_id=?"
        a.append(facility_id)
    if status:
        q += " AND status=?"
        a.append(status)
    if channel:
        q += " AND channel=?"
        a.append(channel)
    if date_from:
        q += " AND start>=?"
        a.append(date_from)
    if date_to:
        q += " AND start<?"
        a.append(date_to)
    q += " ORDER BY start DESC LIMIT ?"
    a.append(limit)
    out = []
    for r in rows(x.c, q, tuple(a)):
        d = domain.view(x.c, r, with_secret=(scope != "all"))
        out.append(d)
    return {"items": out, "now": now(x.c)}


@app.get("/api/reservations/{rid}", tags=["reservas"])
def res_get(rid: int, x: Ctx = Depends(get_ctx)):
    need(x)
    return res_detail(x, rid)


@app.get("/api/reservations/{rid}/qr", tags=["reservas"])
def res_qr(rid: int, x: Ctx = Depends(get_ctx)):
    need(x)
    r = get_res(x, rid)
    if r["status"] not in ("confirmed", "attended"):
        err("revoked", 410)
    text = qr.sign(x.t, r)
    return {"text": text, "svg": qr.svg(text, tenant_cfg(x.c).get("color", "#102F61")), "code": r["code"]}


class ChangeIn(BaseModel):
    start: int


@app.patch("/api/reservations/{rid}", tags=["reservas"])
def res_change(rid: int, b: ChangeIn, x: Ctx = Depends(get_ctx)):
    """Cambia a franxa dentro do prazo. O QR antigo queda anulado ao momento, tamén na porta."""
    u = need(x)
    r = get_res(x, rid)
    f = fac_row(x.c, r["facility_id"])
    rules = eff_rules(x.c, f)
    if r["status"] != "confirmed" or (r["start"] - now(x.c) < rules["cancel_hours"] * 3600 and u["role"] != "manager"):
        err("too_late_to_change", 409, hours=rules["cancel_hours"])
    h = row(x.c, "SELECT * FROM users WHERE id=?", (r["user_id"],))
    end = b.start + f["slot_minutes"] * 60
    v = domain.check(x.c, h, f, b.start, end, exclude=rid)
    if v and not (u["role"] == "manager" and not any(i["code"] in HARD for i in v)):
        raise HTTPException(409, {"code": "rules", "violations": v})
    old = dict(r)
    device.revoke(x.c, x.t, old)
    x.c.execute("UPDATE reservations SET start=?, end=?, nonce=?, code=?, reminded=0 WHERE id=?", (b.start, end, secrets.token_hex(6), domain.new_code(x.c), rid))
    wl = row(x.c, "SELECT * FROM waitlist WHERE facility_id=? AND start=? ORDER BY created_at LIMIT 1", (f["id"], old["start"]))
    if wl:
        notify(x.c, wl["user_id"], "waitlist_free", {"facility": f["name"], "start": old["start"], "facility_id": f["id"]})
        x.c.execute("DELETE FROM waitlist WHERE id=?", (wl["id"],))
    notify(x.c, r["user_id"], "booking_changed", {"res": rid, "facility": f["name"], "start": b.start})
    device.sync(x.c, x.t, f)
    return res_detail(x, rid)


@app.post("/api/reservations/{rid}/cancel", tags=["reservas"])
def res_cancel(rid: int, x: Ctx = Depends(get_ctx)):
    u = need(x)
    r = get_res(x, rid)
    if r["status"] != "confirmed" or r["start"] <= now(x.c):
        err("cannot_cancel", 409)
    late = domain.cancel(x.c, x.t, r, u["id"], "user")
    if u["role"] == "manager":
        audit(x.c, u["id"], "cancel_assisted", {"res": rid})
    return {"ok": True, "late": bool(late), **res_detail(x, rid)}


class WaitIn(BaseModel):
    facility_id: int
    start: int


@app.post("/api/waitlist", tags=["reservas"])
def wait_add(b: WaitIn, x: Ctx = Depends(get_ctx)):
    u = need(x)
    if not row(x.c, "SELECT 1 FROM waitlist WHERE facility_id=? AND start=? AND user_id=?", (b.facility_id, b.start, u["id"])):
        x.c.execute("INSERT INTO waitlist(facility_id,start,user_id,created_at) VALUES(?,?,?,?)", (b.facility_id, b.start, u["id"], now(x.c)))
    return {"ok": True, "position": row(x.c, "SELECT COUNT(*) n FROM waitlist WHERE facility_id=? AND start=?", (b.facility_id, b.start))["n"]}


@app.get("/api/waitlist", tags=["reservas"])
def wait_list(x: Ctx = Depends(get_ctx)):
    u = need(x)
    return rows(x.c, "SELECT w.*,f.name facility FROM waitlist w JOIN facilities f ON f.id=w.facility_id WHERE w.user_id=? ORDER BY w.start", (u["id"],))


@app.post("/api/reservations/{rid}/paid", tags=["xestión"])
def res_paid(rid: int, x: Ctx = Depends(get_ctx)):
    need(x, "manager")
    x.c.execute("UPDATE reservations SET paid=1 WHERE id=?", (rid,))
    return {"ok": True}


# ---- calendario iCalendar --------------------------------------------------------------
def ics(x: Ctx, rs):
    def dt(ts):
        return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ponte en Pista//GL", "CALSCALE:GREGORIAN", "X-WR-CALNAME:As miñas reservas"]
    for r in rs:
        f = row(x.c, "SELECT name FROM facilities WHERE id=?", (r["facility_id"],))
        out += ["BEGIN:VEVENT", f"UID:res-{r['id']}@{x.t}.pista", f"DTSTAMP:{dt(now(x.c))}", f"DTSTART:{dt(r['start'])}", f"DTEND:{dt(r['end'])}",
                f"SUMMARY:{f['name']}", f"DESCRIPTION:Código alternativo {r['code']}", "STATUS:" + ("CANCELLED" if r["status"] == "cancelled" else "CONFIRMED"),
                "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "DESCRIPTION:Reserva en 1 hora", "END:VALARM", "END:VEVENT"]
    out.append("END:VCALENDAR")
    return "\r\n".join(out) + "\r\n"


@app.get("/api/reservations/{rid}/ics", tags=["reservas"])
def res_ics(rid: int, x: Ctx = Depends(get_ctx)):
    need(x)
    r = get_res(x, rid)
    return Response(ics(x, [r]), media_type="text/calendar; charset=utf-8", headers={"Content-Disposition": f"attachment; filename=reserva-{rid}.ics"})


@app.get("/api/ical/{token}.ics", tags=["reservas"])
def ical_feed(token: str, t: str = DEFAULT_TENANT):
    """Subscrición privada ás propias reservas (URL secreta)."""
    with conn(t) as c:
        u = row(c, "SELECT * FROM users WHERE cal_token=?", (token,))
        if not u:
            raise HTTPException(404)
        rs = rows(c, "SELECT * FROM reservations WHERE user_id=? AND start>? ORDER BY start", (u["id"], now(c) - 30 * 86400))
        return Response(ics(Ctx(c, t, u), rs), media_type="text/calendar; charset=utf-8")


# ---- acceso: porta, apertura desde o móbil, persoa validadora ---------------------------------
class OpenIn(BaseModel):
    pass


@app.post("/api/reservations/{rid}/open", tags=["acceso"])
def res_open(rid: int, x: Ctx = Depends(get_ctx)):
    """«Abrir a porta»: arma o pulsador durante 30 s. Só abre se a persoa preme o pulsador físico."""
    need(x)
    r = get_res(x, rid)
    out, why = device.arm(x.c, x.t, r, x.user)
    if why != "ok":
        raise HTTPException(409, {"code": why})
    return out


class ScanIn(BaseModel):
    text: str
    kind: str = "qr"


def door_pub(x: Ctx, did):
    d = device.dev(x.c, did)
    if not d:
        err("device_not_found", 404)
    return d


@app.get("/api/door/{did}", tags=["acceso"])
def door_state(did: str, x: Ctx = Depends(get_ctx)):
    d = door_pub(x, did)
    f = fac_row(x.c, d["facility_id"])
    st = device.state(x.c, did)
    st["facility"] = {"id": f["id"], "name": f["name"], "light_auto": f["light_auto"]}
    st["now"] = now(x.c)
    st["log"] = rows(x.c, "SELECT a.*,u.name,u.surname FROM access_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.facility_id=? ORDER BY a.ts DESC,a.id DESC LIMIT 12", (f["id"],))
    for l in st["log"]:
        l["who"] = initials({"name": l.pop("name"), "surname": l.pop("surname")}) if l["user_id"] else None
    st["local_log"] = json.loads(d["local_log"])
    st["pubkey"] = qr.public_key_b64(x.t)
    return st


@app.post("/api/door/{did}/scan", tags=["acceso"])
def door_scan(did: str, b: ScanIn, x: Ctx = Depends(get_ctx)):
    door_pub(x, did)
    return device.scan(x.c, x.t, did, b.text, b.kind)


@app.post("/api/door/{did}/button", tags=["acceso"])
def door_button(did: str, x: Ctx = Depends(get_ctx)):
    door_pub(x, did)
    return device.press(x.c, x.t, did)


class SensorIn(BaseModel):
    closed: bool


@app.post("/api/door/{did}/sensor", tags=["acceso"])
def door_sensor(did: str, b: SensorIn, x: Ctx = Depends(get_ctx)):
    door_pub(x, did)
    device.sensor(x.c, x.t, did, b.closed)
    return {"ok": True}


class OnlineIn(BaseModel):
    online: bool


@app.post("/api/door/{did}/online", tags=["acceso"])
def door_online(did: str, b: OnlineIn, x: Ctx = Depends(get_ctx)):
    door_pub(x, did)
    device.set_online(x.c, x.t, did, b.online)
    return {"ok": True}


@app.get("/api/door/{did}/mqtt", tags=["acceso"])
def door_mqtt(did: str, x: Ctx = Depends(get_ctx)):
    return rows(x.c, "SELECT * FROM mqtt_log WHERE topic LIKE ? ORDER BY id DESC LIMIT 25", (f"pista/{x.t}/{did}/%",))


@app.get("/api/devices", tags=["acceso"])
def devices(x: Ctx = Depends(get_ctx)):
    need(x, "manager", "tech")
    out = []
    for d in rows(x.c, "SELECT * FROM devices"):
        st = device.state(x.c, d["id"])
        f = fac_row(x.c, d["facility_id"])
        st["facility"] = f["name"]
        out.append(st)
    return out


@app.post("/api/devices/{did}/remote-open", tags=["acceso"])
def dev_remote_open(did: str, x: Ctx = Depends(get_ctx)):
    u = need(x, "manager")
    out = device.remote_open(x.c, x.t, did, f"{u['name']} (remoto)")
    audit(x.c, u["id"], "remote_open", {"device": did, **out})
    return out


def validator_scope(x: Ctx, fid):
    u = need(x, "validator", "manager")
    if u["role"] == "validator" and str(fid) not in (u["facility_scope"] or "").split(","):
        err("forbidden", 403)
    return u


@app.get("/api/validator/facilities", tags=["acceso"])
def val_facs(x: Ctx = Depends(get_ctx)):
    u = need(x, "validator", "manager")
    fs = rows(x.c, "SELECT id,name,access_mode FROM facilities WHERE access_mode='staff' AND parent_id IS NULL ORDER BY sort")
    sc = (u["facility_scope"] or "").split(",")
    return [f for f in fs if u["role"] == "manager" or str(f["id"]) in sc]


@app.get("/api/validator/day", tags=["acceso"])
def val_day(facility_id: int, x: Ctx = Depends(get_ctx)):
    """Lista do día da instalación (única información que ve a persoa validadora)."""
    validator_scope(x, facility_id)
    n = now(x.c)
    d0 = day_start(n)
    ids = domain.conflict_ids(x.c, facility_id)
    ids |= {r["id"] for r in rows(x.c, "SELECT id FROM facilities WHERE parent_id=?", (facility_id,))}
    rs = rows(x.c, f"SELECT r.*,u.name,u.surname,u.birth_year,f.name fname FROM reservations r JOIN users u ON u.id=r.user_id JOIN facilities f ON f.id=r.facility_id WHERE r.facility_id IN ({','.join('?' * len(ids))}) AND r.status IN ('confirmed','attended','no_show') AND r.start>=? AND r.start<? ORDER BY r.start", (*ids, d0, add_days(d0, 1)))
    return {"now": n, "items": [{"id": r["id"], "start": r["start"], "end": r["end"], "name": f"{r['name']} {r['surname'] or ''}".strip(), "initials": initials(r),
                                  "status": r["status"], "entered_at": r["entered_at"], "tariff": r["tariff"], "paid": r["paid"], "facility": r["fname"], "code": r["code"], "seasonal": r["seasonal"]} for r in rs]}


@app.post("/api/validator/scan", tags=["acceso"])
def val_scan(b: ScanIn, facility_id: int, x: Ctx = Depends(get_ctx)):
    u = validator_scope(x, facility_id)
    f = fac_row(x.c, facility_id)
    res, reason = device.validate(x.c, x.t, f, b.text, b.kind)
    who = None
    if res and res.get("user_id"):
        h = row(x.c, "SELECT * FROM users WHERE id=?", (res["user_id"],))
        who = {"name": f"{h['name']} {h['surname'] or ''}".strip(), "initials": initials(h)}
    ok = reason == "ok"
    x.c.execute("INSERT INTO access_log(ts,facility_id,reservation_id,user_id,medium,result,reason,actor) VALUES(?,?,?,?,?,?,?,?)",
                (now(x.c), facility_id, (res or {}).get("id"), (res or {}).get("user_id"), "validator", "ok" if ok else "denied", reason, f"{u['name']} {u['surname'] or ''}".strip()))
    if ok:
        device._mark_attended(x.c, res["id"], now(x.c), "ok")
    return {"ok": ok, "reason": reason, "who": who, "start": (res or {}).get("start"), "end": (res or {}).get("end"), "reservation_id": (res or {}).get("id"),
            "facility": row(x.c, "SELECT name FROM facilities WHERE id=?", ((res or {}).get("facility_id") or facility_id,))["name"]}


class CheckinIn(BaseModel):
    items: list[dict]


@app.post("/api/validator/checkin", tags=["acceso"])
def val_checkin(b: CheckinIn, facility_id: int, x: Ctx = Depends(get_ctx)):
    """Entradas marcadas a man (tamén as rexistradas sen conexión, que se envían ao recuperar a rede)."""
    u = validator_scope(x, facility_id)
    n = 0
    for it in b.items:
        r = row(x.c, "SELECT * FROM reservations WHERE id=?", (it.get("reservation_id"),))
        if not r or r["status"] == "cancelled":
            continue
        ts = it.get("ts") or now(x.c)
        x.c.execute("INSERT INTO access_log(ts,facility_id,reservation_id,user_id,medium,result,reason,actor) VALUES(?,?,?,?,?,?,?,?)",
                    (ts, r["facility_id"], r["id"], r["user_id"], "validator", "ok", "manual" + ("_offline" if it.get("offline") else ""), f"{u['name']} {u['surname'] or ''}".strip()))
        device._mark_attended(x.c, r["id"], ts, "ok")
        if r["status"] == "no_show":
            x.c.execute("UPDATE reservations SET status='attended' WHERE id=?", (r["id"],))
        n += 1
    return {"ok": True, "synced": n}


# ---- incidencias ---------------------------------------------------------------------------------
QUEUE = {"dirty": "operational", "damaged": "operational", "material": "operational", "cannot_enter": "operational", "other": "operational",
         "reader": "technical", "lock": "technical", "web": "technical", "door_left_open": "operational"}


class IncIn(BaseModel):
    reservation_id: Optional[int] = None
    facility_id: Optional[int] = None
    category: str
    text: str = ""


@app.post("/api/incidents", tags=["incidencias"])
def inc_create(b: IncIn, x: Ctx = Depends(get_ctx)):
    """«Teño un problema»: incidencia ligada á reserva. Operativa -> concello; técnica -> asistencia."""
    u = need(x)
    fid = b.facility_id
    if b.reservation_id:
        r = get_res(x, b.reservation_id)
        fid = r["facility_id"]
    if not fid:
        err("facility_required")
    q = QUEUE.get(b.category, "operational")
    iid = x.c.execute("INSERT INTO incidents(reservation_id,facility_id,user_id,ts,category,queue,text) VALUES(?,?,?,?,?,?,?)",
                      (b.reservation_id, fid, u["id"], now(x.c), b.category, q, b.text)).lastrowid
    f = fac_row(x.c, fid)
    targets = rows(x.c, "SELECT id FROM users WHERE role=?", ("tech" if q == "technical" else "manager",))
    for t in targets:
        notify(x.c, t["id"], "incident_new", {"facility": f["name"], "category": b.category, "id": iid})
    return row(x.c, "SELECT * FROM incidents WHERE id=?", (iid,))


@app.get("/api/incidents", tags=["incidencias"])
def inc_list(x: Ctx = Depends(get_ctx)):
    u = need(x)
    base = "SELECT i.*,f.name facility,u.name uname,u.surname usurname FROM incidents i JOIN facilities f ON f.id=i.facility_id LEFT JOIN users u ON u.id=i.user_id"
    if u["role"] == "manager":
        rs = rows(x.c, base + " ORDER BY i.status='closed', i.ts DESC LIMIT 200")
    elif u["role"] == "tech":
        rs = rows(x.c, base + " WHERE i.queue='technical' ORDER BY i.status='closed', i.ts DESC LIMIT 200")
    else:
        ids = [u["id"]] + [m["id"] for m in rows(x.c, "SELECT id FROM users WHERE tutor_id=?", (u["id"],))]
        rs = rows(x.c, base + f" WHERE i.user_id IN ({','.join('?' * len(ids))}) ORDER BY i.ts DESC", tuple(ids))
    for r in rs:
        r["notes"] = json.loads(r["notes"])
        r["who"] = initials({"name": r.pop("uname"), "surname": r.pop("usurname")}) if r["user_id"] else None
    return rs


class IncPatch(BaseModel):
    status: Optional[str] = None
    note: Optional[str] = None
    queue: Optional[str] = None


@app.patch("/api/incidents/{iid}", tags=["incidencias"])
def inc_patch(iid: int, b: IncPatch, x: Ctx = Depends(get_ctx)):
    u = need(x, "manager", "tech")
    i = row(x.c, "SELECT * FROM incidents WHERE id=?", (iid,))
    if not i:
        err("not_found", 404)
    notes = json.loads(i["notes"])
    if b.note:
        notes.append({"ts": now(x.c), "by": f"{u['name']} {u['surname'] or ''}".strip(), "text": b.note})
    st = b.status or i["status"]
    x.c.execute("UPDATE incidents SET notes=?, status=?, queue=?, closed_at=? WHERE id=?",
                (json.dumps(notes, ensure_ascii=False), st, b.queue or i["queue"], now(x.c) if st == "closed" else None, iid))
    if i["user_id"] and (b.status or b.note):
        notify(x.c, i["user_id"], "incident_update", {"id": iid, "status": st})
    return {"ok": True}


# ---- persoas (alta presencial) e xestión ------------------------------------------------------------
@app.get("/api/users", tags=["xestión"])
def users_list(q: str = "", x: Ctx = Depends(get_ctx)):
    need(x, "manager")
    like = f"%{q.lower()}%"
    rs = rows(x.c, "SELECT * FROM users WHERE active=1 AND role='citizen' AND (lower(name||' '||COALESCE(surname,'')||' '||COALESCE(email,'')) LIKE ?) ORDER BY surname,name LIMIT 60", (like,))
    return [pub_user(u, x.c) for u in rs]


class NewUser(BaseModel):
    name: str
    surname: str = ""
    email: str = ""
    phone: str = ""
    birth_year: int = 1985
    doc_checked: bool = True
    empadronado: bool = False
    reduced: bool = False
    club: bool = False


@app.post("/api/users", tags=["xestión"])
def users_create(b: NewUser, x: Ctx = Depends(get_ctx)):
    """Alta presencial / telefónica: a persoa xestora comproba o documento (nivel 2) e rexistra as normas."""
    u = need(x, "manager")
    nid = x.c.execute("INSERT INTO users(name,surname,email,phone,level,empadronado,reduced,club,birth_year,id_method,doc_checked,cal_token,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (b.name, b.surname, b.email, b.phone, 2 if b.doc_checked else 1, int(b.empadronado), int(b.reduced), int(b.club), b.birth_year, "presencial",
                       int(b.doc_checked), secrets.token_urlsafe(12), now(x.c))).lastrowid
    audit(x.c, u["id"], "user_create_assisted", {"id": nid})
    return pub_user(row(x.c, "SELECT * FROM users WHERE id=?", (nid,)), x.c)


class UserPatch(BaseModel):
    empadronado: Optional[bool] = None
    reduced: Optional[bool] = None
    club: Optional[bool] = None
    level: Optional[int] = None


@app.patch("/api/users/{uid}", tags=["xestión"])
def users_patch(uid: int, b: UserPatch, x: Ctx = Depends(get_ctx)):
    """A condición de empadroado márcaa o propio concello, que é quen pode comprobar o padrón."""
    u = need(x, "manager")
    for k, v in b.model_dump(exclude_none=True).items():
        x.c.execute(f"UPDATE users SET {k}=? WHERE id=?", (int(v), uid))
    audit(x.c, u["id"], "user_update", {"id": uid, **b.model_dump(exclude_none=True)})
    return pub_user(row(x.c, "SELECT * FROM users WHERE id=?", (uid,)), x.c)


@app.get("/api/access", tags=["xestión"])
def access_list(facility_id: Optional[int] = None, limit: int = 120, x: Ctx = Depends(get_ctx)):
    need(x, "manager", "tech")
    q = "SELECT a.*,f.name facility,u.name uname,u.surname usurname FROM access_log a JOIN facilities f ON f.id=a.facility_id LEFT JOIN users u ON u.id=a.user_id"
    a = []
    if facility_id:
        q += " WHERE a.facility_id=?"
        a.append(facility_id)
    q += " ORDER BY a.ts DESC, a.id DESC LIMIT ?"
    a.append(limit)
    rs = rows(x.c, q, tuple(a))
    for r in rs:
        r["who"] = initials({"name": r.pop("uname"), "surname": r.pop("usurname")}) if r["user_id"] else None
    return rs


@app.get("/api/me/access", tags=["reservas"])
def my_access(x: Ctx = Depends(get_ctx)):
    u = need(x)
    return rows(x.c, "SELECT a.*,f.name facility FROM access_log a JOIN facilities f ON f.id=a.facility_id WHERE a.user_id=? ORDER BY a.ts DESC LIMIT 40", (u["id"],))


@app.get("/api/audit", tags=["xestión"])
def audit_list(x: Ctx = Depends(get_ctx)):
    need(x, "manager")
    return rows(x.c, "SELECT a.*,u.name,u.surname FROM audit a LEFT JOIN users u ON u.id=a.actor ORDER BY a.id DESC LIMIT 60")


# ---- normas, tempadas --------------------------------------------------------------------------------
@app.get("/api/norms", tags=["xestión"])
def norms(x: Ctx = Depends(get_ctx)):
    ns = rows(x.c, "SELECT * FROM norms ORDER BY version DESC")
    for n in ns:
        n["accepted"] = row(x.c, "SELECT COUNT(*) n FROM norm_acceptances WHERE version=?", (n["version"],))["n"]
    return ns


class NormIn(BaseModel):
    text_gl: str
    text_es: str


@app.post("/api/norms", tags=["xestión"])
def norms_new(b: NormIn, x: Ctx = Depends(get_ctx)):
    u = need(x, "manager")
    v = row(x.c, "SELECT MAX(version)+1 v FROM norms")["v"]
    x.c.execute("INSERT INTO norms VALUES(?,?,?,?)", (v, now(x.c), b.text_gl, b.text_es))
    audit(x.c, u["id"], "norms_publish", {"version": v})
    return {"version": v}


@app.get("/api/seasons", tags=["xestión"])
def seasons(x: Ctx = Depends(get_ctx)):
    need(x, "manager")
    return rows(x.c, "SELECT s.*,f.name facility,u.name uname,u.surname usurname FROM seasons s JOIN facilities f ON f.id=s.facility_id JOIN users u ON u.id=s.user_id ORDER BY s.id DESC")


class SeasonIn(BaseModel):
    facility_id: int
    user_id: int
    weekday: int
    start_hm: str
    date_from: str
    date_to: str
    label: str = ""


@app.post("/api/seasons", tags=["xestión"])
def season_create(b: SeasonIn, x: Ctx = Depends(get_ctx)):
    """Reserva de tempada para un club ou escola: non conta para os límites persoais."""
    u = need(x, "manager")
    f = fac_row(x.c, b.facility_id)
    h = row(x.c, "SELECT * FROM users WHERE id=?", (b.user_id,))
    ok, skipped = 0, []
    d = datetime.strptime(b.date_from, "%Y-%m-%d")
    end = datetime.strptime(b.date_to, "%Y-%m-%d")
    while d <= end:
        if d.weekday() == b.weekday:
            s = at(d.strftime("%Y-%m-%d"), b.start_hm)
            e = s + f["slot_minutes"] * 60
            if s > now(x.c) and (s, e) in domain.slots_for_day(x.c, f, s) and not domain.taken(x.c, f["id"], s, e):
                domain.create(x.c, x.t, h, f, s, u["id"], "office", seasonal=True)
                ok += 1
            elif s > now(x.c):
                skipped.append(b.start_hm and d.strftime("%Y-%m-%d"))
        d = datetime.fromtimestamp(d.timestamp() + 86400)
    sid = x.c.execute("INSERT INTO seasons(facility_id,user_id,weekday,start_hm,end_hm,date_from,date_to,label) VALUES(?,?,?,?,?,?,?,?)",
                      (b.facility_id, b.user_id, b.weekday, b.start_hm, "", b.date_from, b.date_to, b.label)).lastrowid
    audit(x.c, u["id"], "season_create", {"id": sid, "created": ok, "skipped": len(skipped)})
    return {"id": sid, "created": ok, "skipped": skipped}


# ---- indicadores e exportación ------------------------------------------------------------------------
@app.get("/api/stats", tags=["xestión"])
def stats(days: int = 30, x: Ctx = Depends(get_ctx)):
    need(x, "manager", "tech")
    n = now(x.c)
    d1 = day_start(n)
    d0 = add_days(d1, -days)
    out = {"days": days, "facilities": [], "channels": {}, "status": {}, "incidents": {}, "access": {}}
    for f in rows(x.c, "SELECT * FROM facilities WHERE parent_id IS NULL OR 1 ORDER BY sort"):
        tot = booked = 0
        heat = {}
        for i in range(-days, 0):
            dts = add_days(d1, i)
            sl = domain.slots_for_day(x.c, f, dts)
            tot += len(sl)
        rs = rows(x.c, "SELECT * FROM reservations WHERE facility_id=? AND start>=? AND start<? AND status IN ('attended','no_show','confirmed')", (f["id"], d0, d1))
        booked = len(rs)
        for r in rs:
            k = f"{loc(r['start']).weekday()}-{loc(r['start']).hour}"
            heat[k] = heat.get(k, 0) + 1
        w0, w1 = week_bounds(n)
        wk_tot = sum(len(domain.slots_for_day(x.c, f, add_days(w0, i))) for i in range(7))
        wk = row(x.c, "SELECT COUNT(*) n FROM reservations WHERE facility_id=? AND start>=? AND start<? AND status IN ('attended','no_show','confirmed')", (f["id"], w0, w1))["n"]
        ns = row(x.c, "SELECT COUNT(*) n FROM reservations WHERE facility_id=? AND start>=? AND start<? AND status='no_show'", (f["id"], d0, d1))["n"]
        out["facilities"].append({"id": f["id"], "name": f["name"], "occupancy": round(booked / tot, 3) if tot else 0, "booked": booked, "slots": tot, "no_show": ns,
                                  "week_occupancy": round(wk / wk_tot, 3) if wk_tot else 0, "heat": heat, "parent_id": f["parent_id"], "color": f["color"]})
    for r in rows(x.c, "SELECT channel,COUNT(*) n FROM reservations WHERE start>=? AND start<? AND status!='cancelled' GROUP BY channel", (d0, add_days(d1, 14))):
        out["channels"][r["channel"]] = r["n"]
    for r in rows(x.c, "SELECT status,COUNT(*) n FROM reservations WHERE start>=? AND start<? GROUP BY status", (d0, d1)):
        out["status"][r["status"]] = r["n"]
    for r in rows(x.c, "SELECT queue||'/'||status k,COUNT(*) n FROM incidents GROUP BY k"):
        out["incidents"][r["k"]] = r["n"]
    for r in rows(x.c, "SELECT medium,COUNT(*) n FROM access_log WHERE ts>=? AND result='ok' GROUP BY medium", (d0,)):
        out["access"][r["medium"]] = r["n"]
    out["denied"] = row(x.c, "SELECT COUNT(*) n FROM access_log WHERE ts>=? AND result!='ok'", (d0,))["n"]
    out["now"] = n
    return out


@app.get("/api/stats/recommend", tags=["catálogo"])
def recommend(facility_id: int, x: Ctx = Depends(get_ctx)):
    """Franxas con menos demanda, calculadas con estatística sobre os datos do propio concello (sen IA nin servizos externos)."""
    f = fac_row(x.c, facility_id)
    n = now(x.c)
    d1 = day_start(n)
    hist = {}
    cnt = {}
    for i in range(-56, 0):
        dts = add_days(d1, i)
        wd = loc(dts).weekday()
        for (s, e) in domain.slots_for_day(x.c, f, dts):
            k = (wd, loc(s).hour)
            cnt[k] = cnt.get(k, 0) + 1
    for r in rows(x.c, "SELECT start FROM reservations WHERE facility_id=? AND start>=? AND start<? AND status IN ('attended','no_show','confirmed')", (facility_id, add_days(d1, -56), d1)):
        k = (loc(r["start"]).weekday(), loc(r["start"]).hour)
        hist[k] = hist.get(k, 0) + 1
    rate = {k: hist.get(k, 0) / v for k, v in cnt.items() if v}
    av = domain.availability(x.c, f, n, 14, x.user)
    out = []
    for d in av:
        for s in d["slots"]:
            if s["state"] == "free":
                out.append({"start": s["start"], "end": s["end"], "demand": round(rate.get((d["weekday"], loc(s["start"]).hour), 0), 2)})
    out.sort(key=lambda z: (z["demand"], z["start"]))
    return {"items": out[:5], "method": "statistics"}


def _tocsv(rs):
    if not rs:
        return ""
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(rs[0].keys()))
    w.writeheader()
    w.writerows(rs)
    return buf.getvalue()


@app.get("/api/export/{kind}.{fmt}", tags=["xestión"])
def export(kind: str, fmt: str, x: Ctx = Depends(get_ctx)):
    """Exportación completa en formatos abertos (CSV e JSON)."""
    need(x, "manager")
    q = {"reservations": "SELECT id,facility_id,user_id,start,end,status,channel,tariff,price,paid,created_at,cancelled_at,late_cancel,seasonal FROM reservations ORDER BY start",
         "access": "SELECT * FROM access_log ORDER BY ts", "incidents": "SELECT id,reservation_id,facility_id,ts,category,queue,status,closed_at FROM incidents",
         "facilities": "SELECT * FROM facilities", "users": "SELECT id,name,surname,email,phone,role,level,empadronado,reduced,club,birth_year FROM users WHERE active=1"}.get(kind)
    if not q:
        err("unknown_export", 404)
    rs = rows(x.c, q)
    if fmt == "json":
        return JSONResponse(rs, headers={"Content-Disposition": f"attachment; filename={kind}.json"})
    return PlainTextResponse(_tocsv(rs), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f"attachment; filename={kind}.csv"})


class ImportIn(BaseModel):
    csv: str


@app.post("/api/import/facilities", tags=["xestión"])
def import_fac(b: ImportIn, x: Ctx = Depends(get_ctx)):
    """Importa instalacións desde unha folla de cálculo (CSV): name,sport,access_mode,slot_minutes,open,close,price_general,price_padron,min_level"""
    u = need(x, "manager")
    n = 0
    for r in csv.DictReader(io.StringIO(b.csv.strip())):
        if not r.get("name"):
            continue
        o, cl = r.get("open") or "09:00", r.get("close") or "21:00"
        sch = {s: {str(i): [o, cl] for i in range(7)} for s in ("winter", "summer")}
        pr = {"general": float(r.get("price_general") or 0)}
        if r.get("price_padron"):
            pr["padron"] = float(r["price_padron"])
        mode = r.get("access_mode") or "staff"
        f = {"name": r["name"], "sport": r.get("sport") or "other", "access_mode": mode, "slot_minutes": int(r.get("slot_minutes") or 60), "schedule": json.dumps(sch),
             "prices": json.dumps(pr), "min_level": int(r.get("min_level") or 1)}
        if mode == "door":
            f["device_id"] = "porta-" + secrets.token_hex(2)
        fid = x.c.execute(f"INSERT INTO facilities({','.join(f)}) VALUES({','.join('?' * len(f))})", tuple(f.values())).lastrowid
        device.ensure(x.c, fac_row(x.c, fid))
        n += 1
    audit(x.c, u["id"], "import_facilities", {"n": n})
    return {"imported": n}


# ---- formación ----------------------------------------------------------------------------------------------
@app.get("/api/courses", tags=["formación"])
def courses(x: Ctx = Depends(get_ctx)):
    prog = {}
    if x.user:
        for p in rows(x.c, "SELECT * FROM course_progress WHERE user_id=?", (x.user["id"],)):
            prog[p["course"]] = p
    return [{**c, "progress": prog.get(c["id"])} for c in COURSES]


class CourseIn(BaseModel):
    score: int


@app.post("/api/courses/{cid}/done", tags=["formación"])
def course_done(cid: str, b: CourseIn, x: Ctx = Depends(get_ctx)):
    u = need(x)
    x.c.execute("DELETE FROM course_progress WHERE user_id=? AND course=?", (u["id"], cid))
    x.c.execute("INSERT INTO course_progress(user_id,course,done,score) VALUES(?,?,?,?)", (u["id"], cid, "[]", b.score))
    return {"ok": True}


# ---- demo: reloxo e reinicio -----------------------------------------------------------------------------------
class ClockIn(BaseModel):
    offset: Optional[int] = None
    add_minutes: Optional[int] = None
    reset: bool = False


@app.post("/api/demo/clock", tags=["demo"])
def clock(b: ClockIn, x: Ctx = Depends(get_ctx)):
    """Move o reloxo da demo para poder probar a porta á hora dunha reserva. Non existe na versión de produción."""
    cur = kv_get(x.c, "clock_offset", 0)
    off = 0 if b.reset else (b.offset if b.offset is not None else cur + (b.add_minutes or 0) * 60)
    kv_set(x.c, "clock_offset", off)
    return {"offset": off, "now": now(x.c)}


@app.post("/api/demo/jump/{rid}", tags=["demo"])
def jump(rid: int, x: Ctx = Depends(get_ctx)):
    r = row(x.c, "SELECT * FROM reservations WHERE id=?", (rid,))
    if not r:
        err("not_found", 404)
    off = (r["start"] + 120) - int(time.time())
    kv_set(x.c, "clock_offset", off)
    for d in rows(x.c, "SELECT id FROM devices"):
        device.sync(x.c, x.t, fac_row(x.c, row(x.c, "SELECT facility_id FROM devices WHERE id=?", (d["id"],))["facility_id"]))
    return {"offset": off, "now": now(x.c)}


@app.post("/api/demo/reset", tags=["demo"])
def reset(request: Request, x_tenant: Optional[str] = Header(None)):
    """Restaura os datos de proba do concello."""
    t = x_tenant or request.query_params.get("t") or DEFAULT_TENANT
    if t not in tenant_ids():
        raise HTTPException(404, "tenant_unknown")
    seed.reset(t)
    return {"ok": True}


# ---- estáticos / PWA ------------------------------------------------------------------------------------------------
@app.get("/", include_in_schema=False)
def index():
    return FileResponse(os.path.join(STATIC, "index.html"), headers={"Cache-Control": "no-cache"})


@app.get("/sw.js", include_in_schema=False)
def sw():
    return FileResponse(os.path.join(STATIC, "sw.js"), media_type="application/javascript", headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})


app.mount("/static", StaticFiles(directory=STATIC), name="static")
