(function () {
  'use strict';

  const STAFF_CARD_IDS = [
    'stat-card-company-registry',
    'stat-card-projects',
    'stat-card-service-operations',
    'stat-card-staff-workspace',
    'stat-card-procurement',
    'stat-card-inventory'
  ];

  function syncStaffDashboardCards() {
    const row = document.getElementById('dashboard-summary-cards');
    if (!row) return;

    const params = new URLSearchParams(window.location.search || '');
    const activePanel = String(
      document.body?.dataset?.dashboardPanel
      || document.body?.dataset?.initialDashboardPanel
      || params.get('panel')
      || 'home'
    ).trim() || 'home';
    if (activePanel !== 'home') {
      row.style.setProperty('display', 'none', 'important');
      return;
    }

    row.style.setProperty('display', 'flex', 'important');
    row.style.setProperty('flex-wrap', 'wrap', 'important');
    row.style.setProperty('gap', '14px', 'important');
    row.style.removeProperty('grid-template-columns');
    row.style.removeProperty('grid-auto-flow');

    STAFF_CARD_IDS.forEach(function (id, index) {
      const card = document.getElementById(id);
      if (!card) return;
      card.style.setProperty('display', 'grid', 'important');
      card.style.setProperty('visibility', 'visible', 'important');
      card.style.setProperty('grid-column', 'auto', 'important');
      card.style.setProperty('grid-row', 'auto', 'important');
      card.style.setProperty('order', String(index), 'important');
      card.setAttribute('aria-hidden', 'false');
      card.dataset.dashboardRole = 'staff';
    });

    if (document.documentElement && document.documentElement.dataset) {
      document.documentElement.dataset.dashboardCardsReady = '1';
    }
    if (document.body && document.body.dataset) {
      document.body.dataset.dashboardCardsReady = '1';
    }
  }

  window.KinaadmanStaffDashboardCards = {
    ids: STAFF_CARD_IDS.slice(),
    render: syncStaffDashboardCards
  };

  window.KinaadmanDashboardCards = {
    render: syncStaffDashboardCards,
    register: function () {}
  };

  document.addEventListener('DOMContentLoaded', syncStaffDashboardCards);
})();
