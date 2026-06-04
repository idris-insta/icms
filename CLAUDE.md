# ICMS — Import & Container Management System
## Claude Code Project Reference

---

## 1. WHAT THIS PROJECT IS

ICMS is a full-stack internal business application used to manage **import shipments, suppliers, containers, payments, and shipping documents** for a company that imports goods (insulation materials, rolls, cartons) from overseas suppliers — primarily from China.

**The business workflow is:**
1. A purchase order (PO) is raised for a supplier → creates an `import_orders` record
2. The order goes through a lifecycle: Draft → Tentative → Confirmed → Loaded → Shipped → In Transit → Arrived → Customs Clearance → Cleared → Delivered
3. Line items (rolls, cartons of insulation) are recorded against the order with quantities, prices, CBM, and weight
4. Payments (TT wire transfers) are tracked against each order/supplier
5. Documents (Bill of Lading, Invoice, Packing List, COO, etc.) are uploaded and stored
6. The supplier dashboard tracks weekly ETD, cost-per-roll (CP ₹), exchange rates, duty, and landed cost

---

## 2. ARCHITECTURE

```
icms/
├── icms-backend/          # Node.js + Express REST API
│   ├── src/
│   │   ├── index.js       # Entry point — Express app setup, all routes mounted
│   │   ├── db.js          # PostgreSQL pool (pg library), wraps pool.query
│   │   ├── migrate.js     # Idempotent migration script — run after any schema change
│   │   ├── middleware/
│   │   │   ├── auth.js    # JWT bearer token verification (protects all routes)
│   │   │   └── authorize.js  # Role-based guard (owner / staff / viewer)
│   │   └── routes/
│   │       ├── auth.js       # POST /api/auth/login  — returns JWT
│   │       ├── orders.js     # CRUD import_orders + supplier-summary + kanban + tracking
│   │       ├── financial.js  # CRUD payments + supplier ledger
│   │       ├── masters.js    # CRUD suppliers, SKUs, ports
│   │       ├── documents.js  # Upload / download / delete shipping documents
│   │       ├── dashboard.js  # KPIs, logistics stats, analytics
│   │       ├── reports.js    # Variance report
│   │       └── settings.js   # Key-value app settings
│   ├── .env               # Live environment — DB URL, port, JWT secret
│   └── package.json
│
├── icms-frontend/         # React 19 + Vite SPA (single-file component)
│   ├── src/
│   │   ├── main.jsx       # Vite entry — mounts <App />
│   │   ├── App.jsx        # Thin wrapper — renders <ICMSPreview />
│   │   └── ICMSPreview.jsx  # ENTIRE frontend in one 2600+ line file
│   ├── .env               # VITE_API_URL=http://localhost:6001
│   └── vite.config.js     # host: '0.0.0.0', port: 5173, allowedHosts: 'all'
│
├── start-icms.sh          # Bash startup script (starts PG, BE, FE)
├── CLAUDE.md              # This file
└── HOW_TO_START.md        # Quick-start guide
```

---

## 3. RUNNING THE PROJECT ON LOCALHOST (ALWAYS)

### Prerequisites (WSL2 environment)

| Service     | Port  | Notes                                   |
|-------------|-------|-----------------------------------------|
| PostgreSQL  | 5433  | Running directly on WSL2 (not Docker)   |
| Backend API | 6001  | Node.js Express server                  |
| Frontend    | 5173  | Vite dev server                         |

### Start PostgreSQL (if not running)
```bash
sudo service postgresql start
# Verify:
pg_isready -h localhost -p 5433
```

### Start Backend
```bash
cd /home/luffy/icms/icms-backend
node src/index.js &
# Or with auto-reload:
npx nodemon src/index.js &

# Verify:
curl http://localhost:6001/api/health
# Expected: {"status":"ok","db":"connected"}
```

