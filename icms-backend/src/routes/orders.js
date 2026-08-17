const router    = require('express').Router();
const multer    = require('multer');
const XLSX      = require('xlsx');
const db        = require('../db');
const protect   = require('../middleware/auth');
const authorize = require('../middleware/authorize');

const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const ORDER_SELECT = `
  SELECT o.id, o.po_number, o.container_type, o.currency, o.status, o.priority,
         o.marking, o.total_quantity, o.total_weight, o.total_cbm, o.total_value,
         o.utilization_percentage, o.eta, o.etd, o.notes, o.created_at, o.updated_at,
         o.bl_number, o.shipment_date, o.payment_due_date, o.tracking_updates,
         COALESCE(o.freight_cost,0)    AS freight_cost,
         COALESCE(o.insurance_cost,0)  AS insurance_cost,
         COALESCE(o.duty_rate,0)       AS duty_rate,
         COALESCE(o.free_days,7)       AS free_days,
         COALESCE(o.demurrage_rate,0)  AS demurrage_rate,
         o.container_returned_date,
         COALESCE(o.doc_checklist,'{}')::jsonb AS doc_checklist,
         o.loading_date, o.delivered_date, o.usd_rate_delivery, o.status_changed_at,
         COALESCE(o.cha_charges,0)     AS cha_charges,
         COALESCE(o.extra_charges,0)   AS extra_charges,
         COALESCE(o.usd_rate,0)        AS usd_rate,
         (o.status NOT IN ('Draft','Tentative','Confirmed')) AS shipped,
         (o.status IN ('Delivered','Paid'))                  AS delivered,
         s.id AS supplier_id, s.code AS supplier_code, s.name AS supplier, s.base_currency, s.payment_terms_days
  FROM import_orders o
  JOIN suppliers s ON o.supplier_id = s.id
`;

// Upsert line items — deletes existing then re-inserts inside a transaction
async function saveItems(client, orderId, items) {
  await client.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
  for (const item of items) {
    const total_kg = (parseFloat(item.total_ctn) || 0) * (parseFloat(item.kg_pkg) || 0);
    await client.query(`
      INSERT INTO order_items
        (order_id, item_name, thickness, size, liner_color,
         qty_ctn, total_ctn, total_roll,
         unit_price, weight, kg_pkg, code, shipping_mark, quantity, cbm, marking,
         price_per_sqm, brand, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    `, [
      orderId,
      item.item_name     || '',
      item.thickness     || '',
      item.size          || '',
      item.liner_color   || '',
      parseInt(item.qty_ctn)      || 0,
      parseInt(item.total_ctn)    || 0,
      parseInt(item.total_roll)   || 0,
      parseFloat(item.unit_price) || 0,
      total_kg,
      parseFloat(item.kg_pkg)     || 0,
      item.code          || '',
      item.shipping_mark || '',
      parseInt(item.total_roll)   || 0,
      parseFloat(item.cbm)        || 0,
      item.marking       || '',
      parseFloat(item.price_per_sqm) || 0,
      item.brand         || '',
      item.notes         || '',
    ]);
  }
}

// Recalculate order totals from items
function calcTotals(items) {
  return {
    total_quantity: items.reduce((s, i) => s + (parseInt(i.total_roll)  || 0), 0),
    total_weight:   items.reduce((s, i) => s + (parseInt(i.total_ctn)   || 0) * (parseFloat(i.kg_pkg)     || 0), 0),
    total_value:    items.reduce((s, i) => s + (parseInt(i.total_roll)  || 0) * (parseFloat(i.unit_price) || 0), 0),
    total_cbm:      items.reduce((s, i) => s + (parseFloat(i.cbm)       || 0), 0),
  };
}

