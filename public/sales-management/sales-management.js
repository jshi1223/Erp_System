'use strict';

// Project-centric spine: Project -> [SI] -> SO -> DR -> AR.
// SI is OPTIONAL — a project can go straight to SO. The `source` link is
// therefore optional at every stage (see SALES_STAGE_FIELDS.required).
// NOTE: the Sales Quotation (SQ) stage was retired. Its entry is kept as a
// hidden (isVirtual) label so any legacy SQ records still resolve a name, but
// it is no longer a creatable/navigable tab and is skipped in the SI -> SO flow.
const SALES_TYPES = {
  'sales-request': { label: 'Sales Inquiry', next: 'sales-order', sourceLabel: '', sourceType: '' },
  'sales-quotation': { label: 'Quotation', next: 'sales-order', sourceLabel: 'Sales Inquiry', sourceType: 'sales-request', isVirtual: true },
  'sales-order': { label: 'SO', next: 'project-delivery', sourceLabel: 'Sales Inquiry', sourceType: 'sales-request' },
  'project-delivery': { label: 'Delivery Receipt', next: '', sourceLabel: 'SO', sourceType: 'sales-order' },
  'requests': { label: 'Requests', next: '', sourceLabel: '', sourceType: '', isVirtual: true }
};

function isSalesStaffView() {
  if (typeof isStaffUser === 'function') return Boolean(isStaffUser());
  const role = String(
    document.body?.dataset?.accessRole ||
    window.currentUser?.role ||
    ''
  ).trim().toLowerCase();
  return role === 'staff';
}

function getSalesAdminOnly() {
  return !isSalesStaffView();
}

const SALES_STAGE_FIELDS = {
  'sales-request': {
    sectionTitle: 'Sales Inquiry Details',
    descriptionLabel: 'Inquiry Details / Requirement',
    fields: ['company', 'project', 'contact', 'requested-date', 'target-date', 'line-items', 'notes'],
    required: ['company', 'project', 'contact', 'requested-date', 'target-date', 'line-items']
  },
  'sales-quotation': {
    sectionTitle: 'Quotation Details',
    descriptionLabel: 'Quoted Scope / Inclusions',
    fields: ['source', 'company', 'project', 'contact', 'title', 'requested-date', 'target-date', 'amount', 'payment-terms', 'quote-validity', 'description', 'notes'],
    required: ['company', 'project', 'title', 'requested-date', 'amount']
  },
  'sales-order': {
    sectionTitle: 'Sales Order Details',
    descriptionLabel: 'Confirmed Scope',
    fields: ['source', 'company', 'project', 'contact', 'title', 'requested-date', 'target-date', 'amount', 'payment-terms', 'downpayment', 'customer-po-ref', 'inventory-note', 'product', 'warehouse', 'quantity', 'unit-price', 'description', 'notes'],
    required: ['company', 'project', 'title', 'requested-date']
  },
  'project-delivery': {
    sectionTitle: 'Delivery Receipt Details',
    descriptionLabel: 'Delivery Notes / Received Items',
    fields: ['source', 'company', 'project', 'title', 'target-date', 'received-by', 'delivery-address', 'source-po', 'inventory-note', 'product', 'warehouse', 'quantity', 'unit-price', 'serials', 'description', 'notes'],
    required: ['company', 'project', 'title', 'target-date', 'received-by', 'product', 'warehouse', 'quantity']
  }
};

const SALES_FIELD_CONTROLS = {
  source: 'sales-source-record-id',
  company: 'sales-company-id',
  project: 'sales-project-id',
  title: 'sales-title',
  'requested-date': 'sales-requested-date',
  'target-date': 'sales-target-date',
  amount: 'sales-amount',
  product: 'sales-product-id',
  warehouse: 'sales-warehouse-id',
  quantity: 'sales-quantity',
  'quote-validity': 'sales-quote-validity',
  downpayment: 'sales-downpayment',
  'customer-po-ref': 'sales-customer-po-ref',
  'received-by': 'sales-received-by',
  'delivery-address': 'sales-delivery-address',
  'source-po': 'sales-source-po-id'
};

let salesRecords = [];
let companyRecords = [];
let projectRecords = [];
let inventoryProducts = [];
let inventoryWarehouses = [];
let purchaseOrders = [];
let deliverySerialUnits = [];
let activeSalesTab = getInitialSalesTab();
let editingSalesRecordId = null;

document.addEventListener('DOMContentLoaded', () => {
  bindSalesEvents();
  loadSalesModule();
});

function getInitialSalesTab() {
  const stored = String(document.body?.dataset?.initialSalesTab || '').trim().toLowerCase();
  const params = new URLSearchParams(window.location.search || '');
  const tab = String(params.get('tab') || stored || 'sales-request').trim().toLowerCase();
  if (isSalesStaffView()) {
    const staffAllowed = new Set(['sales-request', 'requests']);
    return staffAllowed.has(tab) ? tab : 'sales-request';
  }
  if (tab === 'requests') return 'requests';
  return SALES_TYPES[tab] && !SALES_TYPES[tab].isVirtual ? tab : 'sales-request';
}

function bindSalesEvents() {
  document.querySelectorAll('[data-sales-tab]').forEach((button) => {
    button.addEventListener('click', () => switchSalesTab(button.dataset.salesTab));
  });

  document.getElementById('sales-project-id')?.addEventListener('change', () => syncSalesProjectContext());
  document.getElementById('sales-product-id')?.addEventListener('change', () => loadDeliverySerialOptions());
  document.getElementById('sales-modal-close')?.addEventListener('click', closeSalesModal);
  document.getElementById('sales-cancel-btn')?.addEventListener('click', closeSalesModal);
  document.getElementById('sales-modal-backdrop')?.addEventListener('click', (event) => {
    if (event.target?.id === 'sales-modal-backdrop') closeSalesModal();
  });

  // Clear a field's inline error as soon as the user edits it.
  document.getElementById('sales-modal-backdrop')?.addEventListener('input', (event) => {
    const field = event.target?.closest?.('[data-sales-field]');
    if (!field || !field.classList.contains('has-error')) return;
    field.classList.remove('has-error');
    const key = field.getAttribute('data-sales-field');
    const msg = document.querySelector(`#sales-modal-backdrop [data-sales-field-message="${key}"]`);
    if (msg) {
      msg.textContent = '';
      msg.classList.add('is-hidden');
    }
  });
}

async function loadSalesModule() {
  await Promise.all([
    loadSalesRecords(),
    loadCompanyRecords(),
    loadProjectRecords(),
    loadInventoryProducts(),
    loadInventoryWarehouses(),
    loadPurchaseOrders()
  ]);
  populateReferenceSelects();
  applySalesTabVisibility();
  activeSalesTab = getInitialSalesTab();
  switchSalesTab(activeSalesTab, { syncUrl: false });
  openSalesModalFromUrl();
}

function applySalesTabVisibility() {
  const isStaff = isSalesStaffView();
  // Staff sees: Sales Inquiry (approved ones) + Requests (their drafts)
  // Admin sees: all tabs
  const staffAllowedTabs = new Set(['sales-request', 'requests']);
  document.querySelectorAll('[data-sales-tab]').forEach((btn) => {
    const tab = btn.dataset.salesTab;
    if (isStaff) btn.hidden = !staffAllowedTabs.has(tab);
    else btn.hidden = false;
  });
  // Summary cards are now rendered per active tab by renderSalesSummaryForTab().
}

async function loadSalesRecords() {
  const res = await fetch('/api/sales-management/records', { cache: 'no-store' });
  salesRecords = res.ok ? await res.json().catch(() => []) : [];
  if (!Array.isArray(salesRecords)) salesRecords = [];
  updateSalesSummary();
}

async function loadCompanyRecords() {
  const res = await fetch('/api/company-registry', { cache: 'no-store' });
  companyRecords = res.ok ? await res.json().catch(() => []) : [];
  if (!Array.isArray(companyRecords)) companyRecords = [];
}

