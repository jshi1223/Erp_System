'use strict';

const procurementState = {
  requisitions: [],
  purchaseOrders: [],
  goodsReceipts: [],
  companies: [],
  projects: []
};

let procurementTab = 'requisitions';
let editingRequisitionId = null;
let editingPurchaseOrderId = null;
let editingGoodsReceiptId = null;
let pendingPurchaseOrderProjectId = null;
const procurementToolbarState = {
  requisitions: { search: '' },
  purchaseOrders: { search: '' },
  goodsReceipts: { search: '' }
};

document.addEventListener('DOMContentLoaded', initProcurementPage);

function $(id) {
  return document.getElementById(id);
}

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(value) {
  return `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateText(value) {
  return value ? String(value).slice(0, 10) : '-';
}

function dateInputValue(value) {
  return value ? String(value).slice(0, 10) : '';
}

function statusClass(status) {
  const normalized = String(status || 'draft').trim().toLowerCase();
  if (['approved', 'received'].includes(normalized)) return `status-${normalized}`;
  if (['submitted', 'pending', 'ordered', 'draft', 'cancelled', 'rejected'].includes(normalized)) return `status-${normalized}`;
  return 'status-draft';
}

function apiTokenHeaders(headers = {}) {
  const token = String(window.__CSRF_TOKEN__ || '').trim();
  if (token) headers['X-CSRF-Token'] = token;
  return headers;
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: apiTokenHeaders({
      ...(options.headers || {})
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || `Request failed (${response.status})`);
  }
  return data;
}

function initProcurementPage() {
  if (!$('procurement-page')) return;
  setDefaultDates();
  wireBackdropClose();
  renderProcurementToolbarControls(procurementTab);
  const params = new URLSearchParams(window.location.search);
  pendingPurchaseOrderProjectId = Number(params.get('project_id') || 0) || null;
  const openPurchaseOrder = String(params.get('action') || '').toLowerCase() === 'po';
  loadProcurementData().then(() => {
    if (openPurchaseOrder) {
      openPurchaseOrderModal(null, pendingPurchaseOrderProjectId);
      pendingPurchaseOrderProjectId = null;
    }
  });
}

function setDefaultDates() {
  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const defaults = {
    'pr-request-date': today,
    'pr-needed-by': nextWeek,
    'po-date': today,
    'po-delivery': nextMonth,
    'grn-received-date': today
  };
  Object.entries(defaults).forEach(([id, value]) => {
    const el = $(id);
    if (el && !el.value) el.value = value;
  });
}

function wireBackdropClose() {
  ['pr-modal-backdrop', 'po-modal-backdrop', 'grn-modal-backdrop'].forEach((id) => {
    const backdrop = $(id);
    if (!backdrop) return;
    backdrop.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        if (id === 'pr-modal-backdrop') closeRequisitionModal();
        if (id === 'po-modal-backdrop') closePurchaseOrderModal();
        if (id === 'grn-modal-backdrop') closeGoodsReceiptModal();
      }
    });
  });
}

function switchProcTab(tab, btn) {
  captureProcurementToolbarState(procurementTab);
  procurementTab = tab;

  document.querySelectorAll('.module-tab').forEach((node) => node.classList.remove('active'));
  document.querySelectorAll('.content-section').forEach((node) => node.classList.remove('active'));

  if (btn) btn.classList.add('active');
  const section = $(tab);
  if (section) section.classList.add('active');
  renderProcurementToolbarControls(tab);
  if (tab === 'requisitions') renderRequisitions();
  if (tab === 'purchase-orders') renderPurchaseOrders();
  if (tab === 'goods-receipts') renderGoodsReceipts();
}

function captureProcurementToolbarState(tab) {
  if (!procurementToolbarState[tab]) return;
  procurementToolbarState[tab].search = $('procurement-search-input')?.value || '';
}

function renderProcurementToolbarControls(tab) {
  const actions = document.getElementById('procurement-toolbar-actions');
  if (!actions) return;

  const companies = procurementState.companies || [];
  const companyOptions = '<option value="">All Companies</option>' + companies.map(c => '<option value="' + c.id + '">' + escHtml(c.company_name) + '</option>').join('');

  const state = procurementToolbarState[tab] || {};
  if (tab === 'requisitions') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="procurement-search-input" type="text" placeholder="Search PR no., department, item, or status..." value="${escHtml(state.search || '')}" oninput="renderRequisitions()" />
      </div>
      <select id="procurement-company-filter" class="filter-select module-toolbar-select" onchange="filterProcurementByCompany(this.value)">
        ${companyOptions}
      </select>
      <button class="btn btn-add btn-sm" type="button" onclick="openRequisitionModal()">Add Requisition</button>
    `;
    return;
  }

  if (tab === 'purchase-orders') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="procurement-search-input" type="text" placeholder="Search PO no., vendor, item, or status..." value="${escHtml(state.search || '')}" oninput="renderPurchaseOrders()" />
      </div>
      <select id="procurement-company-filter" class="filter-select module-toolbar-select" onchange="filterProcurementByCompany(this.value)">
        ${companyOptions}
      </select>
      <button class="btn btn-add btn-sm" type="button" onclick="openPurchaseOrderModal()">Add Purchase Order</button>
    `;
    return;
  }

  if (tab === 'goods-receipts') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="procurement-search-input" type="text" placeholder="Search GRN no., PO no., receiver, or status..." value="${escHtml(state.search || '')}" oninput="renderGoodsReceipts()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openGoodsReceiptModal()">Add Goods Receipt</button>
    `;
    return;
  }

  actions.innerHTML = '';
}

