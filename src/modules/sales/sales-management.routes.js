// Sales Management — unified sales records (SI / SQ / SO / DR) + invoice generation + approval.
// Extracted from server.js (step 12 — see src/ARCHITECTURE.md). Records flow through the
// project-centric chain SI -> SQ -> SO -> DR -> AR with server-side auto-advance; staff file DFT-
// drafts that become official on approval. Shared infra imported; the large set of sales-flow,
// document-number, inventory-sync, transaction and approval helpers (plus SALES_RECORD_TYPES) injected.
const express = require('express');
const path = require('path');
const { queryAsync, isPostgresUniqueViolation } = require('../../database');
const { protectAdmin, protectAdminOnly, getAuthenticatedUser, isStaffRole } = require('../../middleware/auth');

// Before→after change set for the audit trail (numbers numerically, Dates as YYYY-MM-DD, else strings).
const auditDiff = (oldVals, newVals) => {
  const disp = (v) => (v == null ? '' : (v instanceof Date ? v.toISOString().slice(0, 10) : v));
  const same = (a, b) => {
    const na = disp(a), nb = disp(b);
    if (String(na).trim() === '' && String(nb).trim() === '') return true;
    const fa = Number(na), fb = Number(nb);
    if (Number.isFinite(fa) && Number.isFinite(fb) && String(na).trim() !== '' && String(nb).trim() !== '') return fa === fb;
    return String(na) === String(nb);
  };
  const changes = [];
  Object.keys(newVals).forEach((f) => {
    if (!same(oldVals ? oldVals[f] : undefined, newVals[f])) {
      changes.push({ field: f, from: disp(oldVals ? oldVals[f] : undefined), to: disp(newVals[f]) });
    }
  });
  return changes;
};

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
    logAction,
    upload,
    UPLOAD_DIR
  } = deps;
  const router = express.Router();

  // ── Partial delivery support ────────────────────────────────────────────────
  // One Sales Order may have MULTIPLE Delivery Receipts (deliver in batches). We
  // track the SO's ordered quantity (sum of its line items, else its header qty)
  // vs the total already delivered (sum of non-cancelled DR quantities) so the UI
  // can show "remaining" and the server can block over-delivery. `q` is a query
  // runner: queryAsync (standalone) or (sql,params)=>queryDbAsync(connection,...).
  async function computeDeliveryProgress(q, soId, excludeDrId = 0) {
    const id = Number(soId || 0);
    if (!id) return { ordered: 0, delivered: 0, remaining: 0 };
    const itemRows = await q('SELECT COALESCE(SUM(quantity), 0) AS qty FROM sales_record_items WHERE sales_record_id = ?', [id]);
    let ordered = Number(itemRows?.[0]?.qty || 0) || 0;
    if (!ordered) {
      const soRows = await q('SELECT quantity FROM sales_management_records WHERE id = ? LIMIT 1', [id]);
      ordered = Math.max(0, Number(soRows?.[0]?.quantity || 0) || 0);
    }
    // Delivered = sum of the LINE-ITEM quantities of every non-cancelled DR of this SO. Line items
    // are what actually post to inventory, so tracking them keeps delivery, stock, and "complete"
    // detection all in agreement (mirrors PO -> Goods Receipt received-qty matching).
    const delRows = await q(
      "SELECT COALESCE(SUM(i.quantity), 0) AS qty FROM sales_record_items i JOIN sales_management_records r ON r.id = i.sales_record_id WHERE r.source_record_id = ? AND r.record_type = 'project-delivery' AND COALESCE(r.status, '') <> 'cancelled' AND r.id <> ?",
      [id, Number(excludeDrId || 0)]);
    const delivered = Number(delRows?.[0]?.qty || 0) || 0;
    return { ordered, delivered, remaining: Math.max(0, ordered - delivered) };
  }

  // Throws a 409 if this delivery would push total delivered past the ordered qty.
  // Only enforced when the SO's ordered qty is known (> 0); otherwise permissive.
  async function assertDeliveryWithinOrdered(q, soId, newQty, excludeDrId = 0) {
    const { ordered, delivered, remaining } = await computeDeliveryProgress(q, soId, excludeDrId);
    if (ordered > 0 && Number(newQty || 0) > remaining) {
      const e = new Error(`Lampas sa natitirang dapat i-deliver. Ordered: ${ordered}, Na-deliver na: ${delivered}, Natitira: ${remaining}.`);
      e.statusCode = 409;
      throw e;
    }
  }

  router.get('/api/sales-management/records/:id/delivery-progress', protectAdmin, async (req, res) => {
    try {
      const soId = Number(req.params.id || 0);
      if (!soId) return res.status(400).json({ error: 'Invalid sales record ID.' });
      res.json(await computeDeliveryProgress(queryAsync, soId, 0));
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to compute delivery progress.' });
    }
  });

  // PDF attachment for a sales record (e.g. a signed Sales Order). Two-step upload from the
  // modal: the record is saved as JSON first, then the PDF is posted here against its id.
  router.post('/api/sales-management/records/:id/pdf', protectAdmin, upload.single('pdf_file'), async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: 'Invalid sales record ID.' });
    if (!req.file) return res.status(400).json({ error: 'No PDF received.' });
    try {
      const rows = await queryAsync('SELECT id, document_no, business_entity_id FROM sales_management_records WHERE id = ? LIMIT 1', [id]);
      if (!rows.length) return res.status(404).json({ error: 'Sales record not found.' });
      await queryAsync('UPDATE sales_management_records SET pdfFilename = ?, updated_at = NOW() WHERE id = ?', [req.file.filename, id]);
      logAction(req, 'ATTACH_SALES_PDF', `Attached PDF to sales record ${rows[0].document_no || ('#' + id)}`, 'sales', { entityType: 'sales_record', entityId: id, businessEntityId: rows[0].business_entity_id });
      res.json({ success: true, pdfFilename: req.file.filename });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to save PDF.' });
    }
  });

  router.get('/api/sales-management/records/:id/pdf', protectAdmin, async (req, res) => {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ error: 'Invalid sales record ID.' });
    try {
      const rows = await queryAsync('SELECT pdfFilename FROM sales_management_records WHERE id = ? LIMIT 1', [id]);
      const stored = rows && rows[0] ? (rows[0].pdffilename || rows[0].pdfFilename) : '';
      const fn = stored ? path.basename(stored) : '';
      if (!fn) return res.status(404).json({ error: 'No PDF attached to this record.' });
      res.type('application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fn)}"`);
      return res.sendFile(path.join(UPLOAD_DIR, fn), (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'PDF file not found.' }); });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to load PDF.' });
    }
  });

  router.get('/api/sales-management/records', protectAdmin, async (req, res) => {
    const recordType = normalizeSalesRecordType(req.query.type);
    // Archive-only policy: hide archived records from the active list unless explicitly asked.
    const includeArchived = String(req.query.include_archived || '') === '1';
    // Scope to the active workspace (business entity) when one is selected; 'all'/blank = no filter.
    const entityRaw = String(req.query.business_entity_id || '').trim().toLowerCase();
    const scopeEntityId = (entityRaw && entityRaw !== 'all') ? (Number(req.query.business_entity_id) || 0) : 0;
    const clauses = [];
    const params = [];
    if (!includeArchived) clauses.push('COALESCE(smr.archived, FALSE) = FALSE');
    if (recordType) { clauses.push('smr.record_type = ?'); params.push(recordType); }
    if (scopeEntityId) { clauses.push('smr.business_entity_id = ?'); params.push(scopeEntityId); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

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
          ar_inv.status AS ar_invoice_status,
          (SELECT pr.pr_number FROM purchase_requisitions pr WHERE pr.source_sales_record_id = smr.id AND COALESCE(pr.status, '') <> 'cancelled' ORDER BY pr.id ASC LIMIT 1) AS generated_pr_number
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
      } else if (!actorIsStaff) {
        // Admin-created Sales Orders route through the Approval Center as pending (submitted),
        // becoming official on approval — NOT auto-approved.
        if (payload.recordType === 'sales-order') {
          payload.status = 'submitted';
        } else if (payload.recordType === 'project-delivery') {
          // A Delivery Receipt posts stock-OUT the moment it's created — mirrors PO -> Goods Receipt
          // (create = receive). So an admin DR is 'delivered' on save: stock is checked + deducted
          // right away, and it never sits as a non-deducting 'approved' doc. Short stock => blocked.
          payload.status = 'delivered';
        } else if (['draft', 'submitted', 'in_review'].includes(payload.status)) {
          payload.status = 'approved';
        }
      }
      const created = await withDbTransaction(async (connection) => {
        // Guard: one source advances to exactly one next-stage doc. Block creating a duplicate
        // sibling (same source + record_type) so we never strand an orphan draft — e.g. an
        // auto-created SO draft sitting alongside a manually-created SO from the same Sales Request.
        // EXCEPTION: Delivery Receipts — one Sales Order may have MULTIPLE partial deliveries,
        // so DRs are not one-to-one; instead they are capped by the ordered quantity below.
        if (payload.sourceRecordId && payload.recordType !== 'project-delivery') {
          const dup = await queryDbAsync(connection,
            "SELECT id, document_no FROM sales_management_records WHERE source_record_id = ? AND record_type = ? AND COALESCE(status, '') <> 'cancelled' ORDER BY id ASC LIMIT 1",
            [payload.sourceRecordId, payload.recordType]);
          if (dup.length) {
            const dupErr = new Error(`May ${SALES_RECORD_TYPES[payload.recordType]?.label || 'record'} na (${dup[0].document_no}) para sa source na ito. I-edit na lang iyon sa halip na gumawa ng duplicate.`);
            dupErr.statusCode = 409;
            throw dupErr;
          }
        }
        // Partial delivery: block a Delivery Receipt whose line items would exceed the SO's remaining qty.
        if (payload.recordType === 'project-delivery' && payload.sourceRecordId) {
          const incomingQty = (Array.isArray(req.body.items) ? req.body.items : []).reduce((s, it) => s + (Number(it.quantity || 0) || 0), 0);
          await assertDeliveryWithinOrdered((sql, params) => queryDbAsync(connection, sql, params), payload.sourceRecordId, incomingQty, 0);
        }
        const seqMeta = getSalesDocumentSequenceMeta(payload.recordType);
        const businessEntityId = await resolveBusinessEntityId(payload.businessEntityId);
        // Staff drafts AND admin-created Sales Orders (pending) get a DFT- number that the
        // Approval Center promotes to the official sequence on approval.
        const documentNo = (actorIsStaff || payload.recordType === 'sales-order')
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
      logAction(req, 'CREATE_SALES_RECORD', `Created ${SALES_RECORD_TYPES[payload.recordType].label}: ${created.document_no || 'sales record'}`, 'sales', { entityType: 'sales_record', entityId: created.id, businessEntityId: created.business_entity_id });
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
      const existing = await queryAsync('SELECT id, record_type, document_no, status, amount, quantity, unit_price, title FROM sales_management_records WHERE id = ? LIMIT 1', [recordId]);
      if (!existing.length) return res.status(404).json({ error: 'Sales record not found.' });
      // Locked once approved or past it — no edits after approval (matches the UI hiding the Edit button).
      if (['approved', 'won', 'sent', 'delivered', 'completed', 'cancelled'].includes(String(existing[0].status || '').toLowerCase())) {
        return res.status(409).json({ error: 'Hindi na puwedeng baguhin ang naka-approve nang record.' });
      }
      const payload = normalizeSalesRecordPayload(req.body, existing[0].record_type);
      validateSalesRecordStageRequirements(payload);
      validateSalesDeliveryReceiptInventory(payload, req.body.items);
      // Staff may only keep a record as draft or submit it for approval — never self-approve.
      const actor = getAuthenticatedUser(req) || {};
      if (isStaffRole(actor.role) && !['draft', 'submitted'].includes(payload.status)) {
        payload.status = 'draft';
      }
      const updated = await withDbTransaction(async (connection) => {
        // Partial delivery: editing a DR's quantity must still respect the SO's remaining
        // (exclude this DR from the already-delivered total).
        if (payload.recordType === 'project-delivery' && payload.sourceRecordId) {
          const incomingQty = (Array.isArray(req.body.items) ? req.body.items : []).reduce((s, it) => s + (Number(it.quantity || 0) || 0), 0);
          await assertDeliveryWithinOrdered((sql, params) => queryDbAsync(connection, sql, params), payload.sourceRecordId, incomingQty, recordId);
        }
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
      const newRow = (updated && updated.id) ? updated : null;
      const salesChanges = newRow ? auditDiff(
        { status: existing[0].status, amount: existing[0].amount, quantity: existing[0].quantity, unit_price: existing[0].unit_price, title: existing[0].title },
        { status: newRow.status, amount: newRow.amount, quantity: newRow.quantity, unit_price: newRow.unit_price, title: newRow.title }
      ) : [];
      logAction(req, 'UPDATE_SALES_RECORD', `Updated sales record ${existing[0].document_no}`, 'sales', { entityType: 'sales_record', entityId: recordId, businessEntityId: newRow ? newRow.business_entity_id : undefined, changes: salesChanges });
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
      // Apply the reviewed values from the Generate Invoice modal (override the DR-derived defaults).
      if (req.body.invoice_date) record.target_date = req.body.invoice_date;
      if (req.body.payment_terms) record.payment_terms = String(req.body.payment_terms).trim();
      if (req.body.total_amount != null && Number(req.body.total_amount) > 0) record.amount = Number(req.body.total_amount);
      if (req.body.notes != null && String(req.body.notes).trim()) record.notes = String(req.body.notes).trim();

      if (!(Number(record.amount || 0) > 0)) {
        return res.status(400).json({ error: 'Delivery Receipt has no amount. Please set the amount before generating an invoice.' });
      }
      if (!String(record.company_name || '').trim()) {
        return res.status(400).json({ error: 'Delivery Receipt has no linked customer. Please link a company first.' });
      }

      // Reuse the shared, idempotent AR builder; honor a custom due date from the modal if given.
      const result = await withDbTransaction(async (connection) => {
        const created = await createReceivableFromDeliveryRecord(connection, record, req);
        if (created && !created.existing && req.body.due_date) {
          await queryDbAsync(connection, 'UPDATE accounts_receivable SET due_date = ? WHERE id = ?', [req.body.due_date, created.id]);
        }
        return created;
      });
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

      logAction(req, 'GENERATE_INVOICE', `Generated invoice ${result.invoice_number} from delivery ${record.document_no}`, 'finance', { entityType: 'ar_invoice', entityId: result.id, businessEntityId: record.business_entity_id });
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
      const approvedDraftDoc = currentStatus === 'approved' && isDraftDocumentNo(record.document_no);
      if (currentStatus === 'approved' && !approvedDraftDoc) {
        return res.json({ success: true, status: 'approved', document_no: record.document_no, alreadyApproved: true });
      }
      if (!approvedDraftDoc && !['draft', 'submitted', 'in_review'].includes(currentStatus)) {
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
      logAction(req, 'APPROVE_SALES_RECORD', appendApprovalComment(`Approved ${SALES_RECORD_TYPES[record.record_type]?.label || 'sales record'} ${updated.document_no || recordId} (Draft ${record.document_no || '-'}) | Approved by ${approvedBy}`, comment), 'sales', { entityType: 'sales_record', entityId: recordId, businessEntityId: record.business_entity_id, changes: [{ field: 'status', from: record.status, to: 'approved' }] });
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
      logAction(req, 'REJECT_SALES_RECORD', `Rejected sales record ${rows[0].document_no} | Reason: ${reason}`, 'sales', { entityType: 'sales_record', entityId: recordId, severity: 'warning', changes: [{ field: 'status', from: rows[0].status, to: 'draft' }] });
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
        // Archive-only policy: soft-archive instead of hard delete so it lands in the Archive Center.
        return queryDbAsync(connection, 'UPDATE sales_management_records SET archived = TRUE, archived_at = NOW(), updated_at = NOW() WHERE id = ?', [recordId]);
      });
      logAction(req, 'ARCHIVE_SALES_RECORD', `Archived sales record ${rows[0]?.document_no || recordId}`, 'sales', { entityType: 'sales_record', entityId: recordId, businessEntityId: rows[0]?.business_entity_id, severity: 'warning' });
      res.json({ success: true, affectedRows: result.affectedRows || 0 });
    } catch (err) {
      console.error('Delete sales record error:', err);
      res.status(500).json({ error: err.message || 'Unable to delete sales record.' });
    }
  });

  return router;
};
