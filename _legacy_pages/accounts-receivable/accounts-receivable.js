'use strict';

let receivablesDb = [];
let collectionsDb = [];
let businessEntitiesDb = [];
let editingCollectionId = null;
let currentBusinessEntityContextId = '';
const BUSINESS_ENTITY_CONTEXT_KEY = 'kinaadman_businessEntityContext';
const BUSINESS_ENTITY_THEME_KEY = 'kinaadman_businessEntityTheme';
const AR_UI_STATE_KEY = 'accounts-receivable.uiState';
const AR_MODULE_MODE = getArModuleMode();
const arToolbarState = {
  receivables: { search: '' },
  collections: {},
  summary: {}
};
const AR_TABS = new Set(['invoices', 'collections', 'customer-balances', 'ar-aging', 'documents']);
let activeArTab = getInitialArTab();

function getArModuleMode() {
  const path = String(window.location.pathname || '').replace(/\/+$/, '').toLowerCase();
  if (path === '/sales-management') return 'sales';
  return 'finance';
}

function getAllowedArTabsForMode(mode = AR_MODULE_MODE) {
  if (mode === 'sales' && isCurrentStaffRole()) return new Set(['invoices', 'collections']);
  if (mode === 'sales') return new Set(['invoices', 'collections', 'customer-balances']);
  return new Set(['invoices', 'collections', 'customer-balances', 'ar-aging']);
}

function getDefaultArTabForMode() {
  return 'invoices';
}

function getInitialArTab() {
  const params = new URLSearchParams(window.location.search || '');
  return params.has('tab') ? normalizeArTab(params.get('tab')) : getDefaultArTabForMode();
}

function isArTabAllowedForMode(tab, mode = AR_MODULE_MODE) {
  return getAllowedArTabsForMode(mode).has(String(tab || '').trim().toLowerCase());
}

