/* Shared ERP core */

'use strict';

window.__ERP_BUSINESS_ENTITY_CONTEXT_KEY__ = window.__ERP_BUSINESS_ENTITY_CONTEXT_KEY__ || 'kinaadman_businessEntityContext';
window.__ERP_BUSINESS_ENTITY_THEME_KEY__ = window.__ERP_BUSINESS_ENTITY_THEME_KEY__ || 'kinaadman_businessEntityTheme';
var erpCoreBusinessEntitiesDb = [];

function erpGetStoredBusinessEntityThemeProfile() {
  try {
    var raw = localStorage.getItem(window.__ERP_BUSINESS_ENTITY_THEME_KEY__);
    var stored = raw ? JSON.parse(raw) : null;
    if (stored && stored.theme) return stored;
  } catch (_) {}
  try {
    var pendingRaw = sessionStorage.getItem('kinaadman_pendingBusinessEntityTheme');
    var pending = pendingRaw ? JSON.parse(pendingRaw) : null;
    if (pending && pending.theme) return pending;
  } catch (_) {}
  return null;
}

function normalizeAccessRole(role) {
  var safeRole = String(role || 'user').trim().toLowerCase();
  return ['super_admin', 'admin', 'staff', 'user'].includes(safeRole) ? safeRole : 'user';
}

function isAdminRoleValue(role) {
  return ['super_admin', 'admin'].includes(normalizeAccessRole(role));
}

function isPrivilegedRoleValue(role) {
  return ['super_admin', 'admin', 'staff'].includes(normalizeAccessRole(role));
}

function erpGetExplicitBusinessEntityTheme() {
  var htmlTheme = document.documentElement && document.documentElement.dataset
    ? String(document.documentElement.dataset.businessEntityTheme || '').trim()
    : '';
  var bodyTheme = document.body && document.body.dataset
    ? String(document.body.dataset.businessEntityTheme || '').trim()
    : '';
  return htmlTheme || bodyTheme;
}

function erpGetBusinessEntityBrandProfile(row) {
  var name = String(row && row.company_name ? row.company_name : '').trim();
  var isKitsi = /kitsi|ktiis|kinaadman/i.test(name) || String(row && row.theme ? row.theme : '').toLowerCase() === 'kitsi';
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

function erpApplyBusinessEntityBrand(row) {
  var profile = erpGetBusinessEntityBrandProfile(row);
  document.documentElement.dataset.businessEntityTheme = profile.theme;
  document.documentElement.dataset.businessEntityThemeReady = '1';
  document.body.dataset.businessEntityTheme = profile.theme;
  document.body.dataset.businessEntityThemeReady = '1';
  document.documentElement.style.setProperty('--primary', profile.primary);
  document.documentElement.style.setProperty('--primary-light', profile.primaryLight);
  document.documentElement.style.setProperty('--primary-dark', profile.primaryDark);
  document.documentElement.style.setProperty('--accent', profile.accent);
  document.documentElement.style.setProperty('--accent2', profile.accent2);

  document.querySelectorAll('.brand-mark, .sidebar-brand-mark, .user-modal-brand-mark').forEach(function (img) {
    img.src = profile.logo;
    img.alt = profile.alt;
  });

  document.querySelectorAll('header .brand-copy .header-logo').forEach(function (node) {
    node.textContent = row && row.company_name
      ? row.company_name
      : (profile.theme === 'kitsi' ? 'KITSI' : 'KVSK CCTV & IT Solution');
  });
  if (document.documentElement && document.documentElement.dataset) {
    document.documentElement.dataset.businessEntityBrandTextReady = '1';
  }

  try {
    var storedProfile = {
      company_name: row && row.company_name ? row.company_name : (profile.theme === 'kitsi' ? 'KITSI' : 'KVSK CCTV & IT Solution'),
      theme: profile.theme,
      logo: profile.logo,
      alt: profile.alt,
      primary: profile.primary,
      primaryLight: profile.primaryLight,
      primaryDark: profile.primaryDark,
      accent: profile.accent,
      accent2: profile.accent2
    };
    localStorage.setItem(window.__ERP_BUSINESS_ENTITY_THEME_KEY__, JSON.stringify(storedProfile));
    sessionStorage.setItem('kinaadman_pendingBusinessEntityTheme', JSON.stringify(storedProfile));
  } catch (_) {}
}

function erpApplyStoredBusinessEntityBrand() {
  var explicitTheme = erpGetExplicitBusinessEntityTheme();
  if (explicitTheme) {
    erpApplyBusinessEntityBrand({ theme: explicitTheme, company_name: explicitTheme === 'kitsi' ? 'KITSI' : 'KVSK CCTV & IT Solution' });
    return;
  }
  var stored = erpGetStoredBusinessEntityThemeProfile();
  if (stored && stored.theme) {
    erpApplyBusinessEntityBrand(stored);
    return;
  }
  erpApplyBusinessEntityBrand({ company_name: 'KVSK' });
}

function erpGetDefaultBusinessEntityId() {
  var defaultRow = erpCoreBusinessEntitiesDb.find(function (row) {
    return Number(row && row.is_default ? row.is_default : 0) === 1;
  }) || erpCoreBusinessEntitiesDb[0] || null;
  return defaultRow ? String(defaultRow.id || '') : '';
}

function erpGetCurrentBusinessEntityId() {
  var stored = String(localStorage.getItem(window.__ERP_BUSINESS_ENTITY_CONTEXT_KEY__) || '').trim();
  if (stored && erpCoreBusinessEntitiesDb.some(function (row) { return String(row.id || '') === stored; })) {
    return stored;
  }
  var fallback = erpGetDefaultBusinessEntityId();
  if (fallback) {
    localStorage.setItem(window.__ERP_BUSINESS_ENTITY_CONTEXT_KEY__, fallback);
  }
  return fallback;
}

function erpLoadBusinessEntitiesForTheme() {
  fetch('/api/business-entities', { cache: 'no-store' })
    .then(function (r) {
      return r.json().catch(function () { return []; }).then(function (data) {
        if (!r.ok) throw new Error(data.error || 'Unable to load operating companies.');
        return data;
      });
    })
    .then(function (rows) {
      erpCoreBusinessEntitiesDb = Array.isArray(rows) ? rows : [];
      var explicitTheme = erpGetExplicitBusinessEntityTheme();
      if (explicitTheme) {
        erpApplyBusinessEntityBrand({ theme: explicitTheme, company_name: explicitTheme === 'kitsi' ? 'KITSI' : 'KVSK CCTV & IT Solution' });
        return;
      }
      var storedThemeProfile = erpGetStoredBusinessEntityThemeProfile();
      if (storedThemeProfile && storedThemeProfile.theme) {
        erpApplyBusinessEntityBrand(storedThemeProfile);
        return;
      }
      var current = erpGetCurrentBusinessEntityId();
      var activeEntity = erpCoreBusinessEntitiesDb.find(function (row) {
        return String(row.id || '') === String(current || '');
      }) || erpCoreBusinessEntitiesDb[0] || null;
      erpApplyBusinessEntityBrand(activeEntity || { company_name: 'KVSK' });
    })
    .catch(function (err) {
      console.error('Business entity theme load error:', err);
    });
}

document.addEventListener('DOMContentLoaded', () => {
  erpApplyStoredBusinessEntityBrand();
  loadNotificationReadState();
  const isAdminDashboardPage = document.body?.classList.contains('admin-page') || !!document.getElementById('dashboard');
  const initialParams = new URLSearchParams(window.location.search);
  pendingTransactionProjectId = Number(initialParams.get('project_id') || 0) || null;
  pendingTransactionLaunch = String(initialParams.get('action') || '').toLowerCase() === 'transaction' && !!pendingTransactionProjectId;

  // 1. I-verify ang User Role at I-restore ang huling active tab
  fetch('/api/me').then(r => r.json()).then(user => {
    currentUser = user;
    if (user?.csrfToken) {
      window.__CSRF_TOKEN__ = user.csrfToken;
    }
    updateRoleBadge(user);
    const safeCurrentRole = normalizeAccessRole(user.role);
    document.body?.setAttribute('data-access-role', safeCurrentRole);
    document.body?.classList.toggle('is-staff-role', safeCurrentRole === 'staff');
    document.body?.classList.toggle('is-admin-role', isAdminRoleValue(safeCurrentRole));
    if (activeTab === 'users' || document.body?.classList.contains('user-management-page')) {
      renderUsers();
    }
    
    if (isAdminRoleValue(user.role)) {
      const adminSidebarGroup = document.querySelector('.sidebar-group[data-sidebar-group="admin"]');
      if (adminSidebarGroup) {
        adminSidebarGroup.style.display = '';
        adminSidebarGroup.setAttribute('aria-hidden', 'false');
      }
      const utab = document.getElementById('tab-users');
      if (utab) utab.style.display = 'block';

      const menuUsers = document.getElementById('menu-users');
      if (menuUsers) menuUsers.style.display = 'block';

      const menuBusinessEntities = document.getElementById('menu-business-entities');
      if (menuBusinessEntities) menuBusinessEntities.style.display = safeCurrentRole === 'super_admin' ? 'block' : 'none';
      
      const menuLogs = document.getElementById('menu-logs');
      if (menuLogs) menuLogs.style.display = 'block';
    } else {
      const adminSidebarGroup = document.querySelector('.sidebar-group[data-sidebar-group="admin"]');
      if (adminSidebarGroup) {
        adminSidebarGroup.style.display = 'none';
        adminSidebarGroup.setAttribute('aria-hidden', 'true');
      }
    }

    if (isAdminDashboardPage) {
      const storedTab = localStorage.getItem('kinaadman_activeTab');
      const archivedMenu = document.getElementById('menu-archived');
      const allowedTabs = isAdminRoleValue(user.role) ? ['all', 'archived', 'users'] : ['all'];

      if (archivedMenu) archivedMenu.style.display = isAdminRoleValue(user.role) ? '' : 'none';
      activeTab = allowedTabs.includes(storedTab) ? storedTab : 'all';
      localStorage.setItem('kinaadman_activeTab', activeTab);
      updateSidebarMenuState('dashboard');
    }

    if (isAdminDashboardPage && document.querySelector('.stats')) {
      loadRecords();
      applyInitialAdminView(user);
    }

    // Auto-highlight sidebar link base sa kasalukuyang page (URL)
    const path = window.location.pathname;
    document.querySelectorAll('.sidebar-link').forEach(link => {
      const href = link.getAttribute('href');
      if (href && href !== '#' && (path === href || path.endsWith(href))) {
        document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
      }
    });
  });

  // Bind Upload Zone listeners programmatically to ensure they work
  const zone = document.getElementById('upload-zone');
  if (zone) {
    zone.ondragover = (e) => handleDragOver(e);
    zone.ondragleave = (e) => handleDragLeave(e);
    zone.ondrop = (e) => handleDrop(e);
  }

  setupRequiredFieldMarkers();
  setupPhoneValidation();
  setupMemberSlotControls();
  setupCalculationListeners();
  setupProjectCalculationListeners();
  setupGanttPlannerPanel();
  setupPasswordToggleListeners();
  setupSidebarLinkNavigation();
  syncSidebarGroupStates();
  syncSidebarActiveLinks();
  erpLoadBusinessEntitiesForTheme();

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setSidebarOpen(false);
      closeNotificationsPanel();
    }
  });

  document.addEventListener('click', (event) => {
    const wrap = document.querySelector('.notification-wrap');
    const panel = document.getElementById('notifications-panel');
    if (!wrap || !panel || panel.classList.contains('is-hidden')) return;
    if (!wrap.contains(event.target)) {
      closeNotificationsPanel();
    }
  });
});

function applyInitialAdminView(user) {
  const params = new URLSearchParams(window.location.search);
  const requestedView = params.get('view');
  const requestedPanel = params.get('panel');
  const requestedTab = params.get('tab');
  const rememberedPanel = localStorage.getItem('kinaadman_dashboardPanel');
  const allowedPanels = ['home', 'project-records', 'total-projects', 'ongoing-projects', 'system-logs'];
  const allowedTabs = isAdminRoleValue(user?.role) ? ['all', 'archived', 'users'] : ['all'];
  const menuByTab = {
    all: document.getElementById('menu-all'),
    archived: document.getElementById('menu-archived'),
    users: document.getElementById('menu-users')
  };

  if (requestedView === 'dashboard') {
    activeTab = 'all';
    localStorage.setItem('kinaadman_activeTab', 'all');
    localStorage.setItem('kinaadman_dashboardPanel', 'home');
    openDashboardPanel('home');
    return;
  }

  if (requestedPanel === 'project-records') {
    openDashboardPanel('project-records');
    return;
  }

  if (requestedPanel === 'service-orders' || requestedView === 'service-orders') {
    window.location.replace('/accounts-receivable?tab=service-orders');
    return;
  }

  if (requestedView === 'all') {
    const menuAll = document.getElementById('menu-all');
    switchTab('all', menuAll);
    return;
  }

  if (requestedView === 'archived' && isAdminRoleValue(user?.role)) {
    const menuArchived = document.getElementById('menu-archived');
    switchTab('archived', menuArchived);
    return;
  }

  if (requestedView === 'users' && isAdminRoleValue(user?.role)) {
    const menuUsers = document.getElementById('menu-users');
    switchTab('users', menuUsers);
    return;
  }

  if (requestedView === 'logs' && isAdminRoleValue(user?.role)) {
    openLogsPanel();
    return;
  }

  if (requestedView === 'ongoing' || requestedView === 'ongoing-projects') {
    openDashboardPanel('ongoing-projects');
    return;
  }

  if (!requestedView && requestedPanel && allowedPanels.includes(requestedPanel)) {
    if (requestedPanel === 'system-logs') {
      if (isAdminRoleValue(user?.role)) {
        openLogsPanel();
      } else {
        openDashboardPanel('home');
      }
      return;
    }

    if (requestedPanel === 'ongoing-projects') {
      openDashboardPanel('ongoing-projects');
      return;
    }

    if (requestedPanel === 'total-projects') {
      const preferredTab = allowedTabs.includes(requestedTab) ? requestedTab : activeTab;
      const restoredTab = isAdminRoleValue(user?.role) && preferredTab === 'archived'
        ? 'archived'
        : (preferredTab === 'users' && isAdminRoleValue(user?.role) ? 'users' : 'all');
      switchTab(restoredTab, menuByTab[restoredTab] || null);
      return;
    }

    openDashboardPanel('home');
    return;
  }

  if (!requestedView) {
    openDashboardPanel('home');
    return;
  }

  openDashboardPanel('home');
}

function syncAdminViewUrl(panel, tab) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('view');

    if (panel === 'project-records') {
      url.searchParams.set('panel', 'project-records');
      url.searchParams.delete('tab');
    } else if (panel === 'total-projects') {
      const safeTab = isAdminUser() && tab === 'archived' ? 'archived' : (isAdminUser() && tab === 'users' ? 'users' : 'all');
      url.searchParams.set('panel', 'total-projects');
      url.searchParams.set('tab', safeTab);
    } else if (panel === 'ongoing-projects') {
      url.searchParams.set('panel', 'ongoing-projects');
      url.searchParams.delete('tab');
    } else if (panel === 'system-logs') {
      url.searchParams.set('panel', 'system-logs');
      url.searchParams.delete('tab');
    } else {
      url.searchParams.delete('panel');
      url.searchParams.delete('tab');
    }

    const search = url.searchParams.toString();
    const nextUrl = `${url.pathname}${search ? `?${search}` : ''}${url.hash || ''}`;
    window.history.replaceState({}, '', nextUrl);
  } catch (_) {
    // Ignore URL parsing issues; UI state is already applied.
  }
}

function updateSidebarMenuState(tab) {
  document.querySelectorAll('.sidebar-link').forEach(l => {
    if (l.id && l.id.startsWith('menu-')) {
      l.classList.toggle('active', l.id === 'menu-' + tab);
    }
  });
}

function updateDashboardHero(panel) {
  const pageTitle = document.querySelector('.page-title');
  const pageSub = document.querySelector('.page-sub');

  if (!pageTitle || !pageSub) return;

  if (panel === 'project-records') {
    pageTitle.textContent = 'Projects';
    pageSub.textContent = '';
    return;
  }

  if (panel === 'total-projects') {
    pageTitle.textContent = activeTab === 'archived' ? 'Archived Project Transactions' : 'Project Transactions';
    pageSub.textContent = '';
    return;
  }

  if (panel === 'ongoing-projects') {
    pageTitle.textContent = 'Ongoing Projects';
    pageSub.textContent = '';
    return;
  }

  if (panel === 'system-logs') {
    pageTitle.textContent = 'System Logs';
    pageSub.textContent = '';
    return;
  }

  if (activeTab === 'users') {
    pageTitle.textContent = 'User Management';
    pageSub.textContent = '';
    return;
  }

  pageTitle.textContent = 'Dashboard';
  pageSub.textContent = '';
}

function updateRoleBadge(userOrRole) {
  const badge = document.getElementById('role-badge');
  if (!badge) return;

  const user = typeof userOrRole === 'object' && userOrRole ? userOrRole : currentUser;
  const role = typeof userOrRole === 'object' && userOrRole ? userOrRole.role : userOrRole;
  const safeRole = normalizeAccessRole(role);
  const labelMap = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    staff: 'Staff',
    user: 'User'
  };
  const name = String(user?.fullname || user?.username || '').trim();
  const roleLabel = labelMap[safeRole] || 'User';

  badge.textContent = name ? `${name} (${roleLabel})` : roleLabel;
  badge.title = name ? `Logged in as ${name} (${roleLabel})` : `Logged in as ${roleLabel}`;
  badge.dataset.role = safeRole;
}

function openDashboardPanel(panel = 'home', opts = {}) {
  if (['project-records', 'ongoing-projects'].includes(panel)) {
    currentDashboardCompany = 'all';
    localStorage.setItem('kinaadman_dashboardCompany', 'all');
    syncDashboardCompanyFilterOptions();
  }
  currentDashboardPanel = panel;
  localStorage.setItem('kinaadman_dashboardPanel', panel);
  if (opts.syncUrl !== false) {
    syncAdminViewUrl(panel, activeTab);
  }

  const sections = {
    home: document.getElementById('dashboard-home-section'),
    reports: document.getElementById('reports-section'),
    'project-records': document.getElementById('project-records-section'),
    'total-projects': document.getElementById('total-projects-section'),
    'ongoing-projects': document.getElementById('ongoing-projects-section'),
    'system-logs': document.getElementById('system-logs-section')
  };

  Object.entries(sections).forEach(([key, section]) => {
    if (!section) return;
    section.classList.toggle('is-hidden', key !== panel);
  });

  const statsRow = document.querySelector('.dashboard-stats');
  if (statsRow) {
    statsRow.style.display = panel === 'home' ? 'grid' : 'none';
  }

  if (panel === 'home') {
    updateSidebarMenuState('dashboard');
  } else if (panel === 'reports') {
    updateSidebarMenuState('reports');
  } else if (panel === 'project-records') {
    updateSidebarMenuState('projects');
  } else if (panel === 'total-projects') {
    updateSidebarMenuState('all');
  } else if (panel === 'ongoing-projects') {
    updateSidebarMenuState('ongoing-projects');
  } else if (panel === 'system-logs') {
    updateSidebarMenuState('logs');
  }

  updateDashboardHero(panel);

  if (panel === 'ongoing-projects') {
    ongoingProjectsViewMode = 'ongoing';
    renderOngoingProjects();
  } else if (panel === 'system-logs') {
    loadLogs();
  } else if (panel === 'project-records') {
    renderProjectRecordsTable();
  } else if (panel === 'total-projects') {
    renderTable();
  }
}

function loadProjectsDashboardData() {
  return fetch('/api/projects?include_archived=1')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => {
      projectsDashboardDb = Array.isArray(data) ? data : [];
      syncDashboardCompanyFilterOptions();
      populateTransactionProjectSelect(document.getElementById('f-project-id')?.value || '');
      renderOngoingProjects();
      renderProjectRecordsTable();
      renderProjectMasterTable();
      if (document.getElementById('gantt-project-cards')) {
        renderGanttProjectSwitcher();
      }
      if (currentDashboardPanel === 'project-records') {
        renderProjectRecordsTable();
      }
      if (currentDashboardPanel === 'total-projects') {
        renderTable();
      }
      if (pendingTransactionLaunch && pendingTransactionProjectId) {
        const projectExists = projectsDashboardDb.some(project => Number(project.id || 0) === Number(pendingTransactionProjectId));
        if (projectExists && document.getElementById('total-projects-section')) {
          const projectId = Number(pendingTransactionProjectId);
          pendingTransactionLaunch = false;
          pendingTransactionProjectId = null;
          setTimeout(() => openModal(null, projectId), 0);
        }
      }
    })
    .catch(err => {
      console.error('Projects dashboard load error:', err);
      projectsDashboardDb = [];
      const tbody = document.getElementById('ongoing-projects-body');
      if (tbody) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="7">Hindi ma-load ang ongoing projects.</td></tr>';
      }
      const projectBody = document.getElementById('project-table-body');
      if (projectBody) {
        projectBody.innerHTML = '<tr class="empty-row"><td colspan="17">Hindi ma-load ang projects.</td></tr>';
      }
      const projectRecordsBody = document.getElementById('project-records-table-body');
      if (projectRecordsBody) {
        projectRecordsBody.innerHTML = '<tr class="empty-row"><td colspan="4">Hindi ma-load ang project records.</td></tr>';
      }
      if (document.getElementById('gantt-project-cards')) {
        renderGanttProjectSwitcher();
      }
    });
}

function getProjectLifecycleStatusFilter(project) {
  return getProjectLifecycleLabel(project);
}

