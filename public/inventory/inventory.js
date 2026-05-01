let productsDb = [];
let warehousesDb = [];
let stockDb = [];
let movementsDb = [];
const inventoryToolbarState = {
  products: { search: '' },
  warehouses: { search: '' },
  stock: { search: '', filter: '' },
  movements: { search: '', filter: '' }
};
let activeInventoryTab = 'products';

// Load all data on startup
document.addEventListener('DOMContentLoaded', () => {
  renderInventoryToolbarControls(activeInventoryTab);
  restoreInventoryTab();
  loadProducts();
  loadWarehouses(); // This will also update product selectors for movements
  loadStock();
  loadMovements();
});

function doLogout() {
  fetch('/logout', { method: 'POST' }).then(() => { window.location.href = '/'; });
}

function goBackToDashboard() {
  window.location.href = '/admin?view=dashboard';
}

function getMovementSourceLabel(value) {
  const normalized = String(value || 'manual').trim().toLowerCase();
  const labels = {
    manual: 'Manual',
    purchase_requisition: 'Purchase Requisition',
    purchase_order: 'Purchase Order',
    goods_receipt: 'Goods Receipt',
    transaction: 'Transaction'
  };
  return labels[normalized] || 'Manual';
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TAB NAVIGATION
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function switchInventoryTab(tab, btn) {
  captureInventoryToolbarState(activeInventoryTab);
  document.querySelectorAll('.module-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById(tab).classList.add('active');
  activeInventoryTab = tab;
  renderInventoryToolbarControls(tab);
  if (tab === 'products') filterProducts();
  if (tab === 'warehouses') filterWarehouses();
  if (tab === 'stock') filterStock();
  if (tab === 'movements') filterMovements();
  localStorage.setItem('kinaadman_inventoryTab', tab);
}

function captureInventoryToolbarState(tab) {
  if (!inventoryToolbarState[tab]) return;
  inventoryToolbarState[tab].search = document.getElementById('inventory-search-input')?.value || '';
  if (tab === 'stock' || tab === 'movements') {
    inventoryToolbarState[tab].filter = document.getElementById('inventory-filter-select')?.value || '';
  }
}

function renderInventoryToolbarControls(tab) {
  const actions = document.getElementById('inventory-toolbar-actions');
  if (!actions) return;

  const state = inventoryToolbarState[tab] || {};

  if (tab === 'products') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="inventory-search-input" type="text" placeholder="Search products or SKU..." value="${escHtml(state.search || '')}" oninput="filterProducts()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openProductModal()">Add Product</button>
    `;
    return;
  }

  if (tab === 'warehouses') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="inventory-search-input" type="text" placeholder="Search warehouses or location..." value="${escHtml(state.search || '')}" oninput="filterWarehouses()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openWarehouseModal()">Add Warehouse</button>
    `;
    return;
  }

  if (tab === 'stock') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="inventory-search-input" type="text" placeholder="Search by product, SKU, or warehouse..." value="${escHtml(state.search || '')}" oninput="filterStock()" />
      </div>
      <select id="inventory-filter-select" class="filter-select" onchange="filterStock()">
        <option value="">All Items</option>
        <option value="low" ${state.filter === 'low' ? 'selected' : ''}>Low Stock</option>
        <option value="out" ${state.filter === 'out' ? 'selected' : ''}>Out of Stock</option>
      </select>
    `;
    return;
  }

  if (tab === 'movements') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="inventory-search-input" type="text" placeholder="Search movement, product, or notes..." value="${escHtml(state.search || '')}" oninput="filterMovements()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openMovementModal()">Add Movement</button>
      <select id="inventory-filter-select" class="filter-select" onchange="filterMovements()">
        <option value="">All Movements</option>
        <option value="inbound" ${state.filter === 'inbound' ? 'selected' : ''}>Inbound</option>
        <option value="outbound" ${state.filter === 'outbound' ? 'selected' : ''}>Outbound</option>
        <option value="adjustment" ${state.filter === 'adjustment' ? 'selected' : ''}>Adjustment</option>
      </select>
    `;
    return;
  }

  actions.innerHTML = '';
}

