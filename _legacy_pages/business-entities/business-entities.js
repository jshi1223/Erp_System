'use strict';

let businessEntities = [];
let editingBusinessEntityId = null;
let stagedLogoFile = null;
let removeLogoFlag = false;
let currentLogoPath = '';

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

function setBusinessEntityLogoPreview(src) {
  const preview = $('be-logo-preview');
  const empty = $('be-logo-empty');
  const removeBtn = $('be-logo-remove');
  if (preview) {
    if (src) {
      preview.src = src;
      preview.hidden = false;
    } else {
      preview.removeAttribute('src');
      preview.hidden = true;
    }
  }
  if (empty) empty.hidden = Boolean(src);
  if (removeBtn) removeBtn.hidden = !src;
}

function resetBusinessEntityLogoState() {
  stagedLogoFile = null;
  removeLogoFlag = false;
  currentLogoPath = '';
  const input = $('be-logo-input');
  if (input) input.value = '';
  setBusinessEntityLogoPreview('');
}

function bindBusinessEntityLogoControls() {
  const pick = $('be-logo-pick');
  const input = $('be-logo-input');
  const removeBtn = $('be-logo-remove');
  if (pick && input && pick.dataset.bound !== '1') {
    pick.dataset.bound = '1';
    pick.addEventListener('click', () => input.click());
  }
  if (input && input.dataset.bound !== '1') {
    input.dataset.bound = '1';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0] ? input.files[0] : null;
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        setStatus('Logo image must be 2MB or smaller.', 'error');
        input.value = '';
        return;
      }
      stagedLogoFile = file;
      removeLogoFlag = false;
      setBusinessEntityLogoPreview(URL.createObjectURL(file));
    });
  }
  if (removeBtn && removeBtn.dataset.bound !== '1') {
    removeBtn.dataset.bound = '1';
    removeBtn.addEventListener('click', () => {
      stagedLogoFile = null;
      const fileInput = $('be-logo-input');
      if (fileInput) fileInput.value = '';
      // Only schedule a server-side delete when an already-saved logo exists.
      removeLogoFlag = Boolean(currentLogoPath);
      setBusinessEntityLogoPreview('');
    });
  }
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
        <td>
          <div class="be-title-cell">
            ${row.logo_path
              ? `<img class="be-row-logo" src="${escHtml(row.logo_path)}" alt="${escHtml(row.company_name || 'Company')} logo" />`
              : '<span class="be-row-logo be-row-logo-empty" aria-hidden="true"></span>'}
            <div><strong>${escHtml(row.company_name || '-')}</strong><div class="registry-company-sub">${escHtml(row.address || 'No address set')}</div></div>
          </div>
        </td>
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
  resetBusinessEntityLogoState();
  if (!row) {
    updateBusinessEntityPhoneRules();
    return;
  }
  currentLogoPath = String(row.logo_path || '');
  setBusinessEntityLogoPreview(currentLogoPath);
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
  if (!id) {
    setStatus('Adding business entities is disabled. KVSK and KITSI workspaces are fixed.', 'error');
    return;
  }
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
  resetBusinessEntityLogoState();
  document.body.style.overflow = '';
}

// Keep the header brand marks + shared theme key in sync with the active workspace's
// logo. Called right after an upload/remove so the change is realtime and persists on
// refresh (auth-guard reads kinaadman_businessEntityTheme.logo on the next load).
function syncActiveWorkspaceLogo(entityId, logoPath) {
  try {
    const activeCtx = String(localStorage.getItem('kinaadman_businessEntityContext') || '').trim();
    if (activeCtx !== String(entityId)) return; // only the active workspace drives the header
    let tp = {};
    try { tp = JSON.parse(localStorage.getItem('kinaadman_businessEntityTheme') || 'null') || {}; } catch (_) { tp = {}; }
    tp.logo = logoPath || '';
    if (!tp.theme) tp.theme = 'kvsk';
    const row = businessEntities.find((e) => Number(e.id || 0) === Number(entityId));
    if (row && row.company_name) tp.company_name = row.company_name;
    localStorage.setItem('kinaadman_businessEntityTheme', JSON.stringify(tp));
    document.querySelectorAll('.brand-mark, .sidebar-brand-mark, .user-modal-brand-mark').forEach((img) => {
      if (logoPath) {
        img.src = logoPath;
        img.style.removeProperty('display');
        img.removeAttribute('hidden');
      } else {
        img.style.display = 'none';
        img.removeAttribute('src');
      }
    });
  } catch (_) {}
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
  if (!editingBusinessEntityId) {
    setStatus('Adding business entities is disabled. Edit an existing workspace instead.', 'error');
    return;
  }
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
    const entityId = editingBusinessEntityId;
    const isEdit = Boolean(entityId);
    await fetchJson(isEdit ? `/api/business-entities/${entityId}` : '/api/business-entities', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    // Persist logo changes after the entity fields save: upload a new image or
    // remove the existing one. FormData lets the browser set the multipart boundary.
    let updatedLogoPath = null; // null = logo unchanged in this save
    if (entityId && stagedLogoFile) {
      const formData = new FormData();
      formData.append('logo', stagedLogoFile);
      const logoRes = await fetchJson(`/api/business-entities/${entityId}/logo`, { method: 'POST', body: formData });
      updatedLogoPath = logoRes && logoRes.logo_path ? String(logoRes.logo_path) : '';
    } else if (entityId && removeLogoFlag && currentLogoPath) {
      await fetchJson(`/api/business-entities/${entityId}/logo`, { method: 'DELETE' });
      updatedLogoPath = '';
    }
    // Realtime: if the edited company is the active workspace, update the header brand
    // marks AND the persisted theme key now, so the new logo survives a refresh without
    // waiting for another page's brand applier to run.
    if (updatedLogoPath !== null) {
      syncActiveWorkspaceLogo(entityId, updatedLogoPath);
    }
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
  bindBusinessEntityLogoControls();
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
