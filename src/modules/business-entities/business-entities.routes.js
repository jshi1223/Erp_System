// Business Entities (operating companies) routes.
// Extracted from server.js (step 4 — first route module — see src/ARCHITECTURE.md).
// Shared infra is imported directly; server-specific helpers are injected by server.js
// until they too are extracted.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { queryAsync, isPostgresUniqueViolation } = require('../../database');
const { protectAdmin, protectSuperAdmin } = require('../../middleware/auth');
const { normalizePhone, normalizeTin, formatTin, isValidEmail, isValidPhone } = require('../../shared/validation');

// Accept only a 6-digit hex color (e.g. #7a1f1f); anything else → null (no brand color).
const normalizeHexColor = (value) => {
  const s = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
};

module.exports = function createBusinessEntitiesRouter(deps) {
  const { generateCode, generateNextVendorNo, findVendorDuplicate, logoUpload, LOGO_UPLOAD_DIR, logAction } = deps;
  const router = express.Router();

  router.get('/api/business-entities', protectAdmin, async (req, res) => {
    try {
      const includeInactive = String(req.query.include_inactive || '0') === '1';
      const whereClause = includeInactive ? '' : "WHERE status = 'active'";
      const rows = await queryAsync(`
        SELECT *
        FROM business_entities
        ${whereClause}
        ORDER BY is_default DESC, company_name ASC
      `);
      res.json(rows);
    } catch (err) {
      console.error('Business entities load error:', err);
      res.status(500).json({ error: err.message || 'Unable to load operating companies.' });
    }
  });

  router.get('/api/public-business-entities', async (req, res) => {
    try {
      const rows = await queryAsync(`
        SELECT id, entity_code, company_name, is_default
        FROM business_entities
        WHERE status = 'active'
        ORDER BY is_default DESC, company_name ASC
      `);
      res.json(rows);
    } catch (err) {
      console.error('Public business entities load error:', err);
      res.status(500).json({ error: 'Unable to load workspaces.' });
    }
  });

  router.post('/api/business-entities/:id/vendor-profile', protectSuperAdmin, async (req, res) => {
    const businessEntityId = Number(req.params.id || 0);
    if (!businessEntityId) return res.status(400).json({ error: 'Invalid business entity id.' });

    try {
      const entityRows = await queryAsync(
        `SELECT id, entity_code, company_name, address, contact_person, phone, email, tin, status
         FROM business_entities
         WHERE id = ?
         LIMIT 1`,
        [businessEntityId]
      );

      if (!entityRows.length) {
        return res.status(404).json({ error: 'Business entity not found.' });
      }

      const entity = entityRows[0];
      if (String(entity.status || 'active').toLowerCase() === 'inactive') {
        return res.status(400).json({ error: 'Activate the business entity before creating its vendor profile.' });
      }

      const existingRows = await queryAsync(
        'SELECT id, vendor_no, vendor_name, COALESCE(is_active, TRUE) AS is_active FROM vendors WHERE business_entity_id = ? LIMIT 1',
        [businessEntityId]
      );

      if (existingRows.length) {
        return res.json({
          id: existingRows[0].id,
          vendor_no: existingRows[0].vendor_no,
          vendor_name: existingRows[0].vendor_name,
          business_entity_id: businessEntityId,
          already_exists: true,
          is_active: Number(existingRows[0].is_active || 0) ? 1 : 0
        });
      }

      const vendorName = String(entity.company_name || '').trim();
      const vendorContact = String(entity.contact_person || '').trim() || null;
      const vendorEmail = String(entity.email || '').trim() || null;
      const vendorPhone = normalizePhone(entity.phone) || null;
      const vendorAddress = String(entity.address || '').trim() || null;
      const vendorTinDigits = normalizeTin(entity.tin);
      const vendorTinFormatted = vendorTinDigits ? formatTin(vendorTinDigits) : null;

      if (!vendorName) return res.status(400).json({ error: 'Business title is required before creating a vendor profile.' });
      if (vendorEmail && !isValidEmail(vendorEmail)) {
        return res.status(400).json({ error: 'Business entity email must be valid before creating a vendor profile.' });
      }
      if (vendorPhone && !isValidPhone(vendorPhone)) {
        return res.status(400).json({ error: 'Business entity phone number must be digits only, 7 to 15 digits.' });
      }
      if (vendorTinDigits && vendorTinDigits.length !== 12) {
        return res.status(400).json({ error: 'Business entity TIN must follow 000-000-000-000 format.' });
      }

      const duplicate = await new Promise((resolve, reject) => {
        findVendorDuplicate(vendorPhone, vendorTinFormatted, vendorEmail, 0, (dupErr, row) => {
          if (dupErr) reject(dupErr);
          else resolve(row || null);
        });
      });

      if (duplicate) {
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
        'INSERT INTO vendors (business_entity_id, vendor_no, vendor_name, contact_person, email, phone, address, tin, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)',
        [businessEntityId, vendorNo, vendorName, vendorContact, vendorEmail, vendorPhone, vendorAddress, vendorTinFormatted]
      );

      logAction(req, 'CREATE_VENDOR', `Vendor No: ${vendorNo} | Business Entity ID: ${businessEntityId} | Entity Code: ${entity.entity_code || ''} | Business Title: ${vendorName} | Created vendor profile from business entity.`);

      res.json({
        id: result.insertId,
        business_entity_id: businessEntityId,
        vendor_no: vendorNo,
        vendor_name: vendorName,
        already_exists: false,
        is_active: 1
      });
    } catch (err) {
      console.error('Create vendor from business entity error:', err);
      return res.status(500).json({ error: err.message || 'Unable to create vendor profile.' });
    }
  });

  router.post('/api/business-entities', protectSuperAdmin, async (req, res) => {
    try {
      const entityCode = String(req.body.entity_code || '').trim() || generateCode('ENT');
      const companyName = String(req.body.company_name || '').trim();
      const isDefault = Number(req.body.is_default || 0) ? 1 : 0;
      if (!companyName) return res.status(400).json({ error: 'Company name is required.' });

      if (isDefault) {
        await queryAsync('UPDATE business_entities SET is_default = FALSE');
      }

      const result = await queryAsync(
        `INSERT INTO business_entities
          (entity_code, company_name, address, contact_person, phone, email, tin, status, is_default, brand_color)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entityCode,
          companyName,
          req.body.address || null,
          req.body.contact_person || null,
          normalizePhone(req.body.phone) || null,
          req.body.email || null,
          normalizeTin(req.body.tin) || null,
          String(req.body.status || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
          isDefault,
          normalizeHexColor(req.body.brand_color)
        ]
      );
      res.json({ id: result.insertId, entity_code: entityCode });
    } catch (err) {
      if (isPostgresUniqueViolation(err)) {
        return res.status(409).json({ error: 'Operating company already exists.' });
      }
      console.error('Create business entity error:', err);
      res.status(500).json({ error: err.message || 'Unable to save operating company.' });
    }
  });

  router.put('/api/business-entities/:id', protectSuperAdmin, async (req, res) => {
    const businessEntityId = Number(req.params.id || 0);
    if (!businessEntityId) return res.status(400).json({ error: 'Invalid business entity id.' });

    try {
      const entityCode = String(req.body.entity_code || '').trim() || generateCode('ENT');
      const companyName = String(req.body.company_name || '').trim();
      const isDefault = Number(req.body.is_default || 0) ? 1 : 0;
      if (!companyName) return res.status(400).json({ error: 'Company name is required.' });

      if (isDefault) {
        await queryAsync('UPDATE business_entities SET is_default = FALSE WHERE id <> ?', [businessEntityId]);
      }

      const result = await queryAsync(
        `UPDATE business_entities
         SET entity_code = ?, company_name = ?, address = ?, contact_person = ?, phone = ?, email = ?, tin = ?, status = ?, is_default = ?, brand_color = ?
         WHERE id = ?`,
        [
          entityCode,
          companyName,
          req.body.address || null,
          req.body.contact_person || null,
          normalizePhone(req.body.phone) || null,
          req.body.email || null,
          normalizeTin(req.body.tin) || null,
          String(req.body.status || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
          isDefault,
          normalizeHexColor(req.body.brand_color),
          businessEntityId
        ]
      );

      if (!result.affectedRows) {
        return res.status(404).json({ error: 'Business entity not found.' });
      }

      await queryAsync(
        `UPDATE vendors
         SET vendor_name = ?, contact_person = ?, email = ?, phone = ?, address = ?, tin = ?
         WHERE business_entity_id = ?`,
        [
          companyName,
          req.body.contact_person || null,
          req.body.email || null,
          normalizePhone(req.body.phone) || null,
          req.body.address || null,
          normalizeTin(req.body.tin) ? formatTin(req.body.tin) : null,
          businessEntityId
        ]
      );

      res.json({ success: true, id: businessEntityId, entity_code: entityCode });
    } catch (err) {
      if (isPostgresUniqueViolation(err)) {
        return res.status(409).json({ error: 'Operating company already exists.' });
      }
      console.error('Update business entity error:', err);
      res.status(500).json({ error: err.message || 'Unable to update operating company.' });
    }
  });

  router.post('/api/business-entities/:id/logo', protectSuperAdmin, (req, res) => {
    logoUpload.single('logo')(req, res, async (uploadErr) => {
      if (uploadErr) {
        return res.status(400).json({ error: uploadErr.message || 'Unable to upload logo.' });
      }
      const businessEntityId = Number(req.params.id || 0);
      const cleanupTempFile = () => {
        if (req.file && req.file.path) {
          fs.unlink(req.file.path, () => {});
        }
      };
      if (!businessEntityId) {
        cleanupTempFile();
        return res.status(400).json({ error: 'Invalid business entity id.' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No logo image received.' });
      }
      try {
        const rows = await queryAsync(
          'SELECT id, entity_code, company_name, logo_path FROM business_entities WHERE id = ? LIMIT 1',
          [businessEntityId]
        );
        if (!rows.length) {
          cleanupTempFile();
          return res.status(404).json({ error: 'Business entity not found.' });
        }
        const publicPath = `/uploads/entity-logos/${req.file.filename}`;
        const previousPath = String(rows[0].logo_path || '');
        await queryAsync('UPDATE business_entities SET logo_path = ? WHERE id = ?', [publicPath, businessEntityId]);
        if (previousPath.startsWith('/uploads/entity-logos/')) {
          fs.unlink(path.join(LOGO_UPLOAD_DIR, path.basename(previousPath)), () => {});
        }
        logAction(req, 'UPDATE_BUSINESS_ENTITY_LOGO', `Business Entity ID: ${businessEntityId} | Code: ${rows[0].entity_code || ''} | Title: ${rows[0].company_name || ''} | Uploaded company logo.`);
        res.json({ status: 'success', logo_path: publicPath });
      } catch (err) {
        cleanupTempFile();
        console.error('Business entity logo upload error:', err);
        res.status(500).json({ error: err.message || 'Unable to save company logo.' });
      }
    });
  });

  router.delete('/api/business-entities/:id/logo', protectSuperAdmin, async (req, res) => {
    const businessEntityId = Number(req.params.id || 0);
    if (!businessEntityId) return res.status(400).json({ error: 'Invalid business entity id.' });
    try {
      const rows = await queryAsync(
        'SELECT id, entity_code, company_name, logo_path FROM business_entities WHERE id = ? LIMIT 1',
        [businessEntityId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Business entity not found.' });
      const previousPath = String(rows[0].logo_path || '');
      await queryAsync('UPDATE business_entities SET logo_path = NULL WHERE id = ?', [businessEntityId]);
      if (previousPath.startsWith('/uploads/entity-logos/')) {
        fs.unlink(path.join(LOGO_UPLOAD_DIR, path.basename(previousPath)), () => {});
      }
      logAction(req, 'DELETE_BUSINESS_ENTITY_LOGO', `Business Entity ID: ${businessEntityId} | Code: ${rows[0].entity_code || ''} | Removed company logo.`);
      res.json({ status: 'success' });
    } catch (err) {
      console.error('Business entity logo delete error:', err);
      res.status(500).json({ error: err.message || 'Unable to remove company logo.' });
    }
  });

  return router;
};
