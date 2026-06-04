'use strict';

const BUSINESS_ENTITY_CONTEXT_KEY = 'kinaadman_businessEntityContext';
let businessEntitiesDb = [];
let productsDb = [];
let warehousesDb = [];
let stockDb = [];
let movementsDb = [];
let projectsDb = [];
let inventoryRequestsDb = [];
let editingInventoryRequestId = null;
let editingInventoryRequestType = '';
let editingProductId = null;
let editingWarehouseId = null;
let inventoryConfirmResolver = null;

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('movement-date').value = new Date().toISOString().slice(0, 10);
  setupInventoryModalCloseHandlers();
  applyInventoryAdminColumns();
  switchInventoryTab(getInitialInventoryTab(), { syncUrl: false });
  await loadBusinessEntities();
  await loadInventory();
  if (isInventoryStaffRole()) await loadInventoryRequests();
});

function getInitialInventoryTab() {
  const params = new URLSearchParams(window.location.search || '');
  return normalizeInventoryTab(params.get('tab') || 'products');
}

function normalizeInventoryTab(tab) {
  return ['stock', 'products', 'warehouses', 'movements', 'requests'].includes(String(tab || '').trim().toLowerCase())
    ? String(tab || '').trim().toLowerCase()
    : 'products';
}

function isInventoryStaffRole() {
  try {
    const cached = JSON.parse(localStorage.getItem('kinaadman_currentUserBadge') || '{}');
    return String(cached.role || '').trim().toLowerCase() === 'staff';
  } catch (_) {
    return false;
  }
}

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInventoryStatusLabel(status) {
  const normalized = String(status || 'draft').trim().toLowerCase();
  const labels = {
    draft: 'Draft',
    submitted: 'Submitted',
    pending: 'Pending Approval',
    needs_revision: 'Needs Revision',
    rejected: 'Needs Revision',
    approved: 'Approved'
  };
  return labels[normalized] || normalized.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function getDefaultBusinessEntityId() {
  const defaultRow = businessEntitiesDb.find(row => Number(row.is_default || 0) === 1) || businessEntitiesDb[0] || null;
  return defaultRow ? String(defaultRow.id || '') : '';
}

function getCurrentBusinessEntityId() {
  const stored = String(localStorage.getItem(BUSINESS_ENTITY_CONTEXT_KEY) || '').trim();
  if (stored && businessEntitiesDb.some(row => String(row.id || '') === stored)) return stored;
  const fallback = getDefaultBusinessEntityId();
  if (fallback) localStorage.setItem(BUSINESS_ENTITY_CONTEXT_KEY, fallback);
  return fallback;
}

function applyWorkspaceBadge() {
  const badge = document.getElementById('current-workspace-badge');
  if (badge) {
    badge.textContent = 'KVSK Workspace';
    badge.title = 'KVSK CCTV & IT Solution';
    badge.setAttribute('aria-label', 'Current workspace: KVSK CCTV & IT Solution');
  }
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

function inventoryQuery() {
  return new URLSearchParams({ business_entity_id: getCurrentBusinessEntityId() || '' }).toString();
}

async function loadInventory() {
  const query = inventoryQuery();
  const [summary, products, warehouses, stock, movements, projects] = await Promise.all([
    fetchJson(`/api/inventory/summary?${query}`),
    fetchJson(`/api/inventory/products?${query}`),
    fetchJson(`/api/inventory/warehouses?${query}`),
    fetchJson(`/api/inventory/stock?${query}`),
    fetchJson(`/api/inventory/movements?${query}`),
    fetchJson('/api/projects?include_archived=1')
  ]);
  productsDb = Array.isArray(products) ? products : [];
  warehousesDb = Array.isArray(warehouses) ? warehouses : [];
  stockDb = Array.isArray(stock) ? stock : [];
  movementsDb = Array.isArray(movements) ? movements : [];
  projectsDb = (Array.isArray(projects) ? projects : []).filter(row => String(row.business_entity_id || '') === String(getCurrentBusinessEntityId() || ''));
  renderSummary(summary || {});
  renderInventory();
  populateMovementSelects();
}

function renderSummary(summary) {
  document.getElementById('metric-products').textContent = Number(summary.products || 0);
  document.getElementById('metric-warehouses').textContent = Number(summary.warehouses || 0);
  document.getElementById('metric-on-hand').textContent = Number(summary.on_hand || 0).toLocaleString('en-PH');
  document.getElementById('metric-low-stock').textContent = Number(summary.low_stock || 0);
  const movementsMetric = document.getElementById('metric-movements');
  if (movementsMetric) movementsMetric.textContent = Number(movementsDb.length || 0).toLocaleString('en-PH');
}

function applyInventoryAdminColumns() {
  const showAdminCols = !isInventoryStaffRole();
  document.querySelectorAll('[data-inventory-admin-col]').forEach(node => {
    node.hidden = !showAdminCols;
  });
}

function renderInventory() {
  applyInventoryAdminColumns();
  const isAdmin = !isInventoryStaffRole();
  const q = String(document.getElementById('inventory-search')?.value || '').trim().toLowerCase();
  const stockBody = document.getElementById('stock-tbody');
  const rows = stockDb.filter(row => {
    const haystack = [row.sku, row.product_name, row.category, row.warehouse_code, row.warehouse_name].join(' ').toLowerCase();
    return !q || haystack.includes(q);
  });
  stockBody.innerHTML = rows.length ? rows.map(row => {
    const qty = Number(row.quantity_on_hand || 0);
    const reorder = Number(row.reorder_level || 0);
    return `
      <tr>
        <td>${escHtml(row.sku || '-')}</td>
        <td>${escHtml(row.product_name || '-')}</td>
        <td>${escHtml([row.warehouse_code, row.warehouse_name].filter(Boolean).join(' - ') || '-')}</td>
        <td class="text-right ${qty <= reorder ? 'stock-low' : 'stock-ok'}">${qty.toLocaleString('en-PH')}</td>
        <td class="text-right">${reorder.toLocaleString('en-PH')}</td>
      </tr>
    `;
  }).join('') : '<tr><td colspan="5">No stock records yet.</td></tr>';

  const productsBody = document.getElementById('products-tbody');
  if (productsBody) {
    const productCols = isAdmin ? 9 : 8;
    productsBody.innerHTML = productsDb.length ? productsDb.map(row => `
      <tr>
        <td>${escHtml(row.sku || '-')}</td>
        <td>${escHtml(row.product_name || '-')}</td>
        <td>${escHtml(row.category || '-')}</td>
        <td>${escHtml(row.unit || 'pcs')}</td>
        <td class="text-right">${Number(row.unit_cost || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
        <td class="text-right">${Number(row.selling_price || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
        <td class="text-right">${Number(row.reorder_level || 0).toLocaleString('en-PH')}</td>
        <td class="text-right">${Number(row.quantity_on_hand || 0).toLocaleString('en-PH')}</td>
        ${isAdmin ? `<td class="text-right inventory-row-actions">
          <button class="btn btn-edit btn-sm" type="button" onclick="editProduct(${Number(row.id)})">Edit</button>
          <button class="btn btn-cancel btn-sm" type="button" onclick="archiveProduct(${Number(row.id)})">Archive</button>
        </td>` : ''}
      </tr>
    `).join('') : `<tr><td colspan="${productCols}">No products yet.</td></tr>`;
  }

  const warehousesBody = document.getElementById('warehouses-tbody');
  if (warehousesBody) {
    const warehouseCols = isAdmin ? 5 : 4;
    warehousesBody.innerHTML = warehousesDb.length ? warehousesDb.map(row => `
      <tr>
        <td>${escHtml(row.warehouse_code || '-')}</td>
        <td>${escHtml(row.warehouse_name || '-')}</td>
        <td>${escHtml(row.location || '-')}</td>
        <td>${Number(row.is_active ?? 1) ? 'Active' : 'Inactive'}</td>
        ${isAdmin ? `<td class="text-right inventory-row-actions">
          <button class="btn btn-edit btn-sm" type="button" onclick="editWarehouse(${Number(row.id)})">Edit</button>
          <button class="btn btn-cancel btn-sm" type="button" onclick="archiveWarehouse(${Number(row.id)})">Archive</button>
        </td>` : ''}
      </tr>
    `).join('') : `<tr><td colspan="${warehouseCols}">No warehouses yet.</td></tr>`;
  }

  const movementBody = document.getElementById('movement-tbody');
  movementBody.innerHTML = movementsDb.length ? movementsDb.map(row => `
    <tr>
      <td>${escHtml(String(row.movement_date || '').slice(0, 10) || '-')}</td>
      <td>${escHtml(String(row.movement_type || '').toUpperCase())}</td>
      <td>${escHtml([row.sku, row.product_name].filter(Boolean).join(' - ') || '-')}</td>
      <td class="text-right">${Number(row.quantity || 0).toLocaleString('en-PH')}</td>
      <td>${escHtml([row.project_docno, row.project_name].filter(Boolean).join(' - ') || '-')}</td>
      <td>${escHtml([row.reference_type, row.reference_no].filter(Boolean).join(' - ') || '-')}</td>
    </tr>
  `).join('') : '<tr><td colspan="6">No stock movements yet.</td></tr>';
}

function switchInventoryTab(tab, options = {}) {
  const safeTab = normalizeInventoryTab(tab);
  document.querySelectorAll('.inventory-tab').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === safeTab);
  });
  document.querySelectorAll('.inventory-section').forEach(section => {
    section.classList.toggle('active', section.id === `inventory-tab-${safeTab}`);
  });
  syncInventoryToolbarActions(safeTab);
  if (options.syncUrl !== false && window.history?.replaceState) {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', safeTab);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash || ''}`);
    if (typeof syncSidebarActiveLinks === 'function') syncSidebarActiveLinks();
  }
  if (safeTab === 'requests' && isInventoryStaffRole()) {
    loadInventoryRequests().catch(() => {});
  }
}

