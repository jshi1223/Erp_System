// Pure phone/TIN/email validation + normalization helpers.
// Extracted from server.js (step 2 of the backend modularization — see src/ARCHITECTURE.md).
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeTin(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 12);
}

function formatTin(value) {
  const digits = normalizeTin(value);
  if (!digits) return '';
  return digits.match(/.{1,3}/g)?.join('-') || digits;
}

function isValidPhone(value) {
  const phone = String(value || '').trim();
  return /^\d+$/.test(phone) && phone.length >= PHONE_MIN_DIGITS && phone.length <= PHONE_MAX_DIGITS;
}

function isValidCompanyRegistryPhone(value) {
  return /^\d{11}$/.test(String(value || '').trim());
}

function isValidEmail(value) {
  const email = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = {
  PHONE_MIN_DIGITS,
  PHONE_MAX_DIGITS,
  normalizePhone,
  normalizeTin,
  formatTin,
  isValidPhone,
  isValidCompanyRegistryPhone,
  isValidEmail,
};
