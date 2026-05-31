(function () {
  'use strict';

  const roleDashboardCardRegistry = {};
  const dashboardCardTemplates = new Map();
  const roleDashboardCardStores = new Map();
  let activeDashboardRole = '';

  function normalizeRole(role) {
    const key = String(role || 'staff').trim().toLowerCase();
    return ['super_admin', 'admin', 'staff'].includes(key) ? key : 'staff';
  }

  function registerRoleDashboardCards(role, cardIds) {
    const key = normalizeRole(role);
    roleDashboardCardRegistry[key] = Array.isArray(cardIds) ? cardIds.map(String) : [];
  }

  function getDashboardStatsRow() {
    return document.getElementById('dashboard-summary-cards')
      || document.querySelector('#dashboard > main > .dashboard-stats');
  }

  function collectDashboardCardTemplates(row) {
    if (!row) return;
    row.querySelectorAll(':scope > .stat-card[id^="stat-card-"]').forEach((card) => {
      if (!dashboardCardTemplates.has(card.id)) {
        dashboardCardTemplates.set(card.id, card.cloneNode(true));
      }
    });
    const staffTemplate = document.getElementById('staff-workspace-card-template');
    const staffCard = staffTemplate?.content?.firstElementChild?.cloneNode(true);
    if (staffCard?.id && !dashboardCardTemplates.has(staffCard.id)) {
      dashboardCardTemplates.set(staffCard.id, staffCard);
    }
  }

  function getRoleCardStore(role) {
    if (!roleDashboardCardStores.has(role)) {
      roleDashboardCardStores.set(role, new Map());
    }
    return roleDashboardCardStores.get(role);
  }

  function createStaffWorkspaceCard() {
    const card = document.createElement('div');
    card.className = 'stat-card stat-card-warning stat-card-link';
    card.id = 'stat-card-staff-workspace';
    card.setAttribute('onclick', 'openStaffWorkspaceFromDashboard()');
    card.innerHTML = [
      '<div class="stat-icon" aria-hidden="true">',
        '<svg viewBox="0 0 24 24"><path d="M7 7h10M7 12h10M7 17h6"></path><rect x="5" y="4" width="14" height="16" rx="2"></rect></svg>',
      '</div>',
      '<div class="stat-label">Staff Workspace</div>',
      '<div class="stat-val gold" id="stat-staff-workspace">0</div>',
      '<div class="stat-mini" id="stat-staff-workspace-mini">My requests and assigned work</div>'
    ].join('');
    return card;
  }

  function renderRoleDashboardCards(roleValue) {
    const role = normalizeRole(roleValue);
    const visibleIds = roleDashboardCardRegistry[role] || roleDashboardCardRegistry.staff || [];
    const row = getDashboardStatsRow();

    collectDashboardCardTemplates(row);

    if (row) {
      if (role === 'staff') {
        row.style.setProperty('display', 'flex', 'important');
        row.style.setProperty('flex-wrap', 'wrap', 'important');
        row.style.setProperty('gap', '14px', 'important');
        row.style.removeProperty('grid-template-columns');
        row.style.removeProperty('grid-auto-flow');
      } else {
        row.style.removeProperty('display');
        row.style.removeProperty('flex-wrap');
        row.style.removeProperty('gap');
        row.style.removeProperty('grid-template-columns');
        row.style.removeProperty('grid-auto-flow');
      }

      const existingCards = new Map();
      row.querySelectorAll(':scope > .stat-card[id^="stat-card-"]').forEach((card) => {
        existingCards.set(card.id, card);
      });
      const roleStore = getRoleCardStore(role);
      existingCards.forEach((card, id) => roleStore.set(id, card));

      const nextCards = visibleIds.map((id, index) => {
        let card = existingCards.get(id) || roleStore.get(id);
        if (!card) {
          const template = dashboardCardTemplates.get(id) || document.getElementById(id)?.cloneNode(true);
          card = template ? template.cloneNode(true) : (id === 'stat-card-staff-workspace' ? createStaffWorkspaceCard() : null);
          if (card) roleStore.set(id, card);
        }
        if (!card) return null;
        if (id === 'stat-card-staff-workspace' && role === 'staff') {
          delete card.dataset.staffOnly;
        }
        card.style.setProperty('display', 'grid', 'important');
        card.style.setProperty('visibility', 'visible', 'important');
        card.style.setProperty('grid-column', 'auto', 'important');
        card.style.setProperty('grid-row', 'auto', 'important');
        card.style.setProperty('order', String(index), 'important');
        if (role === 'staff') {
          card.style.setProperty('flex', '0 1 calc((100% - 28px) / 3)', 'important');
          card.style.setProperty('max-width', 'calc((100% - 28px) / 3)', 'important');
        } else {
          card.style.removeProperty('flex');
          card.style.removeProperty('max-width');
        }
        card.setAttribute('aria-hidden', 'false');
        card.dataset.dashboardRole = role;
        if ('disabled' in card) card.disabled = false;
        return card;
      }).filter(Boolean);

      row.replaceChildren(...nextCards);
    }

    activeDashboardRole = role;

    if (document.documentElement && document.documentElement.dataset) {
      document.documentElement.dataset.dashboardCardsReady = '1';
    }
    if (document.body && document.body.dataset) {
      document.body.dataset.dashboardCardsReady = '1';
    }
  }

  window.KinaadmanDashboardCards = {
    register: registerRoleDashboardCards,
    render: renderRoleDashboardCards
  };
})();
