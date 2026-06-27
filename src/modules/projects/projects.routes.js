// Projects — project records lifecycle, PDF, archive summary, and task/cost views.
// Extracted from server.js incrementally (step 26+ — see src/ARCHITECTURE.md). Built up chunk by
// chunk like the procurement module. Shared infra imported; project doc-number, PDF, notification
// and approval helpers injected.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, queryAsync, isPostgresUniqueViolation } = require('../../database');
const { protectAdmin, protectAdminOnly, getAuthenticatedUser, isStaffRole, isAdminRole, normalizeAccessRole } = require('../../middleware/auth');
const { normalizePhone, isValidPhone } = require('../../shared/validation');

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

// Project-centered cascade: archive/restore every record linked to a project (project_id = X).
// Best-effort per table — a table missing project_id or archived is skipped, so one odd schema
// never breaks the cascade. Returns how many linked rows were toggled. Restore mirrors archive
// (symmetric — the project's connections come back with it).
const PROJECT_CASCADE_TABLES = ['purchase_requisitions', 'purchase_orders', 'sales_management_records', 'goods_receipts', 'accounts_receivable', 'procurement_quotations'];
async function cascadeProjectArchive(projectId, archived) {
  const flag = archived ? 'TRUE' : 'FALSE';
  let total = 0;
  for (const table of PROJECT_CASCADE_TABLES) {
    try {
      const r = await queryAsync(`UPDATE ${table} SET archived = ${flag} WHERE project_id = ?`, [projectId]);
      total += Number((r && (r.affectedRows ?? r.rowCount)) || 0);
    } catch (_) { /* table lacks project_id or archived — skip */ }
  }
  return total;
}