function restoreInventoryTab() {
  const savedTab = localStorage.getItem('kinaadman_inventoryTab');
  if (!savedTab || !document.getElementById(savedTab)) return;

  const matchingTab = Array.from(document.querySelectorAll('.module-tab')).find(tabEl =>
    String(tabEl.getAttribute('onclick') || '').includes(`switchInventoryTab('${savedTab}'`)
  );

  if (matchingTab) {
    switchInventoryTab(savedTab, matchingTab);
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PRODUCTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function loadProducts() {
  Promise.all([
    fetch('/api/products').then(r => r.json()),
    fetch('/api/stock').then(r => r.json()) // Assuming a new /api/stock endpoint for all stock
  ])
  .then(([productsData, stockData]) => {
    productsDb = productsData;
    // Map total stock to products
    productsDb = productsDb.map(p => {
      p.total_stock = stockData.filter(s => s.product_id === p.id).reduce((sum, s) => sum + s.quantity, 0);
      return p;
    });
    updateProductSelects(); // Update product selectors for movements
    filterProducts();
  })
  .catch(e => console.error('Error loading products or stock:', e));
}

function renderProducts(productsToRender = productsDb) {
  const tbody = document.getElementById('products-tbody');
  if (!productsToRender.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No products found</td></tr>';
    return;
  }
  tbody.innerHTML = productsToRender.map(p => `
    <tr>
      <td><span class="inventory-sku">${escHtml(p.sku)}</span></td>
      <td><strong class="inventory-item-name">${escHtml(p.name)}</strong></td>
      <td><span class="inventory-pill inventory-pill-neutral">${escHtml(p.category || '-')}</span></td>
      <td class="amount-cell inventory-money">PHP ${parseFloat(p.unit_price).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
      <td class="text-center"><span class="inventory-count">${p.total_stock ?? 0} units</span></td>
      <td class="text-center"><span class="inventory-reorder">${p.reorder_level} units</span></td>
      <td><button class="btn btn-edit btn-sm" onclick="editProduct(${p.id})">Edit</button></td>
    </tr>
  `).join('');
}

function filterProducts() {
  const q = document.getElementById('inventory-search-input')?.value.toLowerCase().trim() || '';
  const filtered = productsDb.filter(p => 
    (p.sku + ' ' + p.name + ' ' + (p.category || '-')).toLowerCase().includes(q)
  );
  const tbody = document.getElementById('products-tbody');
  tbody.innerHTML = filtered.length ? 
    filtered.map(p => ` 
      <tr>
        <td><span class="inventory-sku">${highlightText(p.sku, q)}</span></td>
        <td><strong class="inventory-item-name">${highlightText(p.name, q)}</strong></td>
        <td><span class="inventory-pill inventory-pill-neutral">${highlightText(p.category || '-', q)}</span></td>
        <td class="text-right inventory-money">PHP ${parseFloat(p.unit_price).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
        <td class="text-center"><span class="inventory-count">${p.total_stock ?? 0} units</span></td>
        <td><span class="inventory-reorder">${p.reorder_level} units</span></td>
        <td><button class="btn btn-edit btn-sm" onclick="editProduct(${p.id})">Edit</button></td>
      </tr>
    `).join('') : 
    '<tr class="empty-row"><td colspan="7">No products match search</td></tr>';
}

function openProductModal() {
  document.getElementById('product-modal-title').textContent = 'New Product';
  ['sku', 'product-name', 'product-category', 'unit-price', 'reorder-level', 'product-description'].forEach(id => {
    document.getElementById('f-' + id).value = id === 'reorder-level' ? '10' : '';
  });
  document.getElementById('product-modal-backdrop').classList.add('open');
}

function closeProductModal() {
  document.getElementById('product-modal-backdrop').classList.remove('open');
}

function saveProduct() {
  const sku = document.getElementById('f-sku').value.trim();
  const name = document.getElementById('f-product-name').value.trim();
  const unitPrice = parseFloat(document.getElementById('f-unit-price').value);
  if (!sku || !name || !unitPrice) {
    alert('SKU, Name, and Unit Price are required');
    return;
  }
  const payload = {
    sku,
    name,
    category: document.getElementById('f-product-category').value.trim(),
    description: document.getElementById('f-product-description').value.trim(),
    unit_price: unitPrice,
    reorder_level: parseInt(document.getElementById('f-reorder-level').value) || 10
  };
  fetch('/api/products', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  })
  .then(r => r.json())
  .then(() => {
    closeProductModal();
    loadProducts();
    alert('Product saved successfully');
  })
  .catch(e => alert('Error: ' + e.message));
}

function updateProductSelects() {
  const select = document.getElementById('f-movement-product');
  select.innerHTML = '<option value="">Select product</option>' + 
    productsDb.map(p => `<option value="${p.id}">${escHtml(p.sku)} - ${escHtml(p.name)}</option>`).join('');
}

function editProduct(id) {
  alert('Edit coming soon');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// WAREHOUSES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function loadWarehouses() {
  fetch('/api/warehouses')
    .then(r => r.json())
  .then(data => {
      warehousesDb = data;
      updateWarehouseSelects();
      updateStockMetrics();
      filterWarehouses();
    })
    .catch(e => console.error('Error loading warehouses:', e));
}

function renderWarehouses() {
  const tbody = document.getElementById('warehouses-tbody');
  if (!warehousesDb.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No warehouses found</td></tr>';
    return;
  }
  tbody.innerHTML = warehousesDb.map(w => `
    <tr>
      <td><strong class="inventory-item-name">${escHtml(w.name)}</strong></td>
      <td>${escHtml(w.location || '-')}</td>
      <td><span class="inventory-date">${new Date(w.created_at).toLocaleDateString()}</span></td>
      <td><button class="btn btn-edit btn-sm" onclick="editWarehouse(${w.id})">Edit</button></td>
    </tr>
  `).join('');
}

function filterWarehouses() {
  const q = document.getElementById('inventory-search-input')?.value.toLowerCase().trim() || '';
  const filtered = warehousesDb.filter(w => 
    (w.name + ' ' + (w.location || '-')).toLowerCase().includes(q)
  );
  document.getElementById('warehouses-tbody').innerHTML = filtered.length ?
      filtered.map(w => `
      <tr>
        <td><strong class="inventory-item-name">${highlightText(w.name, q)}</strong></td>
        <td>${highlightText(w.location || '-', q)}</td>
        <td><span class="inventory-date">${new Date(w.created_at).toLocaleDateString()}</span></td>
        <td><button class="btn btn-edit btn-sm" onclick="editWarehouse(${w.id})">Edit</button></td>
      </tr>
    `).join('') :
    '<tr class="empty-row"><td colspan="4">No warehouses match search</td></tr>';
}

function openWarehouseModal() {
  document.getElementById('f-warehouse-name').value = '';
  document.getElementById('f-warehouse-location').value = '';
  const warehouseTitle = document.getElementById('warehouse-modal-title');
  if (warehouseTitle) warehouseTitle.textContent = 'New Warehouse';
  document.getElementById('warehouse-modal-backdrop').classList.add('open');
}

function closeWarehouseModal() {
  document.getElementById('warehouse-modal-backdrop').classList.remove('open');
}

function saveWarehouse() {
  const name = document.getElementById('f-warehouse-name').value.trim();
  if (!name) {
    alert('Warehouse name is required');
    return;
  }
  const payload = {
    name,
    location: document.getElementById('f-warehouse-location').value.trim()
  };
  fetch('/api/warehouses', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  })
  .then(r => r.json())
  .then(() => {
    closeWarehouseModal();
    loadWarehouses();
    alert('Warehouse saved successfully');
  })
  .catch(e => alert('Error: ' + e.message));
}

