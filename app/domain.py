# SPDX-License-Identifier: AGPL-3.0-or-later
"""Lóxica de negocio: horarios, franxas, regras de reparto, tarifas, reservas."""
import json
import random
import string
from datetime import datetime

from . import qr
from .core import (TZ, add_days, at, day_start, eff_rules, initials, kv_get, loc, notify, now, row, rows,
                   tenant_cfg, week_bounds, audit)

ACTIVE = ("confirmed", "attended")


def age(u, c):
    if not u or not u.get("birth_year"):
        return 99
    return loc(now(c)).year - u["birth_year"]


def is_minor(u, c):
    return age(u, c) < 18


# ---- horarios --------------------------------------------------------------
def season_of(c, ts):
    cfg = tenant_cfg(c)
    a, b = cfg.get("summer", ["06-15", "09-15"])
    md = loc(ts).strftime("%m-%d")
    return "summer" if a <= md <= b else "winter"


def day_hours(c, fac, ts):
    """Devolve (open_hm, close_hm) para o día ou None se pechado."""
    d = loc(ts)
    ds = d.strftime("%Y-%m-%d")
    cfg = tenant_cfg(c)
    if ds in cfg.get("holidays", []) or ds in json.loads(fac.get("closed_dates") or "[]"):
        return None
    sch = json.loads(fac["schedule"])
    s = sch.get(season_of(c, ts)) or sch.get("winter")
    h = s.get(str(d.weekday()))
    return tuple(h) if h else None


def slots_for_day(c, fac, ts):
    h = day_hours(c, fac, ts)
    if not h:
        return []
    ds = loc(ts).strftime("%Y-%m-%d")
    t0, t1 = at(ds, h[0]), at(ds, h[1])
    step = fac["slot_minutes"] * 60
    out = []
    t = t0
    while t + step <= t1:
        out.append((t, t + step))
        t += step
    return out


def conflict_ids(c, fid):
    """Instalación, as súas partes e a instalación pai (as partes irmás non entran en conflito)."""
    f = row(c, "SELECT id,parent_id FROM facilities WHERE id=?", (fid,))
    ids = {fid} | {r["id"] for r in rows(c, "SELECT id FROM facilities WHERE parent_id=?", (fid,))}
    if f and f["parent_id"]:
        ids.add(f["parent_id"])
    return ids


def taken(c, fid, start, end, exclude=None):
    ids = conflict_ids(c, fid)
    q = ",".join("?" * len(ids))
    sql = f"SELECT * FROM reservations WHERE facility_id IN ({q}) AND status IN ('confirmed','attended') AND start<? AND end>?"
    args = list(ids) + [end, start]
    if exclude:
        sql += " AND id!=?"
        args.append(exclude)
    return row(c, sql, tuple(args))


# ---- tarifas ---------------------------------------------------------------
def tariff_for(u, fac):
    """Escolle a tarifa aplicable á persoa titular. Devolve (nome, prezo)."""
    prices = json.loads(fac["prices"] or "{}")
    cands = []
    if u.get("club") and "club" in prices:
        cands.append(("club", prices["club"]))
    if u.get("empadronado") and u["level"] >= 2 and "padron" in prices:
        cands.append(("padron", prices["padron"]))
    if u.get("reduced") and u["level"] >= 2 and "reduced" in prices:
        cands.append(("reduced", prices["reduced"]))
    cands.append(("general", prices.get("general", 0)))
    return min(cands, key=lambda x: x[1])


# ---- regras ----------------------------------------------------------------
def counters(c, u, fac, start, exclude=None):
    ex = " AND id!=%d" % exclude if exclude else ""
    n = now(c)
    pend = rows(c, f"SELECT * FROM reservations WHERE user_id=? AND status='confirmed' AND seasonal=0 AND end>?{ex}", (u["id"], n))
    w0, w1 = week_bounds(start)
    wk = rows(c, f"SELECT * FROM reservations WHERE user_id=? AND status IN ('confirmed','attended','no_show') AND seasonal=0 AND start>=? AND start<?{ex}", (u["id"], w0, w1))
    d0 = day_start(start)
    d1 = add_days(d0, 1)
    dy = rows(c, f"SELECT * FROM reservations WHERE user_id=? AND status IN ('confirmed','attended','no_show') AND seasonal=0 AND start>=? AND start<?{ex}", (u["id"], d0, d1))
    return pend, wk, dy


def strikes(c, u, rules):
    n = now(c)
    s = rows(c, "SELECT * FROM reservations WHERE user_id=? AND (status='no_show' OR late_cancel=1) AND COALESCE(cancelled_at,end)>?", (u["id"], n - 60 * 86400))
    s.sort(key=lambda r: r["cancelled_at"] or r["end"])
    return s


def ban_until(c, u, rules):
    s = strikes(c, u, rules)
    if len(s) >= rules["strike_threshold"]:
        t = (s[-1]["cancelled_at"] or s[-1]["end"]) + rules["ban_days"] * 86400
        if t > now(c):
            return t
    return None


