'use strict';

const erpState = {
  summary: null,
  companies: [],
  accounts: [],
  journalEntries: [],
  requisitions: [],
  purchaseOrders: [],
  bills: [],
  vendors: [],
  departments: [],
  employees: [],
  payrollPeriods: [],
  payrollRuns: []
};

let editingCompanyId = null;

document.addEventListener('DOMContentLoaded', bootstrapErp);

function $(id) {
  return document.getElementById(id);
}

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(value) {
  return `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateText(value) {
  return value ? String(value).slice(0, 10) : '-';
}

function setStatus(message, type = '') {
  const node = $('erp-status');
  if (!node) return;
  node.classList.remove('is-success', 'is-error');
  if (type === 'success') node.classList.add('is-success');
  if (type === 'error') node.classList.add('is-error');
  node.textContent = message;
}

async function fetchJson(url, options = {}) {
  const { headers: customHeaders, ...fetchOptions } = options;
  const headers = new Headers(customHeaders || {});
  if (fetchOptions.method && fetchOptions.method !== 'GET') {
    const token = String(window.__CSRF_TOKEN__ || '').trim();
    if (token && !headers.has('X-CSRF-Token')) {
      headers.set('X-CSRF-Token', token);
    }
  }
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...fetchOptions,
    headers
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || `Request failed (${response.status})`);
  }
  return data;
}

async function postJson(url, payload) {
  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
}

function setTodayDefaults() {
  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  ['erp-journal-date', 'erp-pr-date', 'erp-po-date', 'erp-bill-date', 'erp-period-start', 'erp-employee-hiredate'].forEach((id) => {
    const el = $(id);
    if (el && !el.value) el.value = today;
  });

  const prNeededBy = $('erp-pr-needed-by');
  if (prNeededBy && !prNeededBy.value) prNeededBy.value = nextWeek;

  const poDelivery = $('erp-po-delivery');
  if (poDelivery && !poDelivery.value) poDelivery.value = nextMonth;

  const periodEnd = $('erp-period-end');
  if (periodEnd && !periodEnd.value) periodEnd.value = nextMonth;

  const periodPayDate = $('erp-period-paydate');
  if (periodPayDate && !periodPayDate.value) periodPayDate.value = nextMonth;
}

function fillSelect(select, items, valueKey, labelFn, placeholder = 'Select one') {
  if (!select) return;
  const options = [`<option value="">${escHtml(placeholder)}</option>`];
  for (const item of items) {
    options.push(`<option value="${escHtml(item[valueKey])}">${escHtml(labelFn(item))}</option>`);
  }
  select.innerHTML = options.join('');
}

function renderSummary() {
  const summary = erpState.summary || {};
  const setText = (id, value) => {
    const node = $(id);
    if (node) node.textContent = String(value);
  };
  setText('summary-accounts', summary.accounting?.accounts || 0);
  setText('summary-journals', summary.accounting?.journal_entries || 0);
  setText('summary-companies', summary.companies || 0);
  setText('summary-requisitions', summary.procurement?.requisitions || 0);
  setText('summary-pos', summary.procurement?.purchase_orders || 0);
  setText('summary-employees', summary.hr?.employees || 0);
  setText('summary-payroll', summary.hr?.payroll_runs || 0);
}

function renderCompanies() {
  const rows = $('companies-body');
  const companyNoInput = $('erp-company-no');
  const searchQuery = String($('company-search-input')?.value || '').trim().toLowerCase();
  const statusFilter = String($('company-status-filter')?.value || 'active').trim().toLowerCase();
  if (companyNoInput && !companyNoInput.value) {
    fetchJson('/api/company-registry/next-no')
      .then((data) => {
        companyNoInput.value = data.company_no || '';
      })
      .catch(() => {});
  }

  if (!rows) return;
  const filteredCompanies = erpState.companies.filter((company) => {
    const isArchived = Number(company.archived || 0) === 1;
    if (statusFilter === 'active' && isArchived) return false;
    if (statusFilter === 'archived' && !isArchived) return false;
    if (!searchQuery) return true;
    return [
      company.company_no || '',
      company.company_name || '',
      company.address || ''
    ].join(' ').toLowerCase().includes(searchQuery);
  });

  rows.innerHTML = filteredCompanies.length
    ? filteredCompanies.map((company) => `
      <tr>
        <td>${escHtml(company.company_no)}</td>
        <td>${escHtml(company.company_name)}</td>
        <td>${escHtml(company.address || '-')}</td>
        <td>${Number(company.archived || 0) ? 'Archived' : (company.status || 'active')}</td>
        <td>
          <div class="erp-actions" style="justify-content:flex-start; margin-top:0;">
            <button class="btn btn-edit btn-sm" type="button" onclick="editCompany(${Number(company.id)})">Edit</button>
            ${Number(company.archived || 0)
              ? `<button class="btn btn-save btn-sm" type="button" onclick="restoreCompany(${Number(company.id)})">Restore</button>`
              : `<button class="btn btn-cancel btn-sm" type="button" onclick="archiveCompany(${Number(company.id)})">Archive</button>`
            }
          </div>
        </td>
      </tr>
    `).join('')
    : `<tr class="empty-row"><td colspan="5">${searchQuery ? 'No matching companies found.' : 'No companies yet.'}</td></tr>`;
}

function renderAccounting() {
  const parentSelect = $('erp-parent-account-id');
  const debitSelect = $('erp-journal-debit');
  const creditSelect = $('erp-journal-credit');
  const accountRows = $('accounts-body');
  const journalRows = $('journals-body');

  fillSelect(parentSelect, erpState.accounts, 'id', (a) => `${a.account_code} - ${a.account_name}`, 'None');
  fillSelect(debitSelect, erpState.accounts, 'id', (a) => `${a.account_code} - ${a.account_name}`, 'Select account');
  fillSelect(creditSelect, erpState.accounts, 'id', (a) => `${a.account_code} - ${a.account_name}`, 'Select account');

  if (accountRows) {
    accountRows.innerHTML = erpState.accounts.length
      ? erpState.accounts.map((account) => `
        <tr>
          <td>${escHtml(account.account_code)}</td>
          <td>${escHtml(account.account_name)}</td>
          <td>${escHtml(String(account.account_type || '').toUpperCase())}</td>
          <td>${escHtml(account.parent_account_code ? `${account.parent_account_code} - ${account.parent_account_name}` : '-')}</td>
          <td>${Number(account.is_active || 0) ? 'Active' : 'Inactive'}</td>
        </tr>
      `).join('')
      : '<tr class="empty-row"><td colspan="5">No accounts yet.</td></tr>';
  }

  if (journalRows) {
    journalRows.innerHTML = erpState.journalEntries.length
      ? erpState.journalEntries.map((entry) => `
        <tr>
          <td>${escHtml(entry.entry_number)}</td>
          <td>${escHtml(dateText(entry.entry_date))}</td>
          <td>${escHtml(entry.memo || '-')}</td>
          <td>${escHtml(money(entry.total_debit))}</td>
          <td>${escHtml(money(entry.total_credit))}</td>
          <td>${escHtml(entry.line_count || 0)}</td>
          <td>${escHtml(String(entry.status || 'draft'))}</td>
        </tr>
      `).join('')
      : '<tr class="empty-row"><td colspan="7">No journal entries yet.</td></tr>';
  }
}

function renderProcurement() {
  const vendorSelects = [$('erp-po-vendor'), $('erp-bill-vendor')].filter(Boolean);
  const vendorOptions = ['<option value="">Select vendor</option>']
    .concat(erpState.vendors.map((vendor) => `<option value="${escHtml(vendor.id)}">${escHtml(vendor.vendor_name)}</option>`))
    .join('');
  vendorSelects.forEach((select) => { select.innerHTML = vendorOptions; });

  const requisitionRows = $('requisitions-body');
  const purchaseOrderRows = $('purchase-orders-body');
  const billRows = $('bills-body');

  if (requisitionRows) {
    requisitionRows.innerHTML = erpState.requisitions.length
      ? erpState.requisitions.map((row) => `
        <tr>
          <td>${escHtml(row.pr_number)}</td>
          <td>${escHtml(dateText(row.request_date))}</td>
          <td>${escHtml(row.department || '-')}</td>
          <td>${escHtml(row.requested_by || '-')}</td>
          <td>${escHtml(row.status || '-')}</td>
          <td>${escHtml(money(row.total_amount || 0))}</td>
        </tr>
      `).join('')
      : '<tr class="empty-row"><td colspan="6">No requisitions yet.</td></tr>';
  }

  if (purchaseOrderRows) {
    purchaseOrderRows.innerHTML = erpState.purchaseOrders.length
      ? erpState.purchaseOrders.map((row) => `
        <tr>
          <td>${escHtml(row.po_number)}</td>
          <td>${escHtml(row.vendor_name || '-')}</td>
          <td>${escHtml(dateText(row.po_date))}</td>
          <td>${escHtml(dateText(row.delivery_date))}</td>
          <td>${escHtml(row.status || '-')}</td>
          <td>${escHtml(money(row.computed_total || row.total_amount || 0))}</td>
        </tr>
      `).join('')
      : '<tr class="empty-row"><td colspan="6">No purchase orders yet.</td></tr>';
  }

  if (billRows) {
    const vendorById = new Map(erpState.vendors.map((vendor) => [String(vendor.id), vendor.vendor_name]));
    billRows.innerHTML = erpState.bills.length
      ? erpState.bills.map((row) => `
        <tr>
          <td>${escHtml(row.bill_number)}</td>
          <td>${escHtml(vendorById.get(String(row.vendor_id)) || '-')}</td>
          <td>${escHtml(dateText(row.bill_date))}</td>
          <td>${escHtml(dateText(row.due_date))}</td>
          <td>${escHtml(row.status || '-')}</td>
          <td>${escHtml(money(row.total_amount || 0))}</td>
        </tr>
      `).join('')
      : '<tr class="empty-row"><td colspan="6">No bills yet.</td></tr>';
  }
}

function renderHr() {
  fillSelect($('erp-employee-dept'), erpState.departments, 'id', (dept) => dept.department_name, 'Select department');
  fillSelect($('erp-payroll-period'), erpState.payrollPeriods, 'id', (period) => `${period.period_name}`, 'Select period');
  fillSelect($('erp-payroll-employee'), erpState.employees, 'id', (emp) => `${emp.employee_code} - ${emp.full_name}`, 'Select employee');

  const deptRows = $('departments-body');
  const empRows = $('employees-body');
  const periodRows = $('periods-body');
  const payrollRows = $('payroll-body');

  if (deptRows) {
    deptRows.innerHTML = erpState.departments.length
      ? erpState.departments.map((dept) => `
        <tr>
          <td>${escHtml(dept.department_name)}</td>
          <td>${escHtml(dept.description || '-')}</td>
          <td>${Number(dept.is_active || 0) ? 'Active' : 'Inactive'}</td>
        </tr>
      `).join('')
      : '<tr class="empty-row"><td colspan="3">No departments yet.</td></tr>';
  }

  if (empRows) {
    empRows.innerHTML = erpState.employees.length
      ? erpState.employees.map((emp) => `
        <tr>
          <td>${escHtml(emp.employee_code)}</td>
          <td>${escHtml(emp.full_name)}</td>
          <td>${escHtml(emp.department_name || '-')}</td>
          <td>${escHtml(emp.job_title || '-')}</td>
          <td>${escHtml(emp.employment_type || '-')}</td>
          <td>${escHtml(emp.pay_frequency || '-')}</td>
          <td>${escHtml(money(emp.salary_rate || 0))}</td>
          <td>${escHtml(emp.status || '-')}</td>
        </tr>
      `).join('')
      : '<tr class="empty-row"><td colspan="8">No employees yet.</td></tr>';
  }

  if (periodRows) {
    periodRows.innerHTML = erpState.payrollPeriods.length
      ? erpState.payrollPeriods.map((period) => `
        <tr>
          <td>${escHtml(period.period_name)}</td>
          <td>${escHtml(dateText(period.start_date))}</td>
          <td>${escHtml(dateText(period.end_date))}</td>
          <td>${escHtml(dateText(period.pay_date))}</td>
          <td>${escHtml(period.status || '-')}</td>
        </tr>
      `).join('')
      : '<tr class="empty-row"><td colspan="5">No payroll periods yet.</td></tr>';
  }

  if (payrollRows) {
    payrollRows.innerHTML = erpState.payrollRuns.length
      ? erpState.payrollRuns.map((run) => `
        <tr>
          <td>${escHtml(run.full_name || run.employee_code || '-')}</td>
          <td>${escHtml(run.period_name || '-')}</td>
          <td>${escHtml(money(run.gross_pay || 0))}</td>
          <td>${escHtml(money(run.deductions || 0))}</td>
          <td>${escHtml(money(run.net_pay || 0))}</td>
          <td>${escHtml(run.status || '-')}</td>
        </tr>
      `).join('')
      : '<tr class="empty-row"><td colspan="6">No payroll runs yet.</td></tr>';
  }
}

function resetCompanyForm() {
  editingCompanyId = null;
  const companyNoInput = $('erp-company-no');
  if (companyNoInput) companyNoInput.value = '';
  const nameInput = $('erp-company-name');
  const addressInput = $('erp-company-address');
  if (nameInput) nameInput.value = '';
  if (addressInput) addressInput.value = '';
  const submitBtn = document.querySelector('#company-form .btn-save');
  if (submitBtn) submitBtn.textContent = 'Add to Registry';
}

function fillCompanyForm(company) {
  if (!company) return;
  editingCompanyId = Number(company.id) || null;
  const companyNoInput = $('erp-company-no');
  const nameInput = $('erp-company-name');
  const addressInput = $('erp-company-address');
  const submitBtn = document.querySelector('#company-form .btn-save');
  if (companyNoInput) companyNoInput.value = company.company_no || '';
  if (nameInput) nameInput.value = company.company_name || '';
  if (addressInput) addressInput.value = company.address || '';
  if (submitBtn) submitBtn.textContent = 'Update Company';
}

async function editCompany(id) {
  const company = (erpState.companies || []).find((row) => Number(row.id) === Number(id));
  if (!company) {
    setStatus('Company not found.', 'error');
    return;
  }
  fillCompanyForm(company);
  setStatus(`Editing ${company.company_name}.`, 'success');
}

async function archiveCompany(id) {
  try {
    await fetchJson(`/api/company-registry/${id}/archive`, { method: 'PUT' });
    setStatus('Company archived.', 'success');
    resetCompanyForm();
    await loadAllData();
  } catch (err) {
    setStatus(err.message || 'Unable to archive company.', 'error');
  }
}

async function restoreCompany(id) {
  try {
    await fetchJson(`/api/company-registry/${id}/restore`, { method: 'PUT' });
    setStatus('Company restored.', 'success');
    await loadAllData();
  } catch (err) {
    setStatus(err.message || 'Unable to restore company.', 'error');
  }
}

async function loadAllData() {
  const [summary, companies, accounts, journalEntries, requisitions, purchaseOrders, bills, vendors, departments, employees, payrollPeriods, payrollRuns] = await Promise.all([
    fetchJson('/api/erp/summary'),
    fetchJson('/api/company-registry?include_archived=1'),
    fetchJson('/api/accounting/accounts'),
    fetchJson('/api/accounting/journal-entries'),
    fetchJson('/api/procurement/requisitions'),
    fetchJson('/api/procurement/purchase-orders'),
    fetchJson('/api/bills'),
    fetchJson('/api/hr/departments'),
    fetchJson('/api/hr/employees'),
    fetchJson('/api/hr/payroll-periods'),
    fetchJson('/api/hr/payroll-runs')
  ]);

  erpState.summary = summary;
  erpState.companies = Array.isArray(companies) ? companies : [];
  erpState.accounts = Array.isArray(accounts) ? accounts : [];
  erpState.journalEntries = Array.isArray(journalEntries) ? journalEntries : [];
  erpState.requisitions = Array.isArray(requisitions) ? requisitions : [];
  erpState.purchaseOrders = Array.isArray(purchaseOrders) ? purchaseOrders : [];
  erpState.bills = Array.isArray(bills) ? bills : [];
  erpState.departments = Array.isArray(departments) ? departments : [];
  erpState.employees = Array.isArray(employees) ? employees : [];
  erpState.payrollPeriods = Array.isArray(payrollPeriods) ? payrollPeriods : [];
  erpState.payrollRuns = Array.isArray(payrollRuns) ? payrollRuns : [];

  renderSummary();
  renderCompanies();
  renderAccounting();
  renderProcurement();
  renderHr();
}

function bindForms() {
  $('account-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await postJson('/api/accounting/accounts', {
        account_code: $('erp-account-code').value.trim(),
        account_name: $('erp-account-name').value.trim(),
        account_type: $('erp-account-type').value,
        parent_account_id: $('erp-parent-account-id').value || null
      });
      $('erp-account-code').value = '';
      $('erp-account-name').value = '';
      setStatus('Account saved successfully.', 'success');
      await loadAllData();
    } catch (err) {
      setStatus(err.message || 'Unable to save account.', 'error');
    }
  });

  $('journal-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await postJson('/api/accounting/journal-entries', {
        entry_number: $('erp-journal-number').value.trim(),
        entry_date: $('erp-journal-date').value,
        memo: $('erp-journal-memo').value.trim(),
        reference_type: $('erp-journal-ref-type').value.trim(),
        reference_id: $('erp-journal-ref-id').value.trim(),
        debit_account_id: $('erp-journal-debit').value,
        credit_account_id: $('erp-journal-credit').value,
        amount: $('erp-journal-amount').value
      });
      $('erp-journal-number').value = '';
      $('erp-journal-memo').value = '';
      $('erp-journal-ref-type').value = '';
      $('erp-journal-ref-id').value = '';
      $('erp-journal-amount').value = '0';
      setStatus('Journal entry posted.', 'success');
      await loadAllData();
    } catch (err) {
      setStatus(err.message || 'Unable to post journal.', 'error');
    }
  });

  $('vendor-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await postJson('/api/vendors', {
        vendor_name: $('erp-vendor-name').value.trim(),
        contact_person: $('erp-vendor-contact').value.trim(),
        email: $('erp-vendor-email').value.trim(),
        phone: $('erp-vendor-phone').value.trim(),
        address: $('erp-vendor-address').value.trim(),
        tin: $('erp-vendor-tin').value.trim()
      });
      $('erp-vendor-name').value = '';
      $('erp-vendor-contact').value = '';
      $('erp-vendor-email').value = '';
      $('erp-vendor-phone').value = '';
      $('erp-vendor-address').value = '';
      $('erp-vendor-tin').value = '';
      setStatus('Vendor saved.', 'success');
      await loadAllData();
    } catch (err) {
      setStatus(err.message || 'Unable to save vendor.', 'error');
    }
  });

  $('company-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const payload = {
        company_name: $('erp-company-name').value.trim(),
        address: $('erp-company-address').value.trim()
      };
      if (editingCompanyId) {
        await fetchJson(`/api/company-registry/${editingCompanyId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, status: 'active' })
        });
        setStatus('Company updated.', 'success');
      } else {
        await postJson('/api/company-registry', payload);
        setStatus('Company registered.', 'success');
      }
      resetCompanyForm();
      await loadAllData();
    } catch (err) {
      setStatus(err.message || 'Unable to save company.', 'error');
    }
  });

  $('pr-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await postJson('/api/procurement/requisitions', {
        pr_number: $('erp-pr-number').value.trim(),
        request_date: $('erp-pr-date').value,
        department: $('erp-pr-department').value.trim(),
        requested_by: $('erp-pr-requested-by').value.trim(),
        needed_by: $('erp-pr-needed-by').value,
        item_name: $('erp-pr-item-name').value.trim(),
        item_description: $('erp-pr-notes').value.trim(),
        quantity: $('erp-pr-item-qty').value,
        unit: $('erp-pr-item-unit').value.trim(),
        estimated_unit_price: $('erp-pr-item-price').value,
        notes: $('erp-pr-notes').value.trim()
      });
      $('erp-pr-number').value = '';
      $('erp-pr-department').value = '';
      $('erp-pr-requested-by').value = '';
      $('erp-pr-item-name').value = '';
      $('erp-pr-item-qty').value = '1';
      $('erp-pr-item-unit').value = '';
      $('erp-pr-item-price').value = '0';
      $('erp-pr-notes').value = '';
      setStatus('Purchase requisition saved.', 'success');
      await loadAllData();
    } catch (err) {
      setStatus(err.message || 'Unable to save requisition.', 'error');
    }
  });

  $('po-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await postJson('/api/procurement/purchase-orders', {
        po_number: $('erp-po-number').value.trim(),
        vendor_id: $('erp-po-vendor').value,
        po_date: $('erp-po-date').value,
        delivery_date: $('erp-po-delivery').value,
        item_name: $('erp-po-item-name').value.trim(),
        item_description: '',
        quantity: $('erp-po-item-qty').value,
        unit_price: $('erp-po-item-price').value,
        notes: $('erp-po-notes').value.trim()
      });
      $('erp-po-number').value = '';
      $('erp-po-item-name').value = '';
      $('erp-po-item-qty').value = '1';
      $('erp-po-item-price').value = '0';
      $('erp-po-notes').value = '';
      setStatus('Purchase order saved.', 'success');
      await loadAllData();
    } catch (err) {
      setStatus(err.message || 'Unable to save purchase order.', 'error');
    }
  });

  $('bill-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await postJson('/api/bills', {
        vendor_id: $('erp-bill-vendor').value,
        bill_number: $('erp-bill-number').value.trim(),
        bill_date: $('erp-bill-date').value,
        due_date: $('erp-bill-due-date').value,
        total_amount: $('erp-bill-amount').value,
        notes: $('erp-bill-notes').value.trim()
      });
      $('erp-bill-number').value = '';
      $('erp-bill-amount').value = '0';
      $('erp-bill-notes').value = '';
      setStatus('Bill saved.', 'success');
      await loadAllData();
    } catch (err) {
      setStatus(err.message || 'Unable to save bill.', 'error');
    }
  });

  $('department-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await postJson('/api/hr/departments', {
        department_name: $('erp-dept-name').value.trim(),
        description: $('erp-dept-desc').value.trim()
      });
      $('erp-dept-name').value = '';
      $('erp-dept-desc').value = '';
      setStatus('Department saved.', 'success');
      await loadAllData();
    } catch (err) {
      setStatus(err.message || 'Unable to save department.', 'error');
    }
  });

  $('employee-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await postJson('/api/hr/employees', {
        employee_code: $('erp-employee-code').value.trim(),
        full_name: $('erp-employee-name').value.trim(),
        department_id: $('erp-employee-dept').value || null,
        job_title: $('erp-employee-title').value.trim(),
        employment_type: $('erp-employee-type').value,
        pay_frequency: $('erp-employee-payfreq').value,
        salary_rate: $('erp-employee-salary').value,
        email: $('erp-employee-email').value.trim(),
        phone: $('erp-employee-phone').value.trim(),
        hire_date: $('erp-employee-hiredate').value
      });
      $('erp-employee-code').value = '';
      $('erp-employee-name').value = '';
      $('erp-employee-title').value = '';
      $('erp-employee-salary').value = '0';
      $('erp-employee-email').value = '';
      $('erp-employee-phone').value = '';
      setStatus('Employee saved.', 'success');
      await loadAllData();
    } catch (err) {
      setStatus(err.message || 'Unable to save employee.', 'error');
    }
  });

  $('period-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await postJson('/api/hr/payroll-periods', {
        period_name: $('erp-period-name').value.trim(),
        start_date: $('erp-period-start').value,
        end_date: $('erp-period-end').value,
        pay_date: $('erp-period-paydate').value
      });
      $('erp-period-name').value = '';
      setStatus('Payroll period saved.', 'success');
      await loadAllData();
    } catch (err) {
      setStatus(err.message || 'Unable to save payroll period.', 'error');
    }
  });

  $('payroll-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await postJson('/api/hr/payroll-runs', {
        period_id: $('erp-payroll-period').value,
        employee_id: $('erp-payroll-employee').value,
        gross_pay: $('erp-payroll-gross').value,
        deductions: $('erp-payroll-deductions').value,
        notes: $('erp-payroll-notes').value.trim()
      });
      $('erp-payroll-gross').value = '0';
      $('erp-payroll-deductions').value = '0';
      $('erp-payroll-notes').value = '';
      setStatus('Payroll run saved.', 'success');
      await loadAllData();
    } catch (err) {
      setStatus(err.message || 'Unable to save payroll run.', 'error');
    }
  });
}

function doLogout() {
  fetch('/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': window.__CSRF_TOKEN__ || ''
    }
  }).finally(() => {
    window.location.href = '/';
  });
}

async function bootstrapErp() {
  try {
    const me = await fetchJson('/api/me');
    window.__CSRF_TOKEN__ = me.csrfToken || window.__CSRF_TOKEN__ || '';
    setTodayDefaults();
    bindForms();
    await loadAllData();
    setStatus('ERP modules ready.', 'success');
  } catch (err) {
    setStatus(err.message || 'Unable to load ERP modules.', 'error');
  }
}
