'use strict';

let businessEntities = [];
let editingBusinessEntityId = null;

document.addEventListener('DOMContentLoaded', bootstrapBusinessEntitiesPage);

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

const PHONE_PH_DIGITS = 11;
const PHONE_MAX_DIGITS = 15;

function normalizeDigits(value, maxLength = PHONE_MAX_DIGITS) {
  return String(value || '').replace(/\D/g, '').slice(0, maxLength);
}

function getBusinessEntityPhoneCountry() {
  return String($('be-phone-country')?.value || 'PH').trim().toUpperCase();
}

function getBusinessEntityPhoneMaxDigits() {
  return getBusinessEntityPhoneCountry() === 'PH' ? PHONE_PH_DIGITS : PHONE_MAX_DIGITS;
}

function updateBusinessEntityPhoneRules() {
  const input = $('be-phone');
  if (!input) return;
  const isPhilippines = getBusinessEntityPhoneCountry() === 'PH';
  input.maxLength = getBusinessEntityPhoneMaxDigits();
  input.placeholder = isPhilippines ? '11 digits, e.g. 09171234567' : 'Digits only, up to 15';
  const normalized = normalizeDigits(input.value, getBusinessEntityPhoneMaxDigits());
  if (input.value !== normalized) input.value = normalized;
}

function bindBusinessEntityPhoneRules() {
  const input = $('be-phone');
  const country = $('be-phone-country');
  if (input && input.dataset.phoneBound !== '1') {
    input.dataset.phoneBound = '1';
    input.addEventListener('input', updateBusinessEntityPhoneRules);
  }
  if (country && country.dataset.phoneCountryBound !== '1') {
    country.dataset.phoneCountryBound = '1';
    country.addEventListener('change', updateBusinessEntityPhoneRules);
  }
  updateBusinessEntityPhoneRules();
}

function getBusinessEntityPhoneValidationMessage(phone) {
  const normalized = normalizeDigits(phone, PHONE_MAX_DIGITS);
  if (!normalized) return '';
  if (getBusinessEntityPhoneCountry() === 'PH' && normalized.length !== PHONE_PH_DIGITS) {
    return 'Phone must be exactly 11 digits for PH numbers.';
  }
  if (getBusinessEntityPhoneCountry() !== 'PH' && (normalized.length < 7 || normalized.length > PHONE_MAX_DIGITS)) {
    return 'Phone must be digits only, 7 to 15 digits.';
  }
  return '';
}

function setStatus(message, type = '') {
  const node = $('business-entity-status');
  if (!node) return;
  node.classList.remove('is-success', 'is-error');
  if (type === 'success') node.classList.add('is-success');
  if (type === 'error') node.classList.add('is-error');
  node.textContent = String(message || '');
}

async function hydrateCsrfToken() {
  try {
    const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json().catch(() => ({}));
    if (data?.csrfToken) window.__CSRF_TOKEN__ = data.csrfToken;
  } catch (_) {}
}

