let vendorsDb = [];
let billsDb = [];
let paymentsDb = [];
let projectsDb = [];
let purchaseOrdersDb = [];
let businessEntitiesDb = [];
const BUSINESS_ENTITY_CONTEXT_KEY = 'kinaadman_businessEntityContext';
const BUSINESS_ENTITY_THEME_KEY = 'kinaadman_businessEntityTheme';
let currentBusinessEntityContextId = '';
let stagedBillPdf = null;
let editingBillId = null;
let removeExistingBillPdf = false;
let billVendorSearchBound = false;
const AP_UI_STATE_KEY = 'accounts-payable.uiState';
const apToolbarState = {
  bills: { search: '' },
  payments: { search: '' }
};
const AP_MASTER_DATA_TABS = new Set(['companies', 'vendors']);
const AP_PROCUREMENT_TABS = new Set(['requisitions', 'rfq', 'quotations', 'purchase-orders', 'goods-receipts']);
const AP_NATIVE_TABS = new Set(['bills', 'vendor-balances', 'ap-aging', 'payments', 'disbursements']);
let activeApTab = 'vendors';
let editingMasterDataCompanyId = null;

function isMasterDataWorkspacePage() {
  return (window.location.pathname || '').replace(/\/+$/, '') === '/master-data';
}

function isProcurementWorkspacePage() {
  return (window.location.pathname || '').replace(/\/+$/, '') === '/procurement';
}

function getWorkspaceAllowedTabs() {
  if (isMasterDataWorkspacePage()) return AP_MASTER_DATA_TABS;
  return isProcurementWorkspacePage() ? AP_PROCUREMENT_TABS : AP_NATIVE_TABS;
}

function getWorkspaceDefaultTab() {
  if (isMasterDataWorkspacePage()) return 'companies';
  return isProcurementWorkspacePage() ? 'requisitions' : 'bills';
}

function normalizeApWorkspaceTab(value) {
  let tab = String(value || '').trim().toLowerCase();
  if (tab === 'bid-evaluation') tab = 'quotations';
  const knownTab = (AP_MASTER_DATA_TABS.has(tab) || AP_PROCUREMENT_TABS.has(tab) || AP_NATIVE_TABS.has(tab)) ? tab : getWorkspaceDefaultTab();
  return getWorkspaceAllowedTabs().has(knownTab) ? knownTab : getWorkspaceDefaultTab();
}

function getDefaultApUiState() {
  return {
    activeTab: getWorkspaceDefaultTab(),
    toolbarState: {
      bills: { search: '' },
      payments: { search: '' }
    }
  };
}

function loadApUiState() {
  try {
    const raw = localStorage.getItem(AP_UI_STATE_KEY);
    if (!raw) return getDefaultApUiState();
    const parsed = JSON.parse(raw);
    const defaults = getDefaultApUiState();
    return {
      activeTab: normalizeApWorkspaceTab(parsed.activeTab || defaults.activeTab),
      toolbarState: {
        bills: { search: String(parsed.toolbarState?.bills?.search || '') },
        payments: { search: String(parsed.toolbarState?.payments?.search || '') }
      }
    };
  } catch (_) {
    return getDefaultApUiState();
  }
}

function saveApUiState() {
  try {
    localStorage.setItem(AP_UI_STATE_KEY, JSON.stringify({
      activeTab: activeApTab,
      toolbarState: apToolbarState
    }));
  } catch (_) {
    // Ignore storage errors in restricted browser modes.
  }
}

function restoreApUiState() {
  const state = loadApUiState();
  activeApTab = state.activeTab;
  apToolbarState.bills.search = state.toolbarState.bills.search;
  apToolbarState.payments.search = state.toolbarState.payments.search;
}

function setAccountsPayableActiveTab(tab, options = {}) {
  activeApTab = normalizeApWorkspaceTab(tab);
  syncApSummaryCards(activeApTab);
  if (options.persistState !== false) {
    saveApUiState();
  }
}

function syncApSummaryCards(tab = activeApTab) {
  const activeTab = normalizeApWorkspaceTab(tab);
  const grid = document.getElementById('ap-summary-grid');
  if (!grid) return;

  let hasVisibleCard = false;
  let visibleCount = 0;
  grid.dataset.activeTab = activeTab;
  grid.querySelectorAll('.ap-summary-card').forEach((card) => {
    const tabs = String(card.dataset.summaryTabs || '')
      .split(',')
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
      .filter((value) => AP_MASTER_DATA_TABS.has(value) || AP_PROCUREMENT_TABS.has(value) || AP_NATIVE_TABS.has(value));
    const shouldShow = tabs.includes(activeTab) && visibleCount < 5;
    card.hidden = !shouldShow;
    if (!card.hidden) {
      hasVisibleCard = true;
      visibleCount += 1;
    }
  });
  grid.hidden = !hasVisibleCard;
}

function applyWorkspaceModeUi() {
  const masterDataMode = isMasterDataWorkspacePage();
  const procurementMode = isProcurementWorkspacePage();
  const title = document.getElementById('module-page-title');
  const subtitle = document.getElementById('module-page-subtitle');
  const headerSub = document.getElementById('module-header-sub');
  const badge = document.getElementById('module-admin-badge');
  const allowedTabs = getWorkspaceAllowedTabs();
  const purchasingRoot = document.getElementById('ap-purchasing-root');
  document.body.dataset.workspaceMode = masterDataMode ? 'master-data' : (procurementMode ? 'procurement' : 'ap');
  if (purchasingRoot) {
    purchasingRoot.dataset.workspaceRoot = masterDataMode ? 'master-data' : 'procurement';
  }

  document.title = masterDataMode
    ? 'KVSK CCTV & IT Solution - Master Data'
    : procurementMode
    ? 'KVSK CCTV & IT Solution - Procurement'
    : 'KVSK CCTV & IT Solution - Accounts Payable';
  if (title) title.textContent = masterDataMode ? 'Master Data Management' : (procurementMode ? 'Procurement Management' : 'Accounts Payable Management');
  if (subtitle) {
    subtitle.textContent = masterDataMode
      ? 'Maintain company and vendor master records used across procurement, projects, and finance.'
      : procurementMode
      ? 'Manage requisitions, RFQs, quotation evaluation, purchase orders, and receipts.'
      : 'Manage bills, vendor balances, aging, payments, and disbursements.';
  }
  if (headerSub) headerSub.textContent = masterDataMode ? 'Master Data' : (procurementMode ? 'Procurement' : 'Accounts Payable');
  if (badge) badge.textContent = masterDataMode ? 'Master Data Module' : (procurementMode ? 'Procurement Module' : 'Payables Module');

  document.querySelectorAll('.ap-workspace-tab').forEach((tab) => {
    const tabName = normalizeWorkspaceTabName(tab.dataset.workspaceTab || tab.dataset.procTab || tab.dataset.tab || '');
    tab.hidden = !allowedTabs.has(tabName);
    tab.setAttribute('aria-hidden', String(tab.hidden));
  });
  document.querySelectorAll('.master-data-tab').forEach((tab) => {
    tab.hidden = !masterDataMode;
    tab.setAttribute('aria-hidden', String(tab.hidden));
    tab.classList.toggle('active', masterDataMode && tab.dataset.masterDataTab === activeApTab);
  });
}

function normalizeWorkspaceTabName(value) {
  const tab = String(value || '').trim().toLowerCase();
  if (AP_MASTER_DATA_TABS.has(tab) || AP_PROCUREMENT_TABS.has(tab) || AP_NATIVE_TABS.has(tab)) return tab;
  return '';
}

function setMetricText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function formatApMoney(value) {
  if (typeof formatPhpCurrency === 'function') {
    return formatPhpCurrency(value);
  }
  return 'PHP ' + Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 });
}

function isInCurrentMonth(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
}

document.addEventListener('DOMContentLoaded', () => {
  setupMasterDataCompanyFrame();
  bindMasterDataCompanyModal();
  restoreApUiState();
  const params = new URLSearchParams(window.location.search);
  if (params.has('tab')) {
    activeApTab = normalizeApWorkspaceTab(params.get('tab'));
  }
  applyWorkspaceModeUi();
  bindMasterDataTabLinks();
  const requestedTab = params.has('tab') ? normalizeApWorkspaceTab(params.get('tab')) : activeApTab;
  const initialButton = document.querySelector(`.ap-workspace-tab[data-workspace-tab="${requestedTab}"]`)
    || document.querySelector('.ap-workspace-tab.active')
    || document.querySelector('.module-tab.active');
  switchApWorkspaceTab(requestedTab, initialButton, { captureState: false, persistState: false });
  if (!params.has('tab')) {
    syncApTabUrl(requestedTab);
  }
  initBillVendorSearch();
  loadVendors();
  loadBusinessEntitiesForBills();
  loadProjectsForBills();
  loadPurchaseOrdersForBills();
  loadBills();
  loadPayments();
  document.getElementById('f-bill-date').valueAsDate = new Date();
  document.getElementById('f-payment-date').valueAsDate = new Date();
  if (typeof loadNotifications === 'function') loadNotifications();
});

function bindMasterDataTabLinks() {
  if (!isMasterDataWorkspacePage()) return;
  document.querySelectorAll('a[href^="/master-data?tab="]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const url = new URL(link.getAttribute('href'), window.location.origin);
      const tab = normalizeApWorkspaceTab(url.searchParams.get('tab') || '');
      if (!AP_MASTER_DATA_TABS.has(tab)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      switchApWorkspaceTab(tab, document.querySelector(`.ap-workspace-tab[data-workspace-tab="${tab}"]`));
    }, { capture: true });
  });
}

