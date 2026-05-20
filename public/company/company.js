'use strict';

const state = {
  companies: [],
  businessEntities: [],
  companyOverview: null,
  currentUser: null
};

let editingCompanyId = null;
let currentBusinessEntityContextId = '';
const BUSINESS_ENTITY_CONTEXT_KEY = 'kinaadman_businessEntityContext';
const BUSINESS_ENTITY_THEME_KEY = 'kinaadman_businessEntityTheme';

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

function getDefaultBusinessEntityId() {
  const rows = Array.isArray(state.businessEntities) ? state.businessEntities : [];
  const defaultRow = rows.find(row => Number(row.is_default || 0) === 1) || rows[0] || null;
  return defaultRow ? String(defaultRow.id || '') : '';
}

function getCurrentBusinessEntityId() {
  const rows = Array.isArray(state.businessEntities) ? state.businessEntities : [];
  const stored = String(currentBusinessEntityContextId || localStorage.getItem(BUSINESS_ENTITY_CONTEXT_KEY) || '').trim();
  if (!rows.length) return stored;
  if (stored && rows.some(row => String(row.id || '') === stored)) {
    currentBusinessEntityContextId = stored;
    return stored;
  }
  const fallback = getDefaultBusinessEntityId();
  currentBusinessEntityContextId = fallback;
  if (fallback) localStorage.setItem(BUSINESS_ENTITY_CONTEXT_KEY, fallback);
  return fallback;
}

function findBusinessEntityById(id) {
  const target = String(id || '').trim();
  return (Array.isArray(state.businessEntities) ? state.businessEntities : [])
    .find(row => String(row.id || '') === target) || null;
}

function businessEntityShortLabel(row) {
  const name = String(row?.company_name || row?.entity_code || '').trim();
  if (/kvsk/i.test(name)) return 'KVSK';
  if (/kitsi|ktiis/i.test(name)) return 'KITSI';
  return name.replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'Company';
}

function businessEntityProfileValue(value, fallback = 'Not set') {
  const text = String(value || '').trim();
  return text || fallback;
}

function getBusinessEntityBrandProfile(row) {
  const name = String(row?.company_name || '').trim();
  if (/kitsi|ktiis|kinaadman/i.test(name) || String(row?.theme || '').toLowerCase() === 'kitsi') {
    return {
      theme: 'kitsi',
      logo: '/assets/img/kitsi-logo.png',
      alt: 'KITSI logo',
      primary: '#0898c7',
      primaryLight: '#22c7e8',
      primaryDark: '#005b96',
      accent: '#07a6d6',
      accent2: '#005b96'
    };
  }
  return {
    theme: 'kvsk',
    logo: '/assets/img/kvsk-logo-switch.png',
    alt: 'KVSK logo',
    primary: '#b42318',
    primaryLight: '#ef5b4f',
    primaryDark: '#4b1210',
    accent: '#d92d20',
    accent2: '#201313'
  };
}

function applyBusinessEntityBrand(row) {
  const profile = getBusinessEntityBrandProfile(row);
  document.body.dataset.businessEntityTheme = profile.theme;
  document.documentElement.style.setProperty('--primary', profile.primary);
  document.documentElement.style.setProperty('--primary-light', profile.primaryLight);
  document.documentElement.style.setProperty('--primary-dark', profile.primaryDark);
  document.documentElement.style.setProperty('--accent', profile.accent);
  document.documentElement.style.setProperty('--accent2', profile.accent2);
  document.querySelectorAll('.brand-mark, .sidebar-brand-mark, .user-modal-brand-mark').forEach((img) => {
    img.src = profile.logo;
    img.alt = profile.alt;
  });
  try {
    localStorage.setItem(BUSINESS_ENTITY_THEME_KEY, JSON.stringify({
      company_name: row?.company_name || '',
      theme: profile.theme,
      logo: profile.logo,
      alt: profile.alt,
      primary: profile.primary,
      primaryLight: profile.primaryLight,
      primaryDark: profile.primaryDark,
      accent: profile.accent,
      accent2: profile.accent2
    }));
  } catch (_) {}
}