function syncInventoryToolbarActions(tab = 'stock') {
  const safeTab = normalizeInventoryTab(tab);
  const staffRole = isInventoryStaffRole();
  document.querySelectorAll('[data-staff-inventory-requests]').forEach(node => {
    node.hidden = !staffRole;
  });
  document.querySelectorAll('[data-inventory-action]').forEach(button => {
    const tabs = String(button.dataset.inventoryAction || '')
      .split(/\s+/)
      .map(value => value.trim())
      .filter(Boolean);
    button.hidden = !tabs.includes(safeTab);
    if (button.hidden) return;
    if (safeTab === 'products') button.textContent = staffRole ? 'Request Product' : 'New Product';
    if (safeTab === 'warehouses') button.textContent = staffRole ? 'Request Warehouse' : 'New Warehouse';
    if (safeTab === 'movements') button.textContent = staffRole ? 'Request Stock Movement' : 'Stock Movement';
  });
}

function populateMovementSelects() {
  const productSelect = document.getElementById('movement-product');
  const warehouseSelect = document.getElementById('movement-warehouse');
  const projectSelect = document.getElementById('movement-project');
  productSelect.innerHTML = '<option value="">Select product</option>' + productsDb.map(row => `<option value="${Number(row.id)}">${escHtml([row.sku, row.product_name].filter(Boolean).join(' - '))}</option>`).join('');
  warehouseSelect.innerHTML = '<option value="">Select warehouse</option>' + warehousesDb.map(row => `<option value="${Number(row.id)}">${escHtml([row.warehouse_code, row.warehouse_name].filter(Boolean).join(' - '))}</option>`).join('');
  if (projectSelect) {
    projectSelect.innerHTML = '<option value="">No project link</option>' + projectsDb.map(row => `<option value="${Number(row.id)}">${escHtml([row.project_docno, row.project_name].filter(Boolean).join(' - '))}</option>`).join('');
  }
}

