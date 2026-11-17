# SPDX-License-Identifier: AGPL-3.0-or-later
"""Datos de demostración de dous concellos (cada un na súa base de datos)."""
import json
import os
import random
import secrets
import string

from . import device
from .core import (DEFAULT_RULES, hash_pw, add_days, at, conn, day_start, db_path, init_db, kv_set, loc, now, row, rows)
from .domain import slots_for_day, tariff_for

NORMS = {
    1: ("Normas de uso das instalacións deportivas municipais (v1). Respecta o horario, deixa a instalación limpa e comunica calquera dano.",
        "Normas de uso de las instalaciones deportivas municipales (v1). Respeta el horario, deja la instalación limpia y comunica cualquier daño."),
    2: ("Normas de uso (v2). Engádese: o QR é persoal e intransferible; cada uso queda rexistrado ao nome da persoa titular.",
        "Normas de uso (v2). Se añade: el QR es personal e intransferible; cada uso queda registrado a nombre de la persona titular."),
    3: ("Normas de uso (v3). Engádese: cancelacións con menos de 24 horas e non presentarse contan para o límite de reservas; as persoas menores reservan a través dunha persoa titora.",
        "Normas de uso (v3). Se añade: cancelaciones con menos de 24 horas y no presentarse cuentan para el límite de reservas; las personas menores reservan a través de una persona tutora."),
}


def sched(win, wend, w0=("09:00", "22:00"), w1=("10:00", "21:00")):
    return {"winter": {str(i): list(w0 if i < 5 else w1) for i in range(7)},
            "summer": {str(i): list(w0 if i < 5 else w1) for i in range(7)}}


def uid(c, **k):
    if k.get("password"):
        k["password"] = hash_pw(k["password"])
    cols = ",".join(k)
    cur = c.execute(f"INSERT INTO users({cols},cal_token,created_at) VALUES({','.join('?' * len(k))},?,?)", (*k.values(), secrets.token_urlsafe(12), now(c)))
    return cur.lastrowid


def fac(c, **k):
    k.setdefault("schedule", json.dumps(sched(0, 0)))
    for key in ("prices", "rules"):
        if key in k and not isinstance(k[key], str):
            k[key] = json.dumps(k[key])
    cols = ",".join(k)
    return c.execute(f"INSERT INTO facilities({cols}) VALUES({','.join('?' * len(k))})", tuple(k.values())).lastrowid


def raw_res(c, fid, u, start, end, status, channel, price, tname, created=None, paid=1, seasonal=0):
    code = "".join(random.choice(string.digits) for _ in range(6))
    c.execute("INSERT INTO reservations(facility_id,user_id,booked_by,start,end,status,channel,tariff,price,paid,code,nonce,created_at,seasonal) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
              (fid, u, u, start, end, status, channel, tname, price, paid, code, secrets.token_hex(6), created or (start - 5 * 86400), seasonal))
    return c.execute("SELECT last_insert_rowid()").fetchone()[0]


def reset(t):
    p = db_path(t)
    for ext in ("", "-wal", "-shm"):
        if os.path.exists(p + ext):
            os.remove(p + ext)
    init_db(t)
    random.seed(42 if t == "vilaverde" else 7)
    with conn(t) as c:
        c.execute("BEGIN")
        (seed_vilaverde if t == "vilaverde" else seed_ribeira)(c, t)
        c.execute("COMMIT")


def common(c, cfg, rules):
    kv_set(c, "config", cfg)
    kv_set(c, "rules", rules)
    kv_set(c, "clock_offset", 0)
    kv_set(c, "maintenance_code", "777000")
    n = now(c)
    for v, (g, s) in NORMS.items():
        c.execute("INSERT INTO norms VALUES(?,?,?,?)", (v, n - (4 - v) * 90 * 86400, g, s))


