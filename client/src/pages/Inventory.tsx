import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut } from '../lib/api';
import AppShell from '../components/AppShell';
import type { Product, Warehouse, StockRow, Movement } from '../types';

// React migration of the classic Inventory page (public/inventory/*). Same /api/inventory/*
// endpoints (src/modules/inventory). Tabs: Products, Warehouses, Stock Levels, Stock Movements.

const money = (n: number | undefined) =>
  'PHP ' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function entityCtx(): string {
  try { return String(localStorage.getItem('kinaadman_businessEntityContext') || 'all').trim() || 'all'; }
  catch { return 'all'; }
}
const beQuery = () => `business_entity_id=${encodeURIComponent(entityCtx())}`;

async function fetchList<T>(url: string): Promise<T[]> {
  const { ok, data } = await apiGet<T[]>(url);
  if (!ok || !Array.isArray(data)) throw new Error('Failed to load inventory data');
  return data;
}

// ── Product modal ────────────────────────────────────────────────────────────
interface ProductForm { sku: string; product_name: string; category: string; unit: string; reorder_level: string; unit_cost: string; selling_price: string; }
function ProductModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<ProductForm>(() => ({
    sku: product?.sku ?? '', product_name: product?.product_name ?? '', category: product?.category ?? '',
    unit: product?.unit ?? 'pcs', reorder_level: String(product?.reorder_level ?? 0),
    unit_cost: String(product?.unit_cost ?? 0), selling_price: String(product?.selling_price ?? 0),
  }));
  const [error, setError] = useState('');
  const f = (k: keyof ProductForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const mut = useMutation({
    mutationFn: async () => {
      const body = { ...form, business_entity_id: entityCtx(), reorder_level: Number(form.reorder_level || 0), unit_cost: Number(form.unit_cost || 0), selling_price: Number(form.selling_price || 0) };
      const res = product ? await apiPut<{ error?: string }>(`/api/inventory/products/${product.id}`, body) : await apiPost<{ error?: string }>('/api/inventory/products', body);
      if (!res.ok) throw new Error(res.data?.error || 'Unable to save product.');
      return res.data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inv-products'] }); qc.invalidateQueries({ queryKey: ['inv-stock'] }); onClose(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <div className="rmodal-backdrop" onClick={onClose}><div className="rmodal" onClick={(e) => e.stopPropagation()}>
      <div className="rmodal-head"><h3>{product ? 'Edit Product' : 'Add Product'}</h3><button className="rmodal-x" type="button" onClick={onClose}>×</button></div>
      <div className="rmodal-body"><form onSubmit={(e) => { e.preventDefault(); setError(''); mut.mutate(); }}>
        <div className="form-grid">
          <label className="form-field"><span>SKU</span><input value={form.sku} onChange={f('sku')} placeholder="Auto if blank" readOnly={!!product} /></label>
          <label className="form-field"><span>Product Name *</span><input value={form.product_name} onChange={f('product_name')} autoFocus /></label>
          <label className="form-field"><span>Category</span><input value={form.category} onChange={f('category')} /></label>
          <label className="form-field"><span>Unit</span><input value={form.unit} onChange={f('unit')} placeholder="pcs" /></label>
          <label className="form-field"><span>Reorder Level</span><input type="number" min="0" value={form.reorder_level} onChange={f('reorder_level')} /></label>
          <label className="form-field"><span>Unit Cost</span><input type="number" step="0.01" min="0" value={form.unit_cost} onChange={f('unit_cost')} /></label>
          <label className="form-field"><span>Selling Price</span><input type="number" step="0.01" min="0" value={form.selling_price} onChange={f('selling_price')} /></label>
        </div>
        {error && <div className="login-msg err">{error}</div>}
        <div className="modal-actions"><button type="button" className="btn btn-cancel btn-sm" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-save btn-sm" disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Save'}</button></div>
      </form></div>
    </div></div>
  );
}

// ── Warehouse modal ──────────────────────────────────────────────────────────
function WarehouseModal({ warehouse, onClose }: { warehouse: Warehouse | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ warehouse_code: warehouse?.warehouse_code ?? '', warehouse_name: warehouse?.warehouse_name ?? '', location: warehouse?.location ?? '' });
  const [error, setError] = useState('');
  const mut = useMutation({
    mutationFn: async () => {
      const body = { ...form, business_entity_id: entityCtx() };
      const res = warehouse ? await apiPut<{ error?: string }>(`/api/inventory/warehouses/${warehouse.id}`, body) : await apiPost<{ error?: string }>('/api/inventory/warehouses', body);
      if (!res.ok) throw new Error(res.data?.error || 'Unable to save warehouse.');
      return res.data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inv-warehouses'] }); onClose(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <div className="rmodal-backdrop" onClick={onClose}><div className="rmodal" onClick={(e) => e.stopPropagation()}>
      <div className="rmodal-head"><h3>{warehouse ? 'Edit Warehouse' : 'Add Warehouse'}</h3><button className="rmodal-x" type="button" onClick={onClose}>×</button></div>
      <div className="rmodal-body"><form onSubmit={(e) => { e.preventDefault(); setError(''); mut.mutate(); }}>
        <div className="form-grid">
          <label className="form-field"><span>Warehouse Code{warehouse ? ' *' : ''}</span><input value={form.warehouse_code} onChange={(e) => setForm((s) => ({ ...s, warehouse_code: e.target.value }))} placeholder={warehouse ? '' : 'Auto if blank'} /></label>
          <label className="form-field"><span>Warehouse Name *</span><input value={form.warehouse_name} onChange={(e) => setForm((s) => ({ ...s, warehouse_name: e.target.value }))} autoFocus /></label>
          <label className="form-field full"><span>Location</span><input value={form.location} onChange={(e) => setForm((s) => ({ ...s, location: e.target.value }))} /></label>
        </div>
        {error && <div className="login-msg err">{error}</div>}
        <div className="modal-actions"><button type="button" className="btn btn-cancel btn-sm" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-save btn-sm" disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Save'}</button></div>
      </form></div>
    </div></div>
  );
}

// ── Movement modal ───────────────────────────────────────────────────────────
function MovementModal({ products, warehouses, onClose }: { products: Product[]; warehouses: Warehouse[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ product_id: '', warehouse_id: '', movement_type: 'in', quantity: '', notes: '' });
  const [error, setError] = useState('');
  const mut = useMutation({
    mutationFn: async () => {
      const res = await apiPost<{ error?: string }>('/api/inventory/movements', {
        business_entity_id: entityCtx(), product_id: Number(form.product_id), warehouse_id: Number(form.warehouse_id),
        movement_type: form.movement_type, quantity: Number(form.quantity), notes: form.notes,
      });
      if (!res.ok) throw new Error(res.data?.error || 'Unable to save movement.');
      return res.data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inv-movements'] }); qc.invalidateQueries({ queryKey: ['inv-stock'] }); qc.invalidateQueries({ queryKey: ['inv-products'] }); onClose(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <div className="rmodal-backdrop" onClick={onClose}><div className="rmodal" onClick={(e) => e.stopPropagation()}>
      <div className="rmodal-head"><h3>Record Stock Movement</h3><button className="rmodal-x" type="button" onClick={onClose}>×</button></div>
      <div className="rmodal-body"><form onSubmit={(e) => { e.preventDefault(); setError(''); mut.mutate(); }}>
        <div className="form-grid">
          <label className="form-field full"><span>Product *</span>
            <select value={form.product_id} onChange={(e) => setForm((s) => ({ ...s, product_id: e.target.value }))} required>
              <option value="">Select product…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{[p.sku, p.product_name].filter(Boolean).join(' — ')}</option>)}
            </select>
          </label>
          <label className="form-field full"><span>Warehouse *</span>
            <select value={form.warehouse_id} onChange={(e) => setForm((s) => ({ ...s, warehouse_id: e.target.value }))} required>
              <option value="">Select warehouse…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{[w.warehouse_code, w.warehouse_name].filter(Boolean).join(' — ')}</option>)}
            </select>
          </label>
          <label className="form-field"><span>Type *</span>
            <select value={form.movement_type} onChange={(e) => setForm((s) => ({ ...s, movement_type: e.target.value }))}>
              <option value="in">Stock In</option><option value="out">Stock Out</option><option value="adjustment">Adjustment</option>
            </select>
          </label>
          <label className="form-field"><span>Quantity *</span><input type="number" min="1" step="1" value={form.quantity} onChange={(e) => setForm((s) => ({ ...s, quantity: e.target.value }))} required /></label>
          <label className="form-field full"><span>Notes</span><input value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} placeholder="Optional" /></label>
        </div>
        {error && <div className="login-msg err">{error}</div>}
        <div className="modal-actions"><button type="button" className="btn btn-cancel btn-sm" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-save btn-sm" disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Record'}</button></div>
      </form></div>
    </div></div>
  );
}

