import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut } from '../lib/api';
import AppShell from '../components/AppShell';
import { useMe } from '../auth/auth';
import type { CompanyRegistry, CompanyOverview } from '../types';

// React migration of the classic Company Registry (public/company/*). Same /api/company-registry
// endpoints (now served by src/modules/master-data/company-registry). Core CRUD + archive/restore;
// the "Related Records" overview drawer and the staff drafts/approval workflow are added before
// the /master-data cut-over so nothing is left behind.

async function fetchCompanies(): Promise<CompanyRegistry[]> {
  const { ok, data } = await apiGet<CompanyRegistry[]>('/api/company-registry?include_archived=1');
  if (!ok || !Array.isArray(data)) throw new Error('Failed to load company registry');
  return data;
}

function isArchived(c: CompanyRegistry): boolean {
  return Number(c.archived) === 1 || c.archived === true;
}

function initialRegistrySearch(): string {
  const params = new URLSearchParams(window.location.search || '');
  return (params.get('q') || params.get('search') || '').trim();
}

interface CompanyForm {
  company_no: string;
  branch_code: string;
  company_name: string;
  address: string;
  contact_person: string;
  phone: string;
  email: string;
  tin: string;
  status: string;
  notes: string;
}

function emptyForm(c: CompanyRegistry | null): CompanyForm {
  return {
    company_no: c?.company_no ?? '',
    branch_code: c?.branch_code ?? '',
    company_name: c?.company_name ?? '',
    address: c?.address ?? '',
    contact_person: c?.contact_person ?? '',
    phone: c?.phone ?? '',
    email: c?.email ?? '',
    tin: c?.tin ?? '',
    status: c?.status ?? 'active',
    notes: c?.notes ?? '',
  };
}

export interface DraftRef { id: number; payload: Partial<CompanyForm>; }

