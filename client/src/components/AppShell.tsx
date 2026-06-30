import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMe } from '../auth/auth';
import { logout } from '../lib/auth';
import { apiGet } from '../lib/api';
import { ConfirmDialog } from './dialogs';
import type { BusinessEntity } from '../types';

// Current workspace/entity label shown in the header — mirrors workspace-switcher.js:
// no saved choice or 'all' => "All Companies"; otherwise the selected operating company's
// name (never the old hard-coded KVSK brand — see [[business-entity-logo-convention]]).
function currentEntityContextId(): string {
  try {
    return String(localStorage.getItem('kinaadman_businessEntityContext') || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

function resolveEntityNameSync(): string {
  const ctx = currentEntityContextId();
  if (!ctx || ctx === 'all') return 'All Companies';
  try {
    const raw = localStorage.getItem('kinaadman_businessEntityTheme');
    const stored = raw ? JSON.parse(raw) : null;
    if (stored && stored.company_name) return String(stored.company_name).trim();
  } catch {
    /* ignore */
  }
  return 'All Companies';
}

function roleLabel(role?: string): string {
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'admin') return 'Admin';
  if (role === 'staff') return 'Staff';
  return 'User';
}

type Role = 'super_admin' | 'admin' | 'staff' | 'user';
interface NavLink { href: string; label: string; superAdminOnly?: boolean; }
interface NavGroup { key: string; label: string; staffHidden?: boolean; links: NavLink[]; }

// Mirrors the classic role-based sidebar groups (public/admin/index.html + auth-guard.js).
const NAV_GROUPS: NavGroup[] = [
  { key: 'master-data', label: 'Master Data', links: [
    { href: '/master-data?tab=companies', label: 'Company Registry' },
    { href: '/master-data?tab=vendors', label: 'Vendors' },
  ] },
  { key: 'projects', label: 'Projects', staffHidden: true, links: [
    { href: '/admin?panel=project-records', label: 'Project Records' },
    { href: '/admin?panel=project-records&tab=ledger', label: 'Project Overview' },
    { href: '/gantt-chart', label: 'Gantt Chart' },
  ] },
  { key: 'sales-management', label: 'Sales Management', links: [
    { href: '/sales-management?tab=sales-request', label: 'Sales Request' },
    { href: '/sales-management?tab=sales-order', label: 'Sales Order' },
    { href: '/sales-management?tab=project-delivery', label: 'Project Delivery' },
  ] },
  { key: 'procurement', label: 'Procurement Management', links: [
    { href: '/procurement?tab=requisitions', label: 'Purchase Requisitions' },
    { href: '/procurement?tab=rfq', label: 'RFQ' },
    { href: '/procurement?tab=quotations', label: 'Quotations & Evaluation' },
    { href: '/procurement?tab=purchase-orders', label: 'Purchase Orders' },
    { href: '/procurement?tab=goods-receipts', label: 'Goods Receipts' },
  ] },
  { key: 'inventory', label: 'Inventory Management', links: [
    { href: '/inventory?tab=products', label: 'Products' },
    { href: '/inventory?tab=warehouses', label: 'Warehouses' },
    { href: '/inventory?tab=stock', label: 'Stock Levels' },
    { href: '/inventory?tab=movements', label: 'Stock Movements' },
  ] },
  { key: 'finance', label: 'Financial Management', staffHidden: true, links: [
    { href: '/accounts-payable?tab=bills', label: 'Bills' },
    { href: '/accounts-payable?tab=vendor-balances', label: 'Vendor Balances' },
    { href: '/accounts-payable?tab=ap-aging', label: 'AP Aging' },
    { href: '/accounts-payable?tab=payments', label: 'AP Payments' },
    { href: '/accounts-payable?tab=disbursements', label: 'Disbursements' },
    { href: '/accounts-receivable?tab=invoices', label: 'AR Invoices' },
    { href: '/accounts-receivable?tab=collections', label: 'AR Collections' },
    { href: '/accounts-receivable?tab=customer-balances', label: 'AR Customer Balances' },
    { href: '/accounts-receivable?tab=ar-aging', label: 'AR Aging' },
    { href: '/reports', label: 'General Ledger / Reports' },
  ] },
  { key: 'admin', label: 'Admin', staffHidden: true, links: [
    { href: '/user-management', label: 'User Management' },
    { href: '/admin?panel=approval-center', label: 'Approval Center' },
    { href: '/business-entities', label: 'Business Entities', superAdminOnly: true },
    { href: '/admin?panel=archive-center', label: 'Archive Center' },
    { href: '/admin?view=logs', label: 'System Logs', superAdminOnly: true },
  ] },
];

function linkIsActive(href: string): boolean {
  try {
    const url = new URL(href, window.location.origin);
    const lp = url.pathname.replace(/\/+$/, '') || '/';
    const cp = window.location.pathname.replace(/\/+$/, '') || '/';
    if (lp !== cp) return false;
    const linkTab = url.searchParams.get('tab');
    if (!linkTab) return true;
    return linkTab === new URLSearchParams(window.location.search).get('tab');
  } catch {
    return false;
  }
}

function visibleGroups(role: Role): NavGroup[] {
  const isStaff = role === 'staff';
  const isSuper = role === 'super_admin';
  return NAV_GROUPS
    .filter((g) => !(isStaff && g.staffHidden))
    .map((g) => ({ ...g, links: g.links.filter((l) => !l.superAdminOnly || isSuper) }))
    .filter((g) => g.links.length > 0);
}

// Mirrors the classic page shell (same classes + classic CSS) so it looks identical.
export default function AppShell({ title, subtitle, children, hideBack }: { title: string; subtitle?: string; children: ReactNode; hideBack?: boolean }) {
  const { data: me } = useMe();
  const role = (me?.role as Role) || 'user';
  const [open, setOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const groups = useMemo(() => visibleGroups(role), [role]);

  // Resolve the current workspace/entity name for the header (All Companies or the company).
  const [entityName, setEntityName] = useState(resolveEntityNameSync);
  useEffect(() => {
    const ctx = currentEntityContextId();
    if (!ctx || ctx === 'all') { setEntityName('All Companies'); return; }
    try {
      const raw = localStorage.getItem('kinaadman_businessEntityTheme');
      const stored = raw ? JSON.parse(raw) : null;
      if (stored?.company_name) { setEntityName(String(stored.company_name).trim()); return; }
    } catch { /* ignore */ }
    let cancelled = false;
    apiGet<BusinessEntity[]>('/api/business-entities').then(({ ok, data }) => {
      if (cancelled || !ok || !Array.isArray(data)) return;
      const match = data.find((e) => String(e.id) === ctx);
      if (match?.company_name) setEntityName(String(match.company_name).trim());
    });
    return () => { cancelled = true; };
  }, []);

  // Classic behavior: all groups collapsed by default, with the group containing the
  // active link expanded.
  const activeGroupKey = useMemo(() => {
    const g = groups.find((grp) => grp.links.some((l) => linkIsActive(l.href)));
    return g?.key || null;
  }, [groups]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(activeGroupKey ? [activeGroupKey] : []));
  useEffect(() => {
    if (activeGroupKey) setExpanded((prev) => (prev.has(activeGroupKey) ? prev : new Set(prev).add(activeGroupKey)));
  }, [activeGroupKey]);

  const toggleGroup = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  useEffect(() => {
    document.body.classList.toggle('sidebar-open', open);
    return () => document.body.classList.remove('sidebar-open');
  }, [open]);

  const dashboardActive = (window.location.pathname.replace(/\/+$/, '') || '/') === '/admin';

  return (
    <>
      <header>
        <div className="header-left" style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <button className="btn-icon sidebar-toggle-btn" type="button" onClick={() => setOpen((v) => !v)} aria-label="Open menu" title="Menu">
            <svg className="sidebar-toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <button className="brand-link" type="button" onClick={() => (window.location.href = '/admin')} aria-label="Go to dashboard">
            <div className="brand-lockup">
              <img className="brand-mark" alt="" hidden />
              <div className="brand-copy">
                <div className="header-logo">{entityName}</div>
                <div className="header-sub">{title}</div>
              </div>
            </div>
          </button>
        </div>
        <div className="header-right">
          <div className="business-profile-menu">
            <span className="workspace-badge">{entityName}</span>
          </div>
          <span className="admin-badge" aria-live="polite">{roleLabel(me?.role)}</span>
          <div className="notification-wrap">
            <button className="btn-icon notification-btn" type="button" aria-label="Notifications" title="Notifications" onClick={() => (window.location.href = '/notifications')}>
              <svg viewBox="0 0 24 24" aria-hidden="true" className="notification-icon">
                <path d="M12 22a2.3 2.3 0 0 0 2.2-1.6h-4.4A2.3 2.3 0 0 0 12 22zm7-5.5V11a7 7 0 0 0-5-6.7V3.5a2 2 0 1 0-4 0v.8A7 7 0 0 0 5 11v5.5l-1.7 1.7a1 1 0 0 0 .7 1.7h15a1 1 0 0 0 .7-1.7L19 16.5z" />
              </svg>
            </button>
          </div>
          <button className="btn btn-logout btn-sm" type="button" onClick={() => setConfirmLogout(true)}>Logout</button>
        </div>
      </header>

      <div className={`sidebar-overlay${open ? ' open' : ''}`} onClick={() => setOpen(false)} />
      <div className={`sidebar${open ? ' open' : ''}`} id="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <img className="sidebar-brand-mark" alt="" hidden />
            <div>
              <div className="header-logo" style={{ fontSize: '1rem' }}>{entityName}</div>
              <div className="header-sub">Operations Control Panel</div>
            </div>
          </div>
          <button className="modal-close" type="button" onClick={() => setOpen(false)}>X</button>
        </div>
        <nav className="sidebar-nav">
          <a href="/admin" className={`sidebar-link${dashboardActive ? ' active' : ''}`}>Dashboard</a>
          {groups.map((g) => {
            const isOpen = expanded.has(g.key);
            return (
              <div key={g.key} className={`sidebar-group${isOpen ? '' : ' is-collapsed'}`} data-sidebar-group={g.key}>
                <button type="button" className="sidebar-group-toggle" aria-expanded={isOpen} onClick={() => toggleGroup(g.key)}>
                  <span>{g.label}</span>
                  <span className="sidebar-group-caret" aria-hidden="true">&#9662;</span>
                </button>
                <div className="sidebar-group-items">
                  {g.links.map((l) => (
                    <a key={l.href} href={l.href} className={`sidebar-link is-subitem${linkIsActive(l.href) ? ' active' : ''}`}>{l.label}</a>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </div>

      <main>
        <div className="page-hero" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div className="page-hero-copy">
            <div className="page-title">{title}</div>
            {subtitle && <div className="page-sub">{subtitle}</div>}
          </div>
          {!hideBack && (
            <button
              className="btn btn-cancel btn-sm section-back-btn"
              type="button"
              onClick={() => (window.location.href = '/admin?view=dashboard')}
            >
              &larr; Back to Dashboard
            </button>
          )}
        </div>
        {children}
      </main>

      {confirmLogout && (
        <ConfirmDialog
          title="Logout?"
          message="Sigurado ka bang gusto mong mag-logout?"
          confirmLabel="Oo, mag-logout"
          cancelLabel="Cancel"
          onConfirm={() => { setConfirmLogout(false); logout(); }}
          onCancel={() => setConfirmLogout(false)}
        />
      )}
    </>
  );
}
