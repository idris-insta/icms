#!/usr/bin/env python3
"""Exercise the paths a plain endpoint sweep never touches: Excel import of
historical orders and master data, document upload/download, and the data the
print/PDF view renders from."""
import json, os, subprocess, sys, uuid
import urllib.request as U, urllib.error

BASE = os.environ.get("ICMS_BASE", "http://127.0.0.1:8099")
B = BASE + "/api"
FIXTURES = "/tmp/icms-fixtures"
PO1 = PO2 = None
TAG = str(int(__import__("time").time()))[-6:]

def call(method, path, body=None, tok=None, timeout=180):
    data = None if body is None else json.dumps(body).encode()
    h = {"Content-Type": "application/json"}
    if tok: h["Authorization"] = "Bearer " + tok
    req = U.Request(B + path, data=data, headers=h, method=method)
    try:
        r = U.urlopen(req, timeout=timeout)
        return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}

def post_file(path, filepath, tok, fields=None, filename=None, ctype=None, timeout=300):
    boundary = "----icmsIMPORT" + uuid.uuid4().hex[:8]
    name = filename or os.path.basename(filepath)
    ctype = ctype or ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      if name.endswith(".xlsx") else "application/octet-stream")
    body = b""
    for k, v in (fields or {}).items():
        body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n").encode()
    body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
             f"Content-Type: {ctype}\r\n\r\n").encode()
    with open(filepath, "rb") as f:
        body += f.read()
    body += (f"\r\n--{boundary}--\r\n").encode()
    req = U.Request(B + path, data=body,
                    headers={"Authorization": "Bearer " + tok,
                             "Content-Type": "multipart/form-data; boundary=" + boundary},
                    method="POST")
    try:
        r = U.urlopen(req, timeout=timeout)
        return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}

st, r = call("POST", "/auth/login", {"email": "owner@icms.com", "password": "owner123"})
TOK = r["token"]
fails = []

st, sup = call("GET", "/masters/suppliers?limit=1", tok=TOK)
SUP = (sup.get("suppliers") or [{}])[0]
print("using supplier:", SUP.get("code"))
PO1 = f"XLS-IMP-{TAG}-1"
PO2 = f"XLS-IMP-{TAG}-2"

print("0. Building .xlsx fixtures")
out = subprocess.run(["node", "make_fixtures.js", SUP.get("code", "ISLB"), FIXTURES, TAG],
                     capture_output=True, text=True)
print("  ", out.stdout.strip().replace("\n", "\n   ") or out.stderr[:300])
if out.returncode != 0:
    print("could not build fixtures"); sys.exit(1)

print("1. Order import template downloads")
req = U.Request(B + "/orders/import/template", headers={"Authorization": "Bearer " + TOK})
try:
    raw = U.urlopen(req, timeout=60).read()
    ok = raw[:2] == b"PK" and len(raw) > 500
    print(f"   template: {len(raw)} bytes, xlsx={ok}")
    if not ok: fails.append("import template is not a valid xlsx")
except urllib.error.HTTPError as e:
    fails.append(f"import template {e.code}")

print("2. Importing historical orders from Excel")
st, r = post_file("/orders/import", f"{FIXTURES}/orders.xlsx", TOK)
print("   ->", st, json.dumps(r)[:300])
if st != 200:
    fails.append(f"orders import {st}: {json.dumps(r)[:200]}")
else:
    if r.get("created", 0) < 2:
        fails.append(f"expected 2 orders created, got {r.get('created')} (errors: {r.get('errors')})")

print("3. Verifying imported data landed correctly")
st, lst = call("GET", "/orders?search=XLS-IMP-" + TAG + "", tok=TOK)
pos = {o["po_number"]: o for o in lst.get("orders", [])}
print("   found:", sorted(pos))
for want in (PO1, PO2):
    if want not in pos:
        fails.append(f"{want} missing after import")
