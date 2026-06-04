# CLAUDE.md — ICMS (Import & Container Management System)

Single source of truth for all Claude Code sessions on this repo.
**Read this before touching any file. Update this whenever something new is learned.**

---

## Agent Operating Rules (STRICT, ALWAYS FOLLOW)

### 1) No Assumptions, Ever
- Never guess field names, table names, route paths, or API contracts.
- Always verify from source: `icms-backend/schema.sql`, route files in `icms-backend/src/routes/`, and `icms-frontend/src/ICMSPreview.jsx`.
- If evidence is missing or ambiguous, ask the user before implementing.

### 2) Verify-First Workflow
- Before coding: inspect current behavior, validate dependencies, identify risks.
- Before marking complete: confirm the server responds correctly (health check or curl).
- Report what was verified and what was not.

### 3) Production Safety
- Prefer minimal targeted edits over broad refactors.
- Never remove or alter working behavior silently.
- If a change affects other features, call it out first.

### 4) Port Discipline (CRITICAL)
- **Always check which ports are free before starting servers.**
- Use `cat /proc/net/tcp` and convert hex → decimal to see active ports.
- Known conflicts on the user's local machine: port **3000** is used by WebUI.
- Current canonical ports: **backend = 4000**, **frontend = 5000**.
- These are committed in `vite.config.js` and `.env`. Do not change without checking.

### 5) Local vs Cloud Execution
- Servers run in the **cloud container**, not on the user's local machine.
- The user accesses the app from their **local WSL machine** (`/home/luffy/icms`).
- `localhost:5000` in the cloud container is NOT accessible to the user.
- When the user says "it won't connect", the fix is: pull latest code and run locally.
- Cloud container IPs are private — no public tunnel is available (localtunnel/cloudflared blocked).

### 6) Completion Checklist
- [ ] Health check passes: `curl http://localhost:4000/api/health` returns `{"status":"ok","db":"connected"}`
- [ ] Frontend HTTP 200: `curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/`
- [ ] Changes committed and pushed to `claude/gallant-edison-9CP1T`

---

## Project Overview

**App:** ICMS — Import & Container Management System
**Use Case:** Track international import orders from purchase through customs clearance to delivery. Manage suppliers, SKUs, containers, payments, and shipping documents.
**Repo:** `idris-insta/icms`
**Branch:** `claude/gallant-edison-9CP1T`

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite 8 |
| Backend | Node.js + Express 4 |
| Database | PostgreSQL 16 |
| Auth | JWT (7-day tokens) + bcryptjs |
| File uploads | multer (20 MB limit, disk storage) |

---

## Running the App

### Cloud Container (for development/testing)
```bash
# Start PostgreSQL
sudo service postgresql start

# Backend (port 4000)
cd /home/user/icms/icms-backend
node src/index.js &

# Frontend (port 5000)
cd /home/user/icms/icms-frontend
npm run dev &

# Verify
curl http://localhost:4000/api/health
```

### User's Local WSL Machine (/home/luffy/icms)
```bash
cd /home/luffy/icms
git pull origin claude/gallant-edison-9CP1T

# Terminal 1 — Backend
cd icms-backend
npm install
node src/index.js

# Terminal 2 — Frontend
cd icms-frontend
npm install     # if fails: npm install --ignore-scripts
npm run dev
```
Then open browser at **http://localhost:5000**

---

## Login Credentials
| Email | Password | Role |
|-------|----------|------|
| `owner@icms.com` | `owner123` | owner |

Password hash in DB must match `bcryptjs.hash('owner123', 10)`.
If login fails, regenerate: `node -e "const b=require('bcryptjs'); b.hash('owner123',10).then(console.log)"`
Then: `UPDATE users SET password_hash='<new_hash>' WHERE email='owner@icms.com';`

---

## Environment Variables

### `icms-backend/.env` (NOT committed)
```
DATABASE_URL=postgresql://icms_user:icms123@localhost:5432/icms
PORT=4000
JWT_SECRET=icms_jwt_secret_key_2024
```

