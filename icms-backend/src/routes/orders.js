const router  = require('express').Router();
const db      = require('../db');
const protect = require('../middleware/auth');

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
         COALESCE(o.shipped,false)     AS shipped,
         COALESCE(o.delivered,false)   AS delivered,
         s.id AS supplier_id, s.code AS supplier_code, s.name AS supplier, s.base_currency, s.payment_terms_days
  FROM import_orders o
  JOIN suppliers s ON o.supplier_id = s.id
`;

// Upsert line items — deletes existing then re-inserts
async function saveItems(client, orderId, items) {
  await client.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
  for (const item of items) {
    const total_kg  = (parseFloat(item.total_ctn)  || 0) * (parseFloat(item.kg_pkg) || 0);
    await client.query(`
      INSERT INTO order_items
        (order_id, item_name, thickness, size, liner_color,
         qty_ctn, total_ctn, total_roll,
         unit_price, weight, kg_pkg, code, shipping_mark, quantity, cbm)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    `, [
      orderId,
      item.item_name     || '',
      item.thickness     || '',
      item.size          || '',
      item.liner_color   || '',
      parseInt(item.qty_ctn)     || 0,
      parseInt(item.total_ctn)   || 0,
      parseInt(item.total_roll)  || 0,
      parseFloat(item.unit_price) || 0,
      total_kg,
      parseFloat(item.kg_pkg)    || 0,
      item.code          || '',
      item.shipping_mark || '',
      parseInt(item.total_roll)  || 0,   // quantity = total_roll
      parseFloat(item.cbm)       || 0,
    ]);
  }
}

// Recalculate order totals from items
function calcTotals(items) {
  return {
    total_quantity: items.reduce((s, i) => s + (parseInt(i.total_roll) || 0), 0),
    total_weight:   items.reduce((s, i) => s + (parseInt(i.total_ctn) || 0) * (parseFloat(i.kg_pkg) || 0), 0),
    total_value:    items.reduce((s, i) => s + (parseInt(i.total_roll) || 0) * (parseFloat(i.unit_price) || 0), 0),
    total_cbm:      items.reduce((s, i) => s + (parseFloat(i.cbm) || 0), 0),
  };
}

// GET /api/orders
router.get('/', protect, async (req, res) => {
  const { status, search } = req.query;
  try {
    let where = [], params = [];
    if (status && status !== 'All') { params.push(status); where.push(`o.status = $${params.length}`); }
    if (search) { params.push(`%${search}%`); where.push(`(o.po_number ILIKE $${params.length} OR s.name ILIKE $${params.length})`); }
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const { rows } = await db.query(`${ORDER_SELECT} ${clause} ORDER BY o.created_at DESC`, params);
    res.json({ orders: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/orders/kanban
router.get('/kanban', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT o.id, o.po_number, s.name AS supplier, o.container_type, o.total_value, o.status
      FROM import_orders o JOIN suppliers s ON o.supplier_id = s.id ORDER BY o.created_at DESC
    `);
    const groups = {};
    rows.forEach(r => {
      if (!groups[r.status]) groups[r.status] = [];
      groups[r.status].push({ id: r.id, po_number: r.po_number, supplier: r.supplier, container: r.container_type, value: parseFloat(r.total_value) });
    });
    res.json(groups);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/orders/supplier-summary  — MUST be before /:id to avoid route shadowing