async function loadProcurementData() {
  try {
    const [companies, projects, requisitions, purchaseOrders, goodsReceipts] = await Promise.all([
      apiFetch('/api/company-registry?include_archived=1'),
      apiFetch('/api/projects?include_archived=1'),
      apiFetch('/api/procurement/requisitions'),
      apiFetch('/api/procurement/purchase-orders'),
      apiFetch('/api/procurement/goods-receipts')
    ]);

    procurementState.companies = Array.isArray(companies) ? companies : [];
    procurementState.projects = Array.isArray(projects) ? projects : [];
    procurementState.requisitions = Array.isArray(requisitions) ? requisitions : [];
    procurementState.purchaseOrders = Array.isArray(purchaseOrders) ? purchaseOrders : [];
    procurementState.goodsReceipts = Array.isArray(goodsReceipts) ? goodsReceipts : [];

    renderSummary();
    renderVendorOptions();
    initVendorSearch();
    renderProjectOptions();
    renderPurchaseOrderOptions();
    renderRequisitions();
    renderPurchaseOrders();
    renderGoodsReceipts();
  } catch (err) {
    console.error('Load procurement data error:', err);
    showToast(err.message || 'Unable to load procurement records.', 'error');
  }
}

function renderSummary() {
  const set = (id, value) => {
    const node = $(id);
    if (node) node.textContent = String(value);
  };
  const totalCommitment = procurementState.requisitions.reduce((sum, row) => sum + Number(row.total_amount || 0), 0)
    + procurementState.purchaseOrders.reduce((sum, row) => sum + Number(row.computed_total || row.total_amount || 0), 0);
  set('metric-pr-count', procurementState.requisitions.length);
  set('metric-po-count', procurementState.purchaseOrders.length);
  set('metric-grn-count', procurementState.goodsReceipts.length);
  set('metric-total-commitment', money(totalCommitment));
}

function renderVendorOptions() {
  const searchInput = $('po-vendor-search');
  const hiddenInput = $('po-vendor');
  const resultsContainer = $('po-vendor-results');

  if (!searchInput || !hiddenInput || !resultsContainer) return;

  // Store reference to companies list
  searchInput._companies = procurementState.companies;

  // Clear previous selection if not in companies
  const currentVendorId = hiddenInput.value;
  const currentCompany = procurementState.companies.find(c => Number(c.id) === Number(currentVendorId));
  if (!currentVendorId || !currentCompany) {
    searchInput.value = '';
    hiddenInput.value = '';
  } else {
    searchInput.value = currentCompany.company_name || '';
  }

  // Hide results initially
  resultsContainer.classList.remove('open');
  resultsContainer.innerHTML = '';
}

