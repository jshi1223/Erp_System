document.addEventListener('DOMContentLoaded', function() {
  if (typeof loadNotifications === 'function') loadNotifications();
  syncReportsSidebarActive();
  
  loadReportsData();
});

function syncReportsSidebarActive() {
  document.querySelectorAll('.sidebar-link').forEach((link) => {
    link.classList.toggle('active', link.getAttribute('href') === '/reports' || link.id === 'menu-reports');
  });
}

// Reports page now reuses the shared ERP core functions.
async function loadReportsData() {
  try {
    const businessEntityId = String(localStorage.getItem('kinaadman_businessEntityContext') || '').trim();
    const matchesBusinessEntity = (row) => {
      if (!businessEntityId) return true;
      const rowId = String(row?.business_entity_id || '').trim();
      return rowId === businessEntityId;
    };
    const loadReportRows = async (url, label) => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        const data = await response.json().catch(() => []);
        if (!response.ok) throw new Error(data.error || `Unable to load ${label}.`);
        return Array.isArray(data) ? data : [];
      } catch (err) {
        console.error(`Reports ${label} load error:`, err);
        return [];
      }
    };

    const [projects, receivables, bills, apPayments, purchaseOrders, vendors, companies] = await Promise.all([
      loadReportRows('/api/projects', 'projects'),
      loadReportRows('/api/receivables', 'receivables'),
      loadReportRows('/api/bills', 'bills'),
      loadReportRows('/api/payments?type=ap', 'AP payments'),
      loadReportRows('/api/procurement/purchase-orders', 'purchase orders'),
      loadReportRows('/api/vendors?include_inactive=1', 'vendors'),
      loadReportRows('/api/company-registry?include_archived=1', 'companies')
    ]);

    window.reportsCompaniesDb = companies.filter(matchesBusinessEntity);
    window.reportsProjectsDb = projects.filter(matchesBusinessEntity);
    window.reportsTransactionsDb = []; // Transactions feature retired; AR invoices now come from Sales.
    window.reportsReceivablesDb = receivables.filter(matchesBusinessEntity);
    window.reportsBillsDb = bills.filter(matchesBusinessEntity);
    window.reportsApPaymentsDb = apPayments.filter(matchesBusinessEntity);
    window.reportsPurchaseOrdersDb = purchaseOrders.filter(matchesBusinessEntity);
    window.reportsVendorsDb = vendors.filter(matchesBusinessEntity);

    projectsDashboardDb = Array.isArray(window.reportsProjectsDb) ? window.reportsProjectsDb : [];
    allTransactionsDb = Array.isArray(window.reportsTransactionsDb) ? window.reportsTransactionsDb : [];
    allReceivablesDb = Array.isArray(window.reportsReceivablesDb) ? window.reportsReceivablesDb : [];
    companyRegistryDb = Array.isArray(window.reportsCompaniesDb) ? window.reportsCompaniesDb : [];

    renderReportsAnalytics();
  } catch (err) {
    console.error('Reports load error:', err);
    document.querySelectorAll('[id*="reports-"]').forEach(el => {
      el.textContent = 'No data';
    });
  }
}

let reportsBarRange = 6;
let reportsInvoiceStatusView = 'paid';
let reportsCompanyQuery = '';

function getReportsCompanyById(companyId) {
  const id = Number(companyId || 0) || 0;
  if (!id) return null;
  return (Array.isArray(window.reportsCompaniesDb) ? window.reportsCompaniesDb : [])
    .find((company) => Number(company.id || 0) === id) || null;
}

function setReportsCompanyQuery(value) {
  reportsCompanyQuery = String(value || '').trim().toLowerCase();
  const input = document.getElementById('reports-company-search-input');
  if (input && String(input.value || '').trim() !== String(value || '').trim()) {
    input.value = String(value || '');
  }
  renderReportsAnalytics();
  renderReportsCompanySuggestions();
}

function clearReportsCompanyQuery() {
  reportsCompanyQuery = '';
  const input = document.getElementById('reports-company-search-input');
  if (input) input.value = '';
  renderReportsAnalytics();
  clearReportsCompanySuggestions();
  if (input && typeof input.focus === 'function') {
    input.focus();
  }
}