### Database credentials
- User: `icms_user`, Password: `icms123`, DB: `icms`
- After fresh DB creation, always run grants:
```sql
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO icms_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO icms_user;
```

---

## File Structure

```
icms/
├── CLAUDE.md                        ← this file
├── setup-and-run.sh                 ← one-command WSL setup script
├── icms-backend/
│   ├── src/
│   │   ├── index.js                 ← Express app entry point, route mounts
│   │   ├── db.js                    ← pg Pool, query wrapper
│   │   ├── middleware/auth.js       ← JWT Bearer token verification
│   │   └── routes/
│   │       ├── auth.js              ← POST /login, GET /me
│   │       ├── orders.js            ← Full CRUD for import_orders + order_items
│   │       ├── masters.js           ← CRUD + CSV bulk import for suppliers/skus/ports
│   │       ├── financial.js         ← Payments, supplier ledger, due alerts
│   │       ├── dashboard.js         ← Stats, financial summary, logistics overview
│   │       ├── reports.js           ← Supplier summary, containers, tracking, variance
│   │       ├── documents.js         ← File upload/download per order
│   │       └── settings.js          ← Key-value company settings
│   ├── schema.sql                   ← Authoritative DB schema + seed data
│   ├── migrate.js                   ← Idempotent migration runner
│   └── package.json
└── icms-frontend/
    ├── src/
    │   ├── ICMSPreview.jsx          ← ENTIRE frontend app (single large component)
    │   ├── App.jsx
    │   └── main.jsx
    ├── vite.config.js               ← port: 5000, host: 0.0.0.0, allowedHosts: all
    └── package.json
```

---

## Database Schema

### Tables

| Table | Key Fields | Notes |
|-------|-----------|-------|
| `users` | id, email, password_hash, name, role, is_active | role: owner/staff |
| `suppliers` | id, code (unique), name, country, base_currency, payment_terms_days, port, avg_value_usd, ex_rate, duty_percent, expense_inr, target_per_month | soft-delete via is_active |
| `skus` | id, sku_code (unique), description, hsn_code, category, thickness, size, color, liner_color, roll_weight, weight_per_unit, cbm_per_unit | |
| `ports` | id, code (unique), name, country, port_type | port_type: origin/destination/both |
| `import_orders` | id, po_number (unique), supplier_id, container_type, currency, status, priority, marking, totals (qty/weight/cbm/value), utilization_percentage, eta, etd, shipment_date, bl_number, payment_due_date, freight_cost, insurance_cost, duty_rate, free_days, demurrage_rate, container_returned_date, doc_checklist (JSONB), tracking_updates (JSONB), **shipped** (bool), **delivered** (bool) | |
| `order_items` | id, order_id, item_name, thickness, size, liner_color, total_ctn, total_roll, unit_price, kg_pkg, code, shipping_mark, cbm | cascades on order delete |
| `payments` | id, reference (unique), order_id, supplier_id, amount, currency, payment_date, payment_type | payment_type: TT/LC/advance |
| `documents` | id, order_id, doc_type, filename, original_name, file_path, file_size, mime_type, uploaded_by | physical files in ./uploads |
| `settings` | key (PK), value | company_name, default_currency, pdf_header_text, etc. |

### Order Status Flow
```
Draft → Tentative → Confirmed → Loaded → Shipped → In Transit → Arrived → Customs Clearance → Cleared → Delivered
```
Valid statuses (enforced by PATCH /status): `Draft, Tentative, Confirmed, Loaded, Shipped, In Transit, Arrived, Customs Clearance, Cleared, Delivered`

### Order Priority Values
`low, normal, high, urgent`

### Supplier Cost Price Formula
```
cp_inr = ((avg_value_usd × ex_rate × (1 + duty_percent/100)) + expense_inr) / avg_value_usd
```

---

## API Reference

All routes require `Authorization: Bearer <token>` except `/api/auth/login`.

