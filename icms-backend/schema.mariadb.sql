-- ─── ICMS MariaDB Schema — Complete / Authoritative ──────────────────────────
-- Mirrors the live PostgreSQL schema, including every column added by migrate.js.
--   mariadb -u root -p icms < schema.mariadb.sql
-- Idempotent: safe to re-run.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  role          VARCHAR(50)  DEFAULT 'staff',
  is_active     BOOLEAN      DEFAULT TRUE,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS suppliers (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  code               VARCHAR(50)  NOT NULL UNIQUE,
  name               VARCHAR(255) NOT NULL,
  country            VARCHAR(100),
  base_currency      VARCHAR(10)  DEFAULT 'USD',
  contact_email      VARCHAR(255),
  contact_phone      VARCHAR(50),
  payment_terms_days INT          DEFAULT 30,
  is_active          BOOLEAN      DEFAULT TRUE,
  port               VARCHAR(100) DEFAULT '',
  city               VARCHAR(100),
  avg_value_usd      DECIMAL(12,2) DEFAULT 0,
  ex_rate            DECIMAL(10,4) DEFAULT 84,
  duty_percent       DECIMAL(5,2)  DEFAULT 10,
  expense_inr        DECIMAL(12,2) DEFAULT 0,
  target_per_month   INT           DEFAULT 1,
  created_at         TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS skus (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  sku_code         VARCHAR(100) NOT NULL UNIQUE,
  description      TEXT,
  hsn_code         VARCHAR(20),
  category         VARCHAR(100),
  thickness        VARCHAR(50),
  size             VARCHAR(100),
  color            VARCHAR(50),
  liner_color      VARCHAR(50),
  roll_weight      DECIMAL(10,3),
  item_code        VARCHAR(100),
  shipping_marks   TEXT,
  weight_per_unit  DECIMAL(10,4) DEFAULT 0,
  cbm_per_unit     DECIMAL(10,6) DEFAULT 0,
  is_active        BOOLEAN       DEFAULT TRUE,
  brand            VARCHAR(100),
  uom              VARCHAR(20),
  qty_per_pkg      INT,
  adhesive_type    VARCHAR(50),
  backing_material VARCHAR(50),
  width_mm         DECIMAL(10,2),
  length_mtr       DECIMAL(10,2),
  density          VARCHAR(50),
  created_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ports (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  code      VARCHAR(20)  NOT NULL UNIQUE,
  name      VARCHAR(255) NOT NULL,
  country   VARCHAR(100),
  port_type VARCHAR(50)  DEFAULT 'both'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_schedules (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id      INT NOT NULL,
  sku_id           INT,
  item_name        VARCHAR(255),
  container_type   VARCHAR(20) DEFAULT '40HC',
  currency         VARCHAR(10) DEFAULT 'USD',
  qty_per_shipment INT         DEFAULT 1,
  frequency        VARCHAR(20) DEFAULT 'weekly',
  interval_days    INT         DEFAULT 7,
  total_shipments  INT         DEFAULT 1,
  generated_count  INT         DEFAULT 0,
  start_date       DATE,
  status           VARCHAR(20) DEFAULT 'active',
  notes            TEXT,
  created_at       TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sched_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_sched_sku      FOREIGN KEY (sku_id)      REFERENCES skus(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS import_orders (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  po_number               VARCHAR(50) NOT NULL UNIQUE,
  supplier_id             INT,
  container_type          VARCHAR(20),
  currency                VARCHAR(10)   DEFAULT 'USD',
  status                  VARCHAR(50)   DEFAULT 'Draft',
  priority                VARCHAR(20)   DEFAULT 'normal',
  marking                 TEXT,
  total_quantity          INT           DEFAULT 0,
  total_weight            DECIMAL(12,2) DEFAULT 0,
  total_cbm               DECIMAL(10,2) DEFAULT 0,
  total_value             DECIMAL(15,2) DEFAULT 0,
  utilization_percentage  DECIMAL(5,2)  DEFAULT 0,
  eta                     DATE,
  etd                     DATE,
  shipment_date           DATE,
  bl_number               VARCHAR(100),
  payment_due_date        DATE,
  notes                   TEXT,
  tracking_updates        LONGTEXT CHECK (tracking_updates IS NULL OR JSON_VALID(tracking_updates)),
  freight_cost            DECIMAL(12,2) DEFAULT 0,
  insurance_cost          DECIMAL(12,2) DEFAULT 0,
  duty_rate               DECIMAL(5,2)  DEFAULT 0,
  free_days               INT           DEFAULT 7,
  demurrage_rate          DECIMAL(10,2) DEFAULT 0,
  container_returned_date DATE,
  doc_checklist           LONGTEXT CHECK (doc_checklist IS NULL OR JSON_VALID(doc_checklist)),
  schedule_id             INT,
  batch_id                VARCHAR(40),
  cha_charges             DECIMAL(12,2) DEFAULT 0,
  extra_charges           DECIMAL(12,2) DEFAULT 0,
  usd_rate                DECIMAL(10,4),
  loading_date            DATE,
  delivered_date          DATE,
  usd_rate_delivery       DECIMAL(10,4),
  status_changed_at       TIMESTAMP(6)  NULL DEFAULT CURRENT_TIMESTAMP(6),
  created_at              TIMESTAMP(6)  NULL DEFAULT CURRENT_TIMESTAMP(6),
  -- Microsecond precision, and no ON UPDATE clause. updated_at doubles as the
  -- row version for the optimistic-concurrency check in PUT /api/orders/:id;
  -- at whole-second resolution two edits in the same second would compare equal
  -- and one would be silently lost. PostgreSQL's TIMESTAMPTZ had microseconds,
  -- so this preserves the behaviour the application was written against.
  updated_at              TIMESTAMP(6)  NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_order_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_order_schedule FOREIGN KEY (schedule_id) REFERENCES order_schedules(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_items (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  order_id      INT,
  sku_id        INT,
  item_name     VARCHAR(255)  DEFAULT '',
  thickness     VARCHAR(50)   DEFAULT '',
  size          VARCHAR(100)  DEFAULT '',
  liner_color   VARCHAR(50)   DEFAULT '',
  qty_ctn       INT           DEFAULT 0,
  total_ctn     INT           DEFAULT 0,
  total_roll    INT           DEFAULT 0,
  unit_price    DECIMAL(12,4) DEFAULT 0,
  weight        DECIMAL(10,2) DEFAULT 0,
  kg_pkg        DECIMAL(10,4) DEFAULT 0,
  code          VARCHAR(100)  DEFAULT '',
  shipping_mark TEXT,
  quantity      INT           DEFAULT 0,
  cbm           DECIMAL(8,4)  DEFAULT 0,
  marking       VARCHAR(100)  DEFAULT '',
  price_per_sqm DECIMAL(12,4) DEFAULT 0,
  brand         VARCHAR(100)  DEFAULT '',
  notes         TEXT,
  created_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_item_order FOREIGN KEY (order_id) REFERENCES import_orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_item_sku   FOREIGN KEY (sku_id)   REFERENCES skus(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payments (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  reference    VARCHAR(100)  NOT NULL UNIQUE,
  order_id     INT,
  supplier_id  INT,
  amount       DECIMAL(15,2) NOT NULL,
  currency     VARCHAR(10)   DEFAULT 'USD',
  payment_date DATE,
  payment_type VARCHAR(50)   DEFAULT 'TT',
  usd_rate     DECIMAL(10,4),
  notes        TEXT,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pay_order    FOREIGN KEY (order_id)    REFERENCES import_orders(id),
  CONSTRAINT fk_pay_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS documents (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  order_id      INT,
  doc_type      VARCHAR(100),
  filename      VARCHAR(255) NOT NULL,
  original_name VARCHAR(255),
  file_path     TEXT,
  file_size     INT,
  mime_type     VARCHAR(100),
  uploaded_by   INT,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_doc_order FOREIGN KEY (order_id)    REFERENCES import_orders(id),
  CONSTRAINT fk_doc_user  FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  `key`      VARCHAR(100) PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;

-- ─── INDEXES ─────────────────────────────────────────────────────────────────
-- MariaDB has no CREATE INDEX IF NOT EXISTS before 10.6; ignore duplicate errors.
CREATE INDEX idx_orders_status     ON import_orders(status);
CREATE INDEX idx_orders_supplier   ON import_orders(supplier_id);
CREATE INDEX idx_orders_eta        ON import_orders(eta);
CREATE INDEX idx_orders_etd        ON import_orders(etd);
CREATE INDEX idx_orders_priority   ON import_orders(priority);
CREATE INDEX idx_orders_batch      ON import_orders(batch_id);
CREATE INDEX idx_payments_order    ON payments(order_id);
CREATE INDEX idx_payments_supplier ON payments(supplier_id);
CREATE INDEX idx_documents_order   ON documents(order_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_items_name        ON order_items(item_name);

-- ─── UPGRADES ────────────────────────────────────────────────────────────────
-- Applied to installations created before these columns gained sub-second
-- precision. Re-running is harmless.
ALTER TABLE import_orders
  MODIFY updated_at        TIMESTAMP(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  MODIFY created_at        TIMESTAMP(6) NULL DEFAULT CURRENT_TIMESTAMP(6),
  MODIFY status_changed_at TIMESTAMP(6) NULL DEFAULT CURRENT_TIMESTAMP(6);

-- ─── SEED ────────────────────────────────────────────────────────────────────
-- Default owner (password: owner123 — change it immediately after install).
INSERT IGNORE INTO users (email, password_hash, name, role) VALUES
  ('owner@icms.com', '$2a$10$kkD4aMrmMaQEOcGbUHPSMeBdcYTIlnWZBZMXRnPLgBKUUKRX9NQmm', 'Owner', 'owner');

INSERT IGNORE INTO settings (`key`, value) VALUES
  ('company_name',     'ICMS Enterprise'),
  ('company_address',  '123 Trade Street, Mumbai'),
  ('company_phone',    '+91 22 1234 5678'),
  ('company_email',    'admin@icms.co'),
  ('pdf_header_text',  'PURCHASE ORDER'),
  ('pdf_footer_text',  'Thank you for your business'),
  ('show_duty_on_pdf', 'true'),
  ('default_currency', 'USD');
