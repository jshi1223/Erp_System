(function () {
  'use strict';

  const roleNavigationRegistry = {};

  function registerRoleNavigation(role, items) {
    const key = String(role || '').trim().toLowerCase();
    if (!key || !Array.isArray(items)) return;
    roleNavigationRegistry[key] = items;
  }

  function normalizeRole(role) {
    const key = String(role || 'staff').trim().toLowerCase();
    return ['super_admin', 'admin', 'staff'].includes(key) ? key : 'staff';
  }

  function makeLink(item) {
    const link = document.createElement('a');
    link.href = item.href || '#';
    link.className = `sidebar-link${item.subitem ? ' is-subitem' : ''}`;
    if (item.id) link.id = item.id;
    if (item.adminOnly) link.dataset.adminOnly = '1';
    link.textContent = item.label || item.href || 'Menu';
    return link;
  }

  function makeGroup(group) {
    const wrap = document.createElement('div');
    wrap.className = 'sidebar-group';
    wrap.dataset.sidebarGroup = group.key || '';
    if (group.collapsed) wrap.dataset.sidebarDefaultCollapsed = '1';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sidebar-group-toggle';
    button.setAttribute('onclick', 'toggleSidebarGroup(this)');
    button.setAttribute('aria-expanded', group.collapsed ? 'false' : 'true');
    button.innerHTML = `<span>${group.label || 'Group'}</span><span class="sidebar-group-caret" aria-hidden="true">&#9662;</span>`;

    const items = document.createElement('div');
    items.className = 'sidebar-group-items';
    (group.items || []).forEach((item) => items.appendChild(makeLink({ ...item, subitem: true })));

    wrap.appendChild(button);
    wrap.appendChild(items);
    return wrap;
  }

  function getPrimarySidebar() {
    const sidebars = Array.from(document.querySelectorAll('.sidebar'));
    const primary = document.getElementById('sidebar') || sidebars[0] || null;
    sidebars.forEach((sidebar) => {
      if (sidebar !== primary) sidebar.remove();
    });
    if (primary && primary.id !== 'sidebar') primary.id = 'sidebar';
    return primary;
  }

  function removeDuplicateSidebarOverlays() {
    const overlays = Array.from(document.querySelectorAll('#sidebar-overlay, .sidebar-overlay'));
    let primary = document.getElementById('sidebar-overlay') || overlays[0] || null;
    overlays.forEach((overlay) => {
      if (overlay === primary) return;
      overlay.remove();
    });
    if (primary && primary.id !== 'sidebar-overlay') primary.id = 'sidebar-overlay';
  }

  function renderRoleNavigation(roleValue) {
    const role = normalizeRole(roleValue);
    removeDuplicateSidebarOverlays();

    const sidebar = getPrimarySidebar();
    const nav = sidebar?.querySelector('.sidebar-nav');
    if (!nav) return;

    const config = roleNavigationRegistry[role] || roleNavigationRegistry.staff || [];
    nav.innerHTML = '';
    config.forEach((item) => {
      nav.appendChild(item.type === 'group' ? makeGroup(item) : makeLink(item));
    });
    if (sidebar.dataset) {
      sidebar.dataset.adminRoleSidebar = '1';
      sidebar.dataset.roleNavigationRendered = '1';
      sidebar.dataset.sharedSidebarRendered = 'role-managed';
    }

    if (typeof syncSidebarGroupStates === 'function') syncSidebarGroupStates();
    if (typeof syncSidebarActiveLinks === 'function') syncSidebarActiveLinks();
    if (document.documentElement && document.documentElement.dataset) {
      document.documentElement.dataset.sidebarReady = '1';
    }
  }

  window.KinaadmanAdminNavigation = {
    register: registerRoleNavigation,
    render: renderRoleNavigation
  };
})();
