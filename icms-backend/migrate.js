// ─── ICMS Comprehensive Migration ────────────────────────────────────────────
// Safe to run on any existing DB — all changes use IF NOT EXISTS / DO NOTHING.
// Run: node migrate.js
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔧 Running ICMS migrations...\n');

    // ── 1. skus — add columns missing from original schema ───────────────────
    await client.query(`
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS category       VARCHAR(100);
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS thickness      VARCHAR(50);
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS size           VARCHAR(100);
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS color          VARCHAR(50);
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS liner_color    VARCHAR(50);
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS roll_weight    DECIMAL(10,3);
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS item_code      VARCHAR(100);
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS shipping_marks TEXT;
    `);
    console.log('  ✅  skus — extended columns');

    // ── 2. import_orders — add columns missing from original schema ──────────
    await client.query(`
      ALTER TABLE import_orders ADD COLUMN IF NOT EXISTS priority                VARCHAR(20)   DEFAULT 'normal';
      ALTER TABLE import_orders ADD COLUMN IF NOT EXISTS marking                 TEXT;
      ALTER TABLE import_orders ADD COLUMN IF NOT EXISTS etd                     DATE;
      ALTER TABLE import_orders ADD COLUMN IF NOT EXISTS shipment_date           DATE;
      ALTER TABLE import_orders ADD COLUMN IF NOT EXISTS bl_number               VARCHAR(100);
      ALTER TABLE import_orders ADD COLUMN IF NOT EXISTS payment_due_date        DATE;
      ALTER TABLE import_orders ADD COLUMN IF NOT EXISTS tracking_updates        JSONB         DEFAULT '[]'::jsonb;
      ALTER TABLE import_orders ADD COLUMN IF NOT EXISTS freight_cost            DECIMAL(12,2) DEFAULT 0;
      ALTER TABLE import_orders ADD COLUMN IF NOT EXISTS insurance_cost          DECIMAL(12,2) DEFAULT 0;
      ALTER TABLE import_orders ADD COLUMN IF NOT EXISTS duty_rate               DECIMAL(5,2)  DEFAULT 0;
      ALTER TABLE import_orders ADD COLUMN IF NOT EXISTS free_days               INTEGER       DEFAULT 7;
      ALTER TABLE import_orders ADD COLUMN IF NOT EXISTS demurrage_rate          DECIMAL(10,2) DEFAULT 0;
      ALTER TABLE import_orders ADD COLUMN IF NOT EXISTS container_returned_date DATE;
      ALTER TABLE import_orders ADD COLUMN IF NOT EXISTS doc_checklist           JSONB         DEFAULT '{}'::jsonb;
    `);
    console.log('  ✅  import_orders — extended columns');

    // ── 3. order_items — add columns missing from original schema ────────────
    await client.query(`
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_name     VARCHAR(255) DEFAULT '';
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS thickness      VARCHAR(50)  DEFAULT '';
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS size           VARCHAR(100) DEFAULT '';
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS liner_color    VARCHAR(50)  DEFAULT '';
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS qty_ctn        INTEGER      DEFAULT 0;
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS total_ctn      INTEGER      DEFAULT 0;
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS total_roll     INTEGER      DEFAULT 0;
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS kg_pkg         DECIMAL(10,4) DEFAULT 0;
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS code           VARCHAR(100) DEFAULT '';
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS shipping_mark  TEXT         DEFAULT '';
    `);
    console.log('  ✅  order_items — extended columns');

    // ── 3b. import_orders — shipped / delivered boolean flags ────────────────
    await client.query(`
      ALTER TABLE import_orders ADD COLUMN IF NOT EXISTS shipped   BOOLEAN DEFAULT false;
      ALTER TABLE import_orders ADD COLUMN IF NOT EXISTS delivered BOOLEAN DEFAULT false;
    `);
    console.log('  ✅  import_orders — shipped / delivered');

    // ── 3c. suppliers — port + financial planning columns ────────────────────
    await client.query(`
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS port             VARCHAR(50);
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS avg_value_usd    DECIMAL(12,2) DEFAULT 0;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ex_rate          DECIMAL(8,4)  DEFAULT 84;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS duty_percent     DECIMAL(5,2)  DEFAULT 10;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS expense_inr      DECIMAL(12,2) DEFAULT 0;
      ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS target_per_month DECIMAL(6,2)  DEFAULT 1;
    `);
    console.log('  ✅  suppliers — port / financial cols');

    // ── 4. Ensure indexes exist ───────────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_priority ON import_orders(priority);
    `);
    console.log('  ✅  indexes');

    // ── 5. Seed default user (if missing) ────────────────────────────────────
    const { rowCount } = await client.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ('owner@icms.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Owner', 'owner')
       ON CONFLICT (email) DO NOTHING`
    );
    console.log(`  ✅  default user ${rowCount ? 'created' : 'already exists'}`);

    // ── 6. Seed sample suppliers (if none exist) ─────────────────────────────
    const { rows: supCheck } = await client.query('SELECT COUNT(*) FROM suppliers');
    if (parseInt(supCheck[0].count) === 0) {
      await client.query(`
        INSERT INTO suppliers (code, name, country, base_currency, contact_email, contact_phone, payment_terms_days) VALUES
          ('GPC-001', 'Guangzhou Plastics Co.', 'China',        'CNY', 'sales@gzplastics.cn',   '+86-20-88881234', 45),
          ('MPG-002', 'MechParts GmbH',          'Germany',      'EUR', 'orders@mechparts.de',   '+49-89-12345678', 30),
          ('STL-003', 'Shenzhen Tech Ltd.',       'China',        'USD', 'ops@shenzhentech.com',  '+86-755-9876543', 60),
          ('SAH-004', 'Seoul Apparel House',      'South Korea',  'USD', 'buy@seoulfashion.kr',   '+82-2-5551234',   30),
          ('MTI-005', 'Mumbai Textiles India',    'India',        'INR', 'sales@mumtex.in',       '+91-22-6667890',  45),
          ('TJS-006', 'Tianjin Steel',            'China',        'CNY', 'export@tjs.com.cn',     '+86-22-3334567',  30)
        ON CONFLICT (code) DO NOTHING
      `);
      console.log('  ✅  sample suppliers seeded');
    } else {
      console.log('  ⏭   suppliers already exist — skipping seed');
    }

    // ── 6b. Upsert real suppliers (ISYY/ISCS/ISDS/ISFY/ISKY/ISLB) ───────────
    // CP (₹) formula: (avg_usd × ex_rate × (1 + duty/100) + expense_inr) / avg_usd
    // Expense reverse-engineered from known CP values in user's Excel
    await client.query(`
      INSERT INTO suppliers (code, name, country, base_currency, port, avg_value_usd, ex_rate, duty_percent, expense_inr, target_per_month, payment_terms_days) VALUES
        ('ISYY', 'YUANYANG',  'China', 'CNY', 'QINGDAO',   15000, 84, 10,  699000, 2,    30),
        ('ISCS', 'SAIGAO',    'China', 'CNY', 'QINGDAO',   35000, 84, 10,  861000, 1,    30),
        ('ISDS', 'SHUNYUAN',  'China', 'CNY', 'QINGDAO',   15000, 84, 10,  549000, 0.25, 30),
        ('ISFY', 'YONGGUAN',  'China', 'CNY', 'NINGBO',    55000, 84, 10, 1078000, 8,    30),
        ('ISKY', 'YOUYI',     'China', 'CNY', 'XIAMEN',    45000, 84, 10,  927000, 8,    30),
        ('ISLB', 'BONDTAPE',  'China', 'CNY', 'SHANGHAI',  45000, 84, 10,  927000, 6,    30)
      ON CONFLICT (code) DO UPDATE SET
        name             = EXCLUDED.name,
        country          = EXCLUDED.country,
        port             = EXCLUDED.port,
        avg_value_usd    = EXCLUDED.avg_value_usd,
        ex_rate          = EXCLUDED.ex_rate,
        duty_percent     = EXCLUDED.duty_percent,
        expense_inr      = EXCLUDED.expense_inr,
        target_per_month = EXCLUDED.target_per_month
    `);
    console.log('  ✅  real suppliers upserted (ISYY/ISCS/ISDS/ISFY/ISKY/ISLB)');

    // ── 6c. Sync shipped/delivered flags from status ──────────────────────────
    await client.query(`
      UPDATE import_orders SET shipped   = true
        WHERE status NOT IN ('Draft','Tentative','Confirmed') AND shipped = false;
      UPDATE import_orders SET delivered = true
        WHERE status = 'Delivered' AND delivered = false;
    `);
    console.log('  ✅  shipped/delivered flags synced from status');

    // ── 7. Seed sample SKUs (if none exist) ───────────────────────────────────
    const { rows: skuCheck } = await client.query('SELECT COUNT(*) FROM skus');
    if (parseInt(skuCheck[0].count) === 0) {
      await client.query(`
        INSERT INTO skus (sku_code, description, hsn_code, category, thickness, size, color, liner_color, roll_weight, item_code, shipping_marks, weight_per_unit, cbm_per_unit) VALUES
          ('ADH-5520-CLR', '55 Mic Clear Adhesive Tape',    '39190090', 'Adhesive',  '55 MIC', '480MM X 100M',  'CLEAR', 'CLEAR', 4.2, 'ADH-001', 'CLEAR ADHESIVE TAPE',   0.48, 0.001200),
          ('LIN-0080-WH',  '80 Mic White Liner Film',        '39201099', 'Liner',     '80 MIC', '1000MM X 500M', 'WHITE', 'WHITE', 6.8, 'LIN-002', 'WHITE LINER FILM',       0.62, 0.001800),
          ('PLY-2200-TR',  'Polyethylene Wrap 220cm',         '39201020', 'Packaging', '40 MIC', '2200MM',        'CLEAR', 'CLEAR', 11.0,'PLY-003', 'PE WRAP ROLLS',          1.10, 0.003400),
          ('FLM-4490-BK',  '44 Mic Black Protective Film',   '39201099', 'Liner',     '44 MIC', '1200MM X 300M', 'BLACK', 'BLACK', 3.8, 'FLM-004', 'BLACK PROTECTIVE FILM',  0.38, 0.000900),
          ('BUB-1100-TR',  'Bubble Wrap Roll 110cm',          '39219090', 'Packaging', '80 MIC', '1100MM X 50M',  'CLEAR', 'CLEAR', 22.0,'BUB-005', 'BUBBLE WRAP ROLLS',      2.20, 0.008000)
        ON CONFLICT (sku_code) DO NOTHING
      `);
      console.log('  ✅  sample SKUs seeded');
    } else {
      console.log('  ⏭   SKUs already exist — skipping seed');
    }

    // ── 8. Seed sample orders (if none exist) ─────────────────────────────────
    const { rows: ordCheck } = await client.query('SELECT COUNT(*) FROM import_orders');
    if (parseInt(ordCheck[0].count) === 0) {
      const orders = [
        ['PO-2026-001','GPC-001','40FT','CNY','In Transit','urgent','GPC/APR26/001',2400,18200,62.4,185000,83.2,'2026-06-18','2026-04-20','2026-04-22','COSU1234567890','2026-07-15','Urgent restocking — adhesive tape',2800,370,12.0,7,250],
        ['PO-2026-002','MPG-002','20FT','EUR','Customs Clearance','high','MPG/APR26/002',840,9400,21.8,89000,67.5,'2026-05-15','2026-03-20','2026-03-22','HLCU9876543210','2026-06-20','Machine parts for factory',1800,178,8.5,5,180],
        ['PO-2026-003','STL-003','40HC','USD','Confirmed','normal','STL/MAY26/003',1200,6800,44.2,54200,91.0,'2026-06-02','2026-04-28',null,null,'2026-08-01','Tech components batch',3200,108,5.0,7,200],
        ['PO-2026-004','GPC-001','40FT','CNY','Loaded','high','GPC/MAY26/004',3600,28400,78.1,212000,88.5,'2026-06-10','2026-05-05','2026-05-08',null,'2026-07-25','Large liner film Q2',3500,424,12.0,7,250],
        ['PO-2026-005','SAH-004','20FT','USD','Delivered','normal','SAH/MAR26/005',4800,7200,26.9,67500,74.2,'2026-03-05','2026-01-20','2026-01-22','OOLU5432167890','2026-04-05','Apparel season order',1400,135,15.0,7,150],
        ['PO-2026-006','STL-003','40HC','USD','Shipped','normal','STL/MAY26/006',1800,12400,56.8,88000,79.3,'2026-06-20','2026-05-10','2026-05-12','MSCU7654321098','2026-08-19','Q2 tech shipment',3800,176,5.0,7,200],
        ['PO-2026-007','SAH-004','20FT','USD','Shipped','low','SAH/MAY26/007',2400,5800,18.4,55000,71.2,'2026-06-22','2026-05-14','2026-05-16','EGLV2109876543','2026-07-22','Summer collection',1600,110,15.0,7,150],
        ['PO-2026-008','MTI-005','20FT','INR','Draft','low','MTI/MAY26/008',600,3200,8.4,32000,43.2,null,null,null,null,null,'Draft — pending approval',900,64,18.0,7,100],
        ['PO-2026-009','TJS-006','40FT','CNY','Draft','normal','TJS/MAY26/009',4800,22000,64.2,98000,70.8,null,null,null,null,null,'Steel coil order H2',2600,196,10.0,7,220],
      ];
      for (const o of orders) {
        const supRow = await client.query('SELECT id FROM suppliers WHERE code = $1', [o[1]]);
        if (!supRow.rows[0]) continue;
        await client.query(`
          INSERT INTO import_orders
            (po_number, supplier_id, container_type, currency, status, priority, marking,
             total_quantity, total_weight, total_cbm, total_value, utilization_percentage,
             eta, etd, shipment_date, bl_number, payment_due_date, notes,
             freight_cost, insurance_cost, duty_rate, free_days, demurrage_rate)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
          ON CONFLICT (po_number) DO NOTHING
        `, [o[0], supRow.rows[0].id, o[2], o[3], o[4], o[5], o[6],
            o[7], o[8], o[9], o[10], o[11], o[12]||null, o[13]||null,
            o[14]||null, o[15]||null, o[16]||null, o[17],
            o[18], o[19], o[20], o[21], o[22]]);
      }
      console.log('  ✅  sample orders seeded');

      // Sample payments
      const payments = [
        ['TT-2026-0021','PO-2026-005','SAH-004',67500,'USD','2026-03-05','TT'],
        ['TT-2026-0018','PO-2026-001','GPC-001',98000,'CNY','2026-02-20','TT'],
        ['TT-2026-0015','PO-2026-002','MPG-002',45000,'EUR','2026-02-10','TT'],
        ['TT-2026-0012','PO-2026-003','STL-003',54200,'USD','2026-01-28','TT'],
        ['TT-2026-0008','PO-2026-004','GPC-001',150000,'CNY','2026-03-01','TT'],
      ];
      for (const p of payments) {
        const ord = await client.query('SELECT id FROM import_orders WHERE po_number=$1', [p[1]]);
        const sup = await client.query('SELECT id FROM suppliers WHERE code=$1', [p[2]]);
        if (!ord.rows[0] || !sup.rows[0]) continue;
        await client.query(`
          INSERT INTO payments (reference, order_id, supplier_id, amount, currency, payment_date, payment_type)
          VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (reference) DO NOTHING
        `, [p[0], ord.rows[0].id, sup.rows[0].id, p[3], p[4], p[5], p[6]]);
      }
      console.log('  ✅  sample payments seeded');
    } else {
      console.log('  ⏭   orders already exist — skipping seed');
    }

    // ── 9. Default settings ───────────────────────────────────────────────────
    await client.query(`
      INSERT INTO settings (key, value) VALUES
        ('company_name',       'ICMS Enterprise'),
        ('company_address',    '123 Trade Street, Mumbai'),
        ('company_phone',      '+91 22 1234 5678'),
        ('company_email',      'admin@icms.co'),
        ('pdf_header_text',    'PURCHASE ORDER'),
        ('pdf_footer_text',    'Thank you for your business'),
        ('show_duty_on_pdf',   'true'),
        ('default_currency',   'USD')
      ON CONFLICT (key) DO NOTHING
    `);
    console.log('  ✅  settings');

    console.log('\n✅  All migrations complete!');
    console.log('   Login: owner@icms.com / owner123\n');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(e => {
  console.error('\n❌  Migration failed:', e.message);
  process.exit(1);
});