function formatPhpCurrency(value) {
  return `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function extractClientFromProjectName(projectName) {
  const parts = String(projectName || '').split(' - ').map(part => part.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[0] : '';
}

function normalizeDashboardCompanyName(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.toLowerCase() === 'all') return 'all';
  return normalized;
}

function getProjectCompanyName(project) {
  if (!project) return '';
  if (project.registry_company_name) {
    return String(project.registry_company_name || '').trim();
  }
  const companyId = Number(project.company_id || project.registry_company_id || 0);
  if (companyId) {
    const companyRecord = findRegistryCompanyById(companyId);
    if (companyRecord?.company_name) return companyRecord.company_name;
  }
  const companyNo = String(project.company_no || '').trim();
  if (companyNo) {
    const companyRecord = findRegistryCompanyByNo(companyNo);
    if (companyRecord?.company_name) return companyRecord.company_name;
  }
  return String(
    project.company_name ||
    project.client_name ||
    project.source_client ||
    extractClientFromProjectName(project.project_name) ||
    ''
  ).trim();
}

function getProjectArInvoiceNo(project) {
  const docno = String(project?.project_docno || project?.source_docno || '').trim();
  if (!docno) return '';
  return String(project?.project_ar_invoice_no || project?.ar_invoice_no || `INV-${docno}`).trim();
}

function getProjectApBillNo(project) {
  const docno = String(project?.project_docno || project?.source_docno || '').trim();
  if (!docno) return '';
  return String(project?.project_ap_bill_no || project?.ap_bill_no || `BILL-${docno}`).trim();
}

function getTransactionCompanyName(record) {
  if (!record) return '';
  return String(
    record.company_name ||
    record.client_name ||
    record.client ||
    record.customer_name ||
    record.customer ||
    record.source_client ||
    ''
  ).trim();
}

function getReceivableCompanyName(row) {
  if (!row) return '';
  const linkedProjectId = Number(row.project_id || 0);
  if (linkedProjectId) {
    const linkedProject = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : []).find(project => Number(project.id || 0) === linkedProjectId);
    if (linkedProject) {
      const linkedCompany = getProjectCompanyName(linkedProject);
      if (linkedCompany) return linkedCompany;
    }
  }
  return String(row.customer_name || row.company_name || row.client_name || '').trim();
}

function getDashboardCompanyNameForRecord(record) {
  if (!record) return '';
  if (String(record.source || '').toLowerCase() === 'receivable') {
    return getReceivableCompanyName(record);
  }
  if (String(record.type || '').toLowerCase() === 'invoice') {
    return getTransactionCompanyName(record);
  }
  return '';
}

function companyMatchesDashboardFilter(companyName) {
  const selected = normalizeDashboardCompanyName(currentDashboardCompany || localStorage.getItem('kinaadman_dashboardCompany') || 'all');
  if (selected === 'all') return true;
  const left = normalizeDashboardCompanyName(companyName).toLowerCase();
  return left === selected.toLowerCase();
}

function getRegistryCompanyEntries() {
  return (Array.isArray(companyRegistryDb) ? companyRegistryDb : [])
    .map((row) => ({
      id: Number(row?.id || 0),
      company_no: String(row?.company_no || '').trim(),
      company_name: String(row?.company_name || '').trim(),
      business_entity_id: String(row?.business_entity_id || '').trim(),
      address: String(row?.address || '').trim()
    }))
    .filter((row) => row.id && row.company_no && row.company_name)
    .filter((row) => typeof businessEntityMatches !== 'function' || businessEntityMatches(row))
    .sort((a, b) => a.company_name.localeCompare(b.company_name));
}

function getRegistryCompanyLabel(row) {
  const companyNo = String(row?.company_no || '').trim();
  const companyName = String(row?.company_name || '').trim();
  if (companyNo && companyName) return `${companyNo} - ${companyName}`;
  return companyName || companyNo || '';
}

function findRegistryCompanyByNo(companyNo) {
  const target = String(companyNo || '').trim().toLowerCase();
  if (!target) return null;
  return getRegistryCompanyEntries().find((row) => String(row.company_no || '').trim().toLowerCase() === target) || null;
}

function findRegistryCompanyByName(companyName) {
  const target = String(companyName || '').trim().toLowerCase();
  if (!target) return null;
  return getRegistryCompanyEntries().find((row) => String(row.company_name || '').trim().toLowerCase() === target) || null;
}

function findRegistryCompanyById(companyId) {
  const target = Number(companyId || 0);
  if (!target) return null;
  return getRegistryCompanyEntries().find((row) => Number(row.id || 0) === target) || null;
}

function collectDashboardCompanies() {
  const companies = new Map();
  const addCompany = (value, label = '') => {
    const name = normalizeDashboardCompanyName(value);
    if (!name || name === 'all') return;
    const key = name.toLowerCase();
    if (!companies.has(key)) {
      companies.set(key, {
        value: name,
        label: normalizeDashboardCompanyName(label || value)
      });
    }
  };

  (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : []).filter((row) => typeof businessEntityMatches !== 'function' || businessEntityMatches(row)).forEach(project => {
    const companyName = getProjectCompanyName(project);
    addCompany(companyName, companyName);
  });

  (Array.isArray(allTransactionsDb) ? allTransactionsDb : []).filter((row) => typeof businessEntityMatches !== 'function' || businessEntityMatches(row)).forEach(record => {
    const companyName = getTransactionCompanyName(record);
    addCompany(companyName, companyName);
  });

  (Array.isArray(allReceivablesDb) ? allReceivablesDb : []).filter((row) => typeof businessEntityMatches !== 'function' || businessEntityMatches(row)).forEach(row => {
    const companyName = getReceivableCompanyName(row);
    addCompany(companyName, companyName);
  });

  (Array.isArray(companyRegistryDb) ? companyRegistryDb : []).filter((row) => typeof businessEntityMatches !== 'function' || businessEntityMatches(row)).forEach(row => {
    const companyLabel = getRegistryCompanyLabel(row);
    addCompany(row.company_name || '', companyLabel);
  });

  return Array.from(companies.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function syncDashboardCompanyFilterOptions() {
  const selectIds = ['dashboard-company-filter', 'project-company-filter', 'project-records-company-filter'];
  const options = collectDashboardCompanies();
  const safeCurrent = normalizeDashboardCompanyName(currentDashboardCompany || localStorage.getItem('kinaadman_dashboardCompany') || 'all');
  const allowedValues = new Set(['all', ...options.map(option => String(option.value || '').toLowerCase())]);
  const nextCurrent = allowedValues.has(safeCurrent.toLowerCase()) ? safeCurrent : 'all';
  const activeOption = options.find((option) => String(option.value || '').toLowerCase() === String(nextCurrent || '').toLowerCase()) || null;
  const visibleOptions = nextCurrent === 'all'
    ? options
    : [activeOption, ...options.filter((option) => String(option.value || '').toLowerCase() !== String(nextCurrent || '').toLowerCase())].filter(Boolean);

  currentDashboardCompany = nextCurrent;
  localStorage.setItem('kinaadman_dashboardCompany', nextCurrent);

  selectIds.forEach((id) => {
    const host = document.getElementById(id);
    if (!host) return;

    const desiredValue = nextCurrent;

    host.innerHTML = '';
    host.setAttribute('data-selected', desiredValue);
    host.classList.toggle('has-selected-company', nextCurrent !== 'all');

    const makeChip = (label, value) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'company-switch-chip';
      button.textContent = label;
      button.setAttribute('data-value', value);
      button.setAttribute('aria-pressed', String(String(value).toLowerCase() === String(desiredValue).toLowerCase()));
      if (String(value).toLowerCase() === String(desiredValue).toLowerCase()) {
        button.classList.add('is-active');
      }
      button.addEventListener('click', () => setDashboardCompanyFilter(value));
      return button;
    };

    host.appendChild(makeChip('All Companies', 'all'));
    visibleOptions.forEach((option) => {
      host.appendChild(makeChip(option.label, option.value));
    });
  });
}

function getCurrentDashboardCompanyLabel() {
  const selected = normalizeDashboardCompanyName(currentDashboardCompany || localStorage.getItem('kinaadman_dashboardCompany') || 'all');
  if (!selected || selected.toLowerCase() === 'all') return 'All Companies';
  const match = collectDashboardCompanies().find((option) => String(option.value || '').toLowerCase() === selected.toLowerCase());
  return match?.label || selected;
}

function populateProjectCompanySelect(selectedCompany = '') {
  const select = document.getElementById('p-company-select');
  if (!select) return;

  const options = getRegistryCompanyEntries();
  const current = String(selectedCompany || '').trim();

  select.innerHTML = `
    <option value="">Select Company</option>
    ${options.map(option => `<option value="${escHtml(String(option.id))}">${escHtml(getRegistryCompanyLabel(option))}</option>`).join('')}
  `;

  const matchById = options.find((option) => String(option.id || '').toLowerCase() === current.toLowerCase());
  const matchByNo = options.find((option) => String(option.company_no || '').toLowerCase() === current.toLowerCase());
  const matchByName = options.find((option) => String(option.company_name || '').toLowerCase() === current.toLowerCase());
  select.value = String(matchById?.id || matchByNo?.id || matchByName?.id || '');
}

function getProjectLinkLabel(project) {
  if (!project) return '';
  const docno = String(project.project_docno || project.source_docno || '').trim();
  const name = String(project.project_name || 'Untitled Project').trim();
  const company = String(getProjectCompanyName(project) || '').trim();
  const parts = [];
  if (docno) parts.push(docno);
  if (name) parts.push(name);
  if (company) parts.push(company);
  return parts.join(' - ');
}

function setTransactionProjectSelectionLocked(locked = false) {
  const select = document.getElementById('f-project-id');
  if (!select) return;

  const isLocked = Boolean(locked);
  select.disabled = isLocked;
  select.dataset.locked = isLocked ? '1' : '0';
  select.style.pointerEvents = isLocked ? 'none' : '';
  select.style.opacity = isLocked ? '0.85' : '';
}

function populateTransactionProjectSelect(selectedProjectId = '', locked = false) {
  const select = document.getElementById('f-project-id');
  if (!select) return;

  const projects = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
    .slice()
    .sort((a, b) => String(getProjectLinkLabel(a)).localeCompare(String(getProjectLinkLabel(b))));
  const current = String(selectedProjectId || '').trim();

  select.innerHTML = `
    <option value="">Select Project</option>
    ${projects.map(project => `<option value="${escHtml(String(project.id || ''))}">${escHtml(getProjectLinkLabel(project))}</option>`).join('')}
  `;

  select.value = current;
  select.onchange = handleTransactionProjectChange;
  setTransactionProjectSelectionLocked(Boolean(locked) && !!current);
  handleTransactionProjectChange();
}

function fillTransactionProjectData(project) {
  const startDate = formatDateYmd(project?.planned_start_date || project?.start_date || '') || '';
  const endDate = formatDateYmd(project?.planned_end_date || project?.end_date || '') || '';
  const companyName = String(getProjectCompanyName(project) || '').trim();
  const projectDocNo = String(project?.project_docno || project?.source_docno || '').trim();
  const projectTxNo = getNextProjectTransactionNo(Number(project?.id || 0) || 0);

  const projectDocNoInput = document.getElementById('f-linked-project-docno');
  const projectTxNoInput = document.getElementById('f-project-tx-no');
  const projectStartInput = document.getElementById('f-project-start-date');
  const projectEndInput = document.getElementById('f-project-end-date');
  const projectCompanyInput = document.getElementById('f-project-company');
  if (projectDocNoInput) projectDocNoInput.value = projectDocNo || '';
  if (projectTxNoInput) projectTxNoInput.value = projectTxNo ? String(projectTxNo) : '';
  if (projectStartInput) projectStartInput.value = startDate || '';
  if (projectEndInput) projectEndInput.value = endDate || '';
  if (projectCompanyInput) projectCompanyInput.value = companyName || '';
}

function getNextProjectTransactionNo(projectId, excludeTransactionId = null) {
  const selectedProjectId = Number(projectId || 0) || 0;
  if (!selectedProjectId) return '';
  const excludedId = Number(excludeTransactionId || 0) || 0;
  const rows = Array.isArray(db) ? db : [];
  const maxNo = rows
    .filter(row => Number(row.project_id || 0) === selectedProjectId && Number(row.id || 0) !== excludedId)
    .reduce((max, row) => Math.max(max, Number(row.project_tx_no || 0) || 0), 0);
  return maxNo + 1;
}

function handleTransactionProjectChange() {
  const select = document.getElementById('f-project-id');
  const projectId = Number(select?.value || 0) || 0;
  const project = projectId
    ? (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : []).find(entry => Number(entry.id || 0) === projectId)
    : null;

  if (project) {
    fillTransactionProjectData(project);
  } else {
    const projectDocNoInput = document.getElementById('f-linked-project-docno');
    const projectTxNoInput = document.getElementById('f-project-tx-no');
    const projectStartInput = document.getElementById('f-project-start-date');
    const projectEndInput = document.getElementById('f-project-end-date');
    const projectCompanyInput = document.getElementById('f-project-company');
    if (projectDocNoInput) projectDocNoInput.value = '';
    if (projectTxNoInput) projectTxNoInput.value = '';
    if (projectStartInput) projectStartInput.value = '';
    if (projectEndInput) projectEndInput.value = '';
    if (projectCompanyInput) projectCompanyInput.value = '';
  }

  const locked = Boolean(select?.dataset?.locked === '1' && projectId);
  if (select) {
    select.disabled = locked;
    select.style.pointerEvents = locked ? 'none' : '';
    select.style.opacity = locked ? '0.85' : '';
  }
}

function fillTransactionFormFromProject(project) {
  if (!project) return;

  const sourceTransaction = findSourceTransactionForProject(project) || {};
  const paymentSummary = getProjectPaymentSummary(project);

  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
  };

  const clientName = String(
    sourceTransaction.client ||
    sourceTransaction.company_name ||
    sourceTransaction.client_name ||
    project.company_name ||
    project.client_name ||
    ''
  ).trim();
  const description = String(
    sourceTransaction.description ||
    sourceTransaction.desc ||
    project.description ||
    project.project_name ||
    ''
  ).trim();
  const checkno = String(sourceTransaction.checkno || project.checkno || project.source_checkno || '').trim();
  const pono = String(sourceTransaction.pono || project.pono || project.source_pono || '').trim();
  const qty = Number(sourceTransaction.qty || getProjectQuantity(project) || 1) || 1;
  const unitPrice = Number(sourceTransaction.unitprice || getProjectUnitCostValue(project) || 0) || 0;
  const amount = Number(sourceTransaction.amount || getProjectAmountValue(project) || 0) || 0;
  const downpayment = Number(sourceTransaction.downpayment ?? paymentSummary.downpayment ?? 0) || 0;

  setValue('f-client', clientName);
  setValue('f-type', String(sourceTransaction.type || 'invoice'));
  setValue('f-status', String(sourceTransaction.status || paymentSummary.status || 'unpaid'));
  setValue('f-desc', description);
  setValue('f-checkno', checkno);
  setValue('f-pono', pono);
  setValue('f-qty', String(qty || 1));
  setValue('f-unitprice', unitPrice ? String(unitPrice) : '');
  setValue('f-amount', amount ? String(amount) : '');
  setValue('f-downpayment', String(downpayment));

  updateBalance();
}

function getProjectCompanyInputValue() {
  const select = document.getElementById('p-company-select');
  return String(select?.value || '').trim();
}

function getProjectCompanyNameFromSelection(companyId) {
  const record = findRegistryCompanyById(companyId);
  if (record?.company_name) return record.company_name;
  const byNo = findRegistryCompanyByNo(companyId);
  if (byNo?.company_name) return byNo.company_name;
  const byName = findRegistryCompanyByName(companyId);
  return byName?.company_name || '';
}

function setDashboardCompanyFilter(value = 'all') {
  const nextValue = normalizeDashboardCompanyName(value);
  currentDashboardCompany = nextValue;
  localStorage.setItem('kinaadman_dashboardCompany', nextValue);
  syncDashboardCompanyFilterOptions();
  renderProjectRecordsTable();
  if (currentDashboardPanel === 'total-projects') {
    renderTable();
  } else {
    renderProjectMasterTable();
  }
  renderOngoingProjects();
  renderDashboardAnalytics(getDashboardInvoiceRows());
  renderInvoiceStatusQuickView(getDashboardInvoiceRows());
  if (typeof updateStats === 'function') {
    updateStats();
  }
}

function getDashboardInvoiceRows(records = allTransactionsDb) {
  return getInvoiceRows(records).filter(row => companyMatchesDashboardFilter(getDashboardCompanyNameForRecord(row)));
}

function getProjectSourceMembers(project) {
  return [
    { name: project?.project_members || project?.source_member_name, role: project?.member_role || project?.source_member_role, phone: project?.member_phone || project?.source_member_phone },
    { name: project?.project_members_2 || project?.source_member_name_2, role: project?.member_role_2 || project?.source_member_role_2, phone: project?.member_phone_2 || project?.source_member_phone_2 },
    { name: project?.project_members_3 || project?.source_member_name_3, role: project?.member_role_3 || project?.source_member_role_3, phone: project?.member_phone_3 || project?.source_member_phone_3 }
  ];
}

function formatProjectMemberSummary(member, index) {
  const name = String(member?.name || '').trim();
  const role = String(member?.role || '').trim();
  const phone = String(member?.phone || '').trim();
  if (!name && !role && !phone) return '';

  const pieces = [];
  if (name) pieces.push(`<strong>${escHtml(name)}</strong>`);
  if (role) pieces.push(`<span style="color:var(--muted);">Role: ${escHtml(role)}</span>`);
  if (phone) pieces.push(`<span style="color:var(--muted);">Phone: ${escHtml(phone)}</span>`);

  return `
    <div style="margin-bottom: 4px; line-height: 1.35;">
      <span style="color:var(--muted); font-size:0.72rem;">${index + 1}.</span>
      <span style="font-size:0.76rem;">${pieces.join(' &nbsp;|&nbsp; ')}</span>
    </div>
  `;
}

async function toggleProjectArchive(projectId, archive = true) {
  const id = Number(projectId || 0);
  if (!id) return;

  const verb = archive ? 'archive' : 'restore';
  const prompt = archive
    ? 'Archive this project? It will move to Archived Projects.'
    : 'Restore this project back to Project Transactions?';
  if (!confirm(prompt)) return;

  try {
    const res = await fetch(`/api/projects/${id}/${verb}`, { method: 'PUT' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Unable to ${verb} project.`);
    await loadProjectsDashboardData();
    showToast(archive ? 'Project archived.' : 'Project restored.', 'success');
  } catch (err) {
    showToast(err.message || `Unable to ${verb} project.`, 'error');
  }
}

