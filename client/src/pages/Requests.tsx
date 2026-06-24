import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../lib/api';
import { useMe } from '../auth/auth';
import { CompanyModal, type DraftRef } from './CompanyRegistry';
import { VendorModal, type VendorDraftRef } from './Vendors';

// Master Data drafts/approval workflow (Companies + Vendors requests). Staff create DFT- drafts,
// submit for review; admins approve / reject / return-for-revision. Same /api/*-registry-requests
// endpoints (src/modules/master-data). See [[draft-official-docno-rule]].

type Kind = 'company' | 'vendor';

interface RegistryRequest {
  id: number;
  request_no?: string;
  payload: Record<string, string>;
  status: string;
  requested_by?: string;
  requested_by_email?: string;
  submitted_at?: string;
  created_at?: string;
  approved_by?: string;
  reject_reason?: string;
}

interface Row extends RegistryRequest { kind: Kind; }

const ENDPOINT: Record<Kind, string> = {
  company: '/api/company-registry-requests',
  vendor: '/api/vendor-registry-requests',
};

async function fetchRequests(kind: Kind): Promise<RegistryRequest[]> {
  const { ok, data } = await apiGet<RegistryRequest[]>(ENDPOINT[kind]);
  if (!ok || !Array.isArray(data)) return [];
  return data;
}

function statusChip(status: string) {
  const s = String(status || '').toLowerCase();
  if (s === 'approved') return <span className="chip on">Approved</span>;
  if (s === 'rejected') return <span className="chip off">Rejected</span>;
  if (s === 'needs_revision') return <span className="chip off">Needs Revision</span>;
  if (s === 'submitted') return <span className="chip">Submitted</span>;
  return <span className="chip">Draft</span>;
}

function rowName(r: Row): string {
  return String(r.payload?.company_name || r.payload?.vendor_name || '-');
}

export function RequestsTab() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isStaff = me?.role === 'staff';
  const [edit, setEdit] = useState<{ kind: Kind; draft: DraftRef | VendorDraftRef } | null>(null);

  const companyQ = useQuery({ queryKey: ['company-registry-requests'], queryFn: () => fetchRequests('company') });
  const vendorQ = useQuery({ queryKey: ['vendor-registry-requests'], queryFn: () => fetchRequests('vendor') });

  const rows: Row[] = useMemo(() => {
    const c = (companyQ.data ?? []).map((r) => ({ ...r, kind: 'company' as Kind }));
    const v = (vendorQ.data ?? []).map((r) => ({ ...r, kind: 'vendor' as Kind }));
    return [...c, ...v].sort((a, b) =>
      String(b.submitted_at || b.created_at || '').localeCompare(String(a.submitted_at || a.created_at || '')));
  }, [companyQ.data, vendorQ.data]);

  const invalidate = (kind: Kind) => {
    qc.invalidateQueries({ queryKey: [kind === 'company' ? 'company-registry-requests' : 'vendor-registry-requests'] });
    qc.invalidateQueries({ queryKey: [kind === 'company' ? 'company-registry' : 'vendors'] });
  };

  const action = useMutation({
    mutationFn: async ({ kind, id, verb, reason }: { kind: Kind; id: number; verb: 'submit' | 'approve' | 'reject' | 'revise'; reason?: string }) => {
      const res = await apiPost<{ error?: string }>(`${ENDPOINT[kind]}/${id}/${verb}`, reason ? { reason } : {});
      if (!res.ok) throw new Error(res.data?.error || `Unable to ${verb} request.`);
      return res.data;
    },
    onSuccess: (_d, vars) => invalidate(vars.kind),
  });

  const isLoading = companyQ.isLoading || vendorQ.isLoading;
  const pending = action.isPending;

  const onReject = (kind: Kind, id: number, verb: 'reject' | 'revise') => {
    const reason = window.prompt(verb === 'reject' ? 'Reason for rejecting this request?' : 'What needs to be revised?');
    if (reason === null) return;
    action.mutate({ kind, id, verb, reason: reason.trim() });
  };

  return (
    <>
      {isLoading && <div className="state">Loading…</div>}
      {!isLoading && (
        <div className="table-wrap">
          <table className="registry-table">
            <thead>
              <tr>
                <th>Type</th><th>Request No.</th><th>Name</th><th>Status</th><th>Requested By</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = String(r.status || '').toLowerCase();
                const mine = String(r.requested_by_email || '') === String(me?.email || '');
                const canEdit = (status === 'draft' || status === 'needs_revision') && (!isStaff || mine);
                const canSubmit = canEdit;
                const canModerate = !isStaff && status === 'submitted';
                return (
                  <tr key={`${r.kind}-${r.id}`}>
                    <td>{r.kind === 'company' ? 'Company' : 'Vendor'}</td>
                    <td>{r.request_no || '-'}</td>
                    <td className="strong">{rowName(r)}</td>
                    <td>{statusChip(r.status)}{status === 'needs_revision' && r.reject_reason ? <div className="sub" style={{ fontSize: '0.7rem' }}>{r.reject_reason}</div> : null}</td>
                    <td>{r.requested_by || '-'}</td>
                    <td className="row-actions">
                      {canEdit && <button className="btn btn-edit btn-sm" onClick={() => setEdit({ kind: r.kind, draft: { id: r.id, payload: r.payload } })}>Edit</button>}
                      {canSubmit && <button className="btn btn-add btn-sm" disabled={pending} onClick={() => action.mutate({ kind: r.kind, id: r.id, verb: 'submit' })}>Submit</button>}
                      {canModerate && <button className="btn btn-save btn-sm" disabled={pending} onClick={() => action.mutate({ kind: r.kind, id: r.id, verb: 'approve' })}>Approve</button>}
                      {canModerate && <button className="btn btn-sm" disabled={pending} onClick={() => onReject(r.kind, r.id, 'revise')}>Revise</button>}
                      {canModerate && <button className="btn btn-cancel btn-sm" disabled={pending} onClick={() => onReject(r.kind, r.id, 'reject')}>Reject</button>}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={6} className="empty">Walang pending request.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {edit && edit.kind === 'company' && <CompanyModal draft={edit.draft as DraftRef} onClose={() => setEdit(null)} />}
      {edit && edit.kind === 'vendor' && <VendorModal draft={edit.draft as VendorDraftRef} onClose={() => setEdit(null)} />}
    </>
  );
}
