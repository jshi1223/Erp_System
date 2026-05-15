'use strict';

const procurementState = {
  businessEntities: [],
  companies: [],
  projects: [],
  requisitions: [],
  purchaseOrders: [],
  goodsReceipts: [],
  vendors: []
};

let procurementTab = 'vendors';
const PROCUREMENT_TAB_STORAGE_KEY = 'accounts-payable.procurement.activeTab';
let editingRequisitionId = null;
let editingPurchaseOrderId = null;
let editingGoodsReceiptId = null;
let currentPurchaseOrderProjectId = null;
let pendingPurchaseOrderRequisitionId = null;
let vendorSearchBound = false;
let vendorNumberPreviewToken = 0;
let procurementLoadVersion = 0;
let pendingPurchaseOrderCompanyId = null;
let pendingPurchaseOrderProjectId = null;
const PROCUREMENT_VENDOR_SORT_STORAGE_KEY = 'kinaadman.procurement.vendorSort';
let vendorDirectorySortOrder = 'asc';
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

function requisitionIsApprovedForPurchaseOrder(requisition) {
  return String(requisition?.status || '').trim().toLowerCase() === 'approved';
}

function normalizeWorkflowStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function userCanApproveProcurement() {
  if (typeof isAdminUser === 'function') return Boolean(isAdminUser());
  const lexicalUser = typeof currentUser !== 'undefined' ? currentUser : null;
  return String(window.currentUser?.role || lexicalUser?.role || '').toLowerCase() === 'admin';
}

function isFinalProcurementStatus(status) {
  return ['ordered', 'received', 'cancelled'].includes(normalizeWorkflowStatus(status));
}

function normalizeProcurementTab(value) {
  const tab = String(value || '').trim().toLowerCase();
  return ['vendors', 'requisitions', 'purchase-orders', 'goods-receipts'].includes(tab) ? tab : 'vendors';
}

function getSavedProcurementTab() {
  try {
    return normalizeProcurementTab(window.localStorage.getItem(PROCUREMENT_TAB_STORAGE_KEY));
  } catch (_) {
    return 'vendors';
  }
}

function saveProcurementTab(tab) {
  try {
    window.localStorage.setItem(PROCUREMENT_TAB_STORAGE_KEY, normalizeProcurementTab(tab));
  } catch (_) {}
}

function getProcurementTabButton(tab) {
  return document.querySelector(`.ap-workspace-tab[data-proc-tab="${normalizeProcurementTab(tab)}"], .module-tab[data-proc-tab="${normalizeProcurementTab(tab)}"]`);
}

function syncProcurementTabButtons(tab) {
  const activeTab = normalizeProcurementTab(tab);
  document.querySelectorAll('.ap-workspace-tab[data-proc-tab], .module-tab[data-proc-tab]').forEach((node) => {
    const nodeTab = normalizeProcurementTab(node.getAttribute('data-proc-tab') || node.textContent);
    const isActive = nodeTab === activeTab;
    node.classList.toggle('active', isActive);
    node.setAttribute('aria-selected', String(isActive));
  });
}

function normalizeTinDigits(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 12);
}

function normalizeUniqueText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function formatTinValue(value) {
  const digits = normalizeTinDigits(value);
  if (!digits) return '';
  return digits.match(/.{1,3}/g)?.join('-') || digits;
}

function isVendorActive(vendor) {
  return Number(vendor?.is_active ?? 1) !== 0;
}

function getVendorStatusLabel(vendor) {
  return isVendorActive(vendor) ? 'Active' : 'Inactive';
}

function getVendorStatusBadgeHtml(vendor) {
  const active = isVendorActive(vendor);
  const style = active
    ? 'background: rgba(21, 128, 61, 0.12); color: #15803d; border-color: rgba(21, 128, 61, 0.22);'
    : 'background: #eef2f7; color: #6b7280; border-color: #cbd5e1;';
  return `<span class="status-pill" style="${style}">${active ? 'Active' : 'Inactive'}</span>`;
}

function getActiveVendors(rows = procurementState.vendors) {
  return (Array.isArray(rows) ? rows : []).filter((vendor) => isVendorActive(vendor));
}

function getPurchaseOrderIssuerBusinessEntityId() {
  const selectValue = String($('po-business-entity')?.value || '').trim();
  if (selectValue) return selectValue;
  if (typeof getCurrentBusinessEntityId === 'function') {
    const current = String(getCurrentBusinessEntityId() || '').trim();
    if (current) return current;
  }
  return String(getDefaultProcurementBusinessEntityId() || '').trim();
}

function vendorCanBeUsedForPurchaseOrder(vendor) {
  const vendorBusinessEntityId = String(vendor?.business_entity_id || '').trim();
  const issuerBusinessEntityId = getPurchaseOrderIssuerBusinessEntityId();
  return !vendorBusinessEntityId || !issuerBusinessEntityId || vendorBusinessEntityId !== issuerBusinessEntityId;
}

function getPurchaseOrderVendorChoices() {
  return getActiveVendors(procurementState.vendors).filter(vendorCanBeUsedForPurchaseOrder);
}

function normalizeVendorSortOrder(value) {
  return String(value || '').trim().toLowerCase() === 'desc' ? 'desc' : 'asc';
}

function getSavedVendorSortOrder() {
  try {
    return normalizeVendorSortOrder(window.localStorage.getItem(PROCUREMENT_VENDOR_SORT_STORAGE_KEY));
  } catch (_) {
    return 'asc';
  }
}

function saveVendorSortOrder(order) {
  try {
    window.localStorage.setItem(PROCUREMENT_VENDOR_SORT_STORAGE_KEY, normalizeVendorSortOrder(order));
  } catch (_) {}
}

function getVendorSortLabel(order = vendorDirectorySortOrder) {
  return normalizeVendorSortOrder(order) === 'desc' ? 'DESC ↓' : 'ASC ↑';
}

function updateVendorSortButtonLabel() {
  const button = $('vendor-sort-btn');
  if (!button) return;
  button.textContent = `Sort: ${getVendorSortLabel()}`;
}

function setVendorDirectorySortOrder(order, options = {}) {
  const nextOrder = normalizeVendorSortOrder(order);
  vendorDirectorySortOrder = nextOrder;
  if (options.persist !== false) {
    saveVendorSortOrder(nextOrder);
  }
  updateVendorSortButtonLabel();
  if (options.rerender !== false && procurementTab === 'vendors') {
    renderVendorDirectory();
  }
}

function toggleVendorDirectorySortOrder() {
  setVendorDirectorySortOrder(vendorDirectorySortOrder === 'asc' ? 'desc' : 'asc');
}

function parseVendorSortKey(vendorNo) {
  const match = /^VEN-(\d{4})-(\d{1,})$/i.exec(String(vendorNo || '').trim());
  if (!match) return null;
  return (Number(match[1]) * 10000) + Number(match[2]);
}

function getVendorDirectorySortKey(vendor) {
  const vendorNoKey = parseVendorSortKey(vendor?.vendor_no || '');
  if (Number.isFinite(vendorNoKey)) return vendorNoKey;

  const createdAtKey = Date.parse(vendor?.created_at || '');
  if (Number.isFinite(createdAtKey)) return createdAtKey;

  return Number(vendor?.id || 0) || 0;
}

function sortVendorDirectoryRows(rows = []) {
  const direction = normalizeVendorSortOrder(vendorDirectorySortOrder) === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const keyA = getVendorDirectorySortKey(a);
    const keyB = getVendorDirectorySortKey(b);
    if (keyA !== keyB) return (keyA - keyB) * direction;

    const nameA = String(a?.vendor_name || '').toLowerCase();
    const nameB = String(b?.vendor_name || '').toLowerCase();
    if (nameA !== nameB) return nameA.localeCompare(nameB) * direction;

    return (Number(a?.id || 0) - Number(b?.id || 0)) * direction;
  });
}

async function loadVendorNumberPreview() {
  const input = $('f-vendor-no');
  if (!input) return '';

  const token = ++vendorNumberPreviewToken;
  input.value = '';

  try {
    const data = await apiFetch('/api/vendors/next-no', { cache: 'no-store' });
    if (token !== vendorNumberPreviewToken) return;
    const vendorNo = String(data?.vendor_no || '').trim();
    input.value = vendorNo;
    return vendorNo;
  } catch (_) {
    if (token === vendorNumberPreviewToken) {
      input.value = '';
    }
    return '';
  }
  return String(input.value || '').trim();
}

async function loadProcurementNumberPreview(inputId, endpoint, responseKey) {
  const input = $(inputId);
  if (!input) return '';
  input.value = '';
  try {
    const params = new URLSearchParams();
    const businessEntityId = (typeof getCurrentBusinessEntityId === 'function' ? getCurrentBusinessEntityId() : '') || getDefaultProcurementBusinessEntityId() || '';
    if (businessEntityId) params.set('business_entity_id', businessEntityId);
    const query = params.toString();
    const data = await apiFetch(`${endpoint}${query ? `?${query}` : ''}`, { cache: 'no-store' });
    const value = String(data?.[responseKey] || '').trim();
    if (value && !input.value) input.value = value;
    return value;
  } catch (_) {
    input.value = '';
    return '';
  }
}

function loadRequisitionNumberPreview() {
  return loadProcurementNumberPreview('pr-number', '/api/procurement/requisitions/next-number', 'pr_number');
}

function loadPurchaseOrderNumberPreview() {
  return loadProcurementNumberPreview('po-number', '/api/procurement/purchase-orders/next-number', 'po_number');
}

function loadGoodsReceiptNumberPreview() {
  return loadProcurementNumberPreview('grn-number', '/api/procurement/goods-receipts/next-number', 'grn_number');
}

function bindVendorTinMask() {
  const input = $('f-vendor-tin');
  if (!input || input.dataset.tinMaskBound === '1') return;
  const applyMask = () => {
    const formatted = formatTinValue(input.value);
    if (input.value !== formatted) {
      input.value = formatted;
    }
  };
  input.dataset.tinMaskBound = '1';
  input.addEventListener('input', applyMask);
  input.addEventListener('blur', applyMask);
  applyMask();
}

const apiFetch = fetchJson;

async function loadProcurementRows(url, label) {
  try {
    const data = await apiFetch(url, { cache: 'no-store' });
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error(`Load procurement ${label} error:`, err);
    return [];
  }
}

function getProcurementFieldMessageNode(fieldName) {
  return document.querySelector(`[data-procurement-field-message="${fieldName}"]`);
}

function getProcurementFieldNodes(fieldName) {
  const map = {
    pr_number: ['pr-number'],
    company_id: ['pr-company', 'po-company'],
    request_date: ['pr-request-date'],
    pr_line_items: ['pr-line-items'],
    po_number: ['po-number'],
    requisition_id: ['po-requisition'],
    project_id: ['po-project'],
    vendor_id: ['po-vendor-search', 'po-vendor'],
    po_date: ['po-date'],
    line_items: ['po-line-items'],
    grn_number: ['grn-number'],
    po_id: ['grn-po'],
    received_date: ['grn-received-date'],
    vendor_name: ['f-vendor-name'],
    vendor_contact: ['f-vendor-contact'],
    vendor_email: ['f-vendor-email'],
    vendor_phone: ['f-vendor-phone'],
    vendor_tin: ['f-vendor-tin'],
    vendor_address: ['f-vendor-address'],
    vendor_company: ['f-vendor-company']
  };

  return (map[fieldName] || [])
    .map((id) => document.getElementById(id))
    .filter(Boolean);
}

