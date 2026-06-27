// CRM — Customer Relationship Management. Two sub-areas:
//   - Leads / pipeline  (prospects tracked through stages before they become projects/sales)
//   - Contacts          (the people at customer companies)
// Self-contained: creates its own tables on mount (CREATE TABLE IF NOT EXISTS) so no server.js
// schema wiring is needed. Business-entity scoped like the other modules. DI factory pattern —
// MUST be app.use-mounted in server.js or every /api/crm/* route 404s (see ARCHITECTURE rule).
const express = require('express');
const { queryAsync } = require('../../database');
const { protectAdmin, protectAdminOnly, getAuthenticatedUser, isStaffRole } = require('../../middleware/auth');

const LEAD_STAGES = ['new', 'qualified', 'proposal', 'won', 'lost'];
const normalizeStage = (value) => {
  const v = String(value || '').trim().toLowerCase();
  return LEAD_STAGES.includes(v) ? v : 'new';
};
const toNullableInt = (value) => {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const LEAD_PRIORITIES = ['low', 'medium', 'high'];
const normalizePriority = (value) => {
  const v = String(value || '').trim().toLowerCase();
  return LEAD_PRIORITIES.includes(v) ? v : 'medium';
};
// <input type="date"> sends 'YYYY-MM-DD' (Postgres DATE accepts it); blank → NULL.
const toNullableDate = (value) => (String(value || '').trim() || null);

// Build a before→after change set (only fields that actually differ) for the audit trail.
// Numbers compare numerically, Dates by their YYYY-MM-DD, everything else as trimmed strings.
const auditDiff = (oldRow, newVals) => {
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
    const from = oldRow ? oldRow[f] : undefined;
    if (!same(from, newVals[f])) changes.push({ field: f, from: disp(from), to: disp(newVals[f]) });
  });
  return changes;
};

