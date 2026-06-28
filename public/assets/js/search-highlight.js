/*
 * Global-search row spotlight.
 *
 * When you click a result in the dashboard global search, the destination page opens
 * pre-filtered via ?q= (or ?search=). This shared helper additionally paints the matching
 * table row(s) yellow and scrolls the first one into view — so the record you searched for
 * is obvious at a glance, on every module page (CRM, Sales, Procurement/AP, Inventory,
 * Projects, master-data, etc.). Pure presentation: it only toggles a CSS class.
 *
 * It re-applies on every table re-render (data load, filter, sort) via a debounced
 * MutationObserver, and bows out the moment the user starts typing in a search box —
 * from then on their own search drives the view.
 */
(function () {
  'use strict';

  function readTerm() {
    var params = new URLSearchParams(window.location.search || '');
    return String(params.get('q') || params.get('search') || '').trim().toLowerCase();
  }

  var term = readTerm();
  if (term.length < 2) return;

  var scrolled = false;
  var observer = null;

  function apply() {
    if (!term) return;
    var rows = document.querySelectorAll('table tbody tr');
    var firstHit = null;
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      // Skip empty-state / placeholder rows (a single cell spanning the table).
      var isPlaceholder = tr.children.length <= 1 || tr.querySelector('td[colspan]');
      var hit = !isPlaceholder && (tr.textContent || '').toLowerCase().indexOf(term) !== -1;
      tr.classList.toggle('gs-hit-row', hit);
      if (hit && !firstHit) firstHit = tr;
    }
    if (firstHit && !scrolled) {
      scrolled = true;
      try { firstHit.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
    }
  }

  var debounce = null;
  function schedule() { clearTimeout(debounce); debounce = setTimeout(apply, 90); }

  function stop() {
    term = '';
    if (observer) { observer.disconnect(); observer = null; }
    var hits = document.querySelectorAll('tr.gs-hit-row');
    for (var i = 0; i < hits.length; i++) hits[i].classList.remove('gs-hit-row');
  }

  function start() {
    apply();
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    // Once the user refines via any search box, hand the view back to them. Ignore synthetic
    // input events (e.isTrusted === false) that some pages dispatch to pre-fill from ?q=.
    document.addEventListener('input', function (e) {
      if (!e.isTrusted) return;
      var el = e.target;
      if (el && el.matches && el.matches('input[type="search"], input[type="text"]')) stop();
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