function editWarehouse(id) {
  alert('Edit coming soon');
}

// This function is called by loadWarehouses and populates the warehouse dropdowns in modals
function updateWarehouseSelects() {
  const select = document.getElementById('f-movement-warehouse');
  select.innerHTML = '<option value="">Select warehouse</option>' + 
    warehousesDb.map(w => `<option value="${w.id}">${escHtml(w.name)}</option>`).join('');
}


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STOCK
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function loadStock() {
  // Assuming a new endpoint /api/stock that returns all stock levels with product/warehouse names
  fetch('/api/stock') // This endpoint needs to be created in server.js
    .then(r => r.json())
    .then(data => {
    stockDb = data.map(s => {
        const product = productsDb.find(p => p.id === s.product_id);
        return { ...s, product_name: product ? product.name : 'Unknown Product', product_sku: product ? product.sku : 'N/A', reorder_level: product ? product.reorder_level : 0 };
      });
    filterStock();
    updateStockMetrics();
  })
  .catch(e => console.error('Error loading all stock:', e));
}

function renderStock() {
  const tbody = document.getElementById('stock-tbody');
  if (!stockDb.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No stock records found</td></tr>';
    return;
  }
  tbody.innerHTML = stockDb.map(s => {
    const statusText = s.quantity === 0 ? 'OUT OF STOCK' : s.quantity <= s.reorder_level ? 'LOW STOCK' : 'OK';
    const statusClass = s.quantity === 0 ? 'status-out-of-stock' : s.quantity <= s.reorder_level ? 'status-low-stock' : 'status-ok';
    return `
      <tr>
        <td><strong class="inventory-item-name">${escHtml(s.product_name)}</strong></td>
        <td><span class="inventory-sku">${escHtml(s.sku)}</span></td>
        <td>${escHtml(s.warehouse_name)}</td>
        <td class="text-center"><span class="inventory-count">${s.quantity} units</span></td>
        <td class="text-center"><span class="inventory-date">${s.reorder_level}</span></td>
        <td class="text-center"><span class="inventory-status-pill ${statusClass}">${statusText}</span></td>
        <td><button class="btn btn-edit btn-sm" onclick="adjustStock(${s.id})">Adjust</button></td>
      </tr>
    `;
  }).join('');
}

