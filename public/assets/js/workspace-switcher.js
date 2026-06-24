// Clickable company (business entity) switcher for module headers. Lets you pick
// a specific operating company or "All Companies" while inside any module. It does
// NOT auto-switch — the current selection stays until you explicitly pick another.
// On select it stores the choice and reloads so the module re-scopes its data.
(function () {
  'use strict';

  var KEY = 'kinaadman_businessEntityContext';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function currentValue(rows) {
    var stored = String(localStorage.getItem(KEY) || '').trim();
    if (stored === 'all') return 'all';
    if (stored && rows.some(function (r) { return String(r.id || '') === stored; })) return stored;
    // No saved choice yet → default to "All Companies" (not the is_default entity).
    return 'all';
  }

  function labelFor(val, rows) {
    if (val === 'all') return 'All Companies';
    var m = rows.find(function (r) { return String(r.id || '') === String(val); });
    return m ? (m.company_name || m.entity_code || 'Company') : 'Workspace';
  }

  function injectStyles() {
    if (document.getElementById('ws-switch-styles')) return;
    var style = document.createElement('style');
    style.id = 'ws-switch-styles';
    // Match the dashboard entity chip + panel look (white pill with status dot on
    // the maroon header, white rounded panel) so the switcher is consistent app-wide.
    style.textContent =
      '.ws-switch{position:relative;display:inline-flex;}' +
      '.ws-switch-btn{display:inline-flex;align-items:center;gap:8px;min-height:34px;background:rgba(255,255,255,0.14);color:#fff;border:1px solid rgba(255,255,255,0.28);border-radius:999px;padding:8px 14px;font-size:.72rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;line-height:1;cursor:pointer;white-space:nowrap;}' +
      '.ws-switch-btn::before{content:"";width:8px;height:8px;border-radius:999px;background:#fff;box-shadow:0 0 0 3px rgba(255,255,255,0.18);}' +
      '.ws-switch-btn:hover{background:rgba(255,255,255,0.22);}' +
      '.ws-switch-caret{font-size:.7rem;opacity:.85;}' +
      '.ws-switch-menu{position:absolute;top:calc(100% + 10px);right:0;min-width:240px;max-height:340px;overflow:auto;background:rgba(255,255,255,0.98);border:1px solid color-mix(in srgb, #b42318 18%, transparent);border-radius:16px;box-shadow:0 18px 42px rgba(75,18,16,0.14);padding:8px;z-index:1300;}' +
      '.ws-switch-item{display:block;width:100%;text-align:left;background:none;border:1px solid transparent;border-radius:10px;padding:10px 12px;font-size:.85rem;color:#3a2a28;font-weight:600;cursor:pointer;}' +
      '.ws-switch-item:hover{background:#fbeeec;}' +
      '.ws-switch-item.is-active{background:linear-gradient(145deg, color-mix(in srgb, #b42318 8%, #ffffff), #ffffff);border-color:color-mix(in srgb, #b42318 40%, transparent);color:#b42318;font-weight:800;}';
    document.head.appendChild(style);
  }

  function build(host, rows) {
    if (document.querySelector('.ws-switch')) return;
    var cur = currentValue(rows);
    var wrap = document.createElement('div');
    wrap.className = 'ws-switch';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ws-switch-btn';
    btn.innerHTML = '<span class="ws-switch-label">' + esc(labelFor(cur, rows)) + '</span><span class="ws-switch-caret">&#9662;</span>';

    var menu = document.createElement('div');
    menu.className = 'ws-switch-menu';
    menu.hidden = true;
    var opts = [{ value: 'all', label: 'All Companies' }].concat(rows.map(function (r) {
      return { value: String(r.id || ''), label: r.company_name || r.entity_code || ('Company ' + r.id) };
    }));
    menu.innerHTML = opts.map(function (o) {
      return '<button type="button" class="ws-switch-item' + (String(o.value) === String(cur) ? ' is-active' : '') +
        '" data-value="' + esc(o.value) + '">' + esc(o.label) + '</button>';
    }).join('');

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    host.insertBefore(wrap, host.firstChild);

    // The static workspace-badge label is redundant once this switcher is shown
    // (both display the same entity). Hide it so only ONE entity control remains.
    // Never touch the admin business-profile-trigger (that IS the single control).
    var staticBadge = document.getElementById('current-workspace-badge');
    if (staticBadge && !staticBadge.classList.contains('business-profile-trigger')) {
      staticBadge.style.display = 'none';
    }

    btn.addEventListener('click', function (e) { e.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener('click', function () { menu.hidden = true; });
    menu.addEventListener('click', function (e) {
      var item = e.target.closest && e.target.closest('.ws-switch-item');
      if (!item) return;
      var val = item.getAttribute('data-value');
      menu.hidden = true;
      if (String(val) === String(cur)) return; // only change on explicit, different pick
      localStorage.setItem(KEY, val);
      location.reload();
    });
  }

  // Show the active company's uploaded logo in the page/sidebar/modal brand marks.
  // The default scope ("All Companies") or a company without a logo shows no mark.
  function applyEntityLogo(rows) {
    var stored = String(localStorage.getItem(KEY) || '').trim();
    var entity = (stored && stored !== 'all')
      ? rows.find(function (r) { return String(r.id || '') === stored; })
      : null;
    var logo = entity && entity.logo_path ? String(entity.logo_path) : '';
    // Keep the shared theme key in sync so the logo survives a refresh even on pages
    // (business-entities, inventory, staff) that have no dedicated brand applier — the
    // auth-guard reads kinaadman_businessEntityTheme.logo on the next page load.
    try {
      var tp = JSON.parse(localStorage.getItem('kinaadman_businessEntityTheme') || 'null') || {};
      tp.logo = logo;
      if (!tp.theme) tp.theme = 'kvsk';
      if (entity && entity.company_name) tp.company_name = entity.company_name;
      localStorage.setItem('kinaadman_businessEntityTheme', JSON.stringify(tp));
    } catch (e) {}
    document.querySelectorAll('.brand-mark, .sidebar-brand-mark, .user-modal-brand-mark').forEach(function (img) {
      if (logo) {
        img.src = logo;
        img.alt = (entity.company_name || 'Company') + ' logo';
        img.style.removeProperty('display');
        img.removeAttribute('hidden');
      } else {
        img.style.display = 'none';
        img.removeAttribute('src');
        img.alt = '';
      }
    });
  }

  function init() {
    var host = document.querySelector('header .header-right') || document.querySelector('.header-right');
    if (!host) return;
    // Don't add a second switcher when the page already has the richer
    // business-profile menu (admin/dashboard). It uses the same
    // kinaadman_businessEntityContext key, so injecting ours would duplicate it.
    if (document.querySelector('.business-profile-menu, .business-profile-trigger')) return;
    injectStyles();
    fetch('/api/business-entities', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        rows = Array.isArray(rows) ? rows : [];
        applyEntityLogo(rows);
        if (rows.length) build(host, rows);
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
