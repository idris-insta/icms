const router    = require('express').Router();
const db        = require('../db');
const protect   = require('../middleware/auth');
const authorize = require('../middleware/authorize');

const FREQ_DAYS = { weekly: 7, biweekly: 14, fortnightly: 14, monthly: 30, custom: null };
function intervalDays(freq, custom) {
  const f = FREQ_DAYS[String(freq || '').toLowerCase()];
  return f != null ? f : (parseInt(custom) || 7);
}
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().split('T')[0]; };

// Build the planned shipment dates for a schedule row
function plannedDates(s) {
  const out = [];
  const total = parseInt(s.total_shipments) || 1;
  const iv = intervalDays(s.frequency, s.interval_days);
  const start = s.start_date ? new Date(s.start_date) : new Date();
  for (let i = 0; i < total; i++) {
    out.push({ seq: i + 1, date: addDays(start, i * iv), generated: i < (parseInt(s.generated_count) || 0) });
  }
  return out;
}

// Must run inside a transaction — see the identical helper in routes/orders.js.
// The supplier row is locked FOR UPDATE so concurrent allocations serialise.
async function nextPoNumber(client, supplierId) {
  const { rows: sup } = await client.query('SELECT code FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]);
  if (!sup[0]) throw new Error('Supplier not found');
  const yr = String(new Date().getFullYear()).slice(-2);
  const { rows } = await client.query(`
    SELECT COALESCE(MAX(CASE WHEN po_number REGEXP '^.+ [0-9]{5}$'
      THEN CAST(LEFT(RIGHT(po_number, 5), 3) AS UNSIGNED) ELSE 0 END), 0) AS max_seq
    FROM import_orders WHERE supplier_id = $1`, [supplierId]);
  const seq = String((parseInt(rows[0].max_seq) || 0) + 1).padStart(3, '0');
  return `${sup[0].code} ${seq}${yr}`;
}

// GET /api/schedules — all schedule lines with supplier + planned dates
router.get('/', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT sc.*, s.code AS supplier_code, s.name AS supplier, sk.sku_code, sk.description AS sku_desc
      FROM order_schedules sc
      JOIN suppliers s ON sc.supplier_id = s.id
      LEFT JOIN skus sk ON sc.sku_id = sk.id
      ORDER BY sc.status, s.name, sc.id
    `);
    const schedules = rows.map(s => {
      const planned = plannedDates(s);
      const nextPending = planned.find(p => !p.generated);
      return { ...s, interval_effective: intervalDays(s.frequency, s.interval_days), planned, next_date: nextPending?.date || null, remaining: planned.filter(p => !p.generated).length };
    });
    res.json({ schedules });
  } catch (err) {
    console.error('[schedules/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/schedules/calendar — flat upcoming planned shipments (pending only), sorted
router.get('/calendar', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT sc.*, s.code AS supplier_code, s.name AS supplier, sk.sku_code
      FROM order_schedules sc
      JOIN suppliers s ON sc.supplier_id = s.id
      LEFT JOIN skus sk ON sc.sku_id = sk.id
      WHERE sc.status = 'active'
    `);
    const events = [];
    for (const s of rows) {
      for (const p of plannedDates(s)) {
        if (p.generated) continue;
        events.push({
          schedule_id: s.id, supplier: s.supplier, supplier_code: s.supplier_code,
          item: s.item_name || s.sku_code || 'Item', container_type: s.container_type,
          qty_per_shipment: s.qty_per_shipment, seq: p.seq, total: s.total_shipments,
          date: p.date, frequency: s.frequency,
        });
      }
    }
    events.sort((a, b) => a.date.localeCompare(b.date));
    res.json({ events });
  } catch (err) {
    console.error('[schedules/calendar]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/schedules — create a schedule line (staff+)
router.post('/', protect, authorize('owner', 'manager', 'staff'), async (req, res) => {
  const b = req.body;
  if (!b.supplier_id) return res.status(400).json({ error: 'supplier_id required' });
  try {
    const { rows } = await db.query(`
      INSERT INTO order_schedules
        (supplier_id, sku_id, item_name, container_type, currency, qty_per_shipment,
         frequency, interval_days, total_shipments, start_date, status, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
    `, [b.supplier_id, b.sku_id || null, b.item_name || null, b.container_type || '40HC',
        b.currency || 'USD', parseInt(b.qty_per_shipment) || 1, b.frequency || 'weekly',
        intervalDays(b.frequency, b.interval_days), parseInt(b.total_shipments) || 1,
        b.start_date || new Date().toISOString().split('T')[0], b.status || 'active', b.notes || null]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[schedules/create]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/schedules/:id
router.put('/:id', protect, authorize('owner', 'manager', 'staff'), async (req, res) => {
  const b = req.body;
  const nz = (v) => (v === '' || v === undefined || v === null) ? null : v; // empty → NULL for date/int cols
  try {
    const { rows } = await db.query(`
      UPDATE order_schedules SET
        item_name        = COALESCE($1, item_name),
        container_type   = COALESCE($2, container_type),
        currency         = COALESCE($3, currency),
        qty_per_shipment = COALESCE($4, qty_per_shipment),
        frequency        = COALESCE($5, frequency),
        interval_days    = COALESCE($6, interval_days),
        total_shipments  = COALESCE($7, total_shipments),
        start_date       = COALESCE($8, start_date),
        status           = COALESCE($9, status),
        notes            = COALESCE($10, notes),
        sku_id           = COALESCE($11, sku_id),
        updated_at       = NOW()
      WHERE id = $12 RETURNING *
    `, [b.item_name ?? null, b.container_type ?? null, b.currency ?? null,
        nz(b.qty_per_shipment), b.frequency ?? null,
        b.frequency ? intervalDays(b.frequency, b.interval_days) : nz(b.interval_days),
        nz(b.total_shipments), nz(b.start_date), b.status ?? null, b.notes ?? null,
        nz(b.sku_id), req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Schedule not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[schedules/update]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', protect, authorize('owner', 'manager'), async (req, res) => {
  try {
    const { rows } = await db.query('DELETE FROM order_schedules WHERE id = $1 RETURNING id', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Schedule not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[schedules/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/schedules/:id/generate — turn the next pending shipment into a Draft order
router.post('/:id/generate', protect, authorize('owner', 'manager', 'staff'), async (req, res) => {
  try {
    // The whole allocate-and-generate must be atomic: the schedule row is locked
    // FOR UPDATE so two clicks cannot both claim the same pending shipment.
    const out = await db.tx(async (client) => {
    const { rows: sr } = await client.query('SELECT * FROM order_schedules WHERE id = $1 FOR UPDATE', [req.params.id]);
    const s = sr[0];
    if (!s) { const e = new Error('Schedule not found'); e.status = 404; throw e; }
    const planned = plannedDates(s);
    const next = planned.find(p => !p.generated);
    if (!next) { const e = new Error('Schedule fully generated'); e.status = 400; throw e; }
    const po = await nextPoNumber(client, s.supplier_id);
    const { rows: ord } = await client.query(`
      INSERT INTO import_orders (po_number, supplier_id, container_type, currency, status, marking, etd, notes, schedule_id, priority)
      VALUES ($1,$2,$3,$4,'Draft',$5,$6,$7,$8,'normal') RETURNING id, po_number
    `, [po, s.supplier_id, s.container_type, s.currency,
        s.item_name || s.sku_code || null, next.date,
        `Auto from schedule #${s.id} (shipment ${next.seq}/${s.total_shipments})`, s.id]);
    if (s.sku_id) {
      await client.query(`
        INSERT INTO order_items (order_id, sku_id, item_name, total_ctn, qty_ctn)
        SELECT $1, id, description, $2, COALESCE(qty_per_pkg, 0) FROM skus WHERE id = $3
      `, [ord[0].id, s.qty_per_shipment, s.sku_id]).catch(() => {});
    }
    await client.query('UPDATE order_schedules SET generated_count = generated_count + 1, updated_at = NOW() WHERE id = $1', [s.id]);
    return { order_id: ord[0].id, po_number: ord[0].po_number, shipment: next.seq };
    });
    res.status(201).json(out);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[schedules/generate]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