function filterStock() {
  const q = document.getElementById('inventory-search-input')?.value.toLowerCase().trim() || '';
  const filter = document.getElementById('inventory-filter-select')?.value || '';
  let filtered = stockDb.filter(s => 
    (s.product_name + ' ' + s.sku + ' ' + s.warehouse_name).toLowerCase().includes(q)
  );
  if (filter === 'low') filtered = filtered.filter(s => s.quantity > 0 && s.quantity <= s.reorder_level);
  if (filter === 'out') filtered = filtered.filter(s => s.quantity === 0);
  
  document.getElementById('stock-tbody').innerHTML = filtered.length ?
    filtered.map(s => {
      const statusText = s.quantity === 0 ? 'Out of Stock' : s.quantity <= s.reorder_level ? 'Low Stock' : 'OK';
      const statusClass = s.quantity === 0 ? 'status-out-of-stock' : s.quantity <= s.reorder_level ? 'status-low-stock' : 'status-ok';
      return `
        <tr>
          <td><strong class="inventory-item-name">${highlightText(s.product_name, q)}</strong></td>
          <td><span class="inventory-sku">${highlightText(s.sku, q)}</span></td>
          <td>${highlightText(s.warehouse_name, q)}</td>
          <td><span class="inventory-count">${s.quantity} units</span></td>
          <td><span class="inventory-reorder">${s.reorder_level} units</span></td>
          <td><span class="inventory-status-pill ${statusClass}">${statusText}</span></td>
          <td><button class="btn btn-edit btn-sm" onclick="adjustStock(${s.id})">Adjust</button></td>
        </tr>
      `;
    }).join('') :
    '<tr class="empty-row"><td colspan="7">No stock records match filters</td></tr>';
}

function updateStockMetrics() {
  const setMetric = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setMetric('metric-total-skus', productsDb.length);
  setMetric('metric-low-stock', stockDb.filter(s => s.quantity > 0 && s.quantity <= s.reorder_level).length);
  setMetric('metric-total-units', stockDb.reduce((sum, s) => sum + s.quantity, 0));
  setMetric('metric-total-warehouses', warehousesDb.length);
}

