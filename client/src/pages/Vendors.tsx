import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut, apiPatch } from '../lib/api';
import { useMe } from '../auth/auth';
import type { Vendor } from '../types';

// React migration of the classic Vendor Directory (the Vendors tab of /master-data).
// Same /api/vendors endpoints (src/modules/master-data/vendors). Core CRUD + activate/deactivate.

async function fetchVendors(): Promise<Vendor[]> {
  const { ok, data } = await apiGet<Vendor[]>('/api/vendors?include_inactive=1');
  if (!ok || !Array.isArray(data)) throw new Error('Failed to load vendor directory');
  return data;
}

function isActive(v: Vendor): boolean {
  return Number(v.is_active) === 1 || v.is_active === true;
}

function initialDirectorySearch(): string {
  const params = new URLSearchParams(window.location.search || '');
  return (params.get('q') || params.get('search') || '').trim();
}

interface VendorForm {
  vendor_no: string;
  vendor_name: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  tin: string;
}

function emptyForm(v: Vendor | null): VendorForm {
  return {
    vendor_no: v?.vendor_no ?? '',
    vendor_name: v?.vendor_name ?? '',
    contact_person: v?.contact_person ?? '',
    email: v?.email ?? '',
    phone: v?.phone ?? '',
    address: v?.address ?? '',
    tin: v?.tin ?? '',
  };
}

export interface VendorDraftRef { id: number; payload: Partial<VendorForm>; }

