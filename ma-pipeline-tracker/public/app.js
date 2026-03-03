'use strict';

const STAGES = [
  { key: 'Prospecting',         color: '#7c3aed' },  // violet
  { key: 'Information Requested',     color: '#2563eb' },  // blue
  { key: 'Site Visit Completed',      color: '#0891b2' },  // cyan
  { key: 'Preliminary Due Diligence', color: '#f97316' },  // orange
  { key: 'Qualification',             color: '#ca8a04' },  // yellow
  { key: 'Stage Gate Approval',       color: '#dc2626' },  // red
  { key: 'Closed',                    color: '#16a34a' },  // green
  { key: 'Lost/Disqualified',         color: '#4b5563' },  // gray — separate list view
];

let companies = [];
let editingId = null;
let detailId = null;
let viewerMode = false;
let sortBy = 'newest';
let analyticsMode = false;
let selectMode = false;
const selectedIds = new Set();
const filters = { search: '', state: '', company_type: '', opportunity_owner: '' };

function getFilteredCompanies() {
  return companies.filter(c => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const haystack = [c.name, c.city, c.state, c.contact_name].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (filters.state && c.state !== filters.state) return false;
    if (filters.company_type && c.company_type !== filters.company_type) return false;
    if (filters.opportunity_owner && c.opportunity_owner !== filters.opportunity_owner) return false;
    return true;
  });
}

function daysInStage(c) {
  const ref = c.stage_entered_at || c.updated_at || c.created_at;
  return Math.floor((Date.now() - new Date(ref)) / (1000 * 60 * 60 * 24));
}

function populateOwnerFilter() {
  const select = document.getElementById('filterOwner');
  const current = filters.opportunity_owner;
  const owners = [...new Set(companies.map(c => c.opportunity_owner).filter(Boolean))].sort();
  select.innerHTML = '<option value="">All Owners</option>';
  owners.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    if (o === current) opt.selected = true;
    select.appendChild(opt);
  });
}

function sortCompanies(arr) {
  const sorted = [...arr];
  switch (sortBy) {
    case 'oldest':  sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); break;
    case 'name-az': sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '')); break;
    case 'name-za': sorted.sort((a, b) => (b.name || '').localeCompare(a.name || '')); break;
    default:        sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); break;
  }
  return sorted;
}

// ===== API helpers =====
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { window.location.href = '/login'; return; }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function loadCompanies() {
  companies = await api('GET', '/api/companies');
  populateOwnerFilter();
  render();
  renderPriorityBar();
  if (lostMode) renderLostView();
  if (analyticsMode) renderAnalytics();
}

// ===== Render =====
function render() {
  const filtered = getFilteredCompanies();
  renderBoard(filtered);
  renderStats(filtered);
  updateFilterUI(filtered);
}

function renderStats(filtered) {
  document.querySelector('#stat-total .stat-num').textContent     = filtered.length;
  document.querySelector('#stat-pre-qual .stat-num').textContent  = countIn(filtered, 'Prospecting');
  document.querySelector('#stat-info-req .stat-num').textContent  = countIn(filtered, 'Information Requested');
  document.querySelector('#stat-site-visit .stat-num').textContent = countIn(filtered, 'Site Visit Completed');
  document.querySelector('#stat-prelim-dd .stat-num').textContent = countIn(filtered, 'Preliminary Due Diligence');
  document.querySelector('#stat-qual .stat-num').textContent      = countIn(filtered, 'Qualification');
  document.querySelector('#stat-approved .stat-num').textContent  = countIn(filtered, 'Stage Gate Approval');
  document.querySelector('#stat-closed .stat-num').textContent    = countIn(filtered, 'Closed');
  document.querySelector('#stat-lost .stat-num').textContent      = companies.filter(c => c.stage === 'Lost/Disqualified').length;
}

function countIn(arr, stage) {
  return arr.filter(c => c.stage === stage).length;
}

function updateFilterUI(filtered) {
  const hasFilters = filters.search || filters.state || filters.company_type || filters.opportunity_owner;
  document.getElementById('clearFiltersBtn').style.display = hasFilters ? '' : 'none';
  const countEl = document.getElementById('filterResultCount');
  if (hasFilters) {
    countEl.textContent = `${filtered.length} of ${companies.length} shown`;
    countEl.style.display = '';
  } else {
    countEl.style.display = 'none';
  }
}

function renderBoard(filtered) {
  const board = document.getElementById('pipelineBoard');
  board.innerHTML = '';

  STAGES.forEach(stage => {
    if (stage.key === 'Lost/Disqualified') return; // shown in separate Lost view

    const stageCompanies = sortCompanies(filtered.filter(c => c.stage === stage.key));

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
    card.addEventListener('click', (e) => {
      if (selectMode) {
        if (e.target.classList.contains('card-checkbox')) return; // let checkbox handle itself
        toggleCardSelect(Number(card.dataset.id));
      } else {
        openDetail(Number(card.dataset.id));
      }
    });
  });
  board.querySelectorAll('.card-checkbox').forEach(cb => {
    cb.addEventListener('change', () => toggleCardSelect(Number(cb.dataset.id)));
  });
}

