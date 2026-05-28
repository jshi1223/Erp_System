'use strict';

let receivablesDb = [];
let collectionsDb = [];
let transactionsDb = [];
let serviceOrdersDb = [];
let serviceOrderProjectsDb = [];
let serviceOrderCompaniesDb = [];
let businessEntitiesDb = [];
let editingCollectionId = null;
let editingReceivableId = null;
let editingServiceOrderId = null;
let editingTransactionId = null;
let currentBusinessEntityContextId = '';
const BUSINESS_ENTITY_CONTEXT_KEY = 'kinaadman_businessEntityContext';
const BUSINESS_ENTITY_THEME_KEY = 'kinaadman_businessEntityTheme';
const AR_UI_STATE_KEY = 'accounts-receivable.uiState';
const AR_MODULE_MODE = getArModuleMode();
const arToolbarState = {
  serviceOrders: { search: '' },
  transactions: { search: '' },
  receivables: { search: '' },
  collections: {},
  summary: {}
};
const AR_TABS = new Set(['service-orders', 'invoices', 'collections', 'customer-balances', 'ar-aging', 'documents']);
let activeArTab = getDefaultArTabForMode();

function getArModuleMode() {
  const path = String(window.location.pathname || '').replace(/\/+$/, '').toLowerCase();
  if (path === '/service-operations') return 'service';
  if (path === '/sales-management') return 'sales';
  return 'finance';
}

function getAllowedArTabsForMode(mode = AR_MODULE_MODE) {
  if (mode === 'service') return new Set(['service-orders', 'documents']);
  if (mode === 'sales') return new Set(['invoices', 'collections', 'customer-balances']);
  return new Set(['invoices', 'collections', 'customer-balances', 'ar-aging']);
}

function getDefaultArTabForMode(mode = AR_MODULE_MODE) {
  return mode === 'service' ? 'service-orders' : 'invoices';
}

function isArTabAllowedForMode(tab, mode = AR_MODULE_MODE) {
  return getAllowedArTabsForMode(mode).has(String(tab || '').trim().toLowerCase());
}

function getDefaultArUiState() {
  return {
    activeTab: getDefaultArTabForMode(),
    toolbarState: {
      serviceOrders: { search: '' },
      transactions: { search: '' },
      receivables: { search: '' },
      collections: {},
      summary: {}
    }
  };
}

function loadArUiState() {
  try {
    const raw = localStorage.getItem(AR_UI_STATE_KEY);
    if (!raw) return getDefaultArUiState();
    const parsed = JSON.parse(raw);
    const defaults = getDefaultArUiState();
    return {
      activeTab: normalizeArTab(parsed.activeTab || defaults.activeTab),
      toolbarState: {
        serviceOrders: { search: String(parsed.toolbarState?.serviceOrders?.search || '') },
        transactions: { search: String(parsed.toolbarState?.transactions?.search || '') },
        receivables: { search: String(parsed.toolbarState?.receivables?.search || '') },
        collections: parsed.toolbarState?.collections || {},
        summary: parsed.toolbarState?.summary || {}
      }
    };
  } catch (_) {
    return getDefaultArUiState();
  }
}

function saveArUiState() {
  try {
    localStorage.setItem(AR_UI_STATE_KEY, JSON.stringify({
      activeTab: activeArTab,
      toolbarState: arToolbarState
    }));
  } catch (_) {
    // Ignore storage errors in restricted browser modes.
  }
}

function restoreArUiState() {
  const state = loadArUiState();
  activeArTab = state.activeTab;
  arToolbarState.serviceOrders.search = state.toolbarState.serviceOrders?.search || '';
  arToolbarState.transactions.search = state.toolbarState.transactions?.search || '';
  arToolbarState.receivables.search = state.toolbarState.receivables.search;
  arToolbarState.collections = state.toolbarState.collections || {};
  arToolbarState.summary = state.toolbarState.summary || {};
}

function normalizeArTab(value) {
  const tab = String(value || '').trim().toLowerCase();
  const aliases = {
    overview: getDefaultArTabForMode(),
    transactions: 'service-orders',
    receivables: 'invoices',
    payments: 'collections'
  };
  const normalized = aliases[tab] || tab;
  if (!AR_TABS.has(normalized)) return getDefaultArTabForMode();
  return isArTabAllowedForMode(normalized) ? normalized : getDefaultArTabForMode();
}

function syncArSummaryCards(tab = activeArTab) {
  const activeTab = normalizeArTab(tab);
  const grid = document.getElementById('ar-summary-grid');
  if (!grid) return;

  grid.dataset.activeTab = activeTab;
  grid.querySelectorAll('.ar-summary-card').forEach((card) => {
    const tabs = String(card.dataset.summaryTabs || '')
      .split(',')
      .map((value) => String(value || '').trim().toLowerCase())
      .map((value) => {
        if (value === 'receivables') return 'invoices';
        if (value === 'payments') return 'collections';
        return AR_TABS.has(value) ? value : '';
      })
      .filter(Boolean);
    card.hidden = !tabs.includes(activeTab);
  });
}

function setMetricText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function isInCurrentMonth(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
}

document.addEventListener('DOMContentLoaded', () => {
  applyArModuleModeChrome();
  restoreArUiState();
  const params = new URLSearchParams(window.location.search);
  activeArTab = params.has('tab') ? normalizeArTab(params.get('tab')) : activeArTab;
  const initialButton = document.querySelector(`.module-tab[data-tab="${activeArTab}"]`)
    || document.querySelector('.module-tab.active');
  switchTab(activeArTab, initialButton, { captureState: false, persistState: false });
  if (!params.has('tab')) {
    syncArTabUrl(activeArTab);
  }
  setTodayDefaults();
  loadBusinessEntitiesForAr();
  loadServiceOrders();
  loadReceivables();
  loadCollections();
  loadTransactions();
  if (typeof loadNotifications === 'function') loadNotifications();
});

function applyArModuleModeChrome() {
  document.body.dataset.moduleMode = AR_MODULE_MODE;

  const titleMap = {
    service: 'Service Operations',
    sales: 'Sales Management',
    finance: 'Accounts Receivable'
  };
  const badgeMap = {
    service: 'Service Operations Module',
    sales: 'Sales Management Module',
    finance: 'Financial Management - AR'
  };
  const title = titleMap[AR_MODULE_MODE] || titleMap.finance;
  const pageTitle = document.querySelector('.page-title');
  const headerSub = document.querySelector('header .brand-copy .header-sub');
  const badge = document.querySelector('.admin-badge');

  if (pageTitle) pageTitle.textContent = title;
  if (headerSub) headerSub.textContent = title;
  if (badge) badge.textContent = badgeMap[AR_MODULE_MODE] || badgeMap.finance;
  document.title = `KVSK CCTV & IT Solution - ${title}`;

  const allowedTabs = getAllowedArTabsForMode();
  const tabLabelsByMode = {
    service: {
      'service-orders': 'Service Orders',
      documents: 'Service Documents'
    },
    sales: {
      invoices: 'Sales Invoices',
      collections: 'Collections',
      'customer-balances': 'Customer Balances'
    },
    finance: {
      invoices: 'AR Invoices',
      collections: 'AR Collections',
      'customer-balances': 'Customer Balances',
      'ar-aging': 'AR Aging'
    }
  };
  const labels = tabLabelsByMode[AR_MODULE_MODE] || tabLabelsByMode.finance;
  document.querySelectorAll('.module-tab[data-tab]').forEach((tabNode) => {
    const tab = String(tabNode.getAttribute('data-tab') || '').trim().toLowerCase();
    const isAllowed = allowedTabs.has(tab);
    tabNode.hidden = !isAllowed;
    if (isAllowed && labels[tab]) tabNode.textContent = labels[tab];
  });
}

function getDefaultArBusinessEntityId() {
  const rows = Array.isArray(businessEntitiesDb) ? businessEntitiesDb : [];
  const defaultRow = rows.find(row => Number(row.is_default || 0) === 1) || rows[0] || null;
  return defaultRow ? String(defaultRow.id || '') : '';
}

function getCurrentBusinessEntityId() {
  const rows = Array.isArray(businessEntitiesDb) ? businessEntitiesDb : [];
  const stored = String(currentBusinessEntityContextId || localStorage.getItem(BUSINESS_ENTITY_CONTEXT_KEY) || '').trim();
  if (!rows.length) return stored;
  if (stored && rows.some(row => String(row.id || '') === stored)) {
    currentBusinessEntityContextId = stored;
    return stored;
  }
  const fallback = getDefaultArBusinessEntityId();
  currentBusinessEntityContextId = fallback;
  if (fallback) localStorage.setItem(BUSINESS_ENTITY_CONTEXT_KEY, fallback);
  return fallback;
}

function businessEntityMatches(row) {
  const selected = getCurrentBusinessEntityId();
  if (!selected) return true;
  const rowId = String(row?.business_entity_id || '').trim();
  return rowId === selected;
}

function renderArchivedProjectBadge(row = {}) {
  return row.project_is_archived === true || Number(row.project_is_archived || 0) === 1
    ? '<div style="margin-top:4px;"><span class="status-pill status-cancelled">Archived Project</span></div>'
    : '';
}

function getCurrentReceivableRows() {
  return (Array.isArray(receivablesDb) ? receivablesDb : []).filter(businessEntityMatches);
}

function getCurrentTransactionRows() {
  return (Array.isArray(transactionsDb) ? transactionsDb : []).filter(businessEntityMatches);
}

function getCurrentServiceOrderRows() {
  return (Array.isArray(serviceOrdersDb) ? serviceOrdersDb : []).filter(businessEntityMatches);
}

function getCurrentCollectionRows() {
  const receivableIds = new Set(getCurrentReceivableRows().map(row => Number(row.id || 0)).filter(Boolean));
  return (Array.isArray(collectionsDb) ? collectionsDb : []).filter(row => receivableIds.has(Number(row.ar_id || 0)));
}

function findBusinessEntityById(id) {
  const target = String(id || '').trim();
  return (Array.isArray(businessEntitiesDb) ? businessEntitiesDb : []).find(row => String(row.id || '') === target) || null;
}

function businessEntityShortLabel(row) {
  const name = String(row?.company_name || row?.entity_code || '').trim();
  if (/kvsk/i.test(name)) return 'KVSK';
  if (/kitsi|ktiis/i.test(name)) return 'KITSI';
  return name.replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'Company';
}

function businessEntityProfileValue(value, fallback = 'Not set') {
  const text = String(value || '').trim();
  return text || fallback;
}

function getBusinessEntityBrandProfile(row) {
  const name = String(row?.company_name || '').trim();
  const theme = String(row?.theme || '').trim().toLowerCase();
  const isKitsi = theme === 'kitsi' || /kitsi|ktiis|kinaadman/i.test(name);
  if (isKitsi) {
    return {
      theme: 'kitsi',
      logo: '/assets/img/kitsi-logo.png',
      alt: 'KITSI logo',
      primary: '#0898c7',
      primaryLight: '#22c7e8',
      primaryDark: '#005b96',
      accent: '#07a6d6',
      accent2: '#005b96'
    };
  }
  return {
    theme: 'kvsk',
    logo: '/assets/img/kvsk-logo-switch.png',
    alt: 'KVSK logo',
    primary: '#b42318',
    primaryLight: '#ef5b4f',
    primaryDark: '#4b1210',
    accent: '#d92d20',
    accent2: '#201313'
  };
}

