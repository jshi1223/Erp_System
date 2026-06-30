import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiGet, apiPost, apiPut } from '../lib/api';
import { digitsOnly, formatTin, isValidEmail } from '../lib/format';
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
  brand_color: string;
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
    brand_color: ((e as { brand_color?: string } | null)?.brand_color) || '#7a1f1f',
  };
}

// ── Realtime workspace theming (mirrors public/assets/js/workspace-switcher.js) ──────────────
// Lighten (+%) / darken (-%) a #rrggbb toward white/black.
function shadeHex(hex: string, percent: number): string {
  const h = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return hex;
  const t = percent < 0 ? 0 : 255, p = Math.abs(percent) / 100;
  const ch = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16);
    return Math.max(0, Math.min(255, Math.round((t - c) * p) + c));
  };
  return '#' + [ch(0), ch(2), ch(4)].map((x) => ('0' + x.toString(16)).slice(-2)).join('');
}

// Apply the brand color as the live workspace theme (CSS vars + persisted theme) WITHOUT a reload,
// so the header/UI re-colors the moment you save. Mirrors entityThemeColors + applyThemeVars.
function applyEntityThemeLive(entity: { id: number; brand_color?: string; company_name?: string }) {
  const c = /^#[0-9a-fA-F]{6}$/.test(String(entity.brand_color || '')) ? String(entity.brand_color) : '';
  const t = c
    ? { theme: 'entity', brand_color: c, primary: c, primaryLight: shadeHex(c, 38), primaryDark: shadeHex(c, -42), accent: c, accent2: shadeHex(c, -72) }
    : { theme: 'neutral', brand_color: '', primary: '#334155', primaryLight: '#64748b', primaryDark: '#1e293b', accent: '#475569', accent2: '#0f172a' };
  [document.documentElement, document.body].forEach((el) => {
    if (!el?.style) return;
    el.style.setProperty('--primary', t.primary);
    el.style.setProperty('--primary-light', t.primaryLight);
    el.style.setProperty('--primary-dark', t.primaryDark);
    el.style.setProperty('--accent', t.accent);
    el.style.setProperty('--accent2', t.accent2);
    if (el.dataset) el.dataset.businessEntityTheme = t.theme;
  });
  try {
    const tp = JSON.parse(localStorage.getItem('kinaadman_businessEntityTheme') || 'null') || {};
    Object.assign(tp, { theme: t.theme, brand_color: t.brand_color, primary: t.primary, primaryLight: t.primaryLight, primaryDark: t.primaryDark, accent: t.accent, accent2: t.accent2, company_name: entity.company_name || 'All Companies' });
    localStorage.setItem('kinaadman_businessEntityTheme', JSON.stringify(tp));
  } catch { /* ignore */ }
}

// The active workspace context: '' / 'all' = All Companies (ALWAYS neutral slate, never an entity
// color), otherwise a specific entity id.
function currentWorkspaceContext(): string {
  try { return String(localStorage.getItem('kinaadman_businessEntityContext') || '').trim().toLowerCase(); } catch { return ''; }
}

// Re-color the live workspace theme to match the CURRENT context (heals any stale/wrong theme):
// All Companies → neutral; a specific workspace → that entity's brand color.
function applyWorkspaceTheme(entities: BusinessEntity[]) {
  const ctx = currentWorkspaceContext();
  if (!ctx || ctx === 'all') { applyEntityThemeLive({ id: 0, brand_color: '', company_name: 'All Companies' }); return; }
  const active = entities.find((e) => String(e.id) === ctx);
  if (active) applyEntityThemeLive({ id: active.id, brand_color: (active as { brand_color?: string }).brand_color, company_name: active.company_name });
}

