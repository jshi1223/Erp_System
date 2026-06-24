import { useState } from 'react';
import AppShell from '../components/AppShell';
import { useMe } from '../auth/auth';
import { CompaniesTab } from './CompanyRegistry';
import { VendorsTab } from './Vendors';
import { RequestsTab } from './Requests';

// React migration of the classic /master-data shell (was the AP/procurement shared page,
// tabbed via ?tab=). Tabs: Companies (company_registry) + Vendors + Requests (drafts/approval).
// Requests is STAFF-ONLY: staff file/track their draft company/vendor requests there; admins
// review them in the approval center, so the tab is hidden for admin / super_admin.
type Tab = 'companies' | 'vendors' | 'requests';

function initialTab(): Tab {
  const t = new URLSearchParams(window.location.search).get('tab');
  if (t === 'vendors') return 'vendors';
  if (t === 'requests') return 'requests';
  return 'companies';
}

export default function MasterDataPage() {
  const [tab, setTab] = useState<Tab>(initialTab);
  const { data: me } = useMe();
  const isStaff = me?.role === 'staff';

  // Admins never see Requests; if one deep-links to ?tab=requests, fall back to Companies.
  const activeTab: Tab = tab === 'requests' && !isStaff ? 'companies' : tab;

  const select = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
  };

  return (
    <AppShell title="Master Data Management" subtitle="Maintain the company and vendor master records used across procurement, projects, and finance.">
      <div className="module-tabs" role="tablist">
        <button type="button" role="tab" className={`module-tab${activeTab === 'companies' ? ' active' : ''}`} aria-selected={activeTab === 'companies'} onClick={() => select('companies')}>Companies</button>
        <button type="button" role="tab" className={`module-tab${activeTab === 'vendors' ? ' active' : ''}`} aria-selected={activeTab === 'vendors'} onClick={() => select('vendors')}>Vendors</button>
        {isStaff && (
          <button type="button" role="tab" className={`module-tab${activeTab === 'requests' ? ' active' : ''}`} aria-selected={activeTab === 'requests'} onClick={() => select('requests')}>Requests</button>
        )}
      </div>

      {activeTab === 'companies' && <CompaniesTab />}
      {activeTab === 'vendors' && <VendorsTab />}
      {activeTab === 'requests' && isStaff && <RequestsTab />}
    </AppShell>
  );
}
