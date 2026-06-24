// One-off: wipe ALL transactional/business data, keeping ONLY user-management and
// system setup. Authorized clean-slate for the dev database.
//
//   KEEP: users, business_entities, chart_of_accounts, accounting_periods,
//         registration_email_verifications
//   WIPE: everything else (sales, procurement, AR/AP, inventory, projects,
//         companies/customers, vendors, transactions, payments, HR/payroll, logs)
//
// Uses TRUNCATE ... RESTART IDENTITY CASCADE inside a transaction so FK ordering /
// circular references are handled and identity counters reset. Guards the KEEP
// tables: if a cascade ever reaches them, the whole thing rolls back.
//
// Usage: node scripts/wipe-business-data.js
const { createPostgresAppPool } = require('../lib/db/postgres-app');

const KEEP = ['users', 'business_entities', 'chart_of_accounts', 'accounting_periods', 'registration_email_verifications'];
const WIPE = [
  'transactions', 'vendors', 'company_registry', 'company_registry_requests', 'vendor_registry_requests',
  'purchase_orders', 'po_line_items', 'products', 'warehouses', 'stock', 'stock_movements', 'product_units',
  'accounts_payable', 'sales_management_records', 'sales_record_items', 'accounts_receivable', 'payments',
  'documents', 'projects', 'system_logs', 'document_sequences', 'tasks', 'project_costs', 'project_resources',
  'journal_entries', 'journal_lines', 'purchase_requisitions', 'purchase_requisition_items', 'procurement_quotations',
  'goods_receipts', 'goods_receipt_items', 'inventory_requests', 'departments', 'employees',
  'payroll_periods', 'payroll_runs', 'payroll_run_lines', 'crm_leads', 'crm_contacts'
];

const countOf = async (conn, table) => {
  const rows = await conn.query(`SELECT count(*)::int AS n FROM "${table}"`);
  return rows[0].n;
};

(async () => {
  const pool = createPostgresAppPool();
  const conn = await new Promise((resolve, reject) =>
    pool.getConnection((err, c) => (err ? reject(err) : resolve(c))));
  try {
    const rows = await conn.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    const existing = new Set(rows.map((r) => r.table_name));
    const targets = WIPE.filter((t) => existing.has(t));
    const missing = WIPE.filter((t) => !existing.has(t));
    if (missing.length) console.log('Skipping (not present):', missing.join(', '));

    const illegal = targets.filter((t) => KEEP.includes(t));
    if (illegal.length) throw new Error('Refusing to wipe protected tables: ' + illegal.join(', '));

    // Snapshot KEEP counts so we can prove a cascade never touched them.
    const keepCounts = {};
    for (const t of KEEP) {
      if (existing.has(t)) keepCounts[t] = await countOf(conn, t);
    }

    const list = targets.map((t) => `"${t}"`).join(', ');
    console.log(`Truncating ${targets.length} tables...`);
    await conn.query('BEGIN');
    await conn.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

    for (const t of Object.keys(keepCounts)) {
      const after = await countOf(conn, t);
      if (after !== keepCounts[t]) {
        throw new Error(`Protected table "${t}" was affected by cascade (${keepCounts[t]} -> ${after}); rolling back.`);
      }
    }

    await conn.query('COMMIT');
    console.log(`✅ Wipe complete. Truncated ${targets.length} tables.`);
    console.log('   Kept intact:', Object.entries(keepCounts).map(([t, n]) => `${t}(${n})`).join(', '));
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => {});
    console.error('❌ Wipe failed (no changes committed):', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await new Promise((resolve) => pool.end(resolve));
  }
})();
