#!/usr/bin/env python3
"""Verify the order list search filters (ILIKE had no MariaDB equivalent) and
that the total count is read back correctly (MariaDB names a bare COUNT(*)
column differently to PostgreSQL)."""
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
        return e.code, e.read().decode()[:200]

st, r = call("POST", "/auth/login", {"email": "owner@icms.com", "password": "owner123"})
if st != 200:
    print("login failed:", st, r); sys.exit(1)
TOK = r["token"]

fails = []

st, all_orders = call("GET", "/orders?limit=200", tok=TOK)
total_all = all_orders["total"]
n_all = len(all_orders["orders"])
print(f"unfiltered: total={total_all} returned={n_all}")
if not isinstance(total_all, int) or total_all != n_all:
    fails.append(f"total ({total_all!r}) does not match returned rows ({n_all})")

for term in ("ISLB", "ISKA"):
    st, r = call("GET", f"/orders?search={term}", tok=TOK)
    if st != 200:
        fails.append(f"search={term} returned {st}: {r}"); continue
    pos = [o["po_number"] for o in r["orders"]]
    sups = [o.get("supplier", "") for o in r["orders"]]
    matched = all(term.lower() in p.lower() or term.lower() in s.lower()
                  for p, s in zip(pos, sups))
    print(f"search={term}: total={r['total']} returned={len(pos)} all_match={matched}")
    if len(pos) == 0:
        fails.append(f"search={term} matched nothing")
    elif len(pos) >= n_all:
        fails.append(f"search={term} did not narrow the list ({len(pos)} of {n_all})")
    elif not matched:
        fails.append(f"search={term} returned non-matching rows: {pos}")

st, r = call("GET", "/orders?search=zzz-no-such-po", tok=TOK)
print(f"search=nonsense: total={r['total']} returned={len(r['orders'])}")
if r["total"] != 0:
    fails.append(f"nonsense search returned {r['total']} rows")

st, r = call("GET", "/masters/skus?limit=5", tok=TOK)
print(f"skus: total={r.get('total')} returned={len(r.get('skus', []))}")
if not isinstance(r.get("total"), int) or r["total"] < 1:
    fails.append(f"skus total is {r.get('total')!r} — COUNT(*) not read back correctly")

print("\n=== RESULT ===")
if fails:
    for f in fails: print("FAIL:", f)
    sys.exit(1)
print("search + counts OK")
