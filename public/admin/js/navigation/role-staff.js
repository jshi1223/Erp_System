(function () {
  'use strict';

  window.KinaadmanAdminNavigation?.register('staff', [
    { label: 'Dashboard', href: '/admin', id: 'menu-dashboard' },
    { label: 'Staff Workspace', href: '/admin?panel=staff-workspace', id: 'menu-staff-workspace' },
    {
      type: 'group',
      key: 'master-data',
      label: 'Master Data',
      items: [
        { label: 'Company Registry', href: '/master-data?tab=companies', id: 'menu-company-registry' },
        { label: 'Vendors', href: '/master-data?tab=vendors' }
      ]
    },
    {
      type: 'group',
      key: 'projects',
      label: 'Projects',
      items: [
        { label: 'Project Records', href: '/admin?panel=project-records', id: 'menu-projects' },
        { label: 'Project Overview', href: '/admin?panel=project-records&tab=ledger', id: 'menu-project-ledger' }
      ]
    },
    {
      type: 'group',
      key: 'sales-management',
      label: 'Sales Management',
      items: [
        { label: 'Sales Invoices', href: '/sales-management', id: 'menu-sales-management' },
        { label: 'Collections', href: '/sales-management?tab=collections' }
      ]
    },
    {
      type: 'group',
      key: 'service-operations',
      label: 'Service Operations',
      items: [
        { label: 'Service Orders', href: '/service-operations', id: 'menu-service-operations' }
      ]
    },
    {
      type: 'group',
      key: 'procurement',
      label: 'Procurement',
      items: [
        { label: 'Purchase Requisitions', href: '/procurement?tab=requisitions' }
      ]
    },
    {
      type: 'group',
      key: 'inventory',
      label: 'Inventory',
      items: [
        { label: 'Products', href: '/inventory?tab=products', id: 'menu-inventory' },
        { label: 'Warehouses', href: '/inventory?tab=warehouses' },
        { label: 'Stock Levels', href: '/inventory?tab=stock' },
        { label: 'Stock Movements', href: '/inventory?tab=movements' }
      ]
    }
  ]);
})();