function setProcurementFieldMessage(fieldName, message = '') {
  const notices = Array.from(document.querySelectorAll(`[data-procurement-field-message="${fieldName}"]`));
  const text = String(message || '').trim();

  notices.forEach((notice) => {
    const field = notice.closest('.field') || null;
    notice.textContent = text;
    notice.classList.toggle('is-hidden', !text);

    if (field) {
      field.classList.toggle('has-error', !!text);
    }
  });

  getProcurementFieldNodes(fieldName).forEach((node) => {
    node.setAttribute('aria-invalid', text ? 'true' : 'false');
  });
}

function clearProcurementFieldMessages() {
  ['pr_number', 'company_id', 'request_date', 'pr_line_items', 'po_number', 'requisition_id', 'project_id', 'vendor_id', 'po_date', 'line_items', 'grn_number', 'po_id', 'received_date', 'vendor_name', 'vendor_contact', 'vendor_email', 'vendor_phone', 'vendor_tin', 'vendor_address', 'vendor_company'].forEach((fieldName) => {
    setProcurementFieldMessage(fieldName, '');
  });
  clearRequisitionLineItemMessages();
  clearPurchaseOrderLineItemMessages();
}

function focusProcurementElement(node) {
  if (!node || typeof node.focus !== 'function') return false;
  if (typeof node.scrollIntoView === 'function') {
    node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }
  node.focus({ preventScroll: true });
  if (typeof node.select === 'function' && ['INPUT', 'TEXTAREA'].includes(node.tagName)) {
    node.select();
  }
  return true;
}

function focusFirstProcurementControl(ids = []) {
  for (const id of ids) {
    if (focusProcurementElement($(id))) {
      return id;
    }
  }
  return null;
}

function focusFirstProcurementField(fieldName, focusMap = {}) {
  const ids = Array.isArray(focusMap[fieldName])
    ? focusMap[fieldName]
    : (focusMap[fieldName] ? [focusMap[fieldName]] : []);
  return focusFirstProcurementControl(ids);
}

function focusFirstInvalidPurchaseOrderLineItem() {
  const rows = Array.from(getPurchaseOrderLineItemsContainer()?.querySelectorAll('[data-po-line-item]') || []);
  const firstIncomplete = rows.find((row) => {
    return Boolean(
      !String(row.querySelector('.po-line-description')?.value || '').trim() ||
      Number(row.querySelector('.po-line-qty')?.value || 0) <= 0 ||
      Number(row.querySelector('.po-line-unit-price')?.value || 0) <= 0
    );
  }) || rows[0] || null;
  if (!firstIncomplete) {
    return focusProcurementElement(document.querySelector('#po-modal-backdrop .po-line-toolbar .btn-add'));
  }
  return focusProcurementElement(
    firstIncomplete.querySelector('.po-line-description') ||
    firstIncomplete.querySelector('.po-line-qty') ||
    firstIncomplete.querySelector('.po-line-unit-price') ||
    firstIncomplete
  );
}

function focusFirstInvalidRequisitionLineItem() {
  const rows = Array.from(getRequisitionLineItemsContainer()?.querySelectorAll('[data-pr-line-item]') || []);
  const firstIncomplete = rows.find((row) => {
    return Boolean(
      !String(row.querySelector('.pr-line-item-name')?.value || '').trim() ||
      Number(row.querySelector('.pr-line-qty')?.value || 0) <= 0
    );
  }) || rows[0] || null;
  if (!firstIncomplete) {
    return focusProcurementElement(document.querySelector('#pr-modal-backdrop .po-line-toolbar .btn-add'));
  }
  return focusProcurementElement(
    firstIncomplete.querySelector('.pr-line-item-name') ||
    firstIncomplete.querySelector('.pr-line-qty') ||
    firstIncomplete
  );
}

