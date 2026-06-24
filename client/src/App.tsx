import { Navigate, Route, Routes } from 'react-router-dom';
import UserManagementPage from './pages/UserManagement';
import BusinessEntitiesPage from './pages/BusinessEntities';
import CompanyRegistryPage from './pages/CompanyRegistry';
import MasterDataPage from './pages/MasterData';
import AccountsReceivablePage from './pages/AccountsReceivable';
import InventoryPage from './pages/Inventory';
import { RequireAuth } from './auth/auth';

// Each cut-over real URL is handled by React here; other URLs stay on the classic app.
export default function App() {
  return (
    <Routes>
      <Route path="/user-management" element={<RequireAuth><UserManagementPage /></RequireAuth>} />
      <Route path="/business-entities" element={<RequireAuth><BusinessEntitiesPage /></RequireAuth>} />
      {/* Built + route-registered; server route NOT cut over yet (classic /master-data stays live
          until overview + drafts workflow reach parity). */}
      <Route path="/company-registry" element={<RequireAuth><CompanyRegistryPage /></RequireAuth>} />
      {/* Master Data shell (Companies + Vendors + Requests tabs) — CUT OVER: server /master-data
          serves this React build. Full parity: CRUD, archive, overview drawer, vendor-profile,
          and the staff drafts/approval workflow. */}
      <Route path="/master-data" element={<RequireAuth><MasterDataPage /></RequireAuth>} />
      {/* Accounts Receivable (Invoices / Collections / Customer Balances / AR Aging / Documents
          + Add Invoice + Record Collection). Built + route-registered; server cut-over after
          parity sign-off. */}
      <Route path="/accounts-receivable" element={<RequireAuth><AccountsReceivablePage /></RequireAuth>} />
      {/* Inventory (Products / Warehouses / Stock Levels / Stock Movements + modals). Built +
          route-registered; server cut-over after parity sign-off. */}
      <Route path="/inventory" element={<RequireAuth><InventoryPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/user-management" replace />} />
    </Routes>
  );
}
