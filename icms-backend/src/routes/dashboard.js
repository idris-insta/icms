const router  = require('express').Router();
const db      = require('../db');
const protect = require('../middleware/auth');

// GET /api/dashboard/stats
router.get('/stats', protect, async (req, res) => {
  try {
    const [counts, pipeline, recent, byStatus, utilization] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*)                                                       AS total_orders,
          COUNT(*) FILTER (WHERE status NOT IN ('Delivered'))            AS pending_orders,
          (SELECT COUNT(*) FROM suppliers WHERE is_active = true)        AS total_suppliers,
          (SELECT COUNT(*) FROM skus WHERE is_active = true)             AS total_skus
        FROM import_orders
      `),
      db.query(`
        SELECT COALESCE(SUM(total_value), 0) AS pipeline_value
        FROM import_orders WHERE status NOT IN ('Delivered')
      `),
      db.query(`
        SELECT o.po_number, o.status, o.total_value
        FROM import_orders o
        ORDER BY o.created_at DESC LIMIT 5
      `),
      db.query(`
        SELECT status, COUNT(*) AS count
        FROM import_orders
        GROUP BY status
      `),
      db.query(`
        SELECT
          COALESCE(AVG(utilization_percentage), 0)                                 AS avg_utilization,
          COUNT(*) FILTER (WHERE utilization_percentage < 70)                      AS underutilized,
          COUNT(*) FILTER (WHERE utilization_percentage BETWEEN 70 AND 90)         AS optimal,
          COUNT(*) FILTER (WHERE utilization_percentage > 90)                      AS overutilized
        FROM import_orders WHERE status NOT IN ('Delivered')
      `),
    ]);

    const orders_by_status = {};
    byStatus.rows.forEach(r => { orders_by_status[r.status] = parseInt(r.count); });

    res.json({
      ...counts.rows[0],
      pipeline_value: parseFloat(pipeline.rows[0].pipeline_value),
      recent_orders: recent.rows,
      orders_by_status,
      utilization_stats: {
        avg_utilization:  parseFloat(utilization.rows[0].avg_utilization || 0),
        underutilized:    parseInt(utilization.rows[0].underutilized),
        optimal:          parseInt(utilization.rows[0].optimal),
        overutilized:     parseInt(utilization.rows[0].overutilized),
      },
    });
  } catch (err) {
    console.error('[dashboard/stats]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dashboard/financial
router.get('/financial', protect, async (req, res) => {
  try {
    const [paymentSum, balanceDue, fxRows, supplierRows] = await Promise.all([
      db.query(`
        SELECT COALESCE(SUM(amount), 0) AS total_paid, COUNT(*) AS payment_count
        FROM payments
      `),
      db.query(`
        SELECT COALESCE(SUM(o.total_value - COALESCE(p.paid, 0)), 0) AS balance_due
        FROM import_orders o
        LEFT JOIN (
          SELECT order_id, SUM(amount) AS paid FROM payments GROUP BY order_id
        ) p ON o.id = p.order_id
        WHERE o.status NOT IN ('Delivered')
      `),
      db.query(`
        SELECT currency,
          SUM(total_value) AS value,
          COUNT(*)         AS orders
        FROM import_orders WHERE status NOT IN ('Delivered')
        GROUP BY currency
      `),
      db.query(`
        SELECT s.name AS supplier_name, s.base_currency AS currency,
          COALESCE(o_agg.total_orders, 0)::int          AS total_orders,
          COALESCE(o_agg.total_value,  0)               AS total_value,
          COALESCE(p_agg.total_paid,   0)               AS total_paid,
          COALESCE(o_agg.total_value,  0) - COALESCE(p_agg.total_paid, 0) AS balance
        FROM suppliers s
        LEFT JOIN LATERAL (
          SELECT COUNT(id) AS total_orders, COALESCE(SUM(total_value), 0) AS total_value
          FROM import_orders WHERE supplier_id = s.id
        ) o_agg ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(amount), 0) AS total_paid FROM payments WHERE supplier_id = s.id
        ) p_agg ON true
        WHERE s.is_active = true
          AND COALESCE(o_agg.total_value, 0) - COALESCE(p_agg.total_paid, 0) > 0
        ORDER BY balance DESC
      `),
    ]);

    const fx_exposure = {};
    fxRows.rows.forEach(r => {
      fx_exposure[r.currency] = { value: parseFloat(r.value), orders: parseInt(r.orders) };
    });

    res.json({
      payment_summary: {
        total_paid:    parseFloat(paymentSum.rows[0].total_paid),
        balance_due:   parseFloat(balanceDue.rows[0].balance_due),
        payment_count: parseInt(paymentSum.rows[0].payment_count),
      },
      fx_exposure,
      supplier_balances: supplierRows.rows.map(r => ({
        supplier_name: r.supplier_name,
        currency:      r.currency,
        total_orders:  parseInt(r.total_orders),
        total_value:   parseFloat(r.total_value),
        total_paid:    parseFloat(r.total_paid),
        balance:       parseFloat(r.balance),
      })),
    });
  } catch (err) {
    console.error('[dashboard/financial]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/dashboard/logistics
router.get('/logistics', protect, async (req, res) => {
  try {
    const [containerRows, arrivingRows, demurrageRows] = await Promise.all([
      db.query(`
        SELECT container_type,
          COUNT(*)                     AS count,
          AVG(utilization_percentage)  AS avg_utilization,
          SUM(total_weight)            AS total_weight,
          SUM(total_cbm)               AS total_cbm
        FROM import_orders WHERE status NOT IN ('Delivered')
        GROUP BY container_type
      `),
      db.query(`
        SELECT po_number, status, eta
        FROM import_orders
        WHERE eta BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
          AND status NOT IN ('Delivered')
        ORDER BY eta ASC
      `),
      db.query(`
        SELECT po_number, eta AS demurrage_start
        FROM import_orders
        WHERE status = 'Arrived'
          AND eta < CURRENT_DATE - INTERVAL '3 days'
      `),
    ]);

    const container_utilization = {};
    containerRows.rows.forEach(r => {
      container_utilization[r.container_type] = {
        count:            parseInt(r.count),
        avg_utilization:  parseFloat(r.avg_utilization || 0),
        total_weight:     parseFloat(r.total_weight || 0),
        total_cbm:        parseFloat(r.total_cbm || 0),
      };
    });

    res.json({
      container_utilization,
      arriving_soon:    arrivingRows.rows,
      demurrage_alerts: demurrageRows.rows,
    });
  } catch (err) {
    console.error('[dashboard/logistics]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
