const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Auth config
const PASSWORD = 'jordanroper';
const VIEW_PASSWORD = 'viewonly';
const AUTH_COOKIE = 'ma_auth';
const AUTH_VALUE = crypto.createHash('sha256').update(PASSWORD).digest('hex');
const VIEW_AUTH_VALUE = crypto.createHash('sha256').update(VIEW_PASSWORD).digest('hex');

// Initialize database (DB_PATH env var lets Railway point to a persistent volume)
const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'pipeline.db');
const db = new Database(DB_FILE);

// Upload directory sits next to the database on the same volume
const UPLOAD_DIR = path.join(path.dirname(DB_FILE), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } }); // 25 MB

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    size INTEGER,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company_type TEXT,
    street_address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    revenue TEXT,
    ebitda TEXT,
    employees TEXT,
    website TEXT,
    stage TEXT NOT NULL DEFAULT 'Pre-Qualification',
    notes TEXT,
    nda TEXT,
    opportunity_owner TEXT,
    lost_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    stage_entered_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

// Migrations: add new columns to existing databases
const existingCols = db.pragma('table_info(companies)').map(col => col.name);
if (!existingCols.includes('street_address')) db.exec('ALTER TABLE companies ADD COLUMN street_address TEXT');
if (!existingCols.includes('zip')) db.exec('ALTER TABLE companies ADD COLUMN zip TEXT');
if (!existingCols.includes('nda')) db.exec('ALTER TABLE companies ADD COLUMN nda TEXT');
if (!existingCols.includes('opportunity_owner')) db.exec('ALTER TABLE companies ADD COLUMN opportunity_owner TEXT');
if (!existingCols.includes('lost_reason')) db.exec('ALTER TABLE companies ADD COLUMN lost_reason TEXT');
if (!existingCols.includes('stage_entered_at')) db.exec('ALTER TABLE companies ADD COLUMN stage_entered_at DATETIME');

app.use(express.json());
app.use(cookieParser());

// ===== Public routes (no auth required) =====

app.get('/login', (req, res) => {
  const cookie = req.cookies[AUTH_COOKIE];
  if (cookie === AUTH_VALUE || cookie === VIEW_AUTH_VALUE) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', (req, res) => {
  if (req.body.password === PASSWORD) {
    res.cookie(AUTH_COOKIE, AUTH_VALUE, { httpOnly: true, sameSite: 'strict' });
    return res.json({ ok: true, role: 'admin' });
  }
  if (req.body.password === VIEW_PASSWORD) {
    res.cookie(AUTH_COOKIE, VIEW_AUTH_VALUE, { httpOnly: true, sameSite: 'strict' });
    return res.json({ ok: true, role: 'viewer' });
  }
  res.status(401).json({ error: 'Incorrect password' });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE);
  res.json({ ok: true });
});

// ===== Auth middleware — protects everything below =====

app.use((req, res, next) => {
  const cookie = req.cookies[AUTH_COOKIE];
  if (cookie === AUTH_VALUE || cookie === VIEW_AUTH_VALUE) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login');
});

// ===== Who am I =====

app.get('/api/me', (req, res) => {
  const role = req.cookies[AUTH_COOKIE] === VIEW_AUTH_VALUE ? 'viewer' : 'admin';
  res.json({ role });
});

// ===== Viewer write-block middleware =====

app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.cookies[AUTH_COOKIE] === VIEW_AUTH_VALUE) {
    return res.status(403).json({ error: 'View-only access: modifications not permitted' });
  }
  next();
});

// ===== Protected: static files =====

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

// ===== Protected: API routes =====

// GET all companies
app.get('/api/companies', (req, res) => {
  const companies = db.prepare('SELECT * FROM companies ORDER BY updated_at DESC').all();
  res.json(companies);
});

// GET single company
app.get('/api/companies/:id', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found' });
  res.json(company);
});