function EntityModal({ entity, onClose }: { entity: BusinessEntity | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<EntityForm>(() => emptyForm(entity));
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fe = (k: string) => errors[k] ? <small style={{ display: 'block', color: '#b91c1c', fontSize: '0.72rem', marginTop: 2 }}>{errors[k]}</small> : null;
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
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['business-entities'] });
      // Realtime (no refresh): re-color only what the CURRENT workspace shows. "All Companies" stays
      // neutral no matter which entity you edit; a specific workspace re-colors only when you edit
      // its OWN entity. Other entities just refresh their table swatch (via the invalidation above).
      const savedId = entity?.id ?? (data as { id?: number } | undefined)?.id ?? 0;
      const ctx = currentWorkspaceContext();
      if (!ctx || ctx === 'all') {
        applyEntityThemeLive({ id: 0, brand_color: '', company_name: 'All Companies' });
      } else if (savedId && ctx === String(savedId)) {
        applyEntityThemeLive({ id: savedId, brand_color: form.brand_color, company_name: form.company_name });
      }
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  // Mirrors the server: company name required; email/phone/TIN validated only if provided.
  // Per-field — each message shows under its own field; optional fields never get an error.
  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!form.company_name.trim()) e.company_name = 'Company name is required.';
    if (form.email.trim() && !isValidEmail(form.email)) e.email = 'Please enter a valid email address.';
    const phone = digitsOnly(form.phone, 11);
    if (phone && phone.length < 7) e.phone = 'Phone must be 7 to 11 digits.';
    const tin = digitsOnly(form.tin, 12);
    if (tin && tin.length !== 12) e.tin = 'TIN must follow 000-000-000-000 (12 digits).';
    return e;
  };

  return (
    <div className="rmodal-backdrop" onClick={onClose}>
      <div className="rmodal" onClick={(e) => e.stopPropagation()}>
        <div className="rmodal-head">
          <h3>{entity ? 'Edit Operating Company' : 'Add Operating Company'}</h3>
          <button className="rmodal-x" type="button" onClick={onClose}>×</button>
        </div>
        <div className="rmodal-body">
          <form onSubmit={(e) => { e.preventDefault(); const errs = validate(); setErrors(errs); if (Object.keys(errs).length) return; setError(''); mut.mutate(); }}>
            <div className="form-grid">
              <label className="form-field"><span>Entity code</span><input value={form.entity_code} onChange={field('entity_code')} placeholder="auto if blank" /></label>
              <label className="form-field"><span>Company name *</span><input value={form.company_name} onChange={field('company_name')} autoFocus />{fe('company_name')}</label>
              <label className="form-field"><span>Contact person</span><input value={form.contact_person} onChange={field('contact_person')} /></label>
              <label className="form-field"><span>Phone</span><input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: digitsOnly(e.target.value, 11) }))} maxLength={11} inputMode="numeric" placeholder="11 digits, e.g. 09171234567" />{fe('phone')}</label>
              <label className="form-field"><span>Email</span><input type="email" value={form.email} onChange={field('email')} />{fe('email')}</label>
              <label className="form-field"><span>TIN</span><input value={form.tin} onChange={(e) => setForm((f) => ({ ...f, tin: formatTin(e.target.value) }))} maxLength={15} inputMode="numeric" placeholder="000-000-000-000" />{fe('tin')}</label>
              <label className="form-field full"><span>Address</span><input value={form.address} onChange={field('address')} /></label>
              <label className="form-field"><span>Status</span>
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <label className="form-field"><span>Brand color</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(form.brand_color) ? form.brand_color : '#7a1f1f'} onChange={field('brand_color')} style={{ width: 46, height: 36, padding: 2, cursor: 'pointer' }} />
                  <span style={{ fontSize: '.78rem', color: 'var(--muted)' }}>Kulay ng PDF + header ng entity na ito</span>
                </span>
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

  // Self-heal the workspace theme whenever the entity list loads/changes: re-assert neutral for
  // "All Companies" (so a stale dark/black theme can't stick) or the active entity's current color.
  useEffect(() => {
    if (data) applyWorkspaceTheme(data);
  }, [data]);

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
                  <td className="strong">
                    <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', marginRight: 8, verticalAlign: 'middle', border: '1px solid rgba(0,0,0,.15)', background: ((e as { brand_color?: string }).brand_color) || '#7a1f1f' }} title="Brand color" />
                    {e.company_name}
                  </td>
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