### Start Frontend
```bash
cd /home/luffy/icms/icms-frontend
npx vite --host &

# Verify:
curl -s http://localhost:5173 | head -3
```

### Access the app
- **URL:** http://localhost:5173
- **Login:** `owner@icms.com` / `owner123`
- **API base:** http://localhost:6001/api

### Quick check if everything is running
```bash
curl -s http://localhost:6001/api/health
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```

### Restart if crashed
```bash
# Kill stale processes
pkill -f "node src/index.js" 2>/dev/null
pkill -f "vite" 2>/dev/null

# Restart
cd /home/luffy/icms/icms-backend && nohup node src/index.js > /tmp/icms-backend.log 2>&1 &
cd /home/luffy/icms/icms-frontend && nohup npx vite --host > /tmp/icms-frontend.log 2>&1 &
```

---

## 4. ENVIRONMENT CONFIGURATION

### Backend: `/home/luffy/icms/icms-backend/.env`
```
DATABASE_URL=postgresql://icms_user:icms123@localhost:5433/icms
PORT=6001
JWT_SECRET=icms_jwt_secret_key_2024
```

### Frontend: `/home/luffy/icms/icms-frontend/.env`
```
VITE_API_URL=http://localhost:6001
```
**CRITICAL:** After editing `.env`, you MUST restart Vite — it does NOT hot-reload env files.

---

## 5. DATABASE

### Connection
- **Host:** localhost
- **Port:** 5433 (non-default — PostgreSQL was installed on 5433, not 5432)
- **Database:** icms
- **User:** icms_user / Password: icms123
- **Superuser access:** `sudo -u postgres psql -p 5433` (needed for ALTER TABLE on tables owned by postgres)

### Connect as app user
```bash
PGPASSWORD=icms123 psql -U icms_user -h localhost -p 5433 -d icms
```

### All Tables

#### `users`
| Column        | Type         | Notes                              |
|---------------|--------------|------------------------------------|
| id            | integer PK   |                                    |
| email         | varchar(255) | UNIQUE, used for login             |
| password_hash | varchar(255) | bcryptjs hash                      |
| name          | varchar(255) |                                    |
| role          | varchar(50)  | 'owner' / 'staff' / 'viewer'      |
| is_active     | boolean      | default true                       |

Default user: `owner@icms.com` / `owner123` / role: `owner`

To reset password:
```bash
node -e "require('bcryptjs').hash('owner123',10).then(h=>console.log(h))"
# Then: UPDATE users SET password_hash='<hash>' WHERE email='owner@icms.com';
```

#### `suppliers`
| Column           | Type          | Notes                                          |
|------------------|---------------|------------------------------------------------|
| id               | integer PK    |                                                |
| code             | varchar(50)   | UNIQUE, e.g. 'GPC-001'                        |
| name             | varchar(255)  |                                                |
| country          | varchar(100)  |                                                |
| base_currency    | varchar(10)   | 'USD' / 'CNY' / 'EUR' etc.                   |
| contact_email    | varchar(255)  |                                                |
| contact_phone    | varchar(50)   |                                                |
| payment_terms_days | integer     | Used to auto-calculate payment_due_date         |
| port             | varchar(100)  | Departure port (added via ALTER TABLE)         |
| avg_value_usd    | numeric(12,2) | Average container value — for CP calculation  |
| ex_rate          | numeric(10,4) | INR per USD exchange rate (default 84)         |
| duty_percent     | numeric(5,2)  | Import duty % (default 10)                    |
| expense_inr      | numeric(12,2) | Other INR expenses per container               |
| target_per_month | integer       | Target containers per month                    |

**CP (Cost Price) formula:** `((avg_value_usd × ex_rate × (1 + duty_percent/100)) + expense_inr) / avg_value_usd`
This gives landed cost in INR per USD of goods value.

