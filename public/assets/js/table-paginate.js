// Generic client-side table pagination — 50 rows per page, applied to every
// module data table automatically. Works on the rows each module already renders:
// a MutationObserver re-paginates whenever a table re-renders (search/filter/load),
// so no per-module wiring is needed. The pager only appears when a table has more
// than one page of rows.
(function () {
  'use strict';

  var PAGE_SIZE = 50;
  var registry = new Map(); // tbody -> { page, pager, table }

  // Real data rows only — skip empty-state placeholders ("No records") and any
  // single full-width cell rows so they are never counted or hidden.
  function dataRows(tbody) {
    return Array.prototype.filter.call(tbody.children, function (tr) {
      if (tr.tagName !== 'TR') return false;
      if (tr.classList.contains('empty-row')) return false;
      var cells = tr.querySelectorAll(':scope > td');
      if (cells.length === 1 && cells[0].hasAttribute('colspan')) return false;
      return true;
    });
  }

  function ensurePager(entry) {
    if (entry.pager && entry.pager.isConnected) return entry.pager;
    var pager = document.createElement('div');
    pager.className = 'table-pager';
    var anchor = entry.table.closest('.table-wrap') || entry.table;
    if (anchor.parentNode) anchor.parentNode.insertBefore(pager, anchor.nextSibling);
    entry.pager = pager;
    return pager;
  }

  function apply(tbody) {
    var entry = registry.get(tbody);
    if (!entry) return;
    var rows = dataRows(tbody);
    var total = rows.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (entry.page > pages) entry.page = pages;
    if (entry.page < 1) entry.page = 1;

    if (total <= PAGE_SIZE) {
      rows.forEach(function (r) { r.style.display = ''; });
      if (entry.pager) entry.pager.innerHTML = '';
      return;
    }

    var start = (entry.page - 1) * PAGE_SIZE;
    var end = start + PAGE_SIZE;
    rows.forEach(function (r, i) { r.style.display = (i >= start && i < end) ? '' : 'none'; });

    var pager = ensurePager(entry);
    pager.innerHTML =
      '<button class="table-pager-btn" data-act="first"' + (entry.page === 1 ? ' disabled' : '') + '>&laquo;</button>' +
      '<button class="table-pager-btn" data-act="prev"' + (entry.page === 1 ? ' disabled' : '') + '>&lsaquo; Prev</button>' +
      '<span class="table-pager-info">Page ' + entry.page + ' of ' + pages + ' &middot; ' + (start + 1) + '-' + Math.min(end, total) + ' of ' + total + '</span>' +
      '<button class="table-pager-btn" data-act="next"' + (entry.page === pages ? ' disabled' : '') + '>Next &rsaquo;</button>' +
      '<button class="table-pager-btn" data-act="last"' + (entry.page === pages ? ' disabled' : '') + '>&raquo;</button>';
  }

  function onClick(e) {
    var btn = e.target.closest && e.target.closest('.table-pager-btn');
    if (!btn) return;
    var pager = btn.closest('.table-pager');
    registry.forEach(function (entry, tbody) {
      if (entry.pager !== pager) return;
      var rows = dataRows(tbody);
      var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      var act = btn.getAttribute('data-act');
      if (act === 'first') entry.page = 1;
      else if (act === 'prev') entry.page -= 1;
      else if (act === 'next') entry.page += 1;
      else if (act === 'last') entry.page = pages;
      apply(tbody);
      var anchor = entry.table.closest('.table-wrap') || entry.table;
      if (anchor.scrollIntoView) anchor.scrollIntoView({ block: 'nearest' });
    });
  }

  function register(tbody) {
    if (registry.has(tbody)) return;
    var table = tbody.closest('table');
    if (!table) return;
    registry.set(tbody, { page: 1, pager: null, table: table });
    var raf = null;
    var obs = new MutationObserver(function () {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () { apply(tbody); });
    });
    obs.observe(tbody, { childList: true });
    apply(tbody);
  }

  function injectStyles() {
    if (document.getElementById('table-pager-styles')) return;
    var style = document.createElement('style');
    style.id = 'table-pager-styles';
    style.textContent =
      // Reclaim the left/right margins so content (and tables) run wider on all modules.
      'body.admin-page #dashboard main,body.erp-clean-page:not(.login-page) main{max-width:none !important;}' +
      '.table-pager{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin:10px 0 4px;}' +
      '.table-pager:empty{display:none;}' +
      '.table-pager-btn{border:1px solid #d8dee9;background:#fff;color:#334155;border-radius:8px;padding:5px 11px;font-size:.82rem;font-weight:600;cursor:pointer;line-height:1;}' +
      '.table-pager-btn:hover:not(:disabled){background:#f1f5f9;}' +
      '.table-pager-btn:disabled{opacity:.45;cursor:not-allowed;}' +
      '.table-pager-info{font-size:.8rem;color:#64748b;font-weight:600;padding:0 4px;}';
    document.head.appendChild(style);
  }

  function init() {
    injectStyles();
    document.querySelectorAll('table tbody').forEach(function (tbody) {
      // Module data tables carry an id (e.g. sales-records-body); skip unmarked
      // layout tables.
      if (tbody.id) register(tbody);
    });
    document.addEventListener('click', onClick);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
