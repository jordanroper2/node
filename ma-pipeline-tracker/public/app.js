'use strict';

const STAGES = [
  { key: 'Pre-Qualification',       color: '#6366f1' },
  { key: 'Information Requested',   color: '#3b82f6' },
  { key: 'Site Visit Completed',    color: '#0ea5e9' },
  { key: 'Preliminary Due Diligence', color: '#14b8a6' },
  { key: 'Qualification',           color: '#22c55e' },
  { key: 'Stage Gate Approval',     color: '#f59e0b' },
];

let companies = [];
let editingId = null;
let detailId = null;

// ===== API helpers =====
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function loadCompanies() {
  companies = await api('GET', '/api/companies');
  render();
}

// ===== Render =====
function render() {
  renderBoard();
  renderStats();
}

function renderStats() {
  document.querySelector('#stat-total .stat-num').textContent   = companies.length;
  document.querySelector('#stat-pre-qual .stat-num').textContent = count('Pre-Qualification');
  document.querySelector('#stat-info-req .stat-num').textContent = count('Information Requested');
  document.querySelector('#stat-site-visit .stat-num').textContent = count('Site Visit Completed');
  document.querySelector('#stat-prelim-dd .stat-num').textContent = count('Preliminary Due Diligence');
  document.querySelector('#stat-qual .stat-num').textContent    = count('Qualification');
  document.querySelector('#stat-approved .stat-num').textContent = count('Stage Gate Approval');
}

function count(stage) {
  return companies.filter(c => c.stage === stage).length;
}

function renderBoard() {
  const board = document.getElementById('pipelineBoard');
  board.innerHTML = '';

  STAGES.forEach(stage => {
    const stageCompanies = companies.filter(c => c.stage === stage.key);

    const col = document.createElement('div');
    col.className = 'stage-col';

    col.innerHTML = `
      <div class="stage-header" style="border-top: 3px solid ${stage.color}">
        <span class="stage-dot" style="background:${stage.color}"></span>
        <span class="stage-name">${stage.key}</span>
        <span class="stage-count">${stageCompanies.length}</span>
      </div>
      <div class="stage-cards" id="col-${slugify(stage.key)}">
        ${stageCompanies.length === 0
          ? '<div class="empty-col">No companies yet</div>'
          : stageCompanies.map(c => companyCardHTML(c, stage.color)).join('')
        }
      </div>
    `;

    board.appendChild(col);
  });

  // Attach card click handlers
  board.querySelectorAll('.company-card').forEach(card => {
    card.addEventListener('click', () => openDetail(Number(card.dataset.id)));
  });
}