module.exports = function createProjectsRouter(deps) {
  const {
    projectRowMatchesStaffActor,
    sendStaffRecordAccessDenied,
    sendProjectPdf,
    generateNextProjectDocnoAsync,
    getProjectInvoiceNumber,
    getProjectBillNumber,
    getApprovalActorName,
    getApprovalActorLabel,
    getApprovalComment,
    appendApprovalComment,
    notifyProjectRequester,
    notifyProjectApprovalRequest,
    sendBackgroundNotification,
    assertProjectAcceptsNewActivity,
    isProjectAwaitingApprovalStatus,
    getProjectAwaitingApprovalMessage,
    peekNextProjectDocnoAsync,
    peekNextDraftProjectDocnoAsync,
    runArchiveMaintenance,
    normalizeBusinessEntityId,
    upload,
    UPLOAD_DIR,
    toNumber,
    resolveBusinessEntityId,
    resolveProjectAssignedStaffId,
    deleteUploadedPdfIfPresent,
    computeProjectPriority,
    getMissingProjectRequiredFields,
    resolveCompanyRegistryReference,
    findProjectDuplicateByIdentity,
    sendProjectDuplicateResponse,
    ensureCompanyRegistryForProject,
    ensureDefaultProjectTasks,
    generateNextDraftProjectDocnoAsync,
    normalizeProjectStatusForSave,
    generateNextProjectDocno,
    logAction
  } = deps;
  const router = express.Router();

  router.get('/api/projects/:id/pdf', protectAdmin, async (req, res) => {
    const projectId = Number(req.params.id || 0);
    if (!projectId) return res.status(400).json({ error: 'Invalid project id' });

    try {
      const rows = await queryAsync(
        `SELECT id, status, created_by, assigned_to, project_manager, members,
                project_members, project_members_2, project_members_3
         FROM projects WHERE id = ? LIMIT 1`,
        [projectId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Project not found.' });
      const actor = getAuthenticatedUser(req) || {};
      if (isStaffRole(actor.role) && !projectRowMatchesStaffActor(rows[0], actor)) {
        return sendStaffRecordAccessDenied(res, 'Project');
      }
      if (isAdminRole(getAuthenticatedUser(req)?.role) && String(rows[0].status || '').trim().toLowerCase() === 'draft') {
        return res.status(404).json({ error: 'Project not found.' });
      }
      return sendProjectPdf(req, res, projectId);
    } catch (err) {
      console.error('Project PDF access check error:', err);
      return res.status(500).json({ error: err.message || 'Unable to load project PDF.' });
    }
  });

  router.get('/api/projects/:id/archive-summary', protectAdminOnly, async (req, res) => {
    const projectId = Number(req.params.id || 0);
    if (!projectId) return res.status(400).json({ error: 'Invalid project id' });

    try {
      const projectRows = await queryAsync(
        'SELECT id, project_docno, project_name, COALESCE(is_archived, FALSE) AS is_archived FROM projects WHERE id = ? LIMIT 1',
        [projectId]
      );
      if (!projectRows.length) return res.status(404).json({ error: 'Project not found' });

      const [prRows, poRows, apRows, arRows, taskRows] = await Promise.all([
        queryAsync(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'ordered') THEN 1 ELSE 0 END) AS open_count
           FROM purchase_requisitions
           WHERE project_id = ?`,
          [projectId]
        ),
        queryAsync(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'received') THEN 1 ELSE 0 END) AS open_count
           FROM purchase_orders
           WHERE project_id = ?`,
          [projectId]
        ),
        queryAsync(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN LOWER(COALESCE(status, '')) NOT IN ('paid', 'cancelled') THEN 1 ELSE 0 END) AS open_count
           FROM accounts_payable
           WHERE project_id = ?`,
          [projectId]
        ),
        queryAsync(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN LOWER(COALESCE(status, '')) NOT IN ('paid', 'cancelled') AND COALESCE(archived, FALSE) = FALSE THEN 1 ELSE 0 END) AS open_count
           FROM accounts_receivable
           WHERE project_id = ?`,
          [projectId]
        ),
        queryAsync(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN LOWER(COALESCE(status, '')) NOT IN ('completed', 'done', 'cancelled') AND COALESCE(progress, 0) < 100 THEN 1 ELSE 0 END) AS open_count
           FROM tasks
           WHERE project_id = ?`,
          [projectId]
        )
      ]);

      const readCount = (rows, key) => Number(rows?.[0]?.[key] || 0);
      res.json({
        project: projectRows[0],
        warning: 'Only the project will be archived. Related records stay visible in their modules for accounting, procurement, and audit history.',
        blocks_new_activity: true,
        counts: {
          purchase_requisitions: { total: readCount(prRows, 'total'), open: readCount(prRows, 'open_count') },
          purchase_orders: { total: readCount(poRows, 'total'), open: readCount(poRows, 'open_count') },
          accounts_payable: { total: readCount(apRows, 'total'), open: readCount(apRows, 'open_count') },
          accounts_receivable: { total: readCount(arRows, 'total'), open: readCount(arRows, 'open_count') },
          tasks: { total: readCount(taskRows, 'total'), open: readCount(taskRows, 'open_count') }
        }
      });
    } catch (err) {
      console.error('Project archive summary error:', err);
      res.status(500).json({ error: err.message || 'Unable to load project archive summary.' });
    }
  });

  router.post('/api/projects/:id/approve', protectAdminOnly, async (req, res) => {
    const projectId = Number(req.params.id || 0);
    if (!projectId) return res.status(400).json({ error: 'Invalid project id' });

    try {
      const rows = await queryAsync(
        'SELECT id, project_docno, draft_docno, project_name, business_entity_id, status, COALESCE(is_archived, FALSE) AS is_archived FROM projects WHERE id = ? LIMIT 1',
        [projectId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Project not found' });
      if (rows[0].is_archived === true || Number(rows[0].is_archived || 0) === 1) {
        return res.status(400).json({ error: 'Restore the project before approval.' });
      }

      const currentStatus = String(rows[0].status || '').trim().toLowerCase();
      if (currentStatus === 'draft' || currentStatus === 'needs_revision') {
        return res.status(400).json({ error: 'Submit the project for approval before approving it.' });
      }
      if (currentStatus !== 'submitted') {
        return res.json({ success: true, status: currentStatus || 'planning', alreadyApproved: true });
      }

      const approvedBy = getApprovalActorName(req);
      const officialProjectDocno = String(rows[0].project_docno || '').trim()
        || await generateNextProjectDocnoAsync(rows[0].business_entity_id || null);
      const projectArInvoiceNo = getProjectInvoiceNumber(officialProjectDocno);
      const projectApBillNo = getProjectBillNumber(officialProjectDocno);
      const comment = getApprovalComment(req);
      await queryAsync(
        "UPDATE projects SET project_docno = ?, project_ar_invoice_no = ?, project_ap_bill_no = ?, status = 'planning', approved_by = ?, approved_at = COALESCE(approved_at, NOW()), approval_comment = ? WHERE id = ?",
        [officialProjectDocno, projectArInvoiceNo, projectApBillNo, approvedBy, comment || null, projectId]
      );
      logAction(req, 'APPROVE_PROJECT', appendApprovalComment(`Draft No: ${rows[0].draft_docno || '-'} | Project No: ${officialProjectDocno || projectId} | Project Name: ${rows[0].project_name || ''} | Approved by ${approvedBy}`, comment), 'projects', { entityType: 'project', entityId: projectId, businessEntityId: rows[0].business_entity_id, changes: [{ field: 'status', from: 'submitted', to: 'planning' }] });
      sendBackgroundNotification(() => notifyProjectRequester(req, projectId, 'approved', {
        approvedBy: getApprovalActorLabel(req)
      }), 'project approved staff email');
      res.json({ success: true, status: 'planning', project_docno: officialProjectDocno, approved_by: approvedBy, approval_comment: comment });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to approve project.' });
    }
  });

  router.post('/api/projects/:id/reject', protectAdminOnly, async (req, res) => {
    const projectId = Number(req.params.id || 0);
    const reason = String(req.body?.reason || '').trim();
    if (!projectId) return res.status(400).json({ error: 'Invalid project id' });
    if (!reason) return res.status(400).json({ error: 'Rejection reason is required.' });

    try {
      const rows = await queryAsync(
        'SELECT id, project_docno, draft_docno, project_name, business_entity_id, status, COALESCE(is_archived, FALSE) AS is_archived FROM projects WHERE id = ? LIMIT 1',
        [projectId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Project not found' });
      if (rows[0].is_archived === true || Number(rows[0].is_archived || 0) === 1) {
        return res.status(400).json({ error: 'Restore the project before rejection.' });
      }

      const currentStatus = String(rows[0].status || '').trim().toLowerCase();
      if (currentStatus !== 'submitted') {
        return res.status(400).json({ error: 'Only submitted projects can be rejected.' });
      }

      const actor = getApprovalActorName(req);
      await queryAsync(
        "UPDATE projects SET status = 'needs_revision', status_reason = ?, approved_by = ?, approved_at = COALESCE(approved_at, NOW()), approval_comment = ? WHERE id = ?",
        [`Needs revision by ${actor}: ${reason}`, actor, reason, projectId]
      );
      logAction(req, 'REJECT_PROJECT', `Project No: ${rows[0].project_docno || rows[0].draft_docno || projectId} | Project Name: ${rows[0].project_name || ''} | Reason: ${reason}`, 'projects', { entityType: 'project', entityId: projectId, businessEntityId: rows[0].business_entity_id, severity: 'warning', changes: [{ field: 'status', from: 'submitted', to: 'needs_revision' }] });
      res.json({ success: true, status: 'needs_revision', reason });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to reject project.' });
    }
  });

  router.post('/api/projects/:id/submit', protectAdmin, async (req, res) => {
    const projectId = Number(req.params.id || 0);
    if (!projectId) return res.status(400).json({ error: 'Invalid project id' });

    try {
      const rows = await queryAsync(
        `SELECT id, project_docno, draft_docno, project_name, business_entity_id, status, COALESCE(is_archived, FALSE) AS is_archived,
                created_by, assigned_to, project_manager, members,
                project_members, project_members_2, project_members_3
         FROM projects WHERE id = ? LIMIT 1`,
        [projectId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Project not found' });
      const actor = getAuthenticatedUser(req) || {};
      if (isStaffRole(actor.role) && !projectRowMatchesStaffActor(rows[0], actor)) {
        return sendStaffRecordAccessDenied(res, 'Project');
      }
      if (rows[0].is_archived === true || Number(rows[0].is_archived || 0) === 1) {
        return res.status(400).json({ error: 'Restore the project before submitting it.' });
      }

      const currentStatus = String(rows[0].status || '').trim().toLowerCase();
      if (currentStatus === 'submitted') {
        return res.json({ success: true, status: 'submitted', alreadySubmitted: true });
      }
      if (!['draft', 'needs_revision'].includes(currentStatus)) {
        return res.status(400).json({ error: 'Only draft or needs revision projects can be submitted for approval.' });
      }

      await queryAsync("UPDATE projects SET status = 'submitted', approved_by = NULL, approved_at = NULL WHERE id = ?", [projectId]);
      logAction(req, 'SUBMIT_PROJECT', `Project No: ${rows[0].project_docno || rows[0].draft_docno || projectId} | Project Name: ${rows[0].project_name || ''}`, 'projects', { entityType: 'project', entityId: projectId, businessEntityId: rows[0].business_entity_id, changes: [{ field: 'status', from: rows[0].status, to: 'submitted' }] });
      sendBackgroundNotification(() => notifyProjectApprovalRequest(req, projectId), 'project approval request email');
      res.json({ success: true, status: 'submitted', requiresApproval: true });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to submit project.' });
    }
  });

  router.put('/api/projects/:id/archive', protectAdminOnly, async (req, res) => {
    const projectId = Number(req.params.id || 0);
    if (!projectId) return res.status(400).json({ error: 'Invalid project id' });
    try {
      const result = await queryAsync('UPDATE projects SET is_archived = TRUE, archived_at = CURRENT_TIMESTAMP, archived_auto = FALSE WHERE id = ?', [projectId]);
      if (!((result && (result.affectedRows ?? result.rowCount)) || 0)) return res.status(404).json({ error: 'Project not found' });
      // Project-centered: archive every linked record (PR/PO/Sales/GRN/AR/Quotation) too.
      const cascaded = await cascadeProjectArchive(projectId, true);
      logAction(req, 'ARCHIVE_PROJECT', `Archived project ID: ${projectId}${cascaded ? ` (+${cascaded} linked record(s))` : ''}`, 'projects', { entityType: 'project', entityId: projectId, severity: 'warning' });
      res.json({ success: true, cascaded });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/api/projects/:id/restore', protectAdminOnly, async (req, res) => {
    const projectId = Number(req.params.id || 0);
    if (!projectId) return res.status(400).json({ error: 'Invalid project id' });
    try {
      const result = await queryAsync('UPDATE projects SET is_archived = FALSE, archived_at = NULL, archived_auto = FALSE WHERE id = ?', [projectId]);
      if (!((result && (result.affectedRows ?? result.rowCount)) || 0)) return res.status(404).json({ error: 'Project not found' });
      // Symmetric cascade: restoring the project brings its linked records back too.
      const cascaded = await cascadeProjectArchive(projectId, false);
      logAction(req, 'RESTORE_PROJECT', `Restored project ID: ${projectId}${cascaded ? ` (+${cascaded} linked record(s))` : ''}`, 'projects', { entityType: 'project', entityId: projectId, severity: 'info' });
      res.json({ success: true, cascaded });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/api/projects/:projectId/tasks', protectAdmin, async (req, res) => {
    const projectId = Number(req.params.projectId || 0);
    if (!projectId) return res.status(400).json({ error: 'Invalid project id' });
    try {
      const projectRows = await queryAsync(
        `SELECT id, created_by, assigned_to, project_manager, members,
                project_members, project_members_2, project_members_3
         FROM projects WHERE id = ? LIMIT 1`,
        [projectId]
      );
      if (!projectRows.length) return res.status(404).json({ error: 'Project not found' });
      const actor = getAuthenticatedUser(req) || {};
      if (isStaffRole(actor.role) && !projectRowMatchesStaffActor(projectRows[0], actor)) {
        return sendStaffRecordAccessDenied(res, 'Project');
      }
      const rows = await queryAsync('SELECT * FROM tasks WHERE project_id = ? ORDER BY start_date ASC', [projectId]);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to load tasks.' });
    }
  });

  router.post('/api/tasks', protectAdmin, async (req, res) => {
    const { project_id, task_name, start_date, end_date, assigned_to, plan_cost } = req.body;
    if (!project_id || !task_name || !start_date || !end_date)
      return res.status(400).json({ error: 'Missing required fields' });

    try {
      const actor = getAuthenticatedUser(req) || {};
      if (isStaffRole(actor.role)) {
        const projectRows = await queryAsync(
          `SELECT id, created_by, assigned_to, project_manager, members,
                  project_members, project_members_2, project_members_3
           FROM projects WHERE id = ? LIMIT 1`,
          [project_id]
        );
        if (!projectRows.length) return res.status(404).json({ error: 'Project not found' });
        if (!projectRowMatchesStaffActor(projectRows[0], actor)) {
          return sendStaffRecordAccessDenied(res, 'Project');
        }
      }
      await assertProjectAcceptsNewActivity(project_id);
      const duration = Math.ceil((new Date(end_date) - new Date(start_date)) / (1000 * 60 * 60 * 24));
      db.query(
        'INSERT INTO tasks (project_id, task_name, start_date, end_date, duration, assigned_to, plan_cost) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [project_id, task_name, start_date, end_date, duration, assigned_to || null, plan_cost || 0],
        (err, result) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ id: result.insertId });
        }
      );
    } catch (err) {
      res.status(400).json({ error: err.message || 'Unable to add task.' });
    }
  });

  router.put('/api/projects/:projectId/tasks', protectAdmin, (req, res) => {
    const projectId = Number(req.params.projectId);
    const tasks = Array.isArray(req.body.tasks) ? req.body.tasks : [];

    if (!projectId) {
      return res.status(400).json({ error: 'Invalid project id' });
    }

    db.query(`SELECT id, status, COALESCE(is_archived, FALSE) AS is_archived,
                     created_by, assigned_to, project_manager, members,
                     project_members, project_members_2, project_members_3
              FROM projects WHERE id = ?`, [projectId], (projectErr, rows) => {
      if (projectErr) return res.status(500).json({ error: projectErr.message });
      if (!rows || !rows.length) return res.status(404).json({ error: 'Project not found' });
      const actor = getAuthenticatedUser(req) || {};
      if (isStaffRole(actor.role) && !projectRowMatchesStaffActor(rows[0], actor)) {
        return sendStaffRecordAccessDenied(res, 'Project');
      }
      if (rows[0].is_archived === true || Number(rows[0].is_archived || 0) === 1) {
        return res.status(400).json({ error: 'Selected project is archived. Restore the project before creating new activity.' });
      }
      if (isProjectAwaitingApprovalStatus(rows[0].status)) {
        return res.status(400).json({ error: getProjectAwaitingApprovalMessage('creating new activity') });
      }

      db.getConnection((connErr, connection) => {
        if (connErr) return res.status(500).json({ error: connErr.message });

        const finish = (statusCode, payload) => {
          connection.release();
          return res.status(statusCode).json(payload);
        };

        connection.beginTransaction((txErr) => {
          if (txErr) {
            connection.release();
            return res.status(500).json({ error: txErr.message });
          }

          connection.query('DELETE FROM tasks WHERE project_id = ?', [projectId], (deleteErr) => {
            if (deleteErr) {
              return connection.rollback(() => finish(500, { error: deleteErr.message }));
            }

            const normalizedTasks = tasks.map((task, index) => {
              const taskName = String(task?.task_name || task?.taskName || '').trim();
              const startDate = String(task?.start_date || task?.startDate || '').trim();
              const endDate = String(task?.end_date || task?.endDate || '').trim();
              const assignee = String(task?.assigned_to || task?.assignee || '').trim();
              const status = String(task?.status || 'not_started').trim();
              const progress = Number(task?.progress || 0);
              const planCost = Number(task?.plan_cost || 0);
              const actualCost = Number(task?.actual_cost || 0);
              const safeStart = startDate || null;
              const safeEnd = endDate || null;
              const start = safeStart ? new Date(safeStart) : null;
              const end = safeEnd ? new Date(safeEnd) : null;
              const duration = (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()))
                ? Math.max(1, Math.round((end - start) / 86400000) + 1)
                : 1;

              return {
                taskName: taskName || `Task ${index + 1}`,
                startDate: safeStart,
                endDate: safeEnd,
                duration,
                assignee: assignee || null,
                status: ['not_started', 'in_progress', 'on_hold', 'completed', 'cancelled'].includes(status) ? status : 'not_started',
                progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0,
                planCost: Number.isFinite(planCost) ? planCost : 0,
                actualCost: Number.isFinite(actualCost) ? actualCost : 0
              };
            });

            if (!normalizedTasks.length) {
              return connection.commit((commitErr) => {
                if (commitErr) {
                  return connection.rollback(() => finish(500, { error: commitErr.message }));
                }
                finish(200, { success: true, totalTasks: 0 });
              });
            }

            let index = 0;
            const insertNext = () => {
              if (index >= normalizedTasks.length) {
                return connection.commit((commitErr) => {
                  if (commitErr) {
                    return connection.rollback(() => finish(500, { error: commitErr.message }));
                  }
                  finish(200, { success: true, totalTasks: normalizedTasks.length });
                });
              }

              const task = normalizedTasks[index++];
              connection.query(
                `INSERT INTO tasks
                  (project_id, task_name, start_date, end_date, duration, progress, assigned_to, status, plan_cost, actual_cost)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  projectId,
                  task.taskName,
                  task.startDate,
                  task.endDate,
                  task.duration,
                  task.progress,
                  task.assignee,
                  task.status,
                  task.planCost,
                  task.actualCost
                ],
                (insertErr) => {
                  if (insertErr) {
                    return connection.rollback(() => finish(500, { error: insertErr.message }));
                  }
                  insertNext();
                }
              );
            };

            insertNext();
          });
        });
      });
    });
  });

  router.put('/api/tasks/:taskId', protectAdmin, (req, res) => {
    const { progress, actual_cost, status } = req.body;
    db.query(
      'UPDATE tasks SET progress = ?, actual_cost = ?, status = ? WHERE id = ?',
      [progress || 0, actual_cost || 0, status || 'in_progress', req.params.taskId],
      (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Task not found' });
        res.json({ success: true });
      }
    );
  });

  router.get('/api/projects/:projectId/costs', protectAdmin, async (req, res) => {
    const projectId = Number(req.params.projectId || 0);
    if (!projectId) return res.status(400).json({ error: 'Invalid project id' });
    try {
      const projectRows = await queryAsync(
        `SELECT id, created_by, assigned_to, project_manager, members,
                project_members, project_members_2, project_members_3
         FROM projects WHERE id = ? LIMIT 1`,
        [projectId]
      );
      if (!projectRows.length) return res.status(404).json({ error: 'Project not found' });
      const actor = getAuthenticatedUser(req) || {};
      if (isStaffRole(actor.role) && !projectRowMatchesStaffActor(projectRows[0], actor)) {
        return sendStaffRecordAccessDenied(res, 'Project');
      }
      const rows = await queryAsync('SELECT * FROM project_costs WHERE project_id = ? ORDER BY cost_date DESC', [projectId]);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to load project costs.' });
    }
  });

  router.post('/api/project-costs', protectAdmin, async (req, res) => {
    const { project_id, task_id, cost_category, plan_amount, actual_amount, cost_date, notes } = req.body;
    if (!project_id || !cost_category || !plan_amount)
      return res.status(400).json({ error: 'Missing required fields' });

    try {
      const actor = getAuthenticatedUser(req) || {};
      if (isStaffRole(actor.role)) {
        const projectRows = await queryAsync(
          `SELECT id, created_by, assigned_to, project_manager, members,
                  project_members, project_members_2, project_members_3
           FROM projects WHERE id = ? LIMIT 1`,
          [project_id]
        );
        if (!projectRows.length) return res.status(404).json({ error: 'Project not found' });
        if (!projectRowMatchesStaffActor(projectRows[0], actor)) {
          return sendStaffRecordAccessDenied(res, 'Project');
        }
      }
      await assertProjectAcceptsNewActivity(project_id);
      const variance = (actual_amount || 0) - plan_amount;
      db.query(
        'INSERT INTO project_costs (project_id, task_id, cost_category, plan_amount, actual_amount, variance, cost_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [project_id, task_id || null, cost_category, plan_amount, actual_amount || 0, variance, cost_date || new Date().toISOString().slice(0, 10), notes || null],
        (err, result) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ id: result.insertId });
        }
      );
    } catch (err) {
      res.status(400).json({ error: err.message || 'Unable to add project cost.' });
    }
  });

  router.get('/api/projects/:projectId/summary', protectAdmin, async (req, res) => {
    const projectId = Number(req.params.projectId || 0);
    if (!projectId) return res.status(400).json({ error: 'Invalid project id' });
    try {
      const projectRows = await queryAsync(
        `SELECT id, created_by, assigned_to, project_manager, members,
                project_members, project_members_2, project_members_3
         FROM projects WHERE id = ? LIMIT 1`,
        [projectId]
      );
      if (!projectRows.length) return res.status(404).json({ error: 'Project not found' });
      const actor = getAuthenticatedUser(req) || {};
      if (isStaffRole(actor.role) && !projectRowMatchesStaffActor(projectRows[0], actor)) {
        return sendStaffRecordAccessDenied(res, 'Project');
      }
      const rows = await queryAsync(`
      SELECT
        p.*,
        COUNT(DISTINCT t.id) AS total_tasks,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed_tasks,
        AVG(t.progress) AS avg_progress,
        SUM(t.plan_cost) AS total_plan_cost,
        SUM(t.actual_cost) AS total_actual_cost,
        (SUM(t.actual_cost) - SUM(t.plan_cost)) AS cost_variance
      FROM projects p
      LEFT JOIN tasks t ON p.id = t.project_id
      WHERE p.id = ?
      GROUP BY p.id
    `, [projectId]);
      res.json(rows[0] || {});
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to load project summary.' });
    }
  });

  router.get('/api/projects/next-docno', protectAdmin, (req, res) => {
    const actor = getAuthenticatedUser(req) || {};
    const nextNumberPromise = isStaffRole(actor.role)
      ? peekNextDraftProjectDocnoAsync(req.query.business_entity_id)
      : peekNextProjectDocnoAsync(req.query.business_entity_id);
    nextNumberPromise
      .then((projectDocno) => {
        res.json(isStaffRole(actor.role)
          ? { project_docno: projectDocno, draft_docno: projectDocno, number_type: 'draft' }
          : { project_docno: projectDocno, number_type: 'official' });
      })
      .catch((err) => res.status(500).json({ error: err.message }));
  });

  router.get('/api/projects', protectAdmin, (req, res) => {
    runArchiveMaintenance((maintenanceErr) => {
      if (maintenanceErr) {
        console.error('Project maintenance warning:', maintenanceErr);
      }

      const includeArchived = String(req.query.include_archived || '0') === '1';
      const actor = getAuthenticatedUser(req) || {};
      const conditions = [];
      const params = [];
      if (!includeArchived) conditions.push('COALESCE(p.is_archived, FALSE) = FALSE');
      if (isAdminRole(actor.role)) conditions.push("LOWER(COALESCE(p.status, '')) NOT IN ('draft', 'needs_revision')");
      if (isStaffRole(actor.role)) {
        const staffTerms = [actor.fullname, actor.username, actor.email]
          .map(value => String(value || '').trim().toLowerCase())
          .filter(value => value.length >= 3);
        const staffClauses = [];
        const actorId = Number(actor.id || 0) || 0;
        if (actorId) {
          staffClauses.push('p.assigned_to = ?');
          params.push(actorId);
          staffClauses.push('(p.assigned_to IS NULL AND p.created_by = ?)');
          params.push(actorId);
        }
        staffTerms.forEach((term) => {
          const like = `%${term}%`;
          staffClauses.push(`(p.assigned_to IS NULL AND (
            LOWER(COALESCE(p.project_manager, '')) LIKE ?
            OR LOWER(COALESCE(p.members, '')) LIKE ?
            OR LOWER(COALESCE(p.project_members, '')) LIKE ?
            OR LOWER(COALESCE(p.project_members_2, '')) LIKE ?
            OR LOWER(COALESCE(p.project_members_3, '')) LIKE ?
          ))`);
          params.push(like, like, like, like, like);
        });
        conditions.push(staffClauses.length ? `(${staffClauses.join(' OR ')})` : '1=0');
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      db.query(`
        SELECT
          p.*,
          COALESCE(p.project_docno, p.draft_docno) AS project_docno,
          p.project_docno AS official_project_docno,
          be.company_name AS business_entity_name,
          be.entity_code AS business_entity_code,
          creator.fullname AS created_by_name,
          creator.username AS created_by_username,
          creator.email AS created_by_email,
          assignee.fullname AS assigned_to_name,
          assignee.username AS assigned_to_username,
          assignee.email AS assigned_to_email,
          creg.company_name AS registry_company_name,
          creg.company_no AS registry_company_no,
          creg.contact_person AS registry_contact_person,
          creg.email AS registry_email,
          creg.phone AS registry_phone,
          creg.address AS registry_address
        FROM projects p
        LEFT JOIN business_entities be ON be.id = p.business_entity_id
        LEFT JOIN users creator ON creator.id = p.created_by
        LEFT JOIN users assignee ON assignee.id = p.assigned_to
        LEFT JOIN company_registry creg ON creg.id = p.company_id
        ${where}
        ORDER BY COALESCE(p.start_date, p.planned_start_date, p.created_at) DESC, p.id DESC
      `, params, (err, rows) => {
        if (err) {
          console.error('Projects API error:', err);
          return res.status(500).json({ error: err.message });
        }
        res.json(Array.isArray(rows) ? rows : []);
      });
    });
  });

  router.get('/api/projects/stats', protectAdmin, (req, res) => {
    runArchiveMaintenance((maintenanceErr) => {
      if (maintenanceErr) {
        console.error('Project stats maintenance warning:', maintenanceErr);
      }

      const yearParam = Number.parseInt(req.query.year, 10);
      const statsYear = Number.isFinite(yearParam) ? yearParam : new Date().getFullYear();
      const companyParam = String(req.query.company || '').trim();
      const companyFilter = companyParam && companyParam.toLowerCase() !== 'all' ? companyParam.toLowerCase() : '';
      const businessEntityId = normalizeBusinessEntityId(req.query.business_entity_id);
      const params = [];
      const whereParts = ['1=1'];
      const actor = getAuthenticatedUser(req) || {};
      if (businessEntityId) {
        whereParts.push('p.business_entity_id = ?');
        params.push(businessEntityId);
      }
      if (companyFilter) {
        whereParts.push('LOWER(COALESCE(p.company_name, p.client_name, p.company_no, \'\')) = ?');
        params.push(companyFilter);
      }
      if (isAdminRole(actor.role)) {
        whereParts.push("LOWER(COALESCE(p.status, '')) NOT IN ('draft', 'needs_revision', 'submitted')");
      }
      db.query(`
        SELECT
          SUM(
            CASE
              WHEN COALESCE(is_archived, FALSE) = FALSE AND status <> 'cancelled' THEN 1
              ELSE 0
            END
          ) AS total_projects,
          SUM(
            CASE
              WHEN COALESCE(is_archived, FALSE) = FALSE
                AND CURRENT_DATE >= COALESCE(actual_start_date, planned_start_date, start_date)
                AND CURRENT_DATE <= COALESCE(actual_end_date, planned_end_date, end_date)
                AND status NOT IN ('completed', 'cancelled', 'on_hold') THEN 1
              ELSE 0
            END
          ) AS ongoing_projects,
          SUM(
            CASE
              WHEN COALESCE(is_archived, FALSE) = FALSE
                AND CURRENT_DATE < COALESCE(actual_start_date, planned_start_date, start_date)
                AND status NOT IN ('completed', 'cancelled', 'on_hold') THEN 1
              ELSE 0
            END
          ) AS upcoming_projects,
          SUM(
            CASE
              WHEN COALESCE(is_archived, FALSE) = FALSE
                AND CURRENT_DATE > COALESCE(actual_end_date, planned_end_date, end_date)
                AND status NOT IN ('completed', 'cancelled', 'on_hold') THEN 1
              ELSE 0
            END
          ) AS overdue_projects
        FROM projects p
        WHERE ${whereParts.join(' AND ')}
      `, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const stats = rows[0] || {};
        res.json({
          total_projects: Number(stats.total_projects || 0),
          ongoing_projects: Number(stats.ongoing_projects || 0),
          upcoming_projects: Number(stats.upcoming_projects || 0),
          overdue_projects: Number(stats.overdue_projects || 0),
          stats_year: statsYear
        });
      });
    });
  });

  router.post('/api/projects', protectAdmin, upload.single('pdf_file'), async (req, res) => {
    const {
      project_name,
      business_entity_id,
      source_docno,
      company_id,
      company_no,
      company_name,
      client_name,
      description,
      checkno,
      pono,
      downpayment,
      qty,
      project_members,
      member_role,
      member_phone,
      project_members_2,
      member_role_2,
      member_phone_2,
      project_members_3,
      member_role_3,
      member_phone_3,
      start_date,
      end_date,
      planned_start_date,
      planned_end_date,
      actual_start_date,
      actual_end_date,
      status_reason,
      paused_at,
      cancelled_at,
      project_manager,
      budget,
      unit_cost,
      members,
      status,
      priority,
      assigned_to,
      service_type,
      estimated_material_cost,
      estimated_labor_cost,
      estimated_other_cost,
      project_location,
      createDefaultTask
    } = req.body;
    const pdfFilename = req.file ? req.file.filename : String(req.body.pdfFilename || '').trim() || null;
    const resolvedBudget = toNumber(budget, 0);
    const resolvedServiceType = String(service_type || 'installation').trim() || 'installation';
    const resolvedEstMaterial = toNumber(estimated_material_cost, 0);
    const resolvedEstLabor = toNumber(estimated_labor_cost, 0);
    const resolvedEstOther = toNumber(estimated_other_cost, 0);
    const resolvedProjectLocation = String(project_location || '').trim() || null;
    const resolvedDownpayment = toNumber(downpayment, 0);
    const resolvedQty = toNumber(qty, 0);
    const resolvedUnitCost = toNumber(unit_cost, 0);
    const normalizedMemberPhone = normalizePhone(member_phone);
    const normalizedMemberPhone2 = normalizePhone(member_phone_2);
    const normalizedMemberPhone3 = normalizePhone(member_phone_3);
    const resolvedPlannedStart = planned_start_date || start_date;
    const resolvedPlannedEnd = planned_end_date || end_date;
    const actor = getAuthenticatedUser(req) || {};
    const actorRole = normalizeAccessRole(actor.role);
    const isStaffCreator = isStaffRole(actorRole);
    let resolvedAssignedTo = null;
    try {
      resolvedAssignedTo = await resolveProjectAssignedStaffId(req, assigned_to);
    } catch (assignErr) {
      if (req.file) deleteUploadedPdfIfPresent(req.file.filename);
      return res.status(assignErr.statusCode || 400).json({ error: assignErr.message || 'Assigned staff is required.' });
    }
    const resolvedProjectStatus = isStaffCreator
      ? 'draft'
      : 'planning';
    const resolvedProjectPriority = computeProjectPriority(resolvedPlannedEnd, actual_end_date, resolvedProjectStatus);
    const approvedBy = ['draft', 'submitted'].includes(resolvedProjectStatus) ? null : getApprovalActorName(req);
    const todayYmd = new Date().toISOString().slice(0, 10);
    const resolvedPausedAt = resolvedProjectStatus === 'on_hold' ? (paused_at || todayYmd) : (paused_at || null);
    const resolvedCancelledAt = resolvedProjectStatus === 'cancelled' ? (cancelled_at || todayYmd) : (cancelled_at || null);

    const missingProjectFields = getMissingProjectRequiredFields({ ...req.body, start_date, end_date });
    if (missingProjectFields.length) {
      return res.status(400).json({ error: `Please complete all project information before saving: ${missingProjectFields.join(', ')}.` });
    }

    if (normalizedMemberPhone && !isValidPhone(normalizedMemberPhone)) {
      return res.status(400).json({ error: 'Member phone number must be digits only, 7 to 15 digits.' });
    }

    if (normalizedMemberPhone2 && !isValidPhone(normalizedMemberPhone2)) {
      return res.status(400).json({ error: 'Member 2 phone number must be digits only, 7 to 15 digits.' });
    }

    if (normalizedMemberPhone3 && !isValidPhone(normalizedMemberPhone3)) {
      return res.status(400).json({ error: 'Member 3 phone number must be digits only, 7 to 15 digits.' });
    }

    const projectMembersSummary = [
      project_members && member_role && normalizedMemberPhone ? `${project_members} (${member_role}) - ${normalizedMemberPhone}` : '',
      project_members_2 && member_role_2 && normalizedMemberPhone2 ? `${project_members_2} (${member_role_2}) - ${normalizedMemberPhone2}` : '',
      project_members_3 && member_role_3 && normalizedMemberPhone3 ? `${project_members_3} (${member_role_3}) - ${normalizedMemberPhone3}` : ''
    ].filter(Boolean).join(' | ') || null;
    resolveCompanyRegistryReference({ company_id, company_no, company_name, client_name }, async (companyErr, companyRecord) => {
      if (companyErr) return res.status(400).json({ error: companyErr.message });
      if (!companyRecord) return res.status(400).json({ error: 'Company is required' });

      const resolvedCompanyId = Number(companyRecord.id || 0) || null;
      const resolvedCompanyNo = String(companyRecord.company_no || '').trim() || null;
      const resolvedCompanyName = String(companyRecord.company_name || '').trim() || null;
      let resolvedBusinessEntityId = null;
      try {
        resolvedBusinessEntityId = await resolveBusinessEntityId(business_entity_id);
      } catch (entityErr) {
        return res.status(400).json({ error: entityErr.message || 'Selected operating company was not found.' });
      }

      let duplicateProject = null;
      try {
        duplicateProject = await findProjectDuplicateByIdentity({
          businessEntityId: resolvedBusinessEntityId,
          companyId: resolvedCompanyId,
          projectName: project_name,
          plannedStartDate: resolvedPlannedStart,
          plannedEndDate: resolvedPlannedEnd
        });
      } catch (dupErr) {
        return res.status(500).json({ error: dupErr.message || 'Unable to check duplicate project.' });
      }
      if (duplicateProject) {
        return sendProjectDuplicateResponse(res, duplicateProject);
      }

      const insertProject = (finalProjectDocno, finalDraftDocno = null) => {
        const projectArInvoiceNo = finalProjectDocno ? getProjectInvoiceNumber(finalProjectDocno) : null;
        const projectApBillNo = finalProjectDocno ? getProjectBillNumber(finalProjectDocno) : null;
        db.query(
          `INSERT INTO projects
            (project_docno, draft_docno, project_name, business_entity_id, company_id, source_docno, company_no, company_name, client_name, project_ar_invoice_no, project_ap_bill_no, description, checkno, pono, downpayment, qty,
             project_members, member_role, member_phone,
             project_members_2, member_role_2, member_phone_2,
             project_members_3, member_role_3, member_phone_3,
             start_date, end_date, planned_start_date, planned_end_date,
             actual_start_date, actual_end_date, status_reason, paused_at, cancelled_at,
             project_manager, pdfFilename, budget, unit_cost, members, status, priority, created_by, assigned_to, approved_by, approved_at,
             service_type, estimated_material_cost, estimated_labor_cost, estimated_other_cost, project_location)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
          [
            finalProjectDocno || null,
            finalDraftDocno || null,
            project_name,
            resolvedBusinessEntityId,
            resolvedCompanyId,
            source_docno || null,
            resolvedCompanyNo,
            resolvedCompanyName,
            resolvedCompanyName,
            projectArInvoiceNo,
            projectApBillNo,
            description || null,
            checkno || null,
            pono || null,
            resolvedDownpayment,
            resolvedQty,
            project_members || null,
            member_role || null,
            normalizedMemberPhone || null,
            project_members_2 || null,
            member_role_2 || null,
            normalizedMemberPhone2 || null,
            project_members_3 || null,
            member_role_3 || null,
            normalizedMemberPhone3 || null,
            start_date,
            end_date,
            resolvedPlannedStart,
            resolvedPlannedEnd,
            actual_start_date || null,
            actual_end_date || null,
            status_reason || null,
            resolvedPausedAt,
            resolvedCancelledAt,
            project_manager || null,
            pdfFilename,
            resolvedBudget,
            resolvedUnitCost,
            members || projectMembersSummary,
            resolvedProjectStatus,
            resolvedProjectPriority,
            actor.id || null,
            resolvedAssignedTo,
            approvedBy,
            approvedBy ? new Date() : null,
            resolvedServiceType,
            resolvedEstMaterial,
            resolvedEstLabor,
            resolvedEstOther,
            resolvedProjectLocation
          ],
          (err, result) => {
            if (err) {
              if (isPostgresUniqueViolation(err)) {
                return res.status(409).json({ error: 'Project No. already exists.' });
              }
              return res.status(500).json({ error: err.message });
            }

            const projectId = result.insertId;
            const projectForSync = {
              id: projectId,
              project_docno: finalProjectDocno || finalDraftDocno,
              business_entity_id: resolvedBusinessEntityId,
              company_id: resolvedCompanyId,
              company_no: resolvedCompanyNo,
              company_name: resolvedCompanyName,
              project_name,
              client_name: resolvedCompanyName,
              description,
              budget: resolvedBudget,
              downpayment: resolvedDownpayment,
              start_date,
              end_date,
              planned_start_date: resolvedPlannedStart,
              planned_end_date: resolvedPlannedEnd
            };

            ensureCompanyRegistryForProject(projectForSync, (registryErr) => {
              if (registryErr) {
                console.error('Company registry sync warning:', registryErr);
              }

              const respond = (taskErr, created) => {
                if (taskErr) {
                  console.error('Default task creation failed:', taskErr);
                }
                logAction(req, 'CREATE_PROJECT', `Project No: ${finalProjectDocno || finalDraftDocno} | Status: ${resolvedProjectStatus} | Company ID: ${resolvedCompanyId} | Company No: ${resolvedCompanyNo} | Company Name: ${resolvedCompanyName}`, 'projects', { entityType: 'project', entityId: projectId, businessEntityId: resolvedBusinessEntityId });
                if (resolvedProjectStatus === 'submitted') {
                  sendBackgroundNotification(() => notifyProjectApprovalRequest(req, projectId), 'project approval request email');
                }
                res.json({
                  id: projectId,
                  project_docno: finalProjectDocno || null,
                  draft_docno: finalDraftDocno || null,
                  status: resolvedProjectStatus,
                  requiresApproval: resolvedProjectStatus === 'submitted',
                  receivableSynced: false,
                  defaultTasksCreated: !taskErr && !!created
                });
              };

              const finalizeProjectSave = async () => {

                if (createDefaultTask) {
                  ensureDefaultProjectTasks(projectId, start_date, end_date, respond);
                } else {
                  respond(null, false);
                }
              };

              finalizeProjectSave().catch((finalizeErr) => {
                console.error('Project save finalization error:', finalizeErr);
                res.status(500).json({ error: finalizeErr.message || 'Unable to finalize project save.' });
              });
            });
          }
        );
      };

      const needsDraftNumber = ['draft', 'submitted'].includes(resolvedProjectStatus);
      const numberPromise = needsDraftNumber
        ? generateNextDraftProjectDocnoAsync(resolvedBusinessEntityId)
        : generateNextProjectDocnoAsync(resolvedBusinessEntityId);
      numberPromise
        .then((nextNumber) => {
          insertProject(needsDraftNumber ? null : nextNumber, needsDraftNumber ? nextNumber : null);
        })
        .catch((docErr) => res.status(500).json({ error: docErr.message }));
    });
  });

  router.put('/api/projects/:id', protectAdmin, upload.single('pdf_file'), (req, res) => {
    const {
      project_name,
      business_entity_id,
      source_docno,
      company_id,
      company_no,
      company_name,
      client_name,
      description,
      checkno,
      pono,
      downpayment,
      qty,
      project_members,
      member_role,
      member_phone,
      project_members_2,
      member_role_2,
      member_phone_2,
      project_members_3,
      member_role_3,
      member_phone_3,
      start_date,
      end_date,
      planned_start_date,
      planned_end_date,
      actual_start_date,
      actual_end_date,
      status_reason,
      paused_at,
      cancelled_at,
      project_manager,
      budget,
      unit_cost,
      members,
      status,
      priority,
      remove_pdf,
      assigned_to,
      service_type,
      estimated_material_cost,
      estimated_labor_cost,
      estimated_other_cost,
      project_location,
      createDefaultTask
    } = req.body;
    const incomingPdfFilename = req.file ? req.file.filename : String(req.body.pdfFilename || '').trim() || null;
    const normalizedMemberPhone = normalizePhone(member_phone);
    const normalizedMemberPhone2 = normalizePhone(member_phone_2);
    const normalizedMemberPhone3 = normalizePhone(member_phone_3);

    const missingProjectFields = getMissingProjectRequiredFields({ ...req.body, start_date, end_date });
    if (missingProjectFields.length) {
      return res.status(400).json({ error: `Please complete all project information before saving: ${missingProjectFields.join(', ')}.` });
    }

    if (normalizedMemberPhone && !isValidPhone(normalizedMemberPhone)) {
      return res.status(400).json({ error: 'Member phone number must be digits only, 7 to 15 digits.' });
    }

    if (normalizedMemberPhone2 && !isValidPhone(normalizedMemberPhone2)) {
      return res.status(400).json({ error: 'Member 2 phone number must be digits only, 7 to 15 digits.' });
    }

    if (normalizedMemberPhone3 && !isValidPhone(normalizedMemberPhone3)) {
      return res.status(400).json({ error: 'Member 3 phone number must be digits only, 7 to 15 digits.' });
    }

    const resolvedPlannedStart = planned_start_date || start_date;
    const resolvedPlannedEnd = planned_end_date || end_date;
    const projectMembersSummary = [
      project_members && member_role && normalizedMemberPhone ? `${project_members} (${member_role}) - ${normalizedMemberPhone}` : '',
      project_members_2 && member_role_2 && normalizedMemberPhone2 ? `${project_members_2} (${member_role_2}) - ${normalizedMemberPhone2}` : '',
      project_members_3 && member_role_3 && normalizedMemberPhone3 ? `${project_members_3} (${member_role_3}) - ${normalizedMemberPhone3}` : ''
    ].filter(Boolean).join(' | ') || null;

      db.query(`SELECT project_docno, draft_docno, project_name, pdfFilename, budget, downpayment, qty, unit_cost, status,
                       created_by, assigned_to, project_manager, members,
                       project_members, project_members_2, project_members_3
                FROM projects WHERE id = ?`, [req.params.id], async (findErr, rows) => {
      if (findErr) return res.status(500).json({ error: findErr.message });
      if (!rows || !rows.length) return res.status(404).json({ error: 'Project not found' });
      const actor = getAuthenticatedUser(req) || {};
      const actorRole = normalizeAccessRole(actor.role);
      if (isStaffRole(actorRole) && !projectRowMatchesStaffActor(rows[0], actor)) {
        if (req.file) deleteUploadedPdfIfPresent(req.file.filename);
        return sendStaffRecordAccessDenied(res, 'Project');
      }
      let resolvedAssignedTo = null;
      try {
        resolvedAssignedTo = await resolveProjectAssignedStaffId(req, assigned_to || rows[0].assigned_to);
      } catch (assignErr) {
        if (req.file) deleteUploadedPdfIfPresent(req.file.filename);
        return res.status(assignErr.statusCode || 400).json({ error: assignErr.message || 'Assigned staff is required.' });
      }

      const finalProjectDocno = String(rows[0].project_docno || '').trim();
      const finalDraftDocno = String(rows[0].draft_docno || '').trim();
      const currentPdfFilename = String(rows[0].pdfFilename || '').trim() || null;
      const removePdfRequested = String(remove_pdf || '').trim() === '1';
      if (currentPdfFilename) {
        const currentPdfPath = path.join(UPLOAD_DIR, path.basename(currentPdfFilename));
        if ((removePdfRequested || req.file) && fs.existsSync(currentPdfPath)) {
          try {
            fs.unlinkSync(currentPdfPath);
          } catch (unlinkErr) {
            console.error('Project PDF cleanup warning:', unlinkErr);
          }
        }
      }
      const finalPdfFilename = req.file
        ? req.file.filename
        : (removePdfRequested ? null : (incomingPdfFilename || currentPdfFilename));
      const resolvedBudget = toNumber(budget, rows[0].budget || 0);
      const resolvedDownpayment = toNumber(downpayment, rows[0].downpayment || 0);
      const resolvedQty = toNumber(qty, rows[0].qty || 0);
      const resolvedUnitCost = toNumber(unit_cost, rows[0].unit_cost || 0);
      const resolvedServiceType = String(service_type || 'installation').trim() || 'installation';
      const resolvedEstMaterial = toNumber(estimated_material_cost, 0);
      const resolvedEstLabor = toNumber(estimated_labor_cost, 0);
      const resolvedEstOther = toNumber(estimated_other_cost, 0);
      const resolvedProjectLocation = String(project_location || '').trim() || null;
      const currentProjectStatus = String(rows[0].status || 'planning').trim().toLowerCase() || 'planning';
      const projectSubmitAction = String(req.body.project_submit_action || '').trim().toLowerCase();
      let resolvedProjectStatus = isStaffRole(actorRole)
        ? currentProjectStatus
        : normalizeProjectStatusForSave(status || currentProjectStatus, actual_start_date, actual_end_date, resolvedPlannedEnd, resolvedPlannedStart);
      if (!isStaffRole(actorRole) && (currentProjectStatus === 'draft' || currentProjectStatus === 'needs_revision' || currentProjectStatus === 'submitted')) {
        resolvedProjectStatus = projectSubmitAction === 'submit' ? 'submitted' : 'draft';
      }
      const resolvedProjectPriority = computeProjectPriority(resolvedPlannedEnd, actual_end_date, resolvedProjectStatus);
      const newlyApprovedBy = ['draft', 'needs_revision', 'submitted'].includes(currentProjectStatus) && !['draft', 'needs_revision', 'submitted'].includes(resolvedProjectStatus)
        ? getApprovalActorName(req)
        : null;
      const todayYmd = new Date().toISOString().slice(0, 10);
      const resolvedPausedAt = resolvedProjectStatus === 'on_hold' ? (paused_at || todayYmd) : (paused_at || null);
      const resolvedCancelledAt = resolvedProjectStatus === 'cancelled' ? (cancelled_at || todayYmd) : (cancelled_at || null);
      resolveCompanyRegistryReference({ company_id, company_no, company_name, client_name }, async (companyErr, companyRecord) => {
        if (companyErr) return res.status(400).json({ error: companyErr.message });
        if (!companyRecord) return res.status(400).json({ error: 'Company is required' });

        const resolvedCompanyId = Number(companyRecord.id || 0) || null;
        const resolvedCompanyNo = String(companyRecord.company_no || '').trim() || null;
        const resolvedCompanyName = String(companyRecord.company_name || '').trim() || null;
        let resolvedBusinessEntityId = null;
        try {
          resolvedBusinessEntityId = await resolveBusinessEntityId(business_entity_id);
        } catch (entityErr) {
          return res.status(400).json({ error: entityErr.message || 'Selected operating company was not found.' });
        }

        let duplicateProject = null;
        try {
          duplicateProject = await findProjectDuplicateByIdentity({
            businessEntityId: resolvedBusinessEntityId,
            companyId: resolvedCompanyId,
            projectName: project_name,
            plannedStartDate: resolvedPlannedStart,
            plannedEndDate: resolvedPlannedEnd,
            excludeProjectId: req.params.id
          });
        } catch (dupErr) {
          return res.status(500).json({ error: dupErr.message || 'Unable to check duplicate project.' });
        }
        if (duplicateProject) {
          return sendProjectDuplicateResponse(res, duplicateProject);
        }

        const ensureDocnoAndUpdate = (resolvedProjectDocno) => {
          const projectArInvoiceNo = resolvedProjectDocno ? getProjectInvoiceNumber(resolvedProjectDocno) : null;
          const projectApBillNo = resolvedProjectDocno ? getProjectBillNumber(resolvedProjectDocno) : null;
          db.query(
            `UPDATE projects
             SET project_docno = ?, project_name = ?, business_entity_id = ?, company_id = ?, source_docno = COALESCE(?, source_docno), company_no = ?, company_name = ?, client_name = ?,
                 project_ar_invoice_no = ?, project_ap_bill_no = ?,
                 description = ?, checkno = ?, pono = ?, downpayment = ?,
                 project_members = ?, member_role = ?, member_phone = ?,
                 project_members_2 = ?, member_role_2 = ?, member_phone_2 = ?,
                 project_members_3 = ?, member_role_3 = ?, member_phone_3 = ?,
                 start_date = ?, end_date = ?, planned_start_date = ?, planned_end_date = ?,
                 actual_start_date = ?, actual_end_date = ?,
                 status_reason = COALESCE(?, status_reason), paused_at = ?, cancelled_at = ?,
                 project_manager = ?, pdfFilename = ?, budget = ?, qty = ?, unit_cost = ?, members = ?,
                 assigned_to = ?,
                 status = COALESCE(?, status), priority = COALESCE(?, priority),
                 approved_by = COALESCE(?, approved_by), approved_at = COALESCE(?, approved_at),
                 service_type = ?, estimated_material_cost = ?, estimated_labor_cost = ?, estimated_other_cost = ?, project_location = ?,
                 is_archived = FALSE, archived_at = NULL, archived_auto = FALSE
             WHERE id = ?`,
            [
              resolvedProjectDocno || null,
              project_name,
              resolvedBusinessEntityId,
              resolvedCompanyId,
              source_docno || null,
              resolvedCompanyNo,
              resolvedCompanyName,
              resolvedCompanyName,
              projectArInvoiceNo,
              projectApBillNo,
              description || null,
              checkno || null,
              pono || null,
              resolvedDownpayment,
              project_members || null,
              member_role || null,
              normalizedMemberPhone || null,
              project_members_2 || null,
              member_role_2 || null,
              normalizedMemberPhone2 || null,
              project_members_3 || null,
              member_role_3 || null,
              normalizedMemberPhone3 || null,
              start_date,
              end_date,
              resolvedPlannedStart,
              resolvedPlannedEnd,
              actual_start_date || null,
              actual_end_date || null,
              status_reason || null,
              resolvedPausedAt,
              resolvedCancelledAt,
              project_manager || null,
              finalPdfFilename,
              resolvedBudget,
              resolvedQty,
              resolvedUnitCost,
              members || projectMembersSummary,
              resolvedAssignedTo,
              resolvedProjectStatus,
              resolvedProjectPriority,
              newlyApprovedBy,
              newlyApprovedBy ? new Date() : null,
              resolvedServiceType,
              resolvedEstMaterial,
              resolvedEstLabor,
              resolvedEstOther,
              resolvedProjectLocation,
              req.params.id
            ],
            (err, result) => {
              if (err) {
                if (isPostgresUniqueViolation(err)) {
                  return res.status(409).json({ error: 'Project No. already exists.' });
                }
                return res.status(500).json({ error: err.message });
              }
              if (result.affectedRows === 0) return res.status(404).json({ error: 'Project not found' });
              const projectForSync = {
                id: Number(req.params.id),
                project_docno: resolvedProjectDocno || finalProjectDocno || finalDraftDocno,
                business_entity_id: resolvedBusinessEntityId,
                company_id: resolvedCompanyId,
                company_no: resolvedCompanyNo,
                company_name: resolvedCompanyName,
                project_name,
                client_name: resolvedCompanyName,
                description,
                budget: resolvedBudget,
                downpayment: resolvedDownpayment,
                start_date,
                end_date,
                planned_start_date: resolvedPlannedStart,
                planned_end_date: resolvedPlannedEnd
              };
              ensureCompanyRegistryForProject(projectForSync, (registryErr) => {
                if (registryErr) {
                  console.error('Company registry sync warning:', registryErr);
                }

                const respond = (taskErr, created) => {
                  if (taskErr) {
                    console.error('Default task ensure failed:', taskErr);
                  }
                  const projectChanges = auditDiff(
                    { project_name: rows[0].project_name, status: rows[0].status, budget: rows[0].budget, downpayment: rows[0].downpayment, qty: rows[0].qty, unit_cost: rows[0].unit_cost, assigned_to: rows[0].assigned_to, project_manager: rows[0].project_manager },
                    { project_name, status: resolvedProjectStatus, budget: resolvedBudget, downpayment: resolvedDownpayment, qty: resolvedQty, unit_cost: resolvedUnitCost, assigned_to: resolvedAssignedTo, project_manager: project_manager || null }
                  );
                  logAction(req, 'UPDATE_PROJECT', `Project No: ${resolvedProjectDocno || finalProjectDocno || finalDraftDocno} | Company ID: ${resolvedCompanyId} | Company No: ${resolvedCompanyNo} | Company Name: ${resolvedCompanyName}`, 'projects', { entityType: 'project', entityId: Number(req.params.id), businessEntityId: resolvedBusinessEntityId, changes: projectChanges });
                  if (currentProjectStatus !== 'submitted' && resolvedProjectStatus === 'submitted') {
                    sendBackgroundNotification(() => notifyProjectApprovalRequest(req, Number(req.params.id)), 'project approval request email');
                  }
                  res.json({
                    success: true,
                    defaultTasksCreated: !taskErr && !!created,
                    project_docno: resolvedProjectDocno || null,
                    draft_docno: finalDraftDocno || null,
                    status: resolvedProjectStatus,
                    requiresApproval: resolvedProjectStatus === 'submitted',
                    approved_by: newlyApprovedBy || undefined,
                    receivableSynced: false
                  });
                };

                const finalizeProjectSave = async () => {

                  if (createDefaultTask) {
                    ensureDefaultProjectTasks(req.params.id, start_date, end_date, respond);
                  } else {
                    respond(null, false);
                  }
                };

                finalizeProjectSave().catch((finalizeErr) => {
                  console.error('Project save finalization error:', finalizeErr);
                  res.status(500).json({ error: finalizeErr.message || 'Unable to finalize project save.' });
                });
              });
            }
          );
        };

        const needsOfficialDocno = !['draft', 'submitted'].includes(resolvedProjectStatus);
        if (finalProjectDocno || !needsOfficialDocno) return ensureDocnoAndUpdate(finalProjectDocno || null);

        generateNextProjectDocno((docErr, nextProjectDocno) => {
          if (docErr) return res.status(500).json({ error: docErr.message });
          ensureDocnoAndUpdate(nextProjectDocno);
        }, resolvedBusinessEntityId);
      });
    });
  });

  return router;
};