function setStatus(message = '') {
  document.getElementById('inventory-status').textContent = message;
}

function openInventoryModal(type) {
  editingInventoryRequestId = null;
  editingInventoryRequestType = '';
  editingProductId = null;
  editingWarehouseId = null;
  setStatus('');
  document.getElementById('inventory-modal').classList.add('open');
  document.getElementById('inventory-modal').setAttribute('aria-hidden', 'false');
  const staffRole = isInventoryStaffRole();
  document.getElementById('inventory-modal-title').textContent = staffRole
    ? (type === 'product' ? 'Request Product' : type === 'warehouse' ? 'Request Warehouse' : 'Request Stock Movement')
    : (type === 'product' ? 'New Product' : type === 'warehouse' ? 'New Warehouse' : 'Stock Movement');
  ['product-form', 'warehouse-form', 'movement-form'].forEach(id => document.getElementById(id).classList.remove('active'));
  document.getElementById(`${type}-form`)?.classList.add('active');
  const productSave = document.querySelector('#product-form .btn-save');
  const warehouseSave = document.querySelector('#warehouse-form .btn-save');
  const movementSave = document.querySelector('#movement-form .btn-save');
  if (productSave) productSave.textContent = staffRole ? 'Save Product Request' : 'Save Product';
  if (warehouseSave) warehouseSave.textContent = staffRole ? 'Save Warehouse Request' : 'Save Warehouse';
  if (movementSave) movementSave.textContent = staffRole ? 'Save Movement Request' : 'Save Movement';
}