function adjustStock(id) {
  alert('Stock adjustment coming soon');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MOVEMENTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function loadMovements() {
  try {
    const response = await fetch('/api/stock-movements');
    movementsDb = await response.json();
    filterMovements();
    updateStockMetrics();
  } catch (e) {
    console.error('Error loading stock movements:', e);
    document.getElementById('movements-tbody').innerHTML = '<tr class="empty-row"><td colspan="7">Error loading movements.</td></tr>';
  }
}

function renderMovements(movementsToRender = movementsDb, q = '') {
  const tbody = document.getElementById('movements-tbody');
  if (!movementsToRender.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No stock movements found.</td></tr>';
    return;
  }
  tbody.innerHTML = movementsToRender.map(m => `
    <tr>
      <td><span class="inventory-date">${new Date(m.created_at).toLocaleString()}</span></td>
      <td><strong class="inventory-item-name">${highlightText(m.product_name, q)}</strong> <span class="inventory-sku inventory-sku-inline">${highlightText(m.product_sku, q)}</span></td>
      <td>${highlightText(m.warehouse_name, q)}</td>
      <td class="text-center"><span class="inventory-type-pill type-${m.movement_type}">${highlightText(m.movement_type, q)}</span></td>
      <td class="text-center"><span class="inventory-count">${m.quantity} units</span></td>
      <td>
        <div class="inventory-source-label" style="font-size:0.72rem; font-weight:600; margin-bottom:2px;">${escHtml(getMovementSourceLabel(m.source_type))}</div>
        <div class="inventory-source-ref">${highlightText(m.reference_doc || m.transaction_docno || '-', q)}</div>
      </td>
      <td>${highlightText(m.notes || '-', q)}</td>
    </tr>
  `).join('');
}

function filterMovements() {
  const q = document.getElementById('inventory-search-input')?.value.toLowerCase().trim() || '';
  const filter = document.getElementById('inventory-filter-select')?.value || '';
  let filtered = movementsDb.filter(m => {
    const haystack = [m.product_name, m.product_sku, m.warehouse_name, m.reference_doc, m.transaction_docno, m.notes, m.movement_type, m.source_type].join(' ').toLowerCase();
    return !q || haystack.includes(q);
  });
  if (filter) filtered = filtered.filter(m => m.movement_type === filter);
  renderMovements(filtered, q);
}

function openMovementModal() {
  ['movement-product', 'movement-warehouse', 'movement-type', 'movement-qty', 'movement-reference', 'movement-notes'].forEach(id => {
    let el = document.getElementById('f-' + id);
    if (el) el.value = '';
  });
  const sourceType = document.getElementById('f-movement-source-type');
  if (sourceType) sourceType.value = 'manual';
  const movementTitle = document.getElementById('movement-modal-title');
  if (movementTitle) movementTitle.textContent = 'Log Stock Movement';
  document.getElementById('movement-modal-backdrop').classList.add('open');
}

function closeMovementModal() {
  document.getElementById('movement-modal-backdrop').classList.remove('open');
}

function saveMovement() {
  const productId = document.getElementById('f-movement-product').value;
  const warehouseId = document.getElementById('f-movement-warehouse').value;
  const movementType = document.getElementById('f-movement-type').value;
  const quantity = parseInt(document.getElementById('f-movement-qty').value);
  const sourceType = document.getElementById('f-movement-source-type').value || 'manual';
  const sourceReference = document.getElementById('f-movement-reference').value.trim();
  
  if (!productId || !warehouseId || !movementType || !quantity) {
    alert('Product, Warehouse, Type, and Quantity are required');
    return;
  }
  if (sourceType !== 'manual' && !sourceReference) {
    alert('Source Reference is required when a procurement source is selected.');
    return;
  }
  
  const payload = {
    product_id: productId,
    warehouse_id: warehouseId,
    movement_type: movementType,
    quantity,
    source_type: sourceType,
    reference_doc: sourceReference,
    notes: document.getElementById('f-movement-notes').value.trim()
  };
  
  fetch('/api/stock-movements', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  })
  .then(r => r.json())
  .then(() => {
    closeMovementModal();
    loadStock();
    alert('Stock movement recorded successfully');
  })
  .catch(e => alert('Error: ' + e.message));
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// UTILITIES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function escHtml(str) {
  return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightText(value, query) {
  const escaped = escHtml(value);
  const tokens = String(query || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return escaped;

  const pattern = tokens
    .sort((a, b) => b.length - a.length)
    .map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  return pattern ? escaped.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>') : escaped;
}

