// Pure formatting helpers used by PDFs, emails, and responses.
// Extracted from server.js (step 2 of the backend modularization — see src/ARCHITECTURE.md).
function formatPdfMoney(value) {
  const amount = Number(value || 0) || 0;
  return `PHP ${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPdfDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  return date.toISOString().slice(0, 10);
}

module.exports = { formatPdfMoney, formatPdfDate };