function renderProjectMasterTable() {
  const tbody = document.getElementById('project-table-body');
  if (!tbody) return;
  const rawQuery = String(document.getElementById('project-search-input')?.value || '').trim();
  const q = rawQuery.toLowerCase();
  const lifecycleFilter = String(document.getElementById('project-lifecycle-filter')?.value || 'all').toLowerCase();

  const list = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
    .map(project => ({ ...project, lifecycle: getProjectLifecycleLabel(project) }))
    .filter(project => {
      const isArchived = Number(project.is_archived || 0) === 1;
      if (lifecycleFilter === 'archived') return isArchived;
      if (lifecycleFilter === 'all') return !isArchived;
      if (isArchived) return false;
      return project.lifecycle === lifecycleFilter;
    })
    .filter(project => companyMatchesDashboardFilter(getProjectCompanyName(project)))
    .filter(project => {
      if (!q) return true;
      return [
        project.project_docno || '',
        project.company_no || project.registry_company_no || '',
        project.company_name || project.registry_company_name || '',
        project.project_name || '',
        project.project_ar_invoice_no || '',
        project.project_ap_bill_no || '',
        project.source_docno || '',
        project.client_name || project.source_client || '',
        project.checkno || project.source_checkno || '',
        project.pono || project.source_pono || '',
        project.members || '',
        project.description || '',
        project.project_members || project.source_member_name || '',
        project.member_role || project.source_member_role || '',
        project.member_phone || project.source_member_phone || '',
        project.project_members_2 || project.source_member_name_2 || '',
        project.member_role_2 || project.source_member_role_2 || '',
        project.member_phone_2 || project.source_member_phone_2 || '',
        project.project_members_3 || project.source_member_name_3 || '',
        project.member_role_3 || project.source_member_role_3 || '',
        project.member_phone_3 || project.source_member_phone_3 || '',
        project.unit_cost || '',
        project.status || '',
        project.lifecycle || ''
      ].join(' ').toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const aDate = formatDateYmd(getProjectEffectiveStartDate(a));
      const bDate = formatDateYmd(getProjectEffectiveStartDate(b));
      return String(aDate).localeCompare(String(bDate));
    });

  if (!list.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="17">No projects found.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((project) => {
    const paymentSummary = getProjectPaymentSummary(project);
    const paymentStatusLabel = paymentSummary.status === 'paid' ? 'Paid' : paymentSummary.status === 'partial' ? 'Partial' : 'Unpaid';
    const paymentStatusClass = `status-${paymentSummary.status}`;
    const startText = formatDateYmd(project.start_date || project.planned_start_date || getProjectEffectiveStartDate(project));
    const endText = formatDateYmd(project.end_date || project.planned_end_date || getProjectEffectiveEndDate(project));
    const companyName = String(getProjectCompanyName(project) || '-').trim() || '-';
    const checkNo = String(project.checkno || project.source_checkno || '-').trim() || '-';
    const customerPoRef = String(project.pono || project.source_pono || '-').trim() || '-';
    const projectDocNo = String(project.project_docno || project.source_docno || '-').trim() || '-';
    const arInvoiceNo = String(getProjectArInvoiceNo(project) || '-').trim() || '-';
    const apBillNo = String(getProjectApBillNo(project) || '-').trim() || '-';
    const qtyValue = getProjectQuantity(project);
    const qtyText = qtyValue > 0 ? String(qtyValue) : '-';
    const unitCostValue = getProjectUnitCostValue(project);
    const unitCostText = formatPhpCurrency(unitCostValue);
    const downpaymentText = formatPhpCurrency(paymentSummary.downpayment);
    const amountText = formatPhpCurrency(paymentSummary.amount);
    const description = String(project.description || project.source_transaction_description || '-').trim() || '-';
    const sourceMembers = getProjectSourceMembers(project);
    const memberHtml = sourceMembers.map(formatProjectMemberSummary).filter(Boolean).join('') || '<div style="color:var(--muted); font-size:0.76rem;">-</div>';
    const isArchived = Number(project.is_archived || 0) === 1;

    return `
      <tr>
        <td style="padding: 15px 20px; font-size: 0.84rem;">${highlight(projectDocNo, rawQuery)}</td>
        <td style="padding: 15px 20px; font-size: 0.84rem;">${highlight(companyName, rawQuery)}</td>
        <td style="padding: 15px 20px; font-size: 0.92rem;"><strong>${highlight(project.project_name || 'Untitled Project', rawQuery)}</strong></td>
        <td style="padding: 15px 20px; font-size: 0.84rem;">${highlight(arInvoiceNo, rawQuery)}</td>
        <td style="padding: 15px 20px; font-size: 0.84rem;">${highlight(apBillNo, rawQuery)}</td>
        <td style="padding: 15px 20px; font-size: 0.84rem;">${highlight(checkNo, rawQuery)}</td>
        <td style="padding: 15px 20px; font-size: 0.84rem;">${highlight(customerPoRef, rawQuery)}</td>
        <td style="padding: 15px 20px; font-size: 0.8rem; line-height: 1.35; max-width: 240px; white-space: normal;">${highlight(description, rawQuery)}</td>
        <td style="padding: 15px 20px; font-size: 0.76rem; line-height: 1.35; max-width: 300px; white-space: normal;">${memberHtml}</td>
        <td class="text-right" style="padding: 15px 20px; font-size: 0.84rem;">${highlight(unitCostText, rawQuery)}</td>
        <td class="text-right" style="padding: 15px 20px; font-size: 0.84rem;">${highlight(qtyText, rawQuery)}</td>
        <td class="text-right" style="padding: 15px 20px; font-size: 0.84rem;">${highlight(amountText, rawQuery)}</td>
        <td class="text-right" style="padding: 15px 20px; font-size: 0.84rem;">${highlight(downpaymentText, rawQuery)}</td>
        <td class="text-center" style="padding: 15px 20px;">
          <span class="status-pill ${paymentStatusClass}">${highlight(paymentStatusLabel || 'Unpaid', rawQuery)}</span>
        </td>
        <td class="text-center" style="padding: 15px 20px; font-size: 0.88rem;">${highlight(startText, rawQuery)}</td>
        <td class="text-center" style="padding: 15px 20px; font-size: 0.88rem;">${highlight(endText, rawQuery)}</td>
        <td class="text-center" style="padding: 15px 20px;">
          <div class="project-master-actions">
            <button class="btn btn-sm btn-edit" type="button" onclick="openProjectModal(${Number(project.id)})">Edit</button>
            <button class="btn btn-sm btn-add" type="button" onclick="openProjectRequisition(${Number(project.id)})">Add PR</button>
            ${project.pdfFilename
              ? `<button class="btn btn-sm btn-pdf" type="button" onclick="openProjectPdfViewer(${Number(project.id)})">View PDF</button>`
              : `<span class="pdf-empty">N/A</span>`}
            ${isArchived
              ? `<button class="btn btn-sm btn-restore" type="button" onclick="toggleProjectArchive(${Number(project.id)}, false)" title="Restore Project">Restore</button>`
              : `<button class="btn btn-sm btn-archive" type="button" onclick="toggleProjectArchive(${Number(project.id)}, true)" title="Archive Project">Archive</button>`}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderProjectRecordsTable() {
  const tbody = document.getElementById('project-records-table-body');
  if (!tbody) return;

  const rawQuery = String(document.getElementById('project-records-search-input')?.value || '').trim();
  const q = rawQuery.toLowerCase();

  const list = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
    .filter(project => companyMatchesDashboardFilter(getProjectCompanyName(project)))
    .filter(project => {
      if (!q) return true;
      return [
        project.project_docno || '',
        project.project_name || '',
        project.company_name || project.registry_company_name || '',
        project.company_no || project.registry_company_no || ''
      ].join(' ').toLowerCase().includes(q);
    })
    .sort((a, b) => String(b.project_docno || '').localeCompare(String(a.project_docno || '')));

  if (!list.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">No project records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((project) => {
    const projectDocNo = String(project.project_docno || project.source_docno || '-').trim() || '-';
    const projectTitle = String(project.project_name || 'Untitled Project').trim() || 'Untitled Project';
    const companyName = String(getProjectCompanyName(project) || '-').trim() || '-';
    const startDate = formatDateYmd(project.start_date || project.planned_start_date || '') || '-';
    const endDate = formatDateYmd(project.end_date || project.planned_end_date || '') || '-';
    const isArchived = Number(project.is_archived || 0) === 1;

    return `
      <tr>
        <td style="padding: 15px 20px; font-size: 0.85rem;">${highlight(projectDocNo, rawQuery)}</td>
        <td style="padding: 15px 20px; font-size: 0.92rem;"><strong>${highlight(projectTitle, rawQuery)}</strong></td>
        <td style="padding: 15px 20px; font-size: 0.85rem;">${highlight(companyName, rawQuery)}</td>
        <td class="text-center" style="padding: 15px 20px; font-size: 0.85rem;">${highlight(startDate, rawQuery)}</td>
        <td class="text-center" style="padding: 15px 20px; font-size: 0.85rem;">${highlight(endDate, rawQuery)}</td>
        <td class="text-center" style="padding: 15px 20px;">
          <div class="project-master-actions">
            <button class="btn btn-sm btn-edit" type="button" onclick="openProjectModal(${Number(project.id)})">Edit</button>
            <button class="btn btn-sm btn-add" type="button" onclick="openProjectRequisition(${Number(project.id)})">Add PR</button>
            ${isArchived
              ? `<button class="btn btn-sm btn-restore" type="button" onclick="toggleProjectArchive(${Number(project.id)}, false)" title="Restore Project">Restore</button>`
              : `<button class="btn btn-sm btn-archive" type="button" onclick="toggleProjectArchive(${Number(project.id)}, true)" title="Archive Project">Archive</button>`}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function formatCompactCurrency(value) {
  const amount = Number(value || 0);
  if (amount >= 1000000) return `PHP ${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) {
    const compact = (amount / 1000).toFixed(amount >= 10000 ? 0 : 1).replace(/\.0$/, '');
    return `PHP ${compact}k`;
  }
  return `PHP ${amount.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
}

function normalizeTransactionStatusValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['paid', 'partial', 'unpaid'].includes(normalized) ? normalized : '';
}

function getTransactionPaidAmountValue(row) {
  const amount = Number(row?.amount || 0);
  const receivablePaidAmount = Number(row?.receivable_paid_amount || row?.paid_amount || 0);
  const downpayment = Number(row?.downpayment || 0);
  const source = String(row?.source || '').toLowerCase();

  if (source === 'receivable') {
    if (amount > 0 && receivablePaidAmount >= amount) {
      return amount;
    }
    if (receivablePaidAmount > 0) {
      return Math.min(amount, receivablePaidAmount);
    }
    if (downpayment > 0) {
      return Math.min(amount, downpayment);
    }
    return 0;
  }

  if (amount > 0 && receivablePaidAmount >= amount) {
    return amount;
  }
  if (receivablePaidAmount > 0) {
    return Math.min(amount, receivablePaidAmount);
  }
  return 0;
}

function buildDashboardMonthlySeries(records, months = 6) {
  const now = new Date();
  const series = [];

  const span = Math.max(6, Math.min(12, Number(months) || 6));

  for (let offset = span - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    series.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: date.toLocaleString('en-US', { month: 'short' }).toUpperCase(),
      year: String(date.getFullYear()),
      invoices: 0,
      collected: 0,
      gross: 0
    });
  }

  const byKey = new Map(series.map(item => [item.key, item]));

  records
    .filter(record => String(record.type || '').toLowerCase() === 'invoice')
    .forEach(record => {
      const date = toDateOnly(record.date);
      if (!date) return;

      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const bucket = byKey.get(key);
      if (!bucket) return;

      const amount = parseFloat(record.amount) || 0;
      const paid = getTransactionPaidAmountValue(record);
      bucket.gross += amount;
      bucket.invoices += Math.max(0, amount - paid);
      bucket.collected += Math.min(amount, paid);
    });

  return series;
}

function buildDashboardAxisTicks(maxValue, steps = 4) {
  const safeMax = Math.max(1, Number(maxValue) || 1);
  const tickCount = Math.max(2, Number(steps) || 4);
  const tickSize = safeMax / tickCount;

  const ticks = [];
  for (let index = tickCount; index >= 0; index -= 1) {
    const value = Math.round(tickSize * index);
    ticks.push({
      value,
      label: formatCompactCurrency(value)
    });
  }

  return ticks;
}

function setDashboardBarRange(months = 6) {
  dashboardBarRange = Math.max(6, Math.min(12, Number(months) || 6));
  document.querySelectorAll('.dashboard-range-btn').forEach((btn) => {
    const active = Number(btn.getAttribute('data-range')) === dashboardBarRange;
    btn.classList.toggle('is-active', active);
  });
  renderDashboardAnalytics(getDashboardInvoiceRows());
}

function renderDashboardBarChart(records = getDashboardInvoiceRows(), months = dashboardBarRange) {
  const mount = document.getElementById('dashboard-bar-chart');
  if (!mount) return;

  const series = buildDashboardMonthlySeries(records, months);
  const maxValue = Math.max(1, ...series.flatMap(item => [item.invoices, item.collected]));
  const chartMax = Math.max(1, Math.ceil(maxValue * 1.12));
  const ticks = buildDashboardAxisTicks(chartMax, 4);
  const spansYears = new Set(series.map(item => item.year)).size > 1;

  mount.style.setProperty('--dashboard-series-count', String(series.length));
  mount.style.setProperty('--dashboard-grid-steps', String(Math.max(1, ticks.length - 1)));

  mount.innerHTML = `
    <div class="dashboard-bar-shell">
      <div class="dashboard-bar-axis" aria-hidden="true">
        ${ticks.map(tick => `<span>${escHtml(tick.label)}</span>`).join('')}
      </div>
      <div class="dashboard-bar-area">
        <div class="dashboard-bar-grid"></div>
        <div class="dashboard-bar-track">
          ${series.map((item, index) => {
            const invoiceHeight = Math.max(8, Math.round((item.invoices / chartMax) * 100));
            const collectedHeight = Math.max(8, Math.round((item.collected / chartMax) * 100));
            const smallLabel = spansYears ? item.year : '';

            return `
              <div class="dashboard-bar-group" style="--bar-delay:${index * 90}ms;">
                <div class="dashboard-bar-pair">
                  <div
                    class="dashboard-bar dashboard-bar-invoice"
                    style="height:${invoiceHeight}%;"
                    data-value="${escHtml(formatCompactCurrency(item.invoices))}"
                    data-tip="A/R: ${escHtml(formatCompactCurrency(item.invoices))}"
                  ></div>
                  <div
                    class="dashboard-bar dashboard-bar-collected"
                    style="height:${collectedHeight}%;"
                    data-value="${escHtml(formatCompactCurrency(item.collected))}"
                    data-tip="Collected: ${escHtml(formatCompactCurrency(item.collected))}"
                  ></div>
                </div>
                <div class="dashboard-bar-label">
                  <span>${escHtml(item.label)}</span>
                  <small>${escHtml(smallLabel)}</small>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;

  const bestMonth = series.reduce((best, item) => item.collected > (best?.collected || 0) ? item : best, null);
  const totalGross = series.reduce((sum, item) => sum + item.gross, 0);
  const totalCollected = series.reduce((sum, item) => sum + item.collected, 0);
  const collectionRate = totalGross > 0 ? Math.round((totalCollected / totalGross) * 100) : 0;
  const unpaidCount = records.filter(record => getDashboardInvoiceStatus(record) === 'unpaid').length;

  const bestMonthEl = document.getElementById('insight-best-month');
  const collectionRateEl = document.getElementById('insight-collection-rate');
  const unpaidCountEl = document.getElementById('insight-unpaid-count');

  if (bestMonthEl) {
    bestMonthEl.textContent = bestMonth && bestMonth.collected > 0
      ? `${bestMonth.label} - ${formatCompactCurrency(bestMonth.collected)}`
      : 'No collections yet';
  }
  if (collectionRateEl) collectionRateEl.textContent = `${collectionRate}%`;
  if (unpaidCountEl) unpaidCountEl.textContent = String(unpaidCount);
}

function renderDashboardPieChart(records = getDashboardInvoiceRows()) {
  const chart = document.getElementById('dashboard-donut-chart');
  const legend = document.getElementById('dashboard-pie-legend');
  const totalEl = document.getElementById('dashboard-donut-total');
  if (!chart || !legend || !totalEl) return;

  const invoices = records.filter(record => String(record.type || '').toLowerCase() === 'invoice');
  const totals = { paid: 0, partial: 0, unpaid: 0 };

  invoices.forEach(record => {
    const status = getDashboardInvoiceStatus(record);
    if (status === 'paid') totals.paid += 1;
    else if (status === 'partial') totals.partial += 1;
    else totals.unpaid += 1;
  });

  const total = invoices.length;
  totalEl.textContent = String(total);

  if (!total) {
    chart.style.background = 'conic-gradient(#d7d2c8 0 360deg)';
    legend.innerHTML = '<span><i class="legend-dot legend-dot-primary"></i>No invoice data yet</span>';
    return;
  }

  const paidDeg = (totals.paid / total) * 360;
  const partialDeg = (totals.partial / total) * 360;

  chart.style.background = `conic-gradient(
    #fca5a5 0deg ${paidDeg}deg,
    #ef4444 ${paidDeg}deg ${paidDeg + partialDeg}deg,
    #991b1b ${paidDeg + partialDeg}deg 360deg
  )`;

  legend.innerHTML = `
    <span><i class="legend-dot legend-dot-success"></i>Paid ${totals.paid}</span>
    <span><i class="legend-dot legend-dot-warning"></i>Partial ${totals.partial}</span>
    <span><i class="legend-dot legend-dot-danger"></i>Unpaid ${totals.unpaid}</span>
  `;
}

function renderDashboardAnalytics(records = getDashboardInvoiceRows()) {
  renderDashboardBarChart(records, dashboardBarRange);
  renderDashboardPieChart(records);
}

function getInvoiceRows(records = allTransactionsDb) {
  const invoiceRows = (Array.isArray(records) ? records : [])
    .filter(r => String(r.type || '').toLowerCase() === 'invoice')
    .map(row => ({
      ...row,
      source: String(row?.source || 'transaction').toLowerCase() === 'receivable' ? 'receivable' : 'transaction',
      transaction_id: Number(row?.transaction_id || row?.id || 0) || null
    }));
  const receivableRows = (Array.isArray(allReceivablesDb) ? allReceivablesDb : []).map(row => ({
    type: 'invoice',
    source: 'receivable',
    docno: row.invoice_number || row.project_docno || '',
    customer: row.customer_name || '',
    amount: Number(row.total_amount || 0),
    downpayment: Number(row.paid_amount || 0),
    status: row.status || 'draft',
    project_docno: row.project_docno || '',
    project_id: row.project_id || null,
    transaction_id: Number(row.transaction_id || 0) || null
  }));
  const combined = [...invoiceRows, ...receivableRows];
  const seenKeys = new Set();

  return combined.filter((row, index) => {
    const transactionId = Number(row?.transaction_id || 0) || 0;
    const key = transactionId
      ? `tx:${transactionId}`
      : `inv:${String(
        row?.invoice_number ||
        row?.docno ||
        row?.project_docno ||
        ''
      ).trim().toLowerCase()}`;
    if (key === 'inv:') {
      return true;
    }
    if (seenKeys.has(key)) {
      return false;
    }
    seenKeys.add(key);
    return true;
  });
}

function getDashboardInvoiceRows(records = allTransactionsDb) {
  return getInvoiceRows(records).filter(row => companyMatchesDashboardFilter(getDashboardCompanyNameForRecord(row)));
}

function getComputedTransactionPaymentStatus(row) {
  const amount = Number(row?.amount || 0);
  const paid = getTransactionPaidAmountValue(row);
  if (amount > 0 && (amount - paid) <= 0) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

function getDashboardInvoiceStatus(row) {
  if (String(row?.source || '').toLowerCase() === 'receivable') {
    const amount = Number(row?.amount || 0);
    const paid = Number(row?.receivable_paid_amount || row?.paid_amount || row?.downpayment || 0);
    if (amount > 0 && paid >= amount) return 'paid';
    if (paid > 0) return 'partial';
    return 'unpaid';
  }
  return getComputedTransactionPaymentStatus(row);
}

function setInvoiceStatusView(status = 'paid') {
  const allowed = ['paid', 'partial', 'unpaid'];
  invoiceStatusView = allowed.includes(String(status)) ? String(status) : 'paid';
  renderInvoiceStatusQuickView();
}

function renderInvoiceStatusQuickView(records = getDashboardInvoiceRows()) {
  const invoiceRows = Array.isArray(records) ? records : getDashboardInvoiceRows();
  const statusCounts = { paid: 0, partial: 0, unpaid: 0 };

  invoiceRows.forEach(row => {
    const status = getDashboardInvoiceStatus(row);
    const key = statusCounts.hasOwnProperty(status) ? status : 'unpaid';
    statusCounts[key] += 1;
  });

  const countIds = {
    paid: 'status-count-paid',
    partial: 'status-count-partial',
    unpaid: 'status-count-unpaid'
  };

  Object.keys(countIds).forEach((key) => {
    const countEl = document.getElementById(countIds[key]);
    if (countEl) countEl.textContent = String(statusCounts[key] || 0);
  });

  const cards = document.querySelectorAll('#invoice-status-cards .status-mini-card');
  cards.forEach((card) => {
    const key = String(card.getAttribute('data-status') || '').toLowerCase();
    card.classList.toggle('is-active', key === invoiceStatusView);
  });

  const summaryEl = document.getElementById('invoice-status-summary');
  if (summaryEl) {
    summaryEl.textContent = `Paid ${statusCounts.paid} | Partial ${statusCounts.partial} | Unpaid ${statusCounts.unpaid}`;
  }
}

function toDateOnly(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function formatDateYmd(value) {
  const date = toDateOnly(value);
  if (!date) return '-';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getProjectTimelineDates(project) {
  return {
    plannedStart: toDateOnly(project?.planned_start_date || project?.start_date),
    plannedEnd: toDateOnly(project?.planned_end_date || project?.end_date),
    actualStart: toDateOnly(project?.actual_start_date),
    actualEnd: toDateOnly(project?.actual_end_date)
  };
}

function getProjectEffectiveStartDate(project) {
  const timeline = getProjectTimelineDates(project);
  return timeline.actualStart || timeline.plannedStart;
}

function getProjectEffectiveEndDate(project) {
  const timeline = getProjectTimelineDates(project);
  return timeline.actualEnd || timeline.plannedEnd;
}

function getProjectPhase(project) {
  const status = String(project?.status || '').toLowerCase();
  if (status === 'cancelled') return 'closed';
  if (status === 'completed') return 'closed';
  if (status === 'on_hold') return 'paused';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = getProjectEffectiveStartDate(project);
  const end = getProjectEffectiveEndDate(project);

  if (start && today < start) return 'upcoming';
  if (end && today > end) return 'ended';
  return 'ongoing';
}

function isProjectOngoing(project) {
  if (!project) return false;

  return Number(project.is_archived || 0) === 0 &&
    getProjectPhase(project) === 'ongoing';
}

function getProjectLifecycleLabel(project) {
  if (!project) return '';

  const status = String(project.status || '').toLowerCase();
  const phase = getProjectPhase(project);

  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'on_hold') return 'on_hold';
  if (phase === 'upcoming') return 'upcoming';
  if (phase === 'ended') return 'overdue';
  if (phase === 'paused') return 'on_hold';
  return 'ongoing';
}

function getProjectLifecycleClass(project) {
  const label = getProjectLifecycleLabel(project);
  return `status-${label.replace(/_/g, '-')}`;
}

function getComputedProjectPriority(project) {
  const status = String(project?.status || '').trim().toLowerCase();
  if (status === 'draft' || status === 'completed' || status === 'cancelled' || project?.actual_end_date) return 'low';

  const end = toDateOnly(project?.planned_end_date || project?.end_date);
  if (!end) return 'medium';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysLeft = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysLeft < 0) return 'urgent';
  if (daysLeft <= 3) return 'urgent';
  if (daysLeft <= 7) return 'high';
  if (daysLeft <= 14) return 'medium';
  return 'low';
}

function findSourceTransactionForProject(project) {
  if (!project) return null;

  const transactions = Array.isArray(allTransactionsDb) ? allTransactionsDb : [];
  const transactionId = Number(project.transaction_id || 0);
  if (transactionId) {
    const byTransactionId = transactions.find(entry => Number(entry.id || 0) === transactionId);
    if (byTransactionId) return byTransactionId;
  }

  const sourceDocno = String(project.source_docno || '').trim().toLowerCase();
  if (!sourceDocno) return null;

  return transactions.find(entry => String(entry.docno || '').trim().toLowerCase() === sourceDocno) || null;
}

function getProjectPaymentStatus(project) {
  if (!project) return '';

  return getProjectPaymentSummary(project).status;
}

function getProjectPaymentStatusLabel(project) {
  const status = getProjectPaymentStatus(project);
  if (status === 'paid') return 'Paid';
  if (status === 'partial') return 'Partial';
  if (status === 'unpaid') return 'Unpaid';
  return '';
}

function getProjectPaymentStatusClass(project) {
  const status = getProjectPaymentStatus(project);
  return status ? `status-${status}` : '';
}

function getProjectAmountValue(projectOrValues = {}) {
  const safeValues = projectOrValues && typeof projectOrValues === 'object' ? projectOrValues : {};
  const sourceTransaction = safeValues.project_name
    ? findSourceTransactionForProject(safeValues)
    : null;
  const receivableAmount = Number(
    safeValues.receivable_total_amount ??
    safeValues.ar_total_amount ??
    0
  );
  if (Number.isFinite(receivableAmount) && receivableAmount > 0) return receivableAmount;

  const qty = Number(
    safeValues.qty ?? 
    safeValues.source_qty ?? 
    sourceTransaction?.qty ??
    0
  );
  const unitCost = Number(
    safeValues.unit_cost ??
    safeValues.source_unit_cost ??
    safeValues.source_unitprice ??
    sourceTransaction?.unitprice ??
    0
  );
  const derivedAmount = qty > 0 && unitCost > 0 ? qty * unitCost : 0;
  const explicitAmount = Number(
    safeValues.amount ??
    safeValues.budget ??
    safeValues.source_amount ??
    sourceTransaction?.amount ??
    0
  );

  if (Number.isFinite(explicitAmount) && explicitAmount > 0) return explicitAmount;
  if (Number.isFinite(derivedAmount) && derivedAmount > 0) return derivedAmount;
  return 0;
}

function getProjectUnitCostValue(projectOrValues = {}) {
  const safeValues = projectOrValues && typeof projectOrValues === 'object' ? projectOrValues : {};
  const sourceTransaction = safeValues.project_name
    ? findSourceTransactionForProject(safeValues)
    : null;
  const qty = Number(
    safeValues.qty ??
    safeValues.source_qty ??
    sourceTransaction?.qty ??
    0
  );
  const unitCost = Number(
    safeValues.unit_cost ??
    safeValues.source_unit_cost ??
    safeValues.source_unitprice ??
    sourceTransaction?.unitprice ??
    0
  );
  if (Number.isFinite(unitCost) && unitCost > 0) return unitCost;

  const amount = getProjectAmountValue(safeValues);
  if (qty > 0 && amount > 0) return amount / qty;

  return 0;
}

function getProjectPaymentSummary(projectOrValues = {}) {
  const safeValues = projectOrValues && typeof projectOrValues === 'object' ? projectOrValues : {};
  const sourceTransaction = safeValues.project_name
    ? findSourceTransactionForProject(safeValues)
    : null;

  const amount = getProjectAmountValue(safeValues);
  const receivablePaid = Number(
    safeValues.receivable_paid_amount ??
    safeValues.ar_paid_amount ??
    0
  );
  const receivableStatus = String(
    safeValues.receivable_status ??
    safeValues.ar_status ??
    ''
  ).toLowerCase();
  const downpayment = Number(
    safeValues.downpayment ??
    safeValues.source_downpayment ??
    sourceTransaction?.downpayment ??
    0
  );
  const paidAmount = receivablePaid > 0 ? receivablePaid : downpayment;
  const balance = Math.max(0, amount - paidAmount);

  let status = 'unpaid';
  if (amount > 0 && balance <= 0) {
    status = 'paid';
  } else if (paidAmount > 0) {
    status = 'partial';
  }
  if (receivableStatus === 'overdue' && status === 'unpaid') {
    status = 'unpaid';
  }

  return { amount, downpayment: paidAmount, balance, status };
}

function getProjectQuantity(project) {
  if (!project) return 0;

  const sourceTransaction = findSourceTransactionForProject(project);
  const qty = Number(
    project.qty ??
    sourceTransaction?.qty ??
    project.source_qty ??
    0
  );

  return Number.isFinite(qty) && qty > 0 ? qty : 0;
}

function updateProjectPaymentDisplay() {
  const qtyEl = document.getElementById('p-qty');
  const unitCostEl = document.getElementById('p-unit-cost');
  const amountEl = document.getElementById('p-budget');
  const downpaymentEl = document.getElementById('p-downpayment');
  const balanceEl = document.getElementById('p-balance-display');
  const statusEl = document.getElementById('p-payment-status-display');

  const qty = parseFloat(qtyEl?.value) || 0;
  const unitCost = parseFloat(unitCostEl?.value) || 0;
  const storedAmount = parseFloat(amountEl?.value) || 0;
  let amount = storedAmount;
  if (qty > 0 && unitCost > 0) {
    amount = qty * unitCost;
  } else if (qty > 0 || unitCost > 0) {
    amount = 0;
  }
  const downpayment = parseFloat(downpaymentEl?.value) || 0;
  const balance = Math.max(0, amount - downpayment);
  const status = amount > 0 && balance <= 0 ? 'paid' : (downpayment > 0 ? 'partial' : 'unpaid');
  const statusLabel = status === 'paid' ? 'Paid' : status === 'partial' ? 'Partial' : 'Unpaid';

  if (amountEl) {
    amountEl.value = amount > 0 ? amount.toFixed(2) : '';
  }

  if (balanceEl) {
    balanceEl.textContent = 'PHP ' + balance.toLocaleString('en-PH', { minimumFractionDigits: 2 });
  }

  if (statusEl) {
    statusEl.textContent = statusLabel;
    statusEl.className = `status-pill status-${status}`;
    statusEl.style.display = 'inline-flex';
  }

  return { amount, downpayment, balance, status, qty, unitCost };
}

function getProjectStatusFilterValue() {
  const filter = document.getElementById('project-status-filter');
  const value = String(filter?.value || 'all').toLowerCase();
  return ['all', 'ongoing', 'upcoming', 'archived', 'completed', 'overdue', 'cancelled'].includes(value)
    ? value
    : 'all';
}

function getRecordProjectFilterLabel(record) {
  const project = findProjectForRecord(record);
  if (project) return getProjectLifecycleLabel(project);
  return String(record?.status || '').toLowerCase();
}

function setOngoingProjectsView(mode = 'ongoing') {
  const normalized = ['ongoing', 'upcoming', 'all'].includes(String(mode)) ? String(mode) : 'ongoing';
  ongoingProjectsViewMode = normalized;
  const filter = document.getElementById('ongoing-filter');
  if (filter) filter.value = normalized;
  renderOngoingProjects();
}

function renderOngoingProjects() {
  const tbody = document.getElementById('ongoing-projects-body');
  if (!tbody) return;

  const ongoingSearch = document.getElementById('ongoing-search');
  const q = String(ongoingSearch ? ongoingSearch.value : '').trim().toLowerCase();
  const ongoingFilter = document.getElementById('ongoing-filter');
  const viewMode = ['ongoing', 'upcoming', 'all'].includes(String(ongoingFilter?.value || ongoingProjectsViewMode))
    ? String(ongoingFilter?.value || ongoingProjectsViewMode)
    : 'ongoing';
  ongoingProjectsViewMode = viewMode;

  const visibleProjects = projectsDashboardDb
    .filter(project => Number(project.is_archived || 0) === 0)
    .map(project => ({ ...project, phase: getProjectPhase(project) }))
    .filter(project => project.phase !== 'closed')
    .filter(project => companyMatchesDashboardFilter(getProjectCompanyName(project)))
    .filter(project => {
      if (!q) return true;

      return [
        project.project_name || '',
        project.project_manager || '',
        project.source_docno || '',
        project.description || '',
        project.members || '',
        formatDateYmd(getProjectEffectiveStartDate(project)),
        formatDateYmd(getProjectEffectiveEndDate(project)),
        project.status || '',
        project.phase || ''
      ].join(' ').toLowerCase().includes(q);
    });

  const ongoingProjects = visibleProjects.filter(project => project.phase === 'ongoing');
  const upcomingProjects = visibleProjects
    .filter(project => project.phase === 'upcoming')
    .sort((a, b) => String(formatDateYmd(getProjectEffectiveStartDate(a))).localeCompare(String(formatDateYmd(getProjectEffectiveStartDate(b)))));
  const list = viewMode === 'upcoming'
    ? upcomingProjects
    : viewMode === 'all'
      ? [...ongoingProjects, ...upcomingProjects].sort((a, b) => String(formatDateYmd(getProjectEffectiveStartDate(a))).localeCompare(String(formatDateYmd(getProjectEffectiveStartDate(b)))))
      : ongoingProjects;

  if (!list.length) {
    if (viewMode === 'upcoming') {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="9">${q ? 'Walang upcoming projects na nahanap.' : 'Walang upcoming projects sa ngayon.'} <button class="btn btn-sm btn-edit" type="button" onclick="setOngoingProjectsView('ongoing')">Show Ongoing</button></td></tr>`;
      return;
    }

    const upcomingBtn = upcomingProjects.length
      ? ` <button class="btn btn-sm btn-edit" type="button" onclick="setOngoingProjectsView('upcoming')">Show Upcoming (${upcomingProjects.length})</button>`
      : '';

    tbody.innerHTML = `<tr class="empty-row"><td colspan="9">${q ? 'Walang ongoing projects na nahanap.' : 'Walang active ongoing projects sa ngayon.'}${upcomingBtn}</td></tr>`;
    return;
  }

  const noticeRow = viewMode === 'upcoming'
    ? `<tr class="empty-row"><td colspan="9">Showing upcoming projects. <button class="btn btn-sm btn-edit" type="button" onclick="setOngoingProjectsView('ongoing')">Back to Ongoing</button></td></tr>`
    : viewMode === 'all'
      ? `<tr class="empty-row"><td colspan="9">Showing all active projects. <button class="btn btn-sm btn-edit" type="button" onclick="setOngoingProjectsView('ongoing')">Show Ongoing Only</button></td></tr>`
    : '';

  tbody.innerHTML = noticeRow + list.map(project => {
    const lifecycleLabel = getProjectLifecycleLabel(project);
    const statusLabel = lifecycleLabel === 'on_hold'
      ? 'on hold'
      : (project.phase === 'upcoming' ? 'upcoming' : 'ongoing');
    const statusClass = lifecycleLabel === 'on_hold'
      ? 'status-on-hold'
      : (project.phase === 'upcoming' ? 'status-upcoming' : 'status-ongoing');
    const focusKey = project.project_name || project.source_docno || project.transaction_id || '';
    const lookupQuery = getProjectLookupQuery(project);
    const projectName = project.project_name || 'Untitled Project';
    const memberText = String(project.members || '-').trim() || '-';
    const managerText = String(project.project_manager || '-').trim() || '-';
    const budgetText = `PHP ${parseFloat(project.budget || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
    const startText = formatDateYmd(getProjectEffectiveStartDate(project));
    const endText = formatDateYmd(getProjectEffectiveEndDate(project));

    return `
    <tr style="height: 70px;">
      <td style="padding: 15px 20px; font-size: 0.95rem;"><strong>${highlight(projectName, q)}</strong></td>
      <td class="text-center" style="padding: 15px 20px; font-size: 0.95rem;">${highlight(managerText, q)}</td>
      <td style="padding: 15px 20px; font-size: 0.9rem;">${highlight(memberText, q)}</td>
      <td class="text-center" style="padding: 15px 20px; font-size: 0.95rem;">${escHtml(startText)}</td>
      <td class="text-center" style="padding: 15px 20px; font-size: 0.95rem;">${escHtml(endText)}</td>
      <td class="text-center" style="padding: 15px 20px; font-size: 0.95rem;">${Math.round(project.avg_progress || 0)}%</td>
      <td class="text-center" style="padding: 15px 20px; font-size: 0.95rem;"><span class="status-pill ${statusClass}">${highlight(statusLabel, q)}</span></td>
      <td class="text-right" style="padding: 15px 20px; font-size: 0.95rem;">${highlight(budgetText, q)}</td>
      <td class="text-center" style="padding: 15px 20px;">
        <button class="btn btn-sm btn-edit" type="button" onclick="openProjectInTotalProjects(${JSON.stringify(String(lookupQuery || focusKey))})">View</button>
      </td>
    </tr>
  `;
  }).join('');
}

function getProjectLookupQuery(project) {
  if (!project) return '';

  const sourceDocno = String(project.source_docno || '').trim();
  if (sourceDocno) return sourceDocno;

  const projectName = String(project.project_name || '').trim();
  if (!projectName) return String(project.transaction_id || '').trim();

  const parts = projectName.split(' - ').map(part => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return parts[parts.length - 1];
  }

  return projectName;
}

function findProjectForRecord(record) {
  if (!record) return null;

  const byProjectId = projectsDashboardDb.find(project =>
    Number(project.id || 0) === Number(record.project_id || 0)
  );
  if (byProjectId) return byProjectId;

  const byTransactionId = projectsDashboardDb.find(project =>
    Number(project.transaction_id || 0) === Number(record.id || 0)
  );
  if (byTransactionId) return byTransactionId;

  const targetName = `${record.client || ''} - ${record.docno || ''}`.trim().toLowerCase();
  return projectsDashboardDb.find(project =>
    String(project.project_name || '').trim().toLowerCase() === targetName
  ) || null;
}

async function doLogout() {
  const confirmed = await openConfirmDialog({
    title: 'Logout?',
    message: 'Maglo-logout ka na. Gusto mo bang ituloy?',
    noText: 'No',
    yesText: 'Yes'
  });
  if (!confirmed) return;
  localStorage.removeItem('kinaadman_activeTab');
  localStorage.removeItem('kinaadman_dashboardPanel');
  fetch('/logout', { method: 'POST' })
    .then(() => window.location.href = '/')
    .catch(() => window.location.href = '/');
}

let currentUser = null;
function checkUserRole() {
  fetch('/api/me')
    .then(r => r.json())
    .then(user => {
      currentUser = user;
      if (user?.csrfToken) {
        window.__CSRF_TOKEN__ = user.csrfToken;
      }
    });
}

let db = [];
let editingId = null;
let deletingId = null;
let hardDeleteId = null;
let viewingArchivedId = null;
let currentPage = 1;
let activeTab = 'all';
const PAGE_SIZE = 100; // Tinaasan para makita lahat dahil wala nang pagination
let stagedPdf = null;   // string (filename) or null
let stagedProjectPdf = null;
let usersDb = [];
let editingUserId = null;
let userModalMode = 'create';
let userModalSnapshot = null;
let userManagementView = 'approvals';
let isSavingRecord = false;
let projectsDashboardDb = [];
let allTransactionsDb = [];
let allReceivablesDb = [];
let companyRegistryDb = [];
let currentDashboardCompany = normalizeDashboardCompanyName(localStorage.getItem('kinaadman_dashboardCompany') || 'all') || 'all';
let logsDb = [];
let notificationsDb = [];
let notificationReadIds = new Set();
let invoiceStatusView = 'paid';
let dashboardBarRange = 6;
let currentDashboardPanel = 'home';
let ongoingProjectsViewMode = 'ongoing';
let recordsLoadSeq = 0;
let pendingTransactionProjectId = null;
let pendingTransactionLaunch = false;
let memberSlotVisibleCount = 1;
let resetPasswordUserId = null;
let resetPasswordUserLabel = '';
let editingProjectId = null;
let currentProjectStartDate = '';
let currentProjectEndDate = '';
let stagedProjectPdfDeleted = false;
let confirmDialogState = {
  resolver: null
};
let ganttPlannerState = {
  selectedProjectId: null,
  projectName: '',
  projectOwner: '',
  projectStart: '',
  projectEnd: '',
  notes: '',
  sourceName: 'Manual planner',
  rows: [],
  tasks: [],
  range: null,
  dirty: false
};
const externalScriptCache = new Map();

window.__CSRF_TOKEN__ = window.__CSRF_TOKEN__ || '';
if (!window.__CSRF_FETCH_PATCHED__) {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    try {
      const requestUrl = new URL(
        typeof input === 'string' ? input : (input?.url || String(input)),
        window.location.origin
      );
      const method = String(init.method || input?.method || 'GET').toUpperCase();
      const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
      const protectedPath = requestUrl.pathname.startsWith('/api/') || requestUrl.pathname === '/logout';

      if (mutating && protectedPath) {
        const headers = new Headers(init.headers || (input && input.headers) || {});
        const token = String(window.__CSRF_TOKEN__ || '').trim();
        if (token && !headers.has('X-CSRF-Token')) {
          headers.set('X-CSRF-Token', token);
        }
        init = { ...init, headers };
      }
    } catch (_) {}

    return nativeFetch(input, init);
  };
  window.__CSRF_FETCH_PATCHED__ = true;
}

function openModalRouter() {
  if (activeTab === 'users') return;
  else openModal();
}

function isAdminUser() {
  return currentUser && isAdminRoleValue(currentUser.role);
}

function isSuperAdminUser() {
  return currentUser && normalizeAccessRole(currentUser.role) === 'super_admin';
}

function isStaffUser() {
  return currentUser && normalizeAccessRole(currentUser.role) === 'staff';
}

function getNotificationReadStorageKey() {
  return 'kinaadman_notification_reads';
}

function loadNotificationReadState() {
  try {
    const raw = localStorage.getItem(getNotificationReadStorageKey());
    const parsed = raw ? JSON.parse(raw) : [];
    notificationReadIds = new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch (_) {
    notificationReadIds = new Set();
  }
}

function saveNotificationReadState() {
  try {
    const values = Array.from(notificationReadIds).slice(-250);
    localStorage.setItem(getNotificationReadStorageKey(), JSON.stringify(values));
  } catch (_) {}
}

function markNotificationsAsRead(ids = notificationsDb.map(item => item.id)) {
  const changed = [];
  for (const id of ids) {
    const key = String(id || '').trim();
    if (!key) continue;
    if (!notificationReadIds.has(key)) {
      notificationReadIds.add(key);
      changed.push(key);
    }
  }
  if (changed.length) {
    saveNotificationReadState();
  }
  return changed.length;
}

function getUnreadNotifications(items = notificationsDb) {
  return (Array.isArray(items) ? items : []).filter(item => !notificationReadIds.has(String(item?.id || '')));
}

function syncProjectSearchFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const searchValue = String(params.get('search') || '').trim();
    if (!searchValue) return;

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.value = searchValue;
    }

    const projectStatusFilter = document.getElementById('project-status-filter');
    if (projectStatusFilter) {
      projectStatusFilter.value = 'all';
    }

    renderTable();
  } catch (_) {}
}

function openNotificationItem(notificationId) {
  const item = notificationsDb.find(entry => String(entry?.id || '') === String(notificationId || ''));
  if (!item) return;

  markNotificationsAsRead([item.id]);
  loadNotifications();
  closeNotificationsPanel();

  if (String(item.type || '') === 'audit') {
    if (typeof openDashboardPanel === 'function') {
      openDashboardPanel('system-logs');
    }
    return;
  }

  const targetSearch = String(item.source_docno || item.title || '').trim();
  if (document.getElementById('total-projects-section')) {
    openProjectInTotalProjects(targetSearch);
    return;
  }

  const url = new URL('/admin', window.location.origin);
  url.searchParams.set('view', 'all');
  if (targetSearch) {
    url.searchParams.set('search', targetSearch);
  }
  window.location.href = url.toString();
}

function loadRecords() {
  const requestSeq = ++recordsLoadSeq;
  return fetch('/api/transactions')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => {
      if (requestSeq !== recordsLoadSeq) return;
      db = data;
      allTransactionsDb = Array.isArray(data) ? data : [];
      updateStats();
      renderTable();
      return loadProjectsDashboardData();
    })
    .catch(err => {
      console.error('Load error:', err);
      showToast('Hindi ma-load ang records: ' + err.message, 'error');
      const tbody = document.getElementById('table-body');
      const colCount = document.querySelector('thead tr')?.children?.length || 1;
      if (tbody) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="${colCount}">Hindi ma-load ang records.</td></tr>`;
      }
      return loadProjectsDashboardData();
    });
}

function loadArchivedRecords() {
  const requestSeq = ++recordsLoadSeq;
  return fetch('/api/transactions/archived')
    .then(res => res.json())
    .then(data => {
      if (requestSeq !== recordsLoadSeq) return;
      db = (Array.isArray(data) ? data : []).map(row => ({
        ...row,
        archived: 1,
        archived_auto: 0
      }));
      updateStats();
      renderTable();
      return loadProjectsDashboardData();
    })
    .catch(err => {
      console.error('Load archived error:', err);
      showToast('Hindi ma-load ang archived records.', 'error');
      const tbody = document.getElementById('table-body');
      const colCount = document.querySelector('thead tr')?.children?.length || 1;
      if (tbody) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="${colCount}">Hindi ma-load ang archived records.</td></tr>`;
      }
      return loadProjectsDashboardData();
    });
}

function loadUsers() {
  return fetch('/api/admin/users', { cache: 'no-store' })
    .then(res => res.json())
    .then(data => {
      usersDb = Array.isArray(data) ? data : [];
      if (typeof renderUsers === 'function') {
        renderUsers();
      } else {
        renderTable();
      }
      return usersDb;
    })
    .catch(err => {
      console.error('Load Users Error:', err);
      const tbody = document.getElementById('table-body');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Failed to load users.</td></tr>';
      }
      throw err;
    });
}

function switchTab(tab, btn) {
  if (!isAdminUser() && tab !== 'all') {
    activeTab = 'all';
    localStorage.setItem('kinaadman_activeTab', 'all');
    openDashboardPanel('home');
    showToast('Staff view only. Admin lang ang may access sa panel na ito.', 'error');
    return;
  }

  activeTab = tab;
  localStorage.setItem('kinaadman_activeTab', tab);

  currentPage = 1;
  updateSidebarMenuState(tab);

  const projectStatusFilter = document.getElementById('project-status-filter');
  const exportRecordsActions = document.getElementById('export-records-actions');
  const userControls = document.getElementById('user-controls');
  const searchInput = document.getElementById('search-input');
  if (projectStatusFilter) {
    projectStatusFilter.disabled = tab !== 'all';
    projectStatusFilter.style.display = tab === 'users' ? 'none' : '';
    if (tab === 'archived') {
      projectStatusFilter.value = 'all';
    }
  }
  if (exportRecordsActions) {
    exportRecordsActions.style.display = tab === 'users' ? 'none' : 'flex';
  }
  if (userControls) {
    userControls.style.display = tab === 'users' ? 'inline-flex' : 'none';
  }
  if (searchInput) {
    searchInput.placeholder = tab === 'users'
      ? 'Search users by name, email, or role...'
      : 'Search client, document number, or items here...';
  }

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn && btn.classList) {
    btn.classList.add('active');
  }

  const addBtn = document.getElementById('btn-main-add');
  const pageTitle = document.querySelector('.page-title');
  const pageSub = document.querySelector('.page-sub');
  const mainCont = document.querySelector('main');

  if (tab === 'users') {
    openDashboardPanel('home');
    if (pageTitle) pageTitle.textContent = 'User Management';
    if (pageSub) pageSub.textContent = 'Approve registered accounts and manage existing users.';
    if (mainCont) mainCont.style.maxWidth = '100%';

    if (addBtn) {
      addBtn.style.display = 'none';
      addBtn.onclick = null;
    }
    if (typeof setUserManagementView === 'function') setUserManagementView('approvals');
    loadUsers();
    renderUsers();
  } else if (tab === 'project-records') {
    openDashboardPanel('project-records');
    if (pageTitle) pageTitle.textContent = 'Projects';
    if (pageSub) pageSub.textContent = '';
    if (mainCont) mainCont.style.maxWidth = '1400px';

    if (addBtn) {
      addBtn.textContent = 'Add Project';
      addBtn.onclick = openProjectModal;
      addBtn.style.display = (!isAdminUser() && !isStaffUser()) ? 'none' : '';
    }
    renderProjectRecordsTable();
  } else {
    openDashboardPanel('total-projects');
    if (pageTitle) pageTitle.textContent = tab === 'archived' ? 'Archived Project Transactions' : 'Project Transactions';
    if (pageSub) pageSub.textContent = '';
    if (mainCont) mainCont.style.maxWidth = '1400px';
    if (projectStatusFilter) {
      projectStatusFilter.style.display = '';
      projectStatusFilter.disabled = tab === 'archived';
      projectStatusFilter.value = tab === 'archived' ? 'archived' : 'all';
    }
    if (exportRecordsActions) exportRecordsActions.style.display = '';
    if (userControls) userControls.style.display = 'none';

    if (addBtn) {
      addBtn.textContent = 'Add Transaction';
      addBtn.onclick = openModal;
      addBtn.style.display = (!isAdminUser() && !isStaffUser()) ? 'none' : '';
    }
    if (tab === 'archived') {
      loadArchivedRecords();
      return;
    }
    renderTable();
  }
}

function openSidebarDashboard(btn) {
  activeTab = 'all';
  localStorage.setItem('kinaadman_activeTab', 'all');
  if (btn && btn.classList) {
    updateSidebarMenuState('dashboard');
  }
  openDashboardPanel('home');
  setSidebarOpen(false);
}

function openTotalProjectsFromDashboard() {
  openDashboardPanel('total-projects');
}

function openProjectsFromDashboard() {
  openDashboardPanel('project-records');
  setSidebarOpen(false);
}