function setupProcurementModalValidationListeners() {
  const bindings = [
    ['pr-number', 'pr_number', 'input'],
    ['pr-company', 'company_id', 'change'],
    ['pr-request-date', 'request_date', 'change'],
    ['po-number', 'po_number', 'input'],
    ['po-company', 'company_id', 'change'],
    ['po-project', 'project_id', 'change'],
    ['po-requisition', 'requisition_id', 'change'],
    ['po-vendor-search', 'vendor_id', 'input'],
    ['po-date', 'po_date', 'change'],
    ['grn-number', 'grn_number', 'input'],
    ['grn-po', 'po_id', 'change'],
    ['grn-received-date', 'received_date', 'change'],
    ['f-vendor-name', 'vendor_name', 'input'],
    ['f-vendor-contact', 'vendor_contact', 'input'],
    ['f-vendor-email', 'vendor_email', 'input'],
    ['f-vendor-phone', 'vendor_phone', 'input'],
    ['f-vendor-phone-country', 'vendor_phone', 'change'],
    ['f-vendor-tin', 'vendor_tin', 'input'],
    ['f-vendor-address', 'vendor_address', 'input'],
    ['f-vendor-company', 'vendor_company', 'change']
  ];

  bindings.forEach(([id, fieldName, eventName]) => {
    const node = document.getElementById(id);
    if (!node || node.dataset.procurementValidationBound === '1') return;
    node.dataset.procurementValidationBound = '1';
    node.addEventListener(eventName, () => {
      setProcurementFieldMessage(fieldName, '');
      if (id === 'f-vendor-company') {
        autofillVendorFromSelectedCompany();
      } else if (id === 'grn-po') {
        syncGoodsReceiptFromPurchaseOrder();
      }
    });
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

function getRequisitionLineItemMessageNode(row) {
  return row?.querySelector('[data-pr-line-message]') || null;
}

function setRequisitionLineItemMessage(row, message = '') {
  if (!row) return;
  const notice = getRequisitionLineItemMessageNode(row);
  const text = String(message || '').trim();

  if (notice) {
    notice.textContent = text;
    notice.classList.toggle('is-hidden', !text);
  }

  row.classList.toggle('has-error', !!text);
  row.querySelectorAll('input, textarea').forEach((input) => {
    input.setAttribute('aria-invalid', text ? 'true' : 'false');
  });
}

function clearRequisitionLineItemMessages() {
  Array.from(getRequisitionLineItemsContainer()?.querySelectorAll('[data-pr-line-item]') || [])
    .forEach((row) => setRequisitionLineItemMessage(row, ''));
}

function initProcurementPage() {
  const integratedApPage = !!$('ap-purchasing-root');
  if (!integratedApPage && !$('procurement-page')) return;
  setDefaultDates();
  setupProcurementModalValidationListeners();
  bindVendorTinMask();
  wireBackdropClose();
  vendorDirectorySortOrder = getSavedVendorSortOrder();
  const params = new URLSearchParams(window.location.search);
  const requestedTab = normalizeProcurementTab(params.get('tab') || '');
  procurementTab = params.has('tab') ? requestedTab : getSavedProcurementTab();
  if (!integratedApPage) {
    switchProcTab(procurementTab, getProcurementTabButton(procurementTab));
  }
  pendingPurchaseOrderRequisitionId = Number(params.get('requisition_id') || 0) || null;
  pendingPurchaseOrderCompanyId = Number(params.get('company_id') || 0) || null;
  pendingPurchaseOrderProjectId = Number(params.get('project_id') || 0) || null;
  const openPurchaseOrder = String(params.get('action') || '').toLowerCase() === 'po';
  loadProcurementData().then(() => {
    if (openPurchaseOrder) {
      if (typeof window.switchApWorkspaceTab === 'function') {
        window.switchApWorkspaceTab('purchase-orders', getProcurementTabButton('purchase-orders'));
      } else {
        switchProcTab('purchase-orders', getProcurementTabButton('purchase-orders'));
      }
      openPurchaseOrderModal(null, null, pendingPurchaseOrderRequisitionId, {
        companyId: pendingPurchaseOrderCompanyId,
        projectId: pendingPurchaseOrderProjectId
      });
      pendingPurchaseOrderRequisitionId = null;
      pendingPurchaseOrderCompanyId = null;
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
  const nextTab = normalizeProcurementTab(tab);
  captureProcurementToolbarState(procurementTab);
  procurementTab = nextTab;
  saveProcurementTab(nextTab);
  if (typeof window.setAccountsPayableActiveTab === 'function') {
    window.setAccountsPayableActiveTab(nextTab, { persistState: true });
  }

  const hasWorkspaceTabs = !!document.querySelector('.ap-workspace-tab');
  const tabSelector = hasWorkspaceTabs ? '.ap-workspace-tab' : '.module-tab';
  const sectionSelector = hasWorkspaceTabs ? '.ap-workspace-section' : '.content-section';
  document.querySelectorAll(tabSelector).forEach((node) => node.classList.remove('active'));
  document.querySelectorAll(sectionSelector).forEach((node) => node.classList.remove('active'));

  syncProcurementTabButtons(nextTab);
  if (btn) btn.classList.add('active');
  const section = $(nextTab);
  if (section) section.classList.add('active');
  renderProcurementToolbarControls(nextTab);
  if (nextTab === 'requisitions') renderRequisitions();
  if (nextTab === 'vendors') renderVendorDirectory();
  if (nextTab === 'purchase-orders') renderPurchaseOrders();
  if (nextTab === 'goods-receipts') renderGoodsReceipts();
}

function captureProcurementToolbarState(tab) {
  if (!procurementToolbarState[tab]) return;
  procurementToolbarState[tab].search = $('procurement-search-input')?.value || '';
  if (tab === 'vendors') {
    procurementToolbarState.vendors.search = $('vendor-search')?.value || '';
  }
}

function renderProcurementToolbarControls(tab) {
  const actions = document.getElementById('module-toolbar-actions') || document.getElementById('procurement-toolbar-actions');
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
        <input id="vendor-search" type="text" placeholder="Search vendor no., name, contact, email, or phone..." value="${escHtml(state.search || '')}" oninput="filterVendorDirectory()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openVendorModal()">Add Vendor</button>
    `;
    return;
  }

  if (tab === 'purchase-orders') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="procurement-search-input" type="text" placeholder="Search PO no., vendor, project, item, or status..." value="${escHtml(state.search || '')}" oninput="renderPurchaseOrders()" />
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
  const loadVersion = ++procurementLoadVersion;
  try {
    const companyQuery = new URLSearchParams({ include_archived: '1' });
    const [businessEntities, companies, projects, vendors, requisitions, purchaseOrders, goodsReceipts] = await Promise.all([
      loadProcurementRows('/api/business-entities', 'business entities'),
      loadProcurementRows(`/api/company-registry?${companyQuery.toString()}`, 'companies'),
      loadProcurementRows('/api/projects?include_archived=1', 'projects'),
      loadProcurementRows('/api/vendors?include_inactive=1', 'vendors'),
      loadProcurementRows('/api/procurement/requisitions', 'requisitions'),
      loadProcurementRows('/api/procurement/purchase-orders', 'purchase orders'),
      loadProcurementRows('/api/procurement/goods-receipts', 'goods receipts')
    ]);

    if (loadVersion !== procurementLoadVersion) {
      return false;
    }

    procurementState.businessEntities = Array.isArray(businessEntities) ? businessEntities : [];
    procurementState.companies = Array.isArray(companies) ? companies : [];
    procurementState.projects = Array.isArray(projects) ? projects : [];
    const companyIds = new Set(procurementState.companies.map(company => Number(company.id || 0)).filter(Boolean));
    procurementState.vendors = (Array.isArray(vendors) ? vendors : []).filter((vendor) => {
      const companyId = Number(vendor.company_id || 0);
      return !companyId || companyIds.has(companyId);
    });
    procurementState.requisitions = Array.isArray(requisitions) ? requisitions : [];
    procurementState.purchaseOrders = Array.isArray(purchaseOrders) ? purchaseOrders : [];
    procurementState.goodsReceipts = Array.isArray(goodsReceipts) ? goodsReceipts : [];

    renderSummary();
    renderBusinessEntityOptions('po-business-entity');
    renderCompanyOptions();
    renderCompanyOptions('po-company');
    renderPurchaseOrderProjectOptions();
    renderCompanyOptions('f-vendor-company', 'No company selected');
    renderVendorDirectory();
    renderVendorOptions();
    initVendorSearch();
    renderPurchaseOrderRequisitionOptions();
    renderPurchaseOrderOptions();
    renderRequisitions();
    renderPurchaseOrders();
    renderGoodsReceipts();
    return true;
  } catch (err) {
    console.error('Load procurement data error:', err);
    showToast(err.message || 'Unable to load procurement records.', 'error');
    return false;
  }
}

function renderSummary() {
  const set = (id, value) => {
    const node = $(id);
    if (node) node.textContent = String(value);
  };
  const statusIs = (row, status) => String(row?.status || '').trim().toLowerCase() === status;
  const inCurrentMonth = (value) => {
    if (!value) return false;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    const today = new Date();
    return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
  };
  const entityFilter = typeof businessEntityMatches === 'function' ? businessEntityMatches : () => true;
  const requisitionRows = procurementState.requisitions.filter(entityFilter);
  const purchaseOrderRows = procurementState.purchaseOrders.filter(entityFilter);
  const goodsReceiptRows = procurementState.goodsReceipts.filter(entityFilter);
  const activeVendorCount = getActiveVendors(procurementState.vendors).length;
  const inactiveVendorCount = procurementState.vendors.length - activeVendorCount;
  const vendorsWithPurchaseOrders = new Set(
    purchaseOrderRows
      .map((row) => Number(row.vendor_id || 0))
      .filter(Boolean)
  );
  const requisitionTotal = requisitionRows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const purchaseOrderTotal = purchaseOrderRows.reduce((sum, row) => sum + Number(row.computed_total || row.total_amount || 0), 0);
  const linkedReceiptPoIds = new Set(
    goodsReceiptRows
      .map((row) => Number(row.po_id || 0))
      .filter(Boolean)
  );

  set('metric-vendors-count', activeVendorCount);
  set('metric-vendors-inactive', Math.max(0, inactiveVendorCount));
  set('metric-vendors-total', procurementState.vendors.length);
  set('metric-vendors-with-po', vendorsWithPurchaseOrders.size);

  set('metric-pr-count', requisitionRows.length);
  set('metric-pr-approved', requisitionRows.filter((row) => statusIs(row, 'approved')).length);
  set('metric-pr-open', requisitionRows.filter((row) => !['cancelled', 'rejected', 'received'].includes(String(row.status || '').trim().toLowerCase())).length);
  set('metric-pr-total', money(requisitionTotal));

  set('metric-po-count', purchaseOrderRows.length);
  set('metric-po-ordered', purchaseOrderRows.filter((row) => statusIs(row, 'approved')).length);
  set('metric-po-received', purchaseOrderRows.filter((row) => statusIs(row, 'received')).length);
  set('metric-po-total', money(purchaseOrderTotal));

  set('metric-grn-count', goodsReceiptRows.length);
  set('metric-grn-received', goodsReceiptRows.filter((row) => statusIs(row, 'received')).length);
  set('metric-grn-linked-pos', linkedReceiptPoIds.size);
  set('metric-grn-this-month', goodsReceiptRows.filter((row) => inCurrentMonth(row.received_date)).length);
}

function renderVendorOptions() {
  const searchInput = $('po-vendor-search');
  const hiddenInput = $('po-vendor');
  const resultsContainer = $('po-vendor-results');
  
  if (!searchInput || !hiddenInput || !resultsContainer) return;

  searchInput._vendors = getPurchaseOrderVendorChoices();

  const currentVendorId = hiddenInput.value;
  const currentVendor = procurementState.vendors.find(v => Number(v.id) === Number(currentVendorId));
  if (!currentVendorId || !currentVendor || !vendorCanBeUsedForPurchaseOrder(currentVendor)) {
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

  const vendors = getPurchaseOrderVendorChoices();
  const filtered = sortVendorDirectoryRows(vendors).filter((vendor) => {
    const vendorNo = String(vendor.vendor_no || '').toLowerCase();
    const name = String(vendor.vendor_name || '').toLowerCase();
    const contact = String(vendor.contact_person || '').toLowerCase();
    const email = String(vendor.email || '').toLowerCase();
    const phone = String(vendor.phone || '').toLowerCase();
    const address = String(vendor.address || '').toLowerCase();
    const tin = String(vendor.tin || '').toLowerCase();
    const tinDigits = normalizeTinDigits(vendor.tin || '');
    const queryDigits = query.replace(/\D/g, '');
    return showAll || vendorNo.includes(query) || name.includes(query) || contact.includes(query) || email.includes(query) || phone.includes(query) || address.includes(query) || tin.includes(query) || (queryDigits && tinDigits.includes(queryDigits));
  });

  if (filtered.length === 0) {
    resultsContainer.innerHTML = '<div class="vendor-search-empty">No vendors found</div>';
  } else {
    resultsContainer.innerHTML = filtered.slice(0, 10).map((vendor) => `
      <div class="vendor-search-item" data-id="${vendor.id}" data-name="${escHtml(vendor.vendor_name)}">
        <div class="vendor-name">${escHtml(vendor.vendor_no || 'Pending')} &middot; ${escHtml(vendor.vendor_name)}</div>
        <div class="vendor-contact">${escHtml(vendor.contact_person || 'No contact')} - ${escHtml(vendor.company_name || vendor.phone || '-')}</div>
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
  updateVendorSortButtonLabel();

  const q = String($('vendor-search')?.value || '').trim().toLowerCase();
  const vendors = procurementState.vendors || [];
  const rows = sortVendorDirectoryRows(vendors.filter((vendor) => {
    const haystack = [
      vendor.vendor_no,
      vendor.vendor_name,
      vendor.contact_person,
      vendor.email,
      vendor.phone,
      vendor.address,
      vendor.tin,
      vendor.company_no,
      vendor.company_name,
      formatTinValue(vendor.tin || ''),
      getVendorStatusLabel(vendor)
    ].map((value) => String(value || '')).join(' ').toLowerCase();
    return !q || haystack.includes(q);
  }));

  tbody.innerHTML = rows.length ? rows.map((vendor) => buildVendorDirectoryRowHtml(vendor)).join('') : '<tr class="empty-row"><td colspan="8">No vendors found.</td></tr>';
}

function buildVendorDirectoryRowHtml(vendor) {
  const vendorId = String(vendor?.id ?? '').trim();
  const numericVendorId = Number(vendorId);
  const canUseInPo = Number.isFinite(numericVendorId) && numericVendorId > 0;
  const vendorIsActive = isVendorActive(vendor);
  const statusActionLabel = vendorIsActive ? 'Deactivate' : 'Activate';
  const statusActionClass = vendorIsActive ? 'btn btn-cancel btn-sm' : 'btn btn-edit btn-sm';
  const actionsHtml = !canUseInPo
    ? '<span class="status-chip status-draft" style="pointer-events:none;">Saving...</span>'
    : (
      vendorIsActive
        ? `
          <button class="${statusActionClass}" type="button" onclick="toggleVendorStatus(${numericVendorId}, 0)">${statusActionLabel}</button>
          <button class="btn btn-edit btn-sm" type="button" onclick="openPurchaseOrderModal(null, ${numericVendorId})">Use in PO</button>
        `
        : `<button class="${statusActionClass}" type="button" onclick="toggleVendorStatus(${numericVendorId}, 1)">${statusActionLabel}</button>`
    );
  return `
    <tr data-vendor-id="${vendorId}">
      <td>
        <div style="font-weight:700;color:var(--primary)">${escHtml(vendor?.vendor_no || 'Pending')}</div>
      </td>
      <td>
        <div style="font-weight:600;color:var(--primary)">${escHtml(vendor?.vendor_name || '-')}</div>
        <div style="font-size:0.76rem;color:var(--text-muted);margin-top:2px;">${escHtml(vendor?.company_name || 'General vendor')} &middot; ${escHtml(vendor?.address || 'No address')}</div>
      </td>
      <td>${escHtml(vendor?.contact_person || '-')}</td>
      <td>${escHtml(vendor?.email || '-')}</td>
      <td>${escHtml(vendor?.phone || '-')}</td>
      <td>${escHtml(formatTinValue(vendor?.tin || '') || '-')}</td>
      <td class="text-center">${getVendorStatusBadgeHtml(vendor)}</td>
      <td>
        <div class="erp-actions" style="justify-content:center;">
          ${actionsHtml}
        </div>
      </td>
    </tr>
  `;
}

function prependVendorDirectoryRow(vendor) {
  const tbody = $('vendor-body');
  if (!tbody) return false;
  const vendorId = String(vendor?.id ?? '').trim();
  if (!vendorId) return false;

  const existingRow = tbody.querySelector(`tr[data-vendor-id="${vendorId}"]`);
  if (existingRow) {
    existingRow.remove();
  }

  const emptyRow = tbody.querySelector('tr.empty-row');
  if (emptyRow) {
    emptyRow.remove();
  }

  tbody.insertAdjacentHTML('afterbegin', buildVendorDirectoryRowHtml(vendor));
  return true;
}

function focusVendorDirectoryTopRow() {
  const section = $('vendors');
  if (section && typeof section.scrollIntoView === 'function') {
    try {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (_) {}
  }

  const tbody = $('vendor-body');
  if (!tbody) return;
  const row = Array.from(tbody.querySelectorAll('tr')).find((tr) => !tr.classList.contains('empty-row'));
  if (!row) return;

  try {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (_) {}

  const previousColor = row.style.backgroundColor;
  row.style.transition = 'background-color 0.35s ease';
  row.style.backgroundColor = 'rgba(255, 214, 102, 0.28)';
  setTimeout(() => {
    row.style.backgroundColor = previousColor || '';
  }, 1800);
}

function filterVendorDirectory() {
  renderVendorDirectory();
}

function resetVendorForm() {
  ['f-vendor-no', 'f-vendor-name', 'f-vendor-company', 'f-vendor-contact', 'f-vendor-email', 'f-vendor-phone', 'f-vendor-address', 'f-vendor-tin'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });
  clearProcurementFieldMessages();
}

function setVendorFieldFromCompany(id, value, { formatValue } = {}) {
  const node = $(id);
  if (!node) return;
  if (String(node.value || '').trim()) return;

  const text = String(value || '').trim();
  if (!text) return;
  node.value = typeof formatValue === 'function' ? formatValue(text) : text;
}

function autofillVendorFromSelectedCompany() {
  const companyId = Number($('f-vendor-company')?.value || 0) || 0;
  if (!companyId) return;

  const company = procurementState.companies.find((entry) => Number(entry.id || 0) === companyId);
  if (!company) return;

  setVendorFieldFromCompany('f-vendor-name', company.company_name);
  setVendorFieldFromCompany('f-vendor-contact', company.contact_person);
  setVendorFieldFromCompany('f-vendor-email', company.email);
  setVendorFieldFromCompany('f-vendor-phone', company.phone, { formatValue: normalizePhone });
  setVendorFieldFromCompany('f-vendor-tin', company.tin, { formatValue: (value) => formatTinValue(value) });
  setVendorFieldFromCompany('f-vendor-address', company.address);

  [
    ['vendor_name', 'f-vendor-name'],
    ['vendor_contact', 'f-vendor-contact'],
    ['vendor_email', 'f-vendor-email'],
    ['vendor_phone', 'f-vendor-phone'],
    ['vendor_tin', 'f-vendor-tin'],
    ['vendor_address', 'f-vendor-address']
  ].forEach(([fieldName, id]) => {
    if (String($(id)?.value || '').trim()) {
      setProcurementFieldMessage(fieldName, '');
    }
  });
}

function syncVendorModalMode() {
  const title = $('vendor-modal-title');
  const saveBtn = $('vendor-save-btn');
  if (title) title.textContent = 'Add Vendor';
  if (saveBtn) saveBtn.textContent = 'Create Vendor';
}

function findDuplicateVendorEntry(phone, tin, email, excludeId = null) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedTin = normalizeTinDigits(tin);
  const normalizedEmail = normalizeUniqueText(String(email || ''));
  const currentId = Number(excludeId || 0) || 0;
  const vendors = Array.isArray(procurementState.vendors) ? procurementState.vendors : [];

  for (const vendor of vendors) {
    if (!vendor) continue;
    if (currentId && Number(vendor.id || 0) === currentId) continue;

    if (normalizedPhone && normalizePhone(vendor.phone || '') === normalizedPhone) {
      return {
        field: 'vendor_phone',
        selector: 'f-vendor-phone',
        message: 'Phone already exists in Vendor Directory.'
      };
    }

    if (normalizedTin && normalizeTinDigits(vendor.tin || '') === normalizedTin) {
      return {
        field: 'vendor_tin',
        selector: 'f-vendor-tin',
        message: 'TIN already exists in Vendor Directory.'
      };
    }

    if (normalizedEmail && normalizeUniqueText(vendor.email || '') === normalizedEmail) {
      return {
        field: 'vendor_email',
        selector: 'f-vendor-email',
        message: 'Email already exists in Vendor Directory.'
      };
    }
  }

  return null;
}

async function openVendorModal() {
  resetVendorForm();
  clearProcurementFieldMessages();
  syncVendorModalMode();
  renderCompanyOptions('f-vendor-company', 'No company selected');
  bindVendorTinMask();
  openBackdrop('vendor-modal-backdrop');
  loadVendorNumberPreview();
}

function closeVendorModal() {
  vendorNumberPreviewToken += 1;
  closeBackdrop('vendor-modal-backdrop');
  resetVendorForm();
  clearProcurementFieldMessages();
  syncVendorModalMode();
}

async function saveVendor() {
  const vendorTinInput = $('f-vendor-tin');
  const vendorTinDigits = normalizeTinDigits(vendorTinInput?.value || '');
  const vendorTin = formatTinValue(vendorTinDigits);
  let vendorNo = String($('f-vendor-no')?.value || '').trim();
  if (!vendorNo) {
    vendorNo = String(await loadVendorNumberPreview() || '').trim();
    const vendorNoInput = $('f-vendor-no');
    if (vendorNoInput) vendorNoInput.value = vendorNo;
  }

  if (String(vendorTinInput?.value || '').trim() && vendorTinDigits.length !== 12) {
    setProcurementFieldMessage('vendor_tin', 'TIN must follow 000-000-000-000 format.');
    focusFirstProcurementControl(['f-vendor-tin']);
    return;
  }

  const payload = {
    vendor_no: vendorNo,
    company_id: Number($('f-vendor-company')?.value || 0) || null,
    vendor_name: $('f-vendor-name').value.trim(),
    contact_person: $('f-vendor-contact').value.trim(),
    email: $('f-vendor-email').value.trim(),
    phone: normalizePhone($('f-vendor-phone')?.value || ''),
    address: $('f-vendor-address').value.trim(),
    tin: vendorTin || null,
    is_active: 1
  };

  if (!payload.vendor_name) {
    setProcurementFieldMessage('vendor_name', 'Vendor Name is required.');
    focusFirstProcurementControl(['f-vendor-name']);
    return;
  }

  const requiredChecks = [
    ['vendor_contact', payload.contact_person, 'Contact Person is required.', 'f-vendor-contact'],
    ['vendor_email', payload.email, 'Email is required.', 'f-vendor-email'],
    ['vendor_phone', payload.phone, 'Phone is required.', 'f-vendor-phone'],
    ['vendor_tin', String($('f-vendor-tin')?.value || '').trim(), 'TIN is required.', 'f-vendor-tin'],
    ['vendor_address', payload.address, 'Address is required.', 'f-vendor-address']
  ];

  let firstRequiredField = null;
  for (const [fieldName, value, message, focusId] of requiredChecks) {
    if (!String(value || '').trim()) {
      setProcurementFieldMessage(fieldName, message);
      if (!firstRequiredField) firstRequiredField = focusId;
    }
  }

  const emailValue = String(payload.email || '').trim();
  if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
    setProcurementFieldMessage('vendor_email', 'Please enter a valid email address.');
    if (!firstRequiredField) firstRequiredField = 'f-vendor-email';
  }

  if (payload.phone && typeof isValidPhoneForField === 'function' && !isValidPhoneForField('f-vendor-phone', payload.phone)) {
    setProcurementFieldMessage('vendor_phone', getPhoneValidationMessage('f-vendor-phone', 'Phone'));
    if (!firstRequiredField) firstRequiredField = 'f-vendor-phone';
  }

  if (firstRequiredField) {
    focusFirstProcurementControl([firstRequiredField]);
    return;
  }

  const duplicate = findDuplicateVendorEntry(payload.phone, payload.tin, payload.email);
  if (duplicate) {
    setProcurementFieldMessage(duplicate.field, duplicate.message);
    focusFirstProcurementControl([duplicate.selector]);
    showToast(duplicate.message, 'error');
    return;
  }

  procurementLoadVersion += 1;
  procurementToolbarState.vendors.search = '';
  const vendorSearch = $('vendor-search');
  if (vendorSearch) vendorSearch.value = '';

  const tempVendorId = `temp-vendor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const selectedCompany = procurementState.companies.find((company) => Number(company.id || 0) === Number(payload.company_id || 0)) || null;
  const optimisticVendor = {
    ...payload,
    id: tempVendorId,
    is_active: 1,
    company_no: selectedCompany?.company_no || '',
    company_name: selectedCompany?.company_name || ''
  };
  procurementState.vendors = [
    optimisticVendor,
    ...procurementState.vendors.filter((entry) => String(entry.id) !== tempVendorId)
  ];
  prependVendorDirectoryRow(optimisticVendor);
  renderVendorDirectory();
  renderVendorOptions();
  closeVendorModal();
  switchProcTab('vendors', getProcurementTabButton('vendors'));
  setTimeout(() => focusVendorDirectoryTopRow(), 80);

  try {
    const result = await apiFetch('/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    showToast('Vendor created successfully!', 'success');
    if (result?.id) {
      const createdVendor = {
        ...payload,
        vendor_no: String(result.vendor_no || payload.vendor_no || '').trim(),
        id: Number(result.id),
        company_id: Number(result.company_id || payload.company_id || 0) || null,
        company_no: selectedCompany?.company_no || '',
        company_name: selectedCompany?.company_name || '',
        is_active: Number(result.is_active ?? payload.is_active ?? 1) ? 1 : 0
      };
      procurementState.vendors = [
        createdVendor,
        ...procurementState.vendors.filter((entry) => String(entry.id) !== tempVendorId && Number(entry.id) !== Number(createdVendor.id))
      ];
      switchProcTab('vendors', getProcurementTabButton('vendors'));
      renderVendorDirectory();
      renderVendorOptions();
      if (typeof loadVendors === 'function') loadVendors();
      setTimeout(() => focusVendorDirectoryTopRow(), 80);
    }
  } catch (err) {
    procurementState.vendors = procurementState.vendors.filter((entry) => String(entry.id) !== tempVendorId);
    const tempRow = $('vendor-body')?.querySelector(`tr[data-vendor-id="${tempVendorId}"]`);
    if (tempRow) tempRow.remove();
    renderVendorDirectory();
    renderVendorOptions();
    const errorText = String(err?.message || '').toLowerCase();
    if (err?.field === 'tin') {
      setProcurementFieldMessage('vendor_tin', err.message || 'TIN must follow 000-000-000-000 format.');
      focusFirstProcurementControl(['f-vendor-tin']);
      return;
    }
    if (err?.field === 'vendor_contact') {
      setProcurementFieldMessage('vendor_contact', err.message || 'Contact Person is required.');
      focusFirstProcurementControl(['f-vendor-contact']);
      return;
    }
    if (err?.field === 'vendor_phone') {
      setProcurementFieldMessage('vendor_phone', err.message || 'Vendor phone already exists in Vendor Directory.');
      focusFirstProcurementControl(['f-vendor-phone']);
      return;
    }
    if (err?.field === 'vendor_email' || err?.field === 'email') {
      setProcurementFieldMessage('vendor_email', err.message || 'Email already exists in Vendor Directory.');
      focusFirstProcurementControl(['f-vendor-email']);
      return;
    }
    if (err?.field === 'vendor_address') {
      setProcurementFieldMessage('vendor_address', err.message || 'Address is required.');
      focusFirstProcurementControl(['f-vendor-address']);
      return;
    }
    if (err?.field === 'company_id' || err?.field === 'vendor_company') {
      setProcurementFieldMessage('vendor_company', err.message || 'Selected company was not found.');
      focusFirstProcurementControl(['f-vendor-company']);
      return;
    }
    if (err?.field === 'phone') {
      setProcurementFieldMessage('vendor_phone', err.message || 'Vendor phone already exists in Vendor Directory.');
      focusFirstProcurementControl(['f-vendor-phone']);
      return;
    }
    if (errorText.includes('duplicate') || errorText.includes('already exists')) {
      setProcurementFieldMessage('vendor_name', err.message || 'Vendor already exists.');
      focusFirstProcurementControl(['f-vendor-name']);
      return;
    }
    showToast(err.message || 'Unable to save vendor.', 'error');
  }
}

async function toggleVendorStatus(vendorId, nextActive) {
  const id = Number(vendorId || 0);
  if (!id) return;

  const vendor = procurementState.vendors.find((entry) => Number(entry.id) === id) || null;
  if (!vendor) {
    showToast('Vendor record not found.', 'error');
    return;
  }

  const active = Number(nextActive || 0) === 1;
  const confirmed = await openConfirmDialog({
    title: active ? 'Activate Vendor?' : 'Deactivate Vendor?',
    message: active
      ? `Activate ${vendor.vendor_no || 'this vendor'} (${vendor.vendor_name || 'Unnamed'})?`
      : `Deactivate ${vendor.vendor_no || 'this vendor'} (${vendor.vendor_name || 'Unnamed'})? This vendor will be hidden from PO selection until activated again.`,
    noText: 'No',
    yesText: active ? 'Activate' : 'Deactivate'
  });
  if (!confirmed) return;

  try {
    const result = await apiFetch(`/api/vendors/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: active ? 1 : 0 })
    });

    procurementState.vendors = procurementState.vendors.map((entry) => (
      Number(entry.id) === id
        ? { ...entry, is_active: active ? 1 : 0 }
        : entry
    ));

    renderVendorDirectory();
    renderVendorOptions();
    if (typeof loadVendors === 'function') loadVendors();

    showToast(result?.message || `Vendor ${active ? 'activated' : 'deactivated'} successfully!`, 'success');
  } catch (err) {
    showToast(err.message || 'Unable to update vendor status.', 'error');
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

  if (!vendorCanBeUsedForPurchaseOrder(vendor)) {
    if (hiddenInput) hiddenInput.value = '';
    if (searchInput) searchInput.value = '';
    setProcurementFieldMessage('vendor_id', 'Select another vendor. The issuing company cannot be its own supplier on this PO.');
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

function renderCompanyOptions(selectId = 'pr-company', emptyLabel = 'Select company') {
  const select = $(selectId);
  if (!select) return;
  const current = select.value;
  const selectedCompany = current
    ? procurementState.companies.find((company) => String(company.id || '') === String(current))
    : null;
  const rows = procurementState.companies;
  const visibleRows = selectedCompany && !rows.some((company) => String(company.id || '') === String(selectedCompany.id || ''))
    ? [selectedCompany, ...rows]
    : rows;
  select.innerHTML = [
    `<option value="">${escHtml(emptyLabel)}</option>`,
    ...visibleRows.map((company) => {
      const label = [company.company_no, company.company_name].filter(Boolean).join(' - ');
      return `<option value="${escHtml(company.id)}">${escHtml(label || company.company_name || 'Company')}</option>`;
    })
  ].join('');
  if (current) select.value = current;
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
        row.item_name
      ].filter(Boolean).join(' - ');
      return `<option value="${escHtml(row.id)}">${escHtml(label || row.pr_number || 'Requisition')}</option>`;
    })
  ].join('');
  if (current) select.value = current;
  if (pendingPurchaseOrderRequisitionId && !select.value) {
    select.value = String(pendingPurchaseOrderRequisitionId);
  }
}