def history(c, facs, citizens, days_back=42, days_fwd=14, p_future=0.28):
    n = now(c)
    d0 = day_start(n)
    for fid in facs:
        f = row(c, "SELECT * FROM facilities WHERE id=?", (fid,))
        for i in range(-days_back, days_fwd):
            dts = add_days(d0, i)
            for (s, e) in slots_for_day(c, f, dts):
                h = loc(s).hour
                wd = loc(s).weekday()
                base = 0.55 if 17 <= h <= 21 else 0.2
                if wd >= 5:
                    base += 0.1
                if i >= 0:
                    base = p_future * (1.5 if 17 <= h <= 21 else 0.5)
                if random.random() > base:
                    continue
                u = random.choice(citizens)
                ch = random.choices(["web", "phone", "office"], [65, 20, 15])[0]
                ur = row(c, "SELECT * FROM users WHERE id=?", (u,))
                tname, price = tariff_for(ur, f)
                if e < n:
                    st = random.choices(["attended", "no_show", "cancelled"], [84, 10, 6])[0]
                else:
                    st = "confirmed"
                rid = raw_res(c, fid, u, s, e, st, ch, price, tname, paid=1 if price == 0 or e < n else 0)
                if st == "attended":
                    c.execute("UPDATE reservations SET entered_at=? WHERE id=?", (s - 240, rid))
                    c.execute("INSERT INTO access_log(ts,facility_id,reservation_id,user_id,medium,result,reason,actor) VALUES(?,?,?,?,?,?,?,?)",
                              (s - 240, fid, rid, u, "qr" if f["access_mode"] == "door" else "validator", "ok", "ok", f["device_id"] or "validador"))
                if st == "cancelled":
                    c.execute("UPDATE reservations SET cancelled_at=? WHERE id=?", (s - 2 * 86400, rid))


def anon_citizens(c, n=14, base=1990):
    surn = ["García", "Pérez", "Rodríguez", "Fernández", "Souto", "Vázquez", "Castro", "Lage", "Pazos", "Barreiro", "Otero", "Rey", "Seoane", "Villar"]
    names = ["Xoán", "Uxía", "Brais", "Noa", "Iago", "Sabela", "Hugo", "Carlota", "Martín", "Alba", "Antón", "Irene", "Pedro", "Lucía"]
    ids = []
    for i in range(n):
        ids.append(uid(c, name=names[i % len(names)], surname=f"{random.choice(surn)} {random.choice(surn)}", email=f"vecino{i}@example.org",
                       phone="+34 600 000 0%02d" % i, level=2, empadronado=1 if random.random() < .7 else 0, birth_year=base + i % 20,
                       id_method="clave"))
    return ids


