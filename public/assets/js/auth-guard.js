/**
 * auth-guard.js
 * I-include sa lahat ng protected pages.
 * Pinipigilan ang back button access pagkatapos mag-logout at nililimitahan ang pages per role.
 */

(function () {
  'use strict';

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
  verifySession();

  function onReady() {
    setupSidebarLinkNavigation();
    setupTableSlideControls();
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

        applyRoleBasedSidebar(data);

        var path = String(location.pathname || '').toLowerCase();
        var role = String(data.role || 'user').toLowerCase();
        var accessMatrix = [
          { prefixes: ['/user-management', '/company-registry'], roles: ['admin'] },
          { prefixes: ['/admin'], roles: ['admin', 'staff'] },
          { prefixes: ['/erp'], roles: ['admin', 'staff'] },
          { prefixes: ['/inventory'], roles: ['admin', 'staff'] },
          { prefixes: ['/accounts-payable'], roles: ['admin', 'staff'] },
          { prefixes: ['/accounts-receivable'], roles: ['admin', 'staff'] },
          { prefixes: ['/gantt-chart'], roles: ['admin', 'staff'] },
          { prefixes: ['/procurement'], roles: ['admin', 'staff'] },
          { prefixes: ['/status'], roles: ['admin', 'staff', 'user'] }
        ];

        var matchedRule = accessMatrix.find(function (rule) {
          return rule.prefixes.some(function (prefix) {
            return path.startsWith(prefix);
          });
        });

        if (matchedRule && matchedRule.roles.indexOf(role) === -1) {
          redirectToStatus();
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

  function applyRoleBasedSidebar(data) {
    var isAdmin = data && data.role === 'admin';
    var isStaff = data && data.role === 'staff';
    var adminOnlyHrefs = [
      '/user-management',
      '/procurement',
      '/admin?view=logs',
      '/admin?view=archived'
    ];
    var adminOnlySelectors = [
      '#menu-users',
      '#menu-logs',
      '#menu-archived'
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
        node.style.display = isAdmin ? '' : 'none';
        node.setAttribute('aria-hidden', isAdmin ? 'false' : 'true');
      }
      if (targetHref === '/admin?view=dashboard' || targetHref === '/admin?view=all' || targetHref === '/admin?view=ongoing-projects') {
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
      link.setAttribute('href', '#');

      link.addEventListener('click', function (event) {
        if (event.defaultPrevented) return;
        event.preventDefault();

        var target = String(link.dataset.navHref || '').trim();
        if (!target) return;
        location.href = target;
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
