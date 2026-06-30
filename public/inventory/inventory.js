'use strict';

const BUSINESS_ENTITY_CONTEXT_KEY = 'kinaadman_businessEntityContext';
let businessEntitiesDb = [];
let productsDb = [];
let warehousesDb = [];
let stockDb = [];
let movementsDb = [];
let unitsDb = [];
let purchaseOrdersDb = [];
let projectsDb = [];
let inventoryRequestsDb = [];
let editingInventoryRequestId = null;
let editingInventoryRequestType = '';
let editingProductId = null;
let editingWarehouseId = null;
let editingUnitId = null;
let inventoryConfirmResolver = null;

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('movement-date').value = new Date().toISOString().slice(0, 10);
  setupInventoryModalCloseHandlers();
  applyInventoryAdminColumns();
  switchInventoryTab(getInitialInventoryTab(), { syncUrl: false });
  await loadBusinessEntities();
  await loadInventory();
  if (isInventoryStaffRole()) await loadInventoryRequests();
  applyInitialInventorySearch();
  // Near-real-time: auto-refresh the inventory data + current tab (no manual reload).
  if (typeof registerAutoRefresh === 'function') {
    registerAutoRefresh(async () => {
      await loadInventory();
      if (isInventoryStaffRole()) await loadInventoryRequests();
    });
  }
});

// Pre-fill a tab's search box from ?q= so global dashboard search links land filtered.
function applyInitialInventorySearch() {
  const q = String(new URLSearchParams(window.location.search || '').get('q') || new URLSearchParams(window.location.search || '').get('search') || '').trim();
  if (!q) return;
  const tab = getInitialInventoryTab();
  const inputId = tab === 'units' ? 'units-search'
    : tab === 'rma' ? 'rma-search'
    : tab === 'stock' ? 'inventory-search'
    : tab === 'products' ? 'products-search'
    : '';
  const box = inputId ? document.getElementById(inputId) : null;
  if (!box) return; // other tabs (e.g. warehouses) rely on the shared row highlighter instead
  box.value = q;
  if (tab === 'units') renderUnits();
  else if (tab === 'rma') renderRma();
  else renderInventory();
}

function getInitialInventoryTab() {
  const params = new URLSearchParams(window.location.search || '');
  return normalizeInventoryTab(params.get('tab') || 'products');
}

function normalizeInventoryTab(tab) {
  return ['stock', 'products', 'warehouses', 'movements', 'units', 'rma', 'requests'].includes(String(tab || '').trim().toLowerCase())
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
  if (stored === 'all') return 'all';
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
  // Serial units are an admin-only view; staff never load them.
  if (!isInventoryStaffRole()) {
    const [units, purchaseOrders] = await Promise.all([
      fetchJson(`/api/inventory/units?${query}`).catch(() => []),
      fetchJson('/api/procurement/purchase-orders').catch(() => [])
    ]);
    unitsDb = Array.isArray(units) ? units : [];
    purchaseOrdersDb = Array.isArray(purchaseOrders) ? purchaseOrders : [];
  } else {
    unitsDb = [];
    purchaseOrdersDb = [];
  }
  renderSummary(summary || {});
  renderInventory();
  populateMovementSelects();
  populateUnitSelects();
}

let inventorySummaryDb = {};

function renderSummary(summary) {
  inventorySummaryDb = summary || {};
  renderTabSummary();
}

// Each tab shows its OWN summary cards (relevant to that tab), not one shared row
// of every metric. Rebuilds the summary grid based on the active tab.
function renderTabSummary(tab = (document.querySelector('.inventory-tab.active')?.dataset.tab || 'products')) {
  const grid = document.querySelector('.inventory-summary-grid');
  if (!grid) return;
  const num = (n) => Number(n || 0).toLocaleString('en-PH');
  const card = (label, value) => `<article class="module-summary-card"><span class="module-summary-label">${escHtml(label)}</span><div class="module-summary-value">${value}</div></article>`;

  const lowStock = productsDb.filter(p => Number(p.reorder_level || 0) > 0 && Number(p.quantity_on_hand || 0) <= Number(p.reorder_level || 0)).length;
  const categories = new Set(productsDb.map(p => String(p.category || '').trim()).filter(Boolean)).size;
  const onHand = stockDb.reduce((sum, r) => sum + Number(r.quantity_on_hand || 0), 0);
  const unitsBy = (st) => unitsDb.filter(u => String(u.status || '') === st).length;
  const moveBy = (t) => movementsDb.filter(m => String(m.movement_type || '') === t).length;

  let cards;
  switch (tab) {
    case 'warehouses':
      cards = card('Warehouses', num(warehousesDb.length)) + card('Active', num(warehousesDb.filter(w => Number(w.is_active ?? 1)).length));
      break;
    case 'stock':
      cards = card('Qty On Hand', num(onHand)) + card('Stock Records', num(stockDb.length)) + card('Low Stock', num(lowStock));
      break;
    case 'movements':
      cards = card('Movements', num(movementsDb.length)) + card('Stock In', num(moveBy('in'))) + card('Stock Out', num(moveBy('out')));
      break;
    case 'units':
      cards = card('Serial Units', num(unitsDb.length)) + card('In Stock', num(unitsBy('in_stock'))) + card('Sold', num(unitsBy('sold'))) + card('RMA / Defective', num(unitsBy('rma') + unitsBy('defective')));
      break;
    case 'rma': {
      const rmaLogged = unitsDb.filter(u => u.rma_logged_at);
      const openRma = rmaLogged.filter(u => !u.rma_resolved_at).length;
      cards = card('Open RMA', num(openRma)) + card('Resolved', num(rmaLogged.length - openRma)) + card('Total RMA', num(rmaLogged.length));
      break;
    }
    case 'requests':
      cards = card('Requests', num(inventoryRequestsDb.length)) + card('Pending', num(inventoryRequestsDb.filter(r => ['draft', 'submitted'].includes(String(r.status || '').toLowerCase())).length));
      break;
    case 'products':
    default:
      cards = card('Products', num(productsDb.length)) + card('Categories', num(categories)) + card('Low Stock', num(lowStock)) + card('Qty On Hand', num(onHand));
  }
  grid.innerHTML = cards;
  grid.dataset.summaryReady = '1';
}

