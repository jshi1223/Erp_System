/**
 * auth-guard.js
 * I-include sa lahat ng protected pages.
 * Pinipigilan ang back button access pagkatapos mag-logout at nililimitahan ang pages per role.
 */

(function () {
  'use strict';

  var BUSINESS_ENTITY_THEME_KEY = 'kinaadman_businessEntityTheme';
  var DEFAULT_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
  var MIN_INACTIVITY_TIMEOUT_MS = 60 * 1000;
  var inactivityTimeoutMs = DEFAULT_INACTIVITY_TIMEOUT_MS;
  var inactivityTimer = null;
  var inactivityLogoutInProgress = false;
  var lastActivityAt = Date.now();
  var lastSessionRefreshAt = 0;
  var sessionRefreshInProgress = false;
  var sessionRefreshIntervalMs = 5 * 60 * 1000;
  var activeBusinessEntityLogoProfile = null;
  var activeBusinessEntityBrandTitle = '';
  var businessEntityLogoObserver = null;
  var tableSearchHighlightObserver = null;
  var tableSearchHighlightQueued = false;
  var tableSortObserver = null;
  var tableSortQueued = false;
  var tableSortApplying = false;
  var tableSortCollator = typeof Intl !== 'undefined' && typeof Intl.Collator === 'function'
    ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    : null;
  var tableSearchSelector = [
    '.module-page-toolbar .search-wrap input[type="text"]',
    '.module-page-toolbar .search-wrap input[type="search"]',
    '.module-page-toolbar .search-wrap-compact input[type="text"]',
    '.module-page-toolbar .search-wrap-compact input[type="search"]',
    '.module-page-toolbar .top-search-bar input[type="text"]',
    '.module-page-toolbar .top-search-bar input[type="search"]',
    '.module-page-toolbar-actions .search-wrap input[type="text"]',
    '.module-page-toolbar-actions .search-wrap input[type="search"]',
    '.module-page-toolbar-actions .search-wrap-compact input[type="text"]',
    '.module-page-toolbar-actions .search-wrap-compact input[type="search"]',
    '.module-page-toolbar-actions .top-search-bar input[type="text"]',
    '.module-page-toolbar-actions .top-search-bar input[type="search"]',
    '.section-topbar .top-search-bar input[type="text"]',
    '.section-topbar .top-search-bar input[type="search"]',
    '.section-head .search-wrap input[type="text"]',
    '.section-head .search-wrap input[type="search"]',
    '.dashboard-filter-bar .search-wrap input[type="text"]',
    '.dashboard-filter-bar .search-wrap input[type="search"]',
    '.company-toolbar-actions .search-wrap input[type="text"]',
    '.company-toolbar-actions .search-wrap input[type="search"]',
    '.reports-company-search-shell .search-wrap input[type="text"]',
    '.reports-company-search-shell .search-wrap input[type="search"]'
  ].join(', ');

  applyStoredBusinessEntityThemeEarly();
  applyCachedAccessRoleEarly();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
  installSharedUiFallbacks();
  watchSharedSidebarMount();
  setupInactivityLogout();
  verifySession();

  function isAdminRoleManagedPage() {
    var normalizedPath = String(location.pathname || '').replace(/\/+$/, '') || '/';
    return Boolean(
      (document.body && document.body.classList && document.body.classList.contains('admin-page')) ||
      normalizedPath === '/admin' ||
      normalizedPath === '/staff'
    );
  }

  function installSharedUiFallbacks() {
    if (typeof window.setSidebarOpen !== 'function') {
      window.setSidebarOpen = function (open) {
        var sidebar = document.getElementById('sidebar');
        var overlay = document.getElementById('sidebar-overlay');
        var isOpen = Boolean(open);
        if (sidebar) sidebar.classList.toggle('open', isOpen);
        if (overlay) overlay.classList.toggle('open', isOpen);
        if (document.body) document.body.classList.toggle('sidebar-open', isOpen);
      };
    }

    if (typeof window.toggleSidebar !== 'function') {
      window.toggleSidebar = function (forceOpen) {
        var sidebar = document.getElementById('sidebar');
        var nextOpen = typeof forceOpen === 'boolean'
          ? forceOpen
          : !(sidebar && sidebar.classList.contains('open'));
        window.setSidebarOpen(nextOpen);
      };
    }

    if (typeof window.syncSidebarGroupStates !== 'function') {
      window.syncSidebarGroupStates = function () {
        document.querySelectorAll('.sidebar-group[data-sidebar-group]').forEach(function (group) {
          var toggle = group.querySelector('.sidebar-group-toggle');
          if (!toggle) return;
          group.classList.add('is-collapsed');
          toggle.setAttribute('aria-expanded', 'false');
        });
      };
    }

    if (typeof window.toggleSidebarGroup !== 'function') {
      window.toggleSidebarGroup = function (trigger) {
        var group = trigger && typeof trigger.closest === 'function' ? trigger.closest('.sidebar-group') : null;
        if (!group) return;
        var key = String(group.getAttribute('data-sidebar-group') || '').trim();
        var nextCollapsed = !group.classList.contains('is-collapsed');
        group.classList.toggle('is-collapsed', nextCollapsed);
        trigger.setAttribute('aria-expanded', String(!nextCollapsed));
        if (key) localStorage.setItem('kinaadman_sidebarGroup_' + key, nextCollapsed ? '1' : '0');
      };
    }

    // Styled logout confirmation that works on every page (some pages do not load
    // erp-core.js, so we cannot rely on its shared confirm dialog). Prefers the
    // shared showConfirm when available, otherwise builds a lightweight modal.
    function confirmLogout(message) {
      if (typeof window.showConfirm === 'function') {
        try {
          return Promise.resolve(window.showConfirm(message, {
            title: 'Logout?',
            confirmLabel: 'Yes, log out',
            cancelLabel: 'Cancel',
            type: 'danger'
          }));
        } catch (e) { /* fall through to the built-in modal */ }
      }
      return new Promise(function (resolve) {
        var existing = document.getElementById('auth-guard-logout-confirm');
        if (existing) existing.remove();
        var overlay = document.createElement('div');
        overlay.id = 'auth-guard-logout-confirm';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(24,30,21,0.55);backdrop-filter:blur(4px);padding:18px;';
        var card = document.createElement('div');
        card.style.cssText = 'width:min(380px,94vw);background:#fff;border:1px solid rgba(72,85,58,0.16);border-radius:18px;box-shadow:0 30px 60px rgba(22,29,18,0.28);padding:24px;font-family:Inter,system-ui,sans-serif;';
        var title = document.createElement('div');
        title.textContent = 'Logout?';
        title.style.cssText = 'font-size:1.15rem;font-weight:800;color:#1f2937;margin-bottom:8px;';
        var msg = document.createElement('p');
        msg.textContent = message || 'Are you sure?';
        msg.style.cssText = 'margin:0 0 20px;color:#4b5563;line-height:1.5;font-size:0.92rem;';
        var actions = document.createElement('div');
        actions.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;';
        var noBtn = document.createElement('button');
        noBtn.type = 'button';
        noBtn.textContent = 'Cancel';
        noBtn.style.cssText = 'padding:9px 16px;border-radius:8px;border:1px solid #d0d7e2;background:#f3f4f6;color:#374151;font-weight:700;cursor:pointer;';
        var yesBtn = document.createElement('button');
        yesBtn.type = 'button';
        yesBtn.textContent = 'Yes, log out';
        yesBtn.style.cssText = 'padding:9px 16px;border-radius:8px;border:1px solid #b42318;background:#b42318;color:#fff;font-weight:700;cursor:pointer;';
        function cleanup(result) {
          document.removeEventListener('keydown', onKey);
          overlay.remove();
          resolve(result);
        }
        function onKey(e) {
          if (e.key === 'Escape') cleanup(false);
          else if (e.key === 'Enter') cleanup(true);
        }
        noBtn.addEventListener('click', function () { cleanup(false); });
        yesBtn.addEventListener('click', function () { cleanup(true); });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) cleanup(false); });
        document.addEventListener('keydown', onKey);
        actions.appendChild(noBtn);
        actions.appendChild(yesBtn);
        card.appendChild(title);
        card.appendChild(msg);
        card.appendChild(actions);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        setTimeout(function () { yesBtn.focus(); }, 0);
      });
    }

    if (typeof window.doLogout !== 'function') {
      window.doLogout = function () {
        confirmLogout('Maglo-logout ka na. Gusto mo bang ituloy?').then(function (confirmed) {
          if (!confirmed) return;
          localStorage.removeItem('kinaadman_activeTab');
          localStorage.removeItem('kinaadman_dashboardPanel');
          localStorage.removeItem('kinaadman_currentUserBadge');
          var headers = {};
          var token = String(window.__CSRF_TOKEN__ || '').trim();
          if (token) headers['X-CSRF-Token'] = token;
          fetch('/logout', {
            method: 'POST',
            credentials: 'same-origin',
            headers: headers
          })
            .then(function () { window.location.href = '/'; })
            .catch(function () { window.location.href = '/'; });
        });
      };
    }
  }

  function normalizeInactivityTimeout(value) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_INACTIVITY_TIMEOUT_MS;
    return Math.max(MIN_INACTIVITY_TIMEOUT_MS, numeric);
  }

  function configureInactivityLogout(timeoutMs) {
    inactivityTimeoutMs = normalizeInactivityTimeout(timeoutMs);
    sessionRefreshIntervalMs = Math.max(
      60 * 1000,
      Math.min(5 * 60 * 1000, Math.floor(inactivityTimeoutMs / 3))
    );
    scheduleInactivityLogout();
  }

  function setupInactivityLogout() {
    configureInactivityLogout(window.KINAADMAN_INACTIVITY_TIMEOUT_MS || DEFAULT_INACTIVITY_TIMEOUT_MS);
    [
      'click',
      'keydown',
      'mousemove',
      'mousedown',
      'pointerdown',
      'scroll',
      'touchstart',
      'input'
    ].forEach(function (eventName) {
      window.addEventListener(eventName, handleUserActivity, { passive: true });
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        handleUserActivity();
      }
    });
  }

  function handleUserActivity() {
    if (inactivityLogoutInProgress) return;
    lastActivityAt = Date.now();
    scheduleInactivityLogout();
    maybeRefreshSession();
  }

  function scheduleInactivityLogout() {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
    var elapsed = Date.now() - lastActivityAt;
    var delay = Math.max(0, inactivityTimeoutMs - elapsed);
    inactivityTimer = setTimeout(function () {
      performInactivityLogout();
    }, delay);
  }

  function maybeRefreshSession(force) {
    var now = Date.now();
    if (sessionRefreshInProgress) return;
    if (!force && now - lastSessionRefreshAt < sessionRefreshIntervalMs) return;
    sessionRefreshInProgress = true;
    fetch('/api/session/refresh', { credentials: 'same-origin' })
      .then(function (res) {
        if (res.status === 401) {
          redirectToLogin();
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (data && data.csrfToken) {
          window.__CSRF_TOKEN__ = data.csrfToken;
        }
        if (data && data.inactivityTimeoutMs) {
          configureInactivityLogout(data.inactivityTimeoutMs);
        }
      })
      .catch(function () {})
      .finally(function () {
        lastSessionRefreshAt = Date.now();
        sessionRefreshInProgress = false;
      });
  }

  function clearSessionUiState() {
    localStorage.removeItem('kinaadman_activeTab');
    localStorage.removeItem('kinaadman_dashboardPanel');
    localStorage.removeItem('kinaadman_currentUserBadge');
  }

  function performInactivityLogout() {
    if (inactivityLogoutInProgress) return;
    inactivityLogoutInProgress = true;
    clearSessionUiState();
    try {
      sessionStorage.setItem('kinaadman_logoutReason', 'inactivity');
    } catch (_) {}

    var headers = {};
    var token = String(window.__CSRF_TOKEN__ || '').trim();
    if (token) headers['X-CSRF-Token'] = token;
    fetch('/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers
    })
      .finally(function () {
        window.location.href = '/';
      });
  }

  function applyCachedAccessRoleEarly() {
    // Role-specific UI must come from /api/me, not localStorage.
  }

  function onReady() {
    applyCachedAccessRoleEarly();
    applyStoredBusinessEntityThemeEarly();
    setupSidebarLinkNavigation();
    if (typeof syncSidebarGroupStates === 'function') {
      syncSidebarGroupStates();
    }
    if (typeof syncSidebarActiveLinks === 'function') {
      syncSidebarActiveLinks();
    }
    setupTableSearchHighlighting();
    setupTableSorting();
    setupTableSlideControls();
  }

  function markSidebarReady() {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    if (
      sidebar.dataset &&
      sidebar.dataset.adminRoleSidebar === '1' &&
      sidebar.dataset.roleNavigationRendered !== '1'
    ) {
      return;
    }
    // Shared-sidebar (module) pages: don't reveal until the role-based nav is
    // actually rendered. The early mount runs before /api/me resolves the role,
    // so the nav is still empty — revealing here would flash an empty sidebar
    // then pop the items in on every refresh.
    if (
      !isAdminRoleManagedPage() &&
      sidebar.dataset &&
      sidebar.dataset.sharedSidebarRendered !== '1'
    ) {
      return;
    }
    if (document.documentElement && document.documentElement.dataset) {
      document.documentElement.dataset.sidebarReady = '1';
    }
  }

  function normalizeFinanceSidebar() {
    var sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.dataset && sidebar.dataset.sharedSidebarRendered === '1') return;
    var nav = document.querySelector('#sidebar .sidebar-nav');
    if (!nav || nav.dataset.financeNormalized === '1') return;

    var oldAp = nav.querySelector('.sidebar-group[data-sidebar-group="accounts-payable"]');
    var oldAr = nav.querySelector('.sidebar-group[data-sidebar-group="accounts-receivable"]');
    var oldProjects = nav.querySelector('.sidebar-group[data-sidebar-group="projects"]');
    var oldCompanyRegistry = nav.querySelector('#menu-company-registry');
    var procurement = nav.querySelector('.sidebar-group[data-sidebar-group="procurement"]');
    if (!oldAp && !oldAr && procurement && nav.querySelector('.sidebar-group[data-sidebar-group="finance"]')) {
      nav.dataset.financeNormalized = '1';
      return;
    }

    function buildLink(href, label, id) {
      return '<a href="' + href + '" class="sidebar-link is-subitem"' + (id ? ' id="' + id + '"' : '') + '>' + label + '</a>';
    }

    function buildGroup(key, label, items) {
      return [
        '<div class="sidebar-group" data-sidebar-group="' + key + '">',
          '<button type="button" class="sidebar-group-toggle" onclick="toggleSidebarGroup(this)" aria-expanded="true">',
            '<span>' + label + '</span>',
            '<span class="sidebar-group-caret" aria-hidden="true">&#9662;</span>',
          '</button>',
          '<div class="sidebar-group-items">',
            items.join(''),
          '</div>',
        '</div>'
      ].join('');
    }

    var masterDataHtml = buildGroup('master-data', 'Master Data', [
      buildLink('/master-data?tab=companies', 'Company Registry', 'menu-company-registry'),
      buildLink('/master-data?tab=vendors', 'Vendors')
    ]);

    var procurementHtml = buildGroup('procurement', 'Procurement Management', [
      buildLink('/procurement?tab=requisitions', 'Purchase Requisitions'),
      buildLink('/procurement?tab=requests', 'Requests'),
      buildLink('/procurement?tab=rfq', 'RFQ'),
      buildLink('/procurement?tab=quotations', 'Quotations & Evaluation'),
      buildLink('/procurement?tab=purchase-orders', 'Purchase Orders'),
      buildLink('/procurement?tab=goods-receipts', 'Goods Receipts')
    ]);

    var salesHtml = buildGroup('sales-management', 'Sales Management', [
      buildLink('/sales-management?tab=sales-request', 'Sales Inquiry', 'menu-sales-management'),
      buildLink('/sales-management?tab=sales-order', 'SO'),
      buildLink('/sales-management?tab=project-delivery', 'Delivery Receipt')
    ]);

    var inventoryHtml = buildGroup('inventory', 'Inventory Management', [
      buildLink('/inventory?tab=products', 'Products', 'menu-inventory'),
      buildLink('/inventory?tab=warehouses', 'Warehouses'),
      buildLink('/inventory?tab=stock', 'Stock Levels'),
      buildLink('/inventory?tab=movements', 'Stock Movements')
    ]);

    var financeHtml = buildGroup('finance', 'Financial Management', [
      buildLink('/accounts-payable?tab=bills', 'AP - Bills', 'menu-accounts-payable'),
      buildLink('/accounts-payable?tab=vendor-balances', 'AP - Vendor Balances'),
      buildLink('/accounts-payable?tab=ap-aging', 'AP Aging'),
      buildLink('/accounts-payable?tab=payments', 'AP Payments'),
      buildLink('/accounts-payable?tab=disbursements', 'Disbursements'),
      buildLink('/accounts-receivable?tab=invoices', 'AR - Invoices', 'menu-accounts-receivable'),
      buildLink('/accounts-receivable?tab=collections', 'AR Collections'),
      buildLink('/accounts-receivable?tab=customer-balances', 'AR Customer Balances'),
      buildLink('/accounts-receivable?tab=ar-aging', 'AR Aging'),
      buildLink('/reports', 'General Ledger / Reports')
    ]);

    var insertAfter = procurement || oldProjects || oldCompanyRegistry || nav.firstElementChild;
    if (!procurement) {
      if (insertAfter && insertAfter.insertAdjacentHTML) {
        insertAfter.insertAdjacentHTML('afterend', masterDataHtml + procurementHtml);
        procurement = nav.querySelector('.sidebar-group[data-sidebar-group="procurement"]');
      } else {
        nav.insertAdjacentHTML('beforeend', masterDataHtml + procurementHtml);
        procurement = nav.querySelector('.sidebar-group[data-sidebar-group="procurement"]');
      }
    } else {
      procurement.outerHTML = procurementHtml;
      procurement = nav.querySelector('.sidebar-group[data-sidebar-group="procurement"]');
    }

    if (oldAp) oldAp.remove();
    if (oldAr) oldAr.remove();
    var oldReports = nav.querySelector('#menu-reports');
    if (oldReports) oldReports.remove();
    if (oldCompanyRegistry) oldCompanyRegistry.remove();
    var existingMasterData = nav.querySelector('.sidebar-group[data-sidebar-group="master-data"]');
    if (existingMasterData) existingMasterData.remove();
    var existingSales = nav.querySelector('.sidebar-group[data-sidebar-group="sales-management"]');
    if (existingSales) existingSales.remove();
    var existingService = nav.querySelector('.sidebar-group[data-sidebar-group="service-operations"]');
    if (existingService) existingService.remove();
    var existingInventory = nav.querySelector('.sidebar-group[data-sidebar-group="inventory"]');
    if (existingInventory) existingInventory.remove();
    var existingFinance = nav.querySelector('.sidebar-group[data-sidebar-group="finance"]');
    if (existingFinance) existingFinance.remove();

    var anchor = procurement || insertAfter;
    if (anchor && anchor.insertAdjacentHTML) {
      anchor.insertAdjacentHTML('afterend', inventoryHtml + financeHtml);
    } else {
      nav.insertAdjacentHTML('beforeend', inventoryHtml + financeHtml);
    }
    var masterAnchor = nav.querySelector('#menu-dashboard') || nav.firstElementChild;
    if (masterAnchor && masterAnchor.insertAdjacentHTML) {
      masterAnchor.insertAdjacentHTML('afterend', masterDataHtml + salesHtml);
    } else {
      nav.insertAdjacentHTML('afterbegin', masterDataHtml + salesHtml);
    }
    nav.dataset.financeNormalized = '1';
  }

  function normalizeSidebarPrimaryOrder() {
    var nav = document.querySelector('#sidebar .sidebar-nav');
    if (!nav || nav.dataset.primaryOrderNormalized === '1') return;

    var dashboard = nav.querySelector('#menu-dashboard, .sidebar-link[href="/admin"], .sidebar-link[href="/admin?view=dashboard"]');
    var masterData = nav.querySelector('.sidebar-group[data-sidebar-group="master-data"]');
    var projects = nav.querySelector('.sidebar-group[data-sidebar-group="projects"]');

    if (dashboard && dashboard.parentElement === nav && nav.firstElementChild !== dashboard) {
      nav.insertBefore(dashboard, nav.firstElementChild);
    }
    if (masterData && projects && masterData.parentElement === nav && projects.parentElement === nav) {
      nav.insertBefore(masterData, projects);
    }

    nav.dataset.primaryOrderNormalized = '1';
  }

  function watchSharedSidebarMount() {
    if (isAdminRoleManagedPage()) return;
    if (document.getElementById('sidebar')) {
      renderSharedSidebar();
      normalizeFinanceSidebar();
      normalizeSidebarPrimaryOrder();
      if (typeof syncSidebarGroupStates === 'function') {
        syncSidebarGroupStates();
      }
      if (typeof syncSidebarActiveLinks === 'function') {
        syncSidebarActiveLinks();
      }
      markSidebarReady();
      return;
    }
    if (typeof MutationObserver !== 'function') return;
    var observer = new MutationObserver(function () {
      if (!document.getElementById('sidebar')) return;
      observer.disconnect();
      renderSharedSidebar();
      normalizeFinanceSidebar();
      normalizeSidebarPrimaryOrder();
      if (typeof syncSidebarGroupStates === 'function') {
        syncSidebarGroupStates();
      }
      if (typeof syncSidebarActiveLinks === 'function') {
        syncSidebarActiveLinks();
      }
      markSidebarReady();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function sanitizeStoredBusinessEntityThemeProfile(profile) {
    if (!profile || !profile.theme) return profile;
    var fallback = getBusinessEntityThemeFallback({ theme: 'kvsk' });
    return Object.assign({}, profile, fallback, {
      company_name: profile.company_name || 'KVSK CCTV & IT Solution'
    });
  }

  function getStoredBusinessEntityThemeProfile() {
    try {
      var urlTheme = new URLSearchParams(window.location.search || '').get('theme');
      urlTheme = String(urlTheme || '').trim().toLowerCase();
      if (urlTheme === 'kitsi' || urlTheme === 'kvsk') {
        var urlProfile = getBusinessEntityThemeFallback({ theme: urlTheme });
        var storedProfile = {
          company_name: 'KVSK CCTV & IT Solution',
          theme: urlProfile.theme,
          logo: urlProfile.logo,
          alt: urlProfile.alt,
          primary: urlProfile.primary,
          primaryLight: urlProfile.primaryLight,
          primaryDark: urlProfile.primaryDark,
          accent: urlProfile.accent,
          accent2: urlProfile.accent2
        };
        sessionStorage.setItem('kinaadman_pendingBusinessEntityTheme', JSON.stringify(storedProfile));
        localStorage.setItem(BUSINESS_ENTITY_THEME_KEY, JSON.stringify(storedProfile));
        return storedProfile;
      }
    } catch (_) {}
    try {
      var raw = localStorage.getItem(BUSINESS_ENTITY_THEME_KEY);
      var stored = raw ? JSON.parse(raw) : null;
      if (stored && stored.theme) {
        stored = sanitizeStoredBusinessEntityThemeProfile(stored);
        localStorage.setItem(BUSINESS_ENTITY_THEME_KEY, JSON.stringify(stored));
        return stored;
      }
    } catch (_) {}
    try {
      var pendingRaw = sessionStorage.getItem('kinaadman_pendingBusinessEntityTheme');
      var pending = pendingRaw ? JSON.parse(pendingRaw) : null;
      if (pending && pending.theme) {
        pending = sanitizeStoredBusinessEntityThemeProfile(pending);
        sessionStorage.setItem('kinaadman_pendingBusinessEntityTheme', JSON.stringify(pending));
        return pending;
      }
    } catch (_) {}
    return null;
  }

  function getBusinessEntityThemeFallback(profile) {
    void profile;
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

  function applyStoredBusinessEntityThemeEarly() {
    var stored = getStoredBusinessEntityThemeProfile();
    var profile = getBusinessEntityThemeFallback({ theme: 'kvsk' });
    var logoProfile = {
      logo: profile.logo,
      alt: profile.alt
    };
    var activeTheme = profile.theme;
    activeBusinessEntityBrandTitle = getBusinessEntityBrandTitle(
      stored || { theme: activeTheme }
    );
    var root = document.documentElement;
    root.style.setProperty('--primary', profile.primary);
    root.style.setProperty('--primary-light', profile.primaryLight);
    root.style.setProperty('--primary-dark', profile.primaryDark);
    root.style.setProperty('--accent', profile.accent);
    root.style.setProperty('--accent2', profile.accent2);
    if (root.dataset) {
      root.dataset.businessEntityTheme = activeTheme;
      root.dataset.businessEntityThemeReady = '1';
    }
    if (document.body) {
      document.body.dataset.businessEntityTheme = activeTheme;
      document.body.dataset.businessEntityThemeReady = '1';
    }
    activeBusinessEntityLogoProfile = logoProfile;
    applyBusinessEntityLogoProfileToDocument();
    applyBusinessEntityBrandTextToDocument();
    watchBusinessEntityLogoNodes();
  }

  function getBusinessEntityBrandTitle(profile) {
    var name = String(profile && profile.company_name ? profile.company_name : '').trim();
    if (name) return name;
    return 'KVSK CCTV & IT Solution';
  }

  function applyBusinessEntityLogoProfileToImage(img) {
    if (!img || !activeBusinessEntityLogoProfile) return;
    img.src = activeBusinessEntityLogoProfile.logo;
    img.alt = activeBusinessEntityLogoProfile.alt;
  }

  function applyBusinessEntityLogoProfileToDocument(root) {
    var scope = root && root.querySelectorAll ? root : document;
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll('.brand-mark, .sidebar-brand-mark, .user-modal-brand-mark').forEach(applyBusinessEntityLogoProfileToImage);
  }

  function applyBusinessEntityBrandTextToDocument(root) {
    var scope = root && root.querySelectorAll ? root : document;
    if (!scope || !scope.querySelectorAll || !activeBusinessEntityBrandTitle) return;
    scope.querySelectorAll('header .brand-copy .header-logo').forEach(function (node) {
      node.textContent = activeBusinessEntityBrandTitle;
    });
    scope.querySelectorAll('#current-workspace-badge').forEach(function (node) {
      node.textContent = 'All Companies';
      node.title = 'Showing records from all business entities';
      node.setAttribute('aria-label', 'Showing all business entities');
    });
    markBusinessEntityBrandTextReady();
  }

  function markBusinessEntityBrandTextReady() {
    if (document.readyState === 'loading') return;
    if (document.documentElement && document.documentElement.dataset) {
      document.documentElement.dataset.businessEntityBrandTextReady = '1';
    }
  }

  function watchBusinessEntityLogoNodes() {
    if (businessEntityLogoObserver || typeof MutationObserver !== 'function') return;
    businessEntityLogoObserver = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        Array.prototype.forEach.call(mutation.addedNodes || [], function (node) {
          if (!node || node.nodeType !== 1) return;
          if (node.matches && node.matches('.brand-mark, .sidebar-brand-mark, .user-modal-brand-mark')) {
            applyBusinessEntityLogoProfileToImage(node);
          }
          applyBusinessEntityLogoProfileToDocument(node);
          applyBusinessEntityBrandTextToDocument(node);
        });
      });
    });
    businessEntityLogoObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function setupTableSearchHighlighting() {
    syncTableSearchHighlighting();

    document.addEventListener('focusin', handleTableSearchInputEvent, true);
    document.addEventListener('focusout', handleTableSearchInputEvent, true);
    document.addEventListener('input', handleTableSearchInputEvent, true);

    if (!tableSearchHighlightObserver && window.MutationObserver) {
      tableSearchHighlightObserver = new MutationObserver(function () {
        scheduleTableSearchHighlightSync();
      });
      tableSearchHighlightObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }
  }

  function setupTableSorting() {
    syncTableSorting();

    if (!tableSortObserver && window.MutationObserver) {
      tableSortObserver = new MutationObserver(function () {
        if (tableSortApplying) return;
        scheduleTableSortSync();
      });
      tableSortObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }
  }

  function scheduleTableSortSync() {
    if (tableSortQueued) return;
    tableSortQueued = true;
    window.requestAnimationFrame(function () {
      tableSortQueued = false;
      syncTableSorting();
    });
  }

  function syncTableSorting(root) {
    if (tableSortApplying) return;
    var scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    var tables = scope.querySelectorAll('table');
    for (var i = 0; i < tables.length; i += 1) {
      enhanceSortableTable(tables[i]);
    }
  }

  function enhanceSortableTable(table) {
    if (!table || table.dataset.tableSortDisabled === '1') return;
    if (table.closest('.search-results-list')) return;
    if (!table.tHead || !table.tBodies || !table.tBodies.length) return;
    if (table.querySelector('#vendor-sort-btn')) return;

    var headerRow = table.tHead.rows && table.tHead.rows[0];
    if (!headerRow || !headerRow.cells || !headerRow.cells.length) return;

    var state = getTableSortState(table);
    var headerCell = state.columnIndex >= 0 ? headerRow.cells[state.columnIndex] : null;
    if (!headerCell || !isSortableHeaderCell(headerCell)) {
      headerCell = findDefaultSortableHeaderCell(headerRow);
      if (!headerCell) return;
    }

    ensureTableSortButton(table, headerCell);

    if (state.columnIndex >= 0) {
      applyTableSort(table, state.columnIndex, state.order, true);
    }
  }

  function findDefaultSortableHeaderCell(headerRow) {
    if (!headerRow || !headerRow.cells) return null;
    for (var i = 0; i < headerRow.cells.length; i += 1) {
      if (isSortableHeaderCell(headerRow.cells[i])) {
        return headerRow.cells[i];
      }
    }
    return null;
  }

  function isSortableHeaderCell(cell) {
    if (!cell) return false;
    if (String(cell.dataset && cell.dataset.sortIgnore || '') === '1') return false;
    if (cell.colSpan && Number(cell.colSpan) > 1) return false;
    var text = String(cell.textContent || '').trim().toLowerCase();
    if (!text || text === 'actions') return false;
    if (cell.querySelector('button, a, input, select, textarea')) return false;
    return true;
  }

  function getTableSortState(table) {
    var columnIndex = Number(table && table.dataset ? table.dataset.sortColumn : -1);
    var order = String(table && table.dataset ? table.dataset.sortOrder : '').toLowerCase() === 'desc' ? 'desc' : 'asc';
    return {
      columnIndex: Number.isFinite(columnIndex) ? columnIndex : -1,
      order: order
    };
  }

  function ensureTableSortButton(table, headerCell) {
    if (!table || !headerCell) return;

    var existingButton = headerCell.querySelector('.table-sort-trigger');
    if (!existingButton) {
      existingButton = document.createElement('button');
      existingButton.type = 'button';
      existingButton.className = 'table-sort-trigger';
      existingButton.textContent = '\u2191';
      existingButton.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        var nextOrder = getTableSortState(table).columnIndex === headerCell.cellIndex && getTableSortState(table).order === 'asc'
          ? 'desc'
          : 'asc';
        applyTableSort(table, headerCell.cellIndex, nextOrder, false);
      });
      headerCell.appendChild(existingButton);
    }

    headerCell.classList.add('table-sort-header');
    var isActiveSort = String(table.dataset.sortColumn || '') === String(headerCell.cellIndex);
    var isDesc = isActiveSort && String(table.dataset.sortOrder || '') === 'desc';
    headerCell.setAttribute('aria-sort', isActiveSort ? (isDesc ? 'descending' : 'ascending') : 'none');
    updateTableSortButtonLabel(existingButton, isDesc ? 'desc' : 'asc');
  }

  function updateTableSortButtonLabel(button, order) {
    if (!button) return;
    var isDesc = String(order || '').toLowerCase() === 'desc';
    button.textContent = isDesc ? '\u2193' : '\u2191';
    button.setAttribute('title', isDesc ? 'Sort descending' : 'Sort ascending');
    button.setAttribute('aria-label', isDesc ? 'Sort descending' : 'Sort ascending');
  }

  function applyTableSort(table, columnIndex, order, fromSync) {
    if (!table || !table.tBodies || !table.tBodies.length) return;
    var tbody = table.tBodies[0];
    if (!tbody) return;

    var rows = Array.prototype.slice.call(tbody.rows || []).filter(function (row) {
      return row && !row.classList.contains('empty-row');
    });
    if (!rows.length) return;

    var numericOrder = String(order || 'asc').toLowerCase() === 'desc' ? -1 : 1;
    table.dataset.sortColumn = String(columnIndex);
    table.dataset.sortOrder = numericOrder < 0 ? 'desc' : 'asc';
    tableSortApplying = true;

    var headerRow = table.tHead && table.tHead.rows ? table.tHead.rows[0] : null;
    var headerCell = headerRow && headerRow.cells && headerRow.cells[columnIndex] ? headerRow.cells[columnIndex] : null;
    var sortKind = getTableSortKind(headerCell);

    rows.sort(function (rowA, rowB) {
      var valueA = getTableSortValue(rowA.cells[columnIndex], sortKind);
      var valueB = getTableSortValue(rowB.cells[columnIndex], sortKind);
      if (valueA == null && valueB == null) return 0;
      if (valueA == null) return numericOrder;
      if (valueB == null) return -numericOrder;
      if (sortKind === 'number' || sortKind === 'date') {
        if (valueA === valueB) return 0;
        return (valueA > valueB ? 1 : -1) * numericOrder;
      }
      var compare = compareTableStrings(String(valueA), String(valueB));
      return compare * numericOrder;
    });

    rows.forEach(function (row) {
      tbody.appendChild(row);
    });

    if (headerRow && headerRow.cells && headerRow.cells.length) {
      for (var i = 0; i < headerRow.cells.length; i += 1) {
        var cell = headerRow.cells[i];
        if (!cell) continue;
        cell.setAttribute('aria-sort', i === columnIndex ? (numericOrder < 0 ? 'descending' : 'ascending') : 'none');
        var button = cell.querySelector('.table-sort-trigger');
        if (button) {
          updateTableSortButtonLabel(button, i === columnIndex && numericOrder < 0 ? 'desc' : 'asc');
        }
      }
    }

    window.requestAnimationFrame(function () {
      tableSortApplying = false;
      if (!fromSync) {
        scheduleTableSortSync();
      }
    });
  }

  function getTableSortKind(headerCell) {
    var text = String(headerCell && headerCell.textContent ? headerCell.textContent : '').trim().toLowerCase();
    if (/(date|time|login|timestamp|created|updated|due|received)/.test(text)) {
      return 'date';
    }
    if (/(amount|balance|budget|qty|quantity|price|cost|total|paid|overdue|value|rate|hours|days|count)/.test(text)) {
      return 'number';
    }
    return 'text';
  }

  function getTableSortValue(cell, sortKind) {
    if (!cell) return null;
    var raw = String(cell.dataset && cell.dataset.sortValue ? cell.dataset.sortValue : cell.textContent || '').replace(/\s+/g, ' ').trim();
    if (!raw || raw === '-' || raw === '—' || raw === 'N/A') return null;
    if (sortKind === 'number') {
      var normalized = raw.replace(/[^0-9.-]+/g, '');
      if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') return null;
      var numberValue = Number(normalized);
      return Number.isFinite(numberValue) ? numberValue : null;
    }
    if (sortKind === 'date') {
      var dateValue = Date.parse(raw);
      return Number.isFinite(dateValue) ? dateValue : null;
    }
    return raw;
  }

  function compareTableStrings(a, b) {
    if (tableSortCollator) {
      return tableSortCollator.compare(a, b);
    }
    return a.localeCompare(b);
  }

  function handleTableSearchInputEvent(event) {
    var target = event && event.target;
    if (!isTableSearchInput(target)) return;
    syncTableSearchInput(target);
  }

  function isTableSearchInput(element) {
    return !!element && typeof element.matches === 'function' && element.matches(tableSearchSelector);
  }

  function syncTableSearchInput(input) {
    if (!isTableSearchInput(input)) return;
    var hasText = String(input.value || '').trim().length > 0;
    var isFocused = document.activeElement === input;
    input.classList.toggle('is-table-search-active', hasText || isFocused);
  }

  function syncTableSearchHighlighting(root) {
    var scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    var inputs = scope.querySelectorAll(tableSearchSelector);
    for (var i = 0; i < inputs.length; i += 1) {
      syncTableSearchInput(inputs[i]);
    }
  }

  function scheduleTableSearchHighlightSync() {
    if (tableSearchHighlightQueued) return;
    tableSearchHighlightQueued = true;
    window.requestAnimationFrame(function () {
      tableSearchHighlightQueued = false;
      syncTableSearchHighlighting();
    });
  }

  function verifySession() {
    fetch('/api/me', { credentials: 'same-origin' })
      .then(function (res) {
        if (res.status === 401) {
          redirectToLogin();
          return Promise.reject();
        }
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.loggedIn) {
          redirectToLogin();
          return;
        }
        if (data.csrfToken) {
          window.__CSRF_TOKEN__ = data.csrfToken;
        }
        if (data.inactivityTimeoutMs) {
          configureInactivityLogout(data.inactivityTimeoutMs);
        }
        lastSessionRefreshAt = Date.now();
        try {
          localStorage.setItem('kinaadman_currentUserBadge', JSON.stringify({
            id: data.id || '',
            fullname: data.fullname || '',
            username: data.username || '',
            email: data.email || '',
            role: data.role || 'user'
          }));
        } catch (_) {}

        applyRoleBasedSidebar(data);
        if (typeof syncSidebarActiveLinks === 'function') {
          syncSidebarActiveLinks();
        }

        var path = String(location.pathname || '').toLowerCase();
        var role = String(data.role || 'user').toLowerCase();
        var accessMatrix = [
          { prefixes: ['/business-entities'], roles: ['super_admin'] },
          { prefixes: ['/user-management'], roles: ['super_admin', 'admin'] },
          { prefixes: ['/master-data'], roles: ['super_admin', 'admin', 'staff'] },
          { prefixes: ['/admin'], roles: ['super_admin', 'admin'] },
          { prefixes: ['/staff'], roles: ['staff'] },
          { prefixes: ['/erp'], roles: ['super_admin', 'admin', 'staff'] },
          { prefixes: ['/accounts-payable'], roles: ['super_admin', 'admin', 'staff'] },
          { prefixes: ['/accounts-receivable'], roles: ['super_admin', 'admin', 'staff'] },
          { prefixes: ['/sales-management'], roles: ['super_admin', 'admin', 'staff'] },
          { prefixes: ['/inventory'], roles: ['super_admin', 'admin', 'staff'] },
          { prefixes: ['/reports'], roles: ['super_admin', 'admin'] },
          { prefixes: ['/gantt-chart'], roles: ['super_admin', 'admin'] },
          { prefixes: ['/status'], roles: ['super_admin', 'admin', 'staff', 'user'] }
        ];

        var matchedRule = accessMatrix.find(function (rule) {
          return rule.prefixes.some(function (prefix) {
            return path.startsWith(prefix);
          });
        });

        if (matchedRule && matchedRule.roles.indexOf(role) === -1) {
          redirectToStatus();
          return;
        }

        if (role === 'staff' && staffShouldLeaveCurrentRoute()) {
          redirectStaffToOperationalTab();
        }
      })
      .catch(function () {
        redirectToLogin();
      });
  }

  function redirectToLogin() {
    location.replace('/');
  }

  function redirectToStatus() {
    location.replace('/status');
  }

  function staffShouldLeaveCurrentRoute() {
    var path = String(location.pathname || '').toLowerCase();
    var tab = new URLSearchParams(location.search || '').get('tab') || '';
    tab = String(tab).toLowerCase();
    if (path === '/accounts-payable') {
      return true;
    }
    if (path === '/accounts-receivable') {
      return true;
    }
    if (path === '/sales-management') {
      return ['customer-balances', 'ar-aging', 'documents'].indexOf(tab) !== -1;
    }
    if (path === '/procurement') {
      return ['rfq', 'quotations', 'bid-evaluation', 'purchase-orders', 'goods-receipts'].indexOf(tab) !== -1;
    }
    return false;
  }

  function redirectStaffToOperationalTab() {
    var path = String(location.pathname || '').toLowerCase();
    if (path === '/accounts-payable') {
      location.replace('/procurement?tab=requests');
      return;
    }
    if (path === '/accounts-receivable') {
      location.replace('/sales-management');
      return;
    }
    if (path === '/sales-management') {
      location.replace('/sales-management');
      return;
    }
    if (path === '/procurement') {
      location.replace('/procurement?tab=requests');
    }
  }

  function renderSharedSidebar(roleValue) {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    if (sidebar.dataset && sidebar.dataset.adminRoleSidebar === '1') return;
    if (sidebar.dataset && sidebar.dataset.sharedSidebarRendered === '1') return;

    var currentUrl = new URL(window.location.href);
    var currentPath = currentUrl.pathname.replace(/\/+$/, '') || '/';
    var currentSearch = currentUrl.search || '';
    var currentRole = String(
      roleValue ||
      (document.body && document.body.dataset ? document.body.dataset.accessRole : '') ||
      (document.documentElement && document.documentElement.dataset ? document.documentElement.dataset.accessRole : '')
    ).trim().toLowerCase();
    if (['super_admin', 'admin', 'staff'].indexOf(currentRole) === -1) return;
    var roleSidebarConfigs = {
      staff: {
        dashboardHref: '/staff',
        dashboardAliases: ['/staff?view=dashboard'],
        groups: [
          {
            key: 'projects',
            label: 'Projects',
            items: [
              { href: '/staff?panel=project-records', label: 'Approved Projects', id: 'menu-projects', aliases: ['/staff?view=project-records'] }
            ]
          },
          {
            key: 'master-data',
            label: 'Master Data',
            items: [
              { href: '/master-data?tab=companies', label: 'Company Registry', id: 'menu-company-registry' },
              { href: '/master-data?tab=vendors', label: 'Vendors', aliases: ['/accounts-payable?tab=vendors'] },
              { href: '/master-data?tab=requests', label: 'Requests' }
            ]
          },
          {
            key: 'sales-management',
            label: 'Sales Management',
            items: [
              { href: '/sales-management?tab=sales-request', label: 'Sales Inquiry', id: 'menu-sales-management', aliases: ['/sales-management'] },
              { href: '/sales-management?tab=requests', label: 'Requests' }
            ]
          },
          {
            key: 'procurement',
            label: 'Procurement',
            items: [
              { href: '/procurement?tab=requisitions', label: 'Purchase Requisitions' },
              { href: '/procurement?tab=requests', label: 'Requests' }
            ]
          },
          {
            key: 'inventory',
            label: 'Inventory',
            items: [
              { href: '/inventory?tab=products', label: 'Products', id: 'menu-inventory', aliases: ['/inventory'] },
              { href: '/inventory?tab=warehouses', label: 'Warehouses' },
              { href: '/inventory?tab=stock', label: 'Stock Levels' },
              { href: '/inventory?tab=movements', label: 'Stock Movements' }
            ]
          }
        ]
      },
      admin: {
        dashboardHref: '/admin',
        dashboardAliases: ['/admin?view=dashboard'],
        groups: [
          {
            key: 'master-data',
            label: 'Master Data',
            items: [
              { href: '/master-data?tab=companies', label: 'Company Registry', id: 'menu-company-registry' },
              { href: '/master-data?tab=vendors', label: 'Vendors', aliases: ['/accounts-payable?tab=vendors'] }
            ]
          },
          {
            key: 'projects',
            label: 'Projects',
            items: [
              { href: '/admin?panel=project-records', label: 'Project Records', id: 'menu-projects', aliases: ['/admin?view=project-records'] },
              { href: '/admin?panel=project-records&tab=ledger', label: 'Project Overview', id: 'menu-project-ledger', aliases: ['/admin?panel=project-ledger'] },
              { href: '/gantt-chart', label: 'Gantt Chart', id: 'menu-gantt-chart' }
            ]
          },
          {
            key: 'sales-management',
            label: 'Sales Management',
            items: [
              { href: '/sales-management?tab=sales-request', label: 'Sales Inquiry', id: 'menu-sales-management', aliases: ['/sales-management'] },
              { href: '/sales-management?tab=sales-order', label: 'SO' },
              { href: '/sales-management?tab=project-delivery', label: 'Delivery Receipt' }
            ]
          },
          {
            key: 'procurement',
            label: 'Procurement',
            items: [
              { href: '/procurement?tab=requisitions', label: 'Purchase Requisitions', aliases: ['/procurement', '/accounts-payable?tab=requisitions'] },
              { href: '/procurement?tab=rfq', label: 'RFQ' },
              { href: '/procurement?tab=quotations', label: 'Quotations & Evaluation', aliases: ['/procurement?tab=bid-evaluation', '/accounts-payable?tab=quotations', '/accounts-payable?tab=bid-evaluation'] },
              { href: '/procurement?tab=purchase-orders', label: 'Purchase Orders', aliases: ['/accounts-payable?tab=purchase-orders'] },
              { href: '/procurement?tab=goods-receipts', label: 'Goods Receipts', aliases: ['/accounts-payable?tab=goods-receipts'] }
            ]
          },
          {
            key: 'inventory',
            label: 'Inventory',
            items: [
              { href: '/inventory?tab=products', label: 'Products', id: 'menu-inventory', aliases: ['/inventory'] },
              { href: '/inventory?tab=warehouses', label: 'Warehouses' },
              { href: '/inventory?tab=stock', label: 'Stock Levels' },
              { href: '/inventory?tab=movements', label: 'Stock Movements' }
            ]
          },
          {
            key: 'finance',
            label: 'Financial Management',
            items: [
              { href: '/accounts-payable?tab=bills', label: 'Bills', aliases: ['/accounts-payable'] },
              { href: '/accounts-payable?tab=vendor-balances', label: 'Vendor Balances' },
              { href: '/accounts-payable?tab=ap-aging', label: 'AP Aging' },
              { href: '/accounts-payable?tab=payments', label: 'AP Payments' },
              { href: '/accounts-payable?tab=disbursements', label: 'Disbursements' },
              { href: '/accounts-receivable?tab=invoices', label: 'AR Invoices', aliases: ['/accounts-receivable?tab=receivables'] },
              { href: '/accounts-receivable?tab=collections', label: 'AR Collections', aliases: ['/accounts-receivable?tab=payments'] },
              { href: '/accounts-receivable?tab=customer-balances', label: 'AR Customer Balances' },
              { href: '/accounts-receivable?tab=ar-aging', label: 'AR Aging' },
              { href: '/reports', label: 'General Ledger / Reports' }
            ]
          },
          {
            key: 'admin',
            label: 'Admin',
            collapsed: true,
            items: [
              { href: '/user-management', label: 'User Management', id: 'menu-users' },
              { href: '/admin?panel=approval-center', label: 'Approval Center', id: 'menu-approval-center' },
              { href: '/admin?panel=archive-center', label: 'Archive Center', id: 'menu-archive-center', aliases: ['/admin?view=archive-center', '/admin?view=archived', '/admin?panel=archived'] }
            ]
          }
        ]
      }
    };
    roleSidebarConfigs.super_admin = {
      dashboardHref: '/admin',
      dashboardAliases: ['/admin?view=dashboard'],
      groups: roleSidebarConfigs.admin.groups.map(function (entry) {
        if (entry.key !== 'admin') return entry;
        return {
          key: 'super-admin',
          label: 'Super Admin',
          collapsed: true,
          items: [
            { href: '/user-management', label: 'User Management', id: 'menu-users' },
            { href: '/business-entities', label: 'Business Entities', id: 'menu-business-entities' },
            { href: '/admin?panel=approval-center', label: 'Approval Center', id: 'menu-approval-center' },
            { href: '/admin?panel=archive-center', label: 'Archive Center', id: 'menu-archive-center', aliases: ['/admin?view=archive-center', '/admin?view=archived', '/admin?panel=archived'] },
            { href: '/admin?view=logs', label: 'System Logs', id: 'menu-logs', aliases: ['/admin?panel=logs'] }
          ]
        };
      })
    };
    var sidebarConfig = roleSidebarConfigs[currentRole];
    if (!sidebarConfig) return;

    function escapeAttr(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function sameRoute(href, aliases) {
      var candidates = [href].concat(Array.isArray(aliases) ? aliases : []);
      return candidates.some(function (candidate) {
        try {
          var currentComparable = new URL(window.location.href);
          currentComparable.searchParams.delete('theme');
          var url = new URL(candidate, window.location.origin);
          url.searchParams.delete('theme');
          var path = url.pathname.replace(/\/+$/, '') || '/';
          var search = url.search || '';
          var comparablePath = currentComparable.pathname.replace(/\/+$/, '') || '/';
          var comparableSearch = currentComparable.search || '';
          return path === comparablePath && search === comparableSearch;
        } catch (_) {
          return false;
        }
      });
    }

    function link(href, label, options) {
      var opts = options || {};
      var classes = ['sidebar-link'];
      if (opts.subitem) classes.push('is-subitem');
      if (sameRoute(href, opts.aliases)) classes.push('active');
      var attrs = ['href="' + escapeAttr(href) + '"', 'class="' + classes.join(' ') + '"'];
      if (opts.id) attrs.push('id="' + escapeAttr(opts.id) + '"');
      return '<a ' + attrs.join(' ') + '>' + label + '</a>';
    }

    function linkFromItem(item) {
      return link(item.href, item.label, {
        id: item.id,
        aliases: item.aliases,
        subitem: true
      });
    }

    function group(key, label, collapsed, items) {
      var isCollapsed = !!collapsed;
      return [
        '<div class="sidebar-group' + (isCollapsed ? ' is-collapsed' : '') + '" data-sidebar-group="' + escapeAttr(key) + '"' + (isCollapsed ? ' data-sidebar-default-collapsed="1"' : '') + '>',
          '<button type="button" class="sidebar-group-toggle" onclick="toggleSidebarGroup(this)" aria-expanded="' + (isCollapsed ? 'false' : 'true') + '">',
            '<span>' + label + '</span>',
            '<span class="sidebar-group-caret" aria-hidden="true">▾</span>',
          '</button>',
          '<div class="sidebar-group-items">',
            items.join(''),
          '</div>',
        '</div>'
      ].join('');
    }

    var storedProfile = getStoredBusinessEntityThemeProfile();
    var explicitProfile = {
      theme: document.documentElement && document.documentElement.dataset
        ? document.documentElement.dataset.businessEntityTheme
        : ''
    };
    var sidebarProfile = getBusinessEntityThemeFallback(storedProfile || explicitProfile);
    var sidebarTitle = 'KVSK CCTV';
    var sidebarSub = 'Operations Control Panel';

    sidebar.innerHTML = [
      '<div class="sidebar-header">',
        '<a class="sidebar-brand" href="' + sidebarConfig.dashboardHref + '" onclick="if (typeof openSidebarDashboard === &quot;function&quot;) { openSidebarDashboard(this); return false; }">',
          '<img class="sidebar-brand-mark" src="' + escapeAttr(storedProfile && storedProfile.logo ? storedProfile.logo : sidebarProfile.logo) + '" alt="' + escapeAttr(storedProfile && storedProfile.alt ? storedProfile.alt : sidebarProfile.alt) + '" />',
          '<div>',
            '<div class="header-logo" style="font-size: 1rem;">' + escapeAttr(sidebarTitle) + '</div>',
            '<div class="header-sub">' + escapeAttr(sidebarSub) + '</div>',
          '</div>',
        '</a>',
        '<button class="modal-close" style="position:static; padding: 5px;" onclick="toggleSidebar()" aria-label="Close menu">×</button>',
      '</div>',
      '<nav class="sidebar-nav">',
        link(sidebarConfig.dashboardHref, 'Dashboard', {
          id: 'menu-dashboard',
          aliases: sidebarConfig.dashboardAliases
        }),
        sidebarConfig.groups.map(function (entry) {
          return group(entry.key, entry.label, entry.collapsed, entry.items.map(linkFromItem));
        }).join(''),
      '</nav>'
    ].join('');

    sidebar.dataset.sharedSidebarRendered = '1';
    sidebar.dataset.sharedSidebarRole = currentRole;
  }

  function hasCompleteSharedSidebar(sidebar) {
    var nav = sidebar && sidebar.querySelector ? sidebar.querySelector('.sidebar-nav') : null;
    if (!nav) return false;
    var role = String(
      (document.body && document.body.dataset ? document.body.dataset.accessRole : '') ||
      (document.documentElement && document.documentElement.dataset ? document.documentElement.dataset.accessRole : '') ||
      ''
    ).trim().toLowerCase();
    var requiredGroupsByRole = {
      staff: ['projects', 'master-data', 'sales-management', 'procurement', 'inventory'],
      admin: ['master-data', 'projects', 'sales-management', 'procurement', 'inventory', 'finance', 'admin'],
      super_admin: ['master-data', 'projects', 'sales-management', 'procurement', 'inventory', 'finance', 'super-admin']
    };
    var requiredGroups = requiredGroupsByRole[role] || [];
    var hasGroups = requiredGroups.every(function (key) {
      return Boolean(nav.querySelector('.sidebar-group[data-sidebar-group="' + key + '"]'));
    });
    var dashboard = nav.querySelector('#menu-dashboard, .sidebar-link[href="/staff"], .sidebar-link[href="/admin"], .sidebar-link[href="/admin?view=dashboard"]');
    return hasGroups && Boolean(dashboard);
  }

  function applyRoleBasedSidebar(data) {
    var role = String(data && data.role ? data.role : 'user').toLowerCase();
    var isAdmin = role === 'super_admin' || role === 'admin';
    var isStaff = role === 'staff';
    if (document.body) {
      document.body.setAttribute('data-access-role', role);
      document.body.classList.toggle('is-staff-role', isStaff);
      document.body.classList.toggle('is-admin-role', isAdmin);
    }
    if (document.documentElement && document.documentElement.dataset) {
      document.documentElement.dataset.accessRole = role;
    }
    try {
      window.dispatchEvent(new CustomEvent('kinaadman:role-ready', { detail: { role: role, user: data } }));
    } catch (_) {}

    if (isAdminRoleManagedPage()) return;

    var sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.dataset) {
      var renderedRole = String(sidebar.dataset.sharedSidebarRole || '').trim().toLowerCase();
      if (renderedRole !== role || !hasCompleteSharedSidebar(sidebar)) {
        delete sidebar.dataset.sharedSidebarRendered;
        renderSharedSidebar(role);
      }
      normalizeFinanceSidebar();
      normalizeSidebarPrimaryOrder();
      markSidebarReady();
    }

    setupSidebarLinkNavigation();

    var adminOnlyHrefs = [
      '/user-management',
      '/admin?panel=archive-center',
      '/admin?view=logs',
      '/admin?view=archived'
    ];
    var superOnlyHrefs = [
      '/business-entities'
    ];
    var staffHiddenHrefs = [
      '/reports',
      '/gantt-chart',
      '/accounts-payable',
      '/accounts-receivable',
      '/accounts-payable?tab=vendor-balances',
      '/accounts-payable?tab=ap-aging',
      '/accounts-payable?tab=payments',
      '/accounts-payable?tab=disbursements',
      '/accounts-receivable?tab=customer-balances',
      '/accounts-receivable?tab=ar-aging',
      '/procurement?tab=rfq',
      '/procurement?tab=quotations',
      '/procurement?tab=purchase-orders',
      '/procurement?tab=goods-receipts'
    ];
    var adminOnlySelectors = [
      '.sidebar-group[data-sidebar-group="admin"]',
      '#menu-users',
      '#menu-archive-center',
      '#menu-logs',
      '#menu-archived'
    ];
    var superOnlySelectors = [
      '#menu-business-entities',
      '[data-requires-role="super_admin"]'
    ];
    var staffHiddenSelectors = [
      '#menu-reports',
      '#menu-gantt-chart',
      '.sidebar-group[data-sidebar-group="finance"]',
      '#stat-card-reports',
      '#stat-card-ap',
      '#stat-card-ar',
      '[data-tab="payments"]',
      '[data-workspace-tab="vendor-balances"]',
      '[data-workspace-tab="ap-aging"]',
      '[data-workspace-tab="disbursements"]',
      '[data-workspace-tab="customer-balances"]',
      '[data-tab="vendor-balances"]',
      '[data-tab="ap-aging"]',
      '[data-tab="disbursements"]',
      '[data-tab="customer-balances"]',
      '[data-tab="ar-aging"]',
      '[data-tab="documents"]',
      '[data-proc-tab="rfq"]',
      '[data-proc-tab="quotations"]',
      '[data-proc-tab="purchase-orders"]',
      '[data-proc-tab="goods-receipts"]',
      '[data-workspace-tab="rfq"]',
      '[data-workspace-tab="quotations"]',
      '[data-workspace-tab="purchase-orders"]',
      '[data-workspace-tab="goods-receipts"]'
    ];
    var staffAllowedHrefs = [
      '/admin',
      '/admin?view=dashboard',
      '/admin?panel=project-records',
      '/staff',
      '/staff?panel=project-records',
      '/master-data?tab=companies',
      '/master-data?tab=vendors',
      '/master-data?tab=requests',
      '/sales-management',
      '/sales-management?tab=sales-request',
      '/sales-management?tab=sales-order',
      '/sales-management?tab=project-delivery',
      '/procurement?tab=requests',
      '/procurement?tab=requisitions',
      '/inventory',
      '/inventory?tab=products',
      '/inventory?tab=warehouses',
      '/inventory?tab=stock',
      '/inventory?tab=movements',
      '/notifications'
    ];

    adminOnlySelectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (node) {
        node.style.display = isAdmin ? '' : 'none';
        node.setAttribute('aria-hidden', isAdmin ? 'false' : 'true');
      });
    });

    adminOnlyHrefs.forEach(function (href) {
      document.querySelectorAll('.sidebar-link').forEach(function (node) {
        var targetHref = String(node.dataset && node.dataset.navHref ? node.dataset.navHref : node.getAttribute('href') || '').trim();
        if (targetHref === href) {
          node.style.display = isAdmin ? '' : 'none';
          node.setAttribute('aria-hidden', isAdmin ? 'false' : 'true');
        }
      });
    });

    document.querySelectorAll('.sidebar-link').forEach(function (node) {
      var targetHref = String(node.dataset && node.dataset.navHref ? node.dataset.navHref : node.getAttribute('href') || '').trim();
      if (targetHref === '/master-data?tab=companies') {
        node.style.display = (isAdmin || isStaff) ? '' : 'none';
        node.setAttribute('aria-hidden', (isAdmin || isStaff) ? 'false' : 'true');
      }
      if (targetHref === '/staff' || targetHref === '/staff?panel=project-records' || targetHref === '/admin' || targetHref === '/admin?view=dashboard' || targetHref === '/admin?panel=project-records') {
        node.style.display = (isAdmin || isStaff) ? '' : 'none';
        node.setAttribute('aria-hidden', (isAdmin || isStaff) ? 'false' : 'true');
      }
    });

    staffHiddenSelectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (node) {
        node.style.display = isStaff ? 'none' : '';
        node.setAttribute('aria-hidden', isStaff ? 'true' : 'false');
      });
    });

    staffHiddenHrefs.forEach(function (href) {
      document.querySelectorAll('.sidebar-link').forEach(function (node) {
        var targetHref = String(node.dataset && node.dataset.navHref ? node.dataset.navHref : node.getAttribute('href') || '').trim();
        if (targetHref === href) {
          node.style.display = isStaff ? 'none' : '';
          node.setAttribute('aria-hidden', isStaff ? 'true' : 'false');
        }
      });
    });

    superOnlySelectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (node) {
        node.style.display = role === 'super_admin' ? '' : 'none';
        node.setAttribute('aria-hidden', role === 'super_admin' ? 'false' : 'true');
      });
    });

    superOnlyHrefs.forEach(function (href) {
      document.querySelectorAll('.sidebar-link').forEach(function (node) {
        var targetHref = String(node.dataset && node.dataset.navHref ? node.dataset.navHref : node.getAttribute('href') || '').trim();
        if (targetHref === href) {
          node.style.display = role === 'super_admin' ? '' : 'none';
          node.setAttribute('aria-hidden', role === 'super_admin' ? 'false' : 'true');
        }
      });
    });

    if (isStaff) {
      document.querySelectorAll('.sidebar-link').forEach(function (node) {
        var targetHref = String(node.dataset && node.dataset.navHref ? node.dataset.navHref : node.getAttribute('href') || '').trim();
        if (!targetHref || targetHref === '#') return;
        var allowed = staffAllowedHrefs.indexOf(targetHref) !== -1;
        node.style.display = allowed ? '' : 'none';
        node.setAttribute('aria-hidden', allowed ? 'false' : 'true');
      });
      document.querySelectorAll('.sidebar-group[data-sidebar-group]').forEach(function (group) {
        var visibleLinks = Array.prototype.some.call(group.querySelectorAll('.sidebar-link'), function (linkNode) {
          return linkNode.style.display !== 'none';
        });
        group.style.display = visibleLinks ? '' : 'none';
        group.setAttribute('aria-hidden', visibleLinks ? 'false' : 'true');
      });
    }
  }

  function setupSidebarLinkNavigation() {
    function withActiveTheme(target) {
      try {
        var url = new URL(target, window.location.origin);
        var currentTheme = String(
          (document.documentElement && document.documentElement.dataset ? document.documentElement.dataset.businessEntityTheme : '') ||
          (document.body && document.body.dataset ? document.body.dataset.businessEntityTheme : '')
        ).trim().toLowerCase();
        if ((currentTheme === 'kitsi' || currentTheme === 'kvsk') && url.origin === window.location.origin) {
          url.searchParams.set('theme', currentTheme);
        }
        return url.pathname + url.search + url.hash;
      } catch (_) {
        return target;
      }
    }

    document.querySelectorAll('.sidebar-link[href^="/"]').forEach(function (link) {
      if (link.dataset.navBound === '1') return;

      var rawHref = String(link.getAttribute('href') || '').trim();
      if (!rawHref || rawHref.indexOf('//') === 0) return;

      link.dataset.navBound = '1';
      link.dataset.navHref = rawHref;

      link.addEventListener('click', function (event) {
        if (event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        var target = String(link.dataset.navHref || link.getAttribute('href') || '').trim();
        if (!target || target === '#') return;
        event.preventDefault();
        window.location.assign(withActiveTheme(target));
      });
    });
  }

  function setupTableSlideControls() {
    document.querySelectorAll('.table-wrap').forEach(function (wrap) {
      if (wrap.dataset.slideReady === '1') return;
      wrap.dataset.slideReady = '1';

      var isPointerDown = false;
      var startX = 0;
      var startScrollLeft = 0;

      function updateScrollState() {
        var maxScroll = wrap.scrollWidth - wrap.clientWidth;
        var hasOverflow = maxScroll > 8;
        wrap.classList.toggle('is-scrollable-x', hasOverflow);
        wrap.classList.toggle('can-scroll-left', hasOverflow && wrap.scrollLeft > 4);
        wrap.classList.toggle('can-scroll-right', hasOverflow && wrap.scrollLeft < (maxScroll - 4));
      }

      wrap.addEventListener('scroll', updateScrollState, { passive: true });

      wrap.addEventListener('pointerdown', function (event) {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (event.target.closest('button, a, input, select, textarea, label')) return;
        if (wrap.scrollWidth <= wrap.clientWidth + 8) return;

        isPointerDown = true;
        startX = event.clientX;
        startScrollLeft = wrap.scrollLeft;
        wrap.classList.add('is-dragging');
        wrap.setPointerCapture(event.pointerId);
      });

      wrap.addEventListener('pointermove', function (event) {
        if (!isPointerDown) return;
        var deltaX = event.clientX - startX;
        wrap.scrollLeft = startScrollLeft - deltaX;
      });

      function endDrag(event) {
        if (!isPointerDown) return;
        isPointerDown = false;
        wrap.classList.remove('is-dragging');
        if (event && typeof event.pointerId === 'number' && wrap.hasPointerCapture(event.pointerId)) {
          wrap.releasePointerCapture(event.pointerId);
        }
        updateScrollState();
      }

      wrap.addEventListener('pointerup', endDrag);
      wrap.addEventListener('pointercancel', endDrag);
      wrap.addEventListener('pointerleave', function (event) {
        if (isPointerDown && event.pointerType === 'mouse') {
          endDrag(event);
        }
      });

      if (typeof ResizeObserver === 'function') {
        var observer = new ResizeObserver(updateScrollState);
        observer.observe(wrap);
        if (wrap.firstElementChild) observer.observe(wrap.firstElementChild);
      } else {
        window.addEventListener('resize', updateScrollState);
      }

      updateScrollState();
    });
  }

  window.addEventListener('pageshow', function () {
    verifySession();
  });

  const metaNoCache = document.createElement('meta');
  metaNoCache.httpEquiv = 'Cache-Control';
  metaNoCache.content = 'no-store, no-cache, must-revalidate';
  document.head.appendChild(metaNoCache);

  const metaPragma = document.createElement('meta');
  metaPragma.httpEquiv = 'Pragma';
  metaPragma.content = 'no-cache';
  document.head.appendChild(metaPragma);
})();