if PO1 in pos:
    oid = pos[PO1]["id"]
    st, full = call("GET", f"/orders/{oid}", tok=TOK)
    items = full.get("items", [])
    print(f"   {PO1}: {len(items)} items, total_value={full.get('total_value')}, etd={full.get('etd')}")
    for it in items:
        print(f"      {it.get('item_name')} brand={it.get('brand')!r} roll={it.get('total_roll')} "
              f"price={it.get('unit_price')} sqm={it.get('price_per_sqm')} notes={it.get('notes')!r}")
    if len(items) != 2:
        fails.append(f"{PO1} should have 2 items, has {len(items)}")
    # 720*2.45 + 160*8.10 = 1764 + 1296 = 3060
    if abs(float(full.get("total_value") or 0) - 3060) > 1:
        fails.append(f"total_value {full.get('total_value')} != expected 3060")
    etd = str(full.get("etd") or "")
    if "2026-01-10" not in etd:
        fails.append(f"etd did not survive the Excel date conversion: {etd!r}")
    if not any(i.get("brand") == "ACME" for i in items):
        fails.append("brand column did not import")
    if not any((i.get("notes") or "") for i in items):
        fails.append("item notes column did not import")

print("4. Importing master data")
for name, path_, key in (("SKUs", "skus.csv", "/masters/skus/bulk"),
                         ("Suppliers", "suppliers.csv", "/masters/suppliers/bulk"),
                         ("Ports", "ports.csv", "/masters/ports/bulk")):
    st, r = post_file(key, f"{FIXTURES}/{path_}", TOK)
    print(f"   {name}: {st} {json.dumps(r)[:160]}")
    if st != 200:
        fails.append(f"{name} import {st}: {json.dumps(r)[:160]}")
    elif (r.get("inserted", 0) + r.get("updated", 0)) < 1:
        fails.append(f"{name} import reported nothing inserted/updated: {json.dumps(r)[:160]}")

print("5. Re-importing is idempotent (upsert, not duplicate)")
st, r = post_file("/masters/skus/bulk", f"{FIXTURES}/skus.csv", TOK)
print("   SKUs again:", st, json.dumps(r)[:160])
if st == 200 and r.get("inserted", 0) > 0:
    fails.append(f"re-import inserted {r.get('inserted')} duplicates instead of updating")

print("6. Document upload + download round-trip")
if PO1 in pos:
    oid = pos[PO1]["id"]
    st, up = post_file("/documents/upload", f"{FIXTURES}/orders.xlsx", TOK,
                       fields={"order_id": str(oid), "doc_type": "Commercial Invoice"})
    print("   upload:", st, json.dumps(up)[:200])
    if st not in (200, 201):
        fails.append(f"document upload {st}: {json.dumps(up)[:200]}")
    else:
        did = up.get("id") or (up.get("document") or {}).get("id")
        req = U.Request(B + f"/documents/{did}/download", headers={"Authorization": "Bearer " + TOK})
        try:
            blob = U.urlopen(req, timeout=60).read()
            print(f"   download: {len(blob)} bytes, xlsx={blob[:2] == b'PK'}")
            if blob[:2] != b"PK":
                fails.append("downloaded document is corrupt")
        except urllib.error.HTTPError as e:
            fails.append(f"document download {e.code}")

print("7. Print view data (what the PO print page renders from)")
if PO1 in pos:
    st, full = call("GET", f"/orders/{pos[PO1]['id']}", tok=TOK)
    need = ["po_number", "supplier", "container_type", "items", "total_value", "marking"]
    missing = [k for k in need if full.get(k) in (None, "")]
    print("   fields present:", [k for k in need if k not in missing])
    if missing:
        fails.append(f"print view missing fields: {missing}")
    st, s = call("GET", "/settings", tok=TOK)
    hdr = (s.get("settings") or {}).get("company_name")
    print("   company_name for letterhead:", repr(hdr))
    if not hdr:
        fails.append("company_name setting missing — print header would be blank")

print("\n=== RESULT ===")
if fails:
    for f in fails: print("FAIL:", f)
    sys.exit(1)
print("import / upload / print data OK")
