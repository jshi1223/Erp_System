'use strict';

let receivablesDb = [];
let collectionsDb = [];
let transactionsDb = [];
let editingCollectionId = null;
let editingReceivableId = null;
const arToolbarState = {
  receivables: { search: '' },
  collections: {},
  summary: {}
};
let activeArTab = 'receivables';

document.addEventListener('DOMContentLoaded', () => {
  renderArToolbarControls(activeArTab);
  setTodayDefaults();
  loadReceivables();
  loadCollections();
  loadTransactions();
  if (typeof loadNotifications === 'function') loadNotifications();
});

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

function goBackToDashboard() {
  window.location.href = '/admin?view=dashboard';
}

function doLogout() {
  fetch('/logout', { method: 'POST' }).finally(() => {
    window.location.href = '/';
  });
}

function captureArToolbarState(tab) {
  if (tab === 'receivables') {
    arToolbarState.receivables.search = document.getElementById('receivable-search')?.value || '';
  }
}

function renderArToolbarControls(tab) {
  const actions = document.getElementById('module-toolbar-actions');
  if (!actions) return;

  const state = arToolbarState[tab] || {};

  if (tab === 'receivables') {
    actions.innerHTML = `
      <div class="search-wrap top-search-bar module-toolbar-search">
        <input id="receivable-search" type="text" placeholder="Search customer or invoice number..." value="${escHtml(state.search || '')}" oninput="renderReceivables()" />
      </div>
      <button class="btn btn-add btn-sm" type="button" onclick="openReceivableModal()">Add Receivable</button>
    `;
    return;
  }

  if (tab === 'collections') {
    actions.innerHTML = `
      <button class="btn btn-add btn-sm" type="button" onclick="openCollectionModal()">Record Collection</button>
    `;
    return;
  }

  actions.innerHTML = '';
}

function switchTab(tab, btn) {
  captureArToolbarState(activeArTab);
  document.querySelectorAll('.module-tab').forEach(node => node.classList.remove('active'));
  document.querySelectorAll('.content-section').forEach(node => node.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(tab).classList.add('active');
  activeArTab = tab;
  renderArToolbarControls(tab);
}

function setTodayDefaults() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('f-invoice-date').value = today;
  document.getElementById('f-collection-date').value = today;
}

const formatMoney = formatPhpCurrency;

function highlightText(value, query) {
  const escaped = escHtml(value);
  const tokens = String(query || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return escaped;
  const pattern = tokens.sort((a, b) => b.length - a.length).map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return pattern ? escaped.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>') : escaped;
}

function getReceivableStatus(row) {
  if (Number(row.archived || 0) === 1) return 'cancelled';
  const total = Number(row.total_amount || 0);
  const paid = Number(row.paid_amount ?? row.downpayment ?? 0);
  if (paid >= total && total > 0) return 'paid';
  if (paid > 0) return 'partial';
  if (row.status === 'overdue') return 'overdue';
  const dueDate = row.due_date ? new Date(row.due_date) : null;
  if (dueDate && !Number.isNaN(dueDate.getTime())) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    dueDate.setHours(0, 0, 0, 0);
    if (dueDate < today) return 'overdue';
  }
  return 'sent';
}

function getReceivableUiStatus(row) {
  const computed = getReceivableStatus(row);
  if (computed === 'paid') return { key: 'paid', label: 'Paid', className: 'status-paid' };
  if (computed === 'partial') return { key: 'partial', label: 'Partial', className: 'status-partial' };
  if (computed === 'overdue') return { key: 'overdue', label: 'Overdue', className: 'status-overdue' };
  if (computed === 'cancelled') return { key: 'cancelled', label: 'Archived', className: 'status-cancelled' };
  return { key: 'unpaid', label: 'Unpaid', className: 'status-unpaid' };
}

async function loadReceivables() {
  try {
    const res = await fetch('/api/receivables?include_archived=1');
    receivablesDb = await res.json();
    updateMetrics();
    populateReceivableSelect();
    renderReceivables();
  } catch (err) {
    console.error(err);
    showToast('Failed to load receivables', 'error');
  }
}