module.exports = function createCrmRouter(deps) {
  const { resolveBusinessEntityId, logAction, generateNextProjectDocnoAsync, getBusinessEntitySequenceCode } = deps || {};
  const router = express.Router();

  // --- schema (idempotent) -------------------------------------------------
  (async () => {
    try {
      await queryAsync(`
        CREATE TABLE IF NOT EXISTS crm_leads (
          id SERIAL PRIMARY KEY,
          business_entity_id INTEGER,
          lead_name VARCHAR(255) NOT NULL,
          company_id INTEGER,
          company_name VARCHAR(255),
          contact_name VARCHAR(255),
          email VARCHAR(255),
          phone VARCHAR(50),
          source VARCHAR(100),
          stage VARCHAR(50) NOT NULL DEFAULT 'new',
          estimated_value NUMERIC(14,2) NOT NULL DEFAULT 0,
          owner VARCHAR(255),
          notes TEXT,
          archived BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )`);
      await queryAsync(`
        CREATE TABLE IF NOT EXISTS crm_contacts (
          id SERIAL PRIMARY KEY,
          business_entity_id INTEGER,
          contact_name VARCHAR(255) NOT NULL,
          company_id INTEGER,
          company_name VARCHAR(255),
          position VARCHAR(150),
          email VARCHAR(255),
          phone VARCHAR(50),
          notes TEXT,
          archived BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )`);
      // Links a Won lead to the Project it was converted into (prevents double-conversion).
      await queryAsync('ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS converted_project_id INTEGER').catch(() => {});
      // Staff create DRAFT leads that go draft → pending (submitted) → approved/rejected. Admins
      // create approved leads directly. Only an APPROVED lead can be converted to a project.
      await queryAsync("ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'approved'").catch(() => {});
      // Human-readable, entity-coded Lead No (e.g. LEAD-KVSK-2026-001) — matches PR/PO/Project convention.
      await queryAsync('ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS lead_docno VARCHAR(40)').catch(() => {});
      // Backfill any existing leads that predate the lead_docno column, per entity + year, ordered by id.
      await queryAsync(`
        WITH numbered AS (
          SELECT l.id,
                 COALESCE((SELECT be.entity_code FROM business_entities be WHERE be.id = l.business_entity_id), 'GEN') AS code,
                 EXTRACT(YEAR FROM COALESCE(l.created_at, NOW()))::int AS yr,
                 ROW_NUMBER() OVER (
                   PARTITION BY l.business_entity_id, EXTRACT(YEAR FROM COALESCE(l.created_at, NOW()))
                   ORDER BY l.id
                 ) AS rn
          FROM crm_leads l
          WHERE l.lead_docno IS NULL OR l.lead_docno = ''
        )
        UPDATE crm_leads t
        SET lead_docno = 'LEAD-' || n.code || '-' || n.yr || '-' || LPAD(n.rn::text, 3, '0')
        FROM numbered n
        WHERE t.id = n.id`).catch(() => {});
      // Pipeline fields: expected close + next follow-up dates, priority, and (when lost) the reason.
      await queryAsync('ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS expected_close_date DATE').catch(() => {});
      await queryAsync('ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS next_follow_up_date DATE').catch(() => {});
      await queryAsync("ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'medium'").catch(() => {});
      await queryAsync('ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS lost_reason TEXT').catch(() => {});
      console.log('✅ Table "crm_leads" / "crm_contacts" ready');
    } catch (err) {
      console.error('CRM schema init error:', err && err.message);
    }
  })();

  // Scope helper: 'all'/blank = no entity filter; otherwise WHERE business_entity_id = ?.
  const scopeClause = (req, alias = '') => {
    const raw = String(req.query.business_entity_id || '').trim().toLowerCase();
    const col = `${alias ? alias + '.' : ''}business_entity_id`;
    if (!raw || raw === 'all') return { where: '', params: [] };
    const id = Number(req.query.business_entity_id || 0) || 0;
    if (!id) return { where: '', params: [] };
    return { where: ` AND ${col} = ?`, params: [id] };
  };

  const resolveEntity = async (body) => {
    if (typeof resolveBusinessEntityId === 'function') {
      return resolveBusinessEntityId(body.business_entity_id);
    }
    return toNullableInt(body.business_entity_id);
  };

  // --- Lead No generator: LEAD-<entityCode>-<year>-<seq> (e.g. LEAD-KVSK-2026-001) ----------
  // Self-contained: entity code from business_entities, sequence from document_sequences with a
  // crm_leads MAX fallback so numbers never collide even if the sequence row lags behind.
  // Use the SAME short sequence code as PR/PO/Project (e.g. "KVSK", "KITSI") so Lead No matches.
  const leadEntityCode = async (businessEntityId) => {
    try {
      if (typeof getBusinessEntitySequenceCode === 'function') {
        const info = await getBusinessEntitySequenceCode(businessEntityId);
        return String(info?.code || '').trim() || 'ENT';
      }
      if (!businessEntityId) return 'ENT';
      const rows = await queryAsync('SELECT entity_code FROM business_entities WHERE id = ? LIMIT 1', [businessEntityId]);
      return String(rows?.[0]?.entity_code || '').trim() || 'ENT';
    } catch (_) { return 'ENT'; }
  };

  const leadDocnoState = async (businessEntityId) => {
    const code = await leadEntityCode(businessEntityId);
    const year = new Date().getFullYear();
    const prefix = `LEAD-${code}-${year}`;
    const sequenceKey = `crm-lead-docno:${businessEntityId || 'default'}`;
    const pattern = `^LEAD-${String(code).replace(/[^A-Za-z0-9]/g, '')}-${year}-[0-9]+$`;
    let tableMax = 0;
    try {
      const rows = await queryAsync(
        `SELECT COALESCE(MAX(CAST(regexp_replace(lead_docno, '^LEAD-[A-Za-z0-9]+-[0-9]{4}-', '') AS integer)), 0) AS max_no
         FROM crm_leads WHERE lead_docno ~ ?`, [pattern]);
      tableMax = Number(rows?.[0]?.max_no || 0) || 0;
    } catch (_) {}
    let sequenceMax = 0;
    try {
      const rows = await queryAsync(
        'SELECT COALESCE(last_value, 0) AS last_value FROM document_sequences WHERE sequence_key = ? AND period_key = ? LIMIT 1',
        [sequenceKey, String(year)]);
      sequenceMax = Number(rows?.[0]?.last_value || 0) || 0;
    } catch (_) {}
    return { prefix, sequenceKey, period: String(year), tableMax, sequenceMax };
  };

  const peekNextLeadDocno = async (businessEntityId) => {
    const s = await leadDocnoState(businessEntityId);
    const next = Math.max(s.tableMax, s.sequenceMax) + 1;
    return `${s.prefix}-${String(next).padStart(3, '0')}`;
  };

  const generateNextLeadDocno = async (businessEntityId) => {
    const s = await leadDocnoState(businessEntityId);
    let next = Math.max(s.tableMax, s.sequenceMax) + 1;
    try {
      const rows = await queryAsync(
        `INSERT INTO document_sequences (sequence_key, period_key, last_value)
         VALUES (?, ?, ?)
         ON CONFLICT (sequence_key, period_key)
         DO UPDATE SET last_value = GREATEST(document_sequences.last_value, ?) + 1
         RETURNING last_value`,
        [s.sequenceKey, s.period, next, s.tableMax]);
      next = Number(rows?.[0]?.last_value || next) || next;
    } catch (_) {}
    return `${s.prefix}-${String(next).padStart(3, '0')}`;
  };

  // Preview the next Lead No for a workspace (used to show it in the New Lead modal).
  router.get('/api/crm/leads/next-docno', protectAdmin, async (req, res) => {
    try {
      const businessEntityId = await resolveEntity({ business_entity_id: req.query.business_entity_id });
      res.json({ docno: await peekNextLeadDocno(businessEntityId) });
    } catch (err) {
      console.error('CRM next-docno error:', err && err.message);
      res.status(500).json({ error: 'Unable to preview lead number.' });
    }
  });

  // ======================= SUMMARY =======================
  router.get('/api/crm/summary', protectAdmin, async (req, res) => {
    try {
      const s = scopeClause(req);
      const leadRows = await queryAsync(
        `SELECT stage, COUNT(*)::int AS n, COALESCE(SUM(estimated_value), 0) AS value
         FROM crm_leads WHERE archived = FALSE${s.where} GROUP BY stage`, s.params);
      const contactRows = await queryAsync(
        `SELECT COUNT(*)::int AS n FROM crm_contacts WHERE archived = FALSE${s.where}`, s.params);
      const byStage = {};
      let openValue = 0; let totalLeads = 0;
      (leadRows || []).forEach((r) => {
        byStage[r.stage] = r.n;
        totalLeads += r.n;
        if (r.stage !== 'won' && r.stage !== 'lost') openValue += Number(r.value || 0);
      });
      res.json({
        total_leads: totalLeads,
        open_leads: totalLeads - (byStage.won || 0) - (byStage.lost || 0),
        won_leads: byStage.won || 0,
        open_value: openValue,
        contacts: contactRows?.[0]?.n || 0,
        by_stage: byStage
      });
    } catch (err) {
      console.error('CRM summary error:', err && err.message);
      res.status(500).json({ error: 'Unable to load CRM summary.' });
    }
  });

  // ======================= LEADS =======================
  router.get('/api/crm/leads', protectAdmin, async (req, res) => {
    try {
      const s = scopeClause(req, 'l');
      const includeArchived = String(req.query.include_archived || '') === '1';
      const archivedClause = includeArchived ? '' : ' AND l.archived = FALSE';
      const rows = await queryAsync(
        `SELECT l.*, be.company_name AS business_entity_name, be.entity_code AS business_entity_code,
                COALESCE(p.project_docno, p.draft_docno) AS converted_project_docno
         FROM crm_leads l
         LEFT JOIN business_entities be ON be.id = l.business_entity_id
         LEFT JOIN projects p ON p.id = l.converted_project_id
         WHERE 1=1${archivedClause}${s.where}
         ORDER BY l.updated_at DESC, l.id DESC`, s.params);
      res.json(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error('CRM leads list error:', err && err.message);
      res.status(500).json({ error: 'Unable to load leads.' });
    }
  });

  router.post('/api/crm/leads', protectAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const leadName = String(b.lead_name || '').trim();
      if (!leadName) return res.status(400).json({ error: 'Lead name is required.' });
      const businessEntityId = await resolveEntity(b);
      // Staff file DRAFT leads that need approval; admins create approved leads directly.
      const actorIsStaff = isStaffRole((getAuthenticatedUser(req) || {}).role);
      const approvalStatus = actorIsStaff ? 'draft' : 'approved';
      const leadDocno = await generateNextLeadDocno(businessEntityId);
      const stage = normalizeStage(b.stage);
      // Lost reason only makes sense for a lost lead — drop it otherwise so stale text never lingers.
      const lostReason = stage === 'lost' ? (String(b.lost_reason || '').trim() || null) : null;
      const result = await queryAsync(
        `INSERT INTO crm_leads
          (business_entity_id, lead_docno, lead_name, company_id, company_name, contact_name, email, phone, source, stage, estimated_value, owner, notes, expected_close_date, next_follow_up_date, priority, lost_reason, approval_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [businessEntityId || null, leadDocno, leadName, toNullableInt(b.company_id), String(b.company_name || '').trim() || null,
          String(b.contact_name || '').trim() || null, String(b.email || '').trim() || null,
          String(b.phone || '').trim() || null, String(b.source || '').trim() || null,
          stage, Number(b.estimated_value || 0) || 0,
          String(b.owner || '').trim() || null, String(b.notes || '').trim() || null,
          toNullableDate(b.expected_close_date), toNullableDate(b.next_follow_up_date), normalizePriority(b.priority), lostReason,
          approvalStatus]);
      const newLeadId = result?.[0]?.id || result?.insertId;
      if (typeof logAction === 'function') logAction(req, 'CREATE_CRM_LEAD', `Created lead ${leadDocno} — ${leadName}${actorIsStaff ? ' (draft)' : ''}`, 'crm', { entityType: 'crm_lead', entityId: newLeadId, businessEntityId });
      res.json({ id: newLeadId, lead_docno: leadDocno, lead_name: leadName, approval_status: approvalStatus });
    } catch (err) {
      console.error('CRM lead create error:', err && err.message);
      res.status(500).json({ error: 'Unable to save lead.' });
    }
  });

  router.put('/api/crm/leads/:id', protectAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id || 0) || 0;
      if (!id) return res.status(400).json({ error: 'Invalid lead id.' });
      const b = req.body || {};
      const leadName = String(b.lead_name || '').trim();
      if (!leadName) return res.status(400).json({ error: 'Lead name is required.' });
      const stage = normalizeStage(b.stage);
      const lostReason = stage === 'lost' ? (String(b.lost_reason || '').trim() || null) : null;
      // Snapshot the row first so the audit log can record exactly what changed (before → after).
      const oldRow = (await queryAsync('SELECT * FROM crm_leads WHERE id = ?', [id]))?.[0] || null;
      const newVals = {
        lead_name: leadName,
        company_id: toNullableInt(b.company_id),
        company_name: String(b.company_name || '').trim() || null,
        contact_name: String(b.contact_name || '').trim() || null,
        email: String(b.email || '').trim() || null,
        phone: String(b.phone || '').trim() || null,
        source: String(b.source || '').trim() || null,
        stage,
        estimated_value: Number(b.estimated_value || 0) || 0,
        owner: String(b.owner || '').trim() || null,
        notes: String(b.notes || '').trim() || null,
        expected_close_date: toNullableDate(b.expected_close_date),
        next_follow_up_date: toNullableDate(b.next_follow_up_date),
        priority: normalizePriority(b.priority),
        lost_reason: lostReason
      };
      await queryAsync(
        `UPDATE crm_leads SET lead_name = ?, company_id = ?, company_name = ?, contact_name = ?, email = ?,
           phone = ?, source = ?, stage = ?, estimated_value = ?, owner = ?, notes = ?,
           expected_close_date = ?, next_follow_up_date = ?, priority = ?, lost_reason = ?, updated_at = NOW()
         WHERE id = ?`,
        [newVals.lead_name, newVals.company_id, newVals.company_name, newVals.contact_name, newVals.email,
          newVals.phone, newVals.source, newVals.stage, newVals.estimated_value, newVals.owner, newVals.notes,
          newVals.expected_close_date, newVals.next_follow_up_date, newVals.priority, newVals.lost_reason,
          id]);
      const changes = auditDiff(oldRow, newVals);
      if (typeof logAction === 'function') logAction(req, 'UPDATE_CRM_LEAD', `Updated lead ${oldRow?.lead_docno || leadName}`, 'crm', { entityType: 'crm_lead', entityId: id, businessEntityId: oldRow?.business_entity_id, changes });
      res.json({ id, lead_name: leadName });
    } catch (err) {
      console.error('CRM lead update error:', err && err.message);
      res.status(500).json({ error: 'Unable to update lead.' });
    }
  });

  // Quick stage move (pipeline drag/select).
  router.post('/api/crm/leads/:id/stage', protectAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id || 0) || 0;
      if (!id) return res.status(400).json({ error: 'Invalid lead id.' });
      const stage = normalizeStage(req.body?.stage);
      await queryAsync('UPDATE crm_leads SET stage = ?, updated_at = NOW() WHERE id = ?', [stage, id]);
      res.json({ id, stage });
    } catch (err) {
      console.error('CRM lead stage error:', err && err.message);
      res.status(500).json({ error: 'Unable to update stage.' });
    }
  });

  // Staff submits a draft lead for approval (draft → pending).
  router.post('/api/crm/leads/:id/submit', protectAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id || 0) || 0;
      if (!id) return res.status(400).json({ error: 'Invalid lead id.' });
      await queryAsync("UPDATE crm_leads SET approval_status = 'pending', updated_at = NOW() WHERE id = ? AND approval_status IN ('draft', 'rejected')", [id]);
      if (typeof logAction === 'function') logAction(req, 'SUBMIT_CRM_LEAD', `Submitted lead #${id} for approval`);
      res.json({ id, approval_status: 'pending' });
    } catch (err) {
      console.error('CRM lead submit error:', err && err.message);
      res.status(500).json({ error: 'Unable to submit lead.' });
    }
  });

  // Admin approves a pending lead (→ approved). Only then can it be converted to a project.
  router.post('/api/crm/leads/:id/approve', protectAdminOnly, async (req, res) => {
    try {
      const id = Number(req.params.id || 0) || 0;
      if (!id) return res.status(400).json({ error: 'Invalid lead id.' });
      await queryAsync("UPDATE crm_leads SET approval_status = 'approved', updated_at = NOW() WHERE id = ?", [id]);
      if (typeof logAction === 'function') logAction(req, 'APPROVE_CRM_LEAD', `Approved lead #${id}`);
      res.json({ id, approval_status: 'approved' });
    } catch (err) {
      console.error('CRM lead approve error:', err && err.message);
      res.status(500).json({ error: 'Unable to approve lead.' });
    }
  });

  // Admin rejects a pending lead (→ rejected; staff can revise + resubmit).
  router.post('/api/crm/leads/:id/reject', protectAdminOnly, async (req, res) => {
    try {
      const id = Number(req.params.id || 0) || 0;
      if (!id) return res.status(400).json({ error: 'Invalid lead id.' });
      await queryAsync("UPDATE crm_leads SET approval_status = 'rejected', updated_at = NOW() WHERE id = ?", [id]);
      if (typeof logAction === 'function') logAction(req, 'REJECT_CRM_LEAD', `Rejected lead #${id}`);
      res.json({ id, approval_status: 'rejected' });
    } catch (err) {
      console.error('CRM lead reject error:', err && err.message);
      res.status(500).json({ error: 'Unable to reject lead.' });
    }
  });

  // Convert a (typically Won) lead into a Project — carries over company, contact, value, notes.
  // Admin-only, and only an APPROVED lead can be converted (staff drafts must be approved first).
  router.post('/api/crm/leads/:id/convert-to-project', protectAdminOnly, async (req, res) => {
    try {
      const id = Number(req.params.id || 0) || 0;
      if (!id) return res.status(400).json({ error: 'Invalid lead id.' });
      const rows = await queryAsync('SELECT * FROM crm_leads WHERE id = ? LIMIT 1', [id]);
      if (!rows.length) return res.status(404).json({ error: 'Lead not found.' });
      const lead = rows[0];
      if (Number(lead.converted_project_id || 0)) {
        return res.status(409).json({ error: 'This lead was already converted to a project.' });
      }
      if (String(lead.approval_status || 'approved').toLowerCase() !== 'approved') {
        return res.status(400).json({ error: 'Only an approved lead can be converted to a project.' });
      }
      // Entity is chosen at conversion time (admin can route the project to any workspace);
      // a blank/"all" choice falls back to the lead's own entity.
      const rawOverride = String((req.body && req.body.business_entity_id) || '').trim().toLowerCase();
      const chosenEntityInput = (rawOverride && rawOverride !== 'all')
        ? req.body.business_entity_id
        : lead.business_entity_id;
      const businessEntityId = (typeof resolveBusinessEntityId === 'function')
        ? await resolveBusinessEntityId(chosenEntityInput)
        : (Number(chosenEntityInput || 0) || null);
      const docno = (typeof generateNextProjectDocnoAsync === 'function')
        ? await generateNextProjectDocnoAsync(businessEntityId)
        : null;
      const today = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const value = Number(lead.estimated_value || 0) || 0;
      const name = String(lead.lead_name || 'Converted Lead').trim();
      const result = await queryAsync(
        `INSERT INTO projects
          (project_docno, project_name, business_entity_id, company_id, company_name, client_name,
           description, start_date, end_date, budget, unit_cost, qty, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [docno, name, businessEntityId || null, Number(lead.company_id || 0) || null,
          lead.company_name || null, lead.contact_name || null,
          lead.notes || null, today, end, value, value, 1, 'planning']);
      const projectId = (result && result[0] && result[0].id) || result.insertId;
      await queryAsync('UPDATE crm_leads SET converted_project_id = ?, stage = ?, updated_at = NOW() WHERE id = ?', [projectId, 'won', id]);
      if (typeof logAction === 'function') logAction(req, 'CONVERT_CRM_LEAD', `Converted lead ${name} to project ${docno || projectId}`);
      res.json({ ok: true, project_id: projectId, project_docno: docno });
    } catch (err) {
      console.error('CRM convert lead error:', err && err.message);
      res.status(500).json({ error: err.message || 'Unable to convert lead to project.' });
    }
  });

  router.post('/api/crm/leads/:id/archive', protectAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id || 0) || 0;
      const before = (await queryAsync('SELECT lead_docno, archived, business_entity_id FROM crm_leads WHERE id = ?', [id]))?.[0] || null;
      await queryAsync('UPDATE crm_leads SET archived = NOT archived, updated_at = NOW() WHERE id = ?', [id]);
      const nowArchived = before ? !before.archived : true;
      if (typeof logAction === 'function') logAction(req, nowArchived ? 'ARCHIVE_CRM_LEAD' : 'RESTORE_CRM_LEAD',
        `${nowArchived ? 'Archived' : 'Restored'} lead ${before?.lead_docno || ('#' + id)}`,
        'crm', { entityType: 'crm_lead', entityId: id, businessEntityId: before?.business_entity_id, severity: 'warning' });
      res.json({ id });
    } catch (err) {
      res.status(500).json({ error: 'Unable to archive lead.' });
    }
  });

  router.delete('/api/crm/leads/:id', protectAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id || 0) || 0;
      const victim = (await queryAsync('SELECT lead_docno, lead_name, business_entity_id FROM crm_leads WHERE id = ?', [id]))?.[0] || null;
      // Archive-only policy: never hard-delete — soft-archive so it lands in the Archive Center.
      await queryAsync('UPDATE crm_leads SET archived = TRUE, updated_at = NOW() WHERE id = ?', [id]);
      if (typeof logAction === 'function') logAction(req, 'ARCHIVE_CRM_LEAD',
        `Archived lead ${victim?.lead_docno || ('#' + id)}${victim?.lead_name ? ' — ' + victim.lead_name : ''}`,
        'crm', { entityType: 'crm_lead', entityId: id, businessEntityId: victim?.business_entity_id, severity: 'warning' });
      res.json({ id });
    } catch (err) {
      res.status(500).json({ error: 'Unable to delete lead.' });
    }
  });

  // ======================= CONTACTS =======================
  router.get('/api/crm/contacts', protectAdmin, async (req, res) => {
    try {
      const s = scopeClause(req, 'c');
      const rows = await queryAsync(
        `SELECT c.*, be.company_name AS business_entity_name, be.entity_code AS business_entity_code
         FROM crm_contacts c
         LEFT JOIN business_entities be ON be.id = c.business_entity_id
         WHERE c.archived = FALSE${s.where}
         ORDER BY c.contact_name ASC, c.id DESC`, s.params);
      res.json(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error('CRM contacts list error:', err && err.message);
      res.status(500).json({ error: 'Unable to load contacts.' });
    }
  });

  router.post('/api/crm/contacts', protectAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const name = String(b.contact_name || '').trim();
      if (!name) return res.status(400).json({ error: 'Contact name is required.' });
      const businessEntityId = await resolveEntity(b);
      const result = await queryAsync(
        `INSERT INTO crm_contacts (business_entity_id, contact_name, company_id, company_name, position, email, phone, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [businessEntityId || null, name, toNullableInt(b.company_id), String(b.company_name || '').trim() || null,
          String(b.position || '').trim() || null, String(b.email || '').trim() || null,
          String(b.phone || '').trim() || null, String(b.notes || '').trim() || null]);
      if (typeof logAction === 'function') logAction(req, 'CREATE_CRM_CONTACT', `Created contact ${name}`);
      res.json({ id: result?.[0]?.id || result?.insertId, contact_name: name });
    } catch (err) {
      console.error('CRM contact create error:', err && err.message);
      res.status(500).json({ error: 'Unable to save contact.' });
    }
  });

  router.put('/api/crm/contacts/:id', protectAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id || 0) || 0;
      if (!id) return res.status(400).json({ error: 'Invalid contact id.' });
      const b = req.body || {};
      const name = String(b.contact_name || '').trim();
      if (!name) return res.status(400).json({ error: 'Contact name is required.' });
      await queryAsync(
        `UPDATE crm_contacts SET contact_name = ?, company_id = ?, company_name = ?, position = ?, email = ?, phone = ?, notes = ?, updated_at = NOW()
         WHERE id = ?`,
        [name, toNullableInt(b.company_id), String(b.company_name || '').trim() || null,
          String(b.position || '').trim() || null, String(b.email || '').trim() || null,
          String(b.phone || '').trim() || null, String(b.notes || '').trim() || null, id]);
      if (typeof logAction === 'function') logAction(req, 'UPDATE_CRM_CONTACT', `Updated contact ${name}`);
      res.json({ id, contact_name: name });
    } catch (err) {
      console.error('CRM contact update error:', err && err.message);
      res.status(500).json({ error: 'Unable to update contact.' });
    }
  });

  router.delete('/api/crm/contacts/:id', protectAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id || 0) || 0;
      // Archive-only policy: never hard-delete — soft-archive so it lands in the Archive Center.
      await queryAsync('UPDATE crm_contacts SET archived = TRUE, updated_at = NOW() WHERE id = ?', [id]);
      if (typeof logAction === 'function') logAction(req, 'ARCHIVE_CRM_CONTACT', `Archived contact #${id}`, 'crm', { entityType: 'crm_contact', entityId: id, severity: 'warning' });
      res.json({ id });
    } catch (err) {
      res.status(500).json({ error: 'Unable to delete contact.' });
    }
  });

  return router;
};
