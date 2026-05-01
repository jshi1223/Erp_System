'use strict';

const procurementState = {
  companies: [],
  requisitions: [],
  purchaseOrders: [],
  goodsReceipts: [],
  vendors: [],
  projects: []
};

let procurementTab = 'requisitions';
let editingRequisitionId = null;
let editingPurchaseOrderId = null;
let editingGoodsReceiptId = null;
let pendingPurchaseOrderProjectId = null;
let pendingPurchaseOrderRequisitionId = null;
let vendorSearchBound = false;
const procurementToolbarState = {
  requisitions: { search: '' },
  vendors: { search: '' },
  purchaseOrders: { search: '' },
  goodsReceipts: { search: '' }
};

document.addEventListener('DOMContentLoaded', initProcurementPage);

function $(id) {
  return document.getElementById(id);
}

const money = formatPhpCurrency;

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

const apiFetch = fetchJson;

function getProcurementFieldMessageNode(fieldName) {
  return document.querySelector(`[data-procurement-field-message="${fieldName}"]`);
}

function getProcurementFieldNodes(fieldName) {
  const map = {
    pr_number: ['pr-number'],
    company_id: ['pr-company'],
    project_id: ['pr-project', 'po-project'],
    request_date: ['pr-request-date'],
    item_name: ['pr-item-name'],
    quantity: ['pr-qty'],
    po_number: ['po-number'],
    requisition_id: ['po-requisition'],
    vendor_id: ['po-vendor-search', 'po-vendor'],
    po_date: ['po-date'],
    line_items: ['po-line-items'],
    grn_number: ['grn-number'],
    po_id: ['grn-po'],
    received_date: ['grn-received-date'],
    vendor_name: ['f-vendor-name']
  };

  return (map[fieldName] || [])
    .map((id) => document.getElementById(id))
    .filter(Boolean);
}

function setProcurementFieldMessage(fieldName, message = '') {
  const notice = getProcurementFieldMessageNode(fieldName);
  const text = String(message || '').trim();
  const field = notice?.closest('.field') || null;

  if (notice) {
    notice.textContent = text;
    notice.classList.toggle('is-hidden', !text);
  }

  if (field) {
    field.classList.toggle('has-error', !!text);
  }

  getProcurementFieldNodes(fieldName).forEach((node) => {
    node.setAttribute('aria-invalid', text ? 'true' : 'false');
  });
}

function clearProcurementFieldMessages() {
  ['pr_number', 'company_id', 'project_id', 'request_date', 'item_name', 'quantity', 'po_number', 'requisition_id', 'vendor_id', 'po_date', 'line_items', 'grn_number', 'po_id', 'received_date', 'vendor_name'].forEach((fieldName) => {
    setProcurementFieldMessage(fieldName, '');
  });
  clearPurchaseOrderLineItemMessages();
}

function setupProcurementModalValidationListeners() {
  const bindings = [
    ['pr-number', 'pr_number', 'input'],
    ['pr-company', 'company_id', 'change'],
    ['pr-project', 'project_id', 'change'],
    ['pr-request-date', 'request_date', 'change'],
    ['pr-item-name', 'item_name', 'input'],
    ['pr-qty', 'quantity', 'input'],
    ['po-number', 'po_number', 'input'],
    ['po-requisition', 'requisition_id', 'change'],
    ['po-project', 'project_id', 'change'],
    ['po-vendor-search', 'vendor_id', 'input'],
    ['po-date', 'po_date', 'change'],
    ['grn-number', 'grn_number', 'input'],
    ['grn-po', 'po_id', 'change'],
    ['grn-received-date', 'received_date', 'change'],
    ['f-vendor-name', 'vendor_name', 'input']
  ];

  bindings.forEach(([id, fieldName, eventName]) => {
    const node = document.getElementById(id);
    if (!node || node.dataset.procurementValidationBound === '1') return;
    node.dataset.procurementValidationBound = '1';
    node.addEventListener(eventName, () => setProcurementFieldMessage(fieldName, ''));
  });
}

function getPurchaseOrderLineItemMessageNode(row) {
  return row?.querySelector('[data-po-line-message]') || null;
}

function setPurchaseOrderLineItemMessage(row, message = '') {
  if (!row) return;
  const notice = getPurchaseOrderLineItemMessageNode(row);
  const text = String(message || '').trim();

  if (notice) {
    notice.textContent = text;
    notice.classList.toggle('is-hidden', !text);
  }

  row.classList.toggle('has-error', !!text);
  row.querySelectorAll('input').forEach((input) => {
    input.setAttribute('aria-invalid', text ? 'true' : 'false');
  });
}

function clearPurchaseOrderLineItemMessages() {
  Array.from(getPurchaseOrderLineItemsContainer()?.querySelectorAll('[data-po-line-item]') || [])
    .forEach((row) => setPurchaseOrderLineItemMessage(row, ''));
}