function renderBusinessEntityProfilePanel(current = getCurrentBusinessEntityId()) {
  const panel = $('business-profile-panel');
  if (!panel) return;
  const rows = Array.isArray(state.businessEntities) ? state.businessEntities : [];
  panel.innerHTML = rows.length
    ? rows.map((row) => {
        const id = String(row.id || '');
        const isActive = id === String(current || '');
        const profile = getBusinessEntityBrandProfile(row);
        return `
          <button class="business-profile-card${isActive ? ' is-active' : ''}" type="button" onclick="setBusinessEntityContext('${escHtml(id)}')">
            <span class="business-profile-logo-wrap"><img src="${escHtml(profile.logo)}" alt="${escHtml(profile.alt)}" /></span>
            <span class="business-profile-copy">
              <span class="business-profile-name">${escHtml(row.company_name || businessEntityShortLabel(row))}</span>
              <span class="business-profile-meta">${escHtml(row.entity_code || 'Operating company')} · ${escHtml(businessEntityProfileValue(row.status, 'active'))}${Number(row.is_default || 0) ? ' · Default' : ''}</span>
              <span class="business-profile-line">${escHtml(businessEntityProfileValue(row.contact_person, 'Contact person not set'))}</span>
              <span class="business-profile-line">${escHtml(businessEntityProfileValue(row.email || row.phone, 'Email/phone not set'))}</span>
            </span>
          </button>
        `;
      }).join('')
    : '<div class="business-profile-empty">Business profiles unavailable</div>';
}

function syncModalBusinessContext(row = findBusinessEntityById(getCurrentBusinessEntityId())) {
  const label = businessEntityShortLabel(row || findBusinessEntityById(getCurrentBusinessEntityId()) || {});
  const title = String(row?.company_name || label || 'Operating Company').trim();
  document.querySelectorAll('.modal-header, .modal-header-tight, .user-modal-brand').forEach((header) => {
    let badge = header.querySelector(':scope > .modal-business-context');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'modal-business-context';
      const closeBtn = header.querySelector(':scope > .modal-close, :scope > .close-btn');
      if (closeBtn) {
        header.insertBefore(badge, closeBtn);
      } else {
        header.appendChild(badge);
      }
    }
    badge.textContent = label || 'Company';
    badge.title = title;
    badge.setAttribute('aria-label', `Current business profile: ${title}`);
  });
}

function renderBusinessEntitySwitcher() {
  const host = $('business-entity-switcher');
  const rows = Array.isArray(state.businessEntities) ? state.businessEntities : [];
  const current = getCurrentBusinessEntityId();
  if (host) {
    host.innerHTML = rows.map((row) => {
      const id = String(row.id || '');
      return `<button class="business-entity-switch${id === current ? ' is-active' : ''}" type="button" onclick="setBusinessEntityContext('${escHtml(id)}')" aria-pressed="${id === current ? 'true' : 'false'}">${escHtml(businessEntityShortLabel(row))}</button>`;
    }).join('');
  }
  const activeEntity = findBusinessEntityById(current);
  applyBusinessEntityBrand(activeEntity);
  renderBusinessEntityProfilePanel(current);
  renderCurrentWorkspaceBadge(activeEntity);
  syncModalBusinessContext(activeEntity);
  document.querySelectorAll('header .brand-copy .header-logo').forEach((node) => {
    node.textContent = activeEntity?.company_name || 'Kinaadman ERP';
  });
}

function renderCurrentWorkspaceBadge(row = findBusinessEntityById(getCurrentBusinessEntityId())) {
  const badge = $('current-workspace-badge');
  if (!badge) return;
  const label = businessEntityShortLabel(row || {});
  const title = String(row?.company_name || label || 'Workspace').trim();
  badge.textContent = `${label || 'ERP'} Workspace`;
  badge.title = title;
  badge.setAttribute('aria-label', `Current workspace: ${title}`);
}