#### `import_orders`
| Column                  | Type          | Notes                                               |
|-------------------------|---------------|-----------------------------------------------------|
| id                      | integer PK    |                                                     |
| po_number               | varchar(50)   | UNIQUE, e.g. 'GPC 00126' (auto-generated)          |
| supplier_id             | integer FK    | → suppliers.id                                      |
| container_type          | varchar(20)   | '20FT' / '40FT' / '40HC'                          |
| currency                | varchar(10)   | 'USD' / 'CNY' / etc.                               |
| status                  | varchar(50)   | See STATUS LIFECYCLE below                          |
| priority                | varchar(20)   | 'urgent' / 'high' / 'normal' / 'low'               |
| marking                 | text          | Container marking/code, e.g. '1MM'                 |
| total_quantity          | integer       | Total rolls (sum of order_items.total_roll)        |
| total_weight            | numeric(12,2) | Total kg                                            |
| total_cbm               | numeric(10,2) | Total cubic meters (sum of order_items.cbm)        |
| total_value             | numeric(15,2) | Total USD value                                     |
| utilization_percentage  | numeric(5,2)  | Container fill %                                    |
| etd                     | date          | Estimated Time of Departure                        |
| eta                     | date          | Estimated Time of Arrival                          |
| shipment_date           | date          | Actual shipment date                                |
| bl_number               | varchar(100)  | Bill of Lading number                              |
| payment_due_date        | date          | Auto-calc: shipment_date + payment_terms_days      |
| tracking_updates        | jsonb         | Array of {event, location, note, ts}              |
| freight_cost            | numeric(12,2) | USD                                                 |
| insurance_cost          | numeric(12,2) | USD                                                 |
| duty_rate               | numeric(5,2)  | % — used for landed cost calculation               |
| free_days               | integer       | Demurrage-free days (default 7)                    |
| demurrage_rate          | numeric(10,2) | USD/day after free_days                            |
| container_returned_date | date          | For demurrage calculation                          |
| doc_checklist           | jsonb         | {BL: bool, Invoice: bool, ...}                    |
| notes                   | text          |                                                     |

**Status lifecycle:** Draft → Tentative → Confirmed → Loaded → Shipped → In Transit → Arrived → Customs Clearance → Cleared → Delivered

**IMPORTANT — shipped/delivered are NOT columns.** They are derived in SQL:
```sql
(o.status NOT IN ('Draft','Tentative','Confirmed')) AS shipped,
(o.status = 'Delivered') AS delivered
```

**PO number format:** `{SUPPLIER_CODE} {NNN}{YY}` e.g. `GPC 00126` — auto-generated by `/api/orders/next-po-number?supplier_id=X`

#### `order_items`
| Column       | Type           | Notes                                    |
|--------------|----------------|------------------------------------------|
| id           | integer PK     |                                          |
| order_id     | integer FK     | → import_orders.id (ON DELETE CASCADE)  |
| sku_id       | integer FK     | → skus.id (nullable)                    |
| item_name    | varchar(255)   | Product name                             |
| thickness    | varchar(50)    | e.g. '0.9MM'                            |
| size         | varchar(100)   | e.g. '1000MM×50M'                       |
| liner_color  | varchar(50)    | e.g. 'YELLOW'                           |
| qty_ctn      | integer        | Qty per carton (rolls per carton)        |
| total_ctn    | integer        | Total cartons                            |
| total_roll   | integer        | = total_ctn × qty_ctn (auto-calculated) |
| unit_price   | numeric(12,4)  | Price per roll in order currency         |
| weight       | numeric(10,2)  | Total weight kg for this row            |
| kg_pkg       | numeric(10,4)  | KG per package/carton                   |
| code         | varchar(100)   | Internal product code                   |
| shipping_mark| text           | Shipping marks/labels                   |
| quantity     | integer        | = total_roll (alias)                    |
| cbm          | numeric(8,4)   | Cubic meters for this row               |

