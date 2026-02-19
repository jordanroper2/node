'use strict';

const STAGES = [
  { key: 'Pre-Qualification',         color: '#7c3aed' },  // violet
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
const filters = { search: '', state: '', company_type: '' };

function getFilteredCompanies() {
  return companies.filter(c => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const haystack = [c.name, c.city, c.state, c.contact_name].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (filters.state && c.state !== filters.state) return false;
    if (filters.company_type && c.company_type !== filters.company_type) return false;
    return true;
  });
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
  render();
  if (lostMode) renderLostView();
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
  document.querySelector('#stat-pre-qual .stat-num').textContent  = countIn(filtered, 'Pre-Qualification');
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
  const hasFilters = filters.search || filters.state || filters.company_type;
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

    const stageCompanies = filtered.filter(c => c.stage === stage.key);

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
        await api('PATCH', `/api/companies/${id}`, { stage: btn.dataset.stage });
        await loadCompanies();
        openDetail(id); // refresh detail
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

  const fields = ['name', 'company_type', 'street_address', 'city', 'state', 'zip', 'website', 'nda', 'opportunity_owner', 'revenue', 'ebitda', 'employees', 'contact_name', 'contact_email', 'contact_phone', 'stage', 'notes'];
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

document.getElementById('clearFiltersBtn').addEventListener('click', () => {
  filters.search = '';
  filters.state = '';
  filters.company_type = '';
  document.getElementById('filterSearch').value = '';
  document.getElementById('filterState').value = '';
  document.getElementById('filterType').value = '';
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

// ===== Lost/Disqualified View =====
let lostMode = false;
let lostSearch = '';

function openLostView() {
  if (mapMode) closeMapView();
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

// ===== Viewer mode =====
function applyViewerMode() {
  document.getElementById('addCompanyBtn').style.display = 'none';
  document.getElementById('detailDelete').style.display = 'none';
  document.getElementById('detailEdit').style.display = 'none';
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
  await loadCompanies();
})();