function getDefaultArUiState() {
  return {
    activeTab: getDefaultArTabForMode(),
    toolbarState: {
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
  arToolbarState.receivables.search = state.toolbarState.receivables.search;
  arToolbarState.collections = state.toolbarState.collections || {};
  arToolbarState.summary = state.toolbarState.summary || {};
}

function normalizeArTab(value) {
  const tab = String(value || '').trim().toLowerCase();
  const aliases = {
    overview: getDefaultArTabForMode(),
    receivables: 'invoices',
    payments: 'collections'
  };
  const normalized = aliases[tab] || tab;
  if (!AR_TABS.has(normalized)) return getDefaultArTabForMode();
  return isArTabAllowedForMode(normalized) ? normalized : getDefaultArTabForMode();
}

function isCurrentStaffRole() {
  const role = String(
    document.body?.dataset?.accessRole ||
    document.documentElement?.dataset?.accessRole ||
    ''
  ).trim().toLowerCase();
  return role === 'staff';
}

function applyStaffSalesRestriction() {
  if (AR_MODULE_MODE !== 'sales' || !isCurrentStaffRole()) return;
  activeArTab = isArTabAllowedForMode(activeArTab) ? activeArTab : getDefaultArTabForMode();
  document.body.dataset.initialArTab = activeArTab;
  syncStaffSalesStaticSidebar();
  applyArModuleModeChrome();
  switchTab(activeArTab, document.querySelector(`.module-tab[data-tab="${activeArTab}"]`), {
    captureState: false,
    persistState: false
  });
  const url = new URL(window.location.href);
  const tab = normalizeArTab(url.searchParams.get('tab') || activeArTab);
  if (url.searchParams.get('tab') !== tab) {
    url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}${url.hash || ''}`);
  }
}

window.addEventListener('kinaadman:role-ready', applyStaffSalesRestriction);

function syncArSummaryCards(tab = activeArTab) {
  const activeTab = normalizeArTab(tab);
  const grid = document.getElementById('ar-summary-grid');
  if (!grid) return;

  grid.dataset.activeTab = activeTab;
  let visibleCount = 0;
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
    const shouldShow = tabs.includes(activeTab) && visibleCount < 5;
    card.hidden = !shouldShow;
    if (shouldShow) visibleCount += 1;
  });
  grid.dataset.summaryReady = '1';
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
  try {
    applyArModuleModeChrome();
    restoreArUiState();
    setupArModuleSidebarTabLinks();
    const params = new URLSearchParams(window.location.search);
    activeArTab = params.has('tab') ? normalizeArTab(params.get('tab')) : activeArTab;
    const initialButton = document.querySelector(`.module-tab[data-tab="${activeArTab}"]`)
      || document.querySelector('.module-tab.active');
    switchTab(activeArTab, initialButton, { captureState: false, persistState: false });
    syncArModuleSidebarActiveLink(activeArTab);
    if (!params.has('tab')) {
      syncArTabUrl(activeArTab);
    }
    setTodayDefaults();
    loadBusinessEntitiesForAr();
    loadReceivables();
    loadCollections();
    if (typeof loadNotifications === 'function') loadNotifications();
  } finally {
    delete document.body.dataset.initialArTab;
  }
});

function setupArModuleSidebarTabLinks() {
  const modulePathByMode = {
    sales: '/sales-management',
    service: '/service-operations',
    finance: '/accounts-receivable'
  };
  const modulePath = modulePathByMode[AR_MODULE_MODE] || '/accounts-receivable';
  document.querySelectorAll('.sidebar-link[href^="/"]').forEach((link) => {
    if (link.dataset.arTabBound === '1') return;
    let url;
    try {
      url = new URL(link.getAttribute('href') || '', window.location.origin);
    } catch (_) {
      return;
    }
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path !== modulePath) return;
    const requestedTab = normalizeArTab(url.searchParams.get('tab') || getDefaultArTabForMode());
    if (!isArTabAllowedForMode(requestedTab)) return;
    link.dataset.arTabBound = '1';
    link.addEventListener('click', (event) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      switchTab(requestedTab, document.querySelector(`.module-tab[data-tab="${requestedTab}"]`));
      syncArModuleSidebarActiveLink(requestedTab);
    }, true);
  });
}

function syncStaffSalesStaticSidebar() {
  if (AR_MODULE_MODE !== 'sales' || !isCurrentStaffRole()) return;
}

function applyArModuleModeChrome() {
  document.body.dataset.moduleMode = AR_MODULE_MODE;
  syncStaffSalesStaticSidebar();

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
    sales: {
      invoices: 'Sales Inquiry',
      collections: 'Quotation',
      'customer-balances': 'SO'
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
  if (stored === 'all') { currentBusinessEntityContextId = 'all'; return 'all'; }
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
  void row;
  return true;
}

function renderArchivedProjectBadge(row = {}) {
  return row.project_is_archived === true || Number(row.project_is_archived || 0) === 1
    ? '<div style="margin-top:4px;"><span class="status-pill status-cancelled">Archived Project</span></div>'
    : '';
}

function getCurrentReceivableRows() {
  return (Array.isArray(receivablesDb) ? receivablesDb : []).filter(businessEntityMatches);
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
  const logo = String(row?.logo_path || row?.logo || '').trim();
  const name = String(row?.company_name || '').trim();
  return {
    theme: 'kvsk',
    logo,
    alt: name ? `${name} logo` : 'Company logo',
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
    if (profile.logo) {
      img.src = profile.logo;
      img.alt = profile.alt;
      img.style.removeProperty('display');
      img.removeAttribute('hidden');
    } else {
      img.style.display = 'none';
      img.removeAttribute('src');
      img.alt = '';
    }
  });
  try {
    localStorage.setItem(BUSINESS_ENTITY_THEME_KEY, JSON.stringify({
      company_name: row?.company_name || 'KVSK CCTV & IT Solution',
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
        const logoMarkup = profile.logo
          ? `<span class="business-profile-logo-wrap"><img src="${escHtml(profile.logo)}" alt="${escHtml(profile.alt)}" /></span>`
          : `<span class="business-profile-logo-wrap business-profile-logo-mono">${escHtml(businessEntityShortLabel(row))}</span>`;
        return `
          <button class="business-profile-card${isActive ? ' is-active' : ''}" type="button" onclick="setBusinessEntityContext('${escHtml(id)}')">
            ${logoMarkup}
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
  const isAllCompaniesContext = String(localStorage.getItem('kinaadman_businessEntityContext') || '').trim().toLowerCase() === 'all';
  document.querySelectorAll('header .brand-copy .header-logo').forEach((node) => {
    node.textContent = activeEntity?.company_name || (isAllCompaniesContext ? 'All Companies' : 'KVSK CCTV & IT Solution');
  });
}

function populateArBusinessEntitySelect(selectId, selectedValue = '') {
  const select = document.getElementById(selectId);
  if (!select) return;
  const rows = Array.isArray(businessEntitiesDb) ? businessEntitiesDb : [];
  const selected = String(selectedValue || select.value || getDefaultArBusinessEntityId() || '').trim();
  select.innerHTML = rows.length
    ? rows.map(row => `<option value="${escHtml(row.id)}">${escHtml(row.company_name || row.entity_code || 'Operating Company')}</option>`).join('')
    : '<option value="">Operating company</option>';
  if (selected && Array.from(select.options || []).some(option => String(option.value) === selected)) {
    select.value = selected;
  }
}

function renderCurrentWorkspaceBadge(row = findBusinessEntityById(getCurrentBusinessEntityId())) {
  void row;
  const badge = document.getElementById('current-workspace-badge');
  if (!badge) return;
  badge.textContent = 'All Companies';
  badge.title = 'Showing records from all business entities';
  badge.setAttribute('aria-label', 'Showing all business entities');
}

function setBusinessEntityContext(id) {
  const nextId = String(id || '').trim();
  if (!nextId) return;
  currentBusinessEntityContextId = nextId;
  localStorage.setItem(BUSINESS_ENTITY_CONTEXT_KEY, nextId);
  renderBusinessEntityContext();
  populateReceivableSelect();
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

async function doLogout() {
  const confirmed = (typeof showConfirm === 'function')
    ? await showConfirm('Maglo-logout ka na. Gusto mo bang ituloy?', { title: 'Logout?', confirmLabel: 'Yes, log out', cancelLabel: 'Cancel', type: 'danger' })
    : window.confirm('Maglo-logout ka na. Gusto mo bang ituloy?');
  if (!confirmed) return;
  fetch('/logout', { method: 'POST' }).finally(() => { window.location.href = '/'; });
}

function captureArToolbarState(tab) {
  if (tab === 'receivables' || tab === 'invoices') {
    arToolbarState.receivables.search = document.getElementById('receivable-search')?.value || '';
  }
}

function renderArToolbarControls(tab) {
  const actions = document.getElementById('module-toolbar-actions');
  if (!actions) return;

  const state = tab === 'invoices' ? arToolbarState.receivables : (arToolbarState[tab] || {});

  if (tab === 'invoices') {
    // AR invoices are generated from delivered Delivery Receipts in the Sales Order flow
    // (linked by sales_record_id — NOT the retired Transactions feature). "Add Invoice"
    // lets you pick an eligible delivered DR and generate its AR invoice from here.
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="receivable-search" type="text" placeholder="Search customer or invoice number..." value="${escHtml(state.search || '')}" oninput="renderReceivables()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openGenerateInvoiceModal()">Add Invoice</button>
    `;
    return;
  }

  if (tab === 'collections') {
    const collectionButtonLabel = isCurrentStaffRole() ? 'Request Collection' : 'Record Collection';
    actions.innerHTML = `
      <button class="btn btn-add btn-sm" type="button" onclick="openCollectionModal()">${collectionButtonLabel}</button>
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
  syncArModuleSidebarActiveLink(tab);
  if (typeof syncSidebarActiveLinks === 'function') {
    syncSidebarActiveLinks();
  }
}

function syncArModuleSidebarActiveLink(tab = activeArTab) {
  const activeTab = normalizeArTab(tab);
  const modulePathByMode = {
    sales: '/sales-management',
    service: '/service-operations',
    finance: '/accounts-receivable'
  };
  const modulePath = modulePathByMode[AR_MODULE_MODE] || '/accounts-receivable';
  const defaultTab = getDefaultArTabForMode();
  let activeLink = null;

  document.querySelectorAll('.sidebar-link[href^="/"]').forEach((link) => {
    let url;
    try {
      url = new URL(link.dataset.navHref || link.getAttribute('href') || '', window.location.origin);
    } catch (_) {
      return;
    }
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path !== modulePath) return;
    const linkTab = normalizeArTab(url.searchParams.get('tab') || defaultTab);
    const isActive = linkTab === activeTab;
    link.classList.toggle('active', isActive);
    if (isActive) activeLink = link;
  });

  const activeGroup = activeLink?.closest('.sidebar-group');
  const toggle = activeGroup?.querySelector('.sidebar-group-toggle');
  if (activeGroup && toggle) {
    activeGroup.classList.remove('is-collapsed');
    toggle.setAttribute('aria-expanded', 'true');
  }
}

function setTodayDefaults() {
  const today = new Date().toISOString().split('T')[0];
  const collectionDate = document.getElementById('f-collection-date');
  if (collectionDate) collectionDate.value = today;
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

function getReceivableFieldMessageNode(fieldName) {
  return document.querySelector(`[data-receivable-field-message="${fieldName}"]`);
}

function updateMetrics() {
  const receivables = getCurrentReceivableRows();
  const collections = getCurrentCollectionRows();
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
  return getCurrentReceivableRows().map(row => ({
    type: 'Invoice',
    number: row.invoice_number || `INV #${row.id}`,
    party: row.customer_name || '-',
    date: row.invoice_date,
    status: getReceivableStatus(row),
    file: ''
  }));
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
      row.sales_document_no
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
    const status = String(row.status || '').toLowerCase();
    let rowClass = '';
    if (status === 'overdue') rowClass = 'row-overdue';
    else if (balance > 0 && row.due_date) {
      const today = new Date(); today.setHours(0,0,0,0);
      const due = new Date(row.due_date); due.setHours(0,0,0,0);
      if (due < today && !['paid','cancelled','archived'].includes(status)) rowClass = 'row-overdue';
      else if (Math.round((due - today) / 86400000) <= 3 && !['paid','cancelled'].includes(status)) rowClass = 'row-at-risk';
    }
    if (['paid'].includes(status)) rowClass = 'row-completed';
    const dueDateHtml = row.due_date
      ? `${escHtml(row.due_date)}${typeof relativeDateHtml === 'function' ? relativeDateHtml(row.due_date) : ''}`
      : '-';
    const sourceLabel = row.sales_document_no
      ? `${row.sales_document_no} (Delivery Receipt)`
      : 'Manual';
    const isArchived = Number(row.archived || 0) === 1;
    return `
      <tr${rowClass ? ` class="${rowClass}"` : ''}>
        <td>${highlightText(row.invoice_number, q)}</td>
        <td>${highlightText(row.customer_name, q)}</td>
        <td>${highlightText(sourceLabel, q)}${renderArchivedProjectBadge(row)}</td>
        <td>${escHtml(row.invoice_date || '')}</td>
        <td>${highlightText(row.payment_terms || '-', q)}</td>
        <td>${dueDateHtml}</td>
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
              <button class="btn btn-cancel btn-sm" onclick="archiveReceivable(${row.id})">Archive</button>
            </div>
          ` : `
            <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
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

function syncCollectionModalMode() {
  const title = document.querySelector('#collection-modal-backdrop .modal-title');
  const saveBtn = document.querySelector('#collection-modal-backdrop .btn-save');
  if (title) {
    title.textContent = isCurrentStaffRole()
      ? (editingCollectionId ? 'Edit Collection Request' : 'Request Collection')
      : (editingCollectionId ? 'Edit Payment' : 'Record Payment');
  }
  if (saveBtn) {
    saveBtn.textContent = isCurrentStaffRole()
      ? (editingCollectionId ? 'Update Request' : 'Save Collection Request')
      : (editingCollectionId ? 'Save Changes' : 'Save Payment');
  }
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

// ── Manual "Add Invoice": generate an AR invoice from a delivered Delivery Receipt in the
// Sales Order flow (linked by sales_record_id — NOT a manual transaction). Reuses the exact
// same backend the Sales Management "Generate Invoice" shortcut uses. See [[sales-project-flow]].
let salesRecordsForInvoice = [];

async function openGenerateInvoiceModal() {
  const select = document.getElementById('f-generate-invoice-source');
  const preview = document.getElementById('generate-invoice-preview');
  const submit = document.getElementById('generate-invoice-submit');
  if (!select) return;
  select.innerHTML = '<option value="">Loading delivered receipts…</option>';
  if (preview) preview.style.display = 'none';
  if (submit) submit.disabled = true;
  document.getElementById('generate-invoice-modal-backdrop').classList.add('open');

  try {
    const res = await fetch('/api/sales-management/records?type=project-delivery');
    const rows = await res.json();
    if (!res.ok) throw new Error(rows.error || 'Unable to load delivery receipts.');
    salesRecordsForInvoice = (Array.isArray(rows) ? rows : []).filter((row) => {
      const status = String(row.status || '').toLowerCase();
      return ['delivered', 'completed'].includes(status)
        && !row.ar_invoice_number
        && Number(row.amount || 0) > 0
        && String(row.company_name || '').trim();
    });
    if (!salesRecordsForInvoice.length) {
      select.innerHTML = '<option value="">No delivered receipts ready to invoice</option>';
      return;
    }
    select.innerHTML = '<option value="">Select a delivered receipt…</option>'
      + salesRecordsForInvoice.map((row) => {
          const label = `${row.document_no || 'DR'} — ${row.company_name} (${formatMoney(Number(row.amount || 0))})`;
          return `<option value="${row.id}">${escHtml(label)}</option>`;
        }).join('');
  } catch (err) {
    console.error(err);
    select.innerHTML = '<option value="">Failed to load receipts</option>';
    showToast(err.message || 'Unable to load delivery receipts.', 'error');
  }
}

function onGenerateInvoiceSourceChange() {
  const id = Number(document.getElementById('f-generate-invoice-source')?.value || 0);
  const preview = document.getElementById('generate-invoice-preview');
  const submit = document.getElementById('generate-invoice-submit');
  const row = salesRecordsForInvoice.find((r) => Number(r.id) === id);
  if (!row || !preview) {
    if (preview) preview.style.display = 'none';
    if (submit) submit.disabled = true;
    return;
  }
  const line = (k, v) => `<div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:var(--muted)">${k}</span><strong>${v}</strong></div>`;
  preview.innerHTML =
    line('Customer', escHtml(row.company_name || '—')) +
    line('Project', escHtml(row.project_name || row.project_docno || '—')) +
    line('Amount', formatMoney(Number(row.amount || 0))) +
    line('Payment Terms', escHtml(row.payment_terms || 'Net 30'));
  preview.style.display = 'block';
  if (submit) submit.disabled = false;
}

function closeGenerateInvoiceModal() {
  document.getElementById('generate-invoice-modal-backdrop')?.classList.remove('open');
}

async function submitGenerateInvoice() {
  const id = Number(document.getElementById('f-generate-invoice-source')?.value || 0);
  if (!id) { showToast('Select a delivered receipt first.', 'error'); return; }
  const submit = document.getElementById('generate-invoice-submit');
  if (submit) submit.disabled = true;
  try {
    const res = await fetch(`/api/sales-management/records/${id}/generate-invoice`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.invoice_number) {
      showToast(`Invoice ${data.invoice_number} already exists for this receipt.`, 'info');
    } else if (!res.ok) {
      throw new Error(data.error || 'Unable to generate invoice.');
    } else {
      showToast(`Invoice ${data.invoice_number} created.`, 'success');
    }
    closeGenerateInvoiceModal();
    await loadReceivables();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Unable to generate invoice.', 'error');
    if (submit) submit.disabled = false;
  }
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
    await Promise.all([loadReceivables(), loadCollections()]);
    showToast(isEdit ? 'Payment updated successfully' : 'Payment recorded successfully');
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
    await Promise.all([loadReceivables(), loadCollections()]);
    showToast('Payment deleted successfully');
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
