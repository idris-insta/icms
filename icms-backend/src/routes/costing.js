const router    = require('express').Router();
const db        = require('../db');
const protect   = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// All costing figures are USD-based. INR conversion uses the supplier ex_rate.

// GET /api/costing/containers — per-container (per-order) landed cost breakdown
// Filters: ?supplier_id=, ?status=
router.get('/containers', protect, async (req, res) => {
  const { supplier_id, status } = req.query;
  try {
    const where = [], params = [];
    if (supplier_id) { params.push(parseInt(supplier_id)); where.push(`o.supplier_id = $${params.length}`); }
    if (status && status !== 'All') { params.push(status); where.push(`o.status = $${params.length}`); }
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const { rows } = await db.query(`
      SELECT o.id, o.po_number, o.container_type, o.status, o.marking, o.etd, o.eta,
             s.id AS supplier_id, s.code AS supplier_code, s.name AS supplier,
             COALESCE(s.ex_rate, 84)::float        AS supplier_ex_rate,
             COALESCE(o.usd_rate, s.ex_rate, 84)::float AS usd_rate,
             o.total_quantity, o.total_weight::float AS total_weight, o.total_cbm::float AS total_cbm,
             o.total_value::float                  AS goods_value,
             COALESCE(o.freight_cost, 0)::float    AS freight_cost,
             COALESCE(o.insurance_cost, 0)::float  AS insurance_cost,
             COALESCE(o.duty_rate, 0)::float       AS duty_rate,
             COALESCE(o.cha_charges, 0)::float     AS cha_charges,
             COALESCE(o.extra_charges, 0)::float   AS extra_charges
      FROM import_orders o
      JOIN suppliers s ON o.supplier_id = s.id
      ${clause}
      ORDER BY o.created_at DESC
    `, params);

    // Landed (INR) = (goods + freight + insurance) × USD/INR
    //                + duty + CHA charges + extra charges
    // Duty is computed on the CIF value in INR using duty_rate%.
    const containers = rows.map(r => {
      const cif_usd  = r.goods_value + r.freight_cost + r.insurance_cost;
      const cif_inr  = cif_usd * r.usd_rate;
      const duty_inr = cif_inr * (r.duty_rate / 100);
      const landed_inr = cif_inr + duty_inr + r.cha_charges + r.extra_charges;
      return {
        ...r,
        cif_usd:           round2(cif_usd),
        cif_inr:           round2(cif_inr),
        duty_amount_inr:   round2(duty_inr),
        landed_cost_inr:   round2(landed_inr),
        landed_per_roll_inr: r.total_quantity > 0 ? round2(landed_inr / r.total_quantity) : 0,
        landed_per_kg_inr:   r.total_weight   > 0 ? round2(landed_inr / r.total_weight)   : 0,
        landed_per_cbm_inr:  r.total_cbm      > 0 ? round2(landed_inr / r.total_cbm)      : 0,
        cp_factor:         r.goods_value    > 0 ? round4(landed_inr / r.goods_value)    : 0, // ₹ per $ of goods
      };
    });
    res.json({ containers });
  } catch (err) {
    console.error('[costing/containers]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/costing/containers/:id — edit costing inputs for one order (staff+)
router.patch('/containers/:id', protect, authorize('owner', 'manager', 'staff'), async (req, res) => {
  const b = req.body;
  const nnum = (v) => { if (v === '' || v === undefined || v === null) return null; const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  try {
    const { rows } = await db.query(`
      UPDATE import_orders SET
        usd_rate       = COALESCE($1, usd_rate),
        freight_cost   = COALESCE($2, freight_cost),
        insurance_cost = COALESCE($3, insurance_cost),
        duty_rate      = COALESCE($4, duty_rate),
        cha_charges    = COALESCE($5, cha_charges),
        extra_charges  = COALESCE($6, extra_charges),
        updated_at     = NOW()
      WHERE id = $7
      RETURNING id, usd_rate, freight_cost, insurance_cost, duty_rate, cha_charges, extra_charges
    `, [nnum(b.usd_rate), nnum(b.freight_cost), nnum(b.insurance_cost),
        nnum(b.duty_rate), nnum(b.cha_charges), nnum(b.extra_charges), req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[costing/containers PATCH]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/costing/suppliers — supplier-wise cost aggregates (USD base) + CP ₹
router.get('/suppliers', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT s.id, s.code, s.name, s.base_currency,
             COALESCE(s.ex_rate, 84)::float       AS ex_rate,
             COALESCE(s.duty_percent, 10)::float  AS duty_percent,
             COALESCE(s.expense_inr, 0)::float    AS expense_inr,
             COALESCE(s.avg_value_usd, 0)::float  AS avg_value_usd,
             COUNT(o.id)::int                     AS containers,
             COALESCE(SUM(o.total_value), 0)::float    AS goods_value,
             COALESCE(SUM(o.freight_cost), 0)::float   AS freight_cost,
             COALESCE(SUM(o.insurance_cost), 0)::float AS insurance_cost,
             COALESCE(SUM(o.total_value * COALESCE(o.duty_rate,0) / 100), 0)::float AS duty_amount,
             COALESCE(SUM(o.total_quantity), 0)::int   AS total_rolls,
             COALESCE(SUM(o.total_weight), 0)::float   AS total_kg,
             COALESCE(SUM(o.total_cbm), 0)::float      AS total_cbm
      FROM suppliers s
      LEFT JOIN import_orders o ON o.supplier_id = s.id
      WHERE s.is_active = true
      GROUP BY s.id, s.code, s.name, s.base_currency, s.ex_rate, s.duty_percent, s.expense_inr, s.avg_value_usd
      ORDER BY goods_value DESC
    `);
    const suppliers = rows.map(r => {
      const landed_usd = r.goods_value + r.freight_cost + r.insurance_cost + r.duty_amount;
      const cp_inr = r.avg_value_usd > 0
        ? ((r.avg_value_usd * r.ex_rate * (1 + r.duty_percent / 100)) + r.expense_inr) / r.avg_value_usd
        : 0;
      return {
        ...r,
        landed_cost_usd:        round2(landed_usd),
        avg_landed_per_container: r.containers > 0 ? round2(landed_usd / r.containers) : 0,
        cost_per_roll_usd:      r.total_rolls > 0 ? round4(landed_usd / r.total_rolls) : 0,
        cost_per_kg_usd:        r.total_kg    > 0 ? round4(landed_usd / r.total_kg)    : 0,
        cp_inr:                 round2(cp_inr),
      };
    });
    res.json({ suppliers });
  } catch (err) {
    console.error('[costing/suppliers]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/costing/items — item-wise costing across all orders (USD base)
// Groups by item name + thickness + size. Order-level costs (freight/insurance/duty)
// are allocated to items proportionally by value share.
router.get('/items', protect, async (req, res) => {
  const { supplier_id } = req.query;
  try {
    const params = [];
    let supFilter = '';
    if (supplier_id) { params.push(parseInt(supplier_id)); supFilter = `AND o.supplier_id = $${params.length}`; }
    const { rows } = await db.query(`
      WITH order_costs AS (
        SELECT id,
               total_value::float AS order_value,
               (COALESCE(freight_cost,0) + COALESCE(insurance_cost,0)
                + total_value * COALESCE(duty_rate,0) / 100)::float AS overhead
        FROM import_orders
      )
      SELECT oi.item_name, oi.thickness, oi.size, oi.code,
             s.code AS supplier_code, s.name AS supplier,
             COUNT(DISTINCT o.id)::int            AS orders,
             SUM(oi.total_roll)::int              AS total_rolls,
             SUM(oi.total_ctn)::int               AS total_ctn,
             SUM(oi.total_roll * oi.unit_price)::float AS goods_value,
             MIN(oi.unit_price)::float            AS min_price,
             MAX(oi.unit_price)::float            AS max_price,
             (array_agg(oi.unit_price ORDER BY o.created_at DESC))[1]::float AS last_price,
             (array_agg(o.created_at  ORDER BY o.created_at DESC))[1]        AS last_order_date,
             SUM(
               CASE WHEN oc.order_value > 0
               THEN (oi.total_roll * oi.unit_price) / oc.order_value * oc.overhead
               ELSE 0 END
             )::float AS allocated_overhead
      FROM order_items oi
      JOIN import_orders o ON oi.order_id = o.id
      JOIN order_costs  oc ON oc.id = o.id
      JOIN suppliers    s  ON o.supplier_id = s.id
      WHERE oi.total_roll > 0 ${supFilter}
      GROUP BY oi.item_name, oi.thickness, oi.size, oi.code, s.code, s.name
      ORDER BY goods_value DESC
    `, params);
    const items = rows.map(r => {
      const avg_price  = r.total_rolls > 0 ? r.goods_value / r.total_rolls : 0;
      const landed     = r.goods_value + r.allocated_overhead;
      return {
        ...r,
        avg_price:            round4(avg_price),
        landed_value_usd:     round2(landed),
        landed_per_roll_usd:  r.total_rolls > 0 ? round4(landed / r.total_rolls) : 0,
      };
    });
    res.json({ items });
  } catch (err) {
    console.error('[costing/items]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/costing/price-list — supplier-wise cost price list (latest prices per item)
// ?supplier_id= optional. USD base, with landed INR per roll using supplier CP factors.
router.get('/price-list', protect, async (req, res) => {
  const { supplier_id } = req.query;
  try {
    const params = [];
    let supFilter = '';
    if (supplier_id) { params.push(parseInt(supplier_id)); supFilter = `AND o.supplier_id = $${params.length}`; }
    const { rows } = await db.query(`
      SELECT DISTINCT ON (o.supplier_id, oi.item_name, oi.thickness, oi.size)
             s.id AS supplier_id, s.code AS supplier_code, s.name AS supplier,
             COALESCE(s.ex_rate, 84)::float      AS ex_rate,
             COALESCE(s.duty_percent, 10)::float AS duty_percent,
             oi.item_name, oi.thickness, oi.size, oi.liner_color, oi.code,
             oi.unit_price::float  AS unit_price_usd,
             oi.kg_pkg::float      AS kg_pkg,
             o.po_number           AS last_po,
             o.created_at          AS last_order_date
      FROM order_items oi
      JOIN import_orders o ON oi.order_id = o.id
      JOIN suppliers s     ON o.supplier_id = s.id
      WHERE oi.item_name <> '' AND oi.unit_price > 0 ${supFilter}
      ORDER BY o.supplier_id, oi.item_name, oi.thickness, oi.size, o.created_at DESC
    `, params);
    const price_list = rows.map(r => {
      // landed INR per roll = price × ex_rate × (1 + duty%) — supplier expense is per-container, shown separately
      const landed_inr_per_roll = r.unit_price_usd * r.ex_rate * (1 + r.duty_percent / 100);
      return { ...r, landed_inr_per_roll: round2(landed_inr_per_roll) };
    });
    res.json({ price_list });
  } catch (err) {
    console.error('[costing/price-list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;

module.exports = router;