function openProjectStatsModal() {
  const showModal = () => {
    updateProjectStatsModal();
    const backdrop = document.getElementById('project-stats-modal-backdrop');
    if (backdrop) {
      backdrop.style.display = 'flex';
      backdrop.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  };

  if (!Array.isArray(projectsDashboardDb) || projectsDashboardDb.length === 0) {
    loadProjectsDashboardData()
      .then(showModal)
      .catch((err) => {
        console.error('Failed to load project stats:', err);
        showToast('Unable to load project statistics.', 'error');
      });
    return;
  }

  showModal();
}

function closeProjectStatsModal() {
  const backdrop = document.getElementById('project-stats-modal-backdrop');
  if (backdrop) {
    backdrop.classList.remove('open');
    backdrop.style.display = 'none';
  }
  document.body.style.overflow = '';
}

function openProjectRecordsFromStats() {
  closeProjectStatsModal();
  openDashboardPanel('project-records');
  setSidebarOpen(false);
}

function updateProjectStatsModal() {
  const projects = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
    .filter((p) => Number(p.is_archived || 0) === 0);

  const totalEl = document.getElementById('proj-stats-total');
  const ongoingEl = document.getElementById('proj-stats-ongoing');

  const ongoing = projects.filter((p) => getProjectPhase(p) === 'ongoing').length;

  if (totalEl) totalEl.textContent = String(projects.length);
  if (ongoingEl) ongoingEl.textContent = String(ongoing);
}

function openAllTransactionsFromDashboard() {
  openDashboardPanel('project-records');
}

function openReportsPanel() {
  window.location.href = '/reports';
  setSidebarOpen(false);
}

function openProjectsDashboard() {
  openDashboardPanel('project-records');
  setSidebarOpen(false);
}

function openServiceOrdersDashboard() {
  window.location.href = '/accounts-receivable?tab=service-orders';
}

function goBackSmart(fallback = '/admin?view=dashboard', forceFallback = false) {
  if (!forceFallback && window.history.length > 1) {
    window.history.back();
    return;
  }
  window.location.href = fallback;
}

function formatBackButtonLabel(target = '') {
  const rawTarget = String(target || '').trim();
  if (!rawTarget) return '';

  let url;
  try {
    url = new URL(rawTarget, window.location.origin);
  } catch {
    return '';
  }

  const path = url.pathname || '';
  const view = url.searchParams.get('view') || '';
  const panel = url.searchParams.get('panel') || '';

  if (path === '/admin' && (!view || view === 'dashboard')) return 'Back to Dashboard';
  if (path === '/admin' && panel === 'project-records') return 'Back to Project Operations';
  if (path === '/admin' && view === 'ongoing-projects') return 'Back to Ongoing Projects';
  if (path === '/admin' && view === 'archived') return 'Back to Archived Projects';
  if (path === '/admin' && view === 'all') return 'Back to Project Transactions';

  const routeLabels = {
    '/accounts-payable': 'Back to Accounts Payable',
    '/accounts-receivable': 'Back to Accounts Receivable',
    '/gantt-chart': 'Back to Gantt Chart',
    '/login': 'Back to Login',
    '/reports': 'Back to Reports',
    '/reset-password': 'Back to Login',
    '/user-management': 'Back to User Management',
  };

  if (routeLabels[path]) return routeLabels[path];

  const lastSegment = path.split('/').filter(Boolean).pop() || '';
  if (!lastSegment) return 'Back';
  const words = lastSegment.replace(/[-_]+/g, ' ').trim();
  if (!words) return 'Back';
  return `Back to ${words.replace(/\b\w/g, (ch) => ch.toUpperCase())}`;
}

function syncBackButtonLabels(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') return;

  root.querySelectorAll('.section-back-btn').forEach((button) => {
    const explicit = button.getAttribute('data-back-label');
    const fallback =
      button.getAttribute('data-back-fallback') ||
      button.dataset.backFallback ||
      button.getAttribute('onclick')?.match(/(?:goBackSmart|window\.location\.href\s*=\s*['"])([^'"]+)/)?.[1] ||
      '';
    const label = explicit || formatBackButtonLabel(fallback);
    if (!label) return;
    button.textContent = label;
    button.setAttribute('aria-label', label.replace(/^Back to\s+/i, 'Go back to '));
  });
}

function openProjectTimeline(projectId = null) {
  const url = new URL('/gantt-chart', window.location.origin);
  const id = Number(projectId || 0) || null;
  if (id) {
    url.searchParams.set('projectId', String(id));
  }
  window.location.href = url.toString();
}

function resetUserPassword(id) {
  const user = usersDb.find(entry => Number(entry.id) === Number(id));
  resetPasswordUserId = Number(id);
  resetPasswordUserLabel = user ? `${user.fullname || user.username || 'User'}` : 'User';

  const title = document.getElementById('reset-pass-title');
  const input = document.getElementById('reset-pass-input');
  const confirm = document.getElementById('reset-pass-confirm');
  const modal = document.getElementById('reset-pass-backdrop');

  if (title) title.textContent = `Reset Password - ${resetPasswordUserLabel}`;
  if (input) input.value = '';
  if (confirm) confirm.value = '';
  if (modal) modal.classList.add('open');
  if (input) input.focus();
}

function closeResetPasswordModal() {
  const modal = document.getElementById('reset-pass-backdrop');
  if (modal) modal.classList.remove('open');
  resetPasswordUserId = null;
  resetPasswordUserLabel = '';
}

function submitResetPasswordModal() {
  const password = document.getElementById('reset-pass-input')?.value || '';
  const confirm = document.getElementById('reset-pass-confirm')?.value || '';

  if (resetPasswordUserId === null || resetPasswordUserId === undefined) {
    return showToast('No user selected for password reset.', 'error');
  }

  if (password.length < 8) {
    return showToast('Password must be at least 8 characters.', 'error');
  }

  if (password !== confirm) {
    return showToast('Passwords do not match.', 'error');
  }

  fetch(`/api/admin/users/${resetPasswordUserId}/reset-password`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || 'Unable to reset password');
      closeResetPasswordModal();
      showToast('Password reset successfully.', 'success');
    })
    .catch((err) => {
      showToast(err.message || 'Unable to reset password.', 'error');
    });
}

function openProjectInTotalProjects(searchValue) {
  const targetSearch = String(searchValue || '').trim();

  if (!document.getElementById('total-projects-section')) {
    const url = new URL('/admin', window.location.origin);
    url.searchParams.set('view', 'all');
    if (targetSearch) {
      url.searchParams.set('search', targetSearch);
    }
    window.location.href = url.toString();
    return;
  }

  openDashboardPanel('total-projects');
  const menuAll = document.getElementById('menu-all');
  if (menuAll) menuAll.classList.add('active');
  activeTab = 'all';
  localStorage.setItem('kinaadman_activeTab', 'all');
  currentPage = 1;

  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = targetSearch;
  renderTable();
  setSidebarOpen(false);
}

function openProjectModal(projectId = null) {
  editingProjectId = Number(projectId) || null;
  const modal = document.getElementById('project-modal-backdrop');
  const title = document.getElementById('project-modal-title');
  const saveBtn = document.getElementById('project-save-btn');
  const today = new Date().toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const project = editingProjectId
    ? (projectsDashboardDb || []).find(entry => Number(entry.id) === Number(editingProjectId))
    : null;
  const projectData = project || {};

  if (modal) {
    modal.classList.add('open');
    modal.style.display = 'flex';
  }

  if (title) title.textContent = project ? 'Edit Project' : 'Create Project';
  if (saveBtn) saveBtn.textContent = project ? 'Update Project' : 'Save Project';
  setProjectModalNotice('');

  try {
    document.getElementById('p-project-name').value = projectData.project_name || '';
    const projectDocNoInput = document.getElementById('p-project-docno');
    if (projectDocNoInput) projectDocNoInput.value = String(projectData.project_docno || '').trim();
    currentProjectStartDate = formatDateYmd(projectData.planned_start_date || projectData.start_date || '');
    currentProjectEndDate = formatDateYmd(projectData.planned_end_date || projectData.end_date || '');
    populateProjectCompanySelect(projectData.company_id || projectData.registry_company_id || projectData.company_no || projectData.company_name || projectData.client_name || '');
    const startDateInput = document.getElementById('p-planned-start-date');
    const endDateInput = document.getElementById('p-planned-end-date');
    currentProjectStartDate = project ? (currentProjectStartDate || '') : today;
    currentProjectEndDate = project ? (currentProjectEndDate || '') : nextMonth;
    if (startDateInput) startDateInput.value = currentProjectStartDate || '';
    if (endDateInput) endDateInput.value = currentProjectEndDate || '';
    const companySelect = document.getElementById('p-company-select');
    const hasCompanyOptions = Number(companySelect?.options?.length || 0) > 1;
    if (!hasCompanyOptions) {
      setProjectModalNotice('No companies available yet. Please add a company in Company Registry first.');
      if (saveBtn) saveBtn.disabled = true;
    } else if (saveBtn) {
      saveBtn.disabled = false;
    }
    if (!project) {
      fetch(`/api/projects/next-docno?business_entity_id=${encodeURIComponent(erpGetCurrentBusinessEntityId() || '')}`)
        .then(res => res.json().catch(() => ({})).then(data => ({ ok: res.ok, data })))
        .then(({ ok, data }) => {
          if (!ok || editingProjectId) return;
          const nextDocno = String(data?.project_docno || '').trim();
          if (!nextDocno) return;
          if (projectDocNoInput) projectDocNoInput.value = nextDocno;
        })
        .catch(() => {});
    }
  } catch (err) {
    console.error('openProjectModal error:', err);
    showToast('Project modal opened with a field error. Please refresh if anything looks missing.', 'error');
  }

  document.body.style.overflow = 'hidden';
}

function closeProjectModal() {
  const modal = document.getElementById('project-modal-backdrop');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = '';
  }
  editingProjectId = null;
  currentProjectStartDate = '';
  currentProjectEndDate = '';
  document.body.style.overflow = '';
  setProjectModalNotice('');
}

function openConfirmDialog({
  title = 'Confirm Action',
  message = 'Are you sure?',
  noText = 'No',
  yesText = 'Yes'
} = {}) {
  const backdrop = document.getElementById('confirm-modal-backdrop');
  const titleEl = document.getElementById('confirm-modal-title');
  const messageEl = document.getElementById('confirm-modal-message');
  const noBtn = document.getElementById('confirm-modal-no-btn');
  const yesBtn = document.getElementById('confirm-modal-yes-btn');

  if (!backdrop || !titleEl || !messageEl || !noBtn || !yesBtn) {
    return Promise.resolve(window.confirm(String(message || title || 'Are you sure?')));
  }

  if (confirmDialogState.resolver) {
    const pending = confirmDialogState.resolver;
    confirmDialogState.resolver = null;
    pending(false);
  }

  titleEl.textContent = title;
  messageEl.textContent = message;
  noBtn.textContent = noText;
  yesBtn.textContent = yesText;

  backdrop.classList.add('open');
  backdrop.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  return new Promise((resolve) => {
    confirmDialogState.resolver = resolve;
    setTimeout(() => noBtn.focus(), 0);
  });
}

function closeConfirmDialog(result = false) {
  const backdrop = document.getElementById('confirm-modal-backdrop');
  if (backdrop) {
    backdrop.classList.remove('open');
    backdrop.style.display = '';
  }

  const resolver = confirmDialogState.resolver;
  confirmDialogState.resolver = null;
  if (typeof resolver === 'function') resolver(Boolean(result));

  const anyModalOpen = document.querySelector('.modal-backdrop.open') || document.getElementById('pdf-viewer-backdrop')?.classList.contains('open');
  if (!anyModalOpen) {
    document.body.style.overflow = '';
  }
}

function openApprovalPasswordDialog(role = 'staff') {
  let backdrop = document.getElementById('approval-password-modal-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop approval-password-backdrop';
    backdrop.id = 'approval-password-modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal approval-password-modal" role="dialog" aria-modal="true" aria-labelledby="approval-password-title">
        <button class="modal-close" type="button" data-approval-password-cancel aria-label="Close approval dialog">X</button>
        <div class="modal-title" id="approval-password-title">Approve Staff Account</div>
        <p class="modal-copy">Enter your current admin password to approve this account.</p>
        <div class="field full">
          <label for="approval-password-input">Admin Password</label>
          <input id="approval-password-input" type="password" autocomplete="current-password" />
          <div class="modal-inline-message is-hidden" id="approval-password-message" aria-live="polite"></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-cancel btn-sm" type="button" data-approval-password-cancel>Cancel</button>
          <button class="btn btn-save btn-sm" type="button" data-approval-password-submit>Approve</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
  }

  const title = backdrop.querySelector('#approval-password-title');
  const input = backdrop.querySelector('#approval-password-input');
  const message = backdrop.querySelector('#approval-password-message');
  const submitBtn = backdrop.querySelector('[data-approval-password-submit]');
  const cancelBtns = backdrop.querySelectorAll('[data-approval-password-cancel]');
  const roleLabel = typeof formatAccessRoleLabel === 'function' ? formatAccessRoleLabel(role) : String(role || 'Staff');

  if (title) title.textContent = `Approve ${roleLabel} Account`;
  if (input) {
    input.value = '';
    input.setAttribute('aria-invalid', 'false');
  }
  if (message) {
    message.textContent = '';
    message.classList.add('is-hidden');
  }

  backdrop.classList.add('open');
  backdrop.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  return new Promise((resolve) => {
    let done = false;
    const cleanup = (value) => {
      if (done) return;
      done = true;
      backdrop.classList.remove('open');
      backdrop.style.display = '';
      cancelBtns.forEach((btn) => btn.removeEventListener('click', onCancel));
      submitBtn?.removeEventListener('click', onSubmit);
      input?.removeEventListener('keydown', onKeydown);
      const anyModalOpen = document.querySelector('.modal-backdrop.open') || document.getElementById('pdf-viewer-backdrop')?.classList.contains('open');
      if (!anyModalOpen) document.body.style.overflow = '';
      resolve(value);
    };
    const showMessage = (text) => {
      if (message) {
        message.textContent = text;
        message.classList.remove('is-hidden');
      }
      input?.setAttribute('aria-invalid', 'true');
      input?.focus();
    };
    const onCancel = () => cleanup('');
    const onSubmit = () => {
      const password = String(input?.value || '').trim();
      if (!password) {
        showMessage('Current admin password is required.');
        return;
      }
      cleanup(password);
    };
    const onKeydown = (event) => {
      if (event.key === 'Enter') onSubmit();
      if (event.key === 'Escape') onCancel();
    };

    cancelBtns.forEach((btn) => btn.addEventListener('click', onCancel));
    submitBtn?.addEventListener('click', onSubmit);
    input?.addEventListener('keydown', onKeydown);
    setTimeout(() => input?.focus(), 0);
  });
}

function triggerProjectPdfPicker() {
  const input = document.getElementById('project-pdf-file-input');
  if (!input) return;
  input.value = '';
  input.click();
}

function setProjectModalValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value ?? '';
}

function setProjectModalNotice(message = '') {
  const notice = document.getElementById('project-modal-notice');
  if (!notice) return;

  const text = String(message || '').trim();
  if (!text) {
    notice.textContent = '';
    notice.classList.add('is-hidden');
    return;
  }

  notice.textContent = text;
  notice.classList.remove('is-hidden');
}

async function saveProject() {
  const projectName = document.getElementById('p-project-name').value.trim();
  const existingProject = editingProjectId
    ? (projectsDashboardDb || []).find(entry => Number(entry.id) === Number(editingProjectId))
    : null;
  const status = String(existingProject?.status || 'active').trim() || 'active';
  const projectDocNoValue = String(document.getElementById('p-project-docno')?.value || '').trim() || String(existingProject?.project_docno || '').trim();
  const companyId = Number(getProjectCompanyInputValue() || existingProject?.company_id || 0) || 0;
  const companyRecord = findRegistryCompanyById(companyId);
  const companyNo = String(companyRecord?.company_no || existingProject?.company_no || '').trim();
  const companyName = getProjectCompanyNameFromSelection(companyId) || String(existingProject?.company_name || existingProject?.client_name || '').trim();
  const plannedStartDate = document.getElementById('p-planned-start-date')?.value || currentProjectStartDate || '';
  const plannedEndDate = document.getElementById('p-planned-end-date')?.value || currentProjectEndDate || '';
  const priority = getComputedProjectPriority({
    ...existingProject,
    status,
    planned_end_date: plannedEndDate,
    end_date: plannedEndDate,
    actual_end_date: document.getElementById('p-actual-end-date')?.value || ''
  });
  const companySelect = document.getElementById('p-company-select');
  const hasCompanyOptions = Number(companySelect?.options?.length || 0) > 1;
  if (!projectName || !plannedStartDate || !plannedEndDate || !companyId) {
    const missingFields = [];
    if (!projectName) missingFields.push('Project Title');
    if (!companyId) {
      missingFields.push('Company');
      if (!hasCompanyOptions) {
        setProjectModalNotice('No companies available yet. Please add a company in Company Registry first.');
        return;
      }
    }
    if (!plannedStartDate) missingFields.push('Start Date');
    if (!plannedEndDate) missingFields.push('End Date');

    const message = `Missing fields: ${missingFields.join(', ')}.`;
    setProjectModalNotice(message);
    return;
  }

  if (plannedEndDate < plannedStartDate) {
    const message = 'End Date must be later than or equal to Start Date.';
    setProjectModalNotice(message);
    return;
  }

  currentProjectStartDate = plannedStartDate;
  currentProjectEndDate = plannedEndDate;

  const isEdit = Boolean(editingProjectId);
  const url = isEdit ? `/api/projects/${editingProjectId}` : '/api/projects';
  const method = isEdit ? 'PUT' : 'POST';
  const saveBtn = document.getElementById('project-save-btn');
  if (saveBtn) saveBtn.disabled = true;

  const formData = new FormData();
  formData.append('project_name', projectName);
  formData.append('status', status);
  formData.append('priority', priority);
  formData.append('company_id', companyId || '');
  formData.append('company_no', companyNo || '');
  formData.append('company_name', companyName || '');
  formData.append('client_name', companyName || '');
  formData.append('start_date', plannedStartDate);
  formData.append('end_date', plannedEndDate);
  formData.append('planned_start_date', plannedStartDate);
  formData.append('planned_end_date', plannedEndDate);

  try {
    const res = await fetch(url, {
      method,
      body: formData
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.message || 'Unable to save project.');
    }

    closeProjectModal();
    await loadProjectsDashboardData();
    if (typeof window.__ganttProjectAfterSave === 'function') {
      const hook = window.__ganttProjectAfterSave;
      window.__ganttProjectAfterSave = null;
      try {
        hook(data?.id || editingProjectId || null, data);
      } catch (hookErr) {
        console.error('Gantt project after-save hook error:', hookErr);
      }
    }
    showToast(isEdit ? 'Project record updated successfully.' : 'Project record created successfully.', 'success');
    return data;
  } catch (err) {
    showToast(err.message || 'Unable to save project.', 'error');
    return null;
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function openOngoingProjectsFromSidebar(btn) {
  if (btn && btn.classList) {
    document.querySelectorAll('.sidebar-link').forEach(link => {
      if (link.id && link.id.startsWith('menu-')) {
        link.classList.remove('active');
      }
    });
    btn.classList.add('active');
  }

  const searchInput = document.getElementById('ongoing-search');
  if (searchInput) searchInput.value = '';

  const filter = document.getElementById('ongoing-filter');
  if (filter) filter.value = 'ongoing';

  openDashboardPanel('ongoing-projects');
  setSidebarOpen(false);
}

/* Hamburger Menu Helpers */
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const isOpen = sidebar ? sidebar.classList.contains('open') : false;
  setSidebarOpen(!isOpen);
}

function setSidebarOpen(isOpen) {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  if (!sidebar || !overlay) return;

  sidebar.classList.toggle('open', isOpen);
  overlay.classList.toggle('open', isOpen);
  document.body.classList.toggle('sidebar-open', isOpen);
}

function syncSidebarGroupStates() {
  document.querySelectorAll('.sidebar-group[data-sidebar-group]').forEach((group) => {
    const key = String(group.getAttribute('data-sidebar-group') || '').trim();
    const toggle = group.querySelector('.sidebar-group-toggle');
    if (!toggle) return;

    const stored = key ? localStorage.getItem(`kinaadman_sidebarGroup_${key}`) : null;
    const defaultCollapsed = group.getAttribute('data-sidebar-default-collapsed') === '1';
    const shouldCollapse = stored === null ? defaultCollapsed : stored === '1';

    group.classList.toggle('is-collapsed', shouldCollapse);
    toggle.setAttribute('aria-expanded', String(!shouldCollapse));
  });
}

function toggleSidebarGroup(trigger) {
  const group = trigger && typeof trigger.closest === 'function' ? trigger.closest('.sidebar-group') : null;
  if (!group) return;

  const key = String(group.getAttribute('data-sidebar-group') || '').trim();
  const nextCollapsed = !group.classList.contains('is-collapsed');
  group.classList.toggle('is-collapsed', nextCollapsed);
  trigger.setAttribute('aria-expanded', String(!nextCollapsed));

  if (key) {
    localStorage.setItem(`kinaadman_sidebarGroup_${key}`, nextCollapsed ? '1' : '0');
  }
}

function menuItemClick(tab, btn) {
  switchTab(tab, btn);
  setSidebarOpen(false);
}

function getFiltered() {
  const searchInput = document.getElementById('search-input');
  const qRaw = (searchInput ? searchInput.value : '').trim();
  const tokens = getSearchTokens(qRaw.toLowerCase());
  const statusFilter = String(document.getElementById('filter-status')?.value || '').trim().toLowerCase();
  const companyFilter = normalizeDashboardCompanyName(currentDashboardCompany || localStorage.getItem('kinaadman_dashboardCompany') || 'all');

  return db.filter(r => {
    const isArchivedRow = Number(r.archived || 0) === 1;
    const tabMatch = activeTab === 'all'
      ? true
      : activeTab === 'archived'
        ? isArchivedRow
        : r.type === activeTab;
    const haystack = [
      r.client || '',
      r.docno || '',
      r.description || '',
      r.checkno || '',
      r.pono || '',
      r.amount || '',
      r.status || '',
      r.date || '',
      r.type || ''
    ].join(' ').toLowerCase();
    const searchMatch = !tokens.length || tokens.every(token => haystack.includes(token));
    const statusMatch = !statusFilter || String(r.status || '').toLowerCase() === statusFilter;
    const companyMatch = companyFilter === 'all' || companyMatchesDashboardFilter(getTransactionCompanyName(r));
    return tabMatch && searchMatch && statusMatch && companyMatch;
  });
}

function getSearchTokens(query) {
  return String(query || '').trim().split(/\s+/).filter(Boolean);
}

function getMemberEntriesFromRecord(record) {
  if (!record) return [];

  return [
    { name: record.project_members, role: record.member_role, phone: record.member_phone },
    { name: record.project_members_2, role: record.member_role_2, phone: record.member_phone_2 },
    { name: record.project_members_3, role: record.member_role_3, phone: record.member_phone_3 }
  ]
    .map(entry => ({
      name: String(entry.name || '').trim(),
      role: String(entry.role || '').trim(),
      phone: String(entry.phone || '').trim()
    }))
    .filter(entry => entry.name || entry.role || entry.phone);
}

function memberRoleRank(role) {
  const r = String(role || '').trim().toLowerCase();
  if (!r) return 99;
  if (/^it$/.test(r)) return 0;
  return 1;
}

function sortMemberEntries(entries) {
  return [...(entries || [])].sort((a, b) => memberRoleRank(a.role) - memberRoleRank(b.role));
}

function formatMemberCell(entries, key, q) {
  if (!entries || !entries.length) return '—';

  const lines = entries.map(entry => {
    const value = String(entry[key] || '').trim();
    return value ? highlight(value, q) : '—';
  });

  return lines.join('<br>');
}

function getUserApprovalStatus(user) {
  const status = String(user?.approval_status || '').trim().toLowerCase();
  if (status === 'pending' || status === 'rejected') return status;
  return Number(user?.active || 0) === 1 ? 'active' : 'inactive';
}

function getUserManagementView() {
  return userManagementView === 'users' ? 'users' : 'approvals';
}

function getUserManagementCounts() {
  const rows = Array.isArray(usersDb) ? usersDb : [];
  return rows.reduce((counts, user) => {
    if (getUserApprovalStatus(user) === 'pending') {
      counts.approvals += 1;
    } else {
      counts.users += 1;
    }
    return counts;
  }, { approvals: 0, users: 0 });
}

function updateUserManagementViewControls() {
  const view = getUserManagementView();
  const approvalsTab = document.getElementById('user-management-tab-approvals');
  const usersTab = document.getElementById('user-management-tab-users');
  const statusFilter = document.getElementById('user-status-filter');
  const approvalCount = document.getElementById('user-approval-count');
  const userCount = document.getElementById('user-list-count');
  const counts = getUserManagementCounts();

  if (approvalsTab) {
    approvalsTab.classList.toggle('active', view === 'approvals');
    approvalsTab.setAttribute('aria-selected', String(view === 'approvals'));
  }
  if (usersTab) {
    usersTab.classList.toggle('active', view === 'users');
    usersTab.setAttribute('aria-selected', String(view === 'users'));
  }
  if (statusFilter) {
    statusFilter.style.display = view === 'approvals' ? 'none' : '';
    statusFilter.disabled = view === 'approvals';
  }
  if (approvalCount) approvalCount.textContent = String(counts.approvals);
  if (userCount) userCount.textContent = String(counts.users);
}

function setUserManagementView(view) {
  userManagementView = view === 'users' ? 'users' : 'approvals';
  updateUserManagementViewControls();
  renderUsers();
}

function getSafeUserRole(user) {
  return normalizeAccessRole(user?.role || 'user');
}

function getUserRoleBadgeHtml(user, q) {
  const role = getSafeUserRole(user);
  const roleColor = role === 'super_admin'
    ? { bg: '#e0f2fe', fg: '#075985' }
    : (role === 'admin'
      ? { bg: '#fee2e2', fg: '#991b1b' }
      : (role === 'staff' ? { bg: '#fef3c7', fg: '#92400e' } : { bg: '#eef2ff', fg: '#3355cc' }));
  return `<span class="admin-badge" data-role="${role}" style="background:${roleColor.bg}; color:${roleColor.fg}">${highlight(role.replace('_', ' '), q)}</span>`;
}

function getUserStatusMeta(user) {
  const approvalStatus = getUserApprovalStatus(user);
  if (approvalStatus === 'pending') {
    return { label: 'Pending', className: 'status-upcoming' };
  }
  if (approvalStatus === 'rejected') {
    return { label: 'Rejected', className: 'status-cancelled' };
  }
  return Number(user?.active || 0) === 1
    ? { label: 'Active', className: 'status-active' }
    : { label: 'Inactive', className: 'status-inactive' };
}

function formatUserDateParts(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    date: date.toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: '2-digit'
    }),
    time: date.toLocaleTimeString('en-PH', {
      hour: '2-digit',
      minute: '2-digit'
    })
  };
}

function renderUserDateCell(value, emptyLabel = 'Never') {
  const parts = formatUserDateParts(value);
  return parts
    ? `<div style="display:flex;flex-direction:column;line-height:1.2;"><span>${escHtml(parts.date)}</span><span>${escHtml(parts.time)}</span></div>`
    : escHtml(emptyLabel);
}

function renderApprovalUserRow(u, q) {
  const safeRole = getSafeUserRole(u);
  const approvalRole = safeRole === 'user' ? 'staff' : safeRole;
  const isSelf = Number(u.id) === Number(currentUser?.id || 0);
  const canManageTarget = canCurrentUserManageUser(u);
  const statusMeta = getUserStatusMeta(u);
  const approveAttrs = isSelf
    ? 'disabled title="Hindi puwedeng i-approve ang sarili mong account dito."'
    : (canManageTarget ? `onclick="approveUser(${u.id}, '${approvalRole}')"` : 'disabled title="Only Super Admin can approve admin or super admin accounts."');
  const rejectAttrs = isSelf
    ? 'disabled title="Hindi puwedeng i-reject ang sarili mong account dito."'
    : (canManageTarget ? `onclick="rejectUser(${u.id})"` : 'disabled title="Only Super Admin can reject admin or super admin accounts."');
  const editAttrs = canManageTarget
    ? `onclick="editUser(${u.id})"`
    : 'disabled title="Only Super Admin can edit admin or super admin accounts."';

  return `
    <tr style="height: 70px;">
      <td style="padding: 15px 20px; font-size: 0.95rem;"><strong>${highlight(u.fullname || '', q)}</strong></td>
      <td style="padding: 15px 20px; font-size: 0.9rem; color: var(--text);">${highlight(u.email || '—', q)}</td>
      <td class="text-center" style="padding: 15px 20px; font-size: 0.95rem;">${getUserRoleBadgeHtml(u, q)}</td>
      <td class="text-center" style="padding: 15px 20px; font-size: 0.8rem; color: var(--muted); white-space: nowrap;">${renderUserDateCell(u.created_at, '—')}</td>
      <td class="text-center" style="padding: 15px 20px; font-size: 0.95rem;"><span class="status-pill ${statusMeta.className}">${statusMeta.label}</span></td>
      <td class="text-center" style="padding: 15px 20px;">
        <div class="actions" style="justify-content:center; gap:6px;">
          <button class="btn btn-sm btn-edit" ${editAttrs}>Edit</button>
          <button class="btn btn-sm btn-add" ${approveAttrs}>Approve Staff</button>
          <button class="btn btn-sm btn-delete" ${rejectAttrs}>Reject</button>
        </div>
      </td>
    </tr>
  `;
}

function renderManagedUserRow(u, q) {
  const isSelf = Number(u.id) === Number(currentUser?.id || 0);
  const canManageTarget = canCurrentUserManageUser(u);
  const approvalStatus = getUserApprovalStatus(u);
  const isRejected = approvalStatus === 'rejected';
  const statusMeta = getUserStatusMeta(u);
  const toggleAttrs = isSelf
    ? 'disabled title="Hindi puwedeng baguhin ang sarili mong account status."'
    : (!canManageTarget ? 'disabled title="Only Super Admin can enable or disable admin/super admin accounts."' : (isRejected ? 'disabled title="Edit the rejected account to approve it first."' : `onclick="toggleUser(${u.id})"`));
  const deleteAttrs = isSelf ? 'disabled title="Hindi puwedeng i-delete ang sarili mong account."' : (canManageTarget ? `onclick="deleteUser(${u.id})"` : 'disabled title="Only Super Admin can delete admin/super admin accounts."');
  const editAttrs = canManageTarget
    ? `onclick="editUser(${u.id})"`
    : 'disabled title="Only Super Admin can edit admin or super admin accounts."';

  return `
    <tr style="height: 70px;">
      <td style="padding: 15px 20px; font-size: 0.95rem;"><strong>${highlight(u.fullname || '', q)}</strong></td>
      <td style="padding: 15px 20px; font-size: 0.9rem; color: var(--text);">${highlight(u.email || '—', q)}</td>
      <td class="text-center" style="padding: 15px 20px; font-size: 0.95rem;">${getUserRoleBadgeHtml(u, q)}</td>
      <td class="text-center" style="padding: 15px 20px; font-size: 0.95rem;"><span class="status-pill ${statusMeta.className}">${statusMeta.label}</span></td>
      <td class="text-center" style="padding: 15px 20px; font-size: 0.8rem; color: var(--muted); white-space: nowrap;">${renderUserDateCell(u.last_login, 'Never')}</td>
      <td class="text-center" style="padding: 15px 20px;">
        <div class="actions" style="justify-content:center; gap:6px;">
          <button class="btn btn-sm btn-edit" ${editAttrs}>Edit</button>
          <button class="btn btn-sm ${u.active ? 'btn-delete' : 'btn-add'}" ${toggleAttrs}>${u.active ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-sm btn-delete" ${deleteAttrs}>Delete</button>
        </div>
      </td>
    </tr>
  `;
}

