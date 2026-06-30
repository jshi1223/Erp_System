/* Admin dashboard core */

'use strict';

const USER_BADGE_CACHE_KEY = 'kinaadman_currentUserBadge';

function normalizeAccessRole(role) {
  const safeRole = String(role || 'user').trim().toLowerCase();
  return ['super_admin', 'admin', 'staff', 'user'].includes(safeRole) ? safeRole : 'user';
}

function isAdminRoleValue(role) {
  return ['super_admin', 'admin'].includes(normalizeAccessRole(role));
}

function isPrivilegedRoleValue(role) {
  return ['super_admin', 'admin', 'staff'].includes(normalizeAccessRole(role));
}

function isStaffRoute() {
  return window.location.pathname.replace(/\/+$/, '') === '/staff';
}

function getWorkspaceHomePath() {
  return isStaffRoute() || normalizeAccessRole(currentUser?.role) === 'staff'
    ? '/staff'
    : '/admin';
}

function getStaffIdentityTerms() {
  const user = currentUser || {};
  return [
    user.fullname,
    user.name,
    user.username,
    user.email
  ]
    .map(value => String(value || '').trim().toLowerCase())
    .filter(value => value.length >= 3);
}

function textContainsStaffTerm(value, terms = getStaffIdentityTerms()) {
  const text = String(value || '').trim().toLowerCase();
  if (!text || !terms.length) return false;
  return terms.some(term => text.includes(term));
}

function isRecordOwnedByCurrentStaff(record) {
  const userId = Number(currentUser?.id || 0) || 0;
  if (!record) return false;
  const ownerIds = [
    record.created_by,
    record.user_id,
    record.owner_id,
    record.assigned_to,
    record.assigned_to_id
  ].map(value => Number(value || 0)).filter(Boolean);
  if (userId && ownerIds.includes(userId)) return true;

  const terms = getStaffIdentityTerms();
  return [
    record.created_by_name,
    record.created_by_username,
    record.created_by_email,
    record.assigned_to_name,
    record.assigned_to_username,
    record.assigned_to_email,
    record.created_by_label,
    record.owner_name,
    record.assignee_name
  ].some(value => textContainsStaffTerm(value, terms));
}

function projectCreatedByCurrentStaff(project) {
  if (!project) return false;
  const currentStaffId = Number(currentUser?.id || 0) || 0;
  const createdBy = Number(project.created_by || project.created_by_id || 0) || 0;
  if (currentStaffId && createdBy) return currentStaffId === createdBy;

  const terms = getStaffIdentityTerms();
  return [
    project.created_by_name,
    project.created_by_username,
    project.created_by_email,
    project.created_by_label,
    project.owner_name
  ].some(value => textContainsStaffTerm(value, terms));
}

function projectAssignedToCurrentStaff(project) {
  if (!project) return false;
  const currentStaffId = Number(currentUser?.id || 0) || 0;
  const assignedTo = Number(project.assigned_to || project.assigned_to_id || 0) || 0;
  if (assignedTo) return currentStaffId && assignedTo === currentStaffId;
  if (isRecordOwnedByCurrentStaff(project)) return true;

  const terms = getStaffIdentityTerms();
  return [
    project.assigned_to_name,
    project.assigned_to_username,
    project.assigned_to_email,
    project.project_manager,
    project.manager,
    project.members,
    project.project_members,
    project.member_role,
    project.project_members_2,
    project.member_role_2,
    project.project_members_3,
    project.member_role_3,
    project.source_member_name,
    project.source_member_name_2,
    project.source_member_name_3
  ].some(value => textContainsStaffTerm(value, terms));
}

function projectExplicitlyAssignedToCurrentStaff(project) {
  if (!project) return false;
  const currentStaffId = Number(currentUser?.id || 0) || 0;
  const assignedTo = Number(project.assigned_to || project.assigned_to_id || 0) || 0;
  if (currentStaffId && assignedTo) return currentStaffId === assignedTo;

  const terms = getStaffIdentityTerms();
  return [
    project.assigned_to_name,
    project.assigned_to_username,
    project.assigned_to_email,
    project.project_manager,
    project.manager,
    project.members,
    project.project_members,
    project.member_role,
    project.project_members_2,
    project.member_role_2,
    project.project_members_3,
    project.member_role_3,
    project.source_member_name,
    project.source_member_name_2,
    project.source_member_name_3
  ].some(value => textContainsStaffTerm(value, terms));
}

function getProjectStaffOwnershipMeta(project) {
  const created = projectCreatedByCurrentStaff(project);
  const assigned = projectExplicitlyAssignedToCurrentStaff(project);
  if (created && assigned) return { label: 'Created + Assigned to me', tone: 'both' };
  if (created) return { label: 'Created by me', tone: 'created' };
  if (assigned) return { label: 'Assigned to me', tone: 'assigned' };
  return { label: 'Shared project', tone: 'shared' };
}

function renderProjectStaffOwnershipBadge(project) {
  if (!isStaffUser()) return '';
  const meta = getProjectStaffOwnershipMeta(project);
  return `<div class="project-staff-meta"><span class="project-staff-badge" data-tone="${escHtml(meta.tone)}">${escHtml(meta.label)}</span></div>`;
}

function projectVisibleToCurrentStaff(project) {
  return projectAssignedToCurrentStaff(project);
}

function normalizeWorkspaceHref(href) {
  const target = String(href || '').trim();
  if (!target) return '';
  if (getWorkspaceHomePath() !== '/staff') return target;
  if (target === '/admin') return '/staff';
  if (target.startsWith('/admin?')) return `/staff?${target.slice('/admin?'.length)}`;
  if (target.startsWith(`${window.location.origin}/admin?`)) {
    return target.replace(`${window.location.origin}/admin?`, `${window.location.origin}/staff?`);
  }
  return target;
}

function getCachedAccessRole() {
  return normalizeAccessRole(currentUser?.role || 'user');
}

function getDashboardProjectLabel(roleValue = currentUser?.role) {
  return normalizeAccessRole(roleValue || getCachedAccessRole()) === 'staff' ? 'Approved Projects' : 'Projects';
}

function getDashboardTotalProjectLabel(roleValue = currentUser?.role) {
  return normalizeAccessRole(roleValue || getCachedAccessRole()) === 'staff' ? 'Approved Projects' : 'Total Projects';
}

function cleanupAdminSidebarDuplicates() {
  const sidebar = document.getElementById('sidebar');
  const nav = sidebar?.querySelector(':scope > .sidebar-nav');
  if (!sidebar || !nav) return;

  const legacyGroupKeys = new Set(['accounts-payable', 'accounts-receivable']);
  const seenGroupKeys = new Set();
  nav.querySelectorAll('.sidebar-group[data-sidebar-group]').forEach((group) => {
    const key = String(group.getAttribute('data-sidebar-group') || '').trim();
    const isDirectGroup = group.parentElement === nav;
    if (!isDirectGroup || legacyGroupKeys.has(key) || seenGroupKeys.has(key)) {
      group.remove();
      return;
    }
    seenGroupKeys.add(key);
  });

  const seenDashboardLinks = [];
  nav.querySelectorAll('.sidebar-link').forEach((link) => {
    const href = String(link.getAttribute('href') || '').trim();
    const isDashboard = link.id === 'menu-dashboard' || href === '/admin' || href === '/admin?view=dashboard';
    const isNestedTopLevel = link.parentElement !== nav && !link.classList.contains('is-subitem');
    if (isDashboard) seenDashboardLinks.push(link);
    if (isNestedTopLevel) link.remove();
  });
  seenDashboardLinks.slice(1).forEach((link) => link.remove());
}

