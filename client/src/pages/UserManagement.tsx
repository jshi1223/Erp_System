import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch } from '../lib/api';
import { useMe } from '../auth/auth';
import AppShell from '../components/AppShell';
import type { ManagedUser, UserRole } from '../types';

async function fetchUsers(): Promise<ManagedUser[]> {
  const { ok, data } = await apiGet<ManagedUser[]>('/api/admin/users');
  if (!ok || !Array.isArray(data)) throw new Error('Failed to load users');
  return data;
}

function roleLabel(r?: string) {
  return String(r || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || '-';
}

function ApproveModal({ user, canSuper, onClose }: { user: ManagedUser; canSuper: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [role, setRole] = useState<UserRole>('staff');
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState('');
  const privileged = role === 'admin' || role === 'super_admin';

  const mut = useMutation({
    mutationFn: async () => {
      const res = await apiPatch<{ error?: string }>(`/api/admin/users/${user.id}/approve`, { role, adminPassword });
      if (!res.ok) throw new Error(res.data?.error || 'Unable to approve user.');
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="rmodal-backdrop" onClick={onClose}>
      <div className="rmodal" onClick={(e) => e.stopPropagation()}>
        <div className="rmodal-head">
          <h3>Approve {user.fullname || user.username}</h3>
          <button className="rmodal-x" type="button" onClick={onClose}>×</button>
        </div>
        <div className="rmodal-body">
          <form onSubmit={(e) => { e.preventDefault(); setError(''); mut.mutate(); }}>
            <label className="rmodal-field">
              <span>Assign role</span>
              <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                <option value="staff">Staff</option>
                {canSuper && <option value="admin">Admin</option>}
                {canSuper && <option value="super_admin">Super Admin</option>}
              </select>
            </label>
            {canSuper && privileged && (
              <label className="rmodal-field">
                <span>Your admin password (required for privileged access)</span>
                <input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} autoComplete="current-password" />
              </label>
            )}
            {error && <div className="login-msg err">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-cancel btn-sm" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-save btn-sm" disabled={mut.isPending}>
                {mut.isPending ? 'Approving…' : 'Approve'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function UserManagementPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const canSuper = me?.role === 'super_admin';
  const [view, setView] = useState<'approvals' | 'users'>('approvals');
  const [approveUser, setApproveUser] = useState<ManagedUser | null>(null);
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin-users'], queryFn: fetchUsers });

  const reject = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiPatch<{ error?: string }>(`/api/admin/users/${id}/reject`, {});
      if (!res.ok) throw new Error(res.data?.error || 'Unable to reject user.');
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const all = data ?? [];
  const pending = useMemo(() => all.filter((u) => String(u.approval_status) === 'pending'), [all]);
  const rows = view === 'approvals' ? pending : all;

  return (
    <AppShell title="User Management" subtitle="Approve registered accounts and manage existing users.">
      <section className="module-summary-grid" aria-label="Summary">
        <article className="module-summary-card"><span className="module-summary-label">Pending</span><div className="module-summary-value">{pending.length}</div></article>
        <article className="module-summary-card"><span className="module-summary-label">Total Users</span><div className="module-summary-value">{all.length}</div></article>
        <article className="module-summary-card"><span className="module-summary-label">Active</span><div className="module-summary-value">{all.filter((u) => Number(u.active) !== 0).length}</div></article>
      </section>

      <div className="module-tabs">
        <button type="button" className={`module-tab${view === 'approvals' ? ' active' : ''}`} onClick={() => setView('approvals')}>
          Approving <span className="tab-count">{pending.length}</span>
        </button>
        <button type="button" className={`module-tab${view === 'users' ? ' active' : ''}`} onClick={() => setView('users')}>
          Users <span className="tab-count">{all.length}</span>
        </button>
      </div>

      {isLoading && <div className="state">Loading users…</div>}
      {isError && <div className="state err">Hindi ma-load ang users. Naka-login ka ba bilang admin?</div>}

      {!isLoading && !isError && (
        <div className="table-wrap">
          <table className="registry-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                {view === 'users' && <th>Approved By</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td className="strong">{u.fullname || u.username || '-'}</td>
                  <td>{u.email || '-'}</td>
                  <td>{roleLabel(u.role)}</td>
                  <td>
                    {String(u.approval_status) === 'pending' ? (
                      <span className="chip warn">Pending</span>
                    ) : Number(u.active) === 0 ? (
                      <span className="chip off">Inactive</span>
                    ) : (
                      <span className="chip on">Active</span>
                    )}
                  </td>
                  {view === 'users' && <td>{u.approved_by_fullname || u.approved_by_username || '-'}</td>}
                  <td className="row-actions">
                    {String(u.approval_status) === 'pending' && (
                      <>
                        <button className="btn btn-save btn-sm" onClick={() => setApproveUser(u)}>Approve</button>
                        <button className="btn btn-cancel btn-sm" disabled={reject.isPending} onClick={() => { if (confirm('Reject this account request?')) reject.mutate(u.id); }}>
                          Reject
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={view === 'users' ? 6 : 5} className="empty">
                    {view === 'approvals' ? 'Walang pending na approval.' : 'Walang user.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {approveUser && <ApproveModal user={approveUser} canSuper={canSuper} onClose={() => setApproveUser(null)} />}
    </AppShell>
  );
}