function renderUsers() {
  const tbody = document.getElementById('table-body');
  const thead = document.querySelector('thead tr');
  if (!tbody || !thead) return;
  const view = getUserManagementView();
  const searchInput = document.getElementById('search-input');
  const q = (searchInput?.value || '').trim().toLowerCase();
  const exportRecordsActions = document.getElementById('export-records-actions');
  const projectStatusFilter = document.getElementById('project-status-filter');
  const userControls = document.getElementById('user-controls');
  const userRoleFilter = document.getElementById('user-role-filter');
  const userStatusFilter = document.getElementById('user-status-filter');

  updateUserManagementViewControls();
  if (projectStatusFilter) projectStatusFilter.style.display = 'none';
  if (exportRecordsActions) exportRecordsActions.style.display = 'none';
  if (userControls) userControls.style.display = 'inline-flex';
  if (searchInput) {
    searchInput.placeholder = view === 'approvals'
      ? 'Search approval requests by name, email, or role...'
      : 'Search users by name, email, or role...';
  }
  
  thead.innerHTML = view === 'approvals'
    ? `<th style="padding:15px">Full Name</th><th>Email</th><th class="text-center">Requested Role</th><th class="text-center">Registered</th><th class="text-center">Status</th><th class="text-center">Actions</th>`
    : `<th style="padding:15px">Full Name</th><th>Email</th><th class="text-center">Role</th><th class="text-center">Status</th><th class="text-center">Last Login</th><th class="text-center">Actions</th>`;

  const filteredUsers = usersDb.filter(u => {
    if (!q) return true;
    const approvalStatus = getUserApprovalStatus(u);
    const haystack = [u.fullname, u.email, u.role, approvalStatus, u.active ? 'active' : 'inactive']
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });

  const roleFilter = String(userRoleFilter?.value || 'all');
  const statusFilter = String(userStatusFilter?.value || 'all');
  const scopedUsers = filteredUsers.filter(u => {
    const statusValue = getUserApprovalStatus(u);
    const viewOk = view === 'approvals'
      ? statusValue === 'pending'
      : statusValue !== 'pending';
    const roleOk = roleFilter === 'all' || String(u.role || '') === roleFilter;
    const statusOk = view === 'approvals' || statusFilter === 'all' || statusValue === statusFilter;
    return viewOk && roleOk && statusOk;
  });

  if (!scopedUsers.length) {
    const emptyMessage = view === 'approvals'
      ? 'Walang pending registration requests.'
      : 'Walang users na nahanap.';
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center">${emptyMessage}</td></tr>`;
    return;
  }

  tbody.innerHTML = scopedUsers
    .map(u => view === 'approvals' ? renderApprovalUserRow(u, q) : renderManagedUserRow(u, q))
    .join('');
}

function renderTable() {
  if (activeTab === 'users') return renderUsers();

  const thead = document.getElementById('transaction-table-head') || document.querySelector('#table-body')?.closest('table')?.querySelector('thead tr');
  const tbody = document.getElementById('table-body');
  if (!thead || !tbody) return;
  const isTransactionsPage = Boolean(document.getElementById('transaction-table-head'));
  const isStaff = isStaffUser();
  if (isStaff) {
    thead.innerHTML = `<th>Transaction No.</th><th class="text-center">Type</th><th>Client</th><th>Project</th><th>Description</th><th class="text-center">Qty</th><th class="text-right">Amount</th><th class="text-right">Bal</th><th class="text-center">Date</th><th class="text-center">Status</th><th class="text-center">Actions</th>`;
  } else {
    thead.innerHTML = `<th>Transaction No.</th><th class="text-center">Type</th><th>Client</th><th>Project</th><th>Description</th><th class="text-center">Qty</th><th class="text-center">Check</th><th class="text-center">Customer PO Ref.</th><th class="text-right">Amount</th><th class="text-right">Bal</th><th class="text-center">Date</th><th class="text-center">Status</th><th class="text-center">Actions</th>`;
  }

  const searchInput = document.getElementById('search-input');
  const q = searchInput ? searchInput.value.trim() : '';
  const filtered = getFiltered();
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (currentPage > pages) currentPage = pages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);
  if (!slice.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${thead.cells.length}">Walang records na nahanap.</td></tr>`;
    return;
  }

  tbody.innerHTML = slice.map(r => {
    const linkedProject = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
      .find(project => Number(project.id || 0) === Number(r.project_id || 0));
    const hDocno = highlight(r.docno || '', q);
    const hClient = highlight(r.client || '', q);
    const hProject = highlight(linkedProject?.project_name || '-', q);
    const hCheckno = highlight(r.checkno || '', q);
    const hPono = highlight(r.pono || '', q);
    const hDesc = highlight(r.description || r.desc || '', q);
    const hQty = highlight(String(Number(r.qty || 0) || 0), q);
    const paidAmount = getTransactionPaidAmountValue(r);
    const balanceAmount = Math.max(0, Number(r.amount || 0) - paidAmount);

    const docCell = r.pdfFilename
      ? `<span class="doc-link" onclick="event.stopPropagation(); openPdfViewer(${r.id})" title="View PDF">${hDocno}</span>`
      : `<span class="doc-link no-pdf" title="No PDF">${hDocno}</span>`;

    return `
      <tr>
        <td>${docCell}</td>
        <td class="text-center"><span class="type-pill type-${r.type}" style="white-space: nowrap;">${r.type === 'receipt' ? 'Payment Receipt' : 'Sales Invoice'}</span></td>
        <td><div style="font-weight:500; color:var(--text)">${hClient}</div></td>
        <td style="font-weight:500; color:var(--primary); line-height:1.35">${hProject}</td>
        <td>${hDesc}</td>
        <td class="text-center" style="font-size:.73rem;color:var(--text)">${hQty}</td>
        ${!isStaff ? `
          <td class="text-center" style="font-size:.73rem;color:var(--text)">${hCheckno}</td>
          <td class="text-center" style="font-size:.73rem;color:var(--text)">${hPono}</td>
        ` : ''}
        <td class="amount-cell">PHP ${parseFloat(r.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
        <td class="amount-cell" style="color:${balanceAmount > 0 ? 'var(--accent)' : 'var(--success)'}; font-weight:600">PHP ${balanceAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
        <td class="text-center" style="color:var(--text);font-size:.73rem">${r.date}</td>
        <td class="text-center">
          <div class="record-status-stack">
            <span class="status-pill status-${getComputedTransactionPaymentStatus(r)}">${highlight(getComputedTransactionPaymentStatus(r), q)}</span>
          </div>
        </td>
        ${isTransactionsPage ? `
        <td class="text-center">
          <div class="actions">
            ${r.pdfFilename ? `<button class="btn btn-pdf btn-sm" onclick="event.stopPropagation(); openPdfViewer(${r.id})" title="View PDF">PDF</button>` : ''}
            ${activeTab === 'archived'
              ? `<button class="btn btn-edit btn-sm" onclick="event.stopPropagation(); openArchivedModal(${r.id})" title="View Record">View</button><button class="btn btn-restore btn-sm" onclick="event.stopPropagation(); restoreArchivedDirect(${r.id})" title="Restore Record">Restore</button>`
              : `${Number(r.project_id || 0) ? `<button class="btn btn-add btn-sm" onclick="event.stopPropagation(); openProjectTransaction(${Number(r.project_id)})" title="Add Transaction">Add Transaction</button>` : ''}<button class="btn btn-edit btn-sm" onclick="event.stopPropagation(); openModal(${r.id})">Edit</button><button class="btn btn-archive btn-sm" onclick="event.stopPropagation(); openDelModal(${r.id})" title="Archive Record">Archive</button>`}
          </div>
        </td>` : `
        <td class="text-center">
          <div class="actions">
            ${r.pdfFilename ? `<button class="btn btn-pdf btn-sm" onclick="event.stopPropagation(); openPdfViewer(${r.id})" title="View PDF">PDF</button>` : ''}
            ${activeTab === 'archived'
              ? (isAdminUser()
                  ? `<button class="btn btn-edit btn-sm" onclick="event.stopPropagation(); openArchivedModal(${r.id})" title="View Record">View</button><button class="btn btn-restore btn-sm" onclick="event.stopPropagation(); restoreArchivedDirect(${r.id})" title="Restore Record">Restore</button>`
                  : `<button class="btn btn-edit btn-sm" onclick="event.stopPropagation(); openArchivedModal(${r.id})" title="View Record">View</button>`)
              : (isAdminUser()
                  ? `<button class="btn btn-edit btn-sm" onclick="event.stopPropagation(); openModal(${r.id})">Edit</button><button class="btn btn-archive btn-sm" onclick="event.stopPropagation(); openDelModal(${r.id})" title="Archive Record">Archive</button>`
                  : `<span style="font-size:.7rem;color:var(--muted)">View only</span>`)}
          </div>
        </td>`}
      </tr>`;
  }).join('');
}

async function navigateToGanttFormById(transactionId) {
  const trans = db.find(t => t.id === transactionId);
  if (!trans) return;
  const clientName = trans.client;

  try {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    // Subukang hanapin ang project base sa pangalan ng client
    const project = projects.find(p => p.project_name.toLowerCase().includes(clientName.toLowerCase()));

    if (project) {
      // Kung may project na, pumunta doon at i-auto-select
      openProjectTimeline(project.id);
    } else {
      // Kung wala pa, pumunta sa Gantt page at i-auto-open ang "New Project" form
      window.location.href = `/gantt-chart?newProjectName=${encodeURIComponent(clientName)}&autoOpen=true`;
    }
  } catch (e) {
    window.location.href = '/gantt-chart';
  }
}

async function updateRowProgress(id, clientName) {
  try {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    const project = projects.find(p => p.project_name.toLowerCase().includes(clientName.toLowerCase()));
    
    if (project) {
      const prog = project.avg_progress || 0;
      const bar = document.getElementById(`prog-bar-${id}`);
      const val = document.getElementById(`prog-val-${id}`);
      if (bar) bar.style.width = prog + '%';
      if (val) val.textContent = Math.round(prog) + '%';
    }
  } catch (e) {}
}

async function openGanttModal(clientName, transactionId) {
  document.getElementById('gantt-modal-backdrop').classList.add('open');
  const chartDiv = document.getElementById('gantt-chart-render');
  const fullViewBtn = document.getElementById('gantt-full-view-btn');
  chartDiv.innerHTML = '<div style="min-height:120px;"></div>';

  // Get transaction to display members
  const trans = db.find(t => t.id === transactionId);
  const modalMemberEntries = sortMemberEntries(getMemberEntriesFromRecord(trans));
  const memberText = modalMemberEntries.length
    ? modalMemberEntries
      .map(entry => `${entry.name || 'No Name'} (${entry.role || 'No Role'}) - ${entry.phone || 'No Phone'}`)
      .join(' | ')
    : '-';
  document.getElementById('gantt-modal-members').textContent = memberText;

  try {
    const projRes = await fetch('/api/projects');
    const projects = await projRes.json();
    const project = projects.find(p => p.project_name.toLowerCase().includes(clientName.toLowerCase()));

    if (!project) {
      chartDiv.innerHTML = '<p style="color:var(--danger); font-size:0.7rem;">No timeline found.</p>';
      if (fullViewBtn) fullViewBtn.style.display = 'none';
      return;
    }

    if (fullViewBtn) {
      fullViewBtn.style.display = 'inline-flex';
      fullViewBtn.onclick = () => {
        openProjectTimeline(project.id);
      };
    }

    document.getElementById('gantt-modal-title').textContent = `Timeline: ${project.project_name}`;
    document.getElementById('gantt-modal-progress').textContent = Math.round(project.avg_progress || 0) + '%';
    document.getElementById('gantt-modal-tasks').textContent = project.task_count || 0;

    const taskRes = await fetch(`/api/projects/${project.id}/tasks`);
    const tasks = await taskRes.json();

    chartDiv.innerHTML = tasks.map(t => `
      <div style="display: grid; grid-template-columns: 180px 100px 100px 1fr; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--border); align-items: center;">
        <div>
          <div style="font-size: 0.75rem; font-weight: 600; color: var(--primary);">${escHtml(t.task_name)}</div>
          <div style="font-size: 0.6rem; color: var(--text-muted);">${t.start_date} to ${t.end_date}</div>
        </div>
        <div class="text-center" style="font-size: 0.65rem; color: var(--text-secondary);">${escHtml(t.assigned_to || '-')}</div>
        <div class="text-center">
          <span class="status-pill status-${t.status === 'completed' ? 'paid' : (t.status === 'in_progress' ? 'partial' : 'unpaid')}" style="font-size: 0.55rem;">
            ${t.status.replace('_', ' ')}
          </span>
        </div>
        <div style="height: 12px; background: var(--surface-alt); border-radius: 6px; position: relative; overflow: hidden; border: 1px solid var(--border);">
          <div style="height: 100%; background: var(--primary); width: ${t.progress}%; transition: width 0.3s ease;"></div>
        </div>
      </div>
    `).join('') || '<p style="font-size:0.7rem">Walang tasks na nakalista.</p>';
  } catch (e) {
    chartDiv.innerHTML = '<p>Error loading timeline.</p>';
  }
}

function closeGanttModal() {
  document.getElementById('gantt-modal-backdrop').classList.remove('open');
}

const GANTT_PLANNER_STORAGE_KEY = 'kinaadman_gantt_planner_draft_v2';

function getBlankGanttPlannerRows() {
  return [{
    taskName: '',
    startDate: '',
    endDate: '',
    progress: '0',
    assignee: '',
    status: 'pending'
  }];
}

function getSampleGanttPlannerRows() {
  return [
    { taskName: 'Planning', startDate: '2026-04-01', endDate: '2026-04-04', progress: '100', assignee: 'Admin Team', status: 'completed' },
    { taskName: 'Site Survey', startDate: '2026-04-05', endDate: '2026-04-08', progress: '80', assignee: 'Field Team', status: 'in_progress' },
    { taskName: 'Installation', startDate: '2026-04-09', endDate: '2026-04-15', progress: '45', assignee: 'Technical Team', status: 'in_progress' },
    { taskName: 'Testing and Handover', startDate: '2026-04-16', endDate: '2026-04-21', progress: '10', assignee: 'QA Team', status: 'pending' }
  ];
}

function createBlankGanttPlannerState() {
  return {
    projectName: '',
    projectOwner: '',
    projectStart: '',
    projectEnd: '',
    notes: '',
    sourceName: 'Manual planner',
    rows: getBlankGanttPlannerRows(),
    tasks: [],
    range: null
  };
}

function createSampleGanttPlannerState() {
  return {
    projectName: 'PDZ Proposed 30% Progress Rate',
    projectOwner: 'Operations Team',
    projectStart: '2026-04-01',
    projectEnd: '2026-04-21',
    notes: 'Sample plan inspired by the uploaded PDF layout. Edit the rows to match the real scope.',
    sourceName: 'Starter sample',
    rows: getSampleGanttPlannerRows(),
    tasks: [],
    range: null
  };
}

function normalizeGanttPlannerRow(row = {}) {
  return {
    taskName: String(row.taskName ?? row.task_name ?? row.name ?? '').trim(),
    startDate: String(row.startDate ?? row.start_date ?? row.start ?? row.from ?? '').trim(),
    endDate: String(row.endDate ?? row.end_date ?? row.end ?? row.to ?? '').trim(),
    progress: String(row.progress ?? row.percent ?? row.completion ?? '0').trim(),
    assignee: String(row.assignee ?? row.assignedTo ?? row.assigned_to ?? row.owner ?? '').trim(),
    status: String(row.status ?? row.state ?? 'pending').trim()
  };
}

function buildGanttPlannerTaskFromRow(row = {}, index = 0) {
  const normalized = normalizeGanttPlannerRow(row);
  const taskName = normalized.taskName.trim();
  const startDate = parseGanttDate(normalized.startDate);
  const endDate = parseGanttDate(normalized.endDate || normalized.startDate);
  const inferredDate = startDate || endDate;
  if (!taskName && !inferredDate) return null;
  if (!inferredDate) return null;

  const safeStart = startDate || endDate;
  const safeEnd = endDate || startDate;
  const progress = computeGanttProgress({
    progressText: normalized.progress,
    statusText: normalized.status,
    scheduledQty: NaN,
    receivedQty: NaN,
    openQty: NaN,
    startDate: safeStart,
    endDate: safeEnd
  });

  return {
    id: `planner-${index + 1}`,
    taskName: taskName || `Task ${index + 1}`,
    assignee: normalized.assignee || '-',
    status: inferGanttStatus(normalized.status, progress),
    startDate: safeStart,
    endDate: safeEnd,
    progress,
    startLabel: formatImportedDate(safeStart),
    endLabel: formatImportedDate(safeEnd)
  };
}

function loadGanttPlannerDraft() {
  try {
    const raw = localStorage.getItem(GANTT_PLANNER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      ...createBlankGanttPlannerState(),
      ...parsed,
      rows: Array.isArray(parsed.rows) && parsed.rows.length ? parsed.rows.map(normalizeGanttPlannerRow) : getBlankGanttPlannerRows()
    };
  } catch (err) {
    return null;
  }
}

