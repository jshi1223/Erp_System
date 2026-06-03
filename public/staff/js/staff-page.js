(function () {
  'use strict';

  const STAFF_STATUS_POLL_MS = 30000;
  let staffStatusPollTimer = null;
  let staffStatusPollBusy = false;
  let staffLastStatusMap = null;

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
    else if (path === '/inventory') activeId = tab === 'requests' ? 'menu-inventory-requests' : 'menu-inventory';
    else if (path === '/procurement') activeId = tab === 'requests' ? 'menu-procurement-requests' : 'menu-procurement';
    else if (tab === 'requisitions') activeId = 'menu-procurement';

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

  function normalizeStaffStatus(value) {
    return String(value || '').trim().toLowerCase();
  }

  function staffStatusIn(value, statuses) {
    return statuses.includes(normalizeStaffStatus(value));
  }

  async function fetchStaffJson(url) {
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    const data = await response.json().catch(() => []);
    if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
    return Array.isArray(data) ? data : [];
  }

  function formatBadgeCount(count) {
    const value = Number(count || 0);
    return value > 99 ? '99+' : String(Math.max(0, value));
  }

  function setStaffBadge(target, count, title, tone = 'attention') {
    if (!target) return;
    const value = Number(count || 0);
    let badge = target.querySelector(':scope > .staff-action-badge');
    if (value <= 0) {
      badge?.remove();
      target.classList.remove('has-staff-action');
      target.removeAttribute('data-staff-action-count');
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'staff-action-badge';
      target.appendChild(badge);
    }
    badge.textContent = formatBadgeCount(value);
    badge.title = title || `${value} item${value === 1 ? '' : 's'} need attention`;
    badge.setAttribute('aria-label', badge.title);
    badge.dataset.tone = tone;
    target.classList.add('has-staff-action');
    target.dataset.staffActionCount = String(value);
  }

  function setStaffCardBadge(cardId, count, title, tone) {
    setStaffBadge(document.getElementById(cardId), count, title, tone);
  }

  function setStaffSidebarBadge(linkId, count, title, tone) {
    setStaffBadge(document.getElementById(linkId), count, title, tone);
  }

  function pluralizeStaffLabel(singular, count) {
    return `${count} ${singular}${Number(count || 0) === 1 ? '' : 's'}`;
  }

  function buildStaffBadgeTitle(label, count, actionCount) {
    const total = Number(count || 0);
    const actions = Number(actionCount || 0);
    if (actions > 0) return `${pluralizeStaffLabel(label, actions)} ${actions === 1 ? 'needs' : 'need'} revision or draft action`;
    return `${pluralizeStaffLabel(label, total)} ${total === 1 ? 'is' : 'are'} waiting for approval`;
  }

  function getStaffWatchedStatus(value) {
    const status = normalizeStaffStatus(value);
    return ['draft', 'submitted', 'pending', 'approved', 'needs_revision', 'rejected', 'cancelled'].includes(status) ? status : '';
  }

  function addStaffWatchedItems(bucket, rows, options = {}) {
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const status = getStaffWatchedStatus(row.status || row.approval_status);
      const id = Number(row.id || row.request_id || 0) || 0;
      if (!status || !id) return;
      bucket.push({
        key: `${options.type || 'record'}|${id}`,
        type: options.type || 'Record',
        title: String(options.title?.(row) || row.request_no || row.pr_number || row.project_docno || row.project_name || row.status || `#${id}`).trim(),
        status,
        url: options.url || '/staff'
      });
    });
  }

  function buildStaffStatusMap(items = []) {
    const map = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      map.set(item.key, item);
    });
    return map;
  }

  function formatStaffStatusLabel(status) {
    const normalized = normalizeStaffStatus(status).replace(/_/g, ' ');
    return normalized.replace(/\b\w/g, match => match.toUpperCase());
  }

  function openStaffStatusToastTarget(url = '/staff') {
    if (typeof navigateDashboardCard === 'function') {
      navigateDashboardCard(url);
      return;
    }
    window.location.href = url;
  }

  function showStaffStatusToast(message, url = '/staff') {
    const toast = document.getElementById('toast');
    if (!toast) {
      if (typeof showToast === 'function') showToast(message, 'success');
      return;
    }
    clearTimeout(toast._timer);
    toast.textContent = message;
    toast.className = 'show success approval-toast-clickable';
    toast.setAttribute('role', 'button');
    toast.setAttribute('tabindex', '0');
    toast.setAttribute('title', 'Open request');
    toast.onclick = () => openStaffStatusToastTarget(url);
    toast.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openStaffStatusToastTarget(url);
      }
    };
    toast._timer = window.setTimeout(() => {
      toast.className = '';
      toast.onclick = null;
      toast.onkeydown = null;
      toast.removeAttribute('role');
      toast.removeAttribute('tabindex');
      toast.removeAttribute('title');
    }, 6000);
  }

  async function syncStaffActionBadges() {
    if (normalizeStaffStatus(document.body?.dataset?.accessRole) !== 'staff') return;
    const requestStatuses = ['draft', 'submitted', 'pending', 'needs_revision', 'rejected'];
    const actionStatuses = ['draft', 'needs_revision', 'rejected'];
    const watchedItems = [];

    try {
      const projects = await fetchStaffJson('/api/projects?include_archived=1');
      const projectRequests = projects.filter(row => staffStatusIn(row.status, requestStatuses));
      const projectActions = projectRequests.filter(row => staffStatusIn(row.status, actionStatuses));
      const title = buildStaffBadgeTitle('project request', projectRequests.length, projectActions.length);
      setStaffCardBadge('stat-card-projects', projectRequests.length, title, projectActions.length ? 'attention' : 'waiting');
      setStaffSidebarBadge('menu-projects', projectRequests.length, title, projectActions.length ? 'attention' : 'waiting');
      addStaffWatchedItems(watchedItems, projects, {
        type: 'Project',
        url: '/staff?panel=project-records',
        title: row => (typeof getProjectLinkLabel === 'function' ? getProjectLinkLabel(row) : '') || row.project_docno || row.project_name
      });
    } catch (_) {
      setStaffCardBadge('stat-card-projects', 0);
      setStaffSidebarBadge('menu-projects', 0);
    }

    try {
      const [companyRequests, vendorRequests] = await Promise.all([
        fetchStaffJson('/api/company-registry-requests'),
        fetchStaffJson('/api/vendor-registry-requests')
      ]);
      const masterRequests = companyRequests.concat(vendorRequests).filter(row => staffStatusIn(row.status, requestStatuses));
      const masterActions = masterRequests.filter(row => staffStatusIn(row.status, actionStatuses));
      const title = buildStaffBadgeTitle('master data request', masterRequests.length, masterActions.length);
      setStaffCardBadge('stat-card-company-registry', masterRequests.length, title, masterActions.length ? 'attention' : 'waiting');
      setStaffSidebarBadge('menu-master-data-requests', masterRequests.length, title, masterActions.length ? 'attention' : 'waiting');
      addStaffWatchedItems(watchedItems, companyRequests, {
        type: 'Company Request',
        url: '/master-data?tab=companies',
        title: row => row.request_no || row.payload?.company_name
      });
      addStaffWatchedItems(watchedItems, vendorRequests, {
        type: 'Vendor Request',
        url: '/master-data?tab=vendors',
        title: row => row.request_no || row.payload?.vendor_name
      });
    } catch (_) {
      setStaffCardBadge('stat-card-company-registry', 0);
      setStaffSidebarBadge('menu-master-data-requests', 0);
    }

    try {
      const requisitions = await fetchStaffJson('/api/procurement/requisitions');
      const prRequests = requisitions.filter(row => staffStatusIn(row.status, requestStatuses));
      const prActions = prRequests.filter(row => staffStatusIn(row.status, actionStatuses));
      const title = buildStaffBadgeTitle('PR request', prRequests.length, prActions.length);
      setStaffCardBadge('stat-card-procurement', prRequests.length, title, prActions.length ? 'attention' : 'waiting');
      setStaffSidebarBadge('menu-procurement-requests', prRequests.length, title, prActions.length ? 'attention' : 'waiting');
      addStaffWatchedItems(watchedItems, requisitions, {
        type: 'Purchase Requisition',
        url: '/procurement?tab=requisitions',
        title: row => row.pr_number || row.item_summary
      });
    } catch (_) {
      setStaffCardBadge('stat-card-procurement', 0);
      setStaffSidebarBadge('menu-procurement-requests', 0);
    }

    try {
      const inventoryRequests = await fetchStaffJson('/api/inventory/requests');
      const pendingInventory = inventoryRequests.filter(row => staffStatusIn(row.status, requestStatuses));
      const inventoryActions = pendingInventory.filter(row => staffStatusIn(row.status, actionStatuses));
      const title = buildStaffBadgeTitle('inventory request', pendingInventory.length, inventoryActions.length);
      setStaffCardBadge('stat-card-inventory', pendingInventory.length, title, inventoryActions.length ? 'attention' : 'waiting');
      setStaffSidebarBadge('menu-inventory-requests', pendingInventory.length, title, inventoryActions.length ? 'attention' : 'waiting');
      addStaffWatchedItems(watchedItems, inventoryRequests, {
        type: 'Inventory Request',
        url: '/inventory?tab=requests',
        title: row => row.request_no || row.request_type
      });
    } catch (_) {
      setStaffCardBadge('stat-card-inventory', 0);
      setStaffSidebarBadge('menu-inventory-requests', 0);
    }

    try {
      const serviceOrders = await fetchStaffJson('/api/service-orders?include_archived=1');
      const activeService = serviceOrders.filter((row) => {
        if (Number(row.is_archived || 0) === 1 || row.is_archived === true) return false;
        return !['completed', 'cancelled', 'archived'].includes(normalizeStaffStatus(row.status));
      });
      const title = `${activeService.length} active service order${activeService.length === 1 ? '' : 's'}`;
      setStaffCardBadge('stat-card-service-operations', activeService.length, title, 'waiting');
      setStaffSidebarBadge('menu-service-operations', activeService.length, title, 'waiting');
    } catch (_) {
      setStaffCardBadge('stat-card-service-operations', 0);
      setStaffSidebarBadge('menu-service-operations', 0);
    }

    return watchedItems;
  }

  async function pollStaffStatusUpdates({ announce = true } = {}) {
    if (staffStatusPollBusy || normalizeStaffStatus(document.body?.dataset?.accessRole) !== 'staff') return;
    staffStatusPollBusy = true;
    try {
      const items = await syncStaffActionBadges();
      const nextMap = buildStaffStatusMap(items || []);
      if (staffLastStatusMap && announce) {
        const changes = [];
        nextMap.forEach((item, key) => {
          const previous = staffLastStatusMap.get(key);
          if (!previous || previous.status === item.status) return;
          if (!['approved', 'needs_revision', 'rejected', 'cancelled'].includes(item.status)) return;
          changes.push(item);
        });
        if (changes.length) {
          const first = changes[0];
          const extra = changes.length > 1 ? ` +${changes.length - 1} more` : '';
          showStaffStatusToast(`${first.type} ${first.title} is now ${formatStaffStatusLabel(first.status)}${extra}`, first.url);
        }
      }
      staffLastStatusMap = nextMap;
    } catch (err) {
      console.warn('Staff status polling warning:', err);
    } finally {
      staffStatusPollBusy = false;
    }
  }

  function startStaffStatusPolling() {
    if (staffStatusPollTimer) return;
    pollStaffStatusUpdates({ announce: false });
    staffStatusPollTimer = window.setInterval(() => {
      if (document.hidden) return;
      pollStaffStatusUpdates({ announce: true });
    }, STAFF_STATUS_POLL_MS);
  }

  window.KinaadmanRoleFlow = {
    apply: function () {
      applyStaffRoleState();
      window.KinaadmanStaffDashboardCards?.render();
      syncStaffSidebarActive();
      syncStaffActionBadges();
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
    startStaffStatusPolling();
    window.setTimeout(() => pollStaffStatusUpdates({ announce: false }), 1200);
  });
})();
