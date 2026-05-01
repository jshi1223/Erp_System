'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTransactionStatusValue,
  mapTransactionToReceivableStatus,
  calculateReceivableStatus,
  mapReceivableToTransactionStatus,
  normalizeReceivableStatusValue,
  calculatePayableStatus
} = require('../lib/erp-flow');

test('transaction status normalization stays strict', () => {
  assert.equal(normalizeTransactionStatusValue('Paid'), 'paid');
  assert.equal(normalizeTransactionStatusValue(' partial '), 'partial');
  assert.equal(normalizeTransactionStatusValue('unknown'), '');
});

test('receivable sync maps invoice payments to transaction status', () => {
  assert.equal(mapTransactionToReceivableStatus('invoice', 1000, 1000, 0), 'paid');
  assert.equal(mapTransactionToReceivableStatus('invoice', 1000, 250, 0), 'partial');
  assert.equal(mapTransactionToReceivableStatus('invoice', 1000, 0, 0), 'sent');
  assert.equal(mapTransactionToReceivableStatus('receipt', 1000, 1000, 0), 'cancelled');
});

test('receivable status becomes overdue when unpaid past due date', () => {
  const status = calculateReceivableStatus(1000, 0, '2000-01-01', 0);
  assert.equal(status, 'overdue');
});

test('receivable payment sync drives transaction paid partial unpaid states', () => {
  assert.equal(mapReceivableToTransactionStatus(1000, 1000), 'paid');
  assert.equal(mapReceivableToTransactionStatus(1000, 200), 'partial');
  assert.equal(mapReceivableToTransactionStatus(1000, 0), 'unpaid');
});

test('receivable status validation rejects unknown values', () => {
  assert.equal(normalizeReceivableStatusValue('Paid'), 'paid');
  assert.equal(normalizeReceivableStatusValue('bad-value'), 'draft');
});

test('payable status follows payment balance', () => {
  assert.equal(calculatePayableStatus(1000, 1000), 'paid');
  assert.equal(calculatePayableStatus(1000, 400), 'partially_paid');
  assert.equal(calculatePayableStatus(1000, 0), 'pending');
});
