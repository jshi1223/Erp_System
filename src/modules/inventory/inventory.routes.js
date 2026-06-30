// Inventory — products, warehouses, stock, stock movements, serial units, and the staff
// request/approval workflow. Extracted from server.js (step 13 — see src/ARCHITECTURE.md).
// The inventory-specific helper functions (SKU/code generators, request applier, unit-status
// normalizers) remain in server.js for now because some are shared with procurement
// (insertProductWithSku, isDuplicateError) — they are injected here until that domain is extracted.
const express = require('express');
const { queryAsync } = require('../../database');
const { protectAdmin, protectAdminOnly, getAuthenticatedUser, isStaffRole, isAdminRole } = require('../../middleware/auth');

module.exports = function createInventoryRouter(deps) {
  const {
    normalizeBusinessEntityId,
    getDefaultBusinessEntityId,
    resolveBusinessEntityId,
    assertProjectAcceptsNewActivity,
    generateInventoryDraftRequestNo,
    stripDraftRequestNoPrefix,
    getApprovalActorName,
    getApprovalComment,
    appendApprovalComment,
    logAction,
    isDuplicateError,
    insertProductWithSku,
    insertWarehouseWithCode,
    PRODUCT_UNIT_STATUSES,
    normalizeUnitStatus,
    normalizeDateOrNull,
    normalizeInventoryRequestType,
    applyInventoryRequestPayload
  } = deps;
  const router = express.Router();

  router.get('/api/inventory/summary', protectAdmin, async (req, res) => {
    try {
      const allEntities = String(req.query.business_entity_id || '').trim().toLowerCase() === 'all';
      const businessEntityId = allEntities ? null : (normalizeBusinessEntityId(req.query.business_entity_id) || await getDefaultBusinessEntityId());
      const params = businessEntityId ? [businessEntityId] : [];
      const entityWhere = businessEntityId ? 'WHERE business_entity_id = ?' : '';
      const [productRows, warehouseRows, stockRows, lowStockRows] = await Promise.all([
        queryAsync(`SELECT COUNT(*) AS total FROM products ${entityWhere}`, params),
        queryAsync(`SELECT COUNT(*) AS total FROM warehouses ${entityWhere}`, params),
        queryAsync(`
          SELECT COALESCE(SUM(quantity_on_hand), 0) AS total
          FROM stock
          ${entityWhere}
        `, params),
        queryAsync(`
          SELECT COUNT(*) AS total
          FROM stock s
          JOIN products p ON p.id = s.product_id
          WHERE ${businessEntityId ? 's.business_entity_id = ? AND ' : ''}s.quantity_on_hand <= COALESCE(p.reorder_level, 0)
        `, params)
      ]);
      res.json({
        products: Number(productRows[0]?.total || 0),
        warehouses: Number(warehouseRows[0]?.total || 0),
        on_hand: Number(stockRows[0]?.total || 0),
        low_stock: Number(lowStockRows[0]?.total || 0)
      });
    } catch (err) {
      console.error('Inventory summary error:', err);
      res.status(500).json({ error: err.message || 'Unable to load inventory summary.' });
    }
  });

  router.get('/api/inventory/products', protectAdmin, async (req, res) => {
    try {
      const allEntities = String(req.query.business_entity_id || '').trim().toLowerCase() === 'all';
      const businessEntityId = allEntities ? null : (normalizeBusinessEntityId(req.query.business_entity_id) || await getDefaultBusinessEntityId());
      const rows = await queryAsync(
        `SELECT p.*,
                COALESCE(SUM(s.quantity_on_hand), 0) AS quantity_on_hand
         FROM products p
         LEFT JOIN stock s ON s.product_id = p.id
         WHERE ${allEntities ? 'p.is_active = TRUE' : 'p.business_entity_id = ? AND p.is_active = TRUE'}
         GROUP BY p.id
         ORDER BY p.product_name ASC`,
        allEntities ? [] : [businessEntityId]
      );
      res.json(rows);
    } catch (err) {
      console.error('Inventory products error:', err);
      res.status(500).json({ error: err.message || 'Unable to load products.' });
    }
  });

  router.post('/api/inventory/products', protectAdmin, async (req, res) => {
    try {
      if (isStaffRole(getAuthenticatedUser(req)?.role)) {
        return res.status(403).json({ error: 'Staff must save product requests as drafts and submit them for approval.' });
      }
      const businessEntityId = await resolveBusinessEntityId(req.body.business_entity_id);
      const productName = String(req.body.product_name || '').trim();
      if (!productName) return res.status(400).json({ error: 'Product name is required.' });

      const product = await insertProductWithSku(businessEntityId, {
        sku: req.body.sku,
        product_name: productName,
        category: String(req.body.category || '').trim() || null,
        unit: String(req.body.unit || 'pcs').trim() || 'pcs',
        reorder_level: Number(req.body.reorder_level || 0) || 0,
        unit_cost: Number(req.body.unit_cost || 0) || 0,
        selling_price: Number(req.body.selling_price || req.body.unit_price || 0) || 0
      });
      res.status(201).json(product);
    } catch (err) {
      console.error('Inventory product save error:', err);
      const isDuplicate = isDuplicateError(err);
      res.status(isDuplicate ? 409 : 500).json({ error: isDuplicate ? 'SKU already exists for this operating company.' : (err.message || 'Unable to save product.') });
    }
  });

  router.put('/api/inventory/products/:id', protectAdmin, async (req, res) => {
    try {
      if (isStaffRole(getAuthenticatedUser(req)?.role)) {
        return res.status(403).json({ error: 'Staff must submit product changes as drafts for approval.' });
      }
      const id = Number(req.params.id || 0) || 0;
      if (!id) return res.status(400).json({ error: 'Invalid product id.' });
      const productName = String(req.body.product_name || '').trim();
      if (!productName) return res.status(400).json({ error: 'Product name is required.' });
      const rows = await queryAsync(
        `UPDATE products SET
           product_name = ?, category = ?, unit = ?, reorder_level = ?, unit_cost = ?, selling_price = ?
         WHERE id = ? AND is_active = TRUE
         RETURNING *`,
        [
          productName,
          String(req.body.category || '').trim() || null,
          String(req.body.unit || 'pcs').trim() || 'pcs',
          Number(req.body.reorder_level || 0) || 0,
          Number(req.body.unit_cost || 0) || 0,
          Number(req.body.selling_price || req.body.unit_price || 0) || 0,
          id
        ]
      );
      if (!rows.length) return res.status(404).json({ error: 'Product not found.' });
      res.json(rows[0]);
    } catch (err) {
      console.error('Inventory product update error:', err);
      res.status(500).json({ error: err.message || 'Unable to update product.' });
    }
  });

  router.post('/api/inventory/products/:id/archive', protectAdminOnly, async (req, res) => {
    try {
      const id = Number(req.params.id || 0) || 0;
      if (!id) return res.status(400).json({ error: 'Invalid product id.' });
      const rows = await queryAsync('UPDATE products SET is_active = FALSE WHERE id = ? RETURNING id', [id]);
      if (!rows.length) return res.status(404).json({ error: 'Product not found.' });
      res.json({ success: true });
    } catch (err) {
      console.error('Inventory product archive error:', err);
      res.status(500).json({ error: err.message || 'Unable to archive product.' });
    }
  });

  router.get('/api/inventory/warehouses', protectAdmin, async (req, res) => {
    try {
      const allEntities = String(req.query.business_entity_id || '').trim().toLowerCase() === 'all';
      const businessEntityId = allEntities ? null : (normalizeBusinessEntityId(req.query.business_entity_id) || await getDefaultBusinessEntityId());
      const rows = await queryAsync(
        `SELECT *
         FROM warehouses
         WHERE ${allEntities ? 'is_active = TRUE' : 'business_entity_id = ? AND is_active = TRUE'}
         ORDER BY warehouse_name ASC`,
        allEntities ? [] : [businessEntityId]
      );
      res.json(rows);
    } catch (err) {
      console.error('Inventory warehouses error:', err);
      res.status(500).json({ error: err.message || 'Unable to load warehouses.' });
    }
  });

  router.post('/api/inventory/warehouses', protectAdmin, async (req, res) => {
    try {
      if (isStaffRole(getAuthenticatedUser(req)?.role)) {
        return res.status(403).json({ error: 'Staff must save warehouse requests as drafts and submit them for approval.' });
      }
      const businessEntityId = await resolveBusinessEntityId(req.body.business_entity_id);
      const warehouseName = String(req.body.warehouse_name || '').trim();
      if (!warehouseName) return res.status(400).json({ error: 'Warehouse name is required.' });

      // Blank code → auto-generate "<3-letter name prefix>-<5-digit running no.>" (e.g. MAI-00001).
      const row = await insertWarehouseWithCode(businessEntityId, {
        warehouse_code: req.body.warehouse_code,
        warehouse_name: warehouseName,
        location: String(req.body.location || '').trim() || null
      });
      res.status(201).json(row);
    } catch (err) {
      console.error('Inventory warehouse save error:', err);
      const isDuplicate = String(err.message || '').toLowerCase().includes('duplicate') || String(err.code || '') === '23505';
      res.status(isDuplicate ? 409 : 500).json({ error: isDuplicate ? 'Warehouse code already exists for this operating company.' : (err.message || 'Unable to save warehouse.') });
    }
  });

  router.put('/api/inventory/warehouses/:id', protectAdmin, async (req, res) => {
    try {
      if (isStaffRole(getAuthenticatedUser(req)?.role)) {
        return res.status(403).json({ error: 'Staff must submit warehouse changes as drafts for approval.' });
      }
      const id = Number(req.params.id || 0) || 0;
      if (!id) return res.status(400).json({ error: 'Invalid warehouse id.' });
      const warehouseCode = String(req.body.warehouse_code || '').trim();
      const warehouseName = String(req.body.warehouse_name || '').trim();
      if (!warehouseCode) return res.status(400).json({ error: 'Warehouse code is required.' });
      if (!warehouseName) return res.status(400).json({ error: 'Warehouse name is required.' });
      const rows = await queryAsync(
        `UPDATE warehouses SET warehouse_code = ?, warehouse_name = ?, location = ?
         WHERE id = ? AND is_active = TRUE
         RETURNING *`,
        [warehouseCode, warehouseName, String(req.body.location || '').trim() || null, id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Warehouse not found.' });
      res.json(rows[0]);
    } catch (err) {
      console.error('Inventory warehouse update error:', err);
      const isDuplicate = String(err.message || '').toLowerCase().includes('duplicate') || String(err.code || '') === '23505';
      res.status(isDuplicate ? 409 : 500).json({ error: isDuplicate ? 'Warehouse code already exists for this operating company.' : (err.message || 'Unable to update warehouse.') });
    }
  });

  router.post('/api/inventory/warehouses/:id/archive', protectAdminOnly, async (req, res) => {
    try {
      const id = Number(req.params.id || 0) || 0;
      if (!id) return res.status(400).json({ error: 'Invalid warehouse id.' });
      const rows = await queryAsync('UPDATE warehouses SET is_active = FALSE WHERE id = ? RETURNING id', [id]);
      if (!rows.length) return res.status(404).json({ error: 'Warehouse not found.' });
      res.json({ success: true });
    } catch (err) {
      console.error('Inventory warehouse archive error:', err);
      res.status(500).json({ error: err.message || 'Unable to archive warehouse.' });
    }
  });

  router.get('/api/inventory/stock', protectAdmin, async (req, res) => {
    try {
      const allEntities = String(req.query.business_entity_id || '').trim().toLowerCase() === 'all';
      const businessEntityId = allEntities ? null : (normalizeBusinessEntityId(req.query.business_entity_id) || await getDefaultBusinessEntityId());
      const rows = await queryAsync(
        `SELECT s.*, p.sku, p.product_name, p.category, p.unit, p.reorder_level, w.warehouse_code, w.warehouse_name
         FROM stock s
         JOIN products p ON p.id = s.product_id
         JOIN warehouses w ON w.id = s.warehouse_id
         ${allEntities ? '' : 'WHERE s.business_entity_id = ?'}
         ORDER BY p.product_name ASC, w.warehouse_name ASC`,
        allEntities ? [] : [businessEntityId]
      );
      res.json(rows);
    } catch (err) {
      console.error('Inventory stock error:', err);
      res.status(500).json({ error: err.message || 'Unable to load stock.' });
    }
  });

  router.get('/api/inventory/movements', protectAdmin, async (req, res) => {
    try {
      const includeAll = String(req.query.include_all || '0') === '1'
        || String(req.query.business_entity_id || '').trim().toLowerCase() === 'all';
      const businessEntityId = includeAll ? null : (normalizeBusinessEntityId(req.query.business_entity_id) || await getDefaultBusinessEntityId());
      const whereClause = businessEntityId ? 'WHERE m.business_entity_id = ?' : '';
      const rows = await queryAsync(
        `SELECT m.*, p.sku, p.product_name, p.unit_cost, w.warehouse_code, w.warehouse_name,
                proj.project_docno, proj.project_name
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         JOIN warehouses w ON w.id = m.warehouse_id
         LEFT JOIN projects proj ON proj.id = m.project_id
         ${whereClause}
         ORDER BY m.movement_date DESC, m.id DESC
         LIMIT ${includeAll ? 500 : 100}`,
        businessEntityId ? [businessEntityId] : []
      );
      res.json(rows);
    } catch (err) {
      console.error('Inventory movements error:', err);
      res.status(500).json({ error: err.message || 'Unable to load stock movements.' });
    }
  });

  router.get('/api/inventory/units', protectAdmin, async (req, res) => {
    try {
      const allEntities = String(req.query.business_entity_id || '').trim().toLowerCase() === 'all';
      const businessEntityId = allEntities ? null : (normalizeBusinessEntityId(req.query.business_entity_id) || await getDefaultBusinessEntityId());
      const params = allEntities ? [] : [businessEntityId];
      let extra = '';
      const status = String(req.query.status || '').trim().toLowerCase();
      if (PRODUCT_UNIT_STATUSES.includes(status)) {
        extra += ' AND u.status = ?';
        params.push(status);
      }
      const productId = Number(req.query.product_id || 0) || 0;
      if (productId) {
        extra += ' AND u.product_id = ?';
        params.push(productId);
      }
      const rows = await queryAsync(
        `SELECT u.*, p.sku, p.product_name, p.category, w.warehouse_code, w.warehouse_name,
                proj.project_docno, proj.project_name, po.po_number AS source_po_number
         FROM product_units u
         JOIN products p ON p.id = u.product_id
         LEFT JOIN warehouses w ON w.id = u.warehouse_id
         LEFT JOIN projects proj ON proj.id = u.project_id
         LEFT JOIN purchase_orders po ON po.id = u.source_po_id
         WHERE ${allEntities ? '1=1' : 'u.business_entity_id = ?'}${extra}
         ORDER BY u.created_at DESC, u.id DESC`,
        params
      );
      res.json(rows);
    } catch (err) {
      console.error('Inventory units load error:', err);
      res.status(500).json({ error: err.message || 'Unable to load serial units.' });
    }
  });

  router.post('/api/inventory/units', protectAdmin, async (req, res) => {
    try {
      if (isStaffRole(getAuthenticatedUser(req)?.role)) {
        return res.status(403).json({ error: 'Staff cannot add serial units directly.' });
      }
      const businessEntityId = await resolveBusinessEntityId(req.body.business_entity_id);
      const productId = Number(req.body.product_id || 0) || 0;
      const serial = String(req.body.serial_number || '').trim();
      if (!productId) return res.status(400).json({ error: 'Product is required.' });
      if (!serial) return res.status(400).json({ error: 'Serial number is required.' });

      const productRows = await queryAsync('SELECT id FROM products WHERE id = ? AND business_entity_id = ? LIMIT 1', [productId, businessEntityId]);
      if (!productRows.length) return res.status(400).json({ error: 'Selected product was not found.' });

      const rows = await queryAsync(
        `INSERT INTO product_units
           (business_entity_id, product_id, warehouse_id, serial_number, status, customer_name, project_id, source_po_id, warranty_start, warranty_end, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [
          businessEntityId,
          productId,
          Number(req.body.warehouse_id || 0) || null,
          serial,
          normalizeUnitStatus(req.body.status),
          String(req.body.customer_name || '').trim() || null,
          Number(req.body.project_id || 0) || null,
          Number(req.body.source_po_id || 0) || null,
          normalizeDateOrNull(req.body.warranty_start),
          normalizeDateOrNull(req.body.warranty_end),
          String(req.body.notes || '').trim() || null,
          req?.session?.user?.fullname || req?.session?.user?.username || null
        ]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      console.error('Inventory unit save error:', err);
      const isDuplicate = isDuplicateError(err);
      res.status(isDuplicate ? 409 : 500).json({ error: isDuplicate ? 'Serial number already exists for this operating company.' : (err.message || 'Unable to save serial unit.') });
    }
  });

  router.put('/api/inventory/units/:id', protectAdmin, async (req, res) => {
    try {
      if (isStaffRole(getAuthenticatedUser(req)?.role)) {
        return res.status(403).json({ error: 'Staff cannot edit serial units.' });
      }
      const id = Number(req.params.id || 0) || 0;
      if (!id) return res.status(400).json({ error: 'Invalid unit id.' });
      const serial = String(req.body.serial_number || '').trim();
      if (!serial) return res.status(400).json({ error: 'Serial number is required.' });

      const rows = await queryAsync(
        `UPDATE product_units SET
           warehouse_id = ?, serial_number = ?, status = ?, customer_name = ?,
           project_id = ?, source_po_id = ?, warranty_start = ?, warranty_end = ?, notes = ?,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
         RETURNING *`,
        [
          Number(req.body.warehouse_id || 0) || null,
          serial,
          normalizeUnitStatus(req.body.status),
          String(req.body.customer_name || '').trim() || null,
          Number(req.body.project_id || 0) || null,
          Number(req.body.source_po_id || 0) || null,
          normalizeDateOrNull(req.body.warranty_start),
          normalizeDateOrNull(req.body.warranty_end),
          String(req.body.notes || '').trim() || null,
          id
        ]
      );
      if (!rows.length) return res.status(404).json({ error: 'Serial unit not found.' });
      res.json(rows[0]);
    } catch (err) {
      console.error('Inventory unit update error:', err);
      const isDuplicate = isDuplicateError(err);
      res.status(isDuplicate ? 409 : 500).json({ error: isDuplicate ? 'Serial number already exists for this operating company.' : (err.message || 'Unable to update serial unit.') });
    }
  });

  router.delete('/api/inventory/units/:id', protectAdminOnly, async (req, res) => {
    try {
      const id = Number(req.params.id || 0) || 0;
      if (!id) return res.status(400).json({ error: 'Invalid unit id.' });
      const rows = await queryAsync('DELETE FROM product_units WHERE id = ? RETURNING id', [id]);
      if (!rows.length) return res.status(404).json({ error: 'Serial unit not found.' });
      res.json({ success: true });
    } catch (err) {
      console.error('Inventory unit delete error:', err);
      res.status(500).json({ error: err.message || 'Unable to delete serial unit.' });
    }
  });

  // RMA (Return Merchandise Authorization) — lightweight lifecycle built on the
  // serial unit itself. Logging an RMA flips the unit to 'rma' and stamps the reason;
  // resolving it routes the unit to its next physical state. Each resolution maps to
  // what should happen to the unit + its customer/sales linkage:
  //   restock       → back to sellable stock  (clear customer + DR link)
  //   repair_return → fixed and returned       (stays sold to the same customer)
  //   replace       → unit is dead, customer got a different serial (defective, unlinked from DR)
  //   scrap         → written off               (defective, unlinked from DR)
  const RMA_RESOLUTIONS = {
    restock:       { status: 'in_stock',  clearCustomer: true,  clearSales: true,  label: 'Restocked' },
    repair_return: { status: 'sold',      clearCustomer: false, clearSales: false, label: 'Repaired & returned' },
    replace:       { status: 'defective', clearCustomer: false, clearSales: true,  label: 'Replaced' },
    scrap:         { status: 'defective', clearCustomer: false, clearSales: true,  label: 'Scrapped' }
  };

  // Log an RMA against a sold/delivered serial unit.
  router.post('/api/inventory/units/:id/rma', protectAdmin, async (req, res) => {
    try {
      if (isStaffRole(getAuthenticatedUser(req)?.role)) {
        return res.status(403).json({ error: 'Staff cannot log RMAs.' });
      }
      const id = Number(req.params.id || 0) || 0;
      if (!id) return res.status(400).json({ error: 'Invalid unit id.' });
      const reason = String(req.body.reason || '').trim();
      if (!reason) return res.status(400).json({ error: 'RMA reason is required.' });

      const existing = await queryAsync('SELECT * FROM product_units WHERE id = ? LIMIT 1', [id]);
      const unit = existing[0];
      if (!unit) return res.status(404).json({ error: 'Serial unit not found.' });
      if (String(unit.status || '') === 'in_stock') {
        return res.status(400).json({ error: 'Only sold/delivered units can be sent to RMA.' });
      }

      const rows = await queryAsync(
        `UPDATE product_units SET
           status = 'rma', rma_reason = ?, rma_logged_at = CURRENT_TIMESTAMP,
           rma_resolution = NULL, rma_resolved_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
         RETURNING *`,
        [reason, id]
      );
      logAction(req, 'RMA_LOG', `Logged RMA for serial ${unit.serial_number || `#${id}`}: ${reason}`, 'inventory', {
        entityType: 'product_unit', entityId: id, businessEntityId: unit.business_entity_id,
        changes: { status: { from: unit.status, to: 'rma' } }, severity: 'warning'
      });
      res.json(rows[0]);
    } catch (err) {
      console.error('Inventory RMA log error:', err);
      res.status(500).json({ error: err.message || 'Unable to log RMA.' });
    }
  });

  // Resolve an open RMA, routing the unit to its next state.
  router.post('/api/inventory/units/:id/rma/resolve', protectAdmin, async (req, res) => {
    try {
      if (isStaffRole(getAuthenticatedUser(req)?.role)) {
        return res.status(403).json({ error: 'Staff cannot resolve RMAs.' });
      }
      const id = Number(req.params.id || 0) || 0;
      if (!id) return res.status(400).json({ error: 'Invalid unit id.' });
      const resolution = String(req.body.resolution || '').trim().toLowerCase();
      const rule = RMA_RESOLUTIONS[resolution];
      if (!rule) return res.status(400).json({ error: 'Invalid RMA resolution.' });

      const existing = await queryAsync('SELECT * FROM product_units WHERE id = ? LIMIT 1', [id]);
      const unit = existing[0];
      if (!unit) return res.status(404).json({ error: 'Serial unit not found.' });
      if (String(unit.status || '') !== 'rma') {
        return res.status(400).json({ error: 'This unit has no open RMA to resolve.' });
      }

      // Replacement: hand the chosen in-stock serial to the SAME customer + sale (the purchase
      // continues under a new serial) and take it out of stock. The old unit becomes the defective,
      // unlinked one below. Capture the old unit's customer/sale NOW, before it gets cleared.
      let replacementUnit = null;
      if (resolution === 'replace') {
        const replacementId = Number(req.body.replacement_unit_id || 0) || 0;
        if (replacementId) {
          if (replacementId === id) return res.status(400).json({ error: 'Ang replacement ay dapat ibang serial unit.' });
          const repRows = await queryAsync('SELECT * FROM product_units WHERE id = ? LIMIT 1', [replacementId]);
          replacementUnit = repRows[0];
          if (!replacementUnit) return res.status(404).json({ error: 'Replacement unit not found.' });
          if (String(replacementUnit.status || '') !== 'in_stock') return res.status(400).json({ error: 'Ang replacement ay dapat in-stock na serial.' });
          if (Number(replacementUnit.product_id || 0) !== Number(unit.product_id || 0)) return res.status(400).json({ error: 'Ang replacement ay dapat parehong produkto.' });
          await queryAsync(
            `UPDATE product_units SET status = 'sold', customer_name = ?, sales_record_id = ?, project_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [unit.customer_name || null, unit.sales_record_id || null, unit.project_id || null, replacementId]
          );
          logAction(req, 'RMA_REPLACE', `Replacement serial ${replacementUnit.serial_number || ('#' + replacementId)} issued for ${unit.serial_number || ('#' + id)} (customer ${unit.customer_name || '-'})`, 'inventory', {
            entityType: 'product_unit', entityId: replacementId, businessEntityId: unit.business_entity_id,
            changes: { status: { from: 'in_stock', to: 'sold' } }, severity: 'info'
          });
        }
      }

      const note = String(req.body.note || '').trim();
      const mergedReason = note
        ? `${String(unit.rma_reason || '').trim()}${unit.rma_reason ? '\n— ' : ''}Resolution note: ${note}`
        : unit.rma_reason;

      const rows = await queryAsync(
        `UPDATE product_units SET
           status = ?,
           customer_name = ${rule.clearCustomer ? 'NULL' : 'customer_name'},
           sales_record_id = ${rule.clearSales ? 'NULL' : 'sales_record_id'},
           rma_reason = ?, rma_resolution = ?, rma_resolved_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
         RETURNING *`,
        [rule.status, mergedReason, resolution, id]
      );
      logAction(req, 'RMA_RESOLVE', `Resolved RMA for serial ${unit.serial_number || `#${id}`}: ${rule.label}${replacementUnit ? ` (replaced by ${replacementUnit.serial_number || ('#' + replacementUnit.id)})` : ''}`, 'inventory', {
        entityType: 'product_unit', entityId: id, businessEntityId: unit.business_entity_id,
        changes: { status: { from: 'rma', to: rule.status }, resolution: { from: null, to: resolution } },
        severity: 'info'
      });
      res.json({ ...rows[0], replacement: replacementUnit ? { id: replacementUnit.id, serial_number: replacementUnit.serial_number } : null });
    } catch (err) {
      console.error('Inventory RMA resolve error:', err);
      res.status(500).json({ error: err.message || 'Unable to resolve RMA.' });
    }
  });

  router.get('/api/inventory/requests', protectAdmin, async (req, res) => {
    try {
      const actor = getAuthenticatedUser(req);
      const admin = isAdminRole(actor?.role);
      const rows = await queryAsync(`
        SELECT *
        FROM inventory_requests
        ${admin ? '' : 'WHERE requested_by_email = ? OR requested_by = ?'}
        ORDER BY COALESCE(submitted_at, created_at) DESC, id DESC
      `, admin ? [] : [actor?.email || '', actor?.fullname || actor?.username || '']);
      res.json((Array.isArray(rows) ? rows : []).map((row) => {
        let payload = {};
        try { payload = JSON.parse(row.payload || '{}'); } catch (_) {}
        return { ...row, payload };
      }));
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to load inventory requests.' });
    }
  });

  router.post('/api/inventory/requests', protectAdmin, async (req, res) => {
    try {
      const actor = getAuthenticatedUser(req);
      const isStaff = isStaffRole(actor?.role || '');
      const requestType = normalizeInventoryRequestType(req.body?.request_type);
      if (!requestType) return res.status(400).json({ error: 'Invalid inventory request type.' });
      const payload = { ...(req.body?.payload || {}) };
      if (isStaff) {
        const requestNo = await generateInventoryDraftRequestNo();
        await queryAsync(
          `INSERT INTO inventory_requests
            (request_no, request_type, payload, status, requested_by, requested_by_email, submitted_at)
           VALUES (?, ?, ?, 'draft', ?, ?, NULL)`,
          [requestNo, requestType, JSON.stringify(payload), actor?.fullname || actor?.username || null, actor?.email || null]
        );
        logAction(req, 'CREATE_INVENTORY_DRAFT', `Draft: ${requestNo} | Type: ${requestType}`, 'inventory', { entityType: 'inventory_request' });
        return res.status(201).json({ success: true, request_no: requestNo, status: 'draft' });
      }
      // Admin applies the inventory change directly (creates the product/warehouse/movement).
      const applied = await applyInventoryRequestPayload(requestType, payload, req);
      const requestNo = stripDraftRequestNoPrefix(await generateInventoryDraftRequestNo());
      const approvedBy = getApprovalActorName(req);
      await queryAsync(
        `INSERT INTO inventory_requests
          (request_no, request_type, payload, status, requested_by, requested_by_email, submitted_at, approved_by, approved_at)
         VALUES (?, ?, ?, 'approved', ?, ?, NOW(), ?, NOW())`,
        [requestNo, requestType, JSON.stringify(payload), actor?.fullname || actor?.username || null, actor?.email || null, approvedBy]
      );
      logAction(req, 'CREATE_INVENTORY_OFFICIAL', `Official: ${requestNo} | Type: ${requestType}`, 'inventory', { entityType: 'inventory_request' });
      res.status(201).json({ success: true, request_no: requestNo, status: 'approved', applied });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Unable to create inventory request.' });
    }
  });

  router.post('/api/inventory/requests/:id/submit', protectAdmin, async (req, res) => {
    try {
      const requestId = Number(req.params.id || 0);
      if (!requestId) return res.status(400).json({ error: 'Invalid request ID.' });
      const rows = await queryAsync('SELECT * FROM inventory_requests WHERE id = ? LIMIT 1', [requestId]);
      const requestRow = rows?.[0];
      if (!requestRow) return res.status(404).json({ error: 'Inventory request not found.' });
      const currentStatus = String(requestRow.status || '').toLowerCase();
      if (currentStatus === 'submitted') return res.json({ success: true, status: 'submitted', alreadySubmitted: true });
      if (currentStatus !== 'draft') return res.status(400).json({ error: 'Only draft inventory requests can be submitted.' });
      await queryAsync("UPDATE inventory_requests SET status = 'submitted', submitted_at = NOW() WHERE id = ?", [requestId]);
      logAction(req, 'SUBMIT_INVENTORY_REQUEST', `Request No: ${requestRow.request_no || requestId}`, 'inventory', { entityType: 'inventory_request', entityId: requestId, changes: [{ field: 'status', from: requestRow.status, to: 'submitted' }] });
      res.json({ success: true, status: 'submitted' });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unable to submit inventory request.' });
    }
  });

  router.put('/api/inventory/requests/:id', protectAdmin, async (req, res) => {
    try {
      const actor = getAuthenticatedUser(req);
      const requestId = Number(req.params.id || 0);
      if (!requestId) return res.status(400).json({ error: 'Invalid request ID.' });
      const rows = await queryAsync('SELECT * FROM inventory_requests WHERE id = ? LIMIT 1', [requestId]);
      const requestRow = rows?.[0];
      if (!requestRow) return res.status(404).json({ error: 'Inventory request not found.' });
      if (String(requestRow.status || '').toLowerCase() !== 'draft') {
        return res.status(400).json({ error: 'Only draft inventory requests can be edited.' });
      }
      if (isStaffRole(actor?.role) && String(requestRow.requested_by_email || '') !== String(actor?.email || '')) {
        return res.status(403).json({ error: 'You can edit your own draft requests only.' });
      }
      const requestType = normalizeInventoryRequestType(req.body?.request_type || requestRow.request_type);
      if (!requestType) return res.status(400).json({ error: 'Invalid inventory request type.' });
      const payload = { ...(req.body?.payload || {}) };
      await queryAsync(
        'UPDATE inventory_requests SET request_type = ?, payload = ? WHERE id = ?',
        [requestType, JSON.stringify(payload), requestId]
      );
      logAction(req, 'UPDATE_INVENTORY_DRAFT', `Draft No: ${requestRow.request_no || requestId} | Type: ${requestType}`, 'inventory', { entityType: 'inventory_request', entityId: requestId });
      res.json({ success: true, status: 'draft', request_no: requestRow.request_no });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Unable to update inventory request.' });
    }
  });

  router.post('/api/inventory/requests/:id/approve', protectAdminOnly, async (req, res) => {
    try {
      const requestId = Number(req.params.id || 0);
      if (!requestId) return res.status(400).json({ error: 'Invalid request ID.' });
      const rows = await queryAsync('SELECT * FROM inventory_requests WHERE id = ? LIMIT 1', [requestId]);
      const requestRow = rows?.[0];
      if (!requestRow) return res.status(404).json({ error: 'Inventory request not found.' });
      const currentStatus = String(requestRow.status || '').toLowerCase();
      if (currentStatus === 'approved') return res.json({ success: true, status: 'approved', alreadyApproved: true });
      if (currentStatus !== 'submitted') return res.status(400).json({ error: 'Only submitted inventory requests can be approved.' });
      let payload = {};
      try { payload = JSON.parse(requestRow.payload || '{}'); } catch (_) {}
      const applied = await applyInventoryRequestPayload(requestRow.request_type, payload, req);
      const approvedBy = getApprovalActorName(req);
      const comment = getApprovalComment(req);
      // On approval the draft request number becomes official (strip the DRAFT- prefix).
      const officialRequestNo = stripDraftRequestNoPrefix(requestRow.request_no);
      await queryAsync(
        "UPDATE inventory_requests SET request_no = ?, status = 'approved', approved_by = ?, approved_at = NOW(), reject_reason = NULL, approval_comment = ? WHERE id = ?",
        [officialRequestNo, approvedBy, comment || null, requestId]
      );
      logAction(req, 'APPROVE_INVENTORY_REQUEST', appendApprovalComment(`Draft No: ${requestRow.request_no || requestId} | Request No: ${officialRequestNo} | Type: ${requestRow.request_type}`, comment), 'inventory', { entityType: 'inventory_request', entityId: requestId, changes: [{ field: 'status', from: 'submitted', to: 'approved' }] });
      res.json({ success: true, status: 'approved', request_no: officialRequestNo, approved_by: approvedBy, approval_comment: comment, applied });
    } catch (err) {
      const isDuplicate = String(err.message || '').toLowerCase().includes('duplicate') || String(err.code || '') === '23505';
      res.status(isDuplicate ? 409 : 400).json({ error: isDuplicate ? 'Inventory record already exists.' : (err.message || 'Unable to approve inventory request.') });
    }
  });

  router.post('/api/inventory/requests/:id/reject', protectAdminOnly, async (req, res) => {
    try {
      const requestId = Number(req.params.id || 0);
      const reason = String(req.body?.reason || '').trim() || 'Rejected by admin.';
      if (!requestId) return res.status(400).json({ error: 'Invalid request ID.' });
      const rows = await queryAsync('SELECT request_no, status FROM inventory_requests WHERE id = ? LIMIT 1', [requestId]);
      if (!rows?.[0]) return res.status(404).json({ error: 'Inventory request not found.' });
      if (String(rows[0].status || '').toLowerCase() !== 'submitted') {
        return res.status(400).json({ error: 'Only submitted inventory requests can be rejected.' });
      }
      await queryAsync(
        "UPDATE inventory_requests SET status = 'rejected', approved_by = ?, approved_at = NOW(), reject_reason = ?, approval_comment = ? WHERE id = ?",
        [getApprovalActorName(req), reason, reason, requestId]
      );
      logAction(req, 'REJECT_INVENTORY_REQUEST', `Request No: ${rows[0].request_no || requestId} | Reason: ${reason}`, 'inventory', { entityType: 'inventory_request', entityId: requestId, severity: 'warning', changes: [{ field: 'status', from: rows[0].status, to: 'rejected' }] });
      res.json({ success: true, status: 'rejected', reason });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Unable to reject inventory request.' });
    }
  });

  router.post('/api/inventory/movements', protectAdmin, async (req, res) => {
    try {
      if (isStaffRole(getAuthenticatedUser(req)?.role)) {
        return res.status(403).json({ error: 'Staff must save stock movement requests as drafts and submit them for approval.' });
      }
      const businessEntityId = await resolveBusinessEntityId(req.body.business_entity_id);
      const productId = Number(req.body.product_id || 0) || 0;
      const warehouseId = Number(req.body.warehouse_id || 0) || 0;
      const projectId = Number(req.body.project_id || 0) || null;
      const movementType = String(req.body.movement_type || '').trim().toLowerCase();
      const quantity = Number(req.body.quantity || 0) || 0;
      if (!productId) return res.status(400).json({ error: 'Product is required.' });
      if (!warehouseId) return res.status(400).json({ error: 'Warehouse is required.' });
      if (!['in', 'out', 'adjustment'].includes(movementType)) return res.status(400).json({ error: 'Movement type is required.' });
      if (quantity <= 0) return res.status(400).json({ error: 'Quantity must be greater than zero.' });

      const [productRows, warehouseRows] = await Promise.all([
        queryAsync('SELECT id FROM products WHERE id = ? AND business_entity_id = ? LIMIT 1', [productId, businessEntityId]),
        queryAsync('SELECT id FROM warehouses WHERE id = ? AND business_entity_id = ? LIMIT 1', [warehouseId, businessEntityId])
      ]);
      if (!productRows.length) return res.status(404).json({ error: 'Selected product was not found.' });
      if (!warehouseRows.length) return res.status(404).json({ error: 'Selected warehouse was not found.' });
      if (projectId) {
        await assertProjectAcceptsNewActivity(projectId);
        const projectRows = await queryAsync('SELECT id FROM projects WHERE id = ? AND business_entity_id = ? LIMIT 1', [projectId, businessEntityId]);
        if (!projectRows.length) return res.status(404).json({ error: 'Selected project was not found.' });
      }

      const signedQty = movementType === 'out' ? -quantity : quantity;
      const stockRows = await queryAsync(
        `INSERT INTO stock (business_entity_id, product_id, warehouse_id, quantity_on_hand, updated_at)
         VALUES (?, ?, ?, ?, NOW())
         ON CONFLICT (product_id, warehouse_id)
         DO UPDATE SET quantity_on_hand = stock.quantity_on_hand + EXCLUDED.quantity_on_hand, updated_at = NOW()
         RETURNING *`,
        [businessEntityId, productId, warehouseId, signedQty]
      );
      if (Number(stockRows[0]?.quantity_on_hand || 0) < 0) {
        await queryAsync(
          `UPDATE stock
           SET quantity_on_hand = quantity_on_hand - ?, updated_at = NOW()
           WHERE product_id = ? AND warehouse_id = ?`,
          [signedQty, productId, warehouseId]
        );
        return res.status(400).json({ error: 'Stock cannot go below zero.' });
      }

      const rows = await queryAsync(
        `INSERT INTO stock_movements (business_entity_id, product_id, warehouse_id, movement_type, quantity, reference_type, reference_no, project_id, notes, movement_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [
          businessEntityId,
          productId,
          warehouseId,
          movementType,
          quantity,
          String(req.body.reference_type || '').trim() || (projectId ? 'project_issue' : null),
          String(req.body.reference_no || '').trim() || null,
          projectId,
          String(req.body.notes || '').trim() || null,
          req.body.movement_date || new Date().toISOString().slice(0, 10),
          req.session?.user?.fullname || req.session?.user?.username || null
        ]
      );
      res.status(201).json({ movement: rows[0], stock: stockRows[0] });
    } catch (err) {
      console.error('Inventory movement save error:', err);
      res.status(500).json({ error: err.message || 'Unable to save stock movement.' });
    }
  });

  return router;
};
