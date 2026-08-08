const router  = require('express').Router();
const db      = require('../db');
const protect = require('../middleware/auth');

// GET /api/analytics/trends — monthly freight & USD-rate trend from order history
router.get('/trends', protect, async (req, res) => {
  const months = Math.min(parseInt(req.query.months) || 12, 36);
  try {
    const { rows } = await db.query(`
      WITH base AS (
        SELECT date_trunc('month', COALESCE(etd, created_at)) AS m,
               COALESCE(freight_cost,0)::float AS freight,
               COALESCE(total_cbm,0)::float    AS cbm,
               COALESCE(usd_rate,0)::float     AS usd_rate
        FROM import_orders
        WHERE COALESCE(etd, created_at) >= (CURRENT_DATE - INTERVAL '${months} months')
      )
      SELECT to_char(m,'YYYY-MM') AS month,
             COUNT(*)::int AS orders,
             ROUND(AVG(NULLIF(freight,0))::numeric, 2)::float  AS avg_freight,
             ROUND(SUM(freight)::numeric, 2)::float            AS total_freight,
             ROUND(AVG(NULLIF(usd_rate,0))::numeric, 4)::float AS avg_usd_rate,
             ROUND((SUM(freight) / NULLIF(SUM(cbm),0))::numeric, 2)::float AS freight_per_cbm
      FROM base GROUP BY m ORDER BY m ASC
    `);
    res.json({ trends: rows });
  } catch (err) { console.error('[analytics/trends]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/analytics/price-forecast — per-item price trend + projected next price
router.get('/price-forecast', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT oi.item_name, oi.thickness, oi.size, COUNT(*)::int AS n,
             (array_agg(oi.unit_price ORDER BY o.created_at))[1]::float      AS first_price,
             (array_agg(oi.unit_price ORDER BY o.created_at DESC))[1]::float AS last_price,
             (array_agg(o.created_at  ORDER BY o.created_at DESC))[1]        AS last_date,
             MIN(oi.unit_price)::float AS min_price, MAX(oi.unit_price)::float AS max_price
      FROM order_items oi JOIN import_orders o ON oi.order_id = o.id
      WHERE oi.unit_price > 0 AND oi.item_name <> ''
      GROUP BY oi.item_name, oi.thickness, oi.size
      ORDER BY n DESC, last_date DESC
    `);
    const data = rows.map(r => {
      const step = r.n > 1 ? (r.last_price - r.first_price) / (r.n - 1) : 0;
      const pct = r.first_price > 0 ? Math.round((r.last_price - r.first_price) / r.first_price * 1000) / 10 : 0;
      return {
        ...r,
        projected_next: Math.round((r.last_price + step) * 10000) / 10000,
        change_pct: pct,
        direction: step > 0.0001 ? 'up' : step < -0.0001 ? 'down' : 'flat',
      };
    });
    res.json({ data });
  } catch (err) { console.error('[analytics/price-forecast]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/analytics/predict-eta — supplier transit averages → predicted arrival
router.get('/predict-eta', protect, async (req, res) => {
  try {
    const [trans, active] = await Promise.all([
      db.query(`SELECT s.code, s.name, AVG(o.eta::date - o.shipment_date::date)::float AS avg_transit_days,
                  COUNT(*)::int AS samples
                FROM import_orders o JOIN suppliers s ON o.supplier_id = s.id
                WHERE o.eta IS NOT NULL AND o.shipment_date IS NOT NULL AND o.eta >= o.shipment_date
                GROUP BY s.id, s.code, s.name ORDER BY s.name`),
      db.query(`SELECT o.po_number, s.name AS supplier, o.shipment_date::date, o.eta::date AS booked_eta
                FROM import_orders o JOIN suppliers s ON o.supplier_id = s.id
                WHERE o.status IN ('Shipped','In Transit') AND o.shipment_date IS NOT NULL`),
    ]);
    const avgBy = {}; trans.rows.forEach(r => { avgBy[r.name] = r.avg_transit_days; });
    const predictions = active.rows.map(o => {
      const days = avgBy[o.supplier] != null ? Math.round(avgBy[o.supplier]) : null;
      let predicted = null;
      if (days != null) { const d = new Date(o.shipment_date); d.setDate(d.getDate() + days); predicted = d.toISOString().slice(0, 10); }
      return {
        po_number: o.po_number, supplier: o.supplier,
        shipment_date: String(o.shipment_date).slice(0, 10),
        booked_eta: o.booked_eta ? String(o.booked_eta).slice(0, 10) : null,
        predicted_eta: predicted, transit_days: days,
      };
    });
    res.json({
      suppliers: trans.rows.map(r => ({ ...r, avg_transit_days: r.avg_transit_days != null ? Math.round(r.avg_transit_days * 10) / 10 : null })),
      predictions,
    });
  } catch (err) { console.error('[analytics/predict-eta]', err); res.status(500).json({ error: 'Internal server error' }); }
});

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