function getDefaultProcurementBusinessEntityId() {
  const rows = Array.isArray(procurementState.businessEntities) ? procurementState.businessEntities : [];
  const defaultRow = rows.find(row => Number(row.is_default || 0) === 1) || rows[0] || null;
  return defaultRow ? String(defaultRow.id || '') : '';
}

function renderBusinessEntityOptions(selectId = 'po-business-entity', selectedValue = '') {
  const select = $(selectId);
  if (!select) return;
  const rows = Array.isArray(procurementState.businessEntities) ? procurementState.businessEntities : [];
  const currentEntity = typeof getCurrentBusinessEntityId === 'function' ? getCurrentBusinessEntityId() : '';
  const selected = String(selectedValue || currentEntity || getDefaultProcurementBusinessEntityId() || '').trim();
  select.innerHTML = rows.length
    ? rows.map(row => `<option value="${escHtml(row.id)}">${escHtml(row.company_name || row.entity_code || 'Operating Company')}</option>`).join('')
    : '<option value="">Default company</option>';
  if (selected && [...select.options].some(option => String(option.value) === selected)) {
    select.value = selected;
  } else if (rows.length) {
    select.value = getDefaultProcurementBusinessEntityId();
  }
}

function getCompanyIdFromRequisition(requisition) {
  if (!requisition) return 0;
  return Number(requisition.company_id || 0) || 0;
}

