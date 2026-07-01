'use strict';

const BUSINESS_ENTITY_CONTEXT_KEY = 'kinaadman_businessEntityContext';
let businessEntitiesDb = [];
let leadsDb = [];
let contactsDb = [];
let companiesDb = [];
let editingLeadId = null;
let editingContactId = null;
let currentRole = '';

const STAGES = [
  { key: 'new', label: 'New' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' }
];

document.addEventListener('DOMContentLoaded', async () => {
  switchCrmTab(getInitialCrmTab(), { syncUrl: false });
  await loadCurrentRole();
  await loadBusinessEntities();
  await loadCrm();
  applyInitialSearch();
  // Near-real-time: auto-refresh leads/contacts (no manual reload).
  if (typeof registerAutoRefresh === 'function') registerAutoRefresh(loadCrm);
});

// Pre-fill the search box from ?q= so links from the global dashboard search land filtered.
function applyInitialSearch() {
  const q = String(new URLSearchParams(window.location.search || '').get('q') || '').trim();
  if (!q) return;
  const tab = getInitialCrmTab();
  const box = document.getElementById(tab === 'contacts' ? 'contacts-search' : 'leads-search');
  if (!box) return;
  box.value = q;
  if (tab === 'contacts') renderContacts(); else renderLeads();
}

// Current user's role drives the draft/approval buttons (staff submit; admin approve/reject/convert).
async function loadCurrentRole() {
  try { const me = await fetchJson('/api/me'); currentRole = String(me && me.role || '').toLowerCase(); }
  catch (_) { currentRole = ''; }
}
function isStaffUser() { return currentRole === 'staff'; }
function isAdminUser() { return currentRole === 'admin' || currentRole === 'super_admin'; }

// ---------- shared infra (mirrors the other classic module pages) ----------
function getDefaultBusinessEntityId() {
  const defaultRow = businessEntitiesDb.find(row => Number(row.is_default || 0) === 1) || businessEntitiesDb[0] || null;
  return defaultRow ? String(defaultRow.id || '') : '';
}

function getCurrentBusinessEntityId() {
  const stored = String(localStorage.getItem(BUSINESS_ENTITY_CONTEXT_KEY) || '').trim();
  if (stored === 'all') return 'all';
  if (stored && businessEntitiesDb.some(row => String(row.id || '') === stored)) return stored;
  const fallback = getDefaultBusinessEntityId();
  if (fallback) localStorage.setItem(BUSINESS_ENTITY_CONTEXT_KEY, fallback);
  return fallback;
}

// CRM rows need a concrete entity on create — never 'all'.
function getWritableBusinessEntityId() {
  const current = getCurrentBusinessEntityId();
  return current && current !== 'all' ? current : getDefaultBusinessEntityId();
}

function applyWorkspaceBadge() {
  const badge = document.getElementById('current-workspace-badge');
  if (!badge) return;
  const id = getCurrentBusinessEntityId();
  if (id === 'all') { badge.textContent = 'All Companies'; return; }
  const row = businessEntitiesDb.find(r => String(r.id || '') === String(id));
  badge.textContent = row ? `${row.company_name || 'Workspace'}` : 'Workspace';
}

async function fetchJson(url, options = {}) {
  const { headers: customHeaders, ...rest } = options;
  const headers = new Headers(customHeaders || {});
  const method = String(rest.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    headers.set('Content-Type', 'application/json');
    const token = String(window.__CSRF_TOKEN__ || '').trim();
    if (token) headers.set('X-CSRF-Token', token);
  }
  const response = await fetch(url, { credentials: 'same-origin', ...rest, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
  return data;
}

async function loadBusinessEntities() {
  businessEntitiesDb = await fetchJson('/api/business-entities').catch(() => []);
  applyWorkspaceBadge();
}

function crmQuery() {
  return new URLSearchParams({ business_entity_id: getCurrentBusinessEntityId() || '' }).toString();
}

// ---------- helpers ----------
function money(value) {
  const n = Number(value || 0);
  return '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stageLabel(stage) {
  const found = STAGES.find(s => s.key === String(stage || '').toLowerCase());
  return found ? found.label : 'New';
}

function stageBadge(stage) {
  const key = String(stage || 'new').toLowerCase();
  return `<span class="crm-stage crm-stage-${escHtml(key)}">${escHtml(stageLabel(key))}</span>`;
}

// Approval status badge for staff-created leads (approved leads show nothing — keeps it clean).
function approvalBadge(status) {
  const s = String(status || 'approved').toLowerCase();
  if (s === 'approved') return '';
  const labels = { draft: 'Draft', pending: 'For Approval', rejected: 'Rejected' };
  return `<span class="crm-approval crm-approval-${s}">${labels[s] || s}</span>`;
}

function showCrmStatus(message, type = 'success') {
  const el = document.getElementById('crm-status');
  if (!el) return;
  el.textContent = message;
  el.className = `crm-status is-visible crm-status-${type}`;
  window.clearTimeout(showCrmStatus._t);
  showCrmStatus._t = window.setTimeout(() => { el.className = 'crm-status'; }, 2600);
}

// ---------- tabs ----------
function getInitialCrmTab() {
  const params = new URLSearchParams(window.location.search || '');
  const t = String(params.get('tab') || 'leads').trim().toLowerCase();
  return ['leads', 'contacts'].includes(t) ? t : 'leads';
}

function switchCrmTab(tab, options = {}) {
  const next = ['leads', 'contacts'].includes(tab) ? tab : 'leads';
  document.querySelectorAll('.crm-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === next));
  document.querySelectorAll('.crm-section').forEach(sec => sec.classList.toggle('active', sec.id === `crm-tab-${next}`));
  document.querySelectorAll('[data-crm-action]').forEach(btn => { btn.hidden = btn.dataset.crmAction !== next; });
  if (options.syncUrl !== false) {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
  }
}

// ---------- load + render ----------
async function loadCrm() {
  const q = crmQuery();
  const [summary, leads, contacts, companies] = await Promise.all([
    fetchJson(`/api/crm/summary?${q}`).catch(() => ({})),
    fetchJson(`/api/crm/leads?${q}`).catch(() => []),
    fetchJson(`/api/crm/contacts?${q}`).catch(() => []),
    fetchJson('/api/company-registry').catch(() => [])
  ]);
  leadsDb = Array.isArray(leads) ? leads : [];
  contactsDb = Array.isArray(contacts) ? contacts : [];
  companiesDb = Array.isArray(companies) ? companies : [];
  renderSummary(summary || {});
  renderLeads();
  renderContacts();
}

function renderSummary(summary) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('crm-stat-open', summary.open_leads || 0);
  set('crm-stat-value', money(summary.open_value || 0));
  set('crm-stat-won', summary.won_leads || 0);
  set('crm-stat-contacts', summary.contacts || 0);
}

// ---------- company picker (searchable, bound to master data / company_registry) ----------
function companyPickerInput(prefix) {
  const input = document.getElementById(`${prefix}-company`);
  const results = document.getElementById(`${prefix}-company-results`);
  const hidden = document.getElementById(`${prefix}-company-id`);
  if (!input || !results) return;
  const q = String(input.value || '').trim().toLowerCase();
  // typing something that no longer matches the linked company unlinks it (free text still allowed)
  if (hidden && hidden.value) {
    const linked = companiesDb.find(c => Number(c.id) === Number(hidden.value));
    if (!linked || String(linked.company_name || '').trim().toLowerCase() !== q) hidden.value = '';
  }
  const matches = (q
    ? companiesDb.filter(c =>
        String(c.company_name || '').toLowerCase().includes(q) ||
        String(c.contact_person || '').toLowerCase().includes(q) ||
        String(c.company_no || '').toLowerCase().includes(q))
    : companiesDb.slice()
  ).slice(0, 8);
  if (!companiesDb.length) {
    results.innerHTML = `<div class="crm-company-empty">No companies in master data yet.</div>`;
  } else if (!matches.length) {
    results.innerHTML = `<div class="crm-company-empty">No match — “${escHtml(input.value)}” will be saved as free text.</div>`;
  } else {
    results.innerHTML = matches.map(c => {
      const sub = [c.company_no, c.contact_person].filter(Boolean).join(' • ');
      return `<button type="button" class="crm-company-option" onclick="selectCompany('${prefix}', ${Number(c.id)})">
        <span class="crm-company-option-name">${escHtml(c.company_name || '')}</span>
        ${sub ? `<span class="crm-company-option-sub">${escHtml(sub)}</span>` : ''}
      </button>`;
    }).join('');
  }
  results.hidden = false;
}

function selectCompany(prefix, id) {
  const c = companiesDb.find(x => Number(x.id) === Number(id));
  if (!c) return;
  const input = document.getElementById(`${prefix}-company`);
  const hidden = document.getElementById(`${prefix}-company-id`);
  const results = document.getElementById(`${prefix}-company-results`);
  if (input) input.value = c.company_name || '';
  if (hidden) hidden.value = c.id;
  if (results) { results.hidden = true; results.innerHTML = ''; }
  // pull details from master data, but never overwrite what the user already typed
  const setIfEmpty = (elId, val) => { const el = document.getElementById(elId); if (el && !String(el.value || '').trim() && val) el.value = val; };
  if (prefix === 'lead') {
    setIfEmpty('lead-contact', c.contact_person || '');
    setIfEmpty('lead-email', c.email || '');
    setIfEmpty('lead-phone', c.phone || '');
  } else if (prefix === 'contact') {
    setIfEmpty('contact-email', c.email || '');
    setIfEmpty('contact-phone', c.phone || '');
  }
}

function resetCompanyPicker(prefix) {
  const hidden = document.getElementById(`${prefix}-company-id`);
  const results = document.getElementById(`${prefix}-company-results`);
  if (hidden) hidden.value = '';
  if (results) { results.hidden = true; results.innerHTML = ''; }
}

// click outside any open picker closes its dropdown
document.addEventListener('click', (e) => {
  document.querySelectorAll('.crm-company-results').forEach(panel => {
    const wrap = panel.closest('.crm-company-search');
    if (wrap && !wrap.contains(e.target)) panel.hidden = true;
  });
});

function renderLeads() {
  ensureCrmPipelineStyles();
  renderLeadsBoard();
  renderLeadsPipelineMetrics();
  const tbody = document.getElementById('leads-tbody');
  if (!tbody) return;
  const stageFilter = String(document.getElementById('leads-stage-filter')?.value || '').toLowerCase();
  const search = String(document.getElementById('leads-search')?.value || '').trim().toLowerCase();
  const rows = leadsDb.filter(row => {
    if (stageFilter && String(row.stage || '').toLowerCase() !== stageFilter) return false;
    if (!search) return true;
    return [row.lead_docno, row.lead_name, row.company_name, row.contact_name, row.email, row.source, row.owner]
      .some(v => String(v || '').toLowerCase().includes(search));
  });
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="crm-empty">No leads yet. Click “New Lead” to add one.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(row => {
    const stage = String(row.stage || '').toLowerCase();
    const status = String(row.approval_status || 'approved').toLowerCase();
    const isWon = stage === 'won';
    const convertedId = Number(row.converted_project_id || 0);
    // Draft/approval workflow buttons by role + status.
    const submitBtn = (isStaffUser() && (status === 'draft' || status === 'rejected'))
      ? `<button class="btn btn-save btn-xs" type="button" onclick="submitLead(${Number(row.id)})">Submit</button>` : '';
    const approveBtn = (isAdminUser() && status === 'pending')
      ? `<button class="btn btn-save btn-xs" type="button" onclick="approveLead(${Number(row.id)})">Approve</button>` : '';
    const rejectBtn = (isAdminUser() && status === 'pending')
      ? `<button class="btn btn-cancel btn-xs" type="button" onclick="rejectLead(${Number(row.id)})">Reject</button>` : '';
    // Already-converted leads show a link to the project (any role). Otherwise the Convert button
    // is admin-only and only for an APPROVED, Won lead.
    let convertCell = '';
    if (convertedId) {
      convertCell = `<a class="btn btn-pdf btn-xs" href="/admin?panel=project-records" title="View in Projects">&rarr; ${escHtml(row.converted_project_docno || 'Project')}</a>`;
    } else if (isWon && isAdminUser() && status === 'approved') {
      convertCell = `<button class="btn btn-add btn-xs" type="button" onclick="openConvertModal(${Number(row.id)})">Convert to Project</button>`;
    }
    // Per-record audit timeline (admin only — the /api/audit endpoint is admin-gated).
    const histTitle = String(row.lead_docno || ('Lead #' + Number(row.id))).replace(/'/g, '');
    const historyBtn = isAdminUser()
      ? `<button class="btn btn-pdf btn-xs" type="button" onclick="openRecordHistory('crm_lead', ${Number(row.id)}, '${escHtml(histTitle)}')" title="View history">History</button>` : '';
    return `
    <tr>
      <td><span class="crm-docno">${escHtml(row.lead_docno || '-')}</span></td>
      <td>${escHtml(row.lead_name || '-')}</td>
      <td>${escHtml(row.company_name || '-')}</td>
      <td>${escHtml(row.contact_name || '-')}${row.email ? `<div class="crm-sub">${escHtml(row.email)}</div>` : ''}</td>
      <td>${stageBadge(row.stage)}${approvalBadge(row.approval_status)}</td>
      <td class="text-right">${money(row.estimated_value)}</td>
      <td>${escHtml(row.source || '-')}</td>
      <td>${escHtml(row.owner || '-')}</td>
      <td class="text-right crm-row-actions">
        ${submitBtn}${approveBtn}${rejectBtn}${convertCell}${historyBtn}
        <button class="btn btn-edit btn-xs" type="button" onclick="editLead(${Number(row.id)})">Edit</button>
        <button class="btn btn-cancel btn-xs" type="button" onclick="deleteLead(${Number(row.id)})">Archive</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Pipeline board (Kanban) + metrics + drag-to-change-stage ──────────────────
let crmLeadsView = 'table';
let crmDraggedLeadId = null;

function ensureCrmPipelineStyles() {
  if (document.getElementById('crm-pipeline-styles')) return;
  const style = document.createElement('style');
  style.id = 'crm-pipeline-styles';
  style.textContent = `
    .crm-pipeline-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:12px 0;}
    .crm-metric{border:1px solid #eadfda;border-radius:10px;padding:10px 14px;background:#fff;}
    .crm-metric span{display:block;font-size:.64rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#8a7d75;}
    .crm-metric strong{display:block;font-size:1.1rem;font-weight:800;color:#3a2c25;margin-top:2px;}
    .crm-metric em{font-size:.7rem;color:#a08a80;font-style:normal;}
    .crm-metric.is-won strong{color:#15803d;}
    .crm-view-toggle{display:inline-flex;border:1px solid #e5d9d2;border-radius:8px;overflow:hidden;}
    .crm-view-btn{border:0;background:#fff;color:#6b5d55;font-size:.78rem;font-weight:700;padding:7px 14px;cursor:pointer;}
    .crm-view-btn.active{background:var(--primary,#7a1f1f);color:#fff;}
    .crm-pipeline-board{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;align-items:start;}
    .crm-board-col{background:#f7f1ed;border:1px solid #eadfda;border-radius:12px;padding:8px;min-height:120px;transition:background .15s,border-color .15s;}
    .crm-board-col.is-drop-target{background:#fdeee9;border-color:var(--primary,#7a1f1f);}
    .crm-board-col-head{display:flex;align-items:center;justify-content:space-between;padding:4px 6px;}
    .crm-board-col-title{font-size:.74rem;font-weight:800;color:#3a2c25;text-transform:uppercase;letter-spacing:.03em;}
    .crm-board-col-count{font-size:.68rem;font-weight:800;color:#fff;background:var(--primary,#7a1f1f);border-radius:999px;padding:1px 8px;}
    .crm-board-col-total{font-size:.72rem;font-weight:700;color:#8a7d75;padding:0 6px 6px;}
    .crm-board-col-body{display:flex;flex-direction:column;gap:8px;min-height:40px;}
    .crm-board-card{background:#fff;border:1px solid #eadfda;border-radius:10px;padding:9px 11px;cursor:grab;box-shadow:0 1px 3px rgba(0,0,0,.04);}
    .crm-board-card:active{cursor:grabbing;}
    .crm-board-card.is-dragging{opacity:.45;}
    .crm-board-card-name{font-size:.82rem;font-weight:800;color:#3a2c25;}
    .crm-board-card-company{font-size:.72rem;color:#8a7d75;margin-top:1px;}
    .crm-board-card-foot{display:flex;align-items:center;justify-content:space-between;margin-top:6px;gap:6px;}
    .crm-board-card-value{font-size:.76rem;font-weight:800;color:#7a1f1f;}
    .crm-board-card-owner{font-size:.64rem;color:#a08a80;background:#f3e6e2;border-radius:999px;padding:1px 7px;white-space:nowrap;}
    .crm-board-empty{font-size:.72rem;color:#bbb;text-align:center;padding:8px;}
    @media(max-width:900px){.crm-pipeline-board{grid-template-columns:repeat(2,1fr);}}
  `;
  document.head.appendChild(style);
}

function setCrmLeadsView(view) {
  crmLeadsView = (view === 'board') ? 'board' : 'table';
  document.querySelectorAll('#crm-leads-view-toggle [data-crm-view]').forEach((b) => b.classList.toggle('active', b.dataset.crmView === crmLeadsView));
  const tableWrap = document.getElementById('leads-table-wrap');
  const board = document.getElementById('leads-board');
  const stageFilter = document.getElementById('leads-stage-filter');
  if (tableWrap) tableWrap.classList.toggle('is-hidden', crmLeadsView === 'board');
  if (board) board.classList.toggle('is-hidden', crmLeadsView !== 'board');
  if (stageFilter) stageFilter.style.display = crmLeadsView === 'board' ? 'none' : '';
}

// Board uses the search filter only (the stages ARE the columns), unlike the table's stage filter.
function leadsBoardSearchFiltered() {
  const search = String(document.getElementById('leads-search')?.value || '').trim().toLowerCase();
  return (Array.isArray(leadsDb) ? leadsDb : []).filter((row) => !search
    || [row.lead_docno, row.lead_name, row.company_name, row.contact_name, row.email, row.source, row.owner]
      .some((v) => String(v || '').toLowerCase().includes(search)));
}

function renderLeadCard(l) {
  return `<div class="crm-board-card" draggable="true" data-lead-id="${Number(l.id)}"
       ondragstart="onLeadDragStart(event, ${Number(l.id)})" ondragend="onLeadDragEnd(event)"
       onclick="editLead(${Number(l.id)})" title="I-drag papunta sa ibang stage, o i-click para i-edit">
    <div class="crm-board-card-name">${escHtml(l.lead_name || '-')}</div>
    <div class="crm-board-card-company">${escHtml(l.company_name || '-')}</div>
    <div class="crm-board-card-foot">
      <span class="crm-board-card-value">${money(l.estimated_value)}</span>
      ${l.owner ? `<span class="crm-board-card-owner">${escHtml(l.owner)}</span>` : ''}
    </div>
  </div>`;
}

function renderLeadsBoard() {
  const board = document.getElementById('leads-board');
  if (!board) return;
  const filtered = leadsBoardSearchFiltered();
  board.innerHTML = STAGES.map((stage) => {
    const stageLeads = filtered.filter((l) => String(l.stage || 'new').toLowerCase() === stage.key);
    const total = stageLeads.reduce((s, l) => s + Number(l.estimated_value || 0), 0);
    const cards = stageLeads.length ? stageLeads.map(renderLeadCard).join('') : '<div class="crm-board-empty">&mdash;</div>';
    return `
      <div class="crm-board-col crm-board-col-${escHtml(stage.key)}" data-stage="${escHtml(stage.key)}"
           ondragover="onLeadDragOver(event)" ondragleave="onLeadDragLeave(event)" ondrop="onLeadDrop(event, '${escHtml(stage.key)}')">
        <div class="crm-board-col-head">
          <span class="crm-board-col-title">${escHtml(stage.label)}</span>
          <span class="crm-board-col-count">${stageLeads.length}</span>
        </div>
        <div class="crm-board-col-total">${money(total)}</div>
        <div class="crm-board-col-body">${cards}</div>
      </div>`;
  }).join('');
}

function renderLeadsPipelineMetrics() {
  const el = document.getElementById('leads-pipeline-metrics');
  if (!el) return;
  const all = Array.isArray(leadsDb) ? leadsDb : [];
  const open = all.filter((l) => !['won', 'lost'].includes(String(l.stage || 'new').toLowerCase()));
  const won = all.filter((l) => String(l.stage || '').toLowerCase() === 'won');
  const lost = all.filter((l) => String(l.stage || '').toLowerCase() === 'lost');
  const openValue = open.reduce((s, l) => s + Number(l.estimated_value || 0), 0);
  const wonValue = won.reduce((s, l) => s + Number(l.estimated_value || 0), 0);
  const closed = won.length + lost.length;
  const winRate = closed ? Math.round((won.length / closed) * 100) : 0;
  el.innerHTML = `
    <div class="crm-metric"><span>Open Pipeline</span><strong>${money(openValue)}</strong><em>${open.length} active lead${open.length === 1 ? '' : 's'}</em></div>
    <div class="crm-metric is-won"><span>Won Value</span><strong>${money(wonValue)}</strong><em>${won.length} won</em></div>
    <div class="crm-metric"><span>Win Rate</span><strong>${winRate}%</strong><em>${won.length}W / ${lost.length}L</em></div>
  `;
}

function onLeadDragStart(e, id) {
  crmDraggedLeadId = Number(id) || 0;
  try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(id)); } catch (_) {}
  if (e.target && e.target.classList) e.target.classList.add('is-dragging');
}
function onLeadDragEnd(e) {
  if (e.target && e.target.classList) e.target.classList.remove('is-dragging');
  document.querySelectorAll('.crm-board-col.is-drop-target').forEach((c) => c.classList.remove('is-drop-target'));
}
function onLeadDragOver(e) {
  e.preventDefault();
  try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
  if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.add('is-drop-target');
}
function onLeadDragLeave(e) {
  if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.remove('is-drop-target');
}
async function onLeadDrop(e, stageKey) {
  e.preventDefault();
  if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.remove('is-drop-target');
  const id = crmDraggedLeadId || Number((e.dataTransfer && e.dataTransfer.getData('text/plain')) || 0);
  crmDraggedLeadId = null;
  if (!id) return;
  const row = (Array.isArray(leadsDb) ? leadsDb : []).find((l) => Number(l.id) === Number(id));
  if (!row) return;
  if (String(row.stage || 'new').toLowerCase() === String(stageKey).toLowerCase()) return;
  await updateLeadStage(row, stageKey);
}

// Move a lead to a new stage (drag-and-drop). Re-sends the lead's existing fields with the new stage,
// then reloads. The server enforces who may edit (e.g. staff/approval rules).
async function updateLeadStage(row, stageKey) {
  const payload = {
    business_entity_id: row.business_entity_id,
    lead_name: row.lead_name,
    company_name: row.company_name,
    company_id: row.company_id || null,
    contact_name: row.contact_name,
    email: row.email,
    phone: row.phone,
    stage: stageKey,
    priority: row.priority,
    estimated_value: Number(row.estimated_value || 0) || 0,
    expected_close_date: row.expected_close_date || null,
    next_follow_up_date: row.next_follow_up_date || null,
    source: row.source,
    owner: row.owner,
    lost_reason: row.lost_reason,
    notes: row.notes
  };
  try {
    await fetchJson(`/api/crm/leads/${Number(row.id)}`, { method: 'PUT', body: JSON.stringify(payload) });
    if (typeof showToast === 'function') showToast(`Lead na-move sa "${stageLabel(stageKey)}".`, 'success');
    await loadCrm();
  } catch (err) {
    if (typeof showToast === 'function') showToast(err.message || 'Hindi ma-move ang lead.', 'error');
  }
}

function renderContacts() {
  const tbody = document.getElementById('contacts-tbody');
  if (!tbody) return;
  const search = String(document.getElementById('contacts-search')?.value || '').trim().toLowerCase();
  const rows = contactsDb.filter(row => {
    if (!search) return true;
    return [row.contact_name, row.company_name, row.position, row.email, row.phone]
      .some(v => String(v || '').toLowerCase().includes(search));
  });
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="crm-empty">No contacts yet. Click “New Contact” to add one.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(row => `
    <tr>
      <td>${escHtml(row.contact_name || '-')}</td>
      <td>${escHtml(row.company_name || '-')}</td>
      <td>${escHtml(row.position || '-')}</td>
      <td>${escHtml(row.email || '-')}</td>
      <td>${escHtml(row.phone || '-')}</td>
      <td class="text-right crm-row-actions">
        <button class="btn btn-edit btn-xs" type="button" onclick="editContact(${Number(row.id)})">Edit</button>
        <button class="btn btn-cancel btn-xs" type="button" onclick="deleteContact(${Number(row.id)})">Archive</button>
      </td>
    </tr>`).join('');
}

// ---------- lead modal ----------
// Fill the Lead modal's Business Entity dropdown; defaults to the active workspace
// (or the default entity when you're on "All Companies"). The chosen entity codes the Lead No.
function populateLeadEntityOptions(selectedId) {
  const sel = document.getElementById('lead-business-entity-id');
  if (!sel) return;
  sel.innerHTML = businessEntitiesDb
    .map((e) => `<option value="${Number(e.id)}">${escHtml(e.company_name || ('Entity #' + e.id))}</option>`)
    .join('');
  let target = (selectedId != null && String(selectedId).trim()) ? String(selectedId) : '';
  if (!target) {
    const ctx = getCurrentBusinessEntityId();
    target = (ctx && ctx !== 'all') ? ctx : getDefaultBusinessEntityId();
  }
  if (target) sel.value = String(target);
}

// Preview the next entity-coded Lead No for the selected Business Entity. Editing keeps its
// assigned number; the server stamps the authoritative one on save.
async function refreshLeadDocnoPreview() {
  if (editingLeadId) return;
  const docnoEl = document.getElementById('lead-docno');
  const ent = String(document.getElementById('lead-business-entity-id')?.value || '').trim() || getWritableBusinessEntityId();
  try {
    const data = await fetchJson(`/api/crm/leads/next-docno?business_entity_id=${encodeURIComponent(ent)}`);
    if (docnoEl) docnoEl.value = data.docno || '';
  } catch (_) { /* leave blank — server assigns the real number */ }
}

// Lost Reason only applies to a lost lead — show/hide it as the Stage changes.
function onLeadStageChange() {
  const field = document.getElementById('lead-lost-reason-field');
  if (!field) return;
  const isLost = String(document.getElementById('lead-stage')?.value || '').toLowerCase() === 'lost';
  field.hidden = !isLost;
  if (!isLost) { const r = document.getElementById('lead-lost-reason'); if (r) r.value = ''; }
}

async function openLeadModal() {
  editingLeadId = null;
  document.getElementById('lead-modal-title').textContent = 'New Lead';
  document.getElementById('lead-form').reset();
  document.getElementById('lead-stage').value = 'new';
  onLeadStageChange();
  populateLeadEntityOptions();
  resetCompanyPicker('lead');
  const docnoEl = document.getElementById('lead-docno');
  if (docnoEl) docnoEl.value = '';
  openBackdrop('lead-modal');
  await refreshLeadDocnoPreview();
}

function editLead(id) {
  const row = leadsDb.find(r => Number(r.id) === Number(id));
  if (!row) return;
  editingLeadId = Number(id);
  document.getElementById('lead-modal-title').textContent = 'Edit Lead';
  document.getElementById('lead-docno').value = row.lead_docno || '';
  document.getElementById('lead-name').value = row.lead_name || '';
  populateLeadEntityOptions(row.business_entity_id);
  document.getElementById('lead-company').value = row.company_name || '';
  document.getElementById('lead-company-id').value = row.company_id || '';
  document.getElementById('lead-company-results').hidden = true;
  document.getElementById('lead-contact').value = row.contact_name || '';
  document.getElementById('lead-email').value = row.email || '';
  document.getElementById('lead-phone').value = row.phone || '';
  document.getElementById('lead-stage').value = String(row.stage || 'new').toLowerCase();
  document.getElementById('lead-priority').value = String(row.priority || 'medium').toLowerCase();
  document.getElementById('lead-value').value = row.estimated_value != null ? row.estimated_value : '';
  document.getElementById('lead-expected-close').value = row.expected_close_date ? String(row.expected_close_date).slice(0, 10) : '';
  document.getElementById('lead-followup').value = row.next_follow_up_date ? String(row.next_follow_up_date).slice(0, 10) : '';
  document.getElementById('lead-source').value = row.source || '';
  document.getElementById('lead-owner').value = row.owner || '';
  document.getElementById('lead-lost-reason').value = row.lost_reason || '';
  document.getElementById('lead-notes').value = row.notes || '';
  onLeadStageChange();
  openBackdrop('lead-modal');
}

function closeLeadModal() { closeBackdrop('lead-modal'); }

// Per-field error message for CRM modals (shown under the field). Required fields only —
// optional fields never get an error.
function setCrmFieldMessage(fieldName, message = '') {
  const text = String(message || '').trim();
  if (text && typeof window.notifyFieldError === 'function') window.notifyFieldError(text);
  document.querySelectorAll(`[data-crm-field-message="${fieldName}"]`).forEach((notice) => {
    notice.textContent = text;
    notice.style.display = text ? 'block' : 'none';
    const field = notice.closest('.field');
    if (field) field.classList.toggle('has-error', !!text);
  });
}

async function saveLead(event) {
  event.preventDefault();
  const payload = {
    business_entity_id: Number(document.getElementById('lead-business-entity-id')?.value) || getWritableBusinessEntityId(),
    lead_name: document.getElementById('lead-name').value.trim(),
    company_name: document.getElementById('lead-company').value.trim(),
    company_id: Number(document.getElementById('lead-company-id').value || 0) || null,
    contact_name: document.getElementById('lead-contact').value.trim(),
    email: document.getElementById('lead-email').value.trim(),
    phone: document.getElementById('lead-phone').value.trim(),
    stage: document.getElementById('lead-stage').value,
    priority: document.getElementById('lead-priority').value,
    estimated_value: Number(document.getElementById('lead-value').value || 0) || 0,
    expected_close_date: document.getElementById('lead-expected-close').value || null,
    next_follow_up_date: document.getElementById('lead-followup').value || null,
    source: document.getElementById('lead-source').value.trim(),
    owner: document.getElementById('lead-owner').value.trim(),
    lost_reason: document.getElementById('lead-lost-reason').value.trim(),
    notes: document.getElementById('lead-notes').value.trim()
  };
  setCrmFieldMessage('lead_name', '');
  if (!payload.lead_name) {
    setCrmFieldMessage('lead_name', 'Lead name is required.');
    const el = document.getElementById('lead-name');
    if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    return;
  }
  try {
    if (editingLeadId) {
      await fetchJson(`/api/crm/leads/${editingLeadId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showCrmStatus('Lead updated.');
    } else {
      await fetchJson('/api/crm/leads', { method: 'POST', body: JSON.stringify(payload) });
      showCrmStatus('Lead added.');
    }
    closeLeadModal();
    await loadCrm();
  } catch (err) {
    showCrmStatus(err.message || 'Unable to save lead.', 'error');
  }
}

async function deleteLead(id) {
  const ok = await showConfirm('Archive this lead? Mapupunta ito sa Archive Center (hindi binubura).', { title: 'Archive Lead', confirmLabel: 'Archive', type: 'danger' });
  if (!ok) return;
  try {
    await fetchJson(`/api/crm/leads/${Number(id)}`, { method: 'DELETE' });
    showCrmStatus('Lead archived.');
    await loadCrm();
  } catch (err) {
    showCrmStatus(err.message || 'Unable to archive lead.', 'error');
  }
}

// Convert a Won lead into a Project. Opens a small modal so the admin can pick which business
// entity / workspace the new project lands in (defaults to the lead's own entity).
let convertingLeadId = null;

function openConvertModal(id) {
  const row = leadsDb.find((r) => Number(r.id) === Number(id));
  if (!row) return;
  convertingLeadId = Number(id);
  document.getElementById('convert-lead-name').value =
    `${row.lead_docno ? row.lead_docno + ' — ' : ''}${row.lead_name || ''}`;
  const sel = document.getElementById('convert-entity');
  const leadEntity = String(row.business_entity_id || '');
  sel.innerHTML = businessEntitiesDb
    .filter((e) => String(e.id || ''))
    .map((e) => {
      const code = e.entity_code ? ` (${escHtml(e.entity_code)})` : '';
      const selected = String(e.id) === leadEntity ? ' selected' : '';
      return `<option value="${e.id}"${selected}>${escHtml(e.company_name || ('Entity ' + e.id))}${code}</option>`;
    })
    .join('');
  openBackdrop('convert-modal');
}

function closeConvertModal() { closeBackdrop('convert-modal'); convertingLeadId = null; }

async function confirmConvertLead(event) {
  if (event) event.preventDefault();
  if (!convertingLeadId) return;
  const entityId = document.getElementById('convert-entity').value;
  try {
    const data = await fetchJson(`/api/crm/leads/${convertingLeadId}/convert-to-project`, {
      method: 'POST', body: JSON.stringify({ business_entity_id: entityId })
    });
    closeConvertModal();
    showCrmStatus('Na-convert sa project ' + (data.project_docno || '') + '.');
    await loadCrm();
    if (data.project_id) {
      const goProjects = await showConfirm('Nagawa na ang project ' + (data.project_docno || '') + '. Pumunta sa Projects?', { title: 'Project Created', confirmLabel: 'Pumunta sa Projects', cancelLabel: 'Hindi muna', type: 'info' });
      if (goProjects) window.location.href = '/admin?panel=project-records';
    }
  } catch (err) {
    showCrmStatus(err.message || 'Unable to convert lead.', 'error');
  }
}

// ---------- draft/approval workflow ----------
async function submitLead(id) {
  const ok = await showConfirm('I-submit ang lead na ito para sa approval ng admin?', { title: 'Submit Lead', confirmLabel: 'I-submit', type: 'default' });
  if (!ok) return;
  try {
    await fetchJson(`/api/crm/leads/${Number(id)}/submit`, { method: 'POST', body: JSON.stringify({}) });
    showCrmStatus('Na-submit para sa approval.');
    await loadCrm();
  } catch (err) { showCrmStatus(err.message || 'Unable to submit.', 'error'); }
}

async function approveLead(id) {
  try {
    await fetchJson(`/api/crm/leads/${Number(id)}/approve`, { method: 'POST', body: JSON.stringify({}) });
    showCrmStatus('Lead approved.');
    await loadCrm();
  } catch (err) { showCrmStatus(err.message || 'Unable to approve.', 'error'); }
}

async function rejectLead(id) {
  const ok = await showConfirm('I-reject ang lead na ito? Pwedeng i-revise + i-resubmit ng staff.', { title: 'Reject Lead', confirmLabel: 'I-reject', type: 'danger' });
  if (!ok) return;
  try {
    await fetchJson(`/api/crm/leads/${Number(id)}/reject`, { method: 'POST', body: JSON.stringify({}) });
    showCrmStatus('Lead rejected.');
    await loadCrm();
  } catch (err) { showCrmStatus(err.message || 'Unable to reject.', 'error'); }
}

// ---------- contact modal ----------
function openContactModal() {
  editingContactId = null;
  document.getElementById('contact-modal-title').textContent = 'New Contact';
  document.getElementById('contact-form').reset();
  resetCompanyPicker('contact');
  openBackdrop('contact-modal');
}

function editContact(id) {
  const row = contactsDb.find(r => Number(r.id) === Number(id));
  if (!row) return;
  editingContactId = Number(id);
  document.getElementById('contact-modal-title').textContent = 'Edit Contact';
  document.getElementById('contact-name').value = row.contact_name || '';
  document.getElementById('contact-company').value = row.company_name || '';
  document.getElementById('contact-company-id').value = row.company_id || '';
  document.getElementById('contact-company-results').hidden = true;
  document.getElementById('contact-position').value = row.position || '';
  document.getElementById('contact-email').value = row.email || '';
  document.getElementById('contact-phone').value = row.phone || '';
  document.getElementById('contact-notes').value = row.notes || '';
  openBackdrop('contact-modal');
}

function closeContactModal() { closeBackdrop('contact-modal'); }

async function saveContact(event) {
  event.preventDefault();
  const payload = {
    business_entity_id: getWritableBusinessEntityId(),
    contact_name: document.getElementById('contact-name').value.trim(),
    company_name: document.getElementById('contact-company').value.trim(),
    company_id: Number(document.getElementById('contact-company-id').value || 0) || null,
    position: document.getElementById('contact-position').value.trim(),
    email: document.getElementById('contact-email').value.trim(),
    phone: document.getElementById('contact-phone').value.trim(),
    notes: document.getElementById('contact-notes').value.trim()
  };
  setCrmFieldMessage('contact_name', '');
  if (!payload.contact_name) {
    setCrmFieldMessage('contact_name', 'Contact name is required.');
    const el = document.getElementById('contact-name');
    if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    return;
  }
  try {
    if (editingContactId) {
      await fetchJson(`/api/crm/contacts/${editingContactId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showCrmStatus('Contact updated.');
    } else {
      await fetchJson('/api/crm/contacts', { method: 'POST', body: JSON.stringify(payload) });
      showCrmStatus('Contact added.');
    }
    closeContactModal();
    await loadCrm();
  } catch (err) {
    showCrmStatus(err.message || 'Unable to save contact.', 'error');
  }
}

async function deleteContact(id) {
  const ok = await showConfirm('Archive this contact? Mapupunta ito sa Archive Center (hindi binubura).', { title: 'Archive Contact', confirmLabel: 'Archive', type: 'danger' });
  if (!ok) return;
  try {
    await fetchJson(`/api/crm/contacts/${Number(id)}`, { method: 'DELETE' });
    showCrmStatus('Contact archived.');
    await loadCrm();
  } catch (err) {
    showCrmStatus(err.message || 'Unable to archive contact.', 'error');
  }
}

// ---------- modal backdrop helpers (shared-ui.css shows .modal-backdrop.open) ----------
function openBackdrop(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
}

function closeBackdrop(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
}

// Re-render workspace badge + data when the workspace switcher changes the entity.
window.addEventListener('storage', (e) => {
  if (e.key === BUSINESS_ENTITY_CONTEXT_KEY) { applyWorkspaceBadge(); loadCrm(); }
});