async function doLogout() {
  const confirmed = await openConfirmDialog({
    title: 'Logout?',
    message: 'Maglo-logout ka na. Gusto mo bang ituloy?',
    noText: 'No',
    yesText: 'Yes'
  });
  if (!confirmed) return;
  fetch('/logout', { method: 'POST' }).then(() => { window.location.href = '/'; });
}

function getDefaultBillBusinessEntityId() {
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
  const fallback = getDefaultBillBusinessEntityId();
  currentBusinessEntityContextId = fallback;
  if (fallback) localStorage.setItem(BUSINESS_ENTITY_CONTEXT_KEY, fallback);
  return fallback;
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

function businessEntityMatches(row) {
  void row;
  return true;
}

function renderArchivedProjectBadge(row = {}) {
  return row.project_is_archived === true || Number(row.project_is_archived || 0) === 1
    ? '<div style="margin-top:4px;"><span class="status-pill status-cancelled">Archived Project</span></div>'
    : '';
}

function getBusinessEntityBrandProfile(row) {
  void row;
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

function renderBusinessEntitySwitcher() {
  const host = document.getElementById('business-entity-switcher');
  const rows = Array.isArray(businessEntitiesDb) ? businessEntitiesDb : [];
  const current = getCurrentBusinessEntityId();
  if (host) {
    host.innerHTML = rows.map(row => {
      const id = String(row.id || '');
      return `<button class="business-entity-switch${id === current ? ' is-active' : ''}" type="button" onclick="setBusinessEntityContext('${escHtml(id)}')" aria-pressed="${id === current ? 'true' : 'false'}">${escHtml(businessEntityShortLabel(row))}</button>`;
    }).join('');
  }
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
  renderBusinessEntitySwitcher();
  renderBillBusinessEntityOptions();
  filterBills();
  filterPayments();
  if (typeof renderSummary === 'function') renderSummary();
  if (typeof loadProcurementData === 'function') {
    loadProcurementData().catch((err) => console.error('Procurement business entity refresh error:', err));
  } else {
    if (typeof renderRequisitions === 'function') renderRequisitions();
    if (typeof renderPurchaseOrders === 'function') renderPurchaseOrders();
    if (typeof renderGoodsReceipts === 'function') renderGoodsReceipts();
  }
}

function renderBillBusinessEntityOptions(selectedValue = '') {
  const select = document.getElementById('f-bill-business-entity');
  if (!select) return;
  const rows = Array.isArray(businessEntitiesDb) ? businessEntitiesDb : [];
  const selected = String(selectedValue || select.value || getDefaultBillBusinessEntityId() || '').trim();
  select.innerHTML = rows.length
    ? rows.map(row => `<option value="${escHtml(row.id)}">${escHtml(row.company_name || row.entity_code || 'Operating Company')}</option>`).join('')
    : '<option value="">Default company</option>';
  if (selected && [...select.options].some(option => String(option.value) === selected)) {
    select.value = selected;
  } else if (rows.length) {
    select.value = getDefaultBillBusinessEntityId();
  }
}

function loadBusinessEntitiesForBills() {
  fetch('/api/business-entities', { cache: 'no-store' })
    .then(async (r) => {
      const data = await r.json().catch(() => []);
      if (!r.ok) throw new Error(data.error || 'Unable to load operating companies.');
      return data;
    })
    .then((rows) => {
      businessEntitiesDb = Array.isArray(rows) ? rows : [];
      renderBusinessEntitySwitcher();
      renderBillBusinessEntityOptions();
    })
    .catch((err) => {
      console.error('Load bill operating companies error:', err);
      businessEntitiesDb = [];
      renderBusinessEntitySwitcher();
      renderBillBusinessEntityOptions();
    });
}

function goBackToDashboard() {
  const role = String(
    document.body?.dataset?.accessRole
    || document.documentElement?.dataset?.accessRole
    || ''
  ).trim().toLowerCase();
  window.location.href = role === 'staff' ? '/staff' : '/admin?view=dashboard';
}

function captureApToolbarState(tab) {
  if (tab === 'bills') {
    apToolbarState.bills.search = document.getElementById('bills-search')?.value || '';
  } else if (tab === 'payments') {
    apToolbarState.payments.search = document.getElementById('payments-search')?.value || '';
  } else if (tab === 'disbursements') {
    apToolbarState.payments.search = document.getElementById('disbursements-search')?.value || '';
  }
}

function renderApToolbarControls(tab) {
  const actions = document.getElementById('module-toolbar-actions');
  if (!actions) return;

  const state = apToolbarState[tab] || {};

  if (tab === 'companies') {
    const isStaff = isCurrentStaffRole();
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="master-data-company-search" type="text" placeholder="Search company no, name, or address..." oninput="filterMasterDataCompanies()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openMasterDataCompanyModal()">${isStaff ? 'Request Company' : 'Add Company'}</button>
    `;
    syncMasterDataCompanySearch();
    return;
  }

  if (tab === 'bills') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="bills-search" type="text" placeholder="Search bill number, vendor, or status..." value="${escHtml(state.search || '')}" oninput="filterBills()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openBillModal()">New Bill</button>
    `;
    return;
  }

  if (tab === 'payments') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="payments-search" type="text" placeholder="Search payment date, bill, vendor, or reference..." value="${escHtml(state.search || '')}" oninput="filterPayments()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openPaymentModal()">Record Payment</button>
    `;
    return;
  }

  if (tab === 'disbursements') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="disbursements-search" type="text" placeholder="Search disbursement date, bill, vendor, or reference..." value="${escHtml(apToolbarState.payments.search || '')}" oninput="renderDisbursements()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openPaymentModal()">Record Disbursement</button>
    `;
    return;
  }

  actions.innerHTML = '';
}

function isCurrentStaffRole() {
  const role = String(
    document.body?.dataset?.accessRole ||
    document.documentElement?.dataset?.accessRole ||
    ''
  ).trim().toLowerCase();
  return role === 'staff';
}

function switchTab(tab, btn, options = {}) {
  const nextTab = AP_NATIVE_TABS.has(tab) ? tab : 'bills';
  const captureState = options.captureState !== false;
  const persistState = options.persistState !== false;
  if (captureState) {
    captureApToolbarState(activeApTab);
  }
  document.querySelectorAll('.ap-workspace-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.ap-workspace-section').forEach(s => s.classList.remove('active'));
  const tabButton = btn || document.querySelector(`.ap-workspace-tab[data-tab="${nextTab}"]`);
  if (tabButton) tabButton.classList.add('active');
  document.getElementById(nextTab).classList.add('active');
  activeApTab = nextTab;
  renderApToolbarControls(nextTab);
  syncApSummaryCards(nextTab);
  if (nextTab === 'vendor-balances') renderVendorBalances();
  if (nextTab === 'ap-aging') renderApAging();
  if (nextTab === 'disbursements') renderDisbursements();
  if (persistState) {
    saveApUiState();
    syncApTabUrl(nextTab);
  }
}

function switchApWorkspaceTab(tab, btn, options = {}) {
  const nextTab = normalizeApWorkspaceTab(tab);
  if (nextTab === 'companies') {
    const captureState = options.captureState !== false;
    const persistState = options.persistState !== false;
    if (captureState) {
      captureApToolbarState(activeApTab);
    }
    activeApTab = nextTab;
    if (isMasterDataWorkspacePage()) {
      document.body.dataset.initialTab = nextTab;
    }
    document.querySelectorAll('.ap-workspace-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.ap-workspace-section').forEach(s => s.classList.remove('active'));
    const tabButton = btn || document.querySelector('.ap-workspace-tab[data-workspace-tab="companies"]');
    if (tabButton) tabButton.classList.add('active');
    document.getElementById('companies')?.classList.add('active');
    syncApSummaryCards(nextTab);
    renderApToolbarControls(nextTab);
    ensureMasterDataCompanyFrameLoaded();
    loadMasterDataCompanyMetrics();
    if (persistState) {
      saveApUiState();
      syncApTabUrl(nextTab);
    }
    return;
  }
  if (AP_MASTER_DATA_TABS.has(nextTab) || AP_PROCUREMENT_TABS.has(nextTab)) {
    const captureState = options.captureState !== false;
    const persistState = options.persistState !== false;
    if (captureState) {
      captureApToolbarState(activeApTab);
    }
    activeApTab = nextTab;
    if (isMasterDataWorkspacePage()) {
      document.body.dataset.initialTab = nextTab;
    }
    syncApSummaryCards(nextTab);
    if (persistState) {
      saveApUiState();
      syncApTabUrl(nextTab);
    }
    if (typeof switchProcTab === 'function') {
      switchProcTab(nextTab, btn || document.querySelector(`.ap-workspace-tab[data-proc-tab="${nextTab}"]`));
    } else {
      document.querySelectorAll('.ap-workspace-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.ap-workspace-section').forEach(s => s.classList.remove('active'));
      const tabButton = btn || document.querySelector(`.ap-workspace-tab[data-proc-tab="${nextTab}"]`);
      if (tabButton) tabButton.classList.add('active');
      document.getElementById(nextTab)?.classList.add('active');
      renderApToolbarControls('');
    }
    return;
  }

  switchTab(nextTab, btn, options);
}

function getMasterDataCompanyFrame() {
  return document.getElementById('company-registry-frame');
}

function getMasterDataCompanyWindow() {
  const frame = getMasterDataCompanyFrame();
  return frame?.contentWindow || null;
}

function ensureMasterDataCompanyFrameLoaded() {
  const frame = getMasterDataCompanyFrame();
  if (!frame) return;
  if (!frame.getAttribute('src')) {
    frame.setAttribute('src', frame.dataset.src || '/erp?embedded=1');
  }
}

function setupMasterDataCompanyFrame() {
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === 'master-data-frame-height') {
      const height = Math.max(520, Number(event.data.height || 0) || 0);
      const frame = getMasterDataCompanyFrame();
      if (frame) frame.style.height = `${height}px`;
      return;
    }
    if (event.data?.type === 'master-data-company-metrics') {
      renderMasterDataCompanyMetrics(event.data.metrics || {});
      return;
    }
    if (event.data?.type === 'master-data-company-open-modal') {
      openMasterDataCompanyModal(event.data.companyId || null);
    }
  });
  const frame = getMasterDataCompanyFrame();
  if (frame && frame.dataset.bound !== '1') {
    frame.dataset.bound = '1';
    frame.addEventListener('load', () => {
      syncMasterDataCompanySearch();
      loadMasterDataCompanyMetrics();
    });
  }
}

