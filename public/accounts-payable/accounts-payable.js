let vendorsDb = [];
let billsDb = [];
let paymentsDb = [];
let stagedBillPdf = null;
const apToolbarState = {
  vendors: { search: '' },
  bills: { search: '', filter: '' },
  payments: { method: '' },
  aging: {}
};
let activeApTab = 'vendors';

document.addEventListener('DOMContentLoaded', () => {
  renderApToolbarControls(activeApTab);
  loadVendors();
  loadBills();
  loadPayments();
  document.getElementById('f-bill-date').valueAsDate = new Date();
  document.getElementById('f-payment-date').valueAsDate = new Date();
  if (typeof loadNotifications === 'function') loadNotifications();
});

async function doLogout() {
  const confirmed = await openConfirmDialog({
    title: 'Logout?',
    message: 'Maglo-logout ka na. Gusto mo bang ituloy?',
    noText: 'No',
    yesText: 'Yes'
  });
  if (!confirmed) return;
  fetch('/logout', { method: 'POST' }).then(() => { window.location.href = '/'; });
}

function goBackToDashboard() {
  window.location.href = '/admin?view=dashboard';
}

function captureApToolbarState(tab) {
  if (tab === 'vendors') {
    apToolbarState.vendors.search = document.getElementById('vendor-search')?.value || '';
  } else if (tab === 'bills') {
    apToolbarState.bills.search = document.getElementById('bills-search')?.value || '';
    apToolbarState.bills.filter = document.getElementById('bills-filter')?.value || '';
  } else if (tab === 'payments') {
    apToolbarState.payments.method = document.getElementById('payment-method-filter')?.value || '';
  }
}

function renderApToolbarControls(tab) {
  const actions = document.getElementById('module-toolbar-actions');
  if (!actions) return;

  const state = apToolbarState[tab] || {};

  if (tab === 'vendors') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="vendor-search" type="text" placeholder="Search vendors..." value="${escHtml(state.search || '')}" oninput="filterVendors()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openVendorModal()">Add Vendor</button>
    `;
    return;
  }

  if (tab === 'bills') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="bills-search" type="text" placeholder="Search bill number or vendor..." value="${escHtml(state.search || '')}" oninput="filterBills()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openBillModal()">New Bill</button>
      <select id="bills-filter" class="filter-select" onchange="filterBills()">
        <option value="">All Status</option>
        <option value="pending" ${state.filter === 'pending' ? 'selected' : ''}>Unpaid</option>
        <option value="partially_paid" ${state.filter === 'partially_paid' ? 'selected' : ''}>Partial</option>
        <option value="paid" ${state.filter === 'paid' ? 'selected' : ''}>Paid</option>
      </select>
    `;
    return;
  }

  if (tab === 'payments') {
    actions.innerHTML = `
      <select id="payment-method-filter" class="filter-select" onchange="filterPayments()">
        <option value="">All Methods</option>
        <option value="cash" ${state.method === 'cash' ? 'selected' : ''}>Cash</option>
        <option value="check" ${state.method === 'check' ? 'selected' : ''}>Check</option>
        <option value="bank_transfer" ${state.method === 'bank_transfer' ? 'selected' : ''}>Bank Transfer</option>
        <option value="credit_card" ${state.method === 'credit_card' ? 'selected' : ''}>Credit Card</option>
      </select>
      <button class="btn btn-add btn-sm" type="button" onclick="openPaymentModal()">Record Payment</button>
    `;
    return;
  }

  actions.innerHTML = '';
}