function ndaBadgeHTML(nda) {
  if (!nda) return '';
  const styles = {
    'Yes':     { bg: '#dcfce7', color: '#166534', label: 'NDA Signed' },
    'Pending': { bg: '#fef3c7', color: '#92400e', label: 'NDA Pending' },
    'No':      { bg: '#fee2e2', color: '#991b1b', label: 'No NDA' },
  };
  const s = styles[nda];
  if (!s) return '';
  return `<span class="nda-badge" style="background:${s.bg};color:${s.color}">${s.label}</span>`;
}

function companyCardHTML(c, color) {
  const location = [c.city, c.state].filter(Boolean).join(', ');
  const dateStr = new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const days = daysInStage(c);
  const durationClass = days > 30 ? 'overdue' : days > 14 ? 'warn' : '';
  const isSelected = selectedIds.has(c.id);
  return `
    <div class="company-card${selectMode ? ' selectable' : ''}${isSelected ? ' card-selected' : ''}" data-id="${c.id}" data-stage="${esc(c.stage)}">
      ${selectMode ? `<div class="card-checkbox-wrap"><input type="checkbox" class="card-checkbox" data-id="${c.id}" ${isSelected ? 'checked' : ''}></div>` : ''}
      <div class="card-name">${esc(c.name)} ${ndaBadgeHTML(c.nda)}</div>
      <div class="card-meta">
        ${c.company_type ? `<span>&#9632; ${esc(c.company_type)}</span>` : ''}
        ${location ? `<span>&#128205; ${esc(location)}</span>` : ''}
        ${c.revenue ? `<span>&#36; ${esc(c.revenue)}</span>` : ''}
      </div>
      ${c.company_type ? `<span class="card-tag">${esc(c.company_type)}</span>` : ''}
      <div class="card-duration ${durationClass}">${days}d in stage</div>
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
      ${detailItem('NDA', c.nda)}
      ${detailItem('Opportunity Owner', c.opportunity_owner)}
      ${detailItem('Address', formatAddress(c))}
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
    ${c.stage === 'Lost/Disqualified' && c.lost_reason ? `<div class="detail-lost-reason"><strong>Lost Reason:</strong> ${esc(c.lost_reason)}</div>` : ''}

    ${!viewerMode ? `<div class="stage-move-bar">
      <label>Move to Stage:</label>
      ${STAGES.map(s => `
        <button class="stage-btn ${s.key === c.stage ? 'active' : ''}" data-stage="${esc(s.key)}"
          style="${s.key === c.stage ? `background:${s.color};border-color:${s.color};color:#fff` : `border-color:${s.color};color:${s.color}`}">
          ${esc(s.key)}
        </button>
      `).join('')}
    </div>` : ''}
  `;

  // Stage move buttons (admin only)
  if (!viewerMode) {
    body.querySelectorAll('.stage-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.dataset.stage === 'Lost/Disqualified' && c.stage !== 'Lost/Disqualified') {
          openLostReasonModal(id);
        } else {
          await api('PATCH', `/api/companies/${id}`, { stage: btn.dataset.stage });
          await loadCompanies();
          openDetail(id);
        }
      });
    });
  }

  // Documents section
  const docsSection = document.createElement('div');
  docsSection.className = 'docs-section';
  docsSection.innerHTML = `
    <div class="docs-header">
      <span class="docs-section-title">Documents</span>
      ${!viewerMode ? `<label class="btn-doc-upload">
        + Upload
        <input type="file" id="docFileInput" style="display:none" multiple>
      </label>` : ''}
    </div>
    <div id="detailDocs"><em class="docs-empty">Loading...</em></div>
  `;
  body.appendChild(docsSection);

  if (!viewerMode) {
    document.getElementById('docFileInput').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        try {
          const res = await fetch(`/api/companies/${id}/documents`, { method: 'POST', body: fd });
          if (!res.ok) throw new Error(await res.text());
        } catch (err) {
          alert('Upload failed: ' + err.message);
        }
      }
      e.target.value = '';
      loadDocuments(id);
    });
  }

  loadDocuments(id);

  // Comments section
  const commentsSection = document.createElement('div');
  commentsSection.className = 'comments-section';
  commentsSection.innerHTML = `
    <div class="comments-header">
      <span class="comments-section-title">Comments</span>
    </div>
    ${!viewerMode ? `<div class="comment-form">
      <textarea id="commentInput" placeholder="Add a comment..." rows="1"></textarea>
      <button id="commentSubmit">Post</button>
    </div>` : ''}
    <div id="detailComments"><em class="comments-empty">Loading...</em></div>
  `;
  body.appendChild(commentsSection);

  if (!viewerMode) {
    document.getElementById('commentSubmit').addEventListener('click', async () => {
      const input = document.getElementById('commentInput');
      const content = input.value.trim();
      if (!content) return;
      try {
        await api('POST', `/api/companies/${id}/comments`, { content });
        input.value = '';
        loadComments(id);
        loadActivity(id);
      } catch (err) {
        alert('Error posting comment: ' + err.message);
      }
    });
  }

  loadComments(id);

  // Activity log section
  const activitySection = document.createElement('div');
  activitySection.className = 'activity-section';
  activitySection.innerHTML = `
    <div class="activity-header" id="activityToggle">
      <span class="activity-section-title">Activity Log</span>
      <span class="activity-toggle">Show</span>
    </div>
    <div id="detailActivity" style="display:none"><em class="activity-empty">Loading...</em></div>
  `;
  body.appendChild(activitySection);

  let activityVisible = false;
  document.getElementById('activityToggle').addEventListener('click', () => {
    activityVisible = !activityVisible;
    document.getElementById('detailActivity').style.display = activityVisible ? '' : 'none';
    document.querySelector('.activity-toggle').textContent = activityVisible ? 'Hide' : 'Show';
    if (activityVisible) loadActivity(id);
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

  const fields = ['name', 'company_type', 'street_address', 'city', 'state', 'zip', 'website', 'nda', 'opportunity_owner', 'revenue', 'ebitda', 'employees', 'contact_name', 'contact_email', 'contact_phone', 'stage', 'notes', 'lost_reason'];
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
function formatAddress(c) {
  const line1 = c.street_address || '';
  const line2 = [c.city, c.state].filter(Boolean).join(', ');
  const line3 = c.zip || '';
  const parts = [line1, line2, line3].filter(Boolean);
  return parts.length ? parts.join(', ') : '';
}

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

// ===== Filters =====
document.getElementById('filterSearch').addEventListener('input', e => {
  filters.search = e.target.value.trim();
  render();
});

document.getElementById('filterState').addEventListener('change', e => {
  filters.state = e.target.value;
  render();
});

document.getElementById('filterType').addEventListener('change', e => {
  filters.company_type = e.target.value;
  render();
});

document.getElementById('filterOwner').addEventListener('change', e => {
  filters.opportunity_owner = e.target.value;
  render();
});

document.getElementById('sortSelect').addEventListener('change', e => {
  sortBy = e.target.value;
  render();
});

document.getElementById('exportCsvBtn').addEventListener('click', exportCSV);

document.getElementById('clearFiltersBtn').addEventListener('click', () => {
  filters.search = '';
  filters.state = '';
  filters.company_type = '';
  filters.opportunity_owner = '';
  document.getElementById('filterSearch').value = '';
  document.getElementById('filterState').value = '';
  document.getElementById('filterType').value = '';
  document.getElementById('filterOwner').value = '';
  render();
});

// ===== Logout =====
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

// ===== Documents =====
async function loadDocuments(companyId) {
  try {
    const docs = await api('GET', `/api/companies/${companyId}/documents`);
    renderDocuments(companyId, docs);
  } catch (_) {}
}

function renderDocuments(companyId, docs) {
  const container = document.getElementById('detailDocs');
  if (!container) return;
  if (!docs.length) {
    container.innerHTML = '<em class="docs-empty">No documents uploaded yet</em>';
    return;
  }
  container.innerHTML = docs.map(doc => `
    <div class="doc-row">
      <span class="doc-name" title="${esc(doc.original_name)}">${esc(doc.original_name)}</span>
      <span class="doc-size">${formatBytes(doc.size)}</span>
      <a href="/api/documents/${doc.id}/download" class="btn-doc-action btn-doc-download" download="${esc(doc.original_name)}">Download</a>
      ${!viewerMode ? `<button class="btn-doc-action btn-doc-delete" data-doc-id="${doc.id}" data-doc-name="${esc(doc.original_name)}">&times;</button>` : ''}
    </div>
  `).join('');

  if (!viewerMode) {
    container.querySelectorAll('.btn-doc-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Delete "${btn.dataset.docName}"?`)) return;
        await api('DELETE', `/api/documents/${btn.dataset.docId}`);
        loadDocuments(companyId);
      });
    });
  }
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ===== Comments =====
async function loadComments(companyId) {
  try {
    const comments = await api('GET', `/api/companies/${companyId}/comments`);
    renderComments(comments);
  } catch (_) {}
}

