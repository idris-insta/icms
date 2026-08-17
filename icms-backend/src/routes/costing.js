const router    = require('express').Router();
const https     = require('https');
const db        = require('../db');
const protect   = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// All costing figures are USD-based. INR conversion uses the supplier ex_rate.

// Fetch the live USD→INR rate (cached 1h to avoid hammering upstream).
// The upstream is a free service that occasionally rate-limits or times out;
// a stale cached rate is kept indefinitely so a blip upstream cannot take the
// costing pages down with it.
const FX_TTL_MS = 3600_000;
let _fxCache = null;

function fetchUpstreamRate() {
  return new Promise((resolve, reject) => {
    const req = https.get('https://open.er-api.com/v6/latest/USD', r => {
      if (r.statusCode !== 200) {
        r.resume();
        return reject(new Error(`upstream returned HTTP ${r.statusCode}`));
      }
      let b = ''; r.on('data', c => b += c);
      r.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('upstream timed out')));
  });
}

async function fetchLiveRate() {
  if (_fxCache && Date.now() - _fxCache.fetchedAt < FX_TTL_MS) return _fxCache;
  try {
    const data = await fetchUpstreamRate();
    const rate = data && data.rates && data.rates.INR;
    if (!rate) throw new Error('Live rate unavailable');
    _fxCache = { rate: round4(rate), date: data.time_last_update_utc || null, fetchedAt: Date.now(), stale: false };
    return _fxCache;
  } catch (err) {
    // Serve the last known rate rather than failing the request outright.
    if (_fxCache) {
      console.warn('[fx-rate] upstream failed, serving stale rate:', err.message);
      return { ..._fxCache, stale: true };
    }
    throw err;
  }
}

// GET /api/costing/fx-rate — live USD→INR (no API key required)
router.get('/fx-rate', protect, async (req, res) => {
  const cached = !!(_fxCache && Date.now() - _fxCache.fetchedAt < FX_TTL_MS);
  try {
    const fx = await fetchLiveRate();
    res.json({ rate: fx.rate, date: fx.date, source: 'open.er-api.com', cached, stale: !!fx.stale });
  } catch (err) {
    // Nothing cached and upstream is down — fall back to the configured rate so
    // the UI still has a sensible default to prefill.
    console.error('[fx-rate]', err.message);
    try {
      const { rows } = await db.query("SELECT value FROM settings WHERE key = 'default_usd_rate'");
      const fallback = parseFloat(rows[0] && rows[0].value);
      if (Number.isFinite(fallback) && fallback > 0) {
        return res.json({ rate: fallback, date: null, source: 'settings.default_usd_rate', cached: false, stale: true });
      }
    } catch (_) { /* settings lookup is best-effort */ }
    res.status(502).json({ error: 'Failed to fetch live rate' });
  }
});

