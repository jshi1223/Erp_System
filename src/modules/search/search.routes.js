// Global document search — powers the dashboard search box. Returns navigable results
// ({ type, label, sub, url, state }). Three states drive role behavior + routing:
//   - 'official' : approved / has an official number.
//   - 'pending'  : submitted, awaiting approval (i.e. actually IN the Approval Center).
//   - 'draft'    : work-in-progress, NOT yet submitted (lives in its module, NOT the Approval Center).
// Role-aware:
//   - STAFF  → non-official only (pending + draft), scoped to their current workspace.
//   - ADMIN  → everything; a result is routed to the Approval Center ONLY if it's truly pending AND
//              of a type the Approval Center tracks (`ac:true`). Plain drafts/leads go to their module.
// `ac` matters because the Approval Center only lists pending PR/PO/Bill/Project/Sales (+ master-data
// requests); CRM leads approve in /crm, so routing a "draft" lead there would land on an empty page.
// DI factory — MUST be app.use-mounted in server.js (see ARCHITECTURE rule).
const express = require('express');
const { queryAsync } = require('../../database');
const { protectAdmin, getAuthenticatedUser, isStaffRole } = require('../../middleware/auth');

const PENDING_STATUSES = new Set(['pending', 'submitted', 'for_approval', 'for approval']);

