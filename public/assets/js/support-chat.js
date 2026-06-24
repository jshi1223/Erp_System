/* ERP Support Chat — floating bottom-right widget.
   Two tabs: Assistant (trace a PR/RFQ/PO/GRN/Bill number → status + where it sits in
   the flow) and Activity (recent system events). Read-only; talks to
   /api/procurement/trace and /api/procurement/activity. No external deps. */
(function () {
  if (window.__erpSupportChatLoaded) return;
  window.__erpSupportChatLoaded = true;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function timeAgo(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    var s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'kakalang lang';
    if (s < 3600) return Math.floor(s / 60) + 'm ang nakaraan';
    if (s < 86400) return Math.floor(s / 3600) + 'h ang nakaraan';
    if (s < 604800) return Math.floor(s / 86400) + 'd ang nakaraan';
    return d.toLocaleDateString();
  }

  async function getJson(url) {
    var r = await fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
    return r.json().catch(function () { return { ok: false }; });
  }

  var style = document.createElement('style');
  style.textContent = [
    '.erp-chat-fab{position:fixed;right:22px;bottom:22px;z-index:99998;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;background:var(--primary,#8a1c1c);color:#fff;font-size:24px;box-shadow:0 6px 18px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;transition:transform .15s}',
    '.erp-chat-fab:hover{transform:scale(1.06)}',
    '.erp-chat-panel{position:fixed;right:22px;bottom:88px;z-index:99999;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 18px 48px rgba(0,0,0,.3);display:none;flex-direction:column;overflow:hidden;font-family:inherit}',
    '.erp-chat-panel.open{display:flex}',
    '.erp-chat-head{background:var(--primary,#8a1c1c);color:#fff;padding:12px 14px}',
    '.erp-chat-head h4{margin:0;font-size:15px;font-weight:700}',
    '.erp-chat-head p{margin:2px 0 0;font-size:11px;opacity:.85}',
    '.erp-chat-x{position:absolute;top:10px;right:12px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;opacity:.9}',
    '.erp-chat-tabs{display:flex;border-bottom:1px solid #eee;background:#faf7f7}',
    '.erp-chat-tab{flex:1;padding:9px 0;text-align:center;font-size:12.5px;font-weight:600;color:#7a6a6a;background:none;border:none;cursor:pointer;border-bottom:2px solid transparent}',
    '.erp-chat-tab.active{color:var(--primary,#8a1c1c);border-bottom-color:var(--primary,#8a1c1c)}',
    '.erp-chat-body{flex:1;overflow-y:auto;padding:12px;background:#fbfafa}',
    '.erp-chat-msg{max-width:85%;padding:9px 11px;border-radius:12px;margin-bottom:9px;font-size:12.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word}',
    '.erp-chat-msg.bot{background:#fff;border:1px solid #ececec;border-bottom-left-radius:4px}',
    '.erp-chat-msg.me{background:var(--primary,#8a1c1c);color:#fff;margin-left:auto;border-bottom-right-radius:4px}',
    '.erp-chat-msg .t{font-weight:700;margin-bottom:3px;display:block}',
    '.erp-chat-msg .stage{margin-top:6px;padding-top:6px;border-top:1px dashed #e2d7d7;font-weight:600;color:var(--primary,#8a1c1c)}',
    '.erp-chat-feed-item{background:#fff;border:1px solid #ececec;border-radius:10px;padding:9px 11px;margin-bottom:8px;font-size:12px}',
    '.erp-chat-feed-item .a{font-weight:700}',
    '.erp-chat-feed-item .m{display:inline-block;font-size:10px;text-transform:uppercase;letter-spacing:.3px;color:#fff;background:var(--primary,#8a1c1c);border-radius:6px;padding:1px 6px;margin-left:6px}',
    '.erp-chat-feed-item .d{color:#555;margin-top:3px}',
    '.erp-chat-feed-item .ago{color:#999;font-size:10.5px;margin-top:3px}',
    '.erp-chat-input{display:flex;gap:8px;padding:10px;border-top:1px solid #eee;background:#fff}',
    '.erp-chat-input input{flex:1;border:1px solid #ddd;border-radius:10px;padding:9px 11px;font-size:12.5px;outline:none}',
    '.erp-chat-input input:focus{border-color:var(--primary,#8a1c1c)}',
    '.erp-chat-input button{border:none;background:var(--primary,#8a1c1c);color:#fff;border-radius:10px;padding:0 14px;font-weight:600;cursor:pointer;font-size:12.5px}',
    '.erp-chat-hint{font-size:11px;color:#999;text-align:center;margin:2px 0 10px}'
  ].join('\n');
  document.head.appendChild(style);

  var fab = document.createElement('button');
  fab.className = 'erp-chat-fab';
  fab.type = 'button';
  fab.title = 'ERP Assistant';
  fab.innerHTML = '&#128172;';

  var panel = document.createElement('div');
  panel.className = 'erp-chat-panel';
  panel.innerHTML = [
    '<div class="erp-chat-head" style="position:relative;">',
    '  <h4>ERP Assistant</h4>',
    '  <p>Itype ang doc number (PR/RFQ/PO/GRN/Bill) — sasabihin ko ang status.</p>',
    '  <button class="erp-chat-x" type="button" aria-label="Close">&times;</button>',
    '</div>',
    '<div class="erp-chat-tabs">',
    '  <button class="erp-chat-tab active" data-tab="assistant" type="button">Assistant</button>',
    '  <button class="erp-chat-tab" data-tab="activity" type="button">Activity</button>',
    '</div>',
    '<div class="erp-chat-body" data-pane="assistant"></div>',
    '<div class="erp-chat-body" data-pane="activity" style="display:none;"></div>',
    '<div class="erp-chat-input" data-for="assistant">',
    '  <input type="text" placeholder="hal. PR-KITSI-2026-001" />',
    '  <button type="button">Send</button>',
    '</div>'
  ].join('');

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  var assistantPane = panel.querySelector('[data-pane="assistant"]');
  var activityPane = panel.querySelector('[data-pane="activity"]');
  var input = panel.querySelector('.erp-chat-input input');
  var sendBtn = panel.querySelector('.erp-chat-input button');
  var inputBar = panel.querySelector('.erp-chat-input');
  var greeted = false;

  function addMsg(who, html) {
    var m = document.createElement('div');
    m.className = 'erp-chat-msg ' + who;
    m.innerHTML = html;
    assistantPane.appendChild(m);
    assistantPane.scrollTop = assistantPane.scrollHeight;
    return m;
  }

  function greet() {
    if (greeted) return;
    greeted = true;
    addMsg('bot', 'Kumusta! 👋 Itype mo ang isang document number (PR, RFQ, PO, GRN, o Bill) at sasabihin ko kung <b>nasaan na ito sa flow</b> at <b>anong status</b>.');
    var hint = document.createElement('div');
    hint.className = 'erp-chat-hint';
    hint.textContent = 'hal. PR-KITSI-2026-001, PO-2026-014';
    assistantPane.appendChild(hint);
  }

  async function ask(q) {
    q = String(q || '').trim();
    if (!q) return;
    addMsg('me', esc(q));
    input.value = '';
    var typing = addMsg('bot', '<span style="opacity:.6;">…hinahanap</span>');
    try {
      var data = await getJson('/api/procurement/trace?q=' + encodeURIComponent(q));
      typing.remove();
      if (data && data.ok && data.found) {
        var body = '<span class="t">' + esc(data.title || 'Resulta') + '</span>'
          + esc((data.lines || []).join('\n'))
          + (data.stage ? '<div class="stage">📍 ' + esc(data.stage) + '</div>' : '');
        addMsg('bot', body);
      } else {
        addMsg('bot', esc((data && data.message) || 'Walang nahanap. Subukan ang buong document number.'));
      }
    } catch (e) {
      typing.remove();
      addMsg('bot', 'May error sa paghahanap. Subukan ulit.');
    }
  }

  async function loadActivity() {
    activityPane.innerHTML = '<div class="erp-chat-hint">Niloload ang activity…</div>';
    try {
      var data = await getJson('/api/procurement/activity?limit=25');
      var items = (data && data.items) || [];
      if (!items.length) { activityPane.innerHTML = '<div class="erp-chat-hint">Wala pang activity.</div>'; return; }
      activityPane.innerHTML = items.map(function (it) {
        return '<div class="erp-chat-feed-item">'
          + '<div><span class="a">' + esc(it.actor) + '</span> — ' + esc(it.action)
          + (it.module ? '<span class="m">' + esc(it.module) + '</span>' : '') + '</div>'
          + (it.detail ? '<div class="d">' + esc(it.detail) + '</div>' : '')
          + '<div class="ago">' + esc(timeAgo(it.at)) + '</div>'
          + '</div>';
      }).join('');
    } catch (e) {
      activityPane.innerHTML = '<div class="erp-chat-hint">Hindi ma-load ang activity.</div>';
    }
  }

  function setTab(name) {
    panel.querySelectorAll('.erp-chat-tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    var isAssistant = name === 'assistant';
    assistantPane.style.display = isAssistant ? '' : 'none';
    activityPane.style.display = isAssistant ? 'none' : '';
    inputBar.style.display = isAssistant ? '' : 'none';
    if (isAssistant) greet();
    else loadActivity();
  }

  function toggle(open) {
    var willOpen = open == null ? !panel.classList.contains('open') : open;
    panel.classList.toggle('open', willOpen);
    if (willOpen) { greet(); setTimeout(function () { input.focus(); }, 50); }
  }

  fab.addEventListener('click', function () { toggle(); });
  panel.querySelector('.erp-chat-x').addEventListener('click', function () { toggle(false); });
  panel.querySelectorAll('.erp-chat-tab').forEach(function (t) {
    t.addEventListener('click', function () { setTab(t.dataset.tab); });
  });
  sendBtn.addEventListener('click', function () { ask(input.value); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') ask(input.value); });
})();