// GET /api/orders — supports ?status=, ?search=, ?page=, ?limit=
router.get('/', protect, async (req, res) => {
  const { status, search } = req.query;
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  try {
    let where = [], params = [];
    if (status && status !== 'All') { params.push(status); where.push(`o.status = $${params.length}`); }
    if (search) { params.push(`%${search}%`); where.push(`(o.po_number ILIKE $${params.length} OR s.name ILIKE $${params.length})`); }
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const countParams = [...params];
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) AS count FROM import_orders o JOIN suppliers s ON o.supplier_id = s.id ${clause}`,
      countParams
    );
    const total = parseInt(countRows[0].count);

    params.push(limit, offset);
    const { rows } = await db.query(
      `${ORDER_SELECT} ${clause} ORDER BY o.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ orders: rows, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[orders/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/kanban
router.get('/kanban', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT o.id, o.po_number, s.name AS supplier, o.container_type, o.total_value, o.status,
             o.loading_date, o.freight_cost, o.shipment_date, o.bl_number, o.insurance_cost,
             o.eta, o.etd, o.delivered_date, o.cha_charges, o.usd_rate_delivery,
             o.payment_due_date, COALESCE(o.free_days,7) AS free_days,
             COALESCE(o.demurrage_rate,0)::float AS demurrage_rate, o.status_changed_at,
             COALESCE(o.doc_checklist,'{}')::jsonb AS doc_checklist,
             (SELECT COUNT(*)::int FROM payments p WHERE p.order_id = o.id) AS payment_count
      FROM import_orders o JOIN suppliers s ON o.supplier_id = s.id ORDER BY o.created_at DESC
    `);
    const groups = {};
    rows.forEach(r => {
      if (!groups[r.status]) groups[r.status] = [];
      groups[r.status].push({
        id: r.id, po_number: r.po_number, supplier: r.supplier, container: r.container_type,
        value: parseFloat(r.total_value) || 0, status: r.status,
        loading_date: r.loading_date, freight_cost: parseFloat(r.freight_cost) || 0,
        shipment_date: r.shipment_date, bl_number: r.bl_number,
        insurance_cost: parseFloat(r.insurance_cost) || 0,
        eta: r.eta, etd: r.etd, delivered_date: r.delivered_date,
        cha_charges: parseFloat(r.cha_charges) || 0, usd_rate_delivery: r.usd_rate_delivery,
        payment_due_date: r.payment_due_date, free_days: r.free_days,
        demurrage_rate: r.demurrage_rate, status_changed_at: r.status_changed_at,
        doc_checklist: r.doc_checklist, payment_count: r.payment_count,
      });
    });
    res.json(groups);
  } catch (err) {
    console.error('[orders/kanban]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/forecast — containers expected to ship, bucketed by ETD.
router.get('/forecast', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT o.id, o.po_number, s.name AS supplier, o.container_type, o.etd,
             o.total_value::float AS value, o.status
      FROM import_orders o JOIN suppliers s ON o.supplier_id = s.id
      WHERE o.status IN ('Confirmed','Loaded') AND o.etd IS NOT NULL
      ORDER BY o.etd ASC
    `);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const eow = new Date(today); eow.setDate(today.getDate() + (7 - today.getDay()));
    const eom = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);
    const b = { overdue: [], this_week: [], this_month: [], later: [] };
    rows.forEach(r => {
      const d = new Date(r.etd);
      if (d < today) b.overdue.push(r);
      else if (d <= eow) b.this_week.push(r);
      else if (d <= eom) b.this_month.push(r);
      else b.later.push(r);
    });
    const sum = (a) => Math.round(a.reduce((s, x) => s + (x.value || 0), 0) * 100) / 100;
    res.json({
      counts: { overdue: b.overdue.length, this_week: b.this_week.length, this_month: b.this_month.length, later: b.later.length, total: rows.length },
      value: { overdue: sum(b.overdue), this_week: sum(b.this_week), this_month: sum(b.this_month) },
      buckets: b,
    });
  } catch (err) {
    console.error('[orders/forecast]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/supplier-summary  — MUST be before /:id to avoid route shadowing
router.get('/supplier-summary', protect, async (req, res) => {
  try {
    const now     = new Date();
    const yr      = now.getFullYear();
    const mo      = now.getMonth();
    const pad     = (d) => `${yr}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const lastDay = new Date(yr, mo + 1, 0).getDate();
    const w1s = pad(1),  w1e = pad(7);
    const w2s = pad(8),  w2e = pad(14);
    const w3s = pad(15), w3e = pad(21);
    const w4s = pad(22), w4e = pad(lastDay);
    const moStart = pad(1), moEnd = pad(lastDay);

    const { rows } = await db.query(`
      SELECT
        s.id, s.code, s.name, s.base_currency,
        COALESCE(s.port, '')                      AS port,
        COALESCE(s.avg_value_usd,  0)::float      AS avg_value_usd,
        COALESCE(s.ex_rate,       84)::float      AS ex_rate,
        COALESCE(s.duty_percent,  10)::float      AS duty_percent,
        COALESCE(s.expense_inr,    0)::float      AS expense_inr,
        COALESCE(s.target_per_month, 1)::float    AS target_per_month,
        COUNT(o.id)::int                          AS total_orders,
        COUNT(o.id) FILTER (WHERE o.status = 'Delivered')::int                                                                              AS delivered_count,
        COUNT(o.id) FILTER (WHERE o.status NOT IN ('Draft','Tentative','Confirmed'))::int                                                   AS shipped_count,
        COUNT(o.id) FILTER (WHERE o.status IN ('Draft','Tentative','Confirmed'))::int                                                       AS pending_count,
        COUNT(o.id) FILTER (WHERE o.status IN ('Loaded','Shipped','In Transit','Arrived','Customs Clearance','Cleared'))::int               AS otw_count,
        COUNT(o.id) FILTER (WHERE o.etd::date BETWEEN $1::date AND $2::date)::int  AS week1,
        COUNT(o.id) FILTER (WHERE o.etd::date BETWEEN $3::date AND $4::date)::int  AS week2,
        COUNT(o.id) FILTER (WHERE o.etd::date BETWEEN $5::date AND $6::date)::int  AS week3,
        COUNT(o.id) FILTER (WHERE o.etd::date BETWEEN $7::date AND $8::date)::int  AS week4,
        COUNT(o.id) FILTER (WHERE o.etd::date BETWEEN $9::date AND $10::date)::int AS month_total,
        COALESCE(SUM(o.total_value), 0)           AS total_value,
        p_agg.paid                                AS total_paid
      FROM suppliers s
      LEFT JOIN import_orders o ON o.supplier_id = s.id
      LEFT JOIN (
        SELECT supplier_id, COALESCE(SUM(amount), 0) AS paid FROM payments GROUP BY supplier_id
      ) p_agg ON p_agg.supplier_id = s.id
      GROUP BY s.id, s.code, s.name, s.base_currency,
               s.port, s.avg_value_usd, s.ex_rate, s.duty_percent, s.expense_inr, s.target_per_month,
               p_agg.paid
      ORDER BY s.code
    `, [w1s, w1e, w2s, w2e, w3s, w3e, w4s, w4e, moStart, moEnd]);

    const result = rows.map(r => {
      const avg  = parseFloat(r.avg_value_usd) || 0;
      const ex   = parseFloat(r.ex_rate)       || 84;
      const duty = parseFloat(r.duty_percent)  || 10;
      const exp  = parseFloat(r.expense_inr)   || 0;
      const cp_inr = avg > 0 ? ((avg * ex * (1 + duty / 100)) + exp) / avg : 0;
      const outstanding = parseFloat(r.total_value) - parseFloat(r.total_paid);
      return { ...r, cp_inr: Math.round(cp_inr * 100) / 100, outstanding };
    });

    res.json({ suppliers: result });
  } catch (err) {
    console.error('[orders/supplier-summary]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/next-po-number?supplier_id=5
router.get('/next-po-number', protect, async (req, res) => {
  const { supplier_id } = req.query;
  if (!supplier_id) return res.status(400).json({ error: 'supplier_id required' });
  try {
    const { rows: supRows } = await db.query('SELECT code FROM suppliers WHERE id = $1', [parseInt(supplier_id)]);
    if (!supRows[0]) return res.status(404).json({ error: 'Supplier not found' });
    const code = supRows[0].code;
    const yr   = String(new Date().getFullYear()).slice(-2);

    const { rows } = await db.query(`
      SELECT COALESCE(MAX(
        CASE WHEN po_number REGEXP '^.+ [0-9]{5}$'
        THEN CAST(LEFT(RIGHT(po_number, 5), 3) AS UNSIGNED)
        ELSE 0 END
      ), 0) AS max_seq
      FROM import_orders WHERE supplier_id = $1
    `, [parseInt(supplier_id)]);

    const maxSeq = parseInt(rows[0].max_seq) || 0;
    const seq    = String(maxSeq + 1).padStart(3, '0');
    res.json({ next_po: `${code} ${seq}${yr}`, supplier_code: code });
  } catch (err) {
    console.error('[orders/next-po-number]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Generate the next PO number for a supplier (shared by duplicate/bulk).
// Must be called inside a transaction: the supplier row is locked FOR UPDATE so
// two concurrent allocations for the same supplier cannot read the same MAX(seq)
// and mint duplicate PO numbers.
async function nextPoNumber(client, supplierId) {
  const { rows: supRows } = await client.query('SELECT code FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]);
  if (!supRows[0]) throw new Error('Supplier not found');
  const yr = String(new Date().getFullYear()).slice(-2);
  const { rows } = await client.query(`
    SELECT COALESCE(MAX(
      CASE WHEN po_number REGEXP '^.+ [0-9]{5}$'
      THEN CAST(LEFT(RIGHT(po_number, 5), 3) AS UNSIGNED)
      ELSE 0 END
    ), 0) AS max_seq
    FROM import_orders WHERE supplier_id = $1
  `, [supplierId]);
  const seq = String((parseInt(rows[0].max_seq) || 0) + 1).padStart(3, '0');
  return `${supRows[0].code} ${seq}${yr}`;
}

// Copy one order (+items) into a fresh Draft with a new PO number.
// Shipment-specific fields (BL, dates, tracking) are intentionally cleared.
async function copyOrder(client, sourceId, opts = {}) {
  const { rows: src } = await client.query('SELECT * FROM import_orders WHERE id = $1', [sourceId]);
  if (!src[0]) return null;
  const o = src[0];
  const newPo = await nextPoNumber(client, o.supplier_id);
  const { rows: created } = await client.query(`
    INSERT INTO import_orders
      (po_number, supplier_id, container_type, currency, status, marking,
       total_quantity, total_weight, total_cbm, total_value, utilization_percentage,
       notes, freight_cost, insurance_cost, duty_rate, free_days, demurrage_rate,
       doc_checklist, priority, etd, batch_id)
    VALUES ($1,$2,$3,$4,'Draft',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'{}',$17,$18,$19)
    RETURNING id, po_number, etd
  `, [newPo, o.supplier_id, o.container_type, o.currency, o.marking,
      o.total_quantity, o.total_weight, o.total_cbm, o.total_value, o.utilization_percentage,
      o.notes, o.freight_cost || 0, o.insurance_cost || 0, o.duty_rate || 0,
      o.free_days || 7, o.demurrage_rate || 0, o.priority || 'normal',
      opts.etd || null, opts.batch_id || null]);
  await client.query(`
    INSERT INTO order_items
      (order_id, sku_id, item_name, thickness, size, liner_color, qty_ctn, total_ctn,
       total_roll, unit_price, weight, kg_pkg, code, shipping_mark, quantity, cbm,
       marking, price_per_sqm, brand, notes)
    SELECT $1, sku_id, item_name, thickness, size, liner_color, qty_ctn, total_ctn,
           total_roll, unit_price, weight, kg_pkg, code, shipping_mark, quantity, cbm,
           marking, price_per_sqm, brand, notes
    FROM order_items WHERE order_id = $2
  `, [created[0].id, sourceId]);
  return created[0];
}

// POST /api/orders/:id/duplicate — copy an order as a new Draft (staff+)
router.post('/:id/duplicate', protect, authorize('owner', 'manager', 'staff'), async (req, res) => {
  try {
    const created = await db.tx(client => copyOrder(client, req.params.id));
    if (!created) return res.status(404).json({ error: 'Order not found' });
    const { rows } = await db.query(`${ORDER_SELECT} WHERE o.id = $1`, [created.id]);
    const { rows: items } = await db.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [created.id]);
    res.status(201).json({ ...rows[0], items });
  } catch (err) {
    console.error('[orders/duplicate]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/orders/bulk — bulk-create orders (staff+)
// Body: { source_order_id, count, interval_days, start_date }
//   count          → number of copies (max 52)
//   interval_days  → spacing between ETDs (e.g. 7 = ship 1 container weekly)
//   start_date     → ETD of the first copy
// Each copy gets the next PO number, a shared batch_id, and a staggered ETD.
router.post('/bulk', protect, authorize('owner', 'manager', 'staff'), async (req, res) => {
  const { source_order_id, count, interval_days, start_date } = req.body;
  const n  = Math.min(52, Math.max(1, parseInt(count) || 1));
  const iv = parseInt(interval_days) || 0;
  if (!source_order_id) return res.status(400).json({ error: 'source_order_id required' });
  const batch_id = 'B' + Date.now().toString(36).toUpperCase();
  const base = start_date ? new Date(start_date) : null;
  try {
    const created = await db.tx(async (client) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        let etd = null;
        if (base && iv >= 0) { const d = new Date(base); d.setDate(d.getDate() + i * iv); etd = d.toISOString().split('T')[0]; }
        const c = await copyOrder(client, source_order_id, { etd, batch_id });
        if (!c) { const e = new Error('Order not found'); e.status = 404; throw e; }
        out.push(c);
      }
      return out;
    });
    res.status(201).json({ created, count: created.length, batch_id });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[orders/bulk]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/:id  (includes items)
router.get('/:id', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`${ORDER_SELECT} WHERE o.id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    const { rows: items } = await db.query(
      'SELECT * FROM order_items WHERE order_id = $1 ORDER BY id',
      [req.params.id]
    );
    res.json({ ...rows[0], items });
  } catch (err) {
    console.error('[orders/get]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/orders/:id/tracking — add a tracking update (staff+)
router.post('/:id/tracking', protect, authorize('owner', 'manager', 'staff'), async (req, res) => {
  const { location, event, note } = req.body;
  if (!event) return res.status(400).json({ error: 'event required' });
  try {
    const entry = { ts: new Date().toISOString(), location: location || '', event, note: note || '' };
    const { rows } = await db.query(`
      UPDATE import_orders
      SET tracking_updates = JSON_ARRAY_APPEND(
            COALESCE(NULLIF(tracking_updates, ''), '[]'), '$', JSON_EXTRACT($1, '$')),
          updated_at = NOW()
      WHERE id = $2
      RETURNING tracking_updates
    `, [JSON.stringify(entry), req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    res.json({ tracking_updates: rows[0].tracking_updates });
  } catch (err) {
    console.error('[orders/tracking]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/orders — create (staff+)
router.post('/', protect, authorize('owner', 'manager', 'staff'), async (req, res) => {
  const { po_number, supplier_id, container_type, currency, status, marking,
          total_quantity, total_weight, total_cbm, total_value,
          utilization_percentage, eta, etd, bl_number, shipment_date,
          payment_due_date, notes, items = [],
          freight_cost, insurance_cost, duty_rate, free_days, demurrage_rate,
          container_returned_date, doc_checklist, priority } = req.body;
  if (!po_number || !supplier_id) return res.status(400).json({ error: 'po_number and supplier_id required' });

  const totals = items.length ? calcTotals(items) : { total_quantity, total_weight, total_cbm, total_value };

  let dueDateVal = payment_due_date || null;
  if (!dueDateVal && shipment_date) {
    const { rows: sup } = await db.query('SELECT payment_terms_days FROM suppliers WHERE id = $1', [supplier_id]);
    if (sup[0]) {
      const d = new Date(shipment_date);
      d.setDate(d.getDate() + (sup[0].payment_terms_days || 30));
      dueDateVal = d.toISOString().split('T')[0];
    }
  }

  try {
    const newId = await db.tx(async (client) => {
      const { rows } = await client.query(`
      INSERT INTO import_orders
        (po_number, supplier_id, container_type, currency, status, marking,
         total_quantity, total_weight, total_cbm, total_value, utilization_percentage,
         eta, etd, bl_number, shipment_date, payment_due_date, notes,
         freight_cost, insurance_cost, duty_rate, free_days, demurrage_rate,
         container_returned_date, doc_checklist, priority)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id
    `, [po_number, supplier_id, container_type, currency || 'USD', status || 'Draft', marking || null,
        totals.total_quantity || 0, totals.total_weight || 0, totals.total_cbm || 0, totals.total_value || 0,
        utilization_percentage || 0, eta || null, etd || null, bl_number || null,
        shipment_date || null, dueDateVal, notes || null,
        freight_cost || 0, insurance_cost || 0, duty_rate || 0, free_days || 7, demurrage_rate || 0,
        container_returned_date || null, doc_checklist ? JSON.stringify(doc_checklist) : '{}', priority || 'normal']);
      if (items.length) await saveItems(client, rows[0].id, items);
      return rows[0].id;
    });
    const { rows: order } = await db.query(`${ORDER_SELECT} WHERE o.id = $1`, [newId]);
    const { rows: savedItems } = await db.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [newId]);
    res.status(201).json({ ...order[0], items: savedItems });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'PO number already exists' });
    console.error('[orders/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Excel / CSV import of historical orders ────────────────────────────────────
const IMPORT_COLUMNS = ['po_number','supplier_code','container_type','status','marking','etd','eta',
  'item_name','brand','thickness','size','liner_color','qty_ctn','total_ctn','total_roll',
  'unit_price','price_per_sqm','kg_pkg','code','marking_item','shipping_mark','item_notes'];

// GET /api/orders/import/template — downloadable .xlsx template with an example row
router.get('/import/template', protect, authorize('owner', 'manager', 'staff'), (req, res) => {
  const example = {
    po_number: 'ISLB 00126', supplier_code: 'ISLB', container_type: '40HQ', status: 'Delivered',
    marking: 'BATCH-A', etd: '2025-01-10', eta: '2025-02-05',
    item_name: 'DS TISSUE TAPE HB', brand: 'STUK', thickness: '0.9MM', size: '1000MM x 50M',
    liner_color: 'YELLOW', qty_ctn: 24, total_ctn: 100, total_roll: 2400, unit_price: 2.35,
    price_per_sqm: 0.047, kg_pkg: 12.5, code: 'IS-57145V', marking_item: '1MM',
    shipping_mark: 'INSULATION TAPE', item_notes: '',
  };
  const ws = XLSX.utils.json_to_sheet([example], { header: IMPORT_COLUMNS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Orders');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="orders_import_template.xlsx"');
  res.send(buf);
});

// POST /api/orders/import — bulk import from .xlsx / .xls / .csv (staff+).
// One row per line item; rows group into orders by po_number. Supplier matched by code.
router.post('/import', protect, authorize('owner', 'manager', 'staff'), uploadMem.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  let rows;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true });
  } catch (e) { return res.status(400).json({ error: 'Could not parse file. Use the provided template.' }); }
  if (!rows.length) return res.status(400).json({ error: 'File has no data rows' });

  // Excel dates arrive as Date objects or serial numbers → normalise to YYYY-MM-DD
  const xlDate = (v) => {
    if (v === '' || v == null) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    if (/^\d+(\.\d+)?$/.test(s)) {
      const d = XLSX.SSF.parse_date_code(parseFloat(s));
      if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
    return s || null;
  };
  const norm = (v) => (v == null ? '' : String(v).trim());

  const { rows: sups } = await db.query('SELECT id, LOWER(code) AS code FROM suppliers');
  const supByCode = new Map(sups.map(s => [s.code, s.id]));
  const groups = new Map();
  const errors = [];

  rows.forEach((r, i) => {
    const sid = supByCode.get(norm(r.supplier_code).toLowerCase());
    if (!sid) { errors.push(`Row ${i + 2}: unknown supplier_code "${norm(r.supplier_code)}"`); return; }
    const po = norm(r.po_number);
    const key = po || `__${sid}__${norm(r.marking)}`;
    if (!groups.has(key)) {
      groups.set(key, {
        po_number: po, supplier_id: sid,
        container_type: norm(r.container_type) || '40HQ',
        status: norm(r.status) || 'Delivered',
        marking: norm(r.marking) || null,
        etd: xlDate(r.etd), eta: xlDate(r.eta), items: [],
      });
    }
    if (norm(r.item_name)) {
      groups.get(key).items.push({
        item_name: norm(r.item_name), brand: norm(r.brand), thickness: norm(r.thickness),
        size: norm(r.size), liner_color: norm(r.liner_color), qty_ctn: r.qty_ctn,
        total_ctn: r.total_ctn, total_roll: r.total_roll, unit_price: r.unit_price,
        price_per_sqm: r.price_per_sqm, kg_pkg: r.kg_pkg, code: norm(r.code),
        marking: norm(r.marking_item), shipping_mark: norm(r.shipping_mark),
        notes: norm(r.item_notes), cbm: 0,
      });
    }
  });

  try {
    const created = await db.tx(async (client) => {
      let n = 0;
      for (const g of groups.values()) {
      const po = g.po_number || await nextPoNumber(client, g.supplier_id);
      const t = calcTotals(g.items);
      const { rows: ins } = await client.query(`
        INSERT INTO import_orders
          (po_number, supplier_id, container_type, status, marking, etd, eta,
           total_quantity, total_weight, total_cbm, total_value, currency)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'USD')
        ON CONFLICT (po_number) DO NOTHING RETURNING id
      `, [po, g.supplier_id, g.container_type, g.status, g.marking, g.etd, g.eta,
          t.total_quantity, t.total_weight, t.total_cbm, t.total_value]);
      if (!ins[0]) { errors.push(`PO "${po}" already exists — skipped`); continue; }
      if (g.items.length) await saveItems(client, ins[0].id, g.items);
      n++;
      }
      return n;
    });
    res.json({ created, groups: groups.size, errors });
  } catch (err) {
    console.error('[orders/import]', err);
    res.status(500).json({ error: 'Import failed: ' + err.message, errors });
  }
});

// PUT /api/orders/:id — update (staff+)
router.put('/:id', protect, authorize('owner', 'manager', 'staff'), async (req, res) => {
  const { supplier_id, container_type, currency, status, marking,
          total_quantity, total_weight, total_cbm, total_value,
          utilization_percentage, eta, etd, bl_number, shipment_date,
          payment_due_date, notes, items,
          freight_cost, insurance_cost, duty_rate, free_days, demurrage_rate,
          container_returned_date, doc_checklist, priority,
          cha_charges, extra_charges, usd_rate,
          loading_date, delivered_date, usd_rate_delivery,
          if_unmodified_since } = req.body;

  const totals = (items && items.length) ? calcTotals(items) : { total_quantity, total_weight, total_cbm, total_value };

  // Empty strings from the form must become NULL — Postgres rejects '' for date/numeric
  const dnull = (v) => (v === '' || v === undefined || v === null) ? null : v;

  const dueDateProvided = payment_due_date !== undefined;
  let dueDateVal = dueDateProvided ? (payment_due_date || null) : undefined;
  if (dueDateVal === undefined && shipment_date) {
    const sid = supplier_id || (await db.query('SELECT supplier_id FROM import_orders WHERE id=$1', [req.params.id])).rows[0]?.supplier_id;
    if (sid) {
      const { rows: sup } = await db.query('SELECT payment_terms_days FROM suppliers WHERE id = $1', [sid]);
      if (sup[0]) {
        const d = new Date(shipment_date);
        d.setDate(d.getDate() + (sup[0].payment_terms_days || 30));
        dueDateVal = d.toISOString().split('T')[0];
      }
    }
  }

  try {
    const conflict = await db.tx(async (client) => {
      // Lock the row first: the read-modify-write below (and saveItems, which
      // deletes and re-inserts the item rows) must not interleave with another
      // edit of the same order.
      const { rows: cur } = await client.query(
        'SELECT updated_at FROM import_orders WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!cur[0]) { const e = new Error('not found'); e.status = 404; throw e; }
      // Optimistic concurrency: if the client sent the version it loaded and the
      // row has moved on since, reject rather than silently discarding the other
      // user's edit.
      if (if_unmodified_since && new Date(if_unmodified_since).getTime() !== new Date(cur[0].updated_at).getTime()) {
        return true;
      }
      await client.query(`
      UPDATE import_orders SET
        supplier_id            = COALESCE($1,  supplier_id),
        container_type         = COALESCE($2,  container_type),
        currency               = COALESCE($3,  currency),
        status                 = COALESCE($4,  status),
        marking                = COALESCE($5,  marking),
        total_quantity         = COALESCE($6,  total_quantity),
        total_weight           = COALESCE($7,  total_weight),
        total_cbm              = COALESCE($8,  total_cbm),
        total_value            = COALESCE($9,  total_value),
        utilization_percentage = COALESCE($10, utilization_percentage),
        eta                    = COALESCE($11, eta),
        notes                  = COALESCE($12, notes),
        etd                    = COALESCE($13, etd),
        bl_number              = COALESCE($14, bl_number),
        shipment_date          = COALESCE($15, shipment_date),
        payment_due_date       = CASE WHEN $26 THEN $16 ELSE payment_due_date END,
        freight_cost           = COALESCE($18, freight_cost),
        insurance_cost         = COALESCE($19, insurance_cost),
        duty_rate              = COALESCE($20, duty_rate),
        free_days              = COALESCE($21, free_days),
        demurrage_rate         = COALESCE($22, demurrage_rate),
        container_returned_date= COALESCE($23, container_returned_date),
        doc_checklist          = COALESCE($24, doc_checklist),
        priority               = COALESCE($25, priority),
        cha_charges            = COALESCE($27, cha_charges),
        extra_charges          = COALESCE($28, extra_charges),
        usd_rate               = COALESCE($29, usd_rate),
        loading_date           = COALESCE($30, loading_date),
        delivered_date         = COALESCE($31, delivered_date),
        usd_rate_delivery      = COALESCE($32, usd_rate_delivery),
        updated_at             = NOW()
      WHERE id = $17
    `, [supplier_id, container_type, currency, status, marking ?? null,
        totals.total_quantity, totals.total_weight, totals.total_cbm, totals.total_value,
        utilization_percentage, dnull(eta), notes ?? null,
        dnull(etd), bl_number ?? null, dnull(shipment_date),
        dueDateVal !== undefined ? dnull(dueDateVal) : null,
        req.params.id,
        dnull(freight_cost), dnull(insurance_cost), dnull(duty_rate),
        dnull(free_days), dnull(demurrage_rate),
        dnull(container_returned_date),
        doc_checklist ? JSON.stringify(doc_checklist) : null,
        priority ?? null,
        dueDateProvided,
        dnull(cha_charges), dnull(extra_charges), dnull(usd_rate),
        dnull(loading_date), dnull(delivered_date), dnull(usd_rate_delivery)]);
      if (items) await saveItems(client, req.params.id, items);
      return false;
    });
    if (conflict) {
      return res.status(409).json({
        error: 'This order was changed by someone else. Reload before saving.',
        code: 'STALE_WRITE',
      });
    }
    const { rows } = await db.query(`${ORDER_SELECT} WHERE o.id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    const { rows: savedItems } = await db.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [req.params.id]);
    res.json({ ...rows[0], items: savedItems });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: 'Order not found' });
    console.error('[orders/update]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/orders/:id/status — staff+
router.patch('/:id/status', protect, authorize('owner', 'manager', 'staff'), async (req, res) => {
  const { status } = req.body;
  const VALID = ['Draft','Tentative','Confirmed','Loaded','Shipped','In Transit','Arrived','Customs Clearance','Cleared','Delivered','Paid'];
  if (!VALID.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const { rows } = await db.query(
      'UPDATE import_orders SET status = $1, status_changed_at = NOW(), updated_at = NOW() WHERE id = $2 RETURNING id, status',
      [status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[orders/status]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/orders/:id — owner or manager only
router.delete('/:id', protect, authorize('owner', 'manager'), async (req, res) => {
  try {
    const { rows } = await db.query('DELETE FROM import_orders WHERE id = $1 RETURNING id', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[orders/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
