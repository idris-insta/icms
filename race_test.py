#!/usr/bin/env python3
"""Concurrency tests for the race conditions that were fixed.

1. PO-number allocation: N simultaneous /duplicate calls must mint N distinct
   PO numbers (the supplier row is locked FOR UPDATE during allocation).
2. Lost updates: two clients that both loaded the same order must not both
   succeed — the second gets 409 instead of silently overwriting the first.
3. Schedule generation: simultaneous /generate calls must not both claim the
   same pending shipment.
"""
import json, os, sys, time, threading
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
        return e.code, e.read().decode()[:200]
    except Exception as e:
        return 0, str(e)[:200]

st, r = call("POST", "/auth/login", {"email": "owner@icms.com", "password": "owner123"})
if st != 200:
    print("login failed:", st, r); sys.exit(1)
TOK = r["token"]

st, sup = call("GET", "/masters/suppliers?limit=1", tok=TOK)
SID = (sup.get("suppliers") or [{}])[0].get("id")

failures = []

# ── 1. concurrent PO allocation ──────────────────────────────────────────────
print("1. Concurrent PO-number allocation")
st, seed = call("POST", "/orders", {
    "po_number": f"RACE-{int(time.time())}", "supplier_id": SID,
    "container_type": "40HC", "status": "Draft",
    "items": [{"item_name": "RACE", "total_roll": 1, "unit_price": 1}],
}, tok=TOK)
if st != 201:
    print("   could not seed order:", st, seed); sys.exit(1)
seed_id = seed["id"]

N = 8
results = [None] * N
def dup(i):
    results[i] = call("POST", f"/orders/{seed_id}/duplicate", None, tok=TOK)

ts = [threading.Thread(target=dup, args=(i,)) for i in range(N)]
for t in ts: t.start()
for t in ts: t.join()

pos = [r[1].get("po_number") for r in results if r[0] == 201]
errs = [r for r in results if r[0] != 201]
print(f"   {len(pos)}/{N} succeeded, {len(set(pos))} distinct PO numbers")
if errs:
    print("   non-201 responses:", [(c, str(b)[:80]) for c, b in errs])
if len(pos) != len(set(pos)):
    dupes = [p for p in set(pos) if pos.count(p) > 1]
    failures.append(f"duplicate PO numbers minted: {dupes}")
elif len(pos) < 2:
    failures.append("too few concurrent duplicates succeeded to prove anything")
else:
    print("   PASS — no duplicate PO numbers")

# ── 2. lost update ───────────────────────────────────────────────────────────
print("2. Concurrent edit of the same order (lost update)")
st, fresh = call("GET", f"/orders/{seed_id}", tok=TOK)
version = fresh["updated_at"]

out = {}
def edit(name, note):
    out[name] = call("PUT", f"/orders/{seed_id}",
                     {"notes": note, "if_unmodified_since": version}, tok=TOK)

a = threading.Thread(target=edit, args=("A", "written by A"))
b = threading.Thread(target=edit, args=("B", "written by B"))
a.start(); b.start(); a.join(); b.join()

codes = sorted([out["A"][0], out["B"][0]])
print(f"   response codes: {codes}")
st, after = call("GET", f"/orders/{seed_id}", tok=TOK)
print(f"   final notes: {after.get('notes')!r}")
if codes == [200, 200]:
    failures.append("both concurrent edits succeeded — one write was silently lost")
elif 409 in codes and 200 in codes:
    print("   PASS — one write accepted, the other rejected as stale")
else:
    failures.append(f"unexpected codes {codes}")

# ── 3. schedule double-generate ──────────────────────────────────────────────
print("3. Concurrent schedule generation")
st, sched = call("POST", "/schedules", {
    "supplier_id": SID, "item_name": "RACE SCHED", "container_type": "40HC",
    "qty_per_shipment": 1, "frequency": "weekly", "total_shipments": 1,
    "start_date": time.strftime("%Y-%m-%d"), "status": "active",
}, tok=TOK)
if st not in (200, 201):
    print("   skipped — could not create schedule:", st, str(sched)[:120])
else:
    sched_id = sched.get("id") or (sched.get("schedule") or {}).get("id")
    gout = {}
    def gen(k):
        gout[k] = call("POST", f"/schedules/{sched_id}/generate", None, tok=TOK)
    g1 = threading.Thread(target=gen, args=(1,)); g2 = threading.Thread(target=gen, args=(2,))
    g1.start(); g2.start(); g1.join(); g2.join()
    gcodes = sorted([gout[1][0], gout[2][0]])
    created = [v for v in gout.values() if v[0] == 201]
    print(f"   response codes: {gcodes}, orders created: {len(created)}")
    if len(created) > 1:
        failures.append("schedule generated the same shipment twice")
    else:
        print("   PASS — only one shipment claimed")

print("\n=== RESULT ===")
if failures:
    for f in failures: print("FAIL:", f)
    sys.exit(1)
print("all race tests passed")
