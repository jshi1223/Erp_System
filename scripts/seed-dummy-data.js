// Seeds 100 dummy records each of: users, companies (customers), products,
// projects, and sales records. Inserts directly via the app's Postgres pool, so
// no API/inventory side-effects fire. Idempotent: re-running skips existing rows
// (matched by their DUMMY- prefixes). Remove everything later with:
//   node scripts/seed-dummy-data.js --clear
//
// Usage:
//   node scripts/seed-dummy-data.js          # seed 100 of each
//   node scripts/seed-dummy-data.js --clear  # delete all DUMMY- seed rows

const bcrypt = require('bcrypt');
const { createPostgresAppPool } = require('../lib/db/postgres-app');

const COUNT = 100;
const PENDING = 12; // per-module pending items for the Approval Center
const pad = (n) => String(n).padStart(3, '0');
const CATEGORIES = ['CCTV Cameras', 'NVR', 'Cables', 'Accessories', 'Networking'];
const SALES_TYPES = ['sales-request', 'sales-order', 'project-delivery'];
// Weighted toward official statuses so the seeded rows show in the main tables
// (drafts are hidden there by design), with some 'submitted' for the approval queue.
const SALES_STATUSES = ['approved', 'won', 'sent', 'delivered', 'completed', 'submitted', 'approved', 'delivered'];
const PROJECT_STATUSES = ['planning', 'ongoing', 'completed', 'on_hold', 'submitted', 'ongoing', 'completed', 'cancelled'];
const SERVICE_TYPES = ['installation', 'maintenance', 'repair', 'consultation', 'supply', 'inspection'];

const pool = createPostgresAppPool();
const q = (sql, params = []) => pool.query(sql, params);

async function resolveBusinessEntityId() {
  const rows = await q('SELECT id FROM business_entities ORDER BY is_default DESC, id ASC LIMIT 1');
  if (!rows.length) throw new Error('No business entity found. Start the server once to seed defaults.');
  return Number(rows[0].id);
}

async function clearAll() {
  console.log('Clearing previous DUMMY- seed rows...');
  // Children first to respect FKs.
  await q("DELETE FROM sales_record_items WHERE sales_record_id IN (SELECT id FROM sales_management_records WHERE document_no LIKE 'DUMMY-%')");
  await q("DELETE FROM sales_management_records WHERE document_no LIKE 'DUMMY-%'");
  await q("DELETE FROM product_units WHERE serial_number LIKE 'DUMMY-%'");
  await q("DELETE FROM payments WHERE reference_number LIKE 'DUMMY-%'");
  await q("DELETE FROM accounts_receivable WHERE invoice_number LIKE 'DUMMY-%'");
  await q("DELETE FROM accounts_payable WHERE bill_number LIKE 'DUMMY-%'");
  await q("DELETE FROM purchase_orders WHERE po_number LIKE 'DUMMY-%'");
  await q("DELETE FROM purchase_requisitions WHERE pr_number LIKE 'DUMMY-%'");
  await q("DELETE FROM inventory_requests WHERE request_no LIKE 'DUMMY-%'");
  await q("DELETE FROM company_registry_requests WHERE request_no LIKE 'DUMMY-%'");
  await q("DELETE FROM vendor_registry_requests WHERE request_no LIKE 'DUMMY-%'");
  // Match projects by NAME too: the running server's auto-numbering renames
  // project_docno (e.g. DUMMY-PRJ001 -> PRJ-2026-06-01), so a prefix-only clear
  // would leave them behind.
  await q("DELETE FROM projects WHERE project_docno LIKE 'DUMMY-%' OR project_name LIKE 'Dummy %' OR project_name LIKE '%(Demo)%'");
  await q("DELETE FROM products WHERE sku LIKE 'DUMMY-%'");
  await q("DELETE FROM warehouses WHERE warehouse_code LIKE 'DUMMY-%'");
  await q("DELETE FROM vendors WHERE vendor_no LIKE 'DUMMY-%'");
  await q("DELETE FROM company_registry WHERE company_no LIKE 'DUMMY-%'");
  await q("DELETE FROM users WHERE username LIKE 'dummy_user%'");
  console.log('Done clearing.');
}