function openInventoryRequestDraft(requestId) {
  const row = inventoryRequestsDb.find((entry) => Number(entry.id || 0) === Number(requestId || 0));
  if (!row || String(row.status || '').toLowerCase() !== 'draft') {
    setStatus('Only draft inventory requests can be edited.');
    return;
  }
  const type = String(row.request_type || '').toLowerCase();
  const payload = row.payload || {};
  openInventoryModal(type);
  editingInventoryRequestId = Number(row.id || 0);
  editingInventoryRequestType = type;
  document.getElementById('inventory-modal-title').textContent = 'Edit Inventory Draft';
  if (type === 'product') {
    document.getElementById('product-sku').value = payload.sku || '';
    document.getElementById('product-name').value = payload.product_name || '';
    document.getElementById('product-category').value = payload.category || '';
    document.getElementById('product-unit').value = payload.unit || 'pcs';
    document.getElementById('product-cost').value = payload.unit_cost || '';
    document.getElementById('product-selling-price').value = payload.selling_price || '';
    document.getElementById('product-reorder').value = payload.reorder_level || '';
    const saveBtn = document.querySelector('#product-form .btn-save');
    if (saveBtn) saveBtn.textContent = 'Update Draft';
  } else if (type === 'warehouse') {
    document.getElementById('warehouse-code').value = payload.warehouse_code || '';
    document.getElementById('warehouse-name').value = payload.warehouse_name || '';
    document.getElementById('warehouse-location').value = payload.location || '';
    const saveBtn = document.querySelector('#warehouse-form .btn-save');
    if (saveBtn) saveBtn.textContent = 'Update Draft';
  } else if (type === 'movement') {
    document.getElementById('movement-product').value = payload.product_id || '';
    document.getElementById('movement-warehouse').value = payload.warehouse_id || '';
    document.getElementById('movement-type').value = payload.movement_type || 'in';
    document.getElementById('movement-qty').value = payload.quantity || '';
    document.getElementById('movement-project').value = payload.project_id || '';
    document.getElementById('movement-date').value = payload.movement_date || new Date().toISOString().slice(0, 10);
    document.getElementById('movement-ref-type').value = payload.reference_type || '';
    document.getElementById('movement-ref-no').value = payload.reference_no || '';
    document.getElementById('movement-notes').value = payload.notes || '';
    const saveBtn = document.querySelector('#movement-form .btn-save');
    if (saveBtn) saveBtn.textContent = 'Update Draft';
  }
}

