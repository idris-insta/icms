const router  = require('express').Router();
const db      = require('../db');
const protect = require('../middleware/auth');

// GET /api/alerts — consolidated automation feed.
// Categories: payment (overdue / due soon), demurrage, stale orders, missing
// documents on shipped orders, containers arriving soon.
router.get('/', protect, async (req, res) => {
  try {
    const [payments, demurrage, stale, missingDocs, arriving, slippage, anomaly] = await Promise.all([
      db.query(`
        SELECT o.id, o.po_number, s.name AS supplier, o.payment_due_date::date AS due_date,
               (o.total_value - COALESCE(p.paid, 0))::float AS balance,
               (o.payment_due_date - CURRENT_DATE)          AS days_remaining
        FROM import_orders o
        JOIN suppliers s ON o.supplier_id = s.id
        LEFT JOIN (SELECT order_id, SUM(amount) AS paid FROM payments GROUP BY order_id) p ON o.id = p.order_id
        WHERE o.payment_due_date IS NOT NULL AND o.status NOT IN ('Delivered')
          AND o.total_value - COALESCE(p.paid, 0) > 0
          AND o.payment_due_date <= CURRENT_DATE + 14
        ORDER BY o.payment_due_date
      `),
      db.query(`
        SELECT o.id, o.po_number, s.name AS supplier, o.eta::date, o.free_days,
               COALESCE(o.demurrage_rate, 0)::float AS demurrage_rate,
               GREATEST(0, (COALESCE(o.container_returned_date, CURRENT_DATE) - o.eta::date) - COALESCE(o.free_days, 7)) AS over_days
        FROM import_orders o
        JOIN suppliers s ON o.supplier_id = s.id
        WHERE o.eta IS NOT NULL
          AND o.status IN ('Arrived','Customs Clearance','Cleared')
          AND o.container_returned_date IS NULL
          AND (CURRENT_DATE - o.eta::date) > COALESCE(o.free_days, 7) - 2
        ORDER BY over_days DESC
      `),
      db.query(`
        SELECT o.id, o.po_number, s.name AS supplier, o.status,
               (CURRENT_DATE - o.updated_at::date) AS days_idle
        FROM import_orders o
        JOIN suppliers s ON o.supplier_id = s.id
        WHERE o.status NOT IN ('Delivered')
          AND o.updated_at < CURRENT_DATE - 14
        ORDER BY o.updated_at
        LIMIT 30
      `),
      db.query(`
        SELECT o.id, o.po_number, s.name AS supplier, o.status,
               COALESCE(o.doc_checklist, '{}')::jsonb AS doc_checklist
        FROM import_orders o
        JOIN suppliers s ON o.supplier_id = s.id
        WHERE o.status IN ('Shipped','In Transit','Arrived','Customs Clearance')
        ORDER BY o.eta NULLS LAST
      `),
      db.query(`
        SELECT o.id, o.po_number, s.name AS supplier, o.eta::date, o.container_type,
               (o.eta::date - CURRENT_DATE) AS days_to_eta
        FROM import_orders o
        JOIN suppliers s ON o.supplier_id = s.id
        WHERE o.eta IS NOT NULL AND o.status IN ('Shipped','In Transit')
          AND o.eta::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
        ORDER BY o.eta
      `),
      db.query(`
        SELECT o.id, o.po_number, s.name AS supplier, o.status,
               CASE WHEN o.status IN ('Confirmed','Loaded') THEN 'etd' ELSE 'eta' END AS kind,
               CASE WHEN o.status IN ('Confirmed','Loaded') THEN (CURRENT_DATE - o.etd::date)
                    ELSE (CURRENT_DATE - o.eta::date) END AS days_late
        FROM import_orders o JOIN suppliers s ON o.supplier_id = s.id
        WHERE (o.status IN ('Confirmed','Loaded') AND o.etd IS NOT NULL AND o.etd::date < CURRENT_DATE)
           OR (o.status IN ('Shipped','In Transit') AND o.eta IS NOT NULL AND o.eta::date < CURRENT_DATE)
        ORDER BY days_late DESC LIMIT 30
      `),
      db.query(`
        WITH avg_f AS (
          SELECT supplier_id, AVG(NULLIF(freight_cost,0)) AS af
          FROM import_orders WHERE freight_cost > 0 GROUP BY supplier_id HAVING COUNT(*) >= 2
        )
        SELECT o.id, o.po_number, s.name AS supplier,
               o.freight_cost::float AS freight, af.af::float AS avg_freight
        FROM import_orders o JOIN suppliers s ON o.supplier_id = s.id
        JOIN avg_f af ON af.supplier_id = o.supplier_id
        WHERE o.freight_cost > af.af * 1.4 AND o.status NOT IN ('Delivered','Paid')
        ORDER BY (o.freight_cost / af.af) DESC LIMIT 20
      `),
    ]);

    const REQUIRED_DOCS = ['Bill of Lading', 'Commercial Invoice', 'Packing List'];
    const alerts = [];

    for (const r of payments.rows) {
      alerts.push({
        type: 'payment', severity: r.days_remaining < 0 ? 'critical' : 'warning',
        order_id: r.id, po_number: r.po_number, supplier: r.supplier,
        title: r.days_remaining < 0
          ? `Payment overdue by ${-r.days_remaining}d — ${fmtUsd(r.balance)}`
          : `Payment due in ${r.days_remaining}d — ${fmtUsd(r.balance)}`,
        date: r.due_date,
      });
    }
    for (const r of demurrage.rows) {
      alerts.push({
        type: 'demurrage', severity: r.over_days > 0 ? 'critical' : 'warning',
        order_id: r.id, po_number: r.po_number, supplier: r.supplier,
        title: r.over_days > 0
          ? `Demurrage running: ${r.over_days}d over free period${r.demurrage_rate ? ` (~${fmtUsd(r.over_days * r.demurrage_rate)})` : ''} — return container`
          : `Container nearing end of free days — plan return`,
        date: r.eta,
      });
    }
    for (const r of stale.rows) {
      alerts.push({
        type: 'stale', severity: 'info',
        order_id: r.id, po_number: r.po_number, supplier: r.supplier,
        title: `No activity for ${r.days_idle}d (status: ${r.status}) — follow up`,
      });
    }
    for (const r of missingDocs.rows) {
      const missing = REQUIRED_DOCS.filter(d => !r.doc_checklist?.[d]);
      if (missing.length) {
        alerts.push({
          type: 'docs', severity: 'warning',
          order_id: r.id, po_number: r.po_number, supplier: r.supplier,
          title: `Missing documents (${r.status}): ${missing.join(', ')}`,
        });
      }
    }
    for (const r of arriving.rows) {
      alerts.push({
        type: 'arrival', severity: 'info',
        order_id: r.id, po_number: r.po_number, supplier: r.supplier,
        title: `${r.container_type} arriving in ${r.days_to_eta}d — prepare customs/CHA`,
        date: r.eta,
      });
    }

    for (const r of slippage.rows) {
      alerts.push({
        type: 'slippage', severity: r.days_late > 7 ? 'critical' : 'warning',
        order_id: r.id, po_number: r.po_number, supplier: r.supplier,
        title: r.kind === 'etd'
          ? `Departure overdue ${r.days_late}d (still ${r.status}) — chase supplier/loading`
          : `Arrival overdue ${r.days_late}d (still ${r.status}) — check vessel/ETA`,
      });
    }
    for (const r of anomaly.rows) {
      alerts.push({
        type: 'anomaly', severity: 'warning',
        order_id: r.id, po_number: r.po_number, supplier: r.supplier,
        title: `Freight ${fmtUsd(r.freight)} is ${Math.round((r.freight / r.avg_freight - 1) * 100)}% above ${r.supplier} average (${fmtUsd(r.avg_freight)}) — verify`,
      });
    }

    const rank = { critical: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
    res.json({
      alerts,
      counts: {
        critical: alerts.filter(a => a.severity === 'critical').length,
        warning:  alerts.filter(a => a.severity === 'warning').length,
        info:     alerts.filter(a => a.severity === 'info').length,
        total:    alerts.length,
      },
    });
  } catch (err) {
    console.error('[alerts]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const fmtUsd = (n) => '$' + (parseFloat(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

// GET /api/alerts/digest — weekly snapshot: shipping, arriving, payables, exceptions
router.get('/digest', protect, async (req, res) => {
  try {
    const [ship, arrive, pay, exc] = await Promise.all([
      db.query(`SELECT COUNT(*)::int n, COALESCE(SUM(total_value),0)::float v FROM import_orders
                WHERE status IN ('Confirmed','Loaded') AND etd::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7`),
      db.query(`SELECT COUNT(*)::int n FROM import_orders
                WHERE status IN ('Shipped','In Transit') AND eta::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7`),
      db.query(`SELECT COUNT(*)::int n,
                  COALESCE(SUM(total_value - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.order_id=o.id),0)),0)::float v
                FROM import_orders o
                WHERE payment_due_date IS NOT NULL AND payment_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
                  AND total_value - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.order_id=o.id),0) > 0.5`),
      db.query(`SELECT
                  COUNT(*) FILTER (WHERE status NOT IN ('Delivered','Paid','Draft') AND updated_at < CURRENT_DATE - 14)::int AS stale,
                  COUNT(*) FILTER (WHERE status IN ('Shipped','In Transit') AND eta::date < CURRENT_DATE)::int AS late
                FROM import_orders`),
    ]);
    res.json({
      week_of: new Date().toISOString().slice(0, 10),
      shipping_this_week: ship.rows[0],
      arriving_this_week: arrive.rows[0].n,
      payables_due_week: pay.rows[0],
      stale_orders: exc.rows[0].stale,
      late_arrivals: exc.rows[0].late,
    });
  } catch (err) {
    console.error('[alerts/digest]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