function applyBusinessEntityBrand(row) {
  const profile = getBusinessEntityBrandProfile(row);
  document.body.dataset.businessEntityTheme = profile.theme;
  document.documentElement.style.setProperty('--primary', profile.primary);
  document.documentElement.style.setProperty('--primary-light', profile.primaryLight);
  document.documentElement.style.setProperty('--primary-dark', profile.primaryDark);
  document.documentElement.style.setProperty('--accent', profile.accent);
  document.documentElement.style.setProperty('--accent2', profile.accent2);
  document.querySelectorAll('.brand-mark, .sidebar-brand-mark, .user-modal-brand-mark').forEach((img) => {
    img.src = profile.logo;
    img.alt = profile.alt;
  });
  try {
    localStorage.setItem(BUSINESS_ENTITY_THEME_KEY, JSON.stringify({
      company_name: row?.company_name || (profile.theme === 'kitsi' ? 'KITSI' : 'KVSK CCTV & IT Solution'),
      theme: profile.theme,
      logo: profile.logo,
      alt: profile.alt,
      primary: profile.primary,
      primaryLight: profile.primaryLight,
      primaryDark: profile.primaryDark,
      accent: profile.accent,
      accent2: profile.accent2
    }));
  } catch (_) {}
}

function renderBusinessEntityProfilePanel(current = getCurrentBusinessEntityId()) {
  const panel = document.getElementById('business-profile-panel');
  if (!panel) return;
  const rows = Array.isArray(businessEntitiesDb) ? businessEntitiesDb : [];
  panel.innerHTML = rows.length
    ? rows.map((row) => {
        const id = String(row.id || '');
        const isActive = id === String(current || '');
        const profile = getBusinessEntityBrandProfile(row);
        return `
          <button class="business-profile-card${isActive ? ' is-active' : ''}" type="button" onclick="setBusinessEntityContext('${escHtml(id)}')">
            <span class="business-profile-logo-wrap"><img src="${escHtml(profile.logo)}" alt="${escHtml(profile.alt)}" /></span>
            <span class="business-profile-copy">
              <span class="business-profile-name">${escHtml(row.company_name || businessEntityShortLabel(row))}</span>
              <span class="business-profile-meta">${escHtml(row.entity_code || 'Operating company')} · ${escHtml(businessEntityProfileValue(row.status, 'active'))}${Number(row.is_default || 0) ? ' · Default' : ''}</span>
              <span class="business-profile-line">${escHtml(businessEntityProfileValue(row.contact_person, 'Contact person not set'))}</span>
              <span class="business-profile-line">${escHtml(businessEntityProfileValue(row.email || row.phone, 'Email/phone not set'))}</span>
            </span>
          </button>
        `;
      }).join('')
    : '<div class="business-profile-empty">Business profiles unavailable</div>';
}

function syncModalBusinessContext(row = findBusinessEntityById(getCurrentBusinessEntityId())) {
  const label = businessEntityShortLabel(row || findBusinessEntityById(getCurrentBusinessEntityId()) || {});
  const title = String(row?.company_name || label || 'Operating Company').trim();
  document.querySelectorAll('.modal-header, .modal-header-tight, .user-modal-brand').forEach((header) => {
    let badge = header.querySelector(':scope > .modal-business-context');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'modal-business-context';
      const closeBtn = header.querySelector(':scope > .modal-close, :scope > .close-btn');
      if (closeBtn) {
        header.insertBefore(badge, closeBtn);
      } else {
        header.appendChild(badge);
      }
    }
    badge.textContent = label || 'Company';
    badge.title = title;
    badge.setAttribute('aria-label', `Current business profile: ${title}`);
  });
}

function renderBusinessEntityContext() {
  const current = getCurrentBusinessEntityId();
  const activeEntity = findBusinessEntityById(current);
  applyBusinessEntityBrand(activeEntity);
  renderBusinessEntityProfilePanel(current);
  renderCurrentWorkspaceBadge(activeEntity);
  syncModalBusinessContext(activeEntity);
  document.querySelectorAll('header .brand-copy .header-logo').forEach((node) => {
    node.textContent = activeEntity?.company_name || 'Kinaadman ERP';
  });
}

function renderCurrentWorkspaceBadge(row = findBusinessEntityById(getCurrentBusinessEntityId())) {
  const badge = document.getElementById('current-workspace-badge');
  if (!badge) return;
  const label = businessEntityShortLabel(row || {});
  const title = String(row?.company_name || label || 'Workspace').trim();
  badge.textContent = `${label || 'ERP'} Workspace`;
  badge.title = title;
  badge.setAttribute('aria-label', `Current workspace: ${title}`);
}

function setBusinessEntityContext(id) {
  const nextId = String(id || '').trim();
  if (!nextId) return;
  currentBusinessEntityContextId = nextId;
  localStorage.setItem(BUSINESS_ENTITY_CONTEXT_KEY, nextId);
  renderBusinessEntityContext();
  populateReceivableSelect();
  renderServiceOrders();
  renderTransactions();
  renderReceivables();
  renderCollections();
  updateMetrics();
}

function loadBusinessEntitiesForAr() {
  fetch('/api/business-entities', { cache: 'no-store' })
    .then(async (r) => {
      const data = await r.json().catch(() => []);
      if (!r.ok) throw new Error(data.error || 'Unable to load operating companies.');
      return data;
    })
    .then((rows) => {
      businessEntitiesDb = Array.isArray(rows) ? rows : [];
      renderBusinessEntityContext();
    })
    .catch((err) => {
      console.error('Load AR operating companies error:', err);
      businessEntitiesDb = [];
      renderBusinessEntityContext();
    });
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

function goBackToDashboard() {
  window.location.href = '/admin?view=dashboard';
}

function doLogout() {
  fetch('/logout', { method: 'POST' }).finally(() => {
    window.location.href = '/';
  });
}

function captureArToolbarState(tab) {
  if (tab === 'service-orders') {
    arToolbarState.serviceOrders.search = document.getElementById('service-orders-search')?.value || '';
  } else if (tab === 'transactions') {
    arToolbarState.transactions.search = document.getElementById('transactions-search')?.value || '';
  } else
  if (tab === 'receivables' || tab === 'invoices') {
    arToolbarState.receivables.search = document.getElementById('receivable-search')?.value || '';
  }
}

function renderArToolbarControls(tab) {
  const actions = document.getElementById('module-toolbar-actions');
  if (!actions) return;

  const state = tab === 'service-orders'
    ? arToolbarState.serviceOrders
    : (tab === 'invoices' ? arToolbarState.receivables : (arToolbarState[tab] || {}));

  if (tab === 'service-orders') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="service-orders-search" type="text" placeholder="Search SO no., company, project, title, or status..." value="${escHtml(state.search || '')}" oninput="renderServiceOrders()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openServiceOrderCreateModal()">Add Service Order</button>
    `;
    return;
  }

  if (tab === 'transactions') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="transactions-search" type="text" placeholder="Search transaction no., customer, SO, or status..." value="${escHtml(state.search || '')}" oninput="renderTransactions()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openTransactionModal()">Add Transaction</button>
    `;
    return;
  }

  if (tab === 'invoices') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="receivable-search" type="text" placeholder="Search customer or invoice number..." value="${escHtml(state.search || '')}" oninput="renderReceivables()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openReceivableModal()">Add Invoice</button>
    `;
    return;
  }

  if (tab === 'collections') {
    actions.innerHTML = `
      <button class="btn btn-add btn-sm" type="button" onclick="openCollectionModal()">Record Collection</button>
    `;
    return;
  }

  actions.innerHTML = '';
}

function switchTab(tab, btn, options = {}) {
  const nextTab = normalizeArTab(tab);
  const captureState = options.captureState !== false;
  const persistState = options.persistState !== false;
  if (captureState) {
    captureArToolbarState(activeArTab);
  }
  document.querySelectorAll('.module-tab').forEach(node => node.classList.remove('active'));
  document.querySelectorAll('.content-section').forEach(node => node.classList.remove('active'));
  const tabButton = btn || document.querySelector(`.module-tab[data-tab="${nextTab}"]`);
  if (tabButton) tabButton.classList.add('active');
  document.getElementById(nextTab)?.classList.add('active');
  activeArTab = nextTab;
  renderArToolbarControls(nextTab);
  syncArSummaryCards(nextTab);
  if (nextTab === 'customer-balances') renderCustomerBalances();
  if (nextTab === 'ar-aging') renderArAging();
  if (nextTab === 'documents') renderDocuments();
  if (persistState) {
    saveArUiState();
    syncArTabUrl(nextTab);
  }
}

function syncArTabUrl(tab) {
  if (!window.history?.replaceState) return;
  const url = new URL(window.location.href);
  url.searchParams.set('tab', normalizeArTab(tab));
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  if (typeof syncSidebarActiveLinks === 'function') {
    syncSidebarActiveLinks();
  }
}

function setTodayDefaults() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('f-invoice-date').value = today;
  document.getElementById('f-collection-date').value = today;
  const transactionDate = document.getElementById('f-ar-transaction-date');
  if (transactionDate) transactionDate.value = today;
}

const formatMoney = formatPhpCurrency;

function formatArDate(value) {
  if (!value) return '-';
  const raw = String(value).slice(0, 10);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw || '-';
  return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function toDateInputValue(value) {
  if (!value) return '';
  const raw = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function formatLabel(value) {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function getTransactionPaidAmount(row) {
  const receivablePaid = Number(row?.receivable_paid_amount ?? NaN);
  if (Number.isFinite(receivablePaid)) return receivablePaid;
  return Number(row?.downpayment || 0);
}

function getTransactionBalance(row) {
  return Math.max(0, Number(row?.amount || 0) - getTransactionPaidAmount(row));
}

function getTransactionStatus(row) {
  if (typeof getComputedTransactionPaymentStatus === 'function') {
    return getComputedTransactionPaymentStatus(row);
  }
  const balance = getTransactionBalance(row);
  const paid = getTransactionPaidAmount(row);
  if (balance <= 0 && Number(row?.amount || 0) > 0) return 'paid';
  if (paid > 0) return 'partial';
  return String(row?.status || 'unpaid');
}

function normalizeTransactionModalStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['paid', 'partial', 'unpaid'].includes(status)) return status;
  if (status === 'partially_paid') return 'partial';
  return 'unpaid';
}

function highlightText(value, query) {
  const escaped = escHtml(value);
  const tokens = String(query || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return escaped;
  const pattern = tokens.sort((a, b) => b.length - a.length).map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  try {
    return pattern ? escaped.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>') : escaped;
  } catch (_) {
    return escaped;
  }
}

function getReceivableStatus(row) {
  if (Number(row.archived || 0) === 1) return 'cancelled';
  const total = Number(row.total_amount || 0);
  const paid = Number(row.paid_amount ?? row.downpayment ?? 0);
  if (paid >= total && total > 0) return 'paid';
  if (paid > 0) return 'partial';
  if (row.status === 'overdue') return 'overdue';
  const dueDate = row.due_date ? new Date(row.due_date) : null;
  if (dueDate && !Number.isNaN(dueDate.getTime())) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    dueDate.setHours(0, 0, 0, 0);
    if (dueDate < today) return 'overdue';
  }
  return 'sent';
}

function getReceivableUiStatus(row) {
  const computed = getReceivableStatus(row);
  if (computed === 'paid') return { key: 'paid', label: 'Paid', className: 'status-paid' };
  if (computed === 'partial') return { key: 'partial', label: 'Partial', className: 'status-partial' };
  if (computed === 'overdue') return { key: 'overdue', label: 'Overdue', className: 'status-overdue' };
  if (computed === 'cancelled') return { key: 'cancelled', label: 'Archived', className: 'status-cancelled' };
  return { key: 'unpaid', label: 'Unpaid', className: 'status-unpaid' };
}

function getPaymentTermsDays(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'due on receipt') return 0;
  const match = /^net\s+(\d{1,3})$/.exec(normalized);
  return match ? Number(match[1]) : null;
}

function setReceivablePaymentTermsValue(value = 'Net 30') {
  const termsInput = document.getElementById('f-payment-terms');
  if (!termsInput) return;
  const nextValue = String(value || 'Net 30').trim();
  const hasOption = Array.from(termsInput.options).some((option) => option.value === nextValue);
  if (!hasOption) {
    const option = document.createElement('option');
    option.value = nextValue;
    option.textContent = nextValue;
    termsInput.appendChild(option);
  }
  termsInput.value = nextValue;
}

function applyReceivablePaymentTerms() {
  const termsInput = document.getElementById('f-payment-terms');
  const invoiceDateInput = document.getElementById('f-invoice-date');
  const dueDateInput = document.getElementById('f-due-date');
  if (!termsInput || !invoiceDateInput || !dueDateInput) return;

  const days = getPaymentTermsDays(termsInput.value);
  if (days === null || !invoiceDateInput.value) return;

  const dueDate = new Date(`${invoiceDateInput.value}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) return;
  dueDate.setDate(dueDate.getDate() + days);
  dueDateInput.value = dueDate.toISOString().slice(0, 10);
}