function editProduct(id) {
  if (isInventoryStaffRole()) return;
  const row = productsDb.find(item => Number(item.id) === Number(id));
  if (!row) {
    setStatus('Product not found.');
    return;
  }
  openInventoryModal('product');
  editingProductId = Number(row.id);
  document.getElementById('inventory-modal-title').textContent = 'Edit Product';
  document.getElementById('product-sku').value = row.sku || '';
  document.getElementById('product-name').value = row.product_name || '';
  document.getElementById('product-category').value = row.category || '';
  document.getElementById('product-unit').value = row.unit || 'pcs';
  document.getElementById('product-cost').value = row.unit_cost ?? '';
  document.getElementById('product-selling-price').value = row.selling_price ?? '';
  document.getElementById('product-reorder').value = row.reorder_level ?? '';
  const saveBtn = document.querySelector('#product-form .btn-save');
  if (saveBtn) saveBtn.textContent = 'Update Product';
}

function editWarehouse(id) {
  if (isInventoryStaffRole()) return;
  const row = warehousesDb.find(item => Number(item.id) === Number(id));
  if (!row) {
    setStatus('Warehouse not found.');
    return;
  }
  openInventoryModal('warehouse');
  editingWarehouseId = Number(row.id);
  document.getElementById('inventory-modal-title').textContent = 'Edit Warehouse';
  document.getElementById('warehouse-code').value = row.warehouse_code || '';
  document.getElementById('warehouse-name').value = row.warehouse_name || '';
  document.getElementById('warehouse-location').value = row.location || '';
  const saveBtn = document.querySelector('#warehouse-form .btn-save');
  if (saveBtn) saveBtn.textContent = 'Update Warehouse';
}

async function archiveProduct(id) {
  if (isInventoryStaffRole()) return;
  const row = productsDb.find(item => Number(item.id) === Number(id));
  const confirmed = await openInventoryConfirmDialog({
    title: 'Archive Product?',
    message: `Archive "${row?.product_name || 'this product'}"? It will be hidden from active inventory lists.`,
    noText: 'Cancel',
    yesText: 'Archive'
  });
  if (!confirmed) return;
  try {
    await fetchJson(`/api/inventory/products/${Number(id)}/archive`, { method: 'POST' });
    await loadInventory();
  } catch (err) {
    setStatus(err.message || 'Unable to archive product.');
  }
}

async function archiveWarehouse(id) {
  if (isInventoryStaffRole()) return;
  const row = warehousesDb.find(item => Number(item.id) === Number(id));
  const confirmed = await openInventoryConfirmDialog({
    title: 'Archive Warehouse?',
    message: `Archive "${row?.warehouse_name || 'this warehouse'}"? It will be hidden from active inventory lists.`,
    noText: 'Cancel',
    yesText: 'Archive'
  });
  if (!confirmed) return;
  try {
    await fetchJson(`/api/inventory/warehouses/${Number(id)}/archive`, { method: 'POST' });
    await loadInventory();
  } catch (err) {
    setStatus(err.message || 'Unable to archive warehouse.');
  }
}

function closeInventoryModal() {
  editingInventoryRequestId = null;
  editingInventoryRequestType = '';
  editingProductId = null;
  editingWarehouseId = null;
  document.getElementById('inventory-modal').classList.remove('open');
  document.getElementById('inventory-modal').setAttribute('aria-hidden', 'true');
}

function openInventoryConfirmDialog({
  title = 'Confirm Action',
  message = 'Are you sure?',
  noText = 'Cancel',
  yesText = 'Submit'
} = {}) {
  const backdrop = document.getElementById('inventory-confirm-modal');
  if (!backdrop) return Promise.resolve(false);
  const titleEl = document.getElementById('inventory-confirm-title');
  const messageEl = document.getElementById('inventory-confirm-message');
  const noBtn = document.getElementById('inventory-confirm-no-btn');
  const yesBtn = document.getElementById('inventory-confirm-yes-btn');
  if (titleEl) titleEl.textContent = title;
  if (messageEl) messageEl.textContent = message;
  if (noBtn) noBtn.textContent = noText;
  if (yesBtn) yesBtn.textContent = yesText;
  backdrop.classList.add('open');
  backdrop.setAttribute('aria-hidden', 'false');
  return new Promise((resolve) => {
    inventoryConfirmResolver = resolve;
    setTimeout(() => yesBtn?.focus(), 0);
  });
}