export function VendorModal({ vendor, draft, onClose }: { vendor?: Vendor | null; draft?: VendorDraftRef; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isStaff = me?.role === 'staff';
  const isCreate = !vendor && !draft;
  const [form, setForm] = useState<VendorForm>(() => (draft ? { ...emptyForm(null), ...draft.payload } : emptyForm(vendor ?? null)));
  const [error, setError] = useState('');
  const field = (key: keyof VendorForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  // For a brand-new vendor, prefill the auto-generated number (staff: DFT- draft; admin: official).
  useEffect(() => {
    if (!isCreate) return;
    let cancelled = false;
    const url = isStaff ? '/api/vendor-registry-requests/next-draft-no' : '/api/vendors/next-no';
    apiGet<{ vendor_no?: string; draft_no?: string }>(url).then(({ ok, data }) => {
      const no = isStaff ? data?.draft_no : data?.vendor_no;
      if (!cancelled && ok && no) setForm((f) => ({ ...f, vendor_no: no }));
    });
    return () => { cancelled = true; };
  }, [isCreate, isStaff]);

  const mut = useMutation({
    mutationFn: async () => {
      const res = draft
        ? await apiPut<{ error?: string }>(`/api/vendor-registry-requests/${draft.id}`, form)
        : vendor
          ? await apiPut<{ error?: string }>(`/api/vendors/${vendor.id}`, form)
          : await apiPost<{ error?: string }>('/api/vendor-registry-requests', form);
      if (!res.ok) throw new Error(res.data?.error || 'Unable to save vendor.');
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendors'] });
      qc.invalidateQueries({ queryKey: ['vendor-registry-requests'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const heading = draft ? 'Edit Vendor Request' : vendor ? 'Edit Vendor' : (isStaff ? 'Request Vendor' : 'Register Vendor');
  const saveLabel = vendor ? 'Save' : draft ? 'Save Draft' : (isStaff ? 'Submit Request' : 'Add to Directory');

  return (
    <div className="rmodal-backdrop" onClick={onClose}>
      <div className="rmodal" onClick={(e) => e.stopPropagation()}>
        <div className="rmodal-head">
          <h3>{heading}</h3>
          <button className="rmodal-x" type="button" onClick={onClose}>×</button>
        </div>
        <div className="rmodal-body">
          <form onSubmit={(e) => { e.preventDefault(); setError(''); mut.mutate(); }}>
            <div className="form-grid">
              <label className="form-field"><span>Vendor No.</span><input value={form.vendor_no} readOnly placeholder="Auto-generated" /></label>
              <label className="form-field"><span>Vendor Name *</span><input value={form.vendor_name} onChange={field('vendor_name')} autoFocus placeholder="Vendor / supplier name" /></label>
              <label className="form-field"><span>Contact Person *</span><input value={form.contact_person} onChange={field('contact_person')} placeholder="Primary contact" /></label>
              <label className="form-field"><span>Email *</span><input type="email" value={form.email} onChange={field('email')} placeholder="Contact email" /></label>
              <label className="form-field"><span>Phone *</span><input value={form.phone} onChange={field('phone')} maxLength={11} inputMode="numeric" placeholder="11 digits, e.g. 09171234567" /></label>
              <label className="form-field"><span>TIN *</span><input value={form.tin} onChange={field('tin')} maxLength={15} inputMode="numeric" placeholder="000-000-000-000" /></label>
              <label className="form-field full"><span>Address *</span><input value={form.address} onChange={field('address')} placeholder="Complete address" /></label>
            </div>
            {error && <div className="login-msg err">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel btn-sm" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-save btn-sm" disabled={mut.isPending}>{mut.isPending ? 'Saving…' : saveLabel}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export function VendorsTab() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isStaff = me?.role === 'staff';
  const [q, setQ] = useState(initialDirectorySearch);
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; vendor: Vendor | null }>({ open: false, vendor: null });
  const { data, isLoading, isError } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors });

  const all = data ?? [];
  const activeCount = all.filter((v) => isActive(v)).length;
  const inactiveCount = all.filter((v) => !isActive(v)).length;
  const linkedCount = all.filter((v) => v.company_id).length;
  const activeRate = all.length ? Math.round((activeCount / all.length) * 100) : 0;

  const statusMut = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const res = await apiPatch<{ error?: string }>(`/api/vendors/${id}/status`, { is_active: active ? 1 : 0 });
      if (!res.ok) throw new Error(res.data?.error || 'Unable to update vendor.');
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all
      .filter((v) => (showInactive ? true : isActive(v)))
      .filter((v) => {
        if (!term) return true;
        return [v.vendor_no, v.vendor_name, v.contact_person, v.email, v.phone, v.tin, v.address]
          .map((x) => String(x ?? '').toLowerCase())
          .some((s) => s.includes(term));
      });
  }, [all, q, showInactive]);

  return (
    <>
      <section className="module-summary-grid" aria-label="Summary">
        <article className="module-summary-card"><span className="module-summary-label">Active Vendors</span><div className="module-summary-value">{activeCount}</div></article>
        <article className="module-summary-card"><span className="module-summary-label">Inactive Vendors</span><div className="module-summary-value">{inactiveCount}</div></article>
        <article className="module-summary-card"><span className="module-summary-label">Total Vendors</span><div className="module-summary-value">{all.length}</div></article>
        <article className="module-summary-card"><span className="module-summary-label">Linked to Company</span><div className="module-summary-value">{linkedCount}</div></article>
        <article className="module-summary-card"><span className="module-summary-label">Active Rate</span><div className="module-summary-value">{activeRate}%</div></article>
      </section>

      <div className="toolbar">
        <input className="search" placeholder="Search vendor no, name, or contact…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} style={{ width: 'auto' }} />
          <span style={{ margin: 0 }}>Show inactive</span>
        </label>
        <button className="btn btn-add btn-sm" onClick={() => setModal({ open: true, vendor: null })}>{isStaff ? '+ Request Vendor' : '+ Add Vendor'}</button>
      </div>

      {isLoading && <div className="state">Loading…</div>}
      {isError && <div className="state err">Hindi ma-load ang vendor directory.</div>}

      {!isLoading && !isError && (
        <div className="table-wrap">
          <table className="registry-table">
            <thead>
              <tr>
                <th>Vendor No.</th><th>Vendor Name</th><th>TIN</th>
                <th>Contact Person</th><th>Phone</th><th>Email</th><th>Address</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const active = isActive(v);
                return (
                  <tr key={v.id}>
                    <td>{v.vendor_no || '-'}</td>
                    <td className="strong">{v.vendor_name}</td>
                    <td>{v.tin || '-'}</td>
                    <td>{v.contact_person || '-'}</td>
                    <td>{v.phone || '-'}</td>
                    <td>{v.email || '-'}</td>
                    <td>{v.address || '-'}</td>
                    <td>{active ? <span className="chip on">Active</span> : <span className="chip off">Inactive</span>}</td>
                    <td className="row-actions">
                      <button className="btn btn-edit btn-sm" onClick={() => setModal({ open: true, vendor: v })}>Edit</button>
                      {active
                        ? <button className="btn btn-cancel btn-sm" disabled={statusMut.isPending} onClick={() => statusMut.mutate({ id: v.id, active: false })}>Deactivate</button>
                        : <button className="btn btn-sm" disabled={statusMut.isPending} onClick={() => statusMut.mutate({ id: v.id, active: true })}>Activate</button>}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={9} className="empty">Walang vendor record.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {modal.open && <VendorModal vendor={modal.vendor} onClose={() => setModal({ open: false, vendor: null })} />}
    </>
  );
}
