-- ─── ICMS PostgreSQL Schema — Complete / Authoritative ─────────────────────────
-- Fresh setup:  psql -U postgres -c "CREATE DATABASE icms;" && psql -U postgres -d icms -f schema.sql
-- Existing DB:  just run migrate.js (it is fully idempotent)

-- ─── TABLES ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  role          VARCHAR(50)  DEFAULT 'staff',
  is_active     BOOLEAN      DEFAULT true,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id                  SERIAL PRIMARY KEY,
  code                VARCHAR(50)  UNIQUE NOT NULL,
  name                VARCHAR(255) NOT NULL,
  country             VARCHAR(100),
  base_currency       VARCHAR(10)  DEFAULT 'USD',
  contact_email       VARCHAR(255),
  contact_phone       VARCHAR(50),
  payment_terms_days  INTEGER      DEFAULT 30,
  is_active           BOOLEAN      DEFAULT true,
  port                VARCHAR(100),
  avg_value_usd       DECIMAL(12,2) DEFAULT 0,
  ex_rate             DECIMAL(10,4) DEFAULT 84,
  duty_percent        DECIMAL(5,2)  DEFAULT 10,
  expense_inr         DECIMAL(12,2) DEFAULT 0,
  target_per_month    DECIMAL(10,2) DEFAULT 1,
  created_at          TIMESTAMPTZ  DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS skus (
  id              SERIAL PRIMARY KEY,
  sku_code        VARCHAR(100) UNIQUE NOT NULL,
  description     TEXT,
  hsn_code        VARCHAR(20),
  category        VARCHAR(100),
  thickness       VARCHAR(50),
  size            VARCHAR(100),
  color           VARCHAR(50),
  liner_color     VARCHAR(50),
  roll_weight     DECIMAL(10,3),
  item_code       VARCHAR(100),
  shipping_marks  TEXT,
  weight_per_unit DECIMAL(10,4) DEFAULT 0,
  cbm_per_unit    DECIMAL(10,6) DEFAULT 0,
  is_active       BOOLEAN       DEFAULT true,
  created_at      TIMESTAMPTZ   DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ports (
  id        SERIAL PRIMARY KEY,
  code      VARCHAR(20)  UNIQUE NOT NULL,
  name      VARCHAR(255) NOT NULL,
  country   VARCHAR(100),
  port_type VARCHAR(50)  DEFAULT 'both'
);

CREATE TABLE IF NOT EXISTS import_orders (
  id                      SERIAL PRIMARY KEY,
  po_number               VARCHAR(50)    UNIQUE NOT NULL,
  supplier_id             INTEGER        REFERENCES suppliers(id),
  container_type          VARCHAR(20),
  currency                VARCHAR(10)    DEFAULT 'USD',
  status                  VARCHAR(50)    DEFAULT 'Draft',
  priority                VARCHAR(20)    DEFAULT 'normal',
  marking                 TEXT,
  total_quantity          INTEGER        DEFAULT 0,
  total_weight            DECIMAL(12,2)  DEFAULT 0,
  total_cbm               DECIMAL(10,2)  DEFAULT 0,
  total_value             DECIMAL(15,2)  DEFAULT 0,
  utilization_percentage  DECIMAL(5,2)   DEFAULT 0,
  eta                     DATE,
  etd                     DATE,
  shipment_date           DATE,
  bl_number               VARCHAR(100),
  payment_due_date        DATE,
  notes                   TEXT,
  tracking_updates        JSONB          DEFAULT '[]'::jsonb,
  freight_cost            DECIMAL(12,2)  DEFAULT 0,
  insurance_cost          DECIMAL(12,2)  DEFAULT 0,
  duty_rate               DECIMAL(5,2)   DEFAULT 0,
  free_days               INTEGER        DEFAULT 7,
  demurrage_rate          DECIMAL(10,2)  DEFAULT 0,
  container_returned_date DATE,
  doc_checklist           JSONB          DEFAULT '{}'::jsonb,
  shipped                 BOOLEAN        DEFAULT FALSE,
  delivered               BOOLEAN        DEFAULT FALSE,
  created_at              TIMESTAMPTZ    DEFAULT NOW(),
  updated_at              TIMESTAMPTZ    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id            SERIAL PRIMARY KEY,
  order_id      INTEGER        REFERENCES import_orders(id) ON DELETE CASCADE,
  sku_id        INTEGER        REFERENCES skus(id),
  item_name     VARCHAR(255)   DEFAULT '',
  thickness     VARCHAR(50)    DEFAULT '',
  size          VARCHAR(100)   DEFAULT '',
  liner_color   VARCHAR(50)    DEFAULT '',
  total_ctn     INTEGER        DEFAULT 0,
  total_roll    INTEGER        DEFAULT 0,
  unit_price    DECIMAL(12,4)  DEFAULT 0,
  weight        DECIMAL(10,2)  DEFAULT 0,
  kg_pkg        DECIMAL(10,4)  DEFAULT 0,
  code          VARCHAR(100)   DEFAULT '',
  shipping_mark TEXT           DEFAULT '',
  quantity      INTEGER        DEFAULT 0,
  cbm           DECIMAL(8,4)   DEFAULT 0,
  created_at    TIMESTAMPTZ    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id           SERIAL PRIMARY KEY,
  reference    VARCHAR(100) UNIQUE NOT NULL,
  order_id     INTEGER      REFERENCES import_orders(id),
  supplier_id  INTEGER      REFERENCES suppliers(id),
  amount       DECIMAL(15,2) NOT NULL,
  currency     VARCHAR(10)   DEFAULT 'USD',
  payment_date DATE,
  payment_type VARCHAR(50)   DEFAULT 'TT',
  notes        TEXT,
  created_at   TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
  id            SERIAL PRIMARY KEY,
  order_id      INTEGER      REFERENCES import_orders(id),
  doc_type      VARCHAR(100),
  filename      VARCHAR(255) NOT NULL,
  original_name VARCHAR(255),
  file_path     TEXT,
  file_size     INTEGER,
  mime_type     VARCHAR(100),
  uploaded_by   INTEGER      REFERENCES users(id),
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── INDEXES ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_status      ON import_orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_supplier    ON import_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_orders_eta         ON import_orders(eta);
CREATE INDEX IF NOT EXISTS idx_orders_priority    ON import_orders(priority);
CREATE INDEX IF NOT EXISTS idx_payments_order     ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_supplier  ON payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_documents_order    ON documents(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order  ON order_items(order_id);

-- ─── SEED DATA ────────────────────────────────────────────────────────────────

-- Default owner user (password: owner123)
INSERT INTO users (email, password_hash, name, role) VALUES
  ('owner@icms.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Owner', 'owner')
ON CONFLICT (email) DO NOTHING;

-- Suppliers
INSERT INTO suppliers (code, name, country, base_currency, contact_email, contact_phone, payment_terms_days) VALUES
  ('GPC-001', 'Guangzhou Plastics Co.', 'China',    'CNY', 'sales@gzplastics.cn',   '+86-20-88881234', 45),
  ('MPG-002', 'MechParts GmbH',         'Germany',  'EUR', 'orders@mechparts.de',   '+49-89-12345678', 30),
  ('STL-003', 'Shenzhen Tech Ltd.',      'China',    'USD', 'ops@shenzhentech.com',  '+86-755-9876543', 60),
  ('SAH-004', 'Seoul Apparel House',     'South Korea', 'USD', 'buy@seoulfashion.kr', '+82-2-5551234',  30),
  ('MTI-005', 'Mumbai Textiles India',   'India',    'INR', 'sales@mumtex.in',       '+91-22-6667890',  45),
  ('TJS-006', 'Tianjin Steel',           'China',    'CNY', 'export@tjs.com.cn',     '+86-22-3334567',  30)
ON CONFLICT (code) DO NOTHING;

-- SKUs
INSERT INTO skus (sku_code, description, hsn_code, category, thickness, size, color, liner_color, roll_weight, item_code, shipping_marks, weight_per_unit, cbm_per_unit) VALUES
  ('ADH-5520-CLR', '55 Mic Clear Adhesive Tape',    '39190090', 'Adhesive',  '55 MIC', '480MM X 100M', 'CLEAR',  'CLEAR',  4.2, 'ADH-001-480X100', 'CLEAR ADHESIVE TAPE ROLLS',    0.48, 0.001200),
  ('LIN-0080-WH',  '80 Mic White Liner Film',        '39201099', 'Liner',     '80 MIC', '1000MM X 500M','WHITE',  'WHITE',  6.8, 'LIN-002-1000X500','WHITE LINER FILM ROLLS',       0.62, 0.001800),
  ('PLY-2200-TR',  'Polyethylene Wrap 220cm',         '39201020', 'Packaging', '40 MIC', '2200MM',       'CLEAR',  'CLEAR',  11.0,'PLY-003-2200',    'PE WRAP ROLLS',                1.10, 0.003400),
  ('FLM-4490-BK',  '44 Mic Black Protective Film',   '39201099', 'Liner',     '44 MIC', '1200MM X 300M','BLACK',  'BLACK',  3.8, 'FLM-004-1200X300','BLACK PROTECTIVE FILM ROLLS',  0.38, 0.000900),
  ('BUB-1100-TR',  'Bubble Wrap Roll 110cm',          '39219090', 'Packaging', '80 MIC', '1100MM X 50M', 'CLEAR',  'CLEAR',  22.0,'BUB-005-1100X50', 'BUBBLE WRAP ROLLS',            2.20, 0.008000)
ON CONFLICT (sku_code) DO NOTHING;

-- Import Orders
INSERT INTO import_orders
  (po_number, supplier_id, container_type, currency, status, priority, marking,
   total_quantity, total_weight, total_cbm, total_value, utilization_percentage,
   eta, etd, shipment_date, bl_number, payment_due_date, notes,
   freight_cost, insurance_cost, duty_rate, free_days, demurrage_rate)
SELECT
  'PO-2026-001', s.id, '40FT', 'CNY', 'In Transit', 'urgent', 'GPC/APR26/001',
  2400, 18200, 62.4, 185000, 83.2,
  '2026-06-18', '2026-04-20', '2026-04-22', 'COSU1234567890', '2026-07-15',
  'Urgent restocking order - adhesive tape',
  2800, 370, 12.0, 7, 250
FROM suppliers s WHERE s.code = 'GPC-001'
ON CONFLICT (po_number) DO NOTHING;

INSERT INTO import_orders
  (po_number, supplier_id, container_type, currency, status, priority, marking,
   total_quantity, total_weight, total_cbm, total_value, utilization_percentage,
   eta, etd, shipment_date, bl_number, payment_due_date, notes,
   freight_cost, insurance_cost, duty_rate, free_days, demurrage_rate)
SELECT
  'PO-2026-002', s.id, '20FT', 'EUR', 'Customs Clearance', 'high', 'MPG/APR26/002',
  840, 9400, 21.8, 89000, 67.5,
  '2026-05-15', '2026-03-20', '2026-03-22', 'HLCU9876543210', '2026-06-20',
  'Machine parts for factory expansion',
  1800, 178, 8.5, 5, 180
FROM suppliers s WHERE s.code = 'MPG-002'
ON CONFLICT (po_number) DO NOTHING;

INSERT INTO import_orders
  (po_number, supplier_id, container_type, currency, status, priority, marking,
   total_quantity, total_weight, total_cbm, total_value, utilization_percentage,
   eta, etd, shipment_date, bl_number, payment_due_date, notes,
   freight_cost, insurance_cost, duty_rate, free_days, demurrage_rate)
SELECT
  'PO-2026-003', s.id, '40HC', 'USD', 'Confirmed', 'normal', 'STL/MAY26/003',
  1200, 6800, 44.2, 54200, 91.0,
  '2026-06-02', '2026-04-28', NULL, NULL, '2026-08-01',
  'Tech components batch order',
  3200, 108, 5.0, 7, 200
FROM suppliers s WHERE s.code = 'STL-003'
ON CONFLICT (po_number) DO NOTHING;

INSERT INTO import_orders
  (po_number, supplier_id, container_type, currency, status, priority, marking,
   total_quantity, total_weight, total_cbm, total_value, utilization_percentage,
   eta, etd, shipment_date, bl_number, payment_due_date, notes,
   freight_cost, insurance_cost, duty_rate, free_days, demurrage_rate)
SELECT
  'PO-2026-004', s.id, '40FT', 'CNY', 'Loaded', 'high', 'GPC/MAY26/004',
  3600, 28400, 78.1, 212000, 88.5,
  '2026-06-10', '2026-05-05', '2026-05-08', NULL, '2026-07-25',
  'Large liner film order for Q2',
  3500, 424, 12.0, 7, 250
FROM suppliers s WHERE s.code = 'GPC-001'
ON CONFLICT (po_number) DO NOTHING;

INSERT INTO import_orders
  (po_number, supplier_id, container_type, currency, status, priority, marking,
   total_quantity, total_weight, total_cbm, total_value, utilization_percentage,
   eta, etd, shipment_date, bl_number, payment_due_date, notes,
   freight_cost, insurance_cost, duty_rate, free_days, demurrage_rate)
SELECT
  'PO-2026-005', s.id, '20FT', 'USD', 'Delivered', 'normal', 'SAH/MAR26/005',
  4800, 7200, 26.9, 67500, 74.2,
  '2026-03-05', '2026-01-20', '2026-01-22', 'OOLU5432167890', '2026-04-05',
  'Apparel season order - completed',
  1400, 135, 15.0, 7, 150
FROM suppliers s WHERE s.code = 'SAH-004'
ON CONFLICT (po_number) DO NOTHING;

INSERT INTO import_orders
  (po_number, supplier_id, container_type, currency, status, priority, marking,
   total_quantity, total_weight, total_cbm, total_value, utilization_percentage,
   eta, etd, shipment_date, bl_number, payment_due_date, notes,
   freight_cost, insurance_cost, duty_rate, free_days, demurrage_rate)
SELECT
  'PO-2026-006', s.id, '40HC', 'USD', 'Shipped', 'normal', 'STL/MAY26/006',
  1800, 12400, 56.8, 88000, 79.3,
  '2026-06-20', '2026-05-10', '2026-05-12', 'MSCU7654321098', '2026-08-19',
  'Q2 tech shipment',
  3800, 176, 5.0, 7, 200
FROM suppliers s WHERE s.code = 'STL-003'
ON CONFLICT (po_number) DO NOTHING;

INSERT INTO import_orders
  (po_number, supplier_id, container_type, currency, status, priority, marking,
   total_quantity, total_weight, total_cbm, total_value, utilization_percentage,
   eta, etd, shipment_date, bl_number, payment_due_date, notes,
   freight_cost, insurance_cost, duty_rate, free_days, demurrage_rate)
SELECT
  'PO-2026-007', s.id, '20FT', 'USD', 'Shipped', 'low', 'SAH/MAY26/007',
  2400, 5800, 18.4, 55000, 71.2,
  '2026-06-22', '2026-05-14', '2026-05-16', 'EGLV2109876543', '2026-07-22',
  'Summer collection order',
  1600, 110, 15.0, 7, 150
FROM suppliers s WHERE s.code = 'SAH-004'
ON CONFLICT (po_number) DO NOTHING;

INSERT INTO import_orders
  (po_number, supplier_id, container_type, currency, status, priority, marking,
   total_quantity, total_weight, total_cbm, total_value, utilization_percentage,
   notes, freight_cost, insurance_cost, duty_rate, free_days, demurrage_rate)
SELECT
  'PO-2026-008', s.id, '20FT', 'INR', 'Draft', 'low', 'MTI/MAY26/008',
  600, 3200, 8.4, 32000, 43.2,
  'Draft order pending approval',
  900, 64, 18.0, 7, 100
FROM suppliers s WHERE s.code = 'MTI-005'
ON CONFLICT (po_number) DO NOTHING;

INSERT INTO import_orders
  (po_number, supplier_id, container_type, currency, status, priority, marking,
   total_quantity, total_weight, total_cbm, total_value, utilization_percentage,
   notes, freight_cost, insurance_cost, duty_rate, free_days, demurrage_rate)
SELECT
  'PO-2026-009', s.id, '40FT', 'CNY', 'Draft', 'normal', 'TJS/MAY26/009',
  4800, 22000, 64.2, 98000, 70.8,
  'Steel coil order for H2 stock',
  2600, 196, 10.0, 7, 220
FROM suppliers s WHERE s.code = 'TJS-006'
ON CONFLICT (po_number) DO NOTHING;

-- Payments
INSERT INTO payments (reference, order_id, supplier_id, amount, currency, payment_date, payment_type)
SELECT 'TT-2026-0021', o.id, s.id, 67500, 'USD', '2026-03-05', 'TT'
FROM import_orders o, suppliers s WHERE o.po_number = 'PO-2026-005' AND s.code = 'SAH-004'
ON CONFLICT (reference) DO NOTHING;

INSERT INTO payments (reference, order_id, supplier_id, amount, currency, payment_date, payment_type)
SELECT 'TT-2026-0018', o.id, s.id, 98000, 'CNY', '2026-02-20', 'TT'
FROM import_orders o, suppliers s WHERE o.po_number = 'PO-2026-001' AND s.code = 'GPC-001'
ON CONFLICT (reference) DO NOTHING;

INSERT INTO payments (reference, order_id, supplier_id, amount, currency, payment_date, payment_type)
SELECT 'TT-2026-0015', o.id, s.id, 45000, 'EUR', '2026-02-10', 'TT'
FROM import_orders o, suppliers s WHERE o.po_number = 'PO-2026-002' AND s.code = 'MPG-002'
ON CONFLICT (reference) DO NOTHING;

INSERT INTO payments (reference, order_id, supplier_id, amount, currency, payment_date, payment_type)
SELECT 'TT-2026-0012', o.id, s.id, 54200, 'USD', '2026-01-28', 'TT'
FROM import_orders o, suppliers s WHERE o.po_number = 'PO-2026-003' AND s.code = 'STL-003'
ON CONFLICT (reference) DO NOTHING;

INSERT INTO payments (reference, order_id, supplier_id, amount, currency, payment_date, payment_type)
SELECT 'TT-2026-0008', o.id, s.id, 150000, 'CNY', '2026-03-01', 'TT'
FROM import_orders o, suppliers s WHERE o.po_number = 'PO-2026-004' AND s.code = 'GPC-001'
ON CONFLICT (reference) DO NOTHING;

-- Default settings
INSERT INTO settings (key, value) VALUES
  ('company_name',       'ICMS Enterprise'),
  ('company_address',    '123 Trade Street, Mumbai'),
  ('company_phone',      '+91 22 1234 5678'),
  ('company_email',      'admin@icms.co'),
  ('pdf_header_text',    'PURCHASE ORDER'),
  ('pdf_footer_text',    'Thank you for your business'),
  ('show_duty_on_pdf',   'true'),
  ('default_currency',   'USD')
ON CONFLICT (key) DO NOTHING;
