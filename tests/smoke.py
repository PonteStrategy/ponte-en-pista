"""Proba de humo end-to-end contra a API en marcha: python tests/smoke.py [http://localhost:8000]"""
import json, sys, urllib.request, urllib.error

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
T = "vilaverde"


def api(method, path, body=None, tok=None, expect=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "X-Tenant": T, **({"Authorization": "Bearer " + tok} if tok else {})})
    try:
        r = urllib.request.urlopen(req)
        out = json.loads(r.read() or "null")
        code = r.status
    except urllib.error.HTTPError as e:
        out = json.loads(e.read() or "null")
        code = e.code
    if expect and code != expect:
        raise AssertionError(f"{method} {path} -> {code} (esperado {expect}): {out}")
    return out


ok = 0


def check(name, cond, info=""):
    global ok
    print(("OK  " if cond else "FAIL"), name, info if not cond else "")
    if not cond:
        sys.exit(1)
    ok += 1


api("POST", "/api/demo/reset", expect=200)
api("POST", "/api/demo/clock", {"reset": True})
meta = api("GET", "/api/meta")
check("meta", meta["tenant"] == T)
facs = api("GET", "/api/facilities")
check("catálogo público", len(facs) >= 6 and facs[0]["next_free"])
pers = {p["name"]: p["id"] for p in api("GET", "/api/auth/personas")}
marta = api("POST", "/api/auth/demo", {"user_id": pers["Marta López García"]})["token"]
ruben = api("POST", "/api/auth/demo", {"user_id": pers["Rubén Pérez Souto"]})["token"]
carmen = api("POST", "/api/auth/password", {"email": "carmen@vilaverde.example", "password": "demo", "code": "123456"})["token"]
jose = api("POST", "/api/auth/password", {"email": "jose@vilaverde.example", "password": "demo", "code": "123456"})["token"]
api("POST", "/api/auth/password", {"email": "carmen@vilaverde.example", "password": "demo", "code": "000"}, expect=401)
check("login con 2FA", True)

# Reserva: Rubén (nivel 1) non pode reservar a pista 1 (nivel 2) nin sen normas
p1 = next(f for f in facs if f["name"] == "Pista de pádel 1")
p2 = next(f for f in facs if f["name"] == "Pista de pádel 2")
sl = api("GET", f"/api/facilities/{p2['id']}/slots?days=3", tok=ruben)["days"]
free = [s for d in sl for s in d["slots"] if s["state"] == "free"]
check("franxas libres", len(free) > 3)
chk = api("GET", f"/api/rules/check?facility_id={p2['id']}&start={free[0]['start']}", tok=ruben)
codes = [v["code"] for v in chk["violations"]]
check("Rubén debe aceptar normas", "norms_not_accepted" in codes, codes)
api("POST", "/api/me/norms", tok=ruben)
r1 = api("POST", "/api/reservations", {"facility_id": p2["id"], "start": free[0]["start"]}, tok=ruben, expect=200)
check("reserva con QR e código", r1["qr"].startswith("PEP1.") and len(r1["code"]) == 6)
# espera de 24 h na mesma instalación
v = api("POST", "/api/reservations", {"facility_id": p2["id"], "start": free[2]["start"]}, tok=ruben, expect=409)
c2 = [x["code"] for x in v["detail"]["violations"]]
check("regra de espera/día", "cooldown" in c2 or "max_day" in c2, c2)
check("pista 1 require nivel 2", "level_required" in [x["code"] for x in api("GET", f"/api/rules/check?facility_id={p1['id']}&start={free[0]['start']}", tok=ruben)["violations"]])

# Marta: reserva existente, cambio e cancelación
mine = api("GET", "/api/reservations", tok=marta)["items"]
up = [r for r in mine if r["status"] == "confirmed"]
check("Marta ten reserva mañá", len(up) >= 1)
rid = up[0]["id"]
d = api("GET", f"/api/reservations/{rid}", tok=marta)
old_qr = d["qr"]
q = api("GET", f"/api/reservations/{rid}/qr", tok=marta)
check("QR SVG", "<svg" in q["svg"])
ics = urllib.request.urlopen(urllib.request.Request(BASE + f"/api/reservations/{rid}/ics", headers={"Authorization": "Bearer " + marta, "X-Tenant": T})).read().decode()
check("iCalendar", "BEGIN:VEVENT" in ics)

