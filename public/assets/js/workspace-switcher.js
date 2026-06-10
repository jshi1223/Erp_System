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
    style.textContent =
      '.ws-switch{position:relative;display:inline-flex;}' +
      '.ws-switch-btn{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.95);color:#7a1812;border:1px solid rgba(180,35,24,.25);border-radius:999px;padding:6px 12px;font-size:.8rem;font-weight:700;cursor:pointer;line-height:1;white-space:nowrap;}' +
      '.ws-switch-btn:hover{background:#fff;}' +
      '.ws-switch-caret{font-size:.7rem;opacity:.7;}' +
      '.ws-switch-menu{position:absolute;top:calc(100% + 6px);right:0;min-width:220px;max-height:320px;overflow:auto;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 12px 28px rgba(0,0,0,.16);padding:6px;z-index:1200;}' +
      '.ws-switch-item{display:block;width:100%;text-align:left;background:none;border:none;border-radius:7px;padding:8px 10px;font-size:.83rem;color:#334155;cursor:pointer;}' +
      '.ws-switch-item:hover{background:#f1f5f9;}' +
      '.ws-switch-item.is-active{background:#fef2f2;color:#b42318;font-weight:700;}';
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