function handleVendorSearch(event) {
  const searchInput = event?.target;
  const resultsContainer = $('po-vendor-results');
  const hiddenInput = $('po-vendor');

  if (!searchInput || !resultsContainer || !hiddenInput) return;

  const query = String(searchInput.value || '').trim().toLowerCase();

  if (!query) {
    resultsContainer.classList.remove('open');
    resultsContainer.innerHTML = '';
    return;
  }

  const companies = procurementState.companies || [];
  const filtered = companies.filter(company => {
    const name = String(company.company_name || '').toLowerCase();
    const contact = String(company.contact_person || '').toLowerCase();
    const phone = String(company.phone || '').toLowerCase();
    return name.includes(query) || contact.includes(query) || phone.includes(query);
  });

  if (filtered.length === 0) {
    resultsContainer.innerHTML = '<div class="vendor-search-empty">No companies found</div>';
  } else {
    resultsContainer.innerHTML = filtered.slice(0, 10).map(company => `
      <div class="vendor-search-item" data-id="${company.id}" data-name="${escHtml(company.company_name)}">
        <div class="vendor-name">${escHtml(company.company_name)}</div>
        <div class="vendor-contact">${escHtml(company.contact_person || 'No contact')} · ${escHtml(company.phone || '-')}</div>
      </div>
    `).join('');
  }

  resultsContainer.classList.add('open');
}

function selectVendor(companyId, companyName) {
  const searchInput = $('po-vendor-search');
  const hiddenInput = $('po-vendor');
  const resultsContainer = $('po-vendor-results');

  if (searchInput) searchInput.value = companyName;
  if (hiddenInput) hiddenInput.value = companyId;
  if (resultsContainer) {
    resultsContainer.classList.remove('open');
    resultsContainer.innerHTML = '';
  }
}

function initVendorSearch() {
  const searchInput = $('po-vendor-search');
  const resultsContainer = $('po-vendor-results');

  if (!searchInput || !resultsContainer) return;

  // Listen for input
  searchInput.addEventListener('input', handleVendorSearch);

  // Focus to show all companies
  searchInput.addEventListener('focus', (event) => {
    if (!searchInput.value.trim()) {
      handleVendorSearch({ target: searchInput });
    }
  });

  // Click on result to select
  resultsContainer.addEventListener('click', (event) => {
    const item = event.target.closest('.vendor-search-item');
    if (item) {
      const id = item.getAttribute('data-id');
      const name = item.getAttribute('data-name');
      selectVendor(id, name);
    }
  });

  // Close on click outside
  document.addEventListener('click', (event) => {
    const wrapper = searchInput.closest('.vendor-search-wrap');
    if (wrapper && !wrapper.contains(event.target)) {
      resultsContainer.classList.remove('open');
    }
  });
}

function renderProjectOptions() {
  const select = $('po-project');
  if (!select) return;
  const current = select.value;
  select.innerHTML = [
    '<option value="">Select project</option>',
    ...procurementState.projects.map((project) => {
      const docno = String(project.project_docno || project.source_docno || '').trim();
      const name = String(project.project_name || 'Untitled Project').trim();
      const company = String(project.company_name || '').trim();
      const label = [docno, name, company].filter(Boolean).join(' - ');
      return `<option value="${escHtml(project.id)}">${escHtml(label || name)}</option>`;
    })
  ].join('');
  if (current) select.value = current;
  if (pendingPurchaseOrderProjectId && !select.value) {
    select.value = String(pendingPurchaseOrderProjectId);
  }
}

function renderPurchaseOrderOptions() {
  const select = $('grn-po');
  if (!select) return;
  const current = select.value;
  select.innerHTML = [
    '<option value="">Select purchase order</option>',
    ...procurementState.purchaseOrders.map((row) => `<option value="${escHtml(row.id)}">${escHtml(row.po_number)} - ${escHtml(row.vendor_name || '-')}</option>`)
  ].join('');
  if (current) select.value = current;
}

function filteredRows(rows, searchValue, fields) {
  const q = String(searchValue || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => fields.map((field) => String(row[field] ?? '')).join(' ').toLowerCase().includes(q));
}

function filterProcurementByCompany(companyId) {
  const select = $('procurement-company-filter');
  if (select) select.value = companyId;
  window.procurementCompanyFilter = companyId ? Number(companyId) : null;
  const tab = procurementTab;
  if (tab === 'requisitions') renderRequisitions();
  else if (tab === 'purchase-orders') renderPurchaseOrders();
  else if (tab === 'goods-receipts') renderGoodsReceipts();
}

function filterRowsByCompany(rows, companyId) {
  if (!companyId) return rows;
  return rows.filter(row => Number(row.project_id || row.company_id || 0) === Number(companyId));
}

