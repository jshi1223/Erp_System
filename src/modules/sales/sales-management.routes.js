// Sales Management — unified sales records (SI / SQ / SO / DR) + invoice generation + approval.
// Extracted from server.js (step 12 — see src/ARCHITECTURE.md). Records flow through the
// project-centric chain SI -> SQ -> SO -> DR -> AR with server-side auto-advance; staff file DFT-
// drafts that become official on approval. Shared infra imported; the large set of sales-flow,
// document-number, inventory-sync, transaction and approval helpers (plus SALES_RECORD_TYPES) injected.
const express = require('express');
const { queryAsync, isPostgresUniqueViolation } = require('../../database');
const { protectAdmin, protectAdminOnly, getAuthenticatedUser, isStaffRole } = require('../../middleware/auth');

module.exports = function createSalesManagementRouter(deps) {
  const {
    SALES_RECORD_TYPES,
    normalizeSalesRecordType,
    normalizeSalesRecordPayload,
    normalizeSalesRecordStatus,
    getSalesDocumentSequenceMeta,
    validateSalesRecordStageRequirements,
    validateSalesDeliveryReceiptInventory,
    resolveBusinessEntityId,
    peekNextDraftEntityDocumentNo,
    peekNextEntityDocumentNo,
    generateNextDraftEntityDocumentNo,
    generateNextEntityDocumentNo,
    claimEntityDocumentNo,
    isDraftDocumentNo,
    withDbTransaction,
    queryDbAsync,
    saveSalesRecordItems,
    syncSalesRecordInventory,
    syncDeliverySerialUnits,
    advanceSalesRecordFlow,
    createReceivableFromDeliveryRecord,
    getApprovalComment,
    getApprovalActorName,
    appendApprovalComment,
    logAction
  } = deps;
  const router = express.Router();

  router.get('/api/sales-management/records', protectAdmin, async (req, res) => {
    const recordType = normalizeSalesRecordType(req.query.type);
    const where = recordType ? 'WHERE smr.record_type = ?' : '';
    const params = recordType ? [recordType] : [];

    try {
      const rows = await queryAsync(`
        SELECT
          smr.*,
          c.company_name,
          c.company_no,
          p.project_name,
          p.project_docno,
          prod.product_name,
          prod.sku,
          wh.warehouse_name,
          wh.warehouse_code,
          src.document_no AS source_document_no,
          src.title AS source_title,
          po.po_number AS source_po_number,
          COALESCE((
            SELECT json_agg(json_build_object(
              'id', i.id, 'product_id', i.product_id, 'warehouse_id', i.warehouse_id,
              'description', i.description, 'item_name', i.description,
              'quantity', i.quantity, 'unit_price', i.unit_price, 'line_total', i.line_total
            ) ORDER BY i.id)
            FROM sales_record_items i WHERE i.sales_record_id = smr.id
          ), '[]') AS line_items,
          ar_inv.id AS ar_invoice_id,
          ar_inv.invoice_number AS ar_invoice_number,
          ar_inv.status AS ar_invoice_status
        FROM sales_management_records smr
        LEFT JOIN company_registry c ON c.id = smr.company_id
        LEFT JOIN projects p ON p.id = smr.project_id
        LEFT JOIN products prod ON prod.id = smr.product_id
        LEFT JOIN warehouses wh ON wh.id = smr.warehouse_id
        LEFT JOIN sales_management_records src ON src.id = smr.source_record_id
        LEFT JOIN purchase_orders po ON po.id = smr.source_po_id
        LEFT JOIN accounts_receivable ar_inv ON ar_inv.sales_record_id = smr.id AND COALESCE(ar_inv.archived, FALSE) = FALSE
        ${where}
        ORDER BY smr.created_at DESC, smr.id DESC
      `, params);
      res.json(rows);
    } catch (err) {
      console.error('Sales records list error:', err);
      res.status(500).json({ error: err.message || 'Unable to load sales records.' });
    }
  });

  router.get('/api/sales-management/records/next-number', protectAdmin, async (req, res) => {
    try {
      const recordType = normalizeSalesRecordType(req.query.record_type) || 'sales-request';
      const seqMeta = getSalesDocumentSequenceMeta(recordType);
      const businessEntityId = await resolveBusinessEntityId(req.query.business_entity_id);
      // Staff see a DFT- draft preview (their record is created as a draft awaiting
      // approval); admins see the official next number they will claim on save.
      const actor = getAuthenticatedUser(req) || {};
      const document_no = isStaffRole(actor.role)
        ? await peekNextDraftEntityDocumentNo({
            businessEntityId,
            documentType: seqMeta.documentType,
            prefix: seqMeta.prefix,
            tableName: 'sales_management_records',
            columnName: 'document_no'
          })
        : await peekNextEntityDocumentNo({
            businessEntityId,
            documentType: seqMeta.documentType,
            prefix: seqMeta.prefix,
            tableName: 'sales_management_records',
            columnName: 'document_no'
          });
      res.json({ document_no, record_type: recordType });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to generate sales document number.' });
    }
  });

  router.post('/api/sales-management/records', protectAdmin, async (req, res) => {
    try {
      const payload = normalizeSalesRecordPayload(req.body);
      validateSalesRecordStageRequirements(payload);
      validateSalesDeliveryReceiptInventory(payload, req.body.items);
      // Staff create "requests" awaiting approval: they get a DFT- draft number and
      // are limited to draft/submitted. Admins create official, ready records directly.
      const actor = getAuthenticatedUser(req) || {};
      const actorIsStaff = isStaffRole(actor.role);
      if (actorIsStaff && !['draft', 'submitted'].includes(payload.status)) {
        payload.status = 'draft';
      }
      const created = await withDbTransaction(async (connection) => {
        // Guard: one source advances to exactly one next-stage doc. Block creating a duplicate
        // sibling (same source + record_type) so we never strand an orphan draft — e.g. an
        // auto-created SO draft sitting alongside a manually-created SO from the same Sales Request.
        if (payload.sourceRecordId) {
          const dup = await queryDbAsync(connection,
            "SELECT id, document_no FROM sales_management_records WHERE source_record_id = ? AND record_type = ? AND COALESCE(status, '') <> 'cancelled' ORDER BY id ASC LIMIT 1",
            [payload.sourceRecordId, payload.recordType]);
          if (dup.length) {
            const dupErr = new Error(`May ${SALES_RECORD_TYPES[payload.recordType]?.label || 'record'} na (${dup[0].document_no}) para sa source na ito. I-edit na lang iyon sa halip na gumawa ng duplicate.`);
            dupErr.statusCode = 409;
            throw dupErr;
          }
        }
        const seqMeta = getSalesDocumentSequenceMeta(payload.recordType);
        const businessEntityId = await resolveBusinessEntityId(payload.businessEntityId);
        const documentNo = actorIsStaff
          ? await generateNextDraftEntityDocumentNo({
              businessEntityId,
              documentType: seqMeta.documentType,
              prefix: seqMeta.prefix,
              tableName: 'sales_management_records',
              columnName: 'document_no',
              dbClient: connection
            })
          : await generateNextEntityDocumentNo({
              businessEntityId,
              documentType: seqMeta.documentType,
              prefix: seqMeta.prefix,
              tableName: 'sales_management_records',
              columnName: 'document_no',
              dbClient: connection
            });
        const insertResult = await queryDbAsync(connection, `
          INSERT INTO sales_management_records (
            record_type, document_no, business_entity_id, company_id, project_id, source_record_id,
            product_id, warehouse_id, quantity, unit_price,
            title, description, requested_date, target_date, amount, status, contact_person,
            payment_terms, notes, created_by,
            quote_validity, downpayment, customer_po_ref, received_by, delivery_address, source_po_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          payload.recordType,
          documentNo,
          businessEntityId,
          payload.companyId,
          payload.projectId,
          payload.sourceRecordId,
          payload.productId,
          payload.warehouseId,
          payload.quantity,
          payload.unitPrice,
          payload.title,
          payload.description,
          payload.requestedDate,
          payload.targetDate,
          payload.amount,
          payload.status,
          payload.contactPerson,
          payload.paymentTerms,
          payload.notes,
          getAuthenticatedUser(req)?.id || null,
          payload.quoteValidity,
          payload.downpayment,
          payload.customerPoRef,
          payload.receivedBy,
          payload.deliveryAddress,
          payload.sourcePoId
        ]);
        // Official admin numbers and staff draft numbers are reserved by their
        // respective generators inside this transaction.
        await saveSalesRecordItems(connection, insertResult.insertId, req.body.items);
        await syncSalesRecordInventory(insertResult.insertId, req, connection);
        await syncDeliverySerialUnits(connection, insertResult.insertId, req.body.serial_unit_ids, req);
        // Auto-advance the project-centric sales flow (SI -> SQ -> SO -> DR -> AR).
        await advanceSalesRecordFlow(connection, Number(insertResult?.insertId || 0) || 0, req);
        const rows = await queryDbAsync(connection, 'SELECT * FROM sales_management_records WHERE id = ? OR document_no = ? ORDER BY id DESC LIMIT 1', [
          Number(insertResult?.insertId || 0) || 0,
          documentNo
        ]);
        return rows[0] || { success: true, document_no: documentNo };
      });
      logAction(req, 'CREATE_SALES_RECORD', `Created ${SALES_RECORD_TYPES[payload.recordType].label}: ${created.document_no || 'sales record'}`, 'sales');
      res.status(201).json(created);
    } catch (err) {
      console.error('Create sales record error:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Unable to create sales record.' });
    }
  });

  router.put('/api/sales-management/records/:id', protectAdmin, async (req, res) => {
    const recordId = Number(req.params.id || 0);
    if (!recordId) return res.status(400).json({ error: 'Invalid sales record ID.' });

    try {
      const existing = await queryAsync('SELECT id, record_type, document_no FROM sales_management_records WHERE id = ? LIMIT 1', [recordId]);
      if (!existing.length) return res.status(404).json({ error: 'Sales record not found.' });
      const payload = normalizeSalesRecordPayload(req.body, existing[0].record_type);
      validateSalesRecordStageRequirements(payload);
      validateSalesDeliveryReceiptInventory(payload, req.body.items);
      // Staff may only keep a record as draft or submit it for approval — never self-approve.
      const actor = getAuthenticatedUser(req) || {};
      if (isStaffRole(actor.role) && !['draft', 'submitted'].includes(payload.status)) {
        payload.status = 'draft';
      }
      const updated = await withDbTransaction(async (connection) => {
        const rows = await queryDbAsync(connection, `
          UPDATE sales_management_records
          SET record_type = ?,
              business_entity_id = ?,
              company_id = ?,
              project_id = ?,
              source_record_id = ?,
              product_id = ?,
              warehouse_id = ?,
              quantity = ?,
              unit_price = ?,
              title = ?,
              description = ?,
              requested_date = ?,
              target_date = ?,
              amount = ?,
              status = ?,
              contact_person = ?,
              payment_terms = ?,
              notes = ?,
              quote_validity = ?,
              downpayment = ?,
              customer_po_ref = ?,
              received_by = ?,
              delivery_address = ?,
              source_po_id = ?,
              updated_at = NOW()
          WHERE id = ?
          RETURNING *
        `, [
          payload.recordType,
          payload.businessEntityId,
          payload.companyId,
          payload.projectId,
          payload.sourceRecordId,
          payload.productId,
          payload.warehouseId,
          payload.quantity,
          payload.unitPrice,
          payload.title,
          payload.description,
          payload.requestedDate,
          payload.targetDate,
          payload.amount,
          payload.status,
          payload.contactPerson,
          payload.paymentTerms,
          payload.notes,
          payload.quoteValidity,
          payload.downpayment,
          payload.customerPoRef,
          payload.receivedBy,
          payload.deliveryAddress,
          payload.sourcePoId,
          recordId
        ]);
        await saveSalesRecordItems(connection, recordId, req.body.items);
        await syncSalesRecordInventory(recordId, req, connection);
        await syncDeliverySerialUnits(connection, recordId, req.body.serial_unit_ids, req);
        // Auto-advance the project-centric sales flow (SI -> SQ -> SO -> DR -> AR).
        await advanceSalesRecordFlow(connection, recordId, req);
        return rows[0] || { success: true };
      });
      logAction(req, 'UPDATE_SALES_RECORD', `Updated sales record ${existing[0].document_no}`, 'sales');
      res.json(updated);
    } catch (err) {
      console.error('Update sales record error:', err);
      res.status(err.statusCode || 500).json({ error: err.message || 'Unable to update sales record.' });
    }
  });

  router.post('/api/sales-management/records/:id/generate-invoice', protectAdmin, async (req, res) => {
    const recordId = Number(req.params.id || 0);
    if (!recordId) return res.status(400).json({ error: 'Invalid sales record ID.' });

    try {
      const rows = await queryAsync(`
        SELECT smr.*, c.company_name, p.project_docno, p.project_name
        FROM sales_management_records smr
        LEFT JOIN company_registry c ON c.id = smr.company_id
        LEFT JOIN projects p ON p.id = smr.project_id
        WHERE smr.id = ? LIMIT 1
      `, [recordId]);

      if (!rows.length) return res.status(404).json({ error: 'Sales record not found.' });
      const record = rows[0];

      if (String(record.record_type || '') !== 'project-delivery') {
        return res.status(400).json({ error: 'Invoice generation is only available for Delivery Receipts.' });
      }
      const status = normalizeSalesRecordStatus(record.status);
      if (!['delivered', 'completed'].includes(status)) {
        return res.status(400).json({ error: 'Set the Delivery Receipt status to Delivered or Completed first.' });
      }
      if (!(Number(record.amount || 0) > 0)) {
        return res.status(400).json({ error: 'Delivery Receipt has no amount. Please set the amount before generating an invoice.' });
      }
      if (!String(record.company_name || '').trim()) {
        return res.status(400).json({ error: 'Delivery Receipt has no linked customer. Please link a company first.' });
      }

      // Reuse the shared, idempotent AR builder (also used by the auto-sync chain).
      const result = await withDbTransaction((connection) => createReceivableFromDeliveryRecord(connection, record, req));
      if (!result) {
        return res.status(400).json({ error: 'Unable to generate invoice from this Delivery Receipt.' });
      }
      if (result.existing) {
        return res.status(409).json({
          error: `Invoice already generated: ${result.invoice_number}`,
          invoice_id: result.id,
          invoice_number: result.invoice_number
        });
      }

      logAction(req, 'GENERATE_INVOICE', `Generated invoice ${result.invoice_number} from delivery ${record.document_no}`, 'finance');
      res.status(201).json({
        id: result.id,
        invoice_number: result.invoice_number,
        total_amount: Number(record.amount || 0),
        customer_name: String(record.company_name || '').trim()
      });
    } catch (err) {
      if (isPostgresUniqueViolation(err)) {
        return res.status(409).json({ error: 'Invoice number conflict, please try again.' });
      }
      console.error('Generate invoice from delivery error:', err);
      res.status(500).json({ error: err.message || 'Unable to generate invoice.' });
    }
  });

  // Approve a staff-submitted sales request: convert its DFT- draft number into the
  // official sequence number, mark it approved, then advance the SI->SQ->SO->DR->AR flow.
  router.post('/api/sales-management/records/:id/approve', protectAdminOnly, async (req, res) => {
    const recordId = Number(req.params.id || 0);
    if (!recordId) return res.status(400).json({ error: 'Invalid sales record ID.' });

    try {
      const rows = await queryAsync('SELECT id, record_type, document_no, business_entity_id, status FROM sales_management_records WHERE id = ? LIMIT 1', [recordId]);
      if (!rows.length) return res.status(404).json({ error: 'Sales record not found.' });
      const record = rows[0];
      const currentStatus = normalizeSalesRecordStatus(record.status);
      if (currentStatus === 'approved') {
        return res.json({ success: true, status: 'approved', document_no: record.document_no, alreadyApproved: true });
      }
      if (!['draft', 'submitted', 'in_review'].includes(currentStatus)) {
        return res.status(400).json({ error: 'Only submitted sales requests can be approved.' });
      }

      const comment = getApprovalComment(req);
      const approvedBy = getApprovalActorName(req);
      const updated = await withDbTransaction(async (connection) => {
        const seqMeta = getSalesDocumentSequenceMeta(record.record_type);
        const businessEntityId = await resolveBusinessEntityId(record.business_entity_id);
        let officialNo = record.document_no;
        if (isDraftDocumentNo(record.document_no)) {
          officialNo = await generateNextEntityDocumentNo({
            businessEntityId,
            documentType: seqMeta.documentType,
            prefix: seqMeta.prefix,
            tableName: 'sales_management_records',
            columnName: 'document_no',
            dbClient: connection
          });
          await claimEntityDocumentNo({
            businessEntityId,
            documentType: seqMeta.documentType,
            prefix: seqMeta.prefix,
            documentNo: officialNo,
            dbClient: connection
          });
        }
        await queryDbAsync(connection,
          "UPDATE sales_management_records SET document_no = ?, status = 'approved', updated_at = NOW() WHERE id = ?",
          [officialNo, recordId]);
        // Now that it is approved, advance the project-centric flow (auto-creates the next-stage draft).
        await advanceSalesRecordFlow(connection, recordId, req);
        const result = await queryDbAsync(connection, 'SELECT * FROM sales_management_records WHERE id = ? LIMIT 1', [recordId]);
        return result[0] || { success: true, status: 'approved', document_no: officialNo };
      });
      logAction(req, 'APPROVE_SALES_RECORD', appendApprovalComment(`Approved ${SALES_RECORD_TYPES[record.record_type]?.label || 'sales record'} ${updated.document_no || recordId} (Draft ${record.document_no || '-'}) | Approved by ${approvedBy}`, comment), 'sales');
      res.json({ success: true, status: 'approved', document_no: updated.document_no, approved_by: approvedBy });
    } catch (err) {
      console.error('Approve sales record error:', err);
      res.status(500).json({ error: err.message || 'Unable to approve sales record.' });
    }
  });

  // Reject a sales request back to an editable draft so staff can revise & resubmit.
  router.post('/api/sales-management/records/:id/reject', protectAdminOnly, async (req, res) => {
    const recordId = Number(req.params.id || 0);
    const reason = String(req.body?.reason || req.body?.comment || '').trim();
    if (!recordId) return res.status(400).json({ error: 'Invalid sales record ID.' });
    if (!reason) return res.status(400).json({ error: 'Rejection reason is required.' });

    try {
      const rows = await queryAsync('SELECT id, document_no, status, notes FROM sales_management_records WHERE id = ? LIMIT 1', [recordId]);
      if (!rows.length) return res.status(404).json({ error: 'Sales record not found.' });
      const currentStatus = normalizeSalesRecordStatus(rows[0].status);
      if (!['draft', 'submitted', 'in_review'].includes(currentStatus)) {
        return res.status(400).json({ error: 'Only submitted sales requests can be rejected.' });
      }
      const revisedNotes = [`Rejected: ${reason}`, String(rows[0].notes || '').trim()].filter(Boolean).join('\n');
      await queryAsync("UPDATE sales_management_records SET status = 'draft', notes = ?, updated_at = NOW() WHERE id = ?", [revisedNotes, recordId]);
      logAction(req, 'REJECT_SALES_RECORD', `Rejected sales record ${rows[0].document_no} | Reason: ${reason}`, 'sales');
      res.json({ success: true, status: 'draft', reason });
    } catch (err) {
      console.error('Reject sales record error:', err);
      res.status(500).json({ error: err.message || 'Unable to reject sales record.' });
    }
  });

  router.delete('/api/sales-management/records/:id', protectAdminOnly, async (req, res) => {
    const recordId = Number(req.params.id || 0);
    if (!recordId) return res.status(400).json({ error: 'Invalid sales record ID.' });

    try {
      const rows = await queryAsync('SELECT * FROM sales_management_records WHERE id = ? LIMIT 1', [recordId]);
      const result = await withDbTransaction(async (connection) => {
        if (rows[0]?.inventory_movement_id) {
          await queryDbAsync(connection, "UPDATE sales_management_records SET status = 'cancelled' WHERE id = ?", [recordId]);
          await syncSalesRecordInventory(recordId, req, connection);
        }
        return queryDbAsync(connection, 'DELETE FROM sales_management_records WHERE id = ?', [recordId]);
      });
      logAction(req, 'DELETE_SALES_RECORD', `Deleted sales record ${rows[0]?.document_no || recordId}`, 'sales');
      res.json({ success: true, affectedRows: result.affectedRows || 0 });
    } catch (err) {
      console.error('Delete sales record error:', err);
      res.status(500).json({ error: err.message || 'Unable to delete sales record.' });
    }
  });

  return router;
};
