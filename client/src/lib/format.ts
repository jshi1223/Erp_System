// Input masks shared by the Company / Vendor modals, matching the classic master-data page.

// Keep digits only, capped at maxLen. Strips letters and special characters as you type/paste.
export function digitsOnly(value: string, maxLen = 11): string {
  return String(value || '').replace(/\D/g, '').slice(0, maxLen);
}

// TIN mask: up to 12 digits grouped in 3s with dashes (000-000-000-000), matching formatCompanyTin().
export function formatTin(value: string): string {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 12);
  if (!digits) return '';
  return digits.match(/.{1,3}/g)?.join('-') || digits;
}

// Mirrors src/shared/validation.js isValidEmail so client + server agree.
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}
