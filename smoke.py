#!/usr/bin/env python3
"""Hit every read endpoint plus the main write paths, against whatever DB the
backend is currently configured for. Non-zero exit if anything 5xx's."""
import json, urllib.request as U, urllib.error, sys, time

B = __import__("os").environ.get("ICMS_BASE", "http://localhost:6001") + "/api"

def call(method, path, body=None, tok=None, raw=False):
    data = None if body is None else json.dumps(body).encode()
    h = {"Content-Type": "application/json"}
    if tok: h["Authorization"] = "Bearer " + tok
    req = U.Request(B + path, data=data, headers=h, method=method)
    try:
        r = U.urlopen(req, timeout=60)
        payload = r.read()
        return r.status, (payload if raw else json.loads(payload or b"{}"))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]
    except Exception as e:
        return 0, str(e)[:300]

tok = None
# The API rate-limits login attempts, so retry sparingly.
for _ in range(3):
    st, r = call("POST", "/auth/login", {"email": "owner@icms.com", "password": "owner123"})
    if st == 200:
        tok = r["token"]; break
    time.sleep(3)
if not tok:
    print("LOGIN FAILED:", st, r); sys.exit(1)
print("login OK")

# Use a supplier that actually exists rather than assuming id 1.
_st, _sup = call("GET", "/masters/suppliers?limit=1", tok=tok)
SID = (_sup.get("suppliers") or _sup.get("data") or [{}])[0].get("id", 1)
print("using supplier id", SID)

GETS = [
    "/orders?limit=5", "/orders/kanban", "/orders/forecast", "/orders/supplier-summary",
    "/orders/next-po-number?supplier_id=%d" % SID,
    "/masters/skus?limit=5", "/masters/suppliers?limit=5", "/masters/ports?limit=5",
    "/costing/containers", "/costing/suppliers", "/costing/items", "/costing/price-list",
    "/costing/fx-rate", "/costing/fx-drift",
    "/dashboard/stats", "/dashboard/insights", "/dashboard/financial", "/dashboard/logistics",
    "/analytics/trends", "/analytics/price-forecast", "/analytics/predict-eta",
    "/analytics/turnover", "/analytics/years",
    "/alerts", "/alerts/digest",
    "/financial/payments", "/financial/supplier-accounts", "/financial/cashflow-forecast",
    "/financial/due-alerts", "/financial/ledger/%d" % SID,
    "/reports/supplier-summary", "/reports/supplier-scorecard", "/reports/cycle-time", "/reports/containers", "/reports/tracking", "/reports/variance",
    "/reports/fx-impact",
    "/schedules", "/settings", "/users", "/documents", "/agent/status",
    "/documents/scan-status",
]

fails, missing = [], []
for p in GETS:
    st, r = call("GET", p, tok=tok)
    if st in (200, 201):
        tag = "ok  "
    elif st == 404:
        tag = "404 "; missing.append(p)
    else:
        tag = "FAIL"; fails.append((p, st, r))
    print(f"  {tag} {st} {p}")

print("\n--- write paths ---")
st, order = call("POST", "/orders", {
    "po_number": f"SMOKE-{int(time.time())}", "supplier_id": SID,
    "container_type": "40HC", "status": "Draft",
    "items": [{"item_name": "SMOKE ITEM", "total_roll": 10, "unit_price": 2.5,
               "total_ctn": 2, "kg_pkg": 1.5, "cbm": 0.4, "brand": "X", "notes": "n"}],
}, tok=tok)
print("  create order:", st)
if st != 201:
    fails.append(("POST /orders", st, order))
else:
    oid = order["id"]
    print("    id", oid, "items", len(order.get("items", [])), "value", order.get("total_value"))

    st2, upd = call("PUT", f"/orders/{oid}", {"notes": "edited by smoke", "status": "Confirmed"}, tok=tok)
    print("  update order:", st2, (upd.get("notes") if st2 == 200 else upd))
    if st2 != 200: fails.append((f"PUT /orders/{oid}", st2, upd))

    st6, stale = call("PUT", f"/orders/{oid}",
                      {"notes": "stale", "if_unmodified_since": "2000-01-01T00:00:00.000Z"}, tok=tok)
    print("  stale-write rejected:", st6, "(expect 409)")
    if st6 != 409: fails.append(("optimistic-lock", st6, stale))

    st3, trk = call("POST", f"/orders/{oid}/tracking", {"event": "Loaded", "location": "Ningbo"}, tok=tok)
    print("  tracking append:", st3, trk if st3 != 200 else trk.get("tracking_updates"))
    if st3 != 200: fails.append(("tracking", st3, trk))

    st4, dup = call("POST", f"/orders/{oid}/duplicate", None, tok=tok)
    print("  duplicate:", st4, dup.get("po_number") if st4 == 201 else dup)
    if st4 != 201: fails.append(("duplicate", st4, dup))

    st5, patched = call("PATCH", f"/orders/{oid}/status", {"status": "Shipped"}, tok=tok)
    print("  status patch:", st5)
    if st5 != 200: fails.append(("status patch", st5, patched))

st, s = call("PUT", "/settings", {"company_name": "ICMS Smoke"}, tok=tok)
print("  settings upsert:", st, s.get("settings", {}).get("company_name") if st == 200 else s)
if st != 200: fails.append(("settings", st, s))

print("\n=== RESULT ===")
if missing: print(f"{len(missing)} endpoint(s) not present (404, not a DB error)")
if fails:
    print(f"{len(fails)} FAILURE(S):")
    for p, st, r in fails:
        print(f"  {st} {p}\n      {r}")
    sys.exit(1)
print("all green")
