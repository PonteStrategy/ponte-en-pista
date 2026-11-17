# SPDX-License-Identifier: AGPL-3.0-or-later
"""Núcleo: base de datos por concello (SQLite), tempo, configuración e sesións."""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

DATA_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data"))
DATA_DIR = os.path.abspath(DATA_DIR)
os.makedirs(DATA_DIR, exist_ok=True)
TZ = ZoneInfo("Europe/Madrid")
DEFAULT_TENANT = os.environ.get("DEFAULT_TENANT", "vilaverde")

SCHEMA = """
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT, surname TEXT, email TEXT, phone TEXT,
  role TEXT DEFAULT 'citizen', level INTEGER DEFAULT 1, empadronado INTEGER DEFAULT 0,
  reduced INTEGER DEFAULT 0, club INTEGER DEFAULT 0, birth_year INTEGER,
  tutor_id INTEGER, authorised INTEGER DEFAULT 0, id_method TEXT, doc_checked INTEGER DEFAULT 0,
  password TEXT, passkey INTEGER DEFAULT 0, notif_email INTEGER DEFAULT 1, notif_push INTEGER DEFAULT 0,
  cal_token TEXT, facility_scope TEXT, active INTEGER DEFAULT 1, created_at INTEGER, lang TEXT DEFAULT 'gl');
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS facilities(
  id INTEGER PRIMARY KEY, name TEXT, sport TEXT, description TEXT, access_mode TEXT DEFAULT 'staff',
  slot_minutes INTEGER DEFAULT 60, schedule TEXT, closed_dates TEXT DEFAULT '[]',
  prices TEXT, rules TEXT DEFAULT '{}', accessibility TEXT, norms TEXT, status TEXT DEFAULT 'open',
  closed_reason TEXT, parent_id INTEGER, min_level INTEGER DEFAULT 1, allow_minors INTEGER DEFAULT 0,
  device_id TEXT, light_auto INTEGER DEFAULT 0, color TEXT, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS reservations(
  id INTEGER PRIMARY KEY, facility_id INTEGER, user_id INTEGER, booked_by INTEGER, start INTEGER, end INTEGER,
  status TEXT DEFAULT 'confirmed', channel TEXT DEFAULT 'web', tariff TEXT, price REAL DEFAULT 0,
  paid INTEGER DEFAULT 0, code TEXT, nonce TEXT, created_at INTEGER, cancelled_at INTEGER,
  late_cancel INTEGER DEFAULT 0, note TEXT, seasonal INTEGER DEFAULT 0, delivery TEXT, entered_at INTEGER,
  qr_for_minor INTEGER DEFAULT 0, reminded INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_res ON reservations(facility_id,start);
CREATE TABLE IF NOT EXISTS waitlist(id INTEGER PRIMARY KEY, facility_id INTEGER, start INTEGER, user_id INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY, user_id INTEGER, ts INTEGER, kind TEXT, params TEXT, channel TEXT, read INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS incidents(
  id INTEGER PRIMARY KEY, reservation_id INTEGER, facility_id INTEGER, user_id INTEGER, ts INTEGER,
  category TEXT, queue TEXT, text TEXT, status TEXT DEFAULT 'open', notes TEXT DEFAULT '[]', closed_at INTEGER);
CREATE TABLE IF NOT EXISTS access_log(
  id INTEGER PRIMARY KEY, ts INTEGER, facility_id INTEGER, reservation_id INTEGER, user_id INTEGER,
  medium TEXT, result TEXT, reason TEXT, actor TEXT);
CREATE TABLE IF NOT EXISTS norms(version INTEGER PRIMARY KEY, ts INTEGER, text_gl TEXT, text_es TEXT);
CREATE TABLE IF NOT EXISTS norm_acceptances(user_id INTEGER, version INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, ts INTEGER, actor INTEGER, action TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS devices(
  id TEXT PRIMARY KEY, facility_id INTEGER, online INTEGER DEFAULT 1, last_seen INTEGER, armed_res INTEGER,
  armed_until INTEGER DEFAULT 0, locked INTEGER DEFAULT 1, door_closed INTEGER DEFAULT 1, light INTEGER DEFAULT 0,
  light_until INTEGER DEFAULT 0, unlock_until REAL DEFAULT 0, open_since INTEGER, cache TEXT DEFAULT '[]', revoked TEXT DEFAULT '[]',
  pending_sync TEXT DEFAULT '[]', local_log TEXT DEFAULT '[]', fw TEXT DEFAULT '0.9.0-demo');
CREATE TABLE IF NOT EXISTS mqtt_log(id INTEGER PRIMARY KEY, ts INTEGER, topic TEXT, payload TEXT);
CREATE TABLE IF NOT EXISTS seasons(id INTEGER PRIMARY KEY, facility_id INTEGER, user_id INTEGER, weekday INTEGER, start_hm TEXT, end_hm TEXT, date_from TEXT, date_to TEXT, label TEXT);
CREATE TABLE IF NOT EXISTS course_progress(user_id INTEGER, course TEXT, done TEXT DEFAULT '[]', score INTEGER);
"""