function getProcurementProjectById(projectId) {
  const id = Number(projectId || 0) || 0;
  if (!id) return null;
  return (Array.isArray(procurementState.projects) ? procurementState.projects : [])
    .find((project) => Number(project.id || 0) === id) || null;
}

function getProcurementProjectCompanyId(projectId) {
  const project = getProcurementProjectById(projectId);
  return Number(project?.company_id || project?.registry_company_id || 0) || 0;
}

function getProcurementProjectLabel(projectId) {
  const project = getProcurementProjectById(projectId);
  if (!project) return projectId ? `Project #${projectId}` : '';
  return [
    project.project_docno || project.source_docno || `Project #${project.id}`,
    project.project_name
  ].filter(Boolean).join(' - ');
}

function renderPurchaseOrderProjectOptions(selectedValue = currentPurchaseOrderProjectId) {
  const select = $('po-project');
  if (!select) return;

  const selected = String(selectedValue || '').trim();
  const rows = Array.isArray(procurementState.projects) ? procurementState.projects : [];
  select.innerHTML = [
    '<option value="">No linked project</option>',
    ...rows.map((project) => {
      const id = String(project.id || '');
      const label = getProcurementProjectLabel(project.id);
      return `<option value="${escHtml(id)}">${escHtml(label)}</option>`;
    })
  ].join('');
  if (selected && [...select.options].some(option => String(option.value) === selected)) {
    select.value = selected;
  }
}

function updatePurchaseOrderCompanyFieldVisibility() {
  const companyField = $('po-company-field');
  if (!companyField) return;
  companyField.hidden = Boolean(currentPurchaseOrderProjectId);
}

function syncPurchaseOrderProjectContext(projectId = currentPurchaseOrderProjectId) {
  currentPurchaseOrderProjectId = Number(projectId || 0) || null;
  const field = $('po-project-context-field');
  const input = $('po-project-context');
  const companySelect = $('po-company');
  const companySearch = $('po-company-search');
  const projectSelect = $('po-project');

  const label = getProcurementProjectLabel(currentPurchaseOrderProjectId);
  if (field && input) {
    field.hidden = !currentPurchaseOrderProjectId;
    input.value = currentPurchaseOrderProjectId ? label : '';
  }
  if (projectSelect && String(projectSelect.value || '') !== String(currentPurchaseOrderProjectId || '')) {
    projectSelect.value = currentPurchaseOrderProjectId ? String(currentPurchaseOrderProjectId) : '';
  }

  const projectCompanyId = getProcurementProjectCompanyId(currentPurchaseOrderProjectId);
  if (currentPurchaseOrderProjectId && companySelect) {
    companySelect.value = projectCompanyId ? String(projectCompanyId) : '';
    if (companySearch) companySearch.value = '';
    setProcurementFieldMessage('company_id', '');
  }
  updatePurchaseOrderCompanyFieldVisibility();
}

function getRequisitionLineItems(requisition) {
  const items = Array.isArray(requisition?.line_items) ? requisition.line_items : [];
  if (items.length) {
    return items.map((item) => ({
      item_name: String(item.item_name || item.description || '').trim(),
      description: String(item.description || '').trim(),
      quantity: Number(item.quantity || 0),
      unit: String(item.unit || '').trim(),
      estimated_unit_price: Number(item.estimated_unit_price ?? item.unit_price ?? 0)
    })).filter((item) => item.item_name || item.description || item.quantity > 0 || item.estimated_unit_price > 0);
  }

  if (requisition?.item_name || requisition?.item_description) {
    return [{
      item_name: requisition.item_name || requisition.item_description || '',
      description: requisition.item_description || '',
      quantity: Number(requisition.quantity || 1) || 1,
      unit: requisition.unit || '',
      estimated_unit_price: Number(requisition.unit_price || 0) || 0
    }];
  }

  return [];
}

function applyPurchaseOrderRequisitionSelection(requisitionId = null) {
  const select = $('po-requisition');
  const companySelect = $('po-company');
  if (!select || !companySelect) return;

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
  if (!editingPurchaseOrderId && !requisitionIsApprovedForPurchaseOrder(requisition)) {
    setProcurementFieldMessage('requisition_id', 'Approve this requisition before converting it to a purchase order.');
    return;
  }

  setProcurementFieldMessage('requisition_id', '');
  const companyId = getCompanyIdFromRequisition(requisition);
  if (requisition.business_entity_id) {
    renderBusinessEntityOptions('po-business-entity', requisition.business_entity_id);
  }
  if (companyId) {
    companySelect.value = String(companyId);
    setProcurementFieldMessage('company_id', '');
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
    const requisitionItems = getRequisitionLineItems(requisition).map((item) => ({
      description: [item.item_name, item.description].filter(Boolean).join(' - '),
      quantity: Number(item.quantity || 1) || 1,
      unit_price: Number(item.estimated_unit_price || 0) || 0
    }));
    setPurchaseOrderLineItems(requisitionItems.length ? requisitionItems : [{}]);
  }
}

function renderPurchaseOrderOptions() {
  const select = $('grn-po');
  if (!select) return;
  const current = select.value;
  const approvedRows = procurementState.purchaseOrders.filter((row) => normalizeWorkflowStatus(row.status) === 'approved' || String(row.id) === String(current));
  select.innerHTML = [
    '<option value="">Select purchase order</option>',
    ...approvedRows.map((row) => `<option value="${escHtml(row.id)}">${escHtml(row.po_number)} - ${escHtml(row.vendor_name || '-')}</option>`)
  ].join('');
  if (current) select.value = current;
}

function getPurchaseOrderById(poId) {
  const id = Number(poId || 0) || 0;
  if (!id) return null;
  return (Array.isArray(procurementState.purchaseOrders) ? procurementState.purchaseOrders : [])
    .find((row) => Number(row.id || 0) === id) || null;
}

function getPurchaseOrderCompanyLabel(row) {
  if (!row) return '';
  const companyId = Number(row.company_id || 0) || 0;
  const company = companyId
    ? (Array.isArray(procurementState.companies) ? procurementState.companies : [])
      .find((entry) => Number(entry.id || 0) === companyId)
    : null;
  return String(row.company_name || company?.company_name || '').trim();
}

function getPurchaseOrderProjectLabel(row) {
  if (!row) return '';
  return getProcurementProjectLabel(Number(row.project_id || 0) || 0);
}

function syncGoodsReceiptFromPurchaseOrder() {
  const po = getPurchaseOrderById($('grn-po')?.value || 0);
  const vendorInput = $('grn-po-vendor-context');
  const companyInput = $('grn-po-company-context');
  const projectInput = $('grn-po-project-context');
  const amountInput = $('grn-po-amount-context');

  if (vendorInput) vendorInput.value = po ? String(po.vendor_name || '-') : '';
  if (companyInput) companyInput.value = po ? (getPurchaseOrderCompanyLabel(po) || '-') : '';
  if (projectInput) projectInput.value = po ? (getPurchaseOrderProjectLabel(po) || '-') : '';
  if (amountInput) amountInput.value = po ? money(po.computed_total || po.total_amount || 0) : '';

  if (po) {
    setProcurementFieldMessage('po_id', '');
  }
}