**Totals calculation (backend `calcTotals()`):**
```js
total_quantity = SUM(total_roll)
total_weight   = SUM(total_ctn × kg_pkg)
total_value    = SUM(total_roll × unit_price)
total_cbm      = SUM(cbm)
```

**CBM auto-calc (frontend):** When a SKU is selected, CBM = `cbm_per_unit × total_ctn`. When `total_ctn` changes on a row that has a SKU selected, CBM recalculates automatically.

#### `payments`
| Column       | Type          | Notes                         |
|--------------|---------------|-------------------------------|
| id           | integer PK    |                               |
| reference    | varchar(100)  | UNIQUE, e.g. 'TT-2026-0025'  |
| order_id     | integer FK    | → import_orders.id            |
| supplier_id  | integer FK    | → suppliers.id                |
| amount       | numeric(15,2) |                               |
| currency     | varchar(10)   | default 'USD'                 |
| payment_date | date          |                               |
| payment_type | varchar(50)   | 'TT' / 'LC' / 'CAD' etc.    |
| notes        | text          |                               |

#### `documents`
| Column        | Type          | Notes                                  |
|---------------|---------------|----------------------------------------|
| id            | integer PK    |                                        |
| order_id      | integer FK    | → import_orders.id                     |
| doc_type      | varchar(100)  | 'Bill of Lading' / 'Invoice' / etc.   |
| filename      | varchar(255)  | Generated unique filename on disk      |
| original_name | varchar(255)  | User's original filename               |
| file_path     | text          | Disk path in ./uploads/                |
| file_size     | integer       | Bytes                                  |
| mime_type     | varchar(100)  |                                        |
| uploaded_by   | integer FK    | → users.id                            |

Files stored in: `icms-backend/uploads/` (created automatically). Max upload size: 20MB.
Path traversal protection: `safeFilePath()` validates resolved path starts within uploads dir.

#### `skus`
| Column         | Type           | Notes                               |
|----------------|----------------|-------------------------------------|
| id             | integer PK     |                                     |
| sku_code       | varchar(100)   | UNIQUE                              |
| description    | text           | Full product description            |
| hsn_code       | varchar(20)    | HSN/tariff code                     |
| category       | varchar(100)   |                                     |
| thickness      | varchar(50)    |                                     |
| size           | varchar(100)   |                                     |
| color          | varchar(50)    |                                     |
| liner_color    | varchar(50)    |                                     |
| roll_weight    | numeric(10,3)  | KG per roll → maps to kg_pkg       |
| item_code      | varchar(100)   | Internal code                       |
| shipping_marks | text           |                                     |
| weight_per_unit| numeric(10,4)  |                                     |
| cbm_per_unit   | numeric(10,6)  | CBM per carton — used for auto-calc |

#### `ports`
| Column    | Type         | Notes                         |
|-----------|--------------|-------------------------------|
| id        | integer PK   |                               |
| code      | varchar(20)  | UNIQUE, e.g. 'CNSHA'         |
| name      | varchar(255) | e.g. 'Shanghai'              |
| country   | varchar(100) |                               |
| port_type | varchar(50)  | 'origin' / 'destination' / 'both' |

#### `settings`
Key-value store. Key examples: `company_name`, `company_address`, `default_currency`.

---

## 6. API ROUTES

All routes except `/api/auth/login` and `/api/health` require `Authorization: Bearer <JWT>` header.

### Auth
| Method | Path            | Description                        |
|--------|-----------------|------------------------------------|
| POST   | /api/auth/login | Body: {email, password} → {token, user} |