function switchTab(tab, btn) {
  captureApToolbarState(activeApTab);
  document.querySelectorAll('.module-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(tab).classList.add('active');
  activeApTab = tab;
  renderApToolbarControls(tab);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// VENDORS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function loadVendors() {
  fetch('/api/vendors').then(r => r.json()).then(data => {
    vendorsDb = data;
    renderVendors();
    updateVendorSelects();
  }).catch(e => console.error('Error:', e));
}

function renderVendors() {
  filterVendors();
}

function filterVendors() {
  const q = String(document.getElementById('vendor-search')?.value || '').toLowerCase().trim();
  const tbody = document.getElementById('vendors-tbody');
  const filtered = vendorsDb.filter(v =>
    (v.vendor_name + ' ' + (v.contact_person || '-')).toLowerCase().includes(q)
  );
  tbody.innerHTML = filtered.length ? filtered.map(v => `
    <tr>
      <td style="font-weight:600">${highlightText(v.vendor_name, q)}</td>
      <td>${highlightText(v.contact_person || '-', q)}</td>
      <td>${highlightText(v.email || '-', q)}</td>
      <td>${highlightText(v.phone || '-', q)}</td>
      <td>PHP 0.00</td>
      <td><button class="btn btn-edit btn-sm" onclick="editVendor(${v.id})">Edit</button></td>
    </tr>
  `).join('') : '<tr class="empty-row"><td colspan="6">No vendors match search</td></tr>';
}

function openVendorModal() {
  ['vendor-name', 'contact-person', 'vendor-email', 'vendor-phone', 'vendor-address', 'vendor-tin'].forEach(id => {
    document.getElementById('f-' + id).value = '';
  });
  document.getElementById('vendor-modal-backdrop').classList.add('open');
}

function closeVendorModal() {
  document.getElementById('vendor-modal-backdrop').classList.remove('open');
}

function saveVendor() {
  const vendorName = document.getElementById('f-vendor-name').value.trim();
  if (!vendorName) {
    alert('Vendor name is required');
    return;
  }
  const payload = {
    vendor_name: vendorName,
    contact_person: document.getElementById('f-contact-person').value.trim(),
    email: document.getElementById('f-vendor-email').value.trim(),
    phone: document.getElementById('f-vendor-phone').value.trim(),
    address: document.getElementById('f-vendor-address').value.trim(),
    tin: document.getElementById('f-vendor-tin').value.trim()
  };
  fetch('/api/vendors', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  }).then(r => r.json()).then(() => {
    closeVendorModal();
    loadVendors();
    alert('Vendor saved successfully');
  }).catch(e => alert('Error: ' + e.message));
}

function editVendor(id) {
  alert('Edit vendor coming soon');
}

function updateVendorSelects() {
  document.getElementById('f-bill-vendor').innerHTML = '<option value="">Select vendor</option>' +
    vendorsDb.map(v => `<option value="${v.id}">${escHtml(v.vendor_name)}</option>`).join('');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// BILLS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function loadBills() {
  fetch('/api/bills')
    .then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data.error || 'Unable to load bills.');
      }
      return data;
    })
    .then(data => {
      billsDb = Array.isArray(data) ? data : [];
      renderBills();
      updateBillSelects();
      updateMetrics();
    })
    .catch((e) => {
      console.error('Error:', e);
      billsDb = [];
      renderBills();
      updateBillSelects();
      updateMetrics();
    });
}

function getPayableUiStatus(bill) {
  const total = Number(bill?.total_amount || 0);
  const paid = Number(bill?.paid_amount || 0);
  const balance = Math.max(0, total - paid);
  const rawStatus = String(bill?.status || '').toLowerCase();

  if (balance <= 0 || rawStatus === 'paid') {
    return { key: 'paid', label: 'Paid', className: 'status-paid' };
  }

  if (paid > 0 || rawStatus === 'partially_paid') {
    return { key: 'partial', label: 'Partial', className: 'status-partial' };
  }

  return { key: 'unpaid', label: 'Unpaid', className: 'status-unpaid' };
}

function renderBills() {
  filterBills();
}

function filterBills() {
  const q = String(document.getElementById('bills-search')?.value || '').toLowerCase().trim();
  const filter = document.getElementById('bills-filter')?.value || '';
  const tbody = document.getElementById('bills-tbody');
  let filtered = billsDb.filter(b => {
    const vendorName = vendorsDb.find(v => v.id === b.vendor_id)?.vendor_name || '-';
    const haystack = [b.bill_number, vendorName, getPayableUiStatus(b).label, b.status, b.invoice_number].join(' ').toLowerCase();
    return !q || haystack.includes(q);
  });
  if (filter) filtered = filtered.filter(b => {
    const uiStatus = getPayableUiStatus(b).key;
    if (filter === 'pending') return uiStatus === 'unpaid';
    if (filter === 'partially_paid') return uiStatus === 'partial';
    if (filter === 'paid') return uiStatus === 'paid';
    return true;
  });
  tbody.innerHTML = filtered.length ? filtered.map(b => {
    const balance = b.total_amount - (b.paid_amount || 0);
    const isOverdue = new Date(b.due_date) < new Date() && balance > 0;
    const status = getPayableUiStatus(b);
    const pdfButton = b.pdfFilename
      ? `<button class="btn btn-pdf btn-sm" type="button" onclick="openBillPdfViewer(${b.id})">View PDF</button>`
      : '<span class="pdf-empty">N/A</span>';
    return `
      <tr>
        <td style="font-weight:600;color:var(--primary)">${escHtml(b.bill_number)}</td>
        <td>${escHtml(vendorsDb.find(v => v.id === b.vendor_id)?.vendor_name || '-')}</td>
        <td>${formatDate(b.bill_date)}</td>
        <td>${formatDate(b.due_date)}</td>
        <td>PHP ${(b.total_amount).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
        <td>PHP ${(b.paid_amount || 0).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
        <td style="color:${balance > 0 ? 'var(--accent)' : 'var(--success)'};font-weight:600">PHP ${balance.toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
        <td>
          <span class="status-pill ${status.className}">${status.label}</span>
          ${isOverdue && status.key !== 'paid' ? '<div style="margin-top:4px;font-size:0.68rem;color:var(--danger);font-weight:600;">Overdue</div>' : ''}
        </td>
        <td style="display:flex; gap:6px; flex-wrap:wrap;">
          ${pdfButton}
          <button class="btn btn-edit btn-sm" type="button" onclick="editBill(${b.id})">Edit</button>
        </td>
      </tr>
    `;
  }).join('') : '<tr class="empty-row"><td colspan="9">No bills found</td></tr>';
}