function renderRequisitions() {
  const tbody = $('pr-body');
  if (!tbody) return;

  let rows = filterRowsByCompany(procurementState.requisitions, window.procurementCompanyFilter);
  rows = filteredRows(rows, $('procurement-search-input')?.value, [
    'pr_number',
    'department',
    'requested_by',
    'item_name',
    'status'
  ]);

  tbody.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td style="font-weight:600;color:var(--primary)">${escHtml(row.pr_number)}</td>
      <td>${escHtml(dateText(row.request_date))}</td>
      <td>${escHtml(row.department || '-')}</td>
      <td>${escHtml(row.requested_by || '-')}</td>
      <td>${escHtml(dateText(row.needed_by))}</td>
      <td><span class="status-chip ${statusClass(row.status)}">${escHtml(row.status || 'draft')}</span></td>
      <td>${escHtml(row.item_name || '-')}</td>
      <td class="text-right">${escHtml(Number(row.quantity || 0))}</td>
      <td class="text-right">${escHtml(money(row.unit_price || 0))}</td>
      <td class="text-right" style="font-weight:600;">${escHtml(money(row.total_amount || 0))}</td>
      <td>
        <div class="erp-actions" style="justify-content:center;">
          <button class="btn btn-edit btn-sm" type="button" onclick="openRequisitionModal(${Number(row.id)})">Edit</button>
          <button class="btn btn-cancel btn-sm" type="button" onclick="deleteRequisition(${Number(row.id)})">Delete</button>
        </div>
      </td>
    </tr>
  `).join('') : '<tr class="empty-row"><td colspan="11">No requisitions found.</td></tr>';
}

function renderPurchaseOrders() {
  const tbody = $('po-body');
  if (!tbody) return;

  let rows = filterRowsByCompany(procurementState.purchaseOrders, window.procurementCompanyFilter);
  rows = filteredRows(rows, $('procurement-search-input')?.value, [
    'po_number',
    'vendor_name',
    'item_name',
    'status'
  ]);

  tbody.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td style="font-weight:600;color:var(--primary)">${escHtml(row.po_number)}</td>
      <td>${escHtml(row.vendor_name || '-')}</td>
      <td>${escHtml(dateText(row.po_date))}</td>
      <td>${escHtml(dateText(row.delivery_date))}</td>
      <td><span class="status-chip ${statusClass(row.status)}">${escHtml(row.status || 'draft')}</span></td>
      <td>${escHtml(row.item_name || '-')}</td>
      <td class="text-right">${escHtml(Number(row.quantity || 0))}</td>
      <td class="text-right">${escHtml(money(row.unit_price || 0))}</td>
      <td class="text-right" style="font-weight:600;">${escHtml(money(row.computed_total || row.total_amount || 0))}</td>
      <td>
        <div class="erp-actions" style="justify-content:center;">
          <button class="btn btn-edit btn-sm" type="button" onclick="openPurchaseOrderModal(${Number(row.id)})">Edit</button>
          <button class="btn btn-cancel btn-sm" type="button" onclick="deletePurchaseOrder(${Number(row.id)})">Delete</button>
        </div>
      </td>
    </tr>
  `).join('') : '<tr class="empty-row"><td colspan="10">No purchase orders found.</td></tr>';
}

