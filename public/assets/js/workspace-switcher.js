// Clickable company (business entity) switcher for module headers. Lets you pick
// a specific operating company or "All Companies" while inside any module. It does
// NOT auto-switch — the current selection stays until you explicitly pick another.
// On select it stores the choice and reloads so the module re-scopes its data.
(function () {
  'use strict';

  var KEY = 'kinaadman_businessEntityContext';
  var THEME_KEY = 'kinaadman_businessEntityTheme';
  // "All Companies" / any entity without its own brand color → neutral slate (distinct from any entity).
  var DEFAULT_THEME = { theme: 'neutral', brand_color: '', primary: '#334155', primaryLight: '#64748b', primaryDark: '#1e293b', accent: '#475569', accent2: '#0f172a' };

  // Lighten (positive %) / darken (negative %) a #rrggbb hex toward white/black.
  function shadeHex(hex, percent) {
    var h = String(hex || '').replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return hex;
    var t = percent < 0 ? 0 : 255, p = Math.abs(percent) / 100;
    function ch(i) { var c = parseInt(h.slice(i, i + 2), 16); return Math.max(0, Math.min(255, Math.round((t - c) * p) + c)); }
    return '#' + [ch(0), ch(2), ch(4)].map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  // The active entity's brand color themes the whole workspace; no color → default maroon.
  function entityThemeColors(entity) {
    var c = entity && /^#[0-9a-fA-F]{6}$/.test(String(entity.brand_color || '')) ? String(entity.brand_color) : '';
    if (!c) return DEFAULT_THEME;
    return { theme: 'entity', brand_color: c, primary: c, primaryLight: shadeHex(c, 38), primaryDark: shadeHex(c, -42), accent: c, accent2: shadeHex(c, -72) };
  }
  function applyThemeVars(t) {
    // Set the vars on BOTH <html> and <body>. Inline vars on <body> beat the
    // body[data-business-entity-theme="kvsk"/"kitsi"] CSS rules (same element, inline wins),
    // so a custom brand color always applies regardless of the data-theme attribute or timing.
    [document.documentElement, document.body].forEach(function (el) {
      if (!el || !el.style) return;
      el.style.setProperty('--primary', t.primary);
      el.style.setProperty('--primary-light', t.primaryLight);
      el.style.setProperty('--primary-dark', t.primaryDark);
      el.style.setProperty('--accent', t.accent);
      el.style.setProperty('--accent2', t.accent2);
    });
    if (document.documentElement.dataset) document.documentElement.dataset.businessEntityTheme = t.theme;
    if (document.body && document.body.dataset) document.body.dataset.businessEntityTheme = t.theme;
  }
  // Persist the active entity's theme (colors + logo + name) so auth-guard applies it before
  // paint on the next load — keeping the workspace color CONSISTENT across refresh, no flash.
  function storeEntityTheme(entity) {
    var colors = entityThemeColors(entity);
    try {
      var tp = JSON.parse(localStorage.getItem(THEME_KEY) || 'null') || {};
      tp.theme = colors.theme; tp.brand_color = colors.brand_color;
      tp.primary = colors.primary; tp.primaryLight = colors.primaryLight; tp.primaryDark = colors.primaryDark;
      tp.accent = colors.accent; tp.accent2 = colors.accent2;
      tp.logo = entity && entity.logo_path ? String(entity.logo_path) : '';
      tp.company_name = entity && entity.company_name ? entity.company_name : 'All Companies';
      localStorage.setItem(THEME_KEY, JSON.stringify(tp));
    } catch (e) {}
    return colors;
  }

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
      // Persist the new entity's theme BEFORE reload so the new color is applied before paint.
      storeEntityTheme((val && val !== 'all') ? rows.find(function (r) { return String(r.id || '') === String(val); }) : null);
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
    // Persist the active entity's full theme (colors + logo + name) and apply the color now.
    // auth-guard re-applies it before paint on the next load, so the workspace color is
    // CONSISTENT across refresh with no flash of the default.
    applyThemeVars(storeEntityTheme(entity));
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