function getRequisitionLineItemsContainer() {
  return $('pr-line-items');
}

function formatRequisitionLineAmount(value) {
  return money(Number(value || 0));
}

function renderRequisitionLineItemRow(item = {}, index = 0) {
  const itemName = String(item.item_name || item.name || '').trim();
  const description = String(item.description || item.item_description || '').trim();
  const quantity = Number(item.quantity || item.qty || 1) > 0 ? Number(item.quantity || item.qty || 1) : 1;
  const unit = String(item.unit || '').trim();
  const unitPrice = Number(item.estimated_unit_price ?? item.unit_price ?? item.price ?? 0) || 0;
  const lineTotal = quantity * unitPrice;

  return `
    <div class="po-line-item" data-pr-line-item data-line-index="${index}">
      <div class="field full">
        <label>Item ${index + 1} Name</label>
        <input type="text" class="pr-line-item-name" placeholder="CCTV cameras" value="${escHtml(itemName)}" oninput="syncRequisitionLineItem(this)" />
      </div>
      <div class="field full">
        <label>Item ${index + 1} Description</label>
        <textarea class="pr-line-description" placeholder="Short description..." oninput="syncRequisitionLineItem(this)">${escHtml(description)}</textarea>
      </div>
      <div class="po-line-meta-grid">
        <div class="field">
          <label>Qty</label>
          <input type="number" class="pr-line-qty" min="1" step="1" value="${escHtml(quantity)}" oninput="syncRequisitionLineItem(this)" />
        </div>
        <div class="field">
          <label>Unit</label>
          <input type="text" class="pr-line-unit" placeholder="pcs" value="${escHtml(unit)}" oninput="syncRequisitionLineItem(this)" />
        </div>
        <div class="field">
          <label>Est. Unit Price</label>
          <input type="number" class="pr-line-unit-price" min="0" step="0.01" value="${unitPrice ? escHtml(unitPrice.toFixed(2)) : ''}" oninput="syncRequisitionLineItem(this)" />
        </div>
        <div class="field">
          <label>Line Total</label>
          <div class="po-line-total">${formatRequisitionLineAmount(lineTotal)}</div>
        </div>
        <div class="field po-line-action-field">
          <label>&nbsp;</label>
          <button class="btn btn-cancel btn-sm po-line-remove-btn" type="button" onclick="removeRequisitionLineItem(this)">Remove</button>
        </div>
      </div>
      <div class="modal-inline-message is-hidden" data-pr-line-message aria-live="polite"></div>
    </div>
  `;
}

function setRequisitionLineItems(items = []) {
  const container = getRequisitionLineItemsContainer();
  if (!container) return;

  const normalized = Array.isArray(items) ? items.filter((item) => item) : [];
  const rows = normalized.length ? normalized : [{}];
  container.innerHTML = rows.map((item, index) => renderRequisitionLineItemRow(item, index)).join('');
  recalculateRequisitionLineTotals();
}

function addRequisitionLineItem(item = {}) {
  const container = getRequisitionLineItemsContainer();
  if (!container) return;
  const index = container.querySelectorAll('[data-pr-line-item]').length;
  container.insertAdjacentHTML('beforeend', renderRequisitionLineItemRow(item, index));
  recalculateRequisitionLineTotals();

  const lastRow = container.querySelector('[data-pr-line-item]:last-child .pr-line-item-name');
  if (lastRow) lastRow.focus();
}

function removeRequisitionLineItem(button) {
  const row = button?.closest('[data-pr-line-item]');
  const container = getRequisitionLineItemsContainer();
  if (!row || !container) return;

  const rows = container.querySelectorAll('[data-pr-line-item]');
  if (rows.length <= 1) {
    row.querySelectorAll('input, textarea').forEach((input) => {
      input.value = input.classList.contains('pr-line-qty') ? '1' : '';
    });
    recalculateRequisitionLineTotals();
    return;
  }

  row.remove();
  renumberRequisitionLineItems();
  recalculateRequisitionLineTotals();
}

function renumberRequisitionLineItems() {
  const rows = Array.from(getRequisitionLineItemsContainer()?.querySelectorAll('[data-pr-line-item]') || []);
  rows.forEach((row, index) => {
    row.setAttribute('data-line-index', String(index));
    const nameLabel = row.querySelector('.field.full label');
    const descriptionLabel = row.querySelectorAll('.field.full label')[1];
    if (nameLabel) nameLabel.textContent = `Item ${index + 1} Name`;
    if (descriptionLabel) descriptionLabel.textContent = `Item ${index + 1} Description`;
  });
}

function syncRequisitionLineItem(source) {
  const row = source?.closest('[data-pr-line-item]');
  if (!row) return;
  setRequisitionLineItemMessage(row, '');
  setProcurementFieldMessage('pr_line_items', '');
  const qty = Number(row.querySelector('.pr-line-qty')?.value || 0);
  const unitPrice = Number(row.querySelector('.pr-line-unit-price')?.value || 0);
  const total = qty > 0 && unitPrice > 0 ? qty * unitPrice : 0;
  const totalNode = row.querySelector('.po-line-total');
  if (totalNode) totalNode.textContent = formatRequisitionLineAmount(total);
  recalculateRequisitionLineTotals();
}