async function loadReceivables() {
  try {
    const res = await fetch('/api/receivables?include_archived=1');
    const data = await res.json();
    receivablesDb = Array.isArray(data) ? data : [];
    updateMetrics();
    populateReceivableSelect();
    renderReceivables();
  } catch (err) {
    console.error(err);
    receivablesDb = [];
    populateReceivableSelect();
    renderReceivables();
    updateMetrics();
    showToast('Failed to load receivables', 'error');
  }
}

async function loadServiceOrders() {
  try {
    const res = await fetch('/api/service-orders?include_archived=1');
    const data = await res.json();
    serviceOrdersDb = Array.isArray(data) ? data : [];
    renderServiceOrders();
    updateMetrics();
  } catch (err) {
    console.error(err);
    serviceOrdersDb = [];
    renderServiceOrders();
    updateMetrics();
    showToast('Failed to load service orders', 'error');
  }
}

async function loadServiceOrderReferences() {
  const companyQuery = new URLSearchParams({ include_archived: '1' });
  const loadReferenceRows = async (url, label) => {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(data.error || `Failed to load ${label}`);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.error(`Service order ${label} reference load error:`, err);
      return [];
    }
  };

  const [projects, companies] = await Promise.all([
    loadReferenceRows('/api/projects?include_archived=1', 'projects'),
    loadReferenceRows(`/api/company-registry?${companyQuery.toString()}`, 'companies')
  ]);

  serviceOrderProjectsDb = (Array.isArray(projects) ? projects : []).filter(businessEntityMatches);
  serviceOrderCompaniesDb = (Array.isArray(companies) ? companies : []).filter(businessEntityMatches);
  populateServiceOrderReferenceSelects();
}

function getCurrentServiceOrderSelection() {
  return {
    project_id: document.getElementById('f-so-project')?.value || '',
    company_id: document.getElementById('f-so-company')?.value || ''
  };
}

function getServiceOrderCompanyLabel(company) {
  if (!company) return '';
  return [company.company_no, company.company_name].filter(Boolean).join(' - ') || `Company #${company.id}`;
}

function getServiceOrderCompanyRecordById(companyId) {
  const normalizedId = Number(companyId || 0) || 0;
  if (!normalizedId) return null;
  return (Array.isArray(serviceOrderCompaniesDb) ? serviceOrderCompaniesDb : [])
    .find((entry) => Number(entry.id || 0) === normalizedId) || null;
}

function findServiceOrderCompanyBySearchValue(value) {
  const target = String(value || '').trim().toLowerCase();
  if (!target) return null;
  const rows = Array.isArray(serviceOrderCompaniesDb) ? serviceOrderCompaniesDb : [];

  const exact = rows.find((company) => {
    const label = getServiceOrderCompanyLabel(company).toLowerCase();
    return String(company.id || '').toLowerCase() === target
      || String(company.company_no || '').toLowerCase() === target
      || String(company.company_name || '').toLowerCase() === target
      || label === target;
  });
  if (exact) return exact;

  const partial = rows.filter((company) => {
    const haystack = [
      company.company_no,
      company.company_name,
      company.contact_person,
      company.address,
      getServiceOrderCompanyLabel(company)
    ].map((part) => String(part || '').toLowerCase()).join(' ');
    return haystack.includes(target);
  });

  return partial.length === 1 ? partial[0] : null;
}

function setServiceOrderCompanySelection(companyId = '', companyLabel = '', { lockToProject = false } = {}) {
  const hidden = document.getElementById('f-so-company');
  const input = document.getElementById('f-so-company-search');
  const results = document.getElementById('f-so-company-results');

  if (hidden) hidden.value = companyId ? String(companyId) : '';
  if (input) {
    input.value = companyLabel || '';
    input.readOnly = Boolean(lockToProject);
    input.classList.toggle('is-project-filled', Boolean(lockToProject));
  }
  if (results) {
    results.style.display = 'none';
    results.innerHTML = '';
  }
}

function filterServiceOrderCompanies(showAll = false) {
  const input = document.getElementById('f-so-company-search');
  const hidden = document.getElementById('f-so-company');
  const results = document.getElementById('f-so-company-results');
  if (!input || !hidden || !results) return;

  if (input.readOnly) {
    results.style.display = 'none';
    results.innerHTML = '';
    return;
  }

  const query = String(input.value || '').trim().toLowerCase();
  const exact = findServiceOrderCompanyBySearchValue(input.value);
  hidden.value = exact ? String(exact.id || '') : '';

  if (!query && !showAll) {
    results.style.display = 'none';
    results.innerHTML = '';
    return;
  }

  const rows = (Array.isArray(serviceOrderCompaniesDb) ? serviceOrderCompaniesDb : [])
    .filter((company) => {
      if (!query) return true;
      const haystack = [
        company.company_no,
        company.company_name,
        company.contact_person,
        company.address
      ].map((part) => String(part || '').toLowerCase()).join(' ');
      return haystack.includes(query);
    })
    .slice(0, 10);

  results.innerHTML = rows.length ? rows.map((company) => {
    const label = getServiceOrderCompanyLabel(company);
    const sub = [company.contact_person, company.phone, company.address].filter(Boolean).join(' • ') || 'Company registry record';
    return `
      <div class="search-result-item" data-id="${escHtml(company.id)}" data-label="${escHtml(label)}">
        <div class="search-result-name">${escHtml(label)}</div>
        <div class="search-result-sub">${escHtml(sub)}</div>
      </div>
    `;
  }).join('') : '<div class="search-result-item search-result-empty">No companies found</div>';
  results.style.display = 'block';
}

function setupServiceOrderCompanyPicker() {
  const results = document.getElementById('f-so-company-results');
  if (results && results.dataset.bound !== '1') {
    results.dataset.bound = '1';
    results.addEventListener('click', (event) => {
      const item = event.target.closest('.search-result-item');
      if (!item || item.classList.contains('search-result-empty')) return;
      setServiceOrderCompanySelection(item.dataset.id, item.dataset.label);
    });
  }

  if (document.body && document.body.dataset.arServiceOrderCompanyPickerBound !== '1') {
    document.body.dataset.arServiceOrderCompanyPickerBound = '1';
    document.addEventListener('click', (event) => {
      if (event.target.closest('.service-order-company-search')) return;
      const companyResults = document.getElementById('f-so-company-results');
      if (companyResults) {
        companyResults.style.display = 'none';
        companyResults.innerHTML = '';
      }
    });
  }
}

function populateServiceOrderReferenceSelects(selected = {}) {
  const projectSelect = document.getElementById('f-so-project');

  if (projectSelect) {
    projectSelect.innerHTML = '<option value="">Select Project</option>' + serviceOrderProjectsDb.map((project) => {
      const label = [project.project_docno, project.project_name].filter(Boolean).join(' - ') || `Project #${project.id}`;
      return `<option value="${Number(project.id || 0)}">${escHtml(label)}</option>`;
    }).join('');
    projectSelect.value = String(selected.project_id || '');
  }

  const selectedCompany = getServiceOrderCompanyRecordById(selected.company_id);
  if (selectedCompany) {
    setServiceOrderCompanySelection(selectedCompany.id, getServiceOrderCompanyLabel(selectedCompany));
  }
  setupServiceOrderCompanyPicker();
}

function syncServiceOrderCompanyFromProject() {
  const projectId = Number(document.getElementById('f-so-project')?.value || 0);
  if (!projectId) {
    setServiceOrderCompanySelection('', '', { lockToProject: false });
    return;
  }
  const project = serviceOrderProjectsDb.find(item => Number(item.id || 0) === projectId);
  const companyId = Number(project?.company_id || 0);
  if (!project || !companyId) {
    setServiceOrderCompanySelection('', '', { lockToProject: false });
    return;
  }
  const company = getServiceOrderCompanyRecordById(companyId);
  if (company) {
    setServiceOrderCompanySelection(company.id, getServiceOrderCompanyLabel(company), { lockToProject: true });
  } else {
    setServiceOrderCompanySelection('', '', { lockToProject: false });
  }
}

async function loadCollections() {
  try {
    const res = await fetch('/api/payments?type=ar');
    const data = await res.json();
    collectionsDb = Array.isArray(data) ? data : [];
    renderCollections();
    updateMetrics();
  } catch (err) {
    console.error(err);
    collectionsDb = [];
    renderCollections();
    updateMetrics();
    showToast('Failed to load collections', 'error');
  }
}

async function loadTransactions() {
  try {
    const res = await fetch('/api/transactions');
    const data = await res.json();
    transactionsDb = Array.isArray(data) ? data : [];
    renderTransactions();
    renderReceivables();
    updateMetrics();
  } catch (err) {
    console.error(err);
    transactionsDb = [];
    renderTransactions();
    renderReceivables();
    updateMetrics();
  }
}

