'use strict';

function normalizeTransactionStatusValue(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return ['paid', 'partial', 'unpaid'].includes(normalized) ? normalized : '';
}

function mapTransactionToReceivableStatus(type, amount, downpayment, archived, status = '') {
  if (Number(archived || 0) === 1 || type !== 'invoice') return 'cancelled';
  const total = Number(amount || 0);
  const paid = Number(downpayment || 0);
  if (total > 0 && paid >= total) return 'paid';
  if (paid > 0) return 'partial';
  return 'sent';
}

function calculateReceivableStatus(totalAmount, paidAmount, dueDate, archived = 0) {
  const total = Number(totalAmount || 0);
  const paid = Number(paidAmount || 0);
  if (Number(archived || 0) === 1) return 'cancelled';
  if (total <= 0) return 'draft';
  if (paid >= total) return 'paid';
  if (paid > 0) return 'partial';

  if (dueDate) {
    const due = new Date(dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!Number.isNaN(due.getTime())) {
      due.setHours(0, 0, 0, 0);
      if (due < today) return 'overdue';
    }
  }

  return 'sent';
}

function mapReceivableToTransactionStatus(totalAmount, paidAmount) {
  const total = Number(totalAmount || 0);
  const paid = Number(paidAmount || 0);
  if (total <= 0) return 'unpaid';
  if (paid >= total) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

function normalizeReceivableStatusValue(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return ['draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled'].includes(normalized)
    ? normalized
    : 'draft';
}

function calculatePayableStatus(totalAmount, paidAmount) {
  const total = Number(totalAmount || 0);
  const paid = Number(paidAmount || 0);
  if (total <= 0) return 'draft';
  if (paid >= total) return 'paid';
  if (paid > 0) return 'partially_paid';
  return 'pending';
}

module.exports = {
  normalizeTransactionStatusValue,
  mapTransactionToReceivableStatus,
  calculateReceivableStatus,
  mapReceivableToTransactionStatus,
  normalizeReceivableStatusValue,
  calculatePayableStatus
};