def check(c, u, fac, start, end, booked_by=None, exclude=None):
    """Lista de incumprimentos de regras: [{code, params, until?}]. u = persoa titular."""
    v = []
    n = now(c)
    rules = eff_rules(c, fac)
    if fac["status"] != "open":
        v.append({"code": "facility_closed", "params": {"reason": fac.get("closed_reason")}})
        return v
    if (start, end) not in slots_for_day(c, fac, start):
        v.append({"code": "not_a_slot"})
        return v
    grace = rules["open_grace_min"] * 60
    if end <= n:
        v.append({"code": "past"})
        return v
    if taken(c, fac["id"], start, end, exclude):
        v.append({"code": "taken"})
    # ventá de reserva (empadroados abren antes)
    win = rules["window_days"]
    early = rules["padron_early_days"]
    resident = u.get("empadronado") and u["level"] >= 2
    eff = win if resident else win - early
    limit = day_start(add_days(n, eff + 1))
    if start >= limit:
        opens = day_start(add_days(start, -eff))
        v.append({"code": "beyond_window", "params": {"days": eff, "limit": limit - 1}, "until": opens})
    if u["level"] < fac["min_level"]:
        v.append({"code": "level_required", "params": {"level": fac["min_level"]}})
    # menores
    if is_minor(u, c):
        if not fac["allow_minors"]:
            v.append({"code": "minor_not_allowed"})
        if age(u, c) >= 14 and not u["authorised"]:
            v.append({"code": "minor_not_authorised"})
    # normas
    cur = row(c, "SELECT MAX(version) v FROM norms")["v"]
    payer = u
    if u.get("tutor_id") and age(u, c) < 14:
        payer = row(c, "SELECT * FROM users WHERE id=?", (u["tutor_id"],)) or u
    acc = row(c, "SELECT 1 FROM norm_acceptances WHERE user_id=? AND version=?", (payer["id"], cur))
    if not acc:
        v.append({"code": "norms_not_accepted", "params": {"version": cur}})
    if u.get("club"):
        return v
    # límites persoais
    pend, wk, dy = counters(c, u, fac, start, exclude)
    if len(pend) >= rules["max_pending"]:
        free_at = min(r["end"] for r in pend)
        v.append({"code": "max_pending", "params": {"max": rules["max_pending"]}, "until": free_at})
    if len(wk) >= rules["max_week"]:
        v.append({"code": "max_week", "params": {"max": rules["max_week"]}, "until": week_bounds(start)[1]})
    if len(dy) >= rules["max_day"]:
        v.append({"code": "max_day", "params": {"max": rules["max_day"]}, "until": add_days(day_start(start), 1)})
    elif rules["no_consecutive"] and any(abs(r["start"] - end) < 1 or abs(r["end"] - start) < 1 for r in dy):
        v.append({"code": "consecutive"})
    if rules["cooldown_hours"]:
        last = row(c, "SELECT created_at FROM reservations WHERE user_id=? AND facility_id=? AND seasonal=0 AND status IN ('confirmed','attended','no_show') AND id!=? ORDER BY created_at DESC LIMIT 1",
                   (u["id"], fac["id"], exclude or 0))
        if last and last["created_at"] + rules["cooldown_hours"] * 3600 > n:
            v.append({"code": "cooldown", "params": {"hours": rules["cooldown_hours"]}, "until": last["created_at"] + rules["cooldown_hours"] * 3600})
    b = ban_until(c, u, rules)
    if b:
        v.append({"code": "ban", "params": {"days": rules["ban_days"]}, "until": b})
    return v


def limits_summary(c, u, fac, start):
    rules = eff_rules(c, fac)
    pend, wk, dy = counters(c, u, fac, start)
    return {"pending": len(pend), "max_pending": rules["max_pending"], "week": len(wk), "max_week": rules["max_week"],
            "day": len(dy), "max_day": rules["max_day"], "rules": rules,
            "ban_until": ban_until(c, u, rules), "strikes": len(strikes(c, u, rules))}