async function seedUsers() {
  const hash = await bcrypt.hash('Password123', 10);
  let created = 0;
  for (let i = 1; i <= COUNT; i += 1) {
    const role = i % 5 === 0 ? 'admin' : 'staff';
    const res = await q(
      `INSERT INTO users (username, password, email, fullname, role, approval_status, active)
       VALUES (?, ?, ?, ?, ?, 'approved', true)
       ON CONFLICT (username) DO NOTHING`,
      [`dummy_user${pad(i)}`, hash, `dummy${pad(i)}@example.com`, `Dummy User ${pad(i)}`, role]
    );
    if (Number(res?.insertId || 0)) created += 1;
  }
  console.log(`Users: ${created} new (target ${COUNT}).`);
}

async function seedCompanies(businessEntityId) {
  let created = 0;
  for (let i = 1; i <= COUNT; i += 1) {
    const res = await q(
      `INSERT INTO company_registry (company_no, business_entity_id, company_name, address, contact_person, phone, email, industry, status, branch_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', '000')
       ON CONFLICT (company_no) DO NOTHING`,
      [`DUMMY-C${pad(i)}`, businessEntityId, `Dummy Company ${pad(i)}`, `${i} Test St, Metro Manila`,
       `Contact ${pad(i)}`, `0917${pad(i)}0000`, `company${pad(i)}@example.com`, CATEGORIES[i % CATEGORIES.length]]
    );
    if (Number(res?.insertId || 0)) created += 1;
  }
  console.log(`Companies: ${created} new (target ${COUNT}).`);
  return q("SELECT id FROM company_registry WHERE company_no LIKE 'DUMMY-%' ORDER BY id ASC");
}

async function seedProducts(businessEntityId) {
  let created = 0;
  for (let i = 1; i <= COUNT; i += 1) {
    const cost = 500 + (i % 50) * 25;
    const res = await q(
      `INSERT INTO products (business_entity_id, sku, product_name, category, unit, reorder_level, unit_cost, selling_price, is_active)
       VALUES (?, ?, ?, ?, 'pcs', 5, ?, ?, true)
       ON CONFLICT (business_entity_id, sku) DO NOTHING`,
      [businessEntityId, `DUMMY-P${pad(i)}`, `Dummy Product ${pad(i)}`, CATEGORIES[i % CATEGORIES.length], cost, Math.round(cost * 1.4)]
    );
    if (Number(res?.insertId || 0)) created += 1;
  }
  console.log(`Products: ${created} new (target ${COUNT}).`);
}