function closeInventoryConfirmDialog(result = false) {
  const backdrop = document.getElementById('inventory-confirm-modal');
  if (backdrop) {
    backdrop.classList.remove('open');
    backdrop.setAttribute('aria-hidden', 'true');
  }
  if (inventoryConfirmResolver) {
    const resolve = inventoryConfirmResolver;
    inventoryConfirmResolver = null;
    resolve(Boolean(result));
  }
}

function setupInventoryModalCloseHandlers() {
  const modal = document.getElementById('inventory-modal');
  if (modal && modal.dataset.closeHandlersBound !== '1') {
    modal.dataset.closeHandlersBound = '1';
    modal.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) closeInventoryModal();
    });
  }
  const confirmModal = document.getElementById('inventory-confirm-modal');
  if (confirmModal && confirmModal.dataset.closeHandlersBound !== '1') {
    confirmModal.dataset.closeHandlersBound = '1';
    confirmModal.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) closeInventoryConfirmDialog(false);
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (document.getElementById('inventory-confirm-modal')?.classList.contains('open')) {
      closeInventoryConfirmDialog(false);
      return;
    }
    if (document.getElementById('inventory-modal')?.classList.contains('open')) {
      closeInventoryModal();
    }
  });
}

async function saveProduct(event) {
  event.preventDefault();
  setStatus('');
  const payload = {
    business_entity_id: getCurrentBusinessEntityId(),
    sku: document.getElementById('product-sku').value,
    product_name: document.getElementById('product-name').value,
    category: document.getElementById('product-category').value,
    unit: document.getElementById('product-unit').value,
    unit_cost: document.getElementById('product-cost').value,
    selling_price: document.getElementById('product-selling-price').value,
    reorder_level: document.getElementById('product-reorder').value
  };
  try {
    if (isInventoryStaffRole()) {
      await saveInventoryRequest('product', payload);
    } else if (editingProductId) {
      await fetchJson(`/api/inventory/products/${Number(editingProductId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
    } else {
      await fetchJson('/api/inventory/products', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
    event.target.reset();
    document.getElementById('product-unit').value = 'pcs';
    closeInventoryModal();
    if (isInventoryStaffRole()) {
      await loadInventoryRequests();
      switchInventoryTab('requests');
    } else {
      await loadInventory();
    }
  } catch (err) {
    setStatus(err.message || 'Unable to save product.');
  }
}

async function saveWarehouse(event) {
  event.preventDefault();
  setStatus('');
  const payload = {
    business_entity_id: getCurrentBusinessEntityId(),
    warehouse_code: document.getElementById('warehouse-code').value,
    warehouse_name: document.getElementById('warehouse-name').value,
    location: document.getElementById('warehouse-location').value
  };
  try {
    if (isInventoryStaffRole()) {
      await saveInventoryRequest('warehouse', payload);
    } else if (editingWarehouseId) {
      await fetchJson(`/api/inventory/warehouses/${Number(editingWarehouseId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
    } else {
      await fetchJson('/api/inventory/warehouses', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
    event.target.reset();
    closeInventoryModal();
    if (isInventoryStaffRole()) {
      await loadInventoryRequests();
      switchInventoryTab('requests');
    } else {
      await loadInventory();
    }
  } catch (err) {
    setStatus(err.message || 'Unable to save warehouse.');
  }
}

async function saveMovement(event) {
  event.preventDefault();
  setStatus('');
  const payload = {
    business_entity_id: getCurrentBusinessEntityId(),
    product_id: document.getElementById('movement-product').value,
    warehouse_id: document.getElementById('movement-warehouse').value,
    movement_type: document.getElementById('movement-type').value,
    quantity: document.getElementById('movement-qty').value,
    project_id: document.getElementById('movement-project')?.value || '',
    movement_date: document.getElementById('movement-date').value,
    reference_type: document.getElementById('movement-ref-type').value,
    reference_no: document.getElementById('movement-ref-no').value,
    notes: document.getElementById('movement-notes').value
  };
  try {
    if (isInventoryStaffRole()) {
      await saveInventoryRequest('movement', payload);
    } else {
      await fetchJson('/api/inventory/movements', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
    event.target.reset();
    document.getElementById('movement-date').value = new Date().toISOString().slice(0, 10);
    closeInventoryModal();
    if (isInventoryStaffRole()) {
      await loadInventoryRequests();
      switchInventoryTab('requests');
    } else {
      await loadInventory();
    }
  } catch (err) {
    setStatus(err.message || 'Unable to save movement.');
  }
}

async function saveInventoryRequest(requestType, payload) {
  const requestEditId = Number(editingInventoryRequestId || 0) || 0;
  await fetchJson(requestEditId ? `/api/inventory/requests/${requestEditId}` : '/api/inventory/requests', {
    method: requestEditId ? 'PUT' : 'POST',
    body: JSON.stringify({ request_type: requestType, payload })
  });
}

async function loadInventoryRequests() {
  if (!isInventoryStaffRole()) return;
  inventoryRequestsDb = await fetchJson('/api/inventory/requests').catch(() => []);
  renderInventoryRequests();
}

function getInventoryRequestDetails(row = {}) {
  const payload = row.payload || {};
  const type = String(row.request_type || '').toLowerCase();
  if (type === 'product') return [payload.sku, payload.product_name].filter(Boolean).join(' - ');
  if (type === 'warehouse') return [payload.warehouse_code, payload.warehouse_name].filter(Boolean).join(' - ');
  if (type === 'movement') {
    const product = productsDb.find(item => Number(item.id) === Number(payload.product_id));
    const warehouse = warehousesDb.find(item => Number(item.id) === Number(payload.warehouse_id));
    return [
      String(payload.movement_type || '').toUpperCase(),
      product?.product_name || `Product #${payload.product_id || '-'}`,
      warehouse?.warehouse_name || `Warehouse #${payload.warehouse_id || '-'}`,
      payload.quantity ? `Qty ${payload.quantity}` : ''
    ].filter(Boolean).join(' - ');
  }
  return row.request_no || '-';
}

function renderInventoryRequests() {
  const tbody = document.getElementById('inventory-requests-tbody');
  if (!tbody) return;
  tbody.innerHTML = inventoryRequestsDb.length ? inventoryRequestsDb.map(row => {
    const status = String(row.status || 'draft').toLowerCase();
    const canSubmit = status === 'draft';
    const actions = canSubmit
      ? `<button class="btn btn-edit btn-sm" type="button" onclick="openInventoryRequestDraft(${Number(row.id)})">Edit</button> <button class="btn btn-save btn-sm" type="button" onclick="submitInventoryRequest(${Number(row.id)})">Submit</button>`
      : '<span class="inventory-muted">No action</span>';
    return `
      <tr>
        <td><strong>${escHtml(row.request_no || '-')}</strong></td>
        <td>${escHtml(row.request_type || '-')}</td>
        <td>${escHtml(getInventoryRequestDetails(row) || '-')}</td>
        <td><span class="inventory-status-pill status-${escHtml(status)}">${escHtml(formatInventoryStatusLabel(status))}</span></td>
        <td>${escHtml(row.reject_reason || (status === 'submitted' ? 'Waiting for admin approval' : status === 'draft' ? 'Ready to submit' : '-'))}</td>
        <td>${actions}</td>
      </tr>
    `;
  }).join('') : '<tr><td colspan="6">No inventory requests yet.</td></tr>';
}

async function submitInventoryRequest(id) {
  const confirmed = await openInventoryConfirmDialog({
    title: 'Submit Inventory Request?',
    message: 'Submit this inventory draft for admin approval?',
    noText: 'Cancel',
    yesText: 'Submit'
  });
  if (!confirmed) return;
  try {
    await fetchJson(`/api/inventory/requests/${Number(id)}/submit`, { method: 'POST' });
    await loadInventoryRequests();
  } catch (err) {
    setStatus(err.message || 'Unable to submit request.');
  }
}
