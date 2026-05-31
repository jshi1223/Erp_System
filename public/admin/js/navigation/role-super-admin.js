(function () {
  'use strict';

  const roleNavigation = window.KinaadmanAdminNavigation;
  const superAdminNavigation = [
    { label: 'Dashboard', href: '/admin', id: 'menu-dashboard' },
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
        { label: 'Project Overview', href: '/admin?panel=project-records&tab=ledger', id: 'menu-project-ledger' },
        { label: 'Gantt Chart', href: '/gantt-chart', id: 'menu-gantt-chart' }
      ]
    },
    {
      type: 'group',
      key: 'sales-management',
      label: 'Sales Management',
      items: [
        { label: 'Sales Invoices', href: '/sales-management', id: 'menu-sales-management' },
        { label: 'Collections', href: '/sales-management?tab=collections' },
        { label: 'Customer Balances', href: '/sales-management?tab=customer-balances' }
      ]
    },
    {
      type: 'group',
      key: 'service-operations',
      label: 'Service Operations',
      items: [
        { label: 'Service Orders', href: '/service-operations', id: 'menu-service-operations' },
        { label: 'Service Documents', href: '/service-operations?tab=documents' },
        { label: 'Project Transactions', href: '/admin?panel=project-records&tab=transactions' }
      ]
    },
    {
      type: 'group',
      key: 'procurement',
      label: 'Procurement',
      items: [
        { label: 'Purchase Requisitions', href: '/procurement?tab=requisitions' },
        { label: 'RFQ', href: '/procurement?tab=rfq' },
        { label: 'Quotations & Evaluation', href: '/procurement?tab=quotations' },
        { label: 'Purchase Orders', href: '/procurement?tab=purchase-orders' },
        { label: 'Goods Receipts', href: '/procurement?tab=goods-receipts' }
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
    },
    {
      type: 'group',
      key: 'finance',
      label: 'Finance',
      items: [
        { label: 'Bills', href: '/accounts-payable?tab=bills', id: 'menu-accounts-payable' },
        { label: 'Vendor Balances', href: '/accounts-payable?tab=vendor-balances' },
        { label: 'AP Aging', href: '/accounts-payable?tab=ap-aging' },
        { label: 'AP Payments', href: '/accounts-payable?tab=payments' },
        { label: 'Disbursements', href: '/accounts-payable?tab=disbursements' },
        { label: 'AR Invoices', href: '/accounts-receivable?tab=invoices', id: 'menu-accounts-receivable' },
        { label: 'AR Collections', href: '/accounts-receivable?tab=collections' },
        { label: 'AR Customer Balances', href: '/accounts-receivable?tab=customer-balances' },
        { label: 'AR Aging', href: '/accounts-receivable?tab=ar-aging' },
        { label: 'General Ledger / Reports', href: '/reports' }
      ]
    },
    {
      type: 'group',
      key: 'admin',
      label: 'Super Admin',
      collapsed: true,
      items: [
        { label: 'User Management', href: '/user-management', id: 'menu-users' },
        { label: 'Approval Center', href: '/admin?panel=approval-center', id: 'menu-approval-center', adminOnly: true },
        { label: 'Business Entities', href: '/business-entities', id: 'menu-business-entities' },
        { label: 'Archive Center', href: '/admin?panel=archive-center', id: 'menu-archive-center' },
        { label: 'System Logs', href: '/admin?view=logs', id: 'menu-logs' }
      ]
    }
  ];

  roleNavigation?.register('super_admin', superAdminNavigation);
})();