async function setBusinessEntityContext(id) {
  const nextId = String(id || '').trim();
  if (!nextId) return;
  currentBusinessEntityContextId = nextId;
  localStorage.setItem(BUSINESS_ENTITY_CONTEXT_KEY, nextId);
  renderBusinessEntitySwitcher();
  await loadCompanies();
}

async function loadBusinessEntities() {
  try {
    const rows = await fetchJson('/api/business-entities', { cache: 'no-store' });
    state.businessEntities = Array.isArray(rows) ? rows : [];
  } catch (err) {
    state.businessEntities = [];
    setStatus(err.message || 'Unable to load operating companies.', 'error');
  }
  renderBusinessEntitySwitcher();
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
    const error = new Error(data.error || data.message || `Request failed (${response.status})`);
    error.field = data.field || '';
    error.payload = data;
    throw error;
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

function focusCompanyControl(node) {
  if (!node || typeof node.focus !== 'function') return false;
  if (typeof node.scrollIntoView === 'function') {
    node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }
  node.focus({ preventScroll: true });
  if (typeof node.select === 'function' && ['INPUT', 'TEXTAREA'].includes(node.tagName)) {
    node.select();
  }
  return true;
}

function setCompanyOverviewValue(nodeId, value) {
  const node = $(nodeId);
  if (!node) return;
  node.textContent = String(Number(value || 0));
}

function normalizeCompanyNameForCompare(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeCompanyTinForCompare(value) {
  return String(value || '').replace(/\D/g, '').trim().toLowerCase();
}

function normalizeCompanyPhoneForCompare(value) {
  return String(value || '').replace(/\D/g, '').trim().toLowerCase();
}

function formatCompanyTin(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 12);
  if (!digits) return '';
  return digits.match(/.{1,3}/g)?.join('-') || digits;
}

function bindCompanyTinMask() {
  const input = $('erp-company-tin');
  if (!input || input.dataset.companyTinBound === '1') return;
  const applyMask = () => {
    const formatted = formatCompanyTin(input.value);
    if (input.value !== formatted) {
      input.value = formatted;
    }
  };
  input.dataset.companyTinBound = '1';
  input.addEventListener('input', applyMask);
  input.addEventListener('blur', applyMask);
  applyMask();
}

function findDuplicateCompanyEntry(companyName, phone, tin, excludeId = null) {
  const normalizedName = normalizeCompanyNameForCompare(companyName);
  const normalizedPhone = normalizeCompanyPhoneForCompare(phone);
  const normalizedTin = normalizeCompanyTinForCompare(tin);
  const currentId = Number(excludeId || 0) || 0;
  const companies = Array.isArray(state.companies) ? state.companies : [];

  for (const company of companies) {
    if (!company) continue;
    if (currentId && Number(company.id || 0) === currentId) continue;

    if (normalizedName && normalizeCompanyNameForCompare(company.company_name) === normalizedName) {
      return {
        field: 'company_name',
        selector: 'erp-company-name',
        message: 'Company name already exists in the registry.'
      };
    }

    if (normalizedPhone && normalizeCompanyPhoneForCompare(company.phone) === normalizedPhone) {
      return {
        field: 'phone',
        selector: 'erp-company-phone',
        message: 'Phone already exists in the registry.'
      };
    }

    if (normalizedTin && normalizeCompanyTinForCompare(company.tin) === normalizedTin) {
      return {
        field: 'tin',
        selector: 'erp-company-tin',
        message: 'TIN already exists in the registry.'
      };
    }
  }

  return null;
}

function bindCompanyValidationListeners() {
  [
    ['erp-company-name', 'company_name'],
    ['erp-company-phone', 'phone'],
    ['erp-company-tin', 'tin']
  ].forEach(([id, fieldName]) => {
    const input = $(id);
    if (!input || input.dataset.companyDuplicateBound === '1') return;
    input.dataset.companyDuplicateBound = '1';
    input.addEventListener('input', () => setCompanyFieldMessage(fieldName, ''));
  });
}

function validateCompanyForm() {
  clearCompanyFieldMessages();

  const requiredFields = [
    { field: 'company_no', selector: 'erp-company-no', label: 'Company no.' },
    { field: 'company_name', selector: 'erp-company-name', label: 'Company name' },
    { field: 'address', selector: 'erp-company-address', label: 'Address' },
    { field: 'contact_person', selector: 'erp-company-contact', label: 'Contact person' },
    { field: 'phone', selector: 'erp-company-phone', label: 'Phone' },
    { field: 'email', selector: 'erp-company-email', label: 'Email', type: 'email' },
    { field: 'tin', selector: 'erp-company-tin', label: 'TIN', type: 'tin' },
    { field: 'status', selector: 'erp-company-status', label: 'Status' }
  ];

  let firstInvalid = null;

  requiredFields.forEach((item) => {
    const input = $(item.selector);
    const value = String(input?.value || '').trim();

    if (!value) {
      setCompanyFieldMessage(item.field, `${item.label} is required.`);
      if (!firstInvalid) firstInvalid = input;
      return;
    }

    if (item.field === 'company_no' && value.toLowerCase() === 'loading...') {
      setCompanyFieldMessage(item.field, 'Company no. is still loading. Please wait.');
      if (!firstInvalid) firstInvalid = input;
      return;
    }

    if (item.type === 'email') {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(value)) {
        setCompanyFieldMessage(item.field, 'Enter a valid email address.');
        if (!firstInvalid) firstInvalid = input;
      }
    }

    if (item.type === 'tin') {
      const tinDigits = String(value || '').replace(/\D/g, '');
      if (tinDigits.length !== 12) {
        setCompanyFieldMessage(item.field, 'TIN must follow 000-000-000-000 format.');
        if (!firstInvalid) firstInvalid = input;
      }
    }

    if (item.field === 'phone' && typeof isValidPhoneForField === 'function' && !isValidPhoneForField(item.selector, value)) {
      setCompanyFieldMessage(item.field, getPhoneValidationMessage(item.selector, item.label));
      if (!firstInvalid) firstInvalid = input;
    }
  });

  if (firstInvalid && typeof firstInvalid.focus === 'function') {
    focusCompanyControl(firstInvalid);
  }

  return !firstInvalid;
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
    state.currentUser = data && data.loggedIn ? data : null;
    if (data?.csrfToken) {
      window.__CSRF_TOKEN__ = data.csrfToken;
    }
  } catch (_) {}
}

