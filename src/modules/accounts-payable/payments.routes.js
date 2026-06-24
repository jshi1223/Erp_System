// Accounts Payable / Receivable — payments routes (shared payments table, payment_type ap|ar).
// Extracted from server.js (step 8 — see src/ARCHITECTURE.md). Create/update validate against the
// open balance; AP payments need approval; every change re-syncs balances + journal entries.
// Shared infra imported; server-specific finance/notification helpers injected.
const express = require('express');
const { db, queryAsync } = require('../../database');
const { protectAdmin, protectAdminOnly } = require('../../middleware/auth');

module.exports = function createPaymentsRouter(deps) {
  const {
    normalizePaymentPayload,
    assertPaymentWithinOpenBalance,
    syncPayableBalance,
    syncReceivableBalance,
    postApprovedPaymentJournal,
    deleteAutoJournalEntries,
    sendBackgroundNotification,
    notifyPaymentApprovalRequest,
    notifyFinanceApproval,
    getApprovalActorName,
    getApprovalActorLabel,
    getApprovalComment,
    appendApprovalComment,
    logAction
  } = deps;
  const router = express.Router();

  router.get('/api/payments', protectAdmin, (req, res) => {
    const type = req.query.type || 'ap';
    db.query(
      'SELECT * FROM payments WHERE payment_type = ? ORDER BY payment_date DESC LIMIT 100',
      [type],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
      }
    );
  });

  router.post('/api/payments', protectAdmin, async (req, res) => {
    try {
      const payment = await normalizePaymentPayload(req.body);
      await assertPaymentWithinOpenBalance(payment);
      const approvalStatus = payment.payment_type === 'ap' ? 'pending' : 'approved';
      const result = await queryAsync(
        'INSERT INTO payments (payment_type, ap_id, ar_id, payment_date, amount, payment_method, reference_number, approval_status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [payment.payment_type, payment.ap_id, payment.ar_id, payment.payment_date, payment.amount, payment.payment_method, payment.reference_number, approvalStatus, payment.notes]
      );

      if (payment.payment_type === 'ap' && payment.ap_id) {
        await syncPayableBalance(payment.ap_id);
        await postApprovedPaymentJournal(result.insertId);
        sendBackgroundNotification(() => notifyPaymentApprovalRequest(req, result.insertId), 'ap payment approval request email');
      } else if (payment.payment_type === 'ar' && payment.ar_id) {
        await syncReceivableBalance(payment.ar_id);
        await postApprovedPaymentJournal(result.insertId);
      }

      res.json({ id: result.insertId });
    } catch (err) {
      const validationMessage = String(err?.message || '').toLowerCase();
      if (validationMessage.includes('required') || validationMessage.includes('must') || validationMessage.includes('not found') || validationMessage.includes('approve') || validationMessage.includes('exceeds')) {
        return res.status(400).json({ error: err.message || 'Unable to save payment.' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/api/payments/:id', protectAdmin, async (req, res) => {
    const paymentId = Number(req.params.id || 0);
    if (!paymentId) return res.status(400).json({ error: 'Invalid payment id' });

    try {
      const payment = await normalizePaymentPayload(req.body);
      const existingRows = await queryAsync('SELECT * FROM payments WHERE id = ? LIMIT 1', [paymentId]);
      if (!existingRows.length) {
        return res.status(404).json({ error: 'Payment not found' });
      }
      const existing = existingRows[0];

      await assertPaymentWithinOpenBalance(payment, { excludePaymentId: paymentId });
      await queryAsync(
        'UPDATE payments SET payment_type = ?, ap_id = ?, ar_id = ?, payment_date = ?, amount = ?, payment_method = ?, reference_number = ?, notes = ? WHERE id = ?',
        [payment.payment_type, payment.ap_id, payment.ar_id, payment.payment_date, payment.amount, payment.payment_method, payment.reference_number, payment.notes, paymentId]
      );

      const affectedApIds = new Set();
      const affectedArIds = new Set();
      if (Number(existing.ap_id || 0)) affectedApIds.add(Number(existing.ap_id));
      if (Number(existing.ar_id || 0)) affectedArIds.add(Number(existing.ar_id));
      if (payment.payment_type === 'ap' && Number(payment.ap_id || 0)) affectedApIds.add(Number(payment.ap_id));
      if (payment.payment_type === 'ar' && Number(payment.ar_id || 0)) affectedArIds.add(Number(payment.ar_id));

      await Promise.all([
        ...Array.from(affectedApIds).map((id) => syncPayableBalance(id)),
        ...Array.from(affectedArIds).map((id) => syncReceivableBalance(id))
      ]);
      await postApprovedPaymentJournal(paymentId);

      res.json({ success: true });
    } catch (err) {
      const validationMessage = String(err?.message || '').toLowerCase();
      if (validationMessage.includes('required') || validationMessage.includes('must') || validationMessage.includes('not found') || validationMessage.includes('approve') || validationMessage.includes('exceeds')) {
        return res.status(400).json({ error: err.message || 'Unable to update payment.' });
      }
      console.error('Update payment error:', err);
      res.status(500).json({ error: err.message || 'Unable to update payment.' });
    }
  });

  router.post('/api/payments/:id/approve', protectAdminOnly, async (req, res) => {
    const paymentId = Number(req.params.id || 0);
    if (!paymentId) return res.status(400).json({ error: 'Invalid payment id' });

    try {
      const rows = await queryAsync('SELECT * FROM payments WHERE id = ? LIMIT 1', [paymentId]);
      if (!rows.length) {
        return res.status(404).json({ error: 'Payment not found' });
      }

      const payment = rows[0];
      await assertPaymentWithinOpenBalance({
        payment_type: payment.payment_type,
        ap_id: payment.ap_id,
        ar_id: payment.ar_id,
        amount: payment.amount
      }, { excludePaymentId: paymentId });
      const approvedBy = getApprovalActorName(req);
      const comment = getApprovalComment(req);
      await queryAsync(
        "UPDATE payments SET approval_status = 'approved', approved_by = ?, approved_at = COALESCE(approved_at, NOW()), approval_comment = ? WHERE id = ?",
        [approvedBy, comment || null, paymentId]
      );

      if (Number(payment.ap_id || 0)) {
        await syncPayableBalance(payment.ap_id);
      }
      if (Number(payment.ar_id || 0)) {
        await syncReceivableBalance(payment.ar_id);
      }
      await postApprovedPaymentJournal(paymentId);

      logAction(req, 'APPROVE_PAYMENT', appendApprovalComment(`Approved ${payment.payment_type || 'payment'} payment ID ${paymentId}`, comment));
      sendBackgroundNotification(() => notifyFinanceApproval(req, 'payment', paymentId, {
        approvedBy: getApprovalActorLabel(req)
      }), 'payment approved email');
      res.json({ success: true, approval_status: 'approved', approved_by: approvedBy, approval_comment: comment });
    } catch (err) {
      const validationMessage = String(err?.message || '').toLowerCase();
      if (validationMessage.includes('exceeds') || validationMessage.includes('not found')) {
        return res.status(400).json({ error: err.message || 'Unable to approve payment.' });
      }
      console.error('Approve payment error:', err);
      res.status(500).json({ error: err.message || 'Unable to approve payment.' });
    }
  });

  router.post('/api/payments/:id/reject', protectAdminOnly, async (req, res) => {
    const paymentId = Number(req.params.id || 0);
    const reason = String(req.body?.reason || '').trim();
    if (!paymentId) return res.status(400).json({ error: 'Invalid payment id' });
    if (!reason) return res.status(400).json({ error: 'Rejection reason is required.' });

    try {
      const rows = await queryAsync('SELECT * FROM payments WHERE id = ? LIMIT 1', [paymentId]);
      if (!rows.length) return res.status(404).json({ error: 'Payment not found' });

      const payment = rows[0];
      const actor = getApprovalActorName(req);
      const notes = [payment.notes, `Rejected by ${actor}: ${reason}`].filter(Boolean).join('\n');
      await queryAsync(
        "UPDATE payments SET approval_status = 'rejected', approved_by = ?, approved_at = COALESCE(approved_at, NOW()), notes = ?, approval_comment = ? WHERE id = ?",
        [actor, notes, reason, paymentId]
      );
      if (Number(payment.ap_id || 0)) await syncPayableBalance(payment.ap_id);
      if (Number(payment.ar_id || 0)) await syncReceivableBalance(payment.ar_id);
      logAction(req, 'REJECT_PAYMENT', `Rejected ${payment.payment_type || 'payment'} payment ID ${paymentId} | Reason: ${reason}`);
      sendBackgroundNotification(() => notifyFinanceApproval(req, 'payment', paymentId, {
        decision: 'rejected',
        reason,
        rejectedBy: getApprovalActorLabel(req)
      }), 'payment rejected email');
      res.json({ success: true, approval_status: 'rejected', reason });
    } catch (err) {
      console.error('Reject payment error:', err);
      res.status(500).json({ error: err.message || 'Unable to reject payment.' });
    }
  });

  router.delete('/api/payments/:id', protectAdminOnly, async (req, res) => {
    const paymentId = Number(req.params.id || 0);
    if (!paymentId) return res.status(400).json({ error: 'Invalid payment id' });

    try {
      const existingRows = await queryAsync('SELECT * FROM payments WHERE id = ? LIMIT 1', [paymentId]);
      if (!existingRows.length) {
        return res.status(404).json({ error: 'Payment not found' });
      }
      const existing = existingRows[0];

      await queryAsync('DELETE FROM payments WHERE id = ?', [paymentId]);
      await deleteAutoJournalEntries(
        String(existing.payment_type || '').trim().toLowerCase() === 'ap' ? 'ap_payment' : 'ar_payment',
        paymentId
      );

      if (Number(existing.ap_id || 0)) {
        await syncPayableBalance(existing.ap_id);
      }
      if (Number(existing.ar_id || 0)) {
        await syncReceivableBalance(existing.ar_id);
      }

      res.json({ success: true });
    } catch (err) {
      console.error('Delete payment error:', err);
      res.status(500).json({ error: err.message || 'Unable to delete payment.' });
    }
  });

  return router;
};
