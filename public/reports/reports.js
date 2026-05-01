document.addEventListener('DOMContentLoaded', function() {
  if (typeof loadNotifications === 'function') loadNotifications();
  
  loadReportsData();
  setTimeout(() => {
    syncReportsCompanyFilterOptions();
  }, 100);
});

// Reports page now reuses the shared ERP core functions.
async function loadReportsData() {
  try {
    await Promise.all([
      fetch('/api/transactions').then(r => r.json()).then(data => {
        window.reportsTransactionsDb = Array.isArray(data) ? data : [];
      }),
      fetch('/api/receivables').then(r => r.json()).then(data => {
        window.reportsReceivablesDb = Array.isArray(data) ? data : [];
      }),
      fetch('/api/company-registry').then(r => r.json()).then(data => {
        window.reportsCompanyRegistryDb = Array.isArray(data) ? data : [];
      })
    ]);
    
    renderReportsAnalytics();
    syncReportsCompanyFilterOptions();
  } catch (err) {
    console.error('Reports load error:', err);
    document.querySelectorAll('[id*="reports-"]').forEach(el => {
      el.textContent = 'No data';
    });
  }
}

let reportsCurrentCompany = 'all';
let reportsBarRange = 6;
let reportsInvoiceStatusView = 'paid';

function syncReportsCompanyFilterOptions() {
  const selectIds = ['reports-company-filter'];
  const options = collectDashboardCompanies(); // Reuse shared core function
  const nextCurrent = reportsCurrentCompany || 'all';

  selectIds.forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    
    select.innerHTML = '<option value="all">All Companies</option>' +
      options.map(opt => `<option value="${escHtml(opt.value)}">${escHtml(opt.label)}</option>`).join('');
    select.value = nextCurrent;
  });
}

function setReportsCompanyFilter(value) {
  reportsCurrentCompany = normalizeDashboardCompanyName(value) || 'all';
  renderReportsAnalytics();
}

function renderReportsAnalytics() {
  const records = window.reportsTransactionsDb || [];
  renderReportsBarChart(getDashboardInvoiceRows(records), reportsBarRange);
  renderReportsPieChart(getDashboardInvoiceRows(records));
  renderReportsInvoiceStatusQuickView(getDashboardInvoiceRows(records));
  renderReportsInsights(getDashboardInvoiceRows(records));
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

function setReportsBarRange(months) {
  reportsBarRange = months;
  document.querySelectorAll('.dashboard-range-btn').forEach(btn => {
    btn.classList.toggle('is-active', Number(btn.dataset.range) === months);
  });
  renderReportsAnalytics();
}

function setReportsInvoiceStatusView(status) {
  reportsInvoiceStatusView = status;
  renderReportsInvoiceStatusQuickView(getDashboardInvoiceRows(window.reportsTransactionsDb || []));
}

function goBackToDashboard() {
  window.location.href = '/admin?view=dashboard';
}

function doLogout() {
  fetch('/logout', { method: 'POST' }).then(() => window.location.href = '/');
}



