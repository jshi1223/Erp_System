(function () {
  'use strict';

  let currentApprovalFilter = 'all';
  let approvalCenterItems = [];
  let currentApprovalSearch = '';
  let approvalCenterPollTimer = null;
  let approvalCenterPollBusy = false;
  let approvalCenterLastSignature = '';
  let approvalCenterLastCount = null;
  const APPROVAL_CENTER_POLL_MS = 30000;

  function approvalStatusPending(value) {
    const status = String(value || '').trim().toLowerCase();
    return ['pending', 'submitted', 'for_approval', 'for approval'].includes(status);
  }

  function getApprovalDate(row, fields = []) {
    const keys = fields.length ? fields : ['submitted_at', 'updated_at', 'created_at', 'request_date', 'date'];
    for (const key of keys) {
      const value = row?.[key];
      if (value) return formatDateYmd(value);
    }
    return '-';
  }

  function makeApprovalItem({ category, type, title, requestedBy, date, status, url, approveUrl, rejectUrl, timeline = [], checklist = [] }) {
    return {
      category,
      type,
      title: String(title || '-').trim() || '-',
      requestedBy: String(requestedBy || '-').trim() || '-',
      date: String(date || '-').trim() || '-',
      status: String(status || 'pending').trim() || 'pending',
      url: String(url || '/admin').trim(),
      approveUrl: String(approveUrl || '').trim(),
      rejectUrl: String(rejectUrl || '').trim(),
      timeline: Array.isArray(timeline) ? timeline : [],
      checklist: Array.isArray(checklist) ? checklist : []
    };
  }

  function buildApprovalTimeline(row = {}, labels = {}) {
    const rows = [
      { label: labels.created || 'Created', value: row.created_at || row.request_date || row.bill_date || row.payment_date || row.po_date },
      { label: labels.submitted || 'Submitted', value: row.submitted_at },
      { label: labels.approved || 'Approved', value: row.approved_at }
    ];
    return rows
      .filter(item => item.value)
      .map(item => `${item.label}: ${formatDateYmd(item.value)}`);
  }

  function buildApprovalChecklist(items = []) {
    return items.filter(Boolean).map(item => String(item));
  }

  function getApprovalItemKey(item = {}) {
    return [
      item.category,
      item.type,
      item.title,
      item.approveUrl || item.url
    ].map(value => String(value || '').trim()).join('|');
  }

  function getApprovalItemsSignature(items = []) {
    return (Array.isArray(items) ? items : [])
      .map(getApprovalItemKey)
      .sort()
      .join('||');
  }

  function getApprovalCounts(items = []) {
    const source = Array.isArray(items) ? items : [];
    return {
      all: source.length,
      projects: source.filter(item => item.category === 'projects').length,
      procurement: source.filter(item => item.category === 'procurement').length,
      inventory: source.filter(item => item.category === 'inventory').length,
      finance: source.filter(item => item.category === 'finance').length,
      users: source.filter(item => item.category === 'users').length
    };
  }

  function applyApprovalCenterSummary(items = []) {
    const counts = getApprovalCounts(items);
    setApprovalMetric('approval-count-all', counts.all);
    setApprovalMetric('approval-count-projects', counts.projects);
    setApprovalMetric('approval-count-procurement', counts.procurement);
    setApprovalMetric('approval-count-inventory', counts.inventory);
    setApprovalMetric('approval-count-finance', counts.finance);
    setApprovalMetric('approval-count-users', counts.users);
    syncApprovalSidebarBadge(counts.all);
    const valueNode = document.getElementById('stat-approvals');
    const miniNode = document.getElementById('stat-approvals-mini');
    if (valueNode) valueNode.textContent = String(counts.all);
    if (miniNode) {
      miniNode.textContent = `${counts.projects} projects | ${counts.procurement} procurement | ${counts.inventory} inventory | ${counts.finance} finance | ${counts.users} users`;
    }
    return counts;
  }

  function openApprovalCenterFromNotification() {
    if (typeof navigateDashboardCard === 'function') {
      navigateDashboardCard('/admin?panel=approval-center');
      return;
    }
    window.location.href = '/admin?panel=approval-center';
  }

  function showApprovalPendingToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) {
      if (typeof showToast === 'function') showToast(message, 'success');
      return;
    }
    clearTimeout(toast._timer);
    toast.textContent = message;
    toast.className = 'show success approval-toast-clickable';
    toast.setAttribute('role', 'button');
    toast.setAttribute('tabindex', '0');
    toast.setAttribute('title', 'Open Approval Center');
    toast.onclick = openApprovalCenterFromNotification;
    toast.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openApprovalCenterFromNotification();
      }
    };
    toast._timer = window.setTimeout(() => {
      toast.className = '';
      toast.onclick = null;
      toast.onkeydown = null;
      toast.removeAttribute('role');
      toast.removeAttribute('tabindex');
      toast.removeAttribute('title');
    }, 6000);
  }

  async function loadApprovalCenterItems() {
    if (!isAdminUser()) return [];
    const [
      projects,
      requisitions,
      purchaseOrders,
      bills,
      payments,
      users,
      companyRequests,
      vendorRequests,
      inventoryRequests
    ] = await Promise.all([
      fetchJsonOrEmpty('/api/projects?include_archived=1'),
      fetchJsonOrEmpty('/api/procurement/requisitions'),
      fetchJsonOrEmpty('/api/procurement/purchase-orders'),
      fetchJsonOrEmpty('/api/bills'),
      fetchJsonOrEmpty('/api/payments'),
      fetchJsonOrEmpty('/api/admin/users'),
      fetchJsonOrEmpty('/api/company-registry-requests'),
      fetchJsonOrEmpty('/api/vendor-registry-requests'),
      fetchJsonOrEmpty('/api/inventory/requests')
    ]);

    const items = [];

    companyRequests
      .filter(row => approvalStatusPending(row.status))
      .forEach(row => {
        const payload = row.payload || {};
        items.push(makeApprovalItem({
          category: 'procurement',
          type: 'Company Registry Request',
          title: payload.company_name || row.request_no || 'Company Registry',
          requestedBy: row.requested_by || row.requested_by_email || '-',
          date: getApprovalDate(row, ['submitted_at', 'created_at']),
          status: row.status || 'submitted',
          url: '/master-data?tab=companies',
          approveUrl: `/api/company-registry-requests/${Number(row.id || 0)}/approve`,
          rejectUrl: `/api/company-registry-requests/${Number(row.id || 0)}/reject`,
          timeline: buildApprovalTimeline(row, { created: 'Requested' }),
          checklist: buildApprovalChecklist([
            payload.company_name ? 'Company name provided' : 'Company name missing',
            payload.contact_person ? 'Contact person provided' : 'Contact missing',
            payload.phone ? 'Phone provided' : 'Phone missing',
            payload.tin ? 'TIN provided' : 'TIN missing'
          ])
        }));
      });

    vendorRequests
      .filter(row => approvalStatusPending(row.status))
      .forEach(row => {
        const payload = row.payload || {};
        items.push(makeApprovalItem({
          category: 'procurement',
          type: 'Vendor Registry Request',
          title: payload.vendor_name || row.request_no || 'Vendor Registry',
          requestedBy: row.requested_by || row.requested_by_email || '-',
          date: getApprovalDate(row, ['submitted_at', 'created_at']),
          status: row.status || 'submitted',
          url: '/master-data?tab=vendors',
          approveUrl: `/api/vendor-registry-requests/${Number(row.id || 0)}/approve`,
          rejectUrl: `/api/vendor-registry-requests/${Number(row.id || 0)}/reject`,
          timeline: buildApprovalTimeline(row, { created: 'Requested' }),
          checklist: buildApprovalChecklist([
            payload.vendor_name ? 'Vendor name provided' : 'Vendor name missing',
            payload.contact_person ? 'Contact person provided' : 'Contact missing',
            payload.phone ? 'Phone provided' : 'Phone missing',
            payload.tin ? 'TIN provided' : 'TIN missing'
          ])
        }));
      });

    inventoryRequests
      .filter(row => approvalStatusPending(row.status))
      .forEach(row => {
        const payload = row.payload || {};
        const type = String(row.request_type || 'inventory').trim();
        const title = type === 'product'
          ? [payload.sku, payload.product_name].filter(Boolean).join(' - ')
          : type === 'warehouse'
            ? [payload.warehouse_code, payload.warehouse_name].filter(Boolean).join(' - ')
            : type === 'movement'
              ? [String(payload.movement_type || '').toUpperCase(), payload.quantity ? `Qty ${payload.quantity}` : ''].filter(Boolean).join(' - ')
              : row.request_no;
        items.push(makeApprovalItem({
          category: 'inventory',
          type: 'Inventory Request',
          title: title || row.request_no || 'Inventory Request',
          requestedBy: row.requested_by || row.requested_by_email || '-',
          date: getApprovalDate(row, ['submitted_at', 'created_at']),
          status: row.status || 'submitted',
          url: '/inventory?tab=requests',
          approveUrl: `/api/inventory/requests/${Number(row.id || 0)}/approve`,
          rejectUrl: `/api/inventory/requests/${Number(row.id || 0)}/reject`,
          timeline: buildApprovalTimeline(row, { created: 'Requested' }),
          checklist: buildApprovalChecklist([
            type ? `Request type: ${type}` : 'Request type missing',
            payload.business_entity_id ? 'Workspace selected' : 'Workspace missing',
            type === 'movement' && payload.quantity ? 'Quantity provided' : '',
            type === 'product' && payload.product_name ? 'Product name provided' : '',
            type === 'warehouse' && payload.warehouse_name ? 'Warehouse name provided' : ''
          ])
        }));
      });

    projects
      .filter(row => Number(row.is_archived || 0) === 0)
      .filter(row => approvalStatusPending(row.status))
      .forEach(row => {
        items.push(makeApprovalItem({
          category: 'projects',
          type: 'Project',
          title: getProjectLinkLabel(row) || row.project_name,
          requestedBy: row.created_by_name || row.project_manager || row.project_members || '-',
          date: getApprovalDate(row, ['submitted_at', 'updated_at', 'created_at', 'planned_start_date']),
          status: row.status || 'submitted',
          url: '/admin?panel=project-records&tab=projects',
          approveUrl: `/api/projects/${Number(row.id || 0)}/approve`,
          rejectUrl: `/api/projects/${Number(row.id || 0)}/reject`,
          timeline: buildApprovalTimeline(row),
          checklist: buildApprovalChecklist([
            row.company_name || row.registry_company_name ? 'Company selected' : 'Company missing',
            row.project_name ? 'Project title ready' : 'Project title missing',
            row.planned_start_date && row.planned_end_date ? 'Planned dates complete' : 'Planned dates incomplete',
            row.project_manager ? 'Project manager assigned' : 'Project manager missing'
          ])
        }));
      });

    requisitions
      .filter(row => approvalStatusPending(row.status))
      .forEach(row => {
        items.push(makeApprovalItem({
          category: 'procurement',
          type: 'Purchase Request',
          title: row.pr_number || row.item_summary || 'Purchase Requisition',
          requestedBy: row.requested_by || row.submitted_by || '-',
          date: getApprovalDate(row, ['submitted_at', 'request_date', 'needed_by']),
          status: row.status || 'pending',
          url: '/procurement?tab=requisitions',
          approveUrl: `/api/procurement/requisitions/${Number(row.id || 0)}/approve`,
          rejectUrl: `/api/procurement/requisitions/${Number(row.id || 0)}/reject`,
          timeline: buildApprovalTimeline(row, { created: 'Requested' }),
          checklist: buildApprovalChecklist([
            row.company_name ? 'Company selected' : 'Company missing',
            row.requested_by ? 'Requester set' : 'Requester missing',
            row.needed_by ? 'Needed-by date set' : 'Needed-by date missing',
            row.item_summary ? 'Items summarized' : 'Item summary missing'
          ])
        }));
      });

    purchaseOrders
      .filter(row => approvalStatusPending(row.status))
      .forEach(row => {
        items.push(makeApprovalItem({
          category: 'procurement',
          type: 'Purchase Order',
          title: row.po_number || 'Purchase Order',
          requestedBy: row.prepared_by || row.submitted_by || '-',
          date: getApprovalDate(row, ['submitted_at', 'po_date', 'delivery_date']),
          status: row.status || 'pending',
          url: '/procurement?tab=purchase-orders',
          approveUrl: `/api/procurement/purchase-orders/${Number(row.id || 0)}/approve`,
          rejectUrl: `/api/procurement/purchase-orders/${Number(row.id || 0)}/reject`,
          timeline: buildApprovalTimeline(row, { created: 'Prepared' }),
          checklist: buildApprovalChecklist([
            row.vendor_name ? 'Vendor selected' : 'Vendor missing',
            row.po_number ? 'PO number ready' : 'PO number missing',
            row.delivery_date ? 'Delivery date set' : 'Delivery date missing',
            Number(row.total_amount || 0) > 0 ? 'Amount valid' : 'Amount missing'
          ])
        }));
      });

    bills
      .filter(row => approvalStatusPending(row.approval_status))
      .forEach(row => {
        items.push(makeApprovalItem({
          category: 'finance',
          type: 'AP Bill',
          title: row.bill_number || 'Bill',
          requestedBy: row.vendor_name || row.notes || '-',
          date: getApprovalDate(row, ['bill_date', 'due_date', 'created_at']),
          status: row.approval_status || 'pending',
          url: '/accounts-payable?tab=bills',
          approveUrl: `/api/bills/${Number(row.id || 0)}/approve`,
          rejectUrl: `/api/bills/${Number(row.id || 0)}/reject`,
          timeline: buildApprovalTimeline(row, { created: 'Bill date' }),
          checklist: buildApprovalChecklist([
            row.vendor_name ? 'Vendor linked' : 'Vendor missing',
            row.bill_number ? 'Bill number ready' : 'Bill number missing',
            row.due_date ? 'Due date set' : 'Due date missing',
            Number(row.total_amount || 0) > 0 ? 'Amount valid' : 'Amount missing'
          ])
        }));
      });

    payments
      .filter(row => approvalStatusPending(row.approval_status))
      .forEach(row => {
        items.push(makeApprovalItem({
          category: 'finance',
          type: 'Payment',
          title: [row.payment_type, row.reference_number].filter(Boolean).join(' - ') || 'Payment',
          requestedBy: row.payment_method || '-',
          date: getApprovalDate(row, ['payment_date', 'created_at']),
          status: row.approval_status || 'pending',
          url: row.payment_type === 'ar' ? '/accounts-receivable?tab=collections' : '/accounts-payable?tab=payments',
          approveUrl: `/api/payments/${Number(row.id || 0)}/approve`,
          rejectUrl: `/api/payments/${Number(row.id || 0)}/reject`,
          timeline: buildApprovalTimeline(row, { created: 'Payment date' }),
          checklist: buildApprovalChecklist([
            row.payment_type ? 'Payment type set' : 'Payment type missing',
            row.payment_method ? 'Payment method set' : 'Payment method missing',
            row.reference_number ? 'Reference number set' : 'Reference number missing',
            Number(row.amount || 0) > 0 ? 'Amount valid' : 'Amount missing'
          ])
        }));
      });

    users
      .filter(row => approvalStatusPending(row.approval_status))
      .forEach(row => {
        items.push(makeApprovalItem({
          category: 'users',
          type: 'User Account',
          title: row.fullname || row.username || row.email || 'User',
          requestedBy: row.email || row.username || '-',
          date: getApprovalDate(row, ['created_at']),
          status: row.approval_status || 'pending',
          url: '/user-management',
          approveUrl: `/api/admin/users/${Number(row.id || 0)}/approve`,
          rejectUrl: `/api/admin/users/${Number(row.id || 0)}/reject`,
          timeline: buildApprovalTimeline(row, { created: 'Registered' }),
          checklist: buildApprovalChecklist([
            row.email ? 'Email provided' : 'Email missing',
            row.username ? 'Username provided' : 'Username missing',
            row.role ? 'Requested role set' : 'Role missing'
          ])
        }));
      });

    approvalCenterItems = items;
    return items;
  }

  function setApprovalMetric(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = String(value || 0);
  }

  function syncApprovalSidebarBadge(total = 0) {
    const link = document.getElementById('menu-approval-center');
    if (!link) return;
    const count = Number(total || 0);
    let badge = link.querySelector('.approval-sidebar-badge');
    if (!count) {
      if (badge) badge.remove();
      link.classList.remove('has-needs-action');
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'approval-sidebar-badge';
      link.appendChild(badge);
    }
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.setAttribute('aria-label', `${count} pending approvals`);
    link.classList.add('has-needs-action');
  }

  async function updateApprovalCenterSummaryCard() {
    const card = document.getElementById('stat-card-approvals');
    const valueNode = document.getElementById('stat-approvals');
    const miniNode = document.getElementById('stat-approvals-mini');
    if (!card && !valueNode && !miniNode) return;
    if (!isAdminUser()) {
      if (valueNode) valueNode.textContent = '0';
      if (miniNode) miniNode.textContent = 'Admin approvals only';
      syncApprovalSidebarBadge(0);
      return;
    }
    const items = await loadApprovalCenterItems();
    applyApprovalCenterSummary(items);
  }

  function filterApprovalCenter(filter = 'all') {
    currentApprovalFilter = ['all', 'projects', 'procurement', 'inventory', 'finance', 'users'].includes(String(filter)) ? String(filter) : 'all';
    renderApprovalCenter(false, true);
  }

  function getApprovalSearchQuery() {
    currentApprovalSearch = String(document.getElementById('approval-center-search-input')?.value || '').trim().toLowerCase();
    return currentApprovalSearch;
  }

  function approvalItemMatchesSearch(item, query = getApprovalSearchQuery()) {
    if (!query) return true;
    return [
      item.type,
      item.title,
      item.requestedBy,
      item.date,
      item.status,
      item.category,
      ...(Array.isArray(item.checklist) ? item.checklist : [])
    ].map(value => String(value || '')).join(' ').toLowerCase().includes(query);
  }

  let approvalCommentResolver = null;

  function closeApprovalCommentDialog(result = null) {
    const backdrop = document.getElementById('approval-comment-modal-backdrop');
    if (backdrop) {
      backdrop.classList.remove('open');
      backdrop.setAttribute('aria-hidden', 'true');
    }
    if (approvalCommentResolver) {
      const resolve = approvalCommentResolver;
      approvalCommentResolver = null;
      resolve(result);
    }
  }

  function ensureApprovalCommentDialog() {
    let backdrop = document.getElementById('approval-comment-modal-backdrop');
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'approval-comment-modal-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.innerHTML = `
      <div class="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="approval-comment-modal-title">
        <div class="modal-title modal-title-confirm" id="approval-comment-modal-title">Approval Comment</div>
        <p class="modal-copy" id="approval-comment-modal-message">Add a workflow note.</p>
        <textarea id="approval-comment-modal-input" rows="4" placeholder="Add comment or reason..." style="width:100%; resize:vertical; margin: 6px 0 14px;"></textarea>
        <div class="modal-actions">
          <button class="btn btn-confirm-no btn-sm" type="button" id="approval-comment-modal-cancel">Cancel</button>
          <button class="btn btn-confirm-yes btn-sm" type="button" id="approval-comment-modal-submit">Continue</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) closeApprovalCommentDialog(null);
    });
    backdrop.querySelector('#approval-comment-modal-cancel')?.addEventListener('click', () => closeApprovalCommentDialog(null));
    backdrop.querySelector('#approval-comment-modal-submit')?.addEventListener('click', () => {
      const input = document.getElementById('approval-comment-modal-input');
      closeApprovalCommentDialog(String(input?.value || '').trim());
    });
    return backdrop;
  }

  function openApprovalCommentDialog({ title, message, placeholder, submitText, required = false } = {}) {
    const backdrop = ensureApprovalCommentDialog();
    const titleEl = document.getElementById('approval-comment-modal-title');
    const messageEl = document.getElementById('approval-comment-modal-message');
    const input = document.getElementById('approval-comment-modal-input');
    const submit = document.getElementById('approval-comment-modal-submit');
    if (titleEl) titleEl.textContent = title || 'Approval Comment';
    if (messageEl) messageEl.textContent = message || 'Add a workflow note.';
    if (input) {
      input.value = '';
      input.placeholder = placeholder || 'Add comment or reason...';
      input.dataset.required = required ? '1' : '0';
    }
    if (submit) submit.textContent = submitText || 'Continue';
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
    return new Promise((resolve) => {
      approvalCommentResolver = (value) => {
        if (value !== null && required && !String(value || '').trim()) {
          showToast('Comment is required.', 'error');
          openApprovalCommentDialog({ title, message, placeholder, submitText, required }).then(resolve);
          return;
        }
        resolve(value);
      };
      setTimeout(() => input?.focus(), 0);
    });
  }

  async function postApprovalCenterAction(url, { reason = '', comment = '', method = 'POST' } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const payload = {};
    if (reason) payload.reason = reason;
    if (comment) payload.comment = comment;
    if (window.__CSRF_TOKEN__) headers['X-CSRF-Token'] = window.__CSRF_TOKEN__;
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers,
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Action failed.');
    return data;
  }

  async function approveApprovalItem(index) {
    const item = approvalCenterItems[Number(index || 0)];
    if (!item?.approveUrl) return;
    try {
      const comment = await openApprovalCommentDialog({
        title: 'Approve Request',
        message: `Approve ${item.type}: ${item.title}? Optional comment will be saved in audit trail.`,
        placeholder: 'Optional approval comment...',
        submitText: 'Approve',
        required: false
      });
      if (comment === null) return;
      if (item.category === 'users') {
        await postApprovalCenterAction(item.approveUrl, { comment, method: 'PATCH' });
      } else {
        await postApprovalCenterAction(item.approveUrl, { comment });
      }
      showToast('Approved successfully.', 'success');
      await renderApprovalCenter(true);
      if (item.category === 'projects') {
        await loadProjectsDashboardData();
      } else if (typeof updateStats === 'function') {
        await updateStats();
      }
    } catch (err) {
      showToast(err.message || 'Unable to approve.', 'error');
    }
  }

  async function rejectApprovalItem(index) {
    const item = approvalCenterItems[Number(index || 0)];
    if (!item?.rejectUrl) return;
    const safeReason = await openApprovalCommentDialog({
      title: 'Reject Request',
      message: `Reject ${item.type}: ${item.title}? Reason is required and will be shown to staff.`,
      placeholder: 'Reason for rejection / revision note...',
      submitText: 'Reject',
      required: true
    });
    if (safeReason === null) return;
    try {
      const method = item.category === 'users' ? 'PATCH' : 'POST';
      await postApprovalCenterAction(item.rejectUrl, { reason: safeReason, comment: safeReason, method });
      showToast('Rejected and returned for revision.', 'success');
      await renderApprovalCenter(true);
      if (item.category === 'projects') {
        await loadProjectsDashboardData();
      } else if (typeof updateStats === 'function') {
        await updateStats();
      }
    } catch (err) {
      showToast(err.message || 'Unable to reject.', 'error');
    }
  }

  function showApprovalItemTimeline(index) {
    const item = approvalCenterItems[Number(index || 0)];
    if (!item) return;
    openApprovalTimelineModal(item);
  }

  function getApprovalMissingFields(item = {}) {
    const checklist = Array.isArray(item.checklist) ? item.checklist : [];
    return checklist.filter(row => /\b(missing|incomplete|invalid)\b/i.test(String(row || '')));
  }

  function getApprovalAuditTrail(item = {}) {
    return [
      `Type: ${item.type || '-'}`,
      `Category: ${item.category || '-'}`,
      `Requester: ${item.requestedBy || '-'}`,
      `Submitted date: ${item.date || '-'}`,
      `Current status: ${String(item.status || 'pending').replace(/_/g, ' ')}`
    ];
  }

  function closeApprovalTimelineModal() {
    const backdrop = document.getElementById('approval-timeline-modal-backdrop');
    if (backdrop) {
      backdrop.classList.remove('open');
      backdrop.setAttribute('aria-hidden', 'true');
    }
  }

  function ensureApprovalTimelineModal() {
    let backdrop = document.getElementById('approval-timeline-modal-backdrop');
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'approval-timeline-modal-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.innerHTML = `
      <div class="modal approval-timeline-modal" role="dialog" aria-modal="true" aria-labelledby="approval-timeline-modal-title">
        <div class="modal-header">
          <div>
            <div class="approval-modal-kicker" id="approval-timeline-modal-type">Approval Details</div>
            <div class="modal-title" id="approval-timeline-modal-title">Approval Timeline</div>
          </div>
          <button class="modal-close" type="button" id="approval-timeline-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="approval-timeline-grid">
          <section>
            <h3>Timeline</h3>
            <div id="approval-timeline-modal-timeline"></div>
          </section>
          <section>
            <h3>Checklist</h3>
            <div id="approval-timeline-modal-checklist"></div>
          </section>
          <section>
            <h3>Missing Fields</h3>
            <div id="approval-timeline-modal-missing"></div>
          </section>
          <section>
            <h3>Audit Trail</h3>
            <div id="approval-timeline-modal-audit"></div>
          </section>
        </div>
        <div class="modal-actions">
          <button class="btn btn-cancel btn-sm" type="button" id="approval-timeline-modal-open">Open Record</button>
          <button class="btn btn-primary btn-sm" type="button" id="approval-timeline-modal-done">Done</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) closeApprovalTimelineModal();
    });
    backdrop.querySelector('#approval-timeline-modal-close')?.addEventListener('click', closeApprovalTimelineModal);
    backdrop.querySelector('#approval-timeline-modal-done')?.addEventListener('click', closeApprovalTimelineModal);
    return backdrop;
  }

  function openApprovalTimelineModal(item) {
    const backdrop = ensureApprovalTimelineModal();
    const type = document.getElementById('approval-timeline-modal-type');
    const title = document.getElementById('approval-timeline-modal-title');
    const timeline = document.getElementById('approval-timeline-modal-timeline');
    const checklist = document.getElementById('approval-timeline-modal-checklist');
    const missing = document.getElementById('approval-timeline-modal-missing');
    const audit = document.getElementById('approval-timeline-modal-audit');
    const openBtn = document.getElementById('approval-timeline-modal-open');
    if (type) type.textContent = `${item.type} | ${String(item.status || 'pending').replace(/_/g, ' ')}`;
    if (title) title.textContent = item.title || 'Approval Details';
    if (timeline) {
      const rows = item.timeline.length ? item.timeline : ['No timeline yet.'];
      timeline.innerHTML = rows.map(row => `<div class="approval-timeline-line">${escHtml(row)}</div>`).join('');
    }
    if (checklist) {
      const rows = item.checklist.length ? item.checklist : ['No checklist items.'];
      checklist.innerHTML = rows.map(row => {
        const bad = /\b(missing|incomplete|invalid)\b/i.test(String(row || ''));
        return `<div class="approval-checklist-line ${bad ? 'is-warning' : 'is-ok'}">${escHtml(row)}</div>`;
      }).join('');
    }
    if (missing) {
      const rows = getApprovalMissingFields(item);
      missing.innerHTML = rows.length
        ? rows.map(row => `<div class="approval-missing-line">${escHtml(row)}</div>`).join('')
        : '<div class="approval-empty-line">No missing fields detected.</div>';
    }
    if (audit) {
      audit.innerHTML = getApprovalAuditTrail(item)
        .map(row => `<div class="approval-audit-line">${escHtml(row)}</div>`)
        .join('');
    }
    if (openBtn) {
      openBtn.onclick = () => {
        closeApprovalTimelineModal();
        navigateDashboardCard(item.url);
      };
    }
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
  }

  function getApprovalSlaState(dateValue) {
    const date = toDateOnly(dateValue);
    if (!date) return { label: 'No SLA date', className: 'status-muted' };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((date.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays < -3) return { label: 'Critical overdue', className: 'status-cancelled' };
    if (diffDays < 0) return { label: 'Overdue', className: 'status-overdue' };
    if (diffDays === 0) return { label: 'Due today', className: 'status-pending' };
    return { label: 'Within SLA', className: 'status-approved' };
  }

  function getApprovalStatusClass(statusValue) {
    const status = String(statusValue || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (['submitted', 'pending', 'for_approval'].includes(status)) return 'status-submitted';
    if (status === 'needs_revision') return 'status-needs-revision';
    if (status === 'approved') return 'status-approved';
    if (status === 'rejected') return 'status-cancelled';
    return 'status-pending';
  }

  function getApprovalActionNeeded(item = {}) {
    const checklist = Array.isArray(item.checklist) ? item.checklist : [];
    const issue = checklist.find(row => /\b(missing|incomplete|invalid)\b/i.test(String(row || '')));
    if (issue) return issue;
    if (item.category === 'users') return 'Confirm role, identity, and account access.';
    if (item.category === 'finance') return 'Review amount, reference, and linked records.';
    if (item.category === 'projects') return 'Review scope, company, dates, and assigned staff.';
    return 'Review document details before approving or returning for revision.';
  }

  async function renderApprovalCenter(force = false, useCache = false) {
    const panel = document.getElementById('approval-center');
    if (!panel) return;
    const showPanel = isAdminUser() && currentDashboardPanel === 'approval-center';
    panel.classList.toggle('is-hidden', !showPanel);
    if (!showPanel) return;

    const items = useCache && approvalCenterItems.length ? approvalCenterItems : await loadApprovalCenterItems(force);
    const counts = applyApprovalCenterSummary(items);

    document.querySelectorAll('.approval-summary-card').forEach((card) => {
      const onclick = String(card.getAttribute('onclick') || '');
      card.classList.toggle('is-active', onclick.includes(`'${currentApprovalFilter}'`));
    });

    const subtitle = document.getElementById('approval-center-subtitle');
    const subtitleMap = {
      all: 'Showing all pending approvals',
      projects: 'Showing submitted project drafts',
      procurement: 'Showing purchase requests and orders',
      inventory: 'Showing inventory requests',
      finance: 'Showing bills and payments',
      users: 'Showing pending user accounts'
    };
    if (subtitle) subtitle.textContent = subtitleMap[currentApprovalFilter] || subtitleMap.all;

    const query = getApprovalSearchQuery();
    const visibleItems = items
      .map((item, index) => ({ ...item, index }))
      .filter(item => currentApprovalFilter === 'all' || item.category === currentApprovalFilter)
      .filter(item => approvalItemMatchesSearch(item, query));
    const tbody = document.getElementById('approval-center-body');
    if (!tbody) return;
    if (!visibleItems.length) {
      tbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="6">
            <div class="approval-empty-state">
              <strong>Approval queue is clear.</strong>
              <span>${query ? 'No approvals match your search.' : 'No pending approvals for this view.'}</span>
              <button class="btn btn-cancel btn-sm" type="button" onclick="renderApprovalCenter(true)">Refresh</button>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = visibleItems.map((item) => {
      const sla = getApprovalSlaState(item.date);
      const statusClass = getApprovalStatusClass(item.status);
      const actionNeeded = getApprovalActionNeeded(item);
      return `
        <tr>
          <td>${escHtml(item.type)}</td>
          <td>
            <strong>${escHtml(item.title)}</strong>
            <div class="approval-row-note">${escHtml(actionNeeded)}</div>
          </td>
          <td>
            ${escHtml(item.requestedBy)}
            <div class="approval-row-note">${escHtml(item.category)}</div>
          </td>
          <td>${escHtml(item.date)}<div style="margin-top:4px;"><span class="status-pill ${escHtml(sla.className)}">${escHtml(sla.label)}</span></div></td>
          <td><span class="status-pill ${escHtml(statusClass)}">${escHtml(String(item.status || 'pending').replace(/_/g, ' '))}</span></td>
          <td class="text-center">
            <button class="btn btn-add btn-sm" type="button" onclick="approveApprovalItem(${Number(item.index)})">Approve</button>
            <button class="btn btn-delete btn-sm" type="button" onclick="rejectApprovalItem(${Number(item.index)})">Reject</button>
            <button class="btn btn-cancel btn-sm" type="button" onclick="showApprovalItemTimeline(${Number(item.index)})">Timeline</button>
            <button class="btn btn-cancel btn-sm" type="button" onclick="navigateDashboardCard('${escHtml(item.url)}')">Open</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function pollApprovalCenterUpdates({ announce = true } = {}) {
    if (approvalCenterPollBusy || typeof isAdminUser !== 'function' || !isAdminUser()) return;
    approvalCenterPollBusy = true;
    try {
      const previousSignature = approvalCenterLastSignature;
      const previousCount = approvalCenterLastCount;
      const previousKeys = new Set((approvalCenterItems || []).map(getApprovalItemKey));
      const items = await loadApprovalCenterItems();
      const signature = getApprovalItemsSignature(items);
      const counts = applyApprovalCenterSummary(items);

      const hasBaseline = previousCount !== null && previousSignature;
      const hasNewPending = hasBaseline && counts.all > Number(previousCount || 0);
      const newItems = hasBaseline
        ? items.filter(item => !previousKeys.has(getApprovalItemKey(item)))
        : [];

      approvalCenterLastSignature = signature;
      approvalCenterLastCount = counts.all;

      if (typeof currentDashboardPanel !== 'undefined' && currentDashboardPanel === 'approval-center') {
        await renderApprovalCenter(false, true);
      }

      if (announce && hasNewPending && newItems.length && typeof showToast === 'function') {
        const first = newItems[0];
        const extra = newItems.length > 1 ? ` +${newItems.length - 1} more` : '';
        showApprovalPendingToast(`New ${first.type} pending approval: ${first.title}${extra}`);
      }
    } catch (err) {
      console.warn('Approval polling warning:', err);
    } finally {
      approvalCenterPollBusy = false;
    }
  }

  function startApprovalCenterPolling() {
    if (approvalCenterPollTimer || typeof isAdminUser !== 'function') return;
    if (!isAdminUser()) return;
    pollApprovalCenterUpdates({ announce: false });
    approvalCenterPollTimer = window.setInterval(() => {
      if (document.hidden) return;
      pollApprovalCenterUpdates({ announce: true });
    }, APPROVAL_CENTER_POLL_MS);
  }

  function stopApprovalCenterPolling() {
    if (!approvalCenterPollTimer) return;
    window.clearInterval(approvalCenterPollTimer);
    approvalCenterPollTimer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pollApprovalCenterUpdates({ announce: true });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApprovalCenterPolling);
  } else {
    window.setTimeout(startApprovalCenterPolling, 0);
  }

  Object.assign(window, {
    approvalStatusPending,
    getApprovalDate,
    makeApprovalItem,
    buildApprovalTimeline,
    buildApprovalChecklist,
    loadApprovalCenterItems,
    setApprovalMetric,
    syncApprovalSidebarBadge,
    updateApprovalCenterSummaryCard,
    filterApprovalCenter,
    getApprovalSearchQuery,
    approvalItemMatchesSearch,
    postApprovalCenterAction,
    openApprovalCommentDialog,
    closeApprovalCommentDialog,
    approveApprovalItem,
    rejectApprovalItem,
    showApprovalItemTimeline,
    getApprovalMissingFields,
    getApprovalAuditTrail,
    closeApprovalTimelineModal,
    ensureApprovalTimelineModal,
    openApprovalTimelineModal,
    getApprovalSlaState,
    getApprovalStatusClass,
    getApprovalActionNeeded,
    renderApprovalCenter,
    pollApprovalCenterUpdates,
    startApprovalCenterPolling,
    stopApprovalCenterPolling
  });
})();
