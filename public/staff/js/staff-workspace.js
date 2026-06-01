(function () {
  'use strict';

  let currentStaffWorkFilter = 'all';
  let staffProjectsLazyLoadAttempted = false;
  let staffPendingProjectRequestsDb = [];

  function getStaffIdentityTerms() {
    const user = currentUser || {};
    return [
      user.fullname,
      user.name,
      user.username,
      user.email
    ]
      .map(value => String(value || '').trim().toLowerCase())
      .filter(value => value.length >= 3);
  }

  function textContainsStaffTerm(value, terms = getStaffIdentityTerms()) {
    const text = String(value || '').trim().toLowerCase();
    if (!text || !terms.length) return false;
    return terms.some(term => text.includes(term));
  }

  function isRecordOwnedByCurrentStaff(record) {
    const userId = Number(currentUser?.id || 0) || 0;
    if (!record) return false;
    const ownerIds = [
      record.created_by,
      record.user_id,
      record.owner_id,
      record.assigned_to,
      record.assigned_to_id
    ].map(value => Number(value || 0)).filter(Boolean);
    if (userId && ownerIds.includes(userId)) return true;

    const terms = getStaffIdentityTerms();
    return [
      record.created_by,
      record.user_id,
      record.owner_id,
      record.assigned_to,
      record.assigned_to_id,
      record.created_by_name,
      record.created_by_username,
      record.created_by_email,
      record.assigned_to_name,
      record.assigned_to_username,
      record.assigned_to_email,
      record.created_by_label,
      record.owner_name,
      record.assignee_name
    ].some(value => textContainsStaffTerm(value, terms));
  }

  function projectAssignedToCurrentStaff(project) {
    if (!project) return false;
    if (isRecordOwnedByCurrentStaff(project)) return true;

    const terms = getStaffIdentityTerms();
    const fields = [
      project.created_by,
      project.assigned_to,
      project.assigned_to_id,
      project.created_by_name,
      project.created_by_username,
      project.created_by_email,
      project.assigned_to_name,
      project.assigned_to_username,
      project.assigned_to_email,
      project.project_manager,
      project.manager,
      project.members,
      project.project_members,
      project.member_role,
      project.project_members_2,
      project.member_role_2,
      project.project_members_3,
      project.member_role_3,
      project.source_member_name,
      project.source_member_name_2,
      project.source_member_name_3
    ];
    return fields.some(value => textContainsStaffTerm(value, terms));
  }

  function projectVisibleToCurrentStaff(project) {
    if (!project) return false;
    const status = String(project.status || '').trim().toLowerCase();
    if (status === 'draft' || status === 'submitted') return true;
    return projectAssignedToCurrentStaff(project);
  }

  function serviceOrderAssignedToCurrentStaff(row) {
    if (!row) return false;
    if (isRecordOwnedByCurrentStaff(row)) return true;

    const terms = getStaffIdentityTerms();
    const fields = [
      row.assigned_to,
      row.assignee,
      row.technician,
      row.technician_name,
      row.prepared_by,
      row.requested_by,
      row.service_team,
      row.service_title
    ];
    if (fields.some(value => textContainsStaffTerm(value, terms))) return true;

    const projectId = Number(row.project_id || 0) || 0;
    if (!projectId) return false;
    const linkedProject = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
      .find(project => Number(project.id || 0) === projectId);
    return projectAssignedToCurrentStaff(linkedProject);
  }

  function getStaffRecordDate(record, type = 'project') {
    if (type === 'service') {
      return toDateOnly(record?.service_date || record?.scheduled_date || record?.date || record?.created_at);
    }
    return getProjectEffectiveEndDate(record) || toDateOnly(record?.created_at || record?.updated_at);
  }

  function getStaffWorkDueState(dateValue, status = '') {
    const due = toDateOnly(dateValue);
    if (!due) return 'none';
    const closed = ['completed', 'cancelled', 'archived', 'paid', 'approved'].includes(String(status || '').toLowerCase());
    if (closed) return 'none';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (due < today) return 'overdue';
    if (due.getTime() === today.getTime()) return 'due';
    return 'upcoming';
  }

  function buildStaffWorkItems() {
    if (!isStaffUser()) return [];

    const projectItems = (Array.isArray(projectsDashboardDb) ? projectsDashboardDb : [])
      .filter(project => Number(project.is_archived || 0) === 0)
      .filter(project => businessEntityMatches(project))
      .filter(projectVisibleToCurrentStaff)
      .map(project => {
        const status = String(project.status || getProjectLifecycleLabel(project) || 'planning').toLowerCase();
        const dueDate = getStaffRecordDate(project, 'project');
        const dueState = getStaffWorkDueState(dueDate, status);
        const requestState = ['draft', 'submitted'].includes(status);
        return {
          id: `project-${project.id}`,
          recordId: Number(project.id || 0) || 0,
          type: requestState ? 'Request' : 'Project',
          module: 'Projects',
          title: getProjectLinkLabel(project) || String(project.project_name || 'Untitled Project'),
          status,
          dueDate,
          dueState,
          category: requestState ? 'requests' : (dueState === 'overdue' ? 'overdue' : (dueState === 'due' ? 'due' : 'all')),
          url: '/staff?panel=project-records&tab=projects'
        };
      });

    const serviceItems = (Array.isArray(serviceOrdersDb) ? serviceOrdersDb : [])
      .filter(row => Number(row.is_archived || 0) !== 1)
      .filter(row => businessEntityMatches(row))
      .filter(serviceOrderAssignedToCurrentStaff)
      .map(row => {
        const status = String(row.status || 'draft').toLowerCase();
        const dueDate = getStaffRecordDate(row, 'service');
        const dueState = getStaffWorkDueState(dueDate, status);
        return {
          id: `service-${row.id}`,
          recordId: Number(row.id || 0) || 0,
          type: 'Service',
          module: 'Service Operations',
          title: getTransactionServiceOrderLabel(row) || String(row.service_title || 'Service Order'),
          status,
          dueDate,
          dueState,
          category: 'service',
          url: '/service-operations'
        };
      });

    return [...projectItems, ...serviceItems]
      .filter(item => !['completed', 'cancelled', 'archived'].includes(String(item.status || '').toLowerCase()))
      .sort((a, b) => {
        const rank = { overdue: 0, due: 1, requests: 2, service: 3, all: 4, upcoming: 5, none: 6 };
        const rankA = rank[a.dueState] ?? rank[a.category] ?? 9;
        const rankB = rank[b.dueState] ?? rank[b.category] ?? 9;
        if (rankA !== rankB) return rankA - rankB;
        const dateA = a.dueDate ? a.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
        const dateB = b.dueDate ? b.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
        return dateA - dateB;
      });
  }

  function setStaffMetric(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = String(value || 0);
  }

  async function loadStaffPendingProjectRequests() {
    if (!isStaffUser()) return [];
    try {
      const res = await fetch('/api/projects?include_archived=1', { cache: 'no-store' });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      staffPendingProjectRequestsDb = (Array.isArray(data) ? data : [])
        .filter(project => Number(project.is_archived || 0) === 0)
        .filter(project => ['draft', 'submitted'].includes(String(project.status || '').trim().toLowerCase()));
    } catch (err) {
      console.error('Staff pending projects load error:', err);
      staffPendingProjectRequestsDb = [];
    }
    return staffPendingProjectRequestsDb;
  }

  function filterStaffWorkQueue(filter = 'all') {
    currentStaffWorkFilter = ['all', 'due', 'overdue', 'requests', 'service'].includes(String(filter)) ? String(filter) : 'all';
    renderStaffDashboard();
  }

  async function updateStaffWorkspaceSummaryCard() {
    const valueNode = document.getElementById('stat-staff-workspace');
    const miniNode = document.getElementById('stat-staff-workspace-mini');
    if (!valueNode && !miniNode) return;
    if (!isStaffUser()) {
      if (valueNode) valueNode.textContent = '0';
      if (miniNode) miniNode.textContent = 'Staff workspace only';
      return;
    }
    const items = buildStaffWorkItems();
    const dueCount = items.filter(item => item.dueState === 'due').length;
    const overdueCount = items.filter(item => item.dueState === 'overdue').length;
    let requestCount = items.filter(item => item.category === 'requests').length;
    const serviceCount = items.filter(item => item.category === 'service').length;
    try {
      const terms = getStaffIdentityTerms();
      const pendingProjects = await loadStaffPendingProjectRequests();
      const requisitions = await fetchJsonOrEmpty('/api/procurement/requisitions');
      const companyRequests = await fetchJsonOrEmpty('/api/company-registry-requests');
      const prRequests = requisitions.filter(row => {
        if (isRecordOwnedByCurrentStaff(row)) return true;
        return [
          row.requested_by,
          row.requested_by_email,
          row.submitted_by,
          row.department
        ].some(value => textContainsStaffTerm(value, terms));
      });
      requestCount = Math.max(requestCount, pendingProjects.length + prRequests.length + companyRequests.length);
    } catch (err) {
      console.error('Staff workspace summary load error:', err);
    }
    const nonRequestCount = items.filter(item => item.category !== 'requests').length;
    if (valueNode) valueNode.textContent = String(nonRequestCount + requestCount);
    if (miniNode) miniNode.textContent = `${requestCount} requests • ${serviceCount} service • ${dueCount} due • ${overdueCount} overdue`;
  }

  function openStaffWorkspaceFromDashboard() {
    navigateDashboardCard('/staff?panel=staff-workspace');
  }

  function openStaffWorkItem(type, id) {
    const safeType = String(type || '').toLowerCase();
    const safeId = Number(id || 0) || 0;
    if (safeType === 'service') {
      navigateDashboardCard('/service-operations');
      return;
    }
    if (safeType === 'request' || safeType === 'project') {
      if (safeId) {
        currentProjectWorkspaceTab = 'projects';
        localStorage.setItem('kinaadman_projectWorkspaceTab', 'projects');
      }
      openDashboardPanel('project-records');
    }
  }

  function getStaffRequestStatusInfo(row = {}) {
    const rawStatus = String(row.status || '').toLowerCase().replace(/\s+/g, '_');
    const hasRevisionNote = Boolean(String(row.statusReason || row.rejectReason || row.cancelReason || '').trim());
    if (rawStatus === 'draft' && hasRevisionNote) {
      return { key: 'needs_revision', label: 'Needs Revision', className: 'status-rejected' };
    }
    const map = {
      draft: { key: 'draft', label: 'Draft', className: 'status-draft' },
      submitted: { key: 'submitted', label: 'Submitted', className: 'status-submitted' },
      pending: { key: 'submitted', label: 'Submitted', className: 'status-submitted' },
      approved: { key: 'approved', label: 'Approved', className: 'status-approved' },
      planning: { key: 'approved', label: 'Approved', className: 'status-approved' },
      rejected: { key: 'needs_revision', label: 'Needs Revision', className: 'status-rejected' },
      cancelled: { key: 'rejected', label: 'Rejected', className: 'status-cancelled' }
    };
    return map[rawStatus] || { key: rawStatus || 'open', label: String(row.status || 'Open').replace(/_/g, ' '), className: `status-${rawStatus || 'open'}` };
  }

  function getStaffActorName(row = {}, ...keys) {
    for (const key of keys) {
      const value = String(row?.[key] || '').trim();
      if (value) return value;
    }
    return '';
  }

  function renderStaffAuditTrail(row = {}) {
    const lines = [];
    const submittedBy = getStaffActorName(row, 'submittedBy', 'submitted_by', 'requestedBy', 'requested_by', 'createdBy', 'created_by_name');
    const submittedAt = row.submittedAt || row.submitted_at || row.created_at || row.request_date;
    if (submittedBy || submittedAt) {
      lines.push({ label: 'Submitted', actor: submittedBy || 'Staff', date: submittedAt });
    }

    const statusInfo = getStaffRequestStatusInfo(row);
    const decisionBy = getStaffActorName(row, 'approvedBy', 'approved_by', 'cancelledBy', 'cancelled_by');
    const decisionAt = row.approvedAt || row.approved_at || row.cancelledAt || row.cancelled_at;
    if (['approved', 'needs_revision', 'rejected'].includes(statusInfo.key) && (decisionBy || decisionAt)) {
      lines.push({
        label: statusInfo.key === 'approved' ? 'Approved' : 'Reviewed',
        actor: decisionBy || 'Admin',
        date: decisionAt
      });
    }

    const note = String(row.statusReason || row.rejectReason || row.cancelReason || '').trim();
    if (note) {
      lines.push({ label: statusInfo.key === 'needs_revision' ? 'Revision Note' : 'Note', actor: note, date: '' });
    }

    if (!lines.length) return '<span class="staff-audit-muted">No approval action yet</span>';
    return `
      <div class="staff-audit-trail">
        ${lines.map(line => `
          <div class="staff-audit-line">
            <strong>${escHtml(line.label)}</strong>
            <span>${escHtml([line.actor, line.date ? formatDateYmd(line.date) : ''].filter(Boolean).join(' - '))}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderStaffRequestAction(row) {
    const type = String(row?.type || '').toLowerCase();
    const status = String(row?.status || '').toLowerCase();
    const id = Number(row?.id || 0);
    const statusInfo = getStaffRequestStatusInfo(row);

    if (type === 'project' && id && (status === 'draft' || status === 'rejected')) {
      return `
        <div class="project-master-actions">
          <button class="btn btn-edit btn-sm" type="button" onclick="openProjectModal(${id})">Edit</button>
          <button class="btn btn-add btn-sm" type="button" onclick="submitProject(${id})">${statusInfo.key === 'needs_revision' ? 'Resubmit' : 'Submit'}</button>
        </div>
      `;
    }

    if (statusInfo.key === 'submitted') {
      return '<span class="status-pill status-submitted">Waiting for Admin</span>';
    }

    if (statusInfo.key === 'approved') {
      return '<span class="status-pill status-approved">Approved - locked</span>';
    }

    if (statusInfo.key === 'needs_revision' && type !== 'project') {
      return `<button class="btn btn-cancel btn-sm" type="button" onclick="navigateDashboardCard('${escHtml(row?.url || '/staff')}')">View Note</button>`;
    }

    return `<button class="btn btn-cancel btn-sm" type="button" onclick="navigateDashboardCard('${escHtml(row?.url || '/staff')}')">Open</button>`;
  }

  function renderStaffDashboard() {
    const workspace = document.getElementById('staff-workspace');
    if (!workspace) return;

    const showWorkspace = isStaffUser() && currentDashboardPanel === 'staff-workspace';
    workspace.classList.toggle('is-hidden', !showWorkspace);
    if (!showWorkspace) return;

    refreshCompanyRegistryStatCard();

    if (!staffProjectsLazyLoadAttempted && (!Array.isArray(projectsDashboardDb) || projectsDashboardDb.length === 0)) {
      staffProjectsLazyLoadAttempted = true;
      loadProjectsDashboardData().catch((err) => {
        console.error('Staff project lazy load error:', err);
      });
    }

    const items = buildStaffWorkItems();
    const dueItems = items.filter(item => item.dueState === 'due');
    const overdueItems = items.filter(item => item.dueState === 'overdue');
    const requestItems = items.filter(item => item.category === 'requests');
    const serviceItems = items.filter(item => item.category === 'service');

    setStaffMetric('staff-work-total', items.length);
    setStaffMetric('staff-work-due', dueItems.length);
    setStaffMetric('staff-work-overdue', overdueItems.length);
    setStaffMetric('staff-work-requests', requestItems.length);
    setStaffMetric('staff-work-service', serviceItems.length);

    document.querySelectorAll('.staff-summary-card').forEach((card) => {
      const onclick = String(card.getAttribute('onclick') || '');
      card.classList.toggle('is-active', onclick.includes(`'${currentStaffWorkFilter}'`));
    });

    const subtitle = document.getElementById('staff-work-subtitle');
    const subtitleMap = {
      all: 'Showing all assigned work',
      due: 'Showing records due today',
      overdue: 'Showing overdue records',
      requests: 'Showing draft and submitted requests',
      service: 'Showing active service orders'
    };
    if (subtitle) subtitle.textContent = subtitleMap[currentStaffWorkFilter] || subtitleMap.all;

    const visibleItems = items.filter(item => {
      if (currentStaffWorkFilter === 'all') return true;
      if (currentStaffWorkFilter === 'due') return item.dueState === 'due';
      if (currentStaffWorkFilter === 'overdue') return item.dueState === 'overdue';
      return item.category === currentStaffWorkFilter;
    }).slice(0, 10);

    const tbody = document.getElementById('staff-work-body');
    if (!tbody) return;
    if (!visibleItems.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No work items for this view.</td></tr>';
      renderStaffRequestTracker();
      return;
    }

    tbody.innerHTML = visibleItems.map((item) => {
      const dueText = item.dueDate ? formatDateYmd(item.dueDate) : '-';
      const statusText = String(item.status || 'open').replace(/_/g, ' ');
      const statusClass = `status-${String(item.status || 'open').replace(/_/g, '-')}`;
      const actionType = item.type === 'Service' ? 'service' : (item.type === 'Request' ? 'request' : 'project');
      return `
        <tr>
          <td>${escHtml(item.type)}</td>
          <td>${escHtml(item.title)}</td>
          <td>${escHtml(item.module)}</td>
          <td>${escHtml(dueText)}</td>
          <td><span class="status-pill ${escHtml(statusClass)}">${escHtml(statusText)}</span></td>
          <td class="text-center">
            <button class="btn btn-cancel btn-sm staff-work-open-btn" type="button" onclick="openStaffWorkItem('${actionType}', ${Number(item.recordId || 0)})">Open</button>
          </td>
        </tr>
      `;
    }).join('');

    renderStaffRequestTracker();
  }

  async function renderStaffRequestTracker() {
    const tbody = document.getElementById('staff-request-body');
    if (!tbody || !isStaffUser()) return;

    const terms = getStaffIdentityTerms();
    const pendingProjects = await loadStaffPendingProjectRequests();
    setStaffMetric('staff-work-requests', pendingProjects.length);
    const totalMetric = document.getElementById('staff-work-total');
    if (totalMetric && Number(totalMetric.textContent || 0) < pendingProjects.length) {
      totalMetric.textContent = String(pendingProjects.length);
    }
    const projectRequests = pendingProjects
      .filter(project => Number(project.is_archived || 0) === 0)
      .map(project => ({
        type: 'Project',
        id: Number(project.id || 0),
        title: getProjectLinkLabel(project) || project.project_name || 'Project Draft',
        module: 'Projects',
        status: String(project.status || 'draft').toLowerCase(),
        created_at: project.created_at,
        submittedAt: project.submitted_at,
        submittedBy: project.submitted_by || project.created_by_name || project.project_manager,
        approvedAt: project.approved_at,
        approvedBy: project.approved_by,
        statusReason: project.status_reason,
        url: '/staff?panel=project-records&tab=projects'
      }));

    const requisitions = await fetchJsonOrEmpty('/api/procurement/requisitions');
    const prRequests = requisitions
      .filter(row => {
        if (isRecordOwnedByCurrentStaff(row)) return true;
        return [
          row.requested_by,
          row.requested_by_email,
          row.submitted_by,
          row.department
        ].some(value => textContainsStaffTerm(value, terms));
      })
      .map(row => ({
        type: 'Purchase Request',
        id: Number(row.id || 0),
        title: row.pr_number || row.item_summary || 'Purchase Requisition',
        module: 'Procurement',
        status: String(row.status || 'draft').toLowerCase(),
        created_at: row.created_at,
        request_date: row.request_date,
        submittedAt: row.submitted_at,
        submittedBy: row.submitted_by || row.requested_by,
        approvedAt: row.approved_at,
        approvedBy: row.approved_by,
        cancelledAt: row.cancelled_at,
        cancelledBy: row.cancelled_by,
        cancelReason: row.cancel_reason,
        url: '/procurement?tab=requisitions'
      }));

    const companyRequests = await fetchJsonOrEmpty('/api/company-registry-requests');
    const companyRegistryRequests = companyRequests
      .map(row => {
        const payload = row && typeof row.payload === 'object' && row.payload ? row.payload : {};
        return {
          type: 'Company Registry',
          title: payload.company_name || row.request_no || 'Company Registry Request',
          module: 'Master Data',
          status: String(row.status || 'submitted').toLowerCase(),
          created_at: row.created_at,
          submittedAt: row.created_at,
          submittedBy: payload.requested_by || row.requested_by || currentUser?.fullname || currentUser?.username,
          approvedAt: row.approved_at,
          approvedBy: row.approved_by,
          rejectReason: row.reject_reason,
          url: '/master-data?tab=companies'
        };
      });

    const rows = [...projectRequests, ...prRequests, ...companyRegistryRequests]
      .filter(row => ['draft', 'submitted', 'pending', 'approved', 'rejected', 'planning'].includes(row.status))
      .sort((a, b) => {
        const rank = { rejected: 0, submitted: 1, pending: 2, draft: 3, planning: 4, approved: 5 };
        return (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
      })
      .slice(0, 12);

    setStaffMetric('staff-work-requests', rows.length);
    const currentItems = buildStaffWorkItems();
    const nonRequestItems = currentItems.filter(item => item.category !== 'requests').length;
    setStaffMetric('staff-work-total', nonRequestItems + rows.length);

    if (!rows.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No drafts or submitted requests yet.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(row => {
      const statusInfo = getStaffRequestStatusInfo(row);
      return `
        <tr>
          <td>${escHtml(row.type)}</td>
          <td>${escHtml(row.title)}</td>
          <td>${escHtml(row.module)}</td>
          <td><span class="status-pill ${escHtml(statusInfo.className)}">${escHtml(statusInfo.label)}</span></td>
          <td>${renderStaffAuditTrail(row)}</td>
          <td class="text-center">
            ${renderStaffRequestAction(row)}
          </td>
        </tr>
      `;
    }).join('');
  }

  Object.assign(window, {
    getStaffIdentityTerms,
    textContainsStaffTerm,
    isRecordOwnedByCurrentStaff,
    projectAssignedToCurrentStaff,
    projectVisibleToCurrentStaff,
    serviceOrderAssignedToCurrentStaff,
    getStaffRecordDate,
    getStaffWorkDueState,
    buildStaffWorkItems,
    setStaffMetric,
    loadStaffPendingProjectRequests,
    filterStaffWorkQueue,
    updateStaffWorkspaceSummaryCard,
    openStaffWorkspaceFromDashboard,
    openStaffWorkItem,
    getStaffRequestStatusInfo,
    renderStaffAuditTrail,
    renderStaffRequestAction,
    renderStaffDashboard,
    renderStaffRequestTracker
  });
})();
