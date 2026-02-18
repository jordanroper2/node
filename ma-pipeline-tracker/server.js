const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
const db = new Database(path.join(__dirname, 'pipeline.db'));

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company_type TEXT,
    state TEXT,
    city TEXT,
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    revenue TEXT,
    ebitda TEXT,
    employees TEXT,
    website TEXT,
    stage TEXT NOT NULL DEFAULT 'Pre-Qualification',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

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
    name, company_type, state, city,
    contact_name, contact_email, contact_phone,
    revenue, ebitda, employees, website,
    stage, notes
  } = req.body;

  if (!name) return res.status(400).json({ error: 'Company name is required' });

  const result = db.prepare(`
    INSERT INTO companies (name, company_type, state, city, contact_name, contact_email, contact_phone, revenue, ebitda, employees, website, stage, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name, company_type, state, city,
    contact_name, contact_email, contact_phone,
    revenue, ebitda, employees, website,
    stage || 'Pre-Qualification', notes
  );

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(company);
});

// PATCH update company (stage or fields)
app.patch('/api/companies/:id', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  const fields = [
    'name', 'company_type', 'state', 'city',
    'contact_name', 'contact_email', 'contact_phone',
    'revenue', 'ebitda', 'employees', 'website',
    'stage', 'notes'
  ];

  const updates = {};
  fields.forEach(f => {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  });

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), req.params.id];

  db.prepare(`UPDATE companies SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE company
app.delete('/api/companies/:id', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  db.prepare('DELETE FROM companies WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`M&A Pipeline Tracker running at http://localhost:${PORT}`);
});