function bindMasterDataCompanyModal() {
  const backdrop = document.getElementById('master-company-modal-backdrop');
  if (backdrop && backdrop.dataset.bound !== '1') {
    backdrop.dataset.bound = '1';
    backdrop.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) {
        closeMasterDataCompanyModal();
      }
    });
  }

  const tinInput = document.getElementById('f-master-company-tin');
  if (tinInput && tinInput.dataset.tinMaskBound !== '1') {
    const applyMask = () => {
      const formatted = formatMasterDataCompanyTin(tinInput.value);
      if (tinInput.value !== formatted) tinInput.value = formatted;
    };
    tinInput.dataset.tinMaskBound = '1';
    tinInput.addEventListener('input', applyMask);
    tinInput.addEventListener('blur', applyMask);
  }

  const phoneInput = document.getElementById('f-master-company-phone');
  if (phoneInput && phoneInput.dataset.phoneDigitsBound !== '1') {
    const applyPhoneMask = () => {
      const normalized = normalizeMasterDataCompanyPhone(phoneInput.value).slice(0, 11);
      if (phoneInput.value !== normalized) phoneInput.value = normalized;
    };
    phoneInput.dataset.phoneDigitsBound = '1';
    phoneInput.setAttribute('maxlength', '11');
    phoneInput.setAttribute('inputmode', 'numeric');
    phoneInput.addEventListener('input', applyPhoneMask);
    phoneInput.addEventListener('blur', applyPhoneMask);
  }

  ['f-master-company-name', 'f-master-company-contact', 'f-master-company-email', 'f-master-company-phone', 'f-master-company-tin', 'f-master-company-address'].forEach((id) => {
    const input = document.getElementById(id);
    if (!input || input.dataset.companyValidationBound === '1') return;
    input.dataset.companyValidationBound = '1';
    input.addEventListener('input', () => setMasterDataCompanyFieldMessage(getMasterDataCompanyFieldName(id), ''));
  });
}

function getMasterDataCompanyFieldName(id) {
  const map = {
    'f-master-company-no': 'company_no',
    'f-master-company-name': 'company_name',
    'f-master-company-contact': 'contact_person',
    'f-master-company-email': 'email',
    'f-master-company-phone': 'phone',
    'f-master-company-tin': 'tin',
    'f-master-company-address': 'address'
  };
  return map[id] || '';
}

function getMasterDataCompanyControl(fieldName) {
  const map = {
    company_no: 'f-master-company-no',
    company_name: 'f-master-company-name',
    contact_person: 'f-master-company-contact',
    email: 'f-master-company-email',
    phone: 'f-master-company-phone',
    tin: 'f-master-company-tin',
    address: 'f-master-company-address'
  };
  return document.getElementById(map[fieldName] || '');
}

function setMasterDataCompanyFieldMessage(fieldName, message = '') {
  const text = String(message || '').trim();
  document.querySelectorAll(`[data-master-company-field-message="${fieldName}"]`).forEach((notice) => {
    const field = notice.closest('.field');
    notice.textContent = text;
    notice.classList.toggle('is-hidden', !text);
    if (field) field.classList.toggle('has-error', !!text);
  });
  const control = getMasterDataCompanyControl(fieldName);
  if (control) control.setAttribute('aria-invalid', text ? 'true' : 'false');
}

function clearMasterDataCompanyFieldMessages() {
  ['company_no', 'company_name', 'contact_person', 'email', 'phone', 'tin', 'address'].forEach((fieldName) => {
    setMasterDataCompanyFieldMessage(fieldName, '');
  });
}

function normalizeMasterDataCompanyPhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeMasterDataCompanyTin(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 12);
}

function formatMasterDataCompanyTin(value) {
  const digits = normalizeMasterDataCompanyTin(value);
  return digits.replace(/(\d{3})(?=\d)/g, '$1-').slice(0, 15);
}

function resetMasterDataCompanyForm() {
  editingMasterDataCompanyId = null;
  clearMasterDataCompanyFieldMessages();
  ['f-master-company-no', 'f-master-company-branch-code', 'f-master-company-name', 'f-master-company-contact', 'f-master-company-email', 'f-master-company-phone', 'f-master-company-tin', 'f-master-company-address', 'f-master-company-notes'].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  const saveBtn = document.getElementById('master-company-save-btn');
  const title = document.getElementById('master-company-modal-title');
  const staffRequest = isCurrentStaffRole();
  if (title) title.textContent = staffRequest ? 'Request Company Registry' : 'Add Company';
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = staffRequest ? 'Submit Request' : 'Create Company';
  }
}

async function loadMasterDataCompanyNumberPreview() {
  const input = document.getElementById('f-master-company-no');
  if (input) input.value = 'Loading...';
  try {
    const data = await fetchJson('/api/company-registry/next-no', { cache: 'no-store' });
    if (input) input.value = data.company_no || '';
  } catch (_) {
    if (input) input.value = '';
  }
}

async function openMasterDataCompanyModal(companyId = null) {
  resetMasterDataCompanyForm();
  bindMasterDataCompanyModal();
  const numericCompanyId = Number(companyId || 0) || 0;
  if (isCurrentStaffRole() && numericCompanyId) {
    showToast('Staff can request new companies only. Existing registry changes need admin approval.', 'error');
    return;
  }
  editingMasterDataCompanyId = numericCompanyId || null;
  if (numericCompanyId) {
    await loadMasterDataCompanyForEdit(numericCompanyId);
  } else {
    loadMasterDataCompanyNumberPreview();
  }
  const backdrop = document.getElementById('master-company-modal-backdrop');
  if (backdrop) {
    backdrop.hidden = false;
    backdrop.style.removeProperty('display');
    backdrop.style.removeProperty('visibility');
    backdrop.style.removeProperty('opacity');
    backdrop.style.removeProperty('pointer-events');
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
  }
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('f-master-company-name')?.focus(), 60);
}

async function loadMasterDataCompanyForEdit(companyId) {
  const title = document.getElementById('master-company-modal-title');
  const saveBtn = document.getElementById('master-company-save-btn');
  if (title) title.textContent = 'Edit Company';
  if (saveBtn) saveBtn.textContent = 'Save Changes';

  try {
    const rows = await fetchJson('/api/company-registry?include_archived=1', { cache: 'no-store' });
    const company = (Array.isArray(rows) ? rows : []).find((row) => Number(row.id || 0) === Number(companyId)) || null;
    if (!company) throw new Error('Company not found.');
    document.getElementById('f-master-company-no').value = company.company_no || '';
    document.getElementById('f-master-company-branch-code').value = String(company.branch_code || '').trim() === '000' ? '' : (company.branch_code || '');
    document.getElementById('f-master-company-name').value = company.company_name || '';
    document.getElementById('f-master-company-contact').value = company.contact_person || '';
    document.getElementById('f-master-company-email').value = company.email || '';
    document.getElementById('f-master-company-phone').value = company.phone || '';
    document.getElementById('f-master-company-tin').value = formatMasterDataCompanyTin(company.tin || '');
    document.getElementById('f-master-company-address').value = company.address || '';
    document.getElementById('f-master-company-notes').value = company.notes || '';
  } catch (err) {
    showToast(err.message || 'Unable to load company.', 'error');
    editingMasterDataCompanyId = null;
  }
}

function closeMasterDataCompanyModal() {
  const backdrop = document.getElementById('master-company-modal-backdrop');
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
  resetMasterDataCompanyForm();
}

