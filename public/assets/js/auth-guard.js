/**
 * auth-guard.js
 * I-include sa lahat ng protected pages.
 * Pinipigilan ang back button access pagkatapos mag-logout at nililimitahan ang pages per role.
 */

(function () {
  'use strict';

  var BUSINESS_ENTITY_THEME_KEY = 'kinaadman_businessEntityTheme';
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
  installSharedUiFallbacks();
  verifySession();

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
          var key = String(group.getAttribute('data-sidebar-group') || '').trim();
          var toggle = group.querySelector('.sidebar-group-toggle');
          if (!toggle) return;
          var stored = key ? localStorage.getItem('kinaadman_sidebarGroup_' + key) : null;
          var defaultCollapsed = group.getAttribute('data-sidebar-default-collapsed') === '1';
          var shouldCollapse = stored === null ? defaultCollapsed : stored === '1';
          group.classList.toggle('is-collapsed', shouldCollapse);
          toggle.setAttribute('aria-expanded', String(!shouldCollapse));
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

    if (typeof window.doLogout !== 'function') {
      window.doLogout = function () {
        var confirmed = window.confirm('Maglo-logout ka na. Gusto mo bang ituloy?');
        if (!confirmed) return;
        localStorage.removeItem('kinaadman_activeTab');
        localStorage.removeItem('kinaadman_dashboardPanel');
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
      };
    }
  }

  function onReady() {
    applyStoredBusinessEntityThemeEarly();
    renderSharedSidebar();
    normalizeFinanceSidebar();
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

  function normalizeFinanceSidebar() {
    var nav = document.querySelector('#sidebar .sidebar-nav');
    if (!nav || nav.dataset.financeNormalized === '1') return;

    var oldAp = nav.querySelector('.sidebar-group[data-sidebar-group="accounts-payable"]');
    var oldAr = nav.querySelector('.sidebar-group[data-sidebar-group="accounts-receivable"]');
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

    var procurementHtml = buildGroup('procurement', 'Procurement Management', [
      buildLink('/procurement?tab=vendors', 'Vendors'),
      buildLink('/procurement?tab=requisitions', 'Purchase Requisitions'),
      buildLink('/procurement?tab=rfq', 'RFQ'),
      buildLink('/procurement?tab=quotations', 'Quotations & Evaluation'),
      buildLink('/procurement?tab=purchase-orders', 'Purchase Orders'),
      buildLink('/procurement?tab=goods-receipts', 'Goods Receipts')
    ]);

    var inventoryHtml = buildGroup('inventory', 'Inventory Management', [
      buildLink('/inventory', 'Products, Warehouses & Stock', 'menu-inventory')
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

    var insertAfter = procurement || nav.querySelector('.sidebar-group[data-sidebar-group="projects"]') || nav.querySelector('#menu-company-registry') || nav.firstElementChild;
    if (!procurement) {
      if (insertAfter && insertAfter.insertAdjacentHTML) {
        insertAfter.insertAdjacentHTML('afterend', procurementHtml);
        procurement = nav.querySelector('.sidebar-group[data-sidebar-group="procurement"]');
      } else {
        nav.insertAdjacentHTML('beforeend', procurementHtml);
        procurement = nav.querySelector('.sidebar-group[data-sidebar-group="procurement"]');
      }
    } else {
      var procurementToggle = procurement.querySelector('.sidebar-group-toggle span:first-child');
      if (procurementToggle) procurementToggle.textContent = 'Procurement Management';
    }

    if (oldAp) oldAp.remove();
    if (oldAr) oldAr.remove();
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
    nav.dataset.financeNormalized = '1';
  }

  function getStoredBusinessEntityThemeProfile() {
    try {
      var raw = localStorage.getItem(BUSINESS_ENTITY_THEME_KEY);
      var stored = raw ? JSON.parse(raw) : null;
      if (stored && stored.theme) return stored;
    } catch (_) {}
    return null;
  }

  function getBusinessEntityThemeFallback(profile) {
    var theme = String(profile && profile.theme ? profile.theme : '').toLowerCase();
    var name = String(profile && profile.company_name ? profile.company_name : '').toLowerCase();
    var isKitsi = theme === 'kitsi' || name.indexOf('kitsi') >= 0 || name.indexOf('ktiis') >= 0 || name.indexOf('kinaadman') >= 0;
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

  function applyStoredBusinessEntityThemeEarly() {
    var explicitTheme = '';
    if (document.documentElement && document.documentElement.dataset) {
      explicitTheme = String(document.documentElement.dataset.businessEntityTheme || '').trim();
    }
    if (!explicitTheme && document.body && document.body.dataset) {
      explicitTheme = String(document.body.dataset.businessEntityTheme || '').trim();
    }
    var stored = getStoredBusinessEntityThemeProfile();
    var canUseStoredTheme = Boolean(!explicitTheme && stored);
    var baseProfile = explicitTheme ? { theme: explicitTheme } : (canUseStoredTheme ? stored : { theme: 'kvsk' });
    var profile = getBusinessEntityThemeFallback(baseProfile);
    var logoProfile = {
      logo: canUseStoredTheme && stored.logo ? stored.logo : profile.logo,
      alt: canUseStoredTheme && stored.alt ? stored.alt : profile.alt
    };
    var activeTheme = explicitTheme || (stored && stored.theme ? stored.theme : profile.theme);
    activeBusinessEntityBrandTitle = getBusinessEntityBrandTitle(
      canUseStoredTheme ? stored : { theme: activeTheme }
    );
    var root = document.documentElement;
    root.style.setProperty('--primary', canUseStoredTheme && stored.primary ? stored.primary : profile.primary);
    root.style.setProperty('--primary-light', canUseStoredTheme && stored.primaryLight ? stored.primaryLight : profile.primaryLight);
    root.style.setProperty('--primary-dark', canUseStoredTheme && stored.primaryDark ? stored.primaryDark : profile.primaryDark);
    root.style.setProperty('--accent', canUseStoredTheme && stored.accent ? stored.accent : profile.accent);
    root.style.setProperty('--accent2', canUseStoredTheme && stored.accent2 ? stored.accent2 : profile.accent2);
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
    var theme = String(profile && profile.theme ? profile.theme : '').toLowerCase();
    if (theme === 'kitsi') return 'KITSI';
    return 'KVSK';
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
      var label = /^kitsi$/i.test(activeBusinessEntityBrandTitle) || /^ktisi$/i.test(activeBusinessEntityBrandTitle)
        ? 'KITSI'
        : (/^kvsk/i.test(activeBusinessEntityBrandTitle) ? 'KVSK' : activeBusinessEntityBrandTitle);
      node.textContent = label + ' Workspace';
      node.title = activeBusinessEntityBrandTitle;
      node.setAttribute('aria-label', 'Current workspace: ' + activeBusinessEntityBrandTitle);
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

        applyRoleBasedSidebar(data);

        var path = String(location.pathname || '').toLowerCase();
        var role = String(data.role || 'user').toLowerCase();
        var accessMatrix = [
          { prefixes: ['/user-management'], roles: ['super_admin', 'admin'] },
          { prefixes: ['/company-registry'], roles: ['super_admin', 'admin', 'staff'] },
          { prefixes: ['/admin'], roles: ['super_admin', 'admin', 'staff'] },
          { prefixes: ['/erp'], roles: ['super_admin', 'admin', 'staff'] },
          { prefixes: ['/accounts-payable'], roles: ['super_admin', 'admin', 'staff'] },
          { prefixes: ['/accounts-receivable'], roles: ['super_admin', 'admin', 'staff'] },
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
      return ['vendor-balances', 'ap-aging', 'disbursements'].indexOf(tab) !== -1;
    }
    if (path === '/accounts-receivable') {
      return ['customer-balances', 'ar-aging', 'documents'].indexOf(tab) !== -1;
    }
    return false;
  }

  function redirectStaffToOperationalTab() {
    var path = String(location.pathname || '').toLowerCase();
    if (path === '/accounts-payable') {
      location.replace('/accounts-payable?tab=bills');
      return;
    }
    if (path === '/accounts-receivable') {
      location.replace('/accounts-receivable?tab=invoices');
    }
  }

  function renderSharedSidebar() {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    if (sidebar.dataset && sidebar.dataset.sharedSidebarRendered === '1') return;

    var currentUrl = new URL(window.location.href);
    var currentPath = currentUrl.pathname.replace(/\/+$/, '') || '/';
    var currentSearch = currentUrl.search || '';

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
          var url = new URL(candidate, window.location.origin);
          var path = url.pathname.replace(/\/+$/, '') || '/';
          var search = url.search || '';
          return path === currentPath && search === currentSearch;
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
    var sidebarTitle = sidebarProfile.theme === 'kitsi' ? 'KITSI' : 'KVSK CCTV';
    var sidebarSub = sidebarProfile.theme === 'kitsi' ? 'ERP Workspace' : 'Operations Control Panel';

    sidebar.innerHTML = [
      '<div class="sidebar-header">',
        '<div class="sidebar-brand">',
          '<img class="sidebar-brand-mark" src="' + escapeAttr(storedProfile && storedProfile.logo ? storedProfile.logo : sidebarProfile.logo) + '" alt="' + escapeAttr(storedProfile && storedProfile.alt ? storedProfile.alt : sidebarProfile.alt) + '" />',
          '<div>',
            '<div class="header-logo" style="font-size: 1rem;">' + escapeAttr(sidebarTitle) + '</div>',
            '<div class="header-sub">' + escapeAttr(sidebarSub) + '</div>',
          '</div>',
        '</div>',
        '<button class="modal-close" style="position:static; padding: 5px;" onclick="toggleSidebar()" aria-label="Close menu">×</button>',
      '</div>',
      '<nav class="sidebar-nav">',
        link('/admin?view=dashboard', 'Dashboard', {
          id: 'menu-dashboard',
          aliases: ['/admin']
        }),
        link('/reports', 'Reports', {
          id: 'menu-reports',
          aliases: ['/admin?panel=reports']
        }),
        link('/company-registry', 'Company Registry', {
          id: 'menu-company-registry',
          aliases: ['/company']
        }),
        group('projects', 'Projects', false, [
          link('/admin?panel=project-records', 'Project Records', {
            id: 'menu-projects',
            subitem: true,
            aliases: ['/admin?view=project-records']
          }),
          link('/gantt-chart', 'Gantt Chart', {
            id: 'menu-gantt-chart',
            subitem: true
          })
        ]),
        group('procurement', 'Procurement Management', false, [
          link('/procurement?tab=vendors', 'Vendors', {
            subitem: true,
            aliases: ['/procurement', '/accounts-payable?tab=vendors']
          }),
          link('/procurement?tab=requisitions', 'Purchase Requisitions', {
            subitem: true,
            aliases: ['/accounts-payable?tab=requisitions']
          }),
          link('/procurement?tab=rfq', 'RFQ', { subitem: true }),
          link('/procurement?tab=quotations', 'Quotations & Evaluation', {
            subitem: true,
            aliases: ['/procurement?tab=bid-evaluation', '/accounts-payable?tab=quotations', '/accounts-payable?tab=bid-evaluation']
          }),
          link('/procurement?tab=purchase-orders', 'Purchase Orders', {
            subitem: true,
            aliases: ['/accounts-payable?tab=purchase-orders']
          }),
          link('/procurement?tab=goods-receipts', 'Goods Receipts', {
            subitem: true,
            aliases: ['/accounts-payable?tab=goods-receipts']
          })
        ]),
        group('inventory', 'Inventory Management', false, [
          link('/inventory', 'Products, Warehouses & Stock', {
            id: 'menu-inventory',
            subitem: true
          })
        ]),
        group('finance', 'Financial Management', false, [
          link('/accounts-payable?tab=bills', 'Bills', {
            subitem: true,
            aliases: ['/accounts-payable']
          }),
          link('/accounts-payable?tab=vendor-balances', 'Vendor Balances', { subitem: true }),
          link('/accounts-payable?tab=ap-aging', 'AP Aging', { subitem: true }),
          link('/accounts-payable?tab=payments', 'AP Payments', { subitem: true }),
          link('/accounts-payable?tab=disbursements', 'Disbursements', { subitem: true }),
          link('/accounts-receivable?tab=invoices', 'AR Invoices', {
            subitem: true,
            aliases: ['/accounts-receivable', '/accounts-receivable?tab=overview', '/accounts-receivable?tab=transactions', '/accounts-receivable?tab=receivables']
          }),
          link('/accounts-receivable?tab=collections', 'AR Collections', {
            subitem: true,
            aliases: ['/accounts-receivable?tab=payments']
          }),
          link('/accounts-receivable?tab=customer-balances', 'AR Customer Balances', { subitem: true }),
          link('/accounts-receivable?tab=ar-aging', 'AR Aging', { subitem: true }),
          link('/reports', 'General Ledger / Reports', { subitem: true })
        ]),
        group('admin', 'Admin', true, [
          link('/user-management', 'User Management', {
            id: 'menu-users',
            subitem: true
          }),
          link('/business-entities', 'Business Entities', {
            id: 'menu-business-entities',
            subitem: true
          }),
          link('/admin?panel=archive-center', 'Archive Center', {
            id: 'menu-archive-center',
            subitem: true,
            aliases: ['/admin?view=archive-center', '/admin?view=archived', '/admin?panel=archived']
          }),
          link('/admin?view=logs', 'System Logs', {
            id: 'menu-logs',
            subitem: true,
            aliases: ['/admin?panel=logs']
          })
        ]),
      '</nav>'
    ].join('');

    sidebar.dataset.sharedSidebarRendered = '1';
  }

  function applyRoleBasedSidebar(data) {
    var role = String(data && data.role ? data.role : 'user').toLowerCase();
    var isAdmin = role === 'super_admin' || role === 'admin';
    var isStaff = role === 'staff';
    var adminOnlyHrefs = [
      '/user-management',
      '/business-entities',
      '/admin?panel=archive-center',
      '/admin?view=logs',
      '/admin?view=archived'
    ];
    var staffHiddenHrefs = [
      '/reports',
      '/gantt-chart',
      '/accounts-payable?tab=vendor-balances',
      '/accounts-payable?tab=ap-aging',
      '/accounts-payable?tab=disbursements',
      '/accounts-receivable?tab=customer-balances',
      '/accounts-receivable?tab=ar-aging',
      '/accounts-receivable?tab=documents'
    ];
    var adminOnlySelectors = [
      '#menu-users',
      '#menu-business-entities',
      '#menu-archive-center',
      '#menu-logs',
      '#menu-archived'
    ];
    var staffHiddenSelectors = [
      '#menu-reports',
      '#menu-gantt-chart',
      '#stat-card-reports',
      '[data-workspace-tab="vendor-balances"]',
      '[data-workspace-tab="ap-aging"]',
      '[data-workspace-tab="disbursements"]',
      '[data-tab="vendor-balances"]',
      '[data-tab="ap-aging"]',
      '[data-tab="disbursements"]',
      '[data-tab="customer-balances"]',
      '[data-tab="ar-aging"]',
      '[data-tab="documents"]'
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
      if (targetHref === '/company-registry') {
        node.style.display = (isAdmin || isStaff) ? '' : 'none';
        node.setAttribute('aria-hidden', (isAdmin || isStaff) ? 'false' : 'true');
      }
      if (targetHref === '/admin?view=dashboard' || targetHref === '/admin?panel=project-records') {
        node.style.display = (isAdmin || isStaff) ? '' : 'none';
        node.setAttribute('aria-hidden', (isAdmin || isStaff) ? 'false' : 'true');
      }
    });
  }

  function setupSidebarLinkNavigation() {
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
        window.location.assign(target);
      });
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