// GET /api/costing/fx-drift — live rate vs your CIF-weighted average booking rate
router.get('/fx-drift', protect, async (req, res) => {
  try {
    let live = null;
    try { live = (await fetchLiveRate()).rate; } catch (_) {}
    const { rows } = await db.query(`
      SELECT SUM((total_value + COALESCE(freight_cost,0) + COALESCE(insurance_cost,0)) * COALESCE(usd_rate,0)) AS w,
             SUM(CASE WHEN usd_rate > 0 THEN (total_value + COALESCE(freight_cost,0) + COALESCE(insurance_cost,0)) ELSE 0 END) AS base
      FROM import_orders
    `);
    const avg = rows[0].base > 0 ? rows[0].w / rows[0].base : null;
    const drift_pct = (live && avg) ? round2((live - avg) / avg * 100) : null;
    res.json({ live, avg_booking_rate: avg ? round4(avg) : null, drift_pct });
  } catch (err) {
    console.error('[costing/fx-drift]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
             COALESCE(o.extra_charges, 0)::float   AS extra_charges,
             o.usd_rate_delivery::float            AS usd_rate_delivery,
             (SELECT p.usd_rate FROM payments p WHERE p.order_id = o.id AND p.usd_rate IS NOT NULL
              ORDER BY p.payment_date DESC, p.id DESC LIMIT 1)::float AS usd_rate_payment
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
      // FX impact = (rate at payment − rate at delivery) × CIF USD.
      // Positive = rupee weakened after delivery, so you paid more INR than at delivery.
      const rateDel = r.usd_rate_delivery || r.usd_rate;
      const fx = (r.usd_rate_payment && rateDel) ? (r.usd_rate_payment - rateDel) * cif_usd : null;
      return {
        ...r,
        fx_impact_inr:     fx === null ? null : round2(fx),
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

// GET /api/costing/suppliers — supplier-wise landed cost (INR), same formula as
// container-wise. The blended rate is the CIF-USD-weighted mean of each order's rate
// (dollar cost averaging), so larger shipments pull it toward their booking rate.
// CHA/extra are per-container values summed across that supplier's containers.
router.get('/suppliers', protect, async (req, res) => {
  try {
    const { rows } = await db.query(`
      WITH per_order AS (
        SELECT o.supplier_id, o.total_quantity,
               o.total_weight::float AS total_weight, o.total_cbm::float AS total_cbm,
               o.total_value::float AS goods_value,
               COALESCE(o.freight_cost,0)::float   AS freight_cost,
               COALESCE(o.insurance_cost,0)::float AS insurance_cost,
               COALESCE(o.cha_charges,0)::float    AS cha_charges,
               COALESCE(o.extra_charges,0)::float  AS extra_charges,
               COALESCE(o.duty_rate,0)::float      AS duty_rate,
               COALESCE(o.usd_rate, s.ex_rate, 84)::float AS usd_rate,
               (o.total_value + COALESCE(o.freight_cost,0) + COALESCE(o.insurance_cost,0))::float AS cif_usd
        FROM import_orders o JOIN suppliers s ON o.supplier_id = s.id
      )
      SELECT s.id, s.code, s.name, s.base_currency,
             COALESCE(s.ex_rate, 84)::float AS ex_rate,
             COALESCE(s.duty_percent, 10)::float AS duty_percent,
             COUNT(po.supplier_id)::int                        AS containers,
             COALESCE(SUM(po.goods_value),0)::float            AS goods_value,
             COALESCE(SUM(po.freight_cost),0)::float           AS freight_cost,
             COALESCE(SUM(po.insurance_cost),0)::float         AS insurance_cost,
             COALESCE(SUM(po.cha_charges),0)::float            AS cha_charges,
             COALESCE(SUM(po.extra_charges),0)::float          AS extra_charges,
             COALESCE(SUM(po.cif_usd),0)::float                AS cif_usd,
             COALESCE(SUM(po.cif_usd * po.usd_rate),0)::float  AS cif_inr,
             COALESCE(SUM(po.cif_usd * po.usd_rate * po.duty_rate / 100),0)::float AS duty_amount_inr,
             COALESCE(SUM(po.total_quantity),0)::int           AS total_rolls,
             COALESCE(SUM(po.total_weight),0)::float           AS total_kg,
             COALESCE(SUM(po.total_cbm),0)::float              AS total_cbm
      FROM suppliers s
      LEFT JOIN per_order po ON po.supplier_id = s.id
      WHERE s.is_active = true
      GROUP BY s.id, s.code, s.name, s.base_currency, s.ex_rate, s.duty_percent
      ORDER BY goods_value DESC
    `);
    const suppliers = rows.map(r => {
      const avg_usd_rate = r.cif_usd > 0 ? r.cif_inr / r.cif_usd : r.ex_rate;
      const landed_inr = r.cif_inr + r.duty_amount_inr + r.cha_charges + r.extra_charges;
      return {
        ...r,
        avg_usd_rate:             round4(avg_usd_rate),
        landed_cost_inr:          round2(landed_inr),
        avg_landed_per_container: r.containers > 0 ? round2(landed_inr / r.containers) : 0,
        landed_per_roll_inr:      r.total_rolls > 0 ? round2(landed_inr / r.total_rolls) : 0,
        landed_per_kg_inr:        r.total_kg    > 0 ? round2(landed_inr / r.total_kg)    : 0,
        cp_factor:                r.goods_value > 0 ? round4(landed_inr / r.goods_value) : 0,
      };
    });
    res.json({ suppliers });
  } catch (err) {
    console.error('[costing/suppliers]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/costing/suppliers/:id — edit a supplier's default USD rate / duty (staff+)
router.patch('/suppliers/:id', protect, authorize('owner', 'manager', 'staff'), async (req, res) => {
  const b = req.body;
  const nnum = (v) => { if (v === '' || v === undefined || v === null) return null; const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  try {
    const { rows } = await db.query(`
      UPDATE suppliers SET
        ex_rate      = COALESCE($1, ex_rate),
        duty_percent = COALESCE($2, duty_percent),
        updated_at   = NOW()
      WHERE id = $3 RETURNING id, ex_rate, duty_percent
    `, [nnum(b.ex_rate), nnum(b.duty_percent), req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Supplier not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[costing/suppliers PATCH]', err);
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
        SELECT o.id,
               o.total_value::float AS order_value,
               ((o.total_value + COALESCE(o.freight_cost,0) + COALESCE(o.insurance_cost,0))
                 * COALESCE(o.usd_rate, s.ex_rate, 84)
                 * (1 + COALESCE(o.duty_rate,0)/100)
                 + COALESCE(o.cha_charges,0) + COALESCE(o.extra_charges,0))::float AS landed_inr
        FROM import_orders o JOIN suppliers s ON o.supplier_id = s.id
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
               THEN (oi.total_roll * oi.unit_price) / oc.order_value * oc.landed_inr
               ELSE 0 END
             )::float AS landed_inr
      FROM order_items oi
      JOIN import_orders o ON oi.order_id = o.id
      JOIN order_costs  oc ON oc.id = o.id
      JOIN suppliers    s  ON o.supplier_id = s.id
      WHERE oi.total_roll > 0 ${supFilter}
      GROUP BY oi.item_name, oi.thickness, oi.size, oi.code, s.code, s.name
      ORDER BY goods_value DESC
    `, params);
    const items = rows.map(r => ({
      ...r,
      avg_price:           r.total_rolls > 0 ? round4(r.goods_value / r.total_rolls) : 0,
      landed_value_inr:    round2(r.landed_inr),
      landed_per_roll_inr: r.total_rolls > 0 ? round2(r.landed_inr / r.total_rolls) : 0,
    }));
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
      SELECT * FROM (
      SELECT ROW_NUMBER() OVER (
               PARTITION BY o.supplier_id, oi.item_name, oi.thickness, oi.size
               ORDER BY o.created_at DESC, o.id DESC
             ) AS rn,
             s.id AS supplier_id, s.code AS supplier_code, s.name AS supplier,
             COALESCE(o.usd_rate, s.ex_rate, 84)::float       AS usd_rate,
             COALESCE(o.duty_rate, s.duty_percent, 10)::float AS duty_percent,
             o.total_value::float AS order_goods,
             ((o.total_value + COALESCE(o.freight_cost,0) + COALESCE(o.insurance_cost,0))
               * COALESCE(o.usd_rate, s.ex_rate, 84))::float  AS order_cif_inr,
             COALESCE(o.cha_charges,0)::float   AS cha,
             COALESCE(o.extra_charges,0)::float AS extra,
             oi.item_name, oi.brand, oi.thickness, oi.size, oi.liner_color, oi.code,
             oi.unit_price::float    AS unit_price_usd,
             oi.price_per_sqm::float AS price_per_sqm,
             oi.kg_pkg::float        AS kg_pkg,
             o.po_number             AS last_po,
             o.created_at            AS last_order_date
      FROM order_items oi
      JOIN import_orders o ON oi.order_id = o.id
      JOIN suppliers s     ON o.supplier_id = s.id
      WHERE oi.item_name <> '' AND oi.unit_price > 0 ${supFilter}
      ) ranked
      WHERE rn = 1
      ORDER BY supplier_id, item_name, thickness, size
    `, params);
    const price_list = rows.map(r => {
      // Full landed, same method as container-wise: the roll inherits its latest order's
      // landed uplift per $ of goods, so freight/insurance/duty/CHA/extra are all included.
      const order_landed = r.order_cif_inr * (1 + r.duty_percent / 100) + r.cha + r.extra;
      const cp_ratio = r.order_goods > 0
        ? order_landed / r.order_goods
        : r.usd_rate * (1 + r.duty_percent / 100);
      return {
        ...r,
        usd_rate: round4(r.usd_rate),
        landed_inr_per_roll: round2(r.unit_price_usd * cp_ratio),
        landed_inr_per_sqm:  r.price_per_sqm > 0 ? round2(r.price_per_sqm * cp_ratio) : 0,
      };
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