async function seedProjects(businessEntityId, companyIds) {
  // projects.project_docno has no unique constraint in the live DB, so guard each
  // insert with an existence check instead of relying on ON CONFLICT.
  let created = 0;
  for (let i = 1; i <= COUNT; i += 1) {
    const docno = `DUMMY-PRJ${pad(i)}`;
    const existing = await q('SELECT id FROM projects WHERE project_docno = ? LIMIT 1', [docno]);
    if (existing.length) continue;
    const company = companyIds[i % companyIds.length];
    const start = `2026-01-${pad((i % 27) + 1).slice(1)}`;
    const status = PROJECT_STATUSES[i % PROJECT_STATUSES.length];
    const service = SERVICE_TYPES[i % SERVICE_TYPES.length];
    await q(
      `INSERT INTO projects (project_docno, project_name, business_entity_id, company_id, company_name, description, start_date, end_date, status, service_type, budget, qty, unit_cost, downpayment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
      [docno, `Dummy ${service} Project ${pad(i)}`, businessEntityId, Number(company.id),
       `Dummy Company ${pad((i % COUNT) + 1)}`, `Seeded ${service} project ${pad(i)}`, start, '2026-12-31',
       status, service, 50000 + (i % 30) * 10000]
    );
    created += 1;
  }
  console.log(`Projects: ${created} new (target ${COUNT}).`);
  return q("SELECT id FROM projects WHERE project_docno LIKE 'DUMMY-%' ORDER BY id ASC LIMIT 100");
}

async function seedSalesRecords(businessEntityId, companyIds, projectIds) {
  let created = 0;
  for (let i = 1; i <= COUNT; i += 1) {
    const type = SALES_TYPES[i % SALES_TYPES.length];
    const status = SALES_STATUSES[i % SALES_STATUSES.length];
    const company = companyIds[i % companyIds.length];
    const project = projectIds[i % projectIds.length];
    const amount = 1000 + (i % 40) * 250;
    const res = await q(
      `INSERT INTO sales_management_records (record_type, document_no, business_entity_id, company_id, project_id, title, description, amount, status, requested_date, target_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
      [type, `DUMMY-SR${pad(i)}`, businessEntityId, Number(company.id), Number(project.id),
       `Dummy ${type} ${pad(i)}`, `Seeded sales record ${pad(i)}`, amount, status, '2026-02-01', '2026-03-01']
    );
    if (Number(res?.insertId || 0)) created += 1;
  }
  console.log(`Sales records: ${created} new (target ${COUNT}).`);
}

async function insertIfAbsent(table, col, val, insertSql, params) {
  const found = await q(`SELECT id FROM ${table} WHERE ${col} = ? LIMIT 1`, [val]);
  if (found.length) return Number(found[0].id);
  const res = await q(insertSql, params);
  return Number(res?.insertId || 0);
}

async function seedVendors(be) {
  for (let i = 1; i <= 10; i += 1) {
    await insertIfAbsent('vendors', 'vendor_no', `DUMMY-V${pad(i)}`,
      'INSERT INTO vendors (vendor_no, business_entity_id, vendor_name, contact_person, phone, email, is_active) VALUES (?, ?, ?, ?, ?, ?, true)',
      [`DUMMY-V${pad(i)}`, be, `Dummy Vendor ${pad(i)}`, `Vendor Contact ${pad(i)}`, `0918${pad(i)}0000`, `vendor${pad(i)}@example.com`]);
  }
  const rows = await q("SELECT id FROM vendors WHERE vendor_no LIKE 'DUMMY-V%' ORDER BY id ASC");
  console.log(`Vendors: ${rows.length} total dummy.`);
  return rows.map((r) => Number(r.id));
}

// --- Pending items so the Approval Center has things to review across modules ---
async function seedPendingUsers() {
  const hash = await bcrypt.hash('Password123', 10);
  let created = 0;
  for (let i = 1; i <= PENDING; i += 1) {
    const res = await q(
      `INSERT INTO users (username, password, email, fullname, role, approval_status, active)
       VALUES (?, ?, ?, ?, 'staff', 'pending', false)
       ON CONFLICT (username) DO NOTHING`,
      [`dummy_userP${pad(i)}`, hash, `dummyP${pad(i)}@example.com`, `Pending User ${pad(i)}`]);
    if (Number(res?.insertId || 0)) created += 1;
  }
  console.log(`Pending users (approval): ${created} new.`);
}

async function seedRegistryRequests(be) {
  let c = 0;
  let v = 0;
  for (let i = 1; i <= PENDING; i += 1) {
    const cPayload = JSON.stringify({ company_name: `Pending Company ${pad(i)}`, contact_person: `Contact ${pad(i)}`, phone: `0917${pad(i)}1111`, tin: `000-${pad(i)}`, business_entity_id: be });
    if (await insertIfAbsent('company_registry_requests', 'request_no', `DUMMY-CRQ${pad(i)}`,
      "INSERT INTO company_registry_requests (request_no, payload, status, requested_by) VALUES (?, ?, 'submitted', ?)",
      [`DUMMY-CRQ${pad(i)}`, cPayload, `Staff ${pad(i)}`])) c += 1;
    const vPayload = JSON.stringify({ vendor_name: `Pending Vendor ${pad(i)}`, contact_person: `Contact ${pad(i)}`, phone: `0918${pad(i)}1111`, tin: `111-${pad(i)}`, business_entity_id: be });
    if (await insertIfAbsent('vendor_registry_requests', 'request_no', `DUMMY-VRQ${pad(i)}`,
      "INSERT INTO vendor_registry_requests (request_no, payload, status, requested_by) VALUES (?, ?, 'submitted', ?)",
      [`DUMMY-VRQ${pad(i)}`, vPayload, `Staff ${pad(i)}`])) v += 1;
  }
  console.log(`Registry requests (approval): ${c} company, ${v} vendor.`);
}

async function seedInventoryRequests(be) {
  const types = ['product', 'warehouse', 'movement'];
  let created = 0;
  for (let i = 1; i <= PENDING; i += 1) {
    const type = types[i % types.length];
    const payload = JSON.stringify(
      type === 'product' ? { sku: `REQ-${pad(i)}`, product_name: `Requested Product ${pad(i)}`, category: CATEGORIES[i % CATEGORIES.length], business_entity_id: be }
        : type === 'warehouse' ? { warehouse_code: `WH-${pad(i)}`, warehouse_name: `Requested WH ${pad(i)}`, business_entity_id: be }
          : { movement_type: 'in', quantity: 10 + i, business_entity_id: be });
    if (await insertIfAbsent('inventory_requests', 'request_no', `DUMMY-INVRQ${pad(i)}`,
      "INSERT INTO inventory_requests (request_no, request_type, payload, status, requested_by) VALUES (?, ?, ?, 'submitted', ?)",
      [`DUMMY-INVRQ${pad(i)}`, type, payload, `Staff ${pad(i)}`])) created += 1;
  }
  console.log(`Inventory requests (approval): ${created} new.`);
}

async function seedRequisitions(be, companyIds, projectIds) {
  let created = 0;
  for (let i = 1; i <= PENDING; i += 1) {
    const company = companyIds[i % companyIds.length];
    const project = projectIds[i % projectIds.length];
    if (await insertIfAbsent('purchase_requisitions', 'pr_number', `DUMMY-PR${pad(i)}`,
      "INSERT INTO purchase_requisitions (pr_number, business_entity_id, company_id, project_id, request_date, department, requested_by, needed_by, status, notes) VALUES (?, ?, ?, ?, '2026-02-01', 'Operations', ?, '2026-03-01', 'submitted', ?)",
      [`DUMMY-PR${pad(i)}`, be, Number(company.id), Number(project.id), `Staff ${pad(i)}`, `Dummy PR ${pad(i)}`])) created += 1;
  }
  console.log(`Purchase requisitions (approval): ${created} new.`);
}

async function seedPendingPurchaseOrders(be, vendorIds, companyIds, projectIds) {
  let created = 0;
  for (let i = 1; i <= PENDING; i += 1) {
    const vendor = vendorIds[i % vendorIds.length];
    const company = companyIds[i % companyIds.length];
    const project = projectIds[i % projectIds.length];
    if (await insertIfAbsent('purchase_orders', 'po_number', `DUMMY-POP${pad(i)}`,
      "INSERT INTO purchase_orders (po_number, business_entity_id, vendor_id, company_id, project_id, po_date, delivery_date, total_amount, status, prepared_by) VALUES (?, ?, ?, ?, ?, '2026-02-05', '2026-02-20', ?, 'submitted', ?)",
      [`DUMMY-POP${pad(i)}`, be, Number(vendor), Number(company.id), Number(project.id), 15000 + i * 1000, `Staff ${pad(i)}`])) created += 1;
  }
  console.log(`Purchase orders (approval): ${created} new.`);
}

async function seedBills(be, vendorIds, projectIds) {
  let created = 0;
  for (let i = 1; i <= PENDING; i += 1) {
    const vendor = vendorIds[i % vendorIds.length];
    const project = projectIds[i % projectIds.length];
    if (await insertIfAbsent('accounts_payable', 'bill_number', `DUMMY-BILL${pad(i)}`,
      "INSERT INTO accounts_payable (business_entity_id, vendor_id, bill_number, bill_date, due_date, project_id, total_amount, status, approval_status, notes) VALUES (?, ?, ?, '2026-02-10', '2026-03-10', ?, ?, 'pending', 'pending', ?)",
      [be, Number(vendor), `DUMMY-BILL${pad(i)}`, Number(project.id), 8000 + i * 500, `Dummy bill ${pad(i)}`])) created += 1;
  }
  console.log(`Bills (approval): ${created} new.`);
}

// Each payment must link to exactly one ledger entry (bill for AP, invoice for AR).
async function seedPayments(billIds, arIds) {
  let created = 0;
  for (let i = 1; i <= PENDING; i += 1) {
    const isAp = i % 2 === 0;
    const linkCol = isAp ? 'ap_id' : 'ar_id';
    const linkId = isAp ? billIds[i % billIds.length] : arIds[i % arIds.length];
    if (!linkId) continue;
    if (await insertIfAbsent('payments', 'reference_number', `DUMMY-PAY${pad(i)}`,
      `INSERT INTO payments (payment_type, ${linkCol}, payment_date, amount, payment_method, reference_number, approval_status, notes) VALUES (?, ?, '2026-02-12', ?, 'cash', ?, 'pending', ?)`,
      [isAp ? 'ap' : 'ar', Number(linkId), 5000 + i * 250, `DUMMY-PAY${pad(i)}`, `Dummy ${isAp ? 'ap' : 'ar'} payment ${pad(i)}`])) created += 1;
  }
  console.log(`Payments (approval): ${created} new.`);
}

// Official AP bills (approved) with varied payment status, to populate the AP table.
async function seedApprovedBills(be, vendorIds, projectIds) {
  const statuses = ['unpaid', 'partial', 'paid', 'unpaid', 'overdue'];
  let created = 0;
  for (let i = 1; i <= 30; i += 1) {
    const vendor = vendorIds[i % vendorIds.length];
    const project = projectIds[i % projectIds.length];
    const total = 10000 + i * 750;
    const st = statuses[i % statuses.length];
    const paid = st === 'paid' ? total : (st === 'partial' ? Math.round(total / 2) : 0);
    if (await insertIfAbsent('accounts_payable', 'bill_number', `DUMMY-APB${pad(i)}`,
      "INSERT INTO accounts_payable (business_entity_id, vendor_id, bill_number, bill_date, due_date, project_id, total_amount, paid_amount, status, approval_status, notes) VALUES (?, ?, ?, '2026-01-15', '2026-02-15', ?, ?, ?, ?, 'approved', ?)",
      [be, Number(vendor), `DUMMY-APB${pad(i)}`, Number(project.id), total, paid, st, `Dummy AP bill ${pad(i)}`])) created += 1;
  }
  console.log(`AP bills (official): ${created} new.`);
}

// AR invoices with varied payment status, to populate the AR table.
async function seedAccountsReceivable(be) {
  const statuses = ['unpaid', 'partial', 'paid', 'unpaid', 'overdue'];
  let created = 0;
  for (let i = 1; i <= 30; i += 1) {
    const total = 12000 + i * 800;
    const st = statuses[i % statuses.length];
    const paid = st === 'paid' ? total : (st === 'partial' ? Math.round(total / 2) : 0);
    if (await insertIfAbsent('accounts_receivable', 'invoice_number', `DUMMY-AR${pad(i)}`,
      "INSERT INTO accounts_receivable (business_entity_id, customer_name, invoice_number, invoice_date, due_date, payment_terms, total_amount, paid_amount, status, notes) VALUES (?, ?, ?, '2026-01-20', '2026-02-20', 'Net 30', ?, ?, ?, ?)",
      [be, `Dummy Company ${pad((i % COUNT) + 1)}`, `DUMMY-AR${pad(i)}`, total, paid, st, `Dummy AR invoice ${pad(i)}`])) created += 1;
  }
  console.log(`AR invoices: ${created} new.`);
}

async function getOrCreate(selectSql, selectParams, insertSql, insertParams) {
  const found = await q(selectSql, selectParams);
  if (found.length) return Number(found[0].id);
  const res = await q(insertSql, insertParams);
  if (Number(res?.insertId || 0)) return Number(res.insertId);
  const again = await q(selectSql, selectParams);
  return again.length ? Number(again[0].id) : 0;
}

// Builds ONE fully-connected project so every link we wired is visible end-to-end:
// Customer + Vendor + Project -> Purchase Order -> Serial Units (in stock, source PO)
// -> Sales Order (line items) -> Delivery Receipt (line items, serials marked Sold).
async function seedConnectedScenario(be) {
  const customerId = await getOrCreate(
    'SELECT id FROM company_registry WHERE company_no = ?', ['DUMMY-CONN-C'],
    "INSERT INTO company_registry (company_no, business_entity_id, company_name, status, branch_code) VALUES (?, ?, ?, 'active', '000')",
    ['DUMMY-CONN-C', be, 'Connected Customer (Demo)']);
  const vendorId = await getOrCreate(
    'SELECT id FROM vendors WHERE vendor_no = ?', ['DUMMY-CONN-V'],
    'INSERT INTO vendors (vendor_no, business_entity_id, vendor_name, is_active) VALUES (?, ?, ?, true)',
    ['DUMMY-CONN-V', be, 'Connected Supplier (Demo)']);
  const warehouseId = await getOrCreate(
    'SELECT id FROM warehouses WHERE warehouse_code = ? AND business_entity_id = ?', ['DUMMY-CONN-WH', be],
    'INSERT INTO warehouses (business_entity_id, warehouse_code, warehouse_name, location, is_active) VALUES (?, ?, ?, ?, true)',
    [be, 'DUMMY-CONN-WH', 'Demo Warehouse', 'Demo Location']);

  const prodRows = await q("SELECT id, product_name FROM products WHERE sku IN ('DUMMY-P001','DUMMY-P002') ORDER BY sku ASC");
  if (prodRows.length < 2) throw new Error('Run the full seed first (needs DUMMY-P001/P002).');
  const p1 = Number(prodRows[0].id);
  const p2 = Number(prodRows[1].id);
  const n1 = prodRows[0].product_name;
  const n2 = prodRows[1].product_name;

  const projectId = await getOrCreate(
    'SELECT id FROM projects WHERE project_docno = ?', ['DUMMY-CONN-PRJ'],
    "INSERT INTO projects (project_docno, project_name, business_entity_id, company_id, company_name, description, start_date, end_date, status, service_type, budget, qty, unit_cost, downpayment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ongoing', 'maintenance', 250000, 0, 0, 0)",
    ['DUMMY-CONN-PRJ', 'Connected Project (Demo)', be, customerId, 'Connected Customer (Demo)', 'End-to-end demo with many procurement + sales', '2026-02-01', '2026-12-31']);

  const poId = await getOrCreate(
    'SELECT id FROM purchase_orders WHERE po_number = ?', ['DUMMY-CONN-PO'],
    "INSERT INTO purchase_orders (po_number, business_entity_id, vendor_id, company_id, project_id, po_date, total_amount, status, prepared_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', 'Seed')",
    ['DUMMY-CONN-PO', be, vendorId, customerId, projectId, '2026-02-05', 30000]);

  // Serial units received against the PO (6 units, 3 per product), in stock.
  for (let i = 1; i <= 6; i += 1) {
    const pid = i <= 3 ? p1 : p2;
    await q(
      "INSERT INTO product_units (business_entity_id, product_id, warehouse_id, serial_number, status, source_po_id, created_by) VALUES (?, ?, ?, ?, 'in_stock', ?, 'Seed') ON CONFLICT DO NOTHING",
      [be, pid, warehouseId, `DUMMY-CONN-SN${pad(i)}`, poId]);
  }

  const addItems = async (recordId, items) => {
    await q('DELETE FROM sales_record_items WHERE sales_record_id = ?', [recordId]);
    for (const it of items) {
      await q(
        'INSERT INTO sales_record_items (sales_record_id, product_id, warehouse_id, description, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [recordId, it.pid, warehouseId, it.name, it.qty, it.price, it.qty * it.price]);
    }
  };
  const lines = [{ pid: p1, name: n1, qty: 3, price: 2000 }, { pid: p2, name: n2, qty: 3, price: 1500 }];

  const soId = await getOrCreate(
    'SELECT id FROM sales_management_records WHERE document_no = ?', ['DUMMY-CONN-SO'],
    "INSERT INTO sales_management_records (record_type, document_no, business_entity_id, company_id, project_id, title, amount, status, requested_date, target_date) VALUES ('sales-order', ?, ?, ?, ?, ?, ?, 'approved', '2026-02-10', '2026-03-01')",
    ['DUMMY-CONN-SO', be, customerId, projectId, 'Connected SO (Demo)', 10500]);
  await addItems(soId, lines);

  const drId = await getOrCreate(
    'SELECT id FROM sales_management_records WHERE document_no = ?', ['DUMMY-CONN-DR'],
    "INSERT INTO sales_management_records (record_type, document_no, business_entity_id, company_id, project_id, warehouse_id, source_po_id, source_record_id, title, amount, status, requested_date, target_date) VALUES ('project-delivery', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'delivered', '2026-02-15', '2026-02-20')",
    ['DUMMY-CONN-DR', be, customerId, projectId, warehouseId, poId, soId, 'Connected DR (Demo)', 10500]);
  await addItems(drId, lines);

  // Mark 3 serials Sold and linked to this delivery + customer.
  await q(
    "UPDATE product_units SET sales_record_id = ?, status = 'sold', customer_name = ?, project_id = ? WHERE serial_number IN ('DUMMY-CONN-SN001','DUMMY-CONN-SN002','DUMMY-CONN-SN004')",
    [drId, 'Connected Customer (Demo)', projectId]);

  // Many more procurement + sales under the SAME project (different services), so
  // one project shows a full spread of records — not just one of each.
  const services = ['maintenance', 'repair', 'supply'];
  for (let k = 1; k <= 3; k += 1) {
    await insertIfAbsent('purchase_requisitions', 'pr_number', `DUMMY-CONN-PR${k}`,
      "INSERT INTO purchase_requisitions (pr_number, business_entity_id, company_id, project_id, request_date, requested_by, needed_by, status, notes) VALUES (?, ?, ?, ?, '2026-02-03', 'Seed', '2026-02-25', 'approved', ?)",
      [`DUMMY-CONN-PR${k}`, be, customerId, projectId, `Connected PR ${k} (${services[k - 1]})`]);
    await insertIfAbsent('purchase_orders', 'po_number', `DUMMY-CONN-PO${k}`,
      "INSERT INTO purchase_orders (po_number, business_entity_id, vendor_id, company_id, project_id, po_date, total_amount, status, prepared_by) VALUES (?, ?, ?, ?, ?, '2026-02-06', ?, 'approved', 'Seed')",
      [`DUMMY-CONN-PO${k}`, be, vendorId, customerId, projectId, 12000 * k]);
    const siId = await insertIfAbsent('sales_management_records', 'document_no', `DUMMY-CONN-SI${k}`,
      "INSERT INTO sales_management_records (record_type, document_no, business_entity_id, company_id, project_id, title, amount, status, requested_date, target_date) VALUES ('sales-request', ?, ?, ?, ?, ?, ?, 'approved', '2026-02-08', '2026-03-05')",
      [`DUMMY-CONN-SI${k}`, be, customerId, projectId, `Connected SI ${k} (${services[k - 1]})`, 8000 * k]);
    if (siId) await addItems(siId, lines);
  }

  console.log('Connected demo: project DUMMY-CONN-PRJ wired — 4 PO, 3 PR, 4 sales (SI/SO/DR), 6 serials [3 sold].');
}

async function main() {
  const clear = process.argv.includes('--clear');
  try {
    if (clear) {
      await clearAll();
      return;
    }
    const businessEntityId = await resolveBusinessEntityId();
    console.log(`Seeding into business entity #${businessEntityId}...\n`);
    await seedUsers();
    const companyIds = await seedCompanies(businessEntityId);
    await seedProducts(businessEntityId);
    const vendorIds = await seedVendors(businessEntityId);
    const projectIds = await seedProjects(businessEntityId, companyIds);
    await seedSalesRecords(businessEntityId, companyIds, projectIds);
    console.log('\n--- Approval Center (pending across all modules) ---');
    await seedPendingUsers();
    await seedRegistryRequests(businessEntityId);
    await seedInventoryRequests(businessEntityId);
    await seedRequisitions(businessEntityId, companyIds, projectIds);
    await seedPendingPurchaseOrders(businessEntityId, vendorIds, companyIds, projectIds);
    await seedBills(businessEntityId, vendorIds, projectIds);
    console.log('\n--- AP / AR ledgers ---');
    await seedApprovedBills(businessEntityId, vendorIds, projectIds);
    await seedAccountsReceivable(businessEntityId);
    const billRows = await q("SELECT id FROM accounts_payable WHERE bill_number LIKE 'DUMMY-%' ORDER BY id ASC");
    const arRows = await q("SELECT id FROM accounts_receivable WHERE invoice_number LIKE 'DUMMY-%' ORDER BY id ASC");
    await seedPayments(billRows.map((r) => Number(r.id)), arRows.map((r) => Number(r.id)));
    console.log('\n--- Connected demo ---');
    await seedConnectedScenario(businessEntityId);
    console.log('\nDone. Dummy login: any "dummy_userNNN" / password "Password123".');
  } catch (err) {
    console.error('\nSeed failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
