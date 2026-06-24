import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut } from '../lib/api';
import AppShell from '../components/AppShell';
import type { Receivable, ArPayment } from '../types';

// React migration of the classic Accounts Receivable page (public/accounts-receivable/*).
// Same /api/receivables + /api/payments endpoints. Tabs: Invoices, Collections, Customer
// Balances, AR Aging, Documents. Add Invoice generates from a delivered Delivery Receipt
// (Sales Order flow, sales_record_id) — see [[sales-project-flow]] / [[transactions-legacy]].

const money = (n: number | undefined) =>
  'PHP ' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const todayStr = () => new Date().toISOString().split('T')[0];

function isArchived(r: Receivable) { return Number(r.archived) === 1 || r.archived === true; }
function balanceOf(r: Receivable) { return Math.max(0, Number(r.total_amount || 0) - Number(r.paid_amount || 0)); }

// Ported from accounts-receivable.js getReceivableStatus/getReceivableUiStatus.
function receivableStatus(r: Receivable): string {
  if (isArchived(r)) return 'cancelled';
  const total = Number(r.total_amount || 0);
  const paid = Number(r.paid_amount ?? 0);
  if (paid >= total && total > 0) return 'paid';
  if (paid > 0) return 'partial';
  if (r.status === 'overdue') return 'overdue';
  if (r.due_date) {
    const due = new Date(r.due_date); due.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (!Number.isNaN(due.getTime()) && due < today) return 'overdue';
  }
  return 'sent';
}
function uiStatus(r: Receivable): { label: string; className: string } {
  switch (receivableStatus(r)) {
    case 'paid': return { label: 'Paid', className: 'status-paid' };
    case 'partial': return { label: 'Partial', className: 'status-partial' };
    case 'overdue': return { label: 'Overdue', className: 'status-overdue' };
    case 'cancelled': return { label: 'Archived', className: 'status-cancelled' };
    default: return { label: 'Unpaid', className: 'status-unpaid' };
  }
}

async function fetchReceivables(): Promise<Receivable[]> {
  const { ok, data } = await apiGet<Receivable[]>('/api/receivables?include_archived=1');
  if (!ok || !Array.isArray(data)) throw new Error('Failed to load receivables');
  return data;
}
async function fetchCollections(): Promise<ArPayment[]> {
  const { ok, data } = await apiGet<ArPayment[]>('/api/payments?type=ar');
  if (!ok || !Array.isArray(data)) throw new Error('Failed to load collections');
  return data;
}

type Tab = 'invoices' | 'collections' | 'customer-balances' | 'ar-aging' | 'documents';
const TABS: { key: Tab; label: string }[] = [
  { key: 'invoices', label: 'Invoices' },
  { key: 'collections', label: 'Collections' },
  { key: 'customer-balances', label: 'Customer Balances' },
  { key: 'ar-aging', label: 'AR Aging' },
  { key: 'documents', label: 'Documents' },
];
function initialTab(): Tab {
  const t = new URLSearchParams(window.location.search).get('tab');
  return TABS.some((x) => x.key === t) ? (t as Tab) : 'invoices';
}

function Card({ label, value }: { label: string; value: string | number }) {
  return <article className="module-summary-card"><span className="module-summary-label">{label}</span><div className="module-summary-value">{value}</div></article>;
}