function saveGanttPlannerDraft() {
  try {
    const payload = {
      projectName: ganttPlannerState.projectName || '',
      projectOwner: ganttPlannerState.projectOwner || '',
      projectStart: ganttPlannerState.projectStart || '',
      projectEnd: ganttPlannerState.projectEnd || '',
      notes: ganttPlannerState.notes || '',
      sourceName: ganttPlannerState.sourceName || 'Manual planner',
      rows: Array.isArray(ganttPlannerState.rows) ? ganttPlannerState.rows.map(normalizeGanttPlannerRow) : getBlankGanttPlannerRows()
    };
    localStorage.setItem(GANTT_PLANNER_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {}
}

function readGanttPlannerFormState() {
  const projectName = document.getElementById('gantt-project-name')?.value?.trim() || '';
  const projectOwner = document.getElementById('gantt-project-owner')?.value?.trim() || '';
  const projectStart = document.getElementById('gantt-project-start')?.value || '';
  const projectEnd = document.getElementById('gantt-project-end')?.value || '';
  const notes = document.getElementById('gantt-project-notes')?.value?.trim() || '';
  const rows = Array.from(document.querySelectorAll('#gantt-task-rows tr[data-row-index]')).map((tr) => {
    const get = (field) => tr.querySelector(`[data-field="${field}"]`)?.value ?? '';
    return {
      taskName: get('taskName'),
      startDate: get('startDate'),
      endDate: get('endDate'),
      progress: get('progress'),
      assignee: get('assignee'),
      status: get('status')
    };
  });

  return {
    projectName,
    projectOwner,
    projectStart,
    projectEnd,
    notes,
    rows: rows.length ? rows : getBlankGanttPlannerRows()
  };
}

function renderGanttPlannerEditor() {
  const tbody = document.getElementById('gantt-task-rows');
  if (!tbody) return;

  const rows = Array.isArray(ganttPlannerState.rows) && ganttPlannerState.rows.length
    ? ganttPlannerState.rows
    : getBlankGanttPlannerRows();

  tbody.innerHTML = rows.map((row, index) => {
    const safe = normalizeGanttPlannerRow(row);
    return `
      <tr data-row-index="${index}">
        <td><input type="text" class="gantt-task-input" data-field="taskName" value="${escHtml(safe.taskName)}" placeholder="Task name" oninput="handleGanttPlannerInput()" /></td>
        <td><input type="date" class="gantt-task-input" data-field="startDate" value="${escHtml(safe.startDate)}" oninput="handleGanttPlannerInput()" /></td>
        <td><input type="date" class="gantt-task-input" data-field="endDate" value="${escHtml(safe.endDate)}" oninput="handleGanttPlannerInput()" /></td>
        <td><input type="number" class="gantt-task-input" data-field="progress" min="0" max="100" value="${escHtml(safe.progress || '0')}" oninput="handleGanttPlannerInput()" /></td>
        <td><input type="text" class="gantt-task-input" data-field="assignee" value="${escHtml(safe.assignee)}" placeholder="Assignee" oninput="handleGanttPlannerInput()" /></td>
        <td>
          <select class="gantt-task-input" data-field="status" onchange="handleGanttPlannerInput()">
            <option value="pending"${safe.status === 'pending' ? ' selected' : ''}>Pending</option>
            <option value="in_progress"${safe.status === 'in_progress' ? ' selected' : ''}>In Progress</option>
            <option value="completed"${safe.status === 'completed' ? ' selected' : ''}>Completed</option>
            <option value="on_hold"${safe.status === 'on_hold' ? ' selected' : ''}>On Hold</option>
          </select>
        </td>
        <td class="text-center">
          <button type="button" class="dashboard-range-btn gantt-row-remove" onclick="removeGanttPlannerRow(this)">Remove</button>
        </td>
      </tr>
    `;
  }).join('');
}

function syncGanttPlannerState({ rerenderChart = true, sourceName = null, saveDraft = true } = {}) {
  const formState = readGanttPlannerFormState();
  ganttPlannerState.projectName = formState.projectName;
  ganttPlannerState.projectOwner = formState.projectOwner;
  ganttPlannerState.projectStart = formState.projectStart;
  ganttPlannerState.projectEnd = formState.projectEnd;
  ganttPlannerState.notes = formState.notes;
  ganttPlannerState.rows = formState.rows.map(normalizeGanttPlannerRow);
  ganttPlannerState.sourceName = sourceName || ganttPlannerState.sourceName || 'Manual planner';
  ganttPlannerState.tasks = ganttPlannerState.rows
    .map((row, index) => buildGanttPlannerTaskFromRow(row, index))
    .filter(Boolean);
  ganttPlannerState.range = getImportedGanttRange(ganttPlannerState.tasks);

  if (saveDraft) saveGanttPlannerDraft();
  if (rerenderChart) renderImportedGanttChart();
}

function setupGanttPlannerPanel() {
  const input = document.getElementById('gantt-import-input');
  if (input && input.dataset.bound !== '1') {
    input.dataset.bound = '1';
    input.addEventListener('change', handleGanttImportFile);
  }

  const queryProjectId = Number(new URLSearchParams(window.location.search).get('projectId')) || null;
  const storedDraft = loadGanttPlannerDraft();
  ganttPlannerState = storedDraft || createBlankGanttPlannerState();
  ganttPlannerState.selectedProjectId = queryProjectId || ganttPlannerState.selectedProjectId || getStoredGanttSelectedProjectId();
  ganttPlannerState.dirty = false;

  const projectNameField = document.getElementById('gantt-project-name');
  const projectOwnerField = document.getElementById('gantt-project-owner');
  const projectStartField = document.getElementById('gantt-project-start');
  const projectEndField = document.getElementById('gantt-project-end');
  const projectNotesField = document.getElementById('gantt-project-notes');

  if (projectNameField) projectNameField.value = ganttPlannerState.projectName || '';
  if (projectOwnerField) projectOwnerField.value = ganttPlannerState.projectOwner || '';
  if (projectStartField) projectStartField.value = ganttPlannerState.projectStart || '';
  if (projectEndField) projectEndField.value = ganttPlannerState.projectEnd || '';
  if (projectNotesField) projectNotesField.value = ganttPlannerState.notes || '';

  if (!Array.isArray(ganttPlannerState.rows) || !ganttPlannerState.rows.length) {
    ganttPlannerState.rows = getBlankGanttPlannerRows();
  }

  renderGanttPlannerEditor();
  renderGanttProjectSwitcher();
  syncGanttPlannerState({ rerenderChart: true, saveDraft: false });

  loadProjectsDashboardData()
    .then(async () => {
      renderGanttProjectSwitcher();
      const availableProjects = getGanttPlannerProjects();
      const selectedId = ganttPlannerState.selectedProjectId && availableProjects.some(project => Number(project.id) === Number(ganttPlannerState.selectedProjectId))
        ? Number(ganttPlannerState.selectedProjectId)
        : (availableProjects[0]?.id || null);

      if (selectedId) {
        await selectGanttProject(selectedId, { persistSelection: true });
      } else {
        ganttPlannerState.selectedProjectId = null;
        renderGanttProjectSwitcher();
        renderImportedGanttChart();
      }
    })
    .catch((err) => {
      console.error('Gantt project bootstrap error:', err);
      renderGanttProjectSwitcher();
      renderImportedGanttChart();
    });
}

async function handleGanttImportFile(event) {
  const file = event?.target?.files?.[0];
  if (file) {
    await importGanttFromFile(file);
  }
  if (event?.target) {
    event.target.value = '';
  }
}

function handleGanttPlannerInput() {
  ganttPlannerState.dirty = true;
  syncGanttPlannerState({ rerenderChart: true, saveDraft: true });
}

function refreshGanttPlannerChart() {
  syncGanttPlannerState({ rerenderChart: true, saveDraft: true });
  showToast('Gantt chart refreshed.', 'success');
}

function getStoredGanttSelectedProjectId() {
  return Number(localStorage.getItem('kinaadman_gantt_selected_project_id') || 0) || null;
}

function setStoredGanttSelectedProjectId(projectId) {
  if (projectId) {
    localStorage.setItem('kinaadman_gantt_selected_project_id', String(projectId));
  } else {
    localStorage.removeItem('kinaadman_gantt_selected_project_id');
  }
}

function getGanttPlannerProjects() {
  return (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
    .filter(project => Number(project.is_archived || 0) === 0)
    .sort((a, b) => String(formatDateYmd(getProjectEffectiveStartDate(a))).localeCompare(String(formatDateYmd(getProjectEffectiveStartDate(b)))));
}

function getGanttProjectById(projectId) {
  const id = Number(projectId);
  if (!id) return null;
  return getGanttPlannerProjects().find(project => Number(project.id) === id) || (projectsDashboardDb || []).find(project => Number(project.id) === id) || null;
}

function formatGanttProjectRangeText(project) {
  if (!project) return 'Select a project to begin.';
  const start = formatDateYmd(getProjectEffectiveStartDate(project));
  const end = formatDateYmd(getProjectEffectiveEndDate(project));
  return `${start} to ${end}`;
}

function taskRowFromDb(task, index = 0) {
  return {
    taskName: String(task?.task_name || `Task ${index + 1}`).trim(),
    startDate: formatDateYmd(task?.start_date || ''),
    endDate: formatDateYmd(task?.end_date || ''),
    progress: String(task?.progress ?? '0'),
    assignee: String(task?.assigned_to || '').trim(),
    status: String(task?.status || 'not_started').trim()
  };
}

function taskPayloadFromPlannerRow(row, index = 0) {
  const normalized = normalizeGanttPlannerRow(row);
  const start = parseGanttDate(normalized.startDate);
  const end = parseGanttDate(normalized.endDate || normalized.startDate);
  const startDate = start ? formatDateYmd(start) : normalized.startDate || null;
  const endDate = end ? formatDateYmd(end) : normalized.endDate || startDate || null;
  const status = ['not_started', 'in_progress', 'on_hold', 'completed', 'cancelled'].includes(String(normalized.status || '').toLowerCase())
    ? String(normalized.status || '').toLowerCase()
    : inferGanttStatus(normalized.status, Number(normalized.progress || 0));
  return {
    task_name: normalized.taskName || `Task ${index + 1}`,
    start_date: startDate,
    end_date: endDate,
    progress: Math.max(0, Math.min(100, Number(normalized.progress || 0) || 0)),
    assigned_to: normalized.assignee || null,
    status: status === 'pending' ? 'not_started' : status,
    plan_cost: 0,
    actual_cost: 0
  };
}

function renderGanttProjectSwitcher() {
  const select = document.getElementById('gantt-project-select');
  const cards = document.getElementById('gantt-project-cards');
  const summary = document.getElementById('gantt-project-summary');
  const projects = getGanttPlannerProjects();
  const selectedId = Number(ganttPlannerState.selectedProjectId || 0) || null;

  if (select) {
    select.innerHTML = projects.length
      ? `<option value="">Choose a project...</option>` + projects.map(project => {
          const isSelected = Number(project.id) === selectedId;
          return `<option value="${Number(project.id)}"${isSelected ? ' selected' : ''}>${escHtml(project.project_name || 'Untitled Project')}</option>`;
        }).join('')
      : `<option value="">No projects yet</option>`;
    select.value = selectedId ? String(selectedId) : '';
  }

  if (cards) {
    if (!projects.length) {
      cards.innerHTML = '<div class="gantt-project-empty">No projects yet. Create one to start planning tasks.</div>';
    } else {
      cards.innerHTML = projects.map((project) => {
        const isActive = Number(project.id) === selectedId;
        const statusLabel = getProjectLifecycleLabel(project).replace(/_/g, ' ');
        const taskCount = Number(project.task_count || 0);
        const progress = Math.round(Number(project.avg_progress || 0));
        return `
          <button type="button" class="gantt-project-card${isActive ? ' is-active' : ''}" onclick="selectGanttProject(${Number(project.id)})">
            <strong>${escHtml(project.project_name || 'Untitled Project')}</strong>
            <span>${escHtml(statusLabel)} · ${taskCount} task(s)</span>
            <small>${escHtml(formatGanttProjectRangeText(project))}</small>
            <div class="gantt-project-card-footer">
              <span>${escHtml(project.project_manager || 'No owner')}</span>
              <span>${progress}%</span>
            </div>
          </button>
        `;
      }).join('');
    }
  }

  if (summary) {
    const project = getGanttProjectById(selectedId);
    summary.innerHTML = project
      ? `
        <strong>${escHtml(project.project_name || 'Untitled Project')}</strong>
        <span>${escHtml(project.project_manager || 'No owner')}</span>
        <small>${escHtml(formatGanttProjectRangeText(project))}</small>
      `
      : `<strong>Select a project</strong><span>Use the project list to load a board.</span><small>Tasks are saved per project.</small>`;
  }
}

async function loadGanttProject(projectId, { persistSelection = true } = {}) {
  const id = Number(projectId);
  if (!id) {
    ganttPlannerState.selectedProjectId = null;
    ganttPlannerState.rows = getBlankGanttPlannerRows();
    ganttPlannerState.tasks = [];
    ganttPlannerState.range = null;
    ganttPlannerState.dirty = false;
    setStoredGanttSelectedProjectId(null);
    renderGanttPlannerEditor();
    renderGanttProjectSwitcher();
    renderImportedGanttChart();
    return null;
  }

  const summaryRes = await fetch(`/api/projects/${id}/summary`);
  const summary = await summaryRes.json().catch(() => ({}));
  if (!summaryRes.ok) {
    throw new Error(summary.error || 'Unable to load project summary.');
  }

  const tasksRes = await fetch(`/api/projects/${id}/tasks`);
  const tasks = await tasksRes.json().catch(() => []);
  if (!tasksRes.ok) {
    throw new Error(Array.isArray(tasks) ? 'Unable to load project tasks.' : (tasks.error || 'Unable to load project tasks.'));
  }

  ganttPlannerState.selectedProjectId = id;
  ganttPlannerState.projectName = summary.project_name || '';
  ganttPlannerState.projectOwner = summary.project_manager || '';
  ganttPlannerState.projectStart = formatDateYmd(summary.planned_start_date || summary.start_date || summary.actual_start_date);
  ganttPlannerState.projectEnd = formatDateYmd(summary.planned_end_date || summary.end_date || summary.actual_end_date);
  ganttPlannerState.notes = summary.description || '';
  ganttPlannerState.rows = Array.isArray(tasks) && tasks.length
    ? tasks.map(taskRowFromDb)
    : getBlankGanttPlannerRows();
  ganttPlannerState.tasks = ganttPlannerState.rows.map((row, index) => buildGanttPlannerTaskFromRow(row, index)).filter(Boolean);
  ganttPlannerState.range = getImportedGanttRange(ganttPlannerState.tasks);
  ganttPlannerState.sourceName = summary.project_name || 'Selected project';
  ganttPlannerState.dirty = false;

  const projectNameField = document.getElementById('gantt-project-name');
  const projectOwnerField = document.getElementById('gantt-project-owner');
  const projectStartField = document.getElementById('gantt-project-start');
  const projectEndField = document.getElementById('gantt-project-end');
  const projectNotesField = document.getElementById('gantt-project-notes');
  if (projectNameField) projectNameField.value = ganttPlannerState.projectName || '';
  if (projectOwnerField) projectOwnerField.value = ganttPlannerState.projectOwner || '';
  if (projectStartField) projectStartField.value = ganttPlannerState.projectStart || '';
  if (projectEndField) projectEndField.value = ganttPlannerState.projectEnd || '';
  if (projectNotesField) projectNotesField.value = ganttPlannerState.notes || '';

  renderGanttPlannerEditor();
  renderGanttProjectSwitcher();
  syncGanttPlannerState({ rerenderChart: true, sourceName: ganttPlannerState.sourceName, saveDraft: false });

  if (persistSelection) {
    setStoredGanttSelectedProjectId(id);
  }

  return summary;
}

async function selectGanttProject(projectId, { persistSelection = true } = {}) {
  const nextId = Number(projectId) || null;
  const currentId = Number(ganttPlannerState.selectedProjectId || 0) || null;
  if (nextId === currentId) {
    return loadGanttProject(nextId, { persistSelection });
  }

  if (ganttPlannerState.dirty && currentId && nextId) {
    const shouldSave = window.confirm('Save changes to the current project before switching?');
    if (shouldSave) {
      const saved = await saveGanttProjectTasks({ silent: true });
      if (!saved) return null;
    }
  }

  return loadGanttProject(nextId, { persistSelection });
}

async function saveGanttProjectTasks({ silent = false } = {}) {
  const projectId = Number(ganttPlannerState.selectedProjectId || 0) || null;
  if (!projectId) {
    if (!silent) showToast('Select a project first.', 'error');
    return false;
  }

  const currentState = readGanttPlannerFormState();
  ganttPlannerState.projectName = currentState.projectName || ganttPlannerState.projectName || '';
  ganttPlannerState.projectOwner = currentState.projectOwner || ganttPlannerState.projectOwner || '';
  ganttPlannerState.projectStart = currentState.projectStart || ganttPlannerState.projectStart || '';
  ganttPlannerState.projectEnd = currentState.projectEnd || ganttPlannerState.projectEnd || '';
  ganttPlannerState.notes = currentState.notes || ganttPlannerState.notes || '';
  ganttPlannerState.rows = currentState.rows.map(normalizeGanttPlannerRow);

  const payload = {
    tasks: ganttPlannerState.rows.map((row, index) => taskPayloadFromPlannerRow(row, index))
  };

  const res = await fetch(`/api/projects/${projectId}/tasks`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (!silent) showToast(data.error || 'Unable to save tasks for this project.', 'error');
    return false;
  }

  ganttPlannerState.tasks = ganttPlannerState.rows.map((row, index) => buildGanttPlannerTaskFromRow(row, index)).filter(Boolean);
  ganttPlannerState.range = getImportedGanttRange(ganttPlannerState.tasks);
  ganttPlannerState.dirty = false;
  saveGanttPlannerDraft();
  renderGanttProjectSwitcher();
  renderImportedGanttChart();
  await loadProjectsDashboardData();
  if (!silent) showToast(`Saved ${Number(data.totalTasks || payload.tasks.length)} task(s) for this project.`, 'success');
  return true;
}

function openGanttNewProjectModal() {
  window.__ganttProjectAfterSave = async (projectId) => {
    await loadProjectsDashboardData();
    await selectGanttProject(projectId, { persistSelection: true });
  };
  openProjectModal();
}

function openSelectedProjectModal() {
  const projectId = Number(ganttPlannerState.selectedProjectId || 0) || null;
  if (!projectId) {
    showToast('Select or create a project first.', 'error');
    return;
  }

  window.__ganttProjectAfterSave = async (savedProjectId) => {
    await loadProjectsDashboardData();
    await selectGanttProject(savedProjectId || projectId, { persistSelection: true });
  };
  openProjectModal(projectId);
}

function addGanttPlannerRow(initialRow = {}) {
  const current = readGanttPlannerFormState();
  ganttPlannerState.projectName = current.projectName || ganttPlannerState.projectName || '';
  ganttPlannerState.projectOwner = current.projectOwner || ganttPlannerState.projectOwner || '';
  ganttPlannerState.projectStart = current.projectStart || ganttPlannerState.projectStart || '';
  ganttPlannerState.projectEnd = current.projectEnd || ganttPlannerState.projectEnd || '';
  ganttPlannerState.notes = current.notes || ganttPlannerState.notes || '';
  ganttPlannerState.rows = current.rows.map(normalizeGanttPlannerRow);
  ganttPlannerState.rows.push(normalizeGanttPlannerRow(initialRow));
  ganttPlannerState.dirty = true;
  renderGanttPlannerEditor();
  syncGanttPlannerState({ rerenderChart: true, saveDraft: true });
}

function removeGanttPlannerRow(button) {
  const row = button?.closest('tr');
  if (!row) return;
  const index = Number(row.dataset.rowIndex);
  if (!Number.isInteger(index)) return;

  const current = readGanttPlannerFormState();
  const rows = current.rows.map(normalizeGanttPlannerRow);
  rows.splice(index, 1);
  ganttPlannerState.rows = rows.length ? rows : getBlankGanttPlannerRows();
  ganttPlannerState.dirty = true;
  renderGanttPlannerEditor();
  syncGanttPlannerState({ rerenderChart: true, saveDraft: true });
}

function clearImportedGanttChart() {
  if (ganttPlannerState.selectedProjectId) {
    ganttPlannerState.rows = getBlankGanttPlannerRows();
    ganttPlannerState.tasks = [];
    ganttPlannerState.range = null;
    ganttPlannerState.dirty = true;
    renderGanttPlannerEditor();
    renderGanttProjectSwitcher();
    syncGanttPlannerState({ rerenderChart: true, saveDraft: true });
    showToast('Current project tasks cleared. Save to apply them to the project.', 'success');
    return;
  }

  ganttPlannerState = createBlankGanttPlannerState();
  renderGanttPlannerEditor();
  const projectNameField = document.getElementById('gantt-project-name');
  const projectOwnerField = document.getElementById('gantt-project-owner');
  const projectStartField = document.getElementById('gantt-project-start');
  const projectEndField = document.getElementById('gantt-project-end');
  const projectNotesField = document.getElementById('gantt-project-notes');
  if (projectNameField) projectNameField.value = '';
  if (projectOwnerField) projectOwnerField.value = '';
  if (projectStartField) projectStartField.value = '';
  if (projectEndField) projectEndField.value = '';
  if (projectNotesField) projectNotesField.value = '';
  saveGanttPlannerDraft();
  renderImportedGanttChart();
  showToast('Planner cleared.', 'success');
}

function loadSampleGanttData() {
  const sample = createSampleGanttPlannerState();
  ganttPlannerState.projectName = sample.projectName;
  ganttPlannerState.projectOwner = sample.projectOwner;
  ganttPlannerState.projectStart = sample.projectStart;
  ganttPlannerState.projectEnd = sample.projectEnd;
  ganttPlannerState.notes = sample.notes;
  ganttPlannerState.rows = sample.rows;
  ganttPlannerState.sourceName = 'Sample task set';
  ganttPlannerState.dirty = true;
  const projectNameField = document.getElementById('gantt-project-name');
  const projectOwnerField = document.getElementById('gantt-project-owner');
  const projectStartField = document.getElementById('gantt-project-start');
  const projectEndField = document.getElementById('gantt-project-end');
  const projectNotesField = document.getElementById('gantt-project-notes');
  if (projectNameField) projectNameField.value = ganttPlannerState.projectName;
  if (projectOwnerField) projectOwnerField.value = ganttPlannerState.projectOwner;
  if (projectStartField) projectStartField.value = ganttPlannerState.projectStart;
  if (projectEndField) projectEndField.value = ganttPlannerState.projectEnd;
  if (projectNotesField) projectNotesField.value = ganttPlannerState.notes;
  renderGanttPlannerEditor();
  renderGanttProjectSwitcher();
  syncGanttPlannerState({ rerenderChart: true, sourceName: ganttPlannerState.sourceName });
  showToast('Sample task set loaded for the current project.', 'success');
}

function exportGanttPlanCsv() {
  const state = readGanttPlannerFormState();
  const rows = state.rows.map((row) => normalizeGanttPlannerRow(row));
  if (!rows.length) {
    showToast('Add at least one task first.', 'error');
    return;
  }

  const headers = ['Project Name', 'Task Name', 'Start Date', 'End Date', 'Progress', 'Assignee', 'Status', 'Notes'];
  const csvRows = [headers];
  rows.forEach((row) => {
    csvRows.push([
      state.projectName || '',
      row.taskName || '',
      row.startDate || '',
      row.endDate || '',
      row.progress || '0',
      row.assignee || '',
      row.status || 'pending',
      state.notes || ''
    ]);
  });

  const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = csvRows.map(row => row.map(escapeCsv).join(',')).join('\r\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(state.projectName || 'gantt-plan').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'gantt-plan'}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadGanttTemplate() {
  const headers = ['Project Name', 'Task Name', 'Start Date', 'End Date', 'Progress', 'Assignee', 'Status', 'Notes'];
  const rows = [
    headers,
    ['PDZ Proposed 30% Progress Rate', 'Planning', '2026-04-01', '2026-04-04', '100', 'Admin Team', 'completed', 'Sample row'],
    ['PDZ Proposed 30% Progress Rate', 'Site Survey', '2026-04-05', '2026-04-08', '80', 'Field Team', 'in_progress', 'Sample row']
  ];

  const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = rows.map(row => row.map(escapeCsv).join(',')).join('\r\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'gantt-template.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function importGanttFromFile(file) {
  const summary = document.getElementById('gantt-import-summary');
  const fileName = String(file?.name || 'Imported file');

  if (summary) {
    summary.textContent = `Reading ${fileName}...`;
  }

  try {
    const rows = await readImportedGanttRows(file);
    const tasks = normalizeImportedGanttRows(rows, fileName);

    if (!tasks.length) {
      throw new Error('No usable task rows were found. Please check the file columns and dates.');
    }

    const selectedProject = getGanttProjectById(ganttPlannerState.selectedProjectId);
    ganttPlannerState = {
      ...ganttPlannerState,
      projectName: selectedProject?.project_name || fileName.replace(/\.[^.]+$/, '') || fileName,
      projectOwner: selectedProject?.project_manager || ganttPlannerState.projectOwner || '',
      projectStart: selectedProject ? formatDateYmd(getProjectEffectiveStartDate(selectedProject)) : ganttPlannerState.projectStart || '',
      projectEnd: selectedProject ? formatDateYmd(getProjectEffectiveEndDate(selectedProject)) : ganttPlannerState.projectEnd || '',
      notes: selectedProject?.description || ganttPlannerState.notes || '',
      sourceName: fileName,
      rows: tasks.map(task => ({
        taskName: task.taskName,
        startDate: task.startLabel === '-' ? '' : task.startLabel,
        endDate: task.endLabel === '-' ? '' : task.endLabel,
        progress: String(task.progress ?? '0'),
        assignee: task.assignee || '',
        status: task.status || 'pending'
      })),
      dirty: true
    };
    renderGanttPlannerEditor();
    renderGanttProjectSwitcher();
    syncGanttPlannerState({ rerenderChart: true, sourceName: fileName });
    renderImportedGanttChart();
    showToast(`Imported ${tasks.length} Gantt task(s) from ${fileName}.`, 'success');
  } catch (error) {
    console.error('Gantt import error:', error);
    ganttPlannerState = createBlankGanttPlannerState();
    renderGanttPlannerEditor();
    renderGanttProjectSwitcher();
    renderImportedGanttChart();
    if (summary) {
      summary.textContent = String(file?.name || '').toLowerCase().endsWith('.pdf')
        ? 'Upload failed. This PDF does not appear to contain clean extractable text. Use a text-based PDF, CSV, or XLSX.'
        : 'Upload failed. Use a file with project, task, start date, end date, progress, and assignee columns.';
    }
    showToast(error.message || 'Unable to import the file.', 'error');
  }
}

function isLocalTextGanttFile(file) {
  const fileName = String(file?.name || '').toLowerCase();
  return fileName.endsWith('.csv') || fileName.endsWith('.tsv') || fileName.endsWith('.txt');
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Unable to read the uploaded file.'));
    reader.readAsText(file);
  });
}

async function readImportedGanttRows(file) {
  if (isLocalTextGanttFile(file)) {
    const localText = await readFileAsText(file);
    const localRows = parseDelimitedRows(localText);
    if (localRows.length) {
      return localRows;
    }
  }

  const formData = new FormData();
  formData.append('file', file);

  let res;
  try {
    res = await fetch('/api/gantt/import', {
      method: 'POST',
      body: formData
    });
  } catch (networkErr) {
    if (isLocalTextGanttFile(file)) {
      const localText = await readFileAsText(file);
      const localRows = parseDelimitedRows(localText);
      if (localRows.length) {
        return localRows;
      }
    }
    throw new Error('Gantt import service is unavailable. Restart the server or upload CSV.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404 && isLocalTextGanttFile(file)) {
      const localText = await readFileAsText(file);
      const localRows = parseDelimitedRows(localText);
      if (localRows.length) {
        return localRows;
      }
    }

    if (res.status === 404) {
      throw new Error('Gantt import endpoint is unavailable. Restart the Node server, or save the file as CSV.');
    }

    throw new Error(data.error || 'Unable to parse uploaded file.');
  }

  return Array.isArray(data.rows) ? data.rows : [];
}

function parseDelimitedRows(text) {
  const source = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = source.split('\n').filter(line => String(line).trim() !== '');
  if (!lines.length) return [];

  const delimiter = detectDelimiter(lines[0]);
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let inQuotes = false;

  const pushCell = () => {
    currentRow.push(currentCell);
    currentCell = '';
  };

  const pushRow = () => {
    if (currentRow.some(cell => String(cell).trim() !== '')) {
      rows.push(currentRow);
    }
    currentRow = [];
  };

  const input = lines.join('\n');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      pushCell();
      continue;
    }

    if (!inQuotes && char === '\n') {
      pushCell();
      pushRow();
      continue;
    }

    currentCell += char;
  }

  pushCell();
  pushRow();
  return rows.filter(row => Array.isArray(row) && row.some(cell => String(cell || '').trim() !== ''));
}

function parsePdfRowsFromText(text) {
  const source = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = source.split('\n').map(line => line.trim()).filter(line => line !== '');
  const rows = [];

  lines.forEach((line) => {
    if (/^[\s\W_-]+$/.test(line)) return;

    let cells = [];
    if (line.includes('|')) {
      cells = line.split('|').map(cell => cell.trim()).filter(cell => cell !== '');
    } else if (line.includes('\t')) {
      cells = line.split('\t').map(cell => cell.trim()).filter(cell => cell !== '');
    } else {
      cells = line.split(/\s{2,}/).map(cell => cell.trim()).filter(cell => cell !== '');
    }

    if (cells.length <= 1) {
      const dateMatches = line.match(/\b\d{4}-\d{1,2}-\d{1,2}\b/g) || line.match(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g) || [];
      if (dateMatches.length >= 2) {
        const [firstDate, secondDate] = dateMatches;
        const task = line.replace(firstDate, '').replace(secondDate, '').replace(/\s{2,}/g, ' ').trim();
        cells = task ? [task, firstDate, secondDate] : [line, firstDate, secondDate];
      }
    }

    if (cells.length) {
      rows.push(cells);
    }
  });

  return rows;
}

function detectDelimiter(line) {
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestScore = -1;

  candidates.forEach((candidate) => {
    const score = String(line || '').split(candidate).length - 1;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  });

  return best;
}

function normalizeImportedGanttRows(rows, sourceName = '') {
  const cleanedRows = Array.isArray(rows)
    ? rows.filter(row => Array.isArray(row) ? row.some(cell => String(cell || '').trim() !== '') : String(row || '').trim() !== '')
    : [];

  if (!cleanedRows.length) return [];

  const firstRow = Array.isArray(cleanedRows[0]) ? cleanedRows[0] : [cleanedRows[0]];
  const normalizedFirstRow = firstRow.map(cell => normalizeGanttHeader(cell));
  const hasHeaders = normalizedFirstRow.some(cell => /task|start|end|progress|assignee|owner|status|name|description/.test(cell));
  const headers = hasHeaders ? normalizedFirstRow : null;
  const dataRows = hasHeaders ? cleanedRows.slice(1) : cleanedRows;

  return dataRows
    .map((row, index) => normalizeImportedGanttRow(row, index, headers, sourceName))
    .filter(Boolean);
}

function normalizeImportedGanttRow(row, index, headers, sourceName) {
  const values = Array.isArray(row) ? row : [row];
  const headerMap = new Map();

  if (headers) {
    headers.forEach((header, headerIndex) => {
      headerMap.set(header, values[headerIndex]);
    });
  }

  const pickValue = (aliases, fallbackIndexList = []) => {
    for (const alias of aliases) {
      const normalizedAlias = normalizeGanttHeader(alias);
      if (headerMap.has(normalizedAlias)) {
        const value = headerMap.get(normalizedAlias);
        if (String(value || '').trim() !== '') return value;
      }
    }

    for (const fallbackIndex of fallbackIndexList) {
      const value = values[fallbackIndex];
      if (String(value || '').trim() !== '') return value;
    }

    return '';
  };

  const pickNumber = (aliases, fallbackIndexList = []) => {
    const raw = pickValue(aliases, fallbackIndexList);
    const normalized = String(raw || '')
      .replace(/,/g, '')
      .replace(/[^0-9.\-]/g, '')
      .trim();
    if (!normalized) return NaN;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  };

  const taskName = String(pickValue([
    'task name',
    'task',
    'activity',
    'description',
    'project',
    'name',
    'material desc',
    'material description',
    'item',
    'item description'
  ], [0, 1, 2])).trim();
  const assignee = String(pickValue([
    'assignee',
    'assigned to',
    'owner',
    'responsible',
    'person',
    'vendor desc',
    'vendor',
    'person in charge',
    'person-in-charge',
    'zama person in charge',
    'zama person-in-charge'
  ], [4, 3, 5])).trim();
  const statusText = String(pickValue(['status', 'state', 'phase', 'remarks'], [5, 4, 3])).trim();
  const startText = String(pickValue([
    'start date',
    'start',
    'begin',
    'from',
    'po document date',
    'purchase order date',
    'doc date',
    'document date',
    'order date',
    'release date'
  ], [1, 0, 2])).trim();
  const endText = String(pickValue([
    'end date',
    'end',
    'finish',
    'to',
    'del date',
    'delivery date',
    'due date',
    'deadline'
  ], [2, 1, 3])).trim();
  const progressText = String(pickValue([
    'progress',
    'percent',
    '%',
    'completion',
    'gr qty',
    'received qty',
    'open qty'
  ], [3, 5, 4])).trim();
  const scheduledQty = pickNumber(['scheduled qty', 'schd qty', 'planned qty', 'quantity', 'qty', 'order qty', 'po qty'], [6, 7, 8]);
  const receivedQty = pickNumber(['gr qty', 'received qty', 'done qty', 'completed qty'], [10, 11, 12]);
  const openQty = pickNumber(['open qty', 'remaining qty', 'pending qty'], [12, 13, 14]);

  const startDate = parseGanttDate(startText);
  const endDate = parseGanttDate(endText || startText);
  const inferredDate = startDate || endDate;

  if (!taskName && !startDate && !endDate) return null;
  if (!inferredDate) return null;

  const safeStart = startDate || endDate;
  const safeEnd = endDate || startDate;
  const progress = computeGanttProgress({
    progressText,
    statusText,
    scheduledQty,
    receivedQty,
    openQty,
    startDate: safeStart,
    endDate: safeEnd
  });
  const status = inferGanttStatus(statusText, progress);

  return {
    id: `${sourceName || 'gantt'}-${index + 1}`,
    taskName: taskName || `Task ${index + 1}`,
    assignee: assignee || '-',
    status,
    startDate: safeStart,
    endDate: safeEnd,
    progress,
    startLabel: formatImportedDate(safeStart),
    endLabel: formatImportedDate(safeEnd)
  };
}

function normalizeGanttHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[._\-\/]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function parseGanttDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    if (year < 1900 || year > 2100) return null;
    return new Date(year, value.getMonth(), value.getDate());
  }

  const text = String(value || '').trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const yearNum = Number(year);
    if (yearNum < 1900 || yearNum > 2100) return null;
    const date = new Date(yearNum, Number(month) - 1, Number(day));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const slashMatch = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slashMatch) {
    let [, first, second, year] = slashMatch;
    const firstNum = Number(first);
    const secondNum = Number(second);
    const yearNum = Number(year.length === 2 ? `20${year}` : year);
    if (yearNum < 1900 || yearNum > 2100) return null;
    const monthNum = firstNum > 12 ? secondNum : firstNum;
    const dayNum = firstNum > 12 ? firstNum : secondNum;
    const date = new Date(yearNum, monthNum - 1, dayNum);
    if (!Number.isNaN(date.getTime())) return date;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() >= 1900 && parsed.getFullYear() <= 2100) {
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  return null;
}

function computeGanttProgress({ progressText, statusText, scheduledQty, receivedQty, openQty, startDate, endDate }) {
  const status = String(statusText || '').trim().toLowerCase();
  if (/complete|done|closed|finished|completed/.test(status)) {
    return 100;
  }

  const explicitProgress = Number(String(progressText || '').replace(/[^0-9.]/g, ''));
  if (!Number.isNaN(explicitProgress) && progressText !== '') {
    return Math.max(0, Math.min(100, explicitProgress));
  }

  const hasReceived = Number.isFinite(receivedQty);
  const hasOpen = Number.isFinite(openQty);
  const hasScheduled = Number.isFinite(scheduledQty);

  if (hasReceived && hasOpen && (receivedQty + openQty) > 0) {
    return Math.max(0, Math.min(100, Math.round((receivedQty / (receivedQty + openQty)) * 100)));
  }

  if (hasReceived && hasScheduled && scheduledQty > 0) {
    return Math.max(0, Math.min(100, Math.round((receivedQty / scheduledQty) * 100)));
  }

  if (hasOpen && hasScheduled && scheduledQty > 0) {
    return Math.max(0, Math.min(100, Math.round(((scheduledQty - openQty) / scheduledQty) * 100)));
  }

  if (!startDate || !endDate) {
    return /progress|ongoing|in progress/.test(status) ? 50 : 0;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const totalDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const elapsedDays = Math.round((today - start) / 86400000) + 1;

  if (today < start) return 0;
  if (today >= end) return 100;
  return Math.max(0, Math.min(100, Math.round((elapsedDays / totalDays) * 100)));
}

function inferGanttStatus(statusText, progress) {
  const status = String(statusText || '').trim().toLowerCase();
  if (/complete|done|closed|finished|completed/.test(status) || Number(progress) >= 100) {
    return 'completed';
  }
  if (/hold|paused|blocked|on hold/.test(status)) {
    return 'on_hold';
  }
  if (/ongoing|in progress|progress|active|working|started|partial/.test(status) || Number(progress) > 0) {
    return 'in_progress';
  }
  return 'pending';
}

function formatImportedDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '-';
  if (typeof formatDateYmd === 'function') return formatDateYmd(date);
  return date.toLocaleDateString('en-PH');
}

function getImportedGanttRange(tasks) {
  const safeTasks = Array.isArray(tasks) ? tasks.filter(task => task?.startDate instanceof Date && task?.endDate instanceof Date) : [];
  if (!safeTasks.length) return null;

  const min = safeTasks.reduce((lowest, task) => (task.startDate < lowest ? task.startDate : lowest), safeTasks[0].startDate);
  const max = safeTasks.reduce((highest, task) => (task.endDate > highest ? task.endDate : highest), safeTasks[0].endDate);
  const totalDays = Math.max(1, Math.round((max - min) / 86400000) + 1);

  return { min, max, totalDays };
}

function buildImportedTimelineLabel(range) {
  if (!range) return '';
  const start = formatImportedDate(range.min);
  const end = formatImportedDate(range.max);
  return `${start} to ${end}`;
}

function getImportedStatusLabel(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'completed') return 'Completed';
  if (value === 'in_progress') return 'In Progress';
  if (value === 'on_hold') return 'On Hold';
  return 'Pending';
}

function getImportedStatusClass(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'completed') return 'status-paid';
  if (value === 'in_progress') return 'status-partial';
  if (value === 'on_hold') return 'status-unpaid';
  return 'status-unpaid';
}