async function loadCollections() {
  try {
    const res = await fetch('/api/payments?type=ar');
    collectionsDb = await res.json();
    renderCollections();
  } catch (err) {
    console.error(err);
    showToast('Failed to load collections', 'error');
  }
}

async function loadTransactions() {
  try {
    const res = await fetch('/api/transactions');
    transactionsDb = await res.json();
    renderReceivables();
  } catch (err) {
    console.error(err);
    transactionsDb = [];
  }
}

function getTransactionRelationLabel(row) {
  const docNo = String(row.docno || 'Transaction').trim() || 'Transaction';
  const customer = String(row.client || 'Unknown Customer').trim() || 'Unknown Customer';
  const amount = formatMoney(Number(row.amount || 0));
  const statusFn = typeof getComputedTransactionPaymentStatus === 'function'
    ? getComputedTransactionPaymentStatus(row)
    : String(row.status || 'unpaid');
  const status = String(statusFn || 'unpaid').trim().toUpperCase();
  return `${docNo} - ${customer} (${amount}, ${status})`;
}

function getTransactionRelationMeta(row) {
  const parts = [];
  if (row.date) parts.push(`Date ${row.date}`);
  if (row.project_tx_no) parts.push(`Project TX #${row.project_tx_no}`);
  if (row.pono) parts.push(`PO ${row.pono}`);
  return parts.length ? parts.join(' • ') : 'Linked ERP transaction';
}

function getTransactionRelationHelp() {
  return 'Choose the source transaction so the receivable follows the ERP relationship instead of being entered as an isolated record.';
}

function getReceivableFieldMessageNode(fieldName) {
  return document.querySelector(`[data-receivable-field-message="${fieldName}"]`);
}

function clearReceivableFieldMessages() {
  document.querySelectorAll('[data-receivable-field-message]').forEach((node) => {
    node.textContent = '';
    node.classList.add('is-hidden');
  });
}

function setReceivableFieldMessage(fieldName, message) {
  const node = getReceivableFieldMessageNode(fieldName);
  if (!node) return;
  const text = String(message || '').trim();
  node.textContent = text;
  node.classList.toggle('is-hidden', !text);
}

function resetReceivableForm() {
  const today = new Date().toISOString().split('T')[0];
  const fieldIds = [
    'f-customer-name',
    'f-invoice-number',
    'f-due-date',
    'f-total-amount',
    'f-ar-notes'
  ];
  fieldIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const invoiceDate = document.getElementById('f-invoice-date');
  if (invoiceDate) invoiceDate.value = today;
  const status = document.getElementById('f-ar-status');
  if (status) status.value = 'draft';
  clearReceivableFieldMessages();
  setReceivableTransactionSelection('', '');
  renderReceivableTransactionResults('', false);
}

function syncReceivableModalMode() {
  const title = document.querySelector('#receivable-modal-backdrop .modal-title');
  const saveBtn = document.querySelector('#receivable-modal-backdrop .btn-save');
  const transactionSearch = document.getElementById('f-transaction-search');
  if (title) title.textContent = editingReceivableId ? 'Edit Receivable' : 'Add Receivable';
  if (saveBtn) saveBtn.textContent = editingReceivableId ? 'Save Changes' : 'Save Receivable';
  if (transactionSearch) {
    transactionSearch.disabled = Boolean(editingReceivableId);
    transactionSearch.placeholder = editingReceivableId
      ? 'Linked transaction locked on edit'
      : 'Search transaction number or customer...';
  }
}

function setReceivableTransactionSelection(transactionId, label) {
  const hidden = document.getElementById('f-transaction-id');
  const search = document.getElementById('f-transaction-search');
  const results = document.getElementById('f-transaction-results');
  const help = document.getElementById('f-transaction-help');
  if (hidden) hidden.value = transactionId ? String(transactionId) : '';
  if (search) search.value = label || '';
  if (results) results.style.display = 'none';
  if (help) help.textContent = transactionId ? 'Linked transaction selected. Customer, invoice number, and amount can be synced from this source record.' : getTransactionRelationHelp();
  setReceivableFieldMessage('transaction', '');
}

