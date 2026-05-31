(function () {
  'use strict';

  let notificationReadIds = new Set();
  const NOTIFICATION_GROUP_ORDER = ['Approvals', 'Due Dates', 'Inventory', 'Service', 'System'];

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

  function updateNotificationBadge(items = notificationsDb) {
    const countBadge = document.getElementById('notification-count');
    if (!countBadge) return;
    const unreadItems = getUnreadNotifications(items);
    countBadge.textContent = String(unreadItems.length);
    countBadge.style.display = unreadItems.length ? 'inline-flex' : 'none';
  }

  function getNotificationCategory(item = {}) {
    const category = String(item.category || '').trim();
    if (category) return category;
    const type = String(item.type || '').trim().toLowerCase();
    if (type === 'approval') return 'Approvals';
    if (['due', 'deadline', 'overdue'].includes(type)) return 'Due Dates';
    if (type === 'inventory') return 'Inventory';
    if (type === 'service') return 'Service';
    return 'System';
  }

  function setupNotificationButtonListeners() {
    document.querySelectorAll('.notification-btn').forEach((button) => {
      if (button.dataset.notificationBound === '1') return;
      button.dataset.notificationBound = '1';
      button.addEventListener('click', (event) => {
        toggleNotificationsPanel(event);
      });
    });

    document.querySelectorAll('.notifications-close').forEach((button) => {
      if (button.dataset.notificationCloseBound === '1') return;
      button.dataset.notificationCloseBound = '1';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleNotificationsPanel(event, false);
      });
    });
  }

  function openNotificationItem(notificationId) {
    const item = notificationsDb.find(entry => String(entry?.id || '') === String(notificationId || ''));
    if (!item) return;

    markNotificationsAsRead([item.id]);
    updateNotificationBadge();
    renderNotifications(notificationsDb);
    closeNotificationsPanel();

    const href = String(item.href || '').trim();
    if (href) {
      window.location.href = href;
      return;
    }

    if (String(item.type || '') === 'audit') {
      if (typeof openDashboardPanel === 'function') {
        openDashboardPanel('system-logs');
      }
      return;
    }

    const targetSearch = String(item.source_docno || item.title || '').trim();
    if (document.getElementById('project-records-section')) {
      openProjectInTotalProjects(targetSearch);
      return;
    }

    const url = new URL('/admin', window.location.origin);
    url.searchParams.set('panel', 'project-records');
    if (targetSearch) {
      url.searchParams.set('search', targetSearch);
    }
    window.location.href = url.toString();
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
      updateNotificationBadge(notificationsDb);

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
      list.innerHTML = '<div class="notifications-empty">No notifications right now.</div><div class="notifications-footer"><a href="/notifications">View history</a></div>';
      return;
    }

    const grouped = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      const category = getNotificationCategory(item);
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(item);
    });

    const groups = [
      ...NOTIFICATION_GROUP_ORDER.filter((category) => grouped.has(category)),
      ...Array.from(grouped.keys()).filter((category) => !NOTIFICATION_GROUP_ORDER.includes(category)).sort()
    ];

    list.innerHTML = groups.map((category) => {
      const rows = grouped.get(category) || [];
      const unreadCount = getUnreadNotifications(rows).length;
      return `
        <section class="notification-group">
          <div class="notification-group-head">
            <span>${escHtml(category)}</span>
            <small>${unreadCount ? `${unreadCount} unread` : `${rows.length} item${rows.length === 1 ? '' : 's'}`}</small>
          </div>
          ${rows.map(item => {
      const level = String(item.level || 'info').toLowerCase();
      const isUnread = !notificationReadIds.has(String(item?.id || ''));
            const safeTitle = escHtml(item.title || 'Notification');
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
          }).join('')}
        </section>
      `;
    }).join('') + '<div class="notifications-footer"><a href="/notifications">View notification history</a></div>';
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

  Object.assign(window, {
    getNotificationReadStorageKey,
    loadNotificationReadState,
    saveNotificationReadState,
    markNotificationsAsRead,
    getUnreadNotifications,
    updateNotificationBadge,
    getNotificationCategory,
    setupNotificationButtonListeners,
    openNotificationItem,
    toggleNotificationsPanel,
    closeNotificationsPanel,
    loadNotifications,
    renderNotifications,
    formatNotificationDisplayDate
  });
})();