function renderImportedGanttChart() {
  const render = document.getElementById('gantt-import-render');
  const summary = document.getElementById('gantt-import-summary');
  const totalEl = document.getElementById('gantt-import-total');
  const completedEl = document.getElementById('gantt-import-completed');
  const progressingEl = document.getElementById('gantt-import-progressing');
  const overallEl = document.getElementById('gantt-import-overall');

  if (!render) return;

  const tasks = Array.isArray(ganttPlannerState.tasks) ? ganttPlannerState.tasks : [];
  const range = ganttPlannerState.range || getImportedGanttRange(tasks);
  const hasTasks = tasks.length > 0 && range;

  if (!hasTasks) {
    if (summary) {
      summary.textContent = 'No tasks yet.';
    }
    if (totalEl) totalEl.textContent = '0';
    if (completedEl) completedEl.textContent = '0';
    if (progressingEl) progressingEl.textContent = '0';
    if (overallEl) overallEl.textContent = '0%';
    render.innerHTML = '<div class="gantt-import-empty">No tasks yet.</div>';
    return;
  }

  const completedCount = tasks.filter(task => Number(task.progress) >= 100 || task.status === 'completed').length;
  const inProgressCount = tasks.filter(task => Number(task.progress) > 0 && Number(task.progress) < 100).length;
  const overallProgress = Math.round(tasks.reduce((sum, task) => sum + Math.max(0, Math.min(100, Number(task.progress) || 0)), 0) / tasks.length);
  const timelineLabel = buildImportedTimelineLabel(range);

  if (summary) {
    const source = ganttPlannerState.sourceName ? ` from ${ganttPlannerState.sourceName}` : '';
    const project = ganttPlannerState.projectName ? ` for ${ganttPlannerState.projectName}` : '';
    summary.textContent = `${tasks.length} task(s)${project}${source} • ${timelineLabel}.`;
  }
  if (totalEl) totalEl.textContent = String(tasks.length);
  if (completedEl) completedEl.textContent = String(completedCount);
  if (progressingEl) progressingEl.textContent = String(inProgressCount);
  if (overallEl) overallEl.textContent = `${overallProgress}%`;

  const totalDays = range.totalDays || 1;
  const dayMs = 86400000;

  render.innerHTML = tasks.map(task => {
    const startOffset = Math.max(0, Math.round((task.startDate - range.min) / dayMs));
    const durationDays = Math.max(1, Math.round((task.endDate - task.startDate) / dayMs) + 1);
    const left = (startOffset / totalDays) * 100;
    const width = (durationDays / totalDays) * 100;
    const statusClass = getImportedStatusClass(task.status);
    const statusLabel = getImportedStatusLabel(task.status);
    const progress = Math.max(0, Math.min(100, Number(task.progress) || 0));

    return `
      <div class="gantt-import-row">
        <div class="gantt-import-name">
          <strong>${escHtml(task.taskName)}</strong>
          <span>${escHtml(task.startLabel)} to ${escHtml(task.endLabel)}</span>
        </div>
        <div class="gantt-import-assignee text-center">${escHtml(task.assignee || '-')}</div>
        <div class="gantt-import-status text-center">
          <span class="status-pill ${statusClass}">${escHtml(statusLabel)}</span>
        </div>
        <div class="gantt-import-progress text-center">${progress}%</div>
        <div>
          <div class="gantt-import-track" title="${escHtml(task.taskName)} (${escHtml(task.startLabel)} to ${escHtml(task.endLabel)})">
            <div class="gantt-import-bar" style="left:${left}%; width:${width}%; --gantt-progress:${progress}%;"></div>
          </div>
          <div class="gantt-import-track-labels">
            <span>${escHtml(task.startLabel)}</span>
            <span>${escHtml(task.endLabel)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function getModalFieldLabelBaseText(label) {
  if (!label) return '';
  const cached = String(label.dataset.labelBase || '').trim();
  if (cached) return cached;
  const base = Array.from(label.childNodes)
    .map((node) => (node.nodeType === 3 ? node.textContent : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || String(label.textContent || '').replace(/\s+/g, ' ').trim();
  const normalizedBase = base.replace(/\s*\*+\s*$/, '').trim();
  label.dataset.labelBase = normalizedBase;
  return normalizedBase;
}

function getModalFieldStatus(field, label, control) {
  const explicitStatus = String(
    field?.dataset.fieldStatus ||
    label?.dataset.fieldStatus ||
    control?.dataset.fieldStatus ||
    ''
  ).trim().toLowerCase();
  if (explicitStatus === 'required' || explicitStatus === 'optional') {
    return explicitStatus;
  }
  if (label?.querySelector('.req-star')) return 'required';
  if (control?.required || control?.getAttribute('aria-required') === 'true') return 'required';
  return 'optional';
}

function setupRequiredFieldMarkers(root = document) {
  const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
  scope.querySelectorAll('.modal .field label, .modal .form-group label').forEach((label) => {
    const field = label.closest('.field, .form-group') || label.parentElement;
    if (!field) return;
    const control = field.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
    const baseLabel = getModalFieldLabelBaseText(label);
    if (!baseLabel) return;

    const status = getModalFieldStatus(field, label, control);
    label.textContent = baseLabel;
    const badge = document.createElement('span');
    badge.className = `field-label-status is-${status}`;
    badge.textContent = status === 'required' ? 'Required' : 'Optional';
    label.appendChild(badge);
  });
}

function setupCalculationListeners() {
  ['f-qty', 'f-unitprice', 'f-downpayment'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', updateBalance);
    el.addEventListener('change', updateBalance);
  });
}

function setupProjectCalculationListeners() {
  ['p-qty', 'p-unit-cost', 'p-downpayment'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', debounce(updateProjectPaymentDisplay, 100));
  });
}

const PHONE_PH_DIGITS = 11;
const PHONE_MAX_DIGITS = 15;

function getPhoneCountryValue(id) {
  const select = document.getElementById(`${id}-country`);
  return String(select?.value || 'PH').trim().toUpperCase();
}

function getPhoneMaxDigits(id) {
  return getPhoneCountryValue(id) === 'PH' ? PHONE_PH_DIGITS : PHONE_MAX_DIGITS;
}

function getPhonePlaceholder(id) {
  return getPhoneCountryValue(id) === 'PH'
    ? '11 digits, e.g. 09171234567'
    : 'Digits only, up to 15';
}

function bindPhoneField(id) {
  const el = document.getElementById(id);
  if (!el || el.dataset.phoneBound === '1') return;

  el.dataset.phoneBound = '1';
  const country = document.getElementById(`${id}-country`);
  const applyPhoneRules = () => {
    const maxDigits = getPhoneMaxDigits(id);
    el.setAttribute('maxlength', String(maxDigits));
    el.setAttribute('placeholder', getPhonePlaceholder(id));
    const normalized = normalizeDigits(el.value, maxDigits);
    if (el.value !== normalized) el.value = normalized;
  };
  if (country && country.dataset.phoneCountryBound !== '1') {
    country.dataset.phoneCountryBound = '1';
    country.addEventListener('change', applyPhoneRules);
  }
  el.setAttribute('inputmode', 'numeric');
  el.setAttribute('autocomplete', 'tel');
  el.addEventListener('input', () => {
    const normalized = normalizeDigits(el.value, getPhoneMaxDigits(id));
    if (el.value !== normalized) el.value = normalized;
  });
  applyPhoneRules();
}

function setupPhoneValidation() {
  [
    'f-member-phone',
    'f-member-phone-2',
    'f-member-phone-3',
    'erp-company-phone',
    'f-vendor-phone',
    'erp-vendor-phone',
    'erp-employee-phone'
  ].forEach(bindPhoneField);
}

function getMemberSlotElements() {
  return Array.from(document.querySelectorAll('.member-slot[data-member-slot]'));
}

function setMemberSlotVisibility(count = 1) {
  const slots = getMemberSlotElements();
  memberSlotVisibleCount = Math.max(1, Math.min(3, count));

  slots.forEach((slot) => {
    const slotNum = Number(slot.getAttribute('data-member-slot') || 1);
    slot.classList.toggle('is-hidden', slotNum > memberSlotVisibleCount);
  });

  const addBtn = document.getElementById('add-member-btn');
  if (addBtn) {
    if (memberSlotVisibleCount >= 3) {
      addBtn.style.display = 'none';
    } else {
      addBtn.style.display = '';
      addBtn.textContent = memberSlotVisibleCount === 1 ? 'Add Member' : `Add Member ${memberSlotVisibleCount + 1}`;
    }
  }
}

function showNextMemberSlot() {
  setMemberSlotVisibility(memberSlotVisibleCount + 1);
}

function setupMemberSlotControls() {
  setMemberSlotVisibility(1);
}

function clearMemberSlotFields(slotNumber) {
  const suffix = slotNumber === 1 ? '' : `-${slotNumber}`;
  const ids = [
    `f-project-members${suffix}`,
    `f-member-role${suffix}`,
    `f-member-phone${suffix}`
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function removeMemberSlot(slotNumber) {
  const safeSlot = Math.max(1, Math.min(3, Number(slotNumber) || 1));

  if (safeSlot === 1) {
    clearMemberSlotFields(1);
    return;
  }

  clearMemberSlotFields(safeSlot);
  setMemberSlotVisibility(safeSlot - 1);
}

async function updateStats() {
  const statLabel1 = document.getElementById('stat-label-1');
  const statLabel2 = document.getElementById('stat-label-2');
  const statLabel3 = document.getElementById('stat-label-3');
  const statLabel4 = document.getElementById('stat-label-4');
  const statCard3 = document.getElementById('stat-card-3');
  const statCard4 = document.getElementById('stat-card-4');
  const statArMini = document.getElementById('stat-ar-mini');
  const statOngoingMini = document.getElementById('stat-ongoing-mini');
  const statProjects = document.getElementById('stat-projects');
  const statOngoing = document.getElementById('stat-ongoing');
  const statAp = document.getElementById('stat-ap');
  const statAr = document.getElementById('stat-ar');
  const statsYear = new Date().getFullYear();

  if (statLabel1) statLabel1.textContent = 'Projects';
  if (statLabel2) statLabel2.textContent = 'Ongoing Projects';
  if (statLabel3) statLabel3.textContent = 'Accounts Payable';
  if (statLabel4) statLabel4.textContent = 'Accounts Receivable';
  if (statOngoingMini) statOngoingMini.textContent = `Year ${statsYear}`;

  if (statCard3) {
    statCard3.classList.add('stat-card-link');
    statCard3.onclick = () => { window.location.href = '/accounts-payable'; };
  }

  if (statCard4) {
    statCard4.classList.add('stat-card-link');
    statCard4.onclick = () => { window.location.href = '/accounts-receivable?tab=invoices'; };
  }

  const visibleProjects = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
    .filter(project => Number(project.is_archived || 0) === 0)
    .filter(project => companyMatchesDashboardFilter(getProjectCompanyName(project)));
  const totalProjectsCount = visibleProjects.filter(project => String(project.status || '').toLowerCase() !== 'cancelled').length;
  const ongoingProjectsCount = visibleProjects.filter(project => {
    const status = String(project.status || '').toLowerCase();
    if (status === 'completed' || status === 'cancelled' || status === 'on_hold') return false;
    return getProjectPhase(project) === 'ongoing';
  }).length;

  if (statProjects) statProjects.textContent = String(totalProjectsCount);
  if (statOngoing) statOngoing.textContent = String(ongoingProjectsCount);

  try {
    const companyParam = normalizeDashboardCompanyName(currentDashboardCompany || localStorage.getItem('kinaadman_dashboardCompany') || 'all');
    const statsParams = new URLSearchParams({
      year: String(statsYear),
      company: companyParam,
      business_entity_id: String(localStorage.getItem('kinaadman_businessEntityContext') || '').trim()
    });
    const projectStatsRes = await fetch(`/api/projects/stats?${statsParams.toString()}`);
    const projectStats = await projectStatsRes.json();
    if (projectStatsRes.ok) {
      if (statProjects) statProjects.textContent = Number(projectStats.total_projects ?? totalProjectsCount);
      if (statOngoing) statOngoing.textContent = Number(projectStats.ongoing_projects ?? ongoingProjectsCount);
    }
  } catch (err) {
    console.error('Error fetching project stats:', err);
  }

  try {
    const transactionsRes = await fetch('/api/transactions');
    const transactions = await transactionsRes.json();
    allTransactionsDb = Array.isArray(transactions) ? transactions : [];

    const receivablesRes = await fetch('/api/receivables');
    const receivables = await receivablesRes.json();
    allReceivablesDb = Array.isArray(receivables) ? receivables : [];

    const companiesRes = await fetch('/api/company-registry');
    const companies = await companiesRes.json();
    companyRegistryDb = Array.isArray(companies) ? companies : [];
    syncDashboardCompanyFilterOptions();

    const invoiceRows = getDashboardInvoiceRows(allTransactionsDb);
    const totalReceivable = invoiceRows.reduce((sum, r) => {
      const amount = parseFloat(r.amount) || 0;
      const paidAmount = getTransactionPaidAmountValue(r);
      return sum + Math.max(0, amount - paidAmount);
    }, 0);

    if (statAr) statAr.textContent = 'PHP ' + totalReceivable.toLocaleString('en-PH', { minimumFractionDigits: 2 });
    if (statArMini) {
      statArMini.textContent = `${getCurrentDashboardCompanyLabel()} • ${invoiceRows.length} invoice${invoiceRows.length === 1 ? '' : 's'}`;
    }

    renderDashboardAnalytics(invoiceRows);
    renderInvoiceStatusQuickView(invoiceRows);
  } catch (err) {
    console.error('Error fetching transactions stats:', err);
    allReceivablesDb = [];
    if (statAr) statAr.textContent = 'PHP 0.00';
    if (statArMini) statArMini.textContent = `${getCurrentDashboardCompanyLabel()} • 0 invoices`;
    renderInvoiceStatusQuickView([]);
  }

  try {
    const billsRes = await fetch('/api/bills');
    const bills = await billsRes.json();
    const billRows = Array.isArray(bills) ? bills : [];
    const totalPayable = billRows.reduce((sum, b) => {
      const totalAmount = parseFloat(b.total_amount) || 0;
      const paidAmount = parseFloat(b.paid_amount) || 0;
      return sum + Math.max(0, totalAmount - paidAmount);
    }, 0);
    if (statAp) statAp.textContent = 'PHP ' + totalPayable.toLocaleString('en-PH', { minimumFractionDigits: 2 });
  } catch (err) {
    console.error('Error fetching payable stats:', err);
    if (statAp) statAp.textContent = 'PHP 0.00';
  }

  await loadNotifications();
}

function toggleNotificationsPanel(event, forceOpen) {
  if (event && typeof event.stopPropagation === 'function') {
    event.stopPropagation();
  }

  const panel = document.getElementById('notifications-panel');
  const btn = document.querySelector('.notification-btn');
  if (!panel || !btn) return;

  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : panel.classList.contains('is-hidden');
  panel.classList.toggle('is-hidden', !shouldOpen);
  btn.classList.toggle('is-open', shouldOpen);

  if (shouldOpen) {
    loadNotifications();
  }
}

function closeNotificationsPanel() {
  const panel = document.getElementById('notifications-panel');
  const btn = document.querySelector('.notification-btn');
  if (panel) panel.classList.add('is-hidden');
  if (btn) btn.classList.remove('is-open');
}

async function loadNotifications() {
  const countBadge = document.getElementById('notification-count');
  const list = document.getElementById('notifications-list');

  try {
    const res = await fetch('/api/notifications');
    const data = await res.json().catch(() => ({}));
    notificationsDb = Array.isArray(data.items) ? data.items : [];
    const unreadItems = getUnreadNotifications(notificationsDb);

    if (countBadge) {
      countBadge.textContent = String(unreadItems.length);
      countBadge.style.display = unreadItems.length ? 'inline-flex' : 'none';
    }

    renderNotifications(notificationsDb);
  } catch (err) {
    console.error('Error loading notifications:', err);
    notificationsDb = [];
    if (countBadge) {
      countBadge.textContent = '0';
      countBadge.style.display = 'none';
    }
    if (list) {
      list.innerHTML = '<div class="notifications-empty">Unable to load notifications.</div>';
    }
  }
}

function renderNotifications(items = notificationsDb) {
  const list = document.getElementById('notifications-list');
  if (!list) return;

  if (!items.length) {
    list.innerHTML = '<div class="notifications-empty">No notifications right now.</div>';
    return;
  }

  list.innerHTML = items.map(item => {
    const level = String(item.level || 'info').toLowerCase();
    const isUnread = !notificationReadIds.has(String(item?.id || ''));
    const safeTitle = escHtml(item.title || 'Project');
    const safeMessage = escHtml(item.message || '');
    const safeMeta = escHtml(item.meta || '');
    const safeDate = escHtml(formatNotificationDisplayDate(item.date));

    return `
      <button type="button" class="notification-item ${level} ${isUnread ? 'is-unread' : ''}" onclick="openNotificationItem(${JSON.stringify(String(item.id || ''))})">
        <span class="notification-mark" aria-hidden="true"></span>
        <div class="notification-copy">
          <strong>${safeTitle}</strong>
          <p>${safeMessage}</p>
          <div class="notification-meta">${safeMeta}${safeMeta && safeDate ? ' • ' : ''}${safeDate}</div>
        </div>
      </button>
    `;
  }).join('');
}

function formatNotificationDisplayDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function setSaveButtonState(isBusy) {
  const saveBtn = document.getElementById('btn-save-record');
  if (!saveBtn) return;
  saveBtn.disabled = isBusy;
  saveBtn.textContent = isBusy ? 'Saving...' : 'Save Transaction';
}

function updateDownpaymentMode() {
  const downpaymentInput = document.getElementById('f-downpayment');
  const helpText = document.getElementById('f-downpayment-help');
  const label = downpaymentInput?.closest('.field')?.querySelector('label');
  const amount = parseFloat(document.getElementById('f-amount')?.value) || 0;
  const additionalPayment = parseFloat(downpaymentInput?.value) || 0;
  const selectedStatus = normalizeTransactionStatusValue(document.getElementById('f-status')?.value);
  const totalPaid = selectedStatus === 'paid'
    ? amount
    : (selectedStatus === 'partial' ? additionalPayment : 0);
  const balance = Math.max(0, amount - totalPaid);

  if (label) {
    label.textContent = 'Payment Received (PHP)';
  }

  if (helpText) {
    if (additionalPayment > 0) {
      helpText.style.display = 'block';
      helpText.textContent = `Current payment received: PHP ${additionalPayment.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
    } else {
      helpText.style.display = 'none';
      helpText.textContent = '';
    }
  }

  document.getElementById('f-balance-display').textContent = 'PHP ' + balance.toLocaleString('en-PH', { minimumFractionDigits: 2 });
}

async function openModal(id = null, preselectProjectId = null) {
  if (!isAdminUser()) {
    showToast('Admin lang ang puwedeng mag-add o mag-edit ng records.', 'error');
    return;
  }

  const normalizedId =
    typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id))
      ? Number(id)
      : null;

  if (!normalizedId && activeTab === 'archived') {
    const allMenu = document.getElementById('menu-all');
    switchTab('all', allMenu);
  }

  editingId = normalizedId;
  stagedPdf = null;   // Reset
  setSaveButtonState(false);

  document.getElementById('modal-title').textContent = id ? 'Edit Transaction' : 'Add Transaction';
  resetRecordForm();

  if (normalizedId) {
    const r = db.find(u => u.id === normalizedId);
    if (r) {
      const linkedProject = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
        .find(project => Number(project.id || 0) === Number(r.project_id || 0));
      const selectedProjectId = r.project_id || '';
      populateTransactionProjectSelect(selectedProjectId);
      document.getElementById('f-docno').value = r.docno || '';
      document.getElementById('f-date').value = r.date || '';
      document.getElementById('f-client').value = r.client || '';
      document.getElementById('f-desc').value = r.description || r.desc || '';
      document.getElementById('f-checkno').value = r.checkno || '';
      document.getElementById('f-pono').value = r.pono || '';
      document.getElementById('f-type').value = r.type || 'invoice';
      document.getElementById('f-status').value = getComputedTransactionPaymentStatus(r) || 'unpaid';
      document.getElementById('f-qty').value = r.qty || 1;
      document.getElementById('f-unitprice').value = r.unitprice || '';
      document.getElementById('f-amount').value = r.amount || '';
      document.getElementById('f-downpayment').value = r.downpayment || '';
      const projectTxNoInput = document.getElementById('f-project-tx-no');

      if (linkedProject) {
        fillTransactionProjectData(linkedProject);
        setTransactionProjectSelectionLocked(false);
      } else {
        if (projectTxNoInput) projectTxNoInput.value = '';
        const projectDocNoInput = document.getElementById('f-linked-project-docno');
        const projectStartInput = document.getElementById('f-project-start-date');
        const projectEndInput = document.getElementById('f-project-end-date');
        const projectCompanyInput = document.getElementById('f-project-company');
        if (projectDocNoInput) projectDocNoInput.value = '';
        if (projectStartInput) projectStartInput.value = '';
        if (projectEndInput) projectEndInput.value = '';
        if (projectCompanyInput) projectCompanyInput.value = '';
      }

      if (projectTxNoInput) {
        const projectTxNo = Number(r.project_tx_no || 0) || 0;
        projectTxNoInput.value = projectTxNo ? String(projectTxNo) : '';
      }

      // New PDF handling using filename
      if (r.pdfFilename) {
        stagedPdf = r.pdfFilename;
        document.getElementById('pdf-preview-name').textContent = r.pdfFilename;
        document.getElementById('pdf-preview').style.display = 'flex';
        document.getElementById('upload-zone').style.display = 'none';
      }
    }
  } else {
    // New record
    const today = new Date().toISOString().slice(0, 10);
    const nextMonth = new Date(Date.now() + 30*24*60*60*1000).toISOString().slice(0, 10);
    populateTransactionProjectSelect(preselectProjectId || '', Boolean(preselectProjectId));
    const selectedProject = preselectProjectId
      ? (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : []).find(entry => Number(entry.id || 0) === Number(preselectProjectId))
      : null;
    if (selectedProject) {
      fillTransactionFormFromProject(selectedProject);
    }
    document.getElementById('f-date').value = today;
    updateDownpaymentMode();

    try {
      await ensureGeneratedDocno();
    } catch (err) {
      console.error('Docno preload error:', err);
    }
  }

  updateDownpaymentMode();
  document.getElementById('modal-backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  editingId = null;
  isSavingRecord = false;
  setSaveButtonState(false);

  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop) backdrop.classList.remove('open');
  document.body.style.overflow = '';
}

function resetRecordForm() {
  [
    'f-docno',
    'f-date',
    'f-linked-project-docno',
    'f-project-tx-no',
    'f-project-start-date',
    'f-project-end-date',
    'f-project-company',
    'f-client',
    'f-desc',
    'f-project-id',
    'f-checkno',
    'f-pono',
    'f-unitprice',
    'f-amount'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  populateTransactionProjectSelect('');
  document.getElementById('f-type').value = 'invoice';
  document.getElementById('f-status').value = 'unpaid';
  document.getElementById('f-qty').value = '1';
  document.getElementById('f-downpayment').value = '0';
  if (document.getElementById('f-downpayment-help')) {
  document.getElementById('f-downpayment-help').style.display = 'none';
    document.getElementById('f-downpayment-help').textContent = '';
  }
  document.getElementById('f-balance-display').textContent = 'PHP 0.00';
  document.getElementById('pdf-preview-name').textContent = '';
  document.getElementById('pdf-preview').style.display = 'none';
  document.getElementById('upload-zone').style.display = 'block';
  document.getElementById('pdf-file-input').value = '';
}
// 1. handleFileChosen
function handleFileChosen(event) {
  const file = event.target.files[0];
  if (file && file.type === 'application/pdf') {
    stagePdfFile(file);
  } else {
    showToast('Please select a PDF file only.', 'error');
    event.target.value = '';
  }
}

// Required to allow the drop event to fire
function handleDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  document.getElementById('upload-zone').classList.add('drag-over');
}

// Removes the highlighting when drag leaves the zone
function handleDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  document.getElementById('upload-zone').classList.remove('drag-over');
}

// 2. handleDrop
function handleDrop(event) {
  event.preventDefault();
  document.getElementById('upload-zone').classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') {
    stagePdfFile(file);           // Direct call, no need to set files again
  } else {
    showToast('Please drop a PDF file only.', 'error');
  }
}

// 3. stagePdfFile - store the selected PDF for upload.
function stagePdfFile(file) {
  stagedPdf = file;               // Store the actual File object, not just the name

  document.getElementById('pdf-preview-name').textContent = file.name;
  document.getElementById('pdf-preview').style.display = 'flex';
  document.getElementById('upload-zone').style.display = 'none';
  
  showToast(file.name + ' ready to upload', 'success');
}

// 4. removeStagedPdf
function removeStagedPdf() {
  stagedPdf = null;
  document.getElementById('pdf-preview').style.display = 'none';
  document.getElementById('upload-zone').style.display = 'block';
  document.getElementById('pdf-file-input').value = '';
}

function updateBalance() {
  const qty = parseFloat(document.getElementById('f-qty').value) || 0;
  const price = parseFloat(document.getElementById('f-unitprice').value) || 0;
  const amountInput = document.getElementById('f-amount');

  // Auto-compute Total Amount base sa Qty at Unit Price
  if (qty > 0 && price > 0) {
    amountInput.value = (qty * price).toFixed(2);
  }

  updateDownpaymentMode();
}
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function normalizeDigits(value, maxLength) {
  return String(value || '').replace(/\D/g, '').slice(0, maxLength);
}

function normalizePhone(value) {
  return normalizeDigits(value, PHONE_MAX_DIGITS);
}

function normalizeTin(value) {
  return normalizeDigits(value, 12);
}

function isValidPhone(value) {
  const phone = String(value || '').trim();
  return /^\d+$/.test(phone) && phone.length > 0 && phone.length <= PHONE_MAX_DIGITS;
}

function isValidPhoneForField(id, value) {
  const phone = normalizePhone(value);
  if (!phone) return false;
  if (getPhoneCountryValue(id) === 'PH') return phone.length === PHONE_PH_DIGITS;
  return phone.length >= 7 && phone.length <= PHONE_MAX_DIGITS;
}

function getPhoneValidationMessage(id, label = 'Phone') {
  return getPhoneCountryValue(id) === 'PH'
    ? `${label} must be exactly 11 digits for PH numbers.`
    : `${label} must be digits only, 7 to 15 digits.`;
}

