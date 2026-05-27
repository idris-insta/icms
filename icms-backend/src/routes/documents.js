const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const db      = require('../db');
const protect = require('../middleware/auth');

const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20 MB

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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/documents/upload
router.post('/upload', protect, upload.single('file'), async (req, res) => {
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/documents/:id/download
router.get('/:id/download', protect, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Document not found' });
    const filePath = path.resolve(rows[0].file_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });
    res.download(filePath, rows[0].original_name);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/documents/:id
router.delete('/:id', protect, async (req, res) => {
  try {
    const { rows } = await db.query('DELETE FROM documents WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Document not found' });
    const filePath = path.resolve(rows[0].file_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
