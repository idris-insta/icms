const router  = require('express').Router();
const db      = require('../db');
const protect = require('../middleware/auth');

// GET /api/reports/supplier-summary
router.get('/supplier-summary', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        s.name AS supplier, s.base_currency AS currency,
        COALESCE(o_agg.pending_pos,      0)::int AS pending_pos,
        COALESCE(o_agg.pending_value,    0)       AS pending_value,
        COALESCE(o_agg.shipped_pos,      0)::int  AS shipped_pos,
        COALESCE(o_agg.shipped_value,    0)       AS shipped_value,
        COALESCE(o_agg.delivered_value,  0)       AS delivered_value,
        COALESCE(o_agg.total_value,      0) - COALESCE(p_agg.total_paid, 0) AS balance_due
      FROM suppliers s
      LEFT JOIN (
        SELECT supplier_id,
          COUNT(*) FILTER (WHERE status NOT IN ('Shipped','In Transit','Arrived','Delivered')) AS pending_pos,
          COALESCE(SUM(total_value) FILTER (WHERE status NOT IN ('Shipped','In Transit','Arrived','Delivered')), 0) AS pending_value,
          COUNT(*) FILTER (WHERE status IN ('Shipped','In Transit'))                            AS shipped_pos,
          COALESCE(SUM(total_value) FILTER (WHERE status IN ('Shipped','In Transit')), 0)       AS shipped_value,
          COALESCE(SUM(total_value) FILTER (WHERE status = 'Delivered'), 0)                     AS delivered_value,
          COALESCE(SUM(total_value), 0)                                                         AS total_value
        FROM import_orders GROUP BY supplier_id
      ) o_agg ON o_agg.supplier_id = s.id
      LEFT JOIN (
        SELECT supplier_id, COALESCE(SUM(amount), 0) AS total_paid FROM payments GROUP BY supplier_id
      ) p_agg ON p_agg.supplier_id = s.id
      WHERE s.is_active = true
      ORDER BY s.name
    `);
    res.json({ data: rows });
  } catch (err) {
    console.error('[reports/supplier-summary]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
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
  } catch (err) {
    console.error('[reports/containers]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
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
  } catch (err) {
    console.error('[reports/tracking]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
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
  } catch (err) {
    console.error('[reports/variance]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/supplier-scorecard — on-time %, lead time, volume, avg rate
router.get('/supplier-scorecard', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT s.code, s.name,
        COUNT(o.id)::int AS orders,
        COALESCE(SUM(o.total_value),0)::float AS volume_usd,
        COUNT(*) FILTER (WHERE o.status IN ('Delivered','Paid'))::int AS delivered,
        COUNT(*) FILTER (WHERE o.delivered_date IS NOT NULL AND o.eta IS NOT NULL)::int AS measurable,
        COUNT(*) FILTER (WHERE o.delivered_date IS NOT NULL AND o.eta IS NOT NULL AND o.delivered_date <= o.eta)::int AS on_time,
        AVG(o.delivered_date - o.etd) FILTER (WHERE o.delivered_date IS NOT NULL AND o.etd IS NOT NULL)::float AS avg_lead_days,
        AVG(NULLIF(o.usd_rate,0)) FILTER (WHERE o.usd_rate > 0)::float AS avg_usd_rate,
        AVG(COALESCE(o.freight_cost,0)) FILTER (WHERE o.freight_cost > 0)::float AS avg_freight
      FROM suppliers s LEFT JOIN import_orders o ON o.supplier_id = s.id
      WHERE s.is_active = true
      GROUP BY s.id, s.code, s.name HAVING COUNT(o.id) > 0
      ORDER BY volume_usd DESC
    `);
    res.json({ data: rows.map(r => ({
      ...r,
      on_time_pct: r.measurable > 0 ? Math.round(r.on_time / r.measurable * 1000) / 10 : null,
      avg_lead_days: r.avg_lead_days != null ? Math.round(r.avg_lead_days) : null,
    })) });
  } catch (err) { console.error('[reports/supplier-scorecard]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/reports/cycle-time — average days per shipment stage
router.get('/cycle-time', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        AVG(loading_date - created_at::date) FILTER (WHERE loading_date IS NOT NULL)::float AS book_to_load,
        AVG(shipment_date - loading_date) FILTER (WHERE shipment_date IS NOT NULL AND loading_date IS NOT NULL)::float AS load_to_ship,
        AVG(eta - shipment_date) FILTER (WHERE eta IS NOT NULL AND shipment_date IS NOT NULL)::float AS ship_to_arrive,
        AVG(delivered_date - eta) FILTER (WHERE delivered_date IS NOT NULL AND eta IS NOT NULL)::float AS arrive_to_deliver,
        AVG(delivered_date - created_at::date) FILTER (WHERE delivered_date IS NOT NULL)::float AS total_cycle
      FROM import_orders
    `);
    const r = rows[0] || {};
    const rnd = (v) => v == null ? null : Math.round(v * 10) / 10;
    res.json({ stages: [
      { stage: 'Booking → Loading',   days: rnd(r.book_to_load) },
      { stage: 'Loading → Shipped',   days: rnd(r.load_to_ship) },
      { stage: 'Shipped → Arrived',   days: rnd(r.ship_to_arrive) },
      { stage: 'Arrived → Delivered', days: rnd(r.arrive_to_deliver) },
    ], total_cycle: rnd(r.total_cycle) });
  } catch (err) { console.error('[reports/cycle-time]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/reports/fx-impact — delivery-vs-payment FX gain/loss per order + total
router.get('/fx-impact', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT o.po_number, s.name AS supplier, o.status,
        (o.total_value + COALESCE(o.freight_cost,0) + COALESCE(o.insurance_cost,0))::float AS cif_usd,
        o.usd_rate_delivery::float AS rate_delivery,
        (SELECT p.usd_rate FROM payments p WHERE p.order_id = o.id AND p.usd_rate IS NOT NULL
         ORDER BY p.payment_date DESC, p.id DESC LIMIT 1)::float AS rate_payment
      FROM import_orders o JOIN suppliers s ON o.supplier_id = s.id
      WHERE o.usd_rate_delivery IS NOT NULL ORDER BY o.po_number
    `);
    let total = 0;
    const data = rows.map(r => {
      const impact = (r.rate_payment && r.rate_delivery)
        ? Math.round((r.rate_payment - r.rate_delivery) * r.cif_usd * 100) / 100 : null;
      if (impact != null) total += impact;
      return { ...r, fx_impact_inr: impact };
    });
    res.json({ data, total_fx_impact_inr: Math.round(total * 100) / 100 });
  } catch (err) { console.error('[reports/fx-impact]', err); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