function getTransactionRelationLabel(row) {
  const docNo = String(row.docno || 'Transaction').trim() || 'Transaction';
  const customer = String(row.company_name || row.client || 'Unknown Company').trim() || 'Unknown Company';
  const amount = formatMoney(Number(row.amount || 0));
  const statusFn = typeof getComputedTransactionPaymentStatus === 'function'
    ? getComputedTransactionPaymentStatus(row)
    : String(row.status || 'unpaid');
  const status = String(statusFn || 'unpaid').trim().toUpperCase();
  return `${docNo} - ${customer} (${amount}, ${status})`;
}

function getTransactionRelationMeta(row) {
  const parts = [];
  if (row.company_no) parts.push(`Company ${row.company_no}`);
  if (row.date) parts.push(`Date ${row.date}`);
  if (row.pono) parts.push(`Customer PO ${row.pono}`);
  return parts.length ? parts.join(' • ') : 'Linked ERP transaction';
}

function getTransactionRelationHelp() {
  return 'Choose the source transaction so the receivable follows the company relationship instead of being entered as an isolated record.';
}

function getReceivableFieldMessageNode(fieldName) {
  return document.querySelector(`[data-receivable-field-message="${fieldName}"]`);
}

function clearReceivableFieldMessages() {
  document.querySelectorAll('[data-receivable-field-message]').forEach((node) => {
    node.textContent = '';
    node.classList.add('is-hidden');
  });
}

function setReceivableFieldMessage(fieldName, message) {
  const node = getReceivableFieldMessageNode(fieldName);
  if (!node) return;
  const text = String(message || '').trim();
  node.textContent = text;
  node.classList.toggle('is-hidden', !text);
}

function resetReceivableForm() {
  const today = new Date().toISOString().split('T')[0];
  const fieldIds = [
    'f-customer-name',
    'f-invoice-number',
    'f-due-date',
    'f-total-amount',
    'f-ar-notes'
  ];
  fieldIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const invoiceDate = document.getElementById('f-invoice-date');
  if (invoiceDate) invoiceDate.value = today;
  const status = document.getElementById('f-ar-status');
  if (status) status.value = 'draft';
  setReceivablePaymentTermsValue('Net 30');
  applyReceivablePaymentTerms();
  clearReceivableFieldMessages();
  setReceivableTransactionSelection('', '');
  renderReceivableTransactionResults('', false);
}

function syncReceivableModalMode() {
  const title = document.querySelector('#receivable-modal-backdrop .modal-title');
  const saveBtn = document.querySelector('#receivable-modal-backdrop .btn-save');
  const transactionSearch = document.getElementById('f-transaction-search');
  if (title) title.textContent = editingReceivableId ? 'Edit Receivable' : 'Add Receivable';
  if (saveBtn) saveBtn.textContent = editingReceivableId ? 'Save Changes' : 'Save Receivable';
  if (transactionSearch) {
    transactionSearch.disabled = Boolean(editingReceivableId);
    transactionSearch.placeholder = editingReceivableId
      ? 'Linked transaction locked on edit'
      : 'Search transaction number or company...';
  }
}

function setReceivableTransactionSelection(transactionId, label) {
  const hidden = document.getElementById('f-transaction-id');
  const search = document.getElementById('f-transaction-search');
  const results = document.getElementById('f-transaction-results');
  const help = document.getElementById('f-transaction-help');
  if (hidden) hidden.value = transactionId ? String(transactionId) : '';
  if (search) search.value = label || '';
  if (results) results.style.display = 'none';
  if (help) help.textContent = transactionId ? 'Linked transaction selected. Customer, invoice number, and amount can be synced from this source record.' : getTransactionRelationHelp();
  setReceivableFieldMessage('transaction', '');
}

function applyReceivableTransactionSelection(transactionId) {
  const selected = transactionsDb.find(row => Number(row.id) === Number(transactionId));
  if (!selected) return;

  const customerName = String(selected.company_name || selected.client || '').trim();
  const invoiceNumber = String(selected.docno || '').trim();
  const invoiceDate = String(selected.date || '').trim();
  const totalAmount = Number(selected.amount || 0);
  const paidAmount = Number(selected.receivable_paid_amount || selected.paid_amount || selected.downpayment || 0);
  const mappedStatus = totalAmount > 0 && paidAmount >= totalAmount
    ? 'paid'
    : (paidAmount > 0 ? 'partial' : 'sent');

  if (customerName) document.getElementById('f-customer-name').value = customerName;
  if (invoiceNumber) document.getElementById('f-invoice-number').value = invoiceNumber;
  if (invoiceDate) document.getElementById('f-invoice-date').value = invoiceDate;
  const termsInput = document.getElementById('f-payment-terms');
  if (termsInput && !termsInput.value) setReceivablePaymentTermsValue('Net 30');
  applyReceivablePaymentTerms();
  document.getElementById('f-total-amount').value = totalAmount ? String(totalAmount) : '';
  document.getElementById('f-ar-status').value = mappedStatus;
}

function renderReceivableTransactionResults(query = '', showAll = false) {
  const wrapper = document.getElementById('f-transaction-results');
  const search = document.getElementById('f-transaction-search');
  if (!wrapper || !search) return;

  const q = String(query || '').trim().toLowerCase();
  const selectedId = String(document.getElementById('f-transaction-id')?.value || '');
  const rows = getCurrentTransactionRows().filter((row) => {
    const haystack = [
      row.docno,
      row.client,
      row.company_no,
      row.company_name,
      row.description,
      row.status,
      row.checkno,
      row.pono
    ].join(' ').toLowerCase();
    return !q || haystack.includes(q);
  }).slice(0, showAll ? 12 : 8);

  if (!q && !showAll) {
    wrapper.style.display = 'none';
    wrapper.innerHTML = '';
    return;
  }

  if (!rows.length) {
    wrapper.innerHTML = '<div class="search-result-empty">No matching transactions found.</div>';
    wrapper.style.display = 'block';
    return;
  }

  wrapper.innerHTML = rows.map((row) => {
    const label = getTransactionRelationLabel(row);
    const meta = getTransactionRelationMeta(row);
    const isSelected = String(row.id) === selectedId;
    return `
      <div class="search-result-item${isSelected ? ' is-selected' : ''}" data-id="${escHtml(row.id)}" data-label="${escHtml(label)}">
        <div class="search-result-name">${highlightText(label, q)}</div>
        <div class="search-result-sub">${highlightText(meta, q)}</div>
      </div>
    `;
  }).join('');
  wrapper.style.display = 'block';
}

function handleReceivableTransactionSearch(event, showAll = false) {
  const searchInput = event?.target || document.getElementById('f-transaction-search');
  const hiddenInput = document.getElementById('f-transaction-id');
  const currentLabel = String(searchInput?.value || '');
  if (hiddenInput && hiddenInput.value) {
    const selectedRow = transactionsDb.find(row => String(row.id) === String(hiddenInput.value));
    const selectedLabel = selectedRow ? getTransactionRelationLabel(selectedRow) : '';
    if (currentLabel !== selectedLabel) {
      hiddenInput.value = '';
    }
  }
  renderReceivableTransactionResults(currentLabel, showAll);
}

function initReceivableTransactionSearch() {
  const searchInput = document.getElementById('f-transaction-search');
  const results = document.getElementById('f-transaction-results');
  if (!searchInput || !results || searchInput.dataset.bound === '1') return;

  searchInput.dataset.bound = '1';
  searchInput.addEventListener('input', handleReceivableTransactionSearch);
  searchInput.addEventListener('focus', () => {
    handleReceivableTransactionSearch({ target: searchInput }, true);
  });

  results.addEventListener('click', (event) => {
    const item = event.target.closest('.search-result-item');
    if (!item) return;
    const id = item.getAttribute('data-id');
    const label = item.getAttribute('data-label') || '';
    setReceivableTransactionSelection(id, label);
    applyReceivableTransactionSelection(id);
  });

  document.addEventListener('click', (event) => {
    const wrapper = searchInput.closest('.receivable-transaction-search');
    if (wrapper && !wrapper.contains(event.target)) {
      results.style.display = 'none';
    }
  });
}

function updateMetrics() {
  const receivables = getCurrentReceivableRows();
  const collections = getCurrentCollectionRows();
  const serviceOrders = getCurrentServiceOrderRows();
  const transactions = getCurrentTransactionRows();
  const totalReceivable = receivables.reduce((sum, row) => {
    if (Number(row.archived || 0) === 1) return sum;
    return sum + Math.max(0, Number(row.total_amount || 0) - Number(row.paid_amount || 0));
  }, 0);
  const openCount = receivables.filter(row => !['paid', 'cancelled'].includes(getReceivableStatus(row))).length;
  const today = new Date().toISOString().split('T')[0];
  const overdueAmount = receivables.reduce((sum, row) => {
    if (Number(row.archived || 0) === 1) return sum;
    const balance = Math.max(0, Number(row.total_amount || 0) - Number(row.paid_amount || 0));
    return row.due_date && row.due_date < today && balance > 0 ? sum + balance : sum;
  }, 0);
  const draftSent = receivables.filter(row => ['draft', 'sent'].includes(getReceivableStatus(row))).length;
  const partialCount = receivables.filter(row => getReceivableStatus(row) === 'partial').length;
  const paidCount = receivables.filter(row => getReceivableStatus(row) === 'paid').length;
  const collectionTotal = collections.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const collectionThisMonth = collections
    .filter((row) => isInCurrentMonth(row.payment_date))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const collectionMethods = new Set(collections.map((row) => String(row.payment_method || '').trim()).filter(Boolean));
  const collectionInvoices = new Set(collections.map((row) => Number(row.ar_id || 0)).filter(Boolean));
  const averageCollection = collections.length ? collectionTotal / collections.length : 0;
  const activeServiceOrderStatuses = new Set(['issued', 'accepted', 'in_progress']);
  const serviceOrderTotal = serviceOrders
    .filter((row) => Number(row.is_archived || 0) !== 1)
    .reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const linkedServiceOrderTransactions = serviceOrders.reduce((sum, row) => sum + Number(row.transaction_count || 0), 0);
  const transactionTotal = transactions.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const transactionBalance = transactions.reduce((sum, row) => sum + getTransactionBalance(row), 0);

  setMetricText('metric-so-count', serviceOrders.length);
  setMetricText('metric-so-active', serviceOrders.filter((row) => activeServiceOrderStatuses.has(String(row.status || '').toLowerCase()) && Number(row.is_archived || 0) !== 1).length);
  setMetricText('metric-so-completed', serviceOrders.filter((row) => String(row.status || '').toLowerCase() === 'completed').length);
  setMetricText('metric-so-total', formatMoney(serviceOrderTotal));
  setMetricText('metric-so-linked-transactions', linkedServiceOrderTransactions);
  setMetricText('metric-so-archived', serviceOrders.filter((row) => Number(row.is_archived || 0) === 1).length);
  setMetricText('metric-transaction-count', transactions.length);
  setMetricText('metric-transaction-invoices', transactions.filter((row) => String(row.type || '').toLowerCase() === 'invoice').length);
  setMetricText('metric-transaction-receipts', transactions.filter((row) => String(row.type || '').toLowerCase() === 'receipt').length);
  setMetricText('metric-transaction-total', formatMoney(transactionTotal));
  setMetricText('metric-transaction-balance', formatMoney(transactionBalance));
  setMetricText('metric-transaction-linked-so', transactions.filter((row) => Number(row.service_order_id || 0) > 0).length);
  setMetricText('metric-total-receivable', formatMoney(totalReceivable));
  setMetricText('metric-open-count', openCount);
  setMetricText('metric-overdue-amount', formatMoney(overdueAmount));
  setMetricText('metric-draft-sent', draftSent);
  setMetricText('metric-partial-count', partialCount);
  setMetricText('metric-paid-count', paidCount);
  setMetricText('metric-collection-count', collections.length);
  setMetricText('metric-collection-total', formatMoney(collectionTotal));
  setMetricText('metric-collection-this-month', formatMoney(collectionThisMonth));
  setMetricText('metric-collection-methods', collectionMethods.size);
  setMetricText('metric-collection-average', formatMoney(averageCollection));
  setMetricText('metric-collection-invoices', collectionInvoices.size);
  setMetricText('metric-customer-count', getCustomerBalanceRows().length);
  setMetricText('metric-customer-open-count', getCustomerBalanceRows().filter(row => row.balance > 0).length);
  setMetricText('metric-customer-balance-total', formatMoney(totalReceivable));
  setMetricText('metric-customer-overdue-total', formatMoney(overdueAmount));
  setMetricText('metric-customer-top-balance', formatMoney(getCustomerBalanceRows()[0]?.balance || 0));
  const aging = getArAgingBuckets();
  setMetricText('metric-ar-aging-current', formatMoney(aging.current));
  setMetricText('metric-ar-aging-30', formatMoney(aging.d30));
  setMetricText('metric-ar-aging-60', formatMoney(aging.d60));
  setMetricText('metric-ar-aging-90', formatMoney(aging.d90));
  setMetricText('metric-ar-aging-over-90', formatMoney(aging.over90));
  const docs = getDocumentRows();
  setMetricText('metric-documents-count', docs.length);
  setMetricText('metric-documents-transactions', docs.filter(row => row.type === 'Transaction').length);
  setMetricText('metric-documents-service-orders', docs.filter(row => row.type === 'Service Order').length);
  setMetricText('metric-documents-invoices', docs.filter(row => row.type === 'Invoice').length);
  setMetricText('metric-documents-missing', docs.filter(row => !String(row.file || '').trim()).length);
  renderCustomerBalances();
  renderArAging();
  renderDocuments();
}

