// Company Registry — staff request / approval workflow (sub-module of company-registry).
// Extracted from server.js (step 6c — see src/ARCHITECTURE.md). Drafts created by staff
// (DFT- numbers) flow submit -> approve/reject/revise; admins create approved records directly.
// Shared infra imported; server-specific helpers injected.
const express = require('express');
const { queryAsync } = require('../../../database');
const {
  protectAdmin,
  protectAdminOnly,
  getAuthenticatedUser,
  isAdminRole,
  isStaffRole
} = require('../../../middleware/auth');

module.exports = function createCompanyRegistryRequestsRouter(deps) {
  const {
    generateDraftRequestNo,
    sanitizeCompanyRegistryPayload,
    validateCompanyRegistryPayload,
    assertCompanyRegistryPayloadUnique,
    insertApprovedCompanyRegistryFromRequest,
    stripDraftRequestNoPrefix,
    getApprovalActorName,
    getApprovalComment,
    appendApprovalComment,
    logAction
  } = deps;
  const router = express.Router();

  router.get('/api/company-registry-requests/next-draft-no', protectAdmin, async (req, res) => {
    try {
      const draftNo = await generateDraftRequestNo('CMP');
      res.json({ draft_no: draftNo });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/company-registry-requests', protectAdmin, async (req, res) => {
    try {
      const actor = getAuthenticatedUser(req);
      const admin = isAdminRole(actor?.role);
      const rows = await queryAsync(`
        SELECT *
        FROM company_registry_requests
        ${admin ? '' : 'WHERE requested_by_email = ? OR requested_by = ?'}
        ORDER BY COALESCE(submitted_at, created_at) DESC, id DESC
      `, admin ? [] : [actor?.email || '', actor?.fullname || actor?.username || '']);
      res.json((Array.isArray(rows) ? rows : []).map((row) => {
        let payload = {};
        try { payload = JSON.parse(row.payload || '{}'); } catch (_) {}
        return Object.assign({}, row, { payload });
      }));
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to load company registry requests.' });
    }
  });

  router.post('/api/company-registry-requests', protectAdmin, async (req, res) => {
    try {
      const actor = getAuthenticatedUser(req);
      const isStaff = isStaffRole(actor?.role || '');
      const payload = sanitizeCompanyRegistryPayload(req.body || {});
      validateCompanyRegistryPayload(payload);
      if (isStaff) {
        const requestNo = await generateDraftRequestNo('CMP');
        await queryAsync(`
          INSERT INTO company_registry_requests
            (request_no, payload, status, requested_by, requested_by_email, submitted_at)
          VALUES (?, ?, 'draft', ?, ?, NULL)
        `, [requestNo, JSON.stringify(payload), actor?.fullname || actor?.username || null, actor?.email || null]);
        logAction(req, 'CREATE_COMPANY_REGISTRY_DRAFT', `Draft: ${requestNo} | Company Name: ${payload.company_name}`);
        return res.status(201).json({ success: true, request_no: requestNo, status: 'draft' });
      }
      // Admin creates the company directly (official number, approved, no queue).
      await assertCompanyRegistryPayloadUnique(payload);
      const companyNo = await insertApprovedCompanyRegistryFromRequest(payload);
      const requestNo = stripDraftRequestNoPrefix(await generateDraftRequestNo('CMP'));
      const approvedBy = getApprovalActorName(req);
      await queryAsync(`
        INSERT INTO company_registry_requests
          (request_no, payload, status, requested_by, requested_by_email, submitted_at, approved_by, approved_at)
        VALUES (?, ?, 'approved', ?, ?, NOW(), ?, NOW())
      `, [requestNo, JSON.stringify(payload), actor?.fullname || actor?.username || null, actor?.email || null, approvedBy]);
      logAction(req, 'CREATE_COMPANY_REGISTRY_OFFICIAL', `Official: ${requestNo} | Company No: ${companyNo} | Company Name: ${payload.company_name}`);
      res.status(201).json({ success: true, request_no: requestNo, status: 'approved', company_no: companyNo });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Unable to create company registry request.', field: err.field || null });
    }
  });

  router.post('/api/company-registry-requests/:id/submit', protectAdmin, async (req, res) => {
    try {
      const requestId = Number(req.params.id || 0);
      if (!requestId) return res.status(400).json({ error: 'Invalid request ID.' });
      const rows = await queryAsync('SELECT * FROM company_registry_requests WHERE id = ? LIMIT 1', [requestId]);
      const requestRow = rows?.[0];
      if (!requestRow) return res.status(404).json({ error: 'Company registry request not found.' });
      const currentStatus = String(requestRow.status || '').toLowerCase();
      if (currentStatus === 'submitted') return res.json({ success: true, status: 'submitted', alreadySubmitted: true });
      if (currentStatus !== 'draft' && currentStatus !== 'needs_revision') return res.status(400).json({ error: 'Only draft or returned-for-revision company requests can be submitted.' });

      // Resubmitting a returned request clears the prior revision note.
      await queryAsync(
        "UPDATE company_registry_requests SET status = 'submitted', submitted_at = NOW(), reject_reason = NULL WHERE id = ?",
        [requestId]
      );
      logAction(req, 'SUBMIT_COMPANY_REGISTRY_REQUEST', `Request No: ${requestRow.request_no || requestId}`);
      res.json({ success: true, status: 'submitted' });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to submit company registry request.' });
    }
  });

  router.put('/api/company-registry-requests/:id', protectAdmin, async (req, res) => {
    try {
      const actor = getAuthenticatedUser(req);
      const requestId = Number(req.params.id || 0);
      if (!requestId) return res.status(400).json({ error: 'Invalid request ID.' });
      const rows = await queryAsync('SELECT * FROM company_registry_requests WHERE id = ? LIMIT 1', [requestId]);
      const requestRow = rows?.[0];
      if (!requestRow) return res.status(404).json({ error: 'Company registry request not found.' });
      const companyEditStatus = String(requestRow.status || '').toLowerCase();
      if (companyEditStatus !== 'draft' && companyEditStatus !== 'needs_revision') {
        return res.status(400).json({ error: 'Only draft or returned-for-revision company requests can be edited.' });
      }
      if (isStaffRole(actor?.role) && String(requestRow.requested_by_email || '') !== String(actor?.email || '')) {
        return res.status(403).json({ error: 'You can edit your own draft requests only.' });
      }
      const payload = sanitizeCompanyRegistryPayload(req.body || {});
      validateCompanyRegistryPayload(payload);
      await queryAsync('UPDATE company_registry_requests SET payload = ? WHERE id = ?', [JSON.stringify(payload), requestId]);
      logAction(req, 'UPDATE_COMPANY_REGISTRY_DRAFT', `Draft No: ${requestRow.request_no || requestId} | Company Name: ${payload.company_name}`);
      res.json({ success: true, status: 'draft', request_no: requestRow.request_no });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Unable to update company request.', field: err.field || null });
    }
  });

  router.post('/api/company-registry-requests/:id/approve', protectAdminOnly, async (req, res) => {
    try {
      const requestId = Number(req.params.id || 0);
      if (!requestId) return res.status(400).json({ error: 'Invalid request ID.' });
      const rows = await queryAsync('SELECT * FROM company_registry_requests WHERE id = ? LIMIT 1', [requestId]);
      const requestRow = rows?.[0];
      if (!requestRow) return res.status(404).json({ error: 'Company registry request not found.' });
      const currentStatus = String(requestRow.status || '').toLowerCase();
      if (currentStatus === 'approved') return res.json({ success: true, status: 'approved', alreadyApproved: true });
      if (currentStatus !== 'submitted') return res.status(400).json({ error: 'Only submitted company requests can be approved.' });

      let payload = {};
      try { payload = JSON.parse(requestRow.payload || '{}'); } catch (_) {}
      payload = sanitizeCompanyRegistryPayload(payload);
      validateCompanyRegistryPayload(payload);
      await assertCompanyRegistryPayloadUnique(payload);
      const companyNo = await insertApprovedCompanyRegistryFromRequest(payload);
      const approvedBy = getApprovalActorName(req);
      const comment = getApprovalComment(req);
      // On approval the draft request number becomes official (strip the DRAFT- prefix).
      const officialRequestNo = stripDraftRequestNoPrefix(requestRow.request_no);
      await queryAsync(
        "UPDATE company_registry_requests SET request_no = ?, status = 'approved', approved_by = ?, approved_at = NOW(), reject_reason = NULL, approval_comment = ? WHERE id = ?",
        [officialRequestNo, approvedBy, comment || null, requestId]
      );
      logAction(req, 'APPROVE_COMPANY_REGISTRY_REQUEST', appendApprovalComment(`Draft No: ${requestRow.request_no || requestId} | Request No: ${officialRequestNo} | Company No: ${companyNo} | Company Name: ${payload.company_name}`, comment));
      res.json({ success: true, status: 'approved', company_no: companyNo, request_no: officialRequestNo, approved_by: approvedBy, approval_comment: comment });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Unable to approve company registry request.', field: err.field || null });
    }
  });

  router.post('/api/company-registry-requests/:id/reject', protectAdminOnly, async (req, res) => {
    try {
      const requestId = Number(req.params.id || 0);
      const reason = String(req.body?.reason || '').trim() || 'Rejected by admin.';
      if (!requestId) return res.status(400).json({ error: 'Invalid request ID.' });
      const rows = await queryAsync('SELECT request_no, status FROM company_registry_requests WHERE id = ? LIMIT 1', [requestId]);
      if (!rows?.[0]) return res.status(404).json({ error: 'Company registry request not found.' });
      if (String(rows[0].status || '').toLowerCase() !== 'submitted') {
        return res.status(400).json({ error: 'Only submitted company requests can be rejected.' });
      }
      await queryAsync(
        "UPDATE company_registry_requests SET status = 'rejected', approved_by = ?, approved_at = NOW(), reject_reason = ?, approval_comment = ? WHERE id = ?",
        [getApprovalActorName(req), reason, reason, requestId]
      );
      logAction(req, 'REJECT_COMPANY_REGISTRY_REQUEST', `Request No: ${rows[0].request_no || requestId} | Reason: ${reason}`);
      res.json({ success: true, status: 'rejected', reason });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Unable to reject company registry request.' });
    }
  });

  // Return a submitted request to the staff for revision (editable + resubmittable),
  // instead of a terminal reject. Mirrors the Purchase Requisition needs_revision flow.
  router.post('/api/company-registry-requests/:id/revise', protectAdminOnly, async (req, res) => {
    try {
      const requestId = Number(req.params.id || 0);
      const reason = String(req.body?.reason || '').trim() || 'Please revise and resubmit.';
      if (!requestId) return res.status(400).json({ error: 'Invalid request ID.' });
      const rows = await queryAsync('SELECT request_no, status FROM company_registry_requests WHERE id = ? LIMIT 1', [requestId]);
      if (!rows?.[0]) return res.status(404).json({ error: 'Company registry request not found.' });
      if (String(rows[0].status || '').toLowerCase() !== 'submitted') {
        return res.status(400).json({ error: 'Only submitted company requests can be returned for revision.' });
      }
      await queryAsync(
        "UPDATE company_registry_requests SET status = 'needs_revision', submitted_at = NULL, approved_by = NULL, approved_at = NULL, reject_reason = ?, approval_comment = ? WHERE id = ?",
        [reason, reason, requestId]
      );
      logAction(req, 'REVISE_COMPANY_REGISTRY_REQUEST', `Request No: ${rows[0].request_no || requestId} | Reason: ${reason}`);
      res.json({ success: true, status: 'needs_revision', reason });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Unable to return company registry request for revision.' });
    }
  });

  return router;
};