def seed_vilaverde(c, t):
    common(c, {
        "id": t, "name": "Concello de Vilaverde", "short": "Vilaverde", "province": "A Coruña", "color": "#102F61", "accent": "#2F80ED",
        "langs": ["gl", "es"], "default_lang": "gl", "operator": "Ponte Strategy, S.L.", "email": "deportes@vilaverde.example",
        "phone": "981 000 000", "domain": "pista.vilaverde.example", "summer": ["06-15", "09-15"],
        "holidays": ["2026-12-08", "2026-12-25", "2027-01-01", "2027-01-06", "2027-05-01", "2027-07-25"],
        "legal_gl": "O Concello de Vilaverde é o responsable do tratamento dos datos persoais. Só se piden os datos imprescindibles segundo o nivel de identificación de cada instalación; o consentimento só se pide para o opcional (avisos no móbil). Podes exercer os teus dereitos desde o teu perfil ou na oficina de deportes.",
        "legal_es": "El Concello de Vilaverde es el responsable del tratamiento de los datos personales. Solo se piden los datos imprescindibles según el nivel de identificación de cada instalación; el consentimiento solo se pide para lo opcional (avisos en el móvil). Puedes ejercer tus derechos desde tu perfil o en la oficina de deportes.",
        "retention_days": 365,
    }, dict(DEFAULT_RULES))
    marta = uid(c, name="Marta", surname="López García", email="marta@example.org", phone="+34 611 111 111", role="citizen", level=2,
                empadronado=1, birth_year=1985, id_method="certificado", doc_checked=1, notif_email=1, notif_push=1, passkey=1)
    pablo = uid(c, name="Pablo", surname="López García", email="", phone="", level=1, empadronado=1, birth_year=2014, tutor_id=marta, authorised=1)
    lua = uid(c, name="Lúa", surname="López García", email="lua@example.org", phone="+34 622 222 222", level=1, empadronado=1, birth_year=2010, tutor_id=marta, authorised=1)
    ruben = uid(c, name="Rubén", surname="Pérez Souto", email="ruben@example.org", phone="+34 633 333 333", level=1, empadronado=0, birth_year=1990, id_method="correo")
    club = uid(c, name="Club de Pádel", surname="Vilaverde", email="club@padelvilaverde.example", level=2, empadronado=1, club=1, birth_year=2000, id_method="certificado")
    carmen = uid(c, name="Carmen", surname="Seoane Vidal", email="carmen@vilaverde.example", role="manager", level=2, empadronado=1, birth_year=1978, password="demo", id_method="certificado")
    jose = uid(c, name="José Ramón", surname="Veiga", email="jose@vilaverde.example", role="validator", level=2, birth_year=1970, password="demo", facility_scope="3,4,5,6,7")
    soporte = uid(c, name="Asistencia", surname="técnica", email="soporte@ponte.example", role="tech", level=2, birth_year=1985, password="demo")
    ana = uid(c, name="Ana", surname="Beiras Casal", email="ana@example.org", level=2, empadronado=1, birth_year=1992, id_method="clave", reduced=1)
    anon = anon_citizens(c)
    for u in (marta, ana, club, carmen, jose, soporte):
        for v in (1, 2, 3):
            c.execute("INSERT INTO norm_acceptances VALUES(?,?,?)", (u, v, now(c) - 20 * 86400))
    # instalacións
    p1 = fac(c, name="Pista de pádel 1", sport="padel", access_mode="door", device_id="porta-padel-1", min_level=2, light_auto=1, color="#2F80ED", sort=1,
             description="Pista de pádel exterior con iluminación LED e acceso automatizado.",
             prices={"general": 6, "padron": 0, "reduced": 0, "club": 3}, accessibility="Acceso sen escalóns. Lector a 1,10 m con aviso sonoro.",
             norms="Calzado deportivo. Non se permiten bebidas de cristal.")
    p2 = fac(c, name="Pista de pádel 2", sport="padel", access_mode="door", device_id="porta-padel-2", min_level=1, color="#2F80ED", sort=2,
             description="Segunda pista de pádel, gratuíta. Abonda cunha conta con correo e móbil verificados.",
             prices={"general": 0}, accessibility="Acceso sen escalóns.", norms="Calzado deportivo.", rules={"max_week": 3})
    pav = fac(c, name="Pavillón municipal", sport="pavillon", access_mode="staff", min_level=2, allow_minors=1, color="#1B7F52", sort=3,
              description="Pavillón polideportivo divisible en dúas pistas (A e B). Con persoal de conserxería.",
              prices={"general": 12, "padron": 6, "reduced": 3, "club": 8}, accessibility="Vestiarios adaptados, rampla e aseo accesible.",
              norms="Calzado de pista limpo. Prohibido comer na pista.")
    pa = fac(c, name="Pavillón · pista A", sport="pavillon", access_mode="staff", min_level=2, allow_minors=1, parent_id=pav, color="#1B7F52", sort=4,
             description="Media pista A do pavillón (reservable por separado).", prices={"general": 6, "padron": 3, "reduced": 1.5, "club": 4}, accessibility="Rampla de acceso.")
    pb = fac(c, name="Pavillón · pista B", sport="pavillon", access_mode="staff", min_level=2, allow_minors=1, parent_id=pav, color="#1B7F52", sort=5,
             description="Media pista B do pavillón (reservable por separado).", prices={"general": 6, "padron": 3, "reduced": 1.5, "club": 4}, accessibility="Rampla de acceso.")
    fro = fac(c, name="Frontón", sport="fronton", access_mode="staff", min_level=1, allow_minors=1, color="#A8322A", sort=6,
              description="Frontón cuberto gratuíto, con persoal validador no horario de tarde.",
              schedule=json.dumps(sched(0, 0, ("10:00", "21:00"), ("10:00", "20:00"))), prices={"general": 0}, accessibility="Acceso sen escalóns.",
              rules={"max_week": 3, "cooldown_hours": 0})
    fut = fac(c, name="Campo de fútbol 7", sport="futbol", access_mode="staff", min_level=2, allow_minors=1, color="#8A5A00", sort=7,
              description="Campo de céspede artificial para fútbol 7.", schedule=json.dumps(sched(0, 0, ("16:00", "22:00"), ("10:00", "21:00"))),
              prices={"general": 20, "padron": 10, "club": 12}, accessibility="Acceso por rampla.")
    for f in (p1, p2):
        device.ensure(c, row(c, "SELECT * FROM facilities WHERE id=?", (f,)))
    history(c, [p1, p2, pav, fro, fut], anon, p_future=0.25)
    # Reservas de exemplo de Marta
    n = now(c)
    d = day_start(add_days(n, 1))
    f1 = row(c, "SELECT * FROM facilities WHERE id=?", (p1,))
    for (s, e) in slots_for_day(c, f1, d):
        if loc(s).hour == 18:
            c.execute("UPDATE reservations SET status='cancelled' WHERE facility_id=? AND start=?", (p1, s))
            raw_res(c, p1, marta, s, e, "confirmed", "web", 0, "padron", created=n - 86400)
    f2 = row(c, "SELECT * FROM facilities WHERE id=?", (pav,))
    d2 = day_start(add_days(n, -4))
    for (s, e) in slots_for_day(c, f2, d2):
        if loc(s).hour == 19:
            c.execute("UPDATE reservations SET status='cancelled' WHERE facility_id IN (3,4,5) AND start=?", (s,))
            rid = raw_res(c, pav, marta, s, e, "attended", "web", 6, "padron", created=n - 9 * 86400)
            c.execute("UPDATE reservations SET entered_at=? WHERE id=?", (s - 200, rid))
    # tempada do club
    c.execute("INSERT INTO seasons(facility_id,user_id,weekday,start_hm,end_hm,date_from,date_to,label) VALUES(?,?,?,?,?,?,?,?)",
              (p2, club, 1, "20:00", "21:00", loc(n).strftime("%Y-%m-%d"), loc(add_days(n, 120)).strftime("%Y-%m-%d"), "Adestramento do club"))
    for i in range(-3, 18):
        ds = loc(add_days(n, i * 1))
        if ds.weekday() == 1:
            s, e = at(ds.strftime("%Y-%m-%d"), "20:00"), at(ds.strftime("%Y-%m-%d"), "21:00")
            c.execute("UPDATE reservations SET status='cancelled' WHERE facility_id=? AND start=?", (p2, s))
            raw_res(c, p2, club, s, e, "attended" if e < n else "confirmed", "office", 0, "club", seasonal=1)
    # incidencias de exemplo
    c.execute("INSERT INTO incidents(facility_id,user_id,ts,category,queue,text,status) VALUES(?,?,?,?,?,?,?)", (p1, anon[0], n - 3 * 3600, "damaged", "operational", "Rede rota na pista 1", "open"))
    c.execute("INSERT INTO incidents(facility_id,user_id,ts,category,queue,text,status) VALUES(?,?,?,?,?,?,?)", (p2, anon[1], n - 26 * 3600, "reader", "technical", "Lector sen conexión", "open"))
    c.execute("INSERT INTO incidents(facility_id,user_id,ts,category,queue,text,status,closed_at) VALUES(?,?,?,?,?,?,?,?)", (fro, anon[2], n - 5 * 86400, "dirty", "operational", "Chan sucio", "closed", n - 4 * 86400))
    for f in (p1, p2):
        device.sync(c, t, row(c, "SELECT * FROM facilities WHERE id=?", (f,)))