document.addEventListener('DOMContentLoaded', () => {
  cleanupAdminSidebarDuplicates();
  window.setTimeout(cleanupAdminSidebarDuplicates, 0);
  window.setTimeout(cleanupAdminSidebarDuplicates, 250);
  if (window.location.pathname.replace(/\/+$/, '') === '/admin' && !new URLSearchParams(window.location.search).has('panel')) {
    currentDashboardCompany = 'all';
    localStorage.setItem('kinaadman_dashboardCompany', 'all');
    localStorage.setItem('kinaadman_dashboardPanel', 'home');
  }
  applyStoredBusinessEntityBrand();
  applyCachedRoleBadge();
  loadNotificationReadState();
  const initialParams = new URLSearchParams(window.location.search);
  pendingTransactionProjectId = null;
  pendingTransactionLaunch = false;

  // 1. I-verify ang User Role at I-restore ang huling active tab
  fetch('/api/me').then(r => r.json()).then(user => {
    currentUser = user;
    if (user?.csrfToken) {
      window.__CSRF_TOKEN__ = user.csrfToken;
    }
    updateRoleBadge(user);
    const safeCurrentRole = normalizeAccessRole(user.role);
    window.KinaadmanRoleFlow?.apply(safeCurrentRole, user);
    syncBackButtonLabels();
    
    if (isAdminRoleValue(user.role)) {
      const adminSidebarGroup = document.querySelector('.sidebar-group[data-sidebar-group="admin"]');
      if (adminSidebarGroup) {
        adminSidebarGroup.style.display = '';
        adminSidebarGroup.setAttribute('aria-hidden', 'false');
      }
      const canManageSettings = safeCurrentRole === 'super_admin';
      const canManageUsers = isAdminRoleValue(safeCurrentRole);
      const utab = document.getElementById('tab-users');
      if (utab) utab.style.display = canManageUsers ? 'block' : 'none';

      const menuUsers = document.getElementById('menu-users');
      if (menuUsers) menuUsers.style.display = canManageUsers ? 'block' : 'none';

      const menuBusinessEntities = document.getElementById('menu-business-entities');
      if (menuBusinessEntities) menuBusinessEntities.style.display = canManageSettings ? 'block' : 'none';
      
      const menuLogs = document.getElementById('menu-logs');
      if (menuLogs) menuLogs.style.display = canManageSettings ? 'block' : 'none';

      const menuArchiveCenter = document.getElementById('menu-archive-center');
      if (menuArchiveCenter) menuArchiveCenter.style.display = canManageUsers ? 'block' : 'none';
    } else {
      const adminSidebarGroup = document.querySelector('.sidebar-group[data-sidebar-group="admin"]');
      if (adminSidebarGroup) {
        adminSidebarGroup.style.display = 'none';
        adminSidebarGroup.setAttribute('aria-hidden', 'true');
      }
    }

    const storedTab = localStorage.getItem('kinaadman_activeTab');
    if (storedTab === 'archived') {
      localStorage.setItem('kinaadman_dashboardPanel', 'archive-center');
    }
    const archivedMenu = document.getElementById('menu-archived');
    const allowedTabs = isAdminRoleValue(safeCurrentRole) ? ['all', 'users'] : ['all'];

    if (archivedMenu) archivedMenu.style.display = isAdminRoleValue(user.role) ? '' : 'none';
    activeTab = allowedTabs.includes(storedTab) ? storedTab : 'all';
    localStorage.setItem('kinaadman_activeTab', activeTab);
    updateSidebarMenuState('dashboard');

    const userManagementPage = document.getElementById('user-management-page');
    if (userManagementPage) {
      activeTab = 'users';
      localStorage.setItem('kinaadman_activeTab', 'users');
      updateSidebarMenuState('users');

      const pageTitle = document.querySelector('.page-title');
      const pageSub = document.querySelector('.page-sub');
      const addBtn = document.getElementById('btn-main-add');
      if (pageTitle) pageTitle.textContent = 'User Management';
      if (pageSub) pageSub.textContent = 'Approve registered accounts and manage existing users.';
      if (addBtn) {
        addBtn.style.display = 'none';
        addBtn.onclick = null;
      }

      loadUsers();
      renderUsers();
    }

    applyPermissionMatrix();
    if (document.querySelector('.stats')) {
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
  setupTransactionModalValidationListeners();
  setupUserModalValidationListeners();
  setupResetPasswordModalValidationListeners();
  setupProjectCalculationListeners();
  setupProjectModalValidationListeners();
  setupServiceOrderModalValidationListeners();
  setupServiceOrderPickerListeners();
  setupGanttPlannerPanel();
  setupPasswordToggleListeners();
  setupNotificationButtonListeners();
  setupSidebarLinkNavigation();
  syncSidebarGroupStates();
  cleanupAdminSidebarDuplicates();
  syncSidebarActiveLinks();
  syncBackButtonLabels();
  loadBusinessEntities();
  updateDeployStatusCard();

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
  const rememberedProjectWorkspaceTab = localStorage.getItem('kinaadman_projectWorkspaceTab');
  const staffView = normalizeAccessRole(user?.role) === 'staff';
  const allowedPanels = ['home', 'project-records', 'project-ledger', 'total-projects', 'ongoing-projects', 'system-logs', 'archive-center', 'approval-center'];
  const allowedTabs = isAdminRoleValue(user?.role) ? ['all', 'archived', 'users'] : ['all'];
  const menuByTab = {
    all: document.getElementById('menu-all'),
    archived: document.getElementById('menu-archived'),
    users: document.getElementById('menu-users')
  };

  // A stale view=dashboard must not override an explicit panel (e.g. approval-center)
  // still in the URL — otherwise refreshing on that panel bounces back to the dashboard.
  if (requestedView === 'dashboard' && !requestedPanel) {
    activeTab = 'all';
    localStorage.setItem('kinaadman_activeTab', 'all');
    localStorage.setItem('kinaadman_dashboardPanel', 'home');
    openDashboardPanel('home');
    return;
  }

  if (requestedPanel === 'project-records') {
    currentProjectWorkspaceTab = normalizeProjectWorkspaceTab(requestedTab || rememberedProjectWorkspaceTab || currentProjectWorkspaceTab);
    openDashboardPanel('project-records');
    syncProjectWorkspaceSearchFromUrl();
    return;
  }

  if (requestedPanel === 'project-ledger') {
    if (staffView) {
      currentProjectWorkspaceTab = 'projects';
      openDashboardPanel('project-records');
      return;
    }
    currentProjectLedgerId = Number(params.get('project_id') || 0) || null;
    openDashboardPanel('project-ledger');
    return;
  }

  if (requestedView === 'all') {
    currentProjectWorkspaceTab = normalizeProjectWorkspaceTab(requestedTab || rememberedProjectWorkspaceTab || currentProjectWorkspaceTab);
    window.location.replace(normalizeWorkspaceHref(`/admin?panel=project-records&tab=${encodeURIComponent(currentProjectWorkspaceTab)}`));
    return;
  }

  if ((requestedView === 'archived' || requestedView === 'archive-center') && isAdminRoleValue(user?.role)) {
    openArchiveCenter();
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

  if (requestedPanel === 'reports') {
    window.location.replace('/reports');
    return;
  }

  if (requestedView === 'ongoing' || requestedView === 'ongoing-projects') {
    if (staffView) {
      currentProjectWorkspaceTab = 'projects';
      openDashboardPanel('project-records');
      return;
    }
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

    if (requestedPanel === 'archive-center') {
      if (isAdminRoleValue(user?.role)) {
        openArchiveCenter();
      } else {
        openDashboardPanel('home');
      }
      return;
    }

    if (requestedPanel === 'approval-center') {
      if (isAdminRoleValue(user?.role)) {
        openDashboardPanel('approval-center');
      } else {
        openDashboardPanel('home');
      }
      return;
    }

    if (requestedPanel === 'ongoing-projects') {
      if (staffView) {
        currentProjectWorkspaceTab = 'projects';
        openDashboardPanel('project-records');
        return;
      }
      openDashboardPanel('ongoing-projects');
      return;
    }

    if (requestedPanel === 'total-projects') {
      openDashboardPanel('project-records');
      return;
    }

    if (requestedPanel === 'project-records') {
      currentProjectWorkspaceTab = normalizeProjectWorkspaceTab(requestedTab || rememberedProjectWorkspaceTab || currentProjectWorkspaceTab);
      openDashboardPanel('project-records');
      return;
    }

    openDashboardPanel(requestedPanel || 'home');
    return;
  }

  if (!requestedView) {
    currentDashboardCompany = 'all';
    localStorage.setItem('kinaadman_dashboardCompany', 'all');
    localStorage.setItem('kinaadman_dashboardPanel', 'home');
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
      url.searchParams.set('tab', normalizeProjectWorkspaceTab(currentProjectWorkspaceTab));
      url.searchParams.delete('project_id');
    } else if (panel === 'project-ledger') {
      url.searchParams.set('panel', 'project-ledger');
      url.searchParams.delete('tab');
      if (currentProjectLedgerId) {
        url.searchParams.set('project_id', String(currentProjectLedgerId));
      } else {
        url.searchParams.delete('project_id');
      }
    } else if (panel === 'total-projects') {
      const safeTab = isAdminUser() && tab === 'archived' ? 'archived' : (isAdminUser() && tab === 'users' ? 'users' : 'all');
      url.searchParams.set('panel', safeTab === 'archived' ? 'total-projects' : 'project-records');
      url.searchParams.set('tab', safeTab);
      url.searchParams.delete('project_id');
    } else if (panel === 'ongoing-projects') {
      url.searchParams.set('panel', 'ongoing-projects');
      url.searchParams.delete('tab');
      url.searchParams.delete('project_id');
    } else if (panel === 'archive-center') {
      url.searchParams.set('panel', 'archive-center');
      url.searchParams.delete('tab');
      url.searchParams.delete('project_id');
    } else if (panel === 'approval-center') {
      url.searchParams.set('panel', 'approval-center');
      url.searchParams.delete('tab');
      url.searchParams.delete('project_id');
    } else if (panel === 'system-logs') {
      url.searchParams.set('panel', 'system-logs');
      url.searchParams.delete('tab');
      url.searchParams.delete('project_id');
    } else {
      url.searchParams.delete('panel');
      url.searchParams.delete('tab');
      url.searchParams.delete('project_id');
    }

    const search = url.searchParams.toString();
    const nextUrl = `${url.pathname}${search ? `?${search}` : ''}${url.hash || ''}`;
    window.history.replaceState({}, '', nextUrl);
  } catch (_) {
    // Ignore URL parsing issues; UI state is already applied.
  }
}

function clearTransactionLaunchUrlParams() {
  try {
    const url = new URL(window.location.href);
    const hadLaunchParams = url.searchParams.has('action') || url.searchParams.has('project_id');
    if (!hadLaunchParams) return;
    url.searchParams.delete('action');
    url.searchParams.delete('project_id');
    const search = url.searchParams.toString();
    const nextUrl = `${url.pathname}${search ? `?${search}` : ''}${url.hash || ''}`;
    window.history.replaceState({}, '', nextUrl);
  } catch (_) {
    // Ignore URL parsing issues; UI state is already applied.
  }
}

function updateSidebarMenuState(tab) {
  const menuIdMap = {
    'archive-center': 'menu-archive-center',
    'approval-center': 'menu-approval-center'
  };
  const activeMenuId = menuIdMap[tab] || `menu-${tab}`;
  document.querySelectorAll('.sidebar-link').forEach(l => {
    if (l.id && l.id.startsWith('menu-')) {
      l.classList.toggle('active', l.id === activeMenuId);
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

  if (panel === 'project-ledger') {
    pageTitle.textContent = 'Project Overview';
    pageSub.textContent = '';
    return;
  }

  if (panel === 'total-projects') {
    pageTitle.textContent = activeTab === 'archived' ? 'Archived Transactions' : 'Transactions';
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

  if (panel === 'archive-center') {
    pageTitle.textContent = 'Archive Center';
    pageSub.textContent = '';
    return;
  }

  if (panel === 'approval-center') {
    pageTitle.textContent = 'Approval Center';
    pageSub.textContent = 'Pending decisions and approval actions';
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
  badge.dataset.userReady = '1';
  try {
    localStorage.setItem(USER_BADGE_CACHE_KEY, JSON.stringify({
      id: user?.id || '',
      fullname: user?.fullname || '',
      username: user?.username || '',
      email: user?.email || '',
      role: safeRole
    }));
  } catch (_) {}
}

function applyCachedRoleBadge() {
  // Role badge is populated only after /api/me verifies the active session.
}

function openDashboardPanel(panel = 'home', opts = {}) {
  if (isStaffUser() && ['project-ledger', 'total-projects', 'ongoing-projects'].includes(panel)) {
    panel = 'project-records';
    currentProjectWorkspaceTab = 'projects';
  }
  if (!isSuperAdminUser() && panel === 'system-logs') {
    showToast('Super Admin access is required for system control pages.', 'error');
    panel = 'home';
  }
  if (panel === 'total-projects' && activeTab !== 'archived') {
    panel = 'project-records';
  }
  if (['project-records', 'project-ledger', 'ongoing-projects'].includes(panel)) {
    currentDashboardCompany = 'all';
    localStorage.setItem('kinaadman_dashboardCompany', 'all');
    syncDashboardCompanyFilterOptions();
  }
  currentDashboardPanel = panel;
  document.body.dataset.dashboardPanel = panel;
  localStorage.setItem('kinaadman_dashboardPanel', panel);
  if (opts.syncUrl !== false) {
    syncAdminViewUrl(panel, activeTab);
  }

  const sections = {
    reports: document.getElementById('reports-section'),
    'project-records': document.getElementById('project-records-section'),
    'project-ledger': document.getElementById('project-ledger-page-section'),
    'total-projects': document.getElementById('total-projects-section'),
    'ongoing-projects': document.getElementById('ongoing-projects-section'),
    'system-logs': document.getElementById('system-logs-section'),
    'archive-center': document.getElementById('archive-center-section'),
    'approval-center': document.getElementById('approval-center')
  };

  Object.entries(sections).forEach(([key, section]) => {
    if (!section) return;
    section.classList.toggle('is-hidden', key !== panel);
  });

  const statsRow = document.getElementById('dashboard-summary-cards') || document.querySelector('.dashboard-stats');
  if (statsRow) {
    if (panel === 'home') {
      statsRow.style.display = isStaffUser() ? 'flex' : 'grid';
      if (isStaffUser()) {
        statsRow.style.flexWrap = 'wrap';
        statsRow.style.gap = '14px';
        statsRow.style.gridTemplateColumns = 'none';
      }
    } else {
      statsRow.style.display = 'none';
    }
  }
  const roleAccessPanel = document.getElementById('role-access-panel');
  if (roleAccessPanel) {
    roleAccessPanel.classList.toggle('is-hidden', panel !== 'home');
  }
  const approvalCenter = document.getElementById('approval-center');
  if (approvalCenter) {
    approvalCenter.classList.toggle('is-hidden', panel !== 'approval-center' || !isAdminUser());
  }
  if (panel === 'home') {
    updateSidebarMenuState('dashboard');
  } else if (panel === 'reports') {
    updateSidebarMenuState('reports');
  } else if (panel === 'project-records') {
    updateSidebarMenuState('projects');
  } else if (panel === 'project-ledger') {
    updateSidebarMenuState('projects');
  } else if (panel === 'total-projects') {
    updateSidebarMenuState('all');
  } else if (panel === 'ongoing-projects') {
    updateSidebarMenuState('ongoing-projects');
  } else if (panel === 'system-logs') {
    updateSidebarMenuState('logs');
  } else if (panel === 'archive-center') {
    updateSidebarMenuState('archive-center');
  } else if (panel === 'approval-center') {
    updateSidebarMenuState('approval-center');
  }

  updateDashboardHero(panel);

  if (panel === 'ongoing-projects') {
    ongoingProjectsViewMode = 'ongoing';
    renderOngoingProjects();
  } else if (panel === 'system-logs') {
    loadLogs();
  } else if (panel === 'archive-center') {
    loadArchiveCenter();
  } else if (panel === 'approval-center') {
    renderApprovalCenter(true);
  } else if (panel === 'project-records') {
    renderProjectWorkspace();
  } else if (panel === 'project-ledger') {
    loadProjectLedgerPage(currentProjectLedgerId);
  } else if (panel === 'total-projects') {
    renderTable();
  }
}

function loadProjectsDashboardData() {
  const requestSeq = ++projectsLoadSeq;
  return fetch('/api/projects?include_archived=1', { cache: 'no-store' })
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => {
      if (requestSeq !== projectsLoadSeq) return;
      projectsDashboardDb = Array.isArray(data) ? data : [];
      syncDashboardCompanyFilterOptions();
      populateTransactionProjectSelect(document.getElementById('f-project-id')?.value || '');
      populateServiceOrderProjectSelect(document.getElementById('so-project-id')?.value || '');
      renderOngoingProjects();
      renderProjectWorkspace();
      renderProjectMasterTable();
      if (document.getElementById('gantt-project-cards')) {
        renderGanttProjectSwitcher();
      }
      if (typeof updateStats === 'function') {
        updateStats().catch((err) => {
          console.error('Dashboard stats refresh error:', err);
        });
      }
      if (currentDashboardPanel === 'project-records') {
        renderProjectWorkspace();
      }
      if (currentDashboardPanel === 'total-projects') {
        renderTable();
      }
      if (currentDashboardPanel === 'project-ledger') {
        loadProjectLedgerPage(currentProjectLedgerId);
      }
      if (pendingTransactionLaunch || pendingTransactionProjectId) {
        pendingTransactionLaunch = false;
        pendingTransactionProjectId = null;
        clearTransactionLaunchUrlParams();
      }
    })
    .catch(err => {
      if (requestSeq !== projectsLoadSeq) return;
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
  const sources = [
    Array.isArray(companyRegistryDb) ? companyRegistryDb : [],
    Array.isArray(projectCompanies) ? projectCompanies : []
  ];
  const seen = new Set();
  const entries = [];

  sources.forEach((source) => {
    source.forEach((row) => {
      const entry = {
        id: Number(row?.id || 0),
        company_no: String(row?.company_no || '').trim(),
        company_name: String(row?.company_name || '').trim(),
        address: String(row?.address || '').trim(),
        business_entity_id: String(row?.business_entity_id || '').trim(),
        archived: Number(row?.archived || 0) || 0
      };

      if (!entry.id || !entry.company_no || !entry.company_name) return;
      if (!businessEntityMatches(entry)) return;

      const key = `${entry.id}:${entry.company_no.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      entries.push(entry);
    });
  });

  return entries.sort((a, b) => a.company_name.localeCompare(b.company_name));
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

function findRegistryCompanyBySearchValue(value) {
  const target = String(value || '').trim().toLowerCase();
  if (!target) return null;
  const matches = getRegistryCompanySearchMatches(value);
  return matches.exact || (matches.partial.length === 1 ? matches.partial[0] : null);
}

function getRegistryCompanySearchMatches(value) {
  const target = String(value || '').trim().toLowerCase();
  const empty = { exact: null, partial: [] };
  if (!target) return empty;
  const entries = getRegistryCompanyEntries();
  const exact = entries.find((row) => {
    const label = getRegistryCompanyLabel(row).toLowerCase();
    return String(row.id || '').toLowerCase() === target
      || String(row.company_no || '').toLowerCase() === target
      || String(row.company_name || '').toLowerCase() === target
      || label === target;
  });

  const partial = entries.filter((row) => {
    const haystack = [
      row.company_no,
      row.company_name,
      getRegistryCompanyLabel(row),
      row.address
    ].map((part) => String(part || '').toLowerCase()).join(' ');
    return haystack.includes(target);
  });

  return { exact: exact || null, partial };
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

  (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : []).filter(businessEntityMatches).forEach(project => {
    const companyName = getProjectCompanyName(project);
    addCompany(companyName, companyName);
  });

  (Array.isArray(allReceivablesDb) ? allReceivablesDb : []).filter(businessEntityMatches).forEach(row => {
    const companyName = getReceivableCompanyName(row);
    addCompany(companyName, companyName);
  });

  (Array.isArray(companyRegistryDb) ? companyRegistryDb : []).forEach(row => {
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
  const searchInput = document.getElementById('p-company-search');
  const hiddenInput = document.getElementById('p-company-id');
  const results = document.getElementById('p-company-results');

  const options = getRegistryCompanyEntries();
  const current = String(selectedCompany || '').trim();
  const matchById = options.find((option) => String(option.id || '').toLowerCase() === current.toLowerCase());
  const matchByNo = options.find((option) => String(option.company_no || '').toLowerCase() === current.toLowerCase());
  const matchByName = options.find((option) => String(option.company_name || '').toLowerCase() === current.toLowerCase());
  const selected = matchById || matchByNo || matchByName || null;

  if (hiddenInput) {
    hiddenInput.value = selected ? String(selected.id) : (/^\d+$/.test(current) ? current : '');
    hiddenInput.setAttribute('aria-invalid', 'false');
  }

  if (searchInput) {
    searchInput.value = selected ? getRegistryCompanyLabel(selected) : current;
    searchInput.setAttribute('aria-invalid', 'false');
  }

  if (results) {
    results.style.display = 'none';
    results.innerHTML = '';
  }
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
    .filter((project) => businessEntityMatches(project))
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
  populateBusinessEntitySelect('f-business-entity-id', project?.business_entity_id || '');
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

  void syncTransactionServiceOrderFromProject(projectId, 0);
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
  void syncTransactionServiceOrderFromProject(project.id, 0);
}

function getTransactionServiceOrderLabel(serviceOrder) {
  if (!serviceOrder) return '';
  const soNumber = String(serviceOrder.so_number || '').trim();
  const title = String(serviceOrder.service_title || '').trim();
  const parts = [soNumber, title].filter(Boolean);
  return parts.join(' - ') || soNumber || title || '';
}

function getTransactionServiceOrderRecordByProjectId(projectId) {
  const normalizedProjectId = Number(projectId || 0) || 0;
  if (!normalizedProjectId) return null;

  const serviceOrders = Array.isArray(serviceOrdersDb) ? serviceOrdersDb : [];
  return serviceOrders.find((entry) => Number(entry.project_id || 0) === normalizedProjectId && Number(entry.is_archived || 0) === 0)
    || serviceOrders.find((entry) => Number(entry.project_id || 0) === normalizedProjectId)
    || null;
}

function setTransactionServiceOrderSelection(serviceOrderId = '', serviceOrderLabel = '') {
  const hidden = document.getElementById('f-service-order-id');
  const input = document.getElementById('f-service-order-ref');

  if (hidden) hidden.value = serviceOrderId ? String(serviceOrderId) : '';
  if (input) input.value = serviceOrderLabel || '';
}

async function syncTransactionServiceOrderFromProject(projectId = null, preferredServiceOrderId = undefined) {
  const normalizedProjectId = Number(projectId || document.getElementById('f-project-id')?.value || 0) || 0;
  const normalizedPreferredServiceOrderId = preferredServiceOrderId === undefined
    ? Number(document.getElementById('f-service-order-id')?.value || 0) || 0
    : Number(preferredServiceOrderId || 0) || 0;

  if (!Array.isArray(serviceOrdersDb) || !serviceOrdersDb.length) {
    try {
      await loadServiceOrdersData();
    } catch (err) {
      console.error('Load service orders for transaction sync error:', err);
    }
  }

  const serviceOrders = Array.isArray(serviceOrdersDb) ? serviceOrdersDb : [];
  const preferredRecord = normalizedPreferredServiceOrderId
    ? serviceOrders.find((entry) => Number(entry.id || 0) === normalizedPreferredServiceOrderId) || null
    : null;
  const projectRecord = normalizedProjectId ? getTransactionServiceOrderRecordByProjectId(normalizedProjectId) : null;
  const selectedRecord = preferredRecord || projectRecord || null;

  if (selectedRecord) {
    if (!normalizedProjectId && Number(selectedRecord.project_id || 0) > 0) {
      const linkedProjectId = Number(selectedRecord.project_id || 0) || 0;
      const projectSelect = document.getElementById('f-project-id');
      const linkedProject = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
        .find((entry) => Number(entry.id || 0) === linkedProjectId);
      if (projectSelect) projectSelect.value = String(linkedProjectId);
      if (linkedProject) fillTransactionProjectData(linkedProject);
    }
    setTransactionServiceOrderSelection(selectedRecord.id, getTransactionServiceOrderLabel(selectedRecord));
    setTransactionFieldMessage('service_order_id', '');
    return selectedRecord;
  }

  setTransactionServiceOrderSelection('', '');
  setTransactionFieldMessage('service_order_id', '');
  return null;
}

function getProjectCompanyInputValue() {
  const hidden = document.getElementById('p-company-id');
  if (hidden && !String(hidden.value || '').trim()) {
    resolveProjectCompanySearch();
  }
  return String(hidden?.value || '').trim();
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
  renderProjectWorkspace();
  if (currentDashboardPanel === 'total-projects') {
    renderTable();
  } else {
    renderProjectMasterTable();
  }
  renderOngoingProjects();
  renderDashboardAnalytics(getDashboardInvoiceRows());
  renderInvoiceStatusQuickView(getDashboardInvoiceRows());
  updateCompanyRegistryStatCard();
  if (typeof updateStats === 'function') {
    updateStats();
  }
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
  let confirmed = false;
  if (archive) {
    const summary = await loadProjectArchiveSummary(id);
    confirmed = await openConfirmDialog({
      title: 'Archive Project',
      message: buildProjectArchiveWarningMessage(summary),
      noText: 'Cancel',
      yesText: 'Archive Project'
    });
  } else {
    confirmed = await openConfirmDialog({
      title: 'Restore Project',
      message: 'Restore this project record? New linked activity will be allowed again after restore.',
      noText: 'Cancel',
      yesText: 'Restore'
    });
  }
  if (!confirmed) return;

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

async function approveProject(projectId) {
  const id = Number(projectId || 0);
  if (!id || !isAdminUser()) return;

  const confirmed = await openConfirmDialog({
    title: 'Approve Project',
    message: 'Approve this submitted project? After approval, project activity and PR creation will be allowed.',
    noText: 'Cancel',
    yesText: 'Approve'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/projects/${id}/approve`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Unable to approve project.');
    await loadProjectsDashboardData();
    showToast(data.alreadyApproved ? 'Project is already approved.' : 'Project approved.', 'success');
  } catch (err) {
    showToast(err.message || 'Unable to approve project.', 'error');
  }
}

async function submitProject(projectId) {
  const id = Number(projectId || 0);
  if (!id) return;

  const confirmed = await openConfirmDialog({
    title: 'Submit Project',
    message: 'Submit this draft project for admin approval?',
    noText: 'Cancel',
    yesText: 'Submit'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/projects/${id}/submit`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Unable to submit project.');
    await loadProjectsDashboardData();
    showToast(data.alreadySubmitted ? 'Project is already submitted.' : 'Project submitted for approval.', 'success');
  } catch (err) {
    showToast(err.message || 'Unable to submit project.', 'error');
  }
}

async function loadProjectArchiveSummary(projectId) {
  try {
    const res = await fetch(`/api/projects/${Number(projectId)}/archive-summary`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Unable to load project archive summary.');
    return data;
  } catch (err) {
    showToast(err.message || 'Unable to load archive warning. Showing basic confirmation.', 'error');
    return null;
  }
}

function buildProjectArchiveWarningMessage(summary) {
  if (!summary) {
    return 'Archive this project only? Related records will stay visible in their modules for accounting, procurement, and audit history.';
  }

  const project = summary.project || {};
  const counts = summary.counts || {};
  const rows = [
    ['Open PR', counts.purchase_requisitions?.open, counts.purchase_requisitions?.total],
    ['Open PO', counts.purchase_orders?.open, counts.purchase_orders?.total],
    ['Unpaid AP Bills', counts.accounts_payable?.open, counts.accounts_payable?.total],
    ['Unpaid AR Invoices', counts.accounts_receivable?.open, counts.accounts_receivable?.total],
    ['Active Service Orders', counts.service_orders?.open, counts.service_orders?.total],
    ['Pending Tasks', counts.tasks?.open, counts.tasks?.total]
  ];

  const detail = rows
    .map(([label, open, total]) => `${label}: ${Number(open || 0)} open / ${Number(total || 0)} total`)
    .join('\n');
  const projectLabel = [project.project_docno, project.project_name].filter(Boolean).join(' - ') || 'this project';

  return [
    `Archive ${projectLabel}?`,
    '',
    detail,
    '',
    'Only the project will move to archive. Related PR, PO, AP, AR, Service Orders, and Tasks will stay visible for audit/history.',
    'New activity for this project will be blocked until it is restored.'
  ].join('\n');
}

function renderProjectMasterTable() {
  const tbody = document.getElementById('project-table-body');
  if (!tbody) return;
  const rawQuery = String(document.getElementById('project-search-input')?.value || '').trim();
  const q = rawQuery.toLowerCase();
  const lifecycleFilter = String(document.getElementById('project-lifecycle-filter')?.value || 'all').toLowerCase();

  const list = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
    .map(project => ({ ...project, lifecycle: getProjectLifecycleLabel(project) }))
    .filter(project => businessEntityMatches(project))
    .filter(project => !projectHiddenFromAdmin(project))
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
    const isDraft = isProjectDraft(project);
    const isSubmitted = isProjectSubmitted(project);
    const isPendingApproval = isProjectPendingApproval(project);

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
            ${isDraft
              ? `<button class="btn btn-sm btn-add" type="button" onclick="submitProject(${Number(project.id)})">Submit</button>`
              : ''}
            ${isSubmitted && isAdminUser()
              ? `<button class="btn btn-sm btn-add" type="button" onclick="approveProject(${Number(project.id)})">Approve</button>`
              : ''}
            ${isPendingApproval
              ? `<span class="status-pill status-${isSubmitted ? 'submitted' : 'draft'}" title="${isSubmitted ? 'Waiting for admin approval' : 'Draft project, submit when ready'}">${isSubmitted ? 'For Approval' : 'Draft'}</span>`
              : `<button class="btn btn-sm btn-add" type="button" onclick="openProjectRequisition(${Number(project.id)})">Add PR</button><button class="btn btn-sm btn-add" type="button" onclick="openProjectSalesInquiry(${Number(project.id)})">Add SI</button>`}
            <button class="btn btn-sm btn-pdf" type="button" onclick="openProjectPdfViewer(${Number(project.id)})">View PDF</button>
            ${isAdminUser()
              ? `<button class="btn btn-sm btn-pdf" type="button" onclick="openRecordHistory('project', ${Number(project.id)}, '${escHtml(String(project.project_docno || project.draft_docno || ('Project #' + Number(project.id))).replace(/'/g, ''))}')" title="View history">History</button>`
              : ''}
            ${isAdminUser()
              ? (isArchived
                ? `<button class="btn btn-sm btn-restore" type="button" onclick="toggleProjectArchive(${Number(project.id)}, false)" title="Restore Project">Restore</button>`
                : `<button class="btn btn-sm btn-archive" type="button" onclick="toggleProjectArchive(${Number(project.id)}, true)" title="Archive Project">Archive</button>`)
              : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderProjectRecordsTable() {
  const tbody = document.getElementById('project-records-table-body');
  if (!tbody) return;
  // Mark the table rendered so the CSS gate can reveal it. Until this runs the
  // table is hidden, so the narrow/loading layout never flashes on refresh.
  const recordsWrap = tbody.closest('.project-records-wrap');
  if (recordsWrap) recordsWrap.dataset.ready = '1';

  const rawQuery = String(document.getElementById('project-records-search-input')?.value || '').trim();
  const q = rawQuery.toLowerCase();

  const list = getProjectWorkspaceProjects()
    .filter(project => {
      if (!isStaffUser()) return true;
      return !projectIsApprovalOnlyStatus(project.status);
    })
    .filter(project => {
      if (!q) return true;
      return [
        project.project_docno || '',
        project.project_name || '',
        project.company_name || project.registry_company_name || '',
        project.company_no || project.registry_company_no || '',
        project.service_type || '',
        project.assigned_to_name || project.assigned_to_username || '',
        project.project_manager || '',
        project.status || '',
        getProjectStaffOwnershipMeta(project).label,
        project.project_location || '',
        project.description || '',
        project.pono || '',
        project.checkno || ''
      ].join(' ').toLowerCase().includes(q);
    })
    .sort((a, b) => String(b.project_docno || '').localeCompare(String(a.project_docno || '')));

  if (!list.length) {
    if (isStaffUser()) {
      const requestCount = getProjectWorkspaceProjects({ includeArchived: true })
        .filter(project => projectIsApprovalOnlyStatus(project.status))
        .length;
      if (requestCount) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="10">No approved project records yet. You have ${requestCount} assigned request${requestCount === 1 ? '' : 's'} in the Requests tab. <button class="btn btn-sm btn-edit" type="button" onclick="switchProjectWorkspaceTab('requests')">Open Requests</button></td></tr>`;
        return;
      }
    }
    tbody.innerHTML = `<tr class="empty-row"><td colspan="10">No project records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((project) => {
    const projectDocNo = String(project.project_docno || project.source_docno || '-').trim() || '-';
    const projectTitle = String(project.project_name || 'Untitled Project').trim() || 'Untitled Project';
    const companyName = String(getProjectCompanyName(project) || '-').trim() || '-';
    const plannedStart = formatDateYmd(project.planned_start_date || project.start_date || '') || '-';
    const plannedEnd = formatDateYmd(project.planned_end_date || project.end_date || '') || '-';
    const serviceTypeText = String(project.service_type || '').trim() ? String(project.service_type).replace(/^\w/, (c) => c.toUpperCase()) : '-';
    const assignedStaffText = String(project.assigned_to_name || project.assigned_to_username || project.project_manager || '-').trim() || '-';
    const projectStatusLabel = String(project.status || getProjectLifecycleLabel(project) || 'planning').replace(/_/g, ' ');
    const projectStatusClass = `status-${String(project.status || getProjectLifecycleLabel(project) || 'planning').replace(/_/g, '-')}`;
    const contractAmountText = formatPhpCurrency(project.budget || 0);
    const isArchived = Number(project.is_archived || 0) === 1;
    const isDraft = isProjectDraft(project);
    const isSubmitted = isProjectSubmitted(project);
    const isPendingApproval = isProjectPendingApproval(project);

    return `
      <tr>
        <td style="padding: 15px 20px; font-size: 0.85rem;">${highlight(projectDocNo, rawQuery)}</td>
        <td style="padding: 15px 20px; font-size: 0.92rem;"><strong>${highlight(projectTitle, rawQuery)}</strong>${renderProjectStaffOwnershipBadge(project)}</td>
        <td style="padding: 15px 20px; font-size: 0.85rem;">${highlight(companyName, rawQuery)}</td>
        <td class="text-center" style="padding: 15px 20px; font-size: 0.85rem;">${highlight(serviceTypeText, rawQuery)}</td>
        <td style="padding: 15px 20px; font-size: 0.85rem;">${highlight(assignedStaffText, rawQuery)}</td>
        <td class="text-center" style="padding: 15px 20px; font-size: 0.85rem;">${highlight(plannedStart, rawQuery)}</td>
        <td class="text-center" style="padding: 15px 20px; font-size: 0.85rem;">${highlight(plannedEnd, rawQuery)}</td>
        <td class="text-right" style="padding: 15px 20px; font-size: 0.85rem;">${highlight(contractAmountText, rawQuery)}</td>
        <td class="text-center" style="padding: 15px 20px;"><span class="status-pill ${projectStatusClass}">${highlight(projectStatusLabel, rawQuery)}</span></td>
        <td class="text-center" style="padding: 15px 20px;">
          <div class="project-master-actions">
            <button class="btn btn-sm btn-edit" type="button" onclick="openProjectModal(${Number(project.id)})">Edit</button>
            <button class="btn btn-sm btn-pdf" type="button" onclick="openProjectLedger(${Number(project.id)})">Overview</button>
            ${isStaffUser() ? `<button class="btn btn-sm btn-pdf" type="button" onclick="openStaffProjectTimeline(${Number(project.id)})">Timeline</button>` : ''}
            ${isDraft
              ? `<button class="btn btn-sm btn-add" type="button" onclick="submitProject(${Number(project.id)})">Submit</button>`
              : ''}
            ${isSubmitted && isAdminUser()
              ? `<button class="btn btn-sm btn-add" type="button" onclick="approveProject(${Number(project.id)})">Approve</button>`
              : ''}
            ${isPendingApproval
              ? `<span class="status-pill status-${isSubmitted ? 'submitted' : 'draft'}" title="${isSubmitted ? 'Waiting for admin approval' : 'Draft project, submit when ready'}">${isSubmitted ? 'For Approval' : 'Draft'}</span>`
              : `<button class="btn btn-sm btn-add" type="button" onclick="openProjectRequisition(${Number(project.id)})">Add PR</button><button class="btn btn-sm btn-add" type="button" onclick="openProjectSalesInquiry(${Number(project.id)})">Add SI</button>`}
            ${isAdminUser()
              ? (isArchived
                ? `<button class="btn btn-sm btn-restore" type="button" onclick="toggleProjectArchive(${Number(project.id)}, false)" title="Restore Project">Restore</button>`
                : `<button class="btn btn-sm btn-archive" type="button" onclick="toggleProjectArchive(${Number(project.id)}, true)" title="Archive Project">Archive</button>`)
              : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function normalizeProjectWorkspaceTab(tab) {
  const safeTab = String(tab || '').trim().toLowerCase();
  if (isStaffUser()) return ['projects', 'needs-revision', 'requests'].includes(safeTab) ? safeTab : 'projects';
  return ['projects', 'ongoing', 'ledger', 'documents'].includes(safeTab)
    ? safeTab
    : 'projects';
}

function getProjectWorkspaceQuery() {
  return String(document.getElementById('project-records-search-input')?.value || '').trim().toLowerCase();
}

function getProjectWorkspaceProjects({ includeArchived = false } = {}) {
  return (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
    .filter((project) => includeArchived || Number(project.is_archived || 0) === 0)
    .filter((project) => businessEntityMatches(project))
    .filter((project) => !projectHiddenFromAdmin(project))
    .filter((project) => !isStaffUser() || projectVisibleToCurrentStaff(project))
    .filter((project) => {
      if (!isStaffUser()) return companyMatchesDashboardFilter(getProjectCompanyName(project));
      const status = String(project.status || '').trim().toLowerCase();
      return projectIsApprovalOnlyStatus(status) || companyMatchesDashboardFilter(getProjectCompanyName(project));
    });
}

function projectWorkspaceMatchesSearch(values, query = getProjectWorkspaceQuery()) {
  if (!query) return true;
  return values.map((value) => String(value || '')).join(' ').toLowerCase().includes(query);
}

function renderProjectWorkspaceTable(title, headers, rows, emptyText) {
  const headerHtml = headers.map((header) => `<th${header.className ? ` class="${header.className}"` : ''}>${escHtml(header.label)}</th>`).join('');
  const bodyHtml = rows.length
    ? rows.join('')
    : `<tr class="empty-row"><td colspan="${headers.length}">${escHtml(emptyText)}</td></tr>`;

  // data-ready="1": these workspace tables are injected fully-rendered, so opt them out
  // of the #project-records-section anti-flicker gate (which hides .project-records-wrap
  // until ready). Without it the Ongoing/Overview tables stay visibility:hidden.
  return `
    <div class="section-divider">${escHtml(title)}</div>
    <div class="table-wrap project-records-wrap" data-ready="1">
      <table class="project-records-table">
        <thead><tr>${headerHtml}</tr></thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>
  `;
}

function setProjectWorkspaceSummaryCard(index, label, value, mini) {
  const n = index + 1;
  const labelNode = document.getElementById(`project-workspace-summary-label-${n}`);
  const valueNode = document.getElementById(`project-workspace-summary-value-${n}`);
  const miniNode = document.getElementById(`project-workspace-summary-mini-${n}`);
  if (labelNode) labelNode.textContent = label;
  if (valueNode) valueNode.textContent = value;
  if (miniNode) miniNode.textContent = mini;
}

function getProjectWorkspaceMetrics() {
  const projects = getProjectWorkspaceProjects();
  const ongoing = projects.filter((project) => getProjectPhase(project) === 'ongoing');
  const upcoming = projects.filter((project) => getProjectPhase(project) === 'upcoming');
  const receivables = (Array.isArray(allReceivablesDb) ? allReceivablesDb : [])
    .filter((row) => businessEntityMatches(row))
    .filter((row) => companyMatchesDashboardFilter(row.company_name || row.customer_name || ''));
  const documents = projects.filter((project) => String(project.pdfFilename || '').trim());
  const arTotal = receivables.reduce((sum, row) => sum + Number(row.total_amount || row.amount || 0), 0);
  const collected = receivables.reduce((sum, row) => sum + Number(row.paid_amount || 0), 0);

  return {
    projects,
    ongoing,
    upcoming,
    receivables,
    documents,
    arTotal,
    collected
  };
}

function updateProjectWorkspaceSummary() {
  const metrics = getProjectWorkspaceMetrics();
  const activeTab = normalizeProjectWorkspaceTab(currentProjectWorkspaceTab);

  if (isStaffUser()) {
    const requestProjects = getProjectWorkspaceProjects({ includeArchived: true })
      .filter((project) => projectIsApprovalOnlyStatus(project.status));
    const requestCount = requestProjects.length;
    const revisionCount = requestProjects.filter(projectNeedsStaffRevision).length;
    const companyCount = new Set(metrics.projects.map((project) => getProjectCompanyName(project)).filter(Boolean)).size;
    setProjectWorkspaceSummaryCard(0, 'Requests', String(requestCount), 'Drafts and for approval');
    setProjectWorkspaceSummaryCard(1, 'Needs Revision', String(revisionCount), 'Returned by admin');
    setProjectWorkspaceSummaryCard(2, 'Upcoming', String(metrics.upcoming.length), 'Scheduled projects');
    setProjectWorkspaceSummaryCard(3, 'Companies', String(companyCount), 'With approved projects');
    return;
  }

  if (activeTab === 'ongoing') {
    setProjectWorkspaceSummaryCard(0, 'Ongoing', String(metrics.ongoing.length), 'Currently in progress');
    setProjectWorkspaceSummaryCard(1, 'Upcoming', String(metrics.upcoming.length), 'Scheduled next');
    setProjectWorkspaceSummaryCard(2, 'All Active', String(metrics.ongoing.length + metrics.upcoming.length), 'Ongoing + upcoming');
    setProjectWorkspaceSummaryCard(3, 'Contract', formatPhpCurrency(metrics.ongoing.reduce((sum, row) => sum + Number(row.budget || 0), 0)), 'Ongoing contract amount');
    return;
  }

  if (activeTab === 'ledger') {
    setProjectWorkspaceSummaryCard(0, getDashboardProjectLabel(), String(metrics.projects.length), 'Ledger-ready project records');
    setProjectWorkspaceSummaryCard(1, 'Receivables', String(metrics.receivables.length), 'AR-linked records');
    setProjectWorkspaceSummaryCard(2, 'AR Total', formatPhpCurrency(metrics.arTotal), 'Total receivable amount');
    setProjectWorkspaceSummaryCard(3, 'Net AR', formatPhpCurrency(metrics.arTotal - metrics.collected), 'Open receivable balance');
    return;
  }

  if (activeTab === 'documents') {
    setProjectWorkspaceSummaryCard(0, 'Documents', String(metrics.documents.length), 'Projects with PDF');
    setProjectWorkspaceSummaryCard(1, getDashboardProjectLabel(), String(metrics.projects.length), 'Active project records');
    setProjectWorkspaceSummaryCard(2, 'Missing PDF', String(Math.max(0, metrics.projects.length - metrics.documents.length)), 'No document attached');
    setProjectWorkspaceSummaryCard(3, 'Companies', String(new Set(metrics.projects.map((project) => getProjectCompanyName(project)).filter(Boolean)).size), 'With project records');
    return;
  }

  setProjectWorkspaceSummaryCard(0, getDashboardTotalProjectLabel(), String(metrics.projects.length), `${getCurrentDashboardCompanyLabel()} active records`);
  setProjectWorkspaceSummaryCard(1, 'Ongoing', String(metrics.ongoing.length), 'Currently active');
  setProjectWorkspaceSummaryCard(2, 'Receivables', String(metrics.receivables.length), 'AR-linked records');
  setProjectWorkspaceSummaryCard(3, 'Documents', String(metrics.documents.length), 'Attached files');
}

function syncProjectWorkspaceTabs() {
  const activeTab = normalizeProjectWorkspaceTab(currentProjectWorkspaceTab);
  const revisionCount = isStaffUser()
    ? getProjectWorkspaceProjects({ includeArchived: true }).filter(projectNeedsStaffRevision).length
    : 0;
  document.querySelectorAll('[data-project-workspace-tab]').forEach((node) => {
    const isActive = node.getAttribute('data-project-workspace-tab') === activeTab;
    node.classList.toggle('active', isActive);
    node.setAttribute('aria-selected', String(isActive));
    if (node.getAttribute('data-project-workspace-tab') === 'needs-revision') {
      node.classList.toggle('has-project-tab-count', revisionCount > 0);
      node.setAttribute('data-count', revisionCount > 0 ? String(revisionCount) : '');
    }
  });
}

function renderProjectWorkspaceOngoing() {
  const query = getProjectWorkspaceQuery();
  const rows = getProjectWorkspaceProjects()
    .map((project) => ({ ...project, phase: getProjectPhase(project) }))
    .filter((project) => project.phase === 'ongoing' || project.phase === 'upcoming')
    .filter((project) => projectWorkspaceMatchesSearch([
      project.project_docno,
      project.project_name,
      getProjectCompanyName(project),
      project.project_manager,
      project.members,
      project.status,
      project.phase
    ], query))
    .sort((a, b) => String(formatDateYmd(getProjectEffectiveStartDate(a))).localeCompare(String(formatDateYmd(getProjectEffectiveStartDate(b)))))
    .map((project) => `
      <tr>
        <td><strong>${highlight(project.project_name || 'Untitled Project', query)}</strong></td>
        <td>${highlight(getProjectCompanyName(project) || '-', query)}</td>
        <td class="text-center">${highlight(project.project_manager || '-', query)}</td>
        <td class="text-center">${escHtml(formatDateYmd(getProjectEffectiveStartDate(project)) || '-')}</td>
        <td class="text-center">${escHtml(formatDateYmd(getProjectEffectiveEndDate(project)) || '-')}</td>
        <td class="text-center"><span class="status-pill ${project.phase === 'upcoming' ? 'status-upcoming' : 'status-ongoing'}">${escHtml(project.phase)}</span></td>
        <td class="text-center"><button class="btn btn-sm btn-pdf" type="button" onclick="openProjectLedger(${Number(project.id || 0)})">Overview</button></td>
      </tr>
    `);

  return renderProjectWorkspaceTable(
    'Ongoing & Upcoming Projects',
    [
      { label: 'Project' },
      { label: 'Company' },
      { label: 'Manager', className: 'text-center' },
      { label: 'Start', className: 'text-center' },
      { label: 'End', className: 'text-center' },
      { label: 'Phase', className: 'text-center' },
      { label: 'Actions', className: 'text-center' }
    ],
    rows,
    'No ongoing or upcoming projects found.'
  );
}

function renderProjectWorkspaceLedger() {
  const query = getProjectWorkspaceQuery();
  const transactionsByProject = new Map();
  getDashboardInvoiceRows().forEach((row) => {
    const projectId = Number(row.project_id || 0);
    if (!projectId) return;
    const current = transactionsByProject.get(projectId) || { count: 0, amount: 0 };
    current.count += 1;
    current.amount += Number(row.amount || row.total_amount || 0);
    transactionsByProject.set(projectId, current);
  });

  const serviceOrdersByProject = new Map();
  (Array.isArray(serviceOrdersDb) ? serviceOrdersDb : []).forEach((row) => {
    const projectId = Number(row.project_id || 0);
    if (!projectId) return;
    serviceOrdersByProject.set(projectId, (serviceOrdersByProject.get(projectId) || 0) + 1);
  });

  const rows = getProjectWorkspaceProjects()
    .filter((project) => projectWorkspaceMatchesSearch([project.project_docno, project.project_name, getProjectCompanyName(project), project.status], query))
    .map((project) => {
      const tx = transactionsByProject.get(Number(project.id || 0)) || { count: 0, amount: 0 };
      const soCount = serviceOrdersByProject.get(Number(project.id || 0)) || 0;
      return `
        <tr>
          <td>${highlight(project.project_docno || '-', query)}</td>
          <td><strong>${highlight(project.project_name || 'Untitled Project', query)}</strong></td>
          <td>${highlight(getProjectCompanyName(project) || '-', query)}</td>
          <td class="text-right">${tx.count}</td>
          <td class="text-right">${soCount}</td>
          <td class="text-right">${formatPhpCurrency(tx.amount)}</td>
          <td class="text-center"><button class="btn btn-sm btn-pdf" type="button" onclick="openProjectLedger(${Number(project.id || 0)})">Overview</button></td>
        </tr>
      `;
    });

  return renderProjectWorkspaceTable(
    'Project Overview Summary',
    [
      { label: 'Project No.' },
      { label: 'Project' },
      { label: 'Company' },
      { label: 'Transactions', className: 'text-right' },
      { label: 'Service Orders', className: 'text-right' },
      { label: 'AR Amount', className: 'text-right' },
      { label: 'Actions', className: 'text-center' }
    ],
    rows,
    'No project overview records found.'
  );
}

function renderProjectWorkspaceDocuments() {
  const query = getProjectWorkspaceQuery();
  const rows = getProjectWorkspaceProjects()
    .filter((project) => String(project.pdfFilename || '').trim())
    .filter((project) => projectWorkspaceMatchesSearch([project.project_docno, project.project_name, getProjectCompanyName(project), project.pdfFilename], query))
    .map((project) => `
      <tr>
        <td>${highlight(project.project_docno || '-', query)}</td>
        <td><strong>${highlight(project.project_name || 'Untitled Project', query)}</strong></td>
        <td>${highlight(getProjectCompanyName(project) || '-', query)}</td>
        <td>${highlight(project.pdfFilename || '-', query)}</td>
        <td class="text-center"><button class="btn btn-sm btn-pdf" type="button" onclick="openProjectPdfViewer(${Number(project.id || 0)})">View PDF</button></td>
      </tr>
    `);

  return renderProjectWorkspaceTable(
    'Project Documents',
    [
      { label: 'Project No.' },
      { label: 'Project' },
      { label: 'Company' },
      { label: 'File' },
      { label: 'Actions', className: 'text-center' }
    ],
    rows,
    'No project documents attached yet.'
  );
}

function projectNeedsStaffRevision(project) {
  const status = String(project?.status || '').trim().toLowerCase();
  return status === 'needs_revision' || status === 'rejected' || Boolean(String(project?.status_reason || '').trim());
}

function getProjectRequestStatusMeta(project) {
  const status = String(project?.status || 'draft').toLowerCase();
  const needsRevision = projectNeedsStaffRevision(project);
  if (needsRevision) return { status, needsRevision, label: 'Needs Revision', className: 'status-rejected' };
  if (!projectIsApprovalOnlyStatus(status)) return { status, needsRevision, label: 'Approved', className: 'status-active' };
  if (['submitted', 'pending', 'for_approval', 'for approval'].includes(status)) {
    return { status, needsRevision, label: 'Submitted', className: 'status-submitted' };
  }
  return { status, needsRevision, label: 'Draft', className: 'status-draft' };
}

function renderProjectWorkspaceRequests(mode = 'all') {
  const query = getProjectWorkspaceQuery();
  const rows = getProjectWorkspaceProjects({ includeArchived: true })
    .filter((project) => projectIsApprovalOnlyStatus(project.status))
    .filter((project) => mode === 'needs-revision' ? projectNeedsStaffRevision(project) : true)
    .filter((project) => projectWorkspaceMatchesSearch([
      project.draft_docno,
      project.project_docno,
      project.project_name,
      getProjectCompanyName(project),
      project.project_manager,
      project.status,
      getProjectStaffOwnershipMeta(project).label,
      project.status_reason
    ], query))
    .sort((a, b) => {
      const rank = { needs_revision: 0, rejected: 0, submitted: 1, draft: 2 };
      const statusA = String(a.status || 'draft').toLowerCase();
      const statusB = String(b.status || 'draft').toLowerCase();
      return (rank[statusA] ?? 9) - (rank[statusB] ?? 9);
    })
    .map((project) => {
      const statusMeta = getProjectRequestStatusMeta(project);
      const status = statusMeta.status;
      const needsRevision = statusMeta.needsRevision;
      const canEdit = status === 'draft' || status === 'needs_revision' || status === 'rejected';
      const docNo = project.draft_docno || project.project_docno || '-';
      return `
        <tr>
          <td>${highlight(docNo, query)}</td>
          <td><strong>${highlight(project.project_name || 'Untitled Project', query)}</strong>${renderProjectStaffOwnershipBadge(project)}</td>
          <td>${highlight(getProjectCompanyName(project) || '-', query)}</td>
          <td>${highlight(project.project_manager || '-', query)}</td>
          <td class="text-center"><span class="status-pill ${statusMeta.className}">${escHtml(statusMeta.label)}</span></td>
          <td>${escHtml(project.status_reason || (status === 'submitted' ? 'Waiting for admin approval' : '-'))}</td>
          <td class="text-center">
            <div class="project-master-actions">
              <button class="btn btn-pdf btn-sm" type="button" onclick="openStaffProjectTimeline(${Number(project.id || 0)})">Timeline</button>
              ${canEdit ? `<button class="btn btn-edit btn-sm" type="button" onclick="openProjectModal(${Number(project.id || 0)})">Edit</button>` : ''}
              ${canEdit ? `<button class="btn btn-add btn-sm" type="button" onclick="submitProject(${Number(project.id || 0)})">${needsRevision ? 'Resubmit' : 'Submit'}</button>` : '<span class="status-pill status-submitted">Waiting for Admin</span>'}
            </div>
          </td>
        </tr>
      `;
    });

  return renderProjectWorkspaceTable(
    mode === 'needs-revision' ? 'Needs Revision' : 'Project Requests',
    [
      { label: 'Request No.' },
      { label: 'Project Title' },
      { label: 'Company' },
      { label: 'Manager' },
      { label: 'Status', className: 'text-center' },
      { label: 'Note' },
      { label: 'Actions', className: 'text-center' }
    ],
    rows,
    mode === 'needs-revision' ? 'No project requests need revision.' : 'No draft or submitted project requests found.'
  );
}

function getStaffProjectTimelineSteps(project) {
  const status = String(project?.status || 'draft').trim().toLowerCase();
  const isSubmitted = ['submitted', 'pending', 'for_approval', 'for approval'].includes(status);
  const isApproved = !projectIsApprovalOnlyStatus(status);
  const needsRevision = projectNeedsStaffRevision(project);
  const adminNote = String(project?.approval_comment || project?.status_reason || '').trim();
  const reviewer = String(project?.approved_by || '').trim() || 'Admin';
  const createdAt = formatDateYmd(project?.created_at || project?.createdAt || '') || '-';
  const submittedAt = formatDateYmd(project?.submitted_at || project?.updated_at || project?.created_at || '') || '-';
  const decidedAt = formatDateYmd(project?.approved_at || project?.updated_at || '') || '-';

  return [
    {
      label: 'Draft',
      state: 'done',
      meta: createdAt === '-' ? 'Saved as draft/request.' : `Saved ${createdAt}.`
    },
    {
      label: 'Submitted',
      state: (isSubmitted || isApproved || needsRevision) ? 'done' : 'pending',
      meta: (isSubmitted || isApproved || needsRevision)
        ? (submittedAt === '-' ? 'Sent to admin approval.' : `Sent to admin approval ${submittedAt}.`)
        : 'Not submitted yet.'
    },
    {
      label: needsRevision ? 'Needs Revision' : (isApproved ? 'Approved' : 'Admin Review'),
      state: needsRevision ? 'warning' : (isApproved ? 'done' : 'pending'),
      meta: needsRevision
        ? (adminNote || 'Admin returned this project for revision.')
        : (isApproved ? `Reviewed by ${reviewer}${decidedAt === '-' ? '' : ` on ${decidedAt}`}.` : 'Waiting for admin decision.')
    }
  ];
}

function ensureStaffProjectTimelineModal() {
  let backdrop = document.getElementById('staff-project-timeline-backdrop');
  if (backdrop) return backdrop;
  backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop staff-project-timeline-backdrop';
  backdrop.id = 'staff-project-timeline-backdrop';
  backdrop.innerHTML = `
    <div class="modal staff-project-timeline-modal" role="dialog" aria-modal="true" aria-labelledby="staff-project-timeline-title">
      <button class="modal-close" type="button" onclick="closeStaffProjectTimeline()" aria-label="Close timeline">&times;</button>
      <div class="approval-modal-kicker">Project Request Flow</div>
      <div class="modal-title" id="staff-project-timeline-title">Project Timeline</div>
      <div class="staff-project-timeline-record" id="staff-project-timeline-record"></div>
      <div class="staff-project-timeline-steps" id="staff-project-timeline-steps"></div>
      <div class="staff-project-timeline-note" id="staff-project-timeline-note"></div>
      <div class="modal-actions">
        <button class="btn btn-cancel btn-sm" type="button" onclick="closeStaffProjectTimeline()">Close</button>
      </div>
    </div>
  `;
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeStaffProjectTimeline();
  });
  document.body.appendChild(backdrop);
  return backdrop;
}

function openStaffProjectTimeline(projectId) {
  const project = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
    .find(row => Number(row.id || 0) === Number(projectId || 0));
  if (!project) {
    showToast('Project timeline not found.', 'error');
    return;
  }
  const backdrop = ensureStaffProjectTimelineModal();
  const record = document.getElementById('staff-project-timeline-record');
  const steps = document.getElementById('staff-project-timeline-steps');
  const note = document.getElementById('staff-project-timeline-note');
  const docNo = project.draft_docno || project.project_docno || '-';
  const statusMeta = getProjectRequestStatusMeta(project);

  if (record) {
    record.innerHTML = `
      <strong>${escHtml(project.project_name || 'Untitled Project')}</strong>
      <span>${escHtml(docNo)} &bull; ${escHtml(getProjectCompanyName(project) || '-')}</span>
      ${renderProjectStaffOwnershipBadge(project)}
    `;
  }
  if (steps) {
    steps.innerHTML = getStaffProjectTimelineSteps(project).map((step) => `
      <div class="staff-project-timeline-step" data-state="${escHtml(step.state)}">
        <span class="staff-project-timeline-dot" aria-hidden="true"></span>
        <div>
          <strong>${escHtml(step.label)}</strong>
          <p>${escHtml(step.meta)}</p>
        </div>
      </div>
    `).join('');
  }
  if (note) {
    const adminNote = String(project.approval_comment || project.status_reason || '').trim();
    note.innerHTML = `
      <span class="status-pill ${statusMeta.className}">${escHtml(statusMeta.label)}</span>
      <p>${escHtml(adminNote || (statusMeta.status === 'submitted' ? 'Waiting for admin approval.' : 'No admin note yet.'))}</p>
    `;
  }
  backdrop.classList.add('open');
}

function closeStaffProjectTimeline() {
  document.getElementById('staff-project-timeline-backdrop')?.classList.remove('open');
}

function renderProjectWorkspace() {
  const recordsWrap = document.querySelector('#project-records-section .project-records-wrap');
  const altContent = document.getElementById('project-workspace-alt-content');
  const activeTab = normalizeProjectWorkspaceTab(currentProjectWorkspaceTab);
  currentProjectWorkspaceTab = activeTab;

  syncProjectWorkspaceTabs();
  updateProjectWorkspaceSummary();

  if (activeTab === 'projects') {
    if (recordsWrap) recordsWrap.classList.remove('is-hidden');
    if (altContent) {
      altContent.classList.add('is-hidden');
      altContent.innerHTML = '';
    }
    renderProjectRecordsTable();
    return;
  }

  if (recordsWrap) recordsWrap.classList.add('is-hidden');
  if (!altContent) return;

  altContent.classList.remove('is-hidden');
  if (activeTab === 'ongoing') {
    altContent.innerHTML = renderProjectWorkspaceOngoing();
  } else if (activeTab === 'needs-revision') {
    altContent.innerHTML = renderProjectWorkspaceRequests('needs-revision');
  } else if (activeTab === 'requests') {
    altContent.innerHTML = renderProjectWorkspaceRequests();
  } else if (activeTab === 'ledger') {
    altContent.innerHTML = renderProjectWorkspaceLedger();
  } else if (activeTab === 'documents') {
    altContent.innerHTML = renderProjectWorkspaceDocuments();
  }
}

function switchProjectWorkspaceTab(tab) {
  currentProjectWorkspaceTab = normalizeProjectWorkspaceTab(tab);
  localStorage.setItem('kinaadman_projectWorkspaceTab', currentProjectWorkspaceTab);
  if (currentDashboardPanel === 'project-records') {
    syncAdminViewUrl('project-records', activeTab);
  }
  renderProjectWorkspace();
}

function handleProjectWorkspaceSummaryClick(index) {
  if (isStaffUser()) {
    switchProjectWorkspaceTab(index === 0 ? 'requests' : (index === 1 ? 'needs-revision' : 'projects'));
    return;
  }
  const tabMap = {
    projects: ['projects', 'ongoing', 'ledger', 'documents'],
    ongoing: ['ongoing', 'ongoing', 'ongoing', 'ongoing'],
    ledger: ['ledger', 'ongoing', 'documents', 'ledger'],
    documents: ['documents', 'projects', 'documents', 'projects']
  };
  const activeTab = normalizeProjectWorkspaceTab(currentProjectWorkspaceTab);
  switchProjectWorkspaceTab((tabMap[activeTab] || tabMap.projects)[index] || activeTab);
}

function getProjectLedgerRowStatus(row, fallback = '') {
  return String(row?.status || fallback || '-').replace(/_/g, ' ');
}

function renderProjectLedgerTable(title, headers, rows, emptyText) {
  const headerHtml = headers.map((header) => `<th${header.className ? ` class="${header.className}"` : ''}>${escHtml(header.label)}</th>`).join('');
  const bodyHtml = rows.length
    ? rows.join('')
    : `<tr class="empty-row"><td colspan="${headers.length}">${escHtml(emptyText)}</td></tr>`;

  return `
    <div class="section-divider">${escHtml(title)}</div>
    <div class="table-wrap project-ledger-table-wrap">
      <table class="registry-table">
        <thead><tr>${headerHtml}</tr></thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>
  `;
}

function setProjectLedgerMetric(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

async function fetchProjectLedgerData() {
  const [receivablesRes, billsRes, requisitionsRes, quotationsRes, purchaseOrdersRes, goodsReceiptsRes, apPaymentsRes, arPaymentsRes, inventoryMovementsRes, salesRecordsRes] = await Promise.all([
    fetch('/api/receivables?include_archived=1', { cache: 'no-store' }),
    fetch('/api/bills', { cache: 'no-store' }),
    fetch('/api/procurement/requisitions', { cache: 'no-store' }),
    fetch('/api/procurement/quotations', { cache: 'no-store' }),
    fetch('/api/procurement/purchase-orders', { cache: 'no-store' }),
    fetch('/api/procurement/goods-receipts', { cache: 'no-store' }),
    fetch('/api/payments?type=ap', { cache: 'no-store' }),
    fetch('/api/payments?type=ar', { cache: 'no-store' }),
    fetch('/api/inventory/movements?include_all=1', { cache: 'no-store' }),
    fetch('/api/sales-management/records', { cache: 'no-store' })
  ]);

  const responses = [receivablesRes, billsRes, requisitionsRes, quotationsRes, purchaseOrdersRes, goodsReceiptsRes, apPaymentsRes, arPaymentsRes, inventoryMovementsRes, salesRecordsRes];
  // Treat a 404 (a retired/optional data source) as "no data" instead of a hard failure, so
  // one missing endpoint never blocks the whole Project Ledger. Only genuine server errors abort.
  const failed = responses.find((response) => !response.ok && response.status !== 404);
  if (failed) throw new Error(`Unable to load project ledger data (${failed.status}).`);

  const [receivables, bills, requisitions, quotations, purchaseOrders, goodsReceipts, apPayments, arPayments, inventoryMovements, salesRecords] = await Promise.all(
    responses.map((response) => response.json().catch(() => []))
  );

  return {
    // Transactions + Service Orders are retired; kept as empty arrays so the Project
    // Overview snapshot builders never crash while the leftover refs are removed. See [[transactions-legacy]].
    transactions: [],
    serviceOrders: [],
    receivables: Array.isArray(receivables) ? receivables : [],
    bills: Array.isArray(bills) ? bills : [],
    requisitions: Array.isArray(requisitions) ? requisitions : [],
    quotations: Array.isArray(quotations) ? quotations : [],
    purchaseOrders: Array.isArray(purchaseOrders) ? purchaseOrders : [],
    goodsReceipts: Array.isArray(goodsReceipts) ? goodsReceipts : [],
    apPayments: Array.isArray(apPayments) ? apPayments : [],
    arPayments: Array.isArray(arPayments) ? arPayments : [],
    inventoryMovements: Array.isArray(inventoryMovements) ? inventoryMovements : [],
    salesRecords: Array.isArray(salesRecords) ? salesRecords : []
  };
}

// A ledger row is still a "draft" (and must NOT show in the project overview/ledger)
// while it carries a DFT-/DRAFT- document number or a draft/needs-revision status.
// It becomes official only on approval — see [[draft-official-docno-rule]].
function isDraftLedgerRow(row = {}) {
  const docNo = String(
    row.pr_number || row.po_number || row.quote_number || row.grn_number ||
    row.document_no || row.bill_number || row.invoice_number || ''
  ).trim();
  if (/^(DFT|DRAFT)-/i.test(docNo)) return true;
  const status = String(row.status || '').trim().toLowerCase();
  return ['draft', 'needs_revision'].includes(status);
}

function buildProjectLedgerSnapshot(project, data) {
  const id = Number(project?.id || 0);
  const notDraft = (row) => !isDraftLedgerRow(row);
  const receivables = data.receivables.filter((row) => Number(row.project_id || 0) === id && notDraft(row));
  const receivableIds = new Set(receivables.map((row) => Number(row.id || 0)).filter(Boolean));
  const bills = data.bills.filter((row) => Number(row.project_id || 0) === id && notDraft(row));
  const requisitions = data.requisitions.filter((row) => Number(row.project_id || 0) === id && notDraft(row));
  const requisitionIds = new Set(requisitions.map((row) => Number(row.id || 0)).filter(Boolean));
  const quotations = data.quotations.filter((row) => (Number(row.project_id || 0) === id || requisitionIds.has(Number(row.requisition_id || 0))) && notDraft(row));
  const purchaseOrders = data.purchaseOrders.filter((row) => Number(row.project_id || 0) === id && notDraft(row));
  const purchaseOrderIds = new Set(purchaseOrders.map((row) => Number(row.id || 0)).filter(Boolean));
  const goodsReceipts = data.goodsReceipts.filter((row) => purchaseOrderIds.has(Number(row.po_id || 0)));
  const billIds = new Set(bills.map((row) => Number(row.id || 0)).filter(Boolean));
  const apPayments = data.apPayments.filter((row) => billIds.has(Number(row.ap_id || 0)));
  const arPayments = data.arPayments.filter((row) => receivableIds.has(Number(row.ar_id || 0)));
  const inventoryMovements = data.inventoryMovements.filter((row) => Number(row.project_id || 0) === id);
  // Sales pipeline records (SI -> SQ -> SO -> DR) tied to this project; skip cancelled
  // and still-draft rows (only approved/official sales records belong in the ledger).
  const salesRecords = (data.salesRecords || []).filter((row) =>
    Number(row.project_id || 0) === id && String(row.status || '').toLowerCase() !== 'cancelled' && notDraft(row));
  const salesByType = (t) => salesRecords.filter((row) => String(row.record_type || '') === t);
  const pipeline = {
    inquiry: salesByType('sales-request'),
    quotation: salesByType('sales-quotation'),
    order: salesByType('sales-order'),
    delivery: salesByType('project-delivery')
  };

  const arTotal = receivables.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const collectedFromPayments = arPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const collectedFromRows = receivables.reduce((sum, row) => sum + Number(row.paid_amount || 0), 0);
  const collectedTotal = Math.max(collectedFromPayments, collectedFromRows);
  const apTotal = bills.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const apPaidFromPayments = apPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const apPaidFromRows = bills.reduce((sum, row) => sum + Number(row.paid_amount || 0), 0);
  const apPaidTotal = Math.max(apPaidFromPayments, apPaidFromRows);
  const inventoryCostTotal = inventoryMovements
    .filter((row) => ['out', 'adjustment'].includes(String(row.movement_type || '').toLowerCase()))
    .reduce((sum, row) => sum + (Number(row.quantity || 0) * Number(row.unit_cost || 0)), 0);
  const contractAmount = Number(project?.budget || 0) || 0;
  const revenueBase = arTotal || contractAmount;
  const grossProfit = revenueBase - apTotal - inventoryCostTotal;
  const marginPercent = revenueBase > 0 ? Math.round((grossProfit / revenueBase) * 100) : 0;

  return {
    project,
    receivables,
    bills,
    requisitions,
    quotations,
    purchaseOrders,
    goodsReceipts,
    apPayments,
    arPayments,
    inventoryMovements,
    salesRecords,
    pipeline,
    totals: {
      arTotal,
      collectedTotal,
      apTotal,
      apPaidTotal,
      inventoryCostTotal,
      contractAmount,
      grossProfit,
      marginPercent,
      netTotal: arTotal - apTotal - inventoryCostTotal,
      recordCount: receivables.length + bills.length + requisitions.length + quotations.length + purchaseOrders.length + goodsReceipts.length + apPayments.length + arPayments.length + inventoryMovements.length
    }
  };
}

function projectLedgerMatchesSearch(values, query) {
  if (!query) return true;
  return values.map((value) => String(value || '')).join(' ').toLowerCase().includes(query);
}

function normalizeProjectLedgerSubmodule(value) {
  const tab = String(value || '').trim().toLowerCase();
  return ['overview', 'ar', 'ap', 'inventory', 'payments', 'documents'].includes(tab) ? tab : 'overview';
}

function syncProjectLedgerSubmoduleTabs() {
  const activeTab = normalizeProjectLedgerSubmodule(currentProjectLedgerSubmodule);
  document.querySelectorAll('[data-project-ledger-tab]').forEach((node) => {
    const tab = normalizeProjectLedgerSubmodule(node.getAttribute('data-project-ledger-tab'));
    const isActive = tab === activeTab;
    node.classList.toggle('active', isActive);
    node.setAttribute('aria-selected', String(isActive));
  });
}

function switchProjectLedgerSubmodule(tab) {
  currentProjectLedgerSubmodule = normalizeProjectLedgerSubmodule(tab);
  syncProjectLedgerSubmoduleTabs();
  renderProjectLedgerPage();
}

// All documents connected to this project — across Procurement, Sales, AP and AR.
function renderProjectLedgerDocuments(snapshot, query = '') {
  const project = snapshot?.project || {};
  const pipeline = snapshot?.pipeline || { inquiry: [], quotation: [], order: [], delivery: [] };
  const projectNo = String(project.project_docno || project.draft_docno || '-').trim() || '-';
  const rows = [];
  const addDoc = (docNo, type, date, amount, status, action = '') => {
    const n = String(docNo || '').trim();
    if (!n) return;
    rows.push({ docNo: n, type, date: date || '-', amount: Number(amount || 0), status: status || '-', action });
  };

  if (project.pdfFilename) {
    addDoc(projectNo, 'Project · PDF', formatDateYmd(project.created_at || project.start_date || ''), project.budget,
      getProjectLifecycleLabel(project).replace(/_/g, ' '),
      `<button class="btn btn-sm btn-pdf" type="button" onclick="openProjectPdfViewer(${Number(project.id || 0)})">View</button>`);
  }
  // Procurement
  (snapshot.requisitions || []).forEach((r) => addDoc(r.pr_number, 'Procurement · PR', formatDateYmd(r.request_date), r.total_amount, getProjectLedgerRowStatus(r)));
  (snapshot.quotations || []).forEach((r) => addDoc(r.quote_number, 'Procurement · RFQ', formatDateYmd(r.quote_date), r.quoted_total || r.total_amount, getProjectLedgerRowStatus(r)));
  (snapshot.purchaseOrders || []).forEach((r) => addDoc(r.po_number, 'Procurement · PO', formatDateYmd(r.po_date), r.total_amount, getProjectLedgerRowStatus(r)));
  (snapshot.goodsReceipts || []).forEach((r) => addDoc(r.grn_number, 'Procurement · GRN', formatDateYmd(r.received_date), 0, getProjectLedgerRowStatus(r)));
  // Sales Management
  const salesLabel = { 'sales-request': 'Sales Inquiry', 'sales-quotation': 'Quotation', 'sales-order': 'Sales Order', 'project-delivery': 'Delivery Receipt' };
  [...(pipeline.inquiry || []), ...(pipeline.quotation || []), ...(pipeline.order || []), ...(pipeline.delivery || [])]
    .forEach((r) => addDoc(r.document_no, `Sales · ${salesLabel[r.record_type] || 'Document'}`, formatDateYmd(r.requested_date || r.created_at), r.amount, getProjectLedgerRowStatus(r)));
  // AR / AP
  (snapshot.receivables || []).forEach((r) => addDoc(r.invoice_number, 'AR · Invoice', formatDateYmd(r.invoice_date || r.due_date), r.total_amount, getProjectLedgerRowStatus(r)));
  (snapshot.bills || []).forEach((r) => addDoc(r.bill_number, 'AP · Bill', formatDateYmd(r.bill_date || r.due_date), r.total_amount, getProjectLedgerRowStatus(r)));

  const q = String(query || '').trim().toLowerCase();
  const filtered = q ? rows.filter((d) => [d.docNo, d.type, d.status].join(' ').toLowerCase().includes(q)) : rows;

  return renderProjectLedgerTable(
    `All Documents · ${escHtml(projectNo)}`,
    [
      { label: 'Document No.' },
      { label: 'Type' },
      { label: 'Date' },
      { label: 'Amount', className: 'text-right' },
      { label: 'Status' },
      { label: '', className: 'text-center' }
    ],
    filtered.map((d) => `
      <tr>
        <td><strong>${escHtml(d.docNo)}</strong></td>
        <td>${escHtml(d.type)}</td>
        <td>${escHtml(d.date)}</td>
        <td class="text-right">${d.amount ? formatPhpCurrency(d.amount) : '-'}</td>
        <td>${escHtml(d.status)}</td>
        <td class="text-center">${d.action || ''}</td>
      </tr>
    `),
    'No linked documents yet.'
  );
}

function renderProjectOverviewDetail(label, value) {
  return `
    <div class="project-overview-detail">
      <span>${escHtml(label)}</span>
      <strong>${escHtml(String(value || '-').trim() || '-')}</strong>
    </div>
  `;
}

function renderProjectOverviewMetric(label, value, note = '', tone = '') {
  return `
    <div class="project-overview-metric${tone ? ` is-${escHtml(tone)}` : ''}">
      <span>${escHtml(label)}</span>
      <strong>${escHtml(String(value || '-').trim() || '-')}</strong>
      ${note ? `<em>${escHtml(note)}</em>` : ''}
    </div>
  `;
}

function renderProjectOverviewStep(number, label, value, tone = '') {
  return `
    <div class="project-overview-step${tone ? ` is-${escHtml(tone)}` : ''}">
      <span>${escHtml(number)}</span>
      <div>
        <strong>${escHtml(label)}</strong>
        <em>${escHtml(String(value || '-').trim() || '-')}</em>
      </div>
    </div>
  `;
}

function renderProjectRelationshipItem(label, value, note = '', tone = '') {
  return `
    <div class="project-relationship-item${tone ? ` is-${escHtml(tone)}` : ''}">
      <span>${escHtml(label)}</span>
      <strong>${escHtml(String(value || '0'))}</strong>
      ${note ? `<em>${escHtml(note)}</em>` : ''}
    </div>
  `;
}

function renderProjectRelationshipCard(title, subtitle, items = []) {
  return `
    <div class="project-overview-card project-relationship-card">
      <div class="project-overview-section-head">
        <div>
          <div class="project-overview-kicker">${escHtml(title)}</div>
          <h4>${escHtml(subtitle)}</h4>
        </div>
      </div>
      <div class="project-relationship-chain">${items.join('')}</div>
    </div>
  `;
}

function renderProjectOverview(snapshot) {
  const project = snapshot?.project || {};
  const totals = snapshot?.totals || {};
  const arBalance = Math.max(0, Number(totals.arTotal || 0) - Number(totals.collectedTotal || 0));
  const apBalance = Math.max(0, Number(totals.apTotal || 0) - Number(totals.apPaidTotal || 0));
  const startDate = formatDateYmd(project.actual_start_date || project.start_date || project.planned_start_date || '') || '-';
  const endDate = formatDateYmd(project.actual_end_date || project.end_date || project.planned_end_date || '') || '-';
  const status = getProjectLifecycleLabel(project).replace(/_/g, ' ');
  const companyName = getProjectCompanyName(project) || '-';
  const customerPoRef = String(project.pono || project.source_pono || '').trim() || '-';
  const projectDocNo = String(project.project_docno || project.source_docno || '').trim() || '-';
  const description = String(project.description || project.source_transaction_description || '').trim() || 'No description set.';
  const contractAmount = Number(project.budget || 0) || 0;
  const projectDownpayment = Number(project.downpayment || 0) || 0;
  const projectBalance = Math.max(0, contractAmount - projectDownpayment);
  const receivableCount = (snapshot.receivables || []).length;
  const requisitionCount = (snapshot.requisitions || []).length;
  const quotationCount = (snapshot.quotations || []).length;
  const purchaseOrderCount = (snapshot.purchaseOrders || []).length;
  const goodsReceiptCount = (snapshot.goodsReceipts || []).length;
  const inventoryMovementCount = (snapshot.inventoryMovements || []).length;
  const billCount = (snapshot.bills || []).length;
  const arPaymentCount = (snapshot.arPayments || []).length;
  const apPaymentCount = (snapshot.apPayments || []).length;
  const linkedRecordCount = Number(totals.recordCount || 0);
  const netTotal = Number(totals.netTotal || 0);
  const collectionRate = Number(totals.arTotal || 0) > 0
    ? Math.min(100, Math.round((Number(totals.collectedTotal || 0) / Number(totals.arTotal || 0)) * 100))
    : 0;
  const apPaidRate = Number(totals.apTotal || 0) > 0
    ? Math.min(100, Math.round((Number(totals.apPaidTotal || 0) / Number(totals.apTotal || 0)) * 100))
    : 0;
  const netTone = netTotal >= 0 ? 'positive' : 'negative';
  const grossProfit = Number(totals.grossProfit || 0);
  const marginPercent = Number(totals.marginPercent || 0);

  const pipeline = snapshot.pipeline || { inquiry: [], quotation: [], order: [], delivery: [] };
  const sumAmt = (rows) => (rows || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const inquiryCount = (pipeline.inquiry || []).length;
  const salesQuotationCount = (pipeline.quotation || []).length;
  const salesOrderCount = (pipeline.order || []).length;
  const deliveryCount = (pipeline.delivery || []).length;

  // ── Profitability verdict (from gross profit) ────────────────────────────
  const verdictPositive = grossProfit >= 0;
  const revenueShown = Number(totals.arTotal || 0) || contractAmount || 0;
  const costShown = Number(totals.apTotal || 0) + Number(totals.inventoryCostTotal || 0);
  const verdictBanner = `
    <div class="project-overview-verdict is-${verdictPositive ? 'positive' : 'negative'}">
      <div class="project-overview-verdict-main">
        <span class="project-overview-verdict-tag">${verdictPositive ? 'Profitable' : 'At Risk'}</span>
        <div class="project-overview-verdict-copy">
          <strong>${escHtml(formatPhpCurrency(grossProfit))}</strong>
          <em>${verdictPositive ? 'Project is currently earning' : 'Project cost is exceeding revenue'} &middot; ${escHtml(String(marginPercent))}% margin</em>
        </div>
      </div>
      <div class="project-overview-verdict-side">
        <span>Revenue <strong>${escHtml(formatPhpCurrency(revenueShown))}</strong></span>
        <span>Cost <strong>${escHtml(formatPhpCurrency(costShown))}</strong></span>
      </div>
    </div>
  `;

  const members = getProjectSourceMembers(project);
  const memberHtml = members.length
    ? members.map((member, index) => formatProjectMemberSummary(member, index)).join('')
    : '<div class="project-overview-empty">No project team listed yet.</div>';
  const preSalesCount = inquiryCount + salesQuotationCount;
  const arRelationship = renderProjectRelationshipCard('Project to AR', 'Project &rarr; Sales Management &rarr; AR collection trail', [
    renderProjectRelationshipItem('Project', projectDocNo, 'Source record', 'positive'),
    renderProjectRelationshipItem('Sales Inquiry / Quotation', preSalesCount, 'Pre-sales documents', preSalesCount ? 'positive' : 'muted'),
    renderProjectRelationshipItem('Sales Order', salesOrderCount, salesOrderCount ? formatPhpCurrency(sumAmt(pipeline.order)) : 'Confirmed scope', salesOrderCount ? 'positive' : 'muted'),
    renderProjectRelationshipItem('Delivery Receipt', deliveryCount, deliveryCount ? formatPhpCurrency(sumAmt(pipeline.delivery)) : 'Delivered items', deliveryCount ? 'positive' : 'muted'),
    renderProjectRelationshipItem('Receivables (AR)', receivableCount, formatPhpCurrency(totals.arTotal || 0), receivableCount ? 'positive' : 'muted'),
    renderProjectRelationshipItem('Collections', arPaymentCount, formatPhpCurrency(totals.collectedTotal || 0), arPaymentCount ? 'positive' : 'warning')
  ]);
  const apRelationship = renderProjectRelationshipCard('Project to Procurement/AP', 'Cost and supplier payment trail', [
    renderProjectRelationshipItem('PR', requisitionCount, 'Project need/request', requisitionCount ? 'positive' : 'muted'),
    renderProjectRelationshipItem('Quotations', quotationCount, 'Vendor offers', quotationCount ? 'positive' : 'muted'),
    renderProjectRelationshipItem('PO', purchaseOrderCount, 'Approved buying', purchaseOrderCount ? 'positive' : 'muted'),
    renderProjectRelationshipItem('GRN', goodsReceiptCount, 'Received goods/services', goodsReceiptCount ? 'positive' : 'muted'),
    renderProjectRelationshipItem('Inventory', inventoryMovementCount, formatPhpCurrency(totals.inventoryCostTotal || 0), inventoryMovementCount ? 'warning' : 'muted'),
    renderProjectRelationshipItem('AP Bills', billCount, formatPhpCurrency(totals.apTotal || 0), billCount ? 'positive' : 'muted'),
    renderProjectRelationshipItem('AP Payments', apPaymentCount, formatPhpCurrency(totals.apPaidTotal || 0), apPaymentCount ? 'positive' : 'warning')
  ]);
  // Actual money flow: Sales -> AR (billed/collected) and Procurement -> AP (cost/paid).
  const compactMoneyMetrics = [
    renderProjectOverviewMetric('Contract', formatPhpCurrency(contractAmount), 'Agreed project amount'),
    renderProjectOverviewMetric('AR Billed', formatPhpCurrency(totals.arTotal || 0), `${receivableCount} invoice${receivableCount === 1 ? '' : 's'}`, Number(totals.arTotal || 0) ? 'positive' : 'muted'),
    renderProjectOverviewMetric('Collected', formatPhpCurrency(totals.collectedTotal || 0), `${collectionRate}% of AR`, 'positive'),
    renderProjectOverviewMetric('AP Cost', formatPhpCurrency(totals.apTotal || 0), `${billCount} bill${billCount === 1 ? '' : 's'}`, Number(totals.apTotal || 0) ? 'warning' : 'muted'),
    renderProjectOverviewMetric('Supplier Balance', formatPhpCurrency(apBalance), `${apPaidRate}% paid`, apBalance > 0 ? 'warning' : 'positive'),
    renderProjectOverviewMetric('Net Position', formatPhpCurrency(netTotal), 'AR minus AP', netTone)
  ].join('');
  // ── Information (project form + company registry contact) ─────────────────
  const serviceTypeLabel = String(project.service_type || '').trim()
    ? String(project.service_type).replace(/^\w/, (c) => c.toUpperCase())
    : '-';
  const projectLocation = String(project.project_location || '').trim() || '-';
  const plannedStart = formatDateYmd(project.planned_start_date || '') || '-';
  const plannedEnd = formatDateYmd(project.planned_end_date || '') || '-';
  const actualStartInfo = formatDateYmd(project.actual_start_date || '') || 'Not started';
  const actualEndInfo = formatDateYmd(project.actual_end_date || '') || 'Ongoing';
  const contactPerson = String(project.registry_contact_person || '').trim() || '-';
  const contactEmail = String(project.registry_email || '').trim() || '-';
  const contactPhone = String(project.registry_phone || '').trim() || '-';
  const estMaterial = Number(project.estimated_material_cost || 0) || 0;
  const estLabor = Number(project.estimated_labor_cost || 0) || 0;
  const estOther = Number(project.estimated_other_cost || 0) || 0;
  const estimatedCostTotal = estMaterial + estLabor + estOther;
  const actualCostTotal = Number(totals.apTotal || 0) + Number(totals.inventoryCostTotal || 0);
  const costVariance = estimatedCostTotal - actualCostTotal;
  const costBurnRate = estimatedCostTotal > 0 ? Math.round((actualCostTotal / estimatedCostTotal) * 100) : 0;
  const costBurnWidth = Math.max(0, Math.min(100, costBurnRate));
  const actualProfit = contractAmount - actualCostTotal;
  const actualMarginPct = contractAmount > 0 ? Math.round((actualProfit / contractAmount) * 100) : 0;
  const varianceTone = costVariance >= 0 ? 'positive' : 'negative';
  const burnTone = !estimatedCostTotal ? 'muted' : costBurnRate <= 85 ? 'positive' : (costBurnRate <= 100 ? 'warning' : 'negative');
  const estProfit = contractAmount - (estMaterial + estLabor + estOther);
  const estMarginPct = contractAmount > 0 ? Math.round((estProfit / contractAmount) * 100) : 0;
  const assignedStaffName = String(project.assigned_to_name || project.assigned_to_username || '-').trim() || '-';

  const informationCard = `
    <div class="project-overview-card">
      <div class="project-overview-section-head">
        <div>
          <div class="project-overview-kicker">Information</div>
          <h4>Project details &amp; contacts</h4>
        </div>
      </div>
      <div class="project-overview-metric-grid">
        ${renderProjectOverviewDetail('Project ID', projectDocNo)}
        ${renderProjectOverviewDetail('Service Type', serviceTypeLabel)}
        ${renderProjectOverviewDetail('Assigned Staff', assignedStaffName)}
        ${renderProjectOverviewDetail('Location', projectLocation)}
        ${renderProjectOverviewDetail('Planned', `${plannedStart} → ${plannedEnd}`)}
        ${renderProjectOverviewDetail('Actual', `${actualStartInfo} → ${actualEndInfo}`)}
        ${renderProjectOverviewDetail('Company', companyName)}
        ${renderProjectOverviewDetail('Contact Person', contactPerson)}
        ${renderProjectOverviewDetail('Email', contactEmail)}
        ${renderProjectOverviewDetail('Contact No.', contactPhone)}
      </div>
      <div class="project-overview-kicker" style="margin-top:14px;">Project Members</div>
      <div class="project-overview-members">${memberHtml}</div>
      <p style="margin-top:12px;font-size:0.72rem;color:var(--muted);">${escHtml(description)}</p>
    </div>
  `;

  const budgetAnalyticsCard = `
    <div class="project-overview-card project-budget-analytics-card">
      <div class="project-overview-section-head">
        <div>
          <div class="project-overview-kicker">Budget vs Actual Analytics</div>
          <h4>Estimate compared with posted costs</h4>
        </div>
        <span class="project-overview-health is-${varianceTone}">${costVariance >= 0 ? 'Within budget' : 'Over budget'}</span>
      </div>
      <div class="project-budget-analytics-strip">
        <div>
          <span>Estimated Cost</span>
          <strong>${escHtml(formatPhpCurrency(estimatedCostTotal))}</strong>
          <em>Material, labor, and other estimate</em>
        </div>
        <div>
          <span>Actual Cost</span>
          <strong>${escHtml(formatPhpCurrency(actualCostTotal))}</strong>
          <em>AP bills plus inventory movement cost</em>
        </div>
        <div class="is-${varianceTone}">
          <span>Variance</span>
          <strong>${escHtml(formatPhpCurrency(Math.abs(costVariance)))}</strong>
          <em>${costVariance >= 0 ? 'Remaining estimate cushion' : 'Actual cost exceeded estimate'}</em>
        </div>
      </div>
      <div class="project-budget-progress" data-tone="${burnTone}">
        <div class="project-budget-progress-head">
          <span>Cost burn rate</span>
          <strong>${escHtml(String(costBurnRate))}%</strong>
        </div>
        <div class="project-budget-progress-track" aria-hidden="true">
          <span style="width:${costBurnWidth}%;"></span>
        </div>
        <em>${estimatedCostTotal > 0 ? `${escHtml(formatPhpCurrency(actualCostTotal))} used from ${escHtml(formatPhpCurrency(estimatedCostTotal))} estimate` : 'No estimate entered yet'}</em>
      </div>
      <div class="project-overview-metric-grid">
        ${renderProjectOverviewMetric('Planned Profit', formatPhpCurrency(estProfit), `${estMarginPct}% planned margin`, estProfit >= 0 ? 'positive' : 'negative')}
        ${renderProjectOverviewMetric('Actual Profit', formatPhpCurrency(actualProfit), `${actualMarginPct}% actual margin`, actualProfit >= 0 ? 'positive' : 'negative')}
        ${renderProjectOverviewMetric('Cost Records', linkedRecordCount, `${billCount} AP bill${billCount === 1 ? '' : 's'} | ${inventoryMovementCount} inventory move${inventoryMovementCount === 1 ? '' : 's'}`, linkedRecordCount ? 'positive' : 'muted')}
      </div>
    </div>
  `;

  return `
    <section class="project-overview-shell">
      <div class="project-overview-card project-overview-hero">
        <div class="project-overview-hero-copy">
          <div class="project-overview-kicker">Project Overview</div>
          <h3>${escHtml(project.project_name || 'Untitled Project')}</h3>
          <div class="project-overview-tags">
            <span>${escHtml(projectDocNo)}</span>
            <span>${escHtml(status)}</span>
            <span>${escHtml(companyName)}</span>
            <span>${escHtml(startDate)} to ${escHtml(endDate)}</span>
          </div>
        </div>
      </div>

      ${verdictBanner}

      <div class="project-overview-layout">
        <div class="project-overview-card">
          <div class="project-overview-section-head">
            <div>
              <div class="project-overview-kicker">Money Summary</div>
              <h4>Contract, collections, and supplier exposure</h4>
            </div>
            <span class="project-overview-health is-${escHtml(netTone)}">${escHtml(netTotal >= 0 ? 'Positive position' : 'Negative position')}</span>
          </div>
          <div class="project-overview-metric-grid">${compactMoneyMetrics}</div>
        </div>
      </div>

      ${budgetAnalyticsCard}

      <div class="project-overview-grid project-overview-related-grid">
        ${apRelationship}
        ${arRelationship}
      </div>

      <div class="project-overview-grid project-overview-info-grid">
        ${informationCard}
      </div>
    </section>
  `;
}

function renderProjectLedgerPage() {
  const content = document.getElementById('project-ledger-page-content');
  if (!content) return;

  const snapshot = currentProjectLedgerSnapshot;
  if (!snapshot) {
    content.innerHTML = '<div class="empty-row" style="padding:18px;text-align:center;">Select a project to view its ledger.</div>';
    return;
  }

  const query = String(document.getElementById('project-ledger-page-search')?.value || '').trim().toLowerCase();
  const type = normalizeProjectLedgerSubmodule(currentProjectLedgerSubmodule);
  syncProjectLedgerSubmoduleTabs();
  const showSection = (key) => type === 'overview' || type === key;
  const { receivables, bills, requisitions, quotations, purchaseOrders, goodsReceipts, apPayments, arPayments, inventoryMovements } = snapshot;

  const filteredReceivables = receivables.filter((row) => projectLedgerMatchesSearch([row.invoice_number, row.due_date, row.payment_terms, row.status, row.total_amount], query));
  const filteredBills = bills.filter((row) => projectLedgerMatchesSearch([row.bill_number, row.vendor_name, row.vendor_id, row.due_date, row.status, row.total_amount], query));
  const filteredRequisitions = requisitions.filter((row) => projectLedgerMatchesSearch([row.pr_number, row.company_name, row.request_date, row.needed_by, row.status, row.total_amount, row.item_summary], query));
  const filteredQuotations = quotations.filter((row) => projectLedgerMatchesSearch([row.quote_number, row.pr_number, row.vendor_name, row.quote_date, row.quoted_total, row.status], query));
  const filteredPurchaseOrders = purchaseOrders.filter((row) => projectLedgerMatchesSearch([row.po_number, row.vendor_name, row.company_name, row.po_date, row.status, row.total_amount], query));
  const filteredGoodsReceipts = goodsReceipts.filter((row) => projectLedgerMatchesSearch([row.grn_number, row.po_number, row.vendor_name, row.received_date, row.status], query));
  const filteredPayments = [
    ...arPayments.map((row) => ({ ...row, ledgerType: 'AR' })),
    ...apPayments.map((row) => ({ ...row, ledgerType: 'AP' }))
  ].filter((row) => projectLedgerMatchesSearch([row.ledgerType, row.payment_date, row.reference_number, row.payment_method, row.amount], query));
  const filteredInventoryMovements = inventoryMovements.filter((row) => projectLedgerMatchesSearch([row.movement_date, row.movement_type, row.sku, row.product_name, row.warehouse_name, row.reference_type, row.reference_no], query));

  const sections = [];
  if (type === 'overview') {
    sections.push(renderProjectOverview(snapshot));
  }

  if (showSection('ar')) {
    // Project -> Sales Management -> AR: show the sales trail first, then receivables.
    const salesTypeLabel = { 'sales-request': 'Sales Inquiry', 'sales-quotation': 'Quotation', 'sales-order': 'Sales Order', 'project-delivery': 'Delivery Receipt' };
    const filteredSales = (snapshot.salesRecords || []).filter((row) => projectLedgerMatchesSearch([row.document_no, salesTypeLabel[row.record_type], row.title, row.requested_date, row.status, row.amount], query));
    sections.push(renderProjectLedgerTable(
      'Sales Management',
      [
        { label: 'Document No.' },
        { label: 'Type' },
        { label: 'Title' },
        { label: 'Date' },
        { label: 'Amount', className: 'text-right' },
        { label: 'Status' }
      ],
      filteredSales.map((row) => `
        <tr>
          <td><strong>${escHtml(row.document_no || '-')}</strong></td>
          <td>${escHtml(salesTypeLabel[row.record_type] || '-')}</td>
          <td>${escHtml(row.title || '-')}</td>
          <td>${escHtml(formatDateYmd(row.requested_date || row.created_at) || '-')}</td>
          <td class="text-right">${formatPhpCurrency(row.amount || 0)}</td>
          <td>${escHtml(getProjectLedgerRowStatus(row))}</td>
        </tr>
      `),
      'No linked sales records yet.'
    ));
    sections.push(renderProjectLedgerTable(
      'Accounts Receivable',
      [
        { label: 'Invoice No.' },
        { label: 'Due Date' },
        { label: 'Terms' },
        { label: 'Total', className: 'text-right' },
        { label: 'Paid', className: 'text-right' },
        { label: 'Status' }
      ],
      filteredReceivables.map((row) => `
        <tr>
          <td>${escHtml(row.invoice_number || '-')}</td>
          <td>${escHtml(row.due_date || '-')}</td>
          <td>${escHtml(row.payment_terms || '-')}</td>
          <td class="text-right">${formatPhpCurrency(row.total_amount || 0)}</td>
          <td class="text-right">${formatPhpCurrency(row.paid_amount || 0)}</td>
          <td>${escHtml(getProjectLedgerRowStatus(row))}</td>
        </tr>
      `),
      'No linked receivables yet.'
    ));
  }

  if (showSection('ap')) {
    sections.push(renderProjectLedgerTable(
      'Purchase Requisitions',
      [
        { label: 'PR No.' },
        { label: 'Company' },
        { label: 'Request Date' },
        { label: 'Needed By' },
        { label: 'Total', className: 'text-right' },
        { label: 'Status' }
      ],
      filteredRequisitions.map((row) => `
        <tr>
          <td>${escHtml(row.pr_number || '-')}</td>
          <td>${escHtml(row.company_name || row.company_no || '-')}</td>
          <td>${escHtml(row.request_date || '-')}</td>
          <td>${escHtml(row.needed_by || '-')}</td>
          <td class="text-right">${formatPhpCurrency(row.total_amount || 0)}</td>
          <td>${escHtml(getProjectLedgerRowStatus(row))}</td>
        </tr>
      `),
      'No linked purchase requisitions yet.'
    ));

    sections.push(renderProjectLedgerTable(
      'Quotations',
      [
        { label: 'Quote No.' },
        { label: 'PR No.' },
        { label: 'Vendor' },
        { label: 'Quote Date' },
        { label: 'Total', className: 'text-right' },
        { label: 'Status' }
      ],
      filteredQuotations.map((row) => `
        <tr>
          <td>${escHtml(row.quote_number || '-')}</td>
          <td>${escHtml(row.pr_number || '-')}</td>
          <td>${escHtml(row.vendor_name || row.vendor_id || '-')}</td>
          <td>${escHtml(row.quote_date || '-')}</td>
          <td class="text-right">${formatPhpCurrency(row.quoted_total || 0)}</td>
          <td>${escHtml(getProjectLedgerRowStatus(row))}</td>
        </tr>
      `),
      'No linked quotations yet.'
    ));

    sections.push(renderProjectLedgerTable(
      'Purchase Orders',
      [
        { label: 'PO No.' },
        { label: 'Vendor' },
        { label: 'PO Date' },
        { label: 'Delivery' },
        { label: 'Total', className: 'text-right' },
        { label: 'Status' }
      ],
      filteredPurchaseOrders.map((row) => `
        <tr>
          <td>${escHtml(row.po_number || '-')}</td>
          <td>${escHtml(row.vendor_name || row.vendor_id || '-')}</td>
          <td>${escHtml(row.po_date || '-')}</td>
          <td>${escHtml(row.delivery_date || '-')}</td>
          <td class="text-right">${formatPhpCurrency(row.total_amount || row.computed_total || 0)}</td>
          <td>${escHtml(getProjectLedgerRowStatus(row))}</td>
        </tr>
      `),
      'No linked purchase orders yet.'
    ));

    sections.push(renderProjectLedgerTable(
      'Goods Receipts',
      [
        { label: 'GRN No.' },
        { label: 'PO No.' },
        { label: 'Vendor' },
        { label: 'Received Date' },
        { label: 'Received By' },
        { label: 'Status' }
      ],
      filteredGoodsReceipts.map((row) => `
        <tr>
          <td>${escHtml(row.grn_number || '-')}</td>
          <td>${escHtml(row.po_number || '-')}</td>
          <td>${escHtml(row.vendor_name || '-')}</td>
          <td>${escHtml(row.received_date || '-')}</td>
          <td>${escHtml(row.received_by || '-')}</td>
          <td>${escHtml(getProjectLedgerRowStatus(row))}</td>
        </tr>
      `),
      'No linked goods receipts yet.'
    ));

    sections.push(renderProjectLedgerTable(
      'Accounts Payable',
      [
        { label: 'Bill No.' },
        { label: 'Vendor' },
        { label: 'Due Date' },
        { label: 'Total', className: 'text-right' },
        { label: 'Paid', className: 'text-right' },
        { label: 'Status' }
      ],
      filteredBills.map((row) => `
        <tr>
          <td>${escHtml(row.bill_number || '-')}</td>
          <td>${escHtml(row.vendor_name || row.vendor_id || '-')}</td>
          <td>${escHtml(row.due_date || '-')}</td>
          <td class="text-right">${formatPhpCurrency(row.total_amount || 0)}</td>
          <td class="text-right">${formatPhpCurrency(row.paid_amount || 0)}</td>
          <td>${escHtml(getProjectLedgerRowStatus(row))}</td>
        </tr>
      `),
      'No linked AP bills yet.'
    ));
  }

  if (showSection('payments')) {
    sections.push(renderProjectLedgerTable(
      'Payments',
      [
        { label: 'Type' },
        { label: 'Date' },
        { label: 'Reference' },
        { label: 'Method' },
        { label: 'Amount', className: 'text-right' }
      ],
      filteredPayments.map((row) => `
        <tr>
          <td>${escHtml(row.ledgerType || '-')}</td>
          <td>${escHtml(row.payment_date || '-')}</td>
          <td>${escHtml(row.reference_number || '-')}</td>
          <td>${escHtml(row.payment_method || '-')}</td>
          <td class="text-right">${formatPhpCurrency(row.amount || 0)}</td>
        </tr>
      `),
      'No linked payments yet.'
    ));
  }

  if (showSection('inventory')) {
    sections.push(renderProjectLedgerTable(
      'Inventory Movements',
      [
        { label: 'Date' },
        { label: 'Type' },
        { label: 'Product' },
        { label: 'Warehouse' },
        { label: 'Qty', className: 'text-right' },
        { label: 'Cost', className: 'text-right' },
        { label: 'Reference' }
      ],
      filteredInventoryMovements.map((row) => {
        const cost = Number(row.quantity || 0) * Number(row.unit_cost || 0);
        return `
          <tr>
            <td>${escHtml(row.movement_date || '-')}</td>
            <td>${escHtml(String(row.movement_type || '-').toUpperCase())}</td>
            <td>${escHtml([row.sku, row.product_name].filter(Boolean).join(' - ') || '-')}</td>
            <td>${escHtml([row.warehouse_code, row.warehouse_name].filter(Boolean).join(' - ') || '-')}</td>
            <td class="text-right">${Number(row.quantity || 0).toLocaleString('en-PH')}</td>
            <td class="text-right">${formatPhpCurrency(cost)}</td>
            <td>${escHtml([row.reference_type, row.reference_no].filter(Boolean).join(' - ') || '-')}</td>
          </tr>
        `;
      }),
      'No linked inventory movements yet.'
    ));
  }

  if (showSection('documents')) {
    sections.push(renderProjectLedgerDocuments(snapshot, query));
  }

  content.innerHTML = sections.join('') || '<div class="empty-row" style="padding:18px;text-align:center;">No overview records found.</div>';
}

async function loadProjectLedgerPage(projectId) {
  const id = Number(projectId || 0);
  const project = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
    .find((row) => Number(row.id || 0) === id);
  const content = document.getElementById('project-ledger-page-content');

  if (!id) {
    currentProjectLedgerSnapshot = null;
    if (content) content.innerHTML = '<div class="empty-row" style="padding:18px;text-align:center;">No project selected.</div>';
    return;
  }

  if (!project) {
    currentProjectLedgerSnapshot = null;
    if (content) content.innerHTML = '<div class="empty-row" style="padding:18px;text-align:center;">Loading project...</div>';
    return;
  }

  const projectLabel = [project.project_docno || project.source_docno, project.project_name]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' - ') || 'Project Overview';
  const companyName = getProjectCompanyName(project) || 'No company';

  const heading = document.getElementById('project-ledger-page-heading');
  const subtitle = document.getElementById('project-ledger-page-subtitle');
  if (heading) heading.textContent = projectLabel;
  if (subtitle) {
    subtitle.textContent = `${companyName} | ${formatDateYmd(project.start_date || project.planned_start_date || '') || '-'} to ${formatDateYmd(project.end_date || project.planned_end_date || '') || '-'}`;
  }
  if (content) content.innerHTML = '<div class="empty-row" style="padding:18px;text-align:center;">Loading project overview...</div>';

  try {
    const data = await fetchProjectLedgerData();
    currentProjectLedgerSnapshot = buildProjectLedgerSnapshot(project, data);
    const { totals, receivables, bills, requisitions, quotations, purchaseOrders, goodsReceipts, inventoryMovements } = currentProjectLedgerSnapshot;
    setProjectLedgerMetric('project-ledger-page-ar-total', formatPhpCurrency(totals.arTotal));
    setProjectLedgerMetric('project-ledger-page-collected-total', formatPhpCurrency(totals.collectedTotal));
    setProjectLedgerMetric('project-ledger-page-ap-total', formatPhpCurrency(totals.apTotal));
    setProjectLedgerMetric('project-ledger-page-net-total', formatPhpCurrency(totals.netTotal));
    setProjectLedgerMetric('project-ledger-page-ar-mini', `${receivables.length} receivable${receivables.length === 1 ? '' : 's'}`);
    setProjectLedgerMetric('project-ledger-page-collected-mini', `${formatPhpCurrency(Math.max(0, totals.arTotal - totals.collectedTotal))} AR balance`);
    setProjectLedgerMetric('project-ledger-page-ap-mini', `${requisitions.length} PR | ${quotations.length} quote | ${purchaseOrders.length} PO | ${goodsReceipts.length} GRN | ${inventoryMovements.length} inventory | ${bills.length} bill | ${formatPhpCurrency(Math.max(0, totals.apTotal - totals.apPaidTotal))} balance`);
    setProjectLedgerMetric('project-ledger-page-count-mini', `${totals.recordCount} linked record${totals.recordCount === 1 ? '' : 's'}`);
    renderProjectLedgerPage();
  } catch (err) {
    console.error('Project ledger page load error:', err);
    currentProjectLedgerSnapshot = null;
    if (content) content.innerHTML = `<div class="empty-row" style="padding:18px;text-align:center;">${escHtml(err.message || 'Unable to load project overview.')}</div>`;
  }
}

// Portfolio profitability — runs the SAME per-project ledger calc (AR revenue vs AP+inventory cost)
// across ALL active projects so you can see margins at a glance. Reuses fetchProjectLedgerData +
// buildProjectLedgerSnapshot so the numbers exactly match each project's Overview ("tama sa flow").
async function openProjectProfitability() {
  const backdrop = document.getElementById('project-profitability-modal-backdrop');
  const body = document.getElementById('project-profitability-body');
  if (!backdrop || !body) return;
  body.innerHTML = '<div class="empty-row" style="padding:24px;text-align:center;">Loading profitability…</div>';
  backdrop.style.display = 'flex';
  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
  try {
    if (!Array.isArray(projectsDashboardDb) || !projectsDashboardDb.length) await loadProjectsDashboardData();
    const data = await fetchProjectLedgerData();
    const projects = (projectsDashboardDb || []).filter((p) => Number(p.is_archived) !== 1 && p.is_archived !== true);
    const rows = projects.map((p) => {
      const t = buildProjectLedgerSnapshot(p, data).totals;
      const revenue = Number(t.arTotal || 0) || Number(t.contractAmount || 0);
      const cost = Number(t.apTotal || 0) + Number(t.inventoryCostTotal || 0);
      const profit = revenue - cost;
      const margin = revenue > 0 ? Math.round((profit / revenue) * 100) : 0;
      const label = [p.project_docno || p.draft_docno, p.project_name].map((v) => String(v || '').trim()).filter(Boolean).join(' - ') || `Project #${Number(p.id)}`;
      return { id: Number(p.id), label, company: getProjectCompanyName(p) || '-', revenue, cost, profit, margin };
    }).sort((a, b) => b.profit - a.profit);

    const totRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    const totCost = rows.reduce((s, r) => s + r.cost, 0);
    const totProfit = totRevenue - totCost;
    const avgMargin = totRevenue > 0 ? Math.round((totProfit / totRevenue) * 100) : 0;
    const profitable = rows.filter((r) => r.profit >= 0).length;
    const losing = rows.length - profitable;
    const tone = (v) => (v >= 0 ? '#166534' : '#b91c1c');

    body.innerHTML = `
      <div class="stats dashboard-stats" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px;">
        <div class="stat-card stat-card-accent"><div class="stat-label">Total Revenue</div><div class="stat-val">${formatPhpCurrency(totRevenue)}</div><div class="stat-mini">AR billed / contract</div></div>
        <div class="stat-card stat-card-warning"><div class="stat-label">Total Cost</div><div class="stat-val">${formatPhpCurrency(totCost)}</div><div class="stat-mini">AP bills + inventory</div></div>
        <div class="stat-card stat-card-primary"><div class="stat-label">Gross Profit</div><div class="stat-val" style="color:${tone(totProfit)};">${formatPhpCurrency(totProfit)}</div><div class="stat-mini">Revenue − Cost</div></div>
        <div class="stat-card stat-card-company"><div class="stat-label">Avg Margin</div><div class="stat-val">${avgMargin}%</div><div class="stat-mini">${profitable} profit • ${losing} loss</div></div>
      </div>
      <div class="table-wrap" style="max-height:50vh;overflow:auto;">
        <table class="project-records-table">
          <thead><tr><th>Project</th><th>Company</th><th class="text-right">Revenue</th><th class="text-right">Cost</th><th class="text-right">Gross Profit</th><th class="text-right">Margin</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map((r) => `
              <tr style="cursor:pointer;" onclick="closeProjectProfitability(); openProjectLedger(${r.id});" title="Buksan ang project overview">
                <td><strong>${escHtml(r.label)}</strong></td>
                <td>${escHtml(r.company)}</td>
                <td class="text-right">${formatPhpCurrency(r.revenue)}</td>
                <td class="text-right">${formatPhpCurrency(r.cost)}</td>
                <td class="text-right" style="font-weight:700;color:${tone(r.profit)};">${formatPhpCurrency(r.profit)}</td>
                <td class="text-right" style="font-weight:700;color:${tone(r.profit)};">${r.margin}%</td>
              </tr>`).join('') : '<tr class="empty-row"><td colspan="6" style="text-align:center;padding:18px;">No active projects yet.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div style="font-size:.72rem;color:var(--muted);margin-top:10px;">Revenue = AR billed (o project budget kung wala pang AR). Cost = AP bills + inventory cost. Hindi kasama ang drafts/cancelled. Pindutin ang row para sa detalyadong overview.</div>
    `;
  } catch (err) {
    console.error('Project profitability error:', err);
    body.innerHTML = `<div class="empty-row" style="padding:24px;text-align:center;">${escHtml(err.message || 'Unable to load profitability.')}</div>`;
  }
}

function closeProjectProfitability() {
  const backdrop = document.getElementById('project-profitability-modal-backdrop');
  if (backdrop) { backdrop.style.display = 'none'; backdrop.classList.remove('open'); }
  document.body.style.overflow = '';
}

async function openProjectLedger(projectId) {
  const id = Number(projectId || 0);
  const project = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
    .find((row) => Number(row.id || 0) === id);
  if (!id || !project) {
    showToast('Project not found.', 'error');
    return;
  }

  // Open the Project Overview IN-PLACE (panel switch on the SAME tab) — never a new tab. Opening a
  // new tab left THIS tab idle, which tripped the inactivity auto-logout even while you kept working
  // in the other tab (one session → both get logged out). Staying in one tab keeps activity alive.
  currentProjectLedgerId = id;
  if (window.history && window.history.replaceState) {
    const u = new URL(window.location.href);
    u.searchParams.set('panel', 'project-ledger');
    u.searchParams.set('project_id', String(id));
    window.history.replaceState({}, '', u.toString());
  }
  openDashboardPanel('project-ledger');
  return;

  const backdrop = document.getElementById('project-ledger-modal-backdrop');
  const content = document.getElementById('project-ledger-content');
  if (!backdrop || !content) return;

  const projectLabel = [project.project_docno || project.source_docno, project.project_name]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' - ') || 'Project Overview';
  const companyName = getProjectCompanyName(project) || 'No company';

  document.getElementById('project-ledger-title').textContent = projectLabel;
  document.getElementById('project-ledger-subtitle').textContent = `${companyName} | ${formatDateYmd(project.start_date || project.planned_start_date || '') || '-'} to ${formatDateYmd(project.end_date || project.planned_end_date || '') || '-'}`;
  content.innerHTML = '<div class="empty-row" style="padding:18px;text-align:center;">Loading project overview...</div>';
  backdrop.classList.add('open');

  try {
    const data = await fetchProjectLedgerData();
    const transactions = data.transactions.filter((row) => Number(row.project_id || 0) === id);
    const transactionIds = new Set(transactions.map((row) => Number(row.id || 0)).filter(Boolean));
    const receivables = data.receivables.filter((row) => Number(row.project_id || 0) === id || transactionIds.has(Number(row.transaction_id || 0)));
    const receivableIds = new Set(receivables.map((row) => Number(row.id || 0)).filter(Boolean));
    const bills = data.bills.filter((row) => Number(row.project_id || 0) === id);
    const billIds = new Set(bills.map((row) => Number(row.id || 0)).filter(Boolean));
    const apPayments = data.apPayments.filter((row) => billIds.has(Number(row.ap_id || 0)));
    const arPayments = data.arPayments.filter((row) => receivableIds.has(Number(row.ar_id || 0)));
    const serviceOrders = data.serviceOrders.filter((row) => Number(row.project_id || 0) === id);

    const arTotal = receivables.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    const collectedFromPayments = arPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const collectedFromRows = receivables.reduce((sum, row) => sum + Number(row.paid_amount || 0), 0);
    const collectedTotal = Math.max(collectedFromPayments, collectedFromRows);
    const apTotal = bills.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    const apPaidFromPayments = apPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const apPaidFromRows = bills.reduce((sum, row) => sum + Number(row.paid_amount || 0), 0);
    const apPaidTotal = Math.max(apPaidFromPayments, apPaidFromRows);
    const netTotal = arTotal - apTotal;

    setProjectLedgerMetric('ledger-ar-total', formatPhpCurrency(arTotal));
    setProjectLedgerMetric('ledger-collected-total', formatPhpCurrency(collectedTotal));
    setProjectLedgerMetric('ledger-ap-total', formatPhpCurrency(apTotal));
    setProjectLedgerMetric('ledger-net-total', formatPhpCurrency(netTotal));
    setProjectLedgerMetric('ledger-ar-mini', `${receivables.length} receivable${receivables.length === 1 ? '' : 's'} | ${formatPhpCurrency(Math.max(0, arTotal - collectedTotal))} balance`);
    setProjectLedgerMetric('ledger-ap-mini', `${bills.length} bill${bills.length === 1 ? '' : 's'} | ${formatPhpCurrency(Math.max(0, apTotal - apPaidTotal))} balance`);

    const transactionsTable = renderProjectLedgerTable(
      'Transactions',
      [
        { label: 'Doc No.' },
        { label: 'Date' },
        { label: 'Description' },
        { label: 'Amount', className: 'text-right' },
        { label: 'Status' }
      ],
      transactions.map((row) => `
        <tr>
          <td>${escHtml(row.docno || '-')}</td>
          <td>${escHtml(row.date || '-')}</td>
          <td>${escHtml(row.description || '-')}</td>
          <td class="text-right">${formatPhpCurrency(row.amount || 0)}</td>
          <td>${escHtml(getProjectLedgerRowStatus(row))}</td>
        </tr>
      `),
      'No linked transactions yet.'
    );

    const arTable = renderProjectLedgerTable(
      'Accounts Receivable',
      [
        { label: 'Invoice No.' },
        { label: 'Due Date' },
        { label: 'Terms' },
        { label: 'Total', className: 'text-right' },
        { label: 'Paid', className: 'text-right' },
        { label: 'Status' }
      ],
      receivables.map((row) => `
        <tr>
          <td>${escHtml(row.invoice_number || '-')}</td>
          <td>${escHtml(row.due_date || '-')}</td>
          <td>${escHtml(row.payment_terms || '-')}</td>
          <td class="text-right">${formatPhpCurrency(row.total_amount || 0)}</td>
          <td class="text-right">${formatPhpCurrency(row.paid_amount || 0)}</td>
          <td>${escHtml(getProjectLedgerRowStatus(row))}</td>
        </tr>
      `),
      'No linked receivables yet.'
    );

    const apTable = renderProjectLedgerTable(
      'Accounts Payable',
      [
        { label: 'Bill No.' },
        { label: 'Vendor' },
        { label: 'Due Date' },
        { label: 'Total', className: 'text-right' },
        { label: 'Paid', className: 'text-right' },
        { label: 'Status' }
      ],
      bills.map((row) => `
        <tr>
          <td>${escHtml(row.bill_number || '-')}</td>
          <td>${escHtml(row.vendor_name || row.vendor_id || '-')}</td>
          <td>${escHtml(row.due_date || '-')}</td>
          <td class="text-right">${formatPhpCurrency(row.total_amount || 0)}</td>
          <td class="text-right">${formatPhpCurrency(row.paid_amount || 0)}</td>
          <td>${escHtml(getProjectLedgerRowStatus(row))}</td>
        </tr>
      `),
      'No linked AP bills yet.'
    );

    const paymentsTable = renderProjectLedgerTable(
      'Payments',
      [
        { label: 'Type' },
        { label: 'Date' },
        { label: 'Reference' },
        { label: 'Method' },
        { label: 'Amount', className: 'text-right' }
      ],
      [
        ...arPayments.map((row) => `
          <tr>
            <td>AR</td>
            <td>${escHtml(row.payment_date || '-')}</td>
            <td>${escHtml(row.reference_number || '-')}</td>
            <td>${escHtml(row.payment_method || '-')}</td>
            <td class="text-right">${formatPhpCurrency(row.amount || 0)}</td>
          </tr>
        `),
        ...apPayments.map((row) => `
          <tr>
            <td>AP</td>
            <td>${escHtml(row.payment_date || '-')}</td>
            <td>${escHtml(row.reference_number || '-')}</td>
            <td>${escHtml(row.payment_method || '-')}</td>
            <td class="text-right">${formatPhpCurrency(row.amount || 0)}</td>
          </tr>
        `)
      ],
      'No linked payments yet.'
    );

    const soTable = renderProjectLedgerTable(
      'Service Orders',
      [
        { label: 'SO No.' },
        { label: 'Date' },
        { label: 'Title' },
        { label: 'Amount', className: 'text-right' },
        { label: 'Status' }
      ],
      serviceOrders.map((row) => `
        <tr>
          <td>${escHtml(row.so_number || '-')}</td>
          <td>${escHtml(row.service_date || '-')}</td>
          <td>${escHtml(row.service_title || '-')}</td>
          <td class="text-right">${formatPhpCurrency(row.total_amount || 0)}</td>
          <td>${escHtml(getProjectLedgerRowStatus(row))}</td>
        </tr>
      `),
      'No linked service orders yet.'
    );

    content.innerHTML = `${transactionsTable}${arTable}${apTable}${paymentsTable}${soTable}`;
  } catch (err) {
    console.error('Project ledger load error:', err);
    content.innerHTML = `<div class="empty-row" style="padding:18px;text-align:center;">${escHtml(err.message || 'Unable to load project overview.')}</div>`;
  }
}

function closeProjectLedger() {
  document.getElementById('project-ledger-modal-backdrop')?.classList.remove('open');
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

function getInvoiceRows() {
  // Receivables rendered as dashboard "invoice" rows (the Transactions feed was retired,
  // so AR is sourced entirely from accounts_receivable). De-duped by invoice/doc number.
  const receivableRows = (Array.isArray(allReceivablesDb) ? allReceivablesDb : []).map(row => ({
    type: 'invoice',
    source: 'receivable',
    docno: row.invoice_number || row.project_docno || '',
    customer: row.customer_name || '',
    amount: Number(row.total_amount || 0),
    downpayment: Number(row.paid_amount || 0),
    status: row.status || 'draft',
    project_docno: row.project_docno || '',
    project_id: row.project_id || null
  }));
  const seenKeys = new Set();
  return receivableRows.filter((row) => {
    const key = String(row.docno || '').trim().toLowerCase();
    if (!key) return true;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
}

function getDashboardInvoiceRows() {
  return getInvoiceRows().filter(row => companyMatchesDashboardFilter(getDashboardCompanyNameForRecord(row)));
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

function renderProjectLedgerStats(records = getDashboardInvoiceRows()) {
  const invoiceRows = Array.isArray(records) ? records : getDashboardInvoiceRows();
  const statusCounts = { paid: 0, partial: 0, unpaid: 0 };

  invoiceRows.forEach((row) => {
    const status = getDashboardInvoiceStatus(row);
    const key = statusCounts.hasOwnProperty(status) ? status : 'unpaid';
    statusCounts[key] += 1;
  });

  const totalEl = document.getElementById('project-ledger-total');
  const paidEl = document.getElementById('project-ledger-paid');
  const partialEl = document.getElementById('project-ledger-partial');
  const unpaidEl = document.getElementById('project-ledger-unpaid');

  if (totalEl) totalEl.textContent = String(invoiceRows.length);
  if (paidEl) paidEl.textContent = String(statusCounts.paid);
  if (partialEl) partialEl.textContent = String(statusCounts.partial);
  if (unpaidEl) unpaidEl.textContent = String(statusCounts.unpaid);
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

function formatDateInputValue(value) {
  const formatted = formatDateYmd(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(formatted) ? formatted : '';
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
  if (status === 'draft') return 'pending';
  if (status === 'cancelled') return 'closed';
  if (status === 'completed') return 'closed';
  if (status === 'on_hold') return 'paused';
  if (status === 'overdue') return 'ended';
  if (getProjectTimelineDates(project).actualEnd) return 'closed';

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
  const timeline = getProjectTimelineDates(project);

  if (status === 'draft') return 'draft';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'on_hold') return 'on_hold';
  if (status === 'overdue') return 'overdue';
  if (status === 'completed' || timeline.actualEnd) return 'completed';
  if (phase === 'upcoming') return 'upcoming';
  if (phase === 'ended') return 'overdue';
  if (phase === 'paused') return 'on_hold';
  return 'ongoing';
}

function getProjectLifecycleClass(project) {
  const label = getProjectLifecycleLabel(project);
  return `status-${label.replace(/_/g, '-')}`;
}

function findSourceTransactionForProject() {
  // Transactions feature retired — projects no longer have a linked source transaction.
  return null;
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
  const amountEl = document.getElementById('p-budget');
  const downpaymentEl = document.getElementById('p-downpayment');
  const balanceEl = document.getElementById('p-balance-display');
  const statusEl = document.getElementById('p-payment-status-display');

  const amount = parseFloat(amountEl?.value) || 0;
  const downpayment = parseFloat(downpaymentEl?.value) || 0;
  const balance = Math.max(0, amount - downpayment);
  const status = amount > 0 && balance <= 0 ? 'paid' : (downpayment > 0 ? 'partial' : 'unpaid');
  const statusLabel = status === 'paid' ? 'Paid' : status === 'partial' ? 'Partial' : 'Unpaid';

  if (balanceEl) {
    balanceEl.textContent = 'PHP ' + balance.toLocaleString('en-PH', { minimumFractionDigits: 2 });
  }

  if (statusEl) {
    statusEl.textContent = statusLabel;
    statusEl.className = `status-pill status-${status}`;
    statusEl.style.display = 'inline-flex';
  }

  return { amount, downpayment, balance, status };
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
    const contractAmountText = `PHP ${parseFloat(project.budget || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
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
      <td class="text-right" style="padding: 15px 20px; font-size: 0.95rem;">${highlight(contractAmountText, q)}</td>
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
  const confirmed = (typeof window.showConfirm === 'function')
    ? await window.showConfirm('Sigurado ka bang gusto mong mag-logout?', { title: 'Logout?', confirmLabel: 'Oo, mag-logout', cancelLabel: 'Cancel', type: 'danger' })
    : await openConfirmDialog({ title: 'Logout?', message: 'Sigurado ka bang gusto mong mag-logout?', noText: 'Cancel', yesText: 'Oo, mag-logout' });
  if (!confirmed) return;
  localStorage.removeItem('kinaadman_activeTab');
  localStorage.removeItem('kinaadman_dashboardPanel');
  localStorage.removeItem(USER_BADGE_CACHE_KEY);
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
let isSavingRecord = false;
let projectsDashboardDb = [];
let allReceivablesDb = [];
let serviceOrdersDb = [];
let serviceOrdersInitialLoadAttempted = false;
let businessEntitiesDb = [];
const BUSINESS_ENTITY_CONTEXT_KEY = 'kinaadman_businessEntityContext';
const BUSINESS_ENTITY_THEME_KEY = 'kinaadman_businessEntityTheme';
let currentBusinessEntityContextId = '';
let companyRegistryDb = [];
let serviceOrderCompanyPickerDb = [];
let serviceOrderVendorPickerDb = [];
let serviceOrderPickerLoadPromise = null;
let currentDashboardCompany = normalizeDashboardCompanyName(localStorage.getItem('kinaadman_dashboardCompany') || 'all') || 'all';
let logsDb = [];
let notificationsDb = [];
let archiveCenterDb = [];
let archiveCenterActiveTab = 'all';
let invoiceStatusView = 'paid';
let dashboardBarRange = 6;
let currentDashboardPanel = 'home';
let currentProjectLedgerId = null;
let currentProjectLedgerSnapshot = null;
let currentProjectLedgerSubmodule = 'overview';
let currentProjectWorkspaceTab = 'projects';
let ongoingProjectsViewMode = 'ongoing';
let recordsLoadSeq = 0;
let projectsLoadSeq = 0;
let dashboardStatsSeq = 0;
let pendingTransactionProjectId = null;
let pendingTransactionLaunch = false;
let memberSlotVisibleCount = 1;
let resetPasswordUserId = null;
let resetPasswordUserLabel = '';
let editingProjectId = null;
let editingServiceOrderId = null;
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
  if (activeTab === 'users') openUserModal();
  else openModal();
}

function getDefaultBusinessEntityId() {
  const rows = Array.isArray(businessEntitiesDb) ? businessEntitiesDb : [];
  const defaultRow = rows.find(row => Number(row.is_default || 0) === 1) || rows[0] || null;
  return defaultRow ? String(defaultRow.id || '') : '';
}

function getCurrentBusinessEntityId() {
  const rows = Array.isArray(businessEntitiesDb) ? businessEntitiesDb : [];
  const stored = String(currentBusinessEntityContextId || localStorage.getItem(BUSINESS_ENTITY_CONTEXT_KEY) || '').trim();
  if (stored && stored !== 'all' && rows.some(row => String(row.id || '') === stored)) {
    currentBusinessEntityContextId = stored;
    return stored;
  }
  // 'all' filter (or unset): new records default to the default operating company.
  // Do NOT persist this over the stored 'all' selection so the filter stays on "All Companies".
  return getDefaultBusinessEntityId();
}

function findBusinessEntityById(id) {
  const target = String(id || '').trim();
  if (!target) return null;
  return (Array.isArray(businessEntitiesDb) ? businessEntitiesDb : [])
    .find(row => String(row.id || '') === target) || null;
}

function businessEntityShortLabel(row) {
  const code = String(row?.entity_code || '').replace(/^ENT-\d+\s*/i, '').trim();
  const name = String(row?.company_name || code || '').trim();
  if (/kvsk/i.test(name)) return 'KVSK';
  if (/kitsi|ktiis/i.test(name)) return 'KITSI';
  return (code || name || 'Company').replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'Company';
}

function businessEntityProfileValue(value, fallback = 'Not set') {
  const text = String(value || '').trim();
  return text || fallback;
}

function getWorkspaceBusinessEntities(rows = businessEntitiesDb) {
  const source = Array.isArray(rows) ? rows : [];
  const filtered = source.filter((row) => {
    const code = String(row?.entity_code || '').trim();
    const name = String(row?.company_name || '').trim();
    return /kvsk|kitsi|ktiis|kinaadman/i.test(`${code} ${name}`);
  });
  return filtered.length ? filtered : source;
}

function renderBusinessEntityProfilePanel(current = getBusinessEntityFilterId()) {
  const panel = document.getElementById('business-profile-panel');
  if (!panel) return;
  const rows = getWorkspaceBusinessEntities();
  const filter = String(current || 'all');
  const allActive = filter === 'all';
  const allCard = `
    <button class="business-profile-card${allActive ? ' is-active' : ''}" type="button" onclick="setBusinessEntityContext('all')">
      <span class="business-profile-logo-wrap business-profile-logo-mono">ALL</span>
      <span class="business-profile-copy">
        <span class="business-profile-name">All Companies</span>
        <span class="business-profile-meta">Records from every operating company</span>
      </span>
    </button>
  `;
  const companyCards = rows.map((row) => {
    const id = String(row.id || '');
    const isActive = id === filter;
    const logoMarkup = row.logo_path
      ? `<span class="business-profile-logo-wrap"><img src="${escHtml(row.logo_path)}" alt="${escHtml(row.company_name || 'Company')} logo" /></span>`
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
  }).join('');
  panel.innerHTML = allCard + companyCards;
}

function renderCurrentWorkspaceBadge() {
  const badge = document.getElementById('current-workspace-badge');
  if (!badge) return;
  const filter = getBusinessEntityFilterId();
  if (filter === 'all') {
    badge.textContent = 'All Companies';
    badge.title = 'Showing records from all operating companies';
    badge.setAttribute('aria-label', 'Showing all operating companies');
    return;
  }
  const entity = findBusinessEntityById(filter);
  const label = entity?.company_name || businessEntityShortLabel(entity || {}) || 'Company';
  badge.textContent = label;
  badge.title = `Showing records for ${label}`;
  badge.setAttribute('aria-label', `Showing records for ${label}`);
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

function getBusinessEntityFilterId() {
  const stored = String(currentBusinessEntityContextId || localStorage.getItem(BUSINESS_ENTITY_CONTEXT_KEY) || '').trim();
  if (stored === 'all') return 'all';
  const rows = Array.isArray(businessEntitiesDb) ? businessEntitiesDb : [];
  if (stored && rows.some(row => String(row.id || '') === stored)) return stored;
  return 'all';
}

function businessEntityMatches(row) {
  const filter = getBusinessEntityFilterId();
  if (!filter || filter === 'all') return true;
  const rowEntity = String(row?.business_entity_id || '').trim();
  // Records without an operating company (legacy data) stay visible in every view.
  if (!rowEntity) return true;
  return rowEntity === filter;
}

// Lighten (positive %) or darken (negative %) a #rrggbb hex toward white/black.
function shadeBrandHex(hex, percent) {
  const h = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return hex;
  const t = percent < 0 ? 0 : 255;
  const p = Math.abs(percent) / 100;
  const ch = (i) => { const c = parseInt(h.slice(i, i + 2), 16); return Math.round((t - c) * p) + c; };
  return '#' + [ch(0), ch(2), ch(4)].map((x) => ('0' + Math.max(0, Math.min(255, x)).toString(16)).slice(-2)).join('');
}

function getBusinessEntityBrandProfile(row) {
  const logo = String(row?.logo_path || row?.logo || '').trim();
  const name = String(row?.company_name || '').trim();
  const brandColor = String(row?.brand_color || '').trim();
  // The entity's own brand color (set in the Business Entity modal) themes the whole workspace.
  // Falls back to the default maroon when the entity has no color (or "All Companies").
  if (/^#[0-9a-fA-F]{6}$/.test(brandColor)) {
    return {
      theme: 'entity', brand_color: brandColor, logo,
      alt: name ? `${name} logo` : 'Company logo',
      primary: brandColor,
      primaryLight: shadeBrandHex(brandColor, 38),
      primaryDark: shadeBrandHex(brandColor, -42),
      accent: brandColor,
      accent2: shadeBrandHex(brandColor, -72)
    };
  }
  return {
    theme: 'neutral',
    logo,
    alt: name ? `${name} logo` : 'Company logo',
    primary: '#334155',
    primaryLight: '#64748b',
    primaryDark: '#1e293b',
    accent: '#475569',
    accent2: '#0f172a'
  };
}

function sanitizeStoredBusinessEntityThemeProfile(profile) {
  const fallback = getBusinessEntityBrandProfile({ theme: 'kvsk' });
  return {
    ...fallback,
    ...profile,
    logo: profile.logo || profile.logo_path || '',
    alt: profile.alt || (profile.company_name ? `${profile.company_name} logo` : fallback.alt),
    company_name: profile.company_name || 'KVSK CCTV & IT Solution'
  };
}

function getStoredBusinessEntityThemeProfile() {
  try {
    const urlTheme = String(new URLSearchParams(window.location.search || '').get('theme') || '').trim().toLowerCase();
    if (urlTheme === 'kitsi' || urlTheme === 'kvsk') {
      const profile = getBusinessEntityBrandProfile({
        theme: 'kvsk',
        company_name: 'KVSK CCTV & IT Solution'
      });
      const storedProfile = {
        company_name: 'KVSK CCTV & IT Solution',
        theme: profile.theme,
        logo: profile.logo,
        alt: profile.alt,
        primary: profile.primary,
        primaryLight: profile.primaryLight,
        primaryDark: profile.primaryDark,
        accent: profile.accent,
        accent2: profile.accent2
      };
      sessionStorage.setItem('kinaadman_pendingBusinessEntityTheme', JSON.stringify(storedProfile));
      localStorage.setItem(BUSINESS_ENTITY_THEME_KEY, JSON.stringify(storedProfile));
      return storedProfile;
    }
  } catch (_) {}
  try {
    const raw = localStorage.getItem(BUSINESS_ENTITY_THEME_KEY);
    let stored = raw ? JSON.parse(raw) : null;
    if (stored?.theme) {
      stored = sanitizeStoredBusinessEntityThemeProfile(stored);
      localStorage.setItem(BUSINESS_ENTITY_THEME_KEY, JSON.stringify(stored));
      return stored;
    }
  } catch (_) {}
  try {
    const pendingRaw = sessionStorage.getItem('kinaadman_pendingBusinessEntityTheme');
    let pending = pendingRaw ? JSON.parse(pendingRaw) : null;
    if (pending?.theme) {
      pending = sanitizeStoredBusinessEntityThemeProfile(pending);
      sessionStorage.setItem('kinaadman_pendingBusinessEntityTheme', JSON.stringify(pending));
      return pending;
    }
  } catch (_) {}
  return null;
}

function applyStoredBusinessEntityBrand() {
  // "All Companies" always uses the neutral slate theme — never KVSK's (or any) stale stored color.
  if (typeof getBusinessEntityFilterId === 'function' && getBusinessEntityFilterId() === 'all') {
    applyBusinessEntityBrand({});
    return;
  }
  const stored = getStoredBusinessEntityThemeProfile();
  if (stored?.theme) {
    applyBusinessEntityBrand(stored);
    return;
  }
  if (document.documentElement?.dataset?.businessEntityThemeReady === '1') return;
  // No saved workspace yet → default scope is "All Companies" (context-aware), never KVSK.
  applyBusinessEntityBrand({});
}

function applyBusinessEntityBrand(row) {
  const profile = getBusinessEntityBrandProfile(row);
  if (document.documentElement && document.documentElement.dataset) {
    document.documentElement.dataset.businessEntityTheme = profile.theme;
    document.documentElement.dataset.businessEntityThemeReady = '1';
  }
  if (document.body && document.body.dataset) {
    document.body.dataset.businessEntityTheme = profile.theme;
    document.body.dataset.businessEntityThemeReady = '1';
  }
  // Set on BOTH <html> and <body> so a custom entity color beats the body[data-theme] CSS rules.
  [document.documentElement, document.body].forEach((el) => {
    if (!el || !el.style) return;
    el.style.setProperty('--primary', profile.primary);
    el.style.setProperty('--primary-light', profile.primaryLight);
    el.style.setProperty('--primary-dark', profile.primaryDark);
    el.style.setProperty('--accent', profile.accent);
    el.style.setProperty('--accent2', profile.accent2);
  });

  // Brand marks show the active company's uploaded logo. "All Companies" (or a
  // company without an uploaded logo) shows no mark — walang logo muna.
  const filterId = getBusinessEntityFilterId();
  let logoEntity = (row && row.logo_path) ? row : null;
  if (!logoEntity && filterId && filterId !== 'all') {
    logoEntity = findBusinessEntityById(filterId);
  }
  const entityLogo = (filterId !== 'all' && logoEntity && logoEntity.logo_path)
    ? String(logoEntity.logo_path)
    : '';
  document.querySelectorAll('.brand-mark, .sidebar-brand-mark, .user-modal-brand-mark').forEach((img) => {
    if (entityLogo) {
      img.src = entityLogo;
      img.alt = (logoEntity && logoEntity.company_name ? logoEntity.company_name : 'Company') + ' logo';
      img.style.removeProperty('display');
      img.removeAttribute('hidden');
    } else {
      img.style.display = 'none';
      img.removeAttribute('src');
      img.alt = '';
    }
  });
  document.querySelectorAll('.sidebar-header .header-logo').forEach((node) => {
    node.textContent = (filterId !== 'all' && logoEntity && logoEntity.company_name)
      ? logoEntity.company_name
      : 'All Companies';
  });
  document.querySelectorAll('.user-modal-kicker').forEach((node) => {
    const currentText = String(node.textContent || '').trim();
    if (/^(KVSK|KITSI)\s+Access Control$/i.test(currentText)) {
      node.textContent = 'KVSK Access Control';
    }
  });
  try {
    const storedProfile = {
      company_name: getBusinessEntityFilterId() === 'all' ? 'All Companies' : (row?.company_name || 'All Companies'),
      theme: profile.theme,
      brand_color: profile.brand_color || '',
      logo: profile.logo,
      alt: profile.alt,
      primary: profile.primary,
      primaryLight: profile.primaryLight,
      primaryDark: profile.primaryDark,
      accent: profile.accent,
      accent2: profile.accent2
    };
    localStorage.setItem(BUSINESS_ENTITY_THEME_KEY, JSON.stringify(storedProfile));
    sessionStorage.setItem('kinaadman_pendingBusinessEntityTheme', JSON.stringify(storedProfile));
  } catch (_) {}
}

function renderBusinessEntitySwitcher() {
  const host = document.getElementById('business-entity-switcher');
  const rows = getWorkspaceBusinessEntities();
  const filter = getBusinessEntityFilterId();
  if (host) {
    const allBtn = `<button class="business-entity-switch${filter === 'all' ? ' is-active' : ''}" type="button" data-business-entity-id="all" aria-pressed="${filter === 'all' ? 'true' : 'false'}" onclick="setBusinessEntityContext('all')">All</button>`;
    host.innerHTML = allBtn + rows.map(row => {
      const id = String(row.id || '');
      const label = businessEntityShortLabel(row);
      return `<button class="business-entity-switch${id === filter ? ' is-active' : ''}" type="button" data-business-entity-id="${escHtml(id)}" aria-pressed="${id === filter ? 'true' : 'false'}" onclick="setBusinessEntityContext('${escHtml(id)}')">${escHtml(label)}</button>`;
    }).join('');
  }
  const activeEntity = filter === 'all' ? null : findBusinessEntityById(filter);
  applyBusinessEntityBrand(activeEntity);
  renderBusinessEntityProfilePanel(filter);
  renderCurrentWorkspaceBadge();
  syncModalBusinessContext(activeEntity);
  document.querySelectorAll('header .brand-copy .header-logo').forEach((node) => {
    node.textContent = activeEntity?.company_name || (filter === 'all' ? 'All Companies' : 'Kinaadman ERP');
  });
  if (document.documentElement?.dataset) {
    document.documentElement.dataset.businessEntityBrandTextReady = '1';
  }
}

function setBusinessEntityContext(id) {
  const nextId = String(id || '').trim();
  if (!nextId) return;
  currentBusinessEntityContextId = nextId;
  localStorage.setItem(BUSINESS_ENTITY_CONTEXT_KEY, nextId);
  serviceOrderCompanyPickerDb = [];
  serviceOrderVendorPickerDb = [];
  projectCompanies = [];
  renderBusinessEntitySwitcher();
  populateBusinessEntitySelect('f-business-entity-id');
  populateBusinessEntitySelect('p-business-entity-id');
  populateBusinessEntitySelect('so-business-entity-id');
  renderProjectWorkspace();
  renderTable();
  renderOngoingProjects();
  updateStats().catch((err) => console.error('Business entity stats refresh error:', err));
}

function populateBusinessEntitySelect(selectId, selectedValue = '') {
  const select = document.getElementById(selectId);
  if (!select) return;
  const rows = Array.isArray(businessEntitiesDb) ? businessEntitiesDb : [];
  const selected = String(selectedValue || select.value || getDefaultBusinessEntityId() || '').trim();

  if (String(select.tagName || '').toLowerCase() !== 'select') {
    select.value = selected || getDefaultBusinessEntityId() || '';
    return;
  }

  select.innerHTML = rows.length
    ? rows.map(row => `<option value="${escHtml(row.id)}">${escHtml(row.company_name || row.entity_code || 'Operating Company')}</option>`).join('')
    : '<option value="">Default company</option>';
  if (selected && Array.from(select.options || []).some(option => String(option.value) === selected)) {
    select.value = selected;
  } else if (rows.length) {
    select.value = getDefaultBusinessEntityId();
  }
}

async function loadBusinessEntities() {
  try {
    const res = await fetch('/api/business-entities', { cache: 'no-store' });
    const data = await res.json().catch(() => []);
    if (!res.ok) throw new Error(data.error || 'Unable to load operating companies.');
    businessEntitiesDb = getWorkspaceBusinessEntities(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error('Load business entities error:', err);
    businessEntitiesDb = [];
  }
  renderBusinessEntitySwitcher();
  populateBusinessEntitySelect('f-business-entity-id');
  populateBusinessEntitySelect('p-business-entity-id');
  populateBusinessEntitySelect('so-business-entity-id');
  renderProjectWorkspace();
  renderTable();
  renderOngoingProjects();
  renderProjectRecordsTable();
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

function getAssignableStaffUsers() {
  const rows = Array.isArray(usersDb) ? usersDb : [];
  const staffRows = rows
    .filter(user => normalizeAccessRole(user.role) === 'staff')
    .filter(user => Number(user.active || 0) === 1)
    .filter(user => String(user.approval_status || 'approved').toLowerCase() !== 'rejected')
    .sort((a, b) => String(a.fullname || a.username || '').localeCompare(String(b.fullname || b.username || '')));

  if (isStaffUser() && currentUser?.id && !staffRows.some(user => Number(user.id) === Number(currentUser.id))) {
    staffRows.unshift({
      id: currentUser.id,
      fullname: currentUser.fullname,
      username: currentUser.username,
      email: currentUser.email,
      role: 'staff',
      active: 1,
      approval_status: 'approved'
    });
  }

  return staffRows;
}

async function ensureAssignableStaffUsersLoaded() {
  if (isStaffUser()) return getAssignableStaffUsers();
  if (!Array.isArray(usersDb) || !usersDb.length) {
    await loadUsers().catch(() => []);
  }
  return getAssignableStaffUsers();
}

function getUserDisplayName(user = {}) {
  return String(user.fullname || user.username || user.email || `User #${user.id || ''}`).trim();
}

function renderAssignedStaffOptions(selectedId = null) {
  const select = document.getElementById('p-assigned-to');
  if (!select) return;
  const staffUsers = getAssignableStaffUsers();
  const requestedSelectedId = Number(selectedId || 0) || 0;
  const selectedIsValidStaff = staffUsers.some(user => Number(user.id || 0) === requestedSelectedId);
  const safeSelectedId = selectedIsValidStaff ? requestedSelectedId : 0;
  const placeholder = staffUsers.length ? '<option value="">Search/select staff...</option>' : '<option value="">No active staff users</option>';
  select.innerHTML = placeholder + staffUsers.map(user => {
    const id = Number(user.id || 0);
    const label = [getUserDisplayName(user), user.email].filter(Boolean).join(' - ');
    return `<option value="${id}"${id === safeSelectedId ? ' selected' : ''}>${escHtml(label)}</option>`;
  }).join('');
  select.value = safeSelectedId ? String(safeSelectedId) : '';
  if (requestedSelectedId && !selectedIsValidStaff && !isStaffUser()) {
    setProjectFieldHint('assigned_to', 'Previous assignee is not an active approved staff user. Please select a staff account.');
  }
  select.disabled = Boolean(isStaffUser());
  select.title = isStaffUser()
    ? 'Staff-created projects are assigned to you automatically.'
    : 'Assigned staff sees this project in Project Records and Requests.';
}

// Populate the 3 Project Member dropdowns from the staff list (max 3 members).
function renderProjectMemberOptions(selectedNames = []) {
  const staffUsers = getAssignableStaffUsers();
  const names = (Array.isArray(selectedNames) ? selectedNames : []).map(n => String(n || '').trim());
  ['p-project-members', 'p-project-members-2', 'p-project-members-3'].forEach((selectId, idx) => {
    const select = document.getElementById(selectId);
    if (!select) return;
    const current = names[idx] || '';
    const options = staffUsers.map(user => {
      const label = getUserDisplayName(user);
      return `<option value="${escAttr(label)}">${escHtml(label)}</option>`;
    });
    // Keep a legacy free-text member that is not in the staff list selectable.
    if (current && !staffUsers.some(u => getUserDisplayName(u) === current)) {
      options.unshift(`<option value="${escAttr(current)}">${escHtml(current)}</option>`);
    }
    select.innerHTML = '<option value="">Select staff</option>' + options.join('');
    select.value = current;
  });
}

// Estimated Profit = Contract Amount - (Material + Labor + Other). Read-only display.
function recomputeEstimatedProfit() {
  const num = (id) => Number(document.getElementById(id)?.value || 0) || 0;
  const profit = num('p-budget') - (num('p-est-material') + num('p-est-labor') + num('p-est-other'));
  const display = document.getElementById('p-est-profit-display');
  if (display) {
    display.textContent = (typeof formatPhpCurrency === 'function') ? formatPhpCurrency(profit) : `PHP ${profit.toFixed(2)}`;
    display.style.color = profit < 0 ? '#b42318' : 'var(--accent)';
  }
}

// Re-fetch the Project No. preview for the selected business entity so the code
// updates live (PRJ_KVSK / PRJ_KITSI). New projects only — never overwrite an edit.
function refreshProjectDocnoPreview() {
  if (editingProjectId) return;
  const entityId = document.getElementById('p-business-entity-id')?.value
    || (typeof getDefaultBusinessEntityId === 'function' ? getDefaultBusinessEntityId() : '') || '';
  fetch(`/api/projects/next-docno?business_entity_id=${encodeURIComponent(entityId)}`)
    .then(res => res.json().catch(() => ({})).then(data => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      if (!ok || editingProjectId) return;
      const nextDocno = String(data?.project_docno || '').trim();
      const input = document.getElementById('p-project-docno');
      if (nextDocno && input) input.value = nextDocno;
    })
    .catch(() => {});
}

function applyPermissionMatrix() {
  const role = normalizeAccessRole(currentUser?.role);
  const canCreateDrafts = role === 'staff' || role === 'admin' || role === 'super_admin';
  const canApproveOperations = role === 'admin' || role === 'super_admin';
  const canManageSettings = role === 'super_admin';

  document.body?.classList.toggle('can-create-drafts', canCreateDrafts);
  document.body?.classList.toggle('can-approve-operations', canApproveOperations);
  document.body?.classList.toggle('can-manage-settings', canManageSettings);

  document.querySelectorAll('[data-requires-role="super_admin"]').forEach((node) => {
    node.style.display = canManageSettings ? '' : 'none';
    if ('disabled' in node) node.disabled = !canManageSettings;
  });

  document.querySelectorAll('[data-requires-approval-role="admin"]').forEach((node) => {
    node.style.display = canApproveOperations ? '' : 'none';
    if ('disabled' in node) node.disabled = !canApproveOperations;
  });

  document.querySelectorAll('[data-admin-only="1"]').forEach((node) => {
    node.style.display = canApproveOperations ? '' : 'none';
    node.setAttribute('aria-hidden', canApproveOperations ? 'false' : 'true');
    if ('disabled' in node) node.disabled = !canApproveOperations;
  });

  document.querySelectorAll('#stat-card-company-registry, #stat-card-projects, #stat-card-service-operations, #stat-card-procurement, #stat-card-inventory').forEach((node) => {
    if (!node) return;
    if (role === 'staff') {
      node.style.display = '';
      node.setAttribute('aria-hidden', 'false');
    }
  });

  document.querySelectorAll('#stat-card-ap, #stat-card-ar, #stat-card-reports').forEach((node) => {
    if (!node) return;
    const hideForStaff = role === 'staff';
    node.style.display = hideForStaff ? 'none' : '';
    node.setAttribute('aria-hidden', hideForStaff ? 'true' : 'false');
  });

  document.querySelectorAll('#stat-card-sales').forEach((node) => {
    if (!node) return;
    const hideForStaff = role === 'staff';
    node.style.display = hideForStaff ? 'none' : '';
    node.setAttribute('aria-hidden', hideForStaff ? 'true' : 'false');
  });

  const approvalCenter = document.getElementById('approval-center');
  if (approvalCenter) {
    approvalCenter.classList.toggle('is-hidden', !isAdminRoleValue(role) || currentDashboardPanel !== 'approval-center');
  }

  window.KinaadmanDashboardCards?.render(role);
  renderRoleAccessPanel(role);
}

function syncDashboardRoleLabels(roleValue = normalizeAccessRole(currentUser?.role)) {
  const role = normalizeAccessRole(roleValue || getCachedAccessRole());
  const projectLabel = document.querySelector('#stat-card-projects .stat-label');
  if (projectLabel) projectLabel.textContent = getDashboardProjectLabel(role);
}

function renderRoleAccessPanel(roleValue = normalizeAccessRole(currentUser?.role)) {
  const panel = document.getElementById('role-access-panel');
  if (!panel) return;

  const role = normalizeAccessRole(roleValue);
  const title = document.getElementById('role-access-title');
  const summary = document.getElementById('role-access-summary');
  const chips = document.getElementById('role-access-chips');
  const kicker = document.getElementById('role-access-kicker');
  const config = {
    super_admin: {
      kicker: 'Owner Access',
      title: 'Super Admin - Full System Control',
      summary: 'Can manage operating companies, users, roles, approvals, audit logs, archive, finance, reports, and all ERP modules.',
      chips: ['Company Setup', 'User Roles', 'Approvals', 'Finance', 'Audit Logs', 'Archive']
    },
    admin: {
      kicker: 'Admin Access',
      title: 'Admin - Operations and Approval Control',
      summary: 'Can manage operational records, approvals, reports, logs, and archive. Company setup and owner-level role changes remain Super Admin only.',
      chips: ['Operations', 'Approvals', 'Reports', 'Logs', 'Archive']
    },
    staff: {
      kicker: 'Staff Access',
      title: 'Staff - Daily Operations',
      summary: 'Can work inside assigned modules and track draft or submitted requests from each module. Finance totals and system settings are hidden.',
      chips: ['Project Requests', 'Service Orders', 'Purchase Requests', 'Inventory']
    },
    user: {
      kicker: 'Limited Access',
      title: 'User - Account Status',
      summary: 'Limited account access only. An admin must approve operational access before ERP modules are available.',
      chips: ['Status Only']
    }
  };
  const selected = config[role] || config.user;

  panel.dataset.roleAccess = role;
  if (kicker) kicker.textContent = selected.kicker;
  if (title) title.textContent = selected.title;
  if (summary) summary.textContent = selected.summary;
  if (chips) {
    chips.innerHTML = selected.chips.map((chip) => `<span class="role-access-chip">${escHtml(chip)}</span>`).join('');
  }
}

async function updateDeployStatusCard() {
  const card = document.getElementById('deploy-status-card');
  const label = document.getElementById('deploy-status-label');
  const detail = document.getElementById('deploy-status-detail');
  const list = document.getElementById('deploy-preflight-list');
  if (!card || !label || !detail) return;

  card.dataset.status = 'checking';
  label.textContent = 'Checking...';
  detail.textContent = 'Verifying app and database health.';
  if (list) list.innerHTML = '';

  try {
    const res = await fetch('/healthz', { cache: 'no-store', credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    const ok = res.ok && String(data.status || '').toLowerCase() === 'ok' && String(data.database || '').toLowerCase() === 'ready';
    card.dataset.status = ok ? 'ok' : 'degraded';
    label.textContent = ok ? 'Ready' : 'Needs Check';
    detail.textContent = [
      `DB: ${data.database || 'unknown'}`,
      `Env: ${data.environment || 'unknown'}`,
      `Up: ${formatUptime(Number(data.uptime || 0))}`
    ].join(' | ');
    renderDeployPreflightList(data);
  } catch (err) {
    card.dataset.status = 'degraded';
    label.textContent = 'Needs Check';
    detail.textContent = 'Health check unavailable. Verify server and database before deploy.';
    renderDeployPreflightList(null);
  }
}

function renderDeployPreflightList(data) {
  const list = document.getElementById('deploy-preflight-list');
  if (!list) return;
  if (!data) {
    list.innerHTML = '<span class="preflight-item is-bad">Health check unavailable</span>';
    return;
  }

  const checks = [
    { label: 'Database', ok: String(data.database || '').toLowerCase() === 'ready' },
    { label: 'Session', ok: String(data.session || '').toLowerCase() === 'configured' },
    { label: 'JWT', ok: String(data.jwt || '').toLowerCase() === 'configured' },
    { label: 'Email', ok: String(data.email || '').toLowerCase() === 'configured', optional: true },
    { label: `Mode: ${data.environment || 'unknown'}`, ok: true }
  ];

  list.innerHTML = checks.map(check => {
    const className = check.ok ? 'is-good' : (check.optional ? 'is-warn' : 'is-bad');
    const suffix = check.ok ? 'OK' : (check.optional ? 'Optional' : 'Check');
    return `<span class="preflight-item ${className}">${escHtml(check.label)}: ${suffix}</span>`;
  }).join('');
}

function formatUptime(seconds = 0) {
  const safeSeconds = Math.max(0, Number(seconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${Math.floor(safeSeconds)}s`;
}

async function fetchJsonOrEmpty(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json().catch(() => []);
    if (!res.ok) return [];
    return Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
  } catch (err) {
    console.error(`Unable to load ${url}:`, err);
    return [];
  }
}

function projectIsApprovalOnlyStatus(status) {
  return ['draft', 'submitted', 'pending', 'for_approval', 'for approval', 'needs_revision', 'rejected']
    .includes(String(status || '').trim().toLowerCase());
}

function projectIsWaitingForApproval(status) {
  return ['submitted', 'pending', 'for_approval', 'for approval']
    .includes(String(status || '').trim().toLowerCase());
}

function projectHiddenFromAdmin(project) {
  return isAdminUser() && projectIsApprovalOnlyStatus(project?.status);
}

function isProjectDraft(project) {
  return String(project?.status || '').trim().toLowerCase() === 'draft';
}

function isProjectNeedsRevision(project) {
  return String(project?.status || '').trim().toLowerCase() === 'needs_revision';
}

function isProjectSubmitted(project) {
  return projectIsWaitingForApproval(project?.status);
}

function isProjectPendingApproval(project) {
  return projectIsApprovalOnlyStatus(project?.status);
}

function getComputedProjectPriority(project) {
  const status = String(project?.status || '').trim().toLowerCase();
  if (projectIsApprovalOnlyStatus(status) || status === 'completed' || status === 'cancelled' || project?.actual_end_date) return 'low';

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

function computeProjectStatusFromDates({
  existingStatus = '',
  plannedEndDate = '',
  actualStartDate = '',
  actualEndDate = '',
  keepDraft = false
} = {}) {
  const current = String(existingStatus || '').trim().toLowerCase();
  if (keepDraft || current === 'draft' || current === 'submitted') return current === 'submitted' ? 'submitted' : 'draft';
  if (current === 'cancelled' || current === 'on_hold') return current;
  if (String(actualEndDate || '').trim()) return 'completed';

  const plannedEnd = toDateOnly(plannedEndDate);
  if (plannedEnd) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (today > plannedEnd) return 'overdue';
  }

  if (String(actualStartDate || '').trim()) return 'active';
  return 'planning';
}

// Seed the Projects workspace search box from ?q= / ?search= so global-search links land filtered.
function syncProjectWorkspaceSearchFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const searchValue = String(params.get('q') || params.get('search') || '').trim();
    if (!searchValue) return;
    const input = document.getElementById('project-records-search-input');
    if (!input) return;
    input.value = searchValue;
    renderProjectWorkspace();
  } catch (_) {}
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

function loadRecords() {
  const requestSeq = ++recordsLoadSeq;
  // Transactions retired (/api/transactions is now 410). The legacy records table stays
  // empty; the live dashboard data is projects, loaded by loadProjectsDashboardData().
  if (requestSeq !== recordsLoadSeq) return Promise.resolve();
  db = [];
  renderTable();
  return loadProjectsDashboardData();
}

function loadArchivedRecords() {
  const requestSeq = ++recordsLoadSeq;
  // Transactions retired — no archived transactions to load. Keep the table empty and
  // refresh the live projects dashboard.
  if (requestSeq !== recordsLoadSeq) return Promise.resolve();
  db = [];
  renderTable();
  return loadProjectsDashboardData();
}

async function loadArchiveCenter() {
  const body = document.getElementById('archive-center-body');
  if (body) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6">Loading archived records...</td></tr>';
  }

  try {
    const res = await fetch('/api/archive-center', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    archiveCenterDb = (Array.isArray(data.rows) ? data.rows : []).map((row) => ({
      type: row.type || 'Record',
      typeKey: String(row.type_key || row.typeKey || row.type || 'record').toLowerCase(),
      key: row.key || `${row.type_key || 'record'}:${row.id}`,
      id: Number(row.id || 0),
      restoreUrl: row.restore_url || row.restoreUrl || '',
      title: row.title || 'Archived record',
      party: row.party || '-',
      status: row.status || 'archived',
      date: formatDateYmd(row.date || ''),
      search: row.search || [row.type, row.title, row.party, row.status, row.date].join(' ')
    }));

    renderArchiveCenterTabs();
    renderArchiveCenter();
  } catch (err) {
    console.error('Archive center load error:', err);
    archiveCenterDb = [];
    if (body) {
      body.innerHTML = '<tr class="empty-row"><td colspan="6">Unable to load archived records.</td></tr>';
    }
    showToast(err.message || 'Unable to load archive center.', 'error');
  }
}

// Build the type tabs dynamically from whatever is actually archived (+ an "All" tab).
function renderArchiveCenterTabs() {
  const host = document.getElementById('archive-center-tabs');
  if (!host) return;
  const groups = new Map();
  (archiveCenterDb || []).forEach((row) => {
    const k = row.typeKey || 'record';
    if (!groups.has(k)) groups.set(k, { label: row.type || 'Record', count: 0 });
    groups.get(k).count += 1;
  });
  const total = (archiveCenterDb || []).length;
  if (archiveCenterActiveTab !== 'all' && !groups.has(archiveCenterActiveTab)) archiveCenterActiveTab = 'all';
  const tab = (key, label, count) =>
    `<button class="module-tab archive-center-tab ${archiveCenterActiveTab === key ? 'active' : ''}" type="button" onclick="setArchiveCenterTab('${escHtml(key)}')" aria-selected="${archiveCenterActiveTab === key}">${escHtml(label)} <span class="archive-tab-count">${count}</span></button>`;
  let html = tab('all', 'All', total);
  Array.from(groups.entries())
    .sort((a, b) => a[1].label.localeCompare(b[1].label))
    .forEach(([k, g]) => { html += tab(k, g.label, g.count); });
  host.innerHTML = html;
}

function setArchiveCenterTab(typeKey) {
  archiveCenterActiveTab = String(typeKey || 'all').toLowerCase();
  renderArchiveCenterTabs();
  renderArchiveCenter();
}

function renderArchiveCenter() {
  const body = document.getElementById('archive-center-body');
  if (!body) return;

  const query = String(document.getElementById('archive-center-search')?.value || '').trim().toLowerCase();
  const active = archiveCenterActiveTab || 'all';
  const rows = (Array.isArray(archiveCenterDb) ? archiveCenterDb : [])
    .filter((row) => {
      if (active !== 'all' && (row.typeKey || '') !== active) return false;
      if (!query) return true;
      return [row.type, row.title, row.party, row.status, row.date, row.search]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });

  if (!rows.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="6">No archived records found.</td></tr>`;
    return;
  }

  body.innerHTML = rows.map((row) => `
    <tr>
      <td><span class="archive-type-pill">${escHtml(row.type || '-')}</span></td>
      <td><strong>${escHtml(row.title || '-')}</strong></td>
      <td>${escHtml(row.party || '-')}</td>
      <td>${escHtml(row.status || 'archived')}</td>
      <td>${escHtml(row.date || '-')}</td>
      <td class="text-center">
        <button class="btn btn-restore btn-sm" type="button" onclick="restoreArchiveCenterItem('${escHtml(row.key)}')">Restore</button>
      </td>
    </tr>
  `).join('');
}

async function restoreArchiveCenterItem(key) {
  const row = (Array.isArray(archiveCenterDb) ? archiveCenterDb : []).find((entry) => entry.key === key);
  if (!row?.restoreUrl) return;
  const ok = await showConfirm(`Restore this ${row.type || 'record'} from archive?`, { title: 'Restore from Archive', confirmLabel: 'Restore', type: 'default' });
  if (!ok) return;

  try {
    const res = await fetch(row.restoreUrl, { method: 'PUT' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || 'Unable to restore record.');
    showToast(`${row.type || 'Record'} restored.`, 'success');
    await loadArchiveCenter();
    await loadProjectsDashboardData();
  } catch (err) {
    showToast(err.message || 'Unable to restore archived record.', 'error');
  }
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
  if (tab === 'users' && !isSuperAdminUser()) {
    activeTab = 'all';
    localStorage.setItem('kinaadman_activeTab', 'all');
    openDashboardPanel('home');
    showToast('Super admin lang ang may access sa user/settings management.', 'error');
    return;
  }

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
    if (pageSub) pageSub.textContent = '';
    if (mainCont) mainCont.style.maxWidth = '100%';

    if (addBtn) {
      addBtn.style.display = 'none';
      addBtn.onclick = null;
    }
    loadUsers();
    renderUsers();
  } else if (tab === 'project-records') {
    openDashboardPanel('project-records');
    if (pageTitle) pageTitle.textContent = 'Projects';
    if (pageSub) pageSub.textContent = '';
    if (mainCont) mainCont.style.maxWidth = '1400px';

    if (addBtn) {
      addBtn.textContent = isStaffUser() ? 'Request Project' : 'Add Project';
      addBtn.onclick = openProjectModal;
      addBtn.style.display = (!isAdminUser() && !isStaffUser()) ? 'none' : '';
    }
    renderProjectWorkspace();
  } else if (tab === 'archived') {
    openDashboardPanel('total-projects');
    if (pageTitle) pageTitle.textContent = tab === 'archived' ? 'Archived Transactions' : 'Transactions';
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
      addBtn.style.display = 'none';
    }
    if (tab === 'archived') {
      loadArchivedRecords();
      return;
    }
    renderTable();
  } else {
    openDashboardPanel('project-records');
    if (pageTitle) pageTitle.textContent = 'Projects';
    if (pageSub) pageSub.textContent = '';
    if (mainCont) mainCont.style.maxWidth = '1400px';

    if (addBtn) {
      addBtn.textContent = isStaffUser() ? 'Request Project' : 'Add Project';
      addBtn.onclick = openProjectModal;
      addBtn.style.display = (!isAdminUser() && !isStaffUser()) ? 'none' : '';
    }
    renderProjectWorkspace();
  }
}

function openSidebarDashboard(btn) {
  activeTab = 'all';
  localStorage.setItem('kinaadman_activeTab', 'all');
  localStorage.setItem('kinaadman_dashboardPanel', 'home');
  localStorage.setItem('kinaadman_dashboardCompany', 'all');
  void btn;
  setSidebarOpen(false);
  window.location.href = normalizeWorkspaceHref('/admin?view=dashboard');
}

function navigateDashboardCard(href) {
  const target = normalizeWorkspaceHref(href);
  if (!target) return;
  setSidebarOpen(false);
  window.location.href = target;
}

function openTotalProjectsFromDashboard() {
  navigateDashboardCard('/admin?panel=project-records');
}

function openProjectsFromDashboard() {
  navigateDashboardCard('/admin?panel=project-records');
}

function openApprovalCenterFromDashboard() {
  navigateDashboardCard('/admin?panel=approval-center');
}

function openProjectStatsModal() {
  const showModal = async () => {
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
  navigateDashboardCard('/admin?panel=project-records');
}

function updateProjectStatsModal() {
  const projects = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
    .filter((p) => Number(p.is_archived || 0) === 0)
    .filter((p) => !projectHiddenFromAdmin(p));

  const totalEl = document.getElementById('proj-stats-total');
  const ongoingEl = document.getElementById('proj-stats-ongoing');

  const ongoing = projects.filter((p) => getProjectPhase(p) === 'ongoing').length;

  if (totalEl) totalEl.textContent = String(projects.length);
  if (ongoingEl) ongoingEl.textContent = String(ongoing);
}

function openAllTransactionsFromDashboard() {
  navigateDashboardCard('/admin?panel=project-records');
}

function openReportsPanel() {
  navigateDashboardCard('/reports');
}

function openProjectsDashboard() {
  navigateDashboardCard('/admin?panel=project-records');
}

function goBackSmart(fallback = getWorkspaceHomePath(), forceFallback = false) {
  if (!forceFallback && window.history.length > 1) {
    window.history.back();
    return;
  }
  window.location.href = normalizeWorkspaceHref(fallback);
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
  if (path === '/admin' && view === 'all') return 'Back to Project Operations';

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
    let fallback =
      button.getAttribute('data-back-fallback') ||
      button.dataset.backFallback ||
      button.getAttribute('onclick')?.match(/(?:goBackSmart|window\.location\.href\s*=\s*['"])([^'"]+)/)?.[1] ||
      '';
    if (normalizeAccessRole(currentUser?.role) !== 'staff' && String(fallback || '').startsWith('/staff')) {
      fallback = '/admin?view=dashboard';
      button.setAttribute('data-back-fallback', fallback);
    }
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
  clearResetPasswordFieldMessages();
  if (modal) modal.classList.add('open');
  if (input) input.focus();
}

function closeResetPasswordModal() {
  const modal = document.getElementById('reset-pass-backdrop');
  if (modal) modal.classList.remove('open');
  resetPasswordUserId = null;
  resetPasswordUserLabel = '';
  clearResetPasswordFieldMessages();
}

function submitResetPasswordModal() {
  const password = document.getElementById('reset-pass-input')?.value || '';
  const confirm = document.getElementById('reset-pass-confirm')?.value || '';
  clearResetPasswordFieldMessages();

  if (resetPasswordUserId === null || resetPasswordUserId === undefined) {
    return showToast('No user selected for password reset.', 'error');
  }

  if (password.length < 8) {
    setResetPasswordFieldMessage('password', 'Password must be at least 8 characters.');
    focusFirstModalControl(['reset-pass-input']);
    return;
  }

  if (password !== confirm) {
    setResetPasswordFieldMessage('confirm', 'Passwords do not match.');
    focusFirstModalControl(['reset-pass-confirm']);
    return;
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
      const errorText = String(err?.message || '').toLowerCase();
      if (errorText.includes('password')) {
        setResetPasswordFieldMessage('password', err.message || 'Unable to reset password.');
        focusFirstModalControl(['reset-pass-input']);
        return;
      }
      showToast(err.message || 'Unable to reset password.', 'error');
    });
}

function openProjectInTotalProjects(searchValue) {
  const targetSearch = String(searchValue || '').trim();

  if (!document.getElementById('project-records-section')) {
    const url = new URL('/admin', window.location.origin);
    url.searchParams.set('panel', 'project-records');
    if (targetSearch) {
      url.searchParams.set('search', targetSearch);
    }
    window.location.href = url.toString();
    return;
  }

  openDashboardPanel('project-records');
  currentPage = 1;

  const searchInput = document.getElementById('project-records-search-input');
  if (searchInput) searchInput.value = targetSearch;
  renderProjectWorkspace();
  setSidebarOpen(false);
}

function switchProjectFormTab(tabName = 'details') {
  const activeTab = String(tabName || 'details');
  const tabs = document.querySelectorAll('[data-project-form-tab]');
  const panels = document.querySelectorAll('[data-project-form-panel]');

  tabs.forEach((tab) => {
    const isActive = tab.dataset.projectFormTab === activeTab;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  panels.forEach((panel) => {
    const isActive = panel.dataset.projectFormPanel === activeTab;
    panel.classList.toggle('active', isActive);
    panel.hidden = !isActive;
  });
}

function getProjectFormTabForField(fieldName) {
  const dateFields = ['planned_start_date', 'planned_end_date', 'actual_start_date', 'actual_end_date', 'status_reason'];
  const financialFields = ['budget', 'downpayment', 'checkno', 'pono', 'estimated_material_cost', 'estimated_labor_cost', 'estimated_other_cost'];
  const memberFields = ['project_members', 'member_role', 'member_phone', 'project_members_2', 'member_role_2', 'member_phone_2', 'project_members_3', 'member_role_3', 'member_phone_3'];
  if (dateFields.includes(fieldName)) return 'dates';
  if (financialFields.includes(fieldName)) return 'financials';
  if (memberFields.includes(fieldName)) return 'members';
  return 'details';
}

function focusProjectFieldOnTab(fieldName, controlIds = []) {
  switchProjectFormTab(getProjectFormTabForField(fieldName));
  focusFirstModalControl(controlIds);
}

const PROJECT_TEAM_ROWS = [
  { row: 1, name: 'p-project-members', role: 'p-member-role', phone: 'p-member-phone' },
  { row: 2, name: 'p-project-members-2', role: 'p-member-role-2', phone: 'p-member-phone-2' },
  { row: 3, name: 'p-project-members-3', role: 'p-member-role-3', phone: 'p-member-phone-3' }
];

function getProjectTeamRowConfig(rowNumber) {
  const safeRow = Number(rowNumber) || 1;
  return PROJECT_TEAM_ROWS.find(entry => entry.row === safeRow) || PROJECT_TEAM_ROWS[0];
}

function getProjectTeamRowFields(rowNumber) {
  const config = getProjectTeamRowConfig(rowNumber);
  return [config.name, config.role, config.phone]
    .map(id => document.getElementById(id))
    .filter(Boolean);
}

function projectTeamRowHasValue(rowNumber) {
  return getProjectTeamRowFields(rowNumber).some(field => String(field.value || '').trim());
}

function setProjectTeamRowVisible(rowNumber, visible, { clear = false } = {}) {
  const row = Number(rowNumber) || 1;
  document.querySelectorAll(`[data-project-team-row="${row}"]`).forEach((node) => {
    node.hidden = !visible;
  });

  if (clear) {
    getProjectTeamRowFields(row).forEach((field) => {
      field.value = '';
    });
  }
}

function getVisibleProjectTeamRowCount() {
  return PROJECT_TEAM_ROWS.reduce((count, entry) => {
    const firstNode = document.querySelector(`[data-project-team-row="${entry.row}"]`);
    return count + (firstNode && !firstNode.hidden ? 1 : 0);
  }, 0);
}

function syncProjectTeamControls() {
  const addBtn = document.getElementById('project-add-team-member-btn');
  if (!addBtn) return;
  const visibleCount = getVisibleProjectTeamRowCount();
  addBtn.style.display = visibleCount >= PROJECT_TEAM_ROWS.length ? 'none' : '';
  addBtn.textContent = visibleCount <= 1 ? 'Add Member' : `Add Member ${visibleCount + 1}`;
}

function syncProjectTeamRowsFromValues() {
  let lastRowWithValue = 1;
  PROJECT_TEAM_ROWS.forEach((entry) => {
    if (projectTeamRowHasValue(entry.row)) lastRowWithValue = entry.row;
  });

  PROJECT_TEAM_ROWS.forEach((entry) => {
    setProjectTeamRowVisible(entry.row, entry.row <= lastRowWithValue);
  });
  syncProjectTeamControls();
}

function addProjectTeamMember() {
  const nextRow = PROJECT_TEAM_ROWS.find((entry) => {
    const firstNode = document.querySelector(`[data-project-team-row="${entry.row}"]`);
    return firstNode && firstNode.hidden;
  });
  if (!nextRow) return;

  setProjectTeamRowVisible(nextRow.row, true);
  syncProjectTeamControls();
  const nameField = document.getElementById(nextRow.name);
  if (nameField) nameField.focus();
}

function setProjectRoleValue(id, value) {
  const select = document.getElementById(id);
  if (!select) return;

  const roleValue = String(value || '').trim();
  if (!roleValue) {
    select.value = '';
    return;
  }

  const hasOption = Array.from(select.options || []).some(option => option.value === roleValue);
  if (!hasOption) {
    const option = document.createElement('option');
    option.value = roleValue;
    option.textContent = roleValue;
    select.appendChild(option);
  }
  select.value = roleValue;
}

async function openProjectModal(projectId = null) {
  editingProjectId = Number(projectId) || null;
  const modal = document.getElementById('project-modal-backdrop');
  const title = document.getElementById('project-modal-title');
  const saveBtn = document.getElementById('project-save-btn');
  const submitBtn = document.getElementById('project-submit-btn');
  const today = new Date().toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const project = editingProjectId
    ? (projectsDashboardDb || []).find(entry => Number(entry.id) === Number(editingProjectId))
    : null;
  const projectData = project || {};
  await ensureAssignableStaffUsersLoaded();

  if (modal) {
    modal.classList.add('open');
    modal.style.display = 'flex';
  }

  if (title) {
    title.textContent = isStaffUser()
      ? (project ? 'Edit Project Request' : 'Request Project')
      : (project ? 'Edit Project' : 'Create Project');
  }
  const projectStatus = String(projectData.status || '').trim().toLowerCase();
  const canStaffEditProject = !isStaffUser() || !project || projectStatus === 'draft';
  const canStaffSubmitProject = isStaffUser() && !!project && projectStatus === 'draft';
  if (saveBtn) {
    saveBtn.textContent = isStaffUser()
      ? (project ? 'Update Request Draft' : 'Save Request Draft')
      : (project ? 'Update Project' : 'Create Project');
    saveBtn.style.display = canStaffEditProject ? '' : 'none';
    saveBtn.disabled = !canStaffEditProject;
  }
  if (submitBtn) {
    submitBtn.textContent = isStaffUser() ? 'Submit Request' : 'Submit for Approval';
    submitBtn.style.display = canStaffSubmitProject ? '' : 'none';
    submitBtn.disabled = !canStaffSubmitProject;
  }
  switchProjectFormTab('details');
  clearProjectFieldMessages();
  setProjectModalNotice('');

  try {
    document.getElementById('p-project-name').value = projectData.project_name || '';
    const projectDocNoInput = document.getElementById('p-project-docno');
    if (projectDocNoInput) projectDocNoInput.value = String(projectData.draft_docno || projectData.project_docno || '').trim();
    populateBusinessEntitySelect('p-business-entity-id', projectData.business_entity_id || '');
    setProjectModalValue('p-project-manager', projectData.project_manager || '');
    const selectedAssignee = Number(projectData.assigned_to || 0) || (isStaffUser() ? Number(currentUser?.id || 0) : 0);
    renderAssignedStaffOptions(selectedAssignee);
    const statusInput = document.getElementById('p-status');
    const statusValue = isStaffUser()
      ? (project ? (projectData.status || 'draft') : 'draft')
      : (projectData.status || (project ? 'active' : 'planning'));
    setProjectModalValue('p-status', statusValue);
    if (statusInput) {
      const statusField = statusInput.closest('.field');
      if (statusField) statusField.style.display = 'none';
      statusInput.disabled = false;
      statusInput.title = isStaffUser()
        ? 'Staff projects can only be saved as Draft or submitted for Admin approval.'
        : 'Status is computed automatically from planned and actual dates.';
    }
    const priorityInput = document.getElementById('p-priority');
    setProjectModalValue('p-priority', getComputedProjectPriority(projectData));
    if (priorityInput) {
      const priorityField = priorityInput.closest('.field');
      if (priorityField) priorityField.style.display = 'none';
      priorityInput.disabled = true;
    }
    setProjectModalValue('p-description', projectData.description || '');
    setProjectModalValue('p-budget', Number(projectData.budget || 0) > 0 ? Number(projectData.budget || 0).toFixed(2) : '');
    setProjectModalValue('p-service-type', String(projectData.service_type || 'installation').toLowerCase());
    setProjectModalValue('p-project-location', projectData.project_location || '');
    setProjectModalValue('p-est-material', Number(projectData.estimated_material_cost || 0) > 0 ? Number(projectData.estimated_material_cost || 0).toFixed(2) : '');
    setProjectModalValue('p-est-labor', Number(projectData.estimated_labor_cost || 0) > 0 ? Number(projectData.estimated_labor_cost || 0).toFixed(2) : '');
    setProjectModalValue('p-est-other', Number(projectData.estimated_other_cost || 0) > 0 ? Number(projectData.estimated_other_cost || 0).toFixed(2) : '');
    setProjectModalValue('p-project-members', projectData.project_members || '');
    setProjectRoleValue('p-member-role', projectData.member_role || '');
    setProjectModalValue('p-member-phone', projectData.member_phone || '');
    setProjectModalValue('p-project-members-2', projectData.project_members_2 || '');
    setProjectRoleValue('p-member-role-2', projectData.member_role_2 || '');
    setProjectModalValue('p-member-phone-2', projectData.member_phone_2 || '');
    setProjectModalValue('p-project-members-3', projectData.project_members_3 || '');
    setProjectRoleValue('p-member-role-3', projectData.member_role_3 || '');
    setProjectModalValue('p-member-phone-3', projectData.member_phone_3 || '');
    syncProjectTeamRowsFromValues();
    recomputeEstimatedProfit();
    currentProjectStartDate = formatDateInputValue(projectData.planned_start_date || projectData.start_date || '');
    currentProjectEndDate = formatDateInputValue(projectData.planned_end_date || projectData.end_date || '');
    populateProjectCompanySelect(projectData.company_id || projectData.registry_company_id || projectData.company_no || projectData.company_name || projectData.client_name || '');
    const startDateInput = document.getElementById('p-planned-start-date');
    const endDateInput = document.getElementById('p-planned-end-date');
    currentProjectStartDate = project ? (currentProjectStartDate || '') : today;
    currentProjectEndDate = project ? (currentProjectEndDate || '') : nextMonth;
    if (startDateInput) startDateInput.value = currentProjectStartDate || '';
    if (endDateInput) endDateInput.value = currentProjectEndDate || '';
    setProjectModalValue('p-actual-start-date', formatDateInputValue(projectData.actual_start_date || ''));
    setProjectModalValue('p-actual-end-date', formatDateInputValue(projectData.actual_end_date || ''));
    setProjectModalValue('p-status-reason', projectData.status_reason || '');
    updateProjectPaymentDisplay();
    const hasCompanyOptions = getRegistryCompanyEntries().length > 0;
    if (!hasCompanyOptions) {
      setProjectFieldMessage('company', 'No companies available yet. Please add a company in Company Registry first.');
      if (saveBtn) saveBtn.disabled = true;
      if (submitBtn) submitBtn.disabled = true;
    } else if (saveBtn) {
      saveBtn.disabled = !canStaffEditProject;
      if (submitBtn) submitBtn.disabled = !canStaffSubmitProject;
    }
    if (isStaffUser()) {
      if (!project) {
        setProjectModalNotice('Project requests are saved as Draft and require Admin or Super Admin approval.');
      } else if (projectStatus === 'submitted') {
        setProjectModalNotice('This project request is already submitted and waiting for Admin approval.');
      } else if (!canStaffEditProject) {
        setProjectModalNotice('This project request is no longer editable.');
      }
    }
    if (!project) {
      fetch(`/api/projects/next-docno?business_entity_id=${encodeURIComponent(getCurrentBusinessEntityId() || getDefaultBusinessEntityId() || '')}`)
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
  switchProjectFormTab('details');
  clearProjectFieldMessages();
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
    if (typeof window.showConfirm === 'function') {
      return window.showConfirm(String(message || ''), { title: String(title || 'Confirm Action'), confirmLabel: String(yesText || 'Yes'), cancelLabel: String(noText || 'No') });
    }
    return Promise.resolve(window.confirm(String(message || title || 'Are you sure?')));
  }

  if (confirmDialogState.resolver) {
    const pending = confirmDialogState.resolver;
    confirmDialogState.resolver = null;
    pending(false);
  }

  titleEl.textContent = title;
  messageEl.textContent = message;
  messageEl.style.whiteSpace = 'pre-line';
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
  // Validation feedback now uses the system toast (bottom-right, error style) instead of the old
  // in-modal pink box — keep the legacy box hidden.
  const notice = document.getElementById('project-modal-notice');
  if (notice) { notice.textContent = ''; notice.classList.add('is-hidden'); }
  const text = String(message || '').trim();
  if (text && typeof showToast === 'function') showToast(text, 'error');
}

function getProjectFieldMessageNode(fieldName) {
  return document.querySelector(`[data-project-field-message="${fieldName}"]`);
}

function getProjectFieldNodes(fieldName) {
  const map = {
    company: ['p-company-search', 'p-company-id'],
    project_docno: ['p-project-docno'],
    project_name: ['p-project-name'],
    project_manager: ['p-project-manager'],
    assigned_to: ['p-assigned-to'],
    planned_start_date: ['p-planned-start-date'],
    planned_end_date: ['p-planned-end-date'],
    actual_start_date: ['p-actual-start-date'],
    actual_end_date: ['p-actual-end-date'],
    description: ['p-description'],
    budget: ['p-budget'],
    downpayment: ['p-downpayment'],
    project_members: ['p-project-members'],
    member_role: ['p-member-role'],
    member_phone: ['p-member-phone']
  };

  return (map[fieldName] || [])
    .map((id) => document.getElementById(id))
    .filter(Boolean);
}

function setProjectFieldMessage(fieldName, message = '') {
  const notice = getProjectFieldMessageNode(fieldName);
  const text = String(message || '').trim();
  const field = notice?.closest('.field') || null;

  if (notice) {
    notice.textContent = text;
    notice.classList.toggle('is-hidden', !text);
  }

  if (field) {
    field.classList.toggle('has-error', !!text);
  }

  getProjectFieldNodes(fieldName).forEach((node) => {
    node.setAttribute('aria-invalid', text ? 'true' : 'false');
  });
}

function setProjectFieldHint(fieldName, message = '') {
  const notice = getProjectFieldMessageNode(fieldName);
  const text = String(message || '').trim();
  const field = notice?.closest('.field') || null;

  if (notice) {
    notice.textContent = text;
    notice.classList.toggle('is-hidden', !text);
  }

  if (field) {
    field.classList.remove('has-error');
  }

  getProjectFieldNodes(fieldName).forEach((node) => {
    node.setAttribute('aria-invalid', 'false');
  });
}

function clearProjectFieldMessages() {
  ['company', 'project_docno', 'project_name', 'project_manager', 'assigned_to', 'planned_start_date', 'planned_end_date', 'actual_start_date', 'actual_end_date', 'description', 'budget', 'downpayment', 'project_members', 'member_role', 'member_phone'].forEach((fieldName) => {
    setProjectFieldMessage(fieldName, '');
  });
}

function setupProjectModalValidationListeners() {
  const bindings = [
    ['p-company-search', 'company', 'input', () => {
      filterProjectCompanies();
    }],
    ['p-project-name', 'project_name', 'input'],
    ['p-project-manager', 'project_manager', 'input'],
    ['p-assigned-to', 'assigned_to', 'change'],
    ['p-planned-start-date', 'planned_start_date', 'change'],
    ['p-planned-end-date', 'planned_end_date', 'change'],
    ['p-actual-start-date', 'actual_start_date', 'change'],
    ['p-actual-end-date', 'actual_end_date', 'change'],
    ['p-description', 'description', 'input'],
    ['p-budget', 'budget', 'input'],
    ['p-downpayment', 'downpayment', 'input'],
    ['p-project-members', 'project_members', 'input'],
    ['p-member-role', 'member_role', 'change'],
    ['p-member-phone', 'member_phone', 'input']
  ];

  bindings.forEach(([id, fieldName, eventName, onChange]) => {
    const node = document.getElementById(id);
    if (!node || node.dataset.projectValidationBound === '1') return;
    node.dataset.projectValidationBound = '1';
    node.addEventListener(eventName, () => {
      setProjectFieldMessage(fieldName, '');
      if (typeof onChange === 'function') onChange();
    });
  });
}

async function saveProject(submitAction = 'draft') {
  clearProjectFieldMessages();
  setProjectModalNotice('');
  const projectSubmitAction = String(submitAction || 'draft').trim().toLowerCase() === 'submit' ? 'submit' : 'draft';

  const projectName = document.getElementById('p-project-name').value.trim();
  const existingProject = editingProjectId
    ? (projectsDashboardDb || []).find(entry => Number(entry.id) === Number(editingProjectId))
    : null;
  const projectDocNoValue = String(document.getElementById('p-project-docno')?.value || '').trim() || String(existingProject?.draft_docno || existingProject?.project_docno || '').trim();
  const businessEntitySelect = document.getElementById('p-business-entity-id');
  const businessEntityId = businessEntitySelect?.value || getDefaultBusinessEntityId() || '';
  if (businessEntitySelect) businessEntitySelect.value = businessEntityId;
  const companyId = Number(getProjectCompanyInputValue() || 0) || 0;
  const companyRecord = findRegistryCompanyById(companyId);
  const companyNo = String(companyRecord?.company_no || existingProject?.company_no || '').trim();
  const companyName = getProjectCompanyNameFromSelection(companyId) || String(existingProject?.company_name || existingProject?.client_name || '').trim();
  const plannedStartDate = document.getElementById('p-planned-start-date')?.value || currentProjectStartDate || '';
  const plannedEndDate = document.getElementById('p-planned-end-date')?.value || currentProjectEndDate || '';
  const actualStartDate = document.getElementById('p-actual-start-date')?.value || '';
  const actualEndDate = document.getElementById('p-actual-end-date')?.value || '';
  const currentStatus = String(existingProject?.status || '').trim().toLowerCase();
  if (isStaffUser() && existingProject && !['draft', 'needs_revision'].includes(currentStatus)) {
    setProjectModalNotice(
      currentStatus === 'submitted'
        ? 'This project is already submitted and waiting for Admin approval.'
        : 'This project is no longer editable from the staff project records.'
    );
    showToast('Staff can only edit draft project requests.', 'error');
    return null;
  }
  let status = computeProjectStatusFromDates({
    existingStatus: existingProject?.status || '',
    plannedEndDate,
    actualStartDate,
    actualEndDate,
    keepDraft: (!existingProject && isStaffUser()) || currentStatus === 'draft' || currentStatus === 'submitted'
  });
  if (!isStaffUser() && (!existingProject || currentStatus === 'draft' || currentStatus === 'submitted')) {
    status = projectSubmitAction === 'submit' ? 'submitted' : 'draft';
  }
  const projectPriority = getComputedProjectPriority({
    ...existingProject,
    status,
    planned_end_date: plannedEndDate,
    end_date: plannedEndDate,
    actual_end_date: actualEndDate
  });
  const projectManager = String(document.getElementById('p-project-manager')?.value || '').trim();
  const assignedToSelect = document.getElementById('p-assigned-to');
  const assignedTo = Number(assignedToSelect?.value || (isStaffUser() ? currentUser?.id : 0) || 0) || 0;
  const description = String(document.getElementById('p-description')?.value || '').trim();
  const statusReason = String(document.getElementById('p-status-reason')?.value || '').trim();
  const checkNo = '';
  const customerPoRef = '';
  const budgetValue = Number(document.getElementById('p-budget')?.value || 0) || 0;
  const downpaymentValue = Number(document.getElementById('p-downpayment')?.value || 0) || 0;
  const teamFields = {
    project_members: String(document.getElementById('p-project-members')?.value || '').trim(),
    member_role: String(document.getElementById('p-member-role')?.value || '').trim(),
    member_phone: String(document.getElementById('p-member-phone')?.value || '').trim(),
    project_members_2: String(document.getElementById('p-project-members-2')?.value || '').trim(),
    member_role_2: String(document.getElementById('p-member-role-2')?.value || '').trim(),
    member_phone_2: String(document.getElementById('p-member-phone-2')?.value || '').trim(),
    project_members_3: String(document.getElementById('p-project-members-3')?.value || '').trim(),
    member_role_3: String(document.getElementById('p-member-role-3')?.value || '').trim(),
    member_phone_3: String(document.getElementById('p-member-phone-3')?.value || '').trim()
  };
  const hasCompanyOptions = getRegistryCompanyEntries().length > 0;
  let firstInvalidField = null;
  const markProjectError = (fieldName, message) => {
    setProjectFieldMessage(fieldName, message);
    if (!firstInvalidField) firstInvalidField = fieldName;
  };

  const rawBudgetValue = String(document.getElementById('p-budget')?.value || '').trim();
  const serviceType = String(document.getElementById('p-service-type')?.value || '').trim();
  const projectLocation = String(document.getElementById('p-project-location')?.value || '').trim();
  const rawEstMaterial = String(document.getElementById('p-est-material')?.value || '').trim();
  const rawEstLabor = String(document.getElementById('p-est-labor')?.value || '').trim();
  const rawEstOther = String(document.getElementById('p-est-other')?.value || '').trim();
  const missingProjectFields = [];
  const requireProjectField = (fieldName, missing, message, label) => {
    if (!missing) return;
    missingProjectFields.push(label);
    markProjectError(fieldName, message);
  };

  // Validate in tab order (Details -> Dates -> Financials -> Members) so the first
  // missing field jumps to the earliest tab and the user fills them in sequence.
  // Every field is required EXCEPT Actual Start/End dates.
  // -- Details --
  requireProjectField('project_name', !projectName, 'Project name is required.', 'Project Name');
  requireProjectField('business_entity_id', !businessEntityId, 'Business entity is required.', 'Business Entity');
  requireProjectField('company', !companyId, hasCompanyOptions ? 'Type an exact company no/name, or a search with one match.' : 'No companies available yet. Please add a company in Company Registry first.', 'Company');
  requireProjectField('service_type', !serviceType, 'Service type is required.', 'Service Type');
  requireProjectField('assigned_to', !assignedTo, 'Assigned staff is required.', 'Assigned Staff');
  requireProjectField('project_location', !projectLocation, 'Project location is required.', 'Project Location');
  requireProjectField('description', !description, 'Description is required.', 'Description');
  // -- Dates --
  requireProjectField('planned_start_date', !plannedStartDate, 'Planned start date is required.', 'Planned Start Date');
  requireProjectField('planned_end_date', !plannedEndDate, 'Planned end date is required.', 'Planned End Date');
  // -- Financials --
  requireProjectField('budget', !rawBudgetValue || budgetValue <= 0, 'Contract amount is required and must be greater than zero.', 'Contract Amount');
  requireProjectField('estimated_material_cost', !rawEstMaterial, 'Estimated material cost is required.', 'Estimated Material Cost');
  requireProjectField('estimated_labor_cost', !rawEstLabor, 'Estimated labor cost is required.', 'Estimated Labor Cost');
  requireProjectField('estimated_other_cost', !rawEstOther, 'Estimated other cost is required.', 'Estimated Other Cost');
  // -- Members --
  requireProjectField('project_members', !teamFields.project_members, 'Member 1 name is required.', 'Member 1 Name');
  requireProjectField('member_role', !teamFields.member_role, 'Member 1 role is required.', 'Member 1 Role');
  requireProjectField('member_phone', !teamFields.member_phone, 'Member 1 phone is required.', 'Member 1 Phone');

  if (missingProjectFields.length) {
    setProjectModalNotice(`Complete all project information before saving: ${missingProjectFields.join(', ')}.`);
    const projectFieldFocusMap = {
      project_name: ['p-project-name'],
      company: ['p-company-search'],
      business_entity_id: ['p-business-entity-id'],
      service_type: ['p-service-type'],
      assigned_to: ['p-assigned-to'],
      project_members: ['p-project-members'],
      member_role: ['p-member-role'],
      member_phone: ['p-member-phone'],
      project_location: ['p-project-location'],
      description: ['p-description'],
      planned_start_date: ['p-planned-start-date'],
      planned_end_date: ['p-planned-end-date'],
      budget: ['p-budget'],
      estimated_material_cost: ['p-est-material'],
      estimated_labor_cost: ['p-est-labor'],
      estimated_other_cost: ['p-est-other']
    };
    focusProjectFieldOnTab(firstInvalidField, projectFieldFocusMap[firstInvalidField] || []);
    return;
  }

  if (plannedEndDate < plannedStartDate) {
    setProjectFieldMessage('planned_end_date', 'End date must be later than or equal to start date.');
    focusProjectFieldOnTab('planned_end_date', ['p-planned-end-date']);
    return;
  }

  if (actualStartDate && actualEndDate && actualEndDate < actualStartDate) {
    setProjectFieldMessage('actual_end_date', 'Actual end must be later than or equal to actual start.');
    focusProjectFieldOnTab('actual_end_date', ['p-actual-end-date']);
    return;
  }

  if (budgetValue < 0 || downpaymentValue < 0) {
    setProjectFieldMessage('budget', 'Financial values cannot be negative.');
    focusProjectFieldOnTab('budget', ['p-budget']);
    return;
  }

  if (!companyRecord) {
    setProjectFieldMessage('company', 'Type an exact company no/name, or a search with one match.');
    focusProjectFieldOnTab('company', ['p-company-search']);
    return;
  }

  currentProjectStartDate = plannedStartDate;
  currentProjectEndDate = plannedEndDate;

  const isEdit = Boolean(editingProjectId);
  const url = isEdit ? `/api/projects/${editingProjectId}` : '/api/projects';
  const method = isEdit ? 'PUT' : 'POST';
  const saveBtn = document.getElementById('project-save-btn');
  const submitBtn = document.getElementById('project-submit-btn');
  if (saveBtn) saveBtn.disabled = true;
  if (submitBtn) submitBtn.disabled = true;

  const formData = new FormData();
  formData.append('project_name', projectName);
  formData.append('project_docno', projectDocNoValue);
  formData.append('business_entity_id', businessEntityId);
  formData.append('status', status);
  formData.append('project_submit_action', projectSubmitAction);
  formData.append('priority', projectPriority);
  formData.append('company_id', companyId || '');
  formData.append('company_no', companyNo || '');
  formData.append('company_name', companyName || '');
  formData.append('client_name', companyName || '');
  formData.append('description', description);
  formData.append('project_manager', projectManager);
  formData.append('assigned_to', assignedTo || '');
  formData.append('checkno', checkNo);
  formData.append('pono', customerPoRef);
  formData.append('budget', budgetValue || 0);
  formData.append('downpayment', downpaymentValue || 0);
  formData.append('qty', 0);
  formData.append('unit_cost', 0);
  formData.append('start_date', plannedStartDate);
  formData.append('end_date', plannedEndDate);
  formData.append('planned_start_date', plannedStartDate);
  formData.append('planned_end_date', plannedEndDate);
  formData.append('actual_start_date', actualStartDate);
  formData.append('actual_end_date', actualEndDate);
  formData.append('status_reason', statusReason);
  formData.append('project_members', teamFields.project_members);
  formData.append('member_role', teamFields.member_role);
  formData.append('member_phone', teamFields.member_phone);
  formData.append('project_members_2', teamFields.project_members_2);
  formData.append('member_role_2', teamFields.member_role_2);
  formData.append('member_phone_2', teamFields.member_phone_2);
  formData.append('project_members_3', teamFields.project_members_3);
  formData.append('member_role_3', teamFields.member_role_3);
  formData.append('member_phone_3', teamFields.member_phone_3);
  formData.append('service_type', serviceType);
  formData.append('project_location', projectLocation);
  formData.append('estimated_material_cost', Number(document.getElementById('p-est-material')?.value || 0) || 0);
  formData.append('estimated_labor_cost', Number(document.getElementById('p-est-labor')?.value || 0) || 0);
  formData.append('estimated_other_cost', Number(document.getElementById('p-est-other')?.value || 0) || 0);

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
    const savedStatus = String(data?.status || '').toLowerCase();
    const draftSaved = savedStatus === 'draft';
    const submittedForApproval = savedStatus === 'submitted' || data?.requiresApproval;
    const staffDestination = projectIsApprovalOnlyStatus(savedStatus)
      ? 'Staff Requests'
      : 'Staff Project Records';
    showToast(
      submittedForApproval
        ? 'Project submitted for approval.'
        : draftSaved
        ? 'Project saved as Draft. Submit it when ready for approval.'
        : isStaffUser()
          ? (isEdit ? 'Project request updated successfully.' : 'Project request saved successfully.')
          : `${isEdit ? 'Project record updated' : 'Project record created'} successfully. Assigned staff will see it in ${staffDestination}.`,
      'success'
    );
    return data;
  } catch (err) {
    const errorText = String(err?.message || '').toLowerCase();
    let handled = false;
    if (errorText.includes('same company') || errorText.includes('same project') || errorText.includes('same title')) {
      const duplicateMessage = err.message || 'A project with the same company, title, start date, and end date already exists.';
      setProjectFieldMessage('project_name', duplicateMessage);
      setProjectFieldMessage('company', duplicateMessage);
      setProjectFieldMessage('planned_start_date', duplicateMessage);
      setProjectFieldMessage('planned_end_date', duplicateMessage);
      focusProjectFieldOnTab('project_name', ['p-project-name']);
      handled = true;
    } else if (errorText.includes('duplicate') || errorText.includes('already exists')) {
      setProjectFieldMessage('project_docno', 'Project No. already exists. Please refresh and try again.');
      focusProjectFieldOnTab('project_docno', ['p-project-docno']);
      handled = true;
    } else if (errorText.includes('company is required') || errorText.includes('selected company')) {
      setProjectFieldMessage('company', err.message || 'Type an exact company no/name, or a search with one match.');
      focusProjectFieldOnTab('company', ['p-company-search']);
      handled = true;
    }
    if (!handled) {
      showToast(err.message || 'Unable to save project.', 'error');
    }
    return null;
  } finally {
    if (saveBtn) saveBtn.disabled = false;
    if (submitBtn) submitBtn.disabled = false;
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
    const toggle = group.querySelector('.sidebar-group-toggle');
    if (!toggle) return;

    group.classList.add('is-collapsed');
    toggle.setAttribute('aria-expanded', 'false');
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
      r.service_order_no || '',
      r.service_order_title || '',
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
    const entityMatch = businessEntityMatches(r);
    const companyMatch = companyFilter === 'all' || companyMatchesDashboardFilter(getTransactionCompanyName(r));
    return tabMatch && searchMatch && statusMatch && entityMatch && companyMatch;
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

function renderUsers() {
  const tbody = document.getElementById('table-body');
  const thead = document.querySelector('thead tr');
  if (!tbody || !thead) return;
  const searchInput = document.getElementById('search-input');
  const q = (searchInput?.value || '').trim().toLowerCase();
  const exportRecordsActions = document.getElementById('export-records-actions');
  const projectStatusFilter = document.getElementById('project-status-filter');
  const userControls = document.getElementById('user-controls');
  const userRoleFilter = document.getElementById('user-role-filter');
  const userStatusFilter = document.getElementById('user-status-filter');

  if (projectStatusFilter) projectStatusFilter.style.display = 'none';
  if (exportRecordsActions) exportRecordsActions.style.display = 'none';
  if (userControls) userControls.style.display = 'inline-flex';
  if (searchInput) searchInput.placeholder = 'Search users by name, email, or role...';
  
  thead.innerHTML = `
    <th style="padding:15px">Full Name</th><th>Email</th><th class="text-center">Role</th><th class="text-center">Status</th><th class="text-center">Last Login</th><th class="text-center">Actions</th>
  `;

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
    const roleOk = roleFilter === 'all' || String(u.role || '') === roleFilter;
    const statusValue = getUserApprovalStatus(u);
    const statusOk = statusFilter === 'all' || statusValue === statusFilter;
    return roleOk && statusOk;
  });

  if (!scopedUsers.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Walang users na nahanap.</td></tr>';
    return;
  }

  tbody.innerHTML = scopedUsers.map(u => {
    const isSelf = Number(u.id) === Number(currentUser?.id || 0);
    const canManageTarget = canCurrentUserManageUser(u);
    const editAttrs = canManageTarget ? `onclick="editUser(${u.id})"` : 'disabled title="Only Super Admin can edit admin or super admin accounts."';
    const toggleAttrs = isSelf
      ? 'disabled title="Hindi puwedeng baguhin ang sarili mong account status."'
      : (canManageTarget ? `onclick="toggleUser(${u.id})"` : 'disabled title="Only Super Admin can enable or disable admin/super admin accounts."');
    const deleteAttrs = isSelf
      ? 'disabled title="Hindi puwedeng i-delete ang sarili mong account."'
      : (canManageTarget ? `onclick="deleteUser(${u.id})"` : 'disabled title="Only Super Admin can delete admin/super admin accounts."');
    const approvalStatus = getUserApprovalStatus(u);
    const statusLabel = approvalStatus === 'pending'
      ? 'Pending'
      : (approvalStatus === 'rejected' ? 'Rejected' : (u.active ? 'Active' : 'Inactive'));
    const statusClass = approvalStatus === 'pending'
      ? 'status-upcoming'
      : (approvalStatus === 'rejected' ? 'status-cancelled' : (u.active ? 'status-active' : 'status-inactive'));
    const safeRole = normalizeAccessRole(u.role);
    const roleColor = safeRole === 'super_admin'
      ? { bg: '#e0f2fe', fg: '#075985' }
      : (safeRole === 'admin'
        ? { bg: '#fee2e2', fg: '#991b1b' }
        : (safeRole === 'staff' ? { bg: '#fef3c7', fg: '#92400e' } : { bg: '#eef2ff', fg: '#3355cc' }));
    const lastLogin = u.last_login
      ? {
          date: new Date(u.last_login).toLocaleDateString('en-PH', {
            year: 'numeric',
            month: 'short',
            day: '2-digit'
          }),
          time: new Date(u.last_login).toLocaleTimeString('en-PH', {
            hour: '2-digit',
            minute: '2-digit'
          })
        }
      : null;

    return `
      <tr style="height: 70px;">
        <td style="padding: 15px 20px; font-size: 0.95rem;"><strong>${highlight(u.fullname || '', q)}</strong></td>
        <td style="padding: 15px 20px; font-size: 0.9rem; color: var(--text);">${highlight(u.email || '—', q)}</td>
        <td class="text-center" style="padding: 15px 20px; font-size: 0.95rem;"><span class="admin-badge" data-role="${safeRole}" style="background:${roleColor.bg}; color:${roleColor.fg}">${highlight(safeRole.replace('_', ' '), q)}</span></td>
        <td class="text-center" style="padding: 15px 20px; font-size: 0.95rem;"><span class="status-pill ${statusClass}">${statusLabel}</span></td>
        <td class="text-center" style="padding: 15px 20px; font-size: 0.8rem; color: var(--muted); white-space: nowrap;">
          ${lastLogin ? `<div style="display:flex;flex-direction:column;line-height:1.2;"><span>${escHtml(lastLogin.date)}</span><span>${escHtml(lastLogin.time)}</span></div>` : 'Never'}
        </td>
        <td class="text-center" style="padding: 15px 20px;">
          <div class="actions" style="justify-content:center; gap:6px;">
            <button class="btn btn-sm btn-edit" ${editAttrs}>Edit</button>
            ${approvalStatus === 'pending' && !isSelf && canManageTarget ? `<button class="btn btn-sm btn-add" onclick="approveUser(${u.id}, 'staff')">Approve Staff</button><button class="btn btn-sm btn-delete" onclick="rejectUser(${u.id})">Reject</button>` : ''}
            <button class="btn btn-sm ${u.active?'btn-delete':'btn-add'}" ${toggleAttrs}>${u.active?'Disable':'Enable'}</button>
            <button class="btn btn-sm btn-delete" ${deleteAttrs}>Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderTable() {
  if (activeTab === 'users') return renderUsers();

  const thead = document.getElementById('transaction-table-head') || document.querySelector('#table-body')?.closest('table')?.querySelector('thead tr');
  const tbody = document.getElementById('table-body');
  if (!thead || !tbody) return;
  const isTransactionsPage = Boolean(document.getElementById('transaction-table-head'));
  const isStaff = isStaffUser();
  if (isStaff) {
    thead.innerHTML = `<th>Transaction No.</th><th class="text-center">Type</th><th>Client</th><th>Project</th><th>Service Order</th><th>Description</th><th class="text-center">Qty</th><th class="text-right">Amount</th><th class="text-right">Bal</th><th class="text-center">Date</th><th class="text-center">Status</th><th class="text-center">Actions</th>`;
  } else {
    thead.innerHTML = `<th>Transaction No.</th><th class="text-center">Type</th><th>Client</th><th>Project</th><th>Service Order</th><th>Description</th><th class="text-center">Qty</th><th class="text-center">Check</th><th class="text-center">Customer PO Ref.</th><th class="text-right">Amount</th><th class="text-right">Bal</th><th class="text-center">Date</th><th class="text-center">Status</th><th class="text-center">Actions</th>`;
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
    const serviceOrderLabel = [
      r.service_order_no || '',
      r.service_order_title || ''
    ].map((value) => String(value || '').trim()).filter(Boolean).join(' - ') || '-';
    const hServiceOrder = highlight(serviceOrderLabel, q);
    const hCheckno = highlight(r.checkno || '', q);
    const hPono = highlight(r.pono || '', q);
    const hDesc = highlight(r.description || r.desc || '', q);
    const hQty = highlight(String(Number(r.qty || 0) || 0), q);
    const paidAmount = getTransactionPaidAmountValue(r);
    const balanceAmount = Math.max(0, Number(r.amount || 0) - paidAmount);

    const docCell = `<span class="doc-link" onclick="event.stopPropagation(); openPdfViewer(${r.id})" title="View PDF">${hDocno}</span>`;

    return `
      <tr>
        <td>${docCell}</td>
        <td class="text-center"><span class="type-pill type-${r.type}" style="white-space: nowrap;">${r.type === 'receipt' ? 'Payment Receipt' : 'Sales Invoice'}</span></td>
        <td><div style="font-weight:500; color:var(--text)">${hClient}</div></td>
        <td style="font-weight:500; color:var(--primary); line-height:1.35">${hProject}</td>
        <td style="font-weight:500; color:var(--primary); line-height:1.35; max-width:220px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${hServiceOrder}</td>
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
            <button class="btn btn-pdf btn-sm" onclick="event.stopPropagation(); openPdfViewer(${r.id})" title="View PDF">PDF</button>
            ${activeTab === 'archived'
              ? `<button class="btn btn-edit btn-sm" onclick="event.stopPropagation(); openArchivedModal(${r.id})" title="View Record">View</button><button class="btn btn-restore btn-sm" onclick="event.stopPropagation(); restoreArchivedDirect(${r.id})" title="Restore Record">Restore</button>`
              : `<button class="btn btn-edit btn-sm" onclick="event.stopPropagation(); openModal(${r.id})">Edit</button><button class="btn btn-archive btn-sm" onclick="event.stopPropagation(); openDelModal(${r.id})" title="Archive Record">Archive</button>`}
          </div>
        </td>` : `
        <td class="text-center">
          <div class="actions">
            <button class="btn btn-pdf btn-sm" onclick="event.stopPropagation(); openPdfViewer(${r.id})" title="View PDF">PDF</button>
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
    const shouldSave = await showConfirm('Save changes to the current project before switching?', { title: 'Unsaved Changes', confirmLabel: 'Save & switch', cancelLabel: "Don't save", type: 'warning' });
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

function getTransactionFieldMessageNode(fieldName) {
  return document.querySelector(`[data-transaction-field-message="${fieldName}"]`);
}

function getTransactionFieldNodes(fieldName) {
  const map = {
    docno: ['f-docno'],
    client: ['f-client'],
    project_id: ['f-project-id'],
    service_order_id: ['f-service-order-ref', 'f-service-order-id'],
    description: ['f-desc'],
    qty: ['f-qty'],
    unitprice: ['f-unitprice']
  };

  return (map[fieldName] || [])
    .map((id) => document.getElementById(id))
    .filter(Boolean);
}

function setTransactionFieldMessage(fieldName, message = '') {
  const notice = getTransactionFieldMessageNode(fieldName);
  const text = String(message || '').trim();
  const field = notice?.closest('.field') || null;

  if (notice) {
    notice.textContent = text;
    notice.classList.toggle('is-hidden', !text);
  }

  if (field) {
    field.classList.toggle('has-error', !!text);
  }

  getTransactionFieldNodes(fieldName).forEach((node) => {
    node.setAttribute('aria-invalid', text ? 'true' : 'false');
  });
}

function clearTransactionFieldMessages() {
  ['docno', 'client', 'project_id', 'service_order_id', 'description', 'qty', 'unitprice'].forEach((fieldName) => {
    setTransactionFieldMessage(fieldName, '');
  });
}

function focusModalElement(node) {
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

function focusFirstModalControl(ids = []) {
  for (const id of ids) {
    if (focusModalElement(document.getElementById(id))) {
      return id;
    }
  }
  return null;
}

function focusFirstModalField(fieldName, focusMap = {}) {
  const ids = Array.isArray(focusMap[fieldName])
    ? focusMap[fieldName]
    : (focusMap[fieldName] ? [focusMap[fieldName]] : []);
  return focusFirstModalControl(ids);
}

function setupTransactionModalValidationListeners() {
  const bindings = [
    ['f-docno', 'docno', 'input'],
    ['f-client', 'client', 'input'],
    ['f-project-id', 'project_id', 'change'],
    ['f-desc', 'description', 'input'],
    ['f-qty', 'qty', 'input'],
    ['f-unitprice', 'unitprice', 'input']
  ];

  bindings.forEach(([id, fieldName, eventName]) => {
    const node = document.getElementById(id);
    if (!node || node.dataset.transactionValidationBound === '1') return;
    node.dataset.transactionValidationBound = '1';
    node.addEventListener(eventName, () => setTransactionFieldMessage(fieldName, ''));
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
  ['p-budget', 'p-downpayment'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', debounce(updateProjectPaymentDisplay, 100));
  });
}

const PHONE_PH_DIGITS = 11;
const PHONE_MAX_DIGITS = 15;

function bindPhoneField(id) {
  const el = document.getElementById(id);
  if (!el || el.dataset.phoneBound === '1') return;

  el.dataset.phoneBound = '1';
  el.setAttribute('maxlength', String(PHONE_PH_DIGITS));
  el.setAttribute('inputmode', 'numeric');
  el.setAttribute('autocomplete', 'tel');
  el.addEventListener('input', () => {
    const normalized = normalizeDigits(el.value, PHONE_PH_DIGITS);
    if (el.value !== normalized) el.value = normalized;
  });
}

function setupPhoneValidation() {
  [
    'f-member-phone',
    'f-member-phone-2',
    'f-member-phone-3',
    'p-member-phone',
    'p-member-phone-2',
    'p-member-phone-3'
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

function updateCompanyRegistryStatCard() {
  const statCompanyRegistry = document.getElementById('stat-company-registry');
  const statCompanyRegistryMini = document.getElementById('stat-company-registry-mini');
  const companyRows = (Array.isArray(companyRegistryDb) ? companyRegistryDb : [])
    .filter((company) => Number(company.archived || 0) === 0);
  const visibleCompanyRows = companyRows.filter((company) => companyMatchesDashboardFilter(company.company_name));
  const selectedCompany = normalizeDashboardCompanyName(currentDashboardCompany || localStorage.getItem('kinaadman_dashboardCompany') || 'all');
  const companyCount = selectedCompany === 'all' ? companyRows.length : visibleCompanyRows.length;

  if (statCompanyRegistry) statCompanyRegistry.textContent = String(companyCount);
  if (statCompanyRegistryMini) {
    statCompanyRegistryMini.textContent = `${getCurrentDashboardCompanyLabel()} • ${companyCount} active record${companyCount === 1 ? '' : 's'}`;
  }
}

async function refreshCompanyRegistryStatCard() {
  try {
    const res = await fetch('/api/company-registry', { cache: 'no-store' });
    const data = await res.json().catch(() => []);
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    companyRegistryDb = Array.isArray(data) ? data : [];
    updateCompanyRegistryStatCard();
  } catch (err) {
    console.error('Company registry stat refresh error:', err);
  }
}

function updateNetPositionSummaryCard(receivableBalance = 0, payableBalance = 0) {
  const statCardReports = document.getElementById('stat-card-reports');
  if (!isAdminUser()) {
    if (statCardReports) {
      statCardReports.style.display = 'none';
      statCardReports.setAttribute('aria-hidden', 'true');
    }
    return;
  }
  if (statCardReports) {
    statCardReports.style.display = '';
    statCardReports.setAttribute('aria-hidden', 'false');
  }

  const statReports = document.getElementById('stat-reports');
  const statReportsMini = document.getElementById('stat-reports-mini');
  const netPosition = Number(receivableBalance || 0) - Number(payableBalance || 0);

  if (statReports) {
    statReports.textContent = formatPhpCurrency(netPosition);
  }
  if (statReportsMini) {
    statReportsMini.textContent = `${getCurrentDashboardCompanyLabel()} • ${formatPhpCurrency(receivableBalance)} AR • ${formatPhpCurrency(payableBalance)} AP`;
  }
}

async function updateStats() {
  const statsSeq = ++dashboardStatsSeq;
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
  const statProcurement = document.getElementById('stat-procurement');
  const statProcurementMini = document.getElementById('stat-procurement-mini');
  const statInventory = document.getElementById('stat-inventory');
  const statInventoryMini = document.getElementById('stat-inventory-mini');
  const statAp = document.getElementById('stat-ap');
  const statApMini = document.getElementById('stat-ap-mini');
  const statAr = document.getElementById('stat-ar');
  const statSales = document.getElementById('stat-sales');
  const statSalesMini = document.getElementById('stat-sales-mini');
  const statApprovals = document.getElementById('stat-approvals');
  const statApprovalsMini = document.getElementById('stat-approvals-mini');
  const statsYear = new Date().getFullYear();
  let dashboardReceivableBalance = 0;
  let dashboardPayableBalance = 0;

  const projectSummaryLabel = getDashboardProjectLabel();
  if (statLabel1) statLabel1.textContent = projectSummaryLabel;
  if (statLabel2) statLabel2.textContent = 'Ongoing Projects';
  if (statLabel3) statLabel3.textContent = 'Accounts Payable';
  if (statLabel4) statLabel4.textContent = 'Accounts Receivable';
  if (statOngoingMini) statOngoingMini.textContent = `Year ${statsYear}`;

  if (statCard3) {
    statCard3.classList.add('stat-card-link');
    statCard3.onclick = () => navigateDashboardCard('/accounts-payable?tab=bills');
  }

  if (statCard4) {
    statCard4.classList.add('stat-card-link');
    statCard4.onclick = () => navigateDashboardCard('/accounts-receivable?tab=invoices');
  }

  const visibleProjects = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
    .filter(project => Number(project.is_archived || 0) === 0)
    .filter(project => businessEntityMatches(project))
    .filter(project => !projectIsApprovalOnlyStatus(project.status))
    .filter(project => companyMatchesDashboardFilter(getProjectCompanyName(project)));
  const totalProjectsCount = visibleProjects.filter(project => String(project.status || '').toLowerCase() !== 'cancelled').length;
  const ongoingProjectsCount = visibleProjects.filter(project => {
    const status = String(project.status || '').toLowerCase();
    if (status === 'completed' || status === 'cancelled' || status === 'on_hold') return false;
    return getProjectPhase(project) === 'ongoing';
  }).length;
  const overdueProjectsCount = visibleProjects.filter(project => {
    const status = String(project.status || '').toLowerCase();
    if (status === 'completed' || status === 'cancelled' || projectIsApprovalOnlyStatus(status)) return false;
    return getProjectPhase(project) === 'ended';
  }).length;

  if (statProjects) statProjects.textContent = String(totalProjectsCount);
  if (statOngoing) statOngoing.textContent = String(ongoingProjectsCount);
  updateProjectWorkspaceSummary();
  const projectsMini = document.getElementById('stat-projects-mini');
  if (projectsMini) {
    projectsMini.textContent = `${getCurrentDashboardCompanyLabel()} • ${ongoingProjectsCount} ongoing • ${overdueProjectsCount} overdue`;
  }

  try {
    const companyParam = normalizeDashboardCompanyName(currentDashboardCompany || localStorage.getItem('kinaadman_dashboardCompany') || 'all');
    const statsParams = new URLSearchParams({
      year: String(statsYear),
      company: companyParam
    });
    const projectStatsRes = await fetch(`/api/projects/stats?${statsParams.toString()}`);
    const projectStats = await projectStatsRes.json();
    if (projectStatsRes.ok) {
      if (statProjects) statProjects.textContent = String(totalProjectsCount);
      if (statOngoing) statOngoing.textContent = String(ongoingProjectsCount);
    }
  } catch (err) {
    console.error('Error fetching project stats:', err);
  }

  try {
    const companiesRes = await fetch('/api/company-registry', { cache: 'no-store' });
    const companies = await companiesRes.json().catch(() => []);
    if (statsSeq !== dashboardStatsSeq) return;
    if (!companiesRes.ok) throw new Error(companies.error || 'Unable to load company registry stats.');
    companyRegistryDb = Array.isArray(companies) ? companies : [];
    syncDashboardCompanyFilterOptions();
    updateCompanyRegistryStatCard();
  } catch (err) {
    console.error('Error fetching company registry stats:', err);
    if (Array.isArray(companyRegistryDb) && companyRegistryDb.length) {
      updateCompanyRegistryStatCard();
    }
  }

  try {
    const receivablesRes = await fetch('/api/receivables');
    const receivables = await receivablesRes.json();
    if (statsSeq !== dashboardStatsSeq) return;
    allReceivablesDb = Array.isArray(receivables) ? receivables : [];

    syncDashboardCompanyFilterOptions();
    updateCompanyRegistryStatCard();

    // AR / invoice rows are derived from receivables (the retired Transactions feed merged in here).
    const invoiceRows = getDashboardInvoiceRows().filter(row => businessEntityMatches(row));
    const totalReceivable = invoiceRows.reduce((sum, r) => {
      const amount = parseFloat(r.amount) || 0;
      const paidAmount = getTransactionPaidAmountValue(r);
      return sum + Math.max(0, amount - paidAmount);
    }, 0);
    dashboardReceivableBalance = totalReceivable;

    if (statAr) statAr.textContent = 'PHP ' + totalReceivable.toLocaleString('en-PH', { minimumFractionDigits: 2 });
    if (statArMini) {
      statArMini.textContent = `${getCurrentDashboardCompanyLabel()} • ${invoiceRows.length} invoice${invoiceRows.length === 1 ? '' : 's'}`;
    }
    try {
      const salesRes = await fetch('/api/sales-management/records', { cache: 'no-store' });
      const salesRecords = salesRes.ok ? await salesRes.json().catch(() => []) : [];
      const salesRows = Array.isArray(salesRecords) ? salesRecords : [];
      const requestCount = salesRows.filter(row => String(row.record_type || '') === 'sales-request').length;
      const quotationCount = salesRows.filter(row => String(row.record_type || '') === 'sales-quotation').length;
      const orderCount = salesRows.filter(row => String(row.record_type || '') === 'sales-order').length;
      const deliveryCount = salesRows.filter(row => String(row.record_type || '') === 'project-delivery').length;
      if (statSales) statSales.textContent = String(orderCount + deliveryCount);
      if (statSalesMini) {
        statSalesMini.textContent = `${getCurrentDashboardCompanyLabel()} • ${requestCount} inquiries • ${quotationCount} quotations • ${orderCount} SO`;
      }
    } catch (_) {
      if (statSales) statSales.textContent = '0';
      if (statSalesMini) {
        statSalesMini.textContent = `${getCurrentDashboardCompanyLabel()} • 0 requests • 0 quotations`;
      }
    }

    updateProjectWorkspaceSummary();

    renderDashboardAnalytics(invoiceRows);
    renderInvoiceStatusQuickView(invoiceRows);
    renderProjectLedgerStats(invoiceRows);
  } catch (err) {
    console.error('Error fetching transactions stats:', err);
    allReceivablesDb = [];
    updateCompanyRegistryStatCard();
    if (statAr) statAr.textContent = 'PHP 0.00';
    if (statArMini) statArMini.textContent = `${getCurrentDashboardCompanyLabel()} • 0 invoices`;
    if (statSales) statSales.textContent = '0';
    if (statSalesMini) statSalesMini.textContent = `${getCurrentDashboardCompanyLabel()} • 0 requests • 0 quotations`;
    dashboardReceivableBalance = 0;
    renderInvoiceStatusQuickView([]);
    renderProjectLedgerStats([]);
  }

  try {
    const [vendorsRes, requisitionsRes, purchaseOrdersRes, goodsReceiptsRes] = await Promise.all([
      fetch('/api/vendors?include_inactive=1'),
      fetch('/api/procurement/requisitions'),
      fetch('/api/procurement/purchase-orders'),
      fetch('/api/procurement/goods-receipts')
    ]);
    const [vendors, requisitions, purchaseOrders, goodsReceipts] = await Promise.all([
      vendorsRes.json().catch(() => []),
      requisitionsRes.json().catch(() => []),
      purchaseOrdersRes.json().catch(() => []),
      goodsReceiptsRes.json().catch(() => [])
    ]);
    if (statsSeq !== dashboardStatsSeq) return;
    const requisitionRows = (Array.isArray(requisitions) ? requisitions : []).filter(row => businessEntityMatches(row));
    const purchaseOrderRows = (Array.isArray(purchaseOrders) ? purchaseOrders : []).filter(row => businessEntityMatches(row));
    const goodsReceiptRows = (Array.isArray(goodsReceipts) ? goodsReceipts : []).filter(row => businessEntityMatches(row));
    const approvedRequisitions = requisitionRows.filter(row => {
      const status = String(row.status || 'draft').toLowerCase();
      return ['approved', 'ordered'].includes(status);
    }).length;
    const approvedPurchaseOrders = purchaseOrderRows.filter(row => {
      const status = String(row.status || 'draft').toLowerCase();
      return ['approved', 'received'].includes(status);
    }).length;
    const approvedProcurement = approvedRequisitions + approvedPurchaseOrders;
    if (statProcurement) statProcurement.textContent = String(approvedProcurement);
    if (statProcurementMini) {
      statProcurementMini.textContent = `${getCurrentDashboardCompanyLabel()} • ${approvedRequisitions} approved PR • ${approvedPurchaseOrders} approved PO`;
    }
  } catch (err) {
    console.error('Error fetching procurement stats:', err);
    if (statProcurement) statProcurement.textContent = '0';
    if (statProcurementMini) statProcurementMini.textContent = `${getCurrentDashboardCompanyLabel()} • PR, PO, GRN`;
  }

  try {
    const inventoryParams = new URLSearchParams();
    const inventoryFilter = getBusinessEntityFilterId();
    if (inventoryFilter && inventoryFilter !== 'all') {
      inventoryParams.set('business_entity_id', inventoryFilter);
    }
    const inventoryRes = await fetch(`/api/inventory/summary?${inventoryParams.toString()}`);
    const inventory = await inventoryRes.json().catch(() => ({}));
    if (statsSeq !== dashboardStatsSeq) return;
    if (!inventoryRes.ok) throw new Error(inventory.error || 'Unable to load inventory stats.');
    const products = Number(inventory.products || 0);
    const warehouses = Number(inventory.warehouses || 0);
    const lowStock = Number(inventory.low_stock || 0);
    if (statInventory) statInventory.textContent = String(products);
    if (statInventoryMini) {
      statInventoryMini.textContent = `${getCurrentDashboardCompanyLabel()} • ${warehouses} warehouse${warehouses === 1 ? '' : 's'} • ${lowStock} low stock`;
    }
  } catch (err) {
    console.error('Error fetching inventory stats:', err);
    if (statInventory) statInventory.textContent = '0';
    if (statInventoryMini) statInventoryMini.textContent = `${getCurrentDashboardCompanyLabel()} • Products, warehouses, stock`;
  }

  try {
    const billsRes = await fetch('/api/bills');
    const bills = await billsRes.json();
    if (statsSeq !== dashboardStatsSeq) return;
    const billRows = (Array.isArray(bills) ? bills : [])
      .filter(row => businessEntityMatches(row))
      .filter(row => String(row.approval_status || 'approved').trim().toLowerCase() === 'approved');
    const totalPayable = billRows.reduce((sum, b) => {
      const totalAmount = parseFloat(b.total_amount) || 0;
      const paidAmount = parseFloat(b.paid_amount) || 0;
      return sum + Math.max(0, totalAmount - paidAmount);
    }, 0);
    dashboardPayableBalance = totalPayable;
    if (statAp) statAp.textContent = 'PHP ' + totalPayable.toLocaleString('en-PH', { minimumFractionDigits: 2 });
    if (statApMini) statApMini.textContent = `${getCurrentDashboardCompanyLabel()} • ${billRows.length} bill${billRows.length === 1 ? '' : 's'}`;
  } catch (err) {
    console.error('Error fetching payable stats:', err);
    if (statAp) statAp.textContent = 'PHP 0.00';
    if (statApMini) statApMini.textContent = `${getCurrentDashboardCompanyLabel()} • 0 bills`;
    dashboardPayableBalance = 0;
  }

  updateNetPositionSummaryCard(dashboardReceivableBalance, dashboardPayableBalance);
  if (isAdminUser()) {
    try {
      await updateApprovalCenterSummaryCard();
    } catch (err) {
      console.error('Error fetching approval center summary:', err);
      if (statApprovals) statApprovals.textContent = '0';
      if (statApprovalsMini) statApprovalsMini.textContent = 'Pending decisions unavailable';
    }
  } else {
    if (statApprovals) statApprovals.textContent = '0';
    if (statApprovalsMini) statApprovalsMini.textContent = 'Admin approvals only';
  }
  window.KinaadmanDashboardCards?.render(currentUser?.role);
  syncDashboardRoleLabels(currentUser?.role || getCachedAccessRole());
  await loadNotifications();
  renderDashboardAlerts();
}

async function renderDashboardAlerts() {
  const strip = document.getElementById('dashboard-alerts-strip');
  if (!strip) return;

  const alerts = [];

  const pendingApprovals = Number(document.getElementById('stat-approvals')?.textContent?.replace(/[^0-9]/g, '') || 0);
  if (pendingApprovals > 0) {
    alerts.push({ label: `${pendingApprovals} pending approval${pendingApprovals !== 1 ? 's' : ''}`, type: 'danger', icon: '<path d="m8.5 12.5 2.5 2.5 4.5-5"/><path d="M6.5 4.5h11A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18V6A1.5 1.5 0 0 1 6.5 4.5z"/>', onclick: 'openApprovalCenterFromDashboard()' });
  }

  const projectsMini = document.getElementById('stat-projects-mini')?.textContent || '';
  const overdueMatch = projectsMini.match(/(\d+)\s+overdue/i);
  if (overdueMatch && Number(overdueMatch[1]) > 0) {
    const n = Number(overdueMatch[1]);
    alerts.push({ label: `${n} overdue project${n !== 1 ? 's' : ''}`, type: 'danger', icon: '<path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h4.2l1.8 2H18.5A1.5 1.5 0 0 1 20 9.5v7A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5v-9z"/><path d="M12 10v3l1.5 1.5"/>', onclick: 'openProjectsFromDashboard()' });
  }

  const inventoryMini = document.getElementById('stat-inventory-mini')?.textContent || '';
  const lowStockMatch = inventoryMini.match(/(\d+)\s+low\s+stock/i);
  if (lowStockMatch && Number(lowStockMatch[1]) > 0) {
    const n = Number(lowStockMatch[1]);
    alerts.push({ label: `${n} low stock item${n !== 1 ? 's' : ''}`, type: 'warning', icon: '<path d="M4.5 7.5 12 3.8l7.5 3.7-7.5 3.7-7.5-3.7z"/><path d="M4.5 7.5v8.8L12 20l7.5-3.7V7.5"/><path d="M12 11.2V20"/>', onclick: "navigateDashboardCard('/inventory?tab=products')" });
  }

  const salesMini = document.getElementById('stat-sales-mini')?.textContent || '';
  const requestsMatch = salesMini.match(/(\d+)\s+request/i);
  if (requestsMatch && Number(requestsMatch[1]) > 0) {
    const n = Number(requestsMatch[1]);
    alerts.push({ label: `${n} sales request${n !== 1 ? 's' : ''} pending`, type: 'info', icon: '<path d="M5.5 19.5V5A1.5 1.5 0 0 1 7 3.5h8l3.5 3.5v12.5"/><path d="M8.5 11h7"/>', onclick: "navigateDashboardCard('/sales-management?tab=requests')" });
  }

  // Due-date reminders from the server (overdue AR, AP due within 7 days, CRM follow-ups due).
  if (isAdminUser()) {
    try {
      const res = await fetch('/api/alerts', { cache: 'no-store' });
      if (res.ok) {
        const a = await res.json();
        const arN = Number(a.overdue_ar || 0);
        if (arN > 0) alerts.push({ label: `${arN} overdue invoice${arN !== 1 ? 's' : ''}`, type: 'danger', icon: '<path d="M7 4.5h7l4 4V19.5H7A1.5 1.5 0 0 1 5.5 18V6A1.5 1.5 0 0 1 7 4.5z"/><path d="M10 12h4M12 10v4"/>', onclick: "navigateDashboardCard('/accounts-receivable?tab=ar-aging')" });
        const apN = Number(a.ap_due_soon || 0);
        if (apN > 0) alerts.push({ label: `${apN} bill${apN !== 1 ? 's' : ''} due soon`, type: 'warning', icon: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2.5"/>', onclick: "navigateDashboardCard('/accounts-payable?tab=ap-aging')" });
        const crmN = Number(a.crm_followups || 0);
        if (crmN > 0) alerts.push({ label: `${crmN} follow-up${crmN !== 1 ? 's' : ''} due`, type: 'info', icon: '<path d="M7 4.5v3M17 4.5v3M4.5 8.5h15v10A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M9 13l2 2 4-4"/>', onclick: "navigateDashboardCard('/crm?tab=leads')" });
      }
    } catch (_) { /* alerts are best-effort */ }
  }

  if (!alerts.length) {
    strip.innerHTML = '<span class="dashboard-alerts-label">Status</span><span class="alert-chip alert-chip-ok"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-9"/></svg>All clear</span>';
    strip.hidden = false;
    return;
  }

  const icon = (paths) => `<svg viewBox="0 0 24 24">${paths}</svg>`;
  strip.innerHTML = '<span class="dashboard-alerts-label">Needs Attention</span>' +
    alerts.map((a) => `<button class="alert-chip alert-chip-${a.type}" type="button" onclick="${a.onclick}">${icon(a.icon)} ${a.label}</button>`).join('');
  strip.hidden = false;
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
  clearTransactionFieldMessages();

  try {
    if (!Array.isArray(projectsDashboardDb) || !projectsDashboardDb.length) {
      await loadProjectsDashboardData();
    }
  } catch (err) {
    console.error('Transaction modal preload warning:', err);
  }

  if (normalizedId) {
    const r = db.find(u => u.id === normalizedId);
    if (r) {
      const linkedProject = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
        .find(project => Number(project.id || 0) === Number(r.project_id || 0));
      const selectedProjectId = r.project_id || '';
      populateTransactionProjectSelect(selectedProjectId);
      populateBusinessEntitySelect('f-business-entity-id', r.business_entity_id || linkedProject?.business_entity_id || '');
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

      await syncTransactionServiceOrderFromProject(selectedProjectId || null, r.service_order_id || 0);

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
    populateBusinessEntitySelect('f-business-entity-id', selectedProject?.business_entity_id || '');
    await syncTransactionServiceOrderFromProject(preselectProjectId || null, 0);
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
  clearTransactionFieldMessages();

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
    'f-business-entity-id',
    'f-service-order-id',
    'f-service-order-ref',
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
  populateBusinessEntitySelect('f-business-entity-id');
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
  clearTransactionFieldMessages();
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

// 3. stagePdfFile â€” ITO ANG PINAKAIMPORTANTE
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
// âœ… PAGkatapos
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
  return /^\d+$/.test(phone) && phone.length === PHONE_PH_DIGITS;
}

async function ensureGeneratedDocno() {
  const docnoInput = document.getElementById('f-docno');
  const currentDocno = docnoInput.value.trim();
  if (currentDocno) return currentDocno;

  const res = await fetch(`/api/transactions/next-docno?business_entity_id=${encodeURIComponent(getCurrentBusinessEntityId() || getDefaultBusinessEntityId() || '')}`);
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

  clearTransactionFieldMessages();

  let docno = document.getElementById('f-docno').value.trim();
  const client = document.getElementById('f-client').value.trim();
  const qty = parseInt(document.getElementById('f-qty').value) || 0;
  let desc = document.getElementById('f-desc').value.trim();
  let unitPrice = parseFloat(document.getElementById('f-unitprice').value) || 0;
  let amount = parseFloat(document.getElementById('f-amount').value) || 0;
  const documentDateInput = document.getElementById('f-date');
  const documentDate = (documentDateInput?.value || new Date().toISOString().slice(0, 10)).trim();
  const isEdit = !!editingId;
  const projectId = Number(document.getElementById('f-project-id')?.value || 0) || 0;
  const selectedProject = projectId ? findProjectForRecord({ project_id: projectId }) || (Array.isArray(projectsDashboardDb) ? projectsDashboardDb.find(entry => Number(entry.id || 0) === projectId) : null) : null;
  const businessEntitySelect = document.getElementById('f-business-entity-id');
  const businessEntityId = businessEntitySelect?.value || selectedProject?.business_entity_id || getDefaultBusinessEntityId() || '';
  if (businessEntitySelect) businessEntitySelect.value = businessEntityId;
  const hasProject = projectId > 0;

  if (documentDateInput) documentDateInput.value = documentDate;

  updateBalance();
  amount = parseFloat(document.getElementById('f-amount').value) || 0;

  let hasValidationError = false;
  let firstInvalidField = null;
  const markTransactionError = (fieldName, message) => {
    setTransactionFieldMessage(fieldName, message);
    if (!firstInvalidField) firstInvalidField = fieldName;
    hasValidationError = true;
  };

  if (!client) markTransactionError('client', 'Customer / Charged To is required.');
  if (!hasProject) {
    setTransactionServiceOrderSelection('', '');
    setTransactionFieldMessage('service_order_id', '');
  }

  if (!desc) markTransactionError('description', 'Description is required.');
  if (!(Number.isFinite(qty) && qty > 0)) markTransactionError('qty', 'Qty is required.');
  if (!(Number.isFinite(unitPrice) && unitPrice > 0)) markTransactionError('unitprice', 'Unit Price is required.');

  const serviceOrderId = Number(document.getElementById('f-service-order-id')?.value || 0) || 0;

  if (hasValidationError) {
    focusFirstModalField(firstInvalidField, {
      client: ['f-client'],
      service_order_id: ['f-service-order-ref'],
      description: ['f-desc'],
      qty: ['f-qty'],
      unitprice: ['f-unitprice'],
      project_id: ['f-project-id'],
      docno: ['f-docno']
    });
    return;
  }

  if (!isEdit && !docno) {
    try {
      docno = await ensureGeneratedDocno();
    } catch (err) {
      console.error(err);
      setTransactionFieldMessage('docno', err.message || 'Hindi ma-generate ang Transaction No.');
      focusFirstModalControl(['f-docno']);
      return;
    }
  }

  if (!docno) {
    setTransactionFieldMessage('docno', 'Transaction No. is required.');
    focusFirstModalControl(['f-docno']);
    return;
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
  formData.append('business_entity_id', businessEntityId);
  formData.append('project_id', hasProject ? projectId : '');
  formData.append('service_order_id', hasProject ? serviceOrderId : '');
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
  // Kung wala talagang PDF, walang idadagdag â€” OK lang

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
    const errorText = String(err?.message || '').toLowerCase();
    let handled = false;

    if (errorText.includes('duplicate') || errorText.includes('already exists')) {
      if (errorText.includes('docno') || errorText.includes('transaction no')) {
        setTransactionFieldMessage('docno', err.message || 'Transaction No. already exists.');
        focusFirstModalControl(['f-docno']);
      } else if (errorText.includes('project')) {
        setTransactionFieldMessage('project_id', err.message || 'Selected project already has a transaction.');
        focusFirstModalControl(['f-project-id']);
      } else if (errorText.includes('selected service order was not found') || errorText.includes('selected service order must belong')) {
        setTransactionFieldMessage('service_order_id', err.message || 'Selected service order is invalid for this project.');
        focusFirstModalControl(['f-service-order-ref']);
      } else {
        setTransactionFieldMessage('docno', err.message || 'Transaction No. already exists.');
        focusFirstModalControl(['f-docno']);
      }
      handled = true;
    } else if (errorText.includes('project')) {
      setTransactionFieldMessage('project_id', err.message || 'Please select a project.');
      focusFirstModalControl(['f-project-id']);
      handled = true;
    } else if (errorText.includes('selected service order was not found') || errorText.includes('selected service order must belong')) {
      setTransactionFieldMessage('service_order_id', err.message || 'Selected service order is invalid for this project.');
      focusFirstModalControl(['f-service-order-ref']);
      handled = true;
    } else if (errorText.includes('client')) {
      setTransactionFieldMessage('client', err.message || 'Customer / Charged To is required.');
      focusFirstModalControl(['f-client']);
      handled = true;
    } else if (errorText.includes('description')) {
      setTransactionFieldMessage('description', err.message || 'Description is required.');
      focusFirstModalControl(['f-desc']);
      handled = true;
    } else if (errorText.includes('qty') || errorText.includes('quantity')) {
      setTransactionFieldMessage('qty', err.message || 'Qty is required.');
      focusFirstModalControl(['f-qty']);
      handled = true;
    } else if (errorText.includes('unit price') || errorText.includes('unitprice')) {
      setTransactionFieldMessage('unitprice', err.message || 'Unit Price is required.');
      focusFirstModalControl(['f-unitprice']);
      handled = true;
    }

    if (!handled) {
      showToast(err.message || 'Server error. Hindi na-save ang record.', 'error');
    }
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

async function restoreArchivedDirect(id) {
  const ok = await showConfirm('Restore this record from archive?', { title: 'Restore from Archive', confirmLabel: 'Restore', type: 'default' });
  if (!ok) return;
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
    '/admin': ['/admin?view=dashboard'],
    '/reports': ['/admin?panel=reports'],
    '/admin?panel=project-records': ['/admin?view=project-records'],
    '/admin?panel=project-records': ['/admin?view=total-projects'],
    '/admin?view=ongoing-projects': ['/admin?view=ongoing'],
    '/admin?view=logs': ['/admin?panel=logs'],
    '/admin?panel=archive-center': ['/admin?view=archive-center', '/admin?view=archived', '/admin?panel=archived'],
    '/admin?panel=approval-center': ['/admin?view=approvals'],
    '/master-data?tab=vendors': ['/accounts-payable?tab=vendors', '/accounts-payable'],
    '/sales-management': ['/accounts-receivable', '/accounts-receivable?tab=invoices']
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
  if (!r) return showToast('Record not found.', 'error');

  const pdfUrl = `/api/transactions/${r.id}/pdf`;
  const pdfName = r.pdfFilename || `${r.docno || 'transaction'}-summary.pdf`;

  document.getElementById('pdf-viewer-title').textContent = pdfName;
  document.getElementById('pdf-dl-btn').href = pdfUrl;
  document.getElementById('pdf-dl-btn').download = pdfName;

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
  if (!project) return showToast('Project not found.', 'error');

  const pdfUrl = `/api/projects/${project.id}/pdf`;
  const pdfName = project.pdfFilename || `${project.project_docno || 'project'}-summary.pdf`;

  document.getElementById('pdf-viewer-title').textContent = pdfName;
  document.getElementById('pdf-dl-btn').href = pdfUrl;
  document.getElementById('pdf-dl-btn').download = pdfName;

  const fallbackBtn = document.getElementById('pdf-fallback-dl');
  if (fallbackBtn) {
    fallbackBtn.href = pdfUrl;
    fallbackBtn.download = pdfName;
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

function openProjectSalesInquiry(projectId) {
  const selectedId = Number(projectId || 0) || 0;
  if (!selectedId) return;
  const project = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
    .find((entry) => Number(entry.id || 0) === selectedId) || null;
  const companyId = Number(project?.company_id || project?.registry_company_id || 0) || 0;
  const params = new URLSearchParams({
    tab: 'sales-request',
    project_id: String(selectedId),
    new: '1'
  });
  if (companyId) params.set('company_id', String(companyId));
  window.location.href = `/sales-management?${params.toString()}`;
}

function openProjectTransaction(projectId) {
  const selectedId = Number(projectId || 0) || 0;
  if (!selectedId) return;
  openProjectPurchaseOrder(selectedId);
}

function viewArchivedPdf() {
  if (!viewingArchivedId) return;
  const r = db.find(u => u.id === viewingArchivedId);
  if (!r) return showToast('Record not found.', 'error');

  const pdfUrl = `/api/transactions/${r.id}/pdf`;
  const pdfName = r.pdfFilename || `${r.docno || 'archived-record'}-summary.pdf`;

  document.getElementById('pdf-viewer-title').textContent = pdfName;
  document.getElementById('pdf-dl-btn').href = pdfUrl;
  document.getElementById('pdf-dl-btn').download = pdfName;

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
  const t = document.getElementById('toast');
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
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, username, email, role, password, active })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || data.message || 'Failed to create user.');
  }
  return data;
}

function getUserFieldMessageNode(fieldName) {
  return document.querySelector(`[data-user-field-message="${fieldName}"]`);
}

function getUserFieldNodes(fieldName) {
  const map = {
    name: ['u-name'],
    username: ['u-username'],
    email: ['u-email'],
    adminPassword: ['u-admin-pass']
  };

  return (map[fieldName] || [])
    .map((id) => document.getElementById(id))
    .filter(Boolean);
}

function setUserFieldMessage(fieldName, message = '') {
  const notice = getUserFieldMessageNode(fieldName);
  const text = String(message || '').trim();
  const field = notice?.closest('.field') || null;

  if (notice) {
    notice.textContent = text;
    notice.classList.toggle('is-hidden', !text);
  }

  if (field) {
    field.classList.toggle('has-error', !!text);
  }

  getUserFieldNodes(fieldName).forEach((node) => {
    node.setAttribute('aria-invalid', text ? 'true' : 'false');
  });
}

function clearUserFieldMessages() {
  ['name', 'username', 'email', 'adminPassword'].forEach((fieldName) => {
    setUserFieldMessage(fieldName, '');
  });
}

function setupUserModalValidationListeners() {
  const bindings = [
    ['u-name', 'name'],
    ['u-username', 'username'],
    ['u-email', 'email'],
    ['u-admin-pass', 'adminPassword']
  ];

  bindings.forEach(([id, fieldName]) => {
    const node = document.getElementById(id);
    if (!node || node.dataset.userValidationBound === '1') return;
    node.dataset.userValidationBound = '1';
    node.addEventListener('input', () => setUserFieldMessage(fieldName, ''));
    node.addEventListener('change', () => setUserFieldMessage(fieldName, ''));
  });
}

function getResetPasswordFieldMessageNode(fieldName) {
  return document.querySelector(`[data-reset-pass-field-message="${fieldName}"]`);
}

function getResetPasswordFieldNodes(fieldName) {
  const map = {
    password: ['reset-pass-input'],
    confirm: ['reset-pass-confirm']
  };

  return (map[fieldName] || [])
    .map((id) => document.getElementById(id))
    .filter(Boolean);
}

function setResetPasswordFieldMessage(fieldName, message = '') {
  const notice = getResetPasswordFieldMessageNode(fieldName);
  const text = String(message || '').trim();
  const field = notice?.closest('.field') || null;

  if (notice) {
    notice.textContent = text;
    notice.classList.toggle('is-hidden', !text);
  }

  if (field) {
    field.classList.toggle('has-error', !!text);
  }

  getResetPasswordFieldNodes(fieldName).forEach((node) => {
    node.setAttribute('aria-invalid', text ? 'true' : 'false');
  });
}

function clearResetPasswordFieldMessages() {
  ['password', 'confirm'].forEach((fieldName) => {
    setResetPasswordFieldMessage(fieldName, '');
  });
}

function setupResetPasswordModalValidationListeners() {
  const bindings = [
    ['reset-pass-input', 'password'],
    ['reset-pass-confirm', 'confirm']
  ];

  bindings.forEach(([id, fieldName]) => {
    const node = document.getElementById(id);
    if (!node || node.dataset.resetPasswordValidationBound === '1') return;
    node.dataset.resetPasswordValidationBound = '1';
    node.addEventListener('input', () => setResetPasswordFieldMessage(fieldName, ''));
    node.addEventListener('change', () => setResetPasswordFieldMessage(fieldName, ''));
  });
}

function handleUserSaveError(err) {
  const errorText = String(err?.message || '').toLowerCase();
  if (errorText.includes('username')) {
    setUserFieldMessage('username', err.message || 'Username already exists.');
    return 'username';
  }
  if (errorText.includes('email')) {
    setUserFieldMessage('email', err.message || 'Email already exists.');
    return 'email';
  }
  if (errorText.includes('password')) {
    setUserFieldMessage('adminPassword', err.message || 'Current admin password is required.');
    return 'adminPassword';
  }
  if (errorText.includes('name') || errorText.includes('fullname')) {
    setUserFieldMessage('name', err.message || 'Full Name is required.');
    return 'name';
  }
  return null;
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
  if (Number(user?.id || 0) === Number(currentUser?.id || 0)) return true;
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
  clearUserFieldMessages();
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
  clearUserFieldMessages();

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
  clearUserFieldMessages();
}

async function saveUser() {
  const name     = document.getElementById('u-name').value.trim();
  const username = document.getElementById('u-username').value.trim();
  const email    = document.getElementById('u-email').value.trim().toLowerCase();
  const role     = document.getElementById('u-role').value;
  const adminPassword = String(document.getElementById('u-admin-pass')?.value || '');
  const statusInput = document.getElementById('u-status');
  const status   = statusInput
    ? statusInput.value
    : (userModalMode === 'edit' && userModalSnapshot
      ? String(Number(userModalSnapshot.active || 0) === 1 ? 1 : 0)
      : '1');
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  clearUserFieldMessages();

  let hasValidationError = false;
  let firstInvalidField = null;
  const markUserError = (fieldName, message) => {
    setUserFieldMessage(fieldName, message);
    if (!firstInvalidField) firstInvalidField = fieldName;
    hasValidationError = true;
  };

  if (!name) markUserError('name', 'Full Name is required.');
  if (!username) markUserError('username', 'Username is required.');
  if (!email) {
    markUserError('email', 'Email is required.');
  } else if (!emailRegex.test(email)) {
    markUserError('email', 'Invalid email format.');
  }

  if (userModalNeedsAdminPassword() && !adminPassword) {
    markUserError('adminPassword', 'Current admin password is required for staff/admin access.');
  }

  if (hasValidationError) {
    focusFirstModalField(firstInvalidField, {
      name: ['u-name'],
      username: ['u-username'],
      email: ['u-email'],
      adminPassword: ['u-admin-pass']
    });
    return;
  }

  const duplicateField = findUserDuplicateField(
    username,
    email,
    userModalMode === 'edit' ? editingUserId : 0
  );
  if (duplicateField) {
    const duplicateMessage = duplicateField === 'username'
      ? 'Username already exists.'
      : 'Email already exists.';
    setUserFieldMessage(duplicateField, duplicateMessage);
    focusFirstModalField(duplicateField, {
      name: ['u-name'],
      username: ['u-username'],
      email: ['u-email'],
      adminPassword: ['u-admin-pass']
    });
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update user.');
      }

      closeUserModal();
      showToast('Changes saved successfully!', 'success');
      await loadUsers();
      return;
    } catch (err) {
      console.error('Update User Error:', err);
      const handledField = handleUserSaveError(err);
      if (handledField) {
        focusFirstModalField(handledField, {
          name: ['u-name'],
          username: ['u-username'],
          email: ['u-email'],
          adminPassword: ['u-admin-pass']
        });
      } else {
        showToast(err.message || 'Network error o hindi maka-connect sa server.', 'error');
      }
      return;
    }
  }

  showToast('Use Register for new accounts. User Management is edit and approval only.', 'error');
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

function openArchiveCenter() {
  if (!isAdminUser()) return;
  openDashboardPanel('archive-center');
  setSidebarOpen(false);
}

function loadLogs() {
  const q = String(document.getElementById('logs-search')?.value || '').trim();
  const action = String(document.getElementById('logs-filter')?.value || '').trim();
  const moduleName = String(document.getElementById('logs-module-filter')?.value || '').trim();
  const dateFrom = String(document.getElementById('logs-date-from')?.value || '').trim();
  const dateTo = String(document.getElementById('logs-date-to')?.value || '').trim();
  const params = new URLSearchParams({ limit: '250' });
  if (q) params.set('q', q);
  if (action) params.set('action', action);
  if (moduleName) params.set('module', moduleName);
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);

  fetch(`/api/admin/logs?${params.toString()}`, { cache: 'no-store' })
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
        tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color: var(--danger);">Failed to load logs.</td></tr>';
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
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">No logs found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(log => `
    <tr>
      <td style="font-size: 0.65rem; color: var(--text-muted);">${highlight(new Date(log.created_at).toLocaleString(), q)}</td>
      <td><span class="log-action-badge">${highlight(log.module || 'system', q)}</span></td>
      <td><strong>${highlight(log.fullname || log.username || 'System', q)}</strong></td>
      <td><span class="log-action-badge">${highlight(log.action, q)}</span></td>
      <td style="font-size: 0.7rem; white-space: normal;">${highlight(log.details, q)}</td>
      <td style="font-size: 0.7rem;">${highlight(log.ip_address || '-', q)}</td>
    </tr>
  `).join('');
}

function getFilteredLogs(tokens, action) {
  return logsDb.filter((log) => {
    const haystack = [
      log.module || '',
      log.fullname || '',
      log.username || '',
      log.user_role || '',
      log.action || '',
      log.details || '',
      log.ip_address || ''
    ].join(' ').toLowerCase();
    const searchMatch = !tokens.length || tokens.every((token) => haystack.includes(token));
    const actionMatch = !action || String(log.action || '') === action;
    const moduleName = String(document.getElementById('logs-module-filter')?.value || '').trim().toLowerCase();
    const moduleMatch = !moduleName || String(log.module || 'system').toLowerCase() === moduleName;
    return searchMatch && actionMatch && moduleMatch;
  });
}

function exportLogs(format = 'xls') {
  const q = String(document.getElementById('logs-search')?.value || '').trim();
  const action = String(document.getElementById('logs-filter')?.value || '').trim();
  const moduleName = String(document.getElementById('logs-module-filter')?.value || '').trim();
  const dateFrom = String(document.getElementById('logs-date-from')?.value || '').trim();
  const dateTo = String(document.getElementById('logs-date-to')?.value || '').trim();
  const params = new URLSearchParams();
  params.set('format', String(format || 'xls').toLowerCase());
  if (q) params.set('q', q);
  if (action) params.set('action', action);
  if (moduleName) params.set('module', moduleName);
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);
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

function normalizeServiceOrderStatus(status) {
  const normalized = String(status || 'draft').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'inprogress') return 'in_progress';
  if (normalized === 'canceled') return 'cancelled';
  const allowed = new Set(['draft', 'issued', 'accepted', 'in_progress', 'completed', 'cancelled']);
  return allowed.has(normalized) ? normalized : 'draft';
}

function formatServiceOrderStatusLabel(status) {
  return normalizeServiceOrderStatus(status)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeServiceOrderType(type) {
  const normalized = String(type || 'installation').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const allowed = new Set(['installation', 'maintenance', 'repair', 'inspection', 'upgrade', 'support', 'other']);
  return allowed.has(normalized) ? normalized : 'installation';
}

function formatServiceOrderTypeLabel(type) {
  return normalizeServiceOrderType(type)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getServiceOrderProjectLabel(project) {
  if (!project) return 'Untitled Project';

  const docno = String(project.project_docno || project.source_docno || '').trim();
  const name = String(project.project_name || 'Untitled Project').trim() || 'Untitled Project';
  const companyNo = String(project.company_no || project.registry_company_no || '').trim();
  const companyName = String(project.company_name || project.registry_company_name || '').trim();
  const companyLabel = [companyNo, companyName].filter(Boolean).join(' - ');

  return [docno, name, companyLabel].filter(Boolean).join(' - ');
}

function populateServiceOrderProjectSelect(selectedProjectId = '') {
  const select = document.getElementById('so-project-id');
  if (!select) return;

  const currentValue = String(selectedProjectId || select.value || '').trim();
  const projects = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
    .filter((project) => businessEntityMatches(project));

  select.innerHTML = '<option value="">Select Project</option>' + projects.map((project) => {
    const value = Number(project.id || 0);
    const label = getServiceOrderProjectLabel(project);
    return `<option value="${value}">${escHtml(label)}</option>`;
  }).join('');

  if (currentValue) {
    select.value = currentValue;
  }

  syncServiceOrderCompanyFromProject();
}

async function loadServiceOrdersData() {
  // Service Operations was retired — there is no /api/service-orders endpoint anymore.
  // This is now a no-op that keeps the (empty) array so any remaining callers degrade
  // gracefully without ever hitting a dead 404. See [[transactions-legacy]].
  serviceOrdersDb = [];
  serviceOrdersInitialLoadAttempted = true;
  return serviceOrdersDb;
}

function renderServiceOrdersTable() {
  const tbody = document.getElementById('service-orders-table-body');
  if (!tbody) return;

  const searchValue = String(document.getElementById('service-orders-search-input')?.value || '').trim().toLowerCase();
  const rows = Array.isArray(serviceOrdersDb) ? serviceOrdersDb : [];

  if (!rows.length) {
    if (!serviceOrdersInitialLoadAttempted) {
      tbody.innerHTML = '';
      loadServiceOrdersData()
        .then(() => {
          if (document.getElementById('service-orders-table-body')) {
            renderServiceOrdersTable();
          }
        })
        .catch((err) => {
          console.error('Load service orders error:', err);
          showToast(err.message || 'Unable to load service orders.', 'error');
        });
      return;
    }

    tbody.innerHTML = '<tr class="empty-row"><td colspan="12">No service orders found.</td></tr>';
    return;
  }

  const filtered = rows.filter((row) => {
    if (!searchValue) return true;
    const haystack = [
      row.so_number,
      row.vendor_name,
      row.company_name,
      row.company_no,
      row.project_name,
      row.project_docno,
      row.transaction_docnos,
      row.service_title,
      row.service_type,
      row.description,
      row.notes,
      row.status,
    ]
      .map((value) => String(value ?? '').trim())
      .join(' ')
      .toLowerCase();
    return haystack.includes(searchValue);
  });

  if (!filtered.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="12">No service orders found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((row) => {
    const companyLabel = [row.company_no, row.company_name]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' - ') || '-';
    const projectLabel = [row.project_docno, row.project_name].map((value) => String(value || '').trim()).filter(Boolean).join(' - ') || '-';
    const transactionDocnos = String(row.transaction_docnos || '').trim();
    const transactionCount = Number(row.transaction_count || 0) || (transactionDocnos ? transactionDocnos.split(',').filter(Boolean).length : 0);
    const transactionLabel = transactionDocnos
      ? (transactionCount > 1 ? `${transactionDocnos.split(',')[0].trim()} (+${transactionCount - 1})` : transactionDocnos.split(',')[0].trim())
      : '-';
    const amount = Number(row.total_amount || 0);
    const amountText = `PHP ${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const typeLabel = formatServiceOrderTypeLabel(row.service_type || 'installation');
    const statusClass = `status-pill status-${normalizeServiceOrderStatus(row.status || 'draft')}`;
    const statusLabel = formatServiceOrderStatusLabel(row.status || 'draft');
    const notes = String(row.notes || '-').trim() || '-';
    const archived = Number(row.is_archived || 0) === 1;

    return `
      <tr>
        <td style="font-weight:600;color:var(--primary)">${escHtml(row.so_number || '-')}</td>
        <td>${escHtml(row.vendor_name || '-')}</td>
        <td>${escHtml(companyLabel)}</td>
        <td>${escHtml(projectLabel)}</td>
        <td title="${escHtml(transactionDocnos || '-')}" style="max-width:220px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escHtml(transactionLabel)}</td>
        <td>${escHtml(row.service_title || row.description || '-')}</td>
        <td>${escHtml(typeLabel)}</td>
        <td class="text-center">${escHtml(String(row.service_date || '').slice(0, 10) || '-')}</td>
        <td class="text-right" style="font-weight:600;">${escHtml(amountText)}</td>
        <td title="${escHtml(notes)}" style="max-width:240px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escHtml(notes)}</td>
        <td class="text-center"><span class="${statusClass}">${escHtml(statusLabel)}</span></td>
        <td class="text-center">
          <div class="actions">
            ${archived
              ? `<button class="btn btn-restore btn-sm" type="button" onclick="event.stopPropagation(); restoreServiceOrder(${Number(row.id)})">Restore</button>`
              : `<button class="btn btn-edit btn-sm" type="button" onclick="event.stopPropagation(); openServiceOrderModal(${Number(row.id)})">Edit</button><button class="btn btn-archive btn-sm" type="button" onclick="event.stopPropagation(); archiveServiceOrder(${Number(row.id)})">Archive</button>`}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function archiveServiceOrder(id) {
  const confirmed = await openConfirmDialog({
    title: 'Archive Service Order',
    message: 'Archive this service order?',
    noText: 'No',
    yesText: 'Yes'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/service-orders/${id}/archive`, { method: 'PUT' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || 'Unable to archive service order.');
    showToast('Service order archived successfully!', 'success');
    await loadServiceOrdersData(true);
    renderServiceOrdersTable();
  } catch (err) {
    showToast(err.message || 'Unable to archive service order.', 'error');
  }
}

async function restoreServiceOrder(id) {
  const confirmed = await openConfirmDialog({
    title: 'Restore Service Order',
    message: 'Restore this service order?',
    noText: 'No',
    yesText: 'Yes'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/service-orders/${id}/restore`, { method: 'PUT' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || 'Unable to restore service order.');
    showToast('Service order restored successfully!', 'success');
    await loadServiceOrdersData(true);
    renderServiceOrdersTable();
  } catch (err) {
    showToast(err.message || 'Unable to restore service order.', 'error');
  }
}

function getServiceOrderFieldMessageNode(fieldName) {
  return document.querySelector(`[data-so-field-message="${fieldName}"]`);
}

function getServiceOrderFieldNodes(fieldName) {
  const map = {
    so_number: ['so-docno'],
    vendor_id: ['so-vendor-search', 'so-vendor-id'],
    company_id: ['so-company-search', 'so-company-id'],
    project_id: ['so-project-id'],
    service_title: ['so-title']
  };

  return (map[fieldName] || [])
    .map((id) => document.getElementById(id))
    .filter(Boolean);
}

function setServiceOrderFieldMessage(fieldName, message = '') {
  const notice = getServiceOrderFieldMessageNode(fieldName);
  const text = String(message || '').trim();
  const field = notice?.closest('.field') || null;

  if (notice) {
    notice.textContent = text;
    notice.classList.toggle('is-hidden', !text);
  }

  if (field) {
    field.classList.toggle('has-error', !!text);
  }

  getServiceOrderFieldNodes(fieldName).forEach((node) => {
    node.setAttribute('aria-invalid', text ? 'true' : 'false');
  });
}

function clearServiceOrderFieldMessages() {
  ['so_number', 'vendor_id', 'company_id', 'project_id', 'service_title'].forEach((fieldName) => {
    setServiceOrderFieldMessage(fieldName, '');
  });
}

function setupServiceOrderModalValidationListeners() {
  const bindings = [
    ['so-docno', 'so_number'],
    ['so-vendor-search', 'vendor_id', () => {
      const hidden = document.getElementById('so-vendor-id');
      if (hidden) hidden.value = '';
    }],
    ['so-company-search', 'company_id', () => {
      filterServiceOrderCompanies();
    }],
    ['so-project-id', 'project_id'],
    ['so-title', 'service_title']
  ];

  bindings.forEach(([id, fieldName, onInput]) => {
    const node = document.getElementById(id);
    if (!node || node.dataset.serviceOrderValidationBound === '1') return;
    node.dataset.serviceOrderValidationBound = '1';
    node.addEventListener('input', () => {
      setServiceOrderFieldMessage(fieldName, '');
      if (typeof onInput === 'function') onInput();
    });
    node.addEventListener('change', () => setServiceOrderFieldMessage(fieldName, ''));
  });
}

async function loadServiceOrderPickerData(force = false) {
  if (!force && Array.isArray(serviceOrderCompanyPickerDb) && serviceOrderCompanyPickerDb.length && Array.isArray(serviceOrderVendorPickerDb) && serviceOrderVendorPickerDb.length) {
    return {
      companies: serviceOrderCompanyPickerDb,
      vendors: serviceOrderVendorPickerDb
    };
  }

  if (!force && serviceOrderPickerLoadPromise) {
    return serviceOrderPickerLoadPromise;
  }

  const companyQuery = new URLSearchParams({ include_archived: '1' });
  serviceOrderPickerLoadPromise = Promise.all([
    fetch(`/api/company-registry?${companyQuery.toString()}`, { cache: 'no-store' }),
    fetch('/api/vendors?include_inactive=1', { cache: 'no-store' })
  ])
    .then(async ([companiesRes, vendorsRes]) => {
      const companiesData = await companiesRes.json().catch(() => ([]));
      const vendorsData = await vendorsRes.json().catch(() => ([]));

      if (!companiesRes.ok) {
        throw new Error((companiesData && companiesData.error) || `HTTP ${companiesRes.status}`);
      }
      if (!vendorsRes.ok) {
        throw new Error((vendorsData && vendorsData.error) || `HTTP ${vendorsRes.status}`);
      }

      serviceOrderCompanyPickerDb = Array.isArray(companiesData) ? companiesData : [];
      const companyIds = new Set(serviceOrderCompanyPickerDb.map(company => Number(company.id || 0)).filter(Boolean));
      serviceOrderVendorPickerDb = (Array.isArray(vendorsData) ? vendorsData : []).filter((vendor) => {
        const companyId = Number(vendor.company_id || 0);
        return !companyId || companyIds.has(companyId);
      });

      return {
        companies: serviceOrderCompanyPickerDb,
        vendors: serviceOrderVendorPickerDb
      };
    })
    .catch((err) => {
      serviceOrderCompanyPickerDb = [];
      serviceOrderVendorPickerDb = [];
      throw err;
    })
    .finally(() => {
      serviceOrderPickerLoadPromise = null;
    });

  return serviceOrderPickerLoadPromise;
}

function getServiceOrderCompanyLabel(company) {
  if (!company) return '';
  const companyNo = String(company.company_no || '').trim();
  const companyName = String(company.company_name || '').trim();
  return [companyNo, companyName].filter(Boolean).join(' - ') || companyName || companyNo || '';
}

function getServiceOrderVendorLabel(vendor) {
  if (!vendor) return '';
  const name = String(vendor.vendor_name || '').trim();
  const contact = String(vendor.contact_person || '').trim();
  const email = String(vendor.email || '').trim();
  const companyName = String(vendor.company_name || '').trim();
  const isOwnCompanyVendor = Number(vendor.business_entity_id || 0) > 0;
  const isActive = vendor.is_active === undefined || vendor.is_active === null ? true : Number(vendor.is_active) === 1;
  const inactiveTag = isActive ? '' : ' [Inactive]';
  if (isOwnCompanyVendor) {
    return `${name || companyName || 'Own Company Vendor'} - Own company vendor${inactiveTag}`;
  }
  const meta = [contact, email].filter(Boolean).join(' • ');
  return meta ? `${name}${inactiveTag} (${meta})` : `${name}${inactiveTag}`;
}

function setServiceOrderCompanySelection(companyId, companyLabel) {
  const hidden = document.getElementById('so-company-id');
  const input = document.getElementById('so-company-search');
  const results = document.getElementById('so-company-results');

  if (hidden) hidden.value = companyId ? String(companyId) : '';
  if (input) input.value = companyLabel || '';
  if (results) {
    results.style.display = 'none';
    results.innerHTML = '';
  }
  setServiceOrderFieldMessage('company_id', '');
  ensureServiceOrderVendorMatchesCompany(companyId);
}

function setServiceOrderVendorSelection(vendorId, vendorLabel) {
  const hidden = document.getElementById('so-vendor-id');
  const input = document.getElementById('so-vendor-search');
  const results = document.getElementById('so-vendor-results');

  if (hidden) hidden.value = vendorId ? String(vendorId) : '';
  if (input) input.value = vendorLabel || '';
  if (results) {
    results.style.display = 'none';
    results.innerHTML = '';
  }
  setServiceOrderFieldMessage('vendor_id', '');
}

function getServiceOrderCompanyRecordById(companyId) {
  const normalizedId = Number(companyId || 0) || 0;
  if (!normalizedId) return null;

  return (Array.isArray(serviceOrderCompanyPickerDb) ? serviceOrderCompanyPickerDb : [])
    .find((entry) => Number(entry.id || 0) === normalizedId)
    || (Array.isArray(companyRegistryDb) ? companyRegistryDb : [])
      .find((entry) => Number(entry.id || 0) === normalizedId)
    || null;
}

function findServiceOrderCompanyBySearchValue(value) {
  const target = String(value || '').trim().toLowerCase();
  if (!target) return null;
  const sources = [
    ...(Array.isArray(serviceOrderCompanyPickerDb) ? serviceOrderCompanyPickerDb : []),
    ...(Array.isArray(companyRegistryDb) ? companyRegistryDb : [])
  ];
  const seen = new Set();
  const companies = sources.filter((company) => {
    const id = Number(company?.id || 0) || 0;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const exact = companies.find((company) => {
    const label = getServiceOrderCompanyLabel(company).toLowerCase();
    return String(company.id || '').toLowerCase() === target
      || String(company.company_no || '').toLowerCase() === target
      || String(company.company_name || '').toLowerCase() === target
      || label === target;
  });
  if (exact) return exact;

  const partial = companies.filter((company) => {
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

function getServiceOrderVendorRecordById(vendorId) {
  const normalizedId = Number(vendorId || 0) || 0;
  if (!normalizedId) return null;

  return (Array.isArray(serviceOrderVendorPickerDb) ? serviceOrderVendorPickerDb : [])
    .find((entry) => Number(entry.id || 0) === normalizedId)
    || null;
}

function getDefaultServiceOrderOwnCompanyVendor() {
  const currentBusinessEntityId = String(getCurrentBusinessEntityId() || getDefaultBusinessEntityId() || '').trim();
  if (!currentBusinessEntityId) return null;
  return (Array.isArray(serviceOrderVendorPickerDb) ? serviceOrderVendorPickerDb : [])
    .find((entry) => String(entry.business_entity_id || '').trim() === currentBusinessEntityId)
    || null;
}

function applyDefaultServiceOrderVendor() {
  const vendorHidden = document.getElementById('so-vendor-id');
  if (!vendorHidden || String(vendorHidden.value || '').trim()) return;
  const vendor = getDefaultServiceOrderOwnCompanyVendor();
  if (vendor) {
    setServiceOrderVendorSelection(vendor.id, getServiceOrderVendorLabel(vendor));
  }
}

function ensureServiceOrderVendorMatchesCompany(companyId) {
  const normalizedCompanyId = Number(companyId || 0) || 0;
  const vendorHidden = document.getElementById('so-vendor-id');
  const vendorId = Number(vendorHidden?.value || 0) || 0;
  if (!vendorId) return;

  const vendorRecord = getServiceOrderVendorRecordById(vendorId);
  const vendorCompanyId = Number(vendorRecord?.company_id || 0) || 0;
  if (normalizedCompanyId && vendorCompanyId && vendorCompanyId !== normalizedCompanyId) {
    setServiceOrderVendorSelection('', '');
    setServiceOrderFieldMessage('vendor_id', 'Vendor must belong to the selected company.');
  }
}

function filterServiceOrderCompanies(showAll = false) {
  const input = document.getElementById('so-company-search');
  const results = document.getElementById('so-company-results');
  const hidden = document.getElementById('so-company-id');
  if (!input || !hidden || !results) return;

  const query = String(input.value || '').trim().toLowerCase();
  const match = findServiceOrderCompanyBySearchValue(input.value);
  hidden.value = match ? String(match.id) : '';
  setServiceOrderFieldMessage('company_id', '');
  ensureServiceOrderVendorMatchesCompany(hidden.value);

  if (!query && !showAll) {
    results.style.display = 'none';
    results.innerHTML = '';
    return;
  }

  const companies = Array.isArray(serviceOrderCompanyPickerDb) ? serviceOrderCompanyPickerDb : [];
  const filtered = companies.filter((company) => {
    if (!query) return true;
    const haystack = [
      company.company_no,
      company.company_name,
      company.contact_person,
      company.phone,
      company.address,
      getServiceOrderCompanyLabel(company)
    ].map((part) => String(part || '').toLowerCase()).join(' ');
    return haystack.includes(query);
  }).slice(0, 10);

  results.innerHTML = filtered.length ? filtered.map((company) => {
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

function filterServiceOrderVendors(showAll = false) {
  const input = document.getElementById('so-vendor-search');
  const results = document.getElementById('so-vendor-results');
  const hidden = document.getElementById('so-vendor-id');
  if (!input || !results || !hidden) return;

  const query = String(input.value || '').trim().toLowerCase();
  const selectedCompanyId = Number(document.getElementById('so-company-id')?.value || 0) || 0;
  hidden.value = '';
  setServiceOrderFieldMessage('vendor_id', '');

  if (!query && !showAll) {
    results.style.display = 'none';
    results.innerHTML = '';
    return;
  }

  const vendors = Array.isArray(serviceOrderVendorPickerDb) ? serviceOrderVendorPickerDb : [];
  const filtered = vendors.filter((vendor) => {
    const name = String(vendor.vendor_name || '').toLowerCase();
    const contact = String(vendor.contact_person || '').toLowerCase();
    const email = String(vendor.email || '').toLowerCase();
    const phone = String(vendor.phone || '').toLowerCase();
    const companyName = String(vendor.company_name || '').toLowerCase();
    const vendorCompanyId = Number(vendor.company_id || 0) || 0;
    const companyMatch = !selectedCompanyId || !vendorCompanyId || vendorCompanyId === selectedCompanyId;
    return companyMatch && (showAll || name.includes(query) || contact.includes(query) || email.includes(query) || phone.includes(query) || companyName.includes(query));
  }).slice(0, 10);

  results.innerHTML = filtered.length ? filtered.map((vendor) => `
    <div class="search-result-item" data-id="${escHtml(vendor.id)}" data-label="${escHtml(getServiceOrderVendorLabel(vendor))}">
      <div class="search-result-name">${escHtml(`${vendor.vendor_name || 'Vendor'}${Number(vendor.business_entity_id || 0) ? ' - Own company vendor' : ''}${vendor.is_active === undefined || vendor.is_active === null || Number(vendor.is_active) === 1 ? '' : ' [Inactive]'}`)}</div>
      <div class="search-result-sub">${escHtml(vendor.contact_person || vendor.company_name || 'No contact')}${vendor.email ? ` • ${escHtml(vendor.email)}` : ''}${vendor.is_active === undefined || vendor.is_active === null || Number(vendor.is_active) === 1 ? '' : ' • Inactive'}</div>
    </div>
  `).join('') : '<div class="search-result-item search-result-empty">No vendors found</div>';

  results.style.display = 'block';
}

function selectServiceOrderCompany(id, label) {
  setServiceOrderCompanySelection(id, label);
}

function selectServiceOrderVendor(id, label) {
  setServiceOrderVendorSelection(id, label);
}

function syncServiceOrderCompanyFromProject() {
  const projectSelect = document.getElementById('so-project-id');
  const companyInput = document.getElementById('so-company-search');
  const companyHidden = document.getElementById('so-company-id');
  if (!projectSelect || !companyInput || !companyHidden) return;

  const projectId = Number(projectSelect.value || 0);
  if (!projectId) return;

  const project = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
    .find((entry) => Number(entry.id || 0) === projectId);
  if (!project) return;

  populateBusinessEntitySelect('so-business-entity-id', project.business_entity_id || '');
  const companyId = Number(project.company_id || project.registry_company_id || 0);
  if (!companyId) return;

  const companyRecord = (
    Array.isArray(serviceOrderCompanyPickerDb) ? serviceOrderCompanyPickerDb : []
  ).find((entry) => Number(entry.id || 0) === companyId)
    || (
      Array.isArray(companyRegistryDb) ? companyRegistryDb : []
    ).find((entry) => Number(entry.id || 0) === companyId)
    || null;

  if (!companyRecord) return;

  setServiceOrderCompanySelection(companyRecord.id, getServiceOrderCompanyLabel(companyRecord));
  ensureServiceOrderVendorMatchesCompany(companyRecord.id);
}

function setupServiceOrderPickerListeners() {
  const companyResults = document.getElementById('so-company-results');
  const vendorResults = document.getElementById('so-vendor-results');
  if (companyResults?.dataset.serviceOrderPickerBound === '1' && vendorResults?.dataset.serviceOrderPickerBound === '1') {
    return;
  }

  if (companyResults && companyResults.dataset.serviceOrderPickerBound !== '1') {
    companyResults.dataset.serviceOrderPickerBound = '1';
    companyResults.addEventListener('click', (event) => {
      const item = event.target.closest('.search-result-item');
      if (!item || item.classList.contains('search-result-empty')) return;
      selectServiceOrderCompany(item.dataset.id, item.dataset.label);
    });
  }

  if (vendorResults && vendorResults.dataset.serviceOrderPickerBound !== '1') {
    vendorResults.dataset.serviceOrderPickerBound = '1';
    vendorResults.addEventListener('click', (event) => {
      const item = event.target.closest('.search-result-item');
      if (!item || item.classList.contains('search-result-empty')) return;
      selectServiceOrderVendor(item.dataset.id, item.dataset.label);
    });
  }

  if (document.body && document.body.dataset.serviceOrderPickerDocBound !== '1') {
    document.body.dataset.serviceOrderPickerDocBound = '1';
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.service-order-company-search')) {
        if (companyResults) {
          companyResults.style.display = 'none';
          companyResults.innerHTML = '';
        }
      }
      if (!event.target.closest('.service-order-vendor-search')) {
        if (vendorResults) {
          vendorResults.style.display = 'none';
          vendorResults.innerHTML = '';
        }
      }
    });
  }
}

async function prefillAdminServiceOrderNumber() {
  const input = document.getElementById('so-docno');
  if (!input || editingServiceOrderId) return;
  input.value = '';
  try {
    const res = await fetch(`/api/service-orders/next-number?business_entity_id=${encodeURIComponent(getCurrentBusinessEntityId() || getDefaultBusinessEntityId() || '')}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.so_number && !input.value) {
      input.value = data.so_number;
    }
  } catch (_) {
    // Server still generates the number on save.
  }
}

function updateServiceOrderModalLabels() {
  const titleNode = document.getElementById('service-order-modal-title');
  const saveBtn = document.getElementById('service-order-save-btn');
  const isEdit = Number(editingServiceOrderId || 0) > 0;

  if (titleNode) {
    titleNode.textContent = isEdit ? 'Edit Service Order' : 'Service Order Entry';
  }

  if (saveBtn) {
    saveBtn.textContent = isEdit ? 'Update Service Order' : 'Save Service Order';
  }
}

function setServiceOrderSaveButtonState(isBusy) {
  const saveBtn = document.getElementById('service-order-save-btn');
  if (!saveBtn) return;
  saveBtn.disabled = Boolean(isBusy);
  saveBtn.textContent = isBusy
    ? 'Saving...'
    : (Number(editingServiceOrderId || 0) > 0 ? 'Update Service Order' : 'Save Service Order');
}

// Service Order Functions
async function openServiceOrderModal(id = null) {
  var modal = document.getElementById('service-order-modal-backdrop');
  if (!modal) return;

  const normalizedId =
    typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id))
      ? Number(id)
      : null;
  editingServiceOrderId = normalizedId;

  try {
    await loadServiceOrderPickerData();
  } catch (err) {
    console.error('Load service order picker data error:', err);
    showToast(err.message || 'Unable to load service order pickers.', 'error');
    editingServiceOrderId = null;
    updateServiceOrderModalLabels();
    return;
  }

  clearServiceOrderFieldMessages();
  document.getElementById('so-docno').value = '';
  document.getElementById('so-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('so-project-id').value = '';
  document.getElementById('so-title').value = '';
  document.getElementById('so-amount').value = '';
  document.getElementById('so-notes').value = '';
  document.getElementById('so-status').value = 'issued';
  populateBusinessEntitySelect('so-business-entity-id');
  setServiceOrderVendorSelection('', '');
  setServiceOrderCompanySelection('', '');
  applyDefaultServiceOrderVendor();
  if (!normalizedId) {
    await prefillAdminServiceOrderNumber();
  }

  populateServiceOrderProjectSelect();
  const projectSelect = document.getElementById('so-project-id');
  if (projectSelect && !projectSelect.dataset.serviceOrderBound) {
    projectSelect.addEventListener('change', syncServiceOrderCompanyFromProject);
    projectSelect.dataset.serviceOrderBound = '1';
  }

  if (normalizedId) {
    try {
      await loadServiceOrdersData(true);
    } catch (err) {
      editingServiceOrderId = null;
      updateServiceOrderModalLabels();
      showToast(err.message || 'Unable to load service order data.', 'error');
      return;
    }

    const row = (Array.isArray(serviceOrdersDb) ? serviceOrdersDb : [])
      .find((entry) => Number(entry.id || 0) === normalizedId);

    if (!row) {
      editingServiceOrderId = null;
      updateServiceOrderModalLabels();
      showToast('Service order not found.', 'error');
      return;
    }

    const companyRecord = getServiceOrderCompanyRecordById(row.company_id);
    const vendorRecord = getServiceOrderVendorRecordById(row.vendor_id);
    const projectId = Number(row.project_id || 0) || '';
    const serviceTypeValue = normalizeServiceOrderType(row.service_type || 'installation');
    const statusValue = normalizeServiceOrderStatus(row.status || 'issued');
    const serviceDate = String(row.service_date || '').slice(0, 10) || new Date().toISOString().split('T')[0];

    document.getElementById('so-docno').value = row.so_number || '';
    document.getElementById('so-date').value = serviceDate;
    document.getElementById('so-title').value = row.service_title || row.description || '';
    document.getElementById('so-amount').value = Number(row.total_amount || 0) || '';
    document.getElementById('so-notes').value = row.notes || '';
    document.getElementById('so-type').value = serviceTypeValue;
    document.getElementById('so-status').value = statusValue === 'draft' ? 'issued' : statusValue;
    document.getElementById('so-project-id').value = projectId || '';
    populateBusinessEntitySelect('so-business-entity-id', row.business_entity_id || '');

    if (projectId) {
      syncServiceOrderCompanyFromProject();
    } else if (companyRecord) {
      setServiceOrderCompanySelection(companyRecord.id, getServiceOrderCompanyLabel(companyRecord));
    }

    if (vendorRecord) {
      setServiceOrderVendorSelection(vendorRecord.id, getServiceOrderVendorLabel(vendorRecord));
    }
  }

  updateServiceOrderModalLabels();

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeServiceOrderModal() {
  var modal = document.getElementById('service-order-modal-backdrop');
  if (modal) modal.style.display = 'none';
  clearServiceOrderFieldMessages();
  editingServiceOrderId = null;
  updateServiceOrderModalLabels();
  setServiceOrderSaveButtonState(false);
  document.body.style.overflow = '';
}

async function saveServiceOrder() {
  const isEdit = Number(editingServiceOrderId || 0) > 0;
  clearServiceOrderFieldMessages();
  if (!isEdit && !String(document.getElementById('so-docno')?.value || '').trim()) {
    await prefillAdminServiceOrderNumber();
  }
  filterServiceOrderCompanies();
  const vendorId = Number(document.getElementById('so-vendor-id')?.value || 0) || 0;
  const companyId = Number(document.getElementById('so-company-id').value || 0) || 0;
  const companyInput = document.getElementById('so-company-search').value.trim();
  const title = document.getElementById('so-title').value.trim();
  const serviceType = normalizeServiceOrderType(document.getElementById('so-type').value || 'installation');
  const status = normalizeServiceOrderStatus(document.getElementById('so-status').value || 'issued');
  const finalStatus = status === 'draft' ? 'issued' : status;
  const projectId = Number(document.getElementById('so-project-id').value || 0) || null;
  const selectedProject = projectId
    ? (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : []).find((entry) => Number(entry.id || 0) === projectId)
    : null;
  const businessEntitySelect = document.getElementById('so-business-entity-id');
  const businessEntityId = businessEntitySelect?.value || selectedProject?.business_entity_id || getDefaultBusinessEntityId() || '';
  if (businessEntitySelect) businessEntitySelect.value = businessEntityId;
  const projectCompanyId = Number(selectedProject?.company_id || selectedProject?.registry_company_id || 0) || 0;
  const companyRecord = getServiceOrderCompanyRecordById(companyId);
  const soNumber = String(document.getElementById('so-docno')?.value || '').trim();
  let firstInvalidField = null;
  const markServiceOrderError = (fieldName, message) => {
    setServiceOrderFieldMessage(fieldName, message);
    if (!firstInvalidField) firstInvalidField = fieldName;
  };

  if (!soNumber || !title || !companyId || !serviceType) {
    if (!soNumber) markServiceOrderError('so_number', 'SO Number is required.');
    if (!title) markServiceOrderError('service_title', 'Service title is required.');
    if (!serviceType) markServiceOrderError('service_type', 'Service type is required.');
    if (!companyId) markServiceOrderError('company_id', 'Company selection is required.');
    focusFirstModalField(firstInvalidField, {
      service_title: ['so-title'],
      service_type: ['so-type'],
      company_id: ['so-company-search'],
      project_id: ['so-project-id'],
      so_number: ['so-docno']
    });
    return;
  }

  if (!companyRecord) {
    setServiceOrderFieldMessage('company_id', 'Type an exact company no/name, or a search with one match.');
    focusFirstModalControl(['so-company-search']);
    return;
  }

  if (projectId && projectCompanyId && companyId !== projectCompanyId) {
    setServiceOrderFieldMessage('company_id', 'Selected company must match the project company.');
    focusFirstModalControl(['so-company-search']);
    return;
  }

  const amount = parseFloat(document.getElementById('so-amount').value) || 0;
  const notes = String(document.getElementById('so-notes').value || '').trim();
  const payload = {
    so_number: soNumber,
    doc_no: soNumber,
    service_date: document.getElementById('so-date').value,
    so_date: document.getElementById('so-date').value,
    service_type: serviceType,
    business_entity_id: businessEntityId,
    vendor_id: vendorId || null,
    company_id: companyId,
    company_name: companyInput,
    project_id: projectId,
    service_title: title,
    title,
    description: title,
    total_amount: amount,
    amount,
    notes,
    status: finalStatus
  };

  try {
    setServiceOrderSaveButtonState(true);
    const res = await fetch(isEdit ? `/api/service-orders/${editingServiceOrderId}` : '/api/service-orders', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.success) {
      throw new Error(result.error || result.message || 'Error saving service order');
    }

    const successMessage = result.linked_transaction_docno
      ? (isEdit
          ? `Service Order updated and transaction ${result.linked_transaction_docno} synced.`
          : `Service Order saved and transaction ${result.linked_transaction_docno} created.`)
      : (isEdit ? 'Service Order updated successfully!' : 'Service Order saved successfully!');
    showToast(result.warning || successMessage, result.warning ? 'error' : 'success');
    closeServiceOrderModal();
    await Promise.all([
      loadRecords(),
      loadServiceOrdersData(true)
    ]);
    renderServiceOrdersTable();
    editingServiceOrderId = null;
    updateServiceOrderModalLabels();
  } catch (err) {
    console.error('Save SO error:', err);
    const errorText = String(err?.message || '').toLowerCase();
    let handled = false;
    if (errorText.includes('already exists') || errorText.includes('duplicate')) {
      setServiceOrderFieldMessage('so_number', 'Service order number already exists.');
      focusFirstModalControl(['so-docno']);
      handled = true;
    } else if (errorText.includes('selected project was not found')) {
      setServiceOrderFieldMessage('project_id', err.message || 'Selected project was not found.');
      focusFirstModalControl(['so-project-id']);
      handled = true;
    } else if (errorText.includes('company is required') || errorText.includes('select a project') || errorText.includes('selected company must match')) {
      setServiceOrderFieldMessage('company_id', err.message || 'Company selection is required.');
      focusFirstModalControl(['so-company-search']);
      handled = true;
    } else if (errorText.includes('service title is required')) {
      setServiceOrderFieldMessage('service_title', err.message || 'Service title is required.');
      focusFirstModalControl(['so-title']);
      handled = true;
    }

    if (!handled) {
      showToast(err.message || 'Error saving service order', 'error');
    }
  } finally {
    setServiceOrderSaveButtonState(false);
  }
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
  if (!i) return;
  const query = String(i.value || '').trim();
  const hidden = document.getElementById('p-company-id');
  const matches = getRegistryCompanySearchMatches(query);
  const match = matches.exact || (matches.partial.length === 1 ? matches.partial[0] : null);

  if (hidden) hidden.value = match ? String(match.id) : '';

  if (!query) {
    setProjectFieldHint('company', '');
  } else if (match) {
    setProjectFieldHint('company', `Matched: ${getRegistryCompanyLabel(match)}`);
  } else {
    if (matches.partial.length > 1) {
      setProjectFieldHint('company', `${matches.partial.length} companies match. Type the exact company no or full company name.`);
    } else {
      setProjectFieldHint('company', 'No company matched. Check the company no or company name.');
    }
  }

  renderProjectCompanySuggestions(matches.partial, query);
}

function renderProjectCompanySuggestions(matches = [], query = '') {
  const r = document.getElementById('p-company-results');
  if (!r) return;

  const searchText = String(query || '').trim();
  const visibleMatches = Array.isArray(matches)
    ? matches.filter((company) => Number(company?.id || 0)).slice(0, 10)
    : [];

  if (!searchText || !visibleMatches.length) {
    r.style.display = 'none';
    r.innerHTML = '';
    return;
  }

  r.innerHTML = visibleMatches.map((company) => {
    const id = Number(company.id || 0);
    const label = getRegistryCompanyLabel(company);
    const address = String(company.address || '').trim();
    const archivedTag = Number(company.archived || 0) ? ' [Archived]' : '';

    return `
      <button type="button" class="search-result-item" data-company-id="${id}">
        <span class="search-result-name">${escHtml(label)}${archivedTag}</span>
        ${address ? `<span class="search-result-sub">${escHtml(address)}</span>` : ''}
      </button>
    `;
  }).join('');
  r.style.display = 'grid';
}

function resolveProjectCompanySearch() {
  const input = document.getElementById('p-company-search');
  const hidden = document.getElementById('p-company-id');
  const results = document.getElementById('p-company-results');
  if (!input || !hidden) return null;

  const match = findRegistryCompanyBySearchValue(input.value);
  hidden.value = match ? String(match.id) : '';
  if (results) {
    results.style.display = 'none';
    results.innerHTML = '';
  }
  return match;
}

function selectProjectCompany(id, name) {
  const h = document.getElementById('p-company-id');
  const i = document.getElementById('p-company-search');
  const r = document.getElementById('p-company-results');
  if (h) h.value = id;
  if (i) i.value = name;
  setProjectFieldMessage('company', '');
  if (r) {
    r.style.display = 'none';
    r.innerHTML = '';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadProjectCompanies();
  const r = document.getElementById('p-company-results');
  if (r) {
    r.style.display = 'none';
    r.innerHTML = '';
    r.addEventListener('click', (event) => {
      const item = event.target.closest('[data-company-id]');
      if (!item) return;
      const company = findRegistryCompanyById(item.dataset.companyId);
      if (!company) return;
      selectProjectCompany(company.id, getRegistryCompanyLabel(company));
    });
  }

  document.addEventListener('click', (event) => {
    const wrap = document.querySelector('.project-company-search');
    const results = document.getElementById('p-company-results');
    if (!wrap || !results || wrap.contains(event.target)) return;
    results.style.display = 'none';
  });
});