function isAdminUser() {
  const role = String(state.currentUser?.role || '').trim().toLowerCase();
  return role === 'super_admin' || role === 'admin';
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
  const visibleCompanies = (Array.isArray(state.companies) ? state.companies : []).filter((company) => String(company.business_entity_id || '') === String(getCurrentBusinessEntityId() || ''));
  const total = visibleCompanies.length;
  const archived = visibleCompanies.filter((company) => Number(company.archived || 0) === 1).length;
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
  const branchCodeInput = $('erp-company-branch-code');
  const companyNameInput = $('erp-company-name');
  const addressInput = $('erp-company-address');
  const contactInput = $('erp-company-contact');
  const phoneInput = $('erp-company-phone');
  const emailInput = $('erp-company-email');
  const tinInput = $('erp-company-tin');
  const statusInput = $('erp-company-status');
  const notesInput = $('erp-company-notes');
  const businessEntityInput = $('erp-company-business-entity-id');
  const title = $('company-modal-title');
  const saveBtn = $('company-save-btn');

  if (companyNoInput) companyNoInput.value = '';
  if (branchCodeInput) branchCodeInput.value = '';
  if (companyNameInput) companyNameInput.value = '';
  if (addressInput) addressInput.value = '';
  if (contactInput) contactInput.value = '';
  if (phoneInput) phoneInput.value = '';
  if (emailInput) emailInput.value = '';
  if (tinInput) tinInput.value = '';
  if (statusInput) statusInput.value = 'active';
  if (notesInput) notesInput.value = '';
  if (businessEntityInput) businessEntityInput.value = '';
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
    const branchCodeInput = $('erp-company-branch-code');
    const companyNameInput = $('erp-company-name');
    const addressInput = $('erp-company-address');
    const contactInput = $('erp-company-contact');
    const phoneInput = $('erp-company-phone');
    const emailInput = $('erp-company-email');
    const tinInput = $('erp-company-tin');
    const statusInput = $('erp-company-status');
    const notesInput = $('erp-company-notes');
    const title = $('company-modal-title');
    const saveBtn = $('company-save-btn');

    if (companyNoInput) companyNoInput.value = company.company_no || '';
    if (branchCodeInput) {
      const branchCode = String(company.branch_code || '').trim();
      branchCodeInput.value = branchCode && branchCode !== '000' ? branchCode : '';
    }
    if (companyNameInput) companyNameInput.value = company.company_name || '';
    if (addressInput) addressInput.value = company.address || '';
    if (contactInput) contactInput.value = company.contact_person || '';
    if (phoneInput) phoneInput.value = company.phone || '';
    if (emailInput) emailInput.value = company.email || '';
    if (tinInput) tinInput.value = formatCompanyTin(company.tin || '');
    if (statusInput) statusInput.value = company.status || 'active';
    if (notesInput) notesInput.value = company.notes || '';
    const businessEntityInput = $('erp-company-business-entity-id');
    if (businessEntityInput) businessEntityInput.value = '';
    if (title) title.textContent = 'Edit Company';
    if (saveBtn) saveBtn.textContent = 'Update Company';
  } else {
    const companyNoInput = $('erp-company-no');
    if (companyNoInput) companyNoInput.value = 'Loading...';
    try {
      const data = await fetchJson('/api/company-registry/next-no', { cache: 'no-store' });
      if (companyNoInput) companyNoInput.value = data.company_no || '';
    } catch (_) {
      if (companyNoInput) companyNoInput.value = '';
    }
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
  const searchDigits = searchQuery.replace(/\D/g, '');
  const statusFilter = getStatusFilter();

  const filteredCompanies = state.companies.filter((company) => {
    const isArchived = Number(company.archived || 0) === 1;
    if (statusFilter === 'active' && isArchived) return false;
    if (statusFilter === 'archived' && !isArchived) return false;
    if (!searchQuery) return true;
    const tinFormatted = formatCompanyTin(company.tin || '');
    const tinDigits = String(company.tin || '').replace(/\D/g, '');
    const haystack = [
      company.company_no || '',
      company.branch_code || '',
      company.company_name || '',
      company.address || '',
      company.contact_person || '',
      company.phone || '',
      company.email || '',
      company.tin || '',
      tinFormatted || '',
      tinDigits || '',
      company.industry || '',
      company.status || '',
      company.notes || ''
    ].join(' ').toLowerCase();
    return haystack.includes(searchQuery) || (searchDigits && haystack.replace(/\D/g, '').includes(searchDigits));
  });

  rows.innerHTML = filteredCompanies.length
    ? filteredCompanies.map((company) => {
      const tinDisplay = formatCompanyTin(company.tin || '');
      const branchDisplay = String(company.branch_code || '000').trim() || '000';
      return `
      <tr>
        <td>${escHtml(company.company_no)}</td>
        <td>${escHtml(branchDisplay)}</td>
        <td>
          <div class="registry-company-cell">
            <span class="registry-company-name">${escHtml(company.company_name)}</span>
            <span class="registry-company-sub">${escHtml(company.address || 'No address set')}</span>
          </div>
        </td>
        <td>${escHtml(tinDisplay || '-')}</td>
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
              ? ''
              : `<button class="btn btn-save btn-sm" type="button" onclick="createVendorProfileFromCompany(${Number(company.id)})">Make Vendor</button>`
            }
            ${isAdminUser()
              ? (Number(company.archived || 0)
                ? `<button class="btn btn-save btn-sm" type="button" onclick="restoreCompany(${Number(company.id)})">Restore</button>`
                : `<button class="btn btn-cancel btn-sm" type="button" onclick="archiveCompany(${Number(company.id)})">Archive</button>`)
              : ''
            }
          </div>
        </td>
      </tr>
      `;
    }).join('')
    : `<tr class="empty-row"><td colspan="10">${searchQuery ? 'No matching companies found.' : 'No companies yet.'}</td></tr>`;
}