function getReportsCompanySearchText(row) {
  const parts = [
    getDashboardCompanyNameForRecord(row),
    getTransactionCompanyName(row),
    getReceivableCompanyName(row),
    row?.company_name,
    row?.customer_name,
    row?.customer,
    row?.client_name,
    row?.client,
    row?.source_client,
    row?.bill_to,
    row?.vendor,
    row?.vendor_name,
    row?.charged_to,
    row?.party_name,
    row?.company,
    row?.company_label,
    row?.company_no,
    row?.registry_company_no,
    row?.registry_company_name,
    row?.branch_code,
    row?.project_docno,
    row?.project_name
  ];

  const company = getReportsCompanyById(row?.company_id);
  if (company) {
    parts.push(company.company_no, company.company_name, company.registry_company_no, company.registry_company_name);
  }

  const projectId = Number(row?.project_id || 0) || 0;
  if (projectId && Array.isArray(projectsDashboardDb)) {
    const linkedProject = projectsDashboardDb.find(project => Number(project.id || 0) === projectId);
    if (linkedProject) {
      parts.push(
        getProjectCompanyName(linkedProject),
        linkedProject.company_no,
        linkedProject.registry_company_no,
        linkedProject.registry_company_name
      );
    }
  }

  return parts
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function getReportsInvoiceRows() {
  const rows = getInvoiceRows(Array.isArray(allTransactionsDb) ? allTransactionsDb : []);
  if (!reportsCompanyQuery) return rows;

  return rows.filter((row) => {
    const searchText = getReportsCompanySearchText(row);
    return searchText.includes(reportsCompanyQuery);
  });
}

function getReportsCompanySuggestions() {
  const query = String(reportsCompanyQuery || '').trim().toLowerCase();
  if (!query) return [];

  const companies = new Map();
  const sourceRows = [
    ...(Array.isArray(window.reportsCompaniesDb) ? window.reportsCompaniesDb : []),
    ...(Array.isArray(window.reportsProjectsDb) ? window.reportsProjectsDb : []),
    ...(Array.isArray(window.reportsTransactionsDb) ? window.reportsTransactionsDb : []),
    ...(Array.isArray(window.reportsReceivablesDb) ? window.reportsReceivablesDb : []),
    ...(Array.isArray(window.reportsBillsDb) ? window.reportsBillsDb : []),
    ...(Array.isArray(window.reportsPurchaseOrdersDb) ? window.reportsPurchaseOrdersDb : [])
  ];

  sourceRows.forEach((row) => {
    const company = getReportsCompanyById(row?.company_id);
    const label = String(
      getDashboardCompanyNameForRecord(row)
      || getTransactionCompanyName(row)
      || getReceivableCompanyName(row)
      || row?.company_name
      || row?.registry_company_name
      || company?.company_name
      || row?.client_name
      || row?.client
      || row?.customer_name
      || ''
    ).trim();
    if (!label) return;
    const companyNo = String(row?.company_no || row?.registry_company_no || company?.company_no || '').trim();
    const key = `${label}|${companyNo}`.toLowerCase();
    if (!companies.has(key)) {
      companies.set(key, {
        value: label,
        label,
        meta: companyNo ? `Company No. ${companyNo}` : 'Company'
      });
    }
  });

  return Array.from(companies.values())
    .filter((option) => {
      const value = String(option.value || '').toLowerCase();
      const label = String(option.label || '').toLowerCase();
      const meta = String(option.meta || '').toLowerCase();
      return value.includes(query) || label.includes(query) || meta.includes(query);
    })
    .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')))
    .slice(0, 8);
}

function renderReportsCompanySuggestions() {
  const host = document.getElementById('reports-company-results');
  if (!host) return;
  const query = String(reportsCompanyQuery || '').trim();
  if (!query) {
    clearReportsCompanySuggestions();
    return;
  }

  const suggestions = getReportsCompanySuggestions();
  host.classList.add('is-visible');
  host.innerHTML = `
    <div class="reports-company-results-head">
      <span>Company Filter</span>
      <button class="reports-company-results-clear" type="button" onclick="clearReportsCompanyQuery()">Clear</button>
    </div>
    <div class="reports-company-results-list">
      ${suggestions.length ? suggestions.map((option) => `
        <button class="reports-company-result-item" type="button" data-company-filter="${escHtml(option.value)}">
          <span class="reports-company-result-name">${escHtml(option.label)}</span>
          <span class="reports-company-result-sub">${escHtml(option.meta || 'Company')}</span>
        </button>
      `).join('') : '<div class="reports-company-result-empty">No matching company. Reports are still filtered by your typed search.</div>'}
    </div>
  `;
}

function selectReportsCompanyFilter(value) {
  reportsCompanyQuery = String(value || '').trim().toLowerCase();
  const input = document.getElementById('reports-company-search-input');
  if (input) input.value = String(value || '').trim();
  renderReportsAnalytics();
  clearReportsCompanySuggestions();
}

function clearReportsCompanySuggestions() {
  const host = document.getElementById('reports-company-results');
  if (!host) return;
  host.classList.remove('is-visible');
  host.innerHTML = '';
}

function renderReportsAnalytics() {
  const invoiceRows = getReportsInvoiceRows();
  renderReportsBarChart(invoiceRows, reportsBarRange);
  renderReportsPieChart(invoiceRows);
  renderReportsInvoiceStatusQuickView(invoiceRows);
  renderReportsInsights(invoiceRows);
  renderReportsFinancialTables(invoiceRows);
}

function renderReportsBarChart(records, months) {
  renderDashboardBarChart(records, months); // Reuse shared core dashboard function
}

function renderReportsPieChart(records) {
  renderDashboardPieChart(records); // Reuse shared core dashboard function
}

function renderReportsInvoiceStatusQuickView(records) {
  renderInvoiceStatusQuickView(records); // Reuse shared core function
}

function renderReportsInsights(records) {
  // Reuse dashboard insights logic via renderDashboardBarChart side effects
}

function reportsMoney(value) {
  if (typeof formatPhpCurrency === 'function') return formatPhpCurrency(value);
  return `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

function reportsSetText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function getReportsFilteredRows(rows = []) {
  const query = String(reportsCompanyQuery || '').trim().toLowerCase();
  if (!query) return rows;
  return rows.filter((row) => getReportsCompanySearchText(row).includes(query));
}

function renderReportsFinancialTables(invoiceRows = []) {
  const projects = getReportsFilteredRows(Array.isArray(window.reportsProjectsDb) ? window.reportsProjectsDb : []);
  const bills = getReportsFilteredRows(Array.isArray(window.reportsBillsDb) ? window.reportsBillsDb : []);
  const vendors = Array.isArray(window.reportsVendorsDb) ? window.reportsVendorsDb : [];

  const invoicesByProject = new Map();
  invoiceRows.forEach((row) => {
    const projectId = Number(row.project_id || 0) || 0;
    if (!projectId) return;
    const current = invoicesByProject.get(projectId) || { total: 0, paid: 0 };
    const amount = Number(row.amount ?? row.total_amount ?? 0) || 0;
    const paid = Number(row.downpayment ?? row.paid_amount ?? 0) || 0;
    current.total += amount;
    current.paid += paid;
    invoicesByProject.set(projectId, current);
  });

  const billsByProject = new Map();
  const vendorSpend = new Map();
  bills.forEach((bill) => {
    const projectId = Number(bill.project_id || 0) || 0;
    const amount = Number(bill.total_amount || 0) || 0;
    if (projectId) billsByProject.set(projectId, (billsByProject.get(projectId) || 0) + amount);
    const vendorName = String(bill.vendor_name || vendors.find(vendor => Number(vendor.id || 0) === Number(bill.vendor_id || 0))?.vendor_name || 'Unassigned vendor').trim();
    const current = vendorSpend.get(vendorName) || { count: 0, total: 0 };
    current.count += 1;
    current.total += amount;
    vendorSpend.set(vendorName, current);
  });

  const profitabilityRows = projects.map((project) => {
    const projectId = Number(project.id || 0) || 0;
    const ar = invoicesByProject.get(projectId)?.total || 0;
    const contract = Number(project.budget || 0) || 0;
    const revenue = ar || contract;
    const ap = billsByProject.get(projectId) || 0;
    const profit = revenue - ap;
    const margin = revenue > 0 ? Math.round((profit / revenue) * 100) : 0;
    return { project, contract, ar, ap, profit, margin };
  }).sort((a, b) => b.profit - a.profit).slice(0, 12);

  const profitabilityBody = document.getElementById('reports-project-profitability-body');
  if (profitabilityBody) {
    profitabilityBody.innerHTML = profitabilityRows.length ? profitabilityRows.map((row) => `
      <tr>
        <td>${escHtml([row.project.project_docno, row.project.project_name].filter(Boolean).join(' - ') || 'Untitled Project')}</td>
        <td class="text-right">${reportsMoney(row.contract)}</td>
        <td class="text-right">${reportsMoney(row.ar)}</td>
        <td class="text-right">${reportsMoney(row.ap)}</td>
        <td class="text-right">${reportsMoney(row.profit)}</td>
        <td class="text-right">${row.margin}%</td>
      </tr>
    `).join('') : '<tr class="empty-row"><td colspan="6">No project profitability data yet.</td></tr>';
  }

  const openAr = invoiceRows.reduce((sum, row) => {
    const amount = Number(row.amount ?? row.total_amount ?? 0) || 0;
    const paid = Number(row.downpayment ?? row.paid_amount ?? 0) || 0;
    return sum + Math.max(0, amount - paid);
  }, 0);
  const openAp = bills.reduce((sum, bill) => {
    const total = Number(bill.total_amount || 0) || 0;
    const paid = Number(bill.paid_amount || 0) || 0;
    return sum + Math.max(0, total - paid);
  }, 0);
  reportsSetText('reports-open-ar', reportsMoney(openAr));
  reportsSetText('reports-open-ap', reportsMoney(openAp));
  reportsSetText('reports-net-cash', reportsMoney(openAr - openAp));

  const vendorBody = document.getElementById('reports-vendor-spend-body');
  if (vendorBody) {
    const rows = Array.from(vendorSpend.entries()).sort((a, b) => b[1].total - a[1].total).slice(0, 10);
    vendorBody.innerHTML = rows.length ? rows.map(([vendor, data]) => `
      <tr>
        <td>${escHtml(vendor)}</td>
        <td class="text-right">${data.count}</td>
        <td class="text-right">${reportsMoney(data.total)}</td>
      </tr>
    `).join('') : '<tr class="empty-row"><td colspan="3">No vendor spend yet.</td></tr>';
  }

  const clientRevenue = new Map();
  invoiceRows.forEach((row) => {
    const client = String(getDashboardCompanyNameForRecord(row) || getTransactionCompanyName(row) || getReceivableCompanyName(row) || row.client_name || row.customer_name || 'Unassigned client').trim();
    const key = client || 'Unassigned client';
    const current = clientRevenue.get(key) || { count: 0, total: 0 };
    current.count += 1;
    current.total += Number(row.amount ?? row.total_amount ?? 0) || 0;
    clientRevenue.set(key, current);
  });
  const clientBody = document.getElementById('reports-client-revenue-body');
  if (clientBody) {
    const rows = Array.from(clientRevenue.entries()).sort((a, b) => b[1].total - a[1].total).slice(0, 10);
    clientBody.innerHTML = rows.length ? rows.map(([client, data]) => `
      <tr>
        <td>${escHtml(client)}</td>
        <td class="text-right">${data.count}</td>
        <td class="text-right">${reportsMoney(data.total)}</td>
      </tr>
    `).join('') : '<tr class="empty-row"><td colspan="3">No client revenue yet.</td></tr>';
  }
}

function setReportsBarRange(months) {
  reportsBarRange = months;
  document.querySelectorAll('.dashboard-range-btn').forEach(btn => {
    btn.classList.toggle('is-active', Number(btn.dataset.range) === months);
  });
  renderReportsAnalytics();
}

function setReportsInvoiceStatusView(status) {
  reportsInvoiceStatusView = status;
  invoiceStatusView = status;
  renderReportsInvoiceStatusQuickView(getReportsInvoiceRows());
}

function goBackToDashboard() {
  window.location.href = '/admin?view=dashboard';
}

async function doLogout() {
  const confirmed = (typeof showConfirm === 'function')
    ? await showConfirm('Maglo-logout ka na. Gusto mo bang ituloy?', { title: 'Logout?', confirmLabel: 'Yes, log out', cancelLabel: 'Cancel', type: 'danger' })
    : window.confirm('Maglo-logout ka na. Gusto mo bang ituloy?');
  if (!confirmed) return;
  fetch('/logout', { method: 'POST' }).then(() => window.location.href = '/');
}

document.addEventListener('DOMContentLoaded', function() {
  const input = document.getElementById('reports-company-search-input');
  if (input && input.dataset.reportsCompanyBound !== '1') {
    input.dataset.reportsCompanyBound = '1';
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        clearReportsCompanyQuery();
      }
    });
    input.addEventListener('focus', () => {
      renderReportsCompanySuggestions();
    });
  }
  document.addEventListener('click', (event) => {
    const shell = event.target?.closest?.('.reports-company-search-shell');
    if (!shell) clearReportsCompanySuggestions();
  });
  const results = document.getElementById('reports-company-results');
  if (results && results.dataset.reportsCompanyBound !== '1') {
    results.dataset.reportsCompanyBound = '1';
    results.addEventListener('pointerdown', (event) => {
      const option = event.target?.closest?.('[data-company-filter]');
      if (!option) return;
      event.preventDefault();
      selectReportsCompanyFilter(option.getAttribute('data-company-filter') || '');
    });
    results.addEventListener('click', (event) => {
      const option = event.target?.closest?.('[data-company-filter]');
      if (!option) return;
      event.preventDefault();
      selectReportsCompanyFilter(option.getAttribute('data-company-filter') || '');
    });
  }
  clearReportsCompanySuggestions();
});



