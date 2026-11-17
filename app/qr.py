# SPDX-License-Identifier: AGPL-3.0-or-later
"""QR asinado (Ed25519). Formato documentado: PEP1.<payload b64url>.<sinatura b64url>

payload JSON compacto: {"v":1,"t":concello,"r":reserva,"f":instalación,"a":inicio,"b":fin,"n":nonce}
O controlador só precisa da chave pública para validar sen conexión.
"""
import base64
import io
import json
import os

import segno
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from .core import DATA_DIR

_keys = {}


def _b64(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _priv(t):
    if t in _keys:
        return _keys[t]
    p = os.path.join(DATA_DIR, f"{t}.ed25519.pem")
    if os.path.exists(p):
        k = serialization.load_pem_private_key(open(p, "rb").read(), None)
    else:
        k = Ed25519PrivateKey.generate()
        open(p, "wb").write(k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        os.chmod(p, 0o600)
    _keys[t] = k
    return k


def public_key_b64(t):
    return _b64(_priv(t).public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))


def sign(t, res):
    payload = {"v": 1, "t": t, "r": res["id"], "f": res["facility_id"], "a": res["start"], "b": res["end"], "n": res["nonce"]}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64(_priv(t).sign(body.encode()))
    return f"PEP1.{body}.{sig}"


def verify(t, text):
    """Devolve (payload|None, erro|None). Só comproba a sinatura; o resto é responsabilidade do chamador."""
    try:
        magic, body, sig = (text or "").strip().split(".")
        if magic != "PEP1":
            return None, "bad_format"
        pub = _priv(t).public_key()
        pub.verify(_unb64(sig), body.encode())
        p = json.loads(_unb64(body))
        if p.get("t") != t:
            return None, "wrong_tenant"
        return p, None
    except InvalidSignature:
        return None, "bad_signature"
    except Exception:
        return None, "bad_format"


def svg(text, dark="#102F61"):
    q = segno.make(text, error="m", micro=False)
    out = io.BytesIO()
    q.save(out, kind="svg", scale=6, border=2, dark=dark, light="#ffffff", xmldecl=False, svgns=True, nl=False)
    return out.getvalue().decode()
