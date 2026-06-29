// Accounts Receivable — receivables (customer invoices) routes.
// List + archive/restore only. AR invoices are CREATED AUTOMATICALLY from the Sales flow
// (Sales Order → "Create AR Invoice" / Delivery Receipt → createReceivableFromDeliveryRecord,
// linked by sales_record_id). The old MANUAL transaction-based create/update endpoints were
// removed together with the retired Transactions feature — see [[transactions-legacy]].
const express = require('express');
const { db, queryAsync } = require('../../database');
const { protectAdmin, protectAdminOnly } = require('../../middleware/auth');

module.exports = function createReceivablesRouter(deps) {
  const { syncReceivableBalance, logAction } = deps;
  const router = express.Router();

  router.get('/api/receivables', protectAdmin, (req, res) => {
    const includeArchived = String(req.query.include_archived || '0') === '1';
    const whereClause = includeArchived ? '' : 'WHERE COALESCE(ar.archived, FALSE) = FALSE';
    db.query(`
      SELECT ar.*, p.project_name, p.project_docno AS linked_project_docno, COALESCE(p.is_archived, FALSE) AS project_is_archived,
             smr.document_no AS source_delivery_no, smr.title AS source_delivery_title
      FROM accounts_receivable ar
      LEFT JOIN projects p ON p.id = ar.project_id
      LEFT JOIN sales_management_records smr ON smr.id = ar.sales_record_id
      ${whereClause}
      ORDER BY ar.invoice_date DESC, ar.created_at DESC
    `, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  router.put('/api/receivables/:id/archive', protectAdminOnly, async (req, res) => {
    const receivableId = Number(req.params.id || 0);
    if (!receivableId) return res.status(400).json({ error: 'Invalid receivable id' });
    try {
      const existingRows = await queryAsync('SELECT invoice_number, status, business_entity_id FROM accounts_receivable WHERE id = ? LIMIT 1', [receivableId]);
      const existing = existingRows && existingRows[0];
      const result = await queryAsync(
        "UPDATE accounts_receivable SET archived = TRUE, archived_at = CURRENT_TIMESTAMP, status = 'cancelled' WHERE id = ?",
        [receivableId]
      );
      await syncReceivableBalance(receivableId);
      if (existing && typeof logAction === 'function') {
        logAction(req, 'ARCHIVE_RECEIVABLE', `Archived receivable ${existing.invoice_number || receivableId}`, 'finance', {
          entityType: 'ar_invoice', entityId: receivableId, businessEntityId: existing.business_entity_id, severity: 'warning',
          changes: [{ field: 'status', from: existing.status, to: 'cancelled' }, { field: 'archived', from: false, to: true }]
        });
      }
      res.json({ success: true, affectedRows: result.affectedRows || 0 });
    } catch (err) {
      console.error('Archive receivable error:', err);
      res.status(500).json({ error: err.message || 'Unable to archive receivable.' });
    }
  });

  router.put('/api/receivables/:id/restore', protectAdminOnly, async (req, res) => {
    const receivableId = Number(req.params.id || 0);
    if (!receivableId) return res.status(400).json({ error: 'Invalid receivable id' });
    try {
      const existingRows = await queryAsync('SELECT invoice_number, business_entity_id FROM accounts_receivable WHERE id = ? LIMIT 1', [receivableId]);
      const existing = existingRows && existingRows[0];
      const result = await queryAsync(
        'UPDATE accounts_receivable SET archived = FALSE, archived_at = NULL WHERE id = ?',
        [receivableId]
      );
      await syncReceivableBalance(receivableId);
      if (existing && typeof logAction === 'function') {
        logAction(req, 'RESTORE_RECEIVABLE', `Restored receivable ${existing.invoice_number || receivableId}`, 'finance', {
          entityType: 'ar_invoice', entityId: receivableId, businessEntityId: existing.business_entity_id,
          changes: [{ field: 'archived', from: true, to: false }]
        });
      }
      res.json({ success: true, affectedRows: result.affectedRows || 0 });
    } catch (err) {
      console.error('Restore receivable error:', err);
      res.status(500).json({ error: err.message || 'Unable to restore receivable.' });
    }
  });

  return router;
};