function validateMasterDataCompanyForm(payload) {
  clearMasterDataCompanyFieldMessages();
  const required = [
    ['company_no', payload.company_no, 'Company No. is required.'],
    ['company_name', payload.company_name, 'Company Name is required.'],
    ['contact_person', payload.contact_person, 'Contact Person is required.'],
    ['email', payload.email, 'Email is required.'],
    ['phone', payload.phone, 'Phone is required.'],
    ['tin', payload.tin, 'TIN is required.'],
    ['address', payload.address, 'Address is required.']
  ];
  let firstInvalid = '';
  required.forEach(([fieldName, value, message]) => {
    if (!String(value || '').trim()) {
      setMasterDataCompanyFieldMessage(fieldName, message);
      if (!firstInvalid) firstInvalid = fieldName;
    }
  });

  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    setMasterDataCompanyFieldMessage('email', 'Please enter a valid email address.');
    if (!firstInvalid) firstInvalid = 'email';
  }

  if (payload.phone && typeof isValidPhoneForField === 'function' && !isValidPhoneForField('f-master-company-phone', payload.phone)) {
    setMasterDataCompanyFieldMessage('phone', 'Phone must be exactly 11 digits and numbers only.');
    if (!firstInvalid) firstInvalid = 'phone';
  }

  if (payload.tin && normalizeMasterDataCompanyTin(payload.tin).length !== 12) {
    setMasterDataCompanyFieldMessage('tin', 'TIN must follow 000-000-000-000 format.');
    if (!firstInvalid) firstInvalid = 'tin';
  }

  if (firstInvalid) {
    getMasterDataCompanyControl(firstInvalid)?.focus();
    return false;
  }
  return true;
}

function refreshMasterDataCompanyFrame() {
  const frameWindow = getMasterDataCompanyWindow();
  if (typeof frameWindow?.loadCompanies === 'function') {
    frameWindow.loadCompanies();
  }
}

async function saveMasterDataCompany() {
  const payload = {
    company_no: String(document.getElementById('f-master-company-no')?.value || '').trim(),
    branch_code: String(document.getElementById('f-master-company-branch-code')?.value || '').trim(),
    company_name: String(document.getElementById('f-master-company-name')?.value || '').trim(),
    contact_person: String(document.getElementById('f-master-company-contact')?.value || '').trim(),
    email: String(document.getElementById('f-master-company-email')?.value || '').trim(),
    phone: normalizeMasterDataCompanyPhone(document.getElementById('f-master-company-phone')?.value || ''),
    tin: formatMasterDataCompanyTin(document.getElementById('f-master-company-tin')?.value || ''),
    address: String(document.getElementById('f-master-company-address')?.value || '').trim(),
    status: 'active',
    notes: String(document.getElementById('f-master-company-notes')?.value || '').trim()
  };

  if (!validateMasterDataCompanyForm(payload)) return;

  const saveBtn = document.getElementById('master-company-save-btn');
  const isEdit = Number(editingMasterDataCompanyId || 0) > 0;
  const staffRequest = isCurrentStaffRole();
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = staffRequest ? 'Submitting...' : 'Saving...';
  }

  try {
    if (staffRequest) {
      await fetchJson('/api/company-registry-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      closeMasterDataCompanyModal();
      showToast('Company registry request submitted for admin approval.', 'success');
      return;
    }

    await fetchJson(isEdit ? `/api/company-registry/${Number(editingMasterDataCompanyId)}` : '/api/company-registry', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeMasterDataCompanyModal();
    refreshMasterDataCompanyFrame();
    loadMasterDataCompanyMetrics();
    showToast(isEdit ? 'Company updated successfully!' : 'Company created successfully!', 'success');
  } catch (err) {
    const message = err.message || 'Unable to save company.';
    const lower = message.toLowerCase();
    if (lower.includes('tin')) {
      setMasterDataCompanyFieldMessage('tin', message);
      getMasterDataCompanyControl('tin')?.focus();
    } else if (lower.includes('phone')) {
      setMasterDataCompanyFieldMessage('phone', message);
      getMasterDataCompanyControl('phone')?.focus();
    } else if (lower.includes('email')) {
      setMasterDataCompanyFieldMessage('email', message);
      getMasterDataCompanyControl('email')?.focus();
    } else {
      setMasterDataCompanyFieldMessage('company_name', message);
      getMasterDataCompanyControl('company_name')?.focus();
    }
    showToast(message, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = staffRequest ? 'Submit Request' : (isEdit ? 'Save Changes' : 'Create Company');
    }
  }
}

function syncMasterDataCompanySearch() {
  const input = document.getElementById('master-data-company-search');
  const frameWindow = getMasterDataCompanyWindow();
  const frameInput = frameWindow?.document?.getElementById('company-search-input');
  if (input && frameInput) {
    frameInput.value = input.value || '';
    if (typeof frameWindow.renderCompanies === 'function') {
      frameWindow.renderCompanies();
    }
  }
}

function filterMasterDataCompanies() {
  ensureMasterDataCompanyFrameLoaded();
  syncMasterDataCompanySearch();
}

function renderMasterDataCompanyMetrics(metrics = {}) {
  const total = Number(metrics.total || 0);
  const archived = Number(metrics.archived || 0);
  const active = Number(metrics.active || Math.max(0, total - archived));
  const totalNode = document.getElementById('metric-master-companies-total');
  const activeNode = document.getElementById('metric-master-companies-active');
  const archivedNode = document.getElementById('metric-master-companies-archived');
  const profilesNode = document.getElementById('metric-master-companies-profiles');
  const activeRateNode = document.getElementById('metric-master-companies-active-rate');
  if (totalNode) totalNode.textContent = String(total);
  if (activeNode) activeNode.textContent = String(active);
  if (archivedNode) archivedNode.textContent = String(archived);
  if (profilesNode) profilesNode.textContent = String(Array.isArray(businessEntitiesDb) ? businessEntitiesDb.length : 0);
  if (activeRateNode) activeRateNode.textContent = total > 0 ? `${Math.round((active / total) * 100)}%` : '0%';
}

async function loadMasterDataCompanyMetrics() {
  if (!isMasterDataWorkspacePage()) return;
  try {
    const rows = await fetchJson('/api/company-registry?include_archived=1', { cache: 'no-store' });
    const companies = Array.isArray(rows) ? rows : [];
    const total = companies.length;
    const archived = companies.filter((company) => Number(company.archived || 0) === 1).length;
    renderMasterDataCompanyMetrics({
      total,
      archived,
      active: Math.max(0, total - archived)
    });
  } catch (_) {
    renderMasterDataCompanyMetrics();
  }
}

function syncApTabUrl(tab) {
  if (!window.history?.replaceState) return;
  const nextTab = normalizeApWorkspaceTab(tab);
  const url = new URL(window.location.href);
  url.pathname = isMasterDataWorkspacePage() ? '/master-data' : (isProcurementWorkspacePage() ? '/procurement' : '/accounts-payable');
  url.searchParams.set('tab', nextTab);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  if (typeof syncSidebarActiveLinks === 'function') {
    syncSidebarActiveLinks();
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// VENDORS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function loadVendors() {
  return fetch('/api/vendors')
    .then(async (r) => {
      const data = await r.json().catch(() => []);
      if (!r.ok) {
        throw new Error(data.error || 'Unable to load vendors.');
      }
      return data;
    })
    .then((data) => {
      vendorsDb = Array.isArray(data) ? data : [];
      updateVendorSelects();
      syncBillVendorSearchResults();
      renderBills();
      renderPayments();
      updateMetrics();
    })
    .catch((e) => {
      console.error('Error:', e);
      vendorsDb = [];
      updateVendorSelects();
      syncBillVendorSearchResults();
      renderBills();
      renderPayments();
      updateMetrics();
    });
}

function updateVendorSelects() {
  const hiddenInput = document.getElementById('f-bill-vendor');
  const searchInput = document.getElementById('f-bill-vendor-search');
  if (!hiddenInput || !searchInput) return;

  const selectedVendor = vendorsDb.find((vendor) => String(vendor.id) === String(hiddenInput.value || ''));
  if (selectedVendor) {
    searchInput.value = selectedVendor.vendor_name || '';
    hiddenInput.value = String(selectedVendor.id);
  } else if (!searchInput.value.trim()) {
    hiddenInput.value = '';
  }
}

function initBillVendorSearch() {
  const input = document.getElementById('f-bill-vendor-search');
  const results = document.getElementById('f-bill-vendor-results');
  if (!input || !results || billVendorSearchBound) return;

  billVendorSearchBound = true;

  input.addEventListener('input', handleBillVendorSearch);
  input.addEventListener('focus', (event) => handleBillVendorSearch(event, true));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideBillVendorResults();
    }
  });

  results.addEventListener('click', (event) => {
    const item = event.target.closest('.search-result-item');
    if (!item || item.classList.contains('search-result-empty')) return;
    selectBillVendor(item.dataset.id, item.dataset.label || '');
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.bill-vendor-search')) {
      hideBillVendorResults();
    }
  });
}

function handleBillVendorSearch(event, showAll = false) {
  const input = event?.target || document.getElementById('f-bill-vendor-search');
  const hiddenInput = document.getElementById('f-bill-vendor');
  if (!input || !hiddenInput) return;

  if (event?.type === 'input') {
    hiddenInput.value = '';
  }
  const hasQuery = String(input.value || '').trim().length > 0;
  renderBillVendorSearchResults(String(input.value || ''), showAll || !hasQuery);
}

