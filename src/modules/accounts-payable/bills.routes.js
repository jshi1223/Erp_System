// Accounts Payable — bills (vendor invoices) routes.
// Extracted from server.js (step 9 — see src/ARCHITECTURE.md). Staff file DFT- draft bills that
// become official BILL- numbers on approval; PDFs attach via multer; every change re-syncs the
// payable balance + journal. Shared infra imported; multer upload, upload dir, document-number,
// finance, notification and PDF helpers injected.
const express = require('express');
const path = require('path');
const fs = require('fs');
const { db, queryAsync, isPostgresUniqueViolation, isPostgresUndefinedTable, isPostgresUndefinedColumn } = require('../../database');
const { protectAdmin, protectAdminOnly, getAuthenticatedUser, isStaffRole } = require('../../middleware/auth');

module.exports = function createBillsRouter(deps) {
  const {
    upload,
    UPLOAD_DIR,
    resolveBusinessEntityId,
    isDraftDocumentNo,
    generateNextDraftEntityDocumentNo,
    generateNextEntityDocumentNo,
    peekNextDraftEntityDocumentNo,
    peekNextEntityDocumentNo,
    claimEntityDocumentNo,
    sendBackgroundNotification,
    notifyBillApprovalRequest,
    syncPayableBalance,
    postApprovedBillJournal,
    sendBillPdf,
    getApprovalActorName,
    getApprovalComment,
    appendApprovalComment,
    notifyFinanceApproval,
    getApprovalActorLabel,
    logAction
  } = deps;
  const router = express.Router();

  router.get('/api/bills/next-number', protectAdmin, async (req, res) => {
    try {
      const businessEntityId = await resolveBusinessEntityId(req.query.business_entity_id);
      // Admin bills get an official BILL- number; staff drafts preview the DFT- number.
      const actor = getAuthenticatedUser(req) || {};
      const bill_number = isStaffRole(actor.role)
        ? await peekNextDraftEntityDocumentNo({
            businessEntityId,
            documentType: 'ap-bill',
            prefix: 'BILL',
            tableName: 'accounts_payable',
            columnName: 'bill_number'
          })
        : await peekNextEntityDocumentNo({
            businessEntityId,
            documentType: 'ap-bill',
            prefix: 'BILL',
            tableName: 'accounts_payable',
            columnName: 'bill_number'
          });
      res.json({ bill_number });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to generate bill number.' });
    }
  });

  router.get('/api/bills', protectAdmin, (req, res) => {
    db.query(`
      SELECT ap.*, p.project_docno, p.project_name, COALESCE(p.is_archived, FALSE) AS project_is_archived, v.vendor_name, po.po_number,
             gr.grn_number AS bill_grn_number,
             be.company_name AS business_entity_name, be.entity_code AS business_entity_code
      FROM accounts_payable ap
      LEFT JOIN projects p ON p.id = ap.project_id
      LEFT JOIN vendors v ON v.id = ap.vendor_id
      LEFT JOIN purchase_orders po ON po.id = ap.po_id
      LEFT JOIN goods_receipts gr ON gr.id = ap.grn_id
      LEFT JOIN business_entities be ON be.id = ap.business_entity_id
      ORDER BY COALESCE(ap.bill_date, ap.created_at) DESC, ap.created_at DESC
    `, (err, rows) => {
      if (err) {
        console.error('Load bills error:', err);
        if ((isPostgresUndefinedTable(err) || isPostgresUndefinedColumn(err))) {
          return res.json([]);
        }
        return res.status(500).json({ error: err.message || 'Unable to load bills.' });
      }
      res.json(Array.isArray(rows) ? rows : []);
    });
  });

  router.post('/api/bills', protectAdmin, upload.single('pdf_file'), async (req, res) => {
    const { bill_date, due_date, notes } = req.body;
    let billNumber = String(req.body.bill_number || '').trim();
    const poId = Number(req.body.po_id || 0) || null;
    const grnId = Number(req.body.grn_id || 0) || null;
    let vendorId = Number(req.body.vendor_id || 0) || null;
    let businessEntityId = Number(req.body.business_entity_id || 0) || null;
    let projectId = Number(req.body.project_id || 0) || null;
    let totalAmount = Number(req.body.total_amount || 0) || 0;
    const pdfFilename = req.file ? req.file.filename : null;

    try {
      if (poId) {
        const poRows = await queryAsync('SELECT id, business_entity_id, vendor_id, project_id, total_amount FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
        if (!poRows.length) return res.status(400).json({ error: 'Selected purchase order was not found.' });
        businessEntityId = businessEntityId || Number(poRows[0].business_entity_id || 0) || null;
        vendorId = vendorId || Number(poRows[0].vendor_id || 0) || null;
        projectId = projectId || Number(poRows[0].project_id || 0) || null;
        totalAmount = totalAmount || Number(poRows[0].total_amount || 0) || 0;

        // Over-billing + 3-way-match guard (authoritative — protects even direct API calls):
        // the sum of bills against a PO can never exceed what's been RECEIVED (received_qty ×
        // unit cost). If nothing has been received yet, fall back to the PO total. This stops
        // paying for more than was ordered, and more than was actually delivered.
        const guardLines = await queryAsync('SELECT quantity, unit_price, received_qty FROM po_line_items WHERE po_id = ?', [poId]);
        const poTotal = (guardLines || []).reduce((s, l) => s + (Number(l.quantity || 0) * Number(l.unit_price || 0)), 0) || Number(poRows[0].total_amount || 0) || 0;
        const receivedValue = (guardLines || []).reduce((s, l) => s + (Number(l.received_qty || 0) * Number(l.unit_price || 0)), 0);
        const billedRows = await queryAsync('SELECT COALESCE(SUM(total_amount), 0) AS billed FROM accounts_payable WHERE po_id = ?', [poId]);
        const alreadyBilled = Number(billedRows?.[0]?.billed || 0) || 0;
        const billableLimit = receivedValue > 0 ? receivedValue : poTotal;
        if (alreadyBilled + totalAmount > billableLimit + 0.005) {
          const remaining = Math.max(0, billableLimit - alreadyBilled);
          const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return res.status(400).json({
            error: receivedValue > 0
              ? `Bill exceeds what was received on this PO (3-way match). Received value: ${peso(receivedValue)}, already billed: ${peso(alreadyBilled)} — you can still bill up to ${peso(remaining)}. Receive more goods first if you need to bill more.`
              : `Bill exceeds the PO total. PO total: ${peso(poTotal)}, already billed: ${peso(alreadyBilled)} — you can still bill up to ${peso(remaining)}.`
          });
        }
      }

      if (!vendorId || !bill_date || !totalAmount) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      businessEntityId = await resolveBusinessEntityId(businessEntityId);
      // Admins create bills with an official BILL- number directly; staff file a
      // DFT- draft that becomes official when approved (see /bills/:id/approve).
      const billActor = getAuthenticatedUser(req) || {};
      if (isStaffRole(billActor.role)) {
        if (!billNumber || !isDraftDocumentNo(billNumber)) {
          billNumber = await generateNextDraftEntityDocumentNo({
            businessEntityId,
            documentType: 'ap-bill',
            prefix: 'BILL',
            tableName: 'accounts_payable',
            columnName: 'bill_number'
          });
        }
      } else {
        billNumber = await generateNextEntityDocumentNo({
          businessEntityId,
          documentType: 'ap-bill',
          prefix: 'BILL',
          tableName: 'accounts_payable',
          columnName: 'bill_number'
        });
      }

      if (projectId) {
        const projectRows = await queryAsync('SELECT id FROM projects WHERE id = ? LIMIT 1', [projectId]);
        if (!projectRows.length) return res.status(400).json({ error: 'Selected project was not found.' });
      }

      const result = await queryAsync(
        'INSERT INTO accounts_payable (business_entity_id, vendor_id, bill_number, bill_date, due_date, project_id, po_id, grn_id, total_amount, approval_status, notes, pdfFilename) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [businessEntityId, vendorId, billNumber, bill_date, due_date || null, projectId, poId, grnId, totalAmount, 'pending', notes || null, pdfFilename]
      );
      await claimEntityDocumentNo({
        businessEntityId,
        documentType: 'ap-bill',
        prefix: 'BILL',
        documentNo: billNumber
      });
      sendBackgroundNotification(() => notifyBillApprovalRequest(req, result.insertId), 'ap bill approval request email');
      res.json({ id: result.insertId, project_id: projectId, po_id: poId });
    } catch (err) {
      if (isPostgresUniqueViolation(err)) {
        return res.status(409).json({ error: 'Bill number already exists' });
      }
      console.error('Create bill error:', err);
      res.status(500).json({ error: err.message || 'Unable to save bill.' });
    }
  });

  router.put('/api/bills/:id', protectAdmin, upload.single('pdf_file'), async (req, res) => {
    const billId = Number(req.params.id || 0);
    const { bill_number, bill_date, due_date, notes } = req.body;
    const poId = Number(req.body.po_id || 0) || null;
    let vendorId = Number(req.body.vendor_id || 0) || null;
    let businessEntityId = Number(req.body.business_entity_id || 0) || null;
    let projectId = Number(req.body.project_id || 0) || null;
    let totalAmount = Number(req.body.total_amount || 0) || 0;
    const removePdf = String(req.body.remove_pdf || '') === '1';
    const uploadedPdf = req.file ? req.file.filename : null;

    const cleanupUploadedPdf = () => {
      if (!uploadedPdf) return;
      const filePath = path.join(UPLOAD_DIR, path.basename(uploadedPdf));
      fs.unlink(filePath, () => {});
    };

    try {
      if (!billId) {
        cleanupUploadedPdf();
        return res.status(400).json({ error: 'Invalid bill id' });
      }
      if (poId) {
        const poRows = await queryAsync('SELECT id, business_entity_id, vendor_id, project_id, total_amount FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
        if (!poRows.length) {
          cleanupUploadedPdf();
          return res.status(400).json({ error: 'Selected purchase order was not found.' });
        }
        businessEntityId = businessEntityId || Number(poRows[0].business_entity_id || 0) || null;
        vendorId = vendorId || Number(poRows[0].vendor_id || 0) || null;
        projectId = projectId || Number(poRows[0].project_id || 0) || null;
        totalAmount = totalAmount || Number(poRows[0].total_amount || 0) || 0;

        // Same over-billing + 3-way-match guard as POST, but exclude THIS bill from the tally.
        const guardLines = await queryAsync('SELECT quantity, unit_price, received_qty FROM po_line_items WHERE po_id = ?', [poId]);
        const poTotal = (guardLines || []).reduce((s, l) => s + (Number(l.quantity || 0) * Number(l.unit_price || 0)), 0) || Number(poRows[0].total_amount || 0) || 0;
        const receivedValue = (guardLines || []).reduce((s, l) => s + (Number(l.received_qty || 0) * Number(l.unit_price || 0)), 0);
        const billedRows = await queryAsync('SELECT COALESCE(SUM(total_amount), 0) AS billed FROM accounts_payable WHERE po_id = ? AND id != ?', [poId, billId]);
        const alreadyBilled = Number(billedRows?.[0]?.billed || 0) || 0;
        const billableLimit = receivedValue > 0 ? receivedValue : poTotal;
        if (alreadyBilled + totalAmount > billableLimit + 0.005) {
          cleanupUploadedPdf();
          const remaining = Math.max(0, billableLimit - alreadyBilled);
          const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return res.status(400).json({
            error: receivedValue > 0
              ? `Bill exceeds what was received on this PO (3-way match). Received value: ${peso(receivedValue)}, billed by other bills: ${peso(alreadyBilled)} — max for this bill: ${peso(remaining)}.`
              : `Bill exceeds the PO total. PO total: ${peso(poTotal)}, billed by other bills: ${peso(alreadyBilled)} — max for this bill: ${peso(remaining)}.`
          });
        }
      }

      if (!vendorId || !bill_number || !bill_date || !totalAmount) {
        cleanupUploadedPdf();
        return res.status(400).json({ error: 'Missing required fields' });
      }
      businessEntityId = await resolveBusinessEntityId(businessEntityId);

      const existingRows = await queryAsync(
        'SELECT id, pdfFilename, approval_status FROM accounts_payable WHERE id = ? LIMIT 1',
        [billId]
      );
      if (!existingRows.length) {
        cleanupUploadedPdf();
        return res.status(404).json({ error: 'Bill not found.' });
      }
      // An approved bill is locked — editing it would change figures that are already in the
      // ledger / payable balance. Reject (authoritative, even via direct API).
      if (String(existingRows[0].approval_status || '').trim().toLowerCase() === 'approved') {
        cleanupUploadedPdf();
        return res.status(409).json({ error: 'This bill is already approved and can no longer be edited.' });
      }

      if (projectId) {
        const projectRows = await queryAsync('SELECT id FROM projects WHERE id = ? LIMIT 1', [projectId]);
        if (!projectRows.length) {
          cleanupUploadedPdf();
          return res.status(400).json({ error: 'Selected project was not found.' });
        }
      }

      const currentPdf = String(existingRows[0].pdfFilename || '').trim() || null;
      const nextPdf = uploadedPdf || (removePdf ? null : currentPdf);
      await queryAsync(
        `UPDATE accounts_payable
         SET business_entity_id = ?, vendor_id = ?, bill_number = ?, bill_date = ?, due_date = ?, project_id = ?, po_id = ?,
             total_amount = ?, approval_status = 'pending', approved_by = NULL, approved_at = NULL, notes = ?, pdfFilename = ?
         WHERE id = ?`,
        [businessEntityId, vendorId, bill_number, bill_date, due_date || null, projectId, poId, totalAmount, notes || null, nextPdf, billId]
      );
      await syncPayableBalance(billId);
      await postApprovedBillJournal(billId);

      if (currentPdf && currentPdf !== nextPdf && (uploadedPdf || removePdf)) {
        const oldPath = path.join(UPLOAD_DIR, path.basename(currentPdf));
        fs.unlink(oldPath, () => {});
      }

      sendBackgroundNotification(() => notifyBillApprovalRequest(req, billId), 'ap bill approval request email');
      res.json({ id: billId, project_id: projectId, po_id: poId });
    } catch (err) {
      cleanupUploadedPdf();
      if (isPostgresUniqueViolation(err)) {
        return res.status(409).json({ error: 'Bill number already exists' });
      }
      console.error('Update bill error:', err);
      res.status(500).json({ error: err.message || 'Unable to update bill.' });
    }
  });

  router.get('/api/bills/:id/pdf', protectAdmin, (req, res) => {
    sendBillPdf(req, res, req.params.id);
  });

  router.post('/api/bills/:id/approve', protectAdminOnly, async (req, res) => {
    const billId = Number(req.params.id || 0);
    if (!billId) return res.status(400).json({ error: 'Invalid bill id' });

    try {
      const rows = await queryAsync(
        'SELECT id, bill_number, business_entity_id, approval_status FROM accounts_payable WHERE id = ? LIMIT 1',
        [billId]
      );
      if (!rows.length) {
        return res.status(404).json({ error: 'Bill not found.' });
      }

      const approvedBy = getApprovalActorName(req);
      const comment = getApprovalComment(req);
      // Convert the DFT- draft bill number into the official BILL- number on approval.
      const officialBillNo = isDraftDocumentNo(rows[0].bill_number)
        ? await generateNextEntityDocumentNo({
            businessEntityId: rows[0].business_entity_id,
            documentType: 'ap-bill',
            prefix: 'BILL',
            tableName: 'accounts_payable',
            columnName: 'bill_number'
          })
        : rows[0].bill_number;
      if (officialBillNo !== rows[0].bill_number) {
        await claimEntityDocumentNo({
          businessEntityId: rows[0].business_entity_id,
          documentType: 'ap-bill',
          prefix: 'BILL',
          documentNo: officialBillNo
        });
      }
      await queryAsync(
        "UPDATE accounts_payable SET bill_number = ?, approval_status = 'approved', approved_by = ?, approved_at = COALESCE(approved_at, NOW()), approval_comment = ? WHERE id = ?",
        [officialBillNo, approvedBy, comment || null, billId]
      );
      await syncPayableBalance(billId);
      await postApprovedBillJournal(billId);
      logAction(req, 'APPROVE_AP_BILL', appendApprovalComment(`Approved AP bill ${officialBillNo || billId} (Draft ${rows[0].bill_number || '-'})`, comment));
      sendBackgroundNotification(() => notifyFinanceApproval(req, 'bill', billId, {
        approvedBy: getApprovalActorLabel(req)
      }), 'ap bill approved email');
      res.json({ success: true, approval_status: 'approved', bill_number: officialBillNo, approved_by: approvedBy, approval_comment: comment });
    } catch (err) {
      console.error('Approve AP bill error:', err);
      res.status(500).json({ error: err.message || 'Unable to approve AP bill.' });
    }
  });

  router.post('/api/bills/:id/reject', protectAdminOnly, async (req, res) => {
    const billId = Number(req.params.id || 0);
    const reason = String(req.body?.reason || '').trim();
    if (!billId) return res.status(400).json({ error: 'Invalid bill id' });
    if (!reason) return res.status(400).json({ error: 'Rejection reason is required.' });

    try {
      const rows = await queryAsync(
        'SELECT id, bill_number, notes FROM accounts_payable WHERE id = ? LIMIT 1',
        [billId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Bill not found.' });

      const actor = getApprovalActorName(req);
      const notes = [rows[0].notes, `Rejected by ${actor}: ${reason}`].filter(Boolean).join('\n');
      await queryAsync(
        "UPDATE accounts_payable SET approval_status = 'rejected', approved_by = ?, approved_at = COALESCE(approved_at, NOW()), notes = ?, approval_comment = ? WHERE id = ?",
        [actor, notes, reason, billId]
      );
      await syncPayableBalance(billId);
      logAction(req, 'REJECT_AP_BILL', `Rejected AP bill ${rows[0].bill_number || billId} | Reason: ${reason}`);
      res.json({ success: true, approval_status: 'rejected', reason });
    } catch (err) {
      console.error('Reject AP bill error:', err);
      res.status(500).json({ error: err.message || 'Unable to reject AP bill.' });
    }
  });

  return router;
};