function renderComments(comments) {
  const container = document.getElementById('detailComments');
  if (!container) return;
  if (!comments.length) {
    container.innerHTML = '<em class="comments-empty">No comments yet</em>';
    return;
  }
  container.innerHTML = comments.map(c => {
    const dateStr = new Date(c.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
    });
    return `
      <div class="comment-item">
        <div class="comment-text">${esc(c.content)}</div>
        <div class="comment-date">${dateStr}</div>
      </div>
    `;
  }).join('');
}

// ===== Activity Log =====
async function loadActivity(companyId) {
  try {
    const logs = await api('GET', `/api/companies/${companyId}/activity`);
    renderActivity(logs);
  } catch (_) {}
}

function renderActivity(logs) {
  const container = document.getElementById('detailActivity');
  if (!container) return;
  if (!logs.length) {
    container.innerHTML = '<em class="activity-empty">No activity yet</em>';
    return;
  }
  container.innerHTML = logs.map(log => {
    const dateStr = new Date(log.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
    });
    let iconClass = 'created';
    let icon = '+';
    if (log.action === 'Stage Change')       { iconClass = 'stage-change'; icon = '\u2192'; }
    else if (log.action.includes('Document')) { iconClass = 'document'; icon = '\uD83D\uDCC4'; }
    else if (log.action === 'Comment Added')  { iconClass = 'comment'; icon = '\uD83D\uDCAC'; }
    return `
      <div class="activity-item">
        <div class="activity-icon ${iconClass}">${icon}</div>
        <div class="activity-content">
          <div class="activity-action">${esc(log.action)}</div>
          ${log.details ? `<div class="activity-details" title="${esc(log.details)}">${esc(log.details)}</div>` : ''}
        </div>
        <div class="activity-date">${dateStr}</div>
      </div>
    `;
  }).join('');
}