function getReceivableBalance(row) {
  return Math.max(0, Number(row?.total_amount || 0) - Number(row?.paid_amount || 0));
}

function getCustomerBalanceRows() {
  const grouped = new Map();
  getCurrentReceivableRows().forEach((row) => {
    if (Number(row.archived || 0) === 1) return;
    const customer = String(row.customer_name || 'Unassigned Customer').trim();
    const current = grouped.get(customer) || {
      customer_name: customer,
      invoice_count: 0,
      open_invoices: 0,
      total_amount: 0,
      paid_amount: 0,
      balance: 0,
      overdue: 0
    };
    const balance = getReceivableBalance(row);
    current.invoice_count += 1;
    current.open_invoices += balance > 0 ? 1 : 0;
    current.total_amount += Number(row.total_amount || 0);
    current.paid_amount += Number(row.paid_amount || 0);
    current.balance += balance;
    current.overdue += row.due_date && row.due_date < new Date().toISOString().split('T')[0] ? balance : 0;
    grouped.set(customer, current);
  });
  return Array.from(grouped.values()).sort((a, b) => b.balance - a.balance);
}

function getReceivableAgingBucket(row) {
  const balance = getReceivableBalance(row);
  const bucket = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
  if (balance <= 0) return bucket;
  const dueDate = new Date(row?.due_date);
  const today = new Date();
  if (Number.isNaN(dueDate.getTime()) || dueDate >= today) {
    bucket.current = balance;
    return bucket;
  }
  const days = Math.floor((today - dueDate) / (24 * 60 * 60 * 1000));
  if (days <= 30) bucket.d30 = balance;
  else if (days <= 60) bucket.d60 = balance;
  else if (days <= 90) bucket.d90 = balance;
  else bucket.over90 = balance;
  return bucket;
}

function getArAgingBuckets() {
  return getCurrentReceivableRows().reduce((sum, row) => {
    const bucket = getReceivableAgingBucket(row);
    sum.current += bucket.current;
    sum.d30 += bucket.d30;
    sum.d60 += bucket.d60;
    sum.d90 += bucket.d90;
    sum.over90 += bucket.over90;
    return sum;
  }, { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 });
}

function getDocumentRows() {
  const transactionDocs = getCurrentTransactionRows()
    .filter(row => String(row.pdfFilename || '').trim())
    .map(row => ({
      type: 'Transaction',
      number: row.docno || `TX #${row.id}`,
      party: row.company_name || row.client || '-',
      date: row.date,
      status: getTransactionStatus(row),
      file: row.pdfFilename
    }));
  const serviceOrderDocs = getCurrentServiceOrderRows()
    .filter(row => String(row.pdfFilename || '').trim())
    .map(row => ({
      type: 'Service Order',
      number: row.so_number || `SO #${row.id}`,
      party: row.company_name || '-',
      date: row.service_date,
      status: row.status,
      file: row.pdfFilename
    }));
  const invoiceDocs = getCurrentReceivableRows().map(row => ({
    type: 'Invoice',
    number: row.invoice_number || `INV #${row.id}`,
    party: row.customer_name || '-',
    date: row.invoice_date,
    status: getReceivableStatus(row),
    file: ''
  }));
  if (AR_MODULE_MODE === 'service') return serviceOrderDocs;
  if (AR_MODULE_MODE === 'sales') return [...transactionDocs, ...invoiceDocs];
  return [...transactionDocs, ...invoiceDocs];
}

function renderServiceOrders() {
  const searchInput = document.getElementById('service-orders-search');
  const rawSearch = String(searchInput?.value || '');
  const q = rawSearch.toLowerCase().trim();
  if (searchInput) {
    arToolbarState.serviceOrders.search = rawSearch;
    saveArUiState();
  }
  const tbody = document.getElementById('service-orders-tbody');
  if (!tbody) return;

  const rows = getCurrentServiceOrderRows().filter((row) => {
    const haystack = [
      row.so_number,
      row.company_no,
      row.company_name,
      row.project_docno,
      row.project_name,
      row.service_type,
      row.service_title,
      row.status,
      row.transaction_docnos
    ].join(' ').toLowerCase();
    return !q || haystack.includes(q);
  });

  tbody.innerHTML = rows.length ? rows.map((row) => {
    const isArchived = Number(row.is_archived || 0) === 1;
    const txDocnos = String(row.transaction_docnos || '').trim();
    const transactionCount = Number(row.transaction_count || 0) || (txDocnos ? txDocnos.split(',').filter(Boolean).length : 0);
    const transactionLabel = txDocnos
      ? (transactionCount > 1 ? `${txDocnos.split(',')[0].trim()} (+${transactionCount - 1})` : txDocnos.split(',')[0].trim())
      : '-';
    return `
      <tr>
        <td style="font-weight:600;color:var(--primary)">${highlightText(row.so_number || '-', q)}</td>
        <td>${highlightText([row.company_no, row.company_name].filter(Boolean).join(' - ') || '-', q)}</td>
        <td>${highlightText([row.project_docno, row.project_name].filter(Boolean).join(' - ') || '-', q)}${renderArchivedProjectBadge(row)}</td>
        <td>${escHtml(formatArDate(row.service_date))}</td>
        <td>${highlightText(formatLabel(row.service_type || '-'), q)}</td>
        <td>${highlightText(row.service_title || '-', q)}</td>
        <td title="${escHtml(txDocnos || '-')}">${highlightText(transactionLabel, q)}</td>
        <td class="text-right">${formatMoney(row.total_amount || 0)}</td>
        <td><span class="status-pill ${isArchived ? 'status-cancelled' : ''}">${highlightText(isArchived ? 'Archived' : formatLabel(row.status || 'issued'), q)}</span></td>
        <td>
          <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
            ${isArchived
              ? `<button class="btn btn-save btn-sm" type="button" onclick="restoreServiceOrder(${Number(row.id)})">Restore</button>`
              : `<button class="btn btn-edit btn-sm" type="button" onclick="openServiceOrderEditModal(${Number(row.id)})">Edit</button>
                 <button class="btn btn-cancel btn-sm" type="button" onclick="archiveServiceOrder(${Number(row.id)})">Archive</button>`}
          </div>
        </td>
      </tr>
    `;
  }).join('') : '<tr class="empty-row"><td colspan="10">No service orders found.</td></tr>';
}

function renderTransactions() {
  const searchInput = document.getElementById('transactions-search');
  const rawSearch = String(searchInput?.value || '');
  const q = rawSearch.toLowerCase().trim();
  if (searchInput) {
    arToolbarState.transactions.search = rawSearch;
    saveArUiState();
  }
  const tbody = document.getElementById('transactions-tbody');
  if (!tbody) return;

  const rows = getCurrentTransactionRows().filter((row) => {
    const haystack = [
      row.docno,
      row.type,
      row.client,
      row.company_no,
      row.company_name,
      row.service_order_no,
      row.service_order_title,
      row.description,
      row.status
    ].join(' ').toLowerCase();
    return !q || haystack.includes(q);
  });

  tbody.innerHTML = rows.length ? rows.map((row) => {
    const amount = Number(row.amount || 0);
    const paid = getTransactionPaidAmount(row);
    const balance = getTransactionBalance(row);
    const status = formatLabel(getTransactionStatus(row));
    const serviceOrderLabel = [row.service_order_no, row.service_order_title].filter(Boolean).join(' - ') || '-';
    return `
      <tr>
        <td style="font-weight:600;color:var(--primary)">${highlightText(row.docno || '-', q)}</td>
        <td>${highlightText(formatLabel(row.type || '-'), q)}</td>
        <td>${highlightText(row.company_name || row.client || '-', q)}</td>
        <td>${highlightText(serviceOrderLabel, q)}</td>
        <td>${highlightText(row.description || '-', q)}</td>
        <td class="text-right">${formatMoney(amount)}</td>
        <td class="text-right">${formatMoney(paid)}</td>
        <td class="text-right">${formatMoney(balance)}</td>
        <td>${escHtml(formatArDate(row.date))}</td>
        <td><span class="status-pill">${highlightText(status, q)}</span></td>
        <td>
          <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
            <button class="btn btn-edit btn-sm" type="button" onclick="openTransactionModal(${Number(row.id)})">Edit</button>
            <button class="btn btn-cancel btn-sm" type="button" onclick="archiveTransaction(${Number(row.id)})">Archive</button>
          </div>
        </td>
      </tr>
    `;
  }).join('') : '<tr class="empty-row"><td colspan="11">No transactions found.</td></tr>';
}