function renderBillVendorSearchResults(query = '', showAll = false) {
  const input = document.getElementById('f-bill-vendor-search');
  const results = document.getElementById('f-bill-vendor-results');
  if (!input || !results) return;

  const q = String(query || input.value || '').trim().toLowerCase();
  const filtered = vendorsDb.filter((vendor) => businessEntityMatches(vendor)).filter((vendor) => {
    if (!q) return showAll;
    return [
      vendor.vendor_name,
      vendor.contact_person,
      vendor.email,
      vendor.phone,
      vendor.address,
      vendor.tin
    ].join(' ').toLowerCase().includes(q);
  });

  if (!filtered.length) {
    results.innerHTML = '<div class="search-result-item search-result-empty">No vendors found</div>';
    results.style.display = 'block';
    return;
  }

  results.innerHTML = filtered.slice(0, 8).map((vendor) => {
    const label = vendor.vendor_name || 'Vendor';
    const contact = vendor.contact_person || 'No contact';
    const email = vendor.email ? ` • ${highlightText(vendor.email, q)}` : '';
    return `
      <div class="search-result-item" data-id="${escHtml(vendor.id)}" data-label="${escHtml(label)}">
        <div class="search-result-name">${highlightText(label, q)}</div>
        <div class="search-result-sub">${highlightText(contact, q)}${email}</div>
      </div>
    `;
  }).join('');
  results.style.display = 'block';
}

function syncBillVendorSearchResults() {
  const input = document.getElementById('f-bill-vendor-search');
  if (!input) return;
  if (input.value.trim()) {
    renderBillVendorSearchResults(input.value, true);
  } else {
    hideBillVendorResults();
  }
}

function selectBillVendor(id, label) {
  const hiddenInput = document.getElementById('f-bill-vendor');
  const input = document.getElementById('f-bill-vendor-search');
  if (!hiddenInput || !input) return;

  hiddenInput.value = String(id || '');
  input.value = label || '';
  hideBillVendorResults();
}

function hideBillVendorResults() {
  const results = document.getElementById('f-bill-vendor-results');
  if (!results) return;
  results.style.display = 'none';
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// BILLS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function loadBills() {
  return fetch('/api/bills')
    .then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data.error || 'Unable to load bills.');
      }
      return data;
    })
    .then(data => {
      billsDb = Array.isArray(data) ? data : [];
      renderBills();
      updateBillSelects();
      updateMetrics();
    })
    .catch((e) => {
      console.error('Error:', e);
      billsDb = [];
      renderBills();
      updateBillSelects();
      updateMetrics();
    });
}

function loadProjectsForBills() {
  return fetch('/api/projects')
    .then(async (r) => {
      const data = await r.json().catch(() => []);
      if (!r.ok) {
        throw new Error(data.error || 'Unable to load projects.');
      }
      return data;
    })
    .then((data) => {
      projectsDb = Array.isArray(data) ? data : [];
      updateBillProjectSelect();
      renderBills();
    })
    .catch((e) => {
      console.error('Error:', e);
      projectsDb = [];
      updateBillProjectSelect();
      renderBills();
    });
}

function loadPurchaseOrdersForBills() {
  return fetch('/api/procurement/purchase-orders')
    .then(async (r) => {
      const data = await r.json().catch(() => []);
      if (!r.ok) {
        throw new Error(data.error || 'Unable to load purchase orders.');
      }
      return data;
    })
    .then((data) => {
      purchaseOrdersDb = Array.isArray(data) ? data : [];
      updateBillPurchaseOrderSelect();
    })
    .catch((e) => {
      console.error('Error:', e);
      purchaseOrdersDb = [];
      updateBillPurchaseOrderSelect();
    });
}

function updateBillPurchaseOrderSelect() {
  const select = document.getElementById('f-bill-po');
  if (!select) return;

  const current = String(select.value || '').trim();
  const options = purchaseOrdersDb
    .filter((po) => businessEntityMatches(po))
    .map((po) => {
      const label = [
        po.po_number || `PO #${po.id}`,
        po.vendor_name,
        po.project_docno || po.project_name
      ].map((value) => String(value || '').trim()).filter(Boolean).join(' - ');
      return `<option value="${escHtml(po.id)}">${escHtml(label)}</option>`;
    }).join('');

  select.innerHTML = `<option value="">No linked PO</option>${options}`;
  if (current) select.value = current;
}

function getBillPurchaseOrderById(poId) {
  const id = Number(poId || 0) || 0;
  if (!id) return null;
  return purchaseOrdersDb.find((po) => Number(po.id || 0) === id) || null;
}

function selectBillVendorById(vendorId) {
  const vendor = vendorsDb.find((entry) => Number(entry.id || 0) === Number(vendorId || 0));
  if (!vendor) return;
  const hiddenInput = document.getElementById('f-bill-vendor');
  const input = document.getElementById('f-bill-vendor-search');
  if (hiddenInput) hiddenInput.value = String(vendor.id);
  if (input) input.value = vendor.vendor_name || '';
}

function syncBillFromPurchaseOrder() {
  const po = getBillPurchaseOrderById(document.getElementById('f-bill-po')?.value || 0);
  if (!po) return;

  renderBillBusinessEntityOptions(po.business_entity_id || '');
  selectBillVendorById(po.vendor_id);

  const projectSelect = document.getElementById('f-bill-project');
  if (projectSelect && Number(po.project_id || 0) > 0) {
    projectSelect.value = String(po.project_id);
  }

  const amountInput = document.getElementById('f-bill-amount');
  if (amountInput && !String(amountInput.value || '').trim()) {
    amountInput.value = Number(po.computed_total || po.total_amount || 0) || '';
  }

  const billNumberInput = document.getElementById('f-bill-number');
  if (billNumberInput && !String(billNumberInput.value || '').trim()) {
    void loadBillNumberPreview();
  }
}

function getBillProjectLabel(bill) {
  const project = projectsDb.find((row) => Number(row.id || 0) === Number(bill?.project_id || 0));
  const projectDocno = String(bill?.project_docno || project?.project_docno || project?.source_docno || '').trim();
  const projectName = String(bill?.project_name || project?.project_name || '').trim();
  return [projectDocno, projectName].filter(Boolean).join(' - ') || '-';
}

function normalizeApprovalStatus(value) {
  const status = String(value || 'approved').trim().toLowerCase();
  if (status === 'pending') return 'pending';
  if (status === 'rejected') return 'rejected';
  return 'approved';
}

function canApproveApRecords() {
  if (typeof isAdminUser === 'function') return Boolean(isAdminUser());
  const user = typeof currentUser !== 'undefined' ? currentUser : window.currentUser;
  const role = String(user?.role || '').trim().toLowerCase();
  return role === 'super_admin' || role === 'admin';
}

function getApprovalUiStatus(row) {
  const status = normalizeApprovalStatus(row?.approval_status);
  if (status === 'pending') {
    return { key: 'pending', label: 'Pending Approval', className: 'status-pending' };
  }
  if (status === 'rejected') {
    return { key: 'rejected', label: 'Rejected', className: 'status-cancelled' };
  }
  return { key: 'approved', label: 'Approved', className: 'status-paid' };
}

function renderApprovalPill(row) {
  const status = getApprovalUiStatus(row);
  return `<span class="status-pill ${status.className}">${status.label}</span>`;
}

function updateBillProjectSelect() {
  const select = document.getElementById('f-bill-project');
  if (!select) return;

  const options = projectsDb
    .filter((project) => businessEntityMatches(project))
    .map((project) => {
      const label = [
        project.project_docno || project.source_docno || `Project #${project.id}`,
        project.project_name
      ].map((value) => String(value || '').trim()).filter(Boolean).join(' - ');
      return `<option value="${escHtml(project.id)}">${escHtml(label)}</option>`;
    })
    .join('');

  select.innerHTML = `<option value="">No linked project</option>${options}`;
}

function getPayableUiStatus(bill) {
  const total = Number(bill?.total_amount || 0);
  const paid = Number(bill?.paid_amount || 0);
  const balance = Math.max(0, total - paid);
  const rawStatus = String(bill?.status || '').toLowerCase();

  if (balance <= 0 || rawStatus === 'paid') {
    return { key: 'paid', label: 'Paid', className: 'status-paid' };
  }

  if (paid > 0 || rawStatus === 'partially_paid') {
    return { key: 'partial', label: 'Partial', className: 'status-partial' };
  }

  return { key: 'unpaid', label: 'Unpaid', className: 'status-unpaid' };
}

function renderBills() {
  filterBills();
}

function filterBills() {
  const searchInput = document.getElementById('bills-search');
  const rawSearch = String(searchInput?.value || '');
  const q = rawSearch.toLowerCase().trim();
  if (searchInput) {
    apToolbarState.bills.search = rawSearch;
    saveApUiState();
  }
  const tbody = document.getElementById('bills-tbody');
  let filtered = billsDb.filter(b => businessEntityMatches(b)).filter(b => {
    const vendorName = vendorsDb.find(v => v.id === b.vendor_id)?.vendor_name || '-';
    const projectLabel = getBillProjectLabel(b);
    const haystack = [b.bill_number, vendorName, projectLabel, getPayableUiStatus(b).label, getApprovalUiStatus(b).label, b.status, b.invoice_number, b.due_date].join(' ').toLowerCase();
    return !q || haystack.includes(q);
  });
  tbody.innerHTML = filtered.length ? filtered.map(b => {
    const balance = b.total_amount - (b.paid_amount || 0);
    const isOverdue = new Date(b.due_date) < new Date() && balance > 0;
    const status = getPayableUiStatus(b);
    const approval = getApprovalUiStatus(b);
    const pdfButton = `<button class="btn btn-pdf btn-sm" type="button" onclick="openBillPdfViewer(${b.id})">View PDF</button>`;
    const approveButton = canApproveApRecords() && approval.key === 'pending'
      ? `<button class="btn btn-save btn-sm" type="button" onclick="approveBill(${b.id})">Approve</button>`
      : '';
    return `
      <tr>
        <td style="font-weight:600;color:var(--primary)">${escHtml(b.bill_number)}</td>
        <td>${escHtml(vendorsDb.find(v => v.id === b.vendor_id)?.vendor_name || '-')}</td>
        <td>${escHtml(getBillProjectLabel(b))}${renderArchivedProjectBadge(b)}</td>
        <td>${formatDate(b.bill_date)}</td>
        <td>${formatDate(b.due_date)}</td>
        <td>PHP ${(b.total_amount).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
        <td>PHP ${(b.paid_amount || 0).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
        <td style="color:${balance > 0 ? 'var(--accent)' : 'var(--success)'};font-weight:600">PHP ${balance.toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
        <td>
          <span class="status-pill ${status.className}">${status.label}</span>
          ${isOverdue && status.key !== 'paid' ? '<div style="margin-top:4px;font-size:0.68rem;color:var(--danger);font-weight:600;">Overdue</div>' : ''}
        </td>
        <td>${renderApprovalPill(b)}</td>
        <td style="display:flex; gap:6px; flex-wrap:wrap;">
          ${pdfButton}
          <button class="btn btn-edit btn-sm" type="button" onclick="editBill(${b.id})">Edit</button>
          ${approveButton}
        </td>
      </tr>
    `;
  }).join('') : '<tr class="empty-row"><td colspan="11">No bills found</td></tr>';
}

