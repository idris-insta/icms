// Document scanning: file → text → structured fields.
//
// Text comes from one of two places:
//   • Digital PDF  → pdf-parse reads the embedded text layer (instant, exact).
//   • Image / scan → an Ollama vision model transcribes it (local, private).
//
// Fields are then pulled out by regex rules (reliable for labelled header
// fields like BL no, container no, dates) and — when a text model is
// configured — refined by the LLM for line items.

const db = require('../db');

const { PDFParse } = require('pdf-parse');

// ─── AI config (shared shape with routes/agent.js) ───────────────────────────
async function aiConfig() {
  const { rows } = await db.query("SELECT key, value FROM settings WHERE key LIKE 'ai_%'");
  const s = {}; rows.forEach(r => { s[r.key] = r.value; });
  return {
    provider:     s.ai_provider || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'none'),
    model:        s.ai_model || process.env.ANTHROPIC_MODEL || 'llama3.1',
    visionModel:  s.ai_vision_model || 'llama3.2-vision',
    ollamaUrl:    (s.ai_ollama_url || process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/$/, ''),
    anthropicKey: s.ai_anthropic_key || process.env.ANTHROPIC_API_KEY || '',
  };
}

// List models available on the local Ollama server (empty if unreachable)
async function ollamaModels(url) {
  try {
    const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.models || []).map(m => m.name);
  } catch (_) { return []; }
}

// ─── 1. FILE → TEXT ───────────────────────────────────────────────────────────

const VISION_HINTS = ['vision', 'llava', 'minicpm', 'moondream', 'bakllava', 'qwen2.5vl', 'qwen2-vl'];
const isVision = (name) => VISION_HINTS.some(h => name.toLowerCase().includes(h));

