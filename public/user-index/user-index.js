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
    loadRecords();
  })
  .catch(() => {
    window.location.href = '/';
  });
  
let publicDb = [];
let currentPage = 1;
let activeTab = 'all';
const PAGE_SIZE = 10;

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

  downloadCsv('transaction-status.csv', ['docno', 'type', 'client', 'description', 'amount', 'downpayment', 'balance', 'date', 'status'], rows);
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
  if (confirm('Sigurado ka bang gusto mong mag-logout?')) {
    fetch('/logout', {
      method: 'POST',
      headers: { 'X-CSRF-Token': window.__CSRF_TOKEN__ || '' }
    }).finally(() => {
      window.location.href = '/';
    });
  }
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
  const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
  return escHtml(text).replace(re, '<mark>$1</mark>');
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
          <td class="text-center" data-label="Type"><span class="type-pill type-${record.type}">${record.type === 'receipt' ? 'Collection Receipt' : 'Charge Sales Invoice'}</span></td>
          <td class="client-cell" data-label="Client">${hClient}</td>
          <td data-label="Description">${hDesc}${record.qty > 1 ? `<span class="qty-note"> x${record.qty}</span>` : ''}</td>
          <td class="amount-cell" data-label="Total Amount">PHP ${amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
          <td class="amount-cell accent-amount" data-label="DP">PHP ${downpayment.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
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

