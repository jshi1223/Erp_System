'use strict';

const state = {
  companies: [],
  companyOverview: null
};

let editingCompanyId = null;

document.addEventListener('DOMContentLoaded', bootstrapCompanyRegistry);

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

async function fetchJson(url, options = {}) {
  const { headers: customHeaders, ...fetchOptions } = options;
  const headers = new Headers(customHeaders || {});
  const method = String(fetchOptions.method || 'GET').toUpperCase();

  if (method !== 'GET') {
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

function getCompanyFieldMessageNode(fieldName) {
  return document.querySelector(`[data-company-field-message="${fieldName}"]`);
}

function clearCompanyFieldMessages() {
  document.querySelectorAll('[data-company-field-message]').forEach((node) => {
    node.textContent = '';
    node.classList.add('is-hidden');
  });
  document.querySelectorAll('.modal-company .field.has-error').forEach((field) => {
    field.classList.remove('has-error');
  });
}

function setCompanyFieldMessage(fieldName, message) {
  const node = getCompanyFieldMessageNode(fieldName);
  if (!node) return;
  const text = String(message || '').trim();
  const field = node.closest('.field');
  node.textContent = text;
  node.classList.toggle('is-hidden', !text);
  if (field) {
    field.classList.toggle('has-error', Boolean(text));
  }
}

function setCompanyOverviewValue(nodeId, value) {
  const node = $(nodeId);
  if (!node) return;
  node.textContent = String(Number(value || 0));
}

function getProjectPeriodLabel(project) {
  const start = project?.actual_start_date || project?.planned_start_date || project?.start_date || '';
  const end = project?.actual_end_date || project?.planned_end_date || project?.end_date || '';
  if (start && end) return `${start} to ${end}`;
  if (start) return `Starts ${start}`;
  if (end) return `Ends ${end}`;
  return 'No schedule set';
}

function getServiceOrderPeriodLabel(serviceOrder) {
  const date = serviceOrder?.service_date || '';
  return date ? `Date ${date}` : 'No service date set';
}

function renderCompanyOverview(overview = null) {
  state.companyOverview = overview || null;
  const counts = overview?.counts || {};
  const company = overview?.company || null;

  setCompanyOverviewValue('company-relations-project-count', counts.project_count);
  setCompanyOverviewValue('company-relations-so-count', counts.service_order_count);
  setCompanyOverviewValue('company-relations-transaction-count', counts.transaction_count);
  setCompanyOverviewValue('company-relations-po-count', counts.purchase_order_count);
  setCompanyOverviewValue('company-relations-vendor-count', counts.vendor_count);
  setCompanyOverviewValue('company-relations-ar-count', counts.receivable_count);

  const statusNode = $('company-relations-state');
  if (statusNode) {
    if (!company) {
      statusNode.textContent = 'Save a company to view linked records.';
    } else {
      const label = String(company.company_name || company.company_no || 'Company').trim();
      const activeProjects = Number(counts.active_project_count || 0);
      const completedProjects = Number(counts.completed_project_count || 0);
      statusNode.textContent = `${label} overview loaded | ${activeProjects} active projects, ${completedProjects} completed`;
    }
  }

  const projectHost = $('company-relations-projects');
  if (projectHost) {
    const projects = Array.isArray(overview?.recent_projects) ? overview.recent_projects : [];
    projectHost.innerHTML = projects.length
      ? projects.map((project) => {
        const projectLabel = [project.project_docno, project.project_name].filter(Boolean).join(' - ') || 'Untitled Project';
        const meta = [project.status || 'planning', getProjectPeriodLabel(project)].filter(Boolean).join(' | ');
        return `
          <div class="company-relations-item">
            <div class="company-relations-item-main">
              <div class="company-relations-item-title">${escHtml(projectLabel)}</div>
              <div class="company-relations-item-meta">${escHtml(meta)}</div>
            </div>
            <span class="company-relations-item-status">${escHtml(String(project.status || 'planning'))}</span>
          </div>
        `;
      }).join('')
      : '<div class="company-relations-empty">No related projects yet.</div>';
  }

  const serviceOrderHost = $('company-relations-service-orders');
  if (serviceOrderHost) {
    const serviceOrders = Array.isArray(overview?.recent_service_orders) ? overview.recent_service_orders : [];
    serviceOrderHost.innerHTML = serviceOrders.length
      ? serviceOrders.map((serviceOrder) => {
        const soLabel = [serviceOrder.so_number, serviceOrder.service_title].filter(Boolean).join(' - ') || 'Untitled Service Order';
        const projectLabel = [serviceOrder.project_docno, serviceOrder.project_name].filter(Boolean).join(' - ') || 'No linked project';
        const meta = [projectLabel, getServiceOrderPeriodLabel(serviceOrder)].filter(Boolean).join(' | ');
        return `
          <div class="company-relations-item">
            <div class="company-relations-item-main">
              <div class="company-relations-item-title">${escHtml(soLabel)}</div>
              <div class="company-relations-item-meta">${escHtml(meta)}</div>
            </div>
            <span class="company-relations-item-status">${escHtml(String(serviceOrder.status || 'draft'))}</span>
          </div>
        `;
      }).join('')
      : '<div class="company-relations-empty">No related service orders yet.</div>';
  }
}

async function loadCompanyOverview(companyId) {
  const id = Number(companyId || 0);
  if (!id) {
    renderCompanyOverview(null);
    return;
  }

  try {
    const overview = await fetchJson(`/api/company-registry/${id}/overview`);
    if (Number(editingCompanyId || 0) !== id) return;
    renderCompanyOverview(overview);
  } catch (err) {
    if (Number(editingCompanyId || 0) !== id) return;
    renderCompanyOverview(null);
    setStatus(err.message || 'Unable to load company overview.', 'error');
  }
}

async function hydrateCsrfToken() {
  try {
    const response = await fetch('/api/me', { credentials: 'same-origin' });
    if (!response.ok) return;
    const data = await response.json().catch(() => ({}));
    if (data?.csrfToken) {
      window.__CSRF_TOKEN__ = data.csrfToken;
    }
  } catch (_) {}
}

function setStatus(message, type = '') {
  const node = $('erp-status');
  if (!node) return;
  node.classList.remove('is-success', 'is-error');
  if (type === 'success') node.classList.add('is-success');
  if (type === 'error') node.classList.add('is-error');
  node.textContent = message;
}

function updateRegistryMetrics() {
  const total = Array.isArray(state.companies) ? state.companies.length : 0;
  const archived = (Array.isArray(state.companies) ? state.companies : []).filter((company) => Number(company.archived || 0) === 1).length;
  const active = Math.max(0, total - archived);

  const totalNode = $('registry-total-companies');
  const activeNode = $('registry-active-companies');
  const archivedNode = $('registry-archived-companies');

  if (totalNode) totalNode.textContent = String(total);
  if (activeNode) activeNode.textContent = String(active);
  if (archivedNode) archivedNode.textContent = String(archived);
}

function openModal() {
  const modal = $('company-modal-backdrop');
  if (modal) {
    modal.classList.add('open');
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
  }
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  const modal = $('company-modal-backdrop');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = '';
    modal.setAttribute('aria-hidden', 'true');
  }
  document.body.style.overflow = '';
}

function closeCompanyModal() {
  closeModal();
  resetCompanyForm();
}

function resetCompanyForm() {
  editingCompanyId = null;
  clearCompanyFieldMessages();
  renderCompanyOverview(null);
  const companyNoInput = $('erp-company-no');
  const companyNameInput = $('erp-company-name');
  const addressInput = $('erp-company-address');
  const contactInput = $('erp-company-contact');
  const phoneInput = $('erp-company-phone');
  const emailInput = $('erp-company-email');
  const tinInput = $('erp-company-tin');
  const industryInput = $('erp-company-industry');
  const statusInput = $('erp-company-status');
  const notesInput = $('erp-company-notes');
  const title = $('company-modal-title');
  const saveBtn = $('company-save-btn');

  if (companyNoInput) companyNoInput.value = '';
  if (companyNameInput) companyNameInput.value = '';
  if (addressInput) addressInput.value = '';
  if (contactInput) contactInput.value = '';
  if (phoneInput) phoneInput.value = '';
  if (emailInput) emailInput.value = '';
  if (tinInput) tinInput.value = '';
  if (industryInput) industryInput.value = '';
  if (statusInput) statusInput.value = 'active';
  if (notesInput) notesInput.value = '';
  if (title) title.textContent = 'Register Company';
  if (saveBtn) saveBtn.textContent = 'Add to Registry';
}

async function openCompanyModal(companyId = null) {
  resetCompanyForm();

  if (companyId) {
    const company = state.companies.find((row) => Number(row.id) === Number(companyId));
    if (!company) {
      setStatus('Company not found.', 'error');
      return;
    }

    editingCompanyId = Number(company.id);
    const companyNoInput = $('erp-company-no');
    const companyNameInput = $('erp-company-name');
    const addressInput = $('erp-company-address');
    const contactInput = $('erp-company-contact');
    const phoneInput = $('erp-company-phone');
    const emailInput = $('erp-company-email');
    const tinInput = $('erp-company-tin');
    const industryInput = $('erp-company-industry');
    const statusInput = $('erp-company-status');
    const notesInput = $('erp-company-notes');
    const title = $('company-modal-title');
    const saveBtn = $('company-save-btn');

    if (companyNoInput) companyNoInput.value = company.company_no || '';
    if (companyNameInput) companyNameInput.value = company.company_name || '';
    if (addressInput) addressInput.value = company.address || '';
    if (contactInput) contactInput.value = company.contact_person || '';
    if (phoneInput) phoneInput.value = company.phone || '';
    if (emailInput) emailInput.value = company.email || '';
    if (tinInput) tinInput.value = company.tin || '';
    if (industryInput) industryInput.value = company.industry || '';
    if (statusInput) statusInput.value = company.status || 'active';
    if (notesInput) notesInput.value = company.notes || '';
    if (title) title.textContent = 'Edit Company';
    if (saveBtn) saveBtn.textContent = 'Update Company';
  } else {
    try {
      const data = await fetchJson('/api/company-registry/next-no');
      const companyNoInput = $('erp-company-no');
      if (companyNoInput) companyNoInput.value = data.company_no || '';
    } catch (_) {}
  }

  openModal();
  if (companyId) {
    void loadCompanyOverview(companyId);
  } else {
    renderCompanyOverview(null);
  }
}

function getSearchValue() {
  return String($('company-search-input')?.value || '').trim().toLowerCase();
}

function getStatusFilter() {
  const host = $('company-status-filter');
  if (!host) return 'active';
  return String(host.getAttribute('data-selected') || host.querySelector('.company-switch-chip.is-active')?.getAttribute('data-value') || 'active').trim().toLowerCase();
}

function setCompanyRegistryFilter(value = 'active') {
  const host = $('company-status-filter');
  const nextValue = ['active', 'archived', 'all'].includes(String(value).toLowerCase()) ? String(value).toLowerCase() : 'active';
  if (host) {
    host.setAttribute('data-selected', nextValue);
    host.querySelectorAll('.company-switch-chip').forEach((chip) => {
      const chipValue = String(chip.getAttribute('data-value') || '').toLowerCase();
      const isActive = chipValue === nextValue;
      chip.classList.toggle('is-active', isActive);
      chip.setAttribute('aria-pressed', String(isActive));
    });
  }
  renderCompanies();
}

function renderCompanies() {
  const rows = $('companies-body');
  if (!rows) return;

  const searchQuery = getSearchValue();
  const statusFilter = getStatusFilter();

  const filteredCompanies = state.companies.filter((company) => {
    const isArchived = Number(company.archived || 0) === 1;
    if (statusFilter === 'active' && isArchived) return false;
    if (statusFilter === 'archived' && !isArchived) return false;
    if (!searchQuery) return true;
    return [
      company.company_no || '',
      company.branch_code || '',
      company.company_name || '',
      company.address || '',
      company.contact_person || '',
      company.phone || '',
      company.email || '',
      company.tin || '',
      company.industry || '',
      company.status || '',
      company.notes || ''
    ].join(' ').toLowerCase().includes(searchQuery);
  });

  rows.innerHTML = filteredCompanies.length
    ? filteredCompanies.map((company) => `
      <tr>
        <td>${escHtml(company.company_no)}</td>
        <td>
          <div class="registry-company-cell">
            <span class="registry-company-name">${escHtml(company.company_name)}</span>
            <span class="registry-company-sub">
              ${escHtml(company.contact_person || 'No contact person')}
              ${company.phone ? ` &bull; ${escHtml(company.phone)}` : ''}
              ${company.email ? ` &bull; ${escHtml(company.email)}` : ''}
              ${company.industry ? ` &bull; ${escHtml(company.industry)}` : ''}
              ${company.tin ? ` &bull; TIN ${escHtml(company.tin)}` : ''}
            </span>
          </div>
        </td>
        <td>${escHtml(company.contact_person || '-')}</td>
        <td>${escHtml(company.phone || '-')}</td>
        <td>${escHtml(company.email || '-')}</td>
        <td>${escHtml(company.address || '-')}</td>
        <td>
          <span class="registry-status-pill ${Number(company.archived || 0) ? 'is-archived' : 'is-active'}">
            ${Number(company.archived || 0) ? 'Archived' : (company.status || 'active')}
          </span>
        </td>
        <td>
          <div class="erp-actions" style="justify-content:flex-start; margin-top:0;">
            <button class="btn btn-edit btn-sm" type="button" onclick="openCompanyModal(${Number(company.id)})">Edit</button>
            ${Number(company.archived || 0)
              ? `<button class="btn btn-save btn-sm" type="button" onclick="restoreCompany(${Number(company.id)})">Restore</button>`
              : `<button class="btn btn-cancel btn-sm" type="button" onclick="archiveCompany(${Number(company.id)})">Archive</button>`
            }
          </div>
        </td>
      </tr>
    `).join('')
    : `<tr class="empty-row"><td colspan="8">${searchQuery ? 'No matching companies found.' : 'No companies yet.'}</td></tr>`;
}

async function loadCompanies() {
  setStatus('', '');
  try {
    const companies = await fetchJson('/api/company-registry?include_archived=1');
    state.companies = Array.isArray(companies) ? companies : [];
    renderCompanies();
    updateRegistryMetrics();
    setStatus('', '');
  } catch (err) {
    state.companies = [];
    renderCompanies();
    updateRegistryMetrics();
    setStatus(err.message || 'Unable to load companies.', 'error');
  }
}

async function archiveCompany(id) {
  try {
    await fetchJson(`/api/company-registry/${id}/archive`, { method: 'PUT' });
    setStatus('Company archived.', 'success');
    await loadCompanies();
  } catch (err) {
    setStatus(err.message || 'Unable to archive company.', 'error');
  }
}

async function restoreCompany(id) {
  try {
    await fetchJson(`/api/company-registry/${id}/restore`, { method: 'PUT' });
    setStatus('Company restored.', 'success');
    await loadCompanies();
  } catch (err) {
    setStatus(err.message || 'Unable to restore company.', 'error');
  }
}

async function bootstrapCompanyRegistry() {
  await hydrateCsrfToken();

  $('company-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    clearCompanyFieldMessages();

    const payload = {
      company_name: $('erp-company-name')?.value.trim(),
      address: $('erp-company-address')?.value.trim(),
      contact_person: $('erp-company-contact')?.value.trim(),
      phone: $('erp-company-phone')?.value.trim(),
      email: $('erp-company-email')?.value.trim(),
      tin: $('erp-company-tin')?.value.trim(),
      industry: $('erp-company-industry')?.value.trim(),
      status: $('erp-company-status')?.value || 'active',
      notes: $('erp-company-notes')?.value.trim()
    };

    if (!payload.company_name) {
      setCompanyFieldMessage('company_name', 'Company name is required.');
      return;
    }

    try {
      if (editingCompanyId) {
        await fetchJson(`/api/company-registry/${editingCompanyId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        setStatus('Company updated.', 'success');
      } else {
        await postJson('/api/company-registry', payload);
        setStatus('Company registered.', 'success');
      }
      closeModal();
      resetCompanyForm();
      await loadCompanies();
    } catch (err) {
      const message = String(err.message || 'Unable to save company.');
      if (message.toLowerCase().includes('already exists') || message.toLowerCase().includes('required')) {
        setCompanyFieldMessage('company_name', message);
        return;
      }
      setStatus(message, 'error');
    }
  });

  $('company-modal-backdrop')?.addEventListener('click', (event) => {
    if (event.target && event.target.id === 'company-modal-backdrop') {
      closeCompanyModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeCompanyModal();
    }
  });

  window.openCompanyModal = openCompanyModal;
  window.closeCompanyModal = closeCompanyModal;
  window.resetCompanyForm = resetCompanyForm;
  window.renderCompanies = renderCompanies;
  window.setCompanyRegistryFilter = setCompanyRegistryFilter;
  window.archiveCompany = archiveCompany;
  window.restoreCompany = restoreCompany;
  window.editCompany = openCompanyModal;

  await loadCompanies();
}