# ---- franxas para a web -----------------------------------------------------
def availability(c, fac, start_ts, days, user=None):
    n = now(c)
    rules = eff_rules(c, fac)
    resident = bool(user and user.get("empadronado") and user["level"] >= 2)
    eff = rules["window_days"] if resident else rules["window_days"] - rules["padron_early_days"]
    gen_limit = day_start(add_days(n, rules["window_days"] - rules["padron_early_days"] + 1))
    res_limit = day_start(add_days(n, rules["window_days"] + 1))
    ids = conflict_ids(c, fac["id"])
    q = ",".join("?" * len(ids))
    d0 = day_start(start_ts)
    d1 = add_days(d0, days)
    rs = rows(c, f"SELECT id,facility_id,user_id,start,end,status,seasonal FROM reservations WHERE facility_id IN ({q}) AND status IN ('confirmed','attended') AND start<? AND end>?", tuple(ids) + (d1, d0))
    out = []
    for i in range(days):
        dts = add_days(d0, i)
        ds = loc(dts).strftime("%Y-%m-%d")
        sl = []
        for (s, e) in slots_for_day(c, fac, dts):
            hit = next((r for r in rs if r["start"] < e and r["end"] > s), None)
            state = "free"
            extra = {}
            if fac["status"] != "open":
                state = "closed"
            elif e <= n:
                state = "past"
            elif hit:
                state = "mine" if (user and hit["user_id"] == user["id"] and hit["facility_id"] == fac["id"]) else "taken"
                if state == "mine":
                    extra["reservation_id"] = hit["id"]
                if hit["seasonal"]:
                    extra["season"] = True
            elif s >= res_limit:
                state = "beyond"
            elif s >= gen_limit and not resident:
                state = "resident_only"
                extra["opens"] = day_start(add_days(s, -(rules["window_days"] - rules["padron_early_days"])))
            sl.append({"start": s, "end": e, "state": state, **extra})
        out.append({"date": ds, "ts": dts, "weekday": loc(dts).weekday(), "slots": sl, "closed": not sl})
    return out


def next_free(c, fac, user=None):
    n = now(c)
    for d in availability(c, fac, n, 14, user):
        for s in d["slots"]:
            if s["state"] == "free":
                return s["start"]
    return None


# ---- crear/cambiar/cancelar -------------------------------------------------
def new_code(c):
    while True:
        code = "".join(random.choice(string.digits) for _ in range(6))
        if not row(c, "SELECT 1 FROM reservations WHERE code=? AND status='confirmed'", (code,)):
            return code


def create(c, t, u, fac, start, booked_by, channel="web", note=None, seasonal=False, delivery=None, qr_for_minor=False):
    end = start + fac["slot_minutes"] * 60
    tname, price = tariff_for(u, fac)
    code = new_code(c)
    import secrets as _s
    cur = c.execute(
        "INSERT INTO reservations(facility_id,user_id,booked_by,start,end,status,channel,tariff,price,paid,code,nonce,created_at,note,seasonal,delivery,qr_for_minor) "
        "VALUES(?,?,?,?,?,'confirmed',?,?,?,?,?,?,?,?,?,?,?)",
        (fac["id"], u["id"], booked_by, start, end, channel, tname, price, 1 if price == 0 else 0, code, _s.token_hex(6), now(c), note,
         1 if seasonal else 0, delivery, 1 if qr_for_minor else 0))
    rid = cur.lastrowid
    res = row(c, "SELECT * FROM reservations WHERE id=?", (rid,))
    if not seasonal:
        notify(c, u["id"], "booking_confirmed", {"res": rid, "facility": fac["name"], "start": start})
        if u.get("tutor_id") and booked_by != u["tutor_id"]:
            notify(c, u["tutor_id"], "booking_confirmed", {"res": rid, "facility": fac["name"], "start": start})
    from . import device
    device.sync(c, t, fac)
    return res


def cancel(c, t, res, actor, reason="user"):
    fac = row(c, "SELECT * FROM facilities WHERE id=?", (res["facility_id"],))
    rules = eff_rules(c, fac)
    n = now(c)
    late = 1 if (reason == "user" and res["start"] - n < rules["cancel_hours"] * 3600 and not res["seasonal"]) else 0
    c.execute("UPDATE reservations SET status='cancelled', cancelled_at=?, late_cancel=?, note=COALESCE(note,'')||? WHERE id=?",
              (n, late, f" [cancel:{reason}]", res["id"]))
    from . import device
    device.revoke(c, t, res)
    device.sync(c, t, fac)
    if reason != "user":
        notify(c, res["user_id"], "booking_cancelled_" + reason, {"res": res["id"], "facility": fac["name"], "start": res["start"]})
    # lista de espera: avisa á primeira persoa
    wl = row(c, "SELECT * FROM waitlist WHERE facility_id=? AND start=? ORDER BY created_at LIMIT 1", (fac["id"], res["start"]))
    if wl:
        notify(c, wl["user_id"], "waitlist_free", {"facility": fac["name"], "start": res["start"], "facility_id": fac["id"]})
        c.execute("DELETE FROM waitlist WHERE id=?", (wl["id"],))
    return late


def view(c, r, with_secret=True):
    """Reserva enriquecida para a UI."""
    fac = row(c, "SELECT id,name,access_mode,device_id,sport FROM facilities WHERE id=?", (r["facility_id"],))
    u = row(c, "SELECT id,name,surname,tutor_id,birth_year FROM users WHERE id=?", (r["user_id"],))
    d = dict(r)
    d["facility"] = fac
    d["holder"] = {"id": u["id"], "name": f"{u['name']} {u['surname'] or ''}".strip(), "initials": initials(u), "minor": is_minor(u, c)} if u else None
    if not with_secret:
        d.pop("code", None)
        d.pop("nonce", None)
    return d
