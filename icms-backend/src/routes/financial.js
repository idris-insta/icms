const router    = require('express').Router();
const db        = require('../db');
const protect   = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// GET /api/financial/payments — payments made + payments due
router.get('/payments', protect, async (req, res) => {
  try {
    const [made, due] = await Promise.all([
      db.query(`
        SELECT p.id, p.reference, p.amount, p.currency, p.payment_date, p.payment_type, p.notes,
               o.po_number, s.name AS supplier_name
        FROM payments p
        JOIN import_orders o ON p.order_id = o.id
        JOIN suppliers s ON p.supplier_id = s.id
        ORDER BY p.payment_date DESC
      `),
      db.query(`
        SELECT o.id, o.po_number, s.name AS supplier,
               o.total_value - COALESCE(p.paid, 0) AS balance,
               o.payment_due_date                   AS due_date,
               o.payment_due_date < CURRENT_DATE    AS is_overdue
        FROM import_orders o
        JOIN suppliers s ON o.supplier_id = s.id
        LEFT JOIN (
          SELECT order_id, SUM(amount) AS paid FROM payments GROUP BY order_id
        ) p ON o.id = p.order_id
        WHERE o.status NOT IN ('Delivered')
          AND o.payment_due_date IS NOT NULL
          AND o.total_value - COALESCE(p.paid, 0) > 0
        ORDER BY due_date ASC
      `),
    ]);
    res.json({ payments_made: made.rows, payments_due: due.rows });
  } catch (err) {
    console.error('[financial/payments]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/financial/payments — record a payment (owner, manager, staff)
router.post('/payments', protect, authorize('owner', 'manager', 'staff'), async (req, res) => {
  const { reference, order_id, supplier_id, amount, currency, payment_date, payment_type, notes } = req.body;
  if (!reference || !order_id || !supplier_id || !amount) {
    return res.status(400).json({ error: 'reference, order_id, supplier_id, amount required' });
  }
  try {
    const { rows } = await db.query(`
      INSERT INTO payments (reference, order_id, supplier_id, amount, currency, payment_date, payment_type, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [reference, order_id, supplier_id, amount, currency || 'USD', payment_date || new Date(), payment_type || 'TT', notes || null]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Payment reference already exists' });
    console.error('[financial/payments POST]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/financial/supplier-accounts — all suppliers with balances
router.get('/supplier-accounts', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT s.id, s.name, s.code, s.base_currency, s.payment_terms_days,
             COUNT(DISTINCT o.id)::int                AS order_count,
             COALESCE(SUM(o.total_value), 0)          AS total_invoiced,
             COALESCE(p_agg.total_paid, 0)            AS total_paid
      FROM suppliers s
      LEFT JOIN import_orders o ON o.supplier_id = s.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(amount), 0) AS total_paid FROM payments WHERE supplier_id = s.id
      ) p_agg ON true
      GROUP BY s.id, s.name, s.code, s.base_currency, s.payment_terms_days, p_agg.total_paid
      ORDER BY total_invoiced DESC NULLS LAST
    `);
    res.json({ accounts: rows.map(r => ({
      ...r,
      outstanding: parseFloat(r.total_invoiced) - parseFloat(r.total_paid),
    }))});
  } catch (err) {
    console.error('[financial/supplier-accounts]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/financial/ledger/:supplier_id — per-supplier ledger
router.get('/ledger/:supplier_id', protect, async (req, res) => {
  const sid = req.params.supplier_id;
  try {
    const [ordRows, payRows] = await Promise.all([
      db.query(`
        SELECT o.id, o.po_number AS ref, o.created_at AS date,
               o.total_value AS debit, 0 AS credit, 'Invoice' AS type,
               o.status, o.bl_number, o.payment_due_date
        FROM import_orders o
        WHERE o.supplier_id = $1 ORDER BY o.created_at
      `, [sid]),
      db.query(`
        SELECT p.id, p.reference AS ref, p.payment_date AS date,
               0 AS debit, p.amount AS credit, p.payment_type AS type,
               NULL AS status, NULL AS bl_number, NULL AS payment_due_date
        FROM payments p
        WHERE p.supplier_id = $1 ORDER BY p.payment_date
      `, [sid]),
    ]);
    // merge + sort + running balance
    const entries = [...ordRows.rows, ...payRows.rows]
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    let balance = 0;
    const ledger = entries.map(e => {
      balance += parseFloat(e.debit) - parseFloat(e.credit);
      return { ...e, balance };
    });
    res.json({ ledger });
  } catch (err) {
    console.error('[financial/ledger]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/financial/due-alerts — payments due soon or overdue
router.get('/due-alerts', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT o.id, o.po_number, o.payment_due_date, o.bl_number,
             s.name AS supplier,
             o.total_value - COALESCE(p.paid, 0) AS balance,
             CASE
               WHEN o.payment_due_date < CURRENT_DATE THEN 'overdue'
               WHEN o.payment_due_date <= CURRENT_DATE + 7 THEN 'due_soon'
               ELSE 'upcoming'
             END AS alert_type,
             (o.payment_due_date - CURRENT_DATE) AS days_remaining
      FROM import_orders o
      JOIN suppliers s ON o.supplier_id = s.id
      LEFT JOIN (
        SELECT order_id, SUM(amount) AS paid FROM payments GROUP BY order_id
      ) p ON o.id = p.order_id
      WHERE o.payment_due_date IS NOT NULL
        AND o.status NOT IN ('Delivered')
        AND o.total_value - COALESCE(p.paid, 0) > 0
      ORDER BY o.payment_due_date ASC
    `);
    res.json({ alerts: rows });
  } catch (err) {
    console.error('[financial/due-alerts]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/financial/payments/:id
router.delete('/payments/:id', protect, authorize('owner', 'manager'), async (req, res) => {
  try {
    const { rows } = await db.query('DELETE FROM payments WHERE id = $1 RETURNING id', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Payment not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[financial/payments DELETE]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
