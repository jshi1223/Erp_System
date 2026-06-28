fetch('/api/me')
  .then(res => {
    if (!res.ok) {
      window.location.href = '/';
      return;
    }
    return res.json();
  })
  .then(data => {
    if (!data || !data.loggedIn) {
      window.location.href = '/';
      return;
    }

    if (data.csrfToken) {
      window.__CSRF_TOKEN__ = data.csrfToken;
    }

    document.getElementById('welcome-msg').textContent =
      'Signed in as ' + (data.fullname || data.username);
    setupSearchHighlight();
    loadRecords();
  })
  .catch(() => {
    window.location.href = '/';
  });
  
let publicDb = [];
let currentPage = 1;
let activeTab = 'all';
const PAGE_SIZE = 10;

function setupSearchHighlight() {
  const input = document.getElementById('search-input');
  if (!input || input.dataset.searchHighlightBound === '1') return;

  input.dataset.searchHighlightBound = '1';

  const sync = () => {
    input.classList.toggle(
      'is-table-search-active',
      document.activeElement === input || String(input.value || '').trim().length > 0
    );
  };

  input.addEventListener('focus', sync);
  input.addEventListener('input', sync);
  input.addEventListener('blur', sync);
  sync();
}

function loadRecords() {
  fetch('/api/public/transactions')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => {
      publicDb = data;
      renderSummary();
      renderTable();
    })
    .catch((err) => {
      console.error('Load error:', err);
      document.getElementById('table-body').innerHTML =
        '<tr class="empty-row"><td colspan="10">Hindi ma-load ang records: ' + err.message + '</td></tr>';
    });
}

function renderSummary() {
  const total = publicDb.length;
  const receipts = publicDb.filter(r => r.type === 'receipt').length;
  const invoices = publicDb.filter(r => r.type === 'invoice').length;
  const outstanding = publicDb.reduce((sum, r) => {
    const amount = parseFloat(r.amount || 0);
    const downpayment = parseFloat(r.downpayment || 0);
    return sum + Math.max(0, amount - downpayment);
  }, 0);

  document.getElementById('summary-total').textContent = total;
  document.getElementById('summary-receipts').textContent = receipts;
  document.getElementById('summary-invoices').textContent = invoices;
  document.getElementById('summary-balance').textContent =
    'PHP ' + outstanding.toLocaleString('en-PH', { minimumFractionDigits: 2 });
}