function toDateInputValue(value) {
  if (!value) return '';
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function setBillModalMode(isEdit) {
  const title = document.querySelector('#bill-modal-backdrop .modal-header h3');
  const saveBtn = document.querySelector('#bill-modal-backdrop .modal-footer .btn-primary');
  if (title) title.textContent = isEdit ? 'Edit Bill' : 'New Bill';
  if (saveBtn) saveBtn.textContent = isEdit ? 'Update Bill' : 'Save Bill';
}

async function loadBillNumberPreview() {
  const input = document.getElementById('f-bill-number');
  if (!input) return '';
  input.value = '';
  try {
    const params = new URLSearchParams();
    const businessEntityId = document.getElementById('f-bill-business-entity')?.value || getDefaultBillBusinessEntityId() || '';
    if (businessEntityId) params.set('business_entity_id', businessEntityId);
    const response = await fetch(`/api/bills/next-number?${params.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to generate bill number.');
    const billNumber = String(data.bill_number || '').trim();
    if (billNumber && !input.value) input.value = billNumber;
    return billNumber;
  } catch (_) {
    input.value = '';
    return '';
  }
}

function openBillModal(id = null) {
  editingBillId = Number(id || 0) || null;
  removeExistingBillPdf = false;
  const bill = editingBillId
    ? billsDb.find((entry) => Number(entry.id || 0) === editingBillId)
    : null;
  if (editingBillId && !bill) {
    editingBillId = null;
    showToast('Bill record not found.', 'error');
    return;
  }
  setBillModalMode(Boolean(bill));
  document.getElementById('f-bill-number').value = '';
  document.getElementById('f-bill-date').valueAsDate = new Date();
  document.getElementById('f-bill-due-date').valueAsDate = new Date(Date.now() + 30*24*60*60*1000);
  document.getElementById('f-bill-vendor').value = '';
  document.getElementById('f-bill-vendor-search').value = '';
  if (document.getElementById('f-bill-po')) document.getElementById('f-bill-po').value = '';
  renderBillBusinessEntityOptions();
  document.getElementById('f-bill-project').value = '';
  document.getElementById('f-bill-amount').value = '';
  document.getElementById('f-bill-notes').value = '';
  removeBillPdf(true, false);
  if (bill) {
    const vendor = vendorsDb.find((entry) => Number(entry.id || 0) === Number(bill.vendor_id || 0));
    document.getElementById('f-bill-number').value = bill.bill_number || '';
    document.getElementById('f-bill-date').value = toDateInputValue(bill.bill_date);
    document.getElementById('f-bill-due-date').value = toDateInputValue(bill.due_date);
    document.getElementById('f-bill-vendor').value = bill.vendor_id || '';
    renderBillBusinessEntityOptions(bill.business_entity_id || '');
    document.getElementById('f-bill-vendor-search').value = vendor?.vendor_name || bill.vendor_name || '';
    if (document.getElementById('f-bill-po')) document.getElementById('f-bill-po').value = bill.po_id || '';
    document.getElementById('f-bill-project').value = bill.project_id || '';
    document.getElementById('f-bill-amount').value = bill.total_amount || '';
    document.getElementById('f-bill-notes').value = bill.notes || '';
    if (bill.pdfFilename) {
      document.getElementById('bill-pdf-name').textContent = bill.pdfFilename;
      document.getElementById('bill-pdf-preview').style.display = 'flex';
      document.getElementById('bill-upload-zone').style.display = 'none';
    }
  } else {
    void loadBillNumberPreview();
  }
  document.getElementById('bill-modal-backdrop').classList.add('open');
  hideBillVendorResults();
  setTimeout(() => document.getElementById('f-bill-vendor-search')?.focus(), 0);
}

function closeBillModal() {
  hideBillVendorResults();
  document.getElementById('bill-modal-backdrop').classList.remove('open');
  editingBillId = null;
  removeExistingBillPdf = false;
  setBillModalMode(false);
}

async function saveBill() {
  const vendorId = resolveBillVendorSelection();
  const billNumber = document.getElementById('f-bill-number').value.trim();
  const totalAmount = parseFloat(document.getElementById('f-bill-amount').value);

  if (!billNumber) {
    showToast('Bill Number is required.', 'error');
    document.getElementById('f-bill-number')?.focus();
    return;
  }
  
  if (!vendorId) {
    showToast('Vendor is required.', 'error');
    document.getElementById('f-bill-vendor-search')?.focus();
    return;
  }

  if (!totalAmount) {
    showToast('Total Amount is required.', 'error');
    return;
  }
  
  const formData = new FormData();
  formData.append('vendor_id', vendorId);
  const businessEntitySelect = document.getElementById('f-bill-business-entity');
  const businessEntityId = businessEntitySelect?.value || getDefaultBillBusinessEntityId() || '';
  if (businessEntitySelect) businessEntitySelect.value = businessEntityId;
  formData.append('business_entity_id', businessEntityId);
  formData.append('bill_number', billNumber);
  formData.append('bill_date', document.getElementById('f-bill-date').value);
  formData.append('due_date', document.getElementById('f-bill-due-date').value);
  formData.append('po_id', document.getElementById('f-bill-po')?.value || '');
  formData.append('project_id', document.getElementById('f-bill-project').value || '');
  formData.append('total_amount', totalAmount);
  formData.append('notes', document.getElementById('f-bill-notes').value.trim());
  if (stagedBillPdf instanceof File) {
    formData.append('pdf_file', stagedBillPdf);
  }
  if (removeExistingBillPdf) {
    formData.append('remove_pdf', '1');
  }

  const isEdit = Boolean(editingBillId);
  try {
    const r = await fetch(isEdit ? `/api/bills/${editingBillId}` : '/api/bills', {
      method: isEdit ? 'PUT' : 'POST',
      body: formData
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(data.error || 'Unable to save bill.');
    }
    closeBillModal();
    await loadBills();
    showToast(isEdit ? 'Bill updated and sent for approval.' : 'Bill submitted for approval.', 'success');
  } catch (e) {
    showToast(e.message || 'Unable to save bill.', 'error');
  }
}

async function approveBill(id) {
  const bill = billsDb.find((entry) => Number(entry.id || 0) === Number(id || 0));
  const confirmed = await openConfirmDialog({
    title: 'Approve AP Bill?',
    message: `Approve ${bill?.bill_number || 'this bill'} so it can be paid?`,
    noText: 'Cancel',
    yesText: 'Approve'
  });
  if (!confirmed) return;

  try {
    const response = await fetch(`/api/bills/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to approve bill.');
    await loadBills();
    showToast('AP bill approved.', 'success');
  } catch (err) {
    showToast(err.message || 'Unable to approve bill.', 'error');
  }
}

function resolveBillVendorSelection() {
  const hiddenInput = document.getElementById('f-bill-vendor');
  const input = document.getElementById('f-bill-vendor-search');
  const selectedId = String(hiddenInput?.value || '').trim();
  if (selectedId) return selectedId;

  const typedValue = String(input?.value || '').trim().toLowerCase();
  if (!typedValue) return '';

  const exactMatch = vendorsDb
    .filter((vendor) => businessEntityMatches(vendor))
    .find((vendor) => String(vendor.vendor_name || '').trim().toLowerCase() === typedValue);
  if (exactMatch) {
    if (hiddenInput) hiddenInput.value = String(exactMatch.id);
    if (input) input.value = exactMatch.vendor_name || '';
    return String(exactMatch.id);
  }

  return '';
}

function editBill(id) {
  openBillModal(id);
}

function handleBillPdfChosen(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.type !== 'application/pdf' && !String(file.name || '').toLowerCase().endsWith('.pdf')) {
    showToast('Please select a PDF file only.', 'error');
    event.target.value = '';
    return;
  }

  stagedBillPdf = file;
  removeExistingBillPdf = false;
  document.getElementById('bill-pdf-name').textContent = file.name;
  document.getElementById('bill-pdf-preview').style.display = 'flex';
  document.getElementById('bill-upload-zone').style.display = 'none';
}

function handleBillPdfDrop(event) {
  event.preventDefault();
  const zone = document.getElementById('bill-upload-zone');
  zone.classList.remove('drag-over');

  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;
  if (file.type !== 'application/pdf' && !String(file.name || '').toLowerCase().endsWith('.pdf')) {
    showToast('Please drop a PDF file only.', 'error');
    return;
  }

  const input = document.getElementById('f-bill-pdf');
  try {
    input.files = event.dataTransfer.files;
  } catch (_) {
    // Some browsers block assigning FileList directly; staging still works.
  }

  handleBillPdfChosen({ target: { files: [file] } });
}

function removeBillPdf(resetInput = true, markExistingRemoval = true) {
  if (editingBillId && markExistingRemoval) {
    removeExistingBillPdf = true;
  }
  stagedBillPdf = null;
  document.getElementById('bill-pdf-preview').style.display = 'none';
  document.getElementById('bill-upload-zone').style.display = 'block';
  document.getElementById('bill-pdf-name').textContent = '';
  if (resetInput) {
    document.getElementById('f-bill-pdf').value = '';
  }
}

function openBillPdfViewer(id) {
  const bill = billsDb.find(b => b.id === id);
  if (!bill) {
    showToast('Bill not found.', 'error');
    return;
  }

  const pdfUrl = `/api/bills/${bill.id}/pdf`;
  const pdfName = bill.pdfFilename || `${bill.bill_number || 'bill'}-summary.pdf`;
  document.getElementById('pdf-viewer-title').textContent = pdfName;
  document.getElementById('pdf-dl-btn').href = pdfUrl;
  document.getElementById('pdf-dl-btn').download = pdfName;
  document.getElementById('pdf-fallback-dl').href = pdfUrl;
  document.getElementById('pdf-fallback-dl').download = pdfName;

  const frame = document.getElementById('pdf-frame');
  const fallback = document.getElementById('pdf-fallback');
  frame.src = pdfUrl;
  frame.style.display = 'block';
  fallback.style.display = 'none';

  document.getElementById('pdf-viewer-backdrop').classList.add('open');
}

function closeBillPdfViewer() {
  document.getElementById('pdf-viewer-backdrop').classList.remove('open');
  document.getElementById('pdf-frame').src = 'about:blank';
}

function updateBillSelects() {
  document.getElementById('f-payment-bill').innerHTML = '<option value="">Select bill to pay</option>' +
    billsDb.filter(b => businessEntityMatches(b) && normalizeApprovalStatus(b.approval_status) === 'approved' && (b.total_amount - (b.paid_amount || 0)) > 0).map(b =>
      `<option value="${b.id}">${escHtml(b.bill_number)} - PHP ${(b.total_amount - (b.paid_amount || 0)).toLocaleString('en-PH', {minimumFractionDigits: 2})}</option>`
    ).join('');
}

function syncPaymentFromBill() {
  const billId = Number(document.getElementById('f-payment-bill')?.value || 0) || 0;
  const bill = billsDb.find((entry) => Number(entry.id || 0) === billId);
  if (!bill) return;

  const amountInput = document.getElementById('f-payment-amount');
  if (amountInput) {
    const balance = Math.max(0, Number(bill.total_amount || 0) - Number(bill.paid_amount || 0));
    amountInput.value = balance ? String(balance.toFixed(2)) : '';
  }
}

function updateMetrics() {
  const visibleBills = getApprovedVisibleBills();
  const visibleVendors = vendorsDb.filter(vendor => businessEntityMatches(vendor));
  const totalPayable = visibleBills.reduce((sum, b) => sum + getBillBalance(b), 0);
  const paidBills = visibleBills.filter((b) => getBillBalance(b) <= 0).length;
  setMetricText('metric-total-payable', formatApMoney(totalPayable));
  setMetricText('metric-vendors-count', visibleVendors.length);
  setMetricText('metric-open-bills', visibleBills.filter(b => getBillBalance(b) > 0).length);
  setMetricText('metric-paid-bills', paidBills);
  
  const overdueBills = visibleBills.filter(b => {
    const balance = getBillBalance(b);
    return balance > 0 && new Date(b.due_date) < new Date();
  });
  const overdueCountEl = document.getElementById('metric-overdue-count');
  if (overdueCountEl) overdueCountEl.textContent = overdueBills.length;
  
  const overdueAmount = overdueBills.reduce((sum, b) => sum + getBillBalance(b), 0);
  setMetricText('metric-overdue-amount', formatApMoney(overdueAmount));
  setMetricText('metric-bills-total-count', visibleBills.length);
  updateVendorBalanceMetrics(visibleBills);
  updateApAgingMetrics(visibleBills);
  updatePaymentMetrics();
  renderVendorBalances();
  renderApAging();
  renderDisbursements();
}

function getBillBalance(bill) {
  return Math.max(0, Number(bill?.total_amount || 0) - Number(bill?.paid_amount || 0));
}

function getBillVendorName(bill) {
  return vendorsDb.find(v => Number(v.id || 0) === Number(bill?.vendor_id || 0))?.vendor_name || 'Unassigned Vendor';
}

function getVisiblePayments() {
  return (Array.isArray(paymentsDb) ? paymentsDb : []).filter((payment) => {
    const bill = billsDb.find((b) => Number(b.id || 0) === Number(payment.ap_id || 0));
    return businessEntityMatches(bill || payment);
  });
}

function getApprovedVisibleBills() {
  return (Array.isArray(billsDb) ? billsDb : [])
    .filter(b => businessEntityMatches(b))
    .filter(b => normalizeApprovalStatus(b.approval_status) === 'approved');
}

function getVendorBalanceRows(visibleBills = getApprovedVisibleBills()) {
  const grouped = new Map();
  visibleBills.forEach((bill) => {
    const vendorId = String(bill.vendor_id || 'unassigned');
    const row = grouped.get(vendorId) || {
      vendor_id: vendorId,
      vendor_name: getBillVendorName(bill),
      bill_count: 0,
      open_bills: 0,
      total_amount: 0,
      paid_amount: 0,
      balance: 0,
      overdue: 0
    };
    const balance = getBillBalance(bill);
    row.bill_count += 1;
    row.open_bills += balance > 0 ? 1 : 0;
    row.total_amount += Number(bill.total_amount || 0);
    row.paid_amount += Number(bill.paid_amount || 0);
    row.balance += balance;
    row.overdue += balance > 0 && new Date(bill.due_date) < new Date() ? balance : 0;
    grouped.set(vendorId, row);
  });
  return Array.from(grouped.values()).sort((a, b) => b.balance - a.balance);
}

function updateVendorBalanceMetrics(visibleBills) {
  const rows = getVendorBalanceRows(visibleBills);
  setMetricText('metric-vb-vendors', rows.length);
  setMetricText('metric-vb-open-vendors', rows.filter(row => row.balance > 0).length);
  setMetricText('metric-vb-total-balance', formatApMoney(rows.reduce((sum, row) => sum + row.balance, 0)));
  setMetricText('metric-vb-overdue-vendors', rows.filter(row => row.overdue > 0).length);
  setMetricText('metric-vb-top-balance', formatApMoney(rows[0]?.balance || 0));
}

function getAgingBuckets(visibleBills = getApprovedVisibleBills()) {
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
  const today = new Date();
  visibleBills.forEach((bill) => {
    const balance = getBillBalance(bill);
    if (balance <= 0) return;
    const dueDate = new Date(bill.due_date);
    if (Number.isNaN(dueDate.getTime()) || dueDate >= today) {
      buckets.current += balance;
      return;
    }
    const days = Math.floor((today - dueDate) / (24 * 60 * 60 * 1000));
    if (days <= 30) buckets.d30 += balance;
    else if (days <= 60) buckets.d60 += balance;
    else if (days <= 90) buckets.d90 += balance;
    else buckets.over90 += balance;
  });
  return buckets;
}

function getBillAgingBucket(bill) {
  const balance = getBillBalance(bill);
  const empty = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
  if (balance <= 0) return empty;
  const dueDate = new Date(bill?.due_date);
  const today = new Date();
  if (Number.isNaN(dueDate.getTime()) || dueDate >= today) {
    empty.current = balance;
    return empty;
  }
  const days = Math.floor((today - dueDate) / (24 * 60 * 60 * 1000));
  if (days <= 30) empty.d30 = balance;
  else if (days <= 60) empty.d60 = balance;
  else if (days <= 90) empty.d90 = balance;
  else empty.over90 = balance;
  return empty;
}

function updateApAgingMetrics(visibleBills) {
  const buckets = getAgingBuckets(visibleBills);
  setMetricText('metric-aging-current', formatApMoney(buckets.current));
  setMetricText('metric-aging-30', formatApMoney(buckets.d30));
  setMetricText('metric-aging-60', formatApMoney(buckets.d60));
  setMetricText('metric-aging-90', formatApMoney(buckets.d90));
  setMetricText('metric-aging-over-90', formatApMoney(buckets.over90));
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PAYMENTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function loadPayments() {
  return fetch('/api/payments?type=ap').then(r => r.json()).then(data => {
    paymentsDb = Array.isArray(data) ? data : [];
    renderPayments();
    updateMetrics();
  }).catch((e) => {
    console.error('Error:', e);
    paymentsDb = [];
    renderPayments();
    updateMetrics();
  });
}

function updatePaymentMetrics() {
  const payments = getVisiblePayments();
  const approvedPayments = payments.filter((payment) => normalizeApprovalStatus(payment.approval_status) === 'approved');
  const totalPaid = approvedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const paidThisMonth = approvedPayments
    .filter((payment) => isInCurrentMonth(payment.payment_date))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const methods = new Set(approvedPayments.map((payment) => String(payment.payment_method || '').trim()).filter(Boolean));

  setMetricText('metric-payment-count', approvedPayments.length);
  setMetricText('metric-payment-total', formatApMoney(totalPaid));
  setMetricText('metric-payment-this-month', formatApMoney(paidThisMonth));
  setMetricText('metric-payment-methods', methods.size);
  setMetricText('metric-payment-linked-bills', new Set(approvedPayments.map(payment => Number(payment.ap_id || 0)).filter(Boolean)).size);
  setMetricText('metric-disbursement-count', approvedPayments.length);
  setMetricText('metric-disbursement-total', formatApMoney(totalPaid));
  setMetricText('metric-disbursement-this-month', formatApMoney(paidThisMonth));
  setMetricText('metric-disbursement-methods', methods.size);
  setMetricText('metric-disbursement-linked-bills', new Set(approvedPayments.map(payment => Number(payment.ap_id || 0)).filter(Boolean)).size);
}

function renderPayments() {
  filterPayments();
}

function filterPayments() {
  const searchInput = document.getElementById('payments-search');
  const rawSearch = String(searchInput?.value || '');
  const q = rawSearch.toLowerCase().trim();
  if (searchInput) {
    apToolbarState.payments.search = rawSearch;
    saveApUiState();
  }
  const tbody = document.getElementById('payments-tbody');
  const filtered = paymentsDb.filter((p) => {
    const bill = billsDb.find((b) => Number(b.id || 0) === Number(p.ap_id || 0));
    if (!businessEntityMatches(bill || p)) return false;
    if (!q) return true;
    const vendorName = vendorsDb.find((v) => v.id === bill?.vendor_id)?.vendor_name || '-';
    const haystack = [
      p.payment_date,
      formatDate(p.payment_date),
      bill?.bill_number,
      vendorName,
      p.amount,
      p.payment_method,
      p.reference_number,
      getApprovalUiStatus(p).label,
      p.notes
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  });
  tbody.innerHTML = filtered.length ? filtered.map(p => {
    const bill = billsDb.find(b => Number(b.id || 0) === Number(p.ap_id || 0));
    const vendor = vendorsDb.find(v => Number(v.id || 0) === Number(bill?.vendor_id || 0));
    const approval = getApprovalUiStatus(p);
    const approveButton = canApproveApRecords() && approval.key === 'pending'
      ? `<button class="btn btn-save btn-sm" type="button" onclick="approvePayment(${p.id})">Approve</button>`
      : '';
    return `
      <tr>
        <td>${formatDate(p.payment_date)}</td>
        <td>${escHtml(bill?.bill_number || '-')}</td>
        <td>${escHtml(vendor?.vendor_name || '-')}</td>
        <td>PHP ${(p.amount).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
        <td>${escHtml(p.payment_method || '-')}</td>
        <td>${escHtml(p.reference_number || '-')}</td>
        <td>${renderApprovalPill(p)}</td>
        <td>${escHtml(p.notes || '-')}</td>
        <td style="display:flex; gap:6px; flex-wrap:wrap;">${approveButton || '<span class="pdf-empty">-</span>'}</td>
      </tr>
    `;
  }).join('') : '<tr class="empty-row"><td colspan="9">No payments found</td></tr>';
}

function renderVendorBalances() {
  const tbody = document.getElementById('vendor-balances-tbody');
  if (!tbody) return;
  const rows = getVendorBalanceRows();
  tbody.innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td>${escHtml(row.vendor_name)}</td>
      <td class="text-right">${row.bill_count}</td>
      <td class="text-right">${row.open_bills}</td>
      <td class="text-right">${formatApMoney(row.total_amount)}</td>
      <td class="text-right">${formatApMoney(row.paid_amount)}</td>
      <td class="text-right">${formatApMoney(row.balance)}</td>
      <td class="text-right">${formatApMoney(row.overdue)}</td>
    </tr>
  `).join('') : '<tr class="empty-row"><td colspan="7">No vendor balances found</td></tr>';
}

function renderApAging() {
  const tbody = document.getElementById('ap-aging-tbody');
  if (!tbody) return;
  const rows = billsDb
    .filter(bill => businessEntityMatches(bill))
    .filter(bill => normalizeApprovalStatus(bill.approval_status) === 'approved')
    .filter(bill => getBillBalance(bill) > 0)
    .map((bill) => ({
      bill,
      aging: getBillAgingBucket(bill),
      balance: getBillBalance(bill)
    }))
    .sort((a, b) => new Date(a.bill.due_date || '9999-12-31') - new Date(b.bill.due_date || '9999-12-31'));

  tbody.innerHTML = rows.length ? rows.map(({ bill, aging, balance }) => `
    <tr>
      <td>${escHtml(getBillVendorName(bill))}</td>
      <td>${escHtml(bill.bill_number || '-')}</td>
      <td>${escHtml(formatDate(bill.due_date))}</td>
      <td class="text-right">${aging.current ? formatApMoney(aging.current) : '-'}</td>
      <td class="text-right">${aging.d30 ? formatApMoney(aging.d30) : '-'}</td>
      <td class="text-right">${aging.d60 ? formatApMoney(aging.d60) : '-'}</td>
      <td class="text-right">${aging.d90 ? formatApMoney(aging.d90) : '-'}</td>
      <td class="text-right">${aging.over90 ? formatApMoney(aging.over90) : '-'}</td>
      <td class="text-right">${formatApMoney(balance)}</td>
    </tr>
  `).join('') : '<tr class="empty-row"><td colspan="9">No open AP aging balances found</td></tr>';
}

function renderDisbursements() {
  const tbody = document.getElementById('disbursements-tbody');
  if (!tbody) return;
  const searchInput = document.getElementById('disbursements-search');
  const rawSearch = String(searchInput?.value || apToolbarState.payments.search || '');
  const q = rawSearch.toLowerCase().trim();
  if (searchInput) {
    apToolbarState.payments.search = rawSearch;
    saveApUiState();
  }
  const rows = getVisiblePayments().filter((p) => normalizeApprovalStatus(p.approval_status) === 'approved').filter((p) => {
    const bill = billsDb.find((b) => Number(b.id || 0) === Number(p.ap_id || 0));
    const vendor = vendorsDb.find(v => Number(v.id || 0) === Number(bill?.vendor_id || 0));
    const haystack = [
      p.payment_date, p.amount, p.payment_method, p.reference_number, p.notes,
      bill?.bill_number, vendor?.vendor_name
    ].join(' ').toLowerCase();
    return !q || haystack.includes(q);
  });
  tbody.innerHTML = rows.length ? rows.map((p) => {
    const bill = billsDb.find(b => Number(b.id || 0) === Number(p.ap_id || 0));
    return `
      <tr>
        <td>${escHtml(formatDate(p.payment_date))}</td>
        <td>${escHtml(bill?.bill_number || '-')}</td>
        <td>${escHtml(getBillVendorName(bill))}</td>
        <td class="text-right">${formatApMoney(p.amount)}</td>
        <td>${escHtml(p.payment_method || '-')}</td>
        <td>${escHtml(p.reference_number || '-')}</td>
        <td>${escHtml(p.notes || '-')}</td>
      </tr>
    `;
  }).join('') : '<tr class="empty-row"><td colspan="7">No disbursements found</td></tr>';
}

function openPaymentModal() {
  document.getElementById('f-payment-date').valueAsDate = new Date();
  document.getElementById('f-payment-bill').value = '';
  document.getElementById('f-payment-amount').value = '';
  document.getElementById('f-payment-method').value = 'cash';
  document.getElementById('f-payment-reference').value = '';
  document.getElementById('f-payment-notes').value = '';
  document.getElementById('payment-modal-backdrop').classList.add('open');
}

function closePaymentModal() {
  document.getElementById('payment-modal-backdrop').classList.remove('open');
}

async function savePayment() {
  const billId = document.getElementById('f-payment-bill').value;
  const amount = parseFloat(document.getElementById('f-payment-amount').value);
  
  if (!billId || !amount) {
    showToast('Bill and payment amount are required.', 'error');
    return;
  }
  
  const payload = {
    payment_type: 'ap',
    ap_id: billId,
    payment_date: document.getElementById('f-payment-date').value,
    amount,
    payment_method: document.getElementById('f-payment-method').value,
    reference_number: document.getElementById('f-payment-reference').value.trim(),
    notes: document.getElementById('f-payment-notes').value.trim()
  };
  
  try {
    const r = await fetch('/api/payments', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(data.error || 'Unable to record payment.');
    }
    closePaymentModal();
    await Promise.all([loadPayments(), loadBills()]);
    showToast('Payment submitted for approval.', 'success');
  } catch (e) {
    showToast(e.message || 'Unable to record payment.', 'error');
  }
}

async function approvePayment(id) {
  const confirmed = await openConfirmDialog({
    title: 'Approve Payment?',
    message: 'Approve this payment and apply it to the bill balance?',
    noText: 'Cancel',
    yesText: 'Approve'
  });
  if (!confirmed) return;

  try {
    const response = await fetch(`/api/payments/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to approve payment.');
    await Promise.all([loadPayments(), loadBills()]);
    showToast('Payment approved and applied.', 'success');
  } catch (err) {
    showToast(err.message || 'Unable to approve payment.', 'error');
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// UTILITIES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-PH', {year: 'numeric', month: 'short', day: 'numeric'});
}