function recalculateRequisitionLineTotals() {
  const rows = Array.from(getRequisitionLineItemsContainer()?.querySelectorAll('[data-pr-line-item]') || []);
  let total = 0;

  rows.forEach((row) => {
    const qty = Number(row.querySelector('.pr-line-qty')?.value || 0);
    const unitPrice = Number(row.querySelector('.pr-line-unit-price')?.value || 0);
    if (qty > 0 && unitPrice > 0) {
      total += qty * unitPrice;
    }
  });

  const totalEl = $('pr-total-display');
  if (totalEl) totalEl.textContent = `PHP ${total.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

function collectRequisitionLineItems() {
  const rows = Array.from(getRequisitionLineItemsContainer()?.querySelectorAll('[data-pr-line-item]') || []);
  const items = [];
  const incompleteRows = [];

  rows.forEach((row, index) => {
    const itemName = String(row.querySelector('.pr-line-item-name')?.value || '').trim();
    const description = String(row.querySelector('.pr-line-description')?.value || '').trim();
    const quantity = Number(row.querySelector('.pr-line-qty')?.value || 0);
    const unit = String(row.querySelector('.pr-line-unit')?.value || '').trim();
    const unitPrice = Number(row.querySelector('.pr-line-unit-price')?.value || 0);
    const hasAnyValue = itemName || description || quantity > 0 || unit || unitPrice > 0;
    if (!hasAnyValue) return;

    if (!itemName || quantity <= 0) {
      incompleteRows.push(index + 1);
      return;
    }

    items.push({
      item_name: itemName,
      description,
      quantity,
      unit,
      estimated_unit_price: unitPrice
    });
  });

  return { items, incompleteRows };
}

function renderRequisitionItemsCell(row) {
  const items = getRequisitionLineItems(row);
  if (!items.length) return escHtml(row.item_name || '-');

  return `
    <div class="po-item-list">
      ${items.map((item, index) => {
        const itemName = String(item.item_name || '-').trim() || '-';
        const description = String(item.description || '').trim();
        const qty = Number(item.quantity || 0);
        const unit = String(item.unit || '').trim();
        const unitPrice = Number(item.estimated_unit_price || 0);
        const lineTotal = qty * unitPrice;
        return `
          <div class="po-item-line">
            <div class="po-item-index">${index + 1}</div>
            <div class="po-item-copy">
              <div class="po-item-desc">${escHtml(itemName)}</div>
              <div class="po-item-meta">${escHtml([description, `${qty}${unit ? ` ${unit}` : ''} x ${money(unitPrice)} = ${money(lineTotal)}`].filter(Boolean).join(' | '))}</div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
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

  const entityFilter = typeof businessEntityMatches === 'function' ? businessEntityMatches : () => true;
  const rows = filteredRows(procurementState.requisitions.filter(entityFilter), $('procurement-search-input')?.value, [
    'pr_number',
    'company_name',
    'company_no',
    'department',
    'requested_by',
    'item_name',
    'item_summary',
    'status'
  ]);

  tbody.innerHTML = rows.length ? rows.map((row) => {
    const canUseInPo = requisitionIsApprovedForPurchaseOrder(row);
    const status = normalizeWorkflowStatus(row.status || 'draft');
    const isAdmin = userCanApproveProcurement();
    const canSubmit = ['draft'].includes(status);
    const canApprove = isAdmin && ['draft', 'submitted'].includes(status);
    const canCancel = isAdmin && !isFinalProcurementStatus(status);
    const useInPoButton = canUseInPo
      ? `<button class="btn btn-edit btn-sm" type="button" onclick="openPurchaseOrderModal(null, null, ${Number(row.id)})">Use in PO</button>`
      : '<button class="btn btn-edit btn-sm" type="button" disabled title="Approve this PR first">Use in PO</button>';
    const submitButton = canSubmit
      ? `<button class="btn btn-save btn-sm" type="button" onclick="submitRequisitionForApproval(${Number(row.id)})">Submit</button>`
      : '';
    const approveButton = canApprove
      ? `<button class="btn btn-save btn-sm" type="button" onclick="approveRequisition(${Number(row.id)})">Approve</button>`
      : '';
    const cancelButton = canCancel
      ? `<button class="btn btn-cancel btn-sm" type="button" onclick="cancelRequisition(${Number(row.id)})">Cancel</button>`
      : '';
    return `
      <tr>
        <td style="font-weight:600;color:var(--primary)">${escHtml(row.pr_number)}</td>
        <td>${escHtml([row.company_no, row.company_name].filter(Boolean).join(' - ') || '-')}</td>
        <td>${escHtml(dateText(row.request_date))}</td>
        <td>${escHtml(row.department || '-')}</td>
        <td>${escHtml(row.requested_by || '-')}</td>
        <td>${escHtml(dateText(row.needed_by))}</td>
        <td><span class="status-chip ${statusClass(row.status)}">${escHtml(row.status || 'draft')}</span></td>
        <td>${renderRequisitionItemsCell(row)}</td>
        <td class="text-right">${escHtml(Number(row.item_count || getRequisitionLineItems(row).length || 0))}</td>
        <td class="text-right" style="font-weight:600;">${escHtml(money(row.total_amount || 0))}</td>
        <td>
          <div class="erp-actions" style="justify-content:center;">
            ${submitButton}
            ${approveButton}
            ${useInPoButton}
            <button class="btn btn-edit btn-sm" type="button" onclick="openRequisitionModal(${Number(row.id)})">Edit</button>
            ${cancelButton}
            <button class="btn btn-cancel btn-sm" type="button" onclick="deleteRequisition(${Number(row.id)})">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('') : '<tr class="empty-row"><td colspan="11">No requisitions found.</td></tr>';
}

function renderPurchaseOrders() {
  const tbody = $('po-body');
  if (!tbody) return;

  const entityFilter = typeof businessEntityMatches === 'function' ? businessEntityMatches : () => true;
  const rows = filteredRows(procurementState.purchaseOrders.filter(entityFilter), $('procurement-search-input')?.value, [
    'po_number',
    'requisition_number',
    'vendor_name',
    'project_docno',
    'project_name',
    'payment_terms',
    'prepared_by',
    'approved_by',
    'item_summary',
    'status'
  ]);

  tbody.innerHTML = rows.length ? rows.map((row) => {
    const status = normalizeWorkflowStatus(row.status || 'draft');
    const isAdmin = userCanApproveProcurement();
    const canSubmit = ['draft'].includes(status);
    const canApprove = isAdmin && ['draft', 'pending'].includes(status);
    const canCancel = isAdmin && !isFinalProcurementStatus(status);
    const isApproved = status === 'approved';
    const canGenerateBills = isApproved && String(row.payment_terms || '').trim() && Number(row.bill_count || 0) === 0;
    const billAction = canGenerateBills
      ? `<button class="btn btn-save btn-sm" type="button" onclick="generatePurchaseOrderBills(${Number(row.id)})">Generate Bills</button>`
      : (Number(row.bill_count || 0) > 0 ? '<span class="pdf-empty">Bills generated</span>' : (!isApproved && String(row.payment_terms || '').trim() ? '<span class="pdf-empty">Approve before bills</span>' : ''));
    const submitButton = canSubmit
      ? `<button class="btn btn-save btn-sm" type="button" onclick="submitPurchaseOrderForApproval(${Number(row.id)})">Submit</button>`
      : '';
    const approveButton = canApprove
      ? `<button class="btn btn-save btn-sm" type="button" onclick="approvePurchaseOrder(${Number(row.id)})">Approve</button>`
      : '';
    const cancelButton = canCancel
      ? `<button class="btn btn-cancel btn-sm" type="button" onclick="cancelPurchaseOrder(${Number(row.id)})">Cancel</button>`
      : '';
    return `
      <tr>
        <td style="font-weight:600;color:var(--primary)">${escHtml(row.po_number)}</td>
        <td>${escHtml(row.requisition_number || '-')}</td>
        <td>${escHtml(row.vendor_name || '-')}</td>
        <td>${escHtml([row.project_docno, row.project_name].filter(Boolean).join(' - ') || '-')}</td>
        <td>${escHtml(dateText(row.po_date))}</td>
        <td>${escHtml(dateText(row.delivery_date))}</td>
        <td>${escHtml(row.payment_terms || '-')}</td>
        <td>${escHtml(row.prepared_by || '-')}</td>
        <td>${escHtml(row.approved_by || '-')}</td>
        <td><span class="status-chip ${statusClass(row.status)}">${escHtml(row.status || 'draft')}</span></td>
        <td style="min-width:300px;">${renderPurchaseOrderItemsCell(row)}</td>
        <td class="text-right"><span class="po-line-count">${escHtml(Number(row.line_count || row.line_items?.length || 0))}</span></td>
        <td class="text-right">${escHtml(money(row.computed_total || row.total_amount || 0))}</td>
        <td>
          <div class="erp-actions" style="justify-content:center;">
            ${submitButton}
            ${approveButton}
            ${billAction}
            <button class="btn btn-edit btn-sm" type="button" onclick="openPurchaseOrderModal(${Number(row.id)})">Edit</button>
            ${cancelButton}
            <button class="btn btn-cancel btn-sm" type="button" onclick="deletePurchaseOrder(${Number(row.id)})">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('') : '<tr class="empty-row"><td colspan="14">No purchase orders found.</td></tr>';
}

function renderGoodsReceipts() {
  const tbody = $('grn-body');
  if (!tbody) return;

  const entityFilter = typeof businessEntityMatches === 'function' ? businessEntityMatches : () => true;
  const rows = filteredRows(procurementState.goodsReceipts.filter(entityFilter), $('procurement-search-input')?.value, [
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
  ['pr-number', 'pr-department', 'pr-requested-by', 'pr-notes'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });
  if ($('pr-company')) $('pr-company').value = '';
  const dateDefaults = {
    'pr-request-date': new Date().toISOString().slice(0, 10),
    'pr-needed-by': new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    'pr-status': 'draft'
  };
  Object.entries(dateDefaults).forEach(([id, value]) => {
    const el = $(id);
    if (el) el.value = value;
  });
  setRequisitionLineItems([{}]);
  clearProcurementFieldMessages();
  clearRequisitionLineItemMessages();
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
    $('pr-department').value = row.department || '';
    $('pr-requested-by').value = row.requested_by || '';
    $('pr-needed-by').value = dateInputValue(row.needed_by);
    $('pr-status').value = row.status || 'draft';
    setRequisitionLineItems(getRequisitionLineItems(row));
    $('pr-notes').value = row.notes || '';
  } else {
    void loadRequisitionNumberPreview();
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
  clearRequisitionLineItemMessages();
  const { items, incompleteRows } = collectRequisitionLineItems();
  const companyId = Number($('pr-company').value || 0) || 0;
  const payload = {
    pr_number: $('pr-number').value.trim(),
    business_entity_id: (typeof getCurrentBusinessEntityId === 'function' ? getCurrentBusinessEntityId() : '') || getDefaultProcurementBusinessEntityId() || '',
    company_id: companyId,
    request_date: $('pr-request-date').value,
    department: $('pr-department').value.trim(),
    requested_by: $('pr-requested-by').value.trim(),
    needed_by: $('pr-needed-by').value,
    status: $('pr-status').value,
    items,
    notes: $('pr-notes').value.trim()
  };

  let hasValidationError = false;
  let firstInvalidField = null;
  const markError = (fieldName, message) => {
    setProcurementFieldMessage(fieldName, message);
    if (!firstInvalidField) firstInvalidField = fieldName;
    hasValidationError = true;
  };

  if (!payload.items.length) markError('pr_line_items', 'At least one requested item is required.');
  if (incompleteRows.length) markError('pr_line_items', `Complete item name and qty for line ${incompleteRows[0]}.`);
  if (!payload.company_id) markError('company_id', 'Company selection is required.');
  if (!payload.request_date) markError('request_date', 'Request Date is required.');

  if (hasValidationError) {
    if (firstInvalidField === 'pr_line_items') {
      focusFirstInvalidRequisitionLineItem();
      return;
    }
    focusFirstProcurementField(firstInvalidField, {
      company_id: ['pr-company'],
      request_date: ['pr-request-date']
    });
    return;
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
    const errorText = String(err?.message || '').toLowerCase();
    if (errorText.includes('duplicate') || errorText.includes('already exists')) {
      setProcurementFieldMessage('pr_number', err.message || 'PR No. already exists.');
      focusFirstProcurementControl(['pr-number']);
      return;
    }
    if (errorText.includes('company')) {
      setProcurementFieldMessage('company_id', err.message || 'Company selection is required.');
      focusFirstProcurementControl(['pr-company']);
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

async function submitRequisitionForApproval(id) {
  const row = procurementState.requisitions.find((entry) => Number(entry.id) === Number(id));
  const confirmed = await openConfirmDialog({
    title: 'Submit Requisition',
    message: `Submit ${row?.pr_number || 'this requisition'} for approval?`,
    noText: 'No',
    yesText: 'Submit'
  });
  if (!confirmed) return;

  try {
    await apiFetch(`/api/procurement/requisitions/${id}/submit`, { method: 'POST' });
    showToast('Requisition submitted for approval.', 'success');
    await loadProcurementData();
  } catch (err) {
    showToast(err.message || 'Unable to submit requisition.', 'error');
  }
}

async function approveRequisition(id) {
  const row = procurementState.requisitions.find((entry) => Number(entry.id) === Number(id));
  const confirmed = await openConfirmDialog({
    title: 'Approve Requisition',
    message: `Approve ${row?.pr_number || 'this requisition'}? It can be converted into a purchase order after approval.`,
    noText: 'No',
    yesText: 'Approve'
  });
  if (!confirmed) return;

  try {
    await apiFetch(`/api/procurement/requisitions/${id}/approve`, { method: 'POST' });
    showToast('Requisition approved.', 'success');
    await loadProcurementData();
  } catch (err) {
    showToast(err.message || 'Unable to approve requisition.', 'error');
  }
}

async function cancelRequisition(id) {
  const row = procurementState.requisitions.find((entry) => Number(entry.id) === Number(id));
  const confirmed = await openConfirmDialog({
    title: 'Cancel Requisition',
    message: `Cancel ${row?.pr_number || 'this requisition'}?`,
    noText: 'No',
    yesText: 'Cancel'
  });
  if (!confirmed) return;

  try {
    await apiFetch(`/api/procurement/requisitions/${id}/cancel`, { method: 'POST' });
    showToast('Requisition cancelled.', 'success');
    await loadProcurementData();
  } catch (err) {
    showToast(err.message || 'Unable to cancel requisition.', 'error');
  }
}

function resetPurchaseOrderForm() {
  currentPurchaseOrderProjectId = null;
  syncPurchaseOrderProjectContext(null);
  ['po-number', 'po-payment-terms', 'po-prepared-by', 'po-approved-by', 'po-notes'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });
  if ($('po-requisition')) $('po-requisition').value = '';
  renderBusinessEntityOptions('po-business-entity');
  renderPurchaseOrderProjectOptions('');
  if ($('po-company')) $('po-company').value = '';
  if ($('po-company-search')) $('po-company-search').value = '';
  if ($('po-vendor')) $('po-vendor').value = '';
  if ($('po-vendor-search')) $('po-vendor-search').value = '';
  if ($('po-status')) $('po-status').value = 'draft';
  if ($('po-date')) $('po-date').value = new Date().toISOString().slice(0, 10);
  if ($('po-delivery')) $('po-delivery').value = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  setPurchaseOrderLineItems([]);
  clearPurchaseOrderLineItemMessages();
  recalculatePurchaseOrderLineTotals();
  clearProcurementFieldMessages();
  updatePurchaseOrderCompanyFieldVisibility();
}

function syncPurchaseOrderModalMode() {
  const title = $('po-modal-title');
  const saveBtn = $('po-save-btn');
  if (title) title.textContent = editingPurchaseOrderId ? 'Edit Purchase Order' : 'Add Purchase Order';
  if (saveBtn) saveBtn.textContent = editingPurchaseOrderId ? 'Save Changes' : 'Create Purchase Order';
}

function openPurchaseOrderModal(id = null, vendorId = null, requisitionId = null, options = {}) {
  editingPurchaseOrderId = id ? Number(id) : null;
  const preselectedCompanyId = Number(options?.companyId || 0) || 0;
  const sourceProjectId = Number(options?.projectId || 0) || 0;
  resetPurchaseOrderForm();
  syncPurchaseOrderProjectContext(sourceProjectId || null);
  clearProcurementFieldMessages();
  renderCompanyOptions();
  renderCompanyOptions('po-company');
  renderBusinessEntityOptions('po-business-entity');
  renderPurchaseOrderProjectOptions(sourceProjectId || '');
  renderVendorOptions();
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
    renderBusinessEntityOptions('po-business-entity', row.business_entity_id || '');
    $('po-requisition').value = row.requisition_id || '';
    $('po-company').value = Number(row.company_id || 0) || '';
    syncPurchaseOrderProjectContext(Number(row.project_id || 0) || null);
    applyPurchaseOrderVendorSelection(row.vendor_id);
    $('po-date').value = dateInputValue(row.po_date);
    $('po-delivery').value = dateInputValue(row.delivery_date);
    $('po-payment-terms').value = row.payment_terms || '';
    $('po-prepared-by').value = row.prepared_by || '';
    $('po-approved-by').value = row.approved_by || '';
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
  } else {
    void loadPurchaseOrderNumberPreview();
  }
  if (!editingPurchaseOrderId && requisitionId) {
    const requisition = procurementState.requisitions.find((entry) => Number(entry.id) === Number(requisitionId)) || null;
    if (!requisitionIsApprovedForPurchaseOrder(requisition)) {
      showToast('Approve the requisition before converting it to a purchase order.', 'error');
      return;
    }
    applyPurchaseOrderRequisitionSelection(requisitionId);
  }
  const projectCompanyId = getProcurementProjectCompanyId(currentPurchaseOrderProjectId);
  const resolvedCompanyId = projectCompanyId || preselectedCompanyId;
  if (!editingPurchaseOrderId && !requisitionId && resolvedCompanyId && $('po-company')) {
    const companyExists = procurementState.companies.some((company) => Number(company.id || 0) === resolvedCompanyId);
    if (companyExists) {
      $('po-company').value = String(resolvedCompanyId);
    }
  }
  updatePurchaseOrderCompanyFieldVisibility();
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
  const vendorId = Number($('po-vendor').value || 0) || 0;
  const selectedVendor = procurementState.vendors.find((entry) => Number(entry.id || 0) === vendorId) || null;
  const businessEntityId = (typeof getCurrentBusinessEntityId === 'function' ? getCurrentBusinessEntityId() : '') || getDefaultProcurementBusinessEntityId() || '';
  const businessEntitySelect = $('po-business-entity');
  if (businessEntitySelect) businessEntitySelect.value = businessEntityId;
  syncPurchaseOrderProjectContext($('po-project')?.value || currentPurchaseOrderProjectId || '');
  const requisitionCompanyId = getCompanyIdFromRequisition(requisitionRow);
  const projectCompanyId = getProcurementProjectCompanyId(currentPurchaseOrderProjectId);
  const selectedCompanyId = currentPurchaseOrderProjectId ? 0 : (Number($('po-company').value || 0) || 0);
  const companyId = projectCompanyId || selectedCompanyId || requisitionCompanyId || 0;
  if (!selectedCompanyId && companyId && $('po-company')) {
    $('po-company').value = String(companyId);
  }
  const payload = {
    po_number: editingPurchaseOrderId ? $('po-number').value.trim() : '',
    requisition_id: requisitionId || null,
    business_entity_id: businessEntityId,
    vendor_id: vendorId,
    po_date: $('po-date').value,
    delivery_date: $('po-delivery').value,
    payment_terms: $('po-payment-terms').value.trim(),
    prepared_by: $('po-prepared-by').value.trim(),
    approved_by: $('po-approved-by').value.trim(),
    status: $('po-status').value,
    notes: $('po-notes').value.trim(),
    company_id: companyId,
    project_id: currentPurchaseOrderProjectId || null,
    items: collected.items
  };

  let hasValidationError = false;
  let firstInvalidField = null;
  const markError = (fieldName, message) => {
    setProcurementFieldMessage(fieldName, message);
    if (!firstInvalidField) firstInvalidField = fieldName;
    hasValidationError = true;
  };

  if (!payload.vendor_id) markError('vendor_id', 'Vendor selection is required.');
  if (selectedVendor && !vendorCanBeUsedForPurchaseOrder(selectedVendor)) {
    markError('vendor_id', 'Select another vendor. The issuing company cannot be its own supplier on this PO.');
  }
  if (!payload.po_date) markError('po_date', 'PO Date is required.');
  if (requisitionId && !requisitionRow) markError('requisition_id', 'Selected requisition was not found.');
  if (!editingPurchaseOrderId && requisitionId && requisitionRow && !requisitionIsApprovedForPurchaseOrder(requisitionRow)) {
    markError('requisition_id', 'Approve this requisition before converting it to a purchase order.');
  }

  if (requisitionId && requisitionCompanyId && companyId && requisitionCompanyId !== companyId) {
    markError('requisition_id', 'Selected requisition must belong to the same company.');
  }
  if (currentPurchaseOrderProjectId && projectCompanyId && companyId && projectCompanyId !== companyId) {
    markError('company_id', 'Selected project belongs to a different company.');
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

  if (hasValidationError) {
    focusFirstProcurementField(firstInvalidField, {
      company_id: ['po-company'],
      project_id: ['po-project'],
      vendor_id: ['po-vendor-search'],
      po_date: ['po-date'],
      requisition_id: ['po-requisition'],
      line_items: ['po-line-items']
    });
    if (firstInvalidField === 'line_items') {
      focusFirstInvalidPurchaseOrderLineItem();
    }
    return;
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
    const errorText = String(err?.message || '').toLowerCase();
    if (errorText.includes('duplicate') || errorText.includes('already exists')) {
      setProcurementFieldMessage('po_number', err.message || 'PO No. already exists.');
      focusFirstProcurementControl(['po-number']);
      return;
    }
    if (errorText.includes('company')) {
      setProcurementFieldMessage('company_id', err.message || 'Company selection is required.');
      focusFirstProcurementControl(['po-company']);
      return;
    }
    if (errorText.includes('requisition')) {
      setProcurementFieldMessage('requisition_id', err.message || 'Selected requisition is not valid for this company.');
      focusFirstProcurementControl(['po-requisition']);
      return;
    }
    if (errorText.includes('vendor')) {
      setProcurementFieldMessage('vendor_id', err.message || 'Vendor selection is required.');
      focusFirstProcurementControl(['po-vendor-search']);
      return;
    }
    if (errorText.includes('date')) {
      setProcurementFieldMessage('po_date', err.message || 'PO Date is required.');
      focusFirstProcurementControl(['po-date']);
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

async function submitPurchaseOrderForApproval(id) {
  const row = procurementState.purchaseOrders.find((entry) => Number(entry.id) === Number(id));
  const confirmed = await openConfirmDialog({
    title: 'Submit Purchase Order',
    message: `Submit ${row?.po_number || 'this purchase order'} for approval?`,
    noText: 'No',
    yesText: 'Submit'
  });
  if (!confirmed) return;

  try {
    await apiFetch(`/api/procurement/purchase-orders/${id}/submit`, { method: 'POST' });
    showToast('Purchase order submitted for approval.', 'success');
    await loadProcurementData();
  } catch (err) {
    showToast(err.message || 'Unable to submit purchase order.', 'error');
  }
}

async function approvePurchaseOrder(id) {
  const row = procurementState.purchaseOrders.find((entry) => Number(entry.id) === Number(id));
  const confirmed = await openConfirmDialog({
    title: 'Approve Purchase Order',
    message: `Approve ${row?.po_number || 'this purchase order'}? Approved POs can be received and used to generate AP bills.`,
    noText: 'No',
    yesText: 'Approve'
  });
  if (!confirmed) return;

  try {
    await apiFetch(`/api/procurement/purchase-orders/${id}/approve`, { method: 'POST' });
    showToast('Purchase order approved.', 'success');
    await loadProcurementData();
  } catch (err) {
    showToast(err.message || 'Unable to approve purchase order.', 'error');
  }
}

async function cancelPurchaseOrder(id) {
  const row = procurementState.purchaseOrders.find((entry) => Number(entry.id) === Number(id));
  const confirmed = await openConfirmDialog({
    title: 'Cancel Purchase Order',
    message: `Cancel ${row?.po_number || 'this purchase order'}?`,
    noText: 'No',
    yesText: 'Cancel'
  });
  if (!confirmed) return;

  try {
    await apiFetch(`/api/procurement/purchase-orders/${id}/cancel`, { method: 'POST' });
    showToast('Purchase order cancelled.', 'success');
    await loadProcurementData();
  } catch (err) {
    showToast(err.message || 'Unable to cancel purchase order.', 'error');
  }
}

async function generatePurchaseOrderBills(id) {
  const row = procurementState.purchaseOrders.find((entry) => Number(entry.id) === Number(id));
  const confirmed = await openConfirmDialog({
    title: 'Generate AP Bills',
    message: `Generate AP bill schedule from ${row?.po_number || 'this PO'} payment terms? These will be unpaid bills, not payments.`,
    noText: 'No',
    yesText: 'Generate'
  });
  if (!confirmed) return;

  try {
    const result = await apiFetch(`/api/procurement/purchase-orders/${id}/generate-bills`, {
      method: 'POST'
    });
    const bills = Array.isArray(result?.bills) ? result.bills : [];
    const total = bills.reduce((sum, bill) => sum + Number(bill.amount || 0), 0);
    showToast(`Generated ${bills.length} AP bill(s): ${money(total)} total.`, 'success');
    await loadProcurementData();
    if (typeof loadPurchaseOrdersForBills === 'function') loadPurchaseOrdersForBills();
    if (typeof loadBills === 'function') loadBills();
  } catch (err) {
    showToast(err.message || 'Unable to generate AP bills from PO.', 'error');
  }
}

function resetGoodsReceiptForm() {
  ['grn-number', 'grn-received-by', 'grn-notes'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });
  if ($('grn-po')) $('grn-po').value = '';
  ['grn-po-vendor-context', 'grn-po-company-context', 'grn-po-project-context', 'grn-po-amount-context'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });
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
    syncGoodsReceiptFromPurchaseOrder();
  } else {
    void loadGoodsReceiptNumberPreview();
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
  let firstInvalidField = null;
  const markError = (fieldName, message) => {
    setProcurementFieldMessage(fieldName, message);
    if (!firstInvalidField) firstInvalidField = fieldName;
    hasValidationError = true;
  };

  if (!payload.po_id) markError('po_id', 'PO No. is required.');
  if (!payload.received_date) markError('received_date', 'Received Date is required.');

  if (hasValidationError) {
    focusFirstProcurementField(firstInvalidField, {
      po_id: ['grn-po'],
      received_date: ['grn-received-date']
    });
    return;
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
    const errorText = String(err?.message || '').toLowerCase();
    if (errorText.includes('duplicate') || errorText.includes('already exists')) {
      setProcurementFieldMessage('grn_number', err.message || 'GRN No. already exists.');
      focusFirstProcurementControl(['grn-number']);
      return;
    }
    if (errorText.includes('po')) {
      setProcurementFieldMessage('po_id', err.message || 'PO No. is required.');
      focusFirstProcurementControl(['grn-po']);
      return;
    }
    if (errorText.includes('date')) {
      setProcurementFieldMessage('received_date', err.message || 'Received Date is required.');
      focusFirstProcurementControl(['grn-received-date']);
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

// Arrow-only vendor sort label override for the Vendor No. table header.
function getVendorSortLabel(order = vendorDirectorySortOrder) {
  return normalizeVendorSortOrder(order) === 'desc' ? '↓' : '↑';
}

function updateVendorSortButtonLabel() {
  const button = $('vendor-sort-btn');
  if (!button) return;
  const label = getVendorSortLabel();
  button.textContent = label;
  button.setAttribute('title', label === '↓' ? 'Sort descending' : 'Sort ascending');
  button.setAttribute('aria-label', label === '↓' ? 'Sort descending' : 'Sort ascending');
}