type Tab = 'products' | 'warehouses' | 'stock' | 'movements';
const TABS: { key: Tab; label: string }[] = [
  { key: 'products', label: 'Products' }, { key: 'warehouses', label: 'Warehouses' },
  { key: 'stock', label: 'Stock Levels' }, { key: 'movements', label: 'Stock Movements' },
];
function initialTab(): Tab {
  const t = new URLSearchParams(window.location.search).get('tab');
  return TABS.some((x) => x.key === t) ? (t as Tab) : 'products';
}
function Card({ label, value }: { label: string; value: string | number }) {
  return <article className="module-summary-card"><span className="module-summary-label">{label}</span><div className="module-summary-value">{value}</div></article>;
}

export default function InventoryPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [q, setQ] = useState('');
  const [prodModal, setProdModal] = useState<{ open: boolean; product: Product | null }>({ open: false, product: null });
  const [whModal, setWhModal] = useState<{ open: boolean; warehouse: Warehouse | null }>({ open: false, warehouse: null });
  const [moveModal, setMoveModal] = useState(false);

  const products = useQuery({ queryKey: ['inv-products'], queryFn: () => fetchList<Product>(`/api/inventory/products?${beQuery()}`) });
  const warehouses = useQuery({ queryKey: ['inv-warehouses'], queryFn: () => fetchList<Warehouse>(`/api/inventory/warehouses?${beQuery()}`) });
  const stock = useQuery({ queryKey: ['inv-stock'], queryFn: () => fetchList<StockRow>(`/api/inventory/stock?${beQuery()}`), enabled: tab === 'stock' });
  const movements = useQuery({ queryKey: ['inv-movements'], queryFn: () => fetchList<Movement>(`/api/inventory/movements?${beQuery()}`), enabled: tab === 'movements' });

  const selectTab = (next: Tab) => {
    setTab(next); setQ('');
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
  };

  const archiveProduct = useMutation({
    mutationFn: async (id: number) => { const r = await apiPost<{ error?: string }>(`/api/inventory/products/${id}/archive`, {}); if (!r.ok) throw new Error(r.data?.error || 'Unable to archive.'); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inv-products'] }); qc.invalidateQueries({ queryKey: ['inv-stock'] }); },
  });
  const archiveWarehouse = useMutation({
    mutationFn: async (id: number) => { const r = await apiPost<{ error?: string }>(`/api/inventory/warehouses/${id}/archive`, {}); if (!r.ok) throw new Error(r.data?.error || 'Unable to archive.'); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inv-warehouses'] }),
  });

  const prodRows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (products.data ?? []).filter((p) => !term || [p.sku, p.product_name, p.category].map((x) => String(x ?? '').toLowerCase()).some((s) => s.includes(term)));
  }, [products.data, q]);
  const whRows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (warehouses.data ?? []).filter((w) => !term || [w.warehouse_code, w.warehouse_name, w.location].map((x) => String(x ?? '').toLowerCase()).some((s) => s.includes(term)));
  }, [warehouses.data, q]);
  const stockRows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (stock.data ?? []).filter((s) => !term || [s.sku, s.product_name, s.warehouse_name].map((x) => String(x ?? '').toLowerCase()).some((v) => v.includes(term)));
  }, [stock.data, q]);
  const moveRows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (movements.data ?? []).filter((m) => !term || [m.sku, m.product_name, m.warehouse_name, m.movement_type].map((x) => String(x ?? '').toLowerCase()).some((v) => v.includes(term)));
  }, [movements.data, q]);

  const allProducts = products.data ?? [];
  const lowStock = (stock.data ?? []).filter((s) => Number(s.quantity_on_hand || 0) <= Number(s.reorder_level || 0) && Number(s.reorder_level || 0) > 0).length;
  const inventoryValue = allProducts.reduce((sum, p) => sum + Number(p.quantity_on_hand || 0) * Number(p.unit_cost || 0), 0);

  return (
    <AppShell title="Inventory Management" subtitle="Products, warehouses, stock levels, and stock movements.">
      <div className="module-tabs" role="tablist">
        {TABS.map((t) => <button key={t.key} type="button" role="tab" className={`module-tab${tab === t.key ? ' active' : ''}`} aria-selected={tab === t.key} onClick={() => selectTab(t.key)}>{t.label}</button>)}
      </div>

      <section className="module-summary-grid" aria-label="Summary">
        {tab === 'products' && <><Card label="Products" value={allProducts.length} /><Card label="Inventory Value" value={money(inventoryValue)} /><Card label="Categories" value={new Set(allProducts.map((p) => p.category).filter(Boolean)).size} /></>}
        {tab === 'warehouses' && <><Card label="Warehouses" value={(warehouses.data ?? []).length} /></>}
        {tab === 'stock' && <><Card label="Stock Records" value={(stock.data ?? []).length} /><Card label="Low Stock" value={lowStock} /></>}
        {tab === 'movements' && <><Card label="Movements" value={(movements.data ?? []).length} /></>}
      </section>

      <div className="toolbar">
        <input className="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        {tab === 'products' && <button className="btn btn-add btn-sm" onClick={() => setProdModal({ open: true, product: null })}>+ Add Product</button>}
        {tab === 'warehouses' && <button className="btn btn-add btn-sm" onClick={() => setWhModal({ open: true, warehouse: null })}>+ Add Warehouse</button>}
        {tab === 'movements' && <button className="btn btn-add btn-sm" onClick={() => setMoveModal(true)}>+ Record Movement</button>}
      </div>

      {tab === 'products' && (
        <div className="table-wrap"><table className="registry-table">
          <thead><tr><th>SKU</th><th>Product</th><th>Category</th><th>Unit</th><th>On Hand</th><th>Reorder</th><th>Unit Cost</th><th>Selling Price</th><th>Actions</th></tr></thead>
          <tbody>
            {products.isLoading ? <tr><td colSpan={9} className="empty">Loading…</td></tr> : prodRows.map((p) => (
              <tr key={p.id}>
                <td>{p.sku || '-'}</td><td className="strong">{p.product_name}</td><td>{p.category || '-'}</td><td>{p.unit || '-'}</td>
                <td>{Number(p.quantity_on_hand || 0)}</td><td>{Number(p.reorder_level || 0)}</td><td>{money(p.unit_cost)}</td><td>{money(p.selling_price)}</td>
                <td className="row-actions">
                  <button className="btn btn-edit btn-sm" onClick={() => setProdModal({ open: true, product: p })}>Edit</button>
                  <button className="btn btn-cancel btn-sm" disabled={archiveProduct.isPending} onClick={() => archiveProduct.mutate(p.id)}>Archive</button>
                </td>
              </tr>
            ))}
            {!products.isLoading && !prodRows.length && <tr><td colSpan={9} className="empty">Walang produkto.</td></tr>}
          </tbody>
        </table></div>
      )}

      {tab === 'warehouses' && (
        <div className="table-wrap"><table className="registry-table">
          <thead><tr><th>Code</th><th>Warehouse</th><th>Location</th><th>Actions</th></tr></thead>
          <tbody>
            {warehouses.isLoading ? <tr><td colSpan={4} className="empty">Loading…</td></tr> : whRows.map((w) => (
              <tr key={w.id}>
                <td>{w.warehouse_code || '-'}</td><td className="strong">{w.warehouse_name}</td><td>{w.location || '-'}</td>
                <td className="row-actions">
                  <button className="btn btn-edit btn-sm" onClick={() => setWhModal({ open: true, warehouse: w })}>Edit</button>
                  <button className="btn btn-cancel btn-sm" disabled={archiveWarehouse.isPending} onClick={() => archiveWarehouse.mutate(w.id)}>Archive</button>
                </td>
              </tr>
            ))}
            {!warehouses.isLoading && !whRows.length && <tr><td colSpan={4} className="empty">Walang warehouse.</td></tr>}
          </tbody>
        </table></div>
      )}

      {tab === 'stock' && (
        <div className="table-wrap"><table className="registry-table">
          <thead><tr><th>Product</th><th>SKU</th><th>Warehouse</th><th>On Hand</th><th>Reorder</th><th>Status</th></tr></thead>
          <tbody>
            {stock.isLoading ? <tr><td colSpan={6} className="empty">Loading…</td></tr> : stockRows.map((s) => {
              const low = Number(s.quantity_on_hand || 0) <= Number(s.reorder_level || 0) && Number(s.reorder_level || 0) > 0;
              return (
                <tr key={s.id}>
                  <td className="strong">{s.product_name || '-'}</td><td>{s.sku || '-'}</td><td>{s.warehouse_name || '-'}</td>
                  <td>{Number(s.quantity_on_hand || 0)}</td><td>{Number(s.reorder_level || 0)}</td>
                  <td>{low ? <span className="chip off">Low Stock</span> : <span className="chip on">OK</span>}</td>
                </tr>
              );
            })}
            {!stock.isLoading && !stockRows.length && <tr><td colSpan={6} className="empty">Walang stock record.</td></tr>}
          </tbody>
        </table></div>
      )}

      {tab === 'movements' && (
        <div className="table-wrap"><table className="registry-table">
          <thead><tr><th>Date</th><th>Type</th><th>Product</th><th>Warehouse</th><th>Qty</th><th>Reference</th></tr></thead>
          <tbody>
            {movements.isLoading ? <tr><td colSpan={6} className="empty">Loading…</td></tr> : moveRows.map((m) => (
              <tr key={m.id}>
                <td>{m.movement_date ? String(m.movement_date).slice(0, 10) : '-'}</td>
                <td><span className={`chip ${m.movement_type === 'out' ? 'off' : 'on'}`}>{String(m.movement_type || '-')}</span></td>
                <td className="strong">{m.product_name || '-'}</td><td>{m.warehouse_name || '-'}</td><td>{Number(m.quantity || 0)}</td>
                <td>{m.project_docno || m.reference_no || '-'}</td>
              </tr>
            ))}
            {!movements.isLoading && !moveRows.length && <tr><td colSpan={6} className="empty">Walang stock movement.</td></tr>}
          </tbody>
        </table></div>
      )}

      {prodModal.open && <ProductModal product={prodModal.product} onClose={() => setProdModal({ open: false, product: null })} />}
      {whModal.open && <WarehouseModal warehouse={whModal.warehouse} onClose={() => setWhModal({ open: false, warehouse: null })} />}
      {moveModal && <MovementModal products={allProducts} warehouses={warehouses.data ?? []} onClose={() => setMoveModal(false)} />}
    </AppShell>
  );
}
