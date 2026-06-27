// Vendors (master-data) routes.
// Extracted from server.js (step 5 — see src/ARCHITECTURE.md). Shared infra imported;
// server-specific helpers (generateNextVendorNo, findVendorDuplicate, logAction) injected.
const express = require('express');
const { db, queryAsync } = require('../../../database');
const { protectAdmin } = require('../../../middleware/auth');
const { normalizePhone, normalizeTin, formatTin, isValidEmail, isValidPhone } = require('../../../shared/validation');

module.exports = function createVendorsRouter(deps) {
  const { generateNextVendorNo, findVendorDuplicate, logAction } = deps;
  const router = express.Router();

  router.get('/api/vendors', protectAdmin, (req, res) => {
    const includeInactive = String(req.query.include_inactive || '0') === '1';
    const whereClause = includeInactive ? '' : 'WHERE COALESCE(v.is_active, TRUE) = TRUE';
    db.query(`
      SELECT
        v.*,
        COALESCE(c.company_no, be.entity_code) AS company_no,
        COALESCE(c.company_name, be.company_name) AS company_name
      FROM vendors v
      LEFT JOIN company_registry c ON c.id = v.company_id
      LEFT JOIN business_entities be ON be.id = v.business_entity_id
      ${whereClause}
      ORDER BY COALESCE(v.vendor_no, '') ASC, v.vendor_name ASC
    `, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  router.get('/api/vendors/next-no', protectAdmin, (req, res) => {
    generateNextVendorNo((err, vendorNo) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ vendor_no: vendorNo });
    });
  });

  router.post('/api/vendors', protectAdmin, (req, res) => {
    const { vendor_name, contact_person, email, phone, address, tin } = req.body;
    const companyId = null;
    const vendorName = String(vendor_name || '').trim();
    const vendorContact = String(contact_person || '').trim();
    const vendorEmail = String(email || '').trim();
    const vendorPhone = normalizePhone(phone);
    const vendorAddress = String(address || '').trim();
    const vendorTinDigits = normalizeTin(tin);
    const vendorTinFormatted = formatTin(vendorTinDigits);
    if (!vendorName) return res.status(400).json({ error: 'Vendor name is required', field: 'vendor_name' });
    if (!vendorContact) return res.status(400).json({ error: 'Contact person is required', field: 'vendor_contact' });
    if (!vendorEmail) return res.status(400).json({ error: 'Email is required', field: 'vendor_email' });
    if (!isValidEmail(vendorEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.', field: 'vendor_email' });
    }
    if (!vendorPhone) return res.status(400).json({ error: 'Vendor phone is required', field: 'vendor_phone' });
    if (!isValidPhone(vendorPhone)) {
      return res.status(400).json({ error: 'Vendor phone number must be digits only, 7 to 15 digits.' });
    }
    if (!vendorTinDigits) return res.status(400).json({ error: 'TIN is required', field: 'vendor_tin' });
    if (vendorTinDigits.length !== 12) {
      return res.status(400).json({ error: 'TIN must follow 000-000-000-000 format.', field: 'tin' });
    }
    if (!vendorAddress) return res.status(400).json({ error: 'Address is required', field: 'vendor_address' });

    const createVendor = () => {
    findVendorDuplicate(vendorPhone, vendorTinFormatted, vendorEmail, 0, (dupErr, duplicate) => {
      if (dupErr) return res.status(500).json({ error: dupErr.message });
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

      generateNextVendorNo((noErr, vendorNo) => {
        if (noErr) return res.status(500).json({ error: noErr.message });

        db.query(
          'INSERT INTO vendors (company_id, vendor_no, vendor_name, contact_person, email, phone, address, tin, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)',
          [companyId, vendorNo, vendorName, vendorContact, vendorEmail, vendorPhone || null, vendorAddress, vendorTinFormatted || null],
          (err, result) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: result.insertId, company_id: null, vendor_no: vendorNo, is_active: 1 });
          }
        );
      });
    });
    };

    createVendor();
  });

  router.put('/api/vendors/:id', protectAdmin, async (req, res) => {
    const vendorId = Number(req.params.id || 0);
    if (!vendorId) return res.status(400).json({ error: 'Invalid vendor id.' });

    const { vendor_name, contact_person, email, phone, address, tin } = req.body;
    const vendorName = String(vendor_name || '').trim();
    const vendorContact = String(contact_person || '').trim();
    const vendorEmail = String(email || '').trim();
    const vendorPhone = normalizePhone(phone);
    const vendorAddress = String(address || '').trim();
    const vendorTinDigits = normalizeTin(tin);
    const vendorTinFormatted = formatTin(vendorTinDigits);

    if (!vendorName) return res.status(400).json({ error: 'Vendor name is required', field: 'vendor_name' });
    if (!vendorContact) return res.status(400).json({ error: 'Contact person is required', field: 'vendor_contact' });
    if (!vendorEmail) return res.status(400).json({ error: 'Email is required', field: 'vendor_email' });
    if (!isValidEmail(vendorEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.', field: 'vendor_email' });
    }
    if (!vendorPhone) return res.status(400).json({ error: 'Vendor phone is required', field: 'vendor_phone' });
    if (!isValidPhone(vendorPhone)) {
      return res.status(400).json({ error: 'Vendor phone number must be digits only, 7 to 15 digits.', field: 'vendor_phone' });
    }
    if (!vendorTinDigits) return res.status(400).json({ error: 'TIN is required', field: 'vendor_tin' });
    if (vendorTinDigits.length !== 12) {
      return res.status(400).json({ error: 'TIN must follow 000-000-000-000 format.', field: 'tin' });
    }
    if (!vendorAddress) return res.status(400).json({ error: 'Address is required', field: 'vendor_address' });

    try {
      const existingRows = await queryAsync(
        'SELECT id, vendor_no, company_id, COALESCE(is_active, TRUE) AS is_active FROM vendors WHERE id = ? LIMIT 1',
        [vendorId]
      );
      if (!existingRows.length) return res.status(404).json({ error: 'Vendor not found.' });

      const duplicate = await new Promise((resolve, reject) => {
        findVendorDuplicate(vendorPhone, vendorTinFormatted, vendorEmail, vendorId, (dupErr, duplicateRow) => {
          if (dupErr) reject(dupErr);
          else resolve(duplicateRow);
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

      await queryAsync(
        `UPDATE vendors
         SET vendor_name = ?, contact_person = ?, email = ?, phone = ?, address = ?, tin = ?
         WHERE id = ?`,
        [vendorName, vendorContact, vendorEmail, vendorPhone || null, vendorAddress, vendorTinFormatted || null, vendorId]
      );

      const rows = await queryAsync(
        `SELECT v.id, v.company_id, v.vendor_no, v.vendor_name, v.contact_person, v.email, v.phone, v.address, v.tin,
                COALESCE(v.is_active, TRUE) AS is_active,
                c.company_no, c.company_name
         FROM vendors v
         LEFT JOIN company_registry c ON c.id = v.company_id
         WHERE v.id = ?
         LIMIT 1`,
        [vendorId]
      );
      const vendor = rows[0] || existingRows[0];
      logAction(req, 'UPDATE_VENDOR', `Updated vendor ${vendor.vendor_no || `ID ${vendorId}`} | ${vendorName}`, 'company', { entityType: 'vendor', entityId: vendorId });
      res.json({
        id: vendorId,
        company_id: Number(vendor.company_id || 0) || null,
        company_no: vendor.company_no || '',
        company_name: vendor.company_name || '',
        vendor_no: vendor.vendor_no || '',
        is_active: Number(vendor.is_active || 0) ? 1 : 0
      });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to update vendor.' });
    }
  });

  router.patch('/api/vendors/:id/status', protectAdmin, (req, res) => {
    const vendorId = Number(req.params.id || 0);
    if (!vendorId) return res.status(400).json({ error: 'Invalid vendor id.' });

    const nextActive = String(req.body?.is_active ?? req.body?.active ?? '').trim().toLowerCase();
    const isActive = ['1', 'true', 'yes', 'on', 'active'].includes(nextActive);

    db.query(
      'SELECT id, vendor_no, vendor_name, COALESCE(is_active, TRUE) AS is_active FROM vendors WHERE id = ? LIMIT 1',
      [vendorId],
      (findErr, rows) => {
        if (findErr) return res.status(500).json({ error: findErr.message });
        if (!rows || !rows.length) return res.status(404).json({ error: 'Vendor not found.' });

        const vendor = rows[0];
        db.query(
          'UPDATE vendors SET is_active = ? WHERE id = ?',
          [isActive ? 1 : 0, vendorId],
          (updateErr) => {
            if (updateErr) return res.status(500).json({ error: updateErr.message });
            logAction(
              req,
              'TOGGLE_VENDOR_STATUS',
              `Vendor status changed: ${vendor.vendor_no || `ID ${vendor.id}`} | ${vendor.vendor_name || 'Unnamed'} => ${isActive ? 'Active' : 'Inactive'}`
            );
            res.json({
              success: true,
              id: vendorId,
              is_active: isActive ? 1 : 0,
              message: `Vendor ${isActive ? 'activated' : 'deactivated'} successfully.`
            });
          }
        );
      }
    );
  });

  return router;
};