function downloadCsv(filename, headers, rows) {
  const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    lines.push(headers.map((header) => escapeCsv(row[header])).join(','));
  });

  const blob = new Blob([`\ufeff${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportVisibleRowsCsv() {
  const rows = getFiltered().map((record) => ({
    docno: record.docno || '',
    type: record.type || '',
    client: record.client || '',
    description: record.description || '',
    amount: record.amount || 0,
    downpayment: record.downpayment || 0,
    balance: Math.max(0, Number(record.amount || 0) - Number(record.downpayment || 0)).toFixed(2),
    date: record.date || '',
    status: record.status || ''
  }));

  if (!rows.length) {
    return;
  }

  downloadCsv('transaction-status.csv', ['docno', 'type', 'client', 'description', 'amount', 'paid_amount', 'balance', 'date', 'status'], rows);
}

function openPdfViewer(id) {
  const record = publicDb.find(item => item.id === id);
  if (!record || !record.pdfFilename) return;

  const pdfUrl = `/api/public/transactions/${record.id}/pdf`;

  document.getElementById('pdf-viewer-title').textContent =
    '#' + record.docno + ' - ' + (record.pdfFilename || 'Document.pdf');

  const dlBtn = document.getElementById('pdf-dl-btn');
  dlBtn.href = pdfUrl;
  dlBtn.download = record.pdfFilename;

  const fallbackBtn = document.getElementById('pdf-fallback-dl');
  fallbackBtn.href = pdfUrl;
  fallbackBtn.download = record.pdfFilename;

  const frame = document.getElementById('pdf-frame');
  const fallback = document.getElementById('pdf-fallback');
  frame.style.display = 'block';
  fallback.style.display = 'none';
  frame.src = pdfUrl;
  frame.onerror = () => {
    frame.style.display = 'none';
    fallback.style.display = 'flex';
  };

  document.getElementById('pdf-viewer-backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closePdfViewer() {
  document.getElementById('pdf-viewer-backdrop').classList.remove('open');
  document.getElementById('pdf-frame').src = 'about:blank';
  document.body.style.overflow = '';
}

function logout() {
  uiConfirm('Sigurado ka bang gusto mong mag-logout?', { title: 'Logout?', confirmLabel: 'Oo, mag-logout', type: 'danger' }).then((ok) => {
    if (!ok) return;
    fetch('/logout', {
      method: 'POST',
      headers: { 'X-CSRF-Token': window.__CSRF_TOKEN__ || '' }
    }).finally(() => {
      window.location.href = '/';
    });
  });
}

// Self-contained styled confirm (this page does not load auth-guard/erp-core, so
// we never fall back to the browser's native "localhost says" dialog).
function uiConfirm(message, opts) {
  opts = opts || {};
  if (typeof window.showConfirm === 'function') {
    try { return Promise.resolve(window.showConfirm(message, opts)); } catch (e) { /* build the inline modal */ }
  }
  return new Promise((resolve) => {
    const danger = opts.type === 'danger';
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.52);backdrop-filter:blur(4px);padding:16px;';
    const card = document.createElement('div');
    card.style.cssText = 'width:min(400px,94vw);background:#fff;border-radius:20px;box-shadow:0 24px 60px rgba(15,23,42,.22);padding:26px 24px 22px;text-align:center;font-family:Inter,system-ui,sans-serif;';
    const title = document.createElement('div');
    title.textContent = opts.title || 'Are you sure?';
    title.style.cssText = 'font-size:1.05rem;font-weight:800;color:#1f2937;margin-bottom:8px;';
    const msg = document.createElement('p');
    msg.textContent = message || '';
    msg.style.cssText = 'margin:0 0 22px;color:#4b5563;line-height:1.6;font-size:.9rem;';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:10px;justify-content:center;';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = opts.cancelLabel || 'Cancel';
    cancelBtn.style.cssText = 'padding:9px 18px;border-radius:9px;border:1px solid #d0d7e2;background:#f3f4f6;color:#374151;font-weight:700;cursor:pointer;';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.textContent = opts.confirmLabel || 'Confirm';
    okBtn.style.cssText = 'padding:9px 18px;border-radius:9px;border:1px solid ' + (danger ? '#b42318' : '#15803d') + ';background:' + (danger ? '#b42318' : '#15803d') + ';color:#fff;font-weight:700;cursor:pointer;';
    function cleanup(result) {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      document.body.style.overflow = '';
      resolve(result);
    }
    function onKey(e) { if (e.key === 'Escape') cleanup(false); else if (e.key === 'Enter') cleanup(true); }
    cancelBtn.addEventListener('click', () => cleanup(false));
    okBtn.addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    document.addEventListener('keydown', onKey);
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    card.appendChild(title);
    card.appendChild(msg);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    setTimeout(() => okBtn.focus(), 0);
  });
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlight(text, q) {
  if (!q) return escHtml(text);
  const escaped = escHtml(text);
  try {
    const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return escaped.replace(re, '<mark>$1</mark>');
  } catch (_) {
    return escaped;
  }
}

function switchTab(tab, btn) {
  activeTab = tab;
  currentPage = 1;
  document.querySelectorAll('.module-tab').forEach(button => button.classList.remove('active'));
  btn.classList.add('active');
  renderTable();
}

function getFiltered() {
  const q = document.getElementById('search-input').value.toLowerCase().trim();
  const status = document.getElementById('filter-status').value;

  return publicDb.filter(record => {
    const tabMatch = activeTab === 'all' || record.type === activeTab;
    const searchSource = (
      (record.docno ?? '') + ' ' +
      (record.description ?? '') + ' ' +
      (record.checkno ?? '') + ' ' +
      (record.pono ?? '') + ' ' +
      (record.phone ?? '')
    ).toLowerCase();
    const searchMatch = !q || searchSource.includes(q);
    const statusMatch = !status || record.status === status;
    return tabMatch && searchMatch && statusMatch;
  });
}

function renderTable() {
  const q = document.getElementById('search-input').value.trim();
  const filtered = getFiltered();
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (currentPage > pages) currentPage = pages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);
  const tbody = document.getElementById('table-body');

  if (!slice.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="10">Walang records na nahanap.</td></tr>';
  } else {
    tbody.innerHTML = slice.map(record => {
      const hDocno = highlight('#' + record.docno, q);
      const hClient = highlight(record.client || '', q);
      const hDesc = highlight(record.description || '', q);

      const amount = parseFloat(record.amount || 0);
      const downpayment = parseFloat(record.downpayment || 0);
      const balance = amount - downpayment;

      const pdfCell = record.pdfFilename
        ? `<button class="btn btn-pdf btn-sm" onclick="openPdfViewer(${record.id})" title="View PDF">View PDF</button>`
        : `<span class="pdf-empty">N/A</span>`;

      return `
        <tr>
          <td data-label="Doc No."><span class="doc-link">${hDocno}</span></td>
          <td class="text-center" data-label="Type"><span class="type-pill type-${record.type}">${record.type === 'receipt' ? 'Payment Receipt' : 'Sales Invoice'}</span></td>
          <td class="client-cell" data-label="Client">${hClient}</td>
          <td data-label="Description">${hDesc}${record.qty > 1 ? `<span class="qty-note"> x${record.qty}</span>` : ''}</td>
          <td class="amount-cell" data-label="Total Amount">PHP ${amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
          <td class="amount-cell accent-amount" data-label="Paid">PHP ${downpayment.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
          <td class="amount-cell" data-label="Balance" style="color:${balance > 0 ? 'var(--danger)' : 'var(--success)'}">PHP ${balance.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
          <td class="text-center date-cell" data-label="Date">${record.date}</td>
          <td class="text-center" data-label="Status"><span class="status-pill status-${record.status}">${highlight(record.status || '', q)}</span></td>
          <td class="text-center" data-label="PDF">${pdfCell}</td>
        </tr>
      `;
    }).join('');
  }

  document.getElementById('page-info').textContent = total
    ? `Showing ${start + 1}-${Math.min(start + PAGE_SIZE, total)} of ${total}`
    : 'Walang results';

  const pageButtons = document.getElementById('page-btns');
  pageButtons.innerHTML = '';
  for (let i = 1; i <= pages; i++) {
    const button = document.createElement('button');
    button.className = 'page-btn' + (i === currentPage ? ' active' : '');
    button.textContent = i;
    button.onclick = () => {
      currentPage = i;
      renderTable();
    };
    pageButtons.appendChild(button);
  }
}