function renderGoodsReceipts() {
  const tbody = $('grn-body');
  if (!tbody) return;

  let rows = filterRowsByCompany(procurementState.goodsReceipts, window.procurementCompanyFilter);
  rows = filteredRows(rows, $('procurement-search-input')?.value, [
    'grn_number',
    'po_number',
    'received_by',
    'status'
  ]);

  tbody.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td style="font-weight:600;color:var(--primary)">${escHtml(row.grn_number)}</td>
      <td>${escHtml(row.po_number || '-')}</td>
      <td>${escHtml(dateText(row.received_date))}</td>
      <td>${escHtml(row.received_by || '-')}</td>
      <td><span class="status-chip ${statusClass(row.status)}">${escHtml(row.status || 'draft')}</span></td>
      <td>${escHtml(row.notes || '-')}</td>
      <td>
        <div class="erp-actions" style="justify-content:center;">
          <button class="btn btn-edit btn-sm" type="button" onclick="openGoodsReceiptModal(${Number(row.id)})">Edit</button>
          <button class="btn btn-cancel btn-sm" type="button" onclick="deleteGoodsReceipt(${Number(row.id)})">Delete</button>
        </div>
      </td>
    </tr>
  `).join('') : '<tr class="empty-row"><td colspan="7">No goods receipts found.</td></tr>';
}

function openBackdrop(id) {
  const backdrop = $(id);
  if (backdrop) backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeBackdrop(id) {
  const backdrop = $(id);
  if (backdrop) backdrop.classList.remove('open');
  const anyModalOpen = document.querySelector('.modal-backdrop.open') || document.getElementById('confirm-modal-backdrop')?.classList.contains('open');
  if (!anyModalOpen) {
    document.body.style.overflow = '';
  }
}

function resetRequisitionForm() {
  ['pr-number', 'pr-department', 'pr-requested-by', 'pr-item-name', 'pr-item-desc', 'pr-unit', 'pr-price', 'pr-notes'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });
  const dateDefaults = {
    'pr-request-date': new Date().toISOString().slice(0, 10),
    'pr-needed-by': new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    'pr-status': 'draft',
    'pr-qty': '1'
  };
  Object.entries(dateDefaults).forEach(([id, value]) => {
    const el = $(id);
    if (el) el.value = value;
  });
}

function syncRequisitionModalMode() {
  const title = $('pr-modal-title');
  const saveBtn = $('pr-save-btn');
  if (title) title.textContent = editingRequisitionId ? 'Edit Requisition' : 'Add Requisition';
  if (saveBtn) saveBtn.textContent = editingRequisitionId ? 'Save Changes' : 'Create Requisition';
}

function openRequisitionModal(id = null) {
  editingRequisitionId = id ? Number(id) : null;
  resetRequisitionForm();
  if (editingRequisitionId) {
    const row = procurementState.requisitions.find((entry) => Number(entry.id) === editingRequisitionId);
    if (!row) {
      showToast('Requisition not found.', 'error');
      editingRequisitionId = null;
      return;
    }
    $('pr-number').value = row.pr_number || '';
    $('pr-request-date').value = dateInputValue(row.request_date);
    $('pr-department').value = row.department || '';
    $('pr-requested-by').value = row.requested_by || '';
    $('pr-needed-by').value = dateInputValue(row.needed_by);
    $('pr-status').value = row.status || 'draft';
    $('pr-item-name').value = row.item_name || '';
    $('pr-item-desc').value = row.item_description || '';
    $('pr-qty').value = row.quantity || 1;
    $('pr-unit').value = row.unit || '';
    $('pr-price').value = row.unit_price || 0;
    $('pr-notes').value = row.notes || '';
  }
  syncRequisitionModalMode();
  openBackdrop('pr-modal-backdrop');
}

function closeRequisitionModal() {
  editingRequisitionId = null;
  closeBackdrop('pr-modal-backdrop');
  resetRequisitionForm();
  syncRequisitionModalMode();
}

async function saveRequisition() {
  const payload = {
    pr_number: $('pr-number').value.trim(),
    request_date: $('pr-request-date').value,
    department: $('pr-department').value.trim(),
    requested_by: $('pr-requested-by').value.trim(),
    needed_by: $('pr-needed-by').value,
    status: $('pr-status').value,
    item_name: $('pr-item-name').value.trim(),
    item_description: $('pr-item-desc').value.trim(),
    quantity: $('pr-qty').value,
    unit: $('pr-unit').value.trim(),
    estimated_unit_price: $('pr-price').value,
    notes: $('pr-notes').value.trim()
  };

  if (!payload.request_date || !payload.item_name || Number(payload.quantity || 0) <= 0) {
    return showToast('Punan ang Request Date, Item Name, at Qty.', 'error');
  }

  try {
    if (editingRequisitionId) {
      const result = await apiFetch(`/api/procurement/requisitions/${editingRequisitionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      closeRequisitionModal();
      showToast('Changes saved successfully!', 'success');
      await loadProcurementData();
      return result;
    }

    const result = await apiFetch('/api/procurement/requisitions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeRequisitionModal();
    showToast('Requisition created successfully!', 'success');
    await loadProcurementData();
    return result;
  } catch (err) {
    showToast(err.message || 'Unable to save requisition.', 'error');
  }
}