// Transcribe an image with a local Ollama vision model.
async function ocrImage(buffer, cfg) {
  const models = await ollamaModels(cfg.ollamaUrl);
  if (!models.length) {
    const e = new Error(`No Ollama models found at ${cfg.ollamaUrl}. Pull a vision model first: ollama pull llama3.2-vision`);
    e.status = 503; throw e;
  }
  // Prefer the configured vision model, else any vision-capable model present
  const model = models.find(m => m.startsWith(cfg.visionModel)) || models.find(isVision);
  if (!model) {
    const e = new Error(`No vision-capable model on Ollama (found: ${models.join(', ')}). Pull one: ollama pull llama3.2-vision`);
    e.status = 503; throw e;
  }
  let resp;
  try {
    resp = await fetch(`${cfg.ollamaUrl}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(180000), // vision on CPU is slow
      body: JSON.stringify({
        model, stream: false,
        messages: [{
          role: 'user',
          content: 'Transcribe every piece of text in this shipping document exactly as it appears, preserving line breaks and table layout. Output only the transcription, no commentary.',
          images: [buffer.toString('base64')],
        }],
      }),
    });
  } catch (err) {
    const e = new Error(`Cannot reach Ollama at ${cfg.ollamaUrl} (${err.name === 'TimeoutError' ? 'timed out — large image or slow CPU' : 'connection failed'})`);
    e.status = 502; throw e;
  }
  if (!resp.ok) { const e = new Error(`Ollama vision error ${resp.status}`); e.status = 502; throw e; }
  const data = await resp.json();
  return { text: (data.message && data.message.content) || '', source: `ollama:${model}` };
}

// Pull text out of an uploaded file, whichever way works for its type.
async function extractText(buffer, mimetype, filename = '') {
  const cfg = await aiConfig();
  const isPdf = mimetype === 'application/pdf' || /\.pdf$/i.test(filename);

  if (isPdf) {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      let text = '';
      try { text = (await parser.getText()).text || ''; } catch (_) { text = ''; }

      // A digital PDF carries its own text — nothing to OCR.
      if (text.replace(/\s/g, '').length >= 40) return { text, source: 'pdf-text-layer' };

      // Otherwise the page is a picture: rasterise it and read it with vision.
      let shot = null;
      try { shot = await parser.getScreenshot({ pages: [1] }); } catch (_) {}
      const png = shot && (shot.pages || [])[0] && ((shot.pages[0].data) || (shot.pages[0].dataUrl));
      if (png) {
        const b64 = String(png).startsWith('data:') ? String(png).split(',')[1] : null;
        const imgBuf = b64 ? Buffer.from(b64, 'base64') : Buffer.from(png);
        const r = await ocrImage(imgBuf, cfg);
        return { text: r.text, source: 'pdf-scan+' + r.source };
      }
      const e = new Error('This PDF is a scan with no text layer and the page could not be rasterised. Save the page as PNG/JPG and upload that instead.');
      e.status = 422; throw e;
    } finally {
      try { await parser.destroy(); } catch (_) {}
    }
  }

  if (mimetype.startsWith('image/')) return ocrImage(buffer, cfg);

  const e = new Error(`Cannot read text from ${mimetype}. Upload a PDF or an image.`);
  e.status = 415; throw e;
}

// ─── 2. TEXT → FIELDS (regex rules — no AI needed) ────────────────────────────

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Find the value that follows a label, e.g. "B/L NO : ABCD1234"
function afterLabel(text, labels, valuePattern = '[A-Z0-9][A-Z0-9\\-\\/ .]{2,40}') {
  for (const label of labels) {
    const re = new RegExp(label + '\\s*[:.#-]?\\s*(' + valuePattern + ')', 'i');
    const m = text.match(re);
    if (m && m[1]) {
      const v = clean(m[1]);
      if (v && !/^(no|number|date)$/i.test(v)) return v;
    }
  }
  return null;
}

// Normalise the many date spellings on shipping docs to YYYY-MM-DD
const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
function normDate(raw) {
  if (!raw) return null;
  const s = clean(raw);
  let m = s.match(/\b(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);           // 2026-01-31
  if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  m = s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})\b/);               // 31/01/2026 (day first)
  if (m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  m = s.match(/\b(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]*(\d{4})\b/);  // 31-JAN-2026
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  m = s.match(/\b([A-Za-z]{3})[A-Za-z]*[-\s]+(\d{1,2})[-\s,]+(\d{4})\b/); // JAN 31, 2026
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
  return null;
}
const dateAfter = (text, labels) => normDate(afterLabel(text, labels, '[A-Za-z0-9][A-Za-z0-9,\\-\\/. ]{6,24}'));

const num = (raw) => {
  if (!raw) return null;
  const n = parseFloat(String(raw).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
};
// Amounts are often written "USD 41,116.00" or "$ 41,116.00" — skip any
// currency prefix before the digits.
const numAfter = (text, labels) =>
  num(afterLabel(text, labels, '(?:USD|EUR|CNY|RMB|INR|GBP|AED|\\$|₹|€)?\\s*[0-9][0-9,. ]{0,18}')
        ?.replace(/^(?:USD|EUR|CNY|RMB|INR|GBP|AED|\$|₹|€)\s*/i, ''));

// Container numbers follow ISO 6346: 4 letters (last is U/J/Z) + 7 digits
function containerNumbers(text) {
  const out = [];
  const re = /\b([A-Z]{3}[UJZ])[\s-]?(\d{6})[\s-]?(\d)\b/g;
  let m;
  while ((m = re.exec(text.toUpperCase())) !== null) {
    const c = m[1] + m[2] + m[3];
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

// Pull the header fields that matter, per document type.
function parseFields(text, docType = '') {
  const T = text.replace(/\r/g, '');
  const U = T.toUpperCase();
  const f = {};

  const bl = afterLabel(U, ['B\\s*/?\\s*L\\s*(?:NO|NUMBER)', 'BILL OF LADING\\s*(?:NO|NUMBER)', 'BL\\s*(?:NO|NUMBER)', 'DOCUMENT\\s*NO'], '[A-Z0-9][A-Z0-9\\-\\/]{4,25}');
  if (bl) f.bl_number = bl;

  const inv = afterLabel(U, ['INVOICE\\s*(?:NO|NUMBER)', 'INV\\s*(?:NO|NUMBER)', 'PROFORMA\\s*(?:NO|NUMBER)', 'PI\\s*NO'], '[A-Z0-9][A-Z0-9\\-\\/]{2,25}');
  if (inv) f.invoice_number = inv;

  const vessel = afterLabel(U, ['OCEAN\\s*VESSEL', 'VESSEL\\s*(?:\\/\\s*VOYAGE|NAME)?', 'SHIP\\s*NAME'], '[A-Z0-9][A-Z0-9\\-\\/. ]{2,35}');
  if (vessel) f.vessel = vessel;

  const pol = afterLabel(U, ['PORT OF LOADING', 'POL', 'LOADING PORT'], '[A-Z][A-Z\\-, ]{2,30}');
  if (pol) f.port_of_loading = pol;
  const pod = afterLabel(U, ['PORT OF DISCHARGE', 'POD', 'DISCHARGE PORT', 'PORT OF DELIVERY'], '[A-Z][A-Z\\-, ]{2,30}');
  if (pod) f.port_of_discharge = pod;

  const etd = dateAfter(U, ['ETD', 'DATE OF (?:SHIPMENT|DEPARTURE)', 'SAILING DATE', 'SHIPPED ON BOARD', 'ON BOARD DATE']);
  if (etd) f.etd = etd;
  const eta = dateAfter(U, ['ETA', 'ESTIMATED (?:TIME OF )?ARRIVAL', 'ARRIVAL DATE']);
  if (eta) f.eta = eta;
  const idate = dateAfter(U, ['INVOICE DATE', 'DATE OF ISSUE', 'ISSUE DATE']);
  if (idate) f.invoice_date = idate;

  const containers = containerNumbers(T);
  if (containers.length) { f.container_numbers = containers; f.container_no = containers[0]; }

  const seal = afterLabel(U, ['SEAL\\s*(?:NO|NUMBER)?'], '[A-Z0-9][A-Z0-9\\-]{3,20}');
  if (seal) f.seal_number = seal;

  const gw = numAfter(U, ['GROSS\\s*WEIGHT', 'G\\.?W\\.?', 'TOTAL\\s*WEIGHT']);
  if (gw) f.gross_weight_kg = gw;
  const cbm = numAfter(U, ['MEASUREMENT', 'TOTAL\\s*CBM', 'CBM', 'VOLUME']);
  if (cbm) f.cbm = cbm;
  const ctn = numAfter(U, ['TOTAL\\s*(?:CARTONS|CTNS?|PACKAGES)', 'NO\\.? OF (?:CARTONS|PACKAGES)']);
  if (ctn) f.total_cartons = ctn;

  const total = numAfter(U, ['GRAND\\s*TOTAL', 'TOTAL\\s*AMOUNT', 'TOTAL\\s*VALUE', 'AMOUNT\\s*(?:USD|IN USD)?']);
  if (total) f.total_amount = total;

  const cur = U.match(/\b(USD|EUR|CNY|RMB|INR|GBP|AED)\b/);
  if (cur) f.currency = cur[1] === 'RMB' ? 'CNY' : cur[1];

  const terms = U.match(/\b(FOB|CIF|CFR|EXW|DDP|DAP|FCA)\b/);
  if (terms) f.incoterm = terms[1];

  return f;
}

// ─── 3. AI refinement (line items) — only when a text model is configured ─────
async function aiFields(text, docType, cfg) {
  if (cfg.provider === 'none') return null;

  const prompt = `Extract structured data from this ${docType || 'shipping'} document.
Reply with ONLY minified JSON, no prose, no code fences, using this shape:
{"bl_number":"","invoice_number":"","vessel":"","etd":"","eta":"","container_no":"","seal_number":"","port_of_loading":"","port_of_discharge":"","currency":"","total_amount":0,"gross_weight_kg":0,"cbm":0,"items":[{"item_name":"","brand":"","thickness":"","size":"","total_ctn":0,"total_roll":0,"unit_price":0,"kg_pkg":0,"code":""}]}
Use "" or 0 when a value is not present. Dates must be YYYY-MM-DD.

DOCUMENT:
${text.slice(0, 8000)}`;

  let out = '';
  try {
    if (cfg.provider === 'ollama') {
      const r = await fetch(`${cfg.ollamaUrl}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(120000),
        // Reasoning wastes minutes here for no benefit — this is extraction
        // into a fixed JSON shape, not analysis. See the note in routes/agent.js.
        body: JSON.stringify({ model: cfg.model, stream: false, format: 'json',
          think: process.env.AI_THINK === 'true',
          messages: [{ role: 'user', content: prompt }] }),
      });
      if (!r.ok) return null;
      out = ((await r.json()).message || {}).content || '';
    } else {
      if (!cfg.anthropicKey) return null;
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: cfg.model, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!r.ok) return null;
      const d = await r.json();
      out = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    }
    return JSON.parse(out.replace(/```json|```/g, '').trim());
  } catch (_) { return null; }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────
// Rules always run. AI runs when configured and only *fills gaps* — a regex hit
// on a labelled field is trusted over the model's guess.
async function scanDocument(buffer, mimetype, filename, docType) {
  const cfg = await aiConfig();
  const { text, source } = await extractText(buffer, mimetype, filename);
  const fields = parseFields(text, docType);

  let ai = null, items = [];
  const aiOut = await aiFields(text, docType, cfg);
  if (aiOut) {
    ai = true;
    for (const [k, v] of Object.entries(aiOut)) {
      if (k === 'items') continue;
      if (v === '' || v === 0 || v == null) continue;
      if (fields[k] == null) fields[k] = k.match(/etd|eta|date/) ? (normDate(v) || v) : v;
    }
    if (Array.isArray(aiOut.items)) items = aiOut.items.filter(i => i && i.item_name);
  }

  return {
    fields, items,
    text_preview: text.slice(0, 1200),
    text_length: text.length,
    source,                              // where the text came from
    ai_used: !!ai,                       // whether the model refined it
    ai_provider: cfg.provider,
  };
}

module.exports = { scanDocument, extractText, parseFields, normDate, containerNumbers };
