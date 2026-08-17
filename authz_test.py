#!/usr/bin/env python3
"""Authorisation checks.

A JWT lives 7 days and carries the role it was minted with. Deactivating or
demoting a user must take effect on their next request, not a week later.
"""
import json, os, sys, time
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
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}

st, r = call("POST", "/auth/login", {"email": "owner@icms.com", "password": "owner123"})
if st != 200:
    print("owner login failed:", st, r); sys.exit(1)
OWNER = r["token"]

fails = []
suffix = str(int(time.time()))
email = f"authz{suffix}@icms.test"

print("1. No token / bad token are rejected")
st, _ = call("GET", "/orders?limit=1")
print("   no token ->", st)
if st != 401: fails.append(f"missing token returned {st}, expected 401")
st, _ = call("GET", "/orders?limit=1", tok="not-a-real-token")
print("   bad token ->", st)
if st != 401: fails.append(f"invalid token returned {st}, expected 401")

print("2. Create a staff user and sign in as them")
st, u = call("POST", "/users",
             {"email": email, "name": "Authz Test", "password": "testpass123", "role": "staff"},
             tok=OWNER)
if st not in (200, 201):
    print("   could not create user:", st, u); sys.exit(1)
uid = u["id"]
st, r = call("POST", "/auth/login", {"email": email, "password": "testpass123"})
if st != 200:
    print("   staff login failed:", st, r); sys.exit(1)
STAFF = r["token"]
print("   staff token acquired")

print("3. Staff cannot reach owner-only endpoints")
st, _ = call("GET", "/users", tok=STAFF)
print("   staff GET /users ->", st)
if st != 403: fails.append(f"staff reached /users with {st}, expected 403")

print("4. Staff can reach staff-level endpoints")
st, _ = call("GET", "/orders?limit=1", tok=STAFF)
print("   staff GET /orders ->", st)
if st != 200: fails.append(f"staff blocked from /orders with {st}")

print("5. Deactivating the user takes effect on their existing token")
st, _ = call("PUT", f"/users/{uid}", {"is_active": False}, tok=OWNER)
st, body = call("GET", "/orders?limit=1", tok=STAFF)
print("   deactivated user, same token ->", st, body.get("error"))
if st != 401:
    fails.append(f"deactivated user still authorised ({st}) — token outlived the account")

print("6. Cleanup")
call("PUT", f"/users/{uid}", {"is_active": True}, tok=OWNER)
call("DELETE", f"/users/{uid}", None, tok=OWNER)

print("\n=== RESULT ===")
if fails:
    for f in fails: print("FAIL:", f)
    sys.exit(1)
print("authorization OK")
