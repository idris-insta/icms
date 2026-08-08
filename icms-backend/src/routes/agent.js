const router  = require('express').Router();
const db      = require('../db');
const protect = require('../middleware/auth');

// ─── AI provider config (settings table overrides .env) ───────────────────────
async function aiConfig() {
  const { rows } = await db.query("SELECT key, value FROM settings WHERE key LIKE 'ai_%'");
  const s = {}; rows.forEach(r => { s[r.key] = r.value; });
  const provider = s.ai_provider || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'none');
  return {
    provider,
    model: s.ai_model || process.env.ANTHROPIC_MODEL || (provider === 'ollama' ? 'llama3.1' : 'claude-sonnet-4-6'),
    ollamaUrl: (s.ai_ollama_url || 'http://localhost:11434').replace(/\/$/, ''),
    anthropicKey: s.ai_anthropic_key || process.env.ANTHROPIC_API_KEY || '',
  };
}

// Unified chat call — Anthropic (cloud) or a local Ollama server.
async function callLLM(system, user, maxTokens = 1500) {
  const cfg = await aiConfig();
  if (cfg.provider === 'none') {
    const e = new Error('AI not configured. Open Settings → AI and pick Ollama (local) or add an Anthropic key.');
    e.status = 503; throw e;
  }
  if (cfg.provider === 'ollama') {
    let resp;
    try {
      resp = await fetch(`${cfg.ollamaUrl}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: cfg.model, stream: false,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
      });
    } catch (err) {
      const e = new Error(`Cannot reach Ollama at ${cfg.ollamaUrl}. Is it running? (ollama serve)`);
      e.status = 502; throw e;
    }
    if (!resp.ok) {
      const e = new Error(`Ollama error ${resp.status} — is the model pulled? (ollama pull ${cfg.model})`);
      e.status = 502; throw e;
    }
    const data = await resp.json();
    return (data.message && data.message.content) || '';
  }
  // anthropic
  if (!cfg.anthropicKey) {
    const e = new Error('Anthropic selected but no API key set in Settings → AI.'); e.status = 503; throw e;
  }
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!resp.ok) {
    console.error('[agent] anthropic', resp.status, await resp.text());
    const e = new Error('Anthropic API error — check the API key.'); e.status = 502; throw e;
  }
  const data = await resp.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

// GET /api/agent/status — which provider is active (drives the UI)
router.get('/status', protect, async (req, res) => {
  try {
    const cfg = await aiConfig();
    res.json({ provider: cfg.provider, model: cfg.model, ready: cfg.provider !== 'none' });
  } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
});

// Compact business snapshot shared by the data-aware endpoints
async function getSnapshot() {
  const [orders, alerts, suppliers, payments] = await Promise.all([
    db.query(`SELECT o.po_number, s.name AS supplier, o.status, o.container_type,
                o.total_value::float, o.total_quantity, o.etd::date, o.eta::date,
                o.payment_due_date::date, o.bl_number, o.freight_cost::float, o.usd_rate::float
              FROM import_orders o JOIN suppliers s ON o.supplier_id = s.id
              ORDER BY o.created_at DESC LIMIT 100`),
    db.query(`SELECT o.po_number, s.name AS supplier, o.payment_due_date::date,
                (o.total_value - COALESCE(p.paid,0))::float AS balance
              FROM import_orders o JOIN suppliers s ON o.supplier_id=s.id
              LEFT JOIN (SELECT order_id, SUM(amount) paid FROM payments GROUP BY order_id) p ON o.id=p.order_id
              WHERE o.payment_due_date IS NOT NULL AND o.status NOT IN ('Delivered','Paid')
                AND o.total_value - COALESCE(p.paid,0) > 0
              ORDER BY o.payment_due_date LIMIT 50`),
    db.query(`SELECT s.code, s.name, COALESCE(s.ex_rate,84)::float AS ex_rate,
                COALESCE(s.duty_percent,10)::float AS duty_percent,
                COUNT(o.id)::int AS orders, COALESCE(SUM(o.total_value),0)::float AS total_value,
                AVG(NULLIF(o.freight_cost,0))::float AS avg_freight,
                AVG(NULLIF(o.usd_rate,0))::float AS avg_rate
              FROM suppliers s LEFT JOIN import_orders o ON o.supplier_id=s.id
              WHERE s.is_active=true GROUP BY s.id ORDER BY total_value DESC`),
    db.query(`SELECT p.reference, p.amount::float, p.currency, p.payment_date::date,
                p.usd_rate::float, s.name AS supplier
              FROM payments p JOIN suppliers s ON p.supplier_id=s.id
              ORDER BY p.payment_date DESC LIMIT 30`),
  ]);
  return {
    today: new Date().toISOString().slice(0, 10),
    orders: orders.rows, payment_alerts: alerts.rows,
    suppliers: suppliers.rows, recent_payments: payments.rows,
  };
}

const SYS = 'You are the ICMS assistant for an import business (insulation tapes, sealants and adhesives from China/Taiwan suppliers into India). Answer using ONLY the JSON snapshot provided. Amounts are USD unless stated. Be concise and practical; use tables or bullet lists. You are not a licensed financial advisor — for FX you may give neutral context and trade-offs, never personalised investment advice. If the snapshot lacks the data, say so plainly.';

// POST /api/agent/ask — natural-language Q&A over live data
router.post('/ask', protect, async (req, res) => {
  const { question } = req.body;
  if (!question || typeof question !== 'string' || question.length > 2000) {
    return res.status(400).json({ error: 'question required (max 2000 chars)' });
  }
  try {
    const snap = await getSnapshot();
    const answer = await callLLM(`${SYS}\n\nDATA SNAPSHOT:\n${JSON.stringify(snap)}`, question);
    res.json({ answer });
  } catch (err) { res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); }
});

// POST /api/agent/triage — "what needs action today" with next steps
router.post('/triage', protect, async (req, res) => {
  try {
    const snap = await getSnapshot();
    const answer = await callLLM(`${SYS}\n\nDATA SNAPSHOT:\n${JSON.stringify(snap)}`,
      'Act as my operations manager. From the snapshot list what needs action TODAY — overdue or soon-due payments, late shipments, missing documents, demurrage risk. Group by urgency (Now / This week). For each item give the PO, the issue, and a one-line next step. End with a one-sentence summary.');
    res.json({ answer });
  } catch (err) { res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); }
});

// POST /api/agent/fx-advisor — FX context + supplier negotiation prep
router.post('/fx-advisor', protect, async (req, res) => {
  try {
    const snap = await getSnapshot();
    const answer = await callLLM(`${SYS}\n\nDATA SNAPSHOT:\n${JSON.stringify(snap)}`,
      (req.body && req.body.question) ||
      'Give me (1) FX context: how my average booking USD/INR compares with recent payment rates and what that means for upcoming payables — neutral trade-offs only, no personalised advice; (2) negotiation prep for my top 2 suppliers by value: how their prices, freight and rates compare with the others, plus 3 talking points each.');
    res.json({ answer });
  } catch (err) { res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); }
});

// POST /api/agent/extract — turn pasted PI/invoice text into a draft-order JSON
router.post('/extract', protect, async (req, res) => {
  const { text } = req.body;
  if (!text || text.length < 20) return res.status(400).json({ error: 'Paste the invoice / PI text (min 20 chars)' });
  try {
    const out = await callLLM(
      'You extract purchase data. Reply with ONLY valid minified JSON — no prose, no code fences.',
      `From this supplier invoice / proforma, extract a draft order as JSON with this shape:
{"supplier_name":"","container_type":"","currency":"USD","marking":"","items":[{"item_name":"","brand":"","thickness":"","size":"","liner_color":"","qty_ctn":0,"total_ctn":0,"total_roll":0,"unit_price":0,"price_per_sqm":0,"kg_pkg":0,"code":"","notes":""}]}
Use 0 or empty string when unknown.\n\nINVOICE:\n${text.slice(0, 6000)}`, 2000);
    let parsed = null;
    try { parsed = JSON.parse(out.replace(/```json|```/g, '').trim()); } catch (_) {}
    if (!parsed) return res.status(422).json({ error: 'Could not parse a clean order from that text', raw: out });
    res.json({ draft: parsed });
  } catch (err) { res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); }
});

module.exports = router;