### Auth
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/login` | `{ email, password }` → `{ token, user }` |
| GET | `/api/auth/me` | Returns current user from token |

### Orders
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/orders` | List orders. Query: `?status=&search=` |
| GET | `/api/orders/kanban` | Grouped by status for kanban view |
| GET | `/api/orders/supplier-summary` | Per-supplier stats with week breakdown + CP formula |
| GET | `/api/orders/next-po-number?supplier_id=` | Auto-generate next PO number |
| GET | `/api/orders/:id` | Single order with items[] |
| POST | `/api/orders` | Create order. Items[] auto-calculates totals |
| PUT | `/api/orders/:id` | Update order. Items[] replaces existing |
| PATCH | `/api/orders/:id/status` | `{ status }` — validated against VALID list |
| POST | `/api/orders/:id/tracking` | `{ location, event, note }` — appends to tracking_updates JSONB |
| DELETE | `/api/orders/:id` | Hard delete |

### Masters
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/masters/skus` | All SKUs |
| POST | `/api/masters/skus` | Create SKU |
| PUT | `/api/masters/skus/:id` | Update SKU |
| DELETE | `/api/masters/skus/:id` | Hard delete |
| GET | `/api/masters/skus/template` | Download CSV template |
| POST | `/api/masters/skus/bulk` | CSV bulk upsert (multipart file) |
| GET | `/api/masters/suppliers` | All suppliers |
| POST | `/api/masters/suppliers` | Create supplier |
| PUT | `/api/masters/suppliers/:id` | Update supplier (including port/ex_rate/duty_percent etc.) |
| DELETE | `/api/masters/suppliers/:id` | Soft delete (is_active = false) |
| GET/POST | `/api/masters/suppliers/template` | CSV template / bulk upsert |
| GET | `/api/masters/ports` | All ports |
| POST | `/api/masters/ports` | Create port |
| GET/POST | `/api/masters/ports/template` | CSV template / bulk upsert |

### Financial
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/financial/payments` | payments_made + payments_due |
| POST | `/api/financial/payments` | Record payment |
| DELETE | `/api/financial/payments/:id` | Delete payment |
| GET | `/api/financial/supplier-accounts` | All suppliers with balance |
| GET | `/api/financial/ledger/:supplier_id` | Merged debit/credit ledger with running balance |
| GET | `/api/financial/due-alerts` | overdue / due_soon / upcoming payments |

### Dashboard
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dashboard/stats` | total_orders, pending, suppliers, skus, pipeline_value, orders_by_status, utilization_stats |
| GET | `/api/dashboard/financial` | payment_summary, fx_exposure, supplier_balances |
| GET | `/api/dashboard/logistics` | container_utilization, arriving_soon (7 days), demurrage_alerts |

### Reports
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/reports/supplier-summary` | Pending/shipped/delivered/balance per supplier |
| GET | `/api/reports/containers` | Container utilization stats |
| GET | `/api/reports/tracking` | All non-delivered orders with ETA |
| GET | `/api/reports/variance` | Weight/CBM variance vs SKU master |

### Documents
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/documents?order_id=` | List documents |
| POST | `/api/documents/upload` | multipart: file + order_id + doc_type |
| GET | `/api/documents/:id/download` | Stream file download |
| DELETE | `/api/documents/:id` | Delete file + DB record |

### Settings
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/settings` | All key-value settings |
| PUT | `/api/settings` | Upsert `{ key: value, ... }` pairs |

### Health
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | `{ status: "ok", db: "connected", ts }` |

---

## Frontend Key Facts

- **Single component:** The entire app lives in `icms-frontend/src/ICMSPreview.jsx` (~2000+ lines).
- **API base URL** (line 4): `const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:4000") + "/api";`
  - Change this when backend port changes.
  - Can also be set via `.env` file: `VITE_API_URL=http://localhost:4000`
- **Vite config** (`vite.config.js`): port 5000, host 0.0.0.0, allowedHosts: all
- **No UI library** — pure React with inline styles/CSS.
- **Platform gotcha:** `@rolldown/binding-win32-x64-msvc` — a Windows-only package may appear in `package-lock.json` on Windows machines. On Linux/WSL use `npm install --ignore-scripts` if npm install fails with `EBADPLATFORM`.

