const router    = require('express').Router();
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const db        = require('../db');
const protect   = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const { scanDocument } = require('../services/ocr');

const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
]);

const ALLOWED_EXT = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, unique + path.extname(file.originalname).toLowerCase());
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIME.has(file.mimetype) || !ALLOWED_EXT.has(ext)) {
      return cb(new Error('File type not allowed'));
    }
    cb(null, true);
  },
});

// Scanning keeps the file in memory — it is read, not stored, unless the
// caller also uploads it through /upload.
const scanUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIME.has(file.mimetype) || !ALLOWED_EXT.has(ext)) return cb(new Error('File type not allowed'));
    cb(null, true);
  },
});

// POST /api/documents/scan — read a document and return the fields found in it.
// Body: file (multipart), doc_type (optional hint, e.g. "Bill of Lading").
router.post('/scan', protect, authorize('owner', 'manager', 'staff'), (req, res, next) => {
  scanUpload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 20 MB)' : err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const result = await scanDocument(req.file.buffer, req.file.mimetype, req.file.originalname, req.body.doc_type);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[documents/scan]', err);
    res.status(500).json({ error: 'Could not read this document' });
  }
});

// GET /api/documents/scan-status — what the scanner can do right now (drives the UI)
router.get('/scan-status', protect, async (req, res) => {
  try {
    const { rows } = await db.query("SELECT key, value FROM settings WHERE key LIKE 'ai_%'");
    const s = {}; rows.forEach(r => { s[r.key] = r.value; });
    const url = (s.ai_ollama_url || 'http://localhost:11434').replace(/\/$/, '');
    let models = [];
    try {
      const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2500) });
      if (r.ok) models = ((await r.json()).models || []).map(m => m.name);
    } catch (_) {}
    const hints = ['vision', 'llava', 'minicpm', 'moondream', 'bakllava', 'qwen2.5vl', 'qwen2-vl'];
    res.json({
      pdf_text: true,                                                   // always available
      image_ocr: models.some(m => hints.some(h => m.toLowerCase().includes(h))),
      ai_fields: (s.ai_provider || 'none') !== 'none',
      models,
      ollama_url: url,
    });
  } catch (err) {
    console.error('[documents/scan-status]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/documents?order_id=
router.get('/', protect, async (req, res) => {
  try {
    const { order_id } = req.query;
    let q = `
      SELECT d.*, o.po_number
      FROM documents d
      JOIN import_orders o ON d.order_id = o.id
    `;
    const params = [];
    if (order_id) { params.push(order_id); q += ` WHERE d.order_id = $1`; }
    q += ' ORDER BY d.created_at DESC';
    const { rows } = await db.query(q, params);
    res.json({ documents: rows });
  } catch (err) {
    console.error('[documents/list]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/documents/upload — any authenticated user may upload
router.post('/upload', protect, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { order_id, doc_type } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });
  try {
    const { rows } = await db.query(`
      INSERT INTO documents (order_id, doc_type, filename, original_name, file_path, file_size, mime_type, uploaded_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [order_id, doc_type || 'Other', req.file.filename, req.file.originalname,
        req.file.path, req.file.size, req.file.mimetype, req.user.id]);
    const { rows: doc } = await db.query(`
      SELECT d.*, o.po_number FROM documents d JOIN import_orders o ON d.order_id = o.id WHERE d.id = $1
    `, [rows[0].id]);
    res.status(201).json(doc[0]);
  } catch (err) {
    console.error('[documents/upload]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const uploadDirAbs = path.resolve(uploadDir);
const safeFilePath = (p) => {
  const resolved = path.resolve(p);
  if (!resolved.startsWith(uploadDirAbs + path.sep) && resolved !== uploadDirAbs) return null;
  return resolved;
};

// GET /api/documents/:id/download
router.get('/:id/download', protect, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Document not found' });
    const filePath = safeFilePath(rows[0].file_path);
    if (!filePath) return res.status(403).json({ error: 'Access denied' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
    res.download(filePath, rows[0].original_name);
  } catch (err) {
    console.error('[documents/download]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/documents/:id — owner or manager only
router.delete('/:id', protect, authorize('owner', 'manager'), async (req, res) => {
  try {
    const { rows } = await db.query('DELETE FROM documents WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Document not found' });
    const filePath = safeFilePath(rows[0].file_path);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    console.error('[documents/delete]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