function openBillModal() {
  document.getElementById('f-bill-number').value = '';
  document.getElementById('f-bill-date').valueAsDate = new Date();
  document.getElementById('f-bill-due-date').valueAsDate = new Date(Date.now() + 30*24*60*60*1000);
  document.getElementById('f-bill-amount').value = '';
  document.getElementById('f-bill-notes').value = '';
  removeBillPdf(false);
  document.getElementById('bill-modal-backdrop').classList.add('open');
}

function closeBillModal() {
  document.getElementById('bill-modal-backdrop').classList.remove('open');
}

function saveBill() {
  const vendorId = document.getElementById('f-bill-vendor').value;
  const billNumber = document.getElementById('f-bill-number').value.trim();
  const totalAmount = parseFloat(document.getElementById('f-bill-amount').value);
  
  if (!vendorId || !billNumber || !totalAmount) {
    alert('Vendor, Bill Number, and Total Amount are required');
    return;
  }
  
  const formData = new FormData();
  formData.append('vendor_id', vendorId);
  formData.append('bill_number', billNumber);
  formData.append('bill_date', document.getElementById('f-bill-date').value);
  formData.append('due_date', document.getElementById('f-bill-due-date').value);
  formData.append('total_amount', totalAmount);
  formData.append('notes', document.getElementById('f-bill-notes').value.trim());
  if (stagedBillPdf instanceof File) {
    formData.append('pdf_file', stagedBillPdf);
  }

  fetch('/api/bills', {
    method: 'POST',
    body: formData
  }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(data.error || 'Unable to save bill.');
    }
    return data;
  }).then(() => {
    closeBillModal();
    loadBills();
    alert('Bill saved successfully');
  }).catch(e => alert('Error: ' + e.message));
}

function editBill(id) {
  alert('Edit bill coming soon');
}

function handleBillPdfChosen(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.type !== 'application/pdf' && !String(file.name || '').toLowerCase().endsWith('.pdf')) {
    alert('Please select a PDF file only.');
    event.target.value = '';
    return;
  }

  stagedBillPdf = file;
  document.getElementById('bill-pdf-name').textContent = file.name;
  document.getElementById('bill-pdf-preview').style.display = 'flex';
  document.getElementById('bill-upload-zone').style.display = 'none';
}

function handleBillPdfDrop(event) {
  event.preventDefault();
  const zone = document.getElementById('bill-upload-zone');
  zone.classList.remove('drag-over');

  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;
  if (file.type !== 'application/pdf' && !String(file.name || '').toLowerCase().endsWith('.pdf')) {
    alert('Please drop a PDF file only.');
    return;
  }

  const input = document.getElementById('f-bill-pdf');
  try {
    input.files = event.dataTransfer.files;
  } catch (_) {
    // Some browsers block assigning FileList directly; staging still works.
  }

  handleBillPdfChosen({ target: { files: [file] } });
}

function removeBillPdf(resetInput = true) {
  stagedBillPdf = null;
  document.getElementById('bill-pdf-preview').style.display = 'none';
  document.getElementById('bill-upload-zone').style.display = 'block';
  document.getElementById('bill-pdf-name').textContent = '';
  if (resetInput) {
    document.getElementById('f-bill-pdf').value = '';
  }
}

function openBillPdfViewer(id) {
  const bill = billsDb.find(b => b.id === id);
  if (!bill || !bill.pdfFilename) {
    alert('No PDF attached');
    return;
  }

  const pdfUrl = `/api/bills/${bill.id}/pdf`;
  document.getElementById('pdf-viewer-title').textContent = bill.pdfFilename || 'Bill PDF';
  document.getElementById('pdf-dl-btn').href = pdfUrl;
  document.getElementById('pdf-dl-btn').download = bill.pdfFilename;
  document.getElementById('pdf-fallback-dl').href = pdfUrl;
  document.getElementById('pdf-fallback-dl').download = bill.pdfFilename;

  const frame = document.getElementById('pdf-frame');
  const fallback = document.getElementById('pdf-fallback');
  frame.src = pdfUrl;
  frame.style.display = 'block';
  fallback.style.display = 'none';

  document.getElementById('pdf-viewer-backdrop').classList.add('open');
}