def seed_ribeira(c, t):
    common(c, {
        "id": t, "name": "Concello de Ribeira Nova", "short": "Ribeira Nova", "province": "Pontevedra", "color": "#0F5C5A", "accent": "#17A398",
        "langs": ["gl", "es"], "default_lang": "es", "operator": "Deputación (demo) · instalación compartida", "email": "deportes@ribeiranova.example",
        "phone": "986 000 000", "domain": "pista.ribeiranova.example", "summer": ["06-01", "09-30"], "holidays": ["2026-12-08", "2026-12-25", "2027-01-01"],
        "legal_gl": "O Concello de Ribeira Nova é o responsable do tratamento. A Deputación actúa como encargada do tratamento e aloxa a plataforma na UE.",
        "legal_es": "El Concello de Ribeira Nova es el responsable del tratamiento. La Diputación actúa como encargada del tratamiento y aloja la plataforma en la UE.",
        "retention_days": 730,
    }, {**DEFAULT_RULES, "window_days": 21, "max_pending": 4, "max_week": 3, "cooldown_hours": 0, "padron_early_days": 3})
    marta = uid(c, name="Lucía", surname="Mariño Paz", email="lucia@example.org", phone="+34 644 444 444", level=2, empadronado=1, birth_year=1988, id_method="clave", doc_checked=1)
    carlos = uid(c, name="Carlos", surname="Brea Lago", email="carlos@ribeiranova.example", role="manager", level=2, empadronado=1, birth_year=1975, password="demo")
    xan = uid(c, name="Xan", surname="Dopico", email="xan@ribeiranova.example", role="validator", level=2, birth_year=1968, password="demo", facility_scope="12")
    sop = uid(c, name="Asistencia", surname="técnica", email="soporte@ponte.example", role="tech", level=2, birth_year=1985, password="demo")
    anon = anon_citizens(c, 10, 1985)
    for u in (marta, carlos, xan, sop):
        for v in (1, 2, 3):
            c.execute("INSERT INTO norm_acceptances VALUES(?,?,?)", (u, v, now(c) - 20 * 86400))
    a = fac(c, name="Pista polideportiva Os Carballos", sport="polideportiva", access_mode="door", device_id="porta-carballos", min_level=1, allow_minors=1,
            schedule=json.dumps(sched(0, 0, ("08:00", "22:00"), ("09:00", "22:00"))), prices={"general": 0}, light_auto=1, color="#17A398", sort=1,
            description="Pista polideportiva ao aire libre, gratuíta, con porta automatizada.", accessibility="Acceso sen escalóns.")
    b = fac(c, name="Pavillón de Ribeira", sport="pavillon", access_mode="staff", min_level=1, allow_minors=1, color="#0F5C5A", sort=2,
            prices={"general": 5, "padron": 0}, description="Pavillón cuberto con persoal.", accessibility="Rampla e aseos adaptados.")
    d = fac(c, name="Pista de tenis", sport="tenis", access_mode="door", device_id="porta-tenis", min_level=2, color="#8A5A00", sort=3,
            prices={"general": 3, "padron": 1.5}, description="Pista de tenis de pó de ladrillo.", accessibility="Acceso sen escalóns.")
    for f in (a, d):
        device.ensure(c, row(c, "SELECT * FROM facilities WHERE id=?", (f,)))
    history(c, [a, b, d], anon, p_future=0.22, days_back=28)
    for f in (a, d):
        device.sync(c, t, row(c, "SELECT * FROM facilities WHERE id=?", (f,)))
    c.execute("INSERT INTO incidents(facility_id,user_id,ts,category,queue,text,status) VALUES(?,?,?,?,?,?,?)", (a, anon[0], now(c) - 7200, "dirty", "operational", "Folla e area na pista", "open"))