### Orders
| Method | Path                              | Description                                      |
|--------|-----------------------------------|--------------------------------------------------|
| GET    | /api/orders                       | List all orders (filter: ?status=, ?search=)     |
| GET    | /api/orders/kanban                | Grouped by status for kanban view                |
| GET    | /api/orders/supplier-summary      | Supplier dashboard with weekly ETD counts         |
| GET    | /api/orders/next-po-number        | ?supplier_id= — auto-generate next PO number     |
| GET    | /api/orders/:id                   | Single order with items[]                        |
| POST   | /api/orders                       | Create order with items[]                        |
| PUT    | /api/orders/:id                   | Update order and items[]                         |
| PATCH  | /api/orders/:id/status            | Quick status update                              |
| POST   | /api/orders/:id/tracking          | Add tracking event {event, location, note}       |
| DELETE | /api/orders/:id                   | Delete order (cascades to order_items)           |

### Financial
| Method | Path                              | Description                        |
|--------|-----------------------------------|------------------------------------|
| GET    | /api/financial/payments           | List payments                      |
| POST   | /api/financial/payments           | Record payment                     |
| DELETE | /api/financial/payments/:id       | Delete (owner role only)           |
| GET    | /api/financial/ledger/:supplier_id| Supplier payment ledger            |
| GET    | /api/financial/summary            | Financial summary KPIs             |

### Masters
| Method | Path                   | Description              |
|--------|------------------------|--------------------------|
| GET    | /api/masters/suppliers | List suppliers           |
| POST   | /api/masters/suppliers | Create supplier          |
| PUT    | /api/masters/suppliers/:id | Update supplier      |
| DELETE | /api/masters/suppliers/:id | Delete supplier      |
| GET    | /api/masters/skus      | List SKUs                |
| POST   | /api/masters/skus      | Create SKU               |
| PUT    | /api/masters/skus/:id  | Update SKU               |
| DELETE | /api/masters/skus/:id  | Delete SKU               |
| GET    | /api/masters/ports     | List ports               |
| POST   | /api/masters/ports     | Create port              |
| PUT    | /api/masters/ports/:id | Update port              |
| DELETE | /api/masters/ports/:id | Delete port              |

### Documents
| Method | Path                        | Description                         |
|--------|-----------------------------|-------------------------------------|
| GET    | /api/documents              | List docs (?order_id= to filter)    |
| POST   | /api/documents/upload       | Multipart upload (field: 'file')    |
| GET    | /api/documents/:id/download | Stream file download                |
| DELETE | /api/documents/:id          | Delete record + file from disk      |

### Dashboard & Reports
| Method | Path                    | Description                    |
|--------|-------------------------|--------------------------------|
| GET    | /api/dashboard/stats    | Order counts, status breakdown |
| GET    | /api/dashboard/financial| Revenue KPIs, payment rates    |
| GET    | /api/dashboard/logistics| Container utilization, ETA     |
| GET    | /api/reports/variance   | SKU-level variance report      |
| GET    | /api/settings           | All settings                   |
| PUT    | /api/settings           | Update settings (owner only)   |

---

## 7. FRONTEND STRUCTURE

The entire frontend is in **one file**: `icms-frontend/src/ICMSPreview.jsx` (~2700 lines).

### Top-level structure
```
ICMSPreview.jsx
├── API client (apiFetch, apiUpload, apiDownload)
├── Toast notifications (ToastProvider, useToast)
├── Helper constants (STATUSES, STATUS_STYLE, fmtINR, fmtUSD, ...)
├── Shared components (Badge, KPICard, BarChart, Spinner, Err, ...)
├── TH, TD — module-level form table header/cell (MUST be module-level)
├── Sidebar, Header
├── Dashboard component
├── OrderForm modal — add/edit import orders with line items
├── ImportOrders (OrdersPage) — list / grouped-by-supplier / stats views
├── KanbanBoard — drag-free status columns
├── FinancialPage — payments, ledger
├── MastersPage — suppliers, SKUs, ports
├── DocumentsPage — file upload/download
├── ReportsPage — variance report
├── SettingsPage
└── Root ICMSPreview — login gate + sidebar routing
```