async function fetchJson(url, options = {}) {
  const { headers: customHeaders, ...fetchOptions } = options;
  const headers = new Headers(customHeaders || {});
  const method = String(fetchOptions.method || 'GET').toUpperCase();

  if (method !== 'GET') {
    const token = String(window.__CSRF_TOKEN__ || '').trim();
    if (token && !headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', token);
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

function getSearchQuery() {
  return String($('business-entity-search')?.value || '').trim().toLowerCase();
}

function renderBusinessEntities() {
  const body = $('business-entities-body');
  if (!body) return;
  const query = getSearchQuery();
  const rows = (Array.isArray(businessEntities) ? businessEntities : []).filter((row) => {
    if (!query) return true;
    return [
      row.entity_code,
      row.company_name,
      row.address,
      row.contact_person,
      row.phone,
      row.email,
      row.tin,
      row.status
    ].join(' ').toLowerCase().includes(query);
  });

  body.innerHTML = rows.length
    ? rows.map((row) => `
      <tr>
        <td>${escHtml(row.entity_code || '-')}</td>
        <td><strong>${escHtml(row.company_name || '-')}</strong><div class="registry-company-sub">${escHtml(row.address || 'No address set')}</div></td>
        <td>${escHtml(row.contact_person || '-')}</td>
        <td>${escHtml(row.phone || '-')}</td>
        <td>${escHtml(row.email || '-')}</td>
        <td>${escHtml(row.tin || '-')}</td>
        <td><span class="registry-status-pill ${String(row.status || '').toLowerCase() === 'inactive' ? 'is-archived' : 'is-active'}">${escHtml(row.status || 'active')}</span></td>
        <td>${Number(row.is_default || 0) ? 'Yes' : '-'}</td>
        <td>
          <div class="erp-actions business-entity-actions">
            <button class="btn btn-edit btn-sm" type="button" data-business-entity-action="edit" data-business-entity-id="${Number(row.id || 0)}">Edit</button>
            ${String(row.status || 'active').toLowerCase() === 'inactive'
              ? ''
              : `<button class="btn btn-save btn-sm" type="button" data-business-entity-action="make-vendor" data-business-entity-id="${Number(row.id || 0)}">Make Vendor</button>`
            }
          </div>
        </td>
      </tr>
    `).join('')
    : `<tr class="business-entity-empty"><td colspan="9">${query ? 'No matching business entities found.' : 'No business entities yet.'}</td></tr>`;
}

async function loadBusinessEntities() {
  setStatus('', '');
  try {
    const rows = await fetchJson('/api/business-entities?include_inactive=1', { cache: 'no-store' });
    businessEntities = Array.isArray(rows) ? rows : [];
    renderBusinessEntities();
  } catch (err) {
    businessEntities = [];
    renderBusinessEntities();
    setStatus(err.message || 'Unable to load business entities.', 'error');
  }
}

function setBusinessEntityModalMode(row = null) {
  editingBusinessEntityId = row ? Number(row.id || 0) || null : null;
  const title = document.querySelector('#business-entity-modal-backdrop .modal-title');
  const saveBtn = $('business-entity-save-btn');
  if (title) title.textContent = editingBusinessEntityId ? 'Edit Business Entity' : 'Add Business Entity';
  if (saveBtn) saveBtn.textContent = editingBusinessEntityId ? 'Save Changes' : 'Save Business Entity';
}

function fillBusinessEntityForm(row = null) {
  $('business-entity-form')?.reset();
  if ($('be-phone-country')) $('be-phone-country').value = 'PH';
  if (!row) {
    updateBusinessEntityPhoneRules();
    return;
  }
  if ($('be-entity-code')) $('be-entity-code').value = row.entity_code || '';
  if ($('be-company-name')) $('be-company-name').value = row.company_name || '';
  if ($('be-address')) $('be-address').value = row.address || '';
  if ($('be-contact-person')) $('be-contact-person').value = row.contact_person || '';
  if ($('be-phone')) $('be-phone').value = normalizeDigits(row.phone || '', getBusinessEntityPhoneMaxDigits());
  if ($('be-email')) $('be-email').value = row.email || '';
  if ($('be-tin')) $('be-tin').value = row.tin || '';
  if ($('be-status')) $('be-status').value = row.status || 'active';
  if ($('be-is-default')) $('be-is-default').checked = Number(row.is_default || 0) === 1;
  updateBusinessEntityPhoneRules();
}

function openBusinessEntityModal(id = null) {
  const row = id
    ? businessEntities.find((entry) => Number(entry.id || 0) === Number(id || 0)) || null
    : null;
  if (id && !row) {
    setStatus('Business entity not found.', 'error');
    return;
  }
  setBusinessEntityModalMode(row);
  fillBusinessEntityForm(row);
  const modal = $('business-entity-modal-backdrop');
  if (!modal) return;
  modal.classList.add('open');
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeBusinessEntityModal() {
  const modal = $('business-entity-modal-backdrop');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = '';
    modal.setAttribute('aria-hidden', 'true');
  }
  editingBusinessEntityId = null;
  setBusinessEntityModalMode(null);
  document.body.style.overflow = '';
}

function getBusinessEntityPayload() {
  return {
    entity_code: $('be-entity-code')?.value.trim(),
    company_name: $('be-company-name')?.value.trim(),
    address: $('be-address')?.value.trim(),
    contact_person: $('be-contact-person')?.value.trim(),
    phone: normalizeDigits($('be-phone')?.value || '', PHONE_MAX_DIGITS),
    email: $('be-email')?.value.trim(),
    tin: $('be-tin')?.value.trim(),
    status: $('be-status')?.value || 'active',
    is_default: $('be-is-default')?.checked ? 1 : 0
  };
}

async function saveBusinessEntity(event) {
  event.preventDefault();
  const payload = getBusinessEntityPayload();
  if (!payload.company_name) {
    setStatus('Business title is required.', 'error');
    $('be-company-name')?.focus();
    return;
  }

  const phoneError = getBusinessEntityPhoneValidationMessage(payload.phone);
  if (phoneError) {
    setStatus(phoneError, 'error');
    $('be-phone')?.focus();
    return;
  }

  try {
    const isEdit = Boolean(editingBusinessEntityId);
    await fetchJson(isEdit ? `/api/business-entities/${editingBusinessEntityId}` : '/api/business-entities', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeBusinessEntityModal();
    setStatus(isEdit ? 'Business entity updated.' : 'Business entity saved.', 'success');
    await loadBusinessEntities();
  } catch (err) {
    setStatus(err.message || 'Unable to save business entity.', 'error');
  }
}

function handleBusinessEntityTableClick(event) {
  const button = event.target.closest('[data-business-entity-action]');
  if (!button) return;
  const id = Number(button.getAttribute('data-business-entity-id') || 0) || 0;
  const action = String(button.getAttribute('data-business-entity-action') || '').trim();
  if (action === 'edit') {
    openBusinessEntityModal(id);
    return;
  }
  if (action === 'make-vendor') {
    createVendorProfileFromBusinessEntity(id);
  }
}

async function createVendorProfileFromBusinessEntity(id) {
  const businessEntityId = Number(id || 0);
  if (!businessEntityId) return;

  const entity = businessEntities.find((row) => Number(row.id || 0) === businessEntityId) || null;
  const label = String(entity?.company_name || entity?.entity_code || 'this business entity').trim();

  try {
    const result = await fetchJson(`/api/business-entities/${businessEntityId}/vendor-profile`, {
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
    await loadBusinessEntities();
  } catch (err) {
    setStatus(err.message || 'Unable to create vendor profile.', 'error');
  }
}

async function bootstrapBusinessEntitiesPage() {
  await hydrateCsrfToken();
  bindBusinessEntityPhoneRules();
  $('business-entity-form')?.addEventListener('submit', saveBusinessEntity);
  $('business-entities-body')?.addEventListener('click', handleBusinessEntityTableClick);
  $('business-entity-modal-backdrop')?.addEventListener('click', (event) => {
    if (event.target?.id === 'business-entity-modal-backdrop') closeBusinessEntityModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeBusinessEntityModal();
  });

  window.openBusinessEntityModal = openBusinessEntityModal;
  window.closeBusinessEntityModal = closeBusinessEntityModal;
  window.renderBusinessEntities = renderBusinessEntities;
  window.createVendorProfileFromBusinessEntity = createVendorProfileFromBusinessEntity;

  await loadBusinessEntities();
}