async function deleteRequisition(id) {
  const row = procurementState.requisitions.find((entry) => Number(entry.id) === Number(id));
  const confirmed = await openConfirmDialog({
    title: 'Delete Requisition',
    message: `Delete ${row?.pr_number || 'this requisition'}?`,
    noText: 'No',
    yesText: 'Yes'
  });
  if (!confirmed) return;

  try {
    await apiFetch(`/api/procurement/requisitions/${id}`, { method: 'DELETE' });
    showToast('Requisition deleted successfully!', 'success');
    await loadProcurementData();
  } catch (err) {
    showToast(err.message || 'Unable to delete requisition.', 'error');
  }
}

function resetPurchaseOrderForm() {
  ['po-number', 'po-item-name', 'po-qty', 'po-unit-price', 'po-notes'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });
  if ($('po-project')) $('po-project').value = '';
  if ($('po-vendor')) $('po-vendor').value = '';
  if ($('po-vendor-search')) $('po-vendor-search').value = '';
  if ($('po-status')) $('po-status').value = 'draft';
  if ($('po-date')) $('po-date').value = new Date().toISOString().slice(0, 10);
  if ($('po-delivery')) $('po-delivery').value = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if ($('po-qty')) $('po-qty').value = '1';
}

function syncPurchaseOrderModalMode() {
  const title = $('po-modal-title');
  const saveBtn = $('po-save-btn');
  if (title) title.textContent = editingPurchaseOrderId ? 'Edit Purchase Order' : 'Add Purchase Order';
  if (saveBtn) saveBtn.textContent = editingPurchaseOrderId ? 'Save Changes' : 'Create Purchase Order';
}

function openPurchaseOrderModal(id = null, projectId = null) {
  editingPurchaseOrderId = id ? Number(id) : null;
  resetPurchaseOrderForm();
  renderVendorOptions();
  renderProjectOptions();
  initVendorSearch();

  if (editingPurchaseOrderId) {
    const row = procurementState.purchaseOrders.find((entry) => Number(entry.id) === editingPurchaseOrderId);
    if (!row) {
      showToast('Purchase order not found.', 'error');
      editingPurchaseOrderId = null;
      return;
    }
    $('po-number').value = row.po_number || '';
    $('po-project').value = row.project_id || '';
    $('po-vendor').value = row.vendor_id || '';
    // Set vendor search display
    const vendorCompany = procurementState.companies.find(c => Number(c.id) === Number(row.vendor_id));
    if ($('po-vendor-search')) $('po-vendor-search').value = vendorCompany?.company_name || '';
    $('po-date').value = dateInputValue(row.po_date);
    $('po-delivery').value = dateInputValue(row.delivery_date);
    $('po-status').value = row.status || 'draft';
    $('po-item-name').value = row.item_name || '';
    $('po-qty').value = row.quantity || 1;
    $('po-unit-price').value = row.unit_price || 0;
    $('po-notes').value = row.notes || '';
  } else if (projectId) {
    $('po-project').value = String(projectId);
  }
  syncPurchaseOrderModalMode();
  openBackdrop('po-modal-backdrop');
}

function closePurchaseOrderModal() {
  editingPurchaseOrderId = null;
  closeBackdrop('po-modal-backdrop');
  resetPurchaseOrderForm();
  syncPurchaseOrderModalMode();
}

