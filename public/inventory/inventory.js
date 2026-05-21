'use strict';

const BUSINESS_ENTITY_CONTEXT_KEY = 'kinaadman_businessEntityContext';
let businessEntitiesDb = [];
let productsDb = [];
let warehousesDb = [];
let stockDb = [];
let movementsDb = [];

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('movement-date').value = new Date().toISOString().slice(0, 10);
  syncInventoryToolbarActions('stock');
  await loadBusinessEntities();
  await loadInventory();
});

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  const [summary, products, warehouses, stock, movements] = await Promise.all([
    fetchJson(`/api/inventory/summary?${query}`),
    fetchJson(`/api/inventory/products?${query}`),
    fetchJson(`/api/inventory/warehouses?${query}`),
    fetchJson(`/api/inventory/stock?${query}`),
    fetchJson(`/api/inventory/movements?${query}`)
  ]);
  productsDb = Array.isArray(products) ? products : [];
  warehousesDb = Array.isArray(warehouses) ? warehouses : [];
  stockDb = Array.isArray(stock) ? stock : [];
  movementsDb = Array.isArray(movements) ? movements : [];
  renderSummary(summary || {});
  renderInventory();
  populateMovementSelects();
}

function renderSummary(summary) {
  document.getElementById('metric-products').textContent = Number(summary.products || 0);
  document.getElementById('metric-warehouses').textContent = Number(summary.warehouses || 0);
  document.getElementById('metric-on-hand').textContent = Number(summary.on_hand || 0).toLocaleString('en-PH');
  document.getElementById('metric-low-stock').textContent = Number(summary.low_stock || 0);
}

function renderInventory() {
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
    productsBody.innerHTML = productsDb.length ? productsDb.map(row => `
      <tr>
        <td>${escHtml(row.sku || '-')}</td>
        <td>${escHtml(row.product_name || '-')}</td>
        <td>${escHtml(row.category || '-')}</td>
        <td>${escHtml(row.unit || 'pcs')}</td>
        <td class="text-right">${Number(row.unit_cost || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
        <td class="text-right">${Number(row.reorder_level || 0).toLocaleString('en-PH')}</td>
        <td class="text-right">${Number(row.quantity_on_hand || 0).toLocaleString('en-PH')}</td>
      </tr>
    `).join('') : '<tr><td colspan="7">No products yet.</td></tr>';
  }

  const warehousesBody = document.getElementById('warehouses-tbody');
  if (warehousesBody) {
    warehousesBody.innerHTML = warehousesDb.length ? warehousesDb.map(row => `
      <tr>
        <td>${escHtml(row.warehouse_code || '-')}</td>
        <td>${escHtml(row.warehouse_name || '-')}</td>
        <td>${escHtml(row.location || '-')}</td>
        <td>${Number(row.is_active ?? 1) ? 'Active' : 'Inactive'}</td>
      </tr>
    `).join('') : '<tr><td colspan="4">No warehouses yet.</td></tr>';
  }

  const movementBody = document.getElementById('movement-tbody');
  movementBody.innerHTML = movementsDb.length ? movementsDb.map(row => `
    <tr>
      <td>${escHtml(String(row.movement_date || '').slice(0, 10) || '-')}</td>
      <td>${escHtml(String(row.movement_type || '').toUpperCase())}</td>
      <td>${escHtml([row.sku, row.product_name].filter(Boolean).join(' - ') || '-')}</td>
      <td class="text-right">${Number(row.quantity || 0).toLocaleString('en-PH')}</td>
      <td>${escHtml([row.reference_type, row.reference_no].filter(Boolean).join(' - ') || '-')}</td>
    </tr>
  `).join('') : '<tr><td colspan="5">No stock movements yet.</td></tr>';
}

function switchInventoryTab(tab) {
  const safeTab = ['stock', 'products', 'warehouses', 'movements'].includes(tab) ? tab : 'stock';
  document.querySelectorAll('.inventory-tab').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === safeTab);
  });
  document.querySelectorAll('.inventory-section').forEach(section => {
    section.classList.toggle('active', section.id === `inventory-tab-${safeTab}`);
  });
  syncInventoryToolbarActions(safeTab);
}