// ===== CSV Export =====
function exportCSV() {
  const filtered = getFilteredCompanies();
  const headers = ['Name','Type','Stage','Street Address','City','State','ZIP','Contact Name','Contact Email','Contact Phone','Revenue','EBITDA','Employees','Website','NDA','Opportunity Owner','Lost Reason','Notes','Created','Updated'];
  const fields = ['name','company_type','stage','street_address','city','state','zip','contact_name','contact_email','contact_phone','revenue','ebitda','employees','website','nda','opportunity_owner','lost_reason','notes','created_at','updated_at'];

  const csvEsc = (val) => {
    if (!val) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  };

  const rows = [headers.join(',')];
  filtered.forEach(c => rows.push(fields.map(f => csvEsc(c[f])).join(',')));

  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pipeline-export-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ===== Priority Markets =====
let priorityMarkets = ['', '', '']; // exactly 3 slots
let priorityEditMode = false;

async function loadPriorityMarkets() {
  try {
    const row = await api('GET', '/api/settings/priority_markets');
    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      // Ensure always exactly 3 slots
      priorityMarkets = [parsed[0] || '', parsed[1] || '', parsed[2] || ''];
    }
  } catch (_) {}
  renderPriorityBar();
}

async function savePriorityMarkets(markets) {
  priorityMarkets = markets;
  await api('PUT', '/api/settings/priority_markets', { value: JSON.stringify(markets) });
  renderPriorityBar();
}

function renderPriorityBar() {
  const cardsEl = document.getElementById('priorityCards');
  const editFormEl = document.getElementById('priorityEditForm');

  if (priorityEditMode) {
    cardsEl.style.display = 'none';
    editFormEl.style.display = 'flex';
    renderPriorityEditForm(editFormEl);
  } else {
    editFormEl.style.display = 'none';
    cardsEl.style.display = 'flex';
    renderPriorityCards(cardsEl);
  }
}

function renderPriorityCards(container) {
  // Count active (non-lost) companies per state
  const active = companies.filter(c => c.stage !== 'Lost/Disqualified');

  const hasAny = priorityMarkets.some(m => m);
  if (!hasAny) {
    container.innerHTML = '<span class="priority-empty">No priority markets set — click ✎ to add up to 3</span>';
    return;
  }

  container.innerHTML = priorityMarkets.map((market, i) => {
    if (!market) {
      return `<div class="priority-card priority-card-empty">
        <span class="priority-rank">#${i + 1}</span>
        <span class="priority-market-name">—</span>
      </div>`;
    }
    const count = active.filter(c => c.state === market).length;
    return `<div class="priority-card">
      <span class="priority-rank">#${i + 1}</span>
      <span class="priority-market-name">${esc(market)}</span>
      <span class="priority-count">${count} deal${count !== 1 ? 's' : ''}</span>
    </div>`;
  }).join('');
}

function renderPriorityEditForm(container) {
  // Build unique sorted state list from companies + a full US state list for flexibility
  const usStates = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

  const options = usStates.map(s => `<option value="${s}">${s}</option>`).join('');

  container.innerHTML = `
    <span class="priority-edit-label">#1</span>
    <select class="priority-edit-select" id="pm0"><option value="">— None —</option>${options}</select>
    <span class="priority-edit-label">#2</span>
    <select class="priority-edit-select" id="pm1"><option value="">— None —</option>${options}</select>
    <span class="priority-edit-label">#3</span>
    <select class="priority-edit-select" id="pm2"><option value="">— None —</option>${options}</select>
    <button class="btn btn-primary" id="pmSaveBtn">Save</button>
    <button class="btn btn-secondary" id="pmCancelBtn">Cancel</button>
  `;

  // Set current values
  priorityMarkets.forEach((m, i) => {
    document.getElementById(`pm${i}`).value = m || '';
  });

  document.getElementById('pmSaveBtn').addEventListener('click', async () => {
    const markets = [0, 1, 2].map(i => document.getElementById(`pm${i}`).value);
    priorityEditMode = false;
    document.getElementById('priorityEditBtn').title = 'Edit priority markets';
    await savePriorityMarkets(markets);
  });

  document.getElementById('pmCancelBtn').addEventListener('click', () => {
    priorityEditMode = false;
    document.getElementById('priorityEditBtn').title = 'Edit priority markets';
    renderPriorityBar();
  });
}