function populateTransactionServiceOrderSelect(selectedId = '') {
  const select = document.getElementById('f-ar-transaction-service-order');
  if (!select) return;
  const selectedValue = String(selectedId || '');
  const rows = (Array.isArray(serviceOrdersDb) ? serviceOrdersDb : [])
    .filter(businessEntityMatches)
    .filter((row) => Number(row.is_archived || 0) !== 1 || String(row.id) === selectedValue);
  select.innerHTML = '<option value="">No linked service order</option>' + rows.map((row) => {
    const label = [
      row.so_number || `SO #${row.id}`,
      row.company_name,
      row.service_title
    ].filter(Boolean).join(' - ');
    return `<option value="${Number(row.id || 0)}">${escHtml(label)}</option>`;
  }).join('');
  select.value = selectedValue;
}

function getSelectedTransactionServiceOrder() {
  const serviceOrderId = Number(document.getElementById('f-ar-transaction-service-order')?.value || 0);
  return serviceOrderId
    ? serviceOrdersDb.find((row) => Number(row.id || 0) === serviceOrderId) || null
    : null;
}

function applyTransactionServiceOrderSelection() {
  const row = getSelectedTransactionServiceOrder();
  if (!row) return;
  const customerInput = document.getElementById('f-ar-transaction-client');
  const descriptionInput = document.getElementById('f-ar-transaction-description');
  const amountInput = document.getElementById('f-ar-transaction-amount');
  const dateInput = document.getElementById('f-ar-transaction-date');
  if (customerInput && !customerInput.value.trim()) {
    customerInput.value = row.company_name || row.client_name || '';
  }
  if (descriptionInput && !descriptionInput.value.trim()) {
    descriptionInput.value = row.service_title || row.description || '';
  }
  if (amountInput && !Number(amountInput.value || 0) && Number(row.total_amount || 0) > 0) {
    amountInput.value = String(Number(row.total_amount || 0));
  }
  if (dateInput && !dateInput.value) {
    dateInput.value = toDateInputValue(row.service_date);
  }
}

async function prefillTransactionDocno() {
  const docnoInput = document.getElementById('f-ar-transaction-docno');
  if (!docnoInput || editingTransactionId) return;
  docnoInput.placeholder = 'Auto-generated';
  try {
    const res = await fetch(`/api/transactions/next-docno?business_entity_id=${encodeURIComponent(getCurrentBusinessEntityId() || getDefaultArBusinessEntityId() || '')}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.docno && !docnoInput.value) {
      docnoInput.value = data.docno;
    }
  } catch (_) {
    // Auto-generation still happens server-side when the field is blank.
  }
}

async function prefillServiceOrderNumber() {
  const input = document.getElementById('f-so-number');
  if (!input || editingServiceOrderId) return;
  input.value = '';
  try {
    const res = await fetch(`/api/service-orders/next-number?business_entity_id=${encodeURIComponent(getCurrentBusinessEntityId() || getDefaultArBusinessEntityId() || '')}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.so_number && !input.value) {
      input.value = data.so_number;
    }
  } catch (_) {
    // Auto-generation still happens server-side when the field is blank.
  }
}

function resetTransactionForm() {
  [
    'f-ar-transaction-docno',
    'f-ar-transaction-client',
    'f-ar-transaction-description',
    'f-ar-transaction-amount',
    'f-ar-transaction-paid',
    'f-ar-transaction-checkno',
    'f-ar-transaction-pono'
  ].forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.value = '';
  });
  const today = new Date().toISOString().slice(0, 10);
  const type = document.getElementById('f-ar-transaction-type');
  const status = document.getElementById('f-ar-transaction-status');
  const date = document.getElementById('f-ar-transaction-date');
  if (type) type.value = 'invoice';
  if (status) status.value = 'unpaid';
  if (date) date.value = today;
  populateTransactionServiceOrderSelect('');
}

async function openTransactionModal(id = null) {
  editingTransactionId = Number(id || 0) || null;
  const row = editingTransactionId
    ? transactionsDb.find((item) => Number(item.id || 0) === editingTransactionId)
    : null;
  if (editingTransactionId && !row) {
    editingTransactionId = null;
    showToast('Transaction not found', 'error');
    return;
  }

  resetTransactionForm();
  populateTransactionServiceOrderSelect(row?.service_order_id || '');

  const title = document.getElementById('ar-transaction-modal-title');
  const saveBtn = document.getElementById('ar-transaction-save-btn');
  if (title) title.textContent = row ? 'Edit Transaction' : 'Add Transaction';
  if (saveBtn) saveBtn.textContent = row ? 'Save Changes' : 'Save Transaction';

  if (row) {
    document.getElementById('f-ar-transaction-docno').value = row.docno || '';
    document.getElementById('f-ar-transaction-type').value = row.type || 'invoice';
    document.getElementById('f-ar-transaction-service-order').value = row.service_order_id || '';
    document.getElementById('f-ar-transaction-client').value = row.company_name || row.client || '';
    document.getElementById('f-ar-transaction-description').value = row.description || '';
    document.getElementById('f-ar-transaction-amount').value = Number(row.amount || 0) || '';
    document.getElementById('f-ar-transaction-paid').value = Number(row.downpayment || row.receivable_paid_amount || 0) || '';
    document.getElementById('f-ar-transaction-date').value = toDateInputValue(row.date);
    document.getElementById('f-ar-transaction-status').value = normalizeTransactionModalStatus(row.status || getTransactionStatus(row));
    document.getElementById('f-ar-transaction-checkno').value = row.checkno || '';
    document.getElementById('f-ar-transaction-pono').value = row.pono || '';
  } else {
    await prefillTransactionDocno();
  }

  document.getElementById('ar-transaction-modal-backdrop')?.classList.add('open');
}

function closeTransactionModal() {
  document.getElementById('ar-transaction-modal-backdrop')?.classList.remove('open');
  editingTransactionId = null;
}