module.exports = function createSearchRouter() {
  const router = express.Router();

  router.get('/api/search', protectAdmin, async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ results: [] });
    const like = `%${q}%`;
    const results = [];
    const enc = (v) => encodeURIComponent(String(v || ''));
    const lookup = async (fn) => { try { await fn(); } catch (_) { /* table may not exist yet */ } };

    // Resolve a doc's state from its status + whether it carries a draft (non-official) marker.
    const stateOf = (status, isDraftDoc) => {
      const s = String(status || '').trim().toLowerCase();
      if (PENDING_STATUSES.has(s)) return 'pending';
      return isDraftDoc ? 'draft' : 'official';
    };

    // Who's asking + which workspace. Staff are limited to non-official docs in their workspace.
    const user = getAuthenticatedUser(req) || {};
    const staff = typeof isStaffRole === 'function' ? isStaffRole(user.role) : false;
    const entityRaw = String(req.query.business_entity_id || '').trim().toLowerCase();
    const scopeEntityId = (entityRaw && entityRaw !== 'all') ? (Number(req.query.business_entity_id) || 0) : 0;

    await Promise.all([
      lookup(async () => {
        const rows = await queryAsync(
          "SELECT pr_number, draft_pr_number, status, business_entity_id FROM purchase_requisitions WHERE pr_number ILIKE ? OR (COALESCE(pr_number, '') = '' AND draft_pr_number ILIKE ?) ORDER BY id DESC LIMIT 5", [like, like]);
        rows.forEach((r) => { const n = r.pr_number || r.draft_pr_number; results.push({ type: 'Purchase Requisition', label: n, sub: 'Procurement', url: `/procurement?tab=requisitions&q=${enc(n)}`, state: stateOf(r.status, !r.pr_number && !!r.draft_pr_number), ac: true, entityId: r.business_entity_id }); });
      }),
      lookup(async () => {
        const rows = await queryAsync(
          "SELECT quote_number, draft_quote_number, status FROM procurement_quotations WHERE quote_number ILIKE ? OR draft_quote_number ILIKE ? ORDER BY id DESC LIMIT 5", [like, like]);
        rows.forEach((r) => { const n = r.quote_number || r.draft_quote_number; results.push({ type: 'RFQ / Quotation', label: n, sub: 'Procurement', url: `/procurement?tab=quotations&q=${enc(n)}`, state: stateOf(r.status, !r.quote_number && !!r.draft_quote_number), ac: false, entityId: null }); });
      }),
      lookup(async () => {
        const rows = await queryAsync(
          "SELECT po_number, draft_po_number, status, business_entity_id FROM purchase_orders WHERE po_number ILIKE ? OR draft_po_number ILIKE ? ORDER BY id DESC LIMIT 5", [like, like]);
        rows.forEach((r) => { const n = r.po_number || r.draft_po_number; results.push({ type: 'Purchase Order', label: n, sub: 'Procurement', url: `/procurement?tab=purchase-orders&q=${enc(n)}`, state: stateOf(r.status, !r.po_number && !!r.draft_po_number), ac: true, entityId: r.business_entity_id }); });
      }),
      lookup(async () => {
        const rows = await queryAsync("SELECT grn_number, status FROM goods_receipts WHERE grn_number ILIKE ? ORDER BY id DESC LIMIT 5", [like]);
        rows.forEach((r) => results.push({ type: 'Goods Receipt', label: r.grn_number, sub: 'Procurement', url: `/procurement?tab=goods-receipts&q=${enc(r.grn_number)}`, state: stateOf(r.status, false), ac: false, entityId: null }));
      }),
      lookup(async () => {
        // Match the bill number OR the vendor's own invoice number (reference) OR the draft no.
        const rows = await queryAsync("SELECT bill_number, invoice_number, draft_bill_number, status, business_entity_id FROM accounts_payable WHERE bill_number ILIKE ? OR invoice_number ILIKE ? OR draft_bill_number ILIKE ? ORDER BY id DESC LIMIT 5", [like, like, like]);
        rows.forEach((r) => { const n = r.bill_number || r.draft_bill_number; results.push({ type: 'AP Bill', label: n, sub: r.invoice_number ? `Vendor Inv: ${r.invoice_number}` : 'Accounts Payable', url: `/accounts-payable?tab=bills&q=${enc(n)}`, state: stateOf(r.status, !r.bill_number && !!r.draft_bill_number), ac: true, entityId: r.business_entity_id }); });
      }),
      lookup(async () => {
        // Match the AR invoice no. OR its source sales document OR the customer name (references).
        const rows = await queryAsync("SELECT invoice_number, customer_name, sales_document_no, status, business_entity_id FROM accounts_receivable WHERE invoice_number ILIKE ? OR sales_document_no ILIKE ? OR customer_name ILIKE ? ORDER BY id DESC LIMIT 5", [like, like, like]);
        rows.forEach((r) => results.push({ type: 'AR Invoice', label: r.invoice_number, sub: r.customer_name || r.sales_document_no || 'Accounts Receivable', url: `/accounts-receivable?tab=invoices&q=${enc(r.invoice_number)}`, state: stateOf(r.status, false), ac: false, entityId: r.business_entity_id }));
      }),
      lookup(async () => {
        const rows = await queryAsync(
          "SELECT id, project_docno, draft_docno, project_name, status, business_entity_id FROM projects WHERE project_docno ILIKE ? OR draft_docno ILIKE ? OR project_name ILIKE ? ORDER BY id DESC LIMIT 5", [like, like, like]);
        rows.forEach((r) => { const n = r.project_docno || r.draft_docno || r.project_name; results.push({ type: 'Project', label: n, sub: r.project_name || 'Project', url: `/admin?panel=project-records&q=${enc(n)}`, state: stateOf(r.status, !r.project_docno && !!r.draft_docno), ac: true, entityId: r.business_entity_id }); });
      }),
      lookup(async () => {
        const rows = await queryAsync(
          "SELECT company_no, company_name, business_entity_id FROM company_registry WHERE company_no ILIKE ? OR company_name ILIKE ? ORDER BY id DESC LIMIT 5", [like, like]);
        rows.forEach((r) => results.push({ type: 'Company', label: r.company_name, sub: r.company_no || 'Company Registry', url: `/master-data?tab=companies&q=${enc(r.company_no || r.company_name)}`, state: 'official', ac: false, entityId: r.business_entity_id }));
      }),
      lookup(async () => {
        const rows = await queryAsync(
          "SELECT vendor_no, vendor_name, business_entity_id FROM vendors WHERE vendor_no ILIKE ? OR vendor_name ILIKE ? ORDER BY id DESC LIMIT 5", [like, like]);
        rows.forEach((r) => results.push({ type: 'Vendor', label: r.vendor_name, sub: r.vendor_no || 'Vendors', url: `/master-data?tab=vendors&q=${enc(r.vendor_no || r.vendor_name)}`, state: 'official', ac: false, entityId: r.business_entity_id }));
      }),
      lookup(async () => {
        // Match the sales document no. OR the customer's PO reference. Drafts carry a DFT- prefix.
        const rows = await queryAsync(
          "SELECT document_no, record_type, customer_po_ref, status, business_entity_id FROM sales_management_records WHERE document_no ILIKE ? OR customer_po_ref ILIKE ? ORDER BY id DESC LIMIT 5", [like, like]);
        rows.forEach((r) => { const isDraftDoc = String(r.document_no || '').toUpperCase().startsWith('DFT-'); results.push({ type: 'Sales', label: r.document_no, sub: r.customer_po_ref ? `Cust PO: ${r.customer_po_ref}` : (r.record_type || 'Sales Management'), url: `/sales-management?q=${enc(r.document_no)}`, state: stateOf(r.status, isDraftDoc), ac: true, entityId: r.business_entity_id }); });
      }),
      lookup(async () => {
        // CRM lead — match Lead No, lead name, or the customer company. Leads approve in /crm,
        // NOT the Approval Center, so ac:false (route stays on the CRM page).
        const rows = await queryAsync(
          "SELECT lead_docno, lead_name, company_name, approval_status, business_entity_id FROM crm_leads WHERE archived = FALSE AND (lead_docno ILIKE ? OR lead_name ILIKE ? OR company_name ILIKE ?) ORDER BY id DESC LIMIT 5", [like, like, like]);
        rows.forEach((r) => { const ap = String(r.approval_status || 'approved').toLowerCase(); results.push({ type: 'Lead', label: r.lead_docno || r.lead_name, sub: r.lead_name || r.company_name || 'CRM Pipeline', url: `/crm?tab=leads&q=${enc(r.lead_docno || r.lead_name)}`, state: ap === 'approved' ? 'official' : (ap === 'pending' ? 'pending' : 'draft'), ac: false, entityId: r.business_entity_id }); });
      })
    ]);

    let out;
    if (staff) {
      // Staff see only non-official docs, scoped to their workspace (sources without an entity column pass through).
      out = results.filter((r) => r.state !== 'official' && (!scopeEntityId || r.entityId == null || Number(r.entityId) === scopeEntityId));
    } else {
      // Admin sees everything; only genuinely-pending, Approval-Center-tracked hits route there.
      out = results.map((r) => ((r.state === 'pending' && r.ac)
        ? Object.assign({}, r, { url: `/admin?panel=approval-center&q=${enc(r.label)}` })
        : r));
    }

    res.json({ results: out.slice(0, 24) });
  });

  return router;
};