async function loadCompanies() {
  setStatus('', '');
  try {
    const query = new URLSearchParams({
      include_archived: '1',
      business_entity_id: getCurrentBusinessEntityId() || getDefaultBusinessEntityId() || ''
    });
    const companies = await fetchJson(`/api/company-registry?${query.toString()}`);
    state.companies = (Array.isArray(companies) ? companies : [])
      .filter((company) => String(company.business_entity_id || '') === String(getCurrentBusinessEntityId() || getDefaultBusinessEntityId() || ''));
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

async function createVendorProfileFromCompany(id) {
  const companyId = Number(id || 0);
  if (!companyId) return;

  const company = state.companies.find((row) => Number(row.id || 0) === companyId) || null;
  const label = String(company?.company_name || company?.company_no || 'this company').trim();

  try {
    const result = await fetchJson(`/api/company-registry/${companyId}/vendor-profile`, {
      method: 'POST'
    });
    const vendorNo = String(result?.vendor_no || '').trim();
    const suffix = vendorNo ? ` (${vendorNo})` : '';
    setStatus(
      result?.already_exists
        ? `${label} is already in the Vendor Directory${suffix}.`
        : `${label} was added to the Vendor Directory${suffix}.`,
      'success'
    );
    await loadCompanies();
    if (Number(editingCompanyId || 0) === companyId) {
      await loadCompanyOverview(companyId);
    }
  } catch (err) {
    setStatus(err.message || 'Unable to create vendor profile.', 'error');
  }
}

async function bootstrapCompanyRegistry() {
  await hydrateCsrfToken();
  bindCompanyTinMask();
  bindCompanyValidationListeners();

  $('company-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      business_entity_id: getCurrentBusinessEntityId() || getDefaultBusinessEntityId() || '',
      company_no: $('erp-company-no')?.value.trim(),
      company_name: $('erp-company-name')?.value.trim(),
      branch_code: $('erp-company-branch-code')?.value.trim(),
      address: $('erp-company-address')?.value.trim(),
      contact_person: $('erp-company-contact')?.value.trim(),
      phone: normalizePhone($('erp-company-phone')?.value || ''),
      email: $('erp-company-email')?.value.trim(),
      tin: formatCompanyTin($('erp-company-tin')?.value || ''),
      status: $('erp-company-status')?.value || 'active',
      notes: $('erp-company-notes')?.value.trim()
    };

    if (!validateCompanyForm()) {
      return;
    }

    const duplicate = findDuplicateCompanyEntry(payload.company_name, payload.phone, payload.tin, editingCompanyId);
    if (duplicate) {
      setCompanyFieldMessage(duplicate.field, duplicate.message);
      focusCompanyControl($(duplicate.selector));
      setStatus(duplicate.message, 'error');
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
      if (err.field === 'tin') {
        setCompanyFieldMessage('tin', message);
        focusCompanyControl($('erp-company-tin'));
        return;
      }
      if (err.field === 'phone') {
        setCompanyFieldMessage('phone', message);
        focusCompanyControl($('erp-company-phone'));
        return;
      }
      if (err.field === 'company_name') {
        setCompanyFieldMessage('company_name', message);
        focusCompanyControl($('erp-company-name'));
        return;
      }
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('already exists') || lowerMessage.includes('duplicate')) {
        setCompanyFieldMessage('company_name', message);
        focusCompanyControl($('erp-company-name'));
        return;
      }
      if (lowerMessage.includes('required')) {
        setStatus(message, 'error');
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
  window.setBusinessEntityContext = setBusinessEntityContext;
  window.archiveCompany = archiveCompany;
  window.restoreCompany = restoreCompany;
  window.createVendorProfileFromCompany = createVendorProfileFromCompany;
  window.editCompany = openCompanyModal;

  await loadBusinessEntities();
  await loadCompanies();
}