### CRITICAL: Keyboard focus bug prevention
`TH` and `TD` are defined at **module level** (not inside `OrderForm`). Any helper components defined INSIDE a React component get new function references on every render, causing React to unmount/remount inputs and lose focus after each keystroke.

In the items table rows, `CI` (cell input) is implemented as a plain function `ci()` called inside `items.map()` — NOT as a JSX component `<CI>`. This means React sees `<input>` elements directly and reconciles them without remounting.

### State management
No Redux/Zustand — all state is local `useState`. Data is re-fetched on tab change via `useCallback` + `useEffect`.

### Authentication flow
1. Login → POST /api/auth/login → JWT stored in `localStorage` as `icms_token`
2. All API calls include `Authorization: Bearer <token>` via `apiFetch()`
3. On 401 response, token is cleared and login screen shown

---

## 8. DEPENDENCIES

### Backend (`icms-backend/package.json`)
| Package    | Version | Purpose                              |
|------------|---------|--------------------------------------|
| express    | ^4.18.3 | HTTP server + routing                |
| pg         | ^8.11.5 | PostgreSQL client (node-postgres)    |
| bcryptjs   | ^2.4.3  | Password hashing                     |
| jsonwebtoken | ^9.0.2| JWT creation and verification        |
| multer     | ^1.4.5  | Multipart file upload handling       |
| cors       | ^2.8.5  | CORS middleware                      |
| dotenv     | ^16.4.5 | Load .env file into process.env      |
| nodemon    | ^3.1.0  | Dev: auto-restart on file change     |

### Frontend (`icms-frontend/package.json`)
| Package              | Version | Purpose                          |
|----------------------|---------|----------------------------------|
| react                | ^19.2.4 | UI library                       |
| react-dom            | ^19.2.4 | DOM rendering                    |
| vite                 | ^8.0.4  | Build tool + dev server          |
| @vitejs/plugin-react | ^6.0.1  | Vite plugin for React/JSX        |

No UI library (no MUI, Tailwind CSS framework, etc.) — all styling is inline React styles.
Tailwind CSS utility classes are used in some places via CDN (loaded in index.html).

### Install dependencies
```bash
# Backend
cd /home/luffy/icms/icms-backend && npm install

# Frontend — NOTE: do NOT reinstall @rolldown/binding-win32-x64-msvc
# It is a Windows-only package that breaks npm install on WSL/Linux
cd /home/luffy/icms/icms-frontend && npm install
```

---

## 9. KNOWN ISSUES & WORKAROUNDS

### PostgreSQL on port 5433 (not 5432)
The live PostgreSQL cluster runs on **port 5433**. The `.env` file reflects this. Never change it to 5432 unless PostgreSQL is reconfigured.

### Table ownership (postgres vs icms_user)
All tables are owned by the `postgres` superuser. `icms_user` has been granted ALL privileges, but cannot run `ALTER TABLE` on them. To add columns:
```bash
sudo -u postgres psql -p 5433 -d icms
# Then: ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ...;
# Then: GRANT ALL ON TABLE suppliers TO icms_user;
```

### shipped / delivered columns
`import_orders` does NOT have `shipped` or `delivered` columns in the database. They are derived from `status` in every SQL query:
```sql
(o.status NOT IN ('Draft','Tentative','Confirmed')) AS shipped,
(o.status = 'Delivered') AS delivered
```
Never add them as INSERT/UPDATE parameters.

### Windows-only npm package
`@rolldown/binding-win32-x64-msvc` has been removed from `package.json`. If it reappears (after merge/pull), remove it again — it blocks `npm install` on Linux/WSL.

### Vite env file not reloading
After editing `icms-frontend/.env`, Vite must be fully restarted (not hot-reloaded). Kill the Vite process and start it again.

### LATERAL fan-out in supplier-summary query
The `/api/orders/supplier-summary` query uses a LATERAL subquery for payment totals. The result `p_agg.paid` is referenced directly (not via `SUM()`) and is included in `GROUP BY` to prevent fan-out multiplication when suppliers have multiple orders.