router.get('/supplier-summary', protect, async (req, res) => {
  try {
    // Compute week date boundaries for current month
    const now  = new Date();
    const yr   = now.getFullYear();
    const mo   = now.getMonth(); // 0-indexed
    const pad  = (d) => `${yr}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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
        -- status-based counts
        COUNT(o.id) FILTER (WHERE o.status = 'Delivered')::int                                                                              AS delivered_count,
        COUNT(o.id) FILTER (WHERE o.status NOT IN ('Draft','Tentative','Confirmed'))::int                                                   AS shipped_count,
        COUNT(o.id) FILTER (WHERE o.status IN ('Draft','Tentative','Confirmed'))::int                                                       AS pending_count,
        COUNT(o.id) FILTER (WHERE o.status IN ('Loaded','Shipped','In Transit','Arrived','Customs Clearance','Cleared'))::int               AS otw_count,
        -- week counts (ETD within each week of current month)
        COUNT(o.id) FILTER (WHERE o.etd::date BETWEEN $1::date AND $2::date)::int  AS week1,
        COUNT(o.id) FILTER (WHERE o.etd::date BETWEEN $3::date AND $4::date)::int  AS week2,
        COUNT(o.id) FILTER (WHERE o.etd::date BETWEEN $5::date AND $6::date)::int  AS week3,
        COUNT(o.id) FILTER (WHERE o.etd::date BETWEEN $7::date AND $8::date)::int  AS week4,
        COUNT(o.id) FILTER (WHERE o.etd::date BETWEEN $9::date AND $10::date)::int AS month_total,
        -- financial totals
        COALESCE(SUM(o.total_value), 0)           AS total_value,
        COALESCE(SUM(p_agg.paid), 0)              AS total_paid
      FROM suppliers s
      LEFT JOIN import_orders o ON o.supplier_id = s.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE supplier_id = s.id
      ) p_agg ON true
      GROUP BY s.id, s.code, s.name, s.base_currency,
               s.port, s.avg_value_usd, s.ex_rate, s.duty_percent, s.expense_inr, s.target_per_month
      ORDER BY s.code
    `, [w1s, w1e, w2s, w2e, w3s, w3e, w4s, w4e, moStart, moEnd]);

    const result = rows.map(r => {
      const avg  = parseFloat(r.avg_value_usd) || 0;
      const ex   = parseFloat(r.ex_rate)       || 84;
      const duty = parseFloat(r.duty_percent)  || 10;
      const exp  = parseFloat(r.expense_inr)   || 0;
      // CP (₹ per USD of goods) = (avg × ex × (1 + duty/100) + expense_inr) / avg
      const cp_inr = avg > 0 ? ((avg * ex * (1 + duty / 100)) + exp) / avg : 0;
      const outstanding = parseFloat(r.total_value) - parseFloat(r.total_paid);
      return { ...r, cp_inr: Math.round(cp_inr * 100) / 100, outstanding };
    });

    res.json({ suppliers: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/orders/next-po-number?supplier_id=5  — auto-generate next PO number
router.get('/next-po-number', protect, async (req, res) => {
  const { supplier_id } = req.query;
  if (!supplier_id) return res.status(400).json({ error: 'supplier_id required' });
  try {
    const { rows: supRows } = await db.query('SELECT code FROM suppliers WHERE id = $1', [parseInt(supplier_id)]);
    if (!supRows[0]) return res.status(404).json({ error: 'Supplier not found' });
    const code = supRows[0].code;
    const yr   = String(new Date().getFullYear()).slice(-2); // "25"

    // Find highest 3-digit sequence for this supplier (format: "ISDS 00125")
    const { rows } = await db.query(
      `SELECT po_number FROM import_orders WHERE supplier_id = $1 ORDER BY created_at DESC`,
      [parseInt(supplier_id)]
    );

    let maxSeq = 0;
    for (const row of rows) {
      // Pattern: ISCODE [NNN][YY]  — last 2 chars = year, before that = 3-digit seq
      const m = row.po_number.match(/\s(\d{3})\d{2}$/);
      if (m) {
        maxSeq = Math.max(maxSeq, parseInt(m[1]));
      } else {
        // Fallback: extract number from last token
        const parts = row.po_number.trim().split(/\s+/);
        const last  = parts[parts.length - 1] || '';
        if (last.length >= 3) {
          const num = parseInt(last.slice(0, last.length - 2));
          if (!isNaN(num)) maxSeq = Math.max(maxSeq, num);
        }
      }
    }

    const seq    = String(maxSeq + 1).padStart(3, '0');
    const next_po = `${code} ${seq}${yr}`;
    res.json({ next_po, supplier_code: code });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/orders/:id/tracking — add a tracking update
router.post('/:id/tracking', protect, async (req, res) => {
  const { location, event, note } = req.body;
  if (!event) return res.status(400).json({ error: 'event required' });
  try {
    const entry = { ts: new Date().toISOString(), location: location || '', event, note: note || '' };
    const { rows } = await db.query(`
      UPDATE import_orders
      SET tracking_updates = COALESCE(tracking_updates, '[]'::jsonb) || $1::jsonb,
          updated_at = NOW()
      WHERE id = $2
      RETURNING tracking_updates
    `, [JSON.stringify([entry]), req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    res.json({ tracking_updates: rows[0].tracking_updates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/orders — create with optional items[]
router.post('/', protect, async (req, res) => {
  const { po_number, supplier_id, container_type, currency, status, marking,
          total_quantity, total_weight, total_cbm, total_value,
          utilization_percentage, eta, etd, bl_number, shipment_date,
          payment_due_date, notes, items = [],
          freight_cost, insurance_cost, duty_rate, free_days, demurrage_rate,
          container_returned_date, doc_checklist, priority,
          shipped, delivered } = req.body;
  if (!po_number || !supplier_id) return res.status(400).json({ error: 'po_number and supplier_id required' });

  const totals = items.length ? calcTotals(items) : { total_quantity, total_weight, total_cbm, total_value };

  // Auto-calc payment_due_date from shipment_date + supplier terms if not provided
  let dueDateVal = payment_due_date || null;
  if (!dueDateVal && shipment_date) {
    const { rows: sup } = await db.query('SELECT payment_terms_days FROM suppliers WHERE id = $1', [supplier_id]);
    if (sup[0]) {
      const d = new Date(shipment_date);
      d.setDate(d.getDate() + (sup[0].payment_terms_days || 30));
      dueDateVal = d.toISOString().split('T')[0];
    }
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`
      INSERT INTO import_orders
        (po_number, supplier_id, container_type, currency, status, marking,
         total_quantity, total_weight, total_cbm, total_value, utilization_percentage,
         eta, etd, bl_number, shipment_date, payment_due_date, notes,
         freight_cost, insurance_cost, duty_rate, free_days, demurrage_rate,
         container_returned_date, doc_checklist, priority, shipped, delivered)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27) RETURNING id
    `, [po_number, supplier_id, container_type, currency || 'USD', status || 'Draft', marking || null,
        totals.total_quantity || 0, totals.total_weight || 0, totals.total_cbm || 0, totals.total_value || 0,
        utilization_percentage || 0, eta || null, etd || null, bl_number || null,
        shipment_date || null, dueDateVal, notes || null,
        freight_cost || 0, insurance_cost || 0, duty_rate || 0, free_days || 7, demurrage_rate || 0,
        container_returned_date || null, doc_checklist ? JSON.stringify(doc_checklist) : '{}', priority || 'normal',
        shipped || false, delivered || false]);
    if (items.length) await saveItems(client, rows[0].id, items);
    await client.query('COMMIT');
    const { rows: order } = await db.query(`${ORDER_SELECT} WHERE o.id = $1`, [rows[0].id]);
    const { rows: savedItems } = await db.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [rows[0].id]);
    res.status(201).json({ ...order[0], items: savedItems });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'PO number already exists' });
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// PUT /api/orders/:id — update with optional items[]
router.put('/:id', protect, async (req, res) => {
  const { supplier_id, container_type, currency, status, marking,
          total_quantity, total_weight, total_cbm, total_value,
          utilization_percentage, eta, etd, bl_number, shipment_date,
          payment_due_date, notes, items,
          freight_cost, insurance_cost, duty_rate, free_days, demurrage_rate,
          container_returned_date, doc_checklist, priority,
          shipped, delivered } = req.body;

  const totals = (items && items.length) ? calcTotals(items) : { total_quantity, total_weight, total_cbm, total_value };

  // Auto-calc due date if shipment_date provided and no explicit due date
  let dueDateVal = payment_due_date !== undefined ? (payment_due_date || null) : undefined;
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

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
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
        payment_due_date       = COALESCE($16, payment_due_date),
        freight_cost           = COALESCE($18, freight_cost),
        insurance_cost         = COALESCE($19, insurance_cost),
        duty_rate              = COALESCE($20, duty_rate),
        free_days              = COALESCE($21, free_days),
        demurrage_rate         = COALESCE($22, demurrage_rate),
        container_returned_date= COALESCE($23, container_returned_date),
        doc_checklist          = COALESCE($24, doc_checklist),
        priority               = COALESCE($25, priority),
        shipped                = COALESCE($26, shipped),
        delivered              = COALESCE($27, delivered),
        updated_at             = NOW()
      WHERE id = $17
    `, [supplier_id, container_type, currency, status, marking ?? null,
        totals.total_quantity, totals.total_weight, totals.total_cbm, totals.total_value,
        utilization_percentage, eta ?? null, notes ?? null,
        etd ?? null, bl_number ?? null, shipment_date ?? null,
        dueDateVal !== undefined ? dueDateVal : null,
        req.params.id,
        freight_cost ?? null, insurance_cost ?? null, duty_rate ?? null,
        free_days ?? null, demurrage_rate ?? null,
        container_returned_date ?? null,
        doc_checklist ? JSON.stringify(doc_checklist) : null,
        priority ?? null,
        shipped !== undefined ? shipped : null,
        delivered !== undefined ? delivered : null]);
    if (items) await saveItems(client, req.params.id, items);
    await client.query('COMMIT');
    const { rows } = await db.query(`${ORDER_SELECT} WHERE o.id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    const { rows: savedItems } = await db.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [req.params.id]);
    res.json({ ...rows[0], items: savedItems });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// PATCH /api/orders/:id/status
router.patch('/:id/status', protect, async (req, res) => {
  const { status } = req.body;
  const VALID = ['Draft','Tentative','Confirmed','Loaded','Shipped','In Transit','Arrived','Customs Clearance','Cleared','Delivered'];
  if (!VALID.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const { rows } = await db.query(
      'UPDATE import_orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status',
      [status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/orders/:id
router.delete('/:id', protect, async (req, res) => {
  try {
    const { rows } = await db.query('DELETE FROM import_orders WHERE id = $1 RETURNING id', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