function closeBillPdfViewer() {
  document.getElementById('pdf-viewer-backdrop').classList.remove('open');
  document.getElementById('pdf-frame').src = 'about:blank';
}

function updateBillSelects() {
  document.getElementById('f-payment-bill').innerHTML = '<option value="">Select bill to pay</option>' +
    billsDb.filter(b => (b.total_amount - (b.paid_amount || 0)) > 0).map(b => 
      `<option value="${b.id}">${escHtml(b.bill_number)} - PHP ${(b.total_amount - (b.paid_amount || 0)).toLocaleString('en-PH', {minimumFractionDigits: 2})}</option>`
    ).join('');
}

function updateMetrics() {
  const totalPayable = billsDb.reduce((sum, b) => sum + Math.max(0, b.total_amount - (b.paid_amount || 0)), 0);
  document.getElementById('metric-total-payable').textContent = 'PHP ' + totalPayable.toLocaleString('en-PH', {minimumFractionDigits: 2});
  document.getElementById('metric-vendors-count').textContent = vendorsDb.length;
  document.getElementById('metric-open-bills').textContent = billsDb.filter(b => Math.max(0, b.total_amount - (b.paid_amount || 0)) > 0).length;
  
  const overdueBills = billsDb.filter(b => {
    const balance = b.total_amount - (b.paid_amount || 0);
    return balance > 0 && new Date(b.due_date) < new Date();
  });
  document.getElementById('metric-overdue-count').textContent = overdueBills.length;
  
  const overdueAmount = overdueBills.reduce((sum, b) => sum + (b.total_amount - (b.paid_amount || 0)), 0);
  document.getElementById('metric-overdue-amount').textContent = 'PHP ' + overdueAmount.toLocaleString('en-PH', {minimumFractionDigits: 2});
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PAYMENTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function loadPayments() {
  fetch('/api/payments?type=ap').then(r => r.json()).then(data => {
    paymentsDb = data;
    renderPayments();
  }).catch(e => console.error('Error:', e));
}

function renderPayments() {
  filterPayments();
}

function filterPayments() {
  const methodFilter = document.getElementById('payment-method-filter')?.value || '';
  const tbody = document.getElementById('payments-tbody');
  const filtered = paymentsDb.filter(p => !methodFilter || String(p.payment_method || '').toLowerCase() === methodFilter);
  tbody.innerHTML = filtered.length ? filtered.map(p => `
    <tr>
      <td>${formatDate(p.payment_date)}</td>
      <td>${escHtml(billsDb.find(b => b.id === p.ap_id)?.bill_number || '-')}</td>
      <td>${escHtml(vendorsDb.find(v => v.id === billsDb.find(b => b.id === p.ap_id)?.vendor_id)?.vendor_name || '-')}</td>
      <td>PHP ${(p.amount).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
      <td>${p.payment_method}</td>
      <td>${escHtml(p.reference_number || '-')}</td>
      <td>${escHtml(p.notes || '-')}</td>
    </tr>
  `).join('') : '<tr class="empty-row"><td colspan="7">No payments found</td></tr>';
}

function openPaymentModal() {
  document.getElementById('f-payment-date').valueAsDate = new Date();
  document.getElementById('f-payment-amount').value = '';
  document.getElementById('f-payment-method').value = 'cash';
  document.getElementById('f-payment-reference').value = '';
  document.getElementById('f-payment-notes').value = '';
  document.getElementById('payment-modal-backdrop').classList.add('open');
}

function closePaymentModal() {
  document.getElementById('payment-modal-backdrop').classList.remove('open');
}

function savePayment() {
  const billId = document.getElementById('f-payment-bill').value;
  const amount = parseFloat(document.getElementById('f-payment-amount').value);
  
  if (!billId || !amount) {
    alert('Bill and payment amount are required');
    return;
  }
  
  const payload = {
    payment_type: 'ap',
    ap_id: billId,
    payment_date: document.getElementById('f-payment-date').value,
    amount,
    payment_method: document.getElementById('f-payment-method').value,
    reference_number: document.getElementById('f-payment-reference').value.trim(),
    notes: document.getElementById('f-payment-notes').value.trim()
  };
  
  fetch('/api/payments', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  }).then(r => r.json()).then(() => {
    closePaymentModal();
    loadPayments();
    loadBills();
    alert('Payment recorded successfully');
  }).catch(e => alert('Error: ' + e.message));
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// UTILITIES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightText(value, query) {
  const escaped = escHtml(value);
  const tokens = String(query || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return escaped;
  const pattern = tokens.sort((a, b) => b.length - a.length).map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return pattern ? escaped.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>') : escaped;
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-PH', {year: 'numeric', month: 'short', day: 'numeric'});
}

