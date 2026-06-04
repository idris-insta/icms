const router    = require('express').Router();
const multer    = require('multer');
const db        = require('../db');
const protect   = require('../middleware/auth');
const authorize = require('../middleware/authorize');

const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── CSV helpers ───────────────────────────────────────────────────────────────

// Handles quoted fields including "" escaped quotes inside quoted values
function parseCSV(buf) {
  const text = buf.toString('utf8');
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  const splitLine = (line) => {
    const cols = [];
    let cur = '', inQ = false, i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i += 2; continue; } // escaped quote
          inQ = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"')      { inQ = true; }
        else if (ch === ',') { cols.push(cur.trim()); cur = ''; }
        else                 { cur += ch; }
      }
      i++;
    }
    cols.push(cur.trim());
    return cols;
  };

  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map(l => {
    const vals = splitLine(l);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  }).filter(r => Object.values(r).some(v => v !== ''));
  return { headers, rows };
}

const SKU_HEADERS      = 'sku_code,description,hsn_code,category,thickness,size,color,liner_color,roll_weight,item_code,shipping_marks,weight_per_unit,cbm_per_unit';
const SUPPLIER_HEADERS = 'code,name,country,base_currency,contact_email,contact_phone,payment_terms_days';
const PORT_HEADERS     = 'code,name,country,port_type';

const SKU_EXAMPLE      = 'ADH-001,55 Mic Clear Adhesive Tape,39199090,Tape,55 MIC,480MM X 100M,CLEAR,CLEAR,4.2,ADH-001-480X100,CLEAR ADHESIVE TAPE ROLLS,0.5,0.002';
const SUPPLIER_EXAMPLE = 'SUP-001,Acme Packaging Ltd,China,CNY,contact@acme.cn,+86-21-12345678,30';
const PORT_EXAMPLE     = 'CNSHA,Shanghai,China,origin';

// ── SKUs ──────────────────────────────────────────────────────────────────────

router.get('/skus/template', protect, (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="skus_template.csv"');
  res.send(SKU_HEADERS + '\n' + SKU_EXAMPLE + '\n');
});

router.post('/skus/bulk', protect, authorize('owner', 'manager'), uploadMem.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { rows } = parseCSV(req.file.buffer);
  let inserted = 0, updated = 0, errors = [];
  for (const r of rows) {
    if (!r.sku_code) { errors.push(`Row skipped — missing sku_code`); continue; }
    try {
      const result = await db.query(`
        INSERT INTO skus (sku_code, description, hsn_code, category, thickness, size, color, liner_color, roll_weight, item_code, shipping_marks, weight_per_unit, cbm_per_unit)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (sku_code) DO UPDATE SET
          description    = EXCLUDED.description,
          hsn_code       = EXCLUDED.hsn_code,
          category       = EXCLUDED.category,
          thickness      = EXCLUDED.thickness,
          size           = EXCLUDED.size,
          color          = EXCLUDED.color,
          liner_color    = EXCLUDED.liner_color,
          roll_weight    = EXCLUDED.roll_weight,
          item_code      = EXCLUDED.item_code,
          shipping_marks = EXCLUDED.shipping_marks,
          weight_per_unit = EXCLUDED.weight_per_unit,
          cbm_per_unit   = EXCLUDED.cbm_per_unit,
          updated_at     = NOW()
        RETURNING (xmax = 0) AS inserted
      `, [r.sku_code, r.description||null, r.hsn_code||null, r.category||null,
          r.thickness||null, r.size||null, r.color||null, r.liner_color||null,
          r.roll_weight||null, r.item_code||null, r.shipping_marks||null,
          r.weight_per_unit||null, r.cbm_per_unit||null]);
      result.rows[0].inserted ? inserted++ : updated++;
    } catch (e) { errors.push(`${r.sku_code}: ${e.message}`); }
  }
  res.json({ inserted, updated, errors, total: rows.length });
});