document.getElementById('priorityEditBtn').addEventListener('click', () => {
  if (viewerMode) return;
  priorityEditMode = !priorityEditMode;
  renderPriorityBar();
});

// ===== Lost Reason Modal =====
let lostReasonCompanyId = null;

function openLostReasonModal(companyId) {
  lostReasonCompanyId = companyId;
  document.getElementById('lostReasonSelect').value = '';
  document.getElementById('lostReasonOther').value = '';
  document.getElementById('lostReasonOtherGroup').style.display = 'none';
  document.getElementById('lostReasonOverlay').classList.add('active');
}

function closeLostReasonModal() {
  document.getElementById('lostReasonOverlay').classList.remove('active');
  lostReasonCompanyId = null;
}

document.getElementById('lostReasonSelect').addEventListener('change', (e) => {
  document.getElementById('lostReasonOtherGroup').style.display = e.target.value === 'Other' ? '' : 'none';
});

document.getElementById('lostReasonClose').addEventListener('click', closeLostReasonModal);
document.getElementById('lostReasonCancel').addEventListener('click', closeLostReasonModal);
document.getElementById('lostReasonOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('lostReasonOverlay')) closeLostReasonModal();
});

document.getElementById('lostReasonConfirm').addEventListener('click', async () => {
  if (!lostReasonCompanyId) return;
  let reason = document.getElementById('lostReasonSelect').value;
  if (reason === 'Other') {
    const other = document.getElementById('lostReasonOther').value.trim();
    reason = other || 'Other';
  }
  if (!reason) {
    alert('Please select a reason.');
    return;
  }
  await api('PATCH', `/api/companies/${lostReasonCompanyId}`, {
    stage: 'Lost/Disqualified',
    lost_reason: reason
  });
  closeLostReasonModal();
  await loadCompanies();
  openDetail(lostReasonCompanyId);
});

// ===== Analytics View =====

function openAnalyticsView() {
  if (lostMode) closeLostView();
  if (mapMode) closeMapView();
  if (agendaMode) closeAgendaView();
  analyticsMode = true;
  document.getElementById('pipelineWrapper').style.display = 'none';
  document.getElementById('filterBar').style.display = 'none';
  document.getElementById('analyticsWrapper').style.display = '';
  document.getElementById('analyticsBtn').textContent = '\u2190 Board View';
  renderAnalytics();
}

function closeAnalyticsView() {
  analyticsMode = false;
  document.getElementById('pipelineWrapper').style.display = '';
  document.getElementById('filterBar').style.display = '';
  document.getElementById('analyticsWrapper').style.display = 'none';
  document.getElementById('analyticsBtn').textContent = '\uD83D\uDCCA Analytics';
}

function renderAnalytics() {
  const active = companies.filter(c => c.stage !== 'Lost/Disqualified');
  const lost   = companies.filter(c => c.stage === 'Lost/Disqualified');
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const addedThisMonth = companies.filter(c => new Date(c.created_at) >= monthStart).length;
  const allDays = active.map(c => daysInStage(c));
  const avgDays = allDays.length ? Math.round(allDays.reduce((a, b) => a + b, 0) / allDays.length) : 0;

  document.getElementById('anActiveDeals').textContent = active.length;
  document.getElementById('anAddedMonth').textContent  = addedThisMonth;
  document.getElementById('anAvgDays').textContent     = avgDays;
  document.getElementById('anLostTotal').textContent   = lost.length;

  renderStageCountChart(active);
  renderStageDaysChart(active);
  renderMonthlyChart();
}

function renderStageCountChart(active) {
  const container = document.getElementById('chartStageCount');
  const rows = STAGES.filter(s => s.key !== 'Lost/Disqualified').map(s => ({
    stage: s, count: active.filter(c => c.stage === s.key).length
  }));
  const max = Math.max(...rows.map(r => r.count), 1);
  container.innerHTML = rows.map(({ stage, count }) => `
    <div class="chart-row">
      <div class="chart-label" title="${stage.key}">${stage.key}</div>
      <div class="chart-bar-wrap">
        <div class="chart-bar" style="width:${(count / max) * 100}%;background:${stage.color}"></div>
      </div>
      <div class="chart-value">${count}</div>
    </div>
  `).join('');
}

