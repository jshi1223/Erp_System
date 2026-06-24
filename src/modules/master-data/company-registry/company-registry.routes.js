// Company Registry (master-data) routes.
// Extracted from server.js (step 6 — see src/ARCHITECTURE.md). Core CRUD first
// (list, create, update, archive, restore); history/overview/vendor-profile and the
// company-registry-requests workflow are appended in later steps. Shared infra imported;
// server-specific helpers (findCompanyRegistryDuplicate, generateNextCompanyNo, logAction) injected.
const express = require('express');
const { db, queryAsync, isPostgresUniqueViolation } = require('../../../database');
const { protectAdmin, protectAdminOnly, getAuthenticatedUser, isAdminRole } = require('../../../middleware/auth');
const { normalizePhone, normalizeTin, formatTin, isValidCompanyRegistryPhone, isValidEmail, isValidPhone } = require('../../../shared/validation');

module.exports = function createCompanyRegistryRouter(deps) {
  const {
    findCompanyRegistryDuplicate,
    generateNextCompanyNo,
    findVendorDuplicate,
    generateNextVendorNo,
    logAction
  } = deps;
  const router = express.Router();

  router.get('/api/company-registry/next-no', protectAdmin, (req, res) => {
    generateNextCompanyNo((err, companyNo) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ company_no: companyNo });
    });
  });

  router.get('/api/company-registry', protectAdmin, async (req, res) => {
    try {
      const includeArchived = String(req.query.include_archived || '0') === '1';
      const clauses = [];
      const params = [];
      if (!includeArchived) clauses.push('COALESCE(c.archived, FALSE) = FALSE');
      const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = await queryAsync(`
        SELECT
          c.*,
          v.id AS vendor_profile_id,
          v.vendor_no AS vendor_profile_no,
          v.vendor_name AS vendor_profile_name,
          COALESCE(v.is_active, TRUE) AS vendor_profile_active
        FROM company_registry c
        LEFT JOIN vendors v ON v.id = (
          SELECT v2.id
          FROM vendors v2
          WHERE v2.company_id = c.id
          ORDER BY v2.id ASC
          LIMIT 1
        )
        ${whereClause}
        ORDER BY c.company_name ASC
      `, params);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/api/company-registry', protectAdmin, async (req, res) => {
    try {
      const {
        company_name,
        branch_code,
        address,
        contact_person,
        phone,
        email,
        tin,
        industry,
        status,
        notes
      } = req.body;
      const companyName = String(company_name || '').trim();
      let companyNo = String(req.body.company_no || '').trim();
      const companyBranchCode = String(branch_code || '').trim().slice(0, 10);
      const companyTin = String(tin || '').trim();
      const companyPhone = normalizePhone(phone);
      const companyTinDigits = normalizeTin(companyTin);
      const companyTinFormatted = formatTin(companyTinDigits);
      const companyBranchValue = companyBranchCode || '000';
      const businessEntityId = null;

      if (!companyName) return res.status(400).json({ error: 'Company name is required' });
      if (!isValidCompanyRegistryPhone(companyPhone)) {
        return res.status(400).json({ error: 'Company phone number must be exactly 11 digits and numbers only.', field: 'phone' });
      }
      if (companyTinDigits.length !== 12) {
        return res.status(400).json({ error: 'TIN must follow 000-000-000-000 format.', field: 'tin' });
      }

      findCompanyRegistryDuplicate(companyName, companyPhone, companyTin, 0, businessEntityId, (dupErr, duplicate) => {
        if (dupErr) return res.status(500).json({ error: dupErr.message });
        if (duplicate) {
          return res.status(409).json({
            error: duplicate.field === 'tin'
              ? 'TIN already exists in Company Registry.'
              : duplicate.field === 'phone'
                ? 'Company phone already exists in Company Registry.'
              : 'Company name already exists in Company Registry.',
            field: duplicate.field
          });
        }

        const insertCompany = (resolvedCompanyNo) => {
          companyNo = resolvedCompanyNo;

          db.query(
            `INSERT INTO company_registry
              (company_no, business_entity_id, branch_code, company_name, address, contact_person, phone, email, tin, industry, status, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              companyNo,
              businessEntityId,
              companyBranchValue,
              companyName,
              address || null,
              contact_person || null,
              companyPhone || null,
              email || null,
              companyTinFormatted || null,
              industry || null,
              status || 'active',
              notes || null
            ],
            (err, result) => {
              if (err) {
                if (isPostgresUniqueViolation(err)) {
                  return res.status(409).json({ error: 'Company name already exists in Company Registry.', field: 'company_name' });
                }
                return res.status(500).json({ error: err.message });
              }
              logAction(req, 'CREATE_COMPANY', `Company ID: ${result.insertId} | Company No: ${companyNo} | Company Name: ${companyName} | Created company record.`);
              res.json({ id: result.insertId, company_no: companyNo, business_entity_id: businessEntityId });
            });
        };

        if (companyNo) {
          insertCompany(companyNo);
          return;
        }

        generateNextCompanyNo((noErr, nextCompanyNo) => {
          if (noErr) return res.status(500).json({ error: noErr.message });
          insertCompany(nextCompanyNo);
        });
      });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Unable to save company.' });
    }
  });

  router.put('/api/company-registry/:id', protectAdmin, async (req, res) => {
    try {
      const companyId = Number(req.params.id);
      const {
        company_name,
        branch_code,
        address,
        status,
        contact_person,
        phone,
        email,
        tin,
        industry,
        notes
      } = req.body;
      const companyName = String(company_name || '').trim();
      const companyBranchCode = String(branch_code || '').trim().slice(0, 10);
      const companyTin = String(tin || '').trim();
      const companyPhone = normalizePhone(phone);
      const companyTinDigits = normalizeTin(companyTin);
      const companyTinFormatted = formatTin(companyTinDigits);
      const companyBranchValue = companyBranchCode || '000';
      const businessEntityId = null;

      if (!companyId) {
        return res.status(400).json({ error: 'Invalid company id' });
      }

      if (!companyName) {
        return res.status(400).json({ error: 'Company name is required' });
      }

      if (!isValidCompanyRegistryPhone(companyPhone)) {
        return res.status(400).json({ error: 'Company phone number must be exactly 11 digits and numbers only.', field: 'phone' });
      }
      if (companyTinDigits.length !== 12) {
        return res.status(400).json({ error: 'TIN must follow 000-000-000-000 format.', field: 'tin' });
      }

      findCompanyRegistryDuplicate(companyName, companyPhone, companyTin, companyId, businessEntityId, (dupErr, duplicate) => {
        if (dupErr) return res.status(500).json({ error: dupErr.message });
        if (duplicate) {
          return res.status(409).json({
            error: duplicate.field === 'tin'
              ? 'TIN already exists in Company Registry.'
              : duplicate.field === 'phone'
                ? 'Company phone already exists in Company Registry.'
              : 'Company name already exists in Company Registry.',
            field: duplicate.field
          });
        }

        db.query(
          `UPDATE company_registry
           SET business_entity_id = ?, branch_code = ?, company_name = ?, address = ?, status = COALESCE(?, status), contact_person = ?, phone = ?, email = ?, tin = ?, industry = ?, notes = ?
           WHERE id = ?`,
          [
            businessEntityId,
            companyBranchValue,
            companyName,
            address || null,
            status || null,
            contact_person || null,
            companyPhone || null,
            email || null,
            companyTinFormatted || null,
            industry || null,
            notes || null,
            companyId
          ],
          (err, result) => {
            if (err) {
              if (isPostgresUniqueViolation(err)) {
                return res.status(409).json({ error: 'Company name already exists in Company Registry.', field: 'company_name' });
              }
              return res.status(500).json({ error: err.message });
            }
            if (result.affectedRows === 0) return res.status(404).json({ error: 'Company not found' });
            logAction(req, 'UPDATE_COMPANY', `Company ID: ${companyId} | Company Name: ${companyName} | Updated company record.`);
            res.json({ success: true, business_entity_id: businessEntityId });
          }
        );
      });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Unable to update company.' });
    }
  });

  router.put('/api/company-registry/:id/archive', protectAdminOnly, (req, res) => {
    const companyId = Number(req.params.id);
    if (!companyId) return res.status(400).json({ error: 'Invalid company id' });

    db.query(
      'UPDATE company_registry SET archived = TRUE, archived_at = CURRENT_TIMESTAMP WHERE id = ?',
      [companyId],
      (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Company not found' });
        logAction(req, 'ARCHIVE_COMPANY', `Company ID: ${companyId} | Archived company record.`);
        res.json({ success: true });
      }
    );
  });

  router.put('/api/company-registry/:id/restore', protectAdminOnly, (req, res) => {
    const companyId = Number(req.params.id);
    if (!companyId) return res.status(400).json({ error: 'Invalid company id' });

    db.query(
      'UPDATE company_registry SET archived = FALSE, archived_at = NULL WHERE id = ?',
      [companyId],
      (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Company not found' });
        logAction(req, 'RESTORE_COMPANY', `Company ID: ${companyId} | Restored company record.`);
        res.json({ success: true });
      }
    );
  });

  router.get('/api/company-registry/:id/history', protectAdmin, (req, res) => {
    const companyId = Number(req.params.id || 0);
    if (!companyId) return res.status(400).json({ error: 'Invalid company id' });

    db.query(
      'SELECT company_no, company_name FROM company_registry WHERE id = ? LIMIT 1',
      [companyId],
      (lookupErr, rows) => {
        if (lookupErr) return res.status(500).json({ error: lookupErr.message });
        if (!rows || !rows.length) return res.status(404).json({ error: 'Company not found' });

        const companyNo = String(rows[0].company_no || '').trim();
        const companyName = String(rows[0].company_name || '').trim();
        const patterns = [`%Company ID: ${companyId}%`];
        if (companyNo) patterns.push(`%Company No: ${companyNo}%`);
        if (companyName) patterns.push(`%Company Name: ${companyName}%`);

        db.query(
          `SELECT l.id, l.action, l.details, l.created_at, u.fullname, u.username
           FROM system_logs l
           LEFT JOIN users u ON u.id = l.user_id
           WHERE ${patterns.map(() => 'l.details LIKE ?').join(' OR ')}
           ORDER BY l.created_at DESC, l.id DESC
           LIMIT 20`,
          patterns,
          (err, logRows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(Array.isArray(logRows) ? logRows : []);
          }
        );
      }
    );
  });

  router.get('/api/company-registry/:id/overview', protectAdmin, async (req, res) => {
    const companyId = Number(req.params.id || 0);
    if (!companyId) return res.status(400).json({ error: 'Invalid company id' });

    try {
      const actor = getAuthenticatedUser(req) || {};
      const hideDraftRecords = isAdminRole(actor.role);
      const projectVisibleCondition = hideDraftRecords ? " AND LOWER(COALESCE(status, '')) NOT IN ('draft', 'needs_revision')" : '';
      const purchaseOrderVisibleCondition = hideDraftRecords ? " AND LOWER(COALESCE(status, 'draft')) <> 'draft'" : '';
      const [companyRows, countRows, recentProjects, vendorRows] = await Promise.all([
        queryAsync(
          'SELECT id, company_no, company_name, status, archived, contact_person, phone, email, tin, industry FROM company_registry WHERE id = ? LIMIT 1',
          [companyId]
        ),
        queryAsync(`
          SELECT
            (SELECT COUNT(*) FROM projects WHERE company_id = ?${projectVisibleCondition}) AS project_count,
            (SELECT COUNT(*) FROM projects WHERE company_id = ? AND COALESCE(is_archived, FALSE) = FALSE AND status NOT IN ('completed', 'cancelled')${projectVisibleCondition}) AS active_project_count,
            (SELECT COUNT(*) FROM projects WHERE company_id = ? AND status = 'completed'${projectVisibleCondition}) AS completed_project_count,
            (SELECT COUNT(*) FROM purchase_orders WHERE company_id = ?${purchaseOrderVisibleCondition}) AS purchase_order_count,
            (SELECT COUNT(*) FROM vendors WHERE company_id = ?) AS vendor_count,
            (SELECT COUNT(*) FROM accounts_receivable ar JOIN projects p ON p.id = ar.project_id WHERE p.company_id = ? AND COALESCE(ar.archived, FALSE) = FALSE) AS receivable_count
        `, [companyId, companyId, companyId, companyId, companyId, companyId]),
        queryAsync(`
          SELECT
            id,
            project_docno,
            project_name,
            status,
            planned_start_date,
            planned_end_date,
            actual_start_date,
            actual_end_date,
            created_at
          FROM projects
          WHERE company_id = ?${projectVisibleCondition}
          ORDER BY COALESCE(actual_start_date, planned_start_date, start_date, created_at) DESC, id DESC
          LIMIT 5
        `, [companyId]),
        queryAsync(
          'SELECT id, vendor_no, vendor_name, COALESCE(is_active, TRUE) AS is_active FROM vendors WHERE company_id = ? ORDER BY id ASC LIMIT 1',
          [companyId]
        )
      ]);

      if (!companyRows.length) {
        return res.status(404).json({ error: 'Company not found' });
      }

      const counts = countRows[0] || {};
      res.json({
        company: companyRows[0],
        counts: {
          project_count: Number(counts.project_count || 0),
          active_project_count: Number(counts.active_project_count || 0),
          completed_project_count: Number(counts.completed_project_count || 0),
          purchase_order_count: Number(counts.purchase_order_count || 0),
          vendor_count: Number(counts.vendor_count || 0),
          receivable_count: Number(counts.receivable_count || 0)
        },
        vendor_profile: vendorRows[0] || null,
        recent_projects: Array.isArray(recentProjects) ? recentProjects : []
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Unable to load company overview.' });
    }
  });

  router.post('/api/company-registry/:id/vendor-profile', protectAdmin, async (req, res) => {
    const companyId = Number(req.params.id || 0);
    if (!companyId) return res.status(400).json({ error: 'Invalid company id.' });

    try {
      const companyRows = await queryAsync(
        `SELECT id, company_no, company_name, contact_person, email, phone, address, tin, archived
         FROM company_registry
         WHERE id = ?
         LIMIT 1`,
        [companyId]
      );

      if (!companyRows.length) {
        return res.status(404).json({ error: 'Company not found.' });
      }

      const company = companyRows[0];
      if (Number(company.archived || 0) === 1) {
        return res.status(400).json({ error: 'Restore the company before creating its vendor profile.' });
      }

      const existingRows = await queryAsync(
        'SELECT id, vendor_no, vendor_name, COALESCE(is_active, TRUE) AS is_active FROM vendors WHERE company_id = ? LIMIT 1',
        [companyId]
      );

      if (existingRows.length) {
        return res.json({
          id: existingRows[0].id,
          vendor_no: existingRows[0].vendor_no,
          vendor_name: existingRows[0].vendor_name,
          company_id: companyId,
          already_exists: true,
          is_active: Number(existingRows[0].is_active || 0) ? 1 : 0
        });
      }

      const vendorName = String(company.company_name || '').trim();
      const vendorContact = String(company.contact_person || '').trim();
      const vendorEmail = String(company.email || '').trim();
      const vendorPhone = normalizePhone(company.phone);
      const vendorAddress = String(company.address || '').trim();
      const vendorTinFormatted = formatTin(normalizeTin(company.tin));

      if (!vendorName) return res.status(400).json({ error: 'Company name is required before creating a vendor profile.' });
      if (!vendorContact) return res.status(400).json({ error: 'Contact person is required before creating a vendor profile.' });
      if (!vendorEmail || !isValidEmail(vendorEmail)) {
        return res.status(400).json({ error: 'Valid company email is required before creating a vendor profile.' });
      }
      if (!vendorPhone || !isValidPhone(vendorPhone)) {
        return res.status(400).json({ error: 'Valid company phone is required before creating a vendor profile.' });
      }
      if (!normalizeTin(vendorTinFormatted) || normalizeTin(vendorTinFormatted).length !== 12) {
        return res.status(400).json({ error: 'Valid company TIN is required before creating a vendor profile.' });
      }
      if (!vendorAddress) return res.status(400).json({ error: 'Company address is required before creating a vendor profile.' });

      const duplicate = await new Promise((resolve, reject) => {
        findVendorDuplicate(vendorPhone, vendorTinFormatted, vendorEmail, 0, (dupErr, row) => {
          if (dupErr) reject(dupErr);
          else resolve(row || null);
        });
      });

      if (duplicate) {
        const duplicateRows = await queryAsync(
          'SELECT id, company_id, vendor_no, vendor_name, COALESCE(is_active, TRUE) AS is_active FROM vendors WHERE id = ? LIMIT 1',
          [Number(duplicate.row?.id || 0)]
        );
        const duplicateVendor = duplicateRows[0] || null;
        const duplicateCompanyId = Number(duplicateVendor?.company_id || 0) || 0;

        if (duplicateVendor && (!duplicateCompanyId || duplicateCompanyId === companyId)) {
          if (!duplicateCompanyId) {
            await queryAsync('UPDATE vendors SET company_id = ? WHERE id = ?', [companyId, duplicateVendor.id]);
            logAction(req, 'LINK_VENDOR', `Vendor No: ${duplicateVendor.vendor_no || ''} | Company ID: ${companyId} | Company No: ${company.company_no || ''} | Linked existing vendor profile from company registry.`);
          }

          return res.json({
            id: duplicateVendor.id,
            company_id: companyId,
            vendor_no: duplicateVendor.vendor_no,
            vendor_name: duplicateVendor.vendor_name || vendorName,
            already_exists: true,
            linked_existing: !duplicateCompanyId,
            is_active: Number(duplicateVendor.is_active || 0) ? 1 : 0
          });
        }

        return res.status(409).json({
          error: duplicate.field === 'tin'
            ? 'TIN already exists in Vendor Directory.'
            : (duplicate.field === 'vendor_email'
              ? 'Email already exists in Vendor Directory.'
              : 'Vendor phone already exists in Vendor Directory.'),
          field: duplicate.field
        });
      }

      const vendorNo = await new Promise((resolve, reject) => {
        generateNextVendorNo((noErr, nextNo) => {
          if (noErr) reject(noErr);
          else resolve(nextNo);
        });
      });

      const result = await queryAsync(
        'INSERT INTO vendors (company_id, vendor_no, vendor_name, contact_person, email, phone, address, tin, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)',
        [companyId, vendorNo, vendorName, vendorContact, vendorEmail, vendorPhone, vendorAddress, vendorTinFormatted]
      );

      logAction(req, 'CREATE_VENDOR', `Vendor No: ${vendorNo} | Company ID: ${companyId} | Company No: ${company.company_no || ''} | Company Name: ${vendorName} | Created vendor profile from company registry.`);

      res.json({
        id: result.insertId,
        company_id: companyId,
        vendor_no: vendorNo,
        vendor_name: vendorName,
        already_exists: false,
        is_active: 1
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Unable to create vendor profile.' });
    }
  });

  return router;
};