function syncInventoryToolbarActions(tab = 'stock') {
  const safeTab = ['stock', 'products', 'warehouses', 'movements'].includes(tab) ? tab : 'stock';
  document.querySelectorAll('[data-inventory-action]').forEach(button => {
    const tabs = String(button.dataset.inventoryAction || '')
      .split(/\s+/)
      .map(value => value.trim())
      .filter(Boolean);
    button.hidden = !tabs.includes(safeTab);
  });
}

function populateMovementSelects() {
  const productSelect = document.getElementById('movement-product');
  const warehouseSelect = document.getElementById('movement-warehouse');
  productSelect.innerHTML = '<option value="">Select product</option>' + productsDb.map(row => `<option value="${Number(row.id)}">${escHtml([row.sku, row.product_name].filter(Boolean).join(' - '))}</option>`).join('');
  warehouseSelect.innerHTML = '<option value="">Select warehouse</option>' + warehousesDb.map(row => `<option value="${Number(row.id)}">${escHtml([row.warehouse_code, row.warehouse_name].filter(Boolean).join(' - '))}</option>`).join('');
}

function setStatus(message = '') {
  document.getElementById('inventory-status').textContent = message;
}

function openInventoryModal(type) {
  setStatus('');
  document.getElementById('inventory-modal').classList.add('open');
  document.getElementById('inventory-modal').setAttribute('aria-hidden', 'false');
  document.getElementById('inventory-modal-title').textContent = type === 'product' ? 'New Product' : type === 'warehouse' ? 'New Warehouse' : 'Stock Movement';
  ['product-form', 'warehouse-form', 'movement-form'].forEach(id => document.getElementById(id).classList.remove('active'));
  document.getElementById(`${type}-form`)?.classList.add('active');
}

function closeInventoryModal() {
  document.getElementById('inventory-modal').classList.remove('open');
  document.getElementById('inventory-modal').setAttribute('aria-hidden', 'true');
}

async function saveProduct(event) {
  event.preventDefault();
  setStatus('');
  try {
    await fetchJson('/api/inventory/products', {
      method: 'POST',
      body: JSON.stringify({
        business_entity_id: getCurrentBusinessEntityId(),
        sku: document.getElementById('product-sku').value,
        product_name: document.getElementById('product-name').value,
        category: document.getElementById('product-category').value,
        unit: document.getElementById('product-unit').value,
        unit_cost: document.getElementById('product-cost').value,
        reorder_level: document.getElementById('product-reorder').value
      })
    });
    event.target.reset();
    document.getElementById('product-unit').value = 'pcs';
    closeInventoryModal();
    await loadInventory();
  } catch (err) {
    setStatus(err.message || 'Unable to save product.');
  }
}

async function saveWarehouse(event) {
  event.preventDefault();
  setStatus('');
  try {
    await fetchJson('/api/inventory/warehouses', {
      method: 'POST',
      body: JSON.stringify({
        business_entity_id: getCurrentBusinessEntityId(),
        warehouse_code: document.getElementById('warehouse-code').value,
        warehouse_name: document.getElementById('warehouse-name').value,
        location: document.getElementById('warehouse-location').value
      })
    });
    event.target.reset();
    closeInventoryModal();
    await loadInventory();
  } catch (err) {
    setStatus(err.message || 'Unable to save warehouse.');
  }
}

async function saveMovement(event) {
  event.preventDefault();
  setStatus('');
  try {
    await fetchJson('/api/inventory/movements', {
      method: 'POST',
      body: JSON.stringify({
        business_entity_id: getCurrentBusinessEntityId(),
        product_id: document.getElementById('movement-product').value,
        warehouse_id: document.getElementById('movement-warehouse').value,
        movement_type: document.getElementById('movement-type').value,
        quantity: document.getElementById('movement-qty').value,
        movement_date: document.getElementById('movement-date').value,
        reference_type: document.getElementById('movement-ref-type').value,
        reference_no: document.getElementById('movement-ref-no').value,
        notes: document.getElementById('movement-notes').value
      })
    });
    event.target.reset();
    document.getElementById('movement-date').value = new Date().toISOString().slice(0, 10);
    closeInventoryModal();
    await loadInventory();
  } catch (err) {
    setStatus(err.message || 'Unable to save movement.');
  }
}