### CBM auto-calculation requires SKU master data
CBM is only auto-calculated when a SKU is selected from the master AND the SKU has a non-zero `cbm_per_unit`. If entering orders manually without SKU selection, CBM must be typed manually per row.

---

## 10. GIT & DEPLOYMENT

### Repository
```
https://github.com/idris-insta/icms.git
Branch: main
```

### Push changes
```bash
cd /home/luffy/icms
git add .
git commit -m "description"
git push origin main
# GitHub requires Personal Access Token (PAT) — not password
# Generate at: github.com → Settings → Developer settings → Personal access tokens
```

### Running migrations after schema changes
```bash
cd /home/luffy/icms/icms-backend
node migrate.js
```
The migration is idempotent — safe to run multiple times. It uses `ADD COLUMN IF NOT EXISTS` and `ON CONFLICT DO NOTHING`.

---

## 11. ROLES & ACCESS CONTROL

| Role   | Capabilities                                                   |
|--------|----------------------------------------------------------------|
| owner  | Full access — can delete payments, change settings, all routes |
| staff  | Create/edit orders, payments, documents                        |
| viewer | Read-only (not fully enforced on all routes yet)               |

Role is set in the `users` table. JWT payload includes `{ id, email, name, role }`.

---

## 12. QUICK REFERENCE

```bash
# Check all services
curl -s http://localhost:6001/api/health
curl -s -o /dev/null -w "Frontend: %{http_code}\n" http://localhost:5173

# DB connect
PGPASSWORD=icms123 psql -U icms_user -h localhost -p 5433 -d icms

# Generate bcrypt hash for a password
node -e "require('bcryptjs').hash('mypassword',10).then(h=>console.log(h))"

# Reset owner password to 'owner123'
PGPASSWORD=icms123 psql -U icms_user -h localhost -p 5433 -d icms \
  -c "UPDATE users SET password_hash='\$2a\$10\$XzF35ejfoiwlcon5Eis7eurh/2ue121YvvBougo9X8X7ByNdDVP2e' WHERE email='owner@icms.com';"

# Run migrations
cd /home/luffy/icms/icms-backend && node migrate.js

# View backend logs
tail -f /tmp/icms-backend.log

# View frontend logs
tail -f /tmp/icms-frontend.log
```

---

## 13. BUSINESS LOGIC DETAILS

### Landed Cost Calculator (per order)
```
Landed Cost = Goods Value + Freight (USD) + Insurance (USD) + Duty
Duty = Goods Value × (duty_rate / 100)
Per Roll = Landed Cost / Total Rolls
Per KG   = Landed Cost / Total KG
```

### CP ₹ (Cost Price in Rupees) per supplier
```
CP ₹ = ((avg_value_usd × ex_rate × (1 + duty_percent/100)) + expense_inr) / avg_value_usd
```
This gives the landed cost in INR per USD of goods value. Displayed in the Supplier Stats view.

### Payment Due Date Auto-Calculation
When `shipment_date` is set and `payment_due_date` is not explicitly provided:
```
payment_due_date = shipment_date + supplier.payment_terms_days
```

### Demurrage Calculation (shown in order form)
```
Days used = (container_returned_date - eta) in days
Over days = max(0, days_used - free_days)
Demurrage = over_days × demurrage_rate (USD/day)
```

### PO Number Auto-Generation
Format: `{SUPPLIER_CODE} {NNN}{YY}` where:
- `NNN` = 3-digit sequence (001, 002, ...)
- `YY` = 2-digit year (26 for 2026)
- Generated by finding the highest existing sequence for that supplier

### Supplier Weekly ETD Tracking
The supplier summary counts orders with ETD falling in each week of the current month:
- W1: 1st–7th
- W2: 8th–14th
- W3: 15th–21st
- W4: 22nd–end of month