function renderStageDaysChart(active) {
  const container = document.getElementById('chartStageDays');
  const rows = STAGES.filter(s => s.key !== 'Lost/Disqualified').map(s => {
    const inStage = active.filter(c => c.stage === s.key);
    const avg = inStage.length
      ? Math.round(inStage.reduce((sum, c) => sum + daysInStage(c), 0) / inStage.length) : 0;
    return { stage: s, avg, count: inStage.length };
  });
  const max = Math.max(...rows.map(r => r.avg), 1);
  container.innerHTML = rows.map(({ stage, avg, count }) => `
    <div class="chart-row">
      <div class="chart-label" title="${stage.key}">${stage.key}</div>
      <div class="chart-bar-wrap">
        <div class="chart-bar" style="width:${(avg / max) * 100}%;background:${stage.color};opacity:${count > 0 ? 1 : 0.2}"></div>
      </div>
      <div class="chart-value">${count > 0 ? avg + 'd' : '\u2014'}</div>
    </div>
  `).join('');
}

function renderMonthlyChart() {
  const container = document.getElementById('chartMonthly');
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    d.setHours(0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const count = companies.filter(c => {
      const created = new Date(c.created_at);
      return created >= d && created < end;
    }).length;
    months.push({ label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), count });
  }
  const max = Math.max(...months.map(m => m.count), 1);
  container.innerHTML = months.map(({ label, count }) => `
    <div class="monthly-col">
      <div class="monthly-bar-wrap">
        <div class="monthly-bar" style="height:${Math.max((count / max) * 100, count > 0 ? 4 : 0)}%"></div>
      </div>
      <div class="monthly-label">${label}</div>
      <div class="monthly-value">${count}</div>
    </div>
  `).join('');
}

document.getElementById('analyticsBtn').addEventListener('click', () => {
  if (analyticsMode) closeAnalyticsView();
  else openAnalyticsView();
});

// ===== Select Mode / Bulk Actions =====

function toggleSelectMode() {
  selectMode = !selectMode;
  selectedIds.clear();
  document.getElementById('selectModeBtn').classList.toggle('active', selectMode);
  document.getElementById('bulkActionBar').style.display = selectMode ? '' : 'none';
  document.getElementById('bulkCount').textContent = '0 selected';
  render();
}

function toggleCardSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  document.getElementById('bulkCount').textContent = `${selectedIds.size} selected`;
  // Update visual state without full re-render
  document.querySelectorAll(`.company-card[data-id="${id}"]`).forEach(card => {
    card.classList.toggle('card-selected', selectedIds.has(id));
    const cb = card.querySelector('.card-checkbox');
    if (cb) cb.checked = selectedIds.has(id);
  });
}

async function applyBulkMove() {
  const stage = document.getElementById('bulkStageSelect').value;
  if (!stage) { alert('Please select a target stage.'); return; }
  if (!selectedIds.size) { alert('No companies selected.'); return; }
  if (!confirm(`Move ${selectedIds.size} ${selectedIds.size === 1 ? 'company' : 'companies'} to "${stage}"?`)) return;
  try {
    await Promise.all([...selectedIds].map(id => api('PATCH', `/api/companies/${id}`, { stage })));
    selectedIds.clear();
    document.getElementById('bulkStageSelect').value = '';
    selectMode = false;
    document.getElementById('selectModeBtn').classList.remove('active');
    document.getElementById('bulkActionBar').style.display = 'none';
    await loadCompanies();
  } catch (err) {
    alert('Error moving companies: ' + err.message);
  }
}

document.getElementById('selectModeBtn').addEventListener('click', toggleSelectMode);
document.getElementById('bulkApplyBtn').addEventListener('click', applyBulkMove);
document.getElementById('bulkCancelBtn').addEventListener('click', () => { if (selectMode) toggleSelectMode(); });

// ===== Lost/Disqualified View =====
let lostMode = false;
let lostSearch = '';

function openLostView() {
  if (mapMode) closeMapView();
  if (analyticsMode) closeAnalyticsView();
  if (agendaMode) closeAgendaView();
  lostMode = true;
  document.getElementById('pipelineWrapper').style.display = 'none';
  document.getElementById('filterBar').style.display = 'none';
  document.getElementById('lostWrapper').style.display = '';
  document.getElementById('lostViewBtn').textContent = '\u2190 Board View';
  renderLostView();
}

function closeLostView() {
  lostMode = false;
  document.getElementById('pipelineWrapper').style.display = '';
  document.getElementById('filterBar').style.display = '';
  document.getElementById('lostWrapper').style.display = 'none';
  document.getElementById('lostViewBtn').textContent = 'Lost/Disqualified';
}