function companyCardHTML(c, color) {
  const location = [c.city, c.state].filter(Boolean).join(', ');
  const dateStr = new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `
    <div class="company-card" data-id="${c.id}" data-stage="${esc(c.stage)}">
      <div class="card-name">${esc(c.name)}</div>
      <div class="card-meta">
        ${c.company_type ? `<span>&#9632; ${esc(c.company_type)}</span>` : ''}
        ${location ? `<span>&#128205; ${esc(location)}</span>` : ''}
        ${c.revenue ? `<span>&#36; ${esc(c.revenue)}</span>` : ''}
      </div>
      ${c.company_type ? `<span class="card-tag">${esc(c.company_type)}</span>` : ''}
      <div class="card-date">Added ${dateStr}</div>
    </div>
  `;
}

// ===== Detail Modal =====
function openDetail(id) {
  detailId = id;
  const c = companies.find(x => x.id === id);
  if (!c) return;

  document.getElementById('detailName').textContent = c.name;

  const stageColor = STAGES.find(s => s.key === c.stage)?.color || '#666';

  const body = document.getElementById('detailBody');
  body.innerHTML = `
    <span class="detail-stage-badge" style="background:${stageColor}">${esc(c.stage)}</span>
    <div class="detail-grid">
      ${detailItem('Company Type', c.company_type)}
      ${detailItem('Location', [c.city, c.state].filter(Boolean).join(', '))}
      ${detailItem('Website', c.website)}
      ${detailItem('Employees', c.employees)}
      ${detailItem('Revenue', c.revenue)}
      ${detailItem('EBITDA', c.ebitda)}
      ${detailItem('Contact Name', c.contact_name)}
      ${detailItem('Contact Email', c.contact_email)}
      ${detailItem('Contact Phone', c.contact_phone)}
      ${detailItem('Added', new Date(c.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}
    </div>
    ${c.notes ? `<div class="detail-notes">${esc(c.notes)}</div>` : ''}

    <div class="stage-move-bar">
      <label>Move to Stage:</label>
      ${STAGES.map(s => `
        <button class="stage-btn ${s.key === c.stage ? 'active' : ''}" data-stage="${esc(s.key)}"
          style="${s.key === c.stage ? `background:${s.color};border-color:${s.color};color:#fff` : `border-color:${s.color};color:${s.color}`}">
          ${esc(s.key)}
        </button>
      `).join('')}
    </div>
  `;

  // Stage move buttons
  body.querySelectorAll('.stage-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api('PATCH', `/api/companies/${id}`, { stage: btn.dataset.stage });
      await loadCompanies();
      openDetail(id); // refresh detail
    });
  });

  document.getElementById('detailOverlay').classList.add('active');
}

function detailItem(label, value) {
  const display = value ? esc(value) : '<span class="empty">—</span>';
  return `
    <div class="detail-item">
      <span class="detail-label">${label}</span>
      <span class="detail-value">${display}</span>
    </div>
  `;
}

// ===== Add/Edit Modal =====
function openAddModal() {
  editingId = null;
  document.getElementById('modalTitle').textContent = 'Add Company';
  document.getElementById('saveBtn').textContent = 'Save Company';
  document.getElementById('companyForm').reset();
  document.getElementById('companyId').value = '';
  document.getElementById('modalOverlay').classList.add('active');
  document.getElementById('name').focus();
}

function openEditModal(id) {
  const c = companies.find(x => x.id === id);
  if (!c) return;
  editingId = id;

  document.getElementById('modalTitle').textContent = 'Edit Company';
  document.getElementById('saveBtn').textContent = 'Save Changes';
  document.getElementById('companyId').value = id;

  const fields = ['name', 'company_type', 'state', 'city', 'website', 'revenue', 'ebitda', 'employees', 'contact_name', 'contact_email', 'contact_phone', 'stage', 'notes'];
  fields.forEach(f => {
    const el = document.getElementById(f);
    if (el) el.value = c[f] || '';
  });

  closeDetailModal();
  document.getElementById('modalOverlay').classList.add('active');
  document.getElementById('name').focus();
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  editingId = null;
}

function closeDetailModal() {
  document.getElementById('detailOverlay').classList.remove('active');
  detailId = null;
}

// ===== Form Submit =====
document.getElementById('companyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = {};
  new FormData(form).forEach((v, k) => { if (k !== 'id') data[k] = v; });

  try {
    if (editingId) {
      await api('PATCH', `/api/companies/${editingId}`, data);
    } else {
      await api('POST', '/api/companies', data);
    }
    closeModal();
    await loadCompanies();
  } catch (err) {
    alert('Error saving company: ' + err.message);
  }
});

// ===== Delete =====
document.getElementById('detailDelete').addEventListener('click', async () => {
  if (!detailId) return;
  const c = companies.find(x => x.id === detailId);
  if (!confirm(`Delete "${c?.name}"? This cannot be undone.`)) return;
  await api('DELETE', `/api/companies/${detailId}`);
  closeDetailModal();
  await loadCompanies();
});

// ===== Wire up buttons =====
document.getElementById('addCompanyBtn').addEventListener('click', openAddModal);
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('cancelBtn').addEventListener('click', closeModal);
document.getElementById('detailClose').addEventListener('click', closeDetailModal);
document.getElementById('detailClose2').addEventListener('click', closeDetailModal);
document.getElementById('detailEdit').addEventListener('click', () => {
  if (detailId) openEditModal(detailId);
});

// Close on overlay click
document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
});
document.getElementById('detailOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('detailOverlay')) closeDetailModal();
});

// ===== Utilities =====
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// ===== Init =====
loadCompanies();
