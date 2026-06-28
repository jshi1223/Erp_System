/*
 * Shared "Record History" modal — one consistent, uncluttered audit timeline for any record.
 *
 * Usage from any page (after including this script):
 *     openRecordHistory('crm_lead', 42, 'LEAD-KVSK-2026-001');
 *
 * It calls GET /api/audit?entity_type=&entity_id= and renders newest-first: who, when, what
 * action, severity, and the field-level before → after changes. Self-contained (injects its own
 * styles) so it looks identical on every module page. Admin + super-admin only (API-enforced).
 */
(function () {
  'use strict';
  if (window.openRecordHistory) return; // already loaded

  var STYLE_ID = 'record-history-style';
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.rh-backdrop{position:fixed;inset:0;background:rgba(28,18,14,.45);display:flex;align-items:center;justify-content:center;z-index:4000;padding:20px}',
      '.rh-modal{background:#fff;border-radius:16px;max-width:560px;width:100%;max-height:84vh;display:flex;flex-direction:column;box-shadow:0 24px 70px rgba(0,0,0,.28);overflow:hidden}',
      '.rh-head{display:flex;align-items:flex-start;gap:12px;padding:18px 20px;border-bottom:1px solid #ece3dd}',
      '.rh-head-title{font-weight:800;font-size:1.02rem;color:#3a2c25;line-height:1.25}',
      '.rh-head-sub{font-size:.74rem;color:#8a7d75;margin-top:2px;text-transform:uppercase;letter-spacing:.04em}',
      '.rh-close{margin-left:auto;border:0;background:transparent;font-size:1.4rem;line-height:1;color:#8a7d75;cursor:pointer;padding:2px 6px}',
      '.rh-close:hover{color:#3a2c25}',
      '.rh-body{padding:8px 20px 18px;overflow-y:auto}',
      '.rh-state{padding:28px 8px;text-align:center;color:#8a7d75;font-style:italic}',
      '.rh-item{position:relative;padding:14px 0 14px 26px;border-left:2px solid #ece3dd}',
      '.rh-item:last-child{border-left-color:transparent}',
      '.rh-dot{position:absolute;left:-7px;top:18px;width:12px;height:12px;border-radius:50%;background:#94a3b8;border:2px solid #fff;box-shadow:0 0 0 1px #cbd5e1}',
      '.rh-dot.warning{background:#f59e0b;box-shadow:0 0 0 1px #f6d9a8}',
      '.rh-dot.critical{background:#dc2626;box-shadow:0 0 0 1px #f5b5b5}',
      '.rh-row1{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.rh-action{font-weight:800;font-size:.72rem;text-transform:uppercase;letter-spacing:.03em;color:#7a1f1f;background:#f3e6e2;border-radius:6px;padding:3px 9px}',
      '.rh-action.warning{color:#b45309;background:#fff4e2}',
      '.rh-action.critical{color:#b91c1c;background:#fde8e8}',
      '.rh-actor{font-weight:700;font-size:.85rem;color:#3a2c25}',
      '.rh-role{font-size:.7rem;color:#8a7d75}',
      '.rh-time{margin-left:auto;font-size:.72rem;color:#8a7d75;white-space:nowrap}',
      '.rh-note{margin-top:6px;font-size:.82rem;color:#5b4d45;line-height:1.4}',
      '.rh-changes{margin-top:8px;display:flex;flex-direction:column;gap:4px}',
      '.rh-chg{display:flex;align-items:baseline;gap:6px;font-size:.78rem;flex-wrap:wrap}',
      '.rh-chg-field{font-weight:700;color:#3a2c25;min-width:96px}',
      '.rh-from{color:#9a8d85;text-decoration:line-through}',
      '.rh-arrow{color:#b45309}',
      '.rh-to{color:#166534;font-weight:600}',
      '.rh-meta{margin-top:6px;font-size:.68rem;color:#a89c94}'
    ].join('');
    document.head.appendChild(s);
  }

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function sev(s) { s = String(s || 'info').toLowerCase(); return (s === 'warning' || s === 'critical') ? s : 'info'; }

  // 'UPDATE_CRM_LEAD' → 'Updated', 'APPROVE_PURCHASE_ORDER' → 'Approved', etc.
  var VERB = { CREATE: 'Created', UPDATE: 'Updated', DELETE: 'Deleted', APPROVE: 'Approved', REJECT: 'Rejected', SUBMIT: 'Submitted', CANCEL: 'Cancelled', ARCHIVE: 'Archived', RESTORE: 'Restored', SELECT: 'Selected', GENERATE: 'Generated', LINK: 'Linked', REVISE: 'Returned for revision', LOGIN: 'Login' };
  function actionLabel(a) {
    var first = String(a || '').split('_')[0].toUpperCase();
    return VERB[first] || String(a || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function fmtTime(ts) {
    try { return new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch (_) { return String(ts || ''); }
  }

  // "[Actor: X | Role: Y] message — Changes: ..." → just the human message (actor/changes shown separately).
  function cleanNote(details, changed) {
    var t = String(details || '').replace(/^\[Actor:[^\]]*\]\s*/, '');
    if (changed) { var i = t.indexOf('— Changes:'); if (i >= 0) t = t.slice(0, i).trim(); }
    return t.replace(/\s*\|\s*$/, '').trim();
  }

  function renderChanges(changed) {
    if (!changed) return '';
    var parts = String(changed).split(';').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!parts.length) return '';
    var rows = parts.map(function (p) {
      var m = p.split(/:(.+)/); // field : rest
      var field = m[0] ? m[0].trim() : p;
      var rest = (m[1] || '').trim();
      var fromTo = rest.split('→');
      var from = (fromTo[0] || '').trim();
      var to = (fromTo[1] || '').trim();
      if (to) {
        return '<div class="rh-chg"><span class="rh-chg-field">' + esc(field) + '</span><span class="rh-from">' + esc(from) + '</span><span class="rh-arrow">→</span><span class="rh-to">' + esc(to) + '</span></div>';
      }
      return '<div class="rh-chg"><span class="rh-chg-field">' + esc(field) + '</span><span class="rh-to">' + esc(rest) + '</span></div>';
    }).join('');
    return '<div class="rh-changes">' + rows + '</div>';
  }

  function render(entries) {
    if (!entries || !entries.length) return '<div class="rh-state">Walang history pa para sa record na ito.</div>';
    return entries.map(function (e) {
      var s = sev(e.severity);
      var actor = String(e.fullname || e.username || 'System').trim();
      var note = cleanNote(e.details, e.changed_fields);
      return '<div class="rh-item">' +
        '<span class="rh-dot ' + s + '"></span>' +
        '<div class="rh-row1">' +
          '<span class="rh-action ' + s + '">' + esc(actionLabel(e.action)) + '</span>' +
          '<span class="rh-actor">' + esc(actor) + '</span>' +
          '<span class="rh-role">(' + esc(String(e.user_role || 'system').replace(/_/g, ' ')) + ')</span>' +
          '<span class="rh-time">' + esc(fmtTime(e.created_at)) + '</span>' +
        '</div>' +
        (note ? '<div class="rh-note">' + esc(note) + '</div>' : '') +
        renderChanges(e.changed_fields) +
        (e.ip_address ? '<div class="rh-meta">IP ' + esc(e.ip_address) + '</div>' : '') +
      '</div>';
    }).join('');
  }

  function close() {
    var bd = document.getElementById('rh-backdrop');
    if (bd) bd.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  window.openRecordHistory = function (entityType, entityId, title) {
    injectStyle();
    close();
    var bd = document.createElement('div');
    bd.className = 'rh-backdrop';
    bd.id = 'rh-backdrop';
    bd.innerHTML =
      '<div class="rh-modal" role="dialog" aria-modal="true" aria-label="Record history">' +
        '<div class="rh-head">' +
          '<div><div class="rh-head-title">' + esc(title || 'Record History') + '</div>' +
          '<div class="rh-head-sub">History / Audit Trail</div></div>' +
          '<button class="rh-close" type="button" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="rh-body" id="rh-body"><div class="rh-state">Naglo-load…</div></div>' +
      '</div>';
    document.body.appendChild(bd);
    bd.addEventListener('click', function (e) { if (e.target === bd) close(); });
    bd.querySelector('.rh-close').addEventListener('click', close);
    document.addEventListener('keydown', onKey);

    var url = '/api/audit?entity_type=' + encodeURIComponent(entityType) + '&entity_id=' + encodeURIComponent(entityId);
    fetch(url, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { entries: [] }; })
      .then(function (d) { var b = document.getElementById('rh-body'); if (b) b.innerHTML = render(d.entries || []); })
      .catch(function () { var b = document.getElementById('rh-body'); if (b) b.innerHTML = '<div class="rh-state">Hindi ma-load ang history.</div>'; });
  };
})();