function initProcurementPage() {
  if (!$('procurement-page')) return;
  setDefaultDates();
  setupProcurementModalValidationListeners();
  wireBackdropClose();
  renderProcurementToolbarControls(procurementTab);
  const params = new URLSearchParams(window.location.search);
  pendingPurchaseOrderProjectId = Number(params.get('project_id') || 0) || null;
  pendingPurchaseOrderRequisitionId = Number(params.get('requisition_id') || 0) || null;
  const openPurchaseOrder = String(params.get('action') || '').toLowerCase() === 'po';
  loadProcurementData().then(() => {
    if (openPurchaseOrder) {
      openPurchaseOrderModal(null, pendingPurchaseOrderProjectId, null, pendingPurchaseOrderRequisitionId);
      pendingPurchaseOrderProjectId = null;
      pendingPurchaseOrderRequisitionId = null;
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
  ['pr-modal-backdrop', 'po-modal-backdrop', 'grn-modal-backdrop', 'vendor-modal-backdrop'].forEach((id) => {
    const backdrop = $(id);
    if (!backdrop) return;
    backdrop.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        if (id === 'pr-modal-backdrop') closeRequisitionModal();
        if (id === 'po-modal-backdrop') closePurchaseOrderModal();
        if (id === 'grn-modal-backdrop') closeGoodsReceiptModal();
        if (id === 'vendor-modal-backdrop') closeVendorModal();
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
  if (tab === 'vendors') renderVendorDirectory();
  if (tab === 'purchase-orders') renderPurchaseOrders();
  if (tab === 'goods-receipts') renderGoodsReceipts();
}

function captureProcurementToolbarState(tab) {
  if (!procurementToolbarState[tab]) return;
  procurementToolbarState[tab].search = $('procurement-search-input')?.value || '';
  if (tab === 'vendors') {
    procurementToolbarState.vendors.search = $('vendor-search')?.value || '';
  }
}

function renderProcurementToolbarControls(tab) {
  const actions = document.getElementById('procurement-toolbar-actions');
  if (!actions) return;

  const state = procurementToolbarState[tab] || {};
  if (tab === 'requisitions') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="procurement-search-input" type="text" placeholder="Search PR no., company, department, item, or status..." value="${escHtml(state.search || '')}" oninput="renderRequisitions()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openRequisitionModal()">Add Requisition</button>
    `;
    return;
  }

  if (tab === 'vendors') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="vendor-search" type="text" placeholder="Search vendor name, contact, email, or phone..." value="${escHtml(state.search || '')}" oninput="filterVendorDirectory()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openVendorModal()">Add Vendor</button>
    `;
    return;
  }

  if (tab === 'purchase-orders') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="procurement-search-input" type="text" placeholder="Search PO no., vendor, company, item, or status..." value="${escHtml(state.search || '')}" oninput="renderPurchaseOrders()" />
      </div>
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
    const [companies, vendors, projects, requisitions, purchaseOrders, goodsReceipts] = await Promise.all([
      apiFetch('/api/company-registry?include_archived=1'),
      apiFetch('/api/vendors'),
      apiFetch('/api/projects?include_archived=1'),
      apiFetch('/api/procurement/requisitions'),
      apiFetch('/api/procurement/purchase-orders'),
      apiFetch('/api/procurement/goods-receipts')
    ]);

    procurementState.companies = Array.isArray(companies) ? companies : [];
    procurementState.vendors = Array.isArray(vendors) ? vendors : [];
    procurementState.projects = Array.isArray(projects) ? projects : [];
    procurementState.requisitions = Array.isArray(requisitions) ? requisitions : [];
    procurementState.purchaseOrders = Array.isArray(purchaseOrders) ? purchaseOrders : [];
    procurementState.goodsReceipts = Array.isArray(goodsReceipts) ? goodsReceipts : [];

    renderSummary();
    renderCompanyOptions();
    renderVendorDirectory();
    renderVendorOptions();
    initVendorSearch();
    renderProjectOptions();
    renderRequisitionProjectOptions();
    renderPurchaseOrderRequisitionOptions();
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

  searchInput._vendors = procurementState.vendors;

  const currentVendorId = hiddenInput.value;
  const currentVendor = procurementState.vendors.find(v => Number(v.id) === Number(currentVendorId));
  if (!currentVendorId || !currentVendor) {
    searchInput.value = '';
    hiddenInput.value = '';
  } else {
    searchInput.value = currentVendor.vendor_name || '';
  }

  resultsContainer.classList.remove('open');
  resultsContainer.innerHTML = '';
}

function handleVendorSearch(event, showAll = false) {
  const searchInput = event?.target;
  const resultsContainer = $('po-vendor-results');
  const hiddenInput = $('po-vendor');

  if (!searchInput || !resultsContainer || !hiddenInput) return;

  const query = String(searchInput.value || '').trim().toLowerCase();

  if (!query && !showAll) {
    resultsContainer.classList.remove('open');
    resultsContainer.innerHTML = '';
    return;
  }

  const vendors = procurementState.vendors || [];
  const filtered = vendors.filter((vendor) => {
    const name = String(vendor.vendor_name || '').toLowerCase();
    const contact = String(vendor.contact_person || '').toLowerCase();
    const email = String(vendor.email || '').toLowerCase();
    const phone = String(vendor.phone || '').toLowerCase();
    const address = String(vendor.address || '').toLowerCase();
    const tin = String(vendor.tin || '').toLowerCase();
    return showAll || name.includes(query) || contact.includes(query) || email.includes(query) || phone.includes(query) || address.includes(query) || tin.includes(query);
  });

  if (filtered.length === 0) {
    resultsContainer.innerHTML = '<div class="vendor-search-empty">No vendors found</div>';
  } else {
    resultsContainer.innerHTML = filtered.slice(0, 10).map((vendor) => `
      <div class="vendor-search-item" data-id="${vendor.id}" data-name="${escHtml(vendor.vendor_name)}">
        <div class="vendor-name">${escHtml(vendor.vendor_name)}</div>
        <div class="vendor-contact">${escHtml(vendor.contact_person || 'No contact')} - ${escHtml(vendor.phone || '-')}</div>
      </div>
    `).join('');
  }

  resultsContainer.classList.add('open');
}

function selectVendor(vendorId, vendorName) {
  const searchInput = $('po-vendor-search');
  const hiddenInput = $('po-vendor');
  const resultsContainer = $('po-vendor-results');

  if (searchInput) searchInput.value = vendorName;
  if (hiddenInput) hiddenInput.value = vendorId;
  setProcurementFieldMessage('vendor_id', '');
  if (resultsContainer) {
    resultsContainer.classList.remove('open');
    resultsContainer.innerHTML = '';
  }
}

function initVendorSearch() {
  if (vendorSearchBound) return;
  const searchInput = $('po-vendor-search');
  const resultsContainer = $('po-vendor-results');

  if (!searchInput || !resultsContainer) return;

  searchInput.addEventListener('input', handleVendorSearch);

  searchInput.addEventListener('focus', () => {
    if (!searchInput.value.trim()) {
      handleVendorSearch({ target: searchInput }, true);
    }
  });

  resultsContainer.addEventListener('click', (event) => {
    const item = event.target.closest('.vendor-search-item');
    if (item) {
      const id = item.getAttribute('data-id');
      const name = item.getAttribute('data-name');
      selectVendor(id, name);
    }
  });

  document.addEventListener('click', (event) => {
    const wrapper = searchInput.closest('.vendor-search-wrap');
    if (wrapper && !wrapper.contains(event.target)) {
      resultsContainer.classList.remove('open');
    }
  });
  vendorSearchBound = true;
}

function renderVendorDirectory() {
  const tbody = $('vendor-body');
  if (!tbody) return;

  const q = String($('vendor-search')?.value || '').trim().toLowerCase();
  const vendors = procurementState.vendors || [];
  const rows = vendors.filter((vendor) => {
    const haystack = [
      vendor.vendor_name,
      vendor.contact_person,
      vendor.email,
      vendor.phone,
      vendor.address,
      vendor.tin
    ].map((value) => String(value || '')).join(' ').toLowerCase();
    return !q || haystack.includes(q);
  });

  tbody.innerHTML = rows.length ? rows.map((vendor) => `
    <tr>
      <td>
        <div style="font-weight:600;color:var(--primary)">${escHtml(vendor.vendor_name || '-')}</div>
        <div style="font-size:0.76rem;color:var(--text-muted);margin-top:2px;">${escHtml(vendor.address || 'No address')}</div>
      </td>
      <td>${escHtml(vendor.contact_person || '-')}</td>
      <td>${escHtml(vendor.email || '-')}</td>
      <td>${escHtml(vendor.phone || '-')}</td>
      <td>${escHtml(vendor.tin || '-')}</td>
      <td>
        <div class="erp-actions" style="justify-content:center;">
          <button class="btn btn-edit btn-sm" type="button" onclick="openPurchaseOrderModal(null, null, ${Number(vendor.id)})">Use in PO</button>
        </div>
      </td>
    </tr>
  `).join('') : '<tr class="empty-row"><td colspan="6">No vendors found.</td></tr>';
}

function filterVendorDirectory() {
  renderVendorDirectory();
}

function resetVendorForm() {
  ['f-vendor-name', 'f-vendor-contact', 'f-vendor-email', 'f-vendor-phone', 'f-vendor-address', 'f-vendor-tin'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });
  clearProcurementFieldMessages();
}

function syncVendorModalMode() {
  const title = $('vendor-modal-title');
  const saveBtn = $('vendor-save-btn');
  if (title) title.textContent = 'Add Vendor';
  if (saveBtn) saveBtn.textContent = 'Create Vendor';
}

function openVendorModal() {
  resetVendorForm();
  clearProcurementFieldMessages();
  syncVendorModalMode();
  openBackdrop('vendor-modal-backdrop');
}

function closeVendorModal() {
  closeBackdrop('vendor-modal-backdrop');
  resetVendorForm();
  clearProcurementFieldMessages();
  syncVendorModalMode();
}

async function saveVendor() {
  const payload = {
    vendor_name: $('f-vendor-name').value.trim(),
    contact_person: $('f-vendor-contact').value.trim(),
    email: $('f-vendor-email').value.trim(),
    phone: $('f-vendor-phone').value.trim(),
    address: $('f-vendor-address').value.trim(),
    tin: $('f-vendor-tin').value.trim()
  };

  if (!payload.vendor_name) {
    setProcurementFieldMessage('vendor_name', 'Vendor Name is required.');
    return;
  }

  try {
    await apiFetch('/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeVendorModal();
    showToast('Vendor created successfully!', 'success');
    await loadProcurementData();
  } catch (err) {
    const errorText = String(err?.message || '').toLowerCase();
    if (errorText.includes('duplicate') || errorText.includes('already exists')) {
      setProcurementFieldMessage('vendor_name', err.message || 'Vendor already exists.');
      return;
    }
    showToast(err.message || 'Unable to save vendor.', 'error');
  }
}

function applyPurchaseOrderVendorSelection(vendorId) {
  const hiddenInput = $('po-vendor');
  const searchInput = $('po-vendor-search');
  const resultsContainer = $('po-vendor-results');
  const vendor = procurementState.vendors.find((entry) => Number(entry.id) === Number(vendorId));

  if (!vendor) {
    if (hiddenInput) hiddenInput.value = '';
    if (searchInput) searchInput.value = '';
    setProcurementFieldMessage('vendor_id', 'Please select a vendor from the search results.');
    if (resultsContainer) {
      resultsContainer.classList.remove('open');
      resultsContainer.innerHTML = '';
    }
    return;
  }

  if (hiddenInput) hiddenInput.value = String(vendor.id);
  if (searchInput) searchInput.value = vendor.vendor_name || '';
  setProcurementFieldMessage('vendor_id', '');
  if (resultsContainer) {
    resultsContainer.classList.remove('open');
    resultsContainer.innerHTML = '';
  }
}

function renderCompanyOptions(selectId = 'pr-company') {
  const select = $(selectId);
  if (!select) return;
  const current = select.value;
  select.innerHTML = [
    '<option value="">Select company</option>',
    ...procurementState.companies.map((company) => {
      const label = [company.company_no, company.company_name].filter(Boolean).join(' - ');
      return `<option value="${escHtml(company.id)}">${escHtml(label || company.company_name || 'Company')}</option>`;
    })
  ].join('');
  if (current) select.value = current;
}

function renderProjectOptions(selectId = 'po-project') {
  const select = $(selectId);
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
  if (selectId === 'po-project' && pendingPurchaseOrderProjectId && !select.value) {
    select.value = String(pendingPurchaseOrderProjectId);
  }
}

function renderRequisitionProjectOptions() {
  renderProjectOptions('pr-project');
}

function renderPurchaseOrderRequisitionOptions() {
  const select = $('po-requisition');
  if (!select) return;
  const current = select.value;
  select.innerHTML = [
    '<option value="">Select requisition</option>',
    ...procurementState.requisitions.map((row) => {
      const label = [
        row.pr_number,
        row.company_name,
        row.project_docno || row.project_name
      ].filter(Boolean).join(' - ');
      return `<option value="${escHtml(row.id)}">${escHtml(label || row.pr_number || 'Requisition')}</option>`;
    })
  ].join('');
  if (current) select.value = current;
  if (pendingPurchaseOrderRequisitionId && !select.value) {
    select.value = String(pendingPurchaseOrderRequisitionId);
  }
}

function syncRequisitionCompanyFromProject() {
  const projectSelect = $('pr-project');
  const companySelect = $('pr-company');
  if (!projectSelect || !companySelect) return;

  const projectId = Number(projectSelect.value || 0) || 0;
  if (!projectId) return;

  const project = procurementState.projects.find((entry) => Number(entry.id) === projectId) || null;
  if (!project) return;

  const companyId = Number(project.company_id || project.registry_company_id || 0) || 0;
  if (!companyId) {
    setProcurementFieldMessage('company_id', 'Selected project must be linked to a company.');
    return;
  }

  companySelect.value = String(companyId);
  setProcurementFieldMessage('company_id', '');
}

function applyPurchaseOrderRequisitionSelection(requisitionId = null) {
  const select = $('po-requisition');
  const projectSelect = $('po-project');
  if (!select || !projectSelect) return;

  if (requisitionId !== null && requisitionId !== undefined) {
    select.value = String(requisitionId || '');
  }

  const selectedId = Number(select.value || 0) || 0;
  if (!selectedId) {
    setProcurementFieldMessage('requisition_id', '');
    return;
  }

  const requisition = procurementState.requisitions.find((entry) => Number(entry.id) === selectedId) || null;
  if (!requisition) {
    setProcurementFieldMessage('requisition_id', 'Selected requisition was not found.');
    return;
  }

  setProcurementFieldMessage('requisition_id', '');
  if (requisition.project_id) {
    projectSelect.value = String(requisition.project_id);
    setProcurementFieldMessage('project_id', '');
  }

  const lineContainer = getPurchaseOrderLineItemsContainer();
  const hasMeaningfulLine = Array.from(lineContainer?.querySelectorAll('[data-po-line-item]') || []).some((row) => {
    return Boolean(
      row.querySelector('.po-line-description')?.value?.trim() ||
      Number(row.querySelector('.po-line-qty')?.value || 0) > 0 ||
      Number(row.querySelector('.po-line-unit-price')?.value || 0) > 0
    );
  });

  if (!hasMeaningfulLine) {
    setPurchaseOrderLineItems([{
      description: requisition.item_name || requisition.item_description || '',
      quantity: Number(requisition.quantity || 1) || 1,
      unit_price: Number(requisition.unit_price || 0) || 0
    }]);
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

function getPurchaseOrderLineItemsContainer() {
  return $('po-line-items');
}

function formatPurchaseOrderLineAmount(value) {
  return money(Number(value || 0));
}

function renderPurchaseOrderLineItemRow(item = {}, index = 0) {
  const description = String(item.description || item.item_description || item.item_name || '').trim();
  const quantity = Number(item.quantity || item.qty || 1) > 0 ? Number(item.quantity || item.qty || 1) : 1;
  const unitPrice = Number(item.unit_price || item.price || 0) || 0;
  const lineTotal = quantity * unitPrice;

  return `
    <div class="po-line-item" data-po-line-item data-line-index="${index}">
      <div class="field full">
        <label>Line ${index + 1} Description</label>
        <input type="text" class="po-line-description" placeholder="Enter description" value="${escHtml(description)}" oninput="syncPurchaseOrderLineItem(this)" />
      </div>
      <div class="po-line-meta-grid">
        <div class="field">
          <label>Qty</label>
          <input type="number" class="po-line-qty" min="1" step="1" value="${escHtml(quantity)}" oninput="syncPurchaseOrderLineItem(this)" />
        </div>
        <div class="field">
          <label>Unit Price</label>
          <input type="number" class="po-line-unit-price" min="0" step="0.01" value="${unitPrice ? escHtml(unitPrice.toFixed(2)) : ''}" oninput="syncPurchaseOrderLineItem(this)" />
        </div>
        <div class="field">
          <label>Line Total</label>
          <div class="po-line-total">${formatPurchaseOrderLineAmount(lineTotal)}</div>
        </div>
        <div class="field po-line-action-field">
          <label>&nbsp;</label>
          <button class="btn btn-cancel btn-sm po-line-remove-btn" type="button" onclick="removePurchaseOrderLineItem(this)">Remove</button>
        </div>
      </div>
      <div class="modal-inline-message is-hidden" data-po-line-message aria-live="polite"></div>
    </div>
  `;
}

function setPurchaseOrderLineItems(items = []) {
  const container = getPurchaseOrderLineItemsContainer();
  if (!container) return;

  const normalized = Array.isArray(items) ? items.filter((item) => item) : [];
  const rows = normalized.length ? normalized : [{}];
  container.innerHTML = rows.map((item, index) => renderPurchaseOrderLineItemRow(item, index)).join('');
  recalculatePurchaseOrderLineTotals();
}

function addPurchaseOrderLineItem(item = {}) {
  const container = getPurchaseOrderLineItemsContainer();
  if (!container) return;
  const index = container.querySelectorAll('[data-po-line-item]').length;
  container.insertAdjacentHTML('beforeend', renderPurchaseOrderLineItemRow(item, index));
  recalculatePurchaseOrderLineTotals();

  const lastRow = container.querySelector('[data-po-line-item]:last-child .po-line-description');
  if (lastRow) lastRow.focus();
}

function removePurchaseOrderLineItem(button) {
  const row = button?.closest('[data-po-line-item]');
  const container = getPurchaseOrderLineItemsContainer();
  if (!row || !container) return;

  const rows = container.querySelectorAll('[data-po-line-item]');
  if (rows.length <= 1) {
    row.querySelectorAll('input').forEach((input) => {
      input.value = input.classList.contains('po-line-qty') ? '1' : '';
      if (input.classList.contains('po-line-unit-price')) input.value = '';
    });
    recalculatePurchaseOrderLineTotals();
    return;
  }

  row.remove();
  renumberPurchaseOrderLineItems();
  recalculatePurchaseOrderLineTotals();
}

function renumberPurchaseOrderLineItems() {
  const rows = Array.from(getPurchaseOrderLineItemsContainer()?.querySelectorAll('[data-po-line-item]') || []);
  rows.forEach((row, index) => {
    row.setAttribute('data-line-index', String(index));
    const label = row.querySelector('.field.full label');
    if (label) label.textContent = `Line ${index + 1} Description`;
  });
}

function syncPurchaseOrderLineItem(source) {
  const row = source?.closest('[data-po-line-item]');
  if (!row) return;
  setPurchaseOrderLineItemMessage(row, '');
  const qty = Number(row.querySelector('.po-line-qty')?.value || 0);
  const unitPrice = Number(row.querySelector('.po-line-unit-price')?.value || 0);
  const total = qty > 0 && unitPrice > 0 ? qty * unitPrice : 0;
  const totalNode = row.querySelector('.po-line-total');
  if (totalNode) totalNode.textContent = formatPurchaseOrderLineAmount(total);
  recalculatePurchaseOrderLineTotals();
}

function recalculatePurchaseOrderLineTotals() {
  const rows = Array.from(getPurchaseOrderLineItemsContainer()?.querySelectorAll('[data-po-line-item]') || []);
  let total = 0;

  rows.forEach((row) => {
    const qty = Number(row.querySelector('.po-line-qty')?.value || 0);
    const unitPrice = Number(row.querySelector('.po-line-unit-price')?.value || 0);
    if (qty > 0 && unitPrice > 0) {
      total += qty * unitPrice;
    }
  });

  const totalEl = $('po-total-display');
  if (totalEl) totalEl.textContent = `PHP ${total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

function renderPurchaseOrderItemsCell(row) {
  const items = Array.isArray(row?.line_items) ? row.line_items : [];
  if (!items.length) {
    const fallback = String(row?.item_summary || row?.item_name || '-').trim();
    return `
      <div class="po-item-list">
        <div class="po-item-line">
          <div class="po-item-index">1</div>
          <div class="po-item-copy">
            <div class="po-item-desc">${escHtml(fallback || '-')}</div>
            <div class="po-item-meta">Legacy summary</div>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="po-item-list">
      ${items.map((item, index) => {
        const description = String(item.description || item.product_name || item.product_description || '').trim() || '-';
        const qty = Number(item.quantity || 0);
        const unitPrice = Number(item.unit_price || 0);
        const lineTotal = Number(item.line_total || (qty * unitPrice) || 0);
        return `
          <div class="po-item-line">
            <div class="po-item-index">${index + 1}</div>
            <div class="po-item-copy">
              <div class="po-item-desc">${escHtml(description)}</div>
              <div class="po-item-meta">${qty} x ${money(unitPrice)} = ${money(lineTotal)}</div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function collectPurchaseOrderLineItems() {
  const rows = Array.from(getPurchaseOrderLineItemsContainer()?.querySelectorAll('[data-po-line-item]') || []);
  const items = [];
  const incompleteRows = [];

  rows.forEach((row, index) => {
    const description = String(row.querySelector('.po-line-description')?.value || '').trim();
    const quantity = Number(row.querySelector('.po-line-qty')?.value || 0);
    const unitPrice = Number(row.querySelector('.po-line-unit-price')?.value || 0);
    const hasAnyValue = description || quantity > 0 || unitPrice > 0;
    if (!hasAnyValue) return;

    if (!description || quantity <= 0 || unitPrice <= 0) {
      incompleteRows.push(index + 1);
      return;
    }

    items.push({
      description,
      quantity,
      unit_price: unitPrice,
      product_id: null
    });
  });

  return { items, incompleteRows };
}

function filteredRows(rows, searchValue, fields) {
  const q = String(searchValue || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => fields.map((field) => String(row[field] ?? '')).join(' ').toLowerCase().includes(q));
}

function renderRequisitions() {
  const tbody = $('pr-body');
  if (!tbody) return;

  const rows = filteredRows(procurementState.requisitions, $('procurement-search-input')?.value, [
    'pr_number',
    'company_name',
    'company_no',
    'project_name',
    'project_docno',
    'department',
    'requested_by',
    'item_name',
    'status'
  ]);

  tbody.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td style="font-weight:600;color:var(--primary)">${escHtml(row.pr_number)}</td>
      <td>${escHtml([row.company_no, row.company_name].filter(Boolean).join(' - ') || '-')}</td>
      <td>${escHtml([row.project_docno, row.project_name].filter(Boolean).join(' - ') || '-')}</td>
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
          <button class="btn btn-edit btn-sm" type="button" onclick="openPurchaseOrderModal(null, null, null, ${Number(row.id)})">Use in PO</button>
          <button class="btn btn-edit btn-sm" type="button" onclick="openRequisitionModal(${Number(row.id)})">Edit</button>
          <button class="btn btn-cancel btn-sm" type="button" onclick="deleteRequisition(${Number(row.id)})">Delete</button>
        </div>
      </td>
    </tr>
  `).join('') : '<tr class="empty-row"><td colspan="13">No requisitions found.</td></tr>';
}

function renderPurchaseOrders() {
  const tbody = $('po-body');
  if (!tbody) return;

  const rows = filteredRows(procurementState.purchaseOrders, $('procurement-search-input')?.value, [
    'po_number',
    'requisition_number',
    'vendor_name',
    'company_name',
    'company_no',
    'project_name',
    'project_docno',
    'item_summary',
    'status'
  ]);

  tbody.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td style="font-weight:600;color:var(--primary)">${escHtml(row.po_number)}</td>
      <td>${escHtml(row.requisition_number || '-')}</td>
      <td>${escHtml(row.vendor_name || '-')}</td>
      <td>${escHtml(dateText(row.po_date))}</td>
      <td>${escHtml(dateText(row.delivery_date))}</td>
      <td><span class="status-chip ${statusClass(row.status)}">${escHtml(row.status || 'draft')}</span></td>
      <td style="min-width:300px;">${renderPurchaseOrderItemsCell(row)}</td>
      <td class="text-right"><span class="po-line-count">${escHtml(Number(row.line_count || row.line_items?.length || 0))}</span></td>
      <td class="text-right">${escHtml(money(row.computed_total || row.total_amount || 0))}</td>
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

  const rows = filteredRows(procurementState.goodsReceipts, $('procurement-search-input')?.value, [
    'grn_number',
    'po_number',
    'vendor_name',
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
  if ($('pr-company')) $('pr-company').value = '';
  if ($('pr-project')) $('pr-project').value = '';
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
  clearProcurementFieldMessages();
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
  clearProcurementFieldMessages();
  renderCompanyOptions();
  renderRequisitionProjectOptions();
  if (editingRequisitionId) {
    const row = procurementState.requisitions.find((entry) => Number(entry.id) === editingRequisitionId);
    if (!row) {
      showToast('Requisition not found.', 'error');
      editingRequisitionId = null;
      return;
    }
    $('pr-number').value = row.pr_number || '';
    $('pr-company').value = row.company_id || '';
    $('pr-request-date').value = dateInputValue(row.request_date);
    $('pr-project').value = row.project_id || '';
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
    if (row.project_id) {
      syncRequisitionCompanyFromProject();
    }
  }
  syncRequisitionModalMode();
  openBackdrop('pr-modal-backdrop');
}

function closeRequisitionModal() {
  editingRequisitionId = null;
  closeBackdrop('pr-modal-backdrop');
  resetRequisitionForm();
  clearProcurementFieldMessages();
  syncRequisitionModalMode();
}

async function saveRequisition() {
  clearProcurementFieldMessages();
  const companyId = Number($('pr-company').value || 0) || 0;
  const projectId = Number($('pr-project').value || 0) || 0;
  const selectedProject = procurementState.projects.find((entry) => Number(entry.id) === projectId) || null;
  const projectCompanyId = Number(selectedProject?.company_id || selectedProject?.registry_company_id || 0) || 0;
  const resolvedCompanyId = companyId || projectCompanyId || 0;
  if (!companyId && resolvedCompanyId && $('pr-company')) {
    $('pr-company').value = String(resolvedCompanyId);
  }
  const payload = {
    pr_number: $('pr-number').value.trim(),
    company_id: resolvedCompanyId,
    project_id: projectId || null,
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

  let hasValidationError = false;
  const markError = (fieldName, message) => {
    setProcurementFieldMessage(fieldName, message);
    hasValidationError = true;
  };

  if (!payload.request_date) markError('request_date', 'Request Date is required.');
  if (!resolvedCompanyId) markError('company_id', 'Company selection is required.');
  if (projectId && !selectedProject) markError('project_id', 'Selected project was not found.');
  if (projectId && selectedProject && projectCompanyId && resolvedCompanyId && projectCompanyId !== resolvedCompanyId) {
    markError('company_id', 'Selected company must match the project company.');
  }
  if (!payload.item_name) markError('item_name', 'Item Name is required.');
  if (Number(payload.quantity || 0) <= 0) markError('quantity', 'Qty is required.');

  if (hasValidationError) return;

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
    const errorText = String(err?.message || '').toLowerCase();
    if (errorText.includes('duplicate') || errorText.includes('already exists')) {
      setProcurementFieldMessage('pr_number', err.message || 'PR No. already exists.');
      return;
    }
    if (errorText.includes('company')) {
      setProcurementFieldMessage('company_id', err.message || 'Company selection is required.');
      return;
    }
    if (errorText.includes('project')) {
      setProcurementFieldMessage('project_id', err.message || 'Project selection is invalid.');
      return;
    }
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
  ['po-number', 'po-notes'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });
  if ($('po-requisition')) $('po-requisition').value = '';
  if ($('po-project')) $('po-project').value = '';
  if ($('po-vendor')) $('po-vendor').value = '';
  if ($('po-vendor-search')) $('po-vendor-search').value = '';
  if ($('po-status')) $('po-status').value = 'draft';
  if ($('po-date')) $('po-date').value = new Date().toISOString().slice(0, 10);
  if ($('po-delivery')) $('po-delivery').value = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  setPurchaseOrderLineItems([]);
  clearPurchaseOrderLineItemMessages();
  recalculatePurchaseOrderLineTotals();
  clearProcurementFieldMessages();
}

function syncPurchaseOrderModalMode() {
  const title = $('po-modal-title');
  const saveBtn = $('po-save-btn');
  if (title) title.textContent = editingPurchaseOrderId ? 'Edit Purchase Order' : 'Add Purchase Order';
  if (saveBtn) saveBtn.textContent = editingPurchaseOrderId ? 'Save Changes' : 'Create Purchase Order';
}

function openPurchaseOrderModal(id = null, projectId = null, vendorId = null, requisitionId = null) {
  editingPurchaseOrderId = id ? Number(id) : null;
  resetPurchaseOrderForm();
  clearProcurementFieldMessages();
  renderCompanyOptions();
  renderVendorOptions();
  renderProjectOptions();
  renderPurchaseOrderRequisitionOptions();
  initVendorSearch();

  if (editingPurchaseOrderId) {
    const row = procurementState.purchaseOrders.find((entry) => Number(entry.id) === editingPurchaseOrderId);
    if (!row) {
      showToast('Purchase order not found.', 'error');
      editingPurchaseOrderId = null;
      return;
    }
    $('po-number').value = row.po_number || '';
    $('po-requisition').value = row.requisition_id || '';
    $('po-project').value = row.project_id || '';
    applyPurchaseOrderVendorSelection(row.vendor_id);
    $('po-date').value = dateInputValue(row.po_date);
    $('po-delivery').value = dateInputValue(row.delivery_date);
    $('po-status').value = row.status || 'draft';
    $('po-notes').value = row.notes || '';
    if (row.requisition_id) {
      applyPurchaseOrderRequisitionSelection(row.requisition_id);
    }
    if (Array.isArray(row.line_items) && row.line_items.length) {
      setPurchaseOrderLineItems(row.line_items);
    } else if (row.item_summary || row.item_name) {
      setPurchaseOrderLineItems([{
        description: row.item_summary || row.item_name || '',
        quantity: row.quantity || 1,
        unit_price: row.unit_price || 0
      }]);
    }
  } else if (projectId) {
    $('po-project').value = String(projectId);
  }
  if (!editingPurchaseOrderId && requisitionId) {
    applyPurchaseOrderRequisitionSelection(requisitionId);
  }
  if (!editingPurchaseOrderId && vendorId) {
    applyPurchaseOrderVendorSelection(vendorId);
  }
  syncPurchaseOrderModalMode();
  openBackdrop('po-modal-backdrop');
}

function closePurchaseOrderModal() {
  editingPurchaseOrderId = null;
  closeBackdrop('po-modal-backdrop');
  resetPurchaseOrderForm();
  clearProcurementFieldMessages();
  syncPurchaseOrderModalMode();
}

async function savePurchaseOrder() {
  clearProcurementFieldMessages();
  clearPurchaseOrderLineItemMessages();
  const collected = collectPurchaseOrderLineItems();
  const lineRows = Array.from(getPurchaseOrderLineItemsContainer()?.querySelectorAll('[data-po-line-item]') || []);
  const requisitionId = Number($('po-requisition').value || 0) || 0;
  const requisitionRow = requisitionId
    ? procurementState.requisitions.find((entry) => Number(entry.id) === requisitionId) || null
    : null;
  const projectId = Number($('po-project').value || 0) || Number(requisitionRow?.project_id || 0) || 0;
  const vendorId = Number($('po-vendor').value || 0) || 0;
  const selectedProject = procurementState.projects.find((entry) => Number(entry.id) === projectId) || null;
  const companyId = Number(selectedProject?.company_id || selectedProject?.registry_company_id || 0) || 0;
  const requisitionCompanyId = Number(requisitionRow?.company_id || 0) || 0;
  const requisitionProjectId = Number(requisitionRow?.project_id || 0) || 0;
  if (!$('po-project').value && projectId && $('po-project')) {
    $('po-project').value = String(projectId);
  }
  const payload = {
    po_number: $('po-number').value.trim(),
    requisition_id: requisitionId || null,
    project_id: projectId,
    vendor_id: vendorId,
    po_date: $('po-date').value,
    delivery_date: $('po-delivery').value,
    status: $('po-status').value,
    notes: $('po-notes').value.trim(),
    company_id: companyId,
    items: collected.items
  };

  let hasValidationError = false;
  const markError = (fieldName, message) => {
    setProcurementFieldMessage(fieldName, message);
    hasValidationError = true;
  };

  if (!payload.project_id) markError('project_id', 'Project selection is required.');
  if (!payload.vendor_id) markError('vendor_id', 'Vendor selection is required.');
  if (!payload.po_date) markError('po_date', 'PO Date is required.');
  if (requisitionId && !requisitionRow) markError('requisition_id', 'Selected requisition was not found.');
  if (requisitionId && requisitionProjectId && projectId && requisitionProjectId !== projectId) {
    markError('requisition_id', 'Selected requisition must match the selected project.');
  }

  if (!selectedProject && payload.project_id) {
    markError('project_id', 'Selected project was not found.');
  } else if (!companyId && selectedProject) {
    markError('project_id', 'Selected project must be linked to a company before creating a PO.');
  }
  if (requisitionId && requisitionCompanyId && companyId && requisitionCompanyId !== companyId) {
    markError('requisition_id', 'Selected requisition must belong to the same company.');
  }

  if (collected.incompleteRows.length) {
    collected.incompleteRows.forEach((lineNo) => {
      const row = lineRows[lineNo - 1];
      if (row) {
        setPurchaseOrderLineItemMessage(row, 'Description, Qty, and Unit Price are required for this line item.');
      }
    });
    markError('line_items', 'Complete the highlighted line item(s).');
  } else if (!collected.items.length) {
    const firstRow = lineRows[0];
    if (firstRow) {
      setPurchaseOrderLineItemMessage(firstRow, 'Add at least one complete description line item.');
    }
    markError('line_items', 'Add at least one complete description line item.');
  }

  if (hasValidationError) return;

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
    const errorText = String(err?.message || '').toLowerCase();
    if (errorText.includes('duplicate') || errorText.includes('already exists')) {
      setProcurementFieldMessage('po_number', err.message || 'PO No. already exists.');
      return;
    }
    if (errorText.includes('project')) {
      setProcurementFieldMessage('project_id', err.message || 'Project selection is required.');
      return;
    }
    if (errorText.includes('company')) {
      setProcurementFieldMessage('project_id', err.message || 'Selected project must be linked to a company before creating a PO.');
      return;
    }
    if (errorText.includes('requisition')) {
      setProcurementFieldMessage('requisition_id', err.message || 'Selected requisition is not valid for this project.');
      return;
    }
    if (errorText.includes('vendor')) {
      setProcurementFieldMessage('vendor_id', err.message || 'Vendor selection is required.');
      return;
    }
    if (errorText.includes('date')) {
      setProcurementFieldMessage('po_date', err.message || 'PO Date is required.');
      return;
    }
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
  clearProcurementFieldMessages();
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
  clearProcurementFieldMessages();
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
  clearProcurementFieldMessages();
  syncGoodsReceiptModalMode();
}

async function saveGoodsReceipt() {
  clearProcurementFieldMessages();
  const payload = {
    grn_number: $('grn-number').value.trim(),
    po_id: $('grn-po').value,
    received_date: $('grn-received-date').value,
    received_by: $('grn-received-by').value.trim(),
    status: $('grn-status').value,
    notes: $('grn-notes').value.trim()
  };

  let hasValidationError = false;
  const markError = (fieldName, message) => {
    setProcurementFieldMessage(fieldName, message);
    hasValidationError = true;
  };

  if (!payload.po_id) markError('po_id', 'PO No. is required.');
  if (!payload.received_date) markError('received_date', 'Received Date is required.');

  if (hasValidationError) return;

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
    const errorText = String(err?.message || '').toLowerCase();
    if (errorText.includes('duplicate') || errorText.includes('already exists')) {
      setProcurementFieldMessage('grn_number', err.message || 'GRN No. already exists.');
      return;
    }
    if (errorText.includes('po')) {
      setProcurementFieldMessage('po_id', err.message || 'PO No. is required.');
      return;
    }
    if (errorText.includes('date')) {
      setProcurementFieldMessage('received_date', err.message || 'Received Date is required.');
      return;
    }
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