async function saveTransaction() {
  let docno = String(document.getElementById('f-ar-transaction-docno')?.value || '').trim();
  if (!editingTransactionId && !docno) {
    await prefillTransactionDocno();
    docno = String(document.getElementById('f-ar-transaction-docno')?.value || '').trim();
  }
  const type = String(document.getElementById('f-ar-transaction-type')?.value || 'invoice').trim();
  const client = String(document.getElementById('f-ar-transaction-client')?.value || '').trim();
  const description = String(document.getElementById('f-ar-transaction-description')?.value || '').trim();
  const amount = Number(document.getElementById('f-ar-transaction-amount')?.value || 0);
  const downpayment = Number(document.getElementById('f-ar-transaction-paid')?.value || 0);
  const date = String(document.getElementById('f-ar-transaction-date')?.value || '').trim();
  const currentRow = editingTransactionId
    ? transactionsDb.find((item) => Number(item.id || 0) === editingTransactionId)
    : null;

  if (!docno) {
    showToast('Transaction No. is required.', 'error');
    document.getElementById('f-ar-transaction-docno')?.focus();
    return;
  }

  if (!client || !description || !(amount > 0) || !date) {
    showToast('Complete the required transaction fields', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('docno', docno);
  formData.append('type', type);
  formData.append('client', client);
  formData.append('description', description);
  formData.append('qty', '1');
  formData.append('unitprice', String(amount));
  formData.append('amount', String(amount));
  formData.append('downpayment', String(Math.min(Math.max(0, downpayment), amount)));
  formData.append('date', date);
  formData.append('status', document.getElementById('f-ar-transaction-status')?.value || '');
  formData.append('business_entity_id', currentRow?.business_entity_id || getCurrentBusinessEntityId() || getDefaultArBusinessEntityId() || '');
  formData.append('service_order_id', document.getElementById('f-ar-transaction-service-order')?.value || '');
  if (currentRow?.project_id) {
    formData.append('project_id', currentRow.project_id);
  }
  formData.append('checkno', document.getElementById('f-ar-transaction-checkno')?.value || '');
  formData.append('pono', document.getElementById('f-ar-transaction-pono')?.value || '');
  if (currentRow?.pdfFilename) {
    formData.append('pdfFilename', currentRow.pdfFilename);
  }

  try {
    const isEdit = Boolean(editingTransactionId);
    const res = await fetch(isEdit ? `/api/transactions/${editingTransactionId}` : '/api/transactions', {
      method: isEdit ? 'PUT' : 'POST',
      body: formData
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Unable to save transaction');
    closeTransactionModal();
    await Promise.all([loadTransactions(), loadReceivables(), loadCollections(), loadServiceOrders()]);
    showToast(data.warning || (isEdit ? 'Transaction updated successfully' : 'Transaction saved successfully'), data.warning ? 'error' : 'success');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

function renderReceivables() {
  const searchInput = document.getElementById('receivable-search');
  const rawSearch = String(searchInput?.value || '');
  const q = rawSearch.toLowerCase().trim();
  if (searchInput) {
    arToolbarState.receivables.search = rawSearch;
    saveArUiState();
  }
  const tbody = document.getElementById('receivables-tbody');

  const filtered = getCurrentReceivableRows().filter(row => {
    const matchesSearch = !q || [
      row.customer_name,
      row.invoice_number,
      row.payment_terms,
      row.project_docno,
      row.service_order_no,
      row.transaction_id
    ].join(' ').toLowerCase().includes(q);
    return matchesSearch;
  });

  if (!filtered.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="11">No receivables found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(row => {
    const total = Number(row.total_amount || 0);
    const paid = Number(row.paid_amount || 0);
    const balance = Math.max(0, total - paid);
    const uiStatus = getReceivableUiStatus(row);
    const sourceTransaction = Number(row.transaction_id || 0) ? transactionsDb.find(tx => Number(tx.id) === Number(row.transaction_id)) : null;
    const sourceLabelBase = sourceTransaction
      ? `${sourceTransaction.docno || 'TXN'} - ${sourceTransaction.company_name || sourceTransaction.client || 'Unknown'}`
      : (Number(row.transaction_id || 0) ? `TX #${row.transaction_id}` : 'Manual');
    const serviceOrderLabel = String(row.service_order_no || '').trim();
    const sourceLabel = serviceOrderLabel
      ? `${sourceLabelBase} • ${serviceOrderLabel}`
      : sourceLabelBase;
    const isArchived = Number(row.archived || 0) === 1;
    return `
      <tr>
        <td>${highlightText(row.invoice_number, q)}</td>
        <td>${highlightText(row.customer_name, q)}</td>
        <td>${highlightText(sourceLabel, q)}${renderArchivedProjectBadge(row)}</td>
        <td>${escHtml(row.invoice_date || '')}</td>
        <td>${highlightText(row.payment_terms || '-', q)}</td>
        <td>${escHtml(row.due_date || '-')}</td>
        <td>${formatMoney(total)}</td>
        <td>${formatMoney(paid)}</td>
        <td>${formatMoney(balance)}</td>
        <td>
          <span class="status-pill ${uiStatus.className}">${highlightText(uiStatus.label, q)}</span>
        </td>
        <td>
          ${isArchived ? `
            <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
              <button class="btn btn-save btn-sm" onclick="restoreReceivable(${row.id})">Restore</button>
            </div>
          ` : balance > 0 ? `
            <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
              <button class="btn btn-save btn-sm" onclick="openCollectionModal(${row.id})">Record Payment</button>
              <button class="btn btn-edit btn-sm" onclick="openReceivableModal(${row.id})">Edit</button>
              <button class="btn btn-cancel btn-sm" onclick="archiveReceivable(${row.id})">Archive</button>
            </div>
          ` : `
            <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
              <button class="btn btn-edit btn-sm" onclick="openReceivableModal(${row.id})">Edit</button>
              <button class="btn btn-cancel btn-sm" onclick="archiveReceivable(${row.id})">Archive</button>
            </div>
          `}
        </td>
      </tr>
    `;
  }).join('');
}

function renderCollections() {
  const tbody = document.getElementById('collections-tbody');
  const collectionRows = getCurrentCollectionRows();
  if (!collectionRows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No collections yet.</td></tr>';
    return;
  }

  tbody.innerHTML = collectionRows.map(row => {
    const receivable = receivablesDb.find(item => item.id === row.ar_id);
    return `
      <tr>
        <td>${escHtml(row.payment_date || '')}</td>
        <td>${escHtml(receivable?.invoice_number || '-')}</td>
        <td>${escHtml(receivable?.customer_name || '-')}</td>
        <td>${formatMoney(row.amount)}</td>
        <td>${escHtml(row.payment_method || '-')}</td>
        <td>${escHtml(row.reference_number || '-')}</td>
        <td>${escHtml(row.notes || '-')}</td>
        <td>
          <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
            <button class="btn btn-edit btn-sm" onclick="openCollectionEditModal(${row.id})">Edit</button>
            <button class="btn btn-cancel btn-sm" onclick="deleteCollection(${row.id})">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderCustomerBalances() {
  const tbody = document.getElementById('customer-balances-tbody');
  if (!tbody) return;
  const rows = getCustomerBalanceRows();
  tbody.innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td>${escHtml(row.customer_name)}</td>
      <td class="text-right">${row.invoice_count}</td>
      <td class="text-right">${row.open_invoices}</td>
      <td class="text-right">${formatMoney(row.total_amount)}</td>
      <td class="text-right">${formatMoney(row.paid_amount)}</td>
      <td class="text-right">${formatMoney(row.balance)}</td>
      <td class="text-right">${formatMoney(row.overdue)}</td>
    </tr>
  `).join('') : '<tr class="empty-row"><td colspan="7">No customer balances found.</td></tr>';
}

function renderArAging() {
  const tbody = document.getElementById('ar-aging-tbody');
  if (!tbody) return;
  const rows = getCurrentReceivableRows()
    .filter(row => getReceivableBalance(row) > 0)
    .map(row => ({
      row,
      aging: getReceivableAgingBucket(row),
      balance: getReceivableBalance(row)
    }))
    .sort((a, b) => new Date(a.row.due_date || '9999-12-31') - new Date(b.row.due_date || '9999-12-31'));
  tbody.innerHTML = rows.length ? rows.map(({ row, aging, balance }) => `
    <tr>
      <td>${escHtml(row.customer_name || '-')}</td>
      <td>${escHtml(row.invoice_number || '-')}</td>
      <td>${escHtml(row.due_date || '-')}</td>
      <td class="text-right">${aging.current ? formatMoney(aging.current) : '-'}</td>
      <td class="text-right">${aging.d30 ? formatMoney(aging.d30) : '-'}</td>
      <td class="text-right">${aging.d60 ? formatMoney(aging.d60) : '-'}</td>
      <td class="text-right">${aging.d90 ? formatMoney(aging.d90) : '-'}</td>
      <td class="text-right">${aging.over90 ? formatMoney(aging.over90) : '-'}</td>
      <td class="text-right">${formatMoney(balance)}</td>
    </tr>
  `).join('') : '<tr class="empty-row"><td colspan="9">No open AR aging balances found.</td></tr>';
}

function renderDocuments() {
  const tbody = document.getElementById('documents-tbody');
  if (!tbody) return;
  const rows = getDocumentRows();
  tbody.innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td>${escHtml(row.type)}</td>
      <td>${escHtml(row.number)}</td>
      <td>${escHtml(row.party)}</td>
      <td>${escHtml(formatArDate(row.date))}</td>
      <td><span class="status-pill">${escHtml(formatLabel(row.status || 'open'))}</span></td>
      <td>${row.file ? escHtml(row.file) : '<span class="pdf-empty">System invoice record</span>'}</td>
    </tr>
  `).join('') : '<tr class="empty-row"><td colspan="6">No documents found.</td></tr>';
}

function populateReceivableSelect(selectedId = '') {
  const select = document.getElementById('f-collection-ar');
  const selectedKey = String(selectedId || '');
  const openRows = getCurrentReceivableRows().filter(row => Number(row.archived || 0) !== 1 && getReceivableStatus(row) !== 'paid');
  const selectedRow = selectedKey ? receivablesDb.find(row => String(row.id) === selectedKey) : null;
  const rows = selectedRow && !openRows.some(row => String(row.id) === selectedKey)
    ? [selectedRow, ...openRows]
    : openRows;
  if (!rows.length) {
    select.innerHTML = '<option value="">No open receivables</option>';
    return;
  }
  select.innerHTML = rows.map(row => {
    const balance = Math.max(0, Number(row.total_amount || 0) - Number(row.paid_amount || 0));
    return `<option value="${row.id}" ${String(selectedId) === String(row.id) ? 'selected' : ''}>${escHtml(row.invoice_number)} - ${escHtml(row.customer_name)} (${formatMoney(balance)})</option>`;
  }).join('');
}

function openReceivableModal(receivableId = null) {
  initReceivableTransactionSearch();
  resetReceivableForm();
  editingReceivableId = receivableId ? Number(receivableId) : null;
  syncReceivableModalMode();

  if (editingReceivableId) {
    const row = receivablesDb.find(item => Number(item.id) === Number(editingReceivableId));
    if (!row) {
      editingReceivableId = null;
      syncReceivableModalMode();
      showToast('Receivable not found', 'error');
      return;
    }

    const selectedTransaction = Number(row.transaction_id || 0)
      ? transactionsDb.find(tx => Number(tx.id) === Number(row.transaction_id))
      : null;
    const transactionLabel = selectedTransaction ? getTransactionRelationLabel(selectedTransaction) : '';
    if (row.transaction_id) {
      setReceivableTransactionSelection(row.transaction_id, transactionLabel);
      if (selectedTransaction) {
        applyReceivableTransactionSelection(row.transaction_id);
      }
    }

    const customerInput = document.getElementById('f-customer-name');
    const invoiceInput = document.getElementById('f-invoice-number');
    const invoiceDateInput = document.getElementById('f-invoice-date');
    const paymentTermsInput = document.getElementById('f-payment-terms');
    const totalInput = document.getElementById('f-total-amount');
    const dueDateInput = document.getElementById('f-due-date');
    const statusInput = document.getElementById('f-ar-status');
    const notesInput = document.getElementById('f-ar-notes');

    if (customerInput) customerInput.value = row.customer_name || '';
    if (invoiceInput) invoiceInput.value = row.invoice_number || '';
    if (invoiceDateInput) invoiceDateInput.value = row.invoice_date || '';
    if (paymentTermsInput) setReceivablePaymentTermsValue(row.payment_terms || 'Custom');
    if (totalInput) totalInput.value = Number(row.total_amount || 0) ? String(Number(row.total_amount || 0)) : '';
    if (dueDateInput) dueDateInput.value = row.due_date || '';
    if (statusInput) statusInput.value = String(row.status || 'draft');
    if (notesInput) notesInput.value = row.notes || '';
  }

  document.getElementById('receivable-modal-backdrop').classList.add('open');
}

function closeReceivableModal() {
  document.getElementById('receivable-modal-backdrop').classList.remove('open');
  editingReceivableId = null;
  resetReceivableForm();
  syncReceivableModalMode();
}

function syncCollectionModalMode() {
  const title = document.querySelector('#collection-modal-backdrop .modal-title');
  const saveBtn = document.querySelector('#collection-modal-backdrop .btn-save');
  if (title) title.textContent = editingCollectionId ? 'Edit Payment' : 'Record Payment';
  if (saveBtn) saveBtn.textContent = editingCollectionId ? 'Save Changes' : 'Save Payment';
}

function resetCollectionForm() {
  document.getElementById('f-collection-amount').value = '';
  document.getElementById('f-collection-reference').value = '';
  document.getElementById('f-collection-notes').value = '';
  document.getElementById('f-collection-method').value = 'cash';
  setTodayDefaults();
  const help = document.getElementById('f-collection-amount-help');
  if (help) {
    help.textContent = 'Prefilled with the remaining balance for faster collection entry.';
  }
}

function openCollectionModal(receivableId = '', suggestedAmount = '') {
  editingCollectionId = null;
  populateReceivableSelect(receivableId);
  if (!document.getElementById('f-collection-ar').value) {
    showToast('No open receivables available', 'error');
    return;
  }
  const selectedId = Number(document.getElementById('f-collection-ar').value || receivableId || 0);
  const selectedRow = receivablesDb.find(item => Number(item.id) === selectedId);
  const balance = selectedRow ? Math.max(0, Number(selectedRow.total_amount || 0) - Number(selectedRow.paid_amount || 0)) : 0;
  const amountInput = document.getElementById('f-collection-amount');
  if (amountInput) {
    amountInput.value = suggestedAmount !== '' ? suggestedAmount : balance.toFixed(2);
  }
  const help = document.getElementById('f-collection-amount-help');
  if (help) {
    help.textContent = selectedRow
      ? `Remaining balance: ${formatMoney(balance)}. You can type a smaller amount if this is only a partial payment.`
      : 'Prefilled with the remaining balance for faster entry.';
  }
  syncCollectionModalMode();
  document.getElementById('collection-modal-backdrop').classList.add('open');
}

function closeCollectionModal() {
  document.getElementById('collection-modal-backdrop').classList.remove('open');
  editingCollectionId = null;
  resetCollectionForm();
  syncCollectionModalMode();
}

function openCollectionEditModal(collectionId) {
  const row = collectionsDb.find(item => Number(item.id) === Number(collectionId));
  if (!row) {
    showToast('Payment not found', 'error');
    return;
  }
  editingCollectionId = Number(collectionId);
  populateReceivableSelect(row.ar_id);
  document.getElementById('f-collection-ar').value = row.ar_id;
  document.getElementById('f-collection-date').value = row.payment_date || '';
  document.getElementById('f-collection-amount').value = row.amount || '';
  document.getElementById('f-collection-method').value = row.payment_method || 'cash';
  document.getElementById('f-collection-reference').value = row.reference_number || '';
  document.getElementById('f-collection-notes').value = row.notes || '';
  const help = document.getElementById('f-collection-amount-help');
  if (help) help.textContent = 'Edit this collection amount, date, method, or notes.';
  syncCollectionModalMode();
  document.getElementById('collection-modal-backdrop').classList.add('open');
}

async function openServiceOrderCreateModal() {
  try {
    await loadServiceOrderReferences();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Unable to load service order references', 'error');
    return;
  }

  editingServiceOrderId = null;
  document.getElementById('service-order-modal-title').textContent = 'Add Service Order';
  document.getElementById('service-order-save-btn').textContent = 'Save Service Order';
  document.getElementById('f-so-number').value = '';
  await prefillServiceOrderNumber();
  document.getElementById('f-so-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('f-so-project').value = '';
  setServiceOrderCompanySelection('', '', { lockToProject: false });
  document.getElementById('f-so-type').value = 'installation';
  document.getElementById('f-so-status').value = 'issued';
  document.getElementById('f-so-title').value = '';
  document.getElementById('f-so-amount').value = '';
  document.getElementById('f-so-description').value = '';
  document.getElementById('f-so-notes').value = '';
  document.getElementById('service-order-edit-modal-backdrop').classList.add('open');
}

async function openServiceOrderEditModal(serviceOrderId) {
  const row = serviceOrdersDb.find(item => Number(item.id) === Number(serviceOrderId));
  if (!row) {
    showToast('Service order not found', 'error');
    return;
  }

  try {
    await loadServiceOrderReferences();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Unable to load service order references', 'error');
    return;
  }

  editingServiceOrderId = Number(serviceOrderId);
  document.getElementById('service-order-modal-title').textContent = 'Edit Service Order';
  document.getElementById('service-order-save-btn').textContent = 'Save Changes';
  populateServiceOrderReferenceSelects({
    project_id: row.project_id,
    company_id: row.company_id
  });
  if (Number(row.project_id || 0)) {
    syncServiceOrderCompanyFromProject();
  }
  document.getElementById('f-so-number').value = row.so_number || '';
  document.getElementById('f-so-date').value = String(row.service_date || '').slice(0, 10);
  document.getElementById('f-so-type').value = String(row.service_type || 'installation').toLowerCase();
  document.getElementById('f-so-status').value = String(row.status || 'issued').toLowerCase();
  document.getElementById('f-so-title').value = row.service_title || '';
  document.getElementById('f-so-amount').value = Number(row.total_amount || 0) ? String(Number(row.total_amount || 0)) : '';
  document.getElementById('f-so-description').value = row.description || '';
  document.getElementById('f-so-notes').value = row.notes || '';
  document.getElementById('service-order-edit-modal-backdrop').classList.add('open');
}

function closeServiceOrderEditModal() {
  document.getElementById('service-order-edit-modal-backdrop').classList.remove('open');
  editingServiceOrderId = null;
}

async function saveReceivable() {
  clearReceivableFieldMessages();
  const payload = {
    transaction_id: Number(document.getElementById('f-transaction-id').value || 0) || null,
    customer_name: document.getElementById('f-customer-name').value.trim(),
    invoice_number: document.getElementById('f-invoice-number').value.trim(),
    invoice_date: document.getElementById('f-invoice-date').value,
    due_date: document.getElementById('f-due-date').value || null,
    payment_terms: document.getElementById('f-payment-terms').value || null,
    total_amount: Number(document.getElementById('f-total-amount').value || 0),
    status: document.getElementById('f-ar-status').value,
    notes: document.getElementById('f-ar-notes').value.trim()
  };

  if (!payload.transaction_id) {
    setReceivableFieldMessage('transaction', 'Select a linked transaction before saving this receivable.');
    showToast('Select a linked transaction first', 'error');
    return;
  }

  const selectedTransaction = transactionsDb.find(row => Number(row.id) === Number(payload.transaction_id));
  if (!selectedTransaction) {
    setReceivableFieldMessage('transaction', 'Pick a valid linked transaction from the list before saving.');
    showToast('Pick a valid linked transaction first', 'error');
    return;
  }

  payload.customer_name = String(selectedTransaction.company_name || selectedTransaction.client || '').trim();
  payload.invoice_number = String(selectedTransaction.docno || '').trim();
  payload.invoice_date = String(selectedTransaction.date || '').trim();
  payload.total_amount = Number(selectedTransaction.amount || 0);

  if (!payload.customer_name || !payload.invoice_number || !payload.invoice_date || payload.total_amount <= 0) {
    showToast('Complete the required receivable fields', 'error');
    return;
  }

  try {
    const isEdit = Boolean(editingReceivableId);
    const res = await fetch(isEdit ? `/api/receivables/${editingReceivableId}` : '/api/receivables', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save receivable');
    closeReceivableModal();
    document.getElementById('f-customer-name').value = '';
    document.getElementById('f-invoice-number').value = '';
    document.getElementById('f-total-amount').value = '';
    document.getElementById('f-due-date').value = '';
    setReceivablePaymentTermsValue('Net 30');
    document.getElementById('f-ar-notes').value = '';
    document.getElementById('f-ar-status').value = 'draft';
    setReceivableTransactionSelection('', '');
    setTodayDefaults();
    await Promise.all([loadReceivables(), loadTransactions()]);
    showToast(data.warning || (isEdit ? 'Receivable updated successfully' : 'Receivable saved'), data.warning ? 'error' : 'success');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

async function saveCollection() {
  const isEdit = Boolean(editingCollectionId);
  const payload = {
    payment_type: 'ar',
    ar_id: Number(document.getElementById('f-collection-ar').value),
    payment_date: document.getElementById('f-collection-date').value,
    amount: Number(document.getElementById('f-collection-amount').value || 0),
    payment_method: document.getElementById('f-collection-method').value,
    reference_number: document.getElementById('f-collection-reference').value.trim(),
    notes: document.getElementById('f-collection-notes').value.trim()
  };

  if (!payload.ar_id || !payload.payment_date || payload.amount <= 0) {
    showToast('Complete the collection form first', 'error');
    return;
  }

  try {
    const url = editingCollectionId ? `/api/payments/${editingCollectionId}` : '/api/payments';
    const res = await fetch(url, {
      method: editingCollectionId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save collection');
    closeCollectionModal();
    document.getElementById('f-collection-amount').value = '';
    document.getElementById('f-collection-reference').value = '';
    document.getElementById('f-collection-notes').value = '';
    setTodayDefaults();
    await Promise.all([loadReceivables(), loadCollections(), loadTransactions()]);
    showToast(isEdit ? 'Payment updated successfully' : 'Payment recorded successfully');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

async function saveServiceOrderEdit() {
  const isEdit = Boolean(editingServiceOrderId);
  if (!isEdit && !String(document.getElementById('f-so-number')?.value || '').trim()) {
    await prefillServiceOrderNumber();
  }

  const payload = {
    business_entity_id: getCurrentBusinessEntityId() || getDefaultArBusinessEntityId() || '',
    so_number: document.getElementById('f-so-number').value.trim(),
    company_id: Number(document.getElementById('f-so-company').value || 0) || null,
    project_id: Number(document.getElementById('f-so-project').value || 0) || null,
    service_type: document.getElementById('f-so-type').value,
    service_date: document.getElementById('f-so-date').value,
    service_title: document.getElementById('f-so-title').value.trim(),
    description: document.getElementById('f-so-description').value.trim(),
    total_amount: Number(document.getElementById('f-so-amount').value || 0),
    status: document.getElementById('f-so-status').value,
    notes: document.getElementById('f-so-notes').value.trim()
  };

  if (!payload.company_id) {
    const companyMatch = findServiceOrderCompanyBySearchValue(document.getElementById('f-so-company-search')?.value || '');
    if (companyMatch) {
      setServiceOrderCompanySelection(companyMatch.id, getServiceOrderCompanyLabel(companyMatch));
      payload.company_id = Number(companyMatch.id || 0) || null;
    }
  }

  if (!payload.service_title) {
    showToast('Service title is required', 'error');
    return;
  }

  if (!payload.so_number) {
    showToast('SO No. is required', 'error');
    document.getElementById('f-so-number')?.focus();
    return;
  }

  if (!payload.company_id) {
    showToast('Select company first', 'error');
    return;
  }

  try {
    const res = await fetch(isEdit ? `/api/service-orders/${editingServiceOrderId}` : '/api/service-orders', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || (isEdit ? 'Failed to update service order' : 'Failed to create service order'));
    closeServiceOrderEditModal();
    await Promise.all([loadServiceOrders(), loadTransactions(), loadReceivables()]);
    showToast(isEdit ? 'Service order updated successfully' : 'Service order created successfully');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

async function deleteCollection(id) {
  const row = collectionsDb.find(item => Number(item.id) === Number(id));
  const confirmed = await openConfirmDialog({
    title: 'Delete Payment',
    message: `Delete payment on ${row?.payment_date || 'this record'}?`,
    noText: 'No',
    yesText: 'Yes'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/payments/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete collection');
    await Promise.all([loadReceivables(), loadCollections(), loadTransactions()]);
    showToast('Payment deleted successfully');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

async function archiveServiceOrder(id) {
  const row = serviceOrdersDb.find(item => Number(item.id) === Number(id));
  const confirmed = await openConfirmDialog({
    title: 'Archive Service Order',
    message: `Archive ${row?.so_number || 'this service order'}?`,
    noText: 'No',
    yesText: 'Yes'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/service-orders/${id}/archive`, { method: 'PUT' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to archive service order');
    await Promise.all([loadServiceOrders(), loadTransactions(), loadReceivables()]);
    showToast('Service order archived');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

async function restoreServiceOrder(id) {
  try {
    const res = await fetch(`/api/service-orders/${id}/restore`, { method: 'PUT' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to restore service order');
    await Promise.all([loadServiceOrders(), loadTransactions(), loadReceivables()]);
    showToast('Service order restored');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

async function archiveTransaction(id) {
  const row = transactionsDb.find(item => Number(item.id) === Number(id));
  const confirmed = await openConfirmDialog({
    title: 'Archive Transaction',
    message: `Archive ${row?.docno || 'this transaction'}?`,
    noText: 'No',
    yesText: 'Yes'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/transactions/${id}/archive`, { method: 'PUT' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to archive transaction');
    await Promise.all([loadTransactions(), loadReceivables(), loadCollections()]);
    showToast('Transaction archived');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

async function archiveReceivable(id) {
  const row = receivablesDb.find(item => Number(item.id) === Number(id));
  const confirmed = await openConfirmDialog({
    title: 'Archive Receivable',
    message: `Archive ${row?.invoice_number || 'this receivable'}?`,
    noText: 'No',
    yesText: 'Yes'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/receivables/${id}/archive`, { method: 'PUT' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to archive receivable');
    await loadReceivables();
    showToast('Receivable archived');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

async function restoreReceivable(id) {
  try {
    const res = await fetch(`/api/receivables/${id}/restore`, { method: 'PUT' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to restore receivable');
    await loadReceivables();
    showToast('Receivable restored');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