async function ensureGeneratedDocno() {
  const docnoInput = document.getElementById('f-docno');
  const currentDocno = docnoInput.value.trim();
  if (currentDocno) return currentDocno;

  const res = await fetch(`/api/transactions/next-docno?business_entity_id=${encodeURIComponent(erpGetCurrentBusinessEntityId() || '')}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.docno) {
    throw new Error(data.error || 'Hindi ma-generate ang Transaction No.');
  }
  docnoInput.value = data.docno;
  return data.docno;
}

async function saveRecord() {
  if (!isAdminUser()) {
    showToast('Admin lang ang puwedeng mag-save ng records.', 'error');
    return;
  }

  if (isSavingRecord) return;

  let docno = document.getElementById('f-docno').value.trim();
  const client = document.getElementById('f-client').value.trim();
  const qty = parseInt(document.getElementById('f-qty').value) || 1;
  let desc = document.getElementById('f-desc').value.trim();
  let unitPrice = parseFloat(document.getElementById('f-unitprice').value) || 0;
  let amount = parseFloat(document.getElementById('f-amount').value) || 0;
  const documentDateInput = document.getElementById('f-date');
  const documentDate = (documentDateInput?.value || new Date().toISOString().slice(0, 10)).trim();
  const isEdit = !!editingId;
  const projectId = Number(document.getElementById('f-project-id')?.value || 0) || 0;
  const selectedProject = projectId ? findProjectForRecord({ project_id: projectId }) || (Array.isArray(projectsDashboardDb) ? projectsDashboardDb.find(entry => Number(entry.id || 0) === projectId) : null) : null;
  const hasProject = projectId > 0;

  if (documentDateInput) documentDateInput.value = documentDate;

  updateBalance();
  amount = parseFloat(document.getElementById('f-amount').value) || 0;

  if (!client || !desc || !amount) {
    return showToast('Punan ang Client, Description, at Amount.', 'error');
  }

  if (!isEdit && !docno) {
    try {
      docno = await ensureGeneratedDocno();
    } catch (err) {
      console.error(err);
      return showToast(err.message || 'Hindi ma-generate ang Transaction No.', 'error');
    }
  }

  if (!docno) {
    return showToast('Transaction No. is required.', 'error');
  }

  const url = isEdit ? `/api/transactions/${editingId}` : '/api/transactions';
  const method = isEdit ? 'PUT' : 'POST';

  const formData = new FormData();

  formData.append('docno', docno);
  formData.append('type', document.getElementById('f-type').value);
  formData.append('client', client);
  formData.append('phone', '');
  formData.append('description', desc);
  formData.append('qty', qty);
  formData.append('unitprice', unitPrice || '');
  formData.append('amount', amount);
  formData.append('project_id', hasProject ? projectId : '');
  formData.append('project_tx_no', Number(document.getElementById('f-project-tx-no')?.value || 0) || '');
  formData.append('project_start_date', selectedProject?.start_date || selectedProject?.planned_start_date || '');
  formData.append('project_end_date', selectedProject?.end_date || selectedProject?.planned_end_date || '');
  const selectedStatus = normalizeTransactionStatusValue(document.getElementById('f-status').value) || 'unpaid';
  const enteredDownpayment = parseFloat(document.getElementById('f-downpayment').value) || 0;
  const totalDownpayment = selectedStatus === 'paid'
    ? amount
    : (selectedStatus === 'partial' ? Math.min(amount, enteredDownpayment) : 0);
  formData.append('downpayment', totalDownpayment);
  formData.append('checkno', document.getElementById('f-checkno').value.trim() || '');
  formData.append('pono', document.getElementById('f-pono').value.trim() || '');
  formData.append('date', documentDate);
  formData.append('status', selectedStatus);

  // ==================== PDF UPLOAD LOGIC ====================
   // ==================== PDF UPLOAD LOGIC ====================
  const fileInput = document.getElementById('pdf-file-input');

  if (fileInput.files && fileInput.files[0]) {
    formData.append('pdf_file', fileInput.files[0]);
  }
  else if (stagedPdf instanceof File) {
    formData.append('pdf_file', stagedPdf);
  }
  else if (stagedPdf && typeof stagedPdf === 'string') {
    formData.append('pdfFilename', stagedPdf);
  }
  // If there is no PDF, nothing needs to be added.

  isSavingRecord = true;
  setSaveButtonState(true);

  fetch(url, {
    method: method,
    body: formData
  })
  .then(async res => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save record.');
    }

    const savedTransactionId = isEdit ? editingId : data.id;
    const savedDocno = data.docno || docno;

    return data;
  })
  .then(data => {

    showToast(
      data.warning || (isEdit ? 'Updated successfully' : 'Added successfully'),
      data.warning ? 'error' : 'success'
    );
    closeModal();
    currentPage = 1;
    loadRecords();
  })
  .catch(err => {
    console.error(err);
    showToast(err.message || 'Server error. Hindi na-save ang record.', 'error');
  })
  .finally(() => {
    isSavingRecord = false;
    setSaveButtonState(false);
  });
}

function openDelModal(id) {
  if (!isAdminUser()) {
    showToast('Admin lang ang puwedeng mag-archive ng records.', 'error');
    return;
  }

  deletingId = id;
  document.getElementById('del-backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDelModal() {
  const backdrop = document.getElementById('del-backdrop');
  if (backdrop) backdrop.classList.remove('open');
  document.body.style.overflow = '';
}

function confirmDelete() {
  if (!isAdminUser()) {
    showToast('Admin lang ang puwedeng mag-archive ng records.', 'error');
    return;
  }

  fetch(`/api/transactions/${deletingId}/archive`, { method: 'PUT' })
    .then(res => res.json())
    .then(data => {
      if (data.error) return showToast(data.error, 'error');
      closeDelModal();
      loadRecords();
      showToast('Archived!', 'success');
    })
    .catch(() => showToast('Server error.', 'error'));
}

// ==================== ARCHIVED RECORDS MODAL ====================

function openArchivedModal(id) {
  viewingArchivedId = id;
  const r = db.find(u => u.id === id);
  if (!r) return showToast('Record not found', 'error');

  document.getElementById('a-docno').value = r.docno || '';
  document.getElementById('a-type').value = r.type === 'receipt' ? 'Payment Receipt' : 'Sales Invoice';
  document.getElementById('a-date').value = r.date || '';
  document.getElementById('a-status').value = r.status || '';
  document.getElementById('a-client').value = r.client || '';
  document.getElementById('a-desc').value = r.description || r.desc || '';
  document.getElementById('a-checkno').value = r.checkno || '';
  document.getElementById('a-pono').value = r.pono || '';
  document.getElementById('a-qty').value = r.qty || 1;
  document.getElementById('a-unitprice').value = r.unitprice || '';
  document.getElementById('a-amount').value = r.amount || '';
  document.getElementById('a-downpayment').value = r.downpayment || 0;

  const balance = Math.max(0, Number(r.amount || 0) - getTransactionPaidAmountValue(r)).toLocaleString('en-PH', { minimumFractionDigits: 2 });
  document.getElementById('a-balance-display').textContent = 'PHP ' + balance;

    if (r.pdfFilename) {
    document.getElementById('a-pdf-section').style.display = 'flex';
    document.getElementById('a-no-pdf').style.display = 'none';
    document.getElementById('a-pdf-name').textContent = r.pdfFilename;
  } else {
    document.getElementById('a-pdf-section').style.display = 'none';
    document.getElementById('a-no-pdf').style.display = 'block';
  }

  document.getElementById('archived-backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeArchivedModal() {
  const backdrop = document.getElementById('archived-backdrop');
  if (backdrop) backdrop.classList.remove('open');
  document.body.style.overflow = '';
  viewingArchivedId = null;
}

function restoreArchived() {
  if (!viewingArchivedId) return;
  fetch(`/api/transactions/${viewingArchivedId}/restore`, { method: 'PUT' })
    .then(res => res.json())
    .then(data => {
      if (data.error) return showToast(data.error, 'error');
      closeArchivedModal();
      loadArchivedRecords();
      showToast('Restored from archive!', 'success');
    })
    .catch(() => showToast('Server error.', 'error'));
}

function restoreArchivedDirect(id) {
  if (!confirm('Restore this record from archive?')) return;
  fetch(`/api/transactions/${id}/restore`, { method: 'PUT' })
    .then(res => res.json())
    .then(data => {
      if (data.error) return showToast(data.error, 'error');
      loadArchivedRecords();
      showToast('Restored from archive!', 'success');
    })
    .catch(() => showToast('Server error.', 'error'));
}

function openHardDeleteConfirm(id) {
  hardDeleteId = Number(id || viewingArchivedId || 0) || null;
  showToast('Permanent delete is disabled. Restore the record instead.', 'error');
}

function setupPasswordToggleListeners() {
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('.password-toggle');
    if (!btn) return;

    const targetId = btn.getAttribute('data-target');
    const input = targetId ? document.getElementById(targetId) : null;
    if (!input) return;

    event.preventDefault();
    const willShow = input.type === 'password';
    input.type = willShow ? 'text' : 'password';
    btn.classList.toggle('is-visible', willShow);
    const nextLabel = willShow ? 'Hide password' : 'Show password';
    btn.setAttribute('aria-label', nextLabel);
    btn.setAttribute('title', nextLabel);
  });
}

function setupSidebarLinkNavigation() {
  function withActiveTheme(target) {
    try {
      const url = new URL(target, window.location.origin);
      const currentTheme = String(
        document.documentElement?.dataset?.businessEntityTheme ||
        document.body?.dataset?.businessEntityTheme ||
        ''
      ).trim().toLowerCase();
      if ((currentTheme === 'kitsi' || currentTheme === 'kvsk') && url.origin === window.location.origin) {
        url.searchParams.set('theme', currentTheme);
      }
      return `${url.pathname}${url.search}${url.hash}`;
    } catch (_) {
      return target;
    }
  }

  document.querySelectorAll('.sidebar-link[href^="/"]').forEach((link) => {
    if (link.dataset.navBound === '1') return;

    const rawHref = String(link.getAttribute('href') || '').trim();
    if (!rawHref || rawHref.startsWith('//')) return;

    link.dataset.navBound = '1';
    link.dataset.navHref = rawHref;

    link.addEventListener('click', (event) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const target = String(link.dataset.navHref || link.getAttribute('href') || '').trim();
      if (!target || target === '#') return;
      event.preventDefault();
      window.location.assign(withActiveTheme(target));
    });
  });
}

function syncSidebarActiveLinks() {
  const currentUrl = new URL(window.location.href);
  const currentPath = currentUrl.pathname.replace(/\/+$/, '') || '/';
  const currentSearch = currentUrl.search || '';
  let activeLink = null;
  const routeAliases = {
    '/admin?view=dashboard': ['/admin'],
    '/reports': ['/admin?panel=reports'],
    '/admin?panel=project-records': ['/admin?view=project-records'],
    '/admin?view=all': ['/admin?view=total-projects'],
    '/admin?view=ongoing-projects': ['/admin?view=ongoing'],
    '/admin?view=logs': ['/admin?panel=logs'],
    '/admin?view=archived': ['/admin?panel=archived'],
    '/master-data?tab=vendors': ['/accounts-payable?tab=vendors'],
    '/procurement?tab=requisitions': ['/procurement', '/accounts-payable?tab=requisitions'],
    '/procurement?tab=rfq': ['/accounts-payable?tab=rfq'],
    '/procurement?tab=quotations': ['/accounts-payable?tab=quotations', '/procurement?tab=bid-evaluation', '/accounts-payable?tab=bid-evaluation'],
    '/procurement?tab=purchase-orders': ['/accounts-payable?tab=purchase-orders'],
    '/procurement?tab=goods-receipts': ['/accounts-payable?tab=goods-receipts'],
    '/accounts-payable?tab=bills': ['/accounts-payable'],
    '/accounts-receivable?tab=service-orders': ['/accounts-receivable', '/accounts-receivable?tab=overview', '/accounts-receivable?tab=transactions'],
    '/accounts-receivable?tab=invoices': ['/accounts-receivable?tab=receivables'],
    '/accounts-receivable?tab=collections': ['/accounts-receivable?tab=payments']
  };

  function sameRoute(candidateHref) {
    try {
      const targetUrl = new URL(candidateHref, window.location.origin);
      const currentComparable = new URL(currentUrl.toString());
      currentComparable.searchParams.delete('theme');
      targetUrl.searchParams.delete('theme');
      const targetPath = targetUrl.pathname.replace(/\/+$/, '') || '/';
      const targetSearch = targetUrl.search || '';
      const comparablePath = currentComparable.pathname.replace(/\/+$/, '') || '/';
      const comparableSearch = currentComparable.search || '';
      return targetPath === comparablePath && targetSearch === comparableSearch;
    } catch (_) {
      return false;
    }
  }

  document.querySelectorAll('.sidebar-link').forEach((link) => {
    const rawHref = link.dataset.navHref || link.getAttribute('href') || '';
    if (!rawHref || rawHref === '#' || rawHref.startsWith('javascript:')) return;

    const candidates = [rawHref].concat(routeAliases[rawHref] || []);
    const isActive = candidates.some(sameRoute);
    link.classList.toggle('active', isActive);
    if (isActive) activeLink = link;
  });

  if (!activeLink) return;

  const activeGroup = activeLink.closest('.sidebar-group');
  if (activeGroup) {
    activeGroup.classList.remove('is-collapsed');
    const toggle = activeGroup.querySelector('.sidebar-group-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    const key = String(activeGroup.getAttribute('data-sidebar-group') || '').trim();
    if (key) localStorage.setItem(`kinaadman_sidebarGroup_${key}`, '0');
  }

  window.requestAnimationFrame(() => {
    activeLink.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

function closeHardDeleteConfirm() {
  const backdrop = document.getElementById('hard-delete-backdrop');
  if (backdrop) backdrop.classList.remove('open');
  document.body.style.overflow = '';
}

function confirmHardDelete() {
  if (!hardDeleteId) return;
  showToast('Permanent delete is disabled. Use Restore instead.', 'error');
  closeHardDeleteConfirm();
}

// ==================== PDF VIEWER FUNCTIONS ====================

function openPdfViewer(id) {
  const r = db.find(u => u.id === id);
  if (!r || !r.pdfFilename) return showToast('No PDF attached', 'error');

  const pdfUrl = `/api/transactions/${r.id}/pdf`;

  document.getElementById('pdf-viewer-title').textContent = r.pdfFilename || 'Document Viewer';
  document.getElementById('pdf-dl-btn').href = pdfUrl;
  document.getElementById('pdf-dl-btn').download = r.pdfFilename;

  const frame = document.getElementById('pdf-frame');
  const fallback = document.getElementById('pdf-fallback');

  frame.src = pdfUrl;
  frame.style.display = 'block';
  fallback.style.display = 'none';

  document.getElementById('pdf-viewer-backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function openProjectPdfViewer(id) {
  const project = (projectsDashboardDb || []).find(entry => Number(entry.id) === Number(id));
  if (!project || !project.pdfFilename) return showToast('No PDF attached', 'error');

  const pdfUrl = `/api/projects/${project.id}/pdf`;

  document.getElementById('pdf-viewer-title').textContent = project.pdfFilename || 'Project PDF';
  document.getElementById('pdf-dl-btn').href = pdfUrl;
  document.getElementById('pdf-dl-btn').download = project.pdfFilename;

  const fallbackBtn = document.getElementById('pdf-fallback-dl');
  if (fallbackBtn) {
    fallbackBtn.href = pdfUrl;
    fallbackBtn.download = project.pdfFilename;
  }

  const frame = document.getElementById('pdf-frame');
  const fallback = document.getElementById('pdf-fallback');

  frame.src = pdfUrl;
  frame.style.display = 'block';
  fallback.style.display = 'none';

  document.getElementById('pdf-viewer-backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function openProjectPurchaseOrder(projectId) {
  const selectedId = Number(projectId || 0) || 0;
  if (!selectedId) return;
  const project = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
    .find((entry) => Number(entry.id || 0) === selectedId) || null;
  const companyId = Number(project?.company_id || project?.registry_company_id || 0) || 0;
  const params = new URLSearchParams({
    tab: 'purchase-orders',
    project_id: String(selectedId),
    action: 'po'
  });
  if (companyId) params.set('company_id', String(companyId));
  window.location.href = `/procurement?${params.toString()}`;
}

function openProjectRequisition(projectId) {
  const selectedId = Number(projectId || 0) || 0;
  if (!selectedId) return;
  const project = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
    .find((entry) => Number(entry.id || 0) === selectedId) || null;
  const companyId = Number(project?.company_id || project?.registry_company_id || 0) || 0;
  const params = new URLSearchParams({
    tab: 'requisitions',
    project_id: String(selectedId),
    action: 'pr'
  });
  if (companyId) params.set('company_id', String(companyId));
  window.location.href = `/procurement?${params.toString()}`;
}

function openProjectTransaction(projectId) {
  const selectedId = Number(projectId || 0) || 0;
  if (!selectedId) return;
  window.location.href = `/admin?view=all&project_id=${encodeURIComponent(String(selectedId))}&action=transaction`;
}

function viewArchivedPdf() {
  if (!viewingArchivedId) return;
  const r = db.find(u => u.id === viewingArchivedId);
  if (!r || !r.pdfFilename) return showToast('No PDF attached', 'error');

  const pdfUrl = `/api/transactions/${r.id}/pdf`;

  document.getElementById('pdf-viewer-title').textContent = r.pdfFilename || 'Archived Document';
  document.getElementById('pdf-dl-btn').href = pdfUrl;
  document.getElementById('pdf-dl-btn').download = r.pdfFilename;

  const frame = document.getElementById('pdf-frame');
  const fallback = document.getElementById('pdf-fallback');

  frame.src = pdfUrl;
  frame.style.display = 'block';
  fallback.style.display = 'none';

  document.getElementById('pdf-viewer-backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePdfViewer() {
  const backdrop = document.getElementById('pdf-viewer-backdrop');
  if (backdrop) backdrop.classList.remove('open');
  document.body.style.overflow = '';
  const frame = document.getElementById('pdf-frame');
  if (frame) frame.src = '';
}

function showToast(msg, type = 'success') {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'show ' + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.className = '', 3500);
}

function highlight(text, query) {
  const escapedText = escHtml(text);
  const tokens = getSearchTokens(query)
    .map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean);

  if (!tokens.length) return escapedText;

  const pattern = tokens.sort((a, b) => b.length - a.length).join('|');
  try {
    return escapedText.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>');
  } catch (_) {
    return escapedText;
  }
}

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function fetchJson(url, options = {}) {
  const { headers: customHeaders, ...fetchOptions } = options;
  const headers = new Headers(customHeaders || {});
  const method = String(fetchOptions.method || 'GET').toUpperCase();

  if (method !== 'GET') {
    const token = String(window.__CSRF_TOKEN__ || '').trim();
    if (token && !headers.has('X-CSRF-Token')) {
      headers.set('X-CSRF-Token', token);
    }
  }

  const response = await fetch(url, {
    credentials: 'same-origin',
    ...fetchOptions,
    headers
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || `Request failed (${response.status})`);
  }
  return data;
}

async function postJson(url, payload) {
  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
}

window.fetchJson = window.fetchJson || fetchJson;
window.postJson = window.postJson || postJson;

const modalBackdrop = document.getElementById('modal-backdrop');
if (modalBackdrop) {
  modalBackdrop.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
}

const delBackdrop = document.getElementById('del-backdrop');
if (delBackdrop) {
  delBackdrop.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeDelModal();
  });
}

const archivedBackdrop = document.getElementById('archived-backdrop');
if (archivedBackdrop) {
  archivedBackdrop.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeArchivedModal();
  });
}

const hardDeleteBackdrop = document.getElementById('hard-delete-backdrop');
if (hardDeleteBackdrop) {
  hardDeleteBackdrop.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeHardDeleteConfirm();
  });
}

const confirmBackdrop = document.getElementById('confirm-modal-backdrop');
if (confirmBackdrop) {
  confirmBackdrop.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeConfirmDialog(false);
  });
}

const resetPasswordBackdrop = document.getElementById('reset-pass-backdrop');
if (resetPasswordBackdrop) {
  resetPasswordBackdrop.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeResetPasswordModal();
  });
}

const userBackdrop = document.getElementById('user-modal-backdrop');
if (userBackdrop) {
  userBackdrop.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeUserModal();
  });
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const confirmOpen = document.getElementById('confirm-modal-backdrop')?.classList.contains('open');
    if (confirmOpen) {
      closeConfirmDialog(false);
      return;
    }
    const pdfOpen = document.getElementById('pdf-viewer-backdrop')?.classList.contains('open');
    if (pdfOpen) closePdfViewer();
    else {
      const userOpen = document.getElementById('user-modal-backdrop')?.classList.contains('open');
      if (userOpen) {
        closeUserModal();
        return;
      }
      closeModal();
      closeDelModal();
      closeArchivedModal();
      closeHardDeleteConfirm();
      closeResetPasswordModal();
    }
  }
});

// ==================== USER MODAL LOGIC ====================
async function submitUserCreatePayload({ name, username, email, role, password, active }) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!name || !username || !email || !password) {
    return showToast('Lahat ng fields ay kailangan.', 'error');
  }
  if (!emailRegex.test(email)) {
    return showToast('Invalid email format.', 'error');
  }

  try {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, username, email, role, password, active })
    });

    const data = await res.json();
    if (data.success) {
      return true;
    }

    showToast(data.error || 'Failed to create user.', 'error');
    return false;
  } catch (err) {
    console.error('Save User Error:', err);
    showToast('Network error o hindi maka-connect sa server.', 'error');
    return false;
  }
}

function normalizeUserDuplicateValue(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function findUserDuplicateField(username, email, excludeId = 0) {
  const normalizedUsername = normalizeUserDuplicateValue(username);
  const normalizedEmail = normalizeUserDuplicateValue(email);
  const currentId = Number(excludeId || 0) || 0;

  if (!normalizedUsername && !normalizedEmail) return '';

  const duplicate = (usersDb || []).find((entry) => {
    if (!entry) return false;
    if (currentId && Number(entry.id || 0) === currentId) return false;
    if (normalizedUsername && normalizeUserDuplicateValue(entry.username) === normalizedUsername) return 'username';
    if (normalizedEmail && normalizeUserDuplicateValue(entry.email) === normalizedEmail) return 'email';
    return false;
  });

  return duplicate || '';
}

function userModalNeedsAdminPassword() {
  if (userModalMode !== 'edit' || !userModalSnapshot) return false;
  if (!isSuperAdminUser()) return false;
  const roleInput = document.getElementById('u-role');
  const statusInput = document.getElementById('u-status');
  const snapshotRole = normalizeAccessRole(userModalSnapshot.role || 'staff');
  const nextRole = normalizeAccessRole(roleInput?.value || (snapshotRole === 'user' ? 'staff' : snapshotRole));
  const nextActive = Number(statusInput?.value || 0) === 1;
  const previousRole = normalizeAccessRole(userModalSnapshot.role || 'user');
  const previousApprovalStatus = String(userModalSnapshot.approval_status || 'approved').toLowerCase();
  const isSelf = Number(editingUserId || 0) === Number(currentUser?.id || 0);
  return !isSelf && isPrivilegedRoleValue(nextRole) && (nextRole !== previousRole || (previousApprovalStatus === 'pending' && nextActive));
}

function syncUserAdminPasswordField() {
  const field = document.getElementById('u-admin-password-field');
  const input = document.getElementById('u-admin-pass');
  const shouldShow = userModalNeedsAdminPassword();
  if (field) field.style.display = shouldShow ? '' : 'none';
  if (input) {
    input.required = shouldShow;
    input.setAttribute('aria-required', String(shouldShow));
    if (!shouldShow) input.value = '';
  }
}

function syncSuperAdminRoleOption() {
  const allowSuperAdmin = isSuperAdminUser();
  document.querySelectorAll('#u-role option[value="super_admin"]').forEach((option) => {
    option.disabled = !allowSuperAdmin;
    option.hidden = !allowSuperAdmin;
  });
  document.querySelectorAll('#u-role option[value="admin"]').forEach((option) => {
    option.disabled = !allowSuperAdmin;
    option.hidden = !allowSuperAdmin;
  });
}

function canCurrentUserManageUser(user = {}) {
  if (isSuperAdminUser()) return true;
  return !isPrivilegedRoleValue(user?.role);
}

function syncUserModalMode() {
  const title = document.getElementById('user-modal-title');
  const saveBtn = document.getElementById('user-save-btn');

  if (title) title.textContent = 'Edit User';
  if (saveBtn) saveBtn.textContent = 'Save Changes';
  syncSuperAdminRoleOption();
  syncUserAdminPasswordField();
  setupRequiredFieldMarkers(document.getElementById('user-modal-backdrop') || document);
}

function resetUserModalForm() {
  ['u-name', 'u-username', 'u-email', 'u-admin-pass'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const status = document.getElementById('u-status');
  if (status) status.value = '1';
  const role = document.getElementById('u-role');
  if (role) role.value = 'staff';
  const adminPassInput = document.getElementById('u-admin-pass');
  if (adminPassInput) adminPassInput.type = 'password';
}

function isStandaloneUserManagementPage() {
  return document.body?.classList.contains('user-management-page');
}

function openUserModal(user = null) {
  if (!user) {
    showToast('Use Register for new accounts. User Management is edit and approval only.', 'error');
    return;
  }

  userModalMode = user ? 'edit' : 'create';
  editingUserId = user ? Number(user.id || 0) : null;
  userModalSnapshot = user ? { ...user } : null;

  const modal = document.getElementById('user-modal-backdrop');
  if (modal) modal.classList.add('open');

  resetUserModalForm();

  if (user) {
    if (!canCurrentUserManageUser(user)) {
      closeUserModal();
      showToast('Only Super Admin can edit admin or super admin accounts.', 'error');
      return;
    }
    const nameInput = document.getElementById('u-name');
    const usernameInput = document.getElementById('u-username');
    const emailInput = document.getElementById('u-email');
    const roleInput = document.getElementById('u-role');
    const statusInput = document.getElementById('u-status');
    if (nameInput) nameInput.value = user.fullname || '';
    if (usernameInput) usernameInput.value = user.username || '';
    if (emailInput) emailInput.value = user.email || '';
    if (roleInput) {
      const safeRole = normalizeAccessRole(user.role || 'staff');
      roleInput.value = safeRole === 'user' ? 'staff' : safeRole;
      roleInput.disabled = !isSuperAdminUser();
    }
    if (statusInput) statusInput.value = Number(user.active || 0) === 1 ? '1' : '0';
  }

  syncUserModalMode();
  ['u-role', 'u-status'].forEach((id) => {
    const node = document.getElementById(id);
    if (!node || node.dataset.userPrivilegeBound === '1') return;
    node.dataset.userPrivilegeBound = '1';
    node.addEventListener('change', syncUserAdminPasswordField);
  });

}

function closeUserModal() {
  const modal = document.getElementById('user-modal-backdrop');
  if (modal) modal.classList.remove('open');
  editingUserId = null;
  userModalMode = 'create';
  userModalSnapshot = null;
  resetUserModalForm();
  syncUserModalMode();
}

async function saveUser() {
  const name     = document.getElementById('u-name').value.trim();
  const username = document.getElementById('u-username').value.trim();
  const email    = document.getElementById('u-email').value.trim().toLowerCase();
  const role     = document.getElementById('u-role').value;
  const status   = document.getElementById('u-status').value;
  const adminPassword = String(document.getElementById('u-admin-pass')?.value || '');
  const duplicateField = findUserDuplicateField(
    username,
    email,
    userModalMode === 'edit' ? editingUserId : 0
  );

  if (duplicateField) {
    const duplicateMessage = duplicateField === 'username'
      ? 'Username already exists.'
      : 'Email already exists.';
    showToast(duplicateMessage, 'error');
    const duplicateInput = duplicateField === 'username'
      ? document.getElementById('u-username')
      : document.getElementById('u-email');
    if (duplicateInput && typeof duplicateInput.focus === 'function') {
      duplicateInput.focus();
    }
    return;
  }

  if (userModalNeedsAdminPassword() && !adminPassword) {
    showToast('Current admin password is required for staff/admin access.', 'error');
    const adminPassInput = document.getElementById('u-admin-pass');
    if (adminPassInput && typeof adminPassInput.focus === 'function') adminPassInput.focus();
    return;
  }

  if (userModalMode === 'edit' && editingUserId) {
    try {
      const payload = {
        name,
        username,
        email,
        role,
        active: Number(status || 1),
        adminPassword
      };

      const res = await fetch(`/api/admin/users/${editingUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || 'Failed to update user.', 'error');
        return;
      }

      closeUserModal();
      showToast('Changes saved successfully!', 'success');
      await loadUsers();
      return;
    } catch (err) {
      console.error('Update User Error:', err);
      showToast('Network error o hindi maka-connect sa server.', 'error');
      return;
    }
  }

  if (isStandaloneUserManagementPage()) {
    showToast('Use Register for new accounts. User Management is edit and approval only.', 'error');
    return;
  }

  const created = await submitUserCreatePayload({
    name,
    username,
    email,
    role,
    active: Number(status || 1)
  });

  if (created) {
    closeUserModal();
    showToast('User created successfully!', 'success');
    await loadUsers();
  }
}

function editUser(id) {
  const user = usersDb.find(entry => Number(entry.id) === Number(id));
  if (!user) {
    showToast('User not found.', 'error');
    return;
  }
  openUserModal(user);
}
function toggleUser(id) {
  fetch(`/api/admin/users/${id}/toggle`, { method: 'PATCH' })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showToast(data.error || 'Failed to update user status.', 'error');
        return;
      }
      loadUsers();
    })
    .catch(() => {
      showToast('Network error o hindi maka-connect sa server.', 'error');
    });
}

async function approveUser(id, role = 'staff') {
  if (!id) return;
  const targetRole = String(role || 'staff');
  let adminPassword = '';
  if (isSuperAdminUser() && (targetRole === 'super_admin' || targetRole === 'admin' || targetRole === 'staff')) {
    adminPassword = await openApprovalPasswordDialog(targetRole);
    if (!adminPassword) return;
  }

  try {
    const res = await fetch(`/api/admin/users/${id}/approve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: targetRole, adminPassword })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      showToast(data.error || 'Failed to approve user.', 'error');
      return;
    }
    showToast('User approved successfully.', 'success');
    await loadUsers();
  } catch (err) {
    showToast('Network error o hindi maka-connect sa server.', 'error');
  }
}

async function rejectUser(id) {
  if (!id) return;
  const confirmed = await openConfirmDialog({
    title: 'Reject Registration?',
    message: 'Reject this pending account request?',
    noText: 'No',
    yesText: 'Yes'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/admin/users/${id}/reject`, { method: 'PATCH' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      showToast(data.error || 'Failed to reject user.', 'error');
      return;
    }
    showToast('Registration rejected.', 'success');
    await loadUsers();
  } catch (err) {
    showToast('Network error o hindi maka-connect sa server.', 'error');
  }
}

async function deleteUser(id) {
  if (!id) return;
  const confirmed = await openConfirmDialog({
    title: 'Delete User?',
    message: 'Sigurado ka bang i-delete ang user na ito? Hindi na ito maibabalik.',
    noText: 'No',
    yesText: 'Yes'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(data.error || 'Failed to delete user.', 'error');
      return;
    }
    showToast('User deleted successfully!', 'success');
    await loadUsers();
  } catch (err) {
    console.error('Delete User Error:', err);
    showToast('Network error o hindi maka-connect sa server.', 'error');
  }
}

// ==================== SYSTEM LOGS LOGIC ====================
function openLogsPanel() {
  if (!isAdminUser()) return;
  openDashboardPanel('system-logs');
  setSidebarOpen(false);
}

function loadLogs() {
  fetch('/api/admin/logs')
    .then(res => {
      if (!res.ok) throw new Error('Unauthorized or Server Error');
      return res.json();
    })
    .then(data => {
      logsDb = Array.isArray(data) ? data : [];
      renderLogs();
    })
    .catch(() => {
      const tbody = document.getElementById('logs-tbody');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color: var(--danger);">Failed to load logs.</td></tr>';
      }
    });
}

function renderLogs() {
  const q = String(document.getElementById('logs-search')?.value || '').trim().toLowerCase();
  const action = String(document.getElementById('logs-filter')?.value || '').trim();
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  const filtered = getFilteredLogs(tokens, action);
  const tbody = document.getElementById('logs-tbody');
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">No logs found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(log => `
    <tr>
      <td style="font-size: 0.65rem; color: var(--text-muted);">${highlight(new Date(log.created_at).toLocaleString(), q)}</td>
      <td><span class="log-action-badge">${highlight(log.module || 'system', q)}</span></td>
      <td><strong>${highlight(log.fullname || log.username || 'System', q)}</strong></td>
      <td><span class="log-action-badge">${highlight(log.action, q)}</span></td>
      <td style="font-size: 0.7rem; white-space: normal;">${highlight(log.details, q)}</td>
    </tr>
  `).join('');
}

function getFilteredLogs(tokens, action) {
  return logsDb.filter((log) => {
    const haystack = [
      log.module || '',
      log.fullname || '',
      log.username || '',
      log.action || '',
      log.details || ''
    ].join(' ').toLowerCase();
    const searchMatch = !tokens.length || tokens.every((token) => haystack.includes(token));
    const actionMatch = !action || String(log.action || '') === action;
    return searchMatch && actionMatch;
  });
}

function exportLogs(format = 'xls') {
  const q = String(document.getElementById('logs-search')?.value || '').trim();
  const action = String(document.getElementById('logs-filter')?.value || '').trim();
  const params = new URLSearchParams();
  params.set('format', String(format || 'xls').toLowerCase());
  if (q) params.set('q', q);
  if (action) params.set('action', action);
  window.location.href = `/api/admin/logs/export?${params.toString()}`;
}

function exportCurrentRecords(format = 'xls') {
  const search = String(document.getElementById('search-input')?.value || '').trim();
  const params = new URLSearchParams();
  params.set('format', String(format || 'xls').toLowerCase());
  params.set('archived', activeTab === 'archived' ? '1' : '0');
  if (search) params.set('q', search);
  window.location.href = `/api/transactions/export?${params.toString()}`;
}

function downloadCsv(filename, headers, rows) {
  const escapeCsv = (value) => {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  };

  const lines = [headers.join(',')];
  rows.forEach((row) => {
    lines.push(headers.map((header) => escapeCsv(row[header])).join(','));
  });

  const blob = new Blob([`\ufeff${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Service Order Functions
function openServiceOrderModal() {
  var modal = document.getElementById('service-order-modal-backdrop');
  if (!modal) return;
  
  document.getElementById('so-docno').value = '';
  document.getElementById('so-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('so-vendor').value = '';
  document.getElementById('so-billto').value = '';
  document.getElementById('so-project-id').value = '';
  document.getElementById('so-title').value = '';
  document.getElementById('so-amount').value = '';
  document.getElementById('so-ar-account').value = '';
  document.getElementById('so-status').value = 'unpaid';
  
  populateServiceOrderProjectSelect();
  
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeServiceOrderModal() {
  var modal = document.getElementById('service-order-modal-backdrop');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

function populateServiceOrderProjectSelect() {
  var select = document.getElementById('so-project-id');
  if (!select || !window.projects || !window.projects.length) return;
  
  select.innerHTML = '<option value="">Select Project</option>';
  window.projects.forEach(function(p) {
    var opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.doc_no + ' - ' + p.project_name;
    select.appendChild(opt);
  });
}

function saveServiceOrder() {
  var vendor = document.getElementById('so-vendor').value.trim();
  var billTo = document.getElementById('so-billto').value.trim();
  var title = document.getElementById('so-title').value.trim();
  
  if (!vendor || !billTo || !title) {
    showToast('Please fill in required fields (Vendor, Bill To, Service Title)', 'error');
    return;
  }
  
  var data = {
    doc_no: document.getElementById('so-docno').value || null,
    so_date: document.getElementById('so-date').value,
    vendor: vendor,
    bill_to: billTo,
    project_id: document.getElementById('so-project-id').value || null,
    title: title,
    amount: parseFloat(document.getElementById('so-amount').value) || 0,
    ar_account: document.getElementById('so-ar-account').value || null,
    status: document.getElementById('so-status').value
  };
  
  fetch('/api/service-orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  .then(function(res) { return res.json(); })
  .then(function(result) {
    if (result.success) {
      showToast('Service Order saved successfully!', 'success');
      closeServiceOrderModal();
      if (typeof renderServiceOrdersTable === 'function') {
        renderServiceOrdersTable();
      }
    } else {
      showToast(result.message || 'Error saving service order', 'error');
    }
  })
  .catch(function(err) {
    console.error('Save SO error:', err);
    showToast('Error saving service order', 'error');
  });
}












// Company Search for Project Modal
let projectCompanies = [];

async function loadProjectCompanies() {
  try {
    const query = new URLSearchParams({ include_archived: '1' });
    const r = await fetch(`/api/company-registry?${query.toString()}`);
    const d = await r.json();
    projectCompanies = Array.isArray(d) ? d : [];
  } catch (e) {
    projectCompanies = [];
  }
}

function filterProjectCompanies() {
  const i = document.getElementById('p-company-search');
  const r = document.getElementById('p-company-results');
  const h = document.getElementById('p-company-id');
  if (!i || !r) return;
  const q = String(i.value || '').trim().toLowerCase();
  if (!q) {
    r.style.display = 'none';
    r.innerHTML = '';
    return;
  }
  const f = projectCompanies.filter(c => {
    const n = String(c.company_name || '').toLowerCase();
    const no = String(c.company_no || '').toLowerCase();
    return n.includes(q) || no.includes(q);
  }).slice(0, 10);
  if (f.length === 0) {
    r.innerHTML = '<div class="search-result-item search-result-empty">No companies found</div>';
  } else {
    r.innerHTML = f.map(c => '<div class="search-result-item" data-id="' + c.id + '" data-name="' + escHtml(c.company_name) + '"><div class="search-result-name">' + escHtml(c.company_name) + '</div><div class="search-result-sub">' + escHtml(c.company_no || '') + ' &bull; ' + escHtml(c.contact_person || 'No contact') + '</div></div>').join('');
  }
  r.style.display = 'block';
}

function selectProjectCompany(id, name) {
  const h = document.getElementById('p-company-id');
  const i = document.getElementById('p-company-search');
  const r = document.getElementById('p-company-results');
  if (h) h.value = id;
  if (i) i.value = name;
  if (r) {
    r.style.display = 'none';
    r.innerHTML = '';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadProjectCompanies();
  syncBackButtonLabels();
  const i = document.getElementById('p-company-search');
  const r = document.getElementById('p-company-results');
  if (i && r) {
    r.addEventListener('click', e => {
      const it = e.target.closest('.search-result-item');
      if (it && !it.classList.contains('search-result-empty')) selectProjectCompany(it.dataset.id, it.dataset.name);
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.project-company-search')) r.style.display = 'none';
    });
  }
});