---

## Known Issues & Fixes Applied

| Issue | Fix Applied |
|-------|------------|
| `@rolldown/binding-win32-x64-msvc` EBADPLATFORM on Linux | Removed from `package.json`; use `npm install --ignore-scripts` if still fails |
| `import_orders` missing `shipped`, `delivered` columns | Added in schema.sql via ALTER TABLE |
| `suppliers` missing `port`, `avg_value_usd`, `ex_rate`, `duty_percent`, `expense_inr`, `target_per_month` | Added in schema.sql |
| `icms_user` had no table permissions | Run GRANT statements after schema load |
| Password hash mismatch for owner@icms.com | Regenerate with bcryptjs and UPDATE users |
| Port 3000 conflicts with user's WebUI | Frontend moved to port 5000 |

---

## Setup Script

`setup-and-run.sh` — one-command setup for a fresh WSL machine:
```bash
curl -fsSL https://raw.githubusercontent.com/idris-insta/icms/claude/gallant-edison-9CP1T/setup-and-run.sh | bash
# OR if repo already cloned:
bash /home/luffy/icms/setup-and-run.sh
```
Script: installs Node.js 20 + PostgreSQL, creates DB + user + grants, loads schema, fixes password hash, starts backend (4000) + frontend (5000), waits for Ctrl+C.

---

## Git Workflow

```bash
# All development on this branch:
git checkout claude/gallant-edison-9CP1T

# Push
git push -u origin claude/gallant-edison-9CP1T

# Commit message format
git commit -m "Short description of what changed"
```

---

## Common Commands

```bash
# Check what ports are in use (no ss/netstat available)
cat /proc/net/tcp  # hex ports in column 2 (local_address after the colon)
printf '%d\n' 0x0BB8  # convert hex to decimal

# Kill process on a port
kill $(lsof -t -i:<port>) 2>/dev/null || true

# PostgreSQL
sudo service postgresql start
sudo -u postgres psql -d icms

# Verify health
curl http://localhost:4000/api/health

# Backend logs
tail -f /tmp/backend.log

# Frontend logs
tail -f /tmp/frontend.log

# Regenerate password hash
node -e "const b=require('./icms-backend/node_modules/bcryptjs'); b.hash('owner123',10).then(console.log)"
```

---

## Seed Data (from schema.sql)

### Suppliers
| Code | Name | Country | Currency |
|------|------|---------|---------|
| GPC-001 | Guangzhou Plastics Co. | China | CNY |
| MPG-002 | MechParts GmbH | Germany | EUR |
| STL-003 | Shenzhen Tech Ltd. | China | USD |
| SAH-004 | Seoul Apparel House | South Korea | USD |
| MTI-005 | Mumbai Textiles India | India | INR |
| TJS-006 | Tianjin Steel | China | CNY |

### Sample Orders
PO-2026-001 through PO-2026-009 covering statuses: Draft, Confirmed, Loaded, Shipped, In Transit, Customs Clearance, Delivered.

### Default Settings
`company_name`, `company_address`, `company_phone`, `company_email`, `pdf_header_text`, `pdf_footer_text`, `show_duty_on_pdf`, `default_currency`

---

## Self-Improvement Notes

> This section should be updated by Claude whenever new patterns, bugs, or fixes are discovered.

- **2026-06-04:** Established ports 4000 (backend) + 5000 (frontend) as canonical after discovering port 3000 conflict with user's WebUI.
- **2026-06-04:** Cloud container cannot expose ports publicly. User must run locally on WSL at `/home/luffy/icms`.
- **2026-06-04:** `cat /proc/net/tcp` is the reliable way to check ports (no `ss` or `netstat` available).
- **2026-06-04:** `shipped` and `delivered` boolean columns were added to `import_orders` post-initial schema — already in schema.sql now.
- **2026-06-04:** Supplier extended fields (`port`, `avg_value_usd`, `ex_rate`, `duty_percent`, `expense_inr`, `target_per_month`) already in schema.sql.