// POST create company
app.post('/api/companies', (req, res) => {
  const {
    name, company_type, street_address, city, state, zip,
    contact_name, contact_email, contact_phone,
    revenue, ebitda, employees, website,
    stage, notes, nda, opportunity_owner, lost_reason
  } = req.body;

  if (!name) return res.status(400).json({ error: 'Company name is required' });

  const finalStage = stage || 'Pre-Qualification';
  const result = db.prepare(`
    INSERT INTO companies (name, company_type, street_address, city, state, zip, contact_name, contact_email, contact_phone, revenue, ebitda, employees, website, stage, notes, nda, opportunity_owner, lost_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name, company_type, street_address, city, state, zip,
    contact_name, contact_email, contact_phone,
    revenue, ebitda, employees, website,
    finalStage, notes, nda, opportunity_owner, lost_reason
  );

  db.prepare('INSERT INTO activity_log (company_id, action, details) VALUES (?, ?, ?)').run(
    result.lastInsertRowid, 'Created', `Company added to ${finalStage}`
  );

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(company);
});

// PATCH update company (stage or fields)
app.patch('/api/companies/:id', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const fields = [
    'name', 'company_type', 'street_address', 'city', 'state', 'zip',
    'contact_name', 'contact_email', 'contact_phone',
    'revenue', 'ebitda', 'employees', 'website',
    'stage', 'notes', 'nda', 'opportunity_owner', 'lost_reason'
  ];

  const updates = {};
  fields.forEach(f => {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  });

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const oldStage = company.stage;
  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), req.params.id];

  db.prepare(`UPDATE companies SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values);

  // Log stage changes and reset stage_entered_at
  if (updates.stage && updates.stage !== oldStage) {
    db.prepare('UPDATE companies SET stage_entered_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
    let details = `Moved from "${oldStage}" to "${updates.stage}"`;
    if (updates.stage === 'Lost/Disqualified' && updates.lost_reason) {
      details += ` — Reason: ${updates.lost_reason}`;
    }
    db.prepare('INSERT INTO activity_log (company_id, action, details) VALUES (?, ?, ?)').run(
      req.params.id, 'Stage Change', details
    );
  }

  const updated = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE company (also removes its documents)
app.delete('/api/companies/:id', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const docs = db.prepare('SELECT * FROM documents WHERE company_id = ?').all(req.params.id);
  docs.forEach(doc => {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, doc.stored_name)); } catch (_) {}
  });
  db.prepare('DELETE FROM documents WHERE company_id = ?').run(req.params.id);
  db.prepare('DELETE FROM activity_log WHERE company_id = ?').run(req.params.id);
  db.prepare('DELETE FROM comments WHERE company_id = ?').run(req.params.id);
  db.prepare('DELETE FROM companies WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ===== Document endpoints =====

// GET documents for a company
app.get('/api/companies/:id/documents', (req, res) => {
  const docs = db.prepare(
    'SELECT * FROM documents WHERE company_id = ? ORDER BY uploaded_at DESC'
  ).all(req.params.id);
  res.json(docs);
});

// POST upload a document
app.post('/api/companies/:id/documents', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const result = db.prepare(
    'INSERT INTO documents (company_id, original_name, stored_name, size) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, req.file.originalname, req.file.filename, req.file.size);
  db.prepare('INSERT INTO activity_log (company_id, action, details) VALUES (?, ?, ?)').run(
    req.params.id, 'Document Uploaded', `Uploaded "${req.file.originalname}"`
  );
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(doc);
});

// GET download a document
app.get('/api/documents/:id/download', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.download(path.join(UPLOAD_DIR, doc.stored_name), doc.original_name);
});

// DELETE a document
app.delete('/api/documents/:id', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  try { fs.unlinkSync(path.join(UPLOAD_DIR, doc.stored_name)); } catch (_) {}
  db.prepare('INSERT INTO activity_log (company_id, action, details) VALUES (?, ?, ?)').run(
    doc.company_id, 'Document Deleted', `Deleted "${doc.original_name}"`
  );
  db.prepare('DELETE FROM documents WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ===== Activity Log endpoints =====

app.get('/api/companies/:id/activity', (req, res) => {
  const logs = db.prepare(
    'SELECT * FROM activity_log WHERE company_id = ? ORDER BY created_at DESC'
  ).all(req.params.id);
  res.json(logs);
});

// ===== Comments endpoints =====

app.get('/api/companies/:id/comments', (req, res) => {
  const comments = db.prepare(
    'SELECT * FROM comments WHERE company_id = ? ORDER BY created_at DESC'
  ).all(req.params.id);
  res.json(comments);
});

app.post('/api/companies/:id/comments', (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Comment content is required' });
  const result = db.prepare(
    'INSERT INTO comments (company_id, content) VALUES (?, ?)'
  ).run(req.params.id, content.trim());
  db.prepare('INSERT INTO activity_log (company_id, action, details) VALUES (?, ?, ?)').run(
    req.params.id, 'Comment Added', content.trim().substring(0, 100)
  );
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(comment);
});

// ===== Settings endpoints =====

app.get('/api/settings/:key', (req, res) => {
  const row = db.prepare('SELECT * FROM settings WHERE key = ?').get(req.params.key);
  if (!row) return res.json({ key: req.params.key, value: null });
  res.json(row);
});

app.put('/api/settings/:key', (req, res) => {
  const { value } = req.body;
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(req.params.key, value);
  res.json({ key: req.params.key, value });
});

app.listen(PORT, () => {
  console.log(`M&A Pipeline Tracker running at http://localhost:${PORT}`);
});
