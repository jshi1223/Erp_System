'use strict';

const state = {
  companies: []
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
  const companyNoInput = $('erp-company-no');
  const companyNameInput = $('erp-company-name');
  const addressInput = $('erp-company-address');
  const contactInput = $('erp-company-contact');
  const phoneInput = $('erp-company-phone');
  const emailInput = $('erp-company-email');
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
      company.company_name || '',
      company.address || '',
      company.contact_person || '',
      company.phone || '',
      company.email || '',
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
  setStatus('Loading company registry...', '');
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

    const payload = {
      company_name: $('erp-company-name')?.value.trim(),
      address: $('erp-company-address')?.value.trim(),
      contact_person: $('erp-company-contact')?.value.trim(),
      phone: $('erp-company-phone')?.value.trim(),
      email: $('erp-company-email')?.value.trim(),
      status: $('erp-company-status')?.value || 'active',
      notes: $('erp-company-notes')?.value.trim()
    };

    if (!payload.company_name) {
      setStatus('Company name is required.', 'error');
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
      setStatus(err.message || 'Unable to save company.', 'error');
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