async function savePurchaseOrder() {
  const payload = {
    po_number: $('po-number').value.trim(),
    project_id: $('po-project').value,
    vendor_id: $('po-vendor').value,
    po_date: $('po-date').value,
    delivery_date: $('po-delivery').value,
    status: $('po-status').value,
    item_name: $('po-item-name').value.trim(),
    quantity: $('po-qty').value,
    unit_price: $('po-unit-price').value,
    notes: $('po-notes').value.trim()
  };

  if (!payload.project_id || !payload.vendor_id || !payload.po_date || !payload.item_name || Number(payload.quantity || 0) <= 0 || Number(payload.unit_price || 0) <= 0) {
    return showToast('Punan ang Project, Vendor, PO Date, Item Name, Qty, at Unit Price.', 'error');
  }

  try {
    if (editingPurchaseOrderId) {
      await apiFetch(`/api/procurement/purchase-orders/${editingPurchaseOrderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      closePurchaseOrderModal();
      showToast('Changes saved successfully!', 'success');
      await loadProcurementData();
      return;
    }

    await apiFetch('/api/procurement/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closePurchaseOrderModal();
    showToast('Purchase order created successfully!', 'success');
    await loadProcurementData();
  } catch (err) {
    showToast(err.message || 'Unable to save purchase order.', 'error');
  }
}

async function deletePurchaseOrder(id) {
  const row = procurementState.purchaseOrders.find((entry) => Number(entry.id) === Number(id));
  const confirmed = await openConfirmDialog({
    title: 'Delete Purchase Order',
    message: `Delete ${row?.po_number || 'this purchase order'}?`,
    noText: 'No',
    yesText: 'Yes'
  });
  if (!confirmed) return;

  try {
    await apiFetch(`/api/procurement/purchase-orders/${id}`, { method: 'DELETE' });
    showToast('Purchase order deleted successfully!', 'success');
    await loadProcurementData();
  } catch (err) {
    showToast(err.message || 'Unable to delete purchase order.', 'error');
  }
}

function resetGoodsReceiptForm() {
  ['grn-number', 'grn-received-by', 'grn-notes'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });
  if ($('grn-po')) $('grn-po').value = '';
  if ($('grn-status')) $('grn-status').value = 'received';
  if ($('grn-received-date')) $('grn-received-date').value = new Date().toISOString().slice(0, 10);
}

function syncGoodsReceiptModalMode() {
  const title = $('grn-modal-title');
  const saveBtn = $('grn-save-btn');
  if (title) title.textContent = editingGoodsReceiptId ? 'Edit Goods Receipt' : 'Add Goods Receipt';
  if (saveBtn) saveBtn.textContent = editingGoodsReceiptId ? 'Save Changes' : 'Create Goods Receipt';
}

function openGoodsReceiptModal(id = null) {
  editingGoodsReceiptId = id ? Number(id) : null;
  resetGoodsReceiptForm();
  renderPurchaseOrderOptions();

  if (editingGoodsReceiptId) {
    const row = procurementState.goodsReceipts.find((entry) => Number(entry.id) === editingGoodsReceiptId);
    if (!row) {
      showToast('Goods receipt not found.', 'error');
      editingGoodsReceiptId = null;
      return;
    }
    $('grn-number').value = row.grn_number || '';
    $('grn-po').value = row.po_id || '';
    $('grn-received-date').value = dateInputValue(row.received_date);
    $('grn-received-by').value = row.received_by || '';
    $('grn-status').value = row.status || 'received';
    $('grn-notes').value = row.notes || '';
  }
  syncGoodsReceiptModalMode();
  openBackdrop('grn-modal-backdrop');
}

function closeGoodsReceiptModal() {
  editingGoodsReceiptId = null;
  closeBackdrop('grn-modal-backdrop');
  resetGoodsReceiptForm();
  syncGoodsReceiptModalMode();
}

async function saveGoodsReceipt() {
  const payload = {
    grn_number: $('grn-number').value.trim(),
    po_id: $('grn-po').value,
    received_date: $('grn-received-date').value,
    received_by: $('grn-received-by').value.trim(),
    status: $('grn-status').value,
    notes: $('grn-notes').value.trim()
  };

  if (!payload.po_id || !payload.received_date) {
    return showToast('Punan ang PO No. at Received Date.', 'error');
  }

  try {
    if (editingGoodsReceiptId) {
      await apiFetch(`/api/procurement/goods-receipts/${editingGoodsReceiptId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      closeGoodsReceiptModal();
      showToast('Changes saved successfully!', 'success');
      await loadProcurementData();
      return;
    }

    await apiFetch('/api/procurement/goods-receipts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeGoodsReceiptModal();
    showToast('Goods receipt created successfully!', 'success');
    await loadProcurementData();
  } catch (err) {
    showToast(err.message || 'Unable to save goods receipt.', 'error');
  }
}

async function deleteGoodsReceipt(id) {
  const row = procurementState.goodsReceipts.find((entry) => Number(entry.id) === Number(id));
  const confirmed = await openConfirmDialog({
    title: 'Delete Goods Receipt',
    message: `Delete ${row?.grn_number || 'this goods receipt'}?`,
    noText: 'No',
    yesText: 'Yes'
  });
  if (!confirmed) return;

  try {
    await apiFetch(`/api/procurement/goods-receipts/${id}`, { method: 'DELETE' });
    showToast('Goods receipt deleted successfully!', 'success');
    await loadProcurementData();
  } catch (err) {
    showToast(err.message || 'Unable to delete goods receipt.', 'error');
  }
}
