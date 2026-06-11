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
    var def = rows.find(function (r) { return Number(r.is_default || 0) === 1; }) || rows[0];
    return def ? String(def.id || '') : '';
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
        if (rows.length) build(host, rows);
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
