(function () {
  'use strict';

  function applyStaffRoleState() {
    if (document.documentElement && document.documentElement.dataset) {
      document.documentElement.dataset.accessRole = 'staff';
      document.documentElement.dataset.dashboardCardsReady = '1';
      document.documentElement.dataset.sidebarReady = '1';
    }
    if (!document.body) return;
    document.body.dataset.accessRole = 'staff';
    document.body.classList.add('is-staff-role');
    document.body.classList.remove('is-admin-role', 'is-super-admin-role');
  }

  function syncStaffSidebarActive() {
    const nav = document.querySelector('#sidebar .sidebar-nav');
    if (!nav) return;
    const params = new URLSearchParams(window.location.search || '');
    const panel = String(params.get('panel') || '').trim();
    const tab = String(params.get('tab') || '').trim();
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    let activeId = 'menu-dashboard';

    if (panel === 'project-records' || panel === 'project-ledger' || panel === 'ongoing-projects') activeId = 'menu-projects';
    else if (path === '/master-data') activeId = 'menu-company-registry';
    else if (path === '/sales-management') activeId = 'menu-sales-management';
    else if (path === '/service-operations') activeId = 'menu-service-operations';
    else if (path === '/inventory') activeId = 'menu-inventory';
    else if (path === '/procurement' || tab === 'requisitions') activeId = 'menu-procurement';

    nav.querySelectorAll('.sidebar-link').forEach(function (link) {
      link.classList.toggle('active', link.id === activeId);
    });
    nav.querySelectorAll('.sidebar-group').forEach(function (group) {
      const hasActive = Boolean(group.querySelector('.sidebar-link.active'));
      const toggle = group.querySelector('.sidebar-group-toggle');
      group.classList.toggle('is-collapsed', !hasActive);
      if (toggle) toggle.setAttribute('aria-expanded', hasActive ? 'true' : 'false');
    });
  }

  window.KinaadmanRoleFlow = {
    apply: function () {
      applyStaffRoleState();
      window.KinaadmanStaffDashboardCards?.render();
      syncStaffSidebarActive();
    },
    register: function () {}
  };

  window.KinaadmanDashboardCards = {
    render: function () {
      applyStaffRoleState();
      window.KinaadmanStaffDashboardCards?.render();
    },
    register: function () {}
  };

  applyStaffRoleState();
  document.addEventListener('DOMContentLoaded', function () {
    applyStaffRoleState();
    window.KinaadmanStaffDashboardCards?.render();
    syncStaffSidebarActive();
  });
})();