def hash_pw(pw):
    """Contrasinal con scrypt e sal aleatorio. Nunca se garda en claro."""
    if not pw:
        return None
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${h.hex()}"


def check_pw(pw, stored):
    if not pw or not stored or not stored.startswith("scrypt$"):
        return False
    _, salt, h = stored.split("$")
    calc = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1)
    return hmac.compare_digest(calc.hex(), h)


_cache = {}


def db_path(t):
    return os.path.join(DATA_DIR, f"{t}.db")


def tenant_ids():
    return ["vilaverde", "ribeiranova"]


@contextmanager
def conn(t):
    c = sqlite3.connect(db_path(t), timeout=30, check_same_thread=False, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=NORMAL")
    c.execute("PRAGMA foreign_keys=OFF")
    try:
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()


def init_db(t):
    with conn(t) as c:
        c.executescript(SCHEMA)


def rows(c, sql, args=()):
    return [dict(r) for r in c.execute(sql, args).fetchall()]


def row(c, sql, args=()):
    r = c.execute(sql, args).fetchone()
    return dict(r) if r else None


def kv_get(c, k, default=None):
    r = c.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
    return json.loads(r["v"]) if r else default


def kv_set(c, k, v):
    c.execute("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, json.dumps(v)))


# ---- tempo -----------------------------------------------------------------
def now(c):
    return int(time.time()) + int(kv_get(c, "clock_offset", 0))


def loc(ts):
    return datetime.fromtimestamp(ts, TZ)


def at(date_str, hm):
    """'2026-11-13','18:00' -> epoch"""
    d = datetime.strptime(date_str + " " + hm, "%Y-%m-%d %H:%M").replace(tzinfo=TZ)
    return int(d.timestamp())


def day_start(ts):
    d = loc(ts).replace(hour=0, minute=0, second=0, microsecond=0)
    return int(d.timestamp())


def add_days(ts, n):
    d = loc(ts) + timedelta(days=n)
    return int(d.timestamp())


def week_bounds(ts):
    d = loc(ts).replace(hour=0, minute=0, second=0, microsecond=0)
    mon = d - timedelta(days=d.weekday())
    return int(mon.timestamp()), int((mon + timedelta(days=7)).timestamp())


# ---- config ----------------------------------------------------------------
DEFAULT_RULES = {
    "window_days": 14, "padron_early_days": 2, "max_pending": 3, "max_week": 2, "max_day": 1,
    "no_consecutive": True, "cooldown_hours": 24, "cancel_hours": 24, "strike_threshold": 2,
    "ban_days": 15, "open_grace_min": 10,
}


def tenant_cfg(c):
    return kv_get(c, "config", {})


def eff_rules(c, fac):
    r = dict(kv_get(c, "rules", DEFAULT_RULES))
    r.update(json.loads(fac.get("rules") or "{}"))
    return r


# ---- sesións ---------------------------------------------------------------
def new_session(c, uid):
    tok = secrets.token_urlsafe(24)
    c.execute("INSERT INTO sessions VALUES(?,?,?)", (tok, uid, int(time.time())))
    return tok


def user_by_token(c, tok):
    if not tok:
        return None
    r = row(c, "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.active=1", (tok,))
    return r


def audit(c, actor, action, detail):
    c.execute("INSERT INTO audit(ts,actor,action,detail) VALUES(?,?,?,?)", (now(c), actor, action, json.dumps(detail, ensure_ascii=False)))


def notify(c, uid, kind, params=None, channel=None):
    """Aviso (simulado): gárdase na bandexa e, segundo preferencias, marca canle correo/push."""
    u = row(c, "SELECT notif_email,notif_push FROM users WHERE id=?", (uid,))
    if not u:
        return
    chans = []
    if u["notif_email"]:
        chans.append("email")
    if u["notif_push"]:
        chans.append("push")
    if not chans:
        chans = ["web"]
    c.execute("INSERT INTO notifications(user_id,ts,kind,params,channel) VALUES(?,?,?,?,?)",
              (uid, now(c), kind, json.dumps(params or {}, ensure_ascii=False), ",".join(chans)))


def initials(u):
    if not u:
        return "?"
    parts = [u.get("name") or ""] + (u.get("surname") or "").split()
    return ". ".join(p[0].upper() for p in parts if p) + "."
