const router  = require('express').Router();
const db      = require('../db');
const protect = require('../middleware/auth');

// POST /api/agent/ask — AI assistant over ICMS data.
// Requires ANTHROPIC_API_KEY in .env. Gathers a compact business snapshot and
// asks Claude to answer the user's question grounded in that data.
router.post('/ask', protect, async (req, res) => {
  const { question } = req.body;
  if (!question || typeof question !== 'string' || question.length > 2000) {
    return res.status(400).json({ error: 'question required (max 2000 chars)' });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'AI assistant not configured. Add ANTHROPIC_API_KEY to icms-backend/.env and restart the server.',
    });
  }

  try {
    // Compact data snapshot — enough context without blowing up tokens
    const [orders, alerts, suppliers, payments] = await Promise.all([
      db.query(`
        SELECT o.po_number, s.name AS supplier, o.status, o.container_type,
               o.total_value::float, o.total_quantity, o.etd::date, o.eta::date,
               o.payment_due_date::date, o.bl_number
        FROM import_orders o JOIN suppliers s ON o.supplier_id = s.id
        ORDER BY o.created_at DESC LIMIT 100
      `),
      db.query(`
        SELECT o.po_number, s.name AS supplier, o.payment_due_date::date,
               (o.total_value - COALESCE(p.paid, 0))::float AS balance,
               CASE WHEN o.payment_due_date < CURRENT_DATE THEN 'overdue'
                    WHEN o.payment_due_date <= CURRENT_DATE + 7 THEN 'due_soon'
                    ELSE 'upcoming' END AS alert_type
        FROM import_orders o
        JOIN suppliers s ON o.supplier_id = s.id
        LEFT JOIN (SELECT order_id, SUM(amount) AS paid FROM payments GROUP BY order_id) p ON o.id = p.order_id
        WHERE o.payment_due_date IS NOT NULL AND o.status NOT IN ('Delivered')
          AND o.total_value - COALESCE(p.paid, 0) > 0
        ORDER BY o.payment_due_date LIMIT 50
      `),
      db.query(`
        SELECT s.code, s.name, COALESCE(s.ex_rate,84)::float AS ex_rate,
               COALESCE(s.duty_percent,10)::float AS duty_percent,
               COUNT(o.id)::int AS orders, COALESCE(SUM(o.total_value),0)::float AS total_value
        FROM suppliers s LEFT JOIN import_orders o ON o.supplier_id = s.id
        WHERE s.is_active = true GROUP BY s.id ORDER BY total_value DESC
      `),
      db.query(`
        SELECT p.reference, p.amount::float, p.currency, p.payment_date::date, s.name AS supplier
        FROM payments p JOIN suppliers s ON p.supplier_id = s.id
        ORDER BY p.payment_date DESC LIMIT 30
      `),
    ]);

    const snapshot = {
      today: new Date().toISOString().split('T')[0],
      orders: orders.rows,
      payment_alerts: alerts.rows,
      suppliers: suppliers.rows,
      recent_payments: payments.rows,
    };

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: `You are the ICMS assistant for an import business (insulation materials from overseas suppliers, mainly China). Answer questions about orders, payments, suppliers, and logistics using ONLY the JSON snapshot provided. Amounts are USD unless stated. Be concise and practical; use tables or bullet lists when listing items. If asked to draft an email (e.g. supplier follow-up), write it ready-to-send. If the snapshot lacks the data, say so plainly.\n\nDATA SNAPSHOT:\n${JSON.stringify(snapshot)}`,
        messages: [{ role: 'user', content: question }],
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error('[agent/ask] Anthropic API error', resp.status, errBody);
      return res.status(502).json({ error: 'AI service error — check the API key and try again.' });
    }
    const data = await resp.json();
    const answer = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    res.json({ answer });
  } catch (err) {
    console.error('[agent/ask]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