function applyReceivableTransactionSelection(transactionId) {
  const selected = transactionsDb.find(row => Number(row.id) === Number(transactionId));
  if (!selected) return;

  const customerName = String(selected.client || '').trim();
  const invoiceNumber = String(selected.docno || '').trim();
  const invoiceDate = String(selected.date || '').trim();
  const totalAmount = Number(selected.amount || 0);
  const paidAmount = Number(selected.receivable_paid_amount || selected.paid_amount || selected.downpayment || 0);
  const mappedStatus = totalAmount > 0 && paidAmount >= totalAmount
    ? 'paid'
    : (paidAmount > 0 ? 'partial' : 'sent');

  if (customerName) document.getElementById('f-customer-name').value = customerName;
  if (invoiceNumber) document.getElementById('f-invoice-number').value = invoiceNumber;
  if (invoiceDate) document.getElementById('f-invoice-date').value = invoiceDate;
  document.getElementById('f-total-amount').value = totalAmount ? String(totalAmount) : '';
  document.getElementById('f-ar-status').value = mappedStatus;
}

function renderReceivableTransactionResults(query = '', showAll = false) {
  const wrapper = document.getElementById('f-transaction-results');
  const search = document.getElementById('f-transaction-search');
  if (!wrapper || !search) return;

  const q = String(query || '').trim().toLowerCase();
  const selectedId = String(document.getElementById('f-transaction-id')?.value || '');
  const rows = (transactionsDb || []).filter((row) => {
    const haystack = [
      row.docno,
      row.client,
      row.description,
      row.status,
      row.checkno,
      row.pono
    ].join(' ').toLowerCase();
    return !q || haystack.includes(q);
  }).slice(0, showAll ? 12 : 8);

  if (!q && !showAll) {
    wrapper.style.display = 'none';
    wrapper.innerHTML = '';
    return;
  }

  if (!rows.length) {
    wrapper.innerHTML = '<div class="search-result-empty">No matching transactions found.</div>';
    wrapper.style.display = 'block';
    return;
  }

  wrapper.innerHTML = rows.map((row) => {
    const label = getTransactionRelationLabel(row);
    const meta = getTransactionRelationMeta(row);
    const isSelected = String(row.id) === selectedId;
    return `
      <div class="search-result-item${isSelected ? ' is-selected' : ''}" data-id="${escHtml(row.id)}" data-label="${escHtml(label)}">
        <div class="search-result-name">${highlightText(label, q)}</div>
        <div class="search-result-sub">${highlightText(meta, q)}</div>
      </div>
    `;
  }).join('');
  wrapper.style.display = 'block';
}

function handleReceivableTransactionSearch(event, showAll = false) {
  const searchInput = event?.target || document.getElementById('f-transaction-search');
  const hiddenInput = document.getElementById('f-transaction-id');
  const currentLabel = String(searchInput?.value || '');
  if (hiddenInput && hiddenInput.value) {
    const selectedRow = transactionsDb.find(row => String(row.id) === String(hiddenInput.value));
    const selectedLabel = selectedRow ? getTransactionRelationLabel(selectedRow) : '';
    if (currentLabel !== selectedLabel) {
      hiddenInput.value = '';
    }
  }
  renderReceivableTransactionResults(currentLabel, showAll);
}

function initReceivableTransactionSearch() {
  const searchInput = document.getElementById('f-transaction-search');
  const results = document.getElementById('f-transaction-results');
  if (!searchInput || !results || searchInput.dataset.bound === '1') return;

  searchInput.dataset.bound = '1';
  searchInput.addEventListener('input', handleReceivableTransactionSearch);
  searchInput.addEventListener('focus', () => {
    handleReceivableTransactionSearch({ target: searchInput }, true);
  });

  results.addEventListener('click', (event) => {
    const item = event.target.closest('.search-result-item');
    if (!item) return;
    const id = item.getAttribute('data-id');
    const label = item.getAttribute('data-label') || '';
    setReceivableTransactionSelection(id, label);
    applyReceivableTransactionSelection(id);
  });

  document.addEventListener('click', (event) => {
    const wrapper = searchInput.closest('.receivable-transaction-search');
    if (wrapper && !wrapper.contains(event.target)) {
      results.style.display = 'none';
    }
  });
}

