// Procurement — PR -> RFQ -> PO -> GRN. Extracted from server.js incrementally (step 15+ — see
// src/ARCHITECTURE.md). This router is built up sub-domain by sub-domain; it starts with the
// document-number preview endpoints and grows as each procurement area is extracted. Procurement
// routes are heavily scattered/interleaved in server.js, so blocks are removed in batches and the
// matching routes appended here. Shared infra imported; document-number + flow helpers injected.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { queryAsync, isPostgresUniqueViolation, isPostgresUndefinedTable, isPostgresUndefinedColumn } = require('../../database');
const { protectAdmin, protectAdminOnly, getAuthenticatedUser, isStaffRole, isAdminRole } = require('../../middleware/auth');
const { formatPdfMoney, formatPdfDate } = require('../../shared/format');
const { isValidEmail } = require('../../shared/validation');

module.exports = function createProcurementRouter(deps) {
  const {
    resolveBusinessEntityId,
    peekNextDraftEntityDocumentNo,
    peekNextEntityDocumentNo,
    requisitionRowMatchesStaffActor,
    sendStaffRecordAccessDenied,
    assertStatusTransition,
    getAuthenticatedUserEmail,
    isDraftDocumentNo,
    generateNextEntityDocumentNo,
    generatePurchaseRequisitionPdfFile,
    sendBackgroundNotification,
    notifyApprovalRequest,
    notifyPurchaseRequisitionRequester,
    getApprovalActorName,
    getApprovalActorLabel,
    getApprovalComment,
    appendApprovalComment,
    buildPurchaseOrderPdfAttachment,
    notifyPurchaseOrderRequester,
    notifyPurchaseOrderVendor,
    publicQuotePdfUpload,
    UPLOAD_DIR,
    getManilaYmd,
    toNumber,
    normalizeProcurementWorkflowStatus,
    normalizeQuotationStatus,
    generateNextDraftEntityDocumentNo,
    claimEntityDocumentNo,
    notifyRfqAwardedRequester,
    notifyRfqAwardedVendor,
    isFinalAwardedQuotationStatus,
    buildQuotationPdfAttachment,
    formatPdfStatusLabel,
    normalizeGoodsReceiptProductMappings,
    applyGoodsReceiptProductMappings,
    postInventoryReceiptForPurchaseOrder,
    isPurchaseOrderFullyReceived,
    markPurchaseOrderReceived,
    createSerialUnitsFromReceipt,
    buildPurchaseOrderItemSummary,
    normalizePurchaseRequisitionLineItems,
    resolvePurchaseOrderProjectContext,
    resolvePurchaseRequisitionContext,
    procurementRequisitionIsLocked,
    projectRowMatchesStaffActor,
    normalizePurchaseOrderLineItems,
    resolvePurchaseOrderRequisitionContext,
    resolvePurchaseOrderQuotationContext,
    sanitizePurchaseOrderLineProducts,
    markRequisitionOrdered,
    withDbTransaction,
    connectionQueryAsync,
    parsePurchaseOrderPaymentTerms,
    resolveTermDueDate,
    hasEmailConfig,
    RESEND_API_KEY,
    APP_BASE_URL,
    SMTP_FROM,
    ensureRfqVendorLink,
    buildRfqRequestPdfAttachment,
    sendSystemEmail,
    htmlEscape,
    shouldRegenerateErpPdfFile,
    logAction
  } = deps;
  const router = express.Router();

  // A PR that already has a selected RFQ or a purchase order can no longer be cancelled/deleted.
  async function assertPurchaseRequisitionCanBeVoided(requisitionId) {
    const normalizedRequisitionId = Number(requisitionId || 0) || 0;
    if (!normalizedRequisitionId) throw new Error('Requisition ID is required.');

    const [rfqRows, poRows] = await Promise.all([
      queryAsync(
        "SELECT id, quote_number FROM procurement_quotations WHERE requisition_id = ? AND LOWER(COALESCE(status, '')) = 'selected' LIMIT 1",
        [normalizedRequisitionId]
      ),
      queryAsync(
        'SELECT id, po_number FROM purchase_orders WHERE requisition_id = ? LIMIT 1',
        [normalizedRequisitionId]
      )
    ]);

    if (Array.isArray(rfqRows) && rfqRows.length) {
      throw new Error(`This PR already has an approved RFQ (${rfqRows[0].quote_number || rfqRows[0].id}). Cancel/delete is disabled.`);
    }
    if (Array.isArray(poRows) && poRows.length) {
      throw new Error(`This PR already has a purchase order (${poRows[0].po_number || poRows[0].id}). Cancel/delete is disabled.`);
    }
  }

  router.get('/api/procurement/requisitions/next-number', protectAdmin, async (req, res) => {
    try {
      // The PR number sequence belongs to the project's operating company (PR-KITSI / PR-KVSK).
      // When a project_id is supplied, resolve its entity SERVER-SIDE so the preview is always the
      // exact number the PR will get — never dependent on the client knowing the project's entity.
      let entityParam = req.query.business_entity_id;
      const projectId = Number(req.query.project_id || 0) || 0;
      if (projectId) {
        const projectRows = await queryAsync('SELECT business_entity_id FROM projects WHERE id = ? LIMIT 1', [projectId]);
        if (projectRows.length && projectRows[0].business_entity_id) {
          entityParam = projectRows[0].business_entity_id;
        }
      }
      const businessEntityId = await resolveBusinessEntityId(entityParam);
      // Admins create official PRs directly, so preview the official number; staff
      // file draft requests, so preview the DFT- draft number.
      const actor = getAuthenticatedUser(req) || {};
      const pr_number = isStaffRole(actor.role)
        ? await peekNextDraftEntityDocumentNo({
            businessEntityId,
            documentType: 'purchase-requisition',
            prefix: 'PR',
            tableName: 'purchase_requisitions',
            columnName: 'pr_number'
          })
        : await peekNextEntityDocumentNo({
            businessEntityId,
            documentType: 'purchase-requisition',
            prefix: 'PR',
            tableName: 'purchase_requisitions',
            columnName: 'pr_number'
          });
      res.json({ pr_number });
    } catch (err) {
      console.error('PR next-number error:', err && err.message);
      res.status(500).json({ error: err.message || 'Unable to generate PR number.' });
    }
  });

  router.get('/api/procurement/purchase-orders/next-number', protectAdmin, async (req, res) => {
    try {
      const businessEntityId = await resolveBusinessEntityId(req.query.business_entity_id);
      // Admins create approved POs with an official number; staff see the DFT- draft.
      const actor = getAuthenticatedUser(req) || {};
      const po_number = isStaffRole(actor.role)
        ? await peekNextDraftEntityDocumentNo({
            businessEntityId,
            documentType: 'purchase-order',
            prefix: 'PO',
            tableName: 'purchase_orders',
            columnName: 'po_number'
          })
        : await peekNextEntityDocumentNo({
            businessEntityId,
            documentType: 'purchase-order',
            prefix: 'PO',
            tableName: 'purchase_orders',
            columnName: 'po_number'
          });
      res.json({ po_number });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to generate PO number.' });
    }
  });

  router.get('/api/procurement/goods-receipts/next-number', protectAdmin, async (req, res) => {
    try {
      const businessEntityId = await resolveBusinessEntityId(req.query.business_entity_id);
      const grn_number = await peekNextEntityDocumentNo({
        businessEntityId,
        documentType: 'goods-receipt',
        prefix: 'GRN',
        tableName: 'goods_receipts',
        columnName: 'grn_number'
      });
      res.json({ grn_number });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to generate GRN number.' });
    }
  });

  router.get('/api/procurement/quotations/next-number', protectAdmin, async (req, res) => {
    try {
      const businessEntityId = await resolveBusinessEntityId(req.query.business_entity_id);
      const quote_number = await peekNextDraftEntityDocumentNo({
        businessEntityId,
        documentType: 'procurement-quotation',
        prefix: 'RFQ',
        tableName: 'procurement_quotations',
        columnName: 'quote_number'
      });
      res.json({ quote_number });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to generate quotation number.' });
    }
  });

  router.post('/api/procurement/requisitions/:id/submit', protectAdmin, async (req, res) => {
    const requisitionId = Number(req.params.id || 0);
    if (!requisitionId) return res.status(400).json({ error: 'Requisition ID is required.' });

    try {
      const rows = await queryAsync(`
        SELECT r.id, r.pr_number, r.draft_pr_number, r.business_entity_id, r.status,
               r.requested_by, r.requested_by_email, r.submitted_by, r.department,
               p.created_by, p.assigned_to, p.project_manager, p.members,
               p.project_members, p.project_members_2, p.project_members_3
        FROM purchase_requisitions r
        LEFT JOIN projects p ON p.id = r.project_id
        WHERE r.id = ?
        LIMIT 1
      `, [requisitionId]);
      if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Requisition not found.' });
      const actor = getAuthenticatedUser(req) || {};
      if (isStaffRole(actor.role) && !requisitionRowMatchesStaffActor(rows[0], actor)) {
        return sendStaffRecordAccessDenied(res, 'Requisition');
      }

      assertStatusTransition(rows[0].status, 'submitted', {
        draft: ['submitted', 'cancelled'],
        needs_revision: ['submitted', 'cancelled'],
        submitted: ['submitted', 'approved', 'cancelled']
      }, 'Purchase requisition');

      const requesterEmail = await getAuthenticatedUserEmail(req);
      await queryAsync(
        "UPDATE purchase_requisitions SET status = 'submitted', requested_by_email = COALESCE(requested_by_email, ?), submitted_by = COALESCE(submitted_by, ?), submitted_at = COALESCE(submitted_at, NOW()) WHERE id = ?",
        [requesterEmail || null, getApprovalActorName(req), requisitionId]
      );
      let generatedPdf = null;
      try {
        generatedPdf = await generatePurchaseRequisitionPdfFile(requisitionId);
      } catch (pdfErr) {
        console.error('Purchase requisition PDF generation warning:', pdfErr);
      }
      logAction(req, 'SUBMIT_PURCHASE_REQUISITION', `Submitted requisition ${rows[0].pr_number}`, 'procurement', { entityType: 'purchase_requisition', entityId: requisitionId, changes: [{ field: 'status', from: rows[0].status, to: 'submitted' }] });
      const detailRows = await queryAsync(`
        SELECT
          pr.pr_number,
          pr.request_date,
          pr.needed_by,
          pr.requested_by,
          c.company_name,
          p.project_name
        FROM purchase_requisitions pr
        LEFT JOIN company_registry c ON c.id = pr.company_id
        LEFT JOIN projects p ON p.id = pr.project_id
        WHERE pr.id = ?
        LIMIT 1
      `, [requisitionId]);
      const details = detailRows[0] || {};
      sendBackgroundNotification(() => notifyApprovalRequest(req, {
        title: 'Purchase Requisition',
        recordNo: rows[0].pr_number,
        reviewPath: '/procurement?tab=requisitions',
        details: {
          Company: details.company_name,
          Project: details.project_name,
          'Request Date': details.request_date,
          'Needed By': details.needed_by,
          'Requested By': details.requested_by
        },
        attachments: generatedPdf?.filePath ? [{
          filename: generatedPdf.filename,
          path: generatedPdf.filePath,
          contentType: 'application/pdf'
        }] : undefined
      }), 'purchase requisition approval email');
      res.json({ success: true, status: 'submitted', pdfFilename: generatedPdf?.filename || null });
    } catch (err) {
      const validationMessage = String(err?.message || '').toLowerCase();
      if (validationMessage.includes('cannot move')) return res.status(400).json({ error: err.message });
      console.error('Submit requisition error:', err);
      res.status(500).json({ error: err.message || 'Unable to submit requisition.' });
    }
  });

  router.post('/api/procurement/requisitions/:id/approve', protectAdminOnly, async (req, res) => {
    const requisitionId = Number(req.params.id || 0);
    if (!requisitionId) return res.status(400).json({ error: 'Requisition ID is required.' });

    try {
      const rows = await queryAsync('SELECT id, pr_number, draft_pr_number, business_entity_id, status FROM purchase_requisitions WHERE id = ? LIMIT 1', [requisitionId]);
      if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Requisition not found.' });

      assertStatusTransition(rows[0].status, 'approved', {
        submitted: ['approved', 'cancelled'],
        approved: ['approved']
      }, 'Purchase requisition');

      const officialPrNumber = isDraftDocumentNo(rows[0].pr_number)
        ? await generateNextEntityDocumentNo({
            businessEntityId: rows[0].business_entity_id,
            documentType: 'purchase-requisition',
            prefix: 'PR',
            tableName: 'purchase_requisitions',
            columnName: 'pr_number'
          })
        : rows[0].pr_number;
      const comment = getApprovalComment(req);
      await queryAsync(
        "UPDATE purchase_requisitions SET pr_number = ?, draft_pr_number = COALESCE(draft_pr_number, ?), status = 'approved', approved_by = COALESCE(approved_by, ?), approved_at = COALESCE(approved_at, NOW()), approval_comment = ? WHERE id = ?",
        [officialPrNumber, rows[0].pr_number, getApprovalActorName(req), comment || null, requisitionId]
      );
      logAction(req, 'APPROVE_PURCHASE_REQUISITION', appendApprovalComment(`Approved requisition ${officialPrNumber} (Draft ${rows[0].draft_pr_number || rows[0].pr_number || '-'})`, comment), 'procurement', { entityType: 'purchase_requisition', entityId: requisitionId, businessEntityId: rows[0].business_entity_id, changes: [{ field: 'status', from: rows[0].status, to: 'approved' }] });
      sendBackgroundNotification(() => notifyPurchaseRequisitionRequester(req, requisitionId, 'approved', {
        approvedBy: getApprovalActorLabel(req)
      }), 'purchase requisition approved email');
      res.json({ success: true, status: 'approved', pr_number: officialPrNumber });
    } catch (err) {
      const validationMessage = String(err?.message || '').toLowerCase();
      if (validationMessage.includes('cannot move')) return res.status(400).json({ error: err.message });
      console.error('Approve requisition error:', err);
      res.status(500).json({ error: err.message || 'Unable to approve requisition.' });
    }
  });

  router.post('/api/procurement/requisitions/:id/reject', protectAdminOnly, async (req, res) => {
    const requisitionId = Number(req.params.id || 0);
    const reason = String(req.body?.reason || '').trim();
    if (!requisitionId) return res.status(400).json({ error: 'Requisition ID is required.' });
    if (!reason) return res.status(400).json({ error: 'Rejection reason is required.' });

    try {
      const rows = await queryAsync('SELECT id, pr_number, status FROM purchase_requisitions WHERE id = ? LIMIT 1', [requisitionId]);
      if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Requisition not found.' });

      assertStatusTransition(rows[0].status, 'needs_revision', {
        submitted: ['approved', 'cancelled', 'needs_revision'],
        approved: ['cancelled'],
        draft: ['submitted', 'cancelled']
      }, 'Purchase requisition');

      await queryAsync(
        "UPDATE purchase_requisitions SET status = 'needs_revision', submitted_at = NULL, approved_by = NULL, approved_at = NULL, cancel_reason = ?, approval_comment = ? WHERE id = ?",
        [`Rejected: ${reason}`, reason, requisitionId]
      );
      logAction(req, 'REJECT_PURCHASE_REQUISITION', `Rejected requisition ${rows[0].pr_number} | Reason: ${reason}`, 'procurement', { entityType: 'purchase_requisition', entityId: requisitionId, severity: 'warning', changes: [{ field: 'status', from: rows[0].status, to: 'needs_revision' }] });
      sendBackgroundNotification(() => notifyPurchaseRequisitionRequester(req, requisitionId, 'rejected', {
        reason,
        cancelledBy: getApprovalActorLabel(req)
      }), 'purchase requisition rejection email');
      res.json({ success: true, status: 'needs_revision', reason });
    } catch (err) {
      const validationMessage = String(err?.message || '').toLowerCase();
      if (validationMessage.includes('cannot move')) return res.status(400).json({ error: err.message });
      console.error('Reject requisition error:', err);
      res.status(500).json({ error: err.message || 'Unable to reject requisition.' });
    }
  });

  router.post('/api/procurement/requisitions/:id/cancel', protectAdminOnly, async (req, res) => {
    const requisitionId = Number(req.params.id || 0);
    if (!requisitionId) return res.status(400).json({ error: 'Requisition ID is required.' });

    try {
      const rows = await queryAsync('SELECT id, pr_number, status FROM purchase_requisitions WHERE id = ? LIMIT 1', [requisitionId]);
      if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Requisition not found.' });
      await assertPurchaseRequisitionCanBeVoided(requisitionId);

      assertStatusTransition(rows[0].status, 'cancelled', {
        draft: ['submitted', 'approved', 'cancelled'],
        needs_revision: ['submitted', 'approved', 'cancelled'],
        submitted: ['approved', 'cancelled'],
        approved: ['cancelled'],
        cancelled: ['cancelled']
      }, 'Purchase requisition');

      const cancelReason = String(req.body?.reason || '').trim() || null;
      await queryAsync(
        "UPDATE purchase_requisitions SET status = 'cancelled', cancelled_by = COALESCE(cancelled_by, ?), cancelled_at = COALESCE(cancelled_at, NOW()), cancel_reason = COALESCE(cancel_reason, ?) WHERE id = ?",
        [getApprovalActorName(req), cancelReason, requisitionId]
      );
      logAction(req, 'CANCEL_PURCHASE_REQUISITION', `Cancelled requisition ${rows[0].pr_number}`, 'procurement', { entityType: 'purchase_requisition', entityId: requisitionId, severity: 'warning', changes: [{ field: 'status', from: rows[0].status, to: 'cancelled' }] });
      sendBackgroundNotification(() => notifyPurchaseRequisitionRequester(req, requisitionId, 'cancelled', {
        reason: cancelReason,
        cancelledBy: getApprovalActorLabel(req)
      }), 'purchase requisition cancelled email');
      res.json({ success: true, status: 'cancelled' });
    } catch (err) {
      const validationMessage = String(err?.message || '').toLowerCase();
      if (validationMessage.includes('cannot move') || validationMessage.includes('approved rfq') || validationMessage.includes('purchase order')) return res.status(400).json({ error: err.message });
      console.error('Cancel requisition error:', err);
      res.status(500).json({ error: err.message || 'Unable to cancel requisition.' });
    }
  });

  router.delete('/api/procurement/requisitions/:id', protectAdminOnly, async (req, res) => {
    const requisitionId = Number(req.params.id || 0);
    if (!requisitionId) return res.status(400).json({ error: 'Requisition ID is required.' });

    try {
      const result = await queryAsync('UPDATE purchase_requisitions SET archived = TRUE, archived_at = COALESCE(archived_at, NOW()) WHERE id = ?', [requisitionId]);
      logAction(req, 'ARCHIVE_PURCHASE_REQUISITION', `Archived requisition ID: ${req.params.id}`, 'procurement', { entityType: 'purchase_requisition', entityId: requisitionId, severity: 'warning' });
      res.json({ success: true, affectedRows: result.affectedRows || 0 });
    } catch (err) {
      console.error('Archive requisition error:', err);
      res.status(500).json({ error: err.message || 'Unable to archive requisition.' });
    }
  });

  router.post('/api/procurement/purchase-orders/:id/submit', protectAdmin, async (req, res) => {
    const poId = Number(req.params.id || 0);
    if (!poId) return res.status(400).json({ error: 'Purchase order ID is required.' });

    try {
      const rows = await queryAsync('SELECT id, po_number, status FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
      if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Purchase order not found.' });

      assertStatusTransition(rows[0].status, 'pending', {
        draft: ['pending', 'cancelled'],
        pending: ['pending', 'approved', 'cancelled']
      }, 'Purchase order');

      await queryAsync(
        "UPDATE purchase_orders SET status = 'pending', submitted_by = COALESCE(submitted_by, ?), submitted_at = COALESCE(submitted_at, NOW()) WHERE id = ?",
        [getApprovalActorName(req), poId]
      );
      logAction(req, 'SUBMIT_PURCHASE_ORDER', `Submitted purchase order ${rows[0].po_number}`, 'procurement', { entityType: 'purchase_order', entityId: poId, changes: [{ field: 'status', from: rows[0].status, to: 'pending' }] });
      const detailRows = await queryAsync(`
        SELECT
          po.po_number,
          po.po_date,
          po.delivery_date,
          po.total_amount,
          c.company_name,
          p.project_name,
          v.vendor_name
        FROM purchase_orders po
        LEFT JOIN company_registry c ON c.id = po.company_id
        LEFT JOIN projects p ON p.id = po.project_id
        LEFT JOIN vendors v ON v.id = po.vendor_id
        WHERE po.id = ?
        LIMIT 1
      `, [poId]);
      const details = detailRows[0] || {};
      const attachments = [];
      try {
        attachments.push(await buildPurchaseOrderPdfAttachment(poId));
      } catch (pdfErr) {
        console.error('Purchase order approval request PDF generation warning:', pdfErr);
      }
      sendBackgroundNotification(() => notifyApprovalRequest(req, {
        title: 'Purchase Order',
        recordNo: rows[0].po_number,
        reviewPath: '/procurement?tab=purchase-orders',
        details: {
          Company: details.company_name,
          Project: details.project_name,
          Vendor: details.vendor_name,
          'PO Date': details.po_date,
          'Delivery Date': details.delivery_date,
          Amount: details.total_amount
        },
        attachments: attachments.length ? attachments : undefined
      }), 'purchase order approval email');
      res.json({ success: true, status: 'pending' });
    } catch (err) {
      const validationMessage = String(err?.message || '').toLowerCase();
      if (validationMessage.includes('cannot move')) return res.status(400).json({ error: err.message });
      console.error('Submit purchase order error:', err);
      res.status(500).json({ error: err.message || 'Unable to submit purchase order.' });
    }
  });

  router.post('/api/procurement/purchase-orders/:id/approve', protectAdminOnly, async (req, res) => {
    const poId = Number(req.params.id || 0);
    if (!poId) return res.status(400).json({ error: 'Purchase order ID is required.' });

    try {
      const rows = await queryAsync('SELECT id, po_number, draft_po_number, business_entity_id, status, approved_by FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
      if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Purchase order not found.' });

      assertStatusTransition(rows[0].status, 'approved', {
        pending: ['approved', 'cancelled'],
        approved: ['approved']
      }, 'Purchase order');

      const approvedBy = String(rows[0].approved_by || '').trim() || getApprovalActorName(req);
      const officialPoNumber = isDraftDocumentNo(rows[0].po_number)
        ? await generateNextEntityDocumentNo({
            businessEntityId: rows[0].business_entity_id,
            documentType: 'purchase-order',
            prefix: 'PO',
            tableName: 'purchase_orders',
            columnName: 'po_number'
          })
        : rows[0].po_number;
      const comment = getApprovalComment(req);
      await queryAsync(
        "UPDATE purchase_orders SET po_number = ?, draft_po_number = COALESCE(draft_po_number, ?), status = 'approved', approved_by = ?, approved_at = COALESCE(approved_at, NOW()), approval_comment = ? WHERE id = ?",
        [officialPoNumber, rows[0].po_number, approvedBy, comment || null, poId]
      );
      logAction(req, 'APPROVE_PURCHASE_ORDER', appendApprovalComment(`Approved purchase order ${officialPoNumber} (Draft ${rows[0].draft_po_number || rows[0].po_number || '-'})`, comment), 'procurement', { entityType: 'purchase_order', entityId: poId, businessEntityId: rows[0].business_entity_id, changes: [{ field: 'status', from: rows[0].status, to: 'approved' }] });
      sendBackgroundNotification(() => notifyPurchaseOrderRequester(req, poId, 'approved', {
        approvedBy: getApprovalActorLabel(req)
      }), 'purchase order approved email');
      sendBackgroundNotification(() => notifyPurchaseOrderVendor(req, poId), 'purchase order vendor email');
      res.json({ success: true, status: 'approved', po_number: officialPoNumber, approved_by: approvedBy });
    } catch (err) {
      const validationMessage = String(err?.message || '').toLowerCase();
      if (validationMessage.includes('cannot move')) return res.status(400).json({ error: err.message });
      console.error('Approve purchase order error:', err);
      res.status(500).json({ error: err.message || 'Unable to approve purchase order.' });
    }
  });

  router.post('/api/procurement/purchase-orders/:id/reject', protectAdminOnly, async (req, res) => {
    const poId = Number(req.params.id || 0);
    const reason = String(req.body?.reason || '').trim();
    if (!poId) return res.status(400).json({ error: 'Purchase order ID is required.' });
    if (!reason) return res.status(400).json({ error: 'Rejection reason is required.' });

    try {
      const rows = await queryAsync('SELECT id, po_number, status, notes FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
      if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Purchase order not found.' });

      assertStatusTransition(rows[0].status, 'draft', {
        pending: ['approved', 'cancelled', 'draft'],
        draft: ['pending', 'cancelled']
      }, 'Purchase order');

      const actor = getApprovalActorName(req);
      const notes = [rows[0].notes, `Rejected by ${actor}: ${reason}`].filter(Boolean).join('\n');
      await queryAsync(
        "UPDATE purchase_orders SET status = 'draft', submitted_at = NULL, approved_by = NULL, approved_at = NULL, notes = ?, approval_comment = ? WHERE id = ?",
        [notes, reason, poId]
      );
      logAction(req, 'REJECT_PURCHASE_ORDER', `Rejected purchase order ${rows[0].po_number} | Reason: ${reason}`, 'procurement', { entityType: 'purchase_order', entityId: poId, severity: 'warning', changes: [{ field: 'status', from: rows[0].status, to: 'draft' }] });
      sendBackgroundNotification(() => notifyPurchaseOrderRequester(req, poId, 'rejected', {
        reason,
        cancelledBy: getApprovalActorLabel(req),
        statusOverride: 'rejected'
      }), 'purchase order rejection email');
      res.json({ success: true, status: 'draft', reason });
    } catch (err) {
      const validationMessage = String(err?.message || '').toLowerCase();
      if (validationMessage.includes('cannot move')) return res.status(400).json({ error: err.message });
      console.error('Reject purchase order error:', err);
      res.status(500).json({ error: err.message || 'Unable to reject purchase order.' });
    }
  });

  router.post('/api/procurement/purchase-orders/:id/cancel', protectAdminOnly, async (req, res) => {
    const poId = Number(req.params.id || 0);
    if (!poId) return res.status(400).json({ error: 'Purchase order ID is required.' });

    try {
      const rows = await queryAsync('SELECT id, po_number, status FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
      if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Purchase order not found.' });

      assertStatusTransition(rows[0].status, 'cancelled', {
        draft: ['pending', 'approved', 'cancelled'],
        pending: ['approved', 'cancelled'],
        approved: ['cancelled'],
        cancelled: ['cancelled']
      }, 'Purchase order');

      const cancelReason = String(req.body?.reason || '').trim() || null;
      await queryAsync(
        "UPDATE purchase_orders SET status = 'cancelled', cancelled_by = COALESCE(cancelled_by, ?), cancelled_at = COALESCE(cancelled_at, NOW()), cancel_reason = COALESCE(cancel_reason, ?) WHERE id = ?",
        [getApprovalActorName(req), cancelReason, poId]
      );
      logAction(req, 'CANCEL_PURCHASE_ORDER', `Cancelled purchase order ${rows[0].po_number}`, 'procurement', { entityType: 'purchase_order', entityId: poId, severity: 'warning', changes: [{ field: 'status', from: rows[0].status, to: 'cancelled' }] });
      sendBackgroundNotification(() => notifyPurchaseOrderRequester(req, poId, 'cancelled', {
        reason: cancelReason,
        cancelledBy: getApprovalActorLabel(req)
      }), 'purchase order cancelled email');
      res.json({ success: true, status: 'cancelled' });
    } catch (err) {
      const validationMessage = String(err?.message || '').toLowerCase();
      if (validationMessage.includes('cannot move')) return res.status(400).json({ error: err.message });
      console.error('Cancel purchase order error:', err);
      res.status(500).json({ error: err.message || 'Unable to cancel purchase order.' });
    }
  });

  router.delete('/api/procurement/purchase-orders/:id', protectAdminOnly, async (req, res) => {
    const poId = Number(req.params.id || 0);
    try {
      const result = await queryAsync('UPDATE purchase_orders SET archived = TRUE, archived_at = COALESCE(archived_at, NOW()) WHERE id = ?', [poId]);
      logAction(req, 'ARCHIVE_PURCHASE_ORDER', `Archived purchase order ID: ${req.params.id}`, 'procurement', { entityType: 'purchase_order', entityId: poId, severity: 'warning' });
      res.json({ success: true, affectedRows: result.affectedRows || 0 });
    } catch (err) {
      console.error('Archive purchase order error:', err);
      res.status(500).json({ error: err.message || 'Unable to archive purchase order.' });
    }
  });

  router.post('/api/procurement/quotations', protectAdmin, publicQuotePdfUpload, async (req, res) => {
    const dropFile = () => { if (req.file && req.file.path) fs.unlink(req.file.path, () => {}); };
    if (req.fileUploadError) {
      dropFile();
      return res.status(400).json({ error: 'Attachment must be a PDF file (max 10MB).' });
    }
    let quoteNumber = String(req.body.quote_number || '').trim();
    const requisitionId = Number(req.body.requisition_id || 0) || 0;
    const vendorId = Number(req.body.vendor_id || 0) || 0;
    const quoteDate = req.body.quote_date || getManilaYmd();
    const quotedTotal = toNumber(req.body.quoted_total, 0);
    const deliveryDays = Math.max(0, Number(req.body.delivery_days || 0) || 0);
    const paymentTerms = String(req.body.payment_terms || '').trim() || null;
    const warrantyTerms = String(req.body.warranty_terms || '').trim() || null;
    const status = 'draft';
    const remarks = String(req.body.remarks || '').trim() || null;

    // Quoted total is optional — a vendor may have only emailed a PDF.
    if (!requisitionId || !vendorId) {
      dropFile();
      return res.status(400).json({ error: 'Approved PR and vendor are required.' });
    }

    try {
      const requisitionRows = await queryAsync('SELECT id, status, business_entity_id FROM purchase_requisitions WHERE id = ? LIMIT 1', [requisitionId]);
      if (!requisitionRows.length) { dropFile(); return res.status(404).json({ error: 'Selected requisition was not found.' }); }
      if (!['approved', 'ordered'].includes(normalizeProcurementWorkflowStatus(requisitionRows[0].status))) {
        dropFile();
        return res.status(400).json({ error: 'Only approved requisitions can receive vendor quotations.' });
      }
      const existingPoRows = await queryAsync('SELECT id, po_number FROM purchase_orders WHERE requisition_id = ? LIMIT 1', [requisitionId]);
      if (existingPoRows.length) {
        dropFile();
        return res.status(409).json({ error: `Selected PR already has PO ${existingPoRows[0].po_number || existingPoRows[0].id}. New RFQs are disabled.` });
      }
      const selectedQuoteRows = await queryAsync(
        "SELECT id, quote_number FROM procurement_quotations WHERE requisition_id = ? AND status = 'selected' LIMIT 1",
        [requisitionId]
      );
      if (selectedQuoteRows.length) {
        dropFile();
        return res.status(409).json({ error: `Selected PR already has approved RFQ ${selectedQuoteRows[0].quote_number || selectedQuoteRows[0].id}. New RFQs are disabled.` });
      }
      const vendorRows = await queryAsync('SELECT id, COALESCE(is_active, TRUE) AS is_active FROM vendors WHERE id = ? LIMIT 1', [vendorId]);
      if (!vendorRows.length) { dropFile(); return res.status(404).json({ error: 'Selected vendor was not found.' }); }
      if (Number(vendorRows[0].is_active || 0) !== 1) { dropFile(); return res.status(400).json({ error: 'Vendor is inactive.' }); }
      const businessEntityId = await resolveBusinessEntityId(requisitionRows[0].business_entity_id || req.body.business_entity_id);
      if (!quoteNumber || !isDraftDocumentNo(quoteNumber)) {
        quoteNumber = await generateNextDraftEntityDocumentNo({
          businessEntityId,
          documentType: 'procurement-quotation',
          prefix: 'RFQ',
          tableName: 'procurement_quotations',
          columnName: 'quote_number'
        });
      }

      const result = await queryAsync(
        'INSERT INTO procurement_quotations (quote_number, requisition_id, vendor_id, quote_date, quoted_total, delivery_days, payment_terms, warranty_terms, status, remarks, selected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [quoteNumber, requisitionId, vendorId, quoteDate, quotedTotal, deliveryDays, paymentTerms, warrantyTerms, status, remarks, status === 'selected' ? new Date() : null]
      );
      if (status === 'selected') {
        await queryAsync("UPDATE procurement_quotations SET status = 'rejected', selected_at = NULL WHERE requisition_id = ? AND id <> ?", [requisitionId, result.insertId]);
      }
      // Attach the optional vendor-supplied PDF (manually uploaded by the admin).
      if (req.file && req.file.filename) {
        await queryAsync('UPDATE procurement_quotations SET vendor_pdf = ? WHERE id = ?', [req.file.filename, result.insertId]);
      }
      await claimEntityDocumentNo({
        businessEntityId,
        documentType: 'procurement-quotation',
        prefix: 'RFQ',
        documentNo: quoteNumber
      });
      logAction(req, 'CREATE_QUOTATION', `Created quotation ${quoteNumber}`, 'procurement', { entityType: 'quotation', entityId: result.insertId, businessEntityId });
      res.json({ id: result.insertId, quote_number: quoteNumber });
    } catch (err) {
      dropFile();
      if (isPostgresUniqueViolation(err)) return res.status(409).json({ error: 'Quotation already exists for this PR and vendor.' });
      console.error('Create quotation error:', err);
      res.status(500).json({ error: err.message || 'Unable to create quotation.' });
    }
  });

  router.put('/api/procurement/quotations/:id', protectAdmin, publicQuotePdfUpload, async (req, res) => {
    const dropFile = () => { if (req.file && req.file.path) fs.unlink(req.file.path, () => {}); };
    if (req.fileUploadError) {
      dropFile();
      return res.status(400).json({ error: 'Attachment must be a PDF file (max 10MB).' });
    }
    const quotationId = Number(req.params.id || 0) || 0;
    if (!quotationId) { dropFile(); return res.status(400).json({ error: 'Quotation ID is required.' }); }

    const requisitionId = Number(req.body.requisition_id || 0) || 0;
    const vendorId = Number(req.body.vendor_id || 0) || 0;
    const quoteDate = req.body.quote_date || getManilaYmd();
    const quotedTotal = toNumber(req.body.quoted_total, 0);
    const deliveryDays = Math.max(0, Number(req.body.delivery_days || 0) || 0);
    const paymentTerms = String(req.body.payment_terms || '').trim() || null;
    const warrantyTerms = String(req.body.warranty_terms || '').trim() || null;
    let status = 'draft';
    const remarks = String(req.body.remarks || '').trim() || null;

    // Quoted total is optional — a vendor may have only emailed a PDF.
    if (!requisitionId || !vendorId) {
      dropFile();
      return res.status(400).json({ error: 'Approved PR and vendor are required.' });
    }

    try {
      const currentRows = await queryAsync('SELECT id, requisition_id, status, vendor_pdf FROM procurement_quotations WHERE id = ? LIMIT 1', [quotationId]);
      if (!currentRows.length) { dropFile(); return res.status(404).json({ error: 'Quotation not found.' }); }
      if (normalizeQuotationStatus(currentRows[0].status) === 'rejected') {
        dropFile();
        return res.status(400).json({ error: 'Rejected RFQs are read-only.' });
      }
      if (isFinalAwardedQuotationStatus(currentRows[0].status)) {
        dropFile();
        return res.status(400).json({ error: 'Awarded RFQs are read-only.' });
      }
      const existingPoRows = await queryAsync('SELECT id, po_number FROM purchase_orders WHERE requisition_id IN (?, ?) LIMIT 1', [currentRows[0].requisition_id, requisitionId]);
      if (existingPoRows.length) {
        dropFile();
        return res.status(409).json({ error: `Selected PR already has PO ${existingPoRows[0].po_number || existingPoRows[0].id}. RFQ changes are disabled.` });
      }
      const selectedQuoteRows = await queryAsync(
        "SELECT id, quote_number FROM procurement_quotations WHERE requisition_id = ? AND status = 'selected' LIMIT 1",
        [requisitionId]
      );
      if (selectedQuoteRows.length && Number(selectedQuoteRows[0].id || 0) !== quotationId) {
        dropFile();
        return res.status(409).json({ error: `Selected PR already has approved RFQ ${selectedQuoteRows[0].quote_number || selectedQuoteRows[0].id}. New RFQs are disabled.` });
      }
      status = normalizeQuotationStatus(currentRows[0].status) || 'draft';

      const result = await queryAsync(
        'UPDATE procurement_quotations SET requisition_id = ?, vendor_id = ?, quote_date = ?, quoted_total = ?, delivery_days = ?, payment_terms = ?, warranty_terms = ?, status = ?, remarks = ?, selected_at = CASE WHEN ? = ? THEN COALESCE(selected_at, NOW()) ELSE NULL END WHERE id = ?',
        [requisitionId, vendorId, quoteDate, quotedTotal, deliveryDays, paymentTerms, warrantyTerms, status, remarks, status, 'selected', quotationId]
      );
      if (!Number(result.affectedRows || 0)) { dropFile(); return res.status(404).json({ error: 'Quotation not found.' }); }
      if (status === 'selected') {
        await queryAsync("UPDATE procurement_quotations SET status = 'rejected', selected_at = NULL WHERE requisition_id = ? AND id <> ?", [requisitionId, quotationId]);
      }
      // A newly uploaded PDF replaces the old one (delete the stale file from disk).
      if (req.file && req.file.filename) {
        await queryAsync('UPDATE procurement_quotations SET vendor_pdf = ? WHERE id = ?', [req.file.filename, quotationId]);
        const previous = currentRows[0].vendor_pdf;
        if (previous && previous !== req.file.filename) {
          fs.unlink(path.join(UPLOAD_DIR, path.basename(String(previous))), () => {});
        }
      }
      logAction(req, 'UPDATE_QUOTATION', `Updated quotation ${quotationId}`, 'procurement', { entityType: 'quotation', entityId: quotationId });
      res.json({ success: true });
    } catch (err) {
      dropFile();
      if (isPostgresUniqueViolation(err)) return res.status(409).json({ error: 'Quotation already exists for this PR and vendor.' });
      console.error('Update quotation error:', err);
      res.status(500).json({ error: err.message || 'Unable to update quotation.' });
    }
  });

  router.post('/api/procurement/quotations/:id/select', protectAdminOnly, async (req, res) => {
    const quotationId = Number(req.params.id || 0) || 0;
    if (!quotationId) return res.status(400).json({ error: 'Quotation ID is required.' });
    try {
      const rows = await queryAsync(`
        SELECT q.id, q.quote_number, q.draft_quote_number, q.requisition_id, q.status, pr.business_entity_id
        FROM procurement_quotations q
        LEFT JOIN purchase_requisitions pr ON pr.id = q.requisition_id
        WHERE q.id = ? LIMIT 1
      `, [quotationId]);
      if (!rows.length) return res.status(404).json({ error: 'Quotation not found.' });
      if (normalizeQuotationStatus(rows[0].status) === 'rejected') {
        return res.status(400).json({ error: 'Rejected RFQs are read-only.' });
      }
      const existingPoRows = await queryAsync('SELECT id, po_number FROM purchase_orders WHERE requisition_id = ? LIMIT 1', [rows[0].requisition_id]);
      if (existingPoRows.length) {
        return res.status(409).json({ error: `Selected PR already has PO ${existingPoRows[0].po_number || existingPoRows[0].id}. RFQ approval is locked.` });
      }
      const officialQuoteNumber = isDraftDocumentNo(rows[0].quote_number)
        ? await generateNextEntityDocumentNo({
            businessEntityId: rows[0].business_entity_id,
            documentType: 'procurement-quotation',
            prefix: 'RFQ',
            tableName: 'procurement_quotations',
            columnName: 'quote_number'
          })
        : rows[0].quote_number;
      await queryAsync("UPDATE procurement_quotations SET status = 'rejected', selected_at = NULL WHERE requisition_id = ? AND id <> ?", [rows[0].requisition_id, quotationId]);
      await queryAsync("UPDATE procurement_quotations SET quote_number = ?, draft_quote_number = COALESCE(draft_quote_number, ?), status = 'selected', selected_at = COALESCE(selected_at, NOW()) WHERE id = ?", [officialQuoteNumber, rows[0].quote_number, quotationId]);
      logAction(req, 'SELECT_QUOTATION', `Selected quotation ${officialQuoteNumber} (Draft ${rows[0].draft_quote_number || rows[0].quote_number || '-'})`, 'procurement', { entityType: 'quotation', entityId: quotationId, changes: [{ field: 'status', from: rows[0].status, to: 'selected' }] });
      sendBackgroundNotification(() => notifyRfqAwardedRequester(req, quotationId), 'rfq awarded requester email');
      sendBackgroundNotification(() => notifyRfqAwardedVendor(req, quotationId), 'rfq awarded vendor email');
      res.json({ success: true, status: 'selected', quote_number: officialQuoteNumber });
    } catch (err) {
      console.error('Select quotation error:', err);
      res.status(500).json({ error: err.message || 'Unable to select quotation.' });
    }
  });

  router.post('/api/procurement/quotations/:id/email-award', protectAdminOnly, async (req, res) => {
    const quotationId = Number(req.params.id || 0) || 0;
    if (!quotationId) return res.status(400).json({ error: 'Quotation ID is required.' });

    try {
      const rows = await queryAsync('SELECT id, status FROM procurement_quotations WHERE id = ? LIMIT 1', [quotationId]);
      if (!rows.length) return res.status(404).json({ error: 'Quotation not found.' });
      if (!isFinalAwardedQuotationStatus(rows[0].status)) {
        return res.status(400).json({ error: 'Approve/award this RFQ before emailing the award notice.' });
      }

      const result = await notifyRfqAwardedVendor(req, quotationId);
      if (!result?.sent) {
        return res.status(400).json({ error: result?.reason === 'no-vendor-email' ? 'Winning vendor has no email on file.' : 'Unable to send award email.' });
      }

      logAction(req, 'EMAIL_RFQ_AWARD_VENDOR', `Sent RFQ award notice for quotation ID: ${quotationId}`);
      res.json({ success: true, sent: true });
    } catch (err) {
      console.error('Email RFQ award vendor error:', err);
      res.status(500).json({ error: err.message || 'Unable to email RFQ award notice.' });
    }
  });

  router.delete('/api/procurement/quotations/:id', protectAdminOnly, async (req, res) => {
    try {
      const rows = await queryAsync('SELECT id, requisition_id, status FROM procurement_quotations WHERE id = ? LIMIT 1', [Number(req.params.id || 0)]);
      if (!rows.length) return res.status(404).json({ error: 'Quotation not found.' });
      const result = await queryAsync('UPDATE procurement_quotations SET archived = TRUE, archived_at = COALESCE(archived_at, NOW()) WHERE id = ?', [Number(req.params.id || 0)]);
      if (!Number(result.affectedRows || 0)) return res.status(404).json({ error: 'Quotation not found.' });
      logAction(req, 'ARCHIVE_QUOTATION', `Archived quotation ${req.params.id}`, 'procurement', { entityType: 'quotation', entityId: Number(req.params.id || 0), severity: 'warning' });
      res.json({ success: true });
    } catch (err) {
      console.error('Archive quotation error:', err);
      res.status(500).json({ error: err.message || 'Unable to archive quotation.' });
    }
  });

  router.get('/api/procurement/quotations/:id/vendor-pdf', protectAdmin, async (req, res) => {
    const quotationId = Number(req.params.id || 0) || 0;
    if (!quotationId) return res.status(400).json({ error: 'Quotation ID is required.' });
    try {
      const rows = await queryAsync('SELECT vendor_pdf, quote_number FROM procurement_quotations WHERE id = ? LIMIT 1', [quotationId]);
      if (!rows.length || !rows[0].vendor_pdf) return res.status(404).json({ error: 'No vendor PDF on file for this quotation.' });
      const safeFilename = path.basename(String(rows[0].vendor_pdf));
      const filePath = path.join(UPLOAD_DIR, safeFilename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Vendor PDF file not found.' });
      const disposition = String(req.query.download || '') === '1' ? 'attachment' : 'inline';
      res.type('application/pdf');
      res.setHeader('Content-Disposition', `${disposition}; filename="vendor-quote-${rows[0].quote_number || quotationId}.pdf"`);
      return res.sendFile(filePath);
    } catch (err) {
      console.error('Vendor quote PDF error:', err);
      return res.status(500).json({ error: err.message || 'Unable to load vendor PDF.' });
    }
  });

  // Generate + serve the system quotation PDF for a quote (View PDF in the system).
  router.get('/api/procurement/quotations/:id/pdf', protectAdmin, async (req, res) => {
    const quotationId = Number(req.params.id || 0) || 0;
    if (!quotationId) return res.status(400).json({ error: 'Quotation ID is required.' });
    try {
      const attachment = await buildQuotationPdfAttachment(quotationId);
      const disposition = String(req.query.download || '') === '1' ? 'attachment' : 'inline';
      res.type('application/pdf');
      res.setHeader('Content-Disposition', `${disposition}; filename="${attachment.filename}"`);
      return res.send(attachment.content);
    } catch (err) {
      console.error('Quotation PDF error:', err);
      return res.status(500).json({ error: err.message || 'Unable to generate quotation PDF.' });
    }
  });

  // Generate + serve the purchase order PDF (View PDF in the PO table).
  router.get('/api/procurement/purchase-orders/:id/pdf', protectAdmin, async (req, res) => {
    const poId = Number(req.params.id || 0) || 0;
    if (!poId) return res.status(400).json({ error: 'Purchase order ID is required.' });
    try {
      const attachment = await buildPurchaseOrderPdfAttachment(poId);
      const disposition = String(req.query.download || '') === '1' ? 'attachment' : 'inline';
      res.type('application/pdf');
      res.setHeader('Content-Disposition', `${disposition}; filename="${attachment.filename}"`);
      return res.send(attachment.content);
    } catch (err) {
      console.error('Purchase order PDF error:', err);
      return res.status(500).json({ error: err.message || 'Unable to generate purchase order PDF.' });
    }
  });

  // ERP Assistant: trace any procurement document number (PR/RFQ/PO/GRN/Bill) and report
  // where it sits in the flow and its status. Read-only lookup; no AI.
  router.get('/api/procurement/trace', protectAdmin, async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ ok: true, found: false, message: 'Magtype ng document number (PR / RFQ / PO / GRN / Bill).' });
    const like = `%${q}%`;
    try {
      let requisitionId = 0;
      let matched = null;
      let rows = await queryAsync('SELECT id, pr_number FROM purchase_requisitions WHERE pr_number = ? OR draft_pr_number = ? OR pr_number LIKE ? ORDER BY id DESC LIMIT 1', [q, q, like]);
      if (rows.length) { requisitionId = Number(rows[0].id); matched = { type: 'PR', number: rows[0].pr_number }; }
      if (!requisitionId) {
        rows = await queryAsync('SELECT quote_number, requisition_id FROM procurement_quotations WHERE quote_number = ? OR draft_quote_number = ? OR quote_number LIKE ? ORDER BY id DESC LIMIT 1', [q, q, like]);
        if (rows.length) { requisitionId = Number(rows[0].requisition_id); matched = { type: 'RFQ/Quotation', number: rows[0].quote_number }; }
      }
      if (!requisitionId) {
        rows = await queryAsync('SELECT po_number, requisition_id FROM purchase_orders WHERE po_number = ? OR draft_po_number = ? OR po_number LIKE ? ORDER BY id DESC LIMIT 1', [q, q, like]);
        if (rows.length) { requisitionId = Number(rows[0].requisition_id); matched = { type: 'PO', number: rows[0].po_number }; }
      }
      if (!requisitionId) {
        rows = await queryAsync('SELECT gr.grn_number, po.requisition_id FROM goods_receipts gr JOIN purchase_orders po ON po.id = gr.po_id WHERE gr.grn_number = ? OR gr.grn_number LIKE ? ORDER BY gr.id DESC LIMIT 1', [q, like]);
        if (rows.length) { requisitionId = Number(rows[0].requisition_id); matched = { type: 'GRN', number: rows[0].grn_number }; }
      }
      if (!requisitionId) {
        rows = await queryAsync('SELECT ap.bill_number, po.requisition_id FROM accounts_payable ap JOIN purchase_orders po ON po.id = ap.po_id WHERE ap.bill_number = ? OR ap.bill_number LIKE ? ORDER BY ap.id DESC LIMIT 1', [q, like]);
        if (rows.length) { requisitionId = Number(rows[0].requisition_id); matched = { type: 'Bill', number: rows[0].bill_number }; }
      }
      if (!requisitionId) {
        return res.json({ ok: true, found: false, message: `Walang nahanap para sa "${q}". Subukan ang buong PR / RFQ / PO / GRN / Bill number.` });
      }

      const prRows = await queryAsync('SELECT pr.id, pr.pr_number, pr.status, p.project_docno, p.project_name FROM purchase_requisitions pr LEFT JOIN projects p ON p.id = pr.project_id WHERE pr.id = ? LIMIT 1', [requisitionId]);
      const pr = prRows[0] || null;
      if (!pr) return res.json({ ok: true, found: false, message: `Walang nahanap para sa "${q}".` });

      const quoteRows = await queryAsync('SELECT q.quote_number, q.status, q.quoted_total, v.vendor_name FROM procurement_quotations q LEFT JOIN vendors v ON v.id = q.vendor_id WHERE q.requisition_id = ? ORDER BY q.id ASC', [requisitionId]);
      const awardedQuote = quoteRows.find((x) => normalizeQuotationStatus(x.status) === 'selected') || null;
      const poRows = await queryAsync('SELECT id, po_number, status FROM purchase_orders WHERE requisition_id = ? ORDER BY id DESC LIMIT 1', [requisitionId]);
      const po = poRows[0] || null;
      let grn = null; let bill = null;
      if (po) {
        const grnRows = await queryAsync('SELECT grn_number, status, received_date FROM goods_receipts WHERE po_id = ? ORDER BY id DESC LIMIT 1', [po.id]);
        grn = grnRows[0] || null;
        const billRows = await queryAsync('SELECT bill_number, approval_status, total_amount, paid_amount FROM accounts_payable WHERE po_id = ? ORDER BY id DESC LIMIT 1', [po.id]);
        bill = billRows[0] || null;
      }
      const poFullyReceived = po ? normalizeProcurementWorkflowStatus(po.status) === 'received' : false;
      const billPaid = bill ? (Number(bill.total_amount || 0) > 0 && Number(bill.paid_amount || 0) >= Number(bill.total_amount || 0)) : false;

      const lines = [];
      const projectLabel = [pr.project_docno, pr.project_name].filter(Boolean).join(' - ');
      lines.push(`✅ ${pr.pr_number} — ${formatPdfStatusLabel(pr.status)}${projectLabel ? ` (${projectLabel})` : ''}`);
      if (quoteRows.length) {
        lines.push(`✅ Quotations — ${quoteRows.length} quote${quoteRows.length === 1 ? '' : 's'}${awardedQuote ? `, awarded: ${awardedQuote.vendor_name || 'vendor'} (${formatPdfMoney(awardedQuote.quoted_total)})` : ''}`);
      } else {
        lines.push('⬜ Quotations — wala pa');
      }
      lines.push(po ? `✅ ${po.po_number} — ${formatPdfStatusLabel(po.status)}` : '⬜ Purchase Order — wala pa');
      if (poFullyReceived) lines.push(`✅ Goods Receipt — natanggap na${grn ? ` (${grn.grn_number})` : ''}`);
      else if (grn) lines.push(`🟡 Goods Receipt — bahagyang natanggap (${grn.grn_number})`);
      else lines.push('⬜ Goods Receipt — wala pa');
      if (billPaid) lines.push(`✅ Bill — bayad na (${bill.bill_number})`);
      else if (bill) lines.push(`🟡 Bill — ${bill.bill_number}, naghihintay ng bayad`);
      else lines.push('⬜ Bill — wala pa');

      let stage;
      if (billPaid) stage = 'Tapos na — bayad na ang bill. 🎉';
      else if (bill) stage = 'May bill na — naghihintay ng bayad.';
      else if (poFullyReceived || grn) stage = 'Natanggap na ang goods — pwede nang i-bill.';
      else if (po) stage = 'May PO na — hinihintay ang delivery ng goods.';
      else if (awardedQuote) stage = 'May panalong quote na — gawing Purchase Order.';
      else if (quoteRows.length) stage = `May ${quoteRows.length} quote — i-compare at mag-award ng panalo.`;
      else if (normalizeProcurementWorkflowStatus(pr.status) === 'approved') stage = 'Approved ang PR — mag-create/email ng RFQ sa vendor.';
      else if (normalizeProcurementWorkflowStatus(pr.status) === 'submitted') stage = 'Naghihintay ng approval ang PR.';
      else stage = 'Draft pa lang ang PR.';

      return res.json({
        ok: true,
        found: true,
        matched,
        title: `${matched.type}: ${matched.number}`,
        lines,
        stage,
        summary: `${lines.join('\n')}\n\n📍 Nasaan ngayon: ${stage}`
      });
    } catch (err) {
      console.error('Procurement trace error:', err);
      return res.status(500).json({ ok: false, error: 'Hindi ma-trace ang dokumento.' });
    }
  });

  // Activity feed: latest system events in plain language (for the support widget).
  router.get('/api/procurement/activity', protectAdmin, async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20) || 20));
    try {
      const rows = await queryAsync(
        `SELECT l.id, l.module, l.action, l.details, l.created_at,
                COALESCE(u.fullname, u.username, 'System') AS actor_name
         FROM system_logs l LEFT JOIN users u ON u.id = l.user_id
         ORDER BY l.created_at DESC, l.id DESC LIMIT ?`,
        [limit]
      );
      const items = (Array.isArray(rows) ? rows : []).map((r) => ({
        id: r.id,
        module: String(r.module || '').trim(),
        action: String(r.action || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        actor: String(r.actor_name || 'System').trim(),
        detail: String(r.details || '').replace(/^\[Actor:[^\]]*\]\s*/, '').trim(),
        at: r.created_at
      }));
      return res.json({ ok: true, items });
    } catch (err) {
      console.error('Activity feed error:', err);
      return res.status(500).json({ ok: false, error: 'Hindi ma-load ang activity.' });
    }
  });

  router.get('/api/procurement/goods-receipts', protectAdmin, async (req, res) => {
    try {
      const rows = await queryAsync(`
        SELECT
          gr.*,
          po.po_number,
          po.business_entity_id,
          v.vendor_name,
          MIN(gri.warehouse_id) AS warehouse_id,
          MIN(w.warehouse_name) AS warehouse_name
        FROM goods_receipts gr
        JOIN purchase_orders po ON po.id = gr.po_id
        LEFT JOIN vendors v ON v.id = po.vendor_id
        LEFT JOIN goods_receipt_items gri ON gri.receipt_id = gr.id
        LEFT JOIN warehouses w ON w.id = gri.warehouse_id
        WHERE COALESCE(gr.archived, FALSE) = FALSE
        GROUP BY gr.id, po.po_number, po.business_entity_id, v.vendor_name
        ORDER BY gr.received_date DESC, gr.id DESC
      `);
      res.json(rows);
    } catch (err) {
      console.error('Goods receipts error:', err);
      res.status(500).json({ error: err.message || 'Unable to load goods receipts.' });
    }
  });

  router.post('/api/procurement/goods-receipts', protectAdmin, async (req, res) => {
    let grnNumber = String(req.body.grn_number || '').trim();
    const poId = Number(req.body.po_id || 0);
    const warehouseId = Number(req.body.warehouse_id || req.body.receiving_warehouse_id || 0) || 0;
    const receivedDate = req.body.received_date || new Date().toISOString().slice(0, 10);
    const receivedBy = String(req.body.received_by || '').trim() || null;
    const notes = String(req.body.notes || '').trim() || null;

    if (!poId) {
      return res.status(400).json({ error: 'Purchase order is required.' });
    }
    if (!warehouseId) {
      return res.status(400).json({ error: 'Receiving warehouse is required.' });
    }

    try {
      const poRows = await queryAsync('SELECT id, business_entity_id, status FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
      if (!Array.isArray(poRows) || !poRows.length) {
        return res.status(404).json({ error: 'Purchase order not found.' });
      }
      if (normalizeProcurementWorkflowStatus(poRows[0].status) !== 'approved') {
        return res.status(400).json({ error: 'Approve this purchase order before receiving goods.' });
      }
      const businessEntityId = await resolveBusinessEntityId(poRows[0].business_entity_id || req.body.business_entity_id || null);
      await applyGoodsReceiptProductMappings({
        poId,
        businessEntityId,
        mappings: normalizeGoodsReceiptProductMappings(req.body)
      });
      if (!grnNumber) {
        grnNumber = await generateNextEntityDocumentNo({
          businessEntityId,
          documentType: 'goods-receipt',
          prefix: 'GRN',
          tableName: 'goods_receipts',
          columnName: 'grn_number'
        });
      }

      // Partial receiving: per-line quantities to receive now. If omitted, receive all remaining.
      let lineReceipts = null;
      if (Array.isArray(req.body.line_receipts) && req.body.line_receipts.length) {
        lineReceipts = new Map();
        let totalRequested = 0;
        req.body.line_receipts.forEach((entry) => {
          const lineId = Number(entry && entry.po_line_item_id) || 0;
          const qty = Math.max(0, Number(entry && entry.qty) || 0);
          if (lineId) { lineReceipts.set(lineId, qty); totalRequested += qty; }
        });
        if (totalRequested <= 0) {
          return res.status(400).json({ error: 'Enter at least one received quantity.' });
        }
      }

      const result = await queryAsync(
        'INSERT INTO goods_receipts (grn_number, po_id, received_date, received_by, status, notes) VALUES (?, ?, ?, ?, ?, ?)',
        [grnNumber, poId, receivedDate, receivedBy, 'received', notes]
      );
      await postInventoryReceiptForPurchaseOrder({
        poId,
        receiptId: result.insertId,
        grnNumber,
        businessEntityId,
        warehouseId,
        receivedDate,
        receivedBy,
        notes,
        lineReceipts
      });
      await claimEntityDocumentNo({
        businessEntityId,
        documentType: 'goods-receipt',
        prefix: 'GRN',
        documentNo: grnNumber
      });
      // Only close the PO once every line is fully received; otherwise it stays open
      // (approved) so the remaining balance can be received in a later GRN.
      const fullyReceived = await isPurchaseOrderFullyReceived(poId);
      if (fullyReceived) await markPurchaseOrderReceived(poId);
      const serialsCreated = await createSerialUnitsFromReceipt({
        poId,
        warehouseId,
        businessEntityId,
        serialGroups: req.body.serials,
        receivedBy
      });

      logAction(req, 'CREATE_GOODS_RECEIPT', `Created goods receipt ${grnNumber}${fullyReceived ? ' (PO fully received)' : ' (partial receipt)'}`, 'procurement', { entityType: 'goods_receipt', entityId: result.insertId, businessEntityId });
      res.json({ id: result.insertId, grn_number: grnNumber, inventory_synced: true, serials_created: serialsCreated, fully_received: fullyReceived });
    } catch (err) {
      if (isPostgresUniqueViolation(err)) {
        return res.status(409).json({ error: 'GRN number already exists.' });
      }
      const validationMessage = String(err?.message || '').toLowerCase();
      if (validationMessage.includes('product') || validationMessage.includes('inventory') || validationMessage.includes('map all') || validationMessage.includes('warehouse')) {
        return res.status(400).json({ error: err.message || 'Unable to receive goods.' });
      }
      console.error('Create goods receipt error:', err);
      res.status(500).json({ error: err.message || 'Unable to create goods receipt.' });
    }
  });

  router.put('/api/procurement/goods-receipts/:id', protectAdmin, async (req, res) => {
    const receiptId = Number(req.params.id || 0);
    let grnNumber = String(req.body.grn_number || '').trim();
    const poId = Number(req.body.po_id || 0);
    const warehouseId = Number(req.body.warehouse_id || req.body.receiving_warehouse_id || 0) || 0;
    const receivedDate = req.body.received_date || new Date().toISOString().slice(0, 10);
    const receivedBy = String(req.body.received_by || '').trim() || null;
    let status = 'received';
    const notes = String(req.body.notes || '').trim() || null;

    if (!receiptId) {
      return res.status(400).json({ error: 'Goods receipt ID is required.' });
    }
    if (!poId) {
      return res.status(400).json({ error: 'Purchase order is required.' });
    }
    if (status === 'received' && !warehouseId) {
      return res.status(400).json({ error: 'Receiving warehouse is required.' });
    }

    try {
      const receiptRows = await queryAsync('SELECT id, status FROM goods_receipts WHERE id = ? LIMIT 1', [receiptId]);
      if (!Array.isArray(receiptRows) || !receiptRows.length) {
        return res.status(404).json({ error: 'Goods receipt not found.' });
      }
      status = normalizeProcurementWorkflowStatus(receiptRows[0].status) || 'received';
      const poRows = await queryAsync('SELECT id, business_entity_id FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
      if (!Array.isArray(poRows) || !poRows.length) {
        return res.status(404).json({ error: 'Purchase order not found.' });
      }
      // 3-way-match integrity: once the PO has a bill, its goods receipt is locked from editing.
      // Changing the received quantities/mappings would move the received value the bill was matched
      // against, leaving billed > received. Archive/void the bill first if a correction is needed.
      const grnBillRows = await queryAsync('SELECT COUNT(*)::int AS count FROM accounts_payable WHERE po_id = ?', [poId]);
      if (Number(grnBillRows?.[0]?.count || 0) > 0) {
        return res.status(409).json({ error: 'May bill na ang PO ng goods receipt na ito — naka-lock na ito para hindi magkaiba sa bill (3-way match). I-archive/void muna ang bill bago baguhin ang receipt.' });
      }
      const businessEntityId = await resolveBusinessEntityId(poRows[0].business_entity_id || req.body.business_entity_id);
      await applyGoodsReceiptProductMappings({
        poId,
        businessEntityId,
        mappings: normalizeGoodsReceiptProductMappings(req.body)
      });
      if (!grnNumber) {
        grnNumber = await generateNextEntityDocumentNo({
          businessEntityId,
          documentType: 'goods-receipt',
          prefix: 'GRN',
          tableName: 'goods_receipts',
          columnName: 'grn_number'
        });
      }

      await queryAsync(
        'UPDATE goods_receipts SET grn_number = ?, po_id = ?, received_date = ?, received_by = ?, status = ?, notes = ? WHERE id = ?',
        [grnNumber, poId, receivedDate, receivedBy, status, notes, receiptId]
      );
      const receiptItemRows = await queryAsync('SELECT COUNT(*)::int AS count FROM goods_receipt_items WHERE receipt_id = ?', [receiptId]);
      if (status === 'received' && Number(receiptItemRows?.[0]?.count || 0) === 0) {
        await postInventoryReceiptForPurchaseOrder({
          poId,
          receiptId,
          grnNumber,
          businessEntityId,
          warehouseId,
          receivedDate,
          receivedBy,
          notes
        });
      }
      if (status === 'received') {
        await markPurchaseOrderReceived(poId);
      }
      await claimEntityDocumentNo({
        businessEntityId,
        documentType: 'goods-receipt',
        prefix: 'GRN',
        documentNo: grnNumber
      });

      logAction(req, 'UPDATE_GOODS_RECEIPT', `Updated goods receipt ${grnNumber}`, 'procurement', { entityType: 'goods_receipt', entityId: Number(req.params.id), businessEntityId });
      res.json({ success: true, grn_number: grnNumber, inventory_synced: status === 'received' });
    } catch (err) {
      if (isPostgresUniqueViolation(err)) {
        return res.status(409).json({ error: 'GRN number already exists.' });
      }
      const validationMessage = String(err?.message || '').toLowerCase();
      if (validationMessage.includes('product') || validationMessage.includes('inventory') || validationMessage.includes('map all') || validationMessage.includes('warehouse')) {
        return res.status(400).json({ error: err.message || 'Unable to update goods receipt.' });
      }
      console.error('Update goods receipt error:', err);
      res.status(500).json({ error: err.message || 'Unable to update goods receipt.' });
    }
  });

  router.delete('/api/procurement/goods-receipts/:id', protectAdminOnly, async (req, res) => {
    try {
      const result = await queryAsync('UPDATE goods_receipts SET archived = TRUE, archived_at = COALESCE(archived_at, NOW()) WHERE id = ?', [Number(req.params.id || 0)]);
      logAction(req, 'ARCHIVE_GOODS_RECEIPT', `Archived goods receipt ID: ${req.params.id}`, 'procurement', { entityType: 'goods_receipt', entityId: Number(req.params.id || 0), severity: 'warning' });
      res.json({ success: true, affectedRows: result.affectedRows || 0 });
    } catch (err) {
      console.error('Archive goods receipt error:', err);
      res.status(500).json({ error: err.message || 'Unable to archive goods receipt.' });
    }
  });

  router.get('/api/procurement/requisitions', protectAdmin, async (req, res) => {
    try {
      const actor = getAuthenticatedUser(req) || {};
      const conditions = [];
      const params = [];
      conditions.push('COALESCE(r.archived, FALSE) = FALSE');
      if (isStaffRole(actor.role)) {
        const staffTerms = [actor.fullname, actor.username, actor.email]
          .map(value => String(value || '').trim().toLowerCase())
          .filter(value => value.length >= 3);
        const staffClauses = [];
        staffTerms.forEach((term) => {
          const like = `%${term}%`;
          staffClauses.push(`(
            LOWER(COALESCE(r.requested_by, '')) LIKE ?
            OR LOWER(COALESCE(r.requested_by_email, '')) LIKE ?
            OR LOWER(COALESCE(r.submitted_by, '')) LIKE ?
            OR LOWER(COALESCE(p.project_manager, '')) LIKE ?
            OR LOWER(COALESCE(p.members, '')) LIKE ?
            OR LOWER(COALESCE(p.project_members, '')) LIKE ?
            OR LOWER(COALESCE(p.project_members_2, '')) LIKE ?
            OR LOWER(COALESCE(p.project_members_3, '')) LIKE ?
          )`);
          params.push(like, like, like, like, like, like, like, like);
        });
        const actorId = Number(actor.id || 0) || 0;
        if (actorId) {
          staffClauses.push('p.created_by = ?');
          params.push(actorId);
          staffClauses.push('p.assigned_to = ?');
          params.push(actorId);
        }
        conditions.push(staffClauses.length ? `(${staffClauses.join(' OR ')})` : '1=0');
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const [requisitions, items] = await Promise.all([
        queryAsync(`
          SELECT
            r.*,
            r.pdfFilename AS "pdfFilename",
            r.company_id AS company_id,
            be.company_name AS business_entity_name,
            be.entity_code AS business_entity_code,
            c.company_name,
            c.company_no,
            p.project_docno,
            p.project_name,
            COALESCE(p.is_archived, FALSE) AS project_is_archived
          FROM purchase_requisitions r
          LEFT JOIN business_entities be ON be.id = r.business_entity_id
          LEFT JOIN company_registry c ON c.id = r.company_id
          LEFT JOIN projects p ON p.id = r.project_id
          ${where}
          ORDER BY r.request_date DESC, r.id DESC
        `, params),
        queryAsync(`
          SELECT *
          FROM purchase_requisition_items
          ORDER BY pr_id ASC, id ASC
        `)
      ]);

      const itemsByPr = new Map();
      (Array.isArray(items) ? items : []).forEach((item) => {
        const prId = Number(item.pr_id || 0);
        if (!prId) return;
        const bucket = itemsByPr.get(prId) || [];
        bucket.push({
          ...item,
          quantity: Number(item.quantity || 0),
          estimated_unit_price: Number(item.estimated_unit_price || 0),
          unit_price: Number(item.estimated_unit_price || 0),
          line_total: Number(item.line_total || 0)
        });
        itemsByPr.set(prId, bucket);
      });

      const rows = (Array.isArray(requisitions) ? requisitions : []).map((row) => {
        const lineItems = itemsByPr.get(Number(row.id || 0)) || [];
        const totalAmount = lineItems.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
        const firstItem = lineItems[0] || {};
        return {
          ...row,
          line_items: lineItems,
          item_count: lineItems.length,
          total_amount: totalAmount,
          item_summary: lineItems.map((item) => String(item.item_name || '').trim()).filter(Boolean).join(' | '),
          item_name: firstItem.item_name || null,
          item_description: firstItem.description || null,
          quantity: firstItem.quantity || null,
          unit: firstItem.unit || null,
          unit_price: firstItem.estimated_unit_price || null,
          line_total: firstItem.line_total || null
        };
      });
      res.json(rows);
    } catch (err) {
      console.error('Requisitions error:', err);
      res.status(500).json({ error: err.message || 'Unable to load requisitions.' });
    }
  });

  router.get('/api/procurement/purchase-orders', protectAdmin, async (req, res) => {
    try {
      const conditions = [];
      conditions.push('COALESCE(po.archived, FALSE) = FALSE');
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const [purchaseOrders, lineItems, bills] = await Promise.all([
        queryAsync(`
        SELECT
          po.*,
          be.company_name AS business_entity_name,
          be.entity_code AS business_entity_code,
          r.pr_number AS requisition_number,
          v.vendor_name,
          COALESCE(po.company_id, r.company_id) AS company_id,
          c.company_name,
          c.company_no,
          p.project_docno,
          p.project_name,
          COALESCE(p.is_archived, FALSE) AS project_is_archived,
          q.quote_number AS source_quote_number,
          (SELECT COUNT(*) FROM accounts_payable ap WHERE ap.po_id = po.id) AS bill_count,
          (SELECT COUNT(*) FROM goods_receipts gr WHERE gr.po_id = po.id) AS goods_receipt_count,
          (SELECT COUNT(*) FROM documents d WHERE d.module_name = 'purchase_order' AND d.record_id = po.id) AS document_count
        FROM purchase_orders po
        LEFT JOIN business_entities be ON be.id = po.business_entity_id
        LEFT JOIN purchase_requisitions r ON r.id = po.requisition_id
        LEFT JOIN vendors v ON v.id = po.vendor_id
        LEFT JOIN company_registry c ON c.id = COALESCE(po.company_id, r.company_id)
        LEFT JOIN projects p ON p.id = po.project_id
        LEFT JOIN procurement_quotations q ON q.id = po.quotation_id
        ${where}
          ORDER BY po.po_date DESC, po.id DESC
        `),
        queryAsync(`
          SELECT
            li.*
          FROM po_line_items li
          ORDER BY li.po_id ASC, li.id ASC
        `),
        queryAsync(`
          SELECT id, po_id, bill_number, bill_date, due_date, total_amount, paid_amount, status
          FROM accounts_payable
          WHERE po_id IS NOT NULL
          ORDER BY po_id ASC, due_date ASC, id ASC
        `)
      ]);

      const itemsByPo = new Map();
      (Array.isArray(lineItems) ? lineItems : []).forEach((item) => {
        const poId = Number(item.po_id || 0);
        if (!poId) return;

        const bucket = itemsByPo.get(poId) || [];
        bucket.push({
          ...item,
          quantity: Number(item.quantity || 0),
          unit_price: Number(item.unit_price || 0),
          line_total: Number(item.line_total || 0),
          description: String(item.description || '').trim(),
          display_label: String(item.description || '').trim()
        });
        itemsByPo.set(poId, bucket);
      });

      const billsByPo = new Map();
      (Array.isArray(bills) ? bills : []).forEach((bill) => {
        const poId = Number(bill.po_id || 0);
        if (!poId) return;
        const bucket = billsByPo.get(poId) || [];
        bucket.push({
          ...bill,
          total_amount: Number(bill.total_amount || 0),
          paid_amount: Number(bill.paid_amount || 0)
        });
        billsByPo.set(poId, bucket);
      });

      const rows = (Array.isArray(purchaseOrders) ? purchaseOrders : []).map((po) => {
        const items = itemsByPo.get(Number(po.id || 0)) || [];
        const poBills = billsByPo.get(Number(po.id || 0)) || [];
        const computedTotal = items.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
        return {
          ...po,
          line_items: items,
          bill_details: poBills,
          line_count: items.length,
          bill_count: poBills.length || Number(po.bill_count || 0),
          computed_total: computedTotal || Number(po.total_amount || 0),
          item_summary: buildPurchaseOrderItemSummary(items)
        };
      });

      res.json(rows);
    } catch (err) {
      console.error('Purchase orders error:', err);
      res.status(500).json({ error: err.message || 'Unable to load purchase orders.' });
    }
  });

  router.get('/api/procurement/quotations', protectAdmin, async (req, res) => {
    try {
      const conditions = [];
      conditions.push('COALESCE(q.archived, FALSE) = FALSE');
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await queryAsync(`
        SELECT q.*,
               r.pr_number,
               r.business_entity_id,
               r.status AS requisition_status,
               r.company_id,
               r.project_id,
               v.vendor_name,
               c.company_name,
               c.company_no,
               p.project_docno,
               p.project_name
        FROM procurement_quotations q
        JOIN purchase_requisitions r ON r.id = q.requisition_id
        LEFT JOIN vendors v ON v.id = q.vendor_id
        LEFT JOIN company_registry c ON c.id = r.company_id
        LEFT JOIN projects p ON p.id = r.project_id
        ${where}
        ORDER BY q.quote_date DESC, q.id DESC
      `);
      res.json((Array.isArray(rows) ? rows : []).map((row) => ({
        ...row,
        quoted_total: Number(row.quoted_total || 0),
        delivery_days: Number(row.delivery_days || 0)
      })));
    } catch (err) {
      console.error('Quotations error:', err);
      if (isPostgresUndefinedTable(err) || isPostgresUndefinedColumn(err)) return res.json([]);
      res.status(500).json({ error: err.message || 'Unable to load quotations.' });
    }
  });

  router.post('/api/procurement/requisitions', protectAdmin, async (req, res) => {
    let prNumber = String(req.body.pr_number || '').trim();
    let companyId = Number(req.body.company_id || 0) || 0;
    const projectId = Number(req.body.project_id || 0) || null;
    // PR type: 'project' (raised from a project) vs 'stock' (direct stock request, no
    // project/company). Defaults from context: a project id means a project PR.
    const prType = String(req.body.pr_type || (projectId ? 'project' : 'stock')).trim().toLowerCase() === 'stock' ? 'stock' : 'project';
    const requestDate = req.body.request_date || new Date().toISOString().slice(0, 10);
    const department = String(req.body.department || '').trim() || null;
    const requestedBy = String(req.body.requested_by || '').trim() || null;
    const neededBy = req.body.needed_by || null;
    // Staff file PR "requests" (draft + DFT- number) that need approval; admins
    // create an official, approved PR that lands directly in the requisitions table.
    const actor = getAuthenticatedUser(req) || {};
    const actorIsStaff = isStaffRole(actor.role);
    const status = actorIsStaff ? 'draft' : 'approved';
    const notes = String(req.body.notes || '').trim() || null;
    const lineItems = normalizePurchaseRequisitionLineItems(req.body);

    if (!lineItems.length) {
      return res.status(400).json({ error: 'At least one item name and quantity are required.' });
    }
    if (prType === 'project' && !projectId) {
      return res.status(400).json({ error: 'Project is required for a project purchase requisition.' });
    }
    if (!requestDate) {
      return res.status(400).json({ error: 'Request date is required.' });
    }
    if (!requestedBy) {
      return res.status(400).json({ error: 'Requested by is required.' });
    }
    if (!neededBy) {
      return res.status(400).json({ error: 'Needed by date is required.' });
    }

    try {
      let projectRecord = null;
      let companyRecord = null;
      let businessEntityId;
      if (prType === 'project') {
        projectRecord = await resolvePurchaseOrderProjectContext(projectId, companyId);
        companyId = Number(projectRecord?.company_id || 0) || 0;
        businessEntityId = await resolveBusinessEntityId(projectRecord?.business_entity_id || req.body.business_entity_id);
        ({ companyRecord } = await resolvePurchaseRequisitionContext(companyId));
        await resolvePurchaseOrderProjectContext(projectRecord.id, companyRecord.id);
      } else {
        // Stock PR: no project, no customer/company — just the operating business entity.
        businessEntityId = await resolveBusinessEntityId(req.body.business_entity_id);
      }
      if (actorIsStaff) {
        if (!prNumber || !isDraftDocumentNo(prNumber)) {
          prNumber = await generateNextDraftEntityDocumentNo({
            businessEntityId,
            documentType: 'purchase-requisition',
            prefix: 'PR',
            tableName: 'purchase_requisitions',
            columnName: 'pr_number'
          });
        }
      } else {
        prNumber = await generateNextEntityDocumentNo({
          businessEntityId,
          documentType: 'purchase-requisition',
          prefix: 'PR',
          tableName: 'purchase_requisitions',
          columnName: 'pr_number'
        });
      }
      const requestedByEmail = await getAuthenticatedUserEmail(req);
      const reqResult = await queryAsync(
        'INSERT INTO purchase_requisitions (pr_number, business_entity_id, company_id, project_id, pr_type, request_date, department, requested_by, requested_by_email, needed_by, status, notes, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          prNumber,
          businessEntityId,
          companyRecord?.id || null,
          projectRecord?.id || null,
          prType,
          requestDate,
          department,
          requestedBy,
          requestedByEmail || null,
          neededBy,
          status,
          notes,
          actorIsStaff ? null : getApprovalActorName(req),
          actorIsStaff ? null : new Date()
        ]
      );
      await claimEntityDocumentNo({
        businessEntityId,
        documentType: 'purchase-requisition',
        prefix: 'PR',
        documentNo: prNumber
      });

      for (const item of lineItems) {
        const lineTotal = Number(item.quantity || 0) * Number(item.estimated_unit_price || 0);
        await queryAsync(
          'INSERT INTO purchase_requisition_items (pr_id, product_id, category, warehouse_id, item_name, description, quantity, unit, estimated_unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [reqResult.insertId, item.product_id || null, item.category || null, item.warehouse_id || null, item.item_name, item.description, item.quantity, item.unit, item.estimated_unit_price, lineTotal]
        );
      }

      logAction(req, 'CREATE_PURCHASE_REQUISITION', `Created requisition ${prNumber}`, 'procurement', { entityType: 'purchase_requisition', entityId: reqResult.insertId });
      res.json({ id: reqResult.insertId, pr_number: prNumber });
    } catch (err) {
      if (isPostgresUniqueViolation(err)) {
        return res.status(409).json({ error: 'PR number already exists.' });
      }
      const validationMessage = String(err?.message || '').toLowerCase();
      if (validationMessage.includes('required') || validationMessage.includes('same company') || validationMessage.includes('not found') || validationMessage.includes('archived')) {
        return res.status(400).json({ error: err.message || 'Unable to create requisition.' });
      }
      console.error('Create requisition error:', err);
      res.status(500).json({ error: err.message || 'Unable to create requisition.' });
    }
  });

  // Generate a Purchase Requisition from an approved Sales Order (sales-driven procurement).
  // The PR lands in the Approval Center (status 'submitted' + DFT- number → official on approval),
  // pre-filled with the SO's project, customer, Customer PO ref and line items — editable before approve.
  router.post('/api/procurement/requisitions/from-sales-order/:soId', protectAdmin, async (req, res) => {
    const soId = Number(req.params.soId || 0);
    if (!soId) return res.status(400).json({ error: 'Invalid sales order ID.' });
    try {
      const soRows = await queryAsync(
        'SELECT id, document_no, record_type, status, project_id, company_id, business_entity_id, customer_po_ref, target_date FROM sales_management_records WHERE id = ? LIMIT 1',
        [soId]);
      const so = soRows && soRows[0];
      if (!so || String(so.record_type) !== 'sales-order') return res.status(404).json({ error: 'Sales Order not found.' });
      if (!['approved', 'won'].includes(String(so.status || '').toLowerCase())) {
        return res.status(400).json({ error: 'Only an approved Sales Order can generate a Purchase Requisition.' });
      }
      if (!Number(so.project_id || 0)) {
        return res.status(400).json({ error: 'The Sales Order has no linked project to raise a project PR against.' });
      }
      // One PR per SO — block a duplicate.
      const dup = await queryAsync(
        "SELECT id, pr_number FROM purchase_requisitions WHERE source_sales_record_id = ? AND COALESCE(status, '') <> 'cancelled' ORDER BY id ASC LIMIT 1",
        [soId]);
      if (dup && dup.length) {
        return res.status(409).json({ error: `May Purchase Requisition na (${dup[0].pr_number}) para sa Sales Order na ito.` });
      }
      const items = await queryAsync('SELECT product_id, warehouse_id, description, quantity, unit_price FROM sales_record_items WHERE sales_record_id = ? ORDER BY id ASC', [soId]);
      if (!items.length) return res.status(400).json({ error: 'The Sales Order has no line items to requisition.' });

      const businessEntityId = await resolveBusinessEntityId(so.business_entity_id);
      const prNumber = await generateNextDraftEntityDocumentNo({
        businessEntityId, documentType: 'purchase-requisition', prefix: 'PR',
        tableName: 'purchase_requisitions', columnName: 'pr_number'
      });
      const actorName = getApprovalActorName(req) || getAuthenticatedUser(req)?.fullname || 'System';
      const requestedByEmail = await getAuthenticatedUserEmail(req);
      const notes = `From Sales Order ${so.document_no || ('#' + soId)}${so.customer_po_ref ? ` · Customer PO: ${so.customer_po_ref}` : ''}`;
      const reqResult = await queryAsync(
        "INSERT INTO purchase_requisitions (pr_number, business_entity_id, company_id, project_id, pr_type, request_date, department, requested_by, requested_by_email, needed_by, status, notes, source_sales_record_id, submitted_by, submitted_at) VALUES (?, ?, ?, ?, 'project', ?, NULL, ?, ?, ?, 'submitted', ?, ?, ?, NOW())",
        [prNumber, businessEntityId, Number(so.company_id || 0) || null, Number(so.project_id), getManilaYmd(), actorName, requestedByEmail || null, so.target_date || getManilaYmd(), notes, soId, actorName]);
      await claimEntityDocumentNo({ businessEntityId, documentType: 'purchase-requisition', prefix: 'PR', documentNo: prNumber });
      for (const it of items) {
        const qty = Number(it.quantity || 0) || 0;
        const price = Number(it.unit_price || 0) || 0;
        await queryAsync(
          'INSERT INTO purchase_requisition_items (pr_id, product_id, category, warehouse_id, item_name, description, quantity, unit, estimated_unit_price, line_total) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?)',
          [reqResult.insertId, it.product_id || null, it.warehouse_id || null, String(it.description || 'Item'), String(it.description || ''), qty, price, qty * price]);
      }
      logAction(req, 'GENERATE_PR_FROM_SO', `Generated PR ${prNumber} from Sales Order ${so.document_no || ('#' + soId)}`, 'procurement', { entityType: 'purchase_requisition', entityId: reqResult.insertId, businessEntityId });
      res.json({ id: reqResult.insertId, pr_number: prNumber, status: 'submitted' });
    } catch (err) {
      console.error('Generate PR from SO error:', err);
      res.status(500).json({ error: err.message || 'Unable to generate Purchase Requisition.' });
    }
  });

  router.put('/api/procurement/requisitions/:id', protectAdmin, async (req, res) => {
    const requisitionId = Number(req.params.id || 0);
    let prNumber = String(req.body.pr_number || '').trim();
    let companyId = Number(req.body.company_id || 0) || 0;
    const projectId = Number(req.body.project_id || 0) || null;
    const requestDate = req.body.request_date || new Date().toISOString().slice(0, 10);
    const department = String(req.body.department || '').trim() || null;
    const requestedBy = String(req.body.requested_by || '').trim() || null;
    const neededBy = req.body.needed_by || null;
    let status = 'draft';
    const notes = String(req.body.notes || '').trim() || null;
    const lineItems = normalizePurchaseRequisitionLineItems(req.body);

    if (!requisitionId) {
      return res.status(400).json({ error: 'Requisition ID is required.' });
    }
    if (!lineItems.length) {
      return res.status(400).json({ error: 'At least one item name and quantity are required.' });
    }
    if (!projectId) {
      return res.status(400).json({ error: 'Project is required for purchase requisitions.' });
    }
    if (!requestDate) {
      return res.status(400).json({ error: 'Request date is required.' });
    }
    if (!requestedBy) {
      return res.status(400).json({ error: 'Requested by is required.' });
    }
    if (!neededBy) {
      return res.status(400).json({ error: 'Needed by date is required.' });
    }

    try {
      const requisitionRows = await queryAsync(`
        SELECT r.id, r.status, r.requested_by, r.requested_by_email, r.submitted_by, r.department,
               p.created_by, p.assigned_to, p.project_manager, p.members,
               p.project_members, p.project_members_2, p.project_members_3
        FROM purchase_requisitions r
        LEFT JOIN projects p ON p.id = r.project_id
        WHERE r.id = ?
        LIMIT 1
      `, [requisitionId]);
      if (!Array.isArray(requisitionRows) || !requisitionRows.length) {
        return res.status(404).json({ error: 'Requisition not found.' });
      }
      const actor = getAuthenticatedUser(req) || {};
      if (isStaffRole(actor.role) && !requisitionRowMatchesStaffActor(requisitionRows[0], actor)) {
        return sendStaffRecordAccessDenied(res, 'Requisition');
      }
      status = normalizeProcurementWorkflowStatus(requisitionRows[0].status) || 'draft';
      if (procurementRequisitionIsLocked(status)) {
        return res.status(409).json({ error: `Purchase requisition is already ${status} and can no longer be edited.` });
      }

      const projectRecord = await resolvePurchaseOrderProjectContext(projectId, companyId);
      if (isStaffRole(actor.role) && !projectRowMatchesStaffActor(projectRecord || {}, actor)) {
        return sendStaffRecordAccessDenied(res, 'Project');
      }
      companyId = Number(projectRecord?.company_id || 0) || 0;
      const businessEntityId = await resolveBusinessEntityId(projectRecord?.business_entity_id || req.body.business_entity_id);
      if (!prNumber) {
        prNumber = await generateNextEntityDocumentNo({
          businessEntityId,
          documentType: 'purchase-requisition',
          prefix: 'PR',
          tableName: 'purchase_requisitions',
          columnName: 'pr_number'
        });
      }
      const { companyRecord } = await resolvePurchaseRequisitionContext(companyId);
      await resolvePurchaseOrderProjectContext(projectRecord.id, companyRecord.id);

      const existingRequesterEmail = String(requisitionRows[0].requested_by_email || '').trim();
      const requestedByEmail = existingRequesterEmail || await getAuthenticatedUserEmail(req);
      await queryAsync(
        `UPDATE purchase_requisitions
         SET pr_number = ?, business_entity_id = ?, company_id = ?, project_id = ?, request_date = ?, department = ?, requested_by = ?, requested_by_email = ?, needed_by = ?, status = ?, notes = ?
         WHERE id = ?`,
        [
          prNumber,
          businessEntityId,
          companyRecord.id,
          projectRecord.id,
          requestDate,
          department,
          requestedBy,
          requestedByEmail || null,
          neededBy,
          status,
          notes,
          requisitionId
        ]
      );

      await queryAsync('DELETE FROM purchase_requisition_items WHERE pr_id = ?', [requisitionId]);
      await claimEntityDocumentNo({
        businessEntityId,
        documentType: 'purchase-requisition',
        prefix: 'PR',
        documentNo: prNumber
      });

      for (const item of lineItems) {
        const lineTotal = Number(item.quantity || 0) * Number(item.estimated_unit_price || 0);
        await queryAsync(
          'INSERT INTO purchase_requisition_items (pr_id, product_id, category, warehouse_id, item_name, description, quantity, unit, estimated_unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [requisitionId, item.product_id || null, item.category || null, item.warehouse_id || null, item.item_name, item.description, item.quantity, item.unit, item.estimated_unit_price, lineTotal]
        );
      }

      logAction(req, 'UPDATE_PURCHASE_REQUISITION', `Updated requisition ${prNumber}`, 'procurement', { entityType: 'purchase_requisition', entityId: requisitionId });
      res.json({ success: true, pr_number: prNumber });
    } catch (err) {
      if (isPostgresUniqueViolation(err)) {
        return res.status(409).json({ error: 'PR number already exists.' });
      }
      const validationMessage = String(err?.message || '').toLowerCase();
      if (validationMessage.includes('required') || validationMessage.includes('same company') || validationMessage.includes('not found') || validationMessage.includes('archived')) {
        return res.status(400).json({ error: err.message || 'Unable to update requisition.' });
      }
      console.error('Update requisition error:', err);
      res.status(500).json({ error: err.message || 'Unable to update requisition.' });
    }
  });

  router.post('/api/procurement/purchase-orders', protectAdmin, async (req, res) => {
    let poNumber = String(req.body.po_number || '').trim();
    const vendorId = Number(req.body.vendor_id || 0);
    const requisitionId = Number(req.body.requisition_id || 0) || null;
    const quotationId = Number(req.body.quotation_id || 0) || null;
    const explicitBusinessEntityId = Number(req.body.business_entity_id || 0) || null;
    const explicitCompanyId = Number(req.body.company_id || 0) || 0;
    const projectId = Number(req.body.project_id || 0) || null;
    const poDate = req.body.po_date || new Date().toISOString().slice(0, 10);
    const deliveryDate = req.body.delivery_date || null;
    const paymentTerms = String(req.body.payment_terms || '').trim() || null;
    const preparedBy = String(req.body.prepared_by || '').trim() || null;
    const approvedBy = String(req.body.approved_by || '').trim() || null;
    const notes = String(req.body.notes || '').trim() || null;
    let lineItems = normalizePurchaseOrderLineItems(req.body);

    if (!vendorId || !lineItems.length) {
      return res.status(400).json({ error: 'Vendor and at least one line item description are required.' });
    }
    if (!requisitionId) {
      return res.status(400).json({ error: 'Approved purchase requisition is required before creating a purchase order.' });
    }
    if (!quotationId) {
      return res.status(400).json({ error: 'Approved RFQ is required before creating a purchase order.' });
    }

    const totalAmount = lineItems.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unit_price || 0)), 0);

    try {
      const actor = getAuthenticatedUser(req) || {};
      const adminCreatesApprovedPo = isAdminRole(actor.role);
      const status = adminCreatesApprovedPo ? 'approved' : 'draft';
      const approvedByName = adminCreatesApprovedPo ? getApprovalActorName(req) : approvedBy;
      let draftPoNumber = null;

      const vendorRows = await queryAsync(
        'SELECT id, vendor_no, vendor_name, business_entity_id, COALESCE(is_active, TRUE) AS is_active FROM vendors WHERE id = ? LIMIT 1',
        [vendorId]
      );
      if (!Array.isArray(vendorRows) || !vendorRows.length) {
        return res.status(404).json({ error: 'Vendor not found.' });
      }
      if (Number(vendorRows[0].is_active || 0) !== 1) {
        return res.status(400).json({ error: 'Vendor is inactive. Activate the vendor before using it in a purchase order.' });
      }

      const { companyRecord, requisitionRow } = await resolvePurchaseOrderRequisitionContext(
        requisitionId,
        explicitCompanyId,
        { requireApproved: true, allowOrdered: true }
      );
      if (requisitionRow?.id) {
        const existingPoRows = await queryAsync(
          'SELECT id, po_number FROM purchase_orders WHERE requisition_id = ? LIMIT 1',
          [requisitionRow.id]
        );
        if (existingPoRows.length) {
          return res.status(409).json({ error: `Selected requisition already has PO ${existingPoRows[0].po_number || existingPoRows[0].id}.` });
        }
      }
      const businessEntityId = await resolveBusinessEntityId(explicitBusinessEntityId || requisitionRow?.business_entity_id || null);
      if (adminCreatesApprovedPo) {
        if (!poNumber || isDraftDocumentNo(poNumber)) {
          draftPoNumber = poNumber || null;
          poNumber = await generateNextEntityDocumentNo({
            businessEntityId,
            documentType: 'purchase-order',
            prefix: 'PO',
            tableName: 'purchase_orders',
            columnName: 'po_number'
          });
        }
      } else if (!poNumber || !isDraftDocumentNo(poNumber)) {
        poNumber = await generateNextDraftEntityDocumentNo({
          businessEntityId,
          documentType: 'purchase-order',
          prefix: 'PO',
          tableName: 'purchase_orders',
          columnName: 'po_number'
        });
      }
      const projectRecord = await resolvePurchaseOrderProjectContext(projectId || requisitionRow?.project_id || null, companyRecord?.id || explicitCompanyId || 0);
      const quotationRow = await resolvePurchaseOrderQuotationContext(quotationId, requisitionRow?.id || requisitionId || 0, vendorId);
      const resolvedCompanyId = Number(companyRecord?.id || projectRecord?.company_id || 0) || null;
      lineItems = await sanitizePurchaseOrderLineProducts(lineItems, businessEntityId);
      const poResult = await queryAsync(
        'INSERT INTO purchase_orders (po_number, requisition_id, quotation_id, business_entity_id, vendor_id, company_id, project_id, po_date, delivery_date, payment_terms, prepared_by, approved_by, total_amount, status, notes, draft_po_number, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? THEN NOW() ELSE NULL END)',
        [poNumber, requisitionRow?.id || null, quotationRow?.id || null, businessEntityId, vendorId, resolvedCompanyId, projectRecord?.id || null, poDate, deliveryDate, paymentTerms, preparedBy, approvedByName || null, totalAmount, status, notes, draftPoNumber, adminCreatesApprovedPo]
      );
      await claimEntityDocumentNo({
        businessEntityId,
        documentType: 'purchase-order',
        prefix: 'PO',
        documentNo: poNumber
      });

      for (const item of lineItems) {
        const lineTotal = Number(item.quantity || 0) * Number(item.unit_price || 0);
        await queryAsync(
          'INSERT INTO po_line_items (po_id, product_id, description, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)',
          [poResult.insertId, item.product_id || null, item.description, item.quantity, item.unit_price, lineTotal]
        );
      }
      if (requisitionRow?.id) {
        await markRequisitionOrdered(requisitionRow.id);
      }

      logAction(req, 'CREATE_PURCHASE_ORDER', `Created purchase order ${poNumber}`, 'procurement', { entityType: 'purchase_order', entityId: poResult.insertId });

      if (adminCreatesApprovedPo) {
        logAction(req, 'APPROVE_PURCHASE_ORDER', `Auto-approved purchase order ${poNumber}${draftPoNumber ? ` (Draft ${draftPoNumber})` : ''}`, 'procurement', { entityType: 'purchase_order', entityId: poResult.insertId, changes: [{ field: 'status', from: 'draft', to: 'approved' }] });
        sendBackgroundNotification(() => notifyPurchaseOrderRequester(req, poResult.insertId, 'approved', {
          approvedBy: getApprovalActorLabel(req)
        }), 'purchase order approved email');
        sendBackgroundNotification(() => notifyPurchaseOrderVendor(req, poResult.insertId), 'purchase order vendor email');
        return res.json({ id: poResult.insertId, po_number: poNumber, status, approved_by: approvedByName });
      }

      res.json({ id: poResult.insertId, po_number: poNumber, status });
    } catch (err) {
      if (isPostgresUniqueViolation(err)) {
        return res.status(409).json({ error: 'PO number already exists.' });
      }
      const validationMessage = String(err?.message || '').toLowerCase();
      if (validationMessage.includes('required') || validationMessage.includes('must match') || validationMessage.includes('same company') || validationMessage.includes('not found') || validationMessage.includes('approved') || validationMessage.includes('archived') || validationMessage.includes('quotation')) {
        return res.status(400).json({ error: err.message || 'Unable to create purchase order.' });
      }
      console.error('Create purchase order error:', err);
      res.status(500).json({ error: err.message || 'Unable to create purchase order.' });
    }
  });

  router.post('/api/procurement/purchase-orders/:id/generate-bills', protectAdmin, async (req, res) => {
    const poId = Number(req.params.id || 0);
    if (!poId) {
      return res.status(400).json({ error: 'Purchase order ID is required.' });
    }

    try {
      const { po, createdBills } = await withDbTransaction(async (connection) => {
        const poRows = await connectionQueryAsync(
          connection,
          `SELECT id, po_number, business_entity_id, vendor_id, project_id, po_date, delivery_date,
                  total_amount, payment_terms, status
           FROM purchase_orders
           WHERE id = ? LIMIT 1
           FOR UPDATE`,
          [poId]
        );
        if (!Array.isArray(poRows) || !poRows.length) {
          const err = new Error('Purchase order not found.');
          err.statusCode = 404;
          throw err;
        }

        const existingBills = await connectionQueryAsync(connection, 'SELECT id FROM accounts_payable WHERE po_id = ? LIMIT 1', [poId]);
        if (existingBills.length) {
          const err = new Error('This PO already has AP bill(s).');
          err.statusCode = 409;
          throw err;
        }

        const po = poRows[0];
        if (!['approved', 'received'].includes(normalizeProcurementWorkflowStatus(po.status))) {
          const err = new Error('Approve this purchase order before generating AP bills.');
          err.statusCode = 400;
          throw err;
        }

        const receiptRows = await connectionQueryAsync(connection, 'SELECT id FROM goods_receipts WHERE po_id = ? LIMIT 1', [poId]);
        if (!receiptRows.length) {
          const err = new Error('Record a goods receipt before generating AP bills for this PO.');
          err.statusCode = 400;
          throw err;
        }

        const schedule = parsePurchaseOrderPaymentTerms(po.payment_terms, po.total_amount);
        if (!schedule.length) {
          const err = new Error('Payment terms must include percentage terms like "30% downpayment, 70% upon delivery".');
          err.statusCode = 400;
          throw err;
        }
        const percentTotal = schedule.reduce((sum, term) => sum + Number(term.percent || 0), 0);
        if (Math.abs(percentTotal - 100) > 0.05) {
          const err = new Error(`Payment terms must total 100%. Current total is ${Number(percentTotal.toFixed(2))}%.`);
          err.statusCode = 400;
          throw err;
        }

        const businessEntityId = await resolveBusinessEntityId(po.business_entity_id);
        const createdBills = [];
        for (const term of schedule) {
          const billNumber = await generateNextEntityDocumentNo({
            businessEntityId,
            documentType: 'ap-bill',
            prefix: 'BILL',
            tableName: 'accounts_payable',
            columnName: 'bill_number'
          });
          const dueDate = resolveTermDueDate(term, po.po_date, po.delivery_date);
          const notes = `Generated from ${po.po_number}: ${term.percent}% ${term.label}`;
          const result = await connectionQueryAsync(
            connection,
            'INSERT INTO accounts_payable (business_entity_id, vendor_id, bill_number, bill_date, due_date, project_id, po_id, total_amount, approval_status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [businessEntityId, po.vendor_id, billNumber, po.po_date || getManilaYmd(), dueDate, po.project_id || null, poId, term.amount, 'pending', notes]
          );
          createdBills.push({
            id: result.insertId,
            bill_number: billNumber,
            amount: term.amount,
            percent: term.percent,
            label: term.label
          });
        }
        return { po, createdBills };
      });

      logAction(req, 'GENERATE_PO_BILLS', `Generated ${createdBills.length} AP bill(s) from PO ${po.po_number}`, 'finance', { entityType: 'purchase_order', entityId: po.id, businessEntityId: po.business_entity_id });
      res.json({ success: true, bills: createdBills });
    } catch (err) {
      if (err?.statusCode) {
        return res.status(err.statusCode).json({ error: err.message || 'Unable to generate AP bills from PO.' });
      }
      if (isPostgresUniqueViolation(err)) {
        return res.status(409).json({ error: 'A generated bill number already exists.' });
      }
      console.error('Generate PO bills error:', err);
      res.status(500).json({ error: err.message || 'Unable to generate AP bills from PO.' });
    }
  });

  router.post('/api/procurement/requisitions/:id/email-rfq', protectAdmin, async (req, res) => {
    const requisitionId = Number(req.params.id || 0) || 0;
    if (!requisitionId) return res.status(400).json({ error: 'Requisition ID is required.' });

    const vendorIds = Array.isArray(req.body.vendor_ids)
      ? Array.from(new Set(req.body.vendor_ids.map((v) => Number(v) || 0).filter(Boolean)))
      : [];
    if (!vendorIds.length) return res.status(400).json({ error: 'Select at least one vendor to email.' });

    const deadline = String(req.body.deadline || '').trim() || null;
    const customMessage = String(req.body.message || '').trim() || null;

    try {
      if (!hasEmailConfig && !RESEND_API_KEY) {
        return res.status(400).json({ error: 'Email is not configured on the server (SMTP/Resend). Cannot send RFQ emails.' });
      }

      const prRows = await queryAsync(
        'SELECT id, pr_number, status, business_entity_id, rfq_emailed_to, rfq_email_count FROM purchase_requisitions WHERE id = ? LIMIT 1',
        [requisitionId]
      );
      if (!prRows.length) return res.status(404).json({ error: 'Purchase requisition not found.' });
      if (!['approved', 'ordered'].includes(normalizeProcurementWorkflowStatus(prRows[0].status))) {
        return res.status(400).json({ error: 'Only approved requisitions can be sent to vendors for quotation.' });
      }

      const vendorRows = await queryAsync(
        `SELECT id, vendor_name, email FROM vendors WHERE id IN (${vendorIds.map(() => '?').join(',')})`,
        vendorIds
      );
      if (!vendorRows.length) return res.status(404).json({ error: 'Selected vendors were not found.' });

      const prNumber = prRows[0].pr_number || `PR-${requisitionId}`;
      const results = [];
      for (const vendor of vendorRows) {
        const email = String(vendor.email || '').trim();
        const name = String(vendor.vendor_name || `Vendor ${vendor.id}`).trim();
        if (!email || !isValidEmail(email)) {
          results.push({ vendor_id: vendor.id, vendor_name: name, sent: false, reason: 'No valid email on file' });
          continue;
        }
        const token = await ensureRfqVendorLink(requisitionId, vendor.id, prRows[0].business_entity_id, deadline);
        const portalUrl = `${APP_BASE_URL}/rfq/${token}`;
        const attachment = await buildRfqRequestPdfAttachment(requisitionId, {
          deadline, message: customMessage, vendorName: name, portalUrl
        });
        const deadlineLine = deadline ? `Quote deadline: ${formatPdfDate(deadline)}` : 'Kindly send your quotation as soon as possible.';
        const sendResult = await sendSystemEmail({
          from: `Kinaadman ERP <${SMTP_FROM}>`,
          to: email,
          subject: `Request for Quotation — ${prNumber}`,
          attachments: [{ filename: attachment.filename, content: attachment.content, contentType: 'application/pdf' }],
          text: [
            `Dear ${name},`,
            '',
            `We would like to request your quotation for the items listed in the attached RFQ (${prNumber}).`,
            deadlineLine,
            '',
            `Submit your quotation online (fill in your unit prices): ${portalUrl}`,
            customMessage ? `\n${customMessage}` : '',
            '',
            `Thank you,`,
            attachment.businessEntityName || 'Kinaadman ERP'
          ].filter((line) => line !== undefined).join('\n'),
          html: `
            <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.55;">
              <p style="margin:0 0 12px;">Dear ${htmlEscape(name)},</p>
              <p style="margin:0 0 12px;">We would like to request your quotation for the items listed in the attached <strong>Request for Quotation (${htmlEscape(prNumber)})</strong>.</p>
              <p style="margin:0 0 12px;">${htmlEscape(deadlineLine)}</p>
              <p style="margin:18px 0;">
                <a href="${htmlEscape(portalUrl)}" style="background:#b42318;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;display:inline-block;font-weight:600;">Submit your quotation online</a>
              </p>
              <p style="margin:0 0 12px;font-size:12px;color:#6b7280;">Or copy this link: ${htmlEscape(portalUrl)}</p>
              ${customMessage ? `<p style="margin:0 0 12px;">${htmlEscape(customMessage)}</p>` : ''}
              <p style="margin:16px 0 0;">Thank you,<br>${htmlEscape(attachment.businessEntityName || 'Kinaadman ERP')}</p>
            </div>
          `
        });
        results.push({
          vendor_id: vendor.id,
          vendor_name: name,
          email,
          sent: !!sendResult.sent,
          reason: sendResult.sent ? '' : (sendResult.reason || 'Send failed')
        });
      }

      const sentCount = results.filter((r) => r.sent).length;

      // Record on the PR so the table can show "RFQ emailed to ... on <date>".
      const sentVendorNames = results.filter((r) => r.sent).map((r) => r.vendor_name);
      if (sentVendorNames.length) {
        const previous = String(prRows[0].rfq_emailed_to || '')
          .split(',').map((s) => s.trim()).filter(Boolean);
        const mergedNames = Array.from(new Set([...previous, ...sentVendorNames]));
        await queryAsync(
          'UPDATE purchase_requisitions SET rfq_emailed_at = NOW(), rfq_emailed_to = ?, rfq_email_count = COALESCE(rfq_email_count, 0) + ? WHERE id = ?',
          [mergedNames.join(', '), sentVendorNames.length, requisitionId]
        );
      }

      logAction(req, 'EMAIL_RFQ', `PR: ${prNumber} | Sent to ${sentCount}/${results.length} vendor(s): ${results.map((r) => `${r.vendor_name}${r.sent ? '' : ' (failed)'}`).join(', ')}`);
      res.json({ status: 'success', sent: sentCount, total: results.length, results });
    } catch (err) {
      console.error('Email RFQ error:', err);
      res.status(500).json({ error: err.message || 'Unable to email RFQ to vendors.' });
    }
  });

  router.put('/api/procurement/purchase-orders/:id', protectAdmin, async (req, res) => {
    const poId = Number(req.params.id || 0);
    let poNumber = String(req.body.po_number || '').trim();
    const vendorId = Number(req.body.vendor_id || 0);
    const requisitionId = Number(req.body.requisition_id || 0) || null;
    const quotationId = Number(req.body.quotation_id || 0) || null;
    const explicitBusinessEntityId = Number(req.body.business_entity_id || 0) || null;
    const explicitCompanyId = Number(req.body.company_id || 0) || 0;
    const projectId = Number(req.body.project_id || 0) || null;
    const poDate = req.body.po_date || new Date().toISOString().slice(0, 10);
    const deliveryDate = req.body.delivery_date || null;
    const paymentTerms = String(req.body.payment_terms || '').trim() || null;
    const preparedBy = String(req.body.prepared_by || '').trim() || null;
    const approvedBy = String(req.body.approved_by || '').trim() || null;
    const notes = String(req.body.notes || '').trim() || null;
    let status = 'draft';
    let lineItems = normalizePurchaseOrderLineItems(req.body);

    if (!poId) {
      return res.status(400).json({ error: 'Purchase order ID is required.' });
    }
    if (!vendorId || !lineItems.length) {
      return res.status(400).json({ error: 'Vendor and at least one line item description are required.' });
    }
    if (!requisitionId) {
      return res.status(400).json({ error: 'Approved purchase requisition is required before updating a purchase order.' });
    }

    try {
      const poRows = await queryAsync('SELECT id, requisition_id, status FROM purchase_orders WHERE id = ? LIMIT 1', [poId]);
      if (!Array.isArray(poRows) || !poRows.length) {
        return res.status(404).json({ error: 'Purchase order not found.' });
      }
      const currentRequisitionId = Number(poRows[0].requisition_id || 0) || 0;
      status = normalizeProcurementWorkflowStatus(poRows[0].status) || 'draft';

      const vendorRows = await queryAsync(
        'SELECT id, vendor_no, vendor_name, business_entity_id, COALESCE(is_active, TRUE) AS is_active FROM vendors WHERE id = ? LIMIT 1',
        [vendorId]
      );
      if (!Array.isArray(vendorRows) || !vendorRows.length) {
        return res.status(404).json({ error: 'Vendor not found.' });
      }
      if (Number(vendorRows[0].is_active || 0) !== 1) {
        return res.status(400).json({ error: 'Vendor is inactive. Activate the vendor before using it in a purchase order.' });
      }

      const totalAmount = lineItems.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unit_price || 0)), 0);
      const isSameRequisition = Boolean(requisitionId && currentRequisitionId && Number(requisitionId) === currentRequisitionId);
      const { companyRecord, requisitionRow } = await resolvePurchaseOrderRequisitionContext(
        requisitionId,
        explicitCompanyId,
        { requireApproved: true, allowOrdered: isSameRequisition }
      );
      const businessEntityId = await resolveBusinessEntityId(explicitBusinessEntityId || requisitionRow?.business_entity_id || null);
      const projectRecord = await resolvePurchaseOrderProjectContext(projectId || requisitionRow?.project_id || null, companyRecord?.id || explicitCompanyId || 0);
      const quotationRow = await resolvePurchaseOrderQuotationContext(quotationId, requisitionRow?.id || requisitionId || 0, vendorId);
      const resolvedCompanyId = Number(companyRecord?.id || projectRecord?.company_id || 0) || null;
      lineItems = await sanitizePurchaseOrderLineProducts(lineItems, businessEntityId);
      if (!poNumber || !isDraftDocumentNo(poNumber)) {
        poNumber = await generateNextDraftEntityDocumentNo({
          businessEntityId,
          documentType: 'purchase-order',
          prefix: 'PO',
          tableName: 'purchase_orders',
          columnName: 'po_number'
        });
      }
      await queryAsync(
        'UPDATE purchase_orders SET po_number = ?, requisition_id = ?, quotation_id = ?, business_entity_id = ?, vendor_id = ?, company_id = ?, project_id = ?, po_date = ?, delivery_date = ?, payment_terms = ?, prepared_by = ?, approved_by = ?, total_amount = ?, status = ?, notes = ? WHERE id = ?',
        [poNumber, requisitionRow?.id || null, quotationRow?.id || null, businessEntityId, vendorId, resolvedCompanyId, projectRecord?.id || null, poDate, deliveryDate, paymentTerms, preparedBy, approvedBy, totalAmount, status, notes, poId]
      );

      await queryAsync('DELETE FROM po_line_items WHERE po_id = ?', [poId]);
      for (const item of lineItems) {
        const lineTotal = Number(item.quantity || 0) * Number(item.unit_price || 0);
        await queryAsync(
          'INSERT INTO po_line_items (po_id, product_id, description, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)',
          [poId, item.product_id || null, item.description, item.quantity, item.unit_price, lineTotal]
        );
      }
      if (requisitionRow?.id) {
        await markRequisitionOrdered(requisitionRow.id);
      }
      await claimEntityDocumentNo({
        businessEntityId,
        documentType: 'purchase-order',
        prefix: 'PO',
        documentNo: poNumber
      });

      logAction(req, 'UPDATE_PURCHASE_ORDER', `Updated purchase order ${poNumber}`, 'procurement', { entityType: 'purchase_order', entityId: Number(req.params.id), businessEntityId });
      res.json({ success: true, po_number: poNumber });
    } catch (err) {
      if (isPostgresUniqueViolation(err)) {
        return res.status(409).json({ error: 'PO number already exists.' });
      }
      const validationMessage = String(err?.message || '').toLowerCase();
      if (validationMessage.includes('required') || validationMessage.includes('must match') || validationMessage.includes('same company') || validationMessage.includes('not found') || validationMessage.includes('approved') || validationMessage.includes('archived') || validationMessage.includes('quotation')) {
        return res.status(400).json({ error: err.message || 'Unable to update purchase order.' });
      }
      console.error('Update purchase order error:', err);
      res.status(500).json({ error: err.message || 'Unable to update purchase order.' });
    }
  });

  router.get('/api/procurement/requisitions/:id/pdf', protectAdmin, async (req, res) => {
    const requisitionId = Number(req.params.id || 0);
    if (!requisitionId) return res.status(400).json({ error: 'Requisition ID is required.' });

    try {
      const rows = await queryAsync(
        `SELECT r.id, r.pr_number, r.status, r.pdfFilename AS "pdfFilename",
                r.requested_by, r.requested_by_email, r.submitted_by, r.department,
                p.created_by, p.assigned_to, p.project_manager, p.members,
                p.project_members, p.project_members_2, p.project_members_3
         FROM purchase_requisitions r
         LEFT JOIN projects p ON p.id = r.project_id
         WHERE r.id = ?
         LIMIT 1`,
        [requisitionId]
      );
      if (!rows.length) {
        return res.status(404).json({ error: 'Purchase requisition not found.' });
      }

      const record = rows[0];
      const actor = getAuthenticatedUser(req) || {};
      if (isStaffRole(actor.role) && !requisitionRowMatchesStaffActor(record, actor)) {
        return sendStaffRecordAccessDenied(res, 'Purchase requisition');
      }
      if (isAdminRole(getAuthenticatedUser(req)?.role) && normalizeProcurementWorkflowStatus(record.status || 'draft') === 'draft') {
        return res.status(404).json({ error: 'Purchase requisition not found.' });
      }
      let safeFilename = record.pdfFilename ? path.basename(record.pdfFilename) : '';
      let filePath = safeFilename ? path.join(UPLOAD_DIR, safeFilename) : '';

      if (shouldRegenerateErpPdfFile(safeFilename, filePath, 'purchase-requisition')) {
        const generated = await generatePurchaseRequisitionPdfFile(requisitionId);
        safeFilename = generated.filename;
        filePath = generated.filePath;
      }

      const disposition = String(req.query.download || '') === '1' ? 'attachment' : 'inline';
      res.type('application/pdf');
      res.setHeader('Content-Disposition', `${disposition}; filename="${safeFilename}"`);
      return res.sendFile(filePath);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Unable to generate purchase requisition PDF.' });
    }
  });

  return router;
};