function applyInventoryAdminColumns() {
  const showAdminCols = !isInventoryStaffRole();
  document.querySelectorAll('[data-inventory-admin-col]').forEach(node => {
    // Tab-scoped action buttons (e.g. "Add Serial Unit") are owned by
    // syncInventoryToolbarActions, which shows them only on their matching tab.
    // Skip them here so a re-render never re-reveals them on the wrong tab.
    if (node.hasAttribute('data-inventory-action')) return;
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
    const isLow = reorder > 0 && qty <= reorder;
    return `
      <tr class="${isLow ? 'inventory-row-low' : ''}">
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
    populateProductFilter();
    const categoryFilter = String(document.getElementById('products-category-filter')?.value || '').trim();
    const productQuery = String(document.getElementById('products-search')?.value || '').trim().toLowerCase();
    const filteredProducts = productsDb.filter(row => {
      const cat = String(row.category || '').trim() || 'Uncategorized';
      if (categoryFilter && cat !== categoryFilter) return false;
      if (!productQuery) return true;
      return [row.sku, row.product_name, row.category].join(' ').toLowerCase().includes(productQuery);
    });
    if (!productsDb.length) {
      productsBody.innerHTML = `<tr><td colspan="${productCols}">No products yet.</td></tr>`;
    } else if (!filteredProducts.length) {
      productsBody.innerHTML = `<tr><td colspan="${productCols}">No products match your filter.</td></tr>`;
    } else {
      const groups = new Map();
      filteredProducts.forEach(row => {
        const key = String(row.category || '').trim() || 'Uncategorized';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      });
      const orderedKeys = [...groups.keys()].sort((a, b) => {
        if (a === 'Uncategorized') return 1;
        if (b === 'Uncategorized') return -1;
        return a.localeCompare(b);
      });
      productsBody.innerHTML = orderedKeys.map(key => {
        const items = groups.get(key);
        const header = `<tr class="inventory-group-row"><td colspan="${productCols}">${escHtml(key)} <span class="inventory-group-count">${items.length}</span></td></tr>`;
        const body = items.map(row => {
          const onHand = Number(row.quantity_on_hand || 0);
          const reorder = Number(row.reorder_level || 0);
          const isLow = reorder > 0 && onHand <= reorder;
          return `
      <tr class="${isLow ? 'inventory-row-low' : ''}">
        <td>${escHtml(row.sku || '-')}</td>
        <td>${escHtml(row.product_name || '-')}</td>
        <td>${escHtml(row.category || '-')}</td>
        <td>${escHtml(row.unit || 'pcs')}</td>
        <td class="text-right">${Number(row.unit_cost || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
        <td class="text-right">${Number(row.selling_price || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
        <td class="text-right">${reorder.toLocaleString('en-PH')}</td>
        <td class="text-right">${isLow ? '<span class="inventory-low-tag">Low</span>' : ''}<span class="inventory-onhand-num">${onHand.toLocaleString('en-PH')}</span></td>
        ${isAdmin ? `<td class="text-right inventory-row-actions">
          <button class="btn btn-edit btn-sm" type="button" onclick="editProduct(${Number(row.id)})">Edit</button>
          <button class="btn btn-cancel btn-sm" type="button" onclick="archiveProduct(${Number(row.id)})">Archive</button>
        </td>` : ''}
      </tr>
    `;
        }).join('');
        return header + body;
      }).join('');
    }
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

  renderUnits();
  renderRma();
}

const UNIT_STATUS_LABELS = {
  in_stock: 'In Stock',
  sold: 'Sold',
  installed: 'Installed',
  returned: 'Returned',
  rma: 'RMA',
  defective: 'Defective'
};

function unitStatusLabel(status) {
  return UNIT_STATUS_LABELS[String(status || '').toLowerCase()] || 'In Stock';
}

// Renders the admin-only Serial Units table, honoring the status filter and the
// free-text search box. Flags warranties that are already past their end date.
function renderUnits() {
  const body = document.getElementById('units-tbody');
  if (!body) return;
  const isAdmin = !isInventoryStaffRole();
  const cols = isAdmin ? 6 : 5;
  const statusFilter = String(document.getElementById('units-status-filter')?.value || '').trim().toLowerCase();
  const q = String(document.getElementById('units-search')?.value || '').trim().toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  const rows = unitsDb.filter(row => {
    if (statusFilter && String(row.status || '').toLowerCase() !== statusFilter) return false;
    if (!q) return true;
    return [row.serial_number, row.sku, row.product_name, row.customer_name, row.project_docno, row.project_name]
      .join(' ').toLowerCase().includes(q);
  });
  if (!unitsDb.length) {
    body.innerHTML = `<tr><td colspan="${cols}">No serial units yet.</td></tr>`;
    return;
  }
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="${cols}">No serial units match your filter.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(row => {
    const warrantyEnd = String(row.warranty_end || '').slice(0, 10);
    const expired = warrantyEnd && warrantyEnd < today;
    const location = row.customer_name
      ? escHtml(row.customer_name)
      : escHtml([row.warehouse_code, row.warehouse_name].filter(Boolean).join(' - ') || '-');
    const sourcePo = row.source_po_number
      ? `<div class="unit-source-po">from ${escHtml(row.source_po_number)}</div>`
      : '';
    return `
      <tr>
        <td>${escHtml(row.serial_number || '-')}</td>
        <td>${escHtml([row.sku, row.product_name].filter(Boolean).join(' - ') || '-')}${sourcePo}</td>
        <td><span class="unit-status-tag unit-status-${escHtml(String(row.status || 'in_stock'))}">${escHtml(unitStatusLabel(row.status))}</span></td>
        <td>${location}</td>
        <td>${warrantyEnd ? `${escHtml(warrantyEnd)}${expired ? ' <span class="inventory-low-tag">Expired</span>' : ''}` : '-'}</td>
        ${isAdmin ? `<td class="text-right inventory-row-actions">
          ${['sold', 'installed'].includes(String(row.status || '').toLowerCase())
            ? `<button class="btn btn-cancel btn-sm" type="button" onclick="openRmaModal(${Number(row.id)})">Log RMA</button>`
            : ''}
          <button class="btn btn-edit btn-sm" type="button" onclick="editUnit(${Number(row.id)})">Edit</button>
          <button class="btn btn-cancel btn-sm" type="button" onclick="deleteUnit(${Number(row.id)})">Delete</button>
        </td>` : ''}
      </tr>
    `;
  }).join('');
}

const RMA_RESOLUTION_LABELS = {
  restock: 'Restocked',
  repair_return: 'Repaired & Returned',
  replace: 'Replaced',
  scrap: 'Scrapped'
};

// Renders the admin-only RMA / Returns table. An RMA "record" is any serial unit
// that has rma_logged_at stamped; open = not yet resolved. Resolved rows show the
// resolution outcome; open rows expose a Resolve action.
function renderRma() {
  const body = document.getElementById('rma-tbody');
  if (!body) return;
  const stateFilter = String(document.getElementById('rma-state-filter')?.value || 'open').trim().toLowerCase();
  const q = String(document.getElementById('rma-search')?.value || '').trim().toLowerCase();
  const logged = unitsDb.filter(u => u.rma_logged_at);
  const rows = logged.filter(row => {
    const resolved = !!row.rma_resolved_at;
    if (stateFilter === 'open' && resolved) return false;
    if (stateFilter === 'resolved' && !resolved) return false;
    if (!q) return true;
    return [row.serial_number, row.sku, row.product_name, row.customer_name, row.rma_reason, row.project_docno]
      .join(' ').toLowerCase().includes(q);
  });
  if (!logged.length) {
    body.innerHTML = '<tr><td colspan="7">Wala pang RMA / returns na naka-log.</td></tr>';
    return;
  }
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7">Walang RMA na tumugma sa filter.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(row => {
    const resolved = !!row.rma_resolved_at;
    const loggedDate = String(row.rma_logged_at || '').slice(0, 10);
    const statusCell = resolved
      ? `<span class="unit-status-tag unit-status-${escHtml(String(row.status || ''))}">${escHtml(RMA_RESOLUTION_LABELS[String(row.rma_resolution || '').toLowerCase()] || unitStatusLabel(row.status))}</span>`
      : '<span class="unit-status-tag unit-status-rma">Open RMA</span>';
    const actions = resolved
      ? `<span class="inventory-muted">Resolved ${escHtml(String(row.rma_resolved_at || '').slice(0, 10))}</span>`
      : `<button class="btn btn-save btn-sm" type="button" onclick="openRmaResolveModal(${Number(row.id)})">Resolve</button>`;
    return `
      <tr>
        <td>${escHtml(row.serial_number || '-')}</td>
        <td>${escHtml([row.sku, row.product_name].filter(Boolean).join(' - ') || '-')}</td>
        <td>${escHtml(row.customer_name || '-')}</td>
        <td>${escHtml(row.rma_reason || '-')}</td>
        <td>${escHtml(loggedDate || '-')}</td>
        <td>${statusCell}</td>
        <td class="text-right inventory-row-actions">${actions}</td>
      </tr>
    `;
  }).join('');
}

let rmaTargetUnitId = null;

function unitLabel(row) {
  return [row?.serial_number, [row?.sku, row?.product_name].filter(Boolean).join(' - ')].filter(Boolean).join('  •  ') || `Unit #${row?.id || ''}`;
}

// Opens the "Log RMA" form for a sold/installed serial unit.
function openRmaModal(id) {
  if (isInventoryStaffRole()) return;
  const row = unitsDb.find(item => Number(item.id) === Number(id));
  if (!row) { setStatus('Serial unit not found.'); return; }
  openInventoryModal('rma');
  rmaTargetUnitId = Number(row.id);
  document.getElementById('inventory-modal-title').textContent = 'Log RMA / Return';
  const label = document.getElementById('rma-unit-label');
  if (label) label.value = unitLabel(row);
  const reason = document.getElementById('rma-reason');
  if (reason) reason.value = '';
  const returnType = document.getElementById('rma-return-type');
  if (returnType) returnType.value = 'Defective on arrival';
  const returnDate = document.getElementById('rma-return-date');
  if (returnDate) returnDate.value = new Date().toISOString().slice(0, 10);
}

async function submitRma(event) {
  event.preventDefault();
  setStatus('');
  const id = Number(rmaTargetUnitId || 0) || 0;
  if (!id) { setStatus('No serial unit selected.'); return; }
  // Build a structured RMA reason (return type + details + return date) stored in rma_reason.
  const returnType = String(document.getElementById('rma-return-type')?.value || '').trim();
  const returnDate = String(document.getElementById('rma-return-date')?.value || '').trim();
  const details = String(document.getElementById('rma-reason')?.value || '').trim();
  if (!details) { setStatus('RMA details / reason is required.'); return; }
  const reason = [returnType, details].filter(Boolean).join(' — ') + (returnDate ? ` (binalik: ${returnDate})` : '');
  try {
    await fetchJson(`/api/inventory/units/${id}/rma`, { method: 'POST', body: JSON.stringify({ reason }) });
    closeInventoryModal();
    await loadInventory();
    switchInventoryTab('rma');
  } catch (err) {
    setStatus(err.message || 'Unable to log RMA.');
  }
}

// Opens the "Resolve RMA" form for a unit with an open RMA.
function openRmaResolveModal(id) {
  if (isInventoryStaffRole()) return;
  const row = unitsDb.find(item => Number(item.id) === Number(id));
  if (!row) { setStatus('Serial unit not found.'); return; }
  openInventoryModal('rma-resolve');
  rmaTargetUnitId = Number(row.id);
  document.getElementById('inventory-modal-title').textContent = 'Resolve RMA';
  const label = document.getElementById('rma-resolve-label');
  if (label) label.value = unitLabel(row);
  const note = document.getElementById('rma-resolve-note');
  if (note) note.value = '';
  const resolution = document.getElementById('rma-resolution');
  if (resolution) resolution.value = 'restock';
  populateRmaReplacementOptions(row);
  onRmaResolutionChange();
}

// Fill the replacement picker with in-stock serials of the SAME product (used by a Replace).
function populateRmaReplacementOptions(row) {
  const select = document.getElementById('rma-replacement-unit');
  if (!select) return;
  const pid = Number(row?.product_id || 0) || 0;
  const opts = (Array.isArray(unitsDb) ? unitsDb : [])
    .filter(u => Number(u.product_id || 0) === pid && String(u.status || '') === 'in_stock' && Number(u.id) !== Number(row?.id || 0))
    .map(u => {
      const meta = [u.warehouse_code || u.warehouse_name || '', u.warranty_end ? `warranty ${String(u.warranty_end).slice(0, 10)}` : ''].filter(Boolean).join(' · ');
      return `<option value="${escAttr(u.id)}">${escHtml(u.serial_number || ('Unit #' + u.id))}${meta ? ` (${escHtml(meta)})` : ''}</option>`;
    }).join('');
  select.innerHTML = `<option value="">— Pumili ng bagong in-stock serial —</option>${opts}`;
}

// Show the replacement serial picker only for the "Replace" resolution.
function onRmaResolutionChange() {
  const resolution = String(document.getElementById('rma-resolution')?.value || '');
  const field = document.getElementById('rma-replacement-field');
  if (field) field.style.display = resolution === 'replace' ? '' : 'none';
}

async function submitRmaResolve(event) {
  event.preventDefault();
  setStatus('');
  const id = Number(rmaTargetUnitId || 0) || 0;
  if (!id) { setStatus('No serial unit selected.'); return; }
  const resolution = String(document.getElementById('rma-resolution')?.value || '').trim();
  const note = String(document.getElementById('rma-resolve-note')?.value || '').trim();
  const body = { resolution, note };
  if (resolution === 'replace') {
    const replacementId = Number(document.getElementById('rma-replacement-unit')?.value || 0) || 0;
    if (!replacementId) { setStatus('Pumili ng replacement (bagong in-stock serial) para sa Replace.'); return; }
    body.replacement_unit_id = replacementId;
  }
  try {
    await fetchJson(`/api/inventory/units/${id}/rma/resolve`, { method: 'POST', body: JSON.stringify(body) });
    closeInventoryModal();
    await loadInventory();
    switchInventoryTab('rma');
  } catch (err) {
    setStatus(err.message || 'Unable to resolve RMA.');
  }
}

// Fills the product/warehouse/project selects inside the serial-unit modal form.
function populateUnitSelects() {
  const productSelect = document.getElementById('unit-product');
  const warehouseSelect = document.getElementById('unit-warehouse');
  const projectSelect = document.getElementById('unit-project');
  if (productSelect) {
    productSelect.innerHTML = '<option value="">Select product</option>' + productsDb.map(row => `<option value="${Number(row.id)}">${escHtml([row.sku, row.product_name].filter(Boolean).join(' - '))}</option>`).join('');
  }
  if (warehouseSelect) {
    warehouseSelect.innerHTML = '<option value="">No warehouse</option>' + warehousesDb.map(row => `<option value="${Number(row.id)}">${escHtml([row.warehouse_code, row.warehouse_name].filter(Boolean).join(' - '))}</option>`).join('');
  }
  if (projectSelect) {
    projectSelect.innerHTML = '<option value="">No project link</option>' + projectsDb.map(row => `<option value="${Number(row.id)}">${escHtml([row.project_docno, row.project_name].filter(Boolean).join(' - '))}</option>`).join('');
  }
  populateUnitSourcePoSelect(Number(projectSelect?.value || 0) || 0, Number(document.getElementById('unit-source-po')?.value || 0) || 0);
}

// Source PO dropdown for a serial unit: lists purchase orders (optionally scoped
// to the unit's linked project) so each item traces back to where it was bought.
function populateUnitSourcePoSelect(projectId = 0, selectedId = 0) {
  const select = document.getElementById('unit-source-po');
  if (!select) return;
  const pid = Number(projectId || 0) || 0;
  const current = Number(selectedId || select.value || 0) || 0;
  const matches = purchaseOrdersDb.filter(po => {
    if (Number(po.id || 0) === current) return true; // keep the saved PO visible
    return pid ? Number(po.project_id || 0) === pid : true;
  });
  select.innerHTML = '<option value="">No source PO</option>' + matches.map(po => {
    const id = Number(po.id || 0);
    const label = [po.po_number, po.vendor_name].filter(Boolean).join(' - ') || `PO #${id}`;
    return `<option value="${id}"${id === current ? ' selected' : ''}>${escHtml(label)}</option>`;
  }).join('');
}

// When the unit's project changes, re-scope the Source PO list to that project.
function onUnitProjectChange() {
  const projectId = Number(document.getElementById('unit-project')?.value || 0) || 0;
  populateUnitSourcePoSelect(projectId, Number(document.getElementById('unit-source-po')?.value || 0) || 0);
}

function switchInventoryTab(tab, options = {}) {
  let safeTab = normalizeInventoryTab(tab);
  // Serial Units and RMA are admin-only views; never let staff land on them.
  if ((safeTab === 'units' || safeTab === 'rma') && isInventoryStaffRole()) safeTab = 'products';
  document.querySelectorAll('.inventory-tab').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === safeTab);
  });
  document.querySelectorAll('.inventory-section').forEach(section => {
    section.classList.toggle('active', section.id === `inventory-tab-${safeTab}`);
  });
  renderTabSummary(safeTab);
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
  const warehouseSelect = document.getElementById('movement-warehouse');
  const projectSelect = document.getElementById('movement-project');
  populateMovementCategorySelect();
  populateMovementProducts(document.getElementById('movement-category')?.value || '');
  if (warehouseSelect) {
    warehouseSelect.innerHTML = '<option value="">Select warehouse</option>' + warehousesDb.map(row => `<option value="${Number(row.id)}">${escHtml([row.warehouse_code, row.warehouse_name].filter(Boolean).join(' - '))}</option>`).join('');
  }
  if (projectSelect) {
    projectSelect.innerHTML = '<option value="">No project link</option>' + projectsDb.map(row => `<option value="${Number(row.id)}">${escHtml([row.project_docno, row.project_name].filter(Boolean).join(' - '))}</option>`).join('');
  }
}

// Category filter inside the Stock Movement form. Picking a category narrows the
// Product dropdown to that category (with an "Uncategorized" bucket when relevant).
function populateMovementCategorySelect() {
  const select = document.getElementById('movement-category');
  if (!select) return;
  const current = String(select.value || '').trim();
  const categories = getProductCategories();
  const hasUncategorized = productsDb.some(row => !String(row.category || '').trim());
  const values = categories.concat(hasUncategorized ? ['Uncategorized'] : []);
  select.innerHTML = ['<option value="">All categories</option>']
    .concat(values.map(name => `<option value="${escHtml(name)}"${name === current ? ' selected' : ''}>${escHtml(name)}</option>`))
    .join('');
  if (current && values.includes(current)) select.value = current;
}

function movementProductMatchesCategory(row, category) {
  const cat = String(category || '').trim();
  if (!cat) return true;
  const rowCat = String(row.category || '').trim();
  if (cat === 'Uncategorized') return !rowCat;
  return rowCat === cat;
}

function populateMovementProducts(category = '') {
  const productSelect = document.getElementById('movement-product');
  if (!productSelect) return;
  const previous = String(productSelect.value || '');
  const list = productsDb.filter(row => movementProductMatchesCategory(row, category));
  productSelect.innerHTML = '<option value="">Select product</option>' +
    list.map(row => `<option value="${Number(row.id)}">${escHtml([row.sku, row.product_name].filter(Boolean).join(' - '))}</option>`).join('');
  // Keep the current product selected if it still matches the chosen category.
  if (previous && list.some(row => String(row.id) === previous)) productSelect.value = previous;
}

function onMovementCategoryChange() {
  populateMovementProducts(document.getElementById('movement-category')?.value || '');
}

function getProductCategories() {
  const set = new Set();
  productsDb.forEach(row => {
    const value = String(row.category || '').trim();
    if (value) set.add(value);
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

// Builds the category filter dropdown above the products table, keeping the
// current selection and including an "Uncategorized" bucket when relevant.
function populateProductFilter() {
  const select = document.getElementById('products-category-filter');
  if (!select) return;
  const current = String(select.value || '').trim();
  const categories = getProductCategories();
  const hasUncategorized = productsDb.some(row => !String(row.category || '').trim());
  const values = categories.concat(hasUncategorized ? ['Uncategorized'] : []);
  select.innerHTML = ['<option value="">All categories</option>']
    .concat(values.map(name => `<option value="${escHtml(name)}"${name === current ? ' selected' : ''}>${escHtml(name)}</option>`))
    .join('');
  // Restore selection if it still exists; otherwise fall back to "All".
  if (current && values.includes(current)) select.value = current;
}

function populateProductCategorySelect(selected = '') {
  const select = document.getElementById('product-category');
  if (!select) return;
  const categories = getProductCategories();
  const current = String(selected || '').trim();
  if (current && !categories.includes(current)) categories.unshift(current);
  const options = [`<option value="" disabled${current ? '' : ' selected'}>Select category</option>`]
    .concat(categories.map(name => `<option value="${escHtml(name)}"${name === current ? ' selected' : ''}>${escHtml(name)}</option>`))
    .concat('<option value="__new__">+ New category…</option>');
  select.innerHTML = options.join('');
  onProductCategoryChange();
}

function onProductCategoryChange() {
  const select = document.getElementById('product-category');
  const wrap = document.getElementById('product-category-new-wrap');
  const newInput = document.getElementById('product-category-new');
  const isNew = !!select && select.value === '__new__';
  if (wrap) wrap.hidden = !isNew;
  if (newInput) {
    newInput.required = isNew;
    if (!isNew) newInput.value = '';
    else setTimeout(() => newInput.focus(), 0);
  }
  refreshAutoSku();
  updateCategoryHint();
}

function onNewCategoryInput() {
  refreshAutoSku();
  updateCategoryHint();
}

// Resets the picker back to the existing-category dropdown.
function cancelNewCategory() {
  const select = document.getElementById('product-category');
  if (select) select.value = '';
  onProductCategoryChange();
  setTimeout(() => select?.focus(), 0);
}

// Live helper under the new-category box: warns about case-insensitive matches,
// otherwise previews the SKU prefix that will be used.
function updateCategoryHint() {
  const hint = document.getElementById('product-category-hint');
  const select = document.getElementById('product-category');
  if (!hint) return;
  const isNew = !!select && select.value === '__new__';
  const raw = String(document.getElementById('product-category-new')?.value || '').replace(/\s+/g, ' ').trim();
  if (!isNew || !raw) {
    hint.hidden = true;
    hint.textContent = '';
    return;
  }
  const existing = getProductCategories().find(name => name.toLowerCase() === raw.toLowerCase());
  hint.textContent = existing
    ? `Existing na ito as "${existing}" — yun ang gagamitin.`
    : `SKU prefix: ${categorySkuPrefix(raw)}`;
  hint.hidden = false;
}

function getSelectedProductCategory() {
  const select = document.getElementById('product-category');
  if (!select) return '';
  if (select.value !== '__new__') return String(select.value || '').trim();
  const raw = String(document.getElementById('product-category-new')?.value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  // Reuse the existing spelling when it already exists (case-insensitive), so we
  // don't split "cables" and "Cables" into two groups.
  const existing = getProductCategories().find(name => name.toLowerCase() === raw.toLowerCase());
  if (existing) return existing;
  // Capitalize a fully lowercase entry, but leave acronyms (CCTV, NVR) untouched.
  return raw === raw.toLowerCase() ? raw.charAt(0).toUpperCase() + raw.slice(1) : raw;
}

function categorySkuPrefix(category) {
  const letters = String(category || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return letters.slice(0, 3) || 'GEN';
}

function nextSkuForCategory(category) {
  const prefix = categorySkuPrefix(category);
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  productsDb.forEach(row => {
    const match = String(row.sku || '').trim().toUpperCase().match(re);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  });
  return `${prefix}-${String(max + 1).padStart(5, '0')}`;
}

function nextWarehouseCode() {
  const prefix = 'WARE';
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  warehousesDb.forEach(row => {
    const match = String(row.warehouse_code || '').trim().toUpperCase().match(re);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  });
  return `${prefix}-${String(max + 1).padStart(5, '0')}`;
}

// Previews the auto warehouse code (fixed WARE- prefix + 5-digit sequence). The
// server assigns the final number on save, so editing keeps the stored code.
function refreshAutoWarehouseCode() {
  if (editingWarehouseId || editingInventoryRequestId) return;
  const codeInput = document.getElementById('warehouse-code');
  if (codeInput) codeInput.value = nextWarehouseCode();
}

// Shows a preview SKU for new products. The server is authoritative and assigns
// the final sequence number on save, so editing/draft flows keep their stored SKU.
function refreshAutoSku() {
  if (editingProductId || editingInventoryRequestId) return;
  const skuInput = document.getElementById('product-sku');
  if (!skuInput) return;
  const category = getSelectedProductCategory();
  skuInput.value = category ? nextSkuForCategory(category) : '';
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
  editingUnitId = null;
  rmaTargetUnitId = null;
  const staffRole = isInventoryStaffRole();
  const titles = staffRole
    ? { product: 'Request Product', warehouse: 'Request Warehouse', movement: 'Request Stock Movement', unit: 'Add Serial Unit' }
    : { product: 'New Product', warehouse: 'New Warehouse', movement: 'Stock Movement', unit: 'Add Serial Unit' };
  document.getElementById('inventory-modal-title').textContent = titles[type] || 'Inventory';
  ['product-form', 'warehouse-form', 'movement-form', 'unit-form', 'rma-form', 'rma-resolve-form'].forEach(id => document.getElementById(id)?.classList.remove('active'));
  document.getElementById(`${type}-form`)?.classList.add('active');
  const productSave = document.querySelector('#product-form .btn-save');
  const warehouseSave = document.querySelector('#warehouse-form .btn-save');
  const movementSave = document.querySelector('#movement-form .btn-save');
  const unitSave = document.querySelector('#unit-form .btn-save');
  if (productSave) productSave.textContent = staffRole ? 'Save Product Request' : 'Save Product';
  if (warehouseSave) warehouseSave.textContent = staffRole ? 'Save Warehouse Request' : 'Save Warehouse';
  if (movementSave) movementSave.textContent = staffRole ? 'Save Movement Request' : 'Save Movement';
  if (unitSave) unitSave.textContent = 'Save Unit';
  if (type === 'product') populateProductCategorySelect('');
  if (type === 'warehouse') refreshAutoWarehouseCode();
  if (type === 'unit') populateUnitSelects();
  if (type === 'movement') {
    const movementCategory = document.getElementById('movement-category');
    if (movementCategory) movementCategory.value = '';
    populateMovementProducts('');
  }
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
    populateProductCategorySelect(payload.category || '');
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
  populateProductCategorySelect(row.category || '');
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
  editingUnitId = null;
  rmaTargetUnitId = null;
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

// Per-field error message for inventory modals (under the field). Required/invalid only —
// optional fields never get an error.
function setInventoryFieldMessage(fieldName, message = '') {
  const text = String(message || '').trim();
  if (text && typeof window.notifyFieldError === 'function') window.notifyFieldError(text);
  document.querySelectorAll(`[data-inv-field-message="${fieldName}"]`).forEach((notice) => {
    notice.textContent = text;
    notice.style.display = text ? 'block' : 'none';
    const field = notice.closest('.field');
    if (field) field.classList.toggle('has-error', !!text);
  });
}

async function saveProduct(event) {
  event.preventDefault();
  setStatus('');
  setInventoryFieldMessage('category', '');
  const category = getSelectedProductCategory();
  if (!category) {
    setInventoryFieldMessage('category', 'Please choose or add a category.');
    const el = document.getElementById('product-category');
    if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    return;
  }
  const payload = {
    business_entity_id: getCurrentBusinessEntityId(),
    // Leave SKU blank for new products/requests so the server assigns the next
    // sequence for the category; keep the existing SKU only when editing.
    sku: editingProductId ? document.getElementById('product-sku').value : '',
    product_name: document.getElementById('product-name').value,
    category,
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

async function saveUnit(event) {
  event.preventDefault();
  setStatus('');
  setInventoryFieldMessage('warranty_end', '');
  const start = document.getElementById('unit-warranty-start').value;
  const end = document.getElementById('unit-warranty-end').value;
  if (start && end && end < start) {
    setInventoryFieldMessage('warranty_end', 'Warranty end date cannot be before the start date.');
    const el = document.getElementById('unit-warranty-end');
    if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    return;
  }
  const payload = {
    business_entity_id: getCurrentBusinessEntityId(),
    product_id: document.getElementById('unit-product').value,
    serial_number: document.getElementById('unit-serial').value,
    status: document.getElementById('unit-status').value,
    warehouse_id: document.getElementById('unit-warehouse').value,
    customer_name: document.getElementById('unit-customer').value,
    project_id: document.getElementById('unit-project').value,
    source_po_id: document.getElementById('unit-source-po').value,
    warranty_start: start,
    warranty_end: end,
    notes: document.getElementById('unit-notes').value
  };
  try {
    if (editingUnitId) {
      await fetchJson(`/api/inventory/units/${Number(editingUnitId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
    } else {
      await fetchJson('/api/inventory/units', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
    event.target.reset();
    closeInventoryModal();
    await loadInventory();
    switchInventoryTab('units');
  } catch (err) {
    setStatus(err.message || 'Unable to save serial unit.');
  }
}

function editUnit(id) {
  if (isInventoryStaffRole()) return;
  const row = unitsDb.find(item => Number(item.id) === Number(id));
  if (!row) {
    setStatus('Serial unit not found.');
    return;
  }
  openInventoryModal('unit');
  editingUnitId = Number(row.id);
  document.getElementById('inventory-modal-title').textContent = 'Edit Serial Unit';
  document.getElementById('unit-product').value = row.product_id || '';
  document.getElementById('unit-serial').value = row.serial_number || '';
  document.getElementById('unit-status').value = String(row.status || 'in_stock');
  document.getElementById('unit-warehouse').value = row.warehouse_id || '';
  document.getElementById('unit-customer').value = row.customer_name || '';
  document.getElementById('unit-project').value = row.project_id || '';
  populateUnitSourcePoSelect(Number(row.project_id || 0) || 0, Number(row.source_po_id || 0) || 0);
  document.getElementById('unit-warranty-start').value = String(row.warranty_start || '').slice(0, 10);
  document.getElementById('unit-warranty-end').value = String(row.warranty_end || '').slice(0, 10);
  document.getElementById('unit-notes').value = row.notes || '';
  const saveBtn = document.querySelector('#unit-form .btn-save');
  if (saveBtn) saveBtn.textContent = 'Update Unit';
}

async function deleteUnit(id) {
  if (isInventoryStaffRole()) return;
  const row = unitsDb.find(item => Number(item.id) === Number(id));
  if (!row) return;
  const confirmed = await openInventoryConfirmDialog({
    title: 'Delete Serial Unit',
    message: `Delete serial "${row.serial_number || ''}"? This cannot be undone.`,
    yesText: 'Delete'
  });
  if (!confirmed) return;
  try {
    await fetchJson(`/api/inventory/units/${Number(id)}`, { method: 'DELETE' });
    await loadInventory();
    switchInventoryTab('units');
  } catch (err) {
    setStatus(err.message || 'Unable to delete serial unit.');
  }
}

async function saveWarehouse(event) {
  event.preventDefault();
  setStatus('');
  const payload = {
    business_entity_id: getCurrentBusinessEntityId(),
    // Leave the code blank for new warehouses so the server assigns the next
    // per-name sequence; keep the existing code only when editing.
    warehouse_code: editingWarehouseId ? document.getElementById('warehouse-code').value : '',
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