function updateMetrics() {
  const totalReceivable = receivablesDb.reduce((sum, row) => {
    if (Number(row.archived || 0) === 1) return sum;
    return sum + Math.max(0, Number(row.total_amount || 0) - Number(row.paid_amount || 0));
  }, 0);
  const openCount = receivablesDb.filter(row => !['paid', 'cancelled'].includes(getReceivableStatus(row))).length;
  const today = new Date().toISOString().split('T')[0];
  const overdueAmount = receivablesDb.reduce((sum, row) => {
    if (Number(row.archived || 0) === 1) return sum;
    const balance = Math.max(0, Number(row.total_amount || 0) - Number(row.paid_amount || 0));
    return row.due_date && row.due_date < today && balance > 0 ? sum + balance : sum;
  }, 0);
  const draftSent = receivablesDb.filter(row => ['draft', 'sent'].includes(getReceivableStatus(row))).length;
  const partialCount = receivablesDb.filter(row => getReceivableStatus(row) === 'partial').length;
  const paidCount = receivablesDb.filter(row => getReceivableStatus(row) === 'paid').length;

  document.getElementById('metric-total-receivable').textContent = formatMoney(totalReceivable);
  document.getElementById('metric-open-count').textContent = openCount;
  document.getElementById('metric-overdue-amount').textContent = formatMoney(overdueAmount);
  document.getElementById('metric-draft-sent').textContent = draftSent;
  document.getElementById('metric-partial-count').textContent = partialCount;
  document.getElementById('metric-paid-count').textContent = paidCount;
}

