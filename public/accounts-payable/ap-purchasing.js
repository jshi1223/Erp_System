'use strict';

const procurementState = {
  businessEntities: [],
  companies: [],
  projects: [],
  requisitions: [],
  quotations: [],
  purchaseOrders: [],
  goodsReceipts: [],
  vendors: [],
  products: [],
  warehouses: []
};

let procurementTab = 'vendors';
const PROCUREMENT_TAB_STORAGE_KEY = 'accounts-payable.procurement.activeTab';
let editingRequisitionId = null;
let editingPurchaseOrderId = null;
let editingGoodsReceiptId = null;
let editingQuotationId = null;
let editingVendorId = null;
let editingVendorRequestId = null;
let currentRequisitionProjectId = null;
let currentRequisitionPrType = 'project';
let viewingProjectLinkedRequisition = false;
let currentRequisitionReadOnlyReason = '';
let currentPurchaseOrderProjectId = null;
let currentPurchaseOrderQuotationId = null;
let purchaseOrderLineItemsLocked = false;
let pendingPurchaseOrderRequisitionId = null;
let vendorSearchBound = false;
let vendorNumberPreviewToken = 0;
let procurementLoadVersion = 0;
let pendingRequisitionCompanyId = null;
let pendingRequisitionProjectId = null;
let pendingPurchaseOrderCompanyId = null;
let pendingPurchaseOrderProjectId = null;
const generatingPurchaseOrderBillIds = new Set();
let activeDocumentContext = null;
const PROCUREMENT_VENDOR_SORT_STORAGE_KEY = 'kinaadman.procurement.vendorSort';
let vendorDirectorySortOrder = 'asc';
const procurementToolbarState = {
  requests: { search: '' },
  requisitions: { search: '' },
  rfq: { search: '' },
  quotations: { search: '' },
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
  if (['approved', 'received', 'selected'].includes(normalized)) return `status-${normalized === 'selected' ? 'approved' : normalized}`;
  if (['submitted', 'pending', 'ordered', 'draft', 'cancelled', 'rejected', 'needs_revision'].includes(normalized)) return `status-${normalized}`;
  return 'status-draft';
}

function requisitionIsApprovedForPurchaseOrder(requisition) {
  return String(requisition?.status || '').trim().toLowerCase() === 'approved';
}

function requisitionCanCreateRfq(requisition) {
  return String(requisition?.status || '').trim().toLowerCase() === 'approved';
}

function requisitionIsLockedForEditing(requisition) {
  const status = normalizeWorkflowStatus(requisition?.status || 'draft') || 'draft';
  return status !== 'draft';
}

function getRequisitionLockedReason(requisition) {
  const status = normalizeWorkflowStatus(requisition?.status || 'draft') || 'draft';
  if (status === 'submitted') return 'Submitted requisitions are locked and waiting for approval.';
  if (status === 'pending') return 'Pending requisitions are locked and waiting for approval.';
  if (status === 'approved') return 'Approved requisitions are locked. Create RFQ/PO from this request or cancel/revise through a controlled flow.';
  if (status === 'ordered') return 'This requisition is already converted to a purchase order.';
  if (status === 'received') return 'This requisition is already received and closed.';
  if (status === 'cancelled') return 'Cancelled requisitions are view-only.';
  if (status === 'rejected') return 'Rejected requisitions are view-only.';
  if (status !== 'draft') return 'Only draft requisitions can be edited.';
  return '';
}

function normalizeWorkflowStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function formatWorkflowStatusLabel(status) {
  const normalized = normalizeWorkflowStatus(status || 'draft');
  const labels = {
    draft: 'Draft',
    submitted: 'Submitted',
    pending: 'Pending Approval',
    needs_revision: 'Needs Revision',
    rejected: 'Needs Revision',
    approved: 'Approved',
    ordered: 'Ordered',
    received: 'Received',
    cancelled: 'Cancelled',
    awarded: 'Awarded'
  };
  return labels[normalized] || normalized.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function requisitionCanShowInPurchaseOrderSelect(requisition, selectedValue = '') {
  if (requisitionIsApprovedForPurchaseOrder(requisition)) return true;
  const selectedId = Number(selectedValue || 0) || 0;
  return Boolean(selectedId && Number(requisition?.id || 0) === selectedId);
}

function userCanApproveProcurement() {
  if (typeof isAdminUser === 'function') return Boolean(isAdminUser());
  const lexicalUser = typeof currentUser !== 'undefined' ? currentUser : null;
  const role = String(window.currentUser?.role || lexicalUser?.role || '').toLowerCase();
  return role === 'super_admin' || role === 'admin';
}

function isStaffProcurementWorkspace() {
  const path = (window.location.pathname || '').replace(/\/+$/, '');
  const role = String(
    document.body?.dataset?.accessRole ||
    document.documentElement?.dataset?.accessRole ||
    ''
  ).trim().toLowerCase();
  return path === '/procurement' && role === 'staff';
}

function isStaffMasterDataWorkspace() {
  const path = (window.location.pathname || '').replace(/\/+$/, '');
  const role = String(
    document.body?.dataset?.accessRole ||
    document.documentElement?.dataset?.accessRole ||
    ''
  ).trim().toLowerCase();
  return path === '/master-data' && role === 'staff';
}

function procurementRecordVisibleForCurrentUser(row = {}) {
  if (!userCanApproveProcurement()) return true;
  return !isProcurementRequestRow(row);
}

function syncProcurementStatusSelect(selectId, staffAllowed = ['draft'], { lockStaff = true } = {}) {
  const select = $(selectId);
  if (!select) return;
  const isAdmin = userCanApproveProcurement();
  Array.from(select.options || []).forEach((option) => {
    const value = normalizeWorkflowStatus(option.value);
    const allowed = isAdmin || staffAllowed.includes(value);
    option.hidden = !allowed;
    option.disabled = !allowed;
  });
  if (!isAdmin && !staffAllowed.includes(normalizeWorkflowStatus(select.value))) {
    select.disabled = true;
    return;
  }
  select.disabled = !isAdmin && Boolean(lockStaff);
}

function isFinalProcurementStatus(status) {
  return ['ordered', 'received', 'cancelled'].includes(normalizeWorkflowStatus(status));
}

function isArchivedProjectRow(row = {}) {
  return row.project_is_archived === true || Number(row.project_is_archived || 0) === 1;
}

function renderProcurementArchivedProjectBadge(row = {}) {
  return isArchivedProjectRow(row)
    ? '<div style="margin-top:4px;"><span class="status-chip status-cancelled">Archived Project</span></div>'
    : '';
}

function normalizeProcurementTab(value) {
  let tab = String(value || '').trim().toLowerCase();
  if (tab === 'bid-evaluation') tab = 'quotations';
  if (isStaffProcurementWorkspace()) return ['requests', 'requisitions'].includes(tab) ? tab : 'requests';
  const path = (window.location.pathname || '').replace(/\/+$/, '');
  const adminProcurementTabs = ['requisitions', 'rfq', 'quotations', 'purchase-orders', 'goods-receipts'];
  if (path === '/procurement') return adminProcurementTabs.includes(tab) ? tab : 'requisitions';
  return ['vendors', ...adminProcurementTabs].includes(tab) ? tab : 'vendors';
}

function getSavedProcurementTab() {
  if (isStaffProcurementWorkspace()) {
    try {
      return normalizeProcurementTab(window.localStorage.getItem(PROCUREMENT_TAB_STORAGE_KEY) || 'requests');
    } catch (_) {
      return 'requests';
    }
  }
  try {
    return normalizeProcurementTab(window.localStorage.getItem(PROCUREMENT_TAB_STORAGE_KEY));
  } catch (_) {
    return 'vendors';
  }
}

function saveProcurementTab(tab) {
  if (isStaffProcurementWorkspace() && !['requests', 'requisitions'].includes(normalizeProcurementTab(tab))) return;
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
    const endpoint = isStaffMasterDataWorkspace()
      ? '/api/vendor-registry-requests/next-draft-no'
      : '/api/vendors/next-no';
    const data = await apiFetch(endpoint, { cache: 'no-store' });
    if (token !== vendorNumberPreviewToken) return;
    const vendorNo = String(data?.draft_no || data?.vendor_no || '').trim();
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

async function loadProcurementNumberPreview(inputId, endpoint, responseKey, businessEntityIdOverride) {
  const input = $(inputId);
  if (!input) return '';
  input.value = '';
  try {
    const params = new URLSearchParams();
    const businessEntityId = String(businessEntityIdOverride || '').trim()
      || (typeof getCurrentBusinessEntityId === 'function' ? getCurrentBusinessEntityId() : '')
      || getDefaultProcurementBusinessEntityId() || '';
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
  // The operating company is a filter, not a default: the PR number comes from the selected
  // project's operating company (e.g. KITSI). With no project chosen there is no company context,
  // so leave the preview blank instead of falling back to the workspace/default entity.
  const projectId = currentRequisitionProjectId || Number($('pr-project')?.value || 0) || 0;
  const project = getProcurementProjectById(projectId);
  const projectEntityId = Number(project?.business_entity_id || 0) || 0;
  const input = $('pr-number');
  if (!projectEntityId) {
    if (input) input.value = '';
    return Promise.resolve('');
  }
  return loadProcurementNumberPreview('pr-number', '/api/procurement/requisitions/next-number', 'pr_number', projectEntityId);
}

function loadPurchaseOrderNumberPreview() {
  return loadProcurementNumberPreview('po-number', '/api/procurement/purchase-orders/next-number', 'po_number');
}

function loadGoodsReceiptNumberPreview() {
  return loadProcurementNumberPreview('grn-number', '/api/procurement/goods-receipts/next-number', 'grn_number');
}

function loadQuotationNumberPreview() {
  return loadProcurementNumberPreview('quote-number', '/api/procurement/quotations/next-number', 'quote_number');
}

function setRequisitionReadOnlyMode(readOnly, reason = '') {
  viewingProjectLinkedRequisition = Boolean(readOnly);
  currentRequisitionReadOnlyReason = viewingProjectLinkedRequisition ? String(reason || '').trim() : '';
  const modal = $('pr-modal-backdrop');
  if (!modal) return;
  modal.querySelectorAll('input, select, textarea').forEach((node) => {
    node.disabled = viewingProjectLinkedRequisition;
  });
  modal.querySelectorAll('#pr-line-items button, .po-line-add-row button').forEach((node) => {
    node.disabled = viewingProjectLinkedRequisition;
  });
  const saveBtn = $('pr-save-btn');
  if (saveBtn) {
    saveBtn.hidden = viewingProjectLinkedRequisition;
    saveBtn.disabled = viewingProjectLinkedRequisition;
  }
  const helper = modal.querySelector('[data-procurement-field-message="pr_readonly"]');
  if (helper) {
    helper.textContent = currentRequisitionReadOnlyReason;
    helper.classList.toggle('is-hidden', !currentRequisitionReadOnlyReason);
  }
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
    vendor_no: ['f-vendor-no'],
    company_id: ['pr-company', 'po-company'],
    request_date: ['pr-request-date'],
    requested_by: ['pr-requested-by'],
    needed_by: ['pr-needed-by'],
    pr_line_items: ['pr-line-items'],
    po_number: ['po-number'],
    requisition_id: ['po-source-rfq', 'po-requisition'],
    quotation_id: ['po-source-rfq'],
    project_id: ['pr-project', 'po-project'],
    vendor_id: ['po-vendor-search', 'po-vendor'],
    po_date: ['po-date'],
    line_items: ['po-line-items'],
    grn_number: ['grn-number'],
    quotation_number: ['quote-number'],
    po_id: ['grn-po'],
    received_date: ['grn-received-date'],
    vendor_name: ['f-vendor-name'],
    vendor_contact: ['f-vendor-contact'],
    vendor_email: ['f-vendor-email'],
    vendor_phone: ['f-vendor-phone'],
    vendor_tin: ['f-vendor-tin'],
    vendor_address: ['f-vendor-address']
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
  ['pr_number', 'vendor_no', 'company_id', 'request_date', 'pr_line_items', 'po_number', 'requisition_id', 'quotation_id', 'project_id', 'vendor_id', 'po_date', 'line_items', 'grn_number', 'quotation_number', 'po_id', 'received_date', 'vendor_name', 'vendor_contact', 'vendor_email', 'vendor_phone', 'vendor_tin', 'vendor_address'].forEach((fieldName) => {
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
  if (ids.length) return focusFirstProcurementControl(ids);
  return focusProcurementElement(getProcurementFieldNodes(fieldName)[0]);
}

function focusFirstInvalidPurchaseOrderLineItem() {
  const rows = Array.from(getPurchaseOrderLineItemsContainer()?.querySelectorAll('[data-po-line-item]') || []);
  const firstIncomplete = rows.find((row) => {
    return Boolean(
      !Number(row.querySelector('.po-line-product')?.value || 0) ||
      !String(row.querySelector('.po-line-description')?.value || '').trim() ||
      Number(row.querySelector('.po-line-qty')?.value || 0) <= 0 ||
      Number(row.querySelector('.po-line-unit-price')?.value || 0) <= 0
    );
  }) || rows[0] || null;
  if (!firstIncomplete) {
    return focusProcurementElement(document.querySelector('#po-modal-backdrop .po-line-toolbar .btn-add'));
  }
  return focusProcurementElement(
    firstIncomplete.querySelector('.po-line-product') ||
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
      !Number(row.querySelector('.pr-line-product')?.value || 0) ||
      Number(row.querySelector('.pr-line-qty')?.value || 0) <= 0
    );
  }) || rows[0] || null;
  if (!firstIncomplete) {
    return focusProcurementElement(document.querySelector('#pr-modal-backdrop .po-line-add-row .btn-add'));
  }
  return focusProcurementElement(
    firstIncomplete.querySelector('.pr-line-product') ||
    firstIncomplete.querySelector('.pr-line-qty') ||
    firstIncomplete
  );
}

function setupProcurementModalValidationListeners() {
  const bindings = [
    ['pr-number', 'pr_number', 'input'],
    ['f-vendor-no', 'vendor_no', 'input'],
    ['pr-company', 'company_id', 'change'],
    ['pr-request-date', 'request_date', 'change'],
    ['pr-requested-by', 'requested_by', 'input'],
    ['pr-needed-by', 'needed_by', 'change'],
    ['po-number', 'po_number', 'input'],
    ['po-company', 'company_id', 'change'],
    ['pr-project', 'project_id', 'change'],
    ['po-project', 'project_id', 'change'],
    ['po-requisition', 'requisition_id', 'change'],
    ['po-vendor-search', 'vendor_id', 'input'],
    ['po-date', 'po_date', 'change'],
    ['grn-number', 'grn_number', 'input'],
    ['quote-number', 'quotation_number', 'input'],
    ['grn-po', 'po_id', 'change'],
    ['grn-received-date', 'received_date', 'change'],
    ['f-vendor-name', 'vendor_name', 'input'],
    ['f-vendor-contact', 'vendor_contact', 'input'],
    ['f-vendor-email', 'vendor_email', 'input'],
    ['f-vendor-phone', 'vendor_phone', 'input'],
    ['f-vendor-phone-country', 'vendor_phone', 'change'],
    ['f-vendor-tin', 'vendor_tin', 'input'],
    ['f-vendor-address', 'vendor_address', 'input']
  ];

  bindings.forEach(([id, fieldName, eventName]) => {
    const node = document.getElementById(id);
    if (!node || node.dataset.procurementValidationBound === '1') return;
    node.dataset.procurementValidationBound = '1';
    node.addEventListener(eventName, () => {
      setProcurementFieldMessage(fieldName, '');
      if (id === 'grn-po') {
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
  const workspacePath = (window.location.pathname || '').replace(/\/+$/, '');
  const procurementWorkspace = workspacePath === '/procurement';
  const masterDataWorkspace = workspacePath === '/master-data';
  if (!integratedApPage && !$('procurement-page')) return;
  if (integratedApPage && !procurementWorkspace && !masterDataWorkspace) return;
  setDefaultDates();
  setupProcurementModalValidationListeners();
  bindVendorTinMask();
  wireBackdropClose();
  vendorDirectorySortOrder = getSavedVendorSortOrder();
  const params = new URLSearchParams(window.location.search);
  const masterDataRequestedTab = String(params.get('tab') || '').trim().toLowerCase();
  const masterDataVendorTab = masterDataWorkspace && masterDataRequestedTab === 'vendors';
  const requestedTab = normalizeProcurementTab(params.get('tab') || '');
  procurementTab = masterDataWorkspace ? (masterDataVendorTab ? 'vendors' : 'companies') : (params.has('tab') ? requestedTab : getSavedProcurementTab());
  if (!integratedApPage) {
    switchProcTab(procurementTab, getProcurementTabButton(procurementTab));
  }
  pendingPurchaseOrderRequisitionId = Number(params.get('requisition_id') || 0) || null;
  pendingRequisitionCompanyId = Number(params.get('company_id') || 0) || null;
  pendingRequisitionProjectId = Number(params.get('project_id') || 0) || null;
  pendingPurchaseOrderCompanyId = Number(params.get('company_id') || 0) || null;
  pendingPurchaseOrderProjectId = Number(params.get('project_id') || 0) || null;
  const openRequisition = String(params.get('action') || '').toLowerCase() === 'pr';
  const openPurchaseOrder = String(params.get('action') || '').toLowerCase() === 'po';
  loadProcurementData().then(() => {
    if (masterDataWorkspace) {
      if (masterDataVendorTab) {
        switchProcTab('vendors', getProcurementTabButton('vendors'));
      }
      return;
    }
    if (openRequisition) {
      const requestTab = isStaffProcurementWorkspace() ? 'requests' : 'requisitions';
      if (typeof window.switchApWorkspaceTab === 'function') {
        window.switchApWorkspaceTab(requestTab, getProcurementTabButton(requestTab));
      } else {
        switchProcTab(requestTab, getProcurementTabButton(requestTab));
      }
      openRequisitionModal(null, {
        companyId: pendingRequisitionCompanyId,
        projectId: pendingRequisitionProjectId
      });
      clearPurchaseOrderAutoOpenParams();
      pendingRequisitionCompanyId = null;
      pendingRequisitionProjectId = null;
    } else if (openPurchaseOrder) {
      if (typeof window.switchApWorkspaceTab === 'function') {
        window.switchApWorkspaceTab('purchase-orders', getProcurementTabButton('purchase-orders'));
      } else {
        switchProcTab('purchase-orders', getProcurementTabButton('purchase-orders'));
      }
      openPurchaseOrderModal(null, null, pendingPurchaseOrderRequisitionId, {
        companyId: pendingPurchaseOrderCompanyId,
        projectId: pendingPurchaseOrderProjectId
      });
      clearPurchaseOrderAutoOpenParams();
      pendingPurchaseOrderRequisitionId = null;
      pendingPurchaseOrderCompanyId = null;
      pendingPurchaseOrderProjectId = null;
    }
  });
}

function clearPurchaseOrderAutoOpenParams() {
  if (!window.history?.replaceState) return;
  const url = new URL(window.location.href);
  ['action', 'project_id', 'company_id', 'requisition_id'].forEach((key) => {
    url.searchParams.delete(key);
  });
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function setDefaultDates() {
  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const defaults = {
    'pr-request-date': today,
    'pr-needed-by': nextWeek,
    'quote-date': today,
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
  ['pr-modal-backdrop', 'quote-modal-backdrop', 'record-documents-modal-backdrop', 'po-modal-backdrop', 'grn-modal-backdrop', 'vendor-modal-backdrop'].forEach((id) => {
    const backdrop = $(id);
    if (!backdrop) return;
    backdrop.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        if (id === 'pr-modal-backdrop') closeRequisitionModal();
        if (id === 'quote-modal-backdrop') closeQuotationModal();
        if (id === 'record-documents-modal-backdrop') closeRecordDocumentsModal();
        if (id === 'po-modal-backdrop') closePurchaseOrderModal();
        if (id === 'grn-modal-backdrop') closeGoodsReceiptModal();
        if (id === 'vendor-modal-backdrop') closeVendorModal();
      }
    });
  });
}

function switchProcTab(tab, btn) {
  const nextTab = normalizeProcurementTab(tab);
  if (isStaffProcurementWorkspace() && !['requests', 'requisitions'].includes(nextTab)) {
    switchProcTab('requests', getProcurementTabButton('requests'));
    return;
  }
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
  if (nextTab === 'requests') renderProcurementRequests();
  if (nextTab === 'requisitions') renderRequisitions();
  if (nextTab === 'rfq') renderRfqWorkspace();
  if (nextTab === 'quotations') renderQuotations();
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
  if (tab === 'requests') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="procurement-search-input" type="text" placeholder="Search request no., company, item, or status..." value="${escHtml(state.search || '')}" oninput="renderProcurementRequests()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openRequisitionModal()">Request PR</button>
    `;
    return;
  }

  if (tab === 'requisitions') {
    const requestLabel = isStaffProcurementWorkspace() ? 'Request PR' : 'Add Requisition';
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="procurement-search-input" type="text" placeholder="Search PR no., company, item, or status..." value="${escHtml(state.search || '')}" oninput="renderRequisitions()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openRequisitionModal()">${requestLabel}</button>
    `;
    return;
  }

  if (tab === 'vendors') {
    const vendorButtonLabel = isStaffMasterDataWorkspace() ? 'Request Vendor' : 'Add Vendor';
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="vendor-search" type="text" placeholder="Search vendor no., name, contact, email, or phone..." value="${escHtml(state.search || '')}" oninput="filterVendorDirectory()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openVendorModal()">${vendorButtonLabel}</button>
    `;
    return;
  }

  if (tab === 'purchase-orders') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="procurement-search-input" type="text" placeholder="Search PO no., vendor, project, item, or status..." value="${escHtml(state.search || '')}" oninput="renderPurchaseOrders()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="switchProcTab('quotations', getProcurementTabButton('quotations'))">Create from Approved RFQ</button>
    `;
    return;
  }

  if (tab === 'quotations') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="procurement-search-input" type="text" placeholder="Search quote, PR, vendor, terms, or status..." value="${escHtml(state.search || '')}" oninput="renderQuotations()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openQuotationModal()">Add Quotation</button>
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

  if (tab === 'rfq') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="procurement-search-input" type="text" placeholder="Search approved PR, company, project, or item..." value="${escHtml(state.search || '')}" oninput="renderRfqWorkspace()" />
      </div>
    `;
    return;
  }

  actions.innerHTML = '';
}

async function loadProcurementData() {
  const loadVersion = ++procurementLoadVersion;
  try {
    const companyQuery = new URLSearchParams({ include_archived: '1' });
    const [businessEntities, companies, projects, vendors, requisitions, quotations, purchaseOrders, goodsReceipts, products, warehouses] = await Promise.all([
      loadProcurementRows('/api/business-entities', 'business entities'),
      loadProcurementRows(`/api/company-registry?${companyQuery.toString()}`, 'companies'),
      loadProcurementRows('/api/projects?include_archived=1', 'projects'),
      loadProcurementRows('/api/vendors?include_inactive=1', 'vendors'),
      loadProcurementRows('/api/procurement/requisitions', 'requisitions'),
      loadProcurementRows('/api/procurement/quotations', 'quotations'),
      loadProcurementRows('/api/procurement/purchase-orders', 'purchase orders'),
      loadProcurementRows('/api/procurement/goods-receipts', 'goods receipts'),
      loadProcurementRows('/api/inventory/products', 'products'),
      loadProcurementRows('/api/inventory/warehouses', 'warehouses')
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
    procurementState.quotations = Array.isArray(quotations) ? quotations : [];
    procurementState.purchaseOrders = Array.isArray(purchaseOrders) ? purchaseOrders : [];
    procurementState.goodsReceipts = Array.isArray(goodsReceipts) ? goodsReceipts : [];
    procurementState.products = Array.isArray(products) ? products : [];
    procurementState.warehouses = Array.isArray(warehouses) ? warehouses : [];

    renderSummary();
    renderBusinessEntityOptions('po-business-entity');
    renderCompanyOptions();
    renderCompanyOptions('po-company');
    renderRequisitionProjectOptions();
    renderPurchaseOrderProjectOptions();
    renderVendorDirectory();
    renderVendorOptions();
    initVendorSearch();
    renderPurchaseOrderRequisitionOptions();
    renderPurchaseOrderOptions();
    renderProcurementRequests();
    renderRequisitions();
    renderRfqWorkspace();
    renderQuotations();
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
  const entityFilter = typeof businessEntityMatches === 'function' ? businessEntityMatches : procurementBusinessEntityMatches;
  const requisitionRows = procurementState.requisitions.filter(entityFilter).filter(procurementRecordVisibleForCurrentUser);
  const quotationRows = procurementState.quotations.filter(entityFilter).filter(procurementRecordVisibleForCurrentUser);
  const purchaseOrderRows = procurementState.purchaseOrders.filter(entityFilter).filter(procurementRecordVisibleForCurrentUser);
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
  set('metric-vendors-payable', new Set(purchaseOrderRows.map((row) => Number(row.vendor_id || 0)).filter(Boolean)).size);

  set('metric-pr-count', requisitionRows.length);
  set('metric-pr-approved', requisitionRows.filter((row) => statusIs(row, 'approved')).length);
  set('metric-pr-open', requisitionRows.filter((row) => !['cancelled', 'rejected', 'received'].includes(String(row.status || '').trim().toLowerCase())).length);
  set('metric-pr-total', money(requisitionTotal));
  set('metric-pr-this-month', requisitionRows.filter((row) => inCurrentMonth(row.created_at || row.request_date)).length);

  const approvedPrRows = requisitionRows.filter((row) => ['approved', 'ordered'].includes(normalizeWorkflowStatus(row.status)));
  const selectedQuoteRows = quotationRows.filter((row) => statusIs(row, 'selected'));
  const quoteVendorIds = new Set(quotationRows.map((row) => Number(row.vendor_id || 0)).filter(Boolean));

  set('metric-rfq-count', approvedPrRows.length);
  set('metric-rfq-open', approvedPrRows.filter((row) => !quotationRows.some((quote) => Number(quote.requisition_id || 0) === Number(row.id || 0))).length);
  set('metric-rfq-sent', quotationRows.length);
  set('metric-rfq-closed', selectedQuoteRows.length);
  set('metric-rfq-linked-pr', approvedPrRows.length);

  set('metric-quote-count', quotationRows.length);
  set('metric-quote-pending', quotationRows.filter((row) => ['draft', 'submitted'].includes(normalizeWorkflowStatus(row.status))).length);
  set('metric-quote-awarded', selectedQuoteRows.length);
  set('metric-quote-total', money(quotationRows.reduce((sum, row) => sum + Number(row.quoted_total || 0), 0)));
  set('metric-quote-vendors', quoteVendorIds.size);

  set('metric-bid-count', quotationRows.length);
  set('metric-bid-pending', quotationRows.filter((row) => !statusIs(row, 'selected')).length);
  set('metric-bid-approved', selectedQuoteRows.length);
  set('metric-bid-best-value', money(selectedQuoteRows.reduce((sum, row) => sum + Number(row.quoted_total || 0), 0)));
  set('metric-bid-linked-quotes', quotationRows.length);

  set('metric-po-count', purchaseOrderRows.length);
  set('metric-po-ordered', purchaseOrderRows.filter((row) => statusIs(row, 'approved')).length);
  set('metric-po-received', purchaseOrderRows.filter((row) => statusIs(row, 'received')).length);
  set('metric-po-total', money(purchaseOrderTotal));
  set('metric-po-open', purchaseOrderRows.filter((row) => !['cancelled', 'received'].includes(String(row.status || '').trim().toLowerCase())).length);

  set('metric-grn-count', goodsReceiptRows.length);
  set('metric-grn-received', goodsReceiptRows.filter((row) => statusIs(row, 'received')).length);
  set('metric-grn-linked-pos', linkedReceiptPoIds.size);
  set('metric-grn-this-month', goodsReceiptRows.filter((row) => inCurrentMonth(row.received_date)).length);
  set('metric-grn-pending', goodsReceiptRows.filter((row) => !statusIs(row, 'received')).length);
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
          <button class="btn btn-edit btn-sm" type="button" onclick="openVendorModal(${numericVendorId})">Edit</button>
          <button class="${statusActionClass}" type="button" onclick="toggleVendorStatus(${numericVendorId}, 0)">${statusActionLabel}</button>
        `
        : `
          <button class="btn btn-edit btn-sm" type="button" onclick="openVendorModal(${numericVendorId})">Edit</button>
          <button class="${statusActionClass}" type="button" onclick="toggleVendorStatus(${numericVendorId}, 1)">${statusActionLabel}</button>
        `
    );
  return `
    <tr data-vendor-id="${vendorId}">
      <td>
        <div style="font-weight:700;color:var(--primary)">${escHtml(vendor?.vendor_no || 'Pending')}</div>
      </td>
      <td>
        <div style="font-weight:600;color:var(--primary)">${escHtml(vendor?.vendor_name || '-')}</div>
        <div style="font-size:0.76rem;color:var(--text-muted);margin-top:2px;">${escHtml(vendor?.company_name || 'Shared vendor')} &middot; ${escHtml(vendor?.address || 'No address')}</div>
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
  editingVendorRequestId = null;
  ['f-vendor-no', 'f-vendor-name', 'f-vendor-contact', 'f-vendor-email', 'f-vendor-phone', 'f-vendor-address', 'f-vendor-tin'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });
  clearProcurementFieldMessages();
}

function syncVendorModalMode() {
  const title = $('vendor-modal-title');
  const saveBtn = $('vendor-save-btn');
  const staffRequest = isStaffMasterDataWorkspace();
  if (title) {
    title.textContent = staffRequest
      ? (editingVendorRequestId ? 'Edit Vendor Draft' : editingVendorId ? 'View Vendor' : 'Request Vendor')
      : (editingVendorId ? 'Edit Vendor' : 'Add Vendor');
  }
  if (saveBtn) {
    saveBtn.textContent = staffRequest
      ? (editingVendorRequestId ? 'Update Draft' : 'Save Draft')
      : (editingVendorId ? 'Save Changes' : 'Create Vendor');
  }
}

function openVendorRequestDraft(requestId) {
  const rows = Array.isArray(window.masterDataRequestsDb) ? window.masterDataRequestsDb : (typeof masterDataRequestsDb !== 'undefined' ? masterDataRequestsDb : []);
  const row = rows.find((entry) => Number(entry.id || 0) === Number(requestId || 0) && entry.request_type === 'vendor');
  if (!row || String(row.status || '').toLowerCase() !== 'draft') {
    showToast('Only draft vendor requests can be edited.', 'error');
    return;
  }
  editingVendorId = null;
  resetVendorForm();
  editingVendorRequestId = Number(row.id || 0);
  const payload = row.payload || {};
  if ($('f-vendor-no')) $('f-vendor-no').value = row.request_no || payload.vendor_no || '';
  if ($('f-vendor-name')) $('f-vendor-name').value = payload.vendor_name || '';
  if ($('f-vendor-contact')) $('f-vendor-contact').value = payload.contact_person || '';
  if ($('f-vendor-email')) $('f-vendor-email').value = payload.email || '';
  if ($('f-vendor-phone')) $('f-vendor-phone').value = payload.phone || '';
  if ($('f-vendor-tin')) $('f-vendor-tin').value = formatTinValue(payload.tin || '');
  if ($('f-vendor-address')) $('f-vendor-address').value = payload.address || '';
  clearProcurementFieldMessages();
  syncVendorModalMode();
  bindVendorTinMask();
  openBackdrop('vendor-modal-backdrop');
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

async function openVendorModal(id = null) {
  editingVendorId = id ? Number(id) : null;
  if (isStaffMasterDataWorkspace() && editingVendorId) {
    showToast('Staff can request new vendors only. Existing vendor changes need admin approval.', 'error');
    editingVendorId = null;
    return;
  }
  resetVendorForm();
  clearProcurementFieldMessages();
  syncVendorModalMode();
  bindVendorTinMask();
  openBackdrop('vendor-modal-backdrop');
  if (editingVendorId) {
    const vendor = procurementState.vendors.find((entry) => Number(entry.id) === editingVendorId);
    if (!vendor) {
      showToast('Vendor record not found.', 'error');
      editingVendorId = null;
      forceCloseVendorModal();
      syncVendorModalMode();
      return;
    }
    if ($('f-vendor-no')) $('f-vendor-no').value = vendor.vendor_no || '';
    if ($('f-vendor-name')) $('f-vendor-name').value = vendor.vendor_name || '';
    if ($('f-vendor-contact')) $('f-vendor-contact').value = vendor.contact_person || '';
    if ($('f-vendor-email')) $('f-vendor-email').value = vendor.email || '';
    if ($('f-vendor-phone')) $('f-vendor-phone').value = vendor.phone || '';
    if ($('f-vendor-tin')) $('f-vendor-tin').value = formatTinValue(vendor.tin || '');
    if ($('f-vendor-address')) $('f-vendor-address').value = vendor.address || '';
  } else {
    loadVendorNumberPreview();
  }
}

function closeVendorModal() {
  editingVendorId = null;
  editingVendorRequestId = null;
  vendorNumberPreviewToken += 1;
  forceCloseVendorModal();
  resetVendorForm();
  clearProcurementFieldMessages();
  syncVendorModalMode();
}

function forceCloseVendorModal() {
  const backdrop = $('vendor-modal-backdrop');
  if (backdrop) {
    backdrop.classList.remove('open');
    backdrop.hidden = true;
    backdrop.style.setProperty('display', 'none', 'important');
    backdrop.style.setProperty('visibility', 'hidden', 'important');
    backdrop.style.setProperty('opacity', '0', 'important');
    backdrop.style.setProperty('pointer-events', 'none', 'important');
    backdrop.setAttribute('aria-hidden', 'true');
  }
  document.body.style.overflow = '';
}

async function saveVendor() {
  const vendorTinInput = $('f-vendor-tin');
  const vendorTinDigits = normalizeTinDigits(vendorTinInput?.value || '');
  const vendorTin = formatTinValue(vendorTinDigits);
  let vendorNo = String($('f-vendor-no')?.value || '').trim();
  if (!editingVendorId && !vendorNo) {
    vendorNo = String(await loadVendorNumberPreview() || '').trim();
    const vendorNoInput = $('f-vendor-no');
    if (vendorNoInput) vendorNoInput.value = vendorNo;
  }
  if (!vendorNo) {
    setProcurementFieldMessage('vendor_no', 'Vendor No. is required.');
    focusFirstProcurementControl(['f-vendor-no']);
    return;
  }

  if (String(vendorTinInput?.value || '').trim() && vendorTinDigits.length !== 12) {
    setProcurementFieldMessage('vendor_tin', 'TIN must follow 000-000-000-000 format.');
    focusFirstProcurementControl(['f-vendor-tin']);
    return;
  }

  const payload = {
    vendor_no: vendorNo,
    company_id: null,
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

  const resolvedDuplicate = findDuplicateVendorEntry(payload.phone, payload.tin, payload.email, editingVendorId);
  if (resolvedDuplicate) {
    setProcurementFieldMessage(resolvedDuplicate.field, resolvedDuplicate.message);
    focusFirstProcurementControl([resolvedDuplicate.selector]);
    showToast(resolvedDuplicate.message, 'error');
    return;
  }

  const saveBtn = $('vendor-save-btn');
  const originalSaveText = saveBtn?.textContent || 'Create Vendor';
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = isStaffMasterDataWorkspace() ? 'Saving Draft...' : 'Saving...';
  }

  try {
    if (isStaffMasterDataWorkspace()) {
      const requestEditId = Number(editingVendorRequestId || 0) || 0;
      await apiFetch(requestEditId ? `/api/vendor-registry-requests/${requestEditId}` : '/api/vendor-registry-requests', {
        method: requestEditId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      forceCloseVendorModal();
      editingVendorId = null;
      vendorNumberPreviewToken += 1;
      resetVendorForm();
      clearProcurementFieldMessages();
      syncVendorModalMode();
      showToast(requestEditId ? 'Vendor draft updated.' : 'Vendor draft saved. Submit it from Requests when ready.', 'success');
      if (typeof loadMasterDataRequests === 'function') await loadMasterDataRequests();
      if (typeof switchApWorkspaceTab === 'function') {
        switchApWorkspaceTab('requests', document.querySelector('.ap-workspace-tab[data-workspace-tab="requests"]'));
      }
      return;
    }

    const result = await apiFetch(editingVendorId ? `/api/vendors/${editingVendorId}` : '/api/vendors', {
      method: editingVendorId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!result?.id && !editingVendorId) {
      throw new Error('Vendor was not saved. Please try again.');
    }

    forceCloseVendorModal();
    const savedVendorId = Number(result?.id || editingVendorId || 0) || 0;
    const wasEditing = !!editingVendorId;
    editingVendorId = null;
    vendorNumberPreviewToken += 1;
    resetVendorForm();
    clearProcurementFieldMessages();
    syncVendorModalMode();

    procurementToolbarState.vendors.search = '';
    const vendorSearch = $('vendor-search');
    if (vendorSearch) vendorSearch.value = '';

    showToast(wasEditing ? 'Vendor updated successfully!' : 'Vendor created successfully!', 'success');
    const createdVendor = {
      ...payload,
      vendor_no: String(result.vendor_no || payload.vendor_no || '').trim(),
      id: savedVendorId,
      company_id: Number(result.company_id || 0) || null,
      company_no: result.company_no || '',
      company_name: result.company_name || '',
      is_active: Number(result.is_active ?? payload.is_active ?? 1) ? 1 : 0
    };
    procurementState.vendors = [
      createdVendor,
      ...procurementState.vendors.filter((entry) => Number(entry.id) !== Number(createdVendor.id))
    ];
    await loadProcurementData();
    if (!procurementState.vendors.some((entry) => Number(entry.id) === Number(createdVendor.id))) {
      procurementState.vendors = [createdVendor, ...procurementState.vendors];
      renderSummary();
      renderVendorDirectory();
      renderVendorOptions();
    }
    switchProcTab('vendors', getProcurementTabButton('vendors'));
    if (typeof loadVendors === 'function') await loadVendors();
    forceCloseVendorModal();
    setTimeout(() => focusVendorDirectoryTopRow(), 80);
  } catch (err) {
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
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
    }
    syncVendorModalMode();
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

function getProcurementCompanyLabelById(companyId) {
  const id = Number(companyId || 0) || 0;
  if (!id) return '';
  const company = (Array.isArray(procurementState.companies) ? procurementState.companies : [])
    .find((entry) => Number(entry.id || 0) === id);
  if (!company) return '';
  return [company.company_no, company.company_name].filter(Boolean).join(' - ') || company.company_name || 'Company';
}

function renderPurchaseOrderRequisitionOptions(selectedValue = null) {
  const select = $('po-requisition');
  if (!select) return;
  const current = selectedValue !== null && selectedValue !== undefined
    ? String(selectedValue || '')
    : select.value;
  const rows = procurementState.requisitions.filter((row) => requisitionCanShowInPurchaseOrderSelect(row, current));
  select.innerHTML = [
    '<option value="">Select approved requisition</option>',
    ...rows.map((row) => {
      const label = [
        row.pr_number,
        row.company_name,
        row.project_name,
        row.item_summary || row.item_name
      ].filter(Boolean).join(' - ');
      return `<option value="${escHtml(row.id)}">${escHtml(label || row.pr_number || 'Requisition')}</option>`;
    }),
    ...(!rows.length ? ['<option value="" disabled>No approved requisitions available</option>'] : [])
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

function getActiveProcurementBusinessEntityId() {
  if (typeof getCurrentBusinessEntityId === 'function') {
    const current = String(getCurrentBusinessEntityId() || '').trim();
    if (current) return current;
  }
  return getDefaultProcurementBusinessEntityId();
}

function procurementBusinessEntityMatches(row = {}) {
  const activeId = Number(getActiveProcurementBusinessEntityId() || 0) || 0;
  if (!activeId) return true;
  const rowEntityId = Number(row.business_entity_id || 0) || 0;
  return !rowEntityId || rowEntityId === activeId;
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

function getPurchaseOrderProductById(productId) {
  const id = Number(productId || 0) || 0;
  if (!id) return null;
  return (Array.isArray(procurementState.products) ? procurementState.products : [])
    .find((product) => Number(product.id || 0) === id) || null;
}

function getPurchaseOrderProductChoices(selectedProductId = 0) {
  const activeEntityId = Number($('po-business-entity')?.value || getActiveProcurementBusinessEntityId() || 0) || 0;
  const selectedId = Number(selectedProductId || 0) || 0;
  return (Array.isArray(procurementState.products) ? procurementState.products : []).filter((product) => {
    const productId = Number(product.id || 0) || 0;
    const productEntityId = Number(product.business_entity_id || 0) || 0;
    return productId === selectedId || !activeEntityId || !productEntityId || productEntityId === activeEntityId;
  });
}

function renderPurchaseOrderProductOptions(selectedProductId = 0) {
  const selectedId = Number(selectedProductId || 0) || 0;
  const products = getPurchaseOrderProductChoices(selectedId);
  const options = ['<option value="">Select inventory product</option>'];
  products.forEach((product) => {
    const name = String(product.product_name || product.name || '').trim() || `Product #${product.id}`;
    const sku = String(product.sku || '').trim();
    const unit = String(product.unit || '').trim();
    const category = String(product.category || '').trim();
    const meta = [sku, category, unit].filter(Boolean).join(' / ');
    options.push(`<option value="${escHtml(product.id)}"${Number(product.id) === selectedId ? ' selected' : ''}>${escHtml(meta ? `${name} (${meta})` : name)}</option>`);
  });
  return options.join('');
}

function getProcurementInventoryProductChoices({ selectedProductId = 0, category = '' } = {}) {
  const activeEntityId = Number(getActiveProcurementBusinessEntityId() || 0) || 0;
  const selectedId = Number(selectedProductId || 0) || 0;
  const safeCategory = String(category || '').trim().toLowerCase();
  return (Array.isArray(procurementState.products) ? procurementState.products : []).filter((product) => {
    const productId = Number(product.id || 0) || 0;
    const productEntityId = Number(product.business_entity_id || 0) || 0;
    const productCategory = String(product.category || '').trim().toLowerCase();
    if (productId === selectedId) return true;
    if (activeEntityId && productEntityId && productEntityId !== activeEntityId) return false;
    return !safeCategory || productCategory === safeCategory;
  });
}

function getProcurementProductCategories() {
  const activeEntityId = Number(getActiveProcurementBusinessEntityId() || 0) || 0;
  const categories = new Set();
  (Array.isArray(procurementState.products) ? procurementState.products : []).forEach((product) => {
    const productEntityId = Number(product.business_entity_id || 0) || 0;
    if (activeEntityId && productEntityId && productEntityId !== activeEntityId) return;
    const category = String(product.category || '').trim();
    if (category) categories.add(category);
  });
  return Array.from(categories).sort((a, b) => a.localeCompare(b));
}

function renderRequisitionCategoryOptions(selectedCategory = '') {
  const current = String(selectedCategory || '').trim();
  const categories = getProcurementProductCategories();
  const options = ['<option value="">No category</option>'];
  categories.forEach((category) => {
    options.push(`<option value="${escHtml(category)}"${category === current ? ' selected' : ''}>${escHtml(category)}</option>`);
  });
  if (current && !categories.includes(current)) {
    options.push(`<option value="${escHtml(current)}" selected>${escHtml(current)}</option>`);
  }
  return options.join('');
}

function renderRequisitionProductOptions(selectedProductId = 0, category = '') {
  const selectedId = Number(selectedProductId || 0) || 0;
  const products = getProcurementInventoryProductChoices({ selectedProductId: selectedId, category });
  const options = ['<option value="">Manual item</option>'];
  products.forEach((product) => {
    const name = String(product.product_name || product.name || '').trim() || `Product #${product.id}`;
    const sku = String(product.sku || '').trim();
    const productCategory = String(product.category || '').trim();
    const unit = String(product.unit || '').trim();
    const meta = [sku, productCategory, unit].filter(Boolean).join(' / ');
    options.push(`<option value="${escHtml(product.id)}"${Number(product.id) === selectedId ? ' selected' : ''}>${escHtml(meta ? `${name} (${meta})` : name)}</option>`);
  });
  return options.join('');
}

function getProcurementWarehouseById(warehouseId) {
  const id = Number(warehouseId || 0) || 0;
  if (!id) return null;
  return (Array.isArray(procurementState.warehouses) ? procurementState.warehouses : [])
    .find((warehouse) => Number(warehouse.id || 0) === id) || null;
}

function renderRequisitionWarehouseOptions(selectedWarehouseId = 0) {
  const selectedId = Number(selectedWarehouseId || 0) || 0;
  const activeEntityId = Number(getActiveProcurementBusinessEntityId() || 0) || 0;
  const warehouses = (Array.isArray(procurementState.warehouses) ? procurementState.warehouses : []).filter((warehouse) => {
    const warehouseId = Number(warehouse.id || 0) || 0;
    const warehouseEntityId = Number(warehouse.business_entity_id || 0) || 0;
    return warehouseId === selectedId || !activeEntityId || !warehouseEntityId || warehouseEntityId === activeEntityId;
  });
  const options = [warehouses.length ? '<option value="">Optional</option>' : '<option value="">No warehouse yet</option>'];
  warehouses.forEach((warehouse) => {
    const label = [warehouse.warehouse_code, warehouse.warehouse_name].filter(Boolean).join(' - ') || warehouse.warehouse_name || warehouse.warehouse_code || `Warehouse ${warehouse.id}`;
    options.push(`<option value="${escHtml(warehouse.id)}"${Number(warehouse.id) === selectedId ? ' selected' : ''}>${escHtml(label)}</option>`);
  });
  return options.join('');
}

function refreshPurchaseOrderProductSelectors() {
  document.querySelectorAll('#po-line-items .po-line-product').forEach((select) => {
    const current = Number(select.value || 0) || 0;
    select.innerHTML = renderPurchaseOrderProductOptions(current);
    if (current && [...select.options].some((option) => Number(option.value || 0) === current)) {
      select.value = String(current);
    }
  });
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

function getVisibleProcurementProjects() {
  return (Array.isArray(procurementState.projects) ? procurementState.projects : [])
    .filter(procurementBusinessEntityMatches)
    .filter((project) => !['draft', 'submitted', 'rejected'].includes(normalizeWorkflowStatus(project.status || '')));
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

function renderRequisitionProjectOptions(selectedValue = currentRequisitionProjectId) {
  const select = $('pr-project');
  if (!select) return;

  const selected = String(selectedValue || '').trim();
  const rows = getVisibleProcurementProjects()
    .filter((project) => !isArchivedProjectRow(project));
  select.innerHTML = [
    '<option value="">Select project</option>',
    ...rows.map((project) => {
      const id = String(project.id || '');
      const label = getProcurementProjectLabel(project.id);
      return `<option value="${escHtml(id)}">${escHtml(label)}</option>`;
    })
  ].join('');
  if (selected && [...select.options].some(option => String(option.value) === selected)) {
    select.value = selected;
  } else {
    select.value = '';
  }
}

// PR type: 'project' (raised from a project, shows Project + Company) vs 'stock'
// (direct stock replenishment, hides Project + Company). Set by context on open.
function applyRequisitionPrTypeMode(type) {
  currentRequisitionPrType = type === 'stock' ? 'stock' : 'project';
  const isStock = currentRequisitionPrType === 'stock';
  const projectField = $('pr-project-field');
  const companyField = $('pr-company-field');
  const contextField = $('pr-project-context-field');
  if (projectField) projectField.hidden = isStock;
  if (companyField) companyField.hidden = isStock;
  if (isStock && contextField) contextField.hidden = true;
  const title = $('pr-modal-title');
  if (title) {
    const editing = Boolean(editingRequisitionId);
    title.textContent = isStock
      ? (editing ? 'Edit Stock Requisition' : 'Add Stock Requisition')
      : (editing ? 'Edit Requisition' : 'Add Requisition');
  }
  if (isStock) {
    currentRequisitionProjectId = null;
    if ($('pr-project')) $('pr-project').value = '';
    if ($('pr-company')) $('pr-company').value = '';
    if ($('pr-company-search')) $('pr-company-search').value = '';
  }
}

function syncRequisitionProjectContext(projectId = currentRequisitionProjectId) {
  currentRequisitionProjectId = Number(projectId || 0) || null;
  const field = $('pr-project-context-field');
  const input = $('pr-project-context');
  const projectSelect = $('pr-project');
  const companySelect = $('pr-company');
  const companySearch = $('pr-company-search');

  const label = getProcurementProjectLabel(currentRequisitionProjectId);
  if (field) field.hidden = !currentRequisitionProjectId;
  if (input) input.value = label || '';
  if (projectSelect && String(projectSelect.value || '') !== String(currentRequisitionProjectId || '')) {
    projectSelect.value = currentRequisitionProjectId ? String(currentRequisitionProjectId) : '';
  }

  if (currentRequisitionProjectId) {
    const companyId = getProcurementProjectCompanyId(currentRequisitionProjectId);
    if (companyId && companySelect) {
      companySelect.value = String(companyId);
      companySelect.disabled = true;
      setProcurementFieldMessage('company_id', '');
      setProcurementFieldMessage('project_id', '');
    }
    if (companySearch) {
      companySearch.value = getProcurementCompanyLabelById(companyId);
      companySearch.disabled = true;
    }
  } else {
    if (companySelect) {
      companySelect.value = '';
      companySelect.disabled = true;
    }
    if (companySearch) {
      companySearch.value = '';
      companySearch.disabled = true;
    }
  }

  // Refresh the PR number preview so it reflects the selected project's operating company.
  loadRequisitionNumberPreview();
}

function renderPurchaseOrderProjectOptions(selectedValue = currentPurchaseOrderProjectId) {
  const select = $('po-project');
  if (!select) return;

  const selected = String(selectedValue || '').trim();
  const rows = getVisibleProcurementProjects();
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
      product_id: Number(item.product_id || 0) || null,
      category: String(item.category || item.item_category || '').trim(),
      warehouse_id: Number(item.warehouse_id || 0) || null,
      item_name: String(item.item_name || item.description || '').trim(),
      description: String(item.description || '').trim(),
      quantity: Number(item.quantity || 0),
      unit: String(item.unit || '').trim(),
      estimated_unit_price: Number(item.estimated_unit_price ?? item.unit_price ?? 0)
    })).filter((item) => item.item_name || item.description || item.quantity > 0 || item.estimated_unit_price > 0);
  }

  if (requisition?.item_name || requisition?.item_description) {
    return [{
      product_id: Number(requisition.product_id || 0) || null,
      category: requisition.category || requisition.item_category || '',
      warehouse_id: Number(requisition.warehouse_id || 0) || null,
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
    setProcurementFieldMessage('requisition_id', 'Select an approved requisition before saving this purchase order.');
    return;
  }

  const requisition = procurementState.requisitions.find((entry) => Number(entry.id) === selectedId) || null;
  if (!requisition) {
    setProcurementFieldMessage('requisition_id', 'Selected requisition was not found.');
    return;
  }
  if (!requisitionIsApprovedForPurchaseOrder(requisition)) {
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
  if (Number(requisition.project_id || 0)) {
    syncPurchaseOrderProjectContext(Number(requisition.project_id || 0));
    setProcurementFieldMessage('project_id', '');
  }

  const lineContainer = getPurchaseOrderLineItemsContainer();
  const hasMeaningfulLine = Array.from(lineContainer?.querySelectorAll('[data-po-line-item]') || []).some((row) => {
    return Boolean(
      row.querySelector('.po-line-description')?.value?.trim() ||
      Number(row.querySelector('.po-line-unit-price')?.value || 0) > 0
    );
  });

  if (!hasMeaningfulLine) {
    const requisitionItems = getRequisitionLineItems(requisition).map((item) => ({
      product_id: Number(item.product_id || 0) || null,
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

function renderGoodsReceiptWarehouseOptions() {
  const select = $('grn-warehouse');
  if (!select) return;
  const current = select.value;
  const rows = Array.isArray(procurementState.warehouses) ? procurementState.warehouses : [];
  select.innerHTML = [
    '<option value="">Select receiving warehouse</option>',
    ...rows.map((row) => `<option value="${escHtml(row.id)}">${escHtml([row.warehouse_code, row.warehouse_name].filter(Boolean).join(' - ') || row.warehouse_name || row.warehouse_code || `Warehouse ${row.id}`)}</option>`)
  ].join('');
  if (current) select.value = current;
  if (!select.value && rows.length === 1) select.value = String(rows[0].id || '');
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
  const productId = Number(item.product_id || item.productId || 0) || 0;
  const product = getPurchaseOrderProductById(productId);
  const category = String(item.category || product?.category || '').trim();
  const quantity = Number(item.quantity || item.qty || 1) > 0 ? Number(item.quantity || item.qty || 1) : 1;
  const unit = String(item.unit || product?.unit || '').trim();
  const unitPrice = Number(item.estimated_unit_price ?? item.unit_price ?? item.price ?? product?.unit_cost ?? 0) || 0;
  const lineTotal = productId ? quantity * unitPrice : 0;
  const hasProduct = Boolean(productId);
  const dis = hasProduct ? '' : ' disabled';

  return `
    <div class="po-line-item" data-pr-line-item data-line-index="${index}">
      <div class="field full">
        <label>Category</label>
        <select class="pr-line-category" onchange="syncRequisitionCategorySelection(this)">
          ${renderRequisitionCategoryOptions(category)}
        </select>
      </div>
      <div class="field full">
        <label>Item ${index + 1}</label>
        <select class="pr-line-product" onchange="syncRequisitionProductSelection(this)">
          ${renderRequisitionProductOptions(productId, category)}
        </select>
      </div>
      <div class="po-line-meta-grid">
        <div class="field">
          <label>Qty <span class="req-star">*</span></label>
          <input type="number" class="pr-line-qty" min="1" step="1"
                 value="${hasProduct ? escHtml(quantity) : ''}"
                 placeholder="1" oninput="syncRequisitionLineItem(this)"${dis} />
        </div>
        <div class="field">
          <label>Unit</label>
          <input type="text" class="pr-line-unit" placeholder="pcs"
                 value="${escHtml(unit)}" oninput="syncRequisitionLineItem(this)"${dis} />
        </div>
        <div class="field">
          <label>Est. Unit Price</label>
          <input type="number" class="pr-line-unit-price" min="0" step="0.01"
                 placeholder="0.00"
                 value="${hasProduct && unitPrice ? escHtml(unitPrice.toFixed(2)) : ''}"
                 oninput="syncRequisitionLineItem(this)"${dis} />
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
    row.querySelectorAll('input, textarea, select').forEach((input) => {
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
    if (nameLabel) nameLabel.innerHTML = `Item ${index + 1} Name <span class="req-star">*</span>`;
    if (descriptionLabel) descriptionLabel.textContent = `Item ${index + 1} Description`;
  });
}

function syncRequisitionCategorySelection(source) {
  const row = source?.closest('[data-pr-line-item]');
  if (!row) return;
  const category = String(source.value || '').trim();
  const productSelect = row.querySelector('.pr-line-product');
  if (productSelect) {
    productSelect.innerHTML = renderRequisitionProductOptions(0, category);
    productSelect.value = '';
  }
  syncRequisitionLineItem(source);
}

function syncRequisitionProductSelection(source) {
  const row = source?.closest('[data-pr-line-item]');
  if (!row) return;

  const productId = Number(source?.value || 0);
  const product = getPurchaseOrderProductById(productId);
  const qtyInput       = row.querySelector('.pr-line-qty');
  const unitInput      = row.querySelector('.pr-line-unit');
  const unitPriceInput = row.querySelector('.pr-line-unit-price');
  const totalNode      = row.querySelector('.po-line-total');

  if (!product) {
    // No product — clear and disable
    if (qtyInput)       { qtyInput.value = '';       qtyInput.disabled = true; }
    if (unitInput)      { unitInput.value = '';      unitInput.disabled = true; }
    if (unitPriceInput) { unitPriceInput.value = ''; unitPriceInput.disabled = true; }
    if (totalNode)      totalNode.textContent = formatRequisitionLineAmount(0);
    recalculateRequisitionLineTotals();
    return;
  }

  // Product selected — always overwrite, enable
  // Keep the category dropdown in sync with the chosen product's category.
  const categorySelect = row.querySelector('.pr-line-category');
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
    const unitCost = Number(product.unit_cost || product.cost || 0) || 0;
    unitPriceInput.value = unitCost > 0 ? unitCost.toFixed(2) : '';
    unitPriceInput.disabled = false;
  }
  syncRequisitionLineItem(source);
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
    const productId = Number(row.querySelector('.pr-line-product')?.value || 0) || 0;
    const product = getPurchaseOrderProductById(productId);
    const itemName = product?.product_name || '';
    const quantity = Number(row.querySelector('.pr-line-qty')?.value || 0);
    const unit = String(row.querySelector('.pr-line-unit')?.value || '').trim();
    const unitPrice = Number(row.querySelector('.pr-line-unit-price')?.value || 0);
    if (!productId) return;
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
        const warehouse = getProcurementWarehouseById(item.warehouse_id);
        const warehouseLabel = warehouse
          ? [warehouse.warehouse_code, warehouse.warehouse_name].filter(Boolean).join(' - ')
          : '';
        const inventoryMeta = [
          item.category ? `Category: ${item.category}` : '',
          warehouseLabel ? `Warehouse: ${warehouseLabel}` : ''
        ].filter(Boolean).join(' | ');
        return `
          <div class="po-item-line">
            <div class="po-item-index">${index + 1}</div>
            <div class="po-item-copy">
              <div class="po-item-desc">${escHtml(itemName)}</div>
              <div class="po-item-meta">${escHtml([inventoryMeta, description, `${qty}${unit ? ` ${unit}` : ''} x ${money(unitPrice)} = ${money(lineTotal)}`].filter(Boolean).join(' | '))}</div>
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

function parsePurchaseOrderPaymentSchedulePreview(paymentTerms, totalAmount) {
  const terms = String(paymentTerms || '').trim();
  const total = Number(totalAmount || 0);
  if (!terms || total <= 0) {
    return { schedule: [], percentTotal: 0, hasPercent: false };
  }

  const parts = terms
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const sourceParts = parts.length ? parts : [terms];
  const schedule = [];

  sourceParts.forEach((part, index) => {
    const match = part.match(/(\d+(?:\.\d+)?)\s*%/);
    if (!match) return;
    const percent = Number(match[1] || 0);
    if (!Number.isFinite(percent) || percent <= 0) return;
    const label = part.replace(match[0], '').replace(/^[\s:-]+/, '').trim() || `Payment ${index + 1}`;
    schedule.push({
      percent,
      label,
      amount: Number(((total * percent) / 100).toFixed(2))
    });
  });

  const percentTotal = schedule.reduce((sum, item) => sum + Number(item.percent || 0), 0);
  if (schedule.length && Math.abs(percentTotal - 100) <= 0.05) {
    const beforeLastTotal = schedule.slice(0, -1).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    schedule[schedule.length - 1].amount = Number((total - beforeLastTotal).toFixed(2));
  }

  return {
    schedule,
    percentTotal,
    hasPercent: /(\d+(?:\.\d+)?)\s*%/.test(terms)
  };
}

function getPurchaseOrderModalTotal() {
  const rows = Array.from(getPurchaseOrderLineItemsContainer()?.querySelectorAll('[data-po-line-item]') || []);
  return rows.reduce((sum, row) => {
    const qty = Number(row.querySelector('.po-line-qty')?.value || 0);
    const unitPrice = Number(row.querySelector('.po-line-unit-price')?.value || 0);
    return sum + (qty > 0 && unitPrice > 0 ? qty * unitPrice : 0);
  }, 0);
}

function renderPurchaseOrderPaymentTermsPreview() {
  const preview = $('po-payment-terms-preview');
  if (!preview) return;

  const terms = $('po-payment-terms')?.value || '';
  const total = getPurchaseOrderModalTotal();
  const parsed = parsePurchaseOrderPaymentSchedulePreview(terms, total);
  preview.classList.remove('is-hidden');

  if (!String(terms).trim()) {
    preview.textContent = 'Use percentages to create bill schedules, e.g. 30% downpayment, 70% upon delivery.';
    return;
  }
  if (!parsed.hasPercent) {
    preview.textContent = 'No percentage found. Generate Bills needs terms like 100% full payment or 30% downpayment, 70% upon delivery.';
    return;
  }
  if (!parsed.schedule.length || total <= 0) {
    preview.textContent = 'Add PO line amounts before previewing the bill schedule.';
    return;
  }

  const percentTotal = Number(parsed.percentTotal || 0);
  const summary = parsed.schedule
    .map((term) => `${term.percent}% ${term.label}: ${money(term.amount)}`)
    .join(' | ');
  const totalText = Math.abs(percentTotal - 100) <= 0.05
    ? 'Total 100%'
    : `Total ${percentTotal.toFixed(2).replace(/\.00$/, '')}% - must equal 100%`;
  preview.textContent = `${totalText}. ${summary}`;
}

function renderPurchaseOrderLineItemRow(item = {}, index = 0) {
  const productId = Number(item.product_id || item.productId || 0) || 0;
  const product = getPurchaseOrderProductById(productId);
  const description = String(item.description || '').trim();
  const quantity = Number(item.quantity || item.qty || 1) > 0 ? Number(item.quantity || item.qty || 1) : 1;
  const unitPrice = Number(item.unit_price || item.price || product?.unit_cost || 0) || 0;
  const lineTotal = quantity * unitPrice;

  return `
    <div class="po-line-item" data-po-line-item data-line-index="${index}">
      <div class="po-line-header-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="field">
          <label>Line ${index + 1} Inventory Product</label>
          <select class="po-line-product" onchange="syncPurchaseOrderProductSelection(this)">
            ${renderPurchaseOrderProductOptions(productId)}
          </select>
        </div>
        <div class="field">
          <label>Line ${index + 1} Description <span class="req-star">*</span></label>
          <input type="text" class="po-line-description" placeholder="Item name or description" 
                 value="${escHtml(description)}" oninput="syncPurchaseOrderLineItem(this)" />
        </div>
      </div>
      <div class="po-line-meta-grid">
        <div class="field">
          <label>Qty <span class="req-star">*</span></label>
          <input type="number" class="po-line-qty" min="1" step="1"
                 value="${escHtml(quantity)}"
                 placeholder="1" oninput="syncPurchaseOrderLineItem(this)" />
        </div>
        <div class="field">
          <label>Unit Price <span class="req-star">*</span></label>
          <input type="number" class="po-line-unit-price" min="0" step="0.01"
                 placeholder="0.00"
                 value="${unitPrice ? escHtml(unitPrice.toFixed(2)) : ''}"
                 oninput="syncPurchaseOrderLineItem(this)" />
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

function setPurchaseOrderLineItemsLocked(locked) {
  purchaseOrderLineItemsLocked = Boolean(locked);
  const field = document.querySelector('#po-modal-backdrop .po-lines-field');
  if (field) field.classList.toggle('is-line-items-locked', purchaseOrderLineItemsLocked);

  const lockMessage = 'Line items are locked from the approved RFQ.';
  const addButton = $('po-add-line-item-btn');
  if (addButton) {
    addButton.disabled = purchaseOrderLineItemsLocked;
    addButton.title = purchaseOrderLineItemsLocked ? lockMessage : '';
  }

  document.querySelectorAll('#po-line-items .po-line-description, #po-line-items .po-line-qty, #po-line-items .po-line-unit-price').forEach((input) => {
    input.readOnly = purchaseOrderLineItemsLocked;
    input.setAttribute('aria-readonly', purchaseOrderLineItemsLocked ? 'true' : 'false');
    input.title = purchaseOrderLineItemsLocked ? lockMessage : '';
  });

  document.querySelectorAll('#po-line-items .po-line-remove-btn').forEach((button) => {
    button.disabled = purchaseOrderLineItemsLocked;
    button.title = purchaseOrderLineItemsLocked ? lockMessage : '';
  });
}

function setPurchaseOrderLineItems(items = []) {
  const container = getPurchaseOrderLineItemsContainer();
  if (!container) return;

  const normalized = Array.isArray(items) ? items.filter((item) => item) : [];
  const rows = normalized.length ? normalized : [{}];
  container.innerHTML = rows.map((item, index) => renderPurchaseOrderLineItemRow(item, index)).join('');
  recalculatePurchaseOrderLineTotals();
  setPurchaseOrderLineItemsLocked(purchaseOrderLineItemsLocked);
}

function addPurchaseOrderLineItem(item = {}) {
  if (purchaseOrderLineItemsLocked) {
    showToast('PO line items are locked from the approved RFQ.', 'error');
    return;
  }
  const container = getPurchaseOrderLineItemsContainer();
  if (!container) return;
  const index = container.querySelectorAll('[data-po-line-item]').length;
  container.insertAdjacentHTML('beforeend', renderPurchaseOrderLineItemRow(item, index));
  recalculatePurchaseOrderLineTotals();

  const lastRow = container.querySelector('[data-po-line-item]:last-child .po-line-description');
  if (lastRow) lastRow.focus();
}

function removePurchaseOrderLineItem(button) {
  if (purchaseOrderLineItemsLocked) {
    showToast('PO line items are locked from the approved RFQ.', 'error');
    return;
  }
  const row = button?.closest('[data-po-line-item]');
  const container = getPurchaseOrderLineItemsContainer();
  if (!row || !container) return;

  const rows = container.querySelectorAll('[data-po-line-item]');
  if (rows.length <= 1) {
    row.querySelectorAll('input').forEach((input) => {
      input.value = input.classList.contains('po-line-qty') ? '1' : '';
      if (input.classList.contains('po-line-unit-price')) input.value = '';
    });
    const productSelect = row.querySelector('.po-line-product');
    if (productSelect) productSelect.value = '';
    recalculatePurchaseOrderLineTotals();
    return;
  }

  row.remove();
  renumberPurchaseOrderLineItems();
  recalculatePurchaseOrderLineTotals();
}

function getLockedPurchaseOrderLineItems() {
  if (!purchaseOrderLineItemsLocked || !currentPurchaseOrderQuotationId) return [];
  const quote = getQuotationById(currentPurchaseOrderQuotationId);
  if (!quote) return [];
  return buildPurchaseOrderItemsFromQuotation(quote).filter((item) => {
    return String(item.description || '').trim() && Number(item.quantity || 0) > 0 && Number(item.unit_price || 0) > 0;
  });
}

function renumberPurchaseOrderLineItems() {
  const rows = Array.from(getPurchaseOrderLineItemsContainer()?.querySelectorAll('[data-po-line-item]') || []);
  rows.forEach((row, index) => {
    row.setAttribute('data-line-index', String(index));
    const productLabel = row.querySelector('.po-line-product')?.closest('.field')?.querySelector('label');
    const descriptionLabel = row.querySelector('.po-line-description')?.closest('.field')?.querySelector('label');
    if (productLabel) productLabel.textContent = `Line ${index + 1} Inventory Product`;
    if (descriptionLabel) descriptionLabel.textContent = `Line ${index + 1} Description`;
  });
}

function syncPurchaseOrderProductSelection(source) {
  const row = source?.closest('[data-po-line-item]');
  if (!row) return;
  setPurchaseOrderLineItemMessage(row, '');
  if (purchaseOrderLineItemsLocked) return;

  const productId = Number(source?.value || 0);
  const product = getPurchaseOrderProductById(productId);
  const descInput      = row.querySelector('.po-line-description');
  const qtyInput       = row.querySelector('.po-line-qty');
  const unitPriceInput = row.querySelector('.po-line-unit-price');
  const totalNode      = row.querySelector('.po-line-total');

  if (!product) {
    return;
  }

  if (descInput) {
    descInput.value = product.product_name || product.name || '';
  }

  if (qtyInput) {
    if (!Number(qtyInput.value || 0)) qtyInput.value = '1';
    qtyInput.disabled = false;
  }
  if (unitPriceInput) {
    const unitCost = Number(product.unit_cost || product.cost || 0) || 0;
    unitPriceInput.value = unitCost > 0 ? unitCost.toFixed(2) : '';
    unitPriceInput.disabled = false;
  }
  syncPurchaseOrderLineItem(source);
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
  renderPurchaseOrderPaymentTermsPreview();
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
        const description = String(item.description || '').trim() || '-';
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

function renderProcurementApprovalTrail(row = {}) {
  const entries = [
    ['Submitted', row.submitted_by, row.submitted_at],
    ['Approved', row.approved_by, row.approved_at],
    ['Cancelled', row.cancelled_by, row.cancelled_at]
  ].filter(([, actor, date]) => String(actor || date || '').trim());

  if (!entries.length) {
    return '<span class="pdf-empty">No approval activity</span>';
  }

  return `
    <div class="po-item-list">
      ${entries.map(([label, actor, date]) => `
        <div class="po-item-line">
          <div class="po-item-copy">
            <div class="po-item-desc">${escHtml(label)}${actor ? ` by ${escHtml(actor)}` : ''}</div>
            <div class="po-item-meta">${escHtml(dateText(date))}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderPurchaseOrderBillsCell(row = {}) {
  const bills = Array.isArray(row.bill_details) ? row.bill_details : [];
  if (!bills.length) return '<span class="pdf-empty">No generated bills</span>';

  return `
    <div class="po-item-list">
      ${bills.map((bill) => {
        const paid = Number(bill.paid_amount || 0);
        const total = Number(bill.total_amount || 0);
        return `
          <div class="po-item-line">
            <div class="po-item-copy">
              <div class="po-item-desc">${escHtml(bill.bill_number || `Bill #${bill.id || ''}`)}</div>
              <div class="po-item-meta">${escHtml(dateText(bill.due_date || bill.bill_date))} | ${money(total)} | ${escHtml(bill.status || (paid >= total && total > 0 ? 'paid' : 'unpaid'))}</div>
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
    const productId = Number(row.querySelector('.po-line-product')?.value || 0) || 0;
    const description = String(row.querySelector('.po-line-description')?.value || '').trim();
    const quantity = Number(row.querySelector('.po-line-qty')?.value || 0);
    const unitPrice = Number(row.querySelector('.po-line-unit-price')?.value || 0);
    const hasAnyValue = productId || description || quantity > 0 || unitPrice > 0;
    if (!hasAnyValue) return;

    if (!description || quantity <= 0 || unitPrice <= 0) {
      incompleteRows.push(index + 1);
      return;
    }

    items.push({
      product_id: productId,
      description,
      quantity,
      unit_price: unitPrice
    });
  });

  return { items, incompleteRows };
}

function filteredRows(rows, searchValue, fields) {
  const q = String(searchValue || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => fields.map((field) => String(row[field] ?? '')).join(' ').toLowerCase().includes(q));
}

function isProcurementRequestRow(row = {}) {
  const status = normalizeWorkflowStatus(row.status || 'draft');
  return ['draft', 'submitted', 'pending', 'for_approval', 'for approval', 'needs_revision', 'rejected'].includes(status);
}

function getVisibleRequisitionRows(searchValue) {
  const entityFilter = typeof businessEntityMatches === 'function' ? businessEntityMatches : procurementBusinessEntityMatches;
  return filteredRows(procurementState.requisitions.filter(entityFilter).filter(procurementRecordVisibleForCurrentUser), searchValue, [
    'pr_number',
    'project_docno',
    'project_name',
    'company_name',
    'company_no',
    'requested_by',
    'submitted_by',
    'approved_by',
    'cancelled_by',
    'item_name',
    'item_summary',
    'status'
  ]);
}

function renderProcurementRequests() {
  const tbody = $('procurement-requests-body');
  if (!tbody) return;

  const rows = getVisibleRequisitionRows($('procurement-search-input')?.value)
    .filter(isProcurementRequestRow);

  tbody.innerHTML = rows.length ? rows.map((row) => {
    const projectLabel = getProcurementProjectLabel(Number(row.project_id || 0) || 0);
    const companyLabel = [row.company_no, row.company_name].filter(Boolean).join(' - ') || '-';
    const status = normalizeWorkflowStatus(row.status || 'draft');
    const canSubmit = ['draft'].includes(status);
    const submitButton = canSubmit
      ? `<button class="btn btn-save btn-sm" type="button" onclick="submitRequisitionForApproval(${Number(row.id)})">Submit</button>`
      : '';
    const editLabel = requisitionIsLockedForEditing(row) ? 'View' : 'Edit';
    return `
      <tr>
        <td style="font-weight:600;color:var(--primary)">${escHtml(row.pr_number)}</td>
        <td>
          <div style="font-weight:600;">${String(row.pr_type || '') === 'stock' ? '<span class="status-chip status-pending">Stock PR</span>' : escHtml(projectLabel || 'No linked project')}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">${String(row.pr_type || '') === 'stock' ? 'Direct stock replenishment' : escHtml(companyLabel)}</div>
          ${renderProcurementArchivedProjectBadge(row)}
        </td>
        <td>${escHtml(dateText(row.request_date))}</td>
        <td>${escHtml(row.requested_by || '-')}</td>
        <td>${escHtml(dateText(row.needed_by))}</td>
        <td><span class="status-chip ${statusClass(row.status)}">${escHtml(formatWorkflowStatusLabel(row.status || 'draft'))}</span></td>
        <td>${renderRequisitionItemsCell(row)}</td>
        <td class="text-right" style="font-weight:600;">${escHtml(money(row.total_amount || 0))}</td>
        <td>
          <div class="erp-actions" style="justify-content:center;">
            ${submitButton}
            <button class="btn btn-edit btn-sm" type="button" onclick="openRequisitionModal(${Number(row.id)})">${editLabel}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('') : '<tr class="empty-row"><td colspan="9">No procurement requests yet.</td></tr>';
}

function renderRequisitions() {
  const tbody = $('pr-body');
  if (!tbody) return;

  const rows = getVisibleRequisitionRows($('procurement-search-input')?.value)
    .filter((row) => !isProcurementRequestRow(row));

  tbody.innerHTML = rows.length ? rows.map((row) => {
    const projectLabel = getProcurementProjectLabel(Number(row.project_id || 0) || 0);
    const companyLabel = [row.company_no, row.company_name].filter(Boolean).join(' - ') || '-';
    const canCreateRfq = requisitionCanCreateRfq(row);
    const existingPurchaseOrder = getPurchaseOrderForRequisition(row.id);
    const status = normalizeWorkflowStatus(row.status || 'draft');
    const isAdmin = userCanApproveProcurement();
    const canSubmit = ['draft'].includes(status);
    const canApprove = isAdmin && ['submitted'].includes(status);
    const canCancel = isAdmin && !isFinalProcurementStatus(status);
    const deleteButton = isAdmin
      ? `<button class="btn btn-cancel btn-sm" type="button" onclick="deleteRequisition(${Number(row.id)})">Delete</button>`
      : '';
    const createRfqButton = isAdmin && existingPurchaseOrder && canCreateRfq
      ? '<button class="btn btn-add btn-sm" type="button" disabled title="PO already exists for this PR">Create RFQ</button>'
      : isAdmin && canCreateRfq
      ? `<button class="btn btn-add btn-sm" type="button" onclick="createRfqFromRequisition(${Number(row.id)})">Create RFQ</button>`
      : '';
    const submitButton = canSubmit
      ? `<button class="btn btn-save btn-sm" type="button" onclick="submitRequisitionForApproval(${Number(row.id)})">Submit</button>`
      : '';
    const approveButton = canApprove
      ? `<button class="btn btn-save btn-sm" type="button" onclick="approveRequisition(${Number(row.id)})">Approve</button>`
      : '';
    const cancelButton = canCancel
      ? `<button class="btn btn-cancel btn-sm" type="button" onclick="cancelRequisition(${Number(row.id)})">Cancel</button>`
      : '';
    const pdfFilename = row.pdfFilename || `purchase-requisition-${Number(row.id)}.pdf`;
    const editLabel = requisitionIsLockedForEditing(row) ? 'View' : 'Edit';
    const pdfButton = `<div class="erp-actions" style="justify-content:center;">
        <button class="btn btn-pdf btn-sm" type="button" onclick="openRequisitionPdfViewer(${Number(row.id)})">View PDF</button>
        <a class="btn btn-save btn-sm" href="/api/procurement/requisitions/${Number(row.id)}/pdf?download=1" download="${escHtml(pdfFilename)}">Download</a>
      </div>`;
    return `
      <tr>
        <td style="font-weight:600;color:var(--primary)">${escHtml(row.pr_number)}</td>
        <td>
          <div style="font-weight:600;">${escHtml(projectLabel || 'No linked project')}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">${escHtml(companyLabel)}</div>
          ${renderProcurementArchivedProjectBadge(row)}
          ${renderAwardedRfqBadge(row.id)}
          ${existingPurchaseOrder ? `<div style="margin-top:4px;"><span class="status-chip status-ordered">PO: ${escHtml(existingPurchaseOrder.po_number || existingPurchaseOrder.id)}</span></div>` : ''}
        </td>
        <td>${escHtml(dateText(row.request_date))}</td>
        <td>${escHtml(row.requested_by || '-')}</td>
        <td>${escHtml(dateText(row.needed_by))}</td>
        <td><span class="status-chip ${statusClass(row.status)}">${escHtml(formatWorkflowStatusLabel(row.status || 'draft'))}</span></td>
        <td style="min-width:180px;">${renderProcurementApprovalTrail(row)}</td>
        <td>${renderRequisitionItemsCell(row)}</td>
        <td class="text-right">${escHtml(Number(row.item_count || getRequisitionLineItems(row).length || 0))}</td>
        <td class="text-right" style="font-weight:600;">${escHtml(money(row.total_amount || 0))}</td>
        <td class="text-center">${pdfButton}</td>
        <td>
          <div class="erp-actions" style="justify-content:center;">
            ${submitButton}
            ${approveButton}
            ${createRfqButton}
            <button class="btn btn-edit btn-sm" type="button" onclick="openRequisitionModal(${Number(row.id)})">${editLabel}</button>
            ${cancelButton}
            ${deleteButton}
          </div>
        </td>
      </tr>
    `;
  }).join('') : '<tr class="empty-row"><td colspan="12">No requisitions found.</td></tr>';
}

function openRequisitionPdfViewer(id) {
  const row = procurementState.requisitions.find((entry) => Number(entry.id) === Number(id));
  if (!row) {
    showToast('Purchase requisition not found.', 'error');
    return;
  }

  const pdfUrl = `/api/procurement/requisitions/${Number(id)}/pdf`;
  const pdfFilename = row.pdfFilename || `purchase-requisition-${Number(id)}.pdf`;
  document.getElementById('pdf-viewer-title').textContent = pdfFilename;
  document.getElementById('pdf-dl-btn').href = pdfUrl;
  document.getElementById('pdf-dl-btn').download = pdfFilename;
  document.getElementById('pdf-fallback-dl').href = pdfUrl;
  document.getElementById('pdf-fallback-dl').download = pdfFilename;
  const frame = document.getElementById('pdf-frame');
  const fallback = document.getElementById('pdf-fallback');
  if (frame) frame.src = pdfUrl;
  if (fallback) fallback.style.display = 'none';
  document.getElementById('pdf-viewer-backdrop').classList.add('open');
}

function getApprovedRequisitionsForQuotes() {
  const entityFilter = typeof businessEntityMatches === 'function' ? businessEntityMatches : procurementBusinessEntityMatches;
  return procurementState.requisitions
    .filter(entityFilter)
    .filter((row) => ['approved', 'ordered'].includes(normalizeWorkflowStatus(row.status)));
}

function getQuotationById(id) {
  const quoteId = Number(id || 0) || 0;
  if (!quoteId) return null;
  return procurementState.quotations.find((row) => Number(row.id || 0) === quoteId) || null;
}

function getSelectedQuotationForRequisition(requisitionId) {
  const normalizedRequisitionId = Number(requisitionId || 0) || 0;
  if (!normalizedRequisitionId) return null;
  return procurementState.quotations.find((quote) => {
    return Number(quote.requisition_id || 0) === normalizedRequisitionId
      && normalizeWorkflowStatus(quote.status) === 'selected';
  }) || null;
}

function getRfqAwardLockMessage(requisitionId) {
  const selectedQuote = getSelectedQuotationForRequisition(requisitionId);
  if (!selectedQuote) return '';
  return `This PR already has an approved RFQ (${selectedQuote.quote_number || selectedQuote.vendor_name || selectedQuote.id}). New RFQs are disabled.`;
}

function getPurchaseOrderForRequisition(requisitionId) {
  const normalizedRequisitionId = Number(requisitionId || 0) || 0;
  if (!normalizedRequisitionId) return null;
  return procurementState.purchaseOrders.find((po) => Number(po.requisition_id || 0) === normalizedRequisitionId) || null;
}

function renderAwardedRfqBadge(requisitionId) {
  const selectedQuote = getSelectedQuotationForRequisition(requisitionId);
  if (!selectedQuote) return '';
  const label = `Awarded: ${selectedQuote.vendor_name || 'Vendor'} / ${selectedQuote.quote_number || `RFQ-${selectedQuote.id}`}`;
  return `<div style="margin-top:4px;"><span class="status-chip status-approved">${escHtml(label)}</span></div>`;
}

function buildPurchaseOrderItemsFromQuotation(quote) {
  if (!quote) return [];
  const requisition = procurementState.requisitions.find((entry) => Number(entry.id || 0) === Number(quote.requisition_id || 0)) || null;
  const requestedItems = getRequisitionLineItems(requisition);
  const quotedTotal = Number(quote.quoted_total || 0) || 0;
  if (!requestedItems.length) {
    return quotedTotal > 0
      ? [{ description: `Approved RFQ ${quote.quote_number || quote.id}`, quantity: 1, unit_price: quotedTotal }]
      : [{}];
  }

  const estimatedTotal = requestedItems.reduce((sum, item) => {
    const quantity = Number(item.quantity || 1) || 1;
    return sum + (quantity * (Number(item.estimated_unit_price || 0) || 0));
  }, 0);
  const evenUnitTotal = quotedTotal > 0 ? quotedTotal / requestedItems.length : 0;

  return requestedItems.map((item) => {
    const quantity = Number(item.quantity || 1) || 1;
    const estimatedLineTotal = quantity * (Number(item.estimated_unit_price || 0) || 0);
    const targetLineTotal = quotedTotal > 0
      ? (estimatedTotal > 0 ? quotedTotal * (estimatedLineTotal / estimatedTotal) : evenUnitTotal)
      : estimatedLineTotal;
    return {
      product_id: Number(item.product_id || 0) || null,
      description: [item.item_name, item.description].filter(Boolean).join(' - ') || `Approved RFQ ${quote.quote_number || quote.id}`,
      quantity,
      unit_price: quantity > 0 ? targetLineTotal / quantity : targetLineTotal
    };
  });
}

function renderRfqWorkspace() {
  const tbody = document.querySelector('#rfq tbody');
  if (!tbody) return;

  const approvedRequisitions = getApprovedRequisitionsForQuotes();
  const approvedRequisitionIds = new Set(approvedRequisitions.map((row) => Number(row.id || 0)).filter(Boolean));
  const rows = [];

  approvedRequisitions.forEach((requisition) => {
    const existingPurchaseOrder = getPurchaseOrderForRequisition(requisition.id);
    const quotes = procurementState.quotations.filter((quote) => Number(quote.requisition_id || 0) === Number(requisition.id || 0));
    if (!quotes.length) {
      // Do not surface an approved requisition in the RFQ tab until an actual RFQ is created.
      // Creating the first RFQ is done from the Purchase Requisitions tab ("Create RFQ").
      return;
    }

    quotes.forEach((quote, index) => {
      rows.push({
        type: 'quote',
        requisition,
        existingPurchaseOrder,
        quote,
        isFirstQuoteForPr: index === 0,
        pr_number: quote.pr_number || requisition.pr_number,
        project_docno: quote.project_docno || requisition.project_docno,
        project_name: quote.project_name || requisition.project_name,
        company_name: quote.company_name || requisition.company_name,
        company_no: quote.company_no || requisition.company_no,
        vendor_name: quote.vendor_name,
        rfq_number: quote.quote_number || `RFQ-${quote.id}`,
        issue_date: quote.quote_date,
        due_date: requisition.needed_by,
        status: quote.status || 'draft'
      });
    });
  });

  procurementState.quotations
    .filter((quote) => !approvedRequisitionIds.has(Number(quote.requisition_id || 0)))
    .forEach((quote) => {
      rows.push({
        type: 'quote',
        requisition: null,
        quote,
        isFirstQuoteForPr: false,
        pr_number: quote.pr_number,
        project_docno: quote.project_docno,
        project_name: quote.project_name,
        company_name: quote.company_name,
        company_no: quote.company_no,
        vendor_name: quote.vendor_name,
        rfq_number: quote.quote_number || `RFQ-${quote.id}`,
        issue_date: quote.quote_date,
        due_date: '',
        status: quote.status || 'draft'
      });
    });

  const visibleRows = filteredRows(rows, $('procurement-search-input')?.value, [
    'rfq_number',
    'pr_number',
    'project_docno',
    'project_name',
    'company_name',
    'company_no',
    'vendor_name',
    'status'
  ]);

  const isAdmin = userCanApproveProcurement();
  tbody.innerHTML = visibleRows.length ? visibleRows.map((row) => {
    const quote = row.quote || null;
    const requisition = row.requisition || null;
    const requisitionId = Number(requisition?.id || quote?.requisition_id || 0) || 0;
    const selected = normalizeWorkflowStatus(row.status) === 'selected';
    const rejected = normalizeWorkflowStatus(row.status) === 'rejected';
    const selectedQuoteForPr = getSelectedQuotationForRequisition(requisitionId);
    const hasAwardedRfq = Boolean(selectedQuoteForPr);
    const existingPurchaseOrder = row.existingPurchaseOrder || getPurchaseOrderForRequisition(requisitionId);
    // Once an RFQ is approved (awarded) or a PO exists for the PR, hide the Add/Create RFQ button entirely.
    const addLinkedRfqButton = isAdmin && !existingPurchaseOrder && !hasAwardedRfq && requisitionId && (row.type === 'pending' || row.isFirstQuoteForPr)
      ? `<button class="btn btn-add btn-sm" type="button" onclick="createRfqFromRequisition(${requisitionId})">${row.type === 'pending' ? 'Create RFQ' : 'Add RFQ'}</button>`
      : '';
    const editButton = quote && !rejected
      ? `<button class="btn btn-edit btn-sm" type="button" onclick="openQuotationModal(${Number(quote.id)})">Edit</button>`
      : quote
        ? '<button class="btn btn-edit btn-sm" type="button" disabled title="Rejected RFQs are read-only">Edit</button>'
        : '';
    const selectButton = quote && isAdmin && !selected && !rejected && !existingPurchaseOrder
      ? `<button class="btn btn-save btn-sm" type="button" onclick="selectQuotation(${Number(quote.id)})">Approve RFQ</button>`
      : '';
    return `
      <tr>
        <td style="font-weight:600;color:var(--primary)">${escHtml(row.rfq_number || '-')}</td>
        <td>
          <div style="font-weight:600;">${escHtml(row.pr_number || '-')}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">${escHtml([row.project_docno, row.project_name].filter(Boolean).join(' - ') || row.company_name || '-')}</div>
          ${renderAwardedRfqBadge(requisitionId)}
          ${existingPurchaseOrder ? `<div style="margin-top:4px;"><span class="status-chip status-ordered">PO: ${escHtml(existingPurchaseOrder.po_number || existingPurchaseOrder.id)}</span></div>` : ''}
        </td>
        <td>${escHtml(row.vendor_name || 'No vendor RFQ yet')}</td>
        <td>${escHtml(dateText(row.issue_date))}</td>
        <td>${escHtml(dateText(row.due_date))}</td>
        <td><span class="status-chip ${statusClass(selected ? 'approved' : row.status)}">${escHtml(selected ? 'awarded' : row.status)}</span></td>
        <td>
          <div class="erp-actions" style="justify-content:center;">
            ${addLinkedRfqButton}
            ${selectButton}
            ${editButton}
          </div>
        </td>
      </tr>
    `;
  }).join('') : '<tr class="empty-row"><td colspan="7">No RFQs linked to approved requisitions yet.</td></tr>';
}

function renderQuotations() {
  const tbody = $('quote-body');
  if (!tbody) return;

  const entityFilter = typeof businessEntityMatches === 'function' ? businessEntityMatches : procurementBusinessEntityMatches;
  const rows = filteredRows(procurementState.quotations.filter(entityFilter).filter(procurementRecordVisibleForCurrentUser), $('procurement-search-input')?.value, [
    'quote_number',
    'pr_number',
    'vendor_name',
    'project_docno',
    'project_name',
    'payment_terms',
    'warranty_terms',
    'status',
    'remarks'
  ]);

  tbody.innerHTML = rows.length ? rows.map((row) => {
    const status = normalizeWorkflowStatus(row.status || 'draft');
    const isSelected = status === 'selected';
    const isRejected = status === 'rejected';
    const existingPurchaseOrder = getPurchaseOrderForRequisition(row.requisition_id);
    const isAdmin = userCanApproveProcurement();
    const selectButton = isAdmin && !isSelected && !isRejected && !existingPurchaseOrder
      ? `<button class="btn btn-save btn-sm" type="button" onclick="selectQuotation(${Number(row.id)})">Approve RFQ</button>`
      : '';
    const createPoButton = isSelected && !existingPurchaseOrder
      ? `<button class="btn btn-add btn-sm" type="button" onclick="createPurchaseOrderFromQuotation(${Number(row.id)})">Create PO</button>`
      : isSelected && existingPurchaseOrder
        ? `<button class="btn btn-add btn-sm" type="button" disabled title="PO already exists">${escHtml(existingPurchaseOrder.po_number || 'PO Created')}</button>`
      : '';
    const editButton = isRejected
      ? '<button class="btn btn-edit btn-sm" type="button" disabled title="Rejected RFQs are read-only">Edit</button>'
      : `<button class="btn btn-edit btn-sm" type="button" onclick="openQuotationModal(${Number(row.id)})">Edit</button>`;
    const deleteButton = isAdmin && !isRejected
      ? `<button class="btn btn-cancel btn-sm" type="button" onclick="deleteQuotation(${Number(row.id)})">Delete</button>`
      : '';
    return `
      <tr>
        <td style="font-weight:600;color:var(--primary)">${escHtml(row.quote_number || `QT-${row.id}`)}</td>
        <td>
          <div style="font-weight:600;">RFQ-${escHtml(row.pr_number || row.requisition_id || '-')}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">${escHtml([row.project_docno, row.project_name].filter(Boolean).join(' - ') || row.company_name || '-')}</div>
          ${renderAwardedRfqBadge(row.requisition_id)}
          ${existingPurchaseOrder ? `<div style="margin-top:4px;"><span class="status-chip status-ordered">PO: ${escHtml(existingPurchaseOrder.po_number || existingPurchaseOrder.id)}</span></div>` : ''}
        </td>
        <td>${escHtml(row.vendor_name || '-')}</td>
        <td>${escHtml(dateText(row.quote_date))}</td>
        <td class="text-right" style="font-weight:600;">${escHtml(money(row.quoted_total || 0))}</td>
        <td class="text-right">${escHtml(Number(row.delivery_days || 0) ? `${Number(row.delivery_days)} days` : '-')}</td>
        <td class="text-right">${escHtml(Number(row.score || 0) ? `${Number(row.score)}%` : '-')}</td>
        <td><span class="status-chip ${statusClass(isSelected ? 'approved' : status)}">${escHtml(row.status || 'draft')}</span></td>
        <td>
          <div class="erp-actions" style="justify-content:center;">
            ${selectButton}
            ${createPoButton}
            ${editButton}
            ${deleteButton}
          </div>
        </td>
      </tr>
    `;
  }).join('') : '<tr class="empty-row"><td colspan="9">No quotations yet.</td></tr>';
}

function renderQuotationRequisitionOptions(selectedValue = '') {
  const select = $('quote-requisition');
  if (!select) return;
  const selected = String(selectedValue || select.value || '').trim();
  const rows = getApprovedRequisitionsForQuotes();
  const currentQuotationId = Number(editingQuotationId || 0) || 0;
  const visibleRows = rows.filter((row) => {
    const selectedQuote = getSelectedQuotationForRequisition(row.id);
    if (!selectedQuote) return true;
    return currentQuotationId && Number(selectedQuote.id || 0) === currentQuotationId;
  });
  select.innerHTML = [
    '<option value="">Select approved PR</option>',
    ...visibleRows.map((row) => {
      const label = [row.pr_number, row.project_name || row.company_name, row.item_summary].filter(Boolean).join(' - ');
      return `<option value="${escHtml(row.id)}">${escHtml(label || row.pr_number || 'Approved PR')}</option>`;
    }),
    ...(!visibleRows.length ? ['<option value="" disabled>No approved PRs available for new RFQs</option>'] : [])
  ].join('');
  if (selected && Array.from(select.options || []).some((option) => String(option.value) === selected)) {
    select.value = selected;
  }
}

function renderQuotationVendorOptions(selectedValue = '') {
  const select = $('quote-vendor');
  if (!select) return;
  const selected = String(selectedValue || select.value || '').trim();
  const rows = getPurchaseOrderVendorChoices();
  select.innerHTML = [
    '<option value="">Select vendor</option>',
    ...rows.map((vendor) => `<option value="${escHtml(vendor.id)}">${escHtml([vendor.vendor_no, vendor.vendor_name].filter(Boolean).join(' - ') || vendor.vendor_name || 'Vendor')}</option>`)
  ].join('');
  if (selected && Array.from(select.options || []).some((option) => String(option.value) === selected)) {
    select.value = selected;
  }
}

function syncQuotationFromRequisition() {
  const requisition = procurementState.requisitions.find((row) => Number(row.id || 0) === Number($('quote-requisition')?.value || 0)) || null;
  const totalInput = $('quote-total');
  if (requisition && totalInput && !Number(totalInput.value || 0)) {
    totalInput.value = Number(requisition.total_amount || 0) > 0 ? Number(requisition.total_amount || 0).toFixed(2) : '';
  }
}

function resetQuotationForm() {
  ['quote-number', 'quote-total', 'quote-delivery-days', 'quote-payment-terms', 'quote-warranty-terms', 'quote-score', 'quote-remarks'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });
  if ($('quote-date')) $('quote-date').value = new Date().toISOString().slice(0, 10);
  if ($('quote-status')) $('quote-status').value = 'draft';
  syncProcurementStatusSelect('quote-status', ['draft', 'submitted'], { lockStaff: false });
  renderQuotationRequisitionOptions('');
  renderQuotationVendorOptions('');
  ['quotation_number', 'quotation_requisition', 'quotation_vendor', 'quotation_total'].forEach((field) => setProcurementFieldMessage(field, ''));
}

function openQuotationModal(id = null, requisitionId = null) {
  editingQuotationId = id ? Number(id) : null;
  resetQuotationForm();
  const title = $('quote-modal-title');
  const saveBtn = $('quote-save-btn');
  if (title) title.textContent = editingQuotationId ? 'Edit Quotation' : 'Add Quotation';
  if (saveBtn) saveBtn.textContent = editingQuotationId ? 'Save Changes' : 'Save RFQ';

  if (editingQuotationId) {
    const row = getQuotationById(editingQuotationId);
    if (!row) {
      showToast('Quotation not found.', 'error');
      editingQuotationId = null;
      return;
    }
    if (normalizeWorkflowStatus(row.status) === 'rejected') {
      showToast('Rejected RFQs are read-only.', 'error');
      editingQuotationId = null;
      return;
    }
    const selectedQuote = getSelectedQuotationForRequisition(row.requisition_id);
    if (selectedQuote && Number(selectedQuote.id || 0) !== Number(row.id || 0)) {
      showToast(getRfqAwardLockMessage(row.requisition_id), 'error');
      editingQuotationId = null;
      return;
    }
    $('quote-number').value = row.quote_number || '';
    renderQuotationRequisitionOptions(row.requisition_id || '');
    renderQuotationVendorOptions(row.vendor_id || '');
    $('quote-date').value = dateInputValue(row.quote_date);
    $('quote-total').value = Number(row.quoted_total || 0) > 0 ? Number(row.quoted_total || 0).toFixed(2) : '';
    $('quote-delivery-days').value = Number(row.delivery_days || 0) || '';
    $('quote-payment-terms').value = row.payment_terms || '';
    $('quote-warranty-terms').value = row.warranty_terms || '';
    $('quote-score').value = Number(row.score || 0) || '';
    $('quote-status').value = row.status || 'draft';
    syncProcurementStatusSelect('quote-status', ['draft', 'submitted'], { lockStaff: false });
    $('quote-remarks').value = row.remarks || '';
  } else {
    if (requisitionId && getSelectedQuotationForRequisition(requisitionId)) {
      showToast(getRfqAwardLockMessage(requisitionId), 'error');
      editingQuotationId = null;
      return;
    }
    void loadQuotationNumberPreview();
    if (requisitionId) {
      renderQuotationRequisitionOptions(requisitionId);
      syncQuotationFromRequisition();
    }
    syncProcurementStatusSelect('quote-status', ['draft', 'submitted'], { lockStaff: false });
  }

  openBackdrop('quote-modal-backdrop');
}

function createRfqFromRequisition(id) {
  const row = procurementState.requisitions.find((entry) => Number(entry.id) === Number(id));
  if (!row) {
    showToast('Requisition not found.', 'error');
    return;
  }
  if (!requisitionCanCreateRfq(row)) {
    showToast('Approve this requisition before creating an RFQ.', 'error');
    return;
  }
  if (getPurchaseOrderForRequisition(row.id)) {
    showToast('This PR already has a purchase order. New RFQs are disabled.', 'error');
    return;
  }
  if (getSelectedQuotationForRequisition(row.id)) {
    showToast(getRfqAwardLockMessage(row.id), 'error');
    return;
  }

  if (typeof window.switchApWorkspaceTab === 'function') {
    window.switchApWorkspaceTab('rfq', getProcurementTabButton('rfq'));
  } else {
    switchProcTab('rfq', getProcurementTabButton('rfq'));
  }
  openQuotationModal(null, Number(row.id));
}

function closeQuotationModal() {
  editingQuotationId = null;
  closeBackdrop('quote-modal-backdrop');
  resetQuotationForm();
}

async function saveQuotation() {
  ['quotation_requisition', 'quotation_vendor', 'quotation_total'].forEach((field) => setProcurementFieldMessage(field, ''));
  const requisitionId = Number($('quote-requisition')?.value || 0) || 0;
  const vendorId = Number($('quote-vendor')?.value || 0) || 0;
  const quotedTotal = Number($('quote-total')?.value || 0) || 0;
  const quoteNumber = String($('quote-number')?.value || '').trim();
  const currentQuotation = editingQuotationId ? getQuotationById(editingQuotationId) : null;
  if (currentQuotation && normalizeWorkflowStatus(currentQuotation.status) === 'rejected') {
    showToast('Rejected RFQs are read-only.', 'error');
    return;
  }
  if (getPurchaseOrderForRequisition(requisitionId)) {
    showToast('This PR already has a purchase order. RFQ changes are disabled.', 'error');
    return;
  }
  const selectedQuote = getSelectedQuotationForRequisition(requisitionId);
  if (selectedQuote && Number(selectedQuote.id || 0) !== Number(editingQuotationId || 0)) {
    const message = getRfqAwardLockMessage(requisitionId);
    setProcurementFieldMessage('quotation_requisition', message);
    showToast(message, 'error');
    focusFirstProcurementControl(['quote-requisition']);
    return;
  }
  let firstInvalid = '';
  if (!quoteNumber) {
    setProcurementFieldMessage('quotation_number', 'Quotation No. is required.');
    firstInvalid = firstInvalid || 'quote-number';
  }
  if (!requisitionId) {
    setProcurementFieldMessage('quotation_requisition', 'Select an approved PR.');
    firstInvalid = firstInvalid || 'quote-requisition';
  }
  if (!vendorId) {
    setProcurementFieldMessage('quotation_vendor', 'Select a vendor.');
    firstInvalid = firstInvalid || 'quote-vendor';
  }
  if (quotedTotal <= 0) {
    setProcurementFieldMessage('quotation_total', 'Quoted total is required.');
    firstInvalid = firstInvalid || 'quote-total';
  }
  if (firstInvalid) {
    focusFirstProcurementControl([firstInvalid]);
    return;
  }

  const payload = {
    quote_number: quoteNumber,
    requisition_id: requisitionId,
    vendor_id: vendorId,
    quote_date: $('quote-date')?.value || new Date().toISOString().slice(0, 10),
    quoted_total: quotedTotal,
    delivery_days: Number($('quote-delivery-days')?.value || 0) || 0,
    payment_terms: $('quote-payment-terms')?.value.trim() || '',
    warranty_terms: $('quote-warranty-terms')?.value.trim() || '',
    score: Number($('quote-score')?.value || 0) || 0,
    status: $('quote-status')?.value || 'draft',
    remarks: $('quote-remarks')?.value.trim() || ''
  };

  try {
    const wasEditing = Boolean(editingQuotationId);
    await apiFetch(editingQuotationId ? `/api/procurement/quotations/${editingQuotationId}` : '/api/procurement/quotations', {
      method: editingQuotationId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeQuotationModal();
    showToast(wasEditing ? 'RFQ updated.' : 'RFQ saved and linked to the PR.', 'success');
    await loadProcurementData();
    switchProcTab('rfq', getProcurementTabButton('rfq'));
  } catch (err) {
    const message = err.message || 'Unable to save quotation.';
    if (message.toLowerCase().includes('vendor')) {
      setProcurementFieldMessage('quotation_vendor', message);
      focusFirstProcurementControl(['quote-vendor']);
      return;
    }
    showToast(message, 'error');
  }
}

async function selectQuotation(id) {
  const row = getQuotationById(id);
  if (!row) {
    showToast('RFQ not found.', 'error');
    return;
  }
  if (normalizeWorkflowStatus(row.status) === 'rejected') {
    showToast('Rejected RFQs are read-only.', 'error');
    return;
  }
  if (getPurchaseOrderForRequisition(row.requisition_id)) {
    showToast('This PR already has a purchase order. RFQ approval is locked.', 'error');
    return;
  }
  const confirmed = await openConfirmDialog({
    title: 'Approve RFQ?',
    message: `Approve ${row?.quote_number || 'this RFQ'} for ${row?.vendor_name || 'this vendor'}? Other RFQs linked to this PR will be marked rejected.`,
    noText: 'No',
    yesText: 'Approve'
  });
  if (!confirmed) return;
  try {
    await apiFetch(`/api/procurement/quotations/${id}/select`, { method: 'POST' });
    showToast('RFQ approved. Other RFQs for this PR were rejected.', 'success');
    await loadProcurementData();
    if (typeof window.switchApWorkspaceTab === 'function') {
      window.switchApWorkspaceTab('quotations', getProcurementTabButton('quotations'));
    } else {
      switchProcTab('quotations', getProcurementTabButton('quotations'));
    }
  } catch (err) {
    showToast(err.message || 'Unable to approve RFQ.', 'error');
  }
}

async function deleteQuotation(id) {
  const row = getQuotationById(id);
  if (normalizeWorkflowStatus(row?.status) === 'rejected') {
    showToast('Rejected RFQs are read-only.', 'error');
    return;
  }
  if (getPurchaseOrderForRequisition(row?.requisition_id)) {
    showToast('This PR already has a purchase order. RFQ deletion is disabled.', 'error');
    return;
  }
  const confirmed = await openConfirmDialog({
    title: 'Delete Quotation?',
    message: `Delete ${row?.quote_number || 'this quotation'}?`,
    noText: 'No',
    yesText: 'Delete'
  });
  if (!confirmed) return;
  try {
    await apiFetch(`/api/procurement/quotations/${id}`, { method: 'DELETE' });
    showToast('Quotation deleted.', 'success');
    await loadProcurementData();
  } catch (err) {
    showToast(err.message || 'Unable to delete quotation.', 'error');
  }
}

async function createPurchaseOrderFromQuotation(id) {
  let row = getQuotationById(id);
  if (!row) {
    showToast('RFQ not found.', 'error');
    return;
  }
  if (normalizeWorkflowStatus(row.status) !== 'selected') {
    showToast('Approve the RFQ before creating a purchase order.', 'error');
    return;
  }
  if (getPurchaseOrderForRequisition(row.requisition_id)) {
    showToast('This PR already has a purchase order.', 'error');
    return;
  }

  if (typeof window.switchApWorkspaceTab === 'function') {
    window.switchApWorkspaceTab('purchase-orders', getProcurementTabButton('purchase-orders'));
  } else {
    switchProcTab('purchase-orders', getProcurementTabButton('purchase-orders'));
  }
  row = getQuotationById(id) || row;
  openPurchaseOrderModal(null, row.vendor_id, row.requisition_id);
  currentPurchaseOrderQuotationId = Number(row.id || 0) || null;
  if ($('po-source-rfq')) $('po-source-rfq').value = row.quote_number || `RFQ #${row.id}`;
  setPurchaseOrderLineItems(buildPurchaseOrderItemsFromQuotation(row));
  setPurchaseOrderLineItemsLocked(true);
  recalculatePurchaseOrderLineTotals();
  if ($('po-payment-terms')) $('po-payment-terms').value = row.payment_terms || '';
  if ($('po-notes')) {
    const note = `Created from approved RFQ ${row.quote_number || row.id}. ${row.remarks || ''}`.trim();
    $('po-notes').value = note;
  }
  showToast('Purchase order is ready from the approved RFQ.', 'success');
}

function renderPurchaseOrders() {
  const tbody = $('po-body');
  if (!tbody) return;

  const entityFilter = typeof businessEntityMatches === 'function' ? businessEntityMatches : procurementBusinessEntityMatches;
  const rows = filteredRows(procurementState.purchaseOrders.filter(entityFilter), $('procurement-search-input')?.value, [
    'po_number',
    'requisition_number',
    'vendor_name',
    'project_docno',
    'project_name',
    'payment_terms',
    'prepared_by',
    'approved_by',
    'source_quote_number',
    'submitted_by',
    'cancelled_by',
    'item_summary',
    'status'
  ]);

  tbody.innerHTML = rows.length ? rows.map((row) => {
    const status = normalizeWorkflowStatus(row.status || 'draft');
    const isAdmin = userCanApproveProcurement();
    const canSubmit = ['draft'].includes(status);
    const canApprove = isAdmin && ['pending'].includes(status);
    const canCancel = isAdmin && !isFinalProcurementStatus(status);
    const isApproved = status === 'approved';
    const isGeneratingBills = generatingPurchaseOrderBillIds.has(Number(row.id || 0));
    const canGenerateBills = isApproved && String(row.payment_terms || '').trim() && Number(row.bill_count || 0) === 0 && !isGeneratingBills;
    let billAction = '';
    if (canGenerateBills) {
      billAction = `<button class="btn btn-save btn-sm" type="button" onclick="generatePurchaseOrderBills(${Number(row.id)})">Generate Bills</button>`;
    } else if (isGeneratingBills) {
      billAction = '<button class="btn btn-save btn-sm" type="button" disabled>Generating...</button>';
    } else if (Number(row.bill_count || 0) > 0) {
      billAction = '<span class="pdf-empty">Bills generated</span>';
    } else if (!isApproved && String(row.payment_terms || '').trim()) {
      billAction = '<span class="pdf-empty">Approve before bills</span>';
    }
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
        <td>${escHtml([row.project_docno, row.project_name].filter(Boolean).join(' - ') || '-')}${renderProcurementArchivedProjectBadge(row)}</td>
        <td>${escHtml(dateText(row.po_date))}</td>
        <td>${escHtml(dateText(row.delivery_date))}</td>
        <td>${escHtml(row.payment_terms || '-')}</td>
        <td>${escHtml(row.prepared_by || '-')}</td>
        <td>${escHtml(row.approved_by || '-')}</td>
        <td><span class="status-chip ${statusClass(row.status)}">${escHtml(row.status || 'draft')}</span></td>
        <td>${escHtml(row.source_quote_number || '-')}</td>
        <td style="min-width:180px;">${renderProcurementApprovalTrail(row)}</td>
        <td style="min-width:300px;">${renderPurchaseOrderItemsCell(row)}</td>
        <td style="min-width:220px;">${renderPurchaseOrderBillsCell(row)}</td>
        <td class="text-right"><span class="po-line-count">${escHtml(Number(row.line_count || row.line_items?.length || 0))}</span></td>
        <td class="text-right">${escHtml(money(row.computed_total || row.total_amount || 0))}</td>
        <td>
          <div class="erp-actions" style="justify-content:center;">
            ${submitButton}
            ${approveButton}
            ${billAction}
            <button class="btn btn-edit btn-sm" type="button" onclick="openPurchaseOrderDocuments(${Number(row.id)})">Docs (${Number(row.document_count || 0)})</button>
            <button class="btn btn-edit btn-sm" type="button" onclick="openPurchaseOrderModal(${Number(row.id)})">Edit</button>
            ${cancelButton}
            ${isAdmin ? `<button class="btn btn-cancel btn-sm" type="button" onclick="deletePurchaseOrder(${Number(row.id)})">Delete</button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('') : '<tr class="empty-row"><td colspan="17">No purchase orders found.</td></tr>';
}

function renderGoodsReceipts() {
  const tbody = $('grn-body');
  if (!tbody) return;

  const entityFilter = typeof businessEntityMatches === 'function' ? businessEntityMatches : procurementBusinessEntityMatches;
  const rows = filteredRows(procurementState.goodsReceipts.filter(entityFilter), $('procurement-search-input')?.value, [
    'grn_number',
    'po_number',
    'vendor_name',
    'received_by',
    'status'
  ]);

  const canDelete = userCanApproveProcurement();
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
          ${canDelete ? `<button class="btn btn-cancel btn-sm" type="button" onclick="deleteGoodsReceipt(${Number(row.id)})">Delete</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('') : '<tr class="empty-row"><td colspan="7">No goods receipts found.</td></tr>';
}

function formatDocumentTypeLabel(value) {
  const normalized = String(value || 'attachment').trim().replace(/[_-]+/g, ' ');
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!size) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderRecordDocuments(rows = []) {
  const tbody = $('record-documents-body');
  if (!tbody) return;

  tbody.innerHTML = rows.length ? rows.map((row) => `
    <tr>
      <td>${escHtml(formatDocumentTypeLabel(row.document_type))}</td>
      <td>${escHtml(row.original_filename || row.stored_filename || 'document.pdf')}</td>
      <td>${escHtml(dateText(row.uploaded_at))}</td>
      <td class="text-right">${escHtml(formatFileSize(row.file_size))}</td>
      <td>
        <div class="erp-actions" style="justify-content:center;">
          <button class="btn btn-pdf btn-sm" type="button" onclick="viewRecordDocument(${Number(row.id)})">View</button>
          <button class="btn btn-cancel btn-sm" type="button" onclick="deleteRecordDocument(${Number(row.id)})">Delete</button>
        </div>
      </td>
    </tr>
  `).join('') : '<tr class="empty-row"><td colspan="5">No documents attached yet.</td></tr>';
}

async function loadRecordDocuments() {
  if (!activeDocumentContext) return;
  try {
    const rows = await apiFetch(`/api/documents?module_name=${encodeURIComponent(activeDocumentContext.moduleName)}&record_id=${encodeURIComponent(activeDocumentContext.recordId)}`, { cache: 'no-store' });
    renderRecordDocuments(Array.isArray(rows) ? rows : []);
  } catch (err) {
    renderRecordDocuments([]);
    showToast(err.message || 'Unable to load documents.', 'error');
  }
}

function openPurchaseOrderDocuments(id) {
  const row = procurementState.purchaseOrders.find((entry) => Number(entry.id) === Number(id));
  if (!row) {
    showToast('Purchase order not found.', 'error');
    return;
  }

  activeDocumentContext = {
    moduleName: 'purchase_order',
    recordId: Number(row.id),
    title: row.po_number || `PO #${row.id}`
  };
  const title = $('record-documents-title');
  if (title) title.textContent = `Documents - ${activeDocumentContext.title}`;
  const fileInput = $('record-document-file');
  if (fileInput) fileInput.value = '';
  const typeInput = $('record-document-type');
  if (typeInput) typeInput.value = 'signed_po';
  renderRecordDocuments([]);
  openBackdrop('record-documents-modal-backdrop');
  void loadRecordDocuments();
}

function closeRecordDocumentsModal() {
  activeDocumentContext = null;
  closeBackdrop('record-documents-modal-backdrop');
  const fileInput = $('record-document-file');
  if (fileInput) fileInput.value = '';
  renderRecordDocuments([]);
}

async function uploadRecordDocument() {
  if (!activeDocumentContext) return;
  const fileInput = $('record-document-file');
  const file = fileInput?.files?.[0] || null;
  if (!file) {
    showToast('Select a PDF file first.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('module_name', activeDocumentContext.moduleName);
  formData.append('record_id', String(activeDocumentContext.recordId));
  formData.append('document_type', $('record-document-type')?.value || 'attachment');
  formData.append('pdf_file', file);

  try {
    await apiFetch('/api/documents', {
      method: 'POST',
      body: formData
    });
    if (fileInput) fileInput.value = '';
    showToast('PDF uploaded successfully.', 'success');
    await loadRecordDocuments();
    await loadProcurementData();
  } catch (err) {
    showToast(err.message || 'Unable to upload PDF.', 'error');
  }
}

function viewRecordDocument(id) {
  window.open(`/api/documents/${Number(id)}/file`, '_blank', 'noopener');
}

async function deleteRecordDocument(id) {
  const confirmed = await openConfirmDialog({
    title: 'Delete PDF',
    message: 'Delete this attached PDF?',
    noText: 'No',
    yesText: 'Yes'
  });
  if (!confirmed) return;

  try {
    await apiFetch(`/api/documents/${Number(id)}`, { method: 'DELETE' });
    showToast('PDF deleted successfully.', 'success');
    await loadRecordDocuments();
    await loadProcurementData();
  } catch (err) {
    showToast(err.message || 'Unable to delete PDF.', 'error');
  }
}

function openBackdrop(id) {
  const backdrop = $(id);
  if (backdrop) {
    backdrop.hidden = false;
    backdrop.style.display = 'flex';
    backdrop.style.visibility = '';
    backdrop.style.opacity = '';
    backdrop.style.pointerEvents = '';
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
  }
  document.body.style.overflow = 'hidden';
}

function closeBackdrop(id) {
  const backdrop = $(id);
  if (backdrop) {
    backdrop.classList.remove('open');
    backdrop.style.display = 'none';
    backdrop.style.visibility = 'hidden';
    backdrop.style.opacity = '0';
    backdrop.style.pointerEvents = 'none';
    backdrop.hidden = true;
    backdrop.setAttribute('aria-hidden', 'true');
  }
  const anyModalOpen = document.querySelector('.modal-backdrop.open') || document.getElementById('confirm-modal-backdrop')?.classList.contains('open');
  if (!anyModalOpen) {
    document.body.style.overflow = '';
  }
}

function forceCloseBackdrop(id) {
  closeBackdrop(id);
  setTimeout(() => closeBackdrop(id), 0);
  window.requestAnimationFrame(() => closeBackdrop(id));
}

function resetRequisitionForm() {
  setRequisitionReadOnlyMode(false);
  ['pr-number', 'pr-requested-by', 'pr-notes'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });
  currentRequisitionProjectId = null;
  if ($('pr-company')) $('pr-company').value = '';
  if ($('pr-company-search')) $('pr-company-search').value = '';
  if ($('pr-company')) $('pr-company').disabled = true;
  if ($('pr-company-search')) $('pr-company-search').disabled = true;
  const dateDefaults = {
    'pr-request-date': new Date().toISOString().slice(0, 10),
    'pr-needed-by': new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    'pr-status': 'draft'
  };
  Object.entries(dateDefaults).forEach(([id, value]) => {
    const el = $(id);
    if (el) el.value = value;
  });
  syncProcurementStatusSelect('pr-status', ['draft'], { lockStaff: true });
  syncRequisitionProjectContext(null);
  setRequisitionLineItems([{}]);
  clearProcurementFieldMessages();
  clearRequisitionLineItemMessages();
}

function syncRequisitionModalMode() {
  const title = $('pr-modal-title');
  const saveBtn = $('pr-save-btn');
  const staffRequest = isStaffProcurementWorkspace();
  if (title) {
    title.textContent = viewingProjectLinkedRequisition
      ? (staffRequest ? 'View Purchase Request' : 'View Requisition')
      : staffRequest
      ? (editingRequisitionId ? 'Edit Purchase Request' : 'Request PR')
      : (editingRequisitionId ? 'Edit Requisition' : 'Add Requisition');
  }
  if (saveBtn) {
    saveBtn.textContent = staffRequest
      ? (editingRequisitionId ? 'Update Request Draft' : 'Save Request Draft')
      : (editingRequisitionId ? 'Save Changes' : 'Create Requisition');
  }
}

function openRequisitionModal(id = null, options = {}) {
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
    renderRequisitionProjectOptions(Number(row.project_id || 0) || null);
    syncRequisitionProjectContext(Number(row.project_id || 0) || null);
    $('pr-request-date').value = dateInputValue(row.request_date);
    $('pr-requested-by').value = row.requested_by || '';
    $('pr-needed-by').value = dateInputValue(row.needed_by);
    $('pr-status').value = row.status || 'draft';
    syncProcurementStatusSelect('pr-status', ['draft'], { lockStaff: true });
    setRequisitionLineItems(getRequisitionLineItems(row));
    $('pr-notes').value = row.notes || '';
    applyRequisitionPrTypeMode((String(row.pr_type || '') === 'stock' || !Number(row.project_id || 0)) ? 'stock' : 'project');
    const readOnly = requisitionIsLockedForEditing(row);
    setRequisitionReadOnlyMode(readOnly, getRequisitionLockedReason(row));
  } else {
    const companyId = Number(options.companyId || pendingRequisitionCompanyId || 0) || 0;
    const projectId = Number(options.projectId || pendingRequisitionProjectId || 0) || 0;
    renderRequisitionProjectOptions(projectId || '');
    syncRequisitionProjectContext(projectId || null);
    if (!projectId && companyId && $('pr-company')) $('pr-company').value = String(companyId);
    // Direct "New PR" (no project context) = Stock PR; from a project = Project PR.
    applyRequisitionPrTypeMode(projectId ? 'project' : 'stock');
    void loadRequisitionNumberPreview();
    syncProcurementStatusSelect('pr-status', ['draft'], { lockStaff: true });
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
  if (viewingProjectLinkedRequisition) {
    showToast(currentRequisitionReadOnlyReason || 'This requisition is view-only.', 'error');
    return;
  }
  clearProcurementFieldMessages();
  clearRequisitionLineItemMessages();
  const { items, incompleteRows } = collectRequisitionLineItems();
  const isStockPr = currentRequisitionPrType === 'stock';
  const companyId = Number($('pr-company').value || 0) || 0;
  const payload = {
    pr_number: $('pr-number').value.trim(),
    pr_type: currentRequisitionPrType,
    business_entity_id: (typeof getCurrentBusinessEntityId === 'function' ? getCurrentBusinessEntityId() : '') || getDefaultProcurementBusinessEntityId() || '',
    company_id: isStockPr ? null : companyId,
    project_id: isStockPr ? null : (currentRequisitionProjectId || null),
    request_date: $('pr-request-date').value,
    department: '',
    requested_by: $('pr-requested-by').value.trim(),
    needed_by: $('pr-needed-by').value,
    status: $('pr-status')?.value || 'draft',
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
  if (!payload.pr_number) markError('pr_number', 'PR No. is required.');
  if (incompleteRows.length) markError('pr_line_items', `Complete item name and qty for line ${incompleteRows[0]}.`);
  if (!isStockPr && !payload.project_id) markError('project_id', 'Project selection is required for traceability.');
  if (!isStockPr && !payload.company_id) markError('company_id', 'Company selection is required.');
  if (!payload.request_date) markError('request_date', 'Request Date is required.');
  if (!payload.requested_by) markError('requested_by', 'Requested By is required.');
  if (!payload.needed_by) markError('needed_by', 'Needed By is required.');

  if (hasValidationError) {
    if (firstInvalidField === 'pr_line_items') {
      focusFirstInvalidRequisitionLineItem();
      return;
    }
    focusFirstProcurementField(firstInvalidField, {
      company_id: ['pr-company'],
      project_id: ['pr-project'],
      request_date: ['pr-request-date'],
      requested_by: ['pr-requested-by'],
      needed_by: ['pr-needed-by']
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
    showToast(isStaffProcurementWorkspace() ? 'Purchase request draft saved.' : 'Requisition created successfully!', 'success');
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
    showToast('Requisition submitted for approval. PDF generated.', 'success');
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
  currentPurchaseOrderQuotationId = null;
  setPurchaseOrderLineItemsLocked(false);
  syncPurchaseOrderProjectContext(null);
  ['po-number', 'po-payment-terms', 'po-prepared-by', 'po-approved-by', 'po-notes'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });
  const preview = $('po-payment-terms-preview');
  if (preview) {
    preview.textContent = '';
    preview.classList.add('is-hidden');
  }
  if ($('po-requisition')) $('po-requisition').value = '';
  if ($('po-source-rfq')) $('po-source-rfq').value = '';
  renderBusinessEntityOptions('po-business-entity');
  renderPurchaseOrderProjectOptions('');
  if ($('po-company')) $('po-company').value = '';
  if ($('po-company-search')) $('po-company-search').value = '';
  if ($('po-vendor')) $('po-vendor').value = '';
  if ($('po-vendor-search')) $('po-vendor-search').value = '';
  if ($('po-status')) $('po-status').value = 'draft';
  syncProcurementStatusSelect('po-status', ['draft'], { lockStaff: true });
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
    renderPurchaseOrderRequisitionOptions(row.requisition_id || '');
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
    syncProcurementStatusSelect('po-status', ['draft'], { lockStaff: true });
    $('po-notes').value = row.notes || '';
    currentPurchaseOrderQuotationId = Number(row.quotation_id || 0) || null;
    if ($('po-source-rfq')) $('po-source-rfq').value = row.source_quote_number || (currentPurchaseOrderQuotationId ? `RFQ #${currentPurchaseOrderQuotationId}` : '');
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
    } else if (currentPurchaseOrderQuotationId) {
      const quote = getQuotationById(currentPurchaseOrderQuotationId);
      if (quote) setPurchaseOrderLineItems(buildPurchaseOrderItemsFromQuotation(quote));
    }
    setPurchaseOrderLineItemsLocked(Boolean(currentPurchaseOrderQuotationId));
  } else {
    void loadPurchaseOrderNumberPreview();
    syncProcurementStatusSelect('po-status', ['draft'], { lockStaff: true });
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
  const payloadItems = collected.items;
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
    po_number: $('po-number').value.trim(),
    requisition_id: requisitionId || null,
    business_entity_id: businessEntityId,
    vendor_id: vendorId,
    po_date: $('po-date').value,
    delivery_date: $('po-delivery').value,
    payment_terms: $('po-payment-terms').value.trim(),
    quotation_id: currentPurchaseOrderQuotationId || null,
    prepared_by: $('po-prepared-by').value.trim(),
    approved_by: $('po-approved-by').value.trim(),
    status: $('po-status')?.value || 'draft',
    notes: $('po-notes').value.trim(),
    company_id: companyId,
    project_id: currentPurchaseOrderProjectId || null,
    items: payloadItems
  };

  let hasValidationError = false;
  let firstInvalidField = null;
  const markError = (fieldName, message) => {
    setProcurementFieldMessage(fieldName, message);
    if (!firstInvalidField) firstInvalidField = fieldName;
    hasValidationError = true;
  };

  if (!payload.vendor_id) markError('vendor_id', 'Vendor selection is required.');
  if (!payload.po_number) markError('po_number', 'PO No. is required.');
  if (selectedVendor && !vendorCanBeUsedForPurchaseOrder(selectedVendor)) {
    markError('vendor_id', 'Select another vendor. The issuing company cannot be its own supplier on this PO.');
  }
  if (!payload.po_date) markError('po_date', 'PO Date is required.');
  if (!requisitionId) markError('requisition_id', 'Approved requisition is required before creating a purchase order.');
  if (requisitionId && !requisitionRow) markError('requisition_id', 'Selected requisition was not found.');
  if (requisitionId && requisitionRow && !requisitionIsApprovedForPurchaseOrder(requisitionRow)) {
    markError('requisition_id', 'Approve this requisition before converting it to a purchase order.');
  }
  if (!payload.quotation_id) markError('quotation_id', 'Approve an RFQ before creating a purchase order.');

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
  } else if (!payloadItems.length) {
    const firstRow = lineRows[0];
    if (firstRow) {
      setPurchaseOrderLineItemMessage(firstRow, 'Add at least one inventory product line item.');
    }
    markError('line_items', 'Add at least one inventory product line item.');
  }

  if (hasValidationError) {
    focusFirstProcurementField(firstInvalidField, {
      company_id: ['po-company'],
      project_id: ['po-project'],
      vendor_id: ['po-vendor-search'],
      po_date: ['po-date'],
      requisition_id: ['po-source-rfq'],
      quotation_id: ['po-source-rfq'],
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
      focusFirstProcurementControl(['po-source-rfq']);
      return;
    }
    if (errorText.includes('quotation') || errorText.includes('rfq')) {
      setProcurementFieldMessage('quotation_id', err.message || 'Approved RFQ is required.');
      focusFirstProcurementControl(['po-source-rfq']);
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
  const poId = Number(id || 0) || 0;
  if (!poId || generatingPurchaseOrderBillIds.has(poId)) return;
  const row = procurementState.purchaseOrders.find((entry) => Number(entry.id) === Number(id));
  if (Number(row?.bill_count || 0) > 0) {
    showToast('This PO already has generated AP bill(s).', 'error');
    await loadProcurementData();
    return;
  }
  const preview = parsePurchaseOrderPaymentSchedulePreview(row?.payment_terms || '', row?.computed_total || row?.total_amount || 0);
  const scheduleText = preview.schedule.length
    ? ` Detected ${preview.schedule.length} bill(s), total ${preview.percentTotal.toFixed(2).replace(/\.00$/, '')}%.`
    : '';
  const confirmed = await openConfirmDialog({
    title: 'Generate AP Bills',
    message: `Generate AP bill schedule from ${row?.po_number || 'this PO'} payment terms?${scheduleText} These will be unpaid bills, not payments.`,
    noText: 'No',
    yesText: 'Generate'
  });
  if (!confirmed) return;

  generatingPurchaseOrderBillIds.add(poId);
  renderPurchaseOrders();
  try {
    const result = await apiFetch(`/api/procurement/purchase-orders/${poId}/generate-bills`, {
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
  } finally {
    generatingPurchaseOrderBillIds.delete(poId);
    renderPurchaseOrders();
  }
}

function resetGoodsReceiptForm() {
  ['grn-number', 'grn-received-by', 'grn-notes'].forEach((id) => {
    const el = $(id);
    if (el) el.value = '';
  });
  if ($('grn-po')) $('grn-po').value = '';
  if ($('grn-warehouse')) $('grn-warehouse').value = '';
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
  renderGoodsReceiptWarehouseOptions();

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
    if ($('grn-warehouse')) $('grn-warehouse').value = row.warehouse_id || row.receiving_warehouse_id || '';
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
    warehouse_id: $('grn-warehouse')?.value || '',
    received_date: $('grn-received-date').value,
    received_by: $('grn-received-by').value.trim(),
    status: $('grn-status')?.value || 'received',
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
  if (!payload.warehouse_id) markError('warehouse_id', 'Receiving Warehouse is required.');
  if (!payload.grn_number) markError('grn_number', 'GRN No. is required.');
  if (!payload.received_date) markError('received_date', 'Received Date is required.');

  if (hasValidationError) {
    focusFirstProcurementField(firstInvalidField, {
      po_id: ['grn-po'],
      warehouse_id: ['grn-warehouse'],
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
    if (errorText.includes('warehouse')) {
      setProcurementFieldMessage('warehouse_id', err.message || 'Receiving Warehouse is required.');
      focusFirstProcurementControl(['grn-warehouse']);
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
