#!/usr/bin/env python3
"""PostgreSQL returned jsonb columns as parsed objects; MariaDB stores them as
text and returns strings. The UI spreads these values as objects, so verify the
API still hands back real objects/arrays."""
import json, os, sys
import urllib.request as U, urllib.error

B = os.environ.get("ICMS_BASE", "http://127.0.0.1:8099") + "/api"

def call(method, path, body=None, tok=None):
    data = None if body is None else json.dumps(body).encode()
    h = {"Content-Type": "application/json"}
    if tok:
        h["Authorization"] = "Bearer " + tok
    req = U.Request(B + path, data=data, headers=h, method=method)
    try:
        r = U.urlopen(req, timeout=60)
        return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]

st, r = call("POST", "/auth/login", {"email": "owner@icms.com", "password": "owner123"})
TOK = r["token"]
fails = []

st, lst = call("GET", "/orders?limit=1", tok=TOK)
oid = lst["orders"][0]["id"]

def check(label, value, want):
    ok = isinstance(value, want)
    print(f"  {'ok  ' if ok else 'FAIL'} {label}: {type(value).__name__} = {str(value)[:70]}")
    if not ok:
        fails.append(f"{label} came back as {type(value).__name__}, expected {want.__name__}")

print("GET /orders (list row)")
check("doc_checklist", lst["orders"][0].get("doc_checklist"), dict)

print("GET /orders/:id")
st, one = call("GET", f"/orders/{oid}", tok=TOK)
check("doc_checklist", one.get("doc_checklist"), dict)
if one.get("tracking_updates") is not None:
    check("tracking_updates", one.get("tracking_updates"), list)

print("GET /orders/kanban")
st, kb = call("GET", "/orders/kanban", tok=TOK)
card = next((c for cards in kb.values() for c in cards), None)
if card:
    check("doc_checklist", card.get("doc_checklist"), dict)

print("POST /orders/:id/tracking")
st, tr = call("POST", f"/orders/{oid}/tracking", {"event": "JSONCHECK", "location": "X"}, tok=TOK)
check("tracking_updates", tr.get("tracking_updates"), list)

print("round-trip doc_checklist through PUT")
st, up = call("PUT", f"/orders/{oid}",
              {"doc_checklist": {"Bill of Lading": True, "Packing List": False}}, tok=TOK)
if st != 200:
    fails.append(f"PUT returned {st}: {up}")
else:
    check("doc_checklist after PUT", up.get("doc_checklist"), dict)
    if isinstance(up.get("doc_checklist"), dict) and up["doc_checklist"].get("Bill of Lading") is not True:
        fails.append(f"doc_checklist lost its values: {up['doc_checklist']}")

print("\n=== RESULT ===")
if fails:
    for f in fails: print("FAIL:", f)
    sys.exit(1)
print("JSON columns OK")