router.get('/skus', protect, async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
  const offset = (page - 1) * limit;
  try {
    const { rows: countRows } = await db.query('SELECT COUNT(*) FROM skus');
    const total = parseInt(countRows[0].count);
    const { rows } = await db.query('SELECT * FROM skus ORDER BY sku_code LIMIT $1 OFFSET $2', [limit, offset]);
    res.json({ skus: rows, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[masters/skus GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/skus', protect, authorize('owner', 'manager'), async (req, res) => {
  const { sku_code, description, hsn_code, weight_per_unit, cbm_per_unit, category,
          thickness, size, color, liner_color, roll_weight, item_code, shipping_marks } = req.body;
  if (!sku_code) return res.status(400).json({ error: 'sku_code required' });
  try {
    const { rows } = await db.query(`
      INSERT INTO skus (sku_code, description, hsn_code, weight_per_unit, cbm_per_unit, category,
                        thickness, size, color, liner_color, roll_weight, item_code, shipping_marks)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *
    `, [sku_code, description, hsn_code, weight_per_unit || 0, cbm_per_unit || 0, category,
        thickness || null, size || null, color || null, liner_color || null,
        roll_weight || null, item_code || null, shipping_marks || null]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'SKU code already exists' });
    console.error('[masters/skus POST]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/skus/:id', protect, authorize('owner', 'manager'), async (req, res) => {
  const { description, hsn_code, weight_per_unit, cbm_per_unit, category,
          thickness, size, color, liner_color, roll_weight, item_code, shipping_marks } = req.body;
  try {
    const { rows } = await db.query(`
      UPDATE skus SET
        description     = COALESCE($1,  description),
        hsn_code        = COALESCE($2,  hsn_code),
        weight_per_unit = COALESCE($3,  weight_per_unit),
        cbm_per_unit    = COALESCE($4,  cbm_per_unit),
        category        = COALESCE($5,  category),
        thickness       = COALESCE($6,  thickness),
        size            = COALESCE($7,  size),
        color           = COALESCE($8,  color),
        liner_color     = COALESCE($9,  liner_color),
        roll_weight     = COALESCE($10, roll_weight),
        item_code       = COALESCE($11, item_code),
        shipping_marks  = COALESCE($12, shipping_marks),
        updated_at      = NOW()
      WHERE id = $13 RETURNING *
    `, [description, hsn_code, weight_per_unit, cbm_per_unit, category,
        thickness, size, color, liner_color, roll_weight, item_code, shipping_marks,
        req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'SKU not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[masters/skus PUT]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/skus/:id', protect, authorize('owner', 'manager'), async (req, res) => {
  try {
    const { rows } = await db.query('DELETE FROM skus WHERE id = $1 RETURNING id', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'SKU not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[masters/skus DELETE]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Suppliers ─────────────────────────────────────────────────────────────────

router.get('/suppliers/template', protect, (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="suppliers_template.csv"');
  res.send(SUPPLIER_HEADERS + '\n' + SUPPLIER_EXAMPLE + '\n');
});

router.post('/suppliers/bulk', protect, authorize('owner', 'manager'), uploadMem.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { rows } = parseCSV(req.file.buffer);
  let inserted = 0, updated = 0, errors = [];
  for (const r of rows) {
    if (!r.code || !r.name) { errors.push(`Row skipped — missing code or name`); continue; }
    try {
      const result = await db.query(`
        INSERT INTO suppliers (code, name, country, base_currency, contact_email, contact_phone, payment_terms_days)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (code) DO UPDATE SET
          name               = EXCLUDED.name,
          country            = EXCLUDED.country,
          base_currency      = EXCLUDED.base_currency,
          contact_email      = EXCLUDED.contact_email,
          contact_phone      = EXCLUDED.contact_phone,
          payment_terms_days = EXCLUDED.payment_terms_days,
          updated_at         = NOW()
        RETURNING (xmax = 0) AS inserted
      `, [r.code, r.name, r.country||null, r.base_currency||'USD',
          r.contact_email||null, r.contact_phone||null, parseInt(r.payment_terms_days)||30]);
      result.rows[0].inserted ? inserted++ : updated++;
    } catch (e) { errors.push(`${r.code}: ${e.message}`); }
  }
  res.json({ inserted, updated, errors, total: rows.length });
});

router.get('/suppliers', protect, async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
  const offset = (page - 1) * limit;
  try {
    const { rows: countRows } = await db.query('SELECT COUNT(*) FROM suppliers');
    const total = parseInt(countRows[0].count);
    const { rows } = await db.query('SELECT * FROM suppliers ORDER BY name LIMIT $1 OFFSET $2', [limit, offset]);
    res.json({ suppliers: rows, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[masters/suppliers GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/suppliers', protect, authorize('owner', 'manager'), async (req, res) => {
  const { code, name, country, base_currency, contact_email, contact_phone, payment_terms_days } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'code and name required' });
  try {
    const { rows } = await db.query(`
      INSERT INTO suppliers (code, name, country, base_currency, contact_email, contact_phone, payment_terms_days)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [code, name, country, base_currency || 'USD', contact_email, contact_phone, payment_terms_days || 30]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Supplier code already exists' });
    console.error('[masters/suppliers POST]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/suppliers/:id', protect, authorize('owner', 'manager'), async (req, res) => {
  const { name, country, base_currency, contact_email, contact_phone, payment_terms_days, is_active,
          port, avg_value_usd, ex_rate, duty_percent, expense_inr, target_per_month } = req.body;
  try {
    const { rows } = await db.query(`
      UPDATE suppliers SET
        name               = COALESCE($1,  name),
        country            = COALESCE($2,  country),
        base_currency      = COALESCE($3,  base_currency),
        contact_email      = COALESCE($4,  contact_email),
        contact_phone      = COALESCE($5,  contact_phone),
        payment_terms_days = COALESCE($6,  payment_terms_days),
        is_active          = COALESCE($7,  is_active),
        port               = COALESCE($8,  port),
        avg_value_usd      = COALESCE($9,  avg_value_usd),
        ex_rate            = COALESCE($10, ex_rate),
        duty_percent       = COALESCE($11, duty_percent),
        expense_inr        = COALESCE($12, expense_inr),
        target_per_month   = COALESCE($13, target_per_month),
        updated_at         = NOW()
      WHERE id = $14 RETURNING *
    `, [name, country, base_currency, contact_email, contact_phone, payment_terms_days, is_active,
        port ?? null, avg_value_usd ?? null, ex_rate ?? null, duty_percent ?? null,
        expense_inr ?? null, target_per_month ?? null, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Supplier not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[masters/suppliers PUT]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/suppliers/:id', protect, authorize('owner', 'manager'), async (req, res) => {
  try {
    const { rows } = await db.query(
      'UPDATE suppliers SET is_active = false WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[masters/suppliers DELETE]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Ports ─────────────────────────────────────────────────────────────────────

router.get('/ports/template', protect, (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="ports_template.csv"');
  res.send(PORT_HEADERS + '\n' + PORT_EXAMPLE + '\n');
});

router.post('/ports/bulk', protect, authorize('owner', 'manager'), uploadMem.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { rows } = parseCSV(req.file.buffer);
  let inserted = 0, updated = 0, errors = [];
  for (const r of rows) {
    if (!r.code || !r.name) { errors.push(`Row skipped — missing code or name`); continue; }
    try {
      const result = await db.query(`
        INSERT INTO ports (code, name, country, port_type)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (code) DO UPDATE SET
          name      = EXCLUDED.name,
          country   = EXCLUDED.country,
          port_type = EXCLUDED.port_type
        RETURNING (xmax = 0) AS inserted
      `, [r.code, r.name, r.country||null, r.port_type||'both']);
      result.rows[0].inserted ? inserted++ : updated++;
    } catch (e) { errors.push(`${r.code}: ${e.message}`); }
  }
  res.json({ inserted, updated, errors, total: rows.length });
});

router.get('/ports', protect, async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
  const offset = (page - 1) * limit;
  try {
    const { rows: countRows } = await db.query('SELECT COUNT(*) FROM ports');
    const total = parseInt(countRows[0].count);
    const { rows } = await db.query('SELECT * FROM ports ORDER BY name LIMIT $1 OFFSET $2', [limit, offset]);
    res.json({ ports: rows, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[masters/ports GET]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/ports', protect, authorize('owner', 'manager'), async (req, res) => {
  const { code, name, country, port_type } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'code and name required' });
  try {
    const { rows } = await db.query(
      'INSERT INTO ports (code, name, country, port_type) VALUES ($1,$2,$3,$4) RETURNING *',
      [code, name, country, port_type || 'both']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Port code already exists' });
    console.error('[masters/ports POST]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/ports/:id', protect, authorize('owner', 'manager'), async (req, res) => {
  const { name, country, port_type } = req.body;
  try {
    const { rows } = await db.query(`
      UPDATE ports SET
        name      = COALESCE($1, name),
        country   = COALESCE($2, country),
        port_type = COALESCE($3, port_type)
      WHERE id = $4 RETURNING *
    `, [name || null, country || null, port_type || null, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Port not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[masters/ports PUT]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/ports/:id', protect, authorize('owner', 'manager'), async (req, res) => {
  try {
    const { rows } = await db.query('DELETE FROM ports WHERE id = $1 RETURNING id', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Port not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[masters/ports DELETE]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