function renderLostView() {
  const lost = companies.filter(c => c.stage === 'Lost/Disqualified');
  const q = lostSearch.toLowerCase();
  const filtered = q ? lost.filter(c =>
    [c.name, c.city, c.state, c.contact_name, c.company_type, c.opportunity_owner]
      .filter(Boolean).join(' ').toLowerCase().includes(q)
  ) : lost;

  const tbody = document.getElementById('lostTableBody');
  const emptyEl = document.getElementById('lostEmpty');
  const countEl = document.getElementById('lostCount');
  const tableEl = tbody.closest('table');

  countEl.textContent = `${filtered.length} ${filtered.length === 1 ? 'opportunity' : 'opportunities'}`;

  if (!filtered.length) {
    tbody.innerHTML = '';
    tableEl.style.display = 'none';
    emptyEl.style.display = '';
    return;
  }

  emptyEl.style.display = 'none';
  tableEl.style.display = '';
  tbody.innerHTML = filtered.map(c => {
    const location = [c.city, c.state].filter(Boolean).join(', ');
    const dateStr = new Date(c.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `
      <tr class="lost-row" data-id="${c.id}">
        <td class="lost-name">${esc(c.name)}</td>
        <td>${esc(c.company_type || '\u2014')}</td>
        <td>${esc(location || '\u2014')}</td>
        <td>${esc(c.revenue || '\u2014')}</td>
        <td>${esc(c.nda || '\u2014')}</td>
        <td>${esc(c.lost_reason || '\u2014')}</td>
        <td>${esc(c.opportunity_owner || '\u2014')}</td>
        <td>${dateStr}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.lost-row').forEach(row => {
    row.addEventListener('click', () => openDetail(Number(row.dataset.id)));
  });
}

document.getElementById('lostViewBtn').addEventListener('click', () => {
  if (lostMode) closeLostView();
  else openLostView();
});

document.getElementById('lostSearch').addEventListener('input', e => {
  lostSearch = e.target.value.trim();
  renderLostView();
});

document.getElementById('stat-lost').addEventListener('click', () => {
  if (!lostMode) openLostView();
});

// ===== Map View =====
let mapInstance = null;
let mapMode = false;
const geocodeCache = {};

function stageColor(stageName) {
  return STAGES.find(s => s.key === stageName)?.color || '#6b7280';
}

async function geocodeAddress(address) {
  if (geocodeCache[address]) return geocodeCache[address];
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address);
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    if (data && data[0]) {
      const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      geocodeCache[address] = result;
      return result;
    }
  } catch (_) {}
  return null;
}

async function openMapView() {
  if (lostMode) closeLostView();
  if (analyticsMode) closeAnalyticsView();
  if (agendaMode) closeAgendaView();
  mapMode = true;
  document.getElementById('pipelineWrapper').style.display = 'none';
  document.getElementById('mapWrapper').style.display = 'flex';
  document.getElementById('filterBar').style.display = 'none';
  document.getElementById('mapViewBtn').textContent = '← Board View';

  // Build legend
  const legend = document.getElementById('mapLegend');
  // Remove any previously added stage rows (keep the title)
  legend.querySelectorAll('.map-legend-item').forEach(el => el.remove());
  STAGES.forEach(s => {
    const row = document.createElement('div');
    row.className = 'map-legend-item';
    row.innerHTML = `<span class="map-legend-dot" style="background:${s.color}"></span>${s.key}`;
    legend.appendChild(row);
  });

  if (!mapInstance) {
    mapInstance = L.map('companyMap').setView([38.5, -96], 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(mapInstance);
  }

  // Clear existing markers
  mapInstance.eachLayer(layer => {
    if (layer instanceof L.Marker) mapInstance.removeLayer(layer);
  });

  const withAddress = companies.filter(c => c.city || c.street_address);
  const noAddress = companies.filter(c => !c.city && !c.street_address);

  // Show no-address panel
  const noAddrEl = document.getElementById('mapNoAddress');
  if (noAddress.length > 0) {
    document.getElementById('mapNoAddressCount').textContent =
      `${noAddress.length} ${noAddress.length === 1 ? 'company' : 'companies'} without an address: `;
    document.getElementById('mapNoAddressList').textContent =
      noAddress.map(c => c.name).join(', ');
    noAddrEl.style.display = '';
  } else {
    noAddrEl.style.display = 'none';
  }

  // Geocode and place markers (rate-limited: 1 per 300ms for Nominatim)
  for (let i = 0; i < withAddress.length; i++) {
    const c = withAddress[i];
    const addressParts = [c.street_address, c.city, c.state, c.zip].filter(Boolean);
    const address = addressParts.join(', ');
    const coords = await geocodeAddress(address);
    if (!coords) continue;

    const color = stageColor(c.stage);
    const markerHtml = `<div style="
      width:14px;height:14px;border-radius:50%;
      background:${color};border:2px solid #fff;
      box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`;

    const icon = L.divIcon({ html: markerHtml, className: '', iconSize: [14, 14], iconAnchor: [7, 7] });
    const marker = L.marker([coords.lat, coords.lng], { icon }).addTo(mapInstance);

    const popupContent = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-width:160px">
        <div style="font-weight:700;font-size:0.9rem;margin-bottom:4px">${esc(c.name)}</div>
        <div style="font-size:0.75rem;color:#6b7280;margin-bottom:4px">${esc(c.company_type || '—')}</div>
        <div style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:0.7rem;font-weight:700;color:#fff;background:${color}">${esc(c.stage)}</div>
        ${addressParts.length ? `<div style="font-size:0.75rem;color:#374151;margin-top:6px">${esc(addressParts.join(', '))}</div>` : ''}
      </div>`;
    marker.bindPopup(popupContent);

    if (i < withAddress.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  mapInstance.invalidateSize();
}

function closeMapView() {
  mapMode = false;
  document.getElementById('pipelineWrapper').style.display = '';
  document.getElementById('mapWrapper').style.display = 'none';
  document.getElementById('filterBar').style.display = '';
  document.getElementById('mapViewBtn').textContent = '\uD83D\uDCCD Map View';
}

document.getElementById('mapViewBtn').addEventListener('click', () => {
  if (mapMode) closeMapView();
  else openMapView();
});

// ===== Weekly Agenda =====
let agendaMode = false;
let agendaItems = [];

async function loadAgenda() {
  agendaItems = await api('GET', '/api/agenda');
}

function openAgendaView() {
  if (lostMode) closeLostView();
  if (analyticsMode) closeAnalyticsView();
  if (mapMode) closeMapView();
  agendaMode = true;
  document.getElementById('pipelineWrapper').style.display = 'none';
  document.getElementById('filterBar').style.display = 'none';
  document.getElementById('agendaWrapper').style.display = '';
  document.getElementById('agendaViewBtn').textContent = '\u2190 Board View';
  populateAgendaCompanySelect();
  loadAgenda().then(renderAgendaView);
}

function closeAgendaView() {
  agendaMode = false;
  document.getElementById('pipelineWrapper').style.display = '';
  document.getElementById('filterBar').style.display = '';
  document.getElementById('agendaWrapper').style.display = 'none';
  document.getElementById('agendaViewBtn').textContent = '\uD83D\uDCC5 Weekly Agenda';
}

function populateAgendaCompanySelect() {
  const sel = document.getElementById('agendaCompany');
  const sorted = companies
    .filter(c => c.stage !== 'Lost/Disqualified')
    .sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = '<option value="">— No deal —</option>' +
    sorted.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}

function renderAgendaView() {
  const tbody = document.getElementById('agendaTableBody');
  const emptyEl = document.getElementById('agendaEmpty');
  const countEl = document.getElementById('agendaCount');
  const tableEl = tbody.closest('table');

  countEl.textContent = `${agendaItems.length} ${agendaItems.length === 1 ? 'item' : 'items'}`;

  if (!agendaItems.length) {
    tbody.innerHTML = '';
    tableEl.style.display = 'none';
    emptyEl.style.display = '';
    return;
  }

  emptyEl.style.display = 'none';
  tableEl.style.display = '';
  const today = new Date().toISOString().slice(0, 10);
  tbody.innerHTML = agendaItems.map(item => {
    const dateStr = new Date(item.meeting_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const company = companies.find(c => c.id === item.company_id);
    const isPast = item.meeting_date < today;
    return `
      <tr class="agenda-row${isPast ? ' agenda-row-past' : ''}" data-company-id="${item.company_id || ''}">
        <td class="agenda-date-cell">${dateStr}</td>
        <td>${company ? esc(company.name) : '\u2014'}</td>
        <td>${esc(item.description)}</td>
        <td class="agenda-actions">
          <button class="btn-agenda-delete" data-id="${item.id}" title="Delete">&times;</button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.agenda-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.btn-agenda-delete')) return;
      const companyId = Number(row.dataset.companyId);
      if (companyId) openDetail(companyId);
    });
  });

  tbody.querySelectorAll('.btn-agenda-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api('DELETE', `/api/agenda/${btn.dataset.id}`);
      await loadAgenda();
      renderAgendaView();
    });
  });
}

document.getElementById('agendaViewBtn').addEventListener('click', () => {
  if (agendaMode) closeAgendaView();
  else openAgendaView();
});

document.getElementById('agendaAddBtn').addEventListener('click', async () => {
  const date = document.getElementById('agendaDate').value;
  const desc = document.getElementById('agendaDesc').value.trim();
  const companyId = document.getElementById('agendaCompany').value;
  if (!date || !desc) return;
  await api('POST', '/api/agenda', {
    meeting_date: date,
    description: desc,
    company_id: companyId ? Number(companyId) : null,
  });
  document.getElementById('agendaDate').value = '';
  document.getElementById('agendaDesc').value = '';
  document.getElementById('agendaCompany').value = '';
  await loadAgenda();
  renderAgendaView();
});

// ===== Viewer mode =====
function applyViewerMode() {
  document.getElementById('addCompanyBtn').style.display = 'none';
  document.getElementById('detailDelete').style.display = 'none';
  document.getElementById('detailEdit').style.display = 'none';
  document.getElementById('selectModeBtn').style.display = 'none';
  document.getElementById('exportCsvBtn').style.display = 'none';
  document.getElementById('priorityEditBtn').style.display = 'none';
  document.getElementById('agendaAddForm').style.display = 'none';
}

// ===== Init =====
(async () => {
  try {
    const me = await api('GET', '/api/me');
    if (me && me.role === 'viewer') {
      viewerMode = true;
      applyViewerMode();
    }
  } catch (_) {}
  await Promise.all([loadCompanies(), loadPriorityMarkets()]);
})();