async function loadProjectRecords() {
  const res = await fetch('/api/projects', { cache: 'no-store' });
  projectRecords = res.ok ? await res.json().catch(() => []) : [];
  if (!Array.isArray(projectRecords)) projectRecords = [];
}

async function loadInventoryProducts() {
  const res = await fetch('/api/inventory/products', { cache: 'no-store' });
  inventoryProducts = res.ok ? await res.json().catch(() => []) : [];
  if (!Array.isArray(inventoryProducts)) inventoryProducts = [];
}

async function loadInventoryWarehouses() {
  const res = await fetch('/api/inventory/warehouses', { cache: 'no-store' });
  inventoryWarehouses = res.ok ? await res.json().catch(() => []) : [];
  if (!Array.isArray(inventoryWarehouses)) inventoryWarehouses = [];
}

async function loadPurchaseOrders() {
  const res = await fetch('/api/procurement/purchase-orders', { cache: 'no-store' });
  purchaseOrders = res.ok ? await res.json().catch(() => []) : [];
  if (!Array.isArray(purchaseOrders)) purchaseOrders = [];
}

function switchSalesTab(tab, options = {}) {
  if (isSalesStaffView()) {
    const staffAllowed = new Set(['sales-request', 'requests']);
    activeSalesTab = staffAllowed.has(tab) ? tab : 'requests';
  } else {
    // Treat retired/virtual stages (e.g. the removed Sales Quotation) as invalid
    // tabs so a stale URL or link cannot reopen them; only 'requests' is virtual-but-navigable.
    const isNavigable = SALES_TYPES[tab] && (!SALES_TYPES[tab].isVirtual || tab === 'requests');
    activeSalesTab = isNavigable ? tab : 'sales-request';
  }
  document.querySelectorAll('[data-sales-tab]').forEach((button) => {
    const active = button.dataset.salesTab === activeSalesTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const rawLabel = SALES_TYPES[activeSalesTab].label;
  const label = (isSalesStaffView() && activeSalesTab === 'sales-request') ? 'Approved Inquiries' : rawLabel;
  const title = document.getElementById('active-tab-title');
  if (title) title.textContent = label;
  if (options.syncUrl !== false) {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', activeSalesTab);
    window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
  }
  renderSalesToolbarControls(activeSalesTab);
  syncSalesSidebarActiveLink();
  renderSalesSummaryForTab(activeSalesTab);
  renderSalesRecords();
}

function renderSalesToolbarControls(tab) {
  const actions = document.getElementById('module-toolbar-actions');
  if (!actions) return;
  const isStaff = isSalesStaffView();

  if (tab === 'requests') {
    const placeholder = isStaff ? 'Search your requests...' : 'Search pending requests by customer, title, or status...';
    const btnLabel = isStaff ? 'New Request' : 'Add Sales Inquiry';
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="sales-search" type="text" placeholder="${escAttr(placeholder)}" oninput="renderSalesRecords()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openSalesModal()">${escHtml(btnLabel)}</button>
    `;
    return;
  }

  const label = SALES_TYPES[tab]?.label || 'Record';
  const placeholder = {
    'sales-request': 'Search customer, project, or item...',
    'sales-quotation': 'Search customer, project, or title...',
    'sales-order': 'Search customer, project, or SO title...',
    'project-delivery': 'Search customer, project, or delivery...'
  }[tab] || 'Search...';

  // Staff on Sales Inquiry tab sees approved records only — hide add button
  if (isStaff && tab === 'sales-request') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="sales-search" type="text" placeholder="${escAttr(placeholder)}" oninput="renderSalesRecords()" />
      </div>`;
    return;
  }

  actions.innerHTML = `
    <div class="search-wrap top-search-bar module-toolbar-search">
      <input id="sales-search" type="text" placeholder="${escAttr(placeholder)}" oninput="renderSalesRecords()" />
    </div>
    <button class="btn btn-add btn-sm" type="button" onclick="openSalesModal()">Add ${escHtml(label)}</button>
  `;
}

function getSalesStageConfig(recordType = activeSalesTab) {
  return SALES_STAGE_FIELDS[recordType] || SALES_STAGE_FIELDS['sales-request'];
}

function syncSalesModalFields(recordType = activeSalesTab) {
  const config = getSalesStageConfig(recordType);
  const visible = new Set(config.fields || []);
  const required = new Set(config.required || []);
  document.querySelectorAll('[data-sales-field]').forEach((node) => {
    const key = node.dataset.salesField;
    node.hidden = !visible.has(key);
  });
  // Status is always hidden in the modal — visible in the table only
  const statusField = document.querySelector('[data-sales-field="status"]');
  if (statusField) statusField.hidden = true;

  Object.entries(SALES_FIELD_CONTROLS).forEach(([key, id]) => {
    const control = document.getElementById(id);
    if (!control) return;
    control.required = required.has(key);
    control.setAttribute('aria-required', required.has(key) ? 'true' : 'false');
  });

  const title = document.getElementById('sales-details-section-title');
  if (title) title.textContent = config.sectionTitle || 'Sales Details';
  // Keep the doc-no field always visible (mirrors PR No. field)
  const docNoField = document.getElementById('sales-doc-display')?.closest('.field');
  if (docNoField) docNoField.hidden = false;
  const descriptionLabel = document.getElementById('sales-description-label');
  if (descriptionLabel) descriptionLabel.textContent = config.descriptionLabel || 'Description / Scope';
  const contactLabel = document.getElementById('sales-contact-label');
  if (contactLabel) contactLabel.textContent = recordType === 'sales-request' ? 'Requested By' : 'Contact Person';
  const targetDateLabel = document.getElementById('sales-target-date-label');
  if (targetDateLabel) targetDateLabel.textContent = recordType === 'sales-request' ? 'Needed By' : 'Target / Delivery Date';

  document.querySelectorAll('.sales-request-required').forEach((node) => {
    node.hidden = recordType !== 'sales-request';
  });
  document.querySelectorAll('.project-required').forEach((node) => {
    node.hidden = !required.has('project');
  });
  document.querySelectorAll('.delivery-required').forEach((node) => {
    node.hidden = recordType !== 'project-delivery';
  });
}

function syncSalesSidebarActiveLink() {
  const targetHref = `/sales-management?tab=${activeSalesTab}`;
  document.querySelectorAll('#sidebar .sidebar-link').forEach((link) => {
    let isActive = false;
    try {
      const href = new URL(link.getAttribute('href') || '', window.location.origin);
      isActive = `${href.pathname}${href.search}` === targetHref;
    } catch (_) {
      isActive = false;
    }
    link.classList.toggle('active', isActive);
  });
}

// A project can only be linked once it is a real (approved) project — not while
// it is still a draft/submitted/needs-revision/rejected approval item. Mirrors
// Procurement's getVisibleProcurementProjects() so both modules behave the same.
function salesProjectIsSelectable(row = {}) {
  const status = String(row.status || '').trim().toLowerCase();
  if (['draft', 'submitted', 'needs_revision', 'rejected', 'cancelled'].includes(status)) return false;
  if (row.is_archived === true || Number(row.is_archived || 0) === 1) return false;
  return true;
}

function populateReferenceSelects() {
  const companySelect = document.getElementById('sales-company-id');
  if (companySelect) {
    companySelect.innerHTML = '<option value="">Select customer/company</option>' + companyRecords
      .map((row) => `<option value="${escAttr(row.id)}">${escHtml(row.company_name || row.client_name || `Company #${row.id}`)}</option>`)
      .join('');
  }

  const projectSelect = document.getElementById('sales-project-id');
  if (projectSelect) {
    projectSelect.innerHTML = '<option value="">Select linked project</option>' + projectRecords
      .filter(salesProjectIsSelectable)
      .map((row) => {
        const company = row.company_name || row.client_name || '';
        const label = `${row.project_docno || `Project #${row.id}`} - ${row.project_name || 'Untitled Project'}${company ? ` (${company})` : ''}`;
        return `<option value="${escAttr(row.id)}">${escHtml(label)}</option>`;
      })
      .join('');
  }

  const productCategorySelect = document.getElementById('sales-product-category');
  if (productCategorySelect) productCategorySelect.innerHTML = renderSalesCategoryOptions();
  populateSalesProductSelect();

  const warehouseSelect = document.getElementById('sales-warehouse-id');
  if (warehouseSelect) {
    warehouseSelect.innerHTML = '<option value="">Select warehouse</option>' + inventoryWarehouses
      .map((row) => `<option value="${escAttr(row.id)}">${escHtml(row.warehouse_code || '')}${row.warehouse_code ? ' - ' : ''}${escHtml(row.warehouse_name || `Warehouse #${row.id}`)}</option>`)
      .join('');
  }

  populateSourceSelect();
  setSalesLineItems([{}]);
}

function populateSourceSelect(currentId = null, recordType = (activeSalesTab === 'requests' ? 'sales-request' : activeSalesTab)) {
  const sourceSelect = document.getElementById('sales-source-record-id');
  if (!sourceSelect) return;
  const meta = SALES_TYPES[recordType] || SALES_TYPES['sales-request'];
  const sourceField = document.getElementById('sales-source-field');
  const sourceLabel = document.getElementById('sales-source-label');
  const sourceTypes = Array.isArray(meta.sourceType) ? meta.sourceType : [meta.sourceType].filter(Boolean);
  const hasSourceStage = Boolean(sourceTypes.length);

  if (sourceField) sourceField.hidden = !hasSourceStage;
  if (sourceLabel) sourceLabel.textContent = hasSourceStage ? `Source ${meta.sourceLabel}` : 'Source Record';
  if (!hasSourceStage) {
    sourceSelect.innerHTML = '<option value="">No source record</option>';
    sourceSelect.value = '';
    return;
  }

  const sourceRows = salesRecords
    .filter((row) => Number(row.id || 0) !== Number(currentId || 0))
    .filter((row) => sourceTypes.includes(String(row.record_type || '')));
  sourceSelect.innerHTML = `<option value="">Select ${escHtml(meta.sourceLabel.toLowerCase())}</option>` + sourceRows
    .map((row) => `<option value="${escAttr(row.id)}">${escHtml(row.document_no || '')} - ${escHtml(row.title || '')}</option>`)
    .join('');
}

function updateSalesSummary() {
  renderSalesSummaryForTab(activeSalesTab || getInitialSalesTab());
}

// Build the summary cards for the active stage tab (Total / Pending / Approved /
// Total Value), mirroring the per-tab metric cards used in Procurement.
function renderSalesSummaryForTab(tab) {
  const grid = document.getElementById('sales-summary-grid');
  if (!grid) return;
  const norm = (s) => String(s || '').trim().toLowerCase();
  const pendingStatuses = ['draft', 'submitted', 'in_review'];
  const doneStatuses = ['approved', 'won', 'sent', 'delivered', 'completed'];
  const isRequests = tab === 'requests';
  const stageType = isRequests ? 'sales-request' : (SALES_TYPES[tab] ? tab : 'sales-request');

  let rows = salesRecords.filter((row) => row.record_type === stageType);
  if (isRequests) rows = rows.filter((row) => pendingStatuses.includes(norm(row.status)));

  const total = rows.length;
  const pending = rows.filter((row) => pendingStatuses.includes(norm(row.status))).length;
  const approved = rows.filter((row) => doneStatuses.includes(norm(row.status))).length;
  const value = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const label = (SALES_TYPES[stageType] && SALES_TYPES[stageType].label) || 'Records';

  const cards = isRequests
    ? [
        { label: 'Pending Requests', value: total, hint: 'Awaiting action', tone: 'pending' },
        { label: 'Drafts', value: rows.filter((row) => norm(row.status) === 'draft').length, hint: 'Not yet submitted', tone: '' },
        { label: 'Submitted', value: rows.filter((row) => norm(row.status) === 'submitted').length, hint: 'For admin approval', tone: 'pending' },
        { label: 'Total Value', value: formatCurrency(value), hint: 'Across pending requests', tone: 'value' }
      ]
    : [
        { label: `Total ${label}`, value: total, hint: `All ${label} records`, tone: '' },
        { label: 'Pending', value: pending, hint: 'Draft / submitted', tone: 'pending' },
        { label: 'Approved', value: approved, hint: 'Approved / advanced', tone: 'approved' },
        { label: 'Total Value', value: formatCurrency(value), hint: `Sum of ${label} amounts`, tone: 'value' }
      ];

  grid.innerHTML = cards.map((card) => `
    <div class="module-summary-card sales-summary-card"${card.tone ? ` data-tone="${escAttr(card.tone)}"` : ''}>
      <span class="module-summary-label">${escHtml(card.label)}</span>
      <div class="module-summary-value">${escHtml(String(card.value))}</div>
      <span class="module-summary-hint">${escHtml(card.hint)}</span>
    </div>
  `).join('');
}

function renderSalesRecords() {
  const tbody = document.getElementById('sales-records-body');
  if (!tbody) return;
  const query = String(document.getElementById('sales-search')?.value || '').trim().toLowerCase();

  if (activeSalesTab === 'requests') {
    const isStaff = isSalesStaffView();
    const userId = window.currentUser?.id || null;
    const rows = salesRecords
      .filter((row) => row.record_type === 'sales-request' && ['draft', 'submitted'].includes(String(row.status || '')))
      .filter((row) => {
        if (isStaff && userId) return Number(row.created_by || 0) === Number(userId);
        return true;
      })
      .filter((row) => {
        if (!query) return true;
        return [row.document_no, row.company_name, row.project_name, row.title, row.status].some((v) => String(v || '').toLowerCase().includes(query));
      });

    if (!rows.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="10">${escHtml(isStaff ? 'No pending requests yet. Click Add Request to submit one.' : 'No pending requests.')}</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((row) => renderSalesRow(row, { showPromote: false, isRequestsTab: true })).join('');
    return;
  }

  const rows = salesRecords
    .filter((row) => {
      if (row.record_type !== activeSalesTab) return false;
      // Staff sees only non-draft Sales Inquiries (admin-approved/processed ones)
      if (isSalesStaffView() && activeSalesTab === 'sales-request') {
        return !['draft', 'submitted'].includes(String(row.status || '').toLowerCase());
      }
      return true;
    })
    .filter((row) => {
      if (!query) return true;
      return [
        row.document_no,
        row.company_name,
        row.project_name,
        row.project_docno,
        row.title,
        row.description,
        row.status
      ].some((value) => String(value || '').toLowerCase().includes(query));
    });

  if (!rows.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="10">No ${escHtml(SALES_TYPES[activeSalesTab].label.toLowerCase())} records yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((row) => renderSalesRow(row)).join('');
}

function getSalesRowClass(row) {
  const status = String(row.status || '').toLowerCase();
  if (['cancelled', 'rejected'].includes(status)) return 'row-cancelled';
  if (['completed', 'delivered', 'won'].includes(status)) return 'row-completed';
  if (status === 'draft') return 'row-draft';
  if (row.target_date) {
    const today = new Date(); today.setHours(0,0,0,0);
    const target = new Date(row.target_date); target.setHours(0,0,0,0);
    if (target < today && !['completed','delivered','cancelled','won'].includes(status)) return 'row-overdue';
    const diff = Math.round((target - today) / 86400000);
    if (diff <= 3) return 'row-at-risk';
  }
  return '';
}

function renderSalesRow(row, options = {}) {
  const showPromote = options.showPromote !== false;
  const isRequestsTab = Boolean(options.isRequestsTab);
  const rowClass = getSalesRowClass(row);
  const targetDateHtml = row.target_date
    ? `${escHtml(formatDate(row.target_date))}${typeof relativeDateHtml === 'function' ? relativeDateHtml(row.target_date) : ''}`
    : '-';
  return `
    <tr${rowClass ? ` class="${rowClass}"` : ''}>
      <td><strong>${escHtml(row.document_no || '-')}</strong></td>
      <td>${escHtml(row.company_name || '-')}<div class="muted">${escHtml(row.contact_person || '')}</div></td>
      <td>${escHtml(row.project_docno || '')}${row.project_docno ? '<br>' : ''}<span class="muted">${escHtml(row.project_name || '-')}</span></td>
      <td>${escHtml(row.title || '-')}<div class="muted">${escHtml(row.description || '')}</div>${renderSalesInventoryMeta(row)}</td>
      <td>${escHtml(row.source_document_no || '-')}<div class="muted">${escHtml(row.source_title || '')}</div></td>
      <td>${formatDate(row.requested_date)}</td>
      <td>${targetDateHtml}</td>
      <td class="text-right">${formatCurrency(row.amount)}</td>
      <td><span class="status-chip status-${escAttr(String(row.status || '').replace(/[^a-z0-9_ -]/gi, '').replace(/\s+/g, '_'))}">${escHtml(formatStatus(row.status))}</span></td>
      <td>
        <div class="sales-row-actions">
          ${showPromote ? renderPromoteButton(row) : ''}
          ${renderInvoiceButton(row)}
          ${renderApproveButton(row, isRequestsTab)}
          <button class="btn btn-cancel btn-sm" type="button" onclick="editSalesRecord(${Number(row.id)})">Edit</button>
          <button class="btn btn-danger btn-sm" type="button" onclick="deleteSalesRecord(${Number(row.id)})">Delete</button>
        </div>
      </td>
    </tr>
  `;
}

function renderApproveButton(row, isRequestsTab) {
  const status = String(row.status || '').toLowerCase();
  if (isRequestsTab && status === 'draft') {
    return `<button class="btn btn-primary btn-sm" type="button" onclick="submitSalesRequest(${Number(row.id)})">Submit</button>`;
  }
  if (!isSalesStaffView() && status === 'submitted') {
    return `<button class="btn btn-add btn-sm" type="button" onclick="approveSalesRecord(${Number(row.id)})">Approve</button>`;
  }
  return '';
}

async function approveSalesRecord(id) {
  const record = salesRecords.find((row) => Number(row.id || 0) === Number(id || 0));
  if (!record) return;
  const res = await fetch(`/api/sales-management/records/${Number(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...record, status: 'approved' })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showToast(data.error || 'Unable to approve record.', 'error');
    return;
  }
  showToast(`${record.document_no || 'Record'} approved.`, 'success');
  await loadSalesRecords();
  renderSalesRecords();
}

function renderInvoiceButton(row) {
  if (String(row.record_type || '') !== 'project-delivery') return '';
  const status = String(row.status || '').toLowerCase();
  if (!['delivered', 'completed'].includes(status)) return '';
  if (row.ar_invoice_number) {
    return `<span class="status-chip status-approved" title="Invoice: ${escAttr(row.ar_invoice_number)}">&#x2713; ${escHtml(row.ar_invoice_number)}</span>`;
  }
  return `<button class="btn btn-primary btn-sm" type="button" onclick="generateDeliveryInvoice(${Number(row.id)})">Generate Invoice</button>`;
}

function renderSalesInventoryMeta(row = {}) {
  const product = String(row.product_name || row.sku || '').trim();
  if (!product) return '';
  const qty = Number(row.quantity || 0);
  const warehouse = String(row.warehouse_name || row.warehouse_code || '').trim();
  const posted = row.inventory_posted_at
    ? 'Inventory out posted'
    : (row.record_type === 'project-delivery' ? 'Pending delivery inventory out' : 'Carries forward to Delivery Receipt');
  return `<div class="muted">${escHtml(product)}${qty ? ` x ${escHtml(qty.toLocaleString('en-PH'))}` : ''}${warehouse ? ` | ${escHtml(warehouse)}` : ''} | ${escHtml(posted)}</div>`;
}

function renderPromoteButton(row) {
  const next = SALES_TYPES[row.record_type]?.next;
  if (!next) return '';
  return `<button class="btn btn-primary btn-sm" type="button" onclick="promoteSalesRecord(${Number(row.id)})">To ${escHtml(SALES_TYPES[next].label)}</button>`;
}

let salesNumberPreviewToken = 0;
// Preview the next sequential document number for a new record (mirrors the
// Procurement PR No. preview). The reserved number is finalized server-side on save.
async function loadSalesNumberPreview(recordType) {
  const input = document.getElementById('sales-doc-display');
  if (!input) return;
  const token = ++salesNumberPreviewToken;
  input.value = '';
  try {
    const params = new URLSearchParams({ record_type: String(recordType || '') });
    const res = await fetch(`/api/sales-management/records/next-number?${params.toString()}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (token !== salesNumberPreviewToken) return;
    if (res.ok && data && data.document_no) input.value = data.document_no;
  } catch (_) {
    if (token === salesNumberPreviewToken) input.value = '';
  }
}

function openSalesModal(record = null) {
  clearSalesFieldErrors();
  const isExistingRecord = Boolean(record && Number(record.id || 0));
  editingSalesRecordId = isExistingRecord ? Number(record.id || 0) : null;
  const recordType = record?.record_type || (activeSalesTab === 'requests' ? 'sales-request' : activeSalesTab);
  populateSourceSelect(editingSalesRecordId, recordType);
  syncSalesModalFields(recordType);
  const tabLabel = activeSalesTab === 'requests' ? (isSalesStaffView() ? 'Request' : 'Sales Inquiry') : SALES_TYPES[recordType].label;
  document.getElementById('sales-modal-title').textContent = isExistingRecord ? `Edit ${SALES_TYPES[record.record_type]?.label || 'Sales Record'}` : `New ${tabLabel}`;
  const saveBtn = document.getElementById('sales-save-btn');
  if (saveBtn) saveBtn.textContent = isExistingRecord ? 'Save Changes' : (isSalesStaffView() ? 'Submit Request' : 'Save Record');
  setValue('sales-record-id', editingSalesRecordId || '');
  setValue('sales-record-type', recordType);
  const docDisplay = document.getElementById('sales-doc-display');
  if (docDisplay) {
    if (isExistingRecord) {
      docDisplay.value = record?.document_no || '';
    } else {
      docDisplay.value = '';
      loadSalesNumberPreview(recordType);
    }
  }
  const docLabel = document.getElementById('sales-doc-no-label');
  if (docLabel) docLabel.textContent = SALES_TYPES[recordType]?.label ? `${SALES_TYPES[recordType].label} No.` : 'Doc No.';
  setValue('sales-status', record?.status || getDefaultSalesStatus(recordType));
  syncSalesStatusOptions();
  setValue('sales-company-id', record?.company_id || '');
  setValue('sales-project-id', record?.project_id || '');
  syncSalesProjectContext({ preserveExistingCompany: Boolean(record?.company_id) });
  setValue('sales-source-record-id', record?.source_record_id || '');
  setValue('sales-contact-person', record?.contact_person || '');
  setValue('sales-title', record?.title || '');
  setValue('sales-requested-date', toDateInputValue(record?.requested_date) || toDateInputValue(new Date()));
  setValue('sales-target-date', toDateInputValue(record?.target_date) || '');
  setValue('sales-amount', record?.amount || '');
  setValue('sales-product-id', record?.product_id || '');
  // Reflect the saved product's category in the filter dropdown when editing.
  const editProductCategory = String(getInventoryProductById(record?.product_id)?.category || '').trim();
  const editCategorySelect = document.getElementById('sales-product-category');
  if (editCategorySelect) editCategorySelect.value = editProductCategory;
  setValue('sales-warehouse-id', record?.warehouse_id || '');
  setValue('sales-quantity', record?.quantity || '');
  setValue('sales-unit-price', record?.unit_price || '');
  setValue('sales-payment-terms', record?.payment_terms || '');
  setValue('sales-quote-validity', toDateInputValue(record?.quote_validity) || '');
  setValue('sales-downpayment', Number(record?.downpayment || 0) > 0 ? Number(record?.downpayment || 0) : '');
  setValue('sales-customer-po-ref', record?.customer_po_ref || '');
  setValue('sales-received-by', record?.received_by || '');
  setValue('sales-delivery-address', record?.delivery_address || '');
  populateSalesSourcePoSelect(Number(record?.project_id || 0) || 0, Number(record?.source_po_id || 0) || 0);
  // Load the serial-unit checklist for this DR's product (pre-checks linked units).
  loadDeliverySerialOptions();
  setValue('sales-description', record?.description || '');
  setValue('sales-notes', record?.notes || '');
  setSalesLineItems(record?.line_items || [{}]);
  const backdrop = document.getElementById('sales-modal-backdrop');
  if (backdrop) {
    backdrop.hidden = false;
    backdrop.style.display = 'flex';
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
  }
  document.body.style.overflow = 'hidden';
}

function closeSalesModal() {
  editingSalesRecordId = null;
  clearSalesFieldErrors();
  document.querySelectorAll('#sales-modal-backdrop input:not([type=hidden]), #sales-modal-backdrop select, #sales-modal-backdrop textarea').forEach((el) => {
    if (el.tagName === 'SELECT') el.selectedIndex = 0;
    else el.value = '';
  });
  setSalesLineItems([{}]);
  const backdrop = document.getElementById('sales-modal-backdrop');
  if (backdrop) {
    backdrop.classList.remove('open');
    backdrop.style.display = 'none';
    backdrop.hidden = true;
    backdrop.setAttribute('aria-hidden', 'true');
  }
  document.body.style.overflow = '';
}

function openSalesModalFromUrl() {
  const params = new URLSearchParams(window.location.search || '');
  const shouldOpen = ['1', 'true', 'yes'].includes(String(params.get('new') || params.get('modal') || '').trim().toLowerCase());
  if (!shouldOpen) return;
  const projectId = Number(params.get('project_id') || 0) || null;
  const companyId = Number(params.get('company_id') || 0) || null;
  openSalesModal(projectId || companyId ? { project_id: projectId, company_id: companyId } : null);
  params.delete('new');
  params.delete('modal');
  params.delete('project_id');
  params.delete('company_id');
  const query = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`);
}

async function saveSalesRecord() {
  const lineItems = collectSalesLineItems();
  const itemSummary = lineItems.items.map((item) => item.item_name).filter(Boolean).join(' | ');
  const payload = {
    record_type: getValue('sales-record-type'),
    status: getValue('sales-status'),
    company_id: getValue('sales-company-id'),
    project_id: getValue('sales-project-id'),
    source_record_id: getValue('sales-source-record-id'),
    contact_person: getValue('sales-contact-person'),
    title: getValue('sales-record-type') === 'sales-request' ? (itemSummary || 'Sales Inquiry') : getValue('sales-title'),
    requested_date: getValue('sales-requested-date'),
    target_date: getValue('sales-target-date'),
    amount: getValue('sales-amount'),
    product_id: getValue('sales-product-id'),
    warehouse_id: getValue('sales-warehouse-id'),
    quantity: getValue('sales-quantity'),
    unit_price: getValue('sales-unit-price'),
    payment_terms: getValue('sales-payment-terms'),
    quote_validity: getValue('sales-quote-validity'),
    downpayment: getValue('sales-downpayment'),
    customer_po_ref: getValue('sales-customer-po-ref'),
    received_by: getValue('sales-received-by'),
    delivery_address: getValue('sales-delivery-address'),
    source_po_id: getValue('sales-source-po-id'),
    description: getValue('sales-description'),
    notes: getValue('sales-notes'),
    items: lineItems.items
  };

  // Delivery Receipt: which serial units are going out (auto-marked Sold on deliver).
  if (payload.record_type === 'project-delivery') {
    payload.serial_unit_ids = collectSelectedSerialIds();
  }

  const errors = collectSalesValidationErrors(payload, lineItems);

  if (payload.record_type === 'project-delivery' && ['delivered', 'completed'].includes(payload.status)) {
    const deliveryChecks = [
      { key: 'product', ok: Boolean(payload.product_id) },
      { key: 'warehouse', ok: Boolean(payload.warehouse_id) },
      { key: 'quantity', ok: Number(payload.quantity || 0) > 0 }
    ];
    deliveryChecks.forEach(({ key, ok }) => {
      if (!ok && !errors.some((e) => e.key === key)) {
        const label = { product: 'Inventory Product', warehouse: 'Source Warehouse', quantity: 'Quantity' }[key];
        errors.push({ key, message: `${label} is required before posting inventory out for a Delivered/Completed Delivery Receipt.` });
      }
    });
  }

  if (applySalesValidationErrors(errors)) return;

  const id = Number(getValue('sales-record-id') || 0);
  const res = await fetch(id ? `/api/sales-management/records/${id}` : '/api/sales-management/records', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const status = document.getElementById('sales-modal-status-message');
    if (status) {
      status.textContent = data.error || 'Unable to save sales record.';
      status.classList.remove('is-hidden');
    } else {
      alert(data.error || 'Unable to save sales record.');
    }
    return;
  }

  closeSalesModal();
  await loadSalesRecords();
  populateSourceSelect(null, payload.record_type);
  const nextTab = isSalesStaffView() ? 'requests' : payload.record_type;
  switchSalesTab(nextTab);
}

// Returns an array of { key, message } for every missing required field, so the
// modal can show an inline error under each field (instead of a single alert).
function collectSalesValidationErrors(payload = {}, lineItems = { items: [], incompleteRows: [] }) {
  const required = getSalesStageConfig(payload.record_type).required || [];
  const labels = {
    source: 'Source record',
    company: 'Customer / Company',
    project: 'Linked Project',
    contact: payload.record_type === 'sales-request' ? 'Requested By' : 'Contact Person',
    title: 'Subject / Title',
    'requested-date': 'Inquiry / Issue Date',
    'target-date': payload.record_type === 'sales-request' ? 'Needed By' : 'Target / Delivery Date',
    amount: 'Amount',
    product: 'Inventory Product',
    warehouse: 'Source Warehouse',
    quantity: 'Quantity',
    'received-by': 'Received By'
  };
  const values = {
    source: payload.source_record_id,
    company: payload.company_id,
    project: payload.project_id,
    contact: payload.contact_person,
    title: payload.title,
    'requested-date': payload.requested_date,
    'target-date': payload.target_date,
    amount: payload.amount,
    product: payload.product_id,
    warehouse: payload.warehouse_id,
    quantity: payload.quantity,
    'received-by': payload.received_by
  };
  const stageLabel = SALES_TYPES[payload.record_type]?.label || 'this stage';
  const errors = [];
  const seen = new Set();
  const pushError = (key, message) => {
    if (seen.has(key)) return;
    seen.add(key);
    errors.push({ key, message });
  };

  if (payload.record_type === 'sales-request') {
    if (!lineItems.items.length) {
      pushError('line-items', 'Select at least one product item for the Sales Inquiry.');
    } else if (lineItems.incompleteRows.length) {
      pushError('line-items', `Enter quantity for item ${lineItems.incompleteRows[0]}.`);
    }
  }

  required.forEach((key) => {
    let isMissing;
    if (key === 'line-items') isMissing = !lineItems.items.length;
    else if (key === 'amount' || key === 'quantity') isMissing = !(Number(values[key] || 0) > 0);
    else isMissing = !String(values[key] || '').trim();
    if (isMissing) pushError(key, `${labels[key] || 'Required field'} is required for ${stageLabel}.`);
  });

  return errors;
}

// Clear any inline field errors currently shown in the sales modal.
function clearSalesFieldErrors() {
  document.querySelectorAll('#sales-modal-backdrop .field.has-error').forEach((field) => field.classList.remove('has-error'));
  document.querySelectorAll('#sales-modal-backdrop [data-sales-field-message]').forEach((msg) => {
    msg.textContent = '';
    msg.classList.add('is-hidden');
  });
  const status = document.getElementById('sales-modal-status-message');
  if (status) {
    status.textContent = '';
    status.classList.add('is-hidden');
  }
}

// Highlight a field and show its inline message below the input.
function showSalesFieldError(key, message) {
  const field = document.querySelector(`#sales-modal-backdrop [data-sales-field="${key}"]`);
  if (field) field.classList.add('has-error');
  const msg = document.querySelector(`#sales-modal-backdrop [data-sales-field-message="${key}"]`);
  if (msg) {
    msg.textContent = message;
    msg.classList.remove('is-hidden');
  }
}

// Scroll to the first invalid field and focus its control so the user lands there.
function focusSalesField(key) {
  const field = document.querySelector(`#sales-modal-backdrop [data-sales-field="${key}"]`);
  if (!field) return;
  field.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const control = field.querySelector('input:not([type=hidden]), select, textarea');
  if (control) setTimeout(() => { try { control.focus({ preventScroll: true }); } catch (_) { control.focus(); } }, 160);
}

// Show validation errors inline; returns true when there is at least one error.
function applySalesValidationErrors(errors = []) {
  clearSalesFieldErrors();
  if (!errors.length) return false;
  errors.forEach((err) => showSalesFieldError(err.key, err.message));
  const status = document.getElementById('sales-modal-status-message');
  if (status) {
    status.textContent = errors.length === 1
      ? errors[0].message
      : `${errors.length} fields need to be filled out. Tingnan ang mga naka-highlight sa ibaba.`;
    status.classList.remove('is-hidden');
  }
  focusSalesField(errors[0].key);
  return true;
}

function syncSalesProjectContext(options = {}) {
  const projectId = Number(getValue('sales-project-id') || 0) || 0;
  // Refresh the Source PO list to only the POs of the chosen project.
  populateSalesSourcePoSelect(projectId, Number(getValue('sales-source-po-id') || 0) || 0);
  const project = projectRecords.find((row) => Number(row.id || 0) === projectId) || null;
  const companyId = Number(project?.company_id || project?.registry_company_id || 0) || 0;
  const companySelect = document.getElementById('sales-company-id');
  if (!companySelect || !companyId) return;
  if (options.preserveExistingCompany && Number(companySelect.value || 0)) return;
  companySelect.value = String(companyId);
}

// Source PO dropdown for the Delivery Receipt: lists purchase orders tied to the
// same project so delivered (esp. non-serialized) items trace back to their PO.
function populateSalesSourcePoSelect(projectId = 0, selectedId = 0) {
  const select = document.getElementById('sales-source-po-id');
  if (!select) return;
  const pid = Number(projectId || 0) || 0;
  const current = Number(selectedId || select.value || 0) || 0;
  const matches = purchaseOrders.filter((po) => {
    if (Number(po.id || 0) === current) return true; // keep the saved PO visible
    return pid ? Number(po.project_id || 0) === pid : true;
  });
  select.innerHTML = '<option value="">No source PO</option>' + matches
    .map((po) => {
      const id = Number(po.id || 0);
      const label = [po.po_number, po.vendor_name].filter(Boolean).join(' - ') || `PO #${id}`;
      return `<option value="${escAttr(id)}"${id === current ? ' selected' : ''}>${escHtml(label)}</option>`;
    })
    .join('');
}

function getSalesLineItemsContainer() {
  return document.getElementById('sales-line-items');
}

function getInventoryProductById(productId) {
  const id = Number(productId || 0) || 0;
  return inventoryProducts.find((row) => Number(row.id || 0) === id) || null;
}

// Single-product field (Sales Order / Delivery Receipt) — list inventory items,
// optionally filtered to one category. Keeps the currently selected item visible.
function populateSalesProductSelect(category = '') {
  const productSelect = document.getElementById('sales-product-id');
  if (!productSelect) return;
  const current = Number(productSelect.value || 0) || 0;
  const filter = String(category || '').trim().toLowerCase();
  productSelect.innerHTML = '<option value="">No inventory item</option>' + inventoryProducts
    .filter((row) => !filter || String(row.category || '').trim().toLowerCase() === filter || Number(row.id || 0) === current)
    .map((row) => `<option value="${escAttr(row.id)}"${Number(row.id || 0) === current ? ' selected' : ''}>${escHtml(row.sku || '')}${row.sku ? ' - ' : ''}${escHtml(row.product_name || `Product #${row.id}`)} (${Number(row.quantity_on_hand || 0).toLocaleString('en-PH')} on hand)</option>`)
    .join('');
}

function filterSalesProductByCategory() {
  const category = document.getElementById('sales-product-category')?.value || '';
  populateSalesProductSelect(category);
  loadDeliverySerialOptions();
}

// Loads in-stock serial units for the chosen product (plus any already tied to the
// DR being edited) and renders them as a checklist. Pre-checks the linked ones.
async function loadDeliverySerialOptions(preselectIds = null) {
  const picker = document.getElementById('sales-serial-picker');
  if (!picker) return;
  if (getValue('sales-record-type') !== 'project-delivery') {
    deliverySerialUnits = [];
    picker.innerHTML = '';
    return;
  }
  const productId = Number(getValue('sales-product-id') || 0) || 0;
  if (!productId) {
    deliverySerialUnits = [];
    picker.innerHTML = '<div class="sales-serial-empty">Pumili muna ng Inventory Product.</div>';
    return;
  }
  picker.innerHTML = '<div class="sales-serial-empty">Loading serial units...</div>';
  const res = await fetch(`/api/inventory/units?product_id=${encodeURIComponent(productId)}`, { cache: 'no-store' });
  const all = res.ok ? await res.json().catch(() => []) : [];
  const editingId = Number(editingSalesRecordId || 0) || 0;
  // In-stock units, plus any already assigned to THIS delivery (so edits keep them).
  deliverySerialUnits = (Array.isArray(all) ? all : []).filter((u) =>
    String(u.status || '') === 'in_stock' || (editingId && Number(u.sales_record_id || 0) === editingId));
  renderDeliverySerialOptions(preselectIds);
}

function renderDeliverySerialOptions(preselectIds = null) {
  const picker = document.getElementById('sales-serial-picker');
  if (!picker) return;
  const editingId = Number(editingSalesRecordId || 0) || 0;
  const preset = Array.isArray(preselectIds) ? new Set(preselectIds.map((v) => Number(v || 0) || 0)) : null;
  if (!deliverySerialUnits.length) {
    picker.innerHTML = '<div class="sales-serial-empty">Walang available na serial units para sa product na ito.</div>';
    return;
  }
  picker.innerHTML = deliverySerialUnits.map((u) => {
    const id = Number(u.id || 0);
    const checked = preset ? preset.has(id) : (editingId && Number(u.sales_record_id || 0) === editingId);
    const warranty = String(u.warranty_end || '').slice(0, 10);
    const meta = [warranty ? `warranty ${warranty}` : '', u.warehouse_code || u.warehouse_name || ''].filter(Boolean).join(' | ');
    return `<label class="sales-serial-item">
      <input type="checkbox" class="sales-serial-checkbox" value="${escAttr(id)}"${checked ? ' checked' : ''} />
      <span>${escHtml(u.serial_number || `Unit #${id}`)}${meta ? ` <span class="sales-serial-meta">(${escHtml(meta)})</span>` : ''}</span>
    </label>`;
  }).join('');
}

function collectSelectedSerialIds() {
  return Array.from(document.querySelectorAll('#sales-serial-picker .sales-serial-checkbox:checked'))
    .map((cb) => Number(cb.value || 0) || 0)
    .filter(Boolean);
}

function renderSalesCategoryOptions(selected = '') {
  const current = String(selected || '').trim();
  const categories = new Set();
  inventoryProducts.forEach((product) => {
    const category = String(product.category || '').trim();
    if (category) categories.add(category);
  });
  const options = ['<option value="">No category</option>'];
  categories.forEach((category) => {
    options.push(`<option value="${escAttr(category)}"${category === current ? ' selected' : ''}>${escHtml(category)}</option>`);
  });
  return options.join('');
}

function renderSalesProductOptions(selectedProductId = 0, category = '') {
  const selectedId = Number(selectedProductId || 0) || 0;
  const filterCategory = String(category || '').trim().toLowerCase();
  const options = ['<option value="">No inventory product</option>'];
  inventoryProducts
    .filter((product) => {
      if (!filterCategory) return true;
      return String(product.category || '').trim().toLowerCase() === filterCategory || Number(product.id || 0) === selectedId;
    })
    .forEach((product) => {
      const id = Number(product.id || 0);
      const meta = [product.sku, product.category, product.unit].filter(Boolean).join(' / ');
      options.push(`<option value="${escAttr(id)}"${id === selectedId ? ' selected' : ''}>${escHtml(product.product_name || `Product #${id}`)}${meta ? ` (${escHtml(meta)})` : ''}</option>`);
    });
  return options.join('');
}

function renderSalesWarehouseOptions(selectedWarehouseId = 0) {
  const selectedId = Number(selectedWarehouseId || 0) || 0;
  return '<option value="">No warehouse</option>' + inventoryWarehouses
    .map((row) => {
      const id = Number(row.id || 0);
      const label = [row.warehouse_code, row.warehouse_name].filter(Boolean).join(' - ') || `Warehouse #${id}`;
      return `<option value="${escAttr(id)}"${id === selectedId ? ' selected' : ''}>${escHtml(label)}</option>`;
    })
    .join('');
}

function renderSalesLineItemRow(item = {}, index = 0) {
  const productId = Number(item.product_id || item.productId || 0) || 0;
  const product = getInventoryProductById(productId);
  const category = String(item.category || product?.category || '').trim();
  const quantity = Number(item.quantity || item.qty || 1) > 0 ? Number(item.quantity || item.qty || 1) : 1;
  const unit = String(item.unit || product?.unit || '').trim();
  const unitPrice = Number(item.estimated_unit_price ?? item.unit_price ?? item.price ?? product?.selling_price ?? 0) || 0;
  const lineTotal = productId ? quantity * unitPrice : 0;
  const hasProduct = Boolean(productId);
  const dis = hasProduct ? '' : ' disabled';

  return `
    <div class="sales-line-item" data-sales-line-item data-line-index="${index}">
      <div class="field">
        <label>Category</label>
        <select class="sales-line-category" onchange="syncSalesLineCategory(this)">
          ${renderSalesCategoryOptions(category)}
        </select>
      </div>
      <div class="field">
        <label>Item ${index + 1}</label>
        <select class="sales-line-product" onchange="syncSalesLineProduct(this)">
          ${renderSalesProductOptions(productId, category)}
        </select>
      </div>
      <div class="sales-line-nums-grid">
        <div class="field">
          <label>Qty <span class="req-star">*</span></label>
          <input class="sales-line-qty" type="number" min="1" step="1"
                 value="${hasProduct ? escAttr(quantity) : ''}"
                 placeholder="1" oninput="syncSalesLineItem(this)"${dis} />
        </div>
        <div class="field">
          <label>Unit</label>
          <input class="sales-line-unit" type="text" placeholder="pcs"
                 value="${escAttr(unit)}" oninput="syncSalesLineItem(this)"${dis} />
        </div>
        <div class="field">
          <label>Unit Price</label>
          <input class="sales-line-unit-price" type="number" min="0" step="0.01"
                 placeholder="0.00"
                 value="${hasProduct && unitPrice ? escAttr(unitPrice.toFixed(2)) : ''}"
                 oninput="syncSalesLineItem(this)"${dis} />
        </div>
        <div class="field">
          <label>Line Total</label>
          <div class="sales-line-total">${formatCurrency(lineTotal)}</div>
        </div>
        <div class="field sales-line-action-field">
          <label>&nbsp;</label>
          <button class="btn btn-cancel btn-sm" type="button" onclick="removeSalesLineItem(this)">Remove</button>
        </div>
      </div>
    </div>
  `;
}

function setSalesLineItems(items = []) {
  const container = getSalesLineItemsContainer();
  if (!container) return;
  const rows = Array.isArray(items) && items.length ? items : [{}];
  container.innerHTML = rows.map((item, index) => renderSalesLineItemRow(item, index)).join('');
  recalculateSalesLineTotals();
}

function addSalesLineItem(item = {}) {
  const container = getSalesLineItemsContainer();
  if (!container) return;
  const index = container.querySelectorAll('[data-sales-line-item]').length;
  container.insertAdjacentHTML('beforeend', renderSalesLineItemRow(item, index));
  recalculateSalesLineTotals();
  container.querySelector('[data-sales-line-item]:last-child .sales-line-product')?.focus();
}

function removeSalesLineItem(button) {
  const row = button?.closest('[data-sales-line-item]');
  const container = getSalesLineItemsContainer();
  if (!row || !container) return;
  if (container.querySelectorAll('[data-sales-line-item]').length <= 1) {
    row.querySelectorAll('input, textarea, select').forEach((input) => {
      input.value = input.classList.contains('sales-line-qty') ? '1' : '';
    });
  } else {
    row.remove();
  }
  renumberSalesLineItems();
  recalculateSalesLineTotals();
}

function renumberSalesLineItems() {
  Array.from(getSalesLineItemsContainer()?.querySelectorAll('[data-sales-line-item]') || []).forEach((row, index) => {
    row.setAttribute('data-line-index', String(index));
    const labels = row.querySelectorAll('.field.full label');
    if (labels[0]) labels[0].innerHTML = `Item ${index + 1} Name <span class="req-star">*</span>`;
    if (labels[1]) labels[1].textContent = `Item ${index + 1} Description`;
  });
}

function syncSalesLineCategory(source) {
  const row = source?.closest('[data-sales-line-item]');
  if (!row) return;
  const productSelect = row.querySelector('.sales-line-product');
  if (productSelect) productSelect.innerHTML = renderSalesProductOptions(0, source.value);
  syncSalesLineItem(source);
}

function syncSalesLineProduct(source) {
  const row = source?.closest('[data-sales-line-item]');
  if (!row) return;

  const productId = Number(source?.value || 0);
  const product = getInventoryProductById(productId);
  const qtyInput       = row.querySelector('.sales-line-qty');
  const unitInput      = row.querySelector('.sales-line-unit');
  const unitPriceInput = row.querySelector('.sales-line-unit-price');
  const totalNode      = row.querySelector('.sales-line-total');

  if (!product) {
    // No product selected — clear and disable all value fields
    if (qtyInput)       { qtyInput.value = '';       qtyInput.disabled = true; }
    if (unitInput)      { unitInput.value = '';      unitInput.disabled = true; }
    if (unitPriceInput) { unitPriceInput.value = ''; unitPriceInput.disabled = true; }
    if (totalNode)      totalNode.textContent = formatCurrency(0);
    recalculateSalesLineTotals();
    return;
  }

  // Product selected — always overwrite with product data, enable fields
  // Keep the category dropdown in sync with the chosen product's category.
  const categorySelect = row.querySelector('.sales-line-category');
  if (categorySelect) {
    const productCategory = String(product.category || '').trim();
    if (productCategory && [...categorySelect.options].some((option) => option.value === productCategory)) {
      categorySelect.value = productCategory;
    }
  }
  if (qtyInput) {
    if (!Number(qtyInput.value || 0)) qtyInput.value = '1';
    qtyInput.disabled = false;
  }
  if (unitInput) {
    unitInput.value = product.unit || '';
    unitInput.disabled = false;
  }
  if (unitPriceInput) {
    unitPriceInput.value = Number(product.selling_price || 0) > 0
      ? Number(product.selling_price).toFixed(2)
      : '';
    unitPriceInput.disabled = false;
  }
  syncSalesLineItem(source);
}

function syncSalesLineItem(source) {
  const row = source?.closest('[data-sales-line-item]');
  if (!row) return;
  const qty = Number(row.querySelector('.sales-line-qty')?.value || 0);
  const unitPrice = Number(row.querySelector('.sales-line-unit-price')?.value || 0);
  const total = qty > 0 && unitPrice > 0 ? qty * unitPrice : 0;
  const totalNode = row.querySelector('.sales-line-total');
  if (totalNode) totalNode.textContent = formatCurrency(total);
  recalculateSalesLineTotals();
}

function recalculateSalesLineTotals() {
  let total = 0;
  Array.from(getSalesLineItemsContainer()?.querySelectorAll('[data-sales-line-item]') || []).forEach((row) => {
    const qty = Number(row.querySelector('.sales-line-qty')?.value || 0);
    const unitPrice = Number(row.querySelector('.sales-line-unit-price')?.value || 0);
    if (qty > 0 && unitPrice > 0) total += qty * unitPrice;
  });
  const totalEl = document.getElementById('sales-total-display');
  if (totalEl) totalEl.textContent = formatCurrency(total);
  if (activeSalesTab === 'sales-request' || getValue('sales-record-type') === 'sales-request') {
    setValue('sales-amount', total ? total.toFixed(2) : '');
  }
}

function collectSalesLineItems() {
  const rows = Array.from(getSalesLineItemsContainer()?.querySelectorAll('[data-sales-line-item]') || []);
  const items = [];
  const incompleteRows = [];
  rows.forEach((row, index) => {
    const productId = Number(row.querySelector('.sales-line-product')?.value || 0) || 0;
    const product = getInventoryProductById(productId);
    const itemName = product?.product_name || '';
    const quantity = Number(row.querySelector('.sales-line-qty')?.value || 0);
    const unit = String(row.querySelector('.sales-line-unit')?.value || '').trim();
    const unitPrice = Number(row.querySelector('.sales-line-unit-price')?.value || 0);
    if (!productId) return; // skip rows with no product selected
    if (quantity <= 0) {
      incompleteRows.push(index + 1);
      return;
    }
    items.push({
      product_id: productId,
      item_name: itemName,
      category: product?.category || null,
      quantity,
      unit,
      estimated_unit_price: unitPrice
    });
  });
  return { items, incompleteRows };
}

function editSalesRecord(id) {
  const record = salesRecords.find((row) => Number(row.id || 0) === Number(id || 0));
  if (!record) return;
  openSalesModal(record);
}

async function deleteSalesRecord(id) {
  const record = salesRecords.find((row) => Number(row.id || 0) === Number(id || 0));
  if (!record) return;
  const confirmed = typeof showConfirm === 'function'
    ? await showConfirm(`Delete ${record.document_no || 'this sales record'}?\n\nThis action cannot be undone.`, { title: 'Delete Record', confirmLabel: 'Delete', type: 'danger' })
    : confirm(`Delete ${record.document_no || 'this sales record'}?`);
  if (!confirmed) return;

  const res = await fetch(`/api/sales-management/records/${Number(id)}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.error || 'Unable to delete sales record.');
    return;
  }
  await loadSalesRecords();
  populateSourceSelect(null, activeSalesTab);
  renderSalesRecords();
}

async function submitSalesRequest(id) {
  const record = salesRecords.find((row) => Number(row.id || 0) === Number(id || 0));
  if (!record) return;
  if (String(record.status || '').toLowerCase() !== 'draft') {
    showToast('Only draft requests can be submitted.', 'error');
    return;
  }
  const confirmed = typeof showConfirm === 'function'
    ? await showConfirm('Submit this request for admin review?\n\nYou won\'t be able to edit it once submitted.', { title: `Submit ${record.document_no || 'Request'}`, confirmLabel: 'Submit for Review', type: 'default' })
    : confirm('Submit this request for admin review?');
  if (!confirmed) return;

  const res = await fetch(`/api/sales-management/records/${Number(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...record, status: 'submitted' })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showToast(data.error || 'Unable to submit request.', 'error');
    return;
  }
  showToast(`${record.document_no || 'Request'} submitted for admin review.`, 'success');
  await loadSalesRecords();
  renderSalesRecords();
}

async function generateDeliveryInvoice(id) {
  const record = salesRecords.find((row) => Number(row.id || 0) === Number(id || 0));
  const docNo = record?.document_no || `ID ${id}`;
  const confirmed = typeof showConfirm === 'function'
    ? await showConfirm(`This will create a draft AR invoice in Accounts Receivable that you can review and send to the customer.`, { title: `Generate Invoice from ${docNo}`, confirmLabel: 'Generate Invoice', type: 'default' })
    : confirm(`Generate AR Invoice from ${docNo}?`);
  if (!confirmed) return;

  const res = await fetch(`/api/sales-management/records/${Number(id)}/generate-invoice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const data = await res.json().catch(() => ({}));

  if (res.status === 409 && data.invoice_number) {
    showToast(`Invoice ${data.invoice_number} already exists for this delivery.`, 'info');
    await loadSalesRecords();
    renderSalesRecords();
    return;
  }
  if (!res.ok) {
    showToast(data.error || 'Unable to generate invoice.', 'error');
    return;
  }

  showToast(`Invoice ${data.invoice_number} created — PHP ${Number(data.total_amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} for ${data.customer_name}. View it in Accounts Receivable.`, 'success');
  await loadSalesRecords();
  renderSalesRecords();
}

function promoteSalesRecord(id) {
  const record = salesRecords.find((row) => Number(row.id || 0) === Number(id || 0));
  if (!record) return;
  const next = SALES_TYPES[record.record_type]?.next;
  if (!next) return;
  openSalesModal({
    record_type: next,
    source_record_id: record.id,
    company_id: record.company_id,
    project_id: record.project_id,
    contact_person: record.contact_person,
    title: record.title,
    requested_date: toDateInputValue(new Date()),
    target_date: record.target_date,
    amount: record.amount,
    product_id: record.product_id,
    warehouse_id: record.warehouse_id,
    quantity: record.quantity,
    unit_price: record.unit_price,
    payment_terms: record.payment_terms,
    description: record.description,
    status: getDefaultSalesStatus(next),
    notes: `Created from ${record.document_no || 'source record'}.`
  });
}

function getDefaultSalesStatus(recordType) {
  if (recordType === 'project-delivery') return 'delivered';
  return isSalesStaffView() ? 'draft' : 'approved';
}

function syncSalesStatusOptions() {
  const select = document.getElementById('sales-status');
  if (!select) return;
  const isStaff = isSalesStaffView();
  const staffAllowed = new Set(['draft', 'submitted']);
  Array.from(select.options).forEach((opt) => {
    const allowed = !isStaff || staffAllowed.has(opt.value);
    opt.hidden = !allowed;
    opt.disabled = !allowed;
  });
}

function getValue(id) {
  return document.getElementById(id)?.value || '';
}

function setValue(id, value) {
  const node = document.getElementById(id);
  if (node) node.value = value == null ? '' : String(value);
}

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(value) {
  return escHtml(value);
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2
  });
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('en-PH');
}

function toDateInputValue(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function formatStatus(value) {
  return String(value || 'draft').replace(/_/g, ' ');
}

window.editSalesRecord = editSalesRecord;
window.deleteSalesRecord = deleteSalesRecord;
window.promoteSalesRecord = promoteSalesRecord;
window.generateDeliveryInvoice = generateDeliveryInvoice;
window.submitSalesRequest = submitSalesRequest;
window.approveSalesRecord = approveSalesRecord;
window.addSalesLineItem = addSalesLineItem;
window.removeSalesLineItem = removeSalesLineItem;
window.syncSalesLineCategory = syncSalesLineCategory;
window.syncSalesLineProduct = syncSalesLineProduct;
window.syncSalesLineItem = syncSalesLineItem;
window.filterSalesProductByCategory = filterSalesProductByCategory;