# Porta: QR valido só na franxa; sen conexión; anulación
door = p1["device_id"]
st = api("GET", f"/api/door/{door}")
check("porta en liña", st["online"] and st["cache"] >= 1)
res = api("POST", f"/api/door/{door}/scan", {"text": old_qr, "kind": "qr"})
check("QR fóra de franxa rexeitado", not res["ok"] and res["reason"] == "too_early", res)
api("POST", f"/api/demo/jump/{rid}")
res = api("POST", f"/api/door/{door}/scan", {"text": old_qr, "kind": "qr"})
check("QR valido na franxa abre", res["ok"], res)
res = api("POST", f"/api/door/{door}/scan", {"text": old_qr[:-3] + "AAA", "kind": "qr"})
check("QR manipulado rexeitado", not res["ok"] and res["reason"] == "bad_signature", res)
res = api("POST", f"/api/door/{door}/scan", {"text": d["code"], "kind": "code"})
check("código alternativo abre", res["ok"], res)
api("POST", f"/api/door/{door}/sensor", {"closed": True})
# botón + pulsador
a = api("POST", f"/api/reservations/{rid}/open", tok=marta, expect=200)
check("botón armado 30 s", a["ttl"] == 30)
res = api("POST", f"/api/door/{door}/button")
check("pulsador abre", res["ok"], res)
res = api("POST", f"/api/door/{door}/button")
check("pulsador sen orde non abre", not res["ok"])
# anulación coa porta sen conexión: segue abrindo ata recuperar a rede (limitación real do deseño)
api("POST", "/api/demo/clock", {"reset": True})
free2 = [s for d in api("GET", f"/api/facilities/{p2['id']}/slots?days=4", tok=marta)["days"][2:] for s in d["slots"] if s["state"] == "free"]
r2 = api("POST", "/api/reservations", {"facility_id": p2["id"], "start": free2[1]["start"]}, tok=marta, expect=200)
door2 = p2["device_id"]
api("POST", f"/api/door/{door2}/online", {"online": False})
api("POST", f"/api/reservations/{r2['id']}/cancel", tok=marta, expect=200)
api("POST", f"/api/demo/jump/{r2['id']}")
res = api("POST", f"/api/door/{door2}/scan", {"text": r2["qr"], "kind": "qr"})
check("QR abre sen conexión (aínda que anulado, porta desconectada)", res["ok"] and res.get("offline"), res)
api("POST", f"/api/reservations/{r2['id']}/open", tok=marta, expect=409)
api("POST", f"/api/door/{door2}/online", {"online": True})
res = api("POST", f"/api/door/{door2}/scan", {"text": r2["qr"], "kind": "qr"})
check("reserva cancelada deixa de abrir", not res["ok"] and res["reason"] == "revoked", res)
check("rexistro offline sincronizado", any("synced" in str(l["reason"]) for l in api("GET", "/api/access", tok=carmen)))
api("POST", "/api/demo/clock", {"reset": True})

# Xestora: reserva asistida con excepción, peche por avaría, stats
users = api("GET", "/api/users?q=ana", tok=carmen)
ana = users[0]["id"]
fut = api("GET", f"/api/facilities/{p2['id']}/slots?days=6", tok=carmen)["days"]
fr = [s for d in fut for s in d["slots"] if s["state"] == "free"]
r = api("POST", "/api/reservations", {"facility_id": p2["id"], "start": fr[5]["start"], "holder_id": ana, "channel": "phone", "accept_norms": True}, tok=carmen, expect=200)
check("reserva asistida por teléfono", r["channel"] == "phone")
st = api("GET", "/api/stats", tok=carmen)
check("indicadores", len(st["facilities"]) >= 6 and "web" in st["channels"])
rec = api("GET", f"/api/stats/recommend?facility_id={p2['id']}", tok=marta)
check("recomendación horaria", len(rec["items"]) > 0)
n = api("POST", f"/api/facilities/{p2['id']}/close", {"reason": "Avaría na pechadura"}, tok=carmen)
check("peche por avaría cancela reservas", n["cancelled"] >= 1, n)
sl = api("GET", f"/api/facilities/{p2['id']}/slots?days=2")["days"]
check("peche oculta franxas", all(s["state"] == "closed" for d in sl for s in d["slots"]))
api("POST", f"/api/facilities/{p2['id']}/reopen", tok=carmen)

# Validador
pav = next(f for f in facs if f["name"] == "Pavillón municipal")
day = api("GET", f"/api/validator/day?facility_id={pav['id']}", tok=jose)
check("lista do día do validador", "items" in day)
api("GET", f"/api/validator/day?facility_id={p1['id']}", tok=jose, expect=403)
# Incidencia
inc = api("POST", "/api/incidents", {"facility_id": p1["id"], "category": "reader", "text": "Lector sen luz"}, tok=marta)
check("incidencia técnica á cola técnica", inc["queue"] == "technical")
# Menores
kids = api("GET", "/api/me/linked", tok=marta)
check("persoas vinculadas", len(kids) == 2)
print(f"\n{ok} comprobacións OK")