export function CompanyModal({ company, draft, onClose }: { company?: CompanyRegistry | null; draft?: DraftRef; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isStaff = me?.role === 'staff';
  const isCreate = !company && !draft;
  const [form, setForm] = useState<CompanyForm>(() => (draft ? { ...emptyForm(null), ...draft.payload } : emptyForm(company ?? null)));
  const [error, setError] = useState('');
  const field = (key: keyof CompanyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  // For a brand-new record, prefill the auto-generated number (read-only, matches classic):
  // staff get a DFT- draft number, admins get the official next number.
  useEffect(() => {
    if (!isCreate) return;
    let cancelled = false;
    const url = isStaff ? '/api/company-registry-requests/next-draft-no' : '/api/company-registry/next-no';
    apiGet<{ company_no?: string; draft_no?: string }>(url).then(({ ok, data }) => {
      const no = isStaff ? data?.draft_no : data?.company_no;
      if (!cancelled && ok && no) setForm((f) => ({ ...f, company_no: no }));
    });
    return () => { cancelled = true; };
  }, [isCreate, isStaff]);

  const mut = useMutation({
    mutationFn: async () => {
      const res = draft
        ? await apiPut<{ error?: string }>(`/api/company-registry-requests/${draft.id}`, form)
        : company
          ? await apiPut<{ error?: string }>(`/api/company-registry/${company.id}`, form)
          : await apiPost<{ error?: string }>('/api/company-registry-requests', form);
      if (!res.ok) throw new Error(res.data?.error || 'Unable to save company.');
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-registry'] });
      qc.invalidateQueries({ queryKey: ['company-registry-requests'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const heading = draft ? 'Edit Company Request' : company ? 'Edit Company' : (isStaff ? 'Request Company' : 'Register Company');
  const saveLabel = company ? 'Save' : draft ? 'Save Draft' : (isStaff ? 'Submit Request' : 'Add to Registry');

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
              <label className="form-field"><span>Company No. *</span><input value={form.company_no} readOnly placeholder="Auto-generated" /></label>
              <label className="form-field"><span>Branch Code</span><input value={form.branch_code} onChange={field('branch_code')} maxLength={10} placeholder="Optional, e.g. BR-01" /></label>
              <label className="form-field full"><span>Company Name *</span><input value={form.company_name} onChange={field('company_name')} autoFocus placeholder="Company or client name" /></label>
              <label className="form-field full"><span>Address *</span><input value={form.address} onChange={field('address')} placeholder="Complete address" /></label>
              <label className="form-field"><span>Contact Person *</span><input value={form.contact_person} onChange={field('contact_person')} placeholder="Primary contact" /></label>
              <label className="form-field"><span>Phone *</span><input value={form.phone} onChange={field('phone')} maxLength={11} inputMode="numeric" placeholder="11 digits, e.g. 09171234567" /></label>
              <label className="form-field"><span>Email *</span><input type="email" value={form.email} onChange={field('email')} placeholder="Contact email" /></label>
              <label className="form-field"><span>TIN *</span><input value={form.tin} onChange={field('tin')} maxLength={15} inputMode="numeric" placeholder="000-000-000-000" /></label>
              <label className="form-field"><span>Status *</span>
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <label className="form-field full"><span>Notes</span><textarea rows={3} value={form.notes} onChange={field('notes')} placeholder="Optional notes" /></label>
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

function OverviewDrawer({ company, onClose }: { company: CompanyRegistry; onClose: () => void }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['company-overview', company.id],
    queryFn: async () => {
      const { ok, data } = await apiGet<CompanyOverview>(`/api/company-registry/${company.id}/overview`);
      if (!ok) throw new Error('Unable to load overview');
      return data;
    },
  });

  const vendorProfileMut = useMutation({
    mutationFn: async () => {
      const res = await apiPost<{ error?: string; already_exists?: boolean }>(`/api/company-registry/${company.id}/vendor-profile`, {});
      if (!res.ok) throw new Error(res.data?.error || 'Unable to create vendor profile.');
      return res.data;
    },
    onSuccess: (d) => {
      setMsg(d?.already_exists ? 'Vendor profile already exists.' : 'Vendor profile created.');
      qc.invalidateQueries({ queryKey: ['company-overview', company.id] });
      qc.invalidateQueries({ queryKey: ['company-registry'] });
      qc.invalidateQueries({ queryKey: ['vendors'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const c = data?.counts;
  const stat = (label: string, value: number) => (
    <article className="module-summary-card"><span className="module-summary-label">{label}</span><div className="module-summary-value">{value}</div></article>
  );

  return (
    <div className="rmodal-backdrop" onClick={onClose}>
      <div className="rmodal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="rmodal-head">
          <h3>Related Records — {company.company_name}</h3>
          <button className="rmodal-x" type="button" onClick={onClose}>×</button>
        </div>
        <div className="rmodal-body">
          {isLoading && <div className="state">Loading…</div>}
          {isError && <div className="state err">Hindi ma-load ang overview.</div>}
          {data && (
            <>
              <section className="module-summary-grid" aria-label="Related counts">
                {stat('Projects', c!.project_count)}
                {stat('Active', c!.active_project_count)}
                {stat('Completed', c!.completed_project_count)}
                {stat('Purchase Orders', c!.purchase_order_count)}
                {stat('Vendors', c!.vendor_count)}
                {stat('Receivables', c!.receivable_count)}
              </section>

              <div style={{ marginTop: 16 }}>
                <div className="form-field" style={{ marginBottom: 8 }}><span>Vendor Profile</span></div>
                {data.vendor_profile ? (
                  <div className="chip on">{data.vendor_profile.vendor_no || 'Vendor'} — {data.vendor_profile.vendor_name}</div>
                ) : (
                  <button className="btn btn-add btn-sm" disabled={vendorProfileMut.isPending} onClick={() => { setMsg(''); vendorProfileMut.mutate(); }}>
                    {vendorProfileMut.isPending ? 'Creating…' : '+ Create Vendor Profile'}
                  </button>
                )}
                {msg && <div className="state" style={{ marginTop: 8 }}>{msg}</div>}
              </div>

              <div style={{ marginTop: 16 }}>
                <div className="form-field" style={{ marginBottom: 8 }}><span>Recent Projects</span></div>
                {data.recent_projects.length ? (
                  <div className="table-wrap">
                    <table className="registry-table">
                      <thead><tr><th>Doc No.</th><th>Project</th><th>Status</th></tr></thead>
                      <tbody>
                        {data.recent_projects.map((p) => (
                          <tr key={p.id}>
                            <td>{p.project_docno || '-'}</td>
                            <td className="strong">{p.project_name || '-'}</td>
                            <td>{String(p.status || '-').replace(/_/g, ' ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty">Walang linked project.</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function CompaniesTab() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isStaff = me?.role === 'staff';
  const [q, setQ] = useState(initialRegistrySearch);
  const [showArchived, setShowArchived] = useState(false);
  const [modal, setModal] = useState<{ open: boolean; company: CompanyRegistry | null }>({ open: false, company: null });
  const [overview, setOverview] = useState<CompanyRegistry | null>(null);
  const { data, isLoading, isError } = useQuery({ queryKey: ['company-registry'], queryFn: fetchCompanies });

  const all = data ?? [];
  const activeCount = all.filter((c) => !isArchived(c)).length;
  const archivedCount = all.filter((c) => isArchived(c)).length;
  const operatingProfiles = all.filter((c) => c.vendor_profile_id).length;
  const activeRate = all.length ? Math.round((activeCount / all.length) * 100) : 0;

  const archiveMut = useMutation({
    mutationFn: async ({ id, archive }: { id: number; archive: boolean }) => {
      const res = await apiPut<{ error?: string }>(`/api/company-registry/${id}/${archive ? 'archive' : 'restore'}`, {});
      if (!res.ok) throw new Error(res.data?.error || 'Unable to update company.');
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['company-registry'] }),
  });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all
      .filter((c) => (showArchived ? true : !isArchived(c)))
      .filter((c) => {
        if (!term) return true;
        return [c.company_no, c.company_name, c.address, c.contact_person, c.email, c.phone, c.tin]
          .map((x) => String(x ?? '').toLowerCase())
          .some((s) => s.includes(term));
      });
  }, [all, q, showArchived]);

  return (
    <>
      <section className="module-summary-grid" aria-label="Summary">
        <article className="module-summary-card"><span className="module-summary-label">Active Companies</span><div className="module-summary-value">{activeCount}</div></article>
        <article className="module-summary-card"><span className="module-summary-label">Archived Companies</span><div className="module-summary-value">{archivedCount}</div></article>
        <article className="module-summary-card"><span className="module-summary-label">Total Companies</span><div className="module-summary-value">{all.length}</div></article>
        <article className="module-summary-card"><span className="module-summary-label">Operating Profiles</span><div className="module-summary-value">{operatingProfiles}</div></article>
        <article className="module-summary-card"><span className="module-summary-label">Active Rate</span><div className="module-summary-value">{activeRate}%</div></article>
      </section>

      <div className="toolbar">
        <input className="search" placeholder="Search company no, name, or address…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} style={{ width: 'auto' }} />
          <span style={{ margin: 0 }}>Show archived</span>
        </label>
        <button className="btn btn-add btn-sm" onClick={() => setModal({ open: true, company: null })}>{isStaff ? '+ Request Company' : '+ Add Company'}</button>
      </div>

      {isLoading && <div className="state">Loading…</div>}
      {isError && <div className="state err">Hindi ma-load ang company registry.</div>}

      {!isLoading && !isError && (
        <div className="table-wrap">
          <table className="registry-table">
            <thead>
              <tr>
                <th>Company No.</th><th>Branch Code</th><th>Company Name</th><th>TIN</th>
                <th>Contact Person</th><th>Phone</th><th>Email</th><th>Address</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const archived = isArchived(c);
                return (
                  <tr key={c.id}>
                    <td>{c.company_no || '-'}</td>
                    <td>{c.branch_code || '-'}</td>
                    <td className="strong">{c.company_name}</td>
                    <td>{c.tin || '-'}</td>
                    <td>{c.contact_person || '-'}</td>
                    <td>{c.phone || '-'}</td>
                    <td>{c.email || '-'}</td>
                    <td>{c.address || '-'}</td>
                    <td>{archived ? <span className="chip off">Archived</span> : (String(c.status) === 'inactive' ? <span className="chip off">Inactive</span> : <span className="chip on">Active</span>)}</td>
                    <td className="row-actions">
                      <button className="btn btn-sm" onClick={() => setOverview(c)}>Overview</button>
                      <button className="btn btn-edit btn-sm" onClick={() => setModal({ open: true, company: c })}>Edit</button>
                      {archived
                        ? <button className="btn btn-sm" disabled={archiveMut.isPending} onClick={() => archiveMut.mutate({ id: c.id, archive: false })}>Restore</button>
                        : <button className="btn btn-cancel btn-sm" disabled={archiveMut.isPending} onClick={() => archiveMut.mutate({ id: c.id, archive: true })}>Archive</button>}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={10} className="empty">Walang company record.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {modal.open && <CompanyModal company={modal.company} onClose={() => setModal({ open: false, company: null })} />}
      {overview && <OverviewDrawer company={overview} onClose={() => setOverview(null)} />}
    </>
  );
}

export default function CompanyRegistryPage() {
  return (
    <AppShell title="Master Data Management" subtitle="Maintain company master records used across procurement, projects, and finance.">
      <CompaniesTab />
    </AppShell>
  );
}
