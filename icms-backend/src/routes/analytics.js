const router  = require('express').Router();
const db      = require('../db');
const protect = require('../middleware/auth');

// GET /api/analytics/turnover?year=2026
// Supplier-wise + item-wise turnover (USD) and container volume for a year.
router.get('/turnover', protect, async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  try {
    const [bySupplier, byItem, byMonth, topItems] = await Promise.all([
      db.query(`
        SELECT s.code, s.name AS supplier,
               COUNT(o.id)::int                       AS containers,
               COALESCE(SUM(o.total_value),0)::float  AS turnover_usd,
               COALESCE(SUM(o.total_quantity),0)::int AS total_rolls,
               COALESCE(SUM(o.total_cbm),0)::float     AS total_cbm
        FROM suppliers s
        LEFT JOIN import_orders o ON o.supplier_id = s.id AND EXTRACT(YEAR FROM o.created_at) = $1
        GROUP BY s.id, s.code, s.name
        HAVING COUNT(o.id) > 0
        ORDER BY turnover_usd DESC
      `, [year]),
      db.query(`
        SELECT oi.item_name, oi.thickness, oi.size,
               COUNT(DISTINCT o.id)::int               AS orders,
               COALESCE(SUM(oi.total_roll),0)::int     AS rolls,
               COALESCE(SUM(oi.total_ctn),0)::int      AS cartons,
               COALESCE(SUM(oi.total_roll * oi.unit_price),0)::float AS turnover_usd
        FROM order_items oi
        JOIN import_orders o ON oi.order_id = o.id
        WHERE EXTRACT(YEAR FROM o.created_at) = $1 AND oi.item_name <> ''
        GROUP BY oi.item_name, oi.thickness, oi.size
        ORDER BY turnover_usd DESC
        LIMIT 100
      `, [year]),
      db.query(`
        SELECT EXTRACT(MONTH FROM o.created_at)::int AS month,
               COUNT(o.id)::int AS containers,
               COALESCE(SUM(o.total_value),0)::float AS turnover_usd
        FROM import_orders o
        WHERE EXTRACT(YEAR FROM o.created_at) = $1
        GROUP BY month ORDER BY month
      `, [year]),
      db.query(`
        SELECT oi.item_name,
               COALESCE(SUM(oi.total_roll),0)::int AS rolls
        FROM order_items oi
        JOIN import_orders o ON oi.order_id = o.id
        WHERE EXTRACT(YEAR FROM o.created_at) = $1 AND oi.item_name <> ''
        GROUP BY oi.item_name ORDER BY rolls DESC LIMIT 10
      `, [year]),
    ]);

    const months = Array.from({ length: 12 }, (_, i) => {
      const m = byMonth.rows.find(r => r.month === i + 1);
      return { month: i + 1, containers: m?.containers || 0, turnover_usd: m?.turnover_usd || 0 };
    });
    const totals = {
      turnover_usd: bySupplier.rows.reduce((a, r) => a + r.turnover_usd, 0),
      containers:   bySupplier.rows.reduce((a, r) => a + r.containers, 0),
      rolls:        bySupplier.rows.reduce((a, r) => a + r.total_rolls, 0),
    };
    res.json({ year, totals, by_supplier: bySupplier.rows, by_item: byItem.rows, by_month: months, top_volume_items: topItems.rows });
  } catch (err) {
    console.error('[analytics/turnover]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/years — distinct years that have orders
router.get('/years', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT DISTINCT EXTRACT(YEAR FROM created_at)::int AS year FROM import_orders ORDER BY year DESC
    `);
    const years = rows.map(r => r.year);
    if (!years.includes(new Date().getFullYear())) years.unshift(new Date().getFullYear());
    res.json({ years });
  } catch (err) {
    console.error('[analytics/years]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
