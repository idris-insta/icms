const router  = require('express').Router();
const db      = require('../db');
const protect = require('../middleware/auth');

// GET /api/reports/supplier-summary
router.get('/supplier-summary', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        s.name AS supplier, s.base_currency AS currency,
        COUNT(o.id) FILTER (WHERE o.status NOT IN ('Shipped','In Transit','Arrived','Delivered')) AS pending_pos,
        COALESCE(SUM(o.total_value) FILTER (WHERE o.status NOT IN ('Shipped','In Transit','Arrived','Delivered')), 0) AS pending_value,
        COUNT(o.id) FILTER (WHERE o.status IN ('Shipped','In Transit'))  AS shipped_pos,
        COALESCE(SUM(o.total_value) FILTER (WHERE o.status IN ('Shipped','In Transit')), 0)  AS shipped_value,
        COALESCE(SUM(o.total_value) FILTER (WHERE o.status = 'Delivered'), 0) AS delivered_value,
        COALESCE(SUM(o.total_value), 0) - COALESCE(SUM(p.amount), 0)    AS balance_due
      FROM suppliers s
      LEFT JOIN import_orders o ON o.supplier_id = s.id
      LEFT JOIN payments p ON p.supplier_id = s.id
      WHERE s.is_active = true
      GROUP BY s.id, s.name, s.base_currency
      ORDER BY s.name
    `);
    res.json({ data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/containers
router.get('/containers', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        o.container_type,
        COUNT(*)                         AS total_containers,
        AVG(o.utilization_percentage)    AS avg_utilization,
        SUM(o.total_weight)              AS total_weight,
        SUM(o.total_cbm)                 AS total_cbm,
        SUM(o.total_value)               AS total_value
      FROM import_orders o
      WHERE o.status NOT IN ('Delivered')
      GROUP BY o.container_type
      ORDER BY o.container_type
    `);
    res.json({ data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/tracking
router.get('/tracking', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT o.po_number, s.name AS supplier, o.container_type,
             o.status, o.eta, o.total_value, o.utilization_percentage, o.created_at
      FROM import_orders o
      JOIN suppliers s ON o.supplier_id = s.id
      WHERE o.status NOT IN ('Delivered')
      ORDER BY o.eta ASC NULLS LAST
    `);
    res.json({ data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/variance
router.get('/variance', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        sk.sku_code, sk.description,
        SUM(oi.quantity)                          AS ordered_qty,
        AVG(oi.weight - sk.weight_per_unit * oi.quantity) AS avg_weight_variance,
        AVG(oi.cbm - sk.cbm_per_unit * oi.quantity)       AS avg_cbm_variance
      FROM order_items oi
      JOIN skus sk ON oi.sku_id = sk.id
      GROUP BY sk.id, sk.sku_code, sk.description
      ORDER BY ABS(AVG(oi.weight - sk.weight_per_unit * oi.quantity)) DESC
      LIMIT 20
    `);
    res.json({ data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