// ── Add Invoice (generate from a delivered Delivery Receipt) ──────────────────
interface DeliveryRow { id: number; document_no?: string; company_name?: string; amount?: number; project_name?: string; project_docno?: string; payment_terms?: string; status?: string; ar_invoice_number?: string; }
function AddInvoiceModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState('');
  const [msg, setMsg] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['ar-delivery-receipts'],
    queryFn: async () => {
      const { ok, data } = await apiGet<DeliveryRow[]>('/api/sales-management/records?type=project-delivery');
      if (!ok || !Array.isArray(data)) return [];
      return data.filter((r) => ['delivered', 'completed'].includes(String(r.status || '').toLowerCase())
        && !r.ar_invoice_number && Number(r.amount || 0) > 0 && String(r.company_name || '').trim());
    },
  });
  const rows = data ?? [];
  const sel = rows.find((r) => String(r.id) === picked);
  const mut = useMutation({
    mutationFn: async () => {
      const res = await apiPost<{ error?: string; invoice_number?: string }>(`/api/sales-management/records/${picked}/generate-invoice`, {});
      if (res.status === 409 && res.data?.invoice_number) return res.data;
      if (!res.ok) throw new Error(res.data?.error || 'Unable to generate invoice.');
      return res.data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['receivables'] }); onClose(); },
    onError: (e: Error) => setMsg(e.message),
  });
  return (
    <div className="rmodal-backdrop" onClick={onClose}>
      <div className="rmodal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="rmodal-head"><h3>Add AR Invoice</h3><button className="rmodal-x" type="button" onClick={onClose}>×</button></div>
        <div className="rmodal-body">
          <div className="form-field"><span>Sales Order / Delivery Receipt</span>
            <select value={picked} onChange={(e) => setPicked(e.target.value)}>
              <option value="">{isLoading ? 'Loading…' : (rows.length ? 'Select a delivered receipt…' : 'No delivered receipts ready to invoice')}</option>
              {rows.map((r) => <option key={r.id} value={r.id}>{`${r.document_no || 'DR'} — ${r.company_name} (${money(r.amount)})`}</option>)}
            </select>
          </div>
          {sel && (
            <div style={{ margin: '4px 0 10px', padding: '10px 12px', border: '1px solid #efe1dc', borderRadius: 8, background: '#faf8f5', fontSize: 13, lineHeight: 1.8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#837570' }}>Customer</span><strong>{sel.company_name}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#837570' }}>Project</span><strong>{sel.project_name || sel.project_docno || '—'}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#837570' }}>Amount</span><strong>{money(sel.amount)}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#837570' }}>Payment Terms</span><strong>{sel.payment_terms || 'Net 30'}</strong></div>
            </div>
          )}
          {msg && <div className="login-msg err">{msg}</div>}
          <div className="modal-actions">
            <button type="button" className="btn btn-cancel btn-sm" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-save btn-sm" disabled={!picked || mut.isPending} onClick={() => { setMsg(''); mut.mutate(); }}>{mut.isPending ? 'Generating…' : 'Generate Invoice'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Record Collection (AR payment) ───────────────────────────────────────────
function CollectionModal({ receivables, onClose }: { receivables: Receivable[]; onClose: () => void }) {
  const qc = useQueryClient();
  const open = receivables.filter((r) => !isArchived(r) && balanceOf(r) > 0);
  const [arId, setArId] = useState(() => (open[0] ? String(open[0].id) : ''));
  const sel = open.find((r) => String(r.id) === arId);
  const [form, setForm] = useState({ payment_date: todayStr(), amount: '', payment_method: 'cash', reference_number: '', notes: '' });
  const [msg, setMsg] = useState('');
  useEffect(() => { if (sel) setForm((f) => ({ ...f, amount: balanceOf(sel).toFixed(2) })); }, [arId]); // eslint-disable-line react-hooks/exhaustive-deps

  const mut = useMutation({
    mutationFn: async () => {
      const res = await apiPost<{ error?: string }>('/api/payments', {
        payment_type: 'ar', ar_id: Number(arId), payment_date: form.payment_date,
        amount: Number(form.amount), payment_method: form.payment_method,
        reference_number: form.reference_number, notes: form.notes,
      });
      if (!res.ok) throw new Error(res.data?.error || 'Unable to save payment.');
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ar-collections'] });
      qc.invalidateQueries({ queryKey: ['receivables'] });
      onClose();
    },
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <div className="rmodal-backdrop" onClick={onClose}>
      <div className="rmodal" onClick={(e) => e.stopPropagation()}>
        <div className="rmodal-head"><h3>Record Payment</h3><button className="rmodal-x" type="button" onClick={onClose}>×</button></div>
        <div className="rmodal-body">
          <form onSubmit={(e) => { e.preventDefault(); setMsg(''); mut.mutate(); }}>
            <div className="form-grid">
              <label className="form-field full"><span>Receivable</span>
                <select value={arId} onChange={(e) => setArId(e.target.value)} required>
                  <option value="">{open.length ? 'Select receivable…' : 'No open receivables'}</option>
                  {open.map((r) => <option key={r.id} value={r.id}>{`${r.invoice_number || `INV #${r.id}`} — ${r.customer_name || '-'} (${money(balanceOf(r))} due)`}</option>)}
                </select>
              </label>
              <label className="form-field"><span>Payment Date</span><input type="date" value={form.payment_date} onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))} required /></label>
              <label className="form-field"><span>Amount</span><input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required /></label>
              <label className="form-field"><span>Payment Method</span>
                <select value={form.payment_method} onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}>
                  <option value="cash">Cash</option><option value="check">Check</option><option value="bank_transfer">Bank Transfer</option><option value="credit_card">Credit Card</option>
                </select>
              </label>
              <label className="form-field"><span>Reference Number</span><input value={form.reference_number} onChange={(e) => setForm((f) => ({ ...f, reference_number: e.target.value }))} placeholder="OR / ref no." /></label>
              <label className="form-field full"><span>Notes</span><textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" /></label>
            </div>
            {msg && <div className="login-msg err">{msg}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel btn-sm" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-save btn-sm" disabled={!arId || mut.isPending}>{mut.isPending ? 'Saving…' : 'Save Payment'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function AccountsReceivablePage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [q, setQ] = useState('');
  const [addInvoice, setAddInvoice] = useState(false);
  const [collection, setCollection] = useState(false);
  const { data: recData, isLoading, isError } = useQuery({ queryKey: ['receivables'], queryFn: fetchReceivables });
  const { data: colData } = useQuery({ queryKey: ['ar-collections'], queryFn: fetchCollections });

  const receivables = recData ?? [];
  const collections = colData ?? [];

  const selectTab = (next: Tab) => {
    setTab(next); setQ('');
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
  };

  const archiveMut = useMutation({
    mutationFn: async ({ id, archive }: { id: number; archive: boolean }) => {
      const res = await apiPut<{ error?: string }>(`/api/receivables/${id}/${archive ? 'archive' : 'restore'}`, {});
      if (!res.ok) throw new Error(res.data?.error || 'Unable to update receivable.');
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['receivables'] }),
  });

  // Derived views
  const visibleInvoices = useMemo(() => {
    const term = q.trim().toLowerCase();
    return receivables.filter((r) => !term || [r.customer_name, r.invoice_number, r.payment_terms, r.project_docno, r.sales_document_no]
      .map((x) => String(x ?? '').toLowerCase()).some((s) => s.includes(term)));
  }, [receivables, q]);

  const customerBalances = useMemo(() => {
    const m = new Map<string, { customer_name: string; invoice_count: number; open_invoices: number; total_amount: number; paid_amount: number; balance: number; overdue: number }>();
    receivables.filter((r) => !isArchived(r)).forEach((r) => {
      const c = String(r.customer_name || 'Unassigned Customer').trim();
      const cur = m.get(c) || { customer_name: c, invoice_count: 0, open_invoices: 0, total_amount: 0, paid_amount: 0, balance: 0, overdue: 0 };
      const bal = balanceOf(r);
      cur.invoice_count += 1; cur.open_invoices += bal > 0 ? 1 : 0;
      cur.total_amount += Number(r.total_amount || 0); cur.paid_amount += Number(r.paid_amount || 0);
      cur.balance += bal; cur.overdue += r.due_date && r.due_date < todayStr() ? bal : 0;
      m.set(c, cur);
    });
    return Array.from(m.values()).sort((a, b) => b.balance - a.balance);
  }, [receivables]);

  const aging = useMemo(() => receivables.reduce((s, r) => {
    const bal = balanceOf(r);
    if (bal <= 0) return s;
    const due = new Date(r.due_date || ''); const now = new Date();
    if (Number.isNaN(due.getTime()) || due >= now) { s.current += bal; return s; }
    const days = Math.floor((now.getTime() - due.getTime()) / 86400000);
    if (days <= 30) s.d30 += bal; else if (days <= 60) s.d60 += bal; else if (days <= 90) s.d90 += bal; else s.over90 += bal;
    return s;
  }, { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 }), [receivables]);

  // Summary metrics
  const totalReceivable = receivables.filter((r) => !isArchived(r)).reduce((s, r) => s + balanceOf(r), 0);
  const overdueAmount = receivables.filter((r) => !isArchived(r) && r.due_date && r.due_date < todayStr()).reduce((s, r) => s + balanceOf(r), 0);
  const openCount = receivables.filter((r) => !['paid', 'cancelled'].includes(receivableStatus(r))).length;
  const collectionTotal = collections.reduce((s, c) => s + Number(c.amount || 0), 0);

  return (
    <AppShell title="Accounts Receivable" subtitle="Invoices, collections, customer balances, and AR aging.">
      <div className="module-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" className={`module-tab${tab === t.key ? ' active' : ''}`} aria-selected={tab === t.key} onClick={() => selectTab(t.key)}>{t.label}</button>
        ))}
      </div>

      <section className="module-summary-grid" aria-label="Summary">
        {tab === 'invoices' && <>
          <Card label="Outstanding" value={money(totalReceivable)} />
          <Card label="Open Invoices" value={openCount} />
          <Card label="Overdue" value={money(overdueAmount)} />
          <Card label="Paid" value={receivables.filter((r) => receivableStatus(r) === 'paid').length} />
        </>}
        {tab === 'collections' && <>
          <Card label="Collections" value={collections.length} />
          <Card label="Collected Total" value={money(collectionTotal)} />
          <Card label="Outstanding" value={money(totalReceivable)} />
        </>}
        {tab === 'customer-balances' && <>
          <Card label="Customers" value={customerBalances.length} />
          <Card label="With Balance" value={customerBalances.filter((c) => c.balance > 0).length} />
          <Card label="Total Balance" value={money(totalReceivable)} />
          <Card label="Overdue" value={money(overdueAmount)} />
        </>}
        {tab === 'ar-aging' && <>
          <Card label="Current" value={money(aging.current)} />
          <Card label="1–30 days" value={money(aging.d30)} />
          <Card label="31–60 days" value={money(aging.d60)} />
          <Card label="61–90 days" value={money(aging.d90)} />
          <Card label="Over 90" value={money(aging.over90)} />
        </>}
        {tab === 'documents' && <>
          <Card label="Documents" value={receivables.length} />
          <Card label="Invoices" value={receivables.length} />
        </>}
      </section>

      <div className="toolbar">
        {(tab === 'invoices') && <input className="search" placeholder="Search customer or invoice number…" value={q} onChange={(e) => setQ(e.target.value)} />}
        {tab === 'invoices' && <button className="btn btn-add btn-sm" onClick={() => setAddInvoice(true)}>+ Add Invoice</button>}
        {tab === 'collections' && <button className="btn btn-add btn-sm" onClick={() => setCollection(true)}>+ Record Collection</button>}
      </div>

      {isLoading && <div className="state">Loading…</div>}
      {isError && <div className="state err">Hindi ma-load ang Accounts Receivable.</div>}

      {!isLoading && !isError && tab === 'invoices' && (
        <div className="table-wrap">
          <table className="registry-table">
            <thead><tr><th>Invoice No.</th><th>Customer</th><th>Source Document</th><th>Invoice Date</th><th>Terms</th><th>Due Date</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {visibleInvoices.map((r) => {
                const archived = isArchived(r);
                const bal = balanceOf(r);
                const s = uiStatus(r);
                return (
                  <tr key={r.id}>
                    <td>{r.invoice_number || '-'}</td>
                    <td className="strong">{r.customer_name || '-'}</td>
                    <td>{r.sales_document_no ? `${r.sales_document_no} (Delivery Receipt)` : 'Manual'}</td>
                    <td>{r.invoice_date || '-'}</td>
                    <td>{r.payment_terms || '-'}</td>
                    <td>{r.due_date || '-'}</td>
                    <td>{money(r.total_amount)}</td>
                    <td>{money(r.paid_amount)}</td>
                    <td>{money(bal)}</td>
                    <td><span className={`status-pill ${s.className}`}>{s.label}</span></td>
                    <td className="row-actions">
                      {!archived && bal > 0 && <button className="btn btn-save btn-sm" onClick={() => setCollection(true)}>Record Payment</button>}
                      {archived
                        ? <button className="btn btn-sm" disabled={archiveMut.isPending} onClick={() => archiveMut.mutate({ id: r.id, archive: false })}>Restore</button>
                        : <button className="btn btn-cancel btn-sm" disabled={archiveMut.isPending} onClick={() => archiveMut.mutate({ id: r.id, archive: true })}>Archive</button>}
                    </td>
                  </tr>
                );
              })}
              {!visibleInvoices.length && <tr><td colSpan={11} className="empty">No receivables found.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && tab === 'collections' && (
        <div className="table-wrap">
          <table className="registry-table">
            <thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead>
            <tbody>
              {collections.map((c) => (
                <tr key={c.id}>
                  <td>{c.payment_date || '-'}</td>
                  <td>{c.invoice_number || (c.ar_id ? `AR #${c.ar_id}` : '-')}</td>
                  <td>{c.customer_name || '-'}</td>
                  <td>{String(c.payment_method || '-').replace(/_/g, ' ')}</td>
                  <td>{c.reference_number || '-'}</td>
                  <td>{money(c.amount)}</td>
                </tr>
              ))}
              {!collections.length && <tr><td colSpan={6} className="empty">No collections yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && tab === 'customer-balances' && (
        <div className="table-wrap">
          <table className="registry-table">
            <thead><tr><th>Customer</th><th>Invoices</th><th>Open</th><th>Total</th><th>Paid</th><th>Balance</th><th>Overdue</th></tr></thead>
            <tbody>
              {customerBalances.map((c) => (
                <tr key={c.customer_name}>
                  <td className="strong">{c.customer_name}</td>
                  <td>{c.invoice_count}</td>
                  <td>{c.open_invoices}</td>
                  <td>{money(c.total_amount)}</td>
                  <td>{money(c.paid_amount)}</td>
                  <td>{money(c.balance)}</td>
                  <td>{money(c.overdue)}</td>
                </tr>
              ))}
              {!customerBalances.length && <tr><td colSpan={7} className="empty">Walang customer balance.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && tab === 'ar-aging' && (
        <div className="table-wrap">
          <table className="registry-table">
            <thead><tr><th>Bucket</th><th>Amount</th></tr></thead>
            <tbody>
              <tr><td>Current (not due)</td><td>{money(aging.current)}</td></tr>
              <tr><td>1–30 days overdue</td><td>{money(aging.d30)}</td></tr>
              <tr><td>31–60 days overdue</td><td>{money(aging.d60)}</td></tr>
              <tr><td>61–90 days overdue</td><td>{money(aging.d90)}</td></tr>
              <tr><td>Over 90 days overdue</td><td>{money(aging.over90)}</td></tr>
              <tr><td className="strong">Total Outstanding</td><td className="strong">{money(aging.current + aging.d30 + aging.d60 + aging.d90 + aging.over90)}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && tab === 'documents' && (
        <div className="table-wrap">
          <table className="registry-table">
            <thead><tr><th>Type</th><th>Number</th><th>Party</th><th>Date</th><th>Status</th></tr></thead>
            <tbody>
              {receivables.map((r) => (
                <tr key={r.id}>
                  <td>Invoice</td>
                  <td>{r.invoice_number || `INV #${r.id}`}</td>
                  <td>{r.customer_name || '-'}</td>
                  <td>{r.invoice_date || '-'}</td>
                  <td><span className={`status-pill ${uiStatus(r).className}`}>{uiStatus(r).label}</span></td>
                </tr>
              ))}
              {!receivables.length && <tr><td colSpan={5} className="empty">Walang dokumento.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {addInvoice && <AddInvoiceModal onClose={() => setAddInvoice(false)} />}
      {collection && <CollectionModal receivables={receivables} onClose={() => setCollection(false)} />}
    </AppShell>
  );
}