function renderReceivables() {
  const q = String(document.getElementById('receivable-search')?.value || '').toLowerCase().trim();
  const tbody = document.getElementById('receivables-tbody');

  const filtered = receivablesDb.filter(row => {
    const matchesSearch = !q || [
      row.customer_name,
      row.invoice_number,
      row.project_docno,
      row.service_order_no,
      row.transaction_id
    ].join(' ').toLowerCase().includes(q);
    return matchesSearch;
  });

  if (!filtered.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="10">No receivables found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(row => {
    const total = Number(row.total_amount || 0);
    const paid = Number(row.paid_amount || 0);
    const balance = Math.max(0, total - paid);
    const uiStatus = getReceivableUiStatus(row);
    const sourceTransaction = Number(row.transaction_id || 0) ? transactionsDb.find(tx => Number(tx.id) === Number(row.transaction_id)) : null;
    const sourceLabelBase = sourceTransaction
      ? `${sourceTransaction.docno || 'TXN'} - ${sourceTransaction.client || 'Unknown'}`
      : (Number(row.transaction_id || 0) ? `TX #${row.transaction_id}` : 'Manual');
    const serviceOrderLabel = String(row.service_order_no || '').trim();
    const sourceLabel = serviceOrderLabel
      ? `${sourceLabelBase} • ${serviceOrderLabel}`
      : sourceLabelBase;
    const isArchived = Number(row.archived || 0) === 1;
    return `
      <tr>
        <td>${highlightText(row.invoice_number, q)}</td>
        <td>${highlightText(row.customer_name, q)}</td>
        <td>${highlightText(sourceLabel, q)}</td>
        <td>${escHtml(row.invoice_date || '')}</td>
        <td>${escHtml(row.due_date || '-')}</td>
        <td>${formatMoney(total)}</td>
        <td>${formatMoney(paid)}</td>
        <td>${formatMoney(balance)}</td>
        <td>
          <span class="status-pill ${uiStatus.className}">${highlightText(uiStatus.label, q)}</span>
        </td>
        <td>
          ${isArchived ? `
            <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
              <button class="btn btn-save btn-sm" onclick="restoreReceivable(${row.id})">Restore</button>
            </div>
          ` : balance > 0 ? `
            <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
              <button class="btn btn-save btn-sm" onclick="openCollectionModal(${row.id})">Record Payment</button>
              <button class="btn btn-edit btn-sm" onclick="openReceivableModal(${row.id})">Edit</button>
              <button class="btn btn-cancel btn-sm" onclick="archiveReceivable(${row.id})">Archive</button>
            </div>
          ` : `
            <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
              <button class="btn btn-edit btn-sm" onclick="openReceivableModal(${row.id})">Edit</button>
              <button class="btn btn-cancel btn-sm" onclick="archiveReceivable(${row.id})">Archive</button>
            </div>
          `}
        </td>
      </tr>
    `;
  }).join('');
}

function renderCollections() {
  const tbody = document.getElementById('collections-tbody');
  if (!collectionsDb.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No collections yet.</td></tr>';
    return;
  }

  tbody.innerHTML = collectionsDb.map(row => {
    const receivable = receivablesDb.find(item => item.id === row.ar_id);
    return `
      <tr>
        <td>${escHtml(row.payment_date || '')}</td>
        <td>${escHtml(receivable?.invoice_number || '-')}</td>
        <td>${escHtml(receivable?.customer_name || '-')}</td>
        <td>${formatMoney(row.amount)}</td>
        <td>${escHtml(row.payment_method || '-')}</td>
        <td>${escHtml(row.reference_number || '-')}</td>
        <td>${escHtml(row.notes || '-')}</td>
        <td>
          <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
            <button class="btn btn-edit btn-sm" onclick="openCollectionEditModal(${row.id})">Edit</button>
            <button class="btn btn-cancel btn-sm" onclick="deleteCollection(${row.id})">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function populateReceivableSelect(selectedId = '') {
  const select = document.getElementById('f-collection-ar');
  const selectedKey = String(selectedId || '');
  const openRows = receivablesDb.filter(row => Number(row.archived || 0) !== 1 && getReceivableStatus(row) !== 'paid');
  const selectedRow = selectedKey ? receivablesDb.find(row => String(row.id) === selectedKey) : null;
  const rows = selectedRow && !openRows.some(row => String(row.id) === selectedKey)
    ? [selectedRow, ...openRows]
    : openRows;
  if (!rows.length) {
    select.innerHTML = '<option value="">No open receivables</option>';
    return;
  }
  select.innerHTML = rows.map(row => {
    const balance = Math.max(0, Number(row.total_amount || 0) - Number(row.paid_amount || 0));
    return `<option value="${row.id}" ${String(selectedId) === String(row.id) ? 'selected' : ''}>${escHtml(row.invoice_number)} - ${escHtml(row.customer_name)} (${formatMoney(balance)})</option>`;
  }).join('');
}

function openReceivableModal(receivableId = null) {
  initReceivableTransactionSearch();
  resetReceivableForm();
  editingReceivableId = receivableId ? Number(receivableId) : null;
  syncReceivableModalMode();

  if (editingReceivableId) {
    const row = receivablesDb.find(item => Number(item.id) === Number(editingReceivableId));
    if (!row) {
      editingReceivableId = null;
      syncReceivableModalMode();
      showToast('Receivable not found', 'error');
      return;
    }

    const selectedTransaction = Number(row.transaction_id || 0)
      ? transactionsDb.find(tx => Number(tx.id) === Number(row.transaction_id))
      : null;
    const transactionLabel = selectedTransaction ? getTransactionRelationLabel(selectedTransaction) : '';
    if (row.transaction_id) {
      setReceivableTransactionSelection(row.transaction_id, transactionLabel);
      if (selectedTransaction) {
        applyReceivableTransactionSelection(row.transaction_id);
      }
    }

    const customerInput = document.getElementById('f-customer-name');
    const invoiceInput = document.getElementById('f-invoice-number');
    const invoiceDateInput = document.getElementById('f-invoice-date');
    const totalInput = document.getElementById('f-total-amount');
    const dueDateInput = document.getElementById('f-due-date');
    const statusInput = document.getElementById('f-ar-status');
    const notesInput = document.getElementById('f-ar-notes');

    if (customerInput) customerInput.value = row.customer_name || '';
    if (invoiceInput) invoiceInput.value = row.invoice_number || '';
    if (invoiceDateInput) invoiceDateInput.value = row.invoice_date || '';
    if (totalInput) totalInput.value = Number(row.total_amount || 0) ? String(Number(row.total_amount || 0)) : '';
    if (dueDateInput) dueDateInput.value = row.due_date || '';
    if (statusInput) statusInput.value = String(row.status || 'draft');
    if (notesInput) notesInput.value = row.notes || '';
  }

  document.getElementById('receivable-modal-backdrop').classList.add('open');
}

function closeReceivableModal() {
  document.getElementById('receivable-modal-backdrop').classList.remove('open');
  editingReceivableId = null;
  resetReceivableForm();
  syncReceivableModalMode();
}

function syncCollectionModalMode() {
  const title = document.querySelector('#collection-modal-backdrop .modal-title');
  const saveBtn = document.querySelector('#collection-modal-backdrop .btn-save');
  if (title) title.textContent = editingCollectionId ? 'Edit Collection' : 'Record Collection';
  if (saveBtn) saveBtn.textContent = editingCollectionId ? 'Save Changes' : 'Save Collection';
}

function resetCollectionForm() {
  document.getElementById('f-collection-amount').value = '';
  document.getElementById('f-collection-reference').value = '';
  document.getElementById('f-collection-notes').value = '';
  document.getElementById('f-collection-method').value = 'cash';
  setTodayDefaults();
  const help = document.getElementById('f-collection-amount-help');
  if (help) {
    help.textContent = 'Prefilled with the remaining balance for faster collection entry.';
  }
}

function openCollectionModal(receivableId = '', suggestedAmount = '') {
  editingCollectionId = null;
  populateReceivableSelect(receivableId);
  if (!document.getElementById('f-collection-ar').value) {
    showToast('No open receivables available', 'error');
    return;
  }
  const selectedId = Number(document.getElementById('f-collection-ar').value || receivableId || 0);
  const selectedRow = receivablesDb.find(item => Number(item.id) === selectedId);
  const balance = selectedRow ? Math.max(0, Number(selectedRow.total_amount || 0) - Number(selectedRow.paid_amount || 0)) : 0;
  const amountInput = document.getElementById('f-collection-amount');
  if (amountInput) {
    amountInput.value = suggestedAmount !== '' ? suggestedAmount : balance.toFixed(2);
  }
  const help = document.getElementById('f-collection-amount-help');
  if (help) {
    help.textContent = selectedRow
      ? `Remaining balance: ${formatMoney(balance)}. You can type a smaller amount if this is only a partial payment.`
      : 'Prefilled with the remaining balance for faster entry.';
  }
  syncCollectionModalMode();
  document.getElementById('collection-modal-backdrop').classList.add('open');
}

function closeCollectionModal() {
  document.getElementById('collection-modal-backdrop').classList.remove('open');
  editingCollectionId = null;
  resetCollectionForm();
  syncCollectionModalMode();
}

function openCollectionEditModal(collectionId) {
  const row = collectionsDb.find(item => Number(item.id) === Number(collectionId));
  if (!row) {
    showToast('Collection not found', 'error');
    return;
  }
  editingCollectionId = Number(collectionId);
  populateReceivableSelect(row.ar_id);
  document.getElementById('f-collection-ar').value = row.ar_id;
  document.getElementById('f-collection-date').value = row.payment_date || '';
  document.getElementById('f-collection-amount').value = row.amount || '';
  document.getElementById('f-collection-method').value = row.payment_method || 'cash';
  document.getElementById('f-collection-reference').value = row.reference_number || '';
  document.getElementById('f-collection-notes').value = row.notes || '';
  const help = document.getElementById('f-collection-amount-help');
  if (help) help.textContent = 'Edit this collection amount, date, method, or notes.';
  syncCollectionModalMode();
  document.getElementById('collection-modal-backdrop').classList.add('open');
}

async function saveReceivable() {
  clearReceivableFieldMessages();
  const payload = {
    transaction_id: Number(document.getElementById('f-transaction-id').value || 0) || null,
    customer_name: document.getElementById('f-customer-name').value.trim(),
    invoice_number: document.getElementById('f-invoice-number').value.trim(),
    invoice_date: document.getElementById('f-invoice-date').value,
    due_date: document.getElementById('f-due-date').value || null,
    total_amount: Number(document.getElementById('f-total-amount').value || 0),
    status: document.getElementById('f-ar-status').value,
    notes: document.getElementById('f-ar-notes').value.trim()
  };

  if (!payload.transaction_id) {
    setReceivableFieldMessage('transaction', 'Select a linked transaction before saving this receivable.');
    showToast('Select a linked transaction first', 'error');
    return;
  }

  const selectedTransaction = transactionsDb.find(row => Number(row.id) === Number(payload.transaction_id));
  if (!selectedTransaction) {
    setReceivableFieldMessage('transaction', 'Pick a valid linked transaction from the list before saving.');
    showToast('Pick a valid linked transaction first', 'error');
    return;
  }

  payload.customer_name = String(selectedTransaction.client || '').trim();
  payload.invoice_number = String(selectedTransaction.docno || '').trim();
  payload.invoice_date = String(selectedTransaction.date || '').trim();
  payload.total_amount = Number(selectedTransaction.amount || 0);

  if (!payload.customer_name || !payload.invoice_number || !payload.invoice_date || payload.total_amount <= 0) {
    showToast('Complete the required receivable fields', 'error');
    return;
  }

  try {
    const isEdit = Boolean(editingReceivableId);
    const res = await fetch(isEdit ? `/api/receivables/${editingReceivableId}` : '/api/receivables', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save receivable');
    closeReceivableModal();
    document.getElementById('f-customer-name').value = '';
    document.getElementById('f-invoice-number').value = '';
    document.getElementById('f-total-amount').value = '';
    document.getElementById('f-due-date').value = '';
    document.getElementById('f-ar-notes').value = '';
    document.getElementById('f-ar-status').value = 'draft';
    setReceivableTransactionSelection('', '');
    setTodayDefaults();
    await Promise.all([loadReceivables(), loadTransactions()]);
    showToast(data.warning || (isEdit ? 'Receivable updated successfully' : 'Receivable saved'), data.warning ? 'error' : 'success');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

async function saveCollection() {
  const isEdit = Boolean(editingCollectionId);
  const payload = {
    payment_type: 'ar',
    ar_id: Number(document.getElementById('f-collection-ar').value),
    payment_date: document.getElementById('f-collection-date').value,
    amount: Number(document.getElementById('f-collection-amount').value || 0),
    payment_method: document.getElementById('f-collection-method').value,
    reference_number: document.getElementById('f-collection-reference').value.trim(),
    notes: document.getElementById('f-collection-notes').value.trim()
  };

  if (!payload.ar_id || !payload.payment_date || payload.amount <= 0) {
    showToast('Complete the collection form first', 'error');
    return;
  }

  try {
    const url = editingCollectionId ? `/api/payments/${editingCollectionId}` : '/api/payments';
    const res = await fetch(url, {
      method: editingCollectionId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save collection');
    closeCollectionModal();
    document.getElementById('f-collection-amount').value = '';
    document.getElementById('f-collection-reference').value = '';
    document.getElementById('f-collection-notes').value = '';
    setTodayDefaults();
    await Promise.all([loadReceivables(), loadCollections(), loadTransactions()]);
    showToast(isEdit ? 'Collection updated successfully' : 'Payment recorded successfully');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

async function deleteCollection(id) {
  const row = collectionsDb.find(item => Number(item.id) === Number(id));
  const confirmed = await openConfirmDialog({
    title: 'Delete Collection',
    message: `Delete payment on ${row?.payment_date || 'this record'}?`,
    noText: 'No',
    yesText: 'Yes'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/payments/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete collection');
    await Promise.all([loadReceivables(), loadCollections(), loadTransactions()]);
    showToast('Collection deleted successfully');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

async function archiveReceivable(id) {
  const row = receivablesDb.find(item => Number(item.id) === Number(id));
  const confirmed = await openConfirmDialog({
    title: 'Archive Receivable',
    message: `Archive ${row?.invoice_number || 'this receivable'}?`,
    noText: 'No',
    yesText: 'Yes'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/receivables/${id}/archive`, { method: 'PUT' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to archive receivable');
    await loadReceivables();
    showToast('Receivable archived');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

async function restoreReceivable(id) {
  try {
    const res = await fetch(`/api/receivables/${id}/restore`, { method: 'PUT' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to restore receivable');
    await loadReceivables();
    showToast('Receivable restored');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
}

