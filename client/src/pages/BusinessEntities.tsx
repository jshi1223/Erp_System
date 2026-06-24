import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiGet, apiPost, apiPut } from '../lib/api';
import AppShell from '../components/AppShell';
import type { BusinessEntity } from '../types';

async function fetchEntities(): Promise<BusinessEntity[]> {
  const { ok, data } = await apiGet<BusinessEntity[]>('/api/business-entities?include_inactive=1');
  if (!ok || !Array.isArray(data)) throw new Error('Failed to load operating companies');
  return data;
}

interface EntityForm {
  entity_code: string;
  company_name: string;
  contact_person: string;
  phone: string;
  email: string;
  tin: string;
  address: string;
  status: string;
  is_default: boolean;
}

function emptyForm(e: BusinessEntity | null): EntityForm {
  return {
    entity_code: e?.entity_code ?? '',
    company_name: e?.company_name ?? '',
    contact_person: e?.contact_person ?? '',
    phone: e?.phone ?? '',
    email: e?.email ?? '',
    tin: e?.tin ?? '',
    address: e?.address ?? '',
    status: e?.status ?? 'active',
    is_default: Number(e?.is_default) === 1 || e?.is_default === true,
  };
}

function EntityModal({ entity, onClose }: { entity: BusinessEntity | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<EntityForm>(() => emptyForm(entity));
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const field = (key: keyof EntityForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const mut = useMutation({
    mutationFn: async () => {
      const res = entity
        ? await apiPut<{ error?: string; id?: number }>(`/api/business-entities/${entity.id}`, form)
        : await apiPost<{ error?: string; id?: number }>('/api/business-entities', form);
      if (!res.ok) throw new Error(res.data?.error || 'Unable to save operating company.');
      const id = entity?.id ?? res.data?.id;
      if (logoFile && id) {
        const fd = new FormData();
        fd.append('logo', logoFile);
        const logoRes = await apiFetch(`/api/business-entities/${id}/logo`, { method: 'POST', body: fd });
        if (!logoRes.ok) throw new Error('Saved, but logo upload failed.');
      }
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['business-entities'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="rmodal-backdrop" onClick={onClose}>
      <div className="rmodal" onClick={(e) => e.stopPropagation()}>
        <div className="rmodal-head">
          <h3>{entity ? 'Edit Operating Company' : 'Add Operating Company'}</h3>
          <button className="rmodal-x" type="button" onClick={onClose}>×</button>
        </div>
        <div className="rmodal-body">
          <form onSubmit={(e) => { e.preventDefault(); setError(''); mut.mutate(); }}>
            <div className="form-grid">
              <label className="form-field"><span>Entity code</span><input value={form.entity_code} onChange={field('entity_code')} placeholder="auto if blank" /></label>
              <label className="form-field"><span>Company name *</span><input value={form.company_name} onChange={field('company_name')} autoFocus /></label>
              <label className="form-field"><span>Contact person</span><input value={form.contact_person} onChange={field('contact_person')} /></label>
              <label className="form-field"><span>Phone</span><input value={form.phone} onChange={field('phone')} /></label>
              <label className="form-field"><span>Email</span><input type="email" value={form.email} onChange={field('email')} /></label>
              <label className="form-field"><span>TIN</span><input value={form.tin} onChange={field('tin')} placeholder="000-000-000-000" /></label>
              <label className="form-field full"><span>Address</span><input value={form.address} onChange={field('address')} /></label>
              <label className="form-field"><span>Status</span>
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <label className="form-field" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 22 }}>
                <input type="checkbox" checked={form.is_default} onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))} style={{ width: 'auto' }} />
                <span style={{ margin: 0 }}>Default workspace</span>
              </label>
              <label className="form-field full"><span>Logo {entity?.logo_path ? '(replace)' : ''}</span><input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} /></label>
            </div>
            {error && <div className="login-msg err">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel btn-sm" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-save btn-sm" disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function BusinessEntitiesPage() {
  const [q, setQ] = useState('');
  const [modal, setModal] = useState<{ open: boolean; entity: BusinessEntity | null }>({ open: false, entity: null });
  const { data, isLoading, isError } = useQuery({ queryKey: ['business-entities'], queryFn: fetchEntities });

  const all = data ?? [];
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return all;
    return all.filter((e) =>
      [e.entity_code, e.company_name, e.contact_person, e.email, e.phone, e.tin]
        .map((x) => String(x ?? '').toLowerCase())
        .some((s) => s.includes(term)),
    );
  }, [all, q]);

  return (
    <AppShell title="Operating Companies" subtitle="Manage business entities (workspaces), branding, and defaults.">
      <section className="module-summary-grid" aria-label="Summary">
        <article className="module-summary-card"><span className="module-summary-label">Companies</span><div className="module-summary-value">{all.length}</div></article>
        <article className="module-summary-card"><span className="module-summary-label">Active</span><div className="module-summary-value">{all.filter((e) => String(e.status) !== 'inactive').length}</div></article>
      </section>

      <div className="toolbar">
        <input className="search" placeholder="Search code, company, contact…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-add btn-sm" onClick={() => setModal({ open: true, entity: null })}>+ Add Company</button>
      </div>

      {isLoading && <div className="state">Loading…</div>}
      {isError && <div className="state err">Hindi ma-load. Super-admin lang ang pwede dito.</div>}

      {!isLoading && !isError && (
        <div className="table-wrap">
          <table className="registry-table">
            <thead>
              <tr><th>Code</th><th>Company</th><th>Contact</th><th>Phone</th><th>Email</th><th>Status</th><th>Default</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>{e.entity_code || '-'}</td>
                  <td className="strong">{e.company_name}</td>
                  <td>{e.contact_person || '-'}</td>
                  <td>{e.phone || '-'}</td>
                  <td>{e.email || '-'}</td>
                  <td>{String(e.status) === 'inactive' ? <span className="chip off">Inactive</span> : <span className="chip on">Active</span>}</td>
                  <td>{Number(e.is_default) === 1 || e.is_default === true ? <span className="chip on">Default</span> : '-'}</td>
                  <td className="row-actions">
                    <button className="btn btn-edit btn-sm" onClick={() => setModal({ open: true, entity: e })}>Edit</button>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="empty">Walang operating company.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {modal.open && <EntityModal entity={modal.entity} onClose={() => setModal({ open: false, entity: null })} />}
    </AppShell>
  );
}
