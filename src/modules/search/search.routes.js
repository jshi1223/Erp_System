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

// Result types a staff member can actually open from their sidebar. Their global search must
// not surface docs from modules hidden to staff (AP bills, AR invoices, purchase orders, RFQs,
// goods receipts) — only types whose module appears in the staff nav. See [[role-based-sidebar-convention]].
const STAFF_SEARCHABLE_TYPES = new Set(['Purchase Requisition', 'Project', 'Sales', 'Lead', 'Company', 'Vendor']);

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
          "SELECT pr_number, draft_pr_number, status, business_entity_id, COALESCE(archived, FALSE) AS archived FROM purchase_requisitions WHERE pr_number ILIKE ? OR (COALESCE(pr_number, '') = '' AND draft_pr_number ILIKE ?) ORDER BY id DESC LIMIT 5", [like, like]);
        rows.forEach((r) => { const n = r.pr_number || r.draft_pr_number; results.push({ type: 'Purchase Requisition', label: n, sub: 'Procurement', url: `/procurement?tab=requisitions&q=${enc(n)}`, state: stateOf(r.status, !r.pr_number && !!r.draft_pr_number), ac: true, entityId: r.business_entity_id, archived: !!r.archived }); });
      }),
      lookup(async () => {
        const rows = await queryAsync(
          "SELECT quote_number, draft_quote_number, status, COALESCE(archived, FALSE) AS archived FROM procurement_quotations WHERE quote_number ILIKE ? OR (COALESCE(quote_number, '') = '' AND draft_quote_number ILIKE ?) ORDER BY id DESC LIMIT 5", [like, like]);
        rows.forEach((r) => { const n = r.quote_number || r.draft_quote_number; results.push({ type: 'RFQ / Quotation', label: n, sub: 'Procurement', url: `/procurement?tab=quotations&q=${enc(n)}`, state: stateOf(r.status, !r.quote_number && !!r.draft_quote_number), ac: false, entityId: null, archived: !!r.archived }); });
      }),
      lookup(async () => {
        const rows = await queryAsync(
          "SELECT po_number, draft_po_number, status, business_entity_id, COALESCE(archived, FALSE) AS archived FROM purchase_orders WHERE po_number ILIKE ? OR (COALESCE(po_number, '') = '' AND draft_po_number ILIKE ?) ORDER BY id DESC LIMIT 5", [like, like]);
        rows.forEach((r) => { const n = r.po_number || r.draft_po_number; results.push({ type: 'Purchase Order', label: n, sub: 'Procurement', url: `/procurement?tab=purchase-orders&q=${enc(n)}`, state: stateOf(r.status, !r.po_number && !!r.draft_po_number), ac: true, entityId: r.business_entity_id, archived: !!r.archived }); });
      }),
      lookup(async () => {
        const rows = await queryAsync("SELECT grn_number, status, COALESCE(archived, FALSE) AS archived FROM goods_receipts WHERE grn_number ILIKE ? ORDER BY id DESC LIMIT 5", [like]);
        rows.forEach((r) => results.push({ type: 'Goods Receipt', label: r.grn_number, sub: 'Procurement', url: `/procurement?tab=goods-receipts&q=${enc(r.grn_number)}`, state: stateOf(r.status, false), ac: false, entityId: null, archived: !!r.archived }));
      }),
      lookup(async () => {
        // Match the bill number OR the vendor's own invoice number (reference) OR the draft no.
        const rows = await queryAsync("SELECT bill_number, invoice_number, draft_bill_number, status, business_entity_id FROM accounts_payable WHERE bill_number ILIKE ? OR invoice_number ILIKE ? OR (COALESCE(bill_number, '') = '' AND draft_bill_number ILIKE ?) ORDER BY id DESC LIMIT 5", [like, like, like]);
        rows.forEach((r) => { const n = r.bill_number || r.draft_bill_number; results.push({ type: 'AP Bill', label: n, sub: r.invoice_number ? `Vendor Inv: ${r.invoice_number}` : 'Accounts Payable', url: `/accounts-payable?tab=bills&q=${enc(n)}`, state: stateOf(r.status, !r.bill_number && !!r.draft_bill_number), ac: true, entityId: r.business_entity_id }); });
      }),
      lookup(async () => {
        // Match the AR invoice no. OR its source sales document OR the customer name (references).
        const rows = await queryAsync("SELECT invoice_number, customer_name, sales_document_no, status, business_entity_id, COALESCE(archived, FALSE) AS archived FROM accounts_receivable WHERE invoice_number ILIKE ? OR sales_document_no ILIKE ? OR customer_name ILIKE ? ORDER BY id DESC LIMIT 5", [like, like, like]);
        rows.forEach((r) => results.push({ type: 'AR Invoice', label: r.invoice_number, sub: r.customer_name || r.sales_document_no || 'Accounts Receivable', url: `/accounts-receivable?tab=invoices&q=${enc(r.invoice_number)}`, state: stateOf(r.status, false), ac: false, entityId: r.business_entity_id, archived: !!r.archived }));
      }),
      lookup(async () => {
        const rows = await queryAsync(
          "SELECT id, project_docno, draft_docno, project_name, status, business_entity_id, COALESCE(is_archived, FALSE) AS archived FROM projects WHERE project_docno ILIKE ? OR (COALESCE(project_docno, '') = '' AND draft_docno ILIKE ?) OR project_name ILIKE ? ORDER BY id DESC LIMIT 5", [like, like, like]);
        rows.forEach((r) => { const n = r.project_docno || r.draft_docno || r.project_name; results.push({ type: 'Project', label: n, sub: r.project_name || 'Project', url: `${staff ? '/staff' : '/admin'}?panel=project-records&q=${enc(n)}`, state: stateOf(r.status, !r.project_docno && !!r.draft_docno), ac: true, entityId: r.business_entity_id, archived: !!r.archived }); });
      }),
      lookup(async () => {
        const rows = await queryAsync(
          "SELECT company_no, company_name, business_entity_id, COALESCE(archived, FALSE) AS archived FROM company_registry WHERE company_no ILIKE ? OR company_name ILIKE ? ORDER BY id DESC LIMIT 5", [like, like]);
        rows.forEach((r) => results.push({ type: 'Company', label: r.company_name, sub: r.company_no || 'Company Registry', url: `/master-data?tab=companies&q=${enc(r.company_no || r.company_name)}`, state: 'official', ac: false, entityId: r.business_entity_id, archived: !!r.archived }));
      }),
      lookup(async () => {
        const rows = await queryAsync(
          "SELECT vendor_no, vendor_name, business_entity_id FROM vendors WHERE vendor_no ILIKE ? OR vendor_name ILIKE ? ORDER BY id DESC LIMIT 5", [like, like]);
        rows.forEach((r) => results.push({ type: 'Vendor', label: r.vendor_name, sub: r.vendor_no || 'Vendors', url: `/master-data?tab=vendors&q=${enc(r.vendor_no || r.vendor_name)}`, state: 'official', ac: false, entityId: r.business_entity_id }));
      }),
      lookup(async () => {
        // Match the sales document no. OR the customer's PO reference. Drafts carry a DFT- prefix.
        const rows = await queryAsync(
          "SELECT document_no, record_type, customer_po_ref, status, business_entity_id, COALESCE(archived, FALSE) AS archived FROM sales_management_records WHERE document_no ILIKE ? OR customer_po_ref ILIKE ? ORDER BY id DESC LIMIT 5", [like, like]);
        rows.forEach((r) => {
          const s = String(r.status || '').trim().toLowerCase();
          const isDraftDoc = String(r.document_no || '').toUpperCase().startsWith('DFT-') && !['approved', 'won', 'sent', 'delivered', 'completed'].includes(s);
          const state = stateOf(r.status, isDraftDoc);
          const targetTab = state === 'draft' ? 'requests' : (r.record_type || 'sales-request');
          results.push({ type: 'Sales', label: r.document_no, sub: r.customer_po_ref ? `Cust PO: ${r.customer_po_ref}` : (r.record_type || 'Sales Management'), url: `/sales-management?tab=${enc(targetTab)}&q=${enc(r.document_no)}`, state, ac: true, entityId: r.business_entity_id, archived: !!r.archived });
        });
      }),
      lookup(async () => {
        // CRM lead — match Lead No, lead name, or the customer company. Leads approve in /crm,
        // NOT the Approval Center, so ac:false (route stays on the CRM page).
        const rows = await queryAsync(
          "SELECT lead_docno, lead_name, company_name, approval_status, business_entity_id, COALESCE(archived, FALSE) AS archived FROM crm_leads WHERE lead_docno ILIKE ? OR lead_name ILIKE ? OR company_name ILIKE ? ORDER BY id DESC LIMIT 5", [like, like, like]);
        rows.forEach((r) => { const ap = String(r.approval_status || 'approved').toLowerCase(); results.push({ type: 'Lead', label: r.lead_docno || r.lead_name, sub: r.lead_name || r.company_name || 'CRM Pipeline', url: `/crm?tab=leads&q=${enc(r.lead_docno || r.lead_name)}`, state: ap === 'approved' ? 'official' : (ap === 'pending' ? 'pending' : 'draft'), ac: false, entityId: r.business_entity_id, archived: !!r.archived }); });
      }),
      lookup(async () => {
        // Inventory product — match SKU or product name. Lands on the Products tab filtered.
        const rows = await queryAsync(
          "SELECT sku, product_name, business_entity_id FROM products WHERE sku ILIKE ? OR product_name ILIKE ? ORDER BY id DESC LIMIT 5", [like, like]);
        rows.forEach((r) => results.push({ type: 'Product', label: r.product_name || r.sku, sub: r.sku ? `SKU: ${r.sku}` : 'Inventory', url: `/inventory?tab=products&q=${enc(r.sku || r.product_name)}`, state: 'official', ac: false, entityId: r.business_entity_id }));
      }),
      lookup(async () => {
        // Serialized unit — match the serial number. Serial Units is an admin-only inventory view.
        const rows = await queryAsync(
          "SELECT serial_number, business_entity_id FROM product_units WHERE serial_number ILIKE ? ORDER BY id DESC LIMIT 5", [like]);
        rows.forEach((r) => results.push({ type: 'Serial Unit', label: r.serial_number, sub: 'Inventory', url: `/inventory?tab=units&q=${enc(r.serial_number)}`, state: 'official', ac: false, entityId: r.business_entity_id }));
      }),
      lookup(async () => {
        // CRM contact — match the person's name, their company, email, or phone.
        const rows = await queryAsync(
          "SELECT contact_name, company_name, email, business_entity_id, COALESCE(archived, FALSE) AS archived FROM crm_contacts WHERE contact_name ILIKE ? OR company_name ILIKE ? OR email ILIKE ? OR phone ILIKE ? ORDER BY id DESC LIMIT 5", [like, like, like, like]);
        rows.forEach((r) => results.push({ type: 'Contact', label: r.contact_name, sub: r.company_name || r.email || 'CRM Contacts', url: `/crm?tab=contacts&q=${enc(r.contact_name)}`, state: 'official', ac: false, entityId: r.business_entity_id, archived: !!r.archived }));
      }),
      lookup(async () => {
        // Inventory warehouse — match the warehouse code or name.
        const rows = await queryAsync(
          "SELECT warehouse_code, warehouse_name, business_entity_id FROM warehouses WHERE warehouse_code ILIKE ? OR warehouse_name ILIKE ? ORDER BY id DESC LIMIT 5", [like, like]);
        rows.forEach((r) => results.push({ type: 'Warehouse', label: r.warehouse_name || r.warehouse_code, sub: r.warehouse_code || 'Inventory', url: `/inventory?tab=warehouses&q=${enc(r.warehouse_code || r.warehouse_name)}`, state: 'official', ac: false, entityId: r.business_entity_id }));
      })
    ]);

    let out;
    if (staff) {
      // Staff see only non-official docs from modules they can open, scoped to their workspace
      // (sources without an entity column pass through). Archived + hidden modules never appear
      // (staff have no Archive Center).
      out = results.filter((r) => r.state !== 'official'
        && !r.archived
        && STAFF_SEARCHABLE_TYPES.has(r.type)
        && (!scopeEntityId || r.entityId == null || Number(r.entityId) === scopeEntityId));
    } else {
      // Admin: an ARCHIVED record stays searchable but its URL points to the Archive Center (not the
      // live module, where it no longer shows). Otherwise, ONLY genuinely-pending (submitted, awaiting
      // approval) docs of an Approval-Center-tracked type route to the Approval Center. A real DFT draft
      // (status 'draft' — NOT yet submitted) keeps its module URL. draft !== pending. See [[global-search-role-rules]].
      out = results.map((r) => {
        if (r.archived) return Object.assign({}, r, { url: `/admin?panel=archive-center&q=${enc(r.label)}` });
        if (r.state === 'pending' && r.ac) return Object.assign({}, r, { url: `/admin?panel=approval-center&q=${enc(r.label)}` });
        return r;
      });
    }

    res.json({ results: out.slice(0, 24) });
  });

  return router;
};
