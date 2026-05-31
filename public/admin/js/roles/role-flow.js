(function () {
  'use strict';

  const roleFlowRegistry = {};

  function normalizeRole(role) {
    const key = String(role || 'staff').trim().toLowerCase();
    return ['super_admin', 'admin', 'staff'].includes(key) ? key : 'staff';
  }

  function registerRoleFlow(role, flow) {
    const key = normalizeRole(role);
    roleFlowRegistry[key] = flow && typeof flow === 'object' ? flow : {};
  }

  function loadRoleStylesheet(role) {
    document.documentElement?.setAttribute('data-access-role', normalizeRole(role));
  }

  function applyRoleFlow(roleValue, user) {
    const role = normalizeRole(roleValue);
    const flow = roleFlowRegistry[role] || roleFlowRegistry.staff || {};

    loadRoleStylesheet(role);

    document.body?.setAttribute('data-access-role', role);
    document.body?.classList.toggle('is-staff-role', role === 'staff');
    document.body?.classList.toggle('is-admin-role', role === 'admin' || role === 'super_admin');
    document.body?.classList.toggle('is-super-admin-role', role === 'super_admin');

    window.KinaadmanAdminNavigation?.render(role);

    if (typeof flow.apply === 'function') {
      flow.apply({ role, user });
    }

    window.KinaadmanDashboardCards?.render(role);
  }

  window.KinaadmanRoleFlow = {
    register: registerRoleFlow,
    apply: applyRoleFlow
  };
})();
